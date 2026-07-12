import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { NOTIF_CATEGORIES, categoryForType, CATEGORY_LABEL } from '../lib/notify'

// ============================================================
// Notifications — full history page.
// - Lists notifications (not just the latest 50 the bell shows).
// - Filter by category.
// - Mark read / mark all read.
// - Archive (non-destructive: sets dismissed_at) instead of hard delete.
// - Realtime: new rows appear at the top.
// ============================================================

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24); if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const PAGE_SIZE = 30

export default function Notifications() {
  const [items, setItems] = useState([])
  const [meId, setMeId] = useState(null)
  const [filter, setFilter] = useState('all')     // 'all' | category key
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const navigate = useNavigate()

  const load = useCallback(async (opts = {}) => {
    const { append = false, before = null } = opts
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }
    setMeId(user.id)

    let q = supabase.from('notifications')
      .select('*').eq('recipient_id', user.id)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE)
    if (!showArchived) q = q.is('dismissed_at', null)
    if (before) q = q.lt('created_at', before)

    const { data, error } = await q
    if (error) { console.error(error); setLoading(false); return }
    const rows = data || []
    setHasMore(rows.length === PAGE_SIZE)
    setItems(prev => append ? [...prev, ...rows] : rows)
    setLoading(false)
  }, [showArchived])

  useEffect(() => { setLoading(true); load() }, [load])

  // realtime: prepend new notifications for me
  useEffect(() => {
    if (!meId) return
    const ch = supabase.channel(`notif-page:${meId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${meId}` },
        (payload) => setItems(prev => prev.some(x => x.id === payload.new.id) ? prev : [payload.new, ...prev]))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [meId])

  const shown = items.filter(n => filter === 'all' || categoryForType(n.type) === filter)
  const unreadCount = items.filter(n => !n.read_at && !n.dismissed_at).length

  async function markRead(n) {
    if (n.read_at) return
    setItems(prev => prev.map(x => x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x))
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id)
  }

  async function openItem(n) {
    await markRead(n)
    if (n.link) navigate(n.link)
  }

  async function markAllRead() {
    const ids = items.filter(n => !n.read_at).map(n => n.id)
    if (!ids.length) return
    const now = new Date().toISOString()
    setItems(prev => prev.map(n => n.read_at ? n : { ...n, read_at: now }))
    await supabase.from('notifications').update({ read_at: now }).in('id', ids)
  }

  async function archive(n, e) {
    e.stopPropagation()
    const now = new Date().toISOString()
    setItems(prev => showArchived
      ? prev.map(x => x.id === n.id ? { ...x, dismissed_at: now } : x)
      : prev.filter(x => x.id !== n.id))
    await supabase.from('notifications').update({ dismissed_at: now }).eq('id', n.id)
  }

  async function archiveAllVisible() {
    const ids = shown.filter(n => !n.dismissed_at).map(n => n.id)
    if (!ids.length) return
    const now = new Date().toISOString()
    setItems(prev => prev.filter(x => !ids.includes(x.id)))
    await supabase.from('notifications').update({ dismissed_at: now }).in('id', ids)
  }

  const pill = (active) => ({
    border: '1px solid var(--line)', borderRadius: 999, padding: '5px 12px', fontSize: 12.5,
    cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
    background: active ? 'var(--accent, #0077B6)' : 'var(--surface)',
    color: active ? '#fff' : 'var(--ink-soft)',
  })

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Notifications</h1>
        <p className="page-sub">Everything that's happened, in one place. Manage how you're notified in Settings.</p>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <button style={pill(filter === 'all')} onClick={() => setFilter('all')}>All</button>
        {NOTIF_CATEGORIES.map(c => (
          <button key={c.key} style={pill(filter === c.key)} onClick={() => setFilter(c.key)}>{c.label}</button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
          {unreadCount > 0 && (
            <button onClick={markAllRead} style={{ border: 0, background: 'transparent', color: 'var(--accent)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
              Mark all read
            </button>
          )}
          {shown.length > 0 && !showArchived && (
            <button onClick={archiveAllVisible} style={{ border: 0, background: 'transparent', color: 'var(--ink-soft)', fontSize: 12.5, cursor: 'pointer' }}>
              Archive shown
            </button>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--ink-soft)', cursor: 'pointer' }}>
            <input type="checkbox" checked={showArchived} onChange={e => { setShowArchived(e.target.checked); setLoading(true) }} />
            Show archived
          </label>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 28, textAlign: 'center', color: 'var(--ink-soft)', fontSize: 13 }}>Loading…</div>
        ) : shown.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-soft)', fontSize: 13 }}>
            {showArchived ? 'Nothing archived.' : "You're all caught up 🎉"}
          </div>
        ) : shown.map(n => (
          <div key={n.id} onClick={() => openItem(n)}
            style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '13px 16px',
              borderBottom: '1px solid var(--line-soft)', cursor: 'pointer',
              background: n.read_at ? 'transparent' : 'var(--accent-bg)' }}>
            {!n.read_at && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', marginTop: 6, flex: 'none' }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{n.title}</span>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink-soft)', background: 'var(--line-soft)', borderRadius: 4, padding: '1px 6px' }}>
                  {CATEGORY_LABEL[categoryForType(n.type)]}
                </span>
              </div>
              {n.body && <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 2 }}>{n.body}</div>}
              <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 3 }}>{timeAgo(n.created_at)}</div>
            </div>
            <button onClick={(e) => archive(n, e)} title="Archive"
              style={{ border: 0, background: 'transparent', color: 'var(--ink-soft)', cursor: 'pointer', fontSize: 15, padding: 4, flex: 'none' }}>
              {showArchived ? '↩' : '✕'}
            </button>
          </div>
        ))}
      </div>

      {hasMore && !showArchived && (
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button onClick={() => load({ append: true, before: items[items.length - 1]?.created_at })}
            style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
            Load more
          </button>
        </div>
      )}
    </div>
  )
}
