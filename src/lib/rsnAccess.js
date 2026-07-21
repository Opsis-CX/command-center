// RSN pipeline access check.
//
// Access is tag-based, not role-based, so it can't ride the usual
// canAny(appRole, perm) path in permissions.js. Instead we ask the DB helper
// public.can_access_rsn_pipeline() (SECURITY DEFINER), which returns true for
// admins OR anyone carrying the 'access/rsn' tag.
//
// The result is cached at module scope so the App route gate and the Sidebar
// link don't each fire their own request — one RPC per page load, shared.
import { useEffect, useState } from 'react'
import { supabase } from './supabase'

let cachePromise = null
let cacheValue   // undefined until first resolve, then boolean

export function resetRsnAccessCache() {
  cachePromise = null
  cacheValue = undefined
}

// Returns: null while the check is in flight, then true/false.
export function useRsnAccess() {
  const [ok, setOk] = useState(cacheValue === undefined ? null : cacheValue)

  useEffect(() => {
    let alive = true
    if (cacheValue !== undefined) { setOk(cacheValue); return }
    if (!cachePromise) {
      cachePromise = supabase.rpc('can_access_rsn_pipeline')
        .then(({ data, error }) => { cacheValue = (!error && data === true); return cacheValue })
        .catch(() => { cacheValue = false; return false })
    }
    cachePromise.then(v => { if (alive) setOk(v) })
    return () => { alive = false }
  }, [])

  return ok
}
