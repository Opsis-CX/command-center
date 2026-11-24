// hub-call-parts — the rest of a call for the Coaching Hub player (2026-11-23, Becky).
// A call that goes on hold / gets cut off continues in linked legs (ai_qa_calls.leg_root_id) — e.g. the callback where
// the CSR finished booking. The hub's own audio action only returns the first recording. This returns the linked parts.
// Permission: we first ask opsis-coaching-hub for the main recording with the caller's own login; only if that is
// allowed do we look up and sign the follow-up parts.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const db = createClient(SB_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const isId = (x: unknown) => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const p = await req.json().catch(() => ({}));
    if (!isId(p?.id)) return json({ error: "Pick a call." }, 400);
    const auth = req.headers.get("Authorization") || "";
    const chk = await fetch(`${SB_URL}/functions/v1/opsis-coaching-hub`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: auth, apikey: req.headers.get("apikey") || Deno.env.get("SUPABASE_ANON_KEY") || "" }, body: JSON.stringify({ action: "hubaudio", id: p.id, client_id: p.client_id }) });
    const cj: any = await chk.json().catch(() => ({}));
    if (!chk.ok || !cj?.url) return json({ error: cj?.error || "Not allowed." }, chk.ok ? 404 : chk.status);
    const { data: rv } = await db.from("ai_qa_reviews").select("call_id").eq("id", p.id).maybeSingle();
    if (!rv?.call_id) return json({ url: cj.url, parts: [] });
    const { data: legs } = await db.from("ai_qa_calls").select("raw, leg_no, leg_offset_sec, duration_seconds").eq("leg_root_id", rv.call_id).order("leg_no", { ascending: true }).limit(6);
    const parts: any[] = [];
    for (const l of legs || []) {
      const sp = typeof (l as any).raw?.storage_path === "string" ? (l as any).raw.storage_path : null;
      if (!sp) continue;
      const { data } = await db.storage.from("lightspeed-recordings").createSignedUrl(sp, 3600);
      const u = data?.signedUrl; if (!u) continue;
      parts.push({ url: u.startsWith("http") ? u : `${SB_URL}${u.startsWith("/") ? "" : "/"}${u}`, offset: Number(l.leg_offset_sec) || 0, secs: Number(l.duration_seconds) || 0 });
    }
    return json({ url: cj.url, parts });
  } catch (e) { return json({ error: String((e as Error)?.message ?? e) }, 500); }
});
