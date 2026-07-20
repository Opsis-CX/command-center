import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// ============================================================
// HOURLY SCHEDULE REPORT — schedule reporting down to the clock hour.
// Two modes, both exportable to CSV:
//   • Coverage — per day + hour: slots available / filled / open / fill %.
//   • Roster   — per day + hour: who was scheduled (one row per agent-hour).
// Scoped by a client or role (pick one), over a date range. Powered by the
// SECURITY DEFINER RPC get_schedule_hours_report (reporting staff / admin).
// ============================================================

function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
function mondayOf(d) { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); return x }
function hourLabel(h) { const ap = h < 12 ? 'AM' : 'PM'; return `${h % 12 || 12}:00 ${ap}` }
function weekday(dateStr) { return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' }) }

export default function HoursReport() {
  const today = new Date()
  const [start, setStart] = useState(ymd(mondayOf(today)))
  const [end, setEnd] = useState(ymd(new Date(mondayOf(today).getTime() + 6 * 864e5)))
  const [clients, setClients] = useState([])
  const [roles, setRoles] = useState([])
  const [clientId, setClientId] = useState('')
  const [role, setRole] = useState('')
  const [mode, setMode] = useState('coverage')   // 'coverage' | 'roster'
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  // Filter options
  useEffect(() => {
    supabase.from('clients').select('id, name').order('name').then(({ data }) => setClients(data || []))
    supabase.from('shift_blocks').select('role').then(({ data }) => {
      const set = [...new Set((data || []).map(r => (r.role || '').trim()).filter(Boolean))].sort()
      setRoles(set)
    })
  }, [])

  const run = useCallback(async () => {
    setLoading(true); setErr('')
    const { data: res, error } = await supabase.rpc('get_schedule_hours_report', {
      p_start: start, p_end: end,
      p_client: clientId || null, p_role: role || null,
    })
    setLoading(false)
    if (error) { setErr(error.message); return }
    if (!res) { setErr('You don’t have access to this report.'); return }
    setData(res)
  }, [start, end, clientId, role])

  useEffect(() => { run() }, []) // eslint-disable-line

  const rows = data ? (mode === 'coverage' ? data.coverage : data.roster) : []

  function exportCsv() {
    if (!rows.length) return
    const cols = mode === 'coverage'
      ? [['Date', r => r.date], ['Day', r => weekday(r.date)], ['Hour', r => hourLabel(r.hour)],
         ['Slots Available', r => r.available], ['Slots Filled', r => r.filled], ['Slots Open', r => r.open],
         ['Fill %', r => r.available ? Math.round((r.filled / r.available) * 100) + '%' : '']]
      : [['Date', r => r.date], ['Day', r => weekday(r.date)], ['Hour', r => hourLabel(r.hour)],
         ['Agent', r => r.agent], ['Role', r => r.role], ['Client', r => r.client]]
    const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
    const lines = [cols.map(c => c[0]).join(',')]
    rows.forEach(r => lines.push(cols.map(c => esc(c[1](r))).join(',')))
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const scope = clientId ? (clients.find(c => c.id === clientId)?.name || 'client') : role || 'all'
    a.href = url; a.download = `hourly-${mode}-${scope}-${start}_to_${end}.csv`.replace(/[^a-z0-9._-]/gi, '-')
    a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <div style={{ marginBottom: 14 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Hourly Schedule Report</h1>
        <p className="page-sub" style={{ marginTop: 2 }}>Scheduled coverage and roster, down to the clock hour. Pick a client or role, choose a range, export.</p>
      </div>

      {/* filters */}
      <div className="card" style={{ padding: 14, marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="From"><input type="date" value={start} onChange={e => setStart(e.target.value)} style={inp} /></Field>
        <Field label="To"><input type="date" value={end} onChange={e => setEnd(e.target.value)} style={inp} /></Field>
        <Field label="Client"><select value={clientId} onChange={e => { setClientId(e.target.value); if (e.target.value) setRole('') }} style={inp}>
          <option value="">All clients</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select></Field>
        <Field label="Role / position"><select value={role} onChange={e => { setRole(e.target.value); if (e.target.value) setClientId('') }} style={inp}>
          <option value="">All roles</option>
          {roles.map(r => <option key={r} value={r}>{r}</option>)}
        </select></Field>
        <button className="btn btn-primary" onClick={run} disabled={loading} style={{ height: 36 }}>{loading ? 'Running…' : 'Run report'}</button>
        <button className="btn btn-ghost" onClick={exportCsv} disabled={!rows.length} style={{ height: 36 }}>⬇ Export CSV</button>
      </div>

      {/* mode toggle */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <ModeBtn on={mode === 'coverage'} onClick={() => setMode('coverage')}>Coverage (slots available / filled)</ModeBtn>
        <ModeBtn on={mode === 'roster'} onClick={() => setMode('roster')}>Roster (who was scheduled)</ModeBtn>
      </div>

      {err && <div style={{ color: 'var(--failed)', fontSize: 13, marginBottom: 10 }}>{err}</div>}

      <div className="card" style={{ padding: 0, overflow: 'auto' }}>
        {loading ? <p className="page-sub" style={{ padding: 20 }}>Loading…</p>
          : rows.length === 0 ? <p className="page-sub" style={{ padding: 20 }}>No scheduled data for these filters.</p>
          : mode === 'coverage' ? <CoverageTable rows={rows} /> : <RosterTable rows={rows} />}
      </div>
      {rows.length > 0 && <p className="page-sub" style={{ fontSize: 12, marginTop: 8 }}>{rows.length} rows · Slots Available = total scheduled capacity that hour.</p>}
    </div>
  )
}

function CoverageTable({ rows }) {
  return (
    <table style={tbl}>
      <thead><tr>{['Date', 'Day', 'Hour', 'Slots Available', 'Slots Filled', 'Slots Open', 'Fill %'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
      <tbody>
        {rows.map((r, i) => {
          const pct = r.available ? Math.round((r.filled / r.available) * 100) : 0
          return (
            <tr key={i} style={{ borderTop: '1px solid var(--line-soft)' }}>
              <td style={td}>{r.date}</td><td style={td}>{weekday(r.date)}</td><td style={tdC}>{hourLabel(r.hour)}</td>
              <td style={tdC}>{r.available}</td><td style={tdC}>{r.filled}</td><td style={tdC}>{r.open}</td>
              <td style={{ ...tdC, color: pct >= 100 ? 'var(--passed)' : pct >= 80 ? 'var(--needed)' : 'var(--failed)', fontWeight: 600 }}>{pct}%</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
function RosterTable({ rows }) {
  return (
    <table style={tbl}>
      <thead><tr>{['Date', 'Day', 'Hour', 'Agent', 'Role', 'Client'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} style={{ borderTop: '1px solid var(--line-soft)' }}>
            <td style={td}>{r.date}</td><td style={td}>{weekday(r.date)}</td><td style={tdC}>{hourLabel(r.hour)}</td>
            <td style={{ ...td, fontWeight: 600 }}>{r.agent}</td><td style={td}>{r.role}</td><td style={td}>{r.client}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Field({ label, children }) { return <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-soft)' }}>{label}</label>{children}</div> }
function ModeBtn({ on, onClick, children }) {
  return <button onClick={onClick} style={{ fontSize: 12.5, fontWeight: 600, padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', border: '1px solid ' + (on ? 'var(--accent)' : 'var(--line)'), background: on ? 'var(--accent)' : 'var(--surface)', color: on ? '#fff' : 'var(--ink)' }}>{children}</button>
}
const inp = { padding: '7px 9px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--ink)' }
const tbl = { width: '100%', borderCollapse: 'collapse', fontSize: 13 }
const th = { textAlign: 'left', padding: '10px 12px', background: 'var(--canvas)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em', color: 'var(--ink-soft)', position: 'sticky', top: 0 }
const td = { padding: '8px 12px' }
const tdC = { padding: '8px 12px', textAlign: 'center' }
