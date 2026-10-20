// Opsis QA client portal — the app shown at garageco.opsiscx.com (generated; do not hand-edit).
// Built from the Opsis QA preview page by scratchpad/portal/build.py. All data comes from the
// authenticated edge function opsis-qa-portal (scoped to the signed-in login's client + brand).
// mountOpsisQA(rootEl, cfg) renders the app and returns a destroy() function.
// cfg: { invoke(body) -> Promise<json>, role, brandLock, clientName, clientId, staff, userName, email,
//        logo, hasCsrs, phone, mountCsr(el) -> cleanup, onSignOut(), onClassic() }
var CSS = "#oqa{--bg:#F5F3EE;--card:#FFFFFF;--line:#E8E4DC;--line2:#F1EEE8;--ink:#1C2421;--mut:#5F6763;--g:#2F7D5B;--gd:#1F5A41;--gl:#E6F0EA;--o:#E0662A;--od:#A8441A;--ol:#FCEBDD;--side:#14302A;--blue:#3A4380}\n#oqa *{box-sizing:border-box}\n#oqa{margin:0;background:var(--bg);color:var(--ink);font-family:Montserrat,Arial,sans-serif;font-size:14px}\n#oqa a{color:var(--g)}\n#oqa button{font-family:inherit;font-size:inherit}\n#oqa .oq-app{display:flex;flex-wrap:wrap;min-height:100vh}\n#oqa aside{flex:1 1 236px;max-width:100%;background:var(--side);color:#fff;padding:22px 14px 18px;display:flex;flex-direction:column;gap:22px}\n#oqa main{flex:999 1 640px;min-width:0;padding:16px 24px 32px;display:flex;flex-direction:column;gap:16px}\n#oqa .logo{background:#fff;border-radius:12px;padding:12px 14px;display:flex;align-items:center;justify-content:center;min-height:64px}\n#oqa .logo img{max-width:100%;max-height:48px;display:block}\n#oqa .nav{display:flex;flex-direction:column;gap:2px}\n#oqa .nav button{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:12px;width:100%;padding:10px 14px;border-radius:10px;color:#D6E2DC;font-size:14px;cursor:pointer;min-height:44px}\n#oqa .nav button:hover{background:#1F3F37;color:#fff}\n#oqa .nav button.on{background:#2A4A42;color:#fff;font-weight:600}\n#oqa .nav button:focus-visible,#oqa .click:focus-visible,#oqa button:focus-visible{outline:2px solid #7CC4A4;outline-offset:2px}\n#oqa .navsec{font-size:10px;letter-spacing:.18em;color:#9DBBAE;padding:14px 14px 4px;font-weight:600}\n#oqa .powered{margin-top:auto;border-top:1px solid #234840;padding:14px 8px 0;font-size:11.5px;color:#BFD1C8;display:flex;align-items:center;gap:8px}\n#oqa .oq-card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px;min-width:0}\n#oqa .ttl{margin:0;font-size:17px;font-weight:600;letter-spacing:-0.02em}\n#oqa .sub{margin:4px 0 0;font-size:12.5px;color:var(--mut);line-height:1.45}\n#oqa .cap{font-size:10.5px;font-weight:600;letter-spacing:.13em;text-transform:uppercase;color:#56605B}\n#oqa .mut{color:var(--mut)}\n#oqa .num{font-variant-numeric:tabular-nums}\n#oqa .more{all:unset;cursor:pointer;font-size:12.5px;font-weight:600;color:#2F5E4E;min-height:32px;display:inline-flex;align-items:center;gap:4px}\n#oqa .more:hover{color:var(--ink)}\n#oqa .sel{border:1px solid #E1DCD2;background:#fff;font-size:13px;color:var(--ink);padding:9px 14px;border-radius:10px;cursor:pointer;min-height:42px;display:inline-flex;align-items:center;gap:8px;text-decoration:none;white-space:nowrap}\n#oqa .sel:hover{border-color:#B9B2A6}\n#oqa .btnd{background:var(--side);border-color:var(--side);color:#fff}\n#oqa .btnd:hover{border-color:var(--side)}\n#oqa .pill{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:600;padding:4px 9px;border-radius:8px;white-space:nowrap}\n#oqa .tbl{width:100%;border-collapse:collapse;font-size:13px}\n#oqa .tbl th{text-align:left;font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#56605B;padding:0 8px 10px;white-space:nowrap;cursor:default}\n#oqa .tbl th.sortable{cursor:pointer}\n#oqa .av{width:32px;height:32px;border-radius:999px;background:#E6F0EA;color:#1F5A41;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0}\n#oqa .tbl th.sortable:hover{color:var(--ink)}\n#oqa .tbl td{padding:10px 8px;white-space:nowrap;border-top:1px solid var(--line2)}\n#oqa .tbl tr.click{cursor:pointer}\n#oqa .tbl tr.click:hover td{background:#FAF8F3}\n#oqa .track{height:6px;border-radius:999px;background:#EEEBE4;overflow:hidden}\n#oqa .track>div{height:100%;border-radius:999px}\n#oqa .row{display:flex;flex-wrap:wrap;gap:12px}\n#oqa .grid{display:grid;gap:12px}\n#oqa .banner{background:#FFF8E8;border:1px solid #F0DDB0;color:#6B4E12;border-radius:12px;padding:9px 14px;font-size:12.5px}\n#oqa input,#oqa textarea,#oqa select{font-family:inherit;font-size:13.5px;color:var(--ink)}\n#oqa .oq-field{border:1px solid #E1DCD2;border-radius:10px;padding:10px 12px;width:100%;background:#fff}\n#oqa label.l{display:block;font-size:12px;font-weight:600;margin-bottom:6px;color:#3B4541}\n#oqa .toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--side);color:#fff;padding:12px 18px;border-radius:12px;font-size:13px;box-shadow:0 8px 30px rgba(0,0,0,.18);z-index:80;display:none}\n#oqa .overlay{position:fixed;inset:0;background:rgba(20,48,42,.35);display:flex;justify-content:flex-end;z-index:60}\n#oqa .drawer{width:640px;max-width:100%;height:100%;overflow-y:auto;background:#F7F5F0;padding:22px;display:flex;flex-direction:column;gap:14px}\n#oqa .click{cursor:pointer}\n#oqa .chip{border:1px solid #E1DCD2;background:#fff;font-size:12.5px;padding:7px 12px;border-radius:999px;cursor:pointer;min-height:34px;color:var(--ink);text-align:left}\n#oqa .chip:hover{border-color:var(--g);color:var(--gd)}\n#oqa .chip.on{background:var(--side);color:#fff;border-color:var(--side)}\n#oqa .seg{display:inline-flex;background:#fff;border:1px solid #E1DCD2;border-radius:10px;padding:3px;gap:2px;flex-wrap:wrap}\n#oqa .seg button{border:none;background:transparent;padding:7px 11px;border-radius:8px;cursor:pointer;font-size:12.5px;color:var(--ink);min-height:34px}\n#oqa .seg button.on{background:var(--side);color:#fff}\n#oqa .skel{background:linear-gradient(90deg,#EEEBE4 25%,#F6F4EF 50%,#EEEBE4 75%);background-size:200% 100%;animation:sk 1.2s infinite;border-radius:8px}\n\n@keyframes sk{0%{background-position:200% 0}100%{background-position:-200% 0}}#oqa .ai{background:linear-gradient(0deg,#fff,#fff);border:1px solid #CFE3D8;border-radius:14px;padding:18px}\n#oqa .ai .md{line-height:1.6;font-size:13.5px}\n#oqa .ai .md ul{margin:8px 0;padding-left:20px}\n#oqa .ai .md li{margin:3px 0}\n#oqa .lnk{color:var(--gd);font-weight:600;cursor:pointer;border-bottom:1px dashed #9CC6B2}\n#oqa .lnk:hover{color:var(--ink)}\n#oqa .dots span{display:inline-block;width:7px;height:7px;border-radius:999px;background:var(--g);margin-right:4px;animation:bl 1s infinite}\n#oqa .dots span:nth-child(2){animation-delay:.15s}\n#oqa .dots span:nth-child(3){animation-delay:.3s}\n\n@keyframes bl{0%,100%{opacity:.25}50%{opacity:1}}#oqa .pop{position:absolute;z-index:50;background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.12);padding:12px;min-width:260px;max-height:420px;overflow:auto}\n#oqa .oq-crumb{font-size:12.5px;color:var(--mut);display:flex;gap:6px;align-items:center;flex-wrap:wrap}\n#oqa .oq-crumb button{all:unset;cursor:pointer;color:var(--gd);font-weight:600}\n#oqa .step{padding:12px;border-top:1px solid var(--line2)}\n#oqa .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}\n#oqa .foot{text-align:center;font-size:12px;color:var(--mut);padding:8px 0 0}\n@media (max-width:760px){#oqa main{padding:12px 14px 28px}\n#oqa .hero h1{font-size:26px!important}\n#oqa .drawer{padding:16px}\n}\n\n#oqa{min-height:100vh;font-family:Montserrat,Arial,sans-serif;font-size:14px;color:var(--ink);background:var(--bg)}\n#oqa .who{border-top:1px solid #234840;padding:12px 8px 0;font-size:12px;color:#BFD1C8;display:flex;flex-direction:column;gap:6px}\n#oqa .who b{color:#fff;font-weight:600;font-size:12.5px}\n#oqa .who button{all:unset;cursor:pointer;color:#D6E2DC;text-decoration:underline;text-underline-offset:2px;font-size:12px}\n#oqa .who button:hover{color:#fff}\n";
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
  var STEPNAMES = { introduce: 'Introduce', listen: 'Listen', collect_info: 'Collect info', sell_appointment: 'Sell the appointment', confirm_thank: 'Confirm and thank', greeting: 'Greeting', empathy: 'Acknowledge / empathy', verify_approver: 'Verify + confirm approver', discovery: 'Discovery', set_expectations: 'Set expectations', explain_fee: 'Explain the fee', offer_appt: 'Offer next appointment', ask_booking: 'Ask for the booking', capture_payment: 'Capture payment', confirm_details: 'Confirm appointment details', thank_close: 'Thank customer + close' };
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
    if (S.range === 'month') { S.end = t; S.start = t.slice(0, 8) + '01'; return; }
    if (S.range === 'lastmonth') { var f = t.slice(0, 8) + '01'; S.end = addDays(f, -1); S.start = S.end.slice(0, 8) + '01'; return; }
    var n = +S.range || 30; S.end = t; S.start = addDays(t, -(n - 1));
  }
  applyRange();
  function prevWin() { var n = daysBetween(S.start, S.end); return { start: addDays(S.start, -n), end: addDays(S.start, -1) }; }

  // ---------------- data ----------------
  var cache = {};
  var CACHEABLE = { report: 1, focus: 1, calls: 1, phone: 1, repeat: 1, ai: 1 };
  function api(body) {
    if (CFG.clientId) body = Object.assign({ client_id: CFG.clientId }, body);
    var k = JSON.stringify(body), cacheable = !!CACHEABLE[body.action];
    if (cacheable && cache[k]) return cache[k];
    var isRead = cacheable || body.action === 'call' || body.action === 'audio' || ((body.action === 'kb' || body.action === 'settings' || body.action === 'team') && !body.op) || (body.action === 'notes' && body.body == null);
    var once = function () { return CFG.invoke(body); };
    var wait = function (ms) { return new Promise(function (res) { setTimeout(res, ms); }); };
    var stop = function (e) { return e.status && e.status < 500 && e.status !== 408; };
    var pr = !isRead ? once() : once().catch(function (e) { if (stop(e)) throw e; return wait(1500).then(once); }).catch(function (e) { if (stop(e)) throw e; return wait(3000).then(once); });
    if (cacheable) { cache[k] = pr; pr.catch(function () { delete cache[k]; }); }
    return pr;
  }
  function win(extra) { var o = { start: S.start, end: S.end, brands: S.brands.length ? S.brands : null }; for (var k in extra) o[k] = extra[k]; return o; }
  function loadReport() { return api(Object.assign({ action: 'report' }, win())); }
  function loadPrevReport() { var p = prevWin(); return api({ action: 'report', start: p.start, end: p.end, brands: S.brands.length ? S.brands : null }); }
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
      calls: 'M12 21a9 9 0 1 0-9-9c0 1.6.4 3 1.1 4.3L3 21l4.7-1.1A9 9 0 0 0 12 21zM10 9v6l5-3z', insights: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
      kb: 'M4 5a2 2 0 0 1 2-2h5v18H6a2 2 0 0 0-2 2zM20 5a2 2 0 0 0-2-2h-5v18h5a2 2 0 0 1 2 2z', settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
      scorecards: 'M9 3h6v3H9zM7 4.5H5V21h14V4.5h-2M8 11h8M8 15h8M8 19h5', team: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M2 20v-1a5 5 0 0 1 10 0v1M17 11a3 3 0 1 0 0-6M22 20v-1a5 5 0 0 0-4-4.9', qasettings: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h12M20 18h0M15 4v4M9 10v4M18 16v4'
    }[k];
  }

  // ---------------- nav + top bar ----------------
  var NAV = [['', [['overview', 'Overview'], ['insights', 'Insights']].concat(CFG.phone === false ? [] : [['phone', 'Phone stats']]).concat(LOCK ? [] : [['brands', 'Brands']]).concat([['csrs', 'CSRs'], ['calls', 'Call reviews']]).concat(CFG.hasCsrs ? [['scorecards', 'CSR scorecards']] : [])],
    ['YOUR SETUP', [['qasettings', 'QA settings'], ['kb', 'Knowledge base']].concat(IS_ADMIN ? [['team', 'Team & access']] : [])]];
  function renderWho() {
    var w = $('oqwho'); if (!w) return;
    w.innerHTML = '<b>' + esc(CFG.userName || '') + '</b><span>' + esc(RNAME[ROLE] || '') + (LOCK ? ' · ' + esc(short(LOCK)) : '') + '</span>' +
      '<span style="display:flex;gap:14px;flex-wrap:wrap">' + (CFG.onClassic ? '<button data-act="classic">Classic view</button>' : '') + (CFG.onSignOut ? '<button data-act="signout">Sign out</button>' : '') + '</span>';
  }
  function renderNav() {
    var cur = S.view === 'brand' ? 'brands' : (S.view === 'csr' ? 'csrs' : (S.view === 'repeat' ? 'insights' : S.view));
    $('nav').innerHTML = NAV.map(function (sec) {
      return (sec[0] ? '<div class="navsec">' + sec[0] + '</div>' : '') + sec[1].map(function (n) {
        return '<button class="' + (cur === n[0] ? 'on' : '') + '" data-go="' + n[0] + '"' + (cur === n[0] ? ' aria-current="page"' : '') + '><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + iconPath(n[0]) + '"/></svg>' + n[1] + '</button>';
      }).join('');
    }).join('');
  }
  var RANGES = [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['month', 'This month'], ['lastmonth', 'Last month'], ['custom', 'Custom…']];
  function rangeLabel() { if (S.range === 'custom') return fdate(S.start) + ' – ' + fdate(S.end); var r = RANGES.filter(function (x) { return x[0] === S.range; })[0]; return r ? r[1] : ''; }
  function topbar() {
    var bl = S.brands.length ? (S.brands.length === 1 ? short(S.brands[0]) : S.brands.length + ' brands') : 'All brands';
    return '<div class="row" style="align-items:center;position:relative">' +
      '<form id="askform" style="flex:1 1 360px;max-width:620px;display:flex;align-items:center;gap:10px;background:#fff;border:1.5px solid #CFE3D8;border-radius:12px;padding:0 6px 0 14px;min-height:46px">' +
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2F7D5B" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>' +
      '<label for="askq" class="sr">Ask anything about your calls</label><input id="askq" autocomplete="off" placeholder="Ask anything — “Who is the top performer at Cedar Park?”" style="flex:1;min-width:0;border:none;outline:none;background:transparent;font-size:14px">' +
      '<button class="sel btnd" type="submit" style="min-height:36px;padding:6px 14px">Ask</button></form>' +
      '<div style="flex:1 1 0"></div>' +
      (LOCK ? '<span class="sel" style="cursor:default">' + esc(short(LOCK)) + '</span>' : '<button class="sel" data-pop="brands" aria-haspopup="true">' + esc(bl) + ' ▾</button>') +
      '<button class="sel" data-pop="range" aria-haspopup="true">' + esc(rangeLabel()) + ' ▾</button>' +
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
        '<label style="display:flex;gap:10px;align-items:center;padding:6px 4px;font-weight:600"><input type="checkbox" data-allbrands ' + (S.brands.length ? '' : 'checked') + '> All brands</label>' +
        list.map(function (b) { return '<label style="display:flex;gap:10px;align-items:center;padding:6px 4px"><input type="checkbox" data-brandcb="' + esc(b) + '" ' + (S.brands.indexOf(b) >= 0 ? 'checked' : '') + '> ' + esc(b) + '</label>'; }).join('') +
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
      '<div class="row"><div class="oq-card" style="flex:999 1 520px" id="brandcard">' + skel(30, 8) + '</div><div class="oq-card" style="flex:1 1 320px" id="coachcard">' + skel(40, 5) + '</div></div>' +
      '<div class="row" style="align-items:flex-start"><div class="oq-card" style="flex:999 1 420px" id="stepcard">' + skel(18, 9) + '</div><div class="oq-card" style="flex:1 1 360px;max-height:470px;overflow-y:auto" id="reviewcard">' + skel(50, 4) + '</div></div>' +
      '<div class="row" style="align-items:flex-start"><div class="oq-card" style="flex:999 1 520px" id="trendcard">' + skel(200, 1) + '</div><div class="ai" style="flex:1 1 360px" id="insightcard">' + skel(30, 4) + '</div></div>');
    Promise.all([loadReport(), loadPrevReport()]).then(function (r) {
      if (tok !== T) return; var cur = r[0], prev = r[1]; noteKnown(cur);
      kpiCards(cur);
      brandTable(cur, prev, 'brandcard', 8);
      coachCard(cur);
      trendCard(cur);
      insightCard(cur, prev);
    }).catch(function (e) { if (tok === T) $('kpis').outerHTML = errBox(e); });
    loadFocus(null, null).then(function (f) { if (tok === T) stepCard(f, 'stepcard', null, null); fitReview(); }).catch(function () {});
    api(Object.assign({ action: 'calls' }, win({ winnable: true, score_max: 40, limit: 5 }))).then(function (c) { if (tok === T) reviewCard(c); }).catch(function () {});
  }

  function noteKnown(rep) {
    if (!S.brands.length) KNOWN.brands = (rep.brands || []).map(function (b) { return b.brand; }).filter(function (b) { return b && b !== '—'; }).sort();
    (rep.agents || []).forEach(function (a) { if (a.scored >= 40 && KNOWN.agents.indexOf(a.name) < 0) KNOWN.agents.push(a.name); });
  }

  function kpiCards(rep) {
    var k = rep.kpis || {}, p = rep.prev || {}, d = rep.daily || [];
    var daily = d.filter(function (x) { return x.calls >= 100; });
    var defs = [
      ['Average QA score', k.avg != null ? k.avg.toFixed(1) : '—', delta(k.avg, p.avg, ''), G, 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.3 6L12 16.4 6.6 19.4l1.3-6L3.4 9.3l6-.7z', daily.map(function (x) { return x.avg; }), 'Average score of every scored conversation (0–100). Click to see the lowest-scoring calls.', 'lowscore'],
      ['Booking rate', p1(k.booking_rate), delta(k.booking_rate, p.booking_rate, ' pts'), G, 'M5 5h14v15H5zM5 9h14M9 3v4M15 3v4M9 14l2 2 4-4', daily.map(function (x) { return x.decided ? x.booked / x.decided * 100 : null; }), 'Customers who booked ÷ customers with a booking decision; each customer counts once. Click to see calls that didn’t book.', 'notbooked'],
      ['Asked for booking', p1(k.ask_rate), delta(k.ask_rate, p.ask_rate, ' pts'), (k.ask_rate || 0) >= (p.ask_rate || 0) ? G : O, 'M21 12a9 9 0 1 1-4.2-7.6M21 4v5h-5', daily.map(function (x) { return x.opps ? x.asked / x.opps * 100 : null; }), 'Opportunity calls where the CSR directly asked to book. Click to see calls where they didn’t ask.', 'noask'],
      ['Card on file', p1(k.cc_rate), delta(k.cc_rate, p.cc_rate, ' pts'), (k.cc_rate || 0) >= (p.cc_rate || 0) ? G : O, 'M3 6h18v12H3zM3 10h18M7 15h3', daily.map(function (x) { return x.booked ? x.cc / x.booked * 100 : null; }), 'Booked calls where a card was collected. Click to see booked calls with no card.', 'nocard']
    ];
    var h = defs.map(function (x) {
      var s = series(x[5], 200, 34, 3), bg = x[3] === G ? '#E6F0EA' : '#FCEBDD';
      return '<button class="oq-card click" data-kpi="' + x[7] + '" title="' + esc(x[6]) + '" style="padding:16px 18px 12px;text-align:left;font:inherit;color:inherit"><div style="display:flex;align-items:center;gap:12px"><div style="width:34px;height:34px;border-radius:9px;background:' + bg + ';display:flex;align-items:center;justify-content:center"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="' + x[3] + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + x[4] + '"/></svg></div><span class="cap">' + x[0] + '</span></div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:14px"><span class="num" style="font-size:34px;font-weight:600;letter-spacing:-0.03em;line-height:1">' + x[1] + '</span>' + x[2] + '</div>' +
        '<svg width="100%" height="34" viewBox="0 0 200 34" preserveAspectRatio="none" style="display:block;margin-top:8px" aria-hidden="true"><path d="' + s.area + '" fill="' + x[3] + '" fill-opacity=".1"/><path d="' + s.line + '" fill="none" stroke="' + x[3] + '" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg><div class="mut" style="font-size:11px;margin-top:4px">vs previous ' + daysBetween(S.start, S.end) + ' days · click for calls</div></button>';
    }).join('');
    var f = rep.funnel || {}, ratio = f.calls ? Math.round(f.conversations / f.calls * 100) : 0, dash = (ratio / 100 * 188.5).toFixed(1);
    h += '<div class="oq-card" style="padding:16px 18px"><div class="cap">Conversations reviewed</div><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:12px"><div><div class="num" style="font-size:30px;font-weight:600;letter-spacing:-0.03em;line-height:1">' + fmt(f.conversations) + '</div><div class="mut" style="font-size:12px;margin-top:6px">of ' + fmt(f.calls) + ' total calls</div></div>' +
      '<div style="position:relative;width:70px;height:70px;flex-shrink:0"><svg width="70" height="70" viewBox="0 0 72 72" role="img" aria-label="' + ratio + ' percent were real conversations"><circle cx="36" cy="36" r="30" fill="none" stroke="#EEEBE4" stroke-width="7"/><circle cx="36" cy="36" r="30" fill="none" stroke="#14302A" stroke-width="7" stroke-linecap="round" stroke-dasharray="' + dash + ' 188.5" transform="rotate(-90 36 36)"/></svg><span class="num" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600">' + ratio + '%</span></div></div><div class="mut" style="font-size:11px;margin-top:8px">The rest were voicemail, internal, IVR or wrong numbers.</div></div>';
    $('kpis').innerHTML = h;
  }

  function brandRows(cur, prev) {
    var pm = {}; (prev && prev.brands || []).forEach(function (b) { pm[b.brand] = b; });
    return (cur.brands || []).filter(function (b) { return b.brand && b.brand !== '—'; }).map(function (b) {
      var pb = pm[b.brand] || {};
      return { name: b.brand, calls: b.calls, avg: b.avg, pavg: pb.avg, rate: pct(b.booked, b.decided), prate: pct(pb.booked, pb.decided), cc: pct(b.cc_collected, b.booked_calls), handed: b.handed_off, opps: b.opps };
    });
  }
  function sortRows(rows, key) {
    var f = { calls: function (r) { return -r.calls; }, avg: function (r) { return -(r.avg || 0); }, rate: function (r) { return -(r.rate || 0); }, cc: function (r) { return -(r.cc || 0); }, change: function (r) { return r.pavg == null ? -99 : -(r.avg - r.pavg); } }[key] || function (r) { return -r.calls; };
    var dir = S.brandDir || 1;
    if (key === 'name') return rows.slice().sort(function (a, b) { return dir * short(a.name).localeCompare(short(b.name)); });
    return rows.slice().sort(function (a, b) { return dir * (f(a) - f(b)); });
  }
  function brandTable(cur, prev, el, limit) {
    var rows = sortRows(brandRows(cur, prev), S.brandSort), shown = limit ? rows.slice(0, limit) : rows;
    var th = function (k, l, t) { var on = S.brandSort === k, asc = (k === 'name') === ((S.brandDir || 1) === 1); return '<th class="sortable" data-bsort="' + k + '" title="' + esc(t) + ' · click again to reverse" aria-sort="' + (on ? (asc ? 'ascending' : 'descending') : 'none') + '">' + l + (on ? (asc ? ' ↑' : ' ↓') : '') + '</th>'; };
    var h = '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap"><div><h2 class="ttl">Performance by brand</h2><p class="sub">Click a brand to see why it’s trending the way it is.</p></div>' + (limit ? '<button class="more" data-go="brands">All ' + rows.length + ' brands →</button>' : '') + '</div>' +
      '<div style="overflow-x:auto;margin-top:12px"><table class="tbl"><thead><tr>' + th('name', 'Brand', 'Sort A–Z') + '' + th('calls', 'Calls', 'Conversations scored') + th('avg', 'QA score', 'Average QA score') + th('change', 'Change', 'Score change vs the previous period') + th('rate', 'Booking', 'Booked ÷ calls with a booking decision') + th('cc', 'Card', 'Booked calls with a card collected') + '<th></th></tr></thead><tbody>';
    shown.forEach(function (r) {
      h += '<tr class="click" data-brand="' + esc(r.name) + '" tabindex="0"><td><div style="display:flex;align-items:center;gap:10px">' + bbadge(r.name) + '<span style="font-weight:600">' + esc(short(r.name)) + '</span></div></td><td class="num">' + fmt(r.calls) + '</td><td class="num">' + (r.avg != null ? r.avg.toFixed(1) : '—') + '</td><td>' + delta(r.avg, r.pavg, '') + '</td>' +
        '<td><div style="display:flex;align-items:center;gap:8px;min-width:120px"><span class="num" style="width:44px">' + p1(r.rate) + '</span><div class="track" style="flex:1"><div style="background:' + ((r.rate || 0) >= 60 ? G : O) + ';width:' + (r.rate || 0) + '%"></div></div></div></td>' +
        '<td class="num" style="' + ((r.cc || 0) < 5 ? 'color:#A8441A;font-weight:600' : '') + '">' + p1(r.cc) + '</td><td class="mut" aria-hidden="true">›</td></tr>';
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
    var rows = agentRows(rep, null, 100).filter(function (a) { return a.opps >= 40 && a.ask != null; }).sort(function (a, b) { return a.ask - b.ask; }).slice(0, 5);
    var h = '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px"><div><h2 class="ttl">Top coaching opportunities</h2><p class="sub">Busiest CSRs who ask for the booking least often</p></div><button class="more" data-go="csrs">All CSRs →</button></div>';
    if (!rows.length) h += '<p class="mut">Not enough calls in this period.</p>';
    rows.forEach(function (c, i) {
      h += '<button class="click" data-agent="' + esc(c.name) + '" style="all:unset;box-sizing:border-box;cursor:pointer;width:100%;display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid var(--line2)"><span style="width:26px;height:26px;border-radius:999px;font-size:12px;font-weight:600;display:inline-flex;align-items:center;justify-content:center;' + (i < 3 ? 'background:#FCEBDD;color:#A8441A' : 'background:#F3F1EC') + '">' + (i + 1) + '</span>' + avatar(c.name, 34) +
        '<span style="flex:1;min-width:0"><span style="display:block;font-weight:600">' + esc(c.name) + '</span><span class="mut" style="display:block;font-size:11.5px">' + esc(short(c.brand)) + ' · ' + fmt(c.calls) + ' calls</span><span class="track" style="display:block;margin-top:6px;width:110px"><span style="display:block;height:100%;border-radius:999px;background:' + G + ';width:' + c.ask + '%"></span></span></span>' +
        '<span style="text-align:right"><span class="num" style="display:block;font-size:15px;font-weight:600">' + c.ask.toFixed(0) + '%</span><span class="mut" style="display:block;font-size:11px">ask rate</span></span><span class="mut" aria-hidden="true">›</span></button>';
    });
    $('coachcard').innerHTML = h;
  }

  function stepCard(f, el, brand, agent) {
    var steps = (f.steps || []).filter(function (s) { return s.applies > 0; });
    var h = '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px"><div><h2 class="ttl">Call flow performance</h2><p class="sub">How often each step is done when it applies · click a step to hear the calls that missed it</p></div></div><div style="display:flex;flex-direction:column;gap:4px;margin-top:12px">';
    steps.forEach(function (s) {
      var c = s.rate >= 70 ? G : (s.rate >= 45 ? '#E8A06A' : O);
      h += '<button class="click" data-step="' + s.key + '"' + (brand ? ' data-sbrand="' + esc(brand) + '"' : '') + (agent ? ' data-sagent="' + esc(agent) + '"' : '') + ' title="' + fmt(s.missed) + ' of ' + fmt(s.applies) + ' calls missed this step" style="all:unset;box-sizing:border-box;cursor:pointer;display:grid;grid-template-columns:minmax(120px,190px) minmax(0,1fr) 44px 64px;gap:12px;align-items:center;font-size:12.5px;padding:6px 4px;border-radius:8px"><span style="color:#3B4541">' + esc(STEPNAMES[s.key] || s.key) + '</span><span style="height:14px;border-radius:3px;background:#F1EEE8;overflow:hidden;display:block"><span style="display:block;height:100%;border-radius:3px;background:' + c + ';width:' + s.rate + '%"></span></span><span class="num" style="text-align:right;font-weight:600">' + s.rate + '%</span><span style="text-align:right">' + (s.prev_rate != null ? delta(s.rate, s.prev_rate, '') : '<span class="mut" style="font-size:11px">new step</span>') + '</span></button>';
    });
    $(el).innerHTML = h + '</div>';
  }

  function reviewCard(c) {
    var h = '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px"><div><h2 class="ttl">Calls to review</h2><p class="sub">Winnable calls that didn’t book, scored 40 or lower</p></div><button class="more" data-kpi="winnable">All ' + fmt(c.total) + ' →</button></div>';
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
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.style.cssText = 'position:fixed;z-index:80;pointer-events:none;background:#14302A;color:#fff;font-size:12px;line-height:1.5;padding:9px 12px;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.18);max-width:240px'; ROOT.appendChild(tipEl); }
    tipEl.innerHTML = c.getAttribute('data-tip'); tipEl.style.display = 'block';
    var r = c.getBoundingClientRect(); tipEl.style.left = Math.min(window.innerWidth - 250, Math.max(8, r.left + r.width / 2 - 110)) + 'px'; tipEl.style.top = Math.max(8, r.top - tipEl.offsetHeight + 40) + 'px';
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
    if (kind === 'csr') api(Object.assign({ action: 'calls' }, win({ agent: agent, limit: 6 }))).then(function (c) { if (tok !== T) return; $('fcalls').innerHTML = '<div style="display:flex;justify-content:space-between;align-items:flex-start"><div><h2 class="ttl">Recent calls</h2><p class="sub">' + fmt(c.total) + ' scored calls in this period</p></div><button class="more" data-callsfor="csr">All →</button></div>' + (c.rows || []).map(callRow).join(''); }).catch(function () {});
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
    if (w.length < 2) { $('fweek').innerHTML = '<h2 class="ttl">Week by week</h2><p class="mut">Not enough weeks yet.</p>'; return; }
    var n = w.length, avgs = w.map(function (x) { return x.avg; }), lo = Math.floor(Math.min.apply(null, avgs) - 2), hi = Math.ceil(Math.max.apply(null, avgs) + 2);
    var rates = w.map(function (x) { return x.decided ? x.booked / x.decided * 100 : null; });
    var px = function (i) { return ((i + .5) / n * 1000).toFixed(1); };
    var line = w.map(function (x, i) { return (i ? 'L' : 'M') + px(i) + ' ' + (190 - (x.avg - lo) / (hi - lo) * 170 - 10).toFixed(1); }).join(' ');
    var rl = rates.map(function (v, i) { return v == null ? '' : ((i ? 'L' : 'M') + px(i) + ' ' + (190 - v / 100 * 170 - 10).toFixed(1)); }).join(' ');
    var startIdx = w.findIndex(function (x) { return x.w >= S.start.slice(0, 10); });
    var shade = startIdx > 0 ? '<rect x="' + (startIdx / n * 1000) + '" y="0" width="' + (1000 - startIdx / n * 1000) + '" height="190" fill="#E6F0EA" opacity=".55"/>' : '';
    var dots = w.map(function (x, i) { return '<circle cx="' + px(i) + '" cy="' + (190 - (x.avg - lo) / (hi - lo) * 170 - 10).toFixed(1) + '" r="4" fill="#14302A"><title>Week of ' + fdate(x.w) + ': score ' + x.avg + ' · ' + (x.decided ? Math.round(x.booked / x.decided * 100) + '% booked' : '') + ' · ' + x.calls + ' calls</title></circle>'; }).join('');
    $('fweek').innerHTML = '<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px"><div><h2 class="ttl">Week by week</h2><p class="sub">Last 12 weeks · shaded = the period you’re viewing · hover a dot for details</p></div><div class="mut" style="font-size:12px;display:flex;gap:14px"><span style="color:#14302A">● score</span><span style="color:#E0662A">— booking %</span></div></div>' +
      '<svg viewBox="0 0 1000 210" preserveAspectRatio="none" style="width:100%;height:220px;margin-top:12px;overflow:visible" role="img" aria-label="Weekly score and booking rate">' + shade + '<path d="' + rl + '" fill="none" stroke="#E0662A" stroke-width="2" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/><path d="' + line + '" fill="none" stroke="#14302A" stroke-width="2.4" vector-effect="non-scaling-stroke"/>' + dots + '</svg>' +
      '<div style="display:flex;margin-top:4px">' + w.map(function (x, i) { return '<div style="flex:1;text-align:center;font-size:10px;color:#5F6763">' + (i % 2 === 0 ? fdate(x.w) : '') + '</div>'; }).join('') + '</div>';
  }
  function focusMovers(f) {
    var rows = (f.agents || []).filter(function (a) { return a.n >= 30; }).map(function (a) { a.d = a.pavg != null && a.pn >= 15 ? a.avg - a.pavg : null; return a; });
    rows.sort(function (a, b) { return (b.n) - (a.n); });
    var h = '<div><h2 class="ttl">CSRs behind the trend</h2><p class="sub">Score now vs before for CSRs with 30+ calls · click a CSR for their profile</p></div><div style="overflow-x:auto;margin-top:10px"><table class="tbl"><thead><tr><th>CSR</th><th>Calls</th><th>Score</th><th>Change</th><th>Booking</th><th>Ask rate</th><th></th></tr></thead><tbody>';
    rows.slice(0, 14).forEach(function (a) {
      h += '<tr class="click" data-agent="' + esc(a.name) + '" tabindex="0"><td><div style="display:flex;align-items:center;gap:10px">' + avatar(a.name, 30) + '<b style="font-weight:600">' + esc(a.name) + '</b></div></td><td class="num">' + fmt(a.n) + '</td><td class="num">' + (a.avg != null ? a.avg.toFixed(1) : '—') + '</td><td>' + (a.d == null ? '<span class="mut" style="font-size:11.5px">new</span>' : delta(a.avg, a.pavg, '')) + '</td><td class="num">' + p1(pct(a.booked, a.decided)) + '</td><td class="num">' + p1(pct(a.asked, a.opps)) + '</td><td class="mut" aria-hidden="true">›</td></tr>';
    });
    $('fmovers').innerHTML = h + '</tbody></table></div>';
  }
  function focusMix(f, brand, agent) {
    var tabs = [['reasons', 'Why calls didn’t book'], ['objections', 'Objections'], ['topics', 'What callers wanted'], ['hours', 'Time of day']];
    var cur = S.mix || 'reasons';
    var h = '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center"><h2 class="ttl">What’s different</h2><div class="seg" role="tablist">' + tabs.map(function (t) { return '<button role="tab" aria-selected="' + (cur === t[0]) + '" class="' + (cur === t[0] ? 'on' : '') + '" data-mix="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div></div><p class="sub">This period vs the one before</p><div style="margin-top:10px">';
    if (cur === 'hours') {
      var hs = f.hours || [], mx = Math.max.apply(null, hs.map(function (x) { return x.calls; }).concat([1]));
      h += '<div style="display:flex;align-items:flex-end;gap:4px;height:150px">' + hs.map(function (x) { var r = x.decided ? Math.round(x.booked / x.decided * 100) : null; return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;gap:4px" title="' + fhour(x.h) + ': ' + fmt(x.calls) + ' calls · score ' + x.avg + (r != null ? ' · ' + r + '% booked' : '') + '"><span class="num" style="font-size:10px;color:#1F5A41">' + (r != null ? r + '%' : '') + '</span><div style="width:100%;border-radius:3px;background:' + ((x.avg || 0) < 78 ? '#F1B48E' : '#9CC6B2') + ';height:' + Math.max(3, Math.round(x.calls / mx * 100)) + 'px"></div><span style="font-size:10px;color:#5F6763">' + fhour(x.h) + '</span></div>'; }).join('') + '</div><p class="mut" style="font-size:11.5px">Orange bars = hours where the average score is under 78. Numbers on top = booking rate.</p>';
    } else {
      var rows = f[cur] || [], mx2 = Math.max.apply(null, rows.map(function (x) { return Math.max(x.n, x.pn); }).concat([1]));
      rows.forEach(function (r) {
        var dd = r.pn ? Math.round((r.n - r.pn) / r.pn * 100) : null;
        h += '<div style="padding:7px 0;font-size:12.5px"><div style="display:flex;justify-content:space-between;gap:8px"><span>' + esc(r.k) + '</span><span class="num mut">' + fmt(r.n) + ' <span style="font-size:11px">(' + (dd == null ? 'new' : (dd >= 0 ? '+' : '') + dd + '%') + ')</span></span></div>' +
          '<div style="display:flex;flex-direction:column;gap:2px;margin-top:4px"><div class="track"><div style="background:' + (cur === 'reasons' ? O : G) + ';width:' + (r.n / mx2 * 100) + '%"></div></div><div class="track" style="height:4px"><div style="background:#C9C3B8;width:' + (r.pn / mx2 * 100) + '%"></div></div></div></div>';
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
    var list = function (rows, attr) { return (rows || []).map(function (r) { return '<button class="click" data-agent="' + esc(r.k) + '" style="all:unset;box-sizing:border-box;cursor:pointer;width:100%;display:flex;justify-content:space-between;gap:10px;padding:8px 2px;border-top:1px solid var(--line2);font-size:12.5px"><span style="display:flex;gap:8px;align-items:center">' + avatar(r.k, 24) + esc(r.k) + '</span><span class="num mut">' + fmt(r.n) + (r.booked != null ? ' · ' + fmt(r.booked) + ' booked' : '') + '</span></button>'; }).join('') || '<p class="mut" style="font-size:12.5px">None matched in this period.</p>'; };
    var outPct = cur.calls ? Math.round(x.out / cur.calls * 100) : 0;
    var h = '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px"><div><h2 class="ttl">Transfers</h2><p class="sub">Outbound = calls ' + who + ' transferred to someone else · Inbound = calls ' + who + ' received from a colleague</p></div><div class="row" style="gap:8px"><button class="sel" data-xferlist="out">Outbound calls →</button><button class="sel" data-xferlist="in">Inbound calls →</button></div></div>' +
      '<div class="row" style="margin-top:12px;align-items:flex-start">' +
      '<div style="flex:1 1 300px;min-width:0"><div style="display:flex;align-items:baseline;gap:10px"><span class="num" style="font-size:28px;font-weight:600">↗ ' + fmt(x.out) + '</span><span class="mut" style="font-size:12.5px">' + outPct + '% of calls · was ' + fmt(x.out_prev) + '</span></div>' +
      '<div class="mut" style="font-size:12px;margin:6px 0 4px">' + fmt(x.out_linked) + ' matched to the receiving call · <b style="color:#1F5A41">' + fmt(x.out_booked) + ' booked after the transfer</b></div><div class="cap" style="margin-top:10px">Who received them</div>' + list(x.to) + '</div>' +
      '<div style="flex:1 1 300px;min-width:0"><div style="display:flex;align-items:baseline;gap:10px"><span class="num" style="font-size:28px;font-weight:600">↘ ' + fmt(x.in) + '</span><span class="mut" style="font-size:12.5px">received</span></div>' +
      '<div class="mut" style="font-size:12px;margin:6px 0 4px">' + (x.in_decided ? '<b style="color:#1F5A41">' + Math.round(x.in_booked / x.in_decided * 100) + '% booked</b> when a decision was made (' + fmt(x.in_booked) + ' of ' + fmt(x.in_decided) + ')' : 'No booking decisions yet') + '</div><div class="cap" style="margin-top:10px">Who sent them</div>' + list(x.from) + '</div></div>';
    $('fxfer').innerHTML = h;
  }

  // ---------- CSRs ----------
  function vCsrs(tok) {
    setMain(crumb([['CSRs']]) + '<div class="oq-card" id="csrall">' + skel(30, 12) + '</div>');
    Promise.all([loadReport(), loadPrevReport()]).then(function (r) {
      if (tok !== T) return; noteKnown(r[0]);
      var rows = agentRows(r[0], r[1], S.csrMin || 25), key = S.csrSort;
      var f = { calls: function (a) { return -a.calls; }, avg: function (a) { return -(a.avg || 0); }, change: function (a) { return a.pavg == null ? -99 : -(a.avg - a.pavg); }, rate: function (a) { return -(a.rate || 0); }, ask: function (a) { return (a.ask == null ? 999 : a.ask); }, xo: function (a) { return -a.xo; }, xi: function (a) { return -a.xi; }, name: function (a) { return 0; } }[key];
      var dir = S.csrDir || 1; rows.sort(key === 'name' ? function (a, b) { return dir * a.name.localeCompare(b.name); } : function (a, b) { return dir * (f(a) - f(b)); });
      var q = (S.csrQ || '').toLowerCase(); if (q) rows = rows.filter(function (a) { return a.name.toLowerCase().indexOf(q) >= 0 || (a.brand || '').toLowerCase().indexOf(q) >= 0; });
      var th = function (k, l, t) { var on = key === k, asc = (k === 'name' || k === 'ask') === (dir === 1); return '<th class="sortable" data-csort="' + k + '" title="' + esc(t) + ' · click again to reverse" aria-sort="' + (on ? (asc ? 'ascending' : 'descending') : 'none') + '">' + l + (on ? (asc ? ' ↑' : ' ↓') : '') + '</th>'; };
      var h = '<div style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:10px"><div><h2 class="ttl">CSR scorecards</h2><p class="sub">' + rows.length + ' CSRs with ' + (S.csrMin || 25) + '+ calls · click a header to sort, a row to open the CSR</p></div><div class="row" style="gap:8px"><label class="sr" for="csrq">Find a CSR</label><input id="csrq" class="oq-field" style="width:220px" placeholder="Find a CSR or brand…" value="' + esc(S.csrQ || '') + '"><select id="csrmin" class="oq-field" style="width:auto" aria-label="Minimum calls"><option value="10"' + (S.csrMin == 10 ? ' selected' : '') + '>10+ calls</option><option value="25"' + (!S.csrMin || S.csrMin == 25 ? ' selected' : '') + '>25+ calls</option><option value="100"' + (S.csrMin == 100 ? ' selected' : '') + '>100+ calls</option></select></div></div>' +
        '<div style="overflow-x:auto;margin-top:12px"><table class="tbl" style="font-size:13.5px"><thead><tr>' + th('name', 'CSR', 'Sort by name') + '<th>Brand</th>' + th('calls', 'Calls', 'Conversations scored') + th('avg', 'Avg score', 'Average QA score') + th('change', 'Change', 'vs previous period') + th('rate', 'Booking', 'Booked ÷ decided calls') + th('ask', 'Ask rate', 'Lowest first') + th('xo', 'Transfers out', 'Calls this CSR transferred to someone else') + th('xi', 'Transfers in', 'Calls this CSR received from a colleague') + '<th>Cards</th><th></th></tr></thead><tbody>';
      rows.slice(0, 150).forEach(function (a) {
        h += '<tr class="click" data-agent="' + esc(a.name) + '" tabindex="0"><td><div style="display:flex;align-items:center;gap:12px">' + avatar(a.name, 32) + '<b style="font-weight:600">' + esc(a.name) + '</b></div></td><td class="mut">' + esc(short(a.brand)) + '</td><td class="num">' + fmt(a.calls) + '</td><td class="num">' + (a.avg != null ? a.avg.toFixed(1) : '—') + '</td><td>' + delta(a.avg, a.pavg, '') + '</td>' +
          '<td><div style="display:flex;align-items:center;gap:8px;min-width:120px"><span class="num" style="width:40px">' + (a.rate != null ? a.rate.toFixed(0) + '%' : '—') + '</span><div class="track" style="flex:1"><div style="background:' + ((a.rate || 0) >= 60 ? G : O) + ';width:' + (a.rate || 0) + '%"></div></div></div></td><td class="num">' + (a.ask != null ? a.ask.toFixed(0) + '%' : '—') + '</td><td class="num">' + fmt(a.xo) + ' <span class="mut" style="font-size:11px">' + (a.calls ? Math.round(a.xo / a.calls * 100) + '%' : '') + '</span></td><td class="num">' + fmt(a.xi) + '</td><td class="num mut">' + fmt(a.cc) + '</td><td class="mut" aria-hidden="true">›</td></tr>';
      });
      $('csrall').innerHTML = h + '</tbody></table></div>';
      var qi = $('csrq'); if (qi && S.csrFocus) { qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length); }
    }).catch(function (e) { if (tok === T) $('csrall').innerHTML = errBox(e); });
  }

  // ---------- Calls ----------
  var OUTCOMES = [['', 'Any outcome'], ['Booked', 'Booked'], ['Not Booked', 'Not booked'], ['Transferred', 'Transferred'], ['No Opportunity', 'No opportunity']];
  function vCalls(tok) {
    var c = S.calls, chips = [];
    if (S.callsAgent) chips.push(['CSR: ' + S.callsAgent, 'agent']);
    if (c.outcome) chips.push(['Outcome: ' + c.outcome, 'outcome']);
    if (c.step) chips.push(['Missed: ' + (STEPNAMES[c.step] || c.step), 'step']);
    if (c.winnable) chips.push(['Winnable, didn’t book', 'winnable']);
    if (c.scoreMax != null) chips.push(['Score ≤ ' + c.scoreMax, 'scoreMax']);
    if (c.scoreMin != null) chips.push(['Score ≥ ' + c.scoreMin, 'scoreMin']);
    if (c.q) chips.push(['“' + c.q + '”', 'q']);
    if (c.nocard) chips.push(['Booked, no card', 'nocard']);
    if (c.xfer) chips.push([c.xfer === 'out' ? 'Transferred out' : 'Transferred in', 'xfer']);
    setMain(crumb([['Call reviews']]) + '<div class="oq-card"><div style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:10px"><div><h2 class="ttl">Call reviews</h2><p class="sub" id="ctot">Loading…</p></div>' +
      '<form id="callq" class="row" style="gap:8px"><label class="sr" for="cq">Search calls</label><input id="cq" class="oq-field" style="width:230px" placeholder="Search summaries, CSRs, brands, phone…" value="' + esc(c.q || '') + '"><select id="co" class="oq-field" style="width:auto" aria-label="Outcome">' + OUTCOMES.map(function (o) { return '<option value="' + o[0] + '"' + ((c.outcome || '') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
      '<select id="cs2" class="oq-field" style="width:auto" aria-label="Missed step"><option value="">Any step</option>' + Object.keys(STEPNAMES).slice(0, 5).map(function (k) { return '<option value="' + k + '"' + (c.step === k ? ' selected' : '') + '>Missed: ' + STEPNAMES[k] + '</option>'; }).join('') + '</select>' +
      '<select id="cxf" class="oq-field" style="width:auto" aria-label="Transfers"><option value="">Any transfer</option><option value="out"' + (c.xfer === 'out' ? ' selected' : '') + '>Transferred out</option><option value="in"' + (c.xfer === 'in' ? ' selected' : '') + '>Transferred in</option></select>' +
      '<select id="csc" class="oq-field" style="width:auto" aria-label="Score"><option value="">Any score</option><option value="max40"' + (c.scoreMax === 40 ? ' selected' : '') + '>40 or lower</option><option value="max70"' + (c.scoreMax === 70 ? ' selected' : '') + '>70 or lower</option><option value="min90"' + (c.scoreMin === 90 ? ' selected' : '') + '>90 or higher</option></select><button class="sel btnd" type="submit">Search</button></form></div>' +
      (chips.length ? '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:12px">' + chips.map(function (ch) { return '<button class="chip on" data-unfilter="' + ch[1] + '" aria-label="Remove filter ' + esc(ch[0]) + '">' + esc(ch[0]) + ' ✕</button>'; }).join('') + '<button class="more" data-unfilter="all">Clear all</button></div>' : '') +
      '<div id="clist" style="margin-top:8px">' + skel(54, 6) + '</div><div id="cpager" class="row" style="justify-content:space-between;align-items:center;margin-top:10px"></div></div>');
    var body = Object.assign({ action: 'calls' }, win({ agent: S.callsAgent || null, outcome: c.nocard ? 'Booked' : c.outcome, step_missed: c.nocard ? 'capture_payment' : c.step, score_max: c.scoreMax, score_min: c.scoreMin, winnable: c.winnable || null, xfer: c.xfer || null, q: c.q || null, limit: 25, offset: c.offset }));
    api(body).then(function (r) {
      if (tok !== T) return;
      $('ctot').textContent = fmt(r.total) + ' calls match · newest first · click one for the full review';
      $('clist').innerHTML = (r.rows || []).map(callRow).join('') || '<p class="mut">No calls match these filters.</p>';
      var pages = Math.ceil(r.total / 25), pg = Math.floor(c.offset / 25) + 1;
      $('cpager').innerHTML = r.total > 25 ? '<span class="mut num" style="font-size:12.5px">Page ' + pg + ' of ' + fmt(pages) + '</span><div class="row" style="gap:6px"><button class="sel" data-page="-1"' + (pg <= 1 ? ' disabled' : '') + '>← Newer</button><button class="sel" data-page="1"' + (pg >= pages ? ' disabled' : '') + '>Older →</button></div>' : '';
    }).catch(function (e) { if (tok === T) $('clist').innerHTML = errBox(e); });
  }

  // ---------- Insights ----------
  function vInsights(tok) {
    setMain(crumb([['Insights']]) + '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(360px,1fr))" id="ins">' + ('<div class="oq-card">' + skel(20, 8) + '</div>').repeat(4) + '</div>');
    Promise.all([loadReport(), loadFocus(null, null)]).then(function (r) {
      if (tok !== T) return; var rep = r[0], f = r[1]; noteKnown(rep);
      var groups = [
        ['Why calls didn’t book', 'Reason on every Not Booked call · click to see those calls', rep.reasons, O, 'reason'],
        ['What customers pushed back on', 'Objections heard on calls · click to search', rep.objections, '#2F5E4E', 'q'],
        ['Top coaching priorities', 'Most-missed habits across all calls', rep.priorities, '#14302A', null],
        ['What CSRs do well', 'Most-earned habits', rep.strengths, G, null],
        ['What callers wanted', 'Top call topics · click to search', rep.topics, '#3A4380', 'q'],
        ['How every call ended', 'All calls, including voicemail and internal', rep.outcomes, '#8C8478', 'outcome']
      ];
      var h = groups.map(function (g) {
        var rows = g[2] || [], max = rows.length ? rows[0].n : 1;
        return '<div class="oq-card"><h2 class="ttl">' + g[0] + '</h2><p class="sub">' + g[1] + '</p><div style="margin-top:10px">' + rows.slice(0, 9).map(function (r) {
          var attr = g[4] === 'reason' ? ' data-q="' + esc(r.k) + '" data-outcome="Not Booked"' : (g[4] === 'q' ? ' data-q="' + esc(r.k.split(' / ')[0].split(' - ')[0]) + '"' : (g[4] === 'outcome' && ['Booked', 'Not Booked', 'Transferred', 'No Opportunity'].indexOf(r.k) >= 0 ? ' data-outcome="' + esc(r.k) + '"' : ''));
          return '<' + (attr ? 'button class="click" style="all:unset;box-sizing:border-box;cursor:pointer;width:100%;display:grid"' : 'div style="display:grid"') + attr + ' style="grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) 60px;gap:12px;align-items:center;font-size:12.5px;padding:6px 2px"><span>' + esc(r.k) + '</span><span class="track" style="height:8px;display:block"><span style="display:block;height:100%;border-radius:999px;background:' + g[3] + ';width:' + (r.n / max * 100).toFixed(1) + '%"></span></span><span class="num mut" style="text-align:right">' + fmt(r.n) + '</span></' + (attr ? 'button' : 'div') + '>';
        }).join('') + '</div></div>';
      }).join('');
      h += '<div class="oq-card" id="repcard">' + skel(30, 6) + '</div><div class="oq-card" id="aicard">' + skel(30, 6) + '</div>';
      $('ins').innerHTML = h; repeatCard(); aiCard();
    }).catch(function (e) { if (tok === T) $('ins').innerHTML = errBox(e); });
  }

  // ---------- Setup pages (real — saved through opsis-qa-portal) ----------
  function noRights(what) { return '<div class="oq-card"><h2 class="ttl">' + esc(what) + '</h2><p class="sub">Only ' + esc(CLIENT) + ' account admins can change this. Ask your admin, or the Opsis CX Support team.</p></div>'; }
  function ago(ts) { if (!ts) return '—'; var d = String(ts).slice(0, 10); return fdate(d) + (d.slice(0, 4) !== todayET().slice(0, 4) ? ', ' + d.slice(0, 4) : ''); }

  // Knowledge base
  var KBS = { list: null, edit: null, del: null, busy: false };
  function vKb(tok) {
    setMain(crumb([['Knowledge base']]) + '<div id="kbwrap"><div class="oq-card">' + skel(40, 5) + '</div></div>');
    api({ action: 'kb' }).then(function (r) { if (tok !== T) return; KBS.list = r.articles || []; drawKb(); })
      .catch(function (e) { if (tok === T && $('kbwrap')) $('kbwrap').innerHTML = errBox(e); });
  }
  function drawKb() {
    var w = $('kbwrap'); if (!w || !KBS.list) return;
    var L = KBS.list, ed = KBS.edit != null ? L[KBS.edit] : null, cats = ['Pricing', 'Policy', 'Coverage', 'Troubleshooting', 'Scheduling', 'Other'];
    var list = '<div class="oq-card" style="flex:999 1 520px"><h2 class="ttl">What the AI should know about your business</h2><p class="sub">The AI reads these when it scores new calls (for example, to check a CSR quoted the right fee). ' + (IS_ADMIN ? 'Every change is logged and the Opsis CX Support team is notified.' : 'Only account admins can edit them.') + '</p>' +
      (L.length ? L.map(function (a, i) { var on = KBS.edit === i;
        return '<div style="padding:14px 12px;border-top:1px solid var(--line2);margin:8px -12px 0;border-radius:10px;' + (on ? 'background:#EEF4EF' : '') + '"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center"><b>' + esc(a.title) + '</b><div style="display:flex;gap:6px;align-items:center">' + (a.category ? '<span class="pill" style="background:#F3F1EC;color:#3B4541">' + esc(a.category) + '</span>' : '') +
          (!IS_ADMIN ? '' : KBS.del === i ? '<span class="mut" style="font-size:12px">Remove this article?</span><button class="sel" data-act="kbdelyes" data-i="' + i + '" style="padding:5px 10px;font-size:12px;color:#B4461F"' + (KBS.busy ? ' disabled' : '') + '>Remove</button><button class="sel" data-act="kbdelno" style="padding:5px 10px;font-size:12px">Keep</button>'
            : '<button class="sel" data-act="kbedit" data-i="' + i + '" style="padding:5px 10px;font-size:12px" aria-label="Edit ' + esc(a.title) + '">' + (on ? 'Editing…' : 'Edit') + '</button><button class="sel" data-act="kbdel" data-i="' + i + '" style="padding:5px 10px;font-size:12px" aria-label="Remove ' + esc(a.title) + '">Remove</button>') +
          '</div></div><div style="font-size:13px;line-height:1.55;margin-top:6px;color:#3B4541;white-space:pre-wrap">' + esc(a.body) + '</div><div class="mut" style="font-size:11.5px;margin-top:6px">Updated ' + ago(a.updated_at) + (a.updated_by_name ? ' by ' + esc(a.updated_by_name) : '') + '</div></div>'; }).join('')
        : '<div class="mut" style="padding:20px 0">No articles yet.' + (IS_ADMIN ? ' Add the first one on the right.' : '') + '</div>') + '</div>';
    var form = IS_ADMIN ? '<div class="oq-card" style="flex:1 1 320px;align-self:flex-start"><h2 class="ttl">' + (ed ? 'Edit article' : 'Add knowledge') + '</h2><p class="sub">Used when scoring new calls once saved.</p><div style="display:flex;flex-direction:column;gap:12px;margin-top:14px"><div><label class="l" for="kbt">Title</label><input id="kbt" class="oq-field" placeholder="e.g. Holiday hours" maxlength="200" value="' + (ed ? esc(ed.title) : '') + '"></div><div><label class="l" for="kbc">Category</label><select id="kbc" class="oq-field">' + cats.map(function (c) { return '<option' + (ed && ed.category === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select></div><div><label class="l" for="kbb">What should the AI know?</label><textarea id="kbb" class="oq-field" style="min-height:160px;resize:vertical" maxlength="8000" placeholder="Write it the way you’d explain it to a new CSR…">' + (ed ? esc(ed.body) : '') + '</textarea></div>' +
      (ed ? '<div style="display:flex;gap:8px"><button class="sel btnd" data-act="kbsave" style="flex:1"' + (KBS.busy ? ' disabled' : '') + '>' + (KBS.busy ? 'Saving…' : 'Save changes') + '</button><button class="sel" data-act="kbcancel">Cancel</button></div>' : '<button class="sel btnd" data-act="kbadd"' + (KBS.busy ? ' disabled' : '') + '>' + (KBS.busy ? 'Saving…' : 'Add to knowledge base') + '</button>') + '</div></div>' : '';
    w.innerHTML = '<div class="row" style="align-items:flex-start">' + list + form + '</div>';
    if (ed) { var t = $('kbt'); if (t) t.focus(); }
  }
  function busyBtn(btn, on) { if (!btn) return; if (on) { btn.dataset.t = btn.textContent; btn.disabled = true; btn.textContent = 'Saving…'; } else { btn.disabled = false; if (btn.dataset.t) btn.textContent = btn.dataset.t; } }
  function kbWrite(body, done, btn) {
    if (KBS.busy) return; KBS.busy = true; busyBtn(btn, true);
    api(Object.assign({ action: 'kb' }, body)).then(function (r) { KBS.busy = false; KBS.list = r.articles || []; KBS.edit = null; KBS.del = null; drawKb(); toast(done); })
      .catch(function (e) { KBS.busy = false; busyBtn(btn, false); toast(e.message || 'Couldn’t save. Try again.'); });
  }

  // QA settings
  var QS = null, QSE = { ins: false, metric: false, req: false, del: null, busy: false };
  function vQaSettings(tok) {
    setMain(crumb([['QA settings']]) + '<div id="qswrap"><div class="oq-card">' + skel(36, 7) + '</div></div>');
    api({ action: 'settings' }).then(function (r) { if (tok !== T) return; QS = r; drawQs(); })
      .catch(function (e) { if (tok === T && $('qswrap')) $('qswrap').innerHTML = errBox(e); });
  }
  function drawQs() {
    var w = $('qswrap'); if (!w || !QS) return;
    var rub = QS.rubric || [], mine = rub.filter(function (r) { return r.section === 'custom'; }), core = rub.filter(function (r) { return r.section !== 'custom'; });
    var section = function (title, desc, body, btn) { return '<div style="padding:16px 0;border-top:1px solid var(--line2)"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap"><div style="flex:1 1 260px"><div style="font-weight:600">' + title + '</div><div class="mut" style="font-size:12.5px;margin-top:3px;line-height:1.45">' + desc + '</div></div>' + (btn || '') + '</div>' + body + '</div>'; };
    var dis = QSE.busy ? ' disabled' : '';
    var h = '<div class="row" style="align-items:flex-start"><div class="oq-card" style="flex:999 1 560px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><div><h2 class="ttl">QA settings</h2><p class="sub">How ' + esc(CLIENT) + '’s calls are scored. Changes apply to new calls.</p></div><span class="pill" style="' + (QS.live ? 'background:#E6F0EA;color:#1F5A41' : 'background:#F3F1EC;color:#56605B') + '">' + (QS.live ? '● Scoring live' : '○ Scoring paused') + '</span></div>' +
      section('Which calls are scored', (QS.sample >= 100 ? 'Every call' : QS.sample + '% of calls') + (QS.min_seconds ? ' longer than ' + QS.min_seconds + ' seconds' : '') + ' with a recording. Voicemail, internal and IVR-only calls are recognised automatically and kept out of the scores.', '<div class="mut" style="font-size:12px;margin-top:8px">To pause scoring or change which calls are included, ask the Opsis CX Support team.</div>') +
      section('Your scoring instructions', 'Extra guidance the AI follows when it scores and classifies your calls — for example how to treat warranty calls or what counts as a lead. The Opsis CX Support team’s own rules still apply.',
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
      section('Rubric', 'The steps every call is scored on. The Opsis CX Support team keeps these consistent across brands — request a change any time.',
        '<div style="display:flex;flex-direction:column;margin-top:10px">' + core.map(function (r) { return '<div style="display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-top:1px solid var(--line2);font-size:13px"><span>' + esc(r.label) + '</span><span class="mut num" style="white-space:nowrap">' + r.points + ' pts</span></div>'; }).join('') + '</div>' +
        (QSE.req ? '<div style="margin-top:12px"><label class="l" for="qreq">What would you like changed?</label><textarea id="qreq" class="oq-field" style="min-height:90px" maxlength="3000" placeholder="e.g. Don’t score card capture on warranty calls."></textarea><div style="display:flex;gap:8px;margin-top:8px"><button class="sel btnd" data-act="qsreqsend"' + dis + '>' + (QSE.busy ? 'Sending…' : 'Send request') + '</button><button class="sel" data-act="qsreqcancel">Cancel</button></div></div>' : ''),
        CAN_EDIT && !QSE.req ? '<button class="sel" data-act="qsreq">Request a change</button>' : '') +
      '</div><div class="oq-card" style="flex:1 1 300px;align-self:flex-start"><h2 class="ttl">How this works</h2><p class="sub" style="line-height:1.6">Changes apply to calls scored after you save — past scores don’t change. Every change is logged with who made it, and the Opsis CX Support team is notified so scoring stays consistent across your brands.</p>' + (IS_ADMIN ? '' : '<p class="sub" style="line-height:1.6;margin-top:10px">Only account admins can change instructions and metrics.</p>') + '</div></div>';
    w.innerHTML = h;
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
  var RNAME = { admin: 'Account admin', manager: 'Brand manager', viewer: 'Viewer' };
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
    var form = I ? '<div style="margin-top:14px;padding:18px;border:1px solid var(--line);border-radius:14px;background:#FAF8F4"><div style="font-weight:600;font-size:15px">Invite someone</div><div class="mut" style="font-size:12.5px;margin-top:3px">They’ll get an email with a link to set a password. They only ever see ' + esc(CLIENT) + ' call quality.</div>' +
      '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-top:14px"><div><label class="l" for="ivn">Full name</label><input id="ivn" class="oq-field" placeholder="e.g. Jordan Smith" value="' + esc(I.name) + '"></div><div><label class="l" for="ive">Email</label><input id="ive" class="oq-field" type="email" placeholder="name@company.com" value="' + esc(I.email) + '"></div><div><label class="l" for="ivr">Role</label><select id="ivr" class="oq-field" data-invrole="1">' + ROLES.map(function (r) { return '<option value="' + r[0] + '"' + (I.role === r[0] ? ' selected' : '') + '>' + r[1] + '</option>'; }).join('') + '</select></div>' +
      (I.role !== 'admin' ? '<div><label class="l" for="ivb">Brand</label>' + brandSel('ivb', I.brand, false).replace('style="padding:6px 10px;font-size:13px;width:auto"', '') + '</div>' : '') + '</div>' +
      '<div style="display:flex;gap:8px;margin-top:16px"><button class="sel btnd" data-act="invsend"' + dis + '>' + (TM.busy ? 'Sending…' : 'Send invite') + '</button><button class="sel" data-act="invcancel">Cancel</button></div></div>' : '';
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
    w.innerHTML = '<div style="display:flex;flex-direction:column;gap:16px"><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(230px,1fr))">' + ROLES.map(function (r) { return '<div class="oq-card"><b style="font-size:15px">' + r[1] + '</b><div class="mut" style="font-size:12.5px;margin-top:4px;line-height:1.45">' + r[2] + '</div><div style="display:flex;flex-direction:column;gap:6px;margin-top:12px">' + r[3].map(function (p) { return '<div style="font-size:12.5px;display:flex;gap:8px"><span style="color:' + G + '">✓</span>' + p + '</div>'; }).join('') + '</div></div>'; }).join('') + '</div>' +
      '<div class="oq-card"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px"><div><h2 class="ttl">People</h2><p class="sub">' + TM.list.filter(function (u) { return u.active; }).length + ' with access · logins only ever see ' + esc(CLIENT) + '’s own call quality — never anything else in Opsis.</p></div>' + (I ? '' : '<button class="sel btnd" data-act="invite">+ Invite</button>') + '</div>' + form +
      '<div style="overflow-x:auto;margin-top:12px"><table class="tbl" style="font-size:13.5px"><thead><tr><th>Person</th><th>Role</th><th>Brand</th><th>Status</th><th>Last active</th><th></th></tr></thead><tbody>' + (rows || '<tr><td colspan="6" class="mut">No one yet.</td></tr>') + '</tbody></table></div></div></div>';
    if (I) { var n = $('ivn'); if (n && !I.name) n.focus(); }
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
        card('Abandoned', rate != null ? rate.toFixed(1) + '%' : '—', fmt(k.abandoned || 0) + ' callers hung up before a CSR answered' + (k.wd_days ? ' · ' + (k.wd_ab / k.wd_days).toFixed(1) + ' per weekday' : ''), delta(rate, prate, ' pts', false)) +
        card('Avg time to answer', k.tta != null ? k.tta + 's' : '—', 'From the call reaching the CSR queue to pickup', delta(k.tta, pv.tta, 's', false)) +
        card('Hung up before reaching a CSR', fmt(k.ivr || 0), 'In the phone menu or before a CSR group rang. Not counted in the abandon rate.', '') +
        card('Time to abandon', k.tab != null ? k.tab + 's' : 'Not measured', k.tab_n ? 'Measured on ' + k.tab_n + ' rollover calls only. LightSpeed doesn’t send hang-up times, so other abandons can’t be timed.' : 'LightSpeed doesn’t send hang-up times for abandoned calls.', '') +
        '</div>';
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
    var head = '<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;align-items:flex-start"><div><h2 class="ttl">Calls and abandons</h2><p class="sub">Average inbound CSR calls per ' + (mode === 'dow' ? 'day' : 'hour on a business day') + '. The orange part is calls abandoned before a CSR answered. Hover a bar for details.</p></div>' + tabs + '</div>';
    if (!rows.filter(function (r) { return !r.empty; }).length) { el.innerHTML = head + '<p class="mut" style="margin-top:14px">No phone data in this range.</p>'; return; }
    var maxP = Math.max.apply(null, rows.map(function (r) { return r.per; })), step = maxP > 2000 ? 500 : maxP > 800 ? 200 : maxP > 400 ? 100 : maxP > 100 ? 50 : maxP > 40 ? 10 : 5, top = Math.ceil(maxP / step) * step || 1, H = 190;
    var grid = [0, .25, .5, .75, 1].map(function (f) { return '<div style="position:absolute;left:0;right:0;bottom:' + (f * H) + 'px;border-top:1px ' + (f ? 'dashed #ECE8E0' : 'solid #D9D4CA') + '"></div><div style="position:absolute;left:-46px;width:40px;text-align:right;bottom:' + (f * H - 7) + 'px;font-size:11px;color:#6B726E">' + fmt(Math.round(top * f)) + '</div>'; }).join('');
    var big = function (r) { return !r.empty && r.tot >= 30 && r.per >= maxP * 0.2; }, worst = rows.filter(big).reduce(function (m, r) { return !m || r.tab / r.tot > m.tab / m.tot ? r : m; }, null);
    var bars = rows.map(function (r) {
      if (r.empty) return '<div title="No phone data for ' + r.full + ' in this range yet" style="flex:1;height:100%;display:flex;align-items:flex-end;justify-content:center"><div style="width:70%;max-width:44px;height:2px;background:#E6E1D8"></div></div>';
      var rt = r.tot ? r.tab / r.tot * 100 : 0;
      var tip = '<b>' + esc(r.full) + '</b><br>' + fmt(Math.round(r.per)) + ' calls on average<br>' + r.ab.toFixed(1) + ' abandoned (' + rt.toFixed(1) + '%)' + (r.tta != null ? '<br>Answered in ' + r.tta + 's on average' : '') + '<br>' + fmt(r.tot) + ' calls, ' + fmt(r.tab) + ' abandoned in total';
      return '<div data-tip="' + esc(tip) + '" tabindex="0" aria-label="' + esc(r.full + ': ' + Math.round(r.per) + ' calls, ' + rt.toFixed(1) + '% abandoned') + '" style="flex:1;height:100%;display:flex;align-items:flex-end;justify-content:center"><div style="width:70%;max-width:44px;height:' + (r.per / top * 100).toFixed(1) + '%;display:flex;flex-direction:column;border-radius:5px 5px 1px 1px;overflow:hidden"><div style="background:' + O + ';flex-shrink:0;height:' + (r.per ? r.ab / r.per * 100 : 0).toFixed(1) + '%;min-height:' + (r.ab > 0 ? 3 : 0) + 'px"></div><div style="background:#CFE5DF;flex:1"></div></div></div>';
    }).join('');
    var labs = rows.map(function (r) { return '<div style="flex:1;text-align:center;font-size:11.5px;color:#3B4541;font-weight:500">' + r.lab + '</div>'; }).join('');
    var nums = rows.map(function (r) { if (r.empty) return '<div style="flex:1;text-align:center;font-size:11px;line-height:1.35" class="mut">no data<br>yet</div>'; var rt = r.tot ? r.tab / r.tot * 100 : 0; return '<div style="flex:1;text-align:center;font-size:11px;line-height:1.35"><div style="color:#3B4541">' + fmt(Math.round(r.per)) + '</div><div style="color:' + (r === worst ? '#B4461F' : '#14302A') + ';font-weight:600">' + rt.toFixed(1) + '%</div></div>'; }).join('');
    el.innerHTML = head + (worst ? '<div style="font-size:12.5px;margin-top:12px"><span class="mut">Highest abandon rate</span> <b style="color:#B4461F">' + worst.full + '</b> · ' + (worst.tab / worst.tot * 100).toFixed(1) + '% of ' + fmt(worst.tot) + ' calls' + (function () { var sm = rows.filter(function (r) { return !r.empty && !big(r) && r.tot; }); return sm.length ? ' <span class="mut">· ' + sm.map(function (r) { return r.full; }).join(', ') + ' left out (too few calls to compare)</span>' : ''; })() + '</div>' : '') +
      '<div style="display:flex;gap:16px;font-size:11px;margin-top:12px" class="mut"><span><span style="display:inline-block;width:9px;height:9px;background:#CFE5DF;border-radius:2px"></span> Answered</span><span><span style="display:inline-block;width:9px;height:9px;background:' + O + ';border-radius:2px"></span> Abandoned</span></div>' +
      '<div style="position:relative;height:' + H + 'px;margin:8px 8px 0 50px">' + grid + '<div style="position:absolute;inset:0;display:flex">' + bars + '</div></div>' +
      '<div style="display:flex;margin:8px 8px 0 50px">' + labs + '</div>' +
      '<div style="display:flex;margin:6px 8px 0 50px;padding-top:6px;border-top:1px solid var(--line2)">' + nums + '</div><div class="mut" style="font-size:10.5px;margin:4px 0 0 50px">Avg calls · abandon %</div>';
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
    var h = '<h2 class="ttl">Abandons by brand</h2><p class="sub">Inbound calls to each brand’s CSR queues and ring groups. Brands with more than one location show the split underneath.</p><div style="overflow-x:auto;margin-top:12px"><table class="tbl" style="font-size:13.5px"><thead><tr>' +
      psortTh('b', 'name', 'Brand', 'Sort A–Z', true) + psortTh('b', 'calls', 'Calls', 'Inbound CSR calls') + psortTh('b', 'per', 'Per weekday', 'Average calls Mon–Fri') + psortTh('b', 'ab', 'Abandoned', 'Hung up before a CSR answered') + psortTh('b', 'rate', 'Abandon %', 'Abandoned ÷ calls') + (cmp ? '<th>Change</th>' : '') + psortTh('b', 'tta', 'Avg answer', 'Seconds to answer') + psortTh('b', 'ivr', 'Before a CSR', 'Hung up in the menu or before a CSR group rang') + '</tr></thead><tbody>';
    rows.forEach(function (r) {
      h += '<tr><td><div style="display:flex;align-items:center;gap:10px">' + bbadge(r.name) + '<span style="font-weight:600">' + esc(short(r.name)) + '</span></div></td><td class="num">' + fmt(r.calls) + '</td><td class="num">' + (r.per != null ? fmt(Math.round(r.per)) : '—') + '</td><td class="num">' + fmt(r.ab) + '</td><td><div style="display:flex;align-items:center;gap:8px;min-width:110px"><span class="num" style="width:44px;' + ((r.rate || 0) >= 6 ? 'color:#B4461F;font-weight:600' : '') + '">' + (r.rate != null ? r.rate.toFixed(1) + '%' : '—') + '</span><div class="track" style="flex:1"><div style="background:' + ((r.rate || 0) >= 6 ? O : G) + ';width:' + Math.min(100, (r.rate || 0) * 6) + '%"></div></div></div></td>' + (cmp ? '<td>' + (r.prate == null ? '<span class="mut">—</span>' : delta(r.rate, r.prate, ' pts', false)) + '</td>' : '') + '<td class="num">' + (r.tta != null ? r.tta + 's' : '—') + '</td><td class="num mut">' + fmt(r.ivr) + '</td></tr>';
      var L = locs[r.name] || []; if (L.length > 1) L.forEach(function (l) { var lr = phonePct(l.abandoned, l.calls); h += '<tr class="mut" style="font-size:12.5px"><td style="padding-left:46px">' + esc(l.location) + '</td><td class="num">' + fmt(l.calls) + '</td><td></td><td class="num">' + fmt(l.abandoned) + '</td><td class="num">' + (lr != null ? lr.toFixed(1) + '%' : '—') + '</td>' + (cmp ? '<td></td>' : '') + '><td class="num">' + (l.tta != null ? l.tta + 's' : '—') + '</td><td></td></tr>'; });
    });
    el.innerHTML = h + '</tbody></table></div><p class="mut" style="font-size:11.5px;margin-top:10px">Cedar Park uses the same groups as Switchboard’s CPOD report. Other brands use every CSR queue and ring group, leaving out technician, manager, accounting, sales, after-hours, test and Broccoli-forward groups.</p>';
  }
  function phoneCsrs(p) {
    var el = $('phcsr'); if (!el) return;
    var brandAns = {}; (p.brands || []).forEach(function (b) { brandAns[b.brand] = b.answered; });
    var rows = (p.agents || []).map(function (a) { var tot = a.in_calls + a.out_calls; return { name: a.agent, brand: a.brand, in: a.in_calls, share: phonePct(a.in_calls, brandAns[a.brand]), talk: a.in_calls ? a.in_talk / a.in_calls / 60 : null, inhrs: a.in_talk / 3600, tta: a.tta, out: a.out_calls, outday: a.days ? a.out_calls / a.days : null, outhrs: a.out_talk / 3600, inpct: phonePct(a.in_calls, tot), days: a.days }; });
    var q = (S.phQ || '').toLowerCase(); if (q) rows = rows.filter(function (r) { return r.name.toLowerCase().indexOf(q) >= 0 || r.brand.toLowerCase().indexOf(q) >= 0; });
    rows = psortRows('a', rows, { name: function (r) { return r.name; }, brand: function (r) { return short(r.brand); }, in: function (r) { return r.in; }, share: function (r) { return r.share; }, talk: function (r) { return r.talk; }, inhrs: function (r) { return r.inhrs; }, tta: function (r) { return r.tta; }, out: function (r) { return r.out; }, outday: function (r) { return r.outday; }, outhrs: function (r) { return r.outhrs; }, inpct: function (r) { return r.inpct; } }, ['name', 'brand']);
    var h = '<div style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:10px"><div><h2 class="ttl">CSR phone activity</h2><p class="sub">' + rows.length + ' people who answered inbound CSR calls in this range · click a header to sort</p></div><div><label class="sr" for="phq">Find a CSR</label><input id="phq" class="oq-field" style="width:220px" placeholder="Find a CSR or brand…" value="' + esc(S.phQ || '') + '"></div></div>' +
      '<div style="overflow-x:auto;margin-top:12px"><table class="tbl" style="font-size:13px"><thead><tr>' + psortTh('a', 'name', 'CSR', 'Sort A–Z', true) + psortTh('a', 'brand', 'Brand', 'Sort A–Z', true) + psortTh('a', 'in', 'Inbound answered', 'Inbound CSR calls this person answered') + psortTh('a', 'share', '% of brand', 'Share of the brand’s answered inbound calls') + psortTh('a', 'talk', 'Avg talk', 'Minutes per inbound call') + psortTh('a', 'inhrs', 'Inbound talk', 'Hours on inbound calls') + psortTh('a', 'tta', 'Avg answer', 'Seconds to pick up') + psortTh('a', 'out', 'Outbound', 'Outbound calls placed') + psortTh('a', 'outday', 'Outbound / day', 'Outbound calls per day worked') + psortTh('a', 'outhrs', 'Outbound talk', 'Hours on outbound calls') + psortTh('a', 'inpct', '% inbound', 'Inbound ÷ all calls') + '</tr></thead><tbody>';
    rows.slice(0, 200).forEach(function (r) {
      h += '<tr><td><div style="display:flex;align-items:center;gap:10px">' + avatar(r.name, 28) + '<span style="font-weight:600">' + esc(r.name) + '</span></div></td><td class="mut">' + esc(short(r.brand)) + '</td><td class="num">' + fmt(r.in) + '</td><td class="num">' + (r.share != null ? r.share.toFixed(1) + '%' : '—') + '</td><td class="num">' + (r.talk != null ? r.talk.toFixed(1) + 'm' : '—') + '</td><td class="num">' + r.inhrs.toFixed(1) + 'h</td><td class="num">' + (r.tta != null ? r.tta + 's' : '—') + '</td><td class="num">' + fmt(r.out) + '</td><td class="num">' + (r.outday != null ? r.outday.toFixed(1) : '—') + '</td><td class="num">' + r.outhrs.toFixed(1) + 'h</td><td class="num mut">' + (r.inpct != null ? r.inpct.toFixed(0) + '%' : '—') + '</td></tr>';
    });
    el.innerHTML = h + '</tbody></table></div><p class="mut" style="font-size:11.5px;margin-top:10px">Utilization needs logged-in hours, which LightSpeed doesn’t send. Names come from LightSpeed extensions, so a shared phone (like “Front Desk”) shows as one person.</p>';
    var pq = $('phq'); if (pq) { pq.addEventListener('input', function () { S.phQ = pq.value; clearTimeout(pq.t); pq.t = setTimeout(function () { loadPhone().then(phoneCsrs).then(function () { var n = $('phq'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }); }, 250); }); }
  }

  var KIND = { customer: ['Customer', 'background:#E6F0EA;color:#1F5A41'], staff: ['Likely staff / tech', 'background:#E8EAF4;color:#3A4380'], no_conversation: ['No conversation', 'background:#F3F1EC;color:#56605B'], unclear: ['Unclear', 'background:#FFF4DE;color:#8A5A00'] };
  var CLS = { conversation: 'Conversation', internal: 'Internal (staff)', voicemail: 'Voicemail', no_agent: 'No CSR on line', wrong_number: 'Wrong number', ivr_only: 'Phone menu only', spam: 'Spam', non_customer_call: 'Not a customer' };
  function kindPill(k) { var x = KIND[k] || [k, 'background:#F3F1EC']; return '<span class="pill" style="' + x[1] + ';white-space:nowrap">' + x[0] + '</span>'; }
  function loadRepeat(min, phone) { return api(Object.assign({ action: 'repeat', min: min || S.rmin || 3, phone: phone || null }, win())); }
  function repeatCard() {
    var el = $('repcard'); if (!el) return;
    loadRepeat(3).then(function (r) {
      var k = r.kinds || {}, rows = r.rows || [];
      el.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px"><div><h2 class="ttl">Repeat callers</h2><p class="sub">Numbers that called 3+ times in one day · click one to see every call</p></div><button class="more" data-go="repeat">See all →</button></div>' +
        '<div style="display:flex;align-items:baseline;gap:10px;margin:12px 0 8px"><span class="num" style="font-size:30px;font-weight:600">' + (r.customers ? (r.repeat / r.customers * 100).toFixed(1) + '%' : '—') + '</span><span class="mut">' + fmt(r.repeat) + ' of ' + fmt(r.customers) + ' numbers</span></div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">' + ['customer', 'staff', 'no_conversation', 'unclear'].filter(function (x) { return k[x]; }).map(function (x) { return '<button class="chip" data-rkind="' + x + '" style="font-size:12px">' + KIND[x][0] + ' · <b>' + fmt(k[x]) + '</b></button>'; }).join('') + '</div>' +
        rows.slice(0, 6).map(function (t) { return '<button class="click" data-rphone="' + t.digits + '" style="all:unset;box-sizing:border-box;cursor:pointer;width:100%;display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 2px;border-top:1px solid var(--line2);font-size:12.5px"><span style="display:flex;flex-direction:column;gap:2px;min-width:0"><span><b class="num">' + esc(t.phone) + '</b> <span class="mut">· ' + esc(short(t.brand)) + '</span></span><span class="mut" style="font-size:11.5px">' + t.max_day + ' calls in one day · ' + fmt(t.calls) + ' total · ' + fmt(t.internal) + ' internal</span></span>' + kindPill(t.kind) + '</button>'; }).join('');
    }).catch(function (e) { el.innerHTML = '<h2 class="ttl">Repeat callers</h2><p class="mut">' + esc(e.message) + '</p>'; });
  }
  function vRepeat(tok) {
    setMain(crumb([['Insights', 'insights'], ['Repeat callers']]) + '<div class="oq-card" id="repall">' + skel(30, 12) + '</div>');
    loadRepeat(S.rmin || 3).then(function (r) {
      if (tok !== T) return;
      var k = r.kinds || {}, kind = S.rkind || '', q = (S.rq || '').replace(/\D/g, '');
      var rows = (r.rows || []).filter(function (x) { return (!kind || x.kind === kind) && (!q || x.digits.indexOf(q) >= 0); });
      var chips = '<div style="display:flex;flex-wrap:wrap;gap:6px">' + [['', 'All', r.repeat]].concat(['customer', 'staff', 'no_conversation', 'unclear'].map(function (x) { return [x, KIND[x][0], k[x] || 0]; })).map(function (c) { var on = kind === c[0]; return '<button class="chip' + (on ? ' on' : '') + '" data-rkind="' + c[0] + '" aria-pressed="' + on + '">' + c[1] + ' · ' + fmt(c[2]) + '</button>'; }).join('') + '</div>';
      var h = '<div style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:10px"><div><h2 class="ttl">Repeat callers</h2><p class="sub">' + fmt(r.repeat) + ' of ' + fmt(r.customers) + ' numbers called ' + (S.rmin || 3) + '+ times in one day. Tags come from what the calls were about: <b>likely staff / tech</b> means most calls were internal (a technician or office line), <b>customer</b> means there was a booking opportunity.</p></div>' +
        '<div style="display:flex;gap:8px;align-items:center"><label class="sr" for="rq">Find a number</label><input id="rq" class="oq-field" style="width:170px" placeholder="Search a number…" value="' + esc(S.rq || '') + '"><label class="sr" for="rmin">Calls in one day</label><select id="rmin" class="oq-field" style="width:auto">' + [2, 3, 4, 5, 8].map(function (n) { return '<option value="' + n + '"' + ((S.rmin || 3) === n ? ' selected' : '') + '>' + n + '+ in a day</option>'; }).join('') + '</select></div></div>' +
        '<div style="margin-top:12px">' + chips + '</div>' +
        '<div style="overflow-x:auto;margin-top:12px"><table class="tbl" style="font-size:13px"><thead><tr><th>Number</th><th>Brand</th><th>Looks like</th><th class="num">Most in a day</th><th class="num">Total calls</th><th class="num">Days</th><th class="num">Conversations</th><th class="num">Internal</th><th class="num">Voicemail / other</th><th class="num">Booked</th><th class="num">Outbound</th><th>Last</th><th></th></tr></thead><tbody>' +
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
          var open = x.scored && x.class === 'conversation';
          return '<div ' + (open ? 'class="click" data-call="' + x.id + '" role="button" tabindex="0" ' : '') + 'style="padding:12px 0;border-bottom:1px solid var(--line2);' + (open ? 'cursor:pointer' : '') + '"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><span style="font-weight:600">' + esc(x.agent || 'Unknown') + (x.ai ? ' <span class="pill" style="background:#E8EAF4;color:#3A4380">AI agent</span>' : '') + ' <span class="mut" style="font-weight:400">· ' + (x.direction === 'outbound' ? 'Outbound' : 'Inbound') + '</span></span><span class="mut num" style="font-size:12px">' + fdate(x.date) + ' ' + fhour(x.hour) + ' · ' + fsecs(x.secs) + '</span></div>' +
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
      var segs = [['open', 'Open hours', 'Mon–Fri 8a–6p'], ['early', 'Before 8am', 'weekdays'], ['evening', 'After 6pm', 'weekdays'], ['weekend', 'Weekends', 'Sat–Sun']];
      var cell = function (x) { if (!x || !x.calls) return '<td class="mut">—</td>'; var rt = x.decided ? x.booked / x.decided * 100 : null; return '<td><b class="num">' + (rt != null ? rt.toFixed(0) + '%' : '—') + '</b> <span class="mut" style="font-size:11.5px">booked</span><div class="mut" style="font-size:11px">' + fmt(x.calls) + ' calls' + (x.decided < 30 ? ' · too few to judge' : '') + '</div></td>'; };
      var ag = r.agents || [];
      el.innerHTML = '<h2 class="ttl">Who handles calls, and when</h2><p class="sub">Booking rate on calls with a booking decision, by time of day (customer’s local time). AI agents only appear when their calls were recorded and scored here.</p>' +
        '<div style="overflow-x:auto;margin-top:10px"><table class="tbl" style="font-size:13px"><thead><tr><th>When</th><th>CSRs</th><th>AI agents</th></tr></thead><tbody>' + segs.map(function (s) { return '<tr><td><b>' + s[1] + '</b><div class="mut" style="font-size:11px">' + s[2] + '</div></td>' + cell(g[s[0] + '|csr']) + cell(g[s[0] + '|ai']) + '</tr>'; }).join('') + '</tbody></table></div>' +
        (ag.length ? '<div style="margin-top:12px;font-size:12.5px"><div class="cap" style="margin-bottom:6px">AI agents</div>' + ag.map(function (a) { var rt = a.decided ? Math.round(a.booked / a.decided * 100) + '% booked' : 'no booking decisions'; return '<div style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid var(--line2)"><span class="lnk" data-agent="' + esc(a.agent) + '" role="button" tabindex="0">' + esc(a.agent) + '</span><span class="mut">' + fmt(a.calls) + ' calls · ' + rt + ' · score ' + (a.avg || '—') + ' · ' + fmt(a.after_hours) + ' after hours</span></div>'; }).join('') + '</div>' : '<p class="mut" style="font-size:12.5px;margin-top:10px">No AI agent calls were scored in this range.</p>');
    }).catch(function (e) { el.innerHTML = '<h2 class="ttl">Who handles calls, and when</h2><p class="mut">' + esc(e.message) + '</p>'; });
  }

  function crumb(parts) {
    return '<div class="oq-crumb">' + parts.map(function (p, i) { return i === parts.length - 1 ? '<span style="color:var(--ink);font-weight:600">' + esc(p[0]) + '</span>' : '<button data-go="' + p[1] + '">' + esc(p[0]) + '</button><span aria-hidden="true">/</span>'; }).join('') + '</div>';
  }

  // ---------- Recording player ----------
  var AU = new Audio(); AU.preload = 'metadata';
  var P = { id: null };
  function tsList(txt) { var out = [], re = /\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]/g, m; while ((m = re.exec(txt || ''))) out.push(m[3] != null ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : (+m[1]) * 60 + (+m[2])); return out; }
  function clock(x) { x = Math.max(0, Math.floor(x || 0)); return Math.floor(x / 60) + ':' + ('0' + x % 60).slice(-2); }
  function pdur() { var d = AU.duration; return isFinite(d) && d > 0 ? d : ((S.cur && S.cur.id === P.id && +S.cur.secs) || ((P.info && P.info.end) ? P.info.end + 3 : 0)); }
  function stepRange(s) {
    var ts = tsList(s && s.evidence); if (!ts.length) return null;
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
  function stopAudio() { AU.pause(); P.step = null; P.stepEnd = null; }
  function playerInner() {
    if (P.loading) return '<div style="display:flex;align-items:center;gap:12px"><span class="dots"><span></span><span></span><span></span></span><span class="mut" style="font-size:13px">Loading recording…</span></div>';
    if (P.err === 'none') return '<div class="mut" style="font-size:13px">No recording is available for this call.</div>';
    if (P.err === 'fail') return '<div style="font-size:13px;color:#A8441A">The recording didn’t load. <button class="more" data-pretry="1">Try again</button></div>';
    if (P.err === 'codec') return '<div style="font-size:13px;color:#A8441A">This browser can’t play this recording. Try Chrome or Edge.</div>';
    var d = pdur(), cur = AU.currentTime || 0, playing = !AU.paused, pci = (P.info && P.info.pci) || [], steps = (S.cur && S.cur.steps) || [];
    var marks = d ? pci.map(function (r) { return '<span title="Card details skipped" style="position:absolute;top:0;bottom:0;left:' + (r[0] / d * 100).toFixed(2) + '%;width:' + Math.max(0.6, (r[1] - r[0]) / d * 100).toFixed(2) + '%;background:repeating-linear-gradient(45deg,#C9C3B8 0 3px,#E6E1D8 3px 6px);border-radius:2px"></span>'; }).join('') : '';
    var stepNote = P.step != null && steps[P.step] ? '<span style="color:#1F5A41;font-weight:600">Playing step: ' + esc(steps[P.step].label) + '</span> <button class="more" data-pfull="1">Play full call</button>' : '';
    return '<div style="display:flex;align-items:center;gap:12px">' +
      '<button data-pplay="1" aria-label="' + (playing ? 'Pause' : 'Play') + '" style="all:unset;cursor:pointer;width:44px;height:44px;border-radius:999px;background:var(--side);display:flex;align-items:center;justify-content:center;flex-shrink:0">' + (playing ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>' : '<svg width="14" height="14" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M7 4l13 8-13 8z"/></svg>') + '</button>' +
      '<div style="flex:1;min-width:0"><div style="position:relative;height:22px;display:flex;align-items:center"><div style="position:absolute;left:0;right:0;height:6px;border-radius:999px;background:#EEEBE4;overflow:hidden">' + marks + '<span id="pfill" style="position:absolute;left:0;top:0;bottom:0;background:#2F7D5B;width:' + (d ? Math.min(100, cur / d * 100).toFixed(2) : 0) + '%"></span></div>' +
      '<label class="sr" for="pseek">Seek</label><input id="pseek" type="range" min="0" max="' + Math.ceil(d || 1) + '" step="0.5" value="' + cur.toFixed(1) + '" style="position:absolute;left:0;right:0;width:100%;margin:0;opacity:0;cursor:pointer;height:22px"></div>' +
      '<div style="display:flex;justify-content:space-between;gap:8px;font-size:11.5px;margin-top:2px"><span class="num mut" id="ptime">' + clock(cur) + ' / ' + clock(d) + '</span><span class="mut">' + (pci.length ? 'Card details are skipped' : '') + '</span></div></div>' +
      '<button class="sel" data-pspeed="1" aria-label="Playback speed" style="min-height:34px;padding:4px 10px;font-size:12px">' + (P.rate || 1) + '×</button></div>' +
      (stepNote ? '<div style="font-size:12.5px;margin-top:6px">' + stepNote + '</div>' : '');
  }
  function paintPlayer() {
    var el = $('plr'); if (el) el.innerHTML = playerInner();
    document.querySelectorAll('[data-pstep]').forEach(function (b) { var on = P.step === +b.getAttribute('data-pstep') && !AU.paused; b.innerHTML = on ? '■ Stop' : '▶ Play this step'; b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.style.background = on ? '#E6F0EA' : ''; });
  }
  function tick() {
    var d = pdur(), cur = AU.currentTime || 0, f = $('pfill'), t = $('ptime'), sk = $('pseek');
    if (f && d) f.style.width = Math.min(100, cur / d * 100).toFixed(2) + '%';
    if (t) t.textContent = clock(cur) + ' / ' + clock(d);
    if (sk && document.activeElement !== sk) { sk.max = Math.ceil(d || 1); sk.value = cur.toFixed(1); }
  }
  AU.addEventListener('timeupdate', function () {
    var cur = AU.currentTime, pci = (P.info && P.info.pci) || [];
    for (var i = 0; i < pci.length; i++) if (cur >= pci[i][0] && cur < pci[i][1]) { AU.currentTime = pci[i][1]; toast('Card details skipped for security'); return; }
    if (P.stepEnd != null && cur >= P.stepEnd) { AU.pause(); P.step = null; P.stepEnd = null; paintPlayer(); }
    tick();
  });
  ['play', 'pause', 'ended', 'loadedmetadata', 'durationchange'].forEach(function (ev) { AU.addEventListener(ev, paintPlayer); });
  AU.addEventListener('error', function () { if (AU.getAttribute('src')) { P.err = 'codec'; paintPlayer(); } });
  function playStep(i) {
    var s = S.cur && S.cur.steps[i], r = stepRange(s); if (!r || !P.info || !P.info.url) return;
    if (P.step === i && !AU.paused) { stopAudio(); paintPlayer(); return; }
    P.step = i; P.stepEnd = r[1]; AU.currentTime = r[0]; AU.play().catch(function () {}); paintPlayer();
  }

  // ---------- Call drawer ----------
  function callDrawer() {
    var id = S.callId;
    if (P.id !== id) loadAudio(id);
    $('layer').innerHTML = '<div class="overlay" data-close="1"><div class="drawer" role="dialog" aria-modal="true" aria-label="Call review" id="cd">' + skel(80, 1) + skel(40, 6) + '</div></div>';
    api({ action: 'call', id: id }).then(function (c) {
      if (S.callId !== id || !$('cd')) return; S.cur = c; drawCall();
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
    var h = '<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start"><div><div class="cap">Call review</div><div style="font-size:22px;font-weight:600;letter-spacing:-0.025em;margin-top:4px">' + esc(c.agent || 'Unknown CSR') + ' · ' + esc(short(c.brand)) + '</div><div class="mut" style="font-size:12.5px">' + fdate(c.date) + ' · ' + esc(c.direction || '') + ' · ' + fsecs(c.secs) + (c.phone ? ' · ' + esc(c.phone) : '') + '</div></div><button class="sel" data-close="1" aria-label="Close" style="width:44px;justify-content:center">✕</button></div>' +
      '<div class="oq-card" id="plr" style="position:sticky;top:-22px;z-index:3;padding:12px 14px;box-shadow:0 4px 14px rgba(20,48,42,.08)">' + playerInner() + '</div>' +
      '<div class="oq-card" style="display:flex;gap:18px;align-items:center;flex-wrap:wrap"><div style="position:relative;width:96px;height:96px;flex-shrink:0"><svg width="96" height="96" viewBox="0 0 120 120" role="img" aria-label="Score ' + sc + '"><circle cx="60" cy="60" r="50" fill="none" stroke="#EEEBE4" stroke-width="12"/><circle cx="60" cy="60" r="50" fill="none" stroke="' + col + '" stroke-width="12" stroke-linecap="round" stroke-dasharray="' + (sc / 100 * 314).toFixed(0) + ' 314" transform="rotate(-90 60 60)"/></svg><div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center"><span class="num" style="font-size:24px;font-weight:600">' + sc + '</span><span class="mut" style="font-size:9.5px">brand avg ' + (c.brand_avg || '—') + '</span></div></div>' +
      '<div style="flex:1;min-width:220px"><div class="row" style="gap:6px"><span class="pill" style="' + chipOut(c.outcome) + '">' + esc(c.outcome || '—') + '</span>' + (c.winnable ? '<span class="pill" style="background:#FFF4E8;color:#9A4A0B">Winnable</span>' : '') + (c.reason ? '<span class="pill" style="background:#F3F1EC;color:#3B4541">' + esc(c.reason) + '</span>' : '') + (c.topics || []).slice(0, 3).map(function (t) { return '<span class="pill" style="background:#E6F0EA;color:#1F5A41">' + esc(t) + '</span>'; }).join('') + '</div>' +
      (c.caller_wanted ? '<div style="margin-top:10px"><div class="cap">Caller wanted</div><div style="margin-top:3px;line-height:1.45">' + esc(c.caller_wanted) + '</div></div>' : '') + '</div>' +
      (changed ? '<div style="flex-basis:100%;background:#FFF8E8;border:1px solid #F0DDB0;border-radius:10px;padding:10px 12px;font-size:12.5px;color:#6B4E12">Score changed from <b>' + c.ai_score + '</b> (AI) to <b>' + sc + '</b>' + (who.length ? ' by <b>' + who.map(esc).join(', ') + '</b>' : '') + '. The original AI score is kept and every change is logged.</div>' : '') + '</div>';
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
    h += '<div class="oq-card" style="padding:14px 8px"><div style="padding:0 12px"><b>Detailed scoring</b>' + (CAN_EDIT ? '<div class="mut" style="font-size:12px;margin-top:2px">Heard something different? Use <b>Change</b> on any step.</div>' : '') + '</div>';
    steps.forEach(function (s, i) {
      var a = ans(s), cc = a === 'yes' ? ['#E6F0EA', '#1F5A41', '✓'] : (a === 'no' ? ['#FDECEC', '#A61B1B', '✕'] : ['#EEEBE4', '#56605B', '–']), adj = s.adj;
      h += '<div class="step"><div style="display:flex;gap:12px;align-items:flex-start"><div style="width:28px;height:28px;border-radius:999px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-weight:700;background:' + cc[0] + ';color:' + cc[1] + '" aria-label="' + (a === 'yes' ? 'done' : a === 'no' ? 'missed' : 'not applicable') + '">' + cc[2] + '</div><div style="flex:1;min-width:0"><div style="display:flex;justify-content:space-between;gap:10px"><b style="font-weight:600;line-height:1.35">' + esc(s.label) + '</b><span class="num mut" style="font-size:12px;white-space:nowrap">' + (a === 'no' ? 0 : (s.max || s.points)) + ' / ' + (s.max || s.points) + '</span></div>' +
        (s.why ? '<div style="font-size:13px;line-height:1.5;color:#3B4541;margin-top:4px">' + esc(s.why) + '</div>' : '') +
        (adj ? '<div style="margin-top:6px;font-size:12.5px;background:#FFF8E8;border-radius:8px;padding:7px 10px;color:#6B4E12"><b>Changed by ' + esc(adj.by || 'a manager') + '</b> from ' + (ANS[s.ai_answer] || s.ai_answer) + ' to ' + (ANS[a] || a) + (adj.at ? ' · ' + ago(adj.at) : '') + ': “' + esc(adj.why || '') + '”' + (CAN_EDIT ? ' <button class="more" data-act="restore" data-k="' + esc(s.key) + '">Restore AI answer</button>' : '') + '</div>' : '') +
        (a === 'no' && s.misses && s.misses.length ? '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">' + s.misses.map(function (x) { return '<span class="pill" style="background:#FDECEC;color:#A61B1B">Missed: ' + esc(x) + '</span>'; }).join('') + '</div>' : '') +
        '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;align-items:flex-start">' + (s.evidence ? '<div style="flex:1 1 240px;background:#F5F3EE;border-radius:10px;padding:8px 12px;font-size:12.5px;font-style:italic;color:#3B4541">“' + evHtml(s.evidence) + '”</div>' : '') + '<div style="display:flex;gap:8px;flex-wrap:wrap">' + (stepRange(s) && P.info && P.info.url ? '<button class="sel" data-pstep="' + i + '" style="min-height:36px;padding:6px 12px;white-space:nowrap">' + (P.step === i && !AU.paused ? '■ Stop' : '▶ Play this step') + '</button>' : '') + (CAN_EDIT ? '<button class="sel" data-change="' + i + '" style="min-height:36px;padding:6px 12px">Change</button>' : '') + '</div></div></div></div></div>';
    });
    h += '</div><div class="oq-card" id="cnotes"><b>Notes</b><div id="cnlist" style="margin-top:8px">' + skel(18, 2) + '</div>' +
      (CAN_EDIT ? '<form id="cnform" style="display:flex;flex-direction:column;gap:8px;margin-top:10px"><label class="sr" for="cnbody">Add a note</label><textarea id="cnbody" class="oq-field" style="min-height:64px;resize:vertical" maxlength="4000" placeholder="Add a note for your team or the Opsis CX Support team…"></textarea><div><button class="sel btnd" type="submit">Add note</button></div></form>' : '') + '</div>' +
      '<div class="row"><button class="sel" data-act="pdf">Print / save PDF</button><button class="sel" data-ask="Explain what happened on call [call:' + c.id + '] and how ' + esc(c.agent || 'the CSR') + ' could have booked it.">Ask AI about this call</button></div>';
    var keep = $('cnbody') ? $('cnbody').value : '';
    $('cd').innerHTML = h;
    if (keep && $('cnbody')) $('cnbody').value = keep;
    loadNotes(c.id);
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
    var w = window.open('', '_blank'); if (!w) { toast('Allow pop-ups to print this call.'); return; }
    var css = ($('oqa-style') || {}).textContent || '';
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Call review</title><link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet"><style>' + css + ' #oqa .drawer{width:auto;height:auto;overflow:visible} #plr,#cnform,.row button,[data-change],[data-pstep],[data-close]{display:none!important}</style></head><body><div id="oqa"><div class="drawer">' + cd.innerHTML + '</div></div></body></html>');
    w.document.close(); setTimeout(function () { try { w.focus(); w.print(); } catch (x) {} }, 600);
  }
  function changeModal() {
    var s = S.cur.steps[S.change], cur = ans(s);
    S.pick = cur;
    var L = document.createElement('div');
    L.innerHTML = '<div class="overlay" id="chg" style="justify-content:center;align-items:center;z-index:70" data-closechg="1"><div class="oq-card" role="dialog" aria-modal="true" aria-label="Change step score" style="width:480px;max-width:calc(100% - 32px);padding:24px;display:flex;flex-direction:column;gap:14px"><div class="cap">Change score</div><b style="line-height:1.4">' + esc(s.label) + '</b><div class="mut" style="font-size:12.5px">AI said: <b>' + (ANS[s.ai_answer] || 'N/A') + '</b>' + (s.adj ? ' · now: <b>' + (ANS[cur] || cur) + '</b>' : '') + '</div><div class="seg">' + [['yes', 'Done'], ['no', 'Missed'], ['na', 'N/A']].map(function (o) { return '<button class="' + (cur === o[0] ? 'on' : '') + '" data-pick="' + o[0] + '">' + o[1] + '</button>'; }).join('') + '</div><div><label class="l" for="chgwhy">What did you hear? (required)</label><textarea id="chgwhy" class="oq-field" style="min-height:80px" maxlength="1000" placeholder="e.g. She asked “how can I help?” at 0:28 — the AI missed it."></textarea></div><div class="mut" style="font-size:12px">The original AI score is kept, the change is logged, and the Opsis CX Support team is notified.</div><div class="row" style="justify-content:flex-end"><button class="sel" data-closechg="1">Cancel</button><button class="sel btnd" data-act="applychange">Save change</button></div></div></div>';
    ROOT.appendChild(L.firstChild); $("chgwhy").focus();
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
  var SUGGEST = ['Who is the top performer at Cedar Park?', 'Why is Cheney’s score trending down?', 'Which CSRs never ask for the card?', 'What are customers objecting to most?', 'Compare Apple and Omaha', 'Show me a great call I can use for training'];
  function askPanel() {
    var A = S.ask, h = '<div class="overlay" data-close="1"><div class="drawer" role="dialog" aria-modal="true" aria-label="Ask your call data" style="background:#fff"><div style="display:flex;justify-content:space-between;gap:12px;align-items:center"><div style="display:flex;gap:10px;align-items:center"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2F7D5B" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/></svg><div><b style="font-size:16px">Ask your call data</b><div class="mut" style="font-size:12px">' + (S.brands.length ? S.brands.map(short).join(', ') : 'All brands') + ' · ' + fdate(S.start) + ' – ' + fdate(S.end) + '</div></div></div><button class="sel" data-close="1" aria-label="Close" style="width:44px;justify-content:center">✕</button></div><div id="convo" style="display:flex;flex-direction:column;gap:12px;flex:1">';
    if (!A.msgs.length) h += '<p class="mut" style="font-size:13px">Ask anything about your calls, brands and CSRs. Answers are built from your live call data.</p><div style="display:flex;flex-direction:column;gap:6px">' + SUGGEST.map(function (q) { return '<button class="chip" data-ask="' + esc(q) + '">' + esc(q) + '</button>'; }).join('') + '</div>';
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
  function ask(q) {
    q = (q || '').trim(); if (!q) return;
    var A = S.ask; A.open = true; S.callId = null;
    var history = A.msgs.filter(function (m) { return !m.error; }).slice(-6);
    A.msgs.push({ role: 'user', content: q }); A.busy = true; askPanel();
    api({ action: 'ask', question: q, history: history, start: S.start, end: S.end, brands: S.brands.length ? S.brands : null }).then(function (r) {
      A.msgs.push({ role: 'assistant', content: r.answer }); A.busy = false; if (A.open) askPanel();
    }).catch(function (e) { A.msgs.push({ role: 'assistant', content: e.message, error: true }); A.busy = false; if (A.open) askPanel(); });
  }

  // ---------- routing ----------
  var T = 0;
  function writeHash() {
    var o = { v: S.view, r: S.range };
    if (S.range === 'custom') { o.s = S.start; o.e = S.end; }
    if (S.brands.length) o.b = S.brands.join('|');
    if (S.view === 'brand') o.brand = S.brand; if (S.view === 'csr') o.agent = S.agent;
    var h = '#' + Object.keys(o).map(function (k) { return k + '=' + encodeURIComponent(o[k]); }).join('&');
    if (location.hash !== h) history.replaceState(null, '', h);
  }
  function readHash() {
    var q = {}; location.hash.replace(/^#/, '').split('&').forEach(function (p) { var kv = p.split('='); if (kv[0]) q[kv[0]] = decodeURIComponent(kv[1] || ''); });
    if (q.v) S.view = q.v; if (q.r) S.range = q.r; if (q.s && q.e) { S.start = q.s; S.end = q.e; }
    if (q.b) S.brands = q.b.split('|'); if (q.brand) S.brand = q.brand; if (q.agent) S.agent = q.agent;
    applyRange();
  }
  function render() {
    T++; var tok = T; if (EXT) { try { EXT(); } catch (x) {} EXT = null; } if (S.view === 'brands' && LOCK) S.view = 'overview'; renderNav(); renderWho(); writeHash();
    var v = { overview: vOverview, brands: vBrands, brand: function (t) { vFocus(t, 'brand'); }, csr: function (t) { vFocus(t, 'csr'); }, csrs: vCsrs, phone: vPhone, repeat: vRepeat, calls: vCalls, insights: vInsights, kb: vKb, team: vTeam, qasettings: vQaSettings, scorecards: vScorecards }[S.view] || vOverview;
    v(tok);
    var af = $('askform'); if (af) af.addEventListener('submit', function (e) { e.preventDefault(); var q = $('askq').value; $('askq').value = ''; ask(q); });
    var cf = $('callq'); if (cf) cf.addEventListener('submit', function (e) { e.preventDefault(); var c = S.calls; c.q = $('cq').value.trim(); c.outcome = $('co').value || null; c.step = $('cs2').value || null; var sc = $('csc').value; c.scoreMax = sc === 'max40' ? 40 : sc === 'max70' ? 70 : null; c.scoreMin = sc === 'min90' ? 90 : null; c.xfer = $('cxf').value || null; c.offset = 0; render(); });
    var cq = $('csrq'); if (cq) cq.addEventListener('input', function () { S.csrQ = cq.value; S.csrFocus = true; clearTimeout(cq.t); cq.t = setTimeout(render, 250); });
    var cm = $('csrmin'); if (cm) cm.addEventListener('change', function () { S.csrMin = +cm.value; render(); });
  }
  function go(view) { S.view = view; S.pop = null; window.scrollTo(0, 0); render(); }
  function openCalls(filters, agent) { S.calls = Object.assign({ outcome: null, step: null, scoreMax: null, scoreMin: null, winnable: null, q: '', offset: 0, nocard: false }, filters || {}); S.callsAgent = agent || null; if (S.ask.open) closeLayer(); go('calls'); }
  function closeLayer() { stopAudio(); P.id = null; S.callId = null; S.ask.open = false; $('layer').innerHTML = ''; }

  on(document, 'submit', function (e) {
    if (e.target.id === 'askform2') { e.preventDefault(); var q = $('askq2').value; ask(q); }
    else if (e.target.id === 'cnform') { e.preventDefault(); addNote(); }
  });
  on(document, 'click', function (e) {
    var t = e.target;
    var chg = document.getElementById('chg');
    if (chg) {
      var b = t.closest('[data-pick],[data-closechg],[data-act="applychange"]');
      if (t.closest('[data-pick]')) { S.pick = t.closest('[data-pick]').dataset.pick; chg.querySelectorAll('[data-pick]').forEach(function (x) { x.classList.toggle('on', x.dataset.pick === S.pick); }); return; }
      if (t.closest('[data-act="applychange"]')) {
        var s = S.cur.steps[S.change], why = $("chgwhy").value.trim(), back = S.pick === s.ai_answer;
        if (S.pick === s.answer) { chg.remove(); return; }
        if (!back && !why) { toast('Add a short reason so the change can be reviewed.'); return; }
        var sb = t.closest('[data-act="applychange"]'); sb.disabled = true; sb.textContent = 'Saving…';
        saveAdjust(s.key, S.pick, why).then(function () { var g = $('chg'); if (g) g.remove(); toast(back ? 'Restored the AI answer' : 'Score updated · original kept · Opsis CX Support team notified'); })
          .catch(function (e2) { sb.disabled = false; sb.textContent = 'Save change'; toast(e2.message || 'Couldn’t save the change.'); });
        return;
      }
      if (t === chg || t.closest('[data-closechg]')) { chg.remove(); return; }
      return;
    }
    var ap = t.closest('[data-autoplay]');
    if (ap) { var aid = ap.getAttribute('data-autoplay'); S.ask.open = false; S.autoplay = aid; if (P.id === aid && P.info && P.info.url) { S.autoplay = null; AU.play().catch(function () {}); } S.callId = aid; callDrawer(); return; }
    if (t.closest('[data-pplay]')) { if (AU.paused) { P.step = null; P.stepEnd = null; if (AU.ended) AU.currentTime = 0; AU.play().catch(function () {}); } else AU.pause(); return; }
    if (t.closest('[data-pfull]')) { P.step = null; P.stepEnd = null; AU.play().catch(function () {}); paintPlayer(); return; }
    var pst = t.closest('[data-pstep]');
    if (pst) { playStep(+pst.getAttribute('data-pstep')); return; }
    var psk = t.closest('[data-seek]');
    if (psk && P.info && P.info.url) { P.step = null; P.stepEnd = null; AU.currentTime = Math.max(0, +psk.getAttribute('data-seek') - 0.4); AU.play().catch(function () {}); return; }
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
    var el = t.closest('[data-go],[data-brand],[data-agent],[data-call],[data-close],[data-kpi],[data-step],[data-ask],[data-pop],[data-range],[data-act],[data-bsort],[data-csort],[data-mix],[data-page],[data-unfilter],[data-callsfor],[data-xferlist],[data-change],[data-q],[data-outcome],[data-brandcb],[data-allbrands]');
    if (S.pop && !t.closest('.pop') && !t.closest('[data-pop]')) { S.pop = null; render(); if (!el) return; }
    if (!el) return;
    var d = el.dataset;
    if (d.brandcb !== undefined || d.allbrands !== undefined) {
      if (d.allbrands !== undefined) S.brands = [];
      else { var i = S.brands.indexOf(d.brandcb); if (i >= 0) S.brands.splice(i, 1); else S.brands.push(d.brandcb); }
      render(); return;
    }
    if (d.close && t !== el && !t.closest('button[data-close]') && t.closest('.drawer')) { return; /* inside drawer: let forms, inputs and links behave normally */ }
    else if (d.close) { e.preventDefault(); closeLayer(); return; }
    e.preventDefault();
    if (d.go) { if (S.ask.open || S.callId) closeLayer(); go(d.go); }
    else if (d.brand !== undefined && !d.outcome) { closeLayer(); S.brand = d.brand; go('brand'); }
    else if (d.agent !== undefined) { closeLayer(); S.agent = d.agent; go('csr'); }
    else if (d.call) { S.ask.open = false; S.callId = d.call; callDrawer(); }
    else if (d.change !== undefined) { S.change = +d.change; changeModal(); }
    else if (d.kpi) {
      var map = { lowscore: { scoreMax: 40 }, notbooked: { outcome: 'Not Booked' }, noask: { step: 'ask_booking' }, nocard: { nocard: true }, winnable: { winnable: true, scoreMax: 40 } };
      openCalls(map[d.kpi]);
    }
    else if (d.step) { openCalls({ step: d.step }, d.sagent || null); if (d.sbrand) { S.brands = [d.sbrand]; render(); } }
    else if (d.xferlist) { if (S.view === 'csr') openCalls({ xfer: d.xferlist }, S.agent); else { S.brands = [S.brand]; openCalls({ xfer: d.xferlist }); } }
    else if (d.callsfor) { if (d.callsfor === 'csr') openCalls({}, S.agent); else { S.brands = [S.brand]; openCalls({}); } }
    else if (d.ask) { ask(d.ask); }
    else if (d.q !== undefined || d.outcome) { openCalls({ q: d.q || '', outcome: d.outcome || null }); }
    else if (d.pop) { S.pop = S.pop === d.pop ? null : d.pop; render(); }
    else if (d.range) { S.range = d.range; S.pop = null; cache = {}; applyRange(); render(); }
    else if (d.bsort) { S.brandDir = S.brandSort === d.bsort ? -(S.brandDir || 1) : 1; S.brandSort = d.bsort; render(); }
    else if (d.csort) { S.csrDir = S.csrSort === d.csort ? -(S.csrDir || 1) : 1; S.csrSort = d.csort; render(); }
    else if (d.mix) { S.mix = d.mix; if (lastFocus) focusMix(lastFocus, $('fmix').dataset.fb, $('fmix').dataset.fa); }
    else if (d.page) { S.calls.offset = Math.max(0, S.calls.offset + (+d.page) * 25); window.scrollTo(0, 0); render(); }
    else if (d.unfilter) { var c = S.calls; if (d.unfilter === 'all') { S.calls = { offset: 0 }; S.callsAgent = null; } else if (d.unfilter === 'agent') S.callsAgent = null; else { c[d.unfilter] = d.unfilter === 'q' ? '' : null; c.offset = 0; } render(); }
    else if (d.act) {
      var a = d.act;
      if (a === 'customrange') { var cs = $('cs').value, ce = $('ce').value; if (cs && ce && cs <= ce) { S.range = 'custom'; S.start = cs; S.end = ce; S.pop = null; render(); } else toast('Pick a start date before the end date.'); }
      else if (a === 'closepop') { S.pop = null; render(); }
      else if (a === 'retry') { cache = {}; render(); }
      else if (a === 'signout') { if (CFG.onSignOut) CFG.onSignOut(); }
      else if (a === 'classic') { if (CFG.onClassic) CFG.onClassic(); }
      else if (a === 'pdf') { printCall(); }
      else if (a === 'restore') { var rk = d.k, st = ((S.cur && S.cur.steps) || []).filter(function (x) { return x.key === rk; })[0]; if (st) { el.disabled = true; saveAdjust(rk, st.ai_answer, null).then(function () { toast('Restored the AI answer'); }).catch(function (e2) { el.disabled = false; toast(e2.message || 'Couldn’t restore.'); }); } }
      else if (a === 'invite') { TM.inv = { name: '', email: '', role: 'manager', brand: '' }; drawTeam(); }
      else if (a === 'invcancel') { TM.inv = null; drawTeam(); }
      else if (a === 'invsend') { keepInv(); var I = TM.inv, nm = I.name.trim(), em = I.email.trim();
        if (!nm) { toast('Add their full name'); return; } if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { toast('Add a valid email'); return; }
        teamWrite({ op: 'invite', name: nm, email: em, role: I.role, brand: I.role === 'admin' ? null : (I.brand || null) }, 'Invite sent to ' + em, el); }
      else if (a === 'presend') { var pu = TM.list[+d.i]; teamWrite({ op: 'resend', id: pu.id }, 'Sent ' + pu.name + ' a new sign-in link', el); }
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
      else if (a === 'qsinsedit') { QSE.ins = true; drawQs(); }
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
      else if (a === 'qsreqsend') { var rq = $('qreq').value.trim(); if (!rq) { toast('Describe the change you’d like'); return; } qsWrite({ op: 'request', text: rq }, 'Request sent to the Opsis CX Support team', function () { QSE.req = false; }, el); }
    }
  });
  on(document, 'input', function (e) {
    if (e.target && e.target.id === 'pseek') { P.step = null; P.stepEnd = null; AU.currentTime = +e.target.value; tick(); }
  });
  on(document, 'change', function (e) {
    var t = e.target;
    if (t.hasAttribute && t.hasAttribute('data-invrole') && TM.inv) { keepInv(); TM.inv.role = t.value; drawTeam(); }
    else if (t.hasAttribute && t.hasAttribute('data-trow') && TM.list) {
      var u = TM.list[+t.getAttribute('data-trow')], rs = $('tr-' + u.id), bs = $('tb-' + u.id);
      var role = rs ? rs.value : u.role, brand = role === 'admin' ? null : (bs ? (bs.value || null) : (u.brand || null));
      teamWrite({ op: 'update', id: u.id, role: role, brand: brand }, u.name + ' is now ' + RNAME[role] + (role === 'admin' ? '' : ' · ' + (brand ? short(brand) : 'all brands')));
    }
  });
  on(document, 'keydown', function (e) {
    if (e.key === 'Escape') { var chg = $('chg'); if (chg) { chg.remove(); return; } if (S.pop) { S.pop = null; render(); return; } if ($('layer').innerHTML) closeLayer(); }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr.click,.lnk')) { e.preventDefault(); e.target.click(); }
    if (e.key === '/' && !e.target.matches('input,textarea,select')) { e.preventDefault(); var q = $('askq'); if (q) q.focus(); }
  });
  on(window, 'resize', function () { clearTimeout(fitReview.t); fitReview.t = setTimeout(fitReview, 150); });
  on(window, 'hashchange', function () { var before = location.hash; readHash(); render(); });
  var lg = $('oqlogo'); if (lg) { lg.src = CFG.logo || 'https://dqvuviyqrcrgapmxkoyx.supabase.co/storage/v1/object/public/portal-assets/garageco/logo.png'; lg.alt = CLIENT; }
  readHash(); render();
  return function destroy() {
    LISTENERS.forEach(function (l) { l[0].removeEventListener(l[1], l[2]); }); LISTENERS = [];
    try { AU.pause(); AU.removeAttribute('src'); AU.load(); } catch (x) {}
    if (EXT) { try { EXT(); } catch (x) {} EXT = null; }
  };
})();
  return function () { destroy(); ROOT.innerHTML = ''; };
}
