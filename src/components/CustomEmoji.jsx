import React, { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import EmojiPicker from 'emoji-picker-react'
import { supabase } from '../lib/supabase'

// ============================================================
// CUSTOM EMOJIS (Slack-style)
//
// Anyone on staff can upload an image and give it a name like `ty`. It then:
//   - shows in a "Custom" tab of every chat emoji picker (composer + reactions)
//   - renders as the image wherever `:ty:` appears in a chat message
//   - works as a reaction (stored in message_reactions.emoji as ":ty:")
//
// DB (already live): table public.custom_emojis (shortcode ^[a-z0-9_]{2,32}$,
// unique; image_url; storage_path; created_by) + public bucket `custom-emojis`
// (1 MB, png/gif/webp/jpeg; path must start with the uploader's uid).
// RLS: everyone on the team reads; staff insert their own; owner or admin deletes.
// ============================================================

export const SHORTCODE_RE = /^[a-z0-9_]{2,32}$/
const TOKEN_RE = /:([a-z0-9_]{2,32}):/g

// ---- shared cache: one fetch + one realtime channel for the whole app ----
let cache = null           // array of rows, or null before first load
let loading = null
const listeners = new Set()
let channel = null

function emit() { listeners.forEach(fn => fn(cache || [])) }

async function load() {
  const { data, error } = await supabase.from('custom_emojis')
    .select('id, shortcode, image_url, storage_path, created_by, created_at')
    .order('shortcode')
  if (!error) { cache = data || []; emit() }
  return cache || []
}

function ensureLoaded() {
  if (!loading) loading = load()
  if (!channel) {
    channel = supabase.channel('custom-emojis')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'custom_emojis' }, () => load())
      .subscribe()
  }
  return loading
}

export function reloadCustomEmojis() { return load() }

export function useCustomEmojis() {
  const [list, setList] = useState(cache || [])
  useEffect(() => {
    listeners.add(setList)
    ensureLoaded()
    if (cache) setList(cache)
    return () => { listeners.delete(setList) }
  }, [])
  const map = {}
  list.forEach(e => { map[e.shortcode] = e.image_url })
  return { list, map }
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Swap :shortcode: for <img> in ALREADY-SANITIZED html. Only touches text
// between tags, and never inside <code>/<pre>, so it can't break markup.
export function replaceShortcodes(html, map) {
  if (!html || !map || !Object.keys(map).length || html.indexOf(':') === -1) return html
  let inCode = 0
  return html.split(/(<[^>]*>)/g).map(part => {
    if (part.startsWith('<')) {
      if (/^<(code|pre)\b/i.test(part)) inCode++
      else if (/^<\/(code|pre)>/i.test(part)) inCode = Math.max(0, inCode - 1)
      return part
    }
    if (inCode) return part
    return part.replace(TOKEN_RE, (m, code) => map[code]
      ? `<img class="custom-emoji" src="${esc(map[code])}" alt=":${code}:" title=":${code}:" />`
      : m)
  }).join('')
}

// One emoji glyph: native character, or the image for ":shortcode:".
export function EmojiGlyph({ emoji, map, size = 16 }) {
  const m = /^:([a-z0-9_]{2,32}):$/.exec(emoji || '')
  if (m && map && map[m[1]]) {
    return <img src={map[m[1]]} alt={emoji} title={emoji}
      style={{ width: size, height: size, objectFit: 'contain', verticalAlign: 'middle' }} />
  }
  return <span className="chat-emoji" style={{ fontSize: size - 2 }}>{emoji}</span>
}

// Drop-in replacement for <EmojiPicker> in chat: adds the Custom tab and an
// "Add custom emoji" button under the picker. onPick receives the native
// character, or ":shortcode:" for a custom one.
export function ChatEmojiPicker({ onPick, width, height, reactionsDefaultOpen }) {
  const { list } = useCustomEmojis()
  const [managing, setManaging] = useState(false)
  const customEmojis = list.map(e => ({ id: ':' + e.shortcode + ':', names: [e.shortcode], imgUrl: e.image_url }))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width, background: 'var(--surface)', borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,.14)' }}>
      <EmojiPicker
        onEmojiClick={(e) => onPick(e.emoji)}
        customEmojis={customEmojis}
        width={width} height={height}
        previewConfig={{ showPreview: false }}
        reactionsDefaultOpen={reactionsDefaultOpen} />
      <button type="button" onClick={() => setManaging(true)}
        style={{ border: '1px solid var(--line)', borderTop: 0, background: 'var(--surface)', color: 'var(--accent)', fontWeight: 600, fontSize: 12.5, padding: '7px 10px', cursor: 'pointer', fontFamily: 'inherit', borderRadius: '0 0 8px 8px', textAlign: 'left' }}>
        ＋ Add custom emoji
      </button>
      {managing && <CustomEmojiManager onClose={() => setManaging(false)} />}
    </div>
  )
}

// Resize a still image to fit 128×128 (keeps aspect, PNG). GIFs are left alone
// so animation survives — they just have to be under the 1 MB bucket limit.
async function prepareImage(file) {
  if (file.type === 'image/gif') return { blob: file, ext: 'gif', type: 'image/gif' }
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url })
    const scale = Math.min(1, 128 / Math.max(img.width, img.height))
    const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale))
    const c = document.createElement('canvas'); c.width = w; c.height = h
    c.getContext('2d').drawImage(img, 0, 0, w, h)
    const blob = await new Promise(res => c.toBlob(res, 'image/png'))
    return { blob, ext: 'png', type: 'image/png' }
  } finally { URL.revokeObjectURL(url) }
}

function nameFromFile(f) {
  return (f.name || '').replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32)
}

export function CustomEmojiManager({ onClose }) {
  const { list } = useCustomEmojis()
  const [me, setMe] = useState(null)       // { id, is_admin }
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [filter, setFilter] = useState('')
  const fileRef = useRef(null)

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase.from('profiles').select('id, is_admin').eq('id', user.id).single()
      setMe(data || { id: user.id, is_admin: false })
    })()
  }, [])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  function choose(f) {
    setErr('')
    if (!f) return
    if (!/^image\/(png|gif|webp|jpeg)$/.test(f.type)) { setErr('Use a PNG, JPG, GIF or WebP image.'); return }
    if (f.type === 'image/gif' && f.size > 1024 * 1024) { setErr('GIFs must be under 1 MB.'); return }
    setFile(f); setPreview(URL.createObjectURL(f))
    if (!name) setName(nameFromFile(f))
  }

  const clean = name.trim().toLowerCase().replace(/^:+|:+$/g, '')
  const taken = list.some(e => e.shortcode === clean)
  const valid = SHORTCODE_RE.test(clean) && !taken

  async function save() {
    if (!file || !valid || !me || busy) return
    setBusy(true); setErr('')
    try {
      const { blob, ext, type } = await prepareImage(file)
      if (blob.size > 1024 * 1024) throw new Error('Image is over 1 MB after resizing.')
      const path = `${me.id}/${clean}-${Date.now()}.${ext}`
      const up = await supabase.storage.from('custom-emojis').upload(path, blob, { contentType: type, upsert: false })
      if (up.error) throw up.error
      const { data: pub } = supabase.storage.from('custom-emojis').getPublicUrl(path)
      const ins = await supabase.from('custom_emojis').insert({ shortcode: clean, image_url: pub.publicUrl, storage_path: path, created_by: me.id })
      if (ins.error) {
        await supabase.storage.from('custom-emojis').remove([path])
        throw ins.error.code === '23505' ? new Error(`:${clean}: is already taken.`) : ins.error
      }
      await reloadCustomEmojis()
      setFile(null); setPreview(null); setName('')
    } catch (e) {
      setErr(/row-level security|policy|unauthorized|403/i.test(e.message || '') ? 'Only Opsis CX staff can add custom emoji.' : (e.message || 'Upload failed.'))
    } finally { setBusy(false) }
  }

  async function remove(e) {
    if (!window.confirm(`Delete :${e.shortcode}:? Messages and reactions that use it will show the text instead.`)) return
    const del = await supabase.from('custom_emojis').delete().eq('id', e.id).select()
    if (del.error || !del.data?.length) { setErr('Could not delete — only the person who added it or an admin can.'); return }
    if (e.storage_path) await supabase.storage.from('custom-emojis').remove([e.storage_path])
    reloadCustomEmojis()
  }

  const shown = list.filter(e => !filter || e.shortcode.includes(filter.toLowerCase()))

  return createPortal(
    <div onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.35)', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div style={{ background: 'var(--surface)', color: 'var(--ink)', borderRadius: 12, width: 'min(460px, 100%)', maxHeight: '86vh', display: 'flex', flexDirection: 'column', boxShadow: '0 12px 40px rgba(0,0,0,.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ fontWeight: 700, fontSize: 15, flex: 1 }}>Custom emoji</div>
          <button type="button" onClick={onClose} style={{ border: 0, background: 'transparent', fontSize: 20, cursor: 'pointer', color: 'var(--ink-soft)' }}>×</button>
        </div>

        <div style={{ padding: 16, borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <button type="button" onClick={() => fileRef.current?.click()} title="Choose image"
              style={{ width: 72, height: 72, flex: 'none', border: '1px dashed var(--line)', borderRadius: 10, background: 'var(--surface)', cursor: 'pointer', display: 'grid', placeItems: 'center', color: 'var(--ink-soft)', fontSize: 12 }}>
              {preview ? <img src={preview} alt="" style={{ maxWidth: 56, maxHeight: 56, objectFit: 'contain' }} /> : 'Choose image'}
            </button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" style={{ display: 'none' }}
              onChange={e => { choose(e.target.files?.[0]); e.target.value = '' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <label style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Name</label>
              <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--line)', borderRadius: 8, padding: '0 8px', marginTop: 3 }}>
                <span style={{ color: 'var(--ink-soft)' }}>:</span>
                <input value={name} onChange={e => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_:]/g, '_'))}
                  placeholder="ty" maxLength={34}
                  onKeyDown={e => { if (e.key === 'Enter') save() }}
                  style={{ flex: 1, border: 0, outline: 'none', padding: '7px 2px', background: 'transparent', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 14 }} />
                <span style={{ color: 'var(--ink-soft)' }}>:</span>
              </div>
              <div style={{ fontSize: 11.5, marginTop: 4, color: clean && !valid ? '#dc2626' : 'var(--ink-soft)' }}>
                {taken ? `:${clean}: is already taken` : clean && !SHORTCODE_RE.test(clean) ? '2–32 characters: lowercase letters, numbers, _' : 'Type this name between colons in a message to use it.'}
              </div>
            </div>
          </div>
          {err && <div style={{ color: '#dc2626', fontSize: 12.5, marginTop: 10 }}>{err}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="btn btn-primary" disabled={!file || !valid || busy || !me} onClick={save}>
              {busy ? 'Saving…' : 'Save emoji'}
            </button>
          </div>
        </div>

        <div style={{ padding: '10px 16px 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', flex: 1 }}>{list.length} custom emoji</div>
          {list.length > 8 && <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search"
            style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '4px 8px', fontSize: 12.5, width: 130, background: 'var(--surface)', color: 'var(--ink)' }} />}
        </div>
        <div style={{ overflowY: 'auto', padding: '4px 16px 16px' }}>
          {!list.length && <div style={{ fontSize: 13, color: 'var(--ink-soft)', padding: '6px 0' }}>None yet — add the first one above.</div>}
          {shown.map(e => {
            const canDelete = me && (e.created_by === me.id || me.is_admin)
            return (
              <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', borderBottom: '1px solid var(--line)' }}>
                <img src={e.image_url} alt="" style={{ width: 24, height: 24, objectFit: 'contain' }} />
                <span style={{ flex: 1, fontSize: 13.5 }}>:{e.shortcode}:</span>
                {canDelete && <button type="button" onClick={() => remove(e)}
                  style={{ border: 0, background: 'transparent', color: '#dc2626', cursor: 'pointer', fontSize: 12.5 }}>Delete</button>}
              </div>
            )
          })}
        </div>
      </div>
    </div>,
    document.body
  )
}
