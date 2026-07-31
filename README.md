// Preload runs before the web app loads, in an isolated context.
// Kept intentionally minimal — the web app already does all the work.
// We expose a tiny, safe marker so the site can tell it's running inside
// the desktop app (useful later, e.g. to prefer OS notifications).
const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('commandCenterDesktop', {
  isDesktop: true,
  platform: process.platform
})
