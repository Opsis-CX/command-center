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
// Contact/success rates: higher is better. Neutral thresholds, tuned later.
const good = '#1b5e20', warn = '#8d6e00', bad = '#b71c1c'

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
      {tab === 'openinv' ? <OpenInvoicesView /> : <AffiliatePlaceholder />}
    </div>
  )
}

function AffiliatePlaceholder() {
  return (
    <div className="card" style={{ textAlign: 'center', padding: 40 }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Affiliate Hourly Report — building next</div>
      <p className="page-sub" style={{ margin: 0 }}>
        Vendor performance (Lavin / Kashurba), brand performance, booking efficiency by dial number, and speed-to-first-dial. The Open Invoices report is live now on the tab beside this one.
      </p>
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

const SECTION = { fontSize: 12.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--accent)', marginBottom: 10 }
const taStyle = { display: 'block', width: '100%', marginTop: 4, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: 'var(--canvas)', resize: 'vertical', boxSizing: 'border-box' }
const th = { textAlign: 'right', padding: '6px 8px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em', color: 'var(--ink-soft)', borderBottom: '1px solid var(--line)' }
const thL = { ...th, textAlign: 'left' }
const td = { textAlign: 'right', padding: '6px 8px', fontSize: 13, borderBottom: '1px solid var(--line-soft)' }
const tdL = { ...td, textAlign: 'left', fontWeight: 600 }
const pctStr = (v) => v == null ? '—' : v + '%'

function OpenInvoicesView() {
  const [day, setDay] = useState(() => isoDate(etNow()))
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)
  const [overview, setOverview] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    const { data, error } = await supabase.rpc('get_hourly_report_openinv', { p_day: day })
    if (error) { setErr(error.message); setData(null) } else { setData(data) }
    setLoading(false)
  }, [day])
  useEffect(() => { load() }, [load])

  async function refresh() {
    setSyncing(true); setErr('')
    try {
      const { error } = await supabase.rpc('refresh_hourly_calls')
      if (error) throw error
      await new Promise(r => setTimeout(r, 7000))
      await load()
    } catch (e) { setErr(e.message || String(e)) }
    setSyncing(false)
  }

  const nowEt = new Date().toLocaleString('en-US', { timeZone: COMPANY_TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  const dayLabel = new Date(day + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const syncedLabel = data?.last_synced_at ? new Date(data.last_synced_at).toLocaleTimeString('en-US', { timeZone: COMPANY_TZ, hour: 'numeric', minute: '2-digit' }) : '—'

  function buildUpdate() {
    if (!data) return ''
    const t = data.totals, h = data.this_hour
    const lines = [
      `Open Invoices — Hourly Update · ${dayLabel}${data.is_today ? ` · ${hourLabel(data.current_hour)}` : ''}`,
      ``,
      `This hour: ${h.calls} calls · ${h.live_contacts} live contacts (${pctStr(h.contact_rate)}) · ${h.callbacks} callbacks · ${h.hot_transfers} hot transfers`,
      `Today: ${t.calls} calls · ${t.live_contacts} live contacts (${pctStr(t.contact_rate)}) · ${t.callbacks} callbacks · ${t.hot_transfers} hot transfers · ${pctStr(t.success_rate)} success · ${t.avg_attempts ?? '—'} avg attempts`,
      ``,
    ]
    if (overview.trim()) { lines.push(`Overview: ${overview.trim()}`, ``) }
    lines.push(`@Corinne Kerper @Becky Jackson @Brittney Thompson`)
    return lines.join('\n')
  }
  async function copyUpdate() {
    try { await navigator.clipboard.writeText(buildUpdate()); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { setErr('Could not copy — select and copy manually.') }
  }

  if (loading) return <p className="page-sub">Loading Open Invoices report…</p>
  if (err && !data) return <div className="card" style={{ borderColor: 'var(--failed)' }}><b style={{ color: 'var(--failed)' }}>Couldn't load report.</b><p className="page-sub" style={{ marginTop: 6 }}>{err}</p></div>
  if (!data) return null

  const t = data.totals, h = data.this_hour, lh = data.last_hour
  const byHour = data.by_hour || []
  const byBrand = data.by_brand || []
  const disp = data.dispositions || []
  const maxHourCalls = Math.max(1, ...byHour.map(r => r.calls))

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <input type="date" value={day} onChange={e => setDay(e.target.value)}
          style={{ padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: 'var(--canvas)' }} />
        <button className="btn btn-ghost" onClick={refresh} disabled={syncing}>{syncing ? '⏳ Syncing…' : '↻ Refresh from Five9'}</button>
        <span className="page-sub" style={{ fontSize: 12 }}>{data.is_today ? `as of ${nowEt} · ` : ''}synced {syncedLabel}</span>
        <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={copyUpdate}>{copied ? '✓ Copied' : '📋 Copy update'}</button>
      </div>

      {err && <div className="card" style={{ borderColor: 'var(--failed)', marginBottom: 14 }}><b style={{ color: 'var(--failed)' }}>Error.</b><p className="page-sub" style={{ marginTop: 6 }}>{err}</p></div>}

      {/* THIS HOUR */}
      <div style={SECTION}>This Hour {data.is_today ? `· ${hourLabel(data.current_hour)}` : `· ${hourLabel(data.current_hour)} (latest)`}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 18 }}>
        <StatCard label="Calls" big={String(h.calls)} delta={<Delta cur={h.calls} prev={lh.calls} />} />
        <StatCard label="Live Contacts" big={String(h.live_contacts)} delta={<Delta cur={h.live_contacts} prev={lh.live_contacts} />} />
        <StatCard label="Call Backs" big={String(h.callbacks)} delta={<Delta cur={h.callbacks} prev={lh.callbacks} />} />
        <StatCard label="Hot Transfers" big={String(h.hot_transfers)} delta={<Delta cur={h.hot_transfers} prev={lh.hot_transfers} />} />
        <StatCard label="Contact Rate" big={pctStr(h.contact_rate)} delta={<Delta cur={h.contact_rate} prev={lh.contact_rate} unit=" pts" />} />
        <StatCard label="Success Rate" big={pctStr(h.success_rate)} delta={<Delta cur={h.success_rate} prev={lh.success_rate} unit=" pts" />} />
      </div>

      {/* RUNNING TOTALS */}
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
        {/* BRAND PERFORMANCE */}
        <div className="card">
          <div style={SECTION}>Brand Performance</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={thL}>Brand</th><th style={th}>Calls</th><th style={th}>Live</th><th style={th}>Ctc%</th><th style={th}>CB</th><th style={th}>HT</th><th style={th}>Succ%</th><th style={th}>Att</th></tr></thead>
              <tbody>
                {byBrand.map((b, i) => (
                  <tr key={i}>
                    <td style={tdL}>{b.brand}</td><td style={td}>{b.calls}</td><td style={td}>{b.live_contacts}</td>
                    <td style={td}>{pctStr(b.contact_rate)}</td><td style={td}>{b.callbacks}</td><td style={td}>{b.hot_transfers}</td>
                    <td style={td}>{pctStr(b.success_rate)}</td><td style={td}>{b.avg_attempts ?? '—'}</td>
                  </tr>
                ))}
                {byBrand.length === 0 && <tr><td style={td} colSpan={8}>No calls yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {/* DISPOSITION BREAKDOWN */}
        <div className="card">
          <div style={SECTION}>Disposition Breakdown</div>
          {disp.length === 0 ? <p className="page-sub" style={{ fontSize: 13, margin: 0 }}>No calls yet.</p> : disp.map((d, i) => (
            <div key={i} style={{ padding: '5px 0', borderTop: i ? '1px solid var(--line-soft)' : 'none' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                <span>{d.disposition}</span>
                <span style={{ fontWeight: 600 }}>{d.n} <span style={{ color: 'var(--ink-soft)', fontWeight: 400, fontSize: 12 }}>({pctStr(d.pct)})</span></span>
              </div>
              <div style={{ height: 5, background: 'var(--line-soft)', borderRadius: 3, marginTop: 3 }}>
                <div style={{ width: (d.pct || 0) + '%', height: '100%', background: 'var(--accent)', borderRadius: 3 }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* HOURLY BREAKDOWN */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div style={SECTION}>Hourly Breakdown</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thL}>Hour</th><th style={th}>Calls</th><th style={th}>Live</th><th style={th}>Contact Rate</th><th style={th}>Call Backs</th><th style={th}>Hot Transfers</th><th style={th}>Success Rate</th><th style={th}>Avg Attempts</th></tr></thead>
            <tbody>
              {byHour.map((r, i) => (
                <tr key={i}>
                  <td style={tdL}>{hourLabel(r.hour)}</td>
                  <td style={td}>
                    <span style={{ display: 'inline-block', minWidth: 26, textAlign: 'right' }}>{r.calls}</span>
                    <span style={{ display: 'inline-block', width: 40, height: 6, background: 'var(--line-soft)', borderRadius: 3, marginLeft: 6, verticalAlign: 'middle' }}>
                      <span style={{ display: 'block', width: (r.calls / maxHourCalls * 100) + '%', height: '100%', background: 'var(--accent)', borderRadius: 3 }} />
                    </span>
                  </td>
                  <td style={td}>{r.live_contacts}</td><td style={td}>{pctStr(r.contact_rate)}</td>
                  <td style={td}>{r.callbacks}</td><td style={td}>{r.hot_transfers}</td>
                  <td style={td}>{pctStr(r.success_rate)}</td><td style={td}>{r.avg_attempts ?? '—'}</td>
                </tr>
              ))}
              {byHour.length === 0 && <tr><td style={td} colSpan={8}>No calls yet today.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* PERFORMANCE OVERVIEW (ASC commentary) */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={SECTION}>Performance Overview — your commentary</div>
        <textarea value={overview} onChange={e => setOverview(e.target.value)} rows={3}
          placeholder="Where we are, what's working, biggest opportunity, and what you're doing about it…" style={taStyle} />
      </div>

      {/* PREVIEW */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={SECTION}>Post Preview</div>
        <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12.5, background: 'var(--canvas)', border: '1px solid var(--line-soft)', borderRadius: 8, padding: 12, margin: 0 }}>{buildUpdate()}</pre>
      </div>

      <p className="page-sub" style={{ fontSize: 11.5 }}>
        Live from Five9 → BigQuery (Open Invoices campaigns). “Live Contact” = a real conversation, excluding voicemails and no-answers. Success = Booked, Brand Call Back, Hot Transfer, or Transferred to 3rd Party. Data syncs hourly; hit “Refresh from Five9” to pull the latest before you post.
      </p>
    </div>
  )
}
