import React, { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useUnread } from '../lib/unread'
import { Drawer } from '../modules/ProfileDashboard'
import { ChatIcon } from './HeaderIcons'
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
      <button type="button" className="hd-icon-btn" onClick={() => setOpen(true)} title="Open Chat here" aria-label={`Open Chat${total ? ` (${total} unread)` : ''}`}>
        <ChatIcon />
        {total > 0 && <span className="hd-badge">{total > 99 ? '99+' : total}</span>}
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
