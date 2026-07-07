import { supabase } from './supabase'

// ============================================================
// push.js — registers the service worker, requests notification
// permission, and saves the device's push subscription so the
// server (Edge Function) can send push notifications later.
// ============================================================

// Your VAPID PUBLIC key (safe to expose in front-end).
const VAPID_PUBLIC_KEY = 'BMQy7uRQeBrawgTMJKgrGAm4DPXmLDuxacQgId85M1TEunf1zeXG8wtyD5b1hDhlE2Wy-aVPmoegZTg8GJf86nY'

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

// Is push even possible in this browser?
export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

// Register the service worker (safe to call on every app load).
export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null
  try {
    return await navigator.serviceWorker.register('/sw.js')
  } catch (e) {
    console.error('SW registration failed', e)
    return null
  }
}

// Current permission state: 'granted' | 'denied' | 'default' | 'unsupported'
export function pushPermission() {
  if (!pushSupported()) return 'unsupported'
  return Notification.permission
}

// Ask permission + subscribe + save to DB. Returns true on success.
export async function enablePush(profileId) {
  if (!pushSupported()) throw new Error('This browser does not support notifications.')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notification permission was not granted.')

  const reg = await navigator.serviceWorker.ready
  // reuse existing subscription if present
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    })
  }
  const json = sub.toJSON()
  const { error } = await supabase.from('push_subscriptions').upsert({
    profile_id: profileId,
    endpoint: sub.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    user_agent: navigator.userAgent,
  }, { onConflict: 'endpoint' })
  if (error) throw error
  return true
}

// Turn off push on this device (unsubscribe + remove from DB).
export async function disablePush() {
  if (!('serviceWorker' in navigator)) return
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (sub) {
    await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
    await sub.unsubscribe()
  }
}

// Is this device currently subscribed?
export async function isPushEnabled() {
  if (!pushSupported()) return false
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    return !!sub
  } catch { return false }
}
