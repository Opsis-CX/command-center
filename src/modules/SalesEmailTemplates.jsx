import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { MERGE_FIELDS, sendSalesEmail, invalidateSalesEmailCache } from '../lib/salesEmails'

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

  const [rows, setRows] = useState([])
  const [activeKind, setActiveKind] = useState(null)
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
          if (data && data.length) { setActiveKind(data[0].kind); setDraft({ ...data[0] }) }
        }
        setLoading(false)
      })
    return () => { cancel = true }
  }, [])

  const active = useMemo(() => rows.find(r => r.kind === activeKind) || null, [rows, activeKind])
  const dirty = !!draft && !!active && (
    draft.subject !== active.subject ||
    draft.body_html !== active.body_html ||
    draft.enabled !== active.enabled
  )

  function pick(kind) {
    if (dirty && !window.confirm('You have unsaved changes to this email. Discard them?')) return
    const row = rows.find(r => r.kind === kind)
    setActiveKind(kind); setDraft(row ? { ...row } : null)
    setPreview(null); setFlash(''); setErr('')
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
    const { data, error } = await supabase.from('sales_email_templates')
      .update({ subject: draft.subject, body_html: draft.body_html, enabled: draft.enabled })
      .eq('kind', draft.kind).select().single()
    setSaving(false)
    if (error) { setErr(error.message); return }
    setRows(prev => prev.map(r => r.kind === data.kind ? data : r))
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
    const res = await sendSalesEmail(draft.kind, '', {}, 'preview')
    if (res.error) { setErr(res.error); return }
    setPreview({ subject: res.subject, html: res.html })
  }

  async function sendTest() {
    if (!draft) return
    setErr(''); setFlash(''); setTesting(true)
    const res = await sendSalesEmail(draft.kind, '', {}, 'test')
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
              {rows.map(r => {
                const on = activeKind === r.kind
                return (
                  <button key={r.kind} onClick={() => pick(r.kind)}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
                      border: 0, borderLeft: on ? '3px solid var(--accent)' : '3px solid transparent',
                      background: on ? 'var(--surface)' : 'transparent',
                      padding: '11px 14px',
                    }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', flex: 'none', background: r.enabled ? '#16A34A' : 'var(--line)' }} />
                      <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink)' }}>{r.label}</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 2, paddingLeft: 14 }}>
                      {r.enabled ? 'On' : 'Off'} · {STAGE_TITLE[r.stage_key] || r.stage_key}
                    </div>
                  </button>
                )
              })}
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
      </div>
    </div>
  )
}
