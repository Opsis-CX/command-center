// ============================================================================
//  SPRINT SCORECARD — the sheet's Sprint Scoreboard + Previous-Day Scorecard,
//  on one screen, calculated live (Brittney, 2026-09-23).
//
//  Top: the sprint to date against its goals. Bottom: the last working day by
//  setter, against the working day before it. Sprint dates, goals and the
//  bonus rate live in `sales_sprints` and are edited from "Sprint settings"
//  (this replaces the sheet's Config tab). Past sprints stay selectable.
//
//  Bonus: $15 (sprint setting) per qualified meeting that was HELD, credited to
//  whoever booked it. The invoice commission was deliberately left out.
// ============================================================================
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import {
  S, Tile, loadActivity, sumRows, todayET, prevWorkday, addDays, daysBetween, fmtDate, fmtMoney, pct,
} from '../lib/salesShared.jsx'

const ROWS = [
  { key: 'researched', label: 'Prospects researched' },
  { key: 'researched_a', label: '  A-tier researched' },
  { key: 'researched_b', label: '  B-tier researched' },
  { key: 'dials', label: 'Dials' },
  { key: 'emails', label: 'Emails sent' },
  { key: 'connections', label: 'Connections' },
  { key: 'connect_rate', label: 'Connect rate', rate: ['connections', 'dials'] },
  { key: 'callbacks', label: 'Callbacks' },
  { key: 'booked', label: 'Meetings booked', goal: 'meeting_goal' },
  { key: 'booking_rate', label: 'Booking rate', rate: ['booked', 'connections'] },
  { key: 'held', label: 'Meetings held' },
  { key: 'no_show', label: 'No-shows' },
  { key: 'qualified', label: 'Qualified meetings' },
  { key: 'proposals', label: 'Proposals sent' },
  { key: 'won', label: 'Contracts won', goal: 'contract_goal' },
]

function cell(tot, row) {
  if (row.rate) return pct(tot[row.rate[0]], tot[row.rate[1]])
  return (tot[row.key] || 0).toLocaleString()
}

export default function SalesScorecard() {
  const { appRole } = useAuth()
  const [sprints, setSprints] = useState(null)
  const [sprintId, setSprintId] = useState('')
  const [people, setPeople] = useState([])
  const [rows, setRows] = useState(null)
  const [dayRows, setDayRows] = useState(null)
  const [err, setErr] = useState('')
  const [editing, setEditing] = useState(null) // sprint object being edited (or {} for new)

  const today = todayET()
  const lastDay = prevWorkday(today)
  const priorDay = prevWorkday(lastDay)

  async function loadSprints(selectId) {
    const { data, error } = await supabase.from('sales_sprints').select('*').order('start_date', { ascending: false })
    if (error) { setErr(error.message); setSprints([]); return }
    setSprints(data || [])
    const current = (data || []).find(s => s.start_date <= today && s.end_date >= today) || (data || [])[0]
    setSprintId(selectId || current?.id || '')
  }
  useEffect(() => {
    loadSprints()
    supabase.from('profiles').select('id, full_name, role, is_active').order('full_name')
      .then(({ data }) => setPeople((data || []).filter(p => p.is_active !== false && p.role && !/agent|client/.test(p.role))))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const sprint = useMemo(() => (sprints || []).find(s => s.id === sprintId), [sprints, sprintId])

  useEffect(() => {
    if (!sprint) return
    let off = false
    setRows(null); setDayRows(null); setErr('')
    const end = sprint.end_date < today ? sprint.end_date : today
    Promise.all([loadActivity(sprint.start_date, end), loadActivity(priorDay, lastDay)])
      .then(([a, b]) => { if (!off) { setRows(a); setDayRows(b) } })
      .catch(e => { if (!off) { setErr(e.message || String(e)); setRows([]); setDayRows([]) } })
    return () => { off = true }
  }, [sprint?.id, sprint?.start_date, sprint?.end_date]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!sprints) return <p className="page-sub" style={{ padding: 20 }}>Loading scorecard…</p>

  const setters = (sprint?.setter_ids || []).map(id => ({ id, name: people.find(p => p.id === id)?.full_name || 'Setter' }))
  const all = rows ? sumRows(rows) : null
  const bySetter = Object.fromEntries(setters.map(s => [s.id, rows ? sumRows(rows, r => r.person_id === s.id) : null]))
  const dayTotal = (d, pid) => sumRows(dayRows || [], r => r.day === d && (!pid || r.person_id === pid))

  const sprintDay = sprint ? Math.min(daysBetween(sprint.start_date, today) + 1, daysBetween(sprint.start_date, sprint.end_date) + 1) : 0
  const sprintLen = sprint ? daysBetween(sprint.start_date, sprint.end_date) + 1 : 0
  const bonus = Number(sprint?.meeting_bonus || 0)
  const canEdit = ['admin', 'marketing', 'sales'].some(r => (appRole || '').includes(r))

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <h1 style={S.h1}>Sprint Scorecard</h1>
          <p className="page-sub" style={S.sub}>
            {sprint ? <>{fmtDate(sprint.start_date)} – {fmtDate(sprint.end_date)} · Day {Math.max(sprintDay, 0)} of {sprintLen}</> : 'No sprint set up yet'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {sprints.length > 0 && (
            <select id="sprint-picker" value={sprintId} onChange={e => setSprintId(e.target.value)} style={{ ...S.input, width: 'auto' }}>
              {sprints.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          {canEdit && sprint && <button style={S.btn} onClick={() => setEditing(sprint)}>⚙ Sprint settings</button>}
          {canEdit && <button style={S.btnPri} onClick={() => setEditing({})}>＋ New sprint</button>}
        </div>
      </div>

      {err && <div style={S.err}>{err}</div>}
      {sprint && !rows && <p className="page-sub">Loading…</p>}

      {sprint && all && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 16 }}>
            <Tile label="Contracts won" value={all.won} goal={sprint.contract_goal} goalLabel={sprint.contract_goal ? `Goal ${sprint.contract_goal}` : null} />
            <Tile label="Meetings booked" value={all.booked} goal={sprint.meeting_goal}
              goalLabel={sprint.meeting_goal ? `Goal ${sprint.meeting_goal}${sprint.meeting_stretch ? ` · stretch ${sprint.meeting_stretch}` : ''}` : null} />
            <Tile label="New monthly revenue" value={fmtMoney(all.won_value)}
              goalLabel={sprint.revenue_target ? `Target ${fmtMoney(sprint.revenue_target)}` : null} />
            <Tile label="New recurring hours" value={all.won_hours}
              goal={sprint.hours_target} goalLabel={sprint.hours_target ? `Target ${Number(sprint.hours_target).toLocaleString()} hrs` : null} />
            <Tile label="Show rate" value={pct(all.held, all.booked)} hint="Meetings held ÷ booked" />
            <Tile label="Close rate" value={pct(all.won, all.held)} hint="Won ÷ meetings held" />
            <Tile label="Qualified meetings" value={all.qualified} hint="Held and marked qualified" />
            <Tile label="Bonus earned" value={fmtMoney(all.qualified * bonus)} hint={`${fmtMoney(bonus)} × qualified meetings held`} />
          </div>

          <div style={{ ...S.card, marginBottom: 16, padding: '12px 6px' }}>
            <div style={{ padding: '0 10px 8px', display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>Sprint to date, by setter</h2>
              <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>"Everyone" includes activity by anyone on the pipeline, not just setters</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead><tr>
                  <th style={S.th}>Metric</th>
                  {setters.map(s => <th key={s.id} style={{ ...S.th, ...S.num }}>{s.name}</th>)}
                  <th style={{ ...S.th, ...S.num }}>Everyone</th>
                  <th style={{ ...S.th, ...S.num }}>Goal</th>
                  <th style={{ ...S.th, ...S.num }}>% to goal</th>
                  <th style={{ ...S.th, ...S.num }}>Bonus</th>
                </tr></thead>
                <tbody>
                  {ROWS.map(row => {
                    const goal = row.goal ? sprint[row.goal] : null
                    return (
                      <tr key={row.key}>
                        <td style={{ ...S.td, paddingLeft: row.label.startsWith('  ') ? 24 : 10, color: row.label.startsWith('  ') ? 'var(--ink-soft)' : undefined }}>{row.label.trim()}</td>
                        {setters.map(s => <td key={s.id} style={{ ...S.td, ...S.num }}>{bySetter[s.id] ? cell(bySetter[s.id], row) : '—'}</td>)}
                        <td style={{ ...S.td, ...S.num, fontWeight: 700 }}>{cell(all, row)}</td>
                        <td style={{ ...S.td, ...S.num }}>{goal ?? ''}</td>
                        <td style={{ ...S.td, ...S.num }}>{goal ? pct(all[row.key], goal) : ''}</td>
                        <td style={{ ...S.td, ...S.num }}>{row.key === 'qualified' ? fmtMoney(all.qualified * bonus) : ''}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {setters.length === 0 && <p className="page-sub" style={{ padding: '8px 10px 0', fontSize: 12.5 }}>No setters picked for this sprint — add them in Sprint settings.</p>}
          </div>

          <div style={{ ...S.card, padding: '12px 6px' }}>
            <div style={{ padding: '0 10px 8px' }}>
              <h2 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>Last working day — {fmtDate(lastDay, { weekday: 'long', month: 'short', day: 'numeric' })}</h2>
              <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Compared with {fmtDate(priorDay, { weekday: 'long', month: 'short', day: 'numeric' })}</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead><tr>
                  <th style={S.th}>Metric</th>
                  {setters.map(s => <th key={s.id} style={{ ...S.th, ...S.num }}>{s.name}</th>)}
                  <th style={{ ...S.th, ...S.num }}>Everyone</th>
                  <th style={{ ...S.th, ...S.num }}>Prior day</th>
                  <th style={{ ...S.th, ...S.num }}>Change</th>
                  <th style={{ ...S.th, ...S.num }}>% change</th>
                </tr></thead>
                <tbody>
                  {ROWS.filter(r => !['no_show', 'proposals'].includes(r.key)).map(row => {
                    const d1 = dayTotal(lastDay), d0 = dayTotal(priorDay)
                    const isRate = !!row.rate
                    const a = isRate ? null : d1[row.key], b = isRate ? null : d0[row.key]
                    const delta = isRate ? null : a - b
                    return (
                      <tr key={row.key}>
                        <td style={{ ...S.td, paddingLeft: row.label.startsWith('  ') ? 24 : 10, color: row.label.startsWith('  ') ? 'var(--ink-soft)' : undefined }}>{row.label.trim()}</td>
                        {setters.map(s => <td key={s.id} style={{ ...S.td, ...S.num }}>{cell(dayTotal(lastDay, s.id), row)}</td>)}
                        <td style={{ ...S.td, ...S.num, fontWeight: 700 }}>{cell(d1, row)}</td>
                        <td style={{ ...S.td, ...S.num }}>{cell(d0, row)}</td>
                        <td style={{ ...S.td, ...S.num, color: delta > 0 ? '#1f8a53' : delta < 0 ? '#c0392b' : undefined }}>{isRate ? '' : (delta > 0 ? '+' : '') + delta}</td>
                        <td style={{ ...S.td, ...S.num }}>{isRate || !b ? '' : Math.round((delta / b) * 100) + '%'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {sprints.length === 0 && !err && (
        <div style={S.card}><p style={{ margin: 0 }}>No sprints yet. Use <b>New sprint</b> to set the dates and goals.</p></div>
      )}

      {editing && (
        <SprintSettings sprint={editing} people={people}
          onClose={() => setEditing(null)}
          onSaved={id => { setEditing(null); loadSprints(id) }} />
      )}
    </div>
  )
}

function SprintSettings({ sprint, people, onClose, onSaved }) {
  const isNew = !sprint.id
  const today = todayET()
  const [f, setF] = useState(() => isNew ? {
    name: '', start_date: today, end_date: addDays(today, 29), meeting_goal: 20, meeting_stretch: 25,
    contract_goal: 3, revenue_target: '', hours_target: '', meeting_bonus: 15, setter_ids: [],
  } : { ...sprint })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))
  const toggle = id => setF(x => ({ ...x, setter_ids: x.setter_ids.includes(id) ? x.setter_ids.filter(i => i !== id) : [...x.setter_ids, id] }))

  async function save(e) {
    e.preventDefault()
    if (!f.name.trim()) { setErr('Give the sprint a name.'); return }
    if (f.end_date < f.start_date) { setErr('The end date is before the start date.'); return }
    const num = v => (v === '' || v == null ? null : Number(v))
    const row = {
      name: f.name.trim(), start_date: f.start_date, end_date: f.end_date,
      meeting_goal: num(f.meeting_goal), meeting_stretch: num(f.meeting_stretch), contract_goal: num(f.contract_goal),
      revenue_target: num(f.revenue_target), hours_target: num(f.hours_target), meeting_bonus: num(f.meeting_bonus) ?? 0,
      setter_ids: f.setter_ids,
    }
    setBusy(true); setErr('')
    const res = isNew
      ? await supabase.from('sales_sprints').insert(row).select('id').single()
      : await supabase.from('sales_sprints').update(row).eq('id', sprint.id).select('id').single()
    setBusy(false)
    if (res.error) { setErr(res.error.message); return }
    onSaved(res.data.id)
  }

  const fld = (label, k, type = 'number', extra = {}) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={S.label}>{label}</span>
      <input id={`sprint-${k}`} type={type} value={f[k] ?? ''} onChange={set(k)} style={S.input} {...extra} />
    </label>
  )

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 60, padding: 24, overflowY: 'auto' }}>
      <form onClick={e => e.stopPropagation()} onSubmit={save}
        style={{ background: 'var(--surface)', color: 'var(--ink)', borderRadius: 14, width: 'min(620px, 100%)', padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{isNew ? 'New sprint' : 'Sprint settings'}</h2>
        {err && <div style={{ ...S.err, margin: 0 }}>{err}</div>}
        {fld('Sprint name', 'name', 'text', { placeholder: 'October 2026 Sprint', autoFocus: isNew })}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {fld('Start date', 'start_date', 'date')}
          {fld('End date', 'end_date', 'date')}
          {fld('Meeting goal', 'meeting_goal')}
          {fld('Meeting stretch goal', 'meeting_stretch')}
          {fld('Contract goal', 'contract_goal')}
          {fld('Bonus per qualified meeting ($)', 'meeting_bonus', 'number', { step: '0.01' })}
          {fld('New monthly revenue target ($)', 'revenue_target', 'number', { step: '0.01' })}
          {fld('New recurring hours target', 'hours_target')}
        </div>
        <div>
          <span style={S.label}>Setters on this sprint</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
            {people.map(p => (
              <label key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, border: '1px solid var(--line)', borderRadius: 99, padding: '4px 10px', cursor: 'pointer',
                background: f.setter_ids.includes(p.id) ? 'var(--accent-bg, #e5f1f8)' : 'var(--surface)' }}>
                <input id={`setter-${p.id}`} type="checkbox" checked={f.setter_ids.includes(p.id)} onChange={() => toggle(p.id)} />
                {p.full_name}
              </label>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" style={S.btn} onClick={onClose}>Cancel</button>
          <button type="submit" style={S.btnPri} disabled={busy}>{busy ? 'Saving…' : isNew ? 'Create sprint' : 'Save changes'}</button>
        </div>
      </form>
    </div>
  )
}
