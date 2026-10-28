import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

// ============================================================
// SEASONAL DECORATIONS (2026-10-27, Brittney) — cute, never scary.
// Turns itself on/off by date. Each person can switch it off in Settings
// (profiles.seasonal_effects). People with "reduce motion" get the still parts only.
// Purely decorative: pointer-events: none everywhere, nothing touches data.
//
// Add a holiday = add an entry to SEASONS (dates are month/day, inclusive).
// ============================================================

export const SEASONS = [
  { key: 'halloween', from: [10, 27], to: [10, 31],
    floaters: ['👻', '🦇', '🎃', '👻', '🍬', '🦇'],
    confetti: ['🍬', '🍭', '🎃', '🍫', '🧡', '💜'],
    greeting: (first) => `🎃 Happy Halloween week${first ? `, ${first}` : ''}! 👻`,
    hat: 'witch' },
]

let _off = false
export function activeSeason(d = new Date()) {
  const md = (d.getMonth() + 1) * 100 + d.getDate()
  return SEASONS.find(s => md >= s.from[0] * 100 + s.from[1] && md <= s.to[0] * 100 + s.to[1]) || null
}
// Used by Chat avatars: which seasonal hat to draw (null = none).
export function seasonalHat() { if (_off) return null; return activeSeason()?.hat || null }
const reduceMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false } }

// 🍬 confetti burst — call celebrate(x, y) or dispatch 'cc:celebrate' with { detail: { x, y } }
export function celebrate(x, y) {
  window.dispatchEvent(new CustomEvent('cc:celebrate', { detail: { x, y } }))
}

const CSS = `
@keyframes ccFloatAcross { from { transform: translateX(-12vw) } to { transform: translateX(112vw) } }
@keyframes ccBob { 0%, 100% { transform: translateY(0) rotate(-6deg) } 50% { transform: translateY(-26px) rotate(6deg) } }
@keyframes ccPop { 0% { transform: translate(0,0) scale(.4) rotate(0); opacity: 0 } 15% { opacity: 1 }
  100% { transform: translate(var(--dx), var(--dy)) scale(1) rotate(var(--rot)); opacity: 0 } }
@keyframes ccSwing { 0%, 100% { transform: rotate(-4deg) } 50% { transform: rotate(4deg) } }
@keyframes ccFadeIn { from { opacity: 0; transform: translate(-50%, -8px) } to { opacity: 1; transform: translate(-50%, 0) } }
.cc-season-layer { position: fixed; inset: 0; pointer-events: none; z-index: 2400; overflow: hidden; }
`

function Floater({ emoji, top, dur, size, onDone }) {
  return (
    <div style={{ position: 'absolute', top, left: 0, animation: `ccFloatAcross ${dur}s linear forwards` }} onAnimationEnd={onDone}>
      <div style={{ fontSize: size, animation: 'ccBob 2.6s ease-in-out infinite', filter: 'drop-shadow(0 4px 6px rgba(0,0,0,.12))', opacity: .9 }}>{emoji}</div>
    </div>
  )
}

// A soft lavender web with a little smiling spider (cute, not creepy).
function CornerWeb({ side }) {
  const flip = side === 'right' ? 'scaleX(-1)' : 'none'
  return (
    <svg width="96" height="96" viewBox="0 0 96 96" style={{ position: 'fixed', top: 0, [side]: 0, transform: flip, opacity: .55, pointerEvents: 'none', zIndex: 2300 }} aria-hidden="true">
      <g stroke="#A78BFA" strokeWidth="1.2" fill="none" strokeLinecap="round">
        <path d="M0 0 L90 6 M0 0 L74 52 M0 0 L44 82 M0 0 L8 92" />
        <path d="M22 1.5 Q20 12 18 13 Q12 18 2 22" />
        <path d="M45 3 Q40 22 36 27 Q24 38 4 45" />
        <path d="M68 4.5 Q60 32 54 40 Q36 58 6 68" />
      </g>
      <g style={{ transformOrigin: '60px 0', animation: reduceMotion() ? 'none' : 'ccSwing 3.5s ease-in-out infinite' }}>
        <line x1="60" y1="0" x2="60" y2="40" stroke="#A78BFA" strokeWidth="1" />
        <circle cx="60" cy="46" r="7" fill="#6D28D9" />
        <circle cx="57.5" cy="45" r="1.6" fill="#fff" /><circle cx="62.5" cy="45" r="1.6" fill="#fff" />
        <circle cx="57.8" cy="45.3" r=".7" fill="#1F1144" /><circle cx="62.8" cy="45.3" r=".7" fill="#1F1144" />
        <path d="M57.5 48.5 Q60 50.5 62.5 48.5" stroke="#FDE68A" strokeWidth="1" fill="none" strokeLinecap="round" />
        <g stroke="#6D28D9" strokeWidth="1.4" strokeLinecap="round"><path d="M53 44 l-5 -3 M53 47 l-5 1 M67 44 l5 -3 M67 47 l5 1" /></g>
      </g>
    </svg>
  )
}

export default function Seasonal() {
  const { user } = useAuth()
  const [on, setOn] = useState(null)        // null until we know the person's setting
  const [floaters, setFloaters] = useState([])
  const [bursts, setBursts] = useState([])
  const [greet, setGreet] = useState(null)
  const season = activeSeason()
  const idRef = useRef(0)
  const still = reduceMotion()

  // the person's setting (and live changes from Settings)
  useEffect(() => {
    if (!user?.id || !season) return
    let alive = true
    const read = () => supabase.from('profiles').select('seasonal_effects, full_name').eq('id', user.id).maybeSingle().then(({ data }) => {
      if (!alive) return
      const enabled = data?.seasonal_effects !== false
      _off = !enabled; setOn(enabled)
      if (enabled) {
        const key = `cc.season.greet.${season.key}.${new Date().toDateString()}`
        try { if (!localStorage.getItem(key)) setGreet({ text: season.greeting((data?.full_name || '').split(' ')[0]), key }) } catch { /* ignore */ }
      }
    })
    read()
    window.addEventListener('cc:seasonal-changed', read)
    return () => { alive = false; window.removeEventListener('cc:seasonal-changed', read) }
  }, [user?.id, season?.key]) // eslint-disable-line react-hooks/exhaustive-deps

  // a friend floats across every 35–70 seconds (first one shortly after load)
  useEffect(() => {
    if (!on || !season || still) return
    let t
    const spawn = () => {
      if (document.visibilityState === 'visible') {
        const id = ++idRef.current
        setFloaters(f => [...f, {
          id, emoji: season.floaters[Math.floor(Math.random() * season.floaters.length)],
          top: `${12 + Math.random() * 70}vh`, dur: 14 + Math.random() * 8, size: 26 + Math.round(Math.random() * 12),
        }])
      }
      t = setTimeout(spawn, 35000 + Math.random() * 35000)
    }
    t = setTimeout(spawn, 4000)
    return () => clearTimeout(t)
  }, [on, season?.key, still]) // eslint-disable-line react-hooks/exhaustive-deps

  // confetti bursts
  useEffect(() => {
    if (!on || !season) return
    const fire = (e) => {
      if (still) return
      const x = e?.detail?.x ?? window.innerWidth / 2, y = e?.detail?.y ?? window.innerHeight - 120
      const id = ++idRef.current
      const bits = Array.from({ length: 14 }, (_, i) => ({
        k: i, e: season.confetti[i % season.confetti.length],
        dx: `${Math.round((Math.random() - .5) * 260)}px`, dy: `${Math.round(-60 - Math.random() * 180)}px`, rot: `${Math.round((Math.random() - .5) * 540)}deg`,
        d: .9 + Math.random() * .6,
      }))
      setBursts(b => [...b, { id, x, y, bits }])
      setTimeout(() => setBursts(b => b.filter(z => z.id !== id)), 1700)
    }
    window.addEventListener('cc:celebrate', fire)
    return () => window.removeEventListener('cc:celebrate', fire)
  }, [on, season?.key, still]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!season || !on) return null
  const closeGreet = () => { try { localStorage.setItem(greet.key, '1') } catch { /* ignore */ } setGreet(null) }

  return (
    <>
      <style>{CSS}</style>
      <CornerWeb side="right" />
      <div className="cc-season-layer" aria-hidden="true">
        {floaters.map(f => <Floater key={f.id} {...f} onDone={() => setFloaters(x => x.filter(y => y.id !== f.id))} />)}
        {bursts.map(b => (
          <div key={b.id} style={{ position: 'absolute', left: b.x, top: b.y }}>
            {b.bits.map(c => (
              <span key={c.k} style={{ position: 'absolute', fontSize: 18, '--dx': c.dx, '--dy': c.dy, '--rot': c.rot, animation: `ccPop ${c.d}s ease-out forwards` }}>{c.e}</span>
            ))}
          </div>
        ))}
      </div>
      {greet && (
        <div role="status" style={{ position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)', zIndex: 2500, animation: 'ccFadeIn .4s ease',
          background: 'linear-gradient(120deg, #FFF7ED, #F5F3FF)', border: '1px solid #E9D5FF', borderRadius: 999, padding: '8px 10px 8px 18px',
          boxShadow: '0 10px 30px -10px rgba(109,40,217,.35)', display: 'flex', alignItems: 'center', gap: 10, fontWeight: 700, fontSize: 14, color: '#5B21B6' }}>
          {greet.text}
          <button onClick={closeGreet} aria-label="Close" style={{ border: 0, background: 'transparent', cursor: 'pointer', color: '#7C3AED', fontSize: 14, padding: '2px 6px' }}>✕</button>
        </div>
      )}
    </>
  )
}

// A tiny cute witch hat (drawn on Chat avatars during Halloween week).
export function WitchHat({ size }) {
  const w = Math.max(12, Math.round(size * 0.7))
  return (
    <svg aria-hidden="true" width={w} height={w} viewBox="0 0 40 40"
      style={{ position: 'absolute', left: -Math.round(size * 0.1), top: -Math.round(size * 0.48), transform: 'rotate(-14deg)', pointerEvents: 'none', overflow: 'visible', zIndex: 1 }}>
      <ellipse cx="20" cy="33" rx="18" ry="4.5" fill="#6D28D9" />
      <path d="M11 32 Q14 18 19 10 Q22 5 29 3 Q25 9 26 15 Q27 23 29 32 Z" fill="#7C3AED" />
      <path d="M11.5 29 Q20 31.5 28.6 29 L28.9 31.6 Q20 34 11.2 31.6 Z" fill="#F59E0B" />
      <rect x="17.5" y="28.6" width="5" height="4.4" rx="1" fill="#FDE68A" stroke="#B45309" strokeWidth=".8" />
      <circle cx="27" cy="5" r="1.4" fill="#FDE68A" />
    </svg>
  )
}
