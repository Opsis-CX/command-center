import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

// ============================================================
// Service account — admin control panel.
// The account automated reports and alerts post as (default "Turri 🪼"),
// so they stop showing up under a real person's name.
//
// - Settings live in service_account_settings (admins can read; writes go
//   through the service-account edge function, which also creates the profile).
// - The account can never sign in: its login is banned and the profile is
//   inactive, which also keeps it out of rosters, pickers and schedules.
// - Automations find it with public.service_account_id(); scripts and
//   scheduled tasks can post with public.post_as_service(channel, html).
// ============================================================

const EMOJIS = ['🪼', '🤖', '📣', '📊', '🛎️', '⚙️', '🦉', '🐙', '🌊', '✨', '🚀', '💡', '📋', '🔔', '🧭', '🫧']

function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  const d = Math.floor(s / 86400)
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function ServiceAccount() {
  const { isAdmin } = useAuth()
  const [loading, setLoading] = useState(true)
  const [settings, setSettings] = useState(null)
  const [name, setName] = useState('Turri')
  const [emoji, setEmoji] = useState('🪼')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null) // { ok, text }
  const [posts, setPosts] = useState([])

  useEffect(() => { if (isAdmin) load() }, [isAdmin])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('service_account_settings').select('*').maybeSingle()
    setSettings(data || null)
    if (data) { setName(data.name || 'Turri'); setEmoji(data.emoji || '') }
    if (data?.profile_id) {
      const { data: p } = await supabase.rpc('service_account_recent_posts', { p_limit: 15 })
      setPosts(p || [])
    } else setPosts([])
    setLoading(false)
  }

  async function save() {
    setSaving(true); setMsg(null)
    const { data, error } = await supabase.functions.invoke('service-account', { body: { name: name.trim(), emoji: emoji.trim() } })
    let err = error?.message || data?.error
    if (error) { try { const j = await error.context?.json?.(); if (j?.error) err = j.error } catch { /* ignore */ } }
    setSaving(false)
    if (err) { setMsg({ ok: false, text: err }); return }
    setMsg({ ok: true, text: data.created ? `${data.display_name} is set up. Automated posts will use it from now on.` : `Saved — automated posts now show as ${data.display_name}.` })
    load()
  }

  if (!isAdmin) return <div className="page-sub" style={{ padding: 30 }}>This page is for admins.</div>
  if (loading) return <div className="page-sub" style={{ padding: 30 }}>Loading…</div>

  const exists = !!settings?.profile_id
  const display = emoji.trim() ? `${name.trim() || 'Turri'} ${emoji.trim()}` : (name.trim() || 'Turri')
  const changed = !exists || name.trim() !== (settings?.name || '') || emoji.trim() !== (settings?.emoji || '')
  const valid = name.trim().length > 0 && name.trim().length <= 40

  return (
    <div style={{ maxWidth: 680 }}>
      <h2 style={{ fontSize: 20, marginBottom: 4 }}>Service account</h2>
      <p className="page-sub" style={{ marginTop: 0, marginBottom: 20 }}>
        The name automated reports, reminders and alerts post as — so they don't show up as a real person.
      </p>

      {/* Status */}
      <div className="card" style={{ padding: 16, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, borderLeft: `4px solid ${exists ? '#16A34A' : '#D97706'}` }}>
        <span style={{ fontSize: 22 }}>{exists ? '✅' : '⚠️'}</span>
        <div style={{ fontSize: 13.5 }}>
          {exists
            ? <>Active. Automated posts appear as <b>{settings.emoji ? `${settings.name} ${settings.emoji}` : settings.name}</b>.</>
            : <>Not set up yet. Until it is, automated posts keep using a person's account. Choose a name below and click <b>Create service account</b>.</>}
        </div>
      </div>

      {/* Editor */}
      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 14 }}>{exists ? 'Name & emoji' : 'Set it up'}</div>

        <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 6 }}>Name</label>
        <input value={name} maxLength={40} onChange={e => setName(e.target.value)} placeholder="Turri"
          style={{ width: '100%', boxSizing: 'border-box', padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 14 }} />

        <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--ink-soft)', margin: '16px 0 6px' }}>Emoji</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
          {EMOJIS.map(e => (
            <button key={e} onClick={() => setEmoji(e)} title={e}
              style={{ width: 36, height: 36, fontSize: 18, borderRadius: 8, cursor: 'pointer', border: emoji === e ? '2px solid var(--accent)' : '1px solid var(--line)', background: emoji === e ? 'var(--accent-bg)' : 'var(--surface)' }}>{e}</button>
          ))}
          <input value={EMOJIS.includes(emoji) ? '' : emoji} maxLength={8} onChange={e => setEmoji(e.target.value)} placeholder="Other"
            style={{ width: 70, height: 36, boxSizing: 'border-box', textAlign: 'center', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 15 }} />
          <button onClick={() => setEmoji('')}
            style={{ height: 36, padding: '0 10px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', color: 'var(--ink-soft)', border: !emoji ? '2px solid var(--accent)' : '1px solid var(--line)', background: !emoji ? 'var(--accent-bg)' : 'var(--surface)' }}>No emoji</button>
        </div>

        {/* Preview: looks like a chat message */}
        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-soft)', margin: '18px 0 8px' }}>Preview in chat</div>
        <div style={{ display: 'flex', gap: 10, padding: 12, border: '1px dashed var(--line)', borderRadius: 10, background: 'var(--canvas)' }}>
          <span style={{ width: 36, height: 36, borderRadius: '50%', background: '#0891B2', color: '#fff', display: 'grid', placeItems: 'center', fontSize: emoji.trim() ? 19 : 14, fontWeight: 700, flex: 'none' }}>
            {emoji.trim() || (name.trim()[0] || 'T').toUpperCase()}
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13.5 }}><b>{display}</b> <span className="page-sub" style={{ fontSize: 11.5 }}>8:00 AM</span></div>
            <div style={{ fontSize: 13.5, marginTop: 2 }}>📋 Hiring Pipeline — Morning Report · …</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 18, flexWrap: 'wrap' }}>
          <button className="btn" disabled={saving || !valid || !changed} onClick={save}>
            {saving ? 'Saving…' : exists ? 'Save changes' : 'Create service account'}
          </button>
          {msg && <span style={{ fontSize: 13, color: msg.ok ? 'var(--passed, #16A34A)' : '#DC2626' }}>{msg.ok ? '✓ ' : ''}{msg.text}</span>}
        </div>
        {exists && <p className="page-sub" style={{ fontSize: 12, marginBottom: 0, marginTop: 12 }}>Renaming updates the name on every past and future post.</p>}
      </div>

      {/* Facts */}
      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Good to know</div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.6 }}>
          <li><b>It can't sign in.</b> Nobody has its password and its login is blocked.</li>
          <li><b>It stays out of the way.</b> It won't appear in people lists, schedules, scorecards or DM pickers.</li>
          <li><b>Posting as it today:</b> Hiring Pipeline morning report, GarageCo Affiliate daily report, Speed-to-Lead LSA check-in, weekly revenue report, attendance report, and the daily Sales pipeline update.</li>
          <li>Things people do themselves (their own reports, task completions, LSA bookings) still show the person who did them.</li>
        </ul>
      </div>

      {/* Recent posts */}
      {exists && (
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Recent posts</div>
          {posts.length === 0
            ? <div className="page-sub" style={{ fontSize: 13 }}>Nothing yet — the next scheduled report will show up here.</div>
            : posts.map(p => (
              <a key={p.id} href={`/chat?channel=${p.channel_id}&message=${p.id}`}
                style={{ display: 'block', padding: '9px 0', borderTop: '1px solid var(--line)', textDecoration: 'none', color: 'var(--ink)' }}>
                <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{p.is_dm ? 'Direct message' : `# ${p.channel_name}`} · {timeAgo(p.created_at)}</div>
                <div style={{ fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.preview}</div>
              </a>
            ))}
        </div>
      )}
    </div>
  )
}
