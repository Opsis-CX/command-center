// callsrc-pull (Becky 11/23): pulls new call recordings from a customer's own phone system.
// POST {source_id, test?} — from the hourly cron (x-callqa-secret) or from a portal admin
// (their session token; must be able to edit that company). Supported: Twilio, RingCentral,
// Zoom Phone, Aircall. Audio is copied into qa-recordings/byo/<client>/<provider>/..., then the call
// is queued (status needs_transcription) for the normal transcribe + score pump.
// Skips calls under 30 seconds, max 40 new calls per run (10 on a test), 500/day per company.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const db = createClient(SB_URL, SERVICE, { auth: { persistSession: false } });
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-callqa-secret", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const MIN_SECS = 30;

type Item = { ext: string; started: string; secs: number; dir: string; agent?: string | null; customer?: string | null; raw?: unknown; get: () => Promise<{ bytes: Uint8Array; type: string; dir?: string; customer?: string | null }> };
class Friendly extends Error {}

const basic = (a: string, b: string) => "Basic " + btoa(`${a}:${b}`);
const day = (d: Date) => d.toISOString().slice(0, 10);
async function must(r: Response, what: string) {
  if (r.status === 401 || r.status === 403) throw new Friendly(`${what} said the key isn't valid or doesn't have permission to read recordings.`);
  if (!r.ok) throw new Friendly(`${what} returned an error (${r.status}). Try again in a few minutes.`);
  return r;
}
async function grab(url: string, headers: Record<string, string> = {}) {
  const r = await fetch(url, { headers, redirect: "follow" });
  if (!r.ok) throw new Error(`recording download ${r.status}`);
  return { bytes: new Uint8Array(await r.arrayBuffer()), type: r.headers.get("content-type") || "audio/mpeg" };
}

async function twilio(cfg: any, key: string, since: Date): Promise<Item[]> {
  const sid = String(cfg.account_sid || "").trim(), auth = basic(sid, key), base = `https://api.twilio.com/2010-04-01/Accounts/${sid}`;
  const j = await (await must(await fetch(`${base}/Recordings.json?PageSize=100&DateCreated%3E=${day(since)}`, { headers: { Authorization: auth } }), "Twilio")).json();
  const out: Item[] = [];
  for (const r of j.recordings || []) {
    out.push({ ext: r.sid, started: new Date(r.start_time || r.date_created).toISOString(), secs: Number(r.duration) || 0, dir: "inbound", raw: { call_sid: r.call_sid },
      get: async () => {
        let dir: string | undefined, customer: string | null | undefined;
        try { const c = await (await fetch(`${base}/Calls/${r.call_sid}.json`, { headers: { Authorization: auth } })).json();
          if (c?.direction) { dir = String(c.direction).startsWith("outbound") ? "outbound" : "inbound"; customer = dir === "inbound" ? c.from : c.to; } } catch { /* optional */ }
        return { ...(await grab(`${base}/Recordings/${r.sid}.mp3`, { Authorization: auth })), dir, customer };
      } });
  }
  return out;
}

async function ringcentral(cfg: any, key: string, since: Date): Promise<Item[]> {
  let sec: any = {}; try { sec = JSON.parse(key); } catch { throw new Friendly("Paste both the client secret and the JWT."); }
  const t = await (await must(await fetch("https://platform.ringcentral.com/restapi/oauth/token", { method: "POST",
    headers: { Authorization: basic(String(cfg.client_id || "").trim(), sec.client_secret || ""), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: sec.jwt || "" }) }), "RingCentral")).json();
  const bearer = { Authorization: `Bearer ${t.access_token}` };
  const j = await (await must(await fetch(`https://platform.ringcentral.com/restapi/v1.0/account/~/call-log?view=Simple&withRecording=true&perPage=100&dateFrom=${encodeURIComponent(since.toISOString())}`, { headers: bearer }), "RingCentral")).json();
  return (j.records || []).filter((r: any) => r.recording?.contentUri).map((r: any) => {
    const inbound = String(r.direction).toLowerCase() === "inbound";
    return { ext: String(r.id), started: r.startTime, secs: Number(r.duration) || 0, dir: inbound ? "inbound" : "outbound",
      agent: (inbound ? r.to?.name : r.from?.name) || null, customer: (inbound ? r.from?.phoneNumber : r.to?.phoneNumber) || null,
      get: () => grab(r.recording.contentUri, bearer) };
  });
}

async function zoom(cfg: any, key: string, since: Date): Promise<Item[]> {
  const t = await (await must(await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(String(cfg.account_id || "").trim())}`, { method: "POST",
    headers: { Authorization: basic(String(cfg.client_id || "").trim(), key) } }), "Zoom")).json();
  const bearer = { Authorization: `Bearer ${t.access_token}` };
  const j = await (await must(await fetch(`https://api.zoom.us/v2/phone/recordings?page_size=100&from=${day(since)}&to=${day(new Date())}`, { headers: bearer }), "Zoom")).json();
  return (j.recordings || []).filter((r: any) => r.download_url).map((r: any) => {
    const inbound = String(r.direction).toLowerCase() === "inbound";
    return { ext: String(r.id), started: new Date(r.date_time).toISOString(), secs: Number(r.duration) || 0, dir: inbound ? "inbound" : "outbound",
      agent: r.owner?.name || null, customer: (inbound ? r.caller_number : r.callee_number) || null, get: () => grab(r.download_url, bearer) };
  });
}

async function aircall(cfg: any, key: string, since: Date): Promise<Item[]> {
  const auth = basic(String(cfg.api_id || "").trim(), key);
  const j = await (await must(await fetch(`https://api.aircall.io/v1/calls?per_page=50&order=desc&from=${Math.floor(since.getTime() / 1000)}`, { headers: { Authorization: auth } }), "Aircall")).json();
  return (j.calls || []).filter((c: any) => c.recording).map((c: any) => ({ ext: String(c.id), started: new Date(c.started_at * 1000).toISOString(), secs: Number(c.duration) || 0,
    dir: c.direction === "outbound" ? "outbound" : "inbound", agent: c.user?.name || null, customer: c.raw_digits || null, get: () => grab(c.recording) }));
}

const PULL: Record<string, (cfg: any, key: string, since: Date) => Promise<Item[]>> = { twilio, ringcentral, zoom, aircall };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let srcId = "";
  try {
    const body = await req.json().catch(() => ({}));
    srcId = String(body.source_id || "");
    const { data: s } = await db.from("client_call_sources").select("*").eq("id", srcId).maybeSingle();
    if (!s || s.status === "disconnected") return json({ error: "Connection not found." }, 404);

    // Auth: cron secret, or a signed-in admin of that company.
    const { data: sec } = await db.from("integration_secrets").select("value").eq("key", "callqa_webhook_secret").maybeSingle();
    if (!(sec?.value && req.headers.get("x-callqa-secret") === sec.value)) {
      const auth = req.headers.get("Authorization") || "";
      const user = createClient(SB_URL, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
      const { data: l, error } = await user.rpc("qa_sources_list", { p_client: s.client_id });
      if (error || !l?.can_edit) return json({ error: "Only account admins can do this." }, 403);
    }
    const fn = PULL[s.provider];
    if (!fn) return json({ ok: true, supported: false, message: "Automatic pulling for this phone system is coming soon. Upload recordings in the meantime." });

    const test = body.test === true, cap = test ? 10 : 40;
    const { data: key } = await db.rpc("callsrc_secret", { p_id: s.id });
    if (!key) throw new Friendly("The saved key is missing. Disconnect and connect again.");
    const since = s.last_sync_at ? new Date(new Date(s.last_sync_at).getTime() - 2 * 3600e3) : new Date(Date.now() - 3 * 86400e3);
    const all = (await fn(s.config || {}, key, since)).filter((i) => i.secs >= MIN_SECS);
    const { data: k } = await db.rpc("callsrc_known", { p_source: s.id, p_ids: all.map((i) => i.ext) });
    if (!k?.has_settings) throw new Friendly("Finish call scoring setup first, then calls will start coming in.");
    const known = new Set<string>(k?.known || []);
    const room = Math.max(0, 500 - (k?.today || 0));
    const todo = all.filter((i) => !known.has(i.ext)).sort((a, b) => b.started.localeCompare(a.started)).slice(0, Math.min(cap, room));

    let added = 0; const errors: string[] = [];
    let idx = 0;
    async function worker() {
      while (idx < todo.length) {
        const it = todo[idx++];
        try {
          const a = await it.get();
          if (a.bytes.length < 2000) continue;
          const ext = /wav/.test(a.type) ? "wav" : /mp4|m4a/.test(a.type) ? "m4a" : "mp3";
          const path = `byo/${s.client_id}/${s.provider}/${crypto.randomUUID()}.${ext}`;
          const up = await db.storage.from("qa-recordings").upload(path, a.bytes, { contentType: a.type, upsert: false });
          if (up.error) throw new Error(up.error.message);
          const dir = a.dir || it.dir, customer = a.customer ?? it.customer ?? null;
          const { data: id } = await db.rpc("callsrc_ingest", { p_source: s.id, p_ext: it.ext, p_path: path, p_started_at: it.started, p_direction: dir,
            p_duration: it.secs, p_agent: it.agent ?? null, p_customer: customer, p_raw: it.raw ?? {} });
          if (id) added++;
        } catch (e) { errors.push(String((e as Error)?.message || e)); }
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()]);

    const patch: Record<string, unknown> = { status: "connected", last_error: null, updated_at: new Date().toISOString() };
    // Only move the "pulled up to" mark when nothing new was left behind (cap/test), so no call is skipped.
    if (todo.length === all.filter((i) => !known.has(i.ext)).length) patch.last_sync_at = new Date().toISOString();
    if (errors.length && !added) { patch.status = "error"; patch.last_error = "Couldn't download recordings: " + errors[0].slice(0, 160); }
    await db.from("client_call_sources").update(patch).eq("id", s.id);
    return json({ ok: true, supported: true, found: all.length, added, skipped_known: known.size, errors: errors.length,
      message: added ? `Connected. ${added} call${added === 1 ? "" : "s"} pulled in and being scored now.`
        : all.length ? "Connected. No new calls to pull right now." : "Connected. No recorded calls in the last 3 days yet — new ones will come in every hour." });
  } catch (e) {
    const msg = e instanceof Friendly ? e.message : "Something went wrong talking to your phone system: " + String((e as Error)?.message || e).slice(0, 160);
    if (srcId) await db.from("client_call_sources").update({ status: "error", last_error: msg, updated_at: new Date().toISOString() }).eq("id", srcId);
    return json({ error: msg }, e instanceof Friendly ? 400 : 500);
  }
});
