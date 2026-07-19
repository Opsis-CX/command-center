import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// Hourly production dashboards, rebuilt natively from Five9 call_log (BigQuery).
// Reporting → Hourly. Two tabs: Affiliate Hourly Report + Open Invoices Report.
// The ASC reviews auto-filled numbers, adds commentary, and copies the update
// into #GarageCo Reporting.

const COMPANY_TZ = 'America/New_York'
const etNow = () => new Date(new Date().toLocaleString('en-US', { timeZone: COMPANY_TZ }))
const isoDate = (d) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` }
const hourLabel = (h) => { if (h == null) return '—'; const ap = h < 12 ? 'AM' : 'PM'; const hr = h % 12 === 0 ? 12 : h % 12; return `${hr}:00 ${ap}` }
const good = '#1b5e20', warn = '#8d6e00', bad = '#b71c1c'
const pctStr = (v) => v == null ? '—' : v + '%'
const secStr = (v) => v == null ? '—' : v + 's'

// ---- HTML report builders (posted natively into the GarageCo Reporting chat) ----
// Constrained to what lib/sanitize.js allows: h3/p/ul/li/strong/table + background-color on th.
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const TH_STYLE = 'background-color:#1f8a53; color:#ffffff'
function htmlTable(headers, rows) {
  const head = '<thead><tr>' + headers.map(h => `<th style="${TH_STYLE}">${esc(h)}</th>`).join('') + '</tr></thead>'
  const body = '<tbody>' + rows.map(r => '<tr>' + r.map(c => `<td>${esc(c)}</td>`).join('') + '</tr>').join('') + '</tbody>'
  return `<table>${head}${body}</table>`
}
const bullets = (items) => '<ul>' + items.filter(Boolean).map(i => `<li>${i}</li>`).join('') + '</ul>'

const SECTION = { fontSize: 12.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--accent)', marginBottom: 10 }
const taStyle = { display: 'block', width: '100%', marginTop: 4, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: 'var(--canvas)', resize: 'vertical', boxSizing: 'border-box' }
const th = { textAlign: 'right', padding: '6px 8px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em', color: 'var(--ink-soft)', borderBottom: '1px solid var(--line)' }
const thL = { ...th, textAlign: 'left' }
const td = { textAlign: 'right', padding: '6px 8px', fontSize: 13, borderBottom: '1px solid var(--line-soft)' }
const tdL = { ...td, textAlign: 'left', fontWeight: 600 }

export default function HourlyReports() {
  const [tab, setTab] = useState('affiliate')
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, marginBottom: 18, flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title">Hourly Reports</h1>
          <p className="page-sub">Live call performance from Five9. Review the numbers, add your commentary, post to #GarageCo Reporting.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={'btn ' + (tab === 'affiliate' ? 'btn-primary' : 'btn-ghost')} onClick={() => setTab('affiliate')}>Affiliate Hourly Report</button>
          <button className={'btn ' + (tab === 'openinv' ? 'btn-primary' : 'btn-ghost')} onClick={() => setTab('openinv')}>Open Invoices Report</button>
        </div>
      </div>
      {tab === 'openinv' ? <OpenInvoicesView /> : <AffiliateView />}
    </div>
  )
}

function Delta({ cur, prev, unit }) {
  if (cur == null || prev == null) return <span style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>vs last hr: —</span>
  const d = Math.round((cur - prev) * 10) / 10
  const up = d > 0, flat = d === 0
  const col = flat ? 'var(--ink-soft)' : up ? good : bad
  return <span style={{ fontSize: 11.5, color: col, fontWeight: 600 }}>vs last hr: {flat ? '—' : (up ? '▲ ' : '▼ ') + Math.abs(d) + (unit || '')}</span>
}

function StatCard({ label, big, sub, bigColor, delta }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '14px 12px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--ink-soft)' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, margin: '5px 0 2px', color: bigColor || 'inherit' }}>{big}</div>
      <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{delta || sub}</div>
    </div>
  )
}

// Shared controls bar + data hook for both dashboards.
function useHourlyReport(rpc, day) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    setLoading(true); setErr('')
    const { data, error } = await supabase.rpc(rpc, { p_day: day })
    if (error) { setErr(error.message); setData(null) } else { setData(data) }
    setLoading(false)
  }, [rpc, day])
  useEffect(() => { load() }, [load])
  return { data, loading, err, setErr, load }
}

function ControlsBar({ day, setDay, data, syncing, onRefresh, onCopy, copied, onPost, posting, posted }) {
  const nowEt = new Date().toLocaleString('en-US', { timeZone: COMPANY_TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  const syncedLabel = data?.last_synced_at ? new Date(data.last_synced_at).toLocaleTimeString('en-US', { timeZone: COMPANY_TZ, hour: 'numeric', minute: '2-digit' }) : '—'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
      <input type="date" value={day} onChange={e => setDay(e.target.value)}
        style={{ padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: 'var(--canvas)' }} />
      <button className="btn btn-ghost" onClick={onRefresh} disabled={syncing}>{syncing ? '⏳ Syncing…' : '↻ Refresh from Five9'}</button>
      <span className="page-sub" style={{ fontSize: 12 }}>{data?.is_today ? `as of ${nowEt} · ` : ''}synced {syncedLabel}</span>
      <button className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={onCopy}>{copied ? '✓ Copied' : '📋 Copy text'}</button>
      <button className="btn btn-primary" onClick={onPost} disabled={posting}>{posted ? '✓ Posted to Reporting' : posting ? 'Posting…' : '📣 Post to Reporting'}</button>
    </div>
  )
}

// ============================================================
// OPEN INVOICES
// ============================================================
function OpenInvoicesView() {
  const [day, setDay] = useState(() => isoDate(etNow()))
  const { data, loading, err, setErr, load } = useHourlyReport('get_hourly_report_openinv', day)
  const [syncing, setSyncing] = useState(false)
  const [copied, setCopied] = useState(false)
  const [posting, setPosting] = useState(false)
  const [posted, setPosted] = useState(false)
  const [overview, setOverview] = useState('')

  async function refresh() {
    setSyncing(true); setErr('')
    try { const { error } = await supabase.rpc('refresh_hourly_calls'); if (error) throw error; await new Promise(r => setTimeout(r, 7000)); await load() }
    catch (e) { setErr(e.message || String(e)) }
    setSyncing(false)
  }
  async function postToReporting() {
    setPosting(true); setErr('')
    const { error } = await supabase.rpc('post_hourly_to_reporting', { p_type: 'open_invoices', p_hour: data?.current_hour ?? null, p_html: buildHtml(), p_snapshot: data, p_commentary: overview.trim() || null })
    setPosting(false)
    if (error) { setErr(error.message); return }
    setPosted(true); setTimeout(() => setPosted(false), 3000)
  }
  const dayLabel = new Date(day + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

  function buildHtml() {
    if (!data) return ''
    const t = data.totals
    const bh = (data.by_hour || []).filter(r => r.calls > 0)
    const peak = bh.reduce((a, r) => r.calls > (a?.calls || 0) ? r : a, null)
    const best = bh.reduce((a, r) => (r.contact_rate ?? -1) > (a?.contact_rate ?? -1) ? r : a, null)
    const disp = data.dispositions || []
    const topTwo = disp.slice(0, 2)
    const topShare = topTwo.reduce((s, d) => s + (d.pct || 0), 0)
    const takeaways = bullets([
      peak && `Peak volume: <strong>${esc(hourLabel(peak.hour))}</strong> with ${peak.calls} calls.`,
      best && `Best contact rate: <strong>${pctStr(best.contact_rate)}</strong> at ${esc(hourLabel(best.hour))}.`,
      `${t.calls} outbound calls · ${t.live_contacts} live contacts (avg ${pctStr(t.contact_rate)}) · ${pctStr(t.success_rate)} success rate.`,
      topTwo.length && `${Math.round(topShare)}% of calls ended in ${topTwo.map(d => esc(d.disposition)).join(' or ')}.`,
    ])
    const brandTbl = htmlTable(
      ['Brand', 'Calls', 'Live', 'Contact %', 'Call Backs', 'Hot Transfers', 'Success %', 'Avg Attempts'],
      (data.by_brand || []).map(b => [b.brand, b.calls, b.live_contacts, pctStr(b.contact_rate), b.callbacks, b.hot_transfers, pctStr(b.success_rate), b.avg_attempts ?? '—'])
    )
    const hourTbl = htmlTable(
      ['Hour', 'Calls', 'Live', 'Contact %', 'Call Backs', 'Hot Transfers', 'Success %', 'Avg Attempts'],
      bh.map(r => [hourLabel(r.hour), r.calls, r.live_contacts, pctStr(r.contact_rate), r.callbacks, r.hot_transfers, pctStr(r.success_rate), r.avg_attempts ?? '—'])
    )
    return [
      `<h3>Open Invoices — Hourly Report · ${esc(dayLabel)}${data.is_today ? ` · ${esc(hourLabel(data.current_hour))}` : ''}</h3>`,
      takeaways,
      overview.trim() ? `<p><strong>Notes:</strong> ${esc(overview.trim())}</p>` : '',
      `<p><strong>Brand Performance</strong></p>`, brandTbl,
      `<p><strong>Hourly Breakdown</strong></p>`, hourTbl,
    ].join('')
  }

  function buildUpdate() {
    if (!data) return ''
    const t = data.totals, h = data.this_hour
    const lines = [
      `Open Invoices — Hourly Update · ${dayLabel}${data.is_today ? ` · ${hourLabel(data.current_hour)}` : ''}`, ``,
      `This hour: ${h.calls} calls · ${h.live_contacts} live contacts (${pctStr(h.contact_rate)}) · ${h.callbacks} callbacks · ${h.hot_transfers} hot transfers`,
      `Today: ${t.calls} calls · ${t.live_contacts} live contacts (${pctStr(t.contact_rate)}) · ${t.callbacks} callbacks · ${t.hot_transfers} hot transfers · ${pctStr(t.success_rate)} success · ${t.avg_attempts ?? '—'} avg attempts`, ``,
    ]
    if (overview.trim()) lines.push(`Overview: ${overview.trim()}`, ``)
    lines.push(`@Corinne Kerper @Becky Jackson @Brittney Thompson`)
    return lines.join('\n')
  }
  async function copyUpdate() { try { await navigator.clipboard.writeText(buildUpdate()); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { setErr('Could not copy — select and copy manually.') } }

  if (loading) return <p className="page-sub">Loading Open Invoices report…</p>
  if (err && !data) return <div className="card" style={{ borderColor: 'var(--failed)' }}><b style={{ color: 'var(--failed)' }}>Couldn't load report.</b><p className="page-sub" style={{ marginTop: 6 }}>{err}</p></div>
  if (!data) return null

  const t = data.totals, h = data.this_hour, lh = data.last_hour
  const byHour = data.by_hour || [], byBrand = data.by_brand || [], disp = data.dispositions || []
  const maxHourCalls = Math.max(1, ...byHour.map(r => r.calls))

  return (
    <div>
      <ControlsBar day={day} setDay={setDay} data={data} syncing={syncing} onRefresh={refresh} onCopy={copyUpdate} copied={copied} onPost={postToReporting} posting={posting} posted={posted} />
      {err && <div className="card" style={{ borderColor: 'var(--failed)', marginBottom: 14 }}><b style={{ color: 'var(--failed)' }}>Error.</b><p className="page-sub" style={{ marginTop: 6 }}>{err}</p></div>}

      <div style={SECTION}>This Hour · {hourLabel(data.current_hour)}{data.is_today ? '' : ' (latest)'}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 18 }}>
        <StatCard label="Calls" big={String(h.calls)} delta={<Delta cur={h.calls} prev={lh.calls} />} />
        <StatCard label="Live Contacts" big={String(h.live_contacts)} delta={<Delta cur={h.live_contacts} prev={lh.live_contacts} />} />
        <StatCard label="Call Backs" big={String(h.callbacks)} delta={<Delta cur={h.callbacks} prev={lh.callbacks} />} />
        <StatCard label="Hot Transfers" big={String(h.hot_transfers)} delta={<Delta cur={h.hot_transfers} prev={lh.hot_transfers} />} />
        <StatCard label="Contact Rate" big={pctStr(h.contact_rate)} delta={<Delta cur={h.contact_rate} prev={lh.contact_rate} unit=" pts" />} />
        <StatCard label="Success Rate" big={pctStr(h.success_rate)} delta={<Delta cur={h.success_rate} prev={lh.success_rate} unit=" pts" />} />
      </div>

      <div style={SECTION}>Running Totals — Today</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 18 }}>
        <StatCard label="Total Calls" big={String(t.calls)} sub="dials today" />
        <StatCard label="Live Contacts" big={String(t.live_contacts)} sub="reached a person" />
        <StatCard label="Call Backs" big={String(t.callbacks)} sub="scheduled" />
        <StatCard label="Hot Transfers" big={String(t.hot_transfers)} sub="+ 3rd party" />
        <StatCard label="Contact Rate" big={pctStr(t.contact_rate)} bigColor={t.contact_rate >= 10 ? good : t.contact_rate >= 5 ? warn : bad} sub="contacts ÷ calls" />
        <StatCard label="Success Rate" big={pctStr(t.success_rate)} bigColor={t.success_rate >= 3 ? good : t.success_rate > 0 ? warn : bad} sub="booked/transfer/callback" />
        <StatCard label="Avg Attempts" big={t.avg_attempts ?? '—'} sub="dials to contact" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 18 }}>
        <div className="card">
          <div style={SECTION}>Brand Performance</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={thL}>Brand</th><th style={th}>Calls</th><th style={th}>Live</th><th style={th}>Ctc%</th><th style={th}>CB</th><th style={th}>HT</th><th style={th}>Succ%</th><th style={th}>Att</th></tr></thead>
              <tbody>
                {byBrand.map((b, i) => (<tr key={i}><td style={tdL}>{b.brand}</td><td style={td}>{b.calls}</td><td style={td}>{b.live_contacts}</td><td style={td}>{pctStr(b.contact_rate)}</td><td style={td}>{b.callbacks}</td><td style={td}>{b.hot_transfers}</td><td style={td}>{pctStr(b.success_rate)}</td><td style={td}>{b.avg_attempts ?? '—'}</td></tr>))}
                {byBrand.length === 0 && <tr><td style={td} colSpan={8}>No calls yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div style={SECTION}>Disposition Breakdown</div>
          {disp.length === 0 ? <p className="page-sub" style={{ fontSize: 13, margin: 0 }}>No calls yet.</p> : disp.map((d, i) => (
            <div key={i} style={{ padding: '5px 0', borderTop: i ? '1px solid var(--line-soft)' : 'none' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}><span>{d.disposition}</span><span style={{ fontWeight: 600 }}>{d.n} <span style={{ color: 'var(--ink-soft)', fontWeight: 400, fontSize: 12 }}>({pctStr(d.pct)})</span></span></div>
              <div style={{ height: 5, background: 'var(--line-soft)', borderRadius: 3, marginTop: 3 }}><div style={{ width: (d.pct || 0) + '%', height: '100%', background: 'var(--accent)', borderRadius: 3 }} /></div>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div style={SECTION}>Hourly Breakdown</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thL}>Hour</th><th style={th}>Calls</th><th style={th}>Live</th><th style={th}>Contact Rate</th><th style={th}>Call Backs</th><th style={th}>Hot Transfers</th><th style={th}>Success Rate</th><th style={th}>Avg Attempts</th></tr></thead>
            <tbody>
              {byHour.map((r, i) => (
                <tr key={i}>
                  <td style={tdL}>{hourLabel(r.hour)}</td>
                  <td style={td}><span style={{ display: 'inline-block', minWidth: 26, textAlign: 'right' }}>{r.calls}</span><span style={{ display: 'inline-block', width: 40, height: 6, background: 'var(--line-soft)', borderRadius: 3, marginLeft: 6, verticalAlign: 'middle' }}><span style={{ display: 'block', width: (r.calls / maxHourCalls * 100) + '%', height: '100%', background: 'var(--accent)', borderRadius: 3 }} /></span></td>
                  <td style={td}>{r.live_contacts}</td><td style={td}>{pctStr(r.contact_rate)}</td><td style={td}>{r.callbacks}</td><td style={td}>{r.hot_transfers}</td><td style={td}>{pctStr(r.success_rate)}</td><td style={td}>{r.avg_attempts ?? '—'}</td>
                </tr>
              ))}
              {byHour.length === 0 && <tr><td style={td} colSpan={8}>No calls yet today.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <Commentary label="Performance Overview — your commentary" value={overview} onChange={setOverview} preview={buildUpdate()} />
      <p className="page-sub" style={{ fontSize: 11.5 }}>Live from Five9 → BigQuery (Open Invoices campaigns). “Live Contact” = a real conversation, excluding voicemails and no-answers. Success = Booked, Brand Call Back, Hot Transfer, or Transferred to 3rd Party.</p>
    </div>
  )
}

// ============================================================
// AFFILIATE
// ============================================================
function AffiliateView() {
  const [day, setDay] = useState(() => isoDate(etNow()))
  const { data, loading, err, setErr, load } = useHourlyReport('get_hourly_report_affiliate', day)
  const [syncing, setSyncing] = useState(false)
  const [copied, setCopied] = useState(false)
  const [posting, setPosting] = useState(false)
  const [posted, setPosted] = useState(false)
  const [overview, setOverview] = useState('')

  async function refresh() {
    setSyncing(true); setErr('')
    try { const { error } = await supabase.rpc('refresh_hourly_calls'); if (error) throw error; await new Promise(r => setTimeout(r, 7000)); await load() }
    catch (e) { setErr(e.message || String(e)) }
    setSyncing(false)
  }
  async function postToReporting() {
    setPosting(true); setErr('')
    const { error } = await supabase.rpc('post_hourly_to_reporting', { p_type: 'affiliate', p_hour: data?.current_hour ?? null, p_html: buildHtml(), p_snapshot: data, p_commentary: overview.trim() || null })
    setPosting(false)
    if (error) { setErr(error.message); return }
    setPosted(true); setTimeout(() => setPosted(false), 3000)
  }
  const dayLabel = new Date(day + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

  function buildHtml() {
    if (!data) return ''
    const t = data.totals, spd = data.speed || {}, eff = data.booking_efficiency || {}
    const takeaways = bullets([
      `${t.dials} dials · ${t.new_leads} new leads · ${t.live_contacts} contacted (${pctStr(t.contact_rate)}).`,
      `${t.bookings} booked (${pctStr(t.booking_rate)} booking rate · ${pctStr(t.contact_conversion)} conversion).`,
      spd.first_dials ? `Speed to first dial: ${spd.within_15 ?? 0} within 15s / ${spd.over_15 ?? 0} over (avg ${secStr(spd.avg_sec)}).` : null,
      eff.total_booked ? `Booking efficiency: ${eff.first_dial ?? 0} on 1st dial · ${eff.second_dial ?? 0} on 2nd · ${eff.three_plus ?? 0} on 3+ (avg ${eff.avg_dial ?? '—'} dials).` : null,
    ])
    const cols = ['', 'New Leads', 'Dials', 'Live', 'Booked', 'Contact %', 'Book %', 'Conv %', 'Speed', 'Avg Dial']
    const row = (name, r) => [name, r.new_leads, r.dials, r.live_contacts, r.bookings, pctStr(r.contact_rate), pctStr(r.booking_rate), pctStr(r.contact_conversion), secStr(r.avg_speed_sec), r.avg_dial_booked ?? '—']
    const vendorTbl = htmlTable(cols.map((c, i) => i === 0 ? 'Vendor' : c), (data.vendors || []).map(r => row(r.vendor, r)))
    const brandTbl = htmlTable(cols.map((c, i) => i === 0 ? 'Brand' : c), (data.brands || []).map(r => row(r.brand, r)))
    return [
      `<h3>Affiliate Leads — Hourly Report · ${esc(dayLabel)}${data.is_today ? ` · ${esc(hourLabel(data.current_hour))}` : ''}</h3>`,
      takeaways,
      overview.trim() ? `<p><strong>Notes:</strong> ${esc(overview.trim())}</p>` : '',
      `<p><strong>Vendor Performance</strong></p>`, vendorTbl,
      `<p><strong>Brand Performance</strong></p>`, brandTbl,
    ].join('')
  }

  function buildUpdate() {
    if (!data) return ''
    const t = data.totals, h = data.this_hour
    const lines = [
      `Affiliate Leads — Hourly Update · ${dayLabel}${data.is_today ? ` · ${hourLabel(data.current_hour)}` : ''}`, ``,
      `This hour: ${h.dials} dials · ${h.new_leads} new leads · ${h.live_contacts} contacted (${pctStr(h.contact_rate)}) · ${h.bookings} booked`,
      `Today: ${t.dials} dials · ${t.new_leads} new leads · ${t.live_contacts} contacted (${pctStr(t.contact_rate)}) · ${t.bookings} booked (${pctStr(t.booking_rate)}) · ${pctStr(t.contact_conversion)} conversion · ${secStr(t.avg_speed_sec)} avg speed-to-dial`, ``,
    ]
    if (overview.trim()) lines.push(`Overview: ${overview.trim()}`, ``)
    lines.push(`@Corinne Kerper @Becky Jackson @Brittney Thompson`)
    return lines.join('\n')
  }
  async function copyUpdate() { try { await navigator.clipboard.writeText(buildUpdate()); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { setErr('Could not copy — select and copy manually.') } }

  if (loading) return <p className="page-sub">Loading Affiliate report…</p>
  if (err && !data) return <div className="card" style={{ borderColor: 'var(--failed)' }}><b style={{ color: 'var(--failed)' }}>Couldn't load report.</b><p className="page-sub" style={{ marginTop: 6 }}>{err}</p></div>
  if (!data) return null

  const t = data.totals, h = data.this_hour, lh = data.last_hour
  const spd = data.speed || {}, eff = data.booking_efficiency || {}
  const vendors = data.vendors || [], brands = data.brands || [], disp = data.dispositions || []

  const perfCols = (r) => (<>
    <td style={td}>{r.new_leads}</td><td style={td}>{r.dials}</td><td style={td}>{r.live_contacts}</td><td style={td}>{r.bookings}</td>
    <td style={td}>{pctStr(r.contact_rate)}</td><td style={td}>{pctStr(r.booking_rate)}</td><td style={td}>{pctStr(r.contact_conversion)}</td>
    <td style={td}>{secStr(r.avg_speed_sec)}</td><td style={td}>{r.avg_dial_booked ?? '—'}</td>
  </>)
  const perfHead = (first) => (<tr><th style={thL}>{first}</th><th style={th}>New Leads</th><th style={th}>Dials</th><th style={th}>Live</th><th style={th}>Booked</th><th style={th}>Ctc%</th><th style={th}>Book%</th><th style={th}>Conv%</th><th style={th}>Speed</th><th style={th}>Avg Dial</th></tr>)

  return (
    <div>
      <ControlsBar day={day} setDay={setDay} data={data} syncing={syncing} onRefresh={refresh} onCopy={copyUpdate} copied={copied} onPost={postToReporting} posting={posting} posted={posted} />
      {err && <div className="card" style={{ borderColor: 'var(--failed)', marginBottom: 14 }}><b style={{ color: 'var(--failed)' }}>Error.</b><p className="page-sub" style={{ marginTop: 6 }}>{err}</p></div>}

      <div style={SECTION}>This Hour · {hourLabel(data.current_hour)}{data.is_today ? '' : ' (latest)'}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 18 }}>
        <StatCard label="New Leads" big={String(h.new_leads)} delta={<Delta cur={h.new_leads} prev={lh.new_leads} />} />
        <StatCard label="Dials" big={String(h.dials)} delta={<Delta cur={h.dials} prev={lh.dials} />} />
        <StatCard label="Contacted" big={String(h.live_contacts)} delta={<Delta cur={h.live_contacts} prev={lh.live_contacts} />} />
        <StatCard label="Bookings" big={String(h.bookings)} delta={<Delta cur={h.bookings} prev={lh.bookings} />} />
        <StatCard label="Contact Rate" big={pctStr(h.contact_rate)} delta={<Delta cur={h.contact_rate} prev={lh.contact_rate} unit=" pts" />} />
        <StatCard label="Booking Rate" big={pctStr(h.booking_rate)} delta={<Delta cur={h.booking_rate} prev={lh.booking_rate} unit=" pts" />} />
      </div>

      <div style={SECTION}>Running Totals — Today</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: 18 }}>
        <StatCard label="New Leads" big={String(t.new_leads)} sub="loaded today" />
        <StatCard label="Dials" big={String(t.dials)} sub={`${t.redials} redials`} />
        <StatCard label="Contacted" big={String(t.live_contacts)} sub="reached a person" />
        <StatCard label="Bookings" big={String(t.bookings)} bigColor={t.bookings > 0 ? good : 'inherit'} sub="appointments" />
        <StatCard label="Contact Rate" big={pctStr(t.contact_rate)} bigColor={t.contact_rate >= 10 ? good : t.contact_rate >= 5 ? warn : bad} sub="contacted ÷ dials" />
        <StatCard label="Booking Rate" big={pctStr(t.booking_rate)} bigColor={t.booking_rate >= 3 ? good : t.booking_rate > 0 ? warn : bad} sub="booked ÷ dials" />
        <StatCard label="Conversion" big={pctStr(t.contact_conversion)} sub="booked ÷ contacted" />
        <StatCard label="Avg Speed" big={secStr(t.avg_speed_sec)} sub="to first dial" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginBottom: 18 }}>
        <div className="card">
          <div style={SECTION}>Speed to First Dial</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1, textAlign: 'center', padding: '10px 6px', background: 'var(--canvas)', borderRadius: 8 }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: good }}>{spd.within_15 ?? 0}</div>
              <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>within 15 sec</div>
            </div>
            <div style={{ flex: 1, textAlign: 'center', padding: '10px 6px', background: 'var(--canvas)', borderRadius: 8 }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: warn }}>{spd.over_15 ?? 0}</div>
              <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>over 15 sec</div>
            </div>
          </div>
          <p className="page-sub" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>Avg {secStr(spd.avg_sec)} across {spd.first_dials ?? 0} first dials.</p>
        </div>
        <div className="card">
          <div style={SECTION}>Booking Efficiency</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[['1st dial', eff.first_dial], ['2nd dial', eff.second_dial], ['3+ dials', eff.three_plus]].map(([lab, v], i) => (
              <div key={i} style={{ flex: 1, textAlign: 'center', padding: '10px 4px', background: 'var(--canvas)', borderRadius: 8 }}>
                <div style={{ fontSize: 20, fontWeight: 800 }}>{v ?? 0}</div>
                <div style={{ fontSize: 10.5, color: 'var(--ink-soft)' }}>{lab}</div>
              </div>
            ))}
          </div>
          <p className="page-sub" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>{eff.total_booked ?? 0} booked · avg {eff.avg_dial ?? '—'} dials to book.</p>
        </div>
        <div className="card">
          <div style={SECTION}>Disposition Summary</div>
          {disp.length === 0 ? <p className="page-sub" style={{ fontSize: 13, margin: 0 }}>No dials yet.</p> : disp.slice(0, 8).map((d, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '3px 0' }}><span>{d.disposition}</span><span style={{ fontWeight: 600 }}>{d.n} <span style={{ color: 'var(--ink-soft)', fontWeight: 400 }}>({pctStr(d.pct)})</span></span></div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div style={SECTION}>Vendor Performance</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>{perfHead('Vendor')}</thead>
            <tbody>
              {vendors.map((r, i) => (<tr key={i}><td style={tdL}>{r.vendor}</td>{perfCols(r)}</tr>))}
              {vendors.length === 0 && <tr><td style={td} colSpan={10}>No dials yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div style={SECTION}>Brand Performance</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>{perfHead('Brand')}</thead>
            <tbody>
              {brands.map((r, i) => (<tr key={i}><td style={tdL}>{r.brand}</td>{perfCols(r)}</tr>))}
              {brands.length === 0 && <tr><td style={td} colSpan={10}>No dials yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <Commentary label="Comms Overview — your commentary" value={overview} onChange={setOverview} preview={buildUpdate()} />
      <p className="page-sub" style={{ fontSize: 11.5 }}>
        Live from Five9 → BigQuery (Lavin / Kashurba affiliate campaigns). “Contacted” = a real conversation, excluding voicemails and no-answers. Speed-to-first-dial uses Five9 preview time; dial number counts a lead’s attempts across the last 3 days.
        <br /><b>Note:</b> “New Leads” = leads loaded that day (matches the totals above). Total leads on hand and Undialed % need the lead-list feed (call_log only holds calls that were made) — point me at a list source and I’ll wire those in.
      </p>
    </div>
  )
}

function Commentary({ label, value, onChange, preview }) {
  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={SECTION}>{label}</div>
        <textarea value={value} onChange={e => onChange(e.target.value)} rows={3} placeholder="Where we are, what's working, biggest opportunity, and what you're doing about it…" style={taStyle} />
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={SECTION}>Post Preview</div>
        <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12.5, background: 'var(--canvas)', border: '1px solid var(--line-soft)', borderRadius: 8, padding: 12, margin: 0 }}>{preview}</pre>
      </div>
    </>
  )
}
