// src/modules/Welcome.jsx — post-checkout landing. Stripe redirects here.
// The webhook provisions the entitlement asynchronously, so we poll briefly.
import { useEffect, useState } from 'react'
import { getEntitlement } from '../lib/billing'

export default function Welcome() {
  const [status, setStatus] = useState('checking')

  useEffect(() => {
    let tries = 0, stop = false
    async function poll() {
      try {
        const ent = await getEntitlement()
        if (ent && ['trialing', 'active'].includes(ent.status)) { setStatus('ready'); return }
      } catch { /* transient */ }
      tries += 1
      if (tries > 15) { setStatus('slow'); return }
      if (!stop) setTimeout(poll, 2000)
    }
    poll()
    return () => { stop = true }
  }, [])

  return (
    <div style={{ maxWidth: 560, margin: '80px auto', textAlign: 'center', padding: 24 }}>
      {status === 'checking' && <><h1>Setting up your account…</h1><p style={{ color: '#666' }}>This takes a few seconds.</p></>}
      {status === 'ready' && <><h1>You're all set 🎉</h1><p style={{ color: '#666' }}>Your 14-day trial has started.</p>
        <a href="/" style={{ display: 'inline-block', marginTop: 16, padding: '12px 20px', background: '#4f46e5', color: '#fff', borderRadius: 8, textDecoration: 'none' }}>Go to your dashboard</a></>}
      {status === 'slow' && <><h1>Almost there…</h1><p style={{ color: '#666' }}>Your payment went through. If your dashboard isn't ready in a minute, refresh or contact support.</p></>}
    </div>
  )
}
