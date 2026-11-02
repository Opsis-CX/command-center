import React from 'react'
import { useRefresh } from '../lib/refresh'
import { RefreshIcon } from './HeaderIcons'

// ↻ in the top bar: re-reads this page's data. The task timer, check-in and your unsaved work are not touched
// (it asks before discarding anything you have typed). See lib/refresh.jsx.
export default function RefreshButton() {
  const { refresh, refreshing } = useRefresh()
  return (
    <button type="button" className="hd-icon-btn" onClick={refresh} disabled={refreshing} aria-label="Refresh this page"
      title="Refresh this page's data. Your timer keeps running and your unsaved work is kept (it asks first).">
      <RefreshIcon className={refreshing ? 'hd-spin' : ''} />
    </button>
  )
}
