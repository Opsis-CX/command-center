// Finance access check.
//
// Two questions, both answered by the database (never by the login token or the role list in this app):
//   manager   - is this person an Admin or Owner?  (can open the Finance area)
//   submitter - may this person open the Submit a purchase form?  (Admins and Owners, plus the roles owners choose)
//
// The answer is cached for the page session so the sidebar and the routes share one request, and it is
// re-checked whenever the signed-in person changes, so one person's access never carries over to the next.
import { useEffect, useState } from 'react'
import { supabase } from './supabase'

let cache = null     // { uid, manager, submitter } once known
let inflight = null

async function load() {
  const { data: { session } } = await supabase.auth.getSession()
  const uid = session?.user?.id || null
  if (!uid) return { uid, manager: false, submitter: false }
  const [m, s] = await Promise.all([supabase.rpc('finance_is_manager'), supabase.rpc('finance_can_submit_purchase')])
  return { uid, manager: m.data === true, submitter: s.data === true }
}

export function resetFinanceAccessCache() { cache = null; inflight = null }

// Returns null while checking, then { manager, submitter }.
export function useFinanceAccess() {
  const [v, setV] = useState(cache)
  useEffect(() => {
    let alive = true
    const run = () => {
      inflight = load().catch(() => ({ uid: null, manager: false, submitter: false })).then(r => { cache = r; return r })
      inflight.then(r => { if (alive) setV(r) })
    }
    if (cache) setV(cache)
    else if (inflight) inflight.then(r => { if (alive) setV(r) })
    else run()
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      const uid = session?.user?.id || null
      if (cache && uid !== cache.uid) { cache = null; inflight = null; if (alive) setV(null); run() }
    })
    return () => { alive = false; sub?.subscription?.unsubscribe?.() }
  }, [])
  return v
}