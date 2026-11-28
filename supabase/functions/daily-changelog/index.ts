// daily-changelog — every morning at 5am ET, posts to the Command Center chat channel #change-log what changed in the
// last 24 hours (Becky 11/24, for Becky + Brittney + Corinne while they build in parallel).
//   Live    = GitHub main (deploys to Vercel) + live database changes (Supabase migrations)
//   Staging = commits on the GitHub `staging` branch that aren't on main
// Claude (Haiku) groups the raw commit/migration titles by module/tab in plain words; if that fails, the raw list is posted.
// Posted as the "Claude" chat profile. Cron hourly; sends once per day at 5am ET. p: { dry, force, hours }.
// Auth: x-callqa-secret.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CHANNEL = "bed72014-0140-4d60-8f53-fa12b4a1e32a", BOT = "dda004c5-9baf-4fc2-975c-40de9d1e4be8", REPO = "Opsis-CX/command-center";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const secret = async (k: string) => (await db.from("integration_secrets").select("value").eq("key", k).maybeSingle()).data?.value || null;
const etNow = () => { const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false }).formatToParts(new Date()); const g = (t: string) => p.find((x) => x.type === t)!.value; return { day: `${g("year")}-${g("month")}-${g("day")}`, hour: Number(g("hour")) % 24 }; };
const first = (m: string) => String(m || "").split("\n")[0].trim();

async function gh(path: string) {
  const tok = await secret("github_token");
  const r = await fetch(`https://api.github.com/${path}`, { headers: { Accept: "application/vnd.github+json", "User-Agent": "opsis-changelog", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) } });
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  return r.json();
}
function who(c: any) { const n = c.commit?.author?.name || ""; return n === "Claude" ? "Claude" : n === "Opsis-CX" ? "GitHub edit" : n; }

async function collect(sinceIso: string) {
  const out: any = { live: [], staging: [], db: [], errors: [] };
  try {
    const main = await gh(`repos/${REPO}/commits?sha=main&since=${sinceIso}&per_page=100`);
    out.live = (main || []).filter((c: any) => (c.parents || []).length < 2).map((c: any) => ({ t: first(c.commit.message), by: who(c), sha: c.sha.slice(0, 7) }));
  } catch (e) { out.errors.push("Live code: " + (e as Error).message); }
  try {
    const cmp = await gh(`repos/${REPO}/compare/main...staging`);
    out.staging = (cmp.commits || []).filter((c: any) => (c.parents || []).length < 2 && (c.commit?.author?.date || "") >= sinceIso)
      .map((c: any) => ({ t: first(c.commit.message), by: who(c), sha: c.sha.slice(0, 7) }));
    out.staging_merges = (cmp.commits || []).filter((c: any) => (c.parents || []).length >= 2 && (c.commit?.author?.date || "") >= sinceIso).map((c: any) => first(c.commit.message));
  } catch (e) { out.errors.push("Staging code: " + (e as Error).message); }
  const { data: mig, error } = await db.rpc("changelog_live_migrations", { p_since: sinceIso });
  if (error) out.errors.push("Live database: " + error.message); else out.db = (mig || []).map((m: any) => m.name);
  return out;
}

async function summarize(raw: any): Promise<string | null> {
  const key = await secret("anthropic_api_key"); if (!key) return null;
  const prompt = `You write a short daily change log for a small team (Becky, Brittney, Corinne) building one product: "Command Center" (internal ops app) and the client "Portal" (Opsis QA). Becky works in Live; Brittney works in Staging.
Group the changes below by where they show up. Use ONLY these labels:
- Portal tabs: "Portal · Overview", "Portal · Call reviews", "Portal · Callbacks", "Portal · Coaching Hub", "Portal · Price talk", "Portal · Reporting", "Portal · QA settings", "Portal · Phone stats", "Portal · Phone setup", "Portal · Portal settings", "Portal · Signup & getting started", "Portal · Connect your calls", "Portal · AI CSR"
- Command Center tabs: "CC · Schedule", "CC · Chat", "CC · Tasks", "CC · Hiring", "CC · Finance", "CC · Training", "CC · Knowledge Base", "CC · Sales", "CC · Speed to Lead", "CC · Integrations", "CC · Dashboard", "CC · Notifications"
- "Behind the scenes" for transcription, scoring rules, emails, database and other changes with no screen.
Only use a tab when the change clearly names it or a feature that lives there (callbacks/never-score numbers/left-out calls/info-before-price/percent scores are Portal; setup interview, locations, outcomes are Portal · Phone setup or Portal settings). If unsure, use "Behind the scenes". Plain, non-technical words, one short line per change, merge duplicates, skip trivial fix-ups. Never invent anything not in the list.
Format exactly (plain text, no markdown headers, use these labels):
LIVE (Becky)
• <Label>: <what changed>
STAGING (Brittney)
• <Label>: <what changed>
If a section has nothing, write "• Nothing new". Keep it under 25 lines total. Sort lines by label.

Live code commits: ${JSON.stringify(raw.live.map((x: any) => x.t))}
Live database changes: ${JSON.stringify(raw.db)}
Staging commits (not yet in Live): ${JSON.stringify(raw.staging.map((x: any) => x.t))}
Staging merges: ${JSON.stringify(raw.staging_merges || [])}`;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-haiku-4-5", max_tokens: 1200, messages: [{ role: "user", content: prompt }] }) });
    const j = await r.json(); if (!r.ok) return null;
    return (j.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("").trim() || null;
  } catch { return null; }
}
function rawText(raw: any) {
  const sec = (t: string, xs: string[]) => `${t}\n` + (xs.length ? xs.map((x) => `• ${x}`).join("\n") : "• Nothing new");
  return [sec("LIVE (Becky): code", raw.live.map((x: any) => x.t)), sec("LIVE (Becky): database", raw.db), sec("STAGING (Brittney)", raw.staging.map((x: any) => x.t))].join("\n\n");
}

async function run(p: any) {
  const et = etNow();
  if (!p.force && !p.dry && et.hour !== 5) return { skipped: "not 5am ET" };
  if (!p.dry && !p.force) { const { data: d } = await db.from("changelog_runs").select("day").eq("day", et.day).maybeSingle(); if (d) return { skipped: "already posted" }; }
  const hours = Math.min(Math.max(Number(p.hours) || 24, 1), 168);
  const since = new Date(Date.now() - hours * 3600e3).toISOString().replace(/\.\d+Z$/, "Z");
  const raw = await collect(since);
  const n = raw.live.length + raw.db.length + raw.staging.length + (raw.staging_merges || []).length;
  const nice = new Date(et.day + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
  let body = `📋 Change log for ${nice} (last ${hours} hours)\n\n`;
  body += n ? ((await summarize(raw)) || rawText(raw)) : "No changes in Live or Staging.";
  if ((raw.staging_merges || []).length) body += `\n\n🔀 Staging was synced with Live: ${raw.staging_merges.length} merge${raw.staging_merges.length > 1 ? "s" : ""}.`;
  if (raw.errors.length) body += `\n\n⚠️ Couldn't read: ${raw.errors.join("; ")}`;
  if (p.dry) return { body, raw };
  const { data: msg, error } = await db.from("messages").insert({ channel_id: CHANNEL, sender_id: BOT, body }).select("id").single();
  if (error) throw new Error(error.message);
  await db.from("channels").update({ last_message_at: new Date().toISOString() }).eq("id", CHANNEL);
  if (!p.force) await db.from("changelog_runs").upsert({ day: et.day, message_id: msg.id, detail: { live: raw.live.length, db: raw.db.length, staging: raw.staging.length } });
  return { posted: msg.id, changes: n };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const s = await secret("callqa_webhook_secret");
  if (!s || req.headers.get("x-callqa-secret") !== s) return json({ error: "Unauthorized" }, 401);
  let p: any = {}; try { p = await req.json(); } catch { /* empty */ }
  try { return json(await run(p)); } catch (e) { console.error(String((e as Error)?.message ?? e)); return json({ error: String((e as Error)?.message ?? e) }, 500); }
});
