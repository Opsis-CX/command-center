import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'

// ============================================================
// PROPOSAL BUILDER
// A deal-linked proposal editor that recreates the OpsisCX proposal
// prototype (design/copy/print CSS are final — see the handoff README).
// Opens over the Sales pipeline from a deal, prefills from that deal,
// autosaves to the proposals row, and reports status changes up so the
// pipeline can advance the deal's stage. Export = browser print → 3-page PDF.
//
// All styles are scoped under `.pb-root` so the prototype's generic class
// names (.card/.block/.sheet…) never collide with the app's own CSS.
// ============================================================

const CALENDLY = 'https://calendly.com/opsiscx-support/30min'
const CONTACT_PHONE = '656-234-8009'
const CONTACT_EMAIL = 'hello@opsiscx.com'

const STATUS_META = {
  draft:    { label: 'Draft',    bg: '#eef2f4', fg: '#475b63' },
  sent:     { label: 'Sent',     bg: '#e3f2fd', fg: '#0d47a1' },
  accepted: { label: 'Accepted', bg: '#e8f5e9', fg: '#1b5e20' },
  declined: { label: 'Declined', bg: '#fdecea', fg: '#b71c1c' },
}

const todayLong = () => new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

// The editable template. Prefill fields are overwritten from the deal on create.
function templateContent(deal, userName) {
  return {
    preparedForName: deal?.contact_person || 'Client Name',
    headline: 'Your front office, handled — so you can stay in the field.',
    subhead: 'A phone answering service for busy season and a back-office team running your systems year-round, under one OpsisCX roof.',
    companyName: deal?.organization || 'Company Name',
    preparedBy: deal?.owner_name || userName || 'OpsisCX',
    date: todayLong(),
    situationLead: 'Running the whole operation between the two of you — social media, booking, follow-up, and sales tracking — works until busy season hits. Then the phone becomes the bottleneck, and the back-office work that keeps jobs moving competes with the work in front of you.',
    quote: '“When I’m in busy season a phone answering service would be cool, but someone on the back end doing all my fancy set would work best.”',
    quoteAttribution: '— In your own words',
    proposeHeadline: 'We don’t just advise — we build, run, and answer the phone.',
    services: [
      { tag: 'Inbound · Revenue Recovery', title: 'Phone Answering & Booking', body: 'U.S.-based agents answer every call in your busy season, qualify the job, and book it straight into your calendar.' },
      { tag: 'Systems Implementation', title: 'Back-Office Setup', body: 'CRM, booking, social scheduling, and sales tracking configured and connected — the “fancy set” running without you.' },
      { tag: 'Process Optimization', title: 'Follow-Up & Sales Tracking', body: 'Automated follow-up, review requests, and a clean pipeline so no lead or invoice slips through the cracks.' },
      { tag: 'Fractional Ops Leadership', title: 'Someone On The Back End', body: 'A dedicated operator handling the day-to-day admin at flexible weekly hours — no hire, no payroll burden.' },
    ],
    umbrellaHeadline: 'One back office. Every business under it.',
    umbrellaLead: 'The same engine we run for one company scales to the businesses around you. Each keeps its own brand and phone presence out front, while a shared operations backbone handles the systems, booking, and follow-up behind the scenes.',
    hubLabel: 'OpsisCX Operations Backbone',
    brands: [
      { name: deal?.organization || 'Your Business', type: 'Your Industry' },
      { name: 'Neighbor Co.', type: 'Home Services' },
      { name: '+ Your Network', type: 'Add businesses' },
    ],
    fineprint: 'Final pricing confirmed after a short discovery call. No long-term contract — scale up or down with your season.',
    ctaHeadline: 'Let’s map it to your season.',
    ctaBody: 'A 30-minute discovery call is all it takes to turn this into a plan built around your busy months.',
    contactName: deal?.owner_name || userName || 'OpsisCX',
  }
}
const templatePricing = () => ([
  { tag: 'Seasonal Phone Coverage', price: 'From $X/mo', description: 'Trained U.S.-based agents answer, qualify, and book — spun up for busy season, wound down when it slows.' },
  { tag: 'Back-Office Operations', price: 'From $X/mo', description: 'Systems, booking, social, and sales tracking set up and run for you — flexible weekly hours, no payroll burden.' },
])

// Uncontrolled contenteditable: seeds text once on mount (the builder is keyed
// by proposal id, so it re-seeds when a different proposal loads), then reports
// edits without being re-rendered from state — so the caret never jumps.
function Edit({ tag = 'div', value, onInput, className, style }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current && ref.current.innerText !== (value ?? '')) ref.current.innerText = value ?? ''
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const Tag = tag
  return (
    <Tag ref={ref} className={className} style={style} contentEditable suppressContentEditableWarning
      onInput={e => onInput(e.currentTarget.innerText)} />
  )
}

export default function ProposalBuilder({ deal, userName, onClose, onStatusChange }) {
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [proposal, setProposal] = useState(null)   // { id, status }
  const contentRef = useRef(null)
  const pricingRef = useRef(null)
  const saveTimer = useRef(null)
  const [savedAt, setSavedAt] = useState('')

  // Load the deal's proposal, or create a prefilled draft.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true); setErr('')
      try {
        const { data: existing, error } = await supabase
          .from('proposals').select('*').eq('deal_id', deal.id)
          .order('created_at', { ascending: false }).limit(1)
        if (error) throw error
        let row = existing && existing[0]
        if (!row) {
          const content = templateContent(deal, userName)
          const pricing = templatePricing()
          const { data: created, error: ce } = await supabase.from('proposals').insert({
            deal_id: deal.id,
            client_name: deal.organization || null,
            contact_name: deal.contact_person || null,
            company_name: deal.organization || null,
            prepared_by: userName || deal.owner_name || null,
            status: 'draft', content, pricing,
          }).select('*').single()
          if (ce) throw ce
          row = created
        }
        if (cancelled) return
        contentRef.current = { ...templateContent(deal, userName), ...(row.content || {}) }
        pricingRef.current = (row.pricing && row.pricing.length) ? row.pricing : templatePricing()
        setProposal({ id: row.id, status: row.status })
      } catch (e) { if (!cancelled) setErr(e.message || 'Could not load the proposal') }
      finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true; if (saveTimer.current) clearTimeout(saveTimer.current) }
  }, [deal.id, userName])

  const persist = useCallback(async (patch = {}) => {
    if (!proposal) return
    const payload = { content: contentRef.current, pricing: pricingRef.current, ...patch }
    const { error } = await supabase.from('proposals').update(payload).eq('id', proposal.id)
    if (error) { setErr(error.message); return }
    setErr(''); setSavedAt(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))
  }, [proposal])

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => persist(), 800)
  }, [persist])

  // field editors that write into the refs then debounce-save
  const setC = (key) => (val) => { contentRef.current[key] = val; scheduleSave() }
  const setService = (i, key) => (val) => { contentRef.current.services[i][key] = val; scheduleSave() }
  const setBrand = (i, key) => (val) => { contentRef.current.brands[i][key] = val; scheduleSave() }
  const setPrice = (i, key) => (val) => { pricingRef.current[i][key] = val; scheduleSave() }

  async function markStatus(status) {
    const patch = { status }
    if (status === 'sent') patch.sent_at = new Date().toISOString()
    if (status === 'accepted') patch.accepted_at = new Date().toISOString()
    await persist(patch)
    setProposal(p => ({ ...p, status }))
    onStatusChange?.(status)   // let the pipeline advance the deal's stage
  }

  function exportPdf() {
    document.body.classList.add('pb-printing')
    const cleanup = () => { document.body.classList.remove('pb-printing'); window.removeEventListener('afterprint', cleanup) }
    window.addEventListener('afterprint', cleanup)
    window.print()
    setTimeout(cleanup, 1500)   // Safari sometimes skips afterprint
  }

  if (loading) return <Overlay onClose={onClose}><div style={{ color: '#cfe6ee', padding: 40 }}>Loading proposal…</div></Overlay>
  if (err && !proposal) return <Overlay onClose={onClose}><div style={{ color: '#ffb4a8', padding: 40 }}>Couldn’t open the proposal: {err}</div></Overlay>

  const c = contentRef.current
  const p = pricingRef.current
  const sm = STATUS_META[proposal.status] || STATUS_META.draft

  return (
    <Overlay onClose={onClose}>
      <style>{PB_CSS}</style>

      {/* Chrome — hidden on print */}
      <div className="pb-chrome">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <button className="pb-x" onClick={onClose} title="Close">✕</button>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#eaf6fa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Proposal — {deal.organization || 'Deal'}</div>
            <div style={{ fontSize: 12, color: '#8fb3bc' }}>
              <span className="pb-badge" style={{ background: sm.bg, color: sm.fg }}>{sm.label}</span>
              {savedAt && <span style={{ marginLeft: 10 }}>Saved {savedAt}</span>}
              {err && <span style={{ marginLeft: 10, color: '#ffb4a8' }}>{err}</span>}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {proposal.status !== 'sent' && proposal.status !== 'accepted' && (
            <button className="pb-btn pb-send" onClick={() => markStatus('sent')} title="Email this proposal to the deal contact from hello@opsiscx.com">✉ Send to client</button>
          )}
          {proposal.status === 'sent' && (
            <>
              <button className="pb-btn pb-ok" onClick={() => markStatus('accepted')}>Mark Accepted</button>
              <button className="pb-btn pb-ghost" onClick={() => markStatus('declined')}>Declined</button>
            </>
          )}
          <button className="pb-btn pb-pdf" onClick={exportPdf}>Save as PDF ↓</button>
        </div>
      </div>

      {/* The proposal document */}
      <div className="pb-root">
        <div className="sheet pb-sheet" id="pb-sheet">
          <div className="cover">
            <img className="print-logo" src="/opsis-logo.png" alt="OpsisCX" />
            <div className="eyebrow">Digital Proposal · Prepared for <Edit tag="span" value={c.preparedForName} onInput={setC('preparedForName')} /></div>
            <Edit tag="h1" className="headline" value={c.headline} onInput={setC('headline')} />
            <Edit tag="p" className="subhead" value={c.subhead} onInput={setC('subhead')} />
            <div className="meta">
              <div><div className="lbl">Company</div><Edit className="val" value={c.companyName} onInput={setC('companyName')} /></div>
              <div><div className="lbl">Prepared by</div><Edit className="val" value={c.preparedBy} onInput={setC('preparedBy')} /></div>
              <div><div className="lbl">Date</div><Edit className="val" value={c.date} onInput={setC('date')} /></div>
            </div>
          </div>

          <div className="block">
            <div className="sec-eyebrow">Where You Are Today</div>
            <Edit tag="p" className="lead" value={c.situationLead} onInput={setC('situationLead')} />
            <div className="quote">
              <Edit tag="p" value={c.quote} onInput={setC('quote')} />
              <Edit tag="p" className="attr" value={c.quoteAttribution} onInput={setC('quoteAttribution')} />
            </div>
          </div>

          <div className="block alt">
            <div className="sec-eyebrow">What We Propose</div>
            <Edit tag="h2" value={c.proposeHeadline} onInput={setC('proposeHeadline')} />
            <div className="grid2">
              {c.services.map((s, i) => (
                <div className="card" key={i}>
                  <Edit className="tag" value={s.tag} onInput={setService(i, 'tag')} />
                  <Edit tag="h3" value={s.title} onInput={setService(i, 'title')} />
                  <Edit tag="p" value={s.body} onInput={setService(i, 'body')} />
                </div>
              ))}
            </div>
          </div>

          <div className="block">
            <div className="sec-eyebrow">The Umbrella Model</div>
            <Edit tag="h2" value={c.umbrellaHeadline} onInput={setC('umbrellaHeadline')} />
            <Edit tag="p" className="lead" value={c.umbrellaLead} onInput={setC('umbrellaLead')} />
            <div className="umbrella">
              <Edit className="hub" value={c.hubLabel} onInput={setC('hubLabel')} />
              <div className="stem" />
              <div className="brands">
                {c.brands.map((b, i) => (
                  <div className="brand" key={i}>
                    <Edit className="bn" value={b.name} onInput={setBrand(i, 'name')} />
                    <Edit className="bt" value={b.type} onInput={setBrand(i, 'type')} />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="block alt">
            <div className="sec-eyebrow">Investment</div>
            <div className="grid2">
              {p.map((pr, i) => (
                <div className="card" key={i}>
                  <Edit className="tag" value={pr.tag} onInput={setPrice(i, 'tag')} />
                  <Edit className="price" value={pr.price} onInput={setPrice(i, 'price')} />
                  <Edit tag="p" style={{ marginTop: 10 }} value={pr.description} onInput={setPrice(i, 'description')} />
                </div>
              ))}
            </div>
            <Edit tag="p" className="fineprint" value={c.fineprint} onInput={setC('fineprint')} />
          </div>

          <div className="cta">
            <Edit tag="h2" value={c.ctaHeadline} onInput={setC('ctaHeadline')} />
            <Edit tag="p" value={c.ctaBody} onInput={setC('ctaBody')} />
            <a className="btn" href={CALENDLY} target="_blank" rel="noreferrer">Book a Discovery Call →</a>
            <div className="contact">
              <Edit tag="span" value={c.contactName} onInput={setC('contactName')} />
              <a href={`tel:${CONTACT_PHONE.replace(/[^0-9]/g, '')}`}>{CONTACT_PHONE}</a>
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
              <span>opsiscx.com</span>
            </div>
          </div>
        </div>
      </div>
    </Overlay>
  )
}

function Overlay({ children, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  // Portal to <body> so that, on print, we can hide every other top-level node
  // and leave only the sheet in the page flow — no stray blank pages.
  return createPortal(<div className="pb-overlay">{children}</div>, document.body)
}

// Prototype CSS, scoped under `.pb-root`; overlay/chrome/print rules alongside.
const PB_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@500;600;700;800&family=Source+Sans+3:ital,wght@0,400;0,600;0,700&display=swap');
.pb-overlay{position:fixed;inset:0;z-index:1000;background:#010b0f;overflow:auto;}
.pb-chrome{position:sticky;top:0;z-index:10;display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:12px 18px;background:rgba(7,26,32,.97);border-bottom:1px solid rgba(19,217,232,.3);backdrop-filter:blur(6px);}
.pb-chrome .pb-x{background:transparent;border:1px solid rgba(19,217,232,.35);color:#cfe6ee;width:32px;height:32px;border-radius:8px;cursor:pointer;font-size:14px;}
.pb-badge{font-size:11px;font-weight:700;padding:2px 9px;border-radius:999px;}
.pb-btn{font-family:'Poppins',system-ui,sans-serif;font-weight:700;font-size:13px;border:none;cursor:pointer;border-radius:999px;padding:9px 16px;background:#0089A6;color:#fff;}
.pb-btn.pb-pdf{background:#13D9E8;color:#021116;}
.pb-btn.pb-send{background:linear-gradient(135deg,#0089A6,#13D9E8);color:#021116;box-shadow:0 0 16px rgba(19,217,232,.5);}
.pb-btn.pb-ok{background:#16A34A;color:#fff;}
.pb-btn.pb-ghost{background:transparent;color:#a9c6cd;border:1px solid rgba(19,217,232,.3);}

.pb-root{--dark:#021116;--dark2:#010b0f;--panel:#071A20;--cyan:#13D9E8;--cyan-soft:#7deef7;--teal:#0089A6;--ice:#e1f3fa;--coral:#FF7E6E;--navy:#0b3945;--text:#D5E5EA;--text-dim:#a9c6cd;--text-mute:#8fb3bc;
  font-family:'Source Sans 3',system-ui,-apple-system,BlinkMacSystemFont,sans-serif;padding:44px 20px 90px;}
.pb-root *{box-sizing:border-box;}
@keyframes pbSweep{0%{background-position:0% 50%;}50%{background-position:100% 50%;}100%{background-position:0% 50%;}}
.pb-root .sheet{max-width:880px;margin:0 auto;background:var(--dark);border:1px solid rgba(19,217,232,.18);border-radius:20px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.5);}
.pb-root [contenteditable]{outline:none;border-radius:6px;transition:box-shadow .15s,background .15s;}
.pb-root [contenteditable]:hover{box-shadow:0 0 0 2px rgba(19,217,232,.35);}
.pb-root [contenteditable]:focus{box-shadow:0 0 0 2px var(--cyan);background:rgba(19,217,232,.06);}
.pb-root .cover{position:relative;padding:40px 60px 34px;background:radial-gradient(ellipse 70% 60% at 15% 90%,rgba(19,217,232,.14) 0%,rgba(2,17,22,0) 60%),linear-gradient(160deg,#062b35 0%,#021116 70%);}
.pb-root .cover img{height:50px;width:auto;display:block;margin-bottom:26px;}
.pb-root .eyebrow{font-family:'Poppins',system-ui,sans-serif;font-size:12px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:var(--coral);}
.pb-root h1.headline{font-family:'Poppins',system-ui,sans-serif;font-size:37px;line-height:1.1;font-weight:800;margin:14px 0 16px;background:linear-gradient(110deg,#fff 20%,var(--cyan) 52%,#fff 80%);background-size:200% auto;-webkit-background-clip:text;background-clip:text;color:transparent;animation:pbSweep 7s ease infinite;}
.pb-root .subhead{font-size:17px;line-height:1.55;color:var(--text-dim);margin:0;max-width:52ch;}
.pb-root .meta{display:flex;gap:44px;margin-top:26px;flex-wrap:wrap;}
.pb-root .meta .lbl{font-family:'Poppins',system-ui,sans-serif;font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--teal);margin-bottom:4px;}
.pb-root .meta .val{font-size:16px;font-weight:700;color:var(--text);}
.pb-root .block{padding:34px 60px;border-top:1px solid rgba(19,217,232,.14);}
.pb-root .block.alt{background:var(--dark2);}
.pb-root .sec-eyebrow{font-family:'Poppins',system-ui,sans-serif;font-size:12px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--coral);margin-bottom:10px;}
.pb-root .block h2{font-family:'Poppins',system-ui,sans-serif;font-size:27px;font-weight:700;color:#fff;margin:0 0 18px;line-height:1.2;}
.pb-root .lead{font-size:17px;line-height:1.55;color:var(--text);margin:0 0 18px;}
.pb-root .quote{border-left:3px solid var(--cyan);padding:6px 0 6px 22px;background:rgba(19,217,232,.05);border-radius:0 10px 10px 0;}
.pb-root .quote p{font-size:19px;line-height:1.55;font-style:italic;color:#fff;margin:0;}
.pb-root .quote .attr{font-size:14px;color:var(--text-mute);margin:10px 0 0;font-style:normal;}
.pb-root .grid2{display:grid;grid-template-columns:1fr 1fr;gap:18px;}
.pb-root .card{background:var(--panel);border:1px solid rgba(19,217,232,.22);border-radius:14px;padding:26px 24px;}
.pb-root .card .tag{font-family:'Poppins',system-ui,sans-serif;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--cyan);margin-bottom:10px;}
.pb-root .card h3{font-family:'Poppins',system-ui,sans-serif;font-size:19px;font-weight:700;color:#fff;margin:0 0 8px;}
.pb-root .card p{font-size:15px;line-height:1.55;color:var(--text-dim);margin:0;}
.pb-root .umbrella{display:flex;flex-direction:column;align-items:center;}
.pb-root .hub{background:linear-gradient(135deg,var(--teal),var(--cyan));color:var(--dark);font-family:'Poppins',system-ui,sans-serif;font-weight:800;font-size:17px;padding:16px 40px;border-radius:12px;box-shadow:0 0 30px rgba(19,217,232,.35);}
.pb-root .stem{width:2px;height:26px;background:rgba(19,217,232,.4);}
.pb-root .brands{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;width:100%;}
.pb-root .brand{background:var(--panel);border:1px solid rgba(19,217,232,.25);border-radius:12px;padding:18px 14px;text-align:center;}
.pb-root .brand .bn{font-family:'Poppins',system-ui,sans-serif;font-size:15px;font-weight:700;color:#fff;}
.pb-root .brand .bt{font-size:13px;color:var(--text-mute);margin-top:3px;}
.pb-root .price{font-family:'Poppins',system-ui,sans-serif;font-size:38px;font-weight:800;color:#fff;}
.pb-root .fineprint{font-size:14px;color:#5f838c;margin:18px 0 0;}
.pb-root .cta{padding:36px 60px;background:radial-gradient(ellipse 70% 60% at 85% 10%,rgba(19,217,232,.12) 0%,rgba(2,17,22,0) 60%),linear-gradient(160deg,#062b35 0%,#021116 70%);border-top:1px solid rgba(19,217,232,.14);}
.pb-root .cta h2{font-family:'Poppins',system-ui,sans-serif;font-size:28px;font-weight:800;color:#fff;margin:0 0 14px;}
.pb-root .cta p{font-size:17px;line-height:1.6;color:var(--text-dim);margin:0 0 26px;max-width:54ch;}
.pb-root .btn{display:inline-block;background:var(--cyan);color:var(--dark);font-family:'Poppins',system-ui,sans-serif;font-weight:700;font-size:16px;padding:16px 36px;border-radius:999px;text-decoration:none;box-shadow:0 0 30px rgba(19,217,232,.4);}
.pb-root .contact{display:flex;gap:28px;margin-top:24px;padding-top:20px;border-top:1px solid rgba(19,217,232,.18);flex-wrap:wrap;font-size:15px;color:var(--text-mute);}
.pb-root .contact a{color:var(--cyan);text-decoration:none;}

@media print{
  @page{size:auto;margin:0.5in;}
  body.pb-printing{background:#fff!important;}
  body.pb-printing > *{display:none!important;}
  body.pb-printing > .pb-overlay{display:block!important;position:static!important;inset:auto!important;background:#fff!important;overflow:visible!important;}
  body.pb-printing .pb-chrome{display:none!important;}
  body.pb-printing .pb-root{padding:0!important;}
  body.pb-printing .pb-sheet{max-width:none;margin:0;border:none;border-radius:0;box-shadow:none;background:#fff!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}
  body.pb-printing .pb-root *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}
  body.pb-printing .pb-root .cover,body.pb-printing .pb-root .block,body.pb-printing .pb-root .block.alt,body.pb-printing .pb-root .cta{background:#fff!important;border-top:1px solid #dbe7eb!important;}
  body.pb-printing .pb-root .cover{border-top:none!important;padding-top:8px!important;}
  body.pb-printing .pb-root .eyebrow,body.pb-printing .pb-root .sec-eyebrow{color:#D9553C!important;}
  body.pb-printing .pb-root h1.headline{background:none!important;-webkit-background-clip:border-box!important;background-clip:border-box!important;color:#0b3945!important;-webkit-text-fill-color:#0b3945!important;animation:none!important;}
  body.pb-printing .pb-root .subhead,body.pb-printing .pb-root .lead,body.pb-printing .pb-root .card p,body.pb-printing .pb-root .cta p{color:#33474e!important;}
  body.pb-printing .pb-root .meta .val,body.pb-printing .pb-root .block h2,body.pb-printing .pb-root .card h3,body.pb-printing .pb-root .cta h2,body.pb-printing .pb-root .price,body.pb-printing .pb-root .brand .bn{color:#0b3945!important;}
  body.pb-printing .pb-root .meta .lbl,body.pb-printing .pb-root .card .tag,body.pb-printing .pb-root .contact a{color:#0089A6!important;}
  body.pb-printing .pb-root .quote{background:#f0f9fc!important;border-left-color:#0089A6!important;}
  body.pb-printing .pb-root .quote p{color:#0b3945!important;}
  body.pb-printing .pb-root .quote .attr,body.pb-printing .pb-root .fineprint,body.pb-printing .pb-root .brand .bt,body.pb-printing .pb-root .contact{color:#5f838c!important;}
  body.pb-printing .pb-root .card,body.pb-printing .pb-root .brand{background:#f6fbfd!important;border:1px solid #dbe7eb!important;}
  body.pb-printing .pb-root .hub{background:linear-gradient(135deg,#0089A6,#13D9E8)!important;color:#021116!important;box-shadow:none!important;}
  body.pb-printing .pb-root .stem{background:#8fb3bc!important;}
  body.pb-printing .pb-root .btn{background:#0089A6!important;color:#fff!important;box-shadow:none!important;}
  body.pb-printing .pb-root .contact{border-top:1px solid #dbe7eb!important;}
  body.pb-printing .pb-root [contenteditable]:hover,body.pb-printing .pb-root [contenteditable]:focus{box-shadow:none!important;background:transparent!important;}
  body.pb-printing .pb-root .card,body.pb-printing .pb-root .brand,body.pb-printing .pb-root .quote{break-inside:avoid;}
  body.pb-printing .pb-root .block,body.pb-printing .pb-root .cta{padding-top:24px!important;padding-bottom:24px!important;}
  body.pb-printing .pb-root .cover{padding-top:6px!important;padding-bottom:22px!important;}
}
`
