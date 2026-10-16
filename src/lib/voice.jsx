// ============================================================
//  Browser calling (Twilio Voice JS SDK) — shared state for the whole app.
//
//  <VoiceProvider> wraps the signed-in app (see App.jsx).
//
//  Click-to-call a person (their number is NEVER sent to the browser):
//      const voice = useVoice()
//      voice?.callPerson(profileId, 'Jane Doe')
//  or just drop in   <CallButton profileId={id} name="Jane Doe" />
//
//  Typed numbers (dial pad) are admin-only:   voice.callNumber('+15551234567')
//  Dialer (agents + managers on a campaign):  voice.callQueue(queueId, 'Customer name')
//
//  INBOUND: people on an inbound line (inbound_queue_members) get a
//  "Ready for inbound calls" switch (voice.inbound.setReady). While it's on, this
//  browser is registered with Twilio and rings when voice-inbound routes a caller
//  here. The ringing panel shows the caller's name + menu choice, never the number.
//
//  The SDK loads on first use from jsDelivr (pinned version) — nothing in package.json.
//  Server side: voice-token (who may call) + voice-twiml (outbound) + voice-inbound (inbound).
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

// canCallPeople: click-to-call team members (everyone except agents).
// canDialNumbers: type any number on the dial pad (admins).
// Everyone inside the provider can work dialer campaigns they're assigned to (callQueue).
export function VoiceProvider({ children, canDialNumbers = false, canCallPeople = true }) {
  const deviceRef = useRef(null)
  const callRef = useRef(null)
  const incomingRef = useRef(null)
  const timerRef = useRef(null)
  // status: idle | incoming | connecting | ringing | in-call | ended | error
  // label: the person's name (or the typed number on the admin dial pad); sub: e.g. "Inbound · New business"
  const [state, setState] = useState({ status: 'idle', label: '', sub: '', muted: false, seconds: 0, error: '' })
  const [open, setOpen] = useState(false)
  const [inbound, setInbound] = useState({ member: false, ready: false, registered: false, queues: [], manager: false, busy: false })

  const patch = useCallback(p => setState(s => ({ ...s, ...p })), [])
  const patchIn = useCallback(p => setInbound(s => ({ ...s, ...p })), [])
  const stopTimer = () => { clearInterval(timerRef.current); timerRef.current = null }

  // Wire up events for an outgoing OR accepted incoming call.
  const wire = useCallback((c) => {
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
  }, [patch])

  const handleIncoming = useCallback((call) => {
    // Already on a call (or already ringing): decline this one so it rolls to the next person / the AI.
    if (callRef.current || incomingRef.current) { try { call.reject() } catch { /* ignore */ } return }
    const p = call.customParameters || new Map()
    incomingRef.current = call
    patch({
      status: 'incoming', error: '', muted: false, seconds: 0,
      label: p.get('callerName') || 'Caller',
      sub: ['Inbound', p.get('queueLabel')].filter(Boolean).join(' · '),
    })
    setOpen(true)
    const clear = () => {
      if (incomingRef.current !== call) return
      incomingRef.current = null
      setState(s => (s.status === 'incoming' ? { ...s, status: 'idle', label: '', sub: '' } : s))
    }
    call.on('cancel', clear)   // caller hung up, or a teammate answered first
    call.on('reject', clear)
    call.on('disconnect', clear)
  }, [patch])

  const getDevice = useCallback(async () => {
    if (deviceRef.current) return deviceRef.current
    const Twilio = await loadSdk()
    const token = await fetchToken()
    const device = new Twilio.Device(token, {
      codecPreferences: ['opus', 'pcmu'], closeProtection: true, logLevel: 'error', allowIncomingWhileBusy: false,
    })
    device.on('tokenWillExpire', async () => {
      try { device.updateToken(await fetchToken()) } catch (e) { console.warn('voice token refresh failed', e) }
    })
    device.on('error', err => patch({ status: 'error', error: err?.message || 'Calling error' }))
    device.on('registered', () => patchIn({ registered: true }))
    device.on('unregistered', () => patchIn({ registered: false }))
    device.on('incoming', handleIncoming)
    deviceRef.current = device
    return device
  }, [patch, patchIn, handleIncoming])

  // Shared dialer: params go to Twilio -> voice-twiml (ProfileId / QueueId / To).
  const start = useCallback(async (params, label) => {
    setOpen(true)
    if (callRef.current || incomingRef.current) { patch({ error: 'Hang up the current call first.' }); return }
    patch({ status: 'connecting', label, sub: '', muted: false, seconds: 0, error: '' })
    try {
      const device = await getDevice()
      const c = await device.connect({ params })
      wire(c)
    } catch (e) {
      callRef.current = null
      const msg = /Permission|NotAllowed/i.test(e?.message || '') ? 'Microphone access is blocked. Allow the mic for this site and try again.' : (e?.message || 'Call failed.')
      patch({ status: 'error', error: msg })
    }
  }, [getDevice, patch, wire])

  // Click-to-call a person. Only their id leaves the browser.
  const callPerson = useCallback((profileId, name) => {
    if (!profileId) return
    start({ ProfileId: profileId }, name || 'Team member')
  }, [start])

  // Dialer: call the queue contact currently locked to this agent. Only the queue id leaves the browser.
  const callQueue = useCallback((queueId, name) => {
    if (!queueId) return
    start({ QueueId: queueId }, name || 'Customer')
  }, [start])

  // Typed number from the dial pad (admins only; the server enforces this too).
  const callNumber = useCallback((number) => {
    const to = toE164(number)
    setOpen(true)
    if (!canDialNumbers) { patch({ status: 'error', error: 'Only admins can dial a number directly.' }); return }
    if (!to) { patch({ status: 'error', error: 'Enter a 10-digit U.S. number.' }); return }
    start({ To: to }, formatPhone(to))
  }, [canDialNumbers, start, patch])

  // ---- inbound ----
  const acceptIncoming = useCallback(async () => {
    const c = incomingRef.current
    if (!c) return
    incomingRef.current = null
    try {
      wire(c)
      patch({ status: 'connecting' })
      c.accept()
    } catch (e) {
      callRef.current = null
      const msg = /Permission|NotAllowed/i.test(e?.message || '') ? 'Microphone access is blocked. Allow the mic for this site and try again.' : (e?.message || 'Could not answer.')
      patch({ status: 'error', error: msg })
    }
  }, [patch, wire])

  const declineIncoming = useCallback(() => {
    const c = incomingRef.current
    incomingRef.current = null
    try { c?.reject() } catch { /* ignore */ }
    patch({ status: 'idle', label: '', sub: '' })
  }, [patch])

  const setReady = useCallback(async (ready) => {
    patchIn({ busy: true })
    try {
      if (ready) {
        const device = await getDevice()
        if (device.state !== 'registered') await device.register()
      } else if (deviceRef.current?.state === 'registered') {
        await deviceRef.current.unregister()
      }
      const { error } = await supabase.rpc('inbound_set_ready', { p_ready: !!ready })
      if (error) throw error
      patchIn({ ready: !!ready })
    } catch (e) {
      setOpen(true)
      patch({ status: 'error', error: e?.message || 'Could not change inbound status.' })
    } finally {
      patchIn({ busy: false })
    }
  }, [getDevice, patch, patchIn])

  // On load: am I on an inbound line? If I left "ready" on, re-register this browser.
  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data } = await supabase.rpc('inbound_my_status')
      if (!alive || !data) return
      patchIn({ member: !!data.member, ready: !!data.ready, queues: data.queues || [], manager: !!data.manager })
      if (data.member && data.ready) {
        try { const d = await getDevice(); if (d.state !== 'registered') await d.register() } catch (e) { console.warn('inbound re-register failed', e) }
      }
    })()
    return () => { alive = false }
  }, [getDevice, patchIn])

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
    if (!callRef.current && !incomingRef.current) patch({ status: 'idle', label: '', sub: '', muted: false, seconds: 0, error: '' })
  }, [patch])

  useEffect(() => () => { stopTimer(); try { deviceRef.current?.destroy() } catch { /* ignore */ } }, [])

  const value = {
    ...state, open, setOpen, canDialNumbers, canCallPeople,
    callPerson, callQueue, callNumber, hangUp, toggleMute, sendDigit, reset,
    acceptIncoming, declineIncoming,
    inbound: { ...inbound, setReady },
    busy: ['connecting', 'ringing', 'in-call'].includes(state.status),
    incoming: state.status === 'incoming',
  }
  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>
}

// Returns null outside the provider. Inside it, check voice.canCallPeople before
// offering team click-to-call (agents only get dialer calls).
export function useVoice() {
  return useContext(VoiceContext)
}

// Drop-in click-to-call button. Renders nothing for people who can't place calls.
//   <CallButton profileId={p.id} name={p.full_name} />            compact phone icon
//   <CallButton profileId={p.id} name={p.full_name} label="Call" /> icon + text
//   hasPhone={false} shows it disabled with a "no phone on file" tooltip.
export function CallButton({ profileId, name, label, hasPhone = true, style }) {
  const voice = useVoice()
  if (!voice || !voice.canCallPeople || !profileId) return null
  const disabled = !hasPhone || voice.busy || voice.incoming
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
