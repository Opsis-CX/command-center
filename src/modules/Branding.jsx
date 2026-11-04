import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { hasPerm, usingNewPermissions } from '../lib/permissions'
import { useAuth } from '../lib/auth'
import { loadBranding, applyBranding, inkOn } from '../lib/branding'

// ============================================================
// 🎨 Branding (Configuration, 2026-11-04) — the company's own look for Command Center:
// name, logos (main · dark backgrounds · square icon) and brand/sidebar colors, with a live
// preview. Saved to org_branding and applied app-wide. Clients can have their own branding for
// their portal and reports (Clients → a client → 🎨 Branding); unbranded clients use this.
// ============================================================

export const PRESETS = ['#0077B6', '#0F766E', '#2563EB', '#7C3AED', '#DB2777', '#DC2626', '#EA580C', '#B45309', '#16A34A', '#111827']
export const SIDEBAR_PRESETS = ['#015974', '#0B1F2A', '#111827', '#14302A', '#1E1B4B', '#3B0764', '#7F1D1D']
const hexOk = (h) => /^#[0-9a-f]{6}$/i.test(h || '')

export const BRAND_CSS = `
.br-in { width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 9px; font: inherit; font-size: 13.5px; background: var(--surface); color: var(--ink); box-sizing: border-box; }
.br-sw { width: 26px; height: 26px; border-radius: 7px; border: 2px solid transparent; cursor: pointer; padding: 0; }
.br-sw.on { border-color: var(--ink); }
.br-logo { width: 100%; height: 86px; border: 1px dashed var(--line); border-radius: 10px; display: grid; place-items: center; overflow: hidden; }
.br-logo img { max-width: 90%; max-height: 70px; object-fit: contain; }
.br-msg { padding: 9px 12px; border-radius: 9px; font-size: 13px; margin-bottom: 12px; }
.br-msg.ok { background: #ECFDF5; color: #047857; } .br-msg.err { background: #FEF2F2; color: #B91C1C; }
`

// A color field: swatches + picker + hex box.
export function ColorField({ label, value, onChange, presets, disabled, hint }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {presets.map(c => <button key={c} type="button" disabled={disabled} className={'br-sw' + ((value || '').toLowerCase() === c.toLowerCase() ? ' on' : '')} style={{ background: c, boxShadow: c === '#FFFFFF' ? 'inset 0 0 0 1px var(--line)' : 'none' }} onClick={() => onChange(c)} aria-label={c} />)}
        <input type="color" disabled={disabled} value={hexOk(value) ? value : '#0077B6'} onChange={e => onChange(e.target.value)} style={{ width: 34, height: 28, border: 0, background: 'transparent', cursor: 'pointer' }} aria-label={`${label} picker`} />
        <input className="br-in" style={{ width: 100 }} disabled={disabled} value={value || ''} placeholder="#0077B6" maxLength={7}
          onChange={e => onChange(e.target.value.startsWith('#') ? e.target.value : '#' + e.target.value)} aria-label={`${label} hex`} />
        {value && !disabled && <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => onChange('')}>Default</button>}
      </div>
      {hint && <div className="page-sub" style={{ fontSize: 12, marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

// Upload an image to portal-assets/<folder>/<name>-<ts>.<ext>; returns its public URL.
export async function uploadBrandImage(file, folder, name) {
  if (!/^image\/(png|jpe?g|webp|svg\+xml)$/.test(file.type)) throw new Error('Use a PNG, JPG, WebP or SVG image.')
  if (file.size > 2 * 1024 * 1024) throw new Error('That image is over 2 MB — try a smaller one.')
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '')
  const path = `${folder}/${name}-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('portal-assets').upload(path, file, { contentType: file.type, upsert: false })
  if (error) throw error
  return supabase.storage.from('portal-assets').getPublicUrl(path).data.publicUrl
}

export function LogoField({ label, hint, url, onFile, onRemove, disabled, dark }) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>{label}</div>
      <div className="page-sub" style={{ fontSize: 12, marginBottom: 6, minHeight: 30 }}>{hint}</div>
      <div className="br-logo" style={{ background: dark ? '#111827' : 'var(--canvas)' }}>
        {url ? <img src={url} alt={label} /> : <span className="page-sub" style={{ fontSize: 12, color: dark ? '#94A3B8' : undefined }}>No image yet</span>}
      </div>
      {!disabled && (
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <label className="btn btn-ghost" style={{ fontSize: 12.5, padding: '5px 12px', cursor: 'pointer' }}>
            {url ? 'Replace' : 'Upload'}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f) }} />
          </label>
          {url && <button className="btn btn-ghost" style={{ fontSize: 12.5, padding: '5px 12px' }} onClick={onRemove}>Remove</button>}
        </div>
      )}
    </div>
  )
}

// Mini preview: sidebar + header + a button, in the chosen colors.
export function BrandPreview({ name, logo, primary, sidebar }) {
  const p = hexOk(primary) ? primary : '#0077B6', sb = hexOk(sidebar) ? sidebar : '#0B1F2A'
  const sideInk = inkOn(sb)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden', minHeight: 190, background: 'var(--surface)' }}>
      <div style={{ background: sb, color: sideInk, padding: 12, display: 'grid', alignContent: 'start', gap: 8 }}>
        <div style={{ height: 34, display: 'grid', placeItems: 'center' }}>{logo ? <img src={logo} alt="" style={{ maxWidth: '100%', maxHeight: 34, objectFit: 'contain' }} /> : <b style={{ fontSize: 13 }}>{name || 'Your company'}</b>}</div>
        {['Home', 'Chat', 'Reporting', 'Projects'].map((x, i) => (
          <div key={x} style={{ fontSize: 12, padding: '5px 8px', borderRadius: 7, background: i === 2 ? `color-mix(in srgb, ${p} 30%, transparent)` : 'transparent', opacity: i === 2 ? 1 : .8 }}>{x}</div>
        ))}
      </div>
      <div style={{ padding: 14 }}>
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>Reporting</div>
        <div className="page-sub" style={{ fontSize: 12, marginBottom: 10 }}>This is how {name || 'your company'}'s Command Center looks.</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ background: p, color: inkOn(p), borderRadius: 8, padding: '6px 12px', fontSize: 12.5, fontWeight: 700 }}>Primary button</span>
          <span style={{ color: p, fontSize: 12.5, fontWeight: 700 }}>A link</span>
          <span style={{ background: `color-mix(in srgb, ${p} 13%, transparent)`, color: p, borderRadius: 999, padding: '2px 9px', fontSize: 11.5, fontWeight: 700 }}>Selected</span>
        </div>
      </div>
    </div>
  )
}

export default function Branding() {
  const { isAdmin } = useAuth()
  const canEdit = usingNewPermissions() ? hasPerm('admin.settings') : isAdmin
  const [b, setB] = useState(null)
  const [saved, setSaved] = useState(null)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    supabase.from('org_branding').select('*').maybeSingle().then(({ data, error }) => {
      if (error) setMsg({ kind: 'err', text: 'Branding isn\'t set up in this environment yet.' })
      setB(data || {}); setSaved(data || {})
    })
  }, [])
  // live-preview the colors across the whole app while editing; undo if leaving unsaved
  useEffect(() => { if (b) applyBranding(b) }, [b])
  useEffect(() => () => { loadBranding(true).catch(() => {}) }, [])

  const dirty = b && saved && ['company_name', 'logo_url', 'logo_dark_url', 'icon_url', 'primary_color', 'sidebar_color'].some(k => (b[k] || '') !== (saved[k] || ''))
  async function upload(field, file) {
    setMsg(null)
    try { const url = await uploadBrandImage(file, 'company', field.replace('_url', '')); setB(x => ({ ...x, [field]: url })) }
    catch (e) { setMsg({ kind: 'err', text: String(e.message || e) }) }
  }
  async function save() {
    for (const k of ['primary_color', 'sidebar_color']) if (b[k] && !hexOk(b[k])) return setMsg({ kind: 'err', text: 'Colors need to look like #0077B6.' })
    setBusy(true); setMsg(null)
    const patch = { company_name: (b.company_name || '').trim() || null, logo_url: b.logo_url || null, logo_dark_url: b.logo_dark_url || null,
      icon_url: b.icon_url || null, primary_color: b.primary_color || null, sidebar_color: b.sidebar_color || null, updated_at: new Date().toISOString() }
    const { error } = await supabase.from('org_branding').update(patch).eq('id', true)
    setBusy(false)
    if (error) return setMsg({ kind: 'err', text: /row-level|permission/i.test(error.message) ? "You don't have permission to change branding." : error.message })
    setSaved({ ...b, ...patch }); await loadBranding(true)
    setMsg({ kind: 'ok', text: 'Saved — everyone sees the new branding the next time a page loads.' })
  }

  if (!b) return <p className="page-sub">Loading branding…</p>
  return (
    <div style={{ maxWidth: 1100 }}>
      <style>{BRAND_CSS}</style>
      <h1 className="page-title">🎨 Branding</h1>
      <p className="page-sub">Make Command Center look like your company. Your logo and colors show for everyone. {canEdit ? 'Changes preview live — save to keep them.' : 'Only Administrators can change these.'}</p>
      {msg && <div className={'br-msg ' + msg.kind}>{msg.text}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) minmax(320px, 1fr)', gap: 16, alignItems: 'start' }}>
        <div className="card" style={{ padding: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Company name</div>
          <input className="br-in" maxLength={60} disabled={!canEdit} value={b.company_name || ''} placeholder="e.g. Opsis CX" onChange={e => setB(x => ({ ...x, company_name: e.target.value }))} />
          <div className="page-sub" style={{ fontSize: 12, margin: '4px 0 16px' }}>Shown in the browser tab and anywhere your company is named.</div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginBottom: 18 }}>
            <LogoField label="Logo" hint="For light backgrounds." url={b.logo_url} disabled={!canEdit} onFile={f => upload('logo_url', f)} onRemove={() => setB(x => ({ ...x, logo_url: null }))} />
            <LogoField label="Logo for dark" hint="Used on the sidebar. Optional." url={b.logo_dark_url} dark disabled={!canEdit} onFile={f => upload('logo_dark_url', f)} onRemove={() => setB(x => ({ ...x, logo_dark_url: null }))} />
            <LogoField label="Square icon" hint="Browser tab & app icon." url={b.icon_url} disabled={!canEdit} onFile={f => upload('icon_url', f)} onRemove={() => setB(x => ({ ...x, icon_url: null }))} />
          </div>

          <ColorField label="Brand color" value={b.primary_color} presets={PRESETS} disabled={!canEdit} onChange={v => setB(x => ({ ...x, primary_color: v }))}
            hint="Buttons, links and highlights. Text on top switches to dark or light automatically so it stays readable." />
          <ColorField label="Sidebar color" value={b.sidebar_color} presets={SIDEBAR_PRESETS} disabled={!canEdit} onChange={v => setB(x => ({ ...x, sidebar_color: v }))}
            hint={hexOk(b.sidebar_color) && inkOn(b.sidebar_color) !== '#ffffff' ? '⚠️ This color is quite light — the menu text is white, so a darker color will be easier to read.' : 'The menu text is white, so darker colors work best.'} />

          {canEdit && (
            <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" disabled={busy || !dirty} onClick={save}>{busy ? 'Saving…' : 'Save branding'}</button>
              {dirty && <button className="btn btn-ghost" onClick={() => { setB(saved); setMsg(null) }}>Discard changes</button>}
              <button className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => setB(x => ({ ...x, logo_url: null, logo_dark_url: null, icon_url: null, primary_color: null, sidebar_color: null }))}>Reset to Command Center default</button>
            </div>
          )}
        </div>
        <div style={{ position: 'sticky', top: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: 8 }}>Preview</div>
          <BrandPreview name={b.company_name} logo={b.logo_dark_url || b.logo_url} primary={b.primary_color} sidebar={b.sidebar_color} />
          <p className="page-sub" style={{ fontSize: 12, marginTop: 8 }}>Clients can have their own branding for their portal and reports — set it on Clients → a client → 🎨 Branding. Clients without their own use yours.</p>
        </div>
      </div>
    </div>
  )
}
