// ============================================================
// POLITE RELOADS (2026-11-11)
// A page that keeps its data fresh should not hammer the database. This helper decides WHEN a reload is allowed:
//   • never while the tab/window is hidden (nobody is looking): a page left open in the background costs nothing;
//   • bursts of "something changed" signals (live updates, the timer) are merged into ONE reload;
//   • reloads are spaced at least `minGapMs` apart, plus a little random delay (`jitterMs`) so a hundred open
//     pages don't all hit the database in the same instant (what happens at the 11:00 shift release);
//   • when the page becomes visible again after a while, it refreshes once.
// Use: const poller = createPoliteReloader(() => load(true), { pollMs: 60000 })
//      realtime handlers call poller.trigger(); on cleanup call poller.dispose().
// ============================================================

export function createPoliteReloader(fn, { minGapMs = 8000, jitterMs = 2500, pollMs = 60000, staleAfterMs = 15000 } = {}) {
  let last = Date.now()          // the page has just loaded its data, so the first reload waits a full gap
  let timer = null
  let poll = null
  let disposed = false
  const hidden = () => typeof document !== 'undefined' && document.hidden

  const run = () => {
    timer = null
    if (disposed || hidden()) return
    last = Date.now()
    fn()
  }
  // ask for a reload soon (merged with any already waiting)
  const trigger = () => {
    if (disposed || timer || hidden()) return
    const wait = Math.max(0, last + minGapMs - Date.now()) + Math.random() * jitterMs
    timer = setTimeout(run, wait)
  }
  const onVisible = () => { if (!hidden() && Date.now() - last > staleAfterMs) trigger() }

  if (pollMs) poll = setInterval(trigger, pollMs)
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
  return {
    trigger,
    dispose() {
      disposed = true
      clearTimeout(timer); clearInterval(poll)
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
    },
  }
}
