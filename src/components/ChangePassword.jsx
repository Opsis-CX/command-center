import { useState } from 'react'
import { supabase } from '../lib/supabase'
// ============================================================
// CHANGE PASSWORD
// Serves two purposes:
//   · forced   — shown as a full-screen gate when the person still
//                has the shared temporary password
//                (profiles.must_change_password = true)
//   · optional — opened from the sidebar as a modal any time
//
// Props:
//   forced   - true to render as a blocking full-screen gate
//   onClose  - called when an optional change is cancelled/finished
//   onDone   - called after a successful change
// ============================================================

const MIN_LENGTH = 8

export default function ChangePassword({ forced = false, onClose, onDone }) {
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)

  function validate() {
    if (pw.length < MIN_LENGTH) return `Use at least ${MIN_LENGTH} characters.`
    if (pw !== confirm) return "Those two passwords don't match."
    if (pw === 'Opsis2026!') return 'Please choose a different password than the temporary one.'
    return ''
  }

  async function save() {
    const v = validate()
    if (v) { setErr(v); return }
    setBusy(true); setErr('')
    try {
      // 1) update the auth password
      const { error: authErr } = await supabase.auth.updateUser({ password: pw })
      if (authErr) throw authErr
      // 2) clear the must-change flag on their profile
      const { data: { user } } = await supabase.auth.getUser()
      if (user?.id) {
        await supabase.from('profiles').update({ must_change_password: false }).eq('id', user.id)
      }
      setDone(true)
      if (onDone) setTimeout(() => onDone(), 900)
    } catch (e) {
      setErr(e.message || 'Could not update your password.')
    } finally { setBusy(false) }
  }

  const body = (
    <>
      <h2 style={{ margin: '0 0 6px', fontSize: forced ? 21 : 18, fontWeight: 700 }}>
        {forced ? 'Choose your password' : 'Change password'}
      </h2>
      <p className="page-sub" style={{ marginBottom: 18, lineHeight: 1.55 }}>
        {forced
          ? "You're using a temporary password that was shared with the team. Please set your own before continuing."
          : 'Pick something you don\'t use anywhere else.'}
      </p>

      {err && <div className="login-err" style={{ marginBottom: 14 }}>{err}</div>}
      {done && (
        <div style={{ background: 'var(--passed-bg)', color: 'var(--passed)', borderRadius: 8, padding: '10px 12px', fontSize: 13, marginBottom: 14, fontWeight: 600 }}>
          ✓ Password updated
        </div>
      )}

      <div className="field">
        <label>New password</label>
        <input type={show ? 'text' : 'password'} value={pw} autoFocus
          onChange={e => { setPw(e.target.value); setErr('') }}
          onKeyDown={e => { if (e.key === 'Enter') save() }}
          placeholder={`At least ${MIN_LENGTH} characters`} disabled={busy || done} />
      </div>
      <div className="field">
        <label>Confirm new password</label>
        <input type={show ? 'text' : 'password'} value={confirm}
          onChange={e => { setConfirm(e.target.value); setErr('') }}
          onKeyDown={e => { if (e.key === 'Enter') save() }}
          placeholder="Type it again" disabled={busy || done} />
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink-soft)', marginBottom: 18, cursor: 'pointer' }}>
        <input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} />
        Show password
      </label>

      <div style={{ display: 'flex', gap: 10 }}>
        {!forced && (
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onClose} disabled={busy}>Cancel</button>
        )}
        <button className="btn btn-primary" style={{ flex: forced ? 1 : 1 }} onClick={save} disabled={busy || done}>
          {busy ? 'Saving…' : done ? 'Saved' : forced ? 'Set password and continue' : 'Update password'}
        </button>
      </div>
    </>
  )

  // Forced: a full-screen gate they can't dismiss.
  if (forced) {
    return (
      <div className="login-wrap">
        <div className="login-card">{body}</div>
      </div>
    )
  }

  // Optional: a normal modal.
  return (
    <div className="modal-back open" onClick={e => { if (e.target.classList.contains('modal-back')) onClose && onClose() }}>
      <div className="modal" style={{ width: 400 }}>{body}</div>
    </div>
  )
}
