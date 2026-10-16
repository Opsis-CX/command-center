// ============================================================
//  Test a web lead (/test-lead) — team members submit themselves as a
//  web lead for "Opsis Overhead Doors" — a made-up garage door brand, so no
//  real client name is used. The lead drops straight into the
//  "TEST — Opsis Overhead Doors S2L (team leads)" dial campaign, the agents get a
//  notification, and this page shows the speed-to-lead stopwatch:
//  lead received → first dial → first conversation → disposition.
//
//  Everyone sees their own test leads; managers see all of them plus the
//  scoreboard (median time to first dial, % dialed within 5 min, contact rate,
//  booked).
//
//  Data: rpc test_lead_submit / test_lead_results (SECURITY DEFINER; no phone
//  numbers are returned — last 4 only).
// ============================================================
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const SERVICES = [
  "Door won't open/close", 'Broken spring', 'Opener', 'Off track / cable',
  'New door quote', 'New opener quote', 'Maintenance / tune-up', 'Commercial', 'Other',
]
const STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY']
const STATUS = {
  pending: ['Waiting for a call', '#0891b2'], in_progress: ['Being called', '#7c3aed'], done: ['Finished', '#16a34a'],
  max_attempts: ['No answer (max tries)', '#dc2626'], removed: ['Closed', '#64748b'], dnc: ['Do not call', '#dc2626'], expired: ['Expired', '#64748b'],
}

const fmtTime = ts => ts ? new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
function fmtDur(s) {
  if (s == null) return '—'
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2) }

export default function TestLead() {
  const [form, setForm] = useState({ name: '', phone: '', state: 'TX', zip: '', service: SERVICES[0], details: '', consent: false })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [sent, setSent] = useState(null)
  const [rows, setRows] = useState([])
  const [isMgr, setIsMgr] = useState(false)
  const [now, setNow] = useState(Date.now())

  const load = async () => {
    const { data } = await supabase.rpc('test_lead_results')
    setRows(Array.isArray(data) ? data : [])
  }
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: p } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle()
        if (p?.full_name) setForm(f => ({ ...f, name: f.name || p.full_name }))
        const { data: m } = await supabase.rpc('can_manage_dialer', { p_uid: user.id })
        setIsMgr(!!m)
      }
    })()
    load()
    const poll = setInterval(load, 10000)
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => { clearInterval(poll); clearInterval(tick) }
  }, [])

  const set = p => setForm(f => ({ ...f, ...p }))
  const submit = async e => {
    e.preventDefault()
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('test_lead_submit', {
      p_name: form.name, p_phone: form.phone, p_state: form.state, p_zip: form.zip,
      p_service: form.service, p_details: form.details, p_consent: form.consent,
    })
    setBusy(false)
    if (error) return setErr(error.message)
    setSent(data)
    set({ details: '', consent: false })
    load()
  }

  const stats = useMemo(() => {
    const dialed = rows.filter(r => r.seconds_to_first_dial != null).map(r => r.seconds_to_first_dial)
    const within5 = dialed.filter(s => s <= 300).length
    const contacted = rows.filter(r => r.seconds_to_contact != null).length
    const booked = rows.filter(r => r.last_disposition === 'booked').length
    return {
      leads: rows.length, dialed: dialed.length, median: median(dialed),
      within5: rows.length ? Math.round((within5 / rows.length) * 100) : null,
      contact: rows.length ? Math.round((contacted / rows.length) * 100) : null, booked,
    }
  }, [rows])

  const mine = sent && rows.find(r => r.id === sent.id)

  return (
    <div style={S.page}>
      <h2 style={S.h2}>Test a web lead</h2>
      <p style={S.intro}>
        Pretend you're a homeowner who just filled out the website form for Opsis Overhead Doors, a made-up garage door company. Submit your own mobile number —
        the lead goes straight into our test speed-to-lead campaign and the clock starts. Answer when we call and play the customer.
        This is internal testing only — no real customer or client is involved.
      </p>

      <div className="tl-grid" style={S.grid}>
        <form onSubmit={submit} style={{ ...S.card, ...S.formCard }}>
          <div style={S.brandBar}>
            <div style={{ fontWeight: 800, fontSize: 17 }}>Opsis Overhead Doors</div>
            <div style={{ fontSize: 12.5, opacity: 0.85 }}>Request service or a free estimate</div>
          </div>
          <div style={{ padding: 16 }}>
            {err && <div style={S.error}>{err}</div>}
            <label style={S.lbl}>Your name<input style={S.input} value={form.name} onChange={e => set({ name: e.target.value })} required /></label>
            <label style={S.lbl}>Mobile number<input style={S.input} type="tel" inputMode="tel" placeholder="(512) 555-0142" value={form.phone} onChange={e => set({ phone: e.target.value })} required /></label>
            <div style={{ display: 'flex', gap: 10 }}>
              <label style={{ ...S.lbl, flex: 1 }}>State
                <select style={S.input} value={form.state} onChange={e => set({ state: e.target.value })}>{STATES.map(s => <option key={s}>{s}</option>)}</select>
              </label>
              <label style={{ ...S.lbl, flex: 1 }}>Zip<input style={S.input} inputMode="numeric" maxLength={5} value={form.zip} onChange={e => set({ zip: e.target.value.replace(/\D/g, '') })} placeholder="78613" /></label>
            </div>
            <div style={{ fontSize: 12, opacity: 0.65, marginTop: -4 }}>State sets your local time, so we only call during calling hours where you are.</div>
            <label style={S.lbl}>What do you need?
              <select style={S.input} value={form.service} onChange={e => set({ service: e.target.value })}>{SERVICES.map(s => <option key={s}>{s}</option>)}</select>
            </label>
            <label style={S.lbl}>Tell us a little more <span style={{ fontWeight: 400, opacity: 0.6 }}>(optional — make it realistic)</span>
              <textarea style={{ ...S.input, minHeight: 70, fontFamily: 'inherit' }} value={form.details} onChange={e => set({ details: e.target.value })}
                placeholder="Door is stuck halfway and I heard a loud bang this morning." />
            </label>
            <label style={S.check}>
              <input type="checkbox" checked={form.consent} onChange={e => set({ consent: e.target.checked })} />
              <span>I agree Opsis CX may call this number for internal testing of our calling platform, and the call may be recorded.</span>
            </label>
            <button type="submit" disabled={busy} style={S.primary}>{busy ? 'Sending…' : 'Submit request'}</button>
            <div style={{ fontSize: 12, opacity: 0.6, marginTop: 8 }}>Limit 3 test leads per person per day.</div>
          </div>
        </form>

        <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
          {sent && (
            <div style={{ ...S.card, borderColor: '#0891b2' }}>
              <div style={S.sectionTitle}>Lead received at {fmtTime(sent.created_at)}</div>
              {mine?.first_dial_at
                ? <div style={{ fontSize: 15 }}>First dial in <strong>{fmtDur(mine.seconds_to_first_dial)}</strong>{mine.agent_name ? ` by ${mine.agent_name}` : ''}.</div>
                : <div style={{ fontSize: 15 }}>Waiting for the first call… <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtDur(Math.max(0, Math.round((now - new Date(sent.created_at).getTime()) / 1000)))}</strong></div>}
              <div style={{ fontSize: 13, opacity: 0.75, marginTop: 6 }}>Keep your phone handy. If you miss it, the dialer tries again on its own schedule — that's part of the test.</div>
            </div>
          )}

          {isMgr && (
            <div style={S.card}>
              <div style={S.sectionTitle}>Scoreboard (all test leads)</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Stat label="Leads" value={stats.leads} />
                <Stat label="Median time to first dial" value={fmtDur(stats.median)} />
                <Stat label="Dialed within 5 min" value={stats.within5 == null ? '—' : `${stats.within5}%`} />
                <Stat label="Reached" value={stats.contact == null ? '—' : `${stats.contact}%`} />
                <Stat label="Booked" value={stats.booked} />
              </div>
              <div style={{ fontSize: 12.5, opacity: 0.7, marginTop: 8 }}>
                Work these from the <Link to="/dialer" style={S.link}>Agent workspace</Link> (campaign "TEST — Opsis Overhead Doors S2L (team leads)"). Full detail in <Link to="/reporting/calls" style={S.link}>Call reports</Link>.
              </div>
            </div>
          )}

          <div style={S.card}>
            <div style={S.sectionTitle}>{isMgr ? 'All test leads' : 'My test leads'}</div>
            {!rows.length && <div style={{ fontSize: 13, opacity: 0.65 }}>None yet.</div>}
            {!!rows.length && (
              <div style={{ overflowX: 'auto' }}>
                <table style={S.table}>
                  <thead><tr>
                    <th style={S.th}>Received</th><th style={S.th}>Lead</th>
                    <th style={S.th}>To first dial</th><th style={S.th}>To conversation</th>
                    <th style={S.th}>Tries</th><th style={S.th}>Status</th>
                  </tr></thead>
                  <tbody>
                    {rows.map(r => {
                      const st = STATUS[r.status] || [r.status, '#64748b']
                      const waiting = r.first_dial_at == null && ['pending', 'in_progress'].includes(r.status)
                      return (
                        <tr key={r.id}>
                          <td style={{ ...S.td, whiteSpace: 'nowrap' }}>{fmtTime(r.created_at)}</td>
                          <td style={S.td}>{r.contact_name}{r.last4 ? <span style={{ opacity: 0.6 }}> ·{r.last4}</span> : null}
                            <div style={{ fontSize: 11.5, opacity: 0.6 }}>{r.service}{isMgr && r.submitted_by ? ` · by ${r.submitted_by}` : ''}</div></td>
                          <td style={{ ...S.td, fontVariantNumeric: 'tabular-nums', color: r.seconds_to_first_dial != null && r.seconds_to_first_dial > 300 ? '#dc2626' : undefined }}>
                            {waiting ? <span style={{ opacity: 0.7 }}>{fmtDur(Math.round((now - new Date(r.created_at).getTime()) / 1000))}…</span> : fmtDur(r.seconds_to_first_dial)}
                          </td>
                          <td style={{ ...S.td, fontVariantNumeric: 'tabular-nums' }}>{fmtDur(r.seconds_to_contact)}</td>
                          <td style={S.td}>{r.attempts}</td>
                          <td style={S.td}>
                            <span style={{ ...S.badge, background: st[1] }}>{st[0]}</span>
                            {r.last_disposition && <div style={{ fontSize: 11.5, opacity: 0.65, marginTop: 3 }}>{r.last_disposition.replace(/_/g, ' ')}</div>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
      <style>{`@media (max-width: 860px) { .tl-grid { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div style={S.stat}>
      <div style={{ fontSize: 11.5, opacity: 0.7 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  )
}

const S = {
  page: { padding: 20, maxWidth: 1150, margin: '0 auto' },
  h2: { margin: 0, fontSize: 22 },
  intro: { margin: '6px 0 16px', opacity: 0.78, fontSize: 13.5, lineHeight: 1.6, maxWidth: 820 },
  grid: { display: 'grid', gridTemplateColumns: 'minmax(300px, 420px) 1fr', gap: 16, alignItems: 'start' },
  card: { padding: 14, borderRadius: 12, border: '1px solid rgba(100,116,139,0.25)', background: 'var(--card, transparent)' },
  formCard: { padding: 0, overflow: 'hidden' },
  brandBar: { background: '#7a1f1f', color: '#fff', padding: '14px 16px' },
  sectionTitle: { fontWeight: 700, marginBottom: 8 },
  lbl: { display: 'block', fontSize: 13, fontWeight: 600, margin: '10px 0' },
  input: { display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 4, padding: '9px 10px', borderRadius: 8, border: '1px solid rgba(100,116,139,0.35)', background: 'transparent', color: 'inherit', fontSize: 14 },
  check: { display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, margin: '12px 0', cursor: 'pointer', lineHeight: 1.45 },
  primary: { width: '100%', padding: '11px 14px', borderRadius: 10, border: 'none', background: '#7a1f1f', color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer' },
  error: { padding: '8px 10px', borderRadius: 8, background: 'rgba(220,38,38,0.1)', color: '#b91c1c', fontSize: 13, marginBottom: 6 },
  stat: { padding: '10px 14px', borderRadius: 12, border: '1px solid rgba(100,116,139,0.25)', minWidth: 120 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13.5 },
  th: { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid rgba(100,116,139,0.3)', fontSize: 12.5, whiteSpace: 'nowrap' },
  td: { padding: '8px 10px', borderBottom: '1px solid rgba(100,116,139,0.15)', verticalAlign: 'top' },
  badge: { color: '#fff', padding: '3px 9px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap' },
  link: { color: '#0891b2', fontWeight: 600 },
}
