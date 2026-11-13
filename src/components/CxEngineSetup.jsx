// ============================================================
//  CxEngineSetup — Phone setup → "Advanced engine" tab (2026-11-13).
//  Switch a line or campaign to the conference engine and set how it behaves:
//  live transcript + agent assist, card-number recording pause, hold queue (position,
//  "keep my place" callback, max wait → AI CSR / voicemail), overflow to other
//  locations, sticky CSR, skills, survey, service-level target, transfer numbers,
//  local-presence caller IDs, consent + state calling rules.
// ============================================================
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const G = '#14302A'
const LINE_DEFAULTS = { transcribe: false, pci_auto: true, announce_position: true, callback_offer: true, callback_offer_after_secs: 45, max_wait_secs: 300, overflow: false, overflow_after_secs: 60, sticky: true, sticky_secs: 20, ring_seconds: 20, missed_not_ready: true, whisper: true, survey: false, sla_secs: 20, alert_wait_secs: 90, ai_number: '', hold_music_url: '', transfer_numbers: [] }
const CAMP_DEFAULTS = { transcribe: false, pci_auto: true, local_presence: false, require_consent: false, transfer_numbers: [] }

export default function CxEngineSetup({ args, people = [], can }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [open, setOpen] = useState(null)   // {kind, id}
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('cx_setup_get', args({}))
    if (error) setErr(error.message); else { setD(data); setErr('') }
  }, [args])
  useEffect(() => { load() }, [load])
  const flash = t => { setMsg(t); setTimeout(() => setMsg(''), 3000) }

  if (err && !d) return <div style={S.card}><b>Couldn’t load the Advanced engine settings.</b><p style={S.mut}>{err}</p></div>
  if (!d) return <div style={S.card}>Loading…</div>

  async function saveLine(l, engine, cx) {
    const { error } = await supabase.rpc('cx_line_cx_save', args({ p_line: l.id, p_engine: engine, p_cx: cx }))
    if (error) { setErr(error.message); return } setErr(''); flash('Saved.'); load()
  }
  async function saveCamp(c, engine, cx) {
    const { error } = await supabase.rpc('cx_campaign_cx_save', args({ p_campaign: c.id, p_engine: engine, p_cx: cx }))
    if (error) { setErr(error.message); return } setErr(''); flash('Saved.'); load()
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={S.card}>
        <div style={S.h2}>Advanced engine</div>
        <div style={S.mut}>Lines and campaigns on the Advanced engine get hold, warm/cold transfer, conference, supervisor listen/whisper/barge, a real hold queue, live transcript with agent assist, and AI wrap-up. Lines left on Standard work exactly as before. Live transcript adds a small per-minute charge, so it is off until you turn it on.</div>
        {msg && <div style={{ ...S.ok, marginTop: 8 }}>{msg}</div>}
        {err && <div style={{ color: '#b91c1c', fontSize: 13, marginTop: 8 }}>{err}</div>}
      </div>

      <div style={S.card}>
        <div style={S.h3}>Inbound lines</div>
        {d.lines.length === 0 && <div style={S.mut}>No lines.</div>}
        {d.lines.map(l => (
          <EngineRow key={l.id} title={l.name} sub={[l.brand, l.location, l.number ? 'number connected' : 'no number yet'].filter(Boolean).join(' · ')}
            engine={l.engine} open={open?.id === l.id} onToggle={() => setOpen(o => (o?.id === l.id ? null : { kind: 'line', id: l.id }))}>
            <LineForm l={l} can={can} onSave={(engine, cx) => saveLine(l, engine, cx)} />
          </EngineRow>
        ))}
      </div>

      <div style={S.card}>
        <div style={S.h3}>Outbound campaigns</div>
        {d.campaigns.length === 0 && <div style={S.mut}>No campaigns.</div>}
        {d.campaigns.map(c => (
          <EngineRow key={c.id} title={c.name} sub={[c.brand, c.location, c.kind].filter(Boolean).join(' · ')}
            engine={c.engine} open={open?.id === c.id} onToggle={() => setOpen(o => (o?.id === c.id ? null : { kind: 'camp', id: c.id }))}>
            <CampForm c={c} can={can} onSave={(engine, cx) => saveCamp(c, engine, cx)} />
          </EngineRow>
        ))}
      </div>

      <Skills d={d} people={people} args={args} can={can} reload={load} onErr={setErr} />
      <CallerIds d={d} args={args} can={can} reload={load} onErr={setErr} flash={flash} />

      <div style={S.card}>
        <div style={S.h3}>State calling rules (outbound, Advanced engine)</div>
        <div style={S.mut}>Calls are blocked outside these local hours, on Sundays where marked, and past the daily limit per number. Have your lawyer confirm these before go-live; the Opsis CX Support team can change them.</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 8 }}>
          <thead><tr>{['State', 'Hours', 'Sundays', 'Max calls / 24h', 'Rule'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>{(d.state_rules || []).map(r => (
            <tr key={r.state}><td style={S.td}><b>{r.state}</b></td><td style={S.td}>{String(r.start_local).slice(0, 5)}–{String(r.end_local).slice(0, 5)}</td><td style={S.td}>{r.sunday_ok ? 'OK' : 'No calls'}</td><td style={S.td}>{r.max_per_24h || '—'}</td><td style={{ ...S.td, color: '#64748b' }}>{r.note}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  )
}

function EngineRow({ title, sub, engine, open, onToggle, children }) {
  return (
    <div style={{ borderTop: '1px solid #eef2f7', padding: '10px 0' }}>
      <button onClick={onToggle} style={S.rowBtn}>
        <span><b>{title}</b><div style={S.mut}>{sub}</div></span>
        <span style={{ ...S.pill, background: engine === 'conf' ? '#dcfce7' : '#f1f5f9', color: engine === 'conf' ? '#15803d' : '#475569' }}>{engine === 'conf' ? 'Advanced' : 'Standard'} {open ? '▴' : '▾'}</span>
      </button>
      {open && <div style={{ marginTop: 10 }}>{children}</div>}
    </div>
  )
}

function Toggle({ label, hint, v, on, disabled }) {
  return (
    <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, padding: '4px 0', opacity: disabled ? 0.6 : 1 }}>
      <input type="checkbox" checked={!!v} disabled={disabled} onChange={e => on(e.target.checked)} style={{ marginTop: 3 }} />
      <span><b style={{ fontWeight: 600 }}>{label}</b>{hint ? <div style={S.mut}>{hint}</div> : null}</span>
    </label>
  )
}
function Num({ label, v, on, suffix = 'sec', disabled }) {
  return (
    <label style={{ fontSize: 13, display: 'grid', gap: 3 }}>{label}
      <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="number" value={v ?? ''} disabled={disabled} onChange={e => on(e.target.value === '' ? '' : Number(e.target.value))} style={{ ...S.input, width: 100 }} /><span style={S.mut}>{suffix}</span></span>
    </label>
  )
}

function TransferNumbers({ list, set, disabled }) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600 }}>Transfer numbers</div>
      <div style={S.mut}>Outside numbers CSRs may transfer to (office, manager on call, warranty desk…).</div>
      {(list || []).map((x, n) => (
        <div key={n} style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <input value={x.label} disabled={disabled} placeholder="Label" onChange={e => set(list.map((y, k) => (k === n ? { ...y, label: e.target.value } : y)))} style={{ ...S.input, flex: 1 }} />
          <input value={x.number} disabled={disabled} placeholder="(555) 555-5555" onChange={e => set(list.map((y, k) => (k === n ? { ...y, number: e.target.value } : y)))} style={{ ...S.input, width: 150 }} />
          <button disabled={disabled} style={S.small} onClick={() => set(list.filter((_, k) => k !== n))}>Remove</button>
        </div>
      ))}
      <button disabled={disabled} style={{ ...S.small, marginTop: 6 }} onClick={() => set([...(list || []), { label: '', number: '' }])}>+ Add number</button>
    </div>
  )
}

function LineForm({ l, can, onSave }) {
  const [engine, setEngine] = useState(l.engine)
  const [cx, setCx] = useState({ ...LINE_DEFAULTS, ...(l.cx || {}) })
  const set = (k, v) => setCx(c => ({ ...c, [k]: v }))
  const off = !can
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={S.seg}>
        {[['classic', 'Standard'], ['conf', 'Advanced engine']].map(([k, t]) => <button key={k} disabled={off} onClick={() => setEngine(k)} style={{ ...S.segBtn, ...(engine === k ? S.segOn : {}) }}>{t}</button>)}
      </div>
      {engine === 'conf' && !l.number && <div style={S.warn}>This line has no phone number yet. The Opsis CX Support team connects numbers; the engine switches the number over automatically once it’s connected.</div>}
      {engine === 'conf' && (
        <div style={S.cols}>
          <div>
            <div style={S.cap}>AI on every call</div>
            <Toggle label="Live transcript + agent assist" hint="CSRs see the conversation as text and real-time suggestions; AI writes the wrap-up." v={cx.transcribe} on={v => set('transcribe', v)} disabled={off} />
            <Toggle label="Pause recording for card numbers" hint="When a card number or CVV is heard, the recording pauses (PCI). CSRs can also pause by hand." v={cx.pci_auto} on={v => set('pci_auto', v)} disabled={off} />
            <Toggle label="Post-call survey (1–5)" hint="After the CSR hangs up, the caller is asked to rate the call." v={cx.survey} on={v => set('survey', v)} disabled={off} />
            <Toggle label="Whisper the call type to the CSR" hint="CSR hears “Sales call from Jane” before the caller is connected." v={cx.whisper} on={v => set('whisper', v)} disabled={off} />
          </div>
          <div>
            <div style={S.cap}>Hold queue</div>
            <Toggle label="Tell callers their place in line and wait time" v={cx.announce_position} on={v => set('announce_position', v)} disabled={off} />
            <Toggle label="Offer “press 1 to keep your place and get a call back”" hint="Needs a missed-calls campaign on the line." v={cx.callback_offer} on={v => set('callback_offer', v)} disabled={off} />
            <div style={S.two}>
              <Num label="Offer call back after" v={cx.callback_offer_after_secs} on={v => set('callback_offer_after_secs', v)} disabled={off} />
              <Num label="Longest wait before AI / voicemail" v={cx.max_wait_secs} on={v => set('max_wait_secs', v)} disabled={off} />
            </div>
            <label style={{ fontSize: 13, display: 'grid', gap: 3, marginTop: 6 }}>AI CSR number (when nobody answers or after hours)
              <input value={cx.ai_number || ''} disabled={off} onChange={e => set('ai_number', e.target.value)} placeholder="Leave blank for voicemail" style={S.input} /></label>
            <label style={{ fontSize: 13, display: 'grid', gap: 3, marginTop: 6 }}>Hold music (link to an MP3, optional)
              <input value={cx.hold_music_url || ''} disabled={off} onChange={e => set('hold_music_url', e.target.value)} placeholder="Default classical" style={S.input} /></label>
          </div>
          <div>
            <div style={S.cap}>Routing</div>
            <Toggle label="Returning callers go to the CSR they talked to last" v={cx.sticky} on={v => set('sticky', v)} disabled={off} />
            <Toggle label="Overflow to this brand’s other locations" hint="If nobody here is free, CSRs at the brand’s other Advanced-engine locations can take it." v={cx.overflow} on={v => set('overflow', v)} disabled={off} />
            <Toggle label="Missed ring sets the CSR to Not ready" v={cx.missed_not_ready} on={v => set('missed_not_ready', v)} disabled={off} />
            <div style={S.two}>
              <Num label="Wait for last CSR" v={cx.sticky_secs} on={v => set('sticky_secs', v)} disabled={off} />
              <Num label="Overflow after" v={cx.overflow_after_secs} on={v => set('overflow_after_secs', v)} disabled={off} />
              <Num label="Ring each CSR for" v={cx.ring_seconds} on={v => set('ring_seconds', v)} disabled={off} />
              <Num label="Service-level target" v={cx.sla_secs} on={v => set('sla_secs', v)} disabled={off} />
              <Num label="Alert supervisors after a wait of" v={cx.alert_wait_secs} on={v => set('alert_wait_secs', v)} disabled={off} />
            </div>
            <div style={S.mut}>Skills: add a “skill” to a phone-menu option (for example Spanish) and only CSRs with that skill get those calls.</div>
          </div>
          <div><TransferNumbers list={cx.transfer_numbers} set={v => set('transfer_numbers', v)} disabled={off} /></div>
        </div>
      )}
      {can && <div><button style={S.primary} onClick={() => onSave(engine, { ...cx, transfer_numbers: (cx.transfer_numbers || []).filter(x => String(x.number || '').replace(/\D/g, '').length >= 10) })}>Save</button></div>}
    </div>
  )
}

function CampForm({ c, can, onSave }) {
  const [engine, setEngine] = useState(c.engine)
  const [cx, setCx] = useState({ ...CAMP_DEFAULTS, ...(c.cx || {}) })
  const set = (k, v) => setCx(x => ({ ...x, [k]: v }))
  const off = !can
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={S.seg}>
        {[['classic', 'Standard'], ['conf', 'Advanced engine']].map(([k, t]) => <button key={k} disabled={off} onClick={() => setEngine(k)} style={{ ...S.segBtn, ...(engine === k ? S.segOn : {}) }}>{t}</button>)}
      </div>
      {engine === 'conf' && (
        <div style={S.cols}>
          <div>
            <Toggle label="Live transcript + agent assist" v={cx.transcribe} on={v => set('transcribe', v)} disabled={off} />
            <Toggle label="Pause recording for card numbers" v={cx.pci_auto} on={v => set('pci_auto', v)} disabled={off} />
            <Toggle label="Local caller ID" hint="Calls show a number from the customer’s area code when we have one (Caller IDs below)." v={cx.local_presence} on={v => set('local_presence', v)} disabled={off} />
            <Toggle label="Require consent on file" hint="Leads without a consent date are not dialed (missed-call and callback campaigns are exempt)." v={cx.require_consent} on={v => set('require_consent', v)} disabled={off} />
          </div>
          <div><TransferNumbers list={cx.transfer_numbers} set={v => set('transfer_numbers', v)} disabled={off} /></div>
        </div>
      )}
      {can && <div><button style={S.primary} onClick={() => onSave(engine, { ...cx, transfer_numbers: (cx.transfer_numbers || []).filter(x => String(x.number || '').replace(/\D/g, '').length >= 10) })}>Save</button></div>}
    </div>
  )
}

function Skills({ d, people, args, can, reload, onErr }) {
  const [p, setP] = useState('')
  const [skill, setSkill] = useState('')
  const [lvl, setLvl] = useState(3)
  async function add(profile, sk, level) {
    const { error } = await supabase.rpc('cx_skill_set', args({ p_profile: profile, p_skill: sk, p_level: level }))
    if (error) onErr(error.message); else reload()
  }
  const csrs = (people || []).filter(x => x.id)
  return (
    <div style={S.card}>
      <div style={S.h3}>CSR skills</div>
      <div style={S.mut}>Calls that need a skill (set on the phone-menu option) only go to CSRs who have it. Higher level = offered first.</div>
      {(d.skills || []).length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {d.skills.map(s => (
            <span key={s.profile_id + s.skill} style={S.chip}>{s.name} · {s.skill} {'★'.repeat(s.level)}{can && <button onClick={() => add(s.profile_id, s.skill, 0)} style={S.x}>×</button>}</span>
          ))}
        </div>
      )}
      {can && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          <select value={p} onChange={e => setP(e.target.value)} style={S.input}><option value="">Pick a CSR…</option>{csrs.map(x => <option key={x.id} value={x.id}>{x.full_name || x.name}</option>)}</select>
          <input value={skill} onChange={e => setSkill(e.target.value)} placeholder="Skill (e.g. spanish, commercial)" style={S.input} />
          <select value={lvl} onChange={e => setLvl(Number(e.target.value))} style={S.input}>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>Level {n}</option>)}</select>
          <button disabled={!p || !skill.trim()} style={S.primary} onClick={() => { add(p, skill.trim(), lvl); setSkill('') }}>Add</button>
        </div>
      )}
    </div>
  )
}

function CallerIds({ d, args, can, reload, onErr, flash }) {
  const [area, setArea] = useState('')
  const [purpose, setPurpose] = useState('Local caller ID')
  const [num, setNum] = useState('')
  const [brand, setBrand] = useState('')
  async function request() {
    const { error } = await supabase.rpc('cx_number_request', args({ p_brand: null, p_location: null, p_area_code: area, p_purpose: purpose }))
    if (error) onErr(error.message); else { flash('Request sent to the Opsis CX Support team.'); setArea(''); reload() }
  }
  async function add() {
    const { error } = await supabase.rpc('cx_caller_id_save', args({ p_number: num, p_brand: brand || null, p_location: null, p_active: true }))
    if (error) onErr(error.message); else { setNum(''); reload() }
  }
  return (
    <div style={S.card}>
      <div style={S.h3}>Caller IDs & phone numbers</div>
      <div style={S.mut}>Numbers used for local caller ID on outbound calls. Keep them registered (STIR/SHAKEN, CNAM) so calls don’t show as spam.</div>
      <div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
        {(d.caller_ids || []).map(n => (
          <div key={n.id} style={{ fontSize: 13 }}>{n.number} · {[n.brand, n.location, `area ${n.area_code}`].filter(Boolean).join(' · ')}{n.spam_flag ? <b style={{ color: '#b91c1c' }}> · flagged {n.spam_flag}</b> : ''}{!n.active ? ' · off' : ''}</div>
        ))}
        {(d.caller_ids || []).length === 0 && <div style={S.mut}>No caller IDs yet.</div>}
      </div>
      {d.is_staff && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          <input value={num} onChange={e => setNum(e.target.value)} placeholder="Twilio number" style={S.input} />
          <input value={brand} onChange={e => setBrand(e.target.value)} placeholder="Brand" style={S.input} />
          <button disabled={num.replace(/\D/g, '').length < 10} style={S.primary} onClick={add}>Add caller ID</button>
        </div>
      )}
      {can && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Request a number:</span>
          <input value={area} onChange={e => setArea(e.target.value)} placeholder="Area code" style={{ ...S.input, width: 100 }} />
          <select value={purpose} onChange={e => setPurpose(e.target.value)} style={S.input}>{['Local caller ID', 'New tracking number', 'New location line', 'AI CSR line'].map(x => <option key={x}>{x}</option>)}</select>
          <button disabled={area.replace(/\D/g, '').length !== 3} style={S.primary} onClick={request}>Send request</button>
        </div>
      )}
      {(d.number_requests || []).length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={S.cap}>Requests</div>
          {d.number_requests.slice(0, 10).map(r => <div key={r.id} style={{ fontSize: 12.5 }}>{new Date(r.created_at).toLocaleDateString()} · {r.purpose} · area {r.area_code} · <b>{r.status}</b></div>)}
        </div>
      )}
    </div>
  )
}

const S = {
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 14 },
  h2: { fontSize: 17, fontWeight: 800, color: G, marginBottom: 4 },
  h3: { fontSize: 15, fontWeight: 800, color: G, marginBottom: 4 },
  mut: { fontSize: 12.5, color: '#64748b' },
  ok: { padding: '6px 10px', borderRadius: 8, background: '#dcfce7', color: '#166534', fontSize: 13 },
  warn: { padding: '8px 10px', borderRadius: 8, background: '#fef3c7', color: '#92400e', fontSize: 13 },
  cap: { fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: '#64748b', margin: '4px 0' },
  cols: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 },
  two: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 },
  rowBtn: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: 10, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0, color: '#0f172a' },
  pill: { fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 999, whiteSpace: 'nowrap' },
  seg: { display: 'inline-flex', gap: 4, background: '#f1f5f9', padding: 3, borderRadius: 10 },
  segBtn: { padding: '6px 12px', fontSize: 13, fontWeight: 700, border: 'none', borderRadius: 8, background: 'transparent', cursor: 'pointer', color: '#475569' },
  segOn: { background: '#fff', color: G, boxShadow: '0 1px 3px rgba(0,0,0,0.12)' },
  input: { padding: '7px 9px', fontSize: 13, borderRadius: 8, border: '1px solid #cbd5e1', boxSizing: 'border-box' },
  primary: { padding: '8px 16px', fontSize: 13, fontWeight: 700, borderRadius: 10, border: 'none', background: G, color: '#fff', cursor: 'pointer' },
  small: { padding: '5px 10px', fontSize: 12, fontWeight: 700, borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' },
  chip: { fontSize: 12, fontWeight: 600, padding: '4px 8px', borderRadius: 999, background: '#f1f5f9', display: 'inline-flex', alignItems: 'center', gap: 4 },
  x: { border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 14, color: '#64748b' },
  th: { textAlign: 'left', fontSize: 11, textTransform: 'uppercase', color: '#64748b', padding: '6px', borderBottom: '1px solid #e2e8f0' },
  td: { padding: '6px', borderBottom: '1px solid #f1f5f9' },
}
