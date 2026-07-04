import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Certifications: list, create (assign by tag), and delete.
export default function Certifications() {
  const [certs, setCerts] = useState([])
  const [records, setRecords] = useState([])
  const [tags, setTags] = useState([])
  const [callTypes, setCallTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setErr('')
    try {
      const [certsRes, recsRes, tagsRes, ctRes] = await Promise.all([
        supabase.from('certifications').select('*').eq('active', true).order('name'),
        supabase.from('cert_record_status').select('*'),
        supabase.from('tags').select('*').order('name'),
        supabase.from('call_types').select('*').eq('active', true).order('name'),
      ])
      if (certsRes.error) throw certsRes.error
      if (recsRes.error) throw recsRes.error
      setCerts(certsRes.data || [])
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
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ New certification</button>
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
            No certifications yet. Click <b>+ New certification</b> to create your first one.
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
              <div style={{ marginTop: 12 }}>
                <button className="btn btn-ghost" style={{ color: 'var(--failed)', borderColor: 'var(--failed-bg)', fontSize: 12.5, padding: '6px 12px' }}
                  onClick={() => deleteCert(cert)}>Delete</button>
              </div>
            </div>
          )
        })}
      </div>

      {showCreate && (
        <CreateCertModal
          tags={tags}
          callTypes={callTypes}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load() }}
        />
      )}
    </div>
  )
}

function CreateCertModal({ tags, callTypes, onClose, onCreated }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [callTypeId, setCallTypeId] = useState('')
  const [pickedTags, setPickedTags] = useState([])
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
      const { data: cert, error: ce } = await supabase
        .from('certifications')
        .insert({
          name: name.trim(),
          description: description.trim() || null,
          call_type_id: callTypeId || null,
          active: true,
          created_by: user?.id ?? null,
        })
        .select()
        .single()
      if (ce) throw ce

      if (pickedTags.length) {
        const rows = pickedTags.map(tagId => ({
          certification_id: cert.id,
          tag_id: tagId,
          assigned_by: user?.id ?? null,
        }))
        const { error: ae } = await supabase.from('certification_assignments').insert(rows)
        if (ae) throw ae
        const { error: se } = await supabase.rpc('sync_cert_assignment', { p_certification_id: cert.id })
        if (se) throw se
      }
      onCreated()
    } catch (e) {
      setErr(e.message || 'Could not create certification')
      setSaving(false)
    }
  }

  return (
    <div className="modal-back open" onClick={e => { if (e.target.classList.contains('modal-back')) onClose() }}>
      <div className="modal">
        <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600 }}>New certification</h3>
        <p className="page-sub" style={{ marginBottom: 18 }}>Create the credential, then build its course and quiz.</p>

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
            {saving ? 'Creating…' : 'Create certification'}
          </button>
        </div>
      </div>
    </div>
  )
}
