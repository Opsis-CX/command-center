// ============================================================
//  CxLiveBoard — supervisor view for Advanced-engine calls (2026-11-13).
//  Used at the top of the Wallboard. Live service metrics (service level, speed of
//  answer, abandon rate, waiting now), live alerts, every live call with Listen /
//  Whisper / Barge, and shareable TV wallboard links (no login needed).
// ============================================================
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useVoice } from '../lib/voice'
import { cxControl, startMonitor } from '../lib/cx'

const G = '#14302A'
const mmss = s => (s == null ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`)
const pct = v => (v == null ? '—' : `${v}%`)
const dayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString() }

export default function CxLiveBoard({ clientId = null }) {
  const voice = useVoice()
  const [m, setM] = useState(null)
  const [calls, setCalls] = useState([])
  const [alerts, setAlerts] = useState([])
  const [links, setLinks] = useState(null)
  const [mon, setMon] = useState(null)      // { id, mode, call }
  const [err, setErr] = useState('')
  const [showLinks, setShowLinks] = useState(false)
  const args = useCallback(x => (clientId ? { ...x, p_client: clientId } : x), [clientId])

  const load = useCallback(async () => {
    const [a, b, c] = await Promise.all([
      supabase.rpc('cx_metrics', args({ p_start: dayStart(), p_end: new Date(Date.now() + 60000).toISOString() })),
      supabase.rpc('cx_live_calls', args({})),
      supabase.rpc('cx_alerts', args({})),
    ])
    if (a.error) { setErr(a.error.message); return }
    setErr(''); setM(a.data); setCalls(b.data || []); setAlerts(c.data || [])
  }, [args])
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t) }, [load])

  async function join(id, mode, label) {
    setErr('')
    try {
      if (mon?.id === id) { await cxControl('monitor_mode', id, { mode }); setMon({ ...mon, mode }); return }
      if (voice?.monitorCall) { voice.monitorCall(id, mode, label); setMon({ id, mode, shared: true }); return }
      const call = await startMonitor(id, mode, () => setMon(null))
      setMon({ id, mode, call })
    } catch (e) { setErr(e.message) }
  }
  function leave() {
    if (mon?.call) mon.call.disconnect()
    else if (mon?.shared) voice?.hangUp()
    setMon(null)
  }
  async function newLink() {
    const label = window.prompt('Name this TV wallboard (for example "Salina front office TV")')
    if (label === null) return
    const { error } = await supabase.rpc('cx_wallboard_token_create', args({ p_label: label || null }))
    if (error) { setErr(error.message); return }
    loadLinks()
  }
  async function loadLinks() {
    const { data, error } = await supabase.rpc('cx_wallboard_tokens_list', args({}))
    if (!error) setLinks(data || [])
  }
  async function revoke(token) {
    if (!window.confirm('Turn this TV link off? Screens using it will stop updating.')) return
    await supabase.rpc('cx_wallboard_token_revoke', { p_token: token }); loadLinks()
  }

  const used = m && ((m.inbound_offered || 0) + (m.outbound || 0) > 0 || calls.length > 0)
  if (!m && !err) return null
  if (!used && !showLinks) {
    return (
      <div style={{ ...S.card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <div style={S.mut}>Live call monitoring, service level and TV links show here once a line or campaign is on the Advanced engine (Phone setup → Advanced engine).</div>
        <button style={S.btn} onClick={() => { setShowLinks(true); loadLinks() }}>TV links</button>
      </div>
    )
  }
  const waiting = calls.filter(c => c.status === 'queued')
  const longest = waiting.reduce((x, c) => Math.max(x, c.wait_secs || 0), 0)
  const tiles = [
    ['Waiting now', waiting.length, waiting.length ? `longest ${mmss(longest)}` : 'nobody waiting', waiting.length >= 3 || longest > 90],
    ['Service level', pct(m?.service_level), 'answered in time today', m?.service_level != null && m.service_level < 80],
    ['Speed of answer', mmss(m?.asa_secs), 'average wait', (m?.asa_secs || 0) > 30],
    ['Abandon rate', pct(m?.abandon_rate), `${m?.abandoned || 0} hung up waiting`, (m?.abandon_rate || 0) > 5],
    ['Avg handle time', mmss(m?.aht_secs), `hold ${mmss(m?.avg_hold_secs)}`, false],
    ['Callbacks asked', m?.callbacks_requested ?? 0, `${m?.to_ai_or_vm || 0} to AI / voicemail`, false],
    ['Transfers', m?.transfers ?? 0, `${m?.outbound_connected || 0} of ${m?.outbound || 0} outbound connected`, false],
    ['Caller rating', m?.survey_avg != null ? `${m.survey_avg} / 5` : '—', `${m?.survey_n || 0} surveys`, m?.survey_avg != null && m.survey_avg < 4],
  ]

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={S.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          <div style={{ fontWeight: 800, color: G }}>Live calls · today</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {mon && <button style={{ ...S.btn, background: '#fee2e2', borderColor: '#fecaca' }} onClick={leave}>Leave the call</button>}
            <button style={S.btn} onClick={() => { setShowLinks(s => !s); loadLinks() }}>{showLinks ? 'Hide TV links' : 'TV links'}</button>
          </div>
        </div>
        <div style={S.tiles}>
          {tiles.map(([l, v, sub, warn]) => (
            <div key={l} style={{ ...S.tile, borderColor: warn ? '#fca5a5' : '#e2e8f0', background: warn ? '#fff1f2' : '#fff' }}>
              <div style={S.cap}>{l}</div><div style={S.big}>{v}</div><div style={S.mut}>{sub}</div>
            </div>
          ))}
        </div>
        {err && <div style={{ color: '#b91c1c', fontSize: 13, marginTop: 8 }}>{err}</div>}
      </div>

      {alerts.length > 0 && (
        <div style={{ ...S.card, borderColor: '#fed7aa', background: '#fffbf5' }}>
          <div style={S.cap}>Needs attention</div>
          {alerts.map((a, n) => (
            <div key={n} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 0', borderBottom: '1px solid #fde7d0', fontSize: 13.5 }}>
              <span>{a.level === 'high' ? '🔴' : a.level === 'medium' ? '🟠' : '🟡'} {a.text}</span>
              {a.interaction_id && calls.some(c => c.id === a.interaction_id && c.status !== 'queued') && (
                <span style={{ display: 'flex', gap: 4 }}>
                  <button style={S.small} onClick={() => join(a.interaction_id, 'listen', a.text)}>Listen</button>
                  <button style={S.small} onClick={() => join(a.interaction_id, 'whisper', a.text)}>Whisper</button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {calls.length > 0 && (
        <div style={S.card}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr>{['Caller', 'CSR', 'Status', 'Time', 'Mood', 'Last thing said', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {calls.map(c => {
                  const on = mon?.id === c.id
                  return (
                    <tr key={c.id} style={{ background: c.needs_help ? '#fff7ed' : on ? '#f0fdf4' : 'transparent' }}>
                      <td style={S.td}><b>{c.customer}</b><div style={S.mut}>{[c.direction === 'in' ? 'Inbound' : 'Outbound', c.location, c.queue].filter(Boolean).join(' · ')}</div></td>
                      <td style={S.td}>{c.agent || '—'}{c.needs_help && <div style={{ color: '#b45309', fontWeight: 700, fontSize: 12 }}>✋ asked for help</div>}</td>
                      <td style={S.td}>{c.status === 'queued' ? 'Waiting' : c.on_hold ? 'On hold' : c.status === 'connected' ? 'Talking' : c.status}{c.recording_paused ? ' · ⏸ rec' : ''}</td>
                      <td style={S.td}>{mmss(c.wait_secs)}</td>
                      <td style={S.td}>{c.sentiment == null ? '—' : c.sentiment >= 0.3 ? '🙂' : c.sentiment <= -0.3 ? '🙁' : '😐'}</td>
                      <td style={{ ...S.td, maxWidth: 280, color: '#475569' }}>{c.alert ? <span style={{ color: '#9a3412' }}>⚠ {c.alert}</span> : c.last_line || '—'}</td>
                      <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                        {c.status !== 'queued' && (['listen', 'whisper', 'barge']).map(md => (
                          <button key={md} onClick={() => join(c.id, md, c.customer)} style={{ ...S.small, marginRight: 4, ...(on && mon.mode === md ? { background: G, color: '#fff', borderColor: G } : {}) }}>
                            {md === 'listen' ? 'Listen' : md === 'whisper' ? 'Whisper' : 'Barge'}
                          </button>
                        ))}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ ...S.mut, marginTop: 6 }}>Listen: you hear the call, nobody hears you. Whisper: only the CSR hears you. Barge: everyone hears you. Every join is logged.</div>
        </div>
      )}

      {showLinks && (
        <div style={S.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontWeight: 800, color: G }}>TV wallboard links</div>
            <button style={S.btn} onClick={newLink}>+ New TV link</button>
          </div>
          <div style={S.mut}>Open on any office TV or browser — no login. Shows live counts and CSR statuses (first names only), never customer details.</div>
          {(links || []).map(l => {
            const u = `${window.location.origin}/tv.html?t=${l.token}`
            return (
              <div key={l.token} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '8px 0', borderBottom: '1px solid #eef2f7', fontSize: 13, opacity: l.revoked ? 0.5 : 1 }}>
                <span><b>{l.label || l.brand || 'Wallboard'}</b>{l.revoked ? ' · off' : ''}<div style={{ ...S.mut, wordBreak: 'break-all' }}>{u}</div></span>
                {!l.revoked && <span style={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
                  <button style={S.small} onClick={() => navigator.clipboard?.writeText(u)}>Copy</button>
                  <a style={{ ...S.small, textDecoration: 'none' }} href={u} target="_blank" rel="noreferrer">Open</a>
                  <button style={S.small} onClick={() => revoke(l.token)}>Turn off</button>
                </span>}
              </div>
            )
          })}
          {links && links.length === 0 && <div style={{ ...S.mut, marginTop: 8 }}>No TV links yet.</div>}
        </div>
      )}
    </div>
  )
}

const S = {
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 14 },
  tiles: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 },
  tile: { border: '1px solid #e2e8f0', borderRadius: 12, padding: 10 },
  cap: { fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: '#64748b', marginBottom: 4 },
  big: { fontSize: 22, fontWeight: 800, color: G, fontVariantNumeric: 'tabular-nums' },
  mut: { fontSize: 12, color: '#64748b' },
  btn: { padding: '6px 12px', fontSize: 12.5, fontWeight: 700, borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', color: '#0f172a' },
  small: { padding: '4px 9px', fontSize: 12, fontWeight: 700, borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', color: '#0f172a', display: 'inline-block' },
  th: { textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: '#64748b', padding: '6px 8px', borderBottom: '1px solid #e2e8f0' },
  td: { padding: '8px', borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' },
}
