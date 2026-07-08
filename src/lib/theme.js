// ============================================================
//  THEME HELPER  (src/lib/theme.js)
//  Manages light / dark / system theme.
//  - 'system' (default): follows the device setting, no data-theme attr
//  - 'light' / 'dark': forces that theme via <html data-theme="...">
//  The choice is saved in localStorage so it sticks across sessions.
// ============================================================

const KEY = 'opsis-theme'   // stored value: 'system' | 'light' | 'dark'

export function getTheme() {
  try { return localStorage.getItem(KEY) || 'system' } catch { return 'system' }
}

export function applyTheme(theme) {
  const root = document.documentElement
  if (theme === 'light' || theme === 'dark') {
    root.setAttribute('data-theme', theme)
  } else {
    root.removeAttribute('data-theme')  // 'system' → let the media query decide
  }
}

export function setTheme(theme) {
  try { localStorage.setItem(KEY, theme) } catch { /* ignore */ }
  applyTheme(theme)
}

// Call once when the app starts so the saved choice is applied immediately.
export function initTheme() {
  applyTheme(getTheme())
}

// Cycle order for a single toggle button: System → Light → Dark → System …
export function nextTheme(current) {
  return current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system'
}

export function themeLabel(theme) {
  return theme === 'light' ? '☀️ Light' : theme === 'dark' ? '🌙 Dark' : '💻 System'
}
