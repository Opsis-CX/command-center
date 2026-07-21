// RSN pipeline — same board as Sales, with LinkedIn Message 1/2/3 added back
// into the outreach cadence. Visible only to admins and anyone carrying the
// 'access/rsn' tag. Its deals are kept separate from Sales via deals.pipeline
// = 'rsn' (the board reads/writes only that slice).
//
// The route in App.jsx is already gated by useRsnAccess, but we re-check here
// so a direct hit to /rsn can never render the board for someone unauthorized.
import PipelineBoard, { RSN_STAGES } from './PipelineBoard'
import { useRsnAccess } from '../lib/rsnAccess'
import { Placeholder } from './Placeholders'

export default function RsnPipeline() {
  const access = useRsnAccess()

  if (access === null) return <p className="page-sub" style={{ padding: 20 }}>Checking access…</p>
  if (!access) return <Placeholder title="No access" note="You don't have access to the RSN pipeline." />

  return <PipelineBoard heading="RSN pipeline" stages={RSN_STAGES} pipelineKey="rsn" />
}
