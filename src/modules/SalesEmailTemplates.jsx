import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { MERGE_FIELDS, sendSalesEmail, invalidateSalesEmailCache, variantLabel,
         useSalesLists, withCurrent } from '../lib/salesEmails'

// ============================================================================
//  SALES EMAIL TEMPLATES
// ============================================================================
//  Edit the subject and body of every sales stage email, turn each one on or
//  off, preview it, and send yourself a test — without a deploy.
//
//  An email only leaves when its template is ON. While it's off the board says
//  nothing about sending and doesn't stamp the deal as emailed, so "we emailed
//  them" always means someone actually did.
//
//  Marketing and Admin can edit (enforced by RLS on sales_email_templates and
//  again inside the send-sales-email function).
// ============================================================================

// The verticals and service lines a version can be written for now come from
// `sales_verticals` / `sales_service_lines` — see useSalesLists. They used to be
// hardcoded here AND in PipelineBoard.jsx AND enforced by a CHECK constraint, so
// adding one took a migration and a deploy. That is what blocked Corinne on
// 2026-08-31 with two emails written and nowhere to file them.

const STAGE_TITLE = {
  email_1_sent: 'Email 1 Sent',
  email_2_sent: 'Email 2 Sent',
  proposal_sent: 'Proposal Sent',
  contract_sent: 'Contract Sent',
  won: 'Won',
}

export default function SalesEmailTemplates({ onClose, onSaved }) {
  const { appRole, isAdmin } = useAuth()
  const canEdit = isAdmin || ['admin', 'marketing'].includes(String(appRole || '').toLowerCase())
  const { verticals: VERTICALS, serviceLines: SERVICE_LINES, reload: reloadLists } = useSalesLists()
  const [managing, setManaging] = useState(false)

  const [rows, setRows] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [draft, setDraft] = useState(null)         // working copy of the active row
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [flash, setFlash] = useState('')
  const [preview, setPreview] = useState(null)     // { subject, html }
  const [testing, setTesting] = useState(false)
  const bodyRef = useRef(null)
  const subjectRef = useRef(null)
  const lastFocused = useRef('body')

  useEffect(() => {
    let cancel = false
    supabase.from('sales_email_templates')
      .select('*').order('sort_order', { ascending: true })
      .then(({ data, error }) => {
        if (cancel) return
        if (error) setErr(error.message)
        else {
          setRows(data || [])
          if (data && data.length) { setActiveId(data[0].id); setDraft({ ...data[0] }) }
        }
        setLoading(false)
      })
    return () => { cancel = true }
  }, [])

  const active = useMemo(() => rows.find(r => r.id === activeId) || null, [rows, activeId])
  const dirty = !!draft && !!active && (
    draft.subject !== active.subject ||
    draft.body_html !== active.body_html ||
    draft.enabled !== active.enabled ||
    (draft.industry || null) !== (active.industry || null) ||
    (draft.audience || null) !== (active.audience || null) ||
    (draft.variant_name || '') !== (active.variant_name || '')
  )

  // Stages, each holding its versions. The default (no vertical, no service
  // line) sorts first — it is the one everything else falls back to.
  const groups = useMemo(() => {
    const by = new Map()
    for (const r of rows) {
      if (!by.has(r.kind)) by.set(r.kind, { kind: r.kind, label: r.label, stage_key: r.stage_key, items: [] })
      by.get(r.kind).items.push(r)
    }
    for (const g of by.values()) {
      g.items.sort((a, b) =>
        (a.industry || a.audience ? 1 : 0) - (b.industry || b.audience ? 1 : 0) ||
        variantLabel(a).localeCompare(variantLabel(b)))
    }
    return [...by.values()]
  }, [rows])

  function pick(id) {
    if (dirty && !window.confirm('You have unsaved changes to this version. Discard them?')) return
    const row = rows.find(r => r.id === id)
    setActiveId(id); setDraft(row ? { ...row } : null)
    setPreview(null); setFlash(''); setErr('')
  }

  // A new version starts as a copy of the one you are looking at, switched off,
  // so it cannot start sending before you have written it.
  //
  // It is created against the first vertical that does not already have a
  // version of this email — NOT against no vertical at all. The old code did the
  // latter, which collided with the stage's existing default on
  // `sales_email_templates_slot_idx` every single time: every stage has a
  // default, so "+ Add version" raised a duplicate-key error and created
  // nothing, on every stage. That is the bug Corinne hit ("I can't figure out
  // how to add more options on the left side") — the button never worked.
  async function addVersion() {
    if (!draft || !canEdit) return
    const taken = new Set(rows.filter(r => r.kind === draft.kind && r.industry).map(r => r.industry))
    const free = VERTICALS.find(v => !taken.has(v))
    if (!free) {
      setErr('Every vertical already has a version of this email. Add a new vertical first, or edit an existing version.')
      return
    }
    setSaving(true); setErr(''); setFlash('')
    const { id, updated_at, updated_by, ...rest } = draft
    const { data, error } = await supabase.from('sales_email_templates')
      .insert({ ...rest, enabled: false, is_default: false, industry: free, audience: null,
                variant_name: free, updated_at: new Date().toISOString() })
      .select().single()
    setSaving(false)
    if (error) {
      setErr(error.message.includes('duplicate key')
        ? 'There is already a version of this email with no vertical and no service line. Set one on the new version first.'
        : error.message)
      return
    }
    setRows(prev => [...prev, data]); setActiveId(data.id); setDraft({ ...data })
    invalidateSalesEmailCache()
    setFlash(`New version created for ${free}, switched off. Change the vertical if you meant a different one, then write the copy.`)
  }

  async function deleteVersion() {
    if (!draft || !canEdit) return
    if (!draft.industry && !draft.audience) { setErr('This is the fallback version for the stage — it cannot be deleted.'); return }
    if (!window.confirm(`Delete the "${variantLabel(draft)}" version of the ${draft.label}? Deals in that vertical will fall back to the default.`)) return
    setSaving(true); setErr('')
    const { error } = await supabase.from('sales_email_templates').delete().eq('id', draft.id)
    setSaving(false)
    if (error) { setErr(error.message); return }
    const next = rows.filter(r => r.id !== draft.id)
    setRows(next)
    const fallback = next.find(r => r.kind === draft.kind) || next[0] || null
    setActiveId(fallback?.id || null); setDraft(fallback ? { ...fallback } : null)
    invalidateSalesEmailCache()
    setFlash('Version deleted.')
  }

  // Drop a merge field in at the cursor of whichever field was last focused.
  function insertField(token) {
    const which = lastFocused.current
    const el = which === 'subject' ? subjectRef.current : bodyRef.current
    const key = which === 'subject' ? 'subject' : 'body_html'
    if (!el) { setDraft(d => ({ ...d, [key]: (d[key] || '') + token })); return }
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? el.value.length
    const next = el.value.slice(0, start) + token + el.value.slice(end)
    setDraft(d => ({ ...d, [key]: next }))
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + token.length, start + token.length)
    })
  }

  async function save() {
    if (!draft || !canEdit) return
    setSaving(true); setErr(''); setFlash('')
    // By id, not by kind. A stage now holds several versions, and updating by
    // kind would overwrite every one of them with this one's copy.
    const { data, error } = await supabase.from('sales_email_templates')
      .update({
        subject: draft.subject, body_html: draft.body_html, enabled: draft.enabled,
        industry: draft.industry || null, audience: draft.audience || null,
        variant_name: (draft.variant_name || '').trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', draft.id).select().single()
    setSaving(false)
    if (error) {
      setErr(error.message.includes('duplicate key')
        ? 'Another version of this email already covers that vertical and service line. Pick a different one.'
        : error.message)
      return
    }
    setRows(prev => prev.map(r => r.id === data.id ? data : r))
    setDraft({ ...data })
    invalidateSalesEmailCache()
    onSaved?.()
    setFlash(data.enabled
      ? `Saved. Moving a deal to “${STAGE_TITLE[data.stage_key] || data.stage_key}” now emails the contact.`
      : 'Saved. This email stays off — moving a deal to that stage sends nothing.')
  }

  async function doPreview() {
    if (!draft) return
    setErr(''); setFlash('')
    // Preview the unsaved draft by saving nothing: the function renders from
    // the stored row, so preview what's stored and tell them if it's stale.
    const res = await sendSalesEmail(draft.kind, '', {}, 'preview', draft.id)
    if (res.error) { setErr(res.error); return }
    setPreview({ subject: res.subject, html: res.html })
  }

  async function sendTest() {
    if (!draft) return
    setErr(''); setFlash(''); setTesting(true)
    const res = await sendSalesEmail(draft.kind, '', {}, 'test', draft.id)
    setTesting(false)
    if (res.error) { setErr(res.error); return }
    if (!res.sent) { setErr(res.reason || 'Nothing was sent.'); return }
    setFlash(`Test sent to you (${res.to || 'your address'}). Nobody was CC'd.`)
  }

  const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 200, display: 'grid', placeItems: 'center', padding: 16 }
  const box = { width: 940, maxWidth: '100%', maxHeight: '92vh', display: 'flex', flexDirection: 'column', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, boxShadow: '0 18px 50px rgba(0,0,0,.25)', overflow: 'hidden' }
  const input = { width: '100%', border: '1px solid var(--line)', borderRadius: 8, padding: '9px 11px', fontSize: 13.5, fontFamily: 'inherit', background: 'var(--canvas)', color: 'var(--ink)' }
  const label = { fontSize: 11.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: 5 }

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }} style={overlay}>
      <div style={box}>
        {/* header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>Stage emails</h3>
            <p style={{ margin: '3px 0 0', fontSize: 12.5, color: 'var(--ink-soft)' }}>
              An email goes out only when it's switched on here. Off means the board sends nothing and says nothing.
            </p>
          </div>
          <button onClick={onClose} style={{ border: 0, background: 'transparent', cursor: 'pointer', fontSize: 22, color: 'var(--ink-soft)', lineHeight: 1 }}>×</button>
        </div>

        {loading ? (
          <div style={{ padding: 40, fontSize: 13.5, color: 'var(--ink-soft)' }}>Loading templates…</div>
        ) : (
          <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
            {/* list */}
            <div style={{ width: 226, flex: 'none', borderRight: '1px solid var(--line)', overflowY: 'auto', background: 'var(--canvas)' }}>
              {groups.map(g => (
                <div key={g.kind}>
                  <div style={{ padding: '12px 14px 5px', fontSize: 11, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>
                    {g.label} <span style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>· {STAGE_TITLE[g.stage_key] || g.stage_key}</span>
                  </div>
                  {g.items.map(r => {
                    const on = activeId === r.id
                    const isFallback = !r.industry && !r.audience
                    return (
                      <button key={r.id} onClick={() => pick(r.id)}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
                          border: 0, borderLeft: on ? '3px solid var(--accent)' : '3px solid transparent',
                          background: on ? 'var(--surface)' : 'transparent',
                          padding: '8px 14px 8px 20px',
                        }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', flex: 'none', background: r.enabled ? '#16A34A' : 'var(--line)' }} />
                          <span style={{ fontSize: 13, fontWeight: on ? 700 : 600, color: 'var(--ink)' }}>{variantLabel(r)}</span>
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 1, paddingLeft: 14 }}>
                          {r.enabled ? 'On' : 'Off'}{isFallback ? ' · everyone else' : ''}
                        </div>
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>

            {/* editor */}
            <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: 20 }}>
              {!draft ? (
                <p style={{ fontSize: 13.5, color: 'var(--ink-soft)' }}>Pick an email on the left.</p>
              ) : (
                <>
                  {err && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, marginBottom: 14 }}>{err}</div>}
                  {flash && <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', color: '#065F46', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, marginBottom: 14 }}>{flash}</div>}

                  <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--ink-soft)' }}>{draft.help}</p>

                  {/* Who this version is for. The most specific match wins, and a
                      vertical beats a service line — see pickTemplate(). */}
                  <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '14px 15px', marginBottom: 18, background: 'var(--canvas)' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
                      <b style={{ fontSize: 13.5 }}>Who gets this version</b>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={addVersion} disabled={!canEdit || saving}
                          style={{ border: '1px solid var(--line)', borderRadius: 7, background: 'var(--surface)', color: 'var(--ink)', fontSize: 12.5, fontWeight: 600, padding: '5px 11px', cursor: canEdit ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
                          ＋ Add a version
                        </button>
                        {canEdit && (
                          <button onClick={() => setManaging(true)} title="Add or hide the verticals and service lines these dropdowns offer"
                            style={{ border: '1px solid var(--line)', borderRadius: 7, background: 'var(--surface)', color: 'var(--ink)', fontSize: 12.5, fontWeight: 600, padding: '5px 11px', cursor: 'pointer', fontFamily: 'inherit' }}>
                            ⚙ Manage lists
                          </button>
                        )}
                        {(draft.industry || draft.audience) && (
                          <button onClick={deleteVersion} disabled={!canEdit || saving}
                            style={{ border: '1px solid var(--line)', borderRadius: 7, background: 'var(--surface)', color: 'var(--failed, #DC2626)', fontSize: 12.5, fontWeight: 600, padding: '5px 11px', cursor: canEdit ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
                            Delete
                          </button>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
                      <div style={{ marginBottom: 10 }}>
                        <label style={label}>Vertical</label>
                        <select value={draft.industry || ''} disabled={!canEdit}
                          onChange={e => setDraft(d => ({ ...d, industry: e.target.value || null }))} style={input}>
                          <option value="">Any vertical (the fallback)</option>
                          {withCurrent(VERTICALS, draft.industry).map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                      </div>
                      <div style={{ marginBottom: 10 }}>
                        <label style={label}>Service line</label>
                        <select value={draft.audience || ''} disabled={!canEdit}
                          onChange={e => setDraft(d => ({ ...d, audience: e.target.value || null }))} style={input}>
                          <option value="">Any service line</option>
                          {withCurrent(SERVICE_LINES, draft.audience).map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                      </div>
                      <div style={{ gridColumn: '1 / -1' }}>
                        <label style={label}>Name this version</label>
                        <input value={draft.variant_name || ''} disabled={!canEdit} placeholder="Church / Faith"
                          onChange={e => setDraft(d => ({ ...d, variant_name: e.target.value }))} style={input} />
                      </div>
                    </div>

                    <p style={{ margin: '11px 0 0', fontSize: 12.5, color: 'var(--ink-soft)' }}>
                      {draft.industry
                        ? <>Only deals whose vertical is <b>{draft.industry}</b>{draft.audience ? <> and whose service line is <b>{draft.audience}</b></> : null} get this one.</>
                        : draft.audience
                          ? <>Deals whose service line is <b>{draft.audience}</b> get this one, whatever their vertical.</>
                          : <>This is the fallback — it goes to any deal no other version covers. Leave it general.</>}
                      {' '}The most specific match wins, and a vertical beats a service line.
                    </p>
                  </div>

                  {/* the switch */}
                  <div style={{
                    display: 'flex', alignItems: 'flex-start', gap: 11, padding: '12px 14px', marginBottom: 18,
                    border: '1px solid var(--line)', borderRadius: 10,
                    background: draft.enabled ? 'rgba(22,163,74,.08)' : 'var(--canvas)',
                  }}>
                    <input id="tpl-enabled" type="checkbox" checked={!!draft.enabled} disabled={!canEdit}
                      onChange={e => setDraft(d => ({ ...d, enabled: e.target.checked }))}
                      style={{ marginTop: 3, width: 16, height: 16, cursor: canEdit ? 'pointer' : 'not-allowed' }} />
                    <label htmlFor="tpl-enabled" style={{ cursor: canEdit ? 'pointer' : 'not-allowed', fontSize: 13.5 }}>
                      <b>Send this email automatically</b>
                      <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 2 }}>
                        {draft.enabled
                          ? <>Moving a deal to <b>{STAGE_TITLE[draft.stage_key] || draft.stage_key}</b> emails the contact and asks you to confirm first.</>
                          : <>Moving a deal to <b>{STAGE_TITLE[draft.stage_key] || draft.stage_key}</b> just moves it. No email, no confirmation, no “last emailed” stamp.</>}
                      </div>
                    </label>
                  </div>

                  <div style={{ marginBottom: 14 }}>
                    <label style={label}>Subject</label>
                    <input ref={subjectRef} value={draft.subject || ''} disabled={!canEdit}
                      onFocus={() => { lastFocused.current = 'subject' }}
                      onChange={e => setDraft(d => ({ ...d, subject: e.target.value }))}
                      style={input} />
                  </div>

                  <div style={{ marginBottom: 10 }}>
                    <label style={label}>
                      {draft.kind === 'proposal' ? 'Note above the proposal (optional)' : 'Body'}
                    </label>
                    <textarea ref={bodyRef} value={draft.body_html || ''} disabled={!canEdit}
                      onFocus={() => { lastFocused.current = 'body' }}
                      onChange={e => setDraft(d => ({ ...d, body_html: e.target.value }))}
                      placeholder={draft.kind === 'proposal'
                        ? 'Leave empty to send the proposal on its own, exactly as it goes out today.'
                        : '<p>Hi {{first_name}},</p>'}
                      style={{ ...input, minHeight: 210, resize: 'vertical', lineHeight: 1.55, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12.5 }} />
                    <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 5 }}>
                      Written as HTML — wrap each paragraph in <code>&lt;p&gt;…&lt;/p&gt;</code>. The OpsisCX header, the
                      “Book a Discovery Call” button and the sign-off are added around it automatically.
                    </div>
                  </div>

                  {/* merge fields */}
                  <div style={{ marginBottom: 20 }}>
                    <label style={label}>Insert</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {MERGE_FIELDS.map(f => (
                        <button key={f.token} onClick={() => insertField(f.token)} disabled={!canEdit} title={f.hint}
                          style={{
                            border: '1px solid var(--line)', borderRadius: 999, background: 'var(--canvas)', color: 'var(--ink)',
                            fontSize: 12, fontFamily: 'ui-monospace, Menlo, monospace', padding: '4px 10px',
                            cursor: canEdit ? 'pointer' : 'not-allowed',
                          }}>
                          {f.token}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* actions */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 9, alignItems: 'center', borderTop: '1px solid var(--line)', paddingTop: 16 }}>
                    <button onClick={save} disabled={!canEdit || !dirty || saving}
                      style={{
                        border: 0, borderRadius: 8, background: dirty ? 'var(--accent)' : 'var(--line)',
                        color: dirty ? '#fff' : 'var(--ink-soft)', fontSize: 13.5, fontWeight: 700,
                        padding: '9px 16px', cursor: (canEdit && dirty && !saving) ? 'pointer' : 'default', fontFamily: 'inherit',
                      }}>
                      {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
                    </button>
                    <button onClick={doPreview}
                      style={{ border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface)', color: 'var(--ink)', fontSize: 13.5, fontWeight: 700, padding: '9px 14px', cursor: 'pointer', fontFamily: 'inherit' }}>
                      Preview
                    </button>
                    <button onClick={sendTest} disabled={testing}
                      style={{ border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface)', color: 'var(--ink)', fontSize: 13.5, fontWeight: 700, padding: '9px 14px', cursor: 'pointer', fontFamily: 'inherit' }}>
                      {testing ? 'Sending…' : 'Send me a test'}
                    </button>
                    {dirty && <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Save first — preview and test read the saved version.</span>}
                  </div>

                  {preview && (
                    <div style={{ marginTop: 18, border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
                      <div style={{ padding: '9px 13px', borderBottom: '1px solid var(--line)', background: 'var(--canvas)', fontSize: 12.5 }}>
                        <b>Subject:</b> {preview.subject}
                      </div>
                      <iframe title="Email preview" srcDoc={preview.html} sandbox=""
                        style={{ width: '100%', height: 460, border: 0, background: '#fff', display: 'block' }} />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {managing && (
          <ManageSalesLists
            onClose={() => setManaging(false)}
            onSaved={() => { reloadLists(); }}
          />
        )}
      </div>
    </div>
  )
}

// ============================================================================
//  MANAGE LISTS — verticals and service lines, without a deploy
// ============================================================================
//  The list a version can be written for is now data (`sales_verticals` /
//  `sales_service_lines`), referenced by foreign keys from deals and templates.
//  So the database still refuses a value nobody defined — but defining one is a
//  row, and this is the screen that adds it.
//
//  Deactivate, don't delete. A vertical in use is protected by the foreign key
//  and the delete will be refused; deactivating hides it from the dropdowns
//  while leaving every deal that already carries it intact.
export function ManageSalesLists({ onClose, onSaved }) {
  const { appRole, isAdmin } = useAuth()
  const canEdit = isAdmin || ['admin', 'marketing'].includes(String(appRole || '').toLowerCase())
  const [tab, setTab] = useState('verticals')
  const [rows, setRows] = useState([])
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [flash, setFlash] = useState('')

  const table = tab === 'verticals' ? 'sales_verticals' : 'sales_service_lines'
  const noun = tab === 'verticals' ? 'vertical' : 'service line'

  const load = async () => {
    const { data, error } = await supabase.from(table).select('*').order('sort_order')
    if (error) { setErr(error.message); return }
    setRows(data || []); setErr('')
  }
  useEffect(() => { load() }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  async function add() {
    const clean = label.trim()
    if (!clean || !canEdit) return
    setBusy(true); setErr(''); setFlash('')
    const next = Math.max(0, ...rows.map(r => r.sort_order || 0)) + 10
    const { error } = await supabase.from(table).insert({ label: clean, sort_order: next })
    setBusy(false)
    if (error) {
      setErr(error.message.includes('duplicate key')
        ? `“${clean}” is already on the list.` : error.message)
      return
    }
    setLabel(''); setFlash(`Added “${clean}”. It is selectable everywhere now.`)
    await load(); onSaved?.()
  }

  async function toggle(row) {
    if (!canEdit) return
    setBusy(true); setErr('')
    const { error } = await supabase.from(table).update({ is_active: !row.is_active }).eq('label', row.label)
    setBusy(false)
    if (error) { setErr(error.message); return }
    await load(); onSaved?.()
  }

  async function remove(row) {
    if (!canEdit) return
    if (!window.confirm(`Delete “${row.label}” from the ${noun} list?\n\nIf any deal or email version still uses it this will be refused — deactivate it instead.`)) return
    setBusy(true); setErr(''); setFlash('')
    const { error } = await supabase.from(table).delete().eq('label', row.label)
    setBusy(false)
    if (error) {
      // 23503 = foreign_key_violation. Say what it means, not what Postgres said.
      setErr(error.code === '23503' || /foreign key/i.test(error.message)
        ? `“${row.label}” is still in use by at least one deal or email version, so it can't be deleted. Switch it off instead — that hides it from the dropdowns without touching those records.`
        : error.message)
      return
    }
    setFlash(`Deleted “${row.label}”.`)
    await load(); onSaved?.()
  }

  const btn = { border: '1px solid var(--line)', borderRadius: 8, background: 'var(--canvas)', color: 'var(--ink)', fontSize: 12.5, fontWeight: 700, padding: '6px 11px', cursor: 'pointer', fontFamily: 'inherit' }
  const td = { padding: '9px 10px', borderTop: '1px solid var(--line)', fontSize: 13.5 }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 70, padding: 24, overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: 14, width: 'min(560px, 100%)', padding: 20, color: 'var(--ink)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <h2 style={{ fontSize: 17, fontWeight: 800, margin: 0, flex: 1 }}>Manage lists</h2>
          <button onClick={onClose} style={btn}>Close</button>
        </div>
        <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: '0 0 14px' }}>
          What you can write an email version for, and what a lead can be tagged as. Adding here takes effect everywhere immediately.
        </p>

        <div style={{ display: 'inline-flex', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden', marginBottom: 14 }}>
          {[['verticals', 'Verticals — who we sell to'], ['service', 'Service lines — what we sell']].map(([k, t]) => (
            <button key={k} onClick={() => setTab(k)}
              style={{ border: 0, background: tab === k ? 'var(--accent)' : 'var(--surface)', color: tab === k ? '#fff' : 'var(--ink)', fontSize: 12.5, fontWeight: 700, padding: '7px 12px', cursor: 'pointer', fontFamily: 'inherit' }}>
              {t}
            </button>
          ))}
        </div>

        {err && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', borderRadius: 8, padding: '9px 12px', fontSize: 13, marginBottom: 12 }}>{err}</div>}
        {flash && <div style={{ background: '#e8f5e9', border: '1px solid #c8e6c9', color: '#1b5e20', borderRadius: 8, padding: '9px 12px', fontSize: 13, marginBottom: 12 }}>{flash}</div>}

        {canEdit && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <input value={label} onChange={e => setLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') add() }}
              placeholder={tab === 'verticals' ? 'e.g. Call Center' : 'e.g. Overflow Support'}
              style={{ flex: 1, border: '1px solid var(--line)', borderRadius: 8, padding: '8px 11px', fontSize: 13.5, background: 'var(--canvas)', color: 'var(--ink)', fontFamily: 'inherit' }} />
            <button onClick={add} disabled={busy || !label.trim()}
              style={{ ...btn, background: 'var(--accent)', color: '#fff', border: 0, opacity: busy || !label.trim() ? .5 : 1 }}>
              Add {noun}
            </button>
          </div>
        )}

        <div style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {rows.map(r => (
                <tr key={r.label}>
                  <td style={{ ...td, fontWeight: r.is_active ? 600 : 400, color: r.is_active ? 'var(--ink)' : 'var(--ink-soft)' }}>
                    {r.label}
                    {!r.is_active && <span style={{ fontSize: 11.5, marginLeft: 8, color: 'var(--ink-soft)' }}>· hidden</span>}
                  </td>
                  <td style={{ ...td, width: 190, textAlign: 'right' }}>
                    {canEdit && (
                      <>
                        <button onClick={() => toggle(r)} disabled={busy} style={{ ...btn, marginRight: 6 }}>
                          {r.is_active ? 'Switch off' : 'Switch on'}
                        </button>
                        <button onClick={() => remove(r)} disabled={busy} style={{ ...btn, color: '#B91C1C' }}>Delete</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td style={{ ...td, color: 'var(--ink-soft)', textAlign: 'center', padding: 20 }}>Nothing on this list yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
