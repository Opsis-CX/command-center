// Workspace switcher at the top of the one-platform sidebar (Becky's merged mockup, 11/24).
// "Opsis CX" = our own Command Center pages. Picking a client opens that client's portal pages
// (Insights, Call reviews, Calibration…) inside Command Center for that client.
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useWorkspace } from '../lib/workspace'

export default function WorkspaceSwitcher({ onNavigate }) {
  const { id, list, current, set } = useWorkspace()
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const pick = (cid) => {
    setOpen(false)
    set(cid)
    // On a client page with no client picked any more → back to Overview.
    if (!cid && location.pathname.startsWith('/w/')) { navigate('/overview'); onNavigate && onNavigate() }
  }
  const name = current ? current.name : 'Opsis CX'
  return (
    <div className="ws-switch">
      <button type="button" className="ws-btn" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label={`Workspace: ${name}. Switch workspace`}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span className="ws-cap">Workspace</span>
          <span className="ws-name">{name}</span>
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M7 10l5 5 5-5" /></svg>
      </button>
      {open && (<>
        <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 80 }} />
        <div role="menu" className="ws-menu">
          <button role="menuitemradio" aria-checked={!id} className={'ws-item' + (!id ? ' on' : '')} onClick={() => pick('')}>
            <span className="ws-av" style={{ background: '#13D9E8', color: '#021116' }}>O</span>
            <span style={{ flex: 1 }}><b>Opsis CX</b><small>Our own team and Command Center</small></span>
          </button>
          <div className="ws-sec">Client workspaces</div>
          {list === null && <div className="ws-empty">Loading…</div>}
          {list && list.length === 0 && <div className="ws-empty">No client workspaces you can open yet.</div>}
          {(list || []).map(p => (
            <button key={p.client_id} role="menuitemradio" aria-checked={id === p.client_id} className={'ws-item' + (id === p.client_id ? ' on' : '')} onClick={() => pick(p.client_id)}>
              {p.logo_url
                ? <img src={p.logo_url} alt="" className="ws-av" style={{ objectFit: 'contain', background: '#fff' }} />
                : <span className="ws-av" style={{ background: p.accent || '#0089A6' }}>{(p.name || '?')[0]}</span>}
              <span style={{ flex: 1 }}><b>{p.name}</b><small>Client portal pages</small></span>
            </button>
          ))}
        </div>
      </>)}
    </div>
  )
}
