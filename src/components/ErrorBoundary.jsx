import React from 'react'

// ============================================================
// ErrorBoundary
//
// A thrown error in React unmounts the WHOLE tree, leaving a blank white page
// with nothing to go on. This catches it and shows the actual error instead.
//
// Used in two places, deliberately:
//   - main.jsx wraps the entire app, so NOTHING can produce a bare white screen
//   - App.jsx wraps the routed content, so a broken page keeps the nav usable
// The inner one catches first; the outer only sees errors from the shell itself
// (providers, header, banners) — which is exactly the gap that let the push
// banner blank the app despite a boundary already existing.
// ============================================================
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Caught by ErrorBoundary:', error, info?.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    const e = this.state.error
    return (
      <div style={{ padding: 24, maxWidth: 760, fontFamily: 'system-ui, sans-serif' }}>
        <h2 style={{ margin: '0 0 6px', fontSize: 19, color: '#b91c1c' }}>
          {this.props.scope === 'root' ? 'Command Center hit an error' : 'This page hit an error'}
        </h2>
        <p style={{ margin: '0 0 14px', fontSize: 13.5, color: '#6a665e' }}>
          {this.props.scope === 'root'
            ? 'Sending the text below is enough to identify the problem.'
            : 'The rest of the app still works — use the menu to go somewhere else.'}
        </p>
        <pre style={{
          whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12.5, lineHeight: 1.5,
          background: '#f7f7f5', color: '#1a1a1a', border: '1px solid #ddd',
          borderRadius: 8, padding: 12, maxHeight: 320, overflowY: 'auto',
        }}>{String(e?.name || 'Error')}: {String(e?.message || e)}{e?.stack ? '\n\n' + e.stack : ''}</pre>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button onClick={() => { navigator.clipboard?.writeText(String(e?.stack || e?.message || e)) }}
            style={btn}>Copy error</button>
          <button onClick={() => this.setState({ error: null })} style={btn}>Try again</button>
          <button onClick={() => window.location.reload()} style={{ ...btn, background: '#0077B6', color: '#fff', border: 0 }}>
            Reload the app
          </button>
        </div>
      </div>
    )
  }
}

const btn = {
  border: '1px solid #ddd', borderRadius: 8, background: 'transparent',
  padding: '8px 14px', fontSize: 13.5, cursor: 'pointer', fontFamily: 'inherit',
}
