// qa-callbacks — daily callback list (Rob item 4, 2026-11-23).
// 7am ET: yesterday's revenue-opportunity calls that didn't book and are worth a call back (qa_callback_rows),
// one email per brand to that brand's callback owners (qa_callback_owners). Brands with no owner go into one
// combined email to qa_program_settings.callback_list.fallback (Becky) until owners are named.
// Clients: qa_program_settings.callback_list.clients (default: GarageCo).
// p: { dry, force, day, to } — dry returns what would send; to sends everything to one address (test).
// Auth: x-callqa-secret. Email: portal Gmail sender (integration_secrets portal_gmail_user / portal_gmail_app_pass).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const GARAGECO = "c7c50cda-92a6-4665-baa3-3e207f853326";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const secret = async (k: string) => (await db.from("integration_secrets").select("value").eq("key", k).maybeSingle()).data?.value || null;
const etNow = () => { const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false }).formatToParts(new Date()); const g = (t: string) => p.find((x) => x.type === t)!.value; return { day: `${g("year")}-${g("month")}-${g("day")}`, hour: Number(g("hour")) % 24 }; };
const prevDay = (d: string) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };
const nice = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const fmtPhone = (p: string | null) => { const d = String(p || "").replace(/\D/g, "").slice(-10); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (p || ""); };
const tm = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET" : "";
const portalUrl = (client: string) => client === GARAGECO ? "https://garageco.opsiscx.com/" : "https://opsisqa.com/";

async function mail(to: string[], subject: string, html: string) {
  const user = await secret("portal_gmail_user"), pass = await secret("portal_gmail_app_pass");
  const from = (await secret("portal_from")) || `Opsis QA <${user}>`;
  if (!user || !pass) throw new Error("portal email is not configured");
  const c = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: user, password: pass } } });
  await c.send({ from, to, subject, html });
  await c.close();
}
function table(rows: any[], portal: string, showBrand: boolean) {
  const th = (t: string) => `<th style="text-align:left;padding:7px 8px;background:#F3F1EC;border:1px solid #E2DDD2;font-size:12px">${t}</th>`;
  const td = (t: string, extra = "") => `<td style="padding:7px 8px;border:1px solid #E2DDD2;font-size:13px;vertical-align:top;${extra}">${t}</td>`;
  return `<table style="width:100%;border-collapse:collapse;margin-top:10px"><tr>${showBrand ? th("Brand") : ""}${th("Customer")}${th("Called")}${th("Why it didn't book")}${th("What they needed")}${th("")}</tr>` +
    rows.map((r) => `<tr>${showBrand ? td(esc(r.brand)) : ""}${td(`<b>${esc(r.customer || "Unknown name")}</b><br>${esc(fmtPhone(r.phone)) || "<span style='color:#B4461F'>no number</span>"}`)}${td(`${esc(tm(r.started_at))}<br><span style="color:#6B726E">CSR: ${esc(r.agent || "—")}</span>`, "white-space:nowrap")}${td(esc(r.reason))}${td(esc(String(r.what || r.summary || "").slice(0, 220)))}${td(`<a href="${portal}#call=${r.review_id}" style="color:#14302A;font-weight:700">Listen</a>`)}</tr>`).join("") + `</table>`;
}
const shell = (title: string, sub: string, body: string) => `<div style="font-family:Arial,Helvetica,sans-serif;max-width:860px;margin:0 auto;color:#1C2421;line-height:1.5"><div style="font-size:18px;font-weight:800">${esc(title)}</div><div style="color:#6B726E;font-size:13px;padding:2px 0 8px">${esc(sub)}</div>${body}<div style="margin-top:18px;padding-top:10px;border-top:1px solid #E8E4DC;font-size:11.5px;color:#8A918D">Calls where the customer needed service, didn't book, and hasn't booked on a later call. Each line is worth a call back today. Opsis QA.</div></div>`;

async function run(p: any) {
  const et = etNow();
  if (!p.force && !p.dry && et.hour !== 7) return { skipped: "not 7am ET" };
  const day = /^\d{4}-\d{2}-\d{2}$/.test(p.day || "") ? p.day : prevDay(et.day);
  const cfg: any = (await db.from("qa_program_settings").select("value").eq("key", "callback_list").maybeSingle()).data?.value || {};
  if (cfg.enabled === false && !p.dry && !p.force) return { skipped: "turned off" };
  const clients: string[] = Array.isArray(cfg.clients) && cfg.clients.length ? cfg.clients : [GARAGECO];
  const fallback: string[] = Array.isArray(cfg.fallback) ? cfg.fallback : [cfg.fallback || "becky@turritopsisconsulting.com"];
  const out: any[] = [];
  for (const client of clients) {
    if (!p.dry && !p.force) { const { data: s } = await db.from("qa_alert_log").select("id").eq("client_id", client).eq("kind", "callbacks").eq("day", day).eq("ok", true).limit(1); if (s?.length) { out.push({ client, skipped: "already sent" }); continue; } }
    const { data: rows, error } = await db.rpc("qa_callback_rows", { p_client: client, p_from: day, p_to: day, p_brands: null });
    if (error) throw new Error(error.message);
    const list: any[] = rows || [];
    const { data: own } = await db.from("qa_callback_owners").select("brand, emails").eq("client_id", client);
    const owners = new Map((own || []).filter((o: any) => (o.emails || []).length).map((o: any) => [o.brand, o.emails as string[]]));
    const portal = portalUrl(client);
    const byBrand: Record<string, any[]> = {};
    for (const r of list) (byBrand[r.brand] ||= []).push(r);
    const unowned: any[] = [];
    for (const [brand, rs] of Object.entries(byBrand).sort()) {
      const to = owners.get(brand);
      if (!to) { unowned.push(...rs); continue; }
      const subject = `${brand}: ${rs.length} customer${rs.length > 1 ? "s" : ""} to call back (${nice(day)})`;
      const html = shell(subject, `From ${nice(day)}'s calls`, table(rs, portal, false));
      const dest = p.to ? [p.to] : to;
      if (!p.dry) await mail(dest, subject, html);
      out.push({ client, brand, to: dest, calls: rs.length });
    }
    if (unowned.length) {
      const subject = `Call back list: ${unowned.length} customers (${nice(day)})`;
      const html = shell(subject, `From ${nice(day)}'s calls · brands with no callback owner yet (set one in the portal under Callbacks)`, table(unowned, portal, true));
      const dest = p.to ? [p.to] : fallback;
      if (!p.dry) await mail(dest, subject, html);
      out.push({ client, brand: "(no owner)", to: dest, calls: unowned.length, html: p.dry && p.html ? html : undefined });
    }
    if (!p.dry && !p.force) await db.from("qa_alert_log").insert({ client_id: client, kind: "callbacks", day, ok: true, detail: { calls: list.length } });
  }
  return { day, sent: out };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const s = await secret("callqa_webhook_secret");
  if (!s || req.headers.get("x-callqa-secret") !== s) return json({ error: "Unauthorized" }, 401);
  let p: any = {}; try { p = await req.json(); } catch { /* empty */ }
  try { return json(await run(p)); } catch (e) { console.error(String((e as Error)?.message ?? e)); return json({ error: String((e as Error)?.message ?? e) }, 500); }
});
