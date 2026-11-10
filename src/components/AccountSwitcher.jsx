// AccountSwitcher — "View as" drop-down (2026-11-10, Becky): switch between your own Admin / RM / GM / CSR
// logins without signing out. Your logins are the same mailbox with +rm / +gm / +csr (edge function account-switch).
// Shows nothing when you only have one login.
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export async function loadAccounts() {
  try {
    const { data, error } = await supabase.functions.invoke('account-switch', { body: { op: 'list' } })
    if (error) return []
    return data?.accounts || []
  } catch { return [] }
}

export async function switchAccount(email) {
  const { data, error } = await supabase.functions.invoke('account-switch', { body: { op: 'switch', email } })
  if (error || !data?.token_hash) throw new Error(data?.error || 'Couldn’t switch accounts.')
  const { error: e2 } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: data.token_hash })
  if (e2) throw new Error(e2.message)
  // start fresh in the new login's view
  window.location.href = '/'
}

export default function AccountSwitcher({ dark = true, style }) {
  const [list, setList] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { let on = true; loadAccounts().then(a => { if (on) setList(a) }); return () => { on = false } }, [])
  if (list.length < 2) return null
  const cur = list.find(a => a.current)
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: dark ? '#fff' : '#1C2421', ...style }}>
      View as
      <select disabled={busy} value={cur?.email || ''}
        onChange={async e => { const v = e.target.value; if (!v || v === cur?.email) return; setBusy(true); setErr(''); try { await switchAccount(v) } catch (x) { setBusy(false); setErr(x.message) } }}
        style={{ background: dark ? 'rgba(255,255,255,0.15)' : '#fff', color: dark ? '#fff' : '#1C2421', border: dark ? '1px solid rgba(255,255,255,0.4)' : '1px solid #E1DCD2', borderRadius: 8, padding: '5px 8px', fontWeight: 700, fontSize: 12.5, fontFamily: 'inherit', cursor: 'pointer' }}>
        {list.map(a => <option key={a.email} value={a.email} style={{ color: '#1C2421' }}>{a.label}</option>)}
      </select>
      {busy && <span style={{ fontSize: 12, opacity: 0.8 }}>Switching…</span>}
      {err && <span style={{ fontSize: 12, color: dark ? '#FECACA' : '#b91c1c' }}>{err}</span>}
    </label>
  )
}
