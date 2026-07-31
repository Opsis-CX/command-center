import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anon || url.includes('YOUR-PROJECT')) {
  console.error('Supabase keys missing. Add them in your .env / environment variables.')
}

export const supabase = createClient(url, anon, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
})

// Realtime subscriptions run over a websocket that authenticates with the
// logged-in user's token. If we don't hand the current token to realtime,
// Row-Level Security blocks every change event — the subscription "connects"
// but silently receives nothing (which is exactly the no-live-updates bug).
// Here we push the token to realtime on load and whenever auth changes.
supabase.auth.getSession().then(({ data }) => {
  const token = data?.session?.access_token
  if (token) supabase.realtime.setAuth(token)
})
supabase.auth.onAuthStateChange((_event, session) => {
  const token = session?.access_token
  if (token) supabase.realtime.setAuth(token)
})

// PostgREST caps every response at a fixed number of rows (Supabase's default
// "max rows" is 1000). A plain .select() therefore SILENTLY truncates any table
// that has grown past that limit, and the UI just quietly loses rows. Use this
// to load the COMPLETE result set for a query that legitimately needs all rows:
// it pages through with .range() until the table is exhausted.
//
// IMPORTANT: the query you build MUST carry a deterministic order with a unique
// tiebreaker (e.g. .order('id')), or paging can skip/duplicate rows across pages.
// Pass a THUNK that builds a fresh query each call (the builder is single-use).
//
//   const rows = await fetchAllRows(() =>
//     supabase.from('shift_blocks').select('*').order('block_date').order('id'))
//
// Returns { data, error }: data is the full array (possibly partial if a page
// errored — error is set in that case), mirroring a normal supabase response so
// callers can keep their existing `res.data || []` / `res.error` handling.
export async function fetchAllRows(buildQuery, pageSize = 1000) {
  let from = 0
  const all = []
  for (;;) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1)
    if (error) return { data: all, error }
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < pageSize) break
    from += pageSize
  }
  return { data: all, error: null }
}

export function readRoleFromSession(session) {
  const jwt = session?.access_token
  if (!jwt) return { isAdmin: false, level: 0, roles: [] }
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1]))
    return {
      isAdmin: payload.app_admin === true,
      level: payload.app_level ?? 0,
      roles: payload.app_roles ?? [],
    }
  } catch {
    return { isAdmin: false, level: 0, roles: [] }
  }
}
