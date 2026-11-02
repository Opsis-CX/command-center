import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useVoice } from './voice'
import { useUnread } from './unread'

// ============================================================
// REFRESH (header ↻ button, 2026-11-02)
// Re-reads the current page's data without reloading the browser:
//  • the page's content is re-mounted, so it fetches fresh data the same way it did when you opened it;
//  • the header (task timer, check-in, notifications, status) is NOT re-mounted, so a running timer keeps running;
//  • the shell pieces that hold their own data hear a "cc:refresh" event and re-read quietly;
//  • it never silently throws work away: if you have typed into a long text box / editor, or have a pop-up open,
//    it asks first. It also waits if you are on a live call.
// ============================================================

const Ctx = createContext({ version: 0, refreshing: false, refresh: async () => {} })
export const useRefresh = () => useContext(Ctx)

// What counts as "work you could lose": typing in a long-text box or an editor, or anything inside a pop-up.
const LONG_FIELD = 'textarea, [contenteditable=""], [contenteditable="true"]'
const POPUP = '[role="dialog"], .modal-back.open'
const LIVE_CALL = ['incoming', 'connecting', 'ringing', 'in-call']

export function RefreshProvider({ children }) {
  const [version, setVersion] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const dirty = useRef(false)
  const busy = useRef(false)
  const voice = useVoice()
  const voiceRef = useRef(voice); voiceRef.current = voice
  const unread = useUnread()
  const unreadRef = useRef(unread); unreadRef.current = unread
  const { pathname } = useLocation()

  // Remember when someone types into a long-text box or a pop-up. A new page starts clean.
  useEffect(() => {
    const onInput = (e) => {
      const t = e.target
      if (!t || !t.closest) return
      if (t.closest('[data-refresh-ignore]')) return
      if (t.matches(LONG_FIELD) || t.closest(POPUP)) dirty.current = true
    }
    document.addEventListener('input', onInput, true)
    return () => document.removeEventListener('input', onInput, true)
  }, [])
  useEffect(() => { dirty.current = false }, [pathname])

  const refresh = useCallback(async () => {
    if (busy.current) return
    const v = voiceRef.current
    if (v && LIVE_CALL.includes(v.status)) {
      window.alert('You are on a call. Finish it first, then refresh.')
      return
    }
    const popupOpen = !!document.querySelector(POPUP)
    if (dirty.current || popupOpen) {
      const ok = window.confirm("You have something open or unsaved on this page. Refreshing will close it and discard any changes you haven't saved.\n\nRefresh anyway?")
      if (!ok) return
    }
    busy.current = true; setRefreshing(true)
    const main = document.querySelector('.main')
    const top = main ? main.scrollTop : 0
    // 1) shell pieces that keep their own data
    window.dispatchEvent(new CustomEvent('cc:refresh'))
    try { unreadRef.current && unreadRef.current.refreshUnread && unreadRef.current.refreshUnread() } catch { /* ignore */ }
    // 2) the page itself
    dirty.current = false
    setVersion(x => x + 1)
    // keep your place on the page once it has re-rendered
    const restore = () => { const m = document.querySelector('.main'); if (m && top && m.scrollTop < top) m.scrollTop = top }
    requestAnimationFrame(restore); setTimeout(restore, 500)
    setTimeout(() => { busy.current = false; setRefreshing(false) }, 700)
  }, [])

  return <Ctx.Provider value={{ version, refreshing, refresh }}>{children}</Ctx.Provider>
}

// Wrap the page routes with this: changing `version` re-mounts them so each page re-reads its data.
export function RefreshBoundary({ children }) {
  const { version } = useRefresh()
  return <React.Fragment key={version}>{children}</React.Fragment>
}
