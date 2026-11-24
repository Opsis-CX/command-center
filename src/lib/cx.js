// ============================================================
//  CX engine helpers (conference calling: hold, transfer, conference, monitor,
//  live transcript, agent assist). Server side: cx-voice, cx-control, cx-transcript
//  edge functions + csr_cx_* / cx_* RPCs.  Only lines / campaigns switched to the
//  "Advanced engine" (engine = 'conf') produce CX calls; everything else is unchanged.
// ============================================================
import { supabase } from './supabase'

async function fnError(error, fallback) {
  let msg = error?.message || fallback
  try { const j = await error?.context?.json?.(); if (j?.error) msg = j.error } catch { /* ignore */ }
  return msg
}

// Live call controls → cx-control
export async function cxControl(action, interactionId, extra = {}) {
  const { data, error } = await supabase.functions.invoke('cx-control', { body: { action, interaction_id: interactionId, ...extra } })
  if (error) throw new Error(await fnError(error, 'That didn’t work. Try again.'))
  if (data?.error) throw new Error(data.error)
  return data
}

// Refresh agent assist now / build the AI wrap-up now → cx-transcript
export async function cxAssistNow(interactionId) {
  const { error } = await supabase.functions.invoke(`cx-transcript?action=assist&i=${interactionId}`, { body: {} })
  if (error) throw new Error(await fnError(error, 'Assist is not available right now.'))
}
export async function cxWrapNow(interactionId) {
  const { data, error } = await supabase.functions.invoke(`cx-transcript?action=wrap_now&i=${interactionId}`, { body: {} })
  if (error) throw new Error(await fnError(error, 'Could not build the summary.'))
  return data?.wrap || null
}

export const cxRpc = async (fn, args = {}) => {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data
}

// ---------- a small stand-alone Twilio device for supervisors (listen / whisper / barge) ----------
// Used where the page isn't inside <VoiceProvider> (e.g. the portal wallboard).
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@twilio/voice-sdk@2.18.5/dist/twilio.min.js'
let sdkPromise = null
function loadSdk() {
  if (window.Twilio?.Device) return Promise.resolve(window.Twilio)
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = SDK_URL; s.async = true
      s.onload = () => (window.Twilio?.Device ? resolve(window.Twilio) : reject(new Error('Calling library failed to load')))
      s.onerror = () => { sdkPromise = null; reject(new Error('Could not load the calling library.')) }
      document.head.appendChild(s)
    })
  }
  return sdkPromise
}
let monitorDevice = null
export async function startMonitor(interactionId, mode = 'listen', onEnd) {
  const Twilio = await loadSdk()
  if (!monitorDevice) {
    const { data, error } = await supabase.functions.invoke('voice-token', { body: {} })
    if (error || !data?.token) throw new Error(await fnError(error, data?.error || 'You are not set up to listen to calls.'))
    monitorDevice = new Twilio.Device(data.token, { codecPreferences: ['opus', 'pcmu'], logLevel: 'error' })
    monitorDevice.on('tokenWillExpire', async () => {
      try { const r = await supabase.functions.invoke('voice-token', { body: {} }); if (r.data?.token) monitorDevice.updateToken(r.data.token) } catch { /* ignore */ }
    })
  }
  const call = await monitorDevice.connect({ params: { CxI: interactionId, CxMode: mode } })
  call.on('disconnect', () => onEnd?.())
  call.on('error', () => onEnd?.())
  return call
}
