import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'

// ============================================================
// UnreadProvider — tracks unread chat messages per channel and
// in total, live (no refresh). Lives above Chat + Sidebar so
// both can read it. Also sets the app icon badge (where supported).
//
//   const { counts, total, markRead, refreshUnread } = useUnread()
//   counts = { [channelId]: number }
// ============================================================

const UnreadContext = createContext({ counts: {}, total: 0, markRead: () => {}, refreshUnread: () => {} })
export const useUnread = () => useContext(UnreadContext)

export function UnreadProvider({ children }) {
  const { user } = useAuth()
  const meId = user?.id
  const [counts, setCounts] = useState({})           // channelId -> unread count
  const [myChannels, setMyChannels] = useState([])   // channel ids I'm a member of
  const lastRead = useRef({})                        // channelId -> ISO string

  // Compute unread counts from scratch: for each of my channels, count
  // messages newer than my last_read_at that I didn't send.
  const refreshUnread = useCallback(async () => {
    if (!meId) return
    // my channels + my prefs (last_read_at)
    const { data: mem } = await supabase.from('channel_members')
      .select('channel_id').eq('profile_id', meId)
    const chIds = (mem || []).map(m => m.channel_id)
    setMyChannels(chIds)
    if (!chIds.length) { setCounts({}); return }

    const { data: prefs } = await supabase.from('channel_prefs')
      .select('channel_id, last_read_at').eq('profile_id', meId).in('channel_id', chIds)
    const readMap = {}
    ;(prefs || []).forEach(p => { readMap[p.channel_id] = p.last_read_at })
    lastRead.current = readMap

    // pull recent messages for my channels and count unread client-side
    const { data: msgs } = await supabase.from('messages')
      .select('id, channel_id, sender_id, created_at, parent_id')
      .in('channel_id', chIds)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(500)

    const next = {}
    ;(msgs || []).forEach(m => {
      if (m.sender_id === meId) return           // my own messages never unread
      const since = readMap[m.channel_id]
      if (!since || new Date(m.created_at) > new Date(since)) {
        next[m.channel_id] = (next[m.channel_id] || 0) + 1
      }
    })
    setCounts(next)
  }, [meId])

  useEffect(() => { refreshUnread() }, [refreshUnread])

  // Live: when ANY new message arrives, if it's in one of my channels and
  // not from me, bump that channel's count.
  useEffect(() => {
    if (!meId || !myChannels.length) return
    const ch = supabase.channel('unread-watch')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const m = payload.new
          if (!m || m.sender_id === meId) return
          if (!myChannels.includes(m.channel_id)) return
          setCounts(prev => ({ ...prev, [m.channel_id]: (prev[m.channel_id] || 0) + 1 }))
        })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [meId, myChannels])

  // Mark a channel read: clear its count + persist last_read_at = now.
  const markRead = useCallback(async (channelId) => {
    if (!meId || !channelId) return
    setCounts(prev => { if (!prev[channelId]) return prev; const n = { ...prev }; delete n[channelId]; return n })
    const nowIso = new Date().toISOString()
    lastRead.current[channelId] = nowIso
    const { error } = await supabase.from('channel_prefs')
      .upsert({ profile_id: meId, channel_id: channelId, last_read_at: nowIso }, { onConflict: 'profile_id,channel_id' })
    if (error) console.error('markRead upsert failed:', error.message, error)
  }, [meId])

  const total = Object.values(counts).reduce((s, n) => s + n, 0)

  // App icon badge (works on desktop Chrome/Edge + some Android; iOS ignores it).
  useEffect(() => {
    try {
      if ('setAppBadge' in navigator) {
        if (total > 0) navigator.setAppBadge(total)
        else navigator.clearAppBadge?.()
      }
    } catch { /* badging unsupported — ignore */ }
  }, [total])

  return (
    <UnreadContext.Provider value={{ counts, total, markRead, refreshUnread }}>
      {children}
    </UnreadContext.Provider>
  )
}
