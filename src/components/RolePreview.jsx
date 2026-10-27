import React, { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { getPreview, clearPreview, isPreviewing, loadPreviewAccounts, enterPreview, exitPreview } from '../lib/rolePreview'

// ---- Topbar "View as" menu (admins only, when not already previewing) ----
export function ViewAsMenu() {
  const { isAdmin, user } = useAuth()
  const [open, setOpen] = useState(false)
  const [accounts, setAccounts] = useState(null)
  const [busy, setBusy] = useState(null)

  useEffect(() => {
    if (!open || accounts) return
    loadPreviewAccounts().then(setAccounts)
  }, [open, accounts])

  if (!isAdmin || isPreviewing(user?.id)) return null

  const pick = async (a) => {
    setBusy(a.role_key)
    try { await enterPreview(a.role_key) } catch (e) { window.alert(e.message); setBusy(null) }
  }

  return (
    <div style={{ position: 'relative' }}>
      <button className="btn btn-ghost" onClick={() => setOpen(o => !o)} title="See the app as another role"
        style={{ padding: '5px 10px', fontSize: 12.5, whiteSpace: 'nowrap' }}>👁 View as ▾</button>
      {open && (<>
        <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 80 }} />
        <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', width: 250, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,.18)', zIndex: 81, padding: '6px 0' }}>
          <div className="page-sub" style={{ padding: '4px 12px 8px', fontSize: 11.5 }}>
            Switch into that role's test account. You'll see exactly what they see.
          </div>
          {!accounts && <div className="page-sub" style={{ padding: '6px 12px', fontSize: 12.5 }}>Loading…</div>}
          {(accounts || []).map(a => (
            <button key={a.role_key} disabled={!!busy} onClick={() => pick(a)}
              style={{ display: 'block', width: '100%', textAlign: 'left', border: 0, background: 'transparent', padding: '8px 12px', fontSize: 13, cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit', color: 'var(--ink)' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--canvas)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
              {busy === a.role_key ? 'Switching…' : a.label}
            </button>
          ))}
        </div>
      </>)}
    </div>
  )
}

// ---- Floating "Viewing as" bar, shown in every shell while previewing ----
export function RolePreviewPill() {
  const { user } = useAuth()
  const [busy, setBusy] = useState(false)
  const p = getPreview()

  // Stale preview (e.g. the test account signed out, or someone logged in
  // normally): forget it so the bar never shows on a real account.
  useEffect(() => {
    if (p && user?.id && p.targetId && p.targetId !== user.id) clearPreview()
  }, [user?.id])

  if (!user || !isPreviewing(user.id)) return null

  const back = async () => { setBusy(true); await exitPreview() }
  const switchTo = async (key) => {
    if (!key || key === p.roleKey) return
    setBusy(true)
    try { await enterPreview(key) } catch (e) { window.alert(e.message); setBusy(false) }
  }

  return (
    <div role="status" style={{ position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 9999, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 'calc(100vw - 24px)', background: '#7C3AED', color: '#fff', padding: '6px 8px 6px 14px', borderRadius: 999, boxShadow: '0 8px 24px rgba(0,0,0,.25)', fontSize: 13, fontFamily: 'inherit' }}>
      <span>👁 Viewing as <b>{p.label}</b> <span style={{ opacity: .8 }}>({p.name})</span></span>
      {Array.isArray(p.accounts) && p.accounts.length > 1 && (
        <select disabled={busy} value={p.roleKey} onChange={e => switchTo(e.target.value)}
          style={{ border: '1px solid rgba(255,255,255,.4)', background: 'rgba(255,255,255,.15)', color: '#fff', borderRadius: 999, padding: '3px 8px', fontSize: 12.5, fontFamily: 'inherit' }}>
          {p.accounts.map(a => <option key={a.role_key} value={a.role_key} style={{ color: '#000' }}>{a.label}</option>)}
        </select>
      )}
      <button onClick={back} disabled={busy}
        style={{ border: 0, background: '#fff', color: '#5B21B6', borderRadius: 999, padding: '4px 12px', fontWeight: 700, fontSize: 12.5, cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
        {busy ? 'Switching…' : `Return to ${String(p.admin?.name || 'my account').split(' ')[0]}`}
      </button>
    </div>
  )
}
