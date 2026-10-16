import React, { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { ACCEPT, money, todayET, fmtDate, StatusBadge, receiptProblem, uploadReceipt, openReceipt, Toast, panel } from './financeBits'

// ============================================================
// SUBMIT A PURCHASE
// A simple form for people who pay for something on behalf of the business (an ad, a tool, supplies...).
// Everything they send lands in an owner-only inbox in the Finance area. They only ever see their own
// submissions and a status; no budgets, no one else's purchases, no financial figures.
// Who can open this page is decided by the database (Admins and Owners, plus the roles owners choose).
// ============================================================

const blank = () => ({
  item: '', vendor: '', amount: '', purchase_date: todayET(), paid_with: '', company_id: '', client_id: '',
  category_id: '', purpose: '', notes: '', reimburse: false, noReceipt: false, no_receipt_reason: '',
})

export default function SubmitPurchase() {
  const { user } = useAuth()
  const uid = user?.id
  const [options, setOptions] = useState(null)
  const [mine, setMine] = useState([])
  const [f, setF] = useState(blank())
  const [file, setFile] = useState(null)
  const [editing, setEditing] = useState(null)   // a returned submission being fixed
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [toast, setToast] = useState('')
  const fileRef = useRef(null)

  const loadMine = useCallback(async () => {
    const { data } = await supabase.from('finance_submissions').select('*').order('created_at', { ascending: false }).limit(100)
    setMine(data || [])
  }, [])

  useEffect(() => {
    let alive = true
    supabase.rpc('finance_submit_options').then(({ data, error }) => {
      if (!alive) return
      if (error) setErr('Could not load the form choices. Please refresh the page.')
      else setOptions(data)
    })
    loadMine()
    return () => { alive = false }
  }, [loadMine])

  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }))
  const flash = (t) => { setToast(t); setTimeout(() => setToast(''), 3500) }
  const nameOf = (list, id) => (list || []).find(x => x.id === id)?.name || (list || []).find(x => x.id === id)?.label || ''

  function reset() {
    setF(blank()); setFile(null); setEditing(null); setErr('')
    if (fileRef.current) fileRef.current.value = ''
  }

  function startEdit(s) {
    setEditing(s); setErr('')
    setF({
      item: s.item || '', vendor: s.vendor || '', amount: String(s.amount ?? ''), purchase_date: s.purchase_date || todayET(),
      paid_with: s.paid_with || '', company_id: s.company_id || '', client_id: s.client_id || '',
      category_id: s.category_id || '', purpose: s.purpose || '', notes: s.notes || '', reimburse: !!s.reimburse,
      noReceipt: !s.receipt_path, no_receipt_reason: s.no_receipt_reason || '',
    })
    setFile(null)
    window.scrollTo?.({ top: 0, behavior: 'smooth' })
  }

  function onFile(e) {
    const picked = e.target.files?.[0] || null
    const problem = receiptProblem(picked)
    if (problem) { setErr(problem); setFile(null); if (fileRef.current) fileRef.current.value = ''; return }
    setErr(''); setFile(picked)
    if (picked) set('noReceipt', false)
  }

  async function submit() {
    setErr('')
    const amount = Number(String(f.amount).replace(/[$,\s]/g, ''))
    if (!f.item.trim()) return setErr('Tell us what was bought.')
    if (!f.vendor.trim()) return setErr('Who was it paid to? Add the vendor or store.')
    if (!(amount > 0)) return setErr('Enter the amount, for example 45.00.')
    if (!f.purchase_date) return setErr('Choose the date of the purchase.')
    if (!f.paid_with) return setErr('Choose how it was paid.')
    if (!f.purpose.trim()) return setErr('Add a short business reason, such as "Facebook ad for the October promotion".')
    const hasReceipt = !!file || (editing && editing.receipt_path && !f.noReceipt)
    if (!hasReceipt && !(f.noReceipt && f.no_receipt_reason.trim())) {
      return setErr('Attach the receipt, or tick "I don\'t have a receipt" and say why.')
    }
    setBusy(true)
    try {
      let receipt_path = editing?.receipt_path || null
      if (file) receipt_path = await uploadReceipt(file, `submissions/${uid}`)
      const row = {
        item: f.item.trim(), vendor: f.vendor.trim(), amount, purchase_date: f.purchase_date, paid_with: f.paid_with,
        company_id: f.company_id || null, client_id: f.client_id || null, category_id: f.category_id || null,
        category_unsure: !f.category_id, purpose: f.purpose.trim(), notes: f.notes.trim() || null, reimburse: !!f.reimburse,
        receipt_path: (f.noReceipt && !file) ? null : receipt_path,
        no_receipt_reason: (f.noReceipt && !file) ? f.no_receipt_reason.trim() : null,
      }
      if (editing) {
        const { error } = await supabase.from('finance_submissions').update({ ...row, status: 'received' }).eq('id', editing.id)
        if (error) throw error
        flash('Updated and sent back for review.')
      } else {
        const { error } = await supabase.from('finance_submissions').insert({ ...row, submitted_by: uid })
        if (error) throw error
        flash('Submitted. The owners have been notified.')
      }
      reset()
      await loadMine()
    } catch (e) {
      setErr(e?.message ? `Could not submit: ${e.message}` : 'Could not submit. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!options && !err) return <p className="page-sub">Loading…</p>

  const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0 16px' }
  const personalPaid = /personal|own/i.test(f.paid_with)

  return (
    <div style={{ maxWidth: 900 }}>
      <h1 className="page-title">Submit a purchase</h1>
      <p className="page-sub">Paid for something for the business? Fill this in and attach the receipt. It goes straight to the owners, and you can follow its status below.</p>

      {editing && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--failed)' }}>
          <b>This one was sent back to you.</b>
          {editing.owner_message && <p style={{ margin: '6px 0 0' }}>{editing.owner_message}</p>}
          <button className="btn btn-ghost" style={{ marginTop: 10, fontSize: 12.5 }} onClick={reset}>Cancel and start a new one instead</button>
        </div>
      )}

      <div style={{ ...panel, marginBottom: 28 }}>
        {err && <div className="login-err" role="alert" style={{ marginBottom: 14 }}>{err}</div>}
        <div style={grid}>
          <div className="field"><label htmlFor="sp-item">What did you buy? *</label>
            <input id="sp-item" value={f.item} onChange={e => set('item', e.target.value)} placeholder="e.g. Facebook ad, 7 days" /></div>
          <div className="field"><label htmlFor="sp-vendor">Vendor or store *</label>
            <input id="sp-vendor" value={f.vendor} onChange={e => set('vendor', e.target.value)} placeholder="e.g. Meta" /></div>
          <div className="field"><label htmlFor="sp-amount">Amount (USD) *</label>
            <input id="sp-amount" inputMode="decimal" value={f.amount} onChange={e => set('amount', e.target.value)} placeholder="0.00" /></div>
          <div className="field"><label htmlFor="sp-date">Date of purchase *</label>
            <input id="sp-date" type="date" value={f.purchase_date} onChange={e => set('purchase_date', e.target.value)} /></div>
          <div className="field"><label htmlFor="sp-paid">How was it paid? *</label>
            <select id="sp-paid" value={f.paid_with} onChange={e => set('paid_with', e.target.value)}>
              <option value="">Choose…</option>
              {(options?.payment_methods || []).map(m => <option key={m} value={m}>{m}</option>)}
            </select></div>
          <div className="field"><label htmlFor="sp-company">Which company is it for?</label>
            <select id="sp-company" value={f.company_id} onChange={e => set('company_id', e.target.value)}>
              <option value="">Not sure</option>
              {(options?.companies || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>
          <div className="field"><label htmlFor="sp-client">Is it for a particular client?</label>
            <select id="sp-client" value={f.client_id} onChange={e => set('client_id', e.target.value)}>
              <option value="">No, general business</option>
              {(options?.clients || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>
          <div className="field"><label htmlFor="sp-category">Category</label>
            <select id="sp-category" value={f.category_id} onChange={e => set('category_id', e.target.value)}>
              <option value="">Not sure</option>
              {(options?.categories || []).map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select></div>
        </div>

        <div className="field"><label htmlFor="sp-purpose">Why was it needed? *</label>
          <textarea id="sp-purpose" rows={2} value={f.purpose} onChange={e => set('purpose', e.target.value)} placeholder="A short business reason" /></div>
        <div className="field"><label htmlFor="sp-notes">Anything else? <span style={{ fontWeight: 400 }}>(optional)</span></label>
          <textarea id="sp-notes" rows={2} value={f.notes} onChange={e => set('notes', e.target.value)} /></div>

        <div className="field">
          <label htmlFor="sp-file">Receipt *</label>
          <input id="sp-file" ref={fileRef} type="file" accept={ACCEPT} onChange={onFile} disabled={f.noReceipt && !file} />
          <div className="hint">
            {file ? `Attached: ${file.name}` : editing?.receipt_path && !f.noReceipt ? 'A receipt is already attached. Choose a file only to replace it.' : 'A photo from your phone or a PDF, up to 15 MB.'}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontWeight: 500, color: 'var(--ink)' }}>
            <input type="checkbox" checked={f.noReceipt} disabled={!!file} onChange={e => set('noReceipt', e.target.checked)} />
            I don't have a receipt
          </label>
          {f.noReceipt && !file && (
            <textarea aria-label="Why there is no receipt" rows={2} style={{ marginTop: 8 }} value={f.no_receipt_reason}
              onChange={e => set('no_receipt_reason', e.target.value)} placeholder="Why is there no receipt?" />
          )}
        </div>

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 16, fontWeight: 500, color: 'var(--ink)' }}>
          <input type="checkbox" checked={f.reimburse} onChange={e => set('reimburse', e.target.checked)} style={{ marginTop: 3 }} />
          <span>I paid with my own money. Please reimburse me.
            {personalPaid && !f.reimburse && <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-soft)', fontWeight: 400 }}>You chose a personal payment. Tick this if you want to be paid back.</span>}
          </span>
        </label>

        <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? 'Sending…' : editing ? 'Update and resubmit' : 'Submit purchase'}</button>
      </div>

      <h2 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 12px' }}>My submissions</h2>
      {mine.length === 0 ? (
        <p className="page-sub">Nothing submitted yet.</p>
      ) : mine.map(s => (
        <div key={s.id} style={{ ...panel, marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{s.item}</div>
              <div className="page-sub" style={{ margin: '2px 0 0' }}>
                {s.vendor} · {money(s.amount)} · {fmtDate(s.purchase_date)}
                {s.company_id ? ` · ${nameOf(options?.companies, s.company_id)}` : ''}
                {s.reimburse ? ' · reimbursement requested' : ''}
              </div>
            </div>
            <StatusBadge status={s.status} />
          </div>
          {s.owner_message && (s.status === 'needs_info' || s.status === 'rejected') && (
            <p style={{ margin: '10px 0 0', fontSize: 13.5 }}><b>{s.status === 'rejected' ? 'Reason: ' : 'The owners asked: '}</b>{s.owner_message}</p>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            {s.receipt_path && <button className="btn btn-ghost" style={{ fontSize: 12.5, padding: '6px 12px' }}
              onClick={() => openReceipt(s.receipt_path).catch(() => setErr('Could not open that receipt.'))}>View receipt</button>}
            {s.status === 'needs_info' && <button className="btn btn-primary" style={{ fontSize: 12.5, padding: '6px 12px' }} onClick={() => startEdit(s)}>Edit and resubmit</button>}
          </div>
        </div>
      ))}
      <Toast text={toast} />
    </div>
  )
}
