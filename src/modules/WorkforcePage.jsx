// Workforce (WFM) — one page for Opsis CX and every client workspace (duplicate merge #1, 11/25).
// Opsis CX: Command Center's own data (Supabase + RLS). A client workspace: the same screens with that
// client's data through opsis-portal-ops — exactly what the portal's Workforce tab showed — plus Intraday.
import { useMemo } from 'react'
import Workforce, { portalWfmData } from './Workforce'
import { invoke } from './OpsisQAPortal'
import { useWorkspace } from '../lib/workspace'

export default function WorkforcePage() {
  const { id, current } = useWorkspace()
  const data = useMemo(() => (id ? portalWfmData(b => invoke({ ...b, client_id: id })) : undefined), [id])
  return <Workforce key={id || 'opsis'} data={data} portal={!!id} intraday={id || null} who={current ? current.name : ''} />
}
