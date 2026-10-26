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
// ─── CHAT ────────────────────────────────────────────────────

// Chat message notifications (DMs, @mentions, @here, @update, thread replies,
// channel posts) are created by the DATABASE when a message is saved —
// trigger trg_notify_on_chat_message → public.notify_on_chat_message().
// Browsers can no longer insert chat_* notifications (they're ignored), so
// there is intentionally no client-side notifyChatMessage anymore.

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

// Fired when a NEW task is added to a project — alerts the project's members so
// everyone sees what landed on the list (assignees get task_assigned instead).
export async function notifyTaskAdded({
  recipientIds,
  actorId,
  actorName,
  taskName,
  projectName,
  taskId,
}) {
  const ids = uniqueIds(recipientIds).filter(id => id !== actorId)

  const link = taskId
    ? `/projects?task=${encodeURIComponent(taskId)}`
    : '/projects'

  return insertMany(
    ids.map(recipientId => ({
      recipient_id: recipientId,
      type: 'task_added',
      title: 'New task added',

      body:
        `${actorName || 'Someone'} added "${taskName}"` +
        `${projectName ? ` to ${projectName}` : ''}.`,

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
  { key: 'schedule',  label: 'Schedule & intervals' },
  { key: 'projects',  label: 'Projects & tasks' },
  { key: 'hiring',    label: 'Hiring' },
  { key: 'other',     label: 'Other' },
]

const TYPE_TO_CATEGORY = {
  // chat
  chat_message: 'chat', chat_mention: 'chat', chat_here: 'chat',
  chat_dm: 'chat', chat_update: 'chat', chat_reply: 'chat', ack_nudge: 'chat', channel_added: 'chat',
  // schedule
  interval_released: 'schedule', no_show: 'schedule',
  // projects
  task_assigned: 'projects', task_added: 'projects', task_completed: 'projects', task_mention: 'projects',
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
      link: '/my-call-reviews',
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

// ---- Help Center tickets ----

export async function notifyTicketCreated({
  recipientIds,
  actorId,
  actorName,
  ticketNumber,
  category,
  subject,
}) {
  const ids = uniqueIds(recipientIds).filter(id => id !== actorId)
  if (!ids.length) return []

  return insertMany(ids.map(recipientId => ({
    recipient_id: recipientId,
    type: 'ticket_created',
    title: `New help ticket #${ticketNumber} — ${category}`,
    body: `${actorName || 'Someone'}: ${String(subject || '').slice(0, 100)}`,
    link: '/help',
    actor_id: actorId || null,
    actor_name: actorName || null,
  })))
}

export async function notifyTicketReply({
  recipientIds,
  actorId,
  actorName,
  ticketNumber,
  body,
}) {
  const ids = uniqueIds(recipientIds).filter(id => id !== actorId)
  if (!ids.length) return []

  return insertMany(ids.map(recipientId => ({
    recipient_id: recipientId,
    type: 'ticket_reply',
    title: `${actorName || 'Someone'} replied on ticket #${ticketNumber}`,
    body: String(body || '').slice(0, 120) || null,
    link: '/help',
    actor_id: actorId || null,
    actor_name: actorName || null,
  })))
}

export async function notifyTicketStatus({
  recipientId,
  actorId,
  actorName,
  ticketNumber,
  status,
}) {
  if (!recipientId || recipientId === actorId) return []

  const label = status === 'resolved' ? 'resolved'
    : status === 'closed' ? 'closed'
      : status === 'pending' ? 'waiting on your reply'
        : 'reopened'

  return insertMany([{
    recipient_id: recipientId,
    type: 'ticket_status',
    title: `Ticket #${ticketNumber} is ${label}`,
    body: null,
    link: '/help',
    actor_id: actorId || null,
    actor_name: actorName || null,
  }])
}

// ---- Live status nudges (On now board) ----

export async function notifyCheckInNudge({
  recipientId,
  actorId,
  actorName,
  intervalLabel = null,
}) {
  if (!recipientId || recipientId === actorId) return []

  return insertMany([{
    recipient_id: recipientId,
    type: 'checkin_nudge',
    title: 'Reminder: please check in for your interval',
    body: intervalLabel
      ? `You're scheduled ${intervalLabel} — ${actorName || 'someone'} nudged you to check in.`
      : `${actorName || 'Someone'} nudged you to check in for your scheduled time.`,
    link: '/schedule',
    actor_id: actorId || null,
    actor_name: actorName || null,
  }])
}

export async function notifyPickTaskNudge({
  recipientId,
  actorId,
  actorName,
}) {
  if (!recipientId || recipientId === actorId) return []

  return insertMany([{
    recipient_id: recipientId,
    type: 'pick_task_nudge',
    title: 'Reminder: start a task',
    body: `You're checked in but no task is running — ${actorName || 'someone'} nudged you to pick what you're working on.`,
    link: '/projects',
    actor_id: actorId || null,
    actor_name: actorName || null,
  }])
}

// ---- Weekly spotlight ----

export async function notifySpotlight({
  recipientId,
  actorId,
  actorName,
  blurb = null,
}) {
  if (!recipientId) return []
  return insertMany([{
    recipient_id: recipientId,
    type: 'spotlight',
    title: "🌟 You're the Team Spotlight this week!",
    body: blurb
      ? `${actorName || 'The team'} spotlighted you: "${blurb}"`
      : `${actorName || 'The team'} named you this week's Team Spotlight. Nice work!`,
    link: '/home',
    actor_id: actorId || null,
    actor_name: actorName || null,
  }])
}

// ---- Video calls ----

export async function notifyIncomingCall({
  recipientIds,
  actorId,
  actorName,
  channelId,
  isDm,
}) {
  const ids = uniqueIds(recipientIds).filter(id => id !== actorId)
  if (!ids.length) return []

  return insertMany(ids.map(recipientId => ({
    recipient_id: recipientId,
    type: 'incoming_call',
    title: `📞 ${actorName || 'Someone'} started a video call${isDm ? ' with you' : ''}`,
    body: 'The join link is in the conversation.',
    link: chatLink(channelId),
    actor_id: actorId || null,
    actor_name: actorName || null,
  })))
}
