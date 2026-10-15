// ============================================================
//  Softphone — floating phone button (bottom-right) + call panel.
//  Rendered once inside <VoiceProvider>. Shows who you're calling by NAME
//  (never their number), call status/timer, mute, keypad (for phone menus)
//  and hang up. Admins also get a dial pad to type any U.S. number.
//  Click-to-call buttons elsewhere open this panel automatically.
// ============================================================
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useVoice } from '../lib/voice'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#']
const STATUS_TEXT = { connecting: 'Connecting…', ringing: 'Ringing…', 'in-call': 'Connected', ended: 'Call ended' }

function mmss(s) { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

export default function Softphone() {
  const v = useVoice()
  const [dial, setDial] = useState('')
  const [showKeys, setShowKeys] = useState(false)
  if (!v) return null

  const active = v.busy || v.status === 'ended'
  const pressKey = k => (v.busy ? v.sendDigit(k) : setDial(d => (d + k).slice(0, 14)))

  return (
    <>
      <button onClick={() => v.setOpen(!v.open)} aria-label="Phone" title="Phone"
        style={{ ...S.fab, background: v.busy ? '#16a34a' : '#0891b2' }}>
        {v.busy ? '📞' : '☎'}
      </button>

      {v.open && (
        <div style={S.panel} role="dialog" aria-label="Phone">
          <div style={S.head}>
            <strong>Phone</strong>
            <button onClick={() => v.setOpen(false)} style={S.x} aria-label="Close">×</button>
          </div>

          {active ? (
            <div style={{ textAlign: 'center', padding: '6px 0 4px' }}>
              <div style={{ fontWeight: 700, fontSize: 17 }}>{v.label}</div>
              <div style={{ marginTop: 8, fontSize: 14, color: v.status === 'in-call' ? '#16a34a' : 'inherit' }}>
                {STATUS_TEXT[v.status]}{v.status === 'in-call' ? ` · ${mmss(v.seconds)}` : ''}
              </div>
            </div>
          ) : v.canDialNumbers ? (
            <form onSubmit={e => { e.preventDefault(); v.callNumber(dial) }}>
              <input value={dial} onChange={e => setDial(e.target.value)} placeholder="(555) 555-5555"
                inputMode="tel" style={S.input} autoFocus />
            </form>
          ) : (
            <div style={{ fontSize: 13.5, lineHeight: 1.5, padding: '4px 0' }}>
              Click the <strong>📞</strong> next to anyone's name to call them, or pick someone on the{' '}
              <Link to="/phone" onClick={() => v.setOpen(false)} style={{ color: '#0891b2', fontWeight: 600 }}>Phone page</Link>.
            </div>
          )}

          {v.error && <div style={S.error}>{v.error}</div>}

          {((v.busy && showKeys) || (!active && v.canDialNumbers)) && (
            <div style={S.keys}>
              {KEYS.map(k => <button key={k} onClick={() => pressKey(k)} style={S.key}>{k}</button>)}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            {v.busy ? (
              <>
                <button onClick={v.toggleMute} disabled={v.status !== 'in-call'} style={{ ...S.btn, flex: 1, background: v.muted ? 'rgba(234,179,8,0.25)' : 'transparent' }}>
                  {v.muted ? 'Unmute' : 'Mute'}
                </button>
                <button onClick={() => setShowKeys(s => !s)} style={{ ...S.btn, flex: 1 }}>{showKeys ? 'Hide keys' : 'Keypad'}</button>
                <button onClick={v.hangUp} style={{ ...S.btn, flex: 1, background: '#dc2626', borderColor: '#dc2626', color: '#fff' }}>Hang up</button>
              </>
            ) : v.status === 'ended' || v.status === 'error' ? (
              <button onClick={() => { v.reset(); setDial(''); setShowKeys(false) }} style={{ ...S.btn, flex: 1 }}>Done</button>
            ) : v.canDialNumbers ? (
              <button onClick={() => v.callNumber(dial)} disabled={dial.replace(/\D/g, '').length < 10}
                style={{ ...S.btn, flex: 1, background: '#16a34a', borderColor: '#16a34a', color: '#fff' }}>Call</button>
            ) : null}
          </div>
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 8 }}>Calls show the Opsis CX number · not recorded</div>
        </div>
      )}
    </>
  )
}

const S = {
  fab: { position: 'fixed', right: 20, bottom: 20, zIndex: 1000, width: 52, height: 52, borderRadius: '50%', border: 'none', color: '#fff', fontSize: 22, cursor: 'pointer', boxShadow: '0 6px 20px rgba(0,0,0,0.25)' },
  panel: { position: 'fixed', right: 20, bottom: 84, zIndex: 1000, width: 280, maxWidth: 'calc(100vw - 40px)', padding: 14, borderRadius: 16, background: 'var(--card, #fff)', color: 'var(--text, #0f172a)', border: '1px solid rgba(100,116,139,0.25)', boxShadow: '0 12px 40px rgba(0,0,0,0.25)' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  x: { background: 'none', border: 'none', fontSize: 22, lineHeight: 1, cursor: 'pointer', color: 'inherit', opacity: 0.6 },
  input: { width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: 18, textAlign: 'center', letterSpacing: 1, borderRadius: 10, border: '1px solid rgba(100,116,139,0.35)', background: 'transparent', color: 'inherit' },
  keys: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginTop: 10 },
  key: { padding: '10px 0', fontSize: 17, fontWeight: 600, borderRadius: 10, border: '1px solid rgba(100,116,139,0.25)', background: 'transparent', color: 'inherit', cursor: 'pointer' },
  btn: { padding: '9px 0', borderRadius: 10, border: '1px solid rgba(100,116,139,0.35)', background: 'transparent', color: 'inherit', fontWeight: 700, fontSize: 13, cursor: 'pointer' },
  error: { marginTop: 8, padding: '8px 10px', borderRadius: 8, background: 'rgba(220,38,38,0.1)', color: '#b91c1c', fontSize: 12.5 },
}
