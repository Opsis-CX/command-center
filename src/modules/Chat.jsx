import React, { useEffect, useLayoutEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { can } from '../lib/permissions'
import { notifyAckNudge, notifyChannelAdded, notifyIncomingCall } from '../lib/notify'
import { useUnread } from '../lib/unread'
import EmojiPicker from 'emoji-picker-react'
import { RichEditor, RichContent, sanitizeHtml, htmlToText } from '../lib/RichEditor'
import { needsTranscode, transcodeToMp3 } from '../lib/audioTranscode'
import TradeBoardChannel from './TradeBoardChannel'
import LsaTracker from './LsaTracker'
import { PresenceDot, effStatus, isOnline } from '../components/Presence'
import TaskModal from './TaskModal'
import { ProjectsDataProvider } from './projectsData'

// The #GarageCo: Appointment Setters channel is rendered as an interactive
// Trade Board instead of a normal chat feed.
const TRADE_BOARD_CHANNEL_ID = '21ecc8ff-0c15-4f35-8ae3-50c99117d339'

// The #GarageCo LSA Chat Team channel gets an LSA lead tracker (toggled with the
// normal chat). Logging a booking auto-posts it into this channel (DB trigger).
const LSA_CHANNEL_ID = 'e68ebda8-90ba-42c2-9c41-1c3905f12bd1'

// ============================================================
// CHAT — Stage 1 + @update acknowledgments + @here
// Admins can post @update messages that require confirmation.
// Everyone sees a Confirm button; admins track who has/hasn't
// and can nudge non-confirmers.
//
// Per-channel notification preferences live in the 🔔 panel.
//
// REALTIME NOTE: postgres_changes subscriptions here are deliberately
// UNFILTERED, with the channel check done in the handler instead. The
// server-side `filter: channel_id=eq.<id>` form was silently delivering
// nothing — the unfiltered `unread-watch` subscription received the same
// rows fine. A 15s poll below backstops the websocket regardless.
// ============================================================

function initials(name) {
  const words = (name || '?').trim().split(/\s+/)
  const letters = words.filter(w => /\p{L}/u.test(w))
  const emoji = words.find(w => /\p{Extended_Pictographic}/u.test(w))
  // A one-word name with an emoji (the "Turri 🪼" service account) uses the emoji as its avatar.
  if (emoji && letters.length === 1) return emoji
  return ((letters[0]?.[0] || '') + (letters[1]?.[0] || '')).toUpperCase() || '?'
}

function avatarColor(name) {
  const colors = ['#0077B6', '#16A34A', '#D97706', '#7C3AED', '#DC2626', '#0891B2', '#DB2777', '#65A30D']
  let h = 0; for (const c of (name || '?')) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return colors[h % colors.length]
}

// ---- Profile photos in chat ----
// Every profile query in Chat also fetches avatar_url and registers it here,
// so any avatar can show the person's photo (and falls back to initials).
const _photoByName = new Map()
function registerPhotos(rows) {
  for (const r of rows || []) if (r && r.full_name) {
    if (r.avatar_url) _photoByName.set(r.full_name, r.avatar_url)
    else _photoByName.delete(r.full_name)
  }
}
// Your own messages are labelled "You"; this points "You" at your real name
// so your photo and hover card work there too.
let _myName = null
function setMyPhoto(fullName, url) {
  _myName = fullName || _myName
  if (url) _photoByName.set('You', url); else _photoByName.delete('You')
  if (fullName) { if (url) _photoByName.set(fullName, url); else _photoByName.delete(fullName) }
}
const realName = (name) => (name === 'You' && _myName) ? _myName : name

// ---- person hover card (one shared card; any <Av> can open it) ----
const _cardListeners = new Set()
let _cardTimer = null
function openPersonCard(name, el) {
  clearTimeout(_cardTimer)
  const r = el.getBoundingClientRect()
  _cardTimer = setTimeout(() => _cardListeners.forEach(fn => fn({ name: realName(name), rect: { left: r.left, top: r.top, bottom: r.bottom, right: r.right } })), 350)
}
function closePersonCard(delay = 180) {
  clearTimeout(_cardTimer)
  _cardTimer = setTimeout(() => _cardListeners.forEach(fn => fn(null)), delay)
}
function keepPersonCard() { clearTimeout(_cardTimer) }

function Av({ name, size = 24, radius = '50%', fontSize, bg, hover = true }) {
  const url = _photoByName.get(name)
  const [broken, setBroken] = useState(false)
  const hoverProps = hover && name && name !== 'Someone'
    ? { onMouseEnter: (e) => openPersonCard(name, e.currentTarget), onMouseLeave: () => closePersonCard() }
    : {}
  if (url && !broken) {
    return <img src={url} alt="" onError={() => setBroken(true)} draggable={false} {...hoverProps}
      style={{ width: size, height: size, borderRadius: radius, objectFit: 'cover', flex: 'none', display: 'block', cursor: hoverProps.onMouseEnter ? 'pointer' : undefined }} />
  }
  return (
    <span {...hoverProps} style={{ width: size, height: size, borderRadius: radius, background: bg || avatarColor(name), color: '#fff', display: 'grid', placeItems: 'center',
      fontSize: fontSize || Math.max(9, Math.round(size * 0.4)), fontWeight: 700, flex: 'none', cursor: hoverProps.onMouseEnter ? 'pointer' : undefined }}>{initials(name)}</span>
  )
}

function localTimeIn(tz) {
  try {
    const t = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz || 'America/New_York' })
    const mine = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    return t === mine ? `${t} local time` : `${t} their time`
  } catch { return null }
}
function lastSeenText(p) {
  if (!p?.last_seen_at) return 'Offline'
  const m = Math.floor((Date.now() - new Date(p.last_seen_at).getTime()) / 60000)
  if (m < 60) return `Away · active ${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `Away · active ${h}h ago`
  const d = Math.floor(h / 24)
  return d === 1 ? 'Offline · active yesterday' : `Offline · active ${d}d ago`
}

function PersonHoverCard({ profiles, me }) {
  const [card, setCard] = useState(null)
  useEffect(() => { _cardListeners.add(setCard); return () => { _cardListeners.delete(setCard) } }, [])
  if (!card) return null
  const p = profiles.find(x => x.full_name === card.name) || (me && me.full_name === card.name ? me : null)
  const name = card.name
  const photo = _photoByName.get(name)
  const st = effStatus(p)
  const online = isOnline(p)
  const ooo = st?.type === 'ooo'
  const W = 264
  const left = Math.max(8, Math.min(card.rect.left, window.innerWidth - W - 8))
  const below = card.rect.top < 330
  const pos = below ? { top: card.rect.bottom + 8 } : { bottom: window.innerHeight - card.rect.top + 8 }
  const until = st?.until ? new Date(st.until).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null
  return (
    <div role="dialog" aria-label={name} onMouseEnter={keepPersonCard} onMouseLeave={() => closePersonCard(120)}
      style={{ position: 'fixed', left, ...pos, width: W, zIndex: 80, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, boxShadow: '0 16px 40px rgba(0,0,0,.22)', overflow: 'hidden' }}>
      <div style={{ height: 170, background: photo ? '#000' : avatarColor(name), display: 'grid', placeItems: 'center', position: 'relative', overflow: 'hidden', flex: 'none' }}>
        {photo
          ? <img src={photo} alt={name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 30%', display: 'block' }} />
          : <span style={{ color: '#fff', fontSize: 56, fontWeight: 800 }}>{initials(name)}</span>}
      </div>
      <div style={{ padding: '12px 14px 14px' }}>
        <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.25 }}>
          {name}{p?.pronouns && <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-soft)', marginLeft: 6 }}>({p.pronouns})</span>}
        </div>
        {p?.job_title && <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 1 }}>{p.job_title}</div>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, marginTop: 8 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', flex: 'none', background: ooo ? '#a855f7' : online ? '#22c55e' : '#cbd5e1' }} />
          <span>{ooo ? 'Out of office' : online ? 'Active now' : lastSeenText(p)}</span>
        </div>
        {st && (st.emoji || st.text) && (
          <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start', fontSize: 13, marginTop: 6, padding: '7px 9px', background: 'var(--canvas)', borderRadius: 8 }}>
            {st.emoji && <span style={{ fontSize: 15, lineHeight: 1.2 }}>{st.emoji}</span>}
            <span style={{ minWidth: 0 }}>{st.text || ''}{until && <span className="page-sub" style={{ display: 'block', margin: 0, fontSize: 11.5 }}>Until {until}</span>}</span>
          </div>
        )}
        {p && <div className="page-sub" style={{ margin: '8px 0 0', fontSize: 12 }}>🕒 {localTimeIn(p.timezone)}</div>}
      </div>
    </div>
  )
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
function useTyping(topic, meId, meName, inbox = null) {
  // inbox = { channelId, recipients: [profile ids] } for DMs: also tells each recipient's
  // sidebar that I'm typing (topic typing-inbox:<their id>; sent without joining).
  const inboxRef = useRef(inbox)
  inboxRef.current = inbox
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
    sendInbox('typing')
  }, [meId, meName]) // eslint-disable-line react-hooks/exhaustive-deps

  const stopTyping = useCallback(() => {
    lastSent.current = 0
    chanRef.current?.send({ type: 'broadcast', event: 'stop', payload: { id: meId } })
    sendInbox('stop')
  }, [meId]) // eslint-disable-line react-hooks/exhaustive-deps

  function sendInbox(event) {
    const ib = inboxRef.current
    if (!ib?.channelId || !ib.recipients?.length) return
    for (const rid of ib.recipients) {
      if (!rid || rid === meId) continue
      try {
        supabase.channel(`typing-inbox:${rid}`)
          .send({ type: 'broadcast', event, payload: { id: meId, name: meName, channel_id: ib.channelId } })
          .catch(() => {})
      } catch { /* typing hints are best-effort */ }
    }
  }

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

// Plays audio attachments inline. Phone-system WAVs (GSM etc.) can't be decoded
// by the browser (they show 0:00), so on Play we fetch the file and, if needed,
// transcode it to mp3 first. Works for both already-posted files and new ones.
function AudioAttachment({ att }) {
  const [phase, setPhase] = useState('idle')   // idle | working | ready | error
  const [src, setSrc] = useState(null)
  const [msg, setMsg] = useState('')
  async function play() {
    if (phase === 'working') return
    setPhase('working'); setMsg('Loading…')
    try {
      const blob = await fetch(att.public_url).then(r => { if (!r.ok) throw new Error('fetch failed'); return r.blob() })
      let playable = blob
      if (await needsTranscode(blob)) { setMsg('Phone-system recording — converting so it plays (the first one this session takes a moment)…'); playable = await transcodeToMp3(blob) }
      setSrc(URL.createObjectURL(playable)); setPhase('ready'); setMsg('')
    } catch (e) { setPhase('error'); setMsg('Couldn’t play this recording here — use Download to save it.') }
  }
  return (
    <div style={{ marginTop: 6, padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--canvas)', maxWidth: 340 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 20 }}>🎧</span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{att.file_name}</div>
          <a href={att.public_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{humanSize(att.file_size)} · Download</a>
        </span>
        {phase !== 'ready' && (
          <button onClick={play} disabled={phase === 'working'}
            style={{ border: 0, background: '#16A34A', color: '#fff', borderRadius: 6, padding: '5px 12px', fontSize: 12.5, fontWeight: 600, cursor: phase === 'working' ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
            {phase === 'working' ? '…' : '▶ Play'}
          </button>
        )}
      </div>
      {msg && <div style={{ fontSize: 11.5, color: phase === 'error' ? 'var(--failed)' : 'var(--ink-soft)', marginTop: 6 }}>{msg}</div>}
      {phase === 'ready' && src && <audio controls autoPlay src={src} style={{ width: '100%', marginTop: 8, height: 36 }} />}
    </div>
  )
}

// onLoad → re-pin the scroller, since images change list height after paint.
function AttachmentView({ att, onMediaLoad, onOpenImage }) {
  const type = att.file_type || ''
  const isImg = type.startsWith('image/')
  const isVid = type.startsWith('video/')
  const isAudio = type.startsWith('audio/') || /\.(wav|mp3|m4a|ogg|aac|amr)$/i.test(att.file_name || '')

  if (isImg) {
    return (
      <img src={att.public_url} alt={att.file_name} onLoad={onMediaLoad}
        onClick={() => onOpenImage && onOpenImage(att.public_url)}
        style={{ maxWidth: 280, maxHeight: 240, borderRadius: 8, border: '1px solid var(--line)', display: 'block', marginTop: 6, cursor: 'zoom-in' }} />
    )
  }
  if (isVid) {
    return (
      <video src={att.public_url} controls onLoadedMetadata={onMediaLoad}
        style={{ maxWidth: 320, maxHeight: 260, borderRadius: 8, border: '1px solid var(--line)', marginTop: 6, display: 'block' }} />
    )
  }
  if (isAudio) return <AudioAttachment att={att} />

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

// Full-screen image lightbox — pops over chat, closes on backdrop click / X / Escape.
// Supports arrow-key + on-screen navigation across multiple images.
function Lightbox({ images, index, onClose, onNav }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') onNav(1)
      else if (e.key === 'ArrowLeft') onNav(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onNav])

  if (index == null || !images.length) return null
  const many = images.length > 1

  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.82)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      {/* close */}
      <button onClick={(e) => { e.stopPropagation(); onClose() }}
        style={{ position: 'absolute', top: 16, right: 20, background: 'none', border: 'none', color: '#fff',
          fontSize: 34, lineHeight: 1, cursor: 'pointer', opacity: 0.85 }}>×</button>

      {many && (
        <button onClick={(e) => { e.stopPropagation(); onNav(-1) }}
          style={{ position: 'absolute', left: 16, background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff',
            fontSize: 30, width: 48, height: 48, borderRadius: '50%', cursor: 'pointer' }}>‹</button>
      )}

      <img src={images[index]} alt="" onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '92vw', maxHeight: '88vh', borderRadius: 8, boxShadow: '0 8px 40px rgba(0,0,0,0.5)', objectFit: 'contain' }} />

      {many && (
        <button onClick={(e) => { e.stopPropagation(); onNav(1) }}
          style={{ position: 'absolute', right: 16, background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff',
            fontSize: 30, width: 48, height: 48, borderRadius: '50%', cursor: 'pointer' }}>›</button>
      )}

      {many && (
        <div style={{ position: 'absolute', bottom: 18, color: '#fff', fontSize: 13, opacity: 0.8 }}>{index + 1} / {images.length}</div>
      )}
    </div>
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

// ---- read receipts ----
// Given the collapsed read state (one row per person per channel, holding the
// timestamp of the newest message they've seen), work out who has seen a
// given message. See migration.sql for why it's stored this way.
function readersOf(message, readState, members, meId) {
  const t = new Date(message.created_at).getTime()
  return members
    .filter(pid => pid !== message.sender_id)      // the sender always "read" it
    .filter(pid => {
      const rs = readState[pid]
      return rs && new Date(rs).getTime() >= t
    })
}

// "Read by Ann" / "Read by Ann and Bo" / "Read by Ann, Bo and 3 others"
function readByLabel(names) {
  if (!names.length) return null
  if (names.length === 1) return `Read by ${names[0]}`
  if (names.length === 2) return `Read by ${names[0]} and ${names[1]}`
  return `Read by ${names[0]}, ${names[1]} and ${names.length - 2} other${names.length - 2 === 1 ? '' : 's'}`
}

// ---- @mention helpers ----
// Extract profile ids for names mentioned as "@Full Name" in body.
function extractMentions(body, profiles) {
  const found = []
  for (const p of profiles) {
    if (!p.full_name) continue
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
              <Av name={p.full_name} size={22} fontSize={10} />
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

// ---- Global message search ----
// Slack-style: plain text plus `from:` / `in:` filters. Searches every
// channel/DM the user belongs to (the messages_select RLS policy already
// scopes this to is_channel_member, so no extra filtering is needed for
// that) and surfaces thread replies right alongside top-level messages —
// a reply is just a row in `messages` with parent_id set, so nothing
// special has to be done to include it.
function parseSearchQuery(raw) {
  const from = []; const chan = []
  const text = raw.replace(/\b(from|in):("([^"]+)"|(\S+))/gi, (_m, key, _all, quoted, bare) => {
    const val = (quoted ?? bare ?? '').trim()
    if (val) (key.toLowerCase() === 'from' ? from : chan).push(val)
    return ' '
  }).replace(/\s+/g, ' ').trim()
  return { from, chan, text }
}

// Bolds the first case-insensitive occurrence of `term` inside `text`.
function boldMatch(text, term) {
  if (!term) return text
  const i = text.toLowerCase().indexOf(term.toLowerCase())
  if (i === -1) return text
  return <>{text.slice(0, i)}<b>{text.slice(i, i + term.length)}</b>{text.slice(i + term.length)}</>
}

// Centers the snippet on the match so a hit deep in a long message is visible.
function snippetAround(text, term) {
  if (!term) return text.slice(0, 140)
  const i = text.toLowerCase().indexOf(term.toLowerCase())
  if (i === -1) return text.slice(0, 140)
  const start = Math.max(0, i - 50)
  const end = Math.min(text.length, i + term.length + 70)
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
}

// Mirrors public.is_staff_profile / is_agent_profile in the database (keep in sync).
const STAFF_ROLE_KEYS = ['owner', 'admin', 'marketing', 'sales', 'asc', 'support', 'certification', 'quality']
const roleKeys = (p) => String(p?.role || '').toLowerCase().split(',').map(r => r.trim()).filter(Boolean)
export function isStaffProfile(p) {
  if (!p) return false
  const k = roleKeys(p)
  return (p.is_admin || k.some(r => STAFF_ROLE_KEYS.includes(r))) && !k.includes('agent') && !k.includes('client')
}
export function isAgentProfile(p) {
  return !!p && !p.is_admin && roleKeys(p).includes('agent')
}

// Hidden from my sidebar? Channels stay hidden until unhidden; DMs come back as
// soon as there's a message newer than when I hid (or deleted) them.
function hiddenBy(prefMap, c) {
  const h = prefMap[c.id]?.hidden_at
  if (!h) return false
  if (c.is_dm && c.last_message_at && new Date(c.last_message_at) > new Date(h)) return false
  return true
}

const GROUP_ICONS = [null, '⭐', '📊', '👥', '⚙️', '🏢', '🚀', '📞', '💼', '🛠️', '📣', '🎯', '💡', '❤️', '💜', '🔥']

function NameModal({ title, initial, initialIcon = null, withIcon = false, onSave, onClose }) {
  const [val, setVal] = useState(initial || '')
  const [icon, setIcon] = useState(initialIcon)
  const ok = val.trim().length > 0 && val.trim().length <= 60
  const submit = () => { if (!ok) return; onSave(val, withIcon ? icon : undefined); onClose() }
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 70, display: 'grid', placeItems: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: 12, padding: 18, width: 'min(380px, 100%)', boxShadow: '0 20px 50px rgba(0,0,0,.25)' }}>
        <b style={{ fontSize: 15 }}>{title}</b>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {withIcon && icon && <span style={{ width: 38, height: 38, flex: 'none', display: 'grid', placeItems: 'center', border: '1px solid var(--line)', borderRadius: 8, fontSize: 18 }}>{icon}</span>}
          <input autoFocus value={val} maxLength={60} onChange={e => setVal(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onClose() }}
            placeholder="e.g. Clients / Brands, Internal, Tools & Projects"
            style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 14 }} />
        </div>
        {withIcon && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 10 }}>
            {GROUP_ICONS.map(ic => (
              <button key={ic || 'none'} onClick={() => setIcon(ic)} title={ic ? '' : 'No icon'}
                style={{ width: ic ? 32 : 'auto', padding: ic ? 0 : '0 9px', height: 32, fontSize: ic ? 16 : 12, color: 'var(--ink-soft)', fontFamily: 'inherit', borderRadius: 7, cursor: 'pointer', border: icon === ic ? '2px solid var(--accent)' : '1px solid var(--line)', background: icon === ic ? 'var(--accent-bg)' : 'var(--surface)' }}>{ic || 'No icon'}</button>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={!ok} onClick={submit}>Save</button>
        </div>
      </div>
    </div>
  )
}

// Sidebar styling (hover-only ⋯ on desktop, compact rows). Kept here so Chat.jsx
// stays a single drop-in file.
const SIDEBAR_CSS = `
.chat-typing-dots { display: inline-flex; align-items: center; gap: 3px; padding: 4px 7px; border-radius: 10px; background: var(--surface); border: 1px solid var(--line); flex: none; }
.chat-typing-dots i { width: 4px; height: 4px; border-radius: 50%; background: var(--ink-soft); animation: chatTypingDot 1.2s infinite ease-in-out; }
.chat-typing-dots i:nth-child(2) { animation-delay: .15s; }
.chat-typing-dots i:nth-child(3) { animation-delay: .3s; }
@keyframes chatTypingDot { 0%, 60%, 100% { transform: translateY(0); opacity: .45; } 30% { transform: translateY(-3px); opacity: 1; } }
.chat-side-row { display: flex; align-items: center; border-radius: 6px; margin: 0 2px 1px; }
.chat-side-row:hover { background: var(--surface); }
.chat-side-row.is-active { background: var(--accent-bg); }
.chat-side-btn { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; text-align: left; border: 0; background: transparent; border-radius: 6px; cursor: pointer; font-family: inherit; line-height: 1.35; }
.chat-side-more { border: 0; background: transparent; cursor: pointer; color: var(--ink-soft); font-size: 15px; line-height: 1; padding: 4px 7px; flex: none; border-radius: 6px; opacity: 0; }
.chat-side-row:hover .chat-side-more, .chat-side-head:hover .chat-side-more, .chat-side-more.is-open, .chat-side-more:focus-visible { opacity: 1; }
.chat-side-more:hover { background: var(--line); }
.chat-side-head { display: flex; justify-content: space-between; align-items: center; padding: 10px 2px 2px; }
.chat-side-head-btn { display: inline-flex; align-items: center; gap: 6px; border: 0; background: transparent; cursor: pointer; padding: 3px 8px; font-family: inherit; font-size: 13px; font-weight: 600; color: var(--ink-soft); min-width: 0; border-radius: 6px; }
.chat-side-head-btn:hover { background: var(--surface); color: var(--ink); }
@media (hover: none) { .chat-side-more { opacity: .6; } }
`

function ChatSearchBar({ channels, profiles, dmNames, prefs = {}, onJump }) {
  const [raw, setRaw] = useState('')
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [hint, setHint] = useState('')
  const boxRef = useRef(null)
  const debounceRef = useRef(null)
  const reqId = useRef(0)

  useEffect(() => {
    function onDocClick(e) { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (!raw.trim()) { setResults([]); setHint(''); setLoading(false); return }
    debounceRef.current = setTimeout(() => runSearch(raw), 300)
    return () => clearTimeout(debounceRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, channels, profiles])

  async function runSearch(q) {
    const myReq = ++reqId.current
    const { from, chan, text } = parseSearchQuery(q)
    let hintMsg = ''

    let senderIds = null
    if (from.length) {
      const ids = new Set(); const unmatched = []
      for (const tok of from) {
        const t = tok.toLowerCase()
        const matches = profiles.filter(p => (p.full_name || '').toLowerCase().includes(t))
        if (matches.length) matches.forEach(p => ids.add(p.id)); else unmatched.push(tok)
      }
      senderIds = [...ids]
      if (unmatched.length) hintMsg = `No one matches "from:${unmatched[0]}"`
      if (!senderIds.length) { setHint(hintMsg); setResults([]); return }
    }

    let channelIds = null
    if (chan.length) {
      const ids = new Set(); const unmatched = []
      for (const tok of chan) {
        const t = tok.toLowerCase()
        const matches = channels.filter(c => {
          const lbl = c.is_dm ? (dmNames[c.id] || c.name || '') : (c.name || '')
          return lbl.toLowerCase().includes(t)
        })
        if (matches.length) matches.forEach(c => ids.add(c.id)); else unmatched.push(tok)
      }
      channelIds = [...ids]
      if (unmatched.length) hintMsg = hintMsg || `No channel matches "in:${unmatched[0]}"`
      if (!channelIds.length) { setHint(hintMsg); setResults([]); return }
    }

    if (!text && !senderIds && !channelIds) { setHint(''); setResults([]); return }

    setLoading(true)
    let query = supabase.from('messages').select('id, channel_id, sender_id, body, created_at, parent_id')
      .is('deleted_at', null).order('created_at', { ascending: false }).limit(40)
    if (senderIds) query = query.in('sender_id', senderIds)
    if (channelIds) query = query.in('channel_id', channelIds)
    if (text) query = query.ilike('body', `%${text}%`)
    const { data, error } = await query
    if (myReq !== reqId.current) return  // a newer keystroke already superseded this one
    setLoading(false)
    if (error) { setHint(error.message); setResults([]); return }
    setHint(hintMsg)
    setResults((data || [])
      .filter(m => { const cl = prefs[m.channel_id]?.cleared_at; return !cl || new Date(m.created_at) > new Date(cl) })
      .map(m => ({ ...m, _term: text })))
  }

  function channelLabel(channelId) {
    const c = channels.find(c => c.id === channelId)
    if (!c) return '—'
    return c.is_dm ? (dmNames[c.id] || c.name || 'DM') : `# ${c.name}`
  }

  return (
    <div ref={boxRef} style={{ position: 'relative', padding: '10px 12px', borderBottom: '1px solid var(--line)', flex: 'none' }}>
      <input
        value={raw}
        onChange={e => setRaw(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder="🔍 Search messages… (try from: or in:)"
        style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 13 }}
      />
      {open && raw.trim() && (
        <div style={{ position: 'absolute', left: 12, right: 12, top: '100%', marginTop: 4, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,.18)', zIndex: 50, maxHeight: 420, overflowY: 'auto' }}>
          {loading && <div className="page-sub" style={{ padding: 12, fontSize: 12.5 }}>Searching…</div>}
          {!loading && hint && <div className="page-sub" style={{ padding: '10px 12px', fontSize: 12 }}>{hint}</div>}
          {!loading && !hint && results.length === 0 && (
            <div className="page-sub" style={{ padding: 12, fontSize: 12.5 }}>No messages match.</div>
          )}
          {!loading && results.map(m => {
            const sender = profiles.find(p => p.id === m.sender_id)
            const text = htmlToText(m.body || '')
            return (
              <button key={m.id} onClick={() => { onJump(m); setOpen(false) }}
                style={{ display: 'block', width: '100%', textAlign: 'left', border: 0, borderBottom: '1px solid var(--line)', background: 'transparent', cursor: 'pointer', padding: '9px 12px', fontFamily: 'inherit' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, color: 'var(--ink-soft)', marginBottom: 2 }}>
                  <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{sender?.full_name || 'Someone'}</span>
                  <span style={{ flex: 'none' }}>{timeLabel(m.created_at)}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 2 }}>
                  {channelLabel(m.channel_id)}{m.parent_id ? ' · ↩ reply in thread' : ''}
                </div>
                <div style={{ fontSize: 13, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {boldMatch(snippetAround(text, m._term), m._term)}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function Chat() {
  const { isAdmin, level, appRole } = useAuth()
  const isOwner = (level || 0) >= 100
  // Matrix-driven: who can start new channels / DMs (see lib/permissions.js).
  const canCreateChannels = isAdmin || can(appRole, 'chat.create_channels')
  const canCreateDMs = isAdmin || can(appRole, 'chat.create_dms')
  const isMobile = useIsMobile()
  const { counts: unreadCounts, markRead } = useUnread()
  const [me, setMe] = useState(null)
  const [channels, setChannels] = useState([])
  const [activeId, setActiveId] = useState(null)
  // Lets the notification bell skip its pop-up for the conversation you're looking at.
  useEffect(() => {
    window.__ccOpenChannel = activeId || null
    return () => { if (window.__ccOpenChannel === activeId) window.__ccOpenChannel = null }
  }, [activeId])
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [showDM, setShowDM] = useState(false)
  const [dmNames, setDmNames] = useState({}) // channelId -> other person's name
  const [dmPeers, setDmPeers] = useState({}) // channelId -> the other person's profile_id (1:1 DMs only)
  // Who's typing in which DM right now (for the ••• in the sidebar). channelId -> { profileId: lastSeenMs }
  const [dmTyping, setDmTyping] = useState({})
  useEffect(() => {
    if (!me?.id) return
    const ch = supabase.channel(`typing-inbox:${me.id}`, { config: { broadcast: { self: false } } })
    ch.on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (!payload?.channel_id || !payload.id || payload.id === me.id) return
      setDmTyping(prev => ({ ...prev, [payload.channel_id]: { ...(prev[payload.channel_id] || {}), [payload.id]: Date.now() } }))
    }).on('broadcast', { event: 'stop' }, ({ payload }) => {
      if (!payload?.channel_id || !payload.id) return
      setDmTyping(prev => {
        if (!prev[payload.channel_id]?.[payload.id]) return prev
        const inner = { ...prev[payload.channel_id] }; delete inner[payload.id]
        return { ...prev, [payload.channel_id]: inner }
      })
    }).subscribe()
    // drop anyone who hasn't sent a typing ping for 4s (a missed "stop", closed tab…)
    const sweep = setInterval(() => {
      setDmTyping(prev => {
        const now = Date.now(); let changed = false; const next = {}
        for (const [cid, who] of Object.entries(prev)) {
          const keep = {}
          for (const [pid, at] of Object.entries(who)) { if (now - at < 4000) keep[pid] = at; else changed = true }
          if (Object.keys(keep).length) next[cid] = keep; else if (Object.keys(who).length) changed = true
        }
        return changed ? next : prev
      })
    }, 1000)
    return () => { clearInterval(sweep); supabase.removeChannel(ch) }
  }, [me?.id])
  const [mobileView, setMobileView] = useState('list') // 'list' | 'convo' (mobile only)

  // ---- Sidebar organization — per person (favorites, pins, groups, hide, delete DM) ----
  // Stored in channel_prefs (own-row RLS) + chat_sections. Nothing here changes
  // anyone else's sidebar.
  const [prefs, setPrefs] = useState({})          // channelId -> my channel_prefs row
  const [sections, setSections] = useState([])    // my custom groups, ordered
  const [menu, setMenu] = useState(null)          // { kind:'item'|'section', id, x, y, view }
  const [showHidden, setShowHidden] = useState(false)
  const [nameModal, setNameModal] = useState(null) // { title, initial, onSave }
  // Staff only: DMs from agents turned off (main switch + per-agent exceptions).
  const [agentDm, setAgentDm] = useState({ blockAll: false, overrides: {} })
  // A new profile photo (uploaded in Profile or Settings) shows in Chat right away.
  const [, setPhotoTick] = useState(0)
  useEffect(() => {
    const onPhoto = (e) => {
      setMyPhoto(_myName, e.detail || null)
      setProfiles(prev => prev.map(p => p.full_name === _myName ? { ...p, avatar_url: e.detail || null } : p))
      setPhotoTick(t => t + 1)
    }
    window.addEventListener('cc:avatar-updated', onPhoto)
    return () => window.removeEventListener('cc:avatar-updated', onPhoto)
  }, [])
  const [builtinCollapsed, setBuiltinCollapsed] = useState(() => {
    try { return JSON.parse(localStorage.getItem('chat.sidebarCollapsed') || '{}') } catch { return {} }
  })

  // Read activeId inside load() without making load() depend on it (stale-closure fix).
  const activeIdRef = useRef(activeId)
  useEffect(() => { activeIdRef.current = activeId }, [activeId])

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      // Only channels I'm actually a member of.
      const { data: myMem } = await supabase.from('channel_members')
        .select('channel_id').eq('profile_id', user.id)
      const myChannelIds = (myMem || []).map(m => m.channel_id)

      const [meRes, chRes, profRes] = await Promise.all([
        supabase.from('profiles').select('id, full_name, role, is_admin, avatar_url, job_title, pronouns, timezone, last_seen_at, status_emoji, status_text, status_type, status_until').eq('id', user.id).single(),
        myChannelIds.length
          ? supabase.from('channels').select('*').in('id', myChannelIds).order('name')
          : Promise.resolve({ data: [], error: null }),
        supabase.from('profiles').select('id, full_name, avatar_url, job_title, pronouns, timezone, role, is_admin, is_active, last_seen_at, status_emoji, status_text, status_type, status_until').eq('is_active', true).order('full_name'),
      ])
      if (chRes.error) throw chRes.error
      setMe(meRes.data)
      setChannels(chRes.data || [])
      registerPhotos(profRes.data)
      if (meRes.data) setMyPhoto(meRes.data.full_name, meRes.data.avatar_url)
      setProfiles(profRes.data || [])

      const [prefRes, secRes] = await Promise.all([
        myChannelIds.length
          ? supabase.from('channel_prefs').select('channel_id, favorite, pinned_at, section_id, hidden_at, cleared_at')
              .eq('profile_id', user.id).in('channel_id', myChannelIds)
          : Promise.resolve({ data: [] }),
        supabase.from('chat_sections').select('*').eq('profile_id', user.id)
          .order('sort_order').order('created_at'),
      ])
      const prefMap = {}; (prefRes.data || []).forEach(r => { prefMap[r.channel_id] = r })
      setPrefs(prefMap)

      if (isStaffProfile(meRes.data)) {
        const [setRes, ovRes] = await Promise.all([
          supabase.from('dm_agent_settings').select('block_all').eq('profile_id', user.id).maybeSingle(),
          supabase.from('dm_agent_overrides').select('agent_id, blocked').eq('staff_id', user.id),
        ])
        const ov = {}; (ovRes.data || []).forEach(r => { ov[r.agent_id] = r.blocked })
        setAgentDm({ blockAll: !!setRes.data?.block_all, overrides: ov })
      }
      setSections(secRes.data || [])

      const all = chRes.data || []
      const visibleAll = all.filter(c => !hiddenBy(prefMap, c))
      if (!activeIdRef.current && visibleAll.length && window.innerWidth > 700) {
        // Open the most recently active conversation, matching the sidebar order.
        const mostRecent = visibleAll.slice().sort((a, b) =>
          new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0))[0]
        setActiveId(mostRecent.id)
      }

      // for DMs, name the conversation after the OTHER members.
      // 1:1  → their full name ("Corinne Alvarez")
      // group → first names ("Becky, Corinne" style)
      const dmChannels = all.filter(c => c.is_dm)
      if (dmChannels.length) {
        const { data: mem } = await supabase.from('channel_members')
          .select('channel_id, profile_id').in('channel_id', dmChannels.map(c => c.id))
        const othersByChannel = {}
        dmChannels.forEach(c => {
          othersByChannel[c.id] = (mem || [])
            .filter(m => m.channel_id === c.id && m.profile_id !== meRes.data.id)
            .map(m => m.profile_id)
        })
        const ids = [...new Set(Object.values(othersByChannel).flat())]
        if (ids.length) {
          const { data: profs } = await supabase.from('profiles').select('id, full_name, avatar_url').in('id', ids); registerPhotos(profs)
          const nameById = {}; (profs || []).forEach(p => nameById[p.id] = p.full_name)
          const map = {}
          const peers = {}
          Object.entries(othersByChannel).forEach(([cid, pids]) => {
            if (pids.length === 0) map[cid] = 'Just you'
            else if (pids.length === 1) { map[cid] = nameById[pids[0]] || 'Unknown'; peers[cid] = pids[0] }
            else map[cid] = pids.map(pid => (nameById[pid] || 'Unknown').split(' ')[0]).sort().join(', ')
          })
          setDmNames(map)
          setDmPeers(peers)
        }
      }
    } catch (e) { setErr(e.message) } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // Keep presence fresh (online/offline + status) without a full reload: poll just the
  // presence columns every 60s and merge them into the loaded profiles by id.
  useEffect(() => {
    const refresh = async () => {
      const { data } = await supabase.from('profiles')
        .select('id, last_seen_at, status_emoji, status_text, status_type, status_until').eq('is_active', true)
      if (!data) return
      const byId = {}; data.forEach(r => { byId[r.id] = r })
      setProfiles(prev => prev.map(p => byId[p.id] ? { ...p, ...byId[p.id] } : p))
    }
    const iv = setInterval(refresh, 60000)
    return () => clearInterval(iv)
  }, [])

  // ---- Live sidebar ordering ----
  // Any new message (top-level or reply) bumps its channel's last_message_at
  // locally so the list re-sorts without a reload. Unfiltered subscription,
  // same reasoning as elsewhere: RLS limits what we receive; we only touch
  // channels already in state.
  useEffect(() => {
    const ch = supabase.channel('chat-activity')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const m = payload.new
          if (!m?.channel_id) return
          setChannels(prev => prev.map(c =>
            c.id === m.channel_id && (!c.last_message_at || new Date(m.created_at) > new Date(c.last_message_at))
              ? { ...c, last_message_at: m.created_at }
              : c))
        })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  // ---- Notification deep links: /chat?channel=<id>&message=<id> ----
  // Notifications have always generated these links; nothing consumed them,
  // so clicking a notification dumped you at the top of chat and you had to
  // hunt for the message. Open the right channel here; ChannelPane opens the
  // thread / scrolls to the message via targetMessageId.
  const [searchParams, setSearchParams] = useSearchParams()
  const [targetMessageId, setTargetMessageId] = useState(null)
  useEffect(() => {
    if (loading) return
    const chParam = searchParams.get('channel')
    const msgParam = searchParams.get('message')
    if (!chParam && !msgParam) return
    if (chParam && channels.some(c => c.id === chParam)) {
      setActiveId(chParam)
      setMobileView('convo')
      markRead(chParam)
      if (msgParam) setTargetMessageId(msgParam)
    }
    // Consume the params so refreshes / channel switches behave normally.
    setSearchParams({}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, searchParams])

  // ---- Sidebar organization actions ----
  async function savePref(channelId, patch) {
    setPrefs(prev => ({ ...prev, [channelId]: { ...(prev[channelId] || {}), channel_id: channelId, ...patch } }))
    const { error } = await supabase.from('channel_prefs')
      .upsert({ profile_id: me.id, channel_id: channelId, ...patch }, { onConflict: 'profile_id,channel_id' })
    if (error) { window.alert('Could not save: ' + error.message); load() }
  }
  // ---- Turning off DMs from agents (staff only; enforced by the database) ----
  // For the open 1:1 DM: a staff-side note + one-click "turn on" when the agent can't reply.
  const agentMutedFor = (channelId) => {
    const c = channels.find(x => x.id === channelId)
    const ag = agentPeer(c)
    if (!amStaff || !ag || !agentBlocked(ag.id)) return null
    return { name: ag.full_name, onTurnOn: () => setAgentBlocked(ag.id, false) }
  }
  const amStaff = isStaffProfile(me)
  const agentBlocked = (agentId) => {
    if (!amStaff || !agentId) return false
    const o = agentDm.overrides[agentId]
    return o === undefined ? agentDm.blockAll : o
  }
  const agentPeer = (c) => {
    if (!c?.is_dm) return null
    const peer = dmPeers[c.id] ? profiles.find(p => p.id === dmPeers[c.id]) : null
    return peer && isAgentProfile(peer) ? peer : null
  }
  async function setAgentBlocked(agentId, blocked) {
    setAgentDm(prev => ({ ...prev, overrides: { ...prev.overrides, [agentId]: blocked } }))
    const { error } = await supabase.from('dm_agent_overrides')
      .upsert({ staff_id: me.id, agent_id: agentId, blocked, updated_at: new Date().toISOString() }, { onConflict: 'staff_id,agent_id' })
    if (error) { window.alert('Could not save: ' + error.message); load() }
  }

  const toggleFavorite = (c) => savePref(c.id, { favorite: !prefs[c.id]?.favorite })
  const togglePin = (c) => savePref(c.id, { pinned_at: prefs[c.id]?.pinned_at ? null : new Date().toISOString() })
  const moveToSection = (c, sectionId) => savePref(c.id, { section_id: sectionId, ...(sectionId ? { favorite: false } : {}) })
  const hideItem = (c) => {
    savePref(c.id, { hidden_at: new Date().toISOString() })
    if (activeId === c.id) { setActiveId(null); setMobileView('list') }
  }
  const unhideItem = (c) => savePref(c.id, { hidden_at: null })

  // "Delete" a DM for me only: drop it from my list. History is kept — the other
  // people keep everything, and if a new message comes in it comes back with
  // the full conversation.
  async function deleteDmForMe(c) {
    const who = dmNames[c.id] || 'this person'
    const many = who.includes(',')
    if (!window.confirm(`Remove your conversation with ${who}?\n\nIt's removed from your list only. ${who} ${many ? 'still have' : 'still has'} it. If a new message comes in, it comes back with the full history.`)) return
    await savePref(c.id, { hidden_at: new Date().toISOString(), pinned_at: null, favorite: false, section_id: null })
    markRead(c.id)
    if (activeId === c.id) { setActiveId(null); setMobileView('list') }
  }

  async function createSection(name, thenMove, icon = null) {
    const sort_order = sections.length ? Math.max(...sections.map(s => s.sort_order || 0)) + 1 : 0
    const { data, error } = await supabase.from('chat_sections')
      .insert({ profile_id: me.id, name: name.trim(), icon: icon || null, sort_order }).select().single()
    if (error) { window.alert('Could not create group: ' + error.message); return }
    setSections(prev => [...prev, data])
    if (thenMove) moveToSection(thenMove, data.id)
  }
  async function updateSection(id, patch) {
    setSections(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s))
    const { error } = await supabase.from('chat_sections').update(patch).eq('id', id)
    if (error) window.alert('Could not update group: ' + error.message)
  }
  async function deleteSection(sec) {
    if (!window.confirm(`Delete the group "${sec.name}"? Its chats move back to Channels / Direct messages. Nothing is deleted.`)) return
    setSections(prev => prev.filter(s => s.id !== sec.id))
    setPrefs(prev => {
      const n = { ...prev }
      Object.keys(n).forEach(k => { if (n[k].section_id === sec.id) n[k] = { ...n[k], section_id: null } })
      return n
    })
    // FK is ON DELETE SET NULL, so prefs rows are released server-side.
    const { error } = await supabase.from('chat_sections').delete().eq('id', sec.id)
    if (error) { window.alert('Could not delete group: ' + error.message); load() }
  }
  async function moveSection(sec, dir) {
    const list = sections.slice()
    const i = list.findIndex(s => s.id === sec.id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= list.length) return
    ;[list[i], list[j]] = [list[j], list[i]]
    const reordered = list.map((s, idx) => ({ ...s, sort_order: idx }))
    setSections(reordered)
    const changed = reordered.filter(s => sections.find(o => o.id === s.id)?.sort_order !== s.sort_order)
    await Promise.all(changed.map(s => supabase.from('chat_sections').update({ sort_order: s.sort_order }).eq('id', s.id)))
  }
  function toggleBuiltin(key) {
    setBuiltinCollapsed(prev => {
      const n = { ...prev, [key]: !prev[key] }
      try { localStorage.setItem('chat.sidebarCollapsed', JSON.stringify(n)) } catch { /* ignore */ }
      return n
    })
  }
  function openMenu(e, kind, id) {
    e.stopPropagation()
    const r = e.currentTarget.getBoundingClientRect()
    setMenu(prev => prev && prev.id === id && prev.kind === kind ? null : { kind, id, x: r.right, y: r.bottom, view: 'main' })
  }

  async function deleteChannel(ch) {
    const label = ch.is_dm ? (dmNames[ch.id] || 'this direct message') : `#${ch.name}`
    if (!window.confirm(`Delete ${label}? This permanently removes the conversation and all its messages for everyone. This cannot be undone.`)) return
    const { error } = await supabase.from('channels').delete().eq('id', ch.id)
    if (error) { window.alert('Could not delete: ' + error.message); return }
    if (activeId === ch.id) { setActiveId(null); setMobileView('list') }
    load()
  }

  // ---- Slack-style anchoring ----
  // Instead of guessing the chrome above us (the old hard-coded 150px, which
  // left a dead strip under the composer), measure where the chat shell
  // actually starts and fill exactly to the bottom of the window. The page
  // never scrolls; only the message list does.
  const shellRef = useRef(null)
  const [chatH, setChatH] = useState(null)
  useLayoutEffect(() => {
    const compute = () => {
      if (!shellRef.current) return
      const scroller = shellRef.current.closest('.main')
      if (scroller) scroller.scrollTop = 0
      const top = shellRef.current.getBoundingClientRect().top
      setChatH(Math.max(380, window.innerHeight - top - 16))
    }
    compute()
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [loading])

  // Safety net: the shell has overflow:hidden, which is still programmatically
  // scrollable. Anything that nudges it sideways hides the conversation list, so
  // snap it back rather than leaving the sidebar stranded off-screen.
  // MUST stay above the `if (loading) return` below: a hook after an early
  // return is skipped on the first render, and the changing hook count crashes
  // the whole app with React error #310.
  useEffect(() => {
    const el = shellRef.current
    if (!el) return
    const onScroll = () => { if (el.scrollLeft !== 0) el.scrollLeft = 0 }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [loading])

  if (loading) return <p className="page-sub">Loading chat…</p>

  const openChannel = (id) => { setActiveId(id); setMobileView('convo'); markRead(id) }

  // A search hit jumps to its channel and reuses the same deep-link mechanism
  // notifications already use (targetMessageId) — ChannelPane scrolls to the
  // message and, if it's a thread reply, opens the thread panel for it.
  const jumpToSearchResult = (m) => {
    setActiveId(m.channel_id)
    setMobileView('convo')
    markRead(m.channel_id)
    setTargetMessageId(m.id)
  }

  // On mobile, show either the list or the conversation. On desktop, both.
  const showList = !isMobile || mobileView === 'list'
  const showConvo = !isMobile || mobileView === 'convo'

  // Most recent activity first; untouched channels fall to the bottom
  // alphabetically. Applies to channels and DMs alike.
  const byActivity = (a, b) => {
    const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0
    const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0
    if (tb !== ta) return tb - ta
    return (a.name || '').localeCompare(b.name || '')
  }
  // Pinned items first (in the order they were pinned), then by activity.
  const byPinThenActivity = (a, b) => {
    const pa = prefs[a.id]?.pinned_at, pb = prefs[b.id]?.pinned_at
    if (pa && !pb) return -1
    if (pb && !pa) return 1
    if (pa && pb) return new Date(pa) - new Date(pb)
    return byActivity(a, b)
  }
  const sectionIds = new Set(sections.map(s => s.id))
  const visible = channels.filter(c => !hiddenBy(prefs, c))
  const hiddenList = channels.filter(c => hiddenBy(prefs, c)).sort(byActivity)
  const isFav = (c) => !!prefs[c.id]?.favorite
  const groupOf = (c) => (!isFav(c) && sectionIds.has(prefs[c.id]?.section_id)) ? prefs[c.id].section_id : null
  const favList = visible.filter(isFav).sort(byPinThenActivity)
  const channelList = visible.filter(c => !c.is_dm && !isFav(c) && !groupOf(c)).sort(byPinThenActivity)
  const dmList = visible.filter(c => c.is_dm && !isFav(c) && !groupOf(c)).sort(byPinThenActivity)
  const hiddenUnread = hiddenList.reduce((n, c) => n + (unreadCounts[c.id] || 0), 0)

  // A collapsed section still shows anything unread (and whatever is open).
  const whenCollapsed = (list, collapsed) => collapsed ? list.filter(c => unreadCounts[c.id] || c.id === activeId) : list

  const unreadBadge = (n) => n > 0 && (
    <span style={{ background: '#DC2626', color: '#fff', fontSize: 11, fontWeight: 700, minWidth: 18, height: 18, borderRadius: 9, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px', flex: 'none' }}>{n > 99 ? '99+' : n}</span>
  )

  const renderRow = (c, { dim = false } = {}) => {
    const typingHere = c.is_dm && Object.keys(dmTyping[c.id] || {}).length > 0
    const active = c.id === activeId && !isMobile
    const unread = unreadCounts[c.id] || 0
    const pinnedHere = !!prefs[c.id]?.pinned_at
    const peer = c.is_dm && dmPeers[c.id] ? profiles.find(p => p.id === dmPeers[c.id]) : null
    const st = peer && effStatus(peer)
    const label = c.is_dm ? (dmNames[c.id] || c.name || 'Direct message') : c.name
    const isGroupDm = c.is_dm && !peer
    return (
      <div key={c.id} className={'chat-side-row' + (active ? ' is-active' : '')} style={{ opacity: dim ? 0.7 : 1 }}>
        <button onClick={() => openChannel(c.id)} className="chat-side-btn"
          style={{ color: active ? 'var(--accent)' : unread ? 'var(--ink)' : 'var(--ink-soft)', fontWeight: unread ? 700 : 500, padding: isMobile ? '9px 10px' : '4px 8px', fontSize: isMobile ? 15 : 13.5 }}>
          {c.is_dm ? (
            <span style={{ position: 'relative', width: 20, height: 20, flex: 'none' }}>
              {isGroupDm ? (
                <span style={{ width: 20, height: 20, borderRadius: 5, background: 'var(--line)', color: 'var(--ink-soft)', fontSize: 9, fontWeight: 700, display: 'grid', placeItems: 'center' }}>
                  {label.split(',').length}
                </span>
              ) : <Av name={label} size={20} radius={5} fontSize={9} />}
              {peer && <span style={{ position: 'absolute', right: -3, bottom: -3 }}><PresenceDot profile={peer} size={8} ring="var(--canvas)" /></span>}
            </span>
          ) : (
            <span style={{ width: 20, textAlign: 'center', flex: 'none', opacity: 0.7, fontWeight: 500 }}>#</span>
          )}
          <span style={{ flex: 1, display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
            {st && st.emoji ? <span title={st.text || ''} style={{ fontSize: 12, flex: 'none' }}>{st.emoji}</span> : null}
            {pinnedHere && <span title="Pinned" style={{ fontSize: 10, flex: 'none' }}>📌</span>}
            {amStaff && peer && isAgentProfile(peer) && agentBlocked(peer.id) && <span title="Messages from this agent are turned off" style={{ fontSize: 10.5, flex: 'none' }}>🔕</span>}
          </span>
          {typingHere && <span className="chat-typing-dots" title={`${label} ${label.includes(',') ? 'are' : 'is'} typing…`} aria-label="typing"><i /><i /><i /></span>}
          {unreadBadge(unread)}
        </button>
        <button onClick={(e) => openMenu(e, 'item', c.id)} title="Options" aria-label="Options"
          className={'chat-side-more' + (menu?.id === c.id ? ' is-open' : '')}>⋯</button>
      </div>
    )
  }

  // Inside Favorites and custom groups: channels first, then DMs.
  const renderTyped = (list) => (<>
    {list.filter(c => !c.is_dm).map(c => renderRow(c))}
    {list.filter(c => c.is_dm).map(c => renderRow(c))}
  </>)

  const renderHeader = ({ key, label, icon, count, collapsed, onToggle, right, unread }) => (
    <div key={key} className="chat-side-head">
      <button onClick={onToggle} className="chat-side-head-btn">
        <span style={{ fontSize: 12, width: 10, flex: 'none', opacity: 0.8 }}>{collapsed ? '▸' : '▾'}</span>
        {icon && <span style={{ fontSize: 13, width: 18, textAlign: 'center', flex: 'none' }}>{icon}</span>}
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}{count != null ? ` (${count})` : ''}</span>
        {unread ? unreadBadge(unread) : null}
      </button>
      {right}
    </div>
  )

  const menuItem = (label, onClick, { danger = false, checked = false } = {}) => (
    <button key={label} onClick={(e) => { e.stopPropagation(); onClick() }}
      style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', border: 0, background: 'transparent', padding: '8px 12px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', color: danger ? '#DC2626' : 'var(--ink)' }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--canvas)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
      <span style={{ flex: 1 }}>{label}</span>{checked && <span>✓</span>}
    </button>
  )

  const renderMenu = () => {
    if (!menu) return null
    const close = () => setMenu(null)
    let body = null
    if (menu.kind === 'item') {
      const c = channels.find(x => x.id === menu.id)
      if (!c) return null
      const pref = prefs[c.id] || {}
      const hidden = hiddenBy(prefs, c)
      if (menu.view === 'groups') {
        body = (<>
          {menuItem('‹ Back', () => setMenu({ ...menu, view: 'main' }))}
          <div style={{ borderTop: '1px solid var(--line)', margin: '4px 0' }} />
          {sections.map(sec => menuItem(sec.name, () => { moveToSection(c, sec.id); close() }, { checked: pref.section_id === sec.id && !pref.favorite }))}
          {menuItem('＋ New group…', () => { close(); setNameModal({ title: 'New group', initial: '', withIcon: true, onSave: (n, ic) => createSection(n, c, ic) }) })}
          {pref.section_id && sectionIds.has(pref.section_id) && menuItem('Remove from group', () => { moveToSection(c, null); close() })}
        </>)
      } else {
        body = (<>
          {!hidden && menuItem(pref.favorite ? '☆ Remove from Favorites' : '⭐ Add to Favorites', () => { toggleFavorite(c); close() })}
          {!hidden && menuItem(pref.pinned_at ? '📌 Unpin' : '📌 Pin to top', () => { togglePin(c); close() })}
          {!hidden && menuItem('📁 Move to group…', () => setMenu({ ...menu, view: 'groups' }))}
          {hidden
            ? menuItem('👁 Unhide', () => { unhideItem(c); close() })
            : menuItem('🙈 Hide', () => { hideItem(c); close() })}
          {c.is_dm && <div style={{ borderTop: '1px solid var(--line)', margin: '4px 0' }} />}
          {amStaff && agentPeer(c) && (() => {
            const ag = agentPeer(c), off = agentBlocked(ag.id), first = (ag.full_name || 'this agent').split(' ')[0]
            return menuItem(off ? `🔔 Turn on messages from ${first}` : `🔕 Turn off messages from ${first}`, () => { setAgentBlocked(ag.id, !off); close() })
          })()}
          {c.is_dm && menuItem('✕ Remove conversation', () => { close(); deleteDmForMe(c) })}
          {isOwner && !c.is_dm && <div style={{ borderTop: '1px solid var(--line)', margin: '4px 0' }} />}
          {isOwner && menuItem(c.is_dm ? '⚠ Delete for everyone' : '🗑 Delete channel for everyone', () => { close(); deleteChannel(c) }, { danger: true })}
        </>)
      }
    } else {
      const sec = sections.find(x => x.id === menu.id)
      if (!sec) return null
      const idx = sections.findIndex(x => x.id === sec.id)
      body = (<>
        {menuItem('✏️ Rename / change icon', () => { close(); setNameModal({ title: 'Edit group', initial: sec.name, initialIcon: sec.icon || null, withIcon: true, onSave: (n, ic) => updateSection(sec.id, { name: n.trim(), icon: ic || null }) }) })}
        {idx > 0 && menuItem('↑ Move up', () => { moveSection(sec, -1); close() })}
        {idx < sections.length - 1 && menuItem('↓ Move down', () => { moveSection(sec, 1); close() })}
        <div style={{ borderTop: '1px solid var(--line)', margin: '4px 0' }} />
        {menuItem('🗑 Delete group', () => { close(); deleteSection(sec) }, { danger: true })}
      </>)
    }
    const W = 230
    const left = Math.max(8, Math.min(menu.x - W, window.innerWidth - W - 8))
    const openUp = menu.y + 300 > window.innerHeight
    return (<>
      <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 60 }} />
      <div style={{ position: 'fixed', left, ...(openUp ? { bottom: window.innerHeight - menu.y + 34 } : { top: menu.y + 4 }), width: W, maxHeight: 360, overflowY: 'auto', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,.18)', zIndex: 61, padding: '4px 0' }}>
        {body}
      </div>
    </>)
  }

  return (
    <div ref={shellRef} style={{ display: isMobile ? 'block' : 'grid', gridTemplateColumns: '240px 1fr', gap: 0, height: chatH || 'calc(100dvh - 150px)', maxHeight: chatH || 'calc(100dvh - 150px)', minHeight: 380, border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden', background: 'var(--surface)' }}>
      <PersonHoverCard profiles={profiles} me={me} />
      {showList && (
        <div style={{ borderRight: isMobile ? 'none' : '1px solid var(--line)', display: 'flex', flexDirection: 'column', background: 'var(--canvas)', minHeight: 0, height: isMobile ? '100%' : 'auto' }}>
          <style>{SIDEBAR_CSS}</style>
          <ChatSearchBar channels={channels} profiles={profiles} dmNames={dmNames} prefs={prefs} onJump={jumpToSearchResult} />
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flex: 'none', gap: 6 }}>
            <b style={{ fontSize: 14 }}>Chat</b>
            <span style={{ display: 'inline-flex', gap: 4 }}>
              <button className="btn btn-ghost" title="New group" style={{ padding: '4px 9px', fontSize: 12 }}
                onClick={() => setNameModal({ title: 'New group', initial: '', withIcon: true, onSave: (n, ic) => createSection(n, null, ic) })}>＋ Group</button>
              {canCreateChannels && <button className="btn btn-ghost" style={{ padding: '4px 9px', fontSize: 12 }} onClick={() => setShowCreate(true)}>+ New</button>}
            </span>
          </div>
          <div style={{ overflowY: 'auto', flex: 1, padding: '2px 6px 10px', minHeight: 0 }}>

            {favList.length > 0 && (<>
              {renderHeader({ key: 'h-fav', label: 'Favorites', icon: '⭐', collapsed: builtinCollapsed.fav, onToggle: () => toggleBuiltin('fav') })}
              {renderTyped(whenCollapsed(favList, builtinCollapsed.fav))}
            </>)}

            {sections.map(sec => {
              const items = visible.filter(c => groupOf(c) === sec.id).sort(byPinThenActivity)
              return (
                <React.Fragment key={sec.id}>
                  {renderHeader({
                    key: 'h-' + sec.id, label: sec.name, icon: sec.icon || null, collapsed: sec.collapsed,
                    onToggle: () => updateSection(sec.id, { collapsed: !sec.collapsed }),
                    right: <button onClick={(e) => openMenu(e, 'section', sec.id)} title="Group options" aria-label="Group options"
                      className={'chat-side-more' + (menu?.id === sec.id ? ' is-open' : '')}>⋯</button>,
                  })}
                  {items.length === 0 && !sec.collapsed && (
                    <div className="page-sub" style={{ padding: '2px 12px 6px 36px', fontSize: 11.5 }}>Empty — use ⋯ → Move to group on any chat.</div>
                  )}
                  {renderTyped(whenCollapsed(items, sec.collapsed))}
                </React.Fragment>
              )
            })}

            {renderHeader({ key: 'h-ch', label: 'Channels', icon: '#', collapsed: builtinCollapsed.channels, onToggle: () => toggleBuiltin('channels') })}
            {channelList.length === 0 && !builtinCollapsed.channels && channels.filter(c => !c.is_dm).length === 0 && (
              <div className="page-sub" style={{ padding: 12, fontSize: 12.5 }}>No channels yet.{canCreateChannels ? ' Create one with + New.' : ' An admin needs to add you to a channel.'}</div>
            )}
            {whenCollapsed(channelList, builtinCollapsed.channels).map(c => renderRow(c))}

            {(dmList.length > 0 || canCreateDMs) && renderHeader({
              key: 'h-dm', label: 'Direct messages', icon: '💬', collapsed: builtinCollapsed.dms, onToggle: () => toggleBuiltin('dms'),
              right: canCreateDMs ? <button className="btn btn-ghost" style={{ padding: '2px 7px', fontSize: 11 }} onClick={() => setShowDM(true)}>+ DM</button> : null,
            })}
            {whenCollapsed(dmList, builtinCollapsed.dms).map(c => renderRow(c))}

            {hiddenList.length > 0 && (<>
              {renderHeader({ key: 'h-hidden', label: 'Hidden', icon: '🙈', count: hiddenList.length, collapsed: !showHidden, onToggle: () => setShowHidden(v => !v), unread: hiddenUnread })}
              {showHidden && (<>
                <div className="page-sub" style={{ padding: '0 12px 6px 36px', fontSize: 11.5 }}>Hidden channels stay here. Hidden DMs come back on a new message.</div>
                {hiddenList.map(c => renderRow(c, { dim: true }))}
              </>)}
            </>)}
          </div>
        </div>
      )}

      {showConvo && (
        activeId
          ? (activeId === LSA_CHANNEL_ID
              ? <LsaChannelView key={activeId} channelId={activeId} me={me} isAdmin={isAdmin} isOwner={isOwner} channel={channels.find(c => c.id === activeId)} dmName={dmNames[activeId]} profiles={profiles} isMobile={isMobile} onBack={() => setMobileView('list')} markRead={markRead}
                  targetMessageId={targetMessageId} onTargetConsumed={() => setTargetMessageId(null)} clearedAt={prefs[activeId]?.cleared_at || null} agentMuted={agentMutedFor(activeId)} />
              : activeId === TRADE_BOARD_CHANNEL_ID
              ? <SetterChannelView key={activeId} channelId={activeId} me={me} isAdmin={isAdmin} isOwner={isOwner} channel={channels.find(c => c.id === activeId)} dmName={dmNames[activeId]} profiles={profiles} isMobile={isMobile} onBack={() => setMobileView('list')} markRead={markRead}
                  targetMessageId={targetMessageId} onTargetConsumed={() => setTargetMessageId(null)} clearedAt={prefs[activeId]?.cleared_at || null} agentMuted={agentMutedFor(activeId)} />
              : <ChannelPane key={activeId} channelId={activeId} me={me} isAdmin={isAdmin} isOwner={isOwner} channel={channels.find(c => c.id === activeId)} dmName={dmNames[activeId]} profiles={profiles} isMobile={isMobile} onBack={() => setMobileView('list')} markRead={markRead}
                  targetMessageId={targetMessageId} onTargetConsumed={() => setTargetMessageId(null)} clearedAt={prefs[activeId]?.cleared_at || null} agentMuted={agentMutedFor(activeId)} />)
          : <div style={{ display: 'grid', placeItems: 'center', color: 'var(--ink-soft)', height: '100%' }}>Select a channel</div>
      )}

      {showCreate && <CreateChannelModal me={me} profiles={profiles}
        onClose={() => setShowCreate(false)}
        onCreated={(id) => { setShowCreate(false); load(); openChannel(id) }} />}
      {showDM && <CreateDMModal me={me} profiles={profiles}
        onClose={() => setShowDM(false)}
        onCreated={(id) => {
          setShowDM(false)
          // Starting a DM with someone whose conversation I'd hidden/removed brings it back.
          if (prefs[id]?.hidden_at) savePref(id, { hidden_at: null })
          load(); openChannel(id)
        }} />}
      {renderMenu()}
      {nameModal && <NameModal {...nameModal} onClose={() => setNameModal(null)} />}
    </div>
  )
}

// The GarageCo setter channel gets a Trade Board AND the normal chat, switched
// by a toggle. Both stay mounted (chat keeps receiving messages / marking read
// while the board is showing, and vice-versa) so nothing resets on switch.
function SetterChannelView(props) {
  const { isMobile, onBack, me } = props
  const [view, setView] = useState('board') // 'board' | 'chat'
  // A search result (or a notification deep-link) landing on a message in this
  // channel needs the Chat sub-view showing, or ChannelPane never mounts to
  // receive it.
  useEffect(() => { if (props.targetMessageId) setView('chat') }, [props.targetMessageId])
  const tab = (on) => ({ padding: '5px 14px', fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer', background: on ? 'var(--accent, #0d9488)' : 'var(--surface)', color: on ? '#fff' : 'var(--ink-soft)', fontFamily: 'inherit' })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0, minHeight: 0, background: 'var(--surface)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid var(--line)', flex: 'none' }}>
        {isMobile && <button className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={onBack}>‹</button>}
        <div style={{ display: 'flex', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
          <button onClick={() => setView('board')} style={tab(view === 'board')}>🔁 Trade Board</button>
          <button onClick={() => setView('chat')} style={{ ...tab(view === 'chat'), borderLeft: '1px solid var(--line)' }}>💬 Chat</button>
        </div>
        <span className="page-sub" style={{ fontSize: 12 }}># {props.channel?.name || 'GarageCo: Appointment Setters'}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Render only the active view so each mounts fresh — the chat then runs
            its own scroll-to-newest on open instead of loading while hidden. */}
        {view === 'board'
          ? <TradeBoardChannel me={me} isMobile={false} />
          : <ChannelPane {...props} isMobile={false} />}
      </div>
    </div>
  )
}

// The #GarageCo LSA Chat Team channel gets an LSA lead tracker AND the normal
// chat, switched by a toggle (mirrors SetterChannelView). Booking celebrations
// posted by the DB trigger land in the Chat view.
function LsaChannelView(props) {
  const { isMobile, onBack, me } = props
  const [view, setView] = useState('board') // 'board' (tracker) | 'chat'
  // Same reasoning as SetterChannelView above.
  useEffect(() => { if (props.targetMessageId) setView('chat') }, [props.targetMessageId])
  const tab = (on) => ({ padding: '5px 14px', fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer', background: on ? 'var(--accent, #0d9488)' : 'var(--surface)', color: on ? '#fff' : 'var(--ink-soft)', fontFamily: 'inherit' })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0, minHeight: 0, background: 'var(--surface)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid var(--line)', flex: 'none' }}>
        {isMobile && <button className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={onBack}>‹</button>}
        <div style={{ display: 'flex', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
          <button onClick={() => setView('board')} style={tab(view === 'board')}>📋 LSA Tracker</button>
          <button onClick={() => setView('chat')} style={{ ...tab(view === 'chat'), borderLeft: '1px solid var(--line)' }}>💬 Chat</button>
        </div>
        <span className="page-sub" style={{ fontSize: 12 }}># {props.channel?.name || 'GarageCo LSA Chat Team'}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {view === 'board'
          ? <LsaTracker me={me} />
          : <ChannelPane {...props} isMobile={false} />}
      </div>
    </div>
  )
}

function ChannelPane({ channelId, me, isAdmin, isOwner, channel, dmName, profiles, isMobile, onBack, markRead, targetMessageId, onTargetConsumed, clearedAt = null, agentMuted = null }) {
  // Agent side: names of staff in this DM who have turned off messages from agents.
  const [dmBlockedBy, setDmBlockedBy] = useState([])
  const refreshDmBlock = useCallback(async () => {
    if (!channel?.is_dm || !isAgentProfile(me)) { setDmBlockedBy([]); return }
    const { data } = await supabase.rpc('dm_agent_block_status', { p_channel: channelId })
    setDmBlockedBy(Array.isArray(data) ? data : [])
  }, [channelId, channel?.is_dm, me])
  useEffect(() => { refreshDmBlock() }, [refreshDmBlock])
  // A DM I "deleted" only shows messages after the point I cleared it.
  const afterCleared = (q) => clearedAt ? q.gt('created_at', clearedAt) : q
  const { appRole } = useAuth()
  // Who can post an @update (require-read) message: admins + non-agent staff (the moderator tier).
  const canPostUpdate = isAdmin || String(appRole || 'agent').trim().toLowerCase() !== 'agent'
  const [messages, setMessages] = useState([])
  const [senders, setSenders] = useState({})
  const [acks, setAcks] = useState([])           // all acknowledgments for messages in view
  const [members, setMembers] = useState([])      // channel member profile_ids
  const [requireAck, setRequireAck] = useState(false)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [trackFor, setTrackFor] = useState(null)  // message id to show tracking panel
  const [threadFor, setThreadFor] = useState(null) // parent message id for the thread panel
  const [reactions, setReactions] = useState([])   // all reactions for messages in view
  const [attachments, setAttachments] = useState([]) // attachments for messages in view
  const [lightbox, setLightbox] = useState({ images: [], index: null })
  const [pending, setPending] = useState([])         // files staged to send
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef(null)
  const [showPicker, setShowPicker] = useState(false)      // input emoji picker
  const [reactFor, setReactFor] = useState(null)   // message id whose react-picker is open
  const [showMembers, setShowMembers] = useState(false)
  const [showPrefs, setShowPrefs] = useState(false)        // notification settings panel
  const [readState, setReadState] = useState({})    // profile_id -> last_read_at iso
  const [threadReads, setThreadReads] = useState({}) // parent message id -> my last_read_at iso
  const [highlightId, setHighlightId] = useState(null) // deep-linked message to flash
  const [readersFor, setReadersFor] = useState(null) // message id whose reader list is open
  const [reactorsFor, setReactorsFor] = useState(null) // {messageId, emoji} whose reactor list is open
  const [pinned, setPinned] = useState([])         // pinned messages in this channel (newest pin first)
  const [showPinned, setShowPinned] = useState(false) // is the pinned drawer expanded
  const [taskFromMsg, setTaskFromMsg] = useState(null) // message being turned into a project task, or null
  const [expandedPins, setExpandedPins] = useState(() => new Set()) // pin ids shown in full
  const [scheduled, setScheduled] = useState([])   // my pending scheduled messages in this channel
  const [schedOpen, setSchedOpen] = useState(false) // schedule picker open
  const [schedAt, setSchedAt] = useState('')        // datetime-local value
  const composerRef = useRef(null)
  // Composer draft persistence (per user + channel). Survives switching
  // channels, navigating elsewhere in Command Center, and even a refresh or
  // accidental tab close — so a half-typed message is never lost. Cleared on
  // a successful send or schedule.
  const draftKey = `cc:chatDraft:${me.id}:${channelId}`
  const htmlRef = useRef((() => {
    try { return localStorage.getItem(draftKey) || '' } catch { return '' }
  })())
  const saveDraft = (html) => {
    try {
      if (html && htmlToText(html).trim()) localStorage.setItem(draftKey, html)
      else localStorage.removeItem(draftKey)
    } catch {}
  }
  const clearDraft = () => { try { localStorage.removeItem(draftKey) } catch {} }

  // ---- scroll management ----
  const scrollerRef = useRef(null)
  const bottomRef = useRef(null)
  const didInitialScroll = useRef(false)
  const stickToBottom = useRef(true)

  // Keep the realtime subscription stable — reading senders via a ref instead of
  // a dep means we don't tear down and rebuild the channel on every new sender.
  const sendersRef = useRef(senders)
  useEffect(() => { sendersRef.current = senders }, [senders])

  const { typerNames, notifyTyping, stopTyping } = useTyping(`typing:${channelId}`, me.id, me.full_name,
    channel?.is_dm ? { channelId, recipients: (members || []).filter(id => id !== me.id) } : null)

  useEffect(() => {
    let active = true
    ;(async () => {
      setLoading(true); setErr('')
      try {
        const [msgRes, memRes] = await Promise.all([
          afterCleared(supabase.from('messages').select('*').eq('channel_id', channelId).is('deleted_at', null)).order('created_at', { ascending: false }).limit(200),
          supabase.from('channel_members').select('profile_id').eq('channel_id', channelId),
        ])
        if (msgRes.error) throw msgRes.error
        if (!active) return
        const msgs = (msgRes.data || []).slice().reverse()
        setMessages(msgs)
        setMembers((memRes.data || []).map(m => m.profile_id))
        await hydrateSenders(msgs)
        await loadAcks(msgs)
        await loadReactions(msgs)
        await loadAttachments(msgs)
        await loadReadState()
        await loadThreadReads()
        await loadPinned()
        await loadScheduled()
      } catch (e) { if (active) setErr(e.message) } finally { if (active) setLoading(false) }
    })()
    return () => { active = false }
  }, [channelId])

  // ---- SAFETY NET ----
  // Realtime websockets drop: laptops sleep, wifi switches, tabs background.
  // Reconcile against the database every 15 seconds so the worst case is a
  // short delay rather than a message nobody ever sees. If realtime is working
  // this finds nothing new and costs one cheap query.
  useEffect(() => {
    const t = setInterval(async () => {
      const { data } = await afterCleared(supabase.from('messages')
        .select('*').eq('channel_id', channelId).is('deleted_at', null))
        .order('created_at', { ascending: false }).limit(200)
      if (!data) return
      const fresh = data.slice().reverse()
      setMessages(prev => {
        const ids = new Set(prev.map(m => m.id))
        const added = fresh.filter(m => !ids.has(m.id))
        if (!added.length) return prev
        hydrateSenders(added)
        return [...prev, ...added]
      })
    }, 15000)
    return () => clearInterval(t)
  }, [channelId])

  async function loadReadState() {
    const { data } = await supabase.from('channel_read_state')
      .select('profile_id, last_read_at').eq('channel_id', channelId)
    const map = {}
    ;(data || []).forEach(r => { map[r.profile_id] = r.last_read_at })
    setReadState(map)
  }

  async function loadThreadReads() {
    const { data } = await supabase.from('thread_read_state')
      .select('parent_id, last_read_at')
      .eq('profile_id', me.id).eq('channel_id', channelId)
    const map = {}
    ;(data || []).forEach(r => { map[r.parent_id] = r.last_read_at })
    setThreadReads(map)
  }

  // Record that I've seen everything currently in a thread. Called when the
  // thread panel opens and again as replies arrive while it's open, so the
  // "N new" badge clears the moment you actually look.
  const markThreadRead = useCallback(async (parentId) => {
    if (!parentId) return
    const nowIso = new Date().toISOString()
    setThreadReads(prev => ({ ...prev, [parentId]: nowIso }))
    const { error } = await supabase.from('thread_read_state')
      .upsert({ profile_id: me.id, parent_id: parentId, channel_id: channelId, last_read_at: nowIso },
        { onConflict: 'profile_id,parent_id' })
    if (error) console.error('markThreadRead upsert failed:', error.message, error)
  }, [channelId, me.id])

  // Tell the server we've seen everything up to the newest message. The RPC
  // uses greatest(), so a slow request landing after a newer one can't move
  // our read pointer backwards.
  const markChannelRead = useCallback(async (upTo) => {
    if (!upTo) return
    await supabase.rpc('mark_channel_read', { p_channel_id: channelId, p_at: upTo })
    setReadState(prev => {
      const cur = prev[me.id]
      if (cur && new Date(cur) >= new Date(upTo)) return prev
      return { ...prev, [me.id]: upTo }
    })
  }, [channelId, me.id])

  // Whenever the newest message changes and we're looking at the bottom of the
  // channel, mark it read. Guarding on stickToBottom means scrolling up through
  // history doesn't mark things read that you haven't actually reached.
  useEffect(() => {
    if (loading || !messages.length) return
    if (!stickToBottom.current) return
    const newest = messages.reduce((a, b) =>
      new Date(b.created_at) > new Date(a.created_at) ? b : a)
    if (newest._optimistic) return
    markChannelRead(newest.created_at)
  }, [messages, loading, markChannelRead])

  // ---- Deep-linked message (clicked from a notification) ----
  // If it's a thread reply, open the thread on its parent and flash the reply.
  // If it's a top-level message, scroll to it and flash it.
  useEffect(() => {
    if (loading || !targetMessageId) return
    let cancelled = false
    ;(async () => {
      let msg = messages.find(x => x.id === targetMessageId)
      if (!msg) {
        // Older than the 200-message window — fetch it directly.
        const { data } = await supabase.from('messages').select('*').eq('id', targetMessageId).single()
        msg = data || null
      }
      if (msg && clearedAt && new Date(msg.created_at) <= new Date(clearedAt)) msg = null
      if (cancelled) return
      if (msg?.parent_id) {
        setThreadFor(msg.parent_id)
        setHighlightId(msg.id)
        // Also bring the parent into view behind the panel if it's loaded.
        setTimeout(() => {
          document.getElementById('chat-msg-' + msg.parent_id)?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
        }, 120)
      } else if (msg) {
        setHighlightId(msg.id)
        stickToBottom.current = false
        setTimeout(() => {
          document.getElementById('chat-msg-' + msg.id)?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
        }, 120)
      }
      setTimeout(() => { if (!cancelled) setHighlightId(null) }, 5000)
      onTargetConsumed?.()
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, targetMessageId])

  async function hydrateSenders(msgs) {
    const ids = [...new Set(msgs.map(m => m.sender_id).filter(Boolean))]
    const missing = ids.filter(id => !(id in sendersRef.current))
    if (!missing.length) return
    const { data } = await supabase.from('profiles').select('id, full_name, avatar_url').in('id', missing); registerPhotos(data)
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

  // Pinned messages are loaded separately from the 200-message window so a pin
  // stays visible even after it scrolls far up the history.
  async function loadPinned() {
    const { data } = await afterCleared(supabase.from('messages')
      .select('*').eq('channel_id', channelId)
      .not('pinned_at', 'is', null).is('deleted_at', null))
      .order('pinned_at', { ascending: false })
    const list = data || []
    setPinned(list)
    hydrateSenders(list)
  }

  // Pin / unpin a top-level message. Gated in the UI to moderators; the DB's
  // "delete own or moderate" UPDATE policy is the real gate.
  async function togglePin(m) {
    const willPin = !m.pinned_at
    const patch = willPin
      ? { pinned_at: new Date().toISOString(), pinned_by: me.id }
      : { pinned_at: null, pinned_by: null }
    // optimistic — update both the stream row and the pinned drawer
    setMessages(prev => prev.map(x => x.id === m.id ? { ...x, ...patch } : x))
    setPinned(prev => {
      const others = prev.filter(x => x.id !== m.id)
      if (!willPin) return others
      return [{ ...m, ...patch }, ...others].sort((a, b) => new Date(b.pinned_at) - new Date(a.pinned_at))
    })
    const { error } = await supabase.from('messages').update(patch).eq('id', m.id)
    if (error) { setErr('Could not update pin: ' + error.message); loadPinned() }
  }

  // Show/hide a pinned message's full body inline in the drawer. No scrolling —
  // the message stays at the top and just displays when clicked (links inside it
  // work normally). This replaces the old "jump to message" behaviour, which
  // broke whenever the pinned message was outside the loaded message window.
  function togglePinExpand(id) {
    setExpandedPins(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  // ---- Scheduled messages ----
  // Compose now, deliver later. A per-minute DB job posts due ones as you and
  // notifies the channel. Attachments aren't scheduled — text only.
  async function loadScheduled() {
    const { data } = await supabase.from('scheduled_messages')
      .select('*').eq('channel_id', channelId).eq('sender_id', me.id)
      .is('sent_at', null).is('canceled_at', null).order('send_at')
    setScheduled(data || [])
  }
  async function scheduleMessage() {
    const rawHtml = htmlRef.current || ''
    const plain = htmlToText(rawHtml)
    const body = sanitizeHtml(rawHtml)
    if (!plain) { setErr('Write a message before scheduling it.'); return }
    if (!schedAt) return
    const when = new Date(schedAt)
    if (isNaN(when.getTime()) || when.getTime() < Date.now() + 30000) { setErr('Pick a time at least a minute in the future.'); return }
    const { error } = await supabase.from('scheduled_messages')
      .insert({ channel_id: channelId, sender_id: me.id, body, send_at: when.toISOString() })
    if (error) { setErr('Could not schedule: ' + error.message); return }
    composerRef.current?.clear(); htmlRef.current = ''; clearDraft()
    setSchedOpen(false); setSchedAt(''); setErr('')
    loadScheduled()
  }
  async function cancelScheduled(id) {
    setScheduled(prev => prev.filter(s => s.id !== id))
    await supabase.from('scheduled_messages').update({ canceled_at: new Date().toISOString() }).eq('id', id)
  }
  // A sensible default when opening the picker: tomorrow 8:00 AM local.
  function defaultSchedAt() {
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0)
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  function addFiles(fileList) {
    const arr = Array.from(fileList || [])
    const tooBig = arr.find(f => f.size > MAX_FILE_BYTES)
    if (tooBig) { setErr(`"${tooBig.name}" is over 50MB.`); return }
    setPending(prev => [...prev, ...arr.map(f => ({ file: f, name: f.name, type: f.type }))])
  }

  function removePending(idx) { setPending(prev => prev.filter((_, i) => i !== idx)) }

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

  // realtime: new messages + acknowledgments + reactions + attachments
  //
  // NOTE: no server-side `filter:` on any of these. The filtered form delivered
  // nothing while the unfiltered `unread-watch` subscription received the same
  // rows. We filter in the handler instead. RLS still applies, so we only ever
  // receive rows we're allowed to see.
  useEffect(() => {
    const ch = supabase
      .channel(`chan:${channelId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' },
        async (payload) => {
          const m = payload.new
          if (m.channel_id !== channelId) return
          setMessages(prev => prev.some(x => x.id === m.id) ? prev : [...prev, m])
          // I'm looking at this channel, so keep it marked read
          if (m.sender_id !== me.id) markRead?.(channelId)
          if (m.sender_id && !(m.sender_id in sendersRef.current)) {
            const { data } = await supabase.from('profiles').select('id, full_name, avatar_url').eq('id', m.sender_id).single(); registerPhotos(data ? [data] : [])
            if (data) setSenders(prev => ({ ...prev, [data.id]: data.full_name }))
          }
        })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_acknowledgments' },
        (payload) => { setAcks(prev => prev.some(a => a.id === payload.new.id) ? prev : [...prev, payload.new]) })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_reactions' },
        (payload) => { setReactions(prev => prev.some(r => r.id === payload.new.id) ? prev : [...prev, payload.new]) })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'message_reactions' },
        (payload) => { setReactions(prev => prev.filter(r => r.id !== payload.old.id)) })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_attachments' },
        (payload) => {
          if (payload.new.channel_id !== channelId) return
          setAttachments(prev => prev.some(a => a.id === payload.new.id) ? prev : [...prev, payload.new])
        })
      // A soft-delete arrives as an UPDATE with deleted_at set. Drop it from view.
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' },
        (payload) => {
          const m = payload.new
          if (m.channel_id !== channelId) return
          if (m.deleted_at) {
            setMessages(prev => prev.filter(x => x.id !== m.id))
            setPinned(prev => prev.filter(x => x.id !== m.id))
          } else {
            setMessages(prev => prev.map(x => x.id === m.id ? m : x))
            // Keep the pinned drawer in sync when someone else pins/unpins.
            setPinned(prev => {
              const others = prev.filter(x => x.id !== m.id)
              if (!m.pinned_at) return others
              hydrateSenders([m])
              return [m, ...others].sort((a, b) => new Date(b.pinned_at) - new Date(a.pinned_at))
            })
          }
        })
      // Someone else read the channel — update their receipt live.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'channel_read_state' },
        (payload) => {
          const r = payload.new
          if (!r?.profile_id || r.channel_id !== channelId) return
          setReadState(prev => ({ ...prev, [r.profile_id]: r.last_read_at }))
        })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [channelId, me.id, markRead])

  // Soft-delete. The row stays; deleted_at hides it. Moderators keep the
  // evidence of whatever got someone moderated.
  async function deleteMessage(m) {
    const isMine = m.sender_id === me.id
    const who = isMine ? 'your message' : `${senders[m.sender_id] || 'this person'}'s message`
    if (!window.confirm(`Delete ${who}? It disappears for everyone. This can't be undone from the app.`)) return

    let reason = null
    if (!isMine) {
      reason = window.prompt('Reason for removing this message? (optional, saved to the audit trail)')
      if (reason === null) return   // cancelled
    }

    const prev = messages
    setMessages(cur => cur.filter(x => x.id !== m.id))   // optimistic
    const { error } = await supabase.from('messages').update({
      deleted_at: new Date().toISOString(),
      deleted_by: me.id,
      deleted_reason: reason || null,
    }).eq('id', m.id)
    if (error) { setMessages(prev); setErr('Could not delete: ' + error.message) }
  }

  // ---- EDIT (author only; normal messages only, not @update) ----
  const [editing, setEditing] = useState(null)   // { id, html } or null
  const [editSaving, setEditSaving] = useState(false)
  function openEdit(m) {
    if (m.sender_id !== me.id || m.requires_ack) return
    setEditing({ id: m.id, html: m.body || '' })
  }
  async function saveEdit(rawHtml) {
    if (!editing) return
    const body = sanitizeHtml(rawHtml)
    const plain = htmlToText(rawHtml)
    if (!plain) { setErr("A message can't be empty. Delete it instead."); return }
    const id = editing.id
    const now = new Date().toISOString()
    const prev = messages
    setMessages(cur => cur.map(x => x.id === id ? { ...x, body, edited_at: now } : x))  // optimistic
    setEditSaving(true); setErr('')
    const { error } = await supabase.from('messages')
      .update({ body, edited_at: now }).eq('id', id).eq('sender_id', me.id)
    setEditSaving(false)
    if (error) { setMessages(prev); setErr('Could not save edit: ' + error.message); return }
    setEditing(null)
  }

  // ---- SCROLL ----
  //
  // Goal: land on the newest message when a channel opens, follow new messages
  // while the user is at the bottom, and never yank them down mid-read.
  //
  // The tricky part is the initial jump. When `loading` is true this component
  // returns only a spinner, so the scroller doesn't exist yet. Once it flips
  // false the list mounts, but its final height isn't known for several frames:
  // message bodies are injected via dangerouslySetInnerHTML, avatars are grid
  // items, and attachments haven't loaded. Reading scrollHeight too early gives
  // a value far smaller than the real one — you scroll to that number and land
  // near the top. So we pin repeatedly across a few frames until the height
  // stops growing.

  // True while WE are moving the scroller. Without this, our own programmatic
  // scroll fires onScroll, which can flip stickToBottom off mid-jump.
  const programmatic = useRef(false)

  function pinToBottom() {
    const el = scrollerRef.current
    if (!el) return
    programmatic.current = true
    el.scrollTop = el.scrollHeight
    // release on the next frame, after the scroll event has fired
    requestAnimationFrame(() => { programmatic.current = false })
  }

  // Pin now, then again on the next few frames, stopping early once the
  // scroll height has settled. Cheap: at most `tries` frames.
  function pinToBottomSettled(tries = 8) {
    let last = -1
    let n = 0
    const step = () => {
      const el = scrollerRef.current
      if (!el) return
      programmatic.current = true
      el.scrollTop = el.scrollHeight
      const h = el.scrollHeight
      n++
      if (h !== last && n < tries) {
        last = h
        requestAnimationFrame(step)
      } else {
        requestAnimationFrame(() => { programmatic.current = false })
      }
    }
    requestAnimationFrame(step)
  }

  // Track whether the user is parked at the bottom. Ignore scroll events we
  // caused ourselves.
  function onScroll() {
    if (programmatic.current) return
    const el = scrollerRef.current
    if (!el) return
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  // Channel opened (or finished loading): jump to the newest message, no
  // animation. `key={activeId}` remounts this component per channel, so
  // didInitialScroll resets naturally.
  useLayoutEffect(() => {
    if (loading || didInitialScroll.current) return
    if (!scrollerRef.current) return
    didInitialScroll.current = true
    stickToBottom.current = true
    pinToBottom()          // synchronous first pass, before paint
    pinToBottomSettled()   // then chase the settling height
  }, [loading])

  // New message: follow only if the user was already at the bottom.
  // Scroll the message list itself rather than calling scrollIntoView on the
  // sentinel. scrollIntoView walks up and scrolls EVERY scrollable ancestor,
  // horizontally included — that is what dragged the conversation list out of
  // view whenever a message was sent. Setting scrollTop can only ever move
  // this one element, on one axis.
  useEffect(() => {
    if (!didInitialScroll.current || !stickToBottom.current) return
    const el = scrollerRef.current
    if (!el) return
    programmatic.current = true
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    requestAnimationFrame(() => { programmatic.current = false })
  }, [messages.length])

  // Attachments arrive after the message and change list height. Re-pin.
  useEffect(() => {
    if (!didInitialScroll.current || !stickToBottom.current) return
    pinToBottom()
  }, [attachments.length])

  // Called by <img onLoad> — media loads after paint and shifts everything.
  const onMediaLoad = useCallback(() => {
    if (stickToBottom.current) pinToBottom()
  }, [])

  // Opening the read-by panel grows the last row. If we were parked at the
  // bottom, follow it down — otherwise the panel expands below the fold and
  // there is nothing to scroll to.
  useEffect(() => {
    if (!readersFor || !stickToBottom.current) return
    pinToBottomSettled(4)
  }, [readersFor])

  async function send() {
    const rawHtml = htmlRef.current || ''
    // htmlToText walks the parsed DOM. The old regex stripped tags with
    // /<[^>]+>/ , which mangles any attribute value containing '>'. Now that
    // links and tables carry attributes, that matters.
    const plain = htmlToText(rawHtml)
    const body = sanitizeHtml(rawHtml)
    if (!plain && pending.length === 0) return

    const isHere = /(^|\s)@here(\s|$)/i.test(plain)
    const willRequireAck = canPostUpdate && requireAck
    const filesToSend = pending

    // Compute mentions once — used for both membership and notification routing.
    const mentionedIds = extractMentions(plain, profiles).filter(id => id !== me.id)

    composerRef.current?.clear(); htmlRef.current = ''; clearDraft()
    setRequireAck(false); setPending([])
    stopTyping()
    stickToBottom.current = true    // sending always scrolls you down
    if (filesToSend.length) setUploading(true)

    const temp = { id: 'temp-' + Date.now(), channel_id: channelId, sender_id: me.id, body: body || '', created_at: new Date().toISOString(), requires_ack: willRequireAck, is_here: isHere, _optimistic: true }
    setMessages(prev => [...prev, temp])

    const { data, error } = await supabase.from('messages')
      .insert({ channel_id: channelId, sender_id: me.id, body: body || '', requires_ack: willRequireAck, is_here: isHere })
      .select().single()

    if (error) {
      setErr(error.message)
      setMessages(prev => prev.filter(m => m.id !== temp.id)); setPending(filesToSend); setUploading(false)
      if (/can't accept direct messages|turned off direct messages/i.test(error.message || '')) refreshDmBlock()
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

    // Notifications for this message were already created by the database when
    // it was saved (trg_notify_on_chat_message). Here we only add any @mentioned
    // non-members to the channel so they can open it.
    try {
      await addMentionedMembers(mentionedIds)
    } catch (memberError) {
      console.error('Message sent, but adding mentioned people failed', memberError)
      setErr(`Message sent, but couldn't add mentioned people to the channel: ${memberError.message || 'Unknown error'}`)
    }
  }

  // Mentioning a non-member adds them to the channel and tells them so.
  async function addMentionedMembers(mentionedIds) {
    if (!mentionedIds.length || channel?.is_dm) return
    const addedIds = mentionedIds.filter(id => !members.includes(id))
    if (!addedIds.length) return
    const { error: memberError } = await supabase.from('channel_members')
      .insert(addedIds.map(pid => ({ channel_id: channelId, profile_id: pid })))
    if (memberError) throw memberError

    setMembers(prev => [...new Set([...prev, ...addedIds])])
    await notifyChannelAdded({
      recipientIds: addedIds, actorId: me.id, actorName: me.full_name,
      channelName: channel?.name, isDm: false,
    })
  }

  // ---- Video call: mint a Meet link (via the caller's Google account,
  // Jitsi fallback), drop it in the conversation, ring the members. ----
  const [callBusy, setCallBusy] = useState(false)
  async function startVideoCall() {
    if (callBusy) return
    setCallBusy(true)
    try {
      // Pass the channel roster (names) so the notetaker can attribute + gate
      // visibility even when nobody's calendar carries this ad-hoc call.
      const nameById = Object.fromEntries((profiles || []).map(p => [p.id, p.full_name]))
      const participantNames = [...new Set([me.full_name, ...members.map(id => nameById[id])])].filter(Boolean)
      const { data, error } = await supabase.functions.invoke('create-video-call', {
        body: {
          title: channel?.is_dm ? `📹 Call · ${dmName || 'Direct message'}` : `📹 Call · #${channel?.name}`,
          participants: participantNames,
        },
      })
      if (error || !data?.url) throw new Error(error?.message || data?.error || 'Could not create the call link.')

      const label = channel?.is_dm ? (dmName || 'this conversation') : `#${channel?.name}`
      const body = `📹 <b>${me.full_name || 'Someone'} started a video call</b> — <a href="${data.url}" target="_blank" rel="noopener noreferrer">Join the call</a>` +
        (data.captured ? ' · 🔴 <i>the notetaker is recording this call</i>' : '') +
        (data.provider === 'jitsi' ? ' <i>(first person in may need to sign in to start the room)</i>' : '')
      const { data: msg, error: mErr } = await supabase.from('messages')
        .insert({ channel_id: channelId, sender_id: me.id, body }).select().single()
      if (mErr) throw mErr
      setMessages(prev => prev.some(x => x.id === msg.id) ? prev : [...prev, msg])

      try {
        await notifyIncomingCall({
          recipientIds: members.filter(id => id !== me.id),
          actorId: me.id, actorName: me.full_name,
          channelId, isDm: channel?.is_dm,
        })
      } catch (e) { console.error('Call started, ringing failed', e) }

      window.open(data.url, '_blank', 'noopener')
    } catch (e) { setErr(e.message) } finally { setCallBusy(false) }
  }

  async function confirmRead(messageId) {
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

  const topLevel = messages.filter(x => !x.parent_id)

  // Mirrors can_moderate_messages() in the DB, which checks profiles.is_admin.
  // The DB is the real gate — this only decides whether to draw the button.
  // Do NOT add isOwner here: `level` is not a column on profiles, so the DB
  // would reject a delete that this let the user attempt.
  // Delete rule: the author, or anyone whose role isn't 'agent'
  // (asc / support / certification / marketing / admin can moderate).
  const canModerate = String(appRole || 'agent').trim().toLowerCase() !== 'agent'

  // Read receipts render on the newest message only; a line under every one is noise.
  const newestId = topLevel.length
    ? topLevel.reduce((a, b) => new Date(b.created_at) > new Date(a.created_at) ? b : a).id
    : null

  return (
    // minWidth/minHeight 0: this sits in the shell's `1fr` grid track, whose
    // min-width defaults to AUTO. A wide message (a posted report table) would
    // otherwise stretch the track past the shell, and the shell's overflow:hidden
    // can still be scrolled programmatically — which is what pushed the
    // conversation list off-screen when a message was sent.
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0, minHeight: 0, position: 'relative' }}>
      <div style={{ padding: isMobile ? '10px 12px' : '14px 18px', borderBottom: '1px solid var(--line)', flex: 'none', display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 10, flexWrap: 'nowrap' }}>
        {isMobile && (
          <button onClick={onBack} title="Back to channels"
            style={{ border: 0, background: 'transparent', cursor: 'pointer', fontSize: 22, lineHeight: 1, color: 'var(--accent)', padding: '0 2px 0 0', fontFamily: 'inherit', flex: 'none' }}>‹</button>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <b style={{ fontSize: 15, display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{channel?.is_dm ? (dmName || 'Direct message') : `# ${channel?.name}`}</b>
          {channel?.description && !channel?.is_dm && <div className="page-sub" style={{ fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{channel.description}</div>}
          {channel?.is_dm && <div className="page-sub" style={{ fontSize: 12 }}>{(dmName || '').includes(',') ? `Group message · ${(dmName || '').split(',').length + 1} people` : 'Direct message'}</div>}
        </div>
        {(String(me?.role || '').toLowerCase() !== 'agent' || me?.is_admin) && (
          <button className="btn btn-ghost" style={{ fontSize: 12, padding: isMobile ? '6px 9px' : '5px 10px', flex: 'none' }}
            onClick={startVideoCall} disabled={callBusy} title="Start a video call">{callBusy ? '…' : (isMobile ? '📹' : '📹 Call')}</button>
        )}
        <button className="btn btn-ghost" style={{ fontSize: 12, padding: isMobile ? '6px 9px' : '5px 10px', flex: 'none' }}
          onClick={() => setShowPrefs(true)} title="Notification settings">🔔</button>
        {!channel?.is_dm && (
          <button className="btn btn-ghost" style={{ fontSize: 12, padding: isMobile ? '6px 9px' : '5px 10px', flex: 'none' }} onClick={() => setShowMembers(true)} title="Members">{isMobile ? '👥' : '👥 Members'}</button>
        )}
      </div>

      {pinned.length > 0 && (
        <div style={{ flex: 'none', borderBottom: '1px solid var(--line)', background: 'var(--canvas)' }}>
          <button onClick={() => setShowPinned(s => !s)}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 18px', border: 0, background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--ink)', textAlign: 'left' }}>
            <span style={{ fontSize: 13 }}>📌</span>
            <b style={{ fontSize: 12.5 }}>{pinned.length} pinned {pinned.length === 1 ? 'message' : 'messages'}</b>
            <span style={{ marginLeft: 'auto', fontSize: 11, opacity: .7, transition: 'transform .15s ease', transform: showPinned ? 'rotate(90deg)' : 'rotate(0deg)' }}>▸</span>
          </button>
          {showPinned && (
            <div style={{ maxHeight: 320, overflowY: 'auto', padding: '2px 12px 10px' }}>
              {pinned.map(p => {
                const pName = p.sender_id === me.id ? 'You' : (senders[p.sender_id] || 'Someone')
                const isOpen = expandedPins.has(p.id)
                return (
                  <div key={p.id} style={{ padding: '8px 6px', borderTop: '1px solid var(--line)' }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => togglePinExpand(p.id)}
                        title={isOpen ? 'Hide message' : 'Show message'}>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', marginBottom: 2 }}>
                          <span style={{ fontSize: 10, color: 'var(--ink-soft)', transition: 'transform .15s ease', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block' }}>▸</span>
                          <b style={{ fontSize: 12 }}>{pName}</b>
                          <span style={{ fontSize: 10.5, color: 'var(--ink-soft)' }}>{timeLabel(p.created_at)}</span>
                        </div>
                        {!isOpen && (
                          <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', paddingLeft: 16 }}>
                            {htmlToText(p.body) || '(no text)'}
                          </div>
                        )}
                      </div>
                      {canModerate && (
                        <button onClick={() => togglePin(p)} title="Unpin"
                          className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 7px', flex: 'none', color: 'var(--ink-soft)' }}>Unpin</button>
                      )}
                    </div>
                    {isOpen && (
                      <div style={{ fontSize: 13, marginTop: 4, paddingLeft: 16 }}>
                        <RichContent html={p.body} highlightMentions />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      <div ref={scrollerRef} onScroll={onScroll}
        style={{ flex: 1, overflowY: 'auto', padding: '16px 18px 28px', minHeight: 0 }}>
        {err && <div style={{ color: 'var(--failed)', fontSize: 13, marginBottom: 10 }}>{err}</div>}
        {topLevel.length === 0
          ? <div className="page-sub" style={{ textAlign: 'center', padding: 30 }}>No messages yet. Say hello 👋</div>
          : topLevel.map((m, i) => {
            const replyCount = messages.filter(x => x.parent_id === m.id).length
            // Replies from others newer than the last time I opened this thread.
            const threadLastRead = threadReads[m.id]
            const unseenReplies = replyCount === 0 ? 0 : messages.filter(x =>
              x.parent_id === m.id && x.sender_id !== me.id &&
              (!threadLastRead || new Date(x.created_at) > new Date(threadLastRead))
            ).length
            const prev = topLevel[i - 1]
            const grouped = prev && prev.sender_id === m.sender_id && !m.requires_ack && !prev.requires_ack && (new Date(m.created_at) - new Date(prev.created_at) < 5 * 60000)
            const name = m.sender_id === me.id ? 'You' : (senders[m.sender_id] || 'Someone')
            const authorP = profiles.find(p => p.id === m.sender_id)
            const authorStatus = effStatus(authorP)
            const canDelete = !m._optimistic && (m.sender_id === me.id || canModerate)
            const canEdit = !m._optimistic && m.sender_id === me.id && !m.requires_ack
            const canPin = !m._optimistic && canModerate
            const readerIds = m._optimistic ? [] : readersOf(m, readState, members, me.id)
            const readerNames = readerIds.map(pid => senders[pid] || profiles.find(p => p.id === pid)?.full_name).filter(Boolean)
            const isNewest = m.id === newestId
            const isHighlighted = highlightId === m.id

            return (
              <div key={m.id} id={'chat-msg-' + m.id} className="chat-msg-row"
                style={{ display: 'flex', gap: 10, marginTop: grouped ? 2 : 12, opacity: m._optimistic ? 0.6 : 1, position: 'relative',
                  background: isHighlighted ? 'var(--accent-bg)' : 'transparent',
                  outline: isHighlighted ? '2px solid var(--accent)' : 'none',
                  borderRadius: isHighlighted ? 10 : 0, padding: isHighlighted ? '6px 8px' : 0,
                  transition: 'background .6s ease, outline-color .6s ease' }}>
                <div style={{ width: 32, flex: 'none' }}>
                  {!grouped && <div style={{ position: 'relative', width: 32, height: 32 }}>
                    <Av name={name} size={32} fontSize={12} />
                    {authorP && <span style={{ position: 'absolute', right: -1, bottom: -1 }}><PresenceDot profile={authorP} size={10} /></span>}
                  </div>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {!grouped && <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
                    <b style={{ fontSize: 13.5 }}>{name}</b>
                    {authorStatus && (authorStatus.emoji || authorStatus.text) && <span title={authorStatus.text || ''} style={{ fontSize: 12, color: 'var(--ink-soft)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>{authorStatus.emoji && <span>{authorStatus.emoji}</span>}{authorStatus.type === 'ooo' && <span style={{ fontWeight: 700, color: '#7c3aed' }}>OOO</span>}</span>}
                    <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{timeLabel(m.created_at)}</span>
                    {m.edited_at && <span style={{ fontSize: 10.5, color: 'var(--ink-soft)', fontStyle: 'italic' }}>(edited)</span>}
                    {m.is_here && <span className="badge" style={{ background: 'var(--accent-bg)', color: 'var(--accent)', fontSize: 10 }}>@here</span>}
                    {m.pinned_at && <span title="Pinned" style={{ fontSize: 10.5, color: 'var(--accent)' }}>📌 Pinned</span>}
                  </div>}

                  {m.requires_ack ? (
                    <div style={{ border: '1px solid var(--accent)', borderRadius: 10, padding: '12px 14px', background: 'var(--accent-bg)', marginTop: 2 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        <span className="badge" style={{ background: 'var(--accent)', color: '#fff', fontSize: 10 }}>UPDATE — please confirm</span>
                      </div>
                      <div style={{ marginBottom: 10 }}><RichContent html={m.body} highlightMentions /></div>
                      {iConfirmed(m.id)
                        ? <span style={{ fontSize: 12.5, color: 'var(--passed)', fontWeight: 600 }}>✓ You confirmed</span>
                        : <button className="btn btn-cta" style={{ fontSize: 12.5 }} onClick={() => confirmRead(m.id)}>Confirm you've read this</button>}
                      <div style={{ marginTop: 8, display: 'flex', gap: 12, alignItems: 'center' }}>
                        <span style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{confirmCount(m.id)}/{members.length} confirmed</span>
                        {canPostUpdate && <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: '3px 8px' }} onClick={() => setTrackFor(m.id)}>View who</button>}
                      </div>
                    </div>
                  ) : (
                    <MessageBody html={m.body} />
                  )}

                  {attachments.filter(a => a.message_id === m.id).map(a => (
                    <AttachmentView key={a.id} att={a} onMediaLoad={onMediaLoad}
                      onOpenImage={(url) => {
                        const imgs = attachments
                          .filter(x => x.message_id === m.id && (x.file_type || '').startsWith('image/'))
                          .map(x => x.public_url)
                        const idx = Math.max(0, imgs.indexOf(url))
                        setLightbox({ images: imgs, index: idx })
                      }} />
                  ))}

                  <ReactionBar messageId={m.id} reactions={reactions} meId={me.id}
                    profiles={profiles} senders={senders}
                    onToggle={toggleReaction}
                    pickerOpen={reactFor === m.id}
                    onOpenPicker={() => setReactFor(reactFor === m.id ? null : m.id)}
                    onClosePicker={() => setReactFor(null)}
                    reactorsFor={reactorsFor} setReactorsFor={setReactorsFor} />

                  <ReplyAffordance count={replyCount} unseen={unseenReplies}
                    onOpen={() => { setThreadFor(m.id); markThreadRead(m.id) }} />

                  {/* Read receipts. Only on the newest message by default — a
                      line under every message is noise. Click to see who. */}
                  {isNewest && readerNames.length > 0 && (
                    <button onClick={() => setReadersFor(readersFor === m.id ? null : m.id)}
                      style={{ border: 0, background: 'transparent', padding: '2px 0', marginTop: 2, cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, color: 'var(--ink-soft)', display: 'block', textAlign: 'left' }}>
                      ✓✓ {readByLabel(readerNames)}
                    </button>
                  )}
                  {readersFor === m.id && (
                    <ReadByPanel names={readerNames} unread={members.filter(pid => pid !== m.sender_id && !readerIds.includes(pid)).map(pid => senders[pid] || profiles.find(p => p.id === pid)?.full_name).filter(Boolean)}
                      onClose={() => setReadersFor(null)} />
                  )}
                </div>

                {/* Hover-revealed actions. Create task = anyone; pin = moderator; edit = own normal message; delete = own or moderator. */}
                {(
                  <div style={{ position: 'absolute', top: 0, right: 0, display: 'flex', gap: 4 }}>
                    <button className="chat-msg-delete" title="Create a project task from this message"
                      onClick={() => setTaskFromMsg(m)}
                      style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 6, cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: '4px 6px', color: 'var(--ink-soft)' }}>
                      ✅
                    </button>
                    {canPin && (
                      <button className="chat-msg-delete" title={m.pinned_at ? 'Unpin this message' : 'Pin this message'}
                        onClick={() => togglePin(m)}
                        style={{ border: '1px solid var(--line)', background: m.pinned_at ? 'var(--accent-bg)' : 'var(--surface)', borderRadius: 6, cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: '4px 6px', color: 'var(--ink-soft)' }}>
                        📌
                      </button>
                    )}
                    {canEdit && (
                      <button className="chat-msg-delete" title="Edit your message"
                        onClick={() => openEdit(m)}
                        style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 6, cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: '4px 6px', color: 'var(--ink-soft)' }}>
                        ✏️
                      </button>
                    )}
                    {canDelete && (
                      <button className="chat-msg-delete" title={m.sender_id === me.id ? 'Delete your message' : 'Remove this message'}
                        onClick={() => deleteMessage(m)}
                        style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 6, cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: '4px 6px', color: 'var(--failed)' }}>
                        🗑
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        <div ref={bottomRef} />
      </div>

      <TypingLine names={typerNames} />

      {dmBlockedBy.length > 0 ? (
        <div style={{ borderTop: '1px solid var(--line)', padding: '14px 16px', flex: 'none', background: 'var(--canvas)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <span style={{ fontSize: 18 }}>🔕</span>
          <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>
            <b>{dmBlockedBy.length > 1 ? dmBlockedBy.slice(0, -1).join(', ') + ' and ' + dmBlockedBy[dmBlockedBy.length - 1] : dmBlockedBy[0]}</b> can't accept direct messages right now.
            {' '}Please direct your questions to the main chat. If this is a private matter, please email{' '}
            <a href="mailto:support@opsiscx.com" style={{ color: 'var(--accent)', fontWeight: 600 }}>support@opsiscx.com</a>.
          </div>
        </div>
      ) : (
      <div style={{ borderTop: '1px solid var(--line)', padding: '10px 16px', flex: 'none', background: 'var(--surface)' }}>
        {agentMuted && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 8, flexWrap: 'wrap' }}>
            <span>🔕 Messages from <b style={{ color: 'var(--ink)' }}>{agentMuted.name}</b> are turned off — they can read this but can't reply.</span>
            <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: '2px 8px' }} onClick={agentMuted.onTurnOn}>Turn on</button>
          </div>
        )}
        {/* Pending scheduled messages you've queued for this conversation. */}
        {scheduled.length > 0 && (
          <div style={{ marginBottom: 8, border: '1px solid var(--line)', borderRadius: 8, padding: '6px 8px', background: 'var(--canvas)' }}>
            {scheduled.map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 2px' }}>
                <span style={{ fontSize: 12.5 }}>🕗</span>
                <span style={{ fontSize: 12, color: 'var(--ink-soft)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <b style={{ color: 'var(--ink)' }}>{new Date(s.send_at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</b> · {htmlToText(s.body)}
                </span>
                <button className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 8px', color: 'var(--failed)' }} onClick={() => cancelScheduled(s.id)}>Cancel</button>
              </div>
            ))}
          </div>
        )}

        {/* Post-as-@update (left) + Schedule-send (pushed right) share one row to save vertical space.
            Closed on mobile they stay on one line (nowrap); opening the scheduler lets it wrap. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: (isMobile && !schedOpen) ? 'nowrap' : 'wrap', marginBottom: 8 }}>
            {canPostUpdate && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, fontSize: 12.5, color: requireAck ? 'var(--accent)' : 'var(--ink-soft)', cursor: 'pointer', fontWeight: requireAck ? 600 : 400 }}>
                <input type="checkbox" checked={requireAck} onChange={e => setRequireAck(e.target.checked)} style={{ flex: 'none' }} />
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  Post as <b>@update</b>
                  {!isMobile && ' — require everyone to confirm they\'ve read it'}
                </span>
              </label>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', flex: 'none' }}>
              <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 10px', flex: 'none', whiteSpace: 'nowrap' }}
                onClick={() => { setSchedOpen(o => { const n = !o; if (n && !schedAt) setSchedAt(defaultSchedAt()); return n }) }}>
                🕗 {schedOpen ? (isMobile ? 'Cancel' : 'Cancel schedule') : (isMobile ? 'Schedule' : 'Schedule send')}
              </button>
              {schedOpen && (
                <>
                  <input type="datetime-local" value={schedAt} onChange={e => setSchedAt(e.target.value)}
                    style={{ padding: '5px 8px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--ink)' }} />
                  <button className="btn btn-primary" style={{ fontSize: 12, padding: '5px 12px' }} onClick={scheduleMessage} disabled={!schedAt}>Schedule</button>
                  {!isMobile && <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>Delivers at your chosen time. (Text only — no attachments.)</span>}
                </>
              )}
            </div>
          </div>

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

        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 8, position: 'relative' }}>
          {showPicker && (
            // onMouseDown/preventDefault everywhere: clicking the picker must NOT
            // blur the composer, or we lose the caret and the emoji goes nowhere.
            <div onMouseDown={e => e.preventDefault()}
              style={{ position: 'absolute', bottom: 52, left: 0, zIndex: 50 }}>
              <EmojiPicker onEmojiClick={(e) => { composerRef.current?.insertText(e.emoji); setShowPicker(false) }}
                width={isMobile ? 280 : 320} height={isMobile ? 370 : 430} previewConfig={{ showPreview: true, defaultCaption: 'Hover an emoji to see its name', defaultEmoji: '1f642' }} />
            </div>
          )}

          <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }}
            onChange={e => { addFiles(e.target.files); e.target.value = '' }} />

          {/* Desktop: icons sit left of the editor. Mobile: they move below it. */}
          {!isMobile && (
            <>
              <button type="button" onClick={() => fileInputRef.current?.click()} title="Attach file"
                style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 8, cursor: 'pointer', fontSize: 17, padding: '0 10px', flex: 'none' }}>📎</button>
              <button type="button" onMouseDown={e => { e.preventDefault(); setShowPicker(p => !p) }} title="Emoji"
                style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 8, cursor: 'pointer', fontSize: 18, padding: '0 10px', flex: 'none' }}>😀</button>
            </>
          )}

          <div style={{ flex: 1, minWidth: 0 }}>
            <RichEditor
              variant="chat"
              editorRef={composerRef}
              value={htmlRef.current}
              profiles={profiles}
              submitOnEnter
              onChange={(html) => { htmlRef.current = html; saveDraft(html); notifyTyping() }}
              onSubmit={send}
              onPasteFiles={(files) => addFiles(files)}
              placeholder={requireAck
                ? 'Write your update…'
                : isMobile
                  ? `Message ${channel?.is_dm ? (dmName || '') : '#' + (channel?.name || '')}`
                  : `Message ${channel?.is_dm ? (dmName || '') : '#' + (channel?.name || '')}  (@name, @here, or paste/attach a file)`}
              minHeight={isMobile ? 44 : 76} maxHeight={isMobile ? 140 : 200} />
          </div>

          {isMobile ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button type="button" onClick={() => fileInputRef.current?.click()} title="Attach file"
                style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 8, cursor: 'pointer', fontSize: 17, width: 42, height: 42, padding: 0, flex: 'none', display: 'grid', placeItems: 'center' }}>📎</button>
              <button type="button" onMouseDown={e => { e.preventDefault(); setShowPicker(p => !p) }} title="Emoji"
                style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 8, cursor: 'pointer', fontSize: 18, width: 42, height: 42, padding: 0, flex: 'none', display: 'grid', placeItems: 'center' }}>😀</button>
              <div style={{ flex: 1 }} />
              <button className={'btn ' + (requireAck ? 'btn-cta' : 'btn-primary')} onClick={send} disabled={uploading}
                style={{ height: 42 }}>
                {requireAck ? 'Post update' : 'Send'}
              </button>
            </div>
          ) : (
            <button className={'btn ' + (requireAck ? 'btn-cta' : 'btn-primary')} onClick={send} disabled={uploading}>
              {requireAck ? 'Post update' : 'Send'}
            </button>
          )}
        </div>
      </div>
      )}

      {trackFor && <TrackPanel messageId={trackFor} me={me} members={members} profiles={profiles} acks={acks} onClose={() => setTrackFor(null)} />}
      {threadFor && <ThreadPanel parentId={threadFor} channelId={channelId} me={me} senders={senders} profiles={profiles} channel={channel} members={members} canModerate={canModerate} onClose={() => setThreadFor(null)} onSeen={markThreadRead} highlightId={highlightId} />}
      {lightbox.index != null && (
        <Lightbox images={lightbox.images} index={lightbox.index}
          onClose={() => setLightbox({ images: [], index: null })}
          onNav={(d) => setLightbox(lb => ({ ...lb, index: (lb.index + d + lb.images.length) % lb.images.length }))} />
      )}
      {editing && (
        <EditMessageModal
          initialHtml={editing.html}
          profiles={profiles}
          saving={editSaving}
          onCancel={() => setEditing(null)}
          onSave={saveEdit}
        />
      )}
      {showPrefs && <NotificationPrefsPanel channelId={channelId} channelName={channel?.name}
        isDm={channel?.is_dm} dmName={dmName} meId={me.id} profiles={profiles}
        onClose={() => setShowPrefs(false)} />}
      {showMembers && <ChannelMembersPanel channelId={channelId} channelName={channel?.name} profiles={profiles} meId={me.id} isOwner={isOwner} onClose={() => setShowMembers(false)} onChanged={async () => {
        const { data } = await supabase.from('channel_members').select('profile_id').eq('channel_id', channelId)
        setMembers((data || []).map(m => m.profile_id))
      }} />}
      {/* Turn a chat message into a project task. Opens the standard TaskModal
          (project picker, assignees, due, priority) prefilled from the message.
          Wrapped in ProjectsDataProvider so the modal has its projects/people. */}
      {taskFromMsg && (() => {
        const senderName = senders[taskFromMsg.sender_id]
          || profiles.find(p => p.id === taskFromMsg.sender_id)?.full_name
          || 'Someone'
        const plain = (htmlToText(taskFromMsg.body || '') || '').trim()
        const name = plain ? plain.replace(/\s+/g, ' ').slice(0, 140) : 'Task from chat message'
        const where = channel?.is_dm ? 'a direct message' : (channel?.name ? '#' + channel.name : 'chat')
        const notes = `<blockquote>${taskFromMsg.body || '<em>(no text)</em>'}</blockquote><p>— From ${senderName} in ${where}</p>`
        return (
          <ProjectsDataProvider>
            <TaskModal
              taskId={null}
              defaultName={name}
              defaultNotes={notes}
              onClose={() => setTaskFromMsg(null)}
            />
          </ProjectsDataProvider>
        )
      })()}
    </div>
  )
}

// ============================================================
// NOTIFICATION PREFERENCES — per channel, per DM
// notify_all | notify_mentions | notify_from[] | notify_keywords[]
// "None" = all four off/empty.
// ============================================================
function NotificationPrefsPanel({ channelId, channelName, isDm, dmName, meId, profiles, onClose }) {
  const [prefs, setPrefs] = useState(null)
  const [saving, setSaving] = useState(false)
  const [kw, setKw] = useState('')
  const [personSearch, setPersonSearch] = useState('')

  useEffect(() => {
    let active = true
    ;(async () => {
      const { data } = await supabase.from('channel_notification_prefs')
        .select('*').eq('channel_id', channelId).eq('profile_id', meId).maybeSingle()
      if (!active) return
      setPrefs(data
        ? {
            notify_all: !!data.notify_all,
            notify_mentions: !!data.notify_mentions,
            notify_from: data.notify_from || [],
            notify_keywords: data.notify_keywords || [],
          }
: {
    notify_all: true,
    notify_mentions: true,
    notify_from: [],
notify_keywords: [],
  })
    })()
    return () => { active = false }
  }, [channelId, meId])

  const set = (patch) => setPrefs(p => ({ ...p, ...patch }))

  async function save() {
    setSaving(true)
    const { error } = await supabase.from('channel_notification_prefs').upsert({
      profile_id: meId,
      channel_id: channelId,
      notify_all: prefs.notify_all,
      notify_mentions: prefs.notify_mentions,
      notify_from: prefs.notify_from,
      notify_keywords: prefs.notify_keywords,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'profile_id,channel_id' })
    setSaving(false)
    if (error) window.alert('Could not save: ' + error.message)
    else onClose()
  }

  function addKeyword() {
    const k = kw.trim()
    if (!k) { setKw(''); return }
    if (prefs.notify_keywords.some(x => x.toLowerCase() === k.toLowerCase())) { setKw(''); return }
    set({ notify_keywords: [...prefs.notify_keywords, k] })
    setKw('')
  }

  function togglePerson(pid) {
    set({
      notify_from: prefs.notify_from.includes(pid)
        ? prefs.notify_from.filter(x => x !== pid)
        : [...prefs.notify_from, pid],
    })
  }

  if (!prefs) return null

  const isNone = !prefs.notify_all && !prefs.notify_mentions
    && !prefs.notify_from.length && !prefs.notify_keywords.length

  const others = profiles.filter(p =>
    p.id !== meId && p.full_name?.toLowerCase().includes(personSearch.toLowerCase()))

  const label = isDm ? (dmName || 'this conversation') : `#${channelName}`
  const dim = prefs.notify_all ? 0.45 : 1   // notify_all supersedes the rest

  return (
    <div className="modal-back open" onClick={e => { if (e.target.classList.contains('modal-back')) onClose() }}>
      <div className="modal" style={{ width: 440, maxWidth: '94vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Notifications</h3>
          <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 9px' }} onClick={onClose}>Close</button>
        </div>
        <p className="page-sub" style={{ marginBottom: 10 }}>
          For {label}.{' '}
          {isNone && <b style={{ color: 'var(--ink-soft)' }}>Currently muted — you'll get nothing here.</b>}
        </p>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          <label style={NP.row}>
            <input type="checkbox" checked={prefs.notify_all}
              onChange={e => set({ notify_all: e.target.checked })} />
            <span>
              <b style={{ fontSize: 13.5 }}>Every message</b>
              <div style={NP.sub}>Notify me for all activity in {label}.</div>
            </span>
          </label>

          <label style={{ ...NP.row, ...NP.block, opacity: dim }}>
            <input type="checkbox" checked={prefs.notify_mentions} disabled={prefs.notify_all}
              onChange={e => set({ notify_mentions: e.target.checked })} />
            <span>
              <b style={{ fontSize: 13.5 }}>Mentions</b>
              <div style={NP.sub}>@me, @here, and @update.{isDm ? ' Also every DM.' : ''}</div>
            </span>
          </label>

          <div style={{ ...NP.block, opacity: dim }}>
            <b style={{ fontSize: 13.5 }}>Messages from specific people</b>
            <div style={NP.sub}>
              {prefs.notify_from.length
                ? `${prefs.notify_from.length} selected`
                : 'Nobody selected.'}
            </div>
            {prefs.notify_from.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0' }}>
                {prefs.notify_from.map(pid => {
                  const p = profiles.find(x => x.id === pid)
                  return (
                    <span key={pid} style={NP.chip}>
                      {p?.full_name || 'Unknown'}
                      <button onClick={() => togglePerson(pid)} disabled={prefs.notify_all} style={NP.chipX} title="Remove">✕</button>
                    </span>
                  )
                })}
              </div>
            )}
            <input value={personSearch} onChange={e => setPersonSearch(e.target.value)}
              placeholder="Search people to add…" disabled={prefs.notify_all}
              style={{ ...NP.input, marginTop: 8 }} />
            {personSearch && (
              <div style={{ maxHeight: 150, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8, marginTop: 6 }}>
                {others.length === 0 && <div className="page-sub" style={{ fontSize: 12, padding: 10 }}>No match.</div>}
                {others.map(p => (
                  <button key={p.id} type="button" onClick={() => { togglePerson(p.id); setPersonSearch('') }}
                    style={NP.listBtn}>
                    <Av name={p.full_name} size={24} fontSize={10} />
                    <span style={{ flex: 1, fontSize: 13.5 }}>{p.full_name}</span>
                    {prefs.notify_from.includes(p.id) && <span style={{ color: 'var(--accent)', fontWeight: 700 }}>✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div style={{ ...NP.block, opacity: dim }}>
            <b style={{ fontSize: 13.5 }}>Messages containing keywords</b>
            <div style={NP.sub}>Case-insensitive, whole words only — "cat" won't match "concatenate".</div>
            {prefs.notify_keywords.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0' }}>
                {prefs.notify_keywords.map(k => (
                  <span key={k} style={NP.chip}>
                    {k}
                    <button onClick={() => set({ notify_keywords: prefs.notify_keywords.filter(x => x !== k) })}
                      disabled={prefs.notify_all} style={NP.chipX} title="Remove">✕</button>
                  </span>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <input value={kw} onChange={e => setKw(e.target.value)} disabled={prefs.notify_all}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addKeyword() } }}
                placeholder="Add a keyword, press Enter" style={{ ...NP.input, flex: 1 }} />
              <button className="btn btn-ghost" onClick={addKeyword} disabled={prefs.notify_all || !kw.trim()}>Add</button>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line-soft)' }}>
          <button className="btn btn-ghost" style={{ flex: 1 }}
            onClick={() => set({ notify_all: false, notify_mentions: false, notify_from: [], notify_keywords: [] })}>
            Mute (None)
          </button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

const NP = {
  row: { display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 0', cursor: 'pointer' },
  sub: { fontSize: 12, color: 'var(--ink-soft)', marginTop: 2, fontWeight: 400 },
  block: { paddingTop: 12, marginTop: 4, borderTop: '1px solid var(--line-soft)' },
  chip: { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', background: 'var(--accent-bg)', color: 'var(--accent)', borderRadius: 12, fontSize: 12, fontWeight: 600 },
  chipX: { border: 0, background: 'transparent', cursor: 'pointer', color: 'inherit', fontSize: 12, padding: 0, lineHeight: 1 },
  input: { width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' },
  listBtn: { display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left', border: 0, background: 'transparent', cursor: 'pointer', padding: '7px 8px', fontFamily: 'inherit' },
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
    try {
      await notifyChannelAdded({
        recipientIds: [pid],
        actorId: meId,
        actorName: profiles.find(p => p.id === meId)?.full_name,
        channelName,
        isDm: false,
        channelId,
      })
    } catch (notificationError) {
      console.error('Member added, but notification creation failed', notificationError)
      window.alert(`Member added, but notification failed: ${notificationError.message || 'Unknown error'}`)
    }
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
                <span style={{ position: 'relative', width: 30, height: 30, flex: 'none' }}>
                  <Av name={p.full_name} size={30} fontSize={12} />
                  <span style={{ position: 'absolute', right: -1, bottom: -1 }}><PresenceDot profile={p} size={10} /></span>
                </span>
                <span style={{ flex: 1, fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.full_name}{p.id === meId ? ' (you)' : ''}</span>
                  {effStatus(p) && (effStatus(p).emoji || effStatus(p).text) && <span title={effStatus(p).text || ''} style={{ fontSize: 12.5, color: 'var(--ink-soft)', display: 'inline-flex', alignItems: 'center', gap: 3, minWidth: 0 }}>{effStatus(p).emoji && <span>{effStatus(p).emoji}</span>}{effStatus(p).type === 'ooo' ? <span style={{ fontWeight: 700, color: '#7c3aed' }}>OOO</span> : <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>{effStatus(p).text}</span>}</span>}
                </span>
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
                          <Av name={p.full_name} size={26} fontSize={11} />
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

// Who has read a message. Renders inline under the newest one.
function EditMessageModal({ initialHtml, profiles, saving, onCancel, onSave }) {
  const editorRef = useRef(null)
  const htmlRef = useRef(initialHtml || '')
  return (
    <div onClick={onCancel}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 4000, display: 'grid', placeItems: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, width: 'min(560px, 100%)', maxHeight: '80vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)', fontWeight: 700, fontSize: 15 }}>Edit message</div>
        <div style={{ padding: 16 }}>
          <RichEditor
            value={initialHtml || ''}
            variant="chat"
            autofocus
            editorRef={editorRef}
            profiles={profiles}
            onChange={(html) => { htmlRef.current = html }}
            placeholder="Edit your message…"
          />
        </div>
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-ghost" onClick={onCancel} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" disabled={saving}
            onClick={() => onSave(htmlRef.current)}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ReadByPanel({ names, unread, onClose }) {
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 30 }} />
      <div style={{ position: 'relative', zIndex: 31, marginTop: 4, border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface)', boxShadow: '0 6px 20px rgba(0,0,0,.12)', padding: '8px 10px', maxWidth: 260 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink-soft)', marginBottom: 5 }}>
          Read by {names.length}
        </div>
        {names.map(n => (
          <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '2px 0', fontSize: 12.5 }}>
            <Av name={n} size={20} fontSize={9} />
            {n}
          </div>
        ))}
        {unread.length > 0 && (
          <>
            <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink-soft)', margin: '8px 0 5px', borderTop: '1px solid var(--line-soft)', paddingTop: 7 }}>
              Not yet {unread.length}
            </div>
            {unread.map(n => (
              <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '2px 0', fontSize: 12.5, opacity: .6 }}>
                <Av name={n} size={20} fontSize={9} bg="var(--ink-soft)" />
                {n}
              </div>
            ))}
          </>
        )}
      </div>
    </>
  )
}

// ============================================================
// Custom emoji (team-uploaded images for reactions).
// Stored in public.custom_emojis + the "custom-emojis" bucket. A reaction
// with a custom emoji is saved as ":shortcode:" in message_reactions.emoji.
// Staff can add; the uploader or an admin can remove; everyone can use them.
// ============================================================
let _customEmojis = null
let _ceLoading = null
const _ceListeners = new Set()
async function loadCustomEmojis(force = false) {
  if (_customEmojis && !force) return _customEmojis
  if (_ceLoading && !force) return _ceLoading
  _ceLoading = supabase.from('custom_emojis').select('id, shortcode, image_url, storage_path, created_by, created_at').order('shortcode')
    .then(({ data }) => {
      _customEmojis = data || []
      _ceLoading = null
      _ceListeners.forEach(fn => fn(_customEmojis))
      return _customEmojis
    })
  return _ceLoading
}
function useCustomEmojis() {
  const [list, setList] = useState(_customEmojis || [])
  useEffect(() => {
    _ceListeners.add(setList)
    loadCustomEmojis().then(setList)
    return () => { _ceListeners.delete(setList) }
  }, [])
  return list
}
const CUSTOM_RE = /^:([a-z0-9_]{2,32}):$/
// Renders a reaction: a normal emoji as text, ":shortcode:" as its image.
// ---- Animated emoji (Google Noto Animated Emoji, free to use) — 2026-10-27, Brittney ----
// The animated file lives at fonts.gstatic.com/s/e/notoemoji/latest/<codepoints>/512.webp.
// Not every emoji has one, so we try the likely file names and fall back to the normal
// emoji if none loads. Results are remembered so a missing one is only tried once.
const NOTO_BASE = 'https://fonts.gstatic.com/s/e/notoemoji/latest/'
const _notoOk = new Map()   // emoji -> working url | false
function notoCandidates(emoji) {
  const cps = Array.from(emoji || '').map(ch => ch.codePointAt(0).toString(16))
  if (!cps.length) return []
  const full = cps.join('_')
  const noVs = cps.filter(c => c !== 'fe0f').join('_')
  return [...new Set([full, noVs].filter(Boolean))].map(k => `${NOTO_BASE}${k}/512.webp`)
}
function AnimatedEmoji({ emoji, size = 20 }) {
  const known = _notoOk.get(emoji)
  const cands = useMemo(() => known ? [known] : notoCandidates(emoji), [emoji, known])
  const [i, setI] = useState(0)
  if (known === false || i >= cands.length) return <span className="chat-emoji" style={{ fontSize: size - 2 }}>{emoji}</span>
  return (
    <img src={cands[i]} alt={emoji} width={size} height={size} draggable={false}
      onLoad={() => _notoOk.set(emoji, cands[i])}
      onError={() => { if (i + 1 >= cands.length) _notoOk.set(emoji, false); setI(i + 1) }}
      style={{ width: size, height: size, verticalAlign: 'middle', objectFit: 'contain' }} />
  )
}
// A message that is only 1–3 emoji shows them big and animated (like Teams).
const EMOJI_ONLY_RE = /^(?:\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*\s*){1,3}$/u
function emojiOnlyList(html) {
  if (!html || /<img|<a\s/i.test(html)) return null
  const txt = html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
  if (!txt || !EMOJI_ONLY_RE.test(txt)) return null
  const list = txt.match(/\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*/gu)
  return list && list.length <= 3 ? list : null
}
function MessageBody({ html, style }) {
  const big = emojiOnlyList(html)
  if (big) return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '2px 0', ...(style || {}) }} aria-label={big.join(' ')}>
      {big.map((e, k) => <AnimatedEmoji key={k} emoji={e} size={48} />)}
    </div>
  )
  return <RichContent html={html} highlightMentions style={style} />
}

function EmojiGlyph({ emoji, size = 16, custom, animate = false }) {
  const m = CUSTOM_RE.exec(emoji || '')
  const c = m && custom.find(x => x.shortcode === m[1])
  if (c) return <img src={c.image_url} alt={emoji} title={emoji} style={{ width: size, height: size, objectFit: 'contain', verticalAlign: 'middle' }} />
  if (animate) return <AnimatedEmoji emoji={emoji} size={size} />
  return <span className="chat-emoji" style={{ fontSize: size - 2 }}>{emoji}</span>
}
const pickerCustomEmojis = (list) => list.map(c => ({ id: `:${c.shortcode}:`, names: [c.shortcode], imgUrl: c.image_url }))
const pickedEmoji = (e) => e.isCustom ? `:${(e.names && e.names[0]) || ''}:` : e.emoji

// Shrink any image to a 128×128 PNG (transparent padding). GIFs under 512 KB
// are kept as-is so animation survives.
async function prepareEmojiImage(file) {
  if (file.type === 'image/gif' && file.size <= 512 * 1024) return { blob: file, ext: 'gif', type: 'image/gif' }
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url })
    const S = 128, canvas = document.createElement('canvas'); canvas.width = S; canvas.height = S
    const ctx = canvas.getContext('2d')
    const r = Math.min(S / img.width, S / img.height)
    const w = img.width * r, h = img.height * r
    ctx.drawImage(img, (S - w) / 2, (S - h) / 2, w, h)
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'))
    return { blob, ext: 'png', type: 'image/png' }
  } finally { URL.revokeObjectURL(url) }
}

function CustomEmojiModal({ onClose }) {
  const { user, isAdmin, appRole } = useAuth()
  const list = useCustomEmojis()
  const canAdd = isStaffProfile({ role: appRole, is_admin: isAdmin })
  const [name, setName] = useState('')
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const fileRef = useRef(null)

  const code = name.trim().toLowerCase().replace(/^:+|:+$/g, '').replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '')
  const taken = list.some(c => c.shortcode === code)
  const validName = /^[a-z0-9_]{2,32}$/.test(code)

  function pickFile(f) {
    setErr('')
    if (!f) return
    if (!/^image\/(png|gif|webp|jpeg)$/.test(f.type)) { setErr('Use a PNG, GIF, JPG or WebP image.'); return }
    if (f.size > 5 * 1024 * 1024) { setErr('That image is over 5 MB.'); return }
    setFile(f)
    if (preview) URL.revokeObjectURL(preview)
    setPreview(URL.createObjectURL(f))
    if (!name) setName(f.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32))
  }

  async function add() {
    if (!file || !validName || taken) return
    setBusy(true); setErr('')
    try {
      const { blob, ext, type } = await prepareEmojiImage(file)
      if (blob.size > 1024 * 1024) throw new Error('That image is still over 1 MB after shrinking — try a smaller one.')
      const path = `${user.id}/${code}-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('custom-emojis').upload(path, blob, { contentType: type, upsert: false })
      if (upErr) throw upErr
      const image_url = supabase.storage.from('custom-emojis').getPublicUrl(path).data.publicUrl
      const { error: insErr } = await supabase.from('custom_emojis').insert({ shortcode: code, image_url, storage_path: path, created_by: user.id })
      if (insErr) {
        await supabase.storage.from('custom-emojis').remove([path])
        throw new Error(/duplicate|unique/i.test(insErr.message) ? `:${code}: is already taken.` : insErr.message)
      }
      await loadCustomEmojis(true)
      setName(''); setFile(null); setPreview(null); if (fileRef.current) fileRef.current.value = ''
    } catch (e) { setErr(e.message || String(e)) }
    setBusy(false)
  }

  async function remove(c) {
    if (!window.confirm(`Remove :${c.shortcode}:? Reactions that used it will show as text.`)) return
    const { error } = await supabase.from('custom_emojis').delete().eq('id', c.id)
    if (error) { setErr(error.message); return }
    await supabase.storage.from('custom-emojis').remove([c.storage_path])
    loadCustomEmojis(true)
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 90, display: 'grid', placeItems: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: 14, padding: 20, width: 'min(460px, 100%)', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 20px 50px rgba(0,0,0,.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <b style={{ fontSize: 16 }}>Custom emoji</b>
          <button className="btn btn-ghost" style={{ padding: '3px 10px', fontSize: 12 }} onClick={onClose}>Close</button>
        </div>
        <p className="page-sub" style={{ fontSize: 12.5, marginTop: 4 }}>Team emoji everyone can react with. Find them under the custom tab in the reaction picker.</p>

        {canAdd ? (
          <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 14, marginTop: 10 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <button onClick={() => fileRef.current?.click()} title="Choose image"
                style={{ width: 64, height: 64, flex: 'none', borderRadius: 10, border: '1px dashed var(--line)', background: 'var(--canvas)', cursor: 'pointer', display: 'grid', placeItems: 'center', fontSize: 12, color: 'var(--ink-soft)', fontFamily: 'inherit', padding: 0 }}>
                {preview ? <img src={preview} alt="" style={{ width: 48, height: 48, objectFit: 'contain' }} /> : 'Upload'}
              </button>
              <input ref={fileRef} type="file" accept="image/png,image/gif,image/webp,image/jpeg" hidden onChange={e => pickFile(e.target.files?.[0])} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)' }}>Name</label>
                <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--line)', borderRadius: 8, padding: '0 8px', marginTop: 4 }}>
                  <span style={{ color: 'var(--ink-soft)' }}>:</span>
                  <input value={name} maxLength={40} onChange={e => setName(e.target.value)} placeholder="ty_heart"
                    style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', padding: '7px 4px', background: 'transparent', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 14 }} />
                  <span style={{ color: 'var(--ink-soft)' }}>:</span>
                </div>
                <div style={{ fontSize: 11.5, marginTop: 4, color: taken ? '#DC2626' : 'var(--ink-soft)' }}>
                  {!name ? 'Lowercase letters, numbers and _' : taken ? `:${code}: is already taken` : !validName ? '2–32 characters: a–z, 0–9, _' : `Saved as :${code}:`}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
              <button className="btn" disabled={busy || !file || !validName || taken} onClick={add}>{busy ? 'Adding…' : 'Add emoji'}</button>
            </div>
            <div className="page-sub" style={{ fontSize: 11.5, marginTop: 4 }}>Square images work best. Images are shrunk to 128×128.</div>
          </div>
        ) : (
          <div className="page-sub" style={{ fontSize: 12.5, marginTop: 6 }}>Ask a team lead if you'd like a new emoji added.</div>
        )}

        {err && <div style={{ color: '#DC2626', fontSize: 12.5, marginTop: 8 }}>{err}</div>}

        <div style={{ fontSize: 13, fontWeight: 600, margin: '16px 0 8px' }}>All custom emoji ({list.length})</div>
        {list.length === 0 && <div className="page-sub" style={{ fontSize: 12.5 }}>None yet.</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 6 }}>
          {list.map(c => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 7px', border: '1px solid var(--line)', borderRadius: 8, minWidth: 0 }}>
              <img src={c.image_url} alt="" style={{ width: 24, height: 24, objectFit: 'contain', flex: 'none' }} />
              <span style={{ fontSize: 12, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`:${c.shortcode}:`}>:{c.shortcode}:</span>
              {(c.created_by === user?.id || isAdmin) && (
                <button onClick={() => remove(c)} title="Remove" style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--ink-soft)', fontSize: 13, padding: 2 }}>✕</button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---- Emoji names for the reaction hover card ----
// Official Unicode names (src/lib/emojiNames.js, ~16 KB) load the first time
// someone hovers a reaction, so they never slow down opening Chat.
let _emojiNames = null
let _emojiNamesLoading = null
function loadEmojiNames() {
  if (_emojiNames) return Promise.resolve(_emojiNames)
  if (!_emojiNamesLoading) _emojiNamesLoading = import('../lib/emojiNames').then(m => (_emojiNames = m.default))
  return _emojiNamesLoading
}
// ":thumbs_up:" style label, Slack-like. Custom emoji are already ":name:".
function emojiLabel(emoji) {
  if (CUSTOM_RE.test(emoji || '')) return emoji
  if (!_emojiNames) return null
  const key = (emoji || '').replace(/\uFE0F/g, '')
  const base = key.replace(/[\u{1F3FB}-\u{1F3FF}]/gu, '')
  const name = _emojiNames[key] || _emojiNames[base]
  return name ? `:${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}:` : null
}

// ============================================================
// REACTION PICKER (2026-10-27, Brittney's mockup)
// Compact quick bar (6 favourites + a smiley+ button) that opens a "Choose a reaction"
// panel: search, category tabs, tile grid, an Animated section, Custom emojis, and a
// footer with the hovered emoji's name + "Add custom emoji". Emoji data and names come
// from src/lib/emojiNames.js (Unicode order), loaded when the panel opens.
// ============================================================
const QUICK_REACTIONS = ['👍', '❤️', '😂', '🙏', '😍', '💙']
const RECENT_KEY = 'cc.emoji.recent'
const DEFAULT_RECENT = ['❤️', '🥺', '👍', '👀', '😂', '🔥', '🙏', '💚', '✨', '💯', '🥰', '😎', '🎉', '😊']
// Popular emoji that have Google's animated versions (any without one just show normally).
const ANIMATED_SET = ['😀', '😂', '🤣', '😊', '😍', '🥰', '😘', '😎', '🤩', '🥳', '😇', '🤗', '🤔', '🫡', '🙄', '😴', '🤯', '😱', '😭', '🥺',
  '😤', '😡', '🤬', '🤡', '👻', '💀', '💩', '🤖', '👀', '👋', '👍', '👎', '👏', '🙌', '🫶', '🙏', '💪', '✌️', '🤞', '🫰',
  '❤️', '🧡', '💛', '💚', '💙', '💜', '💔', '❤️‍🔥', '💯', '🔥', '✨', '🎉', '🎊', '🎂', '🎁', '⭐', '🌈', '⚡', '🚀', '🪼']
// first emoji of each Unicode group, in emojiNames.js order
const EMOJI_GROUPS = [
  ['smileys', 'Smileys', '😀'], ['people', 'People', '👋'], ['animals', 'Animals', '🐵'], ['food', 'Food', '🍇'],
  ['travel', 'Travel', '🌍'], ['activities', 'Activities', '🎃'], ['objects', 'Objects', '👓'], ['symbols', 'Symbols', '🏧'], ['flags', 'Flags', '🏁'],
]
// Names drop U+FE0F; put it back after single-width characters so they draw as emoji (❤ → ❤️, #⃣ → #️⃣).
function withVS(e) {
  let out = ''
  for (const ch of Array.from(e)) {
    out += ch
    const cp = ch.codePointAt(0)
    if (cp < 0x10000 && cp !== 0x200D && cp !== 0xFE0F && cp !== 0x20E3) out += '\uFE0F'
  }
  return out
}
function readRecent() {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); if (Array.isArray(v) && v.length) return v } catch { /* ignore */ }
  return DEFAULT_RECENT
}
function pushRecent(e) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([e, ...readRecent().filter(x => x !== e)].slice(0, 28))) } catch { /* ignore */ }
}
const RP_ICON = {
  recent: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  animated: 'M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4zM19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8zM5 15l.6 1.4 1.4.6-1.4.6L5 19l-.6-1.4L3 17l1.4-.6z',
  smileys: 'M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  people: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  animals: 'M5 11c-1.5-1-2-3-1-5 2 0 3.5 1 4 2.5M19 11c1.5-1 2-3 1-5-2 0-3.5 1-4 2.5M12 21c-4 0-7-2.5-7-6.5S8 8 12 8s7 2.5 7 6.5S16 21 12 21zM10 14h.01M14 14h.01',
  food: 'M3 11h18M5 11a7 7 0 0 1 14 0M4 15h16M5 15v1a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-1',
  travel: 'M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z',
  activities: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 3v18M3 12h18M5.6 5.6c3.5 3.5 3.5 9.3 0 12.8M18.4 5.6c-3.5 3.5-3.5 9.3 0 12.8',
  objects: 'M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z',
  symbols: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z',
  flags: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7',
  custom: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  close: 'M18 6L6 18M6 6l12 12',
  smileplus: 'M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01M20 12.5A8.5 8.5 0 1 1 11.5 4M19 2v6M16 5h6',
}
const RpIcon = ({ d, size = 18 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
const RP_CSS = `
.rp-quick { display: inline-flex; align-items: center; gap: 2px; padding: 5px; background: var(--surface); border: 1px solid var(--line); border-radius: 16px; box-shadow: 0 8px 24px rgba(0,0,0,.12); }
.rp-q { width: 40px; height: 40px; border: 0; border-radius: 12px; background: transparent; cursor: pointer; display: grid; place-items: center; transition: transform .12s, background .12s; }
.rp-q:hover, .rp-q:focus-visible { background: var(--accent-bg); transform: scale(1.12); outline: none; }
.rp-q.more { color: var(--accent); background: var(--accent-bg); margin-left: 4px; }
.rp-panel { width: 440px; max-width: calc(100vw - 24px); height: 480px; max-height: 70vh; display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--line); border-radius: 18px; box-shadow: 0 18px 44px rgba(0,0,0,.18); overflow: hidden; margin-top: 8px; }
.rp-head { display: flex; align-items: center; padding: 16px 18px 10px; }
.rp-head h3 { margin: 0; font-size: 17px; font-weight: 700; flex: 1; }
.rp-x { border: 0; background: transparent; cursor: pointer; color: var(--ink-soft); width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; }
.rp-x:hover { background: var(--canvas); }
.rp-search { margin: 0 18px; display: flex; align-items: center; gap: 8px; border: 1px solid var(--line); border-radius: 12px; padding: 0 12px; color: var(--ink-soft); }
.rp-search:focus-within { border-color: var(--accent); }
.rp-search input { flex: 1; border: 0; outline: none; background: transparent; padding: 10px 0; font: inherit; font-size: 14px; color: var(--ink); }
.rp-tabs { display: flex; gap: 2px; padding: 10px 14px 6px; overflow-x: auto; scrollbar-width: none; border-bottom: 1px solid var(--line-soft, var(--line)); }
.rp-tabs::-webkit-scrollbar { display: none; }
.rp-tab { flex: none; border: 0; background: transparent; cursor: pointer; border-radius: 10px; padding: 6px 8px; display: flex; flex-direction: column; align-items: center; gap: 3px; color: var(--ink-soft); font: inherit; font-size: 11px; min-width: 56px; }
.rp-tab:hover { background: var(--canvas); color: var(--ink); }
.rp-tab.on { background: var(--accent-bg); color: var(--accent); font-weight: 600; }
.rp-body { flex: 1; overflow-y: auto; padding: 4px 18px 10px; position: relative; }
.rp-sec-h { display: flex; align-items: baseline; justify-content: space-between; margin: 12px 0 8px; }
.rp-sec-h b { font-size: 14px; }
.rp-more { border: 0; background: transparent; color: var(--accent); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.rp-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }
.rp-tile { aspect-ratio: 1; border: 1px solid var(--line-soft, var(--line)); background: var(--canvas); border-radius: 12px; cursor: pointer; display: grid; place-items: center; padding: 0; transition: transform .1s, border-color .1s, background .1s; }
.rp-tile:hover, .rp-tile:focus-visible { border-color: var(--accent); background: var(--accent-bg); transform: scale(1.06); outline: none; }
.rp-foot { display: flex; align-items: center; gap: 8px; padding: 10px 18px; border-top: 1px solid var(--line-soft, var(--line)); min-height: 44px; }
.rp-foot .name { flex: 1; min-width: 0; font-size: 12.5px; color: var(--ink-soft); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rp-add { border: 0; background: transparent; color: var(--accent); font: inherit; font-size: 13.5px; font-weight: 600; cursor: pointer; white-space: nowrap; }
`
function ReactionPicker({ custom, onPick, onClose, onAddCustom }) {
  const [full, setFull] = useState(false)
  const [names, setNames] = useState(_emojiNames)
  const [q, setQ] = useState('')
  const [tab, setTab] = useState('recent')
  const [hover, setHover] = useState(null)        // { e, label }
  const [more, setMore] = useState({})
  const bodyRef = useRef(null)
  const recent = useMemo(() => readRecent(), [])
  useEffect(() => { if (full && !names) loadEmojiNames().then(setNames).catch(() => {}) }, [full, names])
  useEffect(() => { const k = (ev) => { if (ev.key === 'Escape') onClose() }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [onClose])

  const pick = (e) => { if (!CUSTOM_RE.test(e)) pushRecent(e); onPick(e) }
  const label = (e) => {
    if (CUSTOM_RE.test(e)) return e
    const n = names && (names[e.replace(/\uFE0F/g, '')] || names[e.replace(/\uFE0F/g, '').replace(/[\u{1F3FB}-\u{1F3FF}]/gu, '')])
    return n ? `:${n.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}:` : e
  }
  const groups = useMemo(() => {
    if (!names) return []
    const out = EMOJI_GROUPS.map(([key, title]) => ({ key, title, list: [] }))
    let gi = 0
    for (const raw of Object.keys(names)) {
      if (gi + 1 < EMOJI_GROUPS.length && raw === EMOJI_GROUPS[gi + 1][2]) gi++
      out[gi].list.push(withVS(raw))
    }
    return out
  }, [names])
  const results = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return null
    const cust = custom.filter(c => c.shortcode.includes(t.replace(/:/g, ''))).map(c => `:${c.shortcode}:`)
    const nat = names ? Object.entries(names).filter(([, n]) => n.toLowerCase().includes(t)).slice(0, 140).map(([k]) => withVS(k)) : []
    return [...cust, ...nat]
  }, [q, names, custom])

  const sections = [
    { key: 'recent', title: 'Frequently Used', list: recent, limit: 14 },
    { key: 'animated', title: 'Animated', list: ANIMATED_SET, animate: true, limit: 21 },
    ...(custom.length ? [{ key: 'custom', title: 'Custom Emojis', list: custom.map(c => `:${c.shortcode}:`), limit: 14 }] : []),
    ...groups,
  ]
  const tabs = [['recent', 'Recent'], ['animated', 'Animated'], ...(custom.length ? [['custom', 'Custom']] : []), ...EMOJI_GROUPS.map(([k, t]) => [k, t])]
  const goTab = (k) => {
    setTab(k); setQ('')
    requestAnimationFrame(() => { const el = bodyRef.current?.querySelector(`[data-sec="${k}"]`); if (el) bodyRef.current.scrollTo({ top: el.offsetTop - 4, behavior: 'smooth' }) })
  }
  const onScroll = () => {
    const b = bodyRef.current; if (!b || q) return
    let cur = 'recent'
    b.querySelectorAll('[data-sec]').forEach(el => { if (el.offsetTop - 24 <= b.scrollTop) cur = el.dataset.sec })
    if (cur !== tab) setTab(cur)
  }
  const tile = (e, i, animate) => (
    <button key={e + i} className="rp-tile" onClick={() => pick(e)} aria-label={label(e)} title={label(e)}
      onMouseEnter={() => setHover({ e })} onFocus={() => setHover({ e })}>
      <EmojiGlyph emoji={e} size={28} custom={custom} animate={animate || hover?.e === e} />
    </button>
  )

  return (
    <div>
      <style>{RP_CSS}</style>
      <div className="rp-quick" role="toolbar" aria-label="Quick reactions">
        {QUICK_REACTIONS.map(e => (
          <button key={e} className="rp-q" onClick={() => pick(e)} aria-label={label(e)} title={label(e)}><EmojiGlyph emoji={e} size={26} custom={custom} /></button>
        ))}
        <button className="rp-q more" onClick={() => setFull(f => !f)} aria-label="All emoji" aria-expanded={full} title="All emoji"><RpIcon d={RP_ICON.smileplus} size={22} /></button>
      </div>
      {full && (
        <div className="rp-panel" role="dialog" aria-label="Choose a reaction">
          <div className="rp-head"><h3>Choose a reaction</h3><button className="rp-x" onClick={onClose} aria-label="Close"><RpIcon d={RP_ICON.close} /></button></div>
          <label className="rp-search"><RpIcon d={RP_ICON.search} size={16} /><input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search emojis…" aria-label="Search emojis" /></label>
          {!q && (
            <div className="rp-tabs" role="tablist">
              {tabs.map(([k, t]) => (
                <button key={k} role="tab" aria-selected={tab === k} className={'rp-tab' + (tab === k ? ' on' : '')} onClick={() => goTab(k)}>
                  <RpIcon d={RP_ICON[k]} size={19} />{t}
                </button>
              ))}
            </div>
          )}
          <div className="rp-body" ref={bodyRef} onScroll={onScroll}>
            {results ? (
              <>
                <div className="rp-sec-h"><b>{results.length ? 'Results' : 'No matches'}</b></div>
                <div className="rp-grid">{results.map((e, i) => tile(e, i))}</div>
              </>
            ) : !names && full ? <p className="page-sub" style={{ padding: 12 }}>Loading emoji…</p> : sections.map(sec => {
              const showAll = !sec.limit || more[sec.key] || sec.list.length <= sec.limit
              const list = showAll ? sec.list : sec.list.slice(0, sec.limit)
              return (
                <div key={sec.key} data-sec={sec.key}>
                  <div className="rp-sec-h"><b>{sec.title}</b>
                    {sec.limit && sec.list.length > sec.limit && <button className="rp-more" onClick={() => setMore(m => ({ ...m, [sec.key]: !m[sec.key] }))}>{more[sec.key] ? 'See less' : 'See more'}</button>}
                  </div>
                  <div className="rp-grid">{list.map((e, i) => tile(e, i, sec.animate))}</div>
                </div>
              )
            })}
          </div>
          <div className="rp-foot">
            {hover ? <><EmojiGlyph emoji={hover.e} size={24} custom={custom} animate /><span className="name">{label(hover.e)}</span></>
              : <><RpIcon d={RP_ICON.smileys} size={20} /><span className="name">Hover over an emoji to see its name</span></>}
            <button className="rp-add" onClick={onAddCustom}>＋ Add custom emoji</button>
          </div>
        </div>
      )}
    </div>
  )
}

function ReactionBar({ messageId, reactions, meId, profiles, senders, onToggle, pickerOpen, onOpenPicker, onClosePicker, reactorsFor, setReactorsFor }) {
  const custom = useCustomEmojis()
  // Slack-style hover card: big emoji, its name, and who reacted.
  const [hover, setHover] = useState(null) // { emoji, x, y }
  const [, setNamesReady] = useState(!!_emojiNames)
  const hoverTimer = useRef(null)
  function showHover(e, emoji) {
    const r = e.currentTarget.getBoundingClientRect()
    clearTimeout(hoverTimer.current)
    hoverTimer.current = setTimeout(() => setHover({ emoji, x: r.left + r.width / 2, y: r.top }), 250)
    if (!_emojiNames) loadEmojiNames().then(() => setNamesReady(true)).catch(() => {})
  }
  function hideHover() { clearTimeout(hoverTimer.current); setHover(null) }
  useEffect(() => () => clearTimeout(hoverTimer.current), [])
  const [manageEmoji, setManageEmoji] = useState(false)
  const mine = reactions.filter(r => r.message_id === messageId)
  // If there isn't ~380px of room below the bar (i.e. the message sits low on
  // screen, which is where people usually react), open the picker UPWARD so
  // it's fully visible without scrolling.
  const barRef = useRef(null)
  const openUp = pickerOpen && barRef.current
    ? (window.innerHeight - barRef.current.getBoundingClientRect().bottom) < 480
    : false

  // group by emoji: count, whether I reacted, and WHO reacted
  const groups = {}
  mine.forEach(r => {
    if (!groups[r.emoji]) groups[r.emoji] = { count: 0, byMe: false, who: [] }
    groups[r.emoji].count++
    if (r.profile_id === meId) groups[r.emoji].byMe = true
    groups[r.emoji].who.push(r.profile_id)
  })
  const entries = Object.entries(groups)
  // Play the animation briefly whenever a reaction is added (by anyone), and while hovered.
  const [burst, setBurst] = useState({})       // emoji -> true while playing
  const [hoverChip, setHoverChip] = useState(null)
  const prevCounts = useRef(null)
  useEffect(() => {
    const now = Object.fromEntries(entries.map(([e, g]) => [e, g.count]))
    const before = prevCounts.current
    prevCounts.current = now
    if (!before) return
    const grew = Object.keys(now).filter(e => now[e] > (before[e] || 0))
    if (!grew.length) return
    setBurst(b => ({ ...b, ...Object.fromEntries(grew.map(e => [e, true])) }))
    const t = setTimeout(() => setBurst(b => { const n = { ...b }; grew.forEach(e => delete n[e]); return n }), 3000)
    return () => clearTimeout(t)
  }, [entries.map(([e, g]) => e + g.count).join('|')]) // eslint-disable-line react-hooks/exhaustive-deps

  const nameOf = (pid) =>
    pid === meId ? 'You' : (senders?.[pid] || profiles?.find(p => p.id === pid)?.full_name || 'Someone')

  // "You, Ann and Bo reacted with 👍" — the native tooltip, free on hover.
  const titleFor = (g, emoji) => {
    const names = g.who.map(nameOf)
    const list = names.length === 1 ? names[0]
      : names.length === 2 ? `${names[0]} and ${names[1]}`
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
    return `${list} reacted with ${emojiLabel(emoji) || emoji}`
  }

  const open = reactorsFor && reactorsFor.messageId === messageId ? reactorsFor.emoji : null

  return (
    <div ref={barRef} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 4, position: 'relative' }}>
      {entries.map(([emoji, g]) => (
        <button key={emoji}
          aria-label={titleFor(g, emoji)}
          onMouseEnter={(e) => { showHover(e, emoji); setHoverChip(emoji) }} onMouseLeave={() => { hideHover(); setHoverChip(null) }} onFocus={(e) => showHover(e, emoji)} onBlur={hideHover}
          onClick={() => { hideHover(); onToggle(messageId, emoji) }}
          onContextMenu={(e) => { e.preventDefault(); hideHover(); setReactorsFor(open === emoji ? null : { messageId, emoji }) }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 14, fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1.3,
            border: '1px solid ' + (g.byMe ? 'var(--accent)' : 'var(--line)'),
            background: g.byMe ? 'var(--accent-bg)' : 'var(--surface)', color: g.byMe ? 'var(--accent)' : 'var(--ink)' }}>
          <EmojiGlyph emoji={emoji} size={20} custom={custom} animate={hoverChip === emoji || !!burst[emoji]} /> {g.count}
        </button>
      ))}
      <button onClick={onOpenPicker} title="Add reaction"
        style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 14, cursor: 'pointer', fontSize: 14, padding: '3px 9px', color: 'var(--ink-soft)', lineHeight: 1.4 }}>
        ☺+
      </button>

      {hover && groups[hover.emoji] && (
        <div role="tooltip" style={{ position: 'fixed', left: Math.max(8, Math.min(hover.x, window.innerWidth - 8)), top: hover.y - 8, transform: 'translate(-50%, -100%)',
          zIndex: 70, pointerEvents: 'none', background: '#1d1d1f', color: '#fff', borderRadius: 10, padding: '10px 12px', maxWidth: 240, textAlign: 'center', boxShadow: '0 8px 24px rgba(0,0,0,.25)' }}>
          <div style={{ display: 'grid', placeItems: 'center', marginBottom: 6, background: '#fff', borderRadius: 8, width: 52, height: 52, marginLeft: 'auto', marginRight: 'auto' }}>
            <EmojiGlyph emoji={hover.emoji} size={36} custom={custom} animate />
          </div>
          <div style={{ fontSize: 12.5, lineHeight: 1.4 }}>
            {(() => {
              const g = groups[hover.emoji]
              const names = g.who.map(nameOf)
              const list = names.length === 1 ? names[0]
                : names.length === 2 ? `${names[0]} and ${names[1]}`
                : names.length <= 6 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
                : `${names.slice(0, 5).join(', ')} and ${names.length - 5} others`
              const label = emojiLabel(hover.emoji)
              return <>{list} reacted with {label ? <b>{label}</b> : 'this'}</>
            })()}
          </div>
        </div>
      )}

      {/* Right-click / long-press a pill for the full list. The hover tooltip
          covers the common case; this covers touch, where hover doesn't exist. */}
      {open && (
        <>
          <div onClick={() => setReactorsFor(null)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div style={{ position: 'absolute', top: 32, left: 0, zIndex: 41, border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface)', boxShadow: '0 6px 20px rgba(0,0,0,.14)', padding: '8px 10px', minWidth: 170 }}>
            <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginBottom: 5 }}>
              <EmojiGlyph emoji={open} size={16} custom={custom} /> · {groups[open].count}
            </div>
            {groups[open].who.map(pid => {
              const n = nameOf(pid)
              return (
                <div key={pid} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '2px 0', fontSize: 12.5 }}>
                  <Av name={n} size={20} fontSize={9} />
                  {n}
                </div>
              )
            })}
          </div>
        </>
      )}

      {pickerOpen && (
        <>
          <div onClick={onClosePicker} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div style={{ position: 'absolute', ...(openUp ? { bottom: 32 } : { top: 32 }), left: 0, zIndex: 41 }}>
            <ReactionPicker custom={custom}
              onPick={(e) => { onToggle(messageId, e); onClosePicker() }}
              onClose={onClosePicker}
              onAddCustom={() => { onClosePicker(); setManageEmoji(true) }} />
          </div>
        </>
      )}
      {manageEmoji && <CustomEmojiModal onClose={() => setManageEmoji(false)} />}
    </div>
  )
}

function ReplyAffordance({ count, unseen = 0, onOpen }) {
  return (
    <button onClick={onOpen} style={{ border: 0, background: 'transparent', color: count ? 'var(--accent)' : 'var(--ink-soft)', fontSize: 12, fontWeight: unseen ? 700 : 600, cursor: 'pointer', padding: '3px 0', marginTop: 3, fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span>{count ? `💬 ${count} repl${count === 1 ? 'y' : 'ies'}` : '↳ Reply'}</span>
      {unseen > 0 && (
        <span style={{ background: 'var(--accent)', color: '#fff', borderRadius: 999, padding: '1px 8px', fontSize: 10.5, fontWeight: 700, lineHeight: '16px' }}>
          {unseen} new
        </span>
      )}
    </button>
  )
}

function ThreadPanel({ parentId, channelId, me, senders, profiles = [], channel, members = [], canModerate = false, onClose, onSeen, highlightId }) {
  // Drag the panel's left edge to resize; the width sticks (localStorage)
  // so it opens the way you like it next time.
  const [panelW, setPanelW] = useState(() => {
    const saved = parseInt(localStorage.getItem('threadPanelW') || '', 10)
    return Number.isFinite(saved) ? Math.min(Math.max(saved, 320), 720) : 380
  })
  const dragRef = useRef(null)
  function startDrag(e) {
    e.preventDefault()
    const startX = e.clientX
    const startW = panelW
    const move = (ev) => {
      const w = Math.min(Math.max(startW + (startX - ev.clientX), 320), 720)
      setPanelW(w)
      dragRef.current = w
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      if (dragRef.current) localStorage.setItem('threadPanelW', String(dragRef.current))
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  const [parent, setParent] = useState(null)
  const [replies, setReplies] = useState([])
  const [names, setNames] = useState(senders || {})
  const replyEditorRef = useRef(null)   // rich reply composer
  const replyHtmlRef = useRef('')
  const [tReactions, setTReactions] = useState([])     // reactions in this thread
  const [reactFor, setReactFor] = useState(null)       // message id with picker open
  const [reactorsFor, setReactorsFor] = useState(null) // {messageId, emoji} reactor list open
  const [loading, setLoading] = useState(true)
  const [tAttachments, setTAttachments] = useState([]) // attachments for parent + replies
  const [pending, setPending] = useState([])           // files staged for the next reply
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState('')
  const [lightbox, setLightbox] = useState({ images: [], index: null })
  const [editingReply, setEditingReply] = useState(null)   // { id, html } or null
  const [editSaving, setEditSaving] = useState(false)
  const endRef = useRef(null)
  const fileInputRef = useRef(null)

  // Edit / delete a reply — mirrors the main message list (author edits own,
  // author or moderator deletes; deletes are soft so the audit trail survives).
  async function deleteReply(r) {
    const isMine = r.sender_id === me.id
    const who = isMine ? 'your reply' : `${nameFor(r.sender_id)}'s reply`
    if (!window.confirm(`Delete ${who}? It disappears for everyone. This can't be undone from the app.`)) return
    let reason = null
    if (!isMine) { reason = window.prompt('Reason for removing this reply? (optional, saved to the audit trail)'); if (reason === null) return }
    const prev = replies
    setReplies(cur => cur.filter(x => x.id !== r.id))   // optimistic
    const { error } = await supabase.from('messages').update({ deleted_at: new Date().toISOString(), deleted_by: me.id, deleted_reason: reason || null }).eq('id', r.id)
    if (error) { setReplies(prev); setUploadErr('Could not delete: ' + error.message) }
  }
  function openReplyEdit(r) {
    if (r.sender_id !== me.id) return
    setEditingReply({ id: r.id, html: r.body || '' })
  }
  async function saveReplyEdit(rawHtml) {
    if (!editingReply) return
    const body = sanitizeHtml(rawHtml)
    if (!htmlToText(rawHtml)) { setUploadErr("A reply can't be empty. Delete it instead."); return }
    const id = editingReply.id, now = new Date().toISOString()
    const prev = replies
    setReplies(cur => cur.map(x => x.id === id ? { ...x, body, edited_at: now } : x))   // optimistic
    setEditSaving(true); setUploadErr('')
    const { error } = await supabase.from('messages').update({ body, edited_at: now }).eq('id', id).eq('sender_id', me.id)
    setEditSaving(false)
    if (error) { setReplies(prev); setUploadErr('Could not save edit: ' + error.message); return }
    setEditingReply(null)
  }

  // The realtime attachment handler needs the current thread message ids
  // without resubscribing every time a reply lands.
  const threadIdsRef = useRef(new Set([parentId]))
  useEffect(() => {
    threadIdsRef.current = new Set([parentId, ...replies.map(r => r.id)])
  }, [parentId, replies])

  const { typerNames, notifyTyping, stopTyping } = useTyping(`typing:thread:${parentId}`, me.id, me.full_name)

  useEffect(() => {
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
      if (miss.length) {
        const { data } = await supabase.from('profiles').select('id, full_name, avatar_url').in('id', miss); registerPhotos(data)
        if (data) setNames(prev => { const n = { ...prev }; data.forEach(p => n[p.id] = p.full_name); return n })
      }
      // Attachments + reactions for the parent and every reply.
      const msgIds = [parentId, ...(rRes.data || []).map(r => r.id)]
      const [{ data: atts }, { data: reacts }] = await Promise.all([
        supabase.from('message_attachments').select('*').in('message_id', msgIds),
        supabase.from('message_reactions').select('*').in('message_id', msgIds),
      ])
      if (active) { setTAttachments(atts || []); setTReactions(reacts || []) }
      setLoading(false)
      // Opening the thread means you've seen what's in it.
      onSeen?.(parentId)
    })()
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentId])

  // Unfiltered, same reasoning as ChannelPane. Check parent_id in the handler.
  useEffect(() => {
    const ch = supabase.channel(`thread:${parentId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          if (payload.new.parent_id !== parentId) return
          setReplies(prev => prev.some(x => x.id === payload.new.id) ? prev : [...prev, payload.new])
          // The panel is open, so the new reply is seen the moment it lands.
          onSeen?.(parentId)
        })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_attachments' },
        (payload) => {
          if (!threadIdsRef.current.has(payload.new.message_id)) return
          setTAttachments(prev => prev.some(a => a.id === payload.new.id) ? prev : [...prev, payload.new])
        })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_reactions' },
        (payload) => {
          if (!threadIdsRef.current.has(payload.new.message_id)) return
          setTReactions(prev => prev.some(r => r.id === payload.new.id) ? prev : [...prev, payload.new])
        })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'message_reactions' },
        (payload) => { setTReactions(prev => prev.filter(r => r.id !== payload.old.id)) })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentId])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [replies.length])

  // Deep-linked reply: flash it once replies load.
  useEffect(() => {
    if (loading || !highlightId) return
    const el = document.getElementById('thread-msg-' + highlightId)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [loading, highlightId])

  function addFiles(fileList) {
    const arr = Array.from(fileList || [])
    const tooBig = arr.find(f => f.size > MAX_FILE_BYTES)
    if (tooBig) { setUploadErr(`"${tooBig.name}" is over 50MB.`); return }
    setUploadErr('')
    setPending(prev => [...prev, ...arr.map(f => ({ file: f, name: f.name, type: f.type }))])
  }
  const removePending = (idx) => setPending(prev => prev.filter((_, i) => i !== idx))

  async function sendReply() {
    const rawHtml = replyHtmlRef.current || ''
    const plain = htmlToText(rawHtml)
    const body = sanitizeHtml(rawHtml)
    const filesToSend = pending
    if (!plain && filesToSend.length === 0) return
    setPending([]); stopTyping(); setUploadErr('')
    if (filesToSend.length) setUploading(true)

    const mentionedIds = extractMentions(plain, profiles).filter(id => id !== me.id)

    const temp = { id: 'temp-' + Date.now(), channel_id: channelId, sender_id: me.id, body: body || '', parent_id: parentId, created_at: new Date().toISOString(), _optimistic: true }
    setReplies(prev => [...prev, temp])

    const { data, error } = await supabase.from('messages').insert({ channel_id: channelId, sender_id: me.id, body: body || '', parent_id: parentId }).select().single()
    if (error) { setReplies(prev => prev.filter(m => m.id !== temp.id)); setPending(filesToSend); setUploading(false); setUploadErr('Could not send: ' + error.message); return }

    // Only clear the editor once the reply actually landed.
    replyEditorRef.current?.clear(); replyHtmlRef.current = ''

    // Upload staged files and attach them to the reply.
    if (filesToSend.length) {
      try {
        const rows = []
        for (const p of filesToSend) {
          const meta = await uploadChatFile(p.file, channelId, me.id)
          rows.push({ message_id: data.id, channel_id: channelId, uploader_id: me.id, ...meta })
        }
        if (rows.length) {
          const { data: attData } = await supabase.from('message_attachments').insert(rows).select()
          if (attData) setTAttachments(prev => {
            const have = new Set(prev.map(a => a.id))
            return [...prev, ...attData.filter(a => !have.has(a.id))]
          })
        }
      } catch (e) { setUploadErr('Upload failed: ' + e.message) }
      setUploading(false)
    }

    setReplies(prev => prev.filter(m => m.id !== temp.id && m.id !== data.id).concat(data))
    onSeen?.(parentId)

    // Add mentioned non-members, then route notifications through prefs.
    if (mentionedIds.length) {
      const addedIds = mentionedIds.filter(id => !members.includes(id))
      if (addedIds.length && !channel?.is_dm) {
        const { error: memberError } = await supabase.from('channel_members')
          .insert(addedIds.map(pid => ({ channel_id: channelId, profile_id: pid })))
        if (memberError) throw memberError

        await notifyChannelAdded({
          recipientIds: addedIds, actorId: me.id, actorName: me.full_name,
          channelName: channel?.name, isDm: false, channelId,
        })
      }
    }

    // Reply notifications (parent author, earlier repliers, @mentions, channel
    // members) are created by the database when the reply is saved.
  }

  async function toggleThreadReaction(messageId, emoji) {
    const mine = tReactions.find(r => r.message_id === messageId && r.profile_id === me.id && r.emoji === emoji)
    setReactFor(null)
    if (mine) {
      setTReactions(prev => prev.filter(r => r !== mine))
      await supabase.from('message_reactions').delete().eq('message_id', messageId).eq('profile_id', me.id).eq('emoji', emoji)
    } else {
      const optimistic = { id: 'temp-' + Date.now(), message_id: messageId, profile_id: me.id, emoji }
      setTReactions(prev => [...prev, optimistic])
      const { data, error } = await supabase.from('message_reactions').insert({ message_id: messageId, profile_id: me.id, emoji }).select().single()
      if (error && error.code !== '23505') setTReactions(prev => prev.filter(r => r !== optimistic))
      else if (data) setTReactions(prev => prev.map(r => r === optimistic ? data : r))
    }
  }

  const nameFor = (id) => id === me.id ? 'You' : (names[id] || 'Someone')

  const attsFor = (msgId) => tAttachments.filter(a => a.message_id === msgId)
  const openImage = (msgId) => (url) => {
    const imgs = tAttachments
      .filter(x => x.message_id === msgId && (x.file_type || '').startsWith('image/'))
      .map(x => x.public_url)
    const idx = Math.max(0, imgs.indexOf(url))
    setLightbox({ images: imgs, index: idx })
  }

  return (
    <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: panelW, maxWidth: '90%', background: 'var(--surface)', borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 24px rgba(0,0,0,.08)', zIndex: 20 }}>
      {/* drag handle on the left edge */}
      <div onMouseDown={startDrag} title="Drag to resize"
        style={{ position: 'absolute', left: -4, top: 0, bottom: 0, width: 9, cursor: 'col-resize', zIndex: 21 }} />
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
              <RichContent html={parent.body} highlightMentions />
              {attsFor(parent.id).map(a => (
                <AttachmentView key={a.id} att={a} onOpenImage={openImage(parent.id)} />
              ))}
              <ReactionBar messageId={parent.id} reactions={tReactions} meId={me.id}
                profiles={profiles} senders={names}
                onToggle={toggleThreadReaction}
                pickerOpen={reactFor === parent.id}
                onOpenPicker={() => setReactFor(reactFor === parent.id ? null : parent.id)}
                onClosePicker={() => setReactFor(null)}
                reactorsFor={reactorsFor} setReactorsFor={setReactorsFor} />
            </div>}
            <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 8 }}>{replies.length} repl{replies.length === 1 ? 'y' : 'ies'}</div>
            {replies.map(r => {
              const flash = highlightId === r.id
              const canEdit = !r._optimistic && r.sender_id === me.id
              const canDelete = !r._optimistic && (r.sender_id === me.id || canModerate)
              return (
                <div key={r.id} id={'thread-msg-' + r.id} className="chat-msg-row"
                  style={{ display: 'flex', gap: 9, marginBottom: 10, opacity: r._optimistic ? 0.6 : 1, position: 'relative',
                    background: flash ? 'var(--accent-bg)' : 'transparent',
                    outline: flash ? '2px solid var(--accent)' : 'none',
                    borderRadius: flash ? 8 : 0, padding: flash ? '5px 6px' : 0 }}>
                  <Av name={nameFor(r.sender_id)} size={28} fontSize={11} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}><b style={{ fontSize: 12.5 }}>{nameFor(r.sender_id)}</b><span style={{ fontSize: 10.5, color: 'var(--ink-soft)' }}>{timeLabel(r.created_at)}</span>{r.edited_at && <span style={{ fontSize: 10, color: 'var(--ink-soft)', fontStyle: 'italic' }}>(edited)</span>}</div>
                    <MessageBody html={r.body} style={{ fontSize: 13.5 }} />
                    {attsFor(r.id).map(a => (
                      <AttachmentView key={a.id} att={a} onOpenImage={openImage(r.id)} />
                    ))}
                    {!r._optimistic && (
                      <ReactionBar messageId={r.id} reactions={tReactions} meId={me.id}
                        profiles={profiles} senders={names}
                        onToggle={toggleThreadReaction}
                        pickerOpen={reactFor === r.id}
                        onOpenPicker={() => setReactFor(reactFor === r.id ? null : r.id)}
                        onClosePicker={() => setReactFor(null)}
                        reactorsFor={reactorsFor} setReactorsFor={setReactorsFor} />
                    )}
                  </div>
                  {canEdit && (
                    <button className="chat-msg-delete" title="Edit your reply" onClick={() => openReplyEdit(r)}
                      style={{ position: 'absolute', top: 0, right: canDelete ? 30 : 0, border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 6, cursor: 'pointer', fontSize: 11, lineHeight: 1, padding: '3px 5px', color: 'var(--ink-soft)' }}>✏️</button>
                  )}
                  {canDelete && (
                    <button className="chat-msg-delete" title={r.sender_id === me.id ? 'Delete your reply' : 'Remove this reply'} onClick={() => deleteReply(r)}
                      style={{ position: 'absolute', top: 0, right: 0, border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 6, cursor: 'pointer', fontSize: 11, lineHeight: 1, padding: '3px 5px', color: 'var(--failed)' }}>🗑</button>
                  )}
                </div>
              )
            })}
            <div ref={endRef} />
          </>
        )}
      </div>
      <TypingLine names={typerNames} />
      <div style={{ borderTop: '1px solid var(--line)', padding: 12, flex: 'none' }}>
        {uploadErr && <div style={{ color: 'var(--failed)', fontSize: 12, marginBottom: 6 }}>{uploadErr}</div>}
        {pending.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {pending.map((p, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: 'var(--canvas)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }}>
                <span>{p.type?.startsWith('image/') ? '🖼' : p.type?.startsWith('video/') ? '🎬' : '📄'}</span>
                <span style={{ maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                <button onClick={() => removePending(i)} style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--ink-soft)', fontSize: 14 }}>✕</button>
              </div>
            ))}
          </div>
        )}
        {uploading && <div style={{ fontSize: 12, color: 'var(--accent)', marginBottom: 6 }}>Uploading…</div>}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }}
            onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
          <button type="button" onClick={() => fileInputRef.current?.click()} title="Attach file"
            style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 8, cursor: 'pointer', fontSize: 16, padding: '7px 10px', flex: 'none' }}>📎</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <RichEditor
              variant="chat"
              editorRef={replyEditorRef}
              profiles={profiles}
              submitOnEnter
              onChange={(html) => { replyHtmlRef.current = html; notifyTyping() }}
              onSubmit={sendReply}
              onPasteFiles={(files) => addFiles(files)}
              placeholder="Reply… (@name to mention, paste files)"
            />
          </div>
          <button className="btn btn-primary" onClick={sendReply} disabled={uploading} style={{ alignSelf: 'flex-end' }}>Reply</button>
        </div>
      </div>
      {lightbox.index != null && (
        <Lightbox images={lightbox.images} index={lightbox.index}
          onClose={() => setLightbox({ images: [], index: null })}
          onNav={(d) => setLightbox(lb => ({ ...lb, index: (lb.index + d + lb.images.length) % lb.images.length }))} />
      )}
      {editingReply && (
        <EditMessageModal initialHtml={editingReply.html} profiles={profiles} saving={editSaving}
          onCancel={() => setEditingReply(null)} onSave={saveReplyEdit} />
      )}
    </div>
  )
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
                <Av name={p.full_name} size={26} fontSize={10.5} />
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
                <Av name={p.full_name} size={26} fontSize={10.5} />
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
  // Start a DM with one or MORE people (group DM, Slack-style).
  // Reuses an existing DM with exactly the same set of people if one exists.
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState(new Set())
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const others = profiles.filter(p => p.id !== me.id)
  const matches = search.trim()
    ? others.filter(p => p.full_name?.toLowerCase().includes(search.toLowerCase()))
    : others

  const toggle = (id) => setPicked(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  async function start() {
    const personIds = [...picked]
    if (!personIds.length) return
    setSaving(true); setErr('')
    try {
      // Look for an existing DM whose member set is EXACTLY me + the picked
      // people — a 1:1 with Corinne is a different conversation from
      // me+Corinne+Alyssa, so partial overlaps don't count.
      const wanted = new Set([me.id, ...personIds])
      const { data: myDms } = await supabase.from('channel_members')
        .select('channel_id, channels!inner(is_dm)')
        .eq('profile_id', me.id)
      const myDmIds = (myDms || []).filter(r => r.channels?.is_dm).map(r => r.channel_id)

      if (myDmIds.length) {
        const { data: allMems } = await supabase.from('channel_members')
          .select('channel_id, profile_id').in('channel_id', myDmIds)
        const byChannel = {}
        ;(allMems || []).forEach(m => { (byChannel[m.channel_id] = byChannel[m.channel_id] || new Set()).add(m.profile_id) })
        const existing = Object.entries(byChannel).find(([, set]) =>
          set.size === wanted.size && [...wanted].every(id => set.has(id)))
        if (existing) { onCreated(existing[0]); return }
      }

      // None exists — create the conversation with everyone in it.
      const firstNames = [me.id, ...personIds]
        .map(id => (profiles.find(p => p.id === id)?.full_name || me.full_name || 'DM').split(' ')[0])
      const { data: ch, error: ce } = await supabase.from('channels')
        .insert({ name: firstNames.join(' / '), is_dm: true, created_by: me.id }).select().single()
      if (ce) throw ce
      const { error: me2 } = await supabase.from('channel_members')
        .insert([me.id, ...personIds].map(pid => ({ channel_id: ch.id, profile_id: pid })))
      if (me2) throw me2
      await notifyChannelAdded({
        recipientIds: personIds,
        actorId: me.id,
        actorName: me.full_name,
        channelName: personIds.length > 1 ? 'a group message' : 'Direct message',
        isDm: true,
        channelId: ch.id,
      })
      onCreated(ch.id)
    } catch (e) { setErr(e.message); setSaving(false) }
  }

  const pickedNames = [...picked].map(id => profiles.find(p => p.id === id)?.full_name?.split(' ')[0]).filter(Boolean)

  return (
    <div className="modal-back open" onClick={e => { if (e.target.classList.contains('modal-back')) onClose() }}>
      <div className="modal" style={{ width: 440 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600 }}>New direct message</h3>
        <p className="page-sub" style={{ marginBottom: 16 }}>Pick one person — or several for a group conversation.</p>
        {err && <div className="login-err" style={{ marginBottom: 14 }}>{err}</div>}

        {picked.size > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {[...picked].map(id => {
              const p = profiles.find(x => x.id === id)
              return (
                <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--accent-bg)', color: 'var(--accent)', borderRadius: 999, padding: '4px 10px', fontSize: 12.5, fontWeight: 600 }}>
                  {p?.full_name}
                  <button onClick={() => toggle(id)} style={{ border: 0, background: 'transparent', color: 'var(--accent)', cursor: 'pointer', fontSize: 13, padding: 0, lineHeight: 1 }}>✕</button>
                </span>
              )
            })}
          </div>
        )}

        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search people…" autoFocus
          style={{ width: '100%', padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', marginBottom: 10, boxSizing: 'border-box' }} />

        <div style={{ border: '1px solid var(--line)', borderRadius: 8, maxHeight: 280, overflowY: 'auto' }}>
          {matches.length === 0 && <div className="page-sub" style={{ padding: 14, fontSize: 13 }}>No people found.</div>}
          {matches.map(p => {
            const isPicked = picked.has(p.id)
            return (
              <button key={p.id} type="button" disabled={saving} onClick={() => toggle(p.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', border: 0, borderBottom: '1px solid var(--line-soft)', background: isPicked ? 'var(--accent-bg)' : 'transparent', cursor: 'pointer', padding: '10px 12px', fontFamily: 'inherit' }}>
                <Av name={p.full_name} size={30} fontSize={12} />
                <span style={{ fontSize: 14, fontWeight: 500, flex: 1 }}>{p.full_name}</span>
                {isPicked && <span style={{ color: 'var(--accent)', fontWeight: 700 }}>✓</span>}
              </button>
            )
          })}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" style={{ flex: 1.4 }} onClick={start} disabled={saving || picked.size === 0}>
            {saving ? 'Starting…'
              : picked.size === 0 ? 'Start conversation'
                : picked.size === 1 ? `Message ${pickedNames[0]}`
                  : `Start group (${picked.size + 1} people)`}
          </button>
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
      await notifyChannelAdded({
        recipientIds: [...members],
        actorId: me.id,
        actorName: me.full_name,
        channelName: nm,
        isDm: false,
        channelId: ch.id,
      })
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
