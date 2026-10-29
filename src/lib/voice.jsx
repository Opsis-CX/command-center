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
//  ONE AGENT STATUS (voice.agent / voice.setStatus):
//    Ready      — inbound calls for your menu options ring this browser, and the
//                 Dialer feeds you outbound contacts between inbound calls.
//    Not ready  — with a reason (Break, Lunch, Meeting, Training, Coaching, Other).
//    Offline    — nothing rings you.
//    On call / Wrap-up are set by the system while you're on a call / dispositioning.
//  Stored in dialer_agent_state (rpc agent_status_get / agent_set_status); voice-inbound
//  only rings people whose status is Ready.
//
//  Answering an inbound call sets voice.inboundCall; the Dialer page (/dialer) shows the
//  guided call screen for it, and voice.clearInbound() is called after the disposition.
//
//  The SDK loads on first use from jsDelivr (pinned version) — nothing in package.json.
//  Server side: voice-token (who may call) + voice-twiml (outbound) + voice-inbound (inbound).
// ============================================================
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@twilio/voice-sdk@2.18.5/dist/twilio.min.js'
const STATUS_POLL_MS = 30000

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
const BLANK_AGENT = { state: 'offline', reason: null, since: null, inbound_member: false, campaigns: 0, loaded: false }

// canCallPeople: click-to-call team members (everyone except agents).
// canDialNumbers: type any number on the dial pad (admins).
// Everyone inside the provider can work dialer campaigns they're assigned to (callQueue).
export function VoiceProvider({ children, canDialNumbers = false, canCallPeople = true }) {
  const deviceRef = useRef(null)
  const callRef = useRef(null)
  const incomingRef = useRef(null)
  const inboundRef = useRef(null)      // answered inbound call waiting for its disposition
  const timerRef = useRef(null)
  // status: idle | incoming | connecting | ringing | in-call | ended | error
  const [state, setState] = useState({ status: 'idle', label: '', sub: '', muted: false, seconds: 0, error: '' })
  const [open, setOpen] = useState(false)
  const [agent, setAgent] = useState(BLANK_AGENT)
  const [registered, setRegistered] = useState(false)
  const [statusBusy, setStatusBusy] = useState(false)
  const [inboundCall, setInboundCall] = useState(null) // { id, callerName, queueLabel, lineName, answeredAt }

  const patch = useCallback(p => setState(s => ({ ...s, ...p })), [])
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
    // Busy, already ringing, or still wrapping up the last inbound call: decline so it
    // rolls to the next person / the AI assistant.
    if (callRef.current || incomingRef.current || inboundRef.current) { try { call.reject() } catch { /* ignore */ } return }
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
    // Token refresh (10/29): the 1-hour token also expires while the laptop sleeps or the tab is in the
    // background, when tokenWillExpire never fires. Refresh on wake, and recover from AccessTokenExpired (20104).
    let tokenAt = Date.now()
    const refreshToken = async () => { device.updateToken(await fetchToken()); tokenAt = Date.now() }
    device.on('tokenWillExpire', async () => {
      try { await refreshToken() } catch (e) { console.warn('voice token refresh failed', e) }
    })
    const onWake = async () => {
      if (document.visibilityState !== 'visible' || Date.now() - tokenAt < 30 * 60 * 1000) return
      try { await refreshToken(); if (device._wantRegistered && device.state !== 'registered') await device.register() } catch (e) { console.warn('voice token refresh failed', e) }
    }
    document.addEventListener('visibilitychange', onWake)
    window.addEventListener('focus', onWake)
    device.on('error', async err => {
      if (err?.code === 20104 || /AccessTokenExpired|token.*expired/i.test(err?.message || '')) {
        try {
          await refreshToken()
          if (device._wantRegistered && device.state !== 'registered') await device.register()
          patch({ status: 'idle', error: '' })
          return
        } catch (e) { console.warn('voice token refresh failed', e) }
      }
      patch({ status: 'error', error: err?.message || 'Calling error' })
    })
    device.on('registered', () => setRegistered(true))
    device.on('unregistered', () => setRegistered(false))
    device.on('incoming', handleIncoming)
    deviceRef.current = device
    return device
  }, [patch, handleIncoming])

  // ---------- single agent status ----------
  const applyRegistration = useCallback(async (a) => {
    try {
      if (a.state === 'ready' && a.inbound_member) {
        const d = await getDevice()
        d._wantRegistered = true
        if (d.state !== 'registered') await d.register()
      } else if (deviceRef.current?.state === 'registered' && !['on_call', 'wrap'].includes(a.state)) {
        deviceRef.current._wantRegistered = false
        await deviceRef.current.unregister()
      }
    } catch (e) { console.warn('inbound registration failed', e) }
  }, [getDevice])

  const refreshStatus = useCallback(async () => {
    const { data } = await supabase.rpc('agent_status_get')
    if (data) setAgent({ ...BLANK_AGENT, ...data, loaded: true })
    return data
  }, [])

  const setStatus = useCallback(async (next, reason = null) => {
    setStatusBusy(true)
    try {
      const { data, error } = await supabase.rpc('agent_set_status', { p_state: next, p_reason: reason })
      if (error) throw error
      const a = { ...BLANK_AGENT, ...data, loaded: true }
      setAgent(a)
      await applyRegistration(a)
      return a
    } catch (e) {
      setOpen(true)
      patch({ status: 'error', error: e?.message || 'Could not change your status.' })
      return null
    } finally {
      setStatusBusy(false)
    }
  }, [applyRegistration, patch])

  // On load: read my status and, if I'm Ready on an inbound line, register this browser.
  useEffect(() => {
    let alive = true
    ;(async () => {
      const data = await refreshStatus()
      if (alive && data) await applyRegistration(data)
    })()
    const t = setInterval(refreshStatus, STATUS_POLL_MS)
    return () => { alive = false; clearInterval(t) }
  }, [refreshStatus, applyRegistration])

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

  const callPerson = useCallback((profileId, name) => {
    if (!profileId) return
    start({ ProfileId: profileId }, name || 'Team member')
  }, [start])

  const callQueue = useCallback((queueId, name) => {
    if (!queueId) return
    start({ QueueId: queueId }, name || 'Customer')
  }, [start])

  const callNumber = useCallback((number) => {
    const to = toE164(number)
    setOpen(true)
    if (!canDialNumbers) { patch({ status: 'error', error: 'Only admins can dial a number directly.' }); return }
    if (!to) { patch({ status: 'error', error: 'Enter a 10-digit U.S. number.' }); return }
    start({ To: to }, formatPhone(to))
  }, [canDialNumbers, start, patch])

  // ---------- inbound ----------
  const acceptIncoming = useCallback(async () => {
    const c = incomingRef.current
    if (!c) return
    incomingRef.current = null
    const p = c.customParameters || new Map()
    const info = {
      id: p.get('inboundId') || null, callerName: p.get('callerName') || 'Caller',
      queueLabel: p.get('queueLabel') || '', lineName: p.get('lineName') || '', answeredAt: new Date().toISOString(),
    }
    try {
      wire(c)
      patch({ status: 'connecting' })
      c.accept()
      inboundRef.current = info
      setInboundCall(info)
      setAgent(a => ({ ...a, state: 'on_call', since: new Date().toISOString() }))
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

  // Called after the inbound disposition is saved.
  const clearInbound = useCallback(async () => {
    inboundRef.current = null
    setInboundCall(null)
    if (!callRef.current) patch({ status: 'idle', label: '', sub: '', muted: false, seconds: 0, error: '' })
    await refreshStatus()
  }, [patch, refreshStatus])

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

  const worksCalls = agent.inbound_member || agent.campaigns > 0
  const value = {
    ...state, open, setOpen, canDialNumbers, canCallPeople,
    callPerson, callQueue, callNumber, hangUp, toggleMute, sendDigit, reset,
    acceptIncoming, declineIncoming,
    agent, setStatus, refreshStatus, statusBusy, registered, worksCalls,
    inboundCall, clearInbound,
    // older pages read voice.inbound — kept as a thin alias of the single status
    inbound: {
      member: agent.inbound_member, ready: agent.state === 'ready', registered, busy: statusBusy,
      setReady: r => setStatus(r ? 'ready' : 'not_ready', r ? null : 'Other'),
    },
    busy: ['connecting', 'ringing', 'in-call'].includes(state.status),
    incoming: state.status === 'incoming',
  }
  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>
}

export function useVoice() {
  return useContext(VoiceContext)
}

// Drop-in click-to-call button. Renders nothing for people who can't place calls.
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
