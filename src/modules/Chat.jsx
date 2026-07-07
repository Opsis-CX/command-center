import React, { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { notifyChatMessage, notifyAckNudge, notifyChannelAdded, notifyChatMention } from '../lib/notify'
import { useUnread } from '../lib/unread'
import EmojiPicker from 'emoji-picker-react'
// ============================================================
// CHAT — Stage 1 + @update acknowledgments + @here
// Admins can post @update messages that require confirmation.
// Everyone sees a Confirm button; admins track who has/hasn't
// and can nudge non-confirmers.
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
// True when the viewport is phone-width. Updates on resize.
function useIsMobile(breakpoint = 700) {
  const [mobile, setMobile] = useState(typeof window !== 'undefined' ? window.innerWidth <= breakpoint : false)
  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth <= breakpoint)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [breakpoint])
  return mobile
}

// Ephemeral typing indicator over Supabase Realtime broadcast.
// topic: unique channel key (e.g. `typing:<channelId>` or `typing:thread:<id>`)
// Returns { typers: [names], notifyTyping() }
function useTyping(topic, meId, meName) {
  const [typers, setTypers] = useState({})   // id -> { name, at }
  const chanRef = useRef(null)
  const lastSent = useRef(0)

  useEffect(() => {
    const ch = supabase.channel(topic, { config: { broadcast: { self: false } } })
    ch.on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (!payload || payload.id === meId) return
      setTypers(prev => ({ ...prev, [payload.id]: { name: payload.name, at: Date.now() } }))
    }).on('broadcast', { event: 'stop' }, ({ payload }) => {
      if (!payload) return
      setTypers(prev => { const n = { ...prev }; delete n[payload.id]; return n })
    }).subscribe()
    chanRef.current = ch
    // sweep out stale typers every second (in case a "stop" was missed)
    const sweep = setInterval(() => {
      setTypers(prev => {
        const now = Date.now(); let changed = false; const n = {}
        for (const [id, v] of Object.entries(prev)) { if (now - v.at < 4000) n[id] = v; else changed = true }
        return changed ? n : prev
      })
    }, 1000)
    return () => { clearInterval(sweep); supabase.removeChannel(ch) }
  }, [topic, meId])

  const notifyTyping = useCallback(() => {
    const now = Date.now()
    if (now - lastSent.current < 1500) return   // throttle broadcasts
    lastSent.current = now
    chanRef.current?.send({ type: 'broadcast', event: 'typing', payload: { id: meId, name: meName } })
  }, [meId, meName])

  const stopTyping = useCallback(() => {
    lastSent.current = 0
    chanRef.current?.send({ type: 'broadcast', event: 'stop', payload: { id: meId } })
  }, [meId])

  const names = Object.values(typers).map(t => t.name)
  return { typerNames: names, notifyTyping, stopTyping }
}

// ---- file attachments ----
const MAX_FILE_BYTES = 50 * 1024 * 1024 // 50MB

async function uploadChatFile(file, channelId, meId) {
  if (file.size > MAX_FILE_BYTES) throw new Error(`"${file.name}" is over 50MB.`)
  const ext = file.name.includes('.') ? file.name.split('.').pop() : 'bin'
  const rand = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()))
  const path = `${channelId}/${rand}.${ext}`
  const { error: upErr } = await supabase.storage.from('chat-attachments').upload(path, file, { contentType: file.type || undefined, upsert: false })
  if (upErr) throw upErr
  const { data: pub } = supabase.storage.from('chat-attachments').getPublicUrl(path)
  return { file_name: file.name, file_type: file.type || '', file_size: file.size, storage_path: path, public_url: pub.publicUrl }
}

function humanSize(bytes) {
  if (!bytes) return ''
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0; let n = bytes
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`
}

function AttachmentView({ att }) {
  const type = att.file_type || ''
  const isImg = type.startsWith('image/')
  const isVid = type.startsWith('video/')
  if (isImg) {
    return (
      <a href={att.public_url} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 6 }}>
        <img src={att.public_url} alt={att.file_name} style={{ maxWidth: 280, maxHeight: 240, borderRadius: 8, border: '1px solid var(--line)', display: 'block' }} />
      </a>
    )
  }
  if (isVid) {
    return (
      <video src={att.public_url} controls style={{ maxWidth: 320, maxHeight: 260, borderRadius: 8, border: '1px solid var(--line)', marginTop: 6, display: 'block' }} />
    )
  }
  // generic file card
  return (
    <a href={att.public_url} target="_blank" rel="noreferrer"
      style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--canvas)', textDecoration: 'none', color: 'var(--ink)', maxWidth: 300 }}>
      <span style={{ fontSize: 22 }}>📄</span>
      <span style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{att.file_name}</div>
        <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{humanSize(att.file_size)} · Download</div>
      </span>
    </a>
  )
}

// Renders "X is typing…" / "X and Y are typing…"
function TypingLine({ names }) {
  if (!names.length) return null
  let text
  if (names.length === 1) text = `${names[0]} is typing…`
  else if (names.length === 2) text = `${names[0]} and ${names[1]} are typing…`
  else text = `${names[0]}, ${names[1]} and ${names.length - 2} more are typing…`
  return (
    <div style={{ padding: '2px 18px 4px', fontSize: 12, color: 'var(--ink-soft)', fontStyle: 'italic', minHeight: 18 }}>{text}</div>
  )
}
// ---- @mention helpers ----
// Extract profile ids for names mentioned as "@Full Name" in body.
function extractMentions(body, profiles) {
  const found = []
  for (const p of profiles) {
    if (!p.full_name) continue
    // match @Full Name (word-boundary, case-insensitive)
    const re = new RegExp('@' + p.full_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=\\s|$|[^\\w])', 'i')
    if (re.test(body)) found.push(p.id)
  }
  return found
}

// A textarea with @mention autocomplete. Shows ALL provided people.
function MentionTextarea({ value, onChange, onEnter, profiles, placeholder, rows = 1, style, accent }) {
  const ref = useRef(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [anchor, setAnchor] = useState(0)  // index of the '@'
  const [hi, setHi] = useState(0)

  const matches = open
    ? profiles.filter(p => p.full_name?.toLowerCase().includes(query.toLowerCase())).slice(0, 6)
    : []

  function handleChange(e) {
    const val = e.target.value
    onChange(val)
    // detect an active @token immediately left of the caret
    const caret = e.target.selectionStart
    const upto = val.slice(0, caret)
    const m = upto.match(/@([\w]*)$/)
    if (m) {
      setOpen(true); setQuery(m[1]); setAnchor(caret - m[1].length - 1); setHi(0)
    } else {
      setOpen(false); setQuery('')
    }
  }

  function pick(p) {
    // replace "@query" (from anchor to caret) with "@Full Name "
    const caret = ref.current.selectionStart
    const before = value.slice(0, anchor)
    const after = value.slice(caret)
    const next = before + '@' + p.full_name + ' ' + after
    onChange(next)
    setOpen(false); setQuery('')
    setTimeout(() => { ref.current?.focus() }, 0)
  }

  function handleKey(e) {
    if (open && matches.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => (h + 1) % matches.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => (h - 1 + matches.length) % matches.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(matches[hi]); return }
      if (e.key === 'Escape') { setOpen(false); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onEnter?.() }
  }

  return (
    <div style={{ position: 'relative', flex: 1 }}>
      {open && matches.length > 0 && (
        <div style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 6, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,.12)', zIndex: 60, width: 240, overflow: 'hidden' }}>
          {matches.map((p, i) => (
            <button key={p.id} type="button" onMouseDown={(ev) => { ev.preventDefault(); pick(p) }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', border: 0, cursor: 'pointer', padding: '8px 10px', fontSize: 13, fontFamily: 'inherit', background: i === hi ? 'var(--accent-bg)' : 'transparent', color: 'var(--ink)' }}>
              <span style={{ width: 22, height: 22, borderRadius: '50%', background: avatarColor(p.full_name), color: '#fff', display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 700 }}>{initials(p.full_name)}</span>
              {p.full_name}
            </button>
          ))}
        </div>
      )}
      <textarea ref={ref} value={value} onChange={handleChange} onKeyDown={handleKey}
        placeholder={placeholder} rows={rows}
        style={{ ...style, width: '100%', border: '1px solid ' + (accent || 'var(--line)'), boxSizing: 'border-box' }} />
    </div>
  )
}

export default function Chat() {
  const { isAdmin, level } = useAuth()
  const isOwner = (level || 0) >= 100
  const isMobile = useIsMobile()
  const { counts: unreadCounts, markRead } = useUnread()
  const [me, setMe] = useState(null)
  const [channels, setChannels] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [showDM, setShowDM] = useState(false)
  const [dmNames, setDmNames] = useState({}) // channelId -> other person's name
  const [mobileView, setMobileView] = useState('list') // 'list' | 'convo' (mobile only)
  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const [meRes, chRes, profRes] = await Promise.all([
        supabase.from('profiles').select('id, full_name').eq('id', user.id).single(),
        supabase.from('channels').select('*').order('name'),
        supabase.from('profiles').select('id, full_name, is_active').eq('is_active', true).order('full_name'),
      ])
      if (chRes.error) throw chRes.error
      setMe(meRes.data)
      setChannels(chRes.data || [])
      setProfiles(profRes.data || [])
      const all = chRes.data || []
      if (!activeId && all.length && window.innerWidth > 700) setActiveId(all[0].id)
      // for DMs, find the other member's name
      const dmChannels = all.filter(c => c.is_dm)
      if (dmChannels.length) {
        const { data: mem } = await supabase.from('channel_members')
          .select('channel_id, profile_id').in('channel_id', dmChannels.map(c => c.id))
        const otherIds = {}
        dmChannels.forEach(c => {
          const others = (mem || []).filter(m => m.channel_id === c.id && m.profile_id !== meRes.data.id)
          if (others[0]) otherIds[c.id] = others[0].profile_id
        })
        const ids = [...new Set(Object.values(otherIds))]
        if (ids.length) {
          const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', ids)
          const nameById = {}; (profs || []).forEach(p => nameById[p.id] = p.full_name)
          const map = {}; Object.entries(otherIds).forEach(([cid, pid]) => map[cid] = nameById[pid] || 'Unknown')
          setDmNames(map)
        }
      }
    } catch (e) { setErr(e.message) } finally { setLoading(false) }
  }, [activeId])
  useEffect(() => { load() }, [])

  async function deleteChannel(ch) {
    const label = ch.is_dm ? (dmNames[ch.id] || 'this direct message') : `#${ch.name}`
    if (!window.confirm(`Delete ${label}? This permanently removes the conversation and all its messages for everyone. This cannot be undone.`)) return
    const { error } = await supabase.from('channels').delete().eq('id', ch.id)
    if (error) { window.alert('Could not delete: ' + error.message); return }
    if (activeId === ch.id) { setActiveId(null); setMobileView('list') }
    load()
  }
  if (loading) return <p className="page-sub">Loading chat…</p>

  const openChannel = (id) => { setActiveId(id); setMobileView('convo'); markRead(id) }
  // On mobile, show either the list or the conversation. On desktop, both.
  const showList = !isMobile || mobileView === 'list'
  const showConvo = !isMobile || mobileView === 'convo'

  return (
    <div style={{ display: isMobile ? 'block' : 'grid', gridTemplateColumns: '240px 1fr', gap: 0, height: 'calc(100dvh - 150px)', maxHeight: 'calc(100dvh - 150px)', minHeight: 420, border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden', background: 'var(--surface)' }}>
      {showList && (
        <div style={{ borderRight: isMobile ? 'none' : '1px solid var(--line)', display: 'flex', flexDirection: 'column', background: 'var(--canvas)', minHeight: 0, height: isMobile ? '100%' : 'auto' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flex: 'none' }}>
            <b style={{ fontSize: 14 }}>Channels</b>
            {isAdmin && <button className="btn btn-ghost" style={{ padding: '4px 9px', fontSize: 12 }} onClick={() => setShowCreate(true)}>+ New</button>}
          </div>
          <div style={{ overflowY: 'auto', flex: 1, padding: 8, minHeight: 0 }}>
            {channels.filter(c => !c.is_dm).length === 0 && <div className="page-sub" style={{ padding: 12, fontSize: 12.5 }}>No channels yet.{isAdmin ? ' Create one with + New.' : ' An admin needs to add you to a channel.'}</div>}
            {channels.filter(c => !c.is_dm).map(c => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 2, marginBottom: 2 }}>
                <button onClick={() => openChannel(c.id)}
                  style={{ display: 'flex', alignItems: 'center', flex: 1, textAlign: 'left', border: 0, background: c.id === activeId && !isMobile ? 'var(--accent-bg)' : 'transparent', color: c.id === activeId && !isMobile ? 'var(--accent)' : 'var(--ink)', padding: isMobile ? '13px 12px' : '9px 11px', borderRadius: 8, fontSize: isMobile ? 15 : 13.5, fontWeight: unreadCounts[c.id] ? 700 : 500, cursor: 'pointer', fontFamily: 'inherit' }}>
                  <span style={{ flex: 1 }}># {c.name}</span>
                  {unreadCounts[c.id] > 0 && (
                    <span style={{ background: '#DC2626', color: '#fff', fontSize: 11, fontWeight: 700, minWidth: 18, height: 18, borderRadius: 9, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px', flex: 'none' }}>{unreadCounts[c.id] > 99 ? '99+' : unreadCounts[c.id]}</span>
                  )}
                </button>
                {isOwner && (
                  <button onClick={() => deleteChannel(c)} title="Delete channel"
                    style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--ink-soft)', fontSize: 13, padding: '6px 8px', flex: 'none', borderRadius: 6 }}>🗑</button>
                )}
              </div>
            ))}
            {(channels.some(c => c.is_dm) || isAdmin) && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 11px 6px' }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink-soft)' }}>Direct messages</span>
                {isAdmin && <button className="btn btn-ghost" style={{ padding: '2px 7px', fontSize: 11 }} onClick={() => setShowDM(true)}>+ DM</button>}
              </div>
            )}
            {channels.filter(c => c.is_dm).map(c => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 2, marginBottom: 2 }}>
                <button onClick={() => openChannel(c.id)}
                  style={{ display: 'flex', alignItems: 'center', flex: 1, textAlign: 'left', border: 0, background: c.id === activeId && !isMobile ? 'var(--accent-bg)' : 'transparent', color: c.id === activeId && !isMobile ? 'var(--accent)' : 'var(--ink)', padding: isMobile ? '13px 12px' : '9px 11px', borderRadius: 8, fontSize: isMobile ? 15 : 13.5, fontWeight: unreadCounts[c.id] ? 700 : 500, cursor: 'pointer', fontFamily: 'inherit' }}>
                  <span style={{ flex: 1 }}>{dmNames[c.id] || c.name || 'Direct message'}</span>
                  {unreadCounts[c.id] > 0 && (
                    <span style={{ background: '#DC2626', color: '#fff', fontSize: 11, fontWeight: 700, minWidth: 18, height: 18, borderRadius: 9, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px', flex: 'none' }}>{unreadCounts[c.id] > 99 ? '99+' : unreadCounts[c.id]}</span>
                  )}
                </button>
                {isOwner && (
                  <button onClick={() => deleteChannel(c)} title="Delete conversation"
                    style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--ink-soft)', fontSize: 13, padding: '6px 8px', flex: 'none', borderRadius: 6 }}>🗑</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {showConvo && (
        activeId
          ? <ChannelPane key={activeId} channelId={activeId} me={me} isAdmin={isAdmin} isOwner={isOwner} channel={channels.find(c => c.id === activeId)} dmName={dmNames[activeId]} profiles={profiles} isMobile={isMobile} onBack={() => setMobileView('list')} markRead={markRead} />
          : <div style={{ display: 'grid', placeItems: 'center', color: 'var(--ink-soft)', height: '100%' }}>Select a channel</div>
      )}
      {showCreate && <CreateChannelModal me={me} profiles={profiles}
        onClose={() => setShowCreate(false)}
        onCreated={(id) => { setShowCreate(false); load(); openChannel(id) }} />}
      {showDM && <CreateDMModal me={me} profiles={profiles}
        onClose={() => setShowDM(false)}
        onCreated={(id) => { setShowDM(false); load(); openChannel(id) }} />}
    </div>
  )
}
function ChannelPane({ channelId, me, isAdmin, isOwner, channel, dmName, profiles, isMobile, onBack, markRead }) {
  const [messages, setMessages] = useState([])
  const [senders, setSenders] = useState({})
  const [acks, setAcks] = useState([])           // all acknowledgments for messages in view
  const [members, setMembers] = useState([])      // channel member profile_ids
  const [text, setText] = useState('')
  const [requireAck, setRequireAck] = useState(false)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [trackFor, setTrackFor] = useState(null)  // message id to show tracking panel
  const [threadFor, setThreadFor] = useState(null) // parent message id for the thread panel
  const [reactions, setReactions] = useState([])   // all reactions for messages in view
  const [attachments, setAttachments] = useState([]) // attachments for messages in view
  const [pending, setPending] = useState([])         // files staged to send: {file, name, uploading}
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef(null)
  const [showPicker, setShowPicker] = useState(false)      // input emoji picker
  const [reactFor, setReactFor] = useState(null)   // message id whose react-picker is open
  const [showMembers, setShowMembers] = useState(false)
  const composerRef = useRef(null)
  const htmlRef = useRef('')
  const bottomRef = useRef(null)
  const { typerNames, notifyTyping, stopTyping } = useTyping(`typing:${channelId}`, me.id, me.full_name)
  useEffect(() => {
    let active = true
    ;(async () => {
      setLoading(true); setErr('')
      try {
        const [msgRes, memRes] = await Promise.all([
          supabase.from('messages').select('*').eq('channel_id', channelId).is('deleted_at', null).order('created_at').limit(200),
          supabase.from('channel_members').select('profile_id').eq('channel_id', channelId),
        ])
        if (msgRes.error) throw msgRes.error
        if (!active) return
        const msgs = msgRes.data || []
        setMessages(msgs)
        setMembers((memRes.data || []).map(m => m.profile_id))
        await hydrateSenders(msgs)
        await loadAcks(msgs)
        await loadReactions(msgs)
        await loadAttachments(msgs)
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
  async function loadAcks(msgs) {
    const ackMsgIds = msgs.filter(m => m.requires_ack).map(m => m.id)
    if (!ackMsgIds.length) { setAcks([]); return }
    const { data } = await supabase.from('message_acknowledgments').select('*').in('message_id', ackMsgIds)
    setAcks(data || [])
  }
  async function loadReactions(msgs) {
    const ids = msgs.map(m => m.id)
    if (!ids.length) { setReactions([]); return }
    const { data } = await supabase.from('message_reactions').select('*').in('message_id', ids)
    setReactions(data || [])
  }
  async function loadAttachments(msgs) {
    const ids = msgs.map(m => m.id)
    if (!ids.length) { setAttachments([]); return }
    const { data } = await supabase.from('message_attachments').select('*').in('message_id', ids)
    setAttachments(data || [])
  }
  function addFiles(fileList) {
    const arr = Array.from(fileList || [])
    const tooBig = arr.find(f => f.size > MAX_FILE_BYTES)
    if (tooBig) { setErr(`"${tooBig.name}" is over 50MB.`); return }
    setPending(prev => [...prev, ...arr.map(f => ({ file: f, name: f.name, type: f.type }))])
  }
  function removePending(idx) { setPending(prev => prev.filter((_, i) => i !== idx)) }
  function onPaste(e) {
    const files = Array.from(e.clipboardData?.files || [])
    if (files.length) { e.preventDefault(); addFiles(files) }
  }
  async function toggleReaction(messageId, emoji) {
    const mine = reactions.find(r => r.message_id === messageId && r.profile_id === me.id && r.emoji === emoji)
    setReactFor(null)
    if (mine) {
      setReactions(prev => prev.filter(r => r !== mine))
      await supabase.from('message_reactions').delete().eq('message_id', messageId).eq('profile_id', me.id).eq('emoji', emoji)
    } else {
      const optimistic = { id: 'temp-' + Date.now(), message_id: messageId, profile_id: me.id, emoji }
      setReactions(prev => [...prev, optimistic])
      const { data, error } = await supabase.from('message_reactions').insert({ message_id: messageId, profile_id: me.id, emoji }).select().single()
      if (error && error.code !== '23505') setReactions(prev => prev.filter(r => r !== optimistic))
      else if (data) setReactions(prev => prev.map(r => r === optimistic ? data : r))
    }
  }
  // realtime: new messages + new acknowledgments
  useEffect(() => {
    const ch = supabase
      .channel(`chan:${channelId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `channel_id=eq.${channelId}` },
        async (payload) => {
          const m = payload.new
          setMessages(prev => prev.some(x => x.id === m.id) ? prev : [...prev, m])
          // I'm looking at this channel, so keep it marked read
          if (m.sender_id !== me.id) markRead?.(channelId)
          if (m.sender_id && !(m.sender_id in senders)) {
            const { data } = await supabase.from('profiles').select('id, full_name').eq('id', m.sender_id).single()
            if (data) setSenders(prev => ({ ...prev, [data.id]: data.full_name }))
          }
        })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_acknowledgments' },
        (payload) => { setAcks(prev => prev.some(a => a.id === payload.new.id) ? prev : [...prev, payload.new]) })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_reactions' },
        (payload) => { setReactions(prev => prev.some(r => r.id === payload.new.id) ? prev : [...prev, payload.new]) })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'message_reactions' },
        (payload) => { setReactions(prev => prev.filter(r => r.id !== payload.old.id)) })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_attachments', filter: `channel_id=eq.${channelId}` },
        (payload) => { setAttachments(prev => prev.some(a => a.id === payload.new.id) ? prev : [...prev, payload.new]) })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [channelId, senders])
  useEffect(() => {
    if (!messages.length) return
    const el = bottomRef.current
    if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messages.length])
  async function send() {
    const rawHtml = htmlRef.current || ''
    const plain = (rawHtml.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim())
    const body = cleanChatHtml(rawHtml)
    if (!plain && pending.length === 0) return
    const isHere = /(^|\s)@here(\s|$)/i.test(plain)
    const willRequireAck = isAdmin && requireAck
    const filesToSend = pending
    composerRef.current?.clear(); htmlRef.current = ''
    setRequireAck(false); setPending([])
    stopTyping()
    if (filesToSend.length) setUploading(true)
    const temp = { id: 'temp-' + Date.now(), channel_id: channelId, sender_id: me.id, body: body || '', created_at: new Date().toISOString(), requires_ack: willRequireAck, is_here: isHere, _optimistic: true }
    setMessages(prev => [...prev, temp])
    const { data, error } = await supabase.from('messages')
      .insert({ channel_id: channelId, sender_id: me.id, body: body || '', requires_ack: willRequireAck, is_here: isHere })
      .select().single()
    if (error) {
      setErr(error.message)
      setMessages(prev => prev.filter(m => m.id !== temp.id)); setPending(filesToSend); setUploading(false)
      return
    }
    if (filesToSend.length) {
      try {
        const rows = []
        for (const p of filesToSend) {
          const meta = await uploadChatFile(p.file, channelId, me.id)
          rows.push({ message_id: data.id, channel_id: channelId, uploader_id: me.id, ...meta })
        }
        if (rows.length) {
          const { data: attData } = await supabase.from('message_attachments').insert(rows).select()
          if (attData) setAttachments(prev => [...prev, ...attData])
        }
      } catch (e) { setErr('Upload failed: ' + e.message) }
      setUploading(false)
    }
    setMessages(prev => prev.filter(m => m.id !== temp.id && m.id !== data.id).concat(data))
    notifyChatMessage({
      channelId, channelName: channel?.name, isDm: channel?.is_dm,
      actorId: me.id, actorName: me.full_name, isHere, requiresAck: willRequireAck,
    })
    await handleMentions(plain)
  }
  // Detect @mentions, auto-add non-members to the channel, and notify them.
  async function handleMentions(body) {
    const mentionedIds = extractMentions(body, profiles).filter(id => id !== me.id)
    if (!mentionedIds.length) return
    // who's not already a member?
    const addedIds = mentionedIds.filter(id => !members.includes(id))
    if (addedIds.length && !channel?.is_dm) {
      await supabase.from('channel_members').insert(addedIds.map(pid => ({ channel_id: channelId, profile_id: pid })))
      setMembers(prev => [...new Set([...prev, ...addedIds])])
    }
    notifyChatMention({
      recipientIds: mentionedIds, actorId: me.id, actorName: me.full_name,
      channelName: channel?.name, isDm: channel?.is_dm, addedIds,
    })
  }
  async function confirmRead(messageId) {
    // optimistic
    const optimistic = { id: 'temp-ack-' + Date.now(), message_id: messageId, profile_id: me.id, confirmed_at: new Date().toISOString() }
    setAcks(prev => [...prev, optimistic])
    const { error } = await supabase.from('message_acknowledgments').insert({ message_id: messageId, profile_id: me.id })
    if (error && error.code !== '23505') { // 23505 = already confirmed, fine
      setAcks(prev => prev.filter(a => a.id !== optimistic.id))
      setErr(error.message)
    }
  }
  const iConfirmed = (messageId) => acks.some(a => a.message_id === messageId && a.profile_id === me.id)
  const confirmCount = (messageId) => acks.filter(a => a.message_id === messageId).length
  if (loading) return <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}><span className="page-sub">Loading messages…</span></div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, position: 'relative' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', flex: 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
        {isMobile && (
          <button onClick={onBack} title="Back to channels"
            style={{ border: 0, background: 'transparent', cursor: 'pointer', fontSize: 20, color: 'var(--accent)', padding: '0 4px 0 0', fontFamily: 'inherit', flex: 'none' }}>‹</button>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <b style={{ fontSize: 15 }}>{channel?.is_dm ? (dmName || 'Direct message') : `# ${channel?.name}`}</b>
          {channel?.description && !channel?.is_dm && <div className="page-sub" style={{ fontSize: 12.5 }}>{channel.description}</div>}
          {channel?.is_dm && <div className="page-sub" style={{ fontSize: 12 }}>Direct message</div>}
        </div>
        {!channel?.is_dm && (
          <button className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 10px', flex: 'none' }} onClick={() => setShowMembers(true)}>👥 Members</button>
        )}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', minHeight: 0 }}>
        {err && <div style={{ color: 'var(--failed)', fontSize: 13, marginBottom: 10 }}>{err}</div>}
        {(() => { const top = messages.filter(x => !x.parent_id); return top.length === 0 ? <div className="page-sub" style={{ textAlign: 'center', padding: 30 }}>No messages yet. Say hello 👋</div>
          : top.map((m, i) => {
            const replyCount = messages.filter(x => x.parent_id === m.id).length
            const top2 = messages.filter(x => !x.parent_id); const prev = top2[i - 1]
            const grouped = prev && prev.sender_id === m.sender_id && !m.requires_ack && !prev.requires_ack && (new Date(m.created_at) - new Date(prev.created_at) < 5 * 60000)
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
                    {m.is_here && <span className="badge" style={{ background: 'var(--accent-bg)', color: 'var(--accent)', fontSize: 10 }}>@here</span>}
                  </div>}
                  {m.requires_ack ? (
                    <div style={{ border: '1px solid var(--accent)', borderRadius: 10, padding: '12px 14px', background: 'var(--accent-bg)', marginTop: 2 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        <span className="badge" style={{ background: 'var(--accent)', color: '#fff', fontSize: 10 }}>UPDATE — please confirm</span>
                      </div>
                      <div style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginBottom: 10 }}>{renderBody(m.body)}</div>
                      {iConfirmed(m.id)
                        ? <span style={{ fontSize: 12.5, color: 'var(--passed)', fontWeight: 600 }}>✓ You confirmed</span>
                        : <button className="btn btn-cta" style={{ fontSize: 12.5 }} onClick={() => confirmRead(m.id)}>Confirm you've read this</button>}
                      <div style={{ marginTop: 8, display: 'flex', gap: 12, alignItems: 'center' }}>
                        <span style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{confirmCount(m.id)}/{members.length} confirmed</span>
                        {isAdmin && <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: '3px 8px' }} onClick={() => setTrackFor(m.id)}>View who</button>}
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{renderBody(m.body)}</div>
                  )}
                  {attachments.filter(a => a.message_id === m.id).map(a => <AttachmentView key={a.id} att={a} />)}
                  <ReactionBar messageId={m.id} reactions={reactions} meId={me.id}
                    onToggle={toggleReaction}
                    pickerOpen={reactFor === m.id}
                    onOpenPicker={() => setReactFor(reactFor === m.id ? null : m.id)}
                    onClosePicker={() => setReactFor(null)} />
                  <ReplyAffordance count={replyCount} onOpen={() => setThreadFor(m.id)} />
                </div>
              </div>
            )
          }) })()}
        <div ref={bottomRef} />
      </div>
      <TypingLine names={typerNames} />
      <div style={{ borderTop: '1px solid var(--line)', padding: '10px 16px', flex: 'none', background: 'var(--surface)' }}>
        {isAdmin && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8, fontSize: 12.5, color: requireAck ? 'var(--accent)' : 'var(--ink-soft)', cursor: 'pointer', fontWeight: requireAck ? 600 : 400 }}>
            <input type="checkbox" checked={requireAck} onChange={e => setRequireAck(e.target.checked)} />
            Post as <b>@update</b> — require everyone to confirm they've read it
          </label>
        )}
        {pending.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            {pending.map((p, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', background: 'var(--canvas)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }}>
                <span>{p.type?.startsWith('image/') ? '🖼' : p.type?.startsWith('video/') ? '🎬' : '📄'}</span>
                <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                <button onClick={() => removePending(i)} style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--ink-soft)', fontSize: 14 }}>✕</button>
              </div>
            ))}
          </div>
        )}
        {uploading && <div style={{ fontSize: 12, color: 'var(--accent)', marginBottom: 6 }}>Uploading…</div>}
        <div style={{ display: 'flex', gap: 8, position: 'relative' }}>
          {showPicker && (
            <div style={{ position: 'absolute', bottom: 52, left: 0, zIndex: 50 }}>
              <EmojiPicker onEmojiClick={(e) => { composerRef.current?.insertText(e.emoji); setShowPicker(false) }}
                width={320} height={380} previewConfig={{ showPreview: false }} />
            </div>
          )}
          <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }}
            onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
          <button type="button" onClick={() => fileInputRef.current?.click()} title="Attach file"
            style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 8, cursor: 'pointer', fontSize: 17, padding: '0 10px', flex: 'none' }}>📎</button>
          <button type="button" onClick={() => setShowPicker(p => !p)} title="Emoji"
            style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 8, cursor: 'pointer', fontSize: 18, padding: '0 10px', flex: 'none' }}>😀</button>
          <div style={{ flex: 1 }}>
            <RichComposer valueRef={composerRef}
              profiles={profiles}
              onInput={(html) => { htmlRef.current = html; notifyTyping() }}
              onEnter={send}
              onPasteFiles={(files) => addFiles(files)}
              placeholder={requireAck ? 'Write your update… (@name to mention)' : `Message #${channel?.name || ''}  (@name, @here, or paste/attach a file)`}
              accent={requireAck ? 'var(--accent)' : 'var(--line)'}
              minHeight={76} maxHeight={200} />
          </div>
          <button className={'btn ' + (requireAck ? 'btn-cta' : 'btn-primary')} onClick={send} disabled={uploading}>{requireAck ? 'Post update' : 'Send'}</button>
        </div>
      </div>
      {trackFor && <TrackPanel messageId={trackFor} me={me} members={members} profiles={profiles} acks={acks} onClose={() => setTrackFor(null)} />}
      {threadFor && <ThreadPanel parentId={threadFor} channelId={channelId} me={me} senders={senders} profiles={profiles} channel={channel} members={members} onClose={() => setThreadFor(null)} />}
      {showMembers && <ChannelMembersPanel channelId={channelId} channelName={channel?.name} profiles={profiles} meId={me.id} isOwner={isOwner} onClose={() => setShowMembers(false)} onChanged={async () => {
        const { data } = await supabase.from('channel_members').select('profile_id').eq('channel_id', channelId)
        setMembers((data || []).map(m => m.profile_id))
      }} />}
    </div>
  )
}
// Rich text composer: contentEditable + Slack-style toolbar (bold, italic,
// strikethrough, bullet + numbered lists). Enter sends; Shift+Enter = newline.
// Exposes formatted HTML via onChange. Supports paste (files bubble up via onPaste).
function RichComposer({ valueRef, onInput, onEnter, onPasteFiles, placeholder, minHeight = 76, maxHeight = 200, accent, profiles = [] }) {
  const ref = useRef(null)
  const [empty, setEmpty] = useState(true)
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [hi, setHi] = useState(0)

  const matches = mentionOpen
    ? profiles.filter(p => p.full_name?.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 6)
    : []

  function exec(cmd) { document.execCommand(cmd, false, null); ref.current?.focus(); handleInput() }
  function handleInput() {
    const html = ref.current?.innerHTML || ''
    const text = ref.current?.innerText || ''
    setEmpty(text.trim().length === 0)
    onInput?.(html, text)
    // detect @token immediately left of caret
    const sel = window.getSelection()
    if (sel && sel.rangeCount) {
      const node = sel.anchorNode
      const offset = sel.anchorOffset
      if (node && node.nodeType === 3) {
        const upto = node.textContent.slice(0, offset)
        const m = upto.match(/@([\w]*)$/)
        if (m) { setMentionOpen(true); setMentionQuery(m[1]); setHi(0); return }
      }
    }
    setMentionOpen(false); setMentionQuery('')
  }
  function insertMention(p) {
    // replace the trailing "@query" with "@Full Name "
    const sel = window.getSelection()
    if (sel && sel.rangeCount) {
      const node = sel.anchorNode
      const offset = sel.anchorOffset
      if (node && node.nodeType === 3) {
        const before = node.textContent.slice(0, offset)
        const at = before.lastIndexOf('@')
        if (at >= 0) {
          const range = document.createRange()
          range.setStart(node, at)
          range.setEnd(node, offset)
          range.deleteContents()
          const textNode = document.createTextNode('@' + p.full_name + ' ')
          range.insertNode(textNode)
          // move caret after inserted text
          range.setStartAfter(textNode); range.collapse(true)
          sel.removeAllRanges(); sel.addRange(range)
        }
      }
    }
    setMentionOpen(false); setMentionQuery('')
    handleInput()
  }
  function handleKey(e) {
    if (mentionOpen && matches.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => (h + 1) % matches.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => (h - 1 + matches.length) % matches.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(matches[hi]); return }
      if (e.key === 'Escape') { setMentionOpen(false); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onEnter?.() }
  }
  function handlePaste(e) {
    const files = Array.from(e.clipboardData?.files || [])
    if (files.length) { e.preventDefault(); onPasteFiles?.(files); return }
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    document.execCommand('insertText', false, text)
    handleInput()
  }
  useEffect(() => {
    if (valueRef) valueRef.current = {
      clear: () => { if (ref.current) { ref.current.innerHTML = ''; setEmpty(true) } },
      focus: () => ref.current?.focus(),
      insertText: (t) => { ref.current?.focus(); document.execCommand('insertText', false, t); handleInput() },
    }
  }, [valueRef])

  const TBtn = ({ cmd, label, title }) => (
    <button type="button" title={title} onMouseDown={e => { e.preventDefault(); exec(cmd) }}
      style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--ink-soft)', fontSize: 13, width: 28, height: 26, borderRadius: 5 }}>{label}</button>
  )

  return (
    <div style={{ flex: 1, border: '1px solid ' + (accent || 'var(--line)'), borderRadius: 8, overflow: 'visible', background: 'var(--surface)', position: 'relative' }}>
      {mentionOpen && matches.length > 0 && (
        <div style={{ position: 'absolute', bottom: '100%', left: 8, marginBottom: 6, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,.14)', zIndex: 70, width: 240, overflow: 'hidden' }}>
          {matches.map((p, i) => (
            <button key={p.id} type="button" onMouseDown={ev => { ev.preventDefault(); insertMention(p) }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', border: 0, cursor: 'pointer', padding: '8px 10px', fontSize: 13, fontFamily: 'inherit', background: i === hi ? 'var(--accent-bg)' : 'transparent', color: 'var(--ink)' }}>
              <span style={{ width: 22, height: 22, borderRadius: '50%', background: avatarColor(p.full_name), color: '#fff', display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 700 }}>{initials(p.full_name)}</span>
              {p.full_name}
            </button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 1, padding: '3px 6px', borderBottom: '1px solid var(--line-soft)', background: '#fbfcfd' }}>
        <TBtn cmd="bold" label={<b>B</b>} title="Bold" />
        <TBtn cmd="italic" label={<i>I</i>} title="Italic" />
        <TBtn cmd="strikeThrough" label={<s>S</s>} title="Strikethrough" />
        <span style={{ width: 1, height: 16, background: 'var(--line)', margin: '0 3px' }} />
        <TBtn cmd="insertUnorderedList" label="•" title="Bulleted list" />
        <TBtn cmd="insertOrderedList" label="1." title="Numbered list" />
      </div>
      <div style={{ position: 'relative' }}>
        {empty && <div style={{ position: 'absolute', top: 10, left: 12, color: 'var(--ink-soft)', fontSize: 14, pointerEvents: 'none' }}>{placeholder}</div>}
        <div ref={ref} contentEditable suppressContentEditableWarning
          onInput={handleInput} onKeyDown={handleKey} onPaste={handlePaste}
          style={{ outline: 'none', fontSize: 14, lineHeight: 1.5, padding: '10px 12px', minHeight, maxHeight, overflowY: 'auto' }} />
      </div>
    </div>
  )
}

// Channel members panel: lists everyone in the channel; owners can remove.
function ChannelMembersPanel({ channelId, channelName, profiles, meId, isOwner, onClose, onChanged }) {
  const [memberIds, setMemberIds] = useState([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [search, setSearch] = useState('')

  const loadMembers = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('channel_members').select('profile_id').eq('channel_id', channelId)
    setMemberIds((data || []).map(m => m.profile_id))
    setLoading(false)
  }, [channelId])
  useEffect(() => { loadMembers() }, [loadMembers])

  const members = memberIds.map(id => profiles.find(p => p.id === id)).filter(Boolean)
    .sort((a, b) => a.full_name.localeCompare(b.full_name))
  const nonMembers = profiles.filter(p => !memberIds.includes(p.id) && p.full_name?.toLowerCase().includes(search.toLowerCase()))

  async function removeMember(pid) {
    const p = profiles.find(x => x.id === pid)
    if (!window.confirm(`Remove ${p?.full_name || 'this person'} from #${channelName}? They'll lose access to the channel and stop seeing new messages. Their past messages stay.`)) return
    const { error } = await supabase.from('channel_members').delete().eq('channel_id', channelId).eq('profile_id', pid)
    if (error) { window.alert('Could not remove: ' + error.message); return }
    setMemberIds(prev => prev.filter(id => id !== pid))
    onChanged && onChanged()
  }
  async function addMember(pid) {
    const { error } = await supabase.from('channel_members').insert({ channel_id: channelId, profile_id: pid })
    if (error) { window.alert('Could not add: ' + error.message); return }
    setMemberIds(prev => [...prev, pid])
    notifyChannelAdded({ recipientIds: [pid], actorId: meId, actorName: profiles.find(p => p.id === meId)?.full_name, channelName, isDm: false })
    onChanged && onChanged()
  }

  return (
    <div className="modal-back open" onClick={e => { if (e.target.classList.contains('modal-back')) onClose() }}>
      <div className="modal" style={{ width: 420, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}># {channelName}</h3>
          <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 9px' }} onClick={onClose}>Close</button>
        </div>
        <p className="page-sub" style={{ marginBottom: 14 }}>{members.length} member{members.length !== 1 ? 's' : ''}{isOwner ? ' · you can add or remove people' : ''}</p>

        {loading ? <p className="page-sub">Loading…</p> : (
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {members.map(p => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0' }}>
                <span style={{ width: 30, height: 30, borderRadius: '50%', background: avatarColor(p.full_name), color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, flex: 'none' }}>{initials(p.full_name)}</span>
                <span style={{ flex: 1, fontSize: 14 }}>{p.full_name}{p.id === meId ? ' (you)' : ''}</span>
                {isOwner && p.id !== meId && (
                  <button onClick={() => removeMember(p.id)} title="Remove from channel"
                    style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--failed)', fontSize: 12, fontWeight: 600, padding: '4px 8px' }}>Remove</button>
                )}
              </div>
            ))}

            {isOwner && (
              <div style={{ marginTop: 14, borderTop: '1px solid var(--line-soft)', paddingTop: 12 }}>
                {!adding ? (
                  <button className="btn btn-ghost" onClick={() => setAdding(true)}>+ Add people</button>
                ) : (
                  <>
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search people to add…" autoFocus
                      style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', marginBottom: 8, boxSizing: 'border-box' }} />
                    <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                      {nonMembers.length === 0 && <div className="page-sub" style={{ fontSize: 12, padding: 8 }}>Everyone's already in, or no match.</div>}
                      {nonMembers.map(p => (
                        <button key={p.id} onClick={() => addMember(p.id)}
                          style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left', border: 0, background: 'transparent', cursor: 'pointer', padding: '7px 6px', fontFamily: 'inherit' }}>
                          <span style={{ width: 26, height: 26, borderRadius: '50%', background: avatarColor(p.full_name), color: '#fff', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, flex: 'none' }}>{initials(p.full_name)}</span>
                          <span style={{ fontSize: 13.5, flex: 1 }}>{p.full_name}</span>
                          <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>Add</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
function ReactionBar({ messageId, reactions, meId, onToggle, pickerOpen, onOpenPicker, onClosePicker }) {
  const mine = reactions.filter(r => r.message_id === messageId)
  // group by emoji -> count + whether I reacted
  const groups = {}
  mine.forEach(r => {
    if (!groups[r.emoji]) groups[r.emoji] = { count: 0, byMe: false }
    groups[r.emoji].count++
    if (r.profile_id === meId) groups[r.emoji].byMe = true
  })
  const entries = Object.entries(groups)
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 4, position: 'relative' }}>
      {entries.map(([emoji, g]) => (
        <button key={emoji} onClick={() => onToggle(messageId, emoji)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 12, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
            border: '1px solid ' + (g.byMe ? 'var(--accent)' : 'var(--line)'),
            background: g.byMe ? 'var(--accent-bg)' : 'var(--surface)', color: g.byMe ? 'var(--accent)' : 'var(--ink)' }}>
          <span style={{ fontSize: 14 }}>{emoji}</span> {g.count}
        </button>
      ))}
      <button onClick={onOpenPicker} title="Add reaction"
        style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 12, cursor: 'pointer', fontSize: 12, padding: '2px 7px', color: 'var(--ink-soft)', lineHeight: 1.4 }}>
        ☺+
      </button>
      {pickerOpen && (
        <>
          <div onClick={onClosePicker} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div style={{ position: 'absolute', top: 26, left: 0, zIndex: 41 }}>
            <EmojiPicker onEmojiClick={(e) => onToggle(messageId, e.emoji)}
              width={300} height={360} previewConfig={{ showPreview: false }} reactionsDefaultOpen={true} />
          </div>
        </>
      )}
    </div>
  )
}
function ReplyAffordance({ count, onOpen }) {
  return (
    <button onClick={onOpen} style={{ border: 0, background: 'transparent', color: count ? 'var(--accent)' : 'var(--ink-soft)', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '3px 0', marginTop: 3, fontFamily: 'inherit' }}>
      {count ? `\uD83D\uDCAC ${count} repl${count === 1 ? 'y' : 'ies'}` : '\u21B3 Reply'}
    </button>
  )
}
function ThreadPanel({ parentId, channelId, me, senders, profiles = [], channel, members = [], onClose }) {
  const [parent, setParent] = React.useState(null)
  const [replies, setReplies] = React.useState([])
  const [names, setNames] = React.useState(senders || {})
  const [text, setText] = React.useState('')
  const [loading, setLoading] = React.useState(true)
  const endRef = React.useRef(null)
  const { typerNames, notifyTyping, stopTyping } = useTyping(`typing:thread:${parentId}`, me.id, me.full_name)
  React.useEffect(() => {
    let active = true
    ;(async () => {
      setLoading(true)
      const [pRes, rRes] = await Promise.all([
        supabase.from('messages').select('*').eq('id', parentId).single(),
        supabase.from('messages').select('*').eq('parent_id', parentId).is('deleted_at', null).order('created_at'),
      ])
      if (!active) return
      setParent(pRes.data || null)
      setReplies(rRes.data || [])
      const ids = [...new Set([pRes.data?.sender_id, ...(rRes.data || []).map(r => r.sender_id)].filter(Boolean))]
      const miss = ids.filter(id => !(id in names))
      if (miss.length) { const { data } = await supabase.from('profiles').select('id, full_name').in('id', miss); if (data) setNames(prev => { const n = { ...prev }; data.forEach(p => n[p.id] = p.full_name); return n }) }
      setLoading(false)
    })()
    return () => { active = false }
  }, [parentId])
  React.useEffect(() => {
    const ch = supabase.channel(`thread:${parentId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `parent_id=eq.${parentId}` },
        (payload) => setReplies(prev => prev.some(x => x.id === payload.new.id) ? prev : [...prev, payload.new]))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [parentId])
  React.useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [replies])
  async function sendReply() {
    const body = text.trim(); if (!body) return
    setText(''); stopTyping()
    const temp = { id: 'temp-' + Date.now(), channel_id: channelId, sender_id: me.id, body, parent_id: parentId, created_at: new Date().toISOString(), _optimistic: true }
    setReplies(prev => [...prev, temp])
    const { data, error } = await supabase.from('messages').insert({ channel_id: channelId, sender_id: me.id, body, parent_id: parentId }).select().single()
    if (error) { setReplies(prev => prev.filter(m => m.id !== temp.id)); setText(body); return }
    setReplies(prev => prev.filter(m => m.id !== temp.id && m.id !== data.id).concat(data))
    // mentions in thread replies
    const mentionedIds = extractMentions(body, profiles).filter(id => id !== me.id)
    if (mentionedIds.length) {
      const addedIds = mentionedIds.filter(id => !members.includes(id))
      if (addedIds.length && !channel?.is_dm) {
        await supabase.from('channel_members').insert(addedIds.map(pid => ({ channel_id: channelId, profile_id: pid })))
      }
      notifyChatMention({
        recipientIds: mentionedIds, actorId: me.id, actorName: me.full_name,
        channelName: channel?.name, isDm: channel?.is_dm, addedIds,
      })
    }
  }
  const nameFor = (id) => id === me.id ? 'You' : (names[id] || 'Someone')
  return (
    <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 380, maxWidth: '90%', background: 'var(--surface)', borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 24px rgba(0,0,0,.08)', zIndex: 20 }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flex: 'none' }}>
        <b style={{ fontSize: 14 }}>Thread</b>
        <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 9px' }} onClick={onClose}>Close</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, minHeight: 0 }}>
        {loading ? <span className="page-sub">Loading…</span> : (
          <>
            {parent && <div style={{ paddingBottom: 12, borderBottom: '1px solid var(--line-soft)', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 3 }}>
                <b style={{ fontSize: 13 }}>{nameFor(parent.sender_id)}</b>
                <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{timeLabel(parent.created_at)}</span>
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{renderBody(parent.body)}</div>
            </div>}
            <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 8 }}>{replies.length} repl{replies.length === 1 ? 'y' : 'ies'}</div>
            {replies.map(r => (
              <div key={r.id} style={{ display: 'flex', gap: 9, marginBottom: 10, opacity: r._optimistic ? 0.6 : 1 }}>
                <span style={{ width: 28, height: 28, borderRadius: '50%', background: avatarColor(nameFor(r.sender_id)), color: '#fff', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, flex: 'none' }}>{initials(nameFor(r.sender_id))}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}><b style={{ fontSize: 12.5 }}>{nameFor(r.sender_id)}</b><span style={{ fontSize: 10.5, color: 'var(--ink-soft)' }}>{timeLabel(r.created_at)}</span></div>
                  <div style={{ fontSize: 13.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{renderBody(r.body)}</div>
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </>
        )}
      </div>
      <TypingLine names={typerNames} />
      <div style={{ borderTop: '1px solid var(--line)', padding: 12, display: 'flex', gap: 8, flex: 'none' }}>
        <MentionTextarea value={text} onChange={(v) => { setText(v); notifyTyping() }} onEnter={sendReply} profiles={profiles}
          placeholder="Reply… (@name to mention)"
          style={{ resize: 'none', padding: '9px 11px', borderRadius: 8, fontSize: 13.5, fontFamily: 'inherit', outline: 'none', maxHeight: 100 }} />
        <button className="btn btn-primary" onClick={sendReply} disabled={!text.trim()}>Reply</button>
      </div>
    </div>
  )
}
// Render @here / @update mentions with a highlight
// Clean up contentEditable HTML before saving: convert &nbsp; to spaces,
// strip trailing whitespace/breaks, and drop empty trailing tags.
function cleanChatHtml(html) {
  let h = String(html || '')
  h = h.replace(/&nbsp;/gi, ' ')            // nbsp -> normal space
  h = h.replace(/(\s*<br\s*\/?>\s*)+$/gi, '') // trailing <br>
  h = h.replace(/(<div>\s*<\/div>)+$/gi, '')  // empty trailing divs
  h = h.replace(/\s+$/g, '')                 // trailing whitespace
  h = h.replace(/^(\s|<br\s*\/?>)+/gi, '')   // leading breaks/space
  return h.trim()
}
function renderBody(body) {
  let html = String(body || '')
  // Clean up nbsp and trailing breaks (covers older messages already saved)
  html = html.replace(/&nbsp;/gi, ' ').replace(/(\s*<br\s*\/?>\s*)+$/gi, '').replace(/\s+$/g, '')
  // If it looks like plain text (no tags), escape angle brackets and keep newlines.
  const looksHtml = /<\/?[a-z][\s\S]*>/i.test(html)
  if (!looksHtml) {
    html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')
  }
  // Highlight @here / @update
  html = html.replace(/(@here|@update)\b/gi,
    '<span style="color:var(--accent);font-weight:700;background:var(--accent-bg);border-radius:4px;padding:0 3px">$1</span>')
  return <div className="chat-rich" style={{ fontSize: 14, lineHeight: 1.5, wordBreak: 'break-word' }} dangerouslySetInnerHTML={{ __html: html }} />
}
// Admin tracking panel: who confirmed, who hasn't, nudge
function TrackPanel({ messageId, me, members, profiles, acks, onClose }) {
  const [nudged, setNudged] = useState({})
  const confirmedIds = new Set(acks.filter(a => a.message_id === messageId).map(a => a.profile_id))
  const memberProfiles = members.map(id => profiles.find(p => p.id === id)).filter(Boolean)
  const confirmed = memberProfiles.filter(p => confirmedIds.has(p.id))
  const pending = memberProfiles.filter(p => !confirmedIds.has(p.id))
  async function nudge(profileId) {
    setNudged(prev => ({ ...prev, [profileId]: 'sending' }))
    const { error } = await supabase.from('ack_nudges').insert({ message_id: messageId, profile_id: profileId, nudged_by: me.id })
    if (!error) notifyAckNudge({ recipientId: profileId, actorId: me.id, actorName: me.full_name })
    setNudged(prev => ({ ...prev, [profileId]: error ? 'error' : 'sent' }))
  }
  async function nudgeAll() { for (const p of pending) await nudge(p.id) }
  return (
    <div className="modal-back open" onClick={e => { if (e.target.classList.contains('modal-back')) onClose() }}>
      <div className="modal" style={{ width: 440 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600 }}>Read confirmations</h3>
        <p className="page-sub" style={{ marginBottom: 16 }}>{confirmed.length} of {memberProfiles.length} confirmed</p>
        {pending.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <b style={{ fontSize: 13, color: 'var(--failed)' }}>Not yet confirmed ({pending.length})</b>
              <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: '4px 9px' }} onClick={nudgeAll}>Nudge all</button>
            </div>
            {pending.map(p => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
                <span style={{ width: 26, height: 26, borderRadius: '50%', background: avatarColor(p.full_name), color: '#fff', display: 'grid', placeItems: 'center', fontSize: 10.5, fontWeight: 700, flex: 'none' }}>{initials(p.full_name)}</span>
                <span style={{ fontSize: 13, flex: 1 }}>{p.full_name}</span>
                <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: '3px 10px' }}
                  disabled={nudged[p.id] === 'sending' || nudged[p.id] === 'sent'}
                  onClick={() => nudge(p.id)}>
                  {nudged[p.id] === 'sent' ? 'Nudged ✓' : nudged[p.id] === 'sending' ? '…' : 'Nudge'}
                </button>
              </div>
            ))}
          </div>
        )}
        {confirmed.length > 0 && (
          <div>
            <b style={{ fontSize: 13, color: 'var(--passed)' }}>Confirmed ({confirmed.length})</b>
            {confirmed.map(p => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
                <span style={{ width: 26, height: 26, borderRadius: '50%', background: avatarColor(p.full_name), color: '#fff', display: 'grid', placeItems: 'center', fontSize: 10.5, fontWeight: 700, flex: 'none' }}>{initials(p.full_name)}</span>
                <span style={{ fontSize: 13, flex: 1 }}>{p.full_name}</span>
                <span style={{ fontSize: 12, color: 'var(--passed)' }}>✓</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line-soft)' }}>
          <div className="hint" style={{ marginBottom: 10 }}>Nudges appear in-app for now. Push/email arrives with notifications.</div>
          <button className="btn btn-ghost" style={{ width: '100%' }} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
function CreateDMModal({ me, profiles, onClose, onCreated }) {
  // Start a DM with ONE other person — you're always the other side.
  // Reuses an existing DM with that person if one already exists.
  const [search, setSearch] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [err, setErr] = React.useState('')

  const others = profiles.filter(p => p.id !== me.id)
  const matches = search.trim()
    ? others.filter(p => p.full_name?.toLowerCase().includes(search.toLowerCase()))
    : others

  async function startDM(personId) {
    setSaving(true); setErr('')
    try {
      // first: look for an existing DM between me and this person
      const { data: myDms } = await supabase.from('channel_members')
        .select('channel_id, channels!inner(is_dm)')
        .eq('profile_id', me.id)
      const myDmIds = (myDms || []).filter(r => r.channels?.is_dm).map(r => r.channel_id)
      if (myDmIds.length) {
        const { data: theirs } = await supabase.from('channel_members')
          .select('channel_id')
          .eq('profile_id', personId)
          .in('channel_id', myDmIds)
        if (theirs && theirs.length) {
          // existing DM found — just open it
          onCreated(theirs[0].channel_id)
          return
        }
      }
      // otherwise: none exists — create a new DM with both of us
      const myFirst = me.full_name?.split(' ')[0] || 'Me'
      const theirFirst = profiles.find(p => p.id === personId)?.full_name?.split(' ')[0] || 'DM'
      const { data: ch, error: ce } = await supabase.from('channels')
        .insert({ name: `${myFirst} / ${theirFirst}`, is_dm: true, created_by: me.id }).select().single()
      if (ce) throw ce
      const { error: me2 } = await supabase.from('channel_members')
        .insert([{ channel_id: ch.id, profile_id: me.id }, { channel_id: ch.id, profile_id: personId }])
      if (me2) throw me2
      notifyChannelAdded({ recipientIds: [personId], actorId: me.id, actorName: me.full_name, channelName: 'Direct message', isDm: true })
      onCreated(ch.id)
    } catch (e) { setErr(e.message); setSaving(false) }
  }

  return (
    <div className="modal-back open" onClick={e => { if (e.target.classList.contains('modal-back')) onClose() }}>
      <div className="modal" style={{ width: 420 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600 }}>New direct message</h3>
        <p className="page-sub" style={{ marginBottom: 16 }}>Search for someone to start a conversation.</p>
        {err && <div className="login-err" style={{ marginBottom: 14 }}>{err}</div>}
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search people…" autoFocus
          style={{ width: '100%', padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', marginBottom: 10, boxSizing: 'border-box' }} />
        <div style={{ border: '1px solid var(--line)', borderRadius: 8, maxHeight: 300, overflowY: 'auto' }}>
          {matches.length === 0 && <div className="page-sub" style={{ padding: 14, fontSize: 13 }}>No people found.</div>}
          {matches.map(p => (
            <button key={p.id} type="button" disabled={saving} onClick={() => startDM(p.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', border: 0, borderBottom: '1px solid var(--line-soft)', background: 'transparent', cursor: 'pointer', padding: '10px 12px', fontFamily: 'inherit' }}>
              <span style={{ width: 30, height: 30, borderRadius: '50%', background: avatarColor(p.full_name), color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, flex: 'none' }}>{initials(p.full_name)}</span>
              <span style={{ fontSize: 14, fontWeight: 500 }}>{p.full_name}</span>
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', marginTop: 16 }}>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onClose} disabled={saving}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
function CreateChannelModal({ me, profiles, onClose, onCreated }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [picked, setPicked] = useState(() => new Set([me.id]))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  function toggle(id) { setPicked(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n }) }
  async function create() {
    const nm = name.trim()
    if (!nm) { setErr('Name the channel.'); return }
    setSaving(true); setErr('')
    try {
      const { data: ch, error: ce } = await supabase.from('channels')
        .insert({ name: nm, description: description.trim() || null, is_dm: false, created_by: me.id }).select().single()
      if (ce) throw ce
      const members = new Set(picked); members.add(me.id)
      const rows = [...members].map(pid => ({ channel_id: ch.id, profile_id: pid }))
      const { error: me2 } = await supabase.from('channel_members').insert(rows)
      if (me2) throw me2
      notifyChannelAdded({ recipientIds: [...members], actorId: me.id, actorName: me.full_name, channelName: nm, isDm: false })
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
