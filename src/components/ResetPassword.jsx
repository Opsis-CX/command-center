import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import ChangePassword from './ChangePassword'

// Landing page for the password-reset email link.
// Because the Supabase client has detectSessionInUrl:true, clicking the recovery
// link auto-establishes a short-lived session and fires a PASSWORD_RECOVERY event.
// Once that session is present we can let the user set a new password with the
// existing <ChangePassword> component (which calls supabase.auth.updateUser).
export default function ResetPassword() {
  // 'checking' | 'ready' | 'invalid' | 'done'
  const [state, setState] = useState('checking')

  useEffect(() => {
    let active = true

    // Listen for the recovery event fired when the link's token is parsed.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return
      if (event === 'PASSWORD_RECOVERY' || session) setState('ready')
    })

    // Also check immediately in case the session was already established.
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      if (data?.session) {
        setState('ready')
      } else {
        // Give detectSessionInUrl a moment to parse the token, then decide.
        setTimeout(async () => {
          if (!active) return
          const { data: d2 } = await supabase.auth.getSession()
          setState(prev => (prev === 'ready' ? prev : (d2?.session ? 'ready' : 'invalid')))
        }, 1500)
      }
    })

    return () => { active = false; sub?.subscription?.unsubscribe?.() }
  }, [])

  if (state === 'checking') {
    return <div className="loading-screen">Verifying your reset link…</div>
  }

  if (state === 'invalid') {
    return (
      <div className="login-wrap">
        <div className="login-card" style={{ textAlign: 'center' }}>
          <h2 style={{ marginTop: 0 }}>Link expired</h2>
          <p style={{ fontSize: 15, color: 'var(--muted, #6b7280)' }}>
            This password reset link is invalid or has expired. Reset links are only good for a short time.
          </p>
          <a className="login-btn" href="/" style={{ display: 'inline-block', textDecoration: 'none' }}>
            Back to sign in
          </a>
        </div>
      </div>
    )
  }

  // state === 'ready' — reuse the existing forced ChangePassword screen.
  // On success, send the (now fully signed-in) user into the app.
  return (
    <ChangePassword forced onDone={() => window.location.assign('/')} />
  )
}
