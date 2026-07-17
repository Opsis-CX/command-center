import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { can, ROLES } from '../lib/permissions'

// TODO: replace with your real mock-call scheduling link (Calendly, Google
// appointment page, etc.) when you have it.
const MOCK_CALL_SCHEDULE_LINK = 'https://REPLACE-WITH-YOUR-SCHEDULING-LINK'

async function sendHiringEmail(kind, to, data) {
  try {
    const { error } = await supabase.functions.invoke('send-hiring-email', { body: { kind, to, data } })
    if (error) console.error('email send failed:', error)
  } catch (e) { console.error('email send failed:', e) }
}

// Reasons shown when deactivating (removing) someone. Edit freely.
const DEACTIVATION_REASONS = ['Resigned', 'Terminated', 'Attendance / No-show', 'Performance', 'Contract ended', 'Ghosted / Abandoned', 'Other']

export default function PeopleTags() {
  const { appRole, user } = useAuth()
  const canEdit = can(appRole, 'people_and_tags.edit')
  const canDelete = can(appRole, 'people_and_tags.delete')   // admin only
  const [tags, setTags] = useState([])
  const [people, setPeople] = useState([])
  const [taggables, setTaggables] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [newTagName, setNewTagName] = useState('')
  const [busyTag, setBusyTag] = useState(false)
  const [deletingTag, setDeletingTag] = useState(null)   // tag id being deleted
  const [showInactive, setShowInactive] = useState(true) // People & Tags manages inactive people too
  const [deactivating, setDeactivating] = useState(null) // person id in the deactivate flow
  const [deactReason, setDeactReason] = useState('')
  const [activeBusy, setActiveBusy] = useState(null)     // person id currently saving active state
  // Five9 setup: which person's form is open, and its field values
  const [five9Open, setFive9Open] = useState(null)   // person id
  const [five9User, setFive9User] = useState('')
  const [five9Pass, setFive9Pass] = useState('')
  const [five9Busy, setFive9Busy] = useState(false)
  const [five9Msg, setFive9Msg] = useState('')
  useEffect(() => { load() }, [])
  async function load() {
    setLoading(true); setErr('')
    try {
      const [tagsRes, peopleRes, tgRes] = await Promise.all([
        supabase.from('tags').select('*').order('name'),
        supabase.from('profiles').select('id, full_name, email, color, is_active, inactive_reason, five9_username, five9_sent_at, role')
          .order('full_name'),
        supabase.from('taggables').select('*').eq('entity_type', 'profile'),
      ])
      if (tagsRes.error) throw tagsRes.error
      if (peopleRes.error) throw peopleRes.error
      if (tgRes.error) throw tgRes.error
      setTags(tagsRes.data || [])
      setPeople(peopleRes.data || [])
      setTaggables(tgRes.data || [])
    } catch (e) {
      setErr(e.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }
  async function createTag() {
    if (!canEdit) return
    const name = newTagName.trim()
    if (!name) return
    setBusyTag(true); setErr('')
    try {
      const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
      const { error } = await supabase.from('tags').insert({ namespace: 'team', key, name })
      if (error) throw error
      setNewTagName('')
      await load()
    } catch (e) {
      setErr(e.message || 'Could not create tag')
    } finally {
      setBusyTag(false)
    }
  }
  // Admin-only. Deleting a tag also frees the people it's on. A tag that's still
  // assigned to certifications or Knowledge Base items is refused up front, so
  // those assignments are never silently removed — the admin clears them there
  // first. People-tag links (managed on this page) are cleaned up as part of it.
  async function deleteTag(tag) {
    if (!canDelete) return
    const peopleCount = taggables.filter(t => t.tag_id === tag.id).length

    // Refuse if the tag is still used by certifications or the knowledge base.
    let certCount = 0, kbCount = 0
    try {
      const [caRes, kfRes, kaRes] = await Promise.all([
        supabase.from('certification_assignments').select('id', { count: 'exact', head: true }).eq('tag_id', tag.id),
        supabase.from('kb_folder_tags').select('folder_id', { count: 'exact', head: true }).eq('tag_id', tag.id),
        supabase.from('kb_article_tags').select('article_id', { count: 'exact', head: true }).eq('tag_id', tag.id),
      ])
      certCount = caRes.count || 0
      kbCount = (kfRes.count || 0) + (kaRes.count || 0)
    } catch (_) { /* if a check can't run, fall through — the FK will still protect the delete */ }

    if (certCount > 0 || kbCount > 0) {
      const parts = []
      if (certCount) parts.push(`${certCount} certification${certCount === 1 ? '' : 's'}`)
      if (kbCount) parts.push(`${kbCount} Knowledge Base item${kbCount === 1 ? '' : 's'}`)
      setErr(`"${tag.name}" is still assigned to ${parts.join(' and ')}. Remove it there first, then delete the tag.`)
      return
    }

    if (!window.confirm(`Delete the tag "${tag.name}"?\n\nIt will be removed from ${peopleCount} ${peopleCount === 1 ? 'person' : 'people'}. This can't be undone.`)) return

    setDeletingTag(tag.id); setErr('')
    try {
      if (peopleCount > 0) {
        const { error: tgErr } = await supabase.from('taggables').delete().eq('tag_id', tag.id)
        if (tgErr) throw tgErr
      }
      const { error } = await supabase.from('tags').delete().eq('id', tag.id)
      if (error) throw error
      setTags(prev => prev.filter(t => t.id !== tag.id))
      setTaggables(prev => prev.filter(t => t.tag_id !== tag.id))
    } catch (e) {
      setErr(e.message || 'Could not delete tag')
      load()
    } finally {
      setDeletingTag(null)
    }
  }
  // Admin-only: change a person's permission role. Optimistic update, then
  // persist. RLS on profiles must restrict role writes to admins (see notes).
  const [roleBusy, setRoleBusy] = useState(null)   // person id currently saving
  async function changeRole(personId, nextRole) {
    if (!canEdit) return
    const prev = people
    setPeople(ps => ps.map(p => p.id === personId ? { ...p, role: nextRole } : p))
    setRoleBusy(personId); setErr('')
    try {
      const { error } = await supabase.from('profiles').update({ role: nextRole }).eq('id', personId)
      if (error) throw error
    } catch (e) {
      setPeople(prev)                               // roll back on failure
      setErr(e.message || 'Could not update role')
    } finally {
      setRoleBusy(null)
    }
  }

  // Deactivate ("remove") a person with a reason, or bring them back. Soft — the
  // profile and all their history stay; they just drop out of active views.
  async function setActive(personId, active, reason) {
    if (!canEdit) return
    const prev = people
    const patch = active
      ? { is_active: true, inactive_reason: null, deactivated_at: null, deactivated_by: null }
      : { is_active: false, inactive_reason: reason || null, deactivated_at: new Date().toISOString(), deactivated_by: user?.id || null }
    setPeople(ps => ps.map(p => p.id === personId ? { ...p, ...patch } : p))
    setActiveBusy(personId); setErr('')
    try {
      const { error } = await supabase.from('profiles').update(patch).eq('id', personId)
      if (error) throw error
      setDeactivating(null); setDeactReason('')
    } catch (e) {
      setPeople(prev)
      setErr(e.message || 'Could not update this person')
    } finally { setActiveBusy(null) }
  }

  function personHasTag(personId, tagId) {
    return taggables.some(t => t.entity_id === personId && t.tag_id === tagId)
  }
  async function toggleTag(personId, tagId) {
    if (!canEdit) return
    const existing = taggables.find(t => t.entity_id === personId && t.tag_id === tagId)
    try {
      if (existing) {
        setTaggables(prev => prev.filter(t => t.id !== existing.id))
        const { error } = await supabase.from('taggables').delete().eq('id', existing.id)
        if (error) throw error
      } else {
        const { data, error } = await supabase.from('taggables')
          .insert({ tag_id: tagId, entity_type: 'profile', entity_id: personId })
          .select().single()
        if (error) throw error
        setTaggables(prev => [...prev, data])
      }
    } catch (e) {
      setErr(e.message || 'Could not update tag')
      load()
    }
  }
  // Send Five9 credentials to a person, then clear the temp password from the
  // database (it's single-use — they reset on first login) and advance their
  // hiring record to the mock-call stage.
  function openFive9(person) {
    setFive9Open(person.id)
    setFive9User(person.five9_username || '')
    setFive9Pass('')
    setFive9Msg('')
  }
  async function sendFive9(person) {
    if (!canEdit) return
    if (!five9User.trim() || !five9Pass.trim()) { setFive9Msg('Enter both a username and a temporary password.'); return }
    setFive9Busy(true); setFive9Msg('')
    try {
      // store username + temp password briefly
      await supabase.from('profiles').update({
        five9_username: five9User.trim(),
        five9_temp_password: five9Pass.trim(),
        five9_sent_at: new Date().toISOString(),
      }).eq('id', person.id)

      // email the agent their credentials + scheduling link
      await sendHiringEmail('five9_credentials', person.email, {
        name: person.full_name,
        username: five9User.trim(),
        tempPassword: five9Pass.trim(),
        scheduleLink: MOCK_CALL_SCHEDULE_LINK,
      })

      // clear the temp password now that it's been sent (single-use)
      await supabase.from('profiles').update({ five9_temp_password: null }).eq('id', person.id)

      // advance their hiring record (matched by email) to mock-call requested
      const { data: apps } = await supabase.from('hiring_applications')
        .select('id, status').eq('email', person.email).order('created_at', { ascending: false }).limit(1)
      const app = apps && apps[0]
      if (app) {
        await supabase.from('hiring_applications').update({ status: 'mock_requested' }).eq('id', app.id)
        await supabase.from('hiring_stage_events').insert({
          application_id: app.id, from_status: app.status, to_status: 'mock_requested',
          note: 'Five9 credentials sent; mock call requested',
        })
      }

      setFive9Msg('✓ Credentials sent. The temporary password was cleared from the database.')
      setFive9Pass('')
      await load()
    } catch (e) {
      setFive9Msg(e.message || 'Could not send credentials.')
    } finally {
      setFive9Busy(false)
    }
  }
  const initials = (n) => (n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">People &amp; tags</h1>
        <p className="page-sub">Create tags, then tag people. Certifications assigned to a tag reach everyone who has it.</p>
      </div>
      {!canEdit && (
        <div className="card" style={{ background: 'var(--accent-bg, rgba(0,119,182,.06))', border: '1px solid var(--line)', marginBottom: 16, padding: '10px 14px', fontSize: 13 }}>
          👁 You have view-only access to this page.
        </div>
      )}
      {err && (
        <div className="card" style={{ borderColor: 'var(--failed)', marginBottom: 16 }}>
          <b style={{ color: 'var(--failed)' }}>Something went wrong.</b>
          <p className="page-sub" style={{ marginTop: 6 }}>{err}</p>
        </div>
      )}
      {loading ? <p className="page-sub">Loading…</p> : (
        <>
          <div className="card" style={{ marginBottom: 20 }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 600 }}>Tags</h3>
            <p className="page-sub" style={{ marginBottom: 14 }}>
              These are the groups you assign certifications to.{canDelete ? ' Click the × on a tag to delete it (admins only).' : ''}
            </p>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <input
                value={newTagName}
                onChange={e => setNewTagName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') createTag() }}
                placeholder="New tag name, e.g. GarageCo Setter"
                style={{ flex: 1, padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', fontSize: 14, fontFamily: 'inherit', outline: 'none' }}
              />
              <button className="btn btn-primary" onClick={createTag} disabled={busyTag}>
                {busyTag ? 'Adding…' : 'Add tag'}
              </button>
            </div>
            {tags.length === 0 ? (
              <p className="page-sub">No tags yet. Add your first one above.</p>
            ) : (
              <div className="tag-picker">
                {tags.map(t => (
                  <span key={t.id} className="tag-opt on"
                    style={{ cursor: 'default', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {t.name}
                    {canDelete && (
                      <button type="button" onClick={() => deleteTag(t)} disabled={deletingTag === t.id}
                        title={`Delete "${t.name}"`} aria-label={`Delete ${t.name}`}
                        style={{ border: 0, background: 'transparent', color: 'inherit', cursor: deletingTag === t.id ? 'default' : 'pointer', fontSize: 15, lineHeight: 1, padding: '0 0 0 2px', opacity: deletingTag === t.id ? 0.4 : 0.65 }}>
                        {deletingTag === t.id ? '…' : '×'}
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
              <div>
                <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 600 }}>People</h3>
                <p className="page-sub" style={{ margin: 0 }}>Click a tag under each person to add or remove it.</p>
              </div>
              {people.some(x => !x.is_active) && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--ink-soft)', cursor: 'pointer', flex: 'none' }}>
                  <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
                  Show inactive ({people.filter(x => !x.is_active).length})
                </label>
              )}
            </div>
            {(showInactive ? people : people.filter(x => x.is_active)).length === 0 ? (
              <p className="page-sub">No people to show.</p>
            ) : (showInactive ? people : people.filter(x => x.is_active)).map(p => (
              <div key={p.id} style={{ padding: '14px 0', borderBottom: '1px solid var(--line-soft)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <span style={{ width: 30, height: 30, borderRadius: '50%', background: p.color || 'var(--blue)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, flex: 'none' }}>
                    {initials(p.full_name)}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>
                      {p.full_name}
                      {!p.is_active && <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 700, color: 'var(--ink-soft)', background: 'var(--line-soft)', padding: '1px 7px', borderRadius: 999 }}>Inactive{p.inactive_reason ? ' · ' + p.inactive_reason : ''}</span>}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{p.email}</div>
                  </div>
                  <button type="button" className="btn btn-ghost" style={{ fontSize: 12.5 }}
                    onClick={() => five9Open === p.id ? setFive9Open(null) : openFive9(p)}>
                    {p.five9_sent_at ? 'Five9 ✓' : 'Five9 setup'}
                  </button>
                  {canEdit ? (
                    <select
                      value={p.role || 'agent'}
                      disabled={roleBusy === p.id}
                      onChange={e => changeRole(p.id, e.target.value)}
                      title="Permission role"
                      style={{ fontSize: 12.5, padding: '6px 8px', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', fontFamily: 'inherit', background: 'var(--canvas)', color: 'var(--ink)', cursor: 'pointer', flex: 'none' }}>
                      {ROLES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
                    </select>
                  ) : (
                    <span style={{ fontSize: 12, color: 'var(--ink-soft)', flex: 'none' }}>
                      {(ROLES.find(r => r.key === (p.role || 'agent')) || {}).label}
                    </span>
                  )}
                  {canEdit && (p.is_active ? (
                    <button type="button" className="btn btn-ghost"
                      style={{ fontSize: 12.5, color: 'var(--failed)', flex: 'none' }}
                      disabled={activeBusy === p.id}
                      onClick={() => { setDeactivating(deactivating === p.id ? null : p.id); setDeactReason('') }}>
                      Deactivate
                    </button>
                  ) : (
                    <button type="button" className="btn btn-ghost"
                      style={{ fontSize: 12.5, flex: 'none' }}
                      disabled={activeBusy === p.id}
                      onClick={() => setActive(p.id, true)}>
                      {activeBusy === p.id ? 'Reactivating…' : 'Reactivate'}
                    </button>
                  ))}
                </div>

                {deactivating === p.id && canEdit && (
                  <div style={{ background: 'var(--canvas)', border: '1px solid var(--line)', borderRadius: 8, padding: 14, margin: '4px 0 12px' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Deactivate {p.full_name}?</div>
                    <p style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '0 0 12px', lineHeight: 1.5 }}>
                      They’ll be removed from active lists (schedule, scorecards, etc.) but their history is kept. You can reactivate them anytime.
                    </p>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <select value={deactReason} onChange={e => setDeactReason(e.target.value)}
                        style={{ fontSize: 13, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--ink)' }}>
                        <option value="">Reason for removal…</option>
                        {DEACTIVATION_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                      <button className="btn btn-primary" style={{ background: 'var(--failed)' }}
                        disabled={!deactReason || activeBusy === p.id}
                        onClick={() => setActive(p.id, false, deactReason)}>
                        {activeBusy === p.id ? 'Removing…' : 'Deactivate'}
                      </button>
                      <button className="btn btn-ghost" onClick={() => { setDeactivating(null); setDeactReason('') }}>Cancel</button>
                    </div>
                  </div>
                )}

                {five9Open === p.id && (
                  <div style={{ background: 'var(--canvas)', border: '1px solid var(--line)', borderRadius: 8, padding: 14, margin: '4px 0 12px' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Send Five9 login to {p.full_name}</div>
                    <p style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '0 0 12px', lineHeight: 1.5 }}>
                      Enter the temporary Five9 username and password. We'll email them to {p.email}, ask them to reset the password on first login, and include the mock-call scheduling link. The temporary password is cleared from the database right after sending.
                    </p>
                    <div style={{ display: 'grid', gap: 10, maxWidth: 360 }}>
                      <input value={five9User} onChange={e => setFive9User(e.target.value)} placeholder="Five9 username"
                        style={{ padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 14, fontFamily: 'inherit' }} />
                      <input value={five9Pass} onChange={e => setFive9Pass(e.target.value)} placeholder="Temporary password"
                        style={{ padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 14, fontFamily: 'inherit' }} />
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <button className="btn btn-primary" onClick={() => sendFive9(p)} disabled={five9Busy}>
                          {five9Busy ? 'Sending…' : 'Send credentials'}
                        </button>
                        <button className="btn btn-ghost" onClick={() => setFive9Open(null)}>Cancel</button>
                      </div>
                      {five9Msg && <div style={{ fontSize: 12.5, color: five9Msg.startsWith('✓') ? '#16A34A' : 'var(--failed)' }}>{five9Msg}</div>}
                    </div>
                  </div>
                )}

                {tags.length === 0 ? (
                  <div className="page-sub" style={{ fontSize: 12.5 }}>Create tags above first.</div>
                ) : (
                  <div className="tag-picker">
                    {tags.map(t => (
                      <button type="button" key={t.id}
                        className={'tag-opt' + (personHasTag(p.id, t.id) ? ' on' : '')}
                        onClick={() => toggleTag(p.id, t.id)}>
                        {t.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
