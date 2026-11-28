// Best times on the call screen (Becky 11/27): once the CSR has the zip, show the top 3 open times
// from Field Service (ranked by extra driving, same as the portal's Book tab) and book in one click.
// Shows nothing for brands without Field Service set up.
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const TZ = 'America/Chicago'
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })
const fmtDay = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

export default function BestTimes({ brand, zip, setZip, name = '', phone = '' }) {
  const [setup, setSetup] = useState(undefined)
  const [job, setJob] = useState('')
  const [slots, setSlots] = useState(null)
  const [who, setWho] = useState(name)
  const [tel, setTel] = useState(phone)
  const [addr, setAddr] = useState('')
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(null)

  useEffect(() => {
    if (!brand) { setSetup(null); return }
    supabase.rpc('fsm_call_setup', { p_brand: brand }).then(({ data }) => {
      setSetup(data || null)
      const j = (data?.job_types || []).find((x) => x.kind === 'tech') || (data?.job_types || [])[0]
      if (j) setJob(j.code)
    })
  }, [brand])
  useEffect(() => { if (name && !who) setWho(name) }, [name])
  useEffect(() => { if (phone && !tel) setTel(phone) }, [phone])

  const load = () => {
    if (!setup || !job || !/^\d{5}$/.test(zip || '')) { setSlots(null); return }
    setErr('')
    supabase.rpc('fsm_call_slots', { p_brand: brand, p_job: job, p_zip: zip }).then(({ data, error }) => error ? setErr(error.message) : setSlots(data || []))
  }
  useEffect(load, [setup, job, zip])

  const book = async (s) => {
    if (!who.trim()) { setErr('Add the customer\'s name first.'); return }
    setBusy(true); setErr('')
    const brief = problem ? { problem } : null
    const { error } = await supabase.rpc('fsm_call_book', { p_brand: brand, p_job: job, p_resource: s.resource_id, p_starts: s.starts_at, p_window: s.window,
      p_customer: who, p_phone: tel, p_address: addr, p_zip: zip, p_brief: brief })
    setBusy(false)
    if (error) { setErr(error.message); load(); return }
    setDone(s)
  }

  if (!setup) return null
  const box = { marginTop: 12, border: '1px solid rgba(47,125,91,.35)', background: 'rgba(47,125,91,.05)', borderRadius: 10, padding: 12 }
  const inp = { border: '1px solid #d6d3cc', borderRadius: 8, padding: '7px 9px', fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box', width: '100%' }

  if (done) return (
    <div style={{ ...box, background: 'rgba(47,125,91,.12)' }}>
      <b>Booked ✓</b> {who} with {done.resource} — {fmtDay(done.day)} at {fmtTime(done.starts_at)} ({done.window}).
      <div style={{ fontSize: 13, opacity: .75, marginTop: 4 }}>It's on the dispatch board and {done.resource}'s phone page.</div>
    </div>
  )
  return (
    <div style={box}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <b style={{ color: '#2F7D5B' }}>Best times</b>
        <select value={job} onChange={(e) => setJob(e.target.value)} style={{ ...inp, width: 'auto' }}>
          {(setup.job_types || []).map((j) => <option key={j.code} value={j.code}>{j.label}</option>)}
        </select>
        <input value={zip} onChange={(e) => setZip(e.target.value.replace(/\D/g, '').slice(0, 5))} placeholder="Zip" inputMode="numeric" style={{ ...inp, width: 90, textAlign: 'center' }} />
      </div>
      {!/^\d{5}$/.test(zip || '') && <div style={{ fontSize: 13, opacity: .75 }}>Enter the zip and the best times show here.</div>}
      {slots && !slots.length && <div style={{ fontSize: 13 }}>No open times in the next 5 days for this zip.</div>}
      {slots && slots.length > 0 && (<>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
          <input value={who} onChange={(e) => setWho(e.target.value)} placeholder="Customer name" style={inp} />
          <input value={tel} onChange={(e) => setTel(e.target.value)} placeholder="Phone" style={inp} />
          <input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Street address" style={inp} />
          <input value={problem} onChange={(e) => setProblem(e.target.value)} placeholder="What's wrong (for the tech)" style={inp} />
        </div>
        {slots.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', marginTop: 6, background: '#fff', borderRadius: 8, border: i === 0 ? '2px solid #2F7D5B' : '1px solid #e5e2da' }}>
            <div style={{ width: 120 }}><b>{fmtDay(s.day)}</b><div style={{ fontSize: 13 }}>{fmtTime(s.starts_at)} · {s.window}</div></div>
            <div style={{ flex: 1, fontSize: 13.5 }}><b>{s.resource}</b>{i === 0 && <span style={{ marginLeft: 6, fontSize: 11, background: '#2F7D5B', color: '#fff', borderRadius: 10, padding: '1px 7px' }}>Offer this</span>}<div style={{ opacity: .75 }}>{s.reason}</div></div>
            <button disabled={busy} onClick={() => book(s)} style={{ background: '#2F7D5B', color: '#fff', border: 0, borderRadius: 8, padding: '7px 12px', fontWeight: 700, cursor: 'pointer' }}>Book</button>
          </div>
        ))}
      </>)}
      {err && <div style={{ color: '#b91c1c', fontSize: 13, marginTop: 6 }}>{err}</div>}
    </div>
  )
}
