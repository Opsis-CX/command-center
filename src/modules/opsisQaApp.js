// Opsis QA client portal — the app shown at garageco.opsiscx.com.
// 2026-10-22: hand-edited — wording points to the account's own admins (not Opsis CX), and QA settings
// gains "Suggested scoring rules" (opsis-qa-portal action 'rulesugs' -> opsis-qa-rules).
// Adds the Card capture page (2026-10-22). Built from the Opsis QA preview page by scratchpad/portal/build.py. All data comes from the
// authenticated edge function opsis-qa-portal (scoped to the signed-in login's client + brand).
// mountOpsisQA(rootEl, cfg) renders the app and returns a destroy() function.
// cfg: { invoke(body) -> Promise<json>, role, brandLock, clientName, clientId, staff, userName, email,
//        logo, hasCsrs, phone, mountCsr(el) -> cleanup, onSignOut(), onClassic() }
var CSS = "#oqa{--bg:#F5F3EE;--card:#FFFFFF;--line:#E8E4DC;--line2:#F1EEE8;--ink:#1C2421;--mut:#5F6763;--g:#2F7D5B;--gd:#1F5A41;--gl:#E6F0EA;--o:#E0662A;--od:#A8441A;--ol:#FCEBDD;--side:#14302A;--blue:#3A4380}\n#oqa *{box-sizing:border-box}\n#oqa{margin:0;background:var(--bg);color:var(--ink);font-family:Montserrat,Arial,sans-serif;font-size:14px}\n#oqa a{color:var(--g)}\n#oqa button{font-family:inherit;font-size:inherit}\n#oqa .oq-app{display:flex;flex-wrap:wrap;min-height:100vh}\n#oqa aside{flex:1 1 236px;max-width:100%;background:var(--side);color:#fff;padding:22px 14px 18px;display:flex;flex-direction:column;gap:22px}\n#oqa main{flex:999 1 640px;min-width:0;padding:16px 24px 32px;display:flex;flex-direction:column;gap:16px}\n#oqa .logo{background:#fff;border-radius:12px;padding:12px 14px;display:flex;align-items:center;justify-content:center;min-height:64px}\n#oqa .logo img{max-width:100%;max-height:48px;display:block}\n#oqa .nav{display:flex;flex-direction:column;gap:2px}\n@media (min-width:900px){#oqa aside{position:sticky;top:0;align-self:flex-start;height:100vh;overflow-y:auto}}\n@media (max-width:899px){#oqa aside{flex-basis:100%;padding:10px 12px;gap:8px}#oqa aside .nav{flex-direction:row;overflow-x:auto;gap:4px;padding-bottom:4px;scrollbar-width:thin}#oqa aside .nav button{width:auto;flex:none;padding:8px 12px;min-height:40px;font-size:13px;gap:8px;white-space:nowrap}#oqa aside .navsec{display:none}#oqa aside > :first-child{padding:8px!important;min-height:0!important;height:auto!important}#oqa aside > :first-child img{max-height:34px}#oqa aside > :last-child:not(#nav){display:none}}@media (max-width:899px){#oqa .tbl td:first-child{position:sticky;left:0;background:#fff;z-index:1;box-shadow:2px 0 4px -2px rgba(0,0,0,.12)}#oqa .tbl thead th:first-child{position:sticky;left:0;z-index:2}#oqa .swipe{display:block!important}}#oqa .hubpick>[data-hubslot]:has(audio){flex:1 1 100%;order:2}#oqa .hubpick>[data-hubslot] audio{width:100%!important}#oqa .tbl thead th{background:#F3F1EC;padding-top:9px;padding-bottom:9px}#oqa .tbl thead th:first-child{border-radius:8px 0 0 8px}#oqa .tbl thead th:last-child{border-radius:0 8px 8px 0}\n#oqa .nav button{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:12px;width:100%;padding:10px 14px;border-radius:10px;color:#D6E2DC;font-size:14px;cursor:pointer;min-height:44px}\n#oqa .nav button:hover{background:#1F3F37;color:#fff}\n#oqa .nav button.on{background:#2A4A42;color:#fff;font-weight:600}\n#oqa .nav button:focus-visible,#oqa .click:focus-visible,#oqa button:focus-visible{outline:2px solid #7CC4A4;outline-offset:2px}\n#oqa .navsec{font-size:10px;letter-spacing:.18em;color:#9DBBAE;padding:14px 14px 4px;font-weight:600}\n#oqa .powered{margin-top:auto;border-top:1px solid #234840;padding:14px 8px 0;font-size:11.5px;color:#BFD1C8;display:flex;align-items:center;gap:8px}\n#oqa .oq-card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px;min-width:0}\n#oqa .ttl{margin:0;font-size:17px;font-weight:700;letter-spacing:-0.02em;color:#14302A}\n#oqa .sub{margin:4px 0 0;font-size:12.5px;color:var(--mut);line-height:1.45}\n#oqa .cap{font-size:10.5px;font-weight:600;letter-spacing:.13em;text-transform:uppercase;color:#56605B}\n#oqa .mut{color:var(--mut)}\n#oqa .num{font-variant-numeric:tabular-nums}\n#oqa .more{all:unset;cursor:pointer;font-size:12.5px;font-weight:600;color:#2F5E4E;min-height:32px;display:inline-flex;align-items:center;gap:4px}\n#oqa .more:hover{color:var(--ink)}\n#oqa .sel{border:1px solid #E1DCD2;background:#fff;font-size:13px;color:var(--ink);padding:9px 14px;border-radius:10px;cursor:pointer;min-height:42px;display:inline-flex;align-items:center;gap:8px;text-decoration:none;white-space:nowrap}\n#oqa .sel:hover{border-color:#B9B2A6}\n#oqa .btnd{background:var(--side);border-color:var(--side);color:#fff}\n#oqa .btnd:hover{border-color:var(--side)}\n#oqa .pill{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:600;padding:4px 9px;border-radius:8px;white-space:nowrap}\n#oqa .tbl{width:100%;border-collapse:collapse;font-size:13px}\n#oqa .tbl th{text-align:left;font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#56605B;padding:0 8px 10px;white-space:nowrap;cursor:default}\n#oqa .tbl th.sortable{cursor:pointer}\n#oqa .av{width:32px;height:32px;border-radius:999px;background:#E6F0EA;color:#1F5A41;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0}\n#oqa .tbl th.sortable:hover{color:var(--ink)}\n#oqa .tbl td{padding:10px 8px;white-space:nowrap;border-top:1px solid var(--line2)}\n#oqa .tbl th,#oqa .tbl td{text-align:center!important}\n#oqa .tbl th:first-child,#oqa .tbl td:first-child{text-align:left!important}\n#oqa .tbl tr.click{cursor:pointer}\n#oqa .tbl tr.click:hover td{background:#FAF8F3}\n#oqa .track{height:6px;border-radius:999px;background:#EEEBE4;overflow:hidden}\n#oqa .track>div{height:100%;border-radius:999px}\n#oqa .row{display:flex;flex-wrap:wrap;gap:12px}\n#oqa .grid{display:grid;gap:12px}\n#oqa .banner{background:#FFF8E8;border:1px solid #F0DDB0;color:#6B4E12;border-radius:12px;padding:9px 14px;font-size:12.5px}\n#oqa input,#oqa textarea,#oqa select{font-family:inherit;font-size:13.5px;color:var(--ink)}\n#oqa .oq-field{border:1px solid #E1DCD2;border-radius:10px;padding:10px 12px;width:100%;background:#fff}\n#oqa label.l{display:block;font-size:12px;font-weight:600;margin-bottom:6px;color:#3B4541}\n#oqa .toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--side);color:#fff;padding:12px 18px;border-radius:12px;font-size:13px;box-shadow:0 8px 30px rgba(0,0,0,.18);z-index:80;display:none}\n#oqa .overlay{position:fixed;inset:0;background:rgba(20,48,42,.35);display:flex;justify-content:flex-end;z-index:60}\n#oqa .drawer{width:640px;max-width:100%;height:100%;overflow-y:auto;background:#F7F5F0;padding:22px;display:flex;flex-direction:column;gap:14px}\n#oqa .click{cursor:pointer}\n#oqa .chip{border:1px solid #E1DCD2;background:#fff;font-size:12.5px;padding:7px 12px;border-radius:999px;cursor:pointer;min-height:34px;color:var(--ink);text-align:left}\n#oqa .chip:hover{border-color:var(--g);color:var(--gd)}\n#oqa .chip.on{background:var(--side);color:#fff;border-color:var(--side)}\n#oqa .seg{display:inline-flex;background:#fff;border:1px solid #E1DCD2;border-radius:10px;padding:3px;gap:2px;flex-wrap:wrap}\n#oqa .seg button{border:none;background:transparent;padding:7px 11px;border-radius:8px;cursor:pointer;font-size:12.5px;color:var(--ink);min-height:34px}\n#oqa .seg button.on{background:var(--side);color:#fff}\n#oqa .skel{background:linear-gradient(90deg,#EEEBE4 25%,#F6F4EF 50%,#EEEBE4 75%);background-size:200% 100%;animation:sk 1.2s infinite;border-radius:8px}\n\n@keyframes sk{0%{background-position:200% 0}100%{background-position:-200% 0}}#oqa .ai{background:linear-gradient(0deg,#fff,#fff);border:1px solid #CFE3D8;border-radius:14px;padding:18px}\n#oqa .ai .md{line-height:1.6;font-size:13.5px}\n#oqa .ai .md ul{margin:8px 0;padding-left:20px}\n#oqa .ai .md li{margin:3px 0}\n#oqa .lnk{color:var(--gd);font-weight:600;cursor:pointer;border-bottom:1px dashed #9CC6B2}\n#oqa .lnk:hover{color:var(--ink)}\n#oqa .dots span{display:inline-block;width:7px;height:7px;border-radius:999px;background:var(--g);margin-right:4px;animation:bl 1s infinite}\n#oqa .dots span:nth-child(2){animation-delay:.15s}\n#oqa .dots span:nth-child(3){animation-delay:.3s}\n\n@keyframes bl{0%,100%{opacity:.25}50%{opacity:1}}#oqa .pop{position:absolute;z-index:50;background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.12);padding:12px;min-width:260px;max-height:420px;overflow:auto}\n#oqa .oq-crumb{font-size:12.5px;color:var(--mut);display:flex;gap:6px;align-items:center;flex-wrap:wrap}\n#oqa .oq-crumb button{all:unset;cursor:pointer;color:var(--gd);font-weight:600}\n#oqa .step{padding:12px;border-top:1px solid var(--line2)}\n#oqa .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}\n#oqa .foot{text-align:center;font-size:12px;color:var(--mut);padding:8px 0 0}\n@media (max-width:760px){#oqa main{padding:12px 14px 28px}\n#oqa .hero h1{font-size:26px!important}\n#oqa .drawer{padding:16px}\n}\n\n#oqa{min-height:100vh;font-family:Montserrat,Arial,sans-serif;font-size:14px;color:var(--ink);background:var(--bg)}\n#oqa .who{border-top:1px solid #234840;padding:12px 8px 0;font-size:12px;color:#BFD1C8;display:flex;flex-direction:column;gap:6px}\n#oqa .who b{color:#fff;font-weight:600;font-size:12.5px}\n#oqa .who button{all:unset;cursor:pointer;color:#D6E2DC;text-decoration:underline;text-underline-offset:2px;font-size:12px}\n#oqa .who button:hover{color:#fff}\n";
var MARKUP = "<div class=\"oq-app\">\n  <aside>\n    <div class=\"logo\"><img id=\"oqlogo\" alt=\"\"></div>\n    <nav class=\"nav\" id=\"nav\" aria-label=\"Main\"></nav>\n    <div class=\"who\" id=\"oqwho\"></div><div class=\"powered\" style=\"margin-top:0\"><svg width=\"22\" height=\"18\" viewBox=\"0 0 34 30\" fill=\"none\" stroke=\"#BFD1C8\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M1 15h7l3-9 4 18 4-14 3 5h11\"/></svg><span>Powered by <b style=\"color:#fff;font-weight:600\">Opsis CX</b></span></div>\n  </aside>\n  <main id=\"main\"></main>\n</div>\n<div id=\"layer\"></div>\n<div class=\"toast\" id=\"toast\" role=\"status\"></div>";

export function mountOpsisQA(ROOT, cfg) {
  var st = document.getElementById('oqa-style');
  if (!st) { st = document.createElement('style'); st.id = 'oqa-style'; st.textContent = CSS; document.head.appendChild(st); }
  if (!document.getElementById('oqa-font')) { var ln = document.createElement('link'); ln.id = 'oqa-font'; ln.rel = 'stylesheet'; ln.href = 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap'; document.head.appendChild(ln); }
  ROOT.id = 'oqa';
  ROOT.innerHTML = MARKUP;
  var destroy = (function () {
  'use strict';
  var CFG = cfg || {};
  var ROLE = CFG.role || 'manager', LOCK = CFG.brandLock || null, CAN_EDIT = ROLE !== 'viewer', IS_ADMIN = ROLE === 'admin';
  var CLIENT = CFG.clientName || 'GarageCo';
  var LISTENERS = [];
  function on(target, type, fn) { target.addEventListener(type, fn); LISTENERS.push([target, type, fn]); }
  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (n) { return n == null || isNaN(n) ? '—' : Number(n).toLocaleString('en-US'); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var pct = function (a, b) { return b ? a / b * 100 : null; };
  var p1 = function (v) { return v == null ? '—' : v.toFixed(1) + '%'; };
  var G = '#2F7D5B', O = '#E0662A';
  var SHORT = { 'Cedar Park Overhead Door': 'Cedar Park', 'Apple Door': 'Apple', 'Omaha Door': 'Omaha', 'Cheney Door': 'Cheney', 'Quality Overhead Door': 'Quality', 'Cunningham Door': 'Cunningham', 'Genson Overhead Door': 'Genson' };
  var short = function (b) { return SHORT[b] || b || '—'; };
  var BCOL = ['#1F5A41', '#8A5A2B', '#B4452A', '#3B4541', '#7A2E1C', '#8C7A1E', '#6B2E2E', '#2F5E4E', '#2E4A6B', '#4A5A3B', '#5B3A6B', '#2B5B6B'];
  var bcol = function (b) { var h = 0; for (var i = 0; i < (b || '').length; i++) h = (h * 31 + b.charCodeAt(i)) >>> 0; return BCOL[h % BCOL.length]; };
  var STEPNAMES = { introduce: 'Introduce', listen: 'Listen', collect_info: 'Collect info', sell_appointment: 'Sell the appointment', sell_offer: 'Offer the booking', sell_ask: 'Ask for the booking', sell_card: 'Card on file', sell_objection: 'Overcome the objection', sell_expert: 'Tech is the expert', confirm_thank: 'Confirm and thank', greeting: 'Greeting', empathy: 'Acknowledge / empathy', verify_approver: 'Verify + confirm approver', discovery: 'Discovery', set_expectations: 'Set expectations', explain_fee: 'Explain the fee', offer_appt: 'Offer next appointment', ask_booking: 'Ask for the booking', capture_payment: 'Capture payment', confirm_details: 'Confirm appointment details', thank_close: 'Thank customer + close' };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var fdate = function (d) { if (!d) return ''; var p = d.split('-'); return MONTHS[+p[1] - 1] + ' ' + (+p[2]); };
  var fhour = function (h) { return h == null ? '' : (h === 0 ? '12a' : h < 12 ? h + 'a' : h === 12 ? '12p' : (h - 12) + 'p'); };
  var fsecs = function (s) { return s ? Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2) : '—'; };

  function todayET() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); }
  function addDays(d, n) { var x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
  function daysBetween(a, b) { return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 864e5) + 1; }

  // ---------------- state ----------------
  var S = {
    view: 'overview', brand: null, agent: null,           // drill targets
    range: '30', start: null, end: null, brands: [],       // filters
    calls: { outcome: null, step: null, scoreMax: null, scoreMin: null, winnable: null, q: '', offset: 0, sort: 'new' },
    callId: null, adj: {}, change: null, pop: null, ask: { open: false, msgs: [], busy: false },
    csrSort: 'calls', brandSort: 'calls'
  };
  function applyRange() {
    var t = todayET();
    if (S.range === 'custom' && S.start && S.end) return;
    if (S.range === 'today') { S.end = t; S.start = t; return; }
    if (S.range === 'yesterday') { S.end = addDays(t, -1); S.start = S.end; return; }
    if (S.range === 'month') { S.end = t; S.start = t.slice(0, 8) + '01'; return; }
    if (S.range === 'lastmonth') { var f = t.slice(0, 8) + '01'; S.end = addDays(f, -1); S.start = S.end.slice(0, 8) + '01'; return; }
    // Last 7 / 30 / 90 days = completed days, today left out (2026-10-26, matches LightSpeed and Switchboard)
    var n = +S.range || 30; S.end = addDays(t, -1); S.start = addDays(t, -n);
  }
  applyRange();
  function prevWin() { var n = daysBetween(S.start, S.end); return { start: addDays(S.start, -n), end: addDays(S.start, -1) }; }

  // ---------------- data ----------------
  var cache = {};
  var CACHEABLE = { report: 1, focus: 1, calls: 1, phone: 1, repeat: 1, ai: 1, cardcap: 1, qaextras: 1 };
  function api(body) {
    if (CFG.clientId) body = Object.assign({ client_id: CFG.clientId }, body);
    var k = JSON.stringify(body), cacheable = !!CACHEABLE[body.action];
    if (cacheable && cache[k]) return cache[k];
    var isRead = cacheable || body.action === 'call' || body.action === 'export' || body.action === 'bucketcalls' || body.action === 'factcalls' || body.action === 'callmetrics' || body.action === 'hubhome' || body.action === 'hubwins' || body.action === 'hubroster' || body.action === 'hubaudio' || (body.action === 'xfercalls' && body.op !== 'why') || body.action === 'scorecards' || body.action === 'money' || body.action === 'excused' || body.action === 'billing' || (body.action === 'jobvalues' && !body.op) || body.action === 'audio' || ((body.action === 'kb' || body.action === 'settings' || body.action === 'team') && !body.op) || (body.action === 'notes' && body.body == null);
    var once = function () { return CFG.invoke(body); };
    var wait = function (ms) { return new Promise(function (res) { setTimeout(res, ms); }); };
    var stop = function (e) { return e.status && e.status < 500 && e.status !== 408; };
    var pr = !isRead ? once() : once().catch(function (e) { if (stop(e)) throw e; return wait(1500).then(once); }).catch(function (e) { if (stop(e)) throw e; return wait(3000).then(once); });
    if (cacheable) { cache[k] = pr; pr.catch(function () { delete cache[k]; }); }
    return pr;
  }
  function win(extra) { var o = { start: S.start, end: S.end, brands: S.brands.length ? S.brands : null }; for (var k in extra) o[k] = extra[k]; return o; }
  // Booking rate is per call (booked calls ÷ booked + not-booked calls) so it can be checked against the cohort bar (2026-10-26).
  function perCall(rep) { if (rep) ['kpis', 'prev'].forEach(function (k) { var x = rep[k]; if (x && x.decided_calls != null) x.booking_rate = x.decided_calls ? Math.round(1000 * x.booked_calls / x.decided_calls) / 10 : null; }); return rep; }
  function loadReport() { return api(Object.assign({ action: 'report' }, win())).then(perCall); }
  function loadPrevReport() { var p = prevWin(); return api({ action: 'report', start: p.start, end: p.end, brands: S.brands.length ? S.brands : null }).then(perCall); }
  function loadFocus(brand, agent) { return api({ action: 'focus', start: S.start, end: S.end, brand: brand || null, agent: agent || null }); }

  var KNOWN = { brands: [], agents: [] };

  // ---------------- tiny helpers ----------------
  function toast(m) { var t = $('toast'); if (!t) return; t.textContent = m; t.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(function () { t.style.display = 'none'; }, 2600); }
  function series(vals, w, h, pad) {
    vals = vals.filter(function (v) { return v != null && !isNaN(v); });
    if (vals.length < 2) return { line: '', area: '' };
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), r = (hi - lo) || 1;
    var pts = vals.map(function (v, i) { return [i / (vals.length - 1) * w, pad + (h - 2 * pad) - (v - lo) / r * (h - 2 * pad)]; });
    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    return { line: line, area: line + ' L' + w + ' ' + h + ' L0 ' + h + ' Z' };
  }
  function delta(cur, prev, unit, goodUp) {
    if (cur == null || prev == null) return '<span class="pill" style="background:#F3F1EC;color:#56605B">new</span>';
    var d = cur - prev; if (Math.abs(d) < 0.05) return '<span class="pill" style="background:#F3F1EC;color:#56605B">no change</span>';
    var good = goodUp === false ? d < 0 : d > 0;
    return '<span class="pill num" style="' + (good ? 'background:#E6F0EA;color:#1F5A41' : 'background:#FCEBDD;color:#A8441A') + '">' + (d > 0 ? '▲ ' : '▼ ') + Math.abs(d).toFixed(1) + (unit || '') + '</span>';
  }
  function avatar(name, size) {
    var hues = ['#DCE5DD', '#F1E2D3', '#E3E0F0', '#F3DADA', '#DDE7EE', '#ECE6CF'];
    var ini = String(name || '?').split(/\s+/).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase();
    return '<span aria-hidden="true" style="width:' + size + 'px;height:' + size + 'px;border-radius:999px;background:' + hues[(name || 'x').charCodeAt(0) % hues.length] + ';font-size:' + Math.round(size * .34) + 'px;font-weight:600;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0">' + esc(ini) + '</span>';
  }
  function bbadge(b) { return '<span aria-hidden="true" style="width:26px;height:26px;border-radius:999px;background:' + bcol(b) + ';color:#fff;font-size:10.5px;font-weight:600;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0">' + esc(short(b) === 'Cedar Park' ? 'CP' : short(b).charAt(0)) + '</span>'; }
  function chipScore(s) { return s >= 85 ? 'background:#E6F0EA;color:#1F5A41' : (s >= 70 ? 'background:#F3F1EC;color:#3B4541' : 'background:#FCEBDD;color:#A8441A'); }
  function chipOut(o) { return o === 'Booked' ? 'background:#E6F0EA;color:#1F5A41' : (o === 'Not Booked' ? 'background:#FCEBDD;color:#A8441A' : (o === 'Transferred' ? 'background:#E8EAF4;color:#3A4380' : 'background:#F3F1EC;color:#3B4541')); }
  function skel(h, n) { var s = ''; for (var i = 0; i < (n || 1); i++) s += '<div class="skel" style="height:' + h + 'px;margin:8px 0"></div>'; return s; }
  function errBox(e) { var m = e && e.status && e.status < 500 && e.status !== 408 && e.message ? esc(e.message) : 'This is taking longer than usual.'; return '<div class="oq-card" style="color:#A8441A">' + m + ' <button class="more" data-act="retry">Try again</button></div>'; }
  function iconPath(k) {
    return {
      overview: 'M4 5h16v14H4zM4 9h16M9 9v10', phone: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z', brands: 'M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6', csrs: 'M16 19v-1a4 4 0 0 0-8 0v1M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M20 19v-1a3 3 0 0 0-2-2.8M17 5.2a3 3 0 0 1 0 5.6',
      cardcap: 'M2 6h20v12H2zM2 10h20M6 15h4', calib: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01', calls: 'M12 21a9 9 0 1 0-9-9c0 1.6.4 3 1.1 4.3L3 21l4.7-1.1A9 9 0 0 0 12 21zM10 9v6l5-3z', insights: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
      kb: 'M4 5a2 2 0 0 1 2-2h5v18H6a2 2 0 0 0-2 2zM20 5a2 2 0 0 0-2-2h-5v18h5a2 2 0 0 1 2 2z', settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
      hub: 'M12 3l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8-4.2-4.1 5.9-.9z', hubask: 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z', hubwins: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3',
      scorecards: 'M9 3h6v3H9zM7 4.5H5V21h14V4.5h-2M8 11h8M8 15h8M8 19h5', reporting: 'M12 3v12M7 10l5 5 5-5M4 17v3h16v-3', money: 'M12 2v20M17 6.5c0-1.9-2.2-3.5-5-3.5s-5 1.6-5 3.5 2.2 3.2 5 3.5 5 1.6 5 3.5-2.2 3.5-5 3.5-5-1.6-5-3.5', team: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M2 20v-1a5 5 0 0 1 10 0v1M17 11a3 3 0 1 0 0-6M22 20v-1a5 5 0 0 0-4-4.9', qasettings: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h12M20 18h0M15 4v4M9 10v4M18 16v4'
    }[k];
  }

  // ---------------- nav + top bar ----------------
  var NAV = CFG.csrSelf ? [['', [['hub', 'Home'], ['hubask', 'Ask my coach'], ['hubwins', 'My wins']]]] : [['', [['overview', 'Overview'], ['insights', 'Insights']].concat(CFG.phone === false ? [] : [['phone', 'Phone stats']]).concat(LOCK ? [] : [['brands', 'Brands']]).concat([['csrs', 'CSRs'], ['calls', 'Call reviews'], ['cardcap', 'Card capture'], ['money', 'Revenue'], ['reporting', 'Reporting']]).concat([['hub', 'Coaching Hub']]).concat(!LOCK && ROLE !== 'viewer' ? [['calib', 'Calibration']] : [])],
    ['YOUR SETUP', [['qasettings', 'QA settings'], ['kb', 'Knowledge base']].concat(IS_ADMIN ? [['team', 'Team & access']] : [])]];
  function renderWho() {
    var w = $('oqwho'); if (!w) return;
    w.innerHTML = '<b>' + esc(CFG.userName || '') + '</b><span>' + esc(RNAME[ROLE] || '') + (LOCK ? ' · ' + esc(short(LOCK)) : '') + '</span>' +
      '<span style="display:flex;gap:14px;flex-wrap:wrap">' + (CFG.onClassic ? '<button data-act="classic">Classic view</button>' : '') + (CFG.onSignOut ? '<button data-act="signout">Sign out</button>' : '') + '</span>';
  }
  function renderNav() {
    var cur = S.view === 'brand' ? 'brands' : (S.view === 'csr' ? 'csrs' : (S.view === 'repeat' ? 'insights' : (S.view === 'hubqs' ? 'hub' : S.view)));
    $('nav').innerHTML = NAV.map(function (sec) {
      return (sec[0] ? '<div class="navsec">' + sec[0] + '</div>' : '') + sec[1].map(function (n) {
        return '<button class="' + (cur === n[0] ? 'on' : '') + '" data-go="' + n[0] + '"' + (cur === n[0] ? ' aria-current="page"' : '') + '><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + iconPath(n[0]) + '"/></svg>' + n[1] + '</button>';
      }).join('');
    }).join('');
  }
  var RANGES = [['today', 'Today'], ['yesterday', 'Yesterday'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['month', 'This month'], ['lastmonth', 'Last month'], ['custom', 'Custom…']];
  function rangeLabel() { if (S.range === 'custom') return fdate(S.start) + ' – ' + fdate(S.end); var r = RANGES.filter(function (x) { return x[0] === S.range; })[0]; return r ? r[1] : ''; }
  // Example question follows the brand on screen (2026-10-26)
  function askBrand() { return LOCK ? short(LOCK) : S.brands.length === 1 ? short(S.brands[0]) : null; }
  function askEx() { var b = askBrand(); return b ? 'Who is the top performer at ' + b + '?' : 'Which brand has the best booking rate?'; }
  function topbar() {
    var bl = S.view === 'brand' && S.brand ? short(S.brand) : S.brands.length ? (S.brands.length === 1 ? short(S.brands[0]) : S.brands.length + ' brands') : 'All brands';
    return '<div class="row" style="align-items:center;position:relative">' + (HIST.length ? '<button class="sel" data-oqback="1" aria-label="Back to the previous page" title="Back to the previous page" style="min-height:46px">\u2190 Back</button>' : '') +
      '<form id="askform" style="flex:1 1 360px;max-width:620px;display:flex;align-items:center;gap:10px;background:#fff;border:1.5px solid #CFE3D8;border-radius:12px;padding:0 6px 0 14px;min-height:46px">' +
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2F7D5B" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>' +
      '<label for="askq" class="sr">Ask anything about your calls</label><input id="askq" autocomplete="off" placeholder="Ask anything — “' + esc(askEx()) + '”" style="flex:1;min-width:0;border:none;outline:none;background:transparent;font-size:14px">' +
      '<button class="sel btnd" type="submit" style="min-height:36px;padding:6px 14px">Ask</button></form>' +
      '<div style="flex:1 1 0"></div>' +
      (LOCK ? '<span class="sel" style="cursor:default">' + esc(short(LOCK)) + '</span>' : '<button class="sel" data-pop="brands" aria-haspopup="true">' + esc(bl) + ' ▾</button>') +
      (/^hub/.test(S.view) ? (SELF ? '<span class="sel" style="cursor:default" title="The Coaching Hub runs week by week, Monday to Sunday">' + esc((HUB.roster && HUB.roster.week_label) || 'This week') + '</span>' : '<label class="sr" for="hubwk">Week</label><select id="hubwk" class="sel" data-hubweek="1" title="The Coaching Hub runs week by week, Monday to Sunday. Pick a past week to look back." style="cursor:pointer">' + hubWeeks().map(function (w) { return '<option value="' + w[0] + '"' + (HUB.week === w[0] ? ' selected' : '') + '>' + esc(w[1]) + '</option>'; }).join('') + '</select>') : '<button class="sel" data-pop="range" aria-haspopup="true">' + esc(rangeLabel()) + ' ▾</button>') +
      popHtml() + '</div>' +
      (CFG.staff ? '<div class="banner"><b>Opsis view</b> · You’re seeing ' + esc(CLIENT) + '’s portal as an account admin. Changes you make here are real and are logged.</div>' : '');
  }
  function popHtml() {
    if (S.pop === 'range') {
      return '<div class="pop" style="right:0;top:52px"><div class="cap" style="margin-bottom:8px">Date range</div><div style="display:flex;flex-direction:column;gap:4px">' +
        RANGES.filter(function (r) { return r[0] !== 'custom'; }).map(function (r) { return '<button class="chip' + (S.range === r[0] ? ' on' : '') + '" data-range="' + r[0] + '">' + r[1] + '</button>'; }).join('') +
        '</div><div class="cap" style="margin:12px 0 6px">Custom</div><div style="display:flex;gap:6px;align-items:center"><label class="sr" for="cs">Start</label><input id="cs" type="date" class="oq-field" value="' + S.start + '"><span class="mut">–</span><label class="sr" for="ce">End</label><input id="ce" type="date" class="oq-field" value="' + S.end + '"></div><button class="sel btnd" data-act="customrange" style="margin-top:8px;width:100%;justify-content:center">Apply</button></div>';
    }
    if (S.pop === 'brands') {
      var list = KNOWN.brands.length ? KNOWN.brands : [];
      return '<div class="pop" style="right:150px;top:52px"><div class="cap" style="margin-bottom:8px">Brands</div>' +
        '<label style="display:flex;gap:10px;align-items:center;padding:6px 4px;font-weight:600"><input type="checkbox" data-allbrands ' + (S.brands.length || (S.view === 'brand' && S.brand) ? '' : 'checked') + '> All brands</label>' +
        list.map(function (b) { return '<label style="display:flex;gap:10px;align-items:center;padding:6px 4px"><input type="checkbox" data-brandcb="' + esc(b) + '" ' + (S.brands.indexOf(b) >= 0 || (S.view === 'brand' && !S.brands.length && b === S.brand) ? 'checked' : '') + '> ' + esc(b) + '</label>'; }).join('') +
        (list.length ? '' : '<div class="mut">Loading…</div>') + '<button class="sel btnd" data-act="closepop" style="margin-top:8px;width:100%;justify-content:center">Done</button></div>';
    }
    return '';
  }

  // ---------------- views ----------------
  function setMain(html) { $('main').innerHTML = topbar() + html + '<div class="foot">Powered by <b>Opsis CX</b> · ' + esc(CLIENT) + ' call quality</div>'; }

  // Keep "Calls to review" no taller than the call-flow card beside it (it scrolls), so the
  // next row sits right under both instead of leaving a gap under the shorter card.
  function fitReview() {
    var s = $('stepcard'), r = $('reviewcard'); if (!s || !r) return;
    if (s.querySelector('.skel')) return;
    var side = Math.abs(r.getBoundingClientRect().top - s.getBoundingClientRect().top) < 4;
    r.style.maxHeight = side ? Math.max(260, s.offsetHeight) + 'px' : '470px';
  }
  function vOverview(tok) {
    setMain('<div class="hero" style="position:relative;overflow:hidden;border-radius:16px;padding:16px 8px 8px;min-height:120px">' +
      '<svg viewBox="0 0 700 180" preserveAspectRatio="xMaxYMid slice" style="position:absolute;right:0;top:0;width:60%;height:100%" aria-hidden="true"><path d="M0 180 C120 150 180 70 300 90 C420 110 470 20 560 30 C620 36 660 10 700 0 L700 180 Z" fill="#DCE5DD"/><path d="M80 180 C200 140 260 110 360 120 C470 132 520 60 610 70 C650 75 680 60 700 50 L700 180 Z" fill="#C6D5C9"/><path d="M200 180 C300 160 360 140 450 146 C540 152 600 110 700 100 L700 180 Z" fill="#A9C0AF"/><path d="M330 180 C420 170 500 160 580 164 C640 167 680 150 700 146 L700 180 Z" fill="#8AAA93"/></svg>' +
      '<div style="position:relative"><div class="cap" style="letter-spacing:.3em">GarageCo · Call quality intelligence</div><h1 style="margin:10px 0 0;font-size:34px;font-weight:600;line-height:1.1;letter-spacing:-0.03em">Turn every conversation<br>into a booked job.</h1></div></div>' +
      '<div id="kpis" class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">' + skel(118, 1).repeat(5) + '</div>' +
      '<div class="oq-card" id="needscard">' + skel(60, 1) + '</div>' +
      '<div class="row" style="align-items:flex-start"><div class="oq-card" style="flex:3 1 520px;min-width:0" id="fcrcard">' + skel(24, 6) + '</div><div class="oq-card" style="flex:2 1 420px;min-width:0" id="sentcard">' + skel(24, 6) + '</div></div>' +
      '<div class="oq-card" id="tempcard">' + skel(24, 4) + '</div>' +
      '<div class="row"><div class="oq-card" style="flex:999 1 520px" id="brandcard">' + skel(30, 8) + '</div><div class="oq-card" style="flex:1 1 320px" id="coachcard">' + skel(40, 5) + '</div></div>' +
      '<div class="row" style="align-items:flex-start"><div class="oq-card" style="flex:999 1 420px" id="stepcard">' + skel(18, 9) + '</div><div class="oq-card" style="flex:1 1 360px;max-height:470px;overflow-y:auto" id="reviewcard">' + skel(50, 4) + '</div></div>' +
      '<div class="row" style="align-items:flex-start"><div class="oq-card" style="flex:999 1 520px" id="trendcard">' + skel(200, 1) + '</div><div class="ai" style="flex:1 1 360px" id="insightcard">' + skel(30, 4) + '</div></div>');
    Promise.all([loadReport(), loadPrevReport()]).then(function (r) {
      if (tok !== T) return; var cur = r[0], prev = r[1]; noteKnown(cur);
      kpiCards(cur);
      LASTBR = [cur, prev]; brandTable(cur, prev, 'brandcard', 8);
      coachCard(cur);
      trendCard(cur);
      insightCard(cur, prev);
    }).catch(function (e) { if (tok === T) $('kpis').outerHTML = errBox(e); });
    loadFocus(null, null).then(function (f) { if (tok === T) stepCard(f, 'stepcard', null, null); fitReview(); }).catch(function () {});
    api(Object.assign({ action: 'calls' }, win({ winnable: true, score_max: 40, limit: 5 }))).then(function (c) { if (tok === T) reviewCard(c); }).catch(function () {});
    needsCard(tok);
    api(Object.assign({ action: 'qaextras' }, win())).then(function (x) { if (tok === T) { EXTRAS = x || {}; drawFcr(); drawSent(); drawTemper(); kpiLate(); if (LASTBR) brandTable(LASTBR[0], LASTBR[1], 'brandcard', 8); } }).catch(function () { var a = $('fcrcard'), b = $('sentcard'); if (a) a.innerHTML = '<div class="mut">First contact resolution couldn\u2019t load.</div>'; if (b) b.innerHTML = '<div class="mut">Sentiment couldn\u2019t load.</div>'; var c = $('tempcard'); if (c) c.innerHTML = '<div class="mut">Temper shift couldn\u2019t load.</div>'; });
  }

  var BKEY = 'oqBrands:' + CLIENT;
  try { var bc = JSON.parse(localStorage.getItem(BKEY) || '[]'); if (Array.isArray(bc)) KNOWN.brands = bc.filter(function (x) { return typeof x === 'string'; }); } catch (x) {}
  function setKnownBrands(list, full) { if (!list.length) return; if (full) BRDONE = true; else list = list.concat(KNOWN.brands).filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(); var same = list.join('|') === KNOWN.brands.join('|'); KNOWN.brands = list; try { localStorage.setItem(BKEY, JSON.stringify(list)); } catch (x) {} if (!same && S.pop === 'brands') render(); }
  var BRLOAD = null, BRDONE = false;
  function ensureBrands() {
    if (BRLOAD || BRDONE || LOCK) return;
    BRLOAD = api(Object.assign({ action: 'report' }, win({ brands: null, start: addDays(todayET(), -45), end: todayET() }))).then(function (rep) { setKnownBrands((rep.brands || []).map(function (b) { return b.brand; }).filter(function (b) { return b && b !== '—'; }).sort(), true); BRDONE = true; }).catch(function () {}).then(function () { BRLOAD = null; });
  }
  // The brand picker always lists every brand with calls in the last 45 days, whatever range is on screen
  // (a quiet day used to shrink the list to the few brands that had calls that day).
  setTimeout(ensureBrands, 1200);
  function noteKnown(rep) {
    if (!S.brands.length) setKnownBrands((rep.brands || []).map(function (b) { return b.brand; }).filter(function (b) { return b && b !== '—'; }).sort());
    (rep.agents || []).forEach(function (a) { if (a.scored >= 40 && KNOWN.agents.indexOf(a.name) < 0) KNOWN.agents.push(a.name); });
  }

  function kpiGo(k) { if (k === 'aov') { go('money'); return true; } if (KPID[k]) { S.kpi = k; S.kpiOff = 0; go('kpi'); return true; } return false; }
  function kpiCards(rep) {
    var k = rep.kpis || {}, p = rep.prev || {}, d = rep.daily || [];
    var daily = d.filter(function (x) { return x.calls >= 100; });
    var defs = [
      ['Inbound calls handled', fmt((rep.funnel || {}).conversations || 0), (function (c0, p0) { return p0 ? delta(100 * (c0 - p0) / p0, 0, '%') : delta(null, null); })((rep.funnel || {}).conversations || 0, (rep.prev || {}).scored || 0), G, 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2', daily.map(function (x) { return x.calls; }), '<b>Inbound calls handled</b><br>Customer conversations on INBOUND calls answered by the front-line CSRs on the scorecard list (plus the AI receptionists), all of them scored.<br><br>Not counted: outbound calls, CSRs who aren’t on the list, voicemail, internal staff calls, phone-menu hang-ups, wrong numbers and spam.<br><br>Change = % vs the previous period of the same length. Click to see the calls.', 'allcalls'],
      ['Avg QA score', k.avg != null ? k.avg.toFixed(1) : '—', delta(k.avg, p.avg, ''), G, 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.3 6L12 16.4 6.6 19.4l1.3-6L3.4 9.3l6-.7z', daily.map(function (x) { return x.avg; }), '<b>Avg QA score</b><br>Average call-flow score (0–100) of the inbound calls handled. Each step the CSR did earns its points; a step that didn’t apply to the call counts as done.<br><br>Change = points vs the previous period. Click to see the lowest-scoring calls.', 'lowscore'],
      ['Booking rate', p1(k.booking_rate), delta(k.booking_rate, p.booking_rate, ' pts'), G, 'M5 5h14v15H5zM5 9h14M9 3v4M15 3v4M9 14l2 2 4-4', daily.map(function (x) { return x.decided ? x.booked / x.decided * 100 : null; }), '<b>Booking rate</b><br>Booked calls ÷ booking opportunities that ended booked or not booked. Opportunities transferred to another team are left out, and so are calls with no booking opportunity. The Insights cohort bar shows the same counts.<br><br>Change = points vs the previous period. Click to see calls that didn’t book.', 'notbooked'],
      ['Ask rate · not booked', '<span id="kpiasknb">…</span>', '', O, 'M21 12a9 9 0 1 1-4.2-7.6M21 4v5h-5', [], '<b>Ask rate · not booked</b><br>Of the booking opportunities that did NOT book, the share where the CSR still directly asked to put the customer on the schedule. Low = customers leaving without being asked.<br><br>Click to hear the ones where the CSR didn’t ask.', 'asknb'],
      ['Card asked', '<span id="kpicard">…</span>', '', O, 'M3 6h18v12H3zM3 10h18M7 15h3', [], CARD_DEF, 'nocard'],
      ['Avg order value', '<span id="kpiaov">…</span>', '', G, 'M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6', [], '<b>Avg order value</b><br>Average value of a booked job. Each booked call gets its brand’s average won-job total from Acumatica for its type (residential or commercial, service or sales, warranty). Where an invoice is matched to the call, its real amount is used instead.<br><br><b>est.</b> means it’s built from those averages rather than each call’s own invoice.<br><br>Click for the Revenue page.', 'aov']
    ];
    var h = defs.map(function (x) {
      var s = series(x[5], 200, 34, 3), bg = x[3] === G ? '#E6F0EA' : '#FCEBDD';
      return '<button class="oq-card click" data-kpi="' + x[7] + '" aria-label="' + esc(x[0] + '. ' + String(x[6]).replace(/<[^>]+>/g, ' ')) + '" style="padding:16px 18px 12px;text-align:left;font:inherit;color:inherit"><div style="display:flex;align-items:center;gap:12px"><div style="width:34px;height:34px;border-radius:9px;background:' + bg + ';display:flex;align-items:center;justify-content:center"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="' + x[3] + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + x[4] + '"/></svg></div><span class="cap">' + x[0] + '</span><span aria-hidden="true" data-tip="' + esc(x[6]) + '" title="" style="margin-left:auto;cursor:help;width:18px;height:18px;border-radius:99px;border:1px solid #CFCAC0;color:#8A918D;font-size:11px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0">i</span></div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:14px"><span class="num" style="font-size:34px;font-weight:600;letter-spacing:-0.03em;line-height:1">' + x[1] + '</span>' + x[2] + '</div>' +
        (x[5].length ? '<svg width="100%" height="34" viewBox="0 0 200 34" preserveAspectRatio="none" style="display:block;margin-top:8px" aria-hidden="true"><path d="' + s.area + '" fill="' + x[3] + '" fill-opacity=".1"/><path d="' + s.line + '" fill="none" stroke="' + x[3] + '" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>' : '<div id="kpisub-' + x[7] + '" class="mut" style="font-size:12px;margin-top:12px;min-height:30px"></div>') + '<div class="mut" style="font-size:11px;margin-top:4px">' + (x[5].length ? 'vs previous ' + daysBetween(S.start, S.end) + ' days · ' : '') + 'click for ' + (x[7] === 'aov' ? 'revenue' : 'calls') + '</div></button>';
    }).join('');
    var f = rep.funnel || {}, ratio = f.calls ? Math.round(f.conversations / f.calls * 100) : 0, dash = (ratio / 100 * 188.5).toFixed(1);
    if (0) h += '<div class="oq-card" style="padding:16px 18px"><div class="cap">Conversations reviewed</div><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:12px"><div><div class="num" style="font-size:30px;font-weight:600;letter-spacing:-0.03em;line-height:1">' + fmt(f.conversations) + '</div><div class="mut" style="font-size:12px;margin-top:6px">of ' + fmt(f.calls) + ' total calls</div></div>' +
      '<div style="position:relative;width:70px;height:70px;flex-shrink:0"><svg width="70" height="70" viewBox="0 0 72 72" role="img" aria-label="' + ratio + ' percent were real conversations"><circle cx="36" cy="36" r="30" fill="none" stroke="#EEEBE4" stroke-width="7"/><circle cx="36" cy="36" r="30" fill="none" stroke="#14302A" stroke-width="7" stroke-linecap="round" stroke-dasharray="' + dash + ' 188.5" transform="rotate(-90 36 36)"/></svg><span class="num" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600">' + ratio + '%</span></div></div><div class="mut" style="font-size:11px;margin-top:8px">The rest were voicemail, internal, IVR or wrong numbers.</div></div>';
    $('kpis').innerHTML = h; kpiLate();
  }
  var CARD_SKIP = ['PDQ', 'Dan\u2019s Doors', "Dan's Doors"];
  var CARD_DEF = '<b>Card asked</b><br><b>Booked residential service calls only</b> (repairs, springs, openers, tune-ups; not new doors, installs or commercial customers) where the CSR asked for a credit or debit card to hold the appointment. It counts as asked even if the customer said no. Paying an invoice or a deposit on finished work doesn’t count.<br><br>PDQ and Dan’s Doors are left out (they don’t take a card at booking). Same numbers as the Card capture page.<br><br>Click to compare brands and hear the booked service calls with no card ask.';
  function cardTot(cc) { var b = 0, a = 0, k = 0; ((cc || {}).by_brand || []).forEach(function (x) { if (CARD_SKIP.indexOf(x.brand) >= 0) return; b += +x.booked || 0; a += +x.asked_cc || 0; k += +x.captured_cc || 0; }); return { booked: b, asked: a, captured: k }; }
  function kpiLate() {
    var set = function (id, v, sub) { var e = $(id); if (e) e.innerHTML = v; var su = $('kpisub-' + (id === 'kpiaov' ? 'aov' : 'asknb')); if (su && sub != null) su.innerHTML = sub; };
    var fill = function () { var a = askNb(((EXTRAS || {}).asknb || {}).by_brand); if (!a && EXTRAS && EXTRAS.asknb) a = (function (o) { return o && o.nb ? { pct: 100 * o.asked / o.nb, nb: o.nb, asked: o.asked } : null; })(EXTRAS.asknb.overall);
      set('kpiasknb', a ? a.pct.toFixed(1) + '%' : '—', a ? fmt(a.asked) + ' of ' + fmt(a.nb) + ' not-booked opportunities had a direct ask' : 'No not-booked opportunities in this range'); };
    if (EXTRAS && EXTRAS.asknb) fill(); else loadExtras().then(fill).catch(function () { set('kpiasknb', '—', ''); });
    api(Object.assign({ action: 'cardcap' }, win())).then(function (cc) { var t = cardTot(cc), e = $('kpicard'), su = $('kpisub-nocard'); if (e) e.innerHTML = t.booked ? (100 * t.asked / t.booked).toFixed(1) + '%' : '—'; if (su) su.innerHTML = t.booked ? fmt(t.asked) + ' of ' + fmt(t.booked) + ' booked residential service calls had a card ask' : 'No booked residential service calls in this range'; }).catch(function () { var e = $('kpicard'); if (e) e.innerHTML = '—'; });
    api(Object.assign({ action: 'money' }, { start: S.start, end: S.end, brands: S.brands.length ? S.brands : null })).then(function (m) { var t = (m || {}).totals || {}, n = (+t.booked || 0) - (+t.booked_unvalued || 0);
      set('kpiaov', n > 0 && +t.booked_value ? '$' + Math.round(t.booked_value / n).toLocaleString() + (+t.booked_actual_n ? '' : '<span style="font-size:13px;font-weight:600;color:#8A5A00;margin-left:6px">est.</span>') : '—', n > 0 ? (+t.booked_actual_n ? fmt(t.booked_actual_n) + ' of ' + fmt(n) + ' booked jobs matched to invoices' : ((m || {}).group_values || []).length ? 'Each booked job uses its brand’s Acumatica average for its type (residential or commercial, service or sales)' : 'Estimate only: no invoices loaded yet, so every job uses the job value set on the Revenue page') : 'Add job values on the Revenue page'); }).catch(function () { set('kpiaov', '—', ''); });
  }

  var LASTBR = null;
  function brandRows(cur, prev) {
    var pm = {}; (prev && prev.brands || []).forEach(function (b) { pm[b.brand] = b; });
    return (cur.brands || []).filter(function (b) { return b.brand && b.brand !== '—'; }).map(function (b) {
      var pb = pm[b.brand] || {};
      var an = askNb(((EXTRAS || {}).asknb || {}).by_brand, b.brand);
      return { name: b.brand, calls: b.calls, avg: b.avg, pavg: pb.avg, rate: pct(b.booked, b.decided), prate: pct(pb.booked, pb.decided), cc: pct(b.cc_collected, b.booked_calls), asknb: an ? an.pct : null, handed: b.handed_off, opps: b.opps };
    });
  }
  function sortRows(rows, key) {
    var f = { calls: function (r) { return -r.calls; }, avg: function (r) { return -(r.avg || 0); }, rate: function (r) { return -(r.rate || 0); }, cc: function (r) { return -(r.cc || 0); }, asknb: function (r) { return -(r.asknb || 0); }, change: function (r) { return r.pavg == null ? -99 : -(r.avg - r.pavg); } }[key] || function (r) { return -r.calls; };
    var dir = S.brandDir || 1;
    if (key === 'name') return rows.slice().sort(function (a, b) { return dir * short(a.name).localeCompare(short(b.name)); });
    return rows.slice().sort(function (a, b) { return dir * (f(a) - f(b)); });
  }
  function brandTable(cur, prev, el, limit) {
    var rows = sortRows(brandRows(cur, prev), S.brandSort), shown = limit ? rows.slice(0, limit) : rows;
    var th = function (k, l, t) { var on = S.brandSort === k, asc = (k === 'name') === ((S.brandDir || 1) === 1); return '<th class="sortable" data-bsort="' + k + '" title="' + esc(t) + ' · click again to reverse" aria-sort="' + (on ? (asc ? 'ascending' : 'descending') : 'none') + '">' + l + (on ? (asc ? ' ↑' : ' ↓') : '') + '</th>'; };
    var h = '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap"><div><h2 class="ttl">Performance by Brand</h2><p class="sub">Click a brand to see why it’s trending the way it is.</p></div>' + (limit ? '<button class="more" data-go="brands">All ' + rows.length + ' brands →</button>' : '') + '</div>' +
      '<p class="swipe mut" style="display:none;font-size:11.5px;margin:8px 0 0">Swipe sideways for more columns →</p><div style="overflow-x:auto;margin-top:12px"><table class="tbl"><thead><tr>' + th('name', 'Brand', 'Sort A–Z') + '' + th('calls', 'Inbound calls handled', 'Inbound customer conversations handled') + th('avg', 'Avg QA score', 'Average call-flow (QA) score, 0–100') + th('change', 'Change', 'Score change vs the previous period') + th('rate', 'Booking rate', 'Booked ÷ calls with a booking decision') + th('asknb', 'Ask rate · not booked', 'Not-booked opportunities where the CSR still asked for the booking') + '<th></th></tr></thead><tbody>';
    shown.forEach(function (r) {
      h += '<tr class="click" data-brand="' + esc(r.name) + '" tabindex="0"><td><div style="display:flex;align-items:center;gap:10px">' + bbadge(r.name) + '<span style="font-weight:600">' + esc(short(r.name)) + '</span></div></td><td class="num">' + fmt(r.calls) + '</td><td class="num">' + (r.avg != null ? r.avg.toFixed(1) : '—') + '</td><td>' + delta(r.avg, r.pavg, '') + '</td>' +
        '<td><div style="display:flex;align-items:center;gap:8px;min-width:120px"><span class="num" style="width:44px">' + p1(r.rate) + '</span><div class="track" style="flex:1"><div style="background:' + ((r.rate || 0) >= 60 ? G : O) + ';width:' + (r.rate || 0) + '%"></div></div></div></td>' +
        '<td class="num">' + (r.asknb != null ? r.asknb.toFixed(0) + '%' : '<span class="mut">—</span>') + '</td><td class="mut" aria-hidden="true">›</td></tr>';
    });
    $(el).innerHTML = h + '</tbody></table></div>';
  }

  function agentRows(cur, prev, minCalls) {
    var pm = {}; (prev && prev.agents || []).forEach(function (a) { pm[a.name] = a; });
    return (cur.agents || []).filter(function (a) { return a.scored >= (minCalls || 1); }).map(function (a) {
      var pa = pm[a.name] || {};
      return { name: a.name, brand: a.brand, calls: a.scored, avg: a.avg, pavg: a.prev_avg != null ? a.prev_avg : pa.avg, rate: pct(a.booked, a.decided), ask: pct(a.asked, a.opps), opps: a.opps, cc: a.cc_collected, xo: a.xfer_out || 0, xi: a.xfer_in || 0 };
    });
  }
  function coachCard(rep) {
    var AIS = ['Dane', 'Sophia', 'Jason'], rows = [], tiers = [[100, 40], [50, 20], [25, 10], [10, 5], [3, 2], [1, 1]], tierUsed = null;
    for (var ti = 0; ti < tiers.length && rows.length < 3; ti++) { rows = agentRows(rep, null, tiers[ti][0]).filter(function (a) { return a.opps >= tiers[ti][1] && a.ask != null && AIS.indexOf(a.name) < 0; }).sort(function (a, b) { return a.ask - b.ask || b.opps - a.opps; }).slice(0, 5); tierUsed = tiers[ti]; }
    var h = '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px"><div><h2 class="ttl">Top Coaching Opportunities</h2><p class="sub">Busiest CSRs who ask for the booking least often</p></div><button class="more" data-go="csrs">All CSRs →</button></div>';
    if (!rows.length) h += '<p class="mut">No scored booking opportunities in this period yet.</p>';
    else if (tierUsed && tierUsed[1] < 40) h += '<p class="mut" style="font-size:11.5px;margin:-4px 0 6px">Short period, so this includes CSRs with ' + tierUsed[1] + '+ booking opportunities.</p>';
    rows.forEach(function (c, i) {
      h += '<button class="click" data-agent="' + esc(c.name) + '" style="all:unset;box-sizing:border-box;cursor:pointer;width:100%;display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid var(--line2)"><span style="width:26px;height:26px;border-radius:999px;font-size:12px;font-weight:600;display:inline-flex;align-items:center;justify-content:center;' + (i < 3 ? 'background:#FCEBDD;color:#A8441A' : 'background:#F3F1EC') + '">' + (i + 1) + '</span>' + avatar(c.name, 34) +
        '<span style="flex:1;min-width:0"><span style="display:block;font-weight:600">' + esc(c.name) + '</span><span class="mut" style="display:block;font-size:11.5px">' + esc(short(c.brand)) + ' · ' + fmt(c.calls) + ' calls</span><span class="track" style="display:block;margin-top:6px;width:110px"><span style="display:block;height:100%;border-radius:999px;background:' + G + ';width:' + c.ask + '%"></span></span></span>' +
        '<span style="text-align:right"><span class="num" style="display:block;font-size:15px;font-weight:600">' + c.ask.toFixed(0) + '%</span><span class="mut" style="display:block;font-size:11px">ask rate</span></span><span class="mut" aria-hidden="true">›</span></button>';
    });
    $('coachcard').innerHTML = h;
  }

  function stepCard(f, el, brand, agent) {
    var steps = (f.steps || []).filter(function (s) { return s.applies > 0; });
    var h = '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px"><div><h2 class="ttl">Call Flow Performance</h2><p class="sub">How often each step is done when it applies · click a step to hear the calls that missed it. Calls before Oct 22, 2026 count through the matching step of the earlier call flow; Card on file, Overcome the objection and Tech is the expert are tracked from Oct 22 on.</p></div></div><div style="display:flex;flex-direction:column;gap:4px;margin-top:12px">';
    steps.forEach(function (s) {
      var c = s.rate >= 70 ? G : (s.rate >= 45 ? '#E8A06A' : O);
      h += '<button class="click" data-step="' + s.key + '"' + (brand ? ' data-sbrand="' + esc(brand) + '"' : '') + (agent ? ' data-sagent="' + esc(agent) + '"' : '') + ' title="' + fmt(s.missed) + ' of ' + fmt(s.applies) + ' calls missed this step" style="all:unset;box-sizing:border-box;cursor:pointer;display:grid;grid-template-columns:minmax(120px,190px) minmax(0,1fr) 44px 64px;gap:12px;align-items:center;font-size:12.5px;padding:6px 4px;border-radius:8px"><span style="color:#3B4541">' + esc(STEPNAMES[s.key] || s.key) + '</span><span style="height:14px;border-radius:3px;background:#F1EEE8;overflow:hidden;display:block"><span style="display:block;height:100%;border-radius:3px;background:' + c + ';width:' + s.rate + '%"></span></span><span class="num" style="text-align:right;font-weight:600">' + s.rate + '%</span><span style="text-align:right">' + (s.prev_rate != null ? delta(s.rate, s.prev_rate, '') : '<span class="mut" style="font-size:11px">new step</span>') + '</span></button>';
    });
    $(el).innerHTML = h + '</div>';
  }

  var NEEDS_TIP = { upset: '<b>Upset customers</b><br>Customer conversations where the customer was upset, angry or complained.', low: '<b>Low scores</b><br>Real booking opportunities where the call scored 40 or under.', ctrl: '<b>Controllable misses</b><br>Booking opportunities that didn’t book for a reason the CSR could have fixed, such as not asking for the booking or not knowing the answer.', other: '<b>Other not booked</b><br>Booking opportunities that didn’t book where the customer said no after being asked, or another team owns the follow-up.' };
  var NEEDS = [['upset', 'Upset customers', 'Upset, angry or complaint signs on the call', '#B42318', '#FDECEA'],
    ['low', 'Low scores', 'Real opportunities scored 40 or under', '#C2551F', '#FFF4E8'],
    ['ctrl', 'Controllable misses', 'Not booked for a reason the CSR could fix', '#8A5A00', '#FBF3DF'],
    ['other', 'Not booked: outside CSR control', 'Not booked for a reason the CSR couldn’t control', '#3B4541', '#F3F1EC']];
  function needsCard(tok) {
    var got = {}, left = NEEDS.length;
    function draw() {
      var el = $('needscard'); if (!el) return;
      el.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap"><div><h2 class="ttl">Needs Attention</h2><p class="sub">The same lists as the 8am daily summary, for the dates and brands picked above. One row per customer conversation.</p></div></div>' +
        '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin-top:12px">' +
        NEEDS.map(function (n) { var v = got[n[0]];
          var ntip = esc(NEEDS_TIP[n[0]] + '<br><br>Front-line CSRs, inbound calls. A transfer or a quick callback from the same number counts once, in the first list it fits.');
          return '<button class="click" data-needs="' + n[0] + '" style="all:unset;box-sizing:border-box;cursor:pointer;display:flex;flex-direction:column;gap:4px;padding:12px 14px;border-radius:12px;background:' + n[4] + ';border:1px solid transparent">' +
            '<span style="display:flex;align-items:center;gap:8px;font-weight:600;font-size:13px;color:' + n[3] + '"><span aria-hidden="true" style="width:8px;height:8px;border-radius:999px;background:' + n[3] + '"></span>' + n[1] + '<span aria-hidden="true" data-tip="' + ntip + '" style="margin-left:auto;cursor:help;width:18px;height:18px;border-radius:99px;border:1px solid #CFCAC0;color:#8A918D;font-size:11px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0">i</span></span>' +
            '<span class="num" style="font-size:26px;font-weight:700;color:#1C2421">' + (v == null ? '<span class="dots"><span></span><span></span><span></span></span>' : (v < 0 ? '<span style="font-size:13px;font-weight:600;color:#A8441A">Didn’t load. Click to open the list.</span>' : fmt(v))) + '</span>' +
            '<span class="mut" style="font-size:11.5px">' + n[2] + '</span></button>'; }).join('') + '</div>';
    }
    draw();
    var one = function (n) { return api(Object.assign({ action: 'bucketcalls', bucket: n[0] }, win({ limit: 1, offset: 0 }))).then(function (r) { got[n[0]] = r.total || 0; }).catch(function () { got[n[0]] = -1; }).then(function () { if (tok === T) draw(); }); };
    one(NEEDS[0]).then(function () { if (tok === T) NEEDS.slice(1).forEach(one); });
  }
  function reviewCard(c) {
    var h = '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px"><div><h2 class="ttl">Calls to Review</h2><p class="sub">Winnable calls that didn’t book, scored 40 or lower</p></div><button class="more" data-kpi="winnable">All ' + fmt(c.total) + ' →</button></div>';
    (c.rows || []).forEach(function (r) { h += callRow(r); });
    if (!(c.rows || []).length) h += '<p class="mut">None in this period — nice.</p>';
    $('reviewcard').innerHTML = h; fitReview();
  }
  function callRow(r) {
    return '<button class="click" data-call="' + r.id + '" style="all:unset;box-sizing:border-box;cursor:pointer;width:100%;display:flex;gap:12px;align-items:flex-start;padding:12px 0;border-top:1px solid var(--line2)">' +
      '<span data-autoplay="' + r.id + '" title="Play recording" style="width:36px;height:36px;border-radius:999px;border:1px solid #E1DCD2;display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg width="11" height="11" viewBox="0 0 24 24" fill="#1C2421" aria-hidden="true"><path d="M7 4l13 8-13 8z"/></svg></span>' +
      '<span style="flex:1;min-width:0"><span style="display:flex;justify-content:space-between;gap:8px"><b style="font-weight:600">' + esc(r.agent || 'Unknown CSR') + '</b><span class="mut num" style="font-size:11.5px">' + fdate(r.date) + ' ' + fhour(r.hour) + ' · ' + fsecs(r.secs) + '</span></span>' +
      '<span class="mut" style="display:block;font-size:12px">' + esc(short(r.brand)) + (r.phone ? ' · ' + esc(r.phone) : '') + (r.topic ? ' · ' + esc(r.topic) : '') + '</span>' + xferPill(r) +
      '<span style="display:block;font-size:12.5px;line-height:1.45;margin-top:4px;color:#3B4541;white-space:normal">' + esc((r.summary || '').slice(0, 150)) + ((r.summary || '').length > 150 ? '…' : '') + '</span></span>' +
      '<span class="pill num" style="' + chipScore(r.score) + ';font-size:13px">' + r.score + '</span></button>';
  }

  function xferPill(r) {
    if (r.xfer_out) return '<span class="pill" style="background:#E8EAF4;color:#3A4380;margin-top:5px">↗ Transferred out' + (r.xfer_to ? ' to ' + esc(r.xfer_to) : '') + (r.xfer_result && r.xfer_result !== 'Unknown' ? ' · ' + esc(r.xfer_result) : '') + '</span>';
    if (r.xfer_in) return '<span class="pill" style="background:#EEF6F2;color:#1F5A41;margin-top:5px">↘ Transferred in' + (r.xfer_from ? ' from ' + esc(r.xfer_from) : '') + '</span>';
    return '';
  }
  function trendCard(rep) {
    var el = $('trendcard'); if (!el) return;
    var mode = S.tmode || 'dow', daily = rep.daily || [], DN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], DL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    var rows = [];
    if (mode === 'dow') {
      var cnt = [0, 0, 0, 0, 0, 0, 0]; daily.forEach(function (x) { if (x.calls > 0) cnt[new Date(x.d + 'T12:00:00').getDay()]++; });
      var byD = {}; (rep.dow || []).forEach(function (x) { byD[x.d] = x; });
      [1, 2, 3, 4, 5, 6, 0].forEach(function (k) { var x = byD[k]; if (!x || !cnt[k]) return; rows.push({ lab: DN[k], full: DL[k] + 's', per: x.calls / cnt[k], avg: x.avg, rate: pct(x.booked, x.decided), total: x.calls, n: cnt[k] }); });
    } else {
      var bd = daily.filter(function (x) { return x.calls >= 60; }).length || 1, tot = (rep.hourly || []).reduce(function (t, x) { return t + x.calls; }, 0);
      (rep.hourly || []).filter(function (x) { return x.calls >= tot * 0.004; }).forEach(function (x) { var h = x.h % 12 || 12, ap = x.h < 12 ? 'a' : 'p'; rows.push({ lab: h + ap, full: h + (ap === 'a' ? ' am' : ' pm') + '–' + ((x.h + 1) % 12 || 12) + ((x.h + 1) < 12 ? ' am' : ' pm'), per: x.calls / bd, avg: x.avg, rate: pct(x.booked, x.decided), total: x.calls, n: bd }); });
    }
    var tabs = '<div class="seg" role="tablist" style="display:inline-flex;background:#F3F1EC;border-radius:10px;padding:3px;gap:2px">' + [['dow', 'By day of week'], ['hour', 'By hour']].map(function (t) { var on = mode === t[0]; return '<button role="tab" aria-selected="' + on + '" data-tmode="' + t[0] + '" style="border:none;cursor:pointer;font:inherit;font-size:12.5px;padding:6px 12px;border-radius:8px;' + (on ? 'background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.08);font-weight:600' : 'background:transparent;color:#56605B') + '">' + t[1] + '</button>'; }).join('') + '</div>';
    var head = '<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;align-items:flex-start"><div><h2 class="ttl">When calls come in</h2><p class="sub">Average calls per ' + (mode === 'dow' ? 'day' : 'hour on a business day') + ' and the average QA score · hover a bar for details</p></div>' + tabs + '</div>';
    if (!rows.length) { el.innerHTML = head + '<p class="mut" style="margin-top:14px">Not enough calls in this range.</p>'; return; }
    var maxP = Math.max.apply(null, rows.map(function (r) { return r.per; })), step = maxP > 2000 ? 500 : maxP > 800 ? 200 : maxP > 400 ? 100 : maxP > 100 ? 50 : maxP > 40 ? 10 : 5, top = Math.ceil(maxP / step) * step || 1;
    var sc = rows.filter(function (r) { return r.total >= 50; }).map(function (r) { return r.avg; }); if (!sc.length) sc = rows.map(function (r) { return r.avg; });
    var lo = Math.floor(Math.min.apply(null, sc) - 2), hi = Math.ceil(Math.max.apply(null, sc) + 1);
    var H = 200, n = rows.length;
    var grid = [0, .25, .5, .75, 1].map(function (f) { return '<div style="position:absolute;left:0;right:0;bottom:' + (f * H) + 'px;border-top:1px ' + (f ? 'dashed #ECE8E0' : 'solid #D9D4CA') + '"></div><div style="position:absolute;left:-46px;width:40px;text-align:right;bottom:' + (f * H - 7) + 'px;font-size:11px;color:#6B726E">' + fmt(Math.round(top * f)) + '</div><div style="position:absolute;right:-40px;width:34px;bottom:' + (f * H - 7) + 'px;font-size:11px;color:#14302A">' + (lo + (hi - lo) * f).toFixed(0) + '</div>'; }).join('');
    var pts = rows.map(function (r, i) { var y = Math.max(0, Math.min(1, (r.avg - lo) / (hi - lo))); return { x: (i + .5) / n * 100, y: (1 - y) * H, r: r }; });
    var line = '<svg viewBox="0 0 100 ' + H + '" preserveAspectRatio="none" style="position:absolute;left:0;top:0;width:100%;height:' + H + 'px;overflow:visible;pointer-events:none" aria-hidden="true"><polyline points="' + pts.map(function (p) { return p.x.toFixed(2) + ',' + p.y.toFixed(1); }).join(' ') + '" fill="none" stroke="#14302A" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>' +
      pts.map(function (p) { return '<div style="position:absolute;left:calc(' + p.x + '% - 4px);top:' + (p.y - 4) + 'px;width:8px;height:8px;border-radius:99px;background:#fff;border:2px solid #14302A;pointer-events:none;box-sizing:border-box"></div>'; }).join('');
    var busiest = rows.reduce(function (m, r) { return r.per > m.per ? r : m; }), big = rows.filter(function (r) { return r.total >= 200; }), worst = (big.length ? big : rows).reduce(function (m, r) { return r.avg < m.avg ? r : m; }), best = (big.length ? big : rows).reduce(function (m, r) { return r.avg > m.avg ? r : m; });
    var bars = rows.map(function (r, i) {
      var tip = '<b>' + esc(r.full) + '</b><br>' + fmt(Math.round(r.per)) + ' calls on average' + (mode === 'dow' ? ' (' + r.n + ' ' + DL[DN.indexOf(r.lab)] + (r.n === 1 ? '' : 's') + ')' : '') + '<br>Score ' + r.avg.toFixed(1) + (r.rate != null ? ' · booking ' + r.rate.toFixed(0) + '%' : '') + '<br>' + fmt(r.total) + ' calls total';
      return '<div class="tcol" data-tip="' + esc(tip) + '" tabindex="0" aria-label="' + esc(r.full + ': ' + Math.round(r.per) + ' calls, score ' + r.avg.toFixed(1)) + '" style="flex:1;height:100%;display:flex;align-items:flex-end;justify-content:center;cursor:default;border-radius:6px"><div style="width:70%;max-width:44px;border-radius:5px 5px 1px 1px;background:' + (r === busiest ? '#8FC3B3' : '#CFE5DF') + ';height:' + (r.per / top * 100).toFixed(1) + '%"></div></div>';
    }).join('');
    var labs = rows.map(function (r) { return '<div style="flex:1;text-align:center;font-size:11.5px;color:#3B4541;font-weight:500">' + r.lab + '</div>'; }).join('');
    var nums = rows.map(function (r) { return '<div style="flex:1;text-align:center;font-size:11px;line-height:1.35"><div style="color:#3B4541">' + fmt(Math.round(r.per)) + '</div><div style="color:' + (r === worst ? '#B4461F' : '#14302A') + ';font-weight:600">' + r.avg.toFixed(1) + '</div></div>'; }).join('');
    el.innerHTML = head +
      '<div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:12px;font-size:12.5px"><span><span class="mut">Busiest</span> <b>' + busiest.full + '</b> · ' + fmt(Math.round(busiest.per)) + ' calls</span><span><span class="mut">Best score</span> <b>' + best.full + '</b> · ' + best.avg.toFixed(1) + '</span><span><span class="mut">Lowest score</span> <b style="color:#B4461F">' + worst.full + '</b> · ' + worst.avg.toFixed(1) + '</span></div>' +
      '<div style="display:flex;justify-content:space-between;font-size:11px;margin-top:14px"><span class="mut">▮ Avg calls</span><span style="color:#14302A">● QA score</span></div>' +
      '<div style="position:relative;height:' + H + 'px;margin:8px 44px 0 50px">' + grid + '<div style="position:absolute;inset:0;display:flex">' + bars + '</div>' + line + '</div>' +
      '<div style="display:flex;margin:8px 44px 0 50px">' + labs + '</div>' +
      '<div style="display:flex;margin:6px 44px 0 50px;padding-top:6px;border-top:1px solid var(--line2)">' + nums + '</div>' +
      '';
  }
  var tipEl = null;
  on(document, 'mouseover', function (e) {
    var c = e.target.closest && e.target.closest('[data-tip]');
    if (!c) { if (tipEl) tipEl.style.display = 'none'; return; }
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.style.cssText = 'position:fixed;z-index:80;pointer-events:none;background:#14302A;color:#fff;font-size:12px;line-height:1.5;padding:9px 12px;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.18);max-width:320px'; ROOT.appendChild(tipEl); }
    tipEl.innerHTML = c.getAttribute('data-tip'); tipEl.style.display = 'block';
    var r = c.getBoundingClientRect(); tipEl.style.left = Math.min(window.innerWidth - 330, Math.max(8, r.left + r.width / 2 - 160)) + 'px'; var tt = r.top - tipEl.offsetHeight - 8; tipEl.style.top = (tt < 8 ? r.bottom + 8 : tt) + 'px';
  });
  function insightCard(cur, prev) {
    var k = cur.kpis || {}, p = cur.prev || {}, items = [];
    if (k.booking_rate != null && p.booking_rate != null) items.push([(k.booking_rate >= p.booking_rate ? 'Booking rate up ' : 'Booking rate down ') + Math.abs(k.booking_rate - p.booking_rate).toFixed(1) + ' pts to ' + p1(k.booking_rate), 'vs ' + p1(p.booking_rate) + ' the period before', k.booking_rate >= p.booking_rate]);
    if (k.ask_rate != null && p.ask_rate != null) items.push(['Ask rate ' + (k.ask_rate >= p.ask_rate ? 'rose' : 'dropped') + ' from ' + Math.round(p.ask_rate) + '% to ' + Math.round(k.ask_rate) + '%', fmt(k.no_ask) + ' opportunities ended with no ask for the booking', k.ask_rate >= p.ask_rate]);
    var ob = (cur.objections || [])[0]; if (ob) items.push(['“' + ob.k + '” is the top objection', 'Heard on ' + fmt(ob.n) + ' calls', null]);
    var movers = agentRows(cur, prev, 150).filter(function (a) { return a.pavg != null; }).map(function (a) { a.d = a.avg - a.pavg; return a; }).sort(function (a, b) { return b.d - a.d; });
    if (movers.length) items.push(['Most improved: ' + movers[0].name + ' (+' + movers[0].d.toFixed(1) + ')', short(movers[0].brand) + ' · ' + movers[0].pavg + ' → ' + movers[0].avg, true]);
    var h = '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px"><div><h2 class="ttl">What changed</h2><p class="sub">Compared with the previous ' + daysBetween(S.start, S.end) + ' days</p></div></div>';
    items.forEach(function (i) {
      var c = i[2] === true ? ['#E6F0EA', G, 'M12 19V5M5 12l7-7 7 7'] : (i[2] === false ? ['#F9E0DC', '#C0392B', 'M12 5v14M5 12l7 7 7-7'] : ['#F7EBD8', '#C07A2C', 'M12 3v10M12 17v.01']);
      h += '<div style="display:flex;gap:12px;padding:11px 0;border-top:1px solid var(--line2)"><span style="width:30px;height:30px;border-radius:999px;background:' + c[0] + ';display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="' + c[1] + '" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="' + c[2] + '"/></svg></span><div><div style="font-weight:600">' + esc(i[0]) + '</div><div class="mut" style="font-size:12px;margin-top:2px">' + esc(i[1]) + '</div></div></div>';
    });
    h += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px">' + ['Why did the ask rate drop?', 'Which brand improved most?', 'Who needs coaching this week?'].map(function (q) { return '<button class="chip" data-ask="' + esc(q) + '">' + esc(q) + '</button>'; }).join('') + '</div>';
    $('insightcard').innerHTML = h;
  }

  // ---------- Brands list ----------
  function vBrands(tok) {
    setMain(crumb([['Brands']]) + '<div class="oq-card" id="brandall">' + skel(30, 10) + '</div>');
    Promise.all([loadReport(), loadPrevReport()]).then(function (r) { if (tok === T) { noteKnown(r[0]); brandTable(r[0], r[1], 'brandall', 0); } }).catch(function (e) { if (tok === T) $('brandall').innerHTML = errBox(e); });
  }

  // ---------- Brand / CSR drill-down ----------
  function vFocus(tok, kind) {
    var name = kind === 'brand' ? S.brand : S.agent;
    var title = kind === 'brand' ? short(name) : name;
    setMain(crumb(kind === 'brand' ? [['Brands', 'brands'], [title]] : [['CSRs', 'csrs'], [title]]) +
      '<div class="oq-card" style="display:flex;flex-wrap:wrap;gap:16px;align-items:center;justify-content:space-between"><div style="display:flex;align-items:center;gap:14px">' + (kind === 'brand' ? bbadge(name).replace('26px;height:26px', '44px;height:44px').replace('10.5px', '15px') : avatar(name, 44)) +
      '<div><h1 style="margin:0;font-size:24px;font-weight:600;letter-spacing:-0.025em">' + esc(kind === 'brand' ? name : name) + '</h1><div class="mut" style="font-size:12.5px">' + fdate(S.start) + ' – ' + fdate(S.end) + ' vs the ' + daysBetween(S.start, S.end) + ' days before</div></div></div>' +
      '<div class="row"><button class="sel" data-callsfor="' + kind + '">All calls →</button><button class="sel btnd" data-ask="' + esc(kind === 'brand' ? 'What should we focus on at ' + name + ' this week?' : 'How should we coach ' + name + ' this week?') + '">Ask about ' + esc(title) + '</button></div></div>' +
      '<div class="ai" id="why"><div style="display:flex;gap:10px;align-items:center"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2F7D5B" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/></svg><b>Why ' + esc(title) + ' is trending this way</b></div><div class="md" style="margin-top:10px"><span class="dots"><span></span><span></span><span></span></span> <span class="mut">Reading this period’s calls…</span></div></div>' +
      '<div id="fk" class="grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">' + skel(90, 1).repeat(4) + '</div>' +
      '<div class="row" style="align-items:flex-start"><div class="oq-card" style="flex:999 1 520px" id="fweek">' + skel(200, 1) + '</div><div class="oq-card" style="flex:1 1 360px" id="fsteps">' + skel(18, 9) + '</div></div>' +
      '<div class="row">' + (kind === 'brand' ? '<div class="oq-card" style="flex:999 1 480px" id="fmovers">' + skel(30, 8) + '</div>' : '<div class="oq-card" style="flex:999 1 480px" id="fcalls">' + skel(50, 5) + '</div>') + '<div class="oq-card" style="flex:1 1 360px" id="fmix">' + skel(20, 10) + '</div></div>' +
      '<div class="oq-card" id="fxfer">' + skel(30, 4) + '</div>');
    var brand = kind === 'brand' ? name : null, agent = kind === 'csr' ? name : null;
    loadFocus(brand, agent).then(function (f) {
      if (tok !== T) return;
      focusKpis(f); focusWeekly(f); stepCard(f, 'fsteps', brand, agent); focusMix(f, brand, agent); focusXfer(f, kind);
      if (kind === 'brand') focusMovers(f);
    }).catch(function (e) { if (tok === T) $('fk').innerHTML = errBox(e); });
    if (kind === 'csr') api(Object.assign({ action: 'calls' }, win({ agent: agent, limit: 6 }))).then(function (c) { if (tok !== T) return; $('fcalls').innerHTML = '<div style="display:flex;justify-content:space-between;align-items:flex-start"><div><h2 class="ttl">Recent Calls</h2><p class="sub">' + fmt(c.total) + ' scored calls in this period</p></div><button class="more" data-callsfor="csr">All →</button></div>' + (c.rows || []).map(callRow).join(''); }).catch(function () {});
    var q = kind === 'brand' ? 'Explain why ' + name + ' is trending the way it is in this period compared with the previous one. Name the steps, CSRs, reasons or call mix that moved, then give the single most valuable fix.'
      : 'Give a short coaching summary for CSR ' + name + ': how they are trending vs the previous period, their strongest and weakest steps, and one specific thing to coach this week with an example call.';
    var ckey = 'why|' + kind + '|' + name + '|' + S.start + '|' + S.end;
    (whyCache[ckey] || (whyCache[ckey] = api({ action: 'ask', question: q, start: S.start, end: S.end, brands: brand ? [brand] : null }))).then(function (r) {
      if (tok !== T) return; var el = document.querySelector('#why .md'); if (el) el.innerHTML = md(r.answer);
    }).catch(function (e) { delete whyCache[ckey]; if (tok !== T) return; var el = document.querySelector('#why .md'); if (el) el.innerHTML = '<span class="mut">' + esc(e.message) + '</span>'; });
  }
  var whyCache = {};
  function focusKpis(f) {
    var c = (f.kpis || {}).cur || {}, p = (f.kpis || {}).prev || {};
    var defs = [['Avg QA score', c.avg, p.avg, function (v) { return v != null ? v.toFixed(1) : '—'; }, ''], ['Booking rate', pct(c.booked, c.decided), pct(p.booked, p.decided), p1, ' pts'], ['Asked for booking', pct(c.asked, c.opps), pct(p.asked, p.opps), p1, ' pts'], ['Card on bookings', pct(c.cc, c.booked), pct(p.cc, p.booked), p1, ' pts'], ['Conversations', c.calls, p.calls, fmt, null]];
    $('fk').innerHTML = defs.map(function (d) {
      return '<div class="oq-card" style="padding:14px 16px"><div class="cap">' + d[0] + '</div><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:10px"><span class="num" style="font-size:28px;font-weight:600;letter-spacing:-0.03em">' + d[3](d[1]) + '</span>' + (d[4] === null ? '<span class="mut num" style="font-size:12px">was ' + fmt(d[2]) + '</span>' : delta(d[1], d[2], d[4])) + '</div><div class="mut num" style="font-size:11.5px;margin-top:6px">before: ' + d[3](d[2]) + '</div></div>';
    }).join('');
  }
  function focusWeekly(f) {
    var w = (f.weekly || []).filter(function (x) { return x.calls >= 10; });
    if (w.length < 2) { $('fweek').innerHTML = '<h2 class="ttl">Week by Week</h2><p class="mut">Not enough weeks yet.</p>'; return; }
    var n = w.length, avgs = w.map(function (x) { return x.avg; }), lo = Math.floor(Math.min.apply(null, avgs) - 2), hi = Math.ceil(Math.max.apply(null, avgs) + 2);
    var rates = w.map(function (x) { return x.decided ? x.booked / x.decided * 100 : null; });
    var px = function (i) { return ((i + .5) / n * 1000).toFixed(1); };
    var line = w.map(function (x, i) { return (i ? 'L' : 'M') + px(i) + ' ' + (190 - (x.avg - lo) / (hi - lo) * 170 - 10).toFixed(1); }).join(' ');
    var rl = rates.map(function (v, i) { return v == null ? '' : ((i ? 'L' : 'M') + px(i) + ' ' + (190 - v / 100 * 170 - 10).toFixed(1)); }).join(' ');
    var startIdx = w.findIndex(function (x) { return x.w >= S.start.slice(0, 10); });
    var shade = startIdx > 0 ? '<rect x="' + (startIdx / n * 1000) + '" y="0" width="' + (1000 - startIdx / n * 1000) + '" height="190" fill="#E6F0EA" opacity=".55"/>' : '';
    var dots = w.map(function (x, i) { return '<circle cx="' + px(i) + '" cy="' + (190 - (x.avg - lo) / (hi - lo) * 170 - 10).toFixed(1) + '" r="4" fill="#14302A"><title>Week of ' + fdate(x.w) + ': score ' + x.avg + ' · ' + (x.decided ? Math.round(x.booked / x.decided * 100) + '% booked' : '') + ' · ' + x.calls + ' calls</title></circle>'; }).join('');
    $('fweek').innerHTML = '<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px"><div><h2 class="ttl">Week by Week</h2><p class="sub">Last 12 weeks · shaded = the period you’re viewing · hover a dot for details</p></div><div class="mut" style="font-size:12px;display:flex;gap:14px"><span style="color:#14302A">● score</span><span style="color:#E0662A">— booking %</span></div></div>' +
      '<svg viewBox="0 0 1000 210" preserveAspectRatio="none" style="width:100%;height:220px;margin-top:12px;overflow:visible" role="img" aria-label="Weekly score and booking rate">' + shade + '<path d="' + rl + '" fill="none" stroke="#E0662A" stroke-width="2" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/><path d="' + line + '" fill="none" stroke="#14302A" stroke-width="2.4" vector-effect="non-scaling-stroke"/>' + dots + '</svg>' +
      '<div style="display:flex;margin-top:4px">' + w.map(function (x, i) { return '<div style="flex:1;text-align:center;font-size:10px;color:#5F6763">' + (i % 2 === 0 ? fdate(x.w) : '') + '</div>'; }).join('') + '</div>';
  }
  function focusMovers(f) {
    var rows = (f.agents || []).filter(function (a) { return a.n >= 30; }).map(function (a) { a.d = a.pavg != null && a.pn >= 15 ? a.avg - a.pavg : null; return a; });
    rows.sort(function (a, b) { return (b.n) - (a.n); });
    var h = '<div><h2 class="ttl">CSRs behind the trend</h2><p class="sub">Score now vs before for CSRs with 30+ calls · click a CSR for their profile</p></div><p class="swipe mut" style="display:none;font-size:11.5px;margin:8px 0 0">Swipe sideways for more columns →</p><div style="overflow-x:auto;margin-top:10px"><table class="tbl" style="font-size:13px"><thead><tr><th>CSR</th><th>Calls</th><th>Score</th><th>Change</th><th>Booking</th><th>Ask rate</th><th><span style="display:inline-flex;align-items:center;gap:4px">Card ask<span aria-hidden="true" data-tip="Share of the CSR’s booked residential service calls where they asked for a card. Commercial customers, PDQ and Dan’s Doors are left out." style="cursor:help;width:14px;height:14px;border-radius:99px;border:1px solid #CFCAC0;color:#8A918D;font-size:9px;font-weight:700;display:inline-flex;align-items:center;justify-content:center">i</span></span></th><th></th></tr></thead><tbody>';
    rows.slice(0, 14).forEach(function (a) {
      h += '<tr class="click" data-agent="' + esc(a.name) + '" tabindex="0"><td><div style="display:flex;align-items:center;gap:10px">' + avatar(a.name, 26) + '<b style="font-weight:600;white-space:nowrap">' + esc(a.name) + '</b></div></td><td class="num">' + fmt(a.n) + '</td><td class="num">' + (a.avg != null ? a.avg.toFixed(1) : '—') + '</td><td>' + (a.d == null ? '<span class="mut" style="font-size:11.5px">new</span>' : delta(a.avg, a.pavg, '')) + '</td><td class="num">' + p1(pct(a.booked, a.decided)) + '</td><td class="num">' + p1(pct(a.asked, a.opps)) + '</td><td class="num" data-mvcard="' + esc(String(a.name || '').toLowerCase()) + '"><span class="mut">…</span></td><td class="mut" aria-hidden="true">›</td></tr>';
    });
    $('fmovers').innerHTML = h + '</tbody></table></div>';
    var tk = T;
    api(Object.assign({ action: 'cardcap' }, win())).then(function (cc) { if (tk !== T || !$('fmovers')) return; var m = {};
      (cc && cc.by_agent || []).forEach(function (x) { if (CARD_SKIP.indexOf(x.brand) >= 0) return; var k = String(x.agent || '').toLowerCase(); m[k] = m[k] || { b: 0, a: 0 }; m[k].b += +x.booked || 0; m[k].a += +x.asked_cc || 0; });
      [].forEach.call($('fmovers').querySelectorAll('[data-mvcard]'), function (td) { var v = m[td.getAttribute('data-mvcard')]; td.innerHTML = v && v.b ? '<span title="' + fmt(v.a) + ' of ' + fmt(v.b) + ' booked service calls">' + (100 * v.a / v.b).toFixed(1) + '%</span>' : '<span class="mut">—</span>'; });
    }).catch(function () { [].forEach.call(($('fmovers') || document).querySelectorAll('[data-mvcard]'), function (td) { td.innerHTML = '<span class="mut">—</span>'; }); });
  }
  function focusMix(f, brand, agent) {
    var tabs = [['reasons', 'Why calls didn’t book'], ['objections', 'Objections'], ['topics', 'What callers wanted'], ['hours', 'Time of day']];
    var cur = S.mix || 'reasons';
    var h = '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center"><h2 class="ttl">What’s different</h2><div class="seg" role="tablist">' + tabs.map(function (t) { return '<button role="tab" aria-selected="' + (cur === t[0]) + '" class="' + (cur === t[0] ? 'on' : '') + '" data-mix="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div></div><p class="sub">' + (cur === 'hours' ? 'Bar height = number of calls · % on top = booking rate · click a bar to hear those calls' : 'This period vs the one before · click a row to hear those calls') + '</p><div style="margin-top:10px">';
    if (cur === 'hours') {
      var hs = f.hours || [], mx = Math.max.apply(null, hs.map(function (x) { return x.calls; }).concat([1]));
      h += '<div style="display:flex;align-items:flex-end;gap:4px;height:150px">' + hs.map(function (x) { var r = x.decided ? Math.round(x.booked / x.decided * 100) : null; return '<div class="click" data-ffk="hour" data-ffv="' + x.h + '" role="button" tabindex="0" style="cursor:pointer;flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;gap:4px" title="Click to hear the ' + fhour(x.h) + ' calls · ' + fhour(x.h) + ': ' + fmt(x.calls) + ' calls · score ' + x.avg + (r != null ? ' · ' + r + '% booked' : '') + '"><span class="num" style="font-size:10px;color:#1F5A41">' + (r != null ? r + '%' : '') + '</span><div style="width:100%;border-radius:3px;background:' + ((x.avg || 0) < 78 ? '#F1B48E' : '#9CC6B2') + ';height:' + Math.max(3, Math.round(x.calls / mx * 100)) + 'px"></div><span style="font-size:10px;color:#5F6763">' + fhour(x.h) + '</span></div>'; }).join('') + '</div><p class="mut" style="font-size:11.5px">Orange bars = hours where the average score is under 78. Numbers on top = booking rate.</p>';
    } else {
      var rows = f[cur] || [], mx2 = Math.max.apply(null, rows.map(function (x) { return Math.max(x.n, x.pn); }).concat([1]));
      rows.forEach(function (r) {
        var dd = r.pn ? Math.round((r.n - r.pn) / r.pn * 100) : null;
        h += '<button class="click" data-ffk="' + ({ reasons: 'reason', objections: 'objection', topics: 'category' }[cur]) + '" data-ffv="' + esc(r.k) + '" title="Hear these calls" style="all:unset;box-sizing:border-box;cursor:pointer;display:block;width:100%;padding:7px 0;font-size:12.5px"><div style="display:flex;justify-content:space-between;gap:8px"><span>' + esc(r.k) + ' <span class="mut" aria-hidden="true">›</span></span><span class="num mut">' + fmt(r.n) + ' <span style="font-size:11px">(' + (dd == null ? 'new' : (dd >= 0 ? '+' : '') + dd + '%') + ')</span></span></div>' +
          '<div style="display:flex;flex-direction:column;gap:2px;margin-top:4px"><div class="track"><div style="background:' + (cur === 'reasons' ? O : G) + ';width:' + (r.n / mx2 * 100) + '%"></div></div><div class="track" style="height:4px"><div style="background:#C9C3B8;width:' + (r.pn / mx2 * 100) + '%"></div></div></div></button>';
      });
      h += '<p class="mut" style="font-size:11.5px">Top bar = now · grey bar = before</p>';
    }
    $('fmix').innerHTML = h + '</div>';
    $('fmix').dataset.fb = brand || ''; $('fmix').dataset.fa = agent || '';
    lastFocus = f;
  }
  var lastFocus = null;
  function focusXfer(f, kind) {
    var x = f.transfers || {}, cur = (f.kpis || {}).cur || {};
    var who = kind === 'brand' ? 'this brand’s CSRs' : esc(S.agent);
    var list = function (rows, attr) { return (rows || []).map(function (r) { return '<button class="click" data-xferpair="' + attr + '|' + esc(r.k) + '" title="' + (attr === 'out' ? 'Hear the calls transferred to ' : 'Hear the calls received from ') + esc(r.k) + '" style="all:unset;box-sizing:border-box;cursor:pointer;width:100%;display:flex;justify-content:space-between;gap:10px;padding:8px 2px;border-top:1px solid var(--line2);font-size:12.5px"><span style="display:flex;gap:8px;align-items:center">' + avatar(r.k, 24) + esc(r.k) + '</span><span class="num mut">' + fmt(r.n) + (r.booked != null ? ' · ' + fmt(r.booked) + ' booked' : '') + '</span></button>'; }).join('') || '<p class="mut" style="font-size:12.5px">None matched in this period.</p>'; };
    var outPct = cur.calls ? Math.round(x.out / cur.calls * 100) : 0;
    var h = '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px"><div><h2 class="ttl">Transfers</h2><p class="sub">Outbound = calls ' + who + ' transferred to someone else · Inbound = calls ' + who + ' received from a colleague</p></div><div class="row" style="gap:8px"><button class="sel" data-xferlist="out">Outbound calls →</button><button class="sel" data-xferlist="in">Inbound calls →</button></div></div>' +
      '<div class="row" style="margin-top:12px;align-items:flex-start">' +
      '<div style="flex:1 1 300px;min-width:0"><div style="display:flex;align-items:baseline;gap:10px"><span class="num" style="font-size:28px;font-weight:600">↗ ' + fmt(x.out) + '</span><span class="mut" style="font-size:12.5px">' + outPct + '% of calls · was ' + fmt(x.out_prev) + '</span></div>' +
      '<div class="mut" style="font-size:12px;margin:6px 0 4px">' + fmt(x.out_linked) + ' matched to the receiving call · <b style="color:#1F5A41">' + fmt(x.out_booked) + ' booked after the transfer</b></div><div class="cap" style="margin-top:10px">Who received them</div>' + list(x.to, 'out') + '</div>' +
      '<div style="flex:1 1 300px;min-width:0"><div style="display:flex;align-items:baseline;gap:10px"><span class="num" style="font-size:28px;font-weight:600">↘ ' + fmt(x.in) + '</span><span class="mut" style="font-size:12.5px">received</span></div>' +
      '<div class="mut" style="font-size:12px;margin:6px 0 4px">' + (x.in_decided ? '<b style="color:#1F5A41">' + Math.round(x.in_booked / x.in_decided * 100) + '% booked</b> when a decision was made (' + fmt(x.in_booked) + ' of ' + fmt(x.in_decided) + ')' : 'No booking decisions yet') + '</div><div class="cap" style="margin-top:10px">Who sent them</div>' + list(x.from, 'in') + '</div></div>';
    $('fxfer').innerHTML = h;
  }

  // ---------- CSRs ----------
  function vCsrs(tok) {
    setMain(crumb([['CSRs']]) + '<div class="oq-card" id="csrall">' + skel(30, 12) + '</div>');
    Promise.all([loadReport(), loadPrevReport(), loadExtras().catch(function () { return {}; })]).then(function (r) {
      if (tok !== T) return; noteKnown(r[0]);
      var rows = agentRows(r[0], r[1], S.csrMin || 30), key = S.csrSort, AN = ((r[2] || {}).asknb || {}).by_agent;
      rows.forEach(function (a) { var x = askNb(AN, a.brand, a.name); a.ask = x ? x.pct : null; a.nb = x ? x.nb : 0; });
      var f = { calls: function (a) { return -a.calls; }, avg: function (a) { return -(a.avg || 0); }, change: function (a) { return a.pavg == null ? -99 : -(a.avg - a.pavg); }, rate: function (a) { return -(a.rate || 0); }, ask: function (a) { return (a.ask == null ? 999 : a.ask); }, xo: function (a) { return -a.xo; }, xi: function (a) { return -a.xi; }, cc: function (a) { return -(a.cc || 0); }, name: function (a) { return 0; }, brand: function (a) { return 0; } }[key];
      var dir = S.csrDir || 1; rows.sort(key === 'name' ? function (a, b) { return dir * a.name.localeCompare(b.name); } : key === 'brand' ? function (a, b) { return dir * (short(a.brand || '').localeCompare(short(b.brand || '')) || a.name.localeCompare(b.name)); } : function (a, b) { return dir * (f(a) - f(b)); });
      var q = (S.csrQ || '').toLowerCase(); if (q) rows = rows.filter(function (a) { return a.name.toLowerCase().indexOf(q) >= 0 || (a.brand || '').toLowerCase().indexOf(q) >= 0; });
      var th = function (k, l, t) { var on = key === k, asc = (k === 'name' || k === 'brand' || k === 'ask') === (dir === 1); return '<th class="sortable" data-csort="' + k + '" title="' + esc(t) + ' · click again to reverse" aria-sort="' + (on ? (asc ? 'ascending' : 'descending') : 'none') + '">' + l + (on ? (asc ? ' ↑' : ' ↓') : '') + '</th>'; };
      var h = '<div style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:10px"><div><h2 class="ttl">CSR Scorecards</h2><p class="sub">' + rows.length + ' CSRs with ' + (S.csrMin || 30) + '+ calls · click a header to sort, a row to open the CSR</p></div><div class="row" style="gap:8px"><label class="sr" for="csrq">Find a CSR</label><input id="csrq" class="oq-field" style="width:220px" placeholder="Find a CSR or brand…" value="' + esc(S.csrQ || '') + '"><select id="csrmin" class="oq-field" style="width:auto" aria-label="Minimum calls"><option value="10"' + (S.csrMin == 10 ? ' selected' : '') + '>10+ calls</option><option value="30"' + (!S.csrMin || S.csrMin == 30 ? ' selected' : '') + '>30+ calls</option><option value="100"' + (S.csrMin == 100 ? ' selected' : '') + '>100+ calls</option></select></div></div>' +
        '<p class="swipe mut" style="display:none;font-size:11.5px;margin:8px 0 0">Swipe sideways for more columns →</p><div style="overflow-x:auto;margin-top:12px"><table class="tbl" style="font-size:13.5px"><thead><tr>' + th('name', 'CSR', 'Sort by name') + th('brand', 'Brand', 'Sort by brand') + th('calls', 'Inbound calls handled', 'Inbound customer conversations this CSR handled') + th('avg', 'Avg QA score', 'Average call-flow (QA) score, 0–100') + th('change', 'Change', 'vs previous period') + th('rate', 'Booking rate', 'Booked ÷ decided calls') + th('ask', 'Ask rate · not booked', 'Not-booked opportunities where the CSR still asked for the booking · lowest first') + th('xo', 'Transfers out', 'Calls this CSR transferred to someone else') + th('xi', 'Transfers in', 'Calls this CSR received from a colleague') + th('cc', 'Cards', 'Cards collected on booked calls') + '<th></th></tr></thead><tbody>';
      rows.slice(0, 150).forEach(function (a) {
        h += '<tr class="click" data-agent="' + esc(a.name) + '" tabindex="0"><td><div style="display:flex;align-items:center;gap:12px">' + avatar(a.name, 32) + '<b style="font-weight:600">' + esc(a.name) + '</b></div></td><td class="mut">' + esc(short(a.brand)) + '</td><td class="num">' + fmt(a.calls) + '</td><td class="num">' + (a.avg != null ? a.avg.toFixed(1) : '—') + '</td><td>' + delta(a.avg, a.pavg, '') + '</td>' +
          '<td><div style="display:flex;align-items:center;gap:8px;min-width:120px"><span class="num" style="width:40px">' + (a.rate != null ? a.rate.toFixed(0) + '%' : '—') + '</span><div class="track" style="flex:1"><div style="background:' + ((a.rate || 0) >= 60 ? G : O) + ';width:' + (a.rate || 0) + '%"></div></div></div></td><td class="num" title="' + (a.nb ? a.nb + ' not-booked opportunities' : '') + '">' + (a.ask != null ? a.ask.toFixed(0) + '%' : '—') + '</td><td class="num">' + fmt(a.xo) + ' <span class="mut" style="font-size:11px">' + (a.calls ? Math.round(a.xo / a.calls * 100) + '%' : '') + '</span></td><td class="num">' + fmt(a.xi) + '</td><td class="num mut">' + fmt(a.cc) + '</td><td class="mut" aria-hidden="true">›</td></tr>';
      });
      $('csrall').innerHTML = h + '</tbody></table></div>';
      var qi = $('csrq'); if (qi) { qi.addEventListener('input', function () { S.csrQ = qi.value; S.csrFocus = true; clearTimeout(qi.t); qi.t = setTimeout(render, 250); }); if (S.csrFocus) { qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length); } }
      var cmi = $('csrmin'); if (cmi) cmi.addEventListener('change', function () { S.csrMin = +cmi.value; S.csrFocus = false; render(); });
    }).catch(function (e) { if (tok === T) $('csrall').innerHTML = errBox(e); });
  }

  // ---------- Calls ----------
  var OUTCOMES = [['', 'Any outcome'], ['Booked', 'Booked'], ['Not Booked', 'Not booked'], ['Transferred', 'Transferred'], ['No Opportunity', 'No opportunity']];
  // KPI drill (2026-10-23): click a top tile -> every brand side by side, then the calls behind the number.
  var KPID = {
    allcalls: { t: 'Inbound calls handled', bar: 'Inbound calls handled', unit: '', list: 'All inbound calls handled', hi: true },
    lowscore: { t: 'Avg QA score', bar: 'Avg QA score', unit: '', list: 'Lowest-scoring calls (40 or under)', hi: true },
    notbooked: { t: 'Booking rate', bar: 'Booking rate', unit: '%', list: 'Calls that didn’t book', hi: true },
    asknb: { t: 'Ask rate · not booked', bar: 'Asked for the booking on not-booked opportunities', unit: '%', list: 'Not booked and the CSR didn’t ask for the booking', hi: true },
    nocard: { t: 'Card asked', bar: 'Card asked on booked service calls', unit: '%', list: 'Booked service calls with no card ask', hi: true }
  };
  function kpiBars(rows, d, overall, thr) {
    var vals = rows.filter(function (r) { return r.v != null; }), max = Math.max.apply(null, vals.map(function (r) { return r.v; }).concat([d.unit === '%' ? 100 : 1]));
    return vals.sort(function (a, b) { return b.v - a.v; }).map(function (r) { var w = Math.max(1, r.v / max * 100), below = thr != null ? r.v < thr : overall != null && r.v < overall;
      return '<button class="click" data-kpibrand="' + esc(r.brand) + '" title="Show ' + esc(short(r.brand)) + ' only" style="all:unset;box-sizing:border-box;cursor:pointer;width:100%;display:grid;grid-template-columns:150px minmax(0,1fr) 120px;gap:12px;align-items:center;padding:7px 2px;border-top:1px solid var(--line2)"><span style="display:flex;align-items:center;gap:8px;font-weight:600;font-size:13px">' + bbadge(r.brand) + esc(short(r.brand)) + '</span>' +
        '<span style="position:relative;height:14px;background:#F3F1EC;border-radius:7px;overflow:visible">' + '<span style="position:absolute;left:0;top:0;bottom:0;width:' + w.toFixed(1) + '%;border-radius:7px;background:' + (below ? O : G) + '"></span>' + (overall != null ? '<span title="Overall" style="position:absolute;top:-4px;bottom:-4px;width:2px;background:#14302A;left:' + Math.min(100, overall / max * 100).toFixed(1) + '%"></span>' : '') + '</span>' +
        '<span class="num" style="text-align:right;font-size:13px"><b>' + (d.unit === '%' ? r.v.toFixed(1) + '%' : (r.v % 1 ? r.v.toFixed(1) : fmt(r.v))) + '</b>' + (r.sub ? ' <span class="mut" style="font-size:11.5px">' + r.sub + '</span>' : '') + '</span></button>'; }).join('');
  }
  function vKpi(tok) {
    var k = KPID[S.kpi] ? S.kpi : 'nocard', d = KPID[k], one = S.brands.length === 1 || LOCK;
    setMain(crumb([['Overview', 'overview'], [d.t]]) + '<div class="oq-card" id="kpibrands">' + skel(26, 8) + '</div><div class="oq-card"><h2 class="ttl">' + esc(d.list) + '</h2><p class="sub" id="kpitot">Loading…</p><div id="kpilist" style="margin-top:8px">' + skel(54, 6) + '</div><div id="kpimore" style="margin-top:10px"></div></div>');
    var head = function (overall, sub) { return '<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap"><div><h2 class="ttl">' + esc(d.bar) + (one ? '' : ' · by brand') + '</h2><p class="sub">' + esc(rangeLabel()) + ' · ' + (one ? esc(short(LOCK || S.brands[0])) : 'click a brand to see only its calls') + '</p></div><div style="text-align:right"><div class="cap">Overall</div><div class="num" style="font-size:28px;font-weight:600">' + (overall == null ? '—' : d.unit === '%' ? overall.toFixed(1) + '%' : (overall % 1 ? overall.toFixed(1) : fmt(overall))) + '</div>' + (sub ? '<div class="mut" style="font-size:12px">' + sub + '</div>' : '') + '</div></div>' + (one || k === 'allcalls' ? '' : '<div style="display:flex;gap:14px;font-size:11.5px;margin:10px 0 4px" class="mut"><span><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:' + G + '"></span> ' + (k === 'notbooked' ? '60% or higher' : 'At or above overall') + '</span><span><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:' + O + '"></span> ' + (k === 'notbooked' ? 'Below 60%' : 'Below overall') + '</span><span><span style="display:inline-block;width:2px;height:10px;background:#14302A"></span> Overall</span></div>'); };
    var drawList = function (rows, total) { if (tok !== T) return; var el = $('kpilist'); if (!el) return; $('kpitot').textContent = fmt(total) + ' calls · newest first · press ▶ to listen, click a call for the full review'; el.innerHTML = rows.map(callRow).join('') || '<p class="mut">No calls.</p>';
      $('kpimore').innerHTML = rows.length < total ? '<button class="sel" data-kpimore="1">Show more (' + fmt(Math.min(50, total - rows.length)) + ')</button>' : ''; };
    S.kpiRows = []; var more;
    if (k === 'nocard') {
      api(Object.assign({ action: 'cardcap' }, win())).then(function (cc) { if (tok !== T) return;
        var t = cardTot(cc), ov = t.booked ? 100 * t.asked / t.booked : null;
        var rows = (cc.by_brand || []).filter(function (x) { return CARD_SKIP.indexOf(x.brand) < 0 && x.booked; }).map(function (x) { return { brand: x.brand, v: 100 * x.asked_cc / x.booked, sub: x.asked_cc + ' of ' + x.booked }; });
        $('kpibrands').innerHTML = head(ov, t.booked ? fmt(t.asked) + ' of ' + fmt(t.booked) + ' booked service calls' : '') + (one ? '' : kpiBars(rows, d, ov)) + '<p class="mut" style="font-size:11.5px;margin-top:10px">Booked residential service calls only (repairs, springs, openers, tune-ups; commercial customers left out). PDQ and Dan’s Doors are left out: they don’t take a card at booking.</p>';
        var miss = (cc.calls || []).filter(function (c) { return !c.asked_for_cc && CARD_SKIP.indexOf(c.brand) < 0; }).sort(function (a, b) { return String(b.call_started_at || b.call_date).localeCompare(String(a.call_started_at || a.call_date)); })
          .map(function (c) { var h = c.call_started_at ? new Date(c.call_started_at).getHours() : null; return { id: c.review_id, agent: c.agent, brand: c.brand, date: c.call_date, hour: h, secs: null, score: c.score_pct == null ? '—' : Math.round(c.score_pct), topic: 'Booked · no card ask', summary: '' }; });
        S.kpiRows = miss; S.kpiShown = 50; drawList(miss.slice(0, 50), miss.length);
        more = function () { S.kpiShown += 50; drawList(miss.slice(0, S.kpiShown), miss.length); }; S.kpiMore = more;
      }).catch(function (e) { if (tok === T) $('kpibrands').innerHTML = errBox(e); });
      return;
    }
    Promise.all([loadReport(), loadExtras().catch(function () { return {}; })]).then(function (r) { if (tok !== T) return;
      var rep = r[0] || {}, X = r[1] || {}, kp = rep.kpis || {}, rows, ov, sub = '';
      var bs = (rep.brands || []).filter(function (b) { return b.brand && b.brand !== '—'; });
      if (k === 'allcalls') { rows = bs.map(function (b) { return { brand: b.brand, v: +b.calls || 0 }; }); ov = (rep.funnel || {}).conversations || 0; }
      else if (k === 'lowscore') { rows = bs.map(function (b) { return { brand: b.brand, v: b.avg == null ? null : +b.avg }; }); ov = kp.avg; }
      else if (k === 'notbooked') { rows = bs.map(function (b) { return { brand: b.brand, v: b.decided ? 100 * b.booked / b.decided : null, sub: b.booked + ' of ' + b.decided }; }); ov = kp.booking_rate; }
      else { rows = ((X.asknb || {}).by_brand || []).map(function (b) { return { brand: b.brand, v: b.nb ? 100 * b.asked / b.nb : null, sub: b.asked + ' of ' + b.nb }; }); var o = (X.asknb || {}).overall || {}; ov = o.nb ? 100 * o.asked / o.nb : null; sub = o.nb ? fmt(o.asked) + ' of ' + fmt(o.nb) + ' not-booked opportunities' : ''; }
      $('kpibrands').innerHTML = head(ov, sub) + (one ? '' : kpiBars(rows, d, k === 'allcalls' ? null : ov, k === 'notbooked' ? 60 : null));
    }).catch(function (e) { if (tok === T) $('kpibrands').innerHTML = errBox(e); });
    var body = function (off) { return k === 'asknb' ? Object.assign({ action: 'qaextras', view: 'list', kind: 'asknb', value: 'notasked' }, win({ limit: 50, offset: off })) : Object.assign({ action: 'calls' }, win({ outcome: k === 'notbooked' ? 'Not Booked' : null, score_max: k === 'lowscore' ? 40 : null, limit: 50, offset: off })); };
    var acc = [];
    var pull = function () { api(body(acc.length)).then(function (res) { acc = acc.concat(res.rows || []); drawList(acc, res.total || acc.length); }).catch(function (e) { if (tok === T) $('kpilist').innerHTML = errBox(e); }); };
    S.kpiMore = pull; pull();
  }
  function vCalls(tok) {
    var c = S.calls, chips = [];
    var BUCKETNAMES = { upset: 'Upset customers', low: 'Low scores (40 or under)', ctrl: 'Controllable misses (not booked)', other: 'Not booked: outside CSR control' };
    if (c.bucket) chips.push([BUCKETNAMES[c.bucket] || c.bucket, 'bucket']);
    if (S.callsAgent) chips.push(['CSR: ' + S.callsAgent, 'agent']);
    if (c.outcome) chips.push(['Outcome: ' + c.outcome, 'outcome']);
    if (c.step) chips.push(['Missed: ' + (STEPNAMES[c.step] || c.step), 'step']);
    if (c.winnable) chips.push(['Winnable, didn’t book', 'winnable']);
    if (c.scoreMax != null) chips.push(['Score ≤ ' + c.scoreMax, 'scoreMax']);
    if (c.scoreMin != null) chips.push(['Score ≥ ' + c.scoreMin, 'scoreMin']);
    if (c.q) chips.push(['“' + c.q + '”', 'q']);
    if (c.nocard) chips.push(['Booked, card not asked', 'nocard']);
    if (c.ff) chips.push([c.ff.label, 'ff']);
    if (c.xfer) chips.push([c.xferWith ? (c.xfer === 'out' ? 'Transferred to ' + c.xferWith : 'Received from ' + c.xferWith) : (c.xfer === 'out' ? 'Transferred out' : 'Transferred in'), 'xfer']);
    setMain(crumb([['Call reviews']]) + '<div class="oq-card" id="sreqs" style="display:none"></div><div class="oq-card"><div style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:10px"><div><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><h2 class="ttl">Call reviews</h2><button class="sel" data-act="copylink" title="Copy a link to exactly this list" style="min-height:32px;padding:3px 10px;font-size:12.5px;gap:6px"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>Copy link</button></div><p class="sub" id="ctot">Loading…</p></div>' +
      '<form id="callq" class="row" style="gap:8px"><label class="sr" for="cq">Search calls</label><input id="cq" class="oq-field" style="width:230px" placeholder="Search summaries, CSRs, brands, phone…" value="' + esc(c.q || '') + '"><select id="co" class="oq-field" style="width:auto" aria-label="Outcome">' + OUTCOMES.map(function (o) { return '<option value="' + o[0] + '"' + ((c.outcome || '') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
      '<select id="cs2" class="oq-field" style="width:auto" aria-label="Missed step"><option value="">Any step</option>' + Object.keys(STEPNAMES).slice(0, 5).map(function (k) { return '<option value="' + k + '"' + (c.step === k ? ' selected' : '') + '>Missed: ' + STEPNAMES[k] + '</option>'; }).join('') + '</select>' +
      '<select id="cxf" class="oq-field" style="width:auto" aria-label="Transfers"><option value="">Any transfer</option><option value="out"' + (c.xfer === 'out' ? ' selected' : '') + '>Transferred out</option><option value="in"' + (c.xfer === 'in' ? ' selected' : '') + '>Transferred in</option></select>' +
      '<select id="csc" class="oq-field" style="width:auto" aria-label="Score"><option value="">Any score</option><option value="max40"' + (c.scoreMax === 40 ? ' selected' : '') + '>40 or lower</option><option value="max70"' + (c.scoreMax === 70 ? ' selected' : '') + '>70 or lower</option><option value="min90"' + (c.scoreMin === 90 ? ' selected' : '') + '>90 or higher</option></select><button class="sel btnd" type="submit">Search</button></form></div>' +
      (chips.length ? '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:12px">' + chips.map(function (ch) { return '<button class="chip on" data-unfilter="' + ch[1] + '" aria-label="Remove filter ' + esc(ch[0]) + '">' + esc(ch[0]) + ' ✕</button>'; }).join('') + '<button class="more" data-unfilter="all">Clear all</button></div>' : '') +
      (c.xferWith ? '<div id="xwhy" style="margin-top:12px;background:#F5F3EE;border-radius:12px;padding:12px 14px"></div>' : '') + '<div id="clist" style="margin-top:8px">' + skel(54, 6) + '</div><div id="cpager" class="row" style="justify-content:space-between;align-items:center;margin-top:10px"></div></div>');
    var body = c.bucket ? Object.assign({ action: 'bucketcalls', bucket: c.bucket }, win({ limit: 25, offset: c.offset })) : Object.assign({ action: 'calls' }, win({ agent: S.callsAgent || null, outcome: c.nocard ? 'Booked' : c.outcome, step_missed: c.nocard ? 'cc_not_asked' : c.step, score_max: c.scoreMax, score_min: c.scoreMin, winnable: c.winnable || null, xfer: c.xfer || null, q: phoneQ(c.q) || c.q || null, limit: 25, offset: c.offset }));
    if (!c.bucket && phoneQ(c.q)) { body.start = '2025-01-01'; body.end = todayET(); }
    if (c.ff) body = XKINDS[c.ff.kind] ? Object.assign({ action: 'qaextras', view: 'list', kind: c.ff.kind, value: c.ff.value, agent: S.callsAgent || null }, win({ limit: 25, offset: c.offset })) : Object.assign({ action: 'factcalls', kind: c.ff.kind, value: c.ff.value, agent: S.callsAgent || null, notbooked: !!c.ff.notbooked }, win({ limit: 25, offset: c.offset }));
    if (c.xferWith) { body = Object.assign({ action: 'xfercalls', dir: c.xfer === 'in' ? 'in' : 'out', with: c.xferWith, agent: S.callsAgent || null }, win({ limit: 25, offset: c.offset })); xferWhy(c); }
    if (CAN_EDIT) drawReqCard();
    api(body).then(function (r) {
      if (tok !== T) return;
      $('ctot').textContent = c.ff ? fmt(r.total) + ' calls · ' + c.ff.label + ' · newest first · press ▶ to listen' : c.xferWith ? fmt(r.total) + (c.xfer === 'in' ? ' calls ' + (S.callsAgent || 'this brand') + ' received from ' + c.xferWith : ' calls ' + (S.callsAgent || 'this brand') + ' transferred to ' + c.xferWith + ' · ' + fmt(r.booked) + ' booked after the transfer') + ' · newest first · press ▶ to listen' : (!c.bucket && phoneQ(c.q)) ? fmt(r.total) + ' calls from this number · all dates, not just the range above · newest first' : c.bucket ? fmt(r.total) + ' customer conversations (transfers counted once) · lowest score first · click one for the full review' : fmt(r.total) + ' calls match · newest first · click one for the full review';
      $('clist').innerHTML = (r.rows || []).map(callRow).join('') || '<p class="mut">No calls match these filters.</p>';
      var pages = Math.ceil(r.total / 25), pg = Math.floor(c.offset / 25) + 1;
      $('cpager').innerHTML = r.total > 25 ? '<span class="mut num" style="font-size:12.5px">Page ' + pg + ' of ' + fmt(pages) + '</span><div class="row" style="gap:6px"><button class="sel" data-page="-1"' + (pg <= 1 ? ' disabled' : '') + '>← Newer</button><button class="sel" data-page="1"' + (pg >= pages ? ' disabled' : '') + '>Older →</button></div>' : '';
    }).catch(function (e) { if (tok === T) $('clist').innerHTML = errBox(e); });
  }

  // ---------- Insights ----------
  // Every customer call identified by product, residential / commercial, sales / service / warranty, plus the yes / no checks (2026-10-24)
  var FLAGN = { booked: ['Booked', 'Not booked', 'of booking opportunities'], askbook: ['Asked for the booking', 'Didn’t ask', 'of opportunities that ended booked or not booked'], askcc: ['Asked for a card', 'Didn’t ask', 'of booked residential service calls (PDQ and Dan’s Doors left out)'], gotcc: ['Card collected', 'Not collected', 'of calls where the CSR asked for a card'] };
  // shares to one decimal that always add up to exactly 100.0% (largest remainder)
  function pct100(ns) {
    var tot = ns.reduce(function (a, n) { return a + (+n || 0); }, 0); if (!tot) return ns.map(function () { return '—'; });
    var raw = ns.map(function (n) { return 1000 * (+n || 0) / tot; }), fl = raw.map(Math.floor), left = 1000 - fl.reduce(function (a, b) { return a + b; }, 0);
    raw.map(function (r, i) { return [r - fl[i], i]; }).sort(function (a, b) { return b[0] - a[0]; }).slice(0, left).forEach(function (x) { fl[x[1]] += 1; });
    return fl.map(function (v) { return (v / 10).toFixed(1) + '%'; });
  }
  function dimsCard(D) {
    if (!D || !D.total) return '';
    var col = function (title, rows, color) {
      var tot = rows.reduce(function (a, r) { return a + (+r.n || 0); }, 0) || 1, P = pct100(rows.map(function (r) { return r.n; }));
      return '<div style="flex:1 1 220px;min-width:0"><div class="cap" style="margin-bottom:6px">' + title + '</div>' + rows.map(function (r, i) {
        var br = r.decided ? Math.round(100 * r.booked / r.decided) + '% booked' : '';
        return '<button class="click" data-ffk="' + r.d + '" data-ffv="' + esc(r.k) + '" title="Hear these calls" style="all:unset;box-sizing:border-box;cursor:pointer;width:100%;display:grid;grid-template-columns:minmax(0,1fr) 56px 44px;gap:8px;align-items:center;padding:6px 0;border-top:1px solid var(--line2);font-size:13px"><span style="white-space:normal;min-width:0">' + esc(r.k) + '<span class="mut" style="display:block;font-size:11.5px">' + fmt(r.n) + ' calls' + (br ? ' · ' + br : '') + '</span></span><span class="track" style="height:7px"><span style="display:block;height:100%;width:' + Math.round(100 * r.n / tot) + '%;background:' + color + '"></span></span><span class="num" style="text-align:right">' + P[i] + '</span></button>'; }).join('') + '</div>'; };
    var tag = function (list, d) { return (list || []).map(function (r) { return Object.assign({ d: d }, r); }); };
    var flags = (D.flags || []).filter(function (f) { return f && FLAGN[f.k]; }).map(function (f) { var L = FLAGN[f.k], t = (+f.yes || 0) + (+f.no || 0), P = pct100([f.yes, f.no]);
      return '<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;padding:6px 0;border-top:1px solid var(--line2);font-size:13px"><button class="click" data-ffk="flag" data-ffv="' + f.k + ':yes" title="Hear these calls" style="all:unset;cursor:pointer"><b style="font-weight:600;color:#1F5A41">' + P[0] + '</b> ' + L[0] + '<span class="mut" style="display:block;font-size:11.5px">' + fmt(f.yes) + ' of ' + fmt(t) + '</span></button><button class="click" data-ffk="flag" data-ffv="' + f.k + ':no" title="Hear these calls" style="all:unset;cursor:pointer"><b style="font-weight:600;color:#A8441A">' + P[1] + '</b> ' + L[1] + '<span class="mut" style="display:block;font-size:11.5px">' + fmt(f.no) + ' ' + L[2] + '</span></button></div>'; }).join('');
    return '<div class="oq-card" style="grid-column:1/-1"><h2 class="ttl">Every call, identified</h2><p class="sub">Click any row to hear those calls.</p>' +
      '<div style="display:flex;gap:22px;flex-wrap:wrap;margin-top:12px">' + col('Product', tag(D.product, 'product'), '#3A4380') + col('Residential or commercial', tag(D.segment, 'segment'), '#2F5E4E') + col('Sales, service or warranty', tag(D.line, 'line'), '#C9662A') +
      (flags ? '<div style="flex:1.3 1 300px;min-width:0"><div class="cap" style="margin-bottom:6px">How the call was handled</div>' + flags + '</div>' : '') + '</div></div>';
  }
  function vInsights(tok) {
    setMain(crumb([['Insights']]) + '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(420px,1fr));align-items:start" id="ins">' + ('<div class="oq-card">' + skel(20, 8) + '</div>').repeat(4) + '</div>');
    Promise.all([loadReport(), loadFocus(null, null), loadExtras().catch(function () { return {}; })]).then(function (r) {
      if (tok !== T) return; var rep = r[0], f = r[1], X = r[2] || {}, B = X.base || {}; noteKnown(rep);
      var NO_OTHER = function (L) { return (L || []).filter(function (x) { return x.k && !/^(other|general inquiry|unspecified)$/i.test(x.k); }); };
      var outs = NO_OTHER(rep.outcomes), outTot = outs.reduce(function (t, x) { return t + (+x.n || 0); }, 0);
      var notBooked = B.not_booked || ((rep.outcomes || []).filter(function (x) { return x.k === 'Not Booked'; })[0] || {}).n || 0;
      var cats = (X.categories || []).filter(function (x) { return ['Internal / staff call', 'No conversation', 'Dropped call / no caller response', 'Wrong number', 'Vendor / solicitation'].indexOf(x.k) < 0; });
      var catTot = cats.reduce(function (t, x) { return t + (+x.n || 0); }, 0);
      // [title, sub, rows, colour, -, drill kind, denominator, denominator words]
      var cust = [
        ['What callers wanted', 'One call type per call · % of ' + fmt(catTot) + ' customer conversations', cats, '#3A4380', 'q', 'category', catTot, 'conversations'],
        ['Why calls didn’t book', '% of the ' + fmt(notBooked) + ' opportunities that didn’t book', NO_OTHER(rep.reasons), O, 'reason', 'reason', notBooked, 'not booked'],
        ['What customers pushed back on', '% of the ' + fmt(B.opps || 0) + ' booking opportunities', NO_OTHER(rep.objections), '#2F5E4E', 'q', 'objection', B.opps || 0, 'opportunities']
      ];
      var csr = [
        ['Top coaching priorities', '% of the ' + fmt(B.scored || 0) + ' scored conversations where the CSR missed it', NO_OTHER(rep.priorities), '#14302A', 'x', 'priority', B.scored || 0, 'scored calls'],
        ['What CSRs do well', '% of the ' + fmt(B.scored || 0) + ' scored conversations where the CSR did it', NO_OTHER(rep.strengths), G, 'x', 'strength', B.scored || 0, 'scored calls'],
        ['How every call ended', '% of all ' + fmt(outTot) + ' calls, including voicemail and internal', outs, '#8C8478', 'outcome', 'outcome', outTot, 'calls']
      ];
      var card = function (g) {
        var rows = g[2] || [], max = rows.length ? rows[0].n : 1, d = g[6];
        return '<div class="oq-card"><h2 class="ttl">' + g[0] + '</h2><p class="sub">' + g[1] + ' · click one to hear the calls</p><div style="margin-top:10px">' + (rows.length ? rows.slice(0, 10).map(function (r) {
          var attr = ' data-ffk="' + g[5] + '" data-ffv="' + esc(r.k) + '" title="Hear these calls"';
          return '<button class="click" style="all:unset;box-sizing:border-box;cursor:pointer;width:100%;display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr) 54px 58px;gap:10px;align-items:center;font-size:12.5px;padding:6px 2px"' + attr + '><span>' + esc(r.k) + '</span><span class="track" style="height:8px;display:block"><span style="display:block;height:100%;border-radius:999px;background:' + g[3] + ';width:' + (r.n / max * 100).toFixed(1) + '%"></span></span><b class="num" style="text-align:right">' + pctTxt(r.n, d) + '</b><span class="num mut" style="text-align:right;font-size:11.5px">' + fmt(r.n) + '</span></button>';
        }).join('') : '<p class="mut" style="font-size:13px">Nothing in this range.</p>') + '</div></div>';
      };
      var cohort = '<div class="oq-card" style="grid-column:1/-1;padding:14px 18px;display:flex;gap:22px;flex-wrap:wrap;align-items:baseline"><span><span class="cap">Cohort</span> <b>' + esc(rangeLabel()) + '</b> · ' + esc(S.brands.length ? (S.brands.length === 1 ? short(S.brands[0]) : S.brands.length + ' brands') : (LOCK ? short(LOCK) : 'All brands')) + '</span><span><b class="num">' + fmt(B.calls || 0) + '</b> <span class="mut">calls</span></span><span><b class="num">' + fmt(B.conversations || 0) + '</b> <span class="mut">customer conversations</span></span><span><b class="num">' + fmt(B.opps || 0) + '</b> <span class="mut">booking opportunities</span> <span class="mut" style="font-size:12px">= <b class="num" style="color:#1F5A41">' + fmt(B.booked || 0) + '</b> booked + <b class="num" style="color:#A8441A">' + fmt(B.not_booked || 0) + '</b> not booked + <b class="num">' + fmt(Math.max(0, (B.opps || 0) - (B.booked || 0) - (B.not_booked || 0))) + '</b> transferred</span></span><span><b class="num">' + ((B.booked || 0) + (B.not_booked || 0) ? (100 * (B.booked || 0) / ((B.booked || 0) + (B.not_booked || 0))).toFixed(1) + '%' : '—') + '</b> <span class="mut">booking rate</span></span><span class="mut" style="font-size:12px">Percents use these totals; the small number is the count of calls.</span></div>';
      var h = cohort + dimsCard(X.dims) + '<div style="display:flex;flex-direction:column;gap:16px"><div style="background:#14302A;color:#fff;border-radius:12px;padding:12px 16px;display:flex;flex-direction:column;gap:2px"><span style="font-size:15px;font-weight:700;letter-spacing:-0.01em">What the Customer Did or Said</span><span style="font-size:12px;opacity:.8">Why they called, what they asked for, and how they felt</span></div>' + cust.map(card).join('') + '</div>' +
        '<div style="display:flex;flex-direction:column;gap:16px"><div style="background:#2F7D5B;color:#fff;border-radius:12px;padding:12px 16px;display:flex;flex-direction:column;gap:2px"><span style="font-size:15px;font-weight:700;letter-spacing:-0.01em">What the CSR Did</span><span style="font-size:12px;opacity:.8">How each call was handled, step by step</span></div>' + csr.map(card).join('') + '</div>';
      h += '<div class="oq-card" id="repcard">' + skel(30, 6) + '</div><div class="oq-card" id="aicard">' + skel(30, 6) + '</div>';
      $('ins').innerHTML = h; repeatCard(); aiCard();
    }).catch(function (e) { if (tok === T) $('ins').innerHTML = errBox(e); });
  }

  // ---------- Setup pages (real — saved through opsis-qa-portal) ----------
  function noRights(what) { return '<div class="oq-card"><h2 class="ttl">' + esc(what) + '</h2><p class="sub">Only ' + esc(CLIENT) + ' account admins can change this. Ask your account admin.</p></div>'; }
  function ago(ts) { if (!ts) return '—'; var d = String(ts).slice(0, 10); return fdate(d) + (d.slice(0, 4) !== todayET().slice(0, 4) ? ', ' + d.slice(0, 4) : ''); }

  // Knowledge base
  var KBS = { list: null, edit: null, del: null, busy: false, q: '', cat: '' };
  function vKb(tok) {
    setMain(crumb([['Knowledge base']]) + '<div id="kbwrap"><div class="oq-card">' + skel(40, 5) + '</div></div>');
    api({ action: 'kb' }).then(function (r) { if (tok !== T) return; KBS.list = r.articles || []; drawKb(); })
      .catch(function (e) { if (tok === T && $('kbwrap')) $('kbwrap').innerHTML = errBox(e); });
  }
  function drawKb() {
    var w = $('kbwrap'); if (!w || !KBS.list) return;
    var L = KBS.list, ed = KBS.edit != null ? L[KBS.edit] : null, cats = ['Pricing', 'Policy', 'Coverage', 'Troubleshooting', 'Scheduling', 'Products', 'Staff & routing'];
    var list = '<div class="oq-card" style="flex:999 1 520px"><h2 class="ttl">What the AI should know about your business</h2><p class="sub">The AI reads these when it scores new calls (for example, to check a CSR quoted the right fee). ' + (IS_ADMIN ? 'Every change is logged with who made it.' : 'Only account admins can edit them.') + '</p>' +
      (L.length ? '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;align-items:center"><label class="sr" for="kbq">Search the knowledge base</label><input id="kbq" type="search" class="oq-field" style="flex:1 1 240px" placeholder="Search titles and text, e.g. trip fee, hours, warranty…" value="' + esc(KBS.q) + '" autocomplete="off"><label class="sr" for="kbcat">Category</label><select id="kbcat" class="oq-field" style="width:auto"><option value="">All categories</option>' + cats.concat(L.map(function (a) { return a.category; })).filter(function (c, i, A) { return c && A.indexOf(c) === i; }).map(function (c) { return '<option' + (KBS.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select><span id="kbn" class="mut" style="font-size:12.5px"></span></div><div id="kbnone" class="mut" style="padding:16px 0;display:none">No articles match. <button class="lnk" data-act="kbclear">Clear search</button></div>' : '') +
      (L.length ? L.map(function (a, i) { var on = KBS.edit === i;
        return '<div data-kbi="' + i + '" data-kbcat="' + esc(a.category || '') + '" data-kbtext="' + esc(((a.title || '') + ' ' + (a.body || '') + ' ' + (a.category || '')).toLowerCase()) + '" style="padding:14px 12px;border-top:1px solid var(--line2);margin:8px -12px 0;border-radius:10px;' + (on ? 'background:#EEF4EF' : '') + '"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center"><b>' + esc(a.title) + '</b><div style="display:flex;gap:6px;align-items:center">' + (a.category ? '<span class="pill" style="background:#F3F1EC;color:#3B4541">' + esc(a.category) + '</span>' : '') +
          (!IS_ADMIN ? '' : KBS.del === i ? '<span class="mut" style="font-size:12px">Remove this article?</span><button class="sel" data-act="kbdelyes" data-i="' + i + '" style="padding:5px 10px;font-size:12px;color:#B4461F"' + (KBS.busy ? ' disabled' : '') + '>Remove</button><button class="sel" data-act="kbdelno" style="padding:5px 10px;font-size:12px">Keep</button>'
            : '<button class="sel" data-act="kbedit" data-i="' + i + '" style="padding:5px 10px;font-size:12px" aria-label="Edit ' + esc(a.title) + '">' + (on ? 'Editing…' : 'Edit') + '</button><button class="sel" data-act="kbdel" data-i="' + i + '" style="padding:5px 10px;font-size:12px" aria-label="Remove ' + esc(a.title) + '">Remove</button>') +
          '</div></div><div style="font-size:13px;line-height:1.55;margin-top:6px;color:#3B4541;white-space:pre-wrap">' + esc(a.body) + '</div><div class="mut" style="font-size:11.5px;margin-top:6px">Updated ' + ago(a.updated_at) + (a.updated_by_name ? ' by ' + esc(a.updated_by_name) : '') + '</div></div>'; }).join('')
        : '<div class="mut" style="padding:20px 0">No articles yet.' + (IS_ADMIN ? ' Add the first one on the right.' : '') + '</div>') + '</div>';
    var form = IS_ADMIN ? '<div class="oq-card" style="flex:1 1 320px;align-self:flex-start"><h2 class="ttl">' + (ed ? 'Edit article' : 'Add knowledge') + '</h2><p class="sub">Used when scoring new calls once saved.</p><div style="display:flex;flex-direction:column;gap:12px;margin-top:14px"><div><label class="l" for="kbt">Title</label><input id="kbt" class="oq-field" placeholder="e.g. Holiday hours" maxlength="200" value="' + (ed ? esc(ed.title) : '') + '"></div><div><label class="l" for="kbc">Category</label><select id="kbc" class="oq-field">' + cats.map(function (c) { return '<option' + (ed && ed.category === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select></div><div><label class="l" for="kbb">What should the AI know?</label><textarea id="kbb" class="oq-field" style="min-height:160px;resize:vertical" maxlength="8000" placeholder="Write it the way you’d explain it to a new CSR…">' + (ed ? esc(ed.body) : '') + '</textarea></div>' +
      (ed ? '<div style="display:flex;gap:8px"><button class="sel btnd" data-act="kbsave" style="flex:1"' + (KBS.busy ? ' disabled' : '') + '>' + (KBS.busy ? 'Saving…' : 'Save changes') + '</button><button class="sel" data-act="kbcancel">Cancel</button></div>' : '<button class="sel btnd" data-act="kbadd"' + (KBS.busy ? ' disabled' : '') + '>' + (KBS.busy ? 'Saving…' : 'Add to knowledge base') + '</button>') + '</div></div>' : '';
    w.innerHTML = '<div class="row" style="align-items:flex-start">' + list + form + '</div>';
    kbFilter();
    var kq = $('kbq'); if (kq) kq.addEventListener('input', function () { KBS.q = kq.value; kbFilter(); });
    var kc = $('kbcat'); if (kc) kc.addEventListener('change', function () { KBS.cat = kc.value; kbFilter(); });
    if (ed) { var t = $('kbt'); if (t) t.focus(); }
  }
  // Search (2026-10-26): every word must appear in the title, text or category; category narrows further.
  function kbFilter() {
    var words = String(KBS.q || '').toLowerCase().split(/\s+/).filter(Boolean), shown = 0, all = document.querySelectorAll('#kbwrap [data-kbi]');
    all.forEach(function (el) { var t = el.getAttribute('data-kbtext') || '', ok = (!KBS.cat || el.getAttribute('data-kbcat') === KBS.cat) && words.every(function (w) { return t.indexOf(w) >= 0; }); el.style.display = ok ? '' : 'none'; if (ok) shown++; });
    var n = $('kbn'); if (n) n.textContent = (words.length || KBS.cat) ? shown + ' of ' + all.length + ' articles' : all.length + ' articles';
    var none = $('kbnone'); if (none) none.style.display = all.length && !shown ? '' : 'none';
  }
  function busyBtn(btn, on) { if (!btn) return; if (on) { btn.dataset.t = btn.textContent; btn.disabled = true; btn.textContent = 'Saving…'; } else { btn.disabled = false; if (btn.dataset.t) btn.textContent = btn.dataset.t; } }
  function kbWrite(body, done, btn) {
    if (KBS.busy) return; KBS.busy = true; busyBtn(btn, true);
    api(Object.assign({ action: 'kb' }, body)).then(function (r) { KBS.busy = false; KBS.list = r.articles || []; KBS.edit = null; KBS.del = null; drawKb(); toast(done); })
      .catch(function (e) { KBS.busy = false; busyBtn(btn, false); toast(e.message || 'Couldn’t save. Try again.'); });
  }

  // Card capture: booked service calls where the CSR asked for a card to hold the appointment (asked)
  // and the customer gave one (captured). Same numbers as the daily card capture email.
  var CAP = { d: null, key: null, f: 'all', ag: null, b: null, shown: 50 };
  function vCard(tok) {
    setMain(crumb([['Card capture']]) + '<div id="ccwrap"><div class="oq-card">' + skel(36, 6) + '</div></div>');
    var key = S.start + '|' + S.end + '|' + S.brands.join(',');
    if (CAP.d && CAP.key === key) { drawCard(); return; }
    api(win({ action: 'cardcap' })).then(function (r) { if (tok !== T) return; CAP.d = r || {}; CAP.key = key; CAP.ag = null; CAP.b = null; CAP.shown = 50; drawCard(); })
      .catch(function (e) { if (tok === T && $('ccwrap')) $('ccwrap').innerHTML = errBox(e); });
  }
  function ccPct(a, b) { return b ? pc(100 * a / b) : '—'; }
  function ccYes(v, yes, no) { return v === true ? '<span class="pill" style="background:#E6F0EA;color:#1F5A41">' + yes + '</span>' : v === false ? '<span class="pill" style="background:#FDECEC;color:#A61B1B">' + no + '</span>' : '<span class="pill" style="background:#F3F1EC;color:#56605B">—</span>'; }
  function ccRows() {
    var f = CAP.f;
    return (CAP.d.calls || []).filter(function (c) {
      if (CAP.ag && (c.agent !== CAP.ag || c.brand !== CAP.b)) return false;
      if (CAP.b && !CAP.ag && c.brand !== CAP.b) return false;
      return f === 'all' || (f === 'asked' && c.asked_for_cc) || (f === 'cap' && c.collected_cc) || (f === 'miss' && c.asked_for_cc && !c.collected_cc) || (f === 'not' && !c.asked_for_cc);
    });
  }
  function drawCard() {
    var w = $('ccwrap'); if (!w || !CAP.d) return; var d = CAP.d, o = d.overall || {};
    var bk = +o.booked || 0, as = +o.asked_cc || 0, cp = +o.captured_cc || 0;
    var tiles = '<div class="row">' +
      mnTile('Booked service calls', n0(bk), 'Repair and maintenance appointments booked by CSRs', '', 'Booked service calls handled by your CSRs, duplicates removed.') +
      mnTile('Card asked', ccPct(as, bk), n0(as) + ' of ' + n0(bk) + ' bookings · the CSR asked for a card to hold the appointment', '#2B3A67', 'This is the CSR behavior. A card mentioned only as a way to pay later does not count.') +
      mnTile('Card captured', ccPct(cp, as), n0(cp) + ' of ' + n0(as) + ' asks · ' + ccPct(cp, bk) + ' of all bookings', '#1F5A41', 'The customer gave a card when asked.') +
      mnTile('Asked, not captured', n0(Math.max(as - cp, 0)), 'Customer declined or the card wasn’t taken', '#A8441A') + '</div>';
    var tbl = function (title, sub, rows, isAgent) {
      if (!rows.length) return '';
      return '<div class="oq-card"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap"><div><h2 class="ttl">' + title + '</h2><p class="sub">' + sub + '</p></div>' + (isAgent ? '<button class="sel btnd" data-act="cccsv">⬇ Download CSV</button>' : '') + '</div><p class="swipe mut" style="display:none;font-size:11.5px;margin:8px 0 0">Swipe sideways for more columns →</p><div style="overflow-x:auto"><table class="tbl" style="margin-top:10px;width:100%"><thead><tr><th style="text-align:left">' + (isAgent ? 'CSR' : 'Brand') + '</th>' + (isAgent && !LOCK ? '<th style="text-align:left">Brand</th>' : '') + '<th style="text-align:right">Booked</th><th style="text-align:right">Asked</th><th style="text-align:right">Asked %</th><th style="text-align:right">Captured</th><th style="text-align:right">Captured ÷ asked</th><th style="text-align:right">Asked, not captured</th><th style="text-align:right">Captured ÷ booked</th></tr></thead><tbody>' +
        rows.map(function (r) {
          var on = isAgent ? (CAP.ag === r.agent && CAP.b === r.brand) : (CAP.b === r.brand && !CAP.ag);
          return '<tr style="cursor:pointer' + (on ? ';background:#EEF2FB' : '') + '" data-act="' + (isAgent ? 'ccag' : 'ccbr') + '" data-ag="' + esc(r.agent || '') + '" data-br="' + esc(r.brand) + '"><td>' + esc(isAgent ? r.agent : r.brand) + '</td>' + (isAgent && !LOCK ? '<td class="mut">' + esc(r.brand) + '</td>' : '') +
            '<td class="num" style="text-align:right">' + n0(r.booked) + '</td><td class="num" style="text-align:right">' + n0(r.asked_cc) + '</td><td class="num" style="text-align:right">' + ccPct(r.asked_cc, r.booked) + '</td><td class="num" style="text-align:right">' + n0(r.captured_cc) + '</td><td class="num" style="text-align:right">' + ccPct(r.captured_cc, r.asked_cc) + '</td><td class="num" style="text-align:right;color:#A8441A">' + n0(Math.max((+r.asked_cc || 0) - (+r.captured_cc || 0), 0)) + '</td><td class="num" style="text-align:right">' + ccPct(r.captured_cc, r.booked) + '</td></tr>';
        }).join('') +
        '<tr style="font-weight:600;border-top:2px solid var(--line);background:#F3F1EC"><td>Total</td>' + (isAgent && !LOCK ? '<td></td>' : '') + '<td class="num" style="text-align:right">' + n0(bk) + '</td><td class="num" style="text-align:right">' + n0(as) + '</td><td class="num" style="text-align:right">' + ccPct(as, bk) + '</td><td class="num" style="text-align:right">' + n0(cp) + '</td><td class="num" style="text-align:right">' + ccPct(cp, as) + '</td><td class="num" style="text-align:right;color:#A8441A">' + n0(Math.max(as - cp, 0)) + '</td><td class="num" style="text-align:right">' + ccPct(cp, bk) + '</td></tr>' +
        '</tbody></table></div></div>';
    };
    var brands = d.by_brand || [], agents = d.by_agent || [];
    var rows = ccRows(), shown = rows.slice(0, CAP.shown);
    var chip = function (k, l) { return '<button class="sel' + (CAP.f === k ? ' btnd' : '') + '" data-act="ccf" data-f="' + k + '" style="padding:5px 12px;font-size:12.5px;' + (CAP.f === k ? '' : 'background:#EEF4EF;border-color:#CFE5DF;color:#14302A') + '">' + l + '</button>'; };
    var who = CAP.ag ? esc(CAP.ag) + (LOCK ? '' : ' · ' + esc(CAP.b)) : CAP.b ? esc(CAP.b) : '';
    var list = '<div class="oq-card"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap"><div><h2 class="ttl">Booked Calls' + (who ? ' · ' + who : '') + '</h2><p class="sub">Click a call to hear it and read what was said.' + (who ? ' <button class="lnk" data-act="ccclr">Show everyone</button>' : '') + '</p></div><div style="display:flex;gap:6px;flex-wrap:wrap">' + chip('all', 'All') + chip('asked', 'Card asked') + chip('cap', 'Captured') + chip('miss', 'Asked, not captured') + chip('not', 'Not asked') + '</div></div>' +
      (shown.length ? shown.map(function (c) {
        var q = c.cc_quote;
        return '<button class="click" data-call="' + esc(c.review_id) + '" style="all:unset;box-sizing:border-box;cursor:pointer;width:100%;display:flex;gap:12px;align-items:flex-start;padding:11px 0;border-top:1px solid var(--line2)"><span class="mut num" style="width:58px;flex:none;font-size:12.5px">' + fdate(c.call_date) + '</span><span style="flex:1;min-width:0"><span style="font-weight:600">' + esc(c.agent || 'Unknown') + '</span>' + (LOCK ? '' : ' <span class="mut" style="font-size:12.5px">· ' + esc(c.brand) + '</span>') + (q ? '<span class="mut" style="display:block;font-size:12.5px;margin-top:2px;line-height:1.45">“' + esc(q) + '”</span>' : '') + '</span><span style="display:flex;gap:6px;flex:none">' + ccYes(c.asked_for_cc, 'Asked', 'Not asked') + (c.asked_for_cc ? ccYes(c.collected_cc, 'Captured', 'Not captured') : '') + '</span></button>';
      }).join('') : '<div class="mut" style="padding:14px 0">No calls match.</div>') +
      (rows.length > shown.length ? '<button class="sel" data-act="ccmore" style="margin-top:10px;width:100%;justify-content:center">Show more (' + n0(rows.length - shown.length) + ' left)</button>' : '') + '</div>';
    w.innerHTML = '<div class="oq-card" style="background:#FAF8F4"><p class="sub" style="line-height:1.55;margin:0"><b>Card asked</b> means that while booking a repair or maintenance visit, the CSR asked for a card to hold or secure the appointment. <b>Captured</b> means the customer gave one. A card mentioned only as a way to pay the technician later doesn’t count. These are the same numbers as the daily card capture email.</p></div>' +
      tiles + (LOCK || brands.length < 2 ? '' : tbl('By brand', 'Capture rate and asked-not-captured for each brand · click a brand to see its calls.', brands, false)) + tbl('By CSR', 'Click a CSR to see their calls.', agents, true) + list;
  }
  function ccCsv() {
    var a = (CAP.d && CAP.d.by_agent) || [], o = (CAP.d && CAP.d.overall) || {};
    var q = function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var p = function (x, y) { return y ? (100 * x / y).toFixed(1) + '%' : ''; };
    var lines = [['CSR', 'Brand', 'Booked', 'Asked', 'Asked %', 'Captured', 'Captured / asked', 'Captured / booked'].join(',')].concat(a.map(function (r) { return [q(r.agent), q(r.brand), r.booked, r.asked_cc, p(r.asked_cc, r.booked), r.captured_cc, p(r.captured_cc, r.asked_cc), p(r.captured_cc, r.booked)].join(','); }));
    lines.push(['Total', '', o.booked, o.asked_cc, p(o.asked_cc, o.booked), o.captured_cc, p(o.captured_cc, o.asked_cc), p(o.captured_cc, o.booked)].join(','));
    saveBlob('card-capture-' + S.start + '-to-' + S.end + '.csv', new Blob([lines.join('\n')], { type: 'text/csv' }));
  }
  // QA settings
  var QS = null, QSE = { ins: false, metric: false, req: false, del: null, busy: false };
  // Suggested scoring rules: patterns the tool finds in corrections your team keeps making.
  var RS = { data: null, busy: false, err: null };
  function loadRules() {
    if (!IS_ADMIN) return;
    api({ action: 'rulesugs', op: 'list' }).then(function (r) { RS.data = r; RS.err = null; drawRules(); })
      .catch(function (e) { RS.err = e; drawRules(); });
  }
  function rulesOp(body, done, el) {
    if (RS.busy) return; RS.busy = true; if (el) el.disabled = true; drawRules();
    api(Object.assign({ action: 'rulesugs' }, body)).then(function (r) { RS.busy = false; RS.data = r; drawRules(); toast(done(r)); })
      .catch(function (e) { RS.busy = false; drawRules(); toast(e && e.message ? e.message : 'Something went wrong. Try again.'); });
  }
  function drawRules() {
    var w = $('rsbox'); if (!w) return;
    if (!IS_ADMIN) { w.style.display = 'none'; return; }
    w.style.display = '';
    var dis = RS.busy ? ' disabled' : '';
    var head = '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap"><div style="flex:1 1 300px"><h2 class="ttl">Suggested Scoring Rules</h2><p class="sub">Each week the tool looks for scores and call details your team keeps correcting the same way, and drafts a rule so the AI gets it right next time. Approve to add the rule to your call flow (you can edit the wording first), or dismiss it.</p></div><button class="sel" data-act="rsrun"' + dis + '>' + (RS.busy === 'run' ? 'Checking…' : 'Check now') + '</button></div>';
    if (RS.err && !RS.data) { w.innerHTML = head + '<div class="mut" style="font-size:12.5px;margin-top:10px">Couldn’t load suggestions. <button class="lnk" data-act="rsreload">Try again</button></div>'; return; }
    if (!RS.data) { w.innerHTML = head + '<div class="mut" style="font-size:12.5px;margin-top:10px">Loading…</div>'; return; }
    var pend = RS.data.pending || [], done = RS.data.decided || [];
    var body = pend.length ? pend.map(function (q) {
      var ex = (q.examples || []).slice(0, 4);
      return '<div style="padding:14px 0;border-top:1px solid var(--line2)">' +
        '<div style="font-weight:600">' + esc(q.title || q.target_label) + '</div>' +
        '<div class="mut" style="font-size:12.5px;margin-top:3px">' + esc(q.target_label || '') + ' · corrected ' + q.corrections + ' time' + (q.corrections === 1 ? '' : 's') + ' by ' + q.people + ' ' + (q.people === 1 ? 'person' : 'people') + ' · AI said <b>' + esc(q.from_label || '') + '</b>, your team changed it to <b>' + esc(q.to_label || '') + '</b></div>' +
        (q.explanation ? '<div style="font-size:13px;line-height:1.5;margin-top:8px">' + esc(q.explanation) + '</div>' : '') +
        '<label class="l" for="rsr' + q.id + '" style="margin-top:10px">Rule the AI will follow</label><textarea id="rsr' + q.id + '" class="oq-field" style="min-height:70px;resize:vertical" maxlength="1200">' + esc(q.rule || '') + '</textarea>' +
        (ex.length ? '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><span class="mut" style="font-size:12px;align-self:center">Example calls:</span>' + ex.map(function (e) { return '<button class="sel" data-call="' + esc(e.review_id) + '" style="padding:4px 10px;font-size:12px">' + esc((e.agent || 'Call') + (e.date ? ' · ' + e.date : '')) + '</button>'; }).join('') + '</div>' : '') +
        '<div style="display:flex;gap:8px;margin-top:10px"><button class="sel btnd" data-act="rsok" data-id="' + q.id + '"' + dis + '>Approve rule</button><button class="sel" data-act="rsno" data-id="' + q.id + '"' + dis + '>Dismiss</button></div></div>';
    }).join('') : '<div class="mut" style="font-size:12.5px;margin-top:10px">No suggestions waiting. The tool checks again every Monday, or use Check now.</div>';
    var hist = done.length ? '<details style="margin-top:12px"><summary class="mut" style="font-size:12.5px;cursor:pointer">Recent decisions (' + done.length + ')</summary>' + done.map(function (q) {
      return '<div style="padding:8px 0;border-top:1px solid var(--line2);font-size:12.5px;line-height:1.5"><b style="font-weight:600">' + esc(q.title || q.target_label) + '</b> <span class="mut">· ' + (q.status === 'approved' ? 'Approved' : 'Dismissed') + ' by ' + esc(q.decided_by_name || 'an admin') + (q.decided_at ? ' · ' + ago(q.decided_at) : '') + '</span>' + (q.status === 'approved' && q.applied_rule ? '<div class="mut">' + esc(q.applied_rule) + '</div>' : '') + '</div>';
    }).join('') + '</details>' : '';
    w.innerHTML = head + body + hist;
  }
  function vQaSettings(tok) {
    RUBREQ = null; QSHIST = null;
    setMain(crumb([['QA settings']]) + '<div id="qswrap"><div class="oq-card">' + skel(36, 7) + '</div></div>');
    api({ action: 'settings' }).then(function (r) { if (tok !== T) return; QS = r; drawQs(); loadRules(); })
      .catch(function (e) { if (tok === T && $('qswrap')) $('qswrap').innerHTML = errBox(e); });
  }
  var RUBREQ = null, QSHIST = null, QSHN = 10;
  // Change history (2026-10-26): who changed what in QA settings, and when.
  function qsHistLine(x) {
    var d = x.detail || {}, cut = function (t, n) { t = String(t == null ? '' : t).replace(/\s+/g, ' ').trim(); return t.length > (n || 140) ? t.slice(0, n || 140) + '…' : t; };
    var stepN = function (k) { var r = ((QS && QS.rubric) || []).filter(function (s) { return s.key === k; })[0]; return r ? stepName(r.label) : k; };
    switch (x.kind) {
      case 'rubric_change': return (d.source === 'suggestion' ? 'Approved a suggested scoring rule' : 'Edited the call flow') + ((d.changes || []).length ? ': ' + d.changes.map(function (c) { if (c.added) return 'added “' + cut(c.added.label, 60) + '” (' + c.added.points + ' pts)'; var b = c.before || {}, a = c.after || {}, bits = []; if (a.label != null && a.label !== b.label) bits.push('renamed to “' + cut(a.label, 60) + '”'); if (a.points != null && Number(a.points) !== Number(b.points)) bits.push(b.points + ' → ' + a.points + ' pts'); if (a.guidance != null && a.guidance !== b.guidance) bits.push('scoring rule updated'); return stepN(c.key) + (bits.length ? ' (' + bits.join(', ') + ')' : ''); }).join('; ') : '');
      case 'guidance': return d.source === 'suggestion' ? 'Approved a suggested scoring instruction' : 'Changed the scoring instructions' + (d.after ? ': “' + cut(d.after) + '”' : ' (cleared)');
      case 'rubric_request': return 'Asked for a call-flow change: “' + cut(d.text) + '”' + (d.status && d.status !== 'pending' ? ' · ' + d.status + (d.decided_by ? ' by ' + d.decided_by : '') : '');
      case 'rule_suggestion_dismiss': return 'Dismissed a suggested scoring rule' + (d.note ? ': “' + cut(d.note) + '”' : '');
      case 'metric_add': return 'Added the metric “' + cut(d.label, 60) + '” (' + d.points + ' pts)';
      case 'metric_remove': return 'Removed a metric' + (d.label ? ' “' + cut(d.label, 60) + '”' : '');
      case 'kb_add': return 'Added to the knowledge base' + (d.title ? ': ' + cut(d.title, 80) : '');
      case 'kb_remove': return 'Removed from the knowledge base' + (d.title ? ': ' + cut(d.title, 80) : '');
      case 'job_value': return 'Changed a job value' + (d.brand ? ' for ' + short(d.brand) : '') + ': ' + (d.before == null ? 'none' : usd(d.before)) + ' → ' + usd(d.after);
      case 'calib_config': return 'Set calibration to ' + d.per_day + ' calls per weekday' + (d.enabled === false ? ' (turned off)' : '');
      default: return x.kind.replace(/_/g, ' ');
    }
  }
  function qsHistory() {
    if (!QSHIST) return '<div class="oq-card" style="margin-top:16px"><h2 class="ttl">Change History</h2>' + skel(16, 3) + '</div>';
    var rows = QSHIST.slice(0, QSHN);
    return '<div class="oq-card" style="margin-top:16px" id="qshist"><h2 class="ttl">Change History</h2><p class="sub">Every change to how calls are scored: who made it and when. Newest first.</p>' +
      (rows.length ? rows.map(function (x) { return '<div style="display:flex;gap:12px;padding:9px 0;border-top:1px solid var(--line2);font-size:13px;line-height:1.45"><span class="mut num" style="flex:none;width:118px;font-size:12px" title="' + esc(new Date(x.at).toLocaleString('en-US', { timeZone: 'America/New_York' }) + ' ET') + '">' + esc(new Date(x.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' }) + ' · ' + new Date(x.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })) + '</span><span style="flex:1;min-width:0"><b style="font-weight:600">' + esc(x.by) + '</b> ' + esc(qsHistLine(x)) + '</span></div>'; }).join('') : '<p class="mut" style="font-size:13px">No changes yet.</p>') +
      (QSHIST.length > QSHN ? '<button class="sel" data-act="qshmore" style="margin-top:10px">Show more (' + (QSHIST.length - QSHN) + ')</button>' : '') + '</div>';
  }
  function rubReqs() {
    if (RUBREQ === null) { RUBREQ = []; api({ action: 'rubric', op: 'list' }).then(function (r) { RUBREQ = r.requests || []; QSHIST = r.history || []; drawQs(); }).catch(function () {}); return ''; }
    if (!RUBREQ.length) return '';
    return '<div style="margin-top:12px;background:#EEF2FB;border-radius:12px;padding:10px 12px"><b style="font-size:13px;color:#2B3A67">' + (IS_ADMIN ? 'Change requests from your team' : 'Your requests waiting for your admin') + '</b>' + RUBREQ.map(function (q) {
      return '<div style="padding:8px 0;border-top:1px solid #D9E0F2;font-size:12.5px;line-height:1.5"><div>' + esc(q.text) + '</div><div class="mut">' + esc(q.requested_by || '') + ' · ' + ago(q.at) + '</div>' + (IS_ADMIN ? '<div class="row" style="gap:6px;margin-top:6px"><button class="sel" data-act="rubreqdone" data-r="' + q.id + '" style="padding:5px 10px;font-size:12px">Done</button><button class="sel" data-act="rubreqno" data-r="' + q.id + '" style="padding:5px 10px;font-size:12px">Dismiss</button></div>' : '') + '</div>';
    }).join('') + '</div>';
  }
  function readRubForm() { (QSE.redit || []).forEach(function (x, i) { var l = $('rl' + i), p = $('rp' + i), g = $('rg' + i); if (l) x.label = l.value; if (p) x.points = p.value; if (g) x.guidance = g.value; }); }
  function rubForm() {
    var tot = (QSE.redit || []).reduce(function (t, x) { return t + (+x.points || 0); }, 0);
    return '<div style="display:flex;flex-direction:column;gap:10px;margin-top:12px">' + QSE.redit.map(function (x, i) {
      return '<div style="border:1px solid var(--line);border-radius:12px;padding:12px;background:#FAF8F4"><div class="row" style="gap:8px;align-items:flex-end"><div style="flex:1 1 260px"><label class="l" for="rl' + i + '">Step</label><input id="rl' + i + '" class="oq-field" maxlength="300" value="' + esc(x.label) + '" placeholder="e.g. Step 6 Offer the maintenance plan"></div><div style="width:100px"><label class="l" for="rp' + i + '">Points</label><input id="rp' + i + '" class="oq-field" type="number" min="0" max="100" value="' + esc(String(x.points)) + '"></div></div>' +
        '<label class="l" for="rg' + i + '" style="margin-top:8px">What counts as done (the AI uses this)</label><textarea id="rg' + i + '" class="oq-field" style="min-height:70px" maxlength="4000">' + esc(x.guidance || '') + '</textarea></div>';
    }).join('') + '<div class="row" style="gap:8px;align-items:center"><button class="sel" data-act="rubadd">+ Add step</button><span class="mut" style="font-size:12.5px">Total: <b class="num" id="rubtot">' + tot + '</b> pts' + (tot !== 100 ? ' · most call flows add up to 100' : '') + '</span></div>' +
      '<div class="row" style="gap:8px"><button class="sel btnd" data-act="rubsave">Save call flow</button><button class="sel" data-act="rubcancel">Cancel</button></div><div class="mut" style="font-size:12px">Past calls keep their scores. To re-score a past call on the new flow, ask the AI on that call.</div></div>';
  }
  function drawQs() {
    var w = $('qswrap'); if (!w || !QS) return;
    var rub = QS.rubric || [], mine = rub.filter(function (r) { return r.section === 'custom'; }), core = rub.filter(function (r) { return r.section !== 'custom'; });
    var section = function (title, desc, body, btn) { return '<div style="padding:16px 0;border-top:1px solid var(--line2)"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap"><div style="flex:1 1 260px"><div style="font-weight:600">' + title + '</div><div class="mut" style="font-size:12.5px;margin-top:3px;line-height:1.45">' + desc + '</div></div>' + (btn || '') + '</div>' + body + '</div>'; };
    var dis = QSE.busy ? ' disabled' : '';
    var h = '<div class="oq-card" id="rsbox" style="display:none"></div><div class="row" style="align-items:flex-start"><div class="oq-card" style="flex:999 1 560px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><div><h2 class="ttl">QA settings</h2><p class="sub">How ' + esc(CLIENT) + '’s calls are scored. Changes apply to new calls.</p></div><span class="pill" style="' + (QS.live ? 'background:#E6F0EA;color:#1F5A41' : 'background:#F3F1EC;color:#56605B') + '">' + (QS.live ? '● Scoring live' : '○ Scoring paused') + '</span></div>' +
      section('Which calls are scored', (QS.sample >= 100 ? 'Every call' : QS.sample + '% of calls') + (QS.min_seconds ? ' longer than ' + QS.min_seconds + ' seconds' : '') + ' with a recording. Voicemail, internal and IVR-only calls are recognised automatically and kept out of the scores.', '') +
      section('Your scoring instructions', 'Extra guidance the AI follows when it scores and classifies your calls — for example how to treat warranty calls or what counts as a lead. Your call flow below still applies.',
        (QSE.ins ? '<div style="margin-top:10px"><label class="sr" for="qins">Scoring instructions</label><textarea id="qins" class="oq-field" style="min-height:140px;resize:vertical" maxlength="6000" placeholder="e.g. A caller asking only for a price on a new door is still a sales lead — the CSR should offer an estimate visit.">' + esc(QS.guidance) + '</textarea><div style="display:flex;gap:8px;margin-top:8px"><button class="sel btnd" data-act="qsins"' + dis + '>' + (QSE.busy ? 'Saving…' : 'Save instructions') + '</button><button class="sel" data-act="qsinscancel">Cancel</button></div></div>'
          : (QS.guidance ? '<div style="font-size:13px;line-height:1.55;margin-top:10px;background:#F5F3EE;border-radius:10px;padding:10px 12px;white-space:pre-wrap">' + esc(QS.guidance) + '</div>' : '<div class="mut" style="font-size:12.5px;margin-top:8px">No instructions yet.</div>')),
        IS_ADMIN && !QSE.ins ? '<button class="sel" data-act="qsinsedit">' + (QS.guidance ? 'Edit' : '+ Add instructions') + '</button>' : '') +
      section('Your score metrics', 'Your own scoring items, added on top of the rubric below. Each one adds points to the score of new calls.',
        (mine.length ? '<div style="display:flex;flex-direction:column;gap:6px;margin-top:10px">' + mine.map(function (m) {
          return '<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;background:#F5F3EE;border-radius:10px;padding:8px 12px;font-size:13px"><span><b style="font-weight:600">' + esc(m.label) + '</b> <span class="mut">· ' + m.points + ' pts</span>' + (m.guidance ? '<span class="mut" style="display:block;font-size:12px;margin-top:2px">' + esc(m.guidance) + '</span>' : '') + '</span>' +
            (IS_ADMIN ? (QSE.del === m.key ? '<span style="display:flex;gap:6px;align-items:center"><span class="mut" style="font-size:12px">Remove?</span><button class="sel" data-act="qsmdelyes" data-k="' + esc(m.key) + '" style="padding:5px 10px;font-size:12px;color:#B4461F"' + dis + '>Remove</button><button class="sel" data-act="qsmdelno" style="padding:5px 10px;font-size:12px">Keep</button></span>' : '<button class="sel" data-act="qsmdel" data-k="' + esc(m.key) + '" style="padding:5px 10px;font-size:12px">Remove</button>') : '') + '</div>';
        }).join('') + '</div>' : '<div class="mut" style="font-size:12.5px;margin-top:8px">No custom metrics.</div>') +
        (QSE.metric ? '<div style="display:flex;flex-direction:column;gap:8px;margin-top:12px;padding:14px;border:1px solid var(--line);border-radius:12px;background:#FAF8F4"><div class="row" style="gap:8px"><div style="flex:1 1 240px"><label class="l" for="qmn">Metric</label><input id="qmn" class="oq-field" maxlength="200" placeholder="e.g. Mentioned the maintenance plan"></div><div style="width:120px"><label class="l" for="qmp">Points</label><input id="qmp" class="oq-field" type="number" min="1" max="50" placeholder="1–50"></div></div><div><label class="l" for="qmg">How should the AI judge it? (optional)</label><input id="qmg" class="oq-field" maxlength="1000" placeholder="e.g. Yes if the CSR offers the plan before ending the call"></div><div style="display:flex;gap:8px"><button class="sel btnd" data-act="qsmadd"' + dis + '>' + (QSE.busy ? 'Saving…' : 'Add metric') + '</button><button class="sel" data-act="qsmcancel">Cancel</button></div></div>' : ''),
        IS_ADMIN && !QSE.metric ? '<button class="sel" data-act="qsmnew">+ Add metric</button>' : '') +
      section('Call flow', IS_ADMIN ? 'The steps every call is scored on. Edit them any time; changes apply to calls scored after you save.' : 'The steps every call is scored on. Ask your account admin for a change.',
        (QSE.redit ? rubForm() : '<div style="display:flex;flex-direction:column;margin-top:10px">' + core.map(function (r) { return '<div style="display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-top:1px solid var(--line2);font-size:13px"><span>' + esc(r.label) + '</span><span class="mut num" style="white-space:nowrap">' + r.points + ' pts</span></div>'; }).join('') + '</div>') + rubReqs() +
        (QSE.req ? '<div style="margin-top:12px"><label class="l" for="qreq">What would you like changed?</label><textarea id="qreq" class="oq-field" style="min-height:90px" maxlength="3000" placeholder="e.g. Don’t score card capture on warranty calls."></textarea><div class="mut" style="font-size:12px;margin-top:4px">This goes to your account admin.</div><div style="display:flex;gap:8px;margin-top:8px"><button class="sel btnd" data-act="qsreqsend"' + dis + '>' + (QSE.busy ? 'Sending…' : 'Send request') + '</button><button class="sel" data-act="qsreqcancel">Cancel</button></div></div>' : ''),
        IS_ADMIN ? (QSE.redit ? '' : '<button class="sel" data-act="rubedit">Edit call flow</button>') : (CAN_EDIT && !QSE.req ? '<button class="sel" data-act="qsreq">Request a change</button>' : '')) +
      '</div><div class="oq-card" style="flex:1 1 300px;align-self:flex-start"><h2 class="ttl">How this works</h2><p class="sub" style="line-height:1.6">Changes apply to calls scored after you save — past scores don’t change. Every change is logged with who made it.</p><p class="sub" style="line-height:1.6;margin-top:10px">Each Monday the tool also looks for corrections your team keeps making and suggests a rule. Your account admins decide whether to add it.</p>' + (IS_ADMIN ? '' : '<p class="sub" style="line-height:1.6;margin-top:10px">Only account admins can change instructions and metrics.</p>') + '</div></div>';
    w.innerHTML = h + qsHistory(); drawRules();
    var f = $('qins') || $('qmn') || $('qreq'); if (f) f.focus();
  }
  function qsWrite(body, done, after, btn) {
    if (QSE.busy) return; QSE.busy = true; busyBtn(btn, true);
    api(Object.assign({ action: 'settings' }, body)).then(function (r) { QSE.busy = false; if (r && r.rubric) QS = r; if (after) after(); drawQs(); toast(done); })
      .catch(function (e) { QSE.busy = false; busyBtn(btn, false); toast(e.message || 'Couldn’t save. Try again.'); });
  }

  // Team & access
  var TM = { list: null, inv: null, del: null, busy: false };
  var ROLES = [['admin', 'Account admin', 'Everything, plus people, QA settings and the knowledge base', ['All brands', 'Change scores and add notes', 'Edit knowledge base + QA settings', 'Invite and remove people']], ['manager', 'Brand manager', 'Coach their brand — notes and score changes', ['One brand or all brands', 'Change scores and add notes', 'Ask the AI, play recordings']], ['viewer', 'Viewer', 'Read-only dashboards and call reviews', ['One brand or all brands', 'Play recordings, ask the AI', 'No changes']]];
  var RNAME = { admin: 'Account admin', manager: 'Brand manager', viewer: 'Viewer', csr: 'CSR' };
  function vTeam(tok) {
    if (!IS_ADMIN) { setMain(crumb([['Team & access']]) + noRights('Team & access')); return; }
    setMain(crumb([['Team & access']]) + '<div id="tmwrap"><div class="oq-card">' + skel(40, 6) + '</div></div>');
    Promise.all([api({ action: 'team' }), KNOWN.brands.length ? null : loadReport().then(noteKnown).catch(function () {})]).then(function (r) { if (tok !== T) return; TM.list = r[0].people || []; drawTeam(); })
      .catch(function (e) { if (tok === T && $('tmwrap')) $('tmwrap').innerHTML = errBox(e); });
  }
  function brandSel(id, cur, dis) { return '<select id="' + id + '" class="oq-field" style="padding:6px 10px;font-size:13px;width:auto"' + (dis ? ' disabled' : '') + '><option value="">All brands</option>' + KNOWN.brands.slice().sort().map(function (b) { return '<option' + (cur === b ? ' selected' : '') + ' value="' + esc(b) + '">' + esc(short(b)) + '</option>'; }).join('') + (cur && KNOWN.brands.indexOf(cur) < 0 ? '<option selected value="' + esc(cur) + '">' + esc(short(cur)) + '</option>' : '') + '</select>'; }
  function drawTeam() {
    var w = $('tmwrap'); if (!w || !TM.list) return;
    var I = TM.inv, dis = TM.busy ? ' disabled' : '';
    var form = I ? '<div style="margin-top:14px;padding:18px;border:1px solid var(--line);border-radius:14px;background:#FAF8F4"><div style="font-weight:600;font-size:15px">Invite someone</div><div class="mut" style="font-size:12.5px;margin-top:3px">We’ll create their login and open an email from you with their sign-in link, ready to send from your own mailbox. They only ever see ' + esc(CLIENT) + ' call quality.</div>' +
      '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-top:14px"><div><label class="l" for="ivn">Full name</label><input id="ivn" class="oq-field" placeholder="e.g. Jordan Smith" value="' + esc(I.name) + '"></div><div><label class="l" for="ive">Email</label><input id="ive" class="oq-field" type="email" placeholder="name@company.com" value="' + esc(I.email) + '"></div><div><label class="l" for="ivr">Role</label><select id="ivr" class="oq-field" data-invrole="1">' + ROLES.map(function (r) { return '<option value="' + r[0] + '"' + (I.role === r[0] ? ' selected' : '') + '>' + r[1] + '</option>'; }).join('') + '</select></div>' +
      (I.role !== 'admin' ? '<div><label class="l" for="ivb">Brand</label>' + brandSel('ivb', I.brand, false).replace('style="padding:6px 10px;font-size:13px;width:auto"', '') + '</div>' : '') + '</div>' +
      '<div style="display:flex;gap:8px;margin-top:16px"><button class="sel btnd" data-act="invsend"' + dis + '>' + (TM.busy ? 'Creating…' : 'Create invite') + '</button><button class="sel" data-act="invcancel">Cancel</button></div></div>' : '';
    var mailBox = TM.mail ? inviteBox(TM.mail) : '';
    var rows = TM.list.map(function (u, i) {
      var me = u.email && CFG.email && u.email.toLowerCase() === String(CFG.email).toLowerCase();
      var st = !u.active ? ['Removed', 'background:#F3F1EC;color:#56605B'] : u.invited ? ['Invited', 'background:#FFF4DE;color:#8A5A00'] : ['Active', 'background:#E6F0EA;color:#1F5A41'];
      var lock = !u.active || me || TM.busy;
      return '<tr><td><div style="display:flex;align-items:center;gap:10px"><span class="av">' + esc(String(u.name || '?').split(' ').map(function (x) { return x[0]; }).join('').slice(0, 2).toUpperCase()) + '</span><div><div style="font-weight:600">' + esc(u.name) + (me ? ' <span class="mut" style="font-weight:400">(you)</span>' : '') + '</div><div class="mut" style="font-size:12px">' + esc(u.email || '') + '</div></div></div></td>' +
        '<td><label class="sr" for="tr-' + u.id + '">Role for ' + esc(u.name) + '</label><select id="tr-' + u.id + '" class="oq-field" style="padding:6px 10px;font-size:13px;width:auto" data-trow="' + i + '"' + (lock ? ' disabled' : '') + '>' + ROLES.map(function (r) { return '<option value="' + r[0] + '"' + (u.role === r[0] ? ' selected' : '') + '>' + r[1] + '</option>'; }).join('') + '</select></td>' +
        '<td>' + (u.role === 'admin' ? '<span class="mut" style="font-size:12.5px">All brands</span>' : '<label class="sr" for="tb-' + u.id + '">Brand for ' + esc(u.name) + '</label>' + brandSel('tb-' + u.id, u.brand, lock).replace('<select ', '<select data-trow="' + i + '" ')) + '</td>' +
        '<td><span class="pill" style="' + st[1] + '">' + st[0] + '</span></td><td class="mut" style="font-size:12.5px">' + (u.last ? ago(u.last) : '—') + '</td>' +
        '<td style="text-align:right;white-space:nowrap">' + (me ? '' : !u.active ? '<button class="sel" data-act="prestore" data-i="' + i + '" style="padding:5px 10px;font-size:12px"' + dis + '>Restore</button>' : TM.del === i ? '<span class="mut" style="font-size:12px;margin-right:6px">Remove access?</span><button class="sel" data-act="pdelyes" data-i="' + i + '" style="padding:5px 10px;font-size:12px;color:#B4461F"' + dis + '>Remove</button> <button class="sel" data-act="pdelno" style="padding:5px 10px;font-size:12px">Keep</button>'
          : (u.invited ? '<button class="sel" data-act="presend" data-i="' + i + '" style="padding:5px 10px;font-size:12px"' + dis + '>Resend invite</button> ' : '') + '<button class="sel" data-act="pdel" data-i="' + i + '" style="padding:5px 10px;font-size:12px">Remove</button>') + '</td></tr>';
    }).join('');
    w.innerHTML = '<div style="display:flex;flex-direction:column;gap:16px">' + mailBox + '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(230px,1fr))">' + ROLES.map(function (r) { return '<div class="oq-card"><b style="font-size:15px">' + r[1] + '</b><div class="mut" style="font-size:12.5px;margin-top:4px;line-height:1.45">' + r[2] + '</div><div style="display:flex;flex-direction:column;gap:6px;margin-top:12px">' + r[3].map(function (p) { return '<div style="font-size:12.5px;display:flex;gap:8px"><span style="color:' + G + '">✓</span>' + p + '</div>'; }).join('') + '</div></div>'; }).join('') + '</div>' +
      '<div class="oq-card"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px"><div><h2 class="ttl">People</h2><p class="sub">' + TM.list.filter(function (u) { return u.active; }).length + ' with access · logins only ever see ' + esc(CLIENT) + '’s own call quality — never anything else in Opsis.</p></div>' + (I ? '' : '<button class="sel btnd" data-act="invite">+ Invite</button>') + '</div>' + form +
      '<p class="swipe mut" style="display:none;font-size:11.5px;margin:8px 0 0">Swipe sideways for more columns →</p><div style="overflow-x:auto;margin-top:12px"><table class="tbl" style="font-size:13.5px"><thead><tr><th>Person</th><th>Role</th><th>Brand</th><th>Status</th><th>Last active</th><th></th></tr></thead><tbody>' + (rows || '<tr><td colspan="6" class="mut">No one yet.</td></tr>') + '</tbody></table></div></div></div>';
    if (I) { var n = $('ivn'); if (n && !I.name) n.focus(); }
  }
  function inviteBox(M) {
    var enc = encodeURIComponent, owa = 'https://outlook.office.com/mail/deeplink/compose?to=' + enc(M.to) + '&subject=' + enc(M.subject) + '&body=' + enc(M.body);
    var mt = 'mailto:' + enc(M.to) + '?subject=' + enc(M.subject) + '&body=' + enc(M.body);
    return '<div class="oq-card" style="border-color:#B9D7C6;background:#F2F8F4"><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap"><div><h2 class="ttl">Invite ready for ' + esc(M.to) + '</h2><p class="sub">Send it from your own mailbox. The sign-in link works for 24 hours.</p></div><button class="more" data-act="mailclose">Done</button></div>' +
      '<div class="row" style="gap:8px;margin-top:12px"><a class="sel btnd" href="' + esc(owa) + '" target="_blank" rel="noopener" style="text-decoration:none">Open draft in Outlook</a><a class="sel" href="' + esc(mt) + '" style="text-decoration:none">Open in my email app</a><button class="sel" data-act="mailcopy">Copy email text</button></div>' +
      '<pre style="white-space:pre-wrap;font-family:inherit;font-size:12.5px;line-height:1.5;background:#fff;border:1px solid var(--line2);border-radius:10px;padding:10px 12px;margin-top:12px"><b>Subject:</b> ' + esc(M.subject) + '\n\n' + esc(M.body) + '</pre></div>';
  }
  function keepInv() { if (!TM.inv) return; var n = $('ivn'), e = $('ive'), b = $('ivb'); if (n) TM.inv.name = n.value; if (e) TM.inv.email = e.value; if (b) TM.inv.brand = b.value; }
  function teamWrite(body, done, btn) {
    if (TM.busy) return; TM.busy = true; busyBtn(btn, true);
    api(Object.assign({ action: 'team' }, body)).then(function (r) { TM.busy = false; TM.list = r.people || []; TM.del = null; if (body.op === 'invite') TM.inv = null; drawTeam(); toast(done); })
      .catch(function (e) { TM.busy = false; busyBtn(btn, false); drawTeam(); toast(e.message || 'Couldn’t save. Try again.'); });
  }

  // CSR scorecards (the existing Command Center scorecard, mounted inside this shell)
  var EXT = null;
  function vScorecards() {
    setMain(crumb([['CSR scorecards']]) + '<div class="oq-card" style="padding:0;overflow:hidden"><div id="csrmount" style="min-height:300px"></div></div>');
    if (CFG.mountCsr) EXT = CFG.mountCsr($('csrmount'));
  }


  // ---------- Reporting & exports (same options as the classic portal) ----------
  var RP = { sc: null, bill: null, key: '', busy: '', n: 0, scope: 'notbooked', allTypes: false, trans: false, agent: '', team: '', csr: '' };
  var RP_SCOPES = [['notbooked', 'Revenue opportunities — not booked', 'The list to check against your CRM. Includes customer name and phone.'], ['opps', 'All revenue opportunities', 'Booked and not booked.'], ['all', 'All scored calls', 'Every call the AI scored.']];
  var RP_COLS = ['call_date', 'call_time', 'brand', 'agent', 'customer_name', 'customer_phone', 'customer_phone_10', 'customer_state', 'direction', 'duration_sec', 'call_type',
    'call_leg', 'leg_no', 'legs', 'transferred', 'journey', 'customer_type', 'commercial', 'opportunity', 'outcome', 'not_booked_reason', 'fcr', 'first_person_resolution', 'sentiment', 'sentiment_score',
    'opportunity_context', 'objections', 'revenue_tip', 'asked_for_booking', 'info_before_pricing', 'set_fee_expectations',
    'asked_for_cc', 'collected_cc', 'topics', 'score_pct', 'earned', 'max', 'introduce', 'listen', 'collect_info', 'sell_offer', 'sell_ask', 'sell_card', 'sell_objection', 'sell_expert', 'sell_appointment', 'confirm_thank', 'steps_missed',
    'job_type', 'missed_type', 'missed_why', 'summary', 'coaching_note', 'strengths', 'improvements', 'risk_flags', 'manager_adjusted', 'reviewed', 'review_id', 'call_id'];
  function rpWin() { return { start: S.start, end: S.end, brands: S.brands.length ? S.brands : null }; }
  function rpTag() { return (S.brands.length === 1 ? '-' + String(S.brands[0]).toLowerCase().replace(/[^a-z0-9]+/g, '-') : S.brands.length ? '-multi-brand' : '') + '-' + S.start + '-to-' + S.end; }
  function rpFilterText() { return rangeLabel() + ' · ' + (S.brands.length ? (S.brands.length === 1 ? S.brands[0] : S.brands.length + ' brands') : (LOCK || 'All brands')); }
  function csvCell(v) { var s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function saveBlob(name, blob) { var u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = name; ROOT.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 1500); }
  function sheetsCsv(name, sheets) {
    var parts = sheets.map(function (s) { return [s.title ? csvCell(s.title) : ''].concat([s.cols.map(csvCell).join(',')]).concat(s.rows.map(function (r) { return r.map(csvCell).join(','); })).filter(function (x) { return x !== ''; }).join('\n'); });
    saveBlob(name + '.csv', new Blob(['﻿' + parts.join('\n\n')], { type: 'text/csv;charset=utf-8;' }));
  }
  var XLSXP = null;
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!XLSXP) XLSXP = new Promise(function (ok, bad) { var s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = function () { ok(window.XLSX); }; s.onerror = function () { XLSXP = null; bad(new Error('Couldn’t load Excel. Try CSV instead.')); }; document.head.appendChild(s); });
    return XLSXP;
  }
  function sheetsXlsx(name, sheets) {
    return loadXlsx().then(function (X) { var wb = X.utils.book_new(), used = {};
      sheets.forEach(function (s, i) { var n = String(s.sheet || s.title || ('Sheet' + (i + 1))).replace(/[\\\/?*\[\]:]/g, ' ').slice(0, 31); while (used[n]) n = n.slice(0, 29) + i; used[n] = 1; X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([s.cols].concat(s.rows)), n); });
      X.writeFile(wb, name + '.xlsx'); });
  }
  function pdfShell(w, title, sub, body) {
    var gen = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    w.document.open();
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>@page{margin:12mm}*{box-sizing:border-box}body{font-family:Montserrat,-apple-system,"Segoe UI",Arial,sans-serif;color:#1C2421;padding:6px 10px;font-size:12px}' +
      'h1{font-size:18px;margin:0 0 2px;border-bottom:3px solid #14302A;padding-bottom:8px}.sub{color:#5F6763;font-size:11px;margin:6px 0 4px}h2{font-size:13px;margin:16px 0 6px}' +
      'table{width:100%;border-collapse:collapse;margin-bottom:8px}th{background:#14302A;color:#fff;text-align:center;padding:6px 7px;font-size:10px;text-transform:uppercase;letter-spacing:.04em}th:first-child{text-align:left;border-radius:6px 0 0 0}th:last-child{border-radius:0 6px 0 0}td{padding:5px 7px;border-top:1px solid #ECE8E0;vertical-align:top;text-align:center}td:first-child{text-align:left;font-weight:600}tbody tr:nth-child(even) td{background:#FAF8F4}tr{page-break-inside:avoid}' +
      '.foot{margin-top:14px;border-top:1px solid #E8E4DC;padding-top:6px;color:#8A918D;font-size:10px;display:flex;justify-content:space-between}.np{text-align:center;margin-bottom:10px}.np button{background:#14302A;color:#fff;border:none;padding:8px 16px;border-radius:8px;font-weight:700;cursor:pointer}@media print{.np{display:none}body{padding:0}}</style></head><body>' +
      '<div class="np"><button onclick="window.print()">Save as PDF / Print</button></div><h1>' + esc(title) + '</h1><div class="sub">' + esc(sub) + '</div>' + body +
      '<div class="foot"><span>Generated ' + esc(gen) + '</span><span>Opsis QA · Opsis CX</span></div><scr' + 'ipt>window.onload=function(){setTimeout(function(){window.print()},300)}</scr' + 'ipt></body></html>');
    w.document.close(); try { w.focus(); } catch (x) {}
  }
  function sheetsPdf(w, title, sub, sheets) {
    pdfShell(w, title, sub, sheets.map(function (s) { return '<h2>' + esc(s.title || '') + '</h2><table><thead><tr>' + s.cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      s.rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + esc(c == null ? '' : c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>'; }).join(''));
  }
  // Reports open in an in-page preview (2026-10-27): a pop-up window's print dialog froze the portal until it was closed and reopened.
  // pdfWin() hands back a window-like object; whatever is written to it is shown in a full-screen frame with Save as PDF / Print and Close.
  function pdfWin() {
    var old = document.getElementById('oqpdf'); if (old) old.remove();
    var ov = document.createElement('div'); ov.id = 'oqpdf';
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(20,48,42,.92);display:flex;flex-direction:column;align-items:center;padding:16px;font-family:Montserrat,Arial,sans-serif';
    ov.innerHTML = '<div style="width:100%;max-width:1100px;display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px"><b style="color:#fff;font-size:15px" id="oqpdft">Preparing your report…</b><div style="display:flex;gap:8px"><button type="button" id="oqpdfp" disabled style="background:#fff;color:#14302A;border:0;border-radius:10px;padding:9px 16px;font:700 13px Montserrat,Arial;cursor:pointer;opacity:.6">Save as PDF / Print</button><button type="button" id="oqpdfx" style="background:transparent;color:#fff;border:1px solid rgba(255,255,255,.6);border-radius:10px;padding:9px 14px;font:600 13px Montserrat,Arial;cursor:pointer">Close</button></div></div><iframe id="oqpdff" title="Report preview" style="flex:1;width:100%;max-width:1100px;border:0;border-radius:12px;background:#fff"></iframe>';
    document.body.appendChild(ov);
    var buf = '', closed = false, close = function () { closed = true; ov.remove(); document.removeEventListener('keydown', esc1); };
    var esc1 = function (e) { if (e.key === 'Escape') close(); }; document.addEventListener('keydown', esc1);
    ov.querySelector('#oqpdfx').onclick = close;
    var fr = ov.querySelector('#oqpdff'), pb = ov.querySelector('#oqpdfp');
    pb.onclick = function () { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (x) {} };
    return {
      document: { open: function () { buf = ''; }, write: function (h) { buf += h; }, close: function () {
        if (closed) return;
        var html = buf.replace(/<script>window\.onload=[\s\S]*?<\/script>/, '');
        html = html.replace('</head>', '<style>.np,.pbar{display:none!important}</style></head>');
        fr.srcdoc = html; var t = (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1]; ov.querySelector('#oqpdft').textContent = t ? t.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"') : 'Report';
        pb.disabled = false; pb.style.opacity = '1'; buf = '';
      } },
      focus: function () {}, print: function () { pb.onclick(); }, close: close
    };
  }
  function v1(v) { return v == null ? '' : Math.round(Number(v) * 10) / 10; }
  function yn(v) { return v === true ? 'yes' : v === false ? 'no' : (v || ''); }

  // pull every matching call, 1,000 at a time
  function rpPull(body, onCount) {
    var all = [];
    function next(after) {
      var b = Object.assign({ action: 'export' }, rpWin(), body); if (after) { b.after_date = after.call_date; b.after_id = after.review_id; }
      return api(b).then(function (rows) { rows = rows || []; all = all.concat(rows); if (onCount) onCount(all.length); return rows.length >= (body.transcript ? 250 : 1000) && all.length < 200000 ? next(rows[rows.length - 1]) : all; });
    }
    return next(null);
  }

  // ----- report builders (sheets = [{title, sheet, cols, rows}]) -----
  function bExec(sc) { var o = sc.overall || {};
    return [{ title: 'Summary', sheet: 'Summary', cols: ['Metric', 'Value'], rows: [['Calls scored', o.scored || 0], ['Average QA score %', v1(o.avg)], ['Revenue opportunities', o.opps || 0], ['Decided opportunities', o.decided || 0], ['Booked', o.booked || 0], ['Not booked', o.missed || 0], ['Booking rate %', o.decided ? v1(100 * o.booked / o.decided) : '']] },
      { title: 'Brand ranking', sheet: 'Brands', cols: ['Brand', 'Calls', 'Avg QA %', 'Booking rate %', 'Card asked %', 'Card collected %', 'Not booked', 'CSRs'],
        rows: (sc.brands || []).slice().sort(function (a, b) { return (b.avg || -1) - (a.avg || -1); }).map(function (b) { return [b.brand, b.calls, v1(b.avg), v1(b.conv), v1(b.card_rate), v1(b.collect_rate), b.missed, b.agents]; }) },
      { title: 'Top coaching focus', sheet: 'Coaching', cols: ['Coaching focus', 'CSRs with this as #1'], rows: rpGaps(sc, null) }];
  }
  function rpGaps(sc, brand) { var m = {}; (sc.agents || []).forEach(function (a) { if (a.ai || !a.focus || (brand && a.brand !== brand)) return; m[a.focus] = (m[a.focus] || 0) + 1; });
    return Object.keys(m).sort(function (a, b) { return m[b] - m[a]; }).map(function (k) { return [k, m[k]]; }); }
  function bTeam(sc, brand) { var b = (sc.brands || []).filter(function (x) { return x.brand === brand; })[0] || {};
    var ag = (sc.agents || []).filter(function (a) { return a.brand === brand; }).sort(function (a, b2) { return (b2.avg || -1) - (a.avg || -1); });
    return [{ title: brand + ' — summary', sheet: 'Summary', cols: ['Metric', 'Value'], rows: [['Calls scored', b.calls || 0], ['Average QA score %', v1(b.avg)], ['Booking rate %', v1(b.conv)], ['Card asked %', v1(b.card_rate)], ['Not booked', b.missed || 0], ['CSRs', b.agents || 0]] },
      { title: 'CSR leaderboard', sheet: 'CSRs', cols: ['#', 'CSR', 'AI receptionist', 'Calls', 'Avg QA %', 'Booking rate %', 'Asked for booking %', 'Card asked %', 'Coaching focus'],
        rows: ag.map(function (a, i) { return [i + 1, a.name, a.ai ? 'yes' : '', a.calls, v1(a.avg), v1(a.conv), v1(a.ask_rate), v1(a.card_rate), a.focus || '']; }) },
      { title: 'Team coaching focus', sheet: 'Coaching', cols: ['Coaching focus', 'CSRs with this as #1'], rows: rpGaps(sc, brand) }];
  }
  function bCsr(sc, key, rows) { var p = key.split('|||'), a = (sc.agents || []).filter(function (x) { return x.name === p[0] && x.brand === p[1]; })[0] || {};
    return [{ title: p[0] + ' (' + p[1] + ') — scorecard', sheet: 'Scorecard', cols: ['Metric', 'Value'], rows: [['Calls scored', a.calls || 0], ['Average QA score %', v1(a.avg)], ['Booking rate %', v1(a.conv)], ['Asked for booking %', v1(a.ask_rate)], ['Card asked %', v1(a.card_rate)], ['Top coaching focus', a.focus || '']] },
      { title: 'Calls', sheet: 'Calls', cols: ['Date', 'Time', 'Score %', 'Opportunity', 'Outcome', 'Not booked reason', 'Steps missed', 'Summary'],
        rows: rows.filter(function (r) { return r.brand === p[1]; }).map(function (r) { return [r.call_date, r.call_time || '', r.score_pct, yn(r.opportunity), r.outcome || '', r.not_booked_reason || '', r.steps_missed || '', r.summary || '']; }) }];
  }
  function bHai(sc) { var m = {};
    (sc.agents || []).forEach(function (a) { var o = m[a.brand] || (m[a.brand] = { brand: a.brand, h: [0, 0, 0, 0], a: [0, 0, 0, 0] }), t = a.ai ? o.a : o.h; t[0] += a.calls; t[1] += (a.avg || 0) * a.calls; t[2] += a.decided || 0; t[3] += a.booked || 0; });
    var L = Object.keys(m).sort().map(function (k) { return m[k]; }), T = { h: [0, 0, 0, 0], a: [0, 0, 0, 0] };
    L.forEach(function (o) { for (var i = 0; i < 4; i++) { T.h[i] += o.h[i]; T.a[i] += o.a[i]; } });
    var avg = function (t) { return t[0] ? t[1] / t[0] : null; }, cl = function (t) { return t[2] ? 100 * t[3] / t[2] : null; }, df = function (x, y) { return x == null || y == null ? '' : v1(y - x); };
    return [{ title: 'Human vs AI — summary', sheet: 'Summary', cols: ['Metric', 'Human CSRs', 'AI receptionists', 'AI difference'], rows: [['Avg QA %', v1(avg(T.h)), v1(avg(T.a)), df(avg(T.h), avg(T.a))], ['Scored calls', T.h[0], T.a[0], ''], ['Booking rate %', v1(cl(T.h)), v1(cl(T.a)), df(cl(T.h), cl(T.a))], ['Decided opportunities', T.h[2], T.a[2], ''], ['Booked', T.h[3], T.a[3], '']] },
      { title: 'By brand', sheet: 'By brand', cols: ['Brand', 'Human calls', 'Human avg QA %', 'Human booking %', 'AI calls', 'AI avg QA %', 'AI booking %'],
        rows: L.map(function (o) { return [o.brand, o.h[0], v1(avg(o.h)), v1(cl(o.h)), o.a[0], v1(avg(o.a)), v1(cl(o.a))]; }) }];
  }

  function vReporting(tok) {
    setMain(crumb([['Reporting']]) + '<div id="rpwrap"><div class="oq-card">' + skel(36, 6) + '</div></div>');
    var key = S.start + '|' + S.end + '|' + S.brands.join(',');
    if (RP.sc && RP.key === key) { drawReporting(); return; }
    Promise.all([api(Object.assign({ action: 'scorecards' }, rpWin())), Promise.resolve(null)]).then(function (r) { if (tok !== T) return; RP.sc = r[0] || {}; RP.bill = r[1]; RP.key = key; drawReporting(); })
      .catch(function (e) { if (tok === T && $('rpwrap')) $('rpwrap').innerHTML = errBox(e); });
  }
  function rpBtns(id) { return '<div style="display:flex;gap:6px;flex-wrap:wrap"><button class="sel" data-act="rpdl" data-r="' + id + '" data-f="pdf"' + (RP.busy ? ' disabled' : '') + '>PDF</button><button class="sel" data-act="rpdl" data-r="' + id + '" data-f="xlsx"' + (RP.busy ? ' disabled' : '') + '>Excel</button><button class="sel" data-act="rpdl" data-r="' + id + '" data-f="csv"' + (RP.busy ? ' disabled' : '') + '>CSV</button></div>'; }
  function drawReporting() {
    var w = $('rpwrap'); if (!w || !RP.sc) return; var sc = RP.sc;
    var brands = (sc.brands || []).map(function (b) { return b.brand; }).filter(function (b) { return b && b !== '—'; }).sort();
    if (!RP.team || brands.indexOf(RP.team) < 0) RP.team = brands[0] || '';
    var agents = (sc.agents || []).slice().sort(function (a, b) { return a.name.localeCompare(b.name) || a.brand.localeCompare(b.brand); });
    if (!RP.csr || !agents.some(function (a) { return a.name + '|||' + a.brand === RP.csr; })) RP.csr = agents.length ? agents[0].name + '|||' + agents[0].brand : '';
    var names = agents.map(function (a) { return a.name; }).filter(function (n, i, L) { return L.indexOf(n) === i; });
    var row = function (title, sub, ctl, id) { return '<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center;padding:14px 0;border-top:1px solid var(--line2)"><div style="flex:1 1 260px"><b>' + title + '</b><div class="mut" style="font-size:12.5px;margin-top:2px">' + sub + '</div>' + (ctl || '') + '</div>' + rpBtns(id) + '</div>'; };
    var exp = '<div class="oq-card" style="flex:1 1 380px;align-self:flex-start"><h2 class="ttl">Export Calls</h2><p class="sub">A spreadsheet of every matching call — date, brand, CSR, customer, outcome, score, each step and the AI’s notes. Uses the date range and brands at the top.</p>' +
      '<div style="display:flex;flex-direction:column;gap:8px;margin-top:14px" role="radiogroup" aria-label="Which calls">' + RP_SCOPES.map(function (s) { return '<label style="display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid ' + (RP.scope === s[0] ? '#14302A' : 'var(--line2)') + ';border-radius:10px;cursor:pointer"><input type="radio" name="rpscope" data-rpscope="' + s[0] + '"' + (RP.scope === s[0] ? ' checked' : '') + ' style="margin-top:3px;accent-color:#14302A"><span><b style="font-size:13.5px">' + s[1] + '</b><span class="mut" style="display:block;font-size:12px">' + s[2] + '</span></span></label>'; }).join('') + '</div>' +
      '<div style="margin-top:12px"><label class="l" for="rpag">CSR</label><select id="rpag" class="oq-field" data-rpagent><option value="">All CSRs</option>' + names.map(function (n) { return '<option' + (RP.agent === n ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select></div>' +
      '<label style="display:flex;gap:8px;align-items:center;margin-top:12px;font-size:13px"><input type="checkbox" style="accent-color:#14302A" data-rptypes' + (RP.allTypes ? ' checked' : '') + '> Include voicemail, IVR, wrong-number and spam calls</label>' +
      '<label style="display:flex;gap:8px;align-items:center;margin-top:8px;font-size:13px"><input type="checkbox" style="accent-color:#14302A" data-rptrans' + (RP.trans ? ' checked' : '') + '> Include full transcripts <span class="mut" style="font-size:12px">(bigger file, slower)</span></label>' +
      '<button class="sel btnd" data-act="rpexport" style="margin-top:14px;width:100%;justify-content:center"' + (RP.busy ? ' disabled' : '') + '>' + (RP.busy === 'export' ? 'Preparing… ' + RP.n.toLocaleString() + ' calls' : 'Download CSV') + '</button>' +
      '<div class="mut" style="font-size:12px;margin-top:8px">' + esc(rpFilterText()) + '</div></div>';
    var reps = '<div class="oq-card" style="flex:999 1 480px;align-self:flex-start"><h2 class="ttl">Scorecard Reports</h2><p class="sub">Download as PDF, Excel or CSV. ' + esc(rpFilterText()) + '.</p><div style="margin-top:8px">' +
      row(LOCK ? 'Executive summary' : 'Executive summary', 'One page: the headline, booking rate, QA score, controllable misses and upset customers vs the period before, why opportunities didn’t book, the CSRs leading and lagging, and the one thing to coach' + (LOCK ? '' : ', plus every brand side by side') + '.', '', 'exec') +
      (brands.length ? row('Brand one-pager', 'The executive summary for one brand, plus its call flow step by step and what callers wanted.', brands.length > 1 ? '<select class="oq-field" data-rpteam aria-label="Brand" style="margin-top:8px;max-width:280px">' + brands.map(function (b) { return '<option' + (RP.team === b ? ' selected' : '') + '>' + esc(b) + '</option>'; }).join('') + '</select>' : '', 'team') : '') +
      (agents.length ? row('CSR scorecard', 'One CSR’s roll-up: headline numbers, the call flow step by step and what to coach. Excel and CSV also list every call.', '<select class="oq-field" data-rpcsr aria-label="CSR" style="margin-top:8px;max-width:280px">' + agents.map(function (a) { var k = a.name + '|||' + a.brand; return '<option value="' + esc(k) + '"' + (RP.csr === k ? ' selected' : '') + '>' + esc(a.name) + (LOCK ? '' : ' — ' + esc(a.brand)) + '</option>'; }).join('') + '</select>', 'csr') : '') +
      row('Human vs AI receptionists', 'Your CSRs next to the AI receptionists, by brand.', '', 'hai') +
      '<div style="padding:14px 0;border-top:1px solid var(--line2)"><b>Weekly call-flow scorecard</b><div class="mut" style="font-size:12.5px;margin-top:2px">Every CSR on every call-flow step for one week, colour-coded, with the change vs the week before. Pick the Monday the week starts.</div>' +
      '<div class="row" style="gap:8px;margin-top:8px;align-items:center"><label class="sr" for="rpwk">Week starting</label><input id="rpwk" type="date" class="oq-field" style="max-width:170px" value="' + esc(RP.week || lastMon()) + '">' + (brands.length > 1 ? '<select class="oq-field" id="rpwkb" aria-label="Brand" style="max-width:240px"><option value="">Every brand</option>' + brands.map(function (b) { return '<option' + (RP.wkb === b ? ' selected' : '') + '>' + esc(b) + '</option>'; }).join('') + '</select>' : '') + '<button class="sel" data-act="rpweek"' + (RP.busy ? ' disabled' : '') + '>Preview PDF</button></div></div>' +
      '<div class="mut" style="font-size:12.5px;padding-top:14px;border-top:1px solid var(--line2)">Need one call? Open it in Call reviews and choose <b>Print / save PDF</b>.</div></div></div>';
    var bc = null; // billing statement removed from the client portal (Becky, 2026-10-26)
    w.innerHTML = '<div class="row" style="align-items:flex-start">' + exp + reps + '</div>' + (bc ? '<div class="row" style="margin-top:16px">' + bc + '</div>' : '');
  }
  function rpExport() {
    if (RP.busy) return; RP.busy = 'export'; RP.n = 0; drawReporting();
    var tick = function (n) { RP.n = n; var b = document.querySelector('#oqa [data-act="rpexport"]'); if (b) b.textContent = 'Preparing… ' + n.toLocaleString() + ' calls'; };
    rpPull({ scope: RP.scope, agent: RP.agent || null, all_types: RP.allTypes, transcript: RP.trans }, tick).then(function (rows) {
      RP.busy = ''; drawReporting();
      if (!rows.length) { toast('No calls match these filters'); return; }
      var cols = RP.trans ? RP_COLS.concat(['transcript']) : RP_COLS;
      var lines = [cols.join(',')]; rows.forEach(function (r) { lines.push(cols.map(function (k) { var v = r[k]; return csvCell(typeof v === 'boolean' ? yn(v) : v); }).join(',')); });
      var tag = RP.scope === 'notbooked' ? 'not-booked-opportunities' : RP.scope === 'opps' ? 'revenue-opportunities' : 'all-calls';
      saveBlob('opsis-qa-' + tag + (RP.agent ? '-' + RP.agent.toLowerCase().replace(/[^a-z0-9]+/g, '-') : '') + rpTag() + '.csv', new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' }));
      toast('Downloaded ' + rows.length.toLocaleString() + ' calls');
    }).catch(function (e) { RP.busy = ''; drawReporting(); toast(e.message || 'Export failed. Try a shorter date range.'); });
  }
  function lastMon() { var d = new Date(todayET() + 'T12:00:00Z'); var w = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - w - 7); return d.toISOString().slice(0, 10); }
  var OP_CSS = '<style>.kp{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 4px}.kp div{flex:1 1 120px;border:1px solid #E2DDD2;border-radius:10px;padding:8px 10px}.kp b{display:block;font-size:20px;margin-top:2px}.kp span{font-size:10px;color:#6B726E;text-transform:uppercase;letter-spacing:.06em}.kp i{display:block;font-style:normal;font-size:10.5px;color:#6B726E}' +
    '.ai{background:#F3F8F5;border:1px solid #CFE5DF;border-radius:10px;padding:8px 14px;margin:10px 0}.ai p,.ai li{margin:4px 0;line-height:1.45}.two{display:flex;gap:14px}.two>div{flex:1;min-width:0}.up{color:#1F5A41}.dn{color:#B4461F}</style>';
  function opWhy(brand, agent) {
    var q = agent ? 'Give a short coaching summary for ' + agent + ' at ' + brand + ' for this period: 3 bullets on what is driving their numbers (call flow steps, booking, asks on calls that did not book, transfers) with the key figures, then one line starting "Coach:" with the single most useful thing to coach this week.'
      : 'Write the executive summary for ' + brand + ' for this period: 4 short bullets on what is driving the numbers (booking rate, asks on calls that did not book, the call flow steps that moved, which CSRs are pulling the brand up or down, call mix) with the key figures, then one line starting "Focus:" with the one thing leadership should push this week.';
    return api({ action: 'ask', question: q, start: S.start, end: S.end, brands: [brand] }).then(function (r) { return r.answer || ''; }).catch(function () { return ''; });
  }
  // Executive summary / brand one-pager (2026-10-26, Becky): answer first, then the four numbers vs the period before,
  // where the money went, who is pulling up / down, and the one thing to coach. Same layout for one brand or many.
  var EX_CSS = '<style>.hl{background:#14302A;color:#fff;border-radius:12px;padding:14px 18px;margin:10px 0 12px;font-size:14px;line-height:1.5}.hl b{color:#BFE3D2}' +
    '.t4{display:flex;gap:8px;margin:0 0 12px}.t4>div{flex:1;border:1px solid #E2DDD2;border-radius:10px;padding:9px 12px}.t4>div>span{display:block;font-size:9.5px;color:#56605B;text-transform:uppercase;letter-spacing:.07em;font-weight:700}' +
    '.t4 b{display:block;font-size:24px;margin:3px 0 1px;color:#14302A}.t4 i{font-style:normal;font-size:10.5px;color:#6B726E}.up{color:#1F5A41;font-weight:700}.dn{color:#B4461F;font-weight:700}.fl{color:#6B726E}' +
    '.two{display:flex;gap:14px}.two>div{flex:1;min-width:0}h2{font-size:13px;margin:14px 0 6px;color:#14302A}' +
    'table.x{width:100%;border-collapse:collapse}table.x th{background:#14302A;color:#fff;font-size:10px;text-transform:uppercase;letter-spacing:.05em;padding:6px 8px;text-align:center}table.x th:first-child{text-align:left;border-radius:6px 0 0 0}table.x th:last-child{border-radius:0 6px 0 0}' +
    'table.x td{padding:5px 8px;border-top:1px solid #ECE8E0;text-align:center}table.x td:first-child{text-align:left}table.x tr.tot td{background:#EEF4EF;font-weight:700;border-top:2px solid #14302A}' +
    '.pill{display:inline-block;font-size:9.5px;font-weight:700;padding:1px 7px;border-radius:99px}.pc{background:#FBEDE6;color:#A8441A}.pn{background:#EEEBE4;color:#56605B}' +
    '.rec{border-left:4px solid #2F7D5B;background:#F3F8F5;border-radius:0 10px 10px 0;padding:10px 14px;margin:14px 0 4px;font-size:12.5px;line-height:1.5}.note{font-size:10px;color:#8A918D;margin-top:10px}</style>';
  function exStep(l) { return String(l || '').replace(/^Step\s+\w+\s+/, '').split(':')[0]; }
  function exDelta(cur, prev, unit, goodUp, dec) {
    if (cur == null || prev == null) return '<span class="fl">no prior data</span>';
    var d = cur - prev, r = Math.abs(d).toFixed(dec == null ? 1 : dec);
    if (Math.abs(d) < Math.pow(10, -(dec == null ? 1 : dec)) / 2) return '<span class="fl">no change</span>';
    var good = goodUp ? d > 0 : d < 0;
    return '<span class="' + (good ? 'up' : 'dn') + '">' + (d > 0 ? '▲ ' : '▼ ') + r + unit + '</span>';
  }
  function opExec(w, brands, onePager) {
    var one = brands && brands.length === 1 ? brands[0] : null, p = prevWin();
    var cw = { start: S.start, end: S.end, brands: brands }, pw = { start: p.start, end: p.end, brands: brands };
    var cnt = function (b, x) { return api(Object.assign({ action: 'bucketcalls', bucket: 'upset', limit: 1, offset: 0 }, x)).then(function (r) { return r.total || 0; }).catch(function () { return null; }); };
    return Promise.all([
      api(Object.assign({ action: 'report' }, cw)).then(perCall),
      api(Object.assign({ action: 'money' }, cw)).catch(function () { return {}; }),
      api(Object.assign({ action: 'money' }, pw)).catch(function () { return {}; }),
      cnt('upset', cw), cnt('upset', pw),
      api({ action: 'focus', start: S.start, end: S.end, brand: one }).catch(function () { return {}; }),
      onePager ? api(Object.assign({ action: 'qaextras' }, cw)).catch(function () { return {}; }) : Promise.resolve({})
    ]).then(function (r) {
      var rep = r[0] || {}, M = r[1] || {}, MP = r[2] || {}, up = r[3], upP = r[4], F = r[5] || {}, X = r[6] || {};
      var k = rep.kpis || {}, kp = rep.prev || {}, T = M.totals || {}, TP = MP.totals || {}, name = one ? short(one) : (brands && brands.length ? brands.length + ' brands' : 'All brands');
      var days = daysBetween(S.start, S.end), per = 'vs the ' + days + ' days before';
      var br = k.booking_rate, brP = kp.booking_rate, cv = +T.ctrl_value || 0, cn = +T.ctrl_n || 0;
      var whys = (M.by_why || []).slice().sort(function (a, b) { return (a.kind === 'controllable' ? 0 : 1) - (b.kind === 'controllable' ? 0 : 1) || b.n - a.n; });
      var topC = whys.filter(function (x) { return x.kind === 'controllable'; })[0];
      // the step to coach: most points lost (missed × points) among steps that applied to 20+ calls
      var steps = (F.steps || []).filter(function (s) { return s.applies >= 20; }), focus = steps.slice().sort(function (a, b) { return b.missed * b.points - a.missed * a.points; })[0];
      // headline
      var hl = '<b>' + esc(name) + '</b> booked <b>' + p1(br) + '</b> of decided opportunities' + (br != null && brP != null ? ', ' + (Math.abs(br - brP) < 0.05 ? 'flat' : (br > brP ? 'up ' : 'down ') + Math.abs(br - brP).toFixed(1) + ' pts') + ' ' + per : '') + '.' +
        (cn ? ' <b>' + fmt(cn) + ' controllable misses</b>' + (cv ? ' left about <b>' + usd(cv) + '</b> on the table' : ' could have been saved') + (topC ? ', most often “' + esc(topC.why) + '” (' + fmt(topC.n) + ')' : '') + '.' : ' No controllable misses.') +
        (focus ? ' Coaching focus: <b>' + esc(exStep(focus.label)) + '</b>, done on ' + focus.rate + '% of calls.' : '');
      var tile = function (l, v, d, s) { return '<div><span>' + l + '</span><b>' + v + '</b><i>' + d + (s ? ' · ' + s : '') + '</i></div>'; };
      var tiles = '<div class="t4">' +
        tile('Booking rate', p1(br), exDelta(br, brP, ' pts', true), fmt(k.booked_calls || 0) + ' of ' + fmt(k.decided_calls || 0)) +
        tile('Avg QA score', k.avg != null ? (+k.avg).toFixed(1) : '—', exDelta(k.avg, kp.avg, '', true), 'out of 100') +
        tile('Controllable misses', fmt(cn), exDelta(cn, TP.ctrl_n != null ? +TP.ctrl_n : null, '', false, 0), cv ? usd(cv) : '') +
        tile('Upset customers', up == null ? '—' : fmt(up), exDelta(up, upP, '', false, 0), '') + '</div>';
      // where the money went
      var nb = whys.reduce(function (t, x) { return t + (+x.n || 0); }, 0);
      var money = '<h2>Why opportunities didn’t book</h2><table class="x"><thead><tr><th>Reason</th><th>Type</th><th>Calls</th><th>Share</th><th>Value</th></tr></thead><tbody>' +
        (whys.length ? whys.slice(0, 6).map(function (x) { return '<tr><td>' + esc(x.why) + '</td><td><span class="pill ' + (x.kind === 'controllable' ? 'pc">Controllable' : 'pn">Not controllable') + '</span></td><td>' + fmt(x.n) + '</td><td>' + pctTxt(x.n, nb) + '</td><td>' + (+x.value ? usd(x.value) : '—') + '</td></tr>'; }).join('') +
          '<tr class="tot"><td>Total not booked</td><td></td><td>' + fmt(nb) + '</td><td>100%</td><td>' + (cv + (+T.nc_value || 0) ? usd(cv + (+T.nc_value || 0)) : '—') + '</td></tr>' : '<tr><td colspan="5">No unbooked opportunities in this range.</td></tr>') + '</tbody></table>';
      // CSRs: top and bottom 3 by booking rate (10+ decided), with the step each misses most
      var AIS = ['Dane', 'Sophia', 'Jason'];
      var csrs = (rep.agents || []).filter(function (a) { return a.decided >= 10 && AIS.indexOf(a.name) < 0; }).map(function (a) { return { name: a.name, brand: a.brand, rate: 100 * a.booked / a.decided, dec: a.decided, avg: a.avg }; }).sort(function (a, b) { return b.rate - a.rate; });
      var top3 = csrs.slice(0, 3), bot3 = csrs.slice(Math.max(3, csrs.length - 3)).reverse();
      if (!one) { top3 = []; bot3 = []; } // leadership view: brands only; CSR detail lives on the brand reports (Becky, 2026-10-27)
      var pick = top3.concat(bot3);
      return Promise.all(pick.map(function (a) { return api({ action: 'focus', start: S.start, end: S.end, brand: a.brand, agent: a.name }).then(function (f2) { var s2 = (f2.steps || []).filter(function (s) { return s.applies >= 3 && s.missed > 0; }).sort(function (x, y) { return y.missed * y.points - x.missed * x.points; })[0]; a.miss = s2 ? exStep(s2.label) + ' (' + s2.rate + '%)' : '—'; }).catch(function () { a.miss = '—'; }); })).then(function () {
        var ct = function (title, L) { return '<h2>' + title + '</h2><table class="x"><thead><tr><th>CSR</th><th>Booking rate</th><th>Avg QA</th><th>Most-missed step</th></tr></thead><tbody>' + (L.length ? L.map(function (a) { return '<tr><td><b>' + esc(a.name) + '</b>' + (one ? '' : '<br><span class="fl">' + esc(short(a.brand)) + '</span>') + '</td><td>' + Math.round(a.rate) + '% <span class="fl">(' + a.dec + ')</span></td><td>' + (a.avg != null ? (+a.avg).toFixed(1) : '—') + '</td><td>' + esc(a.miss) + '</td></tr>'; }).join('') : '<tr><td colspan="4">Not enough calls yet (10+ decided opportunities).</td></tr>') + '</tbody></table>'; };
        var csrT = one ? '<div class="two"><div>' + ct('Leading the way', top3) + '</div><div>' + ct('Needs the most help', bot3) + '</div></div>' : '';
        var rec = focus ? '<div class="rec"><b>Next week, coach ' + esc(exStep(focus.label)) + '.</b> It was done on ' + focus.rate + '% of the calls it applied to' + (focus.prev_rate != null ? ' (' + focus.prev_rate + '% the period before)' : '') + ' and missed on ' + fmt(focus.missed) + ' calls, the most points lost of any step.' + (function () { var t = String(focus.label || '').split(':').slice(1).join(':').trim(); return t ? ' What good looks like: ' + esc(t.charAt(0).toUpperCase() + t.slice(1)) + '.' : ''; })() + '</div>' : '';
        // by brand (only when more than one brand)
        var bt = '';
        var BR = (rep.brands || []).filter(function (b) { return b.calls; });
        if (!one && BR.length > 1) {
          var mb = {}; (M.by_brand || []).forEach(function (b) { mb[b.brand] = b; });
          var rows = BR.map(function (b) { var dc = b.decided_calls != null ? b.decided_calls : b.decided, bc = b.booked_calls != null ? b.booked_calls : b.booked; return { b: b.brand, calls: b.calls, avg: b.avg, rate: dc ? 100 * bc / dc : null, ctrl: (mb[b.brand] || {}).ctrl_n || 0, val: +(mb[b.brand] || {}).ctrl_value || 0 }; }).sort(function (a, b) { return (b.rate || -1) - (a.rate || -1); });
          bt = '<h2>By Brand</h2><table class="x"><thead><tr><th>Brand</th><th>Calls</th><th>Avg QA</th><th>Booking rate</th><th>Controllable misses</th><th>Value</th></tr></thead><tbody>' +
            rows.map(function (x) { return '<tr><td><b>' + esc(short(x.b)) + '</b></td><td>' + fmt(x.calls) + '</td><td>' + (x.avg != null ? (+x.avg).toFixed(1) : '—') + '</td><td>' + (x.rate != null ? x.rate.toFixed(1) + '%' : '—') + '</td><td>' + fmt(x.ctrl) + '</td><td>' + (x.val ? usd(x.val) : '—') + '</td></tr>'; }).join('') +
            '<tr class="tot"><td>All brands</td><td>' + fmt(rows.reduce(function (t, x) { return t + x.calls; }, 0)) + '</td><td>' + (k.avg != null ? (+k.avg).toFixed(1) : '—') + '</td><td>' + p1(br) + '</td><td>' + fmt(cn) + '</td><td>' + (cv ? usd(cv) : '—') + '</td></tr></tbody></table>';
        }
        // brand one-pager extras: the call flow and what callers wanted
        var extra = '';
        if (onePager) {
          var stT = '<h2>Call flow, step by step</h2><table class="x"><thead><tr><th>Step</th><th>Done</th><th>Change</th></tr></thead><tbody>' + steps.map(function (s) { return '<tr><td>' + esc(exStep(s.label)) + '</td><td><b>' + s.rate + '%</b></td><td>' + exDelta(s.rate, s.prev_rate, ' pts', true, 0) + '</td></tr>'; }).join('') + '</tbody></table>';
          var cats = (X.categories || []).filter(function (c) { return c.k !== 'Internal / staff call' && c.k !== 'No conversation'; }), tot = cats.reduce(function (t, c) { return t + c.n; }, 0);
          var caT = '<h2>What callers wanted</h2><table class="x"><thead><tr><th>Call type</th><th>Calls</th><th>Share</th></tr></thead><tbody>' + cats.slice(0, 8).map(function (c) { return '<tr><td>' + esc(c.k) + '</td><td>' + fmt(c.n) + '</td><td>' + pctTxt(c.n, tot) + '</td></tr>'; }).join('') + '</tbody></table>';
          extra = '<div class="two"><div>' + stT + '</div><div>' + caT + '</div></div>';
        }
        var title = onePager ? name + ' — Brand One-Pager' : (one ? name + ' — Executive Summary' : 'Executive Summary');
        pdfShell(w, title, (S.range === 'custom' ? rangeLabel() : rangeLabel() + ' (' + fdate(S.start) + ' – ' + fdate(S.end) + ')') + ' · ' + (one || (brands && brands.length ? brands.map(short).join(', ') : 'All brands')),
          EX_CSS + '<div class="hl">' + hl + '</div>' + tiles + bt + money + csrT + rec + extra +
          '<p class="note">Changes compare with the ' + days + ' days before (' + fdate(p.start) + ' – ' + fdate(p.end) + '). Booking rate = booked ÷ opportunities that reached a decision. Controllable miss = an opportunity the CSR could have saved. Dollar values use invoices where uploaded, otherwise each brand’s average ticket.</p>');
      });
    });
  }
  function opOnePager(w, brand) {
    var bw = { start: S.start, end: S.end, brands: [brand] };
    return Promise.all([api(Object.assign({ action: 'report' }, bw)).then(perCall), api({ action: 'focus', start: S.start, end: S.end, brand: brand }), api(Object.assign({ action: 'qaextras' }, bw)).catch(function () { return {}; }), api(Object.assign({ action: 'money' }, bw)).catch(function () { return {}; }), opWhy(brand)]).then(function (r) {
      var rep = r[0] || {}, f = r[1] || {}, X = r[2] || {}, M = (r[3] || {}).totals || {}, why = r[4], k = rep.kpis || {}, B = X.base || {};
      var an = askNb((X.asknb || {}).by_brand, brand), fc = ((X.fcr || {}).overall) || {}, so = ((X.sentiment || {}).overall) || {}, vn = (+M.booked || 0) - (+M.booked_unvalued || 0);
      var kp = function (l, v, i) { return '<div><span>' + l + '</span><b>' + v + '</b>' + (i ? '<i>' + i + '</i>' : '') + '</div>'; };
      var tiles = '<div class="kp">' + kp('Inbound calls handled', fmt((rep.funnel || {}).conversations || 0), fmt((rep.funnel || {}).calls || 0) + ' calls in all') + kp('Avg QA score', k.avg != null ? k.avg.toFixed(1) : '—', 'call flow, 0–100') + kp('Booking rate', p1(k.booking_rate), fmt(k.booked || 0) + ' of ' + fmt(k.decided || 0) + ' customers') +
        kp('Ask rate · not booked', an ? an.pct.toFixed(0) + '%' : '—', an ? an.asked + ' of ' + an.nb + ' not booked' : '') + kp('First contact resolution', fc.contacts ? Math.round(100 * fc.fcr / fc.contacts) + '%' : '—', fc.contacts ? fmt(fc.contacts) + ' contacts' : '') + kp('Customer sentiment', so.n ? (+so.avg).toFixed(1) + ' / 5' : '—', so.n ? Math.round(100 * so.neg / so.n) + '% left upset' : '') + kp('Avg order value', vn > 0 && +M.booked_value ? '$' + Math.round(M.booked_value / vn).toLocaleString() : '—', vn > 0 ? vn + ' booked jobs' : '') + '</div>';
      var ag = agentRows(rep, null, 1).filter(function (a) { return a.brand === brand || !a.brand; }).sort(function (a, b) { return b.calls - a.calls; });
      var foc = {}; (rep.agents || []).forEach(function (a) { foc[a.name] = a.focus || a.top_miss || ''; });
      var csrT = '<h2>Roll-up by CSR</h2><table><thead><tr><th>CSR</th><th>Inbound calls</th><th>Avg QA</th><th>Booking rate</th><th>Ask rate · not booked</th><th>Transferred out</th></tr></thead><tbody>' +
        ag.map(function (a) { var x = askNb((X.asknb || {}).by_agent, brand, a.name); return '<tr><td><b>' + esc(a.name) + '</b></td><td>' + fmt(a.calls) + '</td><td>' + (a.avg != null ? a.avg.toFixed(1) : '—') + '</td><td>' + (a.rate != null ? Math.round(a.rate) + '%' : '—') + '</td><td>' + (x ? Math.round(x.pct) + '% <span style="color:#8A918D">(' + x.nb + ')</span>' : '—') + '</td><td>' + (a.calls ? Math.round(100 * a.xo / a.calls) + '%' : '—') + '</td></tr>'; }).join('') + '</tbody></table>';
      var stepT = '<h2>Call flow, step by step</h2><table><thead><tr><th>Step</th><th>Done</th><th>vs before</th><th>Missed on</th></tr></thead><tbody>' + (f.steps || []).map(function (st) { var d = st.prev_rate == null ? null : st.rate - st.prev_rate; return '<tr><td>' + esc(String(st.label || st.key).split(':')[0]) + '</td><td><b>' + (st.rate != null ? st.rate + '%' : '—') + '</b></td><td class="' + (d == null ? '' : d >= 0 ? 'up' : 'dn') + '">' + (d == null ? 'new' : (d >= 0 ? '▲' : '▼') + Math.abs(d) + ' pts') + '</td><td>' + fmt(st.missed || 0) + ' calls</td></tr>'; }).join('') + '</tbody></table>';
      var cats = (X.categories || []).filter(function (c) { return c.k !== 'Internal / staff call' && c.k !== 'No conversation'; }), ct = cats.reduce(function (t, c) { return t + c.n; }, 0);
      var catT = '<h2>What callers wanted</h2><table><tbody>' + cats.slice(0, 8).map(function (c) { return '<tr><td>' + esc(c.k) + '</td><td style="text-align:right"><b>' + pctTxt(c.n, ct) + '</b> <span style="color:#8A918D">' + fmt(c.n) + '</span></td></tr>'; }).join('') + '</tbody></table>';
      var nb = B.not_booked || 0, rs = (rep.reasons || []).filter(function (x) { return !/^(other|unspecified)$/i.test(x.k); });
      var whyT = '<h2>Why calls didn’t book</h2><table><tbody>' + rs.slice(0, 6).map(function (x) { return '<tr><td>' + esc(x.k) + '</td><td style="text-align:right"><b>' + pctTxt(x.n, nb) + '</b> <span style="color:#8A918D">' + fmt(x.n) + '</span></td></tr>'; }).join('') + '</tbody></table>';
      pdfShell(w, short(brand) + ' — executive scorecard', rangeLabel() + ' · ' + brand, OP_CSS + tiles + (why ? '<div class="ai"><b>AI insights</b>' + md(why) + '</div>' : '') + csrT + '<div class="two"><div>' + stepT + '</div><div>' + catT + whyT + '</div></div>');
    });
  }
  // CSR scorecard (redesigned 2026-10-27, Becky): colourful, one page, built to grab a CSR's attention in a 1:1.
  function opCsr(w, name, brand) {
    return Promise.all([api({ action: 'report', start: S.start, end: S.end, brands: [brand], agent: name }).then(perCall), api({ action: 'focus', start: S.start, end: S.end, brand: brand, agent: name }), api(Object.assign({ action: 'qaextras' }, { start: S.start, end: S.end, brands: [brand] })).catch(function () { return {}; }), opWhy(brand, name),
      api({ action: 'calls', start: S.start, end: S.end, brands: [brand], agent: name, score_max: 60, limit: 2 }).catch(function () { return { rows: [] }; }),
      api({ action: 'calls', start: S.start, end: S.end, brands: [brand], agent: name, score_min: 90, outcome: 'Booked', limit: 1 }).catch(function () { return { rows: [] }; })]).then(function (r) {
      var rep = r[0] || {}, f = r[1] || {}, X = r[2] || {}, why = r[3], low = (r[4] || {}).rows || [], best = ((r[5] || {}).rows || [])[0], k = rep.kpis || {}, kp = rep.prev || {}, x = askNb((X.asknb || {}).by_agent, brand, name);
      var ini = String(name || '?').split(/\s+/).map(function (p) { return p.charAt(0); }).join('').slice(0, 2).toUpperCase();
      var lvl = function (v) { return v == null ? '#B5B9B6' : v >= 80 ? '#2F7D5B' : v >= 60 ? '#D9A520' : '#C2562A'; };
      var css = '<style>@page{size:letter;margin:9mm}body{font-size:11px}h1,.sub,.foot{display:none}' +
        '.cb{background:linear-gradient(120deg,#14302A 0%,#2F7D5B 100%);color:#fff;border-radius:14px;padding:14px 18px;display:flex;align-items:center;gap:14px}.av{width:46px;height:46px;border-radius:50%;background:#D9A520;color:#14302A;font-weight:800;font-size:17px;display:flex;align-items:center;justify-content:center;flex:none}' +
        '.cb .n{font-size:20px;font-weight:800;letter-spacing:-.01em}.cb .m{font-size:11px;color:#CFE5DF;margin-top:2px}.cb .sc{margin-left:auto;text-align:right}.cb .sc b{display:block;font-size:30px;line-height:1}.cb .sc span{font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:#CFE5DF}' +
        '.tl{display:flex;gap:8px;margin:10px 0}.tl>div{flex:1;border-radius:12px;padding:9px 12px;color:#14302A}.tl>div>span{display:block;font-size:9px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;opacity:.75}.tl b{display:block;font-size:22px;margin:2px 0}.tl i{font-style:normal;font-size:10px;font-weight:700}' +
        '.c1{background:#E3F1E8}.c2{background:#E6ECF8}.c3{background:#FDF1D8}.c4{background:#F6E6F1}.up{color:#1F5A41}.dn{color:#B4461F}.fl{color:#6B726E;font-weight:600}' +
        '.sec{font-size:12.5px;font-weight:800;color:#14302A;margin:12px 0 6px;display:flex;align-items:center;gap:6px}.sec:before{content:"";width:4px;height:14px;border-radius:2px;background:#2F7D5B}' +
        '.st{display:grid;grid-template-columns:150px 1fr 46px 58px;gap:4px 10px;align-items:center;font-size:11px}.bar{height:11px;background:#F1EEE8;border-radius:6px;overflow:hidden}.bar div{height:100%;border-radius:6px}.st b{text-align:right}.st i{font-style:normal;font-size:10px;font-weight:700;text-align:right}' +
        '.two{display:flex;gap:10px}.two>div{flex:1;border-radius:12px;padding:10px 12px;font-size:11px;line-height:1.45}.win{background:#E3F1E8;border:1px solid #BFDCCB}.grow{background:#FFF1E6;border:1px solid #F3CDAE}.two h3{margin:0 0 4px;font-size:11.5px}' +
        '.ai{background:#F3F8F5;border-left:4px solid #2F7D5B;border-radius:0 10px 10px 0;padding:8px 12px;margin:10px 0;font-size:11px;line-height:1.45}.ai p,.ai li{margin:2px 0}.ai ul{margin:2px 0 2px 16px;padding:0}' +
        '.cl{display:flex;gap:8px}.cl>div{flex:1;border:1px solid #E8E4DC;border-radius:10px;padding:8px 10px;font-size:10.5px;line-height:1.4}.cl b.s{display:inline-block;color:#fff;border-radius:99px;padding:1px 8px;font-size:10px;margin-right:6px}</style>';
      var dl = function (a, b, u, dec) { if (a == null || b == null) return '<span class="fl">first period</span>'; var d = a - b; if (Math.abs(d) < 0.05) return '<span class="fl">no change</span>'; return '<span class="' + (d > 0 ? 'up' : 'dn') + '">' + (d > 0 ? '▲ ' : '▼ ') + Math.abs(d).toFixed(dec == null ? 1 : dec) + u + ' vs before</span>'; };
      var head = '<div class="cb"><div class="av">' + esc(ini) + '</div><div><div class="n">' + esc(name) + '</div><div class="m">' + esc(short(brand)) + ' · ' + esc(rangeLabel()) + (S.range === 'custom' ? '' : ' (' + fdate(S.start) + ' – ' + fdate(S.end) + ')') + '</div></div><div class="sc"><span>Avg QA score</span><b>' + (k.avg != null ? (+k.avg).toFixed(1) : '—') + '</b><span style="text-transform:none;letter-spacing:0;font-weight:700">' + dl(k.avg, kp.avg, '').replace(/class="(up|dn|fl)"/, 'style="color:#fff"') + '</span></div></div>';
      var tiles = '<div class="tl">' +
        '<div class="c1"><span>Calls handled</span><b>' + fmt((rep.funnel || {}).conversations || 0) + '</b><i class="fl">customer conversations</i></div>' +
        '<div class="c2"><span>Booked</span><b>' + fmt(k.booked_calls || 0) + '</b><i class="fl">of ' + fmt(k.decided_calls || 0) + ' decided opportunities</i></div>' +
        '<div class="c3"><span>Booking rate</span><b>' + p1(k.booking_rate) + '</b><i>' + dl(k.booking_rate, kp.booking_rate, ' pts') + '</i></div>' +
        '<div class="c4"><span>Asked when it didn’t book</span><b>' + (x ? Math.round(x.pct) + '%' : '—') + '</b><i class="fl">' + (x ? x.asked + ' of ' + x.nb + ' calls' : '') + '</i></div></div>';
      var steps = (f.steps || []).filter(function (s) { return s.applies > 0; });
      var stepT = '<div class="sec">Your call flow</div><div class="st">' + steps.map(function (s) { var d = s.prev_rate == null || s.applies < 5 ? null : s.rate - s.prev_rate; return '<span>' + esc(exStep(s.label)) + '</span><div class="bar"><div style="width:' + (s.rate || 0) + '%;background:' + lvl(s.rate) + '"></div></div><b>' + (s.rate != null ? s.rate + '%' : '—') + '</b><i class="' + (d == null ? 'fl' : d >= 0 ? 'up' : 'dn') + '">' + (d == null ? s.applies + ' calls' : (d > 0 ? '▲' : d < 0 ? '▼' : '±') + Math.abs(d)) + '</i>'; }).join('') + '</div>';
      var solid = steps.filter(function (s) { return s.applies >= 5; }), wins = solid.slice().sort(function (a, b) { return b.rate - a.rate; }).slice(0, 2), grow = solid.slice().sort(function (a, b) { return b.missed * b.points - a.missed * a.points; })[0];
      var ww = '<div class="two"><div class="win"><h3>⭐ Doing great</h3>' + (wins.length ? wins.map(function (s) { return '<div><b>' + esc(exStep(s.label)) + '</b>: ' + s.rate + '% of calls</div>'; }).join('') : 'Shows once more calls are scored.') + '</div>' +
        '<div class="grow"><h3>🎯 Focus for next week</h3>' + (grow ? '<b>' + esc(exStep(grow.label)) + '</b> (' + grow.rate + '% now). ' + esc((function (t) { return t ? t.charAt(0).toUpperCase() + t.slice(1) + '.' : ''; })(String(grow.label || '').split(':').slice(1).join(':').trim())) : 'Keep it up.') + '</div></div>';
      var trim = function (t, n) { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n).replace(/\s+\S*$/, '') + '…' : t; };
      var calls = (best ? [best] : []).concat(low).slice(0, 3);
      var callT = calls.length ? '<div class="sec">Calls to listen to together</div><div class="cl">' + calls.map(function (c) { var sc = c.score != null ? +c.score : null; return '<div><b class="s" style="background:' + lvl(sc) + '">' + (sc != null ? sc : '—') + '</b><b>' + esc(fdate(c.date || c.call_date || '')) + '</b> · ' + esc(c.outcome || '') + (c === best ? ' · <b style="color:#1F5A41">great example</b>' : '') + '<div style="margin-top:4px">' + esc(trim(c.summary, 150)) + '</div></div>'; }).join('') + '</div>' : '';
      var ai = why ? '<div class="ai"><b>Coach’s notes</b>' + md(String(why).length > 750 ? String(why).slice(0, 750).replace(/\s+\S*$/, '') + '…' : String(why)) + '</div>' : '';
      pdfShell(w, name + ' — CSR scorecard', rangeLabel() + ' · ' + brand, css + head + tiles + stepT + ww + ai + callT +
        '<div style="display:flex;justify-content:space-between;font-size:9px;color:#8A918D;margin-top:10px;border-top:1px solid #E8E4DC;padding-top:5px"><span>Bars: green 80%+ · amber 60–79% · orange under 60%. % = calls where you did the step, out of the calls where it applied.</span><span>Opsis QA · Opsis CX</span></div>');
    });
  }
  // Weekly call-flow scorecard (rebuilt 2026-10-26): every step, every CSR, this week vs the week before, as a colour-coded grid.
  function opWeek(w, week, brand) {
    return api({ action: 'qaextras', view: 'week', week: week, brand: brand || null }).then(function (R0) {
      var steps = R0.steps || [], BR = (R0.brands || []).filter(function (b) { return b.calls; });
      var SHORT = { introduce: 'Introduce', listen: 'Listen', collect_info: 'Collect info', sell_offer: 'Offer the booking', sell_ask: 'Ask for the booking', sell_card: 'Card on file', sell_objection: 'Handle objection', sell_expert: 'Tech is the expert', confirm_thank: 'Confirm & thank' };
      var nm = function (st) { return SHORT[st.key] || exStep(st.label); };
      var pc = function (o) { return o && o.n ? Math.round(100 * o.y / o.n) : null; }, ppc = function (o) { return o && o.pn >= 10 ? Math.round(100 * o.py / o.pn) : null; };
      var col = function (v) { return v == null ? '' : v >= 80 ? 'g' : v >= 60 ? 'a' : 'r'; };
      var cell = function (o) {
        if (!o || !o.n) return '<td class="na">—</td>';
        var v = pc(o), pv = ppc(o), d = pv == null ? null : v - pv, thin = o.n < 3;
        return '<td class="' + (thin ? 'thin' : col(v)) + '"><b>' + v + '%</b>' + (d == null || thin ? '' : '<i class="' + (d >= 0 ? 'up' : 'dn') + '">' + (d === 0 ? '±0' : (d > 0 ? '▲' : '▼') + Math.abs(d)) + '</i>') + '<s>' + o.y + '/' + o.n + '</s></td>';
      };
      var avgD = function (a, p) { return a == null || p == null ? '' : '<i class="' + (a - p >= 0 ? 'up' : 'dn') + '">' + (a - p >= 0 ? '▲' : '▼') + Math.abs(a - p).toFixed(1) + '</i>'; };
      var css = '<style>@page{size:landscape;margin:10mm}.bh{background:#14302A;color:#fff;border-radius:10px;padding:9px 14px;margin:16px 0 6px;display:flex;justify-content:space-between;align-items:baseline;gap:10px;page-break-after:avoid}.bh b{font-size:14px}.bh span{font-size:11px;color:#CFE5DF}' +
        'table.g{width:100%;table-layout:fixed;border-collapse:separate;border-spacing:3px;font-size:11px;page-break-inside:auto}table.g th:nth-child(1){width:13%}table.g th:nth-child(2),table.g th:nth-child(3){width:5.5%}table.g th{background:#EEF4EF;color:#14302A;font-size:9.5px;text-transform:uppercase;letter-spacing:.04em;padding:6px 4px;border-radius:5px;text-align:center}table.g th:first-child{text-align:left}' +
        'table.g td{padding:5px 4px;border-radius:5px;text-align:center;border:none;line-height:1.15}table.g td:first-child{text-align:left;font-weight:600}table.g td b{font-size:12px}table.g td i{display:block;font-style:normal;font-size:9.5px;font-weight:700}table.g td s{display:block;text-decoration:none;font-size:8.5px;color:#6B726E}' +
        'td.g{background:#E3F1E8}td.a{background:#FDF1D8}td.r{background:#FBE1D8}td.thin{background:#F5F3EE;color:#8A918D}td.na{color:#B5B9B6}.up{color:#1F5A41}.dn{color:#B4461F}tr.tot td{background:#14302A!important;color:#fff}tr.tot td s,tr.tot td i{color:#CFE5DF}' +
        '.lg{display:flex;gap:14px;font-size:10px;color:#56605B;margin:10px 0 0;flex-wrap:wrap}.lg span{display:inline-flex;align-items:center;gap:5px}.lg em{display:inline-block;width:12px;height:12px;border-radius:3px}</style>';
      var head = '<tr><th>CSR</th><th>Calls</th><th>Avg QA</th>' + steps.map(function (st) { return '<th>' + esc(nm(st)) + '<br><span style="font-weight:400;text-transform:none">' + st.points + ' pts</span></th>'; }).join('') + '</tr>';
      var body = BR.map(function (B0) {
        var weak = steps.map(function (st) { return { st: st, v: pc((B0.steps || {})[st.key]), n: ((B0.steps || {})[st.key] || {}).n || 0 }; }).filter(function (x) { return x.v != null && x.n >= 10; }).sort(function (a, b) { return a.v - b.v; })[0];
        var hl = fmt(B0.calls) + ' calls · Avg QA ' + (B0.avg != null ? (+B0.avg).toFixed(1) : '—') + (B0.pavg != null && B0.avg != null ? ' (' + (B0.avg - B0.pavg >= 0 ? '▲' : '▼') + Math.abs(B0.avg - B0.pavg).toFixed(1) + ')' : '') + (weak ? ' · Weakest step: ' + esc(nm(weak.st)) + ' ' + weak.v + '%' : '');
        return '<div class="bh"><b>' + esc(short(B0.brand)) + '</b><span>' + hl + '</span></div><table class="g"><thead>' + head + '</thead><tbody>' +
          (B0.csrs || []).map(function (c) { return '<tr><td>' + esc(c.agent) + '</td><td>' + c.calls + '</td><td><b>' + (c.avg != null ? (+c.avg).toFixed(1) : '—') + '</b>' + avgD(c.avg, c.pcalls >= 10 ? c.pavg : null) + '</td>' + steps.map(function (st) { return cell((c.steps || {})[st.key]); }).join('') + '</tr>'; }).join('') +
          '<tr class="tot"><td>' + esc(short(B0.brand)) + ' total</td><td>' + fmt(B0.calls) + '</td><td><b>' + (B0.avg != null ? (+B0.avg).toFixed(1) : '—') + '</b>' + avgD(B0.avg, B0.pavg) + '</td>' + steps.map(function (st) { var o = (B0.steps || {})[st.key]; return o && o.n ? '<td><b>' + pc(o) + '%</b>' + (ppc(o) == null ? '' : '<i>' + (pc(o) - ppc(o) >= 0 ? '▲' : '▼') + Math.abs(pc(o) - ppc(o)) + '</i>') + '<s>' + o.y + '/' + o.n + '</s></td>' : '<td>—</td>'; }).join('') + '</tr></tbody></table>';
      }).join('') || '<p>No scored calls that week.</p>';
      pdfShell(w, 'Weekly Call-Flow Scorecard', 'Week of ' + fdate(R0.week_start) + ' – ' + fdate(R0.week_end) + ' · compared with ' + fdate(R0.prev_start) + ' – ' + fdate(R0.prev_end) + (brand ? ' · ' + short(brand) : ''),
        css + '<p style="font-size:11px;color:#56605B;margin:4px 0 0">Each cell is the share of that CSR’s calls where they did the step, out of the calls where the step applied (done / applied). ▲/▼ is the change in points vs the week before, shown once the week before had 10 or more of those calls. CSRs are sorted by average QA score.</p>' + body +
        '<div class="lg"><span><em style="background:#E3F1E8"></em>80% or more</span><span><em style="background:#FDF1D8"></em>60–79%</span><span><em style="background:#FBE1D8"></em>Under 60%</span><span><em style="background:#F5F3EE"></em>Fewer than 3 calls (too few to judge)</span><span>— step didn’t apply</span></div>');
    });
  }
  function rpDownload(id, fmt) {
    var sc = RP.sc; if (!sc || RP.busy) return;
    var title = id === 'exec' ? (LOCK ? LOCK + ' — Brand scorecard' : 'Executive scorecard') : id === 'team' ? RP.team + ' — Brand one-pager' : id === 'csr' ? RP.csr.split('|||')[0] + ' — CSR scorecard' : 'Human vs AI receptionists';
    var file = 'opsis-qa-' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + S.start + '-to-' + S.end, sub = rpFilterText();
    var w = fmt === 'pdf' ? pdfWin() : null; if (fmt === 'pdf' && !w) return;
    var go = function (sheets) { if (fmt === 'pdf') sheetsPdf(w, title, sub, sheets); else if (fmt === 'csv') sheetsCsv(file, sheets); else return sheetsXlsx(file, sheets); };
    var fail = function (e) { if (w) try { w.close(); } catch (x) {} RP.busy = ''; drawReporting(); toast(e.message || 'Couldn’t build that report.'); };
    if (fmt === 'pdf' && (id === 'team' || id === 'csr' || id === 'exec')) {
      RP.busy = id; drawReporting();
      var pq = id === 'exec' ? opExec(w, S.brands.length ? S.brands : (LOCK ? [LOCK] : null), false) : id === 'team' ? opExec(w, [RP.team], true) : opCsr(w, RP.csr.split('|||')[0], RP.csr.split('|||')[1]);
      pq.then(function () { RP.busy = ''; drawReporting(); }).catch(fail);
      return;
    }
    if (id === 'csr') {
      var p = RP.csr.split('|||'); RP.busy = 'csr'; drawReporting();
      rpPull({ scope: 'all', agent: p[0], brands: [p[1]] }).then(function (rows) { RP.busy = ''; drawReporting(); return go(bCsr(sc, RP.csr, rows)); }).catch(fail);
      return;
    }
    var sheets = id === 'exec' ? bExec(sc) : id === 'team' ? bTeam(sc, RP.team) : bHai(sc);
    try { var pr = go(sheets); if (pr && pr.catch) { RP.busy = 'x'; drawReporting(); pr.then(function () { RP.busy = ''; drawReporting(); }).catch(fail); } } catch (e) { fail(e); }
  }


  // ---------- Revenue: controllable vs not, job values (estimate -> actual), why calls were excused ----------
  var MN = { d: null, ex: null, jv: null, key: '', bucket: null, edit: null, busy: false, jvb: '' };
  var usd = function (v) { return v == null ? '—' : '$' + Math.round(+v).toLocaleString(); };
  var n0 = function (v) { return (+v || 0).toLocaleString(); };
  var pc = function (v) { return v == null ? '—' : (+v).toFixed(1) + '%'; };
  function vMoney(tok) {
    setMain(crumb([['Revenue']]) + '<div id="mnwrap"><div class="oq-card">' + skel(36, 6) + '</div></div>');
    var key = S.start + '|' + S.end + '|' + S.brands.join(',');
    if (MN.d && MN.key === key) { drawMoney(); return; }
    var w = { start: S.start, end: S.end, brands: S.brands.length ? S.brands : null };
    Promise.all([api(Object.assign({ action: 'money' }, w)), api(Object.assign({ action: 'excused' }, w)), api({ action: 'jobvalues' })]).then(function (r) {
      if (tok !== T) return; MN.d = r[0] || {}; MN.ex = r[1] || {}; MN.jv = r[2] || {}; MN.key = key; drawMoney();
    }).catch(function (e) { if (tok === T && $('mnwrap')) $('mnwrap').innerHTML = errBox(e); });
  }
  function mnTile(label, big, sub, color, tip) {
    return '<div class="oq-card" style="flex:1 1 210px;padding:18px" title="' + esc(tip || '') + '"><div class="cap">' + label + '</div><div class="num" style="font-size:28px;font-weight:600;letter-spacing:-0.02em;margin-top:6px;color:' + (color || 'inherit') + '">' + big + '</div><div class="mut" style="font-size:12.5px;margin-top:4px">' + sub + '</div></div>';
  }
  function drawMoney() {
    var w = $('mnwrap'); if (!w || !MN.d) return; var d = MN.d, t = d.totals || {}, ex = MN.ex || {};
    var rate = t.decided ? 100 * t.booked / t.decided : null;
    var tiles = '<div class="row">' +
      mnTile('Controllable misses', +t.ctrl_value ? usd(t.ctrl_value) : n0(t.ctrl_n) + ' calls', n0(t.ctrl_n) + ' calls the CSR could have saved' + (t.ctrl_unvalued ? ' · ' + (t.ctrl_unvalued === t.ctrl_n ? 'add job values below to see dollars' : n0(t.ctrl_unvalued) + ' with no job value yet') : ''), '#A8441A', 'Unbooked revenue opportunities where the CSR didn’t ask for the booking or had a knowledge gap.') +
      mnTile('Not controllable', +t.nc_value ? usd(t.nc_value) : n0(t.nc_n) + ' calls', n0(t.nc_n) + ' calls · customer said no after being asked, or another team owns the follow-up', '#56605B') +
      (function () { var vn = (+t.booked || 0) - (+t.booked_unvalued || 0); return mnTile('Avg order value (AOV)', vn > 0 && +t.booked_value ? usd(t.booked_value / vn) : '—', vn > 0 ? 'Booked $ ÷ ' + n0(vn) + ' of ' + n0(t.booked) + ' bookings that have a job value' + (+t.booked_unvalued ? ' (' + n0(t.booked_unvalued) + ' have no value for their brand and job type yet)' : '') + ' · ' + (+t.booked_actual_n ? n0(t.booked_actual_n) + ' from invoices, the rest use the brand’s average ticket for that job type' : 'each uses the brand’s Acumatica average for its type (residential or commercial, service or sales, warranty), shown in Average Ticket by Brand below') : 'Add job values below', '#14302A', 'How AOV works: each booked call gets a dollar value. If its invoice is uploaded we use the real amount; otherwise we use that brand’s average won-job total from Acumatica for the call’s type (residential or commercial, service or sales, warranty). AOV = total booked value ÷ bookings with a value.'); })() +
      mnTile('Booked', +t.booked_value ? usd(t.booked_value) : n0(t.booked) + ' calls', n0(t.booked) + ' bookings · ' + pc(rate) + ' booking rate' + (+t.booked_value ? ' · estimated value' : '') + (t.booked_actual_n ? ' · ' + usd(t.booked_actual) + ' invoiced on ' + n0(t.booked_actual_n) : ''), '#1F5A41') + '</div>';
    var whyMax = Math.max.apply(null, (d.by_why || []).map(function (x) { return +x.n || 0; }).concat([1]));
    var why = '<div class="oq-card" style="flex:1 1 380px"><h2 class="ttl">Why opportunities didn’t book</h2><p class="sub">Every unbooked revenue opportunity, split by whether the CSR could have saved it. Click a reason to hear those calls.</p>' +
      (d.by_why || []).map(function (x) { var c = x.kind === 'controllable' ? '#C2562A' : '#9AA19D';
        return '<button class="click" data-ffk="misswhy" data-ffv="' + esc(x.why) + '" title="Hear these calls" style="all:unset;box-sizing:border-box;cursor:pointer;display:block;width:100%;margin-top:12px"><div style="display:flex;justify-content:space-between;gap:8px;font-size:13px"><span><b style="font-weight:600">' + esc(x.why) + '</b> <span class="pill" style="font-size:11px;background:' + (x.kind === 'controllable' ? '#FBEDE6;color:#A8441A' : '#EEEBE4;color:#56605B') + '">' + (x.kind === 'controllable' ? 'Controllable miss' : 'Not controllable') + '</span></span><span class="num">' + n0(x.n) + (+x.value ? ' · ' + usd(x.value) : '') + ' <span class="mut">›</span></span></div>' +
          '<div style="height:8px;background:#F3F1EC;border-radius:6px;margin-top:6px;overflow:hidden"><div style="height:100%;width:' + (100 * x.n / whyMax).toFixed(1) + '%;background:' + c + '"></div></div></button>'; }).join('') +
      '<p class="mut" style="font-size:12px;margin-top:14px">Dollar values use your invoice average once 10+ invoices match a brand and job type; until then the estimate below.</p></div>';
    var seg = (d.by_segment || []);
    var segCard = '<div class="oq-card" style="flex:1 1 260px"><h2 class="ttl">Residential vs Commercial</h2><table class="tbl" style="margin-top:10px;font-size:13px"><thead><tr><th></th><th>Decided</th><th>Booked</th><th>Rate</th><th>Controllable</th></tr></thead><tbody>' +
      seg.map(function (s) { return '<tr><td><b style="font-weight:600">' + esc(s.segment) + '</b></td><td class="num">' + n0(s.decided) + '</td><td class="num">' + n0(s.booked) + '</td><td class="num">' + pc(s.rate) + '</td><td class="num">' + n0(s.ctrl_n) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    // Sales vs service (2026-10-21): new doors / installs are sales; repairs, springs, openers and tune-ups are service
    var SVC = { 'New door / install': 'Sales', 'Windows, gates & entry doors': 'Sales', 'Door repair': 'Service', 'Opener repair': 'Service', 'Spring repair': 'Service', 'Maintenance / tune-up': 'Service', 'Commercial service': 'Service' };
    var sv = {}; (d.by_job || []).forEach(function (j) { var k = SVC[j.job_type] || 'Warranty & follow-ups'; var t = sv[k] = sv[k] || { k: k, decided: 0, booked: 0, ctrl_n: 0, ctrl_value: 0, missing: false }; t.decided += +j.decided || 0; t.booked += +j.booked || 0; t.ctrl_n += +j.ctrl_n || 0; t.ctrl_value += +j.ctrl_value || 0; if (+j.ctrl_n && !+j.ctrl_value) t.missing = true; });
    var svRows = ['Sales', 'Service', 'Warranty & follow-ups'].map(function (k) { return sv[k]; }).filter(Boolean);
    var svcCard = '<div class="oq-card"><h2 class="ttl">Sales vs Service</h2><p class="sub">Sales = new doors, installs, windows and gates. Service = repairs, springs, openers, tune-ups and commercial service.</p><p class="swipe mut" style="display:none;font-size:11.5px;margin:8px 0 0">Swipe sideways for more columns →</p><div style="overflow-x:auto"><table class="tbl" style="margin-top:10px;font-size:13px"><thead><tr><th></th><th>Decided</th><th>Booked</th><th>Rate</th><th>Controllable</th><th>Missed $</th></tr></thead><tbody>' +
      (svRows.length ? svRows.map(function (t) { return '<tr><td><b style="font-weight:600">' + esc(t.k) + '</b></td><td class="num">' + n0(t.decided) + '</td><td class="num">' + n0(t.booked) + '</td><td class="num">' + (t.decided ? pc(Math.round(t.booked / t.decided * 1000) / 10) : '—') + '</td><td class="num">' + n0(t.ctrl_n) + '</td><td class="num" style="color:#A8441A">' + (t.missing && !t.ctrl_value ? '<span class="mut">needs values</span>' : usd(t.ctrl_value)) + '</td></tr>'; }).join('') : '<tr><td colspan="6" class="mut">No booking opportunities in this period.</td></tr>') + '</tbody></table></div></div>';
    var brands = '<div class="oq-card" style="flex:1 1 460px"><h2 class="ttl">By Brand</h2><p class="swipe mut" style="display:none;font-size:11.5px;margin:8px 0 0">Swipe sideways for more columns →</p><div style="overflow-x:auto"><table class="tbl" style="margin-top:10px;font-size:13px"><thead><tr><th>Brand</th><th>Booking rate</th><th>Booked</th><th>Controllable misses</th><th>Controllable misses $</th><th>Not controllable</th></tr></thead><tbody>' +
      (d.by_brand || []).map(function (b) { return '<tr><td><b style="font-weight:600">' + esc(short(b.brand)) + '</b></td><td class="num">' + pc(b.rate) + '</td><td class="num">' + n0(b.booked) + '</td><td class="num">' + n0(b.ctrl_n) + '</td><td class="num" style="color:#A8441A">' + (+b.ctrl_value ? usd(b.ctrl_value) : '<span class="mut">needs values</span>') + '</td><td class="num">' + n0(b.nc_n) + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
    var jobs = '<div class="oq-card" style="flex:1 1 460px"><h2 class="ttl">By Job Type</h2><p class="sub">Click a job type to hear those calls.</p><p class="swipe mut" style="display:none;font-size:11.5px;margin:8px 0 0">Swipe sideways for more columns →</p><div style="overflow-x:auto"><table class="tbl" style="margin-top:10px;font-size:13px"><thead><tr><th>Job type</th><th>Residential</th><th>Commercial</th><th>Booking rate</th><th>Controllable misses</th><th>Controllable misses $</th></tr></thead><tbody>' +
      (d.by_job || []).map(function (j) { return '<tr class="click" tabindex="0" data-ffk="jobtype" data-ffv="' + esc(j.job_type) + '" title="Hear these calls"><td><b style="font-weight:600">' + esc(j.job_type) + '</b></td><td class="num">' + n0(j.residential) + '</td><td class="num">' + n0(j.commercial) + '</td><td class="num">' + pc(j.rate) + '</td><td class="num">' + n0(j.ctrl_n) + '</td><td class="num" style="color:#A8441A">' + (j.ctrl_n && !+j.ctrl_value ? '<span class="mut">needs value</span>' : usd(j.ctrl_value)) + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
    var top = '<div class="oq-card" style="flex:1 1 460px"><h2 class="ttl">Biggest Controllable Misses</h2><p class="sub">Click a call to listen and see what the CSR could have done.</p>' +
      ((d.top || []).length ? (d.top || []).map(function (c) {
        return '<button class="click" data-call="' + c.id + '" style="all:unset;box-sizing:border-box;cursor:pointer;width:100%;display:flex;gap:12px;align-items:center;padding:11px 0;border-top:1px solid var(--line2)"><span style="flex:1;min-width:0"><b style="font-weight:600">' + esc(c.agent || 'Unknown CSR') + '</b> <span class="mut" style="font-size:12px">· ' + esc(short(c.brand)) + ' · ' + fdate(c.date) + '</span><span class="mut" style="display:block;font-size:12px">' + esc(c.job_type) + (c.segment === 'Commercial' ? ' · Commercial' : '') + ' · ' + esc(c.why) + '</span></span><span class="num" style="font-weight:600;color:#A8441A">' + (c.value != null ? usd(c.value) : '') + '</span><span class="pill num" style="' + chipScore(c.score) + ';font-size:12.5px">' + (c.score == null ? '—' : c.score) + '</span></button>'; }).join('') : '<div class="mut" style="padding:14px 0">No controllable misses in this range.</div>') + '</div>';
    // why calls were excused
    var B = ex.buckets || [], bmax = Math.max.apply(null, B.map(function (b) { return +b.n || 0; }).concat([1]));
    var exc = '<div class="oq-card" style="flex:1 1 460px"><h2 class="ttl">Calls that weren’t revenue opportunities</h2><p class="sub">' + n0(ex.excused) + ' of ' + n0(ex.total) + ' calls (' + (ex.total ? Math.round(100 * ex.excused / ex.total) : 0) + '%). Click a row for example calls.</p>' +
      B.map(function (b, i) { var on = MN.bucket === i;
        return '<button data-act="mnbucket" data-i="' + i + '" style="all:unset;box-sizing:border-box;cursor:pointer;display:block;width:100%;padding:9px 0;border-top:1px solid var(--line2)" aria-expanded="' + on + '"><div style="display:flex;justify-content:space-between;gap:8px;font-size:13px"><span><b style="font-weight:600">' + esc(b.bucket) + '</b>' + (b.conversation ? '' : ' <span class="mut" style="font-size:11.5px">· no conversation</span>') + '</span><span class="num">' + n0(b.n) + (b.avg != null ? ' · avg score ' + b.avg : '') + '</span></div>' +
          '<div style="height:6px;background:#F3F1EC;border-radius:6px;margin-top:6px;overflow:hidden"><div style="height:100%;width:' + (100 * b.n / bmax).toFixed(1) + '%;background:#9AA19D"></div></div></button>' +
          (on ? '<div style="display:flex;gap:6px;flex-wrap:wrap;padding:4px 0 10px">' + (b.examples || []).map(function (id, k) { return '<button class="sel" data-call="' + id + '" style="padding:5px 10px;font-size:12px">Example call ' + (k + 1) + '</button>'; }).join('') + '</div>' : ''); }).join('') + '</div>';
    w.innerHTML = tiles + '<div class="row" style="align-items:flex-start;margin-top:16px">' + why + '<div style="flex:1 1 260px;display:flex;flex-direction:column;gap:16px;min-width:0">' + segCard.replace('class="oq-card" style="flex:1 1 260px"', 'class="oq-card"') + svcCard + '</div></div>' +
      '<div class="row" style="align-items:flex-start;margin-top:16px">' + top + brands + '</div>' +
      '<div class="row" style="align-items:flex-start;margin-top:16px">' + jobs + exc + '</div>' +
      '<div class="row" style="align-items:flex-start;margin-top:16px">' + ((d.group_values || []).length ? gvCard(d) : jvCard()) + '</div>';
  }
  // Average ticket by brand (2026-10-28): Acumatica won opportunities, brand x residential/commercial x service/sales + warranty.
  var GV_GRPS = ['Residential service', 'Residential sales', 'Commercial service', 'Commercial sales', 'Warranty'];
  function gvCard(d) {
    var G2 = d.group_values || [], all = {}, by = {}, asOf = '', src = '';
    G2.forEach(function (x) { asOf = x.as_of || asOf; src = x.source || src; if (x.brand == null) all[x.grp] = x; else { (by[x.brand] = by[x.brand] || {})[x.grp] = x; } });
    var brands = Object.keys(by).sort(function (a, b) { return short(a).localeCompare(short(b)); });
    var missing = (KNOWN.brands || []).filter(function (b) { return !by[b] && (!LOCK || b === LOCK); });
    var cell = function (x, fb) {
      if (x && +x.n >= 10) return '<td class="num" title="' + n0(x.n) + ' won jobs · median ' + usd(x.median) + '">' + usd(x.value) + '</td>';
      var a = fb; return '<td class="num mut" title="' + (x ? 'Only ' + n0(x.n) + ' won jobs for this brand, so the all-brands average is used' : 'No Acumatica jobs for this brand, so the all-brands average is used') + '">' + (a ? usd(a.value) + '*' : '—') + '</td>'; };
    var row = function (nm, m, bold) { return '<tr' + (bold ? ' style="font-weight:600;border-top:2px solid var(--line)"' : '') + '><td><span style="display:inline-flex;gap:8px;align-items:center">' + (bold ? '' : bbadge(nm)) + esc(bold ? nm : short(nm)) + '</span></td>' + GV_GRPS.map(function (g) { return bold ? '<td class="num" title="' + n0((m[g] || {}).n) + ' won jobs · median ' + usd((m[g] || {}).median) + '">' + usd((m[g] || {}).value) + '</td>' : cell(m[g], all[g]); }).join('') + '</tr>'; };
    var dt = asOf ? new Date(asOf + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    return '<div class="oq-card" style="flex:1 1 640px"><h2 class="ttl">Average Ticket by Brand</h2><p class="sub">The average total of won jobs in Acumatica over the last 12 months, by brand and job type. Each booked or missed call is valued at its brand’s average for its type. Hover a number to see how many jobs it’s based on and the median.</p>' +
      '<p class="swipe mut" style="display:none;font-size:11.5px;margin:8px 0 0">Swipe sideways for more columns →</p><div style="overflow-x:auto"><table class="tbl" style="margin-top:10px;font-size:13px"><thead><tr><th>Brand</th>' + GV_GRPS.map(function (g) { return '<th style="text-align:right">' + esc(g) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      brands.map(function (b) { return row(b, by[b]); }).join('') + missing.map(function (b) { return row(b, {}); }).join('') + (LOCK ? '' : row('All brands', all, true)) + '</tbody></table></div>' +
      '<p class="mut" style="font-size:11.5px;margin-top:8px">* Fewer than 10 won jobs for that brand and type (or the brand isn’t in Acumatica), so the all-brands average is used. The largest 1% of jobs in each type are left out so one huge job doesn’t skew the average. Source: ' + esc(src || 'Acumatica') + (dt ? ', as of ' + esc(dt) : '') + '. When an invoice is matched to a booked call, its real amount is used instead.</p>' +
      (IS_ADMIN ? '<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--line2);display:flex;gap:12px;align-items:center;flex-wrap:wrap"><div style="flex:1 1 300px"><b style="font-size:13.5px">Upload invoices</b><div class="mut" style="font-size:12px">CSV with invoice number, invoice date, amount and customer phone (brand and job type optional). Each invoice is matched to the booked call from that phone in the 45 days before.</div></div><label class="sel" style="cursor:pointer">' + (MN.busy === 'inv' ? 'Uploading…' : 'Choose CSV') + '<input type="file" accept=".csv,text/csv" data-invfile style="display:none"></label></div>' : '') + '</div>';
  }
  function jvCard() {
    var J = MN.jv || {}, types = J.job_types || [], vals = J.values || [], eff = J.effective || [];
    var brands = eff.map(function (x) { return x.brand; }).filter(function (b, i, L) { return b && L.indexOf(b) === i; }).sort();
    if (LOCK) MN.jvb = LOCK; else if (MN.jvb && brands.indexOf(MN.jvb) < 0) MN.jvb = '';
    var B = MN.jvb || null;
    var own = function (jt) { return vals.filter(function (v) { return (v.brand || null) === B && v.job_type === jt; })[0]; };
    var dflt = function (jt) { return vals.filter(function (v) { return v.brand == null && v.job_type === jt; })[0]; };
    var effOf = function (jt) { return eff.filter(function (x) { return x.job_type === jt && (!B || x.brand === B); }); };
    var setCount = brands.filter(function (b) { return vals.some(function (v) { return v.brand === b && v.est_value != null; }); }).length;
    var rows = types.map(function (jt) {
      var v = own(jt), d = B ? dflt(jt) : null, on = MN.edit === jt, ef = effOf(jt);
      var inv = ef.filter(function (x) { return x.basis === 'invoices'; }), n = ef.reduce(function (a, x) { return a + (+x.n || 0); }, 0);
      var src = inv.length ? (B ? 'Your invoices (' + n0(inv[0].n) + ')' : 'Invoices for ' + inv.length + ' brand' + (inv.length > 1 ? 's' : ''))
        : n ? n0(n) + ' invoices matched so far' : (v && v.est_value != null ? 'Your estimate' : (d && d.est_value != null ? 'All-brands default' : '—'));
      var shown = v && v.est_value != null ? usd(v.est_value) : (d && d.est_value != null ? '<span class="mut">' + usd(d.est_value) + ' (default)</span>' : '<span class="mut">Not set</span>');
      return '<tr><td><b style="font-weight:600">' + esc(jt === 'Other' ? 'Follow-ups, warranty & windows / gates / entry doors' : jt) + '</b></td>' +
        '<td class="num">' + (on ? '<label class="sr" for="jvv">Value</label><input id="jvv" class="oq-field" type="number" min="0" step="1" style="width:110px" value="' + (v && v.est_value != null ? v.est_value : '') + '">' : shown) + '</td>' +
        '<td class="mut" style="font-size:12px">' + src + '</td>' +
        '<td style="text-align:right">' + (!IS_ADMIN ? '' : on ? '<button class="sel btnd" data-act="jvsave" data-jt="' + esc(jt) + '" style="padding:5px 10px;font-size:12px"' + (MN.busy ? ' disabled' : '') + '>Save</button> <button class="sel" data-act="jvcancel" style="padding:5px 10px;font-size:12px">Cancel</button>'
          : '<button class="sel" data-act="jvedit" data-jt="' + esc(jt) + '" style="padding:5px 10px;font-size:12px" aria-label="Edit ' + esc(jt) + ' value">Edit</button>') + '</td></tr>';
    }).join('');
    var pickB = LOCK ? '<span class="pill" style="background:#F3F1EC;color:#3B4541">' + esc(short(LOCK)) + '</span>'
      : '<label class="sr" for="jvb">Brand</label><select id="jvb" class="oq-field" data-jvbrand style="max-width:260px"><option value="">All brands (default)</option>' + brands.map(function (b) { return '<option' + (B === b ? ' selected' : '') + '>' + esc(b) + '</option>'; }).join('') + '</select>';
    return '<div class="oq-card" style="flex:1 1 640px"><div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start"><div style="flex:1 1 360px"><h2 class="ttl">Job Values</h2>' +
      '<p class="sub">Average ticket for each job type, set per brand. Dollars show once a brand has values. When invoices are uploaded, each booked call uses its real amount, and once 10+ invoices match a brand and job type, that average replaces the estimate.' + (IS_ADMIN ? '' : ' Only account admins can change these.') + '</p>' +
      (LOCK ? '' : '<p class="mut" style="font-size:12px;margin-top:6px">' + setCount + ' of ' + brands.length + ' brands have values.</p>') + '</div>' + pickB + '</div>' +
      '<p class="swipe mut" style="display:none;font-size:11.5px;margin:8px 0 0">Swipe sideways for more columns →</p><div style="overflow-x:auto"><table class="tbl" style="margin-top:10px;font-size:13px"><thead><tr><th>Job type</th><th>' + (B ? esc(short(B)) : 'All brands') + '</th><th>Source</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      (IS_ADMIN ? '<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--line2);display:flex;gap:12px;align-items:center;flex-wrap:wrap"><div style="flex:1 1 300px"><b style="font-size:13.5px">Upload invoices</b><div class="mut" style="font-size:12px">CSV with invoice number, invoice date, amount and customer phone (brand and job type optional). Each invoice is matched to the booked call from that phone in the 45 days before.</div></div><label class="sel" style="cursor:pointer">' + (MN.busy === 'inv' ? 'Uploading…' : 'Choose CSV') + '<input type="file" accept=".csv,text/csv" data-invfile style="display:none"></label></div>' : '') + '</div>';
  }
  function jvSave(jt) {
    var el = $('jvv'); if (!el || MN.busy) return; MN.busy = true;
    api({ action: 'jobvalues', op: 'set', job_type: jt, brand: MN.jvb || null, value: el.value === '' ? null : +el.value }).then(function (r) { MN.busy = false; MN.jv = r; MN.edit = null; MN.d = null; toast('Saved — revenue numbers updated'); render(); })
      .catch(function (e) { MN.busy = false; toast(e.message || 'Couldn’t save. Try again.'); });
  }
  function parseCsv(text) {
    var rows = [], row = [], f = '', q = false;
    for (var i = 0; i < text.length; i++) { var c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; } else f += c; }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return String(x).trim(); }); });
  }
  function invUpload(file) {
    if (!file || MN.busy) return; var rd = new FileReader();
    rd.onload = function () {
      var R = parseCsv(String(rd.result || '').replace(/^﻿/, '')); if (R.length < 2) { toast('That file looks empty'); return; }
      var h = R[0].map(function (x) { return String(x).toLowerCase().replace(/[^a-z0-9]/g, ''); });
      var col = function (names) { for (var i = 0; i < h.length; i++) for (var k = 0; k < names.length; k++) if (h[i] === names[k] || h[i].indexOf(names[k]) === 0) return i; return -1; };
      var ci = { no: col(['invoiceno', 'invoicenumber', 'invoice', 'refnbr', 'referencenbr', 'docno']), d: col(['invoicedate', 'date', 'docdate']), a: col(['amount', 'total', 'invoicetotal', 'docamount']), p: col(['phone', 'customerphone', 'phone1']), b: col(['brand', 'branch', 'company']), j: col(['jobtype', 'type', 'worktype']) };
      if (ci.no < 0 || ci.d < 0 || ci.a < 0 || ci.p < 0) { toast('Needs columns for invoice number, date, amount and phone'); return; }
      var rows = R.slice(1).map(function (r) { var dd = String(r[ci.d] || '').trim(), m = dd.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
        if (m) dd = (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
        return { invoice_no: r[ci.no], invoice_date: dd.slice(0, 10), amount: r[ci.a], phone: r[ci.p], brand: ci.b >= 0 ? r[ci.b] : null, job_type: ci.j >= 0 ? r[ci.j] : null }; });
      MN.busy = 'inv'; drawMoney();
      api({ action: 'invoices', rows: rows }).then(function (x) { MN.busy = false; MN.d = null; toast('Saved ' + n0(x.saved) + ' invoices · matched ' + n0(x.matched) + ' to calls' + (x.skipped ? ' · skipped ' + x.skipped : '')); render(); })
        .catch(function (e) { MN.busy = false; drawMoney(); toast(e.message || 'Upload failed'); });
    };
    rd.readAsText(file);
  }
  function billingCard(b) {
    if (!b || b.hidden || !(b.months || []).length) return '';
    return '<div class="oq-card" style="flex:1 1 100%"><h2 class="ttl">Billing statement</h2><p class="sub">Calls audited each month × your rate. This is what your Opsis CX invoice is based on.</p><p class="swipe mut" style="display:none;font-size:11.5px;margin:8px 0 0">Swipe sideways for more columns →</p><div style="overflow-x:auto"><table class="tbl" style="margin-top:10px;font-size:13px"><thead><tr><th>Month</th><th>Calls audited</th><th>Rate</th><th>Amount</th><th>Top brands</th></tr></thead><tbody>' +
      b.months.map(function (m) { var mo = new Date(m.month + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
        return '<tr><td><b style="font-weight:600">' + mo + '</b>' + (m.partial ? ' <span class="mut" style="font-size:11.5px">so far</span>' : '') + '</td><td class="num">' + n0(m.calls) + '</td><td class="num">' + (m.rate != null ? '$' + (+m.rate).toFixed(2) : '—') + '</td><td class="num">' + (m.rate != null ? '$' + (+m.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—') + '</td><td class="mut" style="font-size:12px">' + (m.brands || []).slice(0, 3).map(function (x) { return esc(short(x.brand || '—')) + ' ' + n0(x.calls); }).join(' · ') + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
  }

  // ---------- CSR Coaching Hub (2026-10-21) ----------
  // Managers/admins: sidebar "Coaching Hub" -> their CSRs -> one CSR's hub (+ focus, swap calls, kudos, call of the week).
  // CSR logins (CFG.csrSelf): only their own hub (Home / Ask my coach / My wins). Data: edge fn opsis-coaching-hub.
  var SELF = !!CFG.csrSelf;
  var HUB = { week: '', roster: null, home: {}, wins: {}, tab: 'home', chat: {}, audio: {}, modal: null };
  var HUBTABS = [['home', 'Home'], ['ask', 'Ask my coach'], ['wins', 'My wins']];
  function hubCsrId() { return SELF ? 'me' : S.hubCsr; }
  function hubBody(extra) { var b = Object.assign({}, extra || {}); if (!SELF && S.hubCsr) b.csr = S.hubCsr; if (HUB.week) b.week = HUB.week; return b; }
  function hubWeeks() { var t = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }), x = new Date(t + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() - (x.getUTCDay() + 6) % 7); var out = []; for (var i = 0; i < 12; i++) { var d = new Date(x); d.setUTCDate(x.getUTCDate() - 7 * i); var iso = d.toISOString().slice(0, 10); out.push([i ? iso : '', (i === 0 ? 'This week · ' : i === 1 ? 'Last week · ' : 'Week of ') + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })]); } return out; }
  function setHub(html) { $('main').innerHTML = (SELF ? '' : topbar()) + html + '<div class="foot">Powered by <b>Opsis CX</b> · ' + esc(CLIENT) + ' coaching</div>'; }
  var fwhen = function (ts) { if (!ts) return ''; var d = new Date(ts); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' }); };
  var FLAME = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#E0662A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-4-1-6 1-10z"/></svg>';
  var SPARK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2F7D5B" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/></svg>';
  var PLAY = '<svg width="15" height="15" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M7 4l13 8-13 8z"/></svg>';

  // ----- badges: real medals, each with its own shape, color and emblem -----
  var BDEF = {
    closer: { shape: 'shield', c: ['#F6CF5C', '#E3A21A', '#9C6A08'], g: 'M5 6h14v13H5zM5 10h14M9 4v4M15 4v4M9 15l2 2 4-4' },
    hot5: { shape: 'hex', c: ['#FF9A5C', '#EE5A24', '#A63A12'], g: 'M12 3c1 3.5 4.5 5.5 4.5 10a4.5 4.5 0 0 1-9 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3.5-1-6 .5-9z' },
    framer: { shape: 'medal', c: ['#4FD1B5', '#1E9C84', '#0F5F51'], g: 'M12 4v16M16 8c0-1.7-1.8-3-4-3s-4 1.3-4 3 1.8 2.6 4 3 4 1.3 4 3-1.8 3-4 3-4-1.3-4-3' },
    discovery: { shape: 'medal', c: ['#7FB2FF', '#3D7DD8', '#1F4A8C'], g: 'M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM15.5 15.5L20 20' },
    card: { shape: 'shield', c: ['#7EDB9C', '#2F9E5B', '#17603A'], g: 'M3.5 7h17v10h-17zM3.5 10.5h17M7 14.5h4' },
    save: { shape: 'star', c: ['#C4A2FF', '#8A5CD6', '#52308F'], g: 'M5 12a7 7 0 1 0 2.1-5M5 4v4h4' },
    calm: { shape: 'medal', c: ['#FF9CC0', '#E0598B', '#982E58'], g: 'M12 19s-6.5-4-6.5-9A3.5 3.5 0 0 1 12 7.5 3.5 3.5 0 0 1 18.5 10c0 5-6.5 9-6.5 9z' },
    perfect: { shape: 'star', c: ['#FFE27A', '#F2B705', '#A87C00'], g: 'M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8-4.2-4.1 5.9-.9z' },
    machine: { shape: 'hex', c: ['#9EA6FF', '#4B56C8', '#2A3182'], g: 'M13 3L5 13h6l-1 8 8-10h-6z' },
    cotw: { shape: 'medal', c: ['#FFD866', '#D9A520', '#8A640A'], g: 'M8 20h8M12 16v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h2.5v2a3 3 0 0 1-3 3M7 5H4.5v2a3 3 0 0 0 3 3' }
  };
  var BID = 0;
  function bshape(shape, cx, cy, r) {
    var pts = [], i, n;
    if (shape === 'shield') return 'M' + cx + ' ' + (cy - r) + ' L' + (cx + r * 0.88) + ' ' + (cy - r * 0.68) + ' V' + (cy + r * 0.1) + ' C' + (cx + r * 0.88) + ' ' + (cy + r * 0.62) + ' ' + (cx + r * 0.45) + ' ' + (cy + r * 0.9) + ' ' + cx + ' ' + (cy + r * 1.08) + ' C' + (cx - r * 0.45) + ' ' + (cy + r * 0.9) + ' ' + (cx - r * 0.88) + ' ' + (cy + r * 0.62) + ' ' + (cx - r * 0.88) + ' ' + (cy + r * 0.1) + ' V' + (cy - r * 0.68) + ' Z';
    if (shape === 'hex') { for (i = 0; i < 6; i++) { var a = Math.PI / 3 * i - Math.PI / 2; pts.push((cx + r * Math.cos(a)).toFixed(1) + ',' + (cy + r * Math.sin(a)).toFixed(1)); } return 'M' + pts.join('L') + 'Z'; }
    n = shape === 'star' ? 10 : 24;
    for (i = 0; i < n * 2; i++) { var rr = i % 2 ? (shape === 'star' ? r * 0.78 : r * 0.9) : r, b = Math.PI / n * i - Math.PI / 2; pts.push((cx + rr * Math.cos(b)).toFixed(1) + ',' + (cy + rr * Math.sin(b)).toFixed(1)); }
    return 'M' + pts.join('L') + 'Z';
  }
  function badgeSvg(key, earned, size) {
    var d = BDEF[key] || BDEF.closer, id = 'hb' + (++BID), c = earned ? d.c : ['#ECE9E3', '#C9C3B8', '#9C968B'], rib = earned ? [d.c[2], d.c[1]] : ['#B5AFA4', '#CFC9BF'];
    return '<svg width="' + size + '" height="' + Math.round(size * 1.12) + '" viewBox="0 0 100 112" ' + (earned ? 'role="img" aria-label="Badge earned"' : 'aria-hidden="true"') + '>' +
      '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + c[0] + '"/><stop offset="1" stop-color="' + c[1] + '"/></linearGradient></defs>' +
      '<path d="M32 66 L22 108 L36 100 L44 110 L50 70 Z" fill="' + rib[0] + '"/><path d="M68 66 L78 108 L64 100 L56 110 L50 70 Z" fill="' + rib[1] + '"/>' +
      '<path d="' + bshape(d.shape, 50, 47, 44) + '" fill="' + c[2] + '"/>' +
      '<path d="' + bshape(d.shape, 50, 47, 39) + '" fill="url(#' + id + ')"/>' +
      '<circle cx="50" cy="47" r="23" fill="' + c[2] + '" opacity=".28"/><circle cx="50" cy="47" r="23" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="2"/>' +
      '<path d="M24 32 Q50 12 76 32" fill="none" stroke="#fff" stroke-opacity="' + (earned ? '.45' : '.5') + '" stroke-width="3" stroke-linecap="round"/>' +
      '<g transform="translate(35 32) scale(1.25)" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="' + d.g + '"/></g>' +
      (earned ? '' : '<g transform="translate(64 62)"><circle r="11" fill="#fff" stroke="#C9C3B8" stroke-width="2"/><path d="M-4.5 -1h9v7h-9zM-2.8 -1v-2.6a2.8 2.8 0 0 1 5.6 0V-1" fill="none" stroke="#7B766C" stroke-width="1.8" stroke-linejoin="round"/></g>') +
      '</svg>';
  }

  // ----- shared bits -----
  function hubHeader(name, sub) {
    var tabs = '<div class="row" role="tablist" aria-label="Coaching Hub" style="gap:6px">' + HUBTABS.map(function (t) { var on = HUB.tab === t[0]; return '<button class="sel" role="tab" aria-selected="' + on + '" data-hubtab="' + t[0] + '" style="' + (on ? 'background:var(--side);border-color:var(--side);color:#fff;font-weight:600' : '') + '">' + (t[0] === 'wins' && !SELF ? 'Wins' : t[1]) + '</button>'; }).join('') + '</div>';
    return (SELF ? '' : '<div class="oq-crumb"><button data-hubroster="1">Coaching Hub</button><span aria-hidden="true">/</span><span style="color:var(--ink);font-weight:600">' + esc(name) + '</span></div>') +
      '<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap"><div><div class="cap">' + esc(sub || '') + '</div><h1 style="margin:4px 0 0;font-size:26px;font-weight:600;letter-spacing:-0.025em">' + esc(SELF && HUB.tab === 'home' ? greet() + ', ' + (CFG.userFirst || '') : name) + '</h1></div>' + (SELF ? '' : tabs) + '</div>';
  }
  function sayFill(t) { return String(t || '').replace(/\{day1\}/g, 'Thursday at 9').replace(/\{day2\}/g, 'Friday at 1').replace(/\{day\}/g, 'Thursday').replace(/\{window\}/g, '8 and 12').replace(/\{problem\}/g, 'won’t open').replace(/\{when\}/g, 'this morning'); }
  function greet() { var h = +new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/New_York' }); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
  function tile(label, val, sub) { return '<div style="background:#FAF9F6;border:1px solid #EEEBE4;border-radius:12px;padding:10px 12px;min-width:0"><div class="cap">' + label + '</div><div class="num" style="font-weight:700;font-size:19px;margin-top:2px">' + val + '</div><div class="mut" style="font-size:11.5px">' + (sub || '&nbsp;') + '</div></div>'; }
  function playBtn(rid, color, label) {
    var a = HUB.audio[rid];
    if (a && a.url) return '<audio controls autoplay src="' + esc(a.url + (a.at ? '#t=' + Math.max(0, a.at - 2) : '')) + '" style="width:min(460px,72vw);height:48px"></audio>';
    return '<button class="hubplay" data-hubplay="' + rid + '" aria-label="' + esc(label || 'Play call') + '" style="width:44px;height:44px;border-radius:999px;border:0;background:' + color + ';display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0">' + (a && a.busy ? '<span class="dots"><span></span><span></span><span></span></span>' : PLAY) + '</button>';
  }

  // ----- views -----
  function vHub(tok) {
    if (SELF) { HUB.tab = S.view === 'hubask' ? 'ask' : S.view === 'hubwins' ? 'wins' : 'home'; }
    if (!SELF && !S.hubCsr) return hubRoster(tok);
    if (HUB.tab === 'ask') return hubAsk();
    if (HUB.tab === 'wins') return hubWins(tok);
    return hubHome(tok);
  }
  function hubRoster(tok) {
    setHub('<div class="oq-crumb"><span style="color:var(--ink);font-weight:600">Coaching Hub</span></div><div id="hubr" style="display:flex;flex-direction:column;gap:4px">' + skel(60, 4) + '</div>');
    var paint = function () {
      var el = $('hubr'); if (!el || tok !== T) return; var R = HUB.roster;
      var ALLN = R.rows.length; R = Object.assign({}, R, { rows: S.brands.length ? R.rows.filter(function (r) { return S.brands.indexOf(r.brand) >= 0; }) : R.rows });
      if (!R.rows.length && ALLN) { el.innerHTML = '<div class="oq-card"><b>No CSRs for the brands picked above</b><p class="sub">Pick other brands at the top, or <button class="more" data-act="huballbrands">show all brands</button>.</p></div>'; return; }
      if (!R.rows.length) { el.innerHTML = '<div class="oq-card"><b>No CSRs in the Coaching Hub yet</b><p class="sub">Add the people who answer your phones.</p>' + (LOCK ? '<button class="sel btnd" data-hubpeople="' + esc(LOCK) + '">Add CSRs</button>' : '') + '</div>'; return; }
      var brands = {}; R.rows.forEach(function (r) { (brands[r.brand_short] = brands[r.brand_short] || []).push(r); });
      var dl = function (v, l) { if (v == null || l == null) return ''; var x = v - l; return x === 0 ? '<span class="mut">even</span>' : '<span style="color:' + (x > 0 ? '#1F5A41' : '#A8441A') + ';font-weight:600">' + (x > 0 ? '▲ ' : '▼ ') + Math.abs(x) + '</span>'; };
      el.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:10px;flex-wrap:wrap"><div><h1 style="margin:0;font-size:24px;font-weight:600;letter-spacing:-0.02em">Coaching Hub</h1><p class="sub">' + esc(R.week_label) + ' · ' + R.rows.length + ' CSRs' + (R.rows.length < ALLN ? ' of ' + ALLN + ' (filtered by brand)' : '') + ' · open anyone to see exactly what they see, set their focus or send kudos</p></div>' + '<div class="row" style="gap:8px"><button class="sel btnd" data-go="hubqs">What CSRs are asking</button>' + (LOCK ? '<button class="sel" data-hubpeople="' + esc(LOCK) + '">Edit CSR list</button>' : '') + '</div></div>' +
        Object.keys(brands).sort().map(function (b) {
          return '<div style="margin-top:16px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><span class="cap">' + esc(b) + ' · ' + brands[b].length + '</span>' + (LOCK ? '' : '<button class="more" data-hubpeople="' + esc(brands[b][0].brand) + '">Edit list</button>') + '</div><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px">' + brands[b].map(function (r) {
            return '<button class="oq-card click" data-hubcsr="' + r.id + '" style="text-align:left;cursor:pointer;display:flex;flex-direction:column;gap:10px;padding:16px;font:inherit;color:inherit">' +
              '<span style="display:flex;align-items:center;gap:10px;width:100%"><span class="av">' + esc(r.name.split(' ').map(function (p) { return p[0]; }).join('').slice(0, 2)) + '</span><span style="flex:1;min-width:0"><b style="font-weight:600;display:block">' + esc(r.name) + '</b><span class="mut" style="font-size:12px">' + r.n + ' scored calls this week</span></span>' +
              (r.requests ? '<span class="pill" style="background:#EEF2FB;color:#2B3A67">' + r.requests + ' to review</span>' : '') + '</span>' +
              '<span style="display:flex;gap:16px;align-items:baseline;width:100%"><span><span class="num" style="font-size:22px;font-weight:700">' + (r.score == null ? '—' : r.score) + '</span> <span class="mut" style="font-size:12px">score</span></span><span style="font-size:12px">' + dl(r.score, r.last) + '</span><span class="mut" style="font-size:12px;margin-left:auto">' + (r.opps ? r.booked + '/' + r.opps + ' booked' : '') + '</span></span>' +
              '<span class="mut" style="font-size:12px;line-height:1.4;width:100%">' + (r.focus ? '<b style="color:var(--ink);font-weight:600">Focus:</b> ' + esc(r.focus) : 'Focus set when you open them') + (r.kudos ? ' · ♥ ' + r.kudos : '') + '</span></button>';
          }).join('') + '</div></div>';
        }).join('');
    };
    if (HUB.roster) { setTimeout(paint, 0); }
    api({ action: 'hubroster', week: HUB.week || null }).then(function (r) { HUB.roster = r; paint(); }).catch(function (e) { var el = $('hubr'); if (el && !HUB.roster) el.innerHTML = errBox(e); });
  }
  function loadHome(force) {
    var id = hubCsrId();
    if (!force && HUB.home[id] && HUB.home[id].data) return Promise.resolve(HUB.home[id].data);
    return api(Object.assign({ action: 'hubhome' }, hubBody())).then(function (d) { HUB.home[id] = { data: d }; return d; });
  }
  function hubHome(tok) {
    var id = hubCsrId(), cached = HUB.home[id] && HUB.home[id].data;
    setHub('<div id="hubh" style="display:flex;flex-direction:column;gap:16px">' + (cached ? '' : skel(40, 1) + '<div class="grid" style="grid-template-columns:2fr 1fr;gap:16px">' + skel(260) + skel(260) + '</div>' + skel(200)) + '</div>');
    if (cached) paintHome(cached);
    loadHome(true).then(function (d) { if (tok === T) paintHome(d); }).catch(function (e) { var el = $('hubh'); if (el && !cached) el.innerHTML = errBox(e); });
  }
  function paintHome(d) {
    var el = $('hubh'); if (!el) return;
    var f = d.focus, sc = d.score, mg = d.can_manage && !SELF, first = d.csr.first;
    var h = hubHeader(d.csr.name, d.week_label + (SELF ? '' : ' · ' + d.csr.brand_short));
    if (d.past) h += '<div class="banner" style="background:#EEF2FB;color:#2B3A67">Looking back at the week of ' + esc(d.week_label.replace(/^Week of /, '')) + '. Focus, picks and kudos can only be changed for this week. <button class="lnk" data-hubweekreset="1">Back to this week</button></div>';
    if (mg) h += '<div class="row" style="gap:8px"><button class="sel btnd" data-hubact="kudos">♥ Send kudos</button><button class="sel" data-hubact="focus">Change focus</button><button class="sel" data-hubact="cotw">Pick call of the week</button></div>';
    (d.requests || []).forEach(function (r) { h += '<div class="oq-card" style="background:#EEF2FB;border-color:#D5DDF2;padding:14px 16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><b style="color:#2B3A67">' + esc(first) + ' asked you to review a score</b><span style="font-size:13px;flex:1;min-width:200px">“' + esc(r.why) + '” · ' + fwhen(r.at) + '</span>' + (r.review_id ? '<button class="sel" data-call="' + r.review_id + '">Open the call</button>' : '') + '<button class="sel" data-hubreqdone="' + r.id + '">Mark reviewed</button></div>'; });
    // focus hero
    var pct = f && f.of ? Math.round(100 * f.done / f.of) : 0, goalN = f && f.of ? Math.ceil(f.of * (f.goal_pct || 80) / 100) : null;
    var focus = f ? '<section class="oq-card" aria-label="Focus this week" style="grid-column:span 2;background:var(--side);border-color:var(--side);color:#fff;padding:24px;display:flex;flex-direction:column;gap:14px">' +
      '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><span class="cap" style="color:#9DBBAE">' + (SELF ? 'Your focus this week' : first + '’s focus this week') + '</span><span style="font-size:12px;color:#BFD1C8">' + (f.set_by ? 'Set by ' + esc(f.set_by) : 'Picked from last week’s calls') + '</span></div>' +
      '<h2 style="margin:0;font-size:24px;font-weight:600;letter-spacing:-0.02em;line-height:1.25">' + esc(f.title) + '</h2>' +
      (f.body ? '<p style="margin:0;font-size:14px;line-height:1.6;color:#D6E2DC;max-width:680px;white-space:pre-line">' + esc(f.body) + '</p>' : '') +
      (f.say ? '<div style="background:#1F3F37;border-radius:12px;padding:14px 16px;font-size:14px;line-height:1.5"><div class="cap" style="color:#9DBBAE;margin-bottom:4px">Try saying</div>“' + esc(sayFill(f.say)) + '”</div>' : '') +
      (f.of ? '<div><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px;gap:8px;flex-wrap:wrap"><span>' + esc(f.metric || 'Done') + ' on <b>' + f.done + ' of ' + f.of + '</b> calls this week</span><span style="color:#BFD1C8">Goal: ' + goalN + ' of ' + f.of + '</span></div><div style="height:8px;border-radius:999px;background:#2A4A42;overflow:hidden"><div style="width:' + pct + '%;height:100%;border-radius:999px;background:' + (pct >= (f.goal_pct || 80) ? '#F6CF5C' : '#7CC4A4') + '"></div></div></div>' : '<div style="font-size:13px;color:#BFD1C8">Progress shows up after the first scored calls this week.</div>') +
      '<div class="row" style="gap:10px"><button class="sel" data-hubgood="1" style="background:#fff;border-color:#fff">' + PLAY.replace('#fff', '#14302A') + ' Hear a great example</button><button class="sel" data-hubtab="ask" data-hubq="How do I get better at: ' + esc(f.title) + '?" style="background:transparent;border-color:#4E6E64;color:#fff">Ask how to do this</button></div></section>' : '';
    var delta = sc.delta == null ? '' : sc.delta === 0 ? '<span class="mut" style="font-size:13px">Same as last week</span>' : '<span style="color:' + (sc.delta > 0 ? '#1F5A41' : '#A8441A') + ';font-weight:600;font-size:13px">' + (sc.delta > 0 ? '▲ ' : '▼ ') + Math.abs(sc.delta) + ' vs last week</span>';
    var col = sc.now == null ? '#EEEBE4' : sc.now >= 80 ? '#2F7D5B' : sc.now >= 60 ? '#E8A06A' : '#E0662A';
    var week = '<section class="oq-card" aria-label="This week" style="display:flex;flex-direction:column;gap:14px"><div style="display:flex;justify-content:space-between;align-items:center"><span class="cap">This week</span>' + (d.streak && d.streak.now ? '<span class="pill" style="background:#FFF4E8;color:#8A3D0C">' + FLAME + ' ' + d.streak.now + '-day streak</span>' : '') + '</div>' +
      '<div style="display:flex;align-items:center;gap:16px"><div style="position:relative;width:100px;height:100px;flex-shrink:0"><svg width="100" height="100" viewBox="0 0 120 120" role="img" aria-label="Score ' + (sc.now == null ? 'not yet' : sc.now) + '"><circle cx="60" cy="60" r="50" fill="none" stroke="#EEEBE4" stroke-width="12"/><circle cx="60" cy="60" r="50" fill="none" stroke="' + col + '" stroke-width="12" stroke-linecap="round" stroke-dasharray="' + ((sc.now || 0) / 100 * 314).toFixed(0) + ' 314" transform="rotate(-90 60 60)"/></svg><div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center"><span class="num" style="font-size:27px;font-weight:700">' + (sc.now == null ? '—' : sc.now) + '</span><span class="mut" style="font-size:10.5px">call score</span></div></div>' +
      '<div style="display:flex;flex-direction:column;gap:6px">' + delta + '<span class="mut" style="font-size:12.5px">' + sc.n + ' scored call' + (sc.n === 1 ? '' : 's') + '</span></div></div>' +
      '<div class="grid" style="grid-template-columns:1fr 1fr;gap:10px">' + tile('Personal best', sc.best_week == null ? '—' : sc.best_week, 'best week') + tile('Booked', sc.opps ? sc.booked + ' of ' + sc.opps : '—', 'booking chances') + '</div>' +
      (sc.best_week != null && sc.now != null ? '<button class="more" data-hubtab="wins">' + (sc.now >= sc.best_week ? 'New personal best pace!' : (sc.best_week - sc.now) + ' points from your personal best') + ' →</button>' : '') + '</section>';
    h += '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px">' + focus + week + '</div>';
    // coaching calls
    var good = (d.picks || []).filter(function (p) { return p.kind === 'good'; }), grow = (d.picks || []).filter(function (p) { return p.kind === 'grow'; });
    var pickRow = function (p, i) {
      var g = p.kind === 'good';
      return '<div class="hubpick" style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start;background:' + (g ? '#F3F8F5' : '#FFF8F1') + ';border:1px solid ' + (g ? '#D5E6DC' : '#F6DCC4') + ';border-radius:14px;padding:14px"' + (g && i === 0 ? ' id="hubgood0"' : '') + '>' +
        '<div data-hubslot="' + p.review_id + '" style="flex-shrink:0">' + playBtn(p.review_id, g ? '#2F7D5B' : '#C2551F') + '</div>' +
        '<div style="flex:1;min-width:220px"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">' + (mg ? '<button class="more" data-call="' + p.review_id + '" style="font-size:14px;color:var(--ink)">' + esc(p.title) + '</button>' : '<b style="font-weight:600">' + esc(p.title) + '</b>') + '<span class="mut num" style="font-size:12px;white-space:nowrap">' + fwhen(p.date) + ' · ' + fsecs(p.secs) + (p.score != null ? ' · ' + p.score : '') + '</span></div>' +
        (p.why ? '<div style="font-size:13px;line-height:1.5;color:#3B4541;margin-top:4px">' + esc(p.why) + '</div>' : '') +
        (p.tip ? '<div style="font-size:13px;line-height:1.5;margin-top:6px"><b>Next time:</b> ' + esc(p.tip) + '</div>' : '') +
        (p.moment ? '<button class="sel" data-hubat="' + p.review_id + '|' + p.moment.at + '" style="margin-top:8px;padding:6px 12px;font-size:12.5px;border-color:' + (g ? '#BFDCCB' : '#F3CDAE') + '">▶ Jump to ' + Math.floor(p.moment.at / 60) + ':' + ('0' + (p.moment.at % 60)).slice(-2) + ' · ' + esc(p.moment.step) + '</button>' : '') +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:center"><span class="pill" style="background:' + (g ? '#E6F0EA' : '#FCEBDD') + ';color:' + (g ? '#1F5A41' : '#8A3D0C') + '">' + esc(p.step_label || (g ? 'Great call' : 'Room to grow')) + '</span>' +
        '<span style="margin-left:auto;display:flex;gap:10px"><button class="more" data-hubtab="ask" data-hubrev="' + p.review_id + '" data-hubq="' + (g ? 'What made this call great?' : 'Why was this call scored this way?') + '">' + (g ? 'What made it great?' : 'Why this score?') + '</button>' + (mg ? '<button class="more" data-hubswap="' + p.id + '">Swap</button>' : '') + '</span></div></div></div>';
    };
    h += '<section class="oq-card" aria-label="Coaching calls" style="display:flex;flex-direction:column;gap:14px"><div><h2 class="ttl">' + (SELF ? 'Your coaching calls' : first + '’s coaching calls') + '</h2><p class="sub">' + (SELF ? 'Picked from your calls this week. Listen, then ask why if anything is unclear.' : 'What ' + esc(first) + ' sees. Swap any call, or open it to see the full review.') + '</p></div>' +
      ((d.picks || []).length ? '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px"><div style="display:flex;flex-direction:column;gap:10px"><div style="display:flex;align-items:center;gap:8px;color:#1F5A41;font-weight:600;font-size:13px"><span aria-hidden="true" style="width:8px;height:8px;border-radius:99px;background:#2F7D5B"></span>Great calls, keep doing this</div>' + (good.map(pickRow).join('') || '<p class="mut" style="font-size:13px">No standout calls yet this week.</p>') + '</div>' +
        '<div style="display:flex;flex-direction:column;gap:10px"><div style="display:flex;align-items:center;gap:8px;color:#8A3D0C;font-weight:600;font-size:13px"><span aria-hidden="true" style="width:8px;height:8px;border-radius:99px;background:#E0662A"></span>Room to grow, try it differently</div>' + (grow.map(pickRow).join('') || '<p class="mut" style="font-size:13px">Nothing to work on from these calls. Nice!</p>') + '</div></div>' : '<p class="mut" style="font-size:13px">Your coaching calls show up once a few of your calls have been scored.</p>') + '</section>';
    // badges + most improved
    var B = d.badges || {}, nx = B.next;
    h += '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px">' +
      '<section class="oq-card" aria-label="Badges" style="display:flex;flex-direction:column;gap:14px"><div style="display:flex;justify-content:space-between;align-items:center"><h2 class="ttl" style="font-size:16px">Badges <span class="mut" style="font-weight:400;font-size:13px">· ' + (B.total || 0) + ' earned</span></h2><button class="more" data-hubtab="wins">See all →</button></div>' +
      ((B.earned || []).length ? '<div class="grid" style="grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">' + B.earned.map(function (b) { return '<button data-hubtab="wins" title="See the call that earned it" style="all:unset;cursor:pointer;text-align:center;padding:10px 4px;border-radius:12px">' + badgeSvg(b.key, true, 64) + '<div style="font-weight:600;font-size:12.5px;margin-top:4px">' + esc(b.name) + '</div><div class="mut" style="font-size:11.5px">' + esc(b.when || '') + '</div><div style="font-size:11.5px;font-weight:600;color:#2F5E4E;margin-top:2px">Hear the call ›</div></button>'; }).join('') + '</div>' : '<p class="mut" style="font-size:13px;margin:0">Your first badge is close. Keep going!</p>') +
      (nx ? '<div style="background:#F3F8F5;border-radius:12px;padding:12px 14px;display:flex;gap:12px;align-items:center">' + badgeSvg(nx.key, false, 40) + '<div style="flex:1;min-width:0"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px;gap:8px"><span><b>Next: ' + esc(nx.name) + '</b> · ' + esc(nx.how) + '</span><span class="mut num">' + nx.progress + ' / ' + nx.goal + '</span></div><div class="track" style="height:8px;background:#DDEBE3"><div style="width:' + Math.round(100 * nx.progress / nx.goal) + '%;background:#2F7D5B"></div></div></div></div>' : '') + '</section>' +
      improvedCard(d.improved, d.csr.brand_short) + '</div>';
    // ask / call of the week / kudos
    var c = d.cotw;
    h += '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px">' +
      '<section class="oq-card" aria-label="Ask my coach" style="display:flex;flex-direction:column;gap:12px"><div style="display:flex;align-items:center;gap:8px">' + SPARK + '<h2 class="ttl" style="font-size:16px">Ask my coach</h2></div><p class="sub" style="margin:0">Ask why a call scored the way it did, or how ' + esc(d.csr.brand_short) + ' handles something.</p>' +
      '<form id="hubqf" style="display:flex;gap:8px"><label class="sr" for="hubqi">Ask a question</label><input id="hubqi" class="oq-field" type="text" autocomplete="off" maxlength="600" style="flex:1;min-width:0;position:relative;z-index:2;pointer-events:auto" placeholder="e.g. What do I say if they want a price first?"><button class="sel btnd" type="submit">Ask</button></form>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px">' + ['Why did my last low call score that way?', 'Customer wants a price over the phone', 'How do we handle warranty calls?'].map(function (q, i) { return '<button class="chip" data-hubtab="ask" data-hubmode="' + (i ? 'brand' : 'score') + '" data-hubq="' + esc(q) + '">' + esc(q) + '</button>'; }).join('') + '</div></section>' +
      '<section class="oq-card" aria-label="Call of the week" style="display:flex;flex-direction:column;gap:12px"><div style="display:flex;align-items:center;gap:10px">' + badgeSvg('cotw', true, 34) + '<h2 class="ttl" style="font-size:16px">' + esc(d.csr.brand_short) + ' call of the week</h2></div>' +
      (c ? '<div style="display:flex;gap:12px;align-items:center"><div data-hubslot="' + c.review_id + '">' + playBtn(c.review_id, '#14302A', 'Play call of the week') + '</div><div><b style="font-weight:600">' + esc(c.agent) + '</b><div class="mut" style="font-size:12px">' + fwhen(c.date) + ' · ' + fsecs(c.secs) + ' · ' + esc(c.title) + '</div></div></div>' +
        (c.why ? '<p style="margin:0;font-size:13px;line-height:1.55;color:#3B4541">' + esc(c.why) + '</p>' : '') + '<div style="display:flex;gap:6px;flex-wrap:wrap">' + (c.score != null ? '<span class="pill" style="background:#FFF4DB;color:#7A5410">Score ' + c.score + '</span>' : '') + (c.saved ? '<span class="pill" style="background:#F3F1EC;color:#3B4541">Booked after push-back</span>' : '') + (c.by ? '<span class="pill" style="background:#F3F1EC;color:#3B4541">Picked by ' + esc(c.by) + '</span>' : '') + '</div>'
        : '<p class="mut" style="font-size:13px;margin:0">The call of the week is picked from last week’s best booked calls. Check back Monday.</p>') + '</section>' +
      '<section class="oq-card" aria-label="Kudos" style="display:flex;flex-direction:column;gap:10px"><div style="display:flex;align-items:center;gap:8px"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C2551F" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg><h2 class="ttl" style="font-size:16px">' + (SELF ? 'Kudos for you' : 'Kudos') + '</h2>' + ((d.kudos || []).filter(function (k) { return k.isNew; }).length ? '<span class="pill" style="margin-left:auto;background:#FCEBDD;color:#8A3D0C">' + d.kudos.filter(function (k) { return k.isNew; }).length + ' new</span>' : '') + '</div>' +
      ((d.kudos || []).length ? d.kudos.slice(0, 3).map(function (k) { return '<div style="background:#FAF9F6;border:1px solid #EEEBE4;border-radius:12px;padding:12px 14px">' + (k.tag ? '<span class="pill" style="background:#FCEBDD;color:#8A3D0C;margin-bottom:6px">' + esc(k.tag) + '</span>' : '') + (k.body ? '<div style="font-size:13.5px;line-height:1.5">“' + esc(k.body) + '”</div>' : '') + '<div class="mut" style="font-size:12px;margin-top:6px">' + esc(k.from || '') + ' · ' + fwhen(k.at) + '</div></div>'; }).join('')
        : '<p class="mut" style="font-size:13px;margin:0">' + (SELF ? 'When your manager spots a great call, their kudos show up here.' : 'No kudos yet. ') + '</p>' + (mg ? '<button class="sel" data-hubact="kudos" style="align-self:flex-start">♥ Send ' + esc(first) + ' kudos</button>' : '')) + '</section></div>';
    if (mg && (d.questions || []).length) h += '<section class="oq-card" aria-label="Questions" style="display:flex;flex-direction:column;gap:10px"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap"><h2 class="ttl" style="font-size:16px">What ' + esc(first) + ' asked the coach</h2><button class="more" data-hubqcsr="' + d.csr.id + '">See all →</button></div>' +
      d.questions.map(function (q) { return '<div style="display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-top:1px solid var(--line2)"><span class="pill" style="background:' + (q.mode === 'brand' ? '#EEF2FB;color:#2B3A67' : '#F3F1EC;color:#3B4541') + ';flex-shrink:0">' + esc(q.topic && q.topic !== 'Other' ? q.topic : 'How-to & process') + '</span><span style="flex:1;font-size:13.5px;line-height:1.45">' + esc(q.question) + (q.by_manager ? ' <span class="mut" style="font-size:12px">(asked by a manager)</span>' : '') + '</span><span class="mut" style="font-size:12px;white-space:nowrap">' + fwhen(q.at) + '</span></div>'; }).join('') + '</section>';
    if (!SELF && (d.calls || []).length) h += '<section class="oq-card" aria-label="Calls this week"><h2 class="ttl" style="font-size:16px">' + (d.past ? 'Calls that week' : 'Calls this week') + ' <span class="mut" style="font-weight:400;font-size:13px">· ' + d.calls.length + ' scored</span></h2>' + d.calls.slice(0, 25).map(function (c) { return '<button class="click" data-call="' + esc(c.id) + '" style="all:unset;box-sizing:border-box;cursor:pointer;width:100%;display:flex;gap:12px;align-items:center;padding:8px 0;border-top:1px solid var(--line2);font-size:13px"><span class="mut num" style="width:58px">' + fdate(c.d) + '</span><span class="num" style="width:34px;font-weight:600">' + (c.score == null ? '—' : c.score) + '</span><span style="flex:1">' + esc(c.outcome || '') + '</span>' + (c.opp ? '<span class="pill" style="' + (c.ab ? 'background:#E6F0EA;color:#1F5A41' : 'background:#FCEBDD;color:#A8441A') + '">' + (c.ab ? 'Asked to book' : 'Didn’t ask') + '</span>' : '') + '</button>'; }).join('') + (d.calls.length > 25 ? '<p class="mut" style="font-size:12px;margin-top:8px">Showing the latest 25 of ' + d.calls.length + '.</p>' : '') + '</section>';
    el.innerHTML = h;
  }
  function improvedCard(list, brand) {
    return '<section class="oq-card" aria-label="Most improved" style="display:flex;flex-direction:column;gap:10px"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap"><h2 class="ttl" style="font-size:16px">Most improved at ' + esc(brand) + '</h2><span class="mut" style="font-size:12px">Last 3 weeks vs the 4 before</span></div>' +
      ((list || []).length ? list.map(function (m) { return '<div style="display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:12px;background:' + (m.me ? '#E6F0EA' : '#FAF9F6') + '"><span class="num" style="width:22px;font-weight:700;color:#5F6763;text-align:center">' + m.rank + '</span><span style="flex:1;font-weight:' + (m.me ? 700 : 500) + '">' + esc(m.name) + '</span><span class="num" style="font-weight:700;color:' + (m.gain >= 0 ? '#1F5A41' : '#A8441A') + '">' + (m.gain > 0 ? '+' : '') + m.gain + '</span></div>'; }).join('') : '<p class="mut" style="font-size:13px;margin:0">Shows up once there are a few weeks of scored calls.</p>') +
      '<p class="mut" style="font-size:12px;margin:0">Ranked by how much the score went up, so everyone has a shot. Only the top 3' + (SELF ? ' and you' : '') + ' are shown.</p></section>';
  }
  function hubWins(tok) {
    var id = hubCsrId(), cached = HUB.wins[id];
    setHub('<div id="hubw" style="display:flex;flex-direction:column;gap:16px">' + (cached ? '' : skel(40) + skel(120) + skel(260)) + '</div>');
    var paint = function (d) {
      var el = $('hubw'); if (!el || tok !== T) return;
      var tr = d.trend || [], vals = tr.filter(function (x) { return x.avg != null; }).map(function (x) { return x.avg; }), lo = Math.min.apply(null, vals.concat([70])) - 5, hi = Math.max.apply(null, vals.concat([90])) + 3;
      var X = function (i) { return 40 + i * (480 / Math.max(tr.length - 1, 1)); }, Y = function (v) { return 170 - (v - lo) / (hi - lo) * 140; };
      var pts = tr.map(function (x, i) { return x.avg == null ? null : X(i).toFixed(0) + ',' + Y(x.avg).toFixed(0); }).filter(Boolean);
      var best = vals.length ? Math.max.apply(null, vals) : null;
      var chart = '<svg viewBox="0 0 540 200" role="img" aria-label="Weekly score for the last 8 weeks" style="width:100%;height:auto">' + [lo, (lo + hi) / 2, hi].map(function (v) { return '<line x1="34" x2="530" y1="' + Y(v).toFixed(0) + '" y2="' + Y(v).toFixed(0) + '" stroke="#F1EEE8"/><text x="0" y="' + (Y(v) + 4).toFixed(0) + '" font-size="11" fill="#5F6763">' + Math.round(v) + '</text>'; }).join('') +
        (pts.length > 1 ? '<polyline fill="none" stroke="#2F7D5B" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" points="' + pts.join(' ') + '"/>' : '') +
        tr.map(function (x, i) { return (x.avg == null ? '' : '<circle cx="' + X(i).toFixed(0) + '" cy="' + Y(x.avg).toFixed(0) + '" r="' + (x.avg === best ? 6 : 4) + '" fill="' + (x.avg === best ? '#D9A520' : '#2F7D5B') + '"><title>Week of ' + x.label + ': ' + x.avg + ' (' + x.n + ' calls)</title></circle>' + (x.avg === best ? '<text x="' + X(i).toFixed(0) + '" y="' + (Y(x.avg) - 12).toFixed(0) + '" text-anchor="middle" font-size="11.5" font-weight="600" fill="#7A5410">Best ' + x.avg + '</text>' : '')) + (i % 2 === 0 || i === tr.length - 1 ? '<text x="' + X(i).toFixed(0) + '" y="194" text-anchor="middle" font-size="11" fill="#5F6763">' + x.label + '</text>' : ''); }).join('') + '</svg>';
      var h = hubHeader(d.csr.name, SELF ? 'My wins' : 'Wins · ' + d.csr.brand_short);
      h += '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px">' + d.streaks.map(function (s) { return '<div class="oq-card" style="display:flex;gap:14px;align-items:center"><div aria-hidden="true" style="width:52px;height:52px;border-radius:14px;background:#FFF4E8;display:flex;align-items:center;justify-content:center;flex-shrink:0">' + FLAME.replace('width="16" height="16"', 'width="26" height="26"') + '</div><div style="min-width:0"><div class="num" style="font-size:22px;font-weight:700">' + s.now + ' ' + esc(s.unit) + '</div><div style="font-size:13px;line-height:1.4">' + esc(s.what) + '</div><div class="mut" style="font-size:11.5px;margin-top:2px">' + (s.best > s.now ? 'Best: ' + s.best : s.now ? 'Your best ever!' : 'Start one today') + '</div></div></div>'; }).join('') + '</div>';
      h += '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px"><section class="oq-card" aria-label="Personal bests" style="display:flex;flex-direction:column;gap:12px"><h2 class="ttl" style="font-size:16px">Personal Bests</h2><div class="grid" style="grid-template-columns:1fr 1fr;gap:10px">' + d.bests.map(function (b) { return tile(esc(b.label), esc(b.value), esc(b.when)); }).join('') + '</div></section>' +
        '<section class="oq-card" aria-label="Score by week" style="display:flex;flex-direction:column;gap:8px"><div style="display:flex;justify-content:space-between;align-items:baseline"><h2 class="ttl" style="font-size:16px">Score, Week by Week</h2><span class="mut" style="font-size:12px">Last 8 weeks</span></div>' + (pts.length ? chart : '<p class="mut" style="font-size:13px">Shows up after a week of scored calls.</p>') + '</section></div>';
      h += '<section class="oq-card" aria-label="All badges" style="display:flex;flex-direction:column;gap:14px"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap"><h2 class="ttl" style="font-size:16px">Badges <span class="mut" style="font-weight:400;font-size:13px">· ' + d.earned + ' of ' + d.badges.length + ' earned</span></h2></div>' +
        '<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:12px">' + d.badges.slice().sort(function (a, b) { return (b.earned ? 1 : 0) - (a.earned ? 1 : 0); }).map(function (b) {
          return '<div style="border-radius:16px;padding:16px 12px;border:1px solid ' + (b.earned ? '#E8E4DC' : '#EEEBE4') + ';background:' + (b.earned ? '#fff' : '#FAF9F6') + ';display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px">' + badgeSvg(b.key, b.earned, 76) +
            '<div style="font-weight:700;font-size:13.5px">' + esc(b.name) + '</div><div style="font-size:12px;line-height:1.45;color:#3B4541">' + esc(b.how) + '</div>' +
            (b.earned ? '<div style="font-size:11.5px;font-weight:600;color:#1F5A41">' + esc(b.when) + '</div>' + (b.review_id ? '<div style="display:flex;flex-direction:column;align-items:center;gap:6px;margin-top:6px;width:100%"><div data-hubslot="' + b.review_id + '">' + playBtn(b.review_id, '#14302A', 'Play the call that earned ' + b.name) + '</div><div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center">' + (SELF ? '' : '<button class="more" data-call="' + b.review_id + '" style="font-size:12px">Open call</button>') + '<button class="more" data-hubtab="ask" data-hubrev="' + b.review_id + '" data-hubq="' + esc('What did I do on this call that earned the ' + b.name + ' badge?') + '" style="font-size:12px">What earned it?</button></div></div>' : '') : (b.goal > 1 ? '<div style="width:100%;margin-top:2px"><div class="track" style="height:6px"><div style="width:' + Math.round(100 * b.progress / b.goal) + '%;background:#9C968B"></div></div><div class="mut num" style="font-size:11.5px;margin-top:4px">' + b.progress + ' of ' + b.goal + '</div></div>' : '<div class="mut" style="font-size:11.5px">Not yet</div>')) + '</div>';
        }).join('') + '</div></section>';
      h += improvedCard(d.improved, d.csr.brand_short);
      el.innerHTML = h;
    };
    if (cached) paint(cached);
    api(Object.assign({ action: 'hubwins' }, hubBody())).then(function (d) { HUB.wins[id] = d; paint(d); }).catch(function (e) { var el = $('hubw'); if (el && !cached) el.innerHTML = errBox(e); });
  }

  // ----- What CSRs are asking (managers) -----
  var HQ = { days: 30, brand: LOCK || '', topic: null, csr: null, data: null, themes: {}, key: '' };
  var TOPIC_COL = { 'Pricing & fees': ['#FFF1E6', '#8A3D0C'], 'Card & payment': ['#E8F3EC', '#1F5A41'], 'Warranty': ['#EEF2FB', '#2B3A67'], 'Scheduling': ['#F1ECFB', '#52308F'], 'Objections': ['#FDECEC', '#A61B1B'], 'Commercial': ['#EAF4F6', '#1E5F6B'], 'Products & repairs': ['#F6F1E3', '#6B5410'], 'My score': ['#F3F1EC', '#3B4541'], 'How-to & process': ['#F3F1EC', '#56605B'], 'Other': ['#F3F1EC', '#56605B'] };
  function tpill(t) { var c = TOPIC_COL[t] || TOPIC_COL.Other; return '<span class="pill" style="background:' + c[0] + ';color:' + c[1] + '">' + esc(t) + '</span>'; }
  function vHubQs(tok) {
    if (SELF) { S.view = 'hub'; return vHub(tok); }
    if (!LOCK) HQ.brand = S.brands.length === 1 ? S.brands[0] : (S.brands.length ? HQ.brand : '');
    var key = [HQ.days, HQ.brand, HQ.csr || ''].join('|');
    setHub('<div class="oq-crumb"><button data-hubroster="1">Coaching Hub</button><span aria-hidden="true">/</span><span style="color:var(--ink);font-weight:600">What CSRs are asking</span></div><div id="hubqs" style="display:flex;flex-direction:column;gap:16px">' + (HQ.data && HQ.key === key ? '' : skel(50) + skel(200)) + '</div>');
    if (HQ.data && HQ.key === key) paintQs(tok);
    var brands = HUB.roster ? Promise.resolve(HUB.roster) : api({ action: 'hubroster' }).then(function (r) { HUB.roster = r; return r; });
    Promise.all([api({ action: 'hubquestions', days: HQ.days, brand: HQ.brand || null, csr: HQ.csr }), brands.catch(function () { return null; })])
      .then(function (r) { if (tok !== T) return; HQ.data = r[0]; HQ.key = key; paintQs(tok); })
      .catch(function (e) { var el = $('hubqs'); if (el && tok === T) el.innerHTML = errBox(e); });
  }
  function paintQs(tok) {
    var el = $('hubqs'), D = HQ.data; if (!el || !D) return;
    var bl = {}; ((HUB.roster && HUB.roster.rows) || []).forEach(function (r) { bl[r.brand] = r.brand_short; });
    var csrName = HQ.csr ? ((D.csrs || []).filter(function (c) { return c.id === HQ.csr; })[0] || {}).name || 'this CSR' : null;
    var rows = (D.rows || []).filter(function (r) { return !HQ.topic || r.topic === HQ.topic; });
    var h = '<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap"><div><h1 style="margin:0;font-size:24px;font-weight:600;letter-spacing:-0.02em">What CSRs are asking</h1><p class="sub">Every question asked in Ask my coach' + (csrName ? ' by <b>' + esc(csrName) + '</b> <button class="more" data-hubqclear="1">· show everyone</button>' : '') + '. Use it to spot where people are stuck and what the playbook is missing.</p></div>' +
      '<div class="row" style="gap:8px;align-items:center">' + (LOCK ? '' : '<label class="sr" for="hubqb">Brand</label><select id="hubqb" class="oq-field" data-hubqbrand="1" style="min-width:170px"><option value="">All brands</option>' + Object.keys(bl).sort().map(function (b) { return '<option value="' + esc(b) + '"' + (HQ.brand === b ? ' selected' : '') + '>' + esc(bl[b]) + '</option>'; }).join('') + '</select>') +
      '<div class="seg" role="group" aria-label="Period" style="display:flex">' + [7, 30, 90].map(function (n) { return '<button class="' + (HQ.days === n ? 'on' : '') + '" data-hubqdays="' + n + '" style="padding:0 12px;white-space:nowrap">' + n + ' days</button>'; }).join('') + '</div></div></div>';
    if (!D.total && !(D.flags || []).length) { el.innerHTML = h + '<div class="oq-card"><b>No questions yet</b><p class="sub">Once CSRs start using Ask my coach, their questions show up here with the topics they struggle with most.</p></div>'; return; }
    var maxT = Math.max.apply(null, (D.topics || []).map(function (t) { return t.n; }).concat([1]));
    h += '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px">' +
      '<section class="oq-card" aria-label="Where CSRs are struggling" style="grid-column:span 2;display:flex;flex-direction:column;gap:8px"><div style="display:flex;align-items:center;gap:8px">' + SPARK + '<h2 class="ttl" style="font-size:16px">Where CSRs are struggling</h2><span class="mut" style="font-size:12px;margin-left:auto">' + D.total + ' questions' + (D.from_csrs < D.total ? ' · ' + D.from_csrs + ' from CSRs' : '') + '</span></div><div id="hubqthemes" class="md" style="font-size:13.5px;line-height:1.6">' + themesInner() + '</div></section>' +
      '<section class="oq-card" aria-label="Topics" style="display:flex;flex-direction:column;gap:8px"><h2 class="ttl" style="font-size:16px">Topics</h2>' + (D.topics || []).map(function (t) { var c = TOPIC_COL[t.k] || TOPIC_COL.Other, on = HQ.topic === t.k; return '<button data-hubqtopic="' + esc(t.k) + '" style="all:unset;cursor:pointer;display:block;padding:6px 8px;border-radius:10px;' + (on ? 'background:#F3F8F5;outline:1.5px solid #2F7D5B' : '') + '"><span style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px"><span>' + esc(t.k) + '</span><b class="num">' + t.n + '</b></span><span class="track" style="display:block;height:6px"><span style="display:block;height:100%;border-radius:99px;width:' + Math.round(100 * t.n / maxT) + '%;background:' + c[1] + '"></span></span></button>'; }).join('') + '</section></div>';
    if ((D.flags || []).length) h += '<section class="oq-card" aria-label="Playbook gaps" style="display:flex;flex-direction:column;gap:10px"><div><h2 class="ttl" style="font-size:16px">Playbook Gaps CSRs Flagged</h2><p class="sub">Questions the coach couldn’t answer from your playbook. ' + (IS_ADMIN ? 'Add the answer once and every CSR gets it.' : 'Your account admin can add these to the knowledge base.') + '</p></div>' +
      D.flags.map(function (f) { return '<div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;padding:10px 12px;border-radius:12px;background:#FFF8F1;border:1px solid #F6DCC4"><div style="flex:1;min-width:220px"><div style="font-size:13.5px;line-height:1.5">“' + esc(f.why) + '”</div><div class="mut" style="font-size:12px;margin-top:4px">' + esc(f.csr || 'A CSR') + ' · ' + esc(f.brand_short || '') + ' · ' + fwhen(f.at) + '</div></div><div class="row" style="gap:8px">' + (IS_ADMIN ? '<button class="sel btnd" data-hubqkb="' + f.id + '">Add to knowledge base</button>' : '') + '<button class="sel" data-hubqdismiss="' + f.id + '">Dismiss</button></div></div>'; }).join('') + '</section>';
    h += '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px"><section class="oq-card" aria-label="Questions" style="grid-column:span 2;display:flex;flex-direction:column;gap:4px"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:6px"><h2 class="ttl" style="font-size:16px">Questions' + (HQ.topic ? ' about ' + esc(HQ.topic) : '') + '</h2>' + (HQ.topic ? '<button class="more" data-hubqtopic="' + esc(HQ.topic) + '">Clear topic</button>' : '') + '</div>' +
      (rows.length ? rows.map(function (r) { return '<details style="border-top:1px solid var(--line2);padding:10px 0"><summary style="cursor:pointer;list-style:none;display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap"><span style="flex:1;min-width:220px;font-size:13.5px;line-height:1.5"><b style="font-weight:600">' + esc(r.question) + '</b><span class="mut" style="display:block;font-size:12px;margin-top:2px">' + esc(r.csr) + ' · ' + esc(r.brand_short) + ' · ' + fwhen(r.at) + ' · ' + (r.mode === 'brand' ? 'How we do it' : 'My scores') + (r.by_manager ? ' · asked by a manager' : '') + '</span></span>' + tpill(r.topic) + '</summary>' +
        '<div class="md" style="margin-top:8px;background:#F7F6F2;border:1px solid #EEEBE4;border-radius:12px;padding:10px 14px;font-size:13px;line-height:1.55">' + md(r.answer || '') + '</div><div class="row" style="gap:12px;margin-top:6px"><button class="more" data-hubcsr="' + r.csr_id + '">Open ' + esc(r.csr.split(' ')[0]) + '’s hub</button>' + (r.review_id ? '<button class="more" data-call="' + r.review_id + '">Open the call</button>' : '') + '</div></details>'; }).join('') : '<p class="mut" style="font-size:13px">No questions match.</p>') + '</section>' +
      '<section class="oq-card" aria-label="Who is asking" style="display:flex;flex-direction:column;gap:6px"><h2 class="ttl" style="font-size:16px">Who’s asking</h2><p class="sub" style="margin:0 0 4px">Asking is good. A CSR with lots of questions is engaged, or may need a coaching session.</p>' + (D.csrs || []).map(function (c) { return '<button data-hubqcsr="' + c.id + '" style="all:unset;cursor:pointer;display:flex;justify-content:space-between;padding:8px 10px;border-radius:10px;' + (HQ.csr === c.id ? 'background:#F3F8F5' : '') + '"><span>' + esc(c.name) + '</span><b class="num">' + c.n + '</b></button>'; }).join('') + '</section></div>';
    el.innerHTML = h;
    loadThemes(tok);
  }
  function themesInner() { var k = HQ.key, t = HQ.themes[k]; if (!t || t.busy) return '<div style="display:flex;gap:8px;align-items:center"><span class="dots"><span></span><span></span><span></span></span><span class="mut" style="font-size:12.5px">Reading the questions…</span></div>'; if (t.err) return '<span class="mut">' + esc(t.err) + '</span>'; return md(t.answer || ''); }
  function loadThemes(tok) {
    var k = HQ.key; if (HQ.themes[k] || !HQ.data || !HQ.data.total) { if (HQ.data && !HQ.data.total) { var e0 = $('hubqthemes'); if (e0) e0.innerHTML = '<span class="mut">No questions in this period yet.</span>'; } return; }
    HQ.themes[k] = { busy: true };
    api({ action: 'hubquestions', op: 'themes', days: HQ.days, brand: HQ.brand || null, csr: HQ.csr }).then(function (r) { HQ.themes[k] = { answer: r.answer }; }).catch(function (e) { HQ.themes[k] = { err: e.message || 'Couldn’t summarize right now.' }; })
      .then(function () { var el = $('hubqthemes'); if (el && HQ.key === k) el.innerHTML = themesInner(); });
  }
  function kbModal(flag) {
    HUB.modal = { kind: 'kbadd', flag: flag.id };
    hubModal('Add to the knowledge base', '<p class="sub" style="margin:0">' + esc(flag.csr || 'A CSR') + ' asked: “' + esc(flag.why) + '”. Write the answer the way you’d explain it to a new CSR. The coach uses it right away, and so does call scoring.</p>' +
      '<div><label class="l" for="hubkt">Title</label><input id="hubkt" class="oq-field" maxlength="200" value="' + esc(String(flag.why).slice(0, 80)) + '"></div>' +
      '<div><label class="l" for="hubkc">Category</label><select id="hubkc" class="oq-field">' + ['Pricing', 'Policy', 'Coverage', 'Troubleshooting', 'Scheduling', 'Products', 'Staff & routing'].map(function (c) { return '<option>' + c + '</option>'; }).join('') + '</select></div>' +
      '<div><label class="l" for="hubkbody">Answer</label><textarea id="hubkbody" class="oq-field" maxlength="8000" style="min-height:140px" placeholder="e.g. Warranty calls within 1 year of install have no trip charge…"></textarea></div>', 'Add to knowledge base');
  }

  // ----- Ask my coach -----
  function chatState() { var id = hubCsrId(); return HUB.chat[id] = HUB.chat[id] || { mode: 'score', msgs: [], busy: false, review: null }; }
  function hubAsk() {
    var C0 = chatState(), d = HUB.home[hubCsrId()] && HUB.home[hubCsrId()].data, bs = (d && d.csr.brand_short) || (LOCK ? short(LOCK) : 'your brand'), nm = (d && d.csr.name) || '';
    var topics = C0.mode === 'score' ? ['Why did my last low call score that way?', 'What should I work on most?', 'What does “Collect info” mean?', 'How do I earn the Closer badge?', 'How is my score worked out?'] : ['Customer wants a price over the phone', 'How do we handle warranty calls?', 'What do I say when they want to think about it?', 'Commercial or business callers', 'Taking a card on file'];
    var h = hubHeader(SELF ? 'Ask my coach' : nm, SELF ? 'Private to you' : 'Ask on ' + (d ? d.csr.first : 'their') + '’s behalf');
    h += '<div style="display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start"><div style="flex:1 1 260px;max-width:100%;display:flex;flex-direction:column;gap:14px">' +
      '<div class="oq-card" style="display:flex;flex-direction:column;gap:12px"><span class="cap">What do you need?</span><div class="seg" role="group" aria-label="Question type" style="display:flex">' +
      '<button class="' + (C0.mode === 'score' ? 'on' : '') + '" data-hubmode="score" aria-pressed="' + (C0.mode === 'score') + '" style="flex:1;white-space:nowrap;padding:0 8px">My scores</button><button class="' + (C0.mode === 'brand' ? 'on' : '') + '" data-hubmode="brand" aria-pressed="' + (C0.mode === 'brand') + '" style="flex:1;white-space:nowrap;padding:0 8px">How we do it</button></div>' +
      '<p class="sub" style="margin:0">' + (C0.mode === 'score' ? 'Ask why any call scored the way it did. The coach reads the call and explains it step by step.' : 'Ask how ' + esc(bs) + ' handles something. Answers come from the ' + esc(bs) + ' playbook and its best calls.') + '</p></div>' +
      '<div class="oq-card" style="display:flex;flex-direction:column;gap:8px"><span class="cap" style="margin-bottom:4px">' + (C0.mode === 'score' ? 'Common questions' : esc(bs) + ' playbook') + '</span>' + topics.map(function (q) { return '<button class="sel" data-hubq="' + esc(q) + '" style="justify-content:space-between;white-space:normal;text-align:left">' + esc(q) + '<span aria-hidden="true">›</span></button>'; }).join('') + '</div></div>' +
      '<section class="oq-card" aria-label="Chat" style="flex:999 1 520px;min-width:0;display:flex;flex-direction:column;gap:14px;padding:22px"><div style="display:flex;align-items:center;gap:10px">' + SPARK + '<h2 class="ttl">Ask my coach</h2>' + (C0.msgs.length ? '<button class="more" data-hubclear="1" style="margin-left:auto">Start over</button>' : '') + '</div>' +
      (C0.review ? '<div class="pill" style="align-self:flex-start;background:#EEF2FB;color:#2B3A67">About one call · <button class="more" data-hubnorev="1" style="min-height:0;font-size:12px">clear</button></div>' : '') +
      '<div id="hubthread" aria-live="polite" style="display:flex;flex-direction:column;gap:12px">' + chatInner(C0, bs) + '</div>' +
      '<form id="hubchat" style="display:flex;gap:8px"><label class="sr" for="hubci">Ask a question</label><input id="hubci" class="oq-field" type="text" autocomplete="off" maxlength="600" style="flex:1;min-width:0;min-height:48px;position:relative;z-index:2;pointer-events:auto" placeholder="' + (C0.mode === 'score' ? (C0.msgs.length ? 'Ask a follow-up…' : 'e.g. Why did my call on Tuesday score 62?') : 'Ask how ' + esc(bs) + ' handles something…') + '"><button class="sel btnd" type="submit"' + (C0.busy ? ' disabled' : '') + '>Ask</button></form></section></div>';
    setHub(h);
    var q = HUB.pendingQ; HUB.pendingQ = null; if (q) chatAsk(q);
  }
  function chatInner(C0, bs) {
    if (!C0.msgs.length) return '<p class="mut" style="font-size:13px;margin:0">' + (C0.mode === 'score' ? 'Pick a question on the left or type your own. Your coach can see your scored calls from the last 30 days.' : 'Ask anything about how ' + esc(bs) + ' does things on the phone: prices, warranty, scheduling, what to say.') + '</p>';
    var out = C0.msgs.map(function (m) {
      return m.role === 'user' ? '<div style="align-self:flex-end;max-width:82%;background:var(--side);color:#fff;border-radius:14px 14px 4px 14px;padding:11px 14px;font-size:14px;line-height:1.5">' + esc(m.content) + '</div>'
        : '<div class="md" style="max-width:90%;background:#F7F6F2;border:1px solid #EEEBE4;border-radius:14px 14px 14px 4px;padding:12px 16px;font-size:14px;line-height:1.6' + (m.error ? ';color:#A8441A' : '') + '">' + (m.error ? esc(m.content) : md(m.content)) + '</div>';
    }).join('');
    if (C0.busy) out += '<div style="display:flex;gap:8px;align-items:center"><span class="dots"><span></span><span></span><span></span></span><span class="mut" style="font-size:12.5px">' + (C0.mode === 'score' ? 'Reading your calls…' : 'Checking the playbook…') + '</span></div>';
    else if (SELF) out += '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;border-top:1px solid var(--line2);padding-top:12px"><span class="mut" style="font-size:12.5px">' + (C0.mode === 'score' ? 'Still think a score is wrong?' : 'Not covered or not right?') + '</span><button class="sel" data-hubact="' + (C0.mode === 'score' ? 'review' : 'flag') + '">' + (C0.mode === 'score' ? 'Ask my manager to review it' : 'Flag for my supervisor') + '</button></div>';
    return out;
  }
  function chatPaint() { var C0 = chatState(), el = $('hubthread'); if (!el) return; var d = HUB.home[hubCsrId()] && HUB.home[hubCsrId()].data; el.innerHTML = chatInner(C0, (d && d.csr.brand_short) || 'your brand'); var b = document.querySelector('#hubchat button'); if (b) b.disabled = !!C0.busy; if (el.lastElementChild) el.lastElementChild.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  function chatAsk(q) {
    var C0 = chatState(); q = String(q || '').trim(); if (!q || C0.busy) return;
    var hist = C0.msgs.filter(function (m) { return !m.error; }).slice(-10).map(function (m) { return { role: m.role, content: m.content }; });
    C0.msgs.push({ role: 'user', content: q }); C0.busy = true; var inp = $('hubci'); if (inp) inp.value = ''; chatPaint();
    api(Object.assign({ action: 'hubask', mode: C0.mode, question: q, history: hist, review_id: C0.review }, hubBody()))
      .then(function (r) { C0.msgs.push({ role: 'assistant', content: r.answer || '' }); })
      .catch(function (e) { C0.msgs.push({ role: 'assistant', content: (e && e.message) || 'Something went wrong. Try again.', error: true }); })
      .then(function () { C0.busy = false; chatPaint(); var i2 = $('hubci'); if (i2) i2.focus(); });
  }

  // ----- modals (kudos, focus, call of the week, review request) -----
  function hubModal(title, inner, okLabel) {
    var L = document.createElement('div');
    L.innerHTML = '<div class="overlay" id="hubm" style="justify-content:center;align-items:center;z-index:70"><div class="oq-card" role="dialog" aria-modal="true" aria-label="' + esc(title) + '" style="width:540px;max-width:calc(100% - 32px);max-height:calc(100vh - 40px);overflow:auto;padding:22px;display:flex;flex-direction:column;gap:14px"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><h2 class="ttl">' + esc(title) + '</h2><button class="sel" data-hubmclose="1" aria-label="Close" style="width:44px;justify-content:center">✕</button></div>' + inner +
      '<div class="row" style="gap:8px"><button class="sel btnd" data-hubmok="1">' + esc(okLabel) + '</button><button class="sel" data-hubmclose="1">Cancel</button></div></div></div>';
    ROOT.appendChild(L.firstChild);
  }
  var KTAGS = ['Great save', 'Nailed the booking', 'Textbook greeting', 'So patient', 'Great listening'];
  function kudosModal(csr, review) {
    HUB.modal = { kind: 'kudos', csr: csr.id, review: review || null, tag: null };
    var picks = (HUB.home[csr.id] && HUB.home[csr.id].data && HUB.home[csr.id].data.picks) || [];
    hubModal('Send ' + csr.first + ' kudos', '<div><div class="cap" style="margin-bottom:8px">Quick picks</div><div style="display:flex;flex-wrap:wrap;gap:8px">' + KTAGS.map(function (t) { return '<button class="chip" data-hubktag="' + esc(t) + '">' + esc(t) + '</button>'; }).join('') + '</div></div>' +
      '<div><label class="l" for="hubkb">Add a note (optional)</label><textarea id="hubkb" class="oq-field" maxlength="600" style="min-height:80px;resize:vertical" placeholder="What did they do well?"></textarea></div>' +
      (review ? '<label style="display:flex;gap:10px;align-items:center;font-size:13px"><input type="checkbox" id="hubknom" style="width:18px;height:18px"> Nominate this call for ' + esc(csr.brand_short || 'the brand') + ' call of the week</label>'
        : (picks.filter(function (p) { return p.kind === 'good'; }).length ? '<div><label class="l" for="hubkrev">About a call (optional)</label><select id="hubkrev" class="oq-field"><option value="">No specific call</option>' + picks.filter(function (p) { return p.kind === 'good'; }).map(function (p) { return '<option value="' + p.review_id + '">' + esc(p.title + ' · ' + fwhen(p.date)) + '</option>'; }).join('') + '</select></div>' : '')) +
      '<p class="mut" style="font-size:12px;margin:0">' + esc(csr.first) + ' sees it on their Coaching Hub home page.</p>', 'Send kudos');
  }
  function focusModal(d) {
    HUB.modal = { kind: 'focus', csr: d.csr.id, pick: null };
    var o = d.focus_options || [];
    hubModal('Set ' + d.csr.first + '’s focus for this week', '<p class="sub" style="margin:0">Sorted by what ' + esc(d.csr.first) + ' missed most over the last two weeks.</p>' +
      o.map(function (x, i) { return '<label style="display:flex;gap:10px;align-items:flex-start;padding:12px;border-radius:12px;border:1px solid #EEEBE4;background:#FAF9F6;cursor:pointer"><input type="radio" name="hubfo" value="' + i + '" style="margin-top:3px;width:18px;height:18px"><span><b style="font-weight:600">' + esc(x.title) + '</b><span class="mut" style="display:block;font-size:12px;margin-top:2px">' + esc(x.label) + (x.of ? ' · done on ' + x.done + ' of ' + x.of + ' calls (' + x.pct + '%)' : ' · not enough calls yet') + '</span></span></label>'; }).join('') +
      '<label style="display:flex;gap:10px;align-items:center;padding:12px;border-radius:12px;border:1px solid #EEEBE4;background:#FAF9F6;cursor:pointer"><input type="radio" name="hubfo" value="custom" style="width:18px;height:18px"><b style="font-weight:600">Write my own</b></label>' +
      '<div><label class="l" for="hubft">Focus</label><input id="hubft" class="oq-field" maxlength="140" value="' + esc((d.focus && d.focus.title) || '') + '"></div>' +
      '<div><label class="l" for="hubfs">Line to try saying</label><textarea id="hubfs" class="oq-field" maxlength="400" style="min-height:60px">' + esc(sayFill((d.focus && d.focus.say) || '')) + '</textarea></div>' +
      '<div><label class="l" for="hubfb">Why it matters (optional)</label><textarea id="hubfb" class="oq-field" maxlength="600" style="min-height:60px">' + esc((d.focus && !d.focus.auto && d.focus.body) || '') + '</textarea></div>' +
      '<div><label class="l" for="hubfg">Goal: % of calls</label><input id="hubfg" class="oq-field" type="number" min="10" max="100" value="' + ((d.focus && d.focus.goal_pct) || 80) + '" style="max-width:120px"></div>', 'Save focus');
    HUB.modal.opts = o;
  }
  function cotwModal(d) {
    HUB.modal = { kind: 'cotw', brand: d.csr.brand };
    hubModal(d.csr.brand_short + ' call of the week', '<p class="sub" style="margin:0">The best booked calls from last week. Nominated calls are listed first.</p><div id="hubco">' + skel(60, 3) + '</div>', 'Make it call of the week');
    api({ action: 'hubcotw', op: 'options', brand: d.csr.brand }).then(function (r) {
      var el = $('hubco'); if (!el) return; var o = r.options || [];
      el.innerHTML = o.length ? o.map(function (x, i) { return '<label style="display:flex;gap:10px;align-items:flex-start;padding:12px;border-radius:12px;border:1px solid #EEEBE4;background:#FAF9F6;cursor:pointer;margin-bottom:8px"><input type="radio" name="hubcw" value="' + x.review_id + '"' + (i ? '' : ' checked') + ' style="margin-top:3px;width:18px;height:18px"><span style="min-width:0"><b style="font-weight:600">' + esc(x.agent) + '</b> <span class="mut" style="font-size:12px">· ' + esc(x.title) + ' · ' + fsecs(x.secs) + ' · score ' + x.score + (x.nominated ? ' · ♥ nominated' : '') + '</span><span style="display:block;font-size:12.5px;line-height:1.45;margin-top:4px;color:#3B4541">' + esc(x.why || '') + '</span></span></label>'; }).join('') : '<p class="mut">No booked calls from last week qualify yet.</p>';
    }).catch(function (e) { var el = $('hubco'); if (el) el.innerHTML = errBox(e); });
  }
  function reqModal(kind) {
    var C0 = chatState();
    HUB.modal = { kind: kind, review: C0.review };
    hubModal(kind === 'review' ? 'Ask my manager to review it' : 'Flag for my supervisor', '<div><label class="l" for="hubrw">' + (kind === 'review' ? 'Which call, and what do you think was scored wrong?' : 'What should the playbook cover?') + '</label><textarea id="hubrw" class="oq-field" maxlength="1000" style="min-height:90px">' + esc(C0.msgs.filter(function (m) { return m.role === 'user'; }).slice(-1).map(function (m) { return m.content; })[0] || '') + '</textarea></div>', 'Send');
  }
  function peopleModal(brand) {
    HUB.modal = { kind: 'people', brand: brand };
    hubModal('CSRs at ' + short(brand), '<p class="sub" style="margin:0">Everyone listed gets a Coaching Hub. Remove anyone who doesn’t take customer calls (techs, sales, managers). Add people from the phone system below.</p><div id="hubpl">' + skel(40, 4) + '</div>', 'Done');
    paintPeople();
  }
  function paintPeople() {
    var M = HUB.modal; if (!M || M.kind !== 'people') return; var el = $('hubpl'); if (!el) return;
    var cur = ((HUB.roster && HUB.roster.rows) || []).filter(function (r) { return r.brand === M.brand; });
    var row = function (l, r) { return '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line2)">' + l + r + '</div>'; };
    var h = '<div class="cap" style="margin:6px 0 4px">In the Coaching Hub (' + cur.length + ')</div>' + (cur.length ? cur.map(function (r) { return row('<span><b style="font-weight:600">' + esc(r.name) + '</b>' + (r.has_login ? ' <span class="pill" style="background:#E6F0EA;color:#1F5A41">Has login</span>' : '') + '</span>', '<button class="more" data-hubprem="' + r.id + '">Remove</button>'); }).join('') : '<p class="mut" style="font-size:13px">Nobody yet.</p>');
    h += '<div class="cap" style="margin:14px 0 4px">Others who took calls (last 45 days)</div>';
    if (!M.cands) h += skel(30, 3);
    else if (!M.cands.length) h += '<p class="mut" style="font-size:13px">No one else took enough calls to add.</p>';
    else h += M.cands.map(function (c) { return row('<span>' + esc(c.name) + ' <span class="mut" style="font-size:12px">· ' + c.calls + ' calls' + (c.removed ? ' · removed earlier' : '') + '</span></span>', '<button class="more" data-hubpadd="' + esc(c.ls_user_id) + '">Add</button>'); }).join('');
    el.innerHTML = h;
    if (!M.cands && !M.loading) { M.loading = true; api({ action: 'hubpeople', brand: M.brand }).then(function (r) { M.cands = r.candidates || []; M.loading = false; paintPeople(); }).catch(function (e) { M.cands = []; M.loading = false; toast(e.message || 'Couldn’t load people'); paintPeople(); }); }
  }
  function peopleChange(body, btn) {
    btn.disabled = true; var M = HUB.modal;
    api(Object.assign({ action: 'hubpeople', brand: M.brand }, body)).then(function () { return api({ action: 'hubroster' }); }).then(function (r) { HUB.roster = r; M.cands = null; paintPeople(); toast(body.op === 'add' ? 'Added to the Coaching Hub' : 'Removed from the Coaching Hub'); })
      .catch(function (e) { btn.disabled = false; toast(e.message || 'Couldn’t update the list'); });
  }
  function modalOk(btn) {
    var M = HUB.modal; if (!M) return; var close = function () { var m = $('hubm'); if (m) m.remove(); HUB.modal = null; };
    var done = function (msg, reload) { close(); toast(msg); if (reload) { delete HUB.wins[hubCsrId()]; render(); } };
    var fail = function (e) { btn.disabled = false; toast((e && e.message) || 'Couldn’t save that.'); };
    btn.disabled = true;
    if (M.kind === 'people') { close(); if (S.view === 'hub' && !S.hubCsr) render(); return; }
    if (M.kind === 'kbadd') {
      var kt = ($('hubkt').value || '').trim(), kb = ($('hubkbody').value || '').trim(); if (!kt || !kb) { btn.disabled = false; toast('Add a title and the answer'); return; }
      api({ action: 'kb', op: 'add', title: kt, category: $('hubkc').value, body: kb }).then(function () { return api({ action: 'hubquestions', op: 'flagdone', req: M.flag, added: true }); })
        .then(function () { HQ.data = null; done('Added to the knowledge base. The coach uses it from now on.'); if (S.view === 'hubqs') render(); }).catch(fail);
      return;
    }
    if (M.kind === 'kudos') {
      var body = ($('hubkb') || {}).value || '', rv = M.review || (($('hubkrev') || {}).value || null);
      if (!M.tag && !body.trim()) { btn.disabled = false; toast('Pick a quick note or write one'); return; }
      api({ action: 'hubkudos', csr: M.csr, tag: M.tag, body: body.trim() || null, review_id: rv, nominate: !!($('hubknom') && $('hubknom').checked) }).then(function () { done('Kudos sent', S.view === 'hub'); }).catch(fail);
    } else if (M.kind === 'focus') {
      var sel = document.querySelector('input[name="hubfo"]:checked'), o = sel && sel.value !== 'custom' ? M.opts[+sel.value] : null;
      var title = ($('hubft').value || '').trim(); if (!title) { btn.disabled = false; toast('Add a focus'); return; }
      api({ action: 'hubfocus', op: 'set', csr: M.csr, step_key: o ? o.step_key : null, title: title, say: ($('hubfs').value || '').trim() || null, body: ($('hubfb').value || '').trim() || null, goal_pct: +$('hubfg').value || 80 }).then(function () { done('Focus saved. ' + 'They’ll see it on their home page.', true); }).catch(fail);
    } else if (M.kind === 'cotw') {
      var c = document.querySelector('input[name="hubcw"]:checked'); if (!c) { btn.disabled = false; return; }
      api({ action: 'hubcotw', op: 'set', brand: M.brand, review_id: c.value }).then(function () { done('Call of the week updated', true); }).catch(fail);
    } else {
      var w = ($('hubrw').value || '').trim(); if (!w) { btn.disabled = false; toast('Add a short note'); return; }
      api({ action: 'hubreq', op: M.kind === 'flag' ? 'flag' : 'create', why: w, review_id: M.review }).then(function (r) { done(r.sent_to ? 'Sent to your manager' : 'Sent. Your manager will see it.'); }).catch(fail);
    }
  }

  // ----- events -----
  on(document, 'submit', function (e) {
    if (e.target.id === 'hubqf') { e.preventDefault(); var q = $('hubqi').value.trim(); if (!q) return; var C0 = chatState(); C0.mode = /price|warrant|policy|how do we|what do i say|handle/i.test(q) ? 'brand' : 'score'; HUB.pendingQ = q; hubGoTab('ask'); }
    else if (e.target.id === 'hubchat') { e.preventDefault(); chatAsk($('hubci').value); }
  });
  // Rob (10/23) could click the Ask box but not type. Clicking anywhere on the Ask card focuses the input, and the
  // input never sits under another layer.
  on(document, 'mousedown', function (e) { var c = e.target.closest && e.target.closest('#hubqf,#hubchat'); if (!c) return; var i = c.querySelector('input'); if (i && e.target !== i && !e.target.closest('button')) { e.preventDefault(); i.focus(); } });
  function hubGoTab(t) { HUB.tab = t; if (SELF) go(t === 'ask' ? 'hubask' : t === 'wins' ? 'hubwins' : 'hub'); else { window.scrollTo(0, 0); render(); } }
  on(document, 'click', function (e) {
    var t = e.target, x;
    if (t.closest('[data-go="hub"]') && !SELF) { S.hubCsr = null; }
    if ($('hubm')) {
      var kt = t.closest('[data-hubktag]'); if (kt) { HUB.modal.tag = HUB.modal.tag === kt.getAttribute('data-hubktag') ? null : kt.getAttribute('data-hubktag'); document.querySelectorAll('[data-hubktag]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-hubktag') === HUB.modal.tag); }); return; }
      var pa = t.closest('[data-hubpadd]'); if (pa) { peopleChange({ op: 'add', ls_user_id: pa.getAttribute('data-hubpadd') }, pa); return; }
      var pr = t.closest('[data-hubprem]'); if (pr) { peopleChange({ op: 'remove', id: pr.getAttribute('data-hubprem') }, pr); return; }
      var fo = t.closest('input[name="hubfo"]'); if (fo && fo.value !== 'custom') { var o = HUB.modal.opts[+fo.value]; $('hubft').value = o.title; $('hubfs').value = sayFill(o.say); return; }
      if (t.closest('[data-hubmok]')) { modalOk(t.closest('[data-hubmok]')); return; }
      if (t.closest('[data-hubmclose]') || t.id === 'hubm') { $('hubm').remove(); HUB.modal = null; return; }
      return;
    }
    if ((x = t.closest('[data-hubcsr]'))) { S.hubCsr = x.getAttribute('data-hubcsr'); HUB.tab = 'home'; go('hub'); return; }
    if (t.closest('[data-hubroster]')) { S.hubCsr = null; go('hub'); return; }
    if ((x = t.closest('[data-hubpeople]'))) { peopleModal(x.getAttribute('data-hubpeople')); return; }
    if ((x = t.closest('[data-hubqdays]'))) { HQ.days = +x.getAttribute('data-hubqdays'); render(); return; }
    if ((x = t.closest('[data-hubqtopic]'))) { var tk = x.getAttribute('data-hubqtopic'); HQ.topic = HQ.topic === tk ? null : tk; paintQs(T); return; }
    if ((x = t.closest('[data-hubqcsr]'))) { HQ.csr = HQ.csr === x.getAttribute('data-hubqcsr') ? null : x.getAttribute('data-hubqcsr'); HQ.topic = null; if (S.view === 'hubqs') render(); else go('hubqs'); return; }
    if (t.closest('[data-hubweekreset]')) { HUB.week = ''; HUB.home = {}; HUB.wins = {}; HUB.roster = null; render(); return; }
    if (t.closest('[data-hubqclear]')) { HQ.csr = null; render(); return; }
    if ((x = t.closest('[data-hubqkb]'))) { var fid = +x.getAttribute('data-hubqkb'), fg = ((HQ.data && HQ.data.flags) || []).filter(function (f) { return f.id === fid; })[0]; if (fg) kbModal(fg); return; }
    if ((x = t.closest('[data-hubqdismiss]'))) { x.disabled = true; api({ action: 'hubquestions', op: 'flagdone', req: +x.getAttribute('data-hubqdismiss') }).then(function () { HQ.data = null; toast('Dismissed'); render(); }).catch(function (e6) { x.disabled = false; toast(e6.message || 'Couldn’t update.'); }); return; }
    if ((x = t.closest('[data-hubtab]'))) {
      var C1 = chatState();
      if (x.hasAttribute('data-hubrev')) { if (C1.review !== x.getAttribute('data-hubrev')) C1.msgs = []; C1.review = x.getAttribute('data-hubrev'); C1.mode = 'score'; }
      if (x.hasAttribute('data-hubmode')) C1.mode = x.getAttribute('data-hubmode');
      if (x.hasAttribute('data-hubq')) HUB.pendingQ = x.getAttribute('data-hubq');
      hubGoTab(x.getAttribute('data-hubtab')); return;
    }
    if ((x = t.closest('[data-hubmode]'))) { var C2 = chatState(); if (C2.mode !== x.getAttribute('data-hubmode')) { C2.mode = x.getAttribute('data-hubmode'); C2.msgs = []; C2.review = null; } hubAsk(); return; }
    if ((x = t.closest('[data-hubq]'))) { chatAsk(x.getAttribute('data-hubq')); return; }
    if (t.closest('[data-hubclear]')) { var C3 = chatState(); C3.msgs = []; C3.review = null; hubAsk(); return; }
    if (t.closest('[data-hubnorev]')) { chatState().review = null; hubAsk(); return; }
    if (t.closest('[data-hubgood]')) { var g = $('hubgood0'); if (g) { g.scrollIntoView({ block: 'center', behavior: 'smooth' }); var pb = g.querySelector('[data-hubplay]'); if (pb) pb.click(); } else toast('No great-call example yet this week'); return; }
    if ((x = t.closest('[data-hubat]'))) { // jump to the focus moment (2026-10-27)
      var pa = x.getAttribute('data-hubat').split('|'), rid0 = pa[0], at0 = +pa[1] || 0, au = document.querySelector('[data-hubslot="' + rid0 + '"] audio');
      if (au) { try { au.currentTime = Math.max(0, at0 - 2); au.play(); } catch (z) {} return; }
      HUB.audio[rid0] = HUB.audio[rid0] && HUB.audio[rid0].url ? Object.assign(HUB.audio[rid0], { at: at0 }) : HUB.audio[rid0];
      HUB.pendingAt = HUB.pendingAt || {}; HUB.pendingAt[rid0] = at0;
      var pb0 = document.querySelector('[data-hubslot="' + rid0 + '"] [data-hubplay]'); if (pb0) pb0.click(); return;
    }
    if ((x = t.closest('[data-hubplay]'))) {
      var rid = x.getAttribute('data-hubplay'); if (HUB.audio[rid] && HUB.audio[rid].busy) return;
      HUB.audio[rid] = { busy: true }; var slot = function () { document.querySelectorAll('[data-hubslot="' + rid + '"]').forEach(function (s) { s.innerHTML = playBtn(rid, s.querySelector('[data-hubplay]') ? s.querySelector('[data-hubplay]').style.background : '#14302A'); }); };
      slot();
      api({ action: 'hubaudio', id: rid }).then(function (r) { if (!r || !r.url) { delete HUB.audio[rid]; slot(); toast('No recording is available for this call.'); return; } HUB.audio[rid] = { url: r.url, at: (HUB.pendingAt || {})[rid] || 0 }; if (HUB.pendingAt) delete HUB.pendingAt[rid]; slot(); })
        .catch(function (e2) { delete HUB.audio[rid]; slot(); toast((e2 && e2.message) || 'Couldn’t load the recording.'); }); return;
    }
    if ((x = t.closest('[data-hubswap]'))) { x.disabled = true; x.textContent = 'Swapping…'; api(Object.assign({ action: 'hubswap', pick: x.getAttribute('data-hubswap') }, hubBody())).then(function () { toast('Swapped in another call'); render(); }).catch(function (e3) { x.disabled = false; x.textContent = 'Swap'; toast(e3.message || 'Couldn’t swap that call.'); }); return; }
    if ((x = t.closest('[data-hubreqdone]'))) { x.disabled = true; api({ action: 'hubreq', op: 'done', req: +x.getAttribute('data-hubreqdone') }).then(function () { toast('Marked reviewed. They’ll get a note.'); render(); }).catch(function (e4) { x.disabled = false; toast(e4.message || 'Couldn’t update.'); }); return; }
    if ((x = t.closest('[data-hubact]'))) {
      var a = x.getAttribute('data-hubact'), d = HUB.home[hubCsrId()] && HUB.home[hubCsrId()].data;
      if (a === 'review' || a === 'flag') { reqModal(a); return; }
      if (!d) return;
      if (a === 'kudos') kudosModal(d.csr); else if (a === 'focus') focusModal(d); else if (a === 'cotw') cotwModal(d);
      return;
    }
    if ((x = t.closest('[data-hubkudoscall]'))) {
      var cid = x.getAttribute('data-hubkudoscall'); x.disabled = true;
      api({ action: 'hubkudos', op: 'callcsr', id: cid }).then(function (r) { x.disabled = false; if (!r.csr) { toast('This call isn’t linked to a CSR in the Coaching Hub yet.'); return; } var nm = r.csr.name.split(' ')[0]; kudosModal({ id: r.csr.id, first: nm, brand_short: short(r.csr.brand) }, cid); })
        .catch(function (e5) { x.disabled = false; toast(e5.message || 'Couldn’t open kudos.'); });
    }
  });

  function loadPhone() { return api(Object.assign({ action: 'phone' }, win())); }
  function phonePct(a, b) { return b ? a / b * 100 : null; }
  function vPhone(tok) {
    setMain(crumb([['Phone stats']]) + '<div id="phtop">' + skel(110, 1) + '</div><div class="oq-card" id="phchart">' + skel(220, 1) + '</div><div class="oq-card" id="phbrands">' + skel(30, 8) + '</div><div class="oq-card" id="phcsr">' + skel(30, 10) + '</div>');
    loadPhone().then(function (p) {
      if (tok !== T) return;
      var k = p.kpis || {}, pv = p.prev || {}, cov = p.coverage || {};
      var rate = phonePct(k.abandoned, k.calls), prate = phonePct(pv.abandoned, pv.calls);
      var note = (cov.first && S.start < cov.first) ? '<div class="banner" style="margin:0 0 12px;background:#F3F1EC;border-color:#E2DDD2;color:#3B4541">Phone data from LightSpeed starts <b>' + fdate(cov.first) + '</b>, so this range only covers ' + fdate(cov.first) + ' onward' + (cov.last ? ' (latest ' + fdate(cov.last) + ')' : '') + '.</div>' : '';
      var card = function (label, val, sub, d) { return '<div class="oq-card" style="flex:1 1 190px;padding:16px 18px 14px"><span class="cap">' + label + '</span><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:12px"><span class="num" style="font-size:30px;font-weight:600;letter-spacing:-0.03em;line-height:1">' + val + '</span>' + (d || '') + '</div><div class="mut" style="font-size:11.5px;margin-top:10px;line-height:1.45">' + sub + '</div></div>'; };
      $('phtop').innerHTML = note + '<div class="row">' +
        card('Inbound CSR calls', fmt(k.calls || 0), (k.wd_days ? fmt(Math.round(k.wd_calls / k.wd_days)) + ' per weekday on average' : 'No weekday data in range'), '') +
        card('Abandoned calls', rate != null ? rate.toFixed(1) + '%' : '—', fmt(k.abandoned || 0) + ' callers hung up in the CSR queue before anyone answered' + (k.wd_days ? ' · ' + (k.wd_ab / k.wd_days).toFixed(1) + ' per weekday on average' : ''), delta(rate, prate, ' pts', false)) +
        card('Avg time to answer', k.tta != null ? k.tta + 's' : '—', 'From the call reaching the CSR queue to pickup', delta(k.tta, pv.tta, 's', false)) +
        card('Abandoned in the phone menu', fmt(k.ivr || 0), 'Hung up in the phone menu, before the call reached a CSR queue. Counted separately from abandoned calls' + (k.calls ? ' (' + fmt((k.abandoned || 0) + (k.ivr || 0)) + ' abandoned in total)' : '') + '.', '') +
        '</div>' + (k.data_last && S.end > k.data_last ? '<p class="mut" style="font-size:12px;margin:8px 0 0">Phone data runs through <b>' + fdate(k.data_last) + '</b>. LightSpeed phone data arrives each morning for the day before.</p>' : '') +
        '<details class="oq-card" style="margin-top:12px;padding:14px 18px"><summary style="cursor:pointer;font-weight:600">How these numbers are counted</summary><div style="font-size:13px;line-height:1.6;margin-top:10px;display:grid;gap:8px">' +
        '<div><b>Inbound CSR calls</b>: every inbound call that reached a CSR queue or ring group, counted once even if it rolled to a second group. Technician, dispatch, accounting, manager, sales, after-hours, test and Broccoli-forward groups are left out. Cedar Park uses the same groups as Switchboard’s CPOD report.</div>' +
        '<div><b>Abandoned calls</b>: CSR calls that no one answered and that didn’t go to voicemail, so the caller hung up while waiting for a CSR. The rate is abandoned ÷ inbound CSR calls.</div>' +
        '<div><b>Avg time to answer</b>: seconds from the call reaching the first CSR queue or ring group to a CSR picking up, on answered calls.</div>' +
        '<div><b>Abandoned in the phone menu</b>: callers who hung up in the phone menu, before any CSR queue or ring group rang. These aren’t in the abandon rate, because no CSR could have answered them.</div>' +
        '<div><b>Dates and times</b>: each brand’s local time. “Last 7 days” means the 7 full days before today.</div>' +
        '<div><b>Why Switchboard can show different numbers</b>: some Switchboard dashboards count a different set of queues for a brand (Quality, PDQ, Omaha and Cedar Park differ most), count hang-ups differently, and don’t include TVG. All of these numbers come from the same LightSpeed call records.</div>' +
        '</div></details>';
      phoneChart(p);
      phoneBrands(p);
      phoneCsrs(p);
    }).catch(function (e) { if (tok === T) $('phtop').innerHTML = '<div class="oq-card"><p class="mut">Couldn’t load phone stats. ' + esc(e.message) + ' <button class="lnk" data-act="retry">Try again</button></p></div>'; });
  }
  function phoneChart(p) {
    var el = $('phchart'); if (!el) return;
    var mode = S.pmode || 'hour', DN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], DL = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'], rows = [];
    if (mode === 'dow') { [1, 2, 3, 4, 5, 6, 0].forEach(function (d) { var x = (p.dow || []).filter(function (r) { return r.d === d; })[0]; if (x && x.days) rows.push({ lab: DN[d], full: DL[d], per: x.calls / x.days, ab: x.abandoned / x.days, tot: x.calls, tab: x.abandoned, tta: x.tta, n: x.days }); else if (d >= 1 && d <= 5) rows.push({ lab: DN[d], full: DL[d], empty: true, per: 0, ab: 0, tot: 0, tab: 0 }); }); }
    else { var tot = (p.hourly || []).reduce(function (t, x) { return t + x.calls; }, 0); (p.hourly || []).filter(function (x) { return x.calls >= tot * 0.004; }).forEach(function (x) { var h = x.h % 12 || 12, ap = x.h < 12 ? 'a' : 'p', n = x.days || 1; rows.push({ lab: h + ap, full: h + (ap === 'a' ? ' am' : ' pm') + '–' + ((x.h + 1) % 12 || 12) + (x.h + 1 < 12 ? ' am' : ' pm'), per: x.calls / n, ab: x.abandoned / n, tot: x.calls, tab: x.abandoned, tta: x.tta, n: n }); }); }
    var tabs = '<div style="display:inline-flex;background:#F3F1EC;border-radius:10px;padding:3px;gap:2px" role="tablist">' + [['hour', 'By hour'], ['dow', 'By day of week']].map(function (t) { var on = mode === t[0]; return '<button role="tab" aria-selected="' + on + '" data-pmode="' + t[0] + '" style="border:none;cursor:pointer;font:inherit;font-size:12.5px;padding:6px 12px;border-radius:8px;' + (on ? 'background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.08);font-weight:600' : 'background:transparent;color:#56605B') + '">' + t[1] + '</button>'; }).join('') + '</div>';
    var head = '<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;align-items:flex-start"><div><h2 class="ttl">Calls and Abandons</h2><p class="sub">Average inbound CSR calls per ' + (mode === 'dow' ? 'day' : 'hour on a business day') + '. The orange part is calls abandoned before a CSR answered. Hover a bar for details.</p></div>' + tabs + '</div>';
    if (!rows.filter(function (r) { return !r.empty; }).length) { el.innerHTML = head + '<p class="mut" style="margin-top:14px">No phone data in this range.</p>'; return; }
    var maxP = Math.max.apply(null, rows.map(function (r) { return r.per; })), step = maxP > 2000 ? 500 : maxP > 800 ? 200 : maxP > 400 ? 100 : maxP > 100 ? 50 : maxP > 40 ? 10 : 5, top = Math.ceil(maxP / step) * step || 1, H = 190;
    var grid = [0, .25, .5, .75, 1].map(function (f) { return '<div style="position:absolute;left:0;right:0;bottom:' + (f * H) + 'px;border-top:1px ' + (f ? 'dashed #ECE8E0' : 'solid #D9D4CA') + '"></div><div style="position:absolute;left:-46px;width:40px;text-align:right;bottom:' + (f * H - 7) + 'px;font-size:11px;color:#6B726E">' + fmt(Math.round(top * f)) + '</div>'; }).join('');
    var big = function (r) { return !r.empty && r.tot >= 30 && r.per >= maxP * 0.2; }, worst = rows.filter(big).reduce(function (m, r) { return !m || r.tab / r.tot > m.tab / m.tot ? r : m; }, null);
    var bars = rows.map(function (r) {
      if (r.empty) return '<div title="No phone data for ' + r.full + ' in this range yet" style="flex:1;height:100%;display:flex;align-items:flex-end;justify-content:center"><div style="width:70%;max-width:44px;height:2px;background:#E6E1D8"></div></div>';
      var rt = r.tot ? r.tab / r.tot * 100 : 0;
      var tip = '<b>' + esc(r.full) + '</b><br>' + fmt(Math.round(r.per)) + ' calls on average<br>' + r.ab.toFixed(1) + ' abandoned on average (' + rt.toFixed(1) + '%)' + (r.tta != null ? '<br>Answered in ' + r.tta + 's on average' : '') + '<br>' + fmt(r.tot) + ' calls, ' + fmt(r.tab) + ' abandoned in total';
      return '<div data-tip="' + esc(tip) + '" tabindex="0" aria-label="' + esc(r.full + ': ' + Math.round(r.per) + ' calls, ' + rt.toFixed(1) + '% abandoned') + '" style="flex:1;height:100%;display:flex;align-items:flex-end;justify-content:center"><div style="width:70%;max-width:44px;height:' + (r.per / top * 100).toFixed(1) + '%;display:flex;flex-direction:column;border-radius:5px 5px 1px 1px;overflow:hidden"><div style="background:' + O + ';flex-shrink:0;height:' + (r.per ? r.ab / r.per * 100 : 0).toFixed(1) + '%;min-height:' + (r.ab > 0 ? 3 : 0) + 'px"></div><div style="background:#CFE5DF;flex:1"></div></div></div>';
    }).join('');
    var labs = rows.map(function (r) { return '<div style="flex:1;text-align:center;font-size:11.5px;color:#3B4541;font-weight:500">' + r.lab + '</div>'; }).join('');
    var nums = rows.map(function (r) { if (r.empty) return '<div style="flex:1;text-align:center;font-size:11px;line-height:1.35" class="mut">no data<br>yet</div>'; var rt = r.tot ? r.tab / r.tot * 100 : 0; return '<div style="flex:1;text-align:center;font-size:11px;line-height:1.35"><div style="color:#3B4541">' + fmt(Math.round(r.per)) + '</div><div style="color:#B4461F">' + r.ab.toFixed(1) + '</div><div style="color:' + (r === worst ? '#B4461F' : '#14302A') + ';font-weight:600">' + rt.toFixed(1) + '%</div></div>'; }).join('');
    el.innerHTML = head + (worst ? '<div style="font-size:12.5px;margin-top:12px"><span class="mut">Highest abandon rate</span> <b style="color:#B4461F">' + worst.full + '</b> · ' + (worst.tab / worst.tot * 100).toFixed(1) + '% of ' + fmt(worst.tot) + ' calls' + (function () { var sm = rows.filter(function (r) { return !r.empty && !big(r) && r.tot; }); return sm.length ? ' <span class="mut">· ' + sm.map(function (r) { return r.full; }).join(', ') + ' left out (too few calls to compare)</span>' : ''; })() + '</div>' : '') +
      '<div style="display:flex;gap:16px;font-size:11px;margin-top:12px" class="mut"><span><span style="display:inline-block;width:9px;height:9px;background:#CFE5DF;border-radius:2px"></span> Answered</span><span><span style="display:inline-block;width:9px;height:9px;background:' + O + ';border-radius:2px"></span> Abandoned</span></div>' +
      '<div style="position:relative;height:' + H + 'px;margin:8px 8px 0 50px">' + grid + '<div style="position:absolute;inset:0;display:flex">' + bars + '</div></div>' +
      '<div style="display:flex;margin:8px 8px 0 50px">' + labs + '</div>' +
      '<div style="display:flex;margin:6px 8px 0 50px;padding-top:6px;border-top:1px solid var(--line2)">' + nums + '</div><div class="mut" style="font-size:10.5px;margin:4px 0 0 50px">Per ' + (mode === 'dow' ? 'day' : 'hour, averaged over business days') + ': calls · abandoned · abandon %</div>';
  }
  function psortTh(t, k, l, tip, asc0) {
    var key = S['ps' + t] || (t === 'b' ? 'calls' : 'in'), dir = S['pd' + t] || 1, on = key === k, asc = (asc0 || false) === (dir === 1);
    return '<th class="sortable" data-psort="' + t + '|' + k + '" title="' + esc(tip) + ' · click again to reverse" aria-sort="' + (on ? (asc ? 'ascending' : 'descending') : 'none') + '">' + l + (on ? (asc ? ' ↑' : ' ↓') : '') + '</th>';
  }
  function psortRows(t, rows, fns, ascKeys) {
    var key = S['ps' + t] || (t === 'b' ? 'calls' : 'in'), dir = S['pd' + t] || 1, f = fns[key];
    if (!f) return rows;
    var asc = ascKeys.indexOf(key) >= 0;
    return rows.slice().sort(function (a, b) { var x = f(a), y = f(b); var c = typeof x === 'string' ? x.localeCompare(y) : ((x == null ? -1e9 : x) - (y == null ? -1e9 : y)); return dir * (asc ? c : -c); });
  }
  function phoneBrands(p) {
    var el = $('phbrands'); if (!el) return;
    var rows = (p.brands || []).map(function (b) { return { name: b.brand, calls: b.calls, per: b.per_wd, ab: b.abandoned, rate: phonePct(b.abandoned, b.calls), prate: phonePct(b.prev_ab, b.prev_calls), tta: b.tta, ivr: b.ivr }; });
    rows = psortRows('b', rows, { name: function (r) { return short(r.name); }, calls: function (r) { return r.calls; }, per: function (r) { return r.per; }, ab: function (r) { return r.ab; }, rate: function (r) { return r.rate; }, tta: function (r) { return r.tta; }, ivr: function (r) { return r.ivr; } }, ['name']);
    var cmp = rows.some(function (r) { return r.prate != null; });   // hide Change until there's an earlier period to compare
    var locs = {}; (p.locations || []).forEach(function (l) { (locs[l.brand] = locs[l.brand] || []).push(l); });
    var h = '<h2 class="ttl">Abandons by Brand</h2><p class="sub">Inbound calls to each brand’s CSR queues and ring groups. Brands with more than one location show the split underneath.</p><p class="swipe mut" style="display:none;font-size:11.5px;margin:8px 0 0">Swipe sideways for more columns →</p><div style="overflow-x:auto;margin-top:12px"><table class="tbl" style="font-size:13.5px"><thead><tr>' +
      psortTh('b', 'name', 'Brand', 'Sort A–Z', true) + psortTh('b', 'calls', 'Calls', 'Inbound CSR calls') + psortTh('b', 'per', 'Per weekday', 'Average calls Mon–Fri') + psortTh('b', 'ab', 'Abandoned', 'Hung up before a CSR answered') + psortTh('b', 'rate', 'Abandon %', 'Abandoned ÷ calls') + (cmp ? '<th>Change</th>' : '') + psortTh('b', 'tta', 'Avg answer', 'Seconds to answer') + psortTh('b', 'ivr', 'Before a CSR', 'Hung up in the menu or before a CSR group rang') + '</tr></thead><tbody>';
    rows.forEach(function (r) {
      h += '<tr><td><div style="display:flex;align-items:center;gap:10px">' + bbadge(r.name) + '<span style="font-weight:600">' + esc(short(r.name)) + '</span></div></td><td class="num">' + fmt(r.calls) + '</td><td class="num">' + (r.per != null ? fmt(Math.round(r.per)) : '—') + '</td><td class="num">' + fmt(r.ab) + '</td><td><div style="display:flex;align-items:center;gap:8px;min-width:110px"><span class="num" style="width:44px;' + ((r.rate || 0) >= 6 ? 'color:#B4461F;font-weight:600' : '') + '">' + (r.rate != null ? r.rate.toFixed(1) + '%' : '—') + '</span><div class="track" style="flex:1"><div style="background:' + ((r.rate || 0) >= 6 ? O : G) + ';width:' + Math.min(100, (r.rate || 0) * 6) + '%"></div></div></div></td>' + (cmp ? '<td>' + (r.prate == null ? '<span class="mut">—</span>' : delta(r.rate, r.prate, ' pts', false)) + '</td>' : '') + '<td class="num">' + (r.tta != null ? r.tta + 's' : '—') + '</td><td class="num mut">' + fmt(r.ivr) + '</td></tr>';
      var L = locs[r.name] || []; if (L.length > 1) L.forEach(function (l) { var lr = phonePct(l.abandoned, l.calls); h += '<tr class="mut" style="font-size:12.5px"><td style="padding-left:46px">' + esc(l.location) + '</td><td class="num">' + fmt(l.calls) + '</td><td></td><td class="num">' + fmt(l.abandoned) + '</td><td class="num">' + (lr != null ? lr.toFixed(1) + '%' : '—') + '</td>' + (cmp ? '<td></td>' : '') + '<td class="num">' + (l.tta != null ? l.tta + 's' : '—') + '</td><td></td></tr>'; });
    });
    el.innerHTML = h + '</tbody></table></div><p class="mut" style="font-size:11.5px;margin-top:10px">Cedar Park uses the same groups as Switchboard’s CPOD report. Other brands use every CSR queue and ring group, leaving out technician, manager, accounting, sales, after-hours, test and Broccoli-forward groups.</p>';
  }
  var UTIL_SEC = 7 * 3600;
  function phoneCsrs(p) {
    var el = $('phcsr'); if (!el) return;
    var brandAns = {}; (p.brands || []).forEach(function (b) { brandAns[b.brand] = b.answered; });
    var rows = (p.agents || []).map(function (a) { var tot = a.in_calls + a.out_calls; return { name: a.agent, brand: a.brand, in: a.in_calls, share: phonePct(a.in_calls, brandAns[a.brand]), talk: a.in_calls ? a.in_talk / a.in_calls / 60 : null, inhrs: a.in_talk / 3600, tta: a.tta, out: a.out_calls, outday: a.days ? a.out_calls / a.days : null, outhrs: a.out_talk / 3600, inpct: phonePct(a.in_calls, tot), days: a.days, util: a.days ? 100 * (a.in_talk + a.out_talk) / (a.days * UTIL_SEC) : null, talkday: a.days ? (a.in_talk + a.out_talk) / a.days / 3600 : null }; });
    var q = (S.phQ || '').toLowerCase(); if (q) rows = rows.filter(function (r) { return r.name.toLowerCase().indexOf(q) >= 0 || r.brand.toLowerCase().indexOf(q) >= 0; });
    rows = psortRows('a', rows, { name: function (r) { return r.name; }, brand: function (r) { return short(r.brand); }, in: function (r) { return r.in; }, share: function (r) { return r.share; }, talk: function (r) { return r.talk; }, inhrs: function (r) { return r.inhrs; }, tta: function (r) { return r.tta; }, out: function (r) { return r.out; }, outday: function (r) { return r.outday; }, outhrs: function (r) { return r.outhrs; }, inpct: function (r) { return r.inpct; }, util: function (r) { return r.util; }, days: function (r) { return r.days; } }, ['name', 'brand']);
    var h = '<div style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:10px"><div><h2 class="ttl">CSR Phone Activity</h2><p class="sub">' + rows.length + ' front-line CSRs who answered inbound calls in this range · click a header to sort</p></div><div><label class="sr" for="phq">Find a CSR</label><input id="phq" class="oq-field" style="width:220px" placeholder="Find a CSR or brand…" value="' + esc(S.phQ || '') + '"></div></div>' +
      '<p class="swipe mut" style="display:none;font-size:11.5px;margin:8px 0 0">Swipe sideways for more columns →</p><div style="overflow-x:auto;margin-top:12px"><table class="tbl" style="font-size:13px"><thead><tr>' + psortTh('a', 'name', 'CSR', 'Sort A–Z', true) + psortTh('a', 'brand', 'Brand', 'Sort A–Z', true) + psortTh('a', 'util', 'Utilization', 'Talk time (inbound + outbound) ÷ ' + (UTIL_SEC / 3600) + ' productive hours per day worked (8-hour shift less lunch and breaks)') + psortTh('a', 'days', 'Days worked', 'Days with at least one call') + psortTh('a', 'in', 'Inbound answered (total)', 'Inbound CSR calls this person answered in the range') + psortTh('a', 'share', '% of brand inbound', 'Share of the brand’s answered inbound calls') + psortTh('a', 'talk', 'Avg inbound call (min)', 'Minutes per inbound call') + psortTh('a', 'inhrs', 'Inbound talk (total hrs)', 'Hours on inbound calls in the range') + psortTh('a', 'tta', 'Avg answer (sec)', 'Seconds to pick up') + psortTh('a', 'out', 'Outbound (total)', 'Outbound calls placed in the range') + psortTh('a', 'outday', 'Outbound per day', 'Outbound calls per day worked') + psortTh('a', 'outhrs', 'Outbound talk (total hrs)', 'Hours on outbound calls in the range') + psortTh('a', 'inpct', '% inbound', 'Inbound ÷ all calls') + '</tr></thead><tbody>';
    rows.slice(0, 200).forEach(function (r) {
      h += '<tr><td><div style="display:flex;align-items:center;gap:10px">' + avatar(r.name, 28) + '<span style="font-weight:600">' + esc(r.name) + '</span></div></td><td class="mut">' + esc(short(r.brand)) + '</td><td class="num" title="' + (r.talkday != null ? r.talkday.toFixed(1) + ' talk hours per day worked' : '') + '"><b style="color:' + (r.util == null ? 'inherit' : r.util < 35 ? '#B4461F' : r.util > 85 ? '#8A5A00' : '#1F5A41') + '">' + (r.util != null ? Math.round(r.util) + '%' : '—') + '</b></td><td class="num">' + (r.days || 0) + '</td><td class="num">' + fmt(r.in) + '</td><td class="num">' + (r.share != null ? r.share.toFixed(1) + '%' : '—') + '</td><td class="num">' + (r.talk != null ? r.talk.toFixed(1) + 'm' : '—') + '</td><td class="num">' + r.inhrs.toFixed(1) + 'h</td><td class="num">' + (r.tta != null ? r.tta + 's' : '—') + '</td><td class="num">' + fmt(r.out) + '</td><td class="num">' + (r.outday != null ? r.outday.toFixed(1) : '—') + '</td><td class="num">' + r.outhrs.toFixed(1) + 'h</td><td class="num mut">' + (r.inpct != null ? r.inpct.toFixed(0) + '%' : '—') + '</td></tr>';
    });
    el.innerHTML = h + '</tbody></table></div><p class="mut" style="font-size:11.5px;margin-top:10px">Front-line CSRs only. Utilization = talk time ÷ ' + (UTIL_SEC / 3600) + ' productive hours for each day the CSR took calls (8-hour shift less a 30-minute lunch and two 15-minute breaks). LightSpeed doesn’t send logged-in hours, so idle time between calls counts as not utilized. Columns marked “total” are for the whole date range.</p>';
    var pq = $('phq'); if (pq) { pq.addEventListener('input', function () { S.phQ = pq.value; clearTimeout(pq.t); pq.t = setTimeout(function () { loadPhone().then(phoneCsrs).then(function () { var n = $('phq'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }); }, 250); }); }
  }

  var KIND = { customer: ['Customer · booking', 'background:#E6F0EA;color:#1F5A41'], followup: ['Customer · follow-up', 'background:#EAF4F6;color:#1E5F6B'], staff: ['Likely staff / tech', 'background:#E8EAF4;color:#3A4380'], no_conversation: ['No conversation', 'background:#F3F1EC;color:#56605B'] };
  var CUSTK = ['customer', 'followup'];  // repeat callers who are customers: no staff / tech, no internal, no dead air (2026-10-24)
  var CLS = { conversation: 'Conversation', internal: 'Internal (staff)', voicemail: 'Voicemail', no_agent: 'No CSR on line', wrong_number: 'Wrong number', ivr_only: 'Phone menu only', spam: 'Spam', non_customer_call: 'Not a customer' };
  function kindPill(k) { var x = KIND[k] || [k, 'background:#F3F1EC']; return '<span class="pill" style="' + x[1] + ';white-space:nowrap">' + x[0] + '</span>'; }
  function loadRepeat(min, phone) { return api(Object.assign({ action: 'repeat', min: min || S.rmin || 3, phone: phone || null }, win())); }
  function repeatCard() {
    var el = $('repcard'); if (!el) return;
    loadRepeat(3).then(function (r) {
      var k = r.kinds || {}, rows = (r.rows || []).filter(function (t) { return CUSTK.indexOf(t.kind) >= 0; });
      var nc = (k.customer || 0) + (k.followup || 0), left = (k.staff || 0) + (k.no_conversation || 0);
      el.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px"><div><h2 class="ttl">Repeat Callers</h2><p class="sub">Customers who called 3+ times in one day · techs, staff and internal calls left out · click one to see every call</p></div><button class="more" data-rkind="cust">See all →</button></div>' +
        '<div style="display:flex;align-items:baseline;gap:10px;margin:12px 0 8px"><span class="num" style="font-size:30px;font-weight:600">' + (r.customers ? (nc / r.customers * 100).toFixed(1) + '%' : '—') + '</span><span class="mut">' + fmt(nc) + ' of ' + fmt(r.customers) + ' numbers</span></div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">' + CUSTK.filter(function (x) { return k[x]; }).map(function (x) { return '<button class="chip" data-rkind="' + x + '" style="font-size:12px">' + KIND[x][0] + ' · <b>' + fmt(k[x]) + '</b></button>'; }).join('') + (left ? '<span class="mut" style="font-size:12px;align-self:center">' + fmt(left) + ' staff / tech or no-conversation numbers left out</span>' : '') + '</div>' +
        rows.slice(0, 6).map(function (t) { return '<button class="click" data-rphone="' + t.digits + '" style="all:unset;box-sizing:border-box;cursor:pointer;width:100%;display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 2px;border-top:1px solid var(--line2);font-size:12.5px"><span style="display:flex;flex-direction:column;gap:2px;min-width:0"><span><b class="num">' + esc(t.phone) + '</b> <span class="mut">· ' + esc(short(t.brand)) + '</span></span><span class="mut" style="font-size:11.5px">' + t.max_day + ' calls in one day · ' + fmt(t.calls) + ' total · ' + fmt(t.internal) + ' internal</span></span>' + kindPill(t.kind) + '</button>'; }).join('');
    }).catch(function (e) { el.innerHTML = '<h2 class="ttl">Repeat Callers</h2><p class="mut">' + esc(e.message) + '</p>'; });
  }
  function vRepeat(tok) {
    setMain(crumb([['Insights', 'insights'], ['Repeat callers']]) + '<div class="oq-card" id="repall">' + skel(30, 12) + '</div>');
    loadRepeat(S.rmin || 3).then(function (r) {
      if (tok !== T) return;
      var k = r.kinds || {}, kind = S.rkind == null ? 'cust' : S.rkind, q = (S.rq || '').replace(/\D/g, '');
      var rows = (r.rows || []).filter(function (x) { return (!kind || (kind === 'cust' ? CUSTK.indexOf(x.kind) >= 0 : x.kind === kind)) && (!q || x.digits.indexOf(q) >= 0); });
      var chips = '<div style="display:flex;flex-wrap:wrap;gap:6px">' + [['cust', 'All customers', (k.customer || 0) + (k.followup || 0)]].concat(['customer', 'followup', 'staff', 'no_conversation'].map(function (x) { return [x, KIND[x][0], k[x] || 0]; })).map(function (c) { var on = kind === c[0]; return '<button class="chip' + (on ? ' on' : '') + '" data-rkind="' + c[0] + '" aria-pressed="' + on + '">' + c[1] + ' · ' + fmt(c[2]) + '</button>'; }).join('') + '</div>';
      var h = '<div style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:10px"><div><h2 class="ttl">Repeat Callers</h2><p class="sub">' + fmt(r.repeat) + ' of ' + fmt(r.customers) + ' numbers called ' + (S.rmin || 3) + '+ times in one day. Tags come from what the calls were about: <b>likely staff / tech</b> means most calls were internal (a technician or office line), <b>customer · booking</b> means there was a booking opportunity, <b>customer · follow-up</b> means the customer talked to a CSR about an existing job, bill or status with no new booking. Shown: customers only, unless you pick another tag.</p></div>' +
        '<div style="display:flex;gap:8px;align-items:center"><label class="sr" for="rq">Find a number</label><input id="rq" class="oq-field" style="width:170px" placeholder="Search a number…" value="' + esc(S.rq || '') + '"><label class="sr" for="rmin">Calls in one day</label><select id="rmin" class="oq-field" style="width:auto">' + [2, 3, 4, 5, 8].map(function (n) { return '<option value="' + n + '"' + ((S.rmin || 3) === n ? ' selected' : '') + '>' + n + '+ in a day</option>'; }).join('') + '</select></div></div>' +
        '<div style="margin-top:12px">' + chips + '</div>' +
        '<p class="swipe mut" style="display:none;font-size:11.5px;margin:8px 0 0">Swipe sideways for more columns →</p><div style="overflow-x:auto;margin-top:12px"><table class="tbl" style="font-size:13px"><thead><tr><th>Number</th><th>Brand</th><th>Looks like</th><th class="num">Most in a day</th><th class="num">Total calls</th><th class="num">Days</th><th class="num">Conversations</th><th class="num">Internal</th><th class="num">Voicemail / other</th><th class="num">Booked</th><th class="num">Outbound</th><th>Last</th><th></th></tr></thead><tbody>' +
        (rows.length ? rows.slice(0, 200).map(function (x) { return '<tr class="click" data-rphone="' + x.digits + '" tabindex="0"><td><b class="num">' + esc(x.phone) + '</b></td><td class="mut">' + esc(short(x.brand)) + (x.brands > 1 ? ' +' + (x.brands - 1) : '') + '</td><td>' + kindPill(x.kind) + '</td><td class="num">' + x.max_day + '</td><td class="num">' + fmt(x.calls) + '</td><td class="num">' + x.days + '</td><td class="num">' + fmt(x.conv) + '</td><td class="num">' + fmt(x.internal) + '</td><td class="num mut">' + fmt(x.vm + x.other) + '</td><td class="num">' + fmt(x.booked) + '</td><td class="num mut">' + fmt(x.outbound) + '</td><td class="mut">' + fdate(x.last_date) + ' · ' + esc(x.last_outcome || '') + '</td><td class="mut" aria-hidden="true">›</td></tr>'; }).join('') : '<tr><td colspan="13" class="mut">No numbers match.</td></tr>') +
        '</tbody></table></div>';
      $('repall').innerHTML = h;
      var rq = $('rq'); if (rq) rq.addEventListener('input', function () { S.rq = rq.value; clearTimeout(rq.t); rq.t = setTimeout(function () { render(); var n = $('rq'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 250); });
      var rm = $('rmin'); if (rm) rm.addEventListener('change', function () { S.rmin = +rm.value; render(); });
    }).catch(function (e) { if (tok === T) $('repall').innerHTML = '<p class="mut">' + esc(e.message) + '</p>'; });
  }
  function phoneDrawer(digits) {
    $('layer').innerHTML = '<div class="overlay" data-close="1"><div class="drawer" role="dialog" aria-modal="true" aria-label="Calls from this number" id="pd">' + skel(60, 1) + skel(50, 6) + '</div></div>';
    loadRepeat(S.rmin || 3, digits).then(function (r) {
      var el = $('pd'); if (!el) return;
      var c = r.classes || {}, tot = r.total || 0, internal = c.internal || 0, conv = c.conversation || 0;
      var verdict = internal >= Math.max(2, tot * 0.4) ? 'staff' : ((r.rows || []).some(function (x) { return x.outcome === 'Booked' || x.outcome === 'Not Booked'; }) ? 'customer' : (conv === 0 ? 'no_conversation' : 'unclear'));
      var why = verdict === 'staff' ? internal + ' of ' + tot + ' calls were internal (staff talking to staff), so this is probably a technician’s or office phone.' : verdict === 'customer' ? 'Conversations include booking decisions, so this looks like a real customer.' : verdict === 'no_conversation' ? 'No real conversations: voicemails, phone-menu hang-ups or wrong numbers.' : 'Mixed. Read a few summaries below to decide.';
      var h = '<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start"><div><div class="cap">Calls from this number</div><div class="num" style="font-size:24px;font-weight:600;letter-spacing:-0.02em;margin-top:4px">' + esc(r.phone) + '</div><div style="margin-top:8px">' + kindPill(verdict) + '</div></div><button class="sel" data-close="1" aria-label="Close">✕</button></div>' +
        '<div class="oq-card" style="padding:14px 16px"><div style="font-size:13px;line-height:1.5">' + esc(why) + '</div><div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px">' + Object.keys(c).sort(function (a, b) { return c[b] - c[a]; }).map(function (x) { return '<span class="pill" style="background:#F3F1EC;color:#3B4541">' + esc(CLS[x] || x) + ' · ' + c[x] + '</span>'; }).join('') + '</div>' +
        '<div class="mut" style="font-size:12px;margin-top:10px">Talked to: ' + (r.agents || []).slice(0, 6).map(function (a) { return esc(a.agent || 'Unknown') + ' (' + a.n + ')'; }).join(', ') + '</div>' +
        '<div class="mut" style="font-size:12px;margin-top:4px">Busiest days: ' + (r.days || []).slice().sort(function (a, b) { return b.n - a.n; }).slice(0, 4).map(function (d) { return fdate(d.call_date) + ' (' + d.n + ')'; }).join(', ') + '</div></div>' +
        '<div class="oq-card" style="padding:6px 16px">' + (r.rows || []).map(function (x) {
          var open = !!x.id;
          return '<div ' + (open ? 'class="click" data-call="' + x.id + '" role="button" tabindex="0" ' : '') + 'style="padding:12px 0;border-bottom:1px solid var(--line2);' + (open ? 'cursor:pointer' : '') + '"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><span style="font-weight:600;display:flex;align-items:center;gap:8px">' + (open ? '<span data-autoplay="' + x.id + '" title="Play recording" style="width:30px;height:30px;border-radius:999px;border:1px solid #E1DCD2;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0"><svg width="10" height="10" viewBox="0 0 24 24" fill="#1C2421" aria-hidden="true"><path d="M7 4l13 8-13 8z"/></svg></span>' : '') + esc(x.agent || 'Unknown') + (x.ai ? ' <span class="pill" style="background:#E8EAF4;color:#3A4380">AI agent</span>' : '') + ' <span class="mut" style="font-weight:400">· ' + (x.direction === 'outbound' ? 'Outbound' : 'Inbound') + '</span></span><span class="mut num" style="font-size:12px">' + fdate(x.date) + ' ' + fhour(x.hour) + ' · ' + fsecs(x.secs) + '</span></div>' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px"><span class="pill" style="background:#F3F1EC;color:#3B4541">' + esc(CLS[x.class] || x.class) + '</span>' + (x.outcome && x.outcome !== 'Internal' ? '<span class="pill" style="' + chipOut(x.outcome) + '">' + esc(x.outcome) + '</span>' : '') + (x.topic ? '<span class="mut" style="font-size:12px">' + esc(x.topic) + '</span>' : '') + (open && x.score != null ? '<span class="pill" style="' + chipScore(x.score) + '">' + x.score + '</span>' : '') + '</div>' +
            (x.summary ? '<div style="font-size:12.5px;line-height:1.5;color:#3B4541;margin-top:6px">' + esc(x.summary) + '</div>' : '') + '</div>';
        }).join('') + '</div>';
      el.innerHTML = h;
    }).catch(function (e) { var el = $('pd'); if (el) el.innerHTML = '<p class="mut">' + esc(e.message) + '</p>'; });
  }
  function aiCard() {
    var el = $('aicard'); if (!el) return;
    api(Object.assign({ action: 'ai' }, win())).then(function (r) {
      var g = {}; (r.grid || []).forEach(function (x) { g[x.seg + (x.ai ? '|ai' : '|csr')] = x; });
      var segs = [['open', 'During brand hours', 'each brand’s own hours'], ['before_open', 'Before opening', 'early calls on open days'], ['after_close', 'After closing', 'late calls on open days'], ['closed_day', 'Closed days', 'weekends and other days the brand is closed']];
      var rate = function (x) { return x && x.decided >= 1 ? x.booked / x.decided * 100 : null; };
      var base = rate(g['open|csr']), tot = segs.reduce(function (t, s) { return t + ((g[s[0] + '|csr'] || {}).calls || 0); }, 0) || 1;
      var worst = null; segs.slice(1).forEach(function (s) { var x = g[s[0] + '|csr'], rt = rate(x); if (x && x.decided >= 10 && base != null && rt != null && rt < base - 5 && (!worst || rt - base < worst.gap)) worst = { s: s, gap: rt - base, rt: rt, x: x }; });
      var lost = worst ? Math.round(worst.x.decided * (base - worst.rt) / 100) : 0;
      var h = '<h2 class="ttl">When calls come in</h2><p class="sub">How calls go inside and outside each brand’s hours of operation (brand’s local time) · click a row to hear those calls</p>';
      h += worst ? '<div style="margin-top:10px;background:#FFF4E8;border-radius:10px;padding:10px 12px;font-size:12.5px;line-height:1.5;color:#7A3A08"><b>' + worst.s[1] + ' calls book ' + worst.rt.toFixed(0) + '%</b> vs ' + base.toFixed(0) + '% during brand hours. At that rate that’s about <b>' + fmt(lost) + ' more booked jobs</b> this period. <button class="more" data-ffk="seg" data-ffv="' + worst.s[0] + '" data-ffnb="1">Hear the ones that didn’t book →</button></div>'
        : '<div class="mut" style="margin-top:10px;font-size:12.5px">No time of day is booking noticeably worse than during brand hours in this period.</div>';
      var SH = pct100(segs.map(function (s) { return (g[s[0] + '|csr'] || {}).calls || 0; }));
      h += '<div style="margin-top:10px">' + segs.map(function (s, si) {
        var x = g[s[0] + '|csr'] || {}, rt = rate(x), bad = rt != null && base != null && s[0] !== 'open' && rt < base - 5 && x.decided >= 10;
        return '<button class="click" data-ffk="seg" data-ffv="' + s[0] + '" style="all:unset;box-sizing:border-box;cursor:pointer;width:100%;display:grid;grid-template-columns:minmax(0,1.2fr) 70px 70px 60px 14px;gap:10px;align-items:center;padding:9px 2px;border-top:1px solid var(--line2);font-size:12.5px">' +
          '<span><b style="font-weight:600">' + s[1] + '</b><span class="mut" style="display:block;font-size:11.5px">' + s[2] + ' · ' + SH[si] + ' of calls</span></span>' +
          '<span class="num" style="text-align:right">' + fmt(x.calls || 0) + '<span class="mut" style="display:block;font-size:11px">calls</span></span>' +
          '<span class="num" style="text-align:right;color:' + (bad ? '#B4461F' : '#1F5A41') + ';font-weight:600">' + (rt != null ? rt.toFixed(0) + '%' : '—') + '<span class="mut" style="display:block;font-size:11px;font-weight:400">booked</span></span>' +
          '<span class="num" style="text-align:right">' + (x.avg != null ? Number(x.avg).toFixed(0) : '—') + '<span class="mut" style="display:block;font-size:11px">score</span></span><span class="mut" aria-hidden="true">›</span></button>';
      }).join('') + '</div>';
      var ca = (r.csr_after || []).slice(0, 5);
      if (ca.length) h += '<div class="cap" style="margin-top:14px">Who takes calls outside their brand’s hours</div>' + ca.map(function (a) { var rt = a.decided ? Math.round(a.booked / a.decided * 100) : null; return '<button class="click" data-agent="' + esc(a.agent) + '" style="all:unset;box-sizing:border-box;cursor:pointer;width:100%;display:flex;justify-content:space-between;gap:10px;padding:7px 2px;border-top:1px solid var(--line2);font-size:12.5px"><span style="display:flex;gap:8px;align-items:center">' + avatar(a.agent, 22) + esc(a.agent) + '</span><span class="num mut">' + fmt(a.calls) + ' calls · ' + (rt != null ? rt + '% booked' : 'no decisions') + '</span></button>'; }).join('');
      var ai = (r.agents || []).reduce(function (t, a) { return t + (a.calls || 0); }, 0);
      if (ai) h += '<p class="mut" style="font-size:11.5px;margin-top:10px">AI receptionists handled ' + fmt(ai) + ' recorded call' + (ai === 1 ? '' : 's') + ' in this period (not included above).</p>';
      var DN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], hr = function (x) { x = +x; var a = x >= 12 ? 'p' : 'a', v = x % 12 || 12; return v + a; };
      var hrsTxt = function (days) { var g = []; (days || []).forEach(function (d) { var k = hr(d.open) + '–' + hr(d.close), last = g[g.length - 1]; if (last && last.k === k && last.to === d.dow - 1) last.to = d.dow; else g.push({ k: k, from: d.dow, to: d.dow }); }); return g.map(function (x) { return DN[x.from] + (x.to !== x.from ? '–' + DN[x.to] : '') + ' ' + x.k; }).join(', '); };
      var known = (r.hours || []).filter(function (b) { return b.days && b.days.length; }), dflt = (r.hours || []).filter(function (b) { return !b.days || !b.days.length; });
      if ((r.hours || []).length) h += '<details style="margin-top:10px;font-size:12px"><summary class="mut" style="cursor:pointer">Hours used</summary><div style="margin-top:6px;line-height:1.6">' + known.map(function (b) { return '<b style="font-weight:600">' + esc(short(b.brand)) + '</b> ' + esc(hrsTxt(b.days)); }).join('<br>') + (dflt.length ? '<br><span class="mut">' + esc(dflt.map(function (b) { return short(b.brand); }).join(', ')) + ': Mon–Fri 8a–6p until their hours are added</span>' : '') + '</div></details>';
      el.innerHTML = h;
    }).catch(function (e) { el.innerHTML = '<h2 class="ttl">When calls come in</h2><p class="mut">' + esc(e.message) + '</p>'; });
  }

  function crumb(parts) {
    return '<div class="oq-crumb">' + parts.map(function (p, i) { return i === parts.length - 1 ? '<span style="color:var(--ink);font-weight:600">' + esc(p[0]) + '</span>' : '<button data-go="' + p[1] + '">' + esc(p[0]) + '</button><span aria-hidden="true">/</span>'; }).join('') + '</div>';
  }

  // ---------- Recording player ----------
  var AU = new Audio(); AU.preload = 'metadata';
  var P = { id: null };
  function vcur() { var L = P.legs; return L && L.length ? (L[P.li || 0].offset + (AU.currentTime || 0)) : (AU.currentTime || 0); }
  function vseek(t, play) {
    var L = P.legs; t = Math.max(0, +t || 0);
    if (!L || !L.length) { AU.currentTime = t; if (play) AU.play().catch(function () {}); return; }
    var k = 0; for (var i = 0; i < L.length; i++) if (t >= L[i].offset - 0.01) k = i;
    var loc = t - L[k].offset;
    if (L[k].secs && loc > L[k].secs && k < L.length - 1) { k++; loc = 0; }
    if (k !== (P.li || 0)) { var go = play || !AU.paused; P.li = k; P.pendingSeek = Math.max(0, loc); AU.src = L[k].url; AU.playbackRate = P.rate || 1; if (go) AU.play().catch(function () {}); }
    else { AU.currentTime = Math.max(0, loc); if (play) AU.play().catch(function () {}); }
  }
  AU.addEventListener('loadedmetadata', function () { if (P.pendingSeek != null) { try { AU.currentTime = P.pendingSeek; } catch (x) {} P.pendingSeek = null; } });
  AU.addEventListener('ended', function () { var L = P.legs; if (L && L.length && (P.li || 0) < L.length - 1) vseek(L[(P.li || 0) + 1].offset, true); });
  // Parts on one timeline: the transferring CSR's call (xfer_from), this call, its hold continuations (legs),
  // and the colleague who took the transfer (xfer_to). Offsets come in seconds from THIS call's start;
  // P.base shifts them so the first part starts at 0. Step/evidence times stay on this call's clock (+P.base).
  function loadLegs(c) {
    var hasX = c && ((c.xfer_to && c.xfer_to.id) || (c.xfer_from && c.xfer_from.id));
    if (!c || (!(c.legs && c.legs.length) && !hasX) || P.id !== c.id || P.legsFor === c.id) return;
    P.legsFor = c.id; var id = c.id, me = c.agent || 'This CSR', parts = [];
    if (c.xfer_from && c.xfer_from.id) parts.push({ id: c.xfer_from.id, offset: c.xfer_from.offset != null ? +c.xfer_from.offset : -(+c.xfer_from.secs || 0), secs: +c.xfer_from.secs || 0, label: (c.xfer_from.agent || 'First CSR'), kind: 'from' });
    parts.push({ id: null, offset: 0, secs: +c.secs || 0, label: me, kind: 'self' });
    (c.legs || []).forEach(function (l) { parts.push({ id: l.id, offset: +l.offset || 0, secs: +l.secs || 0, label: me + ' (after hold)', kind: 'hold' }); });
    if (c.xfer_to && c.xfer_to.id) parts.push({ id: c.xfer_to.id, offset: c.xfer_to.offset != null ? +c.xfer_to.offset : null, secs: +c.xfer_to.secs || 0, label: (c.xfer_to.agent || 'Next CSR') + ' (after transfer)', kind: 'to' });
    var wait = new Promise(function (res) { if (P.info) return res(); var n = 0, iv = setInterval(function () { if (P.info || ++n > 150 || P.id !== id) { clearInterval(iv); res(); } }, 100); });
    wait.then(function () { return Promise.all(parts.map(function (pt) { return pt.id ? api({ action: 'audio', id: pt.id, t: Math.floor(Date.now() / 300000) }).catch(function () { return null; }) : Promise.resolve(P.info); })); }).then(function (infos) {
      if (P.id !== id || !P.info || !P.info.url) return;
      var keep = [];
      parts.forEach(function (pt, i) { var inf = infos[i]; if (!inf || !inf.url) return; pt.url = inf.url; pt.inf = inf; if (!pt.secs) pt.secs = inf.end ? inf.end + 3 : 0; keep.push(pt); });
      if (keep.length < 2) return;
      // no overlaps: a part whose offset is unknown follows the previous one; an overlapping previous part is trimmed
      for (var i = 0; i < keep.length; i++) {
        var pt = keep[i], pv = keep[i - 1];
        if (pt.offset == null) pt.offset = pv ? pv.offset + pv.secs : 0;
        if (pv && pt.offset < pv.offset + pv.secs) { if (pt.kind === 'self') pv.secs = Math.max(1, pt.offset - pv.offset); else if (pt.kind === 'from') pt.offset = pv.offset + pv.secs; else pv.secs = Math.max(1, pt.offset - pv.offset); }
      }
      var base = -keep[0].offset, L = [], segs = [], pci = [], li = 0;
      keep.forEach(function (pt, i) {
        var o = pt.offset + base;
        L.push({ offset: o, secs: pt.secs, url: pt.url, label: pt.label, kind: pt.kind });
        if (pt.kind === 'self') li = i;
        (pt.inf.segs || []).forEach(function (t) { segs.push(pt.offset + (+t)); });
        (pt.inf.pci || []).forEach(function (r) { pci.push([o + (+r[0]), o + (+r[1])]); });
      });
      P.legs = L; P.li = li; P.base = base; P.info.segs = segs.sort(function (x, y) { return x - y; }); P.info.pci = pci;
      paintPlayer();
    });
  }
  function legsNote(c) {
    if (c.leg_of && c.leg_of.id) return '<div class="oq-card" style="background:#F3F8F5;border-color:#BFDCCB;display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap"><div style="font-size:13px;line-height:1.5"><b>This is part ' + (c.leg_of.n || 2) + ' of a longer conversation.</b> ' + (c.leg_of.kind === 'callback' ? 'The customer called the same CSR back a few minutes after the first call, so both calls are scored together as one conversation.' : 'The phone system started a new recording when the caller came back from hold. The score is on the full call.') + '</div><button class="sel btnd" data-call="' + esc(c.leg_of.id) + '">Open the full call</button></div>';
    var bits = [];
    if (c.xfer_from && c.xfer_from.id) bits.push('starts with <b>' + esc(c.xfer_from.agent || 'the first CSR') + '</b>’s part before the transfer');
    var nh = (c.legs || []).filter(function (l) { return l.kind !== 'callback'; }).length, nc = (c.legs || []).length - nh;
    if (nh) bits.push('includes ' + nh + ' more recording' + (nh > 1 ? 's' : '') + ' after a hold');
    if (nc) bits.push('includes the customer’s callback ' + (nc > 1 ? '(' + nc + ' calls) ' : '') + 'a few minutes later to the same CSR');
    if (c.xfer_to && c.xfer_to.id) bits.push('continues into <b>' + esc(c.xfer_to.agent || 'the next CSR') + '</b>’s part after the transfer');
    if (!bits.length) return '';
    return '<div class="mut" style="font-size:12.5px;line-height:1.5;margin-top:-4px">The player ' + bits.join(', ') + '. ' + ((c.xfer_from && c.xfer_from.id) || (c.xfer_to && c.xfer_to.id) ? 'Each CSR is scored only on their own part.' : 'The score covers the whole call.') + '</div>';
  }
  function tsList(txt) { var out = [], re = /\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]/g, m; while ((m = re.exec(txt || ''))) out.push(m[3] != null ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : (+m[1]) * 60 + (+m[2])); return out; }
  function clock(x) { x = Math.max(0, Math.floor(x || 0)); return Math.floor(x / 60) + ':' + ('0' + x % 60).slice(-2); }
  function pdur() { if (P.legs && P.legs.length) { var z = P.legs[P.legs.length - 1]; return z.offset + (z.secs || 0); } var d = AU.duration; return isFinite(d) && d > 0 ? d : ((S.cur && S.cur.id === P.id && +S.cur.secs) || ((P.info && P.info.end) ? P.info.end + 3 : 0)); }
  function stepRange(s) {
    var ts = tsList(s && s.evidence); if (!ts.length && s && s.at != null && isFinite(+s.at)) ts = [+s.at]; if (!ts.length) return null;
    var a = Math.min.apply(null, ts), b = Math.max.apply(null, ts), segs = (P.info && P.info.segs) || [], end = null;
    for (var i = 0; i < segs.length; i++) if (+segs[i] > b + 0.5) { end = +segs[i]; break; }
    if (end == null) end = b + 10;
    if (end - b < 4) end = b + 4;
    return [Math.max(0, a - 0.4), end + 0.4];
  }
  function loadAudio(id) {
    AU.pause(); AU.removeAttribute('src'); try { AU.load(); } catch (x) {}
    P = { id: id, loading: true, step: null, stepEnd: null };
    api({ action: 'audio', id: id, t: Math.floor(Date.now() / 300000) }).then(function (info) {
      if (P.id !== id) return; P.loading = false; P.info = info || {};
      if (info && info.url) { AU.src = info.url; AU.playbackRate = P.rate || 1; } else P.err = 'none';
      if (S.cur && S.cur.id === id && S.callId === id && $('cd')) drawCall(); else paintPlayer();
      if (S.autoplay === id) { S.autoplay = null; if (info && info.url) AU.play().catch(function () {}); }
    }).catch(function () { if (P.id !== id) return; P.loading = false; P.err = 'fail'; paintPlayer(); });
  }
  function dlHref(u) {
    if (!u || u.indexOf('/storage/v1/object/sign/') < 0) return u;
    var c = S.cur && S.cur.id === P.id ? S.cur : {}, ext = ((u.split('?')[0].match(/\.(mp3|wav|ogg|m4a|opus|webm)$/i) || [])[1] || 'mp3').toLowerCase();
    var nm = ['call', c.date || '', (c.agent || '').replace(/[^\w]+/g, '-'), (c.brand ? short(c.brand) : '').replace(/[^\w]+/g, '-')].filter(Boolean).join('_') + '.' + ext;
    return u + (u.indexOf('?') >= 0 ? '&' : '?') + 'download=' + encodeURIComponent(nm);
  }
  function stopAudio() { AU.pause(); P.step = null; P.stepEnd = null; }
  function playerInner() {
    if (P.loading) return '<div style="display:flex;align-items:center;gap:12px"><span class="dots"><span></span><span></span><span></span></span><span class="mut" style="font-size:13px">Loading recording…</span></div>';
    if (P.err === 'none') return '<div class="mut" style="font-size:13px">No recording is available for this call.</div>';
    if (P.err === 'fail') return '<div style="font-size:13px;color:#A8441A">The recording didn’t load. <button class="more" data-pretry="1">Try again</button></div>';
    if (P.err === 'codec') return '<div style="font-size:13px;color:#A8441A">This browser can’t play this recording. Try Chrome or Edge, or <button class="more" data-pdl="1">download it</button>.</div>';
    var d = pdur(), cur = vcur(), playing = !AU.paused, pci = (P.info && P.info.pci) || [], steps = (S.cur && S.cur.steps) || [];
    var marks = d ? pci.map(function (r) { return '<span title="Card details skipped" style="position:absolute;top:0;bottom:0;left:' + (r[0] / d * 100).toFixed(2) + '%;width:' + Math.max(0.6, (r[1] - r[0]) / d * 100).toFixed(2) + '%;background:repeating-linear-gradient(45deg,#C9C3B8 0 3px,#E6E1D8 3px 6px);border-radius:2px"></span>'; }).join('') : '';
    if (d && P.legs) for (var gi = 1; gi < P.legs.length; gi++) { var g0 = P.legs[gi - 1].offset + (P.legs[gi - 1].secs || 0), g1 = P.legs[gi].offset; if (g1 > g0 + 1) marks += '<span title="On hold (not recorded)" style="position:absolute;top:0;bottom:0;left:' + (g0 / d * 100).toFixed(2) + '%;width:' + ((g1 - g0) / d * 100).toFixed(2) + '%;background:#D9D4C9"></span>'; }
    var stepNote = P.step != null && steps[P.step] ? '<span style="color:#1F5A41;font-weight:600">Playing step: ' + esc(steps[P.step].label) + '</span> <button class="more" data-pfull="1">Play full call</button>' : '';
    return '<div style="display:flex;align-items:center;gap:12px">' +
      '<button data-pplay="1" aria-label="' + (playing ? 'Pause' : 'Play') + '" style="all:unset;cursor:pointer;width:44px;height:44px;border-radius:999px;background:var(--side);display:flex;align-items:center;justify-content:center;flex-shrink:0">' + (playing ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>' : '<svg width="14" height="14" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M7 4l13 8-13 8z"/></svg>') + '</button>' +
      '<div style="flex:1;min-width:0"><div style="position:relative;height:22px;display:flex;align-items:center"><div style="position:absolute;left:0;right:0;height:6px;border-radius:999px;background:#EEEBE4;overflow:hidden">' + marks + '<span id="pfill" style="position:absolute;left:0;top:0;bottom:0;background:#2F7D5B;width:' + (d ? Math.min(100, cur / d * 100).toFixed(2) : 0) + '%"></span></div>' +
      '<label class="sr" for="pseek">Seek</label><input id="pseek" type="range" min="0" max="' + Math.ceil(d || 1) + '" step="0.5" value="' + cur.toFixed(1) + '" style="position:absolute;left:0;right:0;width:100%;margin:0;opacity:0;cursor:pointer;height:22px"></div>' +
      '<div style="display:flex;justify-content:space-between;gap:8px;font-size:11.5px;margin-top:2px"><span class="num mut" id="ptime">' + clock(cur) + ' / ' + clock(d) + '</span><span class="mut">' + (pci.length ? 'Card details are skipped' : '') + '</span></div></div>' +
      '<button class="sel" data-pspeed="1" aria-label="Playback speed" style="min-height:34px;padding:4px 10px;font-size:12px">' + (P.rate || 1) + '×</button>' + (P.info && P.info.url ? '<button class="sel" data-pdl="1" aria-label="Download recording" title="Download recording" style="min-height:34px;padding:4px 10px;font-size:12px;gap:5px"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>Download</button>' : '') + '</div>' +
      (stepNote ? '<div style="font-size:12.5px;margin-top:6px">' + stepNote + '</div>' : '') + partChips();
  }
  function partChips() {
    var L = P.legs; if (!L || L.length < 2) return '';
    return '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px" role="group" aria-label="Parts of this call">' + L.map(function (l, i) {
      var on = i === (P.li || 0);
      return '<button class="chip' + (on ? ' on' : '') + '" data-ppart="' + i + '" aria-pressed="' + on + '" style="min-height:30px;padding:3px 10px;font-size:12px"><span class="num">' + clock(l.offset) + '</span> ' + esc(l.label || ('Part ' + (i + 1))) + '</button>';
    }).join('') + '</div>';
  }
  function paintPlayer() {
    var el = $('plr'); if (el) el.innerHTML = playerInner();
    document.querySelectorAll('[data-pstep]').forEach(function (b) { var on = P.step === +b.getAttribute('data-pstep') && !AU.paused; b.innerHTML = on ? '■ Stop' : '▶ Play this step'; b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.style.background = on ? '#E6F0EA' : ''; });
  }
  var TR = { open: {} };
  function trWho(s) { s = String(s || ''); return /^agent$/i.test(s) ? 'CSR' : (/^caller$/i.test(s) ? 'Caller' : (s.replace(/^Speaker\s*/i, 'Speaker ') || '')); }
  function trText(t) { return esc(String(t || '').replace(/\[(CREDIT_CARD|CVV|CARD|BANK|ACCOUNT|ROUTING|SSN|EXPIRATION)[A-Z_]*\d*\]/g, '[card details removed]')); }
  // Names instead of "Speaker 0/1" (2026-10-23). The automatic labels only number the voices, and the phone
  // system's recorded greeting often shares a number with a person. Per recording part: lines before the CSR's
  // live greeting are the phone system; the voice that greets ("this is Tara", "how may I help") is the CSR;
  // any other voice is the customer.
  var IVR_RX = /(monitored or recorded|recorded for (training|quality)|stay on the line|be with you shortly|press \d|para espa|routine maintenance|manufacturer recommends|your call is important|all of our|currently assisting|please hold|thank you for calling[^.]{0,60}(number one|#1|dealer|leader)|for more than [a-z0-9]+ years|have trusted|number one rated|largest [a-z ]{0,20}specialist|award[- ]winning|rated [a-z ]{0,20}(specialist|company)|with more than [0-9,]+)/i;
  var GREET_RX = /(this is [a-z]+|my name is|[a-z]+ speaking|how (may|can) i (help|assist)|thank(s| you) for (holding|waiting|your patience))/i;
  function trNames(c, L) {
    // Speaker labels from the transcription are often swapped or merged, so each line is checked on its own words too (2026-10-25):
    // the CSR's greeting (their own first name, the brand, "how can I help") marks the CSR voice; a line that greets the CSR by name,
    // or gives a different name ("my name is Bob", "this is Bill"), is the customer whatever voice it was filed under.
    var out = [], first = function (n) { return String(n || '').split(' ')[0] || n; };
    var csr = { from: (c.xfer_from && c.xfer_from.agent) || 'CSR', self: c.agent || 'CSR', hold: c.agent || 'CSR', callback: c.agent || 'CSR', to: (c.xfer_to && c.xfer_to.agent) || 'CSR' };
    var brandW = String(c.brand || '').toLowerCase().split(/[^a-z]+/).filter(function (w) { return w.length > 3 && ['door', 'doors', 'overhead', 'garage'].indexOf(w) < 0; })[0] || '';
    var nm = function (a, b) { a = String(a || '').toLowerCase(); b = String(b || '').toLowerCase(); return a.length >= 3 && b.length >= 3 && a.slice(0, 3) === b.slice(0, 3); };
    var i = 0;
    while (i < L.length) {
      var kind = L[i][1], j = i; while (j < L.length && L[j][1] === kind) j++;
      var ag = first(csr[kind]), agL = String(ag || '').toLowerCase();
      var isIvr = function (t) { return IVR_RX.test(t); };
      var isGreet = function (t) { if (isIvr(t)) return false; var x = t.toLowerCase(), m;
        if ((m = x.match(/(?:this is|it's|it is|my name is|name's) ([a-z]+)/)) && nm(m[1], agL)) return true;
        if ((m = x.match(/([a-z]+) speaking/)) && nm(m[1], agL)) return true;
        if (/how (may|can) i (help|assist)|can i help you/.test(x)) return true;
        if (brandW && x.indexOf(brandW) >= 0 && (/(help|assist|this is|speaking)/.test(x) || x.split(/\s+/).length <= 8)) return true;
        return false; };
      var isCust = function (t) { var x = t.toLowerCase(), m;
        if ((m = x.match(/^(?:hey|hi|hello|yes|yeah)[,.]? ([a-z]+)/)) && nm(m[1], agL)) return true;
        if ((m = x.match(/my name is ([a-z]+)/)) && !nm(m[1], agL)) return true;
        if ((m = x.match(/^(?:hi,? |hello,? |yeah,? )?this is ([a-z]+)/)) && !nm(m[1], agL) && !(brandW && x.indexOf(brandW) >= 0)) return true;
        return false; };
      var g = -1; for (var k = i; k < j && k < i + 40; k++) { if (isGreet(String(L[k][3] || ''))) { g = k; break; } }
      var csrVoice = g >= 0 ? L[g][2] : null;
      for (var k3 = i; k3 < j; k3++) {
        var txt = String(L[k3][3] || ''), sp = String(L[k3][2]);
        if (isIvr(txt) && (g < 0 || k3 <= g || k3 - i < 6)) out[k3] = { name: 'Phone system', csr: false, sys: true };
        else if (g >= 0 && k3 < g) out[k3] = { name: 'Phone system', csr: false, sys: true };
        else if (k3 === g) out[k3] = { name: first(csr[kind]), csr: true };
        else if (isCust(txt)) out[k3] = { name: 'Customer', csr: false };
        else if (csrVoice != null) out[k3] = sp === String(csrVoice) ? { name: first(csr[kind]), csr: true } : { name: 'Customer', csr: false };
        else out[k3] = { name: trWho(L[k3][2]), csr: /^agent$/i.test(L[k3][2]) };
      }
      i = j;
    }
    return out;
  }
  function trCard(c) {
    var L = c.transcript || []; if (!L.length) return '';
    var open = !!TR.open[c.id], q = (TR.q && TR.q.id === c.id) ? TR.q.s : '', ql = q.toLowerCase();
    var who = { from: (c.xfer_from && c.xfer_from.agent) || 'First CSR', self: c.agent || 'CSR', hold: c.agent || 'CSR', to: (c.xfer_to && c.xfer_to.agent) || 'Next CSR' };
    var head = { from: 'Before the transfer: ' + who.from, self: (c.xfer_from ? 'After the transfer: ' : '') + who.self, hold: 'Back from hold', callback: 'The customer called back', to: 'After the transfer: ' + who.to };
    var rows = [], last = null, shown = 0, max = open || ql ? 1e9 : 8, NM = trNames(c, L);
    for (var i = 0; i < L.length && shown < max; i++) {
      var l = L[i], t = +l[0], kind = l[1];
      if (ql && String(l[3] || '').toLowerCase().indexOf(ql) < 0) continue;
      if (kind !== last && (last !== null || kind !== 'self' || c.xfer_from)) rows.push('<div class="cap" style="margin:12px 0 4px;color:#3A4380">' + esc(head[kind] || '') + '</div>');
      last = kind; shown++;
      rows.push('<div class="trl" data-trt="' + t + '" data-seek="' + t + '" role="button" tabindex="0" style="display:grid;grid-template-columns:44px 64px 1fr;gap:8px;padding:5px 6px;border-radius:8px;cursor:pointer;font-size:13px;line-height:1.5"><span class="num mut" style="font-size:11.5px;padding-top:2px">' + clock(t) + '</span><b style="font-weight:600;font-size:12px;padding-top:1px;color:' + (NM[i].csr ? '#1F5A41' : NM[i].sys ? '#9AA19D' : '#2B3A67') + '">' + esc(NM[i].name) + '</b><span>' + trText(l[3]) + '</span></div>');
    }
    return '<div class="oq-card" id="trc"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><b>Transcript</b>' +
      '<label class="sr" for="trq">Search the transcript</label><input id="trq" class="oq-field" data-trq="' + esc(c.id) + '" placeholder="Search the transcript" value="' + esc(q) + '" style="max-width:220px;padding:6px 10px;font-size:13px"></div>' +
      '<div class="mut" style="font-size:11.5px;margin-top:4px">Click a line to play from there. Names are matched from the CSR’s greeting and can occasionally be off. Card details are removed.</div>' +
      '<div id="trl" style="margin-top:6px">' + (rows.length ? rows.join('') : '<p class="mut" style="margin:8px 0">No lines match.</p>') + '</div>' +
      (!ql && L.length > 8 ? '<button class="more" data-trall="' + esc(c.id) + '" style="margin-top:6px">' + (open ? 'Show less' : 'Show full transcript (' + L.length + ' lines)') + '</button>' : '') + '</div>';
  }
  function bindTr() {
    var tq = $('trq'); if (!tq) return;
    tq.addEventListener('input', function () {
      var id = tq.getAttribute('data-trq'); TR.q = { id: id, s: tq.value }; clearTimeout(TR.tm);
      TR.tm = setTimeout(function () { var tc = $('trc'); if (!tc || !S.cur || S.cur.id !== id) return; tc.outerHTML = trCard(S.cur); bindTr(); var n = $('trq'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 200);
    });
  }
  function trFollow() {
    var box = $('trl'); if (!box || AU.paused) return;
    var cur = vcur() - (P.base || 0), best = null;
    box.querySelectorAll('[data-trt]').forEach(function (el) { var t = +el.getAttribute('data-trt'); if (t <= cur + 0.3) best = el; el.style.background = ''; });
    if (best) best.style.background = '#E6F0EA';
  }
  function tick() {
    var d = pdur(), cur = vcur(), f = $('pfill'), t = $('ptime'), sk = $('pseek');
    if (f && d) f.style.width = Math.min(100, cur / d * 100).toFixed(2) + '%';
    if (t) t.textContent = clock(cur) + ' / ' + clock(d);
    if (sk && document.activeElement !== sk) { sk.max = Math.ceil(d || 1); sk.value = cur.toFixed(1); }
    trFollow();
  }
  AU.addEventListener('timeupdate', function () {
    var cur = vcur(), pci = (P.info && P.info.pci) || [];
    for (var i = 0; i < pci.length; i++) if (cur >= pci[i][0] && cur < pci[i][1]) { vseek(pci[i][1]); toast('Card details skipped for security'); return; }
    var Lg = P.legs, li0 = P.li || 0;
    if (Lg && li0 < Lg.length - 1 && Lg[li0].secs && AU.currentTime > Lg[li0].secs + 0.3) { vseek(Lg[li0 + 1].offset, true); return; }
    if (P.stepEnd != null && cur >= P.stepEnd) { AU.pause(); P.step = null; P.stepEnd = null; paintPlayer(); }
    tick();
  });
  ['play', 'pause', 'ended', 'loadedmetadata', 'durationchange'].forEach(function (ev) { AU.addEventListener(ev, paintPlayer); });
  AU.addEventListener('error', function () { if (AU.getAttribute('src')) { P.err = 'codec'; paintPlayer(); } });
  function playStep(i) {
    var s = S.cur && S.cur.steps[i], r = stepRange(s); if (!r || !P.info || !P.info.url) return;
    if (P.step === i && !AU.paused) { stopAudio(); paintPlayer(); return; }
    P.step = i; P.stepEnd = r[1] + (P.base || 0); vseek(r[0] + (P.base || 0), true); paintPlayer();
  }

  // ---------- Call drawer ----------
  function callDrawer() {
    var id = S.callId;
    if (P.id !== id) loadAudio(id);
    $('layer').innerHTML = '<div class="overlay" data-close="1"><div class="drawer" role="dialog" aria-modal="true" aria-label="Call review" id="cd">' + skel(80, 1) + skel(40, 6) + '</div></div>';
    api({ action: 'call', id: id }).then(function (c) {
      if (S.callId !== id || !$('cd')) return; S.cur = c; drawCall(); loadLegs(c);
    }).catch(function (e) { if ($('cd')) $('cd').innerHTML = errBox(e); });
  }
  function evHtml(t) { return esc(t).replace(/\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]/g, function (m0, a, b, c) { var x = c != null ? (+a) * 3600 + (+b) * 60 + (+c) : (+a) * 60 + (+b); return '<span class="lnk" data-seek="' + x + '" role="button" tabindex="0" title="Play from here" style="font-style:normal">' + m0 + '</span>'; }); }
  function ans(s) { return s.answer; }
  var ANS = { yes: 'Done', no: 'Missed', na: 'N/A' };
  function drawCall() {
    var c = S.cur; if (!c || !$('cd')) return;
    var steps = c.steps || [], changed = !!c.adjusted && c.ai_score != null;
    var who = steps.filter(function (s) { return s.adj; }).map(function (s) { return s.adj.by; }).filter(function (v, i, a) { return v && a.indexOf(v) === i; });
    var sc = c.score, col = sc >= 80 ? G : (sc >= 60 ? '#E8A06A' : O), yn = function (v) { return v === true ? '<b style="color:#1F5A41">Yes</b>' : (v === false ? '<b style="color:#A61B1B">No</b>' : (v === 'yes' ? '<b style="color:#1F5A41">Yes</b>' : (v === 'no' ? '<b style="color:#A61B1B">No</b>' : '<b class="mut">N/A</b>'))); };
    var h = '' + (S.fromAsk ? '<button class="sel" data-backask="1" style="align-self:flex-start;min-height:34px;padding:4px 12px;font-size:12.5px">← Back to AI answer</button>' : '') + '<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start"><div><div class="cap">Call review</div><div style="font-size:22px;font-weight:600;letter-spacing:-0.025em;margin-top:4px">' + esc(c.agent || 'Unknown CSR') + ' · ' + esc(short(c.brand)) + '</div><div class="mut" style="font-size:12.5px">' + fdate(c.date) + ' · ' + esc(c.direction || '') + ' · ' + fsecs(c.secs) + (c.phone ? ' · ' + esc(c.phone) : '') + '</div></div><button class="sel" data-close="1" aria-label="Close" style="width:44px;justify-content:center">✕</button></div>' +
      '<div class="oq-card" id="plr" style="position:sticky;top:-22px;z-index:3;padding:12px 14px;box-shadow:0 4px 14px rgba(20,48,42,.08)">' + playerInner() + '</div>' +
      '<div class="oq-card" style="display:flex;gap:18px;align-items:center;flex-wrap:wrap"><div style="position:relative;width:96px;height:96px;flex-shrink:0"><svg width="96" height="96" viewBox="0 0 120 120" role="img" aria-label="Score ' + sc + '"><circle cx="60" cy="60" r="50" fill="none" stroke="#EEEBE4" stroke-width="12"/><circle cx="60" cy="60" r="50" fill="none" stroke="' + col + '" stroke-width="12" stroke-linecap="round" stroke-dasharray="' + (sc / 100 * 314).toFixed(0) + ' 314" transform="rotate(-90 60 60)"/></svg><div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center"><span class="num" style="font-size:24px;font-weight:600">' + sc + '</span><span class="mut" style="font-size:9.5px">brand avg ' + (c.brand_avg || '—') + '</span></div></div>' +
      '<div style="flex:1;min-width:220px"><div class="row" style="gap:6px"><span class="pill" style="' + chipOut(c.outcome) + '">' + esc(c.outcome || '—') + '</span>' + (c.winnable ? '<span class="pill" style="background:#FFF4E8;color:#9A4A0B">Winnable</span>' : '') + (c.reason ? '<span class="pill" style="background:#F3F1EC;color:#3B4541">' + esc(c.reason) + '</span>' : '') + (c.category ? [c.category] : (c.topics || []).filter(function (t) { return t !== 'General Inquiry'; }).slice(0, 3).map(tLab)).map(function (t) { return '<span class="pill" style="background:#E6F0EA;color:#1F5A41">' + esc(t) + '</span>'; }).join('') + '</div>' +
      (c.caller_wanted ? '<div style="margin-top:10px"><div class="cap">Caller wanted</div><div style="margin-top:3px;line-height:1.45">' + esc(c.caller_wanted) + '</div></div>' : '') + '</div>' +
      (changed ? '<div style="flex-basis:100%;background:#FFF8E8;border:1px solid #F0DDB0;border-radius:10px;padding:10px 12px;font-size:12.5px;color:#6B4E12">Score updated' + (who.length ? ' by <b>' + who.map(esc).join(', ') + '</b>' : '') + '.</div>' : '') + '</div>';
    h += factsBar(c);
    h += legsNote(c);
    if (CFG.showMetrics) h += metCard(c);
    h += ccCard(c);
    if (c.xfer_out || c.xfer_in) {
      var leg = c.xfer_out ? c.xfer_to : c.xfer_from;
      h += '<div class="oq-card" style="background:#F3F4FA;border-color:#D9DCEE"><b style="color:#3A4380">' + (c.xfer_out ? '↗ Outbound transfer' : '↘ Inbound transfer') + '</b><div style="font-size:13px;line-height:1.5;margin-top:6px">' +
        (c.xfer_out ? esc(c.agent || 'This CSR') + ' transferred this call' + (leg ? ' to <b>' + esc(leg.agent || 'a colleague') + '</b>' + (leg.outcome ? ', and it ended <b>' + esc(leg.outcome) + '</b>' : '') : ' — the receiving call wasn’t matched yet') + '.'
          : esc(c.agent || 'This CSR') + ' received this call' + (leg ? ' from <b>' + esc(leg.agent || 'a colleague') + '</b>' : '') + '.') +
        '</div>' + (leg && leg.id ? '<button class="sel" data-call="' + leg.id + '" style="margin-top:10px">Open the ' + (c.xfer_out ? 'receiving' : 'original') + ' call' + (leg.score != null ? ' (score ' + leg.score + ')' : '') + ' →</button>' : '') + '</div>';
    }
    h += '<div class="oq-card" style="background:#FFF8F0;border-color:#F6D9B8"><b style="color:#7A3A08">Revenue &amp; conversion</b><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(110px,1fr));margin-top:10px;font-size:13px"><div><div class="cap" style="color:#7A5A3A">Asked to book</div>' + yn(c.asked_for_booking) + '</div><div><div class="cap" style="color:#7A5A3A">Info before price</div>' + yn(c.info_before_pricing) + '</div><div><div class="cap" style="color:#7A5A3A">Fee expectations</div>' + yn(c.set_fee_expectations) + '</div><div><div class="cap" style="color:#7A5A3A">Card asked</div>' + yn(c.asked_for_cc) + '</div></div>' + (c.revenue_tip ? '<div style="font-size:13px;line-height:1.5;margin-top:10px"><b>Biggest revenue lever:</b> ' + esc(c.revenue_tip) + '</div>' : '') + '</div>';
    if ((c.risk_flags || []).length) h += '<div class="oq-card" style="background:#FDF0F0;border-color:#F3C9C9"><b style="color:#8A1515">Risk flags</b><ul style="margin:8px 0 0;padding-left:18px;font-size:13px;line-height:1.5">' + c.risk_flags.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul></div>';
    if (c.summary) h += '<div class="oq-card"><b>Summary</b><div style="line-height:1.6;margin-top:6px;font-size:13.5px">' + esc(c.summary) + '</div></div>';
    if (c.coaching) h += '<div class="oq-card" style="background:#EEF6F2;border-color:#CFE3D8"><b style="color:#1F5A41">Coaching note</b><div style="line-height:1.6;margin-top:6px;font-size:13.5px">' + esc(c.coaching) + '</div></div>';
    h += '<div class="oq-card" style="padding:14px 8px"><div style="padding:0 12px"><b>Detailed scoring</b>' + (CAN_EDIT ? '<div class="mut" style="font-size:12px;margin-top:2px">Heard something different? Use <b>' + (IS_ADMIN ? 'Change' : 'Request change') + '</b> on any step.</div>' : '') + '</div>';
    steps.forEach(function (s, i) {
      var rq = ((REQS[c.id] || []).filter(function (x) { return x.key === s.key; }))[0];
      var a = ans(s), cc = a === 'yes' ? ['#E6F0EA', '#1F5A41', '✓'] : (a === 'no' ? ['#FDECEC', '#A61B1B', '✕'] : ['#EEEBE4', '#56605B', '–']), adj = s.adj;
      h += '<div class="step"><div style="display:flex;gap:12px;align-items:flex-start"><div style="width:28px;height:28px;border-radius:999px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-weight:700;background:' + cc[0] + ';color:' + cc[1] + '" aria-label="' + (a === 'yes' ? 'done' : a === 'no' ? 'missed' : 'not applicable') + '">' + cc[2] + '</div><div style="flex:1;min-width:0"><div style="display:flex;justify-content:space-between;gap:10px"><b style="font-weight:600;line-height:1.35">' + esc(s.label) + '</b><span class="num mut" style="font-size:12px;white-space:nowrap">' + (a === 'no' ? 0 : (s.max || s.points)) + ' / ' + (s.max || s.points) + '</span></div>' +
        (s.why ? '<div style="font-size:13px;line-height:1.5;color:#3B4541;margin-top:4px">' + esc(s.why) + '</div>' : '') +
        (adj ? '<div style="margin-top:6px;font-size:12.5px;background:#FFF8E8;border-radius:8px;padding:7px 10px;color:#6B4E12"><b>Changed to ' + (ANS[a] || a) + ' by ' + esc(adj.by || 'an admin') + '</b>' + (adj.at ? ' · ' + ago(adj.at) : '') + (adj.why ? ': “' + esc(adj.why) + '”' : '') + (IS_ADMIN ? ' <button class="more" data-act="restore" data-k="' + esc(s.key) + '">Undo</button>' : '') + '</div>' : '') +
        (rq ? '<div style="margin-top:6px;font-size:12.5px;background:#EEF2FB;border-radius:8px;padding:7px 10px;color:#2B3A67"><b>' + esc(rq.requested_by || 'Someone') + ' asked to change this to ' + (ANS[rq.to] || rq.to) + '</b> · ' + ago(rq.at) + ': “' + esc(rq.why || '') + '”' + (IS_ADMIN ? ' <button class="more" data-act="reqok" data-r="' + rq.id + '">Approve</button> <button class="more" data-act="reqno" data-r="' + rq.id + '">Decline</button>' : ' <span class="mut">Waiting for your account admin.</span>') + '</div>' : '') +
        (a === 'no' && s.misses && s.misses.length ? '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">' + s.misses.map(function (x) { return '<span class="pill" style="background:#FDECEC;color:#A61B1B">Missed: ' + esc(x) + '</span>'; }).join('') + '</div>' : '') +
        '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;align-items:flex-start">' + (s.evidence ? '<div style="flex:1 1 240px;background:#F5F3EE;border-radius:10px;padding:8px 12px;font-size:12.5px;font-style:italic;color:#3B4541">“' + evHtml(s.evidence) + '”</div>' : '') + '<div style="display:flex;gap:8px;flex-wrap:wrap">' + (stepRange(s) && P.info && P.info.url ? '<button class="sel" data-pstep="' + i + '" style="min-height:36px;padding:6px 12px;white-space:nowrap">' + (P.step === i && !AU.paused ? '■ Stop' : '▶ Play this step') + '</button>' : (P.info && P.info.url ? '<span class="mut" style="font-size:12px;align-self:center">' + (a === 'no' ? 'Not done on the call, so there’s no moment to play' : 'No moment to play for this step') + '</span>' : '')) + (CAN_EDIT ? '<button class="sel" data-change="' + i + '" style="min-height:36px;padding:6px 12px">' + (IS_ADMIN ? 'Change' : 'Request change') + '</button>' : '') + '</div></div></div></div></div>';
    });
    h += '</div>' + trCard(c) + '<div class="oq-card" id="cnotes"><b>Notes</b><div id="cnlist" style="margin-top:8px">' + skel(18, 2) + '</div>' +
      (CAN_EDIT ? '<form id="cnform" style="display:flex;flex-direction:column;gap:8px;margin-top:10px"><label class="sr" for="cnbody">Add a note</label><textarea id="cnbody" class="oq-field" style="min-height:64px;resize:vertical" maxlength="4000" placeholder="Add a note for your team…"></textarea><div><button class="sel btnd" type="submit">Add note</button></div></form>' : '') + '</div>' +
      '<div class="row"><button class="sel" data-act="pdf">Print / save PDF</button><button class="sel" data-ccgo="1">Ask AI about this call</button>' + (CAN_EDIT && !CFG.csrSelf ? '<button class="sel" data-hubkudoscall="' + c.id + '">♥ Send kudos</button>' : '') + '</div>';
    var keep = $('cnbody') ? $('cnbody').value : ''; var keepq = $('ccq') ? $('ccq').value : '';
    $('cd').innerHTML = h; bindTr();
    if (keep && $('cnbody')) $('cnbody').value = keep;
    if (keepq && $('ccq')) $('ccq').value = keepq;
    ccPaint(c.id, true);
    loadNotes(c.id); loadReqs(c.id); loadCe(c.id);
  }
  var NOTES = {};
  function drawNotes(id) {
    var el = $('cnlist'); if (!el || !S.cur || S.cur.id !== id) return;
    var L = NOTES[id] || [];
    el.innerHTML = L.length ? L.map(function (n) { return '<div style="padding:8px 0;border-top:1px solid var(--line2);font-size:13px;line-height:1.5"><div><b style="font-weight:600">' + esc(n.author_name || 'Someone') + '</b> <span class="mut" style="font-size:11.5px">· ' + ago(n.created_at) + '</span></div><div style="white-space:pre-wrap">' + esc(n.body) + '</div></div>'; }).join('') : '<div class="mut" style="font-size:12.5px">No notes yet.</div>';
  }
  function loadNotes(id) {
    if (NOTES[id]) { drawNotes(id); return; }
    api({ action: 'notes', id: id }).then(function (r) { NOTES[id] = r.notes || []; drawNotes(id); }).catch(function () { var el = $('cnlist'); if (el) el.innerHTML = '<div class="mut" style="font-size:12.5px">Couldn’t load notes.</div>'; });
  }
  function addNote() {
    var b = $('cnbody'), id = S.cur && S.cur.id; if (!b || !id) return;
    var v = b.value.trim(); if (!v) { toast('Write a note first.'); return; }
    var btn = $('cnform').querySelector('button'); btn.disabled = true; btn.textContent = 'Saving…';
    api({ action: 'notes', id: id, body: v }).then(function (r) { NOTES[id] = r.notes || []; if ($('cnbody')) $('cnbody').value = ''; drawNotes(id); btn.disabled = false; btn.textContent = 'Add note'; toast('Note added'); })
      .catch(function (e) { btn.disabled = false; btn.textContent = 'Add note'; toast(e.message || 'Couldn’t save the note.'); });
  }
  function saveAdjust(key, pick, why) {
    var id = S.cur && S.cur.id; if (!id) return Promise.resolve();
    return api({ action: 'adjust', id: id, key: key, answer: pick, why: why || null }).then(function (c) {
      cache = {}; if (S.callId === id) { S.cur = c; drawCall(); }
      return c;
    });
  }
  function printCall() {
    var cd = $('cd'); if (!cd) return;
    var w = pdfWin();
    var css = ($('oqa-style') || {}).textContent || '';
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Call review</title><link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet"><style>' + css + ' #oqa .drawer{width:auto;height:auto;overflow:visible} #plr,#cnform,#ccx,.row button,[data-change],[data-pstep],[data-close]{display:none!important} .pbar{display:flex;justify-content:center;gap:10px;align-items:center;margin:0 0 12px;font:13px Montserrat,sans-serif} .pbar button{background:#14302A;color:#fff;border:0;border-radius:8px;padding:8px 14px;font:600 13px Montserrat,sans-serif;cursor:pointer} @media print{.pbar{display:none!important}}</style></head><body><div class="pbar"><button onclick="window.print()">Save as PDF / Print</button><span style="color:#56605B">To save a PDF, choose “Save as PDF” as the printer.</span></div><div id="oqa"><div class="drawer">' + cd.innerHTML + '</div></div></body></html>');
    w.document.close();
  }
  function changeModal() {
    var s = S.cur.steps[S.change], cur = ans(s);
    S.pick = cur;
    var L = document.createElement('div');
    L.innerHTML = '<div class="overlay" id="chg" style="justify-content:center;align-items:center;z-index:70" data-closechg="1"><div class="oq-card" role="dialog" aria-modal="true" aria-label="Change step score" style="width:480px;max-width:calc(100% - 32px);padding:24px;display:flex;flex-direction:column;gap:14px"><div class="cap">' + (IS_ADMIN ? 'Change score' : 'Request a score change') + '</div><b style="line-height:1.4">' + esc(s.label) + '</b><div class="mut" style="font-size:12.5px">Currently: <b>' + (ANS[cur] || cur) + '</b></div><div class="seg">' + [['yes', 'Done'], ['no', 'Missed'], ['na', 'N/A']].map(function (o) { return '<button class="' + (cur === o[0] ? 'on' : '') + '" data-pick="' + o[0] + '">' + o[1] + '</button>'; }).join('') + '</div><div><label class="l" for="chgwhy">What did you hear?' + (IS_ADMIN ? ' (optional)' : ' (required)') + '</label><textarea id="chgwhy" class="oq-field" style="min-height:80px" maxlength="1000" placeholder="e.g. She asked “how can I help?” at 0:28 — the AI missed it."></textarea></div><div class="mut" style="font-size:12px">' + (IS_ADMIN ? 'This updates the call’s score right away.' : 'Your request goes to your account admin. The score changes once they approve it.') + '</div><div class="row" style="justify-content:flex-end"><button class="sel" data-closechg="1">Cancel</button><button class="sel btnd" data-act="applychange">' + (IS_ADMIN ? 'Save change' : 'Send request') + '</button></div></div></div>';
    ROOT.appendChild(L.firstChild); $("chgwhy").focus();
  }

  // ---------- ongoing AI chat about this call (2026-10-21) ----------
  var CC = {};
  var CC_SUGG = ['What did the customer want, and what got in the way?', 'Where could the CSR have booked it?', 'Was this really a transfer?', 'Write a short coaching note for the CSR'];
  function ccMd(t) { return md(t).replace(/\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]/g, function (m0, a, b, c) { var x = c != null ? (+a) * 3600 + (+b) * 60 + (+c) : (+a) * 60 + (+b); return '<span class="lnk" data-seek="' + x + '" role="button" tabindex="0" title="Play from here">' + m0 + '</span>'; }); }
  function ccInner(id) {
    var T = CC[id] || { msgs: [] }, h = '';
    if (!T.msgs.length) h += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px">' + CC_SUGG.map(function (q) { return '<button class="chip" data-ccq="' + esc(q) + '">' + esc(q) + '</button>'; }).join('') + '</div>';
    h += T.msgs.map(function (m) {
      return m.role === 'user'
        ? '<div style="display:flex;justify-content:flex-end;margin-top:10px"><div style="max-width:85%;background:var(--side);color:#fff;border-radius:14px 14px 4px 14px;padding:8px 12px;font-size:13px;line-height:1.45;white-space:pre-wrap">' + esc(m.content) + '</div></div>'
        : '<div style="max-width:95%;margin-top:10px;background:#F5F3EE;border-radius:14px 14px 14px 4px;padding:6px 12px;font-size:13px;line-height:1.5' + (m.error ? ';color:#A8441A' : '') + '">' + ccMd(m.content) + '</div>';
    }).join('');
    if (T.busy) h += '<div style="margin-top:10px;display:flex;gap:8px;align-items:center"><span class="dots"><span></span><span></span><span></span></span><span class="mut" style="font-size:12px">' + (/re-?score|rescore|call flow|5.step|five.step/i.test((T.msgs[T.msgs.length - 1] || {}).content || '') ? 'Re-scoring the call on the current call flow (about 30 seconds)…' : 'Reading the call…') + '</span></div>';
    return h;
  }
  // ---------- conversation metrics (talk-to-listen, speed, monologue, fillers, questions, mood) ----------
  var MET = {};
  function metLoad(id) {
    if (MET[id]) return; MET[id] = { busy: true };
    api({ action: 'callmetrics', id: id }).then(function (r) { MET[id] = r || { available: false }; }).catch(function () { MET[id] = { available: false, why: 'Couldn’t load the metrics right now.' }; })
      .then(function () { var el = $('cmet'); if (el && S.cur && S.cur.id === id) el.outerHTML = metCard(S.cur); });
  }
  function metTile(label, val, sub, tone, hint) {
    var dot = { g: '#2F7D5B', o: '#E8A06A', r: '#C24141', n: '#B9B4AA' }[tone || 'n'];
    return '<div style="background:#FAF9F6;border:1px solid #EEEBE4;border-radius:12px;padding:10px 12px;min-width:0"><div class="cap" style="display:flex;gap:6px;align-items:center"><span aria-hidden="true" style="width:8px;height:8px;border-radius:99px;background:' + dot + ';flex-shrink:0"></span>' + label + '</div>' +
      '<div class="num" style="font-size:18px;font-weight:600;margin-top:4px">' + val + (sub ? ' <span class="mut" style="font-size:12px;font-weight:400">' + sub + '</span>' : '') + '</div>' + (hint ? '<div class="mut" style="font-size:11.5px;margin-top:2px">' + hint + '</div>' : '') + '</div>';
  }
  function metCard(c) {
    var m = MET[c.id];
    if (!m) { metLoad(c.id); m = MET[c.id]; }
    var head = '<div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline;flex-wrap:wrap"><b>Conversation metrics</b><span class="mut" style="font-size:11.5px">Estimated from the recording</span></div>';
    if (!m || m.busy) return '<div class="oq-card" id="cmet">' + head + '<div style="margin-top:10px">' + skel(16, 2) + '</div></div>';
    var moodT = m.mood === 'Upset' ? 'r' : 'g', moodTile = metTile('Customer mood', esc(m.mood || 'Calm'), '', moodT, m.mood === 'Upset' ? 'Flagged on this call' : 'No upset signs');
    if (!m.available) return '<div class="oq-card" id="cmet">' + head + '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:10px">' + moodTile + '</div><div class="mut" style="font-size:12.5px;margin-top:8px">' + esc(m.why || 'Talk-time metrics aren’t available for this recording.') + '</div></div>';
    var tr = m.talk_ratio, trT = tr >= 35 && tr <= 65 ? 'g' : (tr >= 25 && tr <= 75 ? 'o' : 'r');
    var w = m.wpm, wT = w == null ? 'n' : (w >= 130 && w <= 175 ? 'g' : (w >= 110 && w <= 195 ? 'o' : 'r'));
    var lm = m.longest_monologue_sec, lmT = lm <= 45 ? 'g' : (lm <= 75 ? 'o' : 'r');
    var f = m.fillers_per_min, fT = f <= 2 ? 'g' : (f <= 4 ? 'o' : 'r');
    var q = m.questions, qT = q >= 3 ? 'g' : (q >= 1 ? 'o' : 'r');
    var fm = function (sec) { sec = Math.round(sec || 0); return sec >= 60 ? Math.floor(sec / 60) + 'm ' + (sec % 60) + 's' : sec + 's'; };
    var bar = '<div style="display:flex;height:6px;border-radius:99px;overflow:hidden;margin-top:6px;background:#EEEBE4" aria-hidden="true"><div style="width:' + tr + '%;background:#2F7D5B"></div><div style="flex:1;background:#C9D8E8"></div></div>';
    return '<div class="oq-card" id="cmet">' + head +
      '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:10px">' +
      moodTile +
      '<div style="background:#FAF9F6;border:1px solid #EEEBE4;border-radius:12px;padding:10px 12px;min-width:0"><div class="cap" style="display:flex;gap:6px;align-items:center"><span aria-hidden="true" style="width:8px;height:8px;border-radius:99px;background:' + { g: '#2F7D5B', o: '#E8A06A', r: '#C24141' }[trT] + '"></span>Talk-to-listen</div><div class="num" style="font-size:18px;font-weight:600;margin-top:4px">' + tr + '% <span class="mut" style="font-size:12px;font-weight:400">CSR</span></div>' + bar + '<div class="mut" style="font-size:11.5px;margin-top:4px">CSR ' + fm(m.csr_talk_sec) + ' · customer ' + fm(m.customer_talk_sec) + ' · aim 35–65%</div></div>' +
      metTile('Talking speed', w == null ? '—' : w, w == null ? '' : 'words/min', wT, 'Aim 130–175') +
      metTile('Longest monologue', fm(lm), '', lmT, 'Aim under 45s') +
      metTile('Filler words', f, 'per min', fT, 'Um, uh, you know · aim 2 or fewer') +
      metTile('Questions asked', q, '', qT, 'Discovery questions · aim 3+') +
      '</div>' + (m.estimated ? '<div class="mut" style="font-size:11.5px;margin-top:8px">The recording’s speaker separation was weak on this call, so treat these as rough.</div>' : '') + '</div>';
  }
  function ccCard(c) {
    var T = CC[c.id] || { msgs: [] };
    return '<div class="oq-card" id="ccx"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><div style="display:flex;gap:8px;align-items:center"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2F7D5B" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/></svg><b>Ask about this call</b></div>' +
      '<button class="more" data-ccclear="1"' + (T.msgs.length ? '' : ' style="display:none"') + '>Start over</button></div>' +
      '<div class="mut" style="font-size:12px;margin-top:2px">Ask anything about what happened. Keep asking follow-ups; the AI remembers this conversation and has the full transcript.</div>' +
      '<div id="ccthread" aria-live="polite">' + ccInner(c.id) + '</div>' +
      '<form id="ccform" style="display:flex;gap:8px;margin-top:10px"><label class="sr" for="ccq">Ask about this call</label><input id="ccq" class="oq-field" autocomplete="off" maxlength="600" style="flex:1;min-width:0" placeholder="' + (T.msgs.length ? 'Ask a follow-up…' : 'e.g. What did the customer say about price?') + '"><button class="sel btnd" type="submit"' + (T.busy ? ' disabled' : '') + '>Ask</button></form></div>';
  }
  function ccPaint(id, quiet) {
    var el = $('ccthread'); if (!el || !S.cur || S.cur.id !== id) return;
    el.innerHTML = ccInner(id);
    var T = CC[id] || { msgs: [] }, f = $('ccform'), b = f && f.querySelector('button'), q = $('ccq'), clr = document.querySelector('[data-ccclear]');
    if (b) b.disabled = !!T.busy;
    if (q) q.placeholder = T.msgs.length ? 'Ask a follow-up…' : 'e.g. What did the customer say about price?';
    if (clr) clr.style.display = T.msgs.length ? '' : 'none';
    if (!quiet && el.lastElementChild) el.lastElementChild.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function ccAsk(q) {
    var id = S.cur && S.cur.id; q = String(q || '').trim(); if (!id || !q) return;
    var T = CC[id] = CC[id] || { msgs: [] }; if (T.busy) return;
    var hist = T.msgs.filter(function (m) { return !m.error; }).slice(-12).map(function (m) { return { role: m.role, content: m.content }; });
    T.msgs.push({ role: 'user', content: q }); T.busy = true; if ($('ccq')) $('ccq').value = ''; ccPaint(id);
    api({ action: 'callchat', id: id, question: q, history: hist })
      .then(function (r) {
        T.msgs.push({ role: 'assistant', content: (r && r.answer) || '' });
        if (r && r.rescored) { cache = {}; return api({ action: 'call', id: id }).then(function (c) { if (S.callId === id) { S.cur = c; drawCall(); } toast('Call re-scored on the current call flow'); }).catch(function () {}); }
      })
      .catch(function (e) { T.msgs.push({ role: 'assistant', content: (e && e.message) || 'Something went wrong. Try again.', error: true }); })
      .then(function () { T.busy = false; ccPaint(id); if ($('ccq') && S.cur && S.cur.id === id) $('ccq').focus(); });
  }

  // ---------- score-change requests (non-admins request, the client's account admins approve) ----------
  var REQS = {};
  function loadReqs(id, force) {
    if (REQS[id] && !force) return;
    api({ action: 'scorereq', op: 'forcall', id: id }).then(function (r) { var had = JSON.stringify(REQS[id] || []); REQS[id] = r.rows || []; if (S.cur && S.cur.id === id && JSON.stringify(REQS[id]) !== had) drawCall(); }).catch(function () { REQS[id] = REQS[id] || []; });
  }
  function decideReq(rid, approve, btn) {
    if (btn) btn.disabled = true;
    return api({ action: 'scorereq', op: 'decide', req: rid, decision: approve ? 'approve' : 'decline' }).then(function (r) {
      toast(approve ? 'Approved · score updated' : 'Request declined');
      cache = {};
      Object.keys(REQS).forEach(function (k) { REQS[k] = (REQS[k] || []).filter(function (x) { return String(x.id) !== String(rid); }); });
      if (r && r.call && S.cur && r.call.id === S.cur.id) { S.cur = r.call; drawCall(); } else if (S.cur && $('cd')) drawCall();
      if ($('sreqs')) drawReqCard();
    }).catch(function (e) { if (btn) btn.disabled = false; toast(e.message || 'Couldn’t update that request.'); });
  }
  function drawReqCard() {
    if (!$('sreqs')) return;
    Promise.all([api({ action: 'scorereq', op: 'list' }), api({ action: 'calledit', op: 'list' }).catch(function () { return { rows: [] }; })]).then(function (rr) {
      var r = rr[0]; r.can_decide = r.can_decide || rr[1].can_decide; var L = (r.rows || []).concat((rr[1].rows || []).map(function (q) { q.ce = true; return q; })), el = $('sreqs'); if (!el) return;
      if (!L.length) { el.innerHTML = ''; el.style.display = 'none'; return; }
      el.style.display = '';
      el.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:10px;flex-wrap:wrap"><div><h2 class="ttl">Score Change Requests</h2><p class="sub">' + (r.can_decide ? 'Your team asked to change these scores or call details. Approve to update the call, or decline.' : 'Your requests waiting for your account admin.') + '</p></div><span class="pill" style="background:#EEF2FB;color:#2B3A67">' + L.length + ' waiting</span></div>' +
        L.map(function (q) {
          return '<div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;padding:10px 0;border-top:1px solid var(--line2)"><div style="flex:1 1 320px;min-width:0;font-size:13px;line-height:1.45"><b>' + esc(q.agent || 'CSR') + '</b> · ' + esc(short(q.brand || '')) + ' · ' + fdate(q.date) + (q.ce ? '<div>Call correction: <b>' + esc(ceText(q.changes)) + '</b></div>' : '<div>' + esc(q.label || q.key) + ': <b>' + (ANS[q.from] || q.from) + ' → ' + (ANS[q.to] || q.to) + '</b></div>') + '<div class="mut">' + esc(q.requested_by || '') + ' · ' + ago(q.at) + ': “' + esc(q.why || '') + '”</div></div>' +
            '<div class="row" style="gap:6px"><button class="sel" data-call="' + esc(q.review_id) + '">Open call</button>' + (r.can_decide ? '<button class="sel btnd" data-act="' + (q.ce ? 'cereqok' : 'reqok') + '" data-r="' + q.id + '">Approve</button><button class="sel" data-act="' + (q.ce ? 'cereqno' : 'reqno') + '" data-r="' + q.id + '">Decline</button>' : '') + '</div></div>';
        }).join('');
    }).catch(function () { var e2 = $('sreqs'); if (e2) e2.style.display = 'none'; });
  }

  // ---------- call record corrections (admins change directly; others request) ----------
  // display names for the AI topic tags: no catch-alls on screen (2026-10-24)
  function tLab(t) { return t === 'Repair - Door (General)' || t === 'Repair - Other' ? 'Repair - Door' : t === 'General Inquiry' ? 'Question' : t; }
  var TOPIC_LIST = ['New Door / Installation Quote', 'Repair - Spring', 'Repair - Opener', 'Repair - Cable', 'Repair - Panel/Section', 'Repair - Off Track', 'Repair - Door (General)', 'Maintenance / Tune-up', 'Warranty', 'Job Follow-up', 'Commercial Follow-up', 'Windows / Gates / Entry Doors', 'Reschedule / Cancel', 'Appointment Status', 'Parts Status', 'Billing / Invoice', 'Emergency', 'Asked for a Person / Message', 'Service Area / Routing', 'Price / Product Question', 'Wrong Number', 'Solicitation / Vendor'];
  var CLASSN = { conversation: 'Conversation', internal: 'Internal / staff call', voicemail: 'Voicemail', ivr_only: 'Phone menu / hold only', no_agent: 'No CSR on the call', wrong_number: 'Wrong number', spam: 'Spam / solicitation' };
  var REASON_LIST = ['Customer will call back', "We'll call them back (no appt set)", 'Sent to another team', 'Price', 'Needs to speak to homeowner', 'Scheduling/timing conflict', 'Shopping around / multiple quotes', 'Wants to think about it', 'Quote Request', 'Knowledge Gap', 'Sales Team', 'Gates Team', 'Policy', 'Reschedule', 'Canceling Appointment', 'Check Status Of Tech', 'Check Status of Parts', 'Invoice Request', 'Call ended before booking (hold / cut off)', "CSR didn't offer an appointment", 'Customer declined after the ask', 'Just wanted information', 'Solved over the phone', 'Referred to manufacturer / self-help', 'Outside service area'];
  var CE = {};
  function isCom(c) { return c.segment ? c.segment === 'Commercial' : (c.topics || []).some(function (t) { return /^commercial/i.test(t); }); }
  function ceText(ch) {
    ch = ch || {}; var out = [];
    if (ch.segment) out.push(ch.segment); if (ch.call_class) out.push(CLASSN[ch.call_class] || ch.call_class); if (ch.outcome) out.push('outcome ' + ch.outcome); if (ch.reason) out.push('reason ' + ch.reason);
    if (typeof ch.opportunity === 'boolean') out.push(ch.opportunity ? 'booking opportunity' : 'not an opportunity'); if (ch.agent) out.push('CSR ' + ch.agent); if (ch.topics) out.push('topics: ' + ch.topics.join(', '));
    if (ch.steps && ch.steps.length) out.push(ch.steps.length + ' step change' + (ch.steps.length > 1 ? 's' : ''));
    return out.join(' · ') || 'changes';
  }
  function factsBar(c) {
    var rq = (CE[c.id] || [])[0];
    // what the call was: product · residential / commercial · sales / service / warranty, then the call type (2026-10-24)
    var chips = [c.segment || (isCom(c) ? 'Commercial' : 'Residential')].concat(c.product ? [c.product] : [], c.line ? [c.line] : [], [CLASSN[c.call_class || 'conversation'] || c.call_class, c.opportunity ? 'Booking opportunity' : 'Not an opportunity']);
    var jn = c.journey || null, tp = tempOf(c.sentiment_score);
    var xtra = (tp ? '<span class="pill" title="Customer sentiment (never affects the score)" style="background:' + tp.col + '1A;color:' + tp.col + '">Temperature ' + c.sentiment_score + '/5 · ' + tp.label + '</span>' : '') +
      (jn && jn.legs > 1 ? '<span class="pill" style="background:#E8EAF4;color:#3A4380">Leg ' + jn.leg_no + ' of ' + jn.legs + '</span>' : '') +
      (jn && jn.journey && jn.journey !== 'CSR' ? '<span class="pill" style="background:#E8EAF4;color:#3A4380">' + esc(jn.journey) + '</span>' : (c.transfer_dept ? '<span class="pill" style="background:#E8EAF4;color:#3A4380">CSR \u2192 ' + esc(c.transfer_dept) + '</span>' : '')) +
      (jn ? '<span class="pill" style="' + (jn.fcr ? 'background:#E6F0EA;color:#1F5A41' : 'background:#FCEBDD;color:#A8441A') + '">' + (jn.fcr ? 'Resolved first contact' : 'Not resolved first contact') + '</span>' : '');
    return '<div class="oq-card" style="padding:12px 16px"><div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap"><div style="display:flex;flex-wrap:wrap;gap:6px">' + chips.map(function (x) { return '<span class="pill" style="background:#F3F1EC;color:#3B4541">' + esc(x) + '</span>'; }).join('') + xtra + '</div>' +
      (CAN_EDIT ? '<button class="sel" data-act="ceopen" style="padding:6px 12px;font-size:12.5px">' + (IS_ADMIN ? 'Edit call details' : 'Suggest a correction') + '</button>' : '') + '</div>' +
      (rq ? '<div style="margin-top:8px;font-size:12.5px;background:#EEF2FB;border-radius:8px;padding:7px 10px;color:#2B3A67"><b>' + esc(rq.requested_by || 'Someone') + ' asked to correct this call</b> · ' + ago(rq.at) + ': ' + esc(ceText(rq.changes)) + (rq.why ? ' · “' + esc(rq.why) + '”' : '') + (IS_ADMIN ? ' <button class="more" data-act="cereqok" data-r="' + rq.id + '">Approve</button> <button class="more" data-act="cereqno" data-r="' + rq.id + '">Decline</button>' : ' <span class="mut">Waiting for your account admin.</span>') + '</div>' : '') + '</div>';
  }
  function loadCe(id, force) {
    if (!CAN_EDIT || (CE[id] && !force)) return;
    CE[id] = CE[id] || [];
    api({ action: 'calledit', op: 'forcall', id: id }).then(function (r) { var had = JSON.stringify(CE[id] || []); CE[id] = r.rows || []; if (S.cur && S.cur.id === id && JSON.stringify(CE[id]) !== had) drawCall(); }).catch(function () {});
  }
  function ceModal() {
    var c = S.cur; if (!c) return;
    var com = isCom(c), tp = (c.topics || []).filter(function (t) { return !/^commercial/i.test(t); });
    var opts = function (list, cur, lab) { return list.map(function (v) { return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(lab ? lab[v] || v : v) + '</option>'; }).join(''); };
    var L = document.createElement('div');
    L.innerHTML = '<div class="overlay" id="ced" style="justify-content:center;align-items:center;z-index:70"><div class="oq-card" role="dialog" aria-modal="true" aria-label="Edit call details" style="width:560px;max-width:calc(100% - 32px);max-height:calc(100vh - 40px);overflow:auto;padding:22px;display:flex;flex-direction:column;gap:12px">' +
      '<div class="cap">' + (IS_ADMIN ? 'Edit call details' : 'Suggest a correction') + '</div>' +
      '<div><div class="l">Residential or commercial</div><div class="seg"><button class="' + (!com ? 'on' : '') + '" data-ceseg="Residential">Residential</button><button class="' + (com ? 'on' : '') + '" data-ceseg="Commercial">Commercial</button></div></div>' +
      '<div class="row" style="gap:10px"><div style="flex:1 1 200px"><label class="l" for="ceo">Outcome</label><select id="ceo" class="oq-field">' + opts(['Booked', 'Not Booked', 'Transferred', 'No Opportunity'], c.outcome) + '</select></div><div style="flex:1 1 200px"><label class="l" for="cer">Why it didn’t book</label><select id="cer" class="oq-field"><option value="">—</option>' + opts(REASON_LIST, c.reason) + '</select></div></div>' +
      '<div class="row" style="gap:10px"><div style="flex:1 1 200px"><label class="l" for="cec">Call type</label><select id="cec" class="oq-field">' + opts(Object.keys(CLASSN), c.call_class || 'conversation', CLASSN) + '</select></div><div style="flex:1 1 200px"><label class="l" for="cea">CSR</label><input id="cea" class="oq-field" value="' + esc(c.agent || '') + '"></div></div>' +
      '<label style="display:flex;gap:8px;align-items:center;font-size:13px"><input type="checkbox" id="ceop"' + (c.opportunity ? ' checked' : '') + '> This was a booking opportunity</label>' +
      '<div><div class="l">What the call was about</div><div style="display:flex;flex-wrap:wrap;gap:6px">' + TOPIC_LIST.map(function (t) { return '<label class="chip' + (tp.indexOf(t) >= 0 ? ' on' : '') + '" style="cursor:pointer"><input type="checkbox" data-cetopic="' + esc(t) + '"' + (tp.indexOf(t) >= 0 ? ' checked' : '') + ' style="position:absolute;opacity:0;width:1px;height:1px">' + esc(tLab(t)) + '</label>'; }).join('') + '</div></div>' +
      '<div><label class="l" for="cew">Why are you changing it?' + (IS_ADMIN ? ' (optional)' : ' (required)') + '</label><textarea id="cew" class="oq-field" style="min-height:60px" maxlength="1000" placeholder="e.g. The caller is Land Rover of Austin, so this is a commercial call."></textarea></div>' +
      '<div class="mut" style="font-size:12px">' + (IS_ADMIN ? 'Saves right away. Every change is logged with who made it.' : 'Goes to your account admin to approve.') + '</div>' +
      '<div class="row" style="justify-content:flex-end"><button class="sel" data-act="cecancel">Cancel</button><button class="sel btnd" data-act="cesave">' + (IS_ADMIN ? 'Save' : 'Send to my admin') + '</button></div></div></div>';
    ROOT.appendChild(L.firstChild); S.ceSeg = com ? 'Commercial' : 'Residential';
  }
  function ceCollect() {
    var c = S.cur, ch = {}, tp = Array.prototype.slice.call(document.querySelectorAll('[data-cetopic]')).filter(function (x) { return x.checked; }).map(function (x) { return x.getAttribute('data-cetopic'); });
    var old = (c.topics || []).filter(function (t) { return !/^commercial/i.test(t); });
    if (S.ceSeg !== (isCom(c) ? 'Commercial' : 'Residential')) ch.segment = S.ceSeg;
    if (JSON.stringify(tp.slice().sort()) !== JSON.stringify(old.slice().sort())) ch.topics = (S.ceSeg === 'Commercial' ? ['Commercial'] : []).concat(tp);
    var o = $('ceo').value; if (o !== c.outcome) ch.outcome = o;
    var rs = $('cer').value || null; if (o === 'Not Booked' && rs !== (c.reason || null)) ch.reason = rs;
    var cl = $('cec').value; if (cl !== (c.call_class || 'conversation')) ch.call_class = cl;
    var op = $('ceop').checked; if (op !== !!c.opportunity) ch.opportunity = op;
    var ag = $('cea').value.trim(); if (ag && ag !== (c.agent || '')) ch.agent = ag;
    return ch;
  }
  function ceSave(btn) {
    var ch = ceCollect(), why = $('cew').value.trim(), id = S.cur.id;
    if (!Object.keys(ch).length) { toast('Nothing changed'); return; }
    if (!IS_ADMIN && !why) { toast('Add a short reason for your admin'); return; }
    btn.disabled = true; btn.textContent = 'Saving…';
    api({ action: 'calledit', op: 'save', id: id, changes: ch, why: why || null }).then(function (r) {
      var m = $('ced'); if (m) m.remove();
      if (r.applied) { cache = {}; if (S.callId === id && r.call) { S.cur = r.call; drawCall(); } toast('Call updated'); }
      else { toast(r.admins ? 'Sent to your account admin' : 'Saved. Your account has no admin login yet.'); loadCe(id, true); }
    }).catch(function (e) { btn.disabled = false; btn.textContent = IS_ADMIN ? 'Save' : 'Send to my admin'; toast(e.message || 'Couldn’t save.'); });
  }
  function ceDecide(rid, approve, btn) {
    if (btn) btn.disabled = true;
    api({ action: 'calledit', op: 'decide', req: rid, decision: approve ? 'approve' : 'decline' }).then(function (r) {
      toast(approve ? 'Approved · call updated' : 'Declined'); cache = {};
      Object.keys(CE).forEach(function (k) { CE[k] = (CE[k] || []).filter(function (x) { return String(x.id) !== String(rid); }); });
      if (r && r.call && S.cur && r.call.id === S.cur.id) { S.cur = r.call; drawCall(); } else if (S.cur && $('cd')) drawCall();
      if ($('sreqs')) drawReqCard();
    }).catch(function (e) { if (btn) btn.disabled = false; toast(e.message || 'Couldn’t update that request.'); });
  }

  // ---------- Ask panel ----------
  function md(t) {
    var s = esc(t || '');
    s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    s = s.replace(/\[call:([0-9a-f-]{36})\]/gi, '<span class="lnk" data-call="$1" role="button" tabindex="0">open call ↗</span>');
    var lines = s.split(/\n/), out = '', inList = false;
    lines.forEach(function (l) {
      var m = l.match(/^\s*[-•*]\s+(.*)$/);
      if (m) { if (!inList) { out += '<ul>'; inList = true; } out += '<li>' + m[1] + '</li>'; }
      else { if (inList) { out += '</ul>'; inList = false; } if (l.trim()) out += '<p style="margin:6px 0">' + l + '</p>'; }
    });
    if (inList) out += '</ul>';
    // link known brands and CSRs
    var names = Object.keys(SHORT).concat(KNOWN.brands).filter(function (v, i, a) { return a.indexOf(v) === i; });
    names.sort(function (a, b) { return b.length - a.length; }).forEach(function (b) { out = out.replace(new RegExp('(^|[^\\w"=])(' + b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?![\\w<])', 'g'), '$1<span class="lnk" data-brand="' + esc(b) + '" role="button" tabindex="0">$2</span>'); });
    KNOWN.agents.filter(function (a) { return a.length >= 4; }).sort(function (a, b) { return b.length - a.length; }).forEach(function (a) { out = out.replace(new RegExp('(^|[\\s(>])(' + a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?=[\\s,.;:)’\'s]|$)', 'g'), '$1<span class="lnk" data-agent="' + esc(a) + '" role="button" tabindex="0">$2</span>'); });
    return out;
  }
  function suggestList() { var b = askBrand(); return b ? ['Who is the top performer at ' + b + '?', 'Why is ' + b + '’s score trending down?', 'Which CSRs never ask for the card?', 'What are customers objecting to most?', 'Which calls should we coach on this week?', 'Show me a great call I can use for training'] : SUGGEST; }
  var SUGGEST = ['Who is the top performer at Cedar Park?', 'Why is Cheney’s score trending down?', 'Which CSRs never ask for the card?', 'What are customers objecting to most?', 'Compare Apple and Omaha', 'Show me a great call I can use for training'];
  function askPanel() {
    var A = S.ask, h = '<div class="overlay" data-close="1"><div class="drawer" role="dialog" aria-modal="true" aria-label="Ask your call data" style="background:#fff"><div style="display:flex;justify-content:space-between;gap:12px;align-items:center"><div style="display:flex;gap:10px;align-items:center"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2F7D5B" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/></svg><div><b style="font-size:16px">Ask your call data</b><div class="mut" style="font-size:12px">' + (S.brands.length ? S.brands.map(short).join(', ') : 'All brands') + ' · ' + fdate(S.start) + ' – ' + fdate(S.end) + '</div></div></div><button class="sel" data-close="1" aria-label="Close" style="width:44px;justify-content:center">✕</button></div><div id="convo" style="display:flex;flex-direction:column;gap:12px;flex:1">';
    if (!A.msgs.length) h += '<p class="mut" style="font-size:13px">Ask anything about your calls, brands and CSRs. Answers are built from your live call data.</p><div style="display:flex;flex-direction:column;gap:6px">' + suggestList().map(function (q) { return '<button class="chip" data-ask="' + esc(q) + '">' + esc(q) + '</button>'; }).join('') + '</div>';
    A.msgs.forEach(function (m) {
      if (m.role === 'user') h += '<div style="align-self:flex-end;background:var(--side);color:#fff;border-radius:14px 14px 4px 14px;padding:10px 14px;max-width:85%;font-size:13.5px">' + esc(m.content) + '</div>';
      else h += '<div class="ai" style="max-width:100%"><div class="md">' + (m.error ? '<span style="color:#A8441A">' + esc(m.content) + '</span>' : md(m.content)) + '</div></div>';
    });
    if (A.busy) h += '<div class="ai"><span class="dots"><span></span><span></span><span></span></span> <span class="mut" style="font-size:13px">Looking through your calls…</span></div>';
    h += '</div><form id="askform2" style="display:flex;gap:8px;position:sticky;bottom:0;background:#fff;padding-top:8px"><label class="sr" for="askq2">Follow-up question</label><input id="askq2" class="oq-field" placeholder="Ask a follow-up…" autocomplete="off"' + (A.busy ? ' disabled' : '') + '><button class="sel btnd" type="submit"' + (A.busy ? ' disabled' : '') + '>Ask</button></form></div></div>';
    $('layer').innerHTML = h;
    var cv = $('convo'); if (cv) cv.parentNode.scrollTop = cv.parentNode.scrollHeight;
    var i2 = $('askq2'); if (i2 && !A.busy) i2.focus();
  }
  function phoneQ(q) { var s = String(q || '').trim(), d = s.replace(/\D/g, ''); if (!/^[\d\s()+.\-]+$/.test(s) || d.length < 7) return null; return d.length === 11 && d[0] === '1' ? d.slice(1) : d; }
  function ask(q) {
    q = (q || '').trim(); if (!q) return;
    if (phoneQ(q)) { openCalls({ q: q }); return; }
    var A = S.ask; A.open = true; S.callId = null;
    var history = A.msgs.filter(function (m) { return !m.error; }).slice(-6);
    A.msgs.push({ role: 'user', content: q }); A.busy = true; askPanel();
    api({ action: 'ask', question: q, history: history, start: S.start, end: S.end, brands: S.brands.length ? S.brands : null }).then(function (r) {
      A.msgs.push({ role: 'assistant', content: r.answer }); A.busy = false; if (A.open) askPanel();
    }).catch(function (e) { A.msgs.push({ role: 'assistant', content: e.message, error: true }); A.busy = false; if (A.open) askPanel(); });
  }

  // ---------- Calibration (2026-10-22) ----------
  // Blind audits that keep the AI scorer honest. Each weekday the tool picks a set of yesterday's
  // calls (Monday covers Fri–Sun). The quality team scores each one without seeing the AI's answers,
  // then sees the AI's answers side by side. Disagreements feed "Suggested scoring rules".
  // API: opsis-qa-calibration (actions calib*). State lives in CAL; the audit form only redraws itself
  // (never the player) so the recording keeps playing while the auditor scores.
  var CAN_CAL = !CFG.csrSelf && !LOCK && ROLE !== 'viewer';
  var CAL = { whyDraft: {}, tab: 'today', day: null, data: null, busy: false, item: null, form: null, t0: 0, stats: null, sdays: 30, why: {}, skip: false, open: {} };
  var CANS = { yes: 'Done', no: 'Missed', na: 'N/A' };
  var CPICK = { random: 'Random', not_booked: 'Not booked', booked: 'Booked', low: 'Low AI score', high: 'High AI score', no_opp: 'No opportunity / transfer', replacement: 'Replacement' };
  function calPct(v) { return v == null ? '—' : Math.round(v * 100) + '%'; }
  function calAns(a) { return CANS[a] || (a === true || a === 'true' ? 'Yes' : a === false || a === 'false' ? 'No' : (a == null ? '—' : String(a))); }
  function calChip(a) { var c = a === 'yes' || a === true || a === 'true' ? 'background:#E6F0EA;color:#1F5A41' : a === 'no' || a === false || a === 'false' ? 'background:#FCEBDD;color:#A8441A' : 'background:#F3F1EC;color:#3B4541'; return '<span class="pill" style="' + c + '">' + esc(calAns(a)) + '</span>'; }
  function stepName(l) { var s = String(l || ''), i = s.indexOf(':'); return i > 0 ? s.slice(0, i) : s; }
  function stepDesc(l) { var s = String(l || ''), i = s.indexOf(':'); return i > 0 ? s.slice(i + 1).trim() : ''; }
  function fday(d) { if (!d) return ''; var x = new Date(d + 'T12:00:00Z'); return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][x.getUTCDay()] + ' ' + fdate(d); }
  function calTime(it) { return it.started ? new Date(it.started).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET' : (it.hour != null ? fhour(it.hour) : ''); }
  function calBrandOk(b) { return !S.brands.length || S.brands.indexOf(b) >= 0; }
  function calRelease() { var it = CAL.item; if (it && it.status === 'open') api({ action: 'calibrelease', id: it.id }).catch(function () {}); }
  function calLeave() { stopAudio(); P.id = null; calRelease(); CAL.item = null; CAL.form = null; CAL.skip = false; }

  function vCalib(tok) {
    if (!CAN_CAL) { S.view = 'overview'; return vOverview(tok); }
    if (CAL.item) return drawAuditPage();
    var tabs = '<div class="seg" role="tablist" style="margin-top:4px">' + [['today', 'Daily audits'], ['results', 'AI vs. your team']].map(function (t) { return '<button role="tab" aria-selected="' + (CAL.tab === t[0]) + '" class="' + (CAL.tab === t[0] ? 'on' : '') + '" data-cal="tab" data-v="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>';
    setMain(crumb([['Calibration']]) + '<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap"><div><h1 style="margin:0;font-size:24px;font-weight:600;letter-spacing:-0.02em">Calibration</h1><p class="sub" style="max-width:720px">Your quality team scores a few calls blind every weekday. The AI’s answers stay hidden until you submit, then you see both side by side. Every difference teaches the AI through Suggested scoring rules.</p></div>' + tabs + '</div><div id="calwrap"><div class="oq-card">' + skel(36, 6) + '</div></div>');
    if (CAL.tab === 'results') return calLoadStats(tok);
    calLoadDay(tok);
  }
  function calLoadDay(tok, quiet) {
    api({ action: 'calibday', day: CAL.day || null }).then(function (d) { if (tok != null && tok !== T) return; CAL.data = d; if (!CAL.day) CAL.day = d.day; drawCalDay(); })
      .catch(function (e) { if (!quiet && $('calwrap')) $('calwrap').innerHTML = errBox(e); });
  }
  function drawCalDay() {
    var w = $('calwrap'), d = CAL.data; if (!w || !d) return;
    var allItems = d.items || [], items = allItems.filter(function (i) { return calBrandOk(i.brand); }), done = items.filter(function (i) { return i.status === 'done'; }), skipped = items.filter(function (i) { return i.status === 'skipped'; });
    var target = items.length - skipped.length, ag = 0, tot = 0; done.forEach(function (i) { ag += i.agree || 0; tot += i.steps || 0; });
    var tiles = '<div class="row">' +
      mnTile('Audited', done.length + ' <span class="mut" style="font-size:16px">of ' + target + '</span>', d.day === d.today ? 'Today’s blind audits' : 'Blind audits for ' + fday(d.day), done.length >= target && target ? '#1F5A41' : '') +
      mnTile('Agreement with the AI', tot ? calPct(ag / tot) : '—', tot ? ag + ' of ' + tot + ' steps scored the same' : 'Shows once a call is audited', '#2B3A67', 'Steps where your answer matched the AI’s answer, before anyone saw the AI’s answer.') +
      mnTile('Left to do', String(Math.max(target - done.length, 0)), skipped.length ? skipped.length + ' skipped and replaced' : 'About 6 minutes per call', Math.max(target - done.length, 0) ? '#A8441A' : '') + '</div>';
    var hist = (d.days || []).slice(-10);
    var picker = '<label class="sr" for="calday">Pick a day</label><input type="date" id="calday" class="oq-field" style="width:auto;padding:4px 8px;min-height:30px;font-size:12.5px" max="' + esc(d.today || '') + '" value="' + esc(d.day || '') + '" title="Pick any day">';
    var dayChips = hist.length ? '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><span class="cap" style="margin-right:4px">Day</span>' + picker + hist.map(function (h) {
      var full = h.done >= h.total - h.skipped && h.total; return '<button class="chip' + (h.day === d.day ? ' on' : '') + '" data-cal="day" data-v="' + h.day + '" style="min-height:30px;padding:4px 10px;font-size:12px">' + esc(fday(h.day)) + ' <span class="num" style="opacity:.75">' + h.done + '/' + (h.total - h.skipped) + (full ? ' ✓' : '') + '</span></button>'; }).join('') + '</div>' : '<div style="display:flex;gap:6px;align-items:center"><span class="cap">Day</span>' + picker + '</div>';
    var cfg = d.can_config ? '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><label class="l" for="calper" style="margin:0">Calls per weekday</label><select id="calper" class="oq-field" style="width:auto;padding:6px 10px">' + [5, 8, 10, 12, 15, 20].concat([d.per_day]).filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(function (a, b) { return a - b; }).map(function (n) { return '<option value="' + n + '"' + (n === d.per_day ? ' selected' : '') + '>' + n + (n === 10 ? ' (suggested)' : '') + '</option>'; }).join('') + '</select><button class="sel" data-cal="saveper" style="min-height:34px;padding:5px 12px">Save</button><span class="mut" style="font-size:12px">Starts with the next day’s set.</span></div>' : '';
    var list;
    if (!d.weekday) list = '<div class="mut" style="padding:14px 0">No audits on weekends. The Monday set covers Friday through Sunday calls.</div>';
    else if (!items.length) list = '<div class="mut" style="padding:14px 0">' + (allItems.length ? 'None of this day’s calls are for the brand you picked. <button class="lnk" data-allbrands="1">Show all brands</button>' : d.enabled ? 'No calls were picked for this day.' : 'Calibration is turned off for this account.') + '</div>';
    else list = items.map(function (it) {
      var st, btn;
      if (it.status === 'done') { st = '<span class="pill" style="background:#E6F0EA;color:#1F5A41">Done · ' + esc(it.auditor || '') + '</span>' + (it.steps ? ' <span class="pill num" style="' + (it.agree === it.steps ? 'background:#E6F0EA;color:#1F5A41' : 'background:#FCEBDD;color:#A8441A') + '">' + it.agree + '/' + it.steps + ' match</span>' : ''); btn = '<button class="sel" data-cal="open" data-v="' + it.id + '">See result</button>'; }
      else if (it.status === 'skipped') { st = '<span class="pill" style="background:#F3F1EC;color:#56605B" title="' + esc(it.skip_reason || '') + '">Skipped</span>'; btn = ''; }
      else if (it.claimed && !it.claimed.me) { st = '<span class="pill" style="background:#E8EAF4;color:#3A4380">' + esc(it.claimed.name || 'Someone') + ' is on it</span>'; btn = '<button class="sel" data-cal="open" data-v="' + it.id + '" data-take="1">Take over</button>'; }
      else { st = it.claimed ? '<span class="pill" style="background:#E8EAF4;color:#3A4380">You started this</span>' : '<span class="pill" style="background:#FFF3E0;color:#8A5A2B">To do</span>'; btn = '<button class="sel btnd" data-cal="open" data-v="' + it.id + '">' + (it.claimed ? 'Continue' : 'Start audit') + '</button>'; }
      return '<div style="display:flex;gap:12px;align-items:center;padding:12px 0;border-top:1px solid var(--line2);flex-wrap:wrap">' +
        '<span class="num mut" style="width:26px;font-weight:600">' + it.slot + '</span>' + bbadge(it.brand) +
        '<span style="flex:1 1 220px;min-width:0"><b style="font-weight:600">' + esc(it.agent || 'Unknown CSR') + '</b> <span class="mut" style="font-size:12.5px">· ' + esc(short(it.brand)) + '</span><span class="mut" style="display:block;font-size:12.5px;margin-top:2px">' + esc(fday(it.date)) + (calTime(it) ? ' · ' + calTime(it) : '') + ' · ' + esc(it.direction || '') + ' · ' + fsecs(it.secs) + (it.pick_reason ? ' · picked: ' + esc(CPICK[it.pick_reason] || it.pick_reason) : '') + '</span></span>' +
        '<span style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">' + st + '</span>' + btn + '</div>';
    }).join('');
    w.innerHTML = tiles + '<div class="oq-card"><div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start"><div><h2 class="ttl">' + (d.day === d.today ? 'Today’s calls' : 'Calls for ' + esc(fday(d.day))) + '</h2><p class="sub">Picked at 6am from the previous workday: a random mix plus booked, not-booked, high, low and no-opportunity calls, spread across brands. Why each call was picked shows after it’s audited, so it can’t sway you.</p></div>' + cfg + '</div><div style="margin-top:10px">' + dayChips + '</div><div style="margin-top:6px">' + list + '</div></div>';
    var cdp = $('calday'); if (cdp) cdp.addEventListener('change', function () { if (!/^\d{4}-\d{2}-\d{2}$/.test(cdp.value)) return; CAL.day = cdp.value; $('calwrap').insertAdjacentHTML('afterbegin', '<div class="banner">Loading ' + esc(fday(cdp.value)) + '…</div>'); calLoadDay(null); });
  }

  // ----- the audit screen -----
  function calOpen(id, take) {
    if (CAL.busy) return; CAL.busy = true;
    var w = $('calwrap'); if (w) w.insertAdjacentHTML('afterbegin', '<div class="banner" id="calopening">Opening the call…</div>');
    api({ action: 'calibopen', id: +id, take: !!take }).then(function (it) {
      CAL.busy = false; CAL.item = it; CAL.skip = false; CAL.t0 = Date.now();
      CAL.form = { steps: {}, opp: null, outcome: '', note: '' };
      S.cur = Object.assign({ steps: [] }, it.call); TR.open[it.call.id] = true;
      loadAudio(it.call.id);
      EXT = function () { calLeave(); };
      window.scrollTo(0, 0); drawAuditPage();
    }).catch(function (e) { CAL.busy = false; var b = $('calopening'); if (b) b.remove(); toast(e.message || 'Couldn’t open that call.'); calLoadDay(null, true); });
  }
  function drawAuditPage() {
    var it = CAL.item, c = it.call, d = CAL.data || {}, items = d.items || [];
    var head = '<div class="oq-card" style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">' + bbadge(c.brand) + '<div style="flex:1 1 260px;min-width:0"><div style="font-weight:600;font-size:16px">' + esc(c.agent || 'Unknown CSR') + ' <span class="mut" style="font-weight:400;font-size:13px">· ' + esc(c.brand || '') + '</span></div><div class="mut" style="font-size:12.5px;margin-top:3px">' + esc(fday(c.date)) + (calTime(c) ? ' · ' + calTime(c) : '') + ' · ' + esc(c.direction || '') + ' · ' + fsecs(c.secs) + ' · call ' + it.slot + (items.length ? ' of ' + items.length : '') + '</div></div>' +
      (it.status === 'open' ? '<span class="pill" style="background:#E8EAF4;color:#3A4380">Blind audit · AI score hidden</span>' : '') + '<button class="sel" data-cal="back">Back to the list</button></div>';
    setMain(crumb([['Calibration', 'calib'], ['Call ' + it.slot]]) + head +
      '<div class="row" style="align-items:flex-start"><div style="flex:1 1 380px;min-width:0;display:flex;flex-direction:column;gap:14px"><div class="oq-card" id="plr">' + playerInner() + '</div>' + trCard(S.cur) + '</div>' +
      '<div style="flex:1 1 420px;min-width:0" id="calform"></div></div>');
    bindTr(); drawCalForm();
  }
  function seg3(k, cur, allowNa) {
    return '<div class="seg" role="group" aria-label="Answer">' + ['yes', 'no'].concat(allowNa ? ['na'] : []).map(function (a) { return '<button type="button" data-cal="ans" data-k="' + k + '" data-v="' + a + '" aria-pressed="' + (cur === a) + '" class="' + (cur === a ? 'on' : '') + '">' + CANS[a] + '</button>'; }).join('') + '</div>';
  }
  function drawCalForm() {
    var el = $('calform'), it = CAL.item; if (!el || !it) return;
    if (it.result) { el.innerHTML = calResultHtml(it); return; }
    var F = CAL.form, steps = it.steps || [], answered = steps.filter(function (s) { return F.steps[s.key] && F.steps[s.key].answer; }).length;
    var h = '<div class="oq-card"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><h2 class="ttl">Score this call</h2><span class="mut num" style="font-size:12.5px">' + answered + ' of ' + steps.length + ' steps</span></div><p class="sub">Listen and score each step the way your team would. Missed? Tick what was missed. A short note on any step helps the AI learn.</p>';
    steps.forEach(function (s) {
      var f = F.steps[s.key] || {}, open = CAL.open[s.key];
      h += '<div class="step" style="padding:14px 0 12px"><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap"><div style="flex:1 1 220px;min-width:0"><div style="font-weight:600">' + esc(stepName(s.label)) + ' <span class="mut num" style="font-weight:400;font-size:12px">· ' + s.points + ' pts</span></div><div class="mut" style="font-size:12.5px;line-height:1.45;margin-top:2px">' + esc(stepDesc(s.label)) + '</div></div>' + seg3(s.key, f.answer, s.allow_na !== false) + '</div>' +
        (f.answer === 'no' && (s.misses || []).length ? '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">' + s.misses.map(function (m) { var on = (f.misses || []).indexOf(m) >= 0; return '<button type="button" class="chip' + (on ? ' on' : '') + '" aria-pressed="' + on + '" data-cal="miss" data-k="' + s.key + '" data-v="' + esc(m) + '" style="min-height:30px;padding:4px 10px;font-size:12px">' + esc(m) + '</button>'; }).join('') + '</div>' : '') +
        '<div style="display:flex;gap:10px;align-items:center;margin-top:8px;flex-wrap:wrap"><label class="sr" for="caln-' + s.key + '">Note for ' + esc(stepName(s.label)) + '</label><input id="caln-' + s.key + '" data-calnote="' + s.key + '" class="oq-field" placeholder="Note (optional): what you heard" value="' + esc(f.note || '') + '" style="flex:1 1 220px;padding:7px 10px;font-size:13px">' +
        (s.guidance ? '<button type="button" class="more" data-cal="rule" data-k="' + s.key + '">' + (open ? 'Hide rule' : 'Scoring rule') + '</button>' : '') + '</div>' +
        (open && s.guidance ? '<div style="background:#FAF8F4;border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-size:12.5px;line-height:1.55;margin-top:8px">' + esc(s.guidance) + '</div>' : '') + '</div>';
    });
    h += '<div class="step" style="padding:14px 0 6px"><div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap"><div style="font-weight:600">Was this a booking opportunity?</div><div class="seg" role="group" aria-label="Booking opportunity">' + [[true, 'Yes'], [false, 'No']].map(function (o) { return '<button type="button" data-cal="opp" data-v="' + o[0] + '" aria-pressed="' + (F.opp === o[0]) + '" class="' + (F.opp === o[0] ? 'on' : '') + '">' + o[1] + '</button>'; }).join('') + '</div></div>' +
      '<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px"><label for="calout" style="font-weight:600">How did the call end?</label><select id="calout" class="oq-field" style="width:auto;min-width:200px"><option value="">Pick one…</option>' + (it.outcomes || []).map(function (o) { return '<option' + (F.outcome === o ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select></div>' +
      '<label class="l" for="calnote" style="margin-top:14px">Anything else about this call? (optional)</label><textarea id="calnote" class="oq-field" rows="2" placeholder="e.g. Recording cuts off at the end">' + esc(F.note || '') + '</textarea></div>';
    var ready = answered === steps.length && F.opp != null && F.outcome;
    h += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;align-items:center"><button class="sel btnd" data-cal="submit"' + (ready ? '' : ' aria-disabled="true" style="opacity:.55"') + '>Submit and see the AI’s answers</button><button class="sel" data-cal="skipask">Can’t audit this call</button></div>';
    if (CAL.skip) h += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;align-items:center"><label class="sr" for="calskip">Why can’t you audit it?</label><input id="calskip" class="oq-field" placeholder="e.g. No audio, wrong call, voicemail" style="flex:1 1 240px"><button class="sel" data-cal="skip">Skip and replace</button></div>';
    h += '</div>';
    el.innerHTML = h;
  }
  function calSync() {
    var F = CAL.form; if (!F) return;
    document.querySelectorAll('[data-calnote]').forEach(function (i) { var k = i.getAttribute('data-calnote'); F.steps[k] = F.steps[k] || {}; F.steps[k].note = i.value; });
    var o = $('calout'); if (o) F.outcome = o.value; var n = $('calnote'); if (n) F.note = n.value;
  }
  function calSubmit(btn) {
    calSync(); var it = CAL.item, F = CAL.form;
    var miss = (it.steps || []).filter(function (s) { return !(F.steps[s.key] && F.steps[s.key].answer); });
    if (miss.length) { toast('Score ' + stepName(miss[0].label) + ' first.'); return; }
    if (F.opp == null) { toast('Say whether it was a booking opportunity.'); return; }
    if (!F.outcome) { toast('Pick how the call ended.'); return; }
    var steps = {}; Object.keys(F.steps).forEach(function (k) { var s = F.steps[k]; steps[k] = { answer: s.answer, misses: s.misses || [], note: s.note || '' }; });
    btn.disabled = true; btn.textContent = 'Submitting…';
    api({ action: 'calibsubmit', id: it.id, steps: steps, opportunity: F.opp, outcome: F.outcome, note: F.note || '', secs: Math.round((Date.now() - CAL.t0) / 1000) }).then(function (r) {
      CAL.item = r; CAL.stats = null; drawCalForm(); var hd = document.querySelector('#main .pill'); if (hd && /Blind audit/.test(hd.textContent)) hd.remove();
      var fm = $('calform'); if (fm) fm.scrollIntoView({ behavior: 'smooth', block: 'start' }); calLoadDay(null, true);
    }).catch(function (e) { btn.disabled = false; btn.textContent = 'Submit and see the AI’s answers'; toast(e.message || 'Couldn’t submit.'); });
  }
  function evBtn(ev) { var ts = tsList(ev); return ts.length ? ' <button type="button" class="more" data-seek="' + ts[0] + '" style="min-height:24px">▶ ' + clock(ts[0]) + '</button>' : ''; }
  function calResultHtml(it) {
    var r = it.result, d = CAL.data || {};
    if (it.status === 'skipped') return '<div class="oq-card"><h2 class="ttl">Skipped</h2><p class="sub">' + esc(it.skip_reason || '') + '</p></div>';
    var gap = (+r.human_score || 0) - (+r.ai_score || 0);
    var h = '<div class="row">' + mnTile('Your score', r.human_score == null ? '—' : Math.round(r.human_score), 'Same points as the AI uses') + mnTile('AI score', r.ai_score == null ? '—' : Math.round(r.ai_score), (Math.abs(gap) < 0.5 ? 'Same as yours' : (gap > 0 ? 'AI was ' + Math.round(gap) + ' pts stricter' : 'AI was ' + Math.round(-gap) + ' pts more generous')), Math.abs(gap) >= 10 ? '#A8441A' : '') +
      mnTile('Steps that match', r.agree + '/' + r.total, 'Picked as: ' + esc(CPICK[r.pick_reason] || r.pick_reason || ''), r.agree === r.total ? '#1F5A41' : '#A8441A') + '</div>';
    h += '<div class="oq-card" style="margin-top:12px"><h2 class="ttl">Your answers vs. the AI</h2><p class="sub">Where you differ, read the AI’s reasoning. If the AI was right, say so and that difference won’t be used to retrain it. Otherwise your answer stands and goes into Suggested scoring rules.</p>';
    var row = function (key, name, mine, ai, agree, verdict, extra) {
      var wy = (r.whys || {})[key] || '', need = !agree && verdict !== 'ai';
      var wb = need ? '<div style="margin-top:8px;background:' + (wy ? '#F5F3EE' : '#FFF4E8') + ';border-radius:10px;padding:8px 10px"><label class="l" for="calwhy-' + key + '" style="margin:0 0 4px;font-size:12px">' + (wy ? 'Why your answer stands' : 'Why does your answer stand? <span style="color:#A8441A">Required</span>') + '</label><div style="display:flex;gap:8px;flex-wrap:wrap"><input id="calwhy-' + key + '" data-calwhy="' + key + '" class="oq-field" maxlength="1000" placeholder="e.g. They said the brand name at 0:04, the transcript missed it" value="' + esc(CAL.whyDraft[key] != null ? CAL.whyDraft[key] : wy) + '" style="flex:1 1 240px;padding:7px 10px;font-size:13px"><button type="button" class="sel' + (wy ? '' : ' btnd') + '" data-cal="savewhy" data-k="' + key + '" style="min-height:34px;padding:5px 12px">' + (wy ? 'Update' : 'Save') + '</button></div><div class="mut" style="font-size:11.5px;margin-top:4px">This goes straight into the AI vs. your team explanation and Suggested scoring rules.</div></div>' : '';
      var vb = agree ? '' : '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button type="button" class="chip' + (verdict !== 'ai' ? ' on' : '') + '" data-cal="verdict" data-k="' + key + '" data-v="me" style="min-height:30px;padding:4px 10px;font-size:12px">My answer stands</button><button type="button" class="chip' + (verdict === 'ai' ? ' on' : '') + '" data-cal="verdict" data-k="' + key + '" data-v="ai" style="min-height:30px;padding:4px 10px;font-size:12px">The AI was right</button></div>';
      return '<div class="step" style="padding:14px 0;' + (agree ? '' : 'background:linear-gradient(90deg,#FFF8F2,transparent)') + '"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center"><b style="font-weight:600">' + esc(name) + '</b><span style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:12.5px"><span class="mut">You</span>' + calChip(mine) + '<span class="mut">AI</span>' + calChip(ai) + (agree ? '<span class="pill" style="background:#E6F0EA;color:#1F5A41">✓ Match</span>' : '<span class="pill" style="background:#FCEBDD;color:#A8441A">Different</span>') + '</span></div>' + (extra || '') + vb + wb + '</div>';
    };
    (r.steps || []).forEach(function (s) {
      var ex = '';
      if (s.human_misses && s.human_misses.length) ex += '<div style="font-size:12.5px;margin-top:6px"><span class="mut">You marked missed:</span> ' + esc(s.human_misses.join(', ')) + '</div>';
      if (s.ai_misses && s.ai_misses.length) ex += '<div style="font-size:12.5px;margin-top:4px"><span class="mut">AI marked missed:</span> ' + esc(s.ai_misses.join(', ')) + '</div>';
      if (!s.agree || CAL.open['r_' + s.key]) ex += '<div style="font-size:12.5px;line-height:1.5;margin-top:6px"><span class="mut">AI’s reasoning:</span> ' + esc(s.rationale || '—') + (s.evidence ? '<div class="mut" style="margin-top:3px">“' + esc(s.evidence) + '”' + evBtn(s.evidence) + '</div>' : '') + '</div>';
      else ex += '<button type="button" class="more" data-cal="rule" data-k="r_' + s.key + '" style="min-height:26px;margin-top:2px">Show the AI’s reasoning</button>';
      if (s.note) ex += '<div style="font-size:12.5px;margin-top:4px"><span class="mut">Your note:</span> ' + esc(s.note) + '</div>';
      h += row(s.key, stepName(s.label), s.human, s.ai, s.agree, s.verdict, ex);
    });
    h += row('opportunity', 'Booking opportunity', r.opportunity.human, r.opportunity.ai, r.opportunity.agree, r.opportunity.verdict);
    h += row('outcome', 'How the call ended', r.outcome.human, r.outcome.ai, r.outcome.agree, r.outcome.verdict, r.outcome.ai_reason && !r.outcome.agree ? '<div class="mut" style="font-size:12.5px;margin-top:6px">AI’s not-booked reason: ' + esc(r.outcome.ai_reason) + '</div>' : '');
    if (r.note) h += '<div class="mut" style="font-size:12.5px;padding-top:10px;border-top:1px solid var(--line2)">Your note: ' + esc(r.note) + '</div>';
    h += '<div class="mut" style="font-size:12px;margin-top:10px">Audited by ' + esc(r.auditor || '') + (r.secs_spent ? ' in ' + Math.max(1, Math.round(r.secs_spent / 60)) + ' min' : '') + '.</div></div>';
    var next = (d.items || []).filter(function (x) { return x.status === 'open' && x.id !== it.id && !(x.claimed && !x.claimed.me); })[0];
    var missingWhy = (r.steps || []).map(function (s) { return [s.key, s.agree, s.verdict]; }).concat([['opportunity', r.opportunity.agree, r.opportunity.verdict], ['outcome', r.outcome.agree, r.outcome.verdict]]).filter(function (x) { return !x[1] && x[2] !== 'ai' && !(r.whys || {})[x[0]]; }).length;
    if (missingWhy) h += '<div class="banner" style="margin-top:14px;background:#FFF4E8;color:#7A3A08">Add a short “why” on ' + missingWhy + ' answer' + (missingWhy > 1 ? 's' : '') + ' that differ from the AI, or mark “The AI was right”, before moving on.</div>';
    h += '<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">' + (missingWhy ? '' : next ? '<button class="sel btnd" data-cal="open" data-v="' + next.id + '">Next call (' + next.slot + ')</button>' : '<span class="pill" style="background:#E6F0EA;color:#1F5A41;padding:10px 14px">All of today’s calls are done</span>') + '<button class="sel" data-cal="back">Back to the list</button></div>';
    return h;
  }

  // ----- results: AI vs. your team -----
  function calLoadStats(tok) {
    if (CAL.stats && CAL.stats.days === CAL.sdays) return drawCalStats();
    api({ action: 'calibstats', days: CAL.sdays }).then(function (s) { if (tok != null && tok !== T) return; CAL.stats = s; drawCalStats(); })
      .catch(function (e) { if ($('calwrap')) $('calwrap').innerHTML = errBox(e); });
  }
  function bar(v, col) { return '<div class="track" style="width:90px;display:inline-block;vertical-align:middle;margin-right:8px"><div style="width:' + Math.round((v || 0) * 100) + '%;background:' + (col || G) + '"></div></div>'; }
  function drawCalStats() {
    var w = $('calwrap'), s = CAL.stats; if (!w || !s) return;
    var rng = '<div class="seg" role="group" aria-label="Period">' + [[30, 'Last 30 days'], [90, 'Last 90 days']].map(function (o) { return '<button data-cal="sdays" data-v="' + o[0] + '" class="' + (CAL.sdays === o[0] ? 'on' : '') + '" aria-pressed="' + (CAL.sdays === o[0]) + '">' + o[1] + '</button>'; }).join('') + '</div>';
    if (!s.audited) { w.innerHTML = '<div style="display:flex;justify-content:flex-end">' + rng + '</div><div class="oq-card"><h2 class="ttl">No audits yet</h2><p class="sub">Once your team finishes some daily audits, this page shows how often the AI agrees with them, where it differs and why.</p><button class="sel btnd" data-cal="tab" data-v="today" style="margin-top:10px">Go to today’s audits</button></div>'; return; }
    var tiles = '<div class="row">' +
      mnTile('Calls audited', n0(s.audited), 'Blind audits since ' + esc(fdate(s.since))) +
      mnTile('Step agreement', calPct(s.agreement), 'Same answer as the AI, scored blind', '#2B3A67', 'Every step on every audited call where your team’s blind answer matched the AI’s.') +
      mnTile('AI accuracy', calPct(s.accuracy), 'Counting differences where the team said the AI was right', '#1F5A41') +
      mnTile('Score variance', s.avg_score_gap == null ? '—' : s.avg_score_gap.toFixed(1) + ' pts', 'Average gap between the AI’s score and yours', s.avg_score_gap >= 10 ? '#A8441A' : '') +
      mnTile('Outcome agreement', calPct(s.outcome_agreement), 'Booking opportunity: ' + calPct(s.opp_agreement)) + '</div>';
    // Step variance table
    var rows = (s.steps || []).map(function (x) { return { key: x.key, name: stepName(x.label), n: x.n, agree: x.agree, a: x.ai_yes_me_no, b: x.ai_no_me_yes, c: x.na_diff, con: x.conceded }; });
    rows.push({ key: 'opportunity', name: 'Booking opportunity', n: s.audited, agree: Math.round((s.opp_agreement || 0) * s.audited), field: true });
    rows.push({ key: 'outcome', name: 'How the call ended', n: s.audited, agree: Math.round((s.outcome_agreement || 0) * s.audited), field: true });
    var stepTbl = '<div class="oq-card"><h2 class="ttl">Where the AI and your team differ</h2><p class="sub">Each step, how often you agree and which way the differences go. Click “Why?” and the AI reads every difference (its reasoning next to your team’s answers and notes) and explains the pattern.</p><p class="swipe mut" style="display:none;font-size:11.5px;margin:8px 0 0">Swipe sideways for more columns →</p><div style="overflow-x:auto"><table class="tbl" style="margin-top:10px"><thead><tr><th>Step</th><th style="text-align:right">Calls</th><th>Agreement</th><th style="text-align:right" title="AI said Done, your team said Missed">AI too generous</th><th style="text-align:right" title="AI said Missed, your team said Done">AI too strict</th><th style="text-align:right" title="One side said N/A">N/A differences</th><th></th></tr></thead><tbody>' +
      rows.map(function (x) {
        var r = x.n ? x.agree / x.n : null, diffs = x.n - x.agree, wy = CAL.why[x.key];
        return '<tr><td><b style="font-weight:600">' + esc(x.name) + '</b></td><td class="num" style="text-align:right">' + x.n + '</td><td class="num">' + bar(r, r != null && r < 0.8 ? O : G) + calPct(r) + '</td>' +
          (x.field ? '<td colspan="3" class="mut" style="font-size:12.5px">' + diffs + ' different</td>' : '<td class="num" style="text-align:right">' + (x.a || 0) + '</td><td class="num" style="text-align:right">' + (x.b || 0) + '</td><td class="num" style="text-align:right">' + (x.c || 0) + '</td>') +
          '<td>' + (diffs ? '<button class="sel" data-cal="why" data-k="' + x.key + '" style="min-height:32px;padding:4px 12px">' + (wy && wy.open ? 'Hide' : 'Why?') + '</button>' : '<span class="pill" style="background:#E6F0EA;color:#1F5A41">All match</span>') + '</td></tr>' +
          (wy && wy.open ? '<tr><td colspan="7" style="white-space:normal;background:#F6FAF7"><div class="ai" style="border:none;padding:6px 4px"><div class="md" style="font-size:13px">' + (wy.busy ? '<span class="dots"><span></span><span></span><span></span></span> <span class="mut">Reading ' + diffs + ' difference' + (diffs === 1 ? '' : 's') + '…</span>' : wy.err ? '<span style="color:#A8441A">' + esc(wy.err) + '</span>' : md(wy.answer || '')) + '</div></div></td></tr>' : '');
      }).join('') + '</tbody></table></div><p class="mut" style="font-size:12px;margin:10px 0 0">Every difference where your answer stands is sent to <span class="lnk" role="link" tabindex="0" data-go="qasettings">Suggested scoring rules</span>. When the same difference comes up 3 or more times, a rule is drafted for your admins to approve.</p></div>';
    // Score variance per call
    var calls = (s.calls || []).slice().sort(function (a, b) { return Math.abs(b.gap) - Math.abs(a.gap); }).slice(0, 15);
    var varTbl = '<div class="oq-card" style="flex:1 1 460px;min-width:0"><h2 class="ttl">Biggest Score Differences</h2><p class="sub">Calls where the AI’s score and your team’s score were furthest apart.</p><p class="swipe mut" style="display:none;font-size:11.5px;margin:8px 0 0">Swipe sideways for more columns →</p><div style="overflow-x:auto"><table class="tbl" style="margin-top:10px"><thead><tr><th>Call</th><th style="text-align:right">AI</th><th style="text-align:right">Team</th><th style="text-align:right">Gap</th><th>Audited by</th></tr></thead><tbody>' +
      calls.map(function (c) { return '<tr class="click" tabindex="0" data-cal="open" data-v="' + c.id + '"><td><b style="font-weight:600">' + esc(c.agent || '') + '</b> <span class="mut" style="font-size:12px">· ' + esc(short(c.brand)) + ' · ' + esc(fdate(c.date)) + '</span></td><td class="num" style="text-align:right">' + Math.round(c.ai_score || 0) + '</td><td class="num" style="text-align:right">' + Math.round(c.human_score || 0) + '</td><td class="num" style="text-align:right;font-weight:600;color:' + (Math.abs(c.gap) >= 10 ? '#A8441A' : 'inherit') + '">' + (c.gap > 0 ? '+' : '') + Math.round(c.gap) + '</td><td class="mut">' + esc(c.auditor || '') + '</td></tr>'; }).join('') +
      '</tbody></table></div><p class="mut" style="font-size:12px;margin:8px 0 0">Gap = team score minus AI score. Negative means the AI scored higher than your team.</p></div>';
    var wk = (s.weeks || []).map(function (x) { var r = x.total ? x.agree / x.total : null; return '<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-top:1px solid var(--line2)"><span class="mut" style="width:96px;font-size:12.5px">Week of ' + esc(fdate(x.week)) + '</span><span style="flex:1">' + bar(r) + '<b class="num">' + calPct(r) + '</b></span><span class="mut num" style="font-size:12px">' + x.calls + ' calls</span></div>'; }).join('');
    var au = (s.auditors || []).map(function (x) { return '<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-top:1px solid var(--line2)">' + avatar(x.name, 26) + '<span style="flex:1;min-width:0">' + esc(x.name) + '</span><span class="num mut" style="font-size:12.5px">' + x.calls + ' calls · ' + calPct(x.total ? x.agree / x.total : null) + ' match' + (x.timed ? ' · ' + Math.round(x.secs / x.timed / 60) + ' min each' : '') + '</span></div>'; }).join('');
    var side = '<div style="flex:1 1 300px;min-width:0;display:flex;flex-direction:column;gap:14px"><div class="oq-card"><h2 class="ttl">Agreement by Week</h2><p class="sub">Should climb as approved rules teach the AI.</p>' + wk + '</div><div class="oq-card"><h2 class="ttl">Auditors</h2><p class="sub">If one person differs from the AI far more than the rest, align the team first.</p>' + au + '</div></div>';
    // Disagreement feed
    var feed = '<div class="oq-card"><h2 class="ttl">Every difference, and why</h2><p class="sub">Newest first. The AI’s reasoning next to your team’s answer and note.</p>' + ((s.recent || []).slice(0, 25).map(function (c) {
      return '<div style="padding:12px 0;border-top:1px solid var(--line2)"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center"><span><b style="font-weight:600">' + esc(c.agent || '') + '</b> <span class="mut" style="font-size:12.5px">· ' + esc(short(c.brand)) + ' · ' + esc(fdate(c.date)) + ' · audited by ' + esc(c.auditor || '') + '</span></span><span style="display:flex;gap:8px;align-items:center"><span class="mut num" style="font-size:12.5px">AI ' + Math.round(c.ai_score || 0) + ' · team ' + Math.round(c.human_score || 0) + '</span><button class="more" data-cal="open" data-v="' + c.id + '">Open</button></span></div>' +
        c.diffs.map(function (x) { return '<div style="margin-top:8px;padding-left:12px;border-left:3px solid ' + (x.conceded ? '#C9C3B8' : '#F0B48F') + '"><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:12.5px"><b style="font-weight:600">' + esc(stepName(x.label)) + '</b><span class="mut">AI</span>' + calChip(x.ai) + '<span class="mut">team</span>' + calChip(x.me) + (x.conceded ? '<span class="pill" style="background:#F3F1EC;color:#56605B">Team agreed the AI was right</span>' : '') + '</div>' +
          (x.ai_why ? '<div style="font-size:12.5px;line-height:1.5;margin-top:4px"><span class="mut">AI:</span> ' + esc(x.ai_why) + '</div>' : '') + (x.me_misses && x.me_misses.length ? '<div style="font-size:12.5px;margin-top:3px"><span class="mut">Team marked missed:</span> ' + esc(x.me_misses.join(', ')) + '</div>' : '') + (x.note ? '<div style="font-size:12.5px;margin-top:3px"><span class="mut">Team:</span> ' + esc(x.note) + '</div>' : '') + '</div>'; }).join('') + '</div>';
    }).join('') || '<div class="mut" style="padding:10px 0">No differences yet.</div>') + '</div>';
    w.innerHTML = '<div style="display:flex;justify-content:flex-end">' + rng + '</div>' + tiles + stepTbl + '<div class="row" style="align-items:flex-start">' + varTbl + side + '</div>' + feed;
  }
  function calWhy(key) {
    var cur = CAL.why[key];
    if (cur && cur.open) { cur.open = false; drawCalStats(); return; }
    if (cur && cur.answer) { cur.open = true; drawCalStats(); return; }
    CAL.why[key] = { open: true, busy: true }; drawCalStats();
    api({ action: 'calibexplain', key: key, days: CAL.sdays }).then(function (r) { CAL.why[key] = { open: true, answer: r.answer }; drawCalStats(); })
      .catch(function (e) { CAL.why[key] = { open: true, err: e.message || 'Couldn’t explain this one. Try again.' }; drawCalStats(); });
  }
  on(document, 'click', function (e) {
    var b = e.target.closest('[data-cal]'); if (!b || !$('oqa') || !$('oqa').contains(b)) return;
    var a = b.getAttribute('data-cal'), v = b.getAttribute('data-v'), k = b.getAttribute('data-k'), F = CAL.form;
    e.preventDefault();
    if (a === 'tab') { if (CAL.item) calLeave(); CAL.tab = v; render(); }
    else if (a === 'day') { CAL.day = v; CAL.data = null; $('calwrap').innerHTML = '<div class="oq-card">' + skel(36, 6) + '</div>'; calLoadDay(T); }
    else if (a === 'open') { if (CAL.item) { stopAudio(); if (CAL.item.status === 'open' && CAL.item.id !== +v) calRelease(); } CAL.item = null; if (S.view !== 'calib') { S.view = 'calib'; } calOpen(v, b.getAttribute('data-take')); }
    else if (a === 'back') { calLeave(); EXT = null; render(); }
    else if (a === 'ans' && F) { calSync(); var s = F.steps[k] = F.steps[k] || {}; s.answer = v; if (v !== 'no') s.misses = []; drawCalForm(); }
    else if (a === 'miss' && F) { calSync(); var s2 = F.steps[k] = F.steps[k] || {}; s2.misses = s2.misses || []; var i = s2.misses.indexOf(v); if (i >= 0) s2.misses.splice(i, 1); else s2.misses.push(v); drawCalForm(); }
    else if (a === 'opp' && F) { calSync(); F.opp = v === 'true'; drawCalForm(); }
    else if (a === 'rule') { calSync(); CAL.open[k] = !CAL.open[k]; drawCalForm(); }
    else if (a === 'submit') calSubmit(b);
    else if (a === 'skipask') { calSync(); CAL.skip = !CAL.skip; drawCalForm(); var si = $('calskip'); if (si) si.focus(); }
    else if (a === 'skip') { var why = ($('calskip') || {}).value || ''; if (!why.trim()) { toast('Say why you can’t audit it.'); return; } b.disabled = true;
      api({ action: 'calibskip', id: CAL.item.id, reason: why.trim() }).then(function () { toast('Skipped. A replacement call was added.'); stopAudio(); P.id = null; CAL.item = null; CAL.form = null; EXT = null; render(); }).catch(function (e2) { b.disabled = false; toast(e2.message || 'Couldn’t skip.'); }); }
    else if (a === 'savewhy') { var wi = $('calwhy-' + k), wv = wi ? wi.value.trim() : ''; if (wv.length < 4) { toast('Add a few words on why your answer stands.'); if (wi) wi.focus(); return; } b.disabled = true; api({ action: 'calibverdict', id: CAL.item.id, key: k, side: 'me', why: wv }).then(function (r) { CAL.item = r; CAL.stats = null; delete CAL.whyDraft[k]; drawCalForm(); toast('Saved. The AI will learn from this.'); }).catch(function (e2) { b.disabled = false; toast(e2.message || 'Couldn’t save.'); }); }
    else if (a === 'verdict') { document.querySelectorAll('[data-calwhy]').forEach(function (i) { if (i.value) CAL.whyDraft[i.getAttribute('data-calwhy')] = i.value; }); b.disabled = true; api({ action: 'calibverdict', id: CAL.item.id, key: k, side: v }).then(function (r) { CAL.item = r; CAL.stats = null; drawCalForm(); toast(v === 'ai' ? 'Noted. This difference won’t be used to retrain the AI.' : 'Your answer stands.'); }).catch(function (e2) { b.disabled = false; toast(e2.message || 'Couldn’t save.'); }); }
    else if (a === 'saveper') { var n = +($('calper') || {}).value; b.disabled = true; api({ action: 'calibconfig', per_day: n }).then(function () { CAL.data.per_day = n; toast('Saved. ' + n + ' calls a weekday from the next set.'); drawCalDay(); }).catch(function (e2) { b.disabled = false; toast(e2.message || 'Couldn’t save.'); }); }
    else if (a === 'sdays') { CAL.sdays = +v; CAL.stats = null; CAL.why = {}; $('calwrap').innerHTML = '<div class="oq-card">' + skel(36, 6) + '</div>'; calLoadStats(T); }
    else if (a === 'why') calWhy(k);
  });
  on(document, 'change', function (e) { if (e.target && e.target.id === 'calout' && CAL.form) { CAL.form.outcome = e.target.value; calSync(); drawCalForm(); } });

  // ---------- First contact resolution + sentiment (Overview, 2026-10-22) ----------
  var EXTRAS = null, SENT = { tab: 'brands', all: false, k: 'avg', dir: -1 }, TMP = { tab: 'brands', all: false, k: 'upset', dir: -1 }, FCRS = { k: 'contacts', dir: -1 };
  // 2026-10-23 (Rob): ask rate on NON-booked opportunities, one category per call, sentiment drills
  var XKINDS = { misswhy: 1, category: 1, sentiment: 1, asknb: 1, jobtype: 1, temper: 1, product: 1, segment: 1, line: 1, flag: 1 };
  function loadExtras() { return api(Object.assign({ action: 'qaextras' }, win())).then(function (x) { EXTRAS = x || {}; return EXTRAS; }); }
  function askNb(list, brand, agent) { var r = (list || []).filter(function (x) { return (!brand || x.brand === brand) && (!agent || x.agent === agent); }); var nb = 0, a = 0; r.forEach(function (x) { nb += +x.nb || 0; a += +x.asked || 0; }); return nb ? { pct: 100 * a / nb, nb: nb, asked: a } : null; }
  function pctOf(n, d) { return d ? (100 * n / d) : null; }
  function pctTxt(n, d) { var v = pctOf(n, d); return v == null ? '—' : (v >= 10 || v === 0 ? Math.round(v) : v.toFixed(1)) + '%'; }
  var TEMPS = ['', 'Angry', 'Frustrated', 'Neutral', 'Positive', 'Delighted'];
  var TCOL = ['', '#A61B1B', '#E0662A', '#8C7A1E', '#2F7D5B', '#1F5A41'];
  function tempOf(v) { if (v == null || isNaN(v)) return null; var r = Math.max(1, Math.min(5, Math.round(+(+v).toFixed(1)))); return { label: TEMPS[r], col: TCOL[r] }; }
  function tempPill(v) { var t = tempOf(v); return t ? '<span class="pill num" style="background:' + t.col + '1A;color:' + t.col + ';min-width:92px;justify-content:center;text-align:center">' + (+v).toFixed(1) + ' · ' + t.label + '</span>' : '<span class="mut">—</span>'; }
  function tempBar(v) { var w = v == null ? 0 : Math.max(0, Math.min(100, (+v - 1) / 4 * 100)), t = tempOf(v); return '<div class="track" style="width:90px;display:inline-block;vertical-align:middle"><div style="width:' + w.toFixed(0) + '%;background:' + (t ? t.col : '#ccc') + '"></div></div>'; }
  function drawFcr() {
    var el = $('fcrcard'); if (!el || !EXTRAS) return; var f = EXTRAS.fcr || {}, o = f.overall || {}, rows = (f.by_brand || []).slice();
    var fv = function (r) { var k = FCRS.k; if (k === 'brand') return short(r.brand).toLowerCase(); if (k === 'contacts') return +r.contacts || 0; return r.contacts ? (+r[k] || 0) / r.contacts : -1; };
    rows.sort(function (a, b) { var x = fv(a), y = fv(b); return (x < y ? -1 : x > y ? 1 : 0) * FCRS.dir || (b.contacts - a.contacts); });
    var th = function (k, lbl, al) { var on = FCRS.k === k; return '<th data-oqfcr="' + k + '" role="button" tabindex="0" title="Sort" style="cursor:pointer;user-select:none;white-space:nowrap' + (al ? ';text-align:right' : '') + (on ? ';color:var(--ink)' : '') + '">' + lbl + ' <span style="font-size:9px;opacity:' + (on ? 1 : .35) + '">' + (on && FCRS.dir > 0 ? '▲' : '▼') + '</span></th>'; };
    var pc0 = function (a, b) { return b ? Math.round(100 * a / b) + '%' : '—'; };
    var bar = function (a, b, col) { var w = b ? 100 * a / b : 0; return '<div class="track" style="width:44px;display:inline-block;vertical-align:middle;margin-right:5px"><div style="width:' + w.toFixed(0) + '%;background:' + col + '"></div></div>'; };
    var recent = S.end >= addDays(todayET(), -6);
    el.innerHTML = '<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start"><div><h2 class="ttl">First Contact Resolution</h2><p class="sub">Resolved the first time the customer called: booked or handled (including after a transfer), with no call back from the same number within 7 days. <b>First person</b> is the part of FCR solved by whoever answered, with no transfer, so it is always the same or lower than FCR (the gap is calls resolved after a transfer).</p></div>' +
      '<div style="display:flex;gap:18px"><div><div class="cap">FCR</div><div class="num" style="font-size:26px;font-weight:600;color:#1F5A41">' + pc0(o.fcr, o.contacts) + '</div></div><div><div class="cap">First person</div><div class="num" style="font-size:26px;font-weight:600;color:#2B3A67">' + pc0(o.fcpr, o.contacts) + '</div></div><div><div class="cap">Transferred</div><div class="num" style="font-size:26px;font-weight:600">' + pc0(o.transferred, o.contacts) + '</div></div></div></div>' +
      (rows.length ? '<style>#fcrcard .tbl th,#fcrcard .tbl td{text-align:center!important;padding-left:4px;padding-right:4px;white-space:nowrap}#fcrcard .tbl th:first-child,#fcrcard .tbl td:first-child{text-align:left!important}</style><p class="swipe mut" style="display:none;font-size:11.5px;margin:8px 0 0">Swipe sideways for more columns →</p><div style="overflow-x:auto"><table class="tbl" style="margin-top:12px;font-size:13px"><thead><tr>' + th('brand', 'Brand') + th('contacts', 'Contacts', 1) + th('fcr', 'FCR') + th('fcpr', 'First person') + th('transferred', 'Transferred', 1) + '</tr></thead><tbody>' +
        rows.map(function (r) { return '<tr class="click" tabindex="0" data-brand="' + esc(r.brand) + '"><td><span style="display:inline-flex;gap:8px;align-items:center">' + bbadge(r.brand) + esc(short(r.brand)) + '</span></td><td class="num" style="text-align:right">' + fmt(r.contacts) + '</td><td class="num">' + bar(r.fcr, r.contacts, '#2F7D5B') + pc0(r.fcr, r.contacts) + '</td><td class="num">' + bar(r.fcpr, r.contacts, '#3A4380') + pc0(r.fcpr, r.contacts) + '</td><td class="num" style="text-align:right">' + pc0(r.transferred, r.contacts) + '</td></tr>'; }).join('') +
        '<tr style="font-weight:600;border-top:2px solid var(--line)"><td>' + (LOCK ? 'Total' : 'All brands') + '</td><td class="num" style="text-align:right">' + fmt(o.contacts) + '</td><td class="num">' + pc0(o.fcr, o.contacts) + '</td><td class="num">' + pc0(o.fcpr, o.contacts) + '</td><td class="num" style="text-align:right">' + pc0(o.transferred, o.contacts) + '</td></tr></tbody></table></div>' : '<div class="mut" style="margin-top:10px">No customer conversations in this period.</div>') +
      (recent ? '<p class="mut" style="font-size:11.5px;margin:8px 0 0">Calls from the last 7 days can still drop out of FCR if the customer calls back.</p>' : '');
  }
  function drawSent() {
    var el = $('sentcard'); if (!el || !EXTRAS) return; var s = EXTRAS.sentiment || {}, o = s.overall || {};
    var head = '<h2 class="ttl">Customer Sentiment</h2><p class="sub">How each call felt to the customer, from 1 (angry) to 5 (delighted). It never changes a score. Tracked on calls scored from Oct 22, 2026 on, so longer ranges only count calls since then.</p>';
    if (!o.n) { el.innerHTML = head + '<div class="mut" style="margin-top:10px;font-size:13px">Sentiment is captured on calls scored from Oct 22, 2026 on. Pick a range that includes them.</div>'; return; }
    var t = tempOf(o.avg), rows = SENT.tab === 'csrs' ? (s.by_agent || []).filter(function (r) { return r.n >= 3; }) : (s.by_brand || []);
    var csrT = SENT.tab === 'csrs' || LOCK, nmOf = function (r) { return String((csrT ? r.agent : r.brand) || '').toLowerCase(); };
    var sv = function (r) { return SENT.k === 'name' ? nmOf(r) : SENT.k === 'neg' ? (+r.neg || 0) : SENT.k === 'n' ? (+r.n || 0) : (+r.avg || 0); };
    rows = rows.slice().sort(function (a, b) { var x = sv(a), y = sv(b); return (x < y ? -1 : x > y ? 1 : 0) * SENT.dir || (b.n - a.n); });
    // brands: always every brand; CSRs: first 15, then Show all
    var shown = !csrT || SENT.all ? rows : rows.slice(0, 15);
    var sh = function (k, lbl, st) { var on = SENT.k === k; return '<button data-oqsentk="' + k + '" title="Sort" style="all:unset;cursor:pointer;white-space:nowrap;' + st + (on ? ';color:var(--ink)' : '') + '">' + lbl + ' <span style="font-size:9px;opacity:' + (on ? 1 : .35) + '">' + (on && SENT.dir > 0 ? '▲' : '▼') + '</span></button>'; };
    var hdr = '<div class="cap" style="display:flex;gap:10px;align-items:center;margin-top:12px;padding:0 0 6px">' + sh('name', csrT ? 'CSR' : 'Brand', 'flex:1') + sh('avg', 'Sentiment', 'width:192px;text-align:center') + sh('neg', 'Upset', 'width:58px;text-align:center') + sh('n', 'Calls', 'width:52px;text-align:center') + '</div>';
    el.innerHTML = head + '<div style="display:flex;gap:18px;align-items:flex-end;margin-top:10px;flex-wrap:wrap"><div><div class="cap">Average</div><div class="num" style="font-size:26px;font-weight:600;color:' + t.col + '">' + (+o.avg).toFixed(1) + ' <span style="font-size:14px">' + t.label + '</span></div></div><button class="click" data-ffk="sentiment" data-ffv="pos" title="Hear the calls where the customer left happy" style="all:unset;cursor:pointer"><div class="cap">Positive</div><div class="num" style="font-size:18px;font-weight:600;color:#1F5A41;text-decoration:underline dotted">' + Math.round(100 * o.pos / o.n) + '%</div></button><button class="click" data-ffk="sentiment" data-ffv="neg" title="Hear the calls where the customer left upset" style="all:unset;cursor:pointer"><div class="cap">Negative</div><div class="num" style="font-size:18px;font-weight:600;color:#A8441A;text-decoration:underline dotted">' + Math.round(100 * o.neg / o.n) + '%</div></button><div class="mut" style="font-size:12px">' + fmt(o.n) + ' calls</div></div>' +
      '<div class="seg" style="margin-top:12px">' + (LOCK ? '' : '<button data-oqsent="brands" class="' + (SENT.tab === 'brands' ? 'on' : '') + '">Brands</button>') + '<button data-oqsent="csrs" class="' + (SENT.tab === 'csrs' || LOCK ? 'on' : '') + '">CSRs</button></div>' +
      (shown.length ? hdr + shown.map(function (r) { var nm = SENT.tab === 'csrs' || LOCK ? r.agent : r.brand;
        var dk = (SENT.tab === 'csrs' || LOCK) ? ' data-ffagent="' + esc(r.agent || '') + '" data-ffbrand="' + esc(r.brand || '') + '"' : ' data-ffbrand="' + esc(r.brand || '') + '"';
        return '<button class="click" data-ffk="sentiment" data-ffv="' + (r.neg ? 'neg' : 'pos') + '"' + dk + ' title="' + (r.neg ? 'Hear the ' + r.neg + ' calls where the customer left upset' : 'Hear the calls where the customer left happy') + '" style="all:unset;box-sizing:border-box;cursor:pointer;width:100%;display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center;padding:8px 0;border-top:1px solid var(--line2)"><span style="flex:1 0 auto;white-space:nowrap;font-weight:500">' + esc(nm || '—') + (SENT.tab === 'csrs' && !LOCK ? ' <span class="mut" style="font-size:12px">· ' + esc(short(r.brand)) + '</span>' : '') + '</span><span style="display:inline-flex;gap:10px;align-items:center;margin-left:auto">' + tempBar(r.avg) + tempPill(r.avg) + '<span class="mut num" style="font-size:12px;width:58px;text-align:center;white-space:nowrap">' + (r.neg ? '<span style="color:#A8441A">' + r.neg + ' upset</span>' : '0 upset') + '</span><span class="mut num" style="font-size:12px;width:52px;text-align:center">' + fmt(r.n) + '</span></span></button>'; }).join('') : '<div class="mut" style="padding:8px 0;font-size:13px">Not enough calls yet.</div>') +
      (csrT && rows.length > 15 ? '<button class="more" data-oqsent="more">' + (SENT.all ? 'Show less' : 'Show all ' + rows.length) + '</button>' : '');
  }
  // Temper shift (2026-10-23, going forward only): customer temperature in the first 30 seconds vs at the end.
  var TMP_TIP = { upset_in: 'Calls where the customer sounded angry or frustrated (1-2 on the 1-5 scale) in the first 30 seconds.',
    calmed: 'Came in upset (1-2) and left happy (4-5). % is of the calls where the customer came in upset.',
    settled: 'Came in upset (1-2) and left calm (3). % is of the calls where the customer came in upset.',
    stayed: 'Came in upset (1-2) and still upset at the end (1-2). % is of the calls where the customer came in upset.',
    escalated: 'Came in calm or happy (3-5) and left upset (1-2): the call made things worse. % is of the calls where the customer came in calm or happy.' };
  function drawTemper() {
    var el = $('tempcard'); if (!el || !EXTRAS) return; var tp = EXTRAS.temper || {}, o = tp.overall || {};
    var tipi = function (k) { return '<span aria-hidden="true" data-tip="' + esc(TMP_TIP[k]) + '" style="margin-left:6px;cursor:help;width:16px;height:16px;border-radius:99px;border:1px solid #CFCAC0;color:#8A918D;font-size:10px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;vertical-align:middle">i</span>'; };
    var head = '<h2 class="ttl">Temper Shift</h2><p class="sub">How the customer sounded in the first 30 seconds compared with how they sounded at the end, so you can see who calmed an upset caller down and which calls got worse. Tracked on calls scored from Oct 23, 2026 on.</p>';
    if (!o.n) { el.innerHTML = head + '<div class="mut" style="margin-top:10px;font-size:13px">No calls with a start and end temper in this range yet. It fills in as new calls are scored.</div>'; return; }
    var ok = (o.n || 0) - (o.upset_in || 0);
    var tile = function (k, cap, n, d, col) { return '<button class="click" data-ffk="temper" data-ffv="' + k + '" title="Hear these calls" style="all:unset;cursor:pointer;min-width:96px"><div class="cap" style="display:flex;align-items:center">' + cap + tipi(k) + '</div><div class="num" style="font-size:22px;font-weight:600;color:' + col + ';text-decoration:underline dotted">' + (d == null ? fmt(n) : pctTxt(n, d)) + '</div><div class="mut num" style="font-size:11.5px">' + (d == null ? 'of ' + fmt(o.n) + ' calls' : fmt(n) + ' of ' + fmt(d)) + '</div></button>'; };
    var csr = TMP.tab === 'csrs' || LOCK, rows = csr ? (tp.by_agent || []).filter(function (r) { return r.upset_in || r.escalated; }) : (tp.by_brand || []);
    var tv = function (r) { var k = TMP.k; if (k === 'name') return String((csr ? r.agent : short(r.brand)) || '').toLowerCase(); if (k === 'n') return +r.n || 0; if (k === 'upset_in') return +r.upset_in || 0; if (k === 'calmed') return (+r.calmed || 0) + (+r.settled || 0); if (k === 'stayed') return +r.stayed || 0; if (k === 'escalated') return +r.escalated || 0; return (+r.upset_in || 0) + (+r.escalated || 0); };
    rows = rows.slice().sort(function (a, b) { var x = tv(a), y = tv(b); return (x < y ? -1 : x > y ? 1 : 0) * TMP.dir || b.n - a.n; });
    var tth = function (k, lbl, al) { var on = TMP.k === k; return '<th data-oqtmpk="' + k + '" role="button" tabindex="0" title="Sort" style="cursor:pointer;user-select:none;white-space:nowrap' + (al ? ';text-align:right' : '') + (on ? ';color:var(--ink)' : '') + '">' + lbl + ' <span style="font-size:9px;opacity:' + (on ? 1 : .35) + '">' + (on && TMP.dir > 0 ? '▲' : '▼') + '</span></th>'; };
    var shown = TMP.all ? rows : rows.slice(0, 8);
    var lnk = function (r, k, n, col, word) { if (!n) return '<span class="mut">0 ' + word + '</span>'; return '<button class="more" data-ffk="temper" data-ffv="' + k + '"' + (csr ? ' data-ffagent="' + esc(r.agent || '') + '"' : '') + ' data-ffbrand="' + esc(r.brand || '') + '" title="Hear these calls" style="font-size:12.5px;color:' + col + '">' + n + ' ' + word + '</button>'; };
    el.innerHTML = head + '<div style="display:flex;gap:20px;align-items:flex-start;margin-top:10px;flex-wrap:wrap">' +
      tile('upset_in', 'Came in upset', o.upset_in, null, '#A8441A') + tile('calmed', 'Calmed down', o.calmed, o.upset_in, '#1F5A41') + tile('settled', 'Settled', o.settled, o.upset_in, '#8C7A1E') + tile('stayed', 'Stayed upset', o.stayed, o.upset_in, '#A61B1B') + tile('escalated', 'Escalated', o.escalated, ok, '#A61B1B') + '</div>' +
      '<div class="seg" style="margin-top:14px">' + (LOCK ? '' : '<button data-oqtmp="brands" class="' + (!csr ? 'on' : '') + '">Brands</button>') + '<button data-oqtmp="csrs" class="' + (csr ? 'on' : '') + '">CSRs</button></div>' +
      (shown.length ? '<p class="swipe mut" style="display:none;font-size:11.5px;margin:8px 0 0">Swipe sideways for more columns →</p><div style="overflow-x:auto"><table class="tbl" style="margin-top:8px"><thead><tr>' + tth('name', csr ? 'CSR' : 'Brand') + tth('n', 'Calls', 1) + tth('upset_in', 'Came in upset', 1) + tth('calmed', 'Calmed or settled') + tth('stayed', 'Stayed upset') + tth('escalated', 'Escalated') + '</tr></thead><tbody>' +
        shown.map(function (r) { return '<tr><td>' + (csr ? esc(r.agent || '—') + (LOCK ? '' : ' <span class="mut" style="font-size:12px">· ' + esc(short(r.brand)) + '</span>') : '<span style="display:inline-flex;gap:8px;align-items:center">' + bbadge(r.brand) + esc(short(r.brand)) + '</span>') + '</td><td class="num" style="text-align:right">' + fmt(r.n) + '</td><td class="num" style="text-align:right">' + fmt(r.upset_in) + '</td><td class="num">' + (r.upset_in ? lnk(r, 'calmed', r.calmed, '#1F5A41', 'calmed') + (r.settled ? ' · ' + lnk(r, 'settled', r.settled, '#8C7A1E', 'settled') : '') : '<span class="mut">—</span>') + '</td><td class="num">' + (r.upset_in ? lnk(r, 'stayed', r.stayed, '#A61B1B', 'upset') : '<span class="mut">—</span>') + '</td><td class="num">' + lnk(r, 'escalated', r.escalated, '#A61B1B', 'escalated') + '</td></tr>'; }).join('') + '</tbody></table></div>'
        : '<div class="mut" style="padding:8px 0;font-size:13px">' + (csr ? 'No CSR has had an upset or escalated call in this range yet.' : 'Not enough calls yet.') + '</div>') +
      (rows.length > 8 ? '<button class="more" data-oqtmp="more">' + (TMP.all ? 'Show less' : 'Show all ' + rows.length) + '</button>' : '');
  }
  // ---------- Back button: every page change is remembered so people can step back ----------
  // Back history survives a page refresh (kept for this browser tab only, 2026-10-26).
  var HKEY = 'oqa_hist', HIST = [], LASTH = null, BACKING = false;
  try { var hs = JSON.parse(sessionStorage.getItem(HKEY) || '[]'); if (Array.isArray(hs)) HIST = hs.filter(function (x) { return typeof x === 'string'; }).slice(-40); } catch (x) {}
  function saveHist() { try { sessionStorage.setItem(HKEY, JSON.stringify(HIST)); } catch (x) {} }
  function trackHist() {
    var h = location.hash;
    if (!BACKING && LASTH && LASTH !== h) { HIST.push(LASTH); if (HIST.length > 40) HIST.shift(); saveHist(); }
    if (LASTH == null && HIST.length && HIST[HIST.length - 1] === h) { HIST.pop(); saveHist(); }
    LASTH = h; BACKING = false;
  }
  function goBack() {
    var h = HIST.pop(); saveHist(); if (!h) return;
    if ($('layer') && $('layer').innerHTML) closeLayer();
    BACKING = true; history.replaceState(null, '', h);
    S.calls = { outcome: null, step: null, scoreMax: null, scoreMin: null, winnable: null, q: '', offset: 0, sort: 'new' };
    if (typeof CAL !== 'undefined' && CAL.item) { calLeave(); EXT = null; }
    S.pop = null; readHash(); window.scrollTo(0, 0); render();
  }
  on(document, 'click', function (e) {
    var fs = e.target.closest('[data-oqfcr]'); if (fs && $('oqa') && $('oqa').contains(fs)) { var fk2 = fs.getAttribute('data-oqfcr'); if (FCRS.k === fk2) FCRS.dir = -FCRS.dir; else { FCRS.k = fk2; FCRS.dir = fk2 === 'brand' ? 1 : -1; } drawFcr(); return; }
    var sk = e.target.closest('[data-oqsentk]'); if (sk && $('oqa') && $('oqa').contains(sk)) { var sk2 = sk.getAttribute('data-oqsentk'); if (SENT.k === sk2) SENT.dir = -SENT.dir; else { SENT.k = sk2; SENT.dir = sk2 === 'name' ? 1 : -1; } drawSent(); return; }
    var tk = e.target.closest('[data-oqtmpk]'); if (tk && $('oqa') && $('oqa').contains(tk)) { var tk2 = tk.getAttribute('data-oqtmpk'); if (TMP.k === tk2) TMP.dir = -TMP.dir; else { TMP.k = tk2; TMP.dir = tk2 === 'name' ? 1 : -1; } drawTemper(); return; }
    var tb = e.target.closest('[data-oqtmp]'); if (tb && $('oqa') && $('oqa').contains(tb)) { var tv = tb.getAttribute('data-oqtmp'); if (tv === 'more') TMP.all = !TMP.all; else { TMP.tab = tv; TMP.all = false; } drawTemper(); return; }
    var b = e.target.closest('[data-oqback],[data-oqsent]'); if (!b || !$('oqa') || !$('oqa').contains(b)) return;
    e.preventDefault();
    if (b.hasAttribute('data-oqback')) { goBack(); return; }
    var v = b.getAttribute('data-oqsent'); if (v === 'more') SENT.all = !SENT.all; else { SENT.tab = v; SENT.all = false; } drawSent();
  });

  // ---------- routing ----------
  var T = 0;
  function writeHash() {
    var o = { v: S.view, r: S.range }; if (S.view === 'kpi' && S.kpi) o.k = S.kpi;
    if (S.range === 'custom') { o.s = S.start; o.e = S.end; }
    if (S.brands.length) o.b = S.brands.join('|');
    if (S.view === 'calls' && S.calls.bucket) o.bucket = S.calls.bucket;
    if (S.view === 'calls' && !S.calls.bucket) { if (S.calls.q) o.q = S.calls.q; if (S.calls.outcome) o.out = S.calls.outcome; if (S.calls.step) o.step = S.calls.step; }
    if (S.view === 'hub' && S.hubCsr && !CFG.csrSelf) { o.csr = S.hubCsr; o.t = HUB.tab; }
    if (S.view === 'brand') o.brand = S.brand; if (S.view === 'csr') o.agent = S.agent;
    var h = '#' + Object.keys(o).map(function (k) { return k + '=' + encodeURIComponent(o[k]); }).join('&');
    if (location.hash !== h) history.replaceState(null, '', h);
  }
  function readHash() {
    var q = {}; location.hash.replace(/^#/, '').split('&').forEach(function (p) { var kv = p.split('='); if (kv[0]) q[kv[0]] = decodeURIComponent(kv[1] || ''); });
    if (q.v) S.view = q.v; if (q.k) S.kpi = q.k; if (q.r) S.range = q.r; if (q.s && q.e) { S.start = q.s; S.end = q.e; }
    if (q.bucket && /^(upset|low|ctrl|other)$/.test(q.bucket)) { S.calls.bucket = q.bucket; S.calls.offset = 0; }
    if (q.v === 'calls' && !q.bucket) { if (q.q) S.calls.q = q.q.slice(0, 120); if (q.out && OUTCOMES.some(function (o) { return o[0] === q.out; })) S.calls.outcome = q.out; if (q.step && STEPNAMES[q.step]) S.calls.step = q.step; S.calls.offset = 0; }
    if (q.csr && /^[0-9a-f-]{36}$/i.test(q.csr)) S.hubCsr = q.csr; if (q.t && /^(home|ask|wins)$/.test(q.t)) HUB.tab = q.t;
    if (q.b) S.brands = q.b.split('|'); if (q.brand) S.brand = q.brand; if (q.agent) S.agent = q.agent;
    applyRange();
  }
  function render() {
    if (CFG.csrSelf && !/^hub/.test(S.view)) S.view = 'hub';
    T++; var tok = T; if (EXT) { try { EXT(); } catch (x) {} EXT = null; } if (S.view === 'brands' && LOCK) S.view = 'overview'; renderNav(); renderWho(); writeHash(); trackHist();
    var v = { overview: vOverview, brands: vBrands, brand: function (t) { vFocus(t, 'brand'); }, csr: function (t) { vFocus(t, 'csr'); }, csrs: vCsrs, phone: vPhone, repeat: vRepeat, calls: vCalls, insights: vInsights, kb: vKb, team: vTeam, qasettings: vQaSettings, scorecards: vScorecards, reporting: vReporting, money: vMoney, cardcap: vCard, calib: vCalib, kpi: vKpi, hub: vHub, hubask: vHub, hubwins: vHub, hubqs: vHubQs }[S.view] || vOverview;
    v(tok);
    var cf = null; if (cf) cf.addEventListener('submit', function (e) { e.preventDefault(); var c = S.calls; c.q = $('cq').value.trim(); c.outcome = $('co').value || null; c.step = $('cs2').value || null; var sc = $('csc').value; c.scoreMax = sc === 'max40' ? 40 : sc === 'max70' ? 70 : null; c.scoreMin = sc === 'min90' ? 90 : null; c.xfer = $('cxf').value || null; c.offset = 0; render(); });
  }
  function go(view) { S.view = view; S.pop = null; window.scrollTo(0, 0); render(); }
  var XWHY = {};
  function xferWhy(c) {
    var k = [c.xfer, c.xferWith, S.callsAgent, S.start, S.end, S.brands.join('|')].join('~');
    var paint = function () { var el = $('xwhy'), v = XWHY[k]; if (!el) return;
      el.innerHTML = '<div style="display:flex;gap:8px;align-items:center"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2F7D5B" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/></svg><b style="font-size:13.5px">Why these were ' + (c.xfer === 'in' ? 'sent over' : 'transferred') + '</b></div>' +
        (!v || v.busy ? '<div style="margin-top:8px;display:flex;gap:8px;align-items:center"><span class="dots"><span></span><span></span><span></span></span><span class="mut" style="font-size:12.5px">Reading the calls…</span></div>' : v.err ? '<div class="mut" style="font-size:12.5px;margin-top:6px">' + esc(v.err) + '</div>' : '<div class="md" style="font-size:13px;margin-top:4px">' + md(v.answer || '') + '</div>'); };
    if (!XWHY[k]) { XWHY[k] = { busy: true }; api({ action: 'xfercalls', op: 'why', dir: c.xfer === 'in' ? 'in' : 'out', with: c.xferWith, agent: S.callsAgent || null, start: S.start, end: S.end, brands: S.brands.length ? S.brands : null })
      .then(function (r) { XWHY[k] = { answer: r.answer }; paint(); }).catch(function (e) { XWHY[k] = { err: e.message || 'Couldn’t read the calls.' }; paint(); }); }
    setTimeout(paint, 0);
  }
  var FFL = { misswhy: 'Didn’t book: ', reason: 'Didn’t book: ', objection: 'Objection: ', topic: 'Wanted: ', priority: 'Missed: ', strength: 'Did well: ', outcome: 'Ended: ', hour: 'Hour: ', seg: '', category: 'Call type: ', jobtype: 'Job type: ', sentiment: 'Customer: ', temper: 'Temper: ', product: 'Product: ', segment: '', line: '', flag: '', asknb: 'Not booked: ' };
  var FFV = { flag: { 'booked:yes': 'Booked', 'booked:no': 'Not booked', 'askbook:yes': 'Asked for the booking', 'askbook:no': 'Didn’t ask for the booking', 'askcc:yes': 'Asked for a card', 'askcc:no': 'Didn’t ask for a card', 'gotcc:yes': 'Card collected', 'gotcc:no': 'Card not collected' }, temper: { upset_in: 'came in upset', calmed: 'came in upset, left happy', settled: 'came in upset, left calm', stayed: 'came in upset, left upset', escalated: 'came in calm, left upset' }, sentiment: { neg: 'left upset (1–2)', pos: 'left happy (4–5)' }, asknb: { asked: 'CSR asked for the booking', notasked: 'CSR didn’t ask for the booking' } };
  var SEGL = { before_open: 'Before the brand opens', after_close: 'After the brand closes', closed_day: 'Day the brand is closed', open: 'During brand hours', early: 'Before 8am (weekdays)', evening: 'After 6pm (weekdays)', weekend: 'Weekends' };
  function openCalls(filters, agent) { S.calls = Object.assign({ outcome: null, step: null, scoreMax: null, scoreMin: null, winnable: null, q: '', offset: 0, nocard: false }, filters || {}); S.callsAgent = agent || null; if (S.ask.open) closeLayer(); go('calls'); }
  function closeLayer() { stopAudio(); P.id = null; S.callId = null; S.fromAsk = false; S.ask.open = false; $('layer').innerHTML = ''; }

  on(document, 'submit', function (e) {
    if (e.target.id === 'askform') { e.preventDefault(); var q0 = $('askq').value; $('askq').value = ''; ask(q0); return; }
    if (e.target.id === 'callq') { e.preventDefault(); var c = S.calls; c.q = $('cq').value.trim(); c.outcome = $('co').value || null; c.step = $('cs2').value || null; var sc = $('csc').value; c.scoreMax = sc === 'max40' ? 40 : sc === 'max70' ? 70 : null; c.scoreMin = sc === 'min90' ? 90 : null; c.xfer = $('cxf').value || null; c.offset = 0; render(); return; }
    if (e.target.id === 'askform2') { e.preventDefault(); var q = $('askq2').value; ask(q); }
    else if (e.target.id === 'cnform') { e.preventDefault(); addNote(); }
    else if (e.target.id === 'ccform') { e.preventDefault(); ccAsk($('ccq').value); }
  });
  on(document, 'click', function (e) {
    var t = e.target;
    var ced = document.getElementById('ced');
    if (ced) {
      var sg = t.closest('[data-ceseg]'); if (sg) { S.ceSeg = sg.getAttribute('data-ceseg'); ced.querySelectorAll('[data-ceseg]').forEach(function (x) { x.classList.toggle('on', x === sg); }); return; }
      var tl = t.closest('label.chip'); if (tl) { setTimeout(function () { var cb = tl.querySelector('input'); tl.classList.toggle('on', !!(cb && cb.checked)); }, 0); return; }
      if (t.closest('[data-act="cesave"]')) { ceSave(t.closest('[data-act="cesave"]')); return; }
      if (t === ced || t.closest('[data-act="cecancel"]')) { ced.remove(); return; }
      return;
    }
    var chg = document.getElementById('chg');
    if (chg) {
      var b = t.closest('[data-pick],[data-closechg],[data-act="applychange"]');
      if (t.closest('[data-pick]')) { S.pick = t.closest('[data-pick]').dataset.pick; chg.querySelectorAll('[data-pick]').forEach(function (x) { x.classList.toggle('on', x.dataset.pick === S.pick); }); return; }
      if (t.closest('[data-act="applychange"]')) {
        var s = S.cur.steps[S.change], why = $("chgwhy").value.trim(), back = S.pick === s.ai_answer;
        if (S.pick === s.answer) { chg.remove(); return; }
        var sb = t.closest('[data-act="applychange"]');
        if (!IS_ADMIN) {
          if (!why) { toast('Add a short reason so your admin can review it.'); return; }
          sb.disabled = true; sb.textContent = 'Sending…'; var rid0 = S.cur.id;
          api({ action: 'scorereq', op: 'create', id: rid0, key: s.key, answer: S.pick, why: why }).then(function (r) { var g = $('chg'); if (g) g.remove(); toast(r && r.admins ? 'Sent to your account admin to approve' : 'Request saved. Your account has no admin login yet.'); loadReqs(rid0, true); })
            .catch(function (e2) { sb.disabled = false; sb.textContent = 'Send request'; toast(e2.message || 'Couldn’t send the request.'); });
          return;
        }
        sb.disabled = true; sb.textContent = 'Saving…';
        saveAdjust(s.key, S.pick, why || (back ? null : 'Updated by account admin')).then(function () { var g = $('chg'); if (g) g.remove(); toast('Score updated'); })
          .catch(function (e2) { sb.disabled = false; sb.textContent = 'Save change'; toast(e2.message || 'Couldn’t save the change.'); });
        return;
      }
      if (t === chg || t.closest('button[data-closechg]')) { chg.remove(); return; }
      return;
    }
    var ap = t.closest('[data-autoplay]');
    if (ap) { var aid = ap.getAttribute('data-autoplay'); S.fromAsk = !!S.ask.open; S.ask.open = false; S.autoplay = aid; if (P.id === aid && P.info && P.info.url) { S.autoplay = null; AU.play().catch(function () {}); } S.callId = aid; callDrawer(); return; }
    var tra = t.closest('[data-trall]'); if (tra) { var tid = tra.getAttribute('data-trall'); TR.open[tid] = !TR.open[tid]; var tc = $('trc'); if (tc && S.cur) { tc.outerHTML = trCard(S.cur); bindTr(); } return; }
    var ppt = t.closest('[data-ppart]'); if (ppt && P.legs) { P.step = null; P.stepEnd = null; vseek(P.legs[+ppt.getAttribute('data-ppart')].offset, true); paintPlayer(); return; }
    if (t.closest('[data-pplay]')) { if (AU.paused) { P.step = null; P.stepEnd = null; if (AU.ended && (!P.legs || (P.li || 0) === P.legs.length - 1)) vseek(0); AU.play().catch(function () {}); } else AU.pause(); return; }
    if (t.closest('[data-pfull]')) { P.step = null; P.stepEnd = null; AU.play().catch(function () {}); paintPlayer(); return; }
    var pst = t.closest('[data-pstep]');
    if (pst) { playStep(+pst.getAttribute('data-pstep')); return; }
    var psk = t.closest('[data-seek]');
    if (psk && P.info && P.info.url) { P.step = null; P.stepEnd = null; vseek(Math.max(0, +psk.getAttribute('data-seek') - 0.4) + (P.base || 0), true); return; }
    var kb0 = t.closest('[data-kpibrand]'); if (kb0 && !LOCK) { S.brands = [kb0.getAttribute('data-kpibrand')]; render(); return; }
    if (t.closest('[data-kpimore]')) { if (S.kpiMore) S.kpiMore(); return; }
    var ffb = t.closest('[data-ffk]');
    if (ffb) { var fk = ffb.getAttribute('data-ffk'), fv = ffb.getAttribute('data-ffv'), fl = (FFL[fk] || '') + (fk === 'hour' ? fhour(+fv) : fk === 'seg' ? (SEGL[fv] || fv) + (ffb.getAttribute('data-ffnb') ? ' · not booked' : '') : ((FFV[fk] || {})[fv] || fv));
      var ffbr = ffb.getAttribute('data-ffbrand'), ffag = ffb.getAttribute('data-ffagent');
      if (ffbr || ffag) { if (ffbr && !LOCK) S.brands = [ffbr]; openCalls({ ff: { kind: fk, value: fv, label: fl } }, ffag || null); return; }
      var ffo = { ff: { kind: fk, value: fv, label: fl, notbooked: !!ffb.getAttribute('data-ffnb') } };
      if (S.view === 'csr') openCalls(ffo, S.agent); else { if (S.view === 'brand' && S.brand) S.brands = [S.brand]; openCalls(ffo); } return; }
    var xp = t.closest('[data-xferpair]');
    if (xp) { var xv = xp.getAttribute('data-xferpair').split('|'), xd = xv.shift(), xn = xv.join('|'); if (S.view === 'csr') openCalls({ xfer: xd, xferWith: xn }, S.agent); else { if (S.view === 'brand' && S.brand) S.brands = [S.brand]; openCalls({ xfer: xd, xferWith: xn }); } return; }
    var ccq = t.closest('[data-ccq]');
    if (ccq) { ccAsk(ccq.getAttribute('data-ccq')); return; }
    if (t.closest('[data-ccclear]')) { if (S.cur) { CC[S.cur.id] = { msgs: [] }; ccPaint(S.cur.id, true); } return; }
    if (t.closest('[data-ccgo]')) { var cx = $('ccx'); if (cx) { cx.scrollIntoView({ block: 'center', behavior: 'smooth' }); setTimeout(function () { if ($('ccq')) $('ccq').focus(); }, 300); } return; }
    var pdl = t.closest('[data-pdl]');
    if (pdl) { var did = P.id; toast('Preparing download…'); api({ action: 'audio', id: did, t: Date.now() }).then(function (info) { if (!info || !info.url) { toast('No recording is available for this call.'); return; } var a = document.createElement('a'); a.href = dlHref(info.url); if (a.href.indexOf('download=') < 0) { a.target = '_blank'; a.rel = 'noopener'; } ROOT.appendChild(a); a.click(); a.remove(); }).catch(function () { toast('The download didn’t start. Try again.'); }); return; }
    if (t.closest('[data-backask]')) { stopAudio(); P.id = null; S.callId = null; S.fromAsk = false; S.ask.open = true; askPanel(); return; }
    if (t.closest('[data-pspeed]')) { var rs = [1, 1.25, 1.5, 2], ri = rs.indexOf(P.rate || 1); P.rate = rs[(ri + 1) % rs.length]; AU.playbackRate = P.rate; paintPlayer(); return; }
    if (t.closest('[data-pretry]')) { var rid = P.id; P.id = null; loadAudio(rid); paintPlayer(); return; }
    var rph = t.closest('[data-rphone]');
    if (rph) { phoneDrawer(rph.getAttribute('data-rphone')); return; }
    var rk = t.closest('[data-rkind]');
    if (rk) { S.rkind = rk.getAttribute('data-rkind'); if (S.view === 'repeat') render(); else go('repeat'); return; }
    var pm = t.closest('[data-pmode]');
    if (pm) { S.pmode = pm.getAttribute('data-pmode'); loadPhone().then(phoneChart); return; }
    var ps = t.closest('[data-psort]');
    if (ps) { var pk = ps.getAttribute('data-psort').split('|'); S['pd' + pk[0]] = S['ps' + pk[0]] === pk[1] ? -(S['pd' + pk[0]] || 1) : 1; S['ps' + pk[0]] = pk[1]; loadPhone().then(pk[0] === 'b' ? phoneBrands : phoneCsrs); return; }
    var tm = t.closest('[data-tmode]');
    if (tm) { S.tmode = tm.getAttribute('data-tmode'); loadReport().then(trendCard); return; }
    var el = t.closest('[data-go],[data-brand],[data-agent],[data-call],[data-close],[data-kpi],[data-step],[data-ask],[data-pop],[data-range],[data-act],[data-bsort],[data-csort],[data-mix],[data-page],[data-unfilter],[data-callsfor],[data-needs],[data-xferlist],[data-change],[data-q],[data-outcome],[data-brandcb],[data-allbrands]');
    if (S.pop && !t.closest('.pop') && !t.closest('[data-pop]')) { S.pop = null; render(); if (!el) return; }
    if (!el) return;
    var d = el.dataset;
    if (d.brandcb !== undefined || d.allbrands !== undefined) {
      if (d.allbrands !== undefined) S.brands = [];
      else { var i = S.brands.indexOf(d.brandcb); if (i >= 0) S.brands.splice(i, 1); else S.brands.push(d.brandcb); }
      // on a brand's page the picker moves you: one brand = that brand's page, anything else = the Brands table (2026-10-26)
      if (S.view === 'brand') { if (S.brands.length === 1) S.brand = S.brands[0]; else { S.pop = null; go('brands'); return; } }
      render(); return;
    }
    if (d.close && t !== el && !t.closest('button[data-close]') && t.closest('.drawer')) { return; /* inside drawer: let forms, inputs and links behave normally */ }
    else if (d.close) { e.preventDefault(); closeLayer(); return; }
    e.preventDefault();
    if (d.go) { if (S.ask.open || S.callId) closeLayer(); if (d.go === 'hubqs') { HQ.csr = null; HQ.topic = null; } go(d.go); }
    else if (d.brand !== undefined && !d.outcome) { closeLayer(); S.brand = d.brand; go('brand'); }
    else if (d.agent !== undefined) { closeLayer(); S.agent = d.agent; go('csr'); }
    else if (d.call) { S.fromAsk = !!S.ask.open || (!!S.fromAsk && !!S.callId); S.ask.open = false; S.callId = d.call; callDrawer(); }
    else if (d.change !== undefined) { S.change = +d.change; changeModal(); }
    else if (d.kpi) { if (kpiGo(d.kpi)) return;
      var map = { lowscore: { scoreMax: 40 }, notbooked: { outcome: 'Not Booked' }, noask: { step: 'ask_booking' }, nocard: { nocard: true }, winnable: { winnable: true, scoreMax: 40 } };
      openCalls(map[d.kpi]);
    }
    else if (d.step) { openCalls({ step: d.step }, d.sagent || null); if (d.sbrand) { S.brands = [d.sbrand]; render(); } }
    else if (d.xferlist) { if (S.view === 'csr') openCalls({ xfer: d.xferlist }, S.agent); else { S.brands = [S.brand]; openCalls({ xfer: d.xferlist }); } }
    else if (d.needs) { openCalls({ bucket: d.needs }); }
    else if (d.callsfor) { if (d.callsfor === 'csr') openCalls({}, S.agent); else { S.brands = [S.brand]; openCalls({}); } }
    else if (d.ask) { ask(d.ask); }
    else if (d.q !== undefined || d.outcome) { openCalls({ q: d.q || '', outcome: d.outcome || null }); }
    else if (d.pop) { S.pop = S.pop === d.pop ? null : d.pop; render(); if (S.pop === 'brands') ensureBrands(); }
    else if (d.range) { S.range = d.range; S.pop = null; cache = {}; applyRange(); render(); }
    else if (d.bsort) { S.brandDir = S.brandSort === d.bsort ? -(S.brandDir || 1) : 1; S.brandSort = d.bsort; render(); }
    else if (d.csort) { S.csrDir = S.csrSort === d.csort ? -(S.csrDir || 1) : 1; S.csrSort = d.csort; render(); }
    else if (d.mix) { S.mix = d.mix; if (lastFocus) focusMix(lastFocus, $('fmix').dataset.fb, $('fmix').dataset.fa); }
    else if (d.page) { S.calls.offset = Math.max(0, S.calls.offset + (+d.page) * 25); window.scrollTo(0, 0); render(); }
    else if (d.unfilter) { var c = S.calls; if (d.unfilter === 'all') { S.calls = { offset: 0 }; S.callsAgent = null; } else if (d.unfilter === 'agent') S.callsAgent = null; else { c[d.unfilter] = d.unfilter === 'q' ? '' : null; if (d.unfilter === 'xfer') c.xferWith = null; c.offset = 0; } render(); }
    else if (d.act) {
      var a = d.act;
      if (a === 'customrange') { var cs = $('cs').value, ce = $('ce').value; if (cs && ce && cs <= ce) { S.range = 'custom'; S.start = cs; S.end = ce; S.pop = null; render(); } else toast('Pick a start date before the end date.'); }
      else if (a === 'closepop') { S.pop = null; render(); }
      else if (a === 'huballbrands') { S.brands = []; render(); }
      else if (a === 'copylink') {
        writeHash(); var href = location.href, done = function () { toast('Link copied. Anyone with a portal login for these brands can open it.'); };
        var fallback = function () { var ta = document.createElement('textarea'); ta.value = href; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (x) { toast('Copy this link: ' + href); } ta.remove(); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(href).then(done, fallback); else fallback();
      }
      else if (a === 'retry') { cache = {}; render(); }
      else if (a === 'signout') { if (CFG.onSignOut) CFG.onSignOut(); }
      else if (a === 'classic') { if (CFG.onClassic) CFG.onClassic(); }
      else if (a === 'pdf') { printCall(); }
      else if (a === 'qshmore') { QSHN += 25; drawQs(); }
      else if (a === 'kbclear') { KBS.q = ''; KBS.cat = ''; drawKb(); var q2 = $('kbq'); if (q2) q2.focus(); }
      else if (a === 'ceopen') { ceModal(); }
      else if (a === 'cereqok' || a === 'cereqno') { ceDecide(d.r, a === 'cereqok', el); }
      else if (a === 'reqok' || a === 'reqno') { decideReq(d.r, a === 'reqok', el); }
      else if (a === 'restore') { var rk = d.k, st = ((S.cur && S.cur.steps) || []).filter(function (x) { return x.key === rk; })[0]; if (st) { el.disabled = true; saveAdjust(rk, st.ai_answer, null).then(function () { toast('Change undone'); }).catch(function (e2) { el.disabled = false; toast(e2.message || 'Couldn’t restore.'); }); } }
      else if (a === 'invite') { TM.inv = { name: '', email: '', role: 'manager', brand: '' }; drawTeam(); }
      else if (a === 'invcancel') { TM.inv = null; drawTeam(); }
      else if (a === 'invsend') { keepInv(); var I = TM.inv, nm = I.name.trim(), em = I.email.trim();
        if (!nm) { toast('Add their full name'); return; } if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { toast('Add a valid email'); return; }
        if (TM.busy) return; TM.busy = true; busyBtn(el, true);
        api({ action: 'teaminvite', op: 'invite', name: nm, email: em, role: I.role, brand: I.role === 'admin' ? null : (I.brand || null) }).then(function (r) { TM.mail = r.mail; TM.inv = null; return api({ action: 'team' }); }).then(function (r2) { TM.busy = false; TM.list = r2.people || TM.list; drawTeam(); toast('Login created · send the invite from your mailbox'); })
          .catch(function (e2) { TM.busy = false; busyBtn(el, false); drawTeam(); toast(e2.message || 'Couldn’t create the invite.'); }); }
      else if (a === 'mailclose') { TM.mail = null; drawTeam(); }
      else if (a === 'mailcopy') { var MM = TM.mail; if (MM && navigator.clipboard) navigator.clipboard.writeText('Subject: ' + MM.subject + '\n\n' + MM.body).then(function () { toast('Copied'); }, function () { toast('Couldn’t copy. Select the text instead.'); }); }
      else if (a === 'presend') { var pu = TM.list[+d.i]; if (TM.busy) return; TM.busy = true; busyBtn(el, true); api({ action: 'teaminvite', op: 'link', id: pu.id }).then(function (r) { TM.busy = false; TM.mail = r.mail; drawTeam(); toast('New sign-in link ready for ' + pu.name); }).catch(function (e2) { TM.busy = false; busyBtn(el, false); toast(e2.message || 'Couldn’t create a link.'); }); }
      else if (a === 'pdel') { TM.del = +d.i; drawTeam(); }
      else if (a === 'pdelno') { TM.del = null; drawTeam(); }
      else if (a === 'pdelyes') { var gu = TM.list[+d.i]; teamWrite({ op: 'remove', id: gu.id }, gu.name + ' no longer has access', el); }
      else if (a === 'prestore') { var ru = TM.list[+d.i]; teamWrite({ op: 'restore', id: ru.id }, ru.name + ' has access again', el); }
      else if (a === 'kbedit') { KBS.edit = +d.i; KBS.del = null; drawKb(); }
      else if (a === 'kbcancel') { KBS.edit = null; drawKb(); }
      else if (a === 'kbsave') { var ka = KBS.list[KBS.edit], t2 = $('kbt').value.trim(), b2 = $('kbb').value.trim(); if (!t2 || !b2) { toast('Add a title and the details'); return; } kbWrite({ op: 'edit', id: ka.id, title: t2, category: $('kbc').value, body: b2 }, 'Saved — used when scoring new calls', el); }
      else if (a === 'kbdel') { KBS.del = +d.i; drawKb(); }
      else if (a === 'kbdelno') { KBS.del = null; drawKb(); }
      else if (a === 'kbdelyes') { kbWrite({ op: 'remove', id: KBS.list[+d.i].id }, 'Removed', el); }
      else if (a === 'kbadd') { var t3 = $('kbt').value.trim(), b3 = $('kbb').value.trim(); if (!t3 || !b3) { toast('Add a title and the details'); return; } kbWrite({ op: 'add', title: t3, category: $('kbc').value, body: b3 }, 'Added — used when scoring new calls', el); }
      else if (a === 'rpexport') { rpExport(); }
      else if (a === 'mnbucket') { MN.bucket = MN.bucket === +d.i ? null : +d.i; drawMoney(); }
      else if (a === 'jvedit') { MN.edit = d.jt; drawMoney(); var jv = $('jvv'); if (jv) jv.focus(); }
      else if (a === 'jvcancel') { MN.edit = null; drawMoney(); }
      else if (a === 'jvsave') { jvSave(d.jt); }
      else if (a === 'rpdl') { rpDownload(d.r, d.f); }
      else if (a === 'rpweek') { var wk0 = ($('rpwk') || {}).value || lastMon(); RP.week = wk0; RP.wkb = ($('rpwkb') || {}).value || ''; var ww = pdfWin(); if (ww) { RP.busy = 'week'; drawReporting(); opWeek(ww, wk0, RP.wkb || (LOCK || null)).then(function () { RP.busy = ''; drawReporting(); }).catch(function (e) { try { ww.close(); } catch (x) {} RP.busy = ''; drawReporting(); toast(e.message || 'Couldn’t build that report.'); }); } }
      else if (a === 'qsinsedit') { QSE.ins = true; drawQs(); }
      else if (a === 'ccf') { CAP.f = d.f; CAP.shown = 50; drawCard(); }
      else if (a === 'ccag') { if (CAP.ag === d.ag && CAP.b === d.br) { CAP.ag = null; CAP.b = null; } else { CAP.ag = d.ag; CAP.b = d.br; } CAP.shown = 50; drawCard(); }
      else if (a === 'ccbr') { if (CAP.b === d.br && !CAP.ag) CAP.b = null; else { CAP.b = d.br; CAP.ag = null; } CAP.shown = 50; drawCard(); }
      else if (a === 'ccclr') { CAP.ag = null; CAP.b = null; drawCard(); }
      else if (a === 'ccmore') { CAP.shown += 100; drawCard(); }
      else if (a === 'cccsv') { ccCsv(); }
      else if (a === 'rsreload') { RS.err = null; drawRules(); loadRules(); }
      else if (a === 'rsrun') { if (RS.busy) return; rulesOp({ op: 'run' }, function (r) { return r && r.found ? r.found + ' new suggestion' + (r.found === 1 ? '' : 's') : 'No new patterns found'; }, el); RS.busy = 'run'; drawRules(); }
      else if (a === 'rsok') { var rsr = $('rsr' + d.id); rulesOp({ op: 'approve', id: +d.id, rule: rsr ? rsr.value : '' }, function () { return 'Rule added · new calls use it now'; }, el); }
      else if (a === 'rsno') { rulesOp({ op: 'dismiss', id: +d.id }, function () { return 'Suggestion dismissed'; }, el); }
      else if (a === 'qsinscancel') { QSE.ins = false; drawQs(); }
      else if (a === 'qsins') { var gtxt = $('qins').value; qsWrite({ op: 'guidance', text: gtxt }, 'Saved — used when scoring new calls', function () { QSE.ins = false; }, el); }
      else if (a === 'qsmnew') { QSE.metric = true; drawQs(); }
      else if (a === 'qsmcancel') { QSE.metric = false; drawQs(); }
      else if (a === 'qsmadd') { var ml = $('qmn').value.trim(), mpp = +$('qmp').value, mg = $('qmg').value.trim(); if (!ml || !(mpp >= 1 && mpp <= 50)) { toast('Add a name and 1–50 points'); return; } qsWrite({ op: 'metric_add', label: ml, points: mpp, guidance: mg || null }, 'Metric added — used when scoring new calls', function () { QSE.metric = false; }, el); }
      else if (a === 'qsmdel') { QSE.del = d.k; drawQs(); }
      else if (a === 'qsmdelno') { QSE.del = null; drawQs(); }
      else if (a === 'qsmdelyes') { qsWrite({ op: 'metric_remove', key: d.k }, 'Metric removed', function () { QSE.del = null; }, el); }
      else if (a === 'qsreq') { QSE.req = true; drawQs(); }
      else if (a === 'qsreqcancel') { QSE.req = false; drawQs(); }
      else if (a === 'qsreqsend') { var rq = $('qreq').value.trim(); if (!rq) { toast('Describe the change you’d like'); return; } el.disabled = true; api({ action: 'rubric', op: 'request', text: rq }).then(function (r) { QSE.req = false; RUBREQ = null; drawQs(); toast(r && r.admins ? 'Sent to your account admin' : 'Saved. Your account has no admin login yet.'); }).catch(function (e2) { el.disabled = false; toast(e2.message || 'Couldn’t send.'); }); }
      else if (a === 'rubedit') { var rub0 = (QS.rubric || []).filter(function (r) { return r.section !== 'custom'; }); QSE.redit = rub0.map(function (r) { return { key: r.key, label: r.label, points: r.points, guidance: r.guidance || '' }; }); drawQs(); }
      else if (a === 'rubadd') { readRubForm(); QSE.redit.push({ key: null, label: '', points: 0, guidance: '' }); drawQs(); }
      else if (a === 'rubcancel') { QSE.redit = null; drawQs(); }
      else if (a === 'rubsave') { readRubForm(); var stp = QSE.redit.filter(function (x) { return (x.label || '').trim(); }); el.disabled = true; el.textContent = 'Saving…';
        api({ action: 'rubric', op: 'save', steps: stp }).then(function (r) { return api({ action: 'settings' }).then(function (s2) { QS = s2; QSE.redit = null; drawQs(); toast(r.changed ? 'Call flow saved · applies to newly scored calls' : 'No changes'); }); })
          .catch(function (e2) { el.disabled = false; el.textContent = 'Save call flow'; toast(e2.message || 'Couldn’t save.'); }); }
      else if (a === 'rubreqdone' || a === 'rubreqno') { el.disabled = true; api({ action: 'rubric', op: 'dismiss', req: d.r, done: a === 'rubreqdone' }).then(function () { RUBREQ = null; drawQs(); }).catch(function (e2) { el.disabled = false; toast(e2.message || 'Couldn’t update.'); }); }
    }
  });
  on(document, 'input', function (e) {
    if (e.target && e.target.id === 'pseek') { P.step = null; P.stepEnd = null; vseek(+e.target.value); tick(); }
  });
  on(document, 'change', function (e) {
    var t = e.target;
    if (t.hasAttribute && t.hasAttribute('data-invrole') && TM.inv) { keepInv(); TM.inv.role = t.value; drawTeam(); }
    else if (t.hasAttribute && t.hasAttribute('data-rpscope')) { RP.scope = t.getAttribute('data-rpscope'); drawReporting(); }
    else if (t.hasAttribute && t.hasAttribute('data-rpagent')) { RP.agent = t.value; }
    else if (t.hasAttribute && t.hasAttribute('data-rptypes')) { RP.allTypes = t.checked; }
    else if (t.hasAttribute && t.hasAttribute('data-rptrans')) { RP.trans = t.checked; }
    else if (t.hasAttribute && t.hasAttribute('data-jvbrand')) { MN.jvb = t.value; MN.edit = null; drawMoney(); }
    else if (t.hasAttribute && t.hasAttribute('data-invfile')) { invUpload(t.files && t.files[0]); t.value = ''; }
    else if (t.hasAttribute && t.hasAttribute('data-rpteam')) { RP.team = t.value; }
    else if (t.hasAttribute && t.hasAttribute('data-rpcsr')) { RP.csr = t.value; }
    else if (t.hasAttribute && t.hasAttribute('data-hubqbrand')) { HQ.brand = t.value; HQ.csr = null; HQ.topic = null; S.brands = t.value ? [t.value] : []; render(); }
    else if (t.hasAttribute && t.hasAttribute('data-hubweek')) { HUB.week = t.value; HUB.home = {}; HUB.wins = {}; HUB.roster = null; render(); }
    else if (t.hasAttribute && t.hasAttribute('data-trow') && TM.list) {
      var u = TM.list[+t.getAttribute('data-trow')], rs = $('tr-' + u.id), bs = $('tb-' + u.id);
      var role = rs ? rs.value : u.role, brand = role === 'admin' ? null : (bs ? (bs.value || null) : (u.brand || null));
      teamWrite({ op: 'update', id: u.id, role: role, brand: brand }, u.name + ' is now ' + RNAME[role] + (role === 'admin' ? '' : ' · ' + (brand ? short(brand) : 'all brands')));
    }
  });
  on(document, 'keydown', function (e) {
    if (e.key === 'Escape') { var chg = $('chg'); if (chg) { chg.remove(); return; } if (S.pop) { S.pop = null; render(); return; } if (S.fromAsk && S.callId && !S.ask.open) { stopAudio(); P.id = null; S.callId = null; S.fromAsk = false; S.ask.open = true; askPanel(); return; } if ($('layer').innerHTML) closeLayer(); }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr.click,.lnk')) { e.preventDefault(); e.target.click(); }
    if (e.key === '/' && !e.target.matches('input,textarea,select')) { e.preventDefault(); var q = $('askq'); if (q) q.focus(); }
  });
  on(window, 'resize', function () { clearTimeout(fitReview.t); fitReview.t = setTimeout(fitReview, 150); });
  on(window, 'hashchange', function () { var before = location.hash; readHash(); render(); });
  var lg = $('oqlogo'); if (lg) { lg.src = CFG.logo || 'https://dqvuviyqrcrgapmxkoyx.supabase.co/storage/v1/object/public/portal-assets/garageco/logo.png'; lg.alt = CLIENT; }
  var DEEP_CALL = (location.hash.match(/(?:^#|&)call=([0-9a-f-]{36})/i) || [])[1];
  readHash(); render();
  if (DEEP_CALL && !CFG.csrSelf) { S.callId = DEEP_CALL; callDrawer(); }
  return function destroy() {
    LISTENERS.forEach(function (l) { l[0].removeEventListener(l[1], l[2]); }); LISTENERS = [];
    try { AU.pause(); AU.removeAttribute('src'); AU.load(); } catch (x) {}
    if (EXT) { try { EXT(); } catch (x) {} EXT = null; }
  };
})();
  return function () { destroy(); ROOT.innerHTML = ''; };
}
