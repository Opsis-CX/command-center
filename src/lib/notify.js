import { supabase } from './supabase'

// ============================================================
// notify.js — helpers to create notifications for events.
// Call these from chat/schedule code when things happen.
// Each inserts one row per recipient. Never notify the actor.
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

export async function notifyChatMessage({ channelId, channelName, isDm, actorId, actorName, isHere, requiresAck }) {
  // Only notify for @here, @update, or DMs (not every message, to avoid spam).
  if (!isHere && !requiresAck && !isDm) return
  const recipients = await channelRecipients(channelId, actorId)
  const type = requiresAck ? 'chat_update' : isHere ? 'chat_here' : 'chat_dm'
  const where = isDm ? 'a direct message' : `#${channelName}`
  const title = requiresAck ? `New update in ${where} — please confirm`
    : isHere ? `${actorName} flagged everyone in ${where}`
    : `New message from ${actorName}`
  await insertMany(recipients.map(rid => ({
    recipient_id: rid, type, title, body: null, link: '/chat',
    actor_id: actorId, actor_name: actorName,
  })))
}

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

export async function notifyAckNudge({ recipientId, actorId, actorName, channelName }) {
  await insertMany([{
    recipient_id: recipientId, type: 'ack_nudge',
    title: `Reminder: please confirm the update${channelName ? ` in #${channelName}` : ''}`,
    body: `${actorName} nudged you to confirm you've read it.`,
    link: '/chat', actor_id: actorId, actor_name: actorName,
  }])
}

export async function notifyChannelAdded({ recipientIds, actorId, actorName, channelName, isDm }) {
  const ids = (recipientIds || []).filter(id => id && id !== actorId)
  await insertMany(ids.map(rid => ({
    recipient_id: rid, type: 'channel_added',
    title: isDm ? `${actorName} started a direct message with you` : `You were added to #${channelName}`,
    body: null, link: '/chat', actor_id: actorId, actor_name: actorName,
  })))
}

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
