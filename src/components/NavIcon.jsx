// ============================================================
// Menu icons (2026-11-04). The menu uses emojis by default; with Branding → Menu icons →
// "Line icons", each emoji is swapped for a matching thin outline icon that takes the menu
// text color. Any emoji without a line version stays an emoji (shown in grayscale).
// ============================================================

// 24×24 outline drawings, keyed by the emoji the menu uses.
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' }
const C = (cx, cy, r) => <circle cx={cx} cy={cy} r={r} />
const R = (x, y, w, h, rx = 2) => <rect x={x} y={y} width={w} height={h} rx={rx} />
const P = (d) => <path d={d} />

const ICONS = {
  '🏠': <>{P('M3 10.5 12 3l9 7.5')}{P('M5 9v12h14V9')}{P('M10 21v-6h4v6')}</>,
  '◷': <>{C(12, 12, 9)}{P('M12 7v5l3 2')}</>,
  '💬': <>{P('M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.4A8 8 0 1 1 21 12z')}</>,
  '🌐': <>{C(12, 12, 9)}{P('M3 12h18')}{P('M12 3a14 14 0 0 1 0 18')}{P('M12 3a14 14 0 0 0 0 18')}</>,
  '📞': <>{P('M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z')}</>,
  '📝': <>{P('M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z')}{P('M14 3v6h6')}{P('M8 13h8')}{P('M8 17h5')}</>,
  '🗂️': <>{P('M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z')}</>,
  '📅': <>{R(3, 5, 18, 16)}{P('M16 3v4')}{P('M8 3v4')}{P('M3 10h18')}</>,
  '🎯': <>{C(12, 12, 9)}{C(12, 12, 5)}{C(12, 12, 1)}</>,
  '🎧': <>{P('M4 15v-3a8 8 0 0 1 16 0v3')}{R(3, 14, 4, 6, 1.5)}{R(17, 14, 4, 6, 1.5)}</>,
  '📚': <>{P('M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z')}{P('M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5')}</>,
  '🤖': <>{R(4, 8, 16, 12)}{P('M12 4v4')}{C(12, 3, 1)}{P('M9 13v2')}{P('M15 13v2')}</>,
  '🎟️': <>{C(12, 12, 9)}{C(12, 12, 5)}{P('M12 9.5v5')}</>,
  '🛟': <>{C(12, 12, 9)}{C(12, 12, 4)}{P('M5.6 5.6l3.6 3.6')}{P('M14.8 14.8l3.6 3.6')}{P('M18.4 5.6l-3.6 3.6')}{P('M9.2 14.8l-3.6 3.6')}</>,
  '👋': <>{C(12, 12, 9)}{P('M8 14s1.5 2 4 2 4-2 4-2')}{P('M9 9.5h.01')}{P('M15 9.5h.01')}</>,
  '📊': <>{P('M3 3v18h18')}{P('M8 16v-5')}{P('M13 16V8')}{P('M18 16v-3')}</>,
  '✦': <>{C(12, 8, 6)}{P('M8.5 13.2 7 22l5-3 5 3-1.5-8.8')}</>,
  '🔄': <>{P('M3 12a9 9 0 0 1 15.5-6.3L21 8')}{P('M21 3v5h-5')}{P('M21 12a9 9 0 0 1-15.5 6.3L3 16')}{P('M3 21v-5h5')}</>,
  '🧲': <>{C(9, 8, 4)}{P('M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1')}{P('M19 8v6')}{P('M16 11h6')}</>,
  '📈': <>{P('M3 17l6-6 4 4 8-8')}{P('M15 7h6v6')}</>,
  '🔗': <>{P('M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5')}{P('M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5')}</>,
  '✅': <>{C(12, 12, 9)}{P('M8 12l3 3 5-6')}</>,
  '🎙️': <>{R(9, 3, 6, 11, 3)}{P('M5 11a7 7 0 0 0 14 0')}{P('M12 18v3')}</>,
  '💰': <>{P('M12 2v20')}{P('M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6')}</>,
  '🧾': <>{P('M5 3v18l2-1.5L9 21l2-1.5L13 21l2-1.5L17 21l2-1.5V3l-2 1.5L15 3l-2 1.5L11 3 9 4.5 7 3z')}{P('M9 9h6')}{P('M9 13h6')}</>,
  '⚙': <>{P('M4 21v-7')}{P('M4 10V3')}{P('M12 21v-9')}{P('M12 8V3')}{P('M20 21v-5')}{P('M20 12V3')}{P('M1 14h6')}{P('M9 8h6')}{P('M17 16h6')}</>,
  '🗄️': <><ellipse cx="12" cy="5" rx="8" ry="3" />{P('M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5')}{P('M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3')}</>,
  '📣': <>{P('M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z')}{P('M15.5 8.5a5 5 0 0 1 0 7')}{P('M18.5 5.5a9 9 0 0 1 0 13')}</>,
  '📰': <>{R(3, 4, 18, 16)}{P('M7 8h10')}{P('M7 12h10')}{P('M7 16h6')}</>,
  '🪼': <>{P('M5 11a7 7 0 0 1 14 0z')}{P('M8 11v5')}{P('M12 11v8')}{P('M16 11v5')}</>,
}
// a couple of spellings the menu might use
ICONS['⚙️'] = ICONS['⚙']
ICONS['☰'] = <>{P('M4 6h16')}{P('M4 12h16')}{P('M4 18h16')}</>

export const hasLineIcon = (ic) => !!ICONS[ic]

// <NavIcon ic="📊" line /> → outline icon when `line` is on and one exists; otherwise the emoji.
export default function NavIcon({ ic, line, size = 18 }) {
  if (line && ICONS[ic]) {
    return (
      <span className="ic line" aria-hidden="true">
        <svg width={size} height={size} viewBox="0 0 24 24" {...S} style={{ display: 'block' }}>{ICONS[ic]}</svg>
      </span>
    )
  }
  return <span className="ic" aria-hidden="true" style={line ? { filter: 'grayscale(1)' } : undefined}>{ic}</span>
}
