import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Certifications() {
  const [certs, setCerts] = useState([])
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setErr('')
    try {
      const [{ data: c, error: ce }, { data: r, error: re }] = await Promise.all([
        supabase.from('certifications').select('*').eq('active', true).order('name'),
        supabase.from('cert_record_status').select('*'),
      ])
      if (ce) throw ce
      if (re) throw re
      setCerts(c || [])
      setRecords(r || [])
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

  if (loading) return <div className="page-head"><p className="page-sub">Loading certifications…</p></div>

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Certifications</h1>
        <p className="page-sub">Create certifications, assign them by tag, and track who has passed.</p>
      </div>

      {err && (
        <div className="card" style={{ borderColor: 'var(--failed)', marginBottom: 16 }}>
          <b style={{ color: 'var(--failed)' }}>Couldn't load data.</b>
          <p className="page-sub" style={{ marginTop: 6 }}>{err}</p>
          <p className="page-sub" style={{ marginTop: 6 }}>
            If this says a table or function doesn't exist, the certification SQL
            migrations haven't been run yet. If it says permission denied, the
            Phase 0 is_admin() fix and JWT hook aren't active yet.
          </p>
        </div>
      )}

      {!err && certs.length === 0 && (
        <div className="card">
          <div className="page-sub" style={{ textAlign: 'center', padding: 24 }}>
            No certifications yet. Once you run the cert migrations and create one,
            it'll appear here.
          </div>
        </div>
      )}

      <div className="cards">
        {certs.map(cert => {
          const s = statsFor(cert.id)
          return (
            <div className="card" key={cert.id}>
              <h3 style={{ margin: 0, fontSize: 16.5, fontWeight: 660 }}>{cert.name}</h3>
              {cert.description && (
                <p className="page-sub" style={{ marginTop: 5 }}>{cert.description}</p>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <span className="badge needed">{s.needed} needed</span>
                <span className="badge passed">{s.passed} passed</span>
                <span className="badge failed">{s.failed} failed</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
