import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// ============================================================
// TASK ASSIGNED POPUP — a corner toast, mounted globally, so it shows up
// no matter what page you're on when someone assigns you a task.
//
// Driven entirely by the existing `notifyTaskAssigned()` helper in
// lib/notify.js, called from TaskModal.jsx whenever a task is created or
// edited with new assignees. That helper already does the "only when
// someone ELSE assigns it" filtering (it drops the actor from the
// recipient list before inserting), so this component doesn't need to
// re-check who created the task — if a `task_assigned` row exists here,
// it's already guaranteed to be from someone other than you.
//
// Mirrors LsaReminderPopup's proven poll + visibility-catch-up pattern
// (simpler and more reliable than a realtime subscription for this),
// but as a small dismissable corner toast instead of a full-screen modal —
// a new task landing on your list isn't the same class of urgent as an
// LSA lead needing follow-up, so it shouldn't block the screen the same way.
// Shows one at a time; opening or dismissing marks it read and reveals the
// next one, if there's a backlog.
// ============================================================

const POLL_MS = 20_000
// Only ever consider notifications from roughly the last day — otherwise the
// very first time this loads for anyone, it surfaces every historical
// unread task_assigned row (some from long before this popup even existed)
// as if they all just happened. "New tasks only" means recent ones only.
const MAX_AGE_MS = 24 * 60 * 60 * 1000
// How many recent unread candidates to pull per check. We look at a small
// batch rather than just one, because some of them may turn out to belong
// to a task that's since been completed — those get silently marked read
// and skipped rather than shown, so we need a few in reserve to fall
// through to.
const BATCH_SIZE = 15

function taskIdFromLink(link) {
  if (!link) return null
  const m = /[?&]task=([^&]+)/.exec(link)
  return m ? decodeURIComponent(m[1]) : null
}

export default function TaskAssignedPopup() {
  const [due, setDue] = useState(null) // a notifications row
  const [visible, setVisible] = useState(false)
  const navigate = useNavigate()
  const busyRef = useRef(false)

  const check = useCallback(async () => {
    if (due) return // don't stack a new toast on top of one still on screen
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const cutoff = new Date(Date.now() - MAX_AGE_MS).toISOString()
    const { data, error } = await supabase.from('notifications')
      .select('id, title, body, link, actor_name, created_at')
      .eq('recipient_id', user.id)
      .eq('type', 'task_assigned')
      .is('read_at', null)
      .is('dismissed_at', null)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(BATCH_SIZE)
    if (error || !Array.isArray(data) || data.length === 0) return

    // Look up the current status of every task in this batch in one call,
    // so we can skip anything that's already been completed since the
    // notification was created — no point popping up a toast for a task
    // that's already done.
    const taskIds = [...new Set(data.map(n => taskIdFromLink(n.link)).filter(Boolean))]
    let statusById = {}
    if (taskIds.length) {
      const { data: tasksData } = await supabase.from('tasks')
        .select('id, status, deleted_at').in('id', taskIds)
      statusById = Object.fromEntries((tasksData || []).map(t => [t.id, t]))
    }

    const staleIds = []
    let next = null
    for (const n of data) {
      const taskId = taskIdFromLink(n.link)
      const task = taskId ? statusById[taskId] : null
      const isStale = taskId && (!task || task.status === 'done' || task.deleted_at)
      if (isStale) { staleIds.push(n.id); continue }
      next = n
      break
    }
    // Clear out anything stale so it never gets re-checked (and stops
    // showing an unread badge for a task that's already finished).
    if (staleIds.length) {
      supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', staleIds)
        .then(() => {})
    }
    if (!next) return
    setDue(next)
    // tiny delay so the mount animates in rather than just appearing
    requestAnimationFrame(() => setVisible(true))
  }, [due])

  useEffect(() => {
    check()
    const id = setInterval(check, POLL_MS)
    const onVis = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis) }
  }, [check])

  const resolve = useCallback(async () => {
    if (!due || busyRef.current) return null
    busyRef.current = true
    const link = due.link
    setVisible(false)
    try {
      await supabase.from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', due.id)
    } catch { /* best-effort; never trap the user behind a stuck toast */ }
    // let the fade-out play before clearing, so the next one (if any) doesn't pop in instantly
    setTimeout(() => { setDue(null); busyRef.current = false }, 200)
    return link
  }, [due])

  async function dismiss() { await resolve() }

  async function open() {
    const link = await resolve()
    navigate(link || '/projects')
  }

  // Auto-dismiss after 12s if nobody touches it — a toast that sits forever
  // isn't really a toast, and the item is still waiting in the bell either way.
  useEffect(() => {
    if (!due) return
    const t = setTimeout(dismiss, 12_000)
    return () => clearTimeout(t)
  }, [due]) // eslint-disable-line

  if (!due) return null
  const accent = '#0f766e'

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed', bottom: 24, right: 24, zIndex: 90000,
        width: 'min(360px, calc(100vw - 32px))',
        transform: visible ? 'translateY(0)' : 'translateY(12px)',
        opacity: visible ? 1 : 0,
        transition: 'transform .22s ease, opacity .22s ease',
      }}
    >
      <div style={{
        background: 'var(--surface, #fff)', color: 'var(--ink, #0f172a)',
        borderRadius: 14, borderLeft: `5px solid ${accent}`,
        boxShadow: '0 14px 36px rgba(0,0,0,.22)', padding: '16px 18px',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ fontSize: 20, lineHeight: 1, marginTop: 1 }}>📋</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: accent }}>
              {due.title || 'You were assigned a task'}
            </div>
            {due.body && (
              <div style={{ fontSize: 13, color: 'var(--ink-soft, #64748b)', marginTop: 4, lineHeight: 1.4 }}>
                {due.body}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={open} style={{
                background: accent, color: '#fff', border: 'none', fontWeight: 700,
                padding: '8px 16px', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
              }}>
                View task
              </button>
              <button onClick={dismiss} style={{
                background: 'transparent', color: 'var(--ink-soft, #64748b)',
                border: '1px solid var(--line, #e2e8f0)', fontWeight: 600,
                padding: '8px 14px', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
              }}>
                Dismiss
              </button>
            </div>
          </div>
          <button onClick={dismiss} aria-label="Dismiss"
            style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--ink-soft, #94a3b8)', fontSize: 16, lineHeight: 1, padding: 2, flex: 'none' }}>
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}

