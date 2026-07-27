import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [mode, setMode] = useState('signin') // 'signin' | 'forgot'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setErr(''); setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setErr(error.message)
    setBusy(false)
  }

  async function sendReset(e) {
    e.preventDefault()
    setErr(''); setBusy(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setBusy(false)
    // Don't reveal whether the account exists — always show the same confirmation.
    if (error && !/rate limit/i.test(error.message)) {
      // Only surface hard errors (e.g. rate limiting) so the user can retry later.
      setErr(error.message)
      return
    }
    setSent(true)
  }

  function backToSignIn() {
    setMode('signin'); setErr(''); setSent(false)
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-brand" style={{ justifyContent: 'center', marginBottom: 8 }}>
          <img src="/opsis-command-center.png" alt="Opsis Command Center" style={{ maxWidth: 280, width: '100%', height: 'auto', objectFit: 'contain' }} />
        </div>

        {err && <div className="login-err">{err}</div>}

        {mode === 'signin' && (
          <form onSubmit={submit}>
            <div className="field">
              <label>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" required />
            </div>
            <div className="field">
              <label>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" required />
            </div>
            <button className="login-btn" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <button
                type="button"
                onClick={() => { setMode('forgot'); setErr('') }}
                style={{ background: 'none', border: 'none', color: 'var(--accent, #2563eb)', cursor: 'pointer', fontSize: 14, padding: 0 }}
              >
                Forgot password?
              </button>
            </div>
          </form>
        )}

        {mode === 'forgot' && !sent && (
          <form onSubmit={sendReset}>
            <p style={{ fontSize: 14, color: 'var(--muted, #6b7280)', marginTop: 0, marginBottom: 16 }}>
              Enter your email and we'll send you a link to reset your password.
            </p>
            <div className="field">
              <label>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" required autoFocus />
            </div>
            <button className="login-btn" disabled={busy}>
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <button
                type="button"
                onClick={backToSignIn}
                style={{ background: 'none', border: 'none', color: 'var(--accent, #2563eb)', cursor: 'pointer', fontSize: 14, padding: 0 }}
              >
                Back to sign in
              </button>
            </div>
          </form>
        )}

        {mode === 'forgot' && sent && (
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: 15, marginTop: 0 }}>
              If an account exists for <strong>{email}</strong>, a password reset link is on its way. Check your inbox (and spam folder) and click the link within an hour.
            </p>
            <button className="login-btn" type="button" onClick={backToSignIn}>
              Back to sign in
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
