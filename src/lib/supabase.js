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
