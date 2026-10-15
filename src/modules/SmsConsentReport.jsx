// ============================================================
//  SMS Consent report — admin page at /sms-consents
//
//  Data (all admin-only via RLS / is_app_admin()):
//    sms_consent_status  view — one row per profile, latest status
//    sms_consents        table — every opt-in / opt-out (append-only)
//  Actions:
//    link_sms_consent(consent_id, profile_id)  — attach an unmatched form submission
//    record_sms_opt_out(phone, 'admin')        — record a manual opt-out
//
//  profiles.sms_enabled follows the latest consent automatically; the
//  send-sms edge function will not text anyone whose sms_enabled is false.
// ============================================================
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

const EXTERNAL_ROLES = ['client', 'csr']   // portal logins — not agents, hidden by default

const STATUS_STYLE = {
  'Opted in':    { bg: 'rgba(22,163,74,0.12)',  fg: '#15803d' },
  'Opted out':   { bg: 'rgba(220,38,38,0.12)',  fg: '#b91c1c' },
  'No response': { bg: 'rgba(100,116,139,0.14)', fg: '#64748b' },
}

const SOURCE_LABEL = { public_form: 'Consent form', in_app: 'In app', sms_reply: 'Text reply (STOP)', admin: 'Admin' }

function fmtDate(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}
function fmtPhone(p) {
  const d = (p || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (p || '')
}
function downloadCsv(filename, rows) {
  if (!rows.length) return
  const cols = Object.keys(rows[0])
  const esc = v => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export default function SmsConsentReport() {
  const [tab, setTab] = useState('status')           // 'status' | 'unmatched' | 'history'
  const [status, setStatus] = useState([])
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [includeExternal, setIncludeExternal] = useState(false)
  const [expanded, setExpanded] = useState(null)     // profile_id with history open
  const [linkChoice, setLinkChoice] = useState({})   // consent_id -> profile_id
  const [busyId, setBusyId] = useState(null)
  const [copied, setCopied] = useState(false)

  async function load() {
    setLoading(true); setError('')
    const [s, h] = await Promise.all([
      supabase.from('sms_consent_status').select('*').eq('is_active', true).order('full_name'),
      supabase.from('sms_consents').select('*').order('created_at', { ascending: false }).limit(5000),
    ])
    if (s.error || h.error) setError((s.error || h.error).message)
    setStatus(s.data || [])
    setHistory(h.data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const people = useMemo(() => {
    const q = search.trim().toLowerCase()
    return status
      .filter(r => includeExternal || !EXTERNAL_ROLES.includes(r.role))
      .filter(r => statusFilter === 'all' || r.status === statusFilter)
      .filter(r => !q || [r.full_name, r.email, r.phone, r.consent_phone].some(v => (v || '').toLowerCase().includes(q)))
  }, [status, search, statusFilter, includeExternal])

  const counts = useMemo(() => {
    const base = status.filter(r => includeExternal || !EXTERNAL_ROLES.includes(r.role))
    const c = { total: base.length, 'Opted in': 0, 'Opted out': 0, 'No response': 0 }
    base.forEach(r => { c[r.status] = (c[r.status] || 0) + 1 })
    return c
  }, [status, includeExternal])

  const unmatched = useMemo(() => history.filter(h => !h.profile_id), [history])
  const historyByProfile = useMemo(() => {
    const m = {}
    history.forEach(h => { if (h.profile_id) (m[h.profile_id] ||= []).push(h) })
    return m
  }, [history])
  const nameById = useMemo(() => Object.fromEntries(status.map(r => [r.profile_id, r.full_name])), [status])
  const linkOptions = useMemo(() =>
    status.filter(r => !EXTERNAL_ROLES.includes(r.role)).sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '')),
  [status])

  async function linkConsent(consentId) {
    const pid = linkChoice[consentId]
    if (!pid) return
    setBusyId(consentId)
    const { error: err } = await supabase.rpc('link_sms_consent', { p_consent_id: consentId, p_profile_id: pid })
    setBusyId(null)
    if (err) { alertInline(err.message); return }
    load()
  }

  async function optOut(row) {
    const phone = row.consent_phone || row.phone
    if (!phone) { alertInline('No phone number on file for this person.'); return }
    if (!window.confirm(`Record an opt-out for ${row.full_name} (${fmtPhone(phone)})? They will stop receiving texts.`)) return
    setBusyId(row.profile_id)
    const { error: err } = await supabase.rpc('record_sms_opt_out', { p_phone: phone, p_source: 'admin' })
    setBusyId(null)
    if (err) { alertInline(err.message); return }
    load()
  }

  function alertInline(msg) { setError(msg); setTimeout(() => setError(''), 6000) }

  function exportStatus() {
    downloadCsv(`sms-consent-status-${new Date().toISOString().slice(0, 10)}.csv`, people.map(r => ({
      name: r.full_name, email: r.email, role: r.role, status: r.status,
      consent_phone: r.consent_phone || '', profile_phone: r.phone || '',
      last_change: r.latest_at || '', last_source: SOURCE_LABEL[r.latest_source] || '',
      consent_version: r.consent_version || '', texting_enabled: r.sms_enabled ? 'yes' : 'no',
    })))
  }
  function exportHistory() {
    downloadCsv(`sms-consent-history-${new Date().toISOString().slice(0, 10)}.csv`, history.map(h => ({
      recorded_at: h.created_at, matched_agent: nameById[h.profile_id] || '', name_entered: h.full_name,
      phone: h.phone_e164, action: h.action, source: SOURCE_LABEL[h.source] || h.source, match_method: h.match_method || '',
      consent_version: h.consent_version || '', consent_text: h.consent_text || '', ip_address: h.ip_address || '', user_agent: h.user_agent || '',
    })))
  }
  function copyLink() {
    const url = `${window.location.origin}/sms-consent`
    navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  const tabBtn = (k, label) => (
    <button key={k} onClick={() => setTab(k)} style={{ ...S.tab, ...(tab === k ? S.tabOn : {}) }}>{label}</button>
  )

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h1 className="page-title">SMS Consent</h1>
          <p className="page-sub">Who has opted in to scheduling and operational texts. Only opted-in agents receive messages.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a href="/sms-consent" target="_blank" rel="noreferrer" style={S.btn}>Open consent form ↗</a>
          <button onClick={copyLink} style={S.btn}>{copied ? 'Copied!' : 'Copy form link'}</button>
        </div>
      </div>

      <div style={S.tiles}>
        <Tile label="Opted in" value={counts['Opted in']} color="#15803d" onClick={() => { setTab('status'); setStatusFilter('Opted in') }} />
        <Tile label="Opted out" value={counts['Opted out']} color="#b91c1c" onClick={() => { setTab('status'); setStatusFilter('Opted out') }} />
        <Tile label="No response" value={counts['No response']} color="#64748b" onClick={() => { setTab('status'); setStatusFilter('No response') }} />
        <Tile label="Unmatched submissions" value={unmatched.length} color="#b45309" onClick={() => setTab('unmatched')} />
      </div>

      {error && <div style={S.error}>{error}</div>}

      <div style={{ display: 'flex', gap: 6, margin: '18px 0 12px', flexWrap: 'wrap' }}>
        {tabBtn('status', 'By person')}
        {tabBtn('unmatched', `Unmatched (${unmatched.length})`)}
        {tabBtn('history', 'Full history')}
      </div>

      {loading ? <div style={S.muted}>Loading…</div> : tab === 'status' ? (
        <>
          <div style={S.toolbar}>
            <input placeholder="Search name, email or phone" value={search} onChange={e => setSearch(e.target.value)} style={S.input} />
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={S.input}>
              <option value="all">All statuses</option>
              <option>Opted in</option><option>Opted out</option><option>No response</option>
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={includeExternal} onChange={e => setIncludeExternal(e.target.checked)} />
              Include client / CSR portal logins
            </label>
            <button onClick={exportStatus} style={{ ...S.btn, marginLeft: 'auto' }}>Export CSV</button>
          </div>
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead><tr>
                <th style={S.th}>Name</th><th style={S.th}>Status</th><th style={S.th}>Phone</th>
                <th style={S.th}>Last change</th><th style={S.th}>How</th><th style={S.th}></th>
              </tr></thead>
              <tbody>
                {people.map(r => {
                  const hist = historyByProfile[r.profile_id] || []
                  const open = expanded === r.profile_id
                  const st = STATUS_STYLE[r.status]
                  return [
                    <tr key={r.profile_id}>
                      <td style={S.td}>
                        <div style={{ fontWeight: 600 }}>{r.full_name || '(no name)'}</div>
                        <div style={S.small}>{r.email} · {r.role}</div>
                      </td>
                      <td style={S.td}><span style={{ ...S.pill, background: st.bg, color: st.fg }}>{r.status}</span></td>
                      <td style={S.td}>{fmtPhone(r.consent_phone || r.phone)}</td>
                      <td style={S.td}>{fmtDate(r.latest_at)}</td>
                      <td style={S.td}>{SOURCE_LABEL[r.latest_source] || ''}</td>
                      <td style={{ ...S.td, whiteSpace: 'nowrap', textAlign: 'right' }}>
                        {hist.length > 0 && <button style={S.linkBtn} onClick={() => setExpanded(open ? null : r.profile_id)}>{open ? 'Hide' : `History (${hist.length})`}</button>}
                        {r.status === 'Opted in' && <button style={{ ...S.linkBtn, color: '#b91c1c' }} disabled={busyId === r.profile_id} onClick={() => optOut(r)}>Opt out</button>}
                      </td>
                    </tr>,
                    open && (
                      <tr key={r.profile_id + '-h'}><td colSpan={6} style={{ ...S.td, background: 'rgba(100,116,139,0.06)' }}>
                        <HistoryList rows={hist} />
                      </td></tr>
                    ),
                  ]
                })}
                {!people.length && <tr><td colSpan={6} style={{ ...S.td, ...S.muted }}>No one matches these filters.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      ) : tab === 'unmatched' ? (
        <>
          <p style={S.muted}>Form submissions we couldn't match to an agent automatically (no matching phone or exact name). Pick the right person and link it — their texting status updates right away.</p>
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead><tr>
                <th style={S.th}>Submitted</th><th style={S.th}>Name entered</th><th style={S.th}>Phone</th><th style={S.th}>Action</th><th style={S.th}>Link to agent</th>
              </tr></thead>
              <tbody>
                {unmatched.map(h => (
                  <tr key={h.id}>
                    <td style={S.td}>{fmtDate(h.created_at)}</td>
                    <td style={S.td}>{h.full_name}</td>
                    <td style={S.td}>{fmtPhone(h.phone_e164)}</td>
                    <td style={S.td}>{h.action === 'opt_in' ? 'Opt in' : 'Opt out'}</td>
                    <td style={S.td}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <select value={linkChoice[h.id] || ''} onChange={e => setLinkChoice(c => ({ ...c, [h.id]: e.target.value }))} style={{ ...S.input, minWidth: 200 }}>
                          <option value="">Choose agent…</option>
                          {linkOptions.map(o => <option key={o.profile_id} value={o.profile_id}>{o.full_name} — {o.email}</option>)}
                        </select>
                        <button style={S.btn} disabled={!linkChoice[h.id] || busyId === h.id} onClick={() => linkConsent(h.id)}>Link</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!unmatched.length && <tr><td colSpan={5} style={{ ...S.td, ...S.muted }}>Nothing to match. 🎉</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <div style={S.toolbar}>
            <span style={S.muted}>Every opt-in and opt-out ever recorded, newest first. Records can't be edited or deleted.</span>
            <button onClick={exportHistory} style={{ ...S.btn, marginLeft: 'auto' }}>Export CSV (audit)</button>
          </div>
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead><tr>
                <th style={S.th}>When</th><th style={S.th}>Agent</th><th style={S.th}>Phone</th><th style={S.th}>Action</th><th style={S.th}>Source</th><th style={S.th}>Version</th><th style={S.th}>IP</th>
              </tr></thead>
              <tbody>
                {history.map(h => (
                  <tr key={h.id}>
                    <td style={S.td}>{fmtDate(h.created_at)}</td>
                    <td style={S.td}>{nameById[h.profile_id] || <span style={{ color: '#b45309' }}>Unmatched: {h.full_name}</span>}</td>
                    <td style={S.td}>{fmtPhone(h.phone_e164)}</td>
                    <td style={S.td}>{h.action === 'opt_in' ? 'Opt in' : 'Opt out'}</td>
                    <td style={S.td}>{SOURCE_LABEL[h.source] || h.source}</td>
                    <td style={S.td}>{h.consent_version || ''}</td>
                    <td style={S.td}>{h.ip_address || ''}</td>
                  </tr>
                ))}
                {!history.length && <tr><td colSpan={7} style={{ ...S.td, ...S.muted }}>No consent records yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function Tile({ label, value, color, onClick }) {
  return (
    <button onClick={onClick} style={S.tile}>
      <div style={{ fontSize: 28, fontWeight: 800, color }}>{value ?? 0}</div>
      <div style={{ fontSize: 13, opacity: 0.75 }}>{label}</div>
    </button>
  )
}

function HistoryList({ rows }) {
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {rows.map(h => (
        <div key={h.id} style={{ fontSize: 13 }}>
          <strong>{h.action === 'opt_in' ? 'Opted in' : 'Opted out'}</strong> · {fmtDate(h.created_at)} · {SOURCE_LABEL[h.source] || h.source}
          {' · '}{fmtPhone(h.phone_e164)}
          {h.consent_version ? ` · wording v${h.consent_version}` : ''}
          {h.ip_address ? ` · IP ${h.ip_address}` : ''}
          {h.full_name ? ` · entered as "${h.full_name}"` : ''}
        </div>
      ))}
    </div>
  )
}

const S = {
  tiles: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 },
  tile: { textAlign: 'left', padding: '14px 16px', borderRadius: 12, border: '1px solid rgba(100,116,139,0.25)', background: 'transparent', color: 'inherit', cursor: 'pointer' },
  tab: { padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(100,116,139,0.35)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontWeight: 600, fontSize: 13 },
  tabOn: { background: '#0891b2', borderColor: '#0891b2', color: '#fff' },
  toolbar: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 },
  input: { padding: '7px 10px', borderRadius: 8, border: '1px solid rgba(100,116,139,0.35)', background: 'transparent', color: 'inherit', fontSize: 13 },
  btn: { padding: '7px 12px', borderRadius: 8, border: '1px solid rgba(100,116,139,0.35)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontWeight: 600, fontSize: 13, textDecoration: 'none' },
  linkBtn: { background: 'none', border: 'none', color: '#0891b2', cursor: 'pointer', fontWeight: 600, fontSize: 13, marginLeft: 10 },
  tableWrap: { overflowX: 'auto', border: '1px solid rgba(100,116,139,0.25)', borderRadius: 12 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
  th: { textAlign: 'left', padding: '10px 12px', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4, opacity: 0.7, borderBottom: '1px solid rgba(100,116,139,0.25)' },
  td: { padding: '10px 12px', borderBottom: '1px solid rgba(100,116,139,0.15)', verticalAlign: 'top' },
  pill: { display: 'inline-block', padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700 },
  small: { fontSize: 12, opacity: 0.65 },
  muted: { fontSize: 13, opacity: 0.7 },
  error: { marginTop: 12, padding: '10px 12px', background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.35)', color: '#b91c1c', borderRadius: 10, fontSize: 13 },
}
