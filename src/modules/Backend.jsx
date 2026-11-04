import { useEffect, useMemo, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { notifySpotlight } from '../lib/notify'

// ============================================================
// BACKEND (2026-11-04) — where authorized staff manage the content that powers Command Center.
//  • 💬 Daily Quotes: a quote library. One quote shows each day on its own (pinned-to-today first,
//    then the one shown longest ago), changed every morning by rotate_daily_quote().
//    Add one at a time or paste a whole batch. Opsis Weekly shows today's quote as before.
//  • ⭐ Spotlight: post the weekly spotlight (person, why, which team). Posting replaces the
//    current spotlight for THAT team only. The person is notified.
// Who: "Manage daily quotes" / "Post the weekly spotlight" checkboxes (or admins in the old system).
// ============================================================

const CSS = `
.bk-in { width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 9px; font: inherit; font-size: 13.5px; background: var(--surface); color: var(--ink); box-sizing: border-box; }
.bk-msg { padding: 9px 12px; border-radius: 9px; font-size: 13px; margin-bottom: 12px; }
.bk-msg.ok { background: #ECFDF5; color: #047857; } .bk-msg.err { background: #FEF2F2; color: #B91C1C; }
.bk-link { border: 0; background: transparent; color: var(--accent); font-weight: 700; font-size: 12.5px; cursor: pointer; font-family: inherit; padding: 2px 4px; }
.bk-row { display: flex; gap: 12px; align-items: flex-start; padding: 11px 16px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
.bk-chip { font-size: 11px; font-weight: 700; padding: 1px 8px; border-radius: 999px; background: var(--canvas); color: var(--ink-soft); white-space: nowrap; }
`
const friendly = (e) => {
  const m = String(e?.message || e || '')
  if (/row-level security|permission denied/i.test(m)) return "You don't have permission to make that change."
  if (/quote_library_unique_body|duplicate key/i.test(m)) return 'That quote is already in the library.'
  return m.replace(/^.*?ERROR:\s*/, '') || 'Something went wrong — please try again.'
}
const todayET = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const fmtDay = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''

// "Quote — Author", "Quote - Author", "Quote ~ Author", or "“Quote” Author" → { body, author }
function parseLine(line) {
  let t = line.trim().replace(/^[-•*\d.)\s]+(?=["“A-Za-z])/, '')
  if (!t) return null
  let author = null
  const m = t.match(/^(.*?)\s+(?:—|–|-{1,2}|~)\s+([^—–~]{2,80})$/)
  if (m) { t = m[1]; author = m[2].trim() }
  t = t.trim().replace(/^["“”']+|["“”']+$/g, '').trim()
  return t.length >= 3 ? { body: t, author: author || null } : null
}

// ---------------------------- 💬 Daily Quotes ----------------------------
export function DailyQuotes() {
  const [quotes, setQuotes] = useState(null)
  const [today, setToday] = useState(null)       // { body, author }
  const [log, setLog] = useState([])
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')    // all | never | paused | pinned
  const [one, setOne] = useState({ body: '', author: '' })
  const [bulk, setBulk] = useState('')
  const [showBulk, setShowBulk] = useState(false)
  const [sure, setSure] = useState(null)

  const load = useCallback(async () => {
    const [lib, pk, lg] = await Promise.all([
      supabase.from('quote_library').select('*').order('created_at', { ascending: false }),
      supabase.from('weekly_picks').select('body, author').eq('kind', 'quote').eq('active', true).limit(1),
      supabase.from('quote_rotation_log').select('shown_on, quote_id').order('shown_on', { ascending: false }).limit(14),
    ])
    if (lib.error) setMsg({ kind: 'err', text: friendly(lib.error) })
    setQuotes(lib.data || []); setToday(pk.data?.[0] || null); setLog(lg.data || [])
  }, [])
  useEffect(() => { load() }, [load])

  async function run(fn, ok) {
    setBusy(true); setMsg(null)
    const { error } = await fn()
    setBusy(false)
    if (error) { setMsg({ kind: 'err', text: friendly(error) }); return false }
    await load(); if (ok) setMsg({ kind: 'ok', text: ok }); return true
  }
  const parsedBulk = useMemo(() => bulk.split(/\r?\n/).map(parseLine).filter(Boolean), [bulk])
  const existing = useMemo(() => new Set((quotes || []).map(x => x.body.trim().toLowerCase())), [quotes])
  const newCount = useMemo(() => new Set(parsedBulk.map(r => r.body.toLowerCase()).filter(k => !existing.has(k))).size, [parsedBulk, existing])

  async function addOne() {
    const body = one.body.trim(); if (body.length < 3) return
    if (await run(() => supabase.from('quote_library').insert({ body, author: one.author.trim() || null }), 'Added to the library.')) setOne({ body: '', author: '' })
  }
  async function addBulk() {
    const seen = new Set(), rows = []
    for (const r of parsedBulk) { const k = r.body.toLowerCase(); if (!existing.has(k) && !seen.has(k)) { seen.add(k); rows.push(r) } }
    if (!rows.length) return setMsg({ kind: 'err', text: 'Those quotes are all already in the library.' })
    const skipped = parsedBulk.length - rows.length
    if (await run(() => supabase.from('quote_library').insert(rows), `Added ${rows.length} quote${rows.length === 1 ? '' : 's'}${skipped ? ` (${skipped} already in the library, skipped)` : ''}. They'll rotate in automatically.`)) { setBulk(''); setShowBulk(false) }
  }
  const showNow = (x) => run(() => supabase.rpc('rotate_daily_quote', { p_quote: x?.id || null, p_force: true }), x ? 'Today’s quote changed.' : 'Picked the next quote for today.')
  const setActive = (x, active) => run(() => supabase.from('quote_library').update({ active }).eq('id', x.id), active ? 'Back in rotation.' : 'Paused — it won’t be picked.')
  const setPin = (x, date) => run(() => supabase.from('quote_library').update({ pinned_on: date || null }).eq('id', x.id), date ? `Pinned to ${fmtDay(date)}.` : 'Unpinned.')
  async function remove(x) {
    if (sure !== x.id) { setSure(x.id); return }
    setSure(null)
    await run(() => supabase.from('quote_library').delete().eq('id', x.id), 'Removed from the library.')
  }

  if (!quotes) return <p className="page-sub">Loading quotes…</p>
  const t = todayET()
  const tl = q.trim().toLowerCase()
  const shown = quotes.filter(x => (!tl || x.body.toLowerCase().includes(tl) || (x.author || '').toLowerCase().includes(tl))
    && (filter === 'all' || (filter === 'never' && !x.times_shown) || (filter === 'paused' && !x.active) || (filter === 'pinned' && x.pinned_on)))
  const activeCount = quotes.filter(x => x.active).length
  const unseen = quotes.filter(x => x.active && !x.times_shown).length
  // what tomorrow will probably show (pinned for tomorrow, else oldest-shown)
  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const next = quotes.find(x => x.active && x.pinned_on === tomorrow)
    || [...quotes].filter(x => x.active && !x.pinned_on).sort((a, b) => (a.last_shown_on || '').localeCompare(b.last_shown_on || '') || a.times_shown - b.times_shown)[0]

  return (
    <div>
      <style>{CSS}</style>
      <h1 className="page-title">💬 Daily Quotes</h1>
      <p className="page-sub">Build a library and a new quote shows on Opsis Weekly every morning on its own — it works through the quotes shown longest ago first, so nothing repeats until the whole library has had a turn.</p>
      {msg && <div className={'bk-msg ' + msg.kind}>{msg.text}</div>}

      <div className="card" style={{ padding: 18, marginBottom: 16, display: 'grid', gridTemplateColumns: 'minmax(260px, 2fr) minmax(200px, 1fr)', gap: 18 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: 8 }}>Today's quote</div>
          {today ? (
            <div style={{ fontSize: 16, fontStyle: 'italic', lineHeight: 1.5 }}>“{today.body}”{today.author && <span style={{ display: 'block', fontStyle: 'normal', fontSize: 13, color: 'var(--ink-soft)', fontWeight: 600, marginTop: 6 }}>— {today.author}</span>}</div>
          ) : <div className="page-sub">None yet — add quotes below and pick one.</div>}
          <button className="btn btn-ghost" style={{ marginTop: 10 }} disabled={busy || !activeCount} onClick={() => showNow(null)}>🔄 Show the next one now</button>
        </div>
        <div style={{ fontSize: 13, display: 'grid', gap: 6, alignContent: 'start' }}>
          <div><b>{quotes.length}</b> in the library · <b>{activeCount}</b> in rotation</div>
          <div><b>{unseen}</b> not shown yet{activeCount ? ` · about ${activeCount} days before anything repeats` : ''}</div>
          {next && <div className="page-sub" style={{ fontSize: 12.5 }}>Tomorrow: “{next.body.length > 70 ? next.body.slice(0, 70) + '…' : next.body}”</div>}
          <div className="page-sub" style={{ fontSize: 12 }}>Changes automatically around 5 AM Eastern.</div>
        </div>
      </div>

      {/* add */}
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 14 }}>Add quotes</b>
          <button className="bk-link" onClick={() => setShowBulk(v => !v)}>{showBulk ? '← Add one at a time' : '📋 Paste a whole bunch at once'}</button>
        </div>
        {!showBulk ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input className="bk-in" style={{ flex: '3 1 320px' }} maxLength={600} placeholder="Quote…" value={one.body} onChange={e => setOne(o => ({ ...o, body: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') addOne() }} />
            <input className="bk-in" style={{ flex: '1 1 160px' }} maxLength={80} placeholder="Author (optional)" value={one.author} onChange={e => setOne(o => ({ ...o, author: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') addOne() }} />
            <button className="btn btn-primary" disabled={busy || one.body.trim().length < 3} onClick={addOne}>＋ Add</button>
          </div>
        ) : (
          <div>
            <textarea className="bk-in" rows={8} value={bulk} onChange={e => setBulk(e.target.value)}
              placeholder={'One quote per line. Add the author after a dash, like:\nWell done is better than well said. — Benjamin Franklin\nQuality is not an act, it is a habit. - Aristotle\nSmall steps every day.'} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" disabled={busy || !newCount} onClick={addBulk}>＋ Add {newCount || ''} new quote{newCount === 1 ? '' : 's'}</button>
              {parsedBulk.length > 0 && <span className="page-sub" style={{ fontSize: 12.5 }}>{parsedBulk.filter(r => existing.has(r.body.toLowerCase())).length ? `${parsedBulk.filter(r => existing.has(r.body.toLowerCase())).length} already in the library will be skipped · ` : ''}First one reads: “{parsedBulk[0].body.slice(0, 60)}{parsedBulk[0].body.length > 60 ? '…' : ''}”{parsedBulk[0].author ? ` — ${parsedBulk[0].author}` : ''}</span>}
            </div>
          </div>
        )}
      </div>

      {/* library */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <b style={{ fontSize: 14, marginRight: 'auto' }}>Library</b>
          <select className="bk-in" style={{ width: 'auto' }} value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="all">All quotes</option><option value="never">Not shown yet</option><option value="pinned">Pinned to a date</option><option value="paused">Paused</option>
          </select>
          <input className="bk-in" style={{ maxWidth: 260 }} placeholder="Search quotes or authors…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        {shown.length === 0 && <div className="page-sub" style={{ padding: 18 }}>{quotes.length ? 'Nothing matches.' : 'No quotes yet — add some above.'}</div>}
        {shown.map(x => (
          <div key={x.id} className="bk-row" style={{ opacity: x.active ? 1 : .55 }}>
            <div style={{ flex: '1 1 320px', minWidth: 0 }}>
              <div style={{ fontSize: 14 }}>“{x.body}”{x.author && <span className="page-sub" style={{ fontSize: 12.5 }}> — {x.author}</span>}</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
                <span className="bk-chip">{x.times_shown ? `Shown ${x.times_shown}× · last ${fmtDay(x.last_shown_on)}` : 'Not shown yet'}</span>
                {x.last_shown_on === t && <span className="bk-chip" style={{ background: '#ECFDF5', color: '#047857' }}>Today</span>}
                {x.pinned_on && <span className="bk-chip" style={{ background: '#FFFBEB', color: '#92400E' }}>📌 {fmtDay(x.pinned_on)}</span>}
                {!x.active && <span className="bk-chip">Paused</span>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="bk-link" disabled={busy || !x.active} onClick={() => showNow(x)} title="Make this today's quote">Show today</button>
              <label className="bk-link" style={{ position: 'relative' }} title="Show on a specific day">
                📌 {x.pinned_on ? 'Change date' : 'Pin to a date'}
                <input type="date" min={t} value={x.pinned_on || ''} onChange={e => setPin(x, e.target.value)} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
              </label>
              {x.pinned_on && <button className="bk-link" style={{ color: 'var(--ink-soft)' }} onClick={() => setPin(x, null)}>Unpin</button>}
              <button className="bk-link" style={{ color: 'var(--ink-soft)' }} onClick={() => setActive(x, !x.active)}>{x.active ? 'Pause' : 'Resume'}</button>
              <button className="bk-link" style={{ color: '#B91C1C' }} onClick={() => remove(x)}>{sure === x.id ? 'Click to confirm' : 'Remove'}</button>
            </div>
          </div>
        ))}
      </div>
      {log.length > 0 && (
        <p className="page-sub" style={{ fontSize: 12, marginTop: 10 }}>Quotes were picked on: {log.map(l => fmtDay(l.shown_on).replace(/, \d{4}$/, '')).join(' · ')}</p>
      )}
    </div>
  )
}

// ---------------------------- ⭐ Spotlight ----------------------------
export function Spotlight() {
  const { user } = useAuth()
  const [picks, setPicks] = useState(null)
  const [people, setPeople] = useState([])
  const [teams, setTeams] = useState([])
  const [form, setForm] = useState({ pid: '', team: '', blurb: '' })
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [pk, pp, tg] = await Promise.all([
      supabase.from('weekly_picks').select('*').eq('kind', 'spotlight').order('created_at', { ascending: false }).limit(60),
      supabase.from('profiles').select('id, full_name').eq('is_active', true).is('client_id', null).order('full_name'),
      supabase.from('tags').select('id, name').eq('namespace', 'team').order('name'),
    ])
    setPicks(pk.data || []); setPeople(pp.data || []); setTeams(tg.data || [])
  }, [])
  useEffect(() => { load() }, [load])

  const nameOf = (id) => people.find(p => p.id === id)?.full_name || 'Team member'
  const teamOf = (tags) => !tags?.length ? 'Everyone' : tags.map(id => teams.find(t => t.id === id)?.name || 'a team').join(', ')
  const sameAudience = (a = [], b = []) => a.length === b.length && a.every(x => b.includes(x))

  async function post() {
    if (!form.pid) return
    setBusy(true); setMsg(null)
    const aud = form.team ? [form.team] : []
    // replace the current spotlight for the SAME team only — other teams keep theirs
    const replace = (picks || []).filter(p => p.active && sameAudience(p.audience_tags || [], aud)).map(p => p.id)
    if (replace.length) {
      const { error } = await supabase.from('weekly_picks').update({ active: false }).in('id', replace)
      if (error) { setBusy(false); return setMsg({ kind: 'err', text: friendly(error) }) }
    }
    const { error } = await supabase.from('weekly_picks').insert({ kind: 'spotlight', active: true, spotlight_profile_id: form.pid, blurb: form.blurb.trim() || null, audience_tags: aud, updated_by: user?.id })
    if (error) { setBusy(false); return setMsg({ kind: 'err', text: friendly(error) }) }
    try { await notifySpotlight({ recipientId: form.pid, actorId: user?.id, actorName: nameOf(user?.id), blurb: form.blurb.trim() || null }) } catch (e) { console.error('spotlight notify failed:', e) }
    setBusy(false); setMsg({ kind: 'ok', text: `${nameOf(form.pid)} is this week's spotlight for ${teamOf(aud)} — they've been notified. 🎉` })
    setForm({ pid: '', team: '', blurb: '' }); load()
  }
  async function end(p) {
    setBusy(true); setMsg(null)
    const { error } = await supabase.from('weekly_picks').update({ active: false }).eq('id', p.id)
    setBusy(false)
    if (error) return setMsg({ kind: 'err', text: friendly(error) })
    setMsg({ kind: 'ok', text: `Ended ${nameOf(p.spotlight_profile_id)}'s spotlight.` }); load()
  }

  if (!picks) return <p className="page-sub">Loading…</p>
  const live = picks.filter(p => p.active), past = picks.filter(p => !p.active)
  return (
    <div>
      <style>{CSS}</style>
      <h1 className="page-title">⭐ Spotlight</h1>
      <p className="page-sub">Post the weekly spotlight. It shows on Opsis Weekly for the team you choose, and the person gets a notification. Each team can have its own.</p>
      {msg && <div className={'bk-msg ' + msg.kind}>{msg.text}</div>}

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <b style={{ fontSize: 14 }}>Post this week's spotlight</b>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginTop: 10 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)' }}>Who
            <select className="bk-in" style={{ marginTop: 4 }} value={form.pid} onChange={e => setForm(f => ({ ...f, pid: e.target.value }))}>
              <option value="">Choose a person…</option>{people.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select></label>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)' }}>Shown to
            <select className="bk-in" style={{ marginTop: 4 }} value={form.team} onChange={e => setForm(f => ({ ...f, team: e.target.value }))}>
              <option value="">Everyone</option>{teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select></label>
        </div>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)', marginTop: 10 }}>Why they're the spotlight
          <textarea className="bk-in" style={{ marginTop: 4 }} rows={3} maxLength={500} value={form.blurb} onChange={e => setForm(f => ({ ...f, blurb: e.target.value }))} placeholder="What they did this week that deserves a shout-out…" /></label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" disabled={busy || !form.pid} onClick={post}>⭐ Post spotlight</button>
          {form.pid && live.some(p => sameAudience(p.audience_tags || [], form.team ? [form.team] : [])) &&
            <span className="page-sub" style={{ fontSize: 12.5 }}>This replaces the current spotlight for {teamOf(form.team ? [form.team] : [])}.</span>}
        </div>
      </div>

      <div className="card" style={{ padding: 0, marginBottom: 16 }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}><b style={{ fontSize: 14 }}>Live now</b></div>
        {live.length === 0 && <div className="page-sub" style={{ padding: 16 }}>No spotlight is showing right now.</div>}
        {live.map(p => (
          <div key={p.id} className="bk-row">
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontWeight: 700 }}>⭐ {nameOf(p.spotlight_profile_id)} <span className="bk-chip">{teamOf(p.audience_tags)}</span></div>
              {p.blurb && <div className="page-sub" style={{ fontSize: 13, marginTop: 3 }}>{p.blurb}</div>}
              <div className="page-sub" style={{ fontSize: 12, marginTop: 3 }}>Posted {new Date(p.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
            </div>
            <button className="bk-link" style={{ color: '#B91C1C' }} disabled={busy} onClick={() => end(p)}>End spotlight</button>
          </div>
        ))}
      </div>

      {past.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}><b style={{ fontSize: 14 }}>Past spotlights</b></div>
          {past.slice(0, 30).map(p => (
            <div key={p.id} className="bk-row" style={{ padding: '8px 16px' }}>
              <span style={{ fontWeight: 600, minWidth: 160 }}>{nameOf(p.spotlight_profile_id)}</span>
              <span className="bk-chip">{teamOf(p.audience_tags)}</span>
              <span className="page-sub" style={{ fontSize: 12.5, flex: 1, minWidth: 200 }}>{p.blurb || ''}</span>
              <span className="page-sub" style={{ fontSize: 12 }}>{new Date(p.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
