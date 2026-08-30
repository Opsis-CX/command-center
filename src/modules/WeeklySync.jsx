import React, { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { RichEditor, RichContent, htmlToText, isEmptyHtml } from '../lib/RichEditor'

// ============================================================
// WEEKLY SYNC — each person submits a weekly update (7 sections);
// everything auto-assembles into one team "presentation" view.
// Team doc: everyone can read all; you edit your own.
// Due Monday 12pm EST (auto-nudge cron added separately).
// ============================================================

const SECTIONS = [
  { key: 'priorities', label: 'My Priorities', hint: 'Top focuses this week', icon: '🎯' },
  { key: 'in_progress', label: 'In Progress', hint: 'What\u2019s underway right now', icon: '🔄' },
  { key: 'completed', label: 'Completed', hint: 'Wins & done since last week', icon: '✅' },
  { key: 'risks_blockers', label: 'Risks & Blockers', hint: 'What\u2019s at risk or stuck', icon: '⚠️' },
  { key: 'help_needed', label: 'Help Needed', hint: 'Where you need support', icon: '🙋' },
  { key: 'pto_ooo', label: 'PTO / Out of Office', hint: 'Your availability this week', icon: '🌴' },
  { key: 'client_updates', label: 'Client Updates', hint: 'Status on clients you own (optional)', icon: '🏢' },
]

// Monday of the current week (ET), as YYYY-MM-DD
function currentMonday() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const day = (now.getDay() + 6) % 7 // 0 = Monday
  now.setDate(now.getDate() - day)
  return now.toISOString().slice(0, 10)
}
// The week people should be planning: NEXT week (you fill out next week's sync
// during the current week). Defaults the view here.
function defaultWeek() {
  return addWeeks(currentMonday(), 1)
}
function addWeeks(iso, n) {
  const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n * 7)
  return d.toISOString().slice(0, 10)
}
function weekLabel(iso) {
  const mon = new Date(iso + 'T00:00:00')
  const sun = new Date(mon); sun.setDate(sun.getDate() + 6)
  const f = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `Week of ${f(mon)} – ${f(sun)}`
}

// The instant this week locks: the Sunday that ends the week, 8:00pm America/New_York.
// Returns a Date (a true instant). After this moment, the week is read-only.
//
// Converting "8pm New York" to a UTC instant must respect DST. We use
// Intl.DateTimeFormat (which browsers implement consistently) to read what a
// candidate instant looks like in New York, then correct toward the target.
function zonedTimeToUtc(y, m, d, hour, minute, timeZone) {
  let ts = Date.UTC(y, m, d, hour, minute, 0)
  for (let i = 0; i < 2; i++) {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    })
    const p = Object.fromEntries(
      dtf.formatToParts(new Date(ts)).filter(x => x.type !== 'literal').map(x => [x.type, parseInt(x.value)])
    )
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute, p.second)
    ts += Date.UTC(y, m, d, hour, minute, 0) - shown
  }
  return new Date(ts)
}
function lockInstant(weekMondayIso) {
  // Lock at the Sunday 8pm ET immediately BEFORE this week starts.
  // That Sunday is the day before the week's Monday.
  const mon = new Date(weekMondayIso + 'T00:00:00')
  const sunBefore = new Date(mon); sunBefore.setDate(sunBefore.getDate() - 1)
  return zonedTimeToUtc(sunBefore.getFullYear(), sunBefore.getMonth(), sunBefore.getDate(), 20, 0, 'America/New_York')
}
// The soft "due" reminder: end of the Friday before the week starts (Friday of
// the current week = Monday minus 3 days). Used for messaging only, not a lock.
function dueLabel(weekMondayIso) {
  const mon = new Date(weekMondayIso + 'T00:00:00')
  const fri = new Date(mon); fri.setDate(fri.getDate() - 3)
  return fri.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}
function isWeekLocked(weekMondayIso) {
  return Date.now() >= lockInstant(weekMondayIso).getTime()
}
function lockLabel(weekMondayIso) {
  return lockInstant(weekMondayIso).toLocaleString('en-US', {
    timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  }) + ' ET'
}

export default function WeeklySync() {
  const { user } = useAuth()
  const userId = user?.id
  const [week, setWeek] = useState(defaultWeek())
  const [tab, setTab] = useState('mine')            // 'mine' | 'presentation'
  const [updates, setUpdates] = useState([])
  const [profiles, setProfiles] = useState([])
  const [hygiene, setHygiene] = useState([])   // per-person live task-board counts
  const [chat, setChat] = useState(null)       // team-chat volume for the week
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    // Sunday of the selected week — addWeeks gives next Monday, so back off a day.
    const weekEnd = new Date(new Date(week + 'T00:00:00').getTime() + 6 * 864e5).toISOString().slice(0, 10)
    const [upRes, profRes, hygRes, chatRes] = await Promise.all([
      supabase.from('weekly_updates').select('*').eq('week_start_date', week),
      supabase.from('profiles').select('id, full_name, role').eq('is_active', true).order('full_name'),
      supabase.rpc('weekly_task_hygiene'),
      supabase.rpc('weekly_team_chat_activity', { p_from: week, p_to: weekEnd }),
    ])
    setUpdates(upRes.data || [])
    setProfiles(profRes.data || [])
    setHygiene(hygRes.data || [])
    setChat(chatRes?.data?.ok ? chatRes.data : null)
    setLoading(false)
  }, [week])

  useEffect(() => { load() }, [load])
  function flash(m) { setToast(m); setTimeout(() => setToast(''), 2500) }

  const mine = updates.find(u => u.profile_id === userId)
  const nameOf = (id) => (profiles.find(p => p.id === id) || {}).full_name || 'Unknown'
  const hygieneOf = (id) => hygiene.find(h => h.profile_id === id)
  const locked = isWeekLocked(week)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
        <div>
          <h1 className="page-title">Weekly Sync</h1>
          <p className="page-sub">Everyone submits their update by Sunday at 8:00pm ET. After that the week locks — no further edits. It all rolls into one team review below.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-ghost" onClick={() => setWeek(w => addWeeks(w, -1))}>‹ Prev</button>
          <span style={{ fontSize: 13, fontWeight: 600, minWidth: 150, textAlign: 'center' }}>{weekLabel(week)}</span>
          <button className="btn btn-ghost" onClick={() => setWeek(w => addWeeks(w, 1))}>Next ›</button>
        </div>
      </div>

      {toast && <div className="card" style={{ padding: '8px 12px', marginBottom: 12, display: 'inline-block', color: 'var(--accent)', fontSize: 13 }}>{toast}</div>}

      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--line)', paddingBottom: 10 }}>
        <TabBtn active={tab === 'mine'} onClick={() => setTab('mine')}>My Update</TabBtn>
        <TabBtn active={tab === 'presentation'} onClick={() => setTab('presentation')}>Team Presentation</TabBtn>
      </div>

      {loading ? <p className="page-sub">Loading…</p> :
        tab === 'mine'
          ? <MyUpdate week={week} userId={userId} existing={mine} locked={locked} lockLabelText={lockLabel(week)} dueLabelText={dueLabel(week)} myHygiene={hygieneOf(userId)} onSaved={(msg) => { load(); flash(msg) }} />
          : <Presentation week={week} updates={updates} profiles={profiles} nameOf={nameOf} hygiene={hygiene} chat={chat} />
      }
    </div>
  )
}

function TabBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{ padding: '6px 14px', borderRadius: 8, border: 0, cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', background: active ? 'var(--accent-bg)' : 'transparent', color: active ? 'var(--accent)' : 'var(--ink-soft)' }}>
      {children}
    </button>
  )
}

// ---- Task-board hygiene (live counts from Project Management) ----
// Counts come from the weekly_task_hygiene() RPC: open (assigned & not done),
// past due, no due date, and unassigned tasks the person created. The RPC also
// returns each person's numbers from the previous week, so we can show movement.
// The goal for the three "problem" columns (past due, no due date, unassigned)
// is always 0 — the weekly review is where we drive them there.

// Small ▲/▼ tag showing the change since last week. For problem metrics lower is
// better, so a drop is green and a rise is red; neutral metrics (open) show grey.
// Renders nothing when there's no prior-week number yet (first week live).
function DeltaTag({ cur, prev, neutral = false }) {
  if (prev == null || cur == null) return null
  const d = cur - prev
  if (d === 0) return <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ink-soft)' }} title="No change from last week">±0</span>
  const arrow = d > 0 ? '▲' : '▼'
  const color = neutral ? 'var(--ink-soft)' : (d > 0 ? 'var(--failed)' : 'var(--passed)')
  return (
    <span style={{ fontSize: 10.5, fontWeight: 700, color }} title={`${d > 0 ? '+' : ''}${d} vs last week`}>
      {arrow}{Math.abs(d)}
    </span>
  )
}

function HygieneChips({ h }) {
  const open = h?.open_count || 0
  const pastDue = h?.past_due_count || 0
  const noDue = h?.no_due_count || 0
  const unassigned = h?.unassigned_created_count || 0
  const atGoal = pastDue === 0 && noDue === 0 && unassigned === 0
  const chip = (val, prev, label, tone, title) => {
    const hot = val > 0 && tone !== 'info'
    const bg = hot ? (tone === 'bad' ? 'var(--failed-bg)' : 'var(--needed-bg)') : 'var(--canvas)'
    const fg = hot ? (tone === 'bad' ? 'var(--failed)' : 'var(--needed)') : 'var(--ink-soft)'
    return (
      <span title={title} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5, fontSize: 12.5, fontWeight: 600, padding: '4px 10px', borderRadius: 999, border: '1px solid var(--line)', background: bg, color: fg }}>
        <b style={{ fontSize: 13.5, color: hot ? 'inherit' : 'var(--ink)' }}>{val}</b> {label}
        <DeltaTag cur={val} prev={prev} neutral={tone === 'info'} />
      </span>
    )
  }
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      {chip(open, h?.prev_open_count, 'open', 'info', 'Open tasks assigned to you (not done)')}
      {chip(pastDue, h?.prev_past_due_count, 'past due', 'bad', 'Assigned to you, not done, due date has passed · goal 0')}
      {chip(noDue, h?.prev_no_due_count, 'no due date', 'warn', 'Assigned to you, not done, missing a due date · goal 0')}
      {chip(unassigned, h?.prev_unassigned_created_count, 'unassigned', 'warn', 'Tasks you created that have no assignee · goal 0')}
      {atGoal && <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--passed)' }}>✓ at goal</span>}
    </div>
  )
}

function HygieneTable({ hygiene, profiles }) {
  const nameOf = (id) => (profiles.find(p => p.id === id) || {}).full_name || 'Unknown'
  const rows = (hygiene || [])
    .map(h => ({ ...h, name: nameOf(h.profile_id), problems: (h.past_due_count || 0) + (h.no_due_count || 0) + (h.unassigned_created_count || 0) }))
    .filter(r => (r.open_count || 0) > 0 || (r.unassigned_created_count || 0) > 0)
    .sort((a, b) => b.problems - a.problems || (b.open_count || 0) - (a.open_count || 0) || a.name.localeCompare(b.name))
  if (rows.length === 0) return null

  // Team totals (across the people shown) + whether any prior-week data exists yet.
  const t = rows.reduce((acc, r) => ({
    open: acc.open + (r.open_count || 0), pOpen: acc.pOpen + (r.prev_open_count || 0),
    pastDue: acc.pastDue + (r.past_due_count || 0), pPastDue: acc.pPastDue + (r.prev_past_due_count || 0),
    noDue: acc.noDue + (r.no_due_count || 0), pNoDue: acc.pNoDue + (r.prev_no_due_count || 0),
    unassigned: acc.unassigned + (r.unassigned_created_count || 0), pUnassigned: acc.pUnassigned + (r.prev_unassigned_created_count || 0),
    hasPrev: acc.hasPrev || r.prev_past_due_count != null,
  }), { open: 0, pOpen: 0, pastDue: 0, pPastDue: 0, noDue: 0, pNoDue: 0, unassigned: 0, pUnassigned: 0, hasPrev: false })

  const th = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--ink-soft)', padding: '8px 10px', verticalAlign: 'bottom' }
  const td = { padding: '8px 10px', fontSize: 13, borderTop: '1px solid var(--line-soft)' }
  // Problem columns: 0 = at goal (green), >0 = red/amber. Open is neutral.
  const valColor = (v, tone) => tone === 'info'
    ? (v > 0 ? 'var(--ink)' : 'var(--ink-soft)')
    : (v === 0 ? 'var(--passed)' : (tone === 'bad' ? 'var(--failed)' : 'var(--needed)'))
  const cell = (val, prev, tone) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1, lineHeight: 1.05 }}>
      <span style={{ fontWeight: 700, color: valColor(val, tone) }}>{val}</span>
      <DeltaTag cur={val} prev={prev} neutral={tone === 'info'} />
    </div>
  )
  const goalHead = (label, title) => (
    <th style={{ ...th, textAlign: 'right' }} title={title}>
      <div>{label}</div>
      <div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--passed)', letterSpacing: 0, textTransform: 'none' }}>Goal 0</div>
    </th>
  )
  return (
    <div className="card" style={{ padding: 16, marginBottom: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>🧹 Task board hygiene <span style={{ fontWeight: 500, color: 'var(--ink-soft)', fontSize: 12.5 }}>— live from Project Management</span></div>
        <a href="/projects" style={{ fontSize: 12.5, color: 'var(--accent)', fontWeight: 600 }}>Open the board →</a>
      </div>
      <p className="page-sub" style={{ marginTop: 0, fontSize: 12.5, marginBottom: 10 }}>Goal is 0 for past due, no due date, and unassigned. Arrows (▲▼) show the change since last week. Clear the highlighted numbers as you review: assign owners, add due dates, close or reschedule what's overdue.</p>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left' }}>Person</th>
              <th style={{ ...th, textAlign: 'right' }}>Open</th>
              {goalHead('Past due', 'Assigned & not done, due date has passed · goal 0')}
              {goalHead('No due date', 'Assigned & not done, missing a due date · goal 0')}
              {goalHead('Unassigned', 'Tasks they created with no assignee · goal 0')}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.profile_id}>
                <td style={{ ...td, fontWeight: 600 }}>{r.name}</td>
                <td style={{ ...td, textAlign: 'right' }}>{cell(r.open_count, r.prev_open_count, 'info')}</td>
                <td style={{ ...td, textAlign: 'right', background: r.past_due_count > 0 ? 'var(--failed-bg)' : 'transparent' }}>{cell(r.past_due_count, r.prev_past_due_count, 'bad')}</td>
                <td style={{ ...td, textAlign: 'right', background: r.no_due_count > 0 ? 'var(--needed-bg)' : 'transparent' }}>{cell(r.no_due_count, r.prev_no_due_count, 'warn')}</td>
                <td style={{ ...td, textAlign: 'right', background: r.unassigned_created_count > 0 ? 'var(--needed-bg)' : 'transparent' }}>{cell(r.unassigned_created_count, r.prev_unassigned_created_count, 'warn')}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td style={{ ...td, fontWeight: 700, borderTop: '2px solid var(--line)' }}>Team total <span style={{ fontWeight: 500, color: 'var(--ink-soft)', fontSize: 11 }}>· goal 0 / 0 / 0</span></td>
              <td style={{ ...td, textAlign: 'right', borderTop: '2px solid var(--line)' }}>{cell(t.open, t.hasPrev ? t.pOpen : null, 'info')}</td>
              <td style={{ ...td, textAlign: 'right', borderTop: '2px solid var(--line)', background: t.pastDue > 0 ? 'var(--failed-bg)' : 'transparent' }}>{cell(t.pastDue, t.hasPrev ? t.pPastDue : null, 'bad')}</td>
              <td style={{ ...td, textAlign: 'right', borderTop: '2px solid var(--line)', background: t.noDue > 0 ? 'var(--needed-bg)' : 'transparent' }}>{cell(t.noDue, t.hasPrev ? t.pNoDue : null, 'warn')}</td>
              <td style={{ ...td, textAlign: 'right', borderTop: '2px solid var(--line)', background: t.unassigned > 0 ? 'var(--needed-bg)' : 'transparent' }}>{cell(t.unassigned, t.hasPrev ? t.pUnassigned : null, 'warn')}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

function MyUpdate({ week, userId, existing, locked, lockLabelText, dueLabelText, myHygiene, onSaved }) {
  const [busy, setBusy] = useState(false)
  // One HTML value per section; htmlRefs holds the latest for each.
  const htmlRefs = useRef({})
  // Seed the current HTML values whenever the loaded update or week changes.
  const [seed, setSeed] = useState({})
  useEffect(() => {
    const init = {}
    SECTIONS.forEach(s => { init[s.key] = existing?.[s.key] || '' })
    htmlRefs.current = { ...init }
    setSeed(init)
  }, [existing, week])

  const submitted = !!existing?.submitted_at

  async function save(markSubmitted) {
    if (locked) { onSaved('This week is locked — no more edits.'); return }
    setBusy(true)
    const row = {
      profile_id: userId, week_start_date: week,
      ...Object.fromEntries(SECTIONS.map(s => {
        const html = htmlRefs.current[s.key] || ''
        return [s.key, isEmptyHtml(html) ? null : html]
      })),
      updated_at: new Date().toISOString(),
    }
    if (markSubmitted) row.submitted_at = new Date().toISOString()
    else if (existing?.submitted_at) row.submitted_at = existing.submitted_at

    const { error } = await supabase.from('weekly_updates')
      .upsert(row, { onConflict: 'profile_id,week_start_date' })
    setBusy(false)
    if (error) { onSaved('Error: ' + error.message); return }
    onSaved(markSubmitted ? 'Update submitted ✓' : 'Draft saved')
  }

  return (
    <div style={{ maxWidth: 720 }}>
      {myHygiene && (
        <div className="card" style={{ padding: 14, marginBottom: 16 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 8 }}>🧹 Your task board <span style={{ fontWeight: 500, color: 'var(--ink-soft)', fontSize: 12 }}>— tidy these up before you submit</span></div>
          <HygieneChips h={myHygiene} />
          <div style={{ marginTop: 8 }}><a href="/projects" style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>Open your board →</a></div>
        </div>
      )}
      {locked && (
        <div className="card" style={{ padding: '10px 14px', marginBottom: 16, background: 'var(--canvas)', border: '1px solid var(--line)', color: 'var(--ink-soft)', fontSize: 13, fontWeight: 500 }}>
          🔒 This week locked at {lockLabelText}. Submissions and edits are closed{submitted ? '. Your submitted update is shown below (read-only).' : ' — nothing was submitted for you this week.'}
        </div>
      )}
      {!locked && !submitted && (
        <div className="card" style={{ padding: '10px 14px', marginBottom: 16, background: 'var(--accent-bg)', border: '1px solid var(--line)', color: 'var(--ink-soft)', fontSize: 13, fontWeight: 500 }}>
          🗓 Due by end of day {dueLabelText}. Final cutoff is {lockLabelText}, when this week locks.
        </div>
      )}
      {submitted && !locked && (
        <div className="card" style={{ padding: '10px 14px', marginBottom: 16, background: 'var(--passed-bg)', border: '1px solid var(--passed)', color: 'var(--passed)', fontSize: 13, fontWeight: 500 }}>
          ✓ Submitted {new Date(existing.submitted_at).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}. You can still edit and re-save until {lockLabelText}.
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {SECTIONS.map(s => (
          <div key={s.key} className="card" style={{ padding: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, marginBottom: 2 }}>
              <span>{s.icon}</span> {s.label}
            </label>
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 8 }}>{s.hint}</div>
            {locked ? (
              (seed[s.key] && !isEmptyHtml(seed[s.key]))
                ? <div style={{ fontSize: 13, lineHeight: 1.6 }}><RichContent html={seed[s.key]} /></div>
                : <div style={{ fontSize: 13, color: 'var(--ink-soft)', fontStyle: 'italic' }}>—</div>
            ) : (
              <RichEditor
                key={s.key + ':' + week}
                value={seed[s.key] || ''}
                variant="chat"
                minHeight={70}
                placeholder={`${s.hint}…`}
                onChange={(html) => { htmlRefs.current[s.key] = html }}
              />
            )}
          </div>
        ))}
      </div>
      {!locked && (
        <div style={{ display: 'flex', gap: 10, marginTop: 16, position: 'sticky', bottom: 0, background: 'var(--canvas)', padding: '12px 0' }}>
          <button className="btn btn-ghost" onClick={() => save(false)} disabled={busy}>{busy ? 'Saving…' : 'Save draft'}</button>
          <button className="btn btn-primary" onClick={() => save(true)} disabled={busy}>{submitted ? 'Re-submit' : 'Submit update'}</button>
        </div>
      )}
    </div>
  )
}

// ---- Team chat activity ----
// "How are we developing our teams?" — message COUNTS only (never content), so
// this is safe to put on screen in the weekly sync regardless of who is in which
// channel. Team channels are called out separately from the general ones,
// because that split is the actual answer to the question.
function ChatActivity({ chat }) {
  if (!chat) return null
  const channels = chat.channels || []
  const teams = channels.filter(c => c.is_team)
  const others = channels.filter(c => !c.is_team)
  const delta = (cur, prev) => {
    const d = (cur || 0) - (prev || 0)
    if (!prev && !cur) return null
    const up = d > 0
    return <span style={{ fontSize: 11.5, fontWeight: 700, color: d === 0 ? 'var(--ink-soft)' : up ? 'var(--passed)' : 'var(--failed)' }}>
      {d === 0 ? '±0' : `${up ? '▲' : '▼'}${Math.abs(d)}`}
    </span>
  }
  const row = (c) => (
    <div key={c.name} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '4px 0', fontSize: 13 }}>
      <span style={{ flex: 1 }}>{c.name}</span>
      <b>{c.messages}</b>
      {delta(c.messages, c.prev_messages)}
      <span style={{ fontSize: 11.5, color: 'var(--ink-soft)', width: 74, textAlign: 'right' }}>
        {c.people} {c.people === 1 ? 'person' : 'people'}
      </span>
    </div>
  )
  return (
    <div className="card" style={{ padding: '14px 16px', marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>
        💬 Team chat activity <span style={{ fontWeight: 500, color: 'var(--ink-soft)', fontSize: 12.5 }}>— messages this week vs last</span>
      </div>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', margin: '10px 0 14px' }}>
        <div><div style={{ fontSize: 22, fontWeight: 800 }}>{chat.total} {delta(chat.total, chat.prev_total)}</div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>messages, all channels</div></div>
        <div><div style={{ fontSize: 22, fontWeight: 800 }}>{chat.team_total} {delta(chat.team_total, chat.team_prev_total)}</div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>in team channels</div></div>
        <div><div style={{ fontSize: 22, fontWeight: 800 }}>{chat.people}</div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>people posting</div></div>
      </div>
      {!!teams.length && (<>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: .4, marginBottom: 2 }}>Team channels</div>
        {teams.map(row)}
      </>)}
      {!!others.length && (<>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: .4, margin: '12px 0 2px' }}>Everything else</div>
        {others.map(row)}
      </>)}
    </div>
  )
}

function Presentation({ week, updates, profiles, nameOf, hygiene, chat }) {
  const submitted = updates.filter(u => u.submitted_at)
  const submittedIds = new Set(submitted.map(u => u.profile_id))
  // Only non-agents are expected to submit, so only they can be "missing".
  const expected = profiles.filter(p => String(p.role || 'agent').trim().toLowerCase() !== 'agent')
  const missing = expected.filter(p => !submittedIds.has(p.id))

  return (
    <div>
      {/* Live task-board hygiene for the whole team — review and clean weekly. */}
      <HygieneTable hygiene={hygiene} profiles={profiles} />
      {/* Are the team channels actually being used? */}
      <ChatActivity chat={chat} />

      {submitted.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--ink-soft)' }}>
          <h3 style={{ fontSize: 14, marginBottom: 4 }}>No submissions yet for this week</h3>
          <p style={{ fontSize: 13 }}>Updates will assemble here as people submit them.</p>
        </div>
      ) : (
      <>
      {/* submission status bar */}
      <div className="card" style={{ padding: '12px 16px', marginBottom: 18, display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <div><span style={{ fontSize: 22, fontWeight: 700, color: 'var(--passed)' }}>{submitted.length}</span> <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>submitted</span></div>
        {missing.length > 0 && (
          <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
            <span style={{ fontWeight: 600, color: 'var(--failed)' }}>Still missing:</span> {missing.map(p => p.full_name).join(', ')}
          </div>
        )}
      </div>

      {/* each person's update as a "slide" */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {submitted
          .slice()
          .sort((a, b) => nameOf(a.profile_id).localeCompare(nameOf(b.profile_id)))
          .map(u => (
            <div key={u.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {/* Fixed dark bar (not var(--ink), which flips to near-white in dark mode
                  and hid the name). White text stays readable in both themes. */}
              <div style={{ padding: '14px 20px', background: '#0d1518', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 17, fontWeight: 700, color: '#fff' }}>{nameOf(u.profile_id)}</span>
                <span style={{ fontSize: 12, color: '#fff', opacity: .8 }}>{weekLabel(week)}</span>
              </div>
              <div style={{ padding: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
                {SECTIONS.filter(s => u[s.key]).map(s => (
                  <div key={s.key}>
                    <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--accent)', marginBottom: 6 }}>
                      {s.icon} {s.label}
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.6 }}><RichContent html={u[s.key]} /></div>
                  </div>
                ))}
              </div>
            </div>
          ))}
      </div>
      </>
      )}
    </div>
  )
}
