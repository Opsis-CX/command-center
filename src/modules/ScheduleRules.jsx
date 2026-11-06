import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { loadScheduleRules } from '../lib/scheduleRules'

// ============================================================
// 🕑 Schedule rules (Configuration, 2026-11-05) — the rules the database enforces:
//   release schedule · release waves · weekly hour cap · commitment lock · check-out.
// Each section has its own permission (Access & Permissions → "Schedule rules"); sections you
// can't change are read-only, and the server re-checks every change (sched_rules_save).
// ============================================================
const CSS = `
.sr-card { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 20px 22px; margin-bottom: 16px; }
.sr-card h2 { margin: 0; font-size: 17px; font-weight: 800; flex: 1; }
.sr-head { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; }
.sr-sub { color: var(--ink-soft); font-size: 13px; margin: 0 0 14px; }
.sr-line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13.5px; margin: 10px 0; }
.sr-num { width: 74px; padding: 6px 8px; border: 1px solid var(--line); border-radius: 8px; font: inherit; font-size: 13.5px; background: var(--surface); color: var(--ink); text-align: center; }
.sr-in { padding: 6px 9px; border: 1px solid var(--line); border-radius: 8px; font: inherit; font-size: 13.5px; background: var(--surface); color: var(--ink); }
.sr-switch { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 800; cursor: pointer; }
.sr-switch input { width: 18px; height: 18px; }
.sr-off { opacity: .45; pointer-events: none; }
.sr-ro { font-size: 11.5px; font-weight: 700; color: var(--ink-soft); background: var(--canvas); border-radius: 999px; padding: 3px 10px; }
.sr-seg { display: inline-flex; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
.sr-seg button { border: 0; background: var(--surface); color: var(--ink); padding: 6px 12px; font: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer; }
.sr-seg button + button { border-left: 1px solid var(--line); }
.sr-seg button.on { background: var(--accent); color: var(--accent-ink); }
.sr-wave { border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; margin-bottom: 10px; }
.sr-cond { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 13px; padding: 4px 0; }
`
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const TIERS = ['Top Performer', 'High Performer', 'Developing Performer']
const clock = (t, add = 0) => { const [h, m] = String(t || '11:00').split(':').map(Number); const x = h * 60 + m + add; const hh = Math.floor(x / 60) % 24, mm = x % 60; return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}` }

function Section({ title, sub, enabledKey, r, set, can, children }) {
  const on = enabledKey ? r[enabledKey] !== false : true
  return (
    <div className="sr-card">
      <div className="sr-head">
        <h2>{title}</h2>
        {!can && <span className="sr-ro">🔒 View only</span>}
        {enabledKey && <label className="sr-switch" style={can ? undefined : { pointerEvents: 'none' }}>
          <input type="checkbox" disabled={!can} checked={on} onChange={e => set(enabledKey, e.target.checked)} />{on ? 'On' : 'Off'}</label>}
      </div>
      <p className="sr-sub">{sub}</p>
      <div className={on ? '' : 'sr-off'} style={can ? undefined : { pointerEvents: 'none' }}>{children}</div>
    </div>
  )
}

export default function ScheduleRules() {
  const [acc, setAcc] = useState(null)
  const [r, setR] = useState(null)
  const [saved, setSaved] = useState(null)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    const [a, d] = await Promise.all([supabase.rpc('sched_rules_access'), supabase.from('schedule_rules').select('*').maybeSingle()])
    setAcc(a.data || {})
    if (d.error || !d.data) { setMsg({ kind: 'err', text: "Schedule rules aren't set up in this environment yet." }); return }
    const v = { ...d.data, release_time: String(d.data.release_time).slice(0, 5), cap_hours: Number(d.data.cap_hours) }
    setR(v); setSaved(v)
  }, [])
  useEffect(() => { load() }, [load])
  const set = (k, v) => setR(x => ({ ...x, [k]: v }))
  if (!acc) return <p className="page-sub">Loading…</p>
  if (!acc.view) return <div className="card"><div className="page-sub" style={{ padding: 20 }}>You don't have access to the schedule rules.</div></div>
  if (!r) return <div><style>{CSS}</style>{msg && <div className="card" style={{ color: '#B91C1C' }}>{msg.text}</div>}</div>
  const changed = Object.keys(r).filter(k => !['updated_at', 'updated_by', 'id'].includes(k) && JSON.stringify(r[k]) !== JSON.stringify(saved[k]))
  const anyEdit = acc.release || acc.waves || acc.cap || acc.lock || acc.checkout

  async function save() {
    if (r.waves_enabled && !(r.waves || []).length) return setMsg({ kind: 'err', text: 'Add at least one wave, or turn waves off.' })
    setBusy(true); setMsg(null)
    const patch = Object.fromEntries(changed.map(k => [k, ['cap_hours', 'lock_hours', 'grace_min', 'auto_checkout_min', 'release_weekday', 'release_weeks_before', 'release_days_before', 'release_now_days'].includes(k) ? Number(r[k]) : r[k]]))
    const { data, error } = await supabase.rpc('sched_rules_save', { p: patch })
    setBusy(false)
    if (error) return setMsg({ kind: 'err', text: /check constraint/i.test(error.message) ? 'One of the numbers is outside the allowed range.' : error.message })
    loadScheduleRules(true)
    setMsg({ kind: 'ok', text: `Saved.${data?.retimed ? ` ${data.retimed} interval${data.retimed === 1 ? '' : 's'} not yet released were re-timed to the new release schedule.` : ''} These rules apply right away.` })
    load()
  }

  // ---- waves helpers ----
  const waves = r.waves || []
  const setWaves = (w) => set('waves', w)
  const upd = (i, patch) => setWaves(waves.map((w, j) => j === i ? { ...w, ...patch } : w))
  const updCond = (i, ci, patch) => upd(i, { match: waves[i].match.map((c, k) => k === ci ? { ...c, ...patch } : c) })
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= waves.length) return; const w = [...waves]; [w[i], w[j]] = [w[j], w[i]]; setWaves(w) }

  return (
    <div style={{ maxWidth: 1000 }}>
      <style>{CSS}</style>
      <h1 className="page-title">🕑 Schedule rules</h1>
      <p className="page-sub">The rules Command Center enforces when people pick up, release and check out of intervals. Turn each one on or off and set your own numbers.</p>
      {msg && <div style={{ padding: '9px 12px', borderRadius: 9, fontSize: 13, marginBottom: 12, background: msg.kind === 'ok' ? '#ECFDF5' : '#FEF2F2', color: msg.kind === 'ok' ? '#047857' : '#B91C1C' }}>{msg.text}</div>}

      <Section title="📅 Release schedule" enabledKey="release_enabled" r={r} set={set} can={acc.release}
        sub="When new intervals become available to pick up. Off = intervals are available as soon as they're published. Changing this re-times intervals that haven't been released yet.">
        <div className="sr-line">
          <div className="sr-seg">{[['weekly', 'Weekly'], ['daily', 'Daily (rolling)']].map(([k, l]) => <button key={k} className={r.release_mode === k ? 'on' : ''} onClick={() => set('release_mode', k)}>{l}</button>)}</div>
        </div>
        {r.release_mode === 'weekly' ? (
          <div className="sr-line">Every
            <select className="sr-in" value={r.release_weekday} onChange={e => set('release_weekday', Number(e.target.value))}>{DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}</select>
            at <input type="time" className="sr-in" value={r.release_time} onChange={e => set('release_time', e.target.value)} /> ET, release the intervals for
            <select className="sr-in" value={r.release_weeks_before} onChange={e => set('release_weeks_before', Number(e.target.value))}>
              {[1, 2, 3, 4, 6, 8].map(n => <option key={n} value={n}>{n === 1 ? 'the following week' : `${n} weeks out`}</option>)}</select>
          </div>
        ) : (
          <div className="sr-line">Every day at <input type="time" className="sr-in" value={r.release_time} onChange={e => set('release_time', e.target.value)} /> ET, release the day that's
            <input type="number" className="sr-num" min={1} max={90} value={r.release_days_before} onChange={e => set('release_days_before', e.target.value)} /> days ahead</div>
        )}
        <div className="sr-line">Intervals starting within <input type="number" className="sr-num" min={0} max={30} value={r.release_now_days} onChange={e => set('release_now_days', e.target.value)} /> days are released immediately.</div>
      </Section>

      <Section title="🌊 Release waves" enabledKey="waves_enabled" r={r} set={set} can={acc.waves}
        sub="Who gets first pick after each release. Each person lands in the first wave that matches — checked in this order: new agents, then performance tier, then recently active, then everyone else. Off = everyone at once.">
        {waves.map((w, i) => (
          <div key={i} className="sr-wave">
            <div className="sr-line" style={{ margin: 0 }}>
              <b style={{ minWidth: 20 }}>{i + 1}.</b>
              <input className="sr-in" style={{ flex: '1 1 180px' }} value={w.name} maxLength={40} onChange={e => upd(i, { name: e.target.value })} aria-label="Wave name" />
              opens <input type="number" className="sr-num" min={0} max={1440} value={w.delay} onChange={e => upd(i, { delay: Number(e.target.value) })} /> min after release
              <span className="page-sub" style={{ fontSize: 12 }}>({clock(r.release_time, Number(w.delay) || 0)})</span>
              <button className="btn btn-ghost" style={{ padding: '3px 8px' }} disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
              <button className="btn btn-ghost" style={{ padding: '3px 8px' }} disabled={i === waves.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
              <button className="btn btn-ghost" style={{ padding: '3px 8px', color: '#B91C1C' }} onClick={() => setWaves(waves.filter((_, j) => j !== i))} aria-label="Remove wave">✕</button>
            </div>
            <div style={{ marginTop: 6, paddingLeft: 28 }}>
              {(w.match || []).map((c, ci) => (
                <div key={ci} className="sr-cond">
                  <span className="page-sub">{ci === 0 ? 'Who:' : 'or'}</span>
                  <select className="sr-in" value={c.type} onChange={e => updCond(i, ci, { type: e.target.value })}>
                    <option value="new">New agents (fewer than … hours worked)</option>
                    <option value="tier">Performance tier</option>
                    <option value="recent">Active recently (no tier yet)</option>
                    <option value="everyone">Everyone else</option>
                  </select>
                  {c.type === 'new' && <><input type="number" className="sr-num" min={1} value={c.hours ?? 10} onChange={e => updCond(i, ci, { hours: Number(e.target.value) })} /> hours</>}
                  {c.type === 'tier' && <><input className="sr-in" list="sr-tiers" value={c.tier || ''} onChange={e => updCond(i, ci, { tier: e.target.value })} placeholder="Tier name" /></>}
                  {c.type === 'recent' && <>worked in the last <input type="number" className="sr-num" min={1} value={c.days ?? 14} onChange={e => updCond(i, ci, { days: Number(e.target.value) })} /> days</>}
                  <button className="btn btn-ghost" style={{ padding: '2px 7px', fontSize: 12 }} onClick={() => upd(i, { match: w.match.filter((_, k) => k !== ci) })} aria-label="Remove">✕</button>
                </div>
              ))}
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 9px', marginTop: 4 }} onClick={() => upd(i, { match: [...(w.match || []), { type: 'tier', tier: '' }] })}>＋ or…</button>
            </div>
          </div>
        ))}
        <datalist id="sr-tiers">{TIERS.map(t => <option key={t} value={t} />)}</datalist>
        <button className="btn btn-ghost" onClick={() => setWaves([...waves, { name: `Wave ${waves.length + 1}`, delay: (Number(waves[waves.length - 1]?.delay) || 0) + 15, match: [{ type: 'everyone' }] }])}>＋ Add wave</button>
      </Section>

      <Section title="⏱ Weekly hour cap" enabledKey="cap_enabled" r={r} set={set} can={acc.cap}
        sub="The most hours one person can pick up in a week (Monday–Sunday). Applies to picking up, trades and assignments. Off = no limit.">
        <div className="sr-line">No more than <input type="number" className="sr-num" min={1} max={168} step="0.5" value={r.cap_hours} onChange={e => set('cap_hours', e.target.value)} /> hours per person per week.</div>
      </Section>

      <Section title="📌 Commitment lock" enabledKey="lock_enabled" r={r} set={set} can={acc.lock}
        sub="Once an interval is this close, the person who picked it up can't release it — only trade it (or release during an open VTO window). Different from locking an interval's open spots in Team view. Off = people can release any time before it starts.">
        <div className="sr-line">Lock intervals <input type="number" className="sr-num" min={1} max={720} value={r.lock_hours} onChange={e => set('lock_hours', e.target.value)} /> hours before they start
          <span className="page-sub" style={{ fontSize: 12 }}>{Number(r.lock_hours) % 24 === 0 ? `(${Number(r.lock_hours) / 24} day${Number(r.lock_hours) === 24 ? '' : 's'})` : ''}</span></div>
      </Section>

      <Section title="✅ Check-out" r={r} set={set} can={acc.checkout}
        sub="How check-outs are reviewed and cleaned up.">
        <div className="sr-line">
          <label className="sr-switch"><input type="checkbox" checked={r.grace_enabled !== false} onChange={e => set('grace_enabled', e.target.checked)} />Grace window</label>
          <span className={r.grace_enabled === false ? 'sr-off' : ''} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>— check-outs more than
            <input type="number" className="sr-num" min={1} max={240} value={r.grace_min} onChange={e => set('grace_min', e.target.value)} /> minutes from the scheduled end need a note and go to the Review queue.</span>
        </div>
        <div className="sr-line">
          <label className="sr-switch"><input type="checkbox" checked={r.auto_checkout_enabled !== false} onChange={e => set('auto_checkout_enabled', e.target.checked)} />Auto check-out</label>
          <span className={r.auto_checkout_enabled === false ? 'sr-off' : ''} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>— anyone still checked in
            <input type="number" className="sr-num" min={0} max={720} value={r.auto_checkout_min} onChange={e => set('auto_checkout_min', e.target.value)} /> minutes after the interval ends is checked out automatically.</span>
        </div>
      </Section>

      {anyEdit && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', position: 'sticky', bottom: 0, padding: '12px 16px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14 }}>
          <span className="page-sub" style={{ fontSize: 12.5, marginRight: 'auto' }}>{changed.length ? `You have unsaved changes.` : 'All rules saved.'}</span>
          {changed.length > 0 && <button className="btn btn-ghost" onClick={() => { setR(saved); setMsg(null) }}>Discard</button>}
          <button className="btn btn-primary" disabled={busy || !changed.length} onClick={save}>{busy ? 'Saving…' : 'Save rules'}</button>
        </div>
      )}
    </div>
  )
}
