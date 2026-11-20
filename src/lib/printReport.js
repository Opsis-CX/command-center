// Print / PDF for reports (Becky 11/19): print ONLY the report — no app header, sidebar or buttons — and all of it,
// not just what fits in the app's scrolling frame. Copies the report into a hidden frame with the page's styles,
// removes anything marked data-noprint, lets scroll boxes grow, then opens the print dialog.
export function printReport(node, { title = 'Report', wrap, extraCss = '' } = {}) {
  if (!node) return
  // Print from a hidden frame in this page, not a pop-up: the Command Center desktop app blocks new windows (Becky 11/20).
  const old = document.getElementById('print-report-frame'); if (old) old.remove()
  const f = document.createElement('iframe')
  f.id = 'print-report-frame'; f.setAttribute('aria-hidden', 'true')
  f.style.cssText = 'position:fixed;left:-10000px;top:0;width:1100px;height:800px;border:0;visibility:hidden'
  document.body.appendChild(f)
  const w = f.contentWindow
  const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style')).map((n) => n.outerHTML).join('\n')
  const clone = node.cloneNode(true)
  clone.querySelectorAll('[data-noprint]').forEach((n) => n.remove())
  // a <select> prints its first option, so swap each for its chosen text
  clone.querySelectorAll('select').forEach((s, i) => {
    const src = node.querySelectorAll('select')[i]
    const span = document.createElement('span'); span.textContent = src && src.selectedOptions[0] ? src.selectedOptions[0].textContent : ''
    s.replaceWith(span)
  })
  const body = wrap ? wrap(clone.outerHTML) : clone.outerHTML
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  w.document.open()
  w.document.write(`<!doctype html><html data-theme="light" style="color-scheme:light"><head><meta charset="utf-8"><title>${esc(title)}</title>${styles}
<style>
  @page { size: letter; margin: 0.45in; }
  html, body { background: #fff !important; height: auto !important; min-height: 0 !important; overflow: visible !important; color-scheme: light; }
  body { margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  * { box-shadow: none !important; }
  [style*="max-height"], [style*="overflow"] { max-height: none !important; overflow: visible !important; }
  thead { display: table-header-group; }
  tr, [data-pk], .oq-card { break-inside: avoid; page-break-inside: avoid; }
  h1, h2 { break-after: avoid; page-break-after: avoid; }
  svg { max-width: 100%; }
  ${extraCss}
</style></head><body>${body}</body></html>`)
  w.document.close()
  let done = false
  const go = () => {
    if (done) return; done = true
    try { w.focus(); w.print() } catch (e) { alert('Could not open the print dialog.') }
    setTimeout(() => f.remove(), 60000) // keep the frame while the dialog is open
  }
  // wait for the copied stylesheets and fonts before printing
  const ready = () => setTimeout(go, 500)
  if (w.document.readyState === 'complete') ready(); else w.addEventListener('load', ready)
  setTimeout(go, 2500)
}
