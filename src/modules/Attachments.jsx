import React, { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useProjectsData } from './projectsData'
import { formatFileSize } from './projectHelpers'

// ============================================================
// ATTACHMENTS + DRIVE LINK — drops into the task detail panel.
// Files go to the `task-attachments` storage bucket.
// ============================================================

const MAX_MB = 50

function fileIcon(type) {
  if ((type || '').startsWith('video/')) return '🎬'
  if ((type || '').includes('pdf')) return '📄'
  if ((type || '').includes('word') || (type || '').includes('document')) return '📝'
  if ((type || '').includes('sheet') || (type || '').includes('excel')) return '📊'
  return '📎'
}

export default function Attachments({ taskId }) {
  const { attachments, setAttachments, tasks, setTasks, projects, userId, logActivity } = useProjectsData()
  const task = tasks.find(t => t.id === taskId)
  const items = attachments.filter(a => a.task_id === taskId)
  const [uploading, setUploading] = useState('')
  const [driveDraft, setDriveDraft] = useState(task?.drive_link || '')
  const fileRef = useRef(null)

  async function handleFiles(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    for (const file of files) {
      if (file.size > MAX_MB * 1024 * 1024) { window.alert(`${file.name} is over ${MAX_MB}MB — skipped`); continue }
      setUploading(`Uploading ${file.name}…`)
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `${userId}/${taskId}/${Date.now()}-${safeName}`
      const { error: upErr } = await supabase.storage.from('task-attachments').upload(path, file)
      if (upErr) { window.alert(`Failed to upload ${file.name}`); continue }
      const { data, error: insErr } = await supabase.from('task_attachments').insert({
        task_id: taskId, uploaded_by: userId, file_name: file.name,
        file_type: file.type, file_size: file.size, storage_path: path,
      }).select().single()
      if (insErr) { window.alert(`Failed to save ${file.name}`); continue }
      setAttachments(prev => [data, ...prev])
      if (task) {
        const proj = projects.find(p => p.id === task.project_id)
        logActivity('attached_file', taskId, task.name, task.project_id, proj?.name, file.name)
      }
    }
    setUploading('')
    if (fileRef.current) fileRef.current.value = ''
  }

  async function deleteAttachment(a) {
    if (!window.confirm('Delete this file?')) return
    await supabase.storage.from('task-attachments').remove([a.storage_path])
    await supabase.from('task_attachments').delete().eq('id', a.id)
    setAttachments(prev => prev.filter(x => x.id !== a.id))
  }

  async function saveDrive() {
    const url = driveDraft.trim()
    if (url && !/^https?:\/\//i.test(url)) { window.alert('Enter a valid URL starting with http(s)://'); return }
    await supabase.from('tasks').update({ drive_link: url || null }).eq('id', taskId)
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, drive_link: url || null } : t))
  }

  return (
    <>
      {/* Drive link */}
      <div style={{ marginBottom: 20 }}>
        <div style={sectionLabel}>Google Drive link</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input type="url" value={driveDraft} onChange={e => setDriveDraft(e.target.value)} placeholder="Paste a Google Drive link…"
            style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }} />
          <button onClick={saveDrive} className="btn btn-ghost" style={{ flexShrink: 0, fontSize: 12 }}>Save</button>
        </div>
        {task?.drive_link && (
          <a href={task.drive_link} target="_blank" rel="noopener noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 6, padding: '8px 10px', background: 'var(--bg-soft, #f7f7f5)', borderRadius: 8, border: '1px solid var(--line)', fontSize: 13, color: 'var(--accent)', textDecoration: 'none', maxWidth: '100%' }}>
            📄 <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.drive_link}</span>
          </a>
        )}
      </div>

      {/* Attachments */}
      <div style={{ marginBottom: 20 }}>
        <div style={sectionLabel}>Attachments</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
          {items.length === 0 ? <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>No files attached yet.</div> :
            items.map(a => {
              const isImage = (a.file_type || '').startsWith('image/')
              const { data } = supabase.storage.from('task-attachments').getPublicUrl(a.storage_path)
              const url = data?.publicUrl || '#'
              const canDelete = a.uploaded_by === userId
              return (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--bg-soft, #f7f7f5)', borderRadius: 8, border: '1px solid var(--line)' }}>
                  {isImage
                    ? <img src={url} alt="" style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
                    : <div style={{ width: 32, height: 32, borderRadius: 6, background: 'var(--accent-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{fileIcon(a.file_type)}</div>}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <a href={url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.file_name}</a>
                    <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{a.file_size ? formatFileSize(a.file_size) : ''}</div>
                  </div>
                  {canDelete && <button onClick={() => deleteAttachment(a)} style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--failed)', fontSize: 13 }}>🗑</button>}
                </div>
              )
            })}
        </div>
        <label className="btn btn-ghost" style={{ fontSize: 12, cursor: 'pointer', display: 'inline-flex', width: 'fit-content' }}>
          📎 Attach file
          <input ref={fileRef} type="file" multiple onChange={handleFiles} style={{ display: 'none' }} />
        </label>
        {uploading && <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 6 }}>{uploading}</div>}
      </div>
    </>
  )
}

const sectionLabel = { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink-soft)', marginBottom: 7 }
