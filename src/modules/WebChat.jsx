import React, { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

// Web Chat — the inbox for conversations coming from opsiscx.com.
//
// Turri (the site assistant) answers first and hands off to a person. This is
// where that handoff lands, where you go "on chat", and where you answer.
//
// Three things worth knowing before editing:
//
// 1. PRESENCE IS EARNED. The site only says "a person is on chat" while this
//    page is open and heartbeating web_chat_presence.last_seen_at (every 30s),
//    or while a manual window set by set_chat_availability() is still running.
//    Both expire on their own, so the site can never promise a person who
//    isn't there. Close this tab and you go offline within two minutes.
//
// 2. LIVE CHAT IS OFF UNTIL YOU TURN IT ON. web_chat_settings.live_enabled is
//    false while there is nowhere to reply from. The admin switch below flips
//    it. With it off, every visitor gets the honest leave-a-message path.
//
// 3. THE VISITOR POLLS. A staff reply is a plain insert into web_messages;
//    their widget picks it up within a few seconds. No realtime needed, and
//    deliberately no anon access to these tables.
//
// Backend: edge functions chat-reply / chat-presence / calculator-lead.
// Spec: project doc claude/website-chat-backend-and-inbox-spec-2026-08-29.md

const HEARTBEAT_MS = 30_000
const LIST_POLL_MS = 10_000
const THREAD_POLL_MS = 5_000

const STATUS_LABEL = {
  bot: 'With Turri',
  waiting: 'Waiting for a person',
  live: 'Live',
  closed: 'Closed',
}
const STATUS_TONE = {
  bot: { bg: 'rgba(120,120,120,.12)', fg: 'var(--text-dim, #667)' },
  waiting: { bg: 'rgba(220,38,38,.12)', fg: '#DC2626' },
  live: { bg: 'rgba(16,185,129,.14)', fg: '#059669' },
  closed: { bg: 'rgba(120,120,120,.10)', fg: 'var(--text-dim, #889)' },
}

const selectStyle = {
  padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 8,
  fontSize: 13, fontFamily: 'inherit', background: 'var(--surface)',
}

const ago = (ts) => {
  if (!ts) return ''
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export default function WebChat() {
  const { user, isAdmin } = useAuth()
  const [tab, setTab] = useState('inbox')

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h1 className="page-title">Web Chat</h1>
        <p className="page-sub">
          Conversations from opsiscx.com. Turri answers first and hands off to you.
        </p>
      </div>

      <AvailabilityBar userId={user?.id} isAdmin={isAdmin} />

      <div style={{ display: 'flex', gap: 6, margin: '18px 0', flexWrap: 'wrap' }}>
        <button className={'btn ' + (tab === 'inbox' ? 'btn-primary' : 'btn-ghost')} onClick={() => setTab('inbox')}>Inbox</button>
        <button className={'btn ' + (tab === 'gaps' ? 'btn-primary' : 'btn-ghost')} onClick={() => setTab('gaps')}>Unanswered</button>
        {isAdmin && (
          <button className={'btn ' + (tab === 'knowledge' ? 'btn-primary' : 'btn-ghost')} onClick={() => setTab('knowledge')}>What Turri knows</button>
        )}
      </div>

      {tab === 'inbox' && <Inbox userId={user?.id} />}
      {tab === 'gaps' && <Unanswered isAdmin={isAdmin} />}
      {tab === 'knowledge' && isAdmin && <Knowledge />}
    </div>
  )
}

/* ---------------------------------------------------------------- presence */

function AvailabilityBar({ userId, isAdmin }) {
  const [on, setOn] = useState(false)
  const [until, setUntil] = useState(null)
  const [liveEnabled, setLiveEnabled] = useState(null)
  const [busy, setBusy] = useState(false)
  const timer = useRef(null)

  const load = useCallback(async () => {
    if (!userId) return
    const [{ data: pres }, { data: cfg }] = await Promise.all([
      supabase.from('web_chat_presence').select('available, available_until').eq('profile_id', userId).maybeSingle(),
      supabase.from('web_chat_settings').select('live_enabled').eq('id', true).maybeSingle(),
    ])
    setOn(!!pres?.available)
    setUntil(pres?.available_until || null)
    setLiveEnabled(cfg?.live_enabled ?? null)
  }, [userId])

  useEffect(() => { load() }, [load])

  // Heartbeat while on. This is what keeps the site honest: stop, and presence
  // lapses within two minutes on its own.
  useEffect(() => {
    if (!on || !userId) { if (timer.current) clearInterval(timer.current); return }
    const beat = () => supabase.from('web_chat_presence')
      .update({ last_seen_at: new Date().toISOString() }).eq('profile_id', userId)
    beat()
    timer.current = setInterval(beat, HEARTBEAT_MS)
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [on, userId])

  const setAvailability = async (minutes) => {
    setBusy(true)
    const { error } = await supabase.rpc('set_chat_availability', { p_minutes: minutes })
    setBusy(false)
    if (error) { alert('Could not change availability: ' + error.message); return }
    await load()
  }

  const toggleLive = async () => {
    const next = !liveEnabled
    if (next && !window.confirm('Turn live chat on? Visitors will be told a person is available whenever someone is on chat.')) return
    const { error } = await supabase.from('web_chat_settings')
      .update({ live_enabled: next, updated_at: new Date().toISOString() }).eq('id', true)
    if (error) { alert('Could not change that: ' + error.message); return }
    setLiveEnabled(next)
  }

  return (
    <div className="card" style={{ padding: 16, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{
          width: 10, height: 10, borderRadius: 999, flexShrink: 0,
          background: on ? '#10B981' : 'var(--line)',
          boxShadow: on ? '0 0 0 4px rgba(16,185,129,.18)' : 'none',
        }} />
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>
            {on ? 'You are on chat' : 'You are not on chat'}
          </div>
          <div className="page-sub" style={{ fontSize: 12, margin: 0 }}>
            {on
              ? (until ? `Until ${new Date(until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Closing this page also ends it.` : 'Ends when you close this page.')
              : 'Visitors are offered a message instead of a live person.'}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', flexWrap: 'wrap' }}>
        {on ? (
          <button className="btn btn-ghost" disabled={busy} onClick={() => setAvailability(0)}>Go off chat</button>
        ) : (
          <>
            <button className="btn btn-primary" disabled={busy} onClick={() => setAvailability(60)}>On chat · 1h</button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => setAvailability(240)}>4h</button>
          </>
        )}
      </div>

      {isAdmin && liveEnabled !== null && (
        <div style={{ width: '100%', borderTop: '1px solid var(--line)', paddingTop: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span className="page-sub" style={{ margin: 0, fontSize: 12 }}>
            {liveEnabled
              ? 'Live chat is ON site-wide. Visitors can be handed to a person whenever someone is on chat.'
              : 'Live chat is OFF site-wide. Every visitor gets the leave-a-message path, whoever is on chat.'}
          </span>
          <button className={'btn ' + (liveEnabled ? 'btn-ghost' : 'btn-primary')} onClick={toggleLive} style={{ marginLeft: 'auto' }}>
            {liveEnabled ? 'Turn live chat off' : 'Turn live chat on'}
          </button>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------- inbox */

function Inbox({ userId }) {
  const [rows, setRows] = useState([])
  const [filter, setFilter] = useState('active')
  const [openId, setOpenId] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    let q = supabase.from('web_conversations')
      .select('id, status, visitor_name, visitor_email, visitor_company, page, staff_unread, last_message_at, escalated_at, assignee_id, deal_id')
      .order('last_message_at', { ascending: false }).limit(100)
    if (filter === 'active') q = q.in('status', ['waiting', 'live'])
    else if (filter !== 'all') q = q.eq('status', filter)
    const { data } = await q
    setRows(data || [])
    setLoading(false)
  }, [filter])

  useEffect(() => { load(); const t = setInterval(load, LIST_POLL_MS); return () => clearInterval(t) }, [load])

  if (openId) {
    return <Thread id={openId} userId={userId} onBack={() => { setOpenId(null); load() }} />
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <select value={filter} onChange={e => setFilter(e.target.value)} style={selectStyle}>
          <option value="active">Needs a person (waiting + live)</option>
          <option value="all">All</option>
          <option value="bot">With Turri</option>
          <option value="closed">Closed</option>
        </select>
        <span className="page-sub" style={{ fontSize: 12, marginLeft: 'auto' }}>
          {rows.length} conversation{rows.length !== 1 ? 's' : ''}
        </span>
      </div>

      {loading ? (
        <div className="card"><div className="page-sub" style={{ textAlign: 'center', padding: 26 }}>Loading…</div></div>
      ) : rows.length === 0 ? (
        <div className="card"><div className="page-sub" style={{ textAlign: 'center', padding: 26 }}>
          No conversations here yet.
        </div></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map(r => {
            const tone = STATUS_TONE[r.status] || STATUS_TONE.bot
            return (
              <button key={r.id} onClick={() => setOpenId(r.id)} className="card"
                style={{ textAlign: 'left', border: '1px solid var(--line)', cursor: 'pointer', padding: 14, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ background: tone.bg, color: tone.fg, fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap' }}>
                  {STATUS_LABEL[r.status] || r.status}
                </span>
                <div style={{ minWidth: 200, flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>
                    {r.visitor_name || r.visitor_company || r.visitor_email || 'Anonymous visitor'}
                  </div>
                  <div className="page-sub" style={{ fontSize: 12, margin: 0 }}>
                    {[r.visitor_company, r.visitor_email].filter(Boolean).join(' · ') || (r.page || '')}
                  </div>
                </div>
                {r.staff_unread > 0 && (
                  <span style={{ background: '#DC2626', color: '#fff', fontSize: 11, fontWeight: 700, minWidth: 18, height: 18, borderRadius: 9, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px' }}>
                    {r.staff_unread}
                  </span>
                )}
                <span className="page-sub" style={{ fontSize: 12, margin: 0, whiteSpace: 'nowrap' }}>{ago(r.last_message_at)}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ thread */

function Thread({ id, userId, onBack }) {
  const [conv, setConv] = useState(null)
  const [msgs, setMsgs] = useState([])
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const endRef = useRef(null)

  const load = useCallback(async () => {
    const [{ data: c }, { data: m }] = await Promise.all([
      supabase.from('web_conversations')
        .select('id, status, visitor_name, visitor_email, visitor_company, visitor_phone, page, assignee_id, deal_id, created_at')
        .eq('id', id).maybeSingle(),
      supabase.from('web_messages')
        .select('id, seq, role, body, created_at, deferred')
        .eq('conversation_id', id).order('seq', { ascending: true }).limit(500),
    ])
    setConv(c || null)
    setMsgs(m || [])
  }, [id])

  useEffect(() => { load(); const t = setInterval(load, THREAD_POLL_MS); return () => clearInterval(t) }, [load])
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [msgs.length])

  // Opening a thread clears its unread count.
  useEffect(() => {
    if (conv && conv.id) supabase.from('web_conversations').update({ staff_unread: 0 }).eq('id', conv.id)
  }, [conv?.id])

  const send = async () => {
    const text = body.trim()
    if (!text || sending) return
    setSending(true)
    const { error } = await supabase.from('web_messages')
      .insert({ conversation_id: id, role: 'staff', sender_id: userId, body: text })
    if (error) { setSending(false); alert('Could not send: ' + error.message); return }
    // first staff reply takes the conversation live and assigns it
    await supabase.from('web_conversations').update({
      status: 'live',
      assignee_id: conv?.assignee_id || userId,
    }).eq('id', id)
    setBody('')
    setSending(false)
    load()
  }

  const close = async () => {
    if (!window.confirm('Close this conversation?')) return
    await supabase.from('web_conversations')
      .update({ status: 'closed', closed_at: new Date().toISOString(), close_reason: 'closed by staff' })
      .eq('id', id)
    onBack()
  }

  if (!conv) return <div className="card"><div className="page-sub" style={{ textAlign: 'center', padding: 26 }}>Loading…</div></div>

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <button className="btn btn-ghost" onClick={onBack}>← Back</button>
        {conv.deal_id && (
          <a className="btn btn-ghost" href={`/sales?deal=${conv.deal_id}`}>Open deal</a>
        )}
        <button className="btn btn-ghost" onClick={close} style={{ marginLeft: 'auto' }}>Close conversation</button>
      </div>

      <div className="card" style={{ padding: 14, marginBottom: 12 }}>
        <div style={{ fontWeight: 700 }}>{conv.visitor_name || 'Anonymous visitor'}</div>
        <div className="page-sub" style={{ fontSize: 12, margin: '4px 0 0' }}>
          {[conv.visitor_company, conv.visitor_email, conv.visitor_phone].filter(Boolean).join(' · ') || 'No contact details given'}
        </div>
        {conv.page && <div className="page-sub" style={{ fontSize: 12, margin: '2px 0 0' }}>From {conv.page}</div>}
      </div>

      <div className="card" style={{ padding: 14, maxHeight: '52vh', overflowY: 'auto' }}>
        {msgs.map(m => <Bubble key={m.id} m={m} />)}
        <div ref={endRef} />
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'flex-end' }}>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send() }}
          rows={2}
          placeholder="Write a reply… (Cmd/Ctrl+Enter to send)"
          style={{ flex: 1, padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', background: 'var(--surface)', resize: 'vertical' }}
        />
        <button className="btn btn-primary" onClick={send} disabled={sending || !body.trim()}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
      <div className="page-sub" style={{ fontSize: 12, marginTop: 6 }}>
        The visitor sees this within a few seconds, as long as their chat window is still open.
      </div>
    </div>
  )
}

function Bubble({ m }) {
  const mine = m.role === 'staff'
  const isVisitor = m.role === 'visitor'
  if (m.role === 'system') {
    return (
      <div className="page-sub" style={{ fontSize: 12, textAlign: 'center', margin: '10px 0' }}>{m.body}</div>
    )
  }
  const label = isVisitor ? 'Visitor' : mine ? 'You' : 'Turri'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: isVisitor ? 'flex-start' : 'flex-end', marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, opacity: .6, marginBottom: 3 }}>
        {label}{m.deferred ? ' · could not answer' : ''}
      </div>
      <div style={{
        maxWidth: '76%', padding: '9px 12px', borderRadius: 12, fontSize: 14, whiteSpace: 'pre-wrap',
        background: isVisitor ? 'var(--surface)' : mine ? 'var(--brand, #0089A6)' : 'rgba(120,120,120,.10)',
        color: mine ? '#fff' : 'inherit',
        border: isVisitor ? '1px solid var(--line)' : 'none',
      }}>{m.body}</div>
    </div>
  )
}

/* -------------------------------------------------------------- unanswered */

function Unanswered({ isAdmin }) {
  const [rows, setRows] = useState([])
  useEffect(() => {
    supabase.from('web_chat_unanswered').select('*').limit(100).then(({ data }) => setRows(data || []))
  }, [])

  return (
    <div>
      <p className="page-sub" style={{ marginTop: 0 }}>
        Questions Turri declined rather than guessed at. Each one is a gap in what she knows —
        {isAdmin ? ' add an answer under “What Turri knows” and she uses it immediately.' : ' ask an admin to add an answer.'}
      </p>
      {rows.length === 0 ? (
        <div className="card"><div className="page-sub" style={{ textAlign: 'center', padding: 26 }}>
          Nothing here. Either nobody has stumped her yet, or the chat is not live.
        </div></div>
      ) : rows.map(r => (
        <div key={r.reply_id} className="card" style={{ padding: 14, marginBottom: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{r.question || '(question not captured)'}</div>
          <div className="page-sub" style={{ fontSize: 13, margin: '6px 0 0' }}>She said: {r.turri_said}</div>
          <div className="page-sub" style={{ fontSize: 11, margin: '6px 0 0' }}>{ago(r.created_at)} · {r.page || ''}</div>
        </div>
      ))}
    </div>
  )
}

/* --------------------------------------------------------------- knowledge */

function Knowledge() {
  const [rows, setRows] = useState([])
  const [editing, setEditing] = useState(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('web_chat_knowledge')
      .select('*').order('sort_order', { ascending: true })
    setRows(data || [])
  }, [])
  useEffect(() => { load() }, [load])

  const save = async () => {
    const e = editing
    if (!e?.title?.trim() || !e?.body?.trim()) { alert('Both a title and an answer are needed.'); return }
    const payload = {
      title: e.title.trim(), body: e.body.trim(),
      active: e.active !== false,
      sort_order: Number(e.sort_order) || 100,
      updated_at: new Date().toISOString(),
    }
    const { error } = e.id
      ? await supabase.from('web_chat_knowledge').update(payload).eq('id', e.id)
      : await supabase.from('web_chat_knowledge').insert(payload)
    if (error) { alert('Could not save: ' + error.message); return }
    setEditing(null); load()
  }

  return (
    <div>
      <p className="page-sub" style={{ marginTop: 0 }}>
        Everything Turri is allowed to say. Changes take effect on her next reply — nothing to deploy.
        She will not state anything that is not here, which is deliberate: it is what stops her inventing answers.
      </p>

      <button className="btn btn-primary" style={{ marginBottom: 14 }}
        onClick={() => setEditing({ title: '', body: '', active: true, sort_order: 100 })}>
        + Add something she should know
      </button>

      {editing && (
        <div className="card" style={{ padding: 14, marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input value={editing.title} placeholder="Short title, e.g. Coverage and hours"
            onChange={e => setEditing({ ...editing, title: e.target.value })}
            style={{ padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', background: 'var(--surface)' }} />
          <textarea value={editing.body} rows={6} placeholder="The answer, in plain language. Be specific about anything she must NOT say."
            onChange={e => setEditing({ ...editing, body: e.target.value })}
            style={{ padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', background: 'var(--surface)', resize: 'vertical' }} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="page-sub" style={{ fontSize: 12, margin: 0 }}>
              Order <input type="number" value={editing.sort_order}
                onChange={e => setEditing({ ...editing, sort_order: e.target.value })}
                style={{ width: 70, marginLeft: 6, padding: '5px 8px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface)', fontFamily: 'inherit' }} />
            </label>
            <label className="page-sub" style={{ fontSize: 12, margin: 0 }}>
              <input type="checkbox" checked={editing.active !== false}
                onChange={e => setEditing({ ...editing, active: e.target.checked })} style={{ marginRight: 6 }} />
              In use
            </label>
            <button className="btn btn-primary" onClick={save} style={{ marginLeft: 'auto' }}>Save</button>
            <button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}

      {rows.map(r => (
        <div key={r.id} className="card" style={{ padding: 14, marginBottom: 8, opacity: r.active ? 1 : .55 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{r.title}</div>
            {!r.active && <span className="page-sub" style={{ fontSize: 11, margin: 0 }}>not in use</span>}
            <button className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => setEditing(r)}>Edit</button>
          </div>
          <div className="page-sub" style={{ fontSize: 13, margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{r.body}</div>
        </div>
      ))}
    </div>
  )
}
