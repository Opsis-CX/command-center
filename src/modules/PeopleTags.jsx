import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function PeopleTags() {
  const [tags, setTags] = useState([])
  const [people, setPeople] = useState([])
  const [taggables, setTaggables] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [newTagName, setNewTagName] = useState('')
  const [busyTag, setBusyTag] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setErr('')
    try {
      const [tagsRes, peopleRes, tgRes] = await Promise.all([
        supabase.from('tags').select('*').order('name'),
        supabase.from('profiles').select('id, full_name, email, color, is_active')
          .eq('is_active', true).order('full_name'),
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

  function personHasTag(personId, tagId) {
    return taggables.some(t => t.entity_id === personId && t.tag_id === tagId)
  }

  async function toggleTag(personId, tagId) {
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

  const initials = (n) => (n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">People &amp; tags</h1>
        <p className="page-sub">Create tags, then tag people. Certifications assigned to a tag reach everyone who has it.</p>
      </div>

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
            <p className="page-sub" style={{ marginBottom: 14 }}>These are the groups you assign certifications to.</p>
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
                  <span key={t.id} className="tag-opt on" style={{ cursor: 'default' }}>{t.name}</span>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 600 }}>People</h3>
            <p className="page-sub" style={{ marginBottom: 14 }}>Click a tag under each person to add or remove it.</p>
            {people.length === 0 ? (
              <p className="page-sub">No active people found.</p>
            ) : people.map(p => (
              <div key={p.id} style={{ padding: '14px 0', borderBottom: '1px solid var(--line-soft)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <span style={{ width: 30, height: 30, borderRadius: '50%', background: p.color || 'var(--blue)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, flex: 'none' }}>
                    {initials(p.full_name)}
                  </span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{p.full_name}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{p.email}</div>
                  </div>
                </div>
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
