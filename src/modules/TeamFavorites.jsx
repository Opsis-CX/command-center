import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

// ============================================================
// GET TO KNOW YOU — a team "favorites" directory.
//
// Everyone (agents and non-agents alike) fills out their own card once; from
// then on everyone can browse everyone else's. Reads are open to all signed-in
// users; the DB only lets a person write their OWN row (RLS on team_favorites).
// Birthday is month + day only — no year, by design.
// ============================================================

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

const SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL']

// Text fields shown on the card, in order. (Sizes + birthday render specially.)
const CARD_FIELDS = [
  ['favorite_colors', 'Favorite color(s)', '🎨'],
  ['favorite_drinks', 'Favorite drink(s)', '🥤'],
  ['favorite_food', 'Favorite food', '🍽️'],
  ['favorite_restaurant', 'Favorite restaurant', '📍'],
  ['favorite_ice_cream', 'Favorite ice cream', '🍦'],
  ['favorite_candy', 'Favorite candy', '🍬'],
  ['favorite_snack', 'Favorite snack', '🍿'],
  ['favorite_scent', 'Favorite scent', '🕯️'],
  ['coffee_order', 'Coffee / drink order', '☕'],
  ['hobbies', 'Hobbies & interests', '🎯'],
  ['allergies_dietary', 'Allergies / dietary', '⚠️'],
  ['fun_fact', 'Fun fact', '✨'],
]

// A stable pleasant color from a string, used when a profile has no color set.
function hueFor(str = '') {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360
  return `hsl(${h} 55% 45%)`
}

const clean = (v) => {
  const t = (v ?? '').toString().trim()
  return t === '' ? null : t
}

export default function TeamFavorites() {
  const { user } = useAuth()
  const [people, setPeople] = useState([])        // active non-client profiles
  const [favs, setFavs] = useState({})            // profile_id -> favorites row
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: profs }, { data: rows }] = await Promise.all([
      supabase.from('profiles')
        .select('id, full_name, role, color, is_active')
        .eq('is_active', true).neq('role', 'client')
        .order('full_name'),
      supabase.from('team_favorites').select('*'),
    ])
    setPeople(profs || [])
    const map = {}
    ;(rows || []).forEach(r => { map[r.profile_id] = r })
    setFavs(map)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const myRow = user?.id ? favs[user.id] : null
  const meProfile = useMemo(
    () => people.find(p => p.id === user?.id) || null,
    [people, user?.id]
  )

  function startEdit() {
    setErr('')
    setForm({
      favorite_colors: myRow?.favorite_colors || '',
      favorite_drinks: myRow?.favorite_drinks || '',
      favorite_food: myRow?.favorite_food || '',
      favorite_restaurant: myRow?.favorite_restaurant || '',
      favorite_ice_cream: myRow?.favorite_ice_cream || '',
      favorite_candy: myRow?.favorite_candy || '',
      favorite_snack: myRow?.favorite_snack || '',
      favorite_scent: myRow?.favorite_scent || '',
      coffee_order: myRow?.coffee_order || '',
      hobbies: myRow?.hobbies || '',
      allergies_dietary: myRow?.allergies_dietary || '',
      fun_fact: myRow?.fun_fact || '',
      tshirt_size: myRow?.tshirt_size || '',
      hoodie_size: myRow?.hoodie_size || '',
      birthday_month: myRow?.birthday_month || '',
      birthday_day: myRow?.birthday_day || '',
    })
    setEditing(true)
  }

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  async function save() {
    if (!user?.id) return
    setSaving(true); setErr('')
    const payload = {
      profile_id: user.id,
      favorite_colors: clean(form.favorite_colors),
      favorite_drinks: clean(form.favorite_drinks),
      favorite_food: clean(form.favorite_food),
      favorite_restaurant: clean(form.favorite_restaurant),
      favorite_ice_cream: clean(form.favorite_ice_cream),
      favorite_candy: clean(form.favorite_candy),
      favorite_snack: clean(form.favorite_snack),
      favorite_scent: clean(form.favorite_scent),
      coffee_order: clean(form.coffee_order),
      hobbies: clean(form.hobbies),
      allergies_dietary: clean(form.allergies_dietary),
      fun_fact: clean(form.fun_fact),
      tshirt_size: clean(form.tshirt_size),
      hoodie_size: clean(form.hoodie_size),
      birthday_month: form.birthday_month ? Number(form.birthday_month) : null,
      birthday_day: form.birthday_day ? Number(form.birthday_day) : null,
    }
    const { data, error } = await supabase.from('team_favorites')
      .upsert(payload, { onConflict: 'profile_id' }).select().single()
    setSaving(false)
    if (error) { setErr(error.message || 'Could not save. Please try again.'); return }
    setFavs(prev => ({ ...prev, [user.id]: data }))
    setEditing(false)
  }

  // Split people into "filled out" and "not yet", with an optional name filter.
  const nameMatch = (p) => {
    const n = q.trim().toLowerCase()
    if (!n) return true
    return (p.full_name || '').toLowerCase().includes(n)
  }
  const filled = people.filter(p => favs[p.id] && nameMatch(p))
  const empty = people.filter(p => !favs[p.id] && nameMatch(p))

  if (loading) return <div className="loading-screen">Loading…</div>

  const iFilled = !!myRow

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h1 className="page-title">Get to Know You</h1>
        <p className="page-sub">
          Everyone on the team — agents and staff — shares a few favorites so we
          can celebrate birthdays, order the right swag, and surprise each other
          the right way. Fill out your card, then browse everyone else's.
        </p>
      </div>

      {/* ---- My card / prompt ---- */}
      <div className="card" style={{
        marginBottom: 22, borderLeft: '4px solid var(--accent)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, flexWrap: 'wrap',
      }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>
            {iFilled ? 'Your card is live 🎉' : 'You haven’t filled out your card yet'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 2 }}>
            {iFilled
              ? 'Thanks! You can update it anytime.'
              : 'Take a minute so the team can get to know you.'}
          </div>
        </div>
        <button className="btn btn-primary" onClick={startEdit}>
          {iFilled ? 'Edit my card' : 'Fill out my card'}
        </button>
      </div>

      {/* ---- Search ---- */}
      <div className="field" style={{ maxWidth: 320 }}>
        <input placeholder="Search people…" value={q} onChange={e => setQ(e.target.value)} />
      </div>

      {/* ---- Directory ---- */}
      {filled.length === 0 && (
        <div style={{ color: 'var(--ink-soft)', fontSize: 14, margin: '8px 0 20px' }}>
          No cards yet{q ? ' match your search' : ''}. Be the first to fill yours out!
        </div>
      )}

      <div className="cards" style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16,
      }}>
        {filled.map(p => (
          <PersonCard key={p.id} person={p} fav={favs[p.id]} isMe={p.id === user?.id} />
        ))}
      </div>

      {/* ---- Still to fill ---- */}
      {empty.length > 0 && (
        <div style={{ marginTop: 26 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: 8 }}>
            Haven’t filled out their card yet · {empty.length}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {empty.map(p => (
              <span key={p.id} className="badge" style={{
                background: 'var(--canvas)', color: 'var(--ink-soft)',
                border: '1px solid var(--line)', padding: '4px 10px', borderRadius: 999, fontSize: 13,
              }}>
                {p.full_name || 'Unnamed'}{p.id === user?.id ? ' (you)' : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      {editing && (
        <EditModal
          form={form} set={set} saving={saving} err={err}
          onClose={() => setEditing(false)} onSave={save}
        />
      )}
    </div>
  )
}

function PersonCard({ person, fav, isMe }) {
  const color = person.color || hueFor(person.full_name || person.id)
  const initial = ((person.full_name || 'U').trim()[0] || 'U').toUpperCase()
  const bday = fav.birthday_month
    ? `${MONTHS[fav.birthday_month]} ${fav.birthday_day || ''}`.trim()
    : null
  const rows = CARD_FIELDS.filter(([k]) => fav[k])

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 44, height: 44, borderRadius: '50%', background: color, color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 700, fontSize: 18, flexShrink: 0,
        }}>{initial}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', gap: 6 }}>
            {person.full_name || 'Unnamed'}
            {isMe && <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)' }}>(you)</span>}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', textTransform: 'capitalize' }}>
            {(person.role || '').replace(/,/g, ', ') || '—'}
          </div>
        </div>
      </div>

      {(bday || fav.tshirt_size || fav.hoodie_size) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {bday && <Pill>🎂 {bday}</Pill>}
          {fav.tshirt_size && <Pill>👕 Tee {fav.tshirt_size}</Pill>}
          {fav.hoodie_size && <Pill>🧥 Hoodie {fav.hoodie_size}</Pill>}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {rows.map(([k, label, ic]) => (
          <div key={k} style={{ display: 'flex', gap: 8, fontSize: 13.5, lineHeight: 1.35 }}>
            <span style={{ flexShrink: 0 }}>{ic}</span>
            <span>
              <span style={{ color: 'var(--ink-soft)' }}>{label}: </span>
              <span style={{ fontWeight: 500 }}>{fav[k]}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Pill({ children }) {
  return (
    <span style={{
      background: 'var(--accent-bg)', color: 'var(--accent)', fontWeight: 600,
      fontSize: 12, padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap',
    }}>{children}</span>
  )
}

function EditModal({ form, set, saving, err, onClose, onSave }) {
  const days = Array.from({ length: 31 }, (_, i) => i + 1)
  return (
    <div className="modal-back" onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 24, overflowY: 'auto',
    }}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{
        background: 'var(--surface)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)',
        width: '100%', maxWidth: 560, padding: 22,
      }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>My favorites</h2>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--ink-soft)' }}>
          Fill in whatever you like — every field is optional. Only you can edit
          your card, but everyone can see it.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
          <div className="field">
            <label>Birthday month</label>
            <select value={form.birthday_month} onChange={set('birthday_month')}>
              <option value="">—</option>
              {MONTHS.slice(1).map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Birthday day</label>
            <select value={form.birthday_day} onChange={set('birthday_day')}>
              <option value="">—</option>
              {days.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="field">
            <label>T‑shirt size</label>
            <select value={form.tshirt_size} onChange={set('tshirt_size')}>
              <option value="">—</option>
              {SIZES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Hoodie size</label>
            <select value={form.hoodie_size} onChange={set('hoodie_size')}>
              <option value="">—</option>
              {SIZES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <Text label="Favorite color(s)" v={form.favorite_colors} on={set('favorite_colors')} ph="Teal, sage green…" />
        <Text label="Favorite drink(s)" v={form.favorite_drinks} on={set('favorite_drinks')} ph="Iced chai, Diet Coke…" />
        <Text label="Favorite food" v={form.favorite_food} on={set('favorite_food')} ph="Tacos, sushi…" />
        <Text label="Favorite restaurant" v={form.favorite_restaurant} on={set('favorite_restaurant')} />
        <Text label="Favorite ice cream" v={form.favorite_ice_cream} on={set('favorite_ice_cream')} />
        <Text label="Favorite candy" v={form.favorite_candy} on={set('favorite_candy')} />
        <Text label="Favorite snack" v={form.favorite_snack} on={set('favorite_snack')} />
        <Text label="Favorite scent" v={form.favorite_scent} on={set('favorite_scent')} ph="Vanilla, fresh linen…" />
        <Text label="Coffee / drink order" v={form.coffee_order} on={set('coffee_order')} ph="If someone's doing a coffee run…" />

        <div className="field">
          <label>Hobbies & interests</label>
          <textarea value={form.hobbies} onChange={set('hobbies')} />
        </div>
        <div className="field">
          <label>Allergies / dietary needs</label>
          <textarea value={form.allergies_dietary} onChange={set('allergies_dietary')}
            placeholder="Helps when we order food for the team" />
        </div>
        <div className="field">
          <label>Fun fact about you</label>
          <textarea value={form.fun_fact} onChange={set('fun_fact')} />
        </div>

        {err && <div style={{ color: 'var(--failed)', fontSize: 13, marginBottom: 10 }}>{err}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 6 }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={onSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save my card'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Text({ label, v, on, ph }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input value={v} onChange={on} placeholder={ph || ''} />
    </div>
  )
}
