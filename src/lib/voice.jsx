// ============================================================
//  Browser calling (Twilio Voice JS SDK) — shared state for the whole app.
//
//  <VoiceProvider> wraps the signed-in app for anyone allowed to call
//  (everyone except agents, clients, CSRs and trainees — see App.jsx).
//
//  Click-to-call a person (their number is NEVER sent to the browser):
//      const voice = useVoice()
//      voice?.callPerson(profileId, 'Jane Doe')
//  or just drop in   <CallButton profileId={id} name="Jane Doe" />
//
//  Typed numbers (dial pad) are admin-only:   voice.callNumber('+15551234567')
//
//  The SDK loads on first use from jsDelivr (pinned version) — nothing in package.json.
//  Server side: voice-token (who may call) + voice-twiml (looks up the number, dials, logs).
// ============================================================
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@twilio/voice-sdk@2.18.5/dist/twilio.min.js'

let sdkPromise = null
function loadSdk() {
  if (window.Twilio?.Device) return Promise.resolve(window.Twilio)
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = SDK_URL
      s.async = true
      s.onload = () => (window.Twilio?.Device ? resolve(window.Twilio) : reject(new Error('Calling library failed to load')))
      s.onerror = () => { sdkPromise = null; reject(new Error('Could not load the calling library. Check your connection.')) }
      document.head.appendChild(s)
    })
  }
  return sdkPromise
}

async function fetchToken() {
  const { data, error } = await supabase.functions.invoke('voice-token', { body: {} })
  if (error) {
    let msg = error.message
    try { const j = await error.context?.json?.(); if (j?.error) msg = j.error } catch { /* ignore */ }
    throw new Error(msg || 'Could not start calling.')
  }
  if (!data?.token) throw new Error(data?.error || 'Could not start calling.')
  return data.token
}

export function formatPhone(p) {
  const d = (p || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (p || '')
}
export function toE164(p) {
  const d = (p || '').replace(/\D/g, '')
  if (d.length === 10) return '+1' + d
  if (d.length === 11 && d.startsWith('1')) return '+' + d
  return null
}

const VoiceContext = createContext(null)

export function VoiceProvider({ children, canDialNumbers = false }) {
  const deviceRef = useRef(null)
  const callRef = useRef(null)
  const timerRef = useRef(null)
  // status: idle | connecting | ringing | in-call | ended | error
  // label: what the panel shows — the person's name, or the typed number (admin dial pad only)
  const [state, setState] = useState({ status: 'idle', label: '', muted: false, seconds: 0, error: '' })
  const [open, setOpen] = useState(false)

  const patch = useCallback(p => setState(s => ({ ...s, ...p })), [])
  const stopTimer = () => { clearInterval(timerRef.current); timerRef.current = null }

  const getDevice = useCallback(async () => {
    if (deviceRef.current) return deviceRef.current
    const Twilio = await loadSdk()
    const token = await fetchToken()
    const device = new Twilio.Device(token, { codecPreferences: ['opus', 'pcmu'], closeProtection: true, logLevel: 'error' })
    device.on('tokenWillExpire', async () => {
      try { device.updateToken(await fetchToken()) } catch (e) { console.warn('voice token refresh failed', e) }
    })
    device.on('error', err => patch({ status: 'error', error: err?.message || 'Calling error' }))
    deviceRef.current = device
    return device
  }, [patch])

  // Shared dialer: params go to Twilio -> voice-twiml (ProfileId or To).
  const start = useCallback(async (params, label) => {
    setOpen(true)
    if (callRef.current) { patch({ error: 'Hang up the current call first.' }); return }
    patch({ status: 'connecting', label, muted: false, seconds: 0, error: '' })
    try {
      const device = await getDevice()
      const c = await device.connect({ params })
      callRef.current = c
      c.on('ringing', () => patch({ status: 'ringing' }))
      c.on('accept', () => {
        patch({ status: 'in-call', seconds: 0 })
        stopTimer()
        timerRef.current = setInterval(() => setState(s => ({ ...s, seconds: s.seconds + 1 })), 1000)
      })
      const finish = (msg) => {
        stopTimer(); callRef.current = null
        patch({ status: msg ? 'error' : 'ended', error: msg || '', muted: false })
      }
      c.on('disconnect', () => finish())
      c.on('cancel', () => finish())
      c.on('reject', () => finish('Call was rejected.'))
      c.on('error', e => finish(e?.message || 'Call failed.'))
    } catch (e) {
      callRef.current = null
      const msg = /Permission|NotAllowed/i.test(e?.message || '') ? 'Microphone access is blocked. Allow the mic for this site and try again.' : (e?.message || 'Call failed.')
      patch({ status: 'error', error: msg })
    }
  }, [getDevice, patch])

  // Click-to-call a person. Only their id leaves the browser.
  const callPerson = useCallback((profileId, name) => {
    if (!profileId) return
    start({ ProfileId: profileId }, name || 'Team member')
  }, [start])

  // Typed number from the dial pad (admins only; the server enforces this too).
  const callNumber = useCallback((number) => {
    const to = toE164(number)
    setOpen(true)
    if (!canDialNumbers) { patch({ status: 'error', error: 'Only admins can dial a number directly.' }); return }
    if (!to) { patch({ status: 'error', error: 'Enter a 10-digit U.S. number.' }); return }
    start({ To: to }, formatPhone(to))
  }, [canDialNumbers, start, patch])

  const hangUp = useCallback(() => {
    if (callRef.current) callRef.current.disconnect()
    else deviceRef.current?.disconnectAll?.()
  }, [])

  const toggleMute = useCallback(() => {
    const c = callRef.current
    if (!c) return
    const next = !c.isMuted()
    c.mute(next)
    patch({ muted: next })
  }, [patch])

  const sendDigit = useCallback(d => { callRef.current?.sendDigits?.(d) }, [])

  const reset = useCallback(() => {
    if (!callRef.current) patch({ status: 'idle', label: '', muted: false, seconds: 0, error: '' })
  }, [patch])

  useEffect(() => () => { stopTimer(); try { deviceRef.current?.destroy() } catch { /* ignore */ } }, [])

  const value = {
    ...state, open, setOpen, canDialNumbers,
    callPerson, callNumber, hangUp, toggleMute, sendDigit, reset,
    busy: ['connecting', 'ringing', 'in-call'].includes(state.status),
  }
  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>
}

// Returns null outside the provider (agents, clients, CSRs) so call buttons hide themselves.
export function useVoice() {
  return useContext(VoiceContext)
}

// Drop-in click-to-call button. Renders nothing for people who can't place calls.
//   <CallButton profileId={p.id} name={p.full_name} />            compact phone icon
//   <CallButton profileId={p.id} name={p.full_name} label="Call" /> icon + text
//   hasPhone={false} shows it disabled with a "no phone on file" tooltip.
export function CallButton({ profileId, name, label, hasPhone = true, style }) {
  const voice = useVoice()
  if (!voice || !profileId) return null
  const disabled = !hasPhone || voice.busy
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); voice.callPerson(profileId, name) }}
      disabled={disabled}
      title={!hasPhone ? 'No phone number on file' : `Call ${name || ''}`.trim()}
      aria-label={`Call ${name || ''}`.trim()}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: label ? '5px 12px' : '5px 8px', borderRadius: 8, border: 'none',
        background: disabled ? 'rgba(100,116,139,0.25)' : '#16a34a', color: '#fff',
        fontWeight: 700, fontSize: 13, cursor: disabled ? 'not-allowed' : 'pointer', lineHeight: 1,
        ...style,
      }}
    >
      <span aria-hidden="true">📞</span>{label ? <span>{label}</span> : null}
    </button>
  )
}
