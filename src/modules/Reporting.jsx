import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { ROLES, can, canAny } from '../lib/permissions'
import RawDataExport from './RawDataExport'

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
  const today = iso(new Date())
  // Never report into the future — cap the end at today.
  return { from: iso(monday), to: iso(sunday) > today ? today : iso(sunday) }
}
const isoDay = (d) => d.toISOString().slice(0, 10)
const TODAY_ISO = isoDay(new Date())
const capToday = (r) => ({ from: r.from, to: r.to > TODAY_ISO ? TODAY_ISO : r.to })
// Shared time-frame presets used across every report.
function presetRange(preset) {
  const now = new Date()
  if (preset === 'last7') { const f = new Date(now); f.setDate(now.getDate() - 6); return { from: isoDay(f), to: isoDay(now) } }
  if (preset === 'last30') { const f = new Date(now); f.setDate(now.getDate() - 29); return { from: isoDay(f), to: isoDay(now) } }
  if (preset === 'month') { const f = new Date(now.getFullYear(), now.getMonth(), 1); return capToday({ from: isoDay(f), to: isoDay(now) }) }
  if (preset === 'week') return defaultRange()
  return null // 'custom'
}

// ---- Five9-style report catalog. Each leaf key maps to a `view`. Adding a
// report = one entry here + one render branch/component. ----
const CATALOG = [
  { label: 'Time & Schedule', items: [
    { key: 'person', name: 'Hours by Person (Payroll)', q: 'How many hours did each person work, by client?' },
    { key: 'client', name: 'Hours by Client (Invoicing)', q: 'How many hours did we deliver to each client?' },
    { key: 'compare', name: 'Scheduled vs Worked', q: 'Scheduled vs worked per person — Five9 time for agents, clock for everyone else.' },
    { key: 'schedule', name: 'Schedule Hours', q: 'What is hourly coverage, and who is on each hour?' },
    { key: 'sched_agent', name: 'Agent Schedule Summary', q: 'Per person: intervals, scheduled, checked-in, on-task, and Five9 time.' },
    { key: 'attendance', name: 'Attendance', q: 'Who showed up, was late, or no-showed against their schedule?' },
  ] },
  { label: 'Chat', items: [
    { key: 'chat', name: 'Messages by Person', q: 'How many messages is each person sending, by channel and DM?' },
  ] },
  { label: 'Project Management', items: [
    { key: 'projects', name: 'Tasks', q: 'How many tasks were created, completed, and are overdue?' },
    { key: 'tasks_person', name: 'Tasks by Person', q: 'How many tasks per person — assigned, open, overdue, and per day?' },
    { key: 'offclock', name: 'Off-Clock Task Time', q: 'How much task time is tracked while not checked in?' },
  ] },
  { label: 'Quality', items: [
    { key: 'quality', name: 'QA Audits', q: 'How did agents score on QA audits?' },
    { key: 'dispositions', name: 'Call Dispositions', q: 'How are calls dispositioned — by disposition, deal and agent (recent)?' },
    { key: 'dispo_corrections', name: 'Disposition Corrections', q: 'Which call dispositions did QA correct — current vs correct disposition?' },
  ] },
  { label: 'Certifications', items: [
    { key: 'certifications', name: 'Certification Scores', q: 'What are quiz scores by person and course, and the average?' },
    { key: 'cert_quiz', name: 'Cert Quiz Questions', q: 'Which certification quiz questions are most missed?' },
  ] },
  { label: 'Scorecard', items: [
    { key: 'scorecard', name: 'Agent Productivity', q: 'Per-agent Five9 calls, AHT, bookings and hours (rolling 7 / 30 day).' },
  ] },
  { label: 'Help Center', items: [
    { key: 'support', name: 'Support Tickets', q: 'Ticket volume, first-response and resolution times, by category.' },
  ] },
  { label: 'Knowledge Base', items: [
    { key: 'kb', name: 'Article Reads', q: 'How many articles has each person read — and not read?' },
  ] },
  { label: 'Tokens', items: [
    { key: 'tokens', name: 'Token Activity', q: 'How many tokens did each person receive, use, and bank?' },
  ] },
  { label: 'Sales', items: [
    { key: 'sales', name: 'Sales Pipeline', q: 'How many deals are in each stage, and what needs action?' },
  ] },
  { label: 'RSN Pipeline', items: [
    { key: 'rsn', name: 'RSN Pipeline', q: 'How many RSN deals are in each stage, and what needs action?' },
  ] },
  { label: 'Hiring', items: [
    { key: 'hiring', name: 'Hiring Pipeline', q: 'How many applicants are in each stage?' },
  ] },
  { label: 'People & Tags', items: [
    { key: 'people', name: 'People & Tags', q: 'Headcount by role and tag; who is untagged or inactive.' },
  ] },
  { label: 'Clients', items: [
    { key: 'clients', name: 'Clients', q: 'How many clients, which use Five9, and who was added when?' },
  ] },
  { label: 'Positions', items: [
    { key: 'positions', name: 'Positions', q: 'How many people hold each role/position?' },
  ] },
  { label: 'Raw Data', items: [
    { key: 'rawdata', name: 'Raw Data Export', q: 'Export raw records for your own analysis.' },
  ] },
]
const REPORT_META = Object.fromEntries(CATALOG.flatMap(c => c.items.map(it => [it.key, { ...it, category: c.label }])))
// Permission gate per category — a user only sees/pulls reports they have access to.
// Value is a permission prefix (canAny) or specific key (can); '__admin__' = admins only;
// categories not listed are visible to anyone who can reach the Reporting page.
const CAT_PERM = {
  'Chat': 'service_performance_scorecard',
  'Project Management': 'project_management',
  'Quality': 'quality_audit',
  'Certifications': 'certifications',
  'Scorecard': 'service_performance_scorecard',
  'Tokens': 'tokens.award',
  'Sales': 'sales',
  'RSN Pipeline': 'sales',
  'Hiring': 'hiring',
  'People & Tags': 'people_and_tags',
  'Clients': 'clients',
  'Positions': 'positions',
  'Raw Data': '__admin__',
}
function catAllowed(role, label) {
  const perm = CAT_PERM[label]
  if (!perm) return true
  if (perm === '__admin__') return String(role || '').trim().toLowerCase() === 'admin'
  return perm.includes('.') ? can(role, perm) : canAny(role, perm)
}
const reportAllowed = (role, key) => { const c = REPORT_META[key]?.category; return !c || catAllowed(role, c) }
// Reports that don't use the shared date range.
const NO_RANGE = new Set(['people', 'rawdata', 'scorecard', 'positions', 'kb', 'dispositions'])
// Reports that expose the shared person/tag filter.
// (Sales/RSN excluded: deals carry no staff owner_id, so a person/tag filter would wrongly zero them out.)
const FILTERABLE = new Set(['person', 'client', 'compare', 'quality', 'chat', 'tokens', 'certifications', 'cert_quiz', 'sched_agent', 'tasks_person', 'offclock', 'kb', 'builder'])
// Reports whose CSV export is the parent-owned shared button (older inline reports).
const SHARED_EXPORT = new Set(['person', 'client', 'compare', 'quality', 'people'])
// Reports rendered by their own standalone component.
const STANDALONE = new Set(['schedule', 'support', 'projects', 'attendance', 'rawdata', 'chat', 'tokens', 'sales', 'rsn', 'hiring', 'certifications', 'cert_quiz', 'scorecard', 'clients', 'positions', 'sched_agent', 'tasks_person', 'offclock', 'kb', 'dispositions', 'dispo_corrections'])

export default function Reporting() {
  const { isAdmin, appRole } = useAuth()
  const [range, setRange] = useState(defaultRange())
  const [view, setView] = useState(null) // null = catalog landing; otherwise a report key
  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState([])
  const [profiles, setProfiles] = useState([])
  const [tasks, setTasks] = useState([])
  const [clients, setClients] = useState([])
  const [claims, setClaims] = useState([])
  const [sblocks, setSblocks] = useState([])
  const [qaAudits, setQaAudits] = useState([])
  const [five9ByProfile, setFive9ByProfile] = useState({}) // profileId -> occupancy minutes (login−NR) in range (agents)
  // People & Tags report data — a current snapshot, independent of the date range.
  const [peopleFull, setPeopleFull] = useState([])
  const [tags, setTags] = useState([])
  const [taggables, setTaggables] = useState([])
  // Five9-style catalog UI state
  const [mode, setMode] = useState('standard')       // 'standard' | 'custom'
  const [pickerOpen, setPickerOpen] = useState(true)  // catalog / saved-report picker visible
  const [expanded, setExpanded] = useState({})        // category label -> open?
  const [search, setSearch] = useState('')            // report-tree search
  const [filters, setFilters] = useState({ personId: 'all', tagId: 'all', role: 'all' })
  const [savedReports, setSavedReports] = useState([])
  const [savingReport, setSavingReport] = useState(false)
  const [builderInitial, setBuilderInitial] = useState(null) // config when opening a saved custom-built report
  const [builderKey, setBuilderKey] = useState(0)             // bump to remount the builder on open/new

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

  // Saved custom reports (report_definitions): own + shared.
  const loadSaved = useCallback(async () => {
    const { data } = await supabase.from('report_definitions').select('*').order('created_at', { ascending: false })
    setSavedReports(data || [])
  }, [])
  useEffect(() => { loadSaved() }, [loadSaved])

  // Resolve the person/tag filter to a set of allowed profile ids (null = everyone).
  const allowedIds = useMemo(() => {
    let ids = null
    if (filters.personId !== 'all') ids = new Set([filters.personId])
    else if (filters.tagId !== 'all') ids = new Set(taggables.filter(t => t.tag_id === filters.tagId).map(t => t.entity_id))
    if (filters.role && filters.role !== 'all') {
      const roleIds = new Set(peopleFull.filter(p => p.role === filters.role).map(p => p.id))
      ids = ids ? new Set([...ids].filter(x => roleIds.has(x))) : roleIds
    }
    return ids
  }, [filters, taggables, peopleFull])
  // Same filter as display names, for reports keyed on agent_name (QA audits).
  const allowedNames = useMemo(() => allowedIds ? new Set(peopleFull.filter(p => allowedIds.has(p.id)).map(p => p.full_name)) : null, [allowedIds, peopleFull])
  // Distinct roles present on the roster, ordered by the canonical ROLES list.
  const roleOptions = useMemo(() => {
    const present = new Set(peopleFull.map(p => p.role).filter(Boolean))
    const ordered = ROLES.map(r => r.key).filter(k => present.has(k))
    const extras = [...present].filter(k => !ROLES.some(r => r.key === k)).sort()
    return [...ordered, ...extras]
  }, [peopleFull])

  function selectReport(key) { setView(key) }
  function backToCatalog() { setView(null); setFilters({ personId: 'all', tagId: 'all', role: 'all' }) }

  async function saveAsCustom() {
    const name = window.prompt('Name this report:', `${REPORT_META[view]?.name || view} — ${range.from} to ${range.to}`)
    if (!name) return
    setSavingReport(true)
    const { data: { user } } = await supabase.auth.getUser()
    const shared = window.confirm('Share this report with the whole team?\n\nOK = shared · Cancel = just me')
    const { error } = await supabase.from('report_definitions').insert({
      owner_id: user?.id, owner_name: undefined, name, folder: shared ? 'Shared Reports' : 'My Reports',
      report_key: view, is_shared: shared,
      config: { range, filters: FILTERABLE.has(view) ? filters : undefined },
    })
    setSavingReport(false)
    if (error) { window.alert('Could not save: ' + error.message); return }
    await loadSaved(); setMode('custom')
  }
  function openSaved(r) {
    if (r.config?.range) setRange(r.config.range)
    if (r.config?.filters) setFilters(r.config.filters)
    if (r.report_key === 'builder') { setBuilderInitial(r.config || {}); setBuilderKey(k => k + 1); setView('builder'); setPickerOpen(false); return }
    setView(r.report_key)
    setMode('standard'); setPickerOpen(false)
  }
  function newCustomReport() { setBuilderInitial(null); setBuilderKey(k => k + 1); setView('builder'); setPickerOpen(false) }
  async function deleteSaved(r) {
    if (!window.confirm(`Delete saved report "${r.name}"?`)) return
    await supabase.from('report_definitions').delete().eq('id', r.id)
    await loadSaved()
  }

  const load = useCallback(async () => {
    setLoading(true)
    // inclusive of the whole 'to' day
    const fromISO = new Date(range.from + 'T00:00:00').toISOString()
    const toISO = new Date(range.to + 'T23:59:59').toISOString()
    const [teRes, profRes, taskRes, cliRes, clmRes, blkRes, qaRes, agRes, f9Res] = await Promise.all([
      supabase.from('time_entries').select('*')
        .not('duration_minutes', 'is', null)
        .gte('started_at', fromISO).lte('started_at', toISO),
      supabase.from('profiles').select('id, full_name, role'),
      supabase.from('tasks').select('id, name, client_id'),
      supabase.from('clients').select('id, name'),
      supabase.from('shift_claims').select('id, shift_block_id, profile_id, status, checked_in_at, checked_out_at'),
      supabase.from('shift_blocks').select('id, block_date, start_time, end_time'),
      supabase.from('qa_audits').select('*').gte('created_at', fromISO).lte('created_at', toISO),
      supabase.from('sc_agents').select('agent_name, profile_id'),
      supabase.from('sc_occupancy_day').select('agent_name, login_hours, nr_hours, work_date').gte('work_date', range.from).lte('work_date', range.to),
    ])
    setEntries(teRes.data || [])
    setProfiles(profRes.data || [])
    setTasks(taskRes.data || [])
    setClients(cliRes.data || [])
    setQaAudits(qaRes.error ? [] : (qaRes.data || []))
    // Agent OCCUPANCY (login − not ready) for the range, in MINUTES, mapped to profile via sc_agents.
    const agByName = {}; for (const a of (agRes.data || [])) if (a.profile_id) agByName[a.agent_name] = a.profile_id
    const five9 = {}; for (const o of (f9Res.error ? [] : (f9Res.data || []))) { const pid = agByName[o.agent_name]; if (pid) five9[pid] = (five9[pid] || 0) + Math.max(0, (Number(o.login_hours) || 0) - (Number(o.nr_hours) || 0)) * 60 }
    setFive9ByProfile(five9)
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
      if (allowedIds && !allowedIds.has(e.user_id)) continue
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
  }, [entries, clientOfEntry, allowedIds])

  const grandTotal = useMemo(() => hoursFromMinutes(entries.filter(e => !allowedIds || allowedIds.has(e.user_id)).reduce((s, e) => s + (e.duration_minutes || 0), 0)), [entries, allowedIds])

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
    const per = {} // personId -> {sched, clock, task, over, autoOut}
    const ensure = (pid) => (per[pid] = per[pid] || { sched: 0, clock: 0, task: 0, over: 0, autoOut: 0 })
    // Scheduled end datetime for a block, used to auto-close missing checkouts.
    const schedEnd = (b) => (b && b.block_date && b.end_time) ? new Date(`${b.block_date}T${b.end_time.slice(0, 5)}:00`) : null
    for (const c of claims) {
      if (allowedIds && !allowedIds.has(c.profile_id)) continue
      if (c.status === 'no_show') continue
      const b = blockById[c.shift_block_id]
      const schedM = schedMinsOf(b)
      ensure(c.profile_id).sched += schedM
      if (c.checked_in_at) {
        // If they never checked out, auto-check-out at the scheduled interval end.
        let out = c.checked_out_at
        if (!out) { const e = schedEnd(b); out = e ? e.toISOString() : c.checked_in_at; ensure(c.profile_id).autoOut += 1 }
        const worked = mins(c.checked_in_at, out) || 0
        ensure(c.profile_id).clock += worked
        // Time worked beyond the scheduled interval needs admin approval.
        if (schedM && worked > schedM) ensure(c.profile_id).over += (worked - schedM)
      }
    }
    // task minutes from time_entries (used for non-agents' "worked" fallback)
    for (const e of entries) { if (allowedIds && !allowedIds.has(e.user_id)) continue; ensure(e.user_id).task += (e.duration_minutes || 0) }
    // Agents are judged on Five9 talk time, not task/clock time.
    const roleById = Object.fromEntries(profiles.map(p => [p.id, p.role]))
    for (const pid of Object.keys(per)) {
      per[pid].isAgent = roleById[pid] === 'agent'
      per[pid].five9 = Math.round(five9ByProfile[pid] || 0) // occupancy minutes (login − not ready)
    }
    return per
  }, [claims, sblocks, entries, allowedIds, profiles, five9ByProfile])

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
      if (allowedIds && !allowedIds.has(e.user_id)) continue
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
  }, [entries, clientOfEntry, allowedIds])

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
    const header = ['Person', 'Basis', 'Scheduled hrs', 'Worked hrs', 'Over-interval hrs (needs approval)', 'Worked − Scheduled', 'Auto-checked-out intervals']
    const rows = [header]
    compareRows.forEach(([pid, d]) => {
      const worked = d.isAgent ? d.five9 : d.clock
      rows.push([
        nameOf(pid, profiles), d.isAgent ? 'Five9' : 'Clock',
        hoursFromMinutes(d.sched), hoursFromMinutes(worked), hoursFromMinutes(d.over),
        hoursFromMinutes(worked - d.sched), d.autoOut || 0,
      ])
    })
    downloadCSV(`scheduled-vs-worked-${range.from}_to_${range.to}.csv`, rows)
  }

  // QUALITY: per-agent QA rollup over the range (conversation audits carry the 0-100 score)
  const qaByAgent = useMemo(() => {
    const m = {}
    for (const a of qaAudits) {
      if (allowedNames && !allowedNames.has(a.agent_name)) continue
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
  }, [qaAudits, allowedNames])

  const qaTotals = useMemo(() => {
    const conv = qaAudits.filter(a => (!allowedNames || allowedNames.has(a.agent_name)) && a.audit_type === 'conversation' && a.clean_qa_score != null)
    const avg = conv.length ? Math.round(conv.reduce((s, a) => s + Number(a.clean_qa_score), 0) / conv.length) : null
    const scoped = allowedNames ? qaAudits.filter(a => allowedNames.has(a.agent_name)) : qaAudits
    return { audits: scoped.length, avg, autoFails: scoped.filter(a => a.auto_fail).length }
  }, [qaAudits, allowedNames])

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
        <p className="page-sub">Report on anything across the app — search or browse on the left, set your time frame and filters, then export or save. Every report is CSV-exportable.</p>
      </div>

      <div style={{ display: 'flex', alignItems: 'stretch', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden', background: 'var(--surface)' }}>
        {/* LEFT RAIL — searchable report tree */}
        <aside style={{ width: 272, flexShrink: 0, borderRight: '1px solid var(--line)', background: 'var(--canvas, #f8fafc)', display: 'flex', flexDirection: 'column', maxHeight: '80vh' }}>
          <div style={{ padding: 12, borderBottom: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              <button onClick={() => setMode('standard')} style={railTab(mode === 'standard')}>Standard</button>
              <button onClick={() => setMode('custom')} style={railTab(mode === 'custom')}>Custom{savedReports.length ? ` (${savedReports.length})` : ''}</button>
            </div>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search reports…"
              style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)', fontSize: 13, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--ink)', boxSizing: 'border-box' }} />
          </div>
          <div style={{ overflowY: 'auto', flex: 1, padding: '8px 0' }}>
            {mode === 'standard' ? (() => {
              const q = search.trim().toLowerCase()
              const cats = CATALOG.filter(cat => isAdmin || catAllowed(appRole, cat.label))
                .map(cat => ({ cat, items: cat.items.filter(it => !q || it.name.toLowerCase().includes(q) || (it.q || '').toLowerCase().includes(q) || cat.label.toLowerCase().includes(q)) }))
                .filter(x => x.items.length)
              if (!cats.length) return <div style={{ padding: '10px 16px', color: 'var(--ink-soft)', fontSize: 13 }}>No reports match “{search}”.</div>
              return cats.map(({ cat, items }) => (
                <div key={cat.label} style={{ marginBottom: 8 }}>
                  <div style={{ padding: '4px 16px', fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>{cat.label}</div>
                  {items.map(it => (
                    <button key={it.key} onClick={() => selectReport(it.key)} title={it.q} style={railItem(view === it.key)}>{it.name}</button>
                  ))}
                </div>
              ))
            })() : (
              <div>
                <button onClick={newCustomReport} style={{ ...railItem(view === 'builder'), fontWeight: 700, color: 'var(--accent)' }}>＋ New custom report</button>
                <div style={{ padding: '8px 16px 4px', fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Saved</div>
                {savedReports.filter(r => r.report_key === 'builder' || isAdmin || reportAllowed(appRole, r.report_key)).length === 0 && <div style={{ padding: '6px 16px', color: 'var(--ink-soft)', fontSize: 12.5 }}>Nothing saved yet.</div>}
                {savedReports.filter(r => r.report_key === 'builder' || isAdmin || reportAllowed(appRole, r.report_key)).map(r => (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center' }}>
                    <button onClick={() => openSaved(r)} style={{ ...railItem(false), flex: 1 }}>{r.name}<div style={{ fontSize: 10.5, color: 'var(--ink-soft)', fontWeight: 400 }}>{r.report_key === 'builder' ? 'Custom report' : (REPORT_META[r.report_key]?.name || r.report_key)}{r.is_shared ? ' · shared' : ''}</div></button>
                    <button onClick={() => deleteSaved(r)} title="Delete" style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--ink-soft)', fontSize: 14, padding: '0 12px' }}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* MAIN — the selected report */}
        <main style={{ flex: 1, minWidth: 0, padding: 20, maxHeight: '80vh', overflowY: 'auto' }}>
          {view === null ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 340, textAlign: 'center', color: 'var(--ink-soft)' }}>
              <div style={{ fontSize: 38, marginBottom: 8 }}>📊</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>Pick a report to begin</div>
              <div style={{ fontSize: 13, maxWidth: 360, marginTop: 6, lineHeight: 1.5 }}>Browse the categories on the left or search by name. Need something specific? Switch to <b>Custom</b> and build your own.</div>
            </div>
          ) : !(view === 'builder' || isAdmin || reportAllowed(appRole, view)) ? (
            <div className="card" style={{ padding: 24, color: 'var(--ink-soft)' }}>You don't have access to this report.</div>
          ) : (
        <>

      {/* report title */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700 }}>{view === 'builder' ? 'Custom' : (REPORT_META[view]?.category || '')}</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--ink)', marginTop: 2 }}>{view === 'builder' ? 'Custom Report Builder' : (REPORT_META[view]?.name || 'Report')}</div>
        {(view !== 'builder' && REPORT_META[view]?.q) && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 3 }}>{REPORT_META[view].q}</div>}
      </div>

      {/* controls bar */}
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16, padding: '12px 14px', background: 'var(--canvas, #f8fafc)', border: '1px solid var(--line)', borderRadius: 10 }}>
        {!NO_RANGE.has(view) && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={lbl}>Quick range</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[['week', 'This week'], ['last7', 'Last 7'], ['last30', 'Last 30'], ['month', 'This month']].map(([p, l]) => (
                  <button key={p} onClick={() => setRange(presetRange(p))} style={{ ...tabBtn(false), border: '1px solid var(--line)', borderRadius: 8 }}>{l}</button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={lbl}>From</label>
              <input type="date" max={TODAY_ISO} value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} style={inp} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={lbl}>To</label>
              <input type="date" max={TODAY_ISO} value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value > TODAY_ISO ? TODAY_ISO : e.target.value }))} style={inp} />
            </div>
          </>
        )}
        {FILTERABLE.has(view) && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={lbl}>Person</label>
              <select value={filters.personId} onChange={e => setFilters(f => ({ ...f, personId: e.target.value }))} style={inp}>
                <option value="all">All people</option>
                {peopleFull.slice().sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '')).map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={lbl}>Tag</label>
              <select value={filters.tagId} onChange={e => setFilters(f => ({ ...f, tagId: e.target.value }))} style={inp}>
                <option value="all">All tags</option>
                {tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={lbl}>Role</label>
              <select value={filters.role} onChange={e => setFilters(f => ({ ...f, role: e.target.value }))} style={inp}>
                <option value="all">All roles</option>
                {roleOptions.map(r => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
              </select>
            </div>
          </>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          {view !== 'builder' && <button onClick={saveAsCustom} disabled={savingReport} style={{ ...tabBtn(false), border: '1px solid var(--line)', borderRadius: 8 }}>☆ Save as report</button>}
          {SHARED_EXPORT.has(view) && (
            <button className="btn btn-primary"
              onClick={view === 'person' ? exportPersonCSV : view === 'client' ? exportClientCSV : view === 'quality' ? exportQualityCSV : view === 'people' ? exportPeopleCSV : exportCompareCSV}>
              Export {view === 'person' ? 'Payroll' : view === 'client' ? 'Invoicing' : view === 'quality' ? 'Quality' : view === 'people' ? 'Roster' : 'Comparison'} CSV
            </button>
          )}
        </div>
      </div>

      {view === 'schedule' ? <ScheduleHoursView range={range} setRange={setRange} />
        : view === 'support' ? <SupportReport range={range} />
        : view === 'projects' ? <ProjectsReport range={range} />
        : view === 'attendance' ? <AttendanceReport range={range} />
        : view === 'rawdata' ? <RawDataExport range={range} />
        : view === 'chat' ? <ChatReport range={range} profiles={peopleFull} allowedIds={allowedIds} />
        : view === 'tokens' ? <TokensReport range={range} profiles={peopleFull} allowedIds={allowedIds} />
        : view === 'sales' ? <DealsReport range={range} pipeline="sales" allowedIds={allowedIds} />
        : view === 'rsn' ? <DealsReport range={range} pipeline="rsn" allowedIds={allowedIds} />
        : view === 'hiring' ? <HiringReport range={range} />
        : view === 'certifications' ? <CertificationsReport range={range} profiles={peopleFull} allowedIds={allowedIds} />
        : view === 'cert_quiz' ? <CertQuizReport range={range} allowedIds={allowedIds} />
        : view === 'scorecard' ? <ScorecardReport />
        : view === 'dispositions' ? <DispositionsReport />
        : view === 'dispo_corrections' ? <DispoCorrectionsReport range={range} />
        : view === 'clients' ? <ClientsReport range={range} />
        : view === 'positions' ? <PositionsReport />
        : view === 'sched_agent' ? <SchedAgentReport range={range} profiles={peopleFull} allowedIds={allowedIds} />
        : view === 'tasks_person' ? <TasksByPersonReport range={range} profiles={peopleFull} allowedIds={allowedIds} />
        : view === 'offclock' ? <OffClockReport range={range} profiles={peopleFull} allowedIds={allowedIds} />
        : view === 'kb' ? <KbReport profiles={peopleFull} allowedIds={allowedIds} />
        : view === 'builder' ? <CustomBuilder key={builderKey} range={range} profiles={peopleFull} allowedIds={allowedIds} initial={builderInitial} onSaved={() => { loadSaved(); setMode('custom'); setPickerOpen(true) }} />

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
            A current snapshot — the date range above doesn't apply here. Use <b>Export Roster CSV</b> for the full list with contact info and tags.
          </p>
        </>
      ) : null}
      {/* Hours body: ONLY the three time-tracking reports render this (Payroll / Invoicing / Scheduled vs Worked). */}
      {(!['person', 'client', 'compare'].includes(view) || loading) ? null : (
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
                      <th style={{ ...cellR, fontWeight: 700 }} title="Agents: Five9 talk time. Everyone else: clock (check-in → check-out).">Worked</th>
                      <th style={{ ...cellR, fontWeight: 700 }} title="Time worked beyond the scheduled interval — needs admin approval">Over</th>
                      <th style={{ ...cellR, fontWeight: 700 }} title="Worked minus scheduled">vs Sched</th>
                    </tr>
                  </thead>
                  <tbody>
                    {compareRows.map(([pid, d]) => {
                      const worked = d.isAgent ? d.five9 : d.clock
                      const vsSched = worked - d.sched
                      const vColor = (v) => Math.abs(v) < 6 ? 'var(--ink-soft)' : v < 0 ? 'var(--failed)' : 'var(--needed)'
                      const fmt = (v) => (v > 0 ? '+' : '') + hoursFromMinutes(v)
                      return (
                        <tr key={pid} style={{ borderBottom: '1px solid var(--line-soft)' }}>
                          <td style={{ ...cellL, fontWeight: 600 }}>
                            {nameOf(pid, profiles)}
                            <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, letterSpacing: '.03em', color: d.isAgent ? 'var(--accent)' : 'var(--ink-soft)' }}>{d.isAgent ? 'FIVE9' : 'CLOCK'}</span>
                            {d.autoOut > 0 && <span title="Intervals auto-checked-out at the scheduled end time (no manual check-out)" style={{ marginLeft: 8, background: 'var(--line-soft)', color: 'var(--ink-soft)', fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 10 }}>{d.autoOut} auto-out</span>}
                          </td>
                          <td style={cellR}>{hoursFromMinutes(d.sched)}</td>
                          <td style={cellR}>{hoursFromMinutes(worked)}</td>
                          <td style={{ ...cellR, color: d.over ? 'var(--needed)' : 'var(--ink-soft)', fontWeight: 600 }}>{d.over ? hoursFromMinutes(d.over) : '—'}</td>
                          <td style={{ ...cellR, color: vColor(vsSched), fontWeight: 600 }}>{fmt(vsSched)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <div style={{ padding: '10px 16px', fontSize: 11.5, color: 'var(--ink-soft)', borderTop: '1px solid var(--line)' }}>
                  <b>Worked</b> = Five9 occupancy (login − not-ready) for agents, clock (check-in → check-out) for everyone else. Missing check-outs auto-close at the scheduled interval end. <b>Over</b> = time beyond the scheduled interval — needs admin approval. Agent occupancy covers the last ~31 days.
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
            </>
          )}
        </main>
      </div>
    </div>
  )
}

const railTab = (a) => ({ flex: 1, padding: '6px 8px', borderRadius: 7, border: '1px solid ' + (a ? 'var(--accent)' : 'var(--line)'), background: a ? 'var(--accent)' : 'var(--surface)', color: a ? '#fff' : 'var(--ink-soft)', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit' })
const railItem = (a) => ({ display: 'block', width: '100%', textAlign: 'left', padding: '8px 16px', border: 0, borderLeft: '3px solid ' + (a ? 'var(--accent)' : 'transparent'), background: a ? 'var(--accent-bg, #eef4ff)' : 'transparent', color: a ? 'var(--accent)' : 'var(--ink)', cursor: 'pointer', fontSize: 13, fontWeight: a ? 700 : 500, fontFamily: 'inherit' })
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
    // Pass all 5 params (incl. p_staff_role) to disambiguate the two RPC overloads.
    const { data: res, error } = await supabase.rpc('get_schedule_hours_report', {
      p_start: range.from, p_end: range.to, p_client: clientId || null, p_role: role || null, p_staff_role: null,
    })
    setLoading(false)
    if (error) { setErr(error.message); return }
    if (!res) { setErr("You don't have access to this report."); return }
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
function pill(active) {
  return { padding: '8px 16px', border: active ? '1px solid var(--accent)' : '1px solid var(--line)', borderRadius: 999, background: active ? 'var(--accent)' : 'var(--surface)', color: active ? '#fff' : 'var(--ink-soft)', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit' }
}
const prettyStatus = (s) => (s || '—').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

// ================= Chat: messages per person / channel / DM =================
function ChatReport({ range, profiles, allowedIds }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let active = true; setData(null); setErr('')
    // Aggregate counts via SECURITY DEFINER RPC (org-wide despite per-channel RLS; counts only).
    supabase.rpc('report_message_counts', { p_from: range.from, p_to: range.to })
      .then(({ data, error }) => { if (!active) return; if (error) setErr(error.message); else setData(data) })
    return () => { active = false }
  }, [range.from, range.to])

  const nameOf = (id) => (profiles.find(p => p.id === id) || {}).full_name || '—'
  const perPerson = useMemo(() => (data?.per_person || []).filter(r => !allowedIds || allowedIds.has(r.sender_id)), [data, allowedIds])
  const perChannel = useMemo(() => (data?.per_channel || []), [data])
  const totals = useMemo(() => {
    let dm = 0, chn = 0
    for (const r of perPerson) { dm += (r.dm || 0); chn += (r.chan || 0) }
    return { dm, chn, total: dm + chn, people: perPerson.length }
  }, [perPerson])

  function exportCsv() {
    const out = [['Person', 'Total messages', 'DMs', 'Channel messages']]
    perPerson.slice().sort((a, b) => b.total - a.total).forEach(r => out.push([nameOf(r.sender_id), r.total, r.dm, r.chan]))
    downloadCSV(`chat-messages-${range.from}_to_${range.to}.csv`, out)
  }

  if (err) return <div className="card" style={{ padding: 16, color: 'var(--failed)' }}>Error: {err === 'not authorized' ? 'This report is available to managers only.' : err}</div>
  if (data == null) return <p className="page-sub">Loading…</p>
  const personRows = perPerson.slice().sort((a, b) => b.total - a.total)
  const channelRows = perChannel.slice().sort((a, b) => b.count - a.count)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Tile label="Total messages" value={totals.total} />
        <Tile label="Channel messages" value={totals.chn} />
        <Tile label="Direct messages" value={totals.dm} />
        <Tile label="Active senders" value={totals.people} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" onClick={exportCsv}>Export CSV</button></div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', fontWeight: 600 }}>By person</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><Th>Person</Th><Th r>Total</Th><Th r>DMs</Th><Th r>Channel</Th></tr></thead>
          <tbody>
            {personRows.length === 0 && <tr><td style={cellL} colSpan={4}><span className="page-sub">No messages in this range.</span></td></tr>}
            {personRows.map(r => (
              <tr key={r.sender_id}><td style={{ ...cellL, fontWeight: 600 }}>{nameOf(r.sender_id)}</td><td style={cellR}>{r.total}</td><td style={cellR}>{r.dm}</td><td style={cellR}>{r.chan}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', fontWeight: 600 }}>By channel</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><Th>Channel</Th><Th r>Messages</Th><Th r>Senders</Th></tr></thead>
          <tbody>
            {channelRows.length === 0 && <tr><td style={cellL} colSpan={3}><span className="page-sub">No channel messages in this range.</span></td></tr>}
            {channelRows.map(c => (
              <tr key={c.channel_id}><td style={{ ...cellL, fontWeight: 600 }}>{c.name || 'Channel'}</td><td style={cellR}>{c.count}</td><td style={cellR}>{c.senders}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="page-sub" style={{ fontSize: 12 }}>Counts come from an aggregate view (message text is never exposed). DMs are per sender; deleted messages excluded. The channel table shows all senders regardless of the person filter.</p>
    </div>
  )
}

// ================= Tokens: received / used / banked per person =================
function TokensReport({ range, profiles, allowedIds }) {
  const [txns, setTxns] = useState(null)
  const [wallets, setWallets] = useState([])
  const [err, setErr] = useState('')
  useEffect(() => {
    let active = true; setTxns(null); setErr('')
    ;(async () => {
      const [{ data: tx, error }, { data: w }] = await Promise.all([
        supabase.from('token_transactions').select('profile_id, delta, kind, created_at').gte('created_at', dayStart(range.from)).lte('created_at', dayEnd(range.to)),
        supabase.from('token_wallets').select('profile_id, balance'),
      ])
      if (!active) return
      if (error) { setErr(error.message); return }
      setTxns(tx || []); setWallets(w || [])
    })()
    return () => { active = false }
  }, [range.from, range.to])

  const nameOf = (id) => (profiles.find(p => p.id === id) || {}).full_name || '—'
  const bankedOf = useMemo(() => Object.fromEntries(wallets.map(w => [w.profile_id, w.balance || 0])), [wallets])
  const { per, totals } = useMemo(() => {
    const p = {}; let recv = 0, used = 0
    for (const t of (txns || [])) {
      if (allowedIds && !allowedIds.has(t.profile_id)) continue
      if (!p[t.profile_id]) p[t.profile_id] = { received: 0, used: 0 }
      if (t.kind === 'award') { p[t.profile_id].received += (t.delta || 0); recv += (t.delta || 0) }
      else if (t.kind === 'redeem') { p[t.profile_id].used += Math.abs(t.delta || 0); used += Math.abs(t.delta || 0) }
    }
    return { per: p, totals: { recv, used, people: Object.keys(p).length } }
  }, [txns, allowedIds])

  function exportCsv() {
    const out = [['Person', 'Received', 'Used', 'Net', 'Banked (current)']]
    Object.entries(per).sort((a, b) => b[1].received - a[1].received).forEach(([pid, d]) => out.push([nameOf(pid), d.received, d.used, d.received - d.used, bankedOf[pid] || 0]))
    downloadCSV(`tokens-${range.from}_to_${range.to}.csv`, out)
  }

  if (err) return <div className="card" style={{ padding: 16, color: 'var(--failed)' }}>Error: {err}</div>
  if (txns == null) return <p className="page-sub">Loading…</p>
  const rows = Object.entries(per).sort((a, b) => b[1].received - a[1].received)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Tile label="Tokens awarded" value={totals.recv} />
        <Tile label="Tokens redeemed" value={totals.used} />
        <Tile label="People active" value={totals.people} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" onClick={exportCsv}>Export CSV</button></div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><Th>Person</Th><Th r>Received</Th><Th r>Used</Th><Th r>Net</Th><Th r>Banked (now)</Th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td style={cellL} colSpan={5}><span className="page-sub">No token activity in this range.</span></td></tr>}
            {rows.map(([pid, d]) => (
              <tr key={pid}><td style={{ ...cellL, fontWeight: 600 }}>{nameOf(pid)}</td><td style={cellR}>{d.received}</td><td style={cellR}>{d.used}</td><td style={cellR}>{d.received - d.used}</td><td style={{ ...cellR, color: 'var(--accent)' }}>{bankedOf[pid] || 0}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="page-sub" style={{ fontSize: 12 }}>Received &amp; Used are within the selected range. <b>Banked</b> is each person's current wallet balance (all-time), independent of the range.</p>
    </div>
  )
}

// ================= Sales / RSN pipeline (deals) =================
const DEAL_STATUS_LABELS = { new_lead: 'New lead', email_1_sent: 'Email sent', email_unreachable: 'Unreachable', proposal_sent: 'Proposal sent', lost: 'Lost' }
function DealsReport({ range, pipeline, allowedIds }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let active = true; setRows(null); setErr('')
    ;(async () => {
      const { data, error } = await supabase.from('deals')
        .select('id, title, status, value, owner_id, owner_name, next_activity, last_emailed_at, created_at, lost_reason')
        .eq('pipeline', pipeline)
        .gte('created_at', dayStart(range.from)).lte('created_at', dayEnd(range.to))
      if (!active) return
      if (error) { setErr(error.message); return }
      setRows(data || [])
    })()
    return () => { active = false }
  }, [range.from, range.to, pipeline])

  // Deals have no staff owner_id in this data, so no person/tag filter is applied here.
  const filtered = useMemo(() => (rows || []), [rows])
  const byStatus = useMemo(() => {
    const m = {}
    for (const d of filtered) { const k = d.status || '—'; if (!m[k]) m[k] = { count: 0, value: 0 }; m[k].count++; m[k].value += Number(d.value) || 0 }
    return m
  }, [filtered])
  const totals = useMemo(() => ({
    total: filtered.length,
    active: filtered.filter(d => d.status !== 'lost').length,
    needEmail: filtered.filter(d => d.status === 'new_lead').length,
    unreachable: filtered.filter(d => d.status === 'email_unreachable').length,
    lost: filtered.filter(d => d.status === 'lost').length,
    value: filtered.reduce((s, d) => s + (Number(d.value) || 0), 0),
  }), [filtered])

  function exportCsv() {
    const out = [['Deal', 'Status', 'Value', 'Owner', 'Next activity', 'Last emailed', 'Created', 'Lost reason']]
    filtered.forEach(d => out.push([d.title || '', DEAL_STATUS_LABELS[d.status] || d.status || '', d.value || '', d.owner_name || '', d.next_activity || '', d.last_emailed_at ? new Date(d.last_emailed_at).toLocaleDateString() : '', d.created_at ? new Date(d.created_at).toLocaleDateString() : '', d.lost_reason || '']))
    downloadCSV(`${pipeline}-pipeline-${range.from}_to_${range.to}.csv`, out)
  }

  if (err) return <div className="card" style={{ padding: 16, color: 'var(--failed)' }}>Error: {err}</div>
  if (rows == null) return <p className="page-sub">Loading…</p>
  const fmt$ = (n) => '$' + Math.round(n).toLocaleString()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Tile label="Deals (in range)" value={totals.total} />
        <Tile label="Active" value={totals.active} />
        <Tile label="Needs email" value={totals.needEmail} />
        <Tile label="Unreachable" value={totals.unreachable} />
        <Tile label="Lost" value={totals.lost} />
        <Tile label="Pipeline value" value={fmt$(totals.value)} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" onClick={exportCsv}>Export CSV</button></div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><Th>Stage</Th><Th r>Deals</Th><Th r>Value</Th></tr></thead>
          <tbody>
            {Object.keys(byStatus).length === 0 && <tr><td style={cellL} colSpan={3}><span className="page-sub">No deals created in this range.</span></td></tr>}
            {Object.entries(byStatus).sort((a, b) => b[1].count - a[1].count).map(([s, d]) => (
              <tr key={s}><td style={{ ...cellL, fontWeight: 600 }}>{DEAL_STATUS_LABELS[s] || prettyStatus(s)}</td><td style={cellR}>{d.count}</td><td style={cellR}>{fmt$(d.value)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="page-sub" style={{ fontSize: 12 }}>Deals <b>created</b> in the selected range, grouped by current stage. "Needs email" = new leads; "Unreachable" = marked email-unreachable.</p>
    </div>
  )
}

// ================= Hiring pipeline =================
function HiringReport({ range }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let active = true; setRows(null); setErr('')
    ;(async () => {
      const { data, error } = await supabase.from('hiring_applications').select('id, full_name, status, role_applying, created_at').gte('created_at', dayStart(range.from)).lte('created_at', dayEnd(range.to))
      if (!active) return
      if (error) { setErr(error.message); return }
      setRows(data || [])
    })()
    return () => { active = false }
  }, [range.from, range.to])

  const byStatus = useMemo(() => { const m = {}; for (const a of (rows || [])) { const k = a.status || '—'; m[k] = (m[k] || 0) + 1 } return m }, [rows])
  const byRole = useMemo(() => { const m = {}; for (const a of (rows || [])) { const k = a.role_applying || '—'; m[k] = (m[k] || 0) + 1 } return m }, [rows])
  // No 'approved' status exists in the pipeline. Group the real stages into buckets.
  const ADVANCING = ['assessment_passed', 'mock_passed', 'certifying']
  const REJECTED = ['denied', 'out_of_area', 'mock_failed']
  const totals = useMemo(() => {
    const rs = rows || []
    return {
      total: rs.length,
      advancing: rs.filter(a => ADVANCING.includes(a.status)).length,
      rejected: rs.filter(a => REJECTED.includes(a.status)).length,
      inReview: rs.filter(a => !ADVANCING.includes(a.status) && !REJECTED.includes(a.status)).length,
    }
  }, [rows])

  function exportCsv() {
    const out = [['Applicant', 'Status', 'Role', 'Applied']]
    ;(rows || []).forEach(a => out.push([a.full_name || '', prettyStatus(a.status), a.role_applying || '', a.created_at ? new Date(a.created_at).toLocaleDateString() : '']))
    downloadCSV(`hiring-${range.from}_to_${range.to}.csv`, out)
  }

  if (err) return <div className="card" style={{ padding: 16, color: 'var(--failed)' }}>Error: {err}</div>
  if (rows == null) return <p className="page-sub">Loading…</p>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Tile label="Applicants (in range)" value={totals.total} />
        <Tile label="In review" value={totals.inReview} />
        <Tile label="Advancing" value={totals.advancing} />
        <Tile label="Rejected / out" value={totals.rejected} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" onClick={exportCsv}>Export CSV</button></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', fontWeight: 600 }}>By stage</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><Th>Stage</Th><Th r>Applicants</Th></tr></thead>
            <tbody>
              {Object.keys(byStatus).length === 0 && <tr><td style={cellL} colSpan={2}><span className="page-sub">No applicants in this range.</span></td></tr>}
              {Object.entries(byStatus).sort((a, b) => b[1] - a[1]).map(([s, n]) => (
                <tr key={s}><td style={{ ...cellL, fontWeight: 600 }}>{prettyStatus(s)}</td><td style={cellR}>{n}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', fontWeight: 600 }}>By role applied</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><Th>Role</Th><Th r>Applicants</Th></tr></thead>
            <tbody>
              {Object.entries(byRole).sort((a, b) => b[1] - a[1]).map(([s, n]) => (
                <tr key={s}><td style={{ ...cellL, fontWeight: 600 }}>{s}</td><td style={cellR}>{n}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ================= Certifications: quiz scores by person / course =================
function CertificationsReport({ range, profiles, allowedIds }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let active = true; setData(null); setErr('')
    const ids = allowedIds ? Array.from(allowedIds) : null
    supabase.rpc('report_cert', { p_from: range.from, p_to: range.to, p_profile_ids: ids })
      .then(({ data, error }) => { if (!active) return; if (error) setErr(error.message); else setData(data) })
    return () => { active = false }
  }, [range.from, range.to, allowedIds])

  const nameOf = (id) => (profiles.find(p => p.id === id) || {}).full_name || '—'
  const perPerson = useMemo(() => (data?.per_person || []).slice().sort((a, b) => (b.avg || 0) - (a.avg || 0)), [data])
  const perCourse = useMemo(() => (data?.per_course || []).slice().sort((a, b) => b.attempts - a.attempts), [data])
  const overall = useMemo(() => {
    const attempts = perPerson.reduce((s, r) => s + r.attempts, 0)
    const passes = perPerson.reduce((s, r) => s + r.passes, 0)
    const wsum = perPerson.reduce((s, r) => s + (r.avg || 0) * r.attempts, 0)
    return { attempts, avg: attempts ? Math.round(wsum / attempts) : null, passRate: attempts ? Math.round(passes / attempts * 100) : null, people: perPerson.length }
  }, [perPerson])

  function exportCsv() {
    const out = [['Person', 'Attempts', 'Avg score', 'Best', 'Passed']]
    perPerson.forEach(r => out.push([nameOf(r.profile_id), r.attempts, r.avg, r.best, r.passes]))
    downloadCSV(`certifications-${range.from}_to_${range.to}.csv`, out)
  }

  if (err) return <div className="card" style={{ padding: 16, color: 'var(--failed)' }}>Error: {err === 'not authorized' ? 'This report is available to managers only.' : err}</div>
  if (data == null) return <p className="page-sub">Loading…</p>
  const scoreColor = (v) => v == null ? 'var(--ink-soft)' : v >= 90 ? 'var(--passed)' : v >= 80 ? 'var(--accent)' : v >= 70 ? 'var(--needed)' : 'var(--failed)'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Tile label="Quiz attempts" value={overall.attempts} />
        <Tile label="Avg score" value={overall.avg == null ? '—' : overall.avg + '%'} />
        <Tile label="Pass rate" value={overall.passRate == null ? '—' : overall.passRate + '%'} />
        <Tile label="People" value={overall.people} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" onClick={exportCsv}>Export CSV</button></div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', fontWeight: 600 }}>By person</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><Th>Person</Th><Th r>Attempts</Th><Th r>Avg</Th><Th r>Best</Th><Th r>Passed</Th></tr></thead>
          <tbody>
            {perPerson.length === 0 && <tr><td style={cellL} colSpan={5}><span className="page-sub">No quiz attempts in this range.</span></td></tr>}
            {perPerson.map(r => (
              <tr key={r.profile_id}><td style={{ ...cellL, fontWeight: 600 }}>{nameOf(r.profile_id)}</td><td style={cellR}>{r.attempts}</td><td style={{ ...cellR, color: scoreColor(r.avg), fontWeight: 700 }}>{r.avg == null ? '—' : r.avg + '%'}</td><td style={cellR}>{r.best}%</td><td style={cellR}>{r.passes}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', fontWeight: 600 }}>By course</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><Th>Course</Th><Th r>Attempts</Th><Th r>Avg score</Th><Th r>Pass rate</Th></tr></thead>
          <tbody>
            {perCourse.length === 0 && <tr><td style={cellL} colSpan={4}><span className="page-sub">No quiz attempts in this range.</span></td></tr>}
            {perCourse.map(r => (
              <tr key={r.course_id}><td style={{ ...cellL, fontWeight: 600 }}>{r.title || 'Course'}</td><td style={cellR}>{r.attempts}</td><td style={{ ...cellR, color: scoreColor(r.avg), fontWeight: 700 }}>{r.avg == null ? '—' : r.avg + '%'}</td><td style={cellR}>{r.attempts ? Math.round(r.passes / r.attempts * 100) : 0}%</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ================= Cert quiz questions: most missed / most correct =================
function CertQuizReport({ range, allowedIds }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let active = true; setData(null); setErr('')
    const ids = allowedIds ? Array.from(allowedIds) : null
    supabase.rpc('report_cert', { p_from: range.from, p_to: range.to, p_profile_ids: ids })
      .then(({ data, error }) => { if (!active) return; if (error) setErr(error.message); else setData(data) })
    return () => { active = false }
  }, [range.from, range.to, allowedIds])

  const rows = useMemo(() => (data?.per_question || []).map(r => ({
    qid: r.question_id, prompt: r.prompt, total: r.total, correct: r.correct,
    correctPct: r.total ? Math.round(r.correct / r.total * 100) : 0,
  })), [data])

  const overall = useMemo(() => {
    const total = rows.reduce((s, r) => s + r.total, 0)
    const correct = rows.reduce((s, r) => s + r.correct, 0)
    return { answered: total, questions: rows.length, correctPct: total ? Math.round(correct / total * 100) : null }
  }, [rows])

  function exportCsv() {
    const out = [['Question', 'Times answered', 'Correct', 'Correct %']]
    rows.slice().sort((a, b) => a.correctPct - b.correctPct).forEach(r => out.push([r.prompt, r.total, r.correct, r.correctPct + '%']))
    downloadCSV(`cert-quiz-questions-${range.from}_to_${range.to}.csv`, out)
  }

  if (err) return <div className="card" style={{ padding: 16, color: 'var(--failed)' }}>Error: {err === 'not authorized' ? 'This report is available to managers only.' : err}</div>
  if (data == null) return <p className="page-sub">Loading…</p>
  const missed = rows.slice().sort((a, b) => a.correctPct - b.correctPct).slice(0, 15)
  const best = rows.slice().sort((a, b) => b.correctPct - a.correctPct).slice(0, 15)
  const QTable = ({ title, list }) => (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', fontWeight: 600 }}>{title}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><Th>Question</Th><Th r>Answered</Th><Th r>Correct %</Th></tr></thead>
        <tbody>
          {list.length === 0 && <tr><td style={cellL} colSpan={3}><span className="page-sub">No quiz answers in this range.</span></td></tr>}
          {list.map(r => (
            <tr key={r.qid}><td style={{ ...cellL, fontWeight: 500 }}>{r.prompt}</td><td style={cellR}>{r.total}</td><td style={{ ...cellR, color: r.correctPct >= 80 ? 'var(--passed)' : r.correctPct >= 60 ? 'var(--needed)' : 'var(--failed)', fontWeight: 700 }}>{r.correctPct}%</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Tile label="Answers scored" value={overall.answered} />
        <Tile label="Distinct questions" value={overall.questions} />
        <Tile label="Overall correct" value={overall.correctPct == null ? '—' : overall.correctPct + '%'} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" onClick={exportCsv}>Export CSV</button></div>
      <QTable title="Most missed (lowest correct %)" list={missed} />
      <QTable title="Most correct (highest correct %)" list={best} />
      <p className="page-sub" style={{ fontSize: 12 }}>A question is "correct" when the selected option is flagged correct. Ranked across all attempts in the range; top 15 each.</p>
    </div>
  )
}

// ================= Scorecard: agent Five9 productivity (rolling snapshot) =================
function ScorecardReport() {
  const [calls, setCalls] = useState(null)
  const [occ, setOcc] = useState([])
  const [err, setErr] = useState('')
  useEffect(() => {
    let active = true; setCalls(null); setErr('')
    ;(async () => {
      const [{ data: c, error }, { data: o }] = await Promise.all([
        supabase.from('sc_calls').select('agent_name, calls_handled_last_7_days, calls_handled_last_30_days, avg_aht_minutes_last_30_days, bookings_last_30_days, conversion_rate_last_30_days, serviced_hours_last_30_days'),
        supabase.from('sc_occupancy').select('agent_name, total_actual_hours_last_30_days, acw_pct_last_30_days, nr_pct_last_30_days'),
      ])
      if (!active) return
      if (error) { setErr(error.message); return }
      setCalls(c || []); setOcc(o || [])
    })()
    return () => { active = false }
  }, [])

  const occByName = useMemo(() => Object.fromEntries(occ.map(o => [o.agent_name, o])), [occ])
  const rows = useMemo(() => (calls || []).map(c => ({ ...c, ...(occByName[c.agent_name] || {}) })).sort((a, b) => (b.calls_handled_last_30_days || 0) - (a.calls_handled_last_30_days || 0)), [calls, occByName])
  const totals = useMemo(() => ({
    agents: rows.length,
    calls30: rows.reduce((s, r) => s + (r.calls_handled_last_30_days || 0), 0),
    conv: rows.length ? Math.round(rows.reduce((s, r) => s + (Number(r.conversion_rate_last_30_days) || 0), 0) / rows.length) : null,
  }), [rows])

  function exportCsv() {
    const out = [['Agent', 'Calls 7d', 'Calls 30d', 'AHT (min) 30d', 'Bookings 30d', 'Conversion % 30d', 'Serviced hrs 30d', 'Actual hrs 30d', 'ACW % 30d', 'NR % 30d']]
    rows.forEach(r => out.push([r.agent_name, r.calls_handled_last_7_days || 0, r.calls_handled_last_30_days || 0, r.avg_aht_minutes_last_30_days ?? '', r.bookings_last_30_days || 0, r.conversion_rate_last_30_days ?? '', r.serviced_hours_last_30_days ?? '', r.total_actual_hours_last_30_days ?? '', r.acw_pct_last_30_days ?? '', r.nr_pct_last_30_days ?? '']))
    downloadCSV(`scorecard-agent-productivity-${isoDay(new Date())}.csv`, out)
  }

  if (err) return <div className="card" style={{ padding: 16, color: 'var(--failed)' }}>Error: {err}</div>
  if (calls == null) return <p className="page-sub">Loading…</p>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Tile label="Agents" value={totals.agents} />
        <Tile label="Calls (30d)" value={totals.calls30} />
        <Tile label="Avg conversion (30d)" value={totals.conv == null ? '—' : totals.conv + '%'} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" onClick={exportCsv}>Export CSV</button></div>
      <div className="card" style={{ padding: 0, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
          <thead><tr><Th>Agent</Th><Th r>Calls 7d</Th><Th r>Calls 30d</Th><Th r>AHT min</Th><Th r>Bookings</Th><Th r>Conv %</Th><Th r>Serviced hrs</Th><Th r>ACW %</Th><Th r>NR %</Th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td style={cellL} colSpan={9}><span className="page-sub">No scorecard data synced.</span></td></tr>}
            {rows.map(r => (
              <tr key={r.agent_name}>
                <td style={{ ...cellL, fontWeight: 600 }}>{r.agent_name}</td>
                <td style={cellR}>{r.calls_handled_last_7_days || 0}</td>
                <td style={cellR}>{r.calls_handled_last_30_days || 0}</td>
                <td style={cellR}>{r.avg_aht_minutes_last_30_days ?? '—'}</td>
                <td style={cellR}>{r.bookings_last_30_days || 0}</td>
                <td style={cellR}>{r.conversion_rate_last_30_days == null ? '—' : r.conversion_rate_last_30_days + '%'}</td>
                <td style={cellR}>{r.serviced_hours_last_30_days ?? '—'}</td>
                <td style={cellR}>{r.acw_pct_last_30_days == null ? '—' : r.acw_pct_last_30_days + '%'}</td>
                <td style={cellR}>{r.nr_pct_last_30_days == null ? '—' : r.nr_pct_last_30_days + '%'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="page-sub" style={{ fontSize: 12 }}>Rolling Five9 snapshots (last 7 / 30 days) synced from BigQuery — not bound to the date range above. Arbitrary-range agent time is a later BigQuery add.</p>
    </div>
  )
}

// ================= Call Dispositions (Five9, recent) =================
// Deal segment from the Five9 campaign (per the Hourly dashboards mapping):
// "Open Invoices%" → Open Invoices; Lavin/Kashurba/Web Leads → Affiliate; else Other.
function dealOf(campaign) {
  const c = String(campaign || '').trim()
  if (/^open invoices/i.test(c)) return 'Open Invoices'
  if (/^(lavin|kashurba|web ?leads)/i.test(c)) return 'Affiliate'
  return 'Other'
}
const DISPO_DETAIL_CAP = 500

function DispositionsReport() {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let active = true; setRows(null); setErr('')
    ;(async () => {
      const page = 1000; let from = 0; let all = []
      for (;;) {
        const { data, error } = await supabase.from('f9_calls_today').select('agent_name, disposition, work_date, hour_int, brand, campaign').range(from, from + page - 1)
        if (error) { if (active) setErr(error.message); return }
        all = all.concat(data || [])
        if (!data || data.length < page) break
        from += page
      }
      if (!active) return
      setRows(all)
    })()
    return () => { active = false }
  }, [])

  const model = useMemo(() => {
    const byDisp = {}, byAgent = {}, byDeal = {}
    const dateSet = new Set()
    for (const c of (rows || [])) {
      const d = c.disposition || '—'
      byDisp[d] = (byDisp[d] || 0) + 1
      const a = c.agent_name || '—'
      byAgent[a] = (byAgent[a] || 0) + 1
      byDeal[dealOf(c.campaign)] = (byDeal[dealOf(c.campaign)] || 0) + 1
      if (c.work_date) dateSet.add(c.work_date)
    }
    // Call-level detail, most recent first (by date then hour).
    const detail = (rows || []).slice().sort((a, b) => {
      const dc = String(b.work_date || '').localeCompare(String(a.work_date || ''))
      if (dc) return dc
      return (b.hour_int ?? -1) - (a.hour_int ?? -1)
    })
    return { byDisp, byAgent, byDeal, detail, total: (rows || []).length, days: dateSet.size }
  }, [rows])

  function exportCsv() {
    const out = [['Call Date', 'Agent', 'Brand', 'Deal', 'Disposition']]
    model.detail.forEach(c => out.push([c.work_date || '', c.agent_name || '', c.brand || '', dealOf(c.campaign), c.disposition || '']))
    downloadCSV(`call-dispositions-${isoDay(new Date())}.csv`, out)
  }

  if (err) return <div className="card" style={{ padding: 16, color: 'var(--failed)' }}>Error: {err === 'permission denied for table f9_calls_today' ? 'This report is available to managers only.' : err}</div>
  if (rows == null) return <p className="page-sub">Loading…</p>
  const dispRows = Object.entries(model.byDisp).sort((a, b) => b[1] - a[1])
  const agentRows = Object.entries(model.byAgent).sort((a, b) => b[1] - a[1])
  const dealRows = Object.entries(model.byDeal).sort((a, b) => b[1] - a[1])
  const shown = model.detail.slice(0, DISPO_DETAIL_CAP)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Tile label="Calls" value={model.total} />
        <Tile label="Dispositions" value={dispRows.length} />
        <Tile label="Agents" value={agentRows.length} />
        <Tile label="Deals" value={dealRows.length} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" onClick={exportCsv}>Export CSV</button></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14 }}>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', fontWeight: 600 }}>By disposition</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><Th>Disposition</Th><Th r>Calls</Th><Th r>%</Th></tr></thead>
            <tbody>
              {dispRows.length === 0 && <tr><td style={cellL} colSpan={3}><span className="page-sub">No recent call data.</span></td></tr>}
              {dispRows.map(([d, n]) => <tr key={d}><td style={{ ...cellL, fontWeight: 600 }}>{d}</td><td style={cellR}>{n}</td><td style={cellR}>{model.total ? Math.round(n / model.total * 100) : 0}%</td></tr>)}
            </tbody>
          </table>
        </div>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', fontWeight: 600 }}>By deal</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><Th>Deal</Th><Th r>Calls</Th><Th r>%</Th></tr></thead>
            <tbody>
              {dealRows.length === 0 && <tr><td style={cellL} colSpan={3}><span className="page-sub">No recent call data.</span></td></tr>}
              {dealRows.map(([d, n]) => <tr key={d}><td style={{ ...cellL, fontWeight: 600 }}>{d}</td><td style={cellR}>{n}</td><td style={cellR}>{model.total ? Math.round(n / model.total * 100) : 0}%</td></tr>)}
            </tbody>
          </table>
        </div>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', fontWeight: 600 }}>By agent</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><Th>Agent</Th><Th r>Calls</Th></tr></thead>
            <tbody>
              {agentRows.map(([a, n]) => <tr key={a}><td style={{ ...cellL, fontWeight: 600 }}>{a}</td><td style={cellR}>{n}</td></tr>)}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Call detail</span>
          <span className="page-sub" style={{ fontSize: 12, fontWeight: 400 }}>{shown.length < model.total ? `Showing ${shown.length} of ${model.total} — Export CSV for all` : `${model.total} call${model.total === 1 ? '' : 's'}`}</span>
        </div>
        <div style={{ maxHeight: 520, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0, background: 'var(--bg, #fff)', zIndex: 1 }}><tr><Th>Call date</Th><Th>Agent</Th><Th>Brand</Th><Th>Deal</Th><Th>Disposition</Th></tr></thead>
            <tbody>
              {shown.length === 0 && <tr><td style={cellL} colSpan={5}><span className="page-sub">No recent call data.</span></td></tr>}
              {shown.map((c, i) => (
                <tr key={i}>
                  <td style={cellL}>{c.work_date || '—'}</td>
                  <td style={{ ...cellL, fontWeight: 600 }}>{c.agent_name || '—'}</td>
                  <td style={cellL}>{c.brand || '—'}</td>
                  <td style={cellL}>{dealOf(c.campaign)}</td>
                  <td style={cellL}>{c.disposition || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="page-sub" style={{ fontSize: 12 }}>Live Five9 dispositions from the rolling ~3-day window ({model.days} day{model.days === 1 ? '' : 's'} loaded). Deal is derived from the Five9 campaign (Open Invoices vs Affiliate). Full history by date range needs the BigQuery pull (planned).</p>
    </div>
  )
}

// ================= Disposition Corrections (from QA audits) =================
// Surfaces the QA "disposition correction" set inside Reporting so it's easy to
// find. Same source as the Quality Audit module: qa_audits rows where the auditor
// entered a correct_disposition. Two exports: full and Call-ID-only (for Five9).
function DispoCorrectionsReport({ range }) {
  const [audits, setAudits] = useState(null)
  const [auditorMap, setAuditorMap] = useState({})
  const [err, setErr] = useState('')
  useEffect(() => {
    let active = true; setAudits(null); setErr('')
    const fromISO = new Date(range.from + 'T00:00:00').toISOString()
    const toISO = new Date(range.to + 'T23:59:59').toISOString()
    ;(async () => {
      const [{ data, error }, { data: profs }] = await Promise.all([
        supabase.from('qa_audits').select('*').gte('created_at', fromISO).lte('created_at', toISO).order('created_at', { ascending: false }),
        supabase.from('profiles').select('id, full_name'),
      ])
      if (!active) return
      if (error) { setErr(error.message); return }
      const m = {}; (profs || []).forEach(p => { m[p.id] = p.full_name }); setAuditorMap(m)
      setAudits(data || [])
    })()
    return () => { active = false }
  }, [range.from, range.to])

  const rows = useMemo(() => (audits || []).filter(a => a.correct_disposition && String(a.correct_disposition).trim()), [audits])
  const changed = useMemo(() => rows.filter(a => (a.current_disposition || '') !== (a.correct_disposition || '')).length, [rows])
  const agentCount = useMemo(() => new Set(rows.map(a => a.agent_name).filter(Boolean)).size, [rows])

  function exportFull() {
    const header = ['Audited On', 'Agent', 'Auditor', 'Campaign', 'Brand', 'Call Date', 'Current Disposition', 'Correct Disposition', 'Changed?', 'QA Score', 'Feedback', 'Call ID', 'Recording']
    const out = [header, ...rows.map(a => [
      a.created_at ? a.created_at.slice(0, 10) : '', a.agent_name || '', auditorMap[a.auditor_id] || '',
      a.campaign || '', a.brand || '', a.call_date || '', a.current_disposition || '', a.correct_disposition || '',
      ((a.current_disposition || '') !== (a.correct_disposition || '')) ? 'Yes' : 'No',
      a.clean_qa_score == null ? '' : a.clean_qa_score, a.feedback || '', a.call_id || '', a.recording_link || '',
    ])]
    downloadCSV(`disposition-corrections-${isoDay(new Date())}.csv`, out)
  }
  function exportSlim() {
    const header = ['Call ID', 'Current Disposition', 'Correct Disposition']
    const out = [header, ...rows.map(a => [a.call_id || '', a.current_disposition || '', a.correct_disposition || ''])]
    downloadCSV(`disposition-corrections-slim-${isoDay(new Date())}.csv`, out)
  }

  if (err) return <div className="card" style={{ padding: 16, color: 'var(--failed)' }}>Error: {err === 'permission denied for table qa_audits' ? 'This report is available to auditors and managers only.' : err}</div>
  if (audits == null) return <p className="page-sub">Loading…</p>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Tile label="Corrections" value={rows.length} />
        <Tile label="Disposition changed" value={changed} />
        <Tile label="Agents" value={agentCount} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button className="btn btn-primary" onClick={exportFull}>Export CSV (full)</button>
        <button className="btn btn-primary" onClick={exportSlim}>Export CSV (Call ID + dispositions)</button>
      </div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Disposition corrections</span>
          <span className="page-sub" style={{ fontSize: 12, fontWeight: 400 }}>{rows.length} correction{rows.length === 1 ? '' : 's'} in range</span>
        </div>
        <div style={{ maxHeight: 560, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0, background: 'var(--bg, #fff)', zIndex: 1 }}>
              <tr><Th>Audited</Th><Th>Agent</Th><Th>Brand</Th><Th>Call date</Th><Th>Current disposition</Th><Th>Correct disposition</Th><Th>Changed?</Th><Th>Call ID</Th></tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td style={cellL} colSpan={8}><span className="page-sub">No disposition corrections in this date range.</span></td></tr>}
              {rows.map((a, i) => {
                const chg = (a.current_disposition || '') !== (a.correct_disposition || '')
                return (
                  <tr key={a.id || i}>
                    <td style={cellL}>{a.created_at ? a.created_at.slice(0, 10) : '—'}</td>
                    <td style={{ ...cellL, fontWeight: 600 }}>{a.agent_name || '—'}</td>
                    <td style={cellL}>{a.brand || '—'}</td>
                    <td style={cellL}>{a.call_date || '—'}</td>
                    <td style={cellL}>{a.current_disposition || '—'}</td>
                    <td style={{ ...cellL, fontWeight: 600 }}>{a.correct_disposition || '—'}</td>
                    <td style={cellL}>{chg ? <span className="badge" style={{ background: 'var(--failed-bg, #fde8e8)', color: 'var(--failed, #b42318)', fontWeight: 700 }}>Yes</span> : '—'}</td>
                    <td style={{ ...cellL, fontFamily: 'monospace', fontSize: 12 }}>{a.call_id || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      <p className="page-sub" style={{ fontSize: 12 }}>From QA audits where the auditor entered a corrected disposition (same source as the Quality Audit module). The slim export (Call ID + Current + Correct) is the one for re-dispositioning in Five9.</p>
    </div>
  )
}

// ================= Clients =================
function ClientsReport({ range }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let active = true; setRows(null); setErr('')
    supabase.from('clients').select('id, name, uses_five9, created_at').order('name')
      .then(({ data, error }) => { if (!active) return; if (error) setErr(error.message); else setRows(data || []) })
    return () => { active = false }
  }, [])

  const inRange = (r) => r.created_at && r.created_at.slice(0, 10) >= range.from && r.created_at.slice(0, 10) <= range.to
  const totals = useMemo(() => ({
    total: (rows || []).length,
    five9: (rows || []).filter(r => r.uses_five9).length,
    added: (rows || []).filter(inRange).length,
  }), [rows, range.from, range.to])

  function exportCsv() {
    const out = [['Client', 'Uses Five9', 'Added']]
    ;(rows || []).forEach(r => out.push([r.name, r.uses_five9 ? 'Yes' : 'No', r.created_at ? new Date(r.created_at).toLocaleDateString() : '']))
    downloadCSV(`clients-${isoDay(new Date())}.csv`, out)
  }

  if (err) return <div className="card" style={{ padding: 16, color: 'var(--failed)' }}>Error: {err}</div>
  if (rows == null) return <p className="page-sub">Loading…</p>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Tile label="Clients" value={totals.total} />
        <Tile label="Use Five9" value={totals.five9} />
        <Tile label="Added in range" value={totals.added} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" onClick={exportCsv}>Export CSV</button></div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><Th>Client</Th><Th>Five9</Th><Th r>Added</Th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}><td style={{ ...cellL, fontWeight: 600 }}>{r.name}</td><td style={cellL}>{r.uses_five9 ? 'Yes' : '—'}</td><td style={cellR}>{r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="page-sub" style={{ fontSize: 12 }}>"Added in range" uses the date range above; the list shows all current clients.</p>
    </div>
  )
}

// ================= Positions (roles + headcount) =================
function PositionsReport() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let active = true; setData(null); setErr('')
    ;(async () => {
      // Count by the person's ACTUAL role (profiles.role) — the authoritative field
      // the app uses for permissions. The roles table just supplies labels + levels.
      const [{ data: profs, error }, { data: roles }] = await Promise.all([
        supabase.from('profiles').select('role, is_active'),
        supabase.from('roles').select('key, name, level'),
      ])
      if (!active) return
      if (error) { setErr(error.message); return }
      setData({ profs: profs || [], roles: roles || [] })
    })()
    return () => { active = false }
  }, [])

  const rows = useMemo(() => {
    if (!data) return []
    const meta = Object.fromEntries(data.roles.map(r => [r.key, r]))
    const m = {}
    for (const p of data.profs) {
      if (!p.is_active) continue
      const key = (p.role || 'unassigned')
      if (key === 'client') continue // external portal logins aren't staff positions
      m[key] = (m[key] || 0) + 1
    }
    return Object.entries(m).map(([key, count]) => ({
      key, count, label: ROLE_LABELS[key] || meta[key]?.name || key, level: meta[key]?.level ?? null,
    })).sort((a, b) => (b.level ?? -1) - (a.level ?? -1) || b.count - a.count)
  }, [data])
  const totalPeople = rows.reduce((s, r) => s + r.count, 0)

  function exportCsv() {
    const out = [['Position', 'Level', 'People']]
    rows.forEach(r => out.push([r.label, r.level ?? '', r.count]))
    downloadCSV(`positions-${isoDay(new Date())}.csv`, out)
  }

  if (err) return <div className="card" style={{ padding: 16, color: 'var(--failed)' }}>Error: {err}</div>
  if (data == null) return <p className="page-sub">Loading…</p>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Tile label="Positions in use" value={rows.length} />
        <Tile label="Active staff" value={totalPeople} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" onClick={exportCsv}>Export CSV</button></div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><Th>Position</Th><Th r>Level</Th><Th r>People</Th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td style={cellL} colSpan={3}><span className="page-sub">No active staff.</span></td></tr>}
            {rows.map(r => (
              <tr key={r.key}><td style={{ ...cellL, fontWeight: 600 }}>{r.label}</td><td style={cellR}>{r.level ?? '—'}</td><td style={cellR}>{r.count}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="page-sub" style={{ fontSize: 12 }}>Headcount by each person's active role (excludes external client logins). Snapshot — not date-bound.</p>
    </div>
  )
}

// ================= Schedule: per-agent summary (intervals, check-in, on-task, Five9) =================
function schedMins(b) {
  if (!b) return 0
  const [sh, sm] = (b.start_time || '00:00').slice(0, 5).split(':').map(Number)
  const [eh, em] = (b.end_time || '00:00').slice(0, 5).split(':').map(Number)
  return Math.max(0, (eh * 60 + em) - (sh * 60 + sm))
}
const isoLocalDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
// Split a [start,end] time span into per-hour buckets: [{date,hour,mins}].
function hourSplit(start, end) {
  const out = []
  let cur = start instanceof Date ? new Date(start) : new Date(start)
  const e = end instanceof Date ? end : new Date(end)
  let guard = 0
  while (cur < e && guard++ < 100000) {
    const nb = new Date(cur); nb.setMinutes(0, 0, 0); nb.setHours(cur.getHours() + 1)
    const segEnd = nb < e ? nb : e
    const mins = Math.max(0, Math.round((segEnd - cur) / 60000))
    if (mins > 0) out.push({ date: isoLocalDate(cur), hour: cur.getHours(), mins })
    cur = segEnd
  }
  return out
}
function SchedAgentReport({ range, profiles, allowedIds }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const [gran, setGran] = useState('summary') // 'summary' | 'day' | 'hour'
  useEffect(() => {
    let active = true; setD(null); setErr('')
    ;(async () => {
      const { data: blocks, error: be } = await supabase.from('shift_blocks').select('id, block_date, start_time, end_time').gte('block_date', range.from).lte('block_date', range.to)
      if (be) { if (active) setErr(be.message); return }
      const ids = (blocks || []).map(b => b.id)
      let claims = []
      for (let i = 0; i < ids.length; i += 500) {
        const { data: c } = await supabase.from('shift_claims').select('shift_block_id, profile_id, status, checked_in_at, checked_out_at').in('shift_block_id', ids.slice(i, i + 500))
        claims = claims.concat(c || [])
      }
      const [{ data: te }, { data: agents }, { data: occDay }] = await Promise.all([
        supabase.from('time_entries').select('user_id, duration_minutes, started_at').not('duration_minutes', 'is', null).gte('started_at', dayStart(range.from)).lte('started_at', dayEnd(range.to)),
        supabase.from('sc_agents').select('agent_name, profile_id'),
        supabase.from('sc_occupancy_day').select('agent_name, work_date, login_hours, nr_hours').gte('work_date', range.from).lte('work_date', range.to),
      ])
      if (!active) return
      setD({ blocks: blocks || [], claims, te: te || [], agents: agents || [], occDay: occDay || [] })
    })()
    return () => { active = false }
  }, [range.from, range.to])

  const nameOf = (id) => (profiles.find(p => p.id === id) || {}).full_name || '—'
  const roleOf = (id) => (profiles.find(p => p.id === id) || {}).role || '—'
  const rows = useMemo(() => {
    if (!d) return []
    const blockById = Object.fromEntries(d.blocks.map(b => [b.id, b]))
    const agByName = {}; d.agents.forEach(a => { if (a.profile_id) agByName[a.agent_name] = a.profile_id })
    // Agent OCCUPANCY (login − not ready), in hours, keyed by pid|date and summed per pid.
    const occByDate = {}, occSum = {}
    for (const o of (d.occDay || [])) { const pid = agByName[o.agent_name]; if (!pid) continue; const occ = Math.max(0, (Number(o.login_hours) || 0) - (Number(o.nr_hours) || 0)); occByDate[pid + '|' + o.work_date] = (occByDate[pid + '|' + o.work_date] || 0) + occ; occSum[pid] = (occSum[pid] || 0) + occ }

    const per = new Map()
    const keyFor = (pid, date, hour) => gran === 'summary' ? pid : gran === 'day' ? pid + '|' + date : pid + '|' + date + '|' + hour
    const ensure = (pid, date, hour) => { const k = keyFor(pid, date, hour); if (!per.has(k)) per.set(k, { pid, date, hour, intervals: 0, schedMin: 0, clockMin: 0, taskMin: 0 }); return per.get(k) }

    for (const c of d.claims) {
      if (c.status === 'no_show') continue
      const b = blockById[c.shift_block_id]; if (!b) continue
      if (gran === 'hour') {
        const bStart = new Date(`${b.block_date}T${(b.start_time || '00:00').slice(0, 5)}:00`)
        const bEnd = new Date(`${b.block_date}T${(b.end_time || '00:00').slice(0, 5)}:00`)
        hourSplit(bStart, bEnd).forEach(seg => { ensure(c.profile_id, seg.date, seg.hour).schedMin += seg.mins })
        ensure(c.profile_id, b.block_date, bStart.getHours()).intervals++
      } else {
        const e = ensure(c.profile_id, gran === 'day' ? b.block_date : null, null)
        e.schedMin += schedMins(b); e.intervals++
      }
      if (c.checked_in_at && c.checked_out_at && (c.status === 'completed' || c.status === 'approved')) {
        const ci = new Date(c.checked_in_at), co = new Date(c.checked_out_at)
        if (gran === 'hour') hourSplit(ci, co).forEach(seg => { ensure(c.profile_id, seg.date, seg.hour).clockMin += seg.mins })
        else ensure(c.profile_id, gran === 'day' ? isoLocalDate(ci) : null, null).clockMin += Math.max(0, Math.round((co - ci) / 60000))
      }
    }
    for (const en of d.te) {
      const st = new Date(en.started_at)
      if (gran === 'hour') ensure(en.user_id, isoLocalDate(st), st.getHours()).taskMin += (en.duration_minutes || 0)
      else ensure(en.user_id, gran === 'day' ? isoLocalDate(st) : null, null).taskMin += (en.duration_minutes || 0)
    }
    for (const v of per.values()) {
      // Occupancy = login − not ready (Five9). It's a DAILY figure, so the hour view can't split it (—).
      if (gran === 'summary') v.five9 = occSum[v.pid] != null ? Math.round(occSum[v.pid] * 100) / 100 : null
      else if (gran === 'day') v.five9 = occByDate[v.pid + '|' + v.date] != null ? Math.round(occByDate[v.pid + '|' + v.date] * 100) / 100 : null
      else v.five9 = null
    }
    return Array.from(per.values())
      .filter(r => !allowedIds || allowedIds.has(r.pid))
      .sort((a, b) => gran === 'summary' ? b.schedMin - a.schedMin
        : (nameOf(a.pid).localeCompare(nameOf(b.pid)) || String(a.date || '').localeCompare(String(b.date || '')) || (a.hour ?? 0) - (b.hour ?? 0)))
  }, [d, allowedIds, gran])

  // "Intervals" (a whole scheduled shift) only makes sense at summary/day level;
  // at the hour level it's confusing, so we drop that column and show scheduled hrs.
  const showDate = gran !== 'summary', showHour = gran === 'hour', showIntervals = gran !== 'hour'
  function exportCsv() {
    const head = ['Person', 'Role', ...(showDate ? ['Date'] : []), ...(showHour ? ['Hour'] : []), ...(showIntervals ? ['Intervals'] : []), 'Scheduled hrs', 'Checked-in hrs', 'On-task hrs', 'Occupancy hrs']
    const out = [head]
    rows.forEach(r => out.push([nameOf(r.pid), ROLE_LABELS[roleOf(r.pid)] || roleOf(r.pid), ...(showDate ? [r.date] : []), ...(showHour ? [hourLabel(r.hour)] : []), ...(showIntervals ? [r.intervals] : []), hoursFromMinutes(r.schedMin), hoursFromMinutes(r.clockMin), hoursFromMinutes(r.taskMin), r.five9 ?? '']))
    downloadCSV(`agent-schedule-${gran}-${range.from}_to_${range.to}.csv`, out)
  }

  if (err) return <div className="card" style={{ padding: 16, color: 'var(--failed)' }}>Error: {err}</div>
  if (d == null) return <p className="page-sub">Loading…</p>
  const people = new Set(rows.map(r => r.pid)).size
  const colSpan = 6 + (showDate ? 1 : 0) + (showHour ? 1 : 0) + (showIntervals ? 1 : 0)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
          {[['summary', 'Summary'], ['day', 'By day'], ['hour', 'By hour']].map(([g, l]) => (
            <button key={g} onClick={() => setGran(g)} style={{ padding: '7px 14px', border: 0, background: gran === g ? 'var(--accent)' : 'var(--surface)', color: gran === g ? '#fff' : 'var(--ink-soft)', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit' }}>{l}</button>
          ))}
        </div>
        <Tile label="People scheduled" value={people} />
        <Tile label="Intervals" value={rows.reduce((s, r) => s + r.intervals, 0)} />
        <Tile label="Scheduled hrs" value={hoursFromMinutes(rows.reduce((s, r) => s + r.schedMin, 0))} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" onClick={exportCsv}>Export CSV</button></div>
      <div className="card" style={{ padding: 0, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
          <thead><tr><Th>Person</Th><Th>Role</Th>{showDate && <Th>Date</Th>}{showHour && <Th>Hour</Th>}{showIntervals && <Th r>Intervals</Th>}<Th r>Scheduled</Th><Th r>Checked-in</Th><Th r>On-task</Th><Th r title="Five9 occupancy = login − not ready">Occupancy</Th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td style={cellL} colSpan={colSpan}><span className="page-sub">No scheduled intervals in this range.</span></td></tr>}
            {rows.map((r, i) => (
              <tr key={i}>
                <td style={{ ...cellL, fontWeight: 600 }}>{nameOf(r.pid)}</td>
                <td style={cellL}>{ROLE_LABELS[roleOf(r.pid)] || roleOf(r.pid)}</td>
                {showDate && <td style={cellL}>{r.date}</td>}
                {showHour && <td style={cellL}>{hourLabel(r.hour)}</td>}
                {showIntervals && <td style={cellR}>{r.intervals || '—'}</td>}
                <td style={cellR}>{hoursFromMinutes(r.schedMin)}</td>
                <td style={cellR}>{hoursFromMinutes(r.clockMin)}</td>
                <td style={cellR}>{hoursFromMinutes(r.taskMin)}</td>
                <td style={{ ...cellR, color: r.five9 == null ? 'var(--ink-soft)' : 'var(--accent)' }}>{r.five9 == null ? '—' : r.five9}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="page-sub" style={{ fontSize: 12 }}>
        <b>Interval</b> = one scheduled shift; <b>Scheduled</b> = the hours in that shift. In <b>By hour</b>, scheduled &amp; checked-in time is split across the hours a shift spans (so a row can show scheduled hours with no shift <i>starting</i> that hour). A row with 0 scheduled but check-in or Five9 time means the person was active <i>outside</i> their scheduled interval (e.g. checked in early). On-task is bucketed by start time.
        {' '}<b>Occupancy</b> = Five9 login hours − not-ready hours (agents), covering the last ~31 days. It's a daily figure, so the <b>By hour</b> view can't split it (shows —); use <b>By day</b> or <b>Summary</b> for occupancy.
      </p>
    </div>
  )
}

// ================= Project Management: tasks by person =================
function TasksByPersonReport({ range, profiles, allowedIds }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let active = true; setD(null); setErr('')
    ;(async () => {
      const [{ data: tasks, error }, { data: asg }] = await Promise.all([
        supabase.from('tasks').select('id, status, due_date, created_at').is('deleted_at', null).gte('created_at', dayStart(range.from)).lte('created_at', dayEnd(range.to)),
        supabase.from('task_assignees').select('task_id, profile_id'),
      ])
      if (!active) return
      if (error) { setErr(error.message); return }
      setD({ tasks: tasks || [], asg: asg || [] })
    })()
    return () => { active = false }
  }, [range.from, range.to])

  const nameOf = (id) => (profiles.find(p => p.id === id) || {}).full_name || '—'
  const days = Math.max(1, Math.round((new Date(range.to) - new Date(range.from)) / 86400000) + 1)
  const rows = useMemo(() => {
    if (!d) return []
    const taskById = Object.fromEntries(d.tasks.map(t => [t.id, t]))
    const today = isoDay(new Date())
    const per = {}
    for (const a of d.asg) {
      const t = taskById[a.task_id]
      if (!t) continue // task not in range
      if (allowedIds && !allowedIds.has(a.profile_id)) continue
      const p = (per[a.profile_id] = per[a.profile_id] || { assigned: 0, open: 0, overdue: 0, done: 0 })
      p.assigned++
      if (t.status === 'done') p.done++
      else {
        p.open++
        if (t.due_date && t.due_date < today) p.overdue++
      }
    }
    return Object.entries(per).map(([pid, v]) => ({ pid, ...v, perDay: Math.round(v.assigned / days * 10) / 10 })).sort((a, b) => b.assigned - a.assigned)
  }, [d, allowedIds, days])

  function exportCsv() {
    const out = [['Person', 'Assigned', 'Open', 'Overdue', 'Done', 'Avg/day']]
    rows.forEach(r => out.push([nameOf(r.pid), r.assigned, r.open, r.overdue, r.done, r.perDay]))
    downloadCSV(`tasks-by-person-${range.from}_to_${range.to}.csv`, out)
  }

  if (err) return <div className="card" style={{ padding: 16, color: 'var(--failed)' }}>Error: {err}</div>
  if (d == null) return <p className="page-sub">Loading…</p>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Tile label="Tasks (in range)" value={d.tasks.length} />
        <Tile label="People with tasks" value={rows.length} />
        <Tile label="Overdue" value={rows.reduce((s, r) => s + r.overdue, 0)} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" onClick={exportCsv}>Export CSV</button></div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><Th>Person</Th><Th r>Assigned</Th><Th r>Open</Th><Th r>Overdue</Th><Th r>Done</Th><Th r>Avg/day</Th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td style={cellL} colSpan={6}><span className="page-sub">No assigned tasks created in this range.</span></td></tr>}
            {rows.map(r => (
              <tr key={r.pid}>
                <td style={{ ...cellL, fontWeight: 600 }}>{nameOf(r.pid)}</td>
                <td style={cellR}>{r.assigned}</td>
                <td style={cellR}>{r.open}</td>
                <td style={{ ...cellR, color: r.overdue ? 'var(--failed)' : 'var(--ink-soft)' }}>{r.overdue || '—'}</td>
                <td style={cellR}>{r.done}</td>
                <td style={cellR}>{r.perDay}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="page-sub" style={{ fontSize: 12 }}>Counts tasks <b>created</b> in the range and assigned to each person. Overdue = past due date and not done. Avg/day = assigned ÷ {days} days.</p>
    </div>
  )
}

// ================= Project Management: off-clock task time =================
function OffClockReport({ range, profiles, allowedIds }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let active = true; setD(null); setErr('')
    ;(async () => {
      // widen the claim window by a day on each side so an entry near a shift edge still matches.
      const cFrom = new Date(range.from + 'T00:00:00'); cFrom.setDate(cFrom.getDate() - 1)
      const cTo = new Date(range.to + 'T23:59:59'); cTo.setDate(cTo.getDate() + 1)
      const [{ data: te, error }, { data: claims }] = await Promise.all([
        supabase.from('time_entries').select('user_id, duration_minutes, started_at').not('duration_minutes', 'is', null).gte('started_at', dayStart(range.from)).lte('started_at', dayEnd(range.to)),
        supabase.from('shift_claims').select('profile_id, checked_in_at, checked_out_at').not('checked_in_at', 'is', null).gte('checked_in_at', cFrom.toISOString()).lte('checked_in_at', cTo.toISOString()),
      ])
      if (!active) return
      if (error) { setErr(error.message); return }
      setD({ te: te || [], claims: claims || [] })
    })()
    return () => { active = false }
  }, [range.from, range.to])

  const nameOf = (id) => (profiles.find(p => p.id === id) || {}).full_name || '—'
  const rows = useMemo(() => {
    if (!d) return []
    // Windows per user: [checked_in, checked_out || +12h fallback].
    const winByUser = {}
    for (const c of d.claims) {
      const start = new Date(c.checked_in_at).getTime()
      const end = c.checked_out_at ? new Date(c.checked_out_at).getTime() : start + 12 * 3600000
      ;(winByUser[c.profile_id] = winByUser[c.profile_id] || []).push([start, end])
    }
    const onClock = (uid, ts) => {
      const t = new Date(ts).getTime()
      return (winByUser[uid] || []).some(([s, e]) => t >= s && t <= e)
    }
    const per = {}
    for (const e of d.te) {
      if (allowedIds && !allowedIds.has(e.user_id)) continue
      const p = (per[e.user_id] = per[e.user_id] || { total: 0, on: 0, off: 0 })
      const m = e.duration_minutes || 0
      p.total += m
      if (onClock(e.user_id, e.started_at)) p.on += m; else p.off += m
    }
    return Object.entries(per).map(([pid, v]) => ({ pid, ...v, offPct: v.total ? Math.round(v.off / v.total * 100) : 0 })).sort((a, b) => b.off - a.off)
  }, [d, allowedIds])

  function exportCsv() {
    const out = [['Person', 'Total task hrs', 'On-clock hrs', 'Off-clock hrs', 'Off-clock %']]
    rows.forEach(r => out.push([nameOf(r.pid), hoursFromMinutes(r.total), hoursFromMinutes(r.on), hoursFromMinutes(r.off), r.offPct + '%']))
    downloadCSV(`off-clock-task-time-${range.from}_to_${range.to}.csv`, out)
  }

  if (err) return <div className="card" style={{ padding: 16, color: 'var(--failed)' }}>Error: {err}</div>
  if (d == null) return <p className="page-sub">Loading…</p>
  const totalOff = rows.reduce((s, r) => s + r.off, 0)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Tile label="Total task hrs" value={hoursFromMinutes(rows.reduce((s, r) => s + r.total, 0))} />
        <Tile label="Off-clock hrs" value={hoursFromMinutes(totalOff)} />
        <Tile label="People" value={rows.length} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" onClick={exportCsv}>Export CSV</button></div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><Th>Person</Th><Th r>Total task</Th><Th r>On-clock</Th><Th r>Off-clock</Th><Th r>Off-clock %</Th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td style={cellL} colSpan={5}><span className="page-sub">No tracked task time in this range.</span></td></tr>}
            {rows.map(r => (
              <tr key={r.pid}>
                <td style={{ ...cellL, fontWeight: 600 }}>{nameOf(r.pid)}</td>
                <td style={cellR}>{hoursFromMinutes(r.total)}</td>
                <td style={cellR}>{hoursFromMinutes(r.on)}</td>
                <td style={{ ...cellR, color: r.off ? 'var(--needed)' : 'var(--ink-soft)', fontWeight: 600 }}>{hoursFromMinutes(r.off)}</td>
                <td style={{ ...cellR, color: r.offPct >= 25 ? 'var(--failed)' : 'var(--ink-soft)' }}>{r.offPct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="page-sub" style={{ fontSize: 12 }}>A task entry is "on-clock" when it starts inside a checked-in shift window (open shifts assume a 12-hour cap); otherwise it's off-clock. Classified by the entry's start time.</p>
    </div>
  )
}

// ================= Knowledge Base: article reads / unread per person =================
function KbReport({ profiles, allowedIds }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let active = true; setD(null); setErr('')
    ;(async () => {
      const [{ data: arts, error }, { data: reads }] = await Promise.all([
        supabase.from('kb_articles').select('id, title, status').eq('status', 'published'),
        supabase.from('kb_article_reads').select('article_id, profile_id'),
      ])
      if (!active) return
      if (error) { setErr(error.message); return }
      setD({ arts: arts || [], reads: reads || [] })
    })()
    return () => { active = false }
  }, [])

  const nameOf = (id) => (profiles.find(p => p.id === id) || {}).full_name || '—'
  const model = useMemo(() => {
    if (!d) return null
    const byPerson = {}, byArticle = {}
    const pubIds = new Set(d.arts.map(a => a.id))
    for (const r of d.reads) {
      if (allowedIds && !allowedIds.has(r.profile_id)) continue
      if (!pubIds.has(r.article_id)) continue
      ;(byPerson[r.profile_id] = byPerson[r.profile_id] || new Set()).add(r.article_id)
      ;(byArticle[r.article_id] = byArticle[r.article_id] || new Set()).add(r.profile_id)
    }
    return { totalPub: d.arts.length, byPerson, byArticle, titleOf: (id) => (d.arts.find(a => a.id === id) || {}).title || 'Article' }
  }, [d, allowedIds])
  const roster = useMemo(() => profiles.filter(p => p.is_active !== false && (!allowedIds || allowedIds.has(p.id))).sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '')), [profiles, allowedIds])

  function exportCsv() {
    const out = [['Person', 'Read', 'Unread', 'Read %']]
    roster.forEach(p => { const read = model.byPerson[p.id]?.size || 0; const pct = model.totalPub ? Math.round(read / model.totalPub * 100) : 0; out.push([p.full_name, read, Math.max(0, model.totalPub - read), pct + '%']) })
    downloadCSV(`kb-reads-${isoDay(new Date())}.csv`, out)
  }

  if (err) return <div className="card" style={{ padding: 16, color: 'var(--failed)' }}>Error: {err}</div>
  if (d == null) return <p className="page-sub">Loading…</p>
  const readers = Object.keys(model.byPerson).length
  const avgPct = roster.length && model.totalPub ? Math.round(roster.reduce((s, p) => s + (model.byPerson[p.id]?.size || 0), 0) / (roster.length * model.totalPub) * 100) : 0
  const articleRows = d.arts.map(a => ({ id: a.id, title: a.title, readers: model.byArticle[a.id]?.size || 0 })).sort((x, y) => y.readers - x.readers)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Tile label="Published articles" value={model.totalPub} />
        <Tile label="People who've read ≥1" value={readers} />
        <Tile label="Avg read coverage" value={avgPct + '%'} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" onClick={exportCsv}>Export CSV</button></div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', fontWeight: 600 }}>By person</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><Th>Person</Th><Th r>Read</Th><Th r>Unread</Th><Th r>Read %</Th></tr></thead>
          <tbody>
            {roster.length === 0 && <tr><td style={cellL} colSpan={4}><span className="page-sub">No people.</span></td></tr>}
            {roster.map(p => {
              const read = model.byPerson[p.id]?.size || 0
              const unread = Math.max(0, model.totalPub - read)
              const pct = model.totalPub ? Math.round(read / model.totalPub * 100) : 0
              return <tr key={p.id}><td style={{ ...cellL, fontWeight: 600 }}>{p.full_name}</td><td style={cellR}>{read}</td><td style={{ ...cellR, color: unread ? 'var(--needed)' : 'var(--ink-soft)' }}>{unread}</td><td style={{ ...cellR, color: pct >= 66 ? 'var(--passed)' : pct >= 33 ? 'var(--needed)' : 'var(--failed)', fontWeight: 700 }}>{pct}%</td></tr>
            })}
          </tbody>
        </table>
      </div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', fontWeight: 600 }}>By article</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><Th>Article</Th><Th r>Readers</Th></tr></thead>
          <tbody>
            {articleRows.length === 0 && <tr><td style={cellL} colSpan={2}><span className="page-sub">No published articles.</span></td></tr>}
            {articleRows.map(a => <tr key={a.id}><td style={{ ...cellL, fontWeight: 600 }}>{a.title}</td><td style={{ ...cellR, color: a.readers ? 'var(--ink)' : 'var(--ink-soft)' }}>{a.readers}</td></tr>)}
          </tbody>
        </table>
      </div>
      <p className="page-sub" style={{ fontSize: 12 }}>Reads are logged when someone opens an article. Data began accruing when this shipped, so early numbers reflect reads since then. "Unread" = published articles minus those the person has opened.</p>
    </div>
  )
}

// ================= Custom Report Builder =================
// Each data source returns FLAT rows already mapped to its field keys, plus a
// `_pid` (profile id) where a person filter applies. Fields are dim (group/label)
// or num (summed when grouped). Adding a source = one entry here.
const BUILDER_SOURCES = {
  roster: {
    label: 'People (roster)', usesRange: false,
    fields: [
      { key: 'person', label: 'Name', kind: 'dim' },
      { key: 'role', label: 'Role', kind: 'dim' },
      { key: 'status', label: 'Status', kind: 'dim' },
      { key: 'email', label: 'Email', kind: 'dim' },
      { key: 'created', label: 'Created', kind: 'dim' },
    ],
    load: async (range, ctx) => (ctx.profiles || []).map(p => ({
      _pid: p.id, person: p.full_name || '', role: ROLE_LABELS[p.role] || p.role || '',
      status: p.is_active ? 'Active' : 'Inactive', email: p.email || '', created: p.created_at ? p.created_at.slice(0, 10) : '',
    })),
  },
  time: {
    label: 'Time tracking', usesRange: true,
    fields: [
      { key: 'person', label: 'Person', kind: 'dim' },
      { key: 'client', label: 'Client', kind: 'dim' },
      { key: 'task', label: 'Task', kind: 'dim' },
      { key: 'date', label: 'Date', kind: 'dim' },
      { key: 'hours', label: 'Hours', kind: 'num' },
    ],
    load: async (range, ctx) => {
      const [{ data: te }, { data: tasks }, { data: clients }] = await Promise.all([
        supabase.from('time_entries').select('user_id, task_id, client_id, duration_minutes, started_at, note').not('duration_minutes', 'is', null).gte('started_at', dayStart(range.from)).lte('started_at', dayEnd(range.to)),
        supabase.from('tasks').select('id, name, client_id'),
        supabase.from('clients').select('id, name'),
      ])
      const taskById = Object.fromEntries((tasks || []).map(t => [t.id, t]))
      const cliById = Object.fromEntries((clients || []).map(c => [c.id, c]))
      const nameById = Object.fromEntries((ctx.profiles || []).map(p => [p.id, p.full_name]))
      return (te || []).map(e => {
        const t = taskById[e.task_id]
        const cid = e.client_id || t?.client_id
        return { _pid: e.user_id, person: nameById[e.user_id] || '—', client: cid ? (cliById[cid]?.name || '—') : 'No client', task: t ? t.name : (e.task_id ? '(deleted task)' : (e.note || 'Meeting')), date: e.started_at ? e.started_at.slice(0, 10) : '', hours: Math.round((e.duration_minutes || 0) / 60 * 100) / 100 }
      })
    },
  },
  tasks: {
    label: 'Tasks', usesRange: true,
    fields: [
      { key: 'person', label: 'Assignee', kind: 'dim' },
      { key: 'status', label: 'Status', kind: 'dim' },
      { key: 'overdue', label: 'Overdue', kind: 'dim' },
      { key: 'created', label: 'Created', kind: 'dim' },
    ],
    load: async (range, ctx) => {
      const [{ data: tasks }, { data: asg }] = await Promise.all([
        supabase.from('tasks').select('id, status, due_date, created_at').is('deleted_at', null).gte('created_at', dayStart(range.from)).lte('created_at', dayEnd(range.to)),
        supabase.from('task_assignees').select('task_id, profile_id'),
      ])
      const nameById = Object.fromEntries((ctx.profiles || []).map(p => [p.id, p.full_name]))
      const taskById = Object.fromEntries((tasks || []).map(t => [t.id, t]))
      const today = isoDay(new Date())
      return (asg || []).filter(a => taskById[a.task_id]).map(a => {
        const t = taskById[a.task_id]
        return { _pid: a.profile_id, person: nameById[a.profile_id] || '—', status: t.status || '', overdue: (t.due_date && t.due_date < today && t.status !== 'done') ? 'Yes' : 'No', created: t.created_at ? t.created_at.slice(0, 10) : '' }
      })
    },
  },
  deals: {
    label: 'Deals (sales + RSN)', usesRange: true,
    fields: [
      { key: 'pipeline', label: 'Pipeline', kind: 'dim' },
      { key: 'status', label: 'Stage', kind: 'dim' },
      { key: 'owner', label: 'Owner', kind: 'dim' },
      { key: 'created', label: 'Created', kind: 'dim' },
      { key: 'value', label: 'Value', kind: 'num' },
    ],
    load: async (range) => {
      const { data } = await supabase.from('deals').select('pipeline, status, owner_id, owner_name, value, created_at').gte('created_at', dayStart(range.from)).lte('created_at', dayEnd(range.to))
      return (data || []).map(dl => ({ _pid: dl.owner_id, pipeline: dl.pipeline || '', status: DEAL_STATUS_LABELS[dl.status] || dl.status || '', owner: dl.owner_name || '', created: dl.created_at ? dl.created_at.slice(0, 10) : '', value: Number(dl.value) || 0 }))
    },
  },
  hiring: {
    label: 'Hiring applications', usesRange: true,
    fields: [
      { key: 'status', label: 'Stage', kind: 'dim' },
      { key: 'role', label: 'Role applied', kind: 'dim' },
      { key: 'created', label: 'Applied', kind: 'dim' },
    ],
    load: async (range) => {
      const { data } = await supabase.from('hiring_applications').select('status, role_applying, created_at').gte('created_at', dayStart(range.from)).lte('created_at', dayEnd(range.to))
      return (data || []).map(a => ({ status: prettyStatus(a.status), role: a.role_applying || '', created: a.created_at ? a.created_at.slice(0, 10) : '' }))
    },
  },
  tokens: {
    label: 'Tokens', usesRange: true,
    fields: [
      { key: 'person', label: 'Person', kind: 'dim' },
      { key: 'kind', label: 'Type', kind: 'dim' },
      { key: 'date', label: 'Date', kind: 'dim' },
      { key: 'amount', label: 'Amount (± )', kind: 'num' },
    ],
    load: async (range, ctx) => {
      const { data } = await supabase.from('token_transactions').select('profile_id, delta, kind, created_at').gte('created_at', dayStart(range.from)).lte('created_at', dayEnd(range.to))
      const nameById = Object.fromEntries((ctx.profiles || []).map(p => [p.id, p.full_name]))
      return (data || []).map(t => ({ _pid: t.profile_id, person: nameById[t.profile_id] || '—', kind: t.kind || '', date: t.created_at ? t.created_at.slice(0, 10) : '', amount: Number(t.delta) || 0 }))
    },
  },
  schedule: {
    label: 'Schedule (intervals)', usesRange: true,
    fields: [
      { key: 'person', label: 'Person', kind: 'dim' },
      { key: 'date', label: 'Date', kind: 'dim' },
      { key: 'role', label: 'Role', kind: 'dim' },
      { key: 'status', label: 'Status', kind: 'dim' },
      { key: 'checkedIn', label: 'Checked in', kind: 'dim' },
      { key: 'schedHrs', label: 'Scheduled hrs', kind: 'num' },
      { key: 'clockHrs', label: 'Clock hrs', kind: 'num' },
    ],
    load: async (range, ctx) => {
      const { data: blocks } = await supabase.from('shift_blocks').select('id, block_date, start_time, end_time, role').gte('block_date', range.from).lte('block_date', range.to)
      const bById = Object.fromEntries((blocks || []).map(b => [b.id, b]))
      const ids = (blocks || []).map(b => b.id)
      let claims = []
      for (let i = 0; i < ids.length; i += 500) {
        const { data: c } = await supabase.from('shift_claims').select('shift_block_id, profile_id, status, checked_in_at, checked_out_at').in('shift_block_id', ids.slice(i, i + 500))
        claims = claims.concat(c || [])
      }
      const nameById = Object.fromEntries((ctx.profiles || []).map(p => [p.id, p.full_name]))
      return claims.map(c => {
        const b = bById[c.shift_block_id] || {}
        const sm = schedMins(b)
        const clock = (c.checked_in_at && c.checked_out_at) ? Math.max(0, Math.round((new Date(c.checked_out_at) - new Date(c.checked_in_at)) / 60000)) : 0
        return { _pid: c.profile_id, person: nameById[c.profile_id] || '—', date: b.block_date || '', role: b.role || '', status: c.status || '', checkedIn: c.checked_in_at ? 'Yes' : 'No', schedHrs: Math.round(sm / 60 * 100) / 100, clockHrs: Math.round(clock / 60 * 100) / 100 }
      })
    },
  },
  support: {
    label: 'Support tickets', usesRange: true,
    fields: [
      { key: 'category', label: 'Category', kind: 'dim' },
      { key: 'status', label: 'Status', kind: 'dim' },
      { key: 'priority', label: 'Priority', kind: 'dim' },
      { key: 'created', label: 'Created', kind: 'dim' },
      { key: 'firstRespMin', label: 'First response (min)', kind: 'num' },
      { key: 'resolveMin', label: 'Resolution (min)', kind: 'num' },
    ],
    load: async (range) => {
      const { data } = await supabase.from('help_tickets').select('category, status, priority, created_at, first_response_at, resolved_at, closed_at').gte('created_at', dayStart(range.from)).lte('created_at', dayEnd(range.to))
      const diffMin = (a, b) => (a && b) ? Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000)) : 0
      return (data || []).map(t => ({ category: t.category || '—', status: t.status || '—', priority: t.priority || '—', created: t.created_at ? t.created_at.slice(0, 10) : '', firstRespMin: diffMin(t.created_at, t.first_response_at), resolveMin: diffMin(t.created_at, t.resolved_at || t.closed_at) }))
    },
  },
  dispositions: {
    label: 'Call dispositions (Five9, recent)', usesRange: false,
    fields: [
      { key: 'agent', label: 'Agent', kind: 'dim' },
      { key: 'disposition', label: 'Disposition', kind: 'dim' },
      { key: 'campaign', label: 'Campaign', kind: 'dim' },
      { key: 'brand', label: 'Brand', kind: 'dim' },
      { key: 'date', label: 'Date', kind: 'dim' },
      { key: 'talkMin', label: 'Talk (min)', kind: 'num' },
      { key: 'calls', label: 'Calls', kind: 'num' },
    ],
    load: async () => {
      const pageN = 1000; let from = 0; let all = []
      for (;;) {
        const { data } = await supabase.from('f9_calls_today').select('agent_name, disposition, campaign, brand, work_date, talk_sec').range(from, from + pageN - 1)
        all = all.concat(data || [])
        if (!data || data.length < pageN) break
        from += pageN
      }
      return all.map(c => ({ agent: c.agent_name || '—', disposition: c.disposition || '—', campaign: c.campaign || '—', brand: c.brand || '—', date: c.work_date || '', talkMin: Math.round((Number(c.talk_sec) || 0) / 60 * 100) / 100, calls: 1 }))
    },
  },
  scorecard: {
    label: 'Scorecard (agent, rolling 30d)', usesRange: false,
    fields: [
      { key: 'agent', label: 'Agent', kind: 'dim' },
      { key: 'calls30', label: 'Calls 30d', kind: 'num' },
      { key: 'ahtMin', label: 'AHT min', kind: 'num' },
      { key: 'bookings30', label: 'Bookings 30d', kind: 'num' },
      { key: 'conv30', label: 'Conversion %', kind: 'num' },
      { key: 'serviced30', label: 'Serviced hrs 30d', kind: 'num' },
    ],
    load: async () => {
      const { data } = await supabase.from('sc_calls').select('agent_name, calls_handled_last_30_days, avg_aht_minutes_last_30_days, bookings_last_30_days, conversion_rate_last_30_days, serviced_hours_last_30_days')
      return (data || []).map(c => ({ agent: c.agent_name || '—', calls30: Number(c.calls_handled_last_30_days) || 0, ahtMin: Number(c.avg_aht_minutes_last_30_days) || 0, bookings30: Number(c.bookings_last_30_days) || 0, conv30: Number(c.conversion_rate_last_30_days) || 0, serviced30: Number(c.serviced_hours_last_30_days) || 0 }))
    },
  },
  clients: {
    label: 'Clients', usesRange: false,
    fields: [
      { key: 'name', label: 'Client', kind: 'dim' },
      { key: 'usesFive9', label: 'Uses Five9', kind: 'dim' },
      { key: 'created', label: 'Added', kind: 'dim' },
    ],
    load: async () => {
      const { data } = await supabase.from('clients').select('name, uses_five9, created_at').order('name')
      return (data || []).map(c => ({ name: c.name || '', usesFive9: c.uses_five9 ? 'Yes' : 'No', created: c.created_at ? c.created_at.slice(0, 10) : '' }))
    },
  },
}

function CustomBuilder({ range, profiles, allowedIds, initial, onSaved }) {
  const [source, setSource] = useState(initial?.source || 'time')
  const [cols, setCols] = useState(() => new Set(initial?.columns || BUILDER_SOURCES[initial?.source || 'time'].fields.map(f => f.key)))
  const [groupBy, setGroupBy] = useState(initial?.groupBy || '')
  const [sortKey, setSortKey] = useState(initial?.sortKey || '')
  const [sortDir, setSortDir] = useState(initial?.sortDir || 'desc')
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ran, setRan] = useState(false)

  const src = BUILDER_SOURCES[source]
  const dims = src.fields.filter(f => f.kind === 'dim')
  const nums = src.fields.filter(f => f.kind === 'num')

  function pickSource(k) {
    setSource(k); setCols(new Set(BUILDER_SOURCES[k].fields.map(f => f.key))); setGroupBy(''); setSortKey(''); setRows(null); setRan(false)
  }
  function toggleCol(k) { setCols(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n }) }

  const run = useCallback(async () => {
    setBusy(true); setErr(''); setRan(true)
    try {
      let data = await src.load(range, { profiles })
      if (allowedIds) data = data.filter(r => r._pid == null ? true : allowedIds.has(r._pid))
      setRows(data)
    } catch (e) { setErr(e.message || String(e)) }
    setBusy(false)
  }, [src, range, profiles, allowedIds])

  // Auto-run once when opened from a saved report.
  useEffect(() => { if (initial) run() }, []) // eslint-disable-line

  const selectedFields = src.fields.filter(f => cols.has(f.key))
  // Generic sort comparator (numbers numerically, everything else as text).
  const cmp = (a, b, dir) => {
    const na = Number(a), nb = Number(b)
    let r
    if (!isNaN(na) && !isNaN(nb) && a !== '' && b !== '') r = na - nb
    else r = String(a ?? '').localeCompare(String(b ?? ''))
    return dir === 'asc' ? r : -r
  }
  const output = useMemo(() => {
    if (!rows) return null
    if (!groupBy) {
      let data = rows
      if (sortKey) data = rows.slice().sort((a, b) => cmp(a[sortKey], b[sortKey], sortDir))
      return { grouped: false, columns: selectedFields, data }
    }
    const gLabel = (src.fields.find(f => f.key === groupBy) || {}).label || groupBy
    const selNums = nums.filter(f => cols.has(f.key))
    const m = new Map()
    for (const r of rows) {
      const key = r[groupBy] ?? '—'
      if (!m.has(key)) { const o = { __g: key, __count: 0 }; selNums.forEach(f => o[f.key] = 0); m.set(key, o) }
      const o = m.get(key); o.__count++
      selNums.forEach(f => { o[f.key] += Number(r[f.key]) || 0 })
    }
    let data = Array.from(m.values())
    // Sort grouped rows: by chosen numeric column, or Count, or the group label.
    if (sortKey === '__g') data.sort((a, b) => cmp(a.__g, b.__g, sortDir))
    else if (sortKey && (sortKey === '__count' || selNums.some(f => f.key === sortKey))) data.sort((a, b) => cmp(a[sortKey], b[sortKey], sortDir))
    else data.sort((a, b) => b.__count - a.__count)
    const totals = { __g: 'Total', __count: rows.length }
    selNums.forEach(f => totals[f.key] = data.reduce((s, o) => s + o[f.key], 0))
    return { grouped: true, gLabel, selNums, data, totals }
  }, [rows, groupBy, selectedFields, nums, cols, src, sortKey, sortDir])

  function exportCsv() {
    if (!output) return
    let out
    if (!output.grouped) {
      out = [output.columns.map(f => f.label)]
      output.data.forEach(r => out.push(output.columns.map(f => r[f.key])))
    } else {
      out = [[output.gLabel, 'Count', ...output.selNums.map(f => f.label)]]
      output.data.forEach(o => out.push([o.__g, o.__count, ...output.selNums.map(f => Math.round(o[f.key] * 100) / 100)]))
      out.push([output.totals.__g, output.totals.__count, ...output.selNums.map(f => Math.round(output.totals[f.key] * 100) / 100)])
    }
    downloadCSV(`custom-${source}-${range.from}_to_${range.to}.csv`, out)
  }

  async function save() {
    const name = window.prompt('Name this custom report:', `${src.label} — ${groupBy ? 'by ' + (dims.find(f => f.key === groupBy)?.label || groupBy) : 'detail'}`)
    if (!name) return
    const { data: { user } } = await supabase.auth.getUser()
    const shared = window.confirm('Share with the whole team?\n\nOK = shared · Cancel = just me')
    const { error } = await supabase.from('report_definitions').insert({
      owner_id: user?.id, name, folder: shared ? 'Shared Reports' : 'My Reports',
      report_key: 'builder', is_shared: shared,
      config: { source, columns: Array.from(cols), groupBy, sortKey, sortDir, range },
    })
    if (error) { window.alert('Could not save: ' + error.message); return }
    onSaved && onSaved()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Step 1: source */}
        <div>
          <div style={stepLbl}>1 · Data source</div>
          <select value={source} onChange={e => pickSource(e.target.value)} style={{ ...inp, maxWidth: 320 }}>
            {Object.entries(BUILDER_SOURCES).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
          </select>
          {!src.usesRange && <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--ink-soft)' }}>(snapshot — ignores the date range)</span>}
        </div>
        {/* Step 2: columns */}
        <div>
          <div style={stepLbl}>2 · Columns</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {src.fields.map(f => (
              <label key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13 }}>
                <input type="checkbox" checked={cols.has(f.key)} onChange={() => toggleCol(f.key)} />
                {f.label}<span style={{ fontSize: 10, color: 'var(--ink-soft)' }}>{f.kind === 'num' ? '#' : ''}</span>
              </label>
            ))}
          </div>
        </div>
        {/* Step 3: grouping */}
        <div>
          <div style={stepLbl}>3 · Group by</div>
          <select value={groupBy} onChange={e => setGroupBy(e.target.value)} style={{ ...inp, maxWidth: 320 }}>
            <option value="">None — show detail rows</option>
            {dims.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
          {groupBy && <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--ink-soft)' }}>numeric columns are summed; a Count column and Total row are added.</span>}
        </div>
        {/* Step 4: sort */}
        <div>
          <div style={stepLbl}>4 · Sort by</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select value={sortKey} onChange={e => setSortKey(e.target.value)} style={{ ...inp, maxWidth: 240 }}>
              <option value="">Default</option>
              {(groupBy
                ? [['__g', dims.find(f => f.key === groupBy)?.label || 'Group'], ['__count', 'Count'], ...nums.filter(f => cols.has(f.key)).map(f => [f.key, f.label])]
                : selectedFields.map(f => [f.key, f.label])
              ).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <select value={sortDir} onChange={e => setSortDir(e.target.value)} style={{ ...inp, maxWidth: 170 }}>
              <option value="desc">High → Low / Z → A</option>
              <option value="asc">Low → High / A → Z</option>
            </select>
          </div>
        </div>
        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={run} disabled={busy}>{busy ? 'Running…' : 'Run report'}</button>
          <button className="btn btn-ghost" onClick={exportCsv} disabled={!output} style={{ opacity: output ? 1 : 0.5 }}>Export CSV</button>
          <button className="btn btn-ghost" onClick={save} disabled={!ran}>☆ Save report</button>
        </div>
      </div>

      {err && <div className="card" style={{ padding: 16, color: 'var(--failed)' }}>Error: {err}</div>}
      {output && (
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
            {output.grouped ? (
              <>
                <thead><tr><Th>{output.gLabel}</Th><Th r>Count</Th>{output.selNums.map(f => <Th key={f.key} r>{f.label}</Th>)}</tr></thead>
                <tbody>
                  {output.data.length === 0 && <tr><td style={cellL} colSpan={2 + output.selNums.length}><span className="page-sub">No rows.</span></td></tr>}
                  {output.data.map((o, i) => (
                    <tr key={i}><td style={{ ...cellL, fontWeight: 600 }}>{String(o.__g)}</td><td style={cellR}>{o.__count}</td>{output.selNums.map(f => <td key={f.key} style={cellR}>{Math.round(o[f.key] * 100) / 100}</td>)}</tr>
                  ))}
                  {output.data.length > 0 && (
                    <tr style={{ background: 'var(--canvas)' }}><td style={{ ...cellL, fontWeight: 700 }}>Total</td><td style={{ ...cellR, fontWeight: 700 }}>{output.totals.__count}</td>{output.selNums.map(f => <td key={f.key} style={{ ...cellR, fontWeight: 700 }}>{Math.round(output.totals[f.key] * 100) / 100}</td>)}</tr>
                  )}
                </tbody>
              </>
            ) : (
              <>
                <thead><tr>{output.columns.map(f => <Th key={f.key} r={f.kind === 'num'}>{f.label}</Th>)}</tr></thead>
                <tbody>
                  {output.columns.length === 0 && <tr><td style={cellL}><span className="page-sub">Pick at least one column.</span></td></tr>}
                  {output.data.length === 0 && output.columns.length > 0 && <tr><td style={cellL} colSpan={output.columns.length}><span className="page-sub">No rows for these settings.</span></td></tr>}
                  {output.data.slice(0, 500).map((r, i) => (
                    <tr key={i}>{output.columns.map(f => <td key={f.key} style={f.kind === 'num' ? cellR : cellL}>{String(r[f.key] ?? '')}</td>)}</tr>
                  ))}
                </tbody>
              </>
            )}
          </table>
          {!output.grouped && output.data.length > 500 && <div style={{ padding: '8px 16px', fontSize: 12, color: 'var(--ink-soft)' }}>Showing first 500 of {output.data.length} rows — Export CSV for the full set.</div>}
        </div>
      )}
      {!output && !err && <p className="page-sub">Choose a source and columns, then <b>Run report</b>.</p>}
    </div>
  )
}
const stepLbl = { fontSize: 11.5, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }
