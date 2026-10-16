// ============================================================
//  Inbound (/inbound) — the Opsis CX business line (and later, client lines).
//
//  Everyone on a line:  "Ready for inbound calls" switch + recent calls with the
//                       AI assistant's summary and transcript. No caller numbers shown.
//  Managers also get:   Settings (hours, greeting, menu, ring time, AI instructions),
//                       Who answers (people per menu option), Setup (Twilio steps).
//
//  Server: voice-inbound edge function (routing + AI receptionist).
//  Data:   inbound_lines, inbound_queue_members (RLS: can_manage_dialer),
//          rpc inbound_recent_calls / inbound_my_status / inbound_set_ready.
// ============================================================
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useVoice } from '../lib/voice'

const FN_URL = 'https://dqvuviyqrcrgapmxkoyx.supabase.co/functions/v1/voice-inbound'
const DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']]
const STATUS = {
  new: ['Starting', '#64748b'], menu: ['At menu', '#64748b'], ringing: ['Ringing', '#0891b2'],
  answered: ['On call', '#16a34a'], completed: ['Answered', '#16a34a'], ai: ['AI assistant', '#7c3aed'],
  missed: ['Missed', '#dc2626'], abandoned: ['Hung up', '#dc2626'],
}
// Amazon Polly neural voices Twilio can speak with (US English, adult).
const VOICES = [
  ['Polly.Joanna-Neural', 'Joanna — female, warm (default)'], ['Polly.Ruth-Neural', 'Ruth — female, conversational'],
  ['Polly.Danielle-Neural', 'Danielle — female, friendly'], ['Polly.Kendra-Neural', 'Kendra — female, crisp'],
  ['Polly.Salli-Neural', 'Salli — female, bright'], ['Polly.Kimberly-Neural', 'Kimberly — female, upbeat'],
  ['Polly.Matthew-Neural', 'Matthew — male, warm'], ['Polly.Stephen-Neural', 'Stephen — male, conversational'],
  ['Polly.Gregory-Neural', 'Gregory — male, calm'], ['Polly.Joey-Neural', 'Joey — male, casual'],
]
const CALLER_TYPE = { team: 'Team', applicant: 'Applicant', campaign_contact: 'Campaign contact', unknown: '' }
const CB_STATUS = { pending: 'Callback waiting', in_progress: 'Calling back', done: 'Called back', removed: 'Removed', dnc: 'Do not call', max_attempts: 'No answer (max tries)', expired: 'Expired' }

function fmt(ts) { return ts ? new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '' }
function dur(s) { if (!s) return '—'; return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s` }

export default function Inbound() {
  const voice = useVoice()
  const [me, setMe] = useState(null)
  const [tab, setTab] = useState('calls')

  useEffect(() => {
    supabase.rpc('inbound_my_status').then(({ data }) => setMe(data || { member: false, manager: false }))
  }, [])

  if (!me) return <div style={S.page}>Loading…</div>
  if (!me.member && !me.manager) {
    return <div style={S.page}><h2 style={S.h2}>Inbound</h2><p>You're not on an inbound line yet. Ask an admin to add you under Inbound → Who answers.</p></div>
  }

  const tabs = me.manager ? [['calls', 'Calls'], ['settings', 'Settings'], ['people', 'Who answers'], ['setup', 'Setup']] : [['calls', 'Calls']]
  const inb = voice?.inbound

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h2 style={S.h2}>Inbound</h2>
        {inb?.member && (
          <button onClick={() => inb.setReady(!inb.ready)} disabled={inb.busy}
            style={{ ...S.btn, background: inb.ready ? '#16a34a' : 'transparent', color: inb.ready ? '#fff' : 'inherit', borderColor: inb.ready ? '#16a34a' : undefined }}>
            {inb.ready ? (inb.registered ? '● Ready for inbound calls' : 'Connecting…') : '○ Not taking inbound calls — click to go ready'}
          </button>
        )}
      </div>
      <p style={{ margin: '4px 0 14px', opacity: 0.75, fontSize: 13.5 }}>
        Callers pick an option (or say it), then ring everyone who's ready for that option. No one ready, no answer, or after hours → the AI assistant takes the details and drops a callback into the <Link to="/campaigns" style={S.link}>Callbacks campaign</Link>.
      </p>
      <div style={S.tabs}>
        {tabs.map(([k, l]) => <button key={k} onClick={() => setTab(k)} style={{ ...S.tab, ...(tab === k ? S.tabOn : {}) }}>{l}</button>)}
      </div>
      {tab === 'calls' && <Calls />}
      {tab === 'settings' && <Settings />}
      {tab === 'people' && <People />}
      {tab === 'setup' && <Setup />}
    </div>
  )
}

// ---------------- Calls ----------------
function Calls() {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [openId, setOpenId] = useState(null)
  const [filter, setFilter] = useState('all')

  const load = () => supabase.rpc('inbound_recent_calls', { p_limit: 200 }).then(({ data, error }) => {
    if (error) setErr(error.message); else setRows(data || [])
  })
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t) }, [])

  const shown = useMemo(() => (rows || []).filter(r =>
    filter === 'all' ? true
      : filter === 'callbacks' ? r.callback_status === 'pending' || r.callback_status === 'in_progress'
      : filter === 'ai' ? (r.ai_transcript || []).length > 0
      : ['missed', 'abandoned'].includes(r.status)), [rows, filter])

  if (err) return <div style={S.error}>{err}</div>
  if (!rows) return <div>Loading…</div>

  const today = rows.filter(r => new Date(r.started_at).toDateString() === new Date().toDateString())
  const stat = (n, l) => <div style={S.stat}><div style={{ fontSize: 22, fontWeight: 800 }}>{n}</div><div style={{ fontSize: 12, opacity: 0.7 }}>{l}</div></div>

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        {stat(today.length, 'Calls today')}
        {stat(today.filter(r => r.status === 'completed' || r.status === 'answered').length, 'Answered live')}
        {stat(today.filter(r => (r.ai_transcript || []).length > 0).length, 'Handled by AI')}
        {stat(rows.filter(r => r.callback_status === 'pending').length, 'Callbacks waiting')}
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {[['all', 'All'], ['callbacks', 'Needs callback'], ['ai', 'AI handled'], ['missed', 'Missed / hung up']].map(([k, l]) =>
          <button key={k} onClick={() => setFilter(k)} style={{ ...S.chip, ...(filter === k ? S.chipOn : {}) }}>{l}</button>)}
      </div>
      {!shown.length && <div style={{ opacity: 0.7, padding: 20, textAlign: 'center' }}>No calls yet.</div>}
      {shown.map(r => {
        const [label, color] = STATUS[r.status] || [r.status, '#64748b']
        const f = r.ai_fields || {}
        const open = openId === r.id
        return (
          <div key={r.id} style={S.card}>
            <div onClick={() => setOpenId(open ? null : r.id)} style={{ cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>
                  {r.caller_name}
                  {CALLER_TYPE[r.caller_type] && <span style={S.tag}>{CALLER_TYPE[r.caller_type]}</span>}
                  {f.urgency === 'high' && <span style={{ ...S.tag, background: 'rgba(220,38,38,0.12)', color: '#b91c1c' }}>Urgent</span>}
                </div>
                <div style={{ fontSize: 12.5, opacity: 0.7, marginTop: 2 }}>
                  {fmt(r.started_at)} · {r.menu_choice || 'No option picked'}{r.after_hours ? ' · after hours' : ''}
                  {r.answered_by_name ? ` · answered by ${r.answered_by_name}` : ''}{r.talk_seconds ? ` · ${dur(r.talk_seconds)}` : ''}
                </div>
                {r.ai_summary && <div style={{ fontSize: 13.5, marginTop: 6 }}>{r.ai_summary}</div>}
                {f.callback_time && <div style={{ fontSize: 12.5, marginTop: 3, opacity: 0.8 }}>Best time: {f.callback_time}</div>}
              </div>
              <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                <span style={{ ...S.badge, background: color }}>{label}</span>
                {r.callback_status && <span style={{ fontSize: 12, fontWeight: 600, color: r.callback_status === 'pending' ? '#d97706' : 'inherit' }}>{CB_STATUS[r.callback_status] || r.callback_status}</span>}
                {r.has_recording && <span style={{ fontSize: 11.5, opacity: 0.6 }}>Recorded</span>}
              </div>
            </div>
            {open && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(100,116,139,0.2)', fontSize: 13.5 }}>
                {(r.ai_transcript || []).length ? (r.ai_transcript || []).map((t, i) => (
                  <div key={i} style={{ margin: '4px 0' }}><strong style={{ color: t.r === 'ai' ? '#7c3aed' : 'inherit' }}>{t.r === 'ai' ? 'Assistant' : 'Caller'}:</strong> {t.t}</div>
                )) : <div style={{ opacity: 0.7 }}>No AI conversation on this call.</div>}
                {(f.company || f.reason || f.requested_person) && (
                  <div style={{ marginTop: 8, opacity: 0.85 }}>
                    {f.company && <div>Company: {f.company}</div>}
                    {f.reason && <div>Reason: {f.reason}</div>}
                    {f.requested_person && <div>Asked for: {f.requested_person}</div>}
                  </div>
                )}
                {r.callback_status === 'pending' && <div style={{ marginTop: 8 }}><Link to="/dialer" style={S.link}>Call back from the Dialer →</Link></div>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ---------------- Settings ----------------
function Settings() {
  const [line, setLine] = useState(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    supabase.from('inbound_lines').select('*').order('created_at').limit(1).maybeSingle().then(({ data }) => setLine(data))
  }, [])
  if (!line) return <div>Loading…</div>
  const set = p => setLine(l => ({ ...l, ...p }))
  const setDay = (d, i, v) => {
    const h = { ...(line.hours || {}) }
    const cur = h[d] || ['09:00', '17:00']
    h[d] = i === 0 ? [v, cur[1]] : [cur[0], v]
    set({ hours: h })
  }
  const toggleDay = (d, on) => { const h = { ...(line.hours || {}) }; if (on) h[d] = ['09:00', '17:00']; else delete h[d]; set({ hours: h }) }
  const setMenu = (i, p) => set({ menu: line.menu.map((m, j) => (j === i ? { ...m, ...p } : m)) })

  const save = async () => {
    setSaving(true); setMsg('')
    const { error } = await supabase.from('inbound_lines').update({
      name: line.name, active: line.active, greeting: line.greeting, hours: line.hours, timezone: line.timezone,
      ring_seconds: Number(line.ring_seconds) || 25, record_calls: line.record_calls, ai_enabled: line.ai_enabled,
      ai_instructions: line.ai_instructions, ai_voice: line.ai_voice, menu: line.menu, updated_at: new Date().toISOString(),
    }).eq('id', line.id)
    setSaving(false)
    setMsg(error ? error.message : 'Saved — applies to the next call.')
  }

  return (
    <div style={{ display: 'grid', gap: 14, maxWidth: 760 }}>
      <div style={S.card}>
        <label style={S.lbl}>Line name<input style={S.input} value={line.name || ''} onChange={e => set({ name: e.target.value })} /></label>
        <label style={S.check}><input type="checkbox" checked={!!line.active} onChange={e => set({ active: e.target.checked })} /> Line is on</label>
        <label style={S.lbl}>Greeting (said first on every call)<input style={S.input} value={line.greeting || ''} onChange={e => set({ greeting: e.target.value })} /></label>
        <label style={S.check}><input type="checkbox" checked={!!line.record_calls} onChange={e => set({ record_calls: e.target.checked })} /> Record answered calls (adds "This call may be recorded…" to the greeting)</label>
        <label style={S.lbl}>Ring the team for (seconds) before the AI picks up
          <input style={{ ...S.input, width: 100 }} type="number" min={10} max={60} value={line.ring_seconds || 25} onChange={e => set({ ring_seconds: e.target.value })} />
        </label>
      </div>

      <div style={S.card}>
        <div style={S.sectionTitle}>Business hours <span style={{ fontWeight: 400, opacity: 0.7 }}>(Eastern)</span></div>
        {DAYS.map(([d, l]) => {
          const h = line.hours?.[d]
          return (
            <div key={d} style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '6px 0' }}>
              <label style={{ ...S.check, width: 70, margin: 0 }}><input type="checkbox" checked={!!h} onChange={e => toggleDay(d, e.target.checked)} /> {l}</label>
              {h ? <>
                <input type="time" style={{ ...S.input, width: 120, margin: 0 }} value={h[0]} onChange={e => setDay(d, 0, e.target.value)} />
                <span>to</span>
                <input type="time" style={{ ...S.input, width: 120, margin: 0 }} value={h[1]} onChange={e => setDay(d, 1, e.target.value)} />
              </> : <span style={{ opacity: 0.6, fontSize: 13 }}>Closed — AI assistant answers</span>}
            </div>
          )
        })}
      </div>

      <div style={S.card}>
        <div style={S.sectionTitle}>Menu</div>
        <div style={{ fontSize: 12.5, opacity: 0.7, marginBottom: 8 }}>Callers press the key or say one of the words. Team members calling from their phone on file skip the menu.</div>
        {(line.menu || []).map((m, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '50px 1fr 2fr', gap: 8, marginBottom: 8 }}>
            <input style={{ ...S.input, margin: 0, textAlign: 'center' }} value={m.key} disabled />
            <input style={{ ...S.input, margin: 0 }} value={m.label} onChange={e => setMenu(i, { label: e.target.value })} />
            <input style={{ ...S.input, margin: 0 }} value={(m.words || []).join(', ')} placeholder="words callers might say"
              onChange={e => setMenu(i, { words: e.target.value.split(',').map(w => w.trim()).filter(Boolean) })} />
          </div>
        ))}
      </div>

      <div style={S.card}>
        <label style={S.check}><input type="checkbox" checked={!!line.ai_enabled} onChange={e => set({ ai_enabled: e.target.checked })} /> AI assistant answers when nobody can (off = voicemail)</label>
        <label style={S.lbl}>Voice (used for the greeting, menu and AI assistant)
          <select style={S.input} value={line.ai_voice || 'Polly.Joanna-Neural'} onChange={e => set({ ai_voice: e.target.value })}>
            {VOICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label style={S.lbl}>What the AI should know / how it should behave
          <textarea style={{ ...S.input, minHeight: 160, fontFamily: 'inherit' }} value={line.ai_instructions || ''} onChange={e => set({ ai_instructions: e.target.value })} />
        </label>
        <div style={{ fontSize: 12, opacity: 0.65 }}>It also uses the public facts from the website chat knowledge. It never quotes pricing.</div>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button onClick={save} disabled={saving} style={{ ...S.btn, background: '#0891b2', color: '#fff', borderColor: '#0891b2' }}>{saving ? 'Saving…' : 'Save'}</button>
        {msg && <span style={{ fontSize: 13 }}>{msg}</span>}
      </div>
    </div>
  )
}

// ---------------- Who answers ----------------
function People() {
  const [line, setLine] = useState(null)
  const [people, setPeople] = useState([])
  const [members, setMembers] = useState([])
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')

  const load = async () => {
    const { data: l } = await supabase.from('inbound_lines').select('id, menu').order('created_at').limit(1).maybeSingle()
    setLine(l)
    if (!l) return
    const [{ data: d }, { data: m }] = await Promise.all([
      supabase.rpc('call_directory'),
      supabase.from('inbound_queue_members').select('queue, profile_id').eq('line_id', l.id),
    ])
    setPeople(d || []); setMembers(m || [])
  }
  useEffect(() => { load() }, [])

  if (!line) return <div>Loading…</div>
  const has = (pid, queue) => members.some(m => m.profile_id === pid && m.queue === queue)
  const toggle = async (pid, queue, on) => {
    setErr('')
    const { error } = on
      ? await supabase.from('inbound_queue_members').insert({ line_id: line.id, queue, profile_id: pid })
      : await supabase.from('inbound_queue_members').delete().eq('line_id', line.id).eq('queue', queue).eq('profile_id', pid)
    if (error) setErr(error.message)
    load()
  }
  const memberIds = new Set(members.map(m => m.profile_id))
  const list = people
    .filter(p => !q || (p.full_name || '').toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (memberIds.has(b.profile_id) - memberIds.has(a.profile_id)) || (a.full_name || '').localeCompare(b.full_name || ''))
    .slice(0, q ? 100 : 30)

  return (
    <div>
      <p style={{ fontSize: 13.5, opacity: 0.8, marginTop: 0 }}>
        Tick who rings for each option. They also need to switch on <strong>Ready for inbound calls</strong> (phone button, bottom right) and keep a Command Center tab open.
      </p>
      {err && <div style={S.error}>{err}</div>}
      <input style={{ ...S.input, maxWidth: 320 }} placeholder="Search people…" value={q} onChange={e => setQ(e.target.value)} />
      <div style={{ overflowX: 'auto' }}>
        <table style={S.table}>
          <thead><tr><th style={S.th}>Person</th>{(line.menu || []).map(m => <th key={m.queue} style={{ ...S.th, textAlign: 'center' }}>{m.key}. {m.label}</th>)}</tr></thead>
          <tbody>
            {list.map(p => (
              <tr key={p.profile_id}>
                <td style={S.td}>{p.full_name}<div style={{ fontSize: 11.5, opacity: 0.6 }}>{p.role}</div></td>
                {(line.menu || []).map(m => (
                  <td key={m.queue} style={{ ...S.td, textAlign: 'center' }}>
                    <input type="checkbox" checked={has(p.profile_id, m.queue)} onChange={e => toggle(p.profile_id, m.queue, e.target.checked)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------- Setup ----------------
function Setup() {
  const [line, setLine] = useState(null)
  useEffect(() => { supabase.from('inbound_lines').select('twilio_number, name').order('created_at').limit(1).maybeSingle().then(({ data }) => setLine(data)) }, [])
  const copy = t => navigator.clipboard?.writeText(t)
  const Row = ({ label, value }) => (
    <div style={{ margin: '8px 0' }}>
      <div style={{ fontSize: 12.5, opacity: 0.7 }}>{label}</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <code style={S.code}>{value}</code>
        <button style={S.chip} onClick={() => copy(value)}>Copy</button>
      </div>
    </div>
  )
  return (
    <div style={{ maxWidth: 760, display: 'grid', gap: 14 }}>
      <div style={S.card}>
        <div style={S.sectionTitle}>1 · Point the Twilio number at Command Center</div>
        <div style={{ fontSize: 13.5 }}>Twilio Console → Phone Numbers → Active numbers → your number → <strong>Voice configuration</strong>:</div>
        <Row label='"A call comes in" → Webhook, HTTP POST' value={FN_URL} />
        <Row label='"Call status changes" → HTTP POST' value={`${FN_URL}?step=status`} />
        <div style={{ fontSize: 13, opacity: 0.8 }}>Save. Status: {line?.twilio_number ? <strong style={{ color: '#16a34a' }}>first call received — line is linked</strong> : <strong>waiting for the first call</strong>}</div>
      </div>
      <div style={S.card}>
        <div style={S.sectionTitle}>2 · Forward your existing business line</div>
        <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
          At your current phone carrier, set <strong>unconditional call forwarding</strong> (forward all calls) to the Twilio number. Your published number stays the same; callers never see the Twilio number.
        </div>
      </div>
      <div style={S.card}>
        <div style={S.sectionTitle}>3 · Test</div>
        <ol style={{ fontSize: 13.5, lineHeight: 1.7, margin: 0, paddingLeft: 18 }}>
          <li>Phone button (bottom right) → tick <strong>Ready for inbound calls</strong>.</li>
          <li>From a phone that is <em>not</em> on your profile, call the business line, press 1 → this browser rings → Answer.</li>
          <li>Untick Ready and call again → the AI assistant answers; a callback lands in Callbacks and you get a notification.</li>
          <li>Call from your own cell (on your profile) → it skips the menu and rings the team option.</li>
        </ol>
      </div>
    </div>
  )
}

const S = {
  page: { padding: 20, maxWidth: 1100, margin: '0 auto' },
  h2: { margin: 0, fontSize: 22 },
  link: { color: '#0891b2', fontWeight: 600 },
  tabs: { display: 'flex', gap: 4, borderBottom: '1px solid rgba(100,116,139,0.25)', marginBottom: 14, flexWrap: 'wrap' },
  tab: { padding: '8px 14px', border: 'none', background: 'none', color: 'inherit', cursor: 'pointer', fontWeight: 600, fontSize: 14, borderBottom: '2px solid transparent', opacity: 0.7 },
  tabOn: { borderBottomColor: '#0891b2', opacity: 1, color: '#0891b2' },
  card: { padding: 14, borderRadius: 12, border: '1px solid rgba(100,116,139,0.25)', background: 'var(--card, transparent)', marginBottom: 10 },
  stat: { padding: '10px 14px', borderRadius: 12, border: '1px solid rgba(100,116,139,0.25)', minWidth: 120 },
  badge: { color: '#fff', padding: '3px 9px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap' },
  tag: { marginLeft: 8, padding: '2px 7px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: 'rgba(100,116,139,0.15)' },
  chip: { padding: '5px 11px', borderRadius: 999, border: '1px solid rgba(100,116,139,0.35)', background: 'transparent', color: 'inherit', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' },
  chipOn: { background: '#0891b2', borderColor: '#0891b2', color: '#fff' },
  btn: { padding: '8px 14px', borderRadius: 10, border: '1px solid rgba(100,116,139,0.35)', background: 'transparent', color: 'inherit', fontWeight: 700, fontSize: 13, cursor: 'pointer' },
  input: { display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 4, padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(100,116,139,0.35)', background: 'transparent', color: 'inherit', fontSize: 14 },
  lbl: { display: 'block', fontSize: 13, fontWeight: 600, margin: '8px 0' },
  check: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5, margin: '8px 0', cursor: 'pointer' },
  sectionTitle: { fontWeight: 700, marginBottom: 8 },
  error: { padding: '8px 10px', borderRadius: 8, background: 'rgba(220,38,38,0.1)', color: '#b91c1c', fontSize: 13, marginBottom: 10 },
  table: { width: '100%', borderCollapse: 'collapse', marginTop: 10, fontSize: 13.5 },
  th: { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid rgba(100,116,139,0.3)', fontSize: 12.5, whiteSpace: 'nowrap' },
  td: { padding: '8px 10px', borderBottom: '1px solid rgba(100,116,139,0.15)' },
  code: { padding: '6px 8px', borderRadius: 6, background: 'rgba(100,116,139,0.12)', fontSize: 12.5, wordBreak: 'break-all', flex: 1 },
}
