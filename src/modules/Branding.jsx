import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { hasPerm, usingNewPermissions } from '../lib/permissions'
import { useAuth } from '../lib/auth'
import NavIcon from '../components/NavIcon'
import { loadBranding, applyBranding, inkOn, FONTS, fontStack, loadFont, logoStyle, ICON_FILTERS } from '../lib/branding'

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
export function BrandPreview({ name, logo, primary, sidebar, b = {} }) {
  const p = hexOk(primary) ? primary : '#0077B6', sb = hexOk(sidebar) ? sidebar : '#0B1F2A'
  const sideInk = hexOk(b.nav_text_color) ? b.nav_text_color : inkOn(sb)
  const ls = logoStyle(b)
  if (b.nav_font) loadFont(b.nav_font)
  const scale = 0.62   // the preview sidebar is narrower than the real one
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden', minHeight: 190, background: 'var(--surface)' }}>
      <div style={{ background: sb, color: sideInk, padding: 12, display: 'grid', alignContent: 'start', gap: 8 }}>
        <div style={{ minHeight: 34, display: 'grid', placeItems: 'center' }}>{logo ? <img src={logo} alt="" style={ls ? {
            width: ls.w === 'auto' ? 'auto' : `calc(${ls.w} * ${scale})`, height: `calc(${ls.h} * ${scale})`, maxWidth: '100%', objectFit: 'contain',
            borderRadius: ls.radius, background: ls.frame, padding: ls.pad === '0' ? 0 : '6%', boxSizing: 'border-box' } : { maxWidth: '100%', maxHeight: 34, objectFit: 'contain' }} />
          : <b style={{ fontSize: 13 }}>{name || 'Your company'}</b>}</div>
        {[['🏠', 'Home'], ['💬', 'Chat'], ['📊', 'Reporting'], ['🗂️', 'Projects']].map(([ic, x], i) => (
          <div key={x} style={{ fontSize: b.nav_font_size ? b.nav_font_size * 0.86 : 12, fontFamily: fontStack(b.nav_font) || 'inherit', padding: '5px 8px', borderRadius: 7, display: 'flex', gap: 6, alignItems: 'center',
            background: i === 2 ? `color-mix(in srgb, ${p} 30%, transparent)` : 'transparent', opacity: i === 2 ? 1 : .85 }}>
            {b.nav_icon_style === 'bw' ? <NavIcon ic={ic} line size={14} /> : <span style={{ filter: ICON_FILTERS[b.nav_icon_style || 'color'] }}>{ic}</span>}{x}</div>
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

  const FIELDS = ['company_name', 'logo_url', 'logo_dark_url', 'icon_url', 'primary_color', 'sidebar_color', 'logo_size', 'logo_shape', 'logo_frame_color', 'nav_font', 'nav_font_size', 'nav_text_color', 'nav_icon_style']
  const dirty = b && saved && FIELDS.some(k => String(b[k] ?? '') !== String(saved[k] ?? ''))
  async function upload(field, file) {
    setMsg(null)
    try { const url = await uploadBrandImage(file, 'company', field.replace('_url', '')); setB(x => ({ ...x, [field]: url })) }
    catch (e) { setMsg({ kind: 'err', text: String(e.message || e) }) }
  }
  async function save() {
    for (const k of ['primary_color', 'sidebar_color', 'logo_frame_color', 'nav_text_color']) if (b[k] && !hexOk(b[k])) return setMsg({ kind: 'err', text: 'Colors need to look like #0077B6.' })
    setBusy(true); setMsg(null)
    const patch = { company_name: (b.company_name || '').trim() || null, logo_url: b.logo_url || null, logo_dark_url: b.logo_dark_url || null,
      icon_url: b.icon_url || null, primary_color: b.primary_color || null, sidebar_color: b.sidebar_color || null,
      logo_size: b.logo_size ? Number(b.logo_size) : null, logo_shape: b.logo_shape || null, logo_frame_color: b.logo_frame_color || null,
      nav_font: b.nav_font || null, nav_font_size: b.nav_font_size ? Number(b.nav_font_size) : null, nav_text_color: b.nav_text_color || null,
      nav_icon_style: b.nav_icon_style || null, updated_at: new Date().toISOString() }
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

          {/* ---- logo size + shape ---- */}
          <div style={{ borderTop: '1px solid var(--line)', margin: '6px 0 14px' }} />
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Logo size</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <span className="page-sub" style={{ fontSize: 12 }}>Small</span>
            <input type="range" min={24} max={140} step={2} disabled={!canEdit} value={b.logo_size || 64} onChange={e => setB(x => ({ ...x, logo_size: Number(e.target.value) }))} style={{ flex: 1, accentColor: 'var(--accent)' }} aria-label="Logo size" />
            <span className="page-sub" style={{ fontSize: 12 }}>Large</span>
            <span style={{ fontSize: 12.5, fontWeight: 700, minWidth: 44 }}>{b.logo_size || 64}px</span>
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Logo shape</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {[['original', 'Original', '0', 40, 24], ['square', 'Square', '3px', 30, 30], ['rounded', 'Rounded', '8px', 30, 30], ['circle', 'Circle', '50%', 30, 30], ['wide', 'Wide rectangle', '6px', 52, 22]].map(([k, l, r, w, h]) => {
              const on = (b.logo_shape || 'original') === k
              return (
                <button key={k} type="button" disabled={!canEdit} onClick={() => setB(x => ({ ...x, logo_shape: k }))}
                  style={{ border: '2px solid ' + (on ? 'var(--accent)' : 'var(--line)'), background: on ? 'var(--accent-bg)' : 'var(--surface)', borderRadius: 10, padding: '8px 10px', cursor: 'pointer', display: 'grid', justifyItems: 'center', gap: 5, fontFamily: 'inherit', fontSize: 11.5, fontWeight: 700, color: 'var(--ink)', minWidth: 74 }}>
                  <span style={{ width: w, height: h, borderRadius: r, background: k === 'original' ? 'transparent' : '#CBD5E1', border: k === 'original' ? '2px dashed #94A3B8' : 0 }} />{l}
                </button>
              )
            })}
          </div>
          {b.logo_shape && b.logo_shape !== 'original' && (
            <ColorField label="Logo frame color" value={b.logo_frame_color} presets={['#FFFFFF', '#F1F5F9', '#111827', '#015974', '#00E6E6']} disabled={!canEdit}
              onChange={v => setB(x => ({ ...x, logo_frame_color: v }))} hint="The background behind your logo inside the shape. White works for most logos." />
          )}

          {/* ---- menu: font, size, text color, icons ---- */}
          <div style={{ borderTop: '1px solid var(--line)', margin: '6px 0 14px' }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 12, marginBottom: 14 }}>
            <label style={{ fontSize: 13, fontWeight: 700 }}>Menu font
              <select className="br-in" style={{ marginTop: 6, fontFamily: fontStack(b.nav_font) || 'inherit' }} disabled={!canEdit} value={b.nav_font || ''}
                onChange={e => { loadFont(e.target.value); setB(x => ({ ...x, nav_font: e.target.value })) }}>
                {FONTS.map(f => { if (f) loadFont(f); return <option key={f} value={f} style={{ fontFamily: fontStack(f) || 'inherit' }}>{f || 'Command Center default'}</option> })}
              </select></label>
            <label style={{ fontSize: 13, fontWeight: 700 }}>Menu text size
              <select className="br-in" style={{ marginTop: 6 }} disabled={!canEdit} value={b.nav_font_size || ''} onChange={e => setB(x => ({ ...x, nav_font_size: e.target.value ? Number(e.target.value) : null }))}>
                <option value="">Default (14px)</option>
                {[12, 13, 14, 15, 16, 17, 18].map(n => <option key={n} value={n}>{n}px{n <= 12 ? ' · small' : n >= 17 ? ' · large' : ''}</option>)}
              </select></label>
          </div>
          <ColorField label="Menu text color" value={b.nav_text_color} presets={['#C7D2D6', '#FFFFFF', '#E2E8F0', '#00E6E6', '#FDE68A', '#111827']} disabled={!canEdit}
            onChange={v => setB(x => ({ ...x, nav_text_color: v }))} hint="The tab names in the sidebar. The selected tab keeps its highlight so you always know where you are." />
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Menu icons</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            {[['color', 'Color'], ['bw', 'Line icons'], ['white', 'All white'], ['black', 'All black']].map(([k, l]) => {
              const on = (b.nav_icon_style || 'color') === k
              return (
                <button key={k} type="button" disabled={!canEdit} onClick={() => setB(x => ({ ...x, nav_icon_style: k }))}
                  style={{ border: '2px solid ' + (on ? 'var(--accent)' : 'var(--line)'), background: k === 'white' ? '#1F2937' : on ? 'var(--accent-bg)' : 'var(--surface)', borderRadius: 10, padding: '7px 12px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, color: k === 'white' ? '#fff' : 'var(--ink)', display: 'grid', justifyItems: 'center', gap: 4 }}>
                  {k === 'bw'
                    ? <span style={{ display: 'flex', gap: 6 }}>{['📊', '💬', '🗂️'].map(ic => <NavIcon key={ic} ic={ic} line size={16} />)}</span>
                    : <span style={{ filter: ICON_FILTERS[k], fontSize: 16, letterSpacing: 4 }}>📊💬🗂️</span>}{l}
                </button>
              )
            })}
          </div>

          {canEdit && (
            <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" disabled={busy || !dirty} onClick={save}>{busy ? 'Saving…' : 'Save branding'}</button>
              {dirty && <button className="btn btn-ghost" onClick={() => { setB(saved); setMsg(null) }}>Discard changes</button>}
              <button className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => setB(x => ({ ...x, logo_url: null, logo_dark_url: null, icon_url: null, primary_color: null, sidebar_color: null,
                logo_size: null, logo_shape: null, logo_frame_color: null, nav_font: null, nav_font_size: null, nav_text_color: null, nav_icon_style: null }))}>Reset to Command Center default</button>
            </div>
          )}
        </div>
        <div style={{ position: 'sticky', top: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: 8 }}>Preview</div>
          <BrandPreview name={b.company_name} logo={b.logo_dark_url || b.logo_url} primary={b.primary_color} sidebar={b.sidebar_color} b={b} />
          <p className="page-sub" style={{ fontSize: 12, marginTop: 8 }}>Clients can have their own branding for their portal and reports — set it on Clients → a client → 🎨 Branding. Clients without their own use yours.</p>
        </div>
      </div>
    </div>
  )
}
