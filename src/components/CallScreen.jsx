// ============================================================
//  CallScreen — the guided call screen agents work from (inbound AND outbound).
//  Driven by a script's config (call_scripts.config, edited on /scripts):
//
//    eyebrow, title, subtitle, kpi, knowledge_url, callback_number,
//    booking_url, booking_label,
//    alerts      [{label, text, tone: info|warn|danger}]
//    principles  [{title, text}]
//    steps       [{title, blocks: [{type: say|ask|note|check, text | items[]}]}]
//    voicemail   {text, max_seconds, dont}
//    objections  [{q, a}]
//    facts       [{label, value, tone?}]
//    zips        ['66002', …]   → zip code lookup
//    fields      [{key, label, type: text|select, options[], required}]  → qualifiers
//    dispositions (inbound) — outbound uses the campaign's dispositions
//
//  Merge tags in any text: {{first_name}} {{last_name}} {{customer_name}} {{agent_name}}
//  {{agent_first}} {{brand}} {{callback_number}} {{reason}} {{lead_source}}
//  {{menu_option}} {{company}} … and {{any_key}} from the contact's data or qualifiers.
// ============================================================
import { useMemo, useState } from 'react'

export const MERGE_TAGS = ['first_name', 'last_name', 'customer_name', 'agent_name', 'agent_first', 'brand', 'callback_number', 'reason', 'lead_source', 'menu_option', 'company']

// Splits text into plain + merged parts so merged values can be highlighted.
export function mergeParts(text, ctx) {
  const out = []
  const re = /\{\{\s*([\w.]+)\s*\}\}|@Customer\.([\w]+)@|@Agent\.([\w]+)@/g
  let last = 0, m
  const s = String(text || '')
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ t: s.slice(last, m.index) })
    const key = m[1] || (m[2] ? m[2] : m[3] === 'full_name' ? 'agent_name' : m[3] ? `agent_${m[3]}` : '')
    const val = ctx?.[key] ?? ctx?.[key.replace(/^data\./, '')]
    out.push(val != null && val !== '' ? { t: String(val), merged: true } : { t: `[${key.replace(/_/g, ' ')}]`, missing: true })
    last = re.lastIndex
  }
  if (last < s.length) out.push({ t: s.slice(last) })
  return out
}
export function mergeText(text, ctx) { return mergeParts(text, ctx).map(p => p.t).join('') }

function Merged({ text, ctx }) {
  return mergeParts(text, ctx).map((p, i) => p.merged
    ? <strong key={i} style={{ color: 'var(--cs-accent, #0e7490)' }}>{p.t}</strong>
    : p.missing ? <span key={i} style={{ background: 'rgba(234,179,8,0.2)', borderRadius: 4, padding: '0 3px' }}>{p.t}</span>
      : <span key={i}>{p.t}</span>)
}

function copy(t) { try { navigator.clipboard?.writeText(t) } catch { /* ignore */ } }
export function prettyPhone(p) {
  const d = String(p || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : (p || '')
}
const TONES = {
  info: { bg: 'rgba(8,145,178,0.08)', border: 'rgba(8,145,178,0.35)', chip: '#0e7490', text: '#0e7490' },
  warn: { bg: 'rgba(234,179,8,0.10)', border: 'rgba(202,138,4,0.4)', chip: '#a16207', text: '#a16207' },
  danger: { bg: 'rgba(220,38,38,0.07)', border: 'rgba(220,38,38,0.4)', chip: '#b91c1c', text: '#b91c1c' },
}

// ---------------------------------------------------------------
//  props:
//   script        config object (may be null → a plain fallback is shown)
//   ctx           merge values
//   context       [{label, value}] — the "lead context" row (read-only)
//   contact       {phone, email, address} | null    contactNote: shown when null
//   callBar       node — call status + buttons (top of the right column)
//   extra         node — extra right-column cards (AI summary, history…)
//   dispositions  [{code, label, outcome, is_contact, color}]
//   canSave       bool — call ended, disposition can be saved
//   onSave({code, notes, fields, callbackAt}) → Promise   saving / error
//   saveLabel     text for the save button
//   showVoicemail bool
//   preview       bool — builder preview (no saving)
// ---------------------------------------------------------------
export default function CallScreen({
  script, ctx = {}, context = [], contact, contactNote = 'Shows once you are on the call.',
  callBar, extra, dispositions = [], canSave = false, onSave, saving = false, error = '', saveLabel = 'Save disposition',
  showVoicemail = true, preview = false, saveHint = '',
}) {
  const sc = script || {}
  const steps = sc.steps?.length ? sc.steps : [{ title: 'Call', blocks: [{ type: 'note', text: 'No script yet — add one on the Scripts page.' }] }]
  const [step, setStep] = useState(0)
  const [fields, setFields] = useState({})
  const [code, setCode] = useState('')
  const [notes, setNotes] = useState('')
  const [callbackAt, setCallbackAt] = useState('')
  const [zip, setZip] = useState('')
  const [openObj, setOpenObj] = useState(-1)
  const [checks, setChecks] = useState({})
  const mctx = useMemo(() => ({ ...ctx, ...fields }), [ctx, fields])

  const zips = useMemo(() => new Set((sc.zips || []).map(z => String(z).trim()).filter(Boolean)), [sc.zips])
  const dispo = dispositions.find(d => d.code === code)
  const missingRequired = (sc.fields || []).filter(f => f.required && !String(fields[f.key] || '').trim())
  const cb = sc.callback_number || ctx.callback_number

  async function save() {
    if (!onSave) return
    await onSave({ code, notes, fields, callbackAt: dispo?.outcome === 'callback' && callbackAt ? new Date(callbackAt).toISOString() : null })
  }

  const cur = steps[Math.min(step, steps.length - 1)]

  return (
    <div style={{ '--cs-accent': '#0e7490' }}>
      {/* ---------- header ---------- */}
      <div style={S.hero}>
        <div style={{ minWidth: 0 }}>
          {sc.eyebrow && <div style={S.eyebrow}>{sc.eyebrow}</div>}
          <div style={S.title}>{sc.title || 'Call'}</div>
          {sc.subtitle && <div style={S.subtitle}><Merged text={sc.subtitle} ctx={mctx} /></div>}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {sc.kpi && <span style={S.kpi}>{sc.kpi}</span>}
          <a href={sc.knowledge_url || '/knowledge'} target="_blank" rel="noreferrer" style={S.kb}>Knowledge Base</a>
        </div>
      </div>

      <style>{'@media (max-width: 900px){.cs-grid{grid-template-columns:minmax(0,1fr) !important}}'}</style>
      <div className="cs-grid" style={S.grid}>
        {/* ================= main column ================= */}
        <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
          {/* context */}
          <div style={S.card}>
            <div style={S.cardTitle}>Context <span style={S.cardHint}>Confirm what's already here rather than making them repeat it.</span></div>
            {context.length > 0 && (
              <div style={S.ctxGrid}>
                {context.map(c => (
                  <div key={c.label}>
                    <div style={S.ctxLabel}>{c.label}</div>
                    <div style={S.ctxValue}>{c.value || <span style={{ opacity: 0.45 }}>—</span>}</div>
                  </div>
                ))}
              </div>
            )}
            {(sc.alerts || []).map((a, i) => {
              const t = TONES[a.tone] || TONES.info
              return (
                <div key={i} style={{ ...S.alert, background: t.bg, borderColor: t.border }}>
                  {a.label && <span style={{ ...S.alertChip, background: t.chip }}>{a.label}</span>}
                  <span style={{ color: t.text, fontWeight: 700 }}><Merged text={a.text} ctx={mctx} /></span>
                </div>
              )
            })}
            {(sc.booking_url || sc.booking_label) && (
              <div style={{ marginTop: 10 }}>
                {sc.booking_url
                  ? <a href={mergeText(sc.booking_url, mctx)} target="_blank" rel="noreferrer" style={S.bookBtn}>{sc.booking_label || 'Open booking form'} ↗</a>
                  : <span style={{ ...S.bookBtn, opacity: 0.55, cursor: 'default' }} title="Add the booking link on the Scripts page">{sc.booking_label || 'Open booking form'} (no link yet)</span>}
              </div>
            )}
            {(sc.fields || []).length > 0 && (
              <>
                <div style={{ ...S.cardTitle, marginTop: 14 }}>Details & qualifiers <span style={S.cardHint}>saved with the disposition</span></div>
                <div style={S.fieldGrid}>
                  {sc.fields.map(f => (
                    <label key={f.key} style={S.fieldLbl}>
                      {f.label}{f.required && <span style={{ color: '#dc2626' }}> *</span>}
                      {f.type === 'select'
                        ? <select value={fields[f.key] || ''} onChange={e => setFields(x => ({ ...x, [f.key]: e.target.value }))} style={S.input}>
                            <option value="">—</option>{(f.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                        : <input value={fields[f.key] || ''} onChange={e => setFields(x => ({ ...x, [f.key]: e.target.value }))} style={S.input} />}
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* stepper */}
          <div style={{ ...S.card, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '10px 14px' }}>
            {steps.map((s, i) => (
              <button key={i} onClick={() => setStep(i)} style={{ ...S.stepBtn, ...(i === step ? S.stepOn : {}) }}>
                <span style={{ ...S.stepNum, ...(i === step ? S.stepNumOn : i < step ? S.stepNumDone : {}) }}>{i < step ? '✓' : i + 1}</span>{s.title}
              </button>
            ))}
          </div>

          {(sc.principles || []).length > 0 && (
            <div style={S.principles}>
              {sc.principles.map((p, i) => (
                <div key={i} style={S.principle}>
                  <div style={S.principleTitle}>{p.title}</div>
                  <div style={{ fontSize: 13, opacity: 0.85 }}>{p.text}</div>
                </div>
              ))}
            </div>
          )}

          {/* current step */}
          <div style={S.card}>
            <div style={S.cardTitle}>{step + 1}. {cur.title}</div>
            {(cur.blocks || []).map((b, i) => (
              <div key={i} style={{ marginTop: 10 }}>
                {b.type === 'say' && <blockquote style={S.say}>"<Merged text={b.text} ctx={mctx} />"</blockquote>}
                {b.type === 'note' && <div style={S.note}><Merged text={b.text} ctx={mctx} /></div>}
                {b.type === 'ask' && (
                  <ul style={S.ask}>{(b.items || []).map((q, j) => <li key={j} style={{ margin: '4px 0' }}><Merged text={q} ctx={mctx} /></li>)}</ul>
                )}
                {b.type === 'check' && (
                  <div>{(b.items || []).map((q, j) => {
                    const k = `${step}.${i}.${j}`
                    return (
                      <label key={j} style={S.check}>
                        <input type="checkbox" checked={!!checks[k]} onChange={e => setChecks(c => ({ ...c, [k]: e.target.checked }))} />
                        <span style={{ textDecoration: checks[k] ? 'line-through' : 'none', opacity: checks[k] ? 0.6 : 1 }}><Merged text={q} ctx={mctx} /></span>
                      </label>
                    )
                  })}</div>
                )}
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}>
              <button onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step === 0} style={{ ...S.btn, opacity: step === 0 ? 0.4 : 1 }}>← Back</button>
              {step < steps.length - 1 && <button onClick={() => setStep(s => s + 1)} style={{ ...S.btn, background: '#0e7490', color: '#fff', borderColor: '#0e7490' }}>Next: {steps[step + 1].title} →</button>}
            </div>
          </div>

          {/* voicemail */}
          {showVoicemail && sc.voicemail?.text && (
            <div style={{ ...S.card, borderColor: 'rgba(202,138,4,0.45)', background: 'rgba(234,179,8,0.05)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <div style={S.cardTitle}><span style={S.vmBadge}>VM</span> No answer — leave this voicemail</div>
                {sc.voicemail.max_seconds && <span style={S.vmChip}>Under {sc.voicemail.max_seconds} seconds</span>}
              </div>
              <blockquote style={{ ...S.say, borderColor: '#a16207', fontSize: 17 }}>"<Merged text={sc.voicemail.text} ctx={{ ...mctx, callback_number: prettyPhone(cb) || ctx.callback_number }} />"</blockquote>
              {cb && (
                <div style={S.cbRow}>
                  <span style={S.ctxLabel}>Callback number — say it twice, slowly</span>
                  <strong style={{ fontSize: 18, letterSpacing: 0.5 }}>{prettyPhone(cb)}</strong>
                  <button onClick={() => copy(prettyPhone(cb))} style={{ ...S.btn, background: '#a16207', color: '#fff', borderColor: '#a16207' }}>Copy #</button>
                </div>
              )}
              {sc.voicemail.dont && <div style={{ ...S.note, marginTop: 10 }}><strong>Do not:</strong> {sc.voicemail.dont.replace(/^Do not:?\s*/i, '')}</div>}
            </div>
          )}

          {/* objections */}
          {(sc.objections || []).length > 0 && (
            <div style={S.card}>
              <div style={S.cardTitle}>If they say…</div>
              {sc.objections.map((o, i) => (
                <div key={i} style={{ borderTop: i ? '1px solid rgba(100,116,139,0.15)' : 'none' }}>
                  <button onClick={() => setOpenObj(openObj === i ? -1 : i)} style={S.objQ}>
                    <span>"{o.q}"</span><span style={{ opacity: 0.5 }}>{openObj === i ? '−' : '+'}</span>
                  </button>
                  {openObj === i && <div style={{ ...S.say, margin: '0 0 10px' }}><Merged text={o.a} ctx={mctx} /></div>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ================= right column ================= */}
        <div style={{ display: 'grid', gap: 12, alignContent: 'start', minWidth: 0 }}>
          {callBar && <div style={S.card}>{callBar}</div>}

          {/* disposition */}
          {!preview && dispositions.length > 0 && (
            <div style={{ ...S.card, borderColor: canSave ? 'rgba(14,116,144,0.5)' : undefined }}>
              <div style={S.cardTitle}>Disposition {!canSave && <span style={S.cardHint}>{saveHint || 'pick now, save after the call'}</span>}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {dispositions.map(d => (
                  <button key={d.code} onClick={() => setCode(d.code)}
                    style={{ ...S.chip, ...(code === d.code ? { background: d.color || '#0e7490', borderColor: d.color || '#0e7490', color: '#fff' } : {}) }}>
                    {d.label}
                  </button>
                ))}
              </div>
              {dispo?.outcome === 'callback' && (
                <label style={{ ...S.fieldLbl, marginTop: 10 }}>Callback date & time (your time)
                  <input type="datetime-local" value={callbackAt} onChange={e => setCallbackAt(e.target.value)} style={S.input} />
                </label>
              )}
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Notes"
                style={{ ...S.input, marginTop: 10, resize: 'vertical' }} />
              {missingRequired.length > 0 && code && dispo?.is_contact && (
                <div style={{ fontSize: 12.5, color: '#b45309', marginTop: 6 }}>Still needed: {missingRequired.map(f => f.label).join(', ')}</div>
              )}
              {error && <div style={S.error}>{error}</div>}
              <button onClick={save} disabled={!canSave || !code || saving || (dispo?.is_contact && missingRequired.length > 0)}
                style={{ ...S.saveBtn, opacity: (!canSave || !code || saving || (dispo?.is_contact && missingRequired.length > 0)) ? 0.5 : 1 }}>
                {saving ? 'Saving…' : saveLabel}
              </button>
            </div>
          )}

          {/* contact */}
          <div style={S.card}>
            <div style={S.cardTitle}>Copy to other systems</div>
            {[['Phone', contact?.phone ? prettyPhone(contact.phone) : ''], ['Email', contact?.email || ''], ['Address', contact?.address || '']].map(([l, v]) => (
              <div key={l} style={S.copyRow}>
                <span style={S.ctxLabel}>{l}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 13.5 }}>{v || (contact ? '—' : '')}</span>
                {v && <button onClick={() => copy(v)} style={S.copyBtn}>Copy</button>}
              </div>
            ))}
            {!contact && <div style={{ fontSize: 12, opacity: 0.6, marginTop: 6 }}>{contactNote}</div>}
          </div>

          {/* zip lookup */}
          {zips.size > 0 && (
            <div style={S.card}>
              <div style={{ ...S.cardTitle, display: 'flex', justifyContent: 'space-between' }}>Zip code lookup <span style={S.cardHint}>{zips.size} zips on file</span></div>
              <input value={zip} onChange={e => setZip(e.target.value.replace(/\D/g, '').slice(0, 5))} placeholder="Type a zip code" inputMode="numeric"
                style={{ ...S.input, fontSize: 20, textAlign: 'center', letterSpacing: 2 }} />
              {zip.length === 5 && (zips.has(zip)
                ? <div style={{ ...S.zipRes, background: 'rgba(22,163,74,0.1)', color: '#15803d' }}>✓ {zip} is in the service area</div>
                : <div style={{ ...S.zipRes, background: 'rgba(220,38,38,0.08)', color: '#b91c1c' }}>✗ {zip} is NOT in the service area</div>)}
            </div>
          )}

          {/* facts */}
          {(sc.facts || []).length > 0 && (
            <div style={S.card}>
              <div style={S.cardTitle}>{ctx.brand ? `${ctx.brand} facts` : 'Facts'}</div>
              {sc.facts.map((f, i) => {
                const t = f.tone ? (TONES[f.tone] || TONES.info) : null
                return (
                  <div key={i} style={{ ...S.fact, ...(t ? { background: t.bg, borderColor: t.border } : {}) }}>
                    <div style={{ ...S.ctxLabel, ...(t ? { color: t.text } : {}) }}>{f.label}</div>
                    <div style={{ fontSize: 13.5, fontWeight: t ? 700 : 500, color: t ? t.text : 'inherit' }}><Merged text={f.value} ctx={mctx} /></div>
                  </div>
                )
              })}
            </div>
          )}

          {extra}
        </div>
      </div>
    </div>
  )
}

const S = {
  hero: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap', padding: '18px 22px', borderRadius: 16, color: '#fff', background: 'linear-gradient(120deg, #0b3954 0%, #0e7490 60%, #0891b2 100%)', marginBottom: 12 },
  eyebrow: { fontSize: 11.5, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: '#67e8f9' },
  title: { fontSize: 24, fontWeight: 800, lineHeight: 1.2, marginTop: 2 },
  subtitle: { fontSize: 13.5, opacity: 0.9, marginTop: 4, maxWidth: 720 },
  kpi: { padding: '7px 12px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.35)', background: 'rgba(255,255,255,0.1)', fontSize: 12.5, fontWeight: 700 },
  kb: { padding: '8px 14px', borderRadius: 999, background: '#22d3ee', color: '#083344', fontWeight: 800, fontSize: 13, textDecoration: 'none' },
  grid: { display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)', gap: 12, alignItems: 'start' },
  card: { padding: 14, borderRadius: 14, border: '1px solid rgba(100,116,139,0.22)', background: 'var(--card, #fff)' },
  cardTitle: { fontSize: 12.5, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: '#0e7490', marginBottom: 8 },
  cardHint: { textTransform: 'none', letterSpacing: 0, fontWeight: 500, color: 'inherit', opacity: 0.6, fontSize: 12 },
  ctxGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10, marginBottom: 10 },
  ctxLabel: { fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', opacity: 0.6 },
  ctxValue: { marginTop: 3, padding: '7px 10px', borderRadius: 8, border: '1px solid rgba(100,116,139,0.25)', fontSize: 14, minHeight: 20, wordBreak: 'break-word' },
  alert: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: '1px solid', marginTop: 8, fontSize: 14.5 },
  alertChip: { color: '#fff', fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, padding: '3px 8px', borderRadius: 6, whiteSpace: 'nowrap' },
  bookBtn: { display: 'inline-block', padding: '10px 16px', borderRadius: 10, background: 'linear-gradient(120deg, #0e7490, #22d3ee)', color: '#fff', fontWeight: 800, fontSize: 13.5, textDecoration: 'none' },
  fieldGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 },
  fieldLbl: { display: 'block', fontSize: 12, fontWeight: 700 },
  input: { display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 4, padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(100,116,139,0.35)', background: 'transparent', color: 'inherit', fontSize: 14, fontFamily: 'inherit' },
  stepBtn: { display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 10px', border: 'none', borderRadius: 999, background: 'transparent', color: 'inherit', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', opacity: 0.7 },
  stepOn: { opacity: 1, background: 'rgba(14,116,144,0.08)' },
  stepNum: { width: 24, height: 24, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12.5, background: 'rgba(100,116,139,0.15)' },
  stepNumOn: { background: '#22d3ee', color: '#083344' },
  stepNumDone: { background: '#16a34a', color: '#fff' },
  principles: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 },
  principle: { padding: 12, borderRadius: 12, border: '1px solid rgba(100,116,139,0.18)', background: 'rgba(14,116,144,0.04)' },
  principleTitle: { fontSize: 11.5, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: '#0e7490', marginBottom: 4 },
  say: { margin: 0, padding: '10px 14px', borderLeft: '4px solid #0e7490', background: 'rgba(14,116,144,0.05)', borderRadius: '0 10px 10px 0', fontSize: 16, lineHeight: 1.55 },
  note: { padding: '8px 12px', borderRadius: 10, border: '1px dashed rgba(100,116,139,0.4)', fontSize: 13.5, opacity: 0.9 },
  ask: { margin: 0, paddingLeft: 20, fontSize: 14.5, lineHeight: 1.5 },
  check: { display: 'flex', gap: 8, alignItems: 'flex-start', margin: '6px 0', fontSize: 14, cursor: 'pointer' },
  btn: { padding: '7px 12px', borderRadius: 8, border: '1px solid rgba(100,116,139,0.35)', background: 'transparent', color: 'inherit', fontWeight: 700, fontSize: 13, cursor: 'pointer' },
  vmBadge: { display: 'inline-block', marginRight: 6, padding: '2px 6px', borderRadius: 999, background: '#a16207', color: '#fff', fontSize: 11 },
  vmChip: { fontSize: 11, fontWeight: 800, padding: '3px 8px', borderRadius: 999, border: '1px solid rgba(202,138,4,0.5)', color: '#a16207', whiteSpace: 'nowrap' },
  cbRow: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 10, padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(202,138,4,0.35)' },
  objQ: { display: 'flex', justifyContent: 'space-between', width: '100%', padding: '10px 2px', border: 'none', background: 'none', color: 'inherit', fontWeight: 700, fontSize: 14, textAlign: 'left', cursor: 'pointer' },
  chip: { padding: '7px 11px', borderRadius: 999, border: '1px solid rgba(100,116,139,0.35)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  saveBtn: { marginTop: 10, width: '100%', padding: '10px 0', borderRadius: 10, border: 'none', background: '#0e7490', color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer' },
  error: { marginTop: 8, padding: '8px 10px', borderRadius: 8, background: 'rgba(220,38,38,0.1)', color: '#b91c1c', fontSize: 12.5 },
  copyRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(100,116,139,0.2)', marginTop: 6 },
  copyBtn: { border: 'none', background: 'none', color: '#0e7490', fontWeight: 800, fontSize: 12.5, cursor: 'pointer' },
  zipRes: { marginTop: 8, padding: '8px 10px', borderRadius: 8, fontWeight: 700, fontSize: 13.5 },
  fact: { padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(100,116,139,0.2)', marginTop: 6 },
}
