import React, { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { fmtDate, panel } from './financeBits'

// ============================================================
// PROFILE
// Everything about one person in one place: photo, details, job title, job roles, tokens, projects and open tasks.
//   - Everyone opens their own page (My profile).
//   - Admins and Owners can open anyone's page.
// The database decides who may see what. It never returns access levels, passwords or other private fields.
// Job roles come from the shifts a person actually worked in the last 90 days (they are not typed in by hand).
// The photo uses the same storage and update as Settings, so a new photo changes everywhere at once.
// ============================================================

const STATUS = { todo: 'To do', inprogress: 'In progress', blocked: 'Blocked' }
const initialsFrom = (name) => (name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
const when = (ts) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })
const sectionTitle = { fontSize: 15, fontWeight: 700, margin: '0 0 8px' }
const row = { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderTop: '1px solid var(--line)', fontSize: 14 }

export default function Profile({ profileId }) {
  const { user } = useAuth()
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    const { data: d, error } = await supabase.rpc('profile_page_data', { p_profile: profileId || null })
    if (error) setErr(/not allowed/i.test(error.message) ? "You don't have access to this profile." : error.message)
    else setData(d)
    setLoading(false)
  }, [profileId])
  useEffect(() => { load() }, [load])

  if (loading) return <p className="page-sub">Loading…</p>
  if (err) return <div className="login-err" role="alert">{err}</div>
  const { person, job_roles: roles, tokens, projects, tasks, open_task_count: openCount, is_self: isSelf } = data

  return (
    <div style={{ maxWidth: 900 }}>
      {!isSelf && (
        <div className="card" style={{ marginBottom: 14 }} role="note">
          You are viewing <b>{person.full_name}</b>'s profile as an Admin or Owner. Only they can change their own photo and phone number.
        </div>
      )}

      <div style={{ ...panel, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
          <PhotoBlock person={person} editable={isSelf} userId={user?.id} onChanged={(url) => setData(d => ({ ...d, person: { ...d.person, avatar_url: url } }))} />
          <div style={{ flex: 1, minWidth: 220 }}>
            <h1 className="page-title" style={{ margin: 0 }}>{person.full_name}</h1>
            <div style={{ fontSize: 15, marginTop: 2 }}>
              {person.job_title || <span style={{ color: 'var(--ink-soft)' }}>{isSelf ? 'No job title yet. An Admin sets this.' : 'No job title yet'}</span>}
            </div>
            {(person.status_text || person.status_emoji) && <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 2 }}>{person.status_emoji} {person.status_text}</div>}
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', marginBottom: 4 }}>Job roles</div>
              {roles.length === 0
                ? <span className="page-sub" style={{ margin: 0 }}>No shifts worked in the last 90 days, so there are no roles to show.</span>
                : <div className="tag-picker">{roles.map(r => <span key={r} className="tag-opt on" style={{ cursor: 'default' }}>{r}</span>)}</div>}
              {roles.length > 0 && <div className="hint" style={{ marginTop: 4 }}>From the shifts worked in the last 90 days.</div>}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16, marginBottom: 16 }}>
        <About person={person} isSelf={isSelf} onSaved={(phone) => setData(d => ({ ...d, person: { ...d.person, phone } }))} />
        <Tokens tokens={tokens} isSelf={isSelf} />
      </div>
      <Projects projects={projects} tasks={tasks} openCount={openCount} isSelf={isSelf} />
    </div>
  )
}

// ---------- photo (same storage and event as Settings) ----------
function PhotoBlock({ person, editable, userId, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const fileRef = useRef(null)
  const color = person.color || '#2563EB'

  async function onPick(e) {
    const file = e.target.files?.[0]
    if (fileRef.current) fileRef.current.value = ''
    if (!file) return
    setErr('')
    if (!file.type.startsWith('image/')) return setErr('Please choose an image file.')
    if (file.size > 5 * 1024 * 1024) return setErr('Please choose an image under 5 MB.')
    setBusy(true)
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
      const path = `${userId}/avatar-${Date.now()}.${ext}`     // a fresh name each time, so the old photo is never cached
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type })
      if (upErr) throw upErr
      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path)
      const url = pub?.publicUrl
      const { error: dbErr } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', userId)
      if (dbErr) throw dbErr
      onChanged(url)
      window.dispatchEvent(new CustomEvent('cc:avatar-updated', { detail: url }))
    } catch (e2) { setErr(e2?.message || 'Upload failed. Please try again.') } finally { setBusy(false) }
  }
  async function onRemove() {
    setBusy(true); setErr('')
    try {
      const { error } = await supabase.from('profiles').update({ avatar_url: null }).eq('id', userId)
      if (error) throw error
      onChanged(null)
      window.dispatchEvent(new CustomEvent('cc:avatar-updated', { detail: null }))
    } catch (e2) { setErr(e2?.message || 'Could not remove the photo.') } finally { setBusy(false) }
  }
  return (
    <div style={{ textAlign: 'center' }}>
      {person.avatar_url
        ? <img src={person.avatar_url} alt={person.full_name} style={{ width: 96, height: 96, borderRadius: '50%', objectFit: 'cover', boxShadow: '0 0 0 2px var(--line)' }} />
        : <span aria-label={`${person.full_name} (no photo)`} style={{ width: 96, height: 96, borderRadius: '50%', background: color + '22', color, fontSize: 34, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{initialsFrom(person.full_name)}</span>}
      {editable && (
        <div style={{ marginTop: 8, display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? 'Uploading…' : person.avatar_url ? 'Change photo' : 'Add photo'}</button>
          {person.avatar_url && <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} disabled={busy} onClick={onRemove}>Remove</button>}
          <input ref={fileRef} type="file" accept="image/*" aria-label="Choose a photo" onChange={onPick} style={{ display: 'none' }} />
        </div>
      )}
      {err && <div role="alert" style={{ marginTop: 8, fontSize: 12.5, color: 'var(--failed, #c0392b)', maxWidth: 180 }}>{err}</div>}
    </div>
  )
}

// ---------- details ----------
function About({ person, isSelf, onSaved }) {
  const [phone, setPhone] = useState(person.phone || '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const changed = phone.trim() !== (person.phone || '')
  async function save() {
    setErr(''); setMsg('')
    const v = phone.trim()
    if (v.length > 30 || !/^[0-9 +().-]*$/.test(v)) return setErr('Use digits, spaces and + - ( ) only, up to 30 characters.')
    setBusy(true)
    const { error } = await supabase.from('profiles').update({ phone: v || null }).eq('id', person.id)
    setBusy(false)
    if (error) return setErr(error.message)
    onSaved(v || null); setMsg('Phone number saved.'); setTimeout(() => setMsg(''), 3500)
  }
  return (
    <div style={panel}>
      <h2 style={sectionTitle}>About</h2>
      <div style={row}><span style={{ color: 'var(--ink-soft)' }}>Email</span><span>{person.email || 'Not set'}</span></div>
      <div style={{ ...row, alignItems: 'center' }}>
        <label htmlFor="pf-phone" style={{ color: 'var(--ink-soft)' }}>Phone</label>
        {isSelf ? (
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input id="pf-phone" value={phone} onChange={e => setPhone(e.target.value)} style={{ width: 170, padding: '6px 9px', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)' }} placeholder="Not set" />
            <button className="btn btn-primary" style={{ fontSize: 12.5, padding: '5px 12px' }} onClick={save} disabled={busy || !changed}>{busy ? 'Saving…' : 'Save'}</button>
          </span>
        ) : <span id="pf-phone">{person.phone || 'Not set'}</span>}
      </div>
      {err && <div role="alert" className="login-err" style={{ marginTop: 6 }}>{err}</div>}
      {msg && <div role="status" style={{ fontSize: 13, color: 'var(--passed)', marginTop: 6 }}>{msg}</div>}
      <div style={row}><span style={{ color: 'var(--ink-soft)' }}>Time zone</span><span>{person.timezone || 'Company time (Eastern)'}{isSelf && <> · <a href="/settings">Change in Settings</a></>}</span></div>
      <div style={row}><span style={{ color: 'var(--ink-soft)' }}>Start date</span><span>{person.start_date ? fmtDate(person.start_date) : 'Not set'}</span></div>
    </div>
  )
}

// ---------- tokens ----------
function Tokens({ tokens, isSelf }) {
  const w = tokens.wallet
  return (
    <div style={panel}>
      <h2 style={sectionTitle}>Tokens</h2>
      {!w ? <p className="page-sub" style={{ margin: 0 }}>No tokens yet.</p> : (
        <>
          <div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.1 }} aria-label="Token balance">{Number(w.balance).toLocaleString('en-US')}</div>
          <div className="page-sub" style={{ margin: '2px 0 8px' }}>{Number(w.lifetime_earned).toLocaleString('en-US')} earned · {Number(w.lifetime_redeemed).toLocaleString('en-US')} redeemed</div>
        </>
      )}
      {tokens.recent.length > 0 && <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', marginTop: 6 }}>Recent activity</div>}
      {tokens.recent.map((t, i) => (
        <div key={i} style={row}>
          <span>{t.reason || t.note || (t.kind === 'redeem' ? 'Redeemed' : 'Earned')}<span style={{ display: 'block', fontSize: 12, color: 'var(--ink-soft)' }}>{when(t.created_at)}</span></span>
          <span style={{ fontWeight: 700, color: t.delta >= 0 ? 'var(--passed)' : 'var(--ink)' }}>{t.delta >= 0 ? '+' : ''}{t.delta}</span>
        </div>
      ))}
      {isSelf && <div style={{ marginTop: 10 }}><a href="/tokens">Open Tokens</a></div>}
    </div>
  )
}

// ---------- projects and tasks ----------
function Projects({ projects, tasks, openCount, isSelf }) {
  return (
    <div style={panel}>
      <h2 style={sectionTitle}>Projects and open tasks</h2>
      {projects.length === 0 && tasks.length === 0 ? <p className="page-sub" style={{ margin: 0 }}>Not on any projects, and no open tasks.</p> : (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {projects.map(p => (
              <span key={p.id} className="badge" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color || 'var(--ink-soft)' }} />{p.name}
                {p.open_tasks > 0 && <span style={{ color: 'var(--ink-soft)' }}>· {p.open_tasks} open</span>}
              </span>))}
          </div>
          {tasks.length === 0 ? <p className="page-sub" style={{ margin: 0 }}>No open tasks.</p> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
                <thead><tr>{['Task', 'Project', 'Due', 'Status'].map(h => <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', borderBottom: '2px solid var(--line)' }}>{h}</th>)}</tr></thead>
                <tbody>
                  {tasks.map(t => (
                    <tr key={t.id}>
                      <td style={{ padding: '7px 8px', borderBottom: '1px solid var(--line)', fontSize: 13.5 }}>{t.name}</td>
                      <td style={{ padding: '7px 8px', borderBottom: '1px solid var(--line)', fontSize: 13.5, color: 'var(--ink-soft)' }}>{t.project_name || ''}</td>
                      <td style={{ padding: '7px 8px', borderBottom: '1px solid var(--line)', fontSize: 13.5, whiteSpace: 'nowrap' }}>{t.due_date ? fmtDate(t.due_date) : ''}</td>
                      <td style={{ padding: '7px 8px', borderBottom: '1px solid var(--line)', fontSize: 13.5 }}><span className={'badge' + (t.status === 'blocked' ? ' failed' : '')}>{STATUS[t.status] || t.status}</span></td>
                    </tr>))}
                </tbody>
              </table>
              {openCount > tasks.length && <p className="page-sub" style={{ margin: '8px 0 0' }}>Showing {tasks.length} of {openCount} open tasks, soonest due first.</p>}
            </div>
          )}
        </>
      )}
      {isSelf && <div style={{ marginTop: 10 }}><a href="/projects">Open Project Management</a></div>}
    </div>
  )
}
