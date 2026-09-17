import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'

// LSA chat lead tracker — lives inside the #GarageCo LSA Chat Team channel.
// One row per LSA chat. Logging a booking auto-posts a celebration into this
// channel (Postgres trigger on public.lsa_leads), so nobody posts twice.

// Order chosen for the dropdown: open/working states first, then resolutions.
const OUTCOMES = [
  'LSA waiting on customer reply',
  'LSA Follow Up',
  'LSA Outbound Call',
  'LSA Booked',
  'LSA Not Booked',
  'LSA Not relevant',
]

const ctl = {
  padding: '6px 8px', border: '1px solid var(--line)', borderRadius: 8,
  background: 'var(--surface)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 13,
}

// YYYY-MM-DD for "today" in America/New_York (matches the lead_date default + report window)
function todayNY() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}
function shortDate(d) {
  if (!d) return '—'
  const [y, m, day] = d.split('-').map(Number)
  const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1]
  return `${mon} ${day}`
}

export default function LsaTracker({ me }) {
  const [brands, setBrands] = useState([])
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [showLog, setShowLog] = useState(false)
  const [tab, setTab] = useState('followup') // 'followup' | 'today'

  const load = useCallback(async () => {
    setErr('')
    const b = await supabase.from('qa_brands').select('name,sort_order,active').eq('active', true).order('sort_order')
    if (!b.error && b.data) {
      const seen = new Set(); const names = []
      for (const r of b.data) { if (!seen.has(r.name)) { seen.add(r.name); names.push(r.name) } }
      setBrands(names)
    }
    const r = await supabase.from('lsa_leads').select('*').eq('voided', false)
      .order('created_at', { ascending: false }).limit(500)
    if (r.error) setErr(r.error.message)
    else setRows(r.data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Live refresh so the shared list stays in sync across everyone viewing it.
  useEffect(() => {
    const ch = supabase.channel('lsa_leads_live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lsa_leads' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  const today = todayNY()
  const todays = useMemo(() => rows.filter(r => r.lead_date === today), [rows, today])
  const openRows = useMemo(() => rows.filter(r => r.is_open).sort((a, b) =>
    (a.next_follow_up || '9999-99-99').localeCompare(b.next_follow_up || '9999-99-99') ||
    a.created_at.localeCompare(b.created_at)
  ), [rows])

  const tally = useMemo(() => {
    const m = {}
    for (const r of todays) {
      m[r.brand] = m[r.brand] || { total: 0, booked: 0 }
      m[r.brand].total++
      if (r.outcome === 'LSA Booked') m[r.brand].booked++
    }
    return Object.entries(m).sort((a, b) => a[0].localeCompare(b[0]))
  }, [todays])

  async function patch(id, fields) {
    const { error } = await supabase.from('lsa_leads').update(fields).eq('id', id)
    if (error) setErr(error.message); else load()
  }
  async function voidRow(id) {
    const reason = window.prompt('Void this lead — reason (optional):')
    if (reason === null) return
    patch(id, { voided: true, void_reason: reason || null })
  }

  const tabBtn = (on) => ({
    padding: '5px 14px', fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer',
    background: on ? 'var(--accent, #0d9488)' : 'var(--surface)', color: on ? '#fff' : 'var(--ink-soft)',
    fontFamily: 'inherit',
  })

  const list = tab === 'followup' ? openRows : todays

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0, minHeight: 0, background: 'var(--surface)' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--line)', flex: 'none', flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={() => setShowLog(true)}>＋ Log LSA lead</button>
        <div style={{ display: 'flex', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
          <button onClick={() => setTab('followup')} style={tabBtn(tab === 'followup')}>Needs follow-up ({openRows.length})</button>
          <button onClick={() => setTab('today')} style={{ ...tabBtn(tab === 'today'), borderLeft: '1px solid var(--line)' }}>Today ({todays.length})</button>
        </div>
        {err && <span className="login-err" style={{ margin: 0 }}>{err}</span>}
      </div>

      {/* today per-brand tally */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '10px 14px', flex: 'none', borderBottom: '1px solid var(--line)' }}>
        <span className="page-sub" style={{ fontSize: 12, alignSelf: 'center' }}>Today:</span>
        {tally.length === 0 && <span className="page-sub" style={{ fontSize: 12 }}>no leads logged yet</span>}
        {tally.map(([brand, t]) => (
          <span key={brand} className="badge" title={`${t.total} lead(s), ${t.booked} booked`}>
            {brand} · {t.total}{t.booked ? ` · ${t.booked}✓` : ''}
          </span>
        ))}
      </div>

      {/* list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading && <div className="page-sub">Loading…</div>}
        {!loading && list.length === 0 && (
          <div className="page-sub" style={{ padding: '20px 0', textAlign: 'center' }}>
            {tab === 'followup' ? 'Nothing waiting on follow-up. 🎉' : 'No LSA leads logged today yet.'}
          </div>
        )}
        {list.map(r => (
          <div key={r.id} className="card" style={{ padding: '10px 12px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0, flex: '1 1 170px' }}>
              <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {r.lead_name || '(no name)'} <span style={{ color: 'var(--ink-soft)', fontWeight: 400 }}>· {r.brand}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{r.phone || '—'} · {shortDate(r.lead_date)}</div>
            </div>
            <select value={r.outcome} onChange={e => patch(r.id, { outcome: e.target.value })} style={ctl} title="Outcome">
              {OUTCOMES.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            <input type="date" value={r.next_follow_up || ''} onChange={e => patch(r.id, { next_follow_up: e.target.value || null })} style={ctl} title="Next follow-up" />
            <button className="btn btn-ghost" style={{ padding: '4px 9px' }} onClick={() => voidRow(r.id)} title="Void (wrong entry)">✕</button>
          </div>
        ))}
      </div>

      {showLog && (
        <LogModal brands={brands} onClose={() => setShowLog(false)} onSaved={() => { setShowLog(false); load() }} />
      )}
    </div>
  )
}

function LogModal({ brands, onClose, onSaved }) {
  const [brand, setBrand] = useState(brands[0] || '')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [outcome, setOutcome] = useState('LSA waiting on customer reply')
  const [followUp, setFollowUp] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    if (!brand) { setErr('Pick a brand'); return }
    setSaving(true); setErr('')
    const { error } = await supabase.from('lsa_leads').insert({
      brand,
      lead_name: name.trim() || null,
      phone: phone.trim() || null,
      outcome,
      next_follow_up: followUp || null,
    })
    if (error) { setErr(error.message); setSaving(false); return }
    onSaved()
  }

  return (
    <div className="modal-back open" onClick={e => { if (e.target.classList.contains('modal-back')) onClose() }}>
      <div className="modal">
        <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600 }}>Log LSA lead</h3>
        <p className="page-sub" style={{ marginBottom: 16 }}>LSA chats only. Logging a booking auto-posts it to this channel.</p>
        {err && <div className="login-err" style={{ marginBottom: 14 }}>{err}</div>}
        <div className="field"><label>Brand</label>
          <select value={brand} onChange={e => setBrand(e.target.value)} autoFocus>
            {brands.length === 0 && <option value="">—</option>}
            {brands.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div className="field"><label>Lead name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Nick Bunch" /></div>
        <div className="field"><label>Phone</label>
          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="optional" /></div>
        <div className="field"><label>Outcome</label>
          <select value={outcome} onChange={e => setOutcome(e.target.value)}>
            {OUTCOMES.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div className="field"><label>Next follow-up (optional)</label>
          <input type="date" value={followUp} onChange={e => setFollowUp(e.target.value)} /></div>
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Log lead'}</button>
        </div>
      </div>
    </div>
  )
}
