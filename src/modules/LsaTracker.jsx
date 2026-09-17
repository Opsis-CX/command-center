import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'

// LSA chat lead tracker — lives inside the #GarageCo LSA Chat Team channel.
// One row per LSA chat. Logging a booking auto-posts a celebration into this
// channel (Postgres trigger). Open leads get an escalating follow-up cadence
// (15m,30m,3h,24h,72h,120h,168h from came-in) that pops up for every channel
// member (fire_lsa_followups() cron -> notifications -> LsaReminderPopup).

const OUTCOMES = [
  'LSA waiting on customer reply',
  'LSA Follow Up',
  'LSA Outbound Call',
  'LSA Booked',
  'LSA Not Booked',
  'LSA Not relevant',
]

// Follow-up reminder presets (minutes). '' = leave to the auto cadence.
const REMIND_PRESETS = [
  { v: '', label: 'Auto cadence (15m → 168h)' },
  { v: '15', label: 'in 15 minutes' },
  { v: '30', label: 'in 30 minutes' },
  { v: '180', label: 'in 3 hours' },
  { v: '1440', label: 'in 24 hours' },
  { v: '4320', label: 'in 72 hours' },
  { v: '7200', label: 'in 120 hours' },
  { v: '10080', label: 'in 168 hours' },
  { v: 'custom', label: 'Custom time…' },
]

const ctl = {
  padding: '6px 8px', border: '1px solid var(--line)', borderRadius: 8,
  background: 'var(--surface)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 13,
}

function todayNY() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}
function shortDate(d) {
  if (!d) return '—'
  const [, m, day] = d.split('-').map(Number)
  const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1]
  return `${mon} ${day}`
}
function shortDT(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-US', {
      timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })
  } catch { return '—' }
}

export default function LsaTracker({ me }) {
  const [brands, setBrands] = useState([])
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [modalLead, setModalLead] = useState(undefined) // undefined = closed, null = new, obj = edit
  const [tab, setTab] = useState('followup') // 'followup' | 'today' | 'all'

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

  useEffect(() => {
    const ch = supabase.channel('lsa_leads_live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lsa_leads' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  const today = todayNY()
  const todays = useMemo(() => rows.filter(r => r.lead_date === today), [rows, today])
  const openRows = useMemo(() => rows.filter(r => r.is_open).sort((a, b) =>
    (a.follow_up_at || '9999').localeCompare(b.follow_up_at || '9999') ||
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

  const tabBtn = (on) => ({
    padding: '5px 14px', fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer',
    background: on ? 'var(--accent, #0d9488)' : 'var(--surface)', color: on ? '#fff' : 'var(--ink-soft)',
    fontFamily: 'inherit',
  })

  const list = tab === 'followup' ? openRows : tab === 'today' ? todays : rows

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0, minHeight: 0, background: 'var(--surface)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--line)', flex: 'none', flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={() => setModalLead(null)}>＋ Log LSA lead</button>
        <div style={{ display: 'flex', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
          <button onClick={() => setTab('followup')} style={tabBtn(tab === 'followup')}>Needs follow-up ({openRows.length})</button>
          <button onClick={() => setTab('today')} style={{ ...tabBtn(tab === 'today'), borderLeft: '1px solid var(--line)' }}>Today ({todays.length})</button>
          <button onClick={() => setTab('all')} style={{ ...tabBtn(tab === 'all'), borderLeft: '1px solid var(--line)' }}>All ({rows.length})</button>
        </div>
        {err && <span className="login-err" style={{ margin: 0 }}>{err}</span>}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '10px 14px', flex: 'none', borderBottom: '1px solid var(--line)' }}>
        <span className="page-sub" style={{ fontSize: 12, alignSelf: 'center' }}>Today:</span>
        {tally.length === 0 && <span className="page-sub" style={{ fontSize: 12 }}>no leads logged yet</span>}
        {tally.map(([brand, t]) => (
          <span key={brand} className="badge" title={`${t.total} lead(s), ${t.booked} booked`}>
            {brand} · {t.total}{t.booked ? ` · ${t.booked}✓` : ''}
          </span>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading && <div className="page-sub">Loading…</div>}
        {!loading && list.length === 0 && (
          <div className="page-sub" style={{ padding: '20px 0', textAlign: 'center' }}>
            {tab === 'followup' ? 'Nothing waiting on follow-up. 🎉' : tab === 'today' ? 'No LSA leads logged today yet.' : 'No LSA leads yet.'}
          </div>
        )}
        {list.map(r => (
          <LeadRow key={r.id} r={r}
            onOutcome={(v) => patch(r.id, v === 'LSA Booked' && !r.booked_date ? { outcome: v, booked_date: r.lead_date } : { outcome: v })}
            onEdit={() => setModalLead(r)}
            onVoid={(reason) => patch(r.id, { voided: true, void_reason: reason || null })}
          />
        ))}
      </div>

      {modalLead !== undefined && (
        <LeadModal brands={brands} lead={modalLead}
          onClose={() => setModalLead(undefined)}
          onSaved={() => { setModalLead(undefined); load() }} />
      )}
    </div>
  )
}

function LeadRow({ r, onOutcome, onEdit, onVoid }) {
  const [confirming, setConfirming] = useState(false)
  const [reason, setReason] = useState('')
  return (
    <div className="card" style={{ padding: '10px 12px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ minWidth: 0, flex: '1 1 190px' }}>
        <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {r.lead_name || '(no name)'} <span style={{ color: 'var(--ink-soft)', fontWeight: 400 }}>· {r.brand}</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-soft)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{r.phone || '—'}</span>
          <span>in {shortDate(r.lead_date)}</span>
          {r.booked_date && <span style={{ color: 'var(--accent)' }}>booked {shortDate(r.booked_date)}</span>}
          {r.is_open && r.follow_up_at && <span title="Next reminder">⏰ {shortDT(r.follow_up_at)}</span>}
          {r.lsa_link
            ? <a href={r.lsa_link} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', fontWeight: 600 }}>↗ LSA chat</a>
            : <button onClick={onEdit} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', fontFamily: 'inherit', fontSize: 12 }}>🔗 add link</button>}
        </div>
        {r.notes && (
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            📝 {r.notes}
          </div>
        )}
      </div>
      <select value={r.outcome} onChange={e => onOutcome(e.target.value)} style={ctl} title="Outcome">
        {OUTCOMES.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      <button className="btn btn-ghost" style={{ padding: '4px 10px' }} onClick={onEdit} title="Edit details / dates / notes / reminder">Edit</button>
      {!confirming
        ? <button className="btn btn-ghost" style={{ padding: '4px 9px' }} onClick={() => setConfirming(true)} title="Void (wrong entry)">✕</button>
        : (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <input value={reason} onChange={e => setReason(e.target.value)} placeholder="reason (optional)" style={{ ...ctl, width: 130 }} />
            <button className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={() => { setConfirming(false); setReason('') }}>Cancel</button>
            <button className="btn btn-primary" style={{ padding: '4px 8px', background: 'var(--failed, #dc2626)' }} onClick={() => { onVoid(reason); setConfirming(false); setReason('') }}>Void</button>
          </div>
        )}
    </div>
  )
}

function LeadModal({ brands, lead, onClose, onSaved }) {
  const isEdit = !!lead
  const [brand, setBrand] = useState(lead?.brand || brands[0] || '')
  const [name, setName] = useState(lead?.lead_name || '')
  const [phone, setPhone] = useState(lead?.phone || '')
  const [lsaLink, setLsaLink] = useState(lead?.lsa_link || '')
  const [outcome, setOutcome] = useState(lead?.outcome || 'LSA waiting on customer reply')
  const [leadDate, setLeadDate] = useState(lead?.lead_date || todayNY())
  const [bookedDate, setBookedDate] = useState(lead?.booked_date || '')
  const [notes, setNotes] = useState(lead?.notes || '')
  const [remind, setRemind] = useState('') // '' auto/keep, minutes, or 'custom'
  const [customAt, setCustomAt] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const booked = outcome === 'LSA Booked'

  async function save() {
    if (!brand) { setErr('Pick a brand'); return }
    if (!leadDate) { setErr('Pick the date the lead came in'); return }
    setSaving(true); setErr('')
    const payload = {
      brand,
      lead_name: name.trim() || null,
      phone: phone.trim() || null,
      lsa_link: lsaLink.trim() || null,
      outcome,
      lead_date: leadDate,
      booked_date: booked ? (bookedDate || leadDate) : (bookedDate || null),
      notes: notes.trim() || null,
    }
    // Follow-up reminder: only touch follow_up_at when the user picked something.
    if (remind === 'custom' && customAt) {
      payload.follow_up_at = new Date(customAt).toISOString()
    } else if (remind && remind !== 'custom') {
      payload.follow_up_at = new Date(Date.now() + Number(remind) * 60000).toISOString()
    } else if (!isEdit) {
      payload.follow_up_at = null // new + auto → trigger starts the 15m→168h cadence
    }
    const q = isEdit
      ? supabase.from('lsa_leads').update(payload).eq('id', lead.id)
      : supabase.from('lsa_leads').insert(payload)
    const { error } = await q
    if (error) { setErr(error.message); setSaving(false); return }
    onSaved()
  }

  return (
    <div className="modal-back open" onClick={e => { if (e.target.classList.contains('modal-back')) onClose() }}>
      <div className="modal">
        <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600 }}>{isEdit ? 'Edit LSA lead' : 'Log LSA lead'}</h3>
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
        <div className="field"><label>LSA chat link</label>
          <input value={lsaLink} onChange={e => setLsaLink(e.target.value)} placeholder="paste the link from the LSA email (optional)" /></div>
        <div className="field"><label>Outcome</label>
          <select value={outcome} onChange={e => setOutcome(e.target.value)}>
            {OUTCOMES.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '1 1 130px' }}><label>Date lead came in</label>
            <input type="date" value={leadDate} onChange={e => setLeadDate(e.target.value)} /></div>
          <div className="field" style={{ flex: '1 1 130px' }}><label>Booked date{booked ? '' : ' (if booked)'}</label>
            <input type="date" value={bookedDate} onChange={e => setBookedDate(e.target.value)} /></div>
        </div>
        <div className="field"><label>Notes</label>
          <textarea value={notes} rows={2} maxLength={200}
            onChange={e => setNotes(e.target.value.replace(/\n{2,}/g, '\n').split('\n').slice(0, 2).join('\n'))}
            placeholder="short note (2 lines max)" style={{ resize: 'none' }} /></div>
        <div className="field"><label>Follow-up reminder</label>
          <select value={remind} onChange={e => setRemind(e.target.value)}>
            {REMIND_PRESETS.map(p => <option key={p.v} value={p.v}>{isEdit && p.v === '' ? 'Keep current' : p.label}</option>)}
          </select>
        </div>
        {remind === 'custom' && (
          <div className="field"><label>Custom reminder time</label>
            <input type="datetime-local" value={customAt} onChange={e => setCustomAt(e.target.value)} /></div>
        )}
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={save} disabled={saving}>{saving ? 'Saving…' : (isEdit ? 'Save' : 'Log lead')}</button>
        </div>
      </div>
    </div>
  )
}
