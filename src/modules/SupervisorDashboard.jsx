// ============================================================
//  SupervisorDashboard — the RM / GM supervisor page in the GarageCo portal (Becky 11/20).
//  The wallboard is informational only; the actions live here:
//    • Storm / emergency closure for their lines (RMs: their brand; GMs: their location — enforced in cx_emergency_*).
//    • Live calls with Listen / Whisper / Barge, alerts with the chime, and TV wallboard links (CxLiveBoard, controls on).
// ============================================================
import CxLiveBoard from '../components/CxLiveBoard'
import { StormSwitch } from '../components/CxEngineSetup'

const card = { background: 'light-dark(#fff, #161d21)', border: '1px solid light-dark(#e2e8f0, #2a3439)', borderRadius: 14, padding: 16 }

export default function SupervisorDashboard({ clientId = null }) {
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={card}>
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>Storm / emergency closure</div>
        <div style={{ fontSize: 12.5, color: 'light-dark(#64748b, #9fb4bb)', marginBottom: 10 }}>Close your lines for the day when the office can’t open. Callers hear the closure message and can leave a message or stay on the line for the digital assistant.</div>
        <StormSwitch clientId={clientId} />
      </div>
      <CxLiveBoard clientId={clientId} controls />
    </div>
  )
}
