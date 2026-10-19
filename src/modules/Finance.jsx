import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { ACCEPT, money, todayET, fmtDate, StatusBadge, receiptProblem, uploadReceipt, openReceipt, downloadCsv, Toast, panel } from './financeBits'
import FinanceSettings from './FinanceSettings'
import FinanceBilling from './FinanceBilling'
import FinanceInvoices from './FinanceInvoices'
import FinancePayRuns from './FinancePayRuns'
import FinancePay from './FinancePay'
import FinanceHours from './FinanceHours'

// ============================================================
// FINANCE (Admins and Owners only)
// Everything here is protected by the database, not just hidden: anyone else gets nothing back.
// Tabs: Submitted (the inbox for purchases staff submit), Purchases (the log, with receipts), Settings.
// ============================================================

const th = { textAlign: 'left', padding: '8px 10px', fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', borderBottom: '2px solid var(--line)', whiteSpace: 'nowrap' }
const td = { padding: '9px 10px', fontSize: 13.5, borderBottom: '1px solid var(--line)', verticalAlign: 'top' }
const chip = (on) => ({ fontSize: 12.5, fontWeight: 600, padding: '6px 12px', borderRadius: 999, border: '1px solid var(--line)', cursor: 'pointer', background: on ? 'var(--accent)' : 'var(--surface)', color: on ? 'var(--white, #fff)' : 'var(--ink-soft)' })

export default function Finance() {
  const [tab, setTab] = useState('submitted')
  const [lookups, setLookups] = useState({ companies: [], categories: [], clients: [], people: {}, settings: {} })
  const [toast, setToast] = useState('')
  const toastTimer = useRef(null)
  // each new message restarts the timer, so an earlier message can never wipe out a later one
  const flash = useCallback((t) => { setToast(t); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 3500) }, [])

  const loadLookups = useCallback(async () => {
    const [co, ca, cl, pe, se] = await Promise.all([
      supabase.from('finance_companies').select('*').order('sort').order('name'),
      supabase.from('finance_categories').select('*').order('sort').order('name'),
      supabase.from('clients').select('id,name').order('name'),
      supabase.from('profiles').select('id,full_name'),
      supabase.from('finance_settings').select('key,value'),
    ])
    setLookups({
      companies: co.data || [], categories: ca.data || [], clients: cl.data || [],
      people: Object.fromEntries((pe.data || []).map(p => [p.id, p.full_name])),
      settings: Object.fromEntries((se.data || []).map(s => [s.key, s.value])),
    })
  }, [])
  useEffect(() => { loadLookups() }, [loadLookups])

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h1 className="page-title">Finance</h1>
        <p className="page-sub">Visible to Admins and Owners only. Purchases submitted by staff arrive here, and the books are kept here.</p>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }} role="tablist">
        {[['submitted', 'Submitted'], ['purchases', 'Purchases'], ['billing', 'Clients and billing'], ['invoices', 'Invoices'], ['pay', 'People and pay'], ['payruns', 'Pay runs'], ['hours', 'Hours'], ['settings', 'Settings']].map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} style={chip(tab === k)} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {tab === 'submitted' && <SubmittedTab lookups={lookups} flash={flash} />}
      {tab === 'purchases' && <PurchasesTab lookups={lookups} flash={flash} />}
      {tab === 'billing' && <FinanceBilling lookups={lookups} flash={flash} />}
      {tab === 'invoices' && <FinanceInvoices flash={flash} />}
      {tab === 'pay' && <FinancePay flash={flash} />}
      {tab === 'payruns' && <FinancePayRuns flash={flash} />}
      {tab === 'hours' && <FinanceHours flash={flash} />}
      {tab === 'settings' && <FinanceSettings lookups={lookups} reload={loadLookups} flash={flash} />}
      <Toast text={toast} />
    </div>
  )
}

function catLabel(categories, id) {
  const c = categories.find(x => x.id === id)
  if (!c) return ''
  const p = c.parent_id ? categories.find(x => x.id === c.parent_id) : null
  return p ? `${p.name} > ${c.name}` : c.name
}

// ---------------- Submitted (inbox) ----------------
function SubmittedTab({ lookups, flash }) {
  const [rows, setRows] = useState([])
  const [filter, setFilter] = useState('received')
  const [loading, setLoading] = useState(true)
  const [review, setReview] = useState(null)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.from('finance_submissions').select('*').order('created_at', { ascending: false }).limit(300)
    if (error) setErr(error.message); else setErr('')
    setRows(data || []); setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const counts = useMemo(() => rows.reduce((m, r) => { m[r.status] = (m[r.status] || 0) + 1; return m }, {}), [rows])
  const shown = rows.filter(r => filter === 'all' || r.status === filter)
  const FILTERS = [['received', 'Needs review'], ['needs_info', 'Returned'], ['approved', 'Approved'], ['reimbursed', 'Reimbursed'], ['rejected', 'Rejected'], ['all', 'All']]

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {FILTERS.map(([k, label]) => <button key={k} style={chip(filter === k)} onClick={() => setFilter(k)}>{label}{k !== 'all' && counts[k] ? ` (${counts[k]})` : ''}</button>)}
      </div>
      {err && <div className="login-err">{err}</div>}
      {loading ? <p className="page-sub">Loading…</p> : shown.length === 0 ? <p className="page-sub">Nothing here.</p> : shown.map(r => (
        <div key={r.id} style={{ ...panel, marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{r.item} <span style={{ fontWeight: 400, color: 'var(--ink-soft)' }}>· {money(r.amount)}</span></div>
              <div className="page-sub" style={{ margin: '2px 0 0' }}>
                {lookups.people[r.submitted_by] || 'Someone'} · {r.vendor} · {fmtDate(r.purchase_date)} · {r.paid_with}
                {r.reimburse ? ' · wants reimbursement' : ''}
              </div>
              <div className="page-sub" style={{ margin: '2px 0 0' }}>{r.purpose}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <StatusBadge status={r.status} />
              {(r.status === 'received' || r.status === 'needs_info') && <button className="btn btn-primary" style={{ fontSize: 12.5, padding: '6px 12px' }} onClick={() => setReview(r)}>Review</button>}
            </div>
          </div>
        </div>
      ))}
      {review && <ReviewModal row={review} lookups={lookups} flash={flash} onClose={() => setReview(null)} onDone={() => { setReview(null); load() }} />}
    </div>
  )
}

function Modal({ title, onClose, children, width = 560 }) {
  return (
    <div className="modal-back open" onClick={e => { if (e.target.classList.contains('modal-back')) onClose() }}>
      <div className="modal" style={{ width }} role="dialog" aria-label={title}>
        <h3 style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 600 }}>{title}</h3>
        {children}
      </div>
    </div>
  )
}

function ReviewModal({ row, lookups, flash, onClose, onDone }) {
  const [company, setCompany] = useState(row.company_id || '')
  const [category, setCategory] = useState(row.category_id || '')
  const [deductible, setDeductible] = useState('')
  const [mode, setMode] = useState('decide')
  const [message, setMessage] = useState('')
  const [dupes, setDupes] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    supabase.rpc('finance_find_duplicate_purchases', { p_vendor: row.vendor, p_amount: row.amount, p_date: row.purchase_date })
      .then(({ data }) => setDupes(data || []))
  }, [row])

  async function run(fn, args, done) {
    setBusy(true); setErr('')
    const { error } = await supabase.rpc(fn, args)
    setBusy(false)
    if (error) return setErr(error.message)
    flash(done); onDone()
  }
  const approve = () => {
    if (!company) return setErr('Choose which company this purchase belongs to.')
    run('finance_approve_submission', { p_submission: row.id, p_company: company, p_category: category || null, p_deductible: deductible === '' ? null : deductible === 'yes' }, 'Approved and added to the purchase log.')
  }
  const sendBack = () => {
    if (!message.trim()) return setErr(mode === 'reject' ? 'Write a short reason.' : 'Write what information is needed.')
    run(mode === 'reject' ? 'finance_reject_submission' : 'finance_return_submission', { p_submission: row.id, p_message: message.trim() }, mode === 'reject' ? 'Rejected.' : 'Sent back with your question.')
  }

  return (
    <Modal title={`Review: ${row.item}`} onClose={onClose}>
      {err && <div className="login-err" role="alert">{err}</div>}
      <p className="page-sub" style={{ marginTop: 0 }}>
        {lookups.people[row.submitted_by] || 'Someone'} paid <b>{money(row.amount)}</b> to {row.vendor} on {fmtDate(row.purchase_date)} ({row.paid_with}).
        {row.reimburse ? ' They asked to be reimbursed.' : ''}
      </p>
      <p style={{ margin: '0 0 10px', fontSize: 13.5 }}><b>Why:</b> {row.purpose}{row.notes ? ` ${row.notes}` : ''}</p>
      <div style={{ marginBottom: 12 }}>
        {row.receipt_path
          ? <button className="btn btn-ghost" style={{ fontSize: 12.5 }} onClick={() => openReceipt(row.receipt_path).catch(() => setErr('Could not open the receipt.'))}>View receipt</button>
          : <span className="badge failed">No receipt: {row.no_receipt_reason}</span>}
      </div>
      {dupes.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--failed)', marginBottom: 12 }}>
          <b>Possible duplicate.</b> A matching purchase is already logged: {dupes.map(d => `${d.vendor} ${money(d.amount)} on ${fmtDate(d.purchase_date)}`).join('; ')}.
        </div>
      )}
      {mode === 'decide' ? (
        <>
          <div className="field"><label htmlFor="rv-company">Company *</label>
            <select id="rv-company" value={company} onChange={e => setCompany(e.target.value)}>
              <option value="">Choose…</option>{lookups.companies.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>
          <div className="field"><label htmlFor="rv-cat">Category</label>
            <select id="rv-cat" value={category} onChange={e => setCategory(e.target.value)}>
              <option value="">Not decided</option>
              {lookups.categories.filter(c => c.active && c.kind === 'expense').map(c => <option key={c.id} value={c.id}>{catLabel(lookups.categories, c.id)}</option>)}
            </select></div>
          <div className="field"><label htmlFor="rv-ded">Tax deductible?</label>
            <select id="rv-ded" value={deductible} onChange={e => setDeductible(e.target.value)}>
              <option value="">Not decided</option><option value="yes">Yes</option><option value="no">No</option>
            </select>
            <div className="hint">Your accountant decides what is truly deductible. This is a flag for them.</div></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
            <button className="btn btn-primary" onClick={approve} disabled={busy}>{busy ? 'Working…' : 'Approve'}</button>
            <button className="btn btn-ghost" onClick={() => { setMode('return'); setErr('') }} disabled={busy}>Return with a question</button>
            <button className="btn btn-ghost" onClick={() => { setMode('reject'); setErr('') }} disabled={busy}>Reject</button>
            <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Close</button>
          </div>
        </>
      ) : (
        <>
          <div className="field"><label htmlFor="rv-msg">{mode === 'reject' ? 'Reason (the person will see this)' : 'What information is needed? (the person will see this)'}</label>
            <textarea id="rv-msg" rows={3} value={message} onChange={e => setMessage(e.target.value)} autoFocus /></div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn btn-primary" onClick={sendBack} disabled={busy}>{busy ? 'Sending…' : mode === 'reject' ? 'Reject purchase' : 'Send back'}</button>
            <button className="btn btn-ghost" onClick={() => { setMode('decide'); setErr('') }} disabled={busy}>Back</button>
          </div>
        </>
      )}
    </Modal>
  )
}

// ---------------- Purchases (the log) ----------------
function PurchasesTab({ lookups, flash }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [company, setCompany] = useState('')
  const [category, setCategory] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [missing, setMissing] = useState(false)
  const [owed, setOwed] = useState(false)
  const [voided, setVoided] = useState(false)
  const [open, setOpen] = useState(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.from('finance_purchases')
      .select('*, finance_purchase_receipts(id,path,filename,kind), finance_reimbursements(paid_on,note)')
      .order('purchase_date', { ascending: false }).limit(1000)
    setErr(error ? error.message : '')
    setRows((data || []).map(r => ({ ...r, receipts: r.finance_purchase_receipts || [], paidBack: Array.isArray(r.finance_reimbursements) ? r.finance_reimbursements[0] : r.finance_reimbursements })))
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const shown = useMemo(() => rows.filter(r => {
    if (!voided && r.voided) return false
    if (company && r.company_id !== company) return false
    if (category && r.category_id !== category) return false
    if (from && r.purchase_date < from) return false
    if (to && r.purchase_date > to) return false
    if (missing && r.receipts.length > 0) return false
    if (owed && !(r.reimbursable && !r.paidBack)) return false
    if (q && !`${r.vendor} ${r.description || ''} ${r.purpose || ''}`.toLowerCase().includes(q.toLowerCase())) return false
    return true
  }), [rows, q, company, category, from, to, missing, owed, voided])

  const total = shown.filter(r => !r.voided).reduce((s, r) => s + Number(r.amount), 0)

  async function exportCsv() {
    await supabase.rpc('finance_log_event', { p_action: 'export', p_table: 'finance_purchases', p_note: `CSV export, ${shown.length} rows` })
    downloadCsv(`purchases-${todayET()}.csv`,
      ['Date', 'Vendor', 'Description', 'Amount', 'Company', 'Category', 'Paid with', 'Paid by', 'Client', 'Purpose', 'Tax deductible', 'Reimbursable', 'Paid back on', 'Receipts', 'Voided'],
      shown.map(r => [r.purchase_date, r.vendor, r.description, Number(r.amount).toFixed(2),
        lookups.companies.find(c => c.id === r.company_id)?.name || '', catLabel(lookups.categories, r.category_id), r.paid_with,
        lookups.people[r.paid_by] || '', lookups.clients.find(c => c.id === r.client_id)?.name || '', r.purpose,
        r.tax_deductible == null ? '' : r.tax_deductible ? 'Yes' : 'No', r.reimbursable ? 'Yes' : 'No', r.paidBack?.paid_on || '', r.receipts.length, r.voided ? 'Yes' : '']))
    flash('Exported. The export is recorded in the audit log.')
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
        <div className="field" style={{ margin: 0, minWidth: 180 }}><label htmlFor="pf-q">Search</label><input id="pf-q" value={q} onChange={e => setQ(e.target.value)} placeholder="Vendor or description" /></div>
        <div className="field" style={{ margin: 0 }}><label htmlFor="pf-co">Company</label>
          <select id="pf-co" value={company} onChange={e => setCompany(e.target.value)}><option value="">All</option>{lookups.companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="field" style={{ margin: 0 }}><label htmlFor="pf-cat">Category</label>
          <select id="pf-cat" value={category} onChange={e => setCategory(e.target.value)}><option value="">All</option>{lookups.categories.filter(c => c.kind === 'expense').map(c => <option key={c.id} value={c.id}>{catLabel(lookups.categories, c.id)}</option>)}</select></div>
        <div className="field" style={{ margin: 0 }}><label htmlFor="pf-from">From</label><input id="pf-from" type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div className="field" style={{ margin: 0 }}><label htmlFor="pf-to">To</label><input id="pf-to" type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>+ Add purchase</button>
        <button className="btn btn-ghost" onClick={exportCsv} disabled={!shown.length}>Export CSV</button>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <button style={chip(missing)} onClick={() => setMissing(!missing)}>Missing a receipt</button>
        <button style={chip(owed)} onClick={() => setOwed(!owed)}>Owed back to someone</button>
        <button style={chip(voided)} onClick={() => setVoided(!voided)}>Show voided</button>
      </div>
      {err && <div className="login-err">{err}</div>}
      {loading ? <p className="page-sub">Loading…</p> : (
        <div style={{ ...panel, padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead><tr><th style={th}>Date</th><th style={th}>Vendor</th><th style={{ ...th, textAlign: 'right' }}>Amount</th><th style={th}>Company</th><th style={th}>Category</th><th style={th}>Receipt</th><th style={th}>Reimbursement</th></tr></thead>
            <tbody>
              {shown.length === 0 && <tr><td style={td} colSpan={7}>No purchases match.</td></tr>}
              {shown.map(r => (
                <tr key={r.id} onClick={() => setOpen(r)} style={{ cursor: 'pointer', opacity: r.voided ? 0.5 : 1 }}>
                  <td style={td}>{fmtDate(r.purchase_date)}</td>
                  <td style={td}><div style={{ fontWeight: 600, textDecoration: r.voided ? 'line-through' : 'none' }}>{r.vendor}</div><div style={{ color: 'var(--ink-soft)', fontSize: 12.5 }}>{r.description}</div></td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>{money(r.amount)}</td>
                  <td style={td}>{lookups.companies.find(c => c.id === r.company_id)?.name}</td>
                  <td style={td}>{catLabel(lookups.categories, r.category_id) || <span style={{ color: 'var(--ink-soft)' }}>Not set</span>}</td>
                  <td style={td}>{r.receipts.length ? `${r.receipts.length} attached` : <span className="badge failed">Missing</span>}</td>
                  <td style={td}>{!r.reimbursable ? '' : r.paidBack ? <span className="badge passed">Paid back {fmtDate(r.paidBack.paid_on)}</span> : <span className="badge needed">Owed to {lookups.people[r.paid_by] || 'staff'}</span>}</td>
                </tr>
              ))}
            </tbody>
            {shown.length > 0 && <tfoot><tr><td style={{ ...td, fontWeight: 700 }} colSpan={2}>{shown.length} purchases shown</td><td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{money(total)}</td><td style={td} colSpan={4}></td></tr></tfoot>}
          </table>
        </div>
      )}
      {open && <PurchaseModal p={open} lookups={lookups} flash={flash} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); load() }} />}
      {adding && <AddPurchaseModal lookups={lookups} flash={flash} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load() }} />}
    </div>
  )
}

function PurchaseModal({ p, lookups, flash, onClose, onChanged }) {
  const [category, setCategory] = useState(p.category_id || '')
  const [deductible, setDeductible] = useState(p.tax_deductible == null ? '' : p.tax_deductible ? 'yes' : 'no')
  const [notes, setNotes] = useState(p.notes || '')
  const [paidOn, setPaidOn] = useState(todayET())
  const [paidNote, setPaidNote] = useState('')
  const [voidReason, setVoidReason] = useState('')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const guard = async (fn, done) => {
    setBusy(true); setErr('')
    try { await fn(); flash(done); onChanged() } catch (e) { setErr(e.message || 'Something went wrong.') } finally { setBusy(false) }
  }
  const save = () => guard(async () => {
    const { error } = await supabase.from('finance_purchases').update({ category_id: category || null, tax_deductible: deductible === '' ? null : deductible === 'yes', notes: notes.trim() || null }).eq('id', p.id)
    if (error) throw error
  }, 'Saved.')
  const addReceipt = () => guard(async () => {
    const path = await uploadReceipt(file, `purchases/${p.id}`)
    const { error } = await supabase.from('finance_purchase_receipts').insert({ purchase_id: p.id, path, filename: file.name, kind: 'receipt' })
    if (error) throw error
  }, 'Receipt added.')
  const markPaid = () => guard(async () => {
    const { error } = await supabase.rpc('finance_mark_reimbursed', { p_purchase: p.id, p_on: paidOn, p_note: paidNote.trim() || null })
    if (error) throw error
  }, 'Recorded as paid back.')
  const voidIt = () => {
    if (!voidReason.trim()) return setErr('Give a reason to void this purchase.')
    guard(async () => {
      const { error } = await supabase.from('finance_purchases').update({ voided: true, void_reason: voidReason.trim(), voided_at: new Date().toISOString() }).eq('id', p.id)
      if (error) throw error
    }, 'Voided.')
  }

  return (
    <Modal title={`${p.vendor}: ${money(p.amount)}`} onClose={onClose} width={620}>
      {err && <div className="login-err" role="alert">{err}</div>}
      <p className="page-sub" style={{ marginTop: 0 }}>
        {fmtDate(p.purchase_date)} · {lookups.companies.find(c => c.id === p.company_id)?.name} · {p.paid_with || 'payment method not recorded'}
        {p.paid_by ? ` · paid by ${lookups.people[p.paid_by] || 'staff'}` : ''}
      </p>
      {p.description && <p style={{ margin: '0 0 6px' }}><b>What:</b> {p.description}</p>}
      {p.purpose && <p style={{ margin: '0 0 12px' }}><b>Why:</b> {p.purpose}</p>}
      {p.voided && <div className="login-err">Voided: {p.void_reason}</div>}

      <div className="field"><label htmlFor="pm-cat">Category</label>
        <select id="pm-cat" value={category} onChange={e => setCategory(e.target.value)} disabled={p.voided}>
          <option value="">Not set</option>{lookups.categories.filter(c => c.active && c.kind === 'expense').map(c => <option key={c.id} value={c.id}>{catLabel(lookups.categories, c.id)}</option>)}
        </select></div>
      <div className="field"><label htmlFor="pm-ded">Tax deductible?</label>
        <select id="pm-ded" value={deductible} onChange={e => setDeductible(e.target.value)} disabled={p.voided}><option value="">Not decided</option><option value="yes">Yes</option><option value="no">No</option></select></div>
      <div className="field"><label htmlFor="pm-notes">Notes</label><textarea id="pm-notes" rows={2} value={notes} onChange={e => setNotes(e.target.value)} disabled={p.voided} /></div>
      {!p.voided && <button className="btn btn-primary" onClick={save} disabled={busy}>Save changes</button>}

      <h4 style={{ margin: '20px 0 8px' }}>Receipts</h4>
      {p.receipts.length === 0 ? <p className="page-sub" style={{ margin: 0 }}>No receipt attached.</p> : p.receipts.map(r => (
        <div key={r.id}><button className="btn btn-ghost" style={{ fontSize: 12.5, marginBottom: 6 }} onClick={() => openReceipt(r.path).catch(() => setErr('Could not open that file.'))}>{r.filename || 'Receipt'}</button></div>
      ))}
      {!p.voided && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
          <input type="file" accept={ACCEPT} aria-label="Add a receipt" onChange={e => { const f = e.target.files?.[0] || null; const prob = receiptProblem(f); if (prob) { setErr(prob); setFile(null) } else { setErr(''); setFile(f) } }} />
          <button className="btn btn-ghost" onClick={addReceipt} disabled={!file || busy}>Add receipt</button>
        </div>
      )}

      {p.reimbursable && (
        <>
          <h4 style={{ margin: '20px 0 8px' }}>Reimbursement</h4>
          {p.paidBack ? <p style={{ margin: 0 }}>Paid back on {fmtDate(p.paidBack.paid_on)}{p.paidBack.note ? `: ${p.paidBack.note}` : ''}.</p> : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div className="field" style={{ margin: 0 }}><label htmlFor="pm-paid">Paid back on</label><input id="pm-paid" type="date" value={paidOn} onChange={e => setPaidOn(e.target.value)} /></div>
              <div className="field" style={{ margin: 0, flex: 1, minWidth: 160 }}><label htmlFor="pm-pnote">Note</label><input id="pm-pnote" value={paidNote} onChange={e => setPaidNote(e.target.value)} placeholder="e.g. paid through Rippling" /></div>
              <button className="btn btn-primary" onClick={markPaid} disabled={busy}>Mark paid back</button>
            </div>
          )}
        </>
      )}

      {!p.voided && (
        <>
          <h4 style={{ margin: '20px 0 8px' }}>Void</h4>
          <p className="page-sub" style={{ margin: '0 0 8px' }}>Purchases are never deleted. Voiding keeps the record and the reason.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input aria-label="Reason for voiding" style={{ flex: 1, padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)' }} value={voidReason} onChange={e => setVoidReason(e.target.value)} placeholder="Reason" />
            <button className="btn btn-ghost" onClick={voidIt} disabled={busy}>Void purchase</button>
          </div>
        </>
      )}
      <div style={{ marginTop: 18 }}><button className="btn btn-ghost" onClick={onClose}>Close</button></div>
    </Modal>
  )
}

function AddPurchaseModal({ lookups, flash, onClose, onSaved }) {
  const { user } = useAuth()
  const [f, setF] = useState({ purchase_date: todayET(), vendor: '', description: '', amount: '', company_id: '', category_id: '', paid_with: '', paid_by: '', client_id: '', purpose: '', deductible: '', reimbursable: false })
  const [files, setFiles] = useState([])
  const [warn, setWarn] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const methods = lookups.settings.payment_methods || []

  async function save(force) {
    setErr('')
    const amount = Number(String(f.amount).replace(/[$,\s]/g, ''))
    if (!f.vendor.trim()) return setErr('Add the vendor.')
    if (!(amount > 0)) return setErr('Enter the amount.')
    if (!f.company_id) return setErr('Choose the company.')
    setBusy(true)
    try {
      if (!force) {
        const { data: d } = await supabase.rpc('finance_find_duplicate_purchases', { p_vendor: f.vendor, p_amount: amount, p_date: f.purchase_date })
        if (d && d.length) { setWarn(`A similar purchase is already logged (${d.map(x => `${x.vendor} ${money(x.amount)} on ${fmtDate(x.purchase_date)}`).join('; ')}). Save anyway?`); setBusy(false); return }
      }
      const { data: row, error } = await supabase.from('finance_purchases').insert({
        created_by: user?.id, purchase_date: f.purchase_date, vendor: f.vendor.trim(), description: f.description.trim() || null, amount,
        company_id: f.company_id, category_id: f.category_id || null, paid_with: f.paid_with || null, paid_by: f.paid_by || null,
        client_id: f.client_id || null, purpose: f.purpose.trim() || null, tax_deductible: f.deductible === '' ? null : f.deductible === 'yes', reimbursable: f.reimbursable,
      }).select('id').single()
      if (error) throw error
      for (const file of files) {
        const path = await uploadReceipt(file, `purchases/${row.id}`)
        const { error: re } = await supabase.from('finance_purchase_receipts').insert({ purchase_id: row.id, path, filename: file.name, kind: 'receipt' })
        if (re) throw re
      }
      flash('Purchase added.'); onSaved()
    } catch (e) { setErr(e.message || 'Could not save.') } finally { setBusy(false) }
  }

  return (
    <Modal title="Add a purchase" onClose={onClose} width={620}>
      {err && <div className="login-err" role="alert">{err}</div>}
      {warn && <div className="card" style={{ borderColor: 'var(--failed)', marginBottom: 12 }}>{warn}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 14px' }}>
        <div className="field"><label htmlFor="ap-date">Date</label><input id="ap-date" type="date" value={f.purchase_date} onChange={e => set('purchase_date', e.target.value)} /></div>
        <div className="field"><label htmlFor="ap-vendor">Vendor *</label><input id="ap-vendor" value={f.vendor} onChange={e => set('vendor', e.target.value)} /></div>
        <div className="field"><label htmlFor="ap-amount">Amount (USD) *</label><input id="ap-amount" inputMode="decimal" value={f.amount} onChange={e => set('amount', e.target.value)} /></div>
        <div className="field"><label htmlFor="ap-company">Company *</label>
          <select id="ap-company" value={f.company_id} onChange={e => set('company_id', e.target.value)}><option value="">Choose…</option>{lookups.companies.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="field"><label htmlFor="ap-cat">Category</label>
          <select id="ap-cat" value={f.category_id} onChange={e => set('category_id', e.target.value)}><option value="">Not set</option>{lookups.categories.filter(c => c.active && c.kind === 'expense').map(c => <option key={c.id} value={c.id}>{catLabel(lookups.categories, c.id)}</option>)}</select></div>
        <div className="field"><label htmlFor="ap-paid">Paid with</label>
          <select id="ap-paid" value={f.paid_with} onChange={e => set('paid_with', e.target.value)}><option value="">Not recorded</option>{methods.map(m => <option key={m} value={m}>{m}</option>)}</select></div>
        <div className="field"><label htmlFor="ap-by">Paid by (a person)</label>
          <select id="ap-by" value={f.paid_by} onChange={e => set('paid_by', e.target.value)}><option value="">The company</option>{Object.entries(lookups.people).sort((a, b) => (a[1] || '').localeCompare(b[1] || '')).map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></div>
        <div className="field"><label htmlFor="ap-client">Client</label>
          <select id="ap-client" value={f.client_id} onChange={e => set('client_id', e.target.value)}><option value="">General business</option>{lookups.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      </div>
      <div className="field"><label htmlFor="ap-desc">What was bought</label><input id="ap-desc" value={f.description} onChange={e => set('description', e.target.value)} /></div>
      <div className="field"><label htmlFor="ap-purpose">Business purpose</label><input id="ap-purpose" value={f.purpose} onChange={e => set('purpose', e.target.value)} /></div>
      <div className="field"><label htmlFor="ap-ded">Tax deductible?</label>
        <select id="ap-ded" value={f.deductible} onChange={e => set('deductible', e.target.value)}><option value="">Not decided</option><option value="yes">Yes</option><option value="no">No</option></select></div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, fontWeight: 500 }}><input type="checkbox" checked={f.reimbursable} onChange={e => set('reimbursable', e.target.checked)} /> Owed back to the person who paid</label>
      <div className="field"><label htmlFor="ap-files">Receipts (optional, you can add more later)</label>
        <input id="ap-files" type="file" multiple accept={ACCEPT} onChange={e => { const list = [...(e.target.files || [])]; const bad = list.map(receiptProblem).find(Boolean); if (bad) { setErr(bad); setFiles([]) } else { setErr(''); setFiles(list) } }} /></div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button className="btn btn-primary" onClick={() => save(!!warn)} disabled={busy}>{busy ? 'Saving…' : warn ? 'Save anyway' : 'Save purchase'}</button>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </Modal>
  )
}
