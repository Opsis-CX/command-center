// Client portal pages inside Command Center (one-platform shell, Becky's merged mockup 11/24).
// /w/<view> shows that portal page for the workspace picked at the top of the sidebar. Access is the
// same as the Portals ▾ menu: my_portals() → can_view_portal(), and every portal edge function / RPC
// checks the signed-in person again.
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import OpsisQAPortal from './OpsisQAPortal'
import { useWorkspace } from '../lib/workspace'
import { canAny } from '../lib/permissions'
import { useAuth } from '../lib/auth'

// Portal pages that were merged into one Command Center page (duplicate merges, 11/25+).
const MERGED = { wfm: '/workforce', intraday: '/workforce?tab=intraday' }

export default function WorkspacePage() {
  const { view } = useParams()
  const navigate = useNavigate()
  const { appRole } = useAuth()
  const { list, current, set, clientId } = useWorkspace()

  if (MERGED[view]) return <Navigate to={MERGED[view]} replace />
  if (list === null) return <p className="page-sub">Loading…</p>
  if (!clientId) {
    return (
      <div className="card" style={{ maxWidth: 560 }}>
        <h3 style={{ margin: '0 0 6px' }}>Pick a client workspace</h3>
        <p className="page-sub" style={{ margin: '0 0 14px' }}>
          This page shows one client's data. Choose whose, or click your picture (top right) → Workspace.
        </p>
        {list.length === 0 && <p className="page-sub">No client workspaces you can open yet.</p>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {list.map(p => (
            <button key={p.client_id} className="btn btn-ghost" onClick={() => set(p.client_id)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              {p.logo_url
                ? <img src={p.logo_url} alt="" style={{ width: 22, height: 22, objectFit: 'contain', borderRadius: 5, background: '#fff' }} />
                : <span style={{ width: 22, height: 22, borderRadius: 5, background: p.accent || '#0089A6', color: '#fff', display: 'inline-grid', placeItems: 'center', fontWeight: 700, fontSize: 12 }}>{(p.name || '?')[0]}</span>}
              {p.name}
            </button>
          ))}
        </div>
      </div>
    )
  }
  return (
    <div className="ws-page">
      <OpsisQAPortal key={clientId} staff embedded clientId={clientId} logo={current?.logo_url || undefined}
        view={view || 'overview'}
        onView={(v) => { if (v && v !== view) navigate('/w/' + v + window.location.hash, { replace: true }) }}
        hasCsrs={canAny(appRole, 'quality_audit.call_reviews')} csrMode="staff" />
    </div>
  )
}
