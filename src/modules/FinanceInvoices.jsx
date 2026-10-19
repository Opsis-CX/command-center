import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { money, todayET, fmtDate, panel, downloadCsv } from './financeBits'

// ============================================================
// INVOICES (Admins and Owners)
// Build a draft from a period's work, review and edit it (every change keeps the original and why), approve it
// (it gets a number, a frozen snapshot, and the exact hours on it are locked), record payments, or void it.
// Nothing is emailed from here: print or save as a PDF, or download the data file, and send it yourself.
// ============================================================

const chip = (on) => ({ fontSize: 12.5, fontWeight: 600, padding: '6px 12px', borderRadius: 999, border: '1px solid var(--line)', cursor: 'pointer', background: on ? 'var(--accent)' : 'var(--surface)', color: on ? 'var(--white, #fff)' : 'var(--ink-soft)' })
const th = { textAlign: 'left', fontSize: 12, color: 'var(--ink-soft)', fontWeight: 600, padding: '6px 8px', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' }
const td = { padding: '8px', borderBottom: '1px solid var(--line-soft, var(--line))', verticalAlign: 'top', fontSize: 13.5 }
const num = { ...td, textAlign: 'right', whiteSpace: 'nowrap' }

const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA') }
const monthEnd = (iso) => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0).toLocaleDateString('en-CA')
const prevMonthStart = (iso) => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 2, 1).toLocaleDateString('en-CA')
const fmtQty = (q, d = 2) => Number(q).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
const hrs = (secs) => (Number(secs) / 3600).toFixed(2)
const mdy = (iso) => iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : ''
const paidSum = (payments, id) => payments.filter(p => p.invoice_id === id).reduce((s, p) => s + Number(p.amount), 0)

export function invoiceStatus(inv, balance, today) {
  if (inv.status === 'void') return ['Void', 'badge failed']
  if (inv.status === 'draft') return ['Draft', 'badge needed']
  if (balance <= 0.004) return ['Paid in full', 'badge passed']
  if (inv.due_date < today) return ['Overdue', 'badge failed']
  return ['Awaiting payment', 'badge']
}

// the period a type should be built for next: from the day after its last live invoice (or last month), to the end of that month
export function suggestPeriod(type, invoices, today) {
  const live = invoices.filter(i => i.invoice_type_id === type.id && i.status !== 'void')
  const lastEnd = live.reduce((m, i) => (i.period_end > m ? i.period_end : m), '')
  const from = lastEnd ? addDays(lastEnd, 1) : prevMonthStart(today)
  return { from, to: monthEnd(from), lastEnd }
}

// ---------- the invoice as a printable page, laid out like the example ----------
export function invoiceHtml(s, payments, draft) {
  const d = s.decimals ?? 2
  const paid = payments.reduce((a, p) => a + Number(p.amount), 0)
  const bal = Number(s.total) - paid
  const lines = (s.lines || []).map(l => `<tr><td>${esc(l.line)}.</td><td>${esc(l.product_name)}</td><td>${esc(l.description)}</td><td class="r">${esc(fmtQty(l.quantity, d))}</td><td class="r">${esc(money(l.rate))}</td><td class="r">${esc(money(l.amount))}</td></tr>`).join('')
  const addr = (a) => esc(a).replace(/\n/g, '<br>')
  const iss = s.issuer || {}
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(s.number || 'Draft invoice')}</title><style>
    body{font-family:Arial,Helvetica,sans-serif;color:#222;margin:40px;font-size:13px}
    h1{font-size:26px;letter-spacing:6px;font-weight:400;margin:0 0 18px}
    .head{display:flex;justify-content:space-between;gap:20px;margin-bottom:26px}.head b{font-size:15px}
    .cols{display:flex;gap:60px;margin-bottom:22px}.cols div{min-width:240px}
    h4{margin:0 0 6px;font-size:13px}
    table{width:100%;border-collapse:collapse;margin-top:8px}th{text-align:left;font-size:12px;border-bottom:2px solid #333;padding:6px 6px}
    td{padding:8px 6px;border-bottom:1px solid #ddd;vertical-align:top}.r{text-align:right;white-space:nowrap}
    .tot{text-align:right;font-size:15px;font-weight:700;margin:14px 6px}
    .draft{color:#b45309;font-weight:700;letter-spacing:2px;margin-bottom:8px}
    .paid{font-size:22px;font-weight:700;color:#15803d;text-align:center;margin-top:26px;letter-spacing:2px}
  </style></head><body>
    ${draft ? '<div class="draft">DRAFT - NOT YET APPROVED</div>' : ''}
    <h1>INVOICE</h1>
    <div class="head"><div><b>${esc(iss.name)}</b><br>${addr(iss.address)}</div><div style="text-align:right">${esc(iss.email)}<br>${esc(iss.phone)}</div></div>
    <div class="cols">
      <div><h4>Bill to</h4>${esc((s.bill_to || {}).name)}<br>${addr((s.bill_to || {}).address)}</div>
      <div><h4>Ship to</h4>${esc((s.ship_to || {}).name)}<br>${addr((s.ship_to || {}).address)}</div>
      <div><h4>Invoice details</h4>Invoice no.: ${esc(s.number || '(draft)')}<br>Terms: Net ${esc(s.terms_days)}<br>Invoice date: ${esc(mdy(s.invoice_date))}<br>Due date: ${esc(mdy(s.due_date))}</div>
    </div>
    <table><thead><tr><th>#</th><th>Product or service</th><th>Description</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>${lines}</tbody></table>
    <div class="tot">Total ${esc(money(s.total))}</div>
    ${s.notes ? `<p>${esc(s.notes)}</p>` : ''}
    <h4>Ways to pay</h4><p>${addr(iss.payment_instructions)}</p>
    ${payments.length ? payments.map(p => `<div class="tot" style="font-weight:400">Payment ${esc(mdy(p.paid_on))}: -${esc(money(p.amount))}</div>`).join('') + `<div class="tot">Balance due ${esc(money(bal))}</div>` : ''}
    ${!draft && payments.length && bal <= 0.004 ? '<div class="paid">PAID IN FULL</div>' : ''}
  </body></html>`
}

export function invoiceCsv(s) {
  const header = ['Invoice No', 'Customer', 'Invoice Date', 'Due Date', 'Terms', 'Line', 'Product/Service', 'Description', 'Qty', 'Rate', 'Amount', 'Invoice Total']
  const rows = (s.lines || []).map(l => [s.number, (s.bill_to || {}).name || s.client, s.invoice_date, s.due_date, `Net ${s.terms_days}`, l.line, l.product_name, l.description || '', l.quantity, l.rate, l.amount, s.total])
  return { header, rows }
}

export default function FinanceInvoices({ flash }) {
  const [invoices, setInvoices] = useState([])
  const [types, setTypes] = useState([])
  const [entities, setEntities] = useState([])
  const [companies, setCompanies] = useState([])
  const [payments, setPayments] = useState([])
  const [next, setNext] = useState({})
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [openId, setOpenId] = useState(null)
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const [building, setBuilding] = useState(null)      // null | { type?, from?, to? }
  const today = todayET()

  const load = useCallback(async () => {
    const [iv, ty, en, co, pa] = await Promise.all([
      supabase.from('finance_invoices').select('*').order('created_at', { ascending: false }),
      supabase.from('finance_invoice_types').select('*').order('sort').order('name'),
      supabase.from('finance_billing_entities').select('id,name,legal_name,bill_to_address,ship_to_address').order('name'),
      supabase.from('finance_companies').select('*'),
      supabase.from('finance_invoice_payments').select('id,invoice_id,paid_on,amount,method,note').order('paid_on'),
    ])
    const first = iv.error || ty.error || en.error || co.error || pa.error
    setErr(first ? first.message : '')
    setInvoices(iv.data || []); setTypes(ty.data || []); setEntities(en.data || []); setCompanies(co.data || []); setPayments(pa.data || [])
    const dates = {}
    await Promise.all((ty.data || []).filter(t => t.active && t.invoice_day != null).map(async t => { const { data } = await supabase.rpc('finance_type_next_invoice_date', { p_type: t.id }); dates[t.id] = data }))
    setNext(dates); setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const entityOf = (id) => entities.find(e => e.id === id)
  const typeOf = (id) => types.find(t => t.id === id)
  const rows = useMemo(() => invoices.map(i => ({ inv: i, balance: Number(i.total) - paidSum(payments, i.id) })).filter(({ inv, balance }) => {
    if (q) { const t = `${inv.number || 'draft'} ${(entityOf(inv.entity_id) || {}).name || ''} ${(typeOf(inv.invoice_type_id) || {}).name || ''}`.toLowerCase(); if (!t.includes(q.toLowerCase())) return false }
    if (filter === 'drafts') return inv.status === 'draft'
    if (filter === 'open') return inv.status === 'approved' && balance > 0.004
    if (filter === 'paid') return inv.status === 'approved' && balance <= 0.004
    if (filter === 'void') return inv.status === 'void'
    return true
  }), [invoices, payments, filter, q, entities, types])   // eslint-disable-line

  if (loading) return <p className="page-sub">Loading…</p>
  const open = invoices.find(i => i.id === openId)
  if (open) return <InvoicePage key={open.id} invoice={open} type={typeOf(open.invoice_type_id)} entity={entityOf(open.entity_id)} company={companies.find(c => c.id === open.issuing_company_id)}
    payments={payments.filter(p => p.invoice_id === open.id)} onBack={() => setOpenId(null)} reload={load} flash={flash} />

  const ready = types.filter(t => t.active && !invoices.some(i => i.invoice_type_id === t.id && i.status === 'draft'))
  return (
    <div>
      <p className="page-sub" style={{ margin: '0 0 12px', maxWidth: 760 }}>Build an invoice from a period's work, review it, approve it, and record payments. Approving gives it a number and locks the exact hours on it, so nothing is billed twice. Nothing is emailed from here: print or save it as a PDF, or download the data file, and send it yourself.</p>
      {err && <div className="login-err" role="alert">{err}</div>import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { money, todayET, fmtDate, panel, downloadCsv } from './financeBits'

// ============================================================
// INVOICES (Admins and Owners)
// Build a draft from a period's work, review and edit it (every change keeps the original and why), approve it
// (it gets a number, a frozen snapshot, and the exact hours on it are locked), record payments, or void it.
// Nothing is emailed from here: print or save as a PDF, or download the data file, and send it yourself.
// ============================================================

const chip = (on) => ({ fontSize: 12.5, fontWeight: 600, padding: '6px 12px', borderRadius: 999, border: '1px solid var(--line)', cursor: 'pointer', background: on ? 'var(--accent)' : 'var(--surface)', color: on ? 'var(--white, #fff)' : 'var(--ink-soft)' })
const th = { textAlign: 'left', fontSize: 12, color: 'var(--ink-soft)', fontWeight: 600, padding: '6px 8px', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' }
const td = { padding: '8px', borderBottom: '1px solid var(--line-soft, var(--line))', verticalAlign: 'top', fontSize: 13.5 }
const num = { ...td, textAlign: 'right', whiteSpace: 'nowrap' }

const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA') }
const monthEnd = (iso) => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0).toLocaleDateString('en-CA')
const prevMonthStart = (iso) => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 2, 1).toLocaleDateString('en-CA')
const fmtQty = (q, d = 2) => Number(q).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
const hrs = (secs) => (Number(secs) / 3600).toFixed(2)
const mdy = (iso) => iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : ''
const paidSum = (payments, id) => payments.filter(p => p.invoice_id === id).reduce((s, p) => s + Number(p.amount), 0)

export function invoiceStatus(inv, balance, today) {
  if (inv.status === 'void') return ['Void', 'badge failed']
  if (inv.status === 'draft') return ['Draft', 'badge needed']
  if (balance <= 0.004) return ['Paid in full', 'badge passed']
  if (inv.due_date < today) return ['Overdue', 'badge failed']
  return ['Awaiting payment', 'badge']
}

// the period a type should be built for next: from the day after its last live invoice (or last month), to the end of that month
export function suggestPeriod(type, invoices, today) {
  const live = invoices.filter(i => i.invoice_type_id === type.id && i.status !== 'void')
  const lastEnd = live.reduce((m, i) => (i.period_end > m ? i.period_end : m), '')
  const from = lastEnd ? addDays(lastEnd, 1) : prevMonthStart(today)
  return { from, to: monthEnd(from), lastEnd }
}

// ---------- the invoice as a printable page, laid out like the example ----------
export function invoiceHtml(s, payments, draft) {
  const d = s.decimals ?? 2
  const paid = payments.reduce((a, p) => a + Number(p.amount), 0)
  const bal = Number(s.total) - paid
  const lines = (s.lines || []).map(l => `<tr><td>${esc(l.line)}.</td><td>${esc(l.product_name)}</td><td>${esc(l.description)}</td><td class="r">${esc(fmtQty(l.quantity, d))}</td><td class="r">${esc(money(l.rate))}</td><td class="r">${esc(money(l.amount))}</td></tr>`).join('')
  const addr = (a) => esc(a).replace(/\n/g, '<br>')
  const iss = s.issuer || {}
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(s.number || 'Draft invoice')}</title><style>
    body{font-family:Arial,Helvetica,sans-serif;color:#222;margin:40px;font-size:13px}
    h1{font-size:26px;letter-spacing:6px;font-weight:400;margin:0 0 18px}
    .head{display:flex;justify-content:space-between;gap:20px;margin-bottom:26px}.head b{font-size:15px}
    .cols{display:flex;gap:60px;margin-bottom:22px}.cols div{min-width:240px}
    h4{margin:0 0 6px;font-size:13px}
    table{width:100%;border-collapse:collapse;margin-top:8px}th{text-align:left;font-size:12px;border-bottom:2px solid #333;padding:6px 6px}
    td{padding:8px 6px;border-bottom:1px solid #ddd;vertical-align:top}.r{text-align:right;white-space:nowrap}
    .tot{text-align:right;font-size:15px;font-weight:700;margin:14px 6px}
    .draft{color:#b45309;font-weight:700;letter-spacing:2px;margin-bottom:8px}
    .paid{font-size:22px;font-weight:700;color:#15803d;text-align:center;margin-top:26px;letter-spacing:2px}
  </style></head><body>
    ${draft ? '<div class="draft">DRAFT - NOT YET APPROVED</div>' : ''}
    <h1>INVOICE</h1>
    <div class="head"><div><b>${esc(iss.name)}</b><br>${addr(iss.address)}</div><div style="text-align:right">${esc(iss.email)}<br>${esc(iss.phone)}</div></div>
    <div class="cols">
      <div><h4>Bill to</h4>${esc((s.bill_to || {}).name)}<br>${addr((s.bill_to || {}).address)}</div>
      <div><h4>Ship to</h4>${esc((s.ship_to || {}).name)}<br>${addr((s.ship_to || {}).address)}</div>
      <div><h4>Invoice details</h4>Invoice no.: ${esc(s.number || '(draft)')}<br>Terms: Net ${esc(s.terms_days)}<br>Invoice date: ${esc(mdy(s.invoice_date))}<br>Due date: ${esc(mdy(s.due_date))}</div>
    </div>
    <table><thead><tr><th>#</th><th>Product or service</th><th>Description</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>${lines}</tbody></table>
    <div class="tot">Total ${esc(money(s.total))}</div>
    ${s.notes ? `<p>${esc(s.notes)}</p>` : ''}
    <h4>Ways to pay</h4><p>${addr(iss.payment_instructions)}</p>
    ${payments.length ? payments.map(p => `<div class="tot" style="font-weight:400">Payment ${esc(mdy(p.paid_on))}: -${esc(money(p.amount))}</div>`).join('') + `<div class="tot">Balance due ${esc(money(bal))}</div>` : ''}
    ${!draft && payments.length && bal <= 0.004 ? '<div class="paid">PAID IN FULL</div>' : ''}
  </body></html>`
}

export function invoiceCsv(s) {
  const header = ['Invoice No', 'Customer', 'Invoice Date', 'Due Date', 'Terms', 'Line', 'Product/Service', 'Description', 'Qty', 'Rate', 'Amount', 'Invoice Total']
  const rows = (s.lines || []).map(l => [s.number, (s.bill_to || {}).name || s.client, s.invoice_date, s.due_date, `Net ${s.terms_days}`, l.line, l.product_name, l.description || '', l.quantity, l.rate, l.amount, s.total])
  return { header, rows }
}

export default function FinanceInvoices({ flash }) {
  const [invoices, setInvoices] = useState([])
  const [types, setTypes] = useState([])
  const [entities, setEntities] = useState([])
  const [companies, setCompanies] = useState([])
  const [payments, setPayments] = useState([])
  const [next, setNext] = useState({})
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [openId, setOpenId] = useState(null)
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const [building, setBuilding] = useState(null)      // null | { type?, from?, to? }
  const today = todayET()

  const load = useCallback(async () => {
    const [iv, ty, en, co, pa] = await Promise.all([
      supabase.from('finance_invoices').select('*').order('created_at', { ascending: false }),
      supabase.from('finance_invoice_types').select('*').order('sort').order('name'),
      supabase.from('finance_billing_entities').select('id,name,legal_name,bill_to_address,ship_to_address').order('name'),
      supabase.from('finance_companies').select('*'),
      supabase.from('finance_invoice_payments').select('id,invoice_id,paid_on,amount,method,note').order('paid_on'),
    ])
    const first = iv.error || ty.error || en.error || co.error || pa.error
    setErr(first ? first.message : '')
    setInvoices(iv.data || []); setTypes(ty.data || []); setEntities(en.data || []); setCompanies(co.data || []); setPayments(pa.data || [])
    const dates = {}
    await Promise.all((ty.data || []).filter(t => t.active && t.invoice_day != null).map(async t => { const { data } = await supabase.rpc('finance_type_next_invoice_date', { p_type: t.id }); dates[t.id] = data }))
    setNext(dates); setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const entityOf = (id) => entities.find(e => e.id === id)
  const typeOf = (id) => types.find(t => t.id === id)
  const rows = useMemo(() => invoices.map(i => ({ inv: i, balance: Number(i.total) - paidSum(payments, i.id) })).filter(({ inv, balance }) => {
    if (q) { const t = `${inv.number || 'draft'} ${(entityOf(inv.entity_id) || {}).name || ''} ${(typeOf(inv.invoice_type_id) || {}).name || ''}`.toLowerCase(); if (!t.includes(q.toLowerCase())) return false }
    if (filter === 'drafts') return inv.status === 'draft'
    if (filter === 'open') return inv.status === 'approved' && balance > 0.004
    if (filter === 'paid') return inv.status === 'approved' && balance <= 0.004
    if (filter === 'void') return inv.status === 'void'
    return true
  }), [invoices, payments, filter, q, entities, types])   // eslint-disable-line

  if (loading) return <p className="page-sub">Loading…</p>
  const open = invoices.find(i => i.id === openId)
  if (open) return <InvoicePage key={open.id} invoice={open} type={typeOf(open.invoice_type_id)} entity={entityOf(open.entity_id)} company={companies.find(c => c.id === open.issuing_company_id)}
    payments={payments.filter(p => p.invoice_id === open.id)} onBack={() => setOpenId(null)} reload={load} flash={flash} />

  const ready = types.filter(t => t.active && !invoices.some(i => i.invoice_type_id === t.id && i.status === 'draft'))
  return (
    <div>
      <p className="page-sub" style={{ margin: '0 0 12px', maxWidth: 760 }}>Build an invoice from a period's work, review it, approve it, and record payments. Approving gives it a number and locks the exact hours on it, so nothing is billed twice. Nothing is emailed from here: print or save it as a PDF, or download the data file, and send it yourself.</p>
      {err && <div className="login-err" role="alert">{err}</div>}
      <div style={{ ...panel, marginBottom: 14 }} data-ready>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Ready to build</h3>
          <button className="btn btn-primary" style={{ fontSize: 12.5 }} onClick={() => setBuilding({})}>+ Build an invoice</button>
        </div>
        {ready.length === 0 && <p className="page-sub" style={{ margin: 0 }}>Every invoice already has a draft open. Finish or delete it to build the next one.</p>}
        {ready.map(t => {
          const sp = suggestPeriod(t, invoices, today); const e = entityOf(t.entity_id)
          return (
            <div key={t.id} data-ready-row={`${e ? e.name : ''} ${t.name}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', borderTop: '1px solid var(--line)', padding: '8px 0' }}>
              <div><b>{t.name}</b> · {e ? e.name : ''}
                <div className="page-sub" style={{ margin: '2px 0 0' }}>{sp.lastEnd ? `Last invoiced through ${fmtDate(sp.lastEnd)}` : 'Not invoiced yet'}{next[t.id] ? ` · next invoice date ${fmtDate(next[t.id])}` : ''}</div></div>
              <button className="btn btn-ghost" style={{ fontSize: 12.5 }} onClick={() => setBuilding({ type: t.id, from: sp.from, to: sp.to })} aria-label={`Build ${t.name} for ${fmtDate(sp.from)} to ${fmtDate(sp.to)}`}>Build {fmtDate(sp.from)} – {fmtDate(sp.to)}</button>
            </div>)
        })}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        {[['all', 'All'], ['drafts', 'Drafts'], ['open', 'Awaiting payment'], ['paid', 'Paid in full'], ['void', 'Void']].map(([k, l]) => <button key={k} style={chip(filter === k)} onClick={() => setFilter(k)} aria-pressed={filter === k}>{l}</button>)}
        <input aria-label="Search invoices" placeholder="Search" value={q} onChange={e => setQ(e.target.value)} style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', minWidth: 180 }} />
      </div>
      {rows.length === 0 ? <p className="page-sub">No invoices yet.</p> : (
        <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }} data-invoice-table>
          <thead><tr><th style={th}>Number</th><th style={th}>Client</th><th style={th}>Invoice</th><th style={th}>Period</th><th style={th}>Invoice date</th><th style={th}>Due</th><th style={{ ...th, textAlign: 'right' }}>Total</th><th style={{ ...th, textAlign: 'right' }}>Balance</th><th style={th}>Status</th></tr></thead>
          <tbody>{rows.map(({ inv, balance }) => {
            const [label, cls] = invoiceStatus(inv, balance, today)
            return (
              <tr key={inv.id} data-invoice={inv.number || 'draft'} onClick={() => setOpenId(inv.id)} style={{ cursor: 'pointer' }}>
                <td style={td}><b>{inv.number || 'Draft'}</b></td><td style={td}>{(entityOf(inv.entity_id) || {}).name}</td><td style={td}>{(typeOf(inv.invoice_type_id) || {}).name}</td>
                <td style={td}>{fmtDate(inv.period_start)} – {fmtDate(inv.period_end)}</td><td style={td}>{fmtDate(inv.invoice_date)}</td><td style={td}>{fmtDate(inv.due_date)}</td>
                <td style={num}>{money(inv.total)}</td><td style={num}>{inv.status === 'approved' ? money(balance) : ''}</td><td style={td}><span className={cls}>{label}</span></td>
              </tr>)
          })}</tbody></table></div>)}
      {building && <BuildModal init={building} types={types.filter(t => t.active)} entities={entities} invoices={invoices} today={today} onClose={() => setBuilding(null)}
        onBuilt={async (id) => { setBuilding(null); await load(); setOpenId(id); flash('Draft built. Review it, fix anything flagged, then approve.') }} />}
    </div>
  )
}

export function Modal({ title, onClose, children, width = 560 }) {
  return (
    <div className="modal-back open" onClick={e => { if (e.target.classList.contains('modal-back')) onClose() }}>
      <div className="modal" style={{ width, maxHeight: '90vh', overflowY: 'auto' }} role="dialog" aria-label={title}>
        <h3 style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 600 }}>{title}</h3>
        {children}
      </div>
    </div>
  )
}

function BuildModal({ init, types, entities, invoices, today, onClose, onBuilt }) {
  const firstType = types.find(t => t.id === init.type)
  const [entityId, setEntityId] = useState(firstType ? firstType.entity_id : '')
  const [typeId, setTypeId] = useState(init.type || '')
  const [from, setFrom] = useState(init.from || '')
  const [to, setTo] = useState(init.to || '')
  const [date, setDate] = useState(today)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const myTypes = types.filter(t => t.entity_id === entityId)
  const pickType = (id) => { setTypeId(id); const t = types.find(x => x.id === id); if (t) { const sp = suggestPeriod(t, invoices, today); setFrom(sp.from); setTo(sp.to) } }
  async function build() {
    setErr('')
    if (!typeId) return setErr('Choose which invoice to build.')
    if (!from || !to) return setErr('Choose the first and last day this invoice covers.')
    if (to < from) return setErr('The last day cannot be before the first day.')
    setBusy(true)
    const { data, error } = await supabase.rpc('finance_invoice_build', { p_type: typeId, p_from: from, p_to: to, p_invoice_date: date || null })
    setBusy(false)
    if (error) return setErr(error.message)
    onBuilt(data)
  }
  return (
    <Modal title="Build an invoice" onClose={onClose}>
      {err && <div className="login-err" role="alert">{err}</div>}
      <div className="field"><label htmlFor="bi-entity">Client</label>
        <select id="bi-entity" value={entityId} onChange={e => { setEntityId(e.target.value); setTypeId(''); setFrom(''); setTo('') }}><option value="">Choose…</option>{entities.filter(e => types.some(t => t.entity_id === e.id)).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
      <div className="field"><label htmlFor="bi-type">Invoice</label>
        <select id="bi-type" value={typeId} onChange={e => pickType(e.target.value)} disabled={!entityId}><option value="">Choose…</option>{myTypes.map(t => <option key={t.id} value={t.id}>{t.name}{t.billing_method === 'coverage' ? ' (retainer)' : ''}</option>)}</select></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <div className="field"><label htmlFor="bi-from">First day</label><input id="bi-from" type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div className="field"><label htmlFor="bi-to">Last day</label><input id="bi-to" type="date" value={to} min={from} onChange={e => setTo(e.target.value)} /></div>
        <div className="field"><label htmlFor="bi-date">Invoice date</label><input id="bi-date" type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
      </div>
      <div className="hint">The draft is built from the hours in this period that are set to be invoiced on this invoice (and the retainer and flat fees, if it has them). You can review and change everything before approving.</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn btn-primary" onClick={build} disabled={busy}>{busy ? 'Building…' : 'Build the draft'}</button>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </Modal>
  )
}

function InvoicePage({ invoice: inv, type, entity, company, payments, onBack, reload, flash }) {
  const [lines, setLines] = useState([])
  const [extra, setExtra] = useState({ changes: null, undecided: null })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [det, setDet] = useState({ date: inv.invoice_date, terms: String(inv.terms_days), due: inv.due_date, notes: inv.notes || '' })
  const [edit, setEdit] = useState(null)       // { line, quantity, rate, product, description, reason }
  const [removing, setRemoving] = useState(null)
  const [adding, setAdding] = useState(false)
  const [add, setAdd] = useState({ product: '', description: '', quantity: '1', rate: '' })
  const [behind, setBehind] = useState({})     // line id -> rows | null
  const [approving, setApproving] = useState(false)
  const [voiding, setVoiding] = useState(false)
  const [voidWhy, setVoidWhy] = useState('')
  const [payForm, setPayForm] = useState({ date: todayET(), amount: '', method: '', note: '' })
  const draft = inv.status === 'draft'
  const today = todayET()
  const snap = inv.snapshot
  const paid = payments.reduce((s, p) => s + Number(p.amount), 0)
  const balance = Number(inv.total) - paid

  const loadAll = useCallback(async () => {
    const { data } = await supabase.from('finance_invoice_lines').select('*').eq('invoice_id', inv.id).order('sort')
    setLines(data || [])
    if (draft) {
      const [c, u] = await Promise.all([supabase.rpc('finance_invoice_changes', { p_invoice: inv.id }), supabase.rpc('finance_invoice_undecided', { p_invoice: inv.id })])
      setExtra({ changes: c.data, undecided: u.data })
    }
  }, [inv.id, draft])   // eslint-disable-line
  useEffect(() => { loadAll() }, [loadAll, inv.total])

  async function call(name, args, ok, after) {
    setErr(''); setBusy(true)
    const { data, error } = await supabase.rpc(name, args)
    setBusy(false)
    if (error) { setErr(error.message); return { ok: false, data: null } }
    if (ok) flash(typeof ok === 'function' ? ok(data) : ok)
    await reload(); await loadAll(); if (after) after(data)
    return { ok: true, data }
  }
  const flagged = lines.filter(l => l.flagged)
  const ch = extra.changes; const un = extra.undecided
  const changed = ch && (ch.added_entries > 0 || ch.removed_entries > 0 || ch.retainer_changed)
  const missing = [!(company && company.address) && 'address', !(company && company.email) && 'email', !(company && company.phone) && 'phone'].filter(Boolean)

  const view = snap || {
    number: null, invoice_date: inv.invoice_date, due_date: inv.due_date, terms_days: inv.terms_days, total: inv.total, notes: inv.notes, decimals: type && type.quantity_decimals != null ? type.quantity_decimals : 2,
    issuer: company ? { name: company.name, address: company.address, email: company.email, phone: company.phone, payment_instructions: company.payment_instructions } : {},
    bill_to: { name: entity ? (entity.legal_name || entity.name) : '', address: entity ? entity.bill_to_address : '' },
    ship_to: { name: entity ? (entity.legal_name || entity.name) : '', address: entity ? (entity.ship_to_address || entity.bill_to_address) : '' },
    lines: lines.map((l, i) => ({ line: i + 1, product_name: l.product_name, description: l.description, quantity: l.quantity, rate: l.rate, amount: l.amount })),
  }
  const dec = view.decimals ?? 2
  function printIt() {
    const w = window.open('', '_blank')
    if (!w) return setErr('Your browser blocked the print window. Allow pop-ups for this site and try again.')
    w.document.write(invoiceHtml(view, payments, draft)); w.document.close(); w.focus(); setTimeout(() => w.print(), 300)
    if (!draft) supabase.rpc('finance_log_export', { p_table: 'finance_invoices', p_row: inv.id, p_note: 'Printed or saved as PDF' })
  }
  function csv() {
    const { header, rows } = invoiceCsv(view); downloadCsv(`${view.number || 'draft-invoice'}.csv`, header, rows)
    if (!draft) supabase.rpc('finance_log_export', { p_table: 'finance_invoices', p_row: inv.id, p_note: 'Data file (CSV) downloaded' })
  }
  async function toggleBehind(l) {
    if (behind[l.id] !== undefined) { setBehind(b => { const n = { ...b }; delete n[l.id]; return n }); return }
    const { data } = await supabase.rpc('finance_invoice_line_breakdown', { p_line: l.id })
    setBehind(b => ({ ...b, [l.id]: data || [] }))
  }
  async function saveDetails() {
    await call('finance_invoice_set_details', { p_invoice: inv.id, p_invoice_date: det.date, p_due_date: det.due || null, p_terms_days: Number(det.terms), p_notes: det.notes }, 'Details saved.')
  }
  async function saveEdit() {
    const q = Number(edit.quantity), r = Number(edit.rate)
    if (edit.quantity === '' || edit.rate === '' || !Number.isFinite(q) || !Number.isFinite(r)) return setErr('Enter a quantity and a rate.')
    const entering = edit.line.kind === 'call' && Number(edit.line.quantity) === 0 && r === Number(edit.line.rate) && edit.product === edit.line.product_name
    const built = edit.line.kind !== 'manual' && !entering
    const changedFigure = q !== Number(edit.line.quantity) || r !== Number(edit.line.rate) || edit.product !== edit.line.product_name
    if (built && changedFigure && edit.reason.trim().length < 3) return setErr('Say why you are changing this figure. The original is kept with your reason.')
    const res = await call('finance_invoice_line_edit', { p_line: edit.line.id, p_quantity: q, p_rate: r, p_description: edit.description, p_product: edit.product, p_reason: edit.reason.trim() || null }, 'Line changed. The original is kept.')
    if (res.ok) setEdit(null)
  }
  async function saveRemove() {
    if (removing.kind !== 'manual' && (removing.reason || '').trim().length < 3) return setErr(removing.kind === 'call' ? 'Say why you are removing this line, for example that there were no calls.' : 'Say why you are removing this line. Its hours go back to be invoiced later.')
    const res = await call('finance_invoice_line_remove', { p_line: removing.id, p_reason: (removing.reason || '').trim() || null }, 'Line removed.')
    if (res.ok) setRemoving(null)
  }
  async function saveAdd() {
    const q = Number(add.quantity), r = Number(add.rate)
    if (!add.product.trim()) return setErr('Name the product or service.')
    if (add.quantity === '' || add.rate === '' || !Number.isFinite(q) || !Number.isFinite(r)) return setErr('Enter a quantity and a rate.')
    const res = await call('finance_invoice_line_add', { p_invoice: inv.id, p_product: add.product, p_description: add.description, p_quantity: q, p_rate: r }, 'Line added.')
    if (res.ok) { setAdding(false); setAdd({ product: '', description: '', quantity: '1', rate: '' }) }
  }
  async function approve(numberText) {
    const res = await call('finance_invoice_approve', { p_invoice: inv.id, p_number: numberText.trim() || null }, (v) => `Approved as ${v}. It is locked, and its hours are locked with it.`)
    if (res.ok) setApproving(false)
  }
  async function pay() {
    const a = Number(payForm.amount)
    if (payForm.amount === '' || !(a > 0)) return setErr('Enter the amount that was paid.')
    const res = await call('finance_invoice_payment_add', { p_invoice: inv.id, p_paid_on: payForm.date, p_amount: a, p_method: payForm.method || null, p_note: payForm.note || null }, 'Payment recorded.')
    if (res.ok) setPayForm({ date: today, amount: '', method: '', note: '' })
  }
  async function voidIt() {
    if (voidWhy.trim().length < 3) return setErr('Say why this invoice is being voided.')
    const res = await call('finance_invoice_void', { p_invoice: inv.id, p_reason: voidWhy.trim() }, 'Invoice voided. Its hours can be invoiced again.')
    if (res.ok) setVoiding(false)
  }
  const [stText, stCls] = invoiceStatus(inv, balance, today)

  return (
    <div data-invoice-page={inv.number || 'draft'}>
      <button className="btn btn-ghost" style={{ fontSize: 12.5, marginBottom: 10 }} onClick={onBack}>← All invoices</button>
      <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 2px' }}>{inv.number || 'Draft invoice'} <span className={stCls} style={{ marginLeft: 6, fontSize: 12 }}>{stText}</span></h2>
      <p className="page-sub" style={{ margin: '0 0 12px' }}>{entity ? entity.name : ''} · {type ? type.name : ''} · {fmtDate(inv.period_start)} – {fmtDate(inv.period_end)}</p>
      {err && <div className="login-err" role="alert">{err}</div>}
      {inv.status === 'void' && <div className="card" style={{ marginBottom: 12 }} data-void-note>This invoice is void: {inv.void_reason}. Its number stays used. Its hours can be invoiced again.</div>}

      {draft && (
        <div style={{ ...panel, marginBottom: 14 }} data-warnings>
          <b>{flagged.length > 0 || changed ? 'Needs your attention before you approve' : (un && Number(un.entries) > 0) || missing.length > 0 || (company && !company.payment_instructions) ? 'Ready to approve. Worth a look first:' : 'Ready to approve.'}</b>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {flagged.length > 0 && <li data-w="flagged">{flagged.length} line{flagged.length === 1 ? '' : 's'} flagged below. Set a rate or remove {flagged.length === 1 ? 'it' : 'them'}.</li>}
            {changed && <li data-w="changed">The work has changed since you built this draft ({ch.added_entries > 0 ? `${hrs(ch.added_seconds)} h added` : ''}{ch.added_entries > 0 && ch.removed_entries > 0 ? ', ' : ''}{ch.removed_entries > 0 ? `${hrs(ch.removed_seconds)} h removed` : ''}{ch.retainer_changed ? `${ch.added_entries > 0 || ch.removed_entries > 0 ? ', ' : ''}the retainer changed` : ''}). Rebuild it so the invoice matches the work.</li>}
            {un && Number(un.entries) > 0 && <li data-w="undecided">{hrs(un.seconds)} hours ({un.entries} entr{Number(un.entries) === 1 ? 'y' : 'ies'}) in this period are still not decided for this client's work ({un.clients}). They are not on this invoice. Decide them on the Hours tab, then rebuild.</li>}
            {missing.length > 0 && <li data-w="letterhead">The letterhead is missing {missing.join(', ')}{company ? ` for ${company.name}` : ''}. Add it under Settings, or the invoice will print without it.</li>}
            {company && !company.payment_instructions && <li data-w="payinstr">"Ways to pay" is empty for {company.name}. Add the payment instructions under Settings.</li>}
          </ul>
        </div>)}

      {draft && (
        <div style={{ ...panel, marginBottom: 14 }} data-details>
          <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>Invoice details</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <div className="field"><label htmlFor="iv-date">Invoice date</label><input id="iv-date" type="date" value={det.date} onChange={e => setDet({ ...det, date: e.target.value, due: e.target.value ? addDays(e.target.value, Number(det.terms) || 0) : det.due })} /></div>
            <div className="field"><label htmlFor="iv-terms">Terms (days)</label><input id="iv-terms" inputMode="numeric" value={det.terms} onChange={e => setDet({ ...det, terms: e.target.value, due: det.date && e.target.value !== '' ? addDays(det.date, Number(e.target.value) || 0) : det.due })} /></div>
            <div className="field"><label htmlFor="iv-due">Due date</label><input id="iv-due" type="date" value={det.due} onChange={e => setDet({ ...det, due: e.target.value })} /></div>
          </div>
          <div className="field"><label htmlFor="iv-notes">Note on the invoice (optional)</label><input id="iv-notes" value={det.notes} onChange={e => setDet({ ...det, notes: e.target.value })} /></div>
          <button className="btn btn-primary" onClick={saveDetails} disabled={busy}>Save details</button>
        </div>)}

      {!draft && snap && (
        <div style={{ ...panel, marginBottom: 14 }} data-snapshot>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            <div><b>{(snap.issuer || {}).name}</b><div className="page-sub" style={{ margin: 0, whiteSpace: 'pre-line' }}>{(snap.issuer || {}).address}{(snap.issuer || {}).email ? `\n${snap.issuer.email}` : ''}{(snap.issuer || {}).phone ? `\n${snap.issuer.phone}` : ''}</div></div>
            <div><b>Bill to</b><div className="page-sub" style={{ margin: 0, whiteSpace: 'pre-line' }}>{(snap.bill_to || {}).name}{'\n'}{(snap.bill_to || {}).address}</div></div>
            <div><b>Invoice details</b><div className="page-sub" style={{ margin: 0 }}>Invoice no. {snap.number}<br />Terms: Net {snap.terms_days}<br />Invoice date: {fmtDate(snap.invoice_date)}<br />Due date: {fmtDate(snap.due_date)}</div></div>
          </div>
        </div>)}

      <div style={{ overflowX: 'auto', marginBottom: 14 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }} data-lines>
          <thead><tr><th style={th}>#</th><th style={th}>Product or service</th><th style={th}>Description</th><th style={{ ...th, textAlign: 'right' }}>Qty</th><th style={{ ...th, textAlign: 'right' }}>Rate</th><th style={{ ...th, textAlign: 'right' }}>Amount</th>{draft && <th style={th}></th>}</tr></thead>
          <tbody>
            {(draft ? lines : (snap ? snap.lines : [])).map((l, i) => {
              const id = l.id; const rowNo = draft ? i + 1 : l.line
              return (
                <React.Fragment key={id || i}>
                  <tr data-line={l.product_name} style={l.flagged ? { background: 'var(--warn-bg, #fff7ed)' } : undefined}>
                    <td style={td}>{rowNo}.</td>
                    <td style={td}><b>{l.product_name}</b>{l.flagged && <div role="note" data-flag style={{ color: '#b45309', fontSize: 12.5, marginTop: 2 }}>⚠ {l.flagged}</div>}
                      {(draft ? l.original : (l.edited && l.original)) && <div className="page-sub" style={{ margin: '2px 0 0', fontSize: 12 }} data-edited>Changed from {fmtQty((draft ? l.original : l.original).quantity, dec)} × {money((l.original).rate)}{(draft ? l.edit_reason : l.edit_reason) ? `: ${l.edit_reason}` : ''}</div>}</td>
                    <td style={td}>{l.description}</td>
                    <td style={num}>{fmtQty(l.quantity, dec)}</td><td style={num}>{money(l.rate)}</td><td style={num}>{money(l.amount)}</td>
                    {draft && <td style={td}><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {l.kind === 'hours' && <button className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 8px' }} onClick={() => toggleBehind(l)} aria-label={`Show what is behind ${l.product_name}`}>{behind[l.id] !== undefined ? 'Hide' : "What's behind this"}</button>}
                      <button className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 8px' }} onClick={() => { setErr(''); setEdit({ line: l, quantity: String(Number(l.quantity)), rate: String(Number(l.rate)), product: l.product_name, description: l.description || '', reason: '' }) }} aria-label={`Edit ${l.product_name}`}>Edit</button>
                      <button className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 8px' }} onClick={() => { setErr(''); setRemoving({ ...l, reason: '' }) }} aria-label={`Remove ${l.product_name}`}>Remove</button>
                    </div></td>}
                  </tr>
                  {draft && behind[l.id] !== undefined && (
                    <tr data-behind><td></td><td colSpan={6} style={{ ...td, background: 'var(--surface-2, #f8fafc)' }}>
                      {behind[l.id].length === 0 ? 'Nothing recorded.' : behind[l.id].map(b => <div key={b.full_name}>{b.full_name}: {hrs(b.seconds)} h over {b.days} day{Number(b.days) === 1 ? '' : 's'} ({fmtDate(b.first_date)}{b.first_date !== b.last_date ? ` – ${fmtDate(b.last_date)}` : ''})</div>)}
                    </td></tr>)}
                </React.Fragment>)
            })}
            {draft && lines.length === 0 && <tr><td colSpan={7} style={td}>Nothing on this invoice yet. No hours in this period are set to be invoiced on it. Decide them on the Hours tab, or add a line below.</td></tr>}
          </tbody>
          <tfoot><tr><td colSpan={5} style={{ ...td, textAlign: 'right', fontWeight: 700 }}>Total</td><td style={{ ...num, fontWeight: 700 }} data-total>{money(inv.total)}</td>{draft && <td style={td}></td>}</tr></tfoot>
        </table>
      </div>

      {draft && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          <button className="btn btn-ghost" onClick={() => { setErr(''); setAdding(true) }}>+ Add a line</button>
          <button className="btn btn-ghost" onClick={() => { if (window.confirm('Rebuild the lines from the work? Any changes you made to built lines are discarded. Lines you added yourself stay.')) call('finance_invoice_rebuild', { p_invoice: inv.id }, 'Rebuilt from the work.') }} disabled={busy}>Rebuild from the work</button>
          <button className="btn btn-ghost" onClick={() => printIt()}>Preview / print</button>
          <button className="btn btn-ghost" onClick={() => { if (window.confirm('Delete this draft? Its hours go back to be invoiced later.')) call('finance_invoice_delete', { p_invoice: inv.id }, 'Draft deleted.', onBack) }} disabled={busy}>Delete draft</button>
          <button className="btn btn-primary" onClick={() => { setErr(''); setApproving(true) }} disabled={busy}>Approve…</button>
        </div>)}

      {!draft && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          {inv.status === 'approved' && <button className="btn btn-primary" onClick={printIt}>Print or save as PDF</button>}
          {inv.status === 'approved' && <button className="btn btn-ghost" onClick={csv}>Download the data file (CSV)</button>}
          {inv.status === 'approved' && payments.length === 0 && <button className="btn btn-ghost" onClick={() => { setErr(''); setVoiding(true) }}>Void this invoice</button>}
        </div>)}

      {inv.status === 'approved' && (
        <div style={{ ...panel, marginBottom: 14 }} data-payments>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: 16 }}>Payments</h3>
            <div data-balance style={{ fontWeight: 700 }}>{balance <= 0.004 ? <span className="badge passed">Paid in full</span> : <>Balance due {money(balance)}</>}</div>
          </div>
          {payments.length === 0 && <p className="page-sub" style={{ margin: '6px 0 0' }}>No payments yet.</p>}
          {payments.map(p => (
            <div key={p.id} data-payment style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', borderTop: '1px solid var(--line)', padding: '6px 0', marginTop: 6 }}>
              <span>{fmtDate(p.paid_on)} · <b>{money(p.amount)}</b>{p.method ? ` · ${p.method}` : ''}{p.note ? ` · ${p.note}` : ''}</span>
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 9px' }} onClick={() => { if (window.confirm('Remove this payment?')) call('finance_invoice_payment_remove', { p_payment: p.id }, 'Payment removed.') }} aria-label={`Remove the ${money(p.amount)} payment`}>Remove</button>
            </div>))}
          {balance > 0.004 && (
            <div style={{ borderTop: '1px solid var(--line)', marginTop: 8, paddingTop: 10 }} data-pay-form>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                <div className="field"><label htmlFor="pay-date">Paid on</label><input id="pay-date" type="date" value={payForm.date} onChange={e => setPayForm({ ...payForm, date: e.target.value })} /></div>
                <div className="field"><label htmlFor="pay-amt">Amount</label><input id="pay-amt" inputMode="decimal" value={payForm.amount} onChange={e => setPayForm({ ...payForm, amount: e.target.value })} placeholder={balance.toFixed(2)} /></div>
                <div className="field"><label htmlFor="pay-method">Method</label><input id="pay-method" value={payForm.method} onChange={e => setPayForm({ ...payForm, method: e.target.value })} placeholder="Check, ACH, card…" /></div>
                <div className="field"><label htmlFor="pay-note">Note</label><input id="pay-note" value={payForm.note} onChange={e => setPayForm({ ...payForm, note: e.target.value })} /></div>
              </div>
              <button className="btn btn-primary" onClick={pay} disabled={busy}>Record the payment</button>
              <button className="btn btn-ghost" style={{ marginLeft: 8 }} onClick={() => setPayForm({ ...payForm, amount: balance.toFixed(2) })}>Fill the full balance</button>
            </div>)}
        </div>)}

      {edit && (
        <Modal title={`Edit: ${edit.line.product_name}`} onClose={() => setEdit(null)}>
          {err && <div className="login-err" role="alert">{err}</div>}
          <div className="field"><label htmlFor="le-product">Product or service</label><input id="le-product" value={edit.product} onChange={e => setEdit({ ...edit, product: e.target.value })} /></div>
          <div className="field"><label htmlFor="le-desc">Description</label><input id="le-desc" value={edit.description} onChange={e => setEdit({ ...edit, description: e.target.value })} /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field"><label htmlFor="le-qty">Quantity</label><input id="le-qty" inputMode="decimal" value={edit.quantity} onChange={e => setEdit({ ...edit, quantity: e.target.value })} /></div>
            <div className="field"><label htmlFor="le-rate">Rate</label><input id="le-rate" inputMode="decimal" value={edit.rate} onChange={e => setEdit({ ...edit, rate: e.target.value })} /></div>
          </div>
          <div className="field"><label htmlFor="le-why">Why are you changing it?{edit.line.kind !== 'manual' && !(edit.line.kind === 'call' && Number(edit.line.quantity) === 0) ? ' *' : ''}</label><input id="le-why" value={edit.reason} onChange={e => setEdit({ ...edit, reason: e.target.value })} placeholder="e.g. rate agreed with the client" />
            <div className="hint">{edit.line.kind === 'call' && Number(edit.line.quantity) === 0 ? 'Enter the number of calls for this period in Quantity. No reason is needed for that.' : edit.line.kind !== 'manual' ? 'The original quantity, rate and your reason are kept on the invoice.' : 'This is a line you added, so no reason is needed.'} This changes this invoice only. To change the rate for future invoices, change it on the client's rate card.</div></div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}><button className="btn btn-primary" onClick={saveEdit} disabled={busy}>Save the change</button><button className="btn btn-ghost" onClick={() => setEdit(null)}>Cancel</button></div>
        </Modal>)}
      {removing && (
        <Modal title={`Remove: ${removing.product_name}`} onClose={() => setRemoving(null)} width={460}>
          {err && <div className="login-err" role="alert">{err}</div>}
          <p className="page-sub" style={{ marginTop: 0 }}>{removing.kind === 'manual' ? 'This line was added by hand.' : removing.kind === 'call' ? 'Use this when there were no calls to bill this period.' : 'Its hours go back to be invoiced later.'}</p>
          {removing.kind !== 'manual' && <div className="field"><label htmlFor="lr-why">Why are you removing it? *</label><input id="lr-why" value={removing.reason} onChange={e => setRemoving({ ...removing, reason: e.target.value })} /></div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}><button className="btn btn-primary" onClick={saveRemove} disabled={busy}>Remove the line</button><button className="btn btn-ghost" onClick={() => setRemoving(null)}>Cancel</button></div>
        </Modal>)}
      {adding && (
        <Modal title="Add a line" onClose={() => setAdding(false)}>
          {err && <div className="login-err" role="alert">{err}</div>}
          <div className="field"><label htmlFor="la-product">Product or service *</label><input id="la-product" value={add.product} onChange={e => setAdd({ ...add, product: e.target.value })} placeholder="e.g. AI QA Calls, one-off fee, credit" /></div>
          <div className="field"><label htmlFor="la-desc">Description</label><input id="la-desc" value={add.description} onChange={e => setAdd({ ...add, description: e.target.value })} placeholder="e.g. Apple Door" /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field"><label htmlFor="la-qty">Quantity</label><input id="la-qty" inputMode="decimal" value={add.quantity} onChange={e => setAdd({ ...add, quantity: e.target.value })} /></div>
            <div className="field"><label htmlFor="la-rate">Rate</label><input id="la-rate" inputMode="decimal" value={add.rate} onChange={e => setAdd({ ...add, rate: e.target.value })} /></div>
          </div>
          <div className="hint">Use a negative rate for a credit or a discount.</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}><button className="btn btn-primary" onClick={saveAdd} disabled={busy}>Add the line</button><button className="btn btn-ghost" onClick={() => setAdding(false)}>Cancel</button></div>
        </Modal>)}
      {approving && <ApproveModal inv={inv} type={type} lines={lines} err={err} busy={busy} onClose={() => setApproving(false)} onApprove={approve} />}
      {voiding && (
        <Modal title="Void this invoice" onClose={() => setVoiding(false)} width={460}>
          {err && <div className="login-err" role="alert">{err}</div>}
          <p className="page-sub" style={{ marginTop: 0 }}>A voided invoice keeps its number. Its hours go back to be invoiced again. If a client was already charged, record a credit instead.</p>
          <div className="field"><label htmlFor="vd-why">Why is it being voided? *</label><input id="vd-why" value={voidWhy} onChange={e => setVoidWhy(e.target.value)} /></div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}><button className="btn btn-primary" onClick={voidIt} disabled={busy}>Void the invoice</button><button className="btn btn-ghost" onClick={() => setVoiding(false)}>Cancel</button></div>
        </Modal>)}
    </div>
  )
}

function ApproveModal({ inv, type, lines, err, busy, onClose, onApprove }) {
  const [preview, setPreview] = useState('')
  const [custom, setCustom] = useState('')
  useEffect(() => { supabase.rpc('finance_invoice_number_preview', { p_type: inv.invoice_type_id, p_date: inv.invoice_date }).then(({ data }) => setPreview(data || '')) }, [inv.invoice_type_id, inv.invoice_date])
  return (
    <Modal title="Approve this invoice" onClose={onClose} width={500}>
      {err && <div className="login-err" role="alert">{err}</div>}
      <p style={{ marginTop: 0 }}>This will be invoice <b data-preview>{custom.trim() || preview}</b> for <b>{money(inv.total)}</b>, with {lines.length} line{lines.length === 1 ? '' : 's'}.</p>
      <p className="page-sub">Approving locks this invoice and the exact hours on it. After that, fixes are made with a credit or a corrected invoice.</p>
      <div className="field"><label htmlFor="ap-number">Use a different number (optional)</label><input id="ap-number" value={custom} onChange={e => setCustom(e.target.value)} placeholder={preview} />
        <div className="hint">Leave blank to use the next number{type ? ` for ${type.name}` : ''}.</div></div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}><button className="btn btn-primary" onClick={() => onApprove(custom)} disabled={busy}>Approve and lock</button><button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button></div>
    </Modal>
  )
}
