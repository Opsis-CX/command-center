import { supabase } from './supabase'

// ============================================================
// push.js — browser-side push registration and subscription.
//
// This file does not send notifications. It registers /sw.js
// and stores the browser subscription so a trusted server or
// Supabase Edge Function can send Web Push.
//
// IMPORTANT: this public key MUST match the VAPID_PUBLIC_KEY
// configured on the send-push Edge Function. If they differ,
// the push service silently rejects every message (sent: 0).
// ============================================================

const VAPID_PUBLIC_KEY =
  'BDht9ewakT8S8rYsz1sSslHzj4YOFRcMfJKmbc_vs82g1ZMStPdnSnCfd0Iue27lCPrwwEGkn9R-vM5WnUfatFI'

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat(
    (4 - (base64String.length % 4)) % 4
  )

  const base64 = `${base64String}${padding}`
    .replace(/-/g, '+')
    .replace(/_/g, '/')

  const raw = window.atob(base64)

  return Uint8Array.from(
    raw,
    character => character.charCodeAt(0)
  )
}

// True if an existing browser subscription was created with the same
// VAPID key we use now. After a key rotation the old subscription can
// never receive our pushes, so we detect that and refresh it.
function subscriptionMatchesKey(subscription, expectedKeyBytes) {
  try {
    const existing =
      subscription?.options?.applicationServerKey

    if (!existing) {
      return false
    }

    const existingBytes = new Uint8Array(existing)

    if (existingBytes.length !== expectedKeyBytes.length) {
      return false
    }

    for (let i = 0; i < expectedKeyBytes.length; i++) {
      if (existingBytes[i] !== expectedKeyBytes[i]) {
        return false
      }
    }

    return true
  } catch (_) {
    return false
  }
}

// ============================================================
// Native (Capacitor / Android FCM) support.
//
// When the app runs inside the installed Android app, it is a Capacitor
// WebView — which has NO Web Push. Instead we use the native
// PushNotifications plugin (FCM) via the Capacitor bridge, which is injected
// on window even though this remote web build never imports the plugin.
// The device's FCM token is saved to `device_push_tokens`, and the server's
// send-fcm function delivers to it.
// ============================================================

function isNativePlatform() {
  try {
    return Boolean(
      typeof window !== 'undefined' &&
      window.Capacitor &&
      typeof window.Capacitor.isNativePlatform === 'function' &&
      window.Capacitor.isNativePlatform()
    )
  } catch (_) {
    return false
  }
}

function nativePlugin() {
  const plugin = window?.Capacitor?.Plugins?.PushNotifications
  if (!plugin) {
    throw new Error(
      'The native push plugin is not available in this app build.'
    )
  }
  return plugin
}

async function enableNativePush(profileId) {
  const PushNotifications = nativePlugin()

  // Ask for (or confirm) permission.
  let perm = await PushNotifications.checkPermissions()
  if (perm.receive !== 'granted') {
    perm = await PushNotifications.requestPermissions()
  }
  if (perm.receive !== 'granted') {
    throw new Error(
      perm.receive === 'denied'
        ? 'Notifications are blocked. Enable them in your device settings.'
        : 'Notification permission was not granted.'
    )
  }

  // Register with FCM and wait for the device token event.
  const token = await new Promise((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true
        reject(new Error('Timed out waiting for the device push token.'))
      }
    }, 20000)

    PushNotifications.addListener('registration', (t) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(t?.value)
    })

    PushNotifications.addListener('registrationError', (e) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(new Error(`Device registration failed: ${e?.error || 'unknown error'}`))
    })

    PushNotifications.register()
  })

  if (!token) {
    throw new Error('The device did not return a push token.')
  }

  const platform =
    (window?.Capacitor?.getPlatform && window.Capacitor.getPlatform()) ||
    'android'

  const { error } = await supabase
    .from('device_push_tokens')
    .upsert(
      {
        profile_id: profileId,
        token,
        provider: 'fcm',
        platform,
        user_agent:
          typeof navigator !== 'undefined' ? navigator.userAgent : null,
      },
      { onConflict: 'token' }
    )

  if (error) {
    console.error('Could not save device push token', error)
    throw new Error(`Could not save device push token: ${error.message}`)
  }

  return true
}

async function disableNativePush(profileId) {
  // Best-effort: remove this profile's device tokens. (Most users have a
  // single device; multi-device per-token removal can come later.)
  if (!profileId) return true
  const { error } = await supabase
    .from('device_push_tokens')
    .delete()
    .eq('profile_id', profileId)
    .eq('provider', 'fcm')
  if (error) {
    console.error('Could not remove device push token', error)
    throw new Error(`Could not remove device push token: ${error.message}`)
  }
  return true
}

async function getNativePushStatus(profileId) {
  try {
    const PushNotifications = nativePlugin()
    const perm = await PushNotifications.checkPermissions()
    if (perm.receive !== 'granted') {
      return { enabled: false, reason: perm.receive || 'not-granted', native: true }
    }
    if (!profileId) {
      return { enabled: false, reason: 'no-profile', native: true }
    }
    const { data, error } = await supabase
      .from('device_push_tokens')
      .select('id')
      .eq('profile_id', profileId)
      .eq('provider', 'fcm')
      .limit(1)
      .maybeSingle()
    if (error) {
      return { enabled: false, reason: 'database-error', native: true, error }
    }
    return {
      enabled: Boolean(data),
      reason: data ? 'enabled' : 'not-registered',
      native: true,
    }
  } catch (error) {
    return { enabled: false, reason: 'native-status-failed', native: true, error }
  }
}

function assertBrowser() {
  if (
    typeof window === 'undefined' ||
    typeof navigator === 'undefined'
  ) {
    throw new Error(
      'Push notifications can only be configured in a browser.'
    )
  }
}

export function pushSupported() {
  if (
    typeof window === 'undefined' ||
    typeof navigator === 'undefined'
  ) {
    return false
  }

  // Inside the native app, push is supported via FCM even though the
  // WebView lacks the Web Push APIs.
  if (isNativePlatform()) {
    return true
  }

  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

export async function registerServiceWorker() {
  assertBrowser()

  if (!('serviceWorker' in navigator)) {
    return null
  }

  try {
    const registration =
      await navigator.serviceWorker.register(
        '/sw.js',
        {
          scope: '/',
          updateViaCache: 'none',
        }
      )

    try {
      await registration.update()
    } catch (updateError) {
      console.warn(
        'Service worker update check failed',
        updateError
      )
    }

    return registration
  } catch (error) {
    console.error(
      'Service worker registration failed',
      error
    )

    throw new Error(
      `Service worker registration failed: ${error.message}`
    )
  }
}

export function pushPermission() {
  if (!pushSupported()) {
    return 'unsupported'
  }

  return Notification.permission
}

export async function enablePush(profileId) {
  if (!profileId) {
    throw new Error(
      'A profile ID is required to enable push.'
    )
  }

  // Inside the native Android app, register with FCM instead of Web Push.
  if (isNativePlatform()) {
    return enableNativePush(profileId)
  }

  if (!pushSupported()) {
    throw new Error(
      'This browser does not support notifications.'
    )
  }

  const registration =
    await registerServiceWorker()

  if (!registration) {
    throw new Error(
      'The service worker could not be registered.'
    )
  }

  const permission =
    await Notification.requestPermission()

  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Notifications are blocked. Enable them in your browser or device settings.'
        : 'Notification permission was not granted.'
    )
  }

  const readyRegistration =
    await navigator.serviceWorker.ready

  const applicationServerKey =
    urlBase64ToUint8Array(VAPID_PUBLIC_KEY)

  let subscription =
    await readyRegistration.pushManager.getSubscription()

  // Self-heal: if there is already a subscription but it was created with
  // a DIFFERENT VAPID key (e.g. before a key change), it can never receive
  // our pushes. Drop it — locally and in the database — and re-subscribe
  // with the current key. This makes "Enable push" fix itself on click.
  if (
    subscription &&
    !subscriptionMatchesKey(subscription, applicationServerKey)
  ) {
    try {
      await supabase
        .from('push_subscriptions')
        .delete()
        .eq('endpoint', subscription.endpoint)
    } catch (cleanupError) {
      console.warn(
        'Could not remove stale push subscription row',
        cleanupError
      )
    }

    try {
      await subscription.unsubscribe()
    } catch (unsubError) {
      console.warn(
        'Could not unsubscribe stale push subscription',
        unsubError
      )
    }

    subscription = null
  }

  if (!subscription) {
    subscription =
      await readyRegistration.pushManager.subscribe({
        userVisibleOnly: true,

        applicationServerKey,
      })
  }

  const json = subscription.toJSON()

  const p256dh = json.keys?.p256dh
  const auth = json.keys?.auth

  if (!p256dh || !auth) {
    throw new Error(
      'The browser returned an incomplete push subscription.'
    )
  }

  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        profile_id: profileId,
        endpoint: subscription.endpoint,
        p256dh,
        auth,
        user_agent: navigator.userAgent,
      },
      {
        onConflict: 'endpoint',
      }
    )

  if (error) {
    console.error(
      'Could not save push subscription',
      error
    )

    throw new Error(
      `Could not save push subscription: ${error.message}`
    )
  }

  return true
}

export async function disablePush(
  profileId = null
) {
  if (isNativePlatform()) {
    return disableNativePush(profileId)
  }

  if (!pushSupported()) {
    return true
  }

  const registration =
    await registerServiceWorker()

  const subscription =
    await registration.pushManager.getSubscription()

  if (!subscription) {
    return true
  }

  let query = supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', subscription.endpoint)

  if (profileId) {
    query = query.eq(
      'profile_id',
      profileId
    )
  }

  const { error } = await query

  if (error) {
    console.error(
      'Could not remove push subscription from the database',
      error
    )

    throw new Error(
      `Could not remove push subscription: ${error.message}`
    )
  }

  const unsubscribed =
    await subscription.unsubscribe()

  if (!unsubscribed) {
    throw new Error(
      'The browser could not unsubscribe from push notifications.'
    )
  }

  return true
}

export async function getPushStatus(
  profileId
) {
  if (isNativePlatform()) {
    return getNativePushStatus(profileId)
  }

  if (!pushSupported()) {
    return {
      enabled: false,
      reason: 'unsupported',
    }
  }

  if (Notification.permission !== 'granted') {
    return {
      enabled: false,
      reason: Notification.permission,
    }
  }

  try {
    const registration =
      await registerServiceWorker()

    const subscription =
      await registration.pushManager.getSubscription()

    if (!subscription) {
      return {
        enabled: false,
        reason: 'not-subscribed',
      }
    }

    // If the existing subscription was created with a different VAPID key,
    // it can never receive our pushes. Report it as NOT enabled so the UI
    // prompts the user to re-enable — enablePush() will then refresh it.
    const applicationServerKey =
      urlBase64ToUint8Array(VAPID_PUBLIC_KEY)

    if (
      !subscriptionMatchesKey(subscription, applicationServerKey)
    ) {
      return {
        enabled: false,
        reason: 'stale-key',
        endpoint: subscription.endpoint,
      }
    }

    if (!profileId) {
      return {
        enabled: true,

        reason:
          'browser-subscribed-profile-not-checked',

        endpoint:
          subscription.endpoint,
      }
    }

    const { data, error } = await supabase
      .from('push_subscriptions')
      .select('endpoint, profile_id')
      .eq('profile_id', profileId)
      .eq(
        'endpoint',
        subscription.endpoint
      )
      .maybeSingle()

    if (error) {
      console.error(
        'Could not verify push subscription',
        error
      )

      return {
        enabled: false,
        reason: 'database-error',
        error,
      }
    }

    return {
      enabled: Boolean(data),

      reason: data
        ? 'enabled'
        : 'subscription-not-saved',

      endpoint:
        subscription.endpoint,
    }
  } catch (error) {
    console.error(
      'Push status check failed',
      error
    )

    return {
      enabled: false,
      reason: 'status-check-failed',
      error,
    }
  }
}

export async function isPushEnabled(
  profileId = null
) {
  const status =
    await getPushStatus(profileId)

  return status.enabled
}
