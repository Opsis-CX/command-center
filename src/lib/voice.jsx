// ============================================================
//  Browser calling (Twilio Voice JS SDK) — shared state for the whole app.
//
//  <VoiceProvider> wraps the signed-in app (admins only, see App.jsx).
//  Anywhere inside it:   const { call } = useVoice();  call('+15551234567', 'Jane Doe')
//
//  The SDK is loaded on first use from jsDelivr (pinned version), so nothing
//  needs to be added to package.json. Audio goes through the computer's
//  microphone + speakers/headset; the browser asks for mic permission once.
//
//  Server pieces (Supabase edge functions):
//    voice-token  — gives this browser a 1-hour Twilio token (admins only)
//    voice-twiml  — Twilio webhook: checks the caller, dials the number, logs to voice_calls
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
      s.onload = () => (window.Twilio?.Device ? resolve(window.Twilio) : reject(new Error('Twilio SDK failed to load')))
      s.onerror = () => { sdkPromise = null; reject(new Error('Could not load the calling library. Check your connection.')) }
      document.head.appendChild(s)
    })
  }
  return sdkPromise
}

async function fetchToken() {
  const { data, error } = await supabase.functions.invoke('voice-token', { body: {} })
  if (error) {
    // supabase-js wraps non-2xx; try to surface the function's own message
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

export function VoiceProvider({ children }) {
  const deviceRef = useRef(null)
  const callRef = useRef(null)
  const timerRef = useRef(null)
  // status: idle | connecting | ringing | in-call | ended | error
  const [state, setState] = useState({ status: 'idle', number: '', name: '', muted: false, seconds: 0, error: '' })
  const [open, setOpen] = useState(false)          // softphone panel visible

  const patch = useCallback(p => setState(s => ({ ...s, ...p })), [])

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

  const stopTimer = () => { clearInterval(timerRef.current); timerRef.current = null }

  const call = useCallback(async (number, name = '') => {
    const to = toE164(number)
    setOpen(true)
    if (!to) { patch({ status: 'error', error: 'Enter a 10-digit U.S. number.', number, name }); return }
    if (callRef.current) { patch({ error: 'Hang up the current call first.' }); return }
    patch({ status: 'connecting', number: to, name, muted: false, seconds: 0, error: '' })
    try {
      const device = await getDevice()
      const c = await device.connect({ params: { To: to } })
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

  // Back to the empty dial pad after a call ends.
  const reset = useCallback(() => {
    if (!callRef.current) patch({ status: 'idle', number: '', name: '', muted: false, seconds: 0, error: '' })
  }, [patch])

  // Tear down on sign-out / unmount.
  useEffect(() => () => { stopTimer(); try { deviceRef.current?.destroy() } catch { /* ignore */ } }, [])

  const value = { ...state, open, setOpen, call, hangUp, toggleMute, sendDigit, reset, busy: ['connecting', 'ringing', 'in-call'].includes(state.status) }
  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>
}

// Safe outside the provider too (non-admins): returns null, so callers can hide their call buttons.
export function useVoice() {
  return useContext(VoiceContext)
}
