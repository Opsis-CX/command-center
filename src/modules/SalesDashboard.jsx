// Sales pipeline — the standard outbound B2B board (Marketing/Admin).
// This is now a thin wrapper around the shared PipelineBoard so the Sales and
// RSN pipelines stay in lockstep; the only differences are the stage set and
// the `pipeline` value each board reads/writes on `deals`.
import PipelineBoard, { SALES_STAGES } from './PipelineBoard'

export default function SalesDashboard() {
  return <PipelineBoard heading="Sales pipeline" stages={SALES_STAGES} pipelineKey="sales" />
}
