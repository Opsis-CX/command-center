// ============================================================
//  Campaigns (/campaigns) — build and run outbound calling campaigns.
//  For anyone who can place calls (not agents/clients/CSRs); also enforced by RLS
//  (can_manage_dialer) on every dialer table and RPC.
//
//  Tabs per campaign:
//    Settings  — name, brand, client, status, preview/progressive, caller ID, calling
//                hours (customer's local time), attempts + retry cadence, recording,
//                script, dispositions
//    Agents    — who can work it
//    Queue     — who's waiting (last 4 digits only), add one, CSV import, remove
//    Results   — every attempt: agent, talk time, disposition, notes
//    HubSpot   — webhook URL + key + example body ("HubSpot is the brain")
//  Do-not-call list lives at the bottom of the campaign list.
// ============================================================
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

const FN_BASE = 'https://dqvuviyqrcrgapmxkoyx.supabase.co/functions/v1'
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const OUTCOMES = [['final', 'Done — stop calling'], ['retry', 'Try again later'], ['callback', 'Callback at a set time'], ['dnc', 'Do not call']]
const STATUS_COLORS = { active: '#16a34a', paused: '#d97706', draft: '#64748b', archived: '#94a3b8' }
const Q_STATUS = { pending: 'Waiting', in_progress: 'With agent', done: 'Done', dnc: 'Do not call', max_attempts: 'Max attempts', expired: 'Expired', removed: 'Removed' }
const TZS = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu']

function fmt(ts) { return ts ? new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '' }
function dur(s) { if (!s) return '—'; return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s` }

// Tiny CSV parser (handles quotes). First row = headers.
function parseCsv(text) {
  const rows = []; let row = []; let cur = ''; let q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++ } else if (ch === '"') q = false; else cur += ch }
    else if (ch === '"') q = true
    else if (ch === ',') { row.push(cur); cur = '' }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = '' }
    else cur += ch
  }
  if (cur || row.length) { row.push(cur); rows.push(row) }
  const [head, ...body] = rows.filter(r => r.some(c => c.trim()))
  if (!head) return []
  const keys = head.map(h => h.trim().toLowerCase().replace(/\s+/g, '_'))
  return body.map(r => Object.fromEntries(keys.map((k, i) => [k, (r[i] || '').trim()])))
}

const BLANK = {
  name: '', brand: '', client_id: '', status: 'draft', mode: 'preview', caller_id_number: '', timezone: 'America/New_York',
  hours: { 1: ['09:00', '20:00'], 2: ['09:00', '20:00'], 3: ['09:00', '20:00'], 4: ['09:00', '20:00'], 5: ['09:00', '20:00'], 6: ['10:00', '17:00'] },
  max_attempts: 6, retry_minutes: [5, 60, 240, 1440, 2880], progressive_delay_sec: 3, record_calls: true, script: '',
  scheduling_mode: 'smart',
  scheduling: { quick_retry_minutes: 10, second_gap_minutes: 120, max_per_day_first: 3, max_per_day: 2, vary_after_no_contacts: 2, interested_next_day_same_hour: true },
  dispositions: null,
}

export default function Campaigns() {
  const [campaigns, setCampaigns] = useState(null)
  const [stats, setStats] = useState({})
  const [clients, setClients] = useState([])
  const [selId, setSelId] = useState(null)
  const [tab, setTab] = useState('settings')
  const [showArchived, setShowArchived] = useState(false)
  const [err, setErr] = useState('')

  async function load() {
    const [c, s, cl] = await Promise.all([
      supabase.from('dial_campaigns').select('*').order('created_at', { ascending: false }),
      supabase.rpc('dialer_campaign_stats'),
      supabase.from('clients').select('id, name').order('name'),
    ])
    if (c.error) setErr(c.error.message)
    setCampaigns(c.data || [])
    setStats(Object.fromEntries((s.data || []).map(r => [r.campaign_id, r])))
    setClients(cl.data || [])
  }
  useEffect(() => { load() }, [])

  const sel = (campaigns || []).find(c => c.id === selId) || null
  const visible = (campaigns || []).filter(c => showArchived || c.status !== 'archived')

  if (campaigns === null) return <p className="page-sub">Loading…</p>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h1 className="page-title">Campaigns</h1>
          <p className="page-sub">Outbound calling campaigns. HubSpot (or a list upload) fills the queue; agents work it from the Dialer.</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setSelId('new'); setTab('settings') }}>+ New campaign</button>
      </div>
      {err && <div style={S.error}>{err}</div>}

      {selId && selId !== 'new' && !sel ? (
        <p className="page-sub">Loading…</p>
      ) : selId ? (
        <CampaignDetail
          key={selId} campaign={selId === 'new' ? null : sel} clients={clients} tab={tab} setTab={setTab}
          onBack={() => { setSelId(null); load() }}
          onSaved={(id) => { setSelId(id); load() }}
        />
      ) : (
        <>
          <div style={S.list}>
            {visible.length === 0 && <div style={S.muted}>No campaigns yet. Create one to get started.</div>}
            {visible.map(c => {
              const st = stats[c.id] || {}
              return (
                <button key={c.id} onClick={() => { setSelId(c.id); setTab('settings') }} style={S.rowBtn}>
                  <div style={{ minWidth: 0, textAlign: 'left' }}>
                    <div style={{ fontWeight: 700 }}>{c.name} {c.brand && <span style={S.small}>· {c.brand}</span>}</div>
                    <div style={S.small}>{c.mode === 'progressive' ? (Number(c.progressive_delay_sec) === 0 ? 'Auto-dial' : 'Progressive') : 'Preview'} · {(clients.find(x => x.id === c.client_id) || {}).name || 'No client'}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <Stat n={st.ready_now} l="ready now" />
                    <Stat n={st.pending} l="queued" />
                    <Stat n={st.attempts_today} l="calls today" />
                    <Stat n={st.contacts_today} l="connects today" />
                    <Stat n={st.agents_ready} l="agents on" />
                    <span style={{ ...S.badge, background: STATUS_COLORS[c.status] }}>{c.status}</span>
                  </div>
                </button>
              )
            })}
          </div>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, marginTop: 10 }}>
            <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /> Show archived
          </label>
          <DncPanel clients={clients} />
        </>
      )}
    </div>
  )
}

function Stat({ n, l }) {
  return <div style={{ textAlign: 'center', minWidth: 56 }}><div style={{ fontWeight: 800, fontSize: 17 }}>{n ?? 0}</div><div style={{ fontSize: 11, opacity: 0.6 }}>{l}</div></div>
}

function CampaignDetail({ campaign, clients, tab, setTab, onBack, onSaved }) {
  const isNew = !campaign
  const tabs = isNew ? [['settings', 'Settings']] : [['settings', 'Settings'], ['agents', 'Agents'], ['queue', 'Queue'], ['results', 'Results'], ['hubspot', 'HubSpot']]
  return (
    <div>
      <button onClick={onBack} style={{ ...S.btn, marginBottom: 12 }}>← All campaigns</button>
      <h2 style={{ margin: '0 0 10px', fontSize: 20 }}>{isNew ? 'New campaign' : campaign.name}</h2>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {tabs.map(([k, l]) => <button key={k} onClick={() => setTab(k)} style={{ ...S.chip, ...(tab === k ? S.chipOn : {}) }}>{l}</button>)}
      </div>
      {tab === 'settings' && <SettingsTab campaign={campaign} clients={clients} onSaved={onSaved} />}
      {tab === 'agents' && !isNew && <AgentsTab campaign={campaign} />}
      {tab === 'queue' && !isNew && <QueueTab campaign={campaign} />}
      {tab === 'results' && !isNew && <ResultsTab campaign={campaign} />}
      {tab === 'hubspot' && !isNew && <HubspotTab campaign={campaign} onSaved={onSaved} />}
    </div>
  )
}

// ---------------- SETTINGS ----------------
function SettingsTab({ campaign, clients, onSaved }) {
  const [f, setF] = useState(() => {
    const base = { ...BLANK, ...(campaign || {}) }
    return { ...base, client_id: base.client_id || '', caller_id_number: base.caller_id_number || '', brand: base.brand || '', script: base.script || '', retry_text: (base.retry_minutes || []).join(', ') }
  })
  const [dispos, setDispos] = useState(campaign?.dispositions || null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const setDay = (d, i, v) => setF(p => {
    const hours = { ...p.hours }; const cur = hours[d] ? [...hours[d]] : ['09:00', '17:00']; cur[i] = v; hours[d] = cur; return { ...p, hours }
  })
  const toggleDay = (d) => setF(p => { const hours = { ...p.hours }; if (hours[d]) delete hours[d]; else hours[d] = ['09:00', '17:00']; return { ...p, hours } })

  async function save() {
    setSaving(true); setMsg('')
    const retry = f.retry_text.split(/[,\s]+/).map(Number).filter(n => n > 0)
    const row = {
      name: f.name.trim(), brand: f.brand.trim() || null, client_id: f.client_id || null, status: f.status, mode: f.mode,
      caller_id_number: f.caller_id_number.trim() || null, timezone: f.timezone, hours: f.hours,
      max_attempts: Number(f.max_attempts) || 6, retry_minutes: retry.length ? retry : [60],
      progressive_delay_sec: f.progressive_delay_sec === '' || f.progressive_delay_sec == null ? 3 : Math.max(0, Math.min(30, Number(f.progressive_delay_sec) || 0)), record_calls: !!f.record_calls, script: f.script || null,
      scheduling_mode: f.scheduling_mode || 'smart',
      scheduling: {
        quick_retry_minutes: Number(f.scheduling?.quick_retry_minutes) || 10,
        second_gap_minutes: Number(f.scheduling?.second_gap_minutes) || 120,
        max_per_day_first: Number(f.scheduling?.max_per_day_first) || 3,
        max_per_day: Number(f.scheduling?.max_per_day) || 2,
        vary_after_no_contacts: Number(f.scheduling?.vary_after_no_contacts) || 2,
        interested_next_day_same_hour: f.scheduling?.interested_next_day_same_hour !== false,
      },
      updated_at: new Date().toISOString(),
    }
    if (dispos) row.dispositions = dispos
    if (!row.name) { setMsg('Give the campaign a name.'); setSaving(false); return }
    if (row.caller_id_number && !/^\+1\d{10}$/.test(row.caller_id_number.replace(/[^\d+]/g, '').replace(/^(\d{10})$/, '+1$1').replace(/^1(\d{10})$/, '+1$1'))) {
      setMsg('Caller ID must be a 10-digit US number (one of your Twilio numbers).'); setSaving(false); return
    }
    if (row.caller_id_number) { const d = row.caller_id_number.replace(/\D/g, ''); row.caller_id_number = '+1' + d.slice(-10) }
    const q = campaign
      ? supabase.from('dial_campaigns').update(row).eq('id', campaign.id).select('id').single()
      : supabase.from('dial_campaigns').insert(row).select('id').single()
    const { data, error } = await q
    setSaving(false)
    if (error) { setMsg(error.message); return }
    setMsg('Saved.')
    onSaved(data.id)
  }

  const defaultDispos = dispos || campaign?.dispositions
  return (
    <div className="card" style={{ display: 'grid', gap: 14 }}>
      <Grid>
        <Field label="Campaign name"><input value={f.name} onChange={e => set('name', e.target.value)} style={S.input} placeholder="Web leads — speed to lead" /></Field>
        <Field label="Brand"><input value={f.brand} onChange={e => set('brand', e.target.value)} style={S.input} placeholder="Cedar Park" /></Field>
        <Field label="Client">
          <select value={f.client_id} onChange={e => set('client_id', e.target.value)} style={S.input}>
            <option value="">— none —</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select value={f.status} onChange={e => set('status', e.target.value)} style={S.input}>
            <option value="draft">Draft</option><option value="active">Active</option><option value="paused">Paused</option><option value="archived">Archived</option>
          </select>
        </Field>
        <Field label="Dial mode" hint="Preview: agent clicks Call. Progressive: auto-dials after a countdown.">
          <select value={f.mode} onChange={e => set('mode', e.target.value)} style={S.input}>
            <option value="preview">Preview</option><option value="progressive">Progressive</option>
          </select>
        </Field>
        {f.mode === 'progressive' && <Field label="Countdown (seconds) — 0 = auto-dial instantly, no Call/Skip for the agent"><input type="number" min="0" max="30" value={f.progressive_delay_sec} onChange={e => set('progressive_delay_sec', e.target.value)} style={S.input} /></Field>}
        <Field label="Caller ID (brand's Twilio number)" hint="Blank = the main Opsis CX number. Must be a number on the Twilio account."><input value={f.caller_id_number} onChange={e => set('caller_id_number', e.target.value)} style={S.input} placeholder="(512) 555-0100" /></Field>
        <Field label="Default time zone" hint="Used when a contact has no time zone or state."><select value={f.timezone} onChange={e => set('timezone', e.target.value)} style={S.input}>{TZS.map(z => <option key={z}>{z}</option>)}</select></Field>
        <Field label="Max attempts per contact"><input type="number" min="1" max="30" value={f.max_attempts} onChange={e => set('max_attempts', e.target.value)} style={S.input} /></Field>
        <Field label="When to call back" hint="Smart: Command Center picks the next attempt from answer-rate history. Fixed: a set list of waits.">
          <select value={f.scheduling_mode} onChange={e => set('scheduling_mode', e.target.value)} style={S.input}>
            <option value="smart">Smart (recommended)</option><option value="fixed">Fixed waits</option>
          </select>
        </Field>
        {f.scheduling_mode === 'fixed' && (
          <Field label="Retry waits (minutes)" hint="Wait after attempt 1, 2, 3… The last value repeats."><input value={f.retry_text} onChange={e => set('retry_text', e.target.value)} style={S.input} placeholder="5, 60, 240, 1440" /></Field>
        )}
      </Grid>

      {f.scheduling_mode === 'smart' && <SmartRules value={f.scheduling || {}} onChange={v => set('scheduling', v)} campaignId={campaign?.id} />}

      <div>
        <div style={S.label}>Calling hours — in the <b>customer's</b> local time</div>
        <div style={{ display: 'grid', gap: 6 }}>
          {DAYS.map((d, i) => (
            <div key={d} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5 }}>
              <label style={{ width: 70, display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={!!f.hours[i]} onChange={() => toggleDay(i)} /> {d}
              </label>
              {f.hours[i] ? <>
                <input type="time" value={f.hours[i][0]} onChange={e => setDay(i, 0, e.target.value)} style={S.inputSm} />
                <span>to</span>
                <input type="time" value={f.hours[i][1]} onChange={e => setDay(i, 1, e.target.value)} style={S.inputSm} />
              </> : <span style={S.small}>No calls</span>}
            </div>
          ))}
        </div>
        <div style={{ ...S.small, marginTop: 6 }}>Federal rules allow 8am–9pm in the customer's time zone; some states are stricter. Leave a buffer.</div>
      </div>

      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
        <input type="checkbox" checked={f.record_calls} onChange={e => set('record_calls', e.target.checked)} />
        Record calls (customers hear "This call may be recorded for quality and training" when they answer)
      </label>

      <Field label="Script" hint="Use {{first_name}} or {{name}} to fill in the contact's name.">
        <textarea value={f.script} onChange={e => set('script', e.target.value)} rows={6} style={{ ...S.input, width: '100%', boxSizing: 'border-box', resize: 'vertical' }}
          placeholder={'Hi {{first_name}}, this is ___ with Cedar Park Overhead Doors. You reached out about your garage door…'} />
      </Field>

      <DispositionEditor value={defaultDispos} onChange={setDispos} />

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : campaign ? 'Save changes' : 'Create campaign'}</button>
        {msg && <span style={{ fontSize: 13 }}>{msg}</span>}
      </div>
    </div>
  )
}

// Smart scheduling rules + a peek at which hours the engine currently favors.
function SmartRules({ value, onChange, campaignId }) {
  const [hours, setHours] = useState(null)
  useEffect(() => {
    if (!campaignId) return
    supabase.rpc('dialer_hour_scores', { p_campaign: campaignId }).then(({ data }) => setHours(data || []))
  }, [campaignId])
  const v = { quick_retry_minutes: 10, second_gap_minutes: 120, max_per_day_first: 3, max_per_day: 2, vary_after_no_contacts: 2, interested_next_day_same_hour: true, ...value }
  const upd = (k, val) => onChange({ ...v, [k]: val })
  const hr = h => (h % 12 || 12) + (h < 12 ? 'am' : 'pm')
  const shown = (hours || []).filter(h => h.hour >= 8 && h.hour <= 20)
  const max = Math.max(0.0001, ...shown.map(h => Number(h.score)))
  const totalAttempts = (hours || []).reduce((s, h) => s + h.attempts, 0)
  return (
    <div style={{ border: '1px solid rgba(100,116,139,0.25)', borderRadius: 12, padding: 12, display: 'grid', gap: 10 }}>
      <div style={{ fontWeight: 700 }}>Smart scheduling</div>
      <div style={S.small}>
        New leads are called right away. After that, Command Center picks each next attempt: a quick second try, then the best-answering hours
        (in the customer's time zone), a different time of day after repeated no-answers, and the same hour next day when someone was interested
        but didn't set a time. HubSpot can still force a time by sending <code>call_after</code>.
      </div>
      <Grid>
        <Field label="Quick 2nd try (minutes after 1st)"><input type="number" min="1" value={v.quick_retry_minutes} onChange={e => upd('quick_retry_minutes', e.target.value)} style={S.input} /></Field>
        <Field label="Gap before 3rd try (minutes)"><input type="number" min="10" value={v.second_gap_minutes} onChange={e => upd('second_gap_minutes', e.target.value)} style={S.input} /></Field>
        <Field label="Max calls on day 1"><input type="number" min="1" max="10" value={v.max_per_day_first} onChange={e => upd('max_per_day_first', e.target.value)} style={S.input} /></Field>
        <Field label="Max calls per day after"><input type="number" min="1" max="10" value={v.max_per_day} onChange={e => upd('max_per_day', e.target.value)} style={S.input} /></Field>
        <Field label="Change time of day after N no-answers"><input type="number" min="1" max="10" value={v.vary_after_no_contacts} onChange={e => upd('vary_after_no_contacts', e.target.value)} style={S.input} /></Field>
      </Grid>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5 }}>
        <input type="checkbox" checked={v.interested_next_day_same_hour} onChange={e => upd('interested_next_day_same_hour', e.target.checked)} />
        "Interested — no time set" → call back next day at the same hour
      </label>
      {campaignId && shown.length > 0 && (
        <div>
          <div style={S.label}>Best hours right now <span style={{ ...S.small, fontWeight: 400 }}>({totalAttempts ? `${totalAttempts} past calls + industry baseline` : 'industry baseline until calls build up'})</span></div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 60 }}>
            {shown.map(h => (
              <div key={h.hour} title={`${hr(h.hour)}: ${h.connects}/${h.attempts} connected`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <div style={{ width: '100%', height: Math.max(4, 44 * Number(h.score) / max), background: '#0891b2', borderRadius: 3, opacity: 0.35 + 0.65 * Number(h.score) / max }} />
                <div style={{ fontSize: 10, opacity: 0.6 }}>{hr(h.hour)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function DispositionEditor({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const rows = value || []
  if (!value) return <div style={S.small}>Dispositions: the standard set (Booked, Callback — time set, Interested — no time set, Not interested, Wrong number, No answer, Left voicemail, Busy, Do not call). You can edit them after creating the campaign.</div>
  const upd = (i, k, v) => onChange(rows.map((r, j) => j === i ? { ...r, [k]: v } : r))
  return (
    <div>
      <button onClick={() => setOpen(o => !o)} style={S.btn}>{open ? 'Hide' : 'Edit'} dispositions ({rows.length})</button>
      {open && (
        <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
          <div style={{ ...S.small }}>Guardrails always apply: "No answer", "Left voicemail" and "Busy" are blocked if the call connected for over 20 seconds; anything marked "talked to them" is blocked if the call never connected.</div>
          {rows.map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <input value={r.label} onChange={e => upd(i, 'label', e.target.value)} style={{ ...S.inputSm, minWidth: 200 }} />
              <input value={r.code} onChange={e => upd(i, 'code', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))} style={{ ...S.inputSm, width: 150 }} title="Code (used in reports)" />
              <select value={r.outcome} onChange={e => upd(i, 'outcome', e.target.value)} style={S.inputSm}>
                {OUTCOMES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <label style={{ fontSize: 12.5, display: 'flex', gap: 4, alignItems: 'center' }}>
                <input type="checkbox" checked={!!r.is_contact} onChange={e => upd(i, 'is_contact', e.target.checked)} /> talked to them
              </label>
              <button onClick={() => onChange(rows.filter((_, j) => j !== i))} style={{ ...S.btn, padding: '4px 10px', color: '#b91c1c' }}>Remove</button>
            </div>
          ))}
          <button onClick={() => onChange([...rows, { code: 'new_outcome', label: 'New outcome', outcome: 'final', is_contact: true }])} style={{ ...S.btn, justifySelf: 'start' }}>+ Add disposition</button>
        </div>
      )}
    </div>
  )
}

// ---------------- AGENTS ----------------
function AgentsTab({ campaign }) {
  const [people, setPeople] = useState([])
  const [assigned, setAssigned] = useState(new Set())
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(null)
  useEffect(() => {
    Promise.all([
      supabase.from('profiles').select('id, full_name, email, role').eq('is_active', true).order('full_name'),
      supabase.from('dial_campaign_agents').select('profile_id').eq('campaign_id', campaign.id),
    ]).then(([p, a]) => {
      setPeople((p.data || []).filter(x => !/(^|,)(client|csr)(,|$)/.test(x.role || '')))
      setAssigned(new Set((a.data || []).map(r => r.profile_id)))
    })
  }, [campaign.id])
  async function toggle(id) {
    setBusy(id)
    if (assigned.has(id)) {
      await supabase.from('dial_campaign_agents').delete().eq('campaign_id', campaign.id).eq('profile_id', id)
      setAssigned(s => { const n = new Set(s); n.delete(id); return n })
    } else {
      await supabase.from('dial_campaign_agents').insert({ campaign_id: campaign.id, profile_id: id })
      setAssigned(s => new Set(s).add(id))
    }
    setBusy(null)
  }
  const list = people.filter(p => !search || (p.full_name + p.email).toLowerCase().includes(search.toLowerCase()))
  return (
    <div className="card">
      <p className="page-sub" style={{ marginTop: 0 }}>Agents checked here see this campaign on their Dialer page. Managers can always work any campaign. {assigned.size} assigned.</p>
      <input placeholder="Search" value={search} onChange={e => setSearch(e.target.value)} style={{ ...S.input, marginBottom: 8 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 4 }}>
        {list.map(p => (
          <label key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 8px', borderRadius: 8, background: assigned.has(p.id) ? 'rgba(8,145,178,0.08)' : 'transparent', fontSize: 13.5, cursor: 'pointer' }}>
            <input type="checkbox" checked={assigned.has(p.id)} disabled={busy === p.id} onChange={() => toggle(p.id)} />
            <span>{p.full_name || p.email} <span style={S.small}>· {p.role}</span></span>
          </label>
        ))}
      </div>
    </div>
  )
}

// ---------------- QUEUE ----------------
function QueueTab({ campaign }) {
  const [rows, setRows] = useState(null)
  const [filter, setFilter] = useState('open')
  const [add, setAdd] = useState({ name: '', phone: '', reason: '', state: '' })
  const [msg, setMsg] = useState('')
  async function load() {
    const { data, error } = await supabase.rpc('dialer_queue_view', { p_campaign: campaign.id, p_status: null, p_limit: 2000 })
    if (error) setMsg(error.message)
    setRows(data || [])
  }
  useEffect(() => { load() }, [campaign.id])
  const shown = useMemo(() => (rows || []).filter(r => filter === 'all' || (filter === 'open' ? ['pending', 'in_progress'].includes(r.status) : !['pending', 'in_progress'].includes(r.status))), [rows, filter])

  async function addOne() {
    setMsg('')
    const { data, error } = await supabase.rpc('dialer_add_contacts', { p_campaign: campaign.id, p_rows: [{ name: add.name, phone: add.phone, reason: add.reason, data: add.state ? { state: add.state.toUpperCase() } : {} }] })
    if (error) { setMsg(error.message); return }
    setMsg(summary(data)); setAdd({ name: '', phone: '', reason: '', state: '' }); load()
  }
  async function importCsv(file) {
    setMsg('Importing…')
    const parsed = parseCsv(await file.text())
    const payload = parsed.map(r => ({
      name: r.name || [r.first_name || r.firstname, r.last_name || r.lastname].filter(Boolean).join(' '),
      phone: r.phone || r.phone_number || r.mobile, reason: r.reason || r.notes || '',
      call_after: r.call_after || null, priority: r.priority ? Number(r.priority) : 0,
      source: 'upload',
      data: Object.fromEntries(Object.entries(r).filter(([k]) => !['name', 'first_name', 'firstname', 'last_name', 'lastname', 'phone', 'phone_number', 'mobile', 'reason', 'notes', 'call_after', 'priority'].includes(k) && r[k])),
    }))
    if (!payload.length) { setMsg('No rows found. The first row must be headers (name, phone, reason, state, …).'); return }
    const { data, error } = await supabase.rpc('dialer_add_contacts', { p_campaign: campaign.id, p_rows: payload })
    setMsg(error ? error.message : summary(data)); load()
  }
  async function remove(id) {
    await supabase.from('dial_queue').update({ status: 'removed', locked_by: null, locked_at: null, updated_at: new Date().toISOString() }).eq('id', id)
    load()
  }
  function summary(d) { return `Added ${d.added}. Skipped: ${d.duplicates} already queued, ${d.dnc} on do-not-call, ${d.invalid} bad numbers.` }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="card" style={{ display: 'grid', gap: 10 }}>
        <div style={{ fontWeight: 700 }}>Add contacts</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <input placeholder="Name" value={add.name} onChange={e => setAdd({ ...add, name: e.target.value })} style={S.inputSm} />
          <input placeholder="Phone" value={add.phone} onChange={e => setAdd({ ...add, phone: e.target.value })} style={S.inputSm} />
          <input placeholder="Reason (shown to agent)" value={add.reason} onChange={e => setAdd({ ...add, reason: e.target.value })} style={{ ...S.inputSm, minWidth: 220 }} />
          <input placeholder="State (TX)" value={add.state} maxLength={2} onChange={e => setAdd({ ...add, state: e.target.value })} style={{ ...S.inputSm, width: 80 }} />
          <button onClick={addOne} disabled={!add.phone} style={S.btn}>Add</button>
        </div>
        <div style={{ fontSize: 13 }}>
          Or import a CSV with headers like <code>name, phone, reason, state, address, call_after</code>:{' '}
          <input type="file" accept=".csv,text/csv" onChange={e => e.target.files?.[0] && importCsv(e.target.files[0])} />
        </div>
        {msg && <div style={{ fontSize: 13 }}>{msg}</div>}
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', gap: 6, padding: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {[['open', 'Open'], ['closed', 'Closed'], ['all', 'All']].map(([k, l]) => <button key={k} onClick={() => setFilter(k)} style={{ ...S.chip, ...(filter === k ? S.chipOn : {}) }}>{l}</button>)}
          <button onClick={load} style={{ ...S.btn, marginLeft: 'auto' }}>↻ Refresh</button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={S.table}>
            <thead><tr>{['Contact', 'Reason', 'Status', 'Attempts', 'Next try', 'Last result', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {rows === null ? <tr><td colSpan={7} style={S.td}>Loading…</td></tr> : shown.map(r => (
                <tr key={r.id}>
                  <td style={S.td}><div style={{ fontWeight: 600 }}>{r.contact_name || '—'}</div><div style={S.small}>…{r.phone_last4} · {r.source}</div></td>
                  <td style={S.td}>{r.reason || ''}</td>
                  <td style={S.td}>{Q_STATUS[r.status] || r.status}{r.locked_by_name ? <div style={S.small}>{r.locked_by_name}</div> : null}</td>
                  <td style={S.td}>{r.attempts}</td>
                  <td style={S.td}>{['pending'].includes(r.status) ? fmt(r.next_attempt_at) : ''}</td>
                  <td style={S.td}>{r.last_disposition ? ((campaign.dispositions || []).find(d => d.code === r.last_disposition)?.label || r.last_disposition) : ''}</td>
                  <td style={S.td}>{['pending', 'in_progress'].includes(r.status) && <button onClick={() => remove(r.id)} style={{ ...S.btn, padding: '3px 10px', color: '#b91c1c' }}>Remove</button>}</td>
                </tr>
              ))}
              {rows && !shown.length && <tr><td colSpan={7} style={{ ...S.td, ...S.muted }}>Nothing here.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ---------------- RESULTS ----------------
function ResultsTab({ campaign }) {
  const [rows, setRows] = useState(null)
  useEffect(() => { supabase.rpc('dialer_recent_attempts', { p_campaign: campaign.id, p_limit: 500 }).then(({ data }) => setRows(data || [])) }, [campaign.id])
  const totals = useMemo(() => {
    const r = rows || []
    const connected = r.filter(x => (x.talk_seconds || 0) > 0).length
    const by = {}; r.forEach(x => { if (x.disposition_label) by[x.disposition_label] = (by[x.disposition_label] || 0) + 1 })
    return { calls: r.length, connected, by }
  }, [rows])
  function exportCsv() {
    const cols = ['started_at', 'agent_name', 'contact_name', 'phone_last4', 'dial_status', 'talk_seconds', 'disposition_label', 'callback_at', 'notes', 'has_recording']
    const esc = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
    const csv = [cols.join(','), ...(rows || []).map(r => cols.map(c => esc(r[c])).join(','))].join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `${campaign.name}-calls.csv`; a.click()
  }
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="card" style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <Stat n={totals.calls} l="calls (last 500)" /><Stat n={totals.connected} l="connected" />
        {Object.entries(totals.by).sort((a, b) => b[1] - a[1]).map(([k, n]) => <Stat key={k} n={n} l={k} />)}
        <button onClick={exportCsv} style={{ ...S.btn, marginLeft: 'auto' }}>Export CSV</button>
      </div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={S.table}>
            <thead><tr>{['When', 'Agent', 'Contact', 'Call', 'Talk', 'Disposition', 'Notes'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {rows === null ? <tr><td colSpan={7} style={S.td}>Loading…</td></tr> : rows.map(r => (
                <tr key={r.id}>
                  <td style={S.td}>{fmt(r.started_at)}</td>
                  <td style={S.td}>{r.agent_name || ''}</td>
                  <td style={S.td}>{r.contact_name || '—'} <span style={S.small}>…{r.phone_last4}</span></td>
                  <td style={S.td}>{r.dial_status || 'in progress'}{r.has_recording ? ' · 🎙' : ''}</td>
                  <td style={S.td}>{dur(r.talk_seconds)}</td>
                  <td style={S.td}>{r.disposition_label || <span style={{ color: '#d97706' }}>not set</span>}{r.callback_at ? <div style={S.small}>callback {fmt(r.callback_at)}</div> : null}</td>
                  <td style={{ ...S.td, maxWidth: 260 }}>{r.notes || ''}</td>
                </tr>
              ))}
              {rows && !rows.length && <tr><td colSpan={7} style={{ ...S.td, ...S.muted }}>No calls yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ---------------- HUBSPOT ----------------
function HubspotTab({ campaign, onSaved }) {
  const [show, setShow] = useState(false)
  const [copied, setCopied] = useState('')
  const url = `${FN_BASE}/dialer-intake?campaign=${campaign.id}`
  const copy = (t, k) => navigator.clipboard?.writeText(t).then(() => { setCopied(k); setTimeout(() => setCopied(''), 1500) })
  async function regenerate() {
    if (!window.confirm('Make a new key? HubSpot workflows using the old key will stop working until you update them.')) return
    const bytes = new Uint8Array(18); crypto.getRandomValues(bytes)
    const key = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
    await supabase.from('dial_campaigns').update({ intake_key: key }).eq('id', campaign.id)
    onSaved(campaign.id)
  }
  const example = `{
  "hubspot_contact_id": "{{contact.hs_object_id}}",
  "firstname": "{{contact.firstname}}",
  "lastname": "{{contact.lastname}}",
  "phone": "{{contact.phone}}",
  "state": "{{contact.state}}",
  "reason": "Web lead — {{contact.service_needed}}",
  "call_after": "2026-10-20T16:00:00-05:00",
  "priority": 10
}`
  return (
    <div className="card" style={{ display: 'grid', gap: 14 }}>
      <p className="page-sub" style={{ margin: 0 }}>
        In a HubSpot workflow, add a <b>Send a webhook</b> action (POST) to this URL with the key below as a header. HubSpot decides <i>who</i> and <i>when</i>; the dialer makes the calls.
        Send <code>"action": "remove"</code> with the same contact id to pull someone out (e.g. they booked online).
      </p>
      <Field label="Webhook URL">
        <div style={{ display: 'flex', gap: 6 }}><input readOnly value={url} style={{ ...S.input, flex: 1, fontFamily: 'monospace', fontSize: 12.5 }} /><button onClick={() => copy(url, 'url')} style={S.btn}>{copied === 'url' ? 'Copied' : 'Copy'}</button></div>
      </Field>
      <Field label="Header" hint="Header name: X-Opsis-Key">
        <div style={{ display: 'flex', gap: 6 }}>
          <input readOnly type={show ? 'text' : 'password'} value={campaign.intake_key} style={{ ...S.input, flex: 1, fontFamily: 'monospace', fontSize: 12.5 }} />
          <button onClick={() => setShow(s => !s)} style={S.btn}>{show ? 'Hide' : 'Show'}</button>
          <button onClick={() => copy(campaign.intake_key, 'key')} style={S.btn}>{copied === 'key' ? 'Copied' : 'Copy'}</button>
          <button onClick={regenerate} style={{ ...S.btn, color: '#b91c1c' }}>New key</button>
        </div>
      </Field>
      <Field label="Example body" hint="Every field except phone is optional. call_after = don't call before this time. state (or timezone) sets the customer's calling hours.">
        <pre style={{ margin: 0, padding: 12, borderRadius: 8, background: 'rgba(100,116,139,0.1)', fontSize: 12.5, overflowX: 'auto' }}>{example}</pre>
      </Field>
      {campaign.status !== 'active' && <div style={{ fontSize: 13, color: '#d97706' }}>This campaign is <b>{campaign.status}</b>. HubSpot can still add contacts, but agents won't get them until it's Active.</div>}
    </div>
  )
}

// ---------------- DNC ----------------
function DncPanel({ clients }) {
  const [phone, setPhone] = useState('')
  const [client, setClient] = useState('')
  const [msg, setMsg] = useState('')
  async function addDnc() {
    setMsg('')
    const { error } = await supabase.rpc('dialer_add_dnc', { p_phone: phone, p_client: client || null, p_reason: 'Added manually' })
    if (error) { setMsg(error.message); return }
    setMsg('Added — and pulled from any open queues.'); setPhone('')
  }
  return (
    <div className="card" style={{ marginTop: 20 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Do-not-call list</div>
      <p className="page-sub" style={{ marginTop: 0 }}>Numbers here are never dialed. "Do not call" dispositions add to it automatically (for that client).</p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <input placeholder="Phone number" value={phone} onChange={e => setPhone(e.target.value)} style={S.inputSm} />
        <select value={client} onChange={e => setClient(e.target.value)} style={S.inputSm}>
          <option value="">All clients</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button onClick={addDnc} disabled={!phone} style={S.btn}>Add to DNC</button>
        {msg && <span style={{ fontSize: 13 }}>{msg}</span>}
      </div>
    </div>
  )
}

function Grid({ children }) { return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12 }}>{children}</div> }
function Field({ label, hint, children }) { return <div><div style={S.label}>{label}</div>{children}{hint && <div style={{ ...S.small, marginTop: 3 }}>{hint}</div>}</div> }

const S = {
  list: { display: 'grid', gap: 8 },
  rowBtn: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, border: '1px solid rgba(100,116,139,0.25)', background: 'transparent', color: 'inherit', cursor: 'pointer', flexWrap: 'wrap' },
  badge: { color: '#fff', fontSize: 11.5, fontWeight: 700, padding: '3px 10px', borderRadius: 999, textTransform: 'capitalize' },
  btn: { padding: '7px 12px', borderRadius: 8, border: '1px solid rgba(100,116,139,0.35)', background: 'transparent', color: 'inherit', fontWeight: 600, fontSize: 13, cursor: 'pointer' },
  chip: { padding: '6px 12px', borderRadius: 999, border: '1px solid rgba(100,116,139,0.35)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  chipOn: { background: '#0891b2', borderColor: '#0891b2', color: '#fff' },
  input: { width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(100,116,139,0.35)', background: 'transparent', color: 'inherit', fontSize: 14, fontFamily: 'inherit' },
  inputSm: { padding: '6px 8px', borderRadius: 8, border: '1px solid rgba(100,116,139,0.35)', background: 'transparent', color: 'inherit', fontSize: 13, fontFamily: 'inherit' },
  label: { fontSize: 12.5, fontWeight: 700, marginBottom: 4 },
  small: { fontSize: 12, opacity: 0.65 },
  muted: { fontSize: 13, opacity: 0.7, padding: 12 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13.5 },
  th: { textAlign: 'left', padding: '8px 12px', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.4, opacity: 0.65, borderBottom: '1px solid rgba(100,116,139,0.25)' },
  td: { padding: '8px 12px', borderBottom: '1px solid rgba(100,116,139,0.12)', verticalAlign: 'top' },
  error: { marginBottom: 12, padding: '10px 12px', background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.35)', color: '#b91c1c', borderRadius: 10, fontSize: 13 },
}
