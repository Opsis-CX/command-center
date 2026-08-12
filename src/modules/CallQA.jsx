diff --git a/src/modules/CallQA.jsx b/src/modules/CallQA.jsx
index 8d2c4c1..dc3af4f 100644
--- a/src/modules/CallQA.jsx
+++ b/src/modules/CallQA.jsx
@@ -696,7 +696,7 @@ export default function CallQA({ portal = false } = {}) {
     ] : []),
   ]
   const filterText = filterChips.map(([, v]) => v).join(' · ')
-  const TABS = [...(viewAll ? [['dashboard', 'Dashboard']] : []), ['overview', 'Overview'], ...(viewAll ? [['scorecards', 'Scorecards'], ['humanai', 'Human vs AI']] : []), ['opportunities', 'Opportunities'], ['missed', 'Large Missed Opps'], ['conversion', 'Conversion'], ['bookings', 'Bookings & Card'], ['calls', 'Calls'], ['fails', 'Lowest Scores'], ...(canManage ? [['rubric', 'Rubric'], ['settings', 'Settings'], ['import', 'Import']] : [])]
+  const TABS = [...(viewAll ? [['dashboard', 'Dashboard'], ['briefing', 'Briefing']] : []), ['overview', 'Overview'], ...(viewAll ? [['scorecards', 'Scorecards'], ['humanai', 'Human vs AI']] : []), ['opportunities', 'Opportunities'], ['missed', 'Large Missed Opps'], ['conversion', 'Conversion'], ['bookings', 'Bookings & Card'], ['calls', 'Calls'], ['fails', 'Lowest Scores'], ...(canManage ? [['rubric', 'Rubric'], ['settings', 'Settings'], ['import', 'Import']] : [])]
 
   return (
     <div style={{ padding: 20, maxWidth: 1180, margin: '0 auto', color: INK }}>
@@ -747,6 +747,7 @@ export default function CallQA({ portal = false } = {}) {
       ) : loading ? <div style={{ color: '#64748b' }}>Loading…</div> : err ? <Card style={{ color: '#b71c1c' }}>Error: {err}</Card> : (
         <>
           {tab === 'dashboard' && <ManagerDashboard rows={filtered} onOpen={setSelected} onGotoTab={setTab} onPickAgent={(a) => setAgent(a)} />}
+          {tab === 'briefing' && <CoachingBriefing rows={filtered} brand={brand} onOpen={setSelected} onPickBrand={(b) => { setBrand(b); setAgent('all') }} onPickAgent={(a) => setAgent(a)} />}
           {tab === 'scorecards' && <Scorecards rows={dateFiltered} prevRows={prevDateRows} viewAll={viewAll} onOpen={setSelected} brand={brand} setBrand={setBrand} />}
           {tab === 'humanai' && <HumanVsAI rows={dateFiltered} filterText={filterText} />}
           {tab === 'opportunities' && <Opportunities rows={filtered} agg={agg} onOpen={setSelected} viewAll={viewAll} />}
@@ -2170,6 +2171,224 @@ function ManagerDashboard({ rows, onOpen, onGotoTab, onPickAgent }) {
   )
 }
 
+// ===========================================================================
+// Coaching Briefing — the "editorial" dashboard (final design direction).
+// Same live data as ManagerDashboard, restyled as a scannable briefing with a
+// hero insight, KPI strip, a SORTABLE brand-performance ranking (shown only when
+// the view spans >1 brand), coaching priorities, queue and agent cards. Poppins
+// (already loaded in index.html). Additive tab — nothing else changes.
+// ===========================================================================
+function CoachingBriefing({ rows, brand, onOpen, onPickBrand, onPickAgent }) {
+  const F = 'Poppins,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif'
+  const C = { paper: '#f7f5f0', card: '#fff', ink: '#1a2430', ink2: '#556372', ink3: '#8a97a5', line: '#e7e2d8', line2: '#eef0ee', teal: TEAL, tan: '#a97c3f', tanbg: '#f3ead9', good: '#1b7a3d', goodbg: '#e6f4ea', warn: '#9a7400', warnbg: '#fbf1cf', bad: '#c0342b', badbg: '#fbe7e4' }
+  const [focus, setFocus] = useState(null)
+  const [sort, setSort] = useState('qa')
+  const data = useMemo(() => buildScorecardData(rows), [rows])
+  const k = useMemo(() => {
+    const scored = rows.filter(isScored)
+    const opps = rows.filter((r) => r.opportunity)
+    const booked = opps.filter((r) => r.outcome === 'Booked')
+    const lost = opps.filter((r) => r.outcome && r.outcome !== 'Booked')
+    const winnable = lost.filter((r) => r.winnable)
+    const noAsk = opps.filter((r) => r.asked_for_booking === false)
+    const priceBefore = rows.filter((r) => r.info_before_pricing === 'no')
+    const noContact = rows.filter((r) => (r.improvement_tags || []).includes(CONTACT_TAG))
+    const feeObj = rows.filter((r) => (r.objections || []).some((o) => /price|fee/i.test(o)))
+    const humans = data.agents.filter((a) => !a.ai); const ais = data.agents.filter((a) => a.ai)
+    const wavg = (arr) => { const c = arr.reduce((s, a) => s + a.calls, 0); return c ? arr.reduce((s, a) => s + (a.avg || 0) * a.calls, 0) / c : null }
+    return { scored, avg: scored.length ? scored.reduce((s, r) => s + (Number(r.score_pct) || 0), 0) / scored.length : null,
+      opps, booked, lost, winnable, noAsk, priceBefore, noContact, feeObj,
+      bookingRate: opps.length ? (booked.length / opps.length) * 100 : null,
+      winPct: lost.length ? Math.round((winnable.length / lost.length) * 100) : null,
+      humanAvg: wavg(humans), aiAvg: wavg(ais), aiN: ais.reduce((s, a) => s + a.calls, 0) }
+  }, [rows, data])
+
+  const brandRows = useMemo(() => {
+    const m = new Map()
+    rows.forEach((r) => { const b = (r.call || {}).brand || '—'; if (!m.has(b)) m.set(b, { brand: b, scored: 0, sum: 0, opps: 0, booked: 0, winnable: 0 })
+      const o = m.get(b); if (isScored(r)) { o.scored++; o.sum += Number(r.score_pct) || 0 }
+      if (r.opportunity) { o.opps++; if (r.outcome === 'Booked') o.booked++; else if (r.outcome && r.winnable) o.winnable++ } })
+    return Array.from(m.values()).filter((o) => o.scored >= 5).map((o) => ({ ...o, avg: o.scored ? o.sum / o.scored : null, booking: o.opps ? (o.booked / o.opps) * 100 : null }))
+  }, [rows])
+  const multiBrand = brandRows.length > 1
+
+  const agentRows = useMemo(() => {
+    const m = new Map()
+    rows.forEach((r) => { const a = agentOf(r); if (!a || a === 'Unknown' || isAiCsr(a)) return; if (!m.has(a)) m.set(a, { name: a, scored: 0, sum: 0, opps: 0, booked: 0, winnable: 0 })
+      const o = m.get(a); if (isScored(r)) { o.scored++; o.sum += Number(r.score_pct) || 0 }
+      if (r.opportunity) { o.opps++; if (r.outcome === 'Booked') o.booked++; else if (r.outcome && r.winnable) o.winnable++ } })
+    return Array.from(m.values()).filter((o) => o.scored >= 5).map((o) => ({ ...o, avg: o.scored ? o.sum / o.scored : null, booking: o.opps ? (o.booked / o.opps) * 100 : null })).sort((a, b) => b.scored - a.scored)
+  }, [rows])
+
+  const priorities = useMemo(() => {
+    const m = {}; rows.forEach((r) => (r.improvement_tags || []).forEach((t) => { m[t] = (m[t] || 0) + 1 }))
+    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t, n]) => ({ label: friendlyTag(t), n, calls: rows.filter((r) => (r.improvement_tags || []).includes(t)) }))
+  }, [rows])
+  const queue = useMemo(() => k.winnable.slice().sort((a, b) => (Number(a.score_pct) || 0) - (Number(b.score_pct) || 0)).slice(0, 6), [k])
+
+  const qCol = (v) => (v == null ? C.ink3 : v >= 70 ? C.good : v >= 62 ? C.warn : C.bad)
+  const bCol = (v) => (v == null ? C.ink3 : v >= 50 ? C.good : v >= 35 ? C.warn : C.bad)
+  const stat = (v) => (v >= 70 ? ['Strong', C.goodbg, C.good] : v >= 62 ? ['Steady', C.warnbg, C.warn] : ['Needs attention', C.badbg, C.bad])
+  const P = (v) => (v == null ? '—' : v.toFixed(1) + '%')
+  const go = (title, calls) => { setFocus({ title, calls }); if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' }) }
+  const SORTS = { qa: ['QA score', (a, b) => b.avg - a.avg], booking: ['Booking rate', (a, b) => b.booking - a.booking], winnable: ['Winnable losses', (a, b) => b.winnable - a.winnable], calls: ['Call volume', (a, b) => b.scored - a.scored] }
+  const sortedBrands = brandRows.slice().sort(SORTS[sort][1])
+  const title = brand && brand !== 'all' ? brand : 'Portfolio — all brands'
+
+  const box = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 16 }
+  const kicker = { fontSize: 12, letterSpacing: '.12em', textTransform: 'uppercase', color: C.tan, fontWeight: 700 }
+  const stitle = { fontFamily: F, fontSize: 19, fontWeight: 600, margin: '26px 0 12px' }
+
+  const KpiCell = ({ label, value, color, sub, onClick }) => (
+    <div onClick={onClick} style={{ background: C.card, padding: '15px 16px', cursor: onClick ? 'pointer' : 'default' }}>
+      <div style={{ fontSize: 12, color: C.ink3, fontWeight: 600 }}>{label}</div>
+      <div className="num" style={{ fontSize: 23, fontWeight: 700, marginTop: 5, color: color || C.ink }}>{value}</div>
+      <div style={{ fontSize: 11.5, color: C.ink2, marginTop: 2 }}>{sub}{onClick ? <span style={{ color: C.teal }}> ›</span> : null}</div>
+    </div>
+  )
+  const CallLine = ({ r }) => (
+    <div onClick={() => onOpen(r)} style={{ border: `1px solid ${C.line}`, borderRadius: 10, padding: 11, marginBottom: 8, cursor: 'pointer', background: C.card }}>
+      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
+        <b>{agentOf(r) || 'Unknown'}</b><span style={{ color: C.ink3, fontSize: 12 }}>— {(r.call || {}).brand || '—'}</span>
+        <span className="num" style={{ marginLeft: 'auto', background: scoreBg(r.score_pct), color: scoreColor(r.score_pct), fontWeight: 700, padding: '3px 8px', borderRadius: 8, fontSize: 12.5 }}>{r.score_pct == null ? '—' : Math.round(Number(r.score_pct)) + '%'}</span>
+      </div>
+      <div style={{ fontSize: 12, color: C.ink2, marginTop: 4 }}>{r.outcome || 'No outcome'}{(r.improvement_tags || [])[0] ? ' · ' + friendlyTag((r.improvement_tags || [])[0]) : ''}</div>
+    </div>
+  )
+
+  return (
+    <div style={{ fontFamily: F, background: C.paper, border: `1px solid ${C.line}`, borderRadius: 18, padding: 22, color: C.ink }}>
+      {focus && (
+        <div style={{ ...box, border: `1px solid ${C.teal}`, marginBottom: 16, overflow: 'hidden' }}>
+          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 14, borderBottom: `1px solid ${C.line2}`, flexWrap: 'wrap' }}>
+            <button onClick={() => setFocus(null)} style={{ background: 'none', border: 'none', color: C.teal, fontWeight: 700, cursor: 'pointer', fontFamily: F }}>‹ Back</button>
+            <b style={{ fontSize: 15 }}>{focus.title}</b>
+            <span style={{ color: C.ink3, fontSize: 13 }}>{focus.calls.length.toLocaleString()} calls · click any to open the recording</span>
+          </div>
+          <div style={{ padding: 14, maxHeight: 440, overflow: 'auto' }}>
+            {focus.calls.length ? focus.calls.slice(0, 80).map((r, i) => <CallLine key={r.id || i} r={r} />) : <div style={{ color: C.ink2 }}>No matching calls.</div>}
+          </div>
+        </div>
+      )}
+
+      {/* masthead */}
+      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, borderBottom: `2px solid ${C.ink}`, paddingBottom: 14 }}>
+        <div><div style={kicker}>Call QA · Coaching Briefing</div>
+          <h1 style={{ fontFamily: F, fontSize: 30, margin: '6px 0 0', fontWeight: 600 }}>{title}</h1></div>
+        <div style={{ textAlign: 'right', color: C.ink2, fontSize: 13 }}>{k.scored.length.toLocaleString()} calls reviewed{multiBrand ? ` · ${brandRows.length} brands` : ''}</div>
+      </div>
+
+      {/* hero */}
+      <div style={{ ...box, padding: 26, marginTop: 20, display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr)', gap: 26 }}>
+        <div>
+          <div style={kicker}>What to fix this period</div>
+          <h2 style={{ fontFamily: F, fontSize: 24, lineHeight: 1.3, margin: '10px 0 12px', fontWeight: 600 }}>
+            <span style={{ color: C.teal, borderBottom: `3px solid ${C.tanbg}` }}>{k.winPct == null ? '—' : k.winPct + '%'} of every lost opportunity was winnable</span> — and the ask for the appointment was missing on {k.noAsk.length.toLocaleString()} calls.
+          </h2>
+          <p style={{ color: C.ink2, lineHeight: 1.6, margin: 0 }}>QA is {P(k.avg)} and booking is {P(k.bookingRate)}. The same three coachable behaviors — asking for the appointment, capturing contact information, and framing the service fee — explain most of the gap{multiBrand ? ' across the portfolio' : ''}.</p>
+          <div style={{ marginTop: 16, display: 'flex', gap: 9, flexWrap: 'wrap' }}>
+            <button onClick={() => go('Coaching queue — winnable losses', k.winnable)} style={{ background: C.teal, color: '#fff', border: 'none', borderRadius: 10, padding: '9px 15px', fontWeight: 700, cursor: 'pointer', fontFamily: F }}>Open the coaching queue →</button>
+          </div>
+        </div>
+        <div style={{ borderLeft: `1px solid ${C.line}`, paddingLeft: 24, display: 'flex', flexDirection: 'column', gap: 16, justifyContent: 'center' }}>
+          <div><div style={{ fontSize: 12, color: C.ink3, fontWeight: 600, textTransform: 'uppercase' }}>Winnable losses</div><div className="num" style={{ fontSize: 30, fontWeight: 700, color: C.bad }}>{k.winnable.length.toLocaleString()}</div></div>
+          <div><div style={{ fontSize: 12, color: C.ink3, fontWeight: 600, textTransform: 'uppercase' }}>Booking rate</div><div className="num" style={{ fontSize: 30, fontWeight: 700, color: C.teal }}>{P(k.bookingRate)}</div></div>
+          {k.aiN > 0 && <div><div style={{ fontSize: 12, color: C.ink3, fontWeight: 600, textTransform: 'uppercase' }}>Human vs AI QA</div><div className="num" style={{ fontSize: 30, fontWeight: 700 }}>{P(k.humanAvg)} / {P(k.aiAvg)}</div></div>}
+        </div>
+      </div>
+
+      {/* kpi strip */}
+      <div style={stitle}>The numbers <span style={{ color: C.ink3, fontSize: 12.5, fontWeight: 400 }}>· click any to open the calls</span></div>
+      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 1, background: C.line, border: `1px solid ${C.line}`, borderRadius: 14, overflow: 'hidden' }}>
+        <KpiCell label="Average QA Score" value={P(k.avg)} color={qCol(k.avg)} sub={`${k.scored.length.toLocaleString()} scored`} onClick={() => go('All scored calls', k.scored)} />
+        <KpiCell label="Booking Rate" value={P(k.bookingRate)} color={C.teal} sub={`${k.booked.length} of ${k.opps.length} opps`} onClick={() => go('Booked opportunities', k.booked)} />
+        <KpiCell label="Booking Not Asked" value={k.noAsk.length.toLocaleString()} color={C.bad} sub="no ask on the opp" onClick={() => go('No booking attempt', k.noAsk)} />
+        <KpiCell label="Pricing Before Discovery" value={k.priceBefore.length.toLocaleString()} color={C.warn} sub="quoted too early" onClick={() => go('Pricing before discovery', k.priceBefore)} />
+        <KpiCell label="Info Not Captured" value={k.noContact.length.toLocaleString()} color={C.bad} sub="no contact details" onClick={() => go('Customer info not captured', k.noContact)} />
+        {k.aiN > 0 && <KpiCell label="Human vs AI QA" value={`${P(k.humanAvg)} / ${P(k.aiAvg)}`} sub="human vs AI" />}
+      </div>
+
+      {/* brand ranking — only when >1 brand */}
+      {multiBrand && (
+        <>
+          <div style={stitle}>Brand performance <span style={{ color: C.ink3, fontSize: 12.5, fontWeight: 400 }}>· sort by any metric · click a brand to drill in</span></div>
+          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
+            <span style={{ fontSize: 12, color: C.ink3, fontWeight: 600 }}>Sort by</span>
+            {Object.entries(SORTS).map(([key, v]) => (
+              <button key={key} onClick={() => setSort(key)} style={{ background: sort === key ? C.teal : C.card, color: sort === key ? '#fff' : C.ink2, border: `1px solid ${sort === key ? C.teal : C.line}`, borderRadius: 999, padding: '6px 13px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: F }}>{v[0]}</button>
+            ))}
+          </div>
+          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(250px,1fr))', gap: 13 }}>
+            {sortedBrands.map((b, i) => { const st = stat(b.avg); const em = (m) => (sort === m ? { borderBottom: `2px solid ${C.teal}`, paddingBottom: 3 } : {}); return (
+              <div key={b.brand} onClick={() => onPickBrand(b.brand)} style={{ ...box, padding: 16, cursor: 'pointer', position: 'relative' }}>
+                <div style={{ position: 'absolute', top: 14, right: 16, fontFamily: F, fontSize: 15, color: C.ink3 }}>#{i + 1}</div>
+                <div style={{ fontWeight: 700, fontSize: 17 }}>{b.brand}</div>
+                <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, marginTop: 6, display: 'inline-block', background: st[1], color: st[2] }}>{st[0]}</span>
+                <div style={{ display: 'flex', gap: 18, marginTop: 14 }}>
+                  <div style={em('qa')}><div style={{ fontSize: 10.5, color: C.ink3, textTransform: 'uppercase', fontWeight: 600 }}>QA</div><div className="num" style={{ fontSize: 19, fontWeight: 700, color: qCol(b.avg) }}>{P(b.avg)}</div></div>
+                  <div style={em('booking')}><div style={{ fontSize: 10.5, color: C.ink3, textTransform: 'uppercase', fontWeight: 600 }}>Booking</div><div className="num" style={{ fontSize: 19, fontWeight: 700, color: bCol(b.booking) }}>{P(b.booking)}</div></div>
+                  <div style={em('winnable')}><div style={{ fontSize: 10.5, color: C.ink3, textTransform: 'uppercase', fontWeight: 600 }}>Winnable</div><div className="num" style={{ fontSize: 19, fontWeight: 700 }}>{b.winnable}</div></div>
+                </div>
+                <div style={{ height: 6, background: C.line2, borderRadius: 4, marginTop: 14, overflow: 'hidden' }}><div style={{ width: Math.max(0, Math.min(100, b.avg || 0)) + '%', height: '100%', background: qCol(b.avg) }} /></div>
+                <div style={{ marginTop: 10, fontSize: 12, color: C.ink2 }}>{b.scored.toLocaleString()} calls · <span style={{ color: C.teal, fontWeight: 700 }}>drill in ›</span></div>
+              </div>
+            ) })}
+          </div>
+        </>
+      )}
+
+      {/* priorities + queue */}
+      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 18, marginTop: 12 }}>
+        <div style={{ ...box, padding: 20 }}>
+          <div style={{ ...stitle, margin: '0 0 4px' }}>Coaching priorities</div>
+          <div style={{ color: C.ink2, fontSize: 13, marginBottom: 6 }}>The biggest systemic misses in this view.</div>
+          {priorities.map((p, i) => (
+            <div key={p.label} onClick={() => go(p.label, p.calls)} style={{ display: 'flex', gap: 14, alignItems: 'baseline', padding: '13px 0', borderTop: i ? `1px solid ${C.line2}` : 'none', cursor: 'pointer' }}>
+              <div style={{ fontFamily: F, fontSize: 22, color: C.tan, fontWeight: 700, width: 22 }}>{i + 1}</div>
+              <div style={{ fontWeight: 600, fontSize: 15.5 }}>{p.label}</div>
+              <div style={{ marginLeft: 'auto', textAlign: 'right' }}><b className="num" style={{ fontSize: 20 }}>{p.n.toLocaleString()}</b><span style={{ display: 'block', color: C.ink3, fontSize: 11 }}>calls</span></div>
+            </div>
+          ))}
+        </div>
+        <div style={{ ...box, padding: 20 }}>
+          <div style={{ ...stitle, margin: '0 0 4px' }}>Coaching queue</div>
+          <div style={{ color: C.ink2, fontSize: 13, marginBottom: 6 }}>Winnable losses, lowest score first.</div>
+          {queue.length ? queue.map((r, i) => (
+            <div key={r.id || i} style={{ display: 'flex', gap: 13, padding: '13px 0', borderTop: i ? `1px solid ${C.line2}` : 'none', alignItems: 'flex-start' }}>
+              <div className="num" style={{ width: 48, height: 48, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 15, flexShrink: 0, background: scoreBg(r.score_pct), color: scoreColor(r.score_pct) }}>{r.score_pct == null ? '—' : Math.round(Number(r.score_pct))}</div>
+              <div style={{ flex: 1 }}>
+                <div style={{ fontWeight: 700 }}>{agentOf(r) || 'Unknown'} <span style={{ color: C.ink3, fontWeight: 400, fontSize: 12.5 }}>— {(r.call || {}).brand || '—'}</span></div>
+                <div style={{ color: C.ink2, fontSize: 12.5, margin: '2px 0 5px' }}>Winnable loss · {r.outcome || 'not booked'}</div>
+                <div style={{ fontSize: 12.5, color: C.ink2 }}>{(r.improvement_tags || []).slice(0, 2).map((t, j) => <div key={j}>▸ {friendlyTag(t)}</div>)}</div>
+                <button onClick={() => onOpen(r)} style={{ background: 'none', border: `1px solid ${C.teal}`, color: C.teal, borderRadius: 9, padding: '5px 11px', fontWeight: 700, fontSize: 12, cursor: 'pointer', marginTop: 7, fontFamily: F }}>▶ Review call</button>
+              </div>
+            </div>
+          )) : <div style={{ color: C.ink2 }}>No winnable losses in this view.</div>}
+        </div>
+      </div>
+
+      {/* agent spotlight */}
+      <div style={stitle}>Agent spotlight <span style={{ color: C.ink3, fontSize: 12.5, fontWeight: 400 }}>· click to scope the page to a CSR</span></div>
+      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 14 }}>
+        {agentRows.slice(0, 4).map((a) => (
+          <div key={a.name} onClick={() => onPickAgent(a.name)} style={{ ...box, padding: 16, cursor: 'pointer' }}>
+            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
+              <div style={{ width: 40, height: 40, borderRadius: '50%', background: C.teal, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 16 }}>{a.name[0]}</div>
+              <div><div style={{ fontWeight: 700, fontSize: 16 }}>{a.name}</div><div style={{ color: C.ink3, fontSize: 12 }}>{a.scored.toLocaleString()} calls</div></div>
+            </div>
+            <div style={{ display: 'flex', gap: 16, marginTop: 14 }}>
+              <div><div style={{ fontSize: 11, color: C.ink3, textTransform: 'uppercase', fontWeight: 600 }}>QA</div><div className="num" style={{ fontSize: 19, fontWeight: 700, color: qCol(a.avg) }}>{P(a.avg)}</div></div>
+              <div><div style={{ fontSize: 11, color: C.ink3, textTransform: 'uppercase', fontWeight: 600 }}>Booking</div><div className="num" style={{ fontSize: 19, fontWeight: 700, color: bCol(a.booking) }}>{P(a.booking)}</div></div>
+              <div><div style={{ fontSize: 11, color: C.ink3, textTransform: 'uppercase', fontWeight: 600 }}>Winnable</div><div className="num" style={{ fontSize: 19, fontWeight: 700 }}>{a.winnable}</div></div>
+            </div>
+            <div style={{ marginTop: 12, paddingTop: 11, borderTop: `1px solid ${C.line2}`, fontSize: 12.5, color: C.teal, fontWeight: 700 }}>open scorecard ›</div>
+          </div>
+        ))}
+      </div>
+    </div>
+  )
+}
+
 // Beige/tan for the AI series (was violet). AI_HUE = the soft fill used for bars
 // and legend swatches; AI_INK = a darker tan for text labels so they stay legible
 // on white (the fill tone is too light to read as text).
