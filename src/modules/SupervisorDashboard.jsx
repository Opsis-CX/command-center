// ============================================================
//  SupervisorDashboard — the RM / GM supervisor page in the GarageCo portal (Becky 11/20).
//  The wallboard is informational only; the actions live here:
//    • Storm / emergency closure for their lines (RMs: their brand; GMs: their location — enforced in cx_emergency_*).
//    • Live calls with Listen / Whisper / Barge, alerts with the chime, and TV wallboard links (CxLiveBoard, controls on).
// ============================================================
import CxLiveBoard from '../components/CxLiveBoard'
import { StormSwitch } from '../components/CxEngineSetup'

export default function SupervisorDashboard({ clientId = null }) {
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <StormSwitch clientId={clientId} collapsible />
      <CxLiveBoard clientId={clientId} controls />
    </div>
  )
}
