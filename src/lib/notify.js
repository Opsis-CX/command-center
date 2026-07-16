import { supabase } from './supabase'

// ============================================================
// notify.js — notification-row helpers.
//
// Important:
// - Every Supabase response is checked for `error`.
// - Every exported helper returns a promise and should be awaited.
// - The actor is never notified about their own action.
// - This file creates in-app notification rows. Actual browser push still
//   requires the server-side push sender and /sw.js.
// ============================================================

function uniqueIds(ids = []) {
  return [...new Set(ids.filter(Boolean))]
}

function safeArray(value) {
  return Array.isArray(value) ? value : []
}

function chatLink(channelId, messageId) {
  const params = new URLSearchParams()

  if (channelId) params.set('channel', channelId)
  if (messageId) params.set('message', messageId)

  const query = params.toString()

  return query ? `/chat?${query}` : '/chat'
}

async function insertMany(rows) {
  if (!rows.length) return []

  const { error } = await supabase
    .from('notifications')
    .insert(rows)

  if (error) {
    console.error('Notification insert failed', {
      error,
      rows,
    })

    throw new Error(`Notification insert failed: ${error.message}`)
  }

  return rows
}

// Recipients = all channel members except the actor.
export async function channelRecipients(channelId, actorId) {
  const { data, error } = await supabase
    .from('channel_members')
    .select('profile_id')
    .eq('channel_id', channelId)

  if (error) {
    console.error('Could not load channel recipients', {
      channelId,
      error,
    })

    throw new Error(
      `Could not load channel recipients: ${error.message}`
    )
  }

  return uniqueIds(
    (data || []).map(member => member.profile_id)
  ).filter(id => id !== actorId)
}

// ─── NOTIFICATION PREFERENCES ────────────────────────────────

// Fallback used when a channel member has no saved preference row.
// notify_all defaults to true so members are notified until they opt out —
// this is the default the notification pipeline relies on.
const DEFAULT_PREFS = {
  notify_all: true,
  notify_mentions: true,
  notify_from: [],
  notify_keywords: [],
}

async function channelPrefs(channelId, actorId) {
  const [membersResult, prefsResult] = await Promise.all([
    supabase
      .from('channel_members')
      .select('profile_id')
      .eq('channel_id', channelId),

    supabase
      .from('channel_notification_prefs')
      .select(
        'profile_id, notify_all, notify_mentions, notify_from, notify_keywords'
      )
      .eq('channel_id', channelId),
  ])

  if (membersResult.error) {
    console.error(
      'Could not load channel members for notifications',
      {
        channelId,
        error: membersResult.error,
      }
    )

    throw new Error(
      `Could not load channel members: ${membersResult.error.message}`
    )
  }

  if (prefsResult.error) {
    console.error(
      'Could not load channel notification preferences',
      {
        channelId,
        error: prefsResult.error,
      }
    )

    throw new Error(
      `Could not load notification preferences: ${prefsResult.error.message}`
    )
  }

  const savedPrefsByProfile = new Map(
    (prefsResult.data || []).map(pref => [
      pref.profile_id,
      pref,
    ])
  )

  return uniqueIds(
    (membersResult.data || []).map(member => member.profile_id)
  )
    .filter(profileId => profileId !== actorId)
    .map(profileId => {
      const pref = savedPrefsByProfile.get(profileId)

      if (!pref) {
        return {
          profile_id: profileId,
          ...DEFAULT_PREFS,
        }
      }

      return {
        profile_id: profileId,
        notify_all: Boolean(pref.notify_all),
        notify_mentions: Boolean(pref.notify_mentions),
        notify_from: safeArray(pref.notify_from),
        notify_keywords: safeArray(pref.notify_keywords),
      }
    })
}

function matchesKeyword(body, keywords) {
  if (!Array.isArray(keywords) || keywords.length === 0) {
    return false
  }

  const text = String(body || '')

  return keywords.some(keyword => {
    const trimmed = String(keyword || '').trim()

    if (!trimmed) return false

    const escaped = trimmed.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&'
    )

    try {
      return new RegExp(
        `(^|[^\\p{L}\\p{N}_])${escaped}([^\\p{L}\\p{N}_]|$)`,
        'iu'
      ).test(text)
    } catch {
      return new RegExp(
        `(^|\\W)${escaped}(\\W|$)`,
        'i'
      ).test(text)
    }
  })
}

// ─── CHAT ────────────────────────────────────────────────────

export async function notifyChatMessage({
  channelId,
  channelName,
  isDm,
  actorId,
  actorName,
  isHere,
  requiresAck,
  body,
  mentionedIds = [],
  messageId = null,
  // Thread replies: everyone already in the thread (parent author + prior
  // repliers, minus the actor). They get a reply-specific notification even
  // if their channel prefs would otherwise skip a normal message.
  replyToIds = [],
  parentAuthorId = null,
}) {
  if (!channelId) {
    throw new Error('notifyChatMessage requires channelId.')
  }

  if (!actorId) {
    throw new Error('notifyChatMessage requires actorId.')
  }

  const preferences = await channelPrefs(
    channelId,
    actorId
  )

  if (!preferences.length) return []

  const mentioned = new Set(uniqueIds(mentionedIds))

  const where = isDm
    ? 'a direct message'
    : `#${channelName || 'channel'}`

  const link = chatLink(channelId, messageId)

  const rows = []

  const replySet = new Set(uniqueIds(replyToIds))

  for (const pref of preferences) {
    const directlyMentioned = mentioned.has(
      pref.profile_id
    )

    const inThread = replySet.has(pref.profile_id)

    const mentionEvent =
      directlyMentioned ||
      Boolean(isHere) ||
      Boolean(requiresAck) ||
      inThread

    const shouldNotify =
      pref.notify_all ||
      (pref.notify_mentions && mentionEvent) ||
      pref.notify_from.includes(actorId) ||
      matchesKeyword(body, pref.notify_keywords) ||
      (Boolean(isDm) && pref.notify_mentions) ||
      // A reply to a thread you're part of always notifies — being in the
      // thread is a stronger signal than any channel-level preference.
      inThread

    if (!shouldNotify) continue

    const type = requiresAck
      ? 'chat_update'
      : isHere
        ? 'chat_here'
        : directlyMentioned
          ? 'chat_mention'
          : inThread
            ? 'chat_reply'
            : isDm
              ? 'chat_dm'
              : 'chat_message'

    const isParentAuthor =
      parentAuthorId && pref.profile_id === parentAuthorId

    const title = requiresAck
      ? `New update in ${where} — please confirm`
      : isHere
        ? `${actorName || 'Someone'} flagged everyone in ${where}`
        : directlyMentioned
          ? `${actorName || 'Someone'} mentioned you in ${where}`
          : inThread
            ? isParentAuthor
              ? `${actorName || 'Someone'} replied to your message in ${where}`
              : `${actorName || 'Someone'} replied in a thread you're in (${where})`
            : isDm
              ? `New message from ${actorName || 'Someone'}`
              : `${actorName || 'Someone'} posted in ${where}`

    rows.push({
      recipient_id: pref.profile_id,
      type,
      title,
      body: String(body || '').slice(0, 120) || null,
      link,
      actor_id: actorId,
      actor_name: actorName || null,
    })
  }

  return insertMany(rows)
}

export async function notifyChatMention({
  recipientIds,
  actorId,
  actorName,
  channelName,
  isDm,
  addedIds,
  channelId = null,
  messageId = null,
}) {
  const ids = uniqueIds(recipientIds).filter(
    id => id !== actorId
  )

  const added = new Set(uniqueIds(addedIds))

  const where = isDm
    ? 'a direct message'
    : `#${channelName || 'channel'}`

  return insertMany(
    ids.map(recipientId => ({
      recipient_id: recipientId,
      type: 'chat_mention',

      title:
        `${actorName || 'Someone'} mentioned you in ${where}`,

      body: added.has(recipientId)
        ? `You were mentioned and added to ${where}.`
        : null,

      link: chatLink(channelId, messageId),

      actor_id: actorId,
      actor_name: actorName || null,
    }))
  )
}

export async function notifyAckNudge({
  recipientId,
  actorId,
  actorName,
  channelName,
  channelId = null,
  messageId = null,
}) {
  if (!recipientId || recipientId === actorId) {
    return []
  }

  return insertMany([
    {
      recipient_id: recipientId,
      type: 'ack_nudge',

      title:
        `Reminder: please confirm the update${
          channelName ? ` in #${channelName}` : ''
        }`,

      body:
        `${actorName || 'Someone'} nudged you to confirm you've read it.`,

      link: chatLink(channelId, messageId),

      actor_id: actorId || null,
      actor_name: actorName || null,
    },
  ])
}

export async function notifyChannelAdded({
  recipientIds,
  actorId,
  actorName,
  channelName,
  isDm,
  channelId = null,
}) {
  const ids = uniqueIds(recipientIds).filter(
    id => id !== actorId
  )

  return insertMany(
    ids.map(recipientId => ({
      recipient_id: recipientId,
      type: 'channel_added',

      title: isDm
        ? `${actorName || 'Someone'} started a direct message with you`
        : `You were added to #${channelName || 'a channel'}`,

      body: null,

      link: chatLink(channelId, null),

      actor_id: actorId,
      actor_name: actorName || null,
    }))
  )
}

// ─── SCHEDULE ────────────────────────────────────────────────

export async function notifyIntervalReleased({
  eligibleIds,
  actorId,
  actorName,
  when,
  position,
}) {
  const ids = uniqueIds(eligibleIds).filter(
    id => id !== actorId
  )

  return insertMany(
    ids.map(recipientId => ({
      recipient_id: recipientId,
      type: 'interval_released',
      title: 'An interval just opened up',

      body:
        `${position ? `${position} · ` : ''}` +
        `${when} — released by ${actorName || 'someone'}. ` +
        'Claim it if you want it.',

      link: '/schedule',

      actor_id: actorId,
      actor_name: actorName || null,
    }))
  )
}

export async function notifyNoShow({
  recipientId,
  when,
}) {
  if (!recipientId) return []

  return insertMany([
    {
      recipient_id: recipientId,
      type: 'no_show',
      title: 'You were marked a no-show',

      body: when
        ? `For your interval ${when}.`
        : null,

      link: '/schedule',

      actor_id: null,
      actor_name: null,
    },
  ])
}

export async function notifyIntervalAssigned({
  recipientId,
  actorId,
  actorName,
  when,
}) {
  if (!recipientId || recipientId === actorId) return []

  return insertMany([
    {
      recipient_id: recipientId,
      type: 'interval_assigned',
      title: 'You were assigned an interval',

      body: when
        ? `${actorName || 'A manager'} assigned you ${when}.`
        : null,

      link: '/schedule',

      actor_id: actorId || null,
      actor_name: actorName || null,
    },
  ])
}

// ─── PROJECTS ────────────────────────────────────────────────

export async function notifyTaskAssigned({
  recipientIds,
  actorId,
  actorName,
  taskName,
  projectName,
  taskId,
}) {
  const ids = uniqueIds(recipientIds).filter(
    id => id !== actorId
  )

  const link = taskId
    ? `/projects?task=${encodeURIComponent(taskId)}`
    : '/projects'

  return insertMany(
    ids.map(recipientId => ({
      recipient_id: recipientId,
      type: 'task_assigned',
      title: 'You were assigned a task',

      body:
        `"${taskName}"` +
        `${projectName ? ` in ${projectName}` : ''}` +
        `${actorName ? ` — by ${actorName}` : ''}.`,

      link,

      actor_id: actorId,
      actor_name: actorName || null,
    }))
  )
}

export async function notifyTaskCompleted({
  recipientId,
  actorId,
  actorName,
  taskName,
  projectName,
  taskId,
}) {
  if (!recipientId || recipientId === actorId) {
    return []
  }

  const link = taskId
    ? `/projects?task=${encodeURIComponent(taskId)}`
    : '/projects'

  return insertMany([
    {
      recipient_id: recipientId,
      type: 'task_completed',
      title: 'A task you created was completed',

      body:
        `${actorName || 'Someone'} marked "${taskName}"` +
        `${projectName ? ` in ${projectName}` : ''}` +
        ' as Done.',

      link,

      actor_id: actorId,
      actor_name: actorName || null,
    },
  ])
}

export async function notifyTaskMention({
  recipientIds,
  actorId,
  actorName,
  taskName,
  where,
  taskId,
}) {
  const ids = uniqueIds(recipientIds).filter(
    id => id !== actorId
  )

  const link = taskId
    ? `/projects?task=${encodeURIComponent(taskId)}`
    : '/projects'

  return insertMany(
    ids.map(recipientId => ({
      recipient_id: recipientId,
      type: 'task_mention',

      title:
        `${actorName || 'Someone'} mentioned you`,

      body:
        `In ${where || 'a note'} on "${taskName}".`,

      link,

      actor_id: actorId,
      actor_name: actorName || null,
    }))
  )
}

// ─── CATEGORIES ──────────────────────────────────────────────
// One source of truth mapping each notification `type` to a category.
// Used by the notifications page (filtering) and the preferences system
// (per-category delivery choices). Keep every type produced above mapped
// here; unknown types fall back to 'other'.
export const NOTIF_CATEGORIES = [
  { key: 'chat',      label: 'Chat & messages' },
  { key: 'schedule',  label: 'Schedule & shifts' },
  { key: 'projects',  label: 'Projects & tasks' },
  { key: 'hiring',    label: 'Hiring' },
  { key: 'other',     label: 'Other' },
]

const TYPE_TO_CATEGORY = {
  // chat
  chat_message: 'chat', chat_mention: 'chat', chat_here: 'chat',
  chat_dm: 'chat', chat_update: 'chat', ack_nudge: 'chat', channel_added: 'chat',
  // schedule
  interval_released: 'schedule', no_show: 'schedule',
  // projects
  task_assigned: 'projects', task_completed: 'projects', task_mention: 'projects',
  // hiring (types created by the hiring module / edge fn)
  application_received: 'hiring', assessment_submitted: 'hiring',
  mock_requested: 'hiring', hire_stage_changed: 'hiring',
}

export function categoryForType(type) {
  return TYPE_TO_CATEGORY[type] || 'other'
}

export const CATEGORY_LABEL = Object.fromEntries(
  NOTIF_CATEGORIES.map(c => [c.key, c.label])
)

// ---- Call reviews (Quality tab) ----

export async function notifyCallReviewAssigned({
  recipientId,
  actorId,
  actorName,
}) {
  if (!recipientId || recipientId === actorId) {
    return []
  }

  return insertMany([
    {
      recipient_id: recipientId,
      type: 'call_review_assigned',
      title: 'A call is ready for your review',
      body: `${actorName || 'Someone'} assigned you a call recording. Listen and share 3 things you did well and 3 things to improve.`,
      link: '/quality',
      actor_id: actorId || null,
      actor_name: actorName || null,
    },
  ])
}

export async function notifyCallReviewSubmitted({
  recipientId,
  actorId,
  actorName,
}) {
  if (!recipientId || recipientId === actorId) {
    return []
  }

  return insertMany([
    {
      recipient_id: recipientId,
      type: 'call_review_submitted',
      title: `${actorName || 'Someone'} completed their call review`,
      body: 'Their 3 strengths and 3 improvements are ready to read in Quality.',
      link: '/quality',
      actor_id: actorId || null,
      actor_name: actorName || null,
    },
  ])
}
