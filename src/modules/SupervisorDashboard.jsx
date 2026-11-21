// ============================================================
//  SupervisorDashboard — the RM / GM supervisor page in the GarageCo portal (Becky 11/20).
//  The wallboard is informational only; the actions live here:
//    • Storm / emergency closure for their lines (RMs: their brand; GMs: their location — enforced in cx_emergency_*).
//    • The CSR table (status, today's numbers) with Not ready / Log out (sup_agent_set) — moved off the wallboard.
//    • Live calls with Listen / Whisper / Barge, alerts with the chime, and TV wallboard links (CxLiveBoard, controls on).
// ============================================================
import CxLiveBoard from '../components/CxLiveBoard'
import SupervisorWallboard from './SupervisorWallboard'
import { StormSwitch } from '../components/CxEngineSetup'

export default function SupervisorDashboard({ clientId = null, brands = null, locations = null }) {
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <StormSwitch clientId={clientId} collapsible />
      <CxLiveBoard clientId={clientId} controls />
      <SupervisorWallboard clientId={clientId} brands={brands} locations={locations} section="csrs" />
    </div>
  )
}
