import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, readRoleFromSession } from './supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [role, setRole] = useState({ isAdmin: false, level: 0, roles: [] })
  const [appRole, setAppRole] = useState('agent')   // the 6-role permission role from profiles
  const [loading, setLoading] = useState(true)

  async function loadAppRole(sess) {
    const uid = sess?.user?.id
    if (!uid) { setAppRole('agent'); return }
    try {
      const { data } = await supabase.from('profiles').select('role').eq('id', uid).maybeSingle()
      setAppRole(data?.role || 'agent')
    } catch { setAppRole('agent') }
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      setRole(readRoleFromSession(data.session))
      await loadAppRole(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      setRole(readRoleFromSession(s))
      loadAppRole(s)
    })
    return () => sub.subscription.unsubscribe()
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

export const useAuth = () => useContext(AuthContext)import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, readRoleFromSession } from './supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [role, setRole] = useState({ isAdmin: false, level: 0, roles: [] })
  const [appRole, setAppRole] = useState('agent')   // the 6-role permission role from profiles
  const [loading, setLoading] = useState(true)

  async function loadAppRole(sess) {
    const uid = sess?.user?.id
    if (!uid) { setAppRole('agent'); return }
    try {
      const { data } = await supabase.from('profiles').select('role').eq('id', uid).maybeSingle()
      setAppRole(data?.role || 'agent')
    } catch { setAppRole('agent') }
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      setRole(readRoleFromSession(data.session))
      await loadAppRole(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      setRole(readRoleFromSession(s))
      loadAppRole(s)
    })
    return () => sub.subscription.unsubscribe()
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
