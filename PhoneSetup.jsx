// ============================================================
//  PhoneSetup — clients build their own inbound lines and outbound campaigns (2026-11-10, Becky).
//  Portal page "Phone setup". Edit: Opsis staff, client admins (all brands), RMs (their brand).
//  GMs see their location read-only. Phone numbers are connected by Opsis.
//  RPCs: pc_setup_get, pc_line_save, pc_campaign_save, pc_campaign_contacts.
// ============================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import CxEngineSetup from '../components/CxEngineSetup'

// Speed-to-lead "middle ground" cadence (Becky's doc, Sept 2026): 8 dials over 5 dialing days, 5 in the first two days.
const WHEN = [['asap', 'Right away (within 15 seconds)'], ['after_hours', 'Hours after the last dial'], ['morning', 'Morning (8–11 am)'], ['late_morning', 'Late morning (10 am–12 pm)'],
  ['evening', 'Evening (5:30–7:30 pm)'], ['late_morning_or_evening', 'Late morning or evening'], ['any', 'Any open time']]
const VMS = [['leave', 'Leave VM'], ['none', 'No VM'], ['final', 'Final VM, then retire']]
const S2L_CADENCE = [
  { day: 1, when: 'asap', vm: 'leave' }, { day: 1, when: 'after_hours', hours: 3, vm: 'none' }, { day: 1, when: 'evening', vm: 'none' },
  { day: 2, when: 'morning', vm: 'leave' }, { day: 2, when: 'evening', vm: 'none' },
  { day: 3, when: 'late_morning_or_evening', vm: 'none' }, { day: 4, when: 'late_morning_or_evening', vm: 'leave' }, { day: 5, when: 'any', vm: 'final' },
]
const S2L_HOURS = { 1: ['08:00', '19:30'], 2: ['08:00', '19:30'], 3: ['08:00', '19:30'], 4: ['08:00', '19:30'], 5: ['08:00', '19:30'], 6: ['08:00', '14:00'], 0: ['10:00', '14:00'] }
const DAYS = [['1', 'Mon'], ['2', 'Tue'], ['3', 'Wed'], ['4', 'Thu'], ['5', 'Fri'], ['6', 'Sat'], ['0', 'Sun']]
const TZS = [['America/New_York', 'Eastern'], ['America/Chicago', 'Central'], ['America/Denver', 'Mountain'], ['America/Phoenix', 'Arizona'], ['America/Los_Angeles', 'Pacific']]
const MODES = [
  ['preview', 'Preview', 'CSR sees the contact, then clicks Call'],
  ['progressive', 'Progressive', 'Calls automatically after a short countdown'],
  ['auto', 'Auto-dial (speed to lead)', 'Calls the moment a lead arrives — no countdown'],
]
// Campaign types (2026-11-10): outbound is worked in the location's chosen order (Blending tab).
const KINDS = [['missed', 'Missed calls'], ['s2l', 'Speed to lead'], ['callback', 'Callbacks'], ['lifecycle', 'Lifecycle'], ['not_booked', 'Not booked / open quotes'], ['other', 'Other']]
const kindLabel = k => (KINDS.find(x => x[0] === k) || KINDS[5])[1]
const STATUS = { active: ['Live', '#15803d', '#dcfce7'], paused: ['Paused', '#b45309', '#fef3c7'], draft: ['Draft', '#475569', '#f1f5f9'] }
const fmtPhone = v => { const d = String(v || '').replace(/\D/g, '').slice(-10); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (v || '') }
// Manual dialing isn't a campaign choice (2026-11-10, Becky) — CSRs use the dial pad on their Phone page.
const modeOf = c => c.is_manual ? 'preview' : c.mode === 'progressive' && Number(c.delay) === 0 ? 'auto' : c.mode

export default function PhoneSetup({ clientId = null }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const [tab, setTab] = useState('in')
  const [edit, setEdit] = useState(null)   // {kind:'line'|'camp', row}
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const args = useCallback(x => (clientId ? { ...x, p_client: clientId } : x), [clientId])

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('pc_setup_get', args({}))
    if (error) setErr(error.message); else { setD(data); setErr('') }
  }, [args])
  useEffect(() => { load() }, [load])
  // The portal's ← Back button closes an open form first, so you land back on the list/tab you came from (2026-11-10, Becky).
  useEffect(() => {
    if (!edit) return
    window.__oqExtBack = () => { setEdit(null); setMsg(''); return true }
    return () => { delete window.__oqExtBack }
  }, [edit])

  async function save(kind, row) {
    setSaving(true); setMsg('')
    const { data, error } = await supabase.rpc(kind === 'line' ? 'pc_line_save' : 'pc_campaign_save', args({ p: row }))
    setSaving(false)
    if (error) { setMsg(error.message); return false }
    setD(data); setEdit(null); setMsg('Saved.'); setTimeout(() => setMsg(''), 2500)
    return true
  }

  if (err && !d) return <div style={S.card}><b>Couldn’t load phone setup.</b><p style={S.mut}>{err}</p></div>
  if (!d) return <div style={S.card}>Loading phone setup…</div>
  const can = !!d.can_edit
  const scope = d.scope.location ? `${d.scope.brand} · ${d.scope.location}` : d.scope.brand || 'All brands'

  if (edit?.kind === 'line') return <LineForm d={d} row={edit.row} can={can} saving={saving} msg={msg} args={args} onData={setD} onCancel={() => { setEdit(null); setMsg('') }} onSave={r => save('line', r)} />
  if (edit?.kind === 'camp') return <CampForm d={d} row={edit.row} can={can} saving={saving} msg={msg} args={args} reload={load} onCancel={() => { setEdit(null); setMsg('') }} onSave={r => save('camp', r)} />

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ ...S.card, display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={S.h1}>Phone setup <span style={{ fontWeight: 600, color: '#5F6763', fontSize: 14 }}>· {scope}</span></div>
          <div style={S.mut}>{can ? 'Build the lines your customers call and the lists your CSRs call out to.' : 'View only. Ask an admin or your RM to make changes.'}</div>
        </div>
        <div style={S.seg}>
          {[['in', `Inbound lines (${d.lines.length})`], ['out', `Outbound campaigns (${d.campaigns.filter(c => !c.is_manual).length})`], ['blend', 'Blending']].concat(!d.scope.brand && can ? [['central', 'Central team']] : []).concat([['cx', 'Advanced engine']]).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} style={{ ...S.segBtn, ...(tab === k ? S.segOn : {}) }}>{l}</button>
          ))}
        </div>
      </div>
      {msg && <div style={S.ok}>{msg}</div>}

      {tab === 'cx' ? <CxEngineSetup args={args} people={d.people || []} can={can} /> : tab === 'central' ? <CentralTeam args={args} onChange={load} /> : tab === 'blend' ? <Blending d={d} args={args} /> : tab === 'in' ? (
        <>
          {can && <div><button style={S.primary} onClick={() => setEdit({ kind: 'line', row: null })}>+ New inbound line</button></div>}
          {d.lines.length === 0 && <div style={S.card}><p style={S.mut}>No inbound lines yet.</p></div>}
          <div style={S.grid}>
            {d.lines.map(l => (
              <div key={l.id} style={S.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ fontWeight: 800, fontSize: 15 }}>{l.name}</div>
                  <span style={{ ...S.pill, color: l.active ? '#15803d' : '#475569', background: l.active ? '#dcfce7' : '#f1f5f9' }}>{l.active ? 'On' : 'Off'}</span>
                </div>
                <div style={S.mut}>{[l.brand, l.location].filter(Boolean).join(' · ')}</div>
                <div style={{ marginTop: 8, fontSize: 13 }}>{l.number ? <>Rings on <b>{fmtPhone(l.number)}</b></> : <span style={{ color: '#b45309' }}>No number connected yet — Opsis connects it</span>}</div>
                <div style={S.statRow}>
                  <Stat v={(l.menu || []).length || '—'} l="Menu options" /><Stat v={new Set((l.members || []).map(m => m.profile_id)).size} l="People answering" />
                  <Stat v={l.today?.calls || 0} l="Calls 24h" /><Stat v={l.today?.missed || 0} l="Missed 24h" warn={l.today?.missed > 0} />
                </div>
                <button style={{ ...S.btn, marginTop: 10 }} onClick={() => setEdit({ kind: 'line', row: l })}>{can ? 'Edit' : 'View'}</button>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          {can && <div><button style={S.primary} onClick={() => setEdit({ kind: 'camp', row: null })}>+ New outbound campaign</button></div>}
          {d.campaigns.filter(c => !c.is_manual).length === 0 && <div style={S.card}><p style={S.mut}>No campaigns yet.</p></div>}
          <div style={S.grid}>
            {d.campaigns.filter(c => !c.is_manual).map(c => {
              const st = STATUS[c.status] || STATUS.draft
              const m = MODES.find(x => x[0] === modeOf(c))
              return (
                <div key={c.id} style={S.card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ fontWeight: 800, fontSize: 15 }}>{c.name}</div>
                    <span style={{ ...S.pill, color: st[1], background: st[2] }}>{st[0]}</span>
                  </div>
                  <div style={S.mut}>{[c.brand, c.location].filter(Boolean).join(' · ')} · {kindLabel(c.kind)} · {m ? m[1] : c.mode}</div>
                  <div style={S.statRow}>
                    <Stat v={c.stats?.pending || 0} l="Waiting to call" /><Stat v={c.stats?.done || 0} l="Finished" />
                    <Stat v={(c.agents || []).length} l="CSRs" /><Stat v={c.max_attempts} l="Max tries" />
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    <button style={S.btn} onClick={() => setEdit({ kind: 'camp', row: c })}>{can ? 'Edit' : 'View'}</button>
                    {can && c.status !== 'active' && <button style={{ ...S.btn, color: '#15803d', borderColor: '#86efac' }} disabled={saving} onClick={() => save('camp', { id: c.id, name: c.name, brand: c.brand, location: c.location, status: 'active' })}>Go live</button>}
                    {can && c.status === 'active' && <button style={{ ...S.btn, color: '#b45309' }} disabled={saving} onClick={() => save('camp', { id: c.id, name: c.name, brand: c.brand, location: c.location, status: 'paused' })}>Pause</button>}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ v, l, warn }) { return <div><div style={{ fontSize: 18, fontWeight: 800, color: warn ? '#b91c1c' : '#1C2421' }}>{v}</div><div style={{ fontSize: 11, color: '#5F6763' }}>{l}</div></div> }

// ---------- shared bits ----------
// Dial-by-dial plan (2026-11-10, Becky): each dial gets a day, a time window and a voicemail rule.
function Cadence({ value, onChange, disabled }) {
  const rows = value || []
  const upd = (i, k, v) => onChange(rows.map((r, j) => j === i ? { ...r, [k]: v } : r))
  const vmCount = rows.filter(r => r.vm !== 'none').length
  const days = rows.reduce((m, r) => Math.max(m, Number(r.day) || 1), 1)
  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ textAlign: 'left', color: '#5F6763', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            <th style={{ padding: '6px 8px' }}>Dial</th><th style={{ padding: '6px 8px' }}>Day</th><th style={{ padding: '6px 8px' }}>Timing</th><th style={{ padding: '6px 8px' }}>Voicemail</th><th />
          </tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i} style={{ borderTop: '1px solid #EEEAE2', background: Number(r.day) <= 2 ? '#F4F8F5' : 'transparent' }}>
              <td style={{ padding: '6px 8px', fontWeight: 800 }}>{i + 1}</td>
              <td style={{ padding: '6px 8px' }}><select disabled={disabled} value={r.day || 1} onChange={e => upd(i, 'day', Number(e.target.value))} style={S.inSm}>
                {Array.from({ length: 14 }, (_, k) => k + 1).map(n => <option key={n} value={n}>Day {n}</option>)}</select></td>
              <td style={{ padding: '6px 8px' }}>
                <select disabled={disabled || i === 0} value={i === 0 ? 'asap' : (r.when || 'any')} onChange={e => upd(i, 'when', e.target.value)} style={S.inSm}>
                  {WHEN.filter(w => i === 0 || w[0] !== 'asap').map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                {r.when === 'after_hours' && i > 0 && <select disabled={disabled} value={r.hours || 3} onChange={e => upd(i, 'hours', Number(e.target.value))} style={{ ...S.inSm, marginLeft: 6 }}>
                  {[1, 2, 3, 4, 6, 8, 24].map(n => <option key={n} value={n}>{n} hr{n > 1 ? 's' : ''}</option>)}</select>}
              </td>
              <td style={{ padding: '6px 8px' }}><select disabled={disabled} value={r.vm || 'none'} onChange={e => upd(i, 'vm', e.target.value)} style={S.inSm}>
                {VMS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
              <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{!disabled && <>
                <button style={S.link} disabled={i === 0} onClick={() => { const n = [...rows]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; onChange(n) }}>↑</button>
                <button style={S.link} disabled={i === rows.length - 1} onClick={() => { const n = [...rows]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; onChange(n) }}>↓</button>
                {rows.length > 1 && <button style={S.link} onClick={() => onChange(rows.filter((_, j) => j !== i))}>Remove</button>}
              </>}</td>
            </tr>))}</tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
        {!disabled && rows.length < 20 && <button style={S.btn} onClick={() => onChange([...rows, { day: Math.min(14, (Number(rows[rows.length - 1]?.day) || 1) + 1), when: 'any', vm: 'none' }])}>+ Add a dial</button>}
        {!disabled && <button style={S.link} onClick={() => onChange(S2L_CADENCE.map(x => ({ ...x })))}>Reset to the speed-to-lead plan</button>}
        <span style={S.mut}>{rows.length} dials over {days} dialing day{days > 1 ? 's' : ''} · {vmCount} voicemail{vmCount === 1 ? '' : 's'} · weekends count as dialing days · retired after the last dial</span>
      </div>
    </div>
  )
}
function Hours({ value, onChange, disabled }) {
  const h = value || {}
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {DAYS.map(([k, l]) => {
        const on = Array.isArray(h[k])
        return (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <label style={{ width: 70, display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
              <input type="checkbox" disabled={disabled} checked={on} onChange={() => { const n = { ...h }; if (on) delete n[k]; else n[k] = ['09:00', '17:00']; onChange(n) }} /> {l}
            </label>
            {on ? (<>
              <input type="time" disabled={disabled} value={h[k][0]} onChange={e => onChange({ ...h, [k]: [e.target.value, h[k][1]] })} style={S.inSm} />
              <span style={S.mut}>to</span>
              <input type="time" disabled={disabled} value={h[k][1]} onChange={e => onChange({ ...h, [k]: [h[k][0], e.target.value] })} style={S.inSm} />
            </>) : <span style={S.mut}>Closed</span>}
          </div>
        )
      })}
    </div>
  )
}
// Only people from the line's / campaign's brand (and location, when one is set) — 2026-11-10, Becky.
// Anyone already picked stays visible so they can be unchecked.
// Centralized CSRs approved for this brand (Central team tab) show too, tagged "Central".
// Admins can flip "Show everyone" to pick from every CSR.
function People({ people, selected, onChange, disabled, filter, brand, location, allowAll }) {
  const [all, setAll] = useState(false)
  const loc = String(location || '').trim().toLowerCase()
  const central = p => !!brand && p.brand !== brand && (p.approved || []).includes(brand)
  const list = people.filter(p => selected.includes(p.id) || all || (
    (!filter || filter(p)) && (
      central(p) ||
      ((brand ? p.brand === brand : false) && (!loc || !p.location || String(p.location).toLowerCase() === loc)))))
  const groups = [['CSR', 'CSRs'], ['GM', 'GMs'], ['RM', 'RMs'], ['ADMIN', 'Admins'], ['MANAGER', 'Managers']]
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {groups.map(([r, label]) => {
        const g = list.filter(p => p.role === r); if (!g.length) return null
        return (
          <div key={r}>
            <div style={S.cap}>{label}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {g.map(p => {
                const on = selected.includes(p.id)
                return (
                  <label key={p.id} style={{ ...S.chip, background: on ? '#E6F0EA' : '#fff', borderColor: on ? '#2F7D5B' : '#E1DCD2' }}>
                    <input type="checkbox" disabled={disabled} checked={on} onChange={() => onChange(on ? selected.filter(x => x !== p.id) : [...selected, p.id])} />
                    {p.name}{p.brand && p.brand !== brand ? <span style={{ color: '#8a918d' }}> · {p.brand}</span> : ''}{p.location ? <span style={{ color: '#8a918d' }}> · {p.location}</span> : ''}
                    {central(p) && <span style={{ ...S.pill, padding: '1px 7px', fontSize: 10.5, background: '#E0E7FF', color: '#3730A3' }}>Central</span>}
                  </label>
                )
              })}
            </div>
          </div>
        )
      })}
      {list.length === 0 && <span style={S.mut}>{brand ? `No ${brand}${loc ? ' ' + location : ''} people yet.` : 'Pick a brand first.'}</span>}
      {allowAll && !disabled && <label style={{ fontSize: 12.5, color: '#5F6763', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
        <input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> Show every CSR (all brands)</label>}
    </div>
  )
}
function Section({ title, hint, children }) {
  return <div style={S.card}><div style={{ fontWeight: 800, fontSize: 15, marginBottom: hint ? 2 : 10 }}>{title}</div>{hint && <div style={{ ...S.mut, marginBottom: 12 }}>{hint}</div>}{children}</div>
}
function Field({ label, children, hint }) { return <label style={S.lbl}>{label}{children}{hint && <span style={{ ...S.mut, fontWeight: 400 }}>{hint}</span>}</label> }
function FormBar({ title, onCancel, onSave, saving, can, msg }) {
  return (
    <div style={{ ...S.card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', position: 'sticky', top: 0, zIndex: 5 }}>
      <div style={S.h1}>{title}</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {msg && <span style={{ fontSize: 13, color: /Saved/.test(msg) ? '#15803d' : '#b91c1c' }}>{msg}</span>}
        <button style={S.btn} onClick={onCancel}>{can ? 'Cancel' : 'Back'}</button>
        {can && <button style={S.primary} disabled={saving} onClick={onSave}>{saving ? 'Saving…' : 'Save'}</button>}
      </div>
    </div>
  )
}

// ---------- inbound line ----------
function LineForm({ d, row, can, saving, msg, args, onData, onCancel, onSave }) {
  const [f, setF] = useState(() => row ? JSON.parse(JSON.stringify(row)) : {
    name: '', brand: d.scope.brand || '', location: d.scope.location || '', active: true, timezone: 'America/Chicago', ring_seconds: 25, record_calls: true, ai_enabled: true,
    greeting: '', menu: [], members: [], hours: { 1: ['08:00', '17:00'], 2: ['08:00', '17:00'], 3: ['08:00', '17:00'], 4: ['08:00', '17:00'], 5: ['08:00', '17:00'] }, callback_campaign_id: null,
  })
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const queues = useMemo(() => ['main', ...new Set((f.menu || []).map(m => m.queue).filter(Boolean))], [f.menu])
  const membersOf = q => (f.members || []).filter(m => (m.queue || 'main') === q).map(m => m.profile_id)
  const setMembers = (q, ids) => set('members', [...(f.members || []).filter(m => (m.queue || 'main') !== q), ...ids.map(id => ({ profile_id: id, queue: q }))])
  const dis = !can
  // Missed-call campaigns: this line's brand (and location, if the campaign has one). Missed-call campaigns first.
  const [mcBusy, setMcBusy] = useState(false)
  const [mcMsg, setMcMsg] = useState('')
  const kindLabel = k => (KINDS.find(x => x[0] === (k || 'other')) || [, 'Other'])[1]
  const missedCamps = d.campaigns
    .filter(c => !c.is_manual && (!f.brand || c.brand === f.brand) && (!f.location || !c.location || String(c.location).toLowerCase() === String(f.location).toLowerCase()))
    .sort((a, b) => ((a.kind === 'missed') ? 0 : 1) - ((b.kind === 'missed') ? 0 : 1) || a.name.localeCompare(b.name))
  async function createMissed() {
    if (!f.brand) { setMcMsg('Pick a brand first.'); return }
    setMcBusy(true); setMcMsg('')
    const name = `${f.brand}${f.location ? ' ' + f.location : ''} — Missed calls`
    const agents = [...new Set((f.members || []).map(m => m.profile_id))]
    const { data, error } = await supabase.rpc('pc_campaign_save', args({ p: {
      name, brand: f.brand, location: f.location || null, status: 'active', kind: 'missed', timezone: f.timezone || 'America/Chicago',
      hours: f.hours, max_attempts: 3, retry_minutes: [15, 120, 1440], record_calls: true, script_id: null, agents,
      dispositions: d.dispositions, is_manual: false, mode: 'preview', delay: 3 } }))
    setMcBusy(false)
    if (error) { setMcMsg(error.message); return }
    onData(data)
    const made = (data.campaigns || []).filter(c => c.name === name && c.kind === 'missed').pop()
    if (made) { set('callback_campaign_id', made.id); setMcMsg('Created. Save the line to keep it.') }
  }
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <FormBar title={row ? `Edit: ${row.name}` : 'New inbound line'} onCancel={onCancel} onSave={() => onSave(f)} saving={saving} can={can} msg={msg} />
      <Section title="Basics">
        <div style={S.form}>
          <Field label="Line name"><input disabled={dis} value={f.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Cheney Door — Salina main line" style={S.input} /></Field>
          <Field label="Brand">{d.scope.brand ? <input disabled value={d.scope.brand} style={S.input} /> :
            <select disabled={dis} value={f.brand || ''} onChange={e => set('brand', e.target.value)} style={S.input}><option value="">Pick a brand</option>{d.brands.map(b => <option key={b}>{b}</option>)}</select>}</Field>
          <Field label="Location"><input disabled={dis || !!d.scope.location} value={f.location || ''} onChange={e => set('location', e.target.value)} placeholder="e.g. Salina" style={S.input} /></Field>
          <Field label="Number customers call" hint={f.number ? `Connected: ${fmtPhone(f.number)}` : 'Opsis connects the line to this number.'}>
            <input disabled={dis} value={f.published_number || ''} onChange={e => set('published_number', e.target.value)} placeholder="(785) 555-0100" style={S.input} /></Field>
          <Field label="Time zone"><select disabled={dis} value={f.timezone} onChange={e => set('timezone', e.target.value)} style={S.input}>{TZS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field label="Line is on"><select disabled={dis} value={f.active ? '1' : '0'} onChange={e => set('active', e.target.value === '1')} style={S.input}><option value="1">On</option><option value="0">Off</option></select></Field>
        </div>
      </Section>
      <Section title="Greeting" hint="What callers hear first.">
        <textarea disabled={dis} rows={3} value={f.greeting || ''} onChange={e => set('greeting', e.target.value)} placeholder="Thank you for calling Cheney Door in Salina." style={{ ...S.input, resize: 'vertical' }} />
      </Section>
      <Section title="Phone menu" hint="Optional. Callers press a number (or say the option) to reach the right group. No options = everyone rings in one group.">
        {(f.menu || []).map((m, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ ...S.pill, background: '#14302A', color: '#fff' }}>Press {m.key}</span>
            <input disabled={dis} value={m.label || ''} onChange={e => { const n = [...f.menu]; n[i] = { ...m, label: e.target.value, queue: (m.queue && m.queue !== slug(m.label)) ? m.queue : slug(e.target.value) }; set('menu', n) }} placeholder="e.g. Schedule service" style={{ ...S.input, width: 220, marginTop: 0 }} />
            <select disabled={dis} value={m.script_id || ''} onChange={e => { const n = [...f.menu]; n[i] = { ...m, script_id: e.target.value || null }; set('menu', n) }} style={{ ...S.input, width: 240, marginTop: 0 }}>
              <option value="">No script</option>{d.scripts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {/* Advanced engine (2026-11-13): only CSRs with this skill get these calls; priority jumps the line */}
            <input disabled={dis} value={m.skill || ''} onChange={e => { const n = [...f.menu]; n[i] = { ...m, skill: e.target.value.trim() ? e.target.value : null }; set('menu', n) }} placeholder="Skill (optional)" title="Advanced engine: only CSRs with this skill get these calls" style={{ ...S.input, width: 140, marginTop: 0 }} />
            <select disabled={dis} value={m.priority || 0} onChange={e => { const n = [...f.menu]; n[i] = { ...m, priority: Number(e.target.value) || 0 }; set('menu', n) }} title="Advanced engine: higher priority callers are answered first" style={{ ...S.input, width: 130, marginTop: 0 }}>
              <option value={0}>Normal priority</option><option value={10}>High priority</option><option value={20}>Urgent</option>
            </select>
            {!dis && <button style={S.link} onClick={() => set('menu', f.menu.filter((_, j) => j !== i).map((x, j) => ({ ...x, key: String(j + 1) })))}>Remove</button>}
          </div>
        ))}
        {!dis && (f.menu || []).length < 9 && <button style={S.btn} onClick={() => set('menu', [...(f.menu || []), { key: String((f.menu || []).length + 1), label: '', queue: '', words: [] }])}>+ Add option</button>}
      </Section>
      <Section title="Who answers" hint="These people ring when they're logged in and Ready.">
        {queues.map(q => (
          <div key={q} style={{ marginBottom: 12 }}>
            {queues.length > 1 && <div style={{ fontWeight: 700, marginBottom: 6 }}>{q === 'main' ? 'Everyone else / no option picked' : (f.menu.find(m => m.queue === q)?.label || q)}</div>}
            <People people={d.people} allowAll={!d.scope.brand} brand={d.scope.brand || f.brand} location={d.scope.location || f.location} selected={membersOf(q)} onChange={ids => setMembers(q, ids)} disabled={dis} />
          </div>
        ))}
      </Section>
      <Section title="Hours" hint="When CSRs answer. Outside these hours the after-hours option below takes over.">
        <Hours value={f.hours} onChange={v => set('hours', v)} disabled={dis} />
      </Section>
      <Section title="Dispositions" hint="What CSRs pick after an incoming call on this line. Add, remove, rename or reorder them.">
        <DispoEditor value={f.dispositions || d.dispositions} standard={d.dispositions} disabled={dis} onChange={v => set('dispositions', v)} />
      </Section>
      <Section title="When nobody answers">
        <div style={S.form}>
          <Field label="Ring CSRs for"><select disabled={dis} value={f.ring_seconds} onChange={e => set('ring_seconds', Number(e.target.value))} style={S.input}>{[15, 20, 25, 30, 45, 60].map(s => <option key={s} value={s}>{s} seconds</option>)}</select></Field>
          <Field label="Then"><select disabled={dis} value={f.ai_enabled ? 'ai' : 'vm'} onChange={e => set('ai_enabled', e.target.value === 'ai')} style={S.input}><option value="ai">The AI CSR answers</option><option value="vm">Voicemail</option></select></Field>
          <Field label="Missed calls go to" hint={mcMsg || (missedCamps.length ? 'Missed and hung-up callers are added to this campaign so a CSR calls them back.' : `No ${f.brand || ''} campaigns yet — pick "Create a missed calls campaign" and we'll set one up with this line's CSRs.`)}>
            <select disabled={dis || mcBusy} value={f.callback_campaign_id || ''} onChange={e => { const v = e.target.value; if (v === '__new') { createMissed(); return } set('callback_campaign_id', v || null) }} style={S.input}>
              <option value="">Don't call them back automatically</option>
              {missedCamps.map(c => <option key={c.id} value={c.id}>{c.name}{c.kind === 'missed' ? '' : ` (${kindLabel(c.kind)})`}{c.status !== 'active' ? ` · ${c.status}` : ''}</option>)}
              {!dis && <option value="__new">+ Create a missed calls campaign</option>}
            </select>{mcBusy && <span style={S.mut}> Creating…</span>}</Field>
          <Field label="Record calls"><select disabled={dis} value={f.record_calls ? '1' : '0'} onChange={e => set('record_calls', e.target.value === '1')} style={S.input}><option value="1">Yes (for QA)</option><option value="0">No</option></select></Field>
        </div>
      </Section>
    </div>
  )
}
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30)

// ---------- outbound campaign ----------
function CampForm({ d, row, can, saving, msg, args, reload, onCancel, onSave }) {
  const [f, setF] = useState(() => row ? { ...JSON.parse(JSON.stringify(row)), _mode: modeOf(row) } : {
    name: '', brand: d.scope.brand || '', location: d.scope.location || '', status: 'draft', kind: 'other', _mode: 'preview', delay: 3, timezone: 'America/Chicago', max_attempts: 4,
    retry_minutes: [60, 240, 1440], record_calls: true, script_id: null, agents: [],
    scheduling_mode: 'cadence', scheduling: { cadence: S2L_CADENCE, skip_afternoon: true, vary_hour: true },
    hours: { ...S2L_HOURS },
  })
  const [csv, setCsv] = useState('')
  const [upMsg, setUpMsg] = useState('')
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const dis = !can
  const sch = f.scheduling || {}
  const cad = Array.isArray(sch.cadence) && sch.cadence.length ? sch.cadence : S2L_CADENCE
  const setSch = (k, v) => set('scheduling', { ...sch, cadence: cad, [k]: v })
  function payload() {
    const m = f._mode
    return { id: f.id, name: f.name, brand: f.brand, location: f.location, status: f.status, kind: f.kind || 'other', timezone: f.timezone, hours: f.hours, max_attempts: f.max_attempts,
      retry_minutes: f.retry_minutes, record_calls: f.record_calls, script_id: f.script_id, agents: f.agents, dispositions: f.dispositions || d.dispositions,
      scheduling_mode: f.scheduling_mode || 'smart', ...(f.scheduling_mode === 'cadence' ? { scheduling: { cadence: cad, skip_afternoon: sch.skip_afternoon !== false, vary_hour: sch.vary_hour !== false } } : {}),
      is_manual: false, mode: m === 'auto' ? 'progressive' : m, delay: m === 'auto' ? 0 : (m === 'progressive' ? Math.max(1, Number(f.delay) || 3) : f.delay) }
  }
  async function upload() {
    setUpMsg('')
    const rows = parseCsv(csv)
    if (!rows.length) { setUpMsg('Paste rows with at least a phone column.'); return }
    const { data, error } = await supabase.rpc('pc_campaign_contacts', args({ p_campaign: f.id, p_rows: rows }))
    if (error) { setUpMsg(error.message); return }
    setUpMsg(`Added ${data.added}. ${data.duplicates} already waiting, ${data.dnc} on do-not-call, ${data.invalid} bad numbers.`); setCsv(''); reload()
  }
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <FormBar title={row ? `Edit: ${row.name}` : 'New outbound campaign'} onCancel={onCancel} onSave={() => onSave(payload())} saving={saving} can={can} msg={msg} />
      <Section title="Basics">
        <div style={S.form}>
          <Field label="Campaign name"><input disabled={dis} value={f.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Missed calls — Cheney Salina" style={S.input} /></Field>
          <Field label="Brand">{d.scope.brand ? <input disabled value={d.scope.brand} style={S.input} /> :
            <select disabled={dis} value={f.brand || ''} onChange={e => set('brand', e.target.value)} style={S.input}><option value="">Pick a brand</option>{d.brands.map(b => <option key={b}>{b}</option>)}</select>}</Field>
          <Field label="Location (optional)"><input disabled={dis || !!d.scope.location} value={f.location || ''} onChange={e => set('location', e.target.value)} style={S.input} /></Field>
          <Field label="Type" hint="Sets where it falls in the calling order (Blending)."><select disabled={dis} value={f.kind || 'other'} onChange={e => set('kind', e.target.value)} style={S.input}>
            {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Status"><select disabled={dis} value={f.status} onChange={e => set('status', e.target.value)} style={S.input}>
            <option value="draft">Draft (not calling)</option><option value="active">Live</option><option value="paused">Paused</option><option value="archived">Archived (hide)</option></select></Field>
        </div>
      </Section>
      <Section title="How it dials" hint="Never predictive — one call per CSR at a time.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
          {MODES.map(([k, l, h]) => (
            <label key={k} style={{ ...S.choice, borderColor: f._mode === k ? '#2F7D5B' : '#E1DCD2', background: f._mode === k ? '#E6F0EA' : '#fff' }}>
              <input type="radio" disabled={dis} checked={f._mode === k} onChange={() => set('_mode', k)} /> <b>{l}</b><div style={S.mut}>{h}</div>
            </label>
          ))}
        </div>
        {f._mode === 'progressive' && <Field label="Countdown before each call"><select disabled={dis} value={f.delay} onChange={e => set('delay', Number(e.target.value))} style={{ ...S.input, width: 160 }}>{[2, 3, 5, 8, 10, 15].map(s => <option key={s} value={s}>{s} seconds</option>)}</select></Field>}
      </Section>
      {f._mode !== 'manual' && (
        <Section title="Calling rules" hint="Calls only go out inside these hours in the customer's time zone. Booked, Not interested and Callback stop the cadence; No answer moves to the next dial.">
          <Field label="How redials are timed">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8, marginTop: 4 }}>
              {[['cadence', 'Dial-by-dial plan', 'Set the day, time window and voicemail for every dial'], ['smart', 'Smart timing', 'Picks the hours people answer most'], ['fixed', 'Simple wait times', 'Waits a set number of minutes between tries']].map(([k, l, h]) => (
                <label key={k} style={{ ...S.choice, borderColor: (f.scheduling_mode || 'smart') === k ? '#2F7D5B' : '#E1DCD2', background: (f.scheduling_mode || 'smart') === k ? '#E6F0EA' : '#fff' }}>
                  <input type="radio" disabled={dis} checked={(f.scheduling_mode || 'smart') === k} onChange={() => setF(x => ({ ...x, scheduling_mode: k, scheduling: k === 'cadence' ? { ...(x.scheduling || {}), cadence: cad } : x.scheduling }))} /> <b>{l}</b><div style={S.mut}>{h}</div>
                </label>))}
            </div>
          </Field>
          {f.scheduling_mode === 'cadence' && (
            <div style={{ marginTop: 12 }}>
              <Cadence value={cad} disabled={dis} onChange={v => setSch('cadence', v)} />
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10, fontSize: 13 }}>
                <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><input type="checkbox" disabled={dis} checked={sch.skip_afternoon !== false} onChange={e => setSch('skip_afternoon', e.target.checked)} /> Skip weekday 2–5 pm for redials (Dial 1 always goes out)</label>
                <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><input type="checkbox" disabled={dis} checked={sch.vary_hour !== false} onChange={e => setSch('vary_hour', e.target.checked)} /> Don't redial at the same hour twice in a row</label>
              </div>
            </div>
          )}
          <div style={{ ...S.form, marginTop: 12 }}>
            {f.scheduling_mode !== 'cadence' && <Field label="Tries per contact"><select disabled={dis} value={f.max_attempts} onChange={e => set('max_attempts', Number(e.target.value))} style={S.input}>{[1, 2, 3, 4, 5, 6, 8, 10].map(n => <option key={n} value={n}>{n}</option>)}</select></Field>}
            {f.scheduling_mode === 'fixed' && <Field label="Wait between tries (minutes)" hint="e.g. 60, 240, 1440 = 1 hour, 4 hours, next day">
              <input disabled={dis} value={(f.retry_minutes || []).join(', ')} onChange={e => set('retry_minutes', e.target.value.split(/[,\s]+/).map(Number).filter(n => n > 0))} style={S.input} /></Field>}
            <Field label="Default time zone"><select disabled={dis} value={f.timezone} onChange={e => set('timezone', e.target.value)} style={S.input}>{TZS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
            <Field label="Record calls"><select disabled={dis} value={f.record_calls ? '1' : '0'} onChange={e => set('record_calls', e.target.value === '1')} style={S.input}><option value="1">Yes (for QA)</option><option value="0">No</option></select></Field>
          </div>
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <b style={{ fontSize: 13.5 }}>Dialing hours</b>
            {!dis && <button style={S.link} onClick={() => set('hours', { ...S2L_HOURS })}>Use speed-to-lead hours (weekdays to 7:30 pm · Sat 8 am–2 pm · Sun 10 am–2 pm)</button>}
          </div>
          <div style={{ marginTop: 8 }}><Hours value={f.hours} onChange={v => set('hours', v)} disabled={dis} /></div>
        </Section>
      )}
      <Section title="Call script" hint="What CSRs see on the call screen.">
        <select disabled={dis} value={f.script_id || ''} onChange={e => set('script_id', e.target.value || null)} style={{ ...S.input, maxWidth: 420 }}>
          <option value="">No script</option>{d.scripts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </Section>
      <Section title="CSRs on this campaign"><People people={d.people} allowAll={!d.scope.brand} brand={d.scope.brand || f.brand} location={d.scope.location || f.location} selected={f.agents || []} onChange={v => set('agents', v)} disabled={dis} /></Section>
      <Section title="Dispositions" hint="What CSRs pick at the end of each call. Add, remove, rename or reorder them. The group decides Rob's intent and booking rates.">
        <DispoEditor value={f.dispositions || d.dispositions} standard={d.dispositions} disabled={dis} onChange={v => set('dispositions', v)} />
      </Section>
      {row && f._mode !== 'manual' && (
        <Section title="Contacts to call" hint={`${row.stats?.pending || 0} waiting · ${row.stats?.done || 0} finished`}>
          {can && (<>
            <div style={S.mut}>Paste or upload a CSV with columns <b>name, phone, state, reason</b> (phone is required). Up to 5,000 rows.</div>
            <textarea rows={4} value={csv} onChange={e => setCsv(e.target.value)} placeholder={'name,phone,state,reason\nKerri Smith,785-555-0123,KS,Open quote day 15'} style={{ ...S.input, resize: 'vertical', fontFamily: 'monospace', fontSize: 12.5 }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input type="file" accept=".csv,text/csv" onChange={async e => { const file = e.target.files?.[0]; if (file) setCsv(await file.text()) }} />
              <button style={S.primary} onClick={upload} disabled={!csv.trim()}>Add contacts</button>
              {upMsg && <span style={{ fontSize: 13 }}>{upMsg}</span>}
            </div>
          </>)}
          {row.intake && (
            <div style={{ marginTop: 14, padding: 12, background: '#FAF8F4', borderRadius: 10, border: '1px solid #EEEAE2' }}>
              <div style={{ fontWeight: 700 }}>Send contacts automatically (HubSpot or any system)</div>
              <div style={S.mut}>POST JSON to this address with the header <code>X-Opsis-Key</code>. HubSpot decides when to call by sending <code>call_after</code>.</div>
              <Copy label="Address" value={row.intake.url} /><Copy label="Key" value={row.intake.key} secret />
            </div>
          )}
        </Section>
      )}
    </div>
  )
}
function Copy({ label, value, secret }) {
  const [show, setShow] = useState(!secret)
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
      <span style={{ width: 60, fontSize: 12.5, color: '#5F6763' }}>{label}</span>
      <code style={{ fontSize: 12, background: '#fff', border: '1px solid #E1DCD2', borderRadius: 6, padding: '4px 8px', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{show ? value : '••••••••••••'}</code>
      {secret && <button style={S.link} onClick={() => setShow(s => !s)}>{show ? 'Hide' : 'Show'}</button>}
      <button style={S.link} onClick={() => { try { navigator.clipboard.writeText(value) } catch { /* ignore */ } }}>Copy</button>
    </div>
  )
}
// ---------- Disposition editor (2026-11-10, Becky: 100% customizable) ----------
// Each disposition: label, group (sales / service / none), result (done / try again / call back / do not call),
// booked (sales only) and "talked to the customer". The code is made from the group so reporting keeps working:
// s_booked_* = booked, s_* = wanted service / new door, c_* = existing customer, n_* = not a customer / no answer.
const DGROUPS = [['sales', 'Wanted service or a new door', '#15803d'], ['service', 'Existing customer', '#0e7490'], ['none', 'Not a customer / no answer', '#64748b']]
const OUTCOMES = [['final', 'Done'], ['retry', 'Try again later'], ['callback', 'Call back at a set time'], ['dnc', 'Do not call']]
const KEEP = ['no_answer', 'voicemail', 'busy', 'dnc', 'booked', 's_booked']
function dispoCode(x) {
  if (KEEP.includes(x.code) && (x.code === 's_booked' || x.code === 'booked' ? x.group === 'sales' && x.is_success : x.group === 'none')) return x.code
  const base = slug(x.label) || 'item'
  const pre = x.group === 'sales' ? (x.is_success ? 's_booked_' : 's_') : x.group === 'service' ? 'c_' : 'n_'
  const cur = String(x.code || '')
  if (cur.startsWith(pre) && !(pre === 's_' && cur.startsWith('s_booked'))) return cur
  return pre + base
}
function DispoEditor({ value, standard, onChange, disabled }) {
  const list = Array.isArray(value) ? value : []
  const upd = (i, patch) => {
    const n = list.map((x, j) => {
      if (j !== i) return x
      const y = { ...x, ...patch }
      if (y.group !== 'sales') y.is_success = false
      if (y.outcome === 'dnc') y.is_contact = true
      y.code = dispoCode(y)
      return y
    })
    onChange(n)
  }
  const move = (i, dir) => { const j = i + dir; if (j < 0 || j >= list.length) return; const n = [...list]; [n[i], n[j]] = [n[j], n[i]]; onChange(n) }
  const add = (group) => {
    const label = 'New disposition'
    let x = { label, group, outcome: 'final', is_contact: group !== 'none', is_success: false }
    x.code = dispoCode(x) + '_' + Math.random().toString(36).slice(2, 6)
    onChange([...list, x])
  }
  const dupes = new Set(list.map(x => x.code).filter((c, i, a) => a.indexOf(c) !== i))
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {DGROUPS.map(([g, gl, color]) => {
        const rows = list.map((x, i) => [x, i]).filter(([x]) => (x.group || 'none') === g)
        return (
          <div key={g}>
            <div style={{ ...S.cap, color }}>{gl}</div>
            <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
              {rows.length === 0 && <span style={S.mut}>None</span>}
              {rows.map(([x, i]) => (
                <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', padding: '6px 8px', border: '1px solid #EEEAE2', borderRadius: 10, background: x.is_success ? '#F0FBF4' : '#fff' }}>
                  <input disabled={disabled} value={x.label} onChange={e => upd(i, { label: e.target.value })} style={{ ...S.input, width: 220, marginTop: 0 }} />
                  <select disabled={disabled} value={x.group || 'none'} onChange={e => upd(i, { group: e.target.value })} style={{ ...S.inSm }}>
                    {DGROUPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  <select disabled={disabled} value={x.outcome || 'final'} onChange={e => upd(i, { outcome: e.target.value })} style={{ ...S.inSm }}>
                    {OUTCOMES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  {g === 'sales' && <label style={{ fontSize: 12.5, display: 'inline-flex', gap: 4, alignItems: 'center' }}><input type="checkbox" disabled={disabled} checked={!!x.is_success} onChange={e => upd(i, { is_success: e.target.checked })} /> Counts as booked</label>}
                  <label style={{ fontSize: 12.5, display: 'inline-flex', gap: 4, alignItems: 'center' }} title="Used to stop 'no answer' style results on long calls"><input type="checkbox" disabled={disabled} checked={!!x.is_contact} onChange={e => upd(i, { is_contact: e.target.checked })} /> Talked to the customer</label>
                  {dupes.has(x.code) && <span style={{ fontSize: 12, color: '#b91c1c' }}>Same name as another one</span>}
                  {!disabled && <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4 }}>
                    <button style={S.link} onClick={() => move(i, -1)} title="Move up">↑</button>
                    <button style={S.link} onClick={() => move(i, 1)} title="Move down">↓</button>
                    <button style={{ ...S.link, color: '#b91c1c' }} onClick={() => onChange(list.filter((_, j) => j !== i))}>Remove</button>
                  </span>}
                </div>
              ))}
              {!disabled && <div><button style={S.btn} onClick={() => add(g)}>+ Add to “{gl}”</button></div>}
            </div>
          </div>
        )
      })}
      {!disabled && <div><button style={S.link} onClick={() => { if (window.confirm('Put back the standard GarageCo dispositions? Your changes here will be replaced.')) onChange(standard) }}>Reset to the standard list</button></div>}
    </div>
  )
}

// ---------- Central team (2026-11-10, Becky): approve CSRs to answer for other brands ----------
function CentralTeam({ args, onChange }) {
  const [a, setA] = useState(null)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => { supabase.rpc('pc_approvals_get', args({})).then(({ data, error }) => { if (error) setErr(error.message); else setA(data) }) }, [args])
  async function toggle(id, brand, on) {
    const { data, error } = await supabase.rpc('pc_approval_set', args({ p_profile: id, p_brand: brand, p_on: on }))
    if (error) setErr(error.message); else { setA(data); onChange && onChange() }
  }
  if (!a) return <div style={S.card}>{err || 'Loading…'}</div>
  const rows = a.csrs.filter(c => !q || `${c.name} ${c.brand || ''} ${c.location || ''}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <Section title="Central team" hint="Approve CSRs to answer for brands other than their own. Approved CSRs show up (tagged Central) when you pick who answers a line or works a campaign for that brand.">
      {err && <div style={{ ...S.mut, color: '#b91c1c', marginBottom: 8 }}>{err}</div>}
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search CSRs" style={{ ...S.input, maxWidth: 320, marginBottom: 10 }} />
      <div style={{ display: 'grid', gap: 8 }}>
        {rows.map(c => (
          <div key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '8px 10px', border: '1px solid #EEEAE2', borderRadius: 10 }}>
            <div style={{ width: 230, minWidth: 0 }}><b>{c.name}</b><div style={S.mut}>{[c.brand || 'No home brand', c.location].filter(Boolean).join(' · ')}</div></div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, flex: 1 }}>
              {a.brands.filter(b => b !== c.brand).map(b => {
                const on = (c.approved || []).includes(b)
                return <label key={b} style={{ ...S.chip, background: on ? '#E0E7FF' : '#fff', borderColor: on ? '#6366F1' : '#E1DCD2' }}>
                  <input type="checkbox" checked={on} onChange={() => toggle(c.id, b, !on)} /> {b}</label>
              })}
            </div>
          </div>
        ))}
        {rows.length === 0 && <span style={S.mut}>No CSRs found.</span>}
      </div>
    </Section>
  )
}

// ---------- Blending (2026-11-10, Becky) ----------
// Inbound always comes first. Outbound fills the gaps in this order; outbound pauses while a
// customer is waiting on the location's line. GMs/RMs can set CSRs to inbound only.
function Blending({ d, args }) {
  const [brand, setBrand] = useState(d.scope.brand || d.brands[0] || '')
  const [loc, setLoc] = useState(d.scope.location || '')
  const [b, setB] = useState(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const locs = useMemo(() => [...new Set([...d.lines, ...d.campaigns].filter(x => x.brand === brand && x.location).map(x => x.location))], [d, brand])
  const load = useCallback(async () => {
    if (!brand) return
    const { data, error } = await supabase.rpc('pc_blend_get', args({ p_brand: brand, p_location: loc || null }))
    if (error) setMsg(error.message); else setB(data)
  }, [brand, loc, args])
  useEffect(() => { load() }, [load])
  if (!b) return <div style={S.card}>{msg || 'Loading…'}</div>
  const can = !!b.can_edit
  const order = b.kind_order || []
  const move = (i, dir) => { const n = [...order]; const j = i + dir; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; setB({ ...b, kind_order: n }) }
  async function save() {
    setBusy(true); setMsg('')
    const { data, error } = await supabase.rpc('pc_blend_save', args({ p: { brand, location: loc || null, kind_order: order, guard_waiting: b.guard_waiting, guard_missed_30m: b.guard_missed_30m, wrap_limit_secs: b.wrap_limit_secs } }))
    setBusy(false)
    if (error) setMsg(error.message); else { setB(data); setMsg('Saved.'); setTimeout(() => setMsg(''), 2500) }
  }
  async function inboundOnly(pid, on) {
    const { error } = await supabase.rpc('pc_inbound_only_set', args({ p_profile: pid, p_on: on, p_until: null }))
    if (error) setMsg(error.message); else load()
  }
  const io = new Set((b.inbound_only || []).map(x => x.profile_id))
  const csrs = d.people.filter(p => p.role === 'CSR' && (!brand || p.brand === brand || !p.brand) && (!loc || (p.location || '').toLowerCase() === loc.toLowerCase()))
  const campsOf = k => d.campaigns.filter(c => !c.is_manual && (c.kind || 'other') === k && c.brand === brand && (!loc || !c.location || c.location.toLowerCase() === loc.toLowerCase()))
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ ...S.card, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Field label="Brand">{d.scope.brand ? <input disabled value={brand} style={S.input} /> :
            <select value={brand} onChange={e => { setBrand(e.target.value); setLoc('') }} style={S.input}>{d.brands.map(x => <option key={x}>{x}</option>)}</select>}</Field>
          <Field label="Location">{d.scope.location ? <input disabled value={loc} style={S.input} /> :
            <select value={loc} onChange={e => setLoc(e.target.value)} style={S.input}><option value="">All locations (brand default)</option>{locs.map(x => <option key={x}>{x}</option>)}</select>}</Field>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {msg && <span style={{ fontSize: 13, color: /Saved/.test(msg) ? '#15803d' : '#b91c1c' }}>{msg}</span>}
          {can && <button style={S.primary} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>}
        </div>
      </div>
      {b.inherited && <div style={S.ok}>This location uses the {brand} brand default until you save settings for it.</div>}

      <Section title="1. Inbound always comes first" hint="A customer calling in rings the location's Ready CSRs before any list call goes out.">
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5 }}>
          <input type="checkbox" disabled={!can} checked={!!b.guard_waiting} onChange={e => setB({ ...b, guard_waiting: e.target.checked })} />
          Pause list calls while a customer is waiting on this location's line
        </label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5, marginTop: 10, flexWrap: 'wrap' }}>
          Also pause list calls when
          <select disabled={!can} value={b.guard_missed_30m} onChange={e => setB({ ...b, guard_missed_30m: Number(e.target.value) })} style={{ ...S.inSm }}>
            <option value={0}>— (off)</option>{[1, 2, 3, 5, 8].map(n => <option key={n} value={n}>{n}+</option>)}
          </select>
          calls were missed in the last 30 minutes
        </div>
      </Section>

      <Section title="2. Then list calls, in this order" hint="When nobody is waiting, each Ready CSR gets the next contact from the first type that has someone to call.">
        {order.map((k, i) => {
          const cs = campsOf(k)
          return (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid #EEEAE2', borderRadius: 12, marginBottom: 8, background: i === 0 ? '#FAF8F4' : '#fff' }}>
              <span style={{ width: 26, height: 26, borderRadius: 999, background: '#14302A', color: '#fff', fontWeight: 800, fontSize: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{i + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800 }}>{kindLabel(k)}</div>
                <div style={S.mut}>{cs.length ? cs.map(c => `${c.name}${c.status !== 'active' ? ' (' + (STATUS[c.status] || STATUS.draft)[0].toLowerCase() + ')' : ''}`).join(' · ') : 'No campaign of this type yet'}</div>
              </div>
              {can && <div style={{ display: 'flex', gap: 4 }}>
                <button style={S.btn} disabled={i === 0} onClick={() => move(i, -1)} title="Move up">↑</button>
                <button style={S.btn} disabled={i === order.length - 1} onClick={() => move(i, 1)} title="Move down">↓</button>
              </div>}
            </div>
          )
        })}
      </Section>

      <Section title="3. Wrap-up time" hint="After each call the CSR picks a disposition. Over this time, their timer turns red and the wallboard flags it.">
        <select disabled={!can} value={b.wrap_limit_secs} onChange={e => setB({ ...b, wrap_limit_secs: Number(e.target.value) })} style={{ ...S.input, width: 200 }}>
          {[30, 45, 60, 90, 120, 180, 300].map(n => <option key={n} value={n}>{n < 60 ? `${n} seconds` : `${n / 60} minute${n === 60 ? '' : 's'}`}</option>)}
        </select>
      </Section>

      <Section title="4. Inbound-only CSRs" hint="Keep some phones free for busy times — these CSRs only take incoming calls, no list calls. GMs can change this too.">
        {csrs.length === 0 ? <p style={S.mut}>No CSRs here yet.</p> : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {csrs.map(p => {
              const on = io.has(p.id)
              return (
                <label key={p.id} style={{ ...S.chip, background: on ? '#FFF8E8' : '#fff', borderColor: on ? '#E0B85C' : '#E1DCD2' }}>
                  <input type="checkbox" checked={on} onChange={() => inboundOnly(p.id, !on)} /> {p.name}{on ? ' · inbound only' : ''}
                </label>
              )
            })}
          </div>
        )}
      </Section>
    </div>
  )
}

function parseCsv(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (!lines.length) return []
  const split = l => { const out = []; let cur = '', q = false; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++ } else if (ch === '"') q = false; else cur += ch } else if (ch === '"') q = true; else if (ch === ',' || ch === '\t') { out.push(cur.trim()); cur = '' } else cur += ch } out.push(cur.trim()); return out }
  let head = split(lines[0]).map(h => h.toLowerCase())
  let start = 1
  if (!head.some(h => /phone|number/.test(h))) { head = ['name', 'phone', 'state', 'reason']; start = 0 }
  const idx = k => head.findIndex(h => h.includes(k))
  const ip = head.findIndex(h => /phone|number/.test(h)), iname = idx('name'), ist = idx('state'), ir = idx('reason')
  return lines.slice(start).map(l => { const c = split(l); return { phone: c[ip], name: iname >= 0 ? c[iname] : '', state: ist >= 0 ? c[ist] : '', reason: ir >= 0 ? c[ir] : '' } }).filter(r => r.phone)
}

const S = {
  card: { background: '#fff', border: '1px solid #E8E4DC', borderRadius: 14, padding: 16 },
  h1: { fontSize: 18, fontWeight: 800, color: '#14302A' },
  mut: { fontSize: 12.5, color: '#5F6763', margin: 0 },
  cap: { fontSize: 10.5, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: '#56605B' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 },
  statRow: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginTop: 10 },
  form: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, alignItems: 'start' },
  lbl: { display: 'grid', gap: 4, fontSize: 12.5, fontWeight: 700, color: '#3B4541' },
  input: { width: '100%', boxSizing: 'border-box', marginTop: 2, padding: '9px 11px', border: '1px solid #E1DCD2', borderRadius: 10, fontSize: 13.5, fontFamily: 'inherit', background: '#fff' },
  inSm: { padding: '6px 8px', border: '1px solid #E1DCD2', borderRadius: 8, fontFamily: 'inherit', fontSize: 13 },
  btn: { border: '1px solid #E1DCD2', borderRadius: 10, padding: '8px 14px', fontSize: 13, background: '#fff', cursor: 'pointer', fontWeight: 700, fontFamily: 'inherit' },
  primary: { border: '1px solid #14302A', borderRadius: 10, padding: '9px 16px', fontSize: 13.5, background: '#14302A', color: '#fff', cursor: 'pointer', fontWeight: 700, fontFamily: 'inherit' },
  link: { border: 'none', background: 'none', color: '#2F5E4E', fontWeight: 700, cursor: 'pointer', fontSize: 12.5, fontFamily: 'inherit' },
  pill: { display: 'inline-block', padding: '3px 9px', borderRadius: 999, fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap' },
  chip: { display: 'inline-flex', gap: 6, alignItems: 'center', border: '1px solid #E1DCD2', borderRadius: 999, padding: '5px 11px', fontSize: 12.5, cursor: 'pointer', background: '#fff' },
  choice: { display: 'block', border: '1px solid #E1DCD2', borderRadius: 12, padding: 12, cursor: 'pointer', fontSize: 13.5 },
  seg: { display: 'inline-flex', background: '#fff', border: '1px solid #E1DCD2', borderRadius: 10, padding: 3, gap: 2 },
  segBtn: { border: 'none', background: 'transparent', padding: '7px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit' },
  segOn: { background: '#14302A', color: '#fff' },
  ok: { background: '#E6F0EA', border: '1px solid #CFE3D8', color: '#14302A', borderRadius: 10, padding: '8px 12px', fontSize: 13 },
}
