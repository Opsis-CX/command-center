// ============================================================
//  Scripts (/scripts) — build the guided call screens agents work from.
//  Managers only (RLS on call_scripts: can_manage_dialer()).
//
//  A script = header, alert banners, booking link, principles, steps (what to say /
//  ask / check), voicemail, objections, brand facts, zip list, qualifier fields and
//  (inbound) dispositions. Preview shows exactly what the agent sees.
//  "Used by" assigns it to outbound campaigns (dial_campaigns.script_id) and to
//  inbound menu options (inbound_lines.menu[].script_id).
// ============================================================
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import CallScreen, { MERGE_TAGS } from '../components/CallScreen'

const TONES = [['info', 'Info (blue)'], ['warn', 'Caution (amber)'], ['danger', 'Rule (red)']]
const BLOCKS = [['say', 'Say (quote)'], ['ask', 'Ask (questions)'], ['note', 'Note'], ['check', 'Checklist']]
const OUTCOMES = [['final', 'Done'], ['callback', 'Callback at a set time']]
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40)
const SAMPLE = {
  first_name: 'Jamie', last_name: 'Rivera', customer_name: 'Jamie Rivera', agent_name: 'Alex Morgan', agent_first: 'Alex',
  reason: 'a broken garage door spring', lead_source: 'Web form', menu_option: 'New business', company: 'Rivera Plumbing',
}

export default function Scripts() {
  const [list, setList] = useState(null)
  const [clients, setClients] = useState([])
  const [selId, setSelId] = useState(null)
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')

  const load = async () => {
    const { data, error } = await supabase.from('call_scripts').select('id, name, brand, kind, active, client_id, updated_at').order('name')
    if (error) setErr(error.message); else setList(data || [])
  }
  useEffect(() => {
    load()
    supabase.from('clients').select('id, name').order('name').then(({ data }) => setClients(data || []))
  }, [])

  async function create() {
    const { data, error } = await supabase.from('call_scripts').insert({
      name: 'New script', kind: 'any',
      config: { title: 'New script', steps: [{ title: 'Greet', blocks: [{ type: 'say', text: 'Hi {{first_name}}, this is {{agent_first}}…' }] }] },
    }).select('id').single()
    if (error) { setErr(error.message); return }
    await load(); setSelId(data.id)
  }

  if (err && !list) return <div style={S.error}>{err}</div>
  if (!list) return <p className="page-sub">Loading…</p>
  const shown = list.filter(s => !q || `${s.name} ${s.brand || ''}`.toLowerCase().includes(q.toLowerCase()))

  if (selId) return <Editor id={selId} clients={clients} onBack={() => { setSelId(null); load() }} onDuplicated={id => { load(); setSelId(id) }} />

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <h1 className="page-title">Scripts</h1>
          <p className="page-sub" style={{ margin: 0 }}>The guided call screens agents see on inbound and outbound calls. Assign each one to campaigns or inbound menu options.</p>
        </div>
        <button onClick={create} style={S.primary}>+ New script</button>
      </div>
      {err && <div style={S.error}>{err}</div>}
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search scripts…" style={{ ...S.input, maxWidth: 320, marginBottom: 12 }} />
      <div style={{ display: 'grid', gap: 8 }}>
        {shown.map(s => (
          <button key={s.id} onClick={() => setSelId(s.id)} style={S.row}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700 }}>{s.name}</div>
              <div style={{ fontSize: 12.5, opacity: 0.65 }}>{[s.brand, clients.find(c => c.id === s.client_id)?.name].filter(Boolean).join(' · ')}</div>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={S.tag}>{s.kind === 'any' ? 'Inbound + outbound' : s.kind === 'inbound' ? 'Inbound' : 'Outbound'}</span>
              {!s.active && <span style={{ ...S.tag, background: 'rgba(100,116,139,0.2)' }}>Off</span>}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

// =====================================================================
function Editor({ id, clients, onBack, onDuplicated }) {
  const [row, setRow] = useState(null)
  const [tab, setTab] = useState('header')
  const [preview, setPreview] = useState(false)
  const [msg, setMsg] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase.from('call_scripts').select('*').eq('id', id).single().then(({ data }) => setRow(data))
  }, [id])
  if (!row) return <p className="page-sub">Loading…</p>

  const cfg = row.config || {}
  const setCfg = p => setRow(r => ({ ...r, config: { ...(r.config || {}), ...p } }))
  const set = p => setRow(r => ({ ...r, ...p }))

  async function save() {
    setSaving(true); setMsg('')
    const { error } = await supabase.from('call_scripts').update({
      name: row.name, brand: row.brand || null, client_id: row.client_id || null, kind: row.kind, active: row.active,
      config: row.config, updated_at: new Date().toISOString(),
    }).eq('id', row.id)
    setSaving(false); setMsg(error ? error.message : 'Saved.')
  }
  async function duplicate() {
    const { data, error } = await supabase.from('call_scripts').insert({
      name: `${row.name} (copy)`, brand: row.brand, client_id: row.client_id, kind: row.kind, config: row.config,
    }).select('id').single()
    if (error) setMsg(error.message); else onDuplicated(data.id)
  }

  const tabs = [['header', 'Header & alerts'], ['steps', 'Steps'], ['voicemail', 'Voicemail & objections'], ['facts', 'Facts & zips'],
    ['fields', 'Qualifiers'], ...(row.kind !== 'outbound' ? [['dispositions', 'Dispositions']] : []), ['used', 'Used by']]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <button onClick={onBack} style={S.btn}>← All scripts</button>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {msg && <span style={{ fontSize: 13 }}>{msg}</span>}
          <button onClick={() => setPreview(p => !p)} style={S.btn}>{preview ? 'Back to editing' : 'Preview'}</button>
          <button onClick={duplicate} style={S.btn}>Duplicate</button>
          <button onClick={save} disabled={saving} style={S.primary}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>

      {preview ? (
        <CallScreen script={cfg} preview
          ctx={{ ...SAMPLE, brand: row.brand || 'Brand', callback_number: cfg.callback_number || '' }}
          context={[{ label: 'Customer', value: SAMPLE.customer_name }, { label: 'Agent', value: SAMPLE.agent_name },
            { label: 'Brand', value: row.brand }, { label: 'What they asked about', value: SAMPLE.reason }]}
          contact={{ phone: '5555550123', email: 'jamie@example.com', address: '12 Sample St, Springfield' }}
          callBar={<div style={{ fontSize: 13 }}><strong>Preview</strong> — sample customer. Merge tags are filled with sample values.</div>}
          showVoicemail />
      ) : (
        <>
          <div style={S.card}>
            <div style={S.grid3}>
              <L label="Script name"><input style={S.input} value={row.name || ''} onChange={e => set({ name: e.target.value })} /></L>
              <L label="Brand (shown on the screen)"><input style={S.input} value={row.brand || ''} onChange={e => set({ brand: e.target.value })} /></L>
              <L label="Client"><select style={S.input} value={row.client_id || ''} onChange={e => set({ client_id: e.target.value || null })}>
                <option value="">—</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></L>
              <L label="Used for"><select style={S.input} value={row.kind} onChange={e => set({ kind: e.target.value })}>
                <option value="inbound">Inbound calls</option><option value="outbound">Outbound campaigns</option><option value="any">Both</option></select></L>
              <label style={{ ...S.lbl, display: 'flex', gap: 8, alignItems: 'center', marginTop: 22 }}>
                <input type="checkbox" checked={!!row.active} onChange={e => set({ active: e.target.checked })} /> Active
              </label>
            </div>
            <div style={{ fontSize: 12, opacity: 0.65, marginTop: 6 }}>
              Merge tags: {MERGE_TAGS.map(t => <code key={t} style={S.code}>{`{{${t}}}`}</code>)} — plus any qualifier key or lead field (e.g. <code style={S.code}>{'{{zip}}'}</code>).
            </div>
          </div>

          <div style={S.tabs}>
            {tabs.map(([k, l]) => <button key={k} onClick={() => setTab(k)} style={{ ...S.tab, ...(tab === k ? S.tabOn : {}) }}>{l}</button>)}
          </div>

          {tab === 'header' && (
            <div style={S.card}>
              <div style={S.grid2}>
                <L label="Small line above the title"><input style={S.input} value={cfg.eyebrow || ''} onChange={e => setCfg({ eyebrow: e.target.value })} placeholder="Guided call script · Brand" /></L>
                <L label="Title"><input style={S.input} value={cfg.title || ''} onChange={e => setCfg({ title: e.target.value })} /></L>
              </div>
              <L label="Subtitle"><input style={S.input} value={cfg.subtitle || ''} onChange={e => setCfg({ subtitle: e.target.value })} /></L>
              <div style={S.grid3}>
                <L label="Goal / KPI chip"><input style={S.input} value={cfg.kpi || ''} onChange={e => setCfg({ kpi: e.target.value })} /></L>
                <L label="Callback number (brand)"><input style={S.input} value={cfg.callback_number || ''} onChange={e => setCfg({ callback_number: e.target.value })} /></L>
                <L label="Knowledge Base link"><input style={S.input} value={cfg.knowledge_url || ''} onChange={e => setCfg({ knowledge_url: e.target.value })} placeholder="/knowledge" /></L>
                <L label="Booking button label"><input style={S.input} value={cfg.booking_label || ''} onChange={e => setCfg({ booking_label: e.target.value })} /></L>
                <L label="Booking link"><input style={S.input} value={cfg.booking_url || ''} onChange={e => setCfg({ booking_url: e.target.value })} placeholder="https://…" /></L>
              </div>
              <H>Alert banners</H>
              <ListEditor items={cfg.alerts || []} onChange={v => setCfg({ alerts: v })} newItem={{ label: '', text: '', tone: 'warn' }}
                cols={[{ k: 'label', l: 'Tag', w: 150 }, { k: 'text', l: 'Text' }, { k: 'tone', l: 'Color', w: 150, opts: TONES }]} />
              <H>Principles (the cards under the steps)</H>
              <ListEditor items={cfg.principles || []} onChange={v => setCfg({ principles: v })} newItem={{ title: '', text: '' }}
                cols={[{ k: 'title', l: 'Title', w: 200 }, { k: 'text', l: 'Text' }]} />
            </div>
          )}

          {tab === 'steps' && <StepsEditor steps={cfg.steps || []} onChange={v => setCfg({ steps: v })} />}

          {tab === 'voicemail' && (
            <div style={S.card}>
              <H>Voicemail (outbound — shown when no one answers)</H>
              <L label="What to say"><textarea style={{ ...S.input, minHeight: 80 }} value={cfg.voicemail?.text || ''} onChange={e => setCfg({ voicemail: { ...(cfg.voicemail || {}), text: e.target.value } })} /></L>
              <div style={S.grid2}>
                <L label="Keep it under (seconds)"><input type="number" style={S.input} value={cfg.voicemail?.max_seconds || ''} onChange={e => setCfg({ voicemail: { ...(cfg.voicemail || {}), max_seconds: Number(e.target.value) || null } })} /></L>
                <L label="Do not…"><input style={S.input} value={cfg.voicemail?.dont || ''} onChange={e => setCfg({ voicemail: { ...(cfg.voicemail || {}), dont: e.target.value } })} /></L>
              </div>
              <H>If they say… (objections)</H>
              <ListEditor items={cfg.objections || []} onChange={v => setCfg({ objections: v })} newItem={{ q: '', a: '' }}
                cols={[{ k: 'q', l: 'They say', w: 260 }, { k: 'a', l: 'You say', area: true }]} />
            </div>
          )}

          {tab === 'facts' && (
            <div style={S.card}>
              <H>Facts (right column)</H>
              <ListEditor items={cfg.facts || []} onChange={v => setCfg({ facts: v })} newItem={{ label: '', value: '' }}
                cols={[{ k: 'label', l: 'Label', w: 200 }, { k: 'value', l: 'Value' }, { k: 'tone', l: 'Highlight', w: 150, opts: [['', 'None'], ...TONES] }]} />
              <H>Service-area zip codes</H>
              <ZipEditor zips={cfg.zips || []} onChange={v => setCfg({ zips: v })} />
            </div>
          )}

          {tab === 'fields' && (
            <div style={S.card}>
              <p style={S.help}>Fields the agent fills in during the call. They're saved with the disposition and can be used as merge tags.</p>
              <ListEditor items={cfg.fields || []} onChange={v => setCfg({ fields: v.map(f => ({ ...f, key: f.key || slug(f.label) })) })}
                newItem={{ label: '', type: 'text', required: false }}
                cols={[{ k: 'label', l: 'Label' }, { k: 'type', l: 'Type', w: 140, opts: [['text', 'Text'], ['select', 'Pick list']] },
                  { k: 'options', l: 'Pick-list options (comma separated)', list: true }, { k: 'required', l: 'Required', w: 90, bool: true }]} />
            </div>
          )}

          {tab === 'dispositions' && (
            <div style={S.card}>
              <p style={S.help}>Inbound calls using this script end with one of these. "Callback at a set time" drops them into the line's Callbacks campaign. (Outbound campaigns keep their own dispositions on the Campaigns page.)</p>
              <ListEditor items={cfg.dispositions || []} onChange={v => setCfg({ dispositions: v.map(d => ({ ...d, code: d.code || slug(d.label) })) })}
                newItem={{ label: '', outcome: 'final', is_contact: true }}
                cols={[{ k: 'label', l: 'Label' }, { k: 'outcome', l: 'Then', w: 200, opts: OUTCOMES }, { k: 'is_contact', l: 'Spoke with them', w: 130, bool: true }, { k: 'color', l: 'Color', w: 110, color: true }]} />
            </div>
          )}

          {tab === 'used' && <UsedBy script={row} />}
        </>
      )}
    </div>
  )
}

// ---------- steps ----------
function StepsEditor({ steps, onChange }) {
  const upd = (i, p) => onChange(steps.map((s, j) => (j === i ? { ...s, ...p } : s)))
  const move = (i, d) => { const n = [...steps]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); onChange(n) }
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {steps.map((s, i) => (
        <div key={i} style={S.card}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <strong style={{ width: 24 }}>{i + 1}.</strong>
            <input style={{ ...S.input, marginTop: 0, fontWeight: 700 }} value={s.title || ''} onChange={e => upd(i, { title: e.target.value })} placeholder="Step title" />
            <button style={S.icon} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
            <button style={S.icon} disabled={i === steps.length - 1} onClick={() => move(i, 1)}>↓</button>
            <button style={S.icon} onClick={() => onChange(steps.filter((_, j) => j !== i))}>✕</button>
          </div>
          {(s.blocks || []).map((b, j) => {
            const updB = p => upd(i, { blocks: s.blocks.map((x, k) => (k === j ? { ...x, ...p } : x)) })
            const multi = b.type === 'ask' || b.type === 'check'
            return (
              <div key={j} style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'flex-start' }}>
                <select style={{ ...S.input, width: 150, marginTop: 0 }} value={b.type} onChange={e => {
                  const t = e.target.value
                  const m = t === 'ask' || t === 'check'
                  updB(m ? { type: t, items: b.items || (b.text ? [b.text] : []), text: undefined } : { type: t, text: b.text || (b.items || []).join(' '), items: undefined })
                }}>{BLOCKS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                <textarea style={{ ...S.input, marginTop: 0, minHeight: multi ? 70 : 46 }}
                  value={multi ? (b.items || []).join('\n') : (b.text || '')}
                  placeholder={multi ? 'One per line' : ''}
                  onChange={e => updB(multi ? { items: e.target.value.split('\n') } : { text: e.target.value })}
                  onBlur={e => multi && updB({ items: e.target.value.split('\n').map(x => x.trim()).filter(Boolean) })} />
                <button style={S.icon} onClick={() => upd(i, { blocks: s.blocks.filter((_, k) => k !== j) })}>✕</button>
              </div>
            )
          })}
          <button style={{ ...S.btn, marginTop: 8 }} onClick={() => upd(i, { blocks: [...(s.blocks || []), { type: 'say', text: '' }] })}>+ Add block</button>
        </div>
      ))}
      <button style={S.btn} onClick={() => onChange([...steps, { title: `Step ${steps.length + 1}`, blocks: [] }])}>+ Add step</button>
    </div>
  )
}

// ---------- zips ----------
function ZipEditor({ zips, onChange }) {
  const [text, setText] = useState(zips.join(', '))
  useEffect(() => { setText(zips.join(', ')) }, [zips.length]) // eslint-disable-line
  const parse = t => [...new Set((t.match(/\b\d{5}\b/g) || []))]
  return (
    <div>
      <p style={S.help}>Paste zip codes in any format (commas, spaces, new lines, straight from a spreadsheet). {zips.length} on file.</p>
      <textarea style={{ ...S.input, minHeight: 120, fontFamily: 'monospace' }} value={text} onChange={e => setText(e.target.value)} onBlur={() => onChange(parse(text))} />
    </div>
  )
}

// ---------- used by ----------
function UsedBy({ script }) {
  const [camps, setCamps] = useState(null)
  const [lines, setLines] = useState([])
  const [msg, setMsg] = useState('')
  const load = async () => {
    const [{ data: c }, { data: l }] = await Promise.all([
      supabase.from('dial_campaigns').select('id, name, brand, status, script_id').neq('status', 'archived').order('name'),
      supabase.from('inbound_lines').select('id, name, menu').order('created_at'),
    ])
    setCamps(c || []); setLines(l || [])
  }
  useEffect(() => { load() }, [])
  if (!camps) return <p className="page-sub">Loading…</p>

  async function toggleCampaign(c, on) {
    const { error } = await supabase.from('dial_campaigns').update({ script_id: on ? script.id : null }).eq('id', c.id)
    setMsg(error ? error.message : 'Saved.'); load()
  }
  async function toggleOption(line, key, on) {
    const menu = (line.menu || []).map(m => (m.key === key ? { ...m, script_id: on ? script.id : null } : m))
    const { error } = await supabase.from('inbound_lines').update({ menu, updated_at: new Date().toISOString() }).eq('id', line.id)
    setMsg(error ? error.message : 'Saved.'); load()
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {msg && <div style={{ fontSize: 13 }}>{msg}</div>}
      {script.kind !== 'inbound' && (
        <div style={S.card}>
          <H>Outbound campaigns</H>
          {camps.map(c => {
            const mine = c.script_id === script.id
            return (
              <label key={c.id} style={S.check}>
                <input type="checkbox" checked={mine} onChange={e => toggleCampaign(c, e.target.checked)} />
                <span>{c.name}{c.brand ? ` · ${c.brand}` : ''} <span style={{ opacity: 0.55, fontSize: 12 }}>({c.status}{c.script_id && !mine ? ' · uses another script' : ''})</span></span>
              </label>
            )
          })}
          {!camps.length && <div style={S.help}>No campaigns yet.</div>}
        </div>
      )}
      {script.kind !== 'outbound' && (
        <div style={S.card}>
          <H>Inbound menu options</H>
          {lines.map(l => (
            <div key={l.id} style={{ marginBottom: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>{l.name}</div>
              {(l.menu || []).map(m => {
                const mine = m.script_id === script.id
                return (
                  <label key={m.key} style={S.check}>
                    <input type="checkbox" checked={mine} onChange={e => toggleOption(l, m.key, e.target.checked)} />
                    <span>{m.key}. {m.label} {m.script_id && !mine && <span style={{ opacity: 0.55, fontSize: 12 }}>(uses another script)</span>}</span>
                  </label>
                )
              })}
            </div>
          ))}
        </div>
      )}
      <p style={S.help}>Each campaign or menu option uses one script; ticking it here replaces whatever it used before.</p>
    </div>
  )
}

// ---------- generic list editor ----------
function ListEditor({ items, onChange, cols, newItem }) {
  const upd = (i, p) => onChange(items.map((x, j) => (j === i ? { ...x, ...p } : x)))
  return (
    <div>
      {items.map((it, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 8, flexWrap: 'wrap' }}>
          {cols.map(c => (
            <div key={c.k} style={{ flex: c.w ? `0 0 ${c.w}px` : '1 1 200px', minWidth: 0 }}>
              {i === 0 && <div style={{ fontSize: 11.5, fontWeight: 700, opacity: 0.6, marginBottom: 2 }}>{c.l}</div>}
              {c.opts ? (
                <select style={{ ...S.input, marginTop: 0 }} value={it[c.k] || ''} onChange={e => upd(i, { [c.k]: e.target.value || undefined })}>
                  {c.opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              ) : c.bool ? (
                <input type="checkbox" checked={!!it[c.k]} onChange={e => upd(i, { [c.k]: e.target.checked })} style={{ marginTop: 10 }} />
              ) : c.color ? (
                <input type="color" value={it[c.k] || '#0e7490'} onChange={e => upd(i, { [c.k]: e.target.value })} style={{ ...S.input, marginTop: 0, padding: 2, height: 36 }} />
              ) : c.list ? (
                <input style={{ ...S.input, marginTop: 0 }} value={(it[c.k] || []).join(', ')} disabled={it.type !== 'select'}
                  onChange={e => upd(i, { [c.k]: e.target.value.split(',').map(x => x.trimStart()) })}
                  onBlur={e => upd(i, { [c.k]: e.target.value.split(',').map(x => x.trim()).filter(Boolean) })} />
              ) : c.area ? (
                <textarea style={{ ...S.input, marginTop: 0, minHeight: 46 }} value={it[c.k] || ''} onChange={e => upd(i, { [c.k]: e.target.value })} />
              ) : (
                <input style={{ ...S.input, marginTop: 0 }} value={it[c.k] || ''} onChange={e => upd(i, { [c.k]: e.target.value })} />
              )}
            </div>
          ))}
          <div style={{ display: 'flex', gap: 4, marginTop: i === 0 ? 18 : 0 }}>
            <button style={S.icon} disabled={i === 0} onClick={() => { const n = [...items]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; onChange(n) }}>↑</button>
            <button style={S.icon} onClick={() => onChange(items.filter((_, j) => j !== i))}>✕</button>
          </div>
        </div>
      ))}
      <button style={{ ...S.btn, marginTop: 10 }} onClick={() => onChange([...items, { ...newItem }])}>+ Add</button>
    </div>
  )
}

const L = ({ label, children }) => <label style={S.lbl}>{label}{children}</label>
const H = ({ children }) => <div style={S.h}>{children}</div>

const S = {
  card: { padding: 14, borderRadius: 12, border: '1px solid rgba(100,116,139,0.25)', background: 'var(--card, transparent)', marginBottom: 10 },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 12, border: '1px solid rgba(100,116,139,0.25)', background: 'var(--card, transparent)', color: 'inherit', cursor: 'pointer', textAlign: 'left', fontSize: 14 },
  tag: { padding: '3px 8px', borderRadius: 6, fontSize: 11.5, fontWeight: 700, background: 'rgba(8,145,178,0.12)', color: '#0e7490', whiteSpace: 'nowrap' },
  primary: { padding: '9px 16px', borderRadius: 10, border: 'none', background: '#0891b2', color: '#fff', fontWeight: 800, fontSize: 13.5, cursor: 'pointer' },
  btn: { padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(100,116,139,0.35)', background: 'transparent', color: 'inherit', fontWeight: 700, fontSize: 13, cursor: 'pointer' },
  icon: { padding: '6px 9px', borderRadius: 8, border: '1px solid rgba(100,116,139,0.3)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12 },
  input: { display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 4, padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(100,116,139,0.35)', background: 'transparent', color: 'inherit', fontSize: 14, fontFamily: 'inherit' },
  lbl: { display: 'block', fontSize: 12.5, fontWeight: 700, margin: '6px 0' },
  h: { fontWeight: 800, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.4, color: '#0e7490', margin: '16px 0 4px' },
  help: { fontSize: 13, opacity: 0.75, margin: '0 0 8px' },
  grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 },
  grid3: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 },
  tabs: { display: 'flex', gap: 4, borderBottom: '1px solid rgba(100,116,139,0.25)', margin: '6px 0 12px', flexWrap: 'wrap' },
  tab: { padding: '8px 12px', border: 'none', background: 'none', color: 'inherit', cursor: 'pointer', fontWeight: 600, fontSize: 13.5, borderBottom: '2px solid transparent', opacity: 0.7 },
  tabOn: { borderBottomColor: '#0891b2', opacity: 1, color: '#0891b2' },
  check: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5, margin: '6px 0', cursor: 'pointer' },
  code: { margin: '0 3px', padding: '1px 5px', borderRadius: 4, background: 'rgba(100,116,139,0.15)', fontSize: 11.5 },
  error: { padding: '8px 10px', borderRadius: 8, background: 'rgba(220,38,38,0.1)', color: '#b91c1c', fontSize: 13, marginBottom: 10 },
}
