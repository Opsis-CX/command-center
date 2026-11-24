// Overview — the one-platform home page from Becky's merged mockup (11/24, staging).
// Real numbers for the workspace picked at the top of the menu, from RPC cc_overview (scored calls in
// ai_qa_fact + Command Center's phone status log). Opsis CX workspace = our own scored calls.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../lib/workspace'

const OPSIS_CX = '9726e6eb-1364-4dba-8ddb-10c07a408ecb'
const RANGES = [[1, 'Today'], [7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days']]
const ACCENT = '#0089A6'

const pct = (a, b) => (b ? (a / b) * 100 : null)
const mmss = (s) => (s == null ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`)
const hourLabel = (h) => `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`

function Info({ text }) {
  return <span className="ov-i" title={text} aria-label={text} role="img">i</span>
}

function Delta({ cur, prev, unit = '', better = 'up', digits = 1, fmt }) {
  if (cur == null || prev == null) return <span className="ov-pill ov-flat">no earlier data</span>
  const d = cur - prev
  if (Math.abs(d) < 0.05) return <span className="ov-pill ov-flat">no change</span>
  const good = better === 'up' ? d > 0 : d < 0
  const txt = fmt ? fmt(Math.abs(d)) : `${Math.abs(d).toFixed(digits)}${unit}`
  return <span className={'ov-pill ' + (good ? 'ov-up' : 'ov-down')}>{d > 0 ? '▲' : '▼'} {txt} vs previous</span>
}

export default function Overview() {
  const navigate = useNavigate()
  const { id, current, list } = useWorkspace()
  const client = id || OPSIS_CX
  const name = current ? current.name : 'Opsis CX'
  const [days, setDays] = useState(7)
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let on = true
    setD(null); setErr('')
    supabase.rpc('cc_overview', { p_client: client, p_days: days }).then(({ data, error }) => {
      if (!on) return
      if (error) setErr(error.message || 'Could not load the overview.')
      else setD(data)
    })
    return () => { on = false }
  }, [client, days])

  const c = d?.cur || {}, p = d?.prev || null
  const has = (c.n || 0) > 0
  const conv = pct(c.bk, c.dec), pconv = p ? pct(p.bk, p.dec) : null
  const ask = pct(c.asked, c.opp), pask = p ? pct(p.asked, p.opp) : null
  const ai = pct(c.ai, c.n), pai = p ? pct(p.ai, p.n) : null
  const kpis = [
    { label: 'Calls handled', val: has ? Number(c.n).toLocaleString() : '—', delta: <Delta cur={c.n} prev={p?.n} fmt={(x) => `${Math.round(x)} calls`} />, def: 'Conversations answered by an agent or the AI CSR in the date range (wrong numbers, spam and hang-ups left out).' },
    { label: 'Booking rate', val: conv == null ? '—' : conv.toFixed(1) + '%', delta: <Delta cur={conv} prev={pconv} unit=" pts" />, def: 'Calls that ended booked ÷ calls with a booking opportunity that were decided (booked or not booked).' },
    { label: 'AI QA score', val: c.qa == null ? '—' : Number(c.qa).toFixed(1), delta: <Delta cur={c.qa} prev={p?.qa} />, def: 'Average score out of 100 from AI review of every agent call against your QA checklist.' },
    { label: 'Avg handle time', val: mmss(c.aht), delta: <Delta cur={c.aht} prev={p?.aht} better="down" fmt={(x) => `${Math.round(x)} sec`} />, def: 'Average length of a handled call, from answer to hang-up.' },
    { label: 'Asked for the booking', val: ask == null ? '—' : ask.toFixed(1) + '%', delta: <Delta cur={ask} prev={pask} unit=" pts" />, def: 'Booking-opportunity calls where the agent asked to book the appointment.' },
    { label: 'Handled by AI CSR', val: ai == null ? '—' : ai.toFixed(1) + '%', delta: <Delta cur={ai} prev={pai} unit=" pts" />, def: 'Share of handled calls the AI CSR answered on its own.' },
  ]

  const hours = (d?.hours || [])
  const maxH = Math.max(1, ...hours.map(h => Math.max(h.today || 0, Number(h.usual) || 0)))
  const fl = d?.floor || {}
  const reasons = d?.reasons || []
  const rMax = Math.max(1, ...reasons.map(r => r.n))
  const rangeName = RANGES.find(r => r[0] === days)?.[1] || ''
  const goClient = (v) => navigate('/w/' + v)

  return (
    <div className="ov">
      <header className="ov-head">
        <div>
          <h1>Overview</h1>
          <p>How {name}'s customer contact is doing across phone, AI and quality</p>
        </div>
        <div className="ov-tools">
          <select className="ov-btn" value={days} onChange={e => setDays(+e.target.value)} aria-label="Date range">
            {RANGES.map(r => <option key={r[0]} value={r[0]}>{r[1]}</option>)}
          </select>
          {id && <button className="ov-btn ov-btnp" onClick={() => goClient('insights')}>Ask Opsis AI</button>}
        </div>
      </header>

      {!id && list && list.length > 0 && (
        <div className="ov-banner">Showing <b>Opsis CX</b>. Pick a client in the <b>Workspace</b> switcher at the top of the menu to see their numbers and open their portal pages here.</div>
      )}
      {err && <div className="ov-banner ov-err">{err}</div>}

      <section aria-label="Key numbers" className="ov-kpis">
        {kpis.map(k => (
          <div key={k.label} className="ov-card ov-kpi">
            <div className="ov-cap">{k.label}<Info text={k.def} /></div>
            <div className="ov-val">{d ? k.val : <span className="ov-skel" />}</div>
            <div>{d ? k.delta : null}</div>
          </div>
        ))}
      </section>

      <section className="ov-row">
        <div className="ov-card ov-wide">
          <div className="ov-cardhead">
            <div>
              <h2>Calls per hour today vs. a usual {new Date().toLocaleDateString(undefined, { weekday: 'long' })}<Info text="Bars: handled calls each hour today. Dashed marks: the average for this weekday and hour over the last 4 weeks." /></h2>
              <p>From scored calls · hours in the caller's local time</p>
            </div>
            <div className="ov-legend">
              <span><i style={{ background: ACCENT }} />Today</span>
              <span><i className="ov-dash" />Usual</span>
            </div>
          </div>
          {hours.length === 0
            ? <p className="ov-empty">{d ? 'No calls in the last 4 weeks yet.' : 'Loading…'}</p>
            : (<>
              <div className="ov-chart" style={{ gridTemplateColumns: `repeat(${hours.length}, minmax(0, 1fr))` }}>
                {hours.map(h => (
                  <div key={h.h} className="ov-bar" title={`${hourLabel(h.h)}: ${h.today} today · usually ${h.usual}`}>
                    <div style={{ height: `${(h.today / maxH) * 100}%`, background: h.today ? ACCENT : 'transparent' }} />
                    <span style={{ bottom: `${(Number(h.usual) / maxH) * 100}%` }} />
                  </div>
                ))}
              </div>
              <div className="ov-xlab" style={{ gridTemplateColumns: `repeat(${hours.length}, minmax(0, 1fr))` }}>
                {hours.map(h => <span key={h.h}>{hourLabel(h.h)}</span>)}
              </div>
            </>)}
        </div>

        <div className="ov-card">
          <h2>Floor right now<Info text="Latest phone status of everyone logged into the Command Center phone in the last 12 hours." /></h2>
          <div className="ov-floor">
            {[['Ready', fl.ready, '#1F9D63'], ['On a call', fl.on_call, ACCENT], ['Wrap-up', fl.wrap, '#C98A00'], ['Away / break', fl.away, '#7A5AF8']].map(([l, n, dot]) => (
              <div key={l}><span><i style={{ background: dot }} />{l}</span><b>{d ? (n ?? 0) : '—'}</b></div>
            ))}
          </div>
          {d && !(fl.ready || fl.on_call || fl.wrap || fl.away) && <p className="ov-empty" style={{ margin: 0 }}>Nobody is logged into the phone right now.</p>}
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <button className="ov-link" onClick={() => navigate('/live')}>Who's On →</button>
            {id && <button className="ov-link" onClick={() => goClient('wallboard')}>Open wallboard →</button>}
          </div>
        </div>
      </section>

      <section className="ov-row">
        <div className="ov-card ov-wide">
          <div className="ov-cardhead">
            <h2>Agents to coach<Info text="Agents whose AI QA score dropped most in this range against their own 30-day average (at least 3 scored calls)." /></h2>
            {id && <button className="ov-link" onClick={() => goClient('hub')}>Open Coaching Hub →</button>}
          </div>
          {(d?.coach || []).length === 0
            ? <p className="ov-empty">{d ? 'Not enough scored calls in this range yet.' : 'Loading…'}</p>
            : (
              <div style={{ overflowX: 'auto' }}>
                <table className="ov-tbl">
                  <thead><tr><th>Agent</th><th>Calls</th><th>QA score</th><th>30-day avg</th><th>Booking rate</th><th>Most common miss</th>{id && <th><span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Action</span></th>}</tr></thead>
                  <tbody>
                    {d.coach.map(a => {
                      const tone = a.qa == null ? 'ov-flat' : a.qa < 75 ? 'ov-down' : a.qa < 85 ? 'ov-flat' : 'ov-up'
                      const ini = String(a.agent || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()
                      return (
                        <tr key={a.agent}>
                          <td><span className="ov-agent"><span className="ov-av">{ini}</span><b>{a.agent}</b></span></td>
                          <td>{a.calls}</td>
                          <td><span className={'ov-pill ' + tone}>{a.qa ?? '—'}</span></td>
                          <td>{a.qa30 ?? '—'}</td>
                          <td>{a.conv == null ? '—' : a.conv + '%'}</td>
                          <td className="ov-wrap">{a.miss ? `${a.miss} (${a.miss_n})` : '—'}</td>
                          {id && <td><button className="ov-btn ov-sm" onClick={() => goClient('hub')}>Coach</button></td>}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
        </div>

        <div className="ov-card">
          <h2>Top reasons customers called<Info text="AI-tagged reason for each handled call in the range, as a share of all handled calls." /></h2>
          {reasons.length === 0 && <p className="ov-empty">{d ? 'No calls in this range.' : 'Loading…'}</p>}
          {reasons.map(r => {
            const share = d.reasons_total ? (r.n / d.reasons_total) * 100 : 0
            return (
              <div key={r.label} className="ov-reason">
                <div><span>{r.label}</span><b>{share.toFixed(0)}%</b></div>
                <div className="ov-track"><div style={{ width: `${(r.n / rMax) * 100}%` }} /></div>
              </div>
            )
          })}
          {d && c.n > 0 && <div className="ov-note"><b>{rangeName}</b>: {Number(c.n).toLocaleString()} handled calls{c.ai ? `, ${c.ai} by the AI CSR` : ''}.</div>}
        </div>
      </section>
    </div>
  )
}
