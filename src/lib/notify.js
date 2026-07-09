import { supabase } from './supabase'

// ============================================================
// notify.js — helpers to create notifications for events.
// Call these from chat/schedule code when things happen.
// Each inserts one row per recipient. Never notify the actor.
//
// Chat messages now respect per-channel notification preferences
// stored in `channel_notification_prefs`. See notifyChatMessage.
// ============================================================

async function insertMany(rows) {
  if (!rows.length) return
  try { await supabase.from('notifications').insert(rows) }
  catch (e) { console.error('notify failed', e) }
}

// Recipients = all channel members except the actor.
async function channelRecipients(channelId, actorId) {
  const { data } = await supabase.from('channel_members').select('profile_id').eq('channel_id', channelId)
  return (data || []).map(m => m.profile_id).filter(id => id && id !== actorId)
}

// ─── NOTIFICATION PREFERENCES ─────────────────────────────────────────────────

// Default when a member has no prefs row for this channel.
const DEFAULT_PREFS = {
  notify_all: false,
  notify_mentions: true,
  notify_from: [],
  notify_keywords: [],
}

// Load every member's prefs for a channel. Missing rows fall back to defaults.
// Returns [{ profile_id, notify_all, notify_mentions, notify_from, notify_keywords }]
async function channelPrefs(channelId, actorId) {
  const [{ data: mem }, { data: prefs }] = await Promise.all([
    supabase.from('channel_members').select('profile_id').eq('channel_id', channelId),
    supabase.from('channel_notification_prefs').select('*').eq('channel_id', channelId),
  ])
  const byId = {}
  ;(prefs || []).forEach(p => { byId[p.profile_id] = p })
  return (mem || [])
    .map(m => m.profile_id)
    .filter(id => id && id !== actorId)
    .map(id => {
      const p = byId[id]
      return p
        ? {
            profile_id: id,
            notify_all: !!p.notify_all,
            notify_mentions: !!p.notify_mentions,
            notify_from: p.notify_from || [],
            notify_keywords: p.notify_keywords || [],
          }
        : { profile_id: id, ...DEFAULT_PREFS }
    })
}

// Case-insensitive, whole-word keyword match. "cat" must not fire on "concatenate".
function matchesKeyword(body, keywords) {
  if (!keywords || !keywords.length) return false
  const text = String(body || '')
  return keywords.some(k => {
    const kw = String(k || '').trim()
    if (!kw) return false
    const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    try {
      return new RegExp(`(^|[^\\p{L}\\p{N}_])${esc}([^\\p{L}\\p{N}_]|$)`, 'iu').test(text)
    } catch {
      // fallback for engines without unicode property escapes
      return new RegExp(`(^|\\W)${esc}(\\W|$)`, 'i').test(text)
    }
  })
}

// ─── CHAT ─────────────────────────────────────────────────────────────────────

// Decide who gets notified about a new message, using each member's prefs.
//
// Notify a member if ANY of:
//   • notify_all
//   • notify_mentions AND (they were @named, or @here, or @update)
//   • the sender is in their notify_from[]
//   • the message body contains one of their notify_keywords[]
//   • it's a DM and they have notify_mentions on
//
// "None" = a prefs row with everything off/empty → never matches.
//
// `body` MUST be plain text (not HTML), or keywords will match tag names.
export async function notifyChatMessage({
  channelId, channelName, isDm, actorId, actorName,
  isHere, requiresAck, body, mentionedIds = [],
}) {
  const prefs = await channelPrefs(channelId, actorId)
  if (!prefs.length) return

  const mentioned = new Set(mentionedIds || [])
  const where = isDm ? 'a direct message' : `#${channelName}`

  const rows = []
  for (const p of prefs) {
    const isMentioned = mentioned.has(p.profile_id) || !!isHere || !!requiresAck

    const hit =
      p.notify_all ||
      (p.notify_mentions && isMentioned) ||
      p.notify_from.includes(actorId) ||
      matchesKeyword(body, p.notify_keywords) ||
      (isDm && p.notify_mentions)

    if (!hit) continue

    const type = requiresAck ? 'chat_update'
      : isHere ? 'chat_here'
      : isDm ? 'chat_dm'
      : mentioned.has(p.profile_id) ? 'chat_mention'
      : 'chat_message'

    const title = requiresAck ? `New update in ${where} — please confirm`
      : isHere ? `${actorName} flagged everyone in ${where}`
      : isDm ? `New message from ${actorName}`
      : mentioned.has(p.profile_id) ? `${actorName} mentioned you in ${where}`
      : `${actorName} posted in ${where}`

    rows.push({
      recipient_id: p.profile_id, type, title, body: null, link: '/chat',
      actor_id: actorId, actor_name: actorName,
    })
  }
  await insertMany(rows)
}

// Kept for compatibility. Chat.jsx no longer calls this for normal sends —
// notifyChatMessage handles mentions now, so calling both would double-notify.
// Still useful if you ever need to notify a mention outside the send path.
export async function notifyChatMention({ recipientIds, actorId, actorName, channelName, isDm, addedIds }) {
  const ids = (recipientIds || []).filter(id => id && id !== actorId)
  const where = isDm ? 'a direct message' : `#${channelName}`
  const added = addedIds || []
  await insertMany(ids.map(rid => ({
    recipient_id: rid, type: 'chat_mention',
    title: `${actorName} mentioned you in ${where}`,
    body: added.includes(rid) ? `You were mentioned and added to ${where}.` : null,
    link: '/chat', actor_id: actorId, actor_name: actorName,
  })))
}

// Nudges bypass prefs on purpose — an admin is directly asking this person.
export async function notifyAckNudge({ recipientId, actorId, actorName, channelName }) {
  await insertMany([{
    recipient_id: recipientId, type: 'ack_nudge',
    title: `Reminder: please confirm the update${channelName ? ` in #${channelName}` : ''}`,
    body: `${actorName} nudged you to confirm you've read it.`,
    link: '/chat', actor_id: actorId, actor_name: actorName,
  }])
}

// Being added to a channel bypasses prefs — you have no prefs there yet.
export async function notifyChannelAdded({ recipientIds, actorId, actorName, channelName, isDm }) {
  const ids = (recipientIds || []).filter(id => id && id !== actorId)
  await insertMany(ids.map(rid => ({
    recipient_id: rid, type: 'channel_added',
    title: isDm ? `${actorName} started a direct message with you` : `You were added to #${channelName}`,
    body: null, link: '/chat', actor_id: actorId, actor_name: actorName,
  })))
}

// ─── SCHEDULE ─────────────────────────────────────────────────────────────────

export async function notifyIntervalReleased({ eligibleIds, actorId, actorName, when, position }) {
  const ids = (eligibleIds || []).filter(id => id && id !== actorId)
  await insertMany(ids.map(rid => ({
    recipient_id: rid, type: 'interval_released',
    title: `An interval just opened up`,
    body: `${position ? position + ' · ' : ''}${when} — released by ${actorName}. Claim it if you want it.`,
    link: '/schedule', actor_id: actorId, actor_name: actorName,
  })))
}

export async function notifyNoShow({ recipientId, when }) {
  await insertMany([{
    recipient_id: recipientId, type: 'no_show',
    title: `You were marked a no-show`,
    body: when ? `For your interval ${when}.` : null,
    link: '/schedule', actor_id: null, actor_name: null,
  }])
}

// ─── PROJECTS MODULE ──────────────────────────────────────────────────────────
// Task events routed to the notification bell (replaces Connecteam).

export async function notifyTaskAssigned({ recipientIds, actorId, actorName, taskName, projectName, taskId }) {
  const ids = (recipientIds || []).filter(id => id && id !== actorId)
  const link = taskId ? `/projects?task=${taskId}` : '/projects'
  await insertMany(ids.map(rid => ({
    recipient_id: rid, type: 'task_assigned',
    title: `You were assigned a task`,
    body: `"${taskName}"${projectName ? ' in ' + projectName : ''}${actorName ? ' — by ' + actorName : ''}.`,
    link, actor_id: actorId, actor_name: actorName,
  })))
}

export async function notifyTaskCompleted({ recipientId, actorId, actorName, taskName, projectName, taskId }) {
  if (!recipientId || recipientId === actorId) return
  const link = taskId ? `/projects?task=${taskId}` : '/projects'
  await insertMany([{
    recipient_id: recipientId, type: 'task_completed',
    title: `A task you created was completed`,
    body: `${actorName || 'Someone'} marked "${taskName}"${projectName ? ' in ' + projectName : ''} as Done.`,
    link, actor_id: actorId, actor_name: actorName,
  }])
}

export async function notifyTaskMention({ recipientIds, actorId, actorName, taskName, where, taskId }) {
  const ids = (recipientIds || []).filter(id => id && id !== actorId)
  const link = taskId ? `/projects?task=${taskId}` : '/projects'
  await insertMany(ids.map(rid => ({
    recipient_id: rid, type: 'task_mention',
    title: `${actorName || 'Someone'} mentioned you`,
    body: `In ${where || 'a note'} on "${taskName}".`,
    link, actor_id: actorId, actor_name: actorName,
  })))
}
