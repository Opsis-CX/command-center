import React, { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { fmtDate, panel } from './financeBits'
import { quoteFor } from './Calendar'
import { FavoritesEditor, FavoritesDetails } from './TeamFavorites'
import { PD_CSS, ProfileHeader, Drawer, CalendarPanel, NotesPanel, UpdatesPanel, RemindersPanel, reminderBadgeCount, MyWeek, MyMeetings, Section, openSection } from './ProfileDashboard'

// ============================================================
// PROFILE
// Everything about one person in one place: photo, details, job title, job roles, tokens, projects and open tasks.
//   - Everyone opens their own page (My profile).
//   - Admins and Owners can open anyone's page.
// The database decides who may see what. It never returns access levels, passwords or other private fields.
// Job roles come from the shifts a person actually worked in the last 90 days (they are not typed in by hand).
// The photo uses the same storage and update as Settings, so a new photo changes everywhere at once.
// ============================================================

const when = (ts) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })
const sectionTitle = { fontSize: 15, fontWeight: 700, margin: '0 0 8px' }
const row = { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderTop: '1px solid var(--line)', fontSize: 14 }

export default function Profile({ profileId }) {
  const { user } = useAuth()
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [openPanel, setPanel] = useState(null)            // 'reminders' | 'calendar' | 'notes' | 'updates' | {kind:'calendar',…}
  const [badges, setBadges] = useState({})
  const [meetKey, setMeetKey] = useState(0)
  const ownPage = !profileId || profileId === user?.id
  const refreshBadges = useCallback(async () => {
    if (!ownPage || !user?.id) return
    const [rem, ann, reads] = await Promise.all([
      reminderBadgeCount().catch(() => 0),
      supabase.from('announcements').select('id').is('deleted_at', null),
      supabase.from('announcement_reads').select('announcement_id').eq('profile_id', user.id),
    ])
    const read = new Set((reads.data || []).map(r => r.announcement_id))
    setBadges({ reminders: rem, updates: ann.error ? 0 : (ann.data || []).filter(a => !read.has(a.id)).length })
  }, [ownPage, user?.id])
  useEffect(() => { refreshBadges() }, [refreshBadges])
  // Reminder notifications link to /profile#reminders → open the Reminders panel.
  useEffect(() => {
    if (!ownPage) return
    const check = () => { if (window.location.hash === '#reminders') { setPanel('reminders'); history.replaceState(null, '', window.location.pathname) } }
    check(); window.addEventListener('hashchange', check); return () => window.removeEventListener('hashchange', check)
  }, [ownPage])

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    const { data: d, error } = await supabase.rpc('profile_page_data', { p_profile: profileId || null })
    if (error) setErr(/not allowed/i.test(error.message) ? "You don't have access to this profile." : error.message)
    else setData(d)
    setLoading(false)
  }, [profileId])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const onFocus = async () => {
      const { data: d } = await supabase.rpc('profile_page_data', { p_profile: profileId || null })
      if (d) setData(cur => cur ? { ...cur, projects: d.projects, open_task_count: d.open_task_count, tokens: d.tokens, hub: d.hub } : cur)
      refreshBadges()
    }
    window.addEventListener('focus', onFocus); return () => window.removeEventListener('focus', onFocus)
  }, [profileId, refreshBadges])

  if (loading) return <p className="page-sub">Loading…</p>
  if (err) return <div className="login-err" role="alert">{err}</div>
  const { person, job_roles: roles, tokens, projects, open_task_count: openCount, is_self: isSelf, hub, has_favorites: hasFavs } = data
  const patchPerson = (fields) => setData(d => ({ ...d, person: { ...d.person, ...fields } }))
  const first = (person.full_name || '').split(' ')[0]
  const certs = hub?.certs || []
  const passed = certs.filter(c => c.status === 'passed').length
  const todo = certs.length - passed
  const w = tokens?.wallet

  return (
    <div className="pd">
      <style>{PD_CSS}</style>
      {!isSelf && (
        <div className="card" style={{ marginBottom: 14 }} role="note">
          You are viewing <b>{person.full_name}</b>'s profile as an Admin or Owner. Only they can change their own photo and phone number.
        </div>
      )}
      <ProfileHeader person={person} isSelf={isSelf} userId={user?.id}
        projectCount={(projects || []).length} openTasks={openCount || 0}
        onPhotoChanged={(url) => patchPerson({ avatar_url: url })}
        onEditProfile={() => openSection('about')}
        badges={badges} onOpen={setPanel} />

      <div className="pd-grid">
        <div className="pd-main">
          {isSelf && <Checklist person={person} hasFavs={hasFavs} />}
          <MyWeek profileId={isSelf ? null : person.id} isSelf={isSelf} firstName={first} tz={isSelf ? person.timezone : null} />
          {isSelf && <MyMeetings userId={user?.id} tz={person.timezone} refreshKey={meetKey} onOpenCalendar={(opts) => setPanel({ kind: 'calendar', ...opts })} />}

          {person.is_agent && hub?.scorecard !== undefined && (
            <Section id="performance" icon="📈" title="Performance" summary={hub?.scorecard?.tier ? `Tier ${hub.scorecard.tier}` : null}>
              <PerformanceBody sc={hub?.scorecard} isSelf={isSelf} />
            </Section>
          )}
          <Section id="certs" icon="✅" title="Certifications"
            summary={certs.length ? [passed && `${passed} passed`, todo && `${todo} to do`].filter(Boolean).join(' · ') : 'None yet'}>
            <CertsBody certs={certs} isSelf={isSelf} />
          </Section>
          <Section id="about" icon="👤" title={isSelf ? 'About Me' : `About ${first}`} summary={[person.job_title, person.team].filter(Boolean).join(' · ') || person.full_name}>
            <About person={person} roles={roles} isSelf={isSelf} onPatch={patchPerson} />
          </Section>
          <Section id="gtky" icon="💗" iconColor="#EC4899" title={isSelf ? 'Get to Know Me' : `Get to Know ${first}`} summary="Favorites, fun facts and more">
            <GetToKnow personId={person.id} firstName={first} isSelf={isSelf} bare onSaved={() => setData(d => ({ ...d, has_favorites: true }))} />
          </Section>
          <Section id="tokens" icon="⭐" title="Tokens" summary={w ? <b style={{ color: 'var(--ink)', fontSize: 15 }}>{Number(w.balance).toLocaleString('en-US')}</b> : 'None yet'}>
            <TokensBody tokens={tokens} isSelf={isSelf} />
          </Section>
        </div>
        <aside className="pd-aside">
          <Inspiration />
          <NeedHelp />
          <AskTurri />
        </aside>
      </div>

      {openPanel === 'reminders' && <Drawer title="Reminders" width={760} onClose={() => { setPanel(null); refreshBadges() }}><RemindersPanel /></Drawer>}
      {openPanel?.kind === 'calendar' && (
        <Drawer title="My Calendar" width={1680} onClose={() => { setPanel(null); setMeetKey(k => k + 1) }}
          footer={<a href="/calendar" className="btn btn-ghost" style={{ fontSize: 13, textDecoration: 'none' }}>Open full Calendar</a>}>
          <CalendarPanel openEventId={openPanel.openEventId || null} startNew={!!openPanel.startNew} onChanged={() => setMeetKey(k => k + 1)} />
        </Drawer>
      )}
      {openPanel === 'calendar' && (
        <Drawer title="My Calendar" width={1680} onClose={() => { setPanel(null); setMeetKey(k => k + 1) }}
          footer={<a href="/calendar" className="btn btn-ghost" style={{ fontSize: 13, textDecoration: 'none' }}>Open full Calendar</a>}>
          <CalendarPanel onChanged={() => setMeetKey(k => k + 1)} />
        </Drawer>
      )}
      {openPanel === 'notes' && (
        <Drawer title="My Notes" closeDelay={900} onClose={() => setPanel(null)}
          footer={<a href="/notes" className="btn btn-ghost" style={{ fontSize: 13, textDecoration: 'none' }}>Open My Notes</a>}>
          <NotesPanel />
        </Drawer>
      )}
      {openPanel === 'updates' && (
        <Drawer title="Updates" width={900} onClose={() => { setPanel(null); refreshBadges() }}
          footer={<a href="/updates" className="btn btn-ghost" style={{ fontSize: 13, textDecoration: 'none' }}>Open Updates</a>}>
          <UpdatesPanel />
        </Drawer>
      )}
    </div>
  )
}

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

const COMMON_LANGUAGES = ['English', 'Spanish', 'Portuguese', 'French', 'Tagalog', 'Haitian Creole', 'Vietnamese', 'Mandarin', 'Arabic', 'ASL']
const inputSt = { padding: '6px 9px', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', fontFamily: 'inherit', fontSize: 13.5, background: 'var(--surface)', color: 'var(--ink)' }

function About({ person, roles = [], isSelf, onPatch }) {
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
    <div>
      <Anniversary startDate={person.start_date} firstName={(person.full_name || '').split(' ')[0]} isSelf={isSelf} />
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
      <div style={{ ...row, alignItems: 'flex-start' }}><span style={{ color: 'var(--ink-soft)' }}>Job roles</span>
        <span style={{ textAlign: 'right' }}>{roles.length === 0 ? <span className="page-sub" style={{ margin: 0 }}>No shifts in the last 90 days</span>
          : <span className="tag-picker" style={{ justifyContent: 'flex-end' }}>{roles.map(r => <span key={r} className="tag-opt on" style={{ cursor: 'default' }}>{r}</span>)}</span>}</span></div>
    </div>
  )
}

// ---------- Get to Know You (inside About) ----------
// Same card and form as the Get to Know You page. Everyone on the team can read
// these; only the person can edit their own (the database enforces both).
function GetToKnow({ personId, firstName, isSelf, onSaved, initial, loaded, bare }) {
  const { user } = useAuth()
  const [fav, setFav] = useState(loaded ? (initial || null) : undefined)
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    if (loaded) return
    let alive = true
    supabase.from('team_favorites').select('*').eq('profile_id', personId).maybeSingle()
      .then(({ data }) => { if (alive) setFav(data || null) })
    return () => { alive = false }
  }, [personId, loaded])
  const has = fav && Object.keys(fav).some(k => !['profile_id', 'updated_at'].includes(k) && fav[k] != null && fav[k] !== '')
  useEffect(() => {
    if (fav === undefined || !isSelf || window.location.hash !== '#get-to-know-you') return
    const el = document.getElementById('get-to-know-you'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [fav, isSelf])
  return (
    <div id="get-to-know-you" style={bare ? { scrollMarginTop: 80 } : { marginTop: 18, paddingTop: 14, borderTop: '2px solid var(--line)', scrollMarginTop: 80 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        {!bare && <><span style={{ fontSize: 17 }}>🎉</span>
        <h3 style={{ ...sectionTitle, margin: 0 }}>Get to Know {isSelf ? 'Me' : firstName || 'Them'}</h3></>}
        {isSelf && fav !== undefined && (
          <button className="btn btn-ghost" style={{ marginLeft: 'auto', fontSize: 12.5, padding: '4px 12px' }} onClick={() => setEditing(true)}>
            {has ? 'Edit' : 'Fill out'}
          </button>
        )}
      </div>
      {fav === undefined ? <p className="page-sub" style={{ margin: 0 }}>Loading…</p>
        : has ? <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}><FavoritesDetails fav={fav} /></div>
        : <p className="page-sub" style={{ margin: 0 }}>
            {isSelf ? 'Share a few favorites so the team can celebrate your birthday, order the right swag and get to know you.' : `${firstName || 'They'} hasn’t filled out their card yet.`}
          </p>}
      {isSelf && <div className="hint" style={{ marginTop: 8 }}>Everyone on the team can see this card. <a href="/get-to-know-you">See everyone’s cards</a></div>}
      {editing && user?.id && (
        <FavoritesEditor userId={user.id} row={fav}
          onClose={() => setEditing(false)}
          onSaved={(r) => { setFav(r); setEditing(false); onSaved && onSaved() }} />
      )}
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
    { done: !!person.avatar_url, label: 'Add a photo', hint: 'Use the camera button on your picture.' },
    { done: !!person.phone, label: 'Add your phone number', hint: 'In About, below.' },
    { done: (person.languages || []).length > 0, label: 'Add the languages you speak', hint: 'In About, below — helps route bilingual calls.' },
    { done: !!person.pronouns, label: 'Add your pronouns (optional)', hint: 'In About, below.', optional: true },
    { done: !!hasFavs, label: 'Fill out your Get to Know You card', href: '#get-to-know-you' },
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
// ---------- personal hub: this week, performance, certifications ----------
const pctOrDash = (v) => v == null ? '—' : `${Math.round(Number(v) * (Number(v) <= 1.5 ? 100 : 1))}%`

function PerformanceBody({ sc, isSelf }) {
  const stat = (label, value, sub) => (
    <div style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', minWidth: 0 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.03em' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.2, marginTop: 2 }}>{value}</div>
      {sub && <div className="page-sub" style={{ margin: 0, fontSize: 12 }}>{sub}</div>}
    </div>
  )
  if (!sc) return <p className="page-sub" style={{ margin: 0 }}>No scorecard data yet.</p>
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
        {stat('Hours (14 days)', sc.hours_14d != null ? Number(sc.hours_14d).toFixed(1) : '—', sc.scheduled_hours_14d != null ? `of ${Number(sc.scheduled_hours_14d).toFixed(1)} scheduled` : null)}
        {stat('QA score (30 days)', pctOrDash(sc.qa_score_30d), sc.qa_reviews_30d != null ? `${sc.qa_reviews_30d} review${Number(sc.qa_reviews_30d) === 1 ? '' : 's'}` : null)}
        {stat('Adherence (14 days)', pctOrDash(sc.adherence_14d))}
        {stat('Calls (30 days)', sc.calls_30d != null ? Number(sc.calls_30d).toLocaleString('en-US') : '—', sc.conversion_30d != null ? `${pctOrDash(sc.conversion_30d)} booked` : null)}
      </div>
      {sc.tier && <div style={{ marginTop: 10, fontSize: 13 }}>Tier: <b>{sc.tier}</b>{sc.hold_reason && <span className="page-sub" style={{ margin: '0 0 0 6px', fontSize: 12 }}>{sc.hold_reason}</span>}</div>}
      {isSelf && <ActionLink href="/scorecard">Open my scorecard</ActionLink>}
    </>
  )
}

function CertsBody({ certs, isSelf }) {
  const passed = certs.filter(c => c.status === 'passed')
  const todo = certs.filter(c => c.status !== 'passed')
  return (
    <>
      {certs.length === 0 ? <p className="page-sub" style={{ margin: 0 }}>No certifications yet.</p> : (
        <div style={{ maxHeight: 360, overflowY: 'auto' }}>
          {passed.map(c => (
            <div key={c.name} style={row}>
              <span>✅ {c.name}</span>
              <span className="page-sub" style={{ margin: 0, fontSize: 12.5, textAlign: 'right' }}>
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
      {isSelf && <div><ActionLink href="/my-certifications">View Certifications</ActionLink></div>}
    </>
  )
}

function TokensBody({ tokens, isSelf }) {
  const w = tokens?.wallet
  const recent = tokens?.recent || []
  return (
    <div>
      {!w ? <p className="page-sub" style={{ margin: 0 }}>No tokens yet.</p> : (
        <>
          <div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.1 }} aria-label="Token balance">{Number(w.balance).toLocaleString('en-US')}</div>
          <div className="page-sub" style={{ margin: '2px 0 8px' }}>{Number(w.lifetime_earned).toLocaleString('en-US')} earned · {Number(w.lifetime_redeemed).toLocaleString('en-US')} redeemed</div>
        </>
      )}
      {recent.length > 0 && <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', marginTop: 6 }}>Recent activity</div>}
      {recent.map((t, i) => (
        <div key={i} style={row}>
          <span>{t.reason || t.note || (t.kind === 'redeem' ? 'Redeemed' : 'Earned')}<span style={{ display: 'block', fontSize: 12, color: 'var(--ink-soft)' }}>{when(t.created_at)}</span></span>
          <span style={{ fontWeight: 700, color: t.delta >= 0 ? 'var(--passed)' : 'var(--ink)' }}>{t.delta >= 0 ? '+' : ''}{t.delta}</span>
        </div>
      ))}
      {isSelf && <ActionLink href="/tokens">View Tokens</ActionLink>}
    </div>
  )
}
