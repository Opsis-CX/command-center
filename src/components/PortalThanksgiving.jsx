import React, { useState } from 'react'
import { activeSeason, Leaf } from './Seasonal'

// Happy Thanksgiving for the CLIENT portal only (Rob, 2026-11-25).
// A small banner + a few gentle falling leaves. It is on its own: it shows nothing from
// Command Center's Thanksgiving (no Gratitude Tree, no counts, no team notes) and reads no data.
// It follows the same dates as the Thanksgiving season (Nov 22-28) and turns itself off after.
// Fixed-position and click-through, so it can't move or cover anything in the portal.

const LEAF_COLORS = ['#EA580C', '#C2410C', '#DC2626', '#F59E0B', '#D97706', '#B45309']
const LEAVES = Array.from({ length: 7 }, (_, i) => ({
  i, left: `${6 + i * 13.5}vw`, size: 18 + (i % 3) * 5, color: LEAF_COLORS[i % LEAF_COLORS.length],
  drift: `${(i % 2 ? 1 : -1) * (40 + i * 12)}px`, spin: `${(i % 2 ? 1 : -1) * (200 + i * 40)}deg`,
  dur: 16 + (i % 4) * 3, delay: i * 2.3,
}))
const CSS = `
@keyframes ptgFall { 0% { transform: translate3d(0,-40px,0) rotate(0deg); opacity: 0 } 8% { opacity: .9 } 92% { opacity: .9 } 100% { transform: translate3d(var(--drift),105vh,0) rotate(var(--spin)); opacity: 0 } }
@keyframes ptgIn { from { opacity: 0; transform: translateY(-14px) } to { opacity: 1; transform: none } }
@media (prefers-reduced-motion: reduce) { .ptg-leaf { display: none !important } .ptg-banner { animation: none !important } }
`

export default function PortalThanksgiving() {
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem('ptg-hide-2026') === '1' } catch { return false } })
  if (activeSeason()?.key !== 'thanksgiving') return null
  const close = () => { setHidden(true); try { localStorage.setItem('ptg-hide-2026', '1') } catch { /* private mode */ } }
  return (
    <>
      <style>{CSS}</style>
      <div aria-hidden="true" style={{ position: 'fixed', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 40 }}>
        {LEAVES.map(l => (
          <div key={l.i} className="ptg-leaf" style={{ position: 'absolute', top: 0, left: l.left, '--drift': l.drift, '--spin': l.spin, animation: `ptgFall ${l.dur}s linear ${l.delay}s infinite` }}>
            <Leaf size={l.size} color={l.color} />
          </div>
        ))}
      </div>
      {!hidden && (
        <div style={{ position: 'fixed', top: 10, left: 0, right: 0, display: 'flex', justifyContent: 'center', pointerEvents: 'none', zIndex: 41 }}>
          <div className="ptg-banner" role="status" style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px 6px 14px', borderRadius: 999,
            background: '#FFF5EA', border: '1.5px solid #F98524', color: '#9A3412', fontWeight: 700, fontSize: 13.5,
            boxShadow: '0 6px 18px -8px rgba(194,65,12,.55)', animation: 'ptgIn .5s ease-out', fontFamily: 'Montserrat, Arial, sans-serif' }}>
            <Leaf size={18} color="#EA580C" />
            <span>Happy Thanksgiving! We're thankful for you 🧡</span>
            <button onClick={close} aria-label="Close" title="Close"
              style={{ border: 0, background: 'transparent', color: '#9A3412', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '2px 6px', borderRadius: 999 }}>×</button>
          </div>
        </div>
      )}
    </>
  )
}
