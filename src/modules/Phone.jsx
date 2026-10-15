// ============================================================
//  Phone page (/phone) — admins only.
//  Directory of active team members with a phone on file (click to call
//  from the browser) + recent call history from public.voice_calls.
// ============================================================
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useVoice, formatPhone } from '../lib/voice'

const EXTERNAL_ROLES = ['client', 'csr']
const STATUS_LABEL = { completed: 'Completed', answered: 'Completed', 'no-answer': 'No answer', busy: 'Busy', failed: 'Failed', canceled: 'Canceled', dialing: 'In progress' }

function fmtDate(ts) {
  return ts ? new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
}
function fmtDur(s) {
  if (!s) return ''
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`
}

export default function Phone() {
  const voice = useVoice()
  const [people, setPeople] = useState([])
  const [calls, setCalls] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  async function load() {
    const [p, c] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email, role, phone').eq('is_active', true).not('phone', 'is', null).order('full_name'),
      supabase.from('voice_calls').select('*').order('created_at', { ascending: false }).limit(100),
    ])
    setPeople((p.data || []).filter(r => !EXTERNAL_ROLES.includes(r.role)))
    setCalls(c.data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])
  // refresh history when a call finishes
  useEffect(() => { if (voice?.status === 'ended') setTimeout(load, 2500) }, [voice?.status])

  const nameById = useMemo(() => Object.fromEntries(people.map(p => [p.id, p.full_name])), [people])
  const [allNames, setAllNames] = useState({})
  useEffect(() => {
    const ids = [...new Set(calls.flatMap(c => [c.caller_id, c.to_profile_id]).filter(Boolean))].filter(id => !nameById[id])
    if (!ids.length) return
    supabase.from('profiles').select('id, full_name').in('id', ids)
      .then(({ data }) => setAllNames(Object.fromEntries((data || []).map(r => [r.id, r.full_name]))))
  }, [calls, nameById])
  const nm = id => nameById[id] || allNames[id] || ''

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return people.filter(p => !q || [p.full_name, p.email, p.phone].some(v => (v || '').toLowerCase().includes(q)))
  }, [people, search])

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <h1 className="page-title">Phone</h1>
          <p className="page-sub">Call agents from your browser. Use a headset; your browser will ask for microphone access the first time.</p>
        </div>
        {voice && <button onClick={() => voice.setOpen(true)} style={S.btnPrimary}>☎ Open dial pad</button>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 18, alignItems: 'start' }}>
        <section>
          <h2 style={S.h2}>Team directory</h2>
          <input placeholder="Search name, email or phone" value={search} onChange={e => setSearch(e.target.value)} style={S.input} />
          <div style={S.list}>
            {loading ? <div style={S.muted}>Loading…</div> : filtered.map(p => (
              <div key={p.id} style={S.row}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{p.full_name || p.email}</div>
                  <div style={S.small}>{formatPhone(p.phone)} · {p.role}</div>
                </div>
                <button disabled={!voice || voice.busy} onClick={() => voice.call(p.phone, p.full_name)} style={S.btnCall}>Call</button>
              </div>
            ))}
            {!loading && !filtered.length && (
              <div style={S.muted}>No one with a phone number on file{search ? ' matches that search' : ''}. Numbers come from profiles and the SMS consent form.</div>
            )}
          </div>
        </section>

        <section>
          <h2 style={S.h2}>Recent calls</h2>
          <div style={S.list}>
            {calls.map(c => (
              <div key={c.id} style={S.row}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{nm(c.to_profile_id) || formatPhone(c.to_number)}</div>
                  <div style={S.small}>
                    {fmtDate(c.created_at)} · by {nm(c.caller_id) || 'someone'} · {STATUS_LABEL[c.status] || c.status}{c.duration_sec ? ` · ${fmtDur(c.duration_sec)}` : ''}
                  </div>
                </div>
                <button disabled={!voice || voice.busy} onClick={() => voice.call(c.to_number, nm(c.to_profile_id))} style={S.btnGhost}>Call back</button>
              </div>
            ))}
            {!calls.length && !loading && <div style={S.muted}>No calls yet.</div>}
          </div>
        </section>
      </div>
    </div>
  )
}

const S = {
  h2: { fontSize: 16, margin: '0 0 8px' },
  input: { width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(100,116,139,0.35)', background: 'transparent', color: 'inherit', fontSize: 14, marginBottom: 8 },
  list: { border: '1px solid rgba(100,116,139,0.25)', borderRadius: 12, overflow: 'hidden' },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: '1px solid rgba(100,116,139,0.15)' },
  small: { fontSize: 12, opacity: 0.65 },
  muted: { fontSize: 13, opacity: 0.7, padding: 12 },
  btnCall: { padding: '6px 14px', borderRadius: 8, border: 'none', background: '#16a34a', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', flexShrink: 0 },
  btnGhost: { padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(100,116,139,0.35)', background: 'transparent', color: 'inherit', fontWeight: 600, fontSize: 13, cursor: 'pointer', flexShrink: 0 },
  btnPrimary: { padding: '8px 14px', borderRadius: 8, border: 'none', background: '#0891b2', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' },
}
