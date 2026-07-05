import React, { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

// ============================================================
// CHAT — Stage 1
// Channels + real-time messages. Admins create channels and
// add members. Messages stream live via Supabase Realtime.
// ============================================================

function initials(name) {
  const p = (name || '?').trim().split(/\s+/); return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?'
}
function avatarColor(name) {
  const colors = ['#0077B6', '#16A34A', '#D97706', '#7C3AED', '#DC2626', '#0891B2', '#DB2777', '#65A30D']
  let h = 0; for (const c of (name || '?')) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return colors[h % colors.length]
}
function timeLabel(iso) {
  const d = new Date(iso); const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  return sameDay
    ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export default function Chat() {
  const { isAdmin } = useAuth()
  const [me, setMe] = useState(null)
  const [channels, setChannels] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const [meRes, chRes, profRes] = await Promise.all([
        supabase.from('profiles').select('id, full_name').eq('id', user.id).single(),
        supabase.from('channels').select('*').eq('is_dm', false).order('name'),
        supabase.from('profiles').select('id, full_name, is_active').eq('is_active', true).order('full_name'),
      ])
      if (chRes.error) throw chRes.error
      setMe(meRes.data)
      setChannels(chRes.data || [])
      setProfiles(profRes.data || [])
      if (!activeId && (chRes.data || []).length) setActiveId(chRes.data[0].id)
    } catch (e) { setErr(e.message) } finally { setLoading(false) }
  }, [activeId])

  useEffect(() => { load() }, [])

  if (loading) return <p className="page-sub">Loading chat…</p>

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 0, height: 'calc(100vh - 140px)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden', background: 'var(--surface)' }}>
      {/* Channel list */}
      <div style={{ borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', background: 'var(--canvas)' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <b style={{ fontSize: 14 }}>Channels</b>
          {isAdmin && <button className="btn btn-ghost" style={{ padding: '4px 9px', fontSize: 12 }} onClick={() => setShowCreate(true)}>+ New</button>}
        </div>
        <div style={{ overflowY: 'auto', flex: 1, padding: 8 }}>
          {channels.length === 0 && <div className="page-sub" style={{ padding: 12, fontSize: 12.5 }}>No channels yet.{isAdmin ? ' Create one with + New.' : ' An admin needs to add you to a channel.'}</div>}
          {channels.map(c => (
            <button key={c.id} onClick={() => setActiveId(c.id)}
              style={{ display: 'block', width: '100%', textAlign: 'left', border: 0, background: c.id === activeId ? 'var(--accent-bg)' : 'transparent', color: c.id === activeId ? 'var(--accent)' : 'var(--ink)', padding: '9px 11px', borderRadius: 8, fontSize: 13.5, fontWeight: 500, cursor: 'pointer', marginBottom: 2, fontFamily: 'inherit' }}>
              # {c.name}
            </button>
          ))}
        </div>
      </div>

      {/* Message pane */}
      {activeId
        ? <ChannelPane key={activeId} channelId={activeId} me={me} channel={channels.find(c => c.id === activeId)} />
        : <div style={{ display: 'grid', placeItems: 'center', color: 'var(--ink-soft)' }}>Select a channel</div>}

      {showCreate && <CreateChannelModal me={me} profiles={profiles}
        onClose={() => setShowCreate(false)}
        onCreated={(id) => { setShowCreate(false); load(); setActiveId(id) }} />}
    </div>
  )
}

function ChannelPane({ channelId, me, channel }) {
  const [messages, setMessages] = useState([])
  const [senders, setSenders] = useState({}) // id -> full_name
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const bottomRef = useRef(null)
  const scrollRef = useRef(null)

  // initial load
  useEffect(() => {
    let active = true
    ;(async () => {
      setLoading(true); setErr('')
      try {
        const { data, error } = await supabase.from('messages')
          .select('*').eq('channel_id', channelId).is('deleted_at', null)
          .order('created_at').limit(200)
        if (error) throw error
        if (!active) return
        setMessages(data || [])
        await hydrateSenders(data || [])
      } catch (e) { if (active) setErr(e.message) } finally { if (active) setLoading(false) }
    })()
    return () => { active = false }
  }, [channelId])

  async function hydrateSenders(msgs) {
    const ids = [...new Set(msgs.map(m => m.sender_id).filter(Boolean))]
    const missing = ids.filter(id => !(id in senders))
    if (!missing.length) return
    const { data } = await supabase.from('profiles').select('id, full_name').in('id', missing)
    if (data) setSenders(prev => { const n = { ...prev }; data.forEach(p => n[p.id] = p.full_name); return n })
  }

  // realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel(`messages:${channelId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `channel_id=eq.${channelId}` },
        async (payload) => {
          const m = payload.new
          setMessages(prev => prev.some(x => x.id === m.id) ? prev : [...prev, m])
          if (m.sender_id && !(m.sender_id in senders)) {
            const { data } = await supabase.from('profiles').select('id, full_name').eq('id', m.sender_id).single()
            if (data) setSenders(prev => ({ ...prev, [data.id]: data.full_name }))
          }
        })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [channelId, senders])

  // autoscroll on new messages
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function send() {
    const body = text.trim()
    if (!body) return
    setText('')
    // optimistic
    const temp = { id: 'temp-' + Date.now(), channel_id: channelId, sender_id: me.id, body, created_at: new Date().toISOString(), _optimistic: true }
    setMessages(prev => [...prev, temp])
    const { data, error } = await supabase.from('messages').insert({ channel_id: channelId, sender_id: me.id, body }).select().single()
    if (error) {
      setErr(error.message)
      setMessages(prev => prev.filter(m => m.id !== temp.id))
      setText(body)
      return
    }
    // replace temp with real (realtime may also deliver it; dedupe by id)
    setMessages(prev => prev.filter(m => m.id !== temp.id && m.id !== data.id).concat(data))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
        <b style={{ fontSize: 15 }}># {channel?.name}</b>
        {channel?.description && <div className="page-sub" style={{ fontSize: 12.5 }}>{channel.description}</div>}
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>
        {loading ? <div className="page-sub">Loading messages…</div>
          : err ? <div style={{ color: 'var(--failed)', fontSize: 13 }}>{err}</div>
          : messages.length === 0 ? <div className="page-sub" style={{ textAlign: 'center', padding: 30 }}>No messages yet. Say hello 👋</div>
          : messages.map((m, i) => {
            const prev = messages[i - 1]
            const grouped = prev && prev.sender_id === m.sender_id && (new Date(m.created_at) - new Date(prev.created_at) < 5 * 60000)
            const name = m.sender_id === me.id ? 'You' : (senders[m.sender_id] || 'Someone')
            return (
              <div key={m.id} style={{ display: 'flex', gap: 10, marginTop: grouped ? 2 : 12, opacity: m._optimistic ? 0.6 : 1 }}>
                <div style={{ width: 32, flex: 'none' }}>
                  {!grouped && <div style={{ width: 32, height: 32, borderRadius: '50%', background: avatarColor(name), color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700 }}>{initials(name)}</div>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {!grouped && <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
                    <b style={{ fontSize: 13.5 }}>{name}</b>
                    <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{timeLabel(m.created_at)}</span>
                  </div>}
                  <div style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.body}</div>
                </div>
              </div>
            )
          })}
        <div ref={bottomRef} />
      </div>

      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--line)', display: 'flex', gap: 8 }}>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder={`Message #${channel?.name || ''}`}
          rows={1}
          style={{ flex: 1, resize: 'none', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', outline: 'none', maxHeight: 120 }}
        />
        <button className="btn btn-primary" onClick={send} disabled={!text.trim()}>Send</button>
      </div>
    </div>
  )
}

function CreateChannelModal({ me, profiles, onClose, onCreated }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [picked, setPicked] = useState(() => new Set([me.id])) // creator auto-included
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  function toggle(id) { setPicked(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n }) }

  async function create() {
    const nm = name.trim()
    if (!nm) { setErr('Name the channel.'); return }
    setSaving(true); setErr('')
    try {
      const { data: ch, error: ce } = await supabase.from('channels')
        .insert({ name: nm, description: description.trim() || null, is_dm: false, created_by: me.id })
        .select().single()
      if (ce) throw ce
      const members = new Set(picked); members.add(me.id)
      const rows = [...members].map(pid => ({ channel_id: ch.id, profile_id: pid }))
      const { error: me2 } = await supabase.from('channel_members').insert(rows)
      if (me2) throw me2
      onCreated(ch.id)
    } catch (e) { setErr(e.message); setSaving(false) }
  }

  return (
    <div className="modal-back open" onClick={e => { if (e.target.classList.contains('modal-back')) onClose() }}>
      <div className="modal">
        <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600 }}>New channel</h3>
        <p className="page-sub" style={{ marginBottom: 18 }}>Create a channel and add members.</p>
        {err && <div className="login-err" style={{ marginBottom: 14 }}>{err}</div>}
        <div className="field"><label>Channel name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. general, garageco-team" autoFocus /></div>
        <div className="field"><label>Description <span style={{ fontWeight: 400 }}>(optional)</span></label>
          <input value={description} onChange={e => setDescription(e.target.value)} placeholder="What's this channel for?" /></div>
        <div className="field">
          <label>Members</label>
          <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 8, maxHeight: 220, overflow: 'auto' }}>
            {profiles.map(p => (
              <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 8px', borderRadius: 6, cursor: p.id === me.id ? 'default' : 'pointer', background: picked.has(p.id) ? 'var(--accent-bg)' : 'transparent' }}>
                <input type="checkbox" checked={picked.has(p.id)} disabled={p.id === me.id} onChange={() => toggle(p.id)} />
                <span style={{ fontSize: 13.5, fontWeight: 500 }}>{p.full_name}{p.id === me.id ? ' (you)' : ''}</span>
              </label>
            ))}
          </div>
          <div className="hint">{picked.size} member{picked.size !== 1 ? 's' : ''}</div>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={create} disabled={saving}>{saving ? 'Creating…' : 'Create channel'}</button>
        </div>
      </div>
    </div>
  )
}
