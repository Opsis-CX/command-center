import React, { useState } from 'react'
import { supabase } from '../lib/supabase'
import { panel } from './financeBits'

// ============================================================
// FINANCE SETTINGS (Admins and Owners)
// Everything a business owner needs to change lives here, so nothing needs a developer:
// the companies the books are kept for, the expense and income categories, the "how was it paid" choices,
// and which roles may use the Submit a purchase form.
// ============================================================

const SUBMIT_ROLES = [['certification', 'Certification'], ['asc', 'ASC'], ['support', 'Support'], ['quality', 'Quality'], ['marketing', 'Marketing'], ['sales', 'Sales'], ['agent', 'Agents']]

function Modal({ title, onClose, children, width = 520 }) {
  return (
    <div className="modal-back open" onClick={e => { if (e.target.classList.contains('modal-back')) onClose() }}>
      <div className="modal" style={{ width }} role="dialog" aria-label={title}>
        <h3 style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 600 }}>{title}</h3>
        {children}
      </div>
    </div>
  )
}

const section = { ...panel, marginBottom: 20 }
const h2 = { fontSize: 16, fontWeight: 700, margin: '0 0 4px' }

export default function FinanceSettings({ lookups, reload, flash }) {
  return (
    <div>
      <Companies lookups={lookups} reload={reload} flash={flash} />
      <Categories lookups={lookups} reload={reload} flash={flash} />
      <PaymentMethods lookups={lookups} reload={reload} flash={flash} />
      <SubmitRoles lookups={lookups} reload={reload} flash={flash} />
    </div>
  )
}

// ---------- Companies ----------
function Companies({ lookups, reload, flash }) {
  const [edit, setEdit] = useState(null)
  return (
    <div style={section}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div><h2 style={h2}>Companies</h2><p className="page-sub" style={{ margin: 0 }}>The companies you keep books for. Each one can have its own letterhead details for invoices.</p></div>
        <button className="btn btn-primary" onClick={() => setEdit({})}>+ Add company</button>
      </div>
      <div style={{ marginTop: 12 }}>
        {lookups.companies.map(c => (
          <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--line)', opacity: c.active ? 1 : 0.55 }}>
            <div><div style={{ fontWeight: 600 }}>{c.name}{!c.active && <span className="badge failed" style={{ marginLeft: 8 }}>inactive</span>}</div>
              <div className="page-sub" style={{ margin: 0 }}>{[c.legal_name, c.email, c.phone].filter(Boolean).join(' · ') || 'Letterhead details not entered yet'}</div></div>
            <button className="btn btn-ghost" style={{ fontSize: 12.5, padding: '6px 12px' }} onClick={() => setEdit(c)}>Edit</button>
          </div>
        ))}
      </div>
      {edit && <CompanyModal c={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); flash('Company saved.') }} />}
    </div>
  )
}

function CompanyModal({ c, onClose, onSaved }) {
  const [f, setF] = useState({ name: c.name || '', legal_name: c.legal_name || '', address: c.address || '', email: c.email || '', phone: c.phone || '', payment_instructions: c.payment_instructions || '', active: c.active !== false })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  async function save() {
    if (!f.name.trim()) return setErr('The company needs a name.')
    setBusy(true); setErr('')
    const row = { name: f.name.trim(), legal_name: f.legal_name.trim() || null, address: f.address.trim() || null, email: f.email.trim() || null, phone: f.phone.trim() || null, payment_instructions: f.payment_instructions.trim() || null, active: f.active }
    const { error } = c.id ? await supabase.from('finance_companies').update(row).eq('id', c.id) : await supabase.from('finance_companies').insert(row)
    setBusy(false)
    if (error) return setErr(error.code === '23505' ? 'A company with that name already exists.' : error.message)
    onSaved()
  }
  return (
    <Modal title={c.id ? 'Edit company' : 'Add a company'} onClose={onClose}>
      {err && <div className="login-err" role="alert">{err}</div>}
      <div className="field"><label htmlFor="co-name">Name *</label><input id="co-name" value={f.name} onChange={e => set('name', e.target.value)} /></div>
      <div className="field"><label htmlFor="co-legal">Legal name (for invoices)</label><input id="co-legal" value={f.legal_name} onChange={e => set('legal_name', e.target.value)} /></div>
      <div className="field"><label htmlFor="co-addr">Address</label><textarea id="co-addr" rows={2} value={f.address} onChange={e => set('address', e.target.value)} /></div>
      <div className="field"><label htmlFor="co-email">Email</label><input id="co-email" value={f.email} onChange={e => set('email', e.target.value)} /></div>
      <div className="field"><label htmlFor="co-phone">Phone</label><input id="co-phone" value={f.phone} onChange={e => set('phone', e.target.value)} /></div>
      <div className="field"><label htmlFor="co-pay">Payment instructions (shown on invoices)</label><textarea id="co-pay" rows={2} value={f.payment_instructions} onChange={e => set('payment_instructions', e.target.value)} /></div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 500 }}><input type="checkbox" checked={f.active} onChange={e => set('active', e.target.checked)} /> Active</label>
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </Modal>
  )
}

// ---------- Categories ----------
function Categories({ lookups, reload, flash }) {
  const [edit, setEdit] = useState(null)
  const cats = lookups.categories
  const tops = cats.filter(c => !c.parent_id)
  return (
    <div style={section}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div><h2 style={h2}>Categories</h2><p className="page-sub" style={{ margin: 0 }}>How money is grouped, with sections inside each category. Map each to the label your accountant uses for taxes. Categories are retired, never deleted, so old records keep their names.</p></div>
        <button className="btn btn-primary" onClick={() => setEdit({})}>+ Add category</button>
      </div>
      {['expense', 'income'].map(kind => (
        <div key={kind} style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>{kind === 'expense' ? 'Expenses' : 'Income'}</div>
          {tops.filter(t => t.kind === kind).map(t => (
            <div key={t.id}>
              <Row c={t} onEdit={() => setEdit(t)} />
              {cats.filter(x => x.parent_id === t.id).map(ch => <Row key={ch.id} c={ch} child onEdit={() => setEdit(ch)} />)}
            </div>
          ))}
        </div>
      ))}
      {edit && <CategoryModal c={edit} tops={tops} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); flash('Category saved.') }} />}
    </div>
  )
}
function Row({ c, child, onEdit }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', paddingLeft: child ? 24 : 0, borderTop: '1px solid var(--line)', opacity: c.active ? 1 : 0.5 }}>
      <div><span style={{ fontWeight: child ? 500 : 600 }}>{c.name}</span>
        {c.tax_category && <span className="page-sub" style={{ margin: '0 0 0 8px' }}>tax: {c.tax_category}</span>}
        {!c.active && <span className="badge failed" style={{ marginLeft: 8 }}>retired</span>}</div>
      <button className="btn btn-ghost" style={{ fontSize: 12.5, padding: '5px 11px' }} onClick={onEdit}>Edit</button>
    </div>
  )
}
function CategoryModal({ c, tops, onClose, onSaved }) {
  const [f, setF] = useState({ name: c.name || '', parent_id: c.parent_id || '', kind: c.kind || 'expense', tax_category: c.tax_category || '', active: c.active !== false, sort: c.sort ?? 0 })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  async function save() {
    if (!f.name.trim()) return setErr('The category needs a name.')
    setBusy(true); setErr('')
    const row = { name: f.name.trim(), parent_id: f.parent_id || null, kind: f.parent_id ? (tops.find(t => t.id === f.parent_id)?.kind || f.kind) : f.kind, tax_category: f.tax_category.trim() || null, active: f.active, sort: Number(f.sort) || 0 }
    const { error } = c.id ? await supabase.from('finance_categories').update(row).eq('id', c.id) : await supabase.from('finance_categories').insert(row)
    setBusy(false)
    if (error) return setErr(error.code === '23505' ? 'That category already exists there.' : error.message)
    onSaved()
  }
  return (
    <Modal title={c.id ? 'Edit category' : 'Add a category'} onClose={onClose}>
      {err && <div className="login-err" role="alert">{err}</div>}
      <div className="field"><label htmlFor="ca-name">Name *</label><input id="ca-name" value={f.name} onChange={e => set('name', e.target.value)} /></div>
      <div className="field"><label htmlFor="ca-parent">Sits inside</label>
        <select id="ca-parent" value={f.parent_id} onChange={e => set('parent_id', e.target.value)}>
          <option value="">Nothing (a top-level category)</option>{tops.filter(t => t.id !== c.id).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select></div>
      {!f.parent_id && <div className="field"><label htmlFor="ca-kind">Type</label>
        <select id="ca-kind" value={f.kind} onChange={e => set('kind', e.target.value)}><option value="expense">Expense</option><option value="income">Income</option></select></div>}
      <div className="field"><label htmlFor="ca-tax">Tax category (your accountant's label)</label><input id="ca-tax" value={f.tax_category} onChange={e => set('tax_category', e.target.value)} placeholder="e.g. Advertising" /></div>
      <div className="field"><label htmlFor="ca-sort">Order (smaller shows first)</label><input id="ca-sort" inputMode="numeric" value={f.sort} onChange={e => set('sort', e.target.value)} /></div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 500 }}><input type="checkbox" checked={f.active} onChange={e => set('active', e.target.checked)} /> In use (untick to retire it)</label>
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </Modal>
  )
}

// ---------- Payment methods ----------
function PaymentMethods({ lookups, reload, flash }) {
  const current = (lookups.settings.payment_methods || []).join('\n')
  const [text, setText] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const value = text ?? current
  async function save() {
    const list = value.split('\n').map(s => s.trim()).filter(Boolean)
    if (!list.length) return setErr('Keep at least one choice.')
    setBusy(true); setErr('')
    const { error } = await supabase.from('finance_settings').upsert({ key: 'payment_methods', value: list, description: 'Choices for "how was it paid" on the Submit a purchase form.' }, { onConflict: 'key' })
    setBusy(false)
    if (error) return setErr(error.message)
    setText(null); reload(); flash('Payment choices saved.')
  }
  return (
    <div style={section}>
      <h2 style={h2}>How it was paid</h2>
      <p className="page-sub" style={{ margin: '0 0 10px' }}>The choices people see on the Submit a purchase form. One per line.</p>
      {err && <div className="login-err" role="alert">{err}</div>}
      <textarea aria-label="Payment choices" rows={5} style={{ width: '100%', padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', fontFamily: 'inherit', fontSize: 14 }} value={value} onChange={e => setText(e.target.value)} />
      <div style={{ marginTop: 10 }}><button className="btn btn-primary" onClick={save} disabled={busy || text == null}>{busy ? 'Saving…' : 'Save choices'}</button></div>
    </div>
  )
}

// ---------- Who can submit ----------
function SubmitRoles({ lookups, reload, flash }) {
  const saved = (lookups.settings.purchase_submit_roles || []).map(r => String(r).toLowerCase())
  const [sel, setSel] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const chosen = sel ?? saved.filter(r => r !== 'admin' && r !== 'owner')
  const toggle = (r) => setSel(chosen.includes(r) ? chosen.filter(x => x !== r) : [...chosen, r])
  async function save() {
    setBusy(true); setErr('')
    const { error } = await supabase.from('finance_settings').upsert({ key: 'purchase_submit_roles', value: ['admin', 'owner', ...chosen], description: 'Roles that can open the Submit a purchase form. Owners and Admins can always open it.' }, { onConflict: 'key' })
    setBusy(false)
    if (error) return setErr(error.message)
    setSel(null); reload(); flash('Saved. The change applies right away.')
  }
  return (
    <div style={section}>
      <h2 style={h2}>Who can submit purchases</h2>
      <p className="page-sub" style={{ margin: '0 0 10px' }}>Owners and Admins can always submit. Choose which other roles can open the Submit a purchase form. They can only ever see their own submissions.</p>
      {err && <div className="login-err" role="alert">{err}</div>}
      <div className="tag-picker" style={{ marginBottom: 12 }}>
        <span className="tag-opt on" aria-disabled="true">Admin and Owner (always)</span>
        {SUBMIT_ROLES.map(([k, label]) => <button key={k} type="button" className={'tag-opt' + (chosen.includes(k) ? ' on' : '')} aria-pressed={chosen.includes(k)} onClick={() => toggle(k)}>{label}</button>)}
      </div>
      <button className="btn btn-primary" onClick={save} disabled={busy || sel == null}>{busy ? 'Saving…' : 'Save'}</button>
    </div>
  )
}
