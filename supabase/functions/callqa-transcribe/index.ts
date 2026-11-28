// callqa-transcribe — transcribe call recordings with no provider transcript.
// Downloads the recording (CallRail auth when needed), sends to Deepgram
// (preferred) or Whisper, stores a diarized transcript + per-line timestamps
// (transcript_segments), sets status='ready'. Scoring is separate.
//
// body.keep_status   = true -> don't change status (no re-score). For backfill.
// body.only_segments = true -> write ONLY transcript_segments, leave transcript.
// body.concurrency   = N    -> process the batch N-at-a-time (default 6, max 10).
// body.dry_run       = true -> transcribe + label and return the text; write nothing (v45).
//
// Speaker labels: v45 (2026-11-23) labels each line by ROLE with an AI pass (see labelRoles below);
// the older DIRECTION-AWARE rule is the fallback: Deepgram numbers speakers by first appearance.
// On INBOUND the branch/agent side speaks first (greeting/IVR) so first speaker = Agent; on
// OUTBOUND the customer answers first ("Hello?") so first speaker = Caller. Single-speaker calls
// are attributed to Agent.
//
// Brand-name ASR fixes: Deepgram mangles some client names (e.g. Omaha Door &
// Window -> "Omaha Dry Window"). applyBrandFix() normalizes known manglings,
// brand-scoped so other clients are never touched. Keep in sync with the SQL
// function public.callqa_brand_fix (used for one-time backfills).
//
// 2026-09-16 — PII REDACTION: transcripts are scrubbed of payment-card numbers
// (Luhn-validated) and US SSNs before being stored or scored (redactSensitive),
// and Deepgram is asked to redact pci/ssn at transcription (&redact=pci&ssn).
// Phone numbers, prices and emails are left intact (QA uses them).
//
// 2026-09-23 — REAL-TIME CHAIN: on success (status 'ready', !keep_status) invoke callqa-score right away.
// 2026-09-24 — CLAIM-BEFORE-CHAIN: claim rows (ready -> scoring) before chaining so the */2 drain
// cron can never score the same call twice (duplicate Teams alerts, Cedar Park 9/23).
// 2026-10-22 (v41) — SCOPE GATE: 'out_of_scope' calls are skipped (never sent to Deepgram).
// 2026-10-26 (v42) — TALK-OVER: also writes ai_qa_calls.talk_overlaps (see computeTalkOverlaps).
// 2026-11-05 (v44) — LightSpeed recordings are read from the lightspeed-recordings bucket (raw.storage_path).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MANAGER_ROLES = ["owner", "admin", "asc", "certification", "quality", "marketing"];

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-callqa-secret", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// --- Brand-name ASR corrections (mirror of SQL public.callqa_brand_fix) -------
function applyBrandFix(text: string, brand: string | null): string {
  if (!text) return text;
  if (brand === "Omaha Door") {
    return text
      .replace(/Omaha,?\s+Dry,?\s+(?:and\s+)?Window/gi, "Omaha Door and Window")
      .replace(/Omaha,?\s+Dora,?\s+(?:and\s+)?Window/gi, "Omaha Door and Window")
      .replace(/Omaha,?\s+Durham,?\s+(?:and\s+)?Window/gi, "Omaha Door and Window")
      .replace(/Omaha,?\s+High\s+Door,?\s+(?:and\s+)?Window/gi, "Omaha Door and Window")
      .replace(/Omaha,?\s+High,?\s+(?:and\s+)?Window/gi, "Omaha Door and Window")
      .replace(/Omaha\s+Door\s*Window/gi, "Omaha Door and Window")
      .replace(/oh\s+my\s+(?:honda|hondas|hunter|door|dora)/gi, "Omaha Door");
  }
  return text;
}

async function getSecret(k: string) { const { data } = await admin.from("integration_secrets").select("value").eq("key", k).maybeSingle(); return data?.value ?? null; }
function luhnValid(digits: string): boolean {
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d; alt = !alt;
  }
  return sum % 10 === 0;
}
function redactSensitive(text: string): string {
  if (!text) return text;
  let out = text.replace(/\b\d(?:[ -]?\d){12,18}\b/g, (m: string) => {
    const digits = m.replace(/[ -]/g, "");
    return (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) ? "[REDACTED_CARD]" : m;
  });
  out = out.replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[REDACTED_SSN]");
  return out;
}

async function authed(req: Request): Promise<boolean> {
  const configured = await getSecret("callqa_webhook_secret"); const provided = req.headers.get("x-callqa-secret");
  if (configured && provided === configured) return true;
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (bearer && bearer === SERVICE_KEY) return true;
  if (bearer) { const { data: u } = await admin.auth.getUser(bearer); if (u?.user) { const { data: prof } = await admin.from("profiles").select("role, is_admin").eq("id", u.user.id).maybeSingle(); if (prof && (prof.is_admin || MANAGER_ROLES.includes((prof.role || "").toLowerCase()))) return true; } }
  return false;
}
async function fetchAudio(recUrl: string, callrailKey: string | null): Promise<Uint8Array> {
  const isCallRail = /callrail\.com/i.test(recUrl); const headers: Record<string, string> = {};
  if (isCallRail && callrailKey) headers["Authorization"] = `Token token="${callrailKey}"`;
  let r = await fetch(recUrl, { headers, redirect: "follow" });
  const ct = r.headers.get("content-type") || "";
  if (ct.includes("application/json")) { const j = await r.json().catch(() => ({})); const u = j.url || j.recording || j.location; if (!u) throw new Error("recording JSON had no url"); r = await fetch(u, { redirect: "follow" }); }
  if (!r.ok) throw new Error(`recording fetch ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

type Seg = { t: number; s: string; text: string };
type TalkOverlaps = { v: 1; events: { t: number; by: string; over: string; secs: number; kind: "overlap" | "cutin" }[]; by_speaker: Record<string, number> };
const HOLD_OPEN_RE = /\bthanks?\s+(?:you\s+)?for\s+holding\b|serving the community since|\bpress\s+(?:\d|one|two|three|four|five|six|seven|eight|nine|zero|pound|star)\b|para espa|(?:may|will)\s+be\s+(?:monitored|recorded)|your call is (?:important|very important)|all of our (?:representatives|agents|associates)|please (?:stay|remain) on the line/i;
const IVR_ANY_RE = /serving the community since|\bpress\s+(?:\d|one|two|three|four|five|six|seven|eight|nine|zero|pound|star)\b|para espa|(?:may|will)\s+be\s+(?:monitored|recorded)|your call is (?:important|very important)|all of our (?:representatives|agents|associates)/i;
const r1 = (n: number) => Math.round(n * 10) / 10;
function computeTalkOverlaps(utt: any[], label: (sp: number) => string, order: number[]): TalkOverlaps {
  const firstUtt = utt.find((u: any) => String(u?.transcript || "").trim());
  const holdSp = firstUtt && HOLD_OPEN_RE.test(String(firstUtt.transcript)) ? (firstUtt.speaker ?? 0) : null;
  const firstOther = holdSp === null ? null : utt.find((u: any) => (u.speaker ?? 0) !== holdSp && String(u?.transcript || "").trim());
  const firstOtherStart = firstOther ? Number(firstOther.start) || 0 : Infinity;
  const kept = utt.filter((u: any) => {
    const text = String(u?.transcript || "").trim();
    if (!text || !Number.isFinite(Number(u.start)) || !Number.isFinite(Number(u.end))) return false;
    if (IVR_ANY_RE.test(text)) return false;
    const sp = u.speaker ?? 0;
    if (holdSp !== null && sp === holdSp) {
      if ((Number(u.start) || 0) < firstOtherStart) return false;
      if (order.length >= 3) return false;
    }
    return true;
  }).sort((a: any, b: any) => Number(a.start) - Number(b.start));
  const events: TalkOverlaps["events"] = []; const by_speaker: Record<string, number> = {};
  for (let i = 1; i < kept.length; i++) {
    const prev = kept[i - 1], cur = kept[i];
    const ps = prev.speaker ?? 0, cs = cur.speaker ?? 0;
    if (ps === cs) continue;
    const by = label(cs), over = label(ps);
    if (by === over) continue;
    const pEnd = Number(prev.end), cStart = Number(cur.start), cEnd = Number(cur.end);
    const ov = pEnd - cStart;
    let ev: TalkOverlaps["events"][number] | null = null;
    if (ov >= 0.3) ev = { t: r1(cStart), by, over, secs: r1(Math.min(pEnd, cEnd) - cStart), kind: "overlap" };
    else if (cStart - pEnd < 0.15 && !/[.?!]["')\]]*$/.test(String(prev.transcript || "").trim())) ev = { t: r1(Math.max(0, cStart)), by, over, secs: 0, kind: "cutin" };
    if (ev) { events.push(ev); by_speaker[by] = (by_speaker[by] || 0) + 1; }
  }
  return { v: 1, events, by_speaker };
}
function buildFromUtterances(utt: any[], direction?: string | null): { text: string; segments: Seg[]; talk_overlaps?: TalkOverlaps } {
  const order: number[] = [];
  for (const u of utt) { const sp = u.speaker ?? 0; if (!order.includes(sp)) order.push(sp); }
  const outbound = String(direction || "").toLowerCase() === "outbound";
  const label = (sp: number) => {
    if (order.length <= 1) return "Agent";
    if (order.length === 2) {
      const first = sp === order[0];
      return outbound ? (first ? "Caller" : "Agent") : (first ? "Agent" : "Caller");
    }
    return `Speaker ${sp}`;
  };
  const segments: Seg[] = utt.map((u: any) => ({ t: Math.max(0, Math.round(Number(u.start) || 0)), s: label(u.speaker ?? 0), text: String(u.transcript || "").trim() }))
    .filter((s: Seg) => s.text.length > 0);
  const text = segments.map((s) => `${s.s}: ${s.text}`).join("\n");
  let talk_overlaps: TalkOverlaps | undefined;
  try { talk_overlaps = computeTalkOverlaps(utt, label, order); } catch (e) { console.error("talk_overlaps failed", String((e as Error)?.message ?? e)); }
  return { text, segments, talk_overlaps };
}
// --- 2026-11-23 (v45, Becky / Rob item 11) -----------------------------------------------------
// LightSpeed recordings are ONE mixed channel (checked all brands 11/23), so voice-only diarization
// swaps speakers after holds/transfers and labels IVR lines as people. Two fixes:
//  1. VOCABULARY: Deepgram keywords per brand, built automatically from the brand name, its locations
//     and the CSR list (ai_qa_csr_roster) — fixes "App Store"/"Naples" for Apple, misheard CSR names.
//  2. ROLE PASS: Claude reads the diarized lines and labels each one CSR / caller / recording by what
//     is said (greeting, who describes the problem, IVR wording). Falls back to the old rule on error.
// body.dry_run = true -> transcribe + label, return the result, write nothing (for side-by-side checks).
const vocabCache = new Map<string, string[]>();
// v45b: CSR first names were dropped from the list — boosting them made Deepgram hear names everywhere
// ("garage" -> "Grace", "and" -> "Anne"). Brand + location names only, as nova-3 keyterms.
async function vocabFor(brand: string | null): Promise<string[]> {
  if (!brand) return [];
  if (vocabCache.has(brand)) return vocabCache.get(brand)!;
  const terms = new Set<string>([brand]);
  const short = brand.replace(/\b(Overhead Door|Door Systems|Doors|Door)\b/gi, "").trim();
  if (short && short.length >= 3) { terms.add(short); terms.add(short + " Door"); }
  try {
    const { data } = await admin.from("ai_qa_csr_roster").select("location").eq("brand", brand).eq("active", true).limit(300);
    for (const r of data || []) { const l = String((r as any).location || "").trim(); if (l.length >= 3) terms.add(l); }
  } catch { /* optional */ }
  const list = [...terms].slice(0, 40);
  vocabCache.set(brand, list);
  return list;
}

const ROLE_SYSTEM = `You label who is speaking in a business phone call transcript. The audio was ONE mixed channel, so the
speaker ids from diarization are unreliable: one id can hold lines from two people, and ids often swap after a hold or
a transfer. For EACH line decide who actually said it, from what is said and the flow of the conversation:
A = the company's CSR handling the call (greets with the company name and their own name, asks for name/address/phone,
    offers appointments, explains fees, puts the caller on hold).
B = a second company employee after a transfer or hand-off (a different person from A who also speaks for the company).
C = the caller / customer (describes their problem, gives their own name, address and phone, asks about price or timing).
R = a recording, not a live person (phone menu, "press 1", hold message, "this call may be recorded", voicemail greeting).
Use the speaker ids only as a weak hint. A line can be a fragment of a sentence; give it the role of whoever is saying it.
Return ONLY one line per input line, in order, formatted "<line number> <letter>", e.g.
1 R
2 A
3 C
No other text.`;
type Utt = { speaker?: number; start?: number; end?: number; transcript?: string };
async function labelRoles(utt: Utt[], ctx: { brand: string | null; agent: string | null; direction: string | null }): Promise<string | null> {
  const key = await getSecret("anthropic_api_key");
  if (!key || !utt.length || utt.length > 400) return null;
  const lines = utt.map((u, i) => `${i + 1} [${u.speaker ?? 0}] ${String(u.transcript || "").trim().slice(0, 240)}`).join("\n");
  const user = `Company: ${ctx.brand || "unknown"}\nCSR on this call (from the phone system): ${ctx.agent || "unknown"}\nCall direction: ${ctx.direction || "inbound"}${String(ctx.direction || "").toLowerCase() === "outbound" ? " (the CSR placed the call; the customer answers first)" : " (the customer called in; the company or a recording speaks first)"}\nLines (${utt.length}):\n${lines}`;
  const ask = async (): Promise<string | null> => {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: 4000, system: ROLE_SYSTEM, messages: [{ role: "user", content: user }] }),
    });
    const j = await r.json(); if (!r.ok) { console.error("roles http", r.status); return null; }
    const t = (j.content || []).map((c: any) => c.text || "").join("");
    const got: string[] = new Array(utt.length).fill("");
    // tolerant: "1 R", "1: R", "1. A", "Line 1 - C", "1 Recording", "1 | A", inside code fences, etc.
    for (const line of t.split(/\n/)) {
      const mm = line.match(/(\d+)\s*(?:[:.)|\]-]|=>|->)?\s*\**\s*(A|B|C|R|Agent|Caller|Customer|CSR|Recording|IVR)\b/i);
      if (!mm) continue;
      const k = Number(mm[1]) - 1, w = mm[2].toUpperCase();
      const L = w === "AGENT" || w === "CSR" ? "A" : w === "CALLER" || w === "CUSTOMER" ? "C" : w === "RECORDING" || w === "IVR" ? "R" : w;
      if (k >= 0 && k < utt.length && !got[k]) got[k] = L;
    }
    const filled = got.filter(Boolean).length;
    if (filled < utt.length * 0.9) { console.error("roles incomplete", filled, utt.length, t.slice(0, 160)); return null; }
    for (let i = 0; i < got.length; i++) if (!got[i]) got[i] = got[i - 1] || got.find(Boolean) || "A";
    return got.join("");
  };
  try { return (await ask()) ?? (await ask()); } // one retry
  catch (e) { console.error("roles failed", String((e as Error)?.message ?? e)); return null; }
}
const ROLE_LABEL: Record<string, string> = { A: "Agent", B: "Agent", C: "Caller", R: "Recording" };
const ROLE_SP: Record<string, number> = { A: 0, B: 0, C: 1, R: 2 };
function buildFromRoles(utt: Utt[], roles: string): { text: string; segments: Seg[]; talk_overlaps?: TalkOverlaps } {
  const segments: Seg[] = utt.map((u, i) => ({ t: Math.max(0, Math.round(Number(u.start) || 0)), s: ROLE_LABEL[roles[i]] || "Agent", text: String(u.transcript || "").trim() }))
    .filter((s) => s.text.length > 0);
  const text = segments.map((s) => `${s.s}: ${s.text}`).join("\n");
  let talk_overlaps: TalkOverlaps | undefined;
  try {
    const mapped = utt.map((u, i) => ({ ...u, speaker: ROLE_SP[roles[i]] ?? 0 })).filter((u, i) => roles[i] !== "R");
    talk_overlaps = computeTalkOverlaps(mapped, (sp: number) => (sp === 1 ? "Caller" : "Agent"), [0, 1]);
  } catch (e) { console.error("talk_overlaps failed", String((e as Error)?.message ?? e)); }
  return { text, segments, talk_overlaps };
}

type TxOut = { text: string; segments: Seg[]; talk_overlaps?: TalkOverlaps; labels?: "ai" | "rule" };
async function deepgram(key: string, audio: Uint8Array, ctx: { direction: string | null; brand: string | null; agent: string | null }): Promise<TxOut> {
  const kw = (await vocabFor(ctx.brand)).map((k) => `&keyterm=${encodeURIComponent(k)}`).join("");
  const r = await fetch("https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&punctuate=true&diarize=true&utterances=true&redact=pci&redact=ssn" + kw, { method: "POST", headers: { Authorization: `Token ${key}`, "Content-Type": "audio/mpeg" }, body: audio });
  const j = await r.json(); if (!r.ok) throw new Error("deepgram: " + JSON.stringify(j).slice(0, 200));
  const utt = (j?.results?.utterances || []).filter((u: any) => String(u?.transcript || "").trim());
  if (Array.isArray(utt) && utt.length) {
    const roles = await labelRoles(utt, ctx);
    if (roles) return { ...buildFromRoles(utt, roles), labels: "ai" };
    return { ...buildFromUtterances(utt, ctx.direction), labels: "rule" };
  }
  const text = j?.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";
  return { text, segments: [] };
}
async function whisper(key: string, audio: Uint8Array): Promise<TxOut> {
  const fd = new FormData(); fd.append("file", new Blob([audio], { type: "audio/mpeg" }), "call.mp3"); fd.append("model", "whisper-1");
  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: fd });
  const j = await r.json(); if (!r.ok) throw new Error("whisper: " + JSON.stringify(j).slice(0, 200));
  return { text: j.text || "", segments: [] };
}

function fireAndForget(p: Promise<unknown>) {
  const g = globalThis as any;
  if (g.EdgeRuntime?.waitUntil) g.EdgeRuntime.waitUntil(p.catch(() => {}));
  else p.catch(() => {});
}
async function chainToScore(ids: string[]) {
  if (!ids.length) return;
  try {
    const secret = await getSecret("callqa_webhook_secret");
    for (let i = 0; i < ids.length; i += 20) {
      const chunk = ids.slice(i, i + 20);
      fireAndForget(fetch(`${SUPABASE_URL}/functions/v1/callqa-score`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-callqa-secret": secret ?? "", "Authorization": `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({ call_ids: chunk }),
      }));
    }
  } catch (e) {
    console.error("chainToScore failed", String((e as Error)?.message ?? e));
  }
}
async function claimForScoring(ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const { data, error } = await admin.from("ai_qa_calls")
    .update({ status: "scoring", updated_at: new Date().toISOString() })
    .in("id", ids).eq("status", "ready").select("id");
  if (error) { console.error("claimForScoring failed", error.message); return []; }
  return (data || []).map((r: any) => r.id);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!(await authed(req))) return json({ error: "unauthorized" }, 401);
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const keepStatus = body.keep_status === true || dryRun;
    const onlySegments = body.only_segments === true;
    const conc = Math.min(Math.max(Number(body.concurrency) || 6, 1), 10);
    const dgKey = await getSecret("deepgram_api_key"); const oaKey = await getSecret("openai_api_key");
    if (!dgKey && !oaKey) return json({ error: "no transcription key" }, 503);
    const crKey = await getSecret("callrail_api_key");

    let ids: string[] = [];
    if (body.call_id) ids = [body.call_id];
    else if (Array.isArray(body.call_ids)) ids = body.call_ids;
    else { const lim = Math.min(Number(body.limit) || 10, 50); const { data } = await admin.from("ai_qa_calls").select("id").in("status", ["needs_transcription", "transcribing"]).not("recording_url", "is", null).order("created_at", { ascending: false }).limit(lim); ids = (data || []).map((r: any) => r.id); }
    if (!ids.length) return json({ ok: true, transcribed: 0, results: [] });

    const results: any[] = []; const done: string[] = [];
    async function processOne(id: string) {
      try {
        const { data: call } = await admin.from("ai_qa_calls").select("id, recording_url, brand, direction, status, raw, agent_name").eq("id", id).single();
        const sp = typeof call?.raw?.storage_path === "string" ? call.raw.storage_path : null;
        if (call?.status === "out_of_scope" && !dryRun) { results.push({ id, skip: "out of scope" }); return; }
        if (!call?.recording_url && !sp) { if (!keepStatus) await admin.from("ai_qa_calls").update({ status: "error", error: "no recording" }).eq("id", id); results.push({ id, skip: "no recording" }); return; }
        let audio: Uint8Array | null = null;
        if (sp) { const dl = await admin.storage.from("lightspeed-recordings").download(sp); if (!dl.error && dl.data) audio = new Uint8Array(await dl.data.arrayBuffer()); }
        if (!audio) audio = await fetchAudio(call.recording_url, crKey);
        const raw = dgKey ? await deepgram(dgKey, audio, { direction: call.direction, brand: call.brand, agent: call.agent_name }) : await whisper(oaKey!, audio);
        if (!raw.text || raw.text.trim().length < 10) { if (!keepStatus) await admin.from("ai_qa_calls").update({ status: "error", error: "empty transcript" }).eq("id", id); results.push({ id, error: "empty transcript" }); return; }
        const segments = raw.segments.map((s) => ({ ...s, text: redactSensitive(applyBrandFix(s.text, call.brand)) }));
        const text = redactSensitive(applyBrandFix(raw.text, call.brand));
        if (dryRun) { results.push({ id, labels: raw.labels, text }); return; }
        const patch: Record<string, unknown> = { transcript_segments: segments, talk_overlaps: raw.talk_overlaps ?? null };
        if (!onlySegments) { patch.transcript = text; patch.transcript_source = dgKey ? "deepgram" : "whisper"; }
        if (!keepStatus) { patch.status = "ready"; patch.error = null; }
        await admin.from("ai_qa_calls").update(patch).eq("id", id);
        results.push({ id, ok: true, chars: text.length, segments: segments.length, labels: raw.labels }); done.push(id);
      } catch (e) { if (!keepStatus) await admin.from("ai_qa_calls").update({ status: "error", error: String((e as Error)?.message ?? e) }).eq("id", id); results.push({ id, error: String((e as Error)?.message ?? e) }); }
    }
    let idx = 0;
    async function worker() { while (idx < ids.length) { const i = idx++; await processOne(ids[i]); } }
    await Promise.all(Array.from({ length: Math.min(conc, ids.length) }, () => worker()));
    if (!keepStatus && done.length) {
      const claimed = await claimForScoring(done);
      if (claimed.length) await chainToScore(claimed);
    }
    return json({ ok: true, transcribed: done.length, engine: dgKey ? "deepgram" : "whisper", results });
  } catch (e) { return json({ error: String((e as Error)?.message ?? e) }, 500); }
});
