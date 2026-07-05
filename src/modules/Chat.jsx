import React, { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

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

      {activeId
        ? <ChannelPane key={activeId} channelId={activeId} me={me} isAdmin={isAdmin} channel={channels.find(c => c.id === activeId)} profiles={profiles} />
        : <div style={{ display: 'grid', placeItems: 'center', color: 'var(--ink-soft)' }}>Select a channel</div>}

      {showCreate && <CreateChannelModal me={me} profiles={profiles}
        onClose={() => setShowCreate(false)}
        onCreated={(id) => { setShowCreate(false); load(); setActiveId(id) }} />}
    </div>
  )
}

function ChannelPane({ channelId, me, isAdmin, channel, profiles }) {
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
  const bottomRef = useRef(null)

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

  // realtime: new messages + new acknowledgments
  useEffect(() => {
    const ch = supabase
      .channel(`chan:${channelId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `channel_id=eq.${channelId}` },
        async (payload) => {
          const m = payload.new
          setMessages(prev => prev.some(x => x.id === m.id) ? prev : [...prev, m])
          if (m.sender_id && !(m.sender_id in senders)) {
            const { data } = await supabase.from('profiles').select('id, full_name').eq('id', m.sender_id).single()
            if (data) setSenders(prev => ({ ...prev, [data.id]: data.full_name }))
          }
        })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_acknowledgments' },
        (payload) => { setAcks(prev => prev.some(a => a.id === payload.new.id) ? prev : [...prev, payload.new]) })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [channelId, senders])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function send() {
    const body = text.trim()
    if (!body) return
    const isHere = /(^|\s)@here(\s|$)/i.test(body)
    const willRequireAck = isAdmin && requireAck
    setText(''); setRequireAck(false)
    const temp = { id: 'temp-' + Date.now(), channel_id: channelId, sender_id: me.id, body, created_at: new Date().toISOString(), requires_ack: willRequireAck, is_here: isHere, _optimistic: true }
    setMessages(prev => [...prev, temp])
    const { data, error } = await supabase.from('messages')
      .insert({ channel_id: channelId, sender_id: me.id, body, requires_ack: willRequireAck, is_here: isHere })
      .select().single()
    if (error) {
      setErr(error.message)
      setMessages(prev => prev.filter(m => m.id !== temp.id)); setText(body)
      return
    }
    setMessages(prev => prev.filter(m => m.id !== temp.id && m.id !== data.id).concat(data))
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
        <b style={{ fontSize: 15 }}># {channel?.name}</b>
        {channel?.description && <div className="page-sub" style={{ fontSize: 12.5 }}>{channel.description}</div>}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>
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
                  <ReplyAffordance count={replyCount} onOpen={() => setThreadFor(m.id)} />
                </div>
              </div>
            )
          }) })()}
        <div ref={bottomRef} />
      </div>

      <div style={{ borderTop: '1px solid var(--line)', padding: '10px 16px' }}>
        {isAdmin && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8, fontSize: 12.5, color: requireAck ? 'var(--accent)' : 'var(--ink-soft)', cursor: 'pointer', fontWeight: requireAck ? 600 : 400 }}>
            <input type="checkbox" checked={requireAck} onChange={e => setRequireAck(e.target.checked)} />
            Post as <b>@update</b> — require everyone to confirm they've read it
          </label>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <textarea value={text} onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            placeholder={requireAck ? 'Write your update…' : `Message #${channel?.name || ''}  (type @here to flag everyone)`}
            rows={1}
            style={{ flex: 1, resize: 'none', padding: '10px 12px', border: '1px solid ' + (requireAck ? 'var(--accent)' : 'var(--line)'), borderRadius: 8, fontSize: 14, fontFamily: 'inherit', outline: 'none', maxHeight: 120 }} />
          <button className={'btn ' + (requireAck ? 'btn-cta' : 'btn-primary')} onClick={send} disabled={!text.trim()}>{requireAck ? 'Post update' : 'Send'}</button>
        </div>
      </div>

      {trackFor && <TrackPanel messageId={trackFor} me={me} members={members} profiles={profiles} acks={acks} onClose={() => setTrackFor(null)} />}
      {threadFor && <ThreadPanel parentId={threadFor} channelId={channelId} me={me} senders={senders} onClose={() => setThreadFor(null)} />}
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

function ThreadPanel({ parentId, channelId, me, senders, onClose }) {
  const [parent, setParent] = React.useState(null)
  const [replies, setReplies] = React.useState([])
  const [names, setNames] = React.useState(senders || {})
  const [text, setText] = React.useState('')
  const [loading, setLoading] = React.useState(true)
  const endRef = React.useRef(null)

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
    setText('')
    const temp = { id: 'temp-' + Date.now(), channel_id: channelId, sender_id: me.id, body, parent_id: parentId, created_at: new Date().toISOString(), _optimistic: true }
    setReplies(prev => [...prev, temp])
    const { data, error } = await supabase.from('messages').insert({ channel_id: channelId, sender_id: me.id, body, parent_id: parentId }).select().single()
    if (error) { setReplies(prev => prev.filter(m => m.id !== temp.id)); setText(body); return }
    setReplies(prev => prev.filter(m => m.id !== temp.id && m.id !== data.id).concat(data))
  }

  const nameFor = (id) => id === me.id ? 'You' : (names[id] || 'Someone')

  return (
    <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 380, maxWidth: '90%', background: 'var(--surface)', borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 24px rgba(0,0,0,.08)', zIndex: 20 }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <b style={{ fontSize: 14 }}>Thread</b>
        <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 9px' }} onClick={onClose}>Close</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
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
      <div style={{ borderTop: '1px solid var(--line)', padding: 12, display: 'flex', gap: 8 }}>
        <textarea value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply() } }}
          placeholder="Reply…" rows={1}
          style={{ flex: 1, resize: 'none', padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13.5, fontFamily: 'inherit', outline: 'none', maxHeight: 100 }} />
        <button className="btn btn-primary" onClick={sendReply} disabled={!text.trim()}>Reply</button>
      </div>
    </div>
  )
}

// Render @here / @update mentions with a highlight
function renderBody(body) {
  const parts = String(body).split(/(@here|@update)/gi)
  return parts.map((p, i) =>
    /^@here$/i.test(p) || /^@update$/i.test(p)
      ? <span key={i} style={{ color: 'var(--accent)', fontWeight: 700, background: 'var(--accent-bg)', borderRadius: 4, padding: '0 3px' }}>{p}</span>
      : <React.Fragment key={i}>{p}</React.Fragment>
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
