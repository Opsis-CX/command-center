// ============================================================
//  CxEngineSetup — Phone setup → "Advanced engine" tab (2026-11-13).
//  Switch a line or campaign to the conference engine and set how it behaves:
//  live transcript + agent assist, card-number recording pause, hold queue (position,
//  "keep my place" callback, max wait → AI CSR / voicemail), overflow to other
//  locations, sticky CSR, skills, survey, service-level target, transfer numbers,
//  local-presence caller IDs, consent + state calling rules.
//  2026-11-14: hold options at 60s (digital assistant / keep my place), spam + robocall
//  protection and blocked numbers, storm / emergency closure switch, outbound
//  answering-machine detection + voicemail drop.
// ============================================================
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const G = '#14302A'
const GT = 'light-dark(#14302A, #9fd6bd)'  // brand green for text/lines: lighter in dark mode
const LINE_DEFAULTS = { transcribe: false, pci_auto: true, announce_position: true, callback_offer: true, hold_offer_ai: true, hold_options_after_secs: 60, block_spam: true, robo_gate: false, nl_greeting: false, survey_sms: false, auto_qa: true, max_wait_secs: 300, overflow: false, overflow_after_secs: 60, sticky: true, sticky_secs: 20, ring_seconds: 20, missed_not_ready: true, whisper: true, survey: false, sla_secs: 20, alert_wait_secs: 90, ai_number: '', hold_music_url: '', transfer_numbers: [] }
const CAMP_DEFAULTS = { transcribe: false, pci_auto: true, local_presence: false, require_consent: false, amd: false, vm_drop: false, auto_qa: true, vm_drop_text: '', vm_drop_audio: '', transfer_numbers: [] }

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
        {err && <div style={{ color: 'light-dark(#b91c1c, #e86464)', fontSize: 13, marginTop: 8 }}>{err}</div>}
      </div>

      <EmergencySwitch args={args} can={can} flash={flash} onErr={setErr} />

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
      {can && <BlockedNumbers args={args} flash={flash} onErr={setErr} />}

      <div style={S.card}>
        <div style={S.h3}>State calling rules (outbound, Advanced engine)</div>
        <div style={S.mut}>Calls are blocked outside these local hours, on Sundays where marked, and past the daily limit per number. Have your lawyer confirm these before go-live; the Opsis CX Support team can change them.</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 8 }}>
          <thead><tr>{['State', 'Hours', 'Sundays', 'Max calls / 24h', 'Rule'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>{(d.state_rules || []).map(r => (
            <tr key={r.state}><td style={S.td}><b>{r.state}</b></td><td style={S.td}>{String(r.start_local).slice(0, 5)}–{String(r.end_local).slice(0, 5)}</td><td style={S.td}>{r.sunday_ok ? 'OK' : 'No calls'}</td><td style={S.td}>{r.max_per_24h || '—'}</td><td style={{ ...S.td, color: 'light-dark(#64748b, #9fb4bb)' }}>{r.note}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  )
}

function EngineRow({ title, sub, engine, open, onToggle, children }) {
  return (
    <div style={{ borderTop: '1px solid light-dark(#eef2f7, #2a3439)', padding: '10px 0' }}>
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
            <Toggle label="Score every call in CallQA" hint="Answered calls go straight to CallQA with the live transcript — same scorecard as your other calls." v={cx.auto_qa} on={v => set('auto_qa', v)} disabled={off || !cx.transcribe} />
            <Toggle label="Understand what callers say (AI greeting)" hint="“In a few words, tell me what you’re calling about.” AI picks the menu option and tells the CSR why they’re calling (“Broken spring, urgent”). Keys still work." v={cx.nl_greeting} on={v => set('nl_greeting', v)} disabled={off} />
            <Toggle label="Text a survey link after the call" hint="Sends a 1–5 rating link by text a few minutes after the call (once a week per caller). Needs texting approval (10DLC) on the line’s number." v={cx.survey_sms} on={v => set('survey_sms', v)} disabled={off} />
          </div>
          <div>
            <div style={S.cap}>Hold queue</div>
            <Toggle label="Tell callers their place in line and wait time" v={cx.announce_position} on={v => set('announce_position', v)} disabled={off} />
            <Toggle label="Offer the digital assistant while on hold" hint="“To schedule service or a new installation now with our digital assistant, press 1.” Needs the AI CSR number below." v={cx.hold_offer_ai} on={v => set('hold_offer_ai', v)} disabled={off} />
            <Toggle label="Offer “keep your place and get a call back”" hint="Needs a missed-calls campaign on the line." v={cx.callback_offer} on={v => set('callback_offer', v)} disabled={off} />
            <div style={S.two}>
              <Num label="Offer hold options after" v={cx.hold_options_after_secs} on={v => set('hold_options_after_secs', v)} disabled={off} />
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
          <div>
            <div style={S.cap}>Spam protection</div>
            <Toggle label="Block spam and robocalls" hint="Blocked numbers are rejected, a number that calls 5 times in 10 minutes is blocked for a day, and callers whose caller ID fails carrier checks must press 1." v={cx.block_spam} on={v => set('block_spam', v)} disabled={off} />
            <Toggle label="Ask new callers to press 1" hint="Stops most robocalls. Callers we’ve spoken with in the last year skip it." v={cx.robo_gate} on={v => set('robo_gate', v)} disabled={off} />
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
            <Toggle label="Score every call in CallQA" v={cx.auto_qa} on={v => set('auto_qa', v)} disabled={off || !cx.transcribe} />
            <Toggle label="Local caller ID" hint="Calls show a number from the customer’s area code when we have one (Caller IDs below)." v={cx.local_presence} on={v => set('local_presence', v)} disabled={off} />
            <Toggle label="Require consent on file" hint="Leads without a consent date are not dialed (missed-call and callback campaigns are exempt)." v={cx.require_consent} on={v => set('require_consent', v)} disabled={off} />
          </div>
          <div>
            <div style={S.cap}>Answering machines</div>
            <Toggle label="Detect answering machines" hint="The CSR sees “Voicemail” as soon as the system knows. Adds a few cents per call." v={cx.amd} on={v => set('amd', v)} disabled={off} />
            <Toggle label="Leave a voicemail automatically" hint="When a machine answers, the message below plays after the beep and the CSR moves on. CSRs can also drop it with one click." v={cx.vm_drop} on={v => set('vm_drop', v)} disabled={off || !cx.amd} />
            <label style={{ fontSize: 13, display: 'grid', gap: 3, marginTop: 6 }}>Voicemail message (read aloud)
              <textarea value={cx.vm_drop_text || ''} disabled={off} rows={3} onChange={e => set('vm_drop_text', e.target.value)} placeholder="Hi, this is Cheney Door returning your call. Please call us back at …" style={{ ...S.input, resize: 'vertical' }} /></label>
            <label style={{ fontSize: 13, display: 'grid', gap: 3, marginTop: 6 }}>…or a recorded message (link to an MP3)
              <input value={cx.vm_drop_audio || ''} disabled={off} onChange={e => set('vm_drop_audio', e.target.value)} placeholder="Optional — used instead of the text" style={S.input} /></label>
          </div>
          <div><TransferNumbers list={cx.transfer_numbers} set={v => set('transfer_numbers', v)} disabled={off} /></div>
        </div>
      )}
      <Exclusions c={c} x={cx.exclusions || {}} set={v => set('exclusions', v)} disabled={off} />
      {can && <div><button style={S.primary} onClick={() => onSave(engine, { ...cx, transfer_numbers: (cx.transfer_numbers || []).filter(x => String(x.number || '').replace(/\D/g, '').length >= 10) })}>Save</button></div>}
    </div>
  )
}

// "Who the dialer skips" (Becky 11/16, rebuilt 11/23). Works on Standard and Advanced campaigns: dialer_next skips
// any lead dialer_exclusion() names a reason for. Saved in dial_campaigns.cx.exclusions.
function Exclusions({ c, x, set, disabled }) {
  const [counts, setCounts] = useState(null)
  useEffect(() => {
    let live = true
    supabase.rpc('dialer_exclusion_counts', { p_campaign: c.id }).then(({ data }) => { if (live) setCounts(data || {}) })
    return () => { live = false }
  }, [c.id, c.cx])
  const put = (k, v) => set({ ...x, [k]: v })
  const total = counts ? Object.values(counts).reduce((a, b) => a + Number(b || 0), 0) : 0
  return (
    <div style={{ borderTop: '1px solid light-dark(#eef2f7, #2a3439)', paddingTop: 10 }}>
      <div style={S.cap}>Who the dialer skips</div>
      <div style={S.mut}>Skipped leads stay in the list; they are dialed once the reason no longer applies (for example, after the weekend).</div>
      <div style={S.cols}>
        <div>
          <Toggle label="Don’t dial the same number twice in 24 hours" hint="Across every campaign for this client." v={x.dedupe_24h} on={v => put('dedupe_24h', v)} disabled={disabled} />
          <Toggle label="Skip weekends" hint="Uses the customer’s time zone when we know it." v={x.skip_weekends} on={v => put('skip_weekends', v)} disabled={disabled} />
          <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center', padding: '4px 0' }}>Skip anyone we talked to in the last
            <input type="number" min="0" max="365" value={x.recent_days ?? ''} disabled={disabled} onChange={e => put('recent_days', e.target.value === '' ? null : Math.max(0, Math.min(365, Number(e.target.value))))} style={{ ...S.input, width: 70 }} /> days</label>
          <div style={S.mut}>Leave empty or 0 to turn off. Counts calls with talk time from any campaign for this client.</div>
        </div>
        <div>
          <Toggle label="Skip anyone with a future appointment" hint="Appointments we booked, plus HubSpot’s next appointment date once HubSpot sends it." v={x.skip_booked} on={v => put('skip_booked', v)} disabled={disabled} />
          <Toggle label="Skip contacts inactive in the CRM" hint="HubSpot lead status Unqualified / Inactive, or lifecycle stage Other, when it comes in with the lead." v={x.skip_inactive} on={v => put('skip_inactive', v)} disabled={disabled} />
          <Toggle label="Skip Gold Star / members" hint="When the lead arrives marked as a member." v={x.skip_member} on={v => put('skip_member', v)} disabled={disabled} />
        </div>
      </div>
      {counts && total > 0 && (
        <div style={{ fontSize: 12.5, marginTop: 6 }}><b>Being skipped right now (saved settings):</b> {Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(' · ')}</div>
      )}
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
          <div key={n.id} style={{ fontSize: 13 }}>{n.number} · {[n.brand, n.location, `area ${n.area_code}`].filter(Boolean).join(' · ')}{n.spam_flag ? <b style={{ color: 'light-dark(#b91c1c, #e86464)' }}> · flagged {n.spam_flag}</b> : ''}{!n.active ? ' · off' : ''}</div>
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

// ---------- storm / emergency closure (works on every line, Standard or Advanced) ----------
// Also shown on the supervisor Wallboard (Becky 11/18): RMs/GMs can close and reopen their own lines there without
// Phone setup. The server (cx_emergency_close / cx_emergency_lift) still decides who may change which line.
// collapsible (Becky 11/20, Supervisor page): folded behind an arrow since it's rarely used; any closed lines still show.
// Blocked numbers for the Supervisor page (go-live CX-13: testers couldn't find how to unblock a number).
export function SpamBlocks({ clientId = null }) {
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const args = useCallback(x => (clientId ? { ...x, p_client: clientId } : x), [clientId])
  const flash = useCallback(t => { setMsg(t); setErr(''); setTimeout(() => setMsg(''), 4000) }, [])
  if (err === 'Not allowed') return null
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <BlockedNumbers args={args} flash={flash} onErr={setErr} />
      {msg && <div style={S.ok}>{msg}</div>}
      {err && <div style={{ color: 'light-dark(#b91c1c, #e86464)', fontSize: 13 }}>{err}</div>}
    </div>
  )
}

export function StormSwitch({ clientId = null, collapsible = false }) {
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const args = useCallback(x => (clientId ? { ...x, p_client: clientId } : x), [clientId])
  const flash = useCallback(t => { setMsg(t); setErr(''); setTimeout(() => setMsg(''), 4000) }, [])
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <EmergencySwitch args={args} can={true} flash={flash} onErr={setErr} collapsible={collapsible} />
      {msg && <div style={S.ok}>{msg}</div>}
      {err && <div style={{ color: 'light-dark(#b91c1c, #e86464)', fontSize: 13 }}>{err === 'Not allowed' ? 'Your login can’t close these lines.' : err}</div>}
    </div>
  )
}
function EmergencySwitch({ args, can, flash, onErr, collapsible = false }) {
  const [open, setOpen] = useState(!collapsible)
  const [rows, setRows] = useState(null)
  const [pick, setPick] = useState({})
  const [msg, setMsg] = useState('')
  const [through, setThrough] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('cx_emergency_status', args({}))
    if (error) onErr(error.message); else setRows(data || [])
  }, [args, onErr])
  useEffect(() => { load() }, [load])
  if (!rows) return null
  const closed = rows.filter(r => r.closure)
  const chosen = Object.keys(pick).filter(k => pick[k])
  async function close() {
    if (!chosen.length) return
    if (!window.confirm(`Close ${chosen.length} line${chosen.length === 1 ? '' : 's'} now? Callers will hear your message and go to the AI CSR or voicemail.`)) return
    setBusy(true)
    const { data, error } = await supabase.rpc('cx_emergency_close', args({ p_lines: chosen, p_message: msg || null, p_through: through || null }))
    setBusy(false)
    if (error) onErr(error.message); else { flash(`Closed ${data?.closed || 0} line(s).`); setPick({}); load() }
  }
  async function lift(ids) {
    setBusy(true)
    const { data, error } = await supabase.rpc('cx_emergency_lift', args({ p_lines: ids }))
    setBusy(false)
    if (error) onErr(error.message); else { flash(`Reopened ${data?.reopened || 0} line(s).`); load() }
  }
  return (
    <div style={{ ...S.card, borderColor: closed.length ? 'light-dark(#fca5a5, #642b2b)' : 'light-dark(#e2e8f0, #2a3439)', background: closed.length ? 'light-dark(#fef2f2, #391313)' : 'light-dark(#fff, #161d21)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {collapsible ? (
          <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', color: 'inherit', font: 'inherit', minHeight: 32 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}><path d="M9 6l6 6-6 6" /></svg>
            <span>
              <span style={{ ...S.h3, display: 'block' }}>Storm / emergency closure{closed.length ? ` · ${closed.length} closed` : ''}</span>
              {open && <span style={{ ...S.mut, display: 'block' }}>Close lines right now (weather, power outage, emergency). Callers hear your message, then go to the AI CSR or voicemail.</span>}
            </span>
          </button>
        ) : (
        <div>
          <div style={S.h3}>Storm / emergency closure</div>
          <div style={S.mut}>Close lines right now (weather, power outage, emergency). Callers hear your message, then go to the AI CSR or voicemail. Works on every line.</div>
        </div>
        )}
        {closed.length > 0 && can && <button disabled={busy} style={{ ...S.primary, background: '#15803d' }} onClick={() => lift(closed.map(r => r.line_id))}>Reopen all ({closed.length})</button>}
      </div>
      {closed.length > 0 && (
        <div style={{ marginTop: 8, display: 'grid', gap: 4 }}>
          {closed.map(r => (
            <div key={r.line_id} style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}>
              <b style={{ color: 'light-dark(#b91c1c, #e86464)' }}>CLOSED</b> {r.name} · through {r.closure.ends_on}
              {can && <button disabled={busy} style={S.small} onClick={() => lift([r.line_id])}>Reopen</button>}
            </div>
          ))}
        </div>
      )}
      {can && open && (
        <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <button style={S.small} onClick={() => setPick(Object.fromEntries(rows.filter(r => !r.closure).map(r => [r.line_id, true])))}>Select all open</button>
            {rows.filter(r => !r.closure).map(r => (
              <label key={r.line_id} style={{ ...S.chip, cursor: 'pointer' }}>
                <input type="checkbox" checked={!!pick[r.line_id]} onChange={e => setPick(p => ({ ...p, [r.line_id]: e.target.checked }))} />{r.name}
              </label>
            ))}
          </div>
          <textarea value={msg} onChange={e => setMsg(e.target.value)} rows={2} style={{ ...S.input, resize: 'vertical' }}
            placeholder="Message (optional). Default: “Due to severe weather, our office is closed right now. Please leave a message, or stay on the line for our digital assistant…”" />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontSize: 13 }}>Closed through <input type="date" value={through} onChange={e => setThrough(e.target.value)} style={S.input} /></label>
            <span style={S.mut}>Blank = today only.</span>
            <button disabled={busy || !chosen.length} style={{ ...S.primary, background: '#b91c1c' }} onClick={close}>Close {chosen.length || ''} line{chosen.length === 1 ? '' : 's'} now</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------- blocked numbers (spam) ----------
function BlockedNumbers({ args, flash, onErr }) {
  const [rows, setRows] = useState([])
  const [num, setNum] = useState('')
  const [why, setWhy] = useState('')
  const [days, setDays] = useState('')
  const [show, setShow] = useState(false)
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('cx_blocked_list', args({}))
    if (error) onErr(error.message); else setRows(data || [])
  }, [args, onErr])
  useEffect(() => { if (show) load() }, [show, load])
  async function add() {
    const { error } = await supabase.rpc('cx_block_number', args({ p_phone: num, p_reason: why || null, p_days: days ? Number(days) : null }))
    if (error) onErr(error.message); else { flash('Number blocked.'); setNum(''); setWhy(''); setDays(''); load() }
  }
  async function unblock(id) {
    const { error } = await supabase.rpc('cx_unblock_number', args({ p_id: id }))
    if (error) onErr(error.message); else { flash('Unblocked. That number can call in again.'); load() }
  }
  const src = { manual: 'Added by hand', auto: 'Auto (too many calls)', report: 'Reported by CSR' }
  return (
    <div style={S.card}>
      <button onClick={() => setShow(v => !v)} style={S.rowBtn}>
        <span><b style={{ fontSize: 15, color: GT }}>Blocked numbers</b><div style={S.mut}>Spam and robocallers that can’t reach your lines. Open to see them; Unblock lets a number call in again.</div></span>
        <span style={S.mut}>{show ? '▴' : '▾'}</span>
      </button>
      {show && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <input value={num} onChange={e => setNum(e.target.value)} placeholder="(555) 555-5555" style={{ ...S.input, width: 150 }} />
            <input value={why} onChange={e => setWhy(e.target.value)} placeholder="Reason (optional)" style={{ ...S.input, flex: 1, minWidth: 160 }} />
            <input value={days} onChange={e => setDays(e.target.value)} type="number" placeholder="Days (blank = forever)" style={{ ...S.input, width: 170 }} />
            <button disabled={num.replace(/\D/g, '').length < 10} style={S.primary} onClick={add}>Block</button>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 10 }}>
            <thead><tr>{['Number', 'Why', 'How', 'Until', 'Calls stopped', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td style={S.td}><b>{r.phone}</b></td><td style={S.td}>{r.reason || '—'}</td><td style={S.td}>{src[r.source] || r.source}</td>
                  <td style={S.td}>{r.expires_at ? new Date(r.expires_at).toLocaleString() : 'Forever'}</td><td style={S.td}>{r.blocked_calls || 0}</td>
                  <td style={S.td}><button style={S.small} onClick={() => unblock(r.id)}>Unblock</button></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} style={{ ...S.td, color: 'light-dark(#64748b, #9fb4bb)' }}>No blocked numbers.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const S = {
  card: { background: 'light-dark(#fff, #161d21)', border: '1px solid light-dark(#e2e8f0, #2a3439)', borderRadius: 14, padding: 14 },
  h2: { fontSize: 17, fontWeight: 800, color: GT, marginBottom: 4 },
  h3: { fontSize: 15, fontWeight: 800, color: GT, marginBottom: 4 },
  mut: { fontSize: 12.5, color: 'light-dark(#64748b, #9fb4bb)' },
  ok: { padding: '6px 10px', borderRadius: 8, background: 'light-dark(#dcfce7, #133920)', color: 'light-dark(#166534, #29bc61)', fontSize: 13 },
  warn: { padding: '8px 10px', borderRadius: 8, background: 'light-dark(#fef3c7, #393213)', color: 'light-dark(#92400e, #e1712d)', fontSize: 13 },
  cap: { fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: 'light-dark(#64748b, #9fb4bb)', margin: '4px 0' },
  cols: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 },
  two: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 },
  rowBtn: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: 10, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0, color: 'light-dark(#0f172a, #e8eef0)' },
  pill: { fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 999, whiteSpace: 'nowrap' },
  seg: { display: 'inline-flex', gap: 4, background: 'light-dark(#f1f5f9, #1b2327)', padding: 3, borderRadius: 10 },
  segBtn: { padding: '6px 12px', fontSize: 13, fontWeight: 700, border: 'none', borderRadius: 8, background: 'transparent', cursor: 'pointer', color: 'light-dark(#475569, #b3c1c7)' },
  segOn: { background: 'light-dark(#fff, #161d21)', color: GT, boxShadow: '0 1px 3px rgba(0,0,0,0.12)' },
  input: { padding: '7px 9px', fontSize: 13, borderRadius: 8, border: '1px solid light-dark(#cbd5e1, #3a464c)', boxSizing: 'border-box' },
  primary: { padding: '8px 16px', fontSize: 13, fontWeight: 700, borderRadius: 10, border: 'none', background: G, color: '#fff', cursor: 'pointer' },
  small: { padding: '5px 10px', fontSize: 12, fontWeight: 700, borderRadius: 8, border: '1px solid light-dark(#cbd5e1, #3a464c)', background: 'light-dark(#fff, #161d21)', cursor: 'pointer' },
  chip: { fontSize: 12, fontWeight: 600, padding: '4px 8px', borderRadius: 999, background: 'light-dark(#f1f5f9, #1b2327)', display: 'inline-flex', alignItems: 'center', gap: 4 },
  x: { border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 14, color: 'light-dark(#64748b, #9fb4bb)' },
  th: { textAlign: 'left', fontSize: 11, textTransform: 'uppercase', color: 'light-dark(#64748b, #9fb4bb)', padding: '6px', borderBottom: '1px solid light-dark(#e2e8f0, #2a3439)' },
  td: { padding: '6px', borderBottom: '1px solid light-dark(#f1f5f9, #2a3439)' },
}
