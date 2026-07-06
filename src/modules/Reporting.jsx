import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

// ============================================================
// REPORTING — task-time reporting for payroll + invoicing.
// Pulls time_entries (with duration), joins task -> client,
// and rolls up by PERSON (payroll) or CLIENT (invoicing)
// over a chosen date range. Hours only; export to CSV.
// ============================================================

function hoursFromMinutes(min) { return Math.round((min / 60) * 100) / 100 }

function csvEscape(v) {
  if (v === null || v === undefined) return ''
  const s = String(v).replace(/"/g, '""')
  return /[",\n]/.test(s) ? `"${s}"` : s
}
function downloadCSV(filename, rows) {
  const csv = rows.map(r => r.map(csvEscape).join(',')).join('\r\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// default range = current week (Mon–Sun)
function defaultRange() {
  const now = new Date()
  const day = (now.getDay() + 6) % 7 // 0 = Monday
  const monday = new Date(now); monday.setDate(now.getDate() - day)
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)
  const iso = d => d.toISOString().slice(0, 10)
  return { from: iso(monday), to: iso(sunday) }
}

export default function Reporting() {
  const { isAdmin } = useAuth()
  const [range, setRange] = useState(defaultRange())
  const [view, setView] = useState('person') // 'person' | 'client'
  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState([])
  const [profiles, setProfiles] = useState([])
  const [tasks, setTasks] = useState([])
  const [clients, setClients] = useState([])

  const load = useCallback(async () => {
    setLoading(true)
    // inclusive of the whole 'to' day
    const fromISO = new Date(range.from + 'T00:00:00').toISOString()
    const toISO = new Date(range.to + 'T23:59:59').toISOString()
    const [teRes, profRes, taskRes, cliRes] = await Promise.all([
      supabase.from('time_entries').select('*')
        .not('duration_minutes', 'is', null)
        .gte('started_at', fromISO).lte('started_at', toISO),
      supabase.from('profiles').select('id, full_name'),
      supabase.from('tasks').select('id, name, client_id'),
      supabase.from('clients').select('id, name'),
    ])
    setEntries(teRes.data || [])
    setProfiles(profRes.data || [])
    setTasks(taskRes.data || [])
    setClients(cliRes.data || [])
    setLoading(false)
  }, [range.from, range.to])

  useEffect(() => { load() }, [load])

  const nameOf = useCallback((id, list) => (list.find(x => x.id === id) || {}).full_name || (list.find(x => x.id === id) || {}).name || '—', [])
  const clientOfTask = useCallback((taskId) => {
    const t = tasks.find(x => x.id === taskId)
    if (!t || !t.client_id) return null
    return clients.find(c => c.id === t.client_id) || null
  }, [tasks, clients])

  // Build: person -> client -> minutes
  const grouped = useMemo(() => {
    const byPerson = {}   // personId -> { total, clients: {clientKey: minutes} }
    const byClient = {}   // clientId -> { total, people: {personId: minutes} }
    const clientLabel = {}
    for (const e of entries) {
      const min = e.duration_minutes || 0
      if (!min) continue
      const cl = clientOfTask(e.task_id)
      const clientKey = cl ? cl.id : '__none__'
      clientLabel[clientKey] = cl ? cl.name : 'No client'

      if (!byPerson[e.user_id]) byPerson[e.user_id] = { total: 0, clients: {} }
      byPerson[e.user_id].total += min
      byPerson[e.user_id].clients[clientKey] = (byPerson[e.user_id].clients[clientKey] || 0) + min

      if (!byClient[clientKey]) byClient[clientKey] = { total: 0, people: {} }
      byClient[clientKey].total += min
      byClient[clientKey].people[e.user_id] = (byClient[clientKey].people[e.user_id] || 0) + min
    }
    return { byPerson, byClient, clientLabel }
  }, [entries, clientOfTask])

  const grandTotal = useMemo(() => hoursFromMinutes(entries.reduce((s, e) => s + (e.duration_minutes || 0), 0)), [entries])

  // task name lookup
  const taskName = useCallback((taskId) => {
    const t = tasks.find(x => x.id === taskId)
    return t ? t.name : '(deleted task)'
  }, [tasks])

  // Build task-level line items for exports: one row per person+task
  // (client derived from the task), with summed hours.
  const lineItems = useMemo(() => {
    // key: personId||taskId -> { personId, taskId, clientKey, minutes }
    const map = {}
    for (const e of entries) {
      const min = e.duration_minutes || 0
      if (!min) continue
      const cl = clientOfTask(e.task_id)
      const clientKey = cl ? cl.id : '__none__'
      const key = e.user_id + '||' + e.task_id
      if (!map[key]) map[key] = { personId: e.user_id, taskId: e.task_id, clientKey, minutes: 0 }
      map[key].minutes += min
    }
    return Object.values(map)
  }, [entries, clientOfTask])

  function exportPersonCSV() {
    const header = ['Person', 'Client', 'Task', 'Hours']
    const rows = [header]
    // group line items by person, then client, then task
    const byPerson = {}
    lineItems.forEach(li => {
      ;(byPerson[li.personId] = byPerson[li.personId] || []).push(li)
    })
    Object.keys(byPerson)
      .sort((a, b) => nameOf(a, profiles).localeCompare(nameOf(b, profiles)))
      .forEach(pid => {
        const items = byPerson[pid].sort((a, b) => {
          const ca = grouped.clientLabel[a.clientKey] || '', cb = grouped.clientLabel[b.clientKey] || ''
          return ca.localeCompare(cb) || taskName(a.taskId).localeCompare(taskName(b.taskId))
        })
        items.forEach(li => {
          rows.push([nameOf(pid, profiles), grouped.clientLabel[li.clientKey], taskName(li.taskId), hoursFromMinutes(li.minutes)])
        })
        rows.push([nameOf(pid, profiles), 'TOTAL', '', hoursFromMinutes(grouped.byPerson[pid].total)])
      })
    downloadCSV(`payroll-hours-${range.from}_to_${range.to}.csv`, rows)
  }

  function exportClientCSV() {
    const header = ['Client', 'Person', 'Task', 'Hours']
    const rows = [header]
    // group line items by client, then person, then task
    const byClient = {}
    lineItems.forEach(li => {
      ;(byClient[li.clientKey] = byClient[li.clientKey] || []).push(li)
    })
    Object.keys(byClient)
      .sort((a, b) => (grouped.clientLabel[a] || '').localeCompare(grouped.clientLabel[b] || ''))
      .forEach(ck => {
        const items = byClient[ck].sort((a, b) => {
          const pa = nameOf(a.personId, profiles), pb = nameOf(b.personId, profiles)
          return pa.localeCompare(pb) || taskName(a.taskId).localeCompare(taskName(b.taskId))
        })
        items.forEach(li => {
          rows.push([grouped.clientLabel[ck], nameOf(li.personId, profiles), taskName(li.taskId), hoursFromMinutes(li.minutes)])
        })
        rows.push([grouped.clientLabel[ck], 'TOTAL', '', hoursFromMinutes(grouped.byClient[ck].total)])
      })
    downloadCSV(`invoicing-hours-${range.from}_to_${range.to}.csv`, rows)
  }

  if (!isAdmin) return <p className="page-sub">You don't have access to reporting.</p>

  const personRows = Object.entries(grouped.byPerson)
    .sort((a, b) => nameOf(a[0], profiles).localeCompare(nameOf(b[0], profiles)))
  const clientRows = Object.entries(grouped.byClient)
    .sort((a, b) => (grouped.clientLabel[a[0]] || '').localeCompare(grouped.clientLabel[b[0]] || ''))

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 className="page-title">Reporting</h1>
        <p className="page-sub">Tracked task time by person (payroll) and by client (invoicing). Hours only — apply your own rates.</p>
      </div>

      {/* controls */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={lbl}>From</label>
          <input type="date" value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} style={inp} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={lbl}>To</label>
          <input type="date" value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} style={inp} />
        </div>
        <div style={{ display: 'flex', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
          <button onClick={() => setView('person')} style={tabBtn(view === 'person')}>By Person (Payroll)</button>
          <button onClick={() => setView('client')} style={tabBtn(view === 'client')}>By Client (Invoicing)</button>
        </div>
        <button className="btn btn-primary" style={{ marginLeft: 'auto' }}
          onClick={view === 'person' ? exportPersonCSV : exportClientCSV}>
          Export {view === 'person' ? 'Payroll' : 'Invoicing'} CSV
        </button>
      </div>

      {loading ? <p className="page-sub">Loading…</p> : (
        <>
          <div className="card" style={{ padding: '12px 16px', marginBottom: 16, display: 'inline-block' }}>
            <span style={{ fontSize: 12, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600 }}>Total tracked</span>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{grandTotal} hrs</div>
          </div>

          {entries.length === 0 ? (
            <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--ink-soft)' }}>
              <h3 style={{ fontSize: 14, marginBottom: 4 }}>No tracked time in this range</h3>
              <p style={{ fontSize: 13 }}>Time entries logged on tasks between these dates will appear here.</p>
            </div>
          ) : view === 'person' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {personRows.map(([pid, data]) => (
                <div key={pid} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 15, fontWeight: 600 }}>{nameOf(pid, profiles)}</span>
                    <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)' }}>{hoursFromMinutes(data.total)} hrs</span>
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <tbody>
                      {Object.entries(data.clients)
                        .sort((a, b) => (grouped.clientLabel[a[0]] || '').localeCompare(grouped.clientLabel[b[0]] || ''))
                        .map(([ck, min]) => (
                          <React.Fragment key={ck}>
                            <tr>
                              <td style={{ ...cellL, fontWeight: 600 }}>{grouped.clientLabel[ck]}</td>
                              <td style={cellR}>{hoursFromMinutes(min)} hrs</td>
                            </tr>
                            {lineItems.filter(li => li.personId === pid && li.clientKey === ck)
                              .sort((a, b) => taskName(a.taskId).localeCompare(taskName(b.taskId)))
                              .map(li => (
                                <tr key={li.taskId}>
                                  <td style={{ ...cellL, paddingLeft: 32, color: 'var(--ink-soft)', fontSize: 12 }}>{taskName(li.taskId)}</td>
                                  <td style={{ ...cellR, color: 'var(--ink-soft)', fontWeight: 500, fontSize: 12 }}>{hoursFromMinutes(li.minutes)} hrs</td>
                                </tr>
                              ))}
                          </React.Fragment>
                        ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {clientRows.map(([ck, data]) => (
                <div key={ck} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 15, fontWeight: 600 }}>{grouped.clientLabel[ck]}</span>
                    <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)' }}>{hoursFromMinutes(data.total)} hrs</span>
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <tbody>
                      {Object.entries(data.people)
                        .sort((a, b) => nameOf(a[0], profiles).localeCompare(nameOf(b[0], profiles)))
                        .map(([pid, min]) => (
                          <React.Fragment key={pid}>
                            <tr>
                              <td style={{ ...cellL, fontWeight: 600 }}>{nameOf(pid, profiles)}</td>
                              <td style={cellR}>{hoursFromMinutes(min)} hrs</td>
                            </tr>
                            {lineItems.filter(li => li.clientKey === ck && li.personId === pid)
                              .sort((a, b) => taskName(a.taskId).localeCompare(taskName(b.taskId)))
                              .map(li => (
                                <tr key={li.taskId}>
                                  <td style={{ ...cellL, paddingLeft: 32, color: 'var(--ink-soft)', fontSize: 12 }}>{taskName(li.taskId)}</td>
                                  <td style={{ ...cellR, color: 'var(--ink-soft)', fontWeight: 500, fontSize: 12 }}>{hoursFromMinutes(li.minutes)} hrs</td>
                                </tr>
                              ))}
                          </React.Fragment>
                        ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

const lbl = { fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)' }
const inp = { padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--ink)' }
const cellL = { padding: '9px 16px', borderBottom: '1px solid var(--line-soft)', fontSize: 13 }
const cellR = { padding: '9px 16px', borderBottom: '1px solid var(--line-soft)', fontSize: 13, fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap' }
function tabBtn(active) {
  return { padding: '8px 14px', border: 0, background: active ? 'var(--accent)' : 'var(--surface)', color: active ? '#fff' : 'var(--ink-soft)', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit' }
}
