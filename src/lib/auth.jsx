import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { supabase, readRoleFromSession } from './supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [role, setRole] = useState({ isAdmin: false, level: 0, roles: [] })
  const [appRole, setAppRole] = useState('agent')   // the permission role from profiles
  const [clientId, setClientId] = useState(null)    // set only for external client-portal users
  const [inTraining, setInTraining] = useState(false) // new hire locked to Certification until Hired
  const [loading, setLoading] = useState(true)
  const activeChannelRef = useRef(null)

  // Read the profile row, retrying a couple of times on a transient failure.
  // Returns { ok, data }. ok=false means we never got a trustworthy answer —
  // the caller must NOT treat that as "this person has no role".
  async function fetchProfileRole(uid, attempts = 3) {
    for (let i = 0; i < attempts; i++) {
      try {
        const { data, error } = await supabase
          .from('profiles').select('role, client_id, timezone, in_training').eq('id', uid).maybeSingle()
        // supabase-js returns errors, it does not throw them — checking `error`
        // is what stops a failed read from looking like an empty profile.
        if (!error) return { ok: true, data }
      } catch { /* fall through to retry */ }
      if (i < attempts - 1) await new Promise(r => setTimeout(r, 400 * (i + 1)))
    }
    return { ok: false, data: null }
  }

  async function loadAppRole(sess) {
    const uid = sess?.user?.id
    if (!uid) { setAppRole('agent'); setClientId(null); setInTraining(false); return }

    const { ok, data } = await fetchProfileRole(uid)

    // Never demote on a read failure. Dropping someone to 'agent' because of a
    // network blip silently strips their whole role for the session — they lose
    // the Dashboard, the EOD card, and everything else their real role grants,
    // with no error shown. Hold whatever we already have and try again later.
    if (!ok) {
      console.warn('[auth] could not read profile role; keeping the current role rather than falling back to agent')
      return
    }

    setAppRole(data?.role || 'agent')
    setClientId(data?.client_id || null)
    setInTraining(!!data?.in_training)

    // Auto-capture each person's real timezone from their computer so timezones
    // stay accurate without manual entry. Only writes when it actually changed.
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      if (tz && data && data.timezone !== tz) {
        await supabase.from('profiles').update({ timezone: tz }).eq('id', uid)
      }
    } catch { /* ignore timezone detection errors */ }
  }

  // If this user has been made inactive on People & Tags, kick them out now.
  // On a transient read error we do NOT sign them out (never lock someone out
  // because of a blip) — the DB-side ban is the backstop.
  async function enforceActive(sess) {
    const uid = sess?.user?.id
    if (!uid) return
    try {
      const { data, error } = await supabase
        .from('profiles').select('is_active').eq('id', uid).single()
      if (!error && data && data.is_active === false) {
        await supabase.auth.signOut()
      }
    } catch { /* ignore */ }
  }

  // Live watch: the instant is_active flips to false, sign this tab out.
  function watchActive(sess) {
    const uid = sess?.user?.id
    if (activeChannelRef.current) {          // tear down any previous subscription
      supabase.removeChannel(activeChannelRef.current)
      activeChannelRef.current = null
    }
    if (!uid) return
    activeChannelRef.current = supabase
      .channel(`active-guard-${uid}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${uid}` },
        (payload) => { if (payload.new?.is_active === false) supabase.auth.signOut() }
      )
      .subscribe()
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      setRole(readRoleFromSession(data.session))
      await loadAppRole(data.session)
      await enforceActive(data.session)     // catch someone already inactive on load
      watchActive(data.session)             // and react live from here on
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      setRole(readRoleFromSession(s))
      loadAppRole(s)
      enforceActive(s)
      watchActive(s)
    })
    return () => {
      sub.subscription.unsubscribe()
      if (activeChannelRef.current) supabase.removeChannel(activeChannelRef.current)
    }
  }, [])

  const value = {
    session,
    user: session?.user ?? null,
    ...role,
    appRole,
    clientId,
    inTraining,
    isClientPortal: appRole === 'client' || !!clientId,
    loading,
    signOut: () => supabase.auth.signOut(),
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
