// src/modules/BillingSettings.jsx — plan/status + "Manage billing" button.
// Drop into Settings or wire to its own route.
import { useEffect, useState } from 'react'
import { getEntitlement, openBillingPortal } from '../lib/billing'

export default function BillingSettings() {
  const [ent, setEnt] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { getEntitlement().then(setEnt).catch((e) => setErr(e.message)) }, [])

  async function manage() {
    setErr(''); setBusy(true)
    try { await openBillingPortal() } catch (e) { setErr(e.message); setBusy(false) }
  }

  const statusLabel = {
    trialing: 'Free trial', active: 'Active', past_due: 'Payment past due',
    canceled: 'Canceled', inactive: 'Not subscribed',
  }

  return (
    <div style={{ maxWidth: 480, padding: 24, border: '1px solid #e5e7eb', borderRadius: 12 }}>
      <h2 style={{ marginTop: 0 }}>Billing</h2>
      {err && <p style={{ color: '#b00020' }}>{err}</p>}
      {ent ? (
        <>
          <p><strong>Plan:</strong> {ent.plan ? ent.plan[0].toUpperCase() + ent.plan.slice(1) : '—'}</p>
          <p><strong>Status:</strong> {statusLabel[ent.status] || ent.status}</p>
          {ent.trial_end && ent.status === 'trialing' &&
            <p><strong>Trial ends:</strong> {new Date(ent.trial_end).toLocaleDateString()}</p>}
          {ent.current_period_end &&
            <p><strong>Renews:</strong> {new Date(ent.current_period_end).toLocaleDateString()}</p>}
        </>
      ) : <p style={{ color: '#666' }}>Loading…</p>}
      <button onClick={manage} disabled={busy} style={{
        marginTop: 12, padding: '10px 18px', borderRadius: 8, border: 'none',
        background: '#111827', color: '#fff', fontWeight: 600, cursor: busy ? 'wait' : 'pointer',
      }}>
        {busy ? 'Opening…' : 'Manage billing'}
      </button>
    </div>
  )
}
