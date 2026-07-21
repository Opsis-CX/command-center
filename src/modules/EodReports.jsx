import EodReportCard from './EodReports'

// ============================================================
// END OF DAY REPORT — standalone page (Operations → End of Day Report).
//
// This is the same role-aware EOD feature that used to live at the bottom of
// the old Dashboard. When the Dashboard was retired in favour of Home Base,
// the report needs its own home. `EodReportCard` self-gates by role:
//   • Admins     → their own report + the team roll-up.
//   • Non-agents → their own report to fill and submit.
//   • Agents     → nothing (the route is gated to non-agents anyway).
// All of the logic (tracked-task auto-fill, history, admin roll-up, email
// copy, interval-end reminder) lives in src/modules/EodReports.jsx — this file
// just gives it a page title and container.
// ============================================================
export default function EndOfDayReport() {
  return (
    <div>
      <div style={{ marginBottom: 4 }}>
        <h1 className="page-title">End of Day Report</h1>
        <p className="page-sub">Your tracked tasks fill in automatically — add anything the tracker can't capture, then submit before you sign off.</p>
      </div>
      <EodReportCard />
    </div>
  )
}
