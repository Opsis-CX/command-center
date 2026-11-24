// ============================================================
//  QaSetupInterview — self-serve call scoring setup (Becky 11/23).
//  Shown inside the client portal when the company has no scoring checklist yet
//  (RPC qa_setup_status → needs_setup). Account admins answer a few questions,
//  the edge function qa-setup-draft drafts a 5-step checklist + scoring instructions,
//  they edit it, and RPC qa_setup_save stores it. Name-neutral on purpose (rebrand pending).
// ============================================================
import { useState } from 'react'
import { supabase } from '../lib/supabase'

const SECTIONS = [
  ['greeting_compliance', 'Opening'],
  ['discovery_needs', 'Getting the details'],
  ['solution_pitch', 'Winning the outcome'],
  ['close_next_steps', 'Closing'],
]
const C = { ink: '#1C2421', soft: '#5F6763', line: '#E8E4DC', bg: '#F5F3EE', card: '#FFFFFF', accent: '#14302A', ok: '#2F7D5B', bad: '#A8441A' }

const QUESTIONS = [
  ['business', 'What does your business do?', 'e.g. A CPA firm: tax returns, bookkeeping and payroll for individuals and small businesses', 3, true],
  ['locations', 'Your locations or brands', 'One per line, e.g.\nDowntown\nNorthside\nRiverview, FL\n(leave empty if you have one)', 3, false],
  ['outcome', 'What should a great call end in?', 'e.g. A booked consultation, a sale, an item on hold, a scheduled visit', 1, true],
  ['not_opps', 'Which calls are NOT a chance to win that outcome?', 'e.g. Billing questions, existing customers checking status, vendors', 2, false],
  ['steps', 'How should your team handle a call today? (optional)', 'e.g. Greet, find out what they need, get their details, offer a time, recap. Leave empty and we will suggest one.', 3, false],
  ['rules', 'Anything your team must always or never say? (optional)', 'e.g. Never quote a price before the consultation. Always offer the first opening.', 2, false],
]

export default function QaSetupInterview({ clientId, company, onDone }) {
  const [a, setA] = useState({ business: '', locations: '', outcome: '', not_opps: '', steps: '', rules: '' })
  const [inbound, setInbound] = useState(false)
  const [draft, setDraft] = useState(null)       // { call_type, guidance, steps:[{label, points, allow_na, section}] }
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')

  const total = draft ? draft.steps.reduce((s, x) => s + (Number(x.points) || 0), 0) : 0

  async function makeDraft() {
    if (a.business.trim().length < 10 || a.outcome.trim().length < 3) { setErr('Tell us what your business does and what a great call ends in.'); return }
    setErr(''); setBusy('draft')
    const { data, error } = await supabase.functions.invoke('qa-setup-draft', { body: { client_id: clientId, answers: a } })
    setBusy('')
    if (error) {
      let msg = 'We couldn’t draft your checklist. Try again.'
      try { const j = await error.context.json(); if (j?.error) msg = j.error } catch { /* not JSON */ }
      setErr(msg); return
    }
    setDraft({ ...data, not_booked_txt: (data.not_booked || []).join('\n'), existing_txt: (data.existing || []).join('\n') })
  }

  function setStep(i, patch) { setDraft(d => ({ ...d, steps: d.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) })) }
  function addStep() { setDraft(d => ({ ...d, steps: [...d.steps, { label: '', points: 0, allow_na: false, section: 'close_next_steps' }] })) }
  function removeStep(i) { setDraft(d => ({ ...d, steps: d.steps.filter((_, j) => j !== i) })) }

  async function save() {
    if (total !== 100) { setErr(`Points must add up to 100 (now ${total}).`); return }
    if (draft.steps.some(s => !String(s.label).trim())) { setErr('Every step needs a name.'); return }
    setErr(''); setBusy('save')
    const locs = a.locations.split(/\n/).map(x => x.trim()).filter(Boolean)
    const { error } = await supabase.rpc('qa_setup_save', {
      p_client: clientId, p_campaign: draft.call_type || 'calls', p_guidance: draft.guidance,
      p_steps: draft.steps.map(s => ({ ...s, points: Number(s.points) || 0 })), p_locations: locs.length ? locs : null, p_inbound_only: inbound,
    })
    setBusy('')
    if (error) { setErr(error.message || 'We couldn’t save it. Try again.'); return }
    // Call outcomes written for this business (Becky 11/23). Best effort: a general list is used if this fails.
    const lines = v => String(v || '').split('\n').map(x => x.trim()).filter(Boolean)
    await supabase.rpc('qa_outcomes_save', { p_client: clientId, p_sales_label: draft.sales_label || null, p_not_booked: lines(draft.not_booked_txt), p_existing: lines(draft.existing_txt) })
    onDone && onDone()
  }

  return (
    <div style={{ minHeight: '100vh', background: `light-dark(${C.bg}, #1b2327)`, fontFamily: 'Montserrat, Arial, sans-serif', color: `light-dark(${C.ink}, #e8eef0)`, padding: '32px 16px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', display: 'grid', gap: 16 }}>
        <div>
          <div style={S.cap}>{draft ? 'Step 2 of 2' : 'Step 1 of 2'}</div>
          <h1 style={{ margin: '4px 0 6px', fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em' }}>{draft ? 'Review your scoring checklist' : `Set up call scoring${company ? ` for ${company}` : ''}`}</h1>
          <p style={S.sub}>{draft
            ? 'This is how every call will be scored. Rename steps, change the points or the instructions, then save. You can change it any time under QA settings.'
            : 'Answer a few questions about your calls. We’ll draft a scoring checklist for your business in about 20 seconds, and you can edit it before anything is scored.'}</p>
        </div>

        {!draft && (
          <div style={S.card}>
            {QUESTIONS.map(([k, label, ph, rows, req]) => (
              <label key={k} style={{ display: 'grid', gap: 6, marginBottom: 14 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{label}{req && <span style={{ color: C.bad }}> *</span>}</span>
                {rows > 1
                  ? <textarea rows={rows} value={a[k]} placeholder={ph} onChange={e => setA({ ...a, [k]: e.target.value })} style={S.input} />
                  : <input value={a[k]} placeholder={ph} onChange={e => setA({ ...a, [k]: e.target.value })} style={S.input} />}
              </label>
            ))}
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5 }}>
              <input type="checkbox" checked={inbound} onChange={e => setInbound(e.target.checked)} /> Only score calls customers make to us (skip outbound calls)
            </label>
            {err && <div style={S.err}>{err}</div>}
            <div style={{ marginTop: 16 }}><button onClick={makeDraft} disabled={!!busy} style={S.primary}>{busy === 'draft' ? 'Drafting your checklist…' : 'Draft my checklist'}</button></div>
          </div>
        )}

        {draft && (
          <>
            <div style={S.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>Steps</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: total === 100 ? C.ok : C.bad }}>Total: {total} of 100 points</div>
              </div>
              {draft.steps.map((s, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '28px 1fr 74px', gap: 8, alignItems: 'start', padding: '12px 0', borderTop: `1px solid light-dark(${C.line}, #2a3439)` }}>
                  <div style={{ fontWeight: 700, paddingTop: 9 }}>{i + 1}</div>
                  <div style={{ display: 'grid', gap: 6 }}>
                    <textarea rows={2} value={s.label} onChange={e => setStep(i, { label: e.target.value })} aria-label={`Step ${i + 1}`} style={S.input} />
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', fontSize: 12.5, color: `light-dark(${C.soft}, #b3c1c7)` }}>
                      <select value={s.section} onChange={e => setStep(i, { section: e.target.value })} style={{ ...S.input, width: 'auto', padding: '5px 8px', fontSize: 12.5 }} aria-label="Part of the call">
                        {SECTIONS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                      </select>
                      <label style={{ display: 'flex', gap: 5, alignItems: 'center' }}><input type="checkbox" checked={!!s.allow_na} onChange={e => setStep(i, { allow_na: e.target.checked })} /> Can be skipped when it doesn’t apply</label>
                      {draft.steps.length > 3 && <button onClick={() => removeStep(i)} style={S.link}>Remove</button>}
                    </div>
                  </div>
                  <label style={{ display: 'grid', gap: 3, fontSize: 11.5, color: `light-dark(${C.soft}, #b3c1c7)` }}>Points
                    <input type="number" min="1" max="100" value={s.points} onChange={e => setStep(i, { points: e.target.value === '' ? '' : Number(e.target.value) })} style={{ ...S.input, padding: '8px' }} />
                  </label>
                </div>
              ))}
              {draft.steps.length < 8 && <button onClick={addStep} style={{ ...S.link, marginTop: 6 }}>+ Add a step</button>}
            </div>

            <div style={S.card}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Instructions for the scoring AI</div>
              <p style={{ ...S.sub, margin: '4px 0 8px' }}>What counts as a chance to win the outcome, what doesn’t, and rules your team must follow.</p>
              <textarea rows={6} value={draft.guidance} onChange={e => setDraft({ ...draft, guidance: e.target.value })} style={S.input} />
            </div>

            <div style={S.card}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Call outcomes</div>
              <p style={{ ...S.sub, margin: '4px 0 8px' }}>How your team marks how each call ended. “Booked”, “Callback set”, “No answer” and the other basics are added for you. One per line.</p>
              <label style={{ fontSize: 12, fontWeight: 600 }}>What to call a new customer who could book</label>
              <input value={draft.sales_label || ''} onChange={e => setDraft({ ...draft, sales_label: e.target.value })} style={{ ...S.input, margin: '4px 0 10px' }} />
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 240px' }}><label style={{ fontSize: 12, fontWeight: 600 }}>Why a new customer didn’t book</label>
                  <textarea rows={4} value={draft.not_booked_txt || ''} onChange={e => setDraft({ ...draft, not_booked_txt: e.target.value })} style={{ ...S.input, marginTop: 4 }} /></div>
                <div style={{ flex: '1 1 240px' }}><label style={{ fontSize: 12, fontWeight: 600 }}>Why existing customers call</label>
                  <textarea rows={4} value={draft.existing_txt || ''} onChange={e => setDraft({ ...draft, existing_txt: e.target.value })} style={{ ...S.input, marginTop: 4 }} /></div>
              </div>
            </div>

            {err && <div style={S.err}>{err}</div>}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button onClick={save} disabled={!!busy} style={S.primary}>{busy === 'save' ? 'Saving…' : 'Save and start scoring'}</button>
              <button onClick={() => { setDraft(null); setErr('') }} disabled={!!busy} style={S.secondary}>Back to the questions</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const S = {
  cap: { fontSize: 11, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: `light-dark(${C.soft}, #b3c1c7)` },
  sub: { fontSize: 14, lineHeight: 1.55, color: `light-dark(${C.soft}, #b3c1c7)`, margin: 0 },
  card: { background: `light-dark(${C.card}, #161d21)`, border: `1px solid light-dark(${C.line}, #2a3439)`, borderRadius: 14, padding: 20 },
  input: { width: '100%', boxSizing: 'border-box', border: `1px solid light-dark(#D9D4CA, #2a3439)`, borderRadius: 10, padding: '10px 12px', fontSize: 14, fontFamily: 'inherit', background: `light-dark(#fff, #0f1518)`, color: 'inherit', resize: 'vertical' },
  primary: { background: C.accent, color: '#fff', border: 'none', borderRadius: 10, padding: '11px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  secondary: { background: 'transparent', color: 'inherit', border: `1px solid light-dark(#D9D4CA, #2a3439)`, borderRadius: 10, padding: '11px 18px', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' },
  link: { background: 'none', border: 'none', padding: 0, color: `light-dark(${C.accent}, #9fd6bd)`, fontWeight: 600, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' },
  err: { color: `light-dark(${C.bad}, #e86464)`, fontSize: 13.5, marginTop: 10 },
}
