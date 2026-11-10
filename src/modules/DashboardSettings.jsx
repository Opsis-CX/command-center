import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { hasPerm, usingNewPermissions } from '../lib/permissions'
import { useAuth } from '../lib/auth'

// ============================================================
// 📊 Dashboard (Configuration, 2026-11-04) — how the Dashboard calculates and shows things:
//  • which schedules count toward fill rate & coverage (company default for internal
//    schedules + a per-schedule override). Non-counting schedules still show who's on.
//  • color thresholds, "needs attention" threshold, default date range.
// ============================================================
const CSS = `
.ds-card { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 20px 22px; margin-bottom: 16px; }
.ds-card h2 { margin: 0 0 4px; font-size: 17px; font-weight: 800; }
.ds-sub { color: var(--ink-soft); font-size: 13px; margin: 0 0 14px; }
.ds-num { width: 70px; padding: 6px 8px; border: 1px solid var(--line); border-radius: 8px; font: inherit; font-size: 13.5px; background: var(--surface); color: var(--ink); text-align: center; }
.ds-line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13.5px; margin: 10px 0; }
.ds-seg { display: inline-flex; border: 1px solid var(--line); border-radius: 999px; overflow: hidden; }
.ds-seg button { border: 0; background: var(--surface); color: var(--ink); padding: 5px 12px; font: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer; }
.ds-seg button.on { background: var(--accent); color: var(--accent-ink); }
.ds-row { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
`
const Swatch = ({ c, l }) => <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700 }}><span style={{ width: 12, height: 12, borderRadius: 4, background: c }} />{l}</span>

export default function DashboardSettings() {
  const { isAdmin } = useAuth()
  const canEdit = usingNewPermissions() ? hasPerm('admin.dashboard_settings') : isAdmin
  const [s, setS] = useState(null)
  const [saved, setSaved] = useState(null)
  const [list, setList] = useState(null)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    const [st, ls] = await Promise.all([supabase.from('dashboard_settings').select('*').maybeSingle(), supabase.rpc('dash_fill_schedule_list')])
    if (st.error) setMsg({ kind: 'err', text: "Dashboard settings aren't set up in this environment yet." })
    setS(st.data || {}); setSaved(st.data || {}); setList(ls.data || [])
  }, [])
  useEffect(() => { load() }, [load])
  const set = (k, v) => setS(x => ({ ...x, [k]: v }))
  const dirty = s && saved && JSON.stringify(s) !== JSON.stringify(saved)

  async function save() {
    if (!(s.warn_pct < s.good_pct)) return setMsg({ kind: 'err', text: 'The amber cutoff has to be lower than the green one.' })
    setBusy(true); setMsg(null)
    const { error } = await supabase.from('dashboard_settings').update({ include_internal_fill: s.include_internal_fill, good_pct: s.good_pct, warn_pct: s.warn_pct,
      attention_pct: s.attention_pct, default_days: s.default_days, updated_at: new Date().toISOString() }).eq('id', true)
    setBusy(false)
    if (error) return setMsg({ kind: 'err', text: /row-level|permission/i.test(error.message) ? "You don't have permission to change these." : /check/i.test(error.message) ? 'One of the numbers is outside the allowed range.' : error.message })
    setSaved(s); setMsg({ kind: 'ok', text: 'Saved — the Dashboard uses these right away.' }); load()
  }
  async function setOverride(id, v) {
    setMsg(null)
    const { error } = await supabase.rpc('dash_set_fill_override', { p_schedule: id, p_value: v })
    if (error) return setMsg({ kind: 'err', text: error.message })
    load()
  }
  if (!s || !list) return <p className="page-sub">Loading…</p>
  const off = !canEdit
  const internalDefault = !!saved.include_internal_fill
  return (
    <div style={{ maxWidth: 1000 }}>
      <style>{CSS}</style>
      <h1 className="page-title">📊 Dashboard</h1>
      <p className="page-sub">How the Dashboard calculates fill rate and coverage, and how it shows results. {canEdit ? '' : 'Only Administrators can change these.'}</p>
      {msg && <div style={{ padding: '9px 12px', borderRadius: 9, fontSize: 13, marginBottom: 12, background: msg.kind === 'ok' ? '#ECFDF5' : '#FEF2F2', color: msg.kind === 'ok' ? '#047857' : '#B91C1C' }}>{msg.text}</div>}

      <div className="ds-card">
        <h2>What counts toward fill rate &amp; coverage</h2>
        <p className="ds-sub">Schedules that don't count still show who's on in Staffing and Team attendance — they're just left out of fill rate, coverage, Needs attention, open intervals and automatic alerts.</p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, fontWeight: 700, cursor: off ? 'default' : 'pointer' }}>
          <input type="checkbox" style={{ width: 18, height: 18 }} disabled={off} checked={!!s.include_internal_fill} onChange={e => set('include_internal_fill', e.target.checked)} />
          Include internal shifts (schedules with no client)
        </label>
        <div className="page-sub" style={{ fontSize: 12.5, margin: '4px 0 14px 28px' }}>Client schedules always count unless you change one below.</div>

        <div style={{ fontSize: 13, fontWeight: 800, margin: '6px 0 4px' }}>Each schedule</div>
        {list.length === 0 && <div className="page-sub" style={{ fontSize: 13, padding: '8px 0' }}>No published schedules yet.</div>}
        {list.map(r => {
          const def = r.client ? true : internalDefault
          const val = r.override == null ? 'default' : r.override ? 'yes' : 'no'
          return (
            <div key={r.id} className="ds-row">
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{r.title}</div>
                <div className="page-sub" style={{ fontSize: 12 }}>{r.client || 'Internal — no client'}{r.project ? ` · ${r.project}` : ''}</div>
              </div>
              <span style={{ fontSize: 12, fontWeight: 800, color: r.counts ? '#16A34A' : 'var(--ink-soft)', minWidth: 110, textAlign: 'right' }}>{r.counts ? '✓ Counts' : '— Doesn\'t count'}</span>
              <div className="ds-seg" role="group" aria-label={`${r.title} counts toward fill rate`}>
                <button className={val === 'default' ? 'on' : ''} disabled={off} onClick={() => setOverride(r.id, null)} title={`Follow the default (${def ? 'counts' : "doesn't count"})`}>Default</button>
                <button className={val === 'yes' ? 'on' : ''} disabled={off} onClick={() => setOverride(r.id, true)}>Counts</button>
                <button className={val === 'no' ? 'on' : ''} disabled={off} onClick={() => setOverride(r.id, false)}>Doesn't count</button>
              </div>
            </div>
          )
        })}
      </div>

      <div className="ds-card">
        <h2>Colors &amp; alerts</h2>
        <p className="ds-sub">Used for fill rate, utilization and coverage everywhere on the Dashboard.</p>
        <div className="ds-line"><Swatch c="#16A34A" l="Green" /> at <input type="number" className="ds-num" min={1} max={100} disabled={off} value={s.good_pct ?? ''} onChange={e => set('good_pct', Number(e.target.value))} />% or higher</div>
        <div className="ds-line"><Swatch c="#EAB308" l="Amber" /> at <input type="number" className="ds-num" min={0} max={99} disabled={off} value={s.warn_pct ?? ''} onChange={e => set('warn_pct', Number(e.target.value))} />% up to {s.good_pct ? s.good_pct - 1 : '—'}%</div>
        <div className="ds-line"><Swatch c="#DC2626" l="Red" /> below {s.warn_pct ?? '—'}%</div>
        <div className="ds-line" style={{ marginTop: 16 }}>Show a client / project in <b>Needs attention</b> when a day's fill rate is below <input type="number" className="ds-num" min={0} max={100} disabled={off} value={s.attention_pct ?? ''} onChange={e => set('attention_pct', Number(e.target.value))} />%</div>
      </div>

      <div className="ds-card">
        <h2>Default view</h2>
        <div className="ds-line">Open the Dashboard showing the next
          <div className="ds-seg">{[7, 14].map(n => <button key={n} className={s.default_days === n ? 'on' : ''} disabled={off} onClick={() => set('default_days', n)}>{n} days</button>)}</div>
        </div>
      </div>

      {canEdit && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', position: 'sticky', bottom: 0, padding: '12px 16px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14 }}>
          <span className="page-sub" style={{ fontSize: 12.5, marginRight: 'auto' }}>{dirty ? 'You have unsaved changes.' : 'All changes saved. (Each schedule’s setting saves as soon as you click it.)'}</span>
          <button className="btn btn-primary" disabled={busy || !dirty} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
          {dirty && <button className="btn btn-ghost" onClick={() => { setS(saved); setMsg(null) }}>Discard</button>}
        </div>
      )}
    </div>
  )
}
