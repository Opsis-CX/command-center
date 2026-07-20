import React, { useState, useMemo, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { can, canAny } from '../lib/permissions'

// ============================================================
// RAW DATA EXPORT — pull the underlying rows of any area you have access to.
// Access mirrors the app's permission matrix: a dataset only appears if the
// signed-in person is allowed into that area (same rule that shows/hides the
// pages). The database's row-level rules apply on top as a second safety net.
// Every column, every row (paginated, uncapped up to MAX_ROWS), optional date
// range, CSV out.
// ============================================================

const PAGE = 1000
const MAX_ROWS = 100000  // safety ceiling; flagged if hit

// gate.mode: 'any' = canAny(prefix) · 'exact' = can(key) · 'admin' = admins only
const CATALOG = [
  { id: 'qa_internal',   label: 'Quality — internal audits',        table: 'qa_audits',          dateCols: ['call_date', 'created_at', 'edited_at'],                     gate: { key: 'quality_audit', mode: 'any' } },
  { id: 'qa_external',   label: 'Quality — external CSR audits',    table: 'external_qa_audits', dateCols: ['call_date', 'created_at', 'edited_at'],                     gate: { key: 'quality_audit', mode: 'any' } },
  { id: 'sched_blocks',  label: 'Schedule — shift blocks',          table: 'shift_blocks',       dateCols: ['block_date', 'created_at'],                                 gate: { key: 'schedule', mode: 'any' } },
  { id: 'sched_claims',  label: 'Schedule — shift claims',          table: 'shift_claims',       dateCols: ['claimed_at', 'checked_in_at', 'checked_out_at'],            gate: { key: 'schedule', mode: 'any' } },
  { id: 'people',        label: 'People — profiles',                table: 'profiles',           dateCols: ['created_at', 'deactivated_at'],                            gate: { key: 'people_and_tags', mode: 'any' } },
  { id: 'tags',          label: 'People — tags',                    table: 'tags',               dateCols: ['created_at'],                                              gate: { key: 'people_and_tags', mode: 'any' } },
  { id: 'taggables',     label: 'People — tag assignments',         table: 'taggables',          dateCols: ['created_at'],                                              gate: { key: 'people_and_tags', mode: 'any' } },
  { id: 'clients',       label: 'Clients',                          table: 'clients',            dateCols: ['created_at'],                                              gate: { key: 'clients', mode: 'any' } },
  { id: 'deals',         label: 'Sales — deals',                    table: 'deals',              dateCols: ['created_at', 'expected_close', 'next_activity', 'updated_at'], gate: { key: 'sales', mode: 'any' } },
  { id: 'deal_events',   label: 'Sales — deal stage events',        table: 'deal_stage_events',  dateCols: ['created_at'],                                              gate: { key: 'sales', mode: 'any' } },
  { id: 'hiring_apps',   label: 'Hiring — applications',            table: 'hiring_applications',dateCols: ['created_at', 'reviewed_at', 'updated_at'],                 gate: { key: 'hiring', mode: 'any' } },
  { id: 'hiring_assess', label: 'Hiring — assessments',             table: 'hiring_assessments', dateCols: ['created_at'],                                              gate: { key: 'hiring', mode: 'any' } },
  { id: 'hiring_events', label: 'Hiring — stage events',            table: 'hiring_stage_events',dateCols: ['created_at'],                                              gate: { key: 'hiring', mode: 'any' } },
  { id: 'projects',      label: 'Projects',                         table: 'projects',           dateCols: ['created_at'],                                              gate: { key: 'project_management', mode: 'any' } },
  { id: 'tasks',         label: 'Tasks',                            table: 'tasks',              dateCols: ['created_at', 'due_date'],                                  gate: { key: 'project_management', mode: 'any' } },
  { id: 'courses',       label: 'Certifications — courses',         table: 'courses',            dateCols: ['created_at', 'updated_at'],                                gate: { key: 'certifications.all', mode: 'any' } },
  { id: 'cert_records',  label: 'Certifications — agent records',   table: 'agent_cert_records', dateCols: ['passed_at', 'created_at', 'expires_at'],                   gate: { key: 'certifications.all', mode: 'any' } },
  { id: 'scorecard',     label: 'Scorecard — agent metrics',        table: 'sc_agents',          dateCols: ['start_date', 'updated_at'],                                gate: { key: 'service_performance_scorecard.view_all_scorecards', mode: 'exact' } },
  { id: 'help_tickets',  label: 'Support — help tickets',           table: 'help_tickets',       dateCols: ['created_at', 'resolved_at', 'closed_at'],                  gate: { key: '', mode: 'admin' } },
]

function csvEscape(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') v = JSON.stringify(v)
  const s = String(v).replace(/"/g, '""')
  return /[",\n\r]/.test(s) ? `"${s}"` : s
}
function downloadCSV(filename, rows) {
  const csv = rows.map(r => r.map(csvEscape).join(',')).join('\r\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

const selStyle = { padding: '7px 9px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: 'var(--surface)' }

export default function RawDataExport({ range }) {
  const { appRole, isAdmin } = useAuth()

  const allowed = useMemo(() => CATALOG.filter(d => {
    if (isAdmin) return true
    if (d.gate.mode === 'admin') return false
    if (d.gate.mode === 'exact') return can(appRole, d.gate.key)
    return canAny(appRole, d.gate.key)   // 'any'
  }), [appRole, isAdmin])

  const [datasetId, setDatasetId] = useState('')
  const dataset = useMemo(() => allowed.find(d => d.id === datasetId) || null, [allowed, datasetId])

  const [useDate, setUseDate] = useState(false)
  const [dateCol, setDateCol] = useState('')
  const [from, setFrom] = useState(range?.from || '')
  const [to, setTo] = useState(range?.to || '')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [err, setErr] = useState('')

  // when the dataset changes, default the date column to its first one
  useEffect(() => {
    if (dataset) setDateCol(dataset.dateCols[0] || '')
    setErr(''); setStatus('')
  }, [datasetId]) // eslint-disable-line

  async function fetchAll() {
    const rows = []
    let offset = 0
    let ordered = true
    while (offset < MAX_ROWS) {
      let q = supabase.from(dataset.table).select('*')
      if (ordered) q = q.order('id', { ascending: true })
      if (useDate && dateCol && from) q = q.gte(dateCol, from)
      if (useDate && dateCol && to) q = q.lte(dateCol, to + 'T23:59:59.999')
      q = q.range(offset, offset + PAGE - 1)
      const { data, error } = await q
      if (error) {
        // some tables have no "id" column — retry this page unordered, then keep going unordered
        if (ordered) { ordered = false; continue }
        throw error
      }
      rows.push(...data)
      setStatus(`Fetched ${rows.length.toLocaleString()} rows…`)
      if (data.length < PAGE) break
      offset += PAGE
    }
    return rows
  }

  async function onExport() {
    if (!dataset) return
    setBusy(true); setErr(''); setStatus('Fetching…')
    try {
      const rows = await fetchAll()
      if (!rows.length) { setStatus('No rows for these settings.'); setBusy(false); return }
      // union of all keys, in first-seen order
      const cols = []
      const seen = new Set()
      rows.forEach(r => Object.keys(r).forEach(k => { if (!seen.has(k)) { seen.add(k); cols.push(k) } }))
      const body = rows.map(r => cols.map(c => r[c]))
      const scope = useDate && (from || to) ? `_${from || 'start'}_to_${to || 'now'}` : ''
      downloadCSV(`raw-${dataset.table}${scope}.csv`, [cols, ...body])
      const capped = rows.length >= MAX_ROWS ? ` (stopped at the ${MAX_ROWS.toLocaleString()}-row cap — narrow the date range for the rest)` : ''
      setStatus(`Exported ${rows.length.toLocaleString()} rows × ${cols.length} columns${capped}.`)
    } catch (e) {
      setErr(e.message || String(e)); setStatus('')
    } finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card" style={{ display: 'grid', gap: 6 }}>
        <b style={{ fontSize: 15 }}>Raw data export</b>
        <span className="page-sub" style={{ fontSize: 13 }}>
          Pull the underlying rows of any area you have access to — every column, every row, as stored.
          Only datasets you're permitted to see are listed.
        </span>
      </div>

      {allowed.length === 0 ? (
        <div className="card"><div className="page-sub" style={{ textAlign: 'center', padding: 24 }}>
          You don't have access to any exportable datasets.
        </div></div>
      ) : (
        <div className="card" style={{ display: 'grid', gap: 14 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontSize: 13, fontWeight: 600 }}>Dataset</label>
            <select style={{ ...selStyle, minWidth: 260 }} value={datasetId} onChange={e => setDatasetId(e.target.value)}>
              <option value="">Choose a dataset…</option>
              {allowed.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </div>

          {dataset && (
            <>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="checkbox" checked={useDate} onChange={e => setUseDate(e.target.checked)} />
                  Limit to a date range
                </label>
                {useDate && (
                  <>
                    <select style={selStyle} value={dateCol} onChange={e => setDateCol(e.target.value)}>
                      {dataset.dateCols.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <input type="date" style={selStyle} value={from} onChange={e => setFrom(e.target.value)} />
                    <span className="page-sub" style={{ fontSize: 12 }}>to</span>
                    <input type="date" style={selStyle} value={to} onChange={e => setTo(e.target.value)} />
                  </>
                )}
              </div>

              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="btn btn-primary" disabled={busy} onClick={onExport}>
                  {busy ? 'Exporting…' : '⬇ Export CSV'}
                </button>
                {status && <span className="page-sub" style={{ fontSize: 13 }}>{status}</span>}
              </div>
            </>
          )}

          {err && <div style={{ color: 'var(--failed)', fontSize: 13 }}>Error: {err}</div>}
        </div>
      )}

      <div className="card" style={{ fontSize: 12.5 }}>
        <span className="page-sub">
          Access mirrors your app permissions — you can only export areas you can already open.
          The database's row-level rules also apply, so rows you can't see never leave the system.
        </span>
      </div>
    </div>
  )
}
