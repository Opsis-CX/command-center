import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'

// ============================================================
// QUALITY REPORTING — one report, two worlds.
//   Internal = Opsis agents (qa_audits)
//   External = client CSRs (external_qa_audits)
// The two systems store different shapes, so each is normalised into a
// common row here rather than forcing one schema on both.
// Filters: date range, person, brand/client, auditor, score band, outcome.
// Summary by person on top, every audit listed below, CSV export of either.
// ============================================================

function csvEscape(v) {
  if (v === null || v === undefined) return ''
  const s = String(v).replace(/"/g, '""')
  return /[",\n]/.test(s) ? `"${s}"` : s
}
function downloadCSV(filename, rows) {
  const csv = rows.map(r => r.map(csvEscape).join(',')).join('\r\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// default range = last 30 days
function defaultRange() {
  const to = new Date()
  const from = new Date(); from.setDate(from.getDate() - 29)
  const iso = d => d.toISOString().slice(0, 10)
  return { from: iso(from), to: iso(to) }
}

const SCORE_BANDS = [
  { key: 'all', label: 'Any score' },
  { key: 'lt70', label: 'Under 70%', test: s => s != null && s < 70 },
  { key: 'lt80', label: 'Under 80%', test: s => s != null && s < 80 },
  { key: '80to89', label: '80–89%', test: s => s != null && s >= 80 && s < 90 },
  { key: 'gte90', label: '90% and up', test: s => s != null && s >= 90 },
]

const scoreColor = (s) => s == null ? { bg: 'var(--line-soft)', fg: 'var(--ink-soft)' }
  : s >= 90 ? { bg: 'var(--passed-bg)', fg: 'var(--passed)' }
    : s >= 75 ? { bg: 'var(--needed-bg)', fg: 'var(--needed)' }
      : { bg: 'var(--failed-bg)', fg: 'var(--failed)' }

const selStyle = { padding: '7px 9px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: 'var(--surface)', maxWidth: 200 }
const fmtDate = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'

export default function QualityReporting() {
  const [system, setSystem] = useState('internal')   // 'internal' | 'external'
  const [range, setRange] = useState(defaultRange())
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  // filters
  const [person, setPerson] = useState('all')
  const [brand, setBrand] = useState('all')
  const [auditor, setAuditor] = useState('all')
  const [band, setBand] = useState('all')
  const [outcome, setOutcome] = useState('all')

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      if (system === 'internal') {
        const { data, error } = await supabase.from('qa_audits')
          .select('id, agent_name, auditor_id, audit_type, campaign, brand, call_date, created_at, clean_qa_score, auto_fail, feedback, edit_count, editor_name')
          .gte('call_date', range.from).lte('call_date', range.to)
          .order('call_date', { ascending: false })
        if (error) throw error
        // auditor_id -> name (internal audits store the id, not the name)
        const ids = [...new Set((data || []).map(a => a.auditor_id).filter(Boolean))]
        let names = {}
        if (ids.length) {
          const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', ids)
          ;(profs || []).forEach(p => { names[p.id] = p.full_name })
        }
        setRows((data || []).map(a => ({
          id: a.id,
          person: a.agent_name || '—',
          brand: a.brand || a.campaign || '—',
          auditor: names[a.auditor_id] || '—',
          date: a.call_date,
          score: a.auto_fail ? 0 : (a.clean_qa_score == null ? null : Number(a.clean_qa_score)),
          autoFail: !!a.auto_fail,
          kind: (a.audit_type || '').replace('_', ' '),
          outcome: null,
          notes: a.feedback || '',
          edited: (a.edit_count || 0) > 0,
          editor: a.editor_name || null,
        })))
      } else {
        const { data, error } = await supabase.from('external_qa_audits')
          .select('id, csr_name, auditor_name, brand, call_date, score_pct, outcome, not_booked_reason, direction, notes, edit_count, editor_name')
          .gte('call_date', range.from).lte('call_date', range.to)
          .order('call_date', { ascending: false })
        if (error) throw error
        setRows((data || []).map(a => ({
          id: a.id,
          person: a.csr_name || '—',
          brand: a.brand || '—',
          auditor: a.auditor_name || '—',
          date: a.call_date,
          score: a.score_pct == null ? null : Number(a.score_pct),
          autoFail: false,
          kind: a.direction || '',
          outcome: a.outcome || null,
          notBooked: a.not_booked_reason || null,
          notes: a.notes || '',
          edited: (a.edit_count || 0) > 0,
          editor: a.editor_name || null,
        })))
      }
    } catch (e) { setErr(e.message) } finally { setLoading(false) }
  }, [system, range.from, range.to])
  useEffect(() => { load() }, [load])

  // reset filters that may not exist in the other system
  useEffect(() => { setPerson('all'); setBrand('all'); setAuditor('all'); setOutcome('all') }, [system])

  const people = useMemo(() => [...new Set(rows.map(r => r.person))].sort(), [rows])
  const brands = useMemo(() => [...new Set(rows.map(r => r.brand))].sort(), [rows])
  const auditors = useMemo(() => [...new Set(rows.map(r => r.auditor))].sort(), [rows])
  const outcomes = useMemo(() => [...new Set(rows.map(r => r.outcome).filter(Boolean))].sort(), [rows])

  const filtered = useMemo(() => {
    const bandDef = SCORE_BANDS.find(b => b.key === band)
    return rows.filter(r =>
      (person === 'all' || r.person === person) &&
      (brand === 'all' || r.brand === brand) &&
      (auditor === 'all' || r.auditor === auditor) &&
      (outcome === 'all' || r.outcome === outcome) &&
      (!bandDef?.test || bandDef.test(r.score))
    )
  }, [rows, person, brand, auditor, outcome, band])

  // summary by person
  const summary = useMemo(() => {
    const m = {}
    filtered.forEach(r => {
      const s = (m[r.person] = m[r.person] || { person: r.person, n: 0, scores: [], booked: 0, outcomes: 0, fails: 0 })
      s.n++
      if (r.score != null) s.scores.push(r.score)
      if (r.autoFail) s.fails++
      if (r.outcome) { s.outcomes++; if (r.outcome === 'Booked') s.booked++ }
    })
    return Object.values(m).map(s => ({
      ...s,
      avg: s.scores.length ? Math.round(s.scores.reduce((a, b) => a + b, 0) / s.scores.length) : null,
      min: s.scores.length ? Math.min(...s.scores) : null,
      max: s.scores.length ? Math.max(...s.scores) : null,
      bookRate: s.outcomes ? Math.round((s.booked / s.outcomes) * 100) : null,
    })).sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1))
  }, [filtered])

  const overall = useMemo(() => {
    const scored = filtered.filter(r => r.score != null)
    return {
      audits: filtered.length,
      avg: scored.length ? Math.round(scored.reduce((s, r) => s + r.score, 0) / scored.length) : null,
      people: new Set(filtered.map(r => r.person)).size,
    }
  }, [filtered])

  function exportSummary() {
    const head = ['Person', 'Audits', 'Avg score %', 'Low %', 'High %', ...(system === 'external' ? ['Booked %'] : ['Auto-fails'])]
    const body = summary.map(s => [s.person, s.n, s.avg ?? '', s.min ?? '', s.max ?? '',
      system === 'external' ? (s.bookRate ?? '') : s.fails])
    downloadCSV(`quality-summary-${system}-${range.from}-to-${range.to}.csv`, [head, ...body])
  }
  function exportDetail() {
    const head = ['Date', 'Person', 'Brand', 'Auditor', 'Score %', system === 'external' ? 'Outcome' : 'Type', 'Edited', 'Notes']
    const body = filtered.map(r => [r.date, r.person, r.brand, r.auditor,
      r.autoFail ? 'AUTO-FAIL' : (r.score ?? ''), system === 'external' ? (r.outcome || '') : r.kind,
      r.edited ? 'yes' : '', r.notes])
    downloadCSV(`quality-audits-${system}-${range.from}-to-${range.to}.csv`, [head, ...body])
  }

  const anyFilter = person !== 'all' || brand !== 'all' || auditor !== 'all' || band !== 'all' || outcome !== 'all'

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* system toggle + range */}
      <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className={'btn ' + (system === 'internal' ? 'btn-primary' : 'btn-ghost')} onClick={() => setSystem('internal')}>Internal — our agents</button>
          <button className={'btn ' + (system === 'external' ? 'btn-primary' : 'btn-ghost')} onClick={() => setSystem('external')}>External — client CSRs</button>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto', flexWrap: 'wrap' }}>
          <input type="date" style={selStyle} value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} />
          <span className="page-sub" style={{ fontSize: 12 }}>to</span>
          <input type="date" style={selStyle} value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} />
        </div>
      </div>

      {/* filters */}
      <div className="card" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <select style={selStyle} value={person} onChange={e => setPerson(e.target.value)}>
          <option value="all">{system === 'internal' ? 'All agents' : 'All CSRs'}</option>
          {people.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select style={selStyle} value={brand} onChange={e => setBrand(e.target.value)}>
          <option value="all">All brands</option>
          {brands.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <select style={selStyle} value={auditor} onChange={e => setAuditor(e.target.value)}>
          <option value="all">All auditors</option>
          {auditors.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select style={selStyle} value={band} onChange={e => setBand(e.target.value)}>
          {SCORE_BANDS.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
        </select>
        {system === 'external' && (
          <select style={selStyle} value={outcome} onChange={e => setOutcome(e.target.value)}>
            <option value="all">Any outcome</option>
            {outcomes.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        )}
        {anyFilter && (
          <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }}
            onClick={() => { setPerson('all'); setBrand('all'); setAuditor('all'); setBand('all'); setOutcome('all') }}>
            Clear filters
          </button>
        )}
      </div>

      {err && <div className="card" style={{ borderColor: 'var(--failed)' }}><span style={{ color: 'var(--failed)', fontSize: 13 }}>{err}</span></div>}
      {loading ? <p className="page-sub">Loading audits…</p> : (
        <>
          {/* headline */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            <Stat label="Audits" value={overall.audits} />
            <Stat label="Average score" value={overall.avg == null ? '—' : overall.avg + '%'}
              color={overall.avg == null ? undefined : scoreColor(overall.avg).fg} />
            <Stat label={system === 'internal' ? 'Agents reviewed' : 'CSRs reviewed'} value={overall.people} />
          </div>

          {filtered.length === 0 ? (
            <div className="card"><div className="page-sub" style={{ textAlign: 'center', padding: 24 }}>
              No audits match these filters.
            </div></div>
          ) : (
            <>
              {/* summary by person */}
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
                  <b style={{ fontSize: 14 }}>Summary by {system === 'internal' ? 'agent' : 'CSR'}</b>
                  <button className="btn btn-ghost" style={{ marginLeft: 'auto', fontSize: 12, padding: '4px 10px' }} onClick={exportSummary}>⬇ CSV</button>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5, minWidth: 560 }}>
                    <thead><tr style={{ background: 'var(--canvas)', textAlign: 'left' }}>
                      <Th>{system === 'internal' ? 'Agent' : 'CSR'}</Th><Th right>Audits</Th><Th right>Avg</Th><Th right>Range</Th>
                      <Th right>{system === 'external' ? 'Booked' : 'Auto-fails'}</Th>
                    </tr></thead>
                    <tbody>
                      {summary.map(s => {
                        const c = scoreColor(s.avg)
                        return (
                          <tr key={s.person} style={{ borderTop: '1px solid var(--line-soft)' }}>
                            <Td><b>{s.person}</b></Td>
                            <Td right>{s.n}</Td>
                            <Td right>{s.avg == null ? '—' : <span className="badge" style={{ background: c.bg, color: c.fg, fontWeight: 700 }}>{s.avg}%</span>}</Td>
                            <Td right><span className="page-sub" style={{ fontSize: 12 }}>{s.min == null ? '—' : (s.min === s.max ? `${s.min}%` : `${s.min}–${s.max}%`)}</span></Td>
                            <Td right>{system === 'external'
                              ? (s.bookRate == null ? '—' : `${s.bookRate}%`)
                              : (s.fails ? <span className="badge" style={{ background: 'var(--failed-bg)', color: 'var(--failed)' }}>{s.fails}</span> : '—')}</Td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* every audit */}
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
                  <b style={{ fontSize: 14 }}>All audits ({filtered.length})</b>
                  <button className="btn btn-ghost" style={{ marginLeft: 'auto', fontSize: 12, padding: '4px 10px' }} onClick={exportDetail}>⬇ CSV</button>
                </div>
                <div style={{ overflowX: 'auto', maxHeight: 520, overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5, minWidth: 720 }}>
                    <thead><tr style={{ background: 'var(--canvas)', textAlign: 'left', position: 'sticky', top: 0 }}>
                      <Th>Date</Th><Th>{system === 'internal' ? 'Agent' : 'CSR'}</Th><Th>Brand</Th><Th>Auditor</Th>
                      <Th right>Score</Th><Th>{system === 'external' ? 'Outcome' : 'Type'}</Th>
                    </tr></thead>
                    <tbody>
                      {filtered.map(r => {
                        const c = scoreColor(r.score)
                        return (
                          <tr key={r.id} style={{ borderTop: '1px solid var(--line-soft)' }}>
                            <Td>{fmtDate(r.date)}</Td>
                            <Td><b>{r.person}</b>{r.edited && <span title={`Edited${r.editor ? ' by ' + r.editor : ''}`} className="badge" style={{ background: 'var(--needed-bg)', color: 'var(--needed)', marginLeft: 6, fontSize: 10 }}>edited</span>}</Td>
                            <Td>{r.brand}</Td>
                            <Td><span className="page-sub" style={{ fontSize: 12.5 }}>{r.auditor}</span></Td>
                            <Td right>{r.autoFail
                              ? <span className="badge" style={{ background: 'var(--failed-bg)', color: 'var(--failed)', fontWeight: 700 }}>Auto-fail</span>
                              : r.score == null ? '—'
                                : <span className="badge" style={{ background: c.bg, color: c.fg, fontWeight: 700 }}>{r.score}%</span>}</Td>
                            <Td><span style={{ textTransform: 'capitalize', fontSize: 12.5 }}>{r.outcome || r.kind || '—'}</span></Td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

function Stat({ label, value, color }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '14px 10px' }}>
      <div style={{ fontSize: 26, fontWeight: 800, color: color || 'var(--ink)' }}>{value}</div>
      <div className="page-sub" style={{ fontSize: 11.5 }}>{label}</div>
    </div>
  )
}
function Th({ children, right }) {
  return <th style={{ padding: '10px 14px', fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--ink-soft)', textAlign: right ? 'right' : 'left', whiteSpace: 'nowrap' }}>{children}</th>
}
function Td({ children, right }) {
  return <td style={{ padding: '9px 14px', textAlign: right ? 'right' : 'left', whiteSpace: 'nowrap' }}>{children}</td>
}
