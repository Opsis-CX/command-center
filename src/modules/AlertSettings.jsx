import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { hasPerm, usingNewPermissions } from '../lib/permissions'
import { useAuth } from '../lib/auth'

// ============================================================
// 🔔 Alerts (Configuration, 2026-11-04) — how check-in nudges and open-interval alerts work:
// on/off, message wording (with fill-ins), cooldowns, automatic sending, and who counts as
// "available". Saved to alert_settings; the database functions read it on every send, and the
// automatic runner checks every 5 minutes.
// ============================================================

const CSS = `
.al-card { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 20px 22px; margin-bottom: 16px; }
.al-card h2 { margin: 0 0 4px; font-size: 17px; font-weight: 800; display: flex; align-items: center; gap: 10px; }
.al-sub { color: var(--ink-soft); font-size: 13px; margin: 0 0 14px; }
.al-row { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 20px; }
@media (max-width: 900px) { .al-row { grid-template-columns: 1fr; } }
.al-lbl { font-size: 13px; font-weight: 700; margin: 12px 0 5px; display: block; }
.al-in { width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 9px; font: inherit; font-size: 13.5px; background: var(--surface); color: var(--ink); box-sizing: border-box; }
.al-num { width: 74px; padding: 6px 8px; border: 1px solid var(--line); border-radius: 8px; font: inherit; font-size: 13.5px; background: var(--surface); color: var(--ink); text-align: center; }
.al-chip { border: 1px solid var(--line); background: var(--canvas); color: var(--ink); border-radius: 999px; padding: 2px 9px; font: inherit; font-size: 11.5px; font-weight: 600; cursor: pointer; }
.al-switch { display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 700; cursor: pointer; }
.al-switch input { width: 18px; height: 18px; }
.al-preview { border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; background: var(--canvas); }
.al-line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13.5px; margin: 8px 0; }
.al-off { opacity: .45; pointer-events: none; }
`
const VARS = {
  nudge: ['first_name', 'name', 'role', 'date', 'start', 'end', 'client_project', 'minutes_late'],
  open: ['first_name', 'name', 'role', 'date', 'start', 'end', 'client_project', 'spots', 'note'],
}
const SAMPLE = { first_name: 'Avery', name: 'Avery Brooks', role: 'Web Leads Agent', date: 'Thu 11/5', start: '8:00 AM', end: '12:00 PM',
  client_project: 'GarageCo · Web Leads', minutes_late: '12', spots: '2 spots', note: 'Bonus tokens for this one!' }
const render = (t) => String(t || '').replace(/\{(\w+)\}/g, (m, k) => SAMPLE[k] ?? m).replace(/\s+/g, ' ').trim()

function Template({ label, value, onChange, vars, disabled, multiline }) {
  const id = label.replace(/\W/g, '')
  const insert = (v) => {
    const el = document.getElementById(id)
    const at = el?.selectionStart ?? (value || '').length
    onChange((value || '').slice(0, at) + `{${v}}` + (value || '').slice(el?.selectionEnd ?? at))
  }
  const Tag = multiline ? 'textarea' : 'input'
  return (
    <div>
      <label className="al-lbl" htmlFor={id}>{label}</label>
      <Tag id={id} className="al-in" rows={multiline ? 3 : undefined} maxLength={300} disabled={disabled} value={value || ''} onChange={e => onChange(e.target.value)} />
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
        {vars.map(v => <button key={v} type="button" className="al-chip" disabled={disabled} onClick={() => insert(v)} title={`Insert ${v.replace('_', ' ')}`}>{`{${v}}`}</button>)}
      </div>
    </div>
  )
}
function Preview({ title, body }) {
  return (
    <div>
      <div className="al-lbl">Preview</div>
      <div className="al-preview">
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <span style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--accent)', color: 'var(--accent-ink)', display: 'grid', placeItems: 'center', fontWeight: 800, flex: 'none' }}>CC</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{render(title) || '—'}</div>
            <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 2, lineHeight: 1.45 }}>{render(body) || '—'}</div>
          </div>
        </div>
        <div className="page-sub" style={{ fontSize: 11.5, marginTop: 8 }}>Shown in the app and as a push notification. Sample values used here.</div>
      </div>
    </div>
  )
}
const Num = ({ value, onChange, min, max, disabled }) => <input type="number" className="al-num" min={min} max={max} disabled={disabled} value={value ?? ''} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} />

export default function AlertSettings() {
  const { isAdmin } = useAuth()
  const canEdit = usingNewPermissions() ? hasPerm('admin.alerts') : isAdmin
  const [s, setS] = useState(null)
  const [saved, setSaved] = useState(null)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    supabase.from('alert_settings').select('*').maybeSingle().then(({ data, error }) => {
      if (error) setMsg({ kind: 'err', text: "Alert settings aren't set up in this environment yet." })
      setS(data || {}); setSaved(data || {})
    })
  }, [])
  const set = (k, v) => setS(x => ({ ...x, [k]: v }))
  const dirty = s && saved && JSON.stringify(s) !== JSON.stringify(saved)
  async function save() {
    setBusy(true); setMsg(null)
    const { id, updated_at, updated_by, ...patch } = s // eslint-disable-line no-unused-vars
    const { error } = await supabase.from('alert_settings').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', true)
    setBusy(false)
    if (error) return setMsg({ kind: 'err', text: /row-level|permission/i.test(error.message) ? "You don't have permission to change alert settings." : /check constraint/i.test(error.message) ? 'One of the numbers is outside the allowed range.' : error.message })
    setSaved(s); setMsg({ kind: 'ok', text: 'Saved — new nudges and alerts use these settings right away.' })
  }
  if (!s) return <p className="page-sub">Loading…</p>
  const off = !canEdit
  return (
    <div style={{ maxWidth: 1100 }}>
      <style>{CSS}</style>
      <h1 className="page-title">🔔 Alerts</h1>
      <p className="page-sub">How check-in nudges and open-interval alerts work — what they say, how often, and whether Command Center sends them automatically. {canEdit ? '' : 'Only people with “Manage alert settings” can change these.'}</p>
      {msg && <div style={{ padding: '9px 12px', borderRadius: 9, fontSize: 13, marginBottom: 12, background: msg.kind === 'ok' ? '#ECFDF5' : '#FEF2F2', color: msg.kind === 'ok' ? '#047857' : '#B91C1C' }}>{msg.text}</div>}

      {/* ---- check-in nudges ---- */}
      <div className="al-card">
        <h2>⏰ Check-in nudges
          <label className="al-switch" style={{ marginLeft: 'auto', fontSize: 13 }}><input type="checkbox" disabled={off} checked={!!s.nudge_enabled} onChange={e => set('nudge_enabled', e.target.checked)} />{s.nudge_enabled ? 'On' : 'Off'}</label></h2>
        <p className="al-sub">Sent to people whose interval has started but who haven't checked in — from Dashboard → Staffing → People, or automatically.</p>
        <div className={s.nudge_enabled ? '' : 'al-off'}>
          <div className="al-row">
            <div>
              <Template label="Title" value={s.nudge_title} onChange={v => set('nudge_title', v)} vars={VARS.nudge} disabled={off} />
              <Template label="Message" value={s.nudge_body} onChange={v => set('nudge_body', v)} vars={VARS.nudge} disabled={off} multiline />
            </div>
            <Preview title={s.nudge_title} body={s.nudge_body} />
          </div>
          <div className="al-line" style={{ marginTop: 16 }}>Don't nudge the same person about the same interval more than once every <Num value={s.nudge_cooldown_min} min={1} max={240} disabled={off} onChange={v => set('nudge_cooldown_min', v)} /> minutes.</div>
          <div style={{ borderTop: '1px solid var(--line)', margin: '14px 0 4px' }} />
          <label className="al-switch"><input type="checkbox" disabled={off} checked={!!s.auto_nudge} onChange={e => set('auto_nudge', e.target.checked)} />Nudge automatically</label>
          <div className={s.auto_nudge ? '' : 'al-off'}>
            <div className="al-line">When someone is <Num value={s.auto_nudge_after_min} min={1} max={120} disabled={off} onChange={v => set('auto_nudge_after_min', v)} /> minutes late, nudge them — up to <Num value={s.auto_nudge_max} min={1} max={5} disabled={off} onChange={v => set('auto_nudge_max', v)} /> times per interval.</div>
            <div className="page-sub" style={{ fontSize: 12 }}>Checked every 5 minutes. Automatic nudges show in Activity as “automatic.”</div>
          </div>
        </div>
      </div>

      {/* ---- open-interval alerts ---- */}
      <div className="al-card">
        <h2>📣 Open-interval alerts
          <label className="al-switch" style={{ marginLeft: 'auto', fontSize: 13 }}><input type="checkbox" disabled={off} checked={!!s.open_enabled} onChange={e => set('open_enabled', e.target.checked)} />{s.open_enabled ? 'On' : 'Off'}</label></h2>
        <p className="al-sub">Sent to people who are available for an open interval — from Dashboard → Schedule → Open intervals, or automatically.</p>
        <div className={s.open_enabled ? '' : 'al-off'}>
          <div className="al-row">
            <div>
              <Template label="Title" value={s.open_title} onChange={v => set('open_title', v)} vars={VARS.open} disabled={off} />
              <Template label="Message" value={s.open_body} onChange={v => set('open_body', v)} vars={VARS.open} disabled={off} multiline />
              <div className="page-sub" style={{ fontSize: 12, marginTop: 6 }}><code>{'{note}'}</code> is the optional note typed when sending — it's left out when there isn't one.</div>
            </div>
            <Preview title={s.open_title} body={s.open_body} />
          </div>
          <div className="al-line" style={{ marginTop: 16 }}>Don't alert the same person about the same interval more than once every <Num value={s.open_cooldown_min} min={10} max={1440} disabled={off} onChange={v => set('open_cooldown_min', v)} /> minutes.</div>
          <div style={{ borderTop: '1px solid var(--line)', margin: '14px 0 4px' }} />
          <label className="al-switch"><input type="checkbox" disabled={off} checked={!!s.auto_open} onChange={e => set('auto_open', e.target.checked)} />Alert automatically</label>
          <div className={s.auto_open ? '' : 'al-off'}>
            <div className="al-line">When an interval starts within <Num value={s.auto_open_hours_before} min={1} max={168} disabled={off} onChange={v => set('auto_open_hours_before', v)} /> hours and still has at least <Num value={s.auto_open_min_spots} min={1} max={50} disabled={off} onChange={v => set('auto_open_min_spots', v)} /> open spot(s), alert the people available for it.</div>
            <div className="page-sub" style={{ fontSize: 12 }}>Checked every 5 minutes; the cooldown above keeps it from repeating.</div>
          </div>
        </div>
      </div>

      {/* ---- availability ---- */}
      <div className="al-card">
        <h2>🙋 Who counts as “available”</h2>
        <p className="al-sub">Always: assigned to that interval's schedule, not already on it, and not working an interval at the same time.</p>
        <label className="al-switch" style={{ fontWeight: 600 }}><input type="checkbox" disabled={off} checked={!!s.avail_skip_working_day} onChange={e => set('avail_skip_working_day', e.target.checked)} />Skip people who are already working any interval that day</label>
        <div className="al-line" style={{ marginTop: 12 }}>
          <label className="al-switch" style={{ fontWeight: 600 }}><input type="checkbox" disabled={off} checked={s.avail_max_week_hours != null} onChange={e => set('avail_max_week_hours', e.target.checked ? 40 : null)} />Skip people who'd go over</label>
          <Num value={s.avail_max_week_hours} min={1} max={80} disabled={off || s.avail_max_week_hours == null} onChange={v => set('avail_max_week_hours', v)} /> hours that week
        </div>
      </div>

      {canEdit && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', position: 'sticky', bottom: 0, padding: '12px 16px', margin: '0 -4px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, boxShadow: '0 -6px 20px rgba(15,23,42,.06)' }}>
          <span className="page-sub" style={{ fontSize: 12.5, marginRight: 'auto' }}>{dirty ? 'You have unsaved changes.' : 'All changes saved.'}</span>
          <button className="btn btn-primary" disabled={busy || !dirty} onClick={save}>{busy ? 'Saving…' : 'Save alert settings'}</button>
          {dirty && <button className="btn btn-ghost" onClick={() => { setS(saved); setMsg(null) }}>Discard changes</button>}
        </div>
      )}
    </div>
  )
}
