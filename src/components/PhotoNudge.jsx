import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

// ============================================================
// A small, dismissible prompt for anyone without a profile photo.
// "Later" hides it for 7 days; it never shows on the profile page itself
// (the "Complete your profile" checklist covers that), or once a photo exists.
// ============================================================
const KEY = 'cc.photoNudgeSnoozeUntil'

export default function PhotoNudge() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!user?.id) return
    let snoozed = 0
    try { snoozed = Number(localStorage.getItem(KEY) || 0) } catch { /* ignore */ }
    if (snoozed > Date.now()) return
    let alive = true
    const t = setTimeout(async () => {
      const { data } = await supabase.from('profiles').select('avatar_url, client_id, is_service_account').eq('id', user.id).maybeSingle()
      if (alive && data && !data.avatar_url && !data.client_id && !data.is_service_account) setShow(true)
    }, 4000) // let the app settle first
    const onPhoto = (e) => { if (e.detail) setShow(false) }
    window.addEventListener('cc:avatar-updated', onPhoto)
    return () => { alive = false; clearTimeout(t); window.removeEventListener('cc:avatar-updated', onPhoto) }
  }, [user?.id])

  if (!show || location.pathname.startsWith('/profile')) return null
  const later = () => { try { localStorage.setItem(KEY, String(Date.now() + 7 * 86400000)) } catch { /* ignore */ } setShow(false) }

  return (
    <div role="dialog" aria-label="Add a profile photo"
      style={{ position: 'fixed', left: 16, bottom: 16, zIndex: 60, width: 'min(320px, calc(100vw - 32px))', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, boxShadow: '0 12px 32px rgba(0,0,0,.18)', padding: 16 }}>
      <div style={{ display: 'flex', gap: 12 }}>
        <span style={{ fontSize: 28, lineHeight: 1 }}>📸</span>
        <div>
          <b style={{ fontSize: 14 }}>Add a profile photo</b>
          <div className="page-sub" style={{ margin: '3px 0 0', fontSize: 12.5 }}>It shows next to your name in Chat and around Command Center, so your team can put a face to your name.</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
        <button className="btn btn-ghost" style={{ fontSize: 12.5 }} onClick={later}>Later</button>
        <button className="btn btn-primary" style={{ fontSize: 12.5 }} onClick={() => { setShow(false); navigate('/profile') }}>Add photo</button>
      </div>
    </div>
  )
}
