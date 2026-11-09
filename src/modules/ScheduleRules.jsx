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
const clock = (t, add = 0) => { const [h, m] = String(t || '11:00').split(':').map(Number); const x = h * 60 + m + add; const hh = Math.floor(x / 60) % 24, mm = x % 60; return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}` }

// group = which section a setting belongs to (same as the database)
const groupOf = (k) => k.startsWith('release_') ? 'release' : k.startsWith('waves') ? 'waves' : k.startsWith('cap_') ? 'cap'
  : k.startsWith('lock_') ? 'lock' : (k.startsWith('grace_') || k.startsWith('auto_checkout_')) ? 'checkout' : null
const GROUP_LABEL = { release: 'release', waves: 'waves', cap: 'weekly cap', lock: 'commitment lock', checkout: 'check-out' }

function Section({ title, sub, enabledKey, r, set, can, children, sched }) {
  // sched (when editing one schedule): { custom, onToggle } — "Company default" sections are read-only here
  const usingDefault = sched && !sched.custom
  const editable = can && !usingDefault
  const on = enabledKey ? r[enabledKey] !== false : true
  return (
    <div className="sr-card" style={sched?.custom ? { borderColor: 'var(--accent)' } : undefined}>
      <div className="sr-head">
        <h2>{title}</h2>
        {!can && <span className="sr-ro">🔒 View only</span>}
        {sched && <div className="sr-seg" style={can ? undefined : { pointerEvents: 'none', opacity: .6 }}>
          <button className={!sched.custom ? 'on' : ''} onClick={() => sched.onToggle(false)}>Company default</button>
          <button className={sched.custom ? 'on' : ''} onClick={() => sched.onToggle(true)}>Custom for this schedule</button>
        </div>}
        {enabledKey && <label className="sr-switch" style={editable ? undefined : { pointerEvents: 'none', opacity: usingDefault ? .6 : 1 }}>
          <input type="checkbox" disabled={!editable} checked={on} onChange={e => set(enabledKey, e.target.checked)} />{on ? 'On' : 'Off'}</label>}
      </div>
      <p className="sr-sub">{sub}{usingDefault ? ' — this schedule follows the company rule.' : ''}</p>
      <div className={on ? '' : 'sr-off'} style={editable ? undefined : { pointerEvents: 'none', opacity: usingDefault ? .6 : 1 }}>{children}</div>
    </div>
  )
}

export default function ScheduleRules() {
  const [acc, setAcc] = useState(null)
  const [r, setR] = useState(null)
  const [saved, setSaved] = useState(null)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  // "Rules for": company default (null) or one schedule
  const [target, setTarget] = useState(null)
  const [company, setCompany] = useState(null)
  const [overrides, setOverrides] = useState({})     // schedule_id → rules
  const [custom, setCustom] = useState({})           // section → true (custom for the target schedule)
  const [schedules, setSchedules] = useState([])
  const [opts, setOpts] = useState({ tiers: [], tags: [], certs: [], people: [] })   // each company's own lists, for wave conditions
  useEffect(() => { supabase.rpc('sched_wave_options').then(({ data }) => { if (data) setOpts(data) }) }, [])
  const norm = (d) => ({ ...d, release_time: String(d.release_time || '11:00').slice(0, 5), cap_hours: Number(d.cap_hours) })
  const load = useCallback(async () => {
    const [a, d, ov, sc] = await Promise.all([supabase.rpc('sched_rules_access'), supabase.from('schedule_rules').select('*').maybeSingle(),
      supabase.from('schedule_rule_overrides').select('schedule_id, rules'),
      supabase.from('schedules').select('id, title, status, client_id, clients(name)').neq('status', 'archived').order('title')])
    setAcc(a.data || {})
    if (d.error || !d.data) { setMsg({ kind: 'err', text: "Schedule rules aren't set up in this environment yet." }); return }
    const base = norm(d.data)
    const map = Object.fromEntries((ov.data || []).map(o => [o.schedule_id, o.rules || {}]))
    setCompany(base); setOverrides(map); setSchedules(sc.data || [])
    return { base, map }
  }, [])
  const show = useCallback((tgt, base, map) => {
    const ov = tgt ? (map[tgt] || {}) : {}
    const v = norm({ ...base, ...ov })
    setR(v); setSaved(v)
    setCustom(Object.fromEntries([...new Set(Object.keys(ov).map(groupOf).filter(Boolean))].map(g => [g, true])))
  }, [])
  useEffect(() => { load().then(x => { if (x) show(null, x.base, x.map) }) }, [load, show])
  const pick = (tgt) => { setTarget(tgt); setMsg(null); show(tgt, company, overrides) }
  // Custom ↔ default for one section (schedule mode): default puts the company values back
  const toggleSection = (g, on) => {
    setCustom(c => ({ ...c, [g]: on }))
    if (!on) setR(x => ({ ...x, ...Object.fromEntries(Object.keys(company).filter(k => groupOf(k) === g).map(k => [k, company[k]])) }))
  }
  const set = (k, v) => setR(x => ({ ...x, [k]: v }))
  if (!acc) return <p className="page-sub">Loading…</p>
  if (!acc.view) return <div className="card"><div className="page-sub" style={{ padding: 20 }}>You don't have access to the schedule rules.</div></div>
  if (!r) return <div><style>{CSS}</style>{msg && <div className="card" style={{ color: '#B91C1C' }}>{msg.text}</div>}</div>
  const changed = Object.keys(r).filter(k => !['updated_at', 'updated_by', 'id'].includes(k) && JSON.stringify(r[k]) !== JSON.stringify(saved[k]))
  const savedCustom = target ? [...new Set(Object.keys(overrides[target] || {}).map(groupOf).filter(Boolean))] : []
  const customChanged = target && (savedCustom.some(g => !custom[g]) || Object.keys(custom).some(g => custom[g] && !savedCustom.includes(g)))
  const dirty = changed.length > 0 || customChanged
  const anyEdit = (acc.release || acc.waves || acc.cap || acc.lock || acc.checkout) && (!target || acc.per_schedule)
  const NUMS = ['cap_hours', 'lock_hours', 'grace_min', 'auto_checkout_min', 'release_weekday', 'release_weeks_before', 'release_days_before', 'release_now_days']
  const schedName = (id) => { const x = schedules.find(s => s.id === id); return x ? `${x.title}${x.clients?.name ? ` · ${x.clients.name}` : ''}` : 'Schedule' }
  const sch = (g) => target ? { custom: !!custom[g], onToggle: (on) => toggleSection(g, on) } : undefined

  async function save() {
    if (r.waves_enabled && !(r.waves || []).length) return setMsg({ kind: 'err', text: 'Add at least one wave, or turn waves off.' })
    setBusy(true); setMsg(null)
    const val = (k) => NUMS.includes(k) ? Number(r[k]) : r[k]
    let res
    if (target) {
      // this schedule: send the full values of its custom sections; clear sections that went back to default
      const set = Object.fromEntries(Object.keys(r).filter(k => custom[groupOf(k)]).map(k => [k, val(k)]))
      const clear = savedCustom.filter(g => !custom[g])
      res = await supabase.rpc('sched_rules_save_schedule', { p_schedule: target, p_set: set, p_clear: clear })
    } else {
      res = await supabase.rpc('sched_rules_save', { p: Object.fromEntries(changed.map(k => [k, val(k)])) })
    }
    const { data, error } = res
    setBusy(false)
    if (error) return setMsg({ kind: 'err', text: /check constraint/i.test(error.message) ? 'One of the numbers is outside the allowed range.' : error.message })
    loadScheduleRules(true)
    setMsg({ kind: 'ok', text: `Saved${target ? ` for ${schedName(target)}` : ''}.${data?.retimed ? ` ${data.retimed} interval${data.retimed === 1 ? '' : 's'} not yet released were re-timed to the new release schedule.` : ''} These rules apply right away.` })
    const x = await load(); if (x) show(target, x.base, x.map)
  }

  // ---- waves helpers ----
  const waves = r.waves || []
  const setWaves = (w) => set('waves', w)
  const upd = (i, patch) => setWaves(waves.map((w, j) => j === i ? { ...w, ...patch } : w))
  const updCond = (i, ci, patch) => upd(i, { match: waves[i].match.map((c, k) => {
    if (k !== ci) return c
    const base = c.type === 'new' ? { type: 'hours', op: 'lt', hours: c.hours ?? 10, days: null } : c.type === 'recent' ? { type: 'hours', op: 'gte', hours: 0.01, days: c.days ?? 14 } : c
    return Object.fromEntries(Object.entries({ ...base, ...patch }).filter(([, v]) => v !== undefined))
  }) })
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= waves.length) return; const w = [...waves]; [w[i], w[j]] = [w[j], w[i]]; setWaves(w) }

  return (
    <div style={{ maxWidth: 1000 }}>
      <style>{CSS}</style>
      <h1 className="page-title">🕑 Schedule rules</h1>
      <p className="page-sub">The rules Command Center enforces when people pick up, release and check out of intervals. Turn each one on or off and set your own numbers.</p>
      <div className="sr-card" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '14px 18px' }}>
        <b style={{ fontSize: 14 }}>Rules for</b>
        <select className="sr-in" style={{ minWidth: 280, fontWeight: 700 }} value={target || ''} disabled={dirty} title={dirty ? 'Save or discard your changes first' : ''}
          onChange={e => pick(e.target.value || null)} aria-label="Rules for">
          <option value="">🏢 Company default (all schedules)</option>
          {schedules.map(sc => <option key={sc.id} value={sc.id}>{overrides[sc.id] ? '★ ' : ''}{sc.title}{sc.clients?.name ? ` · ${sc.clients.name}` : ''}{sc.status === 'draft' ? ' (draft)' : ''}</option>)}
        </select>
        {target && !acc.per_schedule && <span className="sr-ro">🔒 You can view, but not set, rules for individual schedules</span>}
        {!target && Object.keys(overrides).length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 12.5 }}>
            <span className="page-sub">Schedules with their own rules:</span>
            {Object.entries(overrides).map(([id, rl]) => (
              <button key={id} className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 10px' }} onClick={() => pick(id)} title="Open this schedule's rules">
                ★ {schedName(id)} <span className="page-sub">({[...new Set(Object.keys(rl).map(groupOf).filter(Boolean))].map(g => GROUP_LABEL[g]).join(', ')})</span>
              </button>
            ))}
          </div>
        )}
        {target && <span className="page-sub" style={{ fontSize: 12.5 }}>Each section can follow the company rule or be custom for this schedule.</span>}
      </div>
      {msg && <div style={{ padding: '9px 12px', borderRadius: 9, fontSize: 13, marginBottom: 12, background: msg.kind === 'ok' ? '#ECFDF5' : '#FEF2F2', color: msg.kind === 'ok' ? '#047857' : '#B91C1C' }}>{msg.text}</div>}

      <Section sched={sch('release')} title="📅 Release schedule" enabledKey="release_enabled" r={r} set={set} can={acc.release && (!target || acc.per_schedule)}
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

      <Section sched={sch('waves')} title="🌊 Release waves" enabledKey="waves_enabled" r={r} set={set} can={acc.waves && (!target || acc.per_schedule)}
        sub="Who gets first pick after each release. Waves are checked top to bottom — each person lands in the first wave they match (use ↑ ↓ to set the order). Anyone who matches none goes in the last wave. Off = everyone at once.">
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
              {(w.match || []).length > 1 && (
                <div className="sr-cond"><span className="page-sub">Match</span>
                  <div className="sr-seg">{[['any', 'any of these'], ['all', 'all of these']].map(([k, l]) => <button key={k} className={(w.join || 'any') === k ? 'on' : ''} onClick={() => upd(i, { join: k })}>{l}</button>)}</div>
                </div>
              )}
              {(w.match || []).map((c, ci) => (
                <Condition key={ci} c={c} first={ci === 0} join={w.join || 'any'} opts={opts}
                  onChange={(patch) => updCond(i, ci, patch)} onRemove={() => upd(i, { match: w.match.filter((_, k) => k !== ci) })} />
              ))}
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 9px', marginTop: 4 }} onClick={() => upd(i, { match: [...(w.match || []), { type: 'tier', ids: [] }] })}>＋ Add condition</button>
            </div>
          </div>
        ))}
        <button className="btn btn-ghost" onClick={() => setWaves([...waves, { name: `Wave ${waves.length + 1}`, delay: (Number(waves[waves.length - 1]?.delay) || 0) + 15, join: 'any', match: [{ type: 'everyone' }] }])}>＋ Add wave</button>
      </Section>

      <Section sched={sch('cap')} title="⏱ Weekly hour cap" enabledKey="cap_enabled" r={r} set={set} can={acc.cap && (!target || acc.per_schedule)}
        sub="The most hours one person can pick up in a week (Monday–Sunday). Applies to picking up, trades and assignments. Off = no limit.">
        <div className="sr-line">No more than <input type="number" className="sr-num" min={1} max={168} step="0.5" value={r.cap_hours} onChange={e => set('cap_hours', e.target.value)} /> hours per person per week.</div>
      </Section>

      <Section sched={sch('lock')} title="📌 Commitment lock" enabledKey="lock_enabled" r={r} set={set} can={acc.lock && (!target || acc.per_schedule)}
        sub="Once an interval is this close, the person who picked it up can't release it — only trade it (or release during an open VTO window). Different from locking an interval's open spots in Team view. Off = people can release any time before it starts.">
        <div className="sr-line">Lock intervals <input type="number" className="sr-num" min={1} max={720} value={r.lock_hours} onChange={e => set('lock_hours', e.target.value)} /> hours before they start
          <span className="page-sub" style={{ fontSize: 12 }}>{Number(r.lock_hours) % 24 === 0 ? `(${Number(r.lock_hours) / 24} day${Number(r.lock_hours) === 24 ? '' : 's'})` : ''}</span></div>
      </Section>

      <Section sched={sch('checkout')} title="✅ Check-out" r={r} set={set} can={acc.checkout && (!target || acc.per_schedule)}
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
          <span className="page-sub" style={{ fontSize: 12.5, marginRight: 'auto' }}>{target ? <b>{schedName(target)}: </b> : <b>Company default: </b>}{dirty ? 'You have unsaved changes.' : 'All rules saved.'}</span>
          {dirty && <button className="btn btn-ghost" onClick={() => { show(target, company, overrides); setMsg(null) }}>Discard</button>}
          <button className="btn btn-primary" disabled={busy || !dirty} onClick={save}>{busy ? 'Saving…' : target ? 'Save rules for this schedule' : 'Save rules'}</button>
        </div>
      )}
    </div>
  )
}


// One wave condition. The choices come from each company's own data (Performance tiers, team tags,
// certifications, people) — nothing about the categories is built in.
const COND_TYPES = [['tier', 'Scorecard tier is'], ['no_tier', 'Has no Scorecard tier'], ['tag', 'Has tag'], ['cert', 'Has passed certification'],
  ['hours', 'Hours worked'], ['tenure', 'Time since starting'], ['people', 'Is one of these people'], ['everyone', 'Everyone']]
const LIST_FOR = { tier: 'tiers', tag: 'tags', cert: 'certs', people: 'people' }
// older saved forms → today's form
function normalize(c) {
  if (c.type === 'new') return { type: 'hours', op: 'lt', hours: c.hours ?? 10, days: null }
  if (c.type === 'recent') return { type: 'hours', op: 'gte', hours: 0.01, days: c.days ?? 14 }
  if (c.type === 'team') return { ...c, type: 'tag' }
  return c
}
function Condition({ c: raw, first, join, opts, onChange, onRemove }) {
  const c = normalize(raw)
  const list = LIST_FOR[c.type] ? (opts[LIST_FOR[c.type]] || []) : null
  const ids = c.ids || []
  const nameOf = (id) => list?.find(x => x.id === id)?.name || '(removed)'
  const setType = (type) => onChange({ type, ids: LIST_FOR[type] ? [] : undefined, tier: undefined,
    ...(type === 'hours' ? { op: 'lt', hours: 10, days: null } : type === 'tenure' ? { op: 'within', days: 14, hours: undefined } : { op: undefined, hours: undefined, days: undefined }) })
  // time since starting is stored in days; shown in weeks when it divides evenly
  const [unit, setUnit] = useState(c.type === 'tenure' && c.days && c.days % 7 === 0 ? 'weeks' : 'days')
  return (
    <div className="sr-cond">
      <span className="page-sub" style={{ minWidth: 34 }}>{first ? 'Who:' : join === 'all' ? 'and' : 'or'}</span>
      <select className="sr-in" value={c.type} onChange={e => setType(e.target.value)}>{COND_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      {list && <>
        {ids.map(id => <span key={id} style={{ background: 'var(--canvas)', borderRadius: 999, padding: '3px 9px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
          onClick={() => onChange({ ids: ids.filter(x => x !== id) })} title="Remove">{nameOf(id)} ✕</span>)}
        {c.tier && !ids.length && <span className="page-sub" style={{ fontSize: 12 }}>(was “{c.tier}” — pick it from the list)</span>}
        {list.length === 0 ? <span className="page-sub" style={{ fontSize: 12 }}>None set up yet{c.type === 'tier' ? ' — tiers come from the Scorecard' : c.type === 'tag' ? ' — add tags in People & tags' : c.type === 'cert' ? ' — add certifications first' : ''}.</span>
          : <select className="sr-in" value="" onChange={e => e.target.value && onChange({ ids: [...ids, e.target.value], tier: undefined })}>
              <option value="">＋ {ids.length ? 'or…' : 'Choose…'}</option>
              {list.filter(x => !ids.includes(x.id)).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>}
      </>}
      {c.type === 'hours' && <>
        <select className="sr-in" value={c.op || 'lt'} onChange={e => onChange({ type: 'hours', op: e.target.value })}>
          <option value="lt">fewer than</option><option value="lte">or fewer (at most)</option><option value="gte">at least</option><option value="gt">more than</option></select>
        <input type="number" className="sr-num" min={0} step="0.5" value={c.hours ?? 0} onChange={e => onChange({ type: 'hours', hours: Number(e.target.value) })} /> hours
        <select className="sr-in" value={c.days ? 'recent' : 'all'} onChange={e => onChange({ type: 'hours', days: e.target.value === 'all' ? null : (c.days || 14) })}>
          <option value="all">all-time</option><option value="recent">in the last…</option></select>
        {c.days ? <><input type="number" className="sr-num" min={1} max={365} value={c.days} onChange={e => onChange({ type: 'hours', days: Number(e.target.value) })} /> days</> : null}
      </>}
      {c.type === 'tenure' && <>
        <select className="sr-in" value={c.op || 'within'} onChange={e => onChange({ type: 'tenure', op: e.target.value })}>
          <option value="within">started within the last</option><option value="over">started more than</option></select>
        <input type="number" className="sr-num" min={1} max={unit === 'weeks' ? 104 : 730}
          value={unit === 'weeks' ? Math.round((c.days ?? 14) / 7) : (c.days ?? 14)}
          onChange={e => onChange({ type: 'tenure', days: Number(e.target.value) * (unit === 'weeks' ? 7 : 1) })} />
        <select className="sr-in" value={unit} onChange={e => setUnit(e.target.value)}><option value="days">days</option><option value="weeks">weeks</option></select>
        {c.op === 'over' ? 'ago' : ''}
        <span className="page-sub" style={{ fontSize: 11.5 }} title="Uses the person's start date. If that's blank: their first interval worked, then when their account was created.">ⓘ start date</span>
      </>}
      <button className="btn btn-ghost" style={{ padding: '2px 7px', fontSize: 12 }} onClick={onRemove} aria-label="Remove condition">✕</button>
    </div>
  )
}
