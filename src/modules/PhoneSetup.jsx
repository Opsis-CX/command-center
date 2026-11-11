// ============================================================
//  PhoneSetup — clients build their own inbound lines and outbound campaigns (2026-11-10, Becky).
//  Portal page "Phone setup". Edit: Opsis staff, client admins (all brands), RMs (their brand).
//  GMs see their location read-only. Phone numbers are connected by Opsis.
//  RPCs: pc_setup_get, pc_line_save, pc_campaign_save, pc_campaign_contacts.
// ============================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

const DAYS = [['1', 'Mon'], ['2', 'Tue'], ['3', 'Wed'], ['4', 'Thu'], ['5', 'Fri'], ['6', 'Sat'], ['0', 'Sun']]
const TZS = [['America/New_York', 'Eastern'], ['America/Chicago', 'Central'], ['America/Denver', 'Mountain'], ['America/Phoenix', 'Arizona'], ['America/Los_Angeles', 'Pacific']]
const MODES = [
  ['manual', 'Manual dialing', 'CSRs type the number themselves (dial pad)'],
  ['preview', 'Preview', 'CSR sees the contact, then clicks Call'],
  ['progressive', 'Progressive', 'Calls automatically after a short countdown'],
  ['auto', 'Auto-dial (speed to lead)', 'Calls the moment a lead arrives — no countdown'],
]
const STATUS = { active: ['Live', '#15803d', '#dcfce7'], paused: ['Paused', '#b45309', '#fef3c7'], draft: ['Draft', '#475569', '#f1f5f9'] }
const fmtPhone = v => { const d = String(v || '').replace(/\D/g, '').slice(-10); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (v || '') }
const modeOf = c => c.is_manual ? 'manual' : c.mode === 'progressive' && Number(c.delay) === 0 ? 'auto' : c.mode

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

  if (edit?.kind === 'line') return <LineForm d={d} row={edit.row} can={can} saving={saving} msg={msg} onCancel={() => { setEdit(null); setMsg('') }} onSave={r => save('line', r)} />
  if (edit?.kind === 'camp') return <CampForm d={d} row={edit.row} can={can} saving={saving} msg={msg} args={args} reload={load} onCancel={() => { setEdit(null); setMsg('') }} onSave={r => save('camp', r)} />

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ ...S.card, display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={S.h1}>Phone setup <span style={{ fontWeight: 600, color: '#5F6763', fontSize: 14 }}>· {scope}</span></div>
          <div style={S.mut}>{can ? 'Build the lines your customers call and the lists your CSRs call out to.' : 'View only. Ask an admin or your RM to make changes.'}</div>
        </div>
        <div style={S.seg}>
          {[['in', `Inbound lines (${d.lines.length})`], ['out', `Outbound campaigns (${d.campaigns.length})`]].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} style={{ ...S.segBtn, ...(tab === k ? S.segOn : {}) }}>{l}</button>
          ))}
        </div>
      </div>
      {msg && <div style={S.ok}>{msg}</div>}

      {tab === 'in' ? (
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
          {d.campaigns.length === 0 && <div style={S.card}><p style={S.mut}>No campaigns yet.</p></div>}
          <div style={S.grid}>
            {d.campaigns.map(c => {
              const st = STATUS[c.status] || STATUS.draft
              const m = MODES.find(x => x[0] === modeOf(c))
              return (
                <div key={c.id} style={S.card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ fontWeight: 800, fontSize: 15 }}>{c.name}</div>
                    <span style={{ ...S.pill, color: st[1], background: st[2] }}>{st[0]}</span>
                  </div>
                  <div style={S.mut}>{[c.brand, c.location].filter(Boolean).join(' · ')} · {m ? m[1] : c.mode}</div>
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
function People({ people, selected, onChange, disabled, filter }) {
  const list = people.filter(p => !filter || filter(p))
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
                    {p.name}{p.location ? <span style={{ color: '#8a918d' }}> · {p.location}</span> : ''}
                  </label>
                )
              })}
            </div>
          </div>
        )
      })}
      {list.length === 0 && <span style={S.mut}>No people in your view yet.</span>}
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
function LineForm({ d, row, can, saving, msg, onCancel, onSave }) {
  const [f, setF] = useState(() => row ? JSON.parse(JSON.stringify(row)) : {
    name: '', brand: d.scope.brand || '', location: d.scope.location || '', active: true, timezone: 'America/Chicago', ring_seconds: 25, record_calls: true, ai_enabled: true,
    greeting: '', menu: [], members: [], hours: { 1: ['08:00', '17:00'], 2: ['08:00', '17:00'], 3: ['08:00', '17:00'], 4: ['08:00', '17:00'], 5: ['08:00', '17:00'] }, callback_campaign_id: null,
  })
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const queues = useMemo(() => ['main', ...new Set((f.menu || []).map(m => m.queue).filter(Boolean))], [f.menu])
  const membersOf = q => (f.members || []).filter(m => (m.queue || 'main') === q).map(m => m.profile_id)
  const setMembers = (q, ids) => set('members', [...(f.members || []).filter(m => (m.queue || 'main') !== q), ...ids.map(id => ({ profile_id: id, queue: q }))])
  const dis = !can
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
            {!dis && <button style={S.link} onClick={() => set('menu', f.menu.filter((_, j) => j !== i).map((x, j) => ({ ...x, key: String(j + 1) })))}>Remove</button>}
          </div>
        ))}
        {!dis && (f.menu || []).length < 9 && <button style={S.btn} onClick={() => set('menu', [...(f.menu || []), { key: String((f.menu || []).length + 1), label: '', queue: '', words: [] }])}>+ Add option</button>}
      </Section>
      <Section title="Who answers" hint="These people ring when they're logged in and Ready.">
        {queues.map(q => (
          <div key={q} style={{ marginBottom: 12 }}>
            {queues.length > 1 && <div style={{ fontWeight: 700, marginBottom: 6 }}>{q === 'main' ? 'Everyone else / no option picked' : (f.menu.find(m => m.queue === q)?.label || q)}</div>}
            <People people={d.people} selected={membersOf(q)} onChange={ids => setMembers(q, ids)} disabled={dis} />
          </div>
        ))}
      </Section>
      <Section title="Hours" hint="When CSRs answer. Outside these hours the after-hours option below takes over.">
        <Hours value={f.hours} onChange={v => set('hours', v)} disabled={dis} />
      </Section>
      <Section title="When nobody answers">
        <div style={S.form}>
          <Field label="Ring CSRs for"><select disabled={dis} value={f.ring_seconds} onChange={e => set('ring_seconds', Number(e.target.value))} style={S.input}>{[15, 20, 25, 30, 45, 60].map(s => <option key={s} value={s}>{s} seconds</option>)}</select></Field>
          <Field label="Then"><select disabled={dis} value={f.ai_enabled ? 'ai' : 'vm'} onChange={e => set('ai_enabled', e.target.value === 'ai')} style={S.input}><option value="ai">The AI CSR answers</option><option value="vm">Voicemail</option></select></Field>
          <Field label="Missed calls go to" hint="Missed and hung-up callers are added to this campaign so a CSR calls them back.">
            <select disabled={dis} value={f.callback_campaign_id || ''} onChange={e => set('callback_campaign_id', e.target.value || null)} style={S.input}>
              <option value="">Don't call them back automatically</option>{d.campaigns.filter(c => !c.is_manual).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></Field>
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
    name: '', brand: d.scope.brand || '', location: d.scope.location || '', status: 'draft', _mode: 'preview', delay: 3, timezone: 'America/Chicago', max_attempts: 4,
    retry_minutes: [60, 240, 1440], record_calls: true, script_id: null, agents: [],
    hours: { 1: ['09:00', '19:00'], 2: ['09:00', '19:00'], 3: ['09:00', '19:00'], 4: ['09:00', '19:00'], 5: ['09:00', '19:00'], 6: ['10:00', '16:00'] },
  })
  const [csv, setCsv] = useState('')
  const [upMsg, setUpMsg] = useState('')
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const dis = !can
  function payload() {
    const m = f._mode
    return { id: f.id, name: f.name, brand: f.brand, location: f.location, status: f.status, timezone: f.timezone, hours: f.hours, max_attempts: f.max_attempts,
      retry_minutes: f.retry_minutes, record_calls: f.record_calls, script_id: f.script_id, agents: f.agents,
      is_manual: m === 'manual', mode: m === 'manual' ? 'preview' : m === 'auto' ? 'progressive' : m, delay: m === 'auto' ? 0 : (m === 'progressive' ? Math.max(1, Number(f.delay) || 3) : f.delay) }
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
        <Section title="Calling rules" hint="Calls only go out inside these hours in the customer's time zone.">
          <div style={S.form}>
            <Field label="Tries per contact"><select disabled={dis} value={f.max_attempts} onChange={e => set('max_attempts', Number(e.target.value))} style={S.input}>{[1, 2, 3, 4, 5, 6, 8, 10].map(n => <option key={n} value={n}>{n}</option>)}</select></Field>
            <Field label="Wait between tries (minutes)" hint="e.g. 60, 240, 1440 = 1 hour, 4 hours, next day">
              <input disabled={dis} value={(f.retry_minutes || []).join(', ')} onChange={e => set('retry_minutes', e.target.value.split(/[,\s]+/).map(Number).filter(n => n > 0))} style={S.input} /></Field>
            <Field label="Default time zone"><select disabled={dis} value={f.timezone} onChange={e => set('timezone', e.target.value)} style={S.input}>{TZS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
            <Field label="Record calls"><select disabled={dis} value={f.record_calls ? '1' : '0'} onChange={e => set('record_calls', e.target.value === '1')} style={S.input}><option value="1">Yes (for QA)</option><option value="0">No</option></select></Field>
          </div>
          <div style={{ marginTop: 12 }}><Hours value={f.hours} onChange={v => set('hours', v)} disabled={dis} /></div>
        </Section>
      )}
      <Section title="Call script" hint="What CSRs see on the call screen.">
        <select disabled={dis} value={f.script_id || ''} onChange={e => set('script_id', e.target.value || null)} style={{ ...S.input, maxWidth: 420 }}>
          <option value="">No script</option>{d.scripts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </Section>
      <Section title="CSRs on this campaign"><People people={d.people} selected={f.agents || []} onChange={v => set('agents', v)} disabled={dis} /></Section>
      <Section title="Dispositions" hint="What CSRs pick at the end of each call. Grouped so intent and booking rates calculate automatically.">
        {['sales', 'service', 'none'].map(g => (
          <div key={g} style={{ marginBottom: 6 }}>
            <span style={S.cap}>{g === 'sales' ? 'Wanted service or a new door' : g === 'service' ? 'Existing customer' : 'Not a customer / no answer'}</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>{(f.dispositions || d.dispositions).filter(x => (x.group || 'none') === g).map(x => <span key={x.code} style={S.chip}>{x.label}</span>)}</div>
          </div>
        ))}
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
