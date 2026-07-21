import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { RichContent } from '../lib/RichEditor'

// ============================================================
// HOME BASE — the company "home" page (formerly Opsis Weekly).
//
// One page, tailored to WHO is looking, driven entirely by their tags & role:
//   * Company Wins (incl. fill rate) — non-agent AND non-support only
//       (owner / admin / qa_reviewer / reviewer). Gated in the DB by
//       is_home_metrics_viewer(); the frontend flag just hides the card.
//   * Your Week — the viewer's OWN numbers only (get_home_my_stats, auth.uid()).
//   * Open Intervals — the trade board, filtered to the viewer's team tags.
//   * Updates — announcements, audience-scoped by RLS (my_tag_ids()).
//   * Spotlight / Tip / Quote — admin-curated weekly_picks, team-scoped by RLS.
//   * Upcoming / Need Help — calendar + static links.
//
// Card visibility: a card only renders when it actually has something in it.
// Empty cards (no company numbers yet, no updates, nothing on the calendar,
// no spotlight/tip/quote, no open intervals) are hidden entirely rather than
// showing an empty placeholder — so the page never looks padded out.
//
// Nothing here is per-client hard-coded: onboard a client, tag that team, and
// their agents automatically start seeing their own spotlight, updates, and
// trade intervals — everyone else sees nothing about it.
// ============================================================

const OPS_ROLES = ['owner', 'admin', 'qa_reviewer', 'reviewer']  // may see fill rate / floor totals
const CAT = {
  general:         { label: 'General',         color: '#6b7280' },
  command_center:  { label: 'Command Center',  color: '#0077b6' },
  client:          { label: 'Client',          color: '#1f8a53' },
  operational:     { label: 'Operational',     color: '#b45309' },
}

function greetWord() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}
function todayLabel() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}
function ymd(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}
function firstName(full) { return (full || '').trim().split(/\s+/)[0] || 'there' }
function timeLabel(t) {
  if (!t) return ''
  const [h, m] = String(t).split(':')
  const hr = parseInt(h, 10)
  const ap = hr >= 12 ? 'PM' : 'AM'
  const h12 = ((hr + 11) % 12) + 1
  return `${h12}:${m} ${ap}`
}

export default function OpsisWeekly() {
  const { user, roles = [], isAdmin } = useAuth()
  const canSeeCompany = roles.some(r => OPS_ROLES.includes(r))
  const isAgent = roles.includes('agent')

  const [me, setMe] = useState(null)
  const [myStats, setMyStats] = useState(null)
  const [coStats, setCoStats] = useState(null)
  const [anns, setAnns] = useState([])
  const [events, setEvents] = useState([])
  const [trades, setTrades] = useState([])
  const [picks, setPicks] = useState([])
  const [names, setNames] = useState({})
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const uid = user?.id
    if (!uid) { setLoading(false); return }

    // profile + the schedules this person is assigned to (their audience)
    const { data: prof } = await supabase.from('profiles').select('id, full_name').eq('id', uid).single()
    setMe(prof)
    const { data: aud } = await supabase.from('schedule_audience').select('schedule_id').eq('profile_id', uid)
    const myAudIds = new Set((aud || []).map(a => a.schedule_id))

    // stats (company only fetched when allowed; RPC is the real gate)
    const [msRes, coRes] = await Promise.all([
      supabase.rpc('get_home_my_stats'),
      canSeeCompany ? supabase.rpc('get_home_company_stats') : Promise.resolve({ data: null }),
    ])
    setMyStats(msRes.data || null)
    setCoStats(coRes.data || null)

    // announcements (RLS scopes audience)
    const { data: a } = await supabase.from('announcements')
      .select('*').is('deleted_at', null)
      .order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(4)
    setAnns(a || [])

    // upcoming events, this week
    const today = new Date()
    const in7 = new Date(); in7.setDate(in7.getDate() + 7)
    const { data: ev } = await supabase.from('calendar_events')
      .select('*').gte('event_date', ymd(today)).lte('event_date', ymd(in7))
      .order('event_date').order('start_time').limit(12)
    setEvents((ev || []).filter(e => e.scope !== 'personal' || e.owner_id === uid).slice(0, 6))

    // open trade-board intervals — only on schedules this person is assigned to
    let tr = []
    if (isAgent) {
      const { data: raw } = await supabase.from('interval_trades')
        .select('id, offered_by, status, shift_blocks!inner(schedule_id, block_date, start_time, end_time, role)')
        .eq('status', 'open')
      tr = (raw || []).filter(t => t.offered_by !== uid && myAudIds.has(t.shift_blocks?.schedule_id)).slice(0, 5)
    }
    setTrades(tr)

    // weekly picks (RLS scopes)
    const { data: pk } = await supabase.from('weekly_picks').select('*').eq('active', true).order('updated_at', { ascending: false })
    setPicks(pk || [])

    // resolve names for authors / spotlight people / trade offerers
    const ids = new Set()
    ;(a || []).forEach(x => x.author_id && ids.add(x.author_id))
    ;(pk || []).forEach(x => x.spotlight_profile_id && ids.add(x.spotlight_profile_id))
    tr.forEach(x => x.offered_by && ids.add(x.offered_by))
    if (ids.size) {
      const { data: pr } = await supabase.from('profiles').select('id, full_name').in('id', [...ids])
      const map = {}; (pr || []).forEach(p => map[p.id] = p.full_name); setNames(map)
    }

    setLoading(false)
  }, [user?.id, canSeeCompany, isAgent])

  useEffect(() => { load() }, [load])

  const spotlights = picks.filter(p => p.kind === 'spotlight')
  const tip = picks.find(p => p.kind === 'tip')
  const quote = picks.find(p => p.kind === 'quote')

  if (loading) return <div className="page"><p className="page-sub">Loading your week…</p></div>

  return (
    <div className="page" style={{ maxWidth: 1120 }}>
      <style>{`
        .ow-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;align-items:start;}
        .ow-span2{grid-column:span 2;}
        .ow-metrics{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;}
        .ow-metrics.mine{grid-template-columns:1fr 1fr 1fr;}
        @media(max-width:880px){
          .ow-grid{grid-template-columns:1fr;}
          .ow-span2{grid-column:span 1;}
          .ow-metrics,.ow-metrics.mine{grid-template-columns:1fr 1fr;}
        }
      `}</style>
      {/* hero */}
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 27, fontWeight: 700, letterSpacing: '-.4px' }}>{greetWord()}, {firstName(me?.full_name)} 👋</h1>
        <div style={{ color: 'var(--ink-soft)', fontSize: 14.5, marginTop: 3, fontWeight: 500 }}>{todayLabel()}</div>
      </div>

      {isAdmin && <PicksAdmin onChanged={load} spotlights={spotlights} tip={tip} quote={quote} names={names} />}

      <div className="ow-grid">

        {/* Company Wins — non-agent, non-support only; hidden until there are numbers */}
        {canSeeCompany && coStats && (
          <Card span2 title="Yesterday's Wins" ico="📈" tag="All clients">
            <div className="ow-metrics">
              <Stat val={coStats.bookings} lbl="Appointments booked" prev={coStats.bookings_prev} />
              <Stat val={fmtPct(coStats.fill_rate)} lbl="Schedule fill rate" prev={coStats.fill_rate_prev} cur={coStats.fill_rate} pct />
              <Stat val={coStats.contacts} lbl="Contacts reached" prev={coStats.contacts_prev} />
              <Stat val={fmtPct(coStats.qa)} lbl="Avg. QA (7-day)" prev={coStats.qa_prev} cur={coStats.qa} pct />
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 12, paddingTop: 10, borderTop: '1px dashed var(--line)' }}>
              🔒 Fill rate & floor totals are visible to leads & admins only — never to agents or support.
            </div>
          </Card>
        )}

        {/* Your Week — the viewer's OWN numbers */}
        {isAgent && (
          <Card span2={!canSeeCompany} title="Your Week So Far" ico="✅" tag="Just you">
            <div className="ow-metrics mine">
              <Stat val={myStats?.bookings ?? 0} lbl="Appointments you booked" />
              <Stat val={fmtPct(myStats?.qa)} lbl="Your QA (7-day)" />
              <Stat val={myStats?.hours ?? 0} lbl="Hours worked" />
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 12, paddingTop: 10, borderTop: '1px dashed var(--line)' }}>
              🔒 Only your own numbers — never a teammate's or a floor total.
            </div>
          </Card>
        )}

        {/* Open intervals (trade board) */}
        {isAgent && trades.length > 0 && (
          <Card span2 title="Open Intervals — Up for Grabs" ico="🔁" tag="Your schedule">
            {trades.map(t => (
              <div key={t.id} style={row}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{fmtDate(t.shift_blocks.block_date)} · {timeLabel(t.shift_blocks.start_time)}–{timeLabel(t.shift_blocks.end_time)}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>Offered by {names[t.offered_by]?.split(' ')[0] || 'a teammate'} · {t.shift_blocks.role}</div>
                </div>
                <a className="btn btn-primary" href="/schedule" style={{ fontSize: 12, padding: '7px 14px', textDecoration: 'none' }}>Go accept</a>
              </div>
            ))}
            <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 10 }}>Accept any of these from the Schedule → Trade board.</div>
          </Card>
        )}

        {/* Updates — hidden until there is at least one */}
        {anns.length > 0 && (
          <Card span2 title="Updates" ico="📣" tag={canSeeCompany ? 'All clients' : 'Your teams + general'}>
            {anns.map(a => {
              const c = CAT[a.category] || CAT.general
              return (
                <div key={a.id} style={{ padding: '11px 0', borderTop: '1px solid var(--line-soft)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em', padding: '2px 8px', borderRadius: 20, background: c.color + '22', color: c.color }}>{c.label}</span>
                    {a.pinned && <span title="Pinned" style={{ fontSize: 11 }}>📌</span>}
                  </div>
                  <div style={{ fontSize: 13.5, fontWeight: 600, margin: '6px 0 2px' }}>{a.title}</div>
                  {a.body && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}><RichContent html={a.body} /></div>}
                  <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 5, opacity: .85 }}>
                    {names[a.author_id] || 'Someone'} · {new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </div>
                </div>
              )
            })}
            <div style={{ marginTop: 12 }}><a href="/updates" style={link}>See all updates →</a></div>
          </Card>
        )}

        {/* Spotlight */}
        {spotlights.length > 0 && (
          <Card title="Team Spotlight" ico="⭐" tag="Weekly pick">
            {spotlights.slice(0, 3).map((s, i) => (
              <div key={s.id} style={{ marginTop: i ? 14 : 0 }}>
                <div style={{ display: 'flex', gap: 13, alignItems: 'center' }}>
                  <div style={avatar}>{initials(names[s.spotlight_profile_id])}</div>
                  <div><div style={{ fontSize: 15, fontWeight: 700 }}>{names[s.spotlight_profile_id] || 'Team member'}</div></div>
                </div>
                {s.blurb && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 9 }}>{s.blurb}</div>}
              </div>
            ))}
          </Card>
        )}

        {/* Upcoming — hidden until there is something on the calendar */}
        {events.length > 0 && (
          <Card title="Upcoming This Week" ico="🗓️" tag="Auto">
            {events.map(e => {
              const d = new Date(e.event_date + 'T00:00:00')
              return (
                <div key={e.id} style={{ display: 'flex', gap: 12, padding: '9px 0', borderTop: '1px solid var(--line-soft)', alignItems: 'center' }}>
                  <div style={{ flex: 'none', width: 44, textAlign: 'center' }}>
                    <div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1 }}>{d.getDate()}</div>
                    <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--ink-soft)', letterSpacing: '.04em' }}>{d.toLocaleDateString('en-US', { weekday: 'short' })}</div>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{e.title}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{e.all_day ? 'All day' : timeLabel(e.start_time)}</div>
                  </div>
                </div>
              )
            })}
          </Card>
        )}

        {/* Tip */}
        {tip?.body && (
          <Card title="Tip of the Day" ico="💡" tag="Weekly pick">
            <div style={{ fontSize: 13.5 }}>{tip.body}</div>
          </Card>
        )}

        {/* Inspiration */}
        {quote?.body && (
          <Card title="Daily Inspiration" ico="🌟" tag="Weekly pick">
            <div style={{ fontSize: 15, fontStyle: 'italic', lineHeight: 1.55 }}>
              "{quote.body}"
              {quote.author && <span style={{ display: 'block', fontStyle: 'normal', fontSize: 12, color: 'var(--ink-soft)', marginTop: 8, fontWeight: 600 }}>— {quote.author}</span>}
            </div>
          </Card>
        )}

        {/* Help */}
        <Card span2 title="Need Help?" ico="🛟" tag="Auto">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 9 }}>
            <a style={helpLink} href="/knowledge">📚 Knowledge Base</a>
            <a style={helpLink} href="/help">🎫 Help Center</a>
            <a style={helpLink} href="/chat">💬 Ask in Chat</a>
            <a style={helpLink} href="/schedule">🗓️ My Schedule</a>
          </div>
        </Card>

      </div>
    </div>
  )
}

// ---- weekly picks admin editor (admins only) ----
function PicksAdmin({ onChanged, spotlights, tip, quote, names }) {
  const [open, setOpen] = useState(false)
  const [profiles, setProfiles] = useState([])
  const [teams, setTeams] = useState([])
  const [spPid, setSpPid] = useState('')
  const [spBlurb, setSpBlurb] = useState('')
  const [spTeam, setSpTeam] = useState('')
  const [tipText, setTipText] = useState('')
  const [qText, setQText] = useState('')
  const [qBy, setQBy] = useState('')
  const [busy, setBusy] = useState('')

  useEffect(() => {
    if (!open) return
    supabase.from('profiles').select('id, full_name').eq('is_active', true).order('full_name')
      .then(({ data }) => setProfiles(data || []))
    supabase.from('tags').select('id, name').eq('namespace', 'team').order('name')
      .then(({ data }) => setTeams(data || []))
    setTipText(tip?.body || ''); setQText(quote?.body || ''); setQBy(quote?.author || '')
  }, [open]) // eslint-disable-line

  async function addSpotlight() {
    if (!spPid) return
    setBusy('sp')
    await supabase.from('weekly_picks').insert({
      kind: 'spotlight', spotlight_profile_id: spPid, blurb: spBlurb.trim() || null,
      audience_tags: spTeam ? [spTeam] : [],
    })
    setSpPid(''); setSpBlurb(''); setSpTeam(''); setBusy(''); onChanged()
  }
  async function removePick(id) {
    setBusy(id)
    await supabase.from('weekly_picks').update({ active: false }).eq('id', id)
    setBusy(''); onChanged()
  }
  async function saveSingle(kind, payload) {
    setBusy(kind)
    await supabase.from('weekly_picks').update({ active: false }).eq('kind', kind).eq('active', true)
    await supabase.from('weekly_picks').insert({ kind, active: true, ...payload })
    setBusy(''); onChanged()
  }

  return (
    <div className="card" style={{ padding: 0, marginBottom: 16, border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
      <button onClick={() => setOpen(o => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '12px 18px', border: 0, background: 'var(--canvas)', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--ink)', textAlign: 'left' }}>
        <span>🛠️</span><b style={{ fontSize: 13 }}>Manage this week's picks</b>
        <span style={{ marginLeft: 'auto', fontSize: 11, opacity: .7, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▸</span>
      </button>
      {open && (
        <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* spotlight */}
          <div>
            <div style={adminLbl}>⭐ Spotlights <span style={{ fontWeight: 400, color: 'var(--ink-soft)' }}>— add one per team; leave team blank for everyone</span></div>
            {spotlights.map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
                <span style={{ fontSize: 13, flex: 1 }}><b>{names[s.spotlight_profile_id] || 'Team member'}</b>{s.audience_tags?.length ? '' : ' · everyone'} {s.blurb ? `— ${s.blurb}` : ''}</span>
                <button className="btn btn-ghost" style={{ fontSize: 11, padding: '3px 8px', color: 'var(--failed)' }} disabled={busy === s.id} onClick={() => removePick(s.id)}>Remove</button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
              <select value={spPid} onChange={e => setSpPid(e.target.value)} style={adminInp}>
                <option value="">Choose a person…</option>
                {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
              <select value={spTeam} onChange={e => setSpTeam(e.target.value)} style={adminInp}>
                <option value="">Everyone</option>
                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <input value={spBlurb} onChange={e => setSpBlurb(e.target.value)} placeholder="Why they're the spotlight…" style={{ ...adminInp, flex: '1 1 240px' }} />
              <button className="btn btn-primary" style={{ fontSize: 12, padding: '7px 13px' }} disabled={busy === 'sp' || !spPid} onClick={addSpotlight}>Add</button>
            </div>
          </div>

          {/* tip */}
          <div>
            <div style={adminLbl}>💡 Tip of the day</div>
            <textarea value={tipText} onChange={e => setTipText(e.target.value)} placeholder="A short productivity or service tip…" style={{ ...adminInp, width: '100%', minHeight: 56, resize: 'vertical' }} />
            <div style={{ marginTop: 6 }}><button className="btn btn-primary" style={{ fontSize: 12, padding: '7px 13px' }} disabled={busy === 'tip'} onClick={() => saveSingle('tip', { body: tipText.trim() || null })}>Save tip</button></div>
          </div>

          {/* quote */}
          <div>
            <div style={adminLbl}>🌟 Daily inspiration</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input value={qText} onChange={e => setQText(e.target.value)} placeholder="Quote…" style={{ ...adminInp, flex: '1 1 320px' }} />
              <input value={qBy} onChange={e => setQBy(e.target.value)} placeholder="Author (optional)" style={{ ...adminInp, flex: '1 1 160px' }} />
            </div>
            <div style={{ marginTop: 6 }}><button className="btn btn-primary" style={{ fontSize: 12, padding: '7px 13px' }} disabled={busy === 'quote'} onClick={() => saveSingle('quote', { body: qText.trim() || null, author: qBy.trim() || null })}>Save quote</button></div>
          </div>

        </div>
      )}
    </div>
  )
}

// ---- small pieces ----
function Card({ title, ico, tag, span2, children }) {
  return (
    <div className={'card' + (span2 ? ' ow-span2' : '')} style={{ padding: '18px 20px', borderRadius: 14, border: '1px solid var(--line)' }}>
      <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--ink-soft)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 14 }}>{ico}</span> {title}
        {tag && <span style={{ marginLeft: 'auto', fontSize: 9.5, fontWeight: 700, letterSpacing: '.04em', padding: '2px 7px', borderRadius: 20, background: 'var(--accent-bg)', color: 'var(--accent)' }}>{tag}</span>}
      </div>
      {children}
    </div>
  )
}
function Stat({ val, lbl, prev, cur, pct }) {
  const base = pct ? cur : (typeof val === 'number' ? val : null)
  let d = null
  if (prev != null && base != null) { const diff = base - prev; d = { up: diff > 0, flat: diff === 0, val: Math.abs(diff) } }
  return (
    <div style={{ background: 'var(--canvas)', borderRadius: 10, padding: 14 }}>
      <div style={{ fontSize: 25, fontWeight: 700, letterSpacing: '-.5px', lineHeight: 1.1 }}>{val ?? '—'}</div>
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 3 }}>{lbl}</div>
      {d && !d.flat && <div style={{ fontSize: 11, fontWeight: 600, marginTop: 6, color: d.up ? 'var(--passed)' : 'var(--failed)' }}>{d.up ? '▲' : '▼'} {d.val}{pct ? ' pts' : ''} vs. prior</div>}
    </div>
  )
}
function Empty({ children }) { return <div style={{ fontSize: 13, color: 'var(--ink-soft)', padding: '6px 0' }}>{children}</div> }
function initials(name) { const p = (name || '?').trim().split(/\s+/); return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?' }
function fmtPct(v) { return v == null ? '—' : v + '%' }
function fmtDate(d) { return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) }

const row = { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid var(--line-soft)' }
const link = { fontSize: 12.5, fontWeight: 600, color: 'var(--accent)', textDecoration: 'none' }
const helpLink = { display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 600, color: 'var(--accent)', background: 'var(--accent-bg)', borderRadius: 9, padding: '9px 13px', textDecoration: 'none' }
const avatar = { width: 50, height: 50, borderRadius: '50%', flex: 'none', display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 700, fontSize: 17, background: 'linear-gradient(135deg,#0077B6,#245866)' }
const adminLbl = { fontSize: 12.5, fontWeight: 700, marginBottom: 8 }
const adminInp = { padding: '7px 9px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--ink)' }
