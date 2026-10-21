import { supabase } from './supabase'

// ============================================================
// Admin "View as role"
//
// An admin picks a role; the role-preview edge function hands back a one-time
// sign-in token for that role's TEST account, and we sign into it for real —
// same UI, same database security, exactly as if they'd logged in themselves.
// The admin's own session is kept aside here so "Return" puts them back
// without a password.
//
// Only accounts listed in public.role_preview_accounts can be switched into,
// only admins can do it, and every switch is logged (public.role_preview_log).
// ============================================================

const KEY = 'cc.rolePreview'

export function getPreview() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null') } catch { return null }
}
function setPreview(v) {
  try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY) } catch { /* ignore */ }
}
export function clearPreview() { setPreview(null) }

// True only while the signed-in user IS the test account we switched into.
export function isPreviewing(userId) {
  const p = getPreview()
  return !!(p && userId && p.targetId === userId)
}

async function callFn(body) {
  const { data, error } = await supabase.functions.invoke('role-preview', { body })
  if (error) {
    let msg = error.message
    try { const j = await error.context?.json?.(); if (j?.error) msg = j.error } catch { /* ignore */ }
    throw new Error(msg)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

// Put the admin's own session back.
async function restoreAdmin(saved) {
  if (!saved?.admin?.refresh_token) throw new Error('Your admin session was not saved — please sign in again.')
  // End the test-account session on the server, then re-attach the admin one.
  try { await supabase.auth.signOut({ scope: 'local' }) } catch { /* ignore */ }
  const { error } = await supabase.auth.setSession({
    access_token: saved.admin.access_token,
    refresh_token: saved.admin.refresh_token,
  })
  if (error) throw new Error('Your admin session expired — please sign in again.')
}

// Load the switchable roles (admins only; RLS returns nothing for anyone else).
export async function loadPreviewAccounts() {
  const { data } = await supabase.from('role_preview_accounts')
    .select('role_key, label').order('sort_order')
  return data || []
}

export async function enterPreview(roleKey) {
  const saved = getPreview()
  let accounts = saved?.accounts
  // Already viewing as another role → go back to the admin first.
  if (saved) await restoreAdmin(saved)

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')
  if (!accounts) accounts = await loadPreviewAccounts()

  let admin = saved?.admin
  if (!admin) {
    const { data: me } = await supabase.from('profiles').select('full_name').eq('id', session.user.id).maybeSingle()
    admin = { id: session.user.id, name: me?.full_name || 'Admin' }
  }
  // Always save the freshest admin tokens.
  admin = { ...admin, access_token: session.access_token, refresh_token: session.refresh_token }

  const res = await callFn({ action: 'enter', role_key: roleKey })

  // Save BEFORE switching so a crash mid-switch can still get back.
  setPreview({ admin, accounts, roleKey, label: res.label, name: res.name, targetId: null })
  const { data: v, error } = await supabase.auth.verifyOtp({ token_hash: res.token_hash, type: 'magiclink' })
  if (error || !v?.user) {
    try { await restoreAdmin({ admin }) } catch { /* fall through */ }
    setPreview(null)
    throw new Error('Could not open the test account: ' + (error?.message || 'unknown error'))
  }
  setPreview({ admin, accounts, roleKey, label: res.label, name: res.name, targetId: v.user.id })
  window.location.assign('/')
}

export async function exitPreview() {
  const saved = getPreview()
  try {
    await restoreAdmin(saved)
  } catch (e) {
    setPreview(null)
    try { await supabase.auth.signOut({ scope: 'local' }) } catch { /* ignore */ }
    window.alert(e.message)
    window.location.assign('/')
    return
  }
  setPreview(null)
  try { await callFn({ action: 'exit', role_key: saved?.roleKey || null }) } catch { /* audit only */ }
  window.location.assign('/')
}
