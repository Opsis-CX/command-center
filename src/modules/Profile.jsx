import React, { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { fmtDate, panel } from './financeBits'
import { quoteFor } from './Calendar'

// ============================================================
// PROFILE
// Everything about one person in one place: photo, details, job title, job roles, tokens, projects and open tasks.
//   - Everyone opens their own page (My profile).
//   - Admins and Owners can open anyone's page.
// The database decides who may see what. It never returns access levels, passwords or other private fields.
// Job roles come from the shifts a person actually worked in the last 90 days (they are not typed in by hand).
// The photo uses the same storage and update as Settings, so a new photo changes everywhere at once.
// ============================================================

const STATUS = { todo: 'To do', inprogress: 'In progress', blocked: 'Blocked' }
const initialsFrom = (name) => (name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
const when = (ts) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })
const sectionTitle = { fontSize: 15, fontWeight: 700, margin: '0 0 8px' }
const row = { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderTop: '1px solid var(--line)', fontSize: 14 }

export default function Profile({ profileId }) {
  const { user } = useAuth()
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    const { data: d, error } = await supabase.rpc('profile_page_data', { p_profile: profileId || null })
    if (error) setErr(/not allowed/i.test(error.message) ? "You don't have access to this profile." : error.message)
    else setData(d)
    setLoading(false)
  }, [profileId])
  useEffect(() => { load() }, [load])

  if (loading) return <p className="page-sub">Loading…</p>
  if (err) return <div className="login-err" role="alert">{err}</div>
  const { person, job_roles: roles, tokens, projects, tasks, open_task_count: openCount, is_self: isSelf, hub, has_favorites: hasFavs } = data
  const patchPerson = (fields) => setData(d => ({ ...d, person: { ...d.person, ...fields } }))
  const showHub = hub && (person.is_agent || hub.week?.length || hub.certs?.length || hub.scorecard)

  return (
    <div className="profile-wrap">
    <style>{PROFILE_LAYOUT_CSS}</style>
    <div className="profile-layout">
    <div className="profile-main">
      {!isSelf && (
        <div className="card" style={{ marginBottom: 14 }} role="note">
          You are viewing <b>{person.full_name}</b>'s profile as an Admin or Owner. Only they can change their own photo and phone number.
        </div>
      )}

      <div style={{ ...panel, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
          <PhotoBlock person={person} editable={isSelf} userId={user?.id} onChanged={(url) => setData(d => ({ ...d, person: { ...d.person, avatar_url: url } }))} />
          <div style={{ flex: 1, minWidth: 220 }}>
            <h1 className="page-title" style={{ margin: 0, display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              {person.full_name}
              {person.pronouns && <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink-soft)' }}>({person.pronouns})</span>}
            </h1>
            <div style={{ fontSize: 15, marginTop: 2 }}>
              {person.job_title || <span style={{ color: 'var(--ink-soft)' }}>{isSelf ? 'No job title yet. An Admin sets this.' : 'No job title yet'}</span>}
            </div>
            {(person.team || person.manager_name) && (
              <div style={{ fontSize: 13.5, color: 'var(--ink-soft)', marginTop: 3 }}>
                {person.team && <span>{person.team}</span>}
                {person.team && person.manager_name && <span> · </span>}
                {person.manager_name && <span>Reports to <b style={{ color: 'var(--ink)' }}>{person.manager_name}</b></span>}
              </div>
            )}
            <Anniversary startDate={person.start_date} firstName={(person.full_name || '').split(' ')[0]} isSelf={isSelf} />
            {(person.status_text || person.status_emoji) && <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 2 }}>{person.status_emoji} {person.status_text}</div>}
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', marginBottom: 4 }}>Job roles</div>
              {roles.length === 0
                ? <span className="page-sub" style={{ margin: 0 }}>No shifts worked in the last 90 days, so there are no roles to show.</span>
                : <div className="tag-picker">{roles.map(r => <span key={r} className="tag-opt on" style={{ cursor: 'default' }}>{r}</span>)}</div>}
              {roles.length > 0 && <div className="hint" style={{ marginTop: 4 }}>From the shifts worked in the last 90 days.</div>}
            </div>
          </div>
        </div>
      </div>

      {isSelf && <Checklist person={person} hasFavs={hasFavs} />}

      {showHub && <Hub hub={hub} isSelf={isSelf} isAgent={!!person.is_agent} firstName={(person.full_name || '').split(' ')[0]} />}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16, marginBottom: 16 }}>
        <About person={person} isSelf={isSelf} onPatch={patchPerson} />
        <Tokens tokens={tokens} isSelf={isSelf} />
      </div>
      <Projects projects={projects} tasks={tasks} openCount={openCount} isSelf={isSelf} />
    </div>
    <aside className="profile-aside">
      <NeedHelp />
      <AskTurri />
      <div className="profile-picks"><Inspiration /><TipOfDay /></div>
    </aside>
    </div>
    </div>
  )
}

// Profile column keeps its full width (900px). The right-hand column (Need
// Help, Daily Inspiration, Tip of the Day) only takes the empty space when
// there's room; on narrower screens it drops below instead of squeezing the
// profile. Inspiration + Tip sit side by side once the right column is wide
// enough, and stack otherwise.
const PROFILE_LAYOUT_CSS = `
.profile-wrap { container-type: inline-size; }
.profile-layout { display: grid; grid-template-columns: minmax(0, 900px); gap: 16px; align-items: start; }
.profile-main { min-width: 0; }
.profile-aside { min-width: 0; max-width: 900px; display: flex; flex-direction: column; gap: 16px; container-type: inline-size; }
.profile-picks { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-items: stretch; }
@container (min-width: 520px) {
  .profile-picks { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
}
@container (min-width: 1176px) {
  .profile-layout { grid-template-columns: 900px minmax(260px, 760px); }
  .profile-aside { position: sticky; top: 16px; }
}
`

// ---------- Home Base picks (same ones Opsis Weekly shows) ----------
let _picksPromise = null
function loadPicks() {
  if (!_picksPromise) {
    _picksPromise = supabase.from('weekly_picks').select('kind, body, author, updated_at')
      .in('kind', ['quote', 'tip']).eq('active', true).order('updated_at', { ascending: false })
      .then(({ data }) => ({ quote: (data || []).find(p => p.kind === 'quote') || null, tip: (data || []).find(p => p.kind === 'tip') || null }))
      .finally(() => setTimeout(() => { _picksPromise = null }, 60000))
  }
  return _picksPromise
}
function usePicks() {
  const [picks, setPicks] = useState(null)
  useEffect(() => { let alive = true; loadPicks().then(p => { if (alive) setPicks(p) }); return () => { alive = false } }, [])
  return picks
}
const cardHead = (ico, title) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
    <span style={{ fontSize: 18 }}>{ico}</span>
    <h2 style={{ ...sectionTitle, margin: 0 }}>{title}</h2>
  </div>
)

// ---------- Need Help? (same links as Opsis Weekly) ----------
const helpLink = { display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 600, color: 'var(--accent)', background: 'var(--accent-bg)', borderRadius: 9, padding: '9px 13px', textDecoration: 'none' }
function NeedHelp() {
  return (
    <div style={panel}>
      {cardHead('🛟', 'Need Help?')}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 9 }}>
        <a style={helpLink} href="/knowledge">📚 Knowledge Base</a>
        <a style={helpLink} href="/help">🎫 Help Center</a>
        <a style={helpLink} href="/chat">💬 Ask in Chat</a>
        <a style={helpLink} href="/schedule">🗓️ My Schedule</a>
      </div>
    </div>
  )
}

// ---------- Ask Turri ----------
// Same brain as Turri in chat (Knowledge Base, Brand Information Sheet,
// leadership playbook) via the ask-turri edge function. Nothing is posted to
// chat; the conversation lives on this page.
const TURRI_SUGGESTIONS = ['How many days out do we book Genson?', "What's Cheney's dispatch fee?", 'How do I give away an interval?']

function TurriText({ text }) {
  const lines = String(text || '').split(/\n+/).filter(Boolean)
  return lines.map((l, i) => /^[-•]\s+/.test(l)
    ? <div key={i} style={{ display: 'flex', gap: 6 }}><span>•</span><span>{l.replace(/^[-•]\s+/, '')}</span></div>
    : <div key={i} style={{ marginTop: i ? 4 : 0 }}>{l}</div>)
}

function AskTurri() {
  const [turriName, setTurriName] = useState('Turri 🪼')
  const [msgs, setMsgs] = useState([])   // { role: 'user'|'assistant', content, sources?, covered?, error? }
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const listRef = useRef(null)

  useEffect(() => {
    supabase.rpc('service_account_id').then(async ({ data: id }) => {
      if (!id) return
      const { data } = await supabase.from('profiles').select('full_name').eq('id', id).maybeSingle()
      if (data?.full_name) setTurriName(data.full_name)
    })
  }, [])
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight }, [msgs, busy])

  async function ask(text) {
    const question = (text ?? q).trim()
    if (!question || busy) return
    const history = msgs.filter(m => !m.error).slice(-6).map(m => ({ role: m.role, content: m.content }))
    setMsgs(m => [...m, { role: 'user', content: question }]); setQ(''); setBusy(true)
    const { data, error } = await supabase.functions.invoke('ask-turri', { body: { question, history } })
    let err = data?.error
    if (error) { err = error.message; try { const j = await error.context?.json?.(); if (j?.error) err = j.error } catch { /* ignore */ } }
    setBusy(false)
    if (err) { setMsgs(m => [...m, { role: 'assistant', content: err, error: true }]); return }
    setMsgs(m => [...m, { role: 'assistant', content: data.answer, sources: data.sources || [], covered: data.covered }])
  }

  const firstName = turriName.split(' ')[0]
  const emoji = turriName.split(' ').find(w => /\p{Extended_Pictographic}/u.test(w)) || '🪼'
  const bubble = (mine) => ({ maxWidth: '88%', padding: '9px 12px', borderRadius: 12, fontSize: 13.5, lineHeight: 1.5,
    background: mine ? 'var(--accent)' : 'var(--canvas)', color: mine ? '#fff' : 'var(--ink)',
    borderBottomRightRadius: mine ? 4 : 12, borderBottomLeftRadius: mine ? 12 : 4, overflowWrap: 'anywhere' })

  return (
    <div style={{ ...panel, background: 'linear-gradient(160deg, color-mix(in srgb, #0891B2 9%, var(--surface)), var(--surface) 75%)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 34, height: 34, borderRadius: '50%', background: '#0891B2', display: 'grid', placeItems: 'center', fontSize: 19, flex: 'none' }}>{emoji}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ ...sectionTitle, margin: 0 }}>Ask {firstName}</h2>
          <div className="page-sub" style={{ margin: 0, fontSize: 12 }}>Brands, booking, processes — answers come from the Knowledge Base.</div>
        </div>
        {msgs.length > 0 && <button className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 10px' }} onClick={() => setMsgs([])} disabled={busy}>Clear</button>}
      </div>

      {msgs.length === 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
          {TURRI_SUGGESTIONS.map(sg => (
            <button key={sg} onClick={() => ask(sg)} disabled={busy}
              style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 999, padding: '5px 11px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--ink)' }}>{sg}</button>
          ))}
        </div>
      ) : (
        <div ref={listRef} style={{ marginTop: 12, maxHeight: 340, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 2 }}>
          {msgs.map((m, i) => m.role === 'user' ? (
            <div key={i} style={{ alignSelf: 'flex-end', ...bubble(true) }}>{m.content}</div>
          ) : (
            <div key={i} style={{ alignSelf: 'flex-start', display: 'flex', gap: 7, alignItems: 'flex-end', maxWidth: '100%' }}>
              <span style={{ fontSize: 16, flex: 'none' }}>{emoji}</span>
              <div style={{ ...bubble(false), ...(m.error ? { background: '#fde8e8', color: '#b42318' } : {}) }}>
                <TurriText text={m.content} />
                {m.sources?.length > 0 && (
                  <div style={{ marginTop: 7, fontSize: 12, color: 'var(--ink-soft)' }}>
                    📘 {m.sources.map((sr, j) => <span key={sr.id}>{j > 0 && ' · '}<a href={`/knowledge?id=${sr.id}`}>{sr.title}</a></span>)}
                  </div>
                )}
                {m.covered === false && !m.error && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    <a href="/help" style={{ ...helpLink, padding: '5px 10px', fontSize: 12 }}>🎫 Help Center</a>
                    <a href="/chat" style={{ ...helpLink, padding: '5px 10px', fontSize: 12 }}>💬 Ask in Chat</a>
                  </div>
                )}
              </div>
            </div>
          ))}
          {busy && (
            <div style={{ alignSelf: 'flex-start', display: 'flex', gap: 7, alignItems: 'center' }}>
              <span style={{ fontSize: 16 }}>{emoji}</span>
              <div style={{ ...bubble(false), color: 'var(--ink-soft)', fontStyle: 'italic' }}>{firstName} is looking that up…</div>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <input value={q} onChange={e => setQ(e.target.value)} maxLength={2000} disabled={busy}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask() } }}
          placeholder={`Ask ${firstName} a question…`} aria-label={`Ask ${firstName} a question`}
          style={{ flex: 1, minWidth: 0, padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 10, fontFamily: 'inherit', fontSize: 13.5, background: 'var(--surface)', color: 'var(--ink)' }} />
        <button className="btn btn-primary" onClick={() => ask()} disabled={busy || !q.trim()} style={{ fontSize: 13, padding: '8px 16px' }}>{busy ? '…' : 'Ask'}</button>
      </div>
      <div className="page-sub" style={{ margin: '6px 0 0', fontSize: 11 }}>🤖 AI answers can be wrong — if something doesn't match what you're seeing, ask the Opsis CX Support team.</div>
    </div>
  )
}

// ---------- Tip of the Day ----------
function TipOfDay() {
  const picks = usePicks()
  if (!picks?.tip?.body) return null
  return (
    <div style={{ ...panel, background: 'linear-gradient(160deg, color-mix(in srgb, #F59E0B 10%, var(--surface)), var(--surface) 70%)' }}>
      {cardHead('💡', 'Tip of the Day')}
      <div style={{ fontSize: 14, lineHeight: 1.55, whiteSpace: 'pre-line' }}>{picks.tip.body}</div>
    </div>
  )
}

// ---------- Daily Inspiration (same pick as the Home Base card) ----------
function Inspiration() {
  const picks = usePicks()
  // Fallback when no quote is picked: Calendar's daily rotating quote.
  const q = !picks ? null : picks.quote?.body
    ? { body: picks.quote.body, author: picks.quote.author }
    : (() => { const [body, author] = quoteFor(new Date()); return { body, author } })()
  if (!q) return null
  return (
    <div style={{ ...panel, position: 'relative', overflow: 'hidden', background: 'linear-gradient(160deg, color-mix(in srgb, var(--accent) 10%, var(--surface)), var(--surface) 70%)' }}>
      {cardHead('🌟', 'Daily Inspiration')}
      <div aria-hidden="true" style={{ position: 'absolute', right: 14, top: 4, fontSize: 90, lineHeight: 1, color: 'var(--accent)', opacity: 0.12, fontFamily: 'Georgia, serif' }}>”</div>
      <blockquote style={{ margin: 0, fontSize: 16.5, lineHeight: 1.55, fontStyle: 'italic', position: 'relative' }}>
        “{q.body}”
      </blockquote>
      {q.author && <div style={{ marginTop: 12, fontSize: 13, fontWeight: 600, color: 'var(--ink-soft)' }}>— {q.author}</div>}
    </div>
  )
}

// ---------- photo (same storage and event as Settings) ----------
function PhotoBlock({ person, editable, userId, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const fileRef = useRef(null)
  const color = person.color || '#2563EB'

  async function onPick(e) {
    const file = e.target.files?.[0]
    if (fileRef.current) fileRef.current.value = ''
    if (!file) return
    setErr('')
    if (!file.type.startsWith('image/')) return setErr('Please choose an image file.')
    if (file.size > 5 * 1024 * 1024) return setErr('Please choose an image under 5 MB.')
    setBusy(true)
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
      const path = `${userId}/avatar-${Date.now()}.${ext}`     // a fresh name each time, so the old photo is never cached
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type })
      if (upErr) throw upErr
      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path)
      const url = pub?.publicUrl
      const { error: dbErr } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', userId)
      if (dbErr) throw dbErr
      onChanged(url)
      window.dispatchEvent(new CustomEvent('cc:avatar-updated', { detail: url }))
    } catch (e2) { setErr(e2?.message || 'Upload failed. Please try again.') } finally { setBusy(false) }
  }
  async function onRemove() {
    setBusy(true); setErr('')
    try {
      const { error } = await supabase.from('profiles').update({ avatar_url: null }).eq('id', userId)
      if (error) throw error
      onChanged(null)
      window.dispatchEvent(new CustomEvent('cc:avatar-updated', { detail: null }))
    } catch (e2) { setErr(e2?.message || 'Could not remove the photo.') } finally { setBusy(false) }
  }
  return (
    <div style={{ textAlign: 'center' }}>
      {person.avatar_url
        ? <img src={person.avatar_url} alt={person.full_name} style={{ width: 96, height: 96, borderRadius: '50%', objectFit: 'cover', boxShadow: '0 0 0 2px var(--line)' }} />
        : <span aria-label={`${person.full_name} (no photo)`} style={{ width: 96, height: 96, borderRadius: '50%', background: color + '22', color, fontSize: 34, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{initialsFrom(person.full_name)}</span>}
      {editable && (
        <div style={{ marginTop: 8, display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? 'Uploading…' : person.avatar_url ? 'Change photo' : 'Add photo'}</button>
          {person.avatar_url && <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} disabled={busy} onClick={onRemove}>Remove</button>}
          <input ref={fileRef} type="file" accept="image/*" aria-label="Choose a photo" onChange={onPick} style={{ display: 'none' }} />
        </div>
      )}
      {err && <div role="alert" style={{ marginTop: 8, fontSize: 12.5, color: 'var(--failed, #c0392b)', maxWidth: 180 }}>{err}</div>}
    </div>
  )
}

// ---------- details ----------
const COMMON_LANGUAGES = ['English', 'Spanish', 'Portuguese', 'French', 'Tagalog', 'Haitian Creole', 'Vietnamese', 'Mandarin', 'Arabic', 'ASL']
const inputSt = { padding: '6px 9px', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', fontFamily: 'inherit', fontSize: 13.5, background: 'var(--surface)', color: 'var(--ink)' }

function About({ person, isSelf, onPatch }) {
  const { isAdmin } = useAuth()
  const canAdminEdit = isAdmin && !isSelf
  const [phone, setPhone] = useState(person.phone || '')
  const [pronouns, setPronouns] = useState(person.pronouns || '')
  const [langs, setLangs] = useState(person.languages || [])
  const [langInput, setLangInput] = useState('')
  const [title, setTitle] = useState(person.job_title || '')
  const [team, setTeam] = useState(person.team || '')
  const [managerId, setManagerId] = useState(person.manager_id || '')
  const [people, setPeople] = useState([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!canAdminEdit) return
    supabase.from('profiles').select('id, full_name').eq('is_active', true).is('client_id', null).eq('is_service_account', false)
      .order('full_name').then(({ data }) => setPeople((data || []).filter(x => x.id !== person.id)))
  }, [canAdminEdit, person.id])

  const selfChanged = phone.trim() !== (person.phone || '') || pronouns.trim() !== (person.pronouns || '')
    || JSON.stringify(langs) !== JSON.stringify(person.languages || [])
  const adminChanged = title.trim() !== (person.job_title || '') || team.trim() !== (person.team || '') || (managerId || null) !== (person.manager_id || null)

  function addLang(v) {
    const t = (v || '').trim()
    if (!t || langs.some(l => l.toLowerCase() === t.toLowerCase()) || langs.length >= 8) return
    setLangs([...langs, t.slice(0, 30)]); setLangInput('')
  }
  function flash(t) { setMsg(t); setTimeout(() => setMsg(''), 3500) }

  async function saveSelf() {
    setErr(''); setMsg('')
    const v = phone.trim()
    if (v.length > 30 || !/^[0-9 +().-]*$/.test(v)) return setErr('Phone: use digits, spaces and + - ( ) only, up to 30 characters.')
    if (pronouns.trim().length > 30) return setErr('Pronouns: up to 30 characters.')
    setBusy(true)
    const fields = { phone: v || null, pronouns: pronouns.trim() || null, languages: langs }
    const { error } = await supabase.from('profiles').update(fields).eq('id', person.id)
    setBusy(false)
    if (error) return setErr(error.message)
    onPatch(fields); flash('Saved.')
  }
  async function saveAdmin() {
    setErr(''); setMsg(''); setBusy(true)
    const fields = { job_title: title.trim() || null, team: team.trim() || null, manager_id: managerId || null }
    const { error } = await supabase.from('profiles').update(fields).eq('id', person.id)
    setBusy(false)
    if (error) return setErr(error.message)
    const m = people.find(x => x.id === managerId)
    onPatch({ ...fields, manager_name: m?.full_name || null }); flash('Saved.')
  }

  return (
    <div style={panel}>
      <h2 style={sectionTitle}>About</h2>
      <div style={row}><span style={{ color: 'var(--ink-soft)' }}>Email</span><span>{person.email || 'Not set'}</span></div>
      <div style={{ ...row, alignItems: 'center' }}>
        <label htmlFor="pf-phone" style={{ color: 'var(--ink-soft)' }}>Phone</label>
        {isSelf ? <input id="pf-phone" value={phone} onChange={e => setPhone(e.target.value)} style={{ ...inputSt, width: 190 }} placeholder="Not set" />
          : <span id="pf-phone">{person.phone || 'Not set'}</span>}
      </div>
      <div style={{ ...row, alignItems: 'center' }}>
        <label htmlFor="pf-pronouns" style={{ color: 'var(--ink-soft)' }}>Pronouns</label>
        {isSelf ? (
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input id="pf-pronouns" value={pronouns} maxLength={30} onChange={e => setPronouns(e.target.value)} list="pf-pronoun-list" style={{ ...inputSt, width: 190 }} placeholder="Optional" />
            <datalist id="pf-pronoun-list"><option value="she/her" /><option value="he/him" /><option value="they/them" /><option value="she/they" /><option value="he/they" /></datalist>
          </span>
        ) : <span>{person.pronouns || 'Not set'}</span>}
      </div>
      <div style={{ ...row, alignItems: 'flex-start' }}>
        <span style={{ color: 'var(--ink-soft)', paddingTop: 4 }}>Languages</span>
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, maxWidth: 300 }}>
          <span style={{ display: 'flex', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {langs.length === 0 && <span className="page-sub" style={{ margin: 0 }}>Not set</span>}
            {langs.map(l => (
              <span key={l} className="badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                🗣️ {l}
                {isSelf && <button onClick={() => setLangs(langs.filter(x => x !== l))} aria-label={`Remove ${l}`} style={{ border: 0, background: 'transparent', cursor: 'pointer', padding: 0, color: 'var(--ink-soft)' }}>✕</button>}
              </span>
            ))}
          </span>
          {isSelf && (
            <span style={{ display: 'flex', gap: 6 }}>
              <input value={langInput} onChange={e => setLangInput(e.target.value)} list="pf-lang-list" placeholder="Add a language"
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLang(langInput) } }} style={{ ...inputSt, width: 150 }} />
              <datalist id="pf-lang-list">{COMMON_LANGUAGES.map(l => <option key={l} value={l} />)}</datalist>
              <button className="btn btn-ghost" style={{ fontSize: 12.5, padding: '4px 10px' }} onClick={() => addLang(langInput)} disabled={!langInput.trim()}>Add</button>
            </span>
          )}
        </span>
      </div>
      {isSelf && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 8 }}>
          <button className="btn btn-primary" style={{ fontSize: 12.5, padding: '5px 14px' }} onClick={saveSelf} disabled={busy || !selfChanged}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      )}

      {canAdminEdit ? (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', margin: '14px 0 2px' }}>Set by admins</div>
          <div style={{ ...row, alignItems: 'center' }}><label htmlFor="pf-title" style={{ color: 'var(--ink-soft)' }}>Job title</label>
            <input id="pf-title" value={title} maxLength={80} onChange={e => setTitle(e.target.value)} style={{ ...inputSt, width: 220 }} placeholder="Not set" /></div>
          <div style={{ ...row, alignItems: 'center' }}><label htmlFor="pf-team" style={{ color: 'var(--ink-soft)' }}>Team</label>
            <input id="pf-team" value={team} maxLength={60} onChange={e => setTeam(e.target.value)} style={{ ...inputSt, width: 220 }} placeholder="e.g. GarageCo, Support" /></div>
          <div style={{ ...row, alignItems: 'center' }}><label htmlFor="pf-mgr" style={{ color: 'var(--ink-soft)' }}>Manager</label>
            <select id="pf-mgr" value={managerId} onChange={e => setManagerId(e.target.value)} style={{ ...inputSt, width: 220 }}>
              <option value="">No manager</option>
              {people.map(x => <option key={x.id} value={x.id}>{x.full_name}</option>)}
            </select></div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 8 }}>
            <button className="btn btn-primary" style={{ fontSize: 12.5, padding: '5px 14px' }} onClick={saveAdmin} disabled={busy || !adminChanged}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </>
      ) : (
        <>
          <div style={row}><span style={{ color: 'var(--ink-soft)' }}>Team</span><span>{person.team || 'Not set'}</span></div>
          <div style={row}><span style={{ color: 'var(--ink-soft)' }}>Manager</span><span>{person.manager_name || 'Not set'}</span></div>
        </>
      )}

      {err && <div role="alert" className="login-err" style={{ marginTop: 6 }}>{err}</div>}
      {msg && <div role="status" style={{ fontSize: 13, color: 'var(--passed)', marginTop: 6 }}>{msg}</div>}
      <div style={row}><span style={{ color: 'var(--ink-soft)' }}>Time zone</span><span>{person.timezone || 'Company time (Eastern)'}{isSelf && <> · <a href="/settings">Change in Settings</a></>}</span></div>
      <div style={row}><span style={{ color: 'var(--ink-soft)' }}>Start date</span><span>{person.start_date ? fmtDate(person.start_date) : 'Not set'}</span></div>
    </div>
  )
}

// ---------- work anniversary ----------
function Anniversary({ startDate, firstName, isSelf }) {
  if (!startDate) return null
  const start = new Date(startDate + 'T12:00:00')
  const now = new Date()
  let years = now.getFullYear() - start.getFullYear()
  const thisYear = new Date(now.getFullYear(), start.getMonth(), start.getDate(), 12)
  if (thisYear > now) years -= 1
  const next = thisYear > now ? thisYear : new Date(now.getFullYear() + 1, start.getMonth(), start.getDate(), 12)
  const daysToNext = Math.round((next - now) / 86400000)
  const isToday = thisYear.toDateString() === now.toDateString() && years >= 1
  const month = start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  let text
  if (isToday) text = `🎉 ${years} year${years === 1 ? '' : 's'} with Opsis today!`
  else if (daysToNext <= 14 && years + 1 >= 1) text = `🎉 ${years + 1}-year anniversary in ${daysToNext} day${daysToNext === 1 ? '' : 's'}`
  else if (years >= 1) text = `${years} year${years === 1 ? '' : 's'} with Opsis · since ${month}`
  else text = `With Opsis since ${month}`
  return <div style={{ fontSize: 13, color: isToday ? 'var(--accent)' : 'var(--ink-soft)', fontWeight: isToday ? 700 : 400, marginTop: 3 }}>{text}</div>
}

// ---------- "complete your profile" ----------
function Checklist({ person, hasFavs }) {
  const items = [
    { done: !!person.avatar_url, label: 'Add a photo', hint: 'Use "Add photo" under your picture above.' },
    { done: !!person.phone, label: 'Add your phone number', hint: 'In About, below.' },
    { done: (person.languages || []).length > 0, label: 'Add the languages you speak', hint: 'In About, below — helps route bilingual calls.' },
    { done: !!person.pronouns, label: 'Add your pronouns (optional)', hint: 'In About, below.', optional: true },
    { done: !!hasFavs, label: 'Fill out your Get to Know You card', href: '/get-to-know-you' },
  ]
  const required = items.filter(i => !i.optional)
  const doneCount = required.filter(i => i.done).length
  if (doneCount === required.length) return null
  const pct = Math.round(doneCount / required.length * 100)
  return (
    <div style={{ ...panel, marginBottom: 16, borderLeft: '4px solid var(--accent)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ ...sectionTitle, margin: 0 }}>Complete your profile</h2>
        <span className="page-sub" style={{ margin: 0, fontSize: 12.5 }}>{doneCount} of {required.length} done</span>
      </div>
      <div style={{ height: 6, background: 'var(--line)', borderRadius: 999, margin: '10px 0 8px', overflow: 'hidden' }}>
        <div style={{ width: pct + '%', height: '100%', background: 'var(--accent)', borderRadius: 999, transition: 'width .3s' }} />
      </div>
      {items.map(i => (
        <div key={i.label} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '5px 0', fontSize: 13.5 }}>
          <span style={{ width: 18, flex: 'none', color: i.done ? 'var(--passed)' : 'var(--ink-soft)' }}>{i.done ? '✓' : '○'}</span>
          <span style={{ textDecoration: i.done ? 'line-through' : 'none', color: i.done ? 'var(--ink-soft)' : 'var(--ink)' }}>
            {i.href && !i.done ? <a href={i.href}>{i.label}</a> : i.label}
            {!i.done && i.hint && <span className="page-sub" style={{ margin: '0 0 0 6px', fontSize: 12 }}>{i.hint}</span>}
          </span>
        </div>
      ))}
    </div>
  )
}

// ---------- shared bits: button links + collapsible sections ----------
function ActionLink({ href, children }) {
  return (
    <a href={href} className="btn btn-ghost"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', fontSize: 13, padding: '6px 14px', marginTop: 12 }}>
      {children} <span aria-hidden="true">→</span>
    </a>
  )
}
// Open/closed is remembered per section on this device.
function useCollapsed(key, initial) {
  const k = 'cc.profile.collapsed.' + key
  const [collapsed, setCollapsed] = useState(() => {
    try { const v = localStorage.getItem(k); return v === null ? initial : v === '1' } catch { return initial }
  })
  const toggle = () => setCollapsed(c => { try { localStorage.setItem(k, c ? '0' : '1') } catch { /* ignore */ } return !c })
  return [collapsed, toggle]
}
function CollapsibleHeader({ title, summary, collapsed, onToggle }) {
  return (
    <button onClick={onToggle} aria-expanded={!collapsed}
      style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', border: 0, background: 'transparent', padding: 0, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', color: 'var(--ink)' }}>
      <span style={{ fontSize: 12, width: 12, color: 'var(--ink-soft)' }}>{collapsed ? '▸' : '▾'}</span>
      <h2 style={{ ...sectionTitle, margin: 0 }}>{title}</h2>
      {summary && <span className="page-sub" style={{ margin: 0, fontSize: 12.5, marginLeft: 'auto' }}>{summary}</span>}
    </button>
  )
}

// ---------- personal hub: this week, performance, certifications ----------
const fmtT = (t) => { const [h, m] = String(t).split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${ap}` }
const pctOrDash = (v) => v == null ? '—' : `${Math.round(Number(v) * (Number(v) <= 1.5 ? 100 : 1))}%`

function mergeShifts(blocks) {
  // Back-to-back interval blocks on the same day → one shift.
  const byDay = {}
  for (const b of blocks) (byDay[b.date] = byDay[b.date] || []).push(b)
  return Object.keys(byDay).sort().map(day => {
    const list = byDay[day].slice().sort((x, y) => String(x.start).localeCompare(String(y.start)))
    const shifts = []
    for (const b of list) {
      const last = shifts[shifts.length - 1]
      if (last && String(b.start).slice(0, 5) <= String(last.end).slice(0, 5)) {
        if (String(b.end) > String(last.end)) last.end = b.end
        last.blocks.push(b)
      } else shifts.push({ start: b.start, end: b.end, blocks: [b] })
    }
    for (const sh of shifts) {
      const roles = [...new Set(sh.blocks.map(x => x.role).filter(Boolean))]
      sh.role = roles.join(', ')
      sh.noShow = sh.blocks.some(x => x.status === 'no_show')
      sh.worked = sh.blocks.some(x => x.checked_in_at)
    }
    return { day, shifts }
  })
}

function Hub({ hub, isSelf, firstName, isAgent }) {
  const [certsCollapsed, toggleCerts] = useCollapsed('certs', true)
  const days = mergeShifts(hub.week || [])
  const sc = hub.scorecard
  const certs = hub.certs || []
  const passed = certs.filter(c => c.status === 'passed')
  const todo = certs.filter(c => c.status !== 'passed')
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const stat = (label, value, sub) => (
    <div style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', minWidth: 0 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.03em' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.2, marginTop: 2 }}>{value}</div>
      {sub && <div className="page-sub" style={{ margin: 0, fontSize: 12 }}>{sub}</div>}
    </div>
  )
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginBottom: 16 }}>
      <div style={panel}>
        <h2 style={sectionTitle}>{isSelf ? 'My week' : `${firstName}'s week`}</h2>
        {days.length === 0 ? <p className="page-sub" style={{ margin: 0 }}>No shifts this week.{isSelf && <> <a href="/schedule">Pick up intervals</a></>}</p> : days.map(d => {
          const dt = new Date(d.day + 'T12:00:00')
          const isToday = d.day === today
          return (
            <div key={d.day} style={{ ...row, alignItems: 'flex-start', fontWeight: isToday ? 700 : 400 }}>
              <span style={{ color: isToday ? 'var(--accent)' : 'var(--ink-soft)', width: 86, flex: 'none' }}>
                {isToday ? 'Today' : dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              </span>
              <span style={{ textAlign: 'right' }}>
                {d.shifts.map((sh, i) => (
                  <div key={i}>
                    {fmtT(sh.start)} – {fmtT(sh.end)}
                    {sh.role && <span className="page-sub" style={{ margin: '0 0 0 6px', fontSize: 12 }}>{sh.role}</span>}
                    {sh.noShow && <span className="badge failed" style={{ marginLeft: 6 }}>No-show</span>}
                  </div>
                ))}
              </span>
            </div>
          )
        })}
        {isSelf && <ActionLink href="/schedule">Open Schedule</ActionLink>}
      </div>

      {isAgent && <div style={panel}>
        <h2 style={sectionTitle}>Performance</h2>
        {!sc ? <p className="page-sub" style={{ margin: 0 }}>No scorecard data yet.</p> : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
              {stat('Hours (14 days)', sc.hours_14d != null ? Number(sc.hours_14d).toFixed(1) : '—', sc.scheduled_hours_14d != null ? `of ${Number(sc.scheduled_hours_14d).toFixed(1)} scheduled` : null)}
              {stat('QA score (30 days)', pctOrDash(sc.qa_score_30d), sc.qa_reviews_30d != null ? `${sc.qa_reviews_30d} review${Number(sc.qa_reviews_30d) === 1 ? '' : 's'}` : null)}
              {stat('Adherence (14 days)', pctOrDash(sc.adherence_14d))}
              {stat('Calls (30 days)', sc.calls_30d != null ? Number(sc.calls_30d).toLocaleString('en-US') : '—', sc.conversion_30d != null ? `${pctOrDash(sc.conversion_30d)} booked` : null)}
            </div>
            {sc.tier && <div style={{ marginTop: 10, fontSize: 13 }}>Tier: <b>{sc.tier}</b>{sc.hold_reason && <span className="page-sub" style={{ margin: '0 0 0 6px', fontSize: 12 }}>{sc.hold_reason}</span>}</div>}
            {isSelf && <ActionLink href="/scorecard">Open my scorecard</ActionLink>}
          </>
        )}
      </div>}

      <div style={panel}>
        <CollapsibleHeader title="Certifications" collapsed={certsCollapsed} onToggle={toggleCerts}
          summary={certs.length === 0 ? null : [passed.length && `${passed.length} passed`, todo.length && `${todo.length} to do`].filter(Boolean).join(' · ')} />
        {certs.length === 0 ? <p className="page-sub" style={{ margin: '8px 0 0' }}>No certifications yet.</p> : !certsCollapsed && (
          <div style={{ marginTop: 8, maxHeight: 360, overflowY: 'auto' }}>
            {passed.map(c => (
              <div key={c.name} style={row}>
                <span>✅ {c.name}</span>
                <span className="page-sub" style={{ margin: 0, fontSize: 12.5 }}>
                  {c.best_score_pct != null && `${c.best_score_pct}% · `}{c.passed_at ? when(c.passed_at) : 'Passed'}
                  {c.expires_at && <> · expires {when(c.expires_at)}</>}
                </span>
              </div>
            ))}
            {todo.map(c => (
              <div key={c.name} style={row}>
                <span>{c.status === 'failed' ? '🔁' : '⏳'} {c.name}</span>
                <span className="badge" style={{ fontSize: 11.5 }}>{c.status === 'failed' ? 'Retake needed' : 'To do'}</span>
              </div>
            ))}
          </div>
        )}
        {isSelf && <div><ActionLink href="/my-certifications">Open My certifications</ActionLink></div>}
      </div>
    </div>
  )
}

// ---------- tokens ----------
function Tokens({ tokens, isSelf }) {
  const w = tokens.wallet
  return (
    <div style={panel}>
      <h2 style={sectionTitle}>Tokens</h2>
      {!w ? <p className="page-sub" style={{ margin: 0 }}>No tokens yet.</p> : (
        <>
          <div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.1 }} aria-label="Token balance">{Number(w.balance).toLocaleString('en-US')}</div>
          <div className="page-sub" style={{ margin: '2px 0 8px' }}>{Number(w.lifetime_earned).toLocaleString('en-US')} earned · {Number(w.lifetime_redeemed).toLocaleString('en-US')} redeemed</div>
        </>
      )}
      {tokens.recent.length > 0 && <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', marginTop: 6 }}>Recent activity</div>}
      {tokens.recent.map((t, i) => (
        <div key={i} style={row}>
          <span>{t.reason || t.note || (t.kind === 'redeem' ? 'Redeemed' : 'Earned')}<span style={{ display: 'block', fontSize: 12, color: 'var(--ink-soft)' }}>{when(t.created_at)}</span></span>
          <span style={{ fontWeight: 700, color: t.delta >= 0 ? 'var(--passed)' : 'var(--ink)' }}>{t.delta >= 0 ? '+' : ''}{t.delta}</span>
        </div>
      ))}
      {isSelf && <ActionLink href="/tokens">Open Tokens</ActionLink>}
    </div>
  )
}

// ---------- projects and tasks ----------
function Projects({ projects, tasks, openCount, isSelf }) {
  const [collapsed, toggle] = useCollapsed('projects', false)
  const summary = [projects.length && `${projects.length} project${projects.length === 1 ? '' : 's'}`, `${openCount} open task${openCount === 1 ? '' : 's'}`].filter(Boolean).join(' · ')
  return (
    <div style={panel}>
      <CollapsibleHeader title="Projects and open tasks" summary={summary} collapsed={collapsed} onToggle={toggle} />
      {collapsed ? null : <div style={{ marginTop: 10 }}>
      {projects.length === 0 && tasks.length === 0 ? <p className="page-sub" style={{ margin: 0 }}>Not on any projects, and no open tasks.</p> : (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {projects.map(p => (
              <span key={p.id} className="badge" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color || 'var(--ink-soft)' }} />{p.name}
                {p.open_tasks > 0 && <span style={{ color: 'var(--ink-soft)' }}>· {p.open_tasks} open</span>}
              </span>))}
          </div>
          {tasks.length === 0 ? <p className="page-sub" style={{ margin: 0 }}>No open tasks.</p> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
                <thead><tr>{['Task', 'Project', 'Due', 'Status'].map(h => <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', borderBottom: '2px solid var(--line)' }}>{h}</th>)}</tr></thead>
                <tbody>
                  {tasks.map(t => (
                    <tr key={t.id}>
                      <td style={{ padding: '7px 8px', borderBottom: '1px solid var(--line)', fontSize: 13.5 }}>{t.name}</td>
                      <td style={{ padding: '7px 8px', borderBottom: '1px solid var(--line)', fontSize: 13.5, color: 'var(--ink-soft)' }}>{t.project_name || ''}</td>
                      <td style={{ padding: '7px 8px', borderBottom: '1px solid var(--line)', fontSize: 13.5, whiteSpace: 'nowrap' }}>{t.due_date ? fmtDate(t.due_date) : ''}</td>
                      <td style={{ padding: '7px 8px', borderBottom: '1px solid var(--line)', fontSize: 13.5 }}><span className={'badge' + (t.status === 'blocked' ? ' failed' : '')}>{STATUS[t.status] || t.status}</span></td>
                    </tr>))}
                </tbody>
              </table>
              {openCount > tasks.length && <p className="page-sub" style={{ margin: '8px 0 0' }}>Showing {tasks.length} of {openCount} open tasks, soonest due first.</p>}
            </div>
          )}
        </>
      )}
      </div>}
      {isSelf && <div><ActionLink href="/projects">Open Project Management</ActionLink></div>}
    </div>
  )
}
