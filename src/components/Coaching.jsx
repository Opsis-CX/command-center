// ============================================================
//  Coaching clips (2026-11-15)
//   CoachingDesk  — supervisors: pick a CSR → a recent scored call → mark the moment (click a line to
//                   start, click another to end) → praise / fix / listen-to note → Send.
//   CoachingInbox — CSRs: clips sent to them, the transcript moment (and audio when available),
//                   a reply box and “Got it” to acknowledge. Supervisors see read / acknowledged status.
//  Data: coach_csrs, coach_csr_calls, coach_call_transcript, coach_clip_create, coach_clips_sent,
//        coach_clips_mine, coach_clip_ack. Audio: opsis-qa-portal 'audio' (supervisor) / opsis-coaching-hub
//        'hubaudio' (CSR); when no recording is available the transcript moment is shown on its own.
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

const G = '#14302A'
const KIND = { praise: ['Great job', '#dcfce7', '#166534'], fix: ['Let’s fix', '#fef3c7', '#92400e'], listen: ['Listen to this', '#e0f2fe', '#075985'] }
const mmss = s => `${Math.floor((s || 0) / 60)}:${String(Math.floor((s || 0) % 60)).padStart(2, '0')}`
const when = d => (d ? new Date(d).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')

async function audioUrl(callId, csr) {
  try {
    const { data } = await supabase.functions.invoke(csr ? 'opsis-coaching-hub' : 'opsis-qa-portal', { body: { action: csr ? 'hubaudio' : 'audio', id: callId, t: Math.floor(Date.now() / 300000) } })
    return data?.url || null
  } catch { return null }
}

function Clip({ start, url }) {
  const ref = useRef(null)
  if (!url) return null
  return <audio ref={ref} src={url} controls preload="metadata" style={{ width: '100%', marginTop: 6 }} onLoadedMetadata={() => { try { ref.current.currentTime = Math.max(0, (start || 0) - 2) } catch { /* */ } }} />
}

function Lines({ segs, a, b, onPick }) {
  return (
    <div style={{ maxHeight: 360, overflow: 'auto', border: '1px solid #e2e8f0', borderRadius: 10, padding: 6 }}>
      {(segs || []).map((s, k) => {
        const on = a != null && s.t >= a && s.t <= (b ?? a)
        return (
          <button key={k} onClick={onPick ? () => onPick(s.t) : undefined} style={{ display: 'flex', gap: 8, width: '100%', textAlign: 'left', border: 'none', cursor: onPick ? 'pointer' : 'default',
            background: on ? '#fef9c3' : 'transparent', padding: '4px 6px', borderRadius: 6, fontSize: 13, color: '#0f172a' }}>
            <span style={{ color: '#64748b', fontVariantNumeric: 'tabular-nums', minWidth: 38 }}>{mmss(s.t)}</span>
            <b style={{ minWidth: 52, color: s.s === 'Agent' ? G : '#7c2d12' }}>{s.s === 'Agent' ? 'CSR' : 'Caller'}</b>
            <span>{s.text}</span>
          </button>
        )
      })}
      {(segs || []).length === 0 && <div style={S.mut}>No transcript for this call.</div>}
    </div>
  )
}

export function CoachingDesk() {
  const [csrs, setCsrs] = useState(null)
  const [csr, setCsr] = useState(null)
  const [calls, setCalls] = useState([])
  const [sent, setSent] = useState([])
  const [call, setCall] = useState(null)
  const [a, setA] = useState(null), [b, setB] = useState(null)
  const [kind, setKind] = useState('fix')
  const [note, setNote] = useState('')
  const [url, setUrl] = useState(null)
  const [err, setErr] = useState(''), [msg, setMsg] = useState('')
  const [q, setQ] = useState('')

  useEffect(() => { supabase.rpc('coach_csrs').then(({ data, error }) => { if (error) setErr(error.message); else setCsrs(data || []) }) }, [])
  const loadCsr = useCallback(async c => {
    setCsr(c); setCall(null); setA(null); setB(null)
    const [r1, r2] = await Promise.all([supabase.rpc('coach_csr_calls', { p_csr: c.id, p_days: 14 }), supabase.rpc('coach_clips_sent', { p_csr: c.id, p_days: 60 })])
    if (r1.error) setErr(r1.error.message); else setCalls(r1.data || [])
    setSent(r2.data || [])
  }, [])
  async function openCall(c) {
    setA(null); setB(null); setNote(''); setUrl(null)
    const { data, error } = await supabase.rpc('coach_call_transcript', { p_call: c.id })
    if (error) { setErr(error.message); return }
    setCall({ ...c, ...data }); audioUrl(c.id, false).then(setUrl)
  }
  function pick(t) { if (a == null || b != null) { setA(t); setB(null) } else if (t < a) { setB(a); setA(t) } else setB(t) }
  async function send() {
    const { error } = await supabase.rpc('coach_clip_create', { p_call: call.id, p_start: a ?? 0, p_end: b ?? a ?? null, p_kind: kind, p_note: note })
    if (error) { setErr(error.message); return }
    setMsg(`Sent to ${csr.name}.`); setTimeout(() => setMsg(''), 3000); setNote(''); setA(null); setB(null); loadCsr(csr)
  }

  if (err && !csrs) return <div style={S.card}><b>Couldn’t load coaching.</b><p style={S.mut}>{err}</p></div>
  if (!csrs) return <div style={S.card}>Loading…</div>
  const shown = csrs.filter(c => !q || (c.name || '').toLowerCase().includes(q.toLowerCase()))
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 260px) 1fr', gap: 14, alignItems: 'start' }}>
      <div style={S.card}>
        <div style={S.h3}>CSRs</div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search" style={{ ...S.input, width: '100%', margin: '6px 0' }} />
        <div style={{ display: 'grid', gap: 2, maxHeight: 520, overflow: 'auto' }}>
          {shown.map(c => (
            <button key={c.id} onClick={() => loadCsr(c)} style={{ ...S.row, background: csr?.id === c.id ? '#E6F0EA' : 'transparent' }}>
              <span><b>{c.name}</b><div style={S.mut}>{[c.brand, c.location].filter(Boolean).join(' · ')}</div></span>
              {c.open > 0 && <span style={S.pill}>{c.open} open</span>}
            </button>
          ))}
          {shown.length === 0 && <div style={S.mut}>No CSRs in your area.</div>}
        </div>
      </div>
      <div style={{ display: 'grid', gap: 14 }}>
        {!csr && <div style={S.card}><div style={S.h2}>Coaching clips</div><div style={S.mut}>Pick a CSR, open one of their recent calls, click the line where the moment starts and the line where it ends, add a note and send. They see it in their Coaching inbox and tap “Got it”.</div></div>}
        {csr && !call && (
          <div style={S.card}>
            <div style={S.h3}>{csr.name} — calls from the last 14 days</div>
            {calls.length === 0 && <div style={S.mut}>No scored calls linked to this CSR yet.</div>}
            {calls.map(c => (
              <button key={c.id} onClick={() => openCall(c)} style={{ ...S.row, borderTop: '1px solid #f1f5f9' }}>
                <span style={{ minWidth: 0 }}><b>{when(c.started_at)}</b> · {c.topic || c.outcome || 'Call'} {c.customer ? `· ${c.customer}` : ''}
                  <div style={{ ...S.mut, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 560 }}>{c.summary}</div></span>
                <span style={{ whiteSpace: 'nowrap' }}>{c.score != null ? <b>{Math.round(c.score)}%</b> : ''} {c.clips > 0 ? <span style={S.pill}>{c.clips} clip</span> : ''}</span>
              </button>
            ))}
          </div>
        )}
        {call && (
          <div style={S.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              <div><div style={S.h3}>{csr.name} · {when(call.started_at)}</div><div style={S.mut}>{call.summary}</div></div>
              <button style={S.small} onClick={() => setCall(null)}>← Calls</button>
            </div>
            <Clip start={a} url={url} />
            <div style={{ ...S.mut, margin: '8px 0 4px' }}>{a == null ? 'Click the line where the moment starts.' : b == null ? `Starts at ${mmss(a)} — click the line where it ends (or send just this line).` : `Clip ${mmss(a)}–${mmss(b)}`}</div>
            <Lines segs={call.segments} a={a} b={b} onPick={pick} />
            <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
              {Object.entries(KIND).map(([k, [l, bg, fg]]) => (
                <button key={k} onClick={() => setKind(k)} style={{ ...S.small, background: kind === k ? bg : '#fff', color: kind === k ? fg : '#334155', borderColor: kind === k ? fg : '#cbd5e1' }}>{l}</button>
              ))}
            </div>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} placeholder={kind === 'praise' ? 'What they did well…' : kind === 'fix' ? 'What to do differently next time…' : 'What to listen for…'} style={{ ...S.input, width: '100%', marginTop: 8, resize: 'vertical' }} />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
              <button disabled={a == null || !note.trim()} style={S.primary} onClick={send}>Send to {csr.name.split(' ')[0]}</button>
              {msg && <span style={{ color: '#166534', fontSize: 13 }}>{msg}</span>}
              {err && <span style={{ color: '#b91c1c', fontSize: 13 }}>{err}</span>}
            </div>
          </div>
        )}
        {csr && sent.length > 0 && (
          <div style={S.card}>
            <div style={S.h3}>Sent to {csr.name}</div>
            {sent.map(c => (
              <div key={c.id} style={{ borderTop: '1px solid #f1f5f9', padding: '6px 0', fontSize: 13 }}>
                <span style={{ ...S.tag, background: KIND[c.kind]?.[1], color: KIND[c.kind]?.[2] }}>{KIND[c.kind]?.[0]}</span> {c.note}
                <div style={S.mut}>{when(c.created_at)} by {c.from} · {c.acked_at ? `acknowledged ${when(c.acked_at)}` : c.seen_at ? 'seen, not acknowledged yet' : 'not opened yet'}{c.csr_reply ? ` · “${c.csr_reply}”` : ''}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function CoachingInbox({ compact = false }) {
  const [rows, setRows] = useState(null)
  const [reply, setReply] = useState({})
  const [urls, setUrls] = useState({})
  const load = useCallback(() => supabase.rpc('coach_clips_mine').then(({ data }) => setRows(data || [])), [])
  useEffect(() => { load() }, [load])
  async function ack(id) { await supabase.rpc('coach_clip_ack', { p_id: id, p_reply: reply[id] || null }); load() }
  async function play(c) { if (urls[c.id] !== undefined) return; setUrls(u => ({ ...u, [c.id]: null })); const x = await audioUrl(c.call_id, true); setUrls(u => ({ ...u, [c.id]: x || false })) }
  if (!rows) return compact ? null : <div style={S.card}>Loading…</div>
  const open = rows.filter(r => !r.acked_at)
  if (compact && rows.length === 0) return null
  return (
    <div style={{ ...S.card, margin: compact ? '14px auto' : 0, maxWidth: compact ? 1100 : 'none' }}>
      <div style={S.h2}>My coaching {open.length > 0 && <span style={S.pill}>{open.length} new</span>}</div>
      {rows.length === 0 && <div style={S.mut}>Nothing yet. When your supervisor sends you a moment from one of your calls, it shows up here.</div>}
      {rows.map(c => (
        <div key={c.id} style={{ borderTop: '1px solid #f1f5f9', padding: '10px 0', opacity: c.acked_at ? 0.7 : 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <span><span style={{ ...S.tag, background: KIND[c.kind]?.[1], color: KIND[c.kind]?.[2] }}>{KIND[c.kind]?.[0]}</span> <b>{c.from || 'Your supervisor'}</b> · {when(c.created_at)}</span>
            <span style={S.mut}>Call {when(c.call_at)}{c.customer ? ` · ${c.customer}` : ''}</span>
          </div>
          <div style={{ fontSize: 14, margin: '6px 0' }}>{c.note}</div>
          <Lines segs={c.excerpt} />
          {urls[c.id] ? <Clip start={c.start_s} url={urls[c.id]} /> : urls[c.id] === false ? <div style={S.mut}>No recording available for this call.</div>
            : <button style={{ ...S.small, marginTop: 6 }} onClick={() => play(c)}>{urls[c.id] === null ? 'Loading…' : '▶ Play the moment'}</button>}
          {c.acked_at
            ? <div style={{ ...S.mut, marginTop: 6 }}>✓ You acknowledged this {when(c.acked_at)}{c.csr_reply ? ` · “${c.csr_reply}”` : ''}</div>
            : <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <input value={reply[c.id] || ''} onChange={e => setReply(r => ({ ...r, [c.id]: e.target.value }))} placeholder="Reply (optional)" style={{ ...S.input, flex: 1 }} />
                <button style={S.primary} onClick={() => ack(c.id)}>Got it</button>
              </div>}
        </div>
      ))}
    </div>
  )
}

const S = {
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 14 },
  h2: { fontSize: 17, fontWeight: 800, color: G, marginBottom: 4 },
  h3: { fontSize: 15, fontWeight: 800, color: G, marginBottom: 4 },
  mut: { fontSize: 12.5, color: '#64748b' },
  input: { padding: '7px 9px', fontSize: 13, borderRadius: 8, border: '1px solid #cbd5e1', boxSizing: 'border-box' },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer', padding: '8px 6px', borderRadius: 8, color: '#0f172a', background: 'transparent' },
  pill: { fontSize: 11.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: '#fef3c7', color: '#92400e', marginLeft: 6 },
  tag: { fontSize: 11.5, fontWeight: 800, padding: '2px 8px', borderRadius: 999 },
  primary: { padding: '8px 16px', fontSize: 13, fontWeight: 700, borderRadius: 10, border: 'none', background: G, color: '#fff', cursor: 'pointer' },
  small: { padding: '5px 10px', fontSize: 12, fontWeight: 700, borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' },
}
