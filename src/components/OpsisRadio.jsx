import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useRadio, setRadio, parsePlaylistId, loadYT, useRadioConfig, refreshRadioConfig, readVol, saveVol } from '../lib/radio'

// ============================================================
// OPSIS RADIO (2026-11-27, Brittney)
//  • <RadioButton/>  the little radio in the top bar (AppHeader).
//  • <OpsisRadio/>   the player panel, mounted ONCE at the app level so music keeps playing between pages.
// Rules this follows:
//  - Never starts by itself: the YouTube player is only created when someone opens the panel and is cued, not playing.
//  - Minimize keeps the music going; Close (×) destroys the player, which stops it.
//  - Each person has their own playback and volume (their own browser; volume remembered per person on that device).
//  - YouTube's player, its controls and branding are left exactly as YouTube serves them, always visible, and never
//    smaller than 200×200 (that is YouTube's minimum, so "minimized" is a compact tile, not a hidden player).
//  - The playlist link + who sees the radio come from the radio_config table. Admins change them from the gear.
// ============================================================

const TEAL = '#1B8590'

export const RadioIcon = ({ size = 20, ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...p}>
    <line x1="7" y1="8.5" x2="16.5" y2="3.2" />
    <circle cx="17.2" cy="2.9" r="1.35" fill="#F4C542" stroke="#C99A12" strokeWidth="0.8" />
    <rect x="2.8" y="8.5" width="18.4" height="12" rx="3" />
    <circle cx="9" cy="14.5" r="3" />
    <path d="M7.6 13.4h2.8M7.4 14.5h3.2M7.6 15.6h2.8" strokeWidth="1.1" />
    <circle cx="16.6" cy="12.6" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="16.6" cy="16.4" r="1.1" fill="currentColor" stroke="none" />
  </svg>
)

function Eq() { return <span className="cc-radio-eq" aria-hidden="true"><i /><i /><i /></span> }

// ---- the button in the top bar ----
export function RadioButton() {
  const { user } = useAuth()
  const { allowed } = useRadioConfig(user?.id)
  const r = useRadio()
  if (!allowed) return null
  // closed → open (not playing yet) · open & big → minimize (music keeps going) · minimized → expand
  const click = () => { if (!r.open) setRadio({ open: true, min: false }); else setRadio({ min: !r.min }) }
  return (
    <>
      <style>{BTN_CSS}</style>
      <button type="button" className="hd-icon-btn cc-radio-btn" onClick={click} aria-pressed={r.open}
        aria-label="Opsis Radio" title={r.open ? (r.min ? 'Opsis Radio: open the player' : 'Opsis Radio: minimize (music keeps playing)') : 'Opsis Radio'}>
        <RadioIcon />
        {r.playing ? <Eq /> : null}
      </button>
    </>
  )
}

// ---- the player panel ----
export default function OpsisRadio() {
  const { user } = useAuth()
  const uid = user?.id
  const { ready, allowed, isAdmin, config } = useRadioConfig(uid)
  const r = useRadio()
  const playlistId = parsePlaylistId(config?.playlist_url)
  const hostRef = useRef(null), playerRef = useRef(null), volRef = useRef(50)
  const [vol, setVol] = useState(() => readVol(uid))
  const [err, setErr] = useState(null)
  const [showSet, setShowSet] = useState(false)
  const [top, setTop] = useState(118)
  volRef.current = vol

  // keep the panel just under the header
  useEffect(() => {
    if (!r.open) return
    const read = () => { const el = document.querySelector('.header-wrap'); const b = el && el.getBoundingClientRect().bottom; if (b && b > 40) setTop(Math.round(b) + 8) }
    read()
    const t = setInterval(read, 1000)
    window.addEventListener('resize', read)
    return () => { clearInterval(t); window.removeEventListener('resize', read) }
  }, [r.open])

  // if this person may not see the radio (any more), make sure it is closed
  useEffect(() => { if (ready && !allowed && r.open) setRadio({ open: false, min: false, playing: false }) }, [ready, allowed, r.open])
  useEffect(() => { setVol(readVol(uid)) }, [uid])

  // create the YouTube player only while the panel is open (cued, never autoplay); destroying it stops the music
  useEffect(() => {
    if (!r.open || !allowed || !playlistId) return
    let dead = false, player = null, poll = null
    setErr(null)
    loadYT().then(YT => {
      if (dead || !hostRef.current) return
      hostRef.current.innerHTML = ''
      const el = document.createElement('div')
      hostRef.current.appendChild(el)
      player = new YT.Player(el, {
        width: '100%', height: '100%',
        playerVars: { listType: 'playlist', list: playlistId, autoplay: 0, controls: 1, rel: 0, playsinline: 1, origin: window.location.origin },
        events: {
          onReady: (e) => {
            playerRef.current = e.target
            try { e.target.setVolume(volRef.current) } catch { /* ignore */ }
            // pick up changes made with YouTube's own volume control
            poll = setInterval(() => {
              try {
                const v = Math.round(e.target.getVolume())
                if (Number.isFinite(v) && v !== volRef.current) { setVol(v); saveVol(uid, v) }
              } catch { /* ignore */ }
            }, 2000)
          },
          onStateChange: (e) => setRadio({ playing: e.data === 1 }),
          onError: () => setErr('YouTube could not play this playlist. Check that the link is complete and that the playlist is Public or Unlisted.'),
        },
      })
    }).catch(() => { if (!dead) setErr('Could not reach YouTube right now.') })
    return () => {
      dead = true
      clearInterval(poll)
      try { player && player.destroy() } catch { /* ignore */ }
      playerRef.current = null
      setRadio({ playing: false })
    }
  }, [r.open, allowed, playlistId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!r.open || !allowed) return null

  const close = () => { setShowSet(false); setRadio({ open: false, min: false, playing: false }) }
  const onVol = (v) => { setVol(v); saveVol(uid, v); try { const p = playerRef.current; if (p) { if (v > 0 && p.isMuted && p.isMuted()) p.unMute(); p.setVolume(v) } } catch { /* ignore */ } }
  const min = r.min

  return (
    <>
      <style>{CSS}</style>
      <div className={'cc-radio' + (min ? ' is-min' : '')} role="dialog" aria-label="Opsis Radio" style={{ top }}>
        <div className="cc-radio-lights" aria-hidden="true" />
        <div className="cc-radio-head">
          <span className="cc-radio-badge"><RadioIcon size={18} /></span>
          <span className="cc-radio-title">Opsis Radio</span>
          {r.playing ? <Eq /> : null}
          <span style={{ flex: 1 }} />
          {isAdmin && !min && <button type="button" className="cc-radio-ib" onClick={() => setShowSet(s => !s)} aria-label="Radio settings" title="Radio settings (admins)" aria-pressed={showSet}>⚙</button>}
          <button type="button" className="cc-radio-ib" onClick={() => setRadio({ min: !min })} aria-label={min ? 'Expand the player' : 'Minimize the player (music keeps playing)'} title={min ? 'Expand' : 'Minimize (music keeps playing)'}>{min ? '▢' : '–'}</button>
          <button type="button" className="cc-radio-ib" onClick={close} aria-label="Close the radio (stops the music)" title="Close (stops the music)">×</button>
        </div>

        {playlistId ? (
          <>
            <div className="cc-radio-ytwrap" style={{ height: min ? 200 : 215 }}>
              <div ref={hostRef} className="cc-radio-yt" />
            </div>
            {err && <div className="cc-radio-err" role="alert">{err}</div>}
            <label className="cc-radio-vol">
              <span aria-hidden="true">{vol === 0 ? '🔇' : vol < 50 ? '🔉' : '🔊'}</span>
              <input type="range" min="0" max="100" value={vol} onChange={e => onVol(parseInt(e.target.value, 10))} aria-label="Your volume" />
              <span className="cc-radio-vn">{vol}</span>
            </label>
            {!min && <div className="cc-radio-note">Press play to start. Your volume is yours alone.</div>}
          </>
        ) : (
          <div className="cc-radio-empty">
            <b>No playlist yet</b>
            <span>{isAdmin ? 'Add a YouTube playlist with the ⚙ button above.' : 'An admin has not added a playlist yet.'}</span>
          </div>
        )}

        {isAdmin && showSet && !min && <Settings uid={uid} config={config} onDone={() => setShowSet(false)} />}
      </div>
    </>
  )
}

// ---- admin settings (playlist link + who can see the radio) ----
function Settings({ uid, config, onDone }) {
  const [url, setUrl] = useState(config?.playlist_url || '')
  const [vis, setVis] = useState(config?.visibility || 'owner')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const save = async () => {
    setMsg(null)
    const clean = url.trim()
    if (clean && !parsePlaylistId(clean)) { setMsg({ bad: true, t: 'That does not look like a YouTube playlist link. It should contain list=…' }); return }
    setBusy(true)
    const { data, error } = await supabase.from('radio_config')
      .update({ playlist_url: clean || null, visibility: vis, updated_at: new Date().toISOString(), updated_by: uid }).eq('id', 1).select()
    setBusy(false)
    if (error || !data || !data.length) { setMsg({ bad: true, t: 'Could not save. Only admins can change the radio settings.' }); return }
    await refreshRadioConfig(uid)
    setMsg({ t: 'Saved.' })
    setTimeout(onDone, 700)
  }
  return (
    <div className="cc-radio-set">
      <label>YouTube playlist link
        <input type="text" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://www.youtube.com/playlist?list=…" spellCheck={false} />
      </label>
      <div className="cc-radio-hint">The playlist must be Public or Unlisted. Changing it reloads the player.</div>
      <label>Who can see Opsis Radio
        <select value={vis} onChange={e => setVis(e.target.value)}>
          <option value="owner">Only me (testing)</option>
          <option value="team">The whole team</option>
        </select>
      </label>
      <div className="cc-radio-actions">
        <button type="button" className="cc-radio-save" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="cc-radio-cancel" onClick={onDone}>Cancel</button>
        {msg && <span className={'cc-radio-msg' + (msg.bad ? ' bad' : '')}>{msg.t}</span>}
      </div>
    </div>
  )
}

const BTN_CSS = `
.cc-radio-btn { color: ${TEAL}; }
body.cc-christmas .cc-radio-btn { color: #0F6F7C; }
.cc-radio-btn[aria-pressed="true"] { background: color-mix(in srgb, ${TEAL} 14%, transparent); }
.cc-radio-eq { display: inline-flex; align-items: flex-end; gap: 2px; height: 12px; }
.cc-radio-eq i { display: block; width: 3px; border-radius: 2px; background: ${TEAL}; animation: ccRadioEq 0.9s ease-in-out infinite; }
.cc-radio-eq i:nth-child(2) { animation-delay: .25s; } .cc-radio-eq i:nth-child(3) { animation-delay: .5s; }
.cc-radio-btn .cc-radio-eq { position: absolute; right: 3px; bottom: 4px; height: 9px; }
.cc-radio-btn .cc-radio-eq i { width: 2px; background: #E0463F; }
@keyframes ccRadioEq { 0%, 100% { height: 25%; } 50% { height: 100%; } }
@media (prefers-reduced-motion: reduce) { .cc-radio-eq i { animation: none; height: 70%; } }
`

const CSS = BTN_CSS + `
.cc-radio { position: fixed; right: 18px; z-index: 2300; width: 380px; max-width: calc(100vw - 24px); box-sizing: border-box; border-radius: 18px; overflow: hidden;
  background: var(--surface, #fff); color: var(--ink, #0F2B36); border: 1.5px solid color-mix(in srgb, ${TEAL} 45%, var(--line, #d7e3e8));
  box-shadow: 0 18px 40px -18px rgba(10, 60, 75, .55), 0 2px 6px rgba(10, 60, 75, .12); font-family: inherit; }
.cc-radio.is-min { width: 226px; }
.cc-radio-head { display: flex; align-items: center; gap: 8px; padding: 9px 8px 8px 12px; background: linear-gradient(180deg, color-mix(in srgb, ${TEAL} 14%, var(--surface, #fff)), var(--surface, #fff)); }
.cc-radio-badge { display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 9px; color: #fff; background: linear-gradient(180deg, #2BB3C2, ${TEAL}); box-shadow: inset 0 1px 0 rgba(255,255,255,.4); }
.cc-radio-title { font-weight: 800; font-size: 15px; letter-spacing: .2px; white-space: nowrap; }
.cc-radio.is-min .cc-radio-title { font-size: 14px; }
.cc-radio-ib { width: 28px; height: 28px; border: 0; border-radius: 8px; background: transparent; color: inherit; cursor: pointer; font-size: 17px; line-height: 1; display: inline-grid; place-items: center; }
.cc-radio-ib:hover, .cc-radio-ib[aria-pressed="true"] { background: color-mix(in srgb, ${TEAL} 14%, transparent); }
.cc-radio-ib:focus-visible, .cc-radio-btn:focus-visible { outline: 2px solid #15B8CF; outline-offset: 2px; }
.cc-radio-ytwrap { margin: 0 10px; background: #000; border-radius: 10px; overflow: hidden; }
.cc-radio-yt, .cc-radio-yt iframe { width: 100%; height: 100%; display: block; border: 0; }
.cc-radio-vol { display: flex; align-items: center; gap: 8px; padding: 9px 14px 4px; font-size: 14px; }
.cc-radio-vol input[type=range] { flex: 1; min-width: 0; accent-color: ${TEAL}; }
.cc-radio-vn { width: 24px; text-align: right; font-size: 12px; opacity: .7; font-variant-numeric: tabular-nums; }
.cc-radio-note { padding: 0 14px 11px; font-size: 11.5px; opacity: .65; }
.cc-radio.is-min .cc-radio-vol { padding-bottom: 10px; }
.cc-radio-err { margin: 8px 12px 0; padding: 7px 10px; border-radius: 8px; background: #FCEBDD; color: #8A3A12; font-size: 12.5px; }
.cc-radio-empty { display: grid; gap: 4px; padding: 16px 16px 18px; font-size: 13px; }
.cc-radio-empty span { opacity: .75; }
.cc-radio-set { display: grid; gap: 8px; padding: 10px 14px 14px; border-top: 1px solid var(--line, #d7e3e8); font-size: 12.5px; font-weight: 700; }
.cc-radio-set input, .cc-radio-set select { width: 100%; box-sizing: border-box; margin-top: 4px; padding: 7px 9px; border-radius: 8px; border: 1px solid var(--line, #c9d8de); background: var(--surface, #fff); color: inherit; font: inherit; font-weight: 500; }
.cc-radio-hint { font-weight: 500; font-size: 11.5px; opacity: .65; margin-top: -4px; }
.cc-radio-actions { display: flex; align-items: center; gap: 8px; }
.cc-radio-save { padding: 7px 16px; border: 0; border-radius: 9px; background: linear-gradient(180deg, #2BB3C2, ${TEAL}); color: #fff; font-weight: 800; cursor: pointer; }
.cc-radio-save:disabled { opacity: .6; cursor: default; }
.cc-radio-cancel { padding: 7px 12px; border: 0; background: transparent; color: inherit; font-weight: 600; cursor: pointer; opacity: .75; }
.cc-radio-msg { font-weight: 600; color: #1B7F4A; } .cc-radio-msg.bad { color: #A8441A; }
.cc-radio-lights { display: none; }
@media (max-width: 700px) { .cc-radio { right: 12px; left: 12px; width: auto; max-width: none; } .cc-radio.is-min { left: auto; width: 226px; } }

/* Christmas look: icy panel, a string of twinkling lights, script title, snow */
body.cc-christmas .cc-radio { background: linear-gradient(180deg, #F4FAFD, #E4F1F7); border: 2px solid #38A3B0;
  box-shadow: 0 20px 44px -18px rgba(14, 90, 110, .6), 0 0 0 3px rgba(255,255,255,.65) inset; }
body.cc-christmas .cc-radio-head { background: transparent; }
body.cc-christmas .cc-radio-title { font-family: 'Kaushan Script', 'Dancing Script', cursive; font-weight: 400; font-size: 20px; color: #0F6F7C; letter-spacing: .3px; }
body.cc-christmas .cc-radio.is-min .cc-radio-title { font-size: 17px; }
body.cc-christmas .cc-radio-badge { background: linear-gradient(180deg, #E0463F, #B3282A); box-shadow: inset 0 1px 0 rgba(255,255,255,.45), 0 2px 5px rgba(179,40,42,.35); }
body.cc-christmas .cc-radio-lights { display: block; height: 13px; margin-bottom: -2px;
  background:
    radial-gradient(circle at 12px 8px, #E0463F 0 3.4px, transparent 4px) 0 0 / 56px 13px,
    radial-gradient(circle at 26px 8px, #F4C542 0 3.4px, transparent 4px) 0 0 / 56px 13px,
    radial-gradient(circle at 40px 8px, #3FA7B5 0 3.4px, transparent 4px) 0 0 / 56px 13px,
    linear-gradient(#2E6B52, #2E6B52) 0 3px / 100% 1.5px no-repeat;
  animation: ccRadioTwinkle 2.4s ease-in-out infinite; }
@keyframes ccRadioTwinkle { 0%, 100% { opacity: 1; } 50% { opacity: .55; } }
body.cc-christmas .cc-radio-ytwrap { box-shadow: 0 0 0 2px #fff, 0 0 0 3.5px #9ED3DB; }
body.cc-christmas .cc-radio-save { background: linear-gradient(180deg, #E0463F, #B3282A); }
body.cc-christmas .cc-radio-vol input[type=range] { accent-color: #0F8A98; }
:root[data-theme="dark"] body.cc-christmas .cc-radio { background: linear-gradient(180deg, #16313A, #10252D); color: #E6F3F6; }
:root[data-theme="dark"] body.cc-christmas .cc-radio-title { color: #8EE0EA; }
@media (prefers-reduced-motion: reduce) { body.cc-christmas .cc-radio-lights { animation: none; } }
`
