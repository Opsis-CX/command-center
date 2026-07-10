import { supabase } from './supabase'

// ============================================================
// push.js — browser-side push registration and subscription.
//
// This file does not send notifications. It registers /sw.js
// and stores the browser subscription so a trusted server or
// Supabase Edge Function can send Web Push.
// ============================================================

const VAPID_PUBLIC_KEY =
  'BMQy7uRQeBrawgTMJKgrGAm4DPXmLDuxacQgId85M1TEunf1zeXG8wtyD5b1hDhlE2Wy-aVPmoegZTg8GJf86nY'

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

  let subscription =
    await readyRegistration.pushManager.getSubscription()

  if (!subscription) {
    subscription =
      await readyRegistration.pushManager.subscribe({
        userVisibleOnly: true,

        applicationServerKey:
          urlBase64ToUint8Array(
            VAPID_PUBLIC_KEY
          ),
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
