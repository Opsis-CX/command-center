import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anon || url.includes('YOUR-PROJECT')) {
  console.error('Supabase keys missing. Add them in your .env / environment variables.')
}

export const supabase = createClient(url, anon)

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
