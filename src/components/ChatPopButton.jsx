import React, { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useUnread } from '../lib/unread'
import { Drawer } from '../modules/ProfileDashboard'
import Chat from '../modules/Chat'

// 💬 Chat pop-up (2026-10-28, Brittney): open Chat in a big slide-out panel from any page,
// without leaving what you're doing. Sits next to the bell; shows the same unread count as
// the sidebar. Hidden on the Chat page itself (no need for two copies of Chat).
export default function ChatPopButton() {
  const { total } = useUnread()
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const navigate = useNavigate()
  if (pathname.startsWith('/chat')) return null
  return (
    <>
      <button className="btn btn-ghost" onClick={() => setOpen(true)} title="Open Chat here" aria-label={`Open Chat${total ? ` (${total} unread)` : ''}`}
        style={{ position: 'relative', padding: '6px 10px', fontSize: 16, lineHeight: 1 }}>
        💬
        {total > 0 && (
          <span style={{ position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999, background: '#DC2626', color: '#fff',
            fontSize: 10.5, fontWeight: 700, display: 'grid', placeItems: 'center', boxShadow: '0 0 0 2px var(--surface)' }}>{total > 99 ? '99+' : total}</span>
        )}
      </button>
      {open && (
        <Drawer title="💬 Chat" width={1500} onClose={() => setOpen(false)}
          footer={<button className="btn btn-ghost" style={{ fontSize: 12.5 }} onClick={() => { setOpen(false); navigate('/chat') }}>Open full Chat ↗</button>}>
          <Chat />
        </Drawer>
      )}
    </>
  )
}
