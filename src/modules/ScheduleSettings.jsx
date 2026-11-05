import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { hasPerm, usingNewPermissions } from '../lib/permissions'
import { useAuth } from '../lib/auth'
import { SCHED_DEFAULTS, ST_CSS, colorVars, loadScheduleSettings } from './ScheduleTeam'

// ============================================================
// 🗓 Schedule (Configuration, 2026-11-05) — how the Schedule looks and is organized:
//   Colors     one color per interval state (soft background / border / text derived from it)
//   Layout     grouping, default range, week start, time format, density, open-row, people
//   Views      as many saved views as wanted (base + filters + layout), shown as tabs to
//              everyone or chosen people/teams. Views only narrow what the server allows.
// ============================================================
const CSS = `
.ss-card { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 20px 22px; margin-bottom: 16px; }
.ss-card h2 { margin: 0 0 4px; font-size: 17px; font-weight: 800; }
.ss-sub { color: var(--ink-soft); font-size: 13px; margin: 0 0 14px; }
.ss-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px 22px; }
.ss-lbl { display: block; font-size: 13px; font-weight: 700; margin-bottom: 6px; }
.ss-seg { display: inline-flex; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; flex-wrap: wrap; max-width: 100%; }
.ss-seg button + button { border-left: 1px solid var(--line); }
.ss-seg button { border: 0; background: var(--surface); color: var(--ink); padding: 6px 12px; font: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer; }
.ss-seg button.on { background: var(--accent); color: var(--accent-ink); }
.ss-in { width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 9px; font: inherit; font-size: 13.5px; background: var(--surface); color: var(--ink); box-sizing: border-box; }
.ss-color { display: flex; align-items: center; gap: 10px; padding: 8px 0; }
.ss-color input[type=color] { width: 40px; height: 32px; border: 1px solid var(--line); border-radius: 8px; padding: 2px; background: var(--surface); cursor: pointer; }
.ss-view { display: flex; align-items: center; gap: 12px; padding: 11px 0; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
.ss-chipsel { display: flex; gap: 6px; flex-wrap: wrap; }
.ss-chipsel button { border: 1px solid var(--line); background: var(--surface); color: var(--ink); border-radius: 999px; padding: 4px 11px; font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; }
.ss-chipsel button.on { background: var(--accent-bg); border-color: var(--accent); color: var(--accent); }
`
const STATES = [['past', 'Past'], ['current', 'Happening now'], ['upcoming', 'Upcoming'], ['open', 'Open spots'], ['locked', 'Locked'], ['noshow', 'No-show'], ['checkedin', 'Checked-in dot']]
const GROUPS = [['client_project', 'Client → Project'], ['client', 'Client'], ['project', 'Project'], ['none', 'No grouping']]
const RANGES = [['week', 'Week'], ['month', 'Month']]
const OPEN = [['top', 'Top'], ['bottom', 'Bottom'], ['hidden', 'Hidden']]
const ICONS = ['🗓', '👥', '🎧', '📞', '💬', '🛠️', '⭐', '🌙', '☀️', '🏢', '📈', '🔥']

function Seg({ value, options, onChange, disabled, allowDefault }) {
  return (
    <div className="ss-seg" role="group">
      {allowDefault && <button className={value == null ? 'on' : ''} disabled={disabled} onClick={() => onChange(null)}>Default</button>}
      {options.map(([k, l]) => <button key={k} className={value === k ? 'on' : ''} disabled={disabled} onClick={() => onChange(k)}>{l}</button>)}
    </div>
  )
}

export default function ScheduleSettings() {
  const { isAdmin } = useAuth()
  const canEdit = usingNewPermissions() ? hasPerm('schedule.manage_views') : isAdmin
  const [s, setS] = useState(null)
  const [saved, setSaved] = useState(null)
  const [views, setViews] = useState([])
  const [edit, setEdit] = useState(null)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    const [st, vs] = await Promise.all([supabase.from('schedule_settings').select('*').maybeSingle(),
      supabase.from('schedule_views').select('*').order('archived_at', { nullsFirst: true }).order('sort').order('name')])
    if (st.error) setMsg({ kind: 'err', text: "Schedule settings aren't set up in this environment yet." })
    const v = st.data ? { ...SCHED_DEFAULTS, ...st.data, colors: { ...SCHED_DEFAULTS.colors, ...(st.data.colors || {}) } } : SCHED_DEFAULTS
    setS(v); setSaved(v); setViews(vs.data || [])
  }, [])
  useEffect(() => { load() }, [load])
  const set = (k, v) => setS(x => ({ ...x, [k]: v }))
  const setColor = (k, v) => setS(x => ({ ...x, colors: { ...x.colors, [k]: v } }))
  const dirty = s && saved && JSON.stringify(s) !== JSON.stringify(saved)

  async function save() {
    setBusy(true); setMsg(null)
    const { error } = await supabase.from('schedule_settings').update({ colors: s.colors, group_by: s.group_by, default_range: s.default_range, week_starts: s.week_starts,
      time_format: s.time_format, density: s.density, open_row: s.open_row, people_sort: s.people_sort, people_limit: Number(s.people_limit) || 8, updated_at: new Date().toISOString() }).eq('id', true)
    setBusy(false)
    if (error) return setMsg({ kind: 'err', text: /row-level|permission/i.test(error.message) ? "You don't have permission to change these." : error.message })
    setSaved(s); loadScheduleSettings(true); setMsg({ kind: 'ok', text: 'Saved — the Schedule uses these right away.' })
  }
  async function move(v, dir) {
    const active = views.filter(x => !x.archived_at)
    const i = active.findIndex(x => x.id === v.id), j = i + dir
    if (j < 0 || j >= active.length) return
    const a = active[i], b = active[j]
    await Promise.all([supabase.from('schedule_views').update({ sort: j * 10 }).eq('id', a.id), supabase.from('schedule_views').update({ sort: i * 10 }).eq('id', b.id)])
    load()
  }
  async function archive(v, on) {
    const { error } = await supabase.from('schedule_views').update({ archived_at: on ? new Date().toISOString() : null }).eq('id', v.id)
    if (error) return setMsg({ kind: 'err', text: error.message })
    setMsg({ kind: 'ok', text: on ? `"${v.name}" archived — it no longer shows as a tab.` : `"${v.name}" restored.` }); load()
  }
  if (!s) return <p className="page-sub">Loading…</p>
  const off = !canEdit
  const active = views.filter(v => !v.archived_at), archived = views.filter(v => v.archived_at)
  return (
    <div style={{ maxWidth: 1050 }}>
      <style>{CSS + ST_CSS}</style>
      <h1 className="page-title">🗓 Schedule</h1>
      <p className="page-sub">How the Schedule looks and is organized — colors, layout, and the views people can switch between. {canEdit ? '' : 'Only people with “Manage schedule settings & views” can change these.'}</p>
      {msg && <div style={{ padding: '9px 12px', borderRadius: 9, fontSize: 13, marginBottom: 12, background: msg.kind === 'ok' ? '#ECFDF5' : '#FEF2F2', color: msg.kind === 'ok' ? '#047857' : '#B91C1C' }}>{msg.text}</div>}

      {/* ---- views ---- */}
      <div className="ss-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: 1 }}><h2>Views</h2><p className="ss-sub" style={{ margin: 0 }}>Tabs on the Schedule page, next to Internal / Team / My view. Make as many as you like.</p></div>
          {canEdit && <button className="btn btn-primary" onClick={() => setEdit({ name: '', icon: '🗓', base: 'team', client_ids: [], project_ids: [], roles: [], people: 'all', group_by: null, default_range: null, open_row: null, everyone: true, access: [] })}>＋ New view</button>}
        </div>
        <div style={{ marginTop: 10 }}>
          {active.length === 0 && <div className="page-sub" style={{ fontSize: 13, padding: '10px 0' }}>No custom views yet. Everyone still has the built-in Internal / Team / My views.</div>}
          {active.map((v, i) => (
            <div key={v.id} className="ss-view">
              <span style={{ fontSize: 20 }}>{v.icon}</span>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 800, fontSize: 14 }}>{v.name}</div>
                <div className="page-sub" style={{ fontSize: 12.5 }}>{describe(v)}</div>
              </div>
              {canEdit && <>
                <button className="btn btn-ghost" style={{ padding: '4px 9px' }} disabled={i === 0} onClick={() => move(v, -1)} aria-label="Move up">↑</button>
                <button className="btn btn-ghost" style={{ padding: '4px 9px' }} disabled={i === active.length - 1} onClick={() => move(v, 1)} aria-label="Move down">↓</button>
                <button className="btn btn-ghost" style={{ fontSize: 12.5 }} onClick={async () => {
                  const { data } = await supabase.from('schedule_view_access').select('*').eq('view_id', v.id)
                  setEdit({ ...v, access: data || [] })
                }}>Edit</button>
                <button className="btn btn-ghost" style={{ fontSize: 12.5, color: '#B91C1C' }} onClick={() => archive(v, true)}>Archive</button>
              </>}
            </div>
          ))}
          {archived.length > 0 && <details style={{ marginTop: 10 }}><summary className="page-sub" style={{ cursor: 'pointer', fontSize: 13 }}>📦 Archived views ({archived.length})</summary>
            {archived.map(v => <div key={v.id} className="ss-view" style={{ opacity: .7 }}><span>{v.icon}</span><span style={{ flex: 1, fontWeight: 700 }}>{v.name}</span>
              {canEdit && <button className="btn btn-ghost" style={{ fontSize: 12.5 }} onClick={() => archive(v, false)}>↩ Restore</button>}</div>)}
          </details>}
        </div>
      </div>

      {/* ---- colors ---- */}
      <div className="ss-card">
        <h2>Colors</h2>
        <p className="ss-sub">Pick one color per state — the soft background, border and text are made from it so it stays readable. Applies to every schedule view, including My view.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 22 }}>
          <div>
            {STATES.map(([k, l]) => (
              <div key={k} className="ss-color">
                <input type="color" disabled={off} value={s.colors[k]} onChange={e => setColor(k, e.target.value)} aria-label={l} />
                <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>{l}</span>
                {s.colors[k] !== SCHED_DEFAULTS.colors[k] && !off && <button className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 8px' }} onClick={() => setColor(k, SCHED_DEFAULTS.colors[k])}>Reset</button>}
              </div>
            ))}
          </div>
          <div style={colorVars(s.colors)}>
            <div className="ss-lbl">Preview</div>
            <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12, display: 'grid', gap: 2 }}>
              <div className="st-chip stack open" style={{ maxWidth: 200 }}><span>8:00 AM – 12:00 PM</span><span className="cnt">3 open</span></div>
              <div className="st-chip past" style={{ maxWidth: 200 }}>8:00 AM – 12:00 PM ✓</div>
              <div className="st-chip current" style={{ maxWidth: 200 }}>12:00 PM – 4:00 PM <span className="st-dot" /></div>
              <div className="st-chip upcoming" style={{ maxWidth: 200 }}>4:00 PM – 8:00 PM</div>
              <div className="st-chip locked" style={{ maxWidth: 200 }}>🔒 8:00 AM – 12:00 PM</div>
              <div className="st-chip noshow" style={{ maxWidth: 200 }}>12:00 PM – 4:00 PM · no-show</div>
            </div>
          </div>
        </div>
      </div>

      {/* ---- layout ---- */}
      <div className="ss-card">
        <h2>Layout</h2>
        <p className="ss-sub">Company defaults for Team and Internal view. Each custom view can override grouping, range and the open row.</p>
        <div className="ss-grid">
          <div><span className="ss-lbl">Group by</span><Seg value={s.group_by} options={GROUPS} disabled={off} onChange={v => set('group_by', v)} /></div>
          <div><span className="ss-lbl">Open on</span><Seg value={s.default_range} options={RANGES} disabled={off} onChange={v => set('default_range', v)} /></div>
          <div><span className="ss-lbl">Week starts on</span><Seg value={s.week_starts} options={[[1, 'Monday'], [0, 'Sunday']]} disabled={off} onChange={v => set('week_starts', v)} /></div>
          <div><span className="ss-lbl">Time format</span><Seg value={s.time_format} options={[['12', '12-hour (1:00 PM)'], ['24', '24-hour (13:00)']]} disabled={off} onChange={v => set('time_format', v)} /></div>
          <div><span className="ss-lbl">Density</span><Seg value={s.density} options={[['compact', 'Compact'], ['comfortable', 'Comfortable']]} disabled={off} onChange={v => set('density', v)} /></div>
          <div><span className="ss-lbl">Open intervals row</span><Seg value={s.open_row} options={OPEN} disabled={off} onChange={v => set('open_row', v)} /></div>
          <div><span className="ss-lbl">Sort people by</span><Seg value={s.people_sort} options={[['name', 'Name'], ['hours', 'Most hours'], ['first', 'Earliest shift']]} disabled={off} onChange={v => set('people_sort', v)} /></div>
          <div><span className="ss-lbl">People shown before “Show more”</span><input type="number" min={3} max={200} className="ss-in" style={{ width: 100 }} disabled={off} value={s.people_limit} onChange={e => set('people_limit', e.target.value)} /></div>
        </div>
      </div>

      {canEdit && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', position: 'sticky', bottom: 0, padding: '12px 16px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14 }}>
          <span className="page-sub" style={{ fontSize: 12.5, marginRight: 'auto' }}>{dirty ? 'You have unsaved color/layout changes.' : 'Colors & layout saved. (Views save on their own.)'}</span>
          {dirty && <button className="btn btn-ghost" onClick={() => setS(saved)}>Discard</button>}
          <button className="btn btn-ghost" disabled={off} onClick={() => setS({ ...s, ...SCHED_DEFAULTS })}>Reset all to defaults</button>
          <button className="btn btn-primary" disabled={busy || !dirty} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      )}
      {edit && <ViewEditor v={edit} onClose={() => setEdit(null)} onSaved={(m) => { setEdit(null); setMsg({ kind: 'ok', text: m }); load() }} />}
    </div>
  )
}

function describe(v) {
  const parts = [v.base === 'internal' ? 'Internal shifts' : 'Team (agents)']
  if (v.client_ids?.length) parts.push(`${v.client_ids.length} client${v.client_ids.length === 1 ? '' : 's'}`)
  if (v.project_ids?.length) parts.push(`${v.project_ids.length} project${v.project_ids.length === 1 ? '' : 's'}`)
  if (v.roles?.length) parts.push(`roles: ${v.roles.join(', ')}`)
  if (v.people && v.people !== 'all') parts.push(v.people === 'agents' ? 'agents only' : 'internal only')
  parts.push(v.everyone ? 'everyone with schedule access' : 'chosen people & teams')
  return parts.join(' · ')
}

function ViewEditor({ v, onClose, onSaved }) {
  const [f, setF] = useState({ ...v, roles: (v.roles || []).join(', ') })
  const [access, setAccess] = useState((v.access || []).map(a => ({ profile_id: a.profile_id, tag_id: a.tag_id })))
  const [clients, setClients] = useState([])
  const [projects, setProjects] = useState([])
  const [people, setPeople] = useState([])
  const [teams, setTeams] = useState([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    supabase.from('clients').select('id, name').is('archived_at', null).order('name').then(({ data }) => setClients(data || []))
    supabase.from('projects').select('id, name, client_id, deleted_at').order('name').then(({ data }) => setProjects((data || []).filter(p => !p.deleted_at)))
    supabase.from('profiles').select('id, full_name').eq('is_active', true).is('client_id', null).order('full_name').then(({ data }) => setPeople(data || []))
    supabase.from('tags').select('id, name').eq('namespace', 'team').order('name').then(({ data }) => setTeams(data || []))
  }, [])
  const set = (k, val) => setF(x => ({ ...x, [k]: val }))
  const toggleIn = (k, id) => setF(x => ({ ...x, [k]: x[k].includes(id) ? x[k].filter(y => y !== id) : [...x[k], id] }))
  const projOpts = projects.filter(p => !f.client_ids.length || f.client_ids.includes(p.client_id))
  async function save() {
    if (!f.name.trim()) return setErr('Give the view a name.')
    setBusy(true); setErr('')
    const row = { name: f.name.trim(), icon: f.icon, base: f.base, client_ids: f.base === 'internal' ? [] : f.client_ids, project_ids: f.base === 'internal' ? [] : f.project_ids.filter(id => projOpts.some(p => p.id === id)),
      roles: String(f.roles || '').split(',').map(x => x.trim()).filter(Boolean), people: f.people, group_by: f.group_by, default_range: f.default_range, open_row: f.open_row, everyone: f.everyone }
    let id = f.id
    if (id) {
      const { error } = await supabase.from('schedule_views').update(row).eq('id', id)
      if (error) { setBusy(false); return setErr(error.message) }
      await supabase.from('schedule_view_access').delete().eq('view_id', id)
    } else {
      const { data, error } = await supabase.from('schedule_views').insert({ ...row, sort: 1000 }).select().single()
      if (error) { setBusy(false); return setErr(/row-level|permission/i.test(error.message) ? "You don't have permission to create views." : error.message) }
      id = data.id
    }
    if (!f.everyone && access.length) {
      const { error } = await supabase.from('schedule_view_access').insert(access.map(a => ({ view_id: id, profile_id: a.profile_id || null, tag_id: a.tag_id || null })))
      if (error) { setBusy(false); return setErr(error.message) }
    }
    setBusy(false); onSaved(f.id ? `"${row.name}" updated.` : `"${row.name}" created — it shows as a tab on the Schedule.`)
  }
  const nameOf = (a) => a.profile_id ? (people.find(p => p.id === a.profile_id)?.full_name || 'Someone') : `👥 ${teams.find(t => t.id === a.tag_id)?.name || 'Team'}`
  const lbl = { display: 'block', fontSize: 13, fontWeight: 700, margin: '14px 0 6px' }
  return (
    <div onMouseDown={e => { if (e.target === e.currentTarget) onClose() }} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.42)', zIndex: 3000, display: 'grid', placeItems: 'center', padding: 14 }}>
      <div role="dialog" aria-label="Schedule view" style={{ width: 'min(680px, 100%)', maxHeight: '90vh', overflow: 'auto', padding: 22, background: 'var(--surface)', color: 'var(--ink)', borderRadius: 16, boxShadow: '0 24px 60px rgba(0,0,0,.25)' }}>
        <h3 style={{ margin: '0 0 6px', fontSize: 18 }}>{f.id ? `Edit “${v.name}”` : '＋ New view'}</h3>
        {err && <div style={{ background: '#FEF2F2', color: '#B91C1C', borderRadius: 8, padding: '8px 11px', fontSize: 12.5, margin: '8px 0' }}>{err}</div>}
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 240px' }}><span style={lbl}>Name</span><input className="ss-in" maxLength={40} value={f.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Weekend coverage, LSA team, Night shift" autoFocus /></div>
          <div><span style={lbl}>Icon</span><div className="ss-chipsel">{ICONS.map(i => <button key={i} className={f.icon === i ? 'on' : ''} onClick={() => set('icon', i)}>{i}</button>)}</div></div>
        </div>
        <span style={lbl}>Show</span>
        <Seg value={f.base} options={[['team', 'Team (agent intervals)'], ['internal', 'Internal shifts']]} onChange={v2 => set('base', v2)} />
        {f.base === 'team' && <>
          <span style={lbl}>Clients <span className="page-sub" style={{ fontWeight: 400 }}>(none picked = all they can see)</span></span>
          <div className="ss-chipsel">{clients.map(c => <button key={c.id} className={f.client_ids.includes(c.id) ? 'on' : ''} onClick={() => toggleIn('client_ids', c.id)}>{c.name}</button>)}</div>
          <span style={lbl}>Projects <span className="page-sub" style={{ fontWeight: 400 }}>(none picked = all)</span></span>
          <div className="ss-chipsel">{projOpts.length === 0 ? <span className="page-sub" style={{ fontSize: 12.5 }}>No projects for the chosen clients.</span>
            : projOpts.map(p => <button key={p.id} className={f.project_ids.includes(p.id) ? 'on' : ''} onClick={() => toggleIn('project_ids', p.id)}>{p.name}</button>)}</div>
        </>}
        <span style={lbl}>Interval roles contain <span className="page-sub" style={{ fontWeight: 400 }}>(optional, comma-separated)</span></span>
        <input className="ss-in" value={f.roles} onChange={e => set('roles', e.target.value)} placeholder="e.g. LSA, Appointment Setter" />
        <span style={lbl}>Staff type</span>
        <Seg value={f.people} options={[['all', 'Everyone'], ['agents', 'Agents only'], ['internal', 'Internal only']]} onChange={v2 => set('people', v2)} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '0 18px' }}>
          <div><span style={lbl}>Group by</span><Seg allowDefault value={f.group_by} options={GROUPS} onChange={v2 => set('group_by', v2)} /></div>
          <div><span style={lbl}>Open on</span><Seg allowDefault value={f.default_range} options={RANGES} onChange={v2 => set('default_range', v2)} /></div>
          <div><span style={lbl}>Open intervals row</span><Seg allowDefault value={f.open_row} options={OPEN} onChange={v2 => set('open_row', v2)} /></div>
        </div>
        <span style={lbl}>Who sees this tab</span>
        <Seg value={f.everyone ? 'all' : 'some'} options={[['all', 'Everyone with schedule access'], ['some', 'Only these people & teams']]} onChange={v2 => set('everyone', v2 === 'all')} />
        {!f.everyone && (
          <div style={{ marginTop: 8 }}>
            {access.map((a, i) => <span key={i} className="st-pill" style={{ display: 'inline-flex', margin: '0 6px 6px 0', cursor: 'pointer', padding: '4px 10px', borderRadius: 999, background: 'var(--canvas)', fontSize: 12.5, fontWeight: 700 }}
              onClick={() => setAccess(x => x.filter((_, j) => j !== i))}>{nameOf(a)} ✕</span>)}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select className="ss-in" style={{ flex: '1 1 200px' }} value="" onChange={e => e.target.value && setAccess(x => [...x, { profile_id: e.target.value }])}>
                <option value="">＋ Add a person…</option>{people.filter(p => !access.some(a => a.profile_id === p.id)).map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
              <select className="ss-in" style={{ flex: '1 1 200px' }} value="" onChange={e => e.target.value && setAccess(x => [...x, { tag_id: e.target.value }])}>
                <option value="">＋ Add a team…</option>{teams.filter(t => !access.some(a => a.tag_id === t.id)).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="page-sub" style={{ fontSize: 12, marginTop: 6 }}>They still only see clients/projects their own permissions allow.</div>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : f.id ? 'Save view' : 'Create view'}</button>
        </div>
      </div>
    </div>
  )
}
