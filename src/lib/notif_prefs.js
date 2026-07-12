import { supabase } from './supabase'
import { NOTIF_CATEGORIES } from './notify'

// ============================================================
// notif_prefs.js — read/write the per-user, per-category
// notification delivery preferences (in_app / push / sound).
//
// A missing row means "all on" (see DEFAULT). The UI fills in
// defaults for any category the user hasn't customized yet.
// ============================================================

const DEFAULT = { in_app: true, push: true, sound: true }

// Returns a map: { [category]: { in_app, push, sound } } for every
// known category, filling defaults where the user has no saved row.
export async function loadNotifPrefs(profileId) {
  const base = Object.fromEntries(
    NOTIF_CATEGORIES.map(c => [c.key, { ...DEFAULT }])
  )
  if (!profileId) return base

  const { data, error } = await supabase
    .from('notification_prefs')
    .select('category, in_app, push, sound')
    .eq('profile_id', profileId)

  if (error) {
    console.error('Could not load notification prefs', error)
    return base
  }

  for (const row of data || []) {
    if (base[row.category]) {
      base[row.category] = {
        in_app: Boolean(row.in_app),
        push: Boolean(row.push),
        sound: Boolean(row.sound),
      }
    }
  }
  return base
}

// Upserts a single category's preferences for the current user.
export async function saveNotifPref(profileId, category, values) {
  if (!profileId) throw new Error('saveNotifPref requires a profileId')
  const { error } = await supabase
    .from('notification_prefs')
    .upsert(
      {
        profile_id: profileId,
        category,
        in_app: Boolean(values.in_app),
        push: Boolean(values.push),
        sound: Boolean(values.sound),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'profile_id,category' }
    )
  if (error) {
    console.error('Could not save notification pref', error)
    throw new Error(`Could not save preference: ${error.message}`)
  }
  return true
}

// Convenience for the bell/page: should this category make a sound / show in-app?
export function allowsSound(prefs, category) {
  return prefs?.[category]?.sound !== false
}
export function allowsInApp(prefs, category) {
  return prefs?.[category]?.in_app !== false
}
