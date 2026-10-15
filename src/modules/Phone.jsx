// ============================================================
//  Phone page (/phone) — anyone who can place calls.
//  Click-to-call directory (names only — phone numbers are never loaded into
//  the browser) + recent call history. Data comes from two secure RPCs:
//    call_directory()   — name, email, role, has_phone (no number)
//    my_call_history()  — your calls (admins: everyone's), names only
// ============================================================
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useVoice, CallButton } from '../lib/voice'

const STATUS_LABEL = { completed: 'Completed', answered: 'Completed', 'no-answer': 'No answer', busy: 'Busy', failed: 'Failed', canceled: 'Canceled', dialing: 'In progress' }
const ROLE_FILTERS = [['all', 'Everyone'], ['agent', 'Agents'], ['staff', 'Staff']]

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
  const [roleFilter, setRoleFilter] = useState('agent')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    const [p, c] = await Promise.all([supabase.rpc('call_directory'), supabase.rpc('my_call_history', { p_limit: 100 })])
    if (p.error || c.error) setError((p.error || c.error).message)
    setPeople(p.data || [])
    setCalls(c.data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])
  useEffect(() => { if (voice?.status === 'ended') { const t = setTimeout(load, 2500); return () => clearTimeout(t) } }, [voice?.status])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return people
      .filter(p => roleFilter === 'all' || (roleFilter === 'agent' ? p.role === 'agent' : p.role !== 'agent'))
      .filter(p => !q || [p.full_name, p.email].some(v => (v || '').toLowerCase().includes(q)))
  }, [people, search, roleFilter])
  const missing = useMemo(() => filtered.filter(p => !p.has_phone).length, [filtered])

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <h1 className="page-title">Phone</h1>
        <p className="page-sub">Click 📞 to call someone from your browser. Use a headset — your browser will ask for microphone access the first time.</p>
      </div>
      {error && <div style={S.error}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 18, alignItems: 'start' }}>
        <section>
          <h2 style={S.h2}>Directory</h2>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
            <input placeholder="Search name or email" value={search} onChange={e => setSearch(e.target.value)} style={{ ...S.input, flex: 1, minWidth: 160 }} />
            {ROLE_FILTERS.map(([k, l]) => (
              <button key={k} onClick={() => setRoleFilter(k)} style={{ ...S.chip, ...(roleFilter === k ? S.chipOn : {}) }}>{l}</button>
            ))}
          </div>
          {missing > 0 && <div style={S.note}>{missing} {missing === 1 ? 'person has' : 'people have'} no phone on file yet — they'll appear once they complete the SMS consent form or an admin adds a number.</div>}
          <div style={S.list}>
            {loading ? <div style={S.muted}>Loading…</div> : filtered.map(p => (
              <div key={p.profile_id} style={{ ...S.row, opacity: p.has_phone ? 1 : 0.55 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{p.full_name || p.email}</div>
                  <div style={S.small}>{p.role}{p.has_phone ? '' : ' · no phone on file'}</div>
                </div>
                <CallButton profileId={p.profile_id} name={p.full_name} label="Call" hasPhone={p.has_phone} />
              </div>
            ))}
            {!loading && !filtered.length && <div style={S.muted}>No one matches.</div>}
          </div>
        </section>

        <section>
          <h2 style={S.h2}>Recent calls</h2>
          <div style={S.list}>
            {calls.map(c => (
              <div key={c.id} style={S.row}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{c.to_name || c.typed_number || 'Unknown'}</div>
                  <div style={S.small}>
                    {fmtDate(c.created_at)} · by {c.caller_name || 'someone'} · {STATUS_LABEL[c.status] || c.status}{c.duration_sec ? ` · ${fmtDur(c.duration_sec)}` : ''}
                  </div>
                </div>
                {c.to_profile_id
                  ? <CallButton profileId={c.to_profile_id} name={c.to_name} label="Call back" />
                  : voice?.canDialNumbers && c.typed_number
                    ? <button disabled={voice.busy} onClick={() => voice.callNumber(c.typed_number)} style={S.btnGhost}>Call back</button>
                    : null}
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
  input: { boxSizing: 'border-box', padding: '7px 10px', borderRadius: 8, border: '1px solid rgba(100,116,139,0.35)', background: 'transparent', color: 'inherit', fontSize: 14 },
  chip: { padding: '6px 12px', borderRadius: 999, border: '1px solid rgba(100,116,139,0.35)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  chipOn: { background: '#0891b2', borderColor: '#0891b2', color: '#fff' },
  list: { border: '1px solid rgba(100,116,139,0.25)', borderRadius: 12, overflow: 'hidden' },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: '1px solid rgba(100,116,139,0.15)' },
  small: { fontSize: 12, opacity: 0.65 },
  muted: { fontSize: 13, opacity: 0.7, padding: 12 },
  note: { fontSize: 12.5, opacity: 0.75, marginBottom: 8 },
  error: { marginBottom: 12, padding: '10px 12px', background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.35)', color: '#b91c1c', borderRadius: 10, fontSize: 13 },
  btnGhost: { padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(100,116,139,0.35)', background: 'transparent', color: 'inherit', fontWeight: 600, fontSize: 13, cursor: 'pointer', flexShrink: 0 },
}
