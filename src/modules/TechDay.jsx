// Tech / sales-rep phone page (FSM v1, Becky 11/27). Public secret link /tech/:token — no login.
// Today's visits with the AI visit brief; mark On my way / outcome. A new-door flag books the best-fit sales rep.
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const TZ = 'America/Chicago'
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })
const fmtDay = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10) }
const OUT = { repair_done: 'Repaired', new_door_opp: 'New-door opp', needs_part: 'Needs part', declined: 'Declined', sold: 'Sold', not_sold: 'Not sold' }
const btn = { border: 0, borderRadius: 10, padding: '12px 10px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }

export default function TechDay() {
  const { token } = useParams()
  const [day, setDay] = useState(null)
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(null)
  const [note, setNote] = useState('')
  const [toast, setToast] = useState('')
  const [busy, setBusy] = useState(false)
  const load = () => supabase.rpc('fsm_tech_day', { p_token: token, p_day: day }).then(({ data, error }) => error ? setErr(error.message) : setD(data))
  useEffect(() => { document.documentElement.style.colorScheme = 'light'; load() }, [day])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 12000); return () => clearTimeout(t) }, [toast])

  const mark = async (a, outcome) => {
    if (busy) return
    setBusy(true)
    const { data, error } = await supabase.rpc('fsm_tech_outcome', { p_token: token, p_appt: a.id, p_outcome: outcome, p_note: note || null })
    setBusy(false)
    if (error) { setToast(error.message); return }
    setNote('')
    if (data?.sales) setToast(`Sent to sales ✓ ${data.sales.resource} will see ${a.customer} on ${new Date(data.sales.day + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at ${fmtTime(data.sales.starts_at)}.`)
    else if (outcome === 'on_my_way') setToast(`🚐 On the way to ${a.customer}.` + (data?.text ? (data.text.mode === 'live' ? ` Texted ${data.text.to}: “${data.text.body}”` : ` Text preview (not sent yet — texting turns on once the number is registered): “${data.text.body}”`) : ''))
    else setToast('Saved ✓')
    load()
  }

  if (err) return <Shell><div style={{ padding: 30, textAlign: 'center' }}>{err}</div></Shell>
  if (!d) return <Shell><div style={{ padding: 30, textAlign: 'center', color: '#5F6763' }}>Loading…</div></Shell>
  const isTech = d.kind === 'tech'
  return (
    <Shell>
      <div style={{ background: '#14302A', color: '#fff', padding: '18px 16px 14px' }}>
        <div style={{ fontSize: 12, opacity: .75 }}>{d.brand}</div>
        <div style={{ fontSize: 20, fontWeight: 700 }}>Hi {d.name.split(' ')[0]} — {d.visits.length} visit{d.visits.length === 1 ? '' : 's'}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <button onClick={() => setDay(addDays(d.day, -1))} style={{ ...btn, padding: '4px 12px', background: 'rgba(255,255,255,.15)', color: '#fff' }}>‹</button>
          <div style={{ flex: 1, textAlign: 'center', fontWeight: 600 }}>{fmtDay(d.day)}</div>
          <button onClick={() => setDay(addDays(d.day, 1))} style={{ ...btn, padding: '4px 12px', background: 'rgba(255,255,255,.15)', color: '#fff' }}>›</button>
        </div>
      </div>
      {toast && <div onClick={() => setToast('')} style={{ position: 'sticky', top: 8, zIndex: 5, boxShadow: '0 4px 12px rgba(0,0,0,.12)', margin: 12, background: '#E6F0EA', border: '1px solid #2F7D5B', borderRadius: 10, padding: 12, fontSize: 14 }}>{toast}</div>}
      <div style={{ padding: 12, display: 'grid', gap: 10 }}>
        {!d.visits.length && <div style={{ textAlign: 'center', color: '#5F6763', padding: 20 }}>No visits this day.</div>}
        {d.visits.map((a) => {
          const b = a.brief || {}; const isOpen = open === a.id
          return (
            <div key={a.id} style={{ background: '#fff', border: '1px solid #E8E4DC', borderRadius: 14, overflow: 'hidden', opacity: a.status === 'done' && !isOpen ? .7 : 1 }}>
              <div onClick={() => setOpen(isOpen ? null : a.id)} style={{ padding: 14, cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <b style={{ fontSize: 16 }}>{fmtTime(a.starts_at)} · {a.customer}</b>
                  <span style={{ fontSize: 12, fontWeight: 700, color: a.outcome ? '#2F7D5B' : a.status === 'en_route' ? '#B45309' : '#5F6763' }}>
                    {a.outcome ? OUT[a.outcome] : a.status === 'en_route' ? 'On the way' : a.window}</span>
                </div>
                <div style={{ color: '#5F6763', fontSize: 14 }}>{a.job} · {a.city || a.zip}</div>
                {b.problem && <div style={{ fontSize: 14, marginTop: 6 }}>{a.source === 'tech_handoff' ? '🔁 ' : ''}{b.problem}</div>}
              </div>
              {isOpen && (
                <div style={{ borderTop: '1px solid #F1EEE8', padding: 14, display: 'grid', gap: 10 }}>
                  <a href={`https://maps.google.com/?q=${encodeURIComponent((a.address || '') + ' ' + (a.zip || ''))}`} target="_blank" rel="noreferrer" style={{ color: '#2F7D5B', fontWeight: 600 }}>{a.address} {a.zip} ↗</a>
                  {a.phone && <a href={`tel:${a.phone}`} style={{ color: '#2F7D5B', fontWeight: 600 }}>Call {a.phone}</a>}
                  {[['Tech note', b.tech_note], ['Door', b.door], ['Opener', b.opener], ['Customer mood', b.mood], ['Access', b.access], ['Upsell', b.upsell], ['From the call', b.call_summary]].filter(([, v]) => v).map(([k, v]) => (
                    <div key={k}><div style={{ fontSize: 11, fontWeight: 700, color: '#5F6763', textTransform: 'uppercase' }}>{k}</div><div style={{ fontSize: 14 }}>{v}</div></div>
                  ))}
                  {a.status !== 'done' && (<>
                    <textarea rows={2} placeholder="Note (what you found, what they want)…" value={note} onChange={(e) => setNote(e.target.value)}
                      style={{ border: '1px solid #E8E4DC', borderRadius: 10, padding: 10, fontSize: 15, fontFamily: 'inherit' }} />
                    {a.status === 'en_route' && <div style={{ background: '#FEF3C7', borderRadius: 10, padding: 10, fontWeight: 700, color: '#92400E', textAlign: 'center' }}>🚐 You're on the way — mark the outcome when you're done</div>}
                    {a.status !== 'en_route' && <button style={{ ...btn, background: '#F5F3EE', color: '#1C2421' }} onClick={() => mark(a, 'on_my_way')}>🚐 On my way</button>}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      {isTech ? (<>
                        <button style={{ ...btn, background: '#2F7D5B', color: '#fff' }} onClick={() => mark(a, 'repair_done')}>✓ Repaired</button>
                        <button style={{ ...btn, background: '#B45309', color: '#fff' }} onClick={() => mark(a, 'new_door_opp')}>🚪 New-door opp</button>
                        <button style={{ ...btn, background: '#F5F3EE', color: '#1C2421' }} onClick={() => mark(a, 'needs_part')}>Needs part</button>
                        <button style={{ ...btn, background: '#F5F3EE', color: '#A8441A' }} onClick={() => mark(a, 'declined')}>Declined</button>
                      </>) : (<>
                        <button style={{ ...btn, background: '#2F7D5B', color: '#fff' }} onClick={() => mark(a, 'sold')}>✓ Sold</button>
                        <button style={{ ...btn, background: '#F5F3EE', color: '#A8441A' }} onClick={() => mark(a, 'not_sold')}>Not sold</button>
                      </>)}
                    </div>
                  </>)}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Shell>
  )
}
const Shell = ({ children }) => <div style={{ minHeight: '100vh', background: '#F5F3EE', fontFamily: 'Montserrat, Arial, sans-serif', color: '#1C2421', maxWidth: 520, margin: '0 auto' }}>{children}</div>
