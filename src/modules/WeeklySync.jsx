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
function lockInstant(weekMondayIso) {
  const mon = new Date(weekMondayIso + 'T00:00:00')
  const sun = new Date(mon); sun.setDate(sun.getDate() + 6)
  const y = sun.getFullYear(), m = sun.getMonth(), d = sun.getDate()
  // We want the UTC instant whose America/New_York wall clock reads y-m-d 20:00.
  // 1) Take 20:00 as if it were UTC.
  // 2) Ask what New York's wall clock reads at that instant.
  // 3) The difference between that reading and 20:00 is ET's offset; subtract it.
  const asUtc = Date.UTC(y, m, d, 20, 0, 0)
  const etReading = new Date(new Date(asUtc).toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const offsetMs = etReading.getTime() - asUtc         // ET is behind UTC → negative
  return new Date(asUtc - offsetMs)
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
  const [week, setWeek] = useState(currentMonday())
  const [tab, setTab] = useState('mine')            // 'mine' | 'presentation'
  const [updates, setUpdates] = useState([])
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const [upRes, profRes] = await Promise.all([
      supabase.from('weekly_updates').select('*').eq('week_start_date', week),
      supabase.from('profiles').select('id, full_name, role').order('full_name'),
    ])
    setUpdates(upRes.data || [])
    setProfiles(profRes.data || [])
    setLoading(false)
  }, [week])

  useEffect(() => { load() }, [load])
  function flash(m) { setToast(m); setTimeout(() => setToast(''), 2500) }

  const mine = updates.find(u => u.profile_id === userId)
  const nameOf = (id) => (profiles.find(p => p.id === id) || {}).full_name || 'Unknown'
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
          ? <MyUpdate week={week} userId={userId} existing={mine} locked={locked} lockLabelText={lockLabel(week)} onSaved={(msg) => { load(); flash(msg) }} />
          : <Presentation week={week} updates={updates} profiles={profiles} nameOf={nameOf} />
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

function MyUpdate({ week, userId, existing, locked, lockLabelText, onSaved }) {
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
      {locked && (
        <div className="card" style={{ padding: '10px 14px', marginBottom: 16, background: 'var(--canvas)', border: '1px solid var(--line)', color: 'var(--ink-soft)', fontSize: 13, fontWeight: 500 }}>
          🔒 This week locked at {lockLabelText}. Submissions and edits are closed{submitted ? '. Your submitted update is shown below (read-only).' : ' — nothing was submitted for you this week.'}
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

function Presentation({ week, updates, profiles, nameOf }) {
  const submitted = updates.filter(u => u.submitted_at)
  const submittedIds = new Set(submitted.map(u => u.profile_id))
  // Only non-agents are expected to submit, so only they can be "missing".
  const expected = profiles.filter(p => String(p.role || 'agent').trim().toLowerCase() !== 'agent')
  const missing = expected.filter(p => !submittedIds.has(p.id))

  if (submitted.length === 0) {
    return (
      <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--ink-soft)' }}>
        <h3 style={{ fontSize: 14, marginBottom: 4 }}>No submissions yet for this week</h3>
        <p style={{ fontSize: 13 }}>Updates will assemble here as people submit them.</p>
      </div>
    )
  }

  return (
    <div>
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
              <div style={{ padding: '14px 20px', background: 'var(--ink)', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 17, fontWeight: 700 }}>{nameOf(u.profile_id)}</span>
                <span style={{ fontSize: 12, opacity: .8 }}>{weekLabel(week)}</span>
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
    </div>
  )
}
