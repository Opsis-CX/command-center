// Sales section — one place for everything sales (Brittney, 2026-09-23).
//
//   /sales            Pipeline (the existing board — same address as before, so
//                     nobody's bookmark breaks)
//   /sales/dashboard  All-time Sales Dashboard
//   /sales/scorecard  30-day Sprint Scorecard (+ sprint settings)
//   /sales/prospects  Prospect tracker — the dialer's workspace
//   /sales/discovery  Discovery Notes (every session in one list)
//
// Access is unchanged: App.jsx gates /sales/* on the 'sales' page-key, and the
// database gates every table and the metrics function on can_see_sales_pipeline()
// (staff only — agents and clients get nothing, even by typing the URL).
import { NavLink, Routes, Route, Navigate } from 'react-router-dom'
import PipelineBoard, { SALES_STAGES } from './PipelineBoard'
import SalesAllTime from './SalesAllTime'
import SalesScorecard from './SalesScorecard'
import SalesProspects from './SalesProspects'
import SalesDiscovery from './SalesDiscovery'

const TABS = [
  { to: '/sales/dashboard', label: 'Dashboard' },
  { to: '/sales/scorecard', label: 'Sprint Scorecard' },
  { to: '/sales/prospects', label: 'Prospects' },
  { to: '/sales/discovery', label: 'Discovery Notes' },
  { to: '/sales', label: 'Pipeline', end: true },
]

function SalesTabs() {
  return (
    <nav aria-label="Sales sections"
      style={{ display: 'flex', gap: 4, flexWrap: 'wrap', padding: '14px 20px 0', borderBottom: '1px solid var(--line)', background: 'var(--surface)' }}>
      {TABS.map(t => (
        <NavLink key={t.to} to={t.to} end={t.end}
          style={({ isActive }) => ({
            padding: '8px 14px', fontSize: 13.5, fontWeight: 700, textDecoration: 'none',
            color: isActive ? 'var(--accent)' : 'var(--ink-soft)',
            borderBottom: '2px solid ' + (isActive ? 'var(--accent)' : 'transparent'),
            marginBottom: -1,
          })}>
          {t.label}
        </NavLink>
      ))}
    </nav>
  )
}

export default function SalesDashboard() {
  return (
    <div>
      <SalesTabs />
      <Routes>
        <Route index element={<PipelineBoard heading="Sales pipeline" stages={SALES_STAGES} pipelineKey="sales" />} />
        <Route path="dashboard" element={<SalesAllTime />} />
        <Route path="scorecard" element={<SalesScorecard />} />
        <Route path="prospects" element={<SalesProspects />} />
        <Route path="discovery" element={<SalesDiscovery />} />
        <Route path="*" element={<Navigate to="/sales" replace />} />
      </Routes>
    </div>
  )
}

