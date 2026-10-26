import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtDate } from './financeBits'
import { Modal } from './FinanceInvoices'

// ============================================================
// CONTRACT BUILDER (Admins and Owners)
// Templates with {{fields}} -> a draft for one client (editable) -> final (wording locked, no blanks left) -> signed
// (the signed file is attached from the client's Documents) or void. Printing uses the browser's "Save as PDF".
// Starter templates are only starting points: have an attorney review any contract before use.
// ============================================================

export const CONTRACT_STATUS = { draft: 'Draft', final: 'Final', signed: 'Signed', void: 'Void' }
const BADGE = { draft: 'badge needed', final: 'badge', signed: 'badge passed', void: 'badge failed' }
const LONG_FIELDS = ['rates', 'invoice_schedule', 'what_changes']
const FIELD_HELP = ['client_name', 'client_legal_name', 'client_address', 'client_contact', 'client_email', 'company_name', 'company_address', 'company_email', 'company_phone', 'payment_terms', 'invoice_schedule', 'rates', 'today', 'effective_date']

export const blanksOf = (text) => [...new Set([...(text || '').matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)].map(m => m[1]))].sort()
const labelOf = (k) => { const s = k.replace(/_/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1) }
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// the simple formatting: "# " heading, "## " subheading, "- " bullet, a blank line between paragraphs, **bold**
export function renderContractBody(text) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  const out = []; let list = []; let para = []
  const flushList = () => { if (list.length) { out.push('<ul>' + list.map(l => `<li>${inline(l)}</li>`).join('') + '</ul>'); list = [] } }
  const flushPara = () => { if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = [] } }
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (/^##\s+/.test(line)) { flushList(); flushPara(); out.push(`<h2>${inline(line.replace(/^##\s+/, ''))}</h2>`) }
    else if (/^#\s+/.test(line)) { flushList(); flushPara(); out.push(`<h1>${inline(line.replace(/^#\s+/, ''))}</h1>`) }
    else if (/^-\s+/.test(line)) { flushPara(); list.push(line.replace(/^-\s+/, '')) }
    else if (line.trim() === '') { flushList(); flushPara() }
    else { flushList(); para.push(line) }
  }
  flushList(); flushPara()
  return out.join('\n')
}
export function contractHtml(c) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(c.title)}</title><style>
  @page { margin: 0.9in }
  body { font-family: Georgia, 'Times New Roman', serif; color: #111; line-height: 1.5; font-size: 12.5pt; max-width: 7in; margin: 0 auto }
  h1 { font-size: 20pt; text-align: center; margin: 0 0 18pt } h2 { font-size: 13pt; margin: 16pt 0 4pt } p { margin: 0 0 9pt } ul { margin: 0 0 9pt 18pt; padding: 0 } li { margin: 0 0 3pt }
  .draft { color: #b45309; text-align: center; font: 600 10pt sans-serif; margin-bottom: 10pt }
  </style></head><body>${c.status === 'draft' ? '<div class="draft">DRAFT. Not yet final.</div>' : ''}${renderContractBody(c.body)}</body></html>`
}
function printContract(c) {
  const w = window.open('', '_blank'); if (!w) return false
  w.document.write(contractHtml(c)); w.document.close(); w.focus(); setTimeout(() => w.print(), 300)
  return true
}

const btnS = { fontSize: 12, padding: '3px 9px' }

export default function ContractsSection({ client, contracts, templates, documents, reload, flash, onUploadSigned }) {
  const [builder, setBuilder] = useState(false)
  const [tpls, setTpls] = useState(false)
  const [open, setOpen] = useState(null)       // contract id
  const [err, setErr] = useState('')
  const rows = [...contracts].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  const current = open ? contracts.find(c => c.id === open) : null
  const tplName = (id) => (templates.find(t => t.id === id) || {}).name
  async function copy(c) {
    const { data, error } = await supabase.rpc('finance_contract_copy', { p_id: c.id })
    if (error) return setErr(error.message)
    setErr(''); flash('New draft made from this contract.'); await reload(); setOpen(data)
  }
  return (
    <div data-contracts style={{ borderTop: '1px solid var(--line)', marginTop: 10, paddingTop: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>Contracts built here</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" style={{ fontSize: 12.5 }} onClick={() => setTpls(true)}>Templates</button>
          <button className="btn btn-primary" style={{ fontSize: 12.5 }} onClick={() => { setErr(''); setBuilder(true) }}>+ Build a contract</button>
        </div>
      </div>
      {err && <div className="login-err" role="alert">{err}</div>}
      {rows.length === 0 && <p className="page-sub" style={{ margin: '4px 0 0' }}>None yet. Build one from a template, with this client's details and rates filled in for you.</p>}
      {rows.map(c => (
        <div key={c.id} data-contract={c.title} style={{ padding: '8px 0', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', opacity: c.status === 'void' ? 0.65 : 1 }}>
          <div>
            <b>{c.title}</b> <span className={BADGE[c.status]} style={{ marginLeft: 6 }}>{CONTRACT_STATUS[c.status]}</span>
            <div className="page-sub" style={{ margin: '2px 0 0' }}>Version {c.version}{tplName(c.template_id) ? ` · from ${tplName(c.template_id)}` : ''} · {fmtDate(c.created_at.slice(0, 10))}{c.status === 'signed' ? ' · signed copy saved in Documents' : ''}{c.status === 'void' ? ` · void: ${c.void_reason}` : ''}</div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <button className="btn btn-ghost" style={btnS} onClick={() => { setErr(''); setOpen(c.id) }} aria-label={`${c.status === 'draft' ? 'Edit' : 'View'} ${c.title}`}>{c.status === 'draft' ? 'Edit' : 'View'}</button>
            {c.status === 'final' && <button className="btn btn-ghost" style={btnS} onClick={() => onUploadSigned(c)} aria-label={`Upload the signed copy of ${c.title}`}>Upload signed copy</button>}
            {(c.status === 'final' || c.status === 'signed') && <button className="btn btn-ghost" style={btnS} onClick={() => copy(c)} aria-label={`Make a new version of ${c.title}`}>New version</button>}
          </div>
        </div>))}
      {builder && <BuilderModal client={client} templates={templates.filter(t => t.active)} onClose={() => setBuilder(false)} onCreated={async (id) => { setBuilder(false); await reload(); flash('Draft created. Review and edit it, then make it final.'); setOpen(id) }} />}
      {current && <EditorModal key={current.id} contract={current} documents={documents} onClose={() => setOpen(null)} reload={reload} flash={flash} onUploadSigned={onUploadSigned} />}
      {tpls && <TemplatesModal templates={templates} onClose={() => setTpls(false)} reload={reload} flash={flash} />}
    </div>
  )
}

function BuilderModal({ client, templates, onClose, onCreated }) {
  const [tplId, setTplId] = useState('')
  const [title, setTitle] = useState('')
  const [auto, setAuto] = useState(null)
  const [vals, setVals] = useState({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const tpl = templates.find(t => t.id === tplId)
  useEffect(() => { supabase.rpc('finance_contract_fields', { p_client: client.id }).then(({ data }) => setAuto(data || {})) }, [client.id])
  const names = useMemo(() => (tpl ? blanksOf(tpl.body) : []), [tpl])
  function choose(id) {
    setTplId(id); const t = templates.find(x => x.id === id)
    setTitle(t ? `${t.name.replace(/\s*\(starter\)\s*$/i, '')} - ${client.name}` : '')
    setVals({})
  }
  const valueOf = (k) => (vals[k] !== undefined ? vals[k] : (auto && auto[k]) || '')
  async function create() {
    setErr('')
    if (!tpl) return setErr('Choose a template.')
    if (!title.trim()) return setErr('Give the contract a title.')
    const out = {}; names.forEach(k => { const v = (valueOf(k) || '').trim(); if (v) out[k] = v })
    setBusy(true)
    const { data, error } = await supabase.rpc('finance_contract_create', { p_client: client.id, p_template: tpl.id, p_title: title, p_values: out })
    setBusy(false)
    if (error) return setErr(error.message)
    onCreated(data)
  }
  return (
    <Modal title="Build a contract" onClose={onClose} width={640}>
      {err && <div className="login-err" role="alert">{err}</div>}
      <div className="field"><label htmlFor="cb-tpl">Template</label>
        <select id="cb-tpl" value={tplId} onChange={e => choose(e.target.value)}><option value="">Choose a template</option>{templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        {tpl && tpl.description && <div className="hint">{tpl.description}</div>}</div>
      {tpl && (<>
        <div className="field"><label htmlFor="cb-title">Title</label><input id="cb-title" value={title} onChange={e => setTitle(e.target.value)} maxLength={120} /></div>
        <p className="page-sub" style={{ margin: '4px 0' }}>Details Command Center already knows are filled in for you. Change anything, and fill in the rest. You can still edit the whole wording afterwards.</p>
        <div data-fields style={{ maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
          {names.map(k => (
            <div className="field" key={k}><label htmlFor={`cf-${k}`}>{labelOf(k)}{auto && auto[k] ? <span className="page-sub" style={{ marginLeft: 6, fontWeight: 400 }}>filled in</span> : null}</label>
              {LONG_FIELDS.includes(k) ? <textarea id={`cf-${k}`} rows={4} value={valueOf(k)} onChange={e => setVals({ ...vals, [k]: e.target.value })} style={{ width: '100%' }} /> : <input id={`cf-${k}`} value={valueOf(k)} onChange={e => setVals({ ...vals, [k]: e.target.value })} />}</div>))}
          {names.length === 0 && <p className="page-sub">This template has no fields to fill in.</p>}
        </div></>)}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn btn-primary" onClick={create} disabled={busy}>{busy ? 'Building…' : 'Create the draft'}</button>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </Modal>
  )
}

function EditorModal({ contract: c, documents, onClose, reload, flash, onUploadSigned }) {
  const draft = c.status === 'draft'
  const [title, setTitle] = useState(c.title)
  const [body, setBody] = useState(c.body)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [voiding, setVoiding] = useState(null)
  const blanks = blanksOf(draft ? body : c.body)
  const signedDoc = c.document_id ? documents.find(d => d.id === c.document_id) : null
  async function save(msg = 'Saved.') {
    const { error } = await supabase.rpc('finance_contract_update', { p_id: c.id, p_title: title, p_body: body })
    if (error) { setErr(error.message); return false }
    setErr(''); if (msg) flash(msg); await reload(); return true
  }
  async function finish() {
    if (blanks.length > 0) return setErr(`Fill in or remove the blank${blanks.length === 1 ? '' : 's'} before finishing: ${blanks.map(b => `{{${b}}}`).join(', ')}`)
    if (!window.confirm('Make this contract final? The wording is locked. To change it later you make a new version.')) return
    setBusy(true)
    if (!(await save(''))) return setBusy(false)
    const { error } = await supabase.rpc('finance_contract_finalize', { p_id: c.id })
    setBusy(false)
    if (error) return setErr(error.message)
    flash('Contract is final. Print it for signing, then upload the signed copy.'); await reload(); onClose()
  }
  async function del() {
    if (!window.confirm('Delete this draft?')) return
    const { error } = await supabase.rpc('finance_contract_delete', { p_id: c.id })
    if (error) return setErr(error.message)
    flash('Draft deleted.'); await reload(); onClose()
  }
  async function print() {
    if (!printContract({ ...c, title: draft ? title : c.title, body: draft ? body : c.body })) return setErr('Allow pop-ups to print.')
    if (!draft) supabase.rpc('finance_log_export', { p_table: 'finance_contracts', p_row: c.id, p_note: 'Printed or saved as PDF' })
  }
  async function openSigned() {
    if (!signedDoc) return
    const { data, error } = await supabase.storage.from('client-documents').createSignedUrl(signedDoc.storage_path, 60)
    if (error || !data) return setErr(error ? error.message : 'Could not open the file.')
    supabase.rpc('finance_log_export', { p_table: 'finance_client_documents', p_row: signedDoc.id, p_note: 'Opened or downloaded' })
    window.open(data.signedUrl, '_blank', 'noopener')
  }
  async function doVoid() {
    if ((voiding.reason || '').trim().length < 3) return setErr('Say why this contract is being voided.')
    const { error } = await supabase.rpc('finance_contract_void', { p_id: c.id, p_reason: voiding.reason.trim() })
    if (error) return setErr(error.message)
    flash('Contract voided.'); await reload(); onClose()
  }
  return (
    <Modal title={`${draft ? 'Edit' : 'View'}: ${c.title}`} onClose={onClose} width={820}>
      {err && <div className="login-err" role="alert">{err}</div>}
      <p className="page-sub" style={{ margin: '0 0 6px' }}><span className={BADGE[c.status]}>{CONTRACT_STATUS[c.status]}</span> Version {c.version}{c.status === 'void' ? `. Void: ${c.void_reason}` : ''}</p>
      {draft && <div className="field"><label htmlFor="ce-title">Title</label><input id="ce-title" value={title} onChange={e => setTitle(e.target.value)} maxLength={120} /></div>}
      {blanks.length > 0 && <div role="note" data-blanks style={{ color: '#b45309', margin: '4px 0 8px', fontSize: 13 }}>Still to fill in: {blanks.map(b => `{{${b}}}`).join(', ')}. Type over each one, or delete it.</div>}
      {draft ? <textarea id="ce-body" aria-label="Contract wording" value={body} onChange={e => setBody(e.target.value)} rows={22} style={{ width: '100%', fontFamily: 'Georgia, serif', fontSize: 14, lineHeight: 1.5, padding: 10, border: '1px solid var(--line)', borderRadius: 8 }} />
        : <div data-preview style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '4px 16px', maxHeight: 460, overflowY: 'auto', fontFamily: 'Georgia, serif', lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: renderContractBody(c.body) }} />}
      {draft && <div className="hint">Formatting: start a line with # for a heading or ## for a subheading, - for a bullet, and put **two stars** around bold words. Starter wording is only a starting point: have your attorney review a contract before it is used.</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        {draft && <button className="btn btn-primary" onClick={() => save('Saved.')} disabled={busy}>Save</button>}
        <button className="btn btn-ghost" onClick={print}>Print or save as PDF</button>
        {draft && <button className="btn btn-ghost" onClick={finish} disabled={busy}>Make final…</button>}
        {c.status === 'final' && <button className="btn btn-ghost" onClick={() => { onClose(); onUploadSigned(c) }}>Upload the signed copy</button>}
        {c.status === 'signed' && signedDoc && <button className="btn btn-ghost" onClick={openSigned}>Open the signed copy</button>}
        {(draft || c.status === 'final') && <button className="btn btn-ghost" onClick={() => { setErr(''); setVoiding({ reason: '' }) }}>Void…</button>}
        {draft && <button className="btn btn-ghost" onClick={del} disabled={busy}>Delete draft</button>}
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Close</button>
      </div>
      {voiding && (
        <div data-void style={{ borderTop: '1px solid var(--line)', marginTop: 12, paddingTop: 10 }}>
          <div className="field"><label htmlFor="cv-why">Why is it being voided? *</label><input id="cv-why" value={voiding.reason} onChange={e => setVoiding({ reason: e.target.value })} /></div>
          <button className="btn btn-primary" onClick={doVoid}>Void the contract</button> <button className="btn btn-ghost" onClick={() => setVoiding(null)}>Cancel</button>
        </div>)}
    </Modal>
  )
}

function TemplatesModal({ templates, onClose, reload, flash }) {
  const [edit, setEdit] = useState(null)       // { id?, name, description, body, active, built_in }
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function save() {
    setErr('')
    if (!edit.name.trim()) return setErr('Give the template a name.')
    if (!edit.body.trim()) return setErr('The template needs some text.')
    setBusy(true)
    const { error } = await supabase.rpc('finance_contract_template_save', { p_id: edit.id || null, p_name: edit.name, p_description: edit.description || null, p_body: edit.body, p_active: edit.active })
    setBusy(false)
    if (error) return setErr(error.message)
    flash(`Template "${edit.name.trim()}" saved.`); setEdit(null); await reload()
  }
  async function toggle(t) {
    const { error } = await supabase.rpc('finance_contract_template_save', { p_id: t.id, p_name: t.name, p_description: t.description, p_body: t.body, p_active: !t.active })
    if (error) return setErr(error.message)
    setErr(''); flash(`${t.name}: ${t.active ? 'switched off' : 'switched on'}.`); await reload()
  }
  async function remove(t) {
    if (!window.confirm(`Delete the template "${t.name}"? Contracts already built from it are not affected.`)) return
    const { error } = await supabase.rpc('finance_contract_template_delete', { p_id: t.id })
    if (error) return setErr(error.message)
    setErr(''); flash('Template deleted.'); await reload()
  }
  return (
    <Modal title={edit ? (edit.id ? `Edit template: ${edit.name || ''}` : 'New template') : 'Contract templates'} onClose={onClose} width={780}>
      {err && <div className="login-err" role="alert">{err}</div>}
      {!edit && (<>
        <p className="page-sub" style={{ marginTop: 0 }}>The starter templates are only starting points. Replace their wording with your own, or add your own templates. Anything in double curly brackets, like {'{{client_name}}'}, is filled in when you build a contract.</p>
        {templates.map(t => (
          <div key={t.id} data-template={t.name} style={{ padding: '8px 0', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div><b>{t.name}</b>{t.built_in && <span className="badge" style={{ marginLeft: 6 }}>Starter</span>}{!t.active && <span className="badge failed" style={{ marginLeft: 6 }}>Off</span>}{t.description && <div className="page-sub" style={{ margin: '2px 0 0' }}>{t.description}</div>}</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <label style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 12.5, cursor: 'pointer' }}><input type="checkbox" aria-label={`Turn ${t.name} on`} checked={t.active} onChange={() => toggle(t)} /> On</label>
              <button className="btn btn-ghost" style={btnS} onClick={() => { setErr(''); setEdit({ ...t, description: t.description || '' }) }} aria-label={`Edit ${t.name}`}>Edit</button>
              {!t.built_in && <button className="btn btn-ghost" style={btnS} onClick={() => remove(t)} aria-label={`Delete ${t.name}`}>Delete</button>}
            </div>
          </div>))}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="btn btn-primary" onClick={() => { setErr(''); setEdit({ name: '', description: '', body: '', active: true }) }}>+ New template</button>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div></>)}
      {edit && (<>
        <div className="field"><label htmlFor="tp-name">Name</label><input id="tp-name" value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} maxLength={100} /></div>
        <div className="field"><label htmlFor="tp-desc">Description (optional)</label><input id="tp-desc" value={edit.description} onChange={e => setEdit({ ...edit, description: e.target.value })} maxLength={500} /></div>
        <div className="field"><label htmlFor="tp-body">Wording</label>
          <textarea id="tp-body" value={edit.body} onChange={e => setEdit({ ...edit, body: e.target.value })} rows={16} style={{ width: '100%', fontFamily: 'Georgia, serif', fontSize: 14, lineHeight: 1.5, padding: 10, border: '1px solid var(--line)', borderRadius: 8 }} /></div>
        <div className="hint" data-help>Filled in for you: {FIELD_HELP.map(f => `{{${f}}}`).join(', ')}. Any other {'{{name}}'} you type becomes a box to fill in when you build a contract. Formatting: # heading, ## subheading, - bullet, **bold**.</div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' }}><input type="checkbox" checked={edit.active} onChange={e => setEdit({ ...edit, active: e.target.checked })} /> Switched on</label>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button className="btn btn-primary" onClick={save} disabled={busy}>Save the template</button>
          <button className="btn btn-ghost" onClick={() => { setErr(''); setEdit(null) }} disabled={busy}>Back to the list</button>
        </div></>)}
    </Modal>
  )
}
