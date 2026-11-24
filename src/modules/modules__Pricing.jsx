// src/modules/Pricing.jsx — self-serve plan picker.
import { useState } from 'react'
import { startCheckout } from '../lib/billing'

const PLANS = [
  { plan: 'starter', label: 'Starter', price: '$499',
    blurb: 'For a single location getting started with call QA.',
    features: ['AI scoring on every call', '1 rubric', 'Client portal', 'Email support'] },
  { plan: 'growth', label: 'Growth', price: '$1,499', highlight: true,
    blurb: 'For multi-location teams that need coaching at scale.',
    features: ['Everything in Starter', 'Multiple rubrics', 'Lower overage rate', 'Priority support'] },
  { plan: 'scale', label: 'Scale', price: '$3,499',
    blurb: 'For high call volume and custom scoring.',
    features: ['Everything in Growth', 'Lowest overage rate', 'Custom scoring guidance', 'Dedicated onboarding'] },
]

export default function Pricing({ companyName = '' }) {
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')

  async function pick(plan) {
    setErr(''); setBusy(plan)
    try { await startCheckout({ plan, companyName }) }
    catch (e) { setErr(e.message); setBusy('') }
  }

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: 24 }}>
      <h1 style={{ textAlign: 'center' }}>Choose your plan</h1>
      <p style={{ textAlign: 'center', color: 'light-dark(#666, #b3c1c7)' }}>14-day free trial. Cancel anytime.</p>
      {err && <p style={{ color: 'light-dark(#b00020, #e9637b)', textAlign: 'center' }}>{err}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginTop: 24 }}>
        {PLANS.map((p) => (
          <div key={p.plan} style={{
            border: p.highlight ? '2px solid #4f46e5' : '1px solid #e5e7eb',
            borderRadius: 12, padding: 24, background: 'light-dark(#fff, #161d21)',
          }}>
            <h2 style={{ margin: '0 0 4px' }}>{p.label}</h2>
            <div style={{ fontSize: 32, fontWeight: 700 }}>{p.price}
              <span style={{ fontSize: 14, fontWeight: 400, color: 'light-dark(#666, #b3c1c7)' }}>/mo</span></div>
            <p style={{ color: 'light-dark(#666, #b3c1c7)', minHeight: 40 }}>{p.blurb}</p>
            <ul style={{ paddingLeft: 18, color: 'light-dark(#333, #e8eef0)' }}>
              {p.features.map((f) => <li key={f} style={{ marginBottom: 6 }}>{f}</li>)}
            </ul>
            <button onClick={() => pick(p.plan)} disabled={!!busy} style={{
              width: '100%', padding: '12px 16px', marginTop: 12, borderRadius: 8, border: 'none',
              background: p.highlight ? '#4f46e5' : '#111827', color: '#fff', fontWeight: 600,
              cursor: busy ? 'wait' : 'pointer', opacity: busy && busy !== p.plan ? 0.5 : 1,
            }}>
              {busy === p.plan ? 'Redirecting…' : 'Start free trial'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
