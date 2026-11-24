import React from 'react'
import GlobalSearch, { BackButton } from './GlobalSearch'
import ChatPopButton from './ChatPopButton'
import NotificationBell from './NotificationBell'
import RefreshButton from './RefreshButton'
import ProfileMenu from './ProfileMenu'
import HeaderShiftControls from './HeaderShiftControls'
import HeaderTaskTimer from './HeaderTaskTimer'
import { MyStatusButton } from './Presence'

// ============================================================
// APP HEADER (2026-11-02): two rows.
//  1) White bar: navigation. Back, page name · Search, Refresh, Chat, Notifications, profile menu.
//  2) Light-teal bar: work controls. Your status · shift Check in / Check out · Start task / running task.
// Keep the class names `.topbar` and `.crumb`: the holiday decorations (Seasonal.jsx) anchor to `.topbar .crumb`.
// ============================================================
export default function AppHeader({ title, onToggleNav, showChat }) {
  return (
    <div className="header-wrap">
      <div className="topbar">
        <div className="tb-left">
          <button className="nav-toggle" onClick={onToggleNav} aria-label="Menu">☰</button>
          <BackButton />
          <div className="crumb"><b>{title}</b></div>
        </div>
        <div className="tb-right">
          <GlobalSearch />
          <RefreshButton />
          {showChat && <ChatPopButton />}
          <NotificationBell />
          <ProfileMenu />
        </div>
      </div>
      <div className="workbar" role="group" aria-label="Work controls">
        <div className="wb-left"><MyStatusButton /></div>
        <div className="wb-right">
          {/* shift attendance and task tracking are separate controls and work independently */}
          <HeaderShiftControls />
          <HeaderTaskTimer />
        </div>
      </div>
    </div>
  )
}
