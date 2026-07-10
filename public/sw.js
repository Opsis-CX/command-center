// Place this file at:
// public/sw.js
//
// It must be served from:
// https://your-domain.com/sw.js
//
// Do not place this inside src/lib.

const DEFAULT_ICON =
  '/icons/icon-192.png'

const DEFAULT_BADGE =
  '/icons/badge-72.png'

self.addEventListener(
  'install',
  () => {
    self.skipWaiting()
  }
)

self.addEventListener(
  'activate',
  event => {
    event.waitUntil(
      self.clients.claim()
    )
  }
)

self.addEventListener(
  'push',
  event => {
    let payload = {}

    try {
      payload = event.data
        ? event.data.json()
        : {}
    } catch {
      payload = {
        title: 'New notification',

        body:
          event.data?.text() || '',
      }
    }

    const title =
      payload.title ||
      'New notification'

    const notificationId =
      payload.notification_id ||
      payload.notificationId ||
      null

    const channelId =
      payload.channel_id ||
      payload.channelId ||
      null

    const messageId =
      payload.message_id ||
      payload.messageId ||
      null

    const destination =
      payload.url ||
      payload.link ||
      '/chat'

    const options = {
      body:
        payload.body || '',

      icon:
        payload.icon ||
        DEFAULT_ICON,

      badge:
        payload.badge ||
        DEFAULT_BADGE,

      tag:
        payload.tag ||
        notificationId ||
        undefined,

      renotify:
        Boolean(payload.renotify),

      requireInteraction:
        Boolean(
          payload.requireInteraction
        ),

      data: {
        url: destination,
        notificationId,
        channelId,
        messageId,
      },
    }

    event.waitUntil(
      self.registration.showNotification(
        title,
        options
      )
    )
  }
)

self.addEventListener(
  'notificationclick',
  event => {
    event.notification.close()

    const destination =
      event.notification.data?.url ||
      '/chat'

    const targetUrl =
      new URL(
        destination,
        self.location.origin
      ).href

    event.waitUntil(
      (async () => {
        const windows =
          await self.clients.matchAll({
            type: 'window',
            includeUncontrolled: true,
          })

        for (const client of windows) {
          if (!('focus' in client)) {
            continue
          }

          try {
            if ('navigate' in client) {
              await client.navigate(
                targetUrl
              )
            }
          } catch (error) {
            console.warn(
              'Could not navigate existing window',
              error
            )
          }

          return client.focus()
        }

        return self.clients.openWindow(
          targetUrl
        )
      })()
    )
  }
)

self.addEventListener(
  'pushsubscriptionchange',
  () => {
    // The browser may rotate or expire a subscription.
    //
    // The authenticated app should call enablePush(profileId)
    // again during a later app load so the new subscription
    // is saved to Supabase.

    console.warn(
      'Push subscription changed; the app must re-register it.'
    )
  }
)
