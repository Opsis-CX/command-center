import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { ROLES } from '../lib/permissions'

const ROLE_LABELS = Object.fromEntries(ROLES.map(r => [r.key, r.label]))

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
  const [view, setView] = useState('person') // 'person' | 'client' | 'compare'
  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState([])
  const [profiles, setProfiles] = useState([])
  const [tasks, setTasks] = useState([])
  const [clients, setClients] = useState([])
  const [claims, setClaims] = useState([])
  const [sblocks, setSblocks] = useState([])
  const [qaAudits, setQaAudits] = useState([])
  // People & Tags report data — a current snapshot, independent of the date range.
  const [peopleFull, setPeopleFull] = useState([])
  const [tags, setTags] = useState([])
  const [taggables, setTaggables] = useState([])

  useEffect(() => {
    let active = true
    ;(async () => {
      const [pRes, tRes, tgRes] = await Promise.all([
        supabase.from('profiles').select('id, full_name, email, phone, role, is_active, inactive_reason, deactivated_at, created_at').order('full_name'),
        supabase.from('tags').select('id, name').order('name'),
        supabase.from('taggables').select('tag_id, entity_id').eq('entity_type', 'profile'),
      ])
      if (!active) return
      setPeopleFull(pRes.data || [])
      setTags(tRes.data || [])
      setTaggables(tgRes.data || [])
    })()
    return () => { active = false }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    // inclusive of the whole 'to' day
    const fromISO = new Date(range.from + 'T00:00:00').toISOString()
    const toISO = new Date(range.to + 'T23:59:59').toISOString()
    const [teRes, profRes, taskRes, cliRes, clmRes, blkRes, qaRes] = await Promise.all([
      supabase.from('time_entries').select('*')
        .not('duration_minutes', 'is', null)
        .gte('started_at', fromISO).lte('started_at', toISO),
      supabase.from('profiles').select('id, full_name'),
      supabase.from('tasks').select('id, name, client_id'),
      supabase.from('clients').select('id, name'),
      supabase.from('shift_claims').select('id, shift_block_id, profile_id, status, checked_in_at, checked_out_at'),
      supabase.from('shift_blocks').select('id, block_date, start_time, end_time'),
      supabase.from('qa_audits').select('*').gte('created_at', fromISO).lte('created_at', toISO),
    ])
    setEntries(teRes.data || [])
    setProfiles(profRes.data || [])
    setTasks(taskRes.data || [])
    setClients(cliRes.data || [])
    setQaAudits(qaRes.error ? [] : (qaRes.data || []))
    // keep only claims whose block falls in range
    const blocks = blkRes.data || []
    const inRange = (blocks).filter(b => b.block_date >= range.from && b.block_date <= range.to)
    const inRangeIds = new Set(inRange.map(b => b.id))
    setSblocks(inRange)
    setClaims((clmRes.data || []).filter(c => inRangeIds.has(c.shift_block_id)))
    setLoading(false)
  }, [range.from, range.to])

  useEffect(() => { load() }, [load])

  const nameOf = useCallback((id, list) => (list.find(x => x.id === id) || {}).full_name || (list.find(x => x.id === id) || {}).name || '—', [])
  // Client for a time entry: meetings carry client_id directly; task timers
  // derive the client from their task.
  const clientOfEntry = useCallback((e) => {
    if (e.client_id) return clients.find(c => c.id === e.client_id) || null
    const t = tasks.find(x => x.id === e.task_id)
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
      const cl = clientOfEntry(e)
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
  }, [entries, clientOfEntry])

  const grandTotal = useMemo(() => hoursFromMinutes(entries.reduce((s, e) => s + (e.duration_minutes || 0), 0)), [entries])

  // COMPARE: per-person scheduled vs clock vs task minutes
  const comparison = useMemo(() => {
    const blockById = {}
    for (const b of sblocks) blockById[b.id] = b
    const mins = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000))
    const schedMinsOf = (b) => {
      if (!b) return 0
      const [sh, sm] = b.start_time.slice(0, 5).split(':').map(Number)
      const [eh, em] = b.end_time.slice(0, 5).split(':').map(Number)
      return Math.max(0, (eh * 60 + em) - (sh * 60 + sm))
    }
    const per = {} // personId -> {sched, clock, task, pending}
    const ensure = (pid) => (per[pid] = per[pid] || { sched: 0, clock: 0, task: 0, pending: 0 })
    // scheduled + clock from claims
    for (const c of claims) {
      if (c.status === 'no_show') continue
      const b = blockById[c.shift_block_id]
      ensure(c.profile_id).sched += schedMinsOf(b)
      // Only 'completed' and 'approved' clock time counts for payroll.
      // 'pending_review' (out-of-window or never-checked-out) is excluded until an admin approves it.
      if (c.checked_in_at && c.checked_out_at) {
        if (c.status === 'completed' || c.status === 'approved') {
          ensure(c.profile_id).clock += mins(c.checked_in_at, c.checked_out_at)
        } else if (c.status === 'pending_review') {
          ensure(c.profile_id).pending += 1
        }
      } else if (c.checked_in_at && !c.checked_out_at) {
        ensure(c.profile_id).pending += 1   // forgot to check out
      }
    }
    // task minutes from time_entries
    for (const e of entries) ensure(e.user_id).task += (e.duration_minutes || 0)
    return per
  }, [claims, sblocks, entries])

  // task name lookup
  const taskName = useCallback((taskId) => {
    const t = tasks.find(x => x.id === taskId)
    return t ? t.name : '(deleted task)'
  }, [tasks])

  // Label for a line item: task timers show the task name; meetings (no task)
  // show the meeting title captured in the entry note.
  const itemLabel = useCallback((li) => (
    li.isMeeting ? (li.label || 'Meeting') : taskName(li.taskId)
  ), [taskName])

  // Build line items for exports/rows. Task timers roll up per person+task;
  // each meeting is its own line (keyed by entry id) so titles stay distinct.
  const lineItems = useMemo(() => {
    const map = {}
    for (const e of entries) {
      const min = e.duration_minutes || 0
      if (!min) continue
      const cl = clientOfEntry(e)
      const clientKey = cl ? cl.id : '__none__'
      const isMeeting = !e.task_id
      const itemKey = isMeeting ? ('m:' + e.id) : ('t:' + e.task_id)
      const key = e.user_id + '||' + itemKey
      if (!map[key]) map[key] = { personId: e.user_id, taskId: e.task_id, itemKey, isMeeting, label: isMeeting ? (e.note || 'Meeting') : null, clientKey, minutes: 0 }
      map[key].minutes += min
    }
    return Object.values(map)
  }, [entries, clientOfEntry])

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
          return ca.localeCompare(cb) || itemLabel(a).localeCompare(itemLabel(b))
        })
        items.forEach(li => {
          rows.push([nameOf(pid, profiles), grouped.clientLabel[li.clientKey], itemLabel(li) + (li.isMeeting ? ' (meeting)' : ''), hoursFromMinutes(li.minutes)])
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
          return pa.localeCompare(pb) || itemLabel(a).localeCompare(itemLabel(b))
        })
        items.forEach(li => {
          rows.push([grouped.clientLabel[ck], nameOf(li.personId, profiles), itemLabel(li) + (li.isMeeting ? ' (meeting)' : ''), hoursFromMinutes(li.minutes)])
        })
        rows.push([grouped.clientLabel[ck], 'TOTAL', '', hoursFromMinutes(grouped.byClient[ck].total)])
      })
    downloadCSV(`invoicing-hours-${range.from}_to_${range.to}.csv`, rows)
  }

  function exportCompareCSV() {
    const header = ['Person', 'Scheduled hrs', 'Clock hrs', 'Task hrs', 'Clock − Scheduled', 'Clock − Task']
    const rows = [header]
    compareRows.forEach(([pid, d]) => {
      rows.push([
        nameOf(pid, profiles),
        hoursFromMinutes(d.sched), hoursFromMinutes(d.clock), hoursFromMinutes(d.task),
        hoursFromMinutes(d.clock - d.sched), hoursFromMinutes(d.clock - d.task),
      ])
    })
    downloadCSV(`scheduled-vs-worked-${range.from}_to_${range.to}.csv`, rows)
  }

  // QUALITY: per-agent QA rollup over the range (conversation audits carry the 0-100 score)
  const qaByAgent = useMemo(() => {
    const m = {}
    for (const a of qaAudits) {
      const key = a.agent_name || '—'
      if (!m[key]) m[key] = { total: 0, conv: 0, convScoreSum: 0, autoFails: 0, byType: {} }
      m[key].total += 1
      m[key].byType[a.audit_type] = (m[key].byType[a.audit_type] || 0) + 1
      if (a.auto_fail) m[key].autoFails += 1
      if (a.audit_type === 'conversation' && a.clean_qa_score != null) {
        m[key].conv += 1
        m[key].convScoreSum += Number(a.clean_qa_score)
      }
    }
    return Object.entries(m)
      .map(([name, d]) => ({
        name,
        audits: d.total,
        convAudits: d.conv,
        avgScore: d.conv ? Math.round(d.convScoreSum / d.conv) : null,
        autoFails: d.autoFails,
        byType: d.byType,
      }))
      .sort((a, b) => (b.avgScore ?? -1) - (a.avgScore ?? -1) || a.name.localeCompare(b.name))
  }, [qaAudits])

  const qaTotals = useMemo(() => {
    const conv = qaAudits.filter(a => a.audit_type === 'conversation' && a.clean_qa_score != null)
    const avg = conv.length ? Math.round(conv.reduce((s, a) => s + Number(a.clean_qa_score), 0) / conv.length) : null
    return { audits: qaAudits.length, avg, autoFails: qaAudits.filter(a => a.auto_fail).length }
  }, [qaAudits])

  function exportQualityCSV() {
    const header = ['Agent', 'Audits', 'Conversation audits', 'Avg clean score %', 'Auto-fails']
    const rows = [header]
    qaByAgent.forEach(a => {
      rows.push([a.name, a.audits, a.convAudits, a.avgScore == null ? '' : a.avgScore, a.autoFails])
    })
    downloadCSV(`quality-${range.from}_to_${range.to}.csv`, rows)
  }

  // ---- People & Tags report (current snapshot) ----
  const tagNameOf = useCallback((id) => (tags.find(t => t.id === id) || {}).name || '—', [tags])
  const tagsForPerson = useCallback((pid) =>
    taggables.filter(t => t.entity_id === pid).map(t => tagNameOf(t.tag_id)).sort((a, b) => a.localeCompare(b))
  , [taggables, tagNameOf])

  const peopleReport = useMemo(() => {
    const people = peopleFull
    const total = people.length
    const active = people.filter(p => p.is_active).length
    const byRole = {}
    for (const p of people) {
      const r = p.role || '—'
      byRole[r] = byRole[r] || { total: 0, active: 0, inactive: 0 }
      byRole[r].total++
      if (p.is_active) byRole[r].active++; else byRole[r].inactive++
    }
    const tagCount = {}
    for (const t of tags) tagCount[t.id] = 0
    const tagged = new Set()
    for (const tg of taggables) {
      if (tagCount[tg.tag_id] != null) tagCount[tg.tag_id]++
      tagged.add(tg.entity_id)
    }
    const untagged = people.filter(p => !tagged.has(p.id))
    const emptyTags = tags.filter(t => (tagCount[t.id] || 0) === 0)
    const inactiveList = people.filter(p => !p.is_active)
      .sort((a, b) => (b.deactivated_at || '').localeCompare(a.deactivated_at || ''))
    const reasonCount = {}
    for (const p of inactiveList) { const r = p.inactive_reason || 'Unspecified'; reasonCount[r] = (reasonCount[r] || 0) + 1 }
    return { total, active, inactive: total - active, byRole, tagCount, untagged, emptyTags, inactiveList, reasonCount }
  }, [peopleFull, tags, taggables])

  function exportPeopleCSV() {
    const header = ['Name', 'Email', 'Phone', 'Role', 'Status', 'Inactive reason', 'Deactivated', 'Tags']
    const rows = [header]
    peopleFull.slice().sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '')).forEach(p => {
      rows.push([
        p.full_name || '', p.email || '', p.phone || '', p.role || '',
        p.is_active ? 'Active' : 'Inactive',
        p.is_active ? '' : (p.inactive_reason || ''),
        p.deactivated_at ? new Date(p.deactivated_at).toLocaleDateString() : '',
        tagsForPerson(p.id).join('; '),
      ])
    })
    downloadCSV(`people-and-tags-${range.to}.csv`, rows)
  }

  const personRows = Object.entries(grouped.byPerson)
    .sort((a, b) => nameOf(a[0], profiles).localeCompare(nameOf(b[0], profiles)))
  const clientRows = Object.entries(grouped.byClient)
    .sort((a, b) => (grouped.clientLabel[a[0]] || '').localeCompare(grouped.clientLabel[b[0]] || ''))
  const compareRows = Object.entries(comparison)
    .sort((a, b) => nameOf(a[0], profiles).localeCompare(nameOf(b[0], profiles)))

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 className="page-title">Reporting</h1>
        <p className="page-sub">Tracked task &amp; meeting time by person (payroll) and by client (invoicing). Client meetings sync automatically from Fathom. Hours only — apply your own rates.</p>
      </div>

      {/* controls */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 20 }}>
        {view !== 'people' && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={lbl}>From</label>
              <input type="date" value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} style={inp} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={lbl}>To</label>
              <input type="date" value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} style={inp} />
            </div>
          </>
        )}
        <div style={{ display: 'flex', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden', flexWrap: 'wrap' }}>
          <button onClick={() => setView('person')} style={tabBtn(view === 'person')}>By Person (Payroll)</button>
          <button onClick={() => setView('client')} style={tabBtn(view === 'client')}>By Client (Invoicing)</button>
          <button onClick={() => setView('compare')} style={tabBtn(view === 'compare')}>Scheduled vs Worked</button>
          <button onClick={() => setView('quality')} style={tabBtn(view === 'quality')}>Quality</button>
          <button onClick={() => setView('people')} style={tabBtn(view === 'people')}>People</button>
          <button onClick={() => setView('schedule')} style={tabBtn(view === 'schedule')}>Schedule Hours</button>
          <button onClick={() => setView('support')} style={tabBtn(view === 'support')}>Support</button>
          <button onClick={() => setView('projects')} style={tabBtn(view === 'projects')}>Projects</button>
          <button onClick={() => setView('attendance')} style={tabBtn(view === 'attendance')}>Attendance</button>
        </div>
        {!['schedule', 'support', 'projects', 'attendance'].includes(view) && (
          <button className="btn btn-primary" style={{ marginLeft: 'auto' }}
            onClick={view === 'person' ? exportPersonCSV : view === 'client' ? exportClientCSV : view === 'quality' ? exportQualityCSV : view === 'people' ? exportPeopleCSV : exportCompareCSV}>
            Export {view === 'person' ? 'Payroll' : view === 'client' ? 'Invoicing' : view === 'quality' ? 'Quality' : view === 'people' ? 'Roster' : 'Comparison'} CSV
          </button>
        )}
      </div>

      {view === 'schedule' ? <ScheduleHoursView range={range} setRange={setRange} />
        : view === 'support' ? <SupportReport range={range} />
        : view === 'projects' ? <ProjectsReport range={range} />
        : view === 'attendance' ? <AttendanceReport range={range} />
        : loading ? <p className="page-sub">Loading…</p> : view === 'quality' ? (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <div className="card" style={{ padding: '12px 16px' }}>
              <span style={{ fontSize: 12, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600 }}>Total audits</span>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{qaTotals.audits}</div>
            </div>
            <div className="card" style={{ padding: '12px 16px' }}>
              <span style={{ fontSize: 12, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600 }}>Avg clean score</span>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{qaTotals.avg == null ? '—' : qaTotals.avg + '%'}</div>
            </div>
            <div className="card" style={{ padding: '12px 16px' }}>
              <span style={{ fontSize: 12, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600 }}>Auto-fails</span>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{qaTotals.autoFails}</div>
            </div>
          </div>

          {qaByAgent.length === 0 ? (
            <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--ink-soft)' }}>
              <h3 style={{ fontSize: 14, marginBottom: 4 }}>No audits in this range</h3>
              <p style={{ fontSize: 13 }}>QA audits recorded between these dates will appear here.</p>
            </div>
          ) : (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--line)' }}>
                    <th style={{ ...cellL, fontWeight: 700 }}>Agent</th>
                    <th style={{ ...cellR, fontWeight: 700 }}>Audits</th>
                    <th style={{ ...cellR, fontWeight: 700 }}>Conversation</th>
                    <th style={{ ...cellR, fontWeight: 700 }}>Avg score</th>
                    <th style={{ ...cellR, fontWeight: 700 }}>Auto-fails</th>
                  </tr>
                </thead>
                <tbody>
                  {qaByAgent.map(a => {
                    const col = a.avgScore == null ? 'var(--ink-soft)'
                      : a.avgScore >= 90 ? 'var(--passed)'
                      : a.avgScore >= 80 ? 'var(--accent)'
                      : a.avgScore >= 70 ? 'var(--needed)' : 'var(--failed)'
                    return (
                      <tr key={a.name} style={{ borderBottom: '1px solid var(--line-soft)' }}>
                        <td style={{ ...cellL, fontWeight: 600 }}>{a.name}</td>
                        <td style={cellR}>{a.audits}</td>
                        <td style={cellR}>{a.convAudits}</td>
                        <td style={{ ...cellR, color: col, fontWeight: 700 }}>{a.avgScore == null ? '—' : a.avgScore + '%'}</td>
                        <td style={{ ...cellR, color: a.autoFails ? 'var(--failed)' : 'var(--ink-soft)' }}>{a.autoFails || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : view === 'people' ? (
        <>
          {/* headcount tiles */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            {[['People', peopleReport.total], ['Active', peopleReport.active], ['Inactive', peopleReport.inactive], ['Untagged', peopleReport.untagged.length]].map(([k, v]) => (
              <div key={k} className="card" style={{ padding: '12px 16px', minWidth: 110 }}>
                <span style={{ fontSize: 12, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600 }}>{k}</span>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{v}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14 }}>
            {/* By role */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', fontWeight: 600, fontSize: 14 }}>By role</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ borderBottom: '1px solid var(--line)' }}>
                  <th style={{ ...cellL, fontWeight: 700 }}>Role</th>
                  <th style={{ ...cellR, fontWeight: 700 }}>Active</th>
                  <th style={{ ...cellR, fontWeight: 700 }}>Inactive</th>
                  <th style={{ ...cellR, fontWeight: 700 }}>Total</th>
                </tr></thead>
                <tbody>
                  {Object.entries(peopleReport.byRole).sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0])).map(([role, d]) => (
                    <tr key={role} style={{ borderBottom: '1px solid var(--line-soft)' }}>
                      <td style={{ ...cellL, fontWeight: 600 }}>{ROLE_LABELS[role] || role}</td>
                      <td style={cellR}>{d.active}</td>
                      <td style={{ ...cellR, color: d.inactive ? 'var(--failed)' : 'var(--ink-soft)' }}>{d.inactive || '—'}</td>
                      <td style={cellR}>{d.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* By tag */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', fontWeight: 600, fontSize: 14 }}>By tag</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ borderBottom: '1px solid var(--line)' }}>
                  <th style={{ ...cellL, fontWeight: 700 }}>Tag</th>
                  <th style={{ ...cellR, fontWeight: 700 }}>People</th>
                </tr></thead>
                <tbody>
                  {tags.slice().sort((a, b) => (peopleReport.tagCount[b.id] || 0) - (peopleReport.tagCount[a.id] || 0) || a.name.localeCompare(b.name)).map(t => (
                    <tr key={t.id} style={{ borderBottom: '1px solid var(--line-soft)' }}>
                      <td style={{ ...cellL, fontWeight: 600 }}>{t.name}</td>
                      <td style={{ ...cellR, color: (peopleReport.tagCount[t.id] || 0) === 0 ? 'var(--failed)' : undefined }}>{peopleReport.tagCount[t.id] || 0}</td>
                    </tr>
                  ))}
                  {tags.length === 0 && <tr><td style={cellL} colSpan={2}><span className="page-sub">No tags yet.</span></td></tr>}
                </tbody>
              </table>
              {peopleReport.emptyTags.length > 0 && (
                <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--ink-soft)', borderTop: '1px solid var(--line)' }}>
                  Tags with nobody: {peopleReport.emptyTags.map(t => t.name).join(', ')}
                </div>
              )}
            </div>
          </div>

          {/* Untagged people */}
          <div className="card" style={{ padding: 0, overflow: 'hidden', marginTop: 14 }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', fontWeight: 600, fontSize: 14 }}>
              People with no tags <span className="page-sub" style={{ fontWeight: 400 }}>({peopleReport.untagged.length})</span>
            </div>
            {peopleReport.untagged.length === 0
              ? <div style={{ padding: '14px 16px' }}><span className="page-sub">Everyone has at least one tag. 🎉</span></div>
              : <div style={{ padding: '10px 16px', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {peopleReport.untagged.slice().sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '')).map(p => (
                    <span key={p.id} style={{ fontSize: 12.5, background: 'var(--line-soft)', borderRadius: 999, padding: '3px 10px' }}>
                      {p.full_name}{!p.is_active && <span style={{ color: 'var(--ink-soft)' }}> · inactive</span>}
                    </span>
                  ))}
                </div>}
          </div>

          {/* Attrition / inactive */}
          <div className="card" style={{ padding: 0, overflow: 'hidden', marginTop: 14 }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', fontWeight: 600, fontSize: 14 }}>
              Inactive / removed <span className="page-sub" style={{ fontWeight: 400 }}>({peopleReport.inactiveList.length})</span>
            </div>
            {peopleReport.inactiveList.length === 0
              ? <div style={{ padding: '14px 16px' }}><span className="page-sub">Nobody is inactive.</span></div>
              : <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr style={{ borderBottom: '1px solid var(--line)' }}>
                    <th style={{ ...cellL, fontWeight: 700 }}>Name</th>
                    <th style={{ ...cellL, fontWeight: 700 }}>Reason</th>
                    <th style={{ ...cellR, fontWeight: 700 }}>Since</th>
                  </tr></thead>
                  <tbody>
                    {peopleReport.inactiveList.map(p => (
                      <tr key={p.id} style={{ borderBottom: '1px solid var(--line-soft)' }}>
                        <td style={{ ...cellL, fontWeight: 600 }}>{p.full_name}</td>
                        <td style={cellL}>{p.inactive_reason || <span className="page-sub">Unspecified</span>}</td>
                        <td style={cellR}>{p.deactivated_at ? new Date(p.deactivated_at).toLocaleDateString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>}
          </div>

          <p className="page-sub" style={{ marginTop: 14, fontSize: 12 }}>
            A current snapshot — the date range above doesn’t apply here. Use <b>Export Roster CSV</b> for the full list with contact info and tags.
          </p>
        </>
      ) : null}
      {loading || view === 'quality' || view === 'people' ? null : (
        <>
          <div className="card" style={{ padding: '12px 16px', marginBottom: 16, display: 'inline-block' }}>
            <span style={{ fontSize: 12, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600 }}>Total tracked</span>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{grandTotal} hrs</div>
          </div>

          {view === 'compare' ? (
            compareRows.length === 0 ? (
              <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--ink-soft)' }}>
                <h3 style={{ fontSize: 14, marginBottom: 4 }}>No interval or task data in this range</h3>
                <p style={{ fontSize: 13 }}>Scheduled intervals and checked-in/out intervals between these dates will appear here.</p>
              </div>
            ) : (
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--line)' }}>
                      <th style={{ ...cellL, fontWeight: 700 }}>Person</th>
                      <th style={{ ...cellR, fontWeight: 700 }}>Scheduled</th>
                      <th style={{ ...cellR, fontWeight: 700 }}>Clock</th>
                      <th style={{ ...cellR, fontWeight: 700 }}>Task</th>
                      <th style={{ ...cellR, fontWeight: 700 }} title="Clock hours minus scheduled hours">vs Sched</th>
                      <th style={{ ...cellR, fontWeight: 700 }} title="Clock hours minus task-tracked hours">vs Task</th>
                    </tr>
                  </thead>
                  <tbody>
                    {compareRows.map(([pid, d]) => {
                      const vsSched = d.clock - d.sched
                      const vsTask = d.clock - d.task
                      const vColor = (v) => Math.abs(v) < 6 ? 'var(--ink-soft)' : v < 0 ? 'var(--failed)' : 'var(--needed)'
                      const fmt = (v) => (v > 0 ? '+' : '') + hoursFromMinutes(v)
                      return (
                        <tr key={pid} style={{ borderBottom: '1px solid var(--line-soft)' }}>
                          <td style={{ ...cellL, fontWeight: 600 }}>
                            {nameOf(pid, profiles)}
                            {d.pending > 0 && <span title="Intervals awaiting admin review — not counted in Clock hours" style={{ marginLeft: 8, background: 'var(--needed-bg)', color: 'var(--needed)', fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 10 }}>{d.pending} pending</span>}
                          </td>
                          <td style={cellR}>{hoursFromMinutes(d.sched)}</td>
                          <td style={cellR}>{hoursFromMinutes(d.clock)}</td>
                          <td style={cellR}>{hoursFromMinutes(d.task)}</td>
                          <td style={{ ...cellR, color: vColor(vsSched), fontWeight: 600 }}>{fmt(vsSched)}</td>
                          <td style={{ ...cellR, color: vColor(vsTask), fontWeight: 600 }}>{fmt(vsTask)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <div style={{ padding: '10px 16px', fontSize: 11.5, color: 'var(--ink-soft)', borderTop: '1px solid var(--line)' }}>
                  <b>Clock</b> = checked-in → checked-out. <b>Task</b> = time tracked to tasks. <b>vs Sched</b> flags attendance gaps; <b>vs Task</b> flags on-the-clock time not tracked to a task. Green = over, red = under.
                </div>
              </div>
            )
          ) : entries.length === 0 ? (
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
                              .sort((a, b) => itemLabel(a).localeCompare(itemLabel(b)))
                              .map(li => (
                                <tr key={li.itemKey}>
                                  <td style={{ ...cellL, paddingLeft: 32, color: 'var(--ink-soft)', fontSize: 12 }}>{itemLabel(li)}{li.isMeeting && <span style={meetingTag}>meeting</span>}</td>
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
                              .sort((a, b) => itemLabel(a).localeCompare(itemLabel(b)))
                              .map(li => (
                                <tr key={li.itemKey}>
                                  <td style={{ ...cellL, paddingLeft: 32, color: 'var(--ink-soft)', fontSize: 12 }}>{itemLabel(li)}{li.isMeeting && <span style={meetingTag}>meeting</span>}</td>
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
const meetingTag = { marginLeft: 8, background: 'var(--accent-bg, var(--line-soft))', color: 'var(--accent)', fontSize: 10, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', padding: '1px 6px', borderRadius: 8, verticalAlign: 'middle' }
// ---- Schedule Hours: hourly coverage + roster, scoped by client/role ----
function hourLabel(h) { const ap = h < 12 ? 'AM' : 'PM'; return `${h % 12 || 12}:00 ${ap}` }
function weekdayShort(d) { return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' }) }

function ScheduleHoursView({ range }) {
  const [clients, setClients] = useState([])
  const [roles, setRoles] = useState([])
  const [clientId, setClientId] = useState('')
  const [role, setRole] = useState('')
  const [mode, setMode] = useState('coverage')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    supabase.from('clients').select('id, name').order('name').then(({ data }) => setClients(data || []))
    supabase.from('shift_blocks').select('role').then(({ data }) => {
      setRoles([...new Set((data || []).map(r => (r.role || '').trim()).filter(Boolean))].sort())
    })
  }, [])

  const run = useCallback(async () => {
    setLoading(true); setErr('')
    const { data: res, error } = await supabase.rpc('get_schedule_hours_report', {
      p_start: range.from, p_end: range.to, p_client: clientId || null, p_role: role || null,
    })
    setLoading(false)
    if (error) { setErr(error.message); return }
    if (!res) { setErr('You don’t have access to this report.'); return }
    setData(res)
  }, [range.from, range.to, clientId, role])

  useEffect(() => { run() }, [range.from, range.to]) // eslint-disable-line

  const rows = data ? (mode === 'coverage' ? data.coverage : data.roster) : []

  function exportCsv() {
    if (!rows.length) return
    const header = mode === 'coverage'
      ? ['Date', 'Day', 'Hour', 'Slots Available', 'Slots Filled', 'Slots Open', 'Fill %']
      : ['Date', 'Day', 'Hour', 'Agent', 'Role', 'Client']
    const out = [header]
    rows.forEach(r => out.push(mode === 'coverage'
      ? [r.date, weekdayShort(r.date), hourLabel(r.hour), r.available, r.filled, r.open, r.available ? Math.round(r.filled / r.available * 100) + '%' : '']
      : [r.date, weekdayShort(r.date), hourLabel(r.hour), r.agent, r.role, r.client]))
    const scope = clientId ? (clients.find(c => c.id === clientId)?.name || 'client') : role || 'all'
    downloadCSV(`hourly-${mode}-${scope}-${range.from}_to_${range.to}.csv`.replace(/[^a-z0-9._-]/gi, '-'), out)
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={lbl}>Client</label>
          <select value={clientId} onChange={e => { setClientId(e.target.value); if (e.target.value) setRole('') }} style={inp}>
            <option value="">All clients</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={lbl}>Role / position</label>
          <select value={role} onChange={e => { setRole(e.target.value); if (e.target.value) setClientId('') }} style={inp}>
            <option value="">All roles</option>
            {roles.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <button className="btn btn-primary" onClick={run} disabled={loading} style={{ height: 36 }}>{loading ? 'Running…' : 'Run report'}</button>
        <div style={{ display: 'flex', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
          <button onClick={() => setMode('coverage')} style={tabBtn(mode === 'coverage')}>Coverage</button>
          <button onClick={() => setMode('roster')} style={tabBtn(mode === 'roster')}>Roster</button>
        </div>
        <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={exportCsv} disabled={!rows.length}>Export CSV</button>
      </div>

      {err && <div style={{ color: 'var(--failed)', fontSize: 13, marginBottom: 10 }}>{err}</div>}

      <div className="card" style={{ padding: 0, overflow: 'auto' }}>
        {loading ? <p className="page-sub" style={{ padding: 20 }}>Loading…</p>
          : rows.length === 0 ? <p className="page-sub" style={{ padding: 20 }}>No scheduled data for these filters.</p>
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr>{(mode === 'coverage'
                ? ['Date', 'Day', 'Hour', 'Slots Available', 'Slots Filled', 'Slots Open', 'Fill %']
                : ['Date', 'Day', 'Hour', 'Agent', 'Role', 'Client']).map(h =>
                <th key={h} style={{ textAlign: 'left', padding: '10px 12px', background: 'var(--canvas)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em', color: 'var(--ink-soft)' }}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((r, i) => mode === 'coverage' ? (
                  <tr key={i} style={{ borderTop: '1px solid var(--line-soft)' }}>
                    <td style={cellL}>{r.date}</td><td style={cellL}>{weekdayShort(r.date)}</td><td style={cellC}>{hourLabel(r.hour)}</td>
                    <td style={cellC}>{r.available}</td><td style={cellC}>{r.filled}</td><td style={cellC}>{r.open}</td>
                    <td style={{ ...cellC, fontWeight: 600, color: r.available && r.filled >= r.available ? 'var(--passed)' : (r.available && r.filled / r.available >= 0.8) ? 'var(--needed)' : 'var(--failed)' }}>{r.available ? Math.round(r.filled / r.available * 100) : 0}%</td>
                  </tr>
                ) : (
                  <tr key={i} style={{ borderTop: '1px solid var(--line-soft)' }}>
                    <td style={cellL}>{r.date}</td><td style={cellL}>{weekdayShort(r.date)}</td><td style={cellC}>{hourLabel(r.hour)}</td>
                    <td style={{ ...cellL, fontWeight: 600 }}>{r.agent}</td><td style={cellL}>{r.role}</td><td style={cellL}>{r.client}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
      {rows.length > 0 && <p className="page-sub" style={{ fontSize: 12, marginTop: 8 }}>{rows.length} rows · Slots Available = total scheduled capacity that hour.</p>}
    </div>
  )
}
const cellC = { padding: '9px 16px', borderBottom: '1px solid var(--line-soft)', fontSize: 13, textAlign: 'center' }

// shared bits for the report tabs below
function Tile({ label, value }) {
  return (
    <div className="card" style={{ padding: '12px 16px' }}>
      <span style={{ fontSize: 12, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600 }}>{label}</span>
      <div style={{ fontSize: 24, fontWeight: 700 }}>{value}</div>
    </div>
  )
}
function Th({ children, r }) {
  return <th style={{ textAlign: r ? 'right' : 'left', padding: '10px 16px', background: 'var(--canvas)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em', color: 'var(--ink-soft)' }}>{children}</th>
}
const dayStart = (d) => d + 'T00:00:00'
const dayEnd = (d) => d + 'T23:59:59'
const mins = (a, b) => (a && b) ? Math.max(0, Math.round((new Date(a) - new Date(b)) / 60000)) : null

// ================= Support / Help Desk =================
function SupportReport({ range }) {
  const [tickets, setTickets] = useState([]); const [names, setNames] = useState({}); const [loading, setLoading] = useState(true)
  useEffect(() => { (async () => {
    setLoading(true)
    const [{ data: t }, { data: p }] = await Promise.all([
      supabase.from('help_tickets').select('*').gte('created_at', dayStart(range.from)).lte('created_at', dayEnd(range.to)).order('created_at'),
      supabase.from('profiles').select('id, full_name'),
    ])
    const m = {}; (p || []).forEach(x => m[x.id] = x.full_name); setNames(m); setTickets(t || []); setLoading(false)
  })() }, [range.from, range.to])

  const CAT = { payments: 'Payments', schedule: 'Schedule', technical: 'Technical', training: 'Training', other: 'Other' }
  const frs = tickets.map(t => mins(t.first_response_at, t.created_at)).filter(v => v != null)
  const avgFr = frs.length ? Math.round(frs.reduce((a, b) => a + b, 0) / frs.length) : null
  const resolved = tickets.filter(t => t.resolved_at || t.status === 'resolved' || t.status === 'closed').length
  const byCat = {}
  tickets.forEach(t => { const k = t.category || 'other'; byCat[k] = byCat[k] || { n: 0, resolved: 0, fr: [] }; byCat[k].n++; if (t.resolved_at) byCat[k].resolved++; const f = mins(t.first_response_at, t.created_at); if (f != null) byCat[k].fr.push(f) })

  function exportCsv() {
    const rows = [['Ticket #', 'Created', 'Subject', 'Category', 'Status', 'Requester', 'Assignee', 'First response (min)', 'Resolution (hrs)']]
    tickets.forEach(t => rows.push([t.ticket_number, (t.created_at || '').slice(0, 16).replace('T', ' '), t.subject, CAT[t.category] || t.category, t.status,
      names[t.requester_id] || '', names[t.assignee_id] || '', mins(t.first_response_at, t.created_at) ?? '', t.resolved_at ? (mins(t.resolved_at, t.created_at) / 60).toFixed(1) : '']))
    downloadCSV(`support-${range.from}_to_${range.to}.csv`, rows)
  }
  if (loading) return <p className="page-sub">Loading…</p>
  return (
    <div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <Tile label="Tickets created" value={tickets.length} />
        <Tile label="Resolved / closed" value={resolved} />
        <Tile label="Avg first response" value={avgFr == null ? '—' : avgFr + ' min'} />
        <Tile label="Still open" value={tickets.filter(t => t.status === 'open' || t.status === 'pending').length} />
        <button className="btn btn-primary" style={{ marginLeft: 'auto', alignSelf: 'flex-end' }} onClick={exportCsv} disabled={!tickets.length}>Export CSV</button>
      </div>
      <div className="card" style={{ padding: 0, overflow: 'auto' }}>
        {tickets.length === 0 ? <p className="page-sub" style={{ padding: 20 }}>No tickets created in this range.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr><Th>Category</Th><Th r>Created</Th><Th r>Resolved</Th><Th r>Avg first response</Th></tr></thead>
            <tbody>{Object.entries(byCat).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => (
              <tr key={k}><td style={cellL}>{CAT[k] || k}</td><td style={cellR}>{v.n}</td><td style={cellR}>{v.resolved}</td>
                <td style={cellR}>{v.fr.length ? Math.round(v.fr.reduce((a, b) => a + b, 0) / v.fr.length) + ' min' : '—'}</td></tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ================= Projects / Tasks =================
function ProjectsReport({ range }) {
  const [tasks, setTasks] = useState([]); const [projects, setProjects] = useState({}); const [asg, setAsg] = useState({}); const [names, setNames] = useState({}); const [loading, setLoading] = useState(true)
  useEffect(() => { (async () => {
    setLoading(true)
    const [{ data: t }, { data: pr }, { data: a }, { data: p }] = await Promise.all([
      supabase.from('tasks').select('*').is('deleted_at', null).gte('created_at', dayStart(range.from)).lte('created_at', dayEnd(range.to)).order('created_at'),
      supabase.from('projects').select('id, name'),
      supabase.from('task_assignees').select('task_id, profile_id'),
      supabase.from('profiles').select('id, full_name'),
    ])
    const pm = {}; (pr || []).forEach(x => pm[x.id] = x.name); setProjects(pm)
    const am = {}; (a || []).forEach(x => { (am[x.task_id] = am[x.task_id] || []).push(x.profile_id) }); setAsg(am)
    const nm = {}; (p || []).forEach(x => nm[x.id] = x.full_name); setNames(nm)
    setTasks(t || []); setLoading(false)
  })() }, [range.from, range.to])

  const today = new Date().toISOString().slice(0, 10)
  const done = tasks.filter(t => t.status === 'done').length
  const overdue = tasks.filter(t => t.due_date && t.due_date < today && t.status !== 'done').length
  const byProj = {}
  tasks.forEach(t => { const k = projects[t.project_id] || '— No project —'; byProj[k] = byProj[k] || { n: 0, done: 0, overdue: 0 }; byProj[k].n++; if (t.status === 'done') byProj[k].done++; if (t.due_date && t.due_date < today && t.status !== 'done') byProj[k].overdue++ })

  function exportCsv() {
    const rows = [['Created', 'Task', 'Project', 'Assignees', 'Status', 'Priority', 'Due date', 'Overdue']]
    tasks.forEach(t => rows.push([(t.created_at || '').slice(0, 10), t.name, projects[t.project_id] || '', (asg[t.id] || []).map(id => names[id]).filter(Boolean).join('; '),
      t.status, t.priority, t.due_date || '', (t.due_date && t.due_date < today && t.status !== 'done') ? 'Yes' : '']))
    downloadCSV(`projects-tasks-${range.from}_to_${range.to}.csv`, rows)
  }
  if (loading) return <p className="page-sub">Loading…</p>
  return (
    <div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <Tile label="Tasks created" value={tasks.length} />
        <Tile label="Done" value={done} />
        <Tile label="Overdue (open)" value={overdue} />
        <button className="btn btn-primary" style={{ marginLeft: 'auto', alignSelf: 'flex-end' }} onClick={exportCsv} disabled={!tasks.length}>Export CSV</button>
      </div>
      <div className="card" style={{ padding: 0, overflow: 'auto' }}>
        {tasks.length === 0 ? <p className="page-sub" style={{ padding: 20 }}>No tasks created in this range.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr><Th>Project</Th><Th r>Tasks</Th><Th r>Done</Th><Th r>Overdue</Th></tr></thead>
            <tbody>{Object.entries(byProj).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => (
              <tr key={k}><td style={cellL}>{k}</td><td style={cellR}>{v.n}</td><td style={cellR}>{v.done}</td>
                <td style={{ ...cellR, color: v.overdue ? 'var(--failed)' : 'inherit' }}>{v.overdue}</td></tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <p className="page-sub" style={{ fontSize: 12, marginTop: 8 }}>Counts tasks <b>created</b> in the range. Overdue = due date passed and not done (current status).</p>
    </div>
  )
}

// ================= Attendance / Adherence =================
function AttendanceReport({ range }) {
  const [rows, setRows] = useState([]); const [loading, setLoading] = useState(true)
  useEffect(() => { (async () => {
    setLoading(true)
    const { data: blocks } = await supabase.from('shift_blocks').select('id, block_date, start_time, end_time').gte('block_date', range.from).lte('block_date', range.to)
    const ids = (blocks || []).map(b => b.id)
    const bm = {}; (blocks || []).forEach(b => bm[b.id] = b)
    let claims = []
    if (ids.length) {
      const { data: c } = await supabase.from('shift_claims').select('shift_block_id, profile_id, status, checked_in_at, checked_out_at').in('shift_block_id', ids)
      claims = c || []
    }
    const { data: profs } = await supabase.from('profiles').select('id, full_name')
    const nm = {}; (profs || []).forEach(p => nm[p.id] = p.full_name)
    const per = {}
    claims.forEach(c => {
      const b = bm[c.shift_block_id]; if (!b) return
      const a = per[c.profile_id] = per[c.profile_id] || { name: nm[c.profile_id] || 'Unknown', shifts: 0, checkedIn: 0, noShow: 0, late: 0, schedH: 0, workedH: 0 }
      a.shifts++
      const dur = (new Date('1970-01-01T' + b.end_time) - new Date('1970-01-01T' + b.start_time)) / 3600000
      a.schedH += Math.max(0, dur)
      if (c.status === 'no_show') a.noShow++
      if (c.checked_in_at) {
        a.checkedIn++
        const startTs = new Date(b.block_date + 'T' + b.start_time)
        if (new Date(c.checked_in_at) > new Date(startTs.getTime() + 5 * 60000)) a.late++
        if (c.checked_out_at) a.workedH += Math.max(0, (new Date(c.checked_out_at) - new Date(c.checked_in_at)) / 3600000)
      }
    })
    setRows(Object.values(per).sort((x, y) => y.schedH - x.schedH)); setLoading(false)
  })() }, [range.from, range.to])

  function exportCsv() {
    const out = [['Agent', 'Shifts', 'Checked in', 'No-shows', 'Late', 'Scheduled hrs', 'Worked hrs']]
    rows.forEach(a => out.push([a.name, a.shifts, a.checkedIn, a.noShow, a.late, a.schedH.toFixed(1), a.workedH.toFixed(1)]))
    downloadCSV(`attendance-${range.from}_to_${range.to}.csv`, out)
  }
  if (loading) return <p className="page-sub">Loading…</p>
  const tot = rows.reduce((s, a) => ({ ns: s.ns + a.noShow, late: s.late + a.late }), { ns: 0, late: 0 })
  return (
    <div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <Tile label="People scheduled" value={rows.length} />
        <Tile label="No-shows" value={tot.ns} />
        <Tile label="Late check-ins" value={tot.late} />
        <button className="btn btn-primary" style={{ marginLeft: 'auto', alignSelf: 'flex-end' }} onClick={exportCsv} disabled={!rows.length}>Export CSV</button>
      </div>
      <div className="card" style={{ padding: 0, overflow: 'auto' }}>
        {rows.length === 0 ? <p className="page-sub" style={{ padding: 20 }}>No scheduled shifts in this range.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr><Th>Agent</Th><Th r>Shifts</Th><Th r>Checked in</Th><Th r>No-shows</Th><Th r>Late</Th><Th r>Scheduled hrs</Th><Th r>Worked hrs</Th></tr></thead>
            <tbody>{rows.map((a, i) => (
              <tr key={i}><td style={cellL}>{a.name}</td><td style={cellR}>{a.shifts}</td><td style={cellR}>{a.checkedIn}</td>
                <td style={{ ...cellR, color: a.noShow ? 'var(--failed)' : 'inherit' }}>{a.noShow}</td><td style={cellR}>{a.late}</td>
                <td style={cellR}>{a.schedH.toFixed(1)}</td><td style={cellR}>{a.workedH.toFixed(1)}</td></tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <p className="page-sub" style={{ fontSize: 12, marginTop: 8 }}>Late = checked in more than 5 min after shift start. Worked hrs = check-in to check-out where recorded.</p>
    </div>
  )
}

function tabBtn(active) {
  return { padding: '8px 14px', border: 0, background: active ? 'var(--accent)' : 'var(--surface)', color: active ? '#fff' : 'var(--ink-soft)', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit' }
}
