// ============================================================
//  AgentStatus — the ONE Ready / Not ready / Offline control.
//  Used in the phone panel, the Dialer (agent workspace) and the Inbound page;
//  all three read and write the same status (voice.agent / voice.setStatus).
//  Renders nothing for people who aren't on an inbound line or a calling campaign.
// ============================================================
import { useEffect, useRef, useState } from 'react'
import { useVoice } from '../lib/voice'

export const NOT_READY_REASONS = ['Break', 'Lunch', 'Meeting', 'Training', 'Coaching', 'Other']

const LOOK = {
  ready: { label: 'Ready', color: '#16a34a' },
  not_ready: { label: 'Not ready', color: '#d97706' },
  on_call: { label: 'On a call', color: '#0891b2' },
  wrap: { label: 'Wrap-up', color: '#7c3aed' },
  offline: { label: 'Offline', color: '#64748b' },
}

function since(ts, now) {
  if (!ts) return ''
  const s = Math.max(0, Math.floor((now - new Date(ts).getTime()) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

export function statusLook(state) { return LOOK[state] || LOOK.offline }

export default function AgentStatus({ compact = false, align = 'right' }) {
  const v = useVoice()
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(Date.now())
  const ref = useRef(null)

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(t) }, [])
  useEffect(() => {
    if (!open) return
    const close = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  if (!v || !v.agent.loaded || !v.worksCalls) return null
  const a = v.agent
  const look = statusLook(a.state)
  const locked = a.state === 'on_call' || v.busy || v.incoming
  const pick = async (state, reason = null) => { setOpen(false); await v.setStatus(state, reason) }
  const waitingForLine = a.state === 'ready' && a.inbound_member && !v.registered

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" onClick={() => !locked && setOpen(o => !o)} disabled={v.statusBusy}
        title={locked ? 'You can change your status after this call' : 'Change your status'}
        style={{ ...S.pill, background: look.color, cursor: locked ? 'default' : 'pointer', padding: compact ? '5px 10px' : '7px 14px' }}>
        <span style={S.dot} />
        {look.label}{a.state === 'not_ready' && a.reason ? ` — ${a.reason}` : ''}
        {!compact && a.since && <span style={{ opacity: 0.8, fontWeight: 600 }}>· {since(a.since, now)}</span>}
        {waitingForLine && <span style={{ opacity: 0.85, fontWeight: 600 }}>· connecting…</span>}
        {!locked && <span style={{ opacity: 0.8 }}>▾</span>}
      </button>
      {open && (
        <div style={{ ...S.menu, [align]: 0 }} role="menu">
          <button style={S.item} onClick={() => pick('ready')}>
            <span style={{ ...S.swatch, background: LOOK.ready.color }} />
            <span><strong>Ready</strong><span style={S.hint}>{[a.inbound_member && 'inbound rings you', a.campaigns > 0 && 'Dialer feeds you contacts'].filter(Boolean).join(' · ')}</span></span>
          </button>
          <div style={S.group}>Not ready</div>
          {NOT_READY_REASONS.map(r => (
            <button key={r} style={S.item} onClick={() => pick('not_ready', r)}>
              <span style={{ ...S.swatch, background: LOOK.not_ready.color }} />{r}
            </button>
          ))}
          <div style={S.sep} />
          <button style={S.item} onClick={() => pick('offline')}>
            <span style={{ ...S.swatch, background: LOOK.offline.color }} />Offline
          </button>
        </div>
      )}
    </div>
  )
}

const S = {
  pill: { display: 'inline-flex', alignItems: 'center', gap: 7, border: 'none', borderRadius: 999, color: '#fff', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap' },
  dot: { width: 8, height: 8, borderRadius: '50%', background: '#fff' },
  menu: { position: 'absolute', top: 'calc(100% + 6px)', zIndex: 1100, minWidth: 230, padding: 6, borderRadius: 12, background: 'var(--card, #fff)', color: 'var(--text, #0f172a)', border: '1px solid rgba(100,116,139,0.25)', boxShadow: '0 12px 32px rgba(0,0,0,0.2)' },
  item: { display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 10px', border: 'none', background: 'transparent', color: 'inherit', fontSize: 13.5, textAlign: 'left', cursor: 'pointer', borderRadius: 8 },
  swatch: { width: 10, height: 10, borderRadius: '50%', flex: '0 0 auto' },
  hint: { display: 'block', fontSize: 11.5, opacity: 0.65, fontWeight: 400 },
  group: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.55, padding: '8px 10px 2px' },
  sep: { height: 1, background: 'rgba(100,116,139,0.2)', margin: '6px 4px' },
}
