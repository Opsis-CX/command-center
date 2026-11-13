// ============================================================
//  Softphone — floating phone button (bottom-right) + call panel.
//  Rendered once inside <VoiceProvider>. Shows who you're calling by NAME
//  (never their number), call status/timer, mute, keypad (for phone menus)
//  and hang up. Admins also get a dial pad to type any U.S. number.
//
//  Agents' single status (Ready / Not ready / Offline) lives here too, and on the
//  Dialer and Inbound pages. Answering an inbound call opens the guided call
//  screen on the Dialer page.
// ============================================================
import { useState, useRef } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useVoice } from '../lib/voice'
import AgentStatus, { statusLook } from './AgentStatus'
import CxCallPanel from './CxCallPanel'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#']
const STATUS_TEXT = { connecting: 'Connecting…', ringing: 'Ringing…', 'in-call': 'Connected', ended: 'Call ended' }

function mmss(s) { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

// The ☎ button can be dragged anywhere (2026-11-10, Becky: it covered Chat's Send button).
// Position is remembered per browser; double-click puts it back in the corner.
const POS_KEY = 'cc-softphone-pos'
const DEF_POS = { right: 20, bottom: 20 }
function loadPos() { try { const p = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); if (p && isFinite(p.right) && isFinite(p.bottom)) return clampPos(p) } catch (e) { } return DEF_POS }
function clampPos(p) { const w = window.innerWidth || 1200, h = window.innerHeight || 800; return { right: Math.max(4, Math.min(w - 56, p.right)), bottom: Math.max(4, Math.min(h - 56, p.bottom)) } }

export default function Softphone() {
  const v = useVoice()
  const navigate = useNavigate()
  const location = useLocation()
  const [dial, setDial] = useState('')
  const [showKeys, setShowKeys] = useState(false)
  const [pos, setPos] = useState(loadPos)
  const drag = useRef(null)
  if (!v) return null
  const onDown = (e) => { if (e.button !== undefined && e.button !== 0) return; drag.current = { x: e.clientX, y: e.clientY, r: pos.right, b: pos.bottom, moved: false }; try { e.currentTarget.setPointerCapture(e.pointerId) } catch (x) { } }
  const onMove = (e) => { const d = drag.current; if (!d) return; const dx = e.clientX - d.x, dy = e.clientY - d.y; if (!d.moved && Math.abs(dx) + Math.abs(dy) < 6) return; d.moved = true; setPos(clampPos({ right: d.r - dx, bottom: d.b - dy })) }
  const onUp = () => { const d = drag.current; drag.current = null; if (!d) return; if (d.moved) { try { localStorage.setItem(POS_KEY, JSON.stringify(pos)) } catch (x) { } } else v.setOpen(!v.open) }
  const resetPos = () => { setPos(DEF_POS); try { localStorage.removeItem(POS_KEY) } catch (x) { } }
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
  const panelPos = { right: Math.max(8, Math.min(pos.right, vw - 316)), bottom: pos.bottom + 64, maxHeight: `calc(100vh - ${pos.bottom + 74}px)`, overflowY: 'auto' }

  const active = v.busy || v.status === 'ended'
  const onWorkspace = location.pathname === '/dialer'
  if (!v.canCallPeople && !v.worksCalls && !active && !v.incoming && v.status !== 'error') return null
  const pressKey = k => (v.busy ? v.sendDigit(k) : setDial(d => (d + k).slice(0, 14)))
  const answer = async () => { await v.acceptIncoming(); navigate('/dialer'); v.setOpen(false) }

  const fabColor = v.incoming ? '#f59e0b' : v.busy ? '#16a34a' : '#0891b2'

  return (
    <>
      <CxCallPanel />
      <button onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onDoubleClick={resetPos}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); v.setOpen(!v.open) } }}
        aria-label="Phone" title="Phone (drag to move, double-click to reset)"
        style={{ ...S.fab, right: pos.right, bottom: pos.bottom, touchAction: 'none', cursor: 'grab', background: fabColor, animation: v.incoming ? 'ccRing 1s ease-in-out infinite' : 'none' }}>
        {v.incoming ? '🔔' : v.busy ? '📞' : '☎'}
        {v.worksCalls && !v.busy && !v.incoming && <span style={{ ...S.dot, background: statusLook(v.agent.state).color }} />}
      </button>
      <style>{'@keyframes ccRing{0%,100%{transform:rotate(0)}25%{transform:rotate(-12deg)}75%{transform:rotate(12deg)}}'}</style>

      {v.open && (
        <div style={{ ...S.panel, ...panelPos }} role="dialog" aria-label="Phone">
          <div style={S.head}>
            <strong>Phone</strong>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <AgentStatus compact />
              <button onClick={() => v.setOpen(false)} style={S.x} aria-label="Close">×</button>
            </div>
          </div>

          {v.incoming ? (
            <div style={{ textAlign: 'center', padding: '6px 0 4px' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#d97706', textTransform: 'uppercase', letterSpacing: 0.5 }}>Incoming call</div>
              <div style={{ fontWeight: 700, fontSize: 18, marginTop: 6 }}>{v.label}</div>
              {v.sub && <div style={{ fontSize: 13, opacity: 0.75, marginTop: 4 }}>{v.sub}</div>}
            </div>
          ) : active ? (
            <div style={{ textAlign: 'center', padding: '6px 0 4px' }}>
              <div style={{ fontWeight: 700, fontSize: 17 }}>{v.label}</div>
              {v.sub && <div style={{ fontSize: 12.5, opacity: 0.7, marginTop: 3 }}>{v.sub}</div>}
              <div style={{ marginTop: 8, fontSize: 14, color: v.status === 'in-call' ? '#16a34a' : 'inherit' }}>
                {STATUS_TEXT[v.status]}{v.status === 'in-call' ? ` · ${mmss(v.seconds)}` : ''}
              </div>
            </div>
          ) : v.canDialNumbers ? (
            <form onSubmit={e => { e.preventDefault(); v.callNumber(dial) }}>
              <input value={dial} onChange={e => setDial(e.target.value)} placeholder="(555) 555-5555"
                inputMode="tel" style={S.input} autoFocus />
            </form>
          ) : v.canCallPeople ? (
            <div style={{ fontSize: 13.5, lineHeight: 1.5, padding: '4px 0' }}>
              Click the <strong>📞</strong> next to anyone's name to call them, or pick someone on the{' '}
              <Link to="/phone" onClick={() => v.setOpen(false)} style={S.link}>Phone page</Link>.
            </div>
          ) : (
            <div style={{ fontSize: 13.5, lineHeight: 1.5, padding: '4px 0' }}>
              Calls start from the <Link to="/dialer" onClick={() => v.setOpen(false)} style={S.link}>Dialer</Link>.
            </div>
          )}

          {v.inboundCall && !onWorkspace && (
            <Link to="/dialer" onClick={() => v.setOpen(false)} style={S.wrapLink}>
              {v.busy ? 'Open the call screen →' : 'Finish wrap-up for this call →'}
            </Link>
          )}

          {v.error && <div style={S.error}>{v.error}</div>}

          {((v.busy && showKeys) || (!active && !v.incoming && v.canDialNumbers)) && (
            <div style={S.keys}>
              {KEYS.map(k => <button key={k} onClick={() => pressKey(k)} style={S.key}>{k}</button>)}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            {v.incoming ? (
              <>
                <button onClick={v.declineIncoming} style={{ ...S.btn, flex: 1 }}>Decline</button>
                <button onClick={answer} style={{ ...S.btn, flex: 2, background: '#16a34a', borderColor: '#16a34a', color: '#fff' }}>Answer</button>
              </>
            ) : v.busy ? (
              <>
                <button onClick={v.toggleMute} disabled={v.status !== 'in-call'} style={{ ...S.btn, flex: 1, background: v.muted ? 'rgba(234,179,8,0.25)' : 'transparent' }}>
                  {v.muted ? 'Unmute' : 'Mute'}
                </button>
                <button onClick={() => setShowKeys(s => !s)} style={{ ...S.btn, flex: 1 }}>{showKeys ? 'Hide keys' : 'Keypad'}</button>
                <button onClick={v.hangUp} style={{ ...S.btn, flex: 1, background: '#dc2626', borderColor: '#dc2626', color: '#fff' }}>Hang up</button>
              </>
            ) : (v.status === 'ended' || v.status === 'error') && !v.inboundCall ? (
              <button onClick={() => { v.reset(); setDial(''); setShowKeys(false) }} style={{ ...S.btn, flex: 1 }}>Done</button>
            ) : v.canDialNumbers && !v.inboundCall ? (
              <button onClick={() => v.callNumber(dial)} disabled={dial.replace(/\D/g, '').length < 10}
                style={{ ...S.btn, flex: 1, background: '#16a34a', borderColor: '#16a34a', color: '#fff' }}>Call</button>
            ) : null}
          </div>
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 8 }}>Calls show the Opsis CX number</div>
        </div>
      )}
    </>
  )
}

const S = {
  fab: { position: 'fixed', right: 20, bottom: 20, zIndex: 1000, width: 52, height: 52, borderRadius: '50%', border: 'none', color: '#fff', fontSize: 22, cursor: 'pointer', boxShadow: '0 6px 20px rgba(0,0,0,0.25)' },
  dot: { position: 'absolute', right: 3, top: 3, width: 12, height: 12, borderRadius: '50%', border: '2px solid #fff' },
  panel: { position: 'fixed', right: 20, bottom: 84, zIndex: 1000, width: 300, maxWidth: 'calc(100vw - 40px)', padding: 14, borderRadius: 16, background: 'var(--card, #fff)', color: 'var(--text, #0f172a)', border: '1px solid rgba(100,116,139,0.25)', boxShadow: '0 12px 40px rgba(0,0,0,0.25)' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8 },
  x: { background: 'none', border: 'none', fontSize: 22, lineHeight: 1, cursor: 'pointer', color: 'inherit', opacity: 0.6 },
  link: { color: '#0891b2', fontWeight: 600 },
  wrapLink: { display: 'block', marginTop: 10, padding: '8px 10px', borderRadius: 8, background: 'rgba(124,58,237,0.1)', color: '#7c3aed', fontWeight: 700, fontSize: 13, textDecoration: 'none' },
  input: { width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: 18, textAlign: 'center', letterSpacing: 1, borderRadius: 10, border: '1px solid rgba(100,116,139,0.35)', background: 'transparent', color: 'inherit' },
  keys: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginTop: 10 },
  key: { padding: '10px 0', fontSize: 17, fontWeight: 600, borderRadius: 10, border: '1px solid rgba(100,116,139,0.25)', background: 'transparent', color: 'inherit', cursor: 'pointer' },
  btn: { padding: '9px 0', borderRadius: 10, border: '1px solid rgba(100,116,139,0.35)', background: 'transparent', color: 'inherit', fontWeight: 700, fontSize: 13, cursor: 'pointer' },
  error: { marginTop: 8, padding: '8px 10px', borderRadius: 8, background: 'rgba(220,38,38,0.1)', color: '#b91c1c', fontSize: 12.5 },
}
