import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { US_ZONES, detectedTZ, tzAbbrev, COMPANY_TZ } from '../lib/tz'

export default function Settings() {
  const { user } = useAuth()
  const [tz, setTz] = useState(COMPANY_TZ)
  const [loaded, setLoaded] = useState(false)
  const [saved, setSaved] = useState(false)
  const detected = detectedTZ()

  useEffect(() => {
    (async () => {
      if (!user) return
      const { data } = await supabase.from('profiles').select('timezone').eq('id', user.id).maybeSingle()
      setTz(data?.timezone || COMPANY_TZ)
      setLoaded(true)
    })()
  }, [user])

  async function save(newTz) {
    setTz(newTz)
    await supabase.from('profiles').update({ timezone: newTz }).eq('id', user.id)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (!loaded) return <div className="page-sub" style={{ padding: 30 }}>Loading settings…</div>

  const detectedInList = US_ZONES.some(([v]) => v === detected)

  return (
    <div style={{ maxWidth: 560 }}>
      <h2 style={{ fontSize: 20, marginBottom: 4 }}>Settings</h2>
      <p className="page-sub" style={{ marginTop: 0, marginBottom: 24 }}>Your preferences for Command Center.</p>

      <div className="card" style={{ padding: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Your timezone</div>
        <p className="page-sub" style={{ marginTop: 0, fontSize: 13, marginBottom: 14 }}>
          Schedules are set in company time ({tzAbbrev(COMPANY_TZ)}). Choose your timezone and all times across
          Command Center — your calendar, shifts, and check-in — will show in your local time.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <select value={tz} onChange={e => save(e.target.value)}
            style={{ fontSize: 14, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)', minWidth: 240 }}>
            {US_ZONES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            {!detectedInList && <option value={detected}>{detected}</option>}
          </select>
          {saved && <span style={{ fontSize: 13, color: 'var(--passed, #16A34A)' }}>✓ Saved</span>}
        </div>

        {detected && detected !== tz && (
          <button onClick={() => save(detected)}
            style={{ marginTop: 12, border: '1px solid var(--line)', background: 'transparent', borderRadius: 8, padding: '6px 12px', fontSize: 12.5, cursor: 'pointer' }}>
            Use my detected timezone ({detected}, {tzAbbrev(detected)})
          </button>
        )}

        <div style={{ marginTop: 16, fontSize: 12.5, color: 'var(--ink-soft)' }}>
          Currently showing times in: <b>{tzAbbrev(tz)}</b> ({tz})
        </div>
      </div>
    </div>
  )
}
