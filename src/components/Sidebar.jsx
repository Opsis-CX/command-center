import { Fragment, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { canAny } from '../lib/permissions'

// Certifications: list, create (assign by tag), and delete.
export default function Certifications() {
  const { appRole } = useAuth()
  // Certification staff and admins manage certifications (permission
  // 'certifications.all'); everyone else sees them read-only.
  const canEdit = canAny(appRole, 'certifications.all')
  const [certs, setCerts] = useState([])
  const [records, setRecords] = useState([])
  const [tags, setTags] = useState([])
  const [callTypes, setCallTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editCert, setEditCert] = useState(null)   // cert being edited (with tagIds)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setErr('')
    try {
      const [certsRes, recsRes, tagsRes, ctRes, asgRes] = await Promise.all([
        supabase.from('certifications').select('*').eq('active', true).order('name'),
        supabase.from('cert_record_status').select('*'),
        supabase.from('tags').select('*').order('name'),
        supabase.from('call_types').select('*').eq('active', true).order('name'),
        supabase.from('certification_assignments').select('certification_id, tag_id'),
      ])
      if (certsRes.error) throw certsRes.error
      if (recsRes.error) throw recsRes.error
      // attach each cert's tag ids so Edit opens with them already picked
      const byCert = {}
      ;(asgRes.data || []).forEach(a => { (byCert[a.certification_id] = byCert[a.certification_id] || []).push(a.tag_id) })
      setCerts((certsRes.data || []).map(c => ({ ...c, tagIds: byCert[c.id] || [] })))
      setRecords(recsRes.data || [])
      setTags(tagsRes.data || [])
      setCallTypes(ctRes.data || [])
    } catch (e) {
      setErr(e.message || 'Failed to load certifications')
    } finally {
      setLoading(false)
    }
  }

  function statsFor(certId) {
    const rs = records.filter(r => r.certification_id === certId)
    return {
      needed: rs.filter(r => r.status === 'needed').length,
      passed: rs.filter(r => r.status === 'passed').length,
      failed: rs.filter(r => r.status === 'failed').length,
    }
  }

  async function deleteCert(cert) {
    const s = statsFor(cert.id)
    const attached = s.needed + s.passed + s.failed
    let msg = `Delete "${cert.name}"?`
    if (s.passed > 0) {
      msg += `\n\nWARNING: ${s.passed} person(s) have PASSED this certification. Deleting it erases those earned records.`
    } else if (attached > 0) {
      msg += `\n\n${attached} person(s) have records for this (needed/failed) that will be removed.`
    }
    msg += '\n\nThis cannot be undone.'
    if (!window.confirm(msg)) return
    try {
      const { error } = await supabase.from('certifications').delete().eq('id', cert.id)
      if (error) throw error
      load()
    } catch (e) { setErr(e.message) }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, marginBottom: 22, flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title">Certifications</h1>
          <p className="page-sub">Create certifications, assign them by tag, and track who has passed.</p>
        </div>
        {canEdit && <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ New certification</button>}
      </div>

      {loading && <p className="page-sub">Loading…</p>}

      {err && (
        <div className="card" style={{ borderColor: 'var(--failed)', marginBottom: 16 }}>
          <b style={{ color: 'var(--failed)' }}>Couldn't load data.</b>
          <p className="page-sub" style={{ marginTop: 6 }}>{err}</p>
        </div>
      )}

      {!loading && !err && certs.length === 0 && (
        <div className="card">
          <div className="page-sub" style={{ textAlign: 'center', padding: 24 }}>
            No certifications yet.{canEdit ? <> Click <b>+ New certification</b> to create your first one.</> : ''}
          </div>
        </div>
      )}

      <div className="cards">
        {certs.map(cert => {
          const s = statsFor(cert.id)
          return (
            <div className="card" key={cert.id}>
              <h3 style={{ margin: 0, fontSize: 16.5, fontWeight: 600 }}>{cert.name}</h3>
              {cert.description && <p className="page-sub" style={{ marginTop: 5 }}>{cert.description}</p>}
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <span className="badge needed">{s.needed} needed</span>
                <span className="badge passed">{s.passed} passed</span>
                <span className="badge failed">{s.failed} failed</span>
              </div>
              {canEdit && (
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button className="btn btn-ghost" style={{ fontSize: 12.5, padding: '6px 12px' }}
                    onClick={() => setEditCert(cert)}>Edit</button>
                  <button className="btn btn-ghost" style={{ color: 'var(--failed)', borderColor: 'var(--failed-bg)', fontSize: 12.5, padding: '6px 12px' }}
                    onClick={() => deleteCert(cert)}>Delete</button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {!loading && !err && <CertMatrix records={records} certs={certs} />}

      {showCreate && canEdit && (
        <CertModal
          cert={null}
          tags={tags}
          callTypes={callTypes}
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); load() }}
        />
      )}

      {editCert && canEdit && (
        <CertModal
          cert={editCert}
          tags={tags}
          callTypes={callTypes}
          onClose={() => setEditCert(null)}
          onSaved={() => { setEditCert(null); load() }}
        />
      )}
    </div>
  )
}

// ============================================================
// CERTIFICATION MATRIX
// Per-person visibility into who is in process / passed / failed.
// Reads the cert_record_status rows already loaded by the page, so no
// extra query. Two views: an at-a-glance people×certifications grid
// (click a person to expand scores/dates) and a flat detail roster.
// ============================================================
const CERT_STATUS_META = {
  needed: { label: 'In process', cls: 'needed' },
  passed: { label: 'Passed', cls: 'passed' },
  failed: { label: 'Failed', cls: 'failed' },
}
const fmtCertDate = (v) => (v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—')
const certPct = (v) => (v == null ? '—' : v + '%')

function StatusChip({ status }) {
  const m = CERT_STATUS_META[status]
  if (!m) return <span style={{ color: 'var(--ink-soft)' }}>—</span>
  return <span className={'badge ' + m.cls}>{m.label}</span>
}

function CertMatrix({ records, certs }) {
  const [view, setView] = useState('grid')          // 'grid' | 'roster'
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')  // all | needed | passed | failed
  const [expanded, setExpanded] = useState(null)    // profile_id whose detail is open

  // Distinct people who appear in the records, alphabetical.
  const peopleMap = new Map()
  records.forEach(r => {
    if (!peopleMap.has(r.profile_id)) {
      peopleMap.set(r.profile_id, { profile_id: r.profile_id, agent_name: r.agent_name, agent_email: r.agent_email })
    }
  })
  const allPeople = Array.from(peopleMap.values())
    .sort((a, b) => (a.agent_name || '').localeCompare(b.agent_name || ''))

  const recAt = (pid, cid) => records.find(r => r.profile_id === pid && r.certification_id === cid) || null

  const ql = q.trim().toLowerCase()
  const matchesSearch = (p) => !ql
    || (p.agent_name || '').toLowerCase().includes(ql)
    || (p.agent_email || '').toLowerCase().includes(ql)
  const matchesStatus = (pid) => statusFilter === 'all'
    || records.some(r => r.profile_id === pid && r.status === statusFilter)

  const people = allPeople.filter(p => matchesSearch(p) && matchesStatus(p.profile_id))

  const summary = {
    people: allPeople.length,
    needed: records.filter(r => r.status === 'needed').length,
    passed: records.filter(r => r.status === 'passed').length,
    failed: records.filter(r => r.status === 'failed').length,
  }

  // Flat roster rows (person + cert), filtered the same way.
  const rosterRows = records
    .filter(r => matchesSearch({ agent_name: r.agent_name, agent_email: r.agent_email })
      && (statusFilter === 'all' || r.status === statusFilter))
    .sort((a, b) => (a.agent_name || '').localeCompare(b.agent_name || '')
      || (a.certification_name || '').localeCompare(b.certification_name || ''))

  function exportCsv() {
    const head = ['Person', 'Email', 'Certification', 'Status', 'Best score %', 'Attempts', 'Passed', 'Last attempt', 'Expires']
    const esc = (v) => {
      const s = v == null ? '' : String(v)
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
    }
    const lines = rosterRows.map(r => [
      r.agent_name, r.agent_email, r.certification_name,
      CERT_STATUS_META[r.status]?.label || r.status,
      r.best_score_pct ?? '', r.attempts ?? '',
      r.passed_at ? fmtCertDate(r.passed_at) : '', r.last_attempt_at ? fmtCertDate(r.last_attempt_at) : '',
      r.expires_at ? fmtCertDate(r.expires_at) : '',
    ].map(esc).join(','))
    const csv = [head.join(','), ...lines].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url; a.download = 'certification-matrix.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  const ToggleBtn = ({ value, children }) => (
    <button onClick={() => setView(value)}
      style={{ border: '1px solid var(--line)', background: view === value ? 'var(--accent)' : 'var(--surface)', color: view === value ? '#fff' : 'var(--ink-soft)', fontSize: 12.5, fontWeight: 600, padding: '5px 12px', borderRadius: 7, cursor: 'pointer' }}>
      {children}
    </button>
  )

  return (
    <div className="card" style={{ marginTop: 26, padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>Certification Matrix</h2>
            <p className="page-sub" style={{ marginTop: 3 }}>
              {summary.people} {summary.people === 1 ? 'person' : 'people'} · {summary.passed} passed · {summary.failed} failed · {summary.needed} in process
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <ToggleBtn value="grid">Grid</ToggleBtn>
            <ToggleBtn value="roster">Roster</ToggleBtn>
            <button onClick={exportCsv} className="btn btn-ghost" style={{ fontSize: 12.5, padding: '5px 12px' }}>⬇ CSV</button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search person…"
            style={{ flex: '1 1 220px', minWidth: 160, padding: '8px 11px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13.5, fontFamily: 'inherit', background: 'var(--canvas)' }} />
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            style={{ padding: '8px 11px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13.5, fontFamily: 'inherit', background: 'var(--canvas)' }}>
            <option value="all">All statuses</option>
            <option value="passed">Passed</option>
            <option value="failed">Failed</option>
            <option value="needed">In process</option>
          </select>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        {records.length === 0 ? (
          <p className="page-sub" style={{ padding: 24, textAlign: 'center' }}>
            No certification records yet. Once a certification is assigned to a tag, the people who need it will appear here.
          </p>
        ) : people.length === 0 && view === 'grid' ? (
          <p className="page-sub" style={{ padding: 24, textAlign: 'center' }}>No people match your filters.</p>
        ) : view === 'grid' ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5, minWidth: 480 }}>
            <thead>
              <tr style={{ background: 'var(--canvas)', textAlign: 'left' }}>
                <MTh sticky>Person</MTh>
                {certs.map(c => <MTh key={c.id} center>{c.name}</MTh>)}
              </tr>
            </thead>
            <tbody>
              {people.map(p => {
                const open = expanded === p.profile_id
                return (
                  <Fragment key={p.profile_id}>
                    <tr onClick={() => setExpanded(open ? null : p.profile_id)}
                      style={{ borderTop: '1px solid var(--line-soft)', cursor: 'pointer', background: open ? 'var(--accent-bg)' : 'transparent' }}>
                      <MTd sticky>
                        <span style={{ fontWeight: 600 }}>{p.agent_name || '—'}</span>
                        <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--ink-soft)' }}>{open ? '▾' : '▸'}</span>
                      </MTd>
                      {certs.map(c => {
                        const r = recAt(p.profile_id, c.id)
                        return <MTd key={c.id} center>{r ? <StatusChip status={r.status} /> : <span style={{ color: 'var(--ink-soft)' }}>—</span>}</MTd>
                      })}
                    </tr>
                    {open && (
                      <tr style={{ background: 'var(--canvas)' }}>
                        <td colSpan={certs.length + 1} style={{ padding: '4px 16px 14px' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10, marginTop: 8 }}>
                            {certs.map(c => {
                              const r = recAt(p.profile_id, c.id)
                              if (!r) return null
                              return (
                                <div key={c.id} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px', background: 'var(--surface)' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>{c.name}</span>
                                    <StatusChip status={r.status} />
                                  </div>
                                  <DetailRow k="Best score" v={certPct(r.best_score_pct)} />
                                  <DetailRow k="Attempts" v={r.attempts ?? '—'} />
                                  <DetailRow k="Passed" v={fmtCertDate(r.passed_at)} />
                                  <DetailRow k="Last attempt" v={fmtCertDate(r.last_attempt_at)} />
                                  <DetailRow k="Expires" v={fmtCertDate(r.expires_at)} />
                                </div>
                              )
                            })}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        ) : rosterRows.length === 0 ? (
          <p className="page-sub" style={{ padding: 24, textAlign: 'center' }}>No records match your filters.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5, minWidth: 760 }}>
            <thead>
              <tr style={{ background: 'var(--canvas)', textAlign: 'left' }}>
                <MTh>Person</MTh><MTh>Certification</MTh><MTh>Status</MTh>
                <MTh right>Best score</MTh><MTh right>Attempts</MTh>
                <MTh>Passed</MTh><MTh>Last attempt</MTh><MTh>Expires</MTh>
              </tr>
            </thead>
            <tbody>
              {rosterRows.map(r => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--line-soft)' }}>
                  <MTd><span style={{ fontWeight: 600 }}>{r.agent_name || '—'}</span></MTd>
                  <MTd>{r.certification_name}</MTd>
                  <MTd><StatusChip status={r.status} /></MTd>
                  <MTd right>{certPct(r.best_score_pct)}</MTd>
                  <MTd right>{r.attempts ?? '—'}</MTd>
                  <MTd>{fmtCertDate(r.passed_at)}</MTd>
                  <MTd>{fmtCertDate(r.last_attempt_at)}</MTd>
                  <MTd>{fmtCertDate(r.expires_at)}</MTd>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function MTh({ children, center, right, sticky }) {
  return <th style={{ padding: '10px 14px', fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--ink-soft)', textAlign: center ? 'center' : right ? 'right' : 'left', whiteSpace: 'nowrap', position: sticky ? 'sticky' : undefined, left: sticky ? 0 : undefined, background: sticky ? 'var(--canvas)' : undefined, zIndex: sticky ? 1 : undefined }}>{children}</th>
}
function MTd({ children, center, right, sticky }) {
  return <td style={{ padding: '10px 14px', textAlign: center ? 'center' : right ? 'right' : 'left', whiteSpace: 'nowrap', position: sticky ? 'sticky' : undefined, left: sticky ? 0 : undefined, background: sticky ? 'var(--surface)' : undefined }}>{children}</td>
}
function DetailRow({ k, v }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '2px 0', fontSize: 12.5 }}>
      <span style={{ color: 'var(--ink-soft)' }}>{k}</span>
      <span style={{ fontWeight: 600 }}>{v}</span>
    </div>
  )
}

// One modal for both create and edit. `cert` null = creating a new one.
function CertModal({ cert, tags, callTypes, onClose, onSaved }) {
  const editing = !!cert
  const [name, setName] = useState(cert?.name || '')
  const [description, setDescription] = useState(cert?.description || '')
  const [callTypeId, setCallTypeId] = useState(cert?.call_type_id || '')
  const [grantsTagId, setGrantsTagId] = useState(cert?.grants_tag_id || '')
  const [removesTagId, setRemovesTagId] = useState(cert?.removes_tag_id || '')
  const [pickedTags, setPickedTags] = useState(cert?.tagIds || [])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  function toggleTag(id) {
    setPickedTags(p => p.includes(id) ? p.filter(t => t !== id) : [...p, id])
  }

  async function save() {
    if (!name.trim()) { setErr('Give the certification a name.'); return }
    setSaving(true); setErr('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      let certId = cert?.id

      if (editing) {
        const { error: ue } = await supabase.from('certifications').update({
          name: name.trim(),
          description: description.trim() || null,
          call_type_id: callTypeId || null,
          grants_tag_id: grantsTagId || null,
          removes_tag_id: removesTagId || null,
          updated_at: new Date().toISOString(),
        }).eq('id', certId)
        if (ue) throw ue
        // Replace the tag assignments with the current picks. Simpler and safer
        // than diffing, and sync_cert_assignment reconciles agent records after.
        const { error: de } = await supabase.from('certification_assignments').delete().eq('certification_id', certId)
        if (de) throw de
      } else {
        const { data: created, error: ce } = await supabase
          .from('certifications')
          .insert({
            name: name.trim(),
            description: description.trim() || null,
            call_type_id: callTypeId || null,
            grants_tag_id: grantsTagId || null,
            removes_tag_id: removesTagId || null,
            active: true,
            created_by: user?.id ?? null,
          })
          .select()
          .single()
        if (ce) throw ce
        certId = created.id
      }

      if (pickedTags.length) {
        const rows = pickedTags.map(tagId => ({
          certification_id: certId,
          tag_id: tagId,
          assigned_by: user?.id ?? null,
        }))
        const { error: ae } = await supabase.from('certification_assignments').insert(rows)
        if (ae) throw ae
      }
      // Reconcile who needs this certification, for both create and edit
      // (an edit that removes a tag must drop those agents' records too).
      const { error: se } = await supabase.rpc('sync_cert_assignment', { p_certification_id: certId })
      if (se) throw se

      onSaved()
    } catch (e) {
      setErr(e.message || (editing ? 'Could not save certification' : 'Could not create certification'))
      setSaving(false)
    }
  }

  return (
    <div className="modal-back open" onClick={e => { if (e.target.classList.contains('modal-back')) onClose() }}>
      <div className="modal">
        <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600 }}>{editing ? 'Edit certification' : 'New certification'}</h3>
        <p className="page-sub" style={{ marginBottom: 18 }}>
          {editing ? 'Changing tags updates who needs this certification.' : 'Create the credential, then build its course and quiz.'}
        </p>

        {err && <div className="login-err" style={{ marginBottom: 14 }}>{err}</div>}

        <div className="field">
          <label>Name</label>
          <input value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. GarageCo Appointment Setter Certification" autoFocus />
        </div>

        <div className="field">
          <label>Description <span style={{ fontWeight: 400 }}>(optional)</span></label>
          <textarea value={description} onChange={e => setDescription(e.target.value)}
            placeholder="What this certification covers" rows={3} />
        </div>

        <div className="field">
          <label>Also gates a call type? <span style={{ fontWeight: 400 }}>(optional)</span></label>
          <select value={callTypeId} onChange={e => setCallTypeId(e.target.value)}>
            <option value="">No — credential only</option>
            {callTypes.map(ct => <option key={ct.id} value={ct.id}>{ct.name}</option>)}
          </select>
        </div>

        {/* Passing the quiz should move an agent from "needs this" to
            "has this" automatically — otherwise someone has to remember to
            re-tag every agent by hand. */}
        <div className="field">
          <label>When they pass, add this tag <span style={{ fontWeight: 400 }}>(optional)</span></label>
          <select value={grantsTagId} onChange={e => setGrantsTagId(e.target.value)}>
            <option value="">No tag</option>
            {tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>

        <div className="field">
          <label>…and remove this tag <span style={{ fontWeight: 400 }}>(optional)</span></label>
          <select value={removesTagId} onChange={e => setRemovesTagId(e.target.value)}>
            <option value="">No tag</option>
            {tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <div className="hint">Usually the "…Certification Needed" tag — passing the quiz means they no longer need it.</div>
        </div>

        <div className="field">
          <label>Assign to tags <span style={{ fontWeight: 400 }}>(who needs it)</span></label>
          {tags.length === 0 ? (
            <div className="hint">No tags found. You can create the certification now and assign tags later.</div>
          ) : (
            <div className="tag-picker">
              {tags.map(t => (
                <button type="button" key={t.id}
                  className={'tag-opt' + (pickedTags.includes(t.id) ? ' on' : '')}
                  onClick={() => toggleTag(t.id)}>
                  {t.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={save} disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Create certification'}
          </button>
        </div>
      </div>
    </div>
  )
}
