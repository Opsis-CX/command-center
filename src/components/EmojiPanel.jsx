import React, { useState, useEffect, useRef, useMemo, useLayoutEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'

// ---- Custom emojis: one shared list for every picker, message and status (2026-10-29) ----
let _customEmojis = null
let _ceLoading = null
const _ceListeners = new Set()
export async function loadCustomEmojis(force = false) {
  if (_customEmojis && !force) return _customEmojis
  if (_ceLoading && !force) return _ceLoading
  _ceLoading = supabase.from('custom_emojis').select('id, shortcode, image_url, storage_path, created_by, created_at').order('shortcode')
    .then(({ data }) => {
      _customEmojis = data || []
      _ceLoading = null
      _ceListeners.forEach(fn => fn(_customEmojis))
      return _customEmojis
    })
  return _ceLoading
}
export function useCustomEmojis() {
  const [list, setList] = useState(_customEmojis || [])
  useEffect(() => {
    _ceListeners.add(setList)
    loadCustomEmojis().then(setList).catch(() => {})
    return () => { _ceListeners.delete(setList) }
  }, [])
  return list
}
// Warm everything up shortly after Chat opens, so the picker opens instantly.
export function preloadEmoji() {
  const go = () => { loadEmojiNames().catch(() => {}); loadCustomEmojis().catch(() => {}) }
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) window.requestIdleCallback(go, { timeout: 3000 }); else setTimeout(go, 800)
}
// A status emoji that may be a custom one (":party:") → shows the image.
export function StatusEmoji({ emoji, size = 15, style }) {
  const custom = useCustomEmojis()
  if (!emoji) return null
  if (CUSTOM_RE.test(emoji)) return <EmojiGlyph emoji={emoji} size={size} custom={custom} />
  return <span style={{ fontSize: size, lineHeight: 1.2, ...(style || {}) }}>{emoji}</span>
}
// Turn ":code:" in message text into inline custom-emoji images (text only, never inside tags).
export function withCustomEmojis(html, custom) {
  if (!html || !custom?.length || html.indexOf(':') < 0) return html
  const map = new Map(custom.map(c => [c.shortcode, c.image_url]))
  return String(html).split(/(<[^>]+>)/g).map(part => part.startsWith('<') ? part
    : part.replace(/:([a-z0-9_+-]{2,40}):/gi, (m, code) => { const u = map.get(code.toLowerCase()) || map.get(code); return u && /^https:\/\//.test(u) ? `<img src="${u}" alt=":${code}:" width="22" height="22">` : m })).join('')
}

// ---- Floating layer: every picker opens above the page, sized to fit any window ----
// Opens below the button if it fits, otherwise above; never off-screen; shrinks on small
// screens; scrolling inside it never closes it. Clicking outside or Escape closes it.
export function FloatingLayer({ anchor, onClose, children, width = 440, gap = 6, reserve = 0 }) {
  const ref = useRef(null)
  const [pos, setPos] = useState(null)
  const place = useCallback(() => {
    const a = anchor && (anchor.current || anchor)
    if (!a || !a.getBoundingClientRect) return
    const r = a.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight, m = 8
    const w = Math.min(width, vw - m * 2)
    const below = vh - r.bottom - gap - m, above = r.top - gap - m
    const down = below >= Math.min(420, above) // prefer below unless above has clearly more room
    // reserve = room for anything stacked with the panel (e.g. the quick-reaction bar)
    const maxH = Math.max(200, Math.min(560, (down ? below : above) - reserve))
    const left = Math.min(Math.max(m, r.left), vw - w - m)
    setPos(down ? { top: r.bottom + gap, left, width: w, maxH } : { bottom: vh - r.top + gap, left, width: w, maxH })
  }, [anchor, width, gap])
  useLayoutEffect(() => { place() }, [place])
  useEffect(() => {
    const onDown = (e) => { const a = anchor && (anchor.current || anchor); if (ref.current?.contains(e.target) || a?.contains?.(e.target)) return; onClose && onClose() }
    const onKey = (e) => { if (e.key === 'Escape') onClose && onClose() }
    const onMove = () => place()
    document.addEventListener('mousedown', onDown, true); document.addEventListener('touchstart', onDown, true); document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onMove); window.addEventListener('scroll', onMove, true)
    return () => { document.removeEventListener('mousedown', onDown, true); document.removeEventListener('touchstart', onDown, true); document.removeEventListener('keydown', onKey); window.removeEventListener('resize', onMove); window.removeEventListener('scroll', onMove, true) }
  }, [anchor, onClose, place])
  if (typeof document === 'undefined') return null
  return createPortal(
    <div ref={ref} data-up={pos && pos.bottom !== undefined ? '1' : undefined} style={{ position: 'fixed', zIndex: 3000, ...(pos ? { top: pos.top, bottom: pos.bottom, left: pos.left, width: pos.width } : { visibility: 'hidden', top: 0, left: 0 }), '--rp-max-h': pos ? pos.maxH + 'px' : '480px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {children}
    </div>, document.body)
}

// ============================================================
// Shared emoji pieces (2026-10-28): the emoji panel from Brittney's mockup, the reaction
// quick bar, animated emoji and emoji names. Used by Chat (reactions + message box) and the
// status picker, so every emoji picker in Command Center looks and works the same.
// ============================================================

export const CUSTOM_RE = /^:([a-z0-9_]{2,32}):$/
// Renders a reaction: a normal emoji as text, ":shortcode:" as its image.
// ---- Animated emoji (Google Noto Animated Emoji, free to use) — 2026-10-27, Brittney ----
// The animated file lives at fonts.gstatic.com/s/e/notoemoji/latest/<codepoints>/512.webp.
// Not every emoji has one, so we try the likely file names and fall back to the normal
// emoji if none loads. Results are remembered so a missing one is only tried once.
const NOTO_BASE = 'https://fonts.gstatic.com/s/e/notoemoji/latest/'
const _notoOk = new Map()   // emoji -> working url | false
function notoCandidates(emoji) {
  const cps = Array.from(emoji || '').map(ch => ch.codePointAt(0).toString(16))
  if (!cps.length) return []
  const full = cps.join('_')
  const noVs = cps.filter(c => c !== 'fe0f').join('_')
  return [...new Set([full, noVs].filter(Boolean))].map(k => `${NOTO_BASE}${k}/512.webp`)
}
export function AnimatedEmoji({ emoji, size = 20 }) {
  const known = _notoOk.get(emoji)
  const cands = useMemo(() => known ? [known] : notoCandidates(emoji), [emoji, known])
  const [i, setI] = useState(0)
  if (known === false || i >= cands.length) return <span className="chat-emoji" style={{ fontSize: size - 2 }}>{emoji}</span>
  return (
    <img src={cands[i]} alt={emoji} width={size} height={size} draggable={false}
      onLoad={() => _notoOk.set(emoji, cands[i])}
      onError={() => { if (i + 1 >= cands.length) _notoOk.set(emoji, false); setI(i + 1) }}
      style={{ width: size, height: size, verticalAlign: 'middle', objectFit: 'contain' }} />
  )
}
// A message that is only 1–3 emoji shows them big and animated (like Teams).

export function EmojiGlyph({ emoji, size = 16, custom, animate = false }) {
  const m = CUSTOM_RE.exec(emoji || '')
  const c = m && custom.find(x => x.shortcode === m[1])
  if (c) return <img src={c.image_url} alt={emoji} title={emoji} style={{ width: size, height: size, objectFit: 'contain', verticalAlign: 'middle' }} />
  if (animate) return <AnimatedEmoji emoji={emoji} size={size} />
  return <span className="chat-emoji" style={{ fontSize: size - 2 }}>{emoji}</span>
}

let _emojiNames = null
export const emojiNamesNow = () => _emojiNames
let _emojiNamesLoading = null
export function loadEmojiNames() {
  if (_emojiNames) return Promise.resolve(_emojiNames)
  if (!_emojiNamesLoading) _emojiNamesLoading = import('../lib/emojiNames').then(m => (_emojiNames = m.default))
  return _emojiNamesLoading
}
// ":thumbs_up:" style label, Slack-like. Custom emoji are already ":name:".
export function emojiLabel(emoji) {
  if (CUSTOM_RE.test(emoji || '')) return emoji
  if (!_emojiNames) return null
  const key = (emoji || '').replace(/\uFE0F/g, '')
  const base = key.replace(/[\u{1F3FB}-\u{1F3FF}]/gu, '')
  const name = _emojiNames[key] || _emojiNames[base]
  return name ? `:${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}:` : null
}


// ============================================================
// REACTION PICKER (2026-10-27, Brittney's mockup)
// Compact quick bar (6 favourites + a smiley+ button) that opens a "Choose a reaction"
// panel: search, category tabs, tile grid, an Animated section, Custom emojis, and a
// footer with the hovered emoji's name + "Add custom emoji". Emoji data and names come
// from src/lib/emojiNames.js (Unicode order), loaded when the panel opens.
// ============================================================
const QUICK_REACTIONS = ['👍', '❤️', '😂', '🙏', '😍', '💙']
const RECENT_KEY = 'cc.emoji.recent'
const DEFAULT_RECENT = ['❤️', '🥺', '👍', '👀', '😂', '🔥', '🙏', '💚', '✨', '💯', '🥰', '😎', '🎉', '😊']
// Popular emoji that have Google's animated versions (any without one just show normally).
const ANIMATED_SET = ['😀', '😂', '🤣', '😊', '😍', '🥰', '😘', '😎', '🤩', '🥳', '😇', '🤗', '🤔', '🫡', '🙄', '😴', '🤯', '😱', '😭', '🥺',
  '😤', '😡', '🤬', '🤡', '👻', '💀', '💩', '🤖', '👀', '👋', '👍', '👎', '👏', '🙌', '🫶', '🙏', '💪', '✌️', '🤞', '🫰',
  '❤️', '🧡', '💛', '💚', '💙', '💜', '💔', '❤️‍🔥', '💯', '🔥', '✨', '🎉', '🎊', '🎂', '🎁', '⭐', '🌈', '⚡', '🚀', '🪼']
// first emoji of each Unicode group, in emojiNames.js order
const EMOJI_GROUPS = [
  ['smileys', 'Smileys', '😀'], ['people', 'People', '👋'], ['animals', 'Animals', '🐵'], ['food', 'Food', '🍇'],
  ['travel', 'Travel', '🌍'], ['activities', 'Activities', '🎃'], ['objects', 'Objects', '👓'], ['symbols', 'Symbols', '🏧'], ['flags', 'Flags', '🏁'],
]
// Names drop U+FE0F; put it back after single-width characters so they draw as emoji (❤ → ❤️, #⃣ → #️⃣).
function withVS(e) {
  let out = ''
  for (const ch of Array.from(e)) {
    out += ch
    const cp = ch.codePointAt(0)
    if (cp < 0x10000 && cp !== 0x200D && cp !== 0xFE0F && cp !== 0x20E3) out += '\uFE0F'
  }
  return out
}
function readRecent() {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); if (Array.isArray(v) && v.length) return v } catch { /* ignore */ }
  return DEFAULT_RECENT
}
function pushRecent(e) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([e, ...readRecent().filter(x => x !== e)].slice(0, 28))) } catch { /* ignore */ }
}
const RP_ICON = {
  recent: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  animated: 'M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4zM19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8zM5 15l.6 1.4 1.4.6-1.4.6L5 19l-.6-1.4L3 17l1.4-.6z',
  smileys: 'M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  people: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  animals: 'M5 11c-1.5-1-2-3-1-5 2 0 3.5 1 4 2.5M19 11c1.5-1 2-3 1-5-2 0-3.5 1-4 2.5M12 21c-4 0-7-2.5-7-6.5S8 8 12 8s7 2.5 7 6.5S16 21 12 21zM10 14h.01M14 14h.01',
  food: 'M3 11h18M5 11a7 7 0 0 1 14 0M4 15h16M5 15v1a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-1',
  travel: 'M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z',
  activities: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 3v18M3 12h18M5.6 5.6c3.5 3.5 3.5 9.3 0 12.8M18.4 5.6c-3.5 3.5-3.5 9.3 0 12.8',
  objects: 'M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z',
  symbols: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z',
  flags: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7',
  custom: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  close: 'M18 6L6 18M6 6l12 12',
  smileplus: 'M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01M20 12.5A8.5 8.5 0 1 1 11.5 4M19 2v6M16 5h6',
}
const RpIcon = ({ d, size = 18 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
const RP_CSS = `
.rp-quick { display: inline-flex; align-items: center; gap: 2px; padding: 5px; background: var(--surface); border: 1px solid var(--line); border-radius: 16px; box-shadow: 0 8px 24px rgba(0,0,0,.12); }
.rp-q { width: 40px; height: 40px; border: 0; border-radius: 12px; background: transparent; cursor: pointer; display: grid; place-items: center; transition: transform .12s, background .12s; }
.rp-q:hover, .rp-q:focus-visible { background: var(--accent-bg); transform: scale(1.12); outline: none; }
.rp-q.more { color: var(--accent); background: var(--accent-bg); margin-left: 4px; }
.rp-panel { width: 100%; max-width: calc(100vw - 16px); height: min(480px, var(--rp-max-h, 70vh)); max-height: var(--rp-max-h, 70vh); min-height: 220px; display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--line); border-radius: 18px; box-shadow: 0 18px 44px rgba(0,0,0,.18); overflow: hidden; margin-top: 8px; }
.rp-head { display: flex; align-items: center; padding: 16px 18px 10px; }
.rp-head h3 { margin: 0; font-size: 17px; font-weight: 700; flex: 1; }
.rp-x { border: 0; background: transparent; cursor: pointer; color: var(--ink-soft); width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; }
.rp-x:hover { background: var(--canvas); }
.rp-search { margin: 0 18px; display: flex; align-items: center; gap: 8px; border: 1px solid var(--line); border-radius: 12px; padding: 0 12px; color: var(--ink-soft); }
.rp-search:focus-within { border-color: var(--accent); }
.rp-search input { flex: 1; border: 0; outline: none; background: transparent; padding: 10px 0; font: inherit; font-size: 14px; color: var(--ink); }
.rp-tabs { display: flex; gap: 2px; padding: 10px 14px 6px; overflow-x: auto; scrollbar-width: none; border-bottom: 1px solid var(--line-soft, var(--line)); }
.rp-tabs::-webkit-scrollbar { display: none; }
.rp-tab { flex: none; border: 0; background: transparent; cursor: pointer; border-radius: 10px; padding: 6px 8px; display: flex; flex-direction: column; align-items: center; gap: 3px; color: var(--ink-soft); font: inherit; font-size: 11px; min-width: 56px; }
.rp-tab:hover { background: var(--canvas); color: var(--ink); }
.rp-tab.on { background: var(--accent-bg); color: var(--accent); font-weight: 600; }
.rp-body { flex: 1; overflow-y: auto; padding: 4px 18px 10px; position: relative; }
.rp-sec-h { display: flex; align-items: baseline; justify-content: space-between; margin: 12px 0 8px; }
.rp-sec-h b { font-size: 14px; }
.rp-more { border: 0; background: transparent; color: var(--accent); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.rp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(42px, 1fr)); gap: 6px; }
.rp-gifs { columns: 2 150px; column-gap: 8px; }
.rp-wrap { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
[data-up] .rp-wrap { flex-direction: column-reverse; }
.rp-wrap > .rp-panel { margin-top: 0; }
.rp-gif { display: block; width: 100%; margin: 0 0 8px; border: 0; padding: 0; border-radius: 8px; overflow: hidden; cursor: pointer; background: var(--canvas); break-inside: avoid; }
.rp-gif img { display: block; width: 100%; height: auto; }
.rp-gif:hover { outline: 2px solid var(--accent); }
.rp-tile { aspect-ratio: 1; border: 1px solid var(--line-soft, var(--line)); background: var(--canvas); border-radius: 12px; cursor: pointer; display: grid; place-items: center; padding: 0; transition: transform .1s, border-color .1s, background .1s; }
/* the emoji picture inside a tile swaps to its animated version on hover — make it ignore the mouse
   so a click always lands on the button, even mid-swap */
.rp-tile > *, .rp-q > * { pointer-events: none; }
.rp-tile:hover, .rp-tile:focus-visible { border-color: var(--accent); background: var(--accent-bg); transform: scale(1.06); outline: none; }
.rp-foot { display: flex; align-items: center; gap: 8px; padding: 10px 18px; border-top: 1px solid var(--line-soft, var(--line)); min-height: 44px; }
.rp-foot .name { flex: 1; min-width: 0; font-size: 12.5px; color: var(--ink-soft); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rp-add { border: 0; background: transparent; color: var(--accent); font: inherit; font-size: 13.5px; font-weight: 600; cursor: pointer; white-space: nowrap; }
`
// The full emoji panel (search, tabs, Frequently Used, Animated, Custom, all groups, footer).
// Used for reactions, the message box and the status picker. (2026-10-28)
// One emoji button — only redraws when IT changes (hovering used to redraw ~1,900 buttons).
const Tile = React.memo(function Tile({ e, label, custom, animate, onPick, onHover }) {
  return (
    <button className="rp-tile" onClick={() => onPick(e)} aria-label={label} title={label}
      onMouseEnter={() => onHover(e)} onFocus={() => onHover(e)}>
      <EmojiGlyph emoji={e} size={28} custom={custom} animate={animate} />
    </button>
  )
})

// GIF search (GIPHY via the gif-search server function; the key never reaches the browser).
function GifPane({ onPickGif, autoFocus }) {
  const [q, setQ] = useState('')
  const [state, setState] = useState({ loading: true, results: [], error: null })
  useEffect(() => {
    let alive = true
    setState(st => ({ ...st, loading: true }))
    const t = setTimeout(async () => {
      try {
        const { data, error } = await supabase.functions.invoke('gif-search', { body: { q } })
        if (!alive) return
        if (error) throw error
        setState({ loading: false, results: data?.results || [], error: data?.error || null })
      } catch (e) { if (alive) setState({ loading: false, results: [], error: 'failed' }) }
    }, q ? 300 : 0)
    return () => { alive = false; clearTimeout(t) }
  }, [q])
  return (
    <>
      <label className="rp-search"><RpIcon d={RP_ICON.search} size={16} /><input autoFocus={autoFocus} value={q} onChange={e => setQ(e.target.value)} placeholder="Search GIFs…" aria-label="Search GIFs" /></label>
      <div className="rp-body" style={{ paddingTop: 8 }}>
        {state.error === 'not_configured' ? (
          <p className="page-sub" style={{ padding: 12, lineHeight: 1.5 }}>GIFs aren't set up yet. An admin needs to add a free GIPHY key — once it's in, GIFs appear here.</p>
        ) : state.error ? (
          <p className="page-sub" style={{ padding: 12 }}>Couldn't load GIFs right now. Try again in a moment.</p>
        ) : state.loading && !state.results.length ? (
          <p className="page-sub" style={{ padding: 12 }}>Loading GIFs…</p>
        ) : !state.results.length ? (
          <p className="page-sub" style={{ padding: 12 }}>No GIFs found.</p>
        ) : (
          <div className="rp-gifs">
            {state.results.map(g => (
              <button key={g.id} className="rp-gif" onClick={() => onPickGif(g)} title={g.title} aria-label={g.title}>
                <img src={g.preview} alt={g.title} loading="lazy" />
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="rp-foot"><span className="name">Powered by GIPHY</span></div>
    </>
  )
}

export function EmojiPanel({ custom: customProp, title = 'Choose an emoji', onPick, onClose, onAddCustom, style, autoFocusSearch = true, onPickGif }) {
  const sharedCustom = useCustomEmojis()
  const custom = customProp && customProp.length ? customProp : sharedCustom   // custom emojis in EVERY picker
  const [mode, setMode] = useState('emoji')
  const [names, setNames] = useState(_emojiNames)
  const [q, setQ] = useState('')
  const [tab, setTab] = useState('recent')
  const [hover, setHover] = useState(null)
  const [more, setMore] = useState({})
  const bodyRef = useRef(null)
  const recent = useMemo(() => readRecent(), [])
  useEffect(() => { if (!names) loadEmojiNames().then(setNames).catch(() => {}) }, [names])
  useEffect(() => { const k = (ev) => { if (ev.key === 'Escape') onClose && onClose() }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [onClose])
  const pick = useCallback((e) => { if (!CUSTOM_RE.test(e)) pushRecent(e); onPick(e) }, [onPick])
  const onHover = useCallback((e) => setHover({ e }), [])
  const labelCache = useMemo(() => new Map(), [names])   // each name worked out once, not on every hover
  const label = (e) => {
    let v = labelCache.get(e)
    if (v !== undefined) return v
    if (CUSTOM_RE.test(e)) v = e
    else {
      const n = names && (names[e.replace(/\uFE0F/g, '')] || names[e.replace(/\uFE0F/g, '').replace(/[\u{1F3FB}-\u{1F3FF}]/gu, '')])
      v = n ? `:${n.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}:` : e
    }
    labelCache.set(e, v)
    return v
  }
  const groups = useMemo(() => {
    if (!names) return []
    const out = EMOJI_GROUPS.map(([key, t]) => ({ key, title: t, list: [] }))
    let gi = 0
    for (const raw of Object.keys(names)) {
      if (gi + 1 < EMOJI_GROUPS.length && raw === EMOJI_GROUPS[gi + 1][2]) gi++
      out[gi].list.push(withVS(raw))
    }
    return out
  }, [names])
  const results = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return null
    const cust = custom.filter(c => c.shortcode.includes(t.replace(/:/g, ''))).map(c => `:${c.shortcode}:`)
    const nat = names ? Object.entries(names).filter(([, n]) => n.toLowerCase().includes(t)).slice(0, 140).map(([k]) => withVS(k)) : []
    return [...cust, ...nat]
  }, [q, names, custom])
  const sections = [
    { key: 'recent', title: 'Frequently Used', list: recent, limit: 14 },
    { key: 'animated', title: 'Animated', list: ANIMATED_SET, animate: true, limit: 21 },
    ...(custom.length ? [{ key: 'custom', title: 'Custom Emojis', list: custom.map(c => `:${c.shortcode}:`), limit: 14 }] : []),
    ...groups,
  ]
  const tabs = [['recent', 'Recent'], ['animated', 'Animated'], ...(custom.length ? [['custom', 'Custom']] : []), ...EMOJI_GROUPS.map(([k, t]) => [k, t])]
  // Draw a few sections right away and the rest a moment later, so the panel opens instantly.
  const [shown, setShown] = useState(4)
  useEffect(() => {
    if (!names || shown >= sections.length) return
    const id = requestAnimationFrame(() => setShown(n => n + 2))
    return () => cancelAnimationFrame(id)
  }, [names, shown, sections.length])
  const goTab = (k) => {
    setTab(k); setQ('')
    const idx = sections.findIndex(sec => sec.key === k)
    if (idx >= shown) setShown(idx + 2)
    requestAnimationFrame(() => { const el = bodyRef.current?.querySelector(`[data-sec="${k}"]`); if (el) bodyRef.current.scrollTo({ top: el.offsetTop - 4, behavior: 'smooth' }) })
  }
  const onScroll = () => {
    const b = bodyRef.current; if (!b || q) return
    let cur = 'recent'
    b.querySelectorAll('[data-sec]').forEach(el => { if (el.offsetTop - 24 <= b.scrollTop) cur = el.dataset.sec })
    if (cur !== tab) setTab(cur)
  }
  const tile = (e, i, animate) => (
    <Tile key={e + i} e={e} label={label(e)} custom={custom} animate={!!animate || hover?.e === e} onPick={pick} onHover={onHover} />
  )
  return (
    <div className="rp-panel" role="dialog" aria-label={title} style={style}>
      <style>{RP_CSS}</style>
      <div className="rp-head"><h3>{mode === 'gif' ? 'Send a GIF' : title}</h3>
        {onPickGif && (
          <div style={{ display: 'inline-flex', background: 'var(--canvas)', borderRadius: 9, padding: 3, marginRight: 6 }}>
            {[['emoji', 'Emoji'], ['gif', 'GIF']].map(([k, t]) => (
              <button key={k} onClick={() => setMode(k)} style={{ border: 0, borderRadius: 7, padding: '4px 11px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                background: mode === k ? 'var(--surface)' : 'transparent', color: mode === k ? 'var(--ink)' : 'var(--ink-soft)', boxShadow: mode === k ? '0 1px 3px rgba(0,0,0,.1)' : 'none' }}>{t}</button>
            ))}
          </div>
        )}
        {onClose && <button className="rp-x" onClick={onClose} aria-label="Close"><RpIcon d={RP_ICON.close} /></button>}</div>
      {mode === 'gif' ? <GifPane onPickGif={onPickGif} autoFocus /> : <>
      <label className="rp-search"><RpIcon d={RP_ICON.search} size={16} /><input autoFocus={autoFocusSearch} value={q} onChange={e => setQ(e.target.value)} placeholder="Search emojis…" aria-label="Search emojis" /></label>
      {!q && (
        <div className="rp-tabs" role="tablist">
          {tabs.map(([k, t]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={'rp-tab' + (tab === k ? ' on' : '')} onClick={() => goTab(k)}>
              <RpIcon d={RP_ICON[k]} size={19} />{t}
            </button>
          ))}
        </div>
      )}
      <div className="rp-body" ref={bodyRef} onScroll={onScroll}>
        {results ? (
          <>
            <div className="rp-sec-h"><b>{results.length ? 'Results' : 'No matches'}</b></div>
            <div className="rp-grid">{results.map((e, i) => tile(e, i))}</div>
          </>
        ) : !names ? <p className="page-sub" style={{ padding: 12 }}>Loading emoji…</p> : sections.slice(0, shown).map(sec => {
          const showAll = !sec.limit || more[sec.key] || sec.list.length <= sec.limit
          const list = showAll ? sec.list : sec.list.slice(0, sec.limit)
          return (
            <div key={sec.key} data-sec={sec.key}>
              <div className="rp-sec-h"><b>{sec.title}</b>
                {sec.limit && sec.list.length > sec.limit && <button className="rp-more" onClick={() => setMore(m => ({ ...m, [sec.key]: !m[sec.key] }))}>{more[sec.key] ? 'See less' : 'See more'}</button>}
              </div>
              <div className="rp-grid">{list.map((e, i) => tile(e, i, sec.animate))}</div>
            </div>
          )
        })}
      </div>
      <div className="rp-foot">
        {hover ? <><EmojiGlyph emoji={hover.e} size={24} custom={custom} animate /><span className="name">{label(hover.e)}</span></>
          : <><RpIcon d={RP_ICON.smileys} size={20} /><span className="name">Hover over an emoji to see its name</span></>}
        {onAddCustom && <button className="rp-add" onClick={onAddCustom}>＋ Add custom emoji</button>}
      </div>
      </>}
    </div>
  )
}

// Reactions: the quick bar (6 favourites + smiley+) that opens the panel.
export function ReactionPicker({ custom, onPick, onClose, onAddCustom }) {
  const [full, setFull] = useState(false)
  const pick = (e) => { if (!CUSTOM_RE.test(e)) pushRecent(e); onPick(e) }
  useEffect(() => { const k = (ev) => { if (ev.key === 'Escape' && !full) onClose() }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [onClose, full])
  return (
    <div className="rp-wrap">
      <style>{RP_CSS}</style>
      <div className="rp-quick" role="toolbar" aria-label="Quick reactions">
        {QUICK_REACTIONS.map(e => (
          <button key={e} className="rp-q" onClick={() => pick(e)} aria-label={emojiLabel(e) || e} title={emojiLabel(e) || e}><EmojiGlyph emoji={e} size={26} custom={custom} /></button>
        ))}
        <button className="rp-q more" onClick={() => setFull(f => !f)} aria-label="All emoji" aria-expanded={full} title="All emoji"><RpIcon d={RP_ICON.smileplus} size={22} /></button>
      </div>
      {full && <EmojiPanel custom={custom} title="Choose a reaction" onPick={onPick} onClose={onClose} onAddCustom={onAddCustom} />}
    </div>
  )
}

