import { useEffect, useMemo, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// ============================================================
// 🔌 Integrations (Configuration, staging 2026-11-23)
// Connect outside tools — Five9, BigQuery, HubSpot, phone systems, payroll, analytics… Each company connects
// its own. Secrets go straight into Supabase Vault through integration_save(); this page only ever sees the
// last 4 characters. "Test connection" runs the integration-test function, which signs in to the tool for real.
// Tools that aren't ready show "Coming soon" with an "Ask for this" button (logged for us to prioritise).
// ============================================================

const STATUS = {
  connected: { label: 'Connected', bg: '#E7F5EC', fg: '#1F7A45' },
  error: { label: 'Needs attention', bg: '#FDECEA', fg: '#B4261F' },
  untested: { label: 'Not tested yet', bg: '#FFF4DE', fg: '#8A5A00' },
  disabled: { label: 'Off', bg: '#EEE', fg: '#555' },
}
const ago = (ts) => {
  if (!ts) return ''
  const s = Math.round((Date.now() - new Date(ts).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
const ACTION = { connected: 'connected', updated: 'updated', tested: 'tested', removed: 'removed', requested: 'asked for' }

export default function Integrations() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [cat, setCat] = useState('All')
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState(null)        // { provider, id?, label, config, secrets }
  const [busy, setBusy] = useState(false)
  const [formErr, setFormErr] = useState('')
  const [testing, setTesting] = useState({})    // id -> true
  const [results, setResults] = useState({})    // id -> last test result from this session
  const [asked, setAsked] = useState({})
  const [confirmRemove, setConfirmRemove] = useState(null)
  const [showLog, setShowLog] = useState(false)

  const load = useCallback(async () => {
    const { data: d, error } = await supabase.rpc('integrations_list')
    if (error) { setErr(error.message); return }
    setErr(''); setData(d)
  }, [])
  useEffect(() => { load() }, [load])

  const catalog = data?.catalog || []
  const byKey = useMemo(() => Object.fromEntries(catalog.map(c => [c.key, c])), [catalog])
  const cats = useMemo(() => ['All', ...[...new Set(catalog.map(c => c.category))]], [catalog])
  const shown = catalog.filter(c => (cat === 'All' || c.category === cat) &&
    (!q.trim() || `${c.name} ${c.description} ${(c.capabilities || []).join(' ')}`.toLowerCase().includes(q.trim().toLowerCase())))
  const groups = cats.filter(x => x !== 'All').map(g => [g, shown.filter(c => c.category === g)]).filter(([, l]) => l.length)

  async function test(id) {
    setTesting(t => ({ ...t, [id]: true }))
    const { data: r, error } = await supabase.functions.invoke('integration-test', { body: { id } })
    let res = r
    if (error) {
      // the function answers with a friendly { message } even on errors
      try { res = await error.context?.json?.() } catch { /* keep generic */ }
      res = res?.message ? res : { ok: false, message: 'Could not run the test. Please try again.' }
    }
    setResults(x => ({ ...x, [id]: res }))
    setTesting(t => ({ ...t, [id]: false }))
    load()
  }

  function openNew(c) {
    const config = {}
    ;(c.fields || []).forEach(f => { if (!f.secret && f.type === 'select' && f.options?.[0]) config[f.key] = f.options[0].value })
    setFormErr(''); setEdit({ provider: c.key, label: c.name, config, secrets: {} })
  }
  function openEdit(conn) { setFormErr(''); setEdit({ provider: conn.provider, id: conn.id, label: conn.label, config: { ...(conn.config || {}) }, secrets: {}, hint: conn.secret_hint }) }

  async function save() {
    setBusy(true); setFormErr('')
    const { data: id, error } = await supabase.rpc('integration_save', {
      p_id: edit.id || null, p_provider: edit.provider, p_label: edit.label || '', p_config: edit.config || {}, p_secrets: edit.secrets || {},
    })
    setBusy(false)
    if (error) { setFormErr(error.message); return }
    setEdit(null)
    await load()
    test(id)                                   // check it straight away
  }
  async function remove(conn) {
    const { error } = await supabase.rpc('integration_remove', { p_id: conn.id })
    setConfirmRemove(null)
    if (error) { setErr(error.message); return }
    load()
  }
  async function ask(c) {
    const { error } = await supabase.rpc('integration_request', { p_provider: c.key, p_note: '' })
    if (!error) setAsked(a => ({ ...a, [c.key]: true }))
  }

  const lbl = { display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--ink-soft)', margin: '12px 0 5px' }
  const inp = { width: '100%', boxSizing: 'border-box', padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 9, font: 'inherit', fontSize: 14, background: 'var(--surface)', color: 'var(--ink)' }
  const pill = (s) => { const v = STATUS[s] || STATUS.untested; return <span style={{ background: v.bg, color: v.fg, fontSize: 12, fontWeight: 700, padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap' }}>{v.label}</span> }

  if (err && !data) return (
    <div style={{ maxWidth: 960 }}>
      <h1 className="page-title">🔌 Integrations</h1>
      <div className="card" style={{ color: '#B4261F' }}>{err}</div>
    </div>
  )
  if (!data) return <div style={{ maxWidth: 960 }}><h1 className="page-title">🔌 Integrations</h1><div className="card">Loading…</div></div>

  const conns = data.connections || []
  const def = edit ? byKey[edit.provider] : null

  return (
    <div style={{ maxWidth: 1040 }}>
      <h1 className="page-title">🔌 Integrations</h1>
      <p className="page-sub">Connect the tools your team already uses so Command Center can pull live numbers, reports and records from them. Keys are stored encrypted and only the last few characters are ever shown — not even admins can read them back.</p>
      {err && <div className="card" style={{ color: '#B4261F' }}>{err}</div>}

      {/* ---------- connected ---------- */}
      <div className="card" style={{ marginBottom: 18 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 17 }}>Your connections</h2>
        {!conns.length && <p className="page-sub" style={{ margin: 0 }}>Nothing connected yet. Pick a tool below to get started.</p>}
        {conns.map(conn => {
          const c = byKey[conn.provider] || { name: conn.provider, icon: '🔌' }
          const r = results[conn.id]
          const detail = r || conn.last_test_detail
          return (
            <div key={conn.id} style={{ borderTop: '1px solid var(--line)', padding: '14px 0', marginTop: 10 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 24 }} aria-hidden>{c.icon}</span>
                <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>{conn.label} <span style={{ fontWeight: 400, color: 'var(--ink-soft)', fontSize: 13 }}>· {c.name}</span></div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>
                    {conn.secret_hint ? `Key ${conn.secret_hint}` : 'No key saved'}
                    {conn.last_test_at ? ` · tested ${ago(conn.last_test_at)}` : ''}
                    {conn.created_by_name ? ` · added by ${conn.created_by_name}` : ''}
                  </div>
                </div>
                {testing[conn.id] ? <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>Testing…</span> : pill(conn.status)}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-ghost" disabled={!!testing[conn.id]} onClick={() => test(conn.id)}>Test connection</button>
                  <button className="btn btn-ghost" onClick={() => openEdit(conn)}>Edit</button>
                  {confirmRemove === conn.id
                    ? <><button className="btn btn-ghost" style={{ color: '#B4261F' }} onClick={() => remove(conn)}>Remove for good</button><button className="btn btn-ghost" onClick={() => setConfirmRemove(null)}>Keep</button></>
                    : <button className="btn btn-ghost" onClick={() => setConfirmRemove(conn.id)}>Remove</button>}
                </div>
              </div>
              {(detail?.message || conn.last_error) && (
                <div style={{ marginTop: 10, marginLeft: 36, fontSize: 13, color: (r ? r.ok : conn.status === 'connected') ? '#1F7A45' : '#B4261F' }}>
                  {detail?.message || conn.last_error}
                  {Array.isArray(detail?.checks) && detail.checks.length > 0 && (
                    <ul style={{ margin: '6px 0 0', paddingLeft: 18, color: 'var(--ink)' }}>
                      {detail.checks.map((k, i) => <li key={i}><span aria-hidden>{k.ok ? '✅' : '⚠️'}</span> <b>{k.name}:</b> {k.note}</li>)}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ---------- catalog ---------- */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <input style={{ ...inp, maxWidth: 280 }} placeholder="Search tools…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search tools" />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {cats.map(x => (
            <button key={x} className={'btn ' + (cat === x ? 'btn-primary' : 'btn-ghost')} style={{ padding: '6px 12px', fontSize: 13 }} onClick={() => setCat(x)}>{x}</button>
          ))}
        </div>
      </div>
      {groups.map(([g, list]) => (
        <div key={g} style={{ marginBottom: 18 }}>
          <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink-soft)', margin: '6px 0 8px' }}>{g}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
            {list.map(c => {
              const n = conns.filter(x => x.provider === c.key).length
              return (
                <div key={c.key} className="card" style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 8, opacity: c.available ? 1 : 0.85 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span style={{ fontSize: 22 }} aria-hidden>{c.icon}</span>
                    <b style={{ flex: 1 }}>{c.name}</b>
                    {n > 0 && <span style={{ fontSize: 11.5, fontWeight: 700, color: '#1F7A45' }}>✓ {n} connected</span>}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--ink-soft)', flex: 1 }}>{c.description}</div>
                  {c.capabilities?.length > 0 && <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {c.capabilities.slice(0, 4).map(k => <span key={k} style={{ fontSize: 11, background: 'var(--surface-2, #F3F1EC)', padding: '2px 7px', borderRadius: 6 }}>{k}</span>)}
                  </div>}
                  {c.available
                    ? <button className="btn btn-primary" onClick={() => openNew(c)}>{n ? 'Add another' : 'Connect'}</button>
                    : asked[c.key]
                      ? <div style={{ fontSize: 13, color: '#1F7A45' }}>Thanks — we've noted you want this.</div>
                      : <button className="btn btn-ghost" onClick={() => ask(c)}>Coming soon · Ask for this</button>}
                </div>
              )
            })}
          </div>
        </div>
      ))}
      {!groups.length && <div className="card">No tools match that search. Try "Custom API" for anything with an API key.</div>}

      {/* ---------- activity ---------- */}
      <div className="card" style={{ marginTop: 10 }}>
        <button className="btn btn-ghost" onClick={() => setShowLog(s => !s)} aria-expanded={showLog}>{showLog ? '▾' : '▸'} Recent activity</button>
        {showLog && <div style={{ marginTop: 8 }}>
          {!(data.log || []).length && <div className="page-sub">Nothing yet.</div>}
          {(data.log || []).map((l, i) => (
            <div key={i} style={{ fontSize: 13, padding: '6px 0', borderTop: i ? '1px solid var(--line)' : 0 }}>
              <span style={{ color: 'var(--ink-soft)' }}>{ago(l.at)}</span> · <b>{l.actor_name || 'Someone'}</b> {ACTION[l.action] || l.action} {byKey[l.provider]?.name || l.provider}
              {l.detail && l.action !== 'connected' && l.action !== 'removed' ? <span style={{ color: l.ok === false ? '#B4261F' : 'var(--ink-soft)' }}> — {l.detail}</span> : null}
            </div>
          ))}
        </div>}
      </div>

      {/* ---------- connect / edit form ---------- */}
      {edit && def && (
        <div role="dialog" aria-modal="true" aria-label={`Connect ${def.name}`} onClick={e => { if (e.target === e.currentTarget && !busy) setEdit(null) }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 2000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 16px', overflowY: 'auto' }}>
          <div className="card" style={{ width: '100%', maxWidth: 520, margin: 0 }}>
            <h2 style={{ margin: '0 0 4px', fontSize: 18 }}><span aria-hidden>{def.icon}</span> {edit.id ? 'Edit' : 'Connect'} {def.name}</h2>
            <p className="page-sub" style={{ margin: 0 }}>{def.description}{def.docs_url && <> <a href={def.docs_url} target="_blank" rel="noreferrer">Where do I find these?</a></>}</p>
            <label style={lbl}>Name for this connection</label>
            <input style={inp} value={edit.label} maxLength={80} onChange={e => setEdit(x => ({ ...x, label: e.target.value }))} placeholder={def.name} />
            {(def.fields || []).map(f => {
              const val = f.secret ? (edit.secrets[f.key] || '') : (edit.config[f.key] ?? '')
              const set = (v) => setEdit(x => f.secret ? { ...x, secrets: { ...x.secrets, [f.key]: v } } : { ...x, config: { ...x.config, [f.key]: v } })
              const ph = f.secret && edit.id ? `Saved (${edit.hint || 'hidden'}) — leave blank to keep` : (f.placeholder || '')
              return (
                <div key={f.key}>
                  <label style={lbl} htmlFor={`f-${f.key}`}>{f.label}{f.required ? '' : ' (optional)'}</label>
                  {f.type === 'select'
                    ? <select id={`f-${f.key}`} style={inp} value={val} onChange={e => set(e.target.value)}>{(f.options || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                    : f.type === 'textarea'
                      ? <textarea id={`f-${f.key}`} style={{ ...inp, minHeight: 120, fontFamily: 'ui-monospace, monospace', fontSize: 12 }} value={val} placeholder={ph} onChange={e => set(e.target.value)} autoComplete="off" spellCheck={false} />
                      : <input id={`f-${f.key}`} style={inp} type={f.secret ? 'password' : 'text'} value={val} placeholder={ph} onChange={e => set(e.target.value)} autoComplete={f.secret ? 'new-password' : 'off'} spellCheck={false} />}
                  {f.help && <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 4 }}>{f.help}</div>}
                </div>
              )
            })}
            {formErr && <div style={{ color: '#B4261F', fontSize: 13.5, marginTop: 12 }}>{formErr}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn btn-ghost" disabled={busy} onClick={() => setEdit(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : edit.id ? 'Save and test' : 'Connect and test'}</button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 10 }}>🔒 Keys are encrypted the moment you save. Command Center will only use them to read from {def.name}.</div>
          </div>
        </div>
      )}
    </div>
  )
}
