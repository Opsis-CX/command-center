import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

// ============================================================
// 25 DAYS OF CHRISTMAS (2026-11-18, Brittney's approved design) — a personal advent calendar.
// One present unlocks each day Dec 1–25 (America/New_York). Opening one plays a little gift-opening
// animation and shows that day's surprise: a game, puzzle, recipe or reveal that works right here in
// the popup. Nothing is posted anywhere and there are no scores or rankings. Which presents a person
// has opened is saved for them only (seasonal_prefs, keys advent-2026-01 … advent-2026-25); small
// things like a decorated tree or a bingo card are kept in this browser. Admins/owners can preview
// every day before December so the calendar can be tested.
// ============================================================
const ART = '/seasonal/christmas/'
// TESTING SWITCH (2026-11-18): while this is true, admins/owners see all 25 presents unlocked on any
// date so Brittney can click through every day. Everyone else still follows the real Dec 1–25 schedule.
// Set it to false when testing is done.
const ADVENT_TEST_UNLOCK = false
const KEY = (d) => `advent-2026-${String(d).padStart(2, '0')}`
const reduceMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false } }
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch { return d } }
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* ignore */ } }
function useSaved(userId, name, initial) {
  const k = `cc.advent2026.${userId || 'me'}.${name}`
  const [v, setV] = useState(() => lsGet(k, initial))
  useEffect(() => { lsSet(k, v) }, [k, v])
  return [v, setV]
}
export function adventToday(d = new Date()) {
  const [mo, da] = d.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'numeric', day: 'numeric' }).split('/').map(Number)
  return mo === 12 ? Math.min(25, da) : 0          // 0 = before December (nothing unlocked yet)
}

const TEAL = '#0F6E7A', NAVY = '#0E2A44'
const CSS = `
.ad-wrap { position: fixed; inset: 0; z-index: 2600; background: rgba(6,26,44,.55); display: grid; place-items: center; padding: 14px; }
.ad-card { position: relative; width: min(820px, 100%); max-height: calc(100vh - 28px); display: flex; flex-direction: column; border-radius: 34px; overflow: hidden;
  border: 3px solid rgba(255,255,255,.92); box-shadow: 0 0 0 2px rgba(150,215,255,.45), 0 0 46px rgba(110,200,255,.55), 0 30px 80px -20px rgba(0,20,50,.7);
  background: url(${ART}adv_glitter.png) 0 0 / 320px 320px repeat, radial-gradient(120% 70% at 50% 0%, rgba(150,215,255,.55), transparent 60%),
    linear-gradient(160deg, #0B5AA3 0%, #1C86CC 38%, #39A6DE 62%, #1872BA 100%);
  animation: adIn .3s ease; font-family: Montserrat, Poppins, system-ui, sans-serif; }
.ad-card::before { content: ''; position: absolute; inset: 0; pointer-events: none; background: url(${ART}adv_glitter.png) 160px 90px / 260px 260px repeat; opacity: .55;
  animation: adShimmer 7s ease-in-out infinite; mix-blend-mode: screen; }
.ad-card::after { content: ''; position: absolute; inset: 0; pointer-events: none; border-radius: 31px; box-shadow: inset 0 0 0 2px rgba(255,255,255,.35), inset 0 0 50px rgba(200,235,255,.35); }
@keyframes adShimmer { 0%, 100% { opacity: .35; background-position: 160px 90px } 50% { opacity: .75; background-position: 166px 82px } }
@keyframes adIn { from { opacity: 0; transform: translateY(12px) scale(.98) } to { opacity: 1; transform: none } }
.ad-script { font-family: 'Kaushan Script', 'Dancing Script', cursive; font-weight: 400; }
.ad-close { position: absolute; top: 16px; right: 18px; z-index: 5; width: 46px; height: 46px; border-radius: 50%; border: 2.5px solid rgba(255,255,255,.95); cursor: pointer;
  background: radial-gradient(circle at 35% 30%, #1E8E9A, #0B5C66); color: #fff; font-size: 22px; line-height: 1; display: grid; place-items: center; box-shadow: 0 6px 16px -6px rgba(0,30,50,.7); }
.ad-close:hover { transform: scale(1.05); }
.ad-close:focus-visible, .ad-door:focus-visible, .ad-btn:focus-visible, .ad-opt:focus-visible { outline: 3px solid #FFE7A0; outline-offset: 3px; }
.ad-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px 10px; padding: 4px 34px 10px; }
.ad-door { position: relative; aspect-ratio: 300 / 270; border: 0; padding: 0; background: transparent; cursor: pointer; transition: transform .18s; font: inherit; }
.ad-door:hover:not(.locked) { transform: translateY(-3px) scale(1.03); }
.ad-door.locked { cursor: default; }
.ad-door img { position: absolute; inset: 0; width: 100%; height: auto; display: block; user-select: none; pointer-events: none; filter: drop-shadow(0 6px 8px rgba(0,30,70,.35)); }
.ad-num { position: absolute; left: 23.5%; right: 22%; top: 40%; bottom: 8%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
  color: ${NAVY}; font-weight: 800; font-size: clamp(16px, 3.4vw, 32px); line-height: 1; pointer-events: none; }
.ad-face { position: absolute; left: 23.3%; right: 22%; top: 38.5%; bottom: 6.3%; clip-path: polygon(11% 0, 89% 0, 100% 15%, 100% 86%, 89% 100%, 11% 100%, 0 86%, 0 15%);
  background: linear-gradient(160deg, #1C8E9C 0%, #0E6A78 60%, #0A5763 100%); pointer-events: none; }
.ad-door.today .ad-num { color: #fff; }
.ad-door.today::after { content: ''; position: absolute; left: 4%; right: 3%; top: 26%; bottom: 0; border-radius: 14px; pointer-events: none;
  box-shadow: 0 0 0 3px #FFD35C, 0 0 18px 6px rgba(255,214,92,.75); animation: adGlow 2.4s ease-in-out infinite; }
@keyframes adGlow { 0%, 100% { box-shadow: 0 0 0 3px #FFD35C, 0 0 14px 4px rgba(255,214,92,.6) } 50% { box-shadow: 0 0 0 3px #FFE38F, 0 0 24px 9px rgba(255,214,92,.85) } }
.ad-door.opened .ad-num { color: ${TEAL}; }
.ad-door .ad-lid { clip-path: inset(0 0 63% 0); }
.ad-door.opening .ad-lid { animation: adLid .75s cubic-bezier(.3,.6,.4,1) forwards; }
.ad-door.opening .ad-base { animation: adShake .35s ease-in-out 2; }
@keyframes adLid { 0% { transform: none; opacity: 1 } 35% { transform: translateY(-12%) rotate(-6deg) } 100% { transform: translateY(-60%) rotate(-16deg) translateX(-8%); opacity: 0 } }
@keyframes adShake { 0%, 100% { transform: rotate(0) } 25% { transform: rotate(-3deg) } 75% { transform: rotate(3deg) } }
.ad-spark { position: absolute; left: 50%; top: 40%; width: 10px; height: 10px; pointer-events: none; animation: adBurst .8s ease-out forwards; }
@keyframes adBurst { from { transform: translate(-50%, -50%) scale(.4); opacity: 1 } to { transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(1); opacity: 0 } }
.ad-foot { margin: 6px 34px 22px; border-radius: 999px; padding: 10px 26px; display: flex; align-items: center; justify-content: center; gap: 14px; flex-wrap: wrap;
  background: linear-gradient(180deg, rgba(255,255,255,.96), rgba(228,242,250,.94)); box-shadow: 0 0 0 2px rgba(255,255,255,.7), 0 0 22px rgba(190,230,255,.7); color: ${NAVY}; text-align: center; }
.ad-panel { margin: 0 26px 22px; border-radius: 24px; background: linear-gradient(180deg, #F7FBFE 0%, #E7F2F9 100%); box-shadow: 0 0 0 2px rgba(255,255,255,.8), 0 0 26px rgba(190,230,255,.6);
  display: flex; flex-direction: column; min-height: 0; flex: 1; overflow: hidden; color: ${NAVY}; animation: adIn .3s ease; }
.ad-panel-body { padding: 4px 22px 20px; overflow-y: auto; min-height: 0; }
.ad-btn { border: 0; border-radius: 999px; padding: 9px 18px; font: inherit; font-weight: 700; font-size: 14px; cursor: pointer; color: #fff;
  background: linear-gradient(180deg, #1A8592 0%, #0D6370 100%); box-shadow: 0 6px 14px -8px rgba(10,80,90,.9); }
.ad-btn:hover { filter: brightness(1.07); }
.ad-btn:disabled { opacity: .45; cursor: default; }
.ad-btn.ghost { background: #fff; color: ${TEAL}; box-shadow: inset 0 0 0 1.5px #A8D3DC; }
.ad-box { background: #fff; border-radius: 16px; padding: 14px 16px; box-shadow: 0 0 0 1px #D6E8F0, 0 8px 18px -14px rgba(20,70,100,.5); margin-top: 12px; }
.ad-q { font-weight: 700; font-size: 15px; margin-bottom: 10px; }
.ad-opts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.ad-opt { text-align: left; border: 1.5px solid #CFE3EC; background: #F6FBFD; border-radius: 12px; padding: 9px 12px; font: inherit; font-size: 14px; cursor: pointer; color: ${NAVY}; }
.ad-opt:hover:not(:disabled) { border-color: #6DBBC8; background: #EDF8FA; }
.ad-opt.right { border-color: #2FA36B; background: #E7F7EE; }
.ad-opt.wrong { border-color: #E07A6E; background: #FDEEEC; }
.ad-opt.picked { border-color: ${TEAL}; background: #E2F4F6; font-weight: 700; }
.ad-note { margin-top: 8px; font-size: 13.5px; color: #33566A; }
.ad-small { font-size: 13px; color: #4B6C7E; }
.ad-input { border: 1.5px solid #CFE3EC; border-radius: 10px; padding: 8px 10px; font: inherit; font-size: 14px; color: ${NAVY}; background: #fff; min-width: 0; }
.ad-input:focus { outline: none; border-color: #4FB0BF; box-shadow: 0 0 0 3px rgba(79,176,191,.2); }
@keyframes adPop { 0% { transform: scale(.6); opacity: 0 } 70% { transform: scale(1.06) } 100% { transform: none; opacity: 1 } }
@keyframes adSteam { 0% { transform: translateY(0) scaleX(1); opacity: 0 } 20% { opacity: .7 } 100% { transform: translateY(-26px) scaleX(1.3); opacity: 0 } }
@keyframes adTwinkle { 0%, 100% { opacity: .35 } 50% { opacity: 1 } }
@keyframes adWiggle { 0%, 100% { transform: rotate(0) } 20% { transform: rotate(-7deg) } 40% { transform: rotate(6deg) } 60% { transform: rotate(-4deg) } 80% { transform: rotate(3deg) } }
@media (max-width: 640px) { .ad-grid { padding: 4px 12px 8px; gap: 2px 6px; } .ad-foot { margin: 6px 12px 14px; } .ad-panel { margin: 0 10px 12px; } .ad-opts { grid-template-columns: 1fr; } }
@media (prefers-reduced-motion: reduce) { .ad-card, .ad-card::before, .ad-door.today::after, .ad-panel { animation: none !important; } }
`
function Flake({ size = 54, color = '#fff' }) {
  const arm = (<g><line x1="12" y1="12" x2="12" y2="1.2" /><polyline points="9.2,3.4 12,5.8 14.8,3.4" fill="none" /><polyline points="9.6,7 12,9 14.4,7" fill="none" /></g>)
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,40,90,.45))', flex: 'none' }}>
      <g stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{[0, 60, 120, 180, 240, 300].map(r => <g key={r} transform={`rotate(${r} 12 12)`}>{arm}</g>)}</g>
      <circle cx="12" cy="12" r="1.6" fill={color} />
    </svg>
  )
}
const Lock = ({ size = 18, color = '#5E7889' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10.5" rx="2.5" fill={color} /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke={color} strokeWidth="2.6" /><circle cx="12" cy="15" r="1.6" fill="#fff" /><rect x="11.3" y="15" width="1.4" height="3" fill="#fff" /></svg>
)
const Star4 = ({ c = '#fff' }) => <svg width="10" height="10" viewBox="0 0 16 16"><path d="M8 0 L9.3 6.7 L16 8 L9.3 9.3 L8 16 L6.7 9.3 L0 8 L6.7 6.7 Z" fill={c} /></svg>
function Sparkles({ n = 12, spread = 70 }) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2, r = spread * (.6 + (i % 3) * .2)
    return <span key={i} className="ad-spark" style={{ '--dx': `${Math.cos(a) * r}px`, '--dy': `${Math.sin(a) * r}px`, animationDelay: `${(i % 4) * .04}s` }}><Star4 c={i % 3 ? '#fff' : '#BFE9FF'} /></span>
  })
}

// ---------- shared pieces for the surprises ----------
function Quiz({ items, emojiPrompt }) {
  const [picks, setPicks] = useState({})
  return items.map((it, qi) => {
    const p = picks[qi]
    return (
      <div key={qi} className="ad-box">
        <div className="ad-q">{emojiPrompt ? <span style={{ fontSize: 30, letterSpacing: 4 }}>{it.q}</span> : `${qi + 1}. ${it.q}`}</div>
        <div className="ad-opts">
          {it.options.map((o, oi) => (
            <button key={oi} className={'ad-opt' + (p != null ? (oi === it.a ? ' right' : oi === p ? ' wrong' : '') : '')} disabled={p != null} onClick={() => setPicks(s => ({ ...s, [qi]: oi }))}>{o}</button>
          ))}
        </div>
        {p != null && <div className="ad-note"><b>{p === it.a ? 'You got it! 🎉' : `Not quite — it's "${it.options[it.a]}".`}</b>{it.note ? ' ' + it.note : ''}</div>}
      </div>
    )
  })
}
function RevealList({ items, label = 'Reveal', numbered = true }) {
  const [open, setOpen] = useState({})
  return items.map((it, i) => (
    <div key={i} className="ad-box">
      {it.front && <div className="ad-q">{numbered ? `${i + 1}. ` : ''}{it.front}</div>}
      {open[i] ? <div style={{ animation: 'adPop .35s ease', fontSize: 14.5 }}>{it.back}</div>
        : <button className="ad-btn ghost" onClick={() => setOpen(s => ({ ...s, [i]: true }))}>{it.label || label}</button>}
    </div>
  ))
}
function OneAtATime({ items, next = 'Reveal the next one', render }) {
  const [n, setN] = useState(1)
  return (
    <>
      {items.slice(0, n).map((it, i) => <div key={i} className="ad-box" style={{ animation: 'adPop .35s ease' }}>{render(it, i)}</div>)}
      {n < items.length && <div style={{ marginTop: 12 }}><button className="ad-btn" onClick={() => setN(n + 1)}>{next} ✨</button></div>}
    </>
  )
}
function Recipe({ title, serves, ingredients, steps, tip, art }) {
  return (
    <div className="ad-box">
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        {art}
        <div style={{ flex: 1, minWidth: 200 }}>
          <div className="ad-script" style={{ fontSize: 26, color: TEAL }}>{title}</div>
          <div className="ad-small">{serves}</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) 2fr', gap: 18, marginTop: 12 }} className="ad-recipe">
        <div><b>You'll need</b><ul style={{ margin: '6px 0 0', paddingLeft: 18, lineHeight: 1.6, fontSize: 14 }}>{ingredients.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
        <div><b>How to make it</b><ol style={{ margin: '6px 0 0', paddingLeft: 18, lineHeight: 1.6, fontSize: 14 }}>{steps.map((x, i) => <li key={i}>{x}</li>)}</ol></div>
      </div>
      {tip && <div className="ad-note">💡 {tip}</div>}
    </div>
  )
}

// ---------- Day 6: Spot the difference ----------
const DIFFS = [{ x: 100, y: 24, label: 'the star' }, { x: 86, y: 74, label: 'an ornament' }, { x: 46, y: 122, label: 'a present' }, { x: 30, y: 26, label: 'the moon' }, { x: 164, y: 84, label: "the snowman's hat" }]
function DiffScene({ alt, found, onPick, showAll }) {
  const ref = useRef(null)
  const click = (e) => {
    const r = ref.current.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width * 200, y = (e.clientY - r.top) / r.height * 150
    const i = DIFFS.findIndex(d => Math.hypot(d.x - x, d.y - y) < 15)
    if (i >= 0) onPick(i)
  }
  return (
    <svg ref={ref} viewBox="0 0 200 150" onClick={click} style={{ width: '100%', borderRadius: 12, cursor: 'crosshair', boxShadow: '0 0 0 1px #CFE3EC', display: 'block' }} role="img" aria-label={alt ? 'Picture B' : 'Picture A'}>
      <defs><linearGradient id={'dsky' + (alt ? 1 : 0)} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1C5C9A" /><stop offset="1" stopColor="#7FB9E3" /></linearGradient></defs>
      <rect width="200" height="150" fill={`url(#dsky${alt ? 1 : 0})`} />
      {!alt && <g><circle cx="30" cy="26" r="11" fill="#FFF6D6" /><circle cx="35" cy="22" r="9" fill="#2A6AA6" /></g>}
      {[[60, 18], [150, 14], [178, 40], [12, 60], [130, 34]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="1.3" fill="#fff" />)}
      <path d="M0 118 Q50 104 100 116 T200 112 V150 H0Z" fill="#F4FAFD" />
      <rect x="94" y="112" width="12" height="14" fill="#7A4A2A" />
      <polygon points="100,30 76,64 124,64" fill="#1E7A55" /><polygon points="100,48 68,90 132,90" fill="#1A6E4C" /><polygon points="100,70 60,116 140,116" fill="#176445" />
      {!alt ? <polygon points="100,16 103,24 111,24 105,29 107,37 100,32 93,37 95,29 89,24 97,24" fill="#FFD34D" /> : null}
      <circle cx="96" cy="58" r="3" fill="#E5484D" /><circle cx="110" cy="80" r="3" fill="#FFD34D" /><circle cx="84" cy="100" r="3" fill="#4FB0E8" /><circle cx="118" cy="104" r="3" fill="#E5484D" />
      {alt && <circle cx="86" cy="74" r="3.2" fill="#E5484D" />}
      <rect x="34" y="112" width="24" height="18" rx="2" fill={alt ? '#1FA2A8' : '#D64545'} /><rect x="44" y="112" width="4" height="18" fill="#FFE08A" /><rect x="34" y="119" width="24" height="4" fill="#FFE08A" />
      <circle cx="164" cy="118" r="13" fill="#fff" /><circle cx="164" cy="98" r="9.5" fill="#fff" />
      <circle cx="161" cy="96" r="1.2" fill="#223" /><circle cx="167" cy="96" r="1.2" fill="#223" /><polygon points="164,99 172,100 164,101" fill="#F28C28" />
      <rect x="155" y="84" width="18" height="3" fill={alt ? '#D64545' : '#1E2633'} /><rect x="158" y="72" width="12" height="13" fill={alt ? '#D64545' : '#1E2633'} />
      {DIFFS.map((d, i) => (found.includes(i) || showAll) ? <circle key={i} cx={d.x} cy={d.y} r="12" fill="none" stroke={found.includes(i) ? '#2FCB7B' : '#FFD34D'} strokeWidth="2.2" /> : null)}
    </svg>
  )
}
function SpotDifference() {
  const [found, setFound] = useState([])
  const [showAll, setShowAll] = useState(false)
  const pick = (i) => setFound(f => (f.includes(i) ? f : [...f, i]))
  return (
    <div className="ad-box">
      <div className="ad-q">Find the 5 differences between the two pictures — click them on either picture.</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <DiffScene found={found} onPick={pick} showAll={showAll} /><DiffScene alt found={found} onPick={pick} showAll={showAll} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
        <b>{found.length === 5 ? 'You found them all! 🎉' : `Found ${found.length} of 5`}</b>
        {found.length < 5 && !showAll && <button className="ad-btn ghost" onClick={() => setShowAll(true)}>Show me</button>}
        {(found.length || showAll) ? <button className="ad-btn ghost" onClick={() => { setFound([]); setShowAll(false) }}>Start over</button> : null}
      </div>
      {showAll && <div className="ad-note">The differences: {DIFFS.map(d => d.label).join(', ')}.</div>}
    </div>
  )
}

// ---------- Day 10: Mystery gift ----------
function MysteryGift() {
  const clues = ["It's cozy, and you wear it.", 'It often has reindeer, snowflakes or trees on it.', 'Some people wear the "ugly" kind on purpose — there are even parties for it!']
  const opts = ['A snow globe', 'A Christmas sweater', 'Fuzzy mittens', 'A Santa hat']
  const [n, setN] = useState(1)
  const [pick, setPick] = useState(null)
  const [open, setOpen] = useState(false)
  return (
    <div className="ad-box" style={{ textAlign: 'center' }}>
      <div style={{ position: 'relative', width: 150, margin: '4px auto 10px' }}>
        {!open ? <img src={ART + 'adv_box.webp'} alt="Wrapped mystery present" width="150" style={{ display: 'block', animation: pick != null && !reduceMotion() ? 'adWiggle .6s ease 2' : undefined }} />
          : <div style={{ fontSize: 86, animation: 'adPop .5s ease' }}>🧶</div>}
      </div>
      <div style={{ textAlign: 'left' }}>{clues.slice(0, n).map((c, i) => <div key={i} style={{ animation: 'adPop .3s ease', marginBottom: 6 }}><b>Clue {i + 1}:</b> {c}</div>)}</div>
      {n < 3 && <button className="ad-btn ghost" onClick={() => setN(n + 1)} style={{ marginTop: 4 }}>Next clue</button>}
      <div className="ad-q" style={{ marginTop: 14 }}>What do you think is inside?</div>
      <div className="ad-opts">{opts.map((o, i) => <button key={i} className={'ad-opt' + (pick === i ? ' picked' : '')} disabled={open} onClick={() => setPick(i)}>{o}</button>)}</div>
      <div style={{ marginTop: 12 }}>
        {!open ? <button className="ad-btn" disabled={pick == null} onClick={() => setOpen(true)}>Open the present 🎁</button>
          : <div className="ad-note" style={{ fontSize: 15 }}><b>{pick === 1 ? 'You guessed it!' : 'Surprise!'}</b> It's a cozy (and maybe a little ugly) Christmas sweater. 🎄</div>}
      </div>
    </div>
  )
}

// ---------- Day 11: Word scramble ----------
const SCRAMBLE = [{ s: 'NSLETI', w: 'TINSEL', h: 'Shiny strands that go on the tree' }, { s: 'GHISLE', w: 'SLEIGH', h: "Santa's ride" }, { s: 'KCOGSTIN', w: 'STOCKING', h: 'Hung by the chimney with care' },
  { s: 'TOELSTIME', w: 'MISTLETOE', h: 'Stand under it and you might get a kiss' }, { s: 'DEERNIRE', w: 'REINDEER', h: 'They pull the sleigh' }]
function Scramble() {
  const [vals, setVals] = useState({}), [state, setState] = useState({})
  return SCRAMBLE.map((it, i) => {
    const st = state[i] || {}
    const check = () => setState(s => ({ ...s, [i]: { ...st, result: (vals[i] || '').trim().toUpperCase() === it.w ? 'yes' : 'no' } }))
    return (
      <div key={i} className="ad-box">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 800, letterSpacing: 5, fontSize: 18, color: TEAL, minWidth: 150 }}>{it.s}</span>
          <input className="ad-input" style={{ flex: 1, minWidth: 140 }} placeholder="Your answer" value={vals[i] || ''} onChange={e => setVals(v => ({ ...v, [i]: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') check() }} aria-label={`Unscramble ${it.s}`} />
          <button className="ad-btn" onClick={check}>Check</button>
          <button className="ad-btn ghost" onClick={() => setState(s => ({ ...s, [i]: { ...st, hint: true } }))}>Hint</button>
          <button className="ad-btn ghost" onClick={() => setState(s => ({ ...s, [i]: { ...st, reveal: true } }))}>Reveal</button>
        </div>
        {st.result === 'yes' && <div className="ad-note" style={{ color: '#1F8A55' }}><b>Correct! 🎉</b></div>}
        {st.result === 'no' && !st.reveal && <div className="ad-note">Not quite — try again!</div>}
        {st.hint && <div className="ad-note">Hint: {it.h}</div>}
        {st.reveal && <div className="ad-note">Answer: <b>{it.w}</b></div>}
      </div>
    )
  })
}

// ---------- canvas scenes (Days 12, 20, 24, 25) ----------
function useCanvas(draw, deps = []) {
  const ref = useRef(null)
  useEffect(() => {
    const cv = ref.current; if (!cv) return
    const ctx = cv.getContext('2d'); let raf = 0, alive = true, t0 = performance.now()
    const size = () => { const r = cv.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1); cv.width = r.width * d; cv.height = r.height * d; ctx.setTransform(d, 0, 0, d, 0, 0); return r }
    let r = size()
    const state = { w: r.width, h: r.height }
    const api = draw(ctx, state)
    const still = reduceMotion()
    const loop = (t) => { if (!alive) return; api.frame && api.frame((t - t0) / 1000, still); if (!still) raf = requestAnimationFrame(loop) }
    raf = requestAnimationFrame(loop)
    const onR = () => { r = size(); state.w = r.width; state.h = r.height; api.resize && api.resize(); if (still) api.frame && api.frame(0, true) }
    window.addEventListener('resize', onR)
    ref.current.__api = api
    return () => { alive = false; cancelAnimationFrame(raf); window.removeEventListener('resize', onR) }
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
  return ref
}
function WinterWonderland() {
  const ref = useCanvas((ctx, s) => {
    let flakes = Array.from({ length: 70 }, () => ({ x: Math.random() * s.w, y: Math.random() * s.h, r: 1 + Math.random() * 2.4, v: .3 + Math.random() * .7, ph: Math.random() * 6 }))
    let burst = []
    const api = {
      add(x, y) { for (let i = 0; i < 40; i++) { const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 3.5; burst.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1, life: 1, r: 1 + Math.random() * 2.5, star: Math.random() < .35 }) } },
      frame(t) {
        const { w, h } = s
        const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#2E77B8'); g.addColorStop(.6, '#9CCDEB'); g.addColorStop(1, '#EAF5FB')
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h)
        ctx.fillStyle = '#F7FBFE'; ctx.beginPath(); ctx.moveTo(0, h * .78); ctx.quadraticCurveTo(w * .3, h * .66, w * .55, h * .78); ctx.quadraticCurveTo(w * .8, h * .88, w, h * .74); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.fill()
        for (const [px, sc] of [[.12, 1], [.2, .7], [.78, 1.1], [.88, .8], [.66, .6]]) {
          const x = w * px, base = h * .8, th = 70 * sc
          ctx.fillStyle = '#2F7F86'; for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(x, base - th + k * th * .28); ctx.lineTo(x - th * (.25 + k * .1), base - th * .45 + k * th * .28); ctx.lineTo(x + th * (.25 + k * .1), base - th * .45 + k * th * .28); ctx.fill() }
          ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, base - th + 4, 2.5 * sc, 0, 7); ctx.fill()
        }
        for (const f of flakes) { f.y += f.v; f.x += Math.sin(t + f.ph) * .3; if (f.y > h + 4) { f.y = -4; f.x = Math.random() * w } ctx.globalAlpha = .9; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 7); ctx.fill() }
        burst = burst.filter(b => b.life > 0)
        for (const b of burst) {
          b.x += b.vx; b.y += b.vy; b.vy += .05; b.life -= .014; ctx.globalAlpha = Math.max(0, b.life)
          if (b.star) { ctx.fillStyle = '#E8F7FF'; ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(t * 2); ctx.fillRect(-b.r * 2, -.6, b.r * 4, 1.2); ctx.fillRect(-.6, -b.r * 2, 1.2, b.r * 4); ctx.restore() }
          else { ctx.fillStyle = Math.random() < .5 ? '#FFFFFF' : '#BFE6FF'; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.fill() }
        }
        ctx.globalAlpha = 1
      },
    }
    return api
  })
  const click = (e) => { const r = e.currentTarget.getBoundingClientRect(); ref.current.__api?.add(e.clientX - r.left, e.clientY - r.top); if (reduceMotion()) ref.current.__api?.frame(0) }
  return (
    <div className="ad-box">
      <div className="ad-q">Click anywhere in the scene to make magic snow sparkle ✨</div>
      <canvas ref={ref} onClick={click} style={{ width: '100%', height: 280, borderRadius: 14, display: 'block', cursor: 'pointer' }} aria-label="Snowy winter scene — click to make sparkles" />
    </div>
  )
}
function SnowGlobe() {
  const [shake, setShake] = useState(0)
  const ref = useCanvas((ctx, s) => {
    const N = 90
    let p = Array.from({ length: N }, () => ({ x: Math.random(), y: .55 + Math.random() * .4, vx: 0, vy: 0, r: .8 + Math.random() * 1.8 }))
    const api = {
      shake() { for (const q of p) { const a = Math.random() * Math.PI * 2; q.vx = Math.cos(a) * (.008 + Math.random() * .02); q.vy = -(.01 + Math.random() * .025) } },
      frame(t, still) {
        const { w, h } = s, cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 2
        ctx.clearRect(0, 0, w, h); ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.clip()
        for (const q of p) {
          if (!still) { q.x += q.vx; q.y += q.vy; q.vy += .0006; q.vx *= .985; q.vy *= .985; const bottom = .93 - (Math.abs(q.x - .5) * .3) ** 2 * 2; if (q.y > bottom) { q.y = bottom; q.vy = 0; q.vx *= .5 } if (q.x < .05 || q.x > .95) q.vx *= -1 }
          ctx.globalAlpha = 1; ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(30,80,130,.55)'; ctx.shadowBlur = 3; ctx.beginPath(); ctx.arc(cx - R + q.x * 2 * R, cy - R + q.y * 2 * R, q.r + .4, 0, 7); ctx.fill(); ctx.shadowBlur = 0
        }
        ctx.restore(); ctx.globalAlpha = 1
      },
    }
    return api
  })
  const doShake = () => { setShake(s => s + 1); ref.current.__api?.shake() }
  return (
    <div className="ad-box" style={{ textAlign: 'center' }}>
      <div className="ad-q">Click the snow globe to shake it! ❄️</div>
      <button onClick={doShake} aria-label="Shake the snow globe" style={{ border: 0, background: 'transparent', cursor: 'pointer', padding: 0 }}>
        <div key={shake} style={{ position: 'relative', width: 240, height: 290, margin: '0 auto', animation: shake && !reduceMotion() ? 'adWiggle .6s ease' : undefined }}>
          <svg width="240" height="290" viewBox="0 0 240 290" style={{ position: 'absolute', inset: 0 }} aria-hidden="true">
            <defs><radialGradient id="sgG" cx="40%" cy="35%"><stop offset="0" stopColor="#E9F7FF" /><stop offset=".6" stopColor="#9FD3EF" /><stop offset="1" stopColor="#4E9CCB" /></radialGradient>
              <linearGradient id="sgB" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#D9E4EC" /><stop offset=".5" stopColor="#9FB1BF" /><stop offset="1" stopColor="#6E8291" /></linearGradient></defs>
            <circle cx="120" cy="120" r="108" fill="url(#sgG)" />
            <path d="M30 170 Q120 140 210 170 L210 200 Q120 225 30 200Z" fill="#F7FBFE" />
            <polygon points="70,170 92,120 114,170" fill="#2F7F86" /><polygon points="76,150 92,108 108,150" fill="#348B92" />
            <rect x="125" y="138" width="50" height="38" fill="#C2504A" /><polygon points="120,140 150,112 180,140" fill="#F7FBFE" /><rect x="142" y="154" width="14" height="22" fill="#6B3B2A" />
            <rect x="130" y="146" width="9" height="9" fill="#FFD77A" /><rect x="162" y="146" width="9" height="9" fill="#FFD77A" />
            <path d="M40 222 L200 222 L214 270 L26 270 Z" fill="url(#sgB)" /><rect x="22" y="268" width="196" height="14" rx="4" fill="#5D7282" />
            <text x="120" y="252" textAnchor="middle" fontSize="15" fill="#fff" fontFamily="'Kaushan Script', cursive">Merry Christmas</text>
          </svg>
          <canvas ref={ref} style={{ position: 'absolute', left: 12, top: 12, width: 216, height: 216, pointerEvents: 'none' }} />
          <svg width="240" height="290" viewBox="0 0 240 290" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} aria-hidden="true">
            <ellipse cx="80" cy="66" rx="34" ry="18" fill="#fff" opacity=".35" transform="rotate(-30 80 66)" /><circle cx="120" cy="120" r="108" fill="none" stroke="#fff" strokeOpacity=".7" strokeWidth="3" />
          </svg>
        </div>
      </button>
    </div>
  )
}
function ChristmasEve() {
  const ref = useCanvas((ctx, s) => {
    const stars = Array.from({ length: 90 }, () => ({ x: Math.random(), y: Math.random() * .55, r: .4 + Math.random() * 1.3, ph: Math.random() * 6 }))
    const snow = Array.from({ length: 60 }, () => ({ x: Math.random(), y: Math.random(), r: .8 + Math.random() * 1.6, v: .0008 + Math.random() * .0015 }))
    return {
      frame(t, still) {
        const { w, h } = s
        const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#071A3A'); g.addColorStop(.6, '#163E78'); g.addColorStop(1, '#2C5E9A'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h)
        for (const st of stars) { ctx.globalAlpha = still ? .8 : .4 + .6 * Math.abs(Math.sin(t * 1.4 + st.ph)); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(st.x * w, st.y * h, st.r, 0, 7); ctx.fill() }
        ctx.globalAlpha = 1
        const mx = w * .78, my = h * .22, mr = Math.min(w, h) * .09
        const mg = ctx.createRadialGradient(mx, my, mr * .2, mx, my, mr * 2.6); mg.addColorStop(0, 'rgba(255,246,210,.55)'); mg.addColorStop(1, 'rgba(255,246,210,0)'); ctx.fillStyle = mg; ctx.fillRect(0, 0, w, h)
        ctx.fillStyle = '#FFF4D2'; ctx.beginPath(); ctx.arc(mx, my, mr, 0, 7); ctx.fill()
        // sleigh silhouette crossing the moon every ~12s
        if (!still) {
          const k = (t % 12) / 12, sx = -80 + k * (w + 160), sy = my + 30 - Math.sin(k * Math.PI) * 50
          ctx.fillStyle = '#0B1E3E'; for (let i = 0; i < 3; i++) { const rx = sx - 26 - i * 22; ctx.fillRect(rx, sy, 14, 5); ctx.fillRect(rx + 10, sy - 6, 3, 7); ctx.fillRect(rx + 1, sy + 4, 2, 5); ctx.fillRect(rx + 10, sy + 4, 2, 5) }
          ctx.beginPath(); ctx.moveTo(sx, sy - 6); ctx.lineTo(sx + 26, sy - 6); ctx.lineTo(sx + 30, sy + 6); ctx.lineTo(sx - 2, sy + 6); ctx.fill()
        }
        ctx.fillStyle = '#E8F1F8'; ctx.beginPath(); ctx.moveTo(0, h * .75); ctx.quadraticCurveTo(w * .35, h * .62, w * .6, h * .76); ctx.quadraticCurveTo(w * .85, h * .86, w, h * .72); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.fill()
        const hx = w * .28, hy = h * .7
        ctx.fillStyle = '#5A3A2E'; ctx.fillRect(hx - 34, hy - 30, 68, 36); ctx.fillStyle = '#F4F8FB'; ctx.beginPath(); ctx.moveTo(hx - 42, hy - 28); ctx.lineTo(hx, hy - 58); ctx.lineTo(hx + 42, hy - 28); ctx.fill()
        ctx.fillStyle = still ? '#FFD36B' : `rgba(255,${200 + Math.round(20 * Math.sin(t * 3))},110,1)`; ctx.fillRect(hx - 24, hy - 20, 12, 12); ctx.fillRect(hx + 12, hy - 20, 12, 12)
        ctx.fillStyle = '#2E2016'; ctx.fillRect(hx - 6, hy - 14, 12, 20)
        for (const f of snow) { if (!still) { f.y += f.v; if (f.y > 1) f.y = 0 } ctx.globalAlpha = .85; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(f.x * w + Math.sin(t + f.x * 9) * 4, f.y * h, f.r, 0, 7); ctx.fill() }
        ctx.globalAlpha = 1
      },
    }
  })
  return (
    <div className="ad-box" style={{ padding: 0, overflow: 'hidden', position: 'relative' }}>
      <canvas ref={ref} style={{ width: '100%', height: 300, display: 'block' }} aria-hidden="true" />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 18, textAlign: 'center', color: '#fff', textShadow: '0 2px 10px rgba(0,20,60,.8)' }}>
        <div className="ad-script" style={{ fontSize: 30 }}>'Twas the night before Christmas…</div>
        <div style={{ fontWeight: 600, fontSize: 15, marginTop: 4 }}>Wishing you a peaceful, magical Christmas Eve ✨</div>
      </div>
    </div>
  )
}
function GrandSurprise() {
  const [stage, setStage] = useState('wrapped')   // wrapped → opening → open
  const ref = useCanvas((ctx, s) => {
    let parts = []
    return {
      burst() { const { w, h } = s; for (let i = 0; i < 160; i++) { const a = -Math.PI / 2 + (Math.random() - .5) * Math.PI * 1.4, sp = 2 + Math.random() * 6; parts.push({ x: w / 2, y: h * .55, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, r: .8 + Math.random() * 2.2, c: ['#FFFFFF', '#CFEFFF', '#8FD3F5', '#E6EEF3', '#B8C7D3'][i % 5], flake: i % 9 === 0 }) } },
      frame(t) {
        const { w, h } = s; ctx.clearRect(0, 0, w, h); parts = parts.filter(p => p.life > 0)
        for (const p of parts) {
          p.x += p.vx; p.y += p.vy; p.vy += .06; p.vx *= .99; p.life -= .009; ctx.globalAlpha = Math.max(0, p.life)
          if (p.flake) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(t); for (let k = 0; k < 6; k++) { ctx.rotate(Math.PI / 3); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -6); ctx.stroke() } ctx.restore() }
          else { ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill() }
        }
        ctx.globalAlpha = 1
      },
    }
  })
  const open = () => {
    if (stage !== 'wrapped') return
    if (reduceMotion()) { setStage('open'); return }
    setStage('opening')
    setTimeout(() => { ref.current.__api?.burst() }, 650)
    setTimeout(() => setStage('open'), 1100)
  }
  return (
    <div className="ad-box" style={{ position: 'relative', textAlign: 'center', minHeight: 330, overflow: 'hidden', background: 'linear-gradient(180deg, #EAF6FC, #FFFFFF)' }}>
      <canvas ref={ref} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} aria-hidden="true" />
      {stage !== 'open' ? (
        <>
          <div className="ad-q" style={{ marginTop: 6 }}>One last present, just for you…</div>
          <button onClick={open} aria-label="Open your Christmas present" style={{ border: 0, background: 'transparent', cursor: 'pointer', position: 'relative', width: 220, height: 200, padding: 0 }}>
            <img src={ART + 'adv_box.webp'} alt="" width="220" style={{ position: 'absolute', left: 0, top: 0, animation: stage === 'opening' ? 'adShake .3s ease-in-out 2' : 'adWiggle 2.6s ease-in-out infinite' }} />
            <img src={ART + 'adv_box.webp'} alt="" width="220" style={{ position: 'absolute', left: 0, top: 0, clipPath: 'inset(0 0 63% 0)', animation: stage === 'opening' ? 'adLid .9s cubic-bezier(.3,.6,.4,1) .5s forwards' : undefined }} />
          </button>
          <div className="ad-small">{stage === 'wrapped' ? 'Click the present to open it 🎁' : ''}</div>
        </>
      ) : (
        <div style={{ position: 'relative', padding: '16px 10px 6px', animation: 'adPop .6s ease' }}>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 14, alignItems: 'center' }}><Flake size={34} color="#5DB6CF" /><span className="ad-script" style={{ fontSize: 42, color: TEAL }}>Merry Christmas!</span><Flake size={34} color="#5DB6CF" /></div>
          <div style={{ fontSize: 16, lineHeight: 1.65, maxWidth: 520, margin: '10px auto 0', color: NAVY }}>
            From all of us at <b>OpsisCx</b>, thank you for being part of our team this year.<br />
            We hope your Christmas is filled with warmth, laughter, good food and time with the people you love.
          </div>
          <div className="ad-script" style={{ fontSize: 24, color: TEAL, marginTop: 12 }}>Merry Christmas & Happy New Year! 🎄</div>
          <div style={{ marginTop: 14 }}><button className="ad-btn ghost" onClick={() => setStage('wrapped')}>Open it again</button></div>
        </div>
      )}
    </div>
  )
}

// ---------- "Share in chat" (Days 16 and 19) ----------
// Turns the picture into a PNG, closes the calendar, goes to Chat and attaches it to the message box of
// whichever chat is open, with a little caption typed in. Nothing is sent until the person clicks Send,
// so they can pick the chat and change the words first. Chat.jsx is untouched: we use its own file input.
async function svgToPngFile(svg, name, caption) {
  const vb = svg.viewBox.baseVal, W = 720, H = Math.round(W * vb.height / vb.width) + 70
  const clone = svg.cloneNode(true)
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); clone.setAttribute('width', W); clone.setAttribute('height', H - 70)
  clone.querySelectorAll('[style]').forEach(el => { el.style.animation = 'none' })
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone))
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url })
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const g = c.getContext('2d')
  const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#DDEFF8'); bg.addColorStop(1, '#FFFFFF'); g.fillStyle = bg; g.fillRect(0, 0, W, H)
  g.drawImage(img, 0, 0, W, H - 70)
  g.fillStyle = '#0F6E7A'; g.font = '600 26px Montserrat, Poppins, sans-serif'; g.textAlign = 'center'; g.fillText(caption, W / 2, H - 28)
  const blob = await new Promise(res => c.toBlob(res, 'image/png'))
  return new File([blob], name, { type: 'image/png' })
}
function attachToChat(file, text, onClose) {
  onClose?.()
  if (!/^\/chat/.test(window.location.pathname)) { window.history.pushState({}, '', '/chat'); window.dispatchEvent(new PopStateEvent('popstate')) }
  const started = Date.now()
  const tryAttach = () => {
    const pane = document.querySelector('[data-cc-chatpane]')
    // the main message box is the bottom-most editor in the chat pane; use the file input that sits with it
    const wraps = pane ? [...pane.querySelectorAll('.re-wrap')].filter(w => w.offsetParent).sort((x, y) => y.getBoundingClientRect().bottom - x.getBoundingClientRect().bottom) : []
    let input = null
    for (let el = wraps[0]; el && el !== pane.parentElement && !input; el = el.parentElement) input = el.querySelector('input[type="file"]')
    if (!input) { if (Date.now() - started < 60000) setTimeout(tryAttach, 500); return }
    const dt = new DataTransfer(); dt.items.add(file)
    input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }))
    const ed = wraps[0].querySelector('[contenteditable="true"]')
    if (ed && !(ed.textContent || '').trim()) { ed.focus(); try { document.execCommand('insertText', false, text) } catch { /* ignore */ } }
  }
  setTimeout(tryAttach, 350)
}
function ShareInChat({ svgRef, name, caption, text, onClose }) {
  const [busy, setBusy] = useState(false)
  const share = async () => {
    if (!svgRef.current || busy) return
    setBusy(true)
    try { const f = await svgToPngFile(svgRef.current, name, caption); attachToChat(f, text, onClose) } catch { setBusy(false) }
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <button className="ad-btn" onClick={share} disabled={busy}>💬 Share in chat</button>
      <span className="ad-small">Adds the picture to the chat you have open. You pick the chat and hit Send.</span>
    </div>
  )
}

// ---------- Day 15: Bingo ----------
const BINGO = ['Wrapped a gift', 'Drank hot cocoa', 'Watched a Christmas movie', 'Heard "All I Want for Christmas"', 'Saw holiday lights', 'Ate a Christmas cookie', 'Wore something festive', 'Sang a carol',
  'Saw a snowman', 'Got a holiday card', 'Ate a candy cane', 'Smelled a pine tree', 'FREE ⭐', 'Said "Happy Holidays"', 'Untangled lights', 'Used way too much tape', 'Saw a reindeer decoration',
  'Had something peppermint', 'Wore pajamas all day', 'Played holiday music', 'Saw an ugly sweater', 'Made gingerbread anything', 'Made a wish list', 'Stayed up too late wrapping', 'Shared a treat']
function Bingo({ userId }) {
  const [marks, setMarks] = useSaved(userId, 'bingo', [12])
  const has = (i) => i === 12 || marks.includes(i)
  const lines = []
  for (let r = 0; r < 5; r++) lines.push([0, 1, 2, 3, 4].map(c => r * 5 + c))
  for (let c = 0; c < 5; c++) lines.push([0, 1, 2, 3, 4].map(r => r * 5 + c))
  lines.push([0, 6, 12, 18, 24], [4, 8, 12, 16, 20])
  const bingo = lines.some(l => l.every(has))
  return (
    <div className="ad-box">
      <div className="ad-q">Mark off the things you've done this season (just for you — nobody else sees it).</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
        {BINGO.map((b, i) => (
          <button key={i} onClick={() => i !== 12 && setMarks(m => (m.includes(i) ? m.filter(x => x !== i) : [...m, i]))}
            style={{ aspectRatio: '1.25', border: '1.5px solid ' + (has(i) ? '#1B8B98' : '#CFE3EC'), borderRadius: 10, background: has(i) ? 'linear-gradient(160deg,#1C8E9C,#0E6A78)' : '#F7FBFD', color: has(i) ? '#fff' : NAVY,
              font: 'inherit', fontSize: 11.5, fontWeight: 600, lineHeight: 1.2, padding: 4, cursor: i === 12 ? 'default' : 'pointer' }} aria-pressed={has(i)}>{b}</button>
        ))}
      </div>
      <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center' }}>
        {bingo ? <b style={{ color: TEAL, fontSize: 18, animation: 'adPop .4s ease' }}>BINGO! 🎉</b> : <span className="ad-small">Get five in a row — across, down or diagonal.</span>}
        <button className="ad-btn ghost" style={{ marginLeft: 'auto' }} onClick={() => setMarks([12])}>Clear card</button>
      </div>
    </div>
  )
}

// ---------- Day 16: Decorate a tree ----------
const TREE_TRIS = [[[100, 26], [62, 86], [138, 86]], [[100, 58], [46, 132], [154, 132]], [[100, 98], [30, 182], [170, 182]]]
const inTri = (p, [a, b, c]) => { const s = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]); const d1 = s(p, a, b), d2 = s(p, b, c), d3 = s(p, c, a); return !(((d1 < 0) || (d2 < 0) || (d3 < 0)) && ((d1 > 0) || (d2 > 0) || (d3 > 0))) }
const ORN = { red: '#E5484D', gold: '#F5C542', silver: '#C9D3DB', teal: '#1FA6B0', cane: 'cane', bow: 'bow' }
function Ornament({ o }) {
  if (o.k === 'cane') return <g transform={`translate(${o.x} ${o.y})`}><path d="M0 7 V-3 a3 3 0 0 1 6 0" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" /><path d="M0 7 V-3 a3 3 0 0 1 6 0" fill="none" stroke="#E5484D" strokeWidth="2.6" strokeDasharray="2 2" strokeLinecap="round" /></g>
  if (o.k === 'bow') return <g transform={`translate(${o.x} ${o.y})`}><path d="M0 0 L-6 -4 L-6 4 Z M0 0 L6 -4 L6 4 Z" fill="#E5484D" /><circle r="1.8" fill="#B82E33" /></g>
  return <g><circle cx={o.x} cy={o.y} r="4.6" fill={ORN[o.k]} stroke="rgba(0,0,0,.15)" strokeWidth=".6" /><circle cx={o.x - 1.4} cy={o.y - 1.6} r="1.3" fill="#fff" opacity=".75" /><rect x={o.x - 1.2} y={o.y - 6.4} width="2.4" height="2" fill="#B9A15A" /></g>
}
function DecorateTree({ userId, onClose }) {
  const [state, setState] = useSaved(userId, 'tree', { orn: [], lights: false, topper: 'star' })
  const [tool, setTool] = useState('red')
  const ref = useRef(null)
  const place = (e) => {
    const r = ref.current.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width * 200, y = (e.clientY - r.top) / r.height * 220
    if (!TREE_TRIS.some(t => inTri([x, y], t))) return
    setState(s => ({ ...s, orn: [...s.orn, { x: Math.round(x), y: Math.round(y), k: tool }].slice(-60) }))
  }
  const lights = []
  if (state.lights) for (const [y0, x0, x1, y1] of [[60, 70, 132, 80], [100, 54, 148, 118], [150, 40, 162, 172]]) for (let i = 0; i <= 8; i++) { const t = i / 8; lights.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t + Math.sin(t * Math.PI) * 6, c: ['#FFE27A', '#FF8A8A', '#8FE0FF', '#B7FF9E'][i % 4], d: (i % 4) * .4 }) }
  return (
    <div className="ad-box">
      <div className="ad-q">Pick a decoration, then click the tree to hang it.</div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <svg ref={ref} viewBox="0 0 200 220" onClick={place} style={{ width: 'min(300px, 100%)', cursor: 'copy', background: 'linear-gradient(180deg,#EAF6FC,#FFFFFF)', borderRadius: 14 }} role="img" aria-label="Your Christmas tree">
          <ellipse cx="100" cy="206" rx="80" ry="10" fill="#E4EFF6" />
          <rect x="90" y="180" width="20" height="24" fill="#7A4A2A" />
          {TREE_TRIS.map((t, i) => <polygon key={i} points={t.map(p => p.join(',')).join(' ')} fill={['#1F8158', '#1A7550', '#166947'][i]} />)}
          {state.lights && lights.map((l, i) => <circle key={i} cx={l.x} cy={l.y} r="2.4" fill={l.c} style={{ animation: reduceMotion() ? undefined : `adTwinkle 1.6s ease-in-out ${l.d}s infinite`, filter: `drop-shadow(0 0 2px ${l.c})` }} />)}
          {state.orn.map((o, i) => <Ornament key={i} o={o} />)}
          {state.topper === 'star' && <polygon points="100,8 104,19 116,19 106,26 110,37 100,30 90,37 94,26 84,19 96,19" fill="#FFD34D" stroke="#E5A800" strokeWidth=".8" />}
          {state.topper === 'bow' && <g transform="translate(100 22)"><path d="M0 0 L-12 -8 L-12 8 Z M0 0 L12 -8 L12 8 Z" fill="#E5484D" /><circle r="3.4" fill="#B82E33" /></g>}
          {state.topper === 'snowflake' && <g transform="translate(88 8) scale(1)"><g stroke="#7CCBE0" strokeWidth="2" strokeLinecap="round">{[0, 60, 120].map(r => <line key={r} x1="12" y1="2" x2="12" y2="22" transform={`rotate(${r} 12 12)`} />)}</g></g>}
        </svg>
        <div style={{ flex: 1, minWidth: 200, display: 'grid', gap: 12 }}>
          <div><b>Decorations</b><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            {[['red', 'Red'], ['gold', 'Gold'], ['silver', 'Silver'], ['teal', 'Teal'], ['cane', 'Candy cane'], ['bow', 'Bow']].map(([k, l]) => (
              <button key={k} className={'ad-opt' + (tool === k ? ' picked' : '')} onClick={() => setTool(k)} style={{ padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
                {ORN[k].startsWith('#') ? <span style={{ width: 12, height: 12, borderRadius: '50%', background: ORN[k], display: 'inline-block' }} /> : <span>{k === 'cane' ? '🍬' : '🎀'}</span>}{l}
              </button>))}
          </div></div>
          <div><b>Tree topper</b><div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            {[['star', '⭐ Star'], ['bow', '🎀 Bow'], ['snowflake', '❄️ Snowflake']].map(([k, l]) => <button key={k} className={'ad-opt' + (state.topper === k ? ' picked' : '')} style={{ padding: '6px 10px' }} onClick={() => setState(s => ({ ...s, topper: k }))}>{l}</button>)}
          </div></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="ad-btn" onClick={() => setState(s => ({ ...s, lights: !s.lights }))}>{state.lights ? 'Turn lights off' : 'Add twinkle lights ✨'}</button>
            <button className="ad-btn ghost" onClick={() => setState(s => ({ ...s, orn: s.orn.slice(0, -1) }))} disabled={!state.orn.length}>Undo</button>
            <button className="ad-btn ghost" onClick={() => setState({ orn: [], lights: false, topper: 'star' })}>Start over</button>
          </div>
          <ShareInChat svgRef={ref} name="my-christmas-tree.png" caption="My Christmas tree 🎄" text="Check out the Christmas tree I decorated! 🎄" onClose={onClose} />
        </div>
      </div>
    </div>
  )
}

// ---------- Day 18: Picture puzzle ----------
function Puzzle() {
  const start = [4, 8, 1, 6, 0, 3, 7, 2, 5]
  const [tiles, setTiles] = useState(start)
  const [sel, setSel] = useState(null)
  const solved = tiles.every((t, i) => t === i)
  const tap = (i) => {
    if (solved) return
    if (sel == null) { setSel(i); return }
    if (sel !== i) setTiles(t => { const n = [...t]; [n[sel], n[i]] = [n[i], n[sel]]; return n })
    setSel(null)
  }
  const shuffle = () => { const n = [...Array(9).keys()]; do { for (let i = 8; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [n[i], n[j]] = [n[j], n[i]] } } while (n.every((t, i) => t === i)); setTiles(n); setSel(null) }
  return (
    <div className="ad-box">
      <div className="ad-q">Click two pieces to swap them. Put the winter picture back together!</div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: solved ? 0 : 3, width: 'min(330px, 100%)', aspectRatio: '1225 / 924', transition: 'gap .3s' }}>
          {tiles.map((t, i) => (
            <button key={i} onClick={() => tap(i)} aria-label={`Puzzle piece ${i + 1}`}
              style={{ border: 0, padding: 0, cursor: solved ? 'default' : 'pointer', backgroundImage: `url(${ART}scene.webp)`, backgroundSize: '300% 300%', backgroundPosition: `${(t % 3) * 50}% ${Math.floor(t / 3) * 50}%`,
                outline: sel === i ? '3px solid #FFC93C' : 'none', outlineOffset: -3, borderRadius: solved ? 0 : 4, backgroundColor: '#DDEBF3' }} />
          ))}
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <div className="ad-small" style={{ marginBottom: 6 }}>The finished picture:</div>
          <img src={ART + 'scene.webp'} alt="" width="150" style={{ borderRadius: 8, display: 'block', boxShadow: '0 0 0 1px #CFE3EC', background: '#DDEBF3' }} />
          <div style={{ marginTop: 12 }}>{solved ? <b style={{ color: TEAL, animation: 'adPop .4s ease', display: 'inline-block' }}>You did it! 🎉</b> : <button className="ad-btn ghost" onClick={shuffle}>Shuffle</button>}</div>
          {solved && <div style={{ marginTop: 8 }}><button className="ad-btn ghost" onClick={shuffle}>Play again</button></div>}
        </div>
      </div>
    </div>
  )
}

// ---------- Day 19: Build a snowman ----------
function BuildSnowman({ userId, onClose }) {
  const svgRef = useRef(null)
  const [o, setO] = useSaved(userId, 'snowman', { hat: 'top', scarf: 'teal', face: 'happy', extra: 'none' })
  const set = (k, v) => setO(s => ({ ...s, [k]: v }))
  const scarfC = { teal: '#1FA6B0', red: '#E5484D', striped: 'url(#smStripe)', none: null }[o.scarf]
  const Row = ({ label, k, opts }) => (
    <div><b>{label}</b><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>{opts.map(([v, l]) => <button key={v} className={'ad-opt' + (o[k] === v ? ' picked' : '')} style={{ padding: '6px 10px' }} onClick={() => set(k, v)}>{l}</button>)}</div></div>
  )
  return (
    <div className="ad-box">
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <svg ref={svgRef} viewBox="0 0 200 240" style={{ width: 'min(260px, 100%)', background: 'linear-gradient(180deg,#CFE7F5,#F4FAFD)', borderRadius: 14 }} role="img" aria-label="Your snowman">
          <defs><pattern id="smStripe" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#E5484D" /><rect width="4" height="8" fill="#fff" /></pattern></defs>
          <ellipse cx="100" cy="226" rx="90" ry="12" fill="#fff" />
          {o.extra === 'broom' && <g><line x1="150" y1="120" x2="176" y2="228" stroke="#8A5A32" strokeWidth="4" /><path d="M168 200 L186 232 L166 234 Z" fill="#D9A441" /></g>}
          <circle cx="100" cy="186" r="44" fill="#fff" stroke="#DDE9F1" /><circle cx="100" cy="122" r="32" fill="#fff" stroke="#DDE9F1" /><circle cx="100" cy="72" r="25" fill="#fff" stroke="#DDE9F1" />
          <line x1="72" y1="118" x2="40" y2="96" stroke="#7A4A2A" strokeWidth="3.5" strokeLinecap="round" /><line x1="128" y1="118" x2="160" y2="96" stroke="#7A4A2A" strokeWidth="3.5" strokeLinecap="round" />
          {o.extra === 'mittens' && <g><circle cx="38" cy="94" r="7" fill="#E5484D" /><circle cx="162" cy="94" r="7" fill="#E5484D" /></g>}
          {[110, 126, 142].map(y => <circle key={y} cx="100" cy={y} r="3.4" fill="#2A2F3A" />)}
          {o.face === 'wink' ? <g><circle cx="91" cy="66" r="3" fill="#2A2F3A" /><path d="M105 66 q4 -4 8 0" stroke="#2A2F3A" strokeWidth="2.2" fill="none" strokeLinecap="round" /></g>
            : <g><circle cx="91" cy="66" r="3" fill="#2A2F3A" /><circle cx="109" cy="66" r="3" fill="#2A2F3A" /></g>}
          <polygon points="100,72 122,76 100,79" fill="#F28C28" />
          {o.face === 'surprised' ? <circle cx="100" cy="86" r="4" fill="#2A2F3A" /> : <path d="M89 84 q11 9 22 0" stroke="#2A2F3A" strokeWidth="2.4" fill="none" strokeLinecap="round" />}
          <circle cx="86" cy="76" r="4" fill="#FFB3B8" opacity=".6" /><circle cx="114" cy="76" r="4" fill="#FFB3B8" opacity=".6" />
          {scarfC && <g><path d="M72 94 Q100 106 128 94 L128 102 Q100 114 72 102 Z" fill={scarfC} /><rect x="110" y="100" width="11" height="30" rx="3" fill={scarfC} /></g>}
          {o.hat === 'top' && <g><rect x="74" y="50" width="52" height="7" rx="2" fill="#1E2633" /><rect x="82" y="20" width="36" height="32" rx="3" fill="#1E2633" /><rect x="82" y="44" width="36" height="6" fill="#C0392B" /></g>}
          {o.hat === 'beanie' && <g><path d="M76 58 Q78 30 100 28 Q122 30 124 58 Z" fill="#1FA6B0" /><rect x="74" y="52" width="52" height="10" rx="4" fill="#E8F4F7" /><circle cx="100" cy="26" r="7" fill="#fff" /></g>}
          {o.hat === 'santa' && <g><path d="M76 56 Q86 26 112 24 Q134 26 138 46 L126 44 Q120 40 124 58 Z" fill="#D63A3F" /><rect x="72" y="52" width="56" height="10" rx="5" fill="#fff" /><circle cx="137" cy="48" r="6" fill="#fff" /></g>}
          {o.extra === 'earmuffs' && <g><path d="M76 60 Q100 30 124 60" stroke="#8E5BD8" strokeWidth="3" fill="none" /><circle cx="76" cy="66" r="7" fill="#F2A7D2" /><circle cx="124" cy="66" r="7" fill="#F2A7D2" /></g>}
        </svg>
        <div style={{ flex: 1, minWidth: 220, display: 'grid', gap: 12 }}>
          <Row label="Hat" k="hat" opts={[['top', '🎩 Top hat'], ['beanie', '🧢 Beanie'], ['santa', '🎅 Santa hat'], ['none', 'No hat']]} />
          <Row label="Scarf" k="scarf" opts={[['teal', 'Teal'], ['red', 'Red'], ['striped', 'Candy stripe'], ['none', 'No scarf']]} />
          <Row label="Face" k="face" opts={[['happy', '😊 Happy'], ['wink', '😉 Wink'], ['surprised', '😮 Surprised']]} />
          <Row label="Extras" k="extra" opts={[['none', 'None'], ['mittens', '🧤 Mittens'], ['earmuffs', '🎧 Earmuffs'], ['broom', '🧹 Broom']]} />
          <ShareInChat svgRef={svgRef} name="my-snowman.png" caption="Meet my snowman ☃️" text="Meet the snowman I built! ☃️" onClose={onClose} />
        </div>
      </div>
    </div>
  )
}

// ---------- Day 21: Mad Libs ----------
const MADLIB_FIELDS = [['adj', 'An adjective (like "sparkly")'], ['animal', 'An animal'], ['food', 'A food'], ['plural', 'A plural noun (like "socks")'], ['sound', 'A silly sound'], ['number', 'A number'], ['verb', 'A verb ending in -ing']]
function MadLibs() {
  const [v, setV] = useState({}), [show, setShow] = useState(false)
  const ready = MADLIB_FIELDS.every(([k]) => (v[k] || '').trim())
  const B = ({ k }) => <b style={{ color: TEAL, background: '#E3F4F6', borderRadius: 6, padding: '0 5px' }}>{v[k]}</b>
  return (
    <div className="ad-box">
      {!show ? (
        <>
          <div className="ad-q">Fill in the blanks, then reveal your one-of-a-kind Christmas story!</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
            {MADLIB_FIELDS.map(([k, l]) => <label key={k} style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 600 }}>{l}<input className="ad-input" value={v[k] || ''} onChange={e => setV(s => ({ ...s, [k]: e.target.value }))} maxLength={30} /></label>)}
          </div>
          <div style={{ marginTop: 12 }}><button className="ad-btn" disabled={!ready} onClick={() => setShow(true)}>Reveal my story 📜</button></div>
        </>
      ) : (
        <div style={{ animation: 'adPop .4s ease' }}>
          <div className="ad-script" style={{ fontSize: 26, color: TEAL, marginBottom: 8 }}>The Night Santa Got Lost</div>
          <p style={{ lineHeight: 1.8, fontSize: 15, margin: 0 }}>
            It was a <B k="adj" /> Christmas Eve when Santa realized his reindeer had been replaced by a very confused <B k="animal" />. Instead of carrots, it would only eat <B k="food" />, and every time
            the sleigh took off it shouted "<B k="sound" />!" They visited <B k="number" /> houses, delivering nothing but <B k="plural" />, and the elves spent all night <B k="verb" /> to fix the mess.
            By morning, everyone agreed it was the most <B k="adj" /> Christmas ever. 🎅
          </p>
          <div style={{ marginTop: 12 }}><button className="ad-btn ghost" onClick={() => { setShow(false); setV({}) }}>Play again</button></div>
        </div>
      )}
    </div>
  )
}

// ---------- Day 22: Joke generator ----------
const JOKES = [['What do you call Santa when he takes a break?', 'Santa Pause.'], ["Why don't Christmas trees knit?", 'They always drop their needles.'], ['What do elves learn in school?', 'The elf-abet.'],
  ['What do you get if you eat Christmas decorations?', 'Tinsel-itis.'], ['Why did Frosty ask for a day off?', 'He had a meltdown.'], ['What do you call a broke Santa?', 'Saint Nickel-less.'],
  ["What's a snowman's favorite snack?", 'Ice Krispies.'], ['Why was the turkey in the Christmas band?', 'It had the drumsticks.'], ['What do you call a cat on the beach at Christmas?', 'Sandy Claws.'],
  ['How do you know Santa is good at karate?', 'He has a black belt.'], ["What's every elf's favorite type of music?", 'Wrap.'], ['What do reindeer hang on their trees?', 'Horn-aments.'],
  ['Why does Santa go down the chimney?', 'Because it soots him.'], ['What did the gingerbread man put on his bed?', 'A cookie sheet.'], ['What do you call an old snowman?', 'Water.'],
  ['Why did the ornament go to school?', 'It wanted to be a little brighter.'], ["What's Santa's favorite type of pizza?", "One that's deep pan, crisp and even."], ['How does a snowman get around?', 'He rides an icicle.'],
  ['What do you call a reindeer with no eyes?', 'No eye-deer.'], ["What's green, covered in tinsel and goes ribbit?", 'A mistle-toad.']]
function JokeGenerator() {
  const [i, setI] = useState(() => Math.floor(Math.random() * JOKES.length))
  const [show, setShow] = useState(false)
  const next = () => { let n; do { n = Math.floor(Math.random() * JOKES.length) } while (n === i); setI(n); setShow(false) }
  return (
    <div className="ad-box" style={{ textAlign: 'center', padding: '22px 16px' }}>
      <div key={i} style={{ fontSize: 18, fontWeight: 700, animation: 'adPop .35s ease' }}>{JOKES[i][0]}</div>
      <div style={{ minHeight: 40, marginTop: 10 }}>{show ? <div className="ad-script" style={{ fontSize: 26, color: TEAL, animation: 'adPop .35s ease' }}>{JOKES[i][1]} 😂</div>
        : <button className="ad-btn ghost" onClick={() => setShow(true)}>Tell me the answer</button>}</div>
      <button className="ad-btn" onClick={next} style={{ marginTop: 10 }}>Tell me another! 🎅</button>
    </div>
  )
}

// ---------- art for the recipes ----------
const BarkArt = () => (
  <svg width="90" height="70" viewBox="0 0 90 70" aria-hidden="true"><path d="M8 30 L50 14 L84 30 L44 50 Z" fill="#4A2A1E" /><path d="M8 30 L44 50 L44 58 L8 38 Z" fill="#3A2016" /><path d="M44 50 L84 30 L84 38 L44 58 Z" fill="#2E190F" />
    <path d="M12 28 L50 13 L80 28 L44 45 Z" fill="#F7F3EE" />{[[30, 26], [48, 22], [60, 30], [40, 34], [55, 37]].map(([x, y], i) => <rect key={i} x={x} y={y} width="5" height="2.4" rx="1" fill={i % 2 ? '#E5484D' : '#fff'} transform={`rotate(${i * 30} ${x} ${y})`} />)}</svg>
)
const MugArt = () => (
  <div style={{ position: 'relative', width: 90, height: 90 }}>
    {[0, 1, 2].map(i => <span key={i} style={{ position: 'absolute', left: 28 + i * 12, top: 8, width: 6, height: 20, borderRadius: 6, background: 'rgba(160,190,210,.55)', animation: reduceMotion() ? undefined : `adSteam 2.4s ease-in-out ${i * .6}s infinite` }} />)}
    <svg width="90" height="90" viewBox="0 0 90 90" style={{ position: 'absolute', inset: 0 }} aria-hidden="true">
      <path d="M18 34 H66 V70 a10 10 0 0 1 -10 10 H28 a10 10 0 0 1 -10 -10 Z" fill="#1FA6B0" /><path d="M66 42 h6 a9 9 0 0 1 0 18 h-6" fill="none" stroke="#1FA6B0" strokeWidth="6" />
      <ellipse cx="42" cy="35" rx="24" ry="5" fill="#6B3B2A" /><circle cx="34" cy="33" r="5" fill="#fff" /><circle cx="44" cy="31" r="5" fill="#fff" /><circle cx="52" cy="34" r="4.5" fill="#fff" />
      <path d="M28 52 l4 4 4 -4 4 4 4 -4 4 4 4 -4" fill="none" stroke="#fff" strokeWidth="2" opacity=".85" />
    </svg>
  </div>
)

// ---------- the 25 days ----------
const DAYS = [
  { e: '🎬', t: 'Christmas Movie Trivia', i: 'Three questions about holiday movie favorites. How many can you get?', C: () => <Quiz items={[
    { q: "In 'Home Alone,' where are the McCallisters flying when they accidentally leave Kevin behind?", options: ['London', 'Paris', 'Rome', 'New York'], a: 1, note: 'They head to Paris — Kevin ends up "home alone" in Chicago.' },
    { q: "According to Buddy in 'Elf,' what's the best way to spread Christmas cheer?", options: ['Baking cookies', 'Decorating the tree', 'Singing loud for all to hear', 'Giving big hugs'], a: 2, note: '"The best way to spread Christmas cheer is singing loud for all to hear!"' },
    { q: "In 'How the Grinch Stole Christmas,' what is the name of the Grinch's loyal dog?", options: ['Max', 'Rudolph', 'Buddy', 'Scout'], a: 0, note: 'Max wears a single antler while pulling the Grinch\'s sleigh.' }]} /> },
  { e: '🎄', t: 'Holiday Would You Rather', i: 'No wrong answers here — just pick the one you like best!', C: () => <WouldYouRather /> },
  { e: '✨', t: 'Fun Christmas Facts', i: 'Three surprising bits of Christmas history.', C: () => <OneAtATime items={[
    ['🔔', '"Jingle Bells" was originally written for Thanksgiving, not Christmas! It was first published in 1857 under the title "One Horse Open Sleigh."'],
    ['🦌', 'Rudolph the Red-Nosed Reindeer was created in 1939 for a coloring book handed out by the Montgomery Ward department store.'],
    ['✨', 'Tinsel was first made in the 1600s in Germany from real, thin strands of silver.']]} next="Reveal the next fact" render={([e, f], i) => <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><span style={{ fontSize: 30 }}>{e}</span><div><b>Fact {i + 1}</b><div style={{ fontSize: 14.5, marginTop: 2 }}>{f}</div></div></div>} /> },
  { e: '🎵', t: 'Guess the Christmas Song', i: 'Each song is spelled out in emojis. Can you name that tune?', C: () => <Quiz emojiPrompt items={[
    { q: '⛄ 🎩 ✨ 🏃', options: ['Let It Snow', 'Frosty the Snowman', 'Winter Wonderland', 'Snowman Shuffle'], a: 1, note: '"Frosty the Snowman, was a jolly, happy soul…"' },
    { q: '🦌 🔴 👃', options: ['Rudolph the Red-Nosed Reindeer', 'Here Comes Santa Claus', 'Up on the Housetop', 'Sleigh Ride'], a: 0 },
    { q: '🔔 🔔 🐴 🛷', options: ['Silver Bells', 'Carol of the Bells', 'Jingle Bells', 'Jingle Bell Rock'], a: 2, note: '"Dashing through the snow, in a one-horse open sleigh…"' }]} /> },
  { e: '🍪', t: 'Holiday Recipe', i: 'A super easy holiday treat — no baking required!', C: () => <Recipe title="Peppermint Bark" serves="Makes about 24 pieces · 15 minutes + chilling" art={<BarkArt />}
    ingredients={['12 oz semi-sweet chocolate chips', '12 oz white chocolate chips', '½ tsp peppermint extract', '6 candy canes, crushed', 'Parchment paper']}
    steps={['Line a baking sheet with parchment paper.', 'Melt the semi-sweet chocolate in 30-second bursts in the microwave, stirring in between, and spread it in a thin layer on the paper.', 'Chill for about 15 minutes until firm.',
      'Melt the white chocolate the same way, stir in the peppermint extract, and spread it over the dark layer.', 'Sprinkle the crushed candy canes on top and press them in lightly.', 'Chill for 30 minutes, then break into pieces.']}
    tip="Put the candy canes in a zip-top bag and crush them with a rolling pin — it's very satisfying!" /> },
  { e: '🔎', t: 'Spot the Difference', i: 'Two snowy scenes that look the same… almost.', C: () => <SpotDifference /> },
  { e: '😂', t: 'A Little Holiday Humor', i: 'Groan-worthy Christmas jokes. Read the question, then reveal the punchline!', C: () => <RevealList label="Show the punchline" items={[
    { front: 'What do you call an elf who sings?', back: <b>A wrapper! 🎤</b> }, { front: 'Why did the Christmas tree go to the barber?', back: <b>It needed to be trimmed. ✂️</b> },
    { front: 'What do snowmen eat for breakfast?', back: <b>Frosted Flakes! ⛄</b> }, { front: 'How does a sheep say Merry Christmas?', back: <b>Fleece Navidad! 🐑</b> },
    { front: 'What do you get when you cross a snowman with a vampire?', back: <b>Frostbite. 🧛</b> }]} /> },
  { e: '🧩', t: 'Christmas Brain Teasers', i: 'Three holiday riddles. Think it over before you peek!', C: () => <RevealList label="Show the answer" items={[
    { front: "I'm tall when I'm young and short when I'm old, and I glow on cozy winter nights. What am I?", back: <b>A candle 🕯️</b> },
    { front: 'What falls all winter long but never gets hurt?', back: <b>Snow ❄️</b> },
    { front: 'What can travel all around the world on a holiday card while staying in the corner?', back: <b>A stamp 💌</b> }]} /> },
  { e: '🌎', t: 'Christmas Around the World', i: 'Three holiday traditions from around the globe.', C: () => <OneAtATime next="Visit the next country" items={[
    ['🇯🇵', 'Japan', 'Many families in Japan celebrate with a bucket of KFC! It started with a 1974 "Kentucky for Christmas" campaign, and people often order their Christmas chicken weeks ahead.'],
    ['🇮🇸', 'Iceland', 'Iceland has the "Jólabókaflóð" — the Christmas Book Flood. People give each other books on Christmas Eve and spend the night reading, often with hot chocolate.'],
    ['🇳🇴', 'Norway', 'On Christmas Eve, some Norwegians hide their brooms! Legend says witches and mischievous spirits come out that night looking for something to ride.']]}
    render={([f, c, txt]) => <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><span style={{ fontSize: 34 }}>{f}</span><div><b>{c}</b><div style={{ fontSize: 14.5, marginTop: 2 }}>{txt}</div></div></div>} /> },
  { e: '🎁', t: 'Mystery Christmas Gift', i: 'Read the clues, make your guess, then open the present!', C: () => <MysteryGift /> },
  { e: '🔤', t: 'Holiday Word Scramble', i: 'Unscramble these five Christmas words. Hints are there if you need them!', C: () => <Scramble /> },
  { e: '❄️', t: 'Winter Wonderland Surprise', i: 'Take a moment in a peaceful snowy scene.', C: () => <WinterWonderland /> },
  { e: '🎅', t: 'Christmas Emoji Challenge', i: 'Movies, songs and holiday phrases in emoji form. Guess, then reveal!', C: () => <RevealList label="Reveal" items={[
    { front: <span style={{ fontSize: 28 }}>🏠 👦 😱 🧳 ✈️</span>, back: <span><b>Home Alone</b> (movie)</span> }, { front: <span style={{ fontSize: 28 }}>🧝 🍝 🍬 🗽</span>, back: <span><b>Elf</b> (movie)</span> },
    { front: <span style={{ fontSize: 28 }}>🔔 🔔 🎸 🤘</span>, back: <span><b>Jingle Bell Rock</b> (song)</span> }, { front: <span style={{ fontSize: 28 }}>👀 👩 💋 🎅</span>, back: <span><b>I Saw Mommy Kissing Santa Claus</b> (song)</span> },
    { front: <span style={{ fontSize: 28 }}>🚂 ❄️ 🎅 🔔</span>, back: <span><b>The Polar Express</b> (movie)</span> }]} /> },
  { e: '🎄', t: 'Holiday Fun Facts', i: 'A few unexpected facts about our favorite traditions.', C: () => <OneAtATime next="Reveal the next fact" items={[
    ['🚀', 'The first song ever played in space was "Jingle Bells"! Astronauts on Gemini 6 played it on a tiny harmonica and bells in December 1965.'],
    ['✖️', 'The "X" in "Xmas" comes from the Greek letter chi (X), the first letter of the word for Christ in Greek. It\'s been used for centuries.'],
    ['🌲', 'The Rockefeller Center Christmas tree tradition began in 1931, when construction workers decorated a small tree at the building site.'],
    ['🌱', 'A typical farm-grown Christmas tree takes around 7 to 10 years to grow to its full height.']]}
    render={([e, f], i) => <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><span style={{ fontSize: 30 }}>{e}</span><div><b>Fact {i + 1}</b><div style={{ fontSize: 14.5, marginTop: 2 }}>{f}</div></div></div>} /> },
  { e: '🎁', t: 'Christmas Bingo', i: "A private bingo card of holiday moments. Mark what you've done!", C: Bingo },
  { e: '🎄', t: 'Decorate a Christmas Tree', i: 'Make it as fancy (or as wild) as you like!', C: DecorateTree },
  { e: '🦌', t: 'Guess the Christmas Character', i: 'Reveal the clues one at a time, then make your guess.', C: () => <Characters /> },
  { e: '🧩', t: 'Holiday Puzzle', i: 'A quick little picture puzzle.', C: () => <Puzzle /> },
  { e: '☃️', t: 'Build Your Snowman', i: 'Dress him up however you like — he saves automatically!', C: BuildSnowman },
  { e: '❄️', t: 'Shake the Snow Globe', i: 'Give it a shake and watch the snow swirl.', C: () => <SnowGlobe /> },
  { e: '😂', t: 'Christmas Mad Libs', i: 'Your words + our story = holiday nonsense.', C: () => <MadLibs /> },
  { e: '🎅', t: 'Christmas Joke Generator', i: 'One button, endless groans.', C: () => <JokeGenerator /> },
  { e: '☕', t: 'Cozy Christmas Surprise', i: 'Curl up with something warm.', C: () => <Recipe title="Peppermint Hot Chocolate" serves="Makes 2 mugs · 10 minutes" art={<MugArt />}
    ingredients={['2 cups milk (any kind)', '¼ cup cocoa powder', '3 tbsp sugar', '¼ cup chocolate chips', '¼ tsp peppermint extract', 'Pinch of salt', 'Whipped cream, marshmallows & crushed candy canes for topping']}
    steps={['Warm the milk in a small pot over medium-low heat until steaming (not boiling).', 'Whisk in the cocoa, sugar and salt until smooth.', 'Add the chocolate chips and whisk until melted.', 'Stir in the peppermint extract.', 'Pour into mugs and pile on the toppings!']}
    tip="Stir with a candy cane for extra peppermint — it melts right in." /> },
  { e: '✨', t: 'Christmas Eve Magic', i: 'A quiet, starry Christmas Eve.', C: () => <ChristmasEve /> },
  { e: '🎁', t: 'The Grand Christmas Surprise', i: 'Merry Christmas! Your very last present is here.', C: () => <GrandSurprise /> },
]
function WouldYouRather() {
  const qs = [
    ['Wear a jingle-bell hat every day in December', 'Only hear one Christmas song on repeat all month', ['Jingle all the way! 🔔', 'Hope you picked a good one! 🎶']],
    ['Build a snowman with Frosty', 'Take a sleigh ride with Santa', ['Frosty approves ⛄', "Hold on tight — Santa drives fast! 🛷"]],
    ['Eat only Christmas cookies for a whole day', 'Drink only hot cocoa for a whole day', ['Sweet choice 🍪', 'Extra marshmallows, please ☕']]]
  const [p, setP] = useState({})
  return qs.map(([a, b, r], i) => (
    <div key={i} className="ad-box">
      <div className="ad-q">Would you rather…</div>
      <div className="ad-opts">{[a, b].map((o, oi) => <button key={oi} className={'ad-opt' + (p[i] === oi ? ' picked' : '')} onClick={() => setP(s => ({ ...s, [i]: oi }))}>{o}</button>)}</div>
      {p[i] != null && <div className="ad-note" style={{ animation: 'adPop .3s ease' }}>{r[p[i]]}</div>}
    </div>
  ))
}
function Characters() {
  const chars = [
    { clues: ['I live in a cave on a mountain above a little town.', 'My heart was once "two sizes too small."', 'I tried to steal Christmas — but it came anyway!'], options: ['Scrooge', 'The Grinch', 'Jack Frost', 'The Nutcracker'], a: 1 },
    { clues: ["I'm known for one very shiny feature.", 'The other reindeer used to laugh and call me names.', 'One foggy Christmas Eve, I guided Santa\'s sleigh.'], options: ['Dasher', 'Rudolph', 'Olive', 'Blitzen'], a: 1 },
    { clues: ['I was visited by three ghosts in one night.', 'My famous words were "Bah! Humbug!"', 'I woke up on Christmas morning a changed man.'], options: ['Ebenezer Scrooge', 'Mr. Potter', 'The Grinch', 'Kris Kringle'], a: 0 }]
  const [n, setN] = useState({}), [p, setP] = useState({})
  return chars.map((c, i) => (
    <div key={i} className="ad-box">
      <div className="ad-q">Mystery character #{i + 1}</div>
      {c.clues.slice(0, n[i] || 1).map((cl, j) => <div key={j} style={{ animation: 'adPop .3s ease', marginBottom: 4, fontSize: 14.5 }}><b>Clue {j + 1}:</b> {cl}</div>)}
      {(n[i] || 1) < 3 && p[i] == null && <button className="ad-btn ghost" style={{ margin: '4px 0 8px' }} onClick={() => setN(s => ({ ...s, [i]: (s[i] || 1) + 1 }))}>Next clue</button>}
      <div className="ad-opts" style={{ marginTop: 6 }}>{c.options.map((o, oi) => <button key={oi} className={'ad-opt' + (p[i] != null ? (oi === c.a ? ' right' : oi === p[i] ? ' wrong' : '') : '')} disabled={p[i] != null} onClick={() => setP(s => ({ ...s, [i]: oi }))}>{o}</button>)}</div>
      {p[i] != null && <div className="ad-note"><b>{p[i] === c.a ? 'You got it! 🎉' : `It was ${c.options[c.a]}!`}</b></div>}
    </div>
  ))
}

// ---------- the calendar ----------
export default function Advent({ onClose, userId, canPreview }) {
  const today = adventToday()
  const [preview, setPreview] = useState(() => !!canPreview && ADVENT_TEST_UNLOCK)
  useEffect(() => { if (canPreview && ADVENT_TEST_UNLOCK) setPreview(true) }, [canPreview])
  const unlockedTo = preview ? 25 : today
  const cacheKey = `cc.advent2026.${userId || 'me'}.opened`
  const [opened, setOpened] = useState(() => lsGet(cacheKey, []))
  const [opening, setOpening] = useState(null)
  const [day, setDay] = useState(null)
  const still = reduceMotion()
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') { if (day) setDay(null); else onClose() } }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [day, onClose])
  useEffect(() => {
    if (!userId) return
    supabase.from('seasonal_prefs').select('key, enabled').eq('profile_id', userId).like('key', 'advent-2026-%').then(({ data }) => {
      if (!Array.isArray(data)) return
      const days = data.filter(r => r.enabled).map(r => Number(r.key.slice(-2))).filter(Boolean)
      setOpened(prev => { const all = [...new Set([...prev, ...days])]; lsSet(cacheKey, all); return all })
    })
  }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps
  const markOpened = (d) => {
    if (opened.includes(d)) return
    setOpened(prev => { const all = [...new Set([...prev, d])]; lsSet(cacheKey, all); return all })
    if (userId) supabase.from('seasonal_prefs').upsert({ profile_id: userId, key: KEY(d), enabled: true, updated_at: new Date().toISOString() }, { onConflict: 'profile_id,key' }).then(() => {})
  }
  const openDoor = (d) => {
    if (d > unlockedTo || opening) return
    if (opened.includes(d) || still) { markOpened(d); setDay(d); return }
    setOpening(d)
    setTimeout(() => { markOpened(d); setOpening(null); setDay(d) }, 820)
  }
  const D = day ? DAYS[day - 1] : null
  const footer = (today === 0 || preview)
    ? (preview ? <><span className="ad-script" style={{ fontSize: 24 }}>Preview</span><span style={{ width: 2, height: 30, background: '#9FC4D4' }} /><span className="ad-script" style={{ fontSize: 19 }}>Testing — every present is unlocked for admins</span></>
      : <><span className="ad-script" style={{ fontSize: 26 }}>Coming December 1</span><span style={{ width: 2, height: 30, background: '#9FC4D4' }} /><img src={ART + 'gift.webp'} alt="" width="34" height="34" /><span className="ad-script" style={{ fontSize: 20 }}>One present unlocks each day!</span></>)
    : <><span className="ad-script" style={{ fontSize: 30 }}>Day {today}</span><span style={{ width: 2, height: 32, background: '#9FC4D4' }} /><img src={ART + 'gift.webp'} alt="" width="36" height="36" />
      <span className="ad-script" style={{ fontSize: 21 }}>{opened.includes(today) ? (today === 25 ? 'Merry Christmas! 🎄' : 'Come back tomorrow for a new surprise!') : "Click today's door to reveal your surprise!"}</span></>
  return (
    <div className="ad-wrap" role="dialog" aria-modal="true" aria-label="25 Days of Christmas" onClick={onClose}>
      <style>{CSS}</style>
      <div className="ad-card" onClick={e => e.stopPropagation()}>
        <button className="ad-close" onClick={onClose} aria-label="Close">✕</button>
        <div style={{ position: 'relative', textAlign: 'center', padding: '20px 70px 8px', color: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18 }}>
            <Flake size={52} />
            <span className="ad-script" style={{ fontSize: 'clamp(30px, 5.2vw, 50px)', lineHeight: 1.1, textShadow: '0 3px 0 rgba(10,60,120,.35), 0 0 18px rgba(170,225,255,.7)' }}>{D ? `Day ${day}` : '25 Days of Christmas'}</span>
            <Flake size={52} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 2, fontWeight: 700, fontSize: 'clamp(13px, 1.8vw, 18px)', textShadow: '0 1px 6px rgba(0,40,90,.55)' }}>
            <span style={{ width: 90, height: 1.5, background: 'linear-gradient(90deg, transparent, #fff)' }} />{D ? `${D.e} ${D.t}` : 'A little holiday cheer each day!'}<span style={{ width: 90, height: 1.5, background: 'linear-gradient(90deg, #fff, transparent)' }} />
          </div>
        </div>
        {!D ? (
          <>
            <div className="ad-grid" style={{ overflowY: 'auto', minHeight: 0 }}>
              {Array.from({ length: 25 }, (_, i) => i + 1).map(d => {
                const locked = d > unlockedTo, isToday = !preview && d === today, isOpen = opened.includes(d)
                return (
                  <button key={d} className={'ad-door' + (locked ? ' locked' : '') + (isToday ? ' today' : '') + (isOpen ? ' opened' : '') + (opening === d ? ' opening' : '')}
                    onClick={() => openDoor(d)} aria-label={locked ? `Day ${d}, locked until December ${d}` : `Open day ${d}${isOpen ? ' (opened)' : ''}`} title={locked ? `Unlocks December ${d}` : DAYS[d - 1].t}>
                    <img className="ad-base" src={ART + 'adv_box.webp'} alt="" />
                    {isToday && <span className="ad-face" />}
                    <img className="ad-lid" src={ART + 'adv_box.webp'} alt="" />
                    <span className="ad-num">{d}{locked ? <Lock size={18} color={isToday ? '#fff' : '#5E7889'} /> : isOpen ? <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: .3 }}>✓ opened</span> : <span style={{ fontSize: 11, fontWeight: 700 }}>open me!</span>}</span>
                    {opening === d && <Sparkles />}
                  </button>
                )
              })}
            </div>
            <div className="ad-foot">{footer}</div>
            {canPreview && (today === 0 || ADVENT_TEST_UNLOCK) && (
              <label style={{ position: 'absolute', left: 22, top: 22, color: '#fff', fontSize: 12, fontWeight: 700, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', textShadow: '0 1px 4px rgba(0,30,60,.6)' }}>
                <input type="checkbox" checked={preview} onChange={e => setPreview(e.target.checked)} /> Admin preview
              </label>
            )}
          </>
        ) : (
          <div className="ad-panel">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 22px 4px', flexWrap: 'wrap' }}>
              <button className="ad-btn ghost" onClick={() => setDay(null)}>‹ All presents</button>
              <span className="ad-small" style={{ flex: 1, minWidth: 180 }}>{D.i}</span>
            </div>
            <div className="ad-panel-body"><D.C userId={userId} onClose={onClose} /></div>
          </div>
        )}
      </div>
    </div>
  )
}
