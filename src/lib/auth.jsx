import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { supabase, readRoleFromSession } from './supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [role, setRole] = useState({ isAdmin: false, level: 0, roles: [] })
  const [appRole, setAppRole] = useState('agent')   // the 6-role permission role from profiles
  const [loading, setLoading] = useState(true)
  const activeChannelRef = useRef(null)

  async function loadAppRole(sess) {
    const uid = sess?.user?.id
    if (!uid) { setAppRole('agent'); return }
    try {
      const { data } = await supabase.from('profiles').select('role').eq('id', uid).maybeSingle()
      setAppRole(data?.role || 'agent')
    } catch { setAppRole('agent') }
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
    loading,
    signOut: () => supabase.auth.signOut(),
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
