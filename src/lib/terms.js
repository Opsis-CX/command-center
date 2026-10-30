import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// What this company calls a client / a project (2026-10-30). Labels only — the security
// structure underneath never changes. Falls back to Client/Project where not set up.
const DEFAULTS = { client: 'Client', clients: 'Clients', project: 'Project', projects: 'Projects' }
let _terms = null
let _loading = null
const _subs = new Set()

export async function loadTerms(force = false) {
  if (_terms && !force) return _terms
  if (_loading && !force) return _loading
  _loading = supabase.from('org_terms').select('key, singular, plural').then(({ data, error }) => {
    const t = { ...DEFAULTS }
    if (!error) for (const r of data || []) { t[r.key] = r.singular; t[r.key + 's'] = r.plural }
    _terms = t; _loading = null
    _subs.forEach(fn => fn(t))
    return t
  })
  return _loading
}

export function useTerms() {
  const [t, setT] = useState(_terms || DEFAULTS)
  useEffect(() => {
    _subs.add(setT)
    loadTerms().then(setT).catch(() => {})
    return () => { _subs.delete(setT) }
  }, [])
  return t
}
