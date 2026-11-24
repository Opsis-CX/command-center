// opsis-coaching-hub — the CSR Coaching Hub inside the Opsis QA portal (2026-10-21).
// Who can call it:
//   CSR logins (profiles.role = 'csr')       -> only their own hub
//   client logins (role = 'client')          -> CSRs of their client; brand-locked logins only their brand's CSRs
//   Opsis staff                              -> every CSR of the client (GarageCo by default)
// Actions (the portal sends them with a "hub" prefix: hubme, hubroster, hubhome, ...):
//   me         -> who am I (CSR boot)
//   roster     -> managers: the CSRs they look after, with this week's numbers
//   home       -> one CSR's home: focus of the week, score, streak, 4 coach-picked calls, call of the week, kudos, badges, most improved
//   wins       -> one CSR's streaks, personal bests, 8-week trend, every badge, most improved
//   focus      -> managers: set the weekly focus (op set) / list suggestions (op options)
//   swap       -> managers: replace one coaching call with the next best one
//   kudos      -> managers: send kudos (op send); op callcsr = which CSR (if any) owns a call
//   cotw       -> brand call of the week: op options / op set (managers)
//   audio      -> signed recording URL, CSRs only for their coaching calls and their brand's call of the week
//   ask        -> AI coach chat: mode "score" (why my calls scored that way) or "brand" (how my brand does it)
//   reviewreq  -> CSR asks their manager to review a score (op create); managers close it (op done)
//   people     -> managers: who's on the roster (hub_people): op list candidates for a brand / add / remove
//   questions  -> managers: what CSRs asked the coach (topics, CSRs, playbook gaps); op themes = AI summary; op flagdone
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GARAGECO = "c7c50cda-92a6-4665-baa3-3e207f853326";
const STAFF_ROLES = ["owner", "admin", "asc", "certification", "quality", "marketing", "support"];
const MODEL = Deno.env.get("QA_ASK_MODEL") || "claude-sonnet-4-6";
const AUDIO_TTL = 3600;

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const db = createClient(SB_URL, SERVICE_KEY, { auth: { persistSession: false } });
class HttpErr extends Error { status: number; constructor(s: number, m: string) { super(m); this.status = s; } }
const deny = (m = "You don't have access to that.") => new HttpErr(403, m);
const str = (v: unknown, n = 120) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
const isId = (v: unknown) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
async function rpc(fn: string, args: Record<string, unknown>) { const { data, error } = await db.rpc(fn, args); if (error) throw new Error(error.message); return data; }

// ---------- dates (America/New_York, weeks start Monday) ----------
function todayET() { return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }); }
function addDays(d: string, n: number) { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
function monday(d: string) { const x = new Date(d + "T12:00:00Z"); const dow = (x.getUTCDay() + 6) % 7; return addDays(d, -dow); }
// The week a manager picked (any Monday in the last 26 weeks), else this week. 2026-10-26.
function pickWeek(p: any) { const cur = monday(todayET()); const w = typeof p?.week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.week) ? monday(p.week) : cur; return w > cur || w < addDays(cur, -182) ? cur : w; }
const fmtDay = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// ---------- who is asking ----------
type Ctx = { uid: string; name: string; kind: "csr" | "admin" | "manager" | "viewer" | "staff"; client: string; lock: string | null };
async function context(req: Request, p: any): Promise<Ctx> {
  const asUser = req.headers.get("x-as-user"), secretHdr = req.headers.get("x-callqa-secret");
  let uid: string;
  if (asUser && secretHdr) {
    const { data: sec } = await db.from("integration_secrets").select("value").eq("key", "callqa_webhook_secret").maybeSingle();
    if (!sec?.value || secretHdr !== sec.value || !isId(asUser)) throw new HttpErr(401, "Please sign in again.");
    uid = asUser;
  } else {
    const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!bearer) throw new HttpErr(401, "Please sign in again.");
    const { data: u } = await db.auth.getUser(bearer);
    if (!u?.user) throw new HttpErr(401, "Please sign in again.");
    uid = u.user.id;
  }
  const { data: prof } = await db.from("profiles").select("full_name, email, role, is_admin, is_active, client_id, portal_brand, portal_role").eq("id", uid).maybeSingle();
  if (!prof || prof.is_active === false) throw deny();
  const role = String(prof.role || "").trim().toLowerCase();
  const name = prof.full_name || prof.email || "Someone";
  if (role === "csr") { if (!prof.client_id) throw deny(); return { uid, name, kind: "csr", client: prof.client_id, lock: prof.portal_brand || null }; }
  if (prof.is_admin || STAFF_ROLES.includes(role)) return { uid, name, kind: "staff", client: isId(p?.client_id) ? p.client_id : GARAGECO, lock: null };
  if (role === "client" && prof.client_id) {
    const lock = prof.portal_brand || null;
    const kind = prof.portal_role === "admin" && !lock ? "admin" : prof.portal_role === "viewer" ? "viewer" : "manager";
    return { uid, name, kind, client: prof.client_id, lock };
  }
  throw deny();
}
const isMgr = (C: Ctx) => C.kind === "admin" || C.kind === "manager" || C.kind === "staff";
const needMgr = (C: Ctx) => { if (!isMgr(C)) throw deny("Only managers and account admins can do that."); };

type Csr = { id: string; full_name: string; portal_brand: string | null; client_id: string; ls_user_ids: string[] | null; profile_id: string | null };
// Every CSR lives in hub_people (login CSRs keep their profile id; others come from the call data or were added by an admin).
async function csrFor(C: Ctx, p: any): Promise<Csr> {
  const id = C.kind === "csr" ? C.uid : (isId(p?.csr) ? p.csr : null);
  if (!id) throw new HttpErr(400, "Pick a CSR.");
  const { data: h } = await db.from("hub_people").select("id, name, brand, client_id, ls_user_ids, profile_id, active").eq("id", id).maybeSingle();
  if (h) {
    const x: any = h;
    if (x.client_id !== C.client || (C.lock && x.brand !== C.lock) || (C.kind !== "csr" && !x.active)) throw new HttpErr(404, "CSR not found.");
    return { id: x.id, full_name: x.name, portal_brand: x.brand, client_id: x.client_id, ls_user_ids: x.ls_user_ids, profile_id: x.profile_id };
  }
  const { data } = await db.from("profiles").select("id, full_name, email, portal_brand, client_id, ls_user_ids, role, is_active").eq("id", id).maybeSingle();
  const c: any = data;
  if (!c || String(c.role).toLowerCase() !== "csr" || c.client_id !== C.client || (C.lock && c.portal_brand !== C.lock)) throw new HttpErr(404, "CSR not found.");
  if (C.kind !== "csr" && c.is_active === false) throw new HttpErr(404, "CSR not found.");
  return { id: c.id, full_name: c.full_name || c.email, portal_brand: c.portal_brand, client_id: c.client_id, ls_user_ids: c.ls_user_ids, profile_id: c.id };
}
async function brandCsrs(client: string, brand: string | null) {
  let q = db.from("hub_people").select("id, name, brand, profile_id, source").eq("client_id", client).eq("active", true);
  if (brand) q = q.eq("brand", brand);
  const { data } = await q; return ((data || []) as any[]).map((c) => ({ id: c.id, full_name: c.name, portal_brand: c.brand, profile_id: c.profile_id, source: c.source }));
}
const firstName = (n: string) => String(n || "").trim().split(/\s+/)[0] || "there";
const shortName = (n: string) => { const p = String(n || "").trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : (p[0] || "CSR"); };
const shortBrand = (b: string | null) => String(b || "").replace(/\s+(Overhead Door|Garage Doors?|Door|Doors)$/i, "").trim() || String(b || "");

// ---------- the 5-step call flow (older reviews use the retired 11 steps) ----------
const STEPS: Record<string, { label: string; pts: number; old: string[]; title: string; say: string; tip: string }> = {
  introduce: { label: "Introduce", pts: 10, old: ["greeting"], title: "Open with the brand and your name", say: "Thank you for calling {brand}, this is {name}. How can I help you today?", tip: "Say the brand and your name in the first breath, every call." },
  listen: { label: "Listen", pts: 15, old: ["empathy"], title: "Let them finish, then repeat it back", say: "So the door {problem}, and it started {when}. Did I get that right?", tip: "Let the caller finish, then repeat the problem back in one sentence." },
  collect_info: { label: "Collect info", pts: 15, old: ["discovery", "verify_approver"], title: "Get the details before the price", say: "Happy to help with pricing. First, what is the door doing, and is this your home or a business?", tip: "Ask what the door is doing and who approves the work before talking price." },
  sell_appointment: { label: "Sell the appointment", pts: 45, old: ["ask_booking", "offer_appt"], title: "Offer two times, then ask to book", say: "Our first opening is {day1}, or I have {day2}. Which works better for you?", tip: "Offer two specific times and ask which one works." },
  confirm_thank: { label: "Confirm & thank", pts: 15, old: ["thank_close", "confirm_details"], title: "Confirm the visit and thank them", say: "You're all set for {day} between {window}. Our tech will call when they're on the way. Thanks for calling {brand}!", tip: "Repeat the day and window back, then thank them by name." },
};
const STEP_KEYS = Object.keys(STEPS);
function stepAns(r: any, key: string): string | null {
  const st = r.st || {};
  if (st[key]) return st[key];
  for (const o of STEPS[key]?.old || []) if (st[o] && st[o] !== "na") return st[o];
  for (const o of STEPS[key]?.old || []) if (st[o]) return st[o];
  return null;
}
function fill(s: string, csr: Csr) { return s.replace(/\{brand\}/g, shortBrand(csr.portal_brand)).replace(/\{name\}/g, firstName(csr.full_name)); }
function stepRate(revs: any[], key: string) {
  let done = 0, app = 0;
  for (const r of revs) {
    if (key === "sell_appointment") { if (r.opp) { app++; if (r.ab) done++; } continue; }
    const a = stepAns(r, key); if (a === "yes") { done++; app++; } else if (a === "no") app++;
  }
  return { done, app, pct: app ? Math.round(100 * done / app) : null };
}

// ---------- reviews for one CSR ----------
async function reviewsFor(csr: Csr, days = 120): Promise<any[]> {
  const from = new Date(Date.now() - days * 86400e3).toISOString();
  return (await rpc("hub_reviews", { p_csr: csr.id, p_from: from }) as any[]) || [];
}
const avg = (a: number[]) => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null;
function byWeek(revs: any[]) { const m: Record<string, any[]> = {}; for (const r of revs) (m[monday(r.d)] = m[monday(r.d)] || []).push(r); return m; }
function byDay(revs: any[]) { const m: Record<string, any[]> = {}; for (const r of revs) (m[r.d] = m[r.d] || []).push(r); return m; }

// ---------- streaks, bests, badges ----------
function streaks(revs: any[], week: string) {
  const days = byDay(revs), dk = Object.keys(days).sort();
  let cur = 0, best = 0, run = 0;
  for (const d of dk) { const a = avg(days[d].map((r) => r.score))!; run = a >= 80 ? run + 1 : 0; best = Math.max(best, run); }
  cur = run;
  let ask = 0, askBest = 0;
  for (const r of revs) if (r.opp) { ask = r.ab ? ask + 1 : 0; askBest = Math.max(askBest, ask); }
  const wk = byWeek(revs), wks = Object.keys(wk).sort().filter((w) => w < week && wk[w].length >= 3);
  let up = 0, upBest = 0;
  for (let i = 1; i < wks.length; i++) { const a = avg(wk[wks[i]].map((r) => r.score))!, b = avg(wk[wks[i - 1]].map((r) => r.score))!; up = a > b ? up + 1 : 0; upBest = Math.max(upBest, up); }
  return [
    { key: "days80", now: cur, best, unit: cur === 1 ? "day" : "days", what: "Days in a row your average was 80 or better" },
    { key: "askbook", now: ask, best: askBest, unit: ask === 1 ? "call" : "calls", what: (() => { const w = revs.filter((r) => r.d >= week && r.d < addDays(week, 7) && r.opp); const a = w.filter((r) => r.ab).length;
        return "Booking chances in a row where you asked to book (resets on a missed ask)" + (w.length ? ` · this week: asked on ${a} of ${w.length}` : ""); })() },
    { key: "weekup", now: up, best: upBest, unit: up === 1 ? "week" : "weeks", what: "Score went up week over week" },
  ];
}
function bests(revs: any[]) {
  const wk = byWeek(revs); let bw: any = null;
  for (const w of Object.keys(wk)) { if (wk[w].length < 5) continue; const a = avg(wk[w].map((r) => r.score))!; if (!bw || a > bw.v) bw = { v: a, w }; }
  let bc: any = null; for (const r of revs) if (!bc || r.score > bc.score) bc = r;
  const days = byDay(revs); let bd: any = null;
  for (const d of Object.keys(days)) { const n = days[d].filter((r) => r.outcome === "Booked").length; if (n && (!bd || n > bd.n)) bd = { n, d }; }
  let br: any = null;
  for (const w of Object.keys(wk)) { const o = wk[w].filter((r) => r.opp); if (o.length < 5) continue; const p = Math.round(100 * o.filter((r) => r.outcome === "Booked").length / o.length); if (!br || p > br.p) br = { p, w }; }
  return [
    { label: "Best week", value: bw ? String(bw.v) : "—", when: bw ? "Week of " + fmtDay(bw.w) : "Needs 5 scored calls in a week", key: "week", raw: bw?.v ?? null },
    { label: "Best call", value: bc ? String(bc.score) : "—", when: bc ? fmtDay(bc.d) : "", key: "call", raw: bc?.score ?? null },
    { label: "Most booked in a day", value: bd ? String(bd.n) : "—", when: bd ? fmtDay(bd.d) : "", key: "day", raw: bd?.n ?? null },
    { label: "Best booking rate", value: br ? br.p + "%" : "—", when: br ? "Week of " + fmtDay(br.w) : "Needs 5 booking chances in a week", key: "rate", raw: br?.p ?? null },
  ];
}
// Badge kinds the portal draws: shape + color + glyph live in the frontend; here only rules and progress.
const BADGES = [
  { key: "closer", name: "Closer", how: "Ask to book on 10 booking chances in a row", goal: 10 },
  { key: "hot5", name: "Hot streak", how: "80 or better 5 days in a row", goal: 5 },
  { key: "framer", name: "Price framer", how: "Get the details before the price on 10 calls", goal: 10 },
  { key: "discovery", name: "Detective", how: "Collect the full details on 15 calls", goal: 15 },
  { key: "card", name: "Card on file", how: "Take a card on 10 booked calls in a row", goal: 10 },
  { key: "save", name: "Save artist", how: "Book a caller who pushed back", goal: 1 },
  { key: "calm", name: "Calm in the storm", how: "Turn an upset caller around", goal: 1 },
  { key: "perfect", name: "Perfect call", how: "Score 100 on a call", goal: 1 },
  { key: "machine", name: "Booking machine", how: "Book 5 calls in one day", goal: 5 },
  { key: "cotw", name: "Call of the week", how: "Have your call picked as your brand's best", goal: 1 },
];
// Each earned badge remembers the call that earned it (the call that reached the goal; for day badges the best call that day).
function badges(revs: any[], cotwCount: number, cotwDate: string | null, cotwRid: string | null = null) {
  const got: Record<string, { at: string | null; n: number; rid: string | null }> = {};
  const hit = (k: string, n: number, d: string, rid: string | null) => { const b = BADGES.find((x) => x.key === k)!; const g = got[k] = got[k] || { at: null, n: 0, rid: null }; g.n = Math.max(g.n, n); if (!g.at && n >= b.goal) { g.at = d; g.rid = rid; } };
  let ask = 0, framer = 0, disc = 0, card = 0, dayRun = 0;
  for (const r of revs) {
    if (r.opp) { ask = r.ab ? ask + 1 : 0; hit("closer", ask, r.d, r.id); }
    if (r.ibp === "yes") { framer++; hit("framer", framer, r.d, r.id); }
    if (stepAns(r, "collect_info") === "yes") { disc++; hit("discovery", disc, r.d, r.id); }
    if (r.outcome === "Booked") { card = r.acc ? card + 1 : 0; hit("card", card, r.d, r.id); }
    if (r.outcome === "Booked" && r.obj > 0) hit("save", 1, r.d, r.id);
    if (r.upset && (r.outcome === "Booked" || r.score >= 80)) hit("calm", 1, r.d, r.id);
    if (r.score >= 100) hit("perfect", 1, r.d, r.id);
  }
  const days = byDay(revs);
  for (const d of Object.keys(days).sort()) {
    const a = avg(days[d].map((r) => r.score))!; dayRun = a >= 80 ? dayRun + 1 : 0;
    const best = days[d].slice().sort((x, y) => y.score - x.score)[0];
    hit("hot5", dayRun, d, best?.id || null);
    const bk = days[d].filter((r) => r.outcome === "Booked");
    hit("machine", bk.length, d, (bk.slice().sort((x, y) => y.score - x.score)[0] || best)?.id || null);
  }
  if (cotwCount) hit("cotw", 1, cotwDate || todayET(), cotwRid);
  // current progress for locked badges = the current run (streak badges) or the running total
  const cur: Record<string, number> = { closer: ask, card, hot5: dayRun, framer, discovery: disc };
  return BADGES.map((b) => {
    const g = got[b.key]; const earned = !!g?.at;
    const now = cur[b.key] ?? (g?.n || 0);
    return { key: b.key, name: b.name, how: b.how, earned, at: g?.at || null, review_id: earned ? g!.rid : null, when: earned ? "Earned " + fmtDay(g!.at!) : null, progress: earned ? b.goal : Math.min(now, b.goal), goal: b.goal };
  });
}

// ---------- weekly focus ----------
async function focusFor(csr: Csr, week: string, revs: any[], create: boolean) {
  const { data: row } = await db.from("csr_weekly_focus").select("id, step_key, title, body, goal, say, goal_pct, auto, created_by, updated_at").eq("csr_id", csr.id).eq("week_start", week).maybeSingle();
  let f: any = row;
  const recent = revs.filter((r) => r.d >= addDays(week, -14) && r.d < week);
  const pool = recent.length >= 6 ? recent : revs.filter((r) => r.d >= addDays(week, -28));
  if (!f && create) {
    let pick = "sell_appointment", worst = 999;
    for (const k of STEP_KEYS) { const s = stepRate(pool, k); if (s.app >= 4 && s.pct! + (k === "sell_appointment" ? -5 : 0) < worst) { worst = s.pct! + (k === "sell_appointment" ? -5 : 0); pick = k; } }
    const s = stepRate(pool, pick), S0 = STEPS[pick];
    const body = s.app ? (pick === "sell_appointment" ? `In the last two weeks you asked for the booking on ${s.done} of ${s.app} booking chances.` : `In the last two weeks you got "${S0.label}" on ${s.done} of ${s.app} calls.`) + " This week, make it a habit." : "This is the step that wins the most bookings.";
    const ins = { csr_id: csr.id, week_start: week, step_key: pick, title: S0.title, body, say: fill(S0.say, csr), goal_pct: 80, auto: true };
    const { data: made } = await db.from("csr_weekly_focus").insert(ins).select("id, step_key, title, body, goal, say, goal_pct, auto, created_by, updated_at").maybeSingle();
    f = made || ins;
  }
  if (!f) return null;
  const cap = f.step_key === "capture_payment" || /capture payment|card on file/i.test(String(f.title || ""));
  const key = cap ? "sell_appointment" : STEPS[f.step_key] ? f.step_key : (STEP_KEYS.find((k) => STEPS[k].old.includes(f.step_key)) || null);
  const wk = revs.filter((r) => r.d >= week);
  const bk = wk.filter((r) => r.outcome === "Booked");
  const prog = cap ? { done: bk.filter((r) => r.acc).length, app: bk.length } : key ? stepRate(wk, key) : null;
  let setBy: string | null = null;
  if (f.created_by) { const { data: pb } = await db.from("profiles").select("full_name").eq("id", f.created_by).maybeSingle(); setBy = (pb as any)?.full_name || null; }
  const legacy = /^\s*(mon|tue|wed|thu|fri|sat|sun)\w*\s+\d{1,2}\/\d{1,2}\b/i.test(String(f.body || ""));
  const body = legacy ? (cap ? "Once they pick a time, ask for a card to hold it. Short and simple." : null) : f.body;
  const say = (cap && (!f.say || legacy)) ? "Which credit card would you like to put on file?" : (f.say || (key ? fill(STEPS[key].say, csr) : null));
  return { step_key: key, step_label: key ? STEPS[key].label : null, title: f.title, body, say, goal_pct: f.goal_pct || 80, auto: !!f.auto, set_by: setBy,
    done: prog?.done ?? null, of: prog?.app ?? null, metric: cap ? "Took a card on booked calls" : key === "sell_appointment" ? "Asked to book" : (key ? `${STEPS[key].label} done` : null) };
}
function focusOptions(csr: Csr, week: string, revs: any[]) {
  const pool = revs.filter((r) => r.d >= addDays(week, -14) && r.d < week);
  return STEP_KEYS.map((k) => { const s = stepRate(pool, k); return { step_key: k, label: STEPS[k].label, title: STEPS[k].title, say: fill(STEPS[k].say, csr), done: s.done, of: s.app, pct: s.pct }; })
    .sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101));
}

// ---------- coaching calls (2 great, 2 to grow) ----------
const TOPIC_NICE = (t: string | null) => { if (!t) return "Call"; const m = t.match(/^Repair - (.+)$/i); if (m) return m[1].replace(/\/.*/, "") + " repair"; if (/^New Door/i.test(t)) return "New door quote"; return t.replace(/\s*\/.*$/, ""); };
function firstSentence(s: string | null, n = 180) { const t = String(s || "").trim(); if (!t) return ""; const m = t.match(/^(.{20,}?[.!?])(\s|$)/); const x = m ? m[1] : t; return x.length > n ? x.slice(0, n - 1).trimEnd() + "…" : x; }
function scrubName(t: string, nm: string) { let x = String(t || ""); const n = String(nm || "").trim(); if (n.length > 2) for (const part of [n, ...n.split(/\s+/).filter((y) => y.length > 2)]) x = x.split(part).join("the customer"); return x; }
async function reviewInfo(ids: string[]) {
  if (!ids.length) return {} as Record<string, any>;
  const { data } = await db.from("ai_qa_reviews").select("id, summary, strengths, improvements, coaching_note, revenue_tip, topics, objections, outcome, score_pct, answers, call:ai_qa_calls!inner(call_started_at, duration_seconds, customer_name, agent_name, brand)").in("id", ids);
  const out: Record<string, any> = {}; for (const r of data || []) out[(r as any).id] = r; return out;
}
function missedSteps(answers: any) {
  const out: string[] = [];
  for (const k of STEP_KEYS) { const a = answers?.[k]?.answer ?? STEPS[k].old.map((o) => answers?.[o]?.answer).find((x) => x === "no"); if (a === "no") out.push(STEPS[k].label); }
  return out;
}
const cleanTag = (t: string | null) => String(t || "").replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+/g, " ").trim();
function pickText(kind: string, info: any, focusKey: string | null) {
  const nm = info?.call?.customer_name || "";
  const missed = missedSteps(info?.answers);
  if (kind === "good") {
    const why = scrubName(firstSentence(info?.summary, 200), nm);
    const step = cleanTag((info?.strengths || [])[0]) || (focusKey && !missed.includes(STEPS[focusKey].label) ? STEPS[focusKey].label : "Great call");
    return { why, tip: null, step_label: step.slice(0, 60) };
  }
  const why = scrubName(firstSentence(info?.coaching_note || info?.summary, 220), nm);
  const mk = focusKey && missed.includes(STEPS[focusKey].label) ? focusKey : STEP_KEYS.find((k) => missed.includes(STEPS[k].label)) || null;
  const step = cleanTag((info?.improvements || [])[0]) || (mk ? STEPS[mk].label : "Room to grow");
  const tip = mk ? STEPS[mk].tip : (scrubName(firstSentence(info?.revenue_tip, 200), nm) || null);
  return { why, tip, step_label: step.slice(0, 60) };
}
function candidates(revs: any[], week: string, kind: string, focusKey: string | null, skip: Set<string>) {
  let pool = revs.filter((r) => r.d >= addDays(week, -14) && r.d < week && r.secs >= 60 && r.secs <= 700 && r.opp && !skip.has(r.id));
  if (pool.length < 4) pool = revs.filter((r) => r.d >= addDays(week, -28) && r.secs >= 60 && r.secs <= 700 && r.opp && !skip.has(r.id));
  if (kind === "good") return pool.filter((r) => r.score >= 85).sort((a, b) => (b.outcome === "Booked" ? 1 : 0) - (a.outcome === "Booked" ? 1 : 0) || b.score - a.score || (b.d > a.d ? 1 : -1));
  const missF = (r: any) => focusKey ? (focusKey === "sell_appointment" ? (r.opp && !r.ab) : stepAns(r, focusKey) === "no") : false;
  return pool.filter((r) => r.score < 80 && (r.outcome !== "Booked" || missF(r))).sort((a, b) => (missF(b) ? 1 : 0) - (missF(a) ? 1 : 0) || a.score - b.score);
}
// Where in the call the step this pick is about happens (2026-10-27, Kerri): the first [m:ss] in that step's evidence.
const SUBS: Record<string, string[]> = { sell_appointment: ["sell_ask", "sell_offer", "sell_objection", "sell_card", "sell_expert", "sell_appointment", "ask_booking", "offer_appt"] };
function stepMoment(answers: any, kind: string, stepLabel: string | null, focusKey: string | null) {
  if (!answers || typeof answers !== "object") return null;
  let key = STEP_KEYS.find((k) => STEPS[k].label === stepLabel) || focusKey || null;
  const tsOf = (k: string) => { const ev = String(answers?.[k]?.evidence || ""); const m = ev.match(/\[(\d{1,2}):(\d{2})\]/); return m ? { k, at: Number(m[1]) * 60 + Number(m[2]) } : null; };
  const want = kind === "good" ? "yes" : "no";
  const keysFor = (k: string) => [k, ...(STEPS[k]?.old || []), ...(SUBS[k] || [])];
  if (!key && kind !== "good") key = STEP_KEYS.find((k) => keysFor(k).some((x) => answers?.[x]?.answer === "no")) || null;
  if (!key) return null;
  for (const k of keysFor(key)) if (answers?.[k]?.answer === want) { const t = tsOf(k); if (t) return { at: t.at, step: STEPS[key]?.label || key }; }
  for (const k of keysFor(key)) { const t = tsOf(k); if (t) return { at: t.at, step: STEPS[key]?.label || key }; }
  return null;
}
async function picksFor(C: Ctx, csr: Csr, week: string, revs: any[], focusKey: string | null, create: boolean) {
  let { data: rows } = await db.from("csr_hub_picks").select("id, review_id, kind, why, tip, step_label, picked_by_name, created_at").eq("csr_id", csr.id).eq("week_start", week).order("created_at");
  if ((!rows || !rows.length) && create) {
    const skip = new Set<string>();
    const good = candidates(revs, week, "good", focusKey, skip).slice(0, 2); good.forEach((r) => skip.add(r.id));
    const grow = candidates(revs, week, "grow", focusKey, skip).slice(0, 2);
    const info = await reviewInfo([...good, ...grow].map((r) => r.id));
    const ins = [...good.map((r) => ({ r, kind: "good" })), ...grow.map((r) => ({ r, kind: "grow" }))].map(({ r, kind }) => ({ csr_id: csr.id, week_start: week, review_id: r.id, kind, ...pickText(kind, info[r.id], focusKey) }));
    if (ins.length) await db.from("csr_hub_picks").upsert(ins, { onConflict: "csr_id,week_start,review_id", ignoreDuplicates: true });
    ({ data: rows } = await db.from("csr_hub_picks").select("id, review_id, kind, why, tip, step_label, picked_by_name, created_at").eq("csr_id", csr.id).eq("week_start", week).order("created_at"));
  }
  const info = await reviewInfo((rows || []).map((r: any) => r.review_id));
  return (rows || []).map((p: any) => { const i = info[p.review_id] || {}; return {
    id: p.id, review_id: p.review_id, kind: p.kind, why: p.why, tip: p.tip, step_label: p.step_label, by: p.picked_by_name || null,
    title: (i.outcome === "Booked" ? "Booked · " : i.outcome === "Not Booked" ? "Not booked · " : "") + TOPIC_NICE((i.topics || [])[0] || null),
    date: i.call?.call_started_at || null, secs: i.call?.duration_seconds || null, score: i.score_pct == null ? null : Math.round(Number(i.score_pct)),
    moment: stepMoment(i.answers, p.kind, p.step_label, focusKey) }; });
}

// ---------- brand call of the week ----------
async function cotwFor(C: Ctx, brand: string | null, week: string, create: boolean) {
  if (!brand) return null;
  let { data: row } = await db.from("qa_call_of_week").select("id, review_id, csr_id, agent, why, picked_by_name, week_start").eq("client_id", C.client).eq("brand", brand).eq("week_start", week).maybeSingle();
  if (!row && create) {
    const opts = await cotwOptions(C, brand, week, 1);
    if (opts.length) {
      const o = opts[0];
      await db.from("qa_call_of_week").upsert({ client_id: C.client, brand, week_start: week, review_id: o.review_id, csr_id: o.csr_id, agent: o.agent, why: o.why }, { onConflict: "client_id,brand,week_start", ignoreDuplicates: true });
      ({ data: row } = await db.from("qa_call_of_week").select("id, review_id, csr_id, agent, why, picked_by_name, week_start").eq("client_id", C.client).eq("brand", brand).eq("week_start", week).maybeSingle());
    }
  }
  if (!row) return null;
  const info = (await reviewInfo([(row as any).review_id]))[(row as any).review_id] || {};
  let agent = (row as any).agent;
  if ((row as any).csr_id) { const { data: pr } = await db.from("hub_people").select("name").eq("id", (row as any).csr_id).maybeSingle(); if ((pr as any)?.name) agent = (pr as any).name; }
  return { review_id: (row as any).review_id, agent: shortName(agent || "A teammate"), csr_id: (row as any).csr_id, why: (row as any).why, by: (row as any).picked_by_name || null,
    date: info.call?.call_started_at || null, secs: info.call?.duration_seconds || null, score: info.score_pct == null ? null : Math.round(Number(info.score_pct)),
    title: (info.outcome === "Booked" ? "Booked · " : "") + TOPIC_NICE((info.topics || [])[0] || null), saved: Array.isArray(info.objections) && info.objections.length > 0 };
}
async function cotwOptions(C: Ctx, brand: string, week: string, limit = 6) {
  const from = addDays(week, -7), to = addDays(week, -1);
  const { data: nom } = await db.from("csr_kudos").select("review_id").eq("client_id", C.client).eq("nominate", true).gte("created_at", from + "T00:00:00Z").not("review_id", "is", null);
  const nominated = new Set((nom || []).map((n: any) => n.review_id));
  const { data } = await db.from("ai_qa_fact").select("review_id, call_id, agent, score_pct, duration_seconds, objections, topics, outcome")
    .eq("client_id", C.client).eq("brand", brand).gte("call_date", from).lte("call_date", to).eq("outcome", "Booked").eq("excluded", false)
    .or("call_class.is.null,call_class.eq.conversation").gte("duration_seconds", 120).lte("duration_seconds", 600).gte("score_pct", 85)
    .neq("source", C.client === "9726e6eb-1364-4dba-8ddb-10c07a408ecb" ? "__none__" : "five9").not("agent", "in", "(Dane,Sophia,Jason)").order("score_pct", { ascending: false }).limit(60);
  const rows = (data || []).sort((a: any, b: any) => (nominated.has(b.review_id) ? 1 : 0) - (nominated.has(a.review_id) ? 1 : 0) || Number(b.score_pct) - Number(a.score_pct) || (b.objections?.length || 0) - (a.objections?.length || 0)).slice(0, limit);
  const info = await reviewInfo(rows.map((r: any) => r.review_id));
  const out: any[] = [];
  for (const r of rows as any[]) {
    let csrId: string | null = null; try { csrId = await rpc("hub_person_of_call", { p_call: r.call_id }) as any; } catch { /* none */ }
    const i = info[r.review_id] || {};
    const why = scrubName(firstSentence(i.summary, 220), i.call?.customer_name || "");
    out.push({ review_id: r.review_id, agent: r.agent, csr_id: isId(csrId) ? csrId : null, score: Math.round(Number(r.score_pct)), secs: r.duration_seconds, why, nominated: nominated.has(r.review_id), title: "Booked · " + TOPIC_NICE((r.topics || [])[0] || null) });
  }
  return out;
}

// ---------- kudos ----------
async function kudosFor(csr: Csr, markSeen: boolean) {
  const { data } = await db.from("csr_kudos").select("id, review_id, tag, body, from_name, created_at, seen_at").eq("csr_id", csr.id).order("created_at", { ascending: false }).limit(8);
  const rows = (data || []).map((k: any) => ({ id: k.id, review_id: k.review_id, tag: k.tag, body: k.body, from: k.from_name, at: k.created_at, isNew: !k.seen_at }));
  if (markSeen && rows.some((r) => r.isNew)) await db.from("csr_kudos").update({ seen_at: new Date().toISOString() }).eq("csr_id", csr.id).is("seen_at", null);
  return rows;
}

// ---------- most improved (brand) ----------
async function improvedFor(C: Ctx, csr: Csr, week: string) {
  const peers = await brandCsrs(C.client, csr.portal_brand);
  if (!peers.length) return [];
  const st: any = await rpc("hub_roster_stats", { p_ids: peers.map((p) => p.id), p_week: week }) || {};
  const ranked = peers.map((p) => { const s = st[p.id] || {}; const ok = s.r4_n >= 5 && s.p4_n >= 5; return { id: p.id, name: p.id === csr.id && C.kind === "csr" ? "You" : shortName(p.full_name), gain: ok ? Math.round((Number(s.r4_avg) - Number(s.p4_avg)) * 10) / 10 : null, me: p.id === csr.id }; })
    .filter((r) => r.gain != null).sort((a, b) => (b.gain as number) - (a.gain as number)).map((r, i) => ({ ...r, rank: i + 1 }));
  const top = ranked.slice(0, 3); const mine = ranked.find((r) => r.me);
  if (mine && !top.includes(mine)) top.push(mine);
  return top;
}

// ---------- pages ----------
async function home(C: Ctx, p: any) {
  const csr = await csrFor(C, p), week = pickWeek(p), isNow = week === monday(todayET());
  const revs0 = await reviewsFor(csr, isNow ? 120 : Math.min(300, 120 + Math.round((Date.parse(monday(todayET())) - Date.parse(week)) / 86400e3)));
  const revs = isNow ? revs0 : revs0.filter((r: any) => r.d < addDays(week, 7));
  const focus = await focusFor(csr, week, revs, isNow);
  const [picks, cotw, kudos, improved, cw, reqs] = await Promise.all([
    picksFor(C, csr, week, revs, focus?.step_key || null, isNow),
    cotwFor(C, csr.portal_brand, week, isNow),
    kudosFor(csr, C.kind === "csr"),
    improvedFor(C, csr, week),
    db.from("qa_call_of_week").select("week_start, review_id", { count: "exact" }).eq("csr_id", csr.id).order("week_start", { ascending: true }).limit(1),
    isMgr(C) ? db.from("qa_portal_log").select("id, ref, detail, at").eq("client_id", C.client).eq("kind", "csr_review_request").order("at", { ascending: false }).limit(40) : Promise.resolve({ data: [] } as any),
  ]);
  const wk = byWeek(revs), thisW = wk[week] || [], lastW = wk[addDays(week, -7)] || [];
  const st = streaks(revs, week), pb = bests(revs);
  const bd = badges(revs, (cw as any).count || 0, ((cw as any).data || [])[0]?.week_start || null, ((cw as any).data || [])[0]?.review_id || null);
  const earned = bd.filter((b) => b.earned).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const next = bd.filter((b) => !b.earned && b.goal > 1).sort((a, b) => b.progress / b.goal - a.progress / a.goal)[0] || null;
  const score = avg(thisW.map((r) => r.score)), last = avg(lastW.map((r) => r.score));
  const opps = thisW.filter((r) => r.opp), booked = opps.filter((r) => r.outcome === "Booked").length;
  const recentQs = isMgr(C) ? ((await db.from("hub_questions").select("id, mode, topic, question, created_at, asker_kind").eq("csr_id", csr.id).order("created_at", { ascending: false }).limit(5)).data || []) : [];
  const requests = ((reqs as any).data || []).map((r: any) => ({ id: r.id, review_id: r.ref, at: r.at, ...r.detail })).filter((r: any) => r.status === "pending" && r.csr_id === csr.id);
  return {
    csr: { id: csr.id, name: csr.full_name, first: firstName(csr.full_name), brand: csr.portal_brand, brand_short: shortBrand(csr.portal_brand) },
    viewer: C.kind, can_manage: isMgr(C) && isNow, past: !isNow, week, week_label: "Week of " + fmtDay(week),
    calls: thisW.slice().reverse().slice(0, 60).map((r: any) => ({ id: r.id, d: r.d, score: r.score, outcome: r.outcome, opp: !!r.opp, ab: !!r.ab })),
    focus, focus_options: isMgr(C) ? focusOptions(csr, week, revs) : undefined,
    score: { now: score, n: thisW.length, last, delta: score != null && last != null ? score - last : null, best_week: pb[0].raw, booked, opps: opps.length },
    streak: st[0], streaks: st, picks, cotw, kudos, improved,
    badges: { earned: earned.slice(0, 3), total: earned.length, next }, requests,
    questions: isMgr(C) ? recentQs.map((q: any) => ({ id: q.id, mode: q.mode, topic: q.topic, question: q.question, at: q.created_at, by_manager: q.asker_kind !== "csr" })) : undefined,
  };
}
async function wins(C: Ctx, p: any) {
  const csr = await csrFor(C, p), week = pickWeek(p), isNow = week === monday(todayET());
  const revs0 = await reviewsFor(csr, 180 + Math.round((Date.parse(monday(todayET())) - Date.parse(week)) / 86400e3));
  const revs = isNow ? revs0 : revs0.filter((r: any) => r.d < addDays(week, 7));
  const { data: cw, count } = await db.from("qa_call_of_week").select("week_start, review_id", { count: "exact" }).eq("csr_id", csr.id).order("week_start", { ascending: true }).limit(1);
  const wk = byWeek(revs);
  const trend = []; for (let i = 7; i >= 0; i--) { const w = addDays(week, -7 * i); const rs = wk[w] || []; trend.push({ week: w, label: fmtDay(w), avg: avg(rs.map((r) => r.score)), n: rs.length }); }
  const bd = badges(revs, count || 0, (cw || [])[0]?.week_start || null, (cw || [])[0]?.review_id || null);
  return { csr: { id: csr.id, name: csr.full_name, first: firstName(csr.full_name), brand_short: shortBrand(csr.portal_brand) }, viewer: C.kind,
    streaks: streaks(revs, week), bests: bests(revs), trend, badges: bd, earned: bd.filter((b) => b.earned).length, improved: await improvedFor(C, csr, week) };
}
async function roster(C: Ctx, p: any = {}) {
  needMgr(C);
  const csrs = await brandCsrs(C.client, C.lock);
  const week = pickWeek(p);
  if (!csrs.length) return { rows: [], week };
  const ids = csrs.map((c) => c.id);
  const [st, foc, kud, req] = await Promise.all([
    rpc("hub_roster_stats", { p_ids: ids, p_week: week }),
    db.from("csr_weekly_focus").select("csr_id, title").in("csr_id", ids).eq("week_start", week),
    db.from("csr_kudos").select("csr_id").in("csr_id", ids).gte("created_at", new Date(Date.now() - 7 * 86400e3).toISOString()),
    db.from("qa_portal_log").select("detail").eq("client_id", C.client).eq("kind", "csr_review_request").order("at", { ascending: false }).limit(200),
  ]);
  const S: any = st || {}, F: Record<string, string> = {}, K: Record<string, number> = {}, R: Record<string, number> = {};
  for (const f of (foc as any).data || []) F[f.csr_id] = f.title;
  for (const k of (kud as any).data || []) K[k.csr_id] = (K[k.csr_id] || 0) + 1;
  for (const r of (req as any).data || []) if (r.detail?.status === "pending" && r.detail?.csr_id) R[r.detail.csr_id] = (R[r.detail.csr_id] || 0) + 1;
  const rows = csrs.map((c) => { const s = S[c.id] || {}; return { id: c.id, name: c.full_name, brand: c.portal_brand, brand_short: shortBrand(c.portal_brand), has_login: !!c.profile_id,
    score: s.wk_avg ?? null, n: s.wk_n || 0, last: s.lw_avg ?? null, booked: s.wk_booked || 0, opps: s.wk_opps || 0,
    gain: s.r4_n >= 5 && s.p4_n >= 5 ? Math.round((Number(s.r4_avg) - Number(s.p4_avg)) * 10) / 10 : null, focus: F[c.id] || null, kudos: K[c.id] || 0, requests: R[c.id] || 0 }; })
    .sort((a, b) => String(a.brand).localeCompare(String(b.brand)) || a.name.localeCompare(b.name));
  return { rows, week, week_label: "Week of " + fmtDay(week) };
}

// ---------- manager actions ----------
async function setFocus(C: Ctx, p: any) {
  needMgr(C);
  const csr = await csrFor(C, p), week = monday(todayET());
  if (p?.op === "options") return { options: focusOptions(csr, week, await reviewsFor(csr, 60)) };
  const key = STEPS[p?.step_key] ? p.step_key : null;
  const title = str(p?.title, 140) || (key ? STEPS[key].title : null);
  if (!title) throw new HttpErr(400, "Add a focus.");
  const goal = Math.round(Number(p?.goal_pct)); const row = { csr_id: csr.id, week_start: week, step_key: key, title, body: str(p?.body, 600), say: str(p?.say, 400), goal_pct: goal >= 10 && goal <= 100 ? goal : 80, auto: false, created_by: C.uid, updated_at: new Date().toISOString() };
  const { data: old } = await db.from("csr_weekly_focus").select("id").eq("csr_id", csr.id).eq("week_start", week).maybeSingle();
  const { error } = old ? await db.from("csr_weekly_focus").update(row).eq("id", (old as any).id) : await db.from("csr_weekly_focus").insert(row);
  if (error) throw new Error(error.message);
  await db.from("qa_portal_log").insert({ client_id: C.client, actor_id: C.uid, actor_name: C.name, kind: "csr_focus", ref: csr.id, detail: { week, title, step_key: key } });
  return { ok: true };
}
async function swapPick(C: Ctx, p: any) {
  needMgr(C);
  const csr = await csrFor(C, p), week = monday(todayET());
  const { data: pk } = await db.from("csr_hub_picks").select("id, review_id, kind").eq("csr_id", csr.id).eq("week_start", week).eq("id", str(p?.pick, 40) || "").maybeSingle();
  if (!pk) throw new HttpErr(404, "That call isn't on this week's list.");
  const revs = await reviewsFor(csr, 60);
  const { data: all } = await db.from("csr_hub_picks").select("review_id").eq("csr_id", csr.id).gte("week_start", addDays(week, -28));
  const skip = new Set((all || []).map((r: any) => r.review_id));
  const { data: f } = await db.from("csr_weekly_focus").select("step_key").eq("csr_id", csr.id).eq("week_start", week).maybeSingle();
  const fk = STEPS[(f as any)?.step_key] ? (f as any).step_key : null;
  let next: any = null;
  if (isId(p?.review_id)) next = revs.find((r) => r.id === p.review_id);
  else next = candidates(revs, week, (pk as any).kind, fk, skip)[0];
  if (!next) throw new HttpErr(404, "There isn't another good call to swap in right now.");
  const info = await reviewInfo([next.id]);
  const t = pickText((pk as any).kind, info[next.id], fk);
  const { error } = await db.from("csr_hub_picks").update({ review_id: next.id, ...t, picked_by: C.uid, picked_by_name: C.name, created_at: new Date().toISOString() }).eq("id", (pk as any).id);
  if (error) throw new Error(error.message);
  return { ok: true };
}
async function kudos(C: Ctx, p: any) {
  if (p?.op === "callcsr") {
    needMgr(C);
    if (!isId(p?.id)) throw new HttpErr(400, "Pick a call.");
    const { data: r } = await db.from("ai_qa_reviews").select("call_id, call:ai_qa_calls!inner(client_id, brand)").eq("id", p.id).maybeSingle();
    const c: any = (r as any)?.call; if (!r || !c || c.client_id !== C.client || (C.lock && c.brand !== C.lock)) return { csr: null };
    let id: any = null; try { id = await rpc("hub_person_of_call", { p_call: (r as any).call_id }); } catch { /* none */ }
    if (!isId(id)) return { csr: null };
    const { data: pr } = await db.from("hub_people").select("id, name, brand, active").eq("id", id).maybeSingle();
    return { csr: pr && (pr as any).active ? { id: (pr as any).id, name: (pr as any).name, brand: (pr as any).brand } : null };
  }
  needMgr(C);
  const csr = await csrFor(C, p);
  const body = str(p?.body, 600), tag = str(p?.tag, 60);
  if (!body && !tag) throw new HttpErr(400, "Pick a quick note or write one.");
  const rid = isId(p?.review_id) ? p.review_id : null;
  const { error } = await db.from("csr_kudos").insert({ client_id: C.client, csr_id: csr.id, review_id: rid, tag, body, nominate: p?.nominate === true && !!rid, from_id: C.uid, from_name: C.name });
  if (error) throw new Error(error.message);
  if (csr.profile_id) await db.from("notifications").insert({ recipient_id: csr.profile_id, type: "csr_kudos", title: `${C.name} sent you kudos`, body: (tag ? tag + (body ? ": " : "") : "") + (body || ""), link: "/", actor_id: C.uid, actor_name: C.name });
  return { ok: true };
}
async function cotw(C: Ctx, p: any) {
  needMgr(C);
  const brand = C.lock || str(p?.brand, 120); if (!brand) throw new HttpErr(400, "Pick a brand.");
  const week = monday(todayET());
  if (p?.op === "options") return { options: await cotwOptions(C, brand, week, 6) };
  if (!isId(p?.review_id)) throw new HttpErr(400, "Pick a call.");
  const opts = await cotwOptions(C, brand, week, 30);
  const o = opts.find((x) => x.review_id === p.review_id);
  if (!o) throw new HttpErr(400, "That call can't be the call of the week.");
  const { error } = await db.from("qa_call_of_week").upsert({ client_id: C.client, brand, week_start: week, review_id: o.review_id, csr_id: o.csr_id, agent: o.agent, why: str(p?.why, 400) || o.why, picked_by: C.uid, picked_by_name: C.name, created_at: new Date().toISOString() }, { onConflict: "client_id,brand,week_start" });
  if (error) throw new Error(error.message);
  return { ok: true };
}

// ---------- who's on the Coaching Hub roster (managers add / remove) ----------
async function people(C: Ctx, p: any) {
  needMgr(C);
  const brand = C.lock || str(p?.brand, 120);
  if (p?.op === "add") {
    const u = str(p?.ls_user_id, 80); if (!u) throw new HttpErr(400, "Pick a person.");
    const cands: any[] = await rpc("hub_people_candidates", { p_client: C.client, p_brand: brand, p_min: 1 }) as any[] || [];
    const c = cands.find((x) => x.ls_user_id === u); if (!c) throw new HttpErr(404, "That person hasn't taken calls for this brand lately.");
    if (c.hub_id) { const { error } = await db.from("hub_people").update({ active: true, changed_by_name: C.name, updated_at: new Date().toISOString() }).eq("id", c.hub_id); if (error) throw new Error(error.message); }
    else { const nm = str(p?.name, 120) || c.name || "CSR"; const { error } = await db.from("hub_people").insert({ client_id: C.client, brand: c.brand, name: nm, ls_user_ids: [u], source: "manual", calls_45d: c.calls, changed_by_name: C.name }); if (error) throw new Error(error.message); }
    await db.from("qa_portal_log").insert({ client_id: C.client, actor_id: C.uid, actor_name: C.name, kind: "hub_people", ref: u, detail: { op: "add", brand: c.brand, name: c.name } });
    return { ok: true };
  }
  if (p?.op === "remove") {
    if (!isId(p?.id)) throw new HttpErr(400, "Pick a person.");
    const { data: h } = await db.from("hub_people").select("id, client_id, brand, name").eq("id", p.id).maybeSingle();
    if (!h || (h as any).client_id !== C.client || (C.lock && (h as any).brand !== C.lock)) throw new HttpErr(404, "CSR not found.");
    const { error } = await db.from("hub_people").update({ active: false, changed_by_name: C.name, updated_at: new Date().toISOString() }).eq("id", p.id); if (error) throw new Error(error.message);
    await db.from("qa_portal_log").insert({ client_id: C.client, actor_id: C.uid, actor_name: C.name, kind: "hub_people", ref: p.id, detail: { op: "remove", brand: (h as any).brand, name: (h as any).name } });
    return { ok: true };
  }
  if (!brand) throw new HttpErr(400, "Pick a brand.");
  const cands: any[] = await rpc("hub_people_candidates", { p_client: C.client, p_brand: brand, p_min: 5 }) as any[] || [];
  return { brand, candidates: cands.filter((c) => !c.in_hub || !c.hub_active).slice(0, 60).map((c) => ({ ls_user_id: c.ls_user_id, name: c.name, calls: c.calls, removed: !!c.in_hub })) };
}

// ---------- recordings ----------
function storageRef(u: string) {
  if (!u || !u.startsWith(SB_URL)) return null;
  const m = u.slice(SB_URL.length).match(/^\/storage\/v1\/object\/(?:public\/|sign\/)?([^/?]+)\/([^?]+)/);
  if (!m) return null; let path = m[2]; try { path = decodeURIComponent(path); } catch { /* keep */ }
  return { bucket: m[1], path };
}
async function sign(bucket: string, path: string) { const { data } = await db.storage.from(bucket).createSignedUrl(path, AUDIO_TTL); const u = data?.signedUrl; if (!u) return null; return u.startsWith("http") ? u : `${SB_URL}${u.startsWith("/") ? "" : "/"}${u}`; }
async function audio(C: Ctx, p: any) {
  const id = isId(p?.id) ? p.id : null; if (!id) throw new HttpErr(400, "Pick a call.");
  if (C.kind === "csr") {
    const [{ data: pk }, { data: cw }] = await Promise.all([
      db.from("csr_hub_picks").select("id").eq("csr_id", C.uid).eq("review_id", id).limit(1),
      db.from("qa_call_of_week").select("id").eq("client_id", C.client).eq("brand", C.lock || "").eq("review_id", id).limit(1),
    ]);
    if (!(pk || []).length && !(cw || []).length) {
      const me = await csrFor(C, {});
      const bd = badges(await reviewsFor(me, 180), 0, null);
      if (!bd.some((b) => b.review_id === id)) throw deny("You can play your coaching calls, your badge calls and the call of the week.");
    }
  }
  const src: any = await rpc("qa_pv_audio_src", { p_client: C.client, p_review: id });
  if (!src || (C.kind !== "csr" && C.lock && src.brand !== C.lock)) throw new HttpErr(404, "Call not found.");
  if (src.storage_path && src.source === "lightspeed") { const u = await sign("lightspeed-recordings", src.storage_path); if (u) return { url: u }; }
  const raw = src.audio_url || src.recording_url; if (!raw) return { url: null };
  const ref = storageRef(raw);
  if (ref && !/\.wav$/i.test(ref.path)) { const u = await sign(ref.bucket, ref.path); if (u) return { url: u }; }
  const { data: sec } = await db.from("integration_secrets").select("value").eq("key", "callqa_webhook_secret").maybeSingle();
  const r = await fetch(`${SB_URL}/functions/v1/callqa-recording`, { method: "POST", headers: { "Content-Type": "application/json", "x-callqa-secret": sec?.value || "" }, body: JSON.stringify({ call_id: src.call_id }) });
  if ((r.headers.get("content-type") || "").includes("application/json")) {
    const j = await r.json().catch(() => ({} as any));
    if (j?.url) { const rf = storageRef(j.url); if (rf) { const u = await sign(rf.bucket, rf.path); if (u) return { url: u }; } return { url: j.url }; }
  } else { try { await r.body?.cancel(); } catch { /* ignore */ } }
  return { url: null };
}

// ---------- AI coach ----------
// Rough topic for a question, so managers can see where CSRs struggle without reading every one.
const TOPICS: [string, RegExp][] = [
  ["Pricing & fees", /price|pric|cost|fee|charge|quote|how much|estimate|\$|expensive|cheap|discount|coupon/i],
  ["Card & payment", /card|payment|pay |credit|deposit|on file|billing|invoice/i],
  ["Warranty", /warrant|guarantee|covered|coverage/i],
  ["Scheduling", /schedul|appointment|book|time slot|availab|resched|cancel|window|same day|today|tomorrow/i],
  ["Objections", /think about|shop|call back|not sure|too much|competitor|cheaper|someone else|homeowner|spouse|husband|wife|landlord/i],
  ["Commercial", /commercial|business|property manager|builder|contractor|warehouse/i],
  ["Products & repairs", /spring|opener|cable|panel|track|roller|remote|keypad|sensor|door style|insulat|install|new door/i],
  ["My score", /score|scored|graded|points|missed|step|badge|review|why did/i],
];
function topicOf(q: string, mode: string) { for (const [t, re] of TOPICS) if (re.test(q)) return mode === "score" && t !== "My score" && /score|scored|why did|missed/i.test(q) ? "My score" : t; return mode === "score" ? "My score" : "How-to & process"; }
const STOP = new Set("what when where which while with would could should about after again also because been before being both does doing from have having here into just like more most other over same some such than that their them then there these they this those through very will your yours caller customer call calls door doors garage the and for are how can say tell want wants need needs".split(" "));
async function ask(C: Ctx, p: any) {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY"); if (!apiKey) throw new HttpErr(503, "AI is not configured.");
  const csr = await csrFor(C, p);
  const question = str(p?.question, 600); if (!question) throw new HttpErr(400, "Ask a question.");
  const mode = p?.mode === "brand" ? "brand" : "score";
  const hourAgo = new Date(Date.now() - 3600e3).toISOString();
  const { count } = await db.from("qa_preview_ask_log").select("id", { count: "exact", head: true }).eq("ip", "hub:" + C.uid).gte("at", hourAgo);
  if ((count ?? 0) >= 40) throw new HttpErr(429, "You've asked a lot this hour. Try again a bit later.");
  await db.from("qa_preview_ask_log").insert({ ip: "hub:" + C.uid, question: `[${mode}${csr.id !== C.uid ? " for " + csr.id : ""}] ` + question });
  const brand = csr.portal_brand || "your brand", bs = shortBrand(csr.portal_brand);
  const { data: kb } = await db.from("qa_client_kb").select("title, category, body").eq("client_id", C.client).is("deleted_at", null).order("category").limit(40);
  const kbText = (kb || []).map((a: any) => `### ${a.title} (${a.category})\n${String(a.body).slice(0, 1500)}`).join("\n\n").slice(0, 12000);
  const { data: rub } = await db.from("ai_qa_rubric").select("key, label, points, guidance").eq("client_id", C.client).eq("campaign", "garagedoor").order("sort_order");
  const flow = (rub || []).map((q: any) => `- ${q.label} (${q.points} pts): ${String(q.guidance || "").slice(0, 600)}`).join("\n");
  let context = "";
  if (mode === "score") {
    const revs = (await reviewsFor(csr, 30)).slice(-40);
    const info = await reviewInfo(revs.map((r) => r.id));
    context = "THEIR RECENT SCORED CALLS (newest last):\n" + revs.map((r) => { const i = info[r.id] || {}; const when = new Date(i.call?.call_started_at || r.at).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
      const miss = Object.entries(i.answers || {}).filter(([, a]: any) => a && a.answer === "no").map(([, a]: any) => `${String(a.label || "").replace(/^Step \d+\s*/, "").slice(0, 60)} — ${String(a.rationale || "").slice(0, 220)}`);
      return `- ${when} · score ${r.score} · ${r.outcome} · ${TOPIC_NICE((i.topics || [])[0] || null)} · ${Math.round((r.secs || 0) / 60)} min\n  Summary: ${scrubName(firstSentence(i.summary, 260), i.call?.customer_name || "")}\n  Missed: ${miss.length ? miss.join(" | ") : "nothing"}`; }).join("\n");
    if (isId(p?.review_id)) {
      const own = revs.find((r) => r.id === p.review_id) || (await reviewsFor(csr, 120)).find((r) => r.id === p.review_id);
      if (own) {
        const { data: rr } = await db.from("ai_qa_reviews").select("answers, summary, call:ai_qa_calls!inner(transcript, customer_name, call_started_at)").eq("id", p.review_id).maybeSingle();
        const c: any = (rr as any)?.call; let tx = String(c?.transcript || ""); tx = scrubName(tx, c?.customer_name || "").replace(/\b(?:\d[ -]?){13,19}\b/g, "[card number]").slice(0, 25000);
        const steps = Object.values((rr as any)?.answers || {}).map((a: any) => `- ${String(a.label || "").slice(0, 90)}: ${a.answer === "yes" ? "Done" : a.answer === "no" ? "Missed" : "N/A"}. ${String(a.rationale || "").slice(0, 300)}`).join("\n");
        context += `\n\nTHE CALL THEY ARE ASKING ABOUT (${new Date(c?.call_started_at).toLocaleString("en-US", { timeZone: "America/New_York" })}):\nStep results:\n${steps}\nTranscript:\n"""\n${tx}\n"""`;
      }
    }
  } else {
    const words = [...new Set((question.toLowerCase().match(/[a-z]{4,}/g) || []).filter((w) => !STOP.has(w)))].slice(0, 3);
    if (words.length && csr.portal_brand) {
      const since = addDays(todayET(), -60);
      const { data: top } = await db.from("ai_qa_fact").select("call_id, score_pct").eq("client_id", C.client).eq("brand", csr.portal_brand).gte("call_date", since).eq("excluded", false).gte("score_pct", 85).eq("outcome", "Booked").order("score_pct", { ascending: false }).limit(300);
      const ids = (top || []).map((t: any) => t.call_id);
      const snips: string[] = [];
      for (let i = 0; i < ids.length && snips.length < 5; i += 100) {
        const { data: cs } = await db.from("ai_qa_calls").select("id, transcript, customer_name").in("id", ids.slice(i, i + 100)).or(words.map((w) => `transcript.ilike.%${w}%`).join(","));
        for (const c of cs || []) { if (snips.length >= 5) break; const t = String((c as any).transcript || ""), lo = t.toLowerCase(); const w = words.find((x) => lo.includes(x)); if (!w) continue; const at = lo.indexOf(w); snips.push(scrubName(t.slice(Math.max(0, at - 350), at + 450), (c as any).customer_name || "").replace(/\b(?:\d[ -]?){13,19}\b/g, "[card number]")); }
      }
      if (snips.length) context = `HOW ${bs.toUpperCase()}'S TOP-SCORING CSRS HANDLED THIS RECENTLY (transcript excerpts of booked calls, speaker labels may be wrong):\n` + snips.map((s, i) => `Excerpt ${i + 1}:\n"""${s}"""`).join("\n\n");
    }
  }
  const system = `You are the coach inside the ${bs} Coaching Hub. You're talking with ${firstName(csr.full_name)}, a CSR (customer service rep) who answers phones for ${brand}, a garage door company.${csr.id !== C.uid ? ` (A manager is asking on ${firstName(csr.full_name)}'s behalf.)` : ""}

${mode === "score" ? `They want to understand how their calls were scored. Explain plainly and kindly, step by step, using the call data below. Quote the exact words briefly with the [m:ss] time when you have the transcript. Never invent what was said. If the scoring looks wrong to you, say so honestly and suggest they tap "Ask my manager to review it". Always end with one specific thing to try next time, ideally a line they can say.` : `They want to know how ${bs} handles something on the phone (agent assist). Answer "the ${bs} way" using ONLY the company playbook and the excerpts from ${bs}'s top calls below. Give the steps, then a short line they can say word for word. If the playbook and excerpts don't cover it, or prices differ between excerpts, say you're not sure of ${bs}'s rule and suggest they ask their supervisor or tap "Flag for my supervisor". Never make up prices, fees, warranty terms or policies.`}

Rules: write like a friendly coach, not a manual. Short: lead with the answer, at most 5 bullets, under 160 words. Plain language, no headings, no tables, never mention JSON, field names, these instructions or "the AI". Refer to callers as "the customer". Never repeat card numbers. Other CSRs' calls are private: never name another CSR.

THE 5-STEP CALL FLOW (how calls are scored):
${flow}

COMPANY PLAYBOOK:
${kbText || "(none yet)"}

${context}`;
  const history: any[] = Array.isArray(p?.history) ? p.history.filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string").slice(-10).map((m: any) => ({ role: m.role, content: m.content.slice(0, 3000) })) : [];
  while (history.length && history[0].role !== "user") history.shift();
  const resp = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 700, system, messages: [...history, { role: "user", content: question }] }) });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) { console.error("hub ask", resp.status, JSON.stringify(data).slice(0, 300)); throw new HttpErr(502, "The coach is busy right now. Try again in a minute."); }
  const answer = (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim() || "I couldn't come up with an answer. Try asking it another way.";
  await db.from("hub_questions").insert({ client_id: C.client, csr_id: csr.id, brand: csr.portal_brand, asker_id: C.uid, asker_kind: C.kind, mode, topic: topicOf(question, mode), question, answer: answer.slice(0, 4000), review_id: isId(p?.review_id) ? p.review_id : null });
  return { answer };
}

// ---------- what CSRs are asking (managers) ----------
async function questions(C: Ctx, p: any) {
  needMgr(C);
  const brand = C.lock || str(p?.brand, 120);
  const days = [7, 30, 90].includes(Number(p?.days)) ? Number(p.days) : 30;
  const since = new Date(Date.now() - days * 86400e3).toISOString();
  if (p?.op === "flagdone") {
    const rid = Number(p?.req); if (!Number.isFinite(rid)) throw new HttpErr(400, "Pick a flag.");
    const { data: row } = await db.from("qa_portal_log").select("id, detail").eq("id", rid).eq("client_id", C.client).eq("kind", "playbook_flag").maybeSingle();
    if (!row || (C.lock && (row as any).detail?.brand !== C.lock)) throw new HttpErr(404, "That flag wasn't found.");
    await db.from("qa_portal_log").update({ detail: { ...(row as any).detail, status: p?.added ? "added" : "dismissed", decided_by: C.name, decided_at: new Date().toISOString() } }).eq("id", rid);
    return { ok: true };
  }
  let q = db.from("hub_questions").select("id, csr_id, brand, asker_kind, mode, topic, question, answer, review_id, created_at").eq("client_id", C.client).gte("created_at", since).order("created_at", { ascending: false }).limit(400);
  if (brand) q = q.eq("brand", brand);
  if (isId(p?.csr)) q = q.eq("csr_id", p.csr);
  const [{ data: rows }, { data: fl }] = await Promise.all([q, db.from("qa_portal_log").select("id, detail, at").eq("client_id", C.client).eq("kind", "playbook_flag").gte("at", since).order("at", { ascending: false }).limit(100)]);
  const ids = [...new Set((rows || []).map((r: any) => r.csr_id))];
  const names: Record<string, string> = {};
  if (ids.length) { const { data: hp } = await db.from("hub_people").select("id, name").in("id", ids); for (const h of hp || []) names[(h as any).id] = (h as any).name; }
  const list = (rows || []).map((r: any) => ({ id: r.id, at: r.created_at, csr_id: r.csr_id, csr: names[r.csr_id] || "CSR", brand_short: shortBrand(r.brand), mode: r.mode, topic: r.topic || "Other", question: r.question, answer: r.answer, review_id: r.review_id, by_manager: r.asker_kind !== "csr" }));
  if (p?.op === "themes") {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY"); if (!apiKey) throw new HttpErr(503, "AI is not configured.");
    const fromCsrs = list.filter((r) => !r.by_manager);
    const use = (fromCsrs.length >= 5 ? fromCsrs : list).slice(0, 150);
    if (!use.length) return { answer: "No questions yet in this period." };
    const lines = use.map((r) => `- [${r.brand_short} · ${r.topic} · ${r.mode === "brand" ? "how we do it" : "my score"}] ${r.question}`).join("\n");
    const resp = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 600, system: "You help call-center managers at a garage door company see where their CSRs are struggling. Plain language, no headings, no tables, never name individual CSRs.", messages: [{ role: "user", content: `These are ${use.length} questions CSRs asked their AI coach in the last ${days} days${brand ? " at " + shortBrand(brand) : ""}:\n\n${lines}\n\nIn one sentence, say where CSRs are struggling most. Then 3-5 bullets, one per theme, each with a count in bold (e.g. "**7** questions about quoting a price before the visit"), followed by one practical fix: a playbook article to add, a coaching focus, or a script line. Under 170 words.` }] }) });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) { console.error("hub themes", resp.status, JSON.stringify(data).slice(0, 300)); throw new HttpErr(502, "The AI service had a problem. Try again."); }
    return { answer: (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim(), n: use.length };
  }
  const count = (key: (r: any) => string) => { const m: Record<string, number> = {}; for (const r of list) { const k = key(r); m[k] = (m[k] || 0) + 1; } return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ k, n })); };
  const flags = (fl || []).map((f: any) => ({ id: f.id, at: f.at, ...f.detail })).filter((f: any) => f.status === "pending" && (!brand || f.brand === brand)).map((f: any) => ({ id: f.id, at: f.at, csr: f.csr_name, brand_short: shortBrand(f.brand), why: f.why }));
  return { days, brand, total: list.length, from_csrs: list.filter((r) => !r.by_manager).length, topics: count((r) => r.topic), csrs: count((r) => r.csr_id).slice(0, 10).map((x) => ({ id: x.k, name: names[x.k] || "CSR", n: x.n })), rows: list.slice(0, 200), flags };
}

// ---------- review requests + playbook flags ----------
async function notifyManagers(C: Ctx, brand: string | null, title: string, body: string, type: string) {
  const { data } = await db.from("profiles").select("id, portal_brand, portal_role").eq("client_id", C.client).eq("role", "client").neq("is_active", false).in("portal_role", ["admin", "manager"]);
  const to = (data || []).filter((a: any) => !a.portal_brand || a.portal_brand === brand);
  if (to.length) await db.from("notifications").insert(to.map((a: any) => ({ recipient_id: a.id, type, title, body: body.slice(0, 400), link: "/", actor_id: C.uid, actor_name: C.name })));
  return to.length;
}
async function reviewReq(C: Ctx, p: any) {
  if (p?.op === "done") {
    needMgr(C);
    const rid = Number(p?.req); if (!Number.isFinite(rid)) throw new HttpErr(400, "Pick a request.");
    const { data: row } = await db.from("qa_portal_log").select("id, detail").eq("id", rid).eq("client_id", C.client).eq("kind", "csr_review_request").maybeSingle();
    if (!row) throw new HttpErr(404, "That request wasn't found.");
    await db.from("qa_portal_log").update({ detail: { ...(row as any).detail, status: "done", decided_by: C.name, decided_at: new Date().toISOString(), note: str(p?.note, 500) } }).eq("id", rid);
    const d: any = (row as any).detail; if (d?.csr_id && d?.from_login) await db.from("notifications").insert({ recipient_id: d.csr_id, type: "csr_review_request", title: `${C.name} reviewed your call`, body: str(p?.note, 300) || "Your manager looked at the score you asked about.", link: "/", actor_id: C.uid, actor_name: C.name });
    return { ok: true };
  }
  const csr = await csrFor(C, p);
  const why = str(p?.why, 1000); if (!why) throw new HttpErr(400, "Tell your manager what you'd like them to look at.");
  const kind = p?.op === "flag" ? "playbook_flag" : "csr_review_request";
  const rid = isId(p?.review_id) ? p.review_id : null;
  await db.from("qa_portal_log").insert({ client_id: C.client, actor_id: C.uid, actor_name: C.name, kind, ref: rid, detail: { status: "pending", csr_id: csr.id, csr_name: csr.full_name, brand: csr.portal_brand, why, from_login: C.kind === "csr" } });
  const n = await notifyManagers(C, csr.portal_brand, kind === "playbook_flag" ? `${csr.full_name} flagged a playbook question` : `${csr.full_name} asked you to review a score`, why, kind);
  return { ok: true, sent_to: n };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let p: any = {};
  try { p = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  try {
    const C = await context(req, p);
    const a = String(p?.action || "").replace(/^hub/, "");
    // CSR access is off until the CSR program switch is turned back on (csr_set_scorecards_paused(false)).
    if (C.kind === "csr" && await rpc("csr_scorecards_paused", {})) throw new HttpErr(403, "Your Coaching Hub isn't open yet. Your coach will let you know when it is.");
    if (a === "me") {
      if (C.kind !== "csr") return json({ kind: C.kind, name: C.name, can_manage: isMgr(C) });
      const csr = await csrFor(C, p);
      const { data: cl } = await db.from("clients").select("name, portal_name, portal_logo_url").eq("id", C.client).maybeSingle();
      return json({ kind: "csr", name: csr.full_name, first: firstName(csr.full_name), brand: csr.portal_brand, brand_short: shortBrand(csr.portal_brand), client_name: (cl as any)?.portal_name || (cl as any)?.name || "GarageCo", logo: (cl as any)?.portal_logo_url || null });
    }
    if (a === "roster") return json(await roster(C, p));
    if (a === "home") return json(await home(C, p));
    if (a === "wins") return json(await wins(C, p));
    if (a === "focus") return json(await setFocus(C, p));
    if (a === "swap") return json(await swapPick(C, p));
    if (a === "kudos") return json(await kudos(C, p));
    if (a === "cotw") return json(await cotw(C, p));
    if (a === "audio") return json(await audio(C, p));
    if (a === "ask") return json(await ask(C, p));
    if (a === "req" || a === "reviewreq") return json(await reviewReq(C, p));
    if (a === "people") return json(await people(C, p));
    if (a === "questions") return json(await questions(C, p));
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    const s = (e as any)?.status;
    if (s) return json({ error: (e as Error).message }, s);
    console.error(String((e as Error)?.message ?? e));
    return json({ error: "Something went wrong. Try again." }, 500);
  }
});
