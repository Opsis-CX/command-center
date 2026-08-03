// src/components/HelpAssistant.jsx
// In-app Help assistant — a floating chat widget that answers questions and
// helps staff troubleshoot on their own. Read-only: it explains the app and
// can look up the signed-in user's OWN data, but cannot change anything.
//
// Wiring (2 steps):
//   1) Save this file as src/components/HelpAssistant.jsx
//   2) In src/App.jsx, render it once inside the authed app, e.g. just before
//      the closing tag of AuthedApp:  <HelpAssistant />
//
// It calls the Supabase edge function `help-assistant` (already deployed).
// If your project imports supabase/useAuth from different paths, adjust the two
// import lines below to match your app.
import React, { useState, useRef, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';

const TEAL = '#0f766e';

export default function HelpAssistant() {
  const auth = useAuth() || {};
  const { appRole, isAdmin, isClientPortal } = auth;

  // Show for non-agent staff only (and never in the client portal).
  const roles = String(appRole || '').split(',').map((r) => r.trim()).filter(Boolean);
  const isNonAgent = isAdmin || roles.some((r) => r && r !== 'agent');
  const show = isNonAgent && !isClientPortal;

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]); // {role:'user'|'assistant', content}
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scroller = useRef(null);

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [messages, loading, open]);

  if (!show) return null;

  const suggestions = [
    'How do I release or trade an interval?',
    'Why is a page or button missing for me?',
    "What's on my schedule today?",
    'How do scorecard tiers and release times work?',
  ];

  async function send(text) {
    const q = (text ?? input).trim();
    if (!q || loading) return;
    const next = [...messages, { role: 'user', content: q }];
    setMessages(next);
    setInput('');
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('help-assistant', {
        body: { messages: next },
      });
      let reply = data?.reply;
      if (!reply) {
        // Surface a handled error body if present.
        let msg = data?.error;
        if (!msg && error?.context?.json) {
          try { msg = (await error.context.json())?.error; } catch { /* ignore */ }
        }
        reply = msg || 'Sorry — I had trouble answering just now. Please try again, or contact an admin if it’s urgent.';
      }
      setMessages((m) => [...m, { role: 'assistant', content: reply }]);
    } catch (e) {
      setMessages((m) => [...m, {
        role: 'assistant',
        content: 'Sorry — I couldn’t reach the assistant. Please try again in a moment.',
      }]);
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  return (
    <>
      {/* Launcher button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open Help"
          style={{
            position: 'fixed', right: 20, bottom: 20, zIndex: 9998,
            background: TEAL, color: '#fff', border: 'none', borderRadius: 999,
            padding: '12px 18px', fontSize: 15, fontWeight: 600, cursor: 'pointer',
            boxShadow: '0 6px 20px rgba(0,0,0,0.18)', display: 'flex',
            alignItems: 'center', gap: 8,
          }}
        >
          <span style={{ fontSize: 18 }}>💬</span> Help
        </button>
      )}

      {/* Panel */}
      {open && (
        <div
          style={{
            position: 'fixed', right: 20, bottom: 20, zIndex: 9999,
            width: 'min(400px, calc(100vw - 40px))',
            height: 'min(600px, calc(100vh - 40px))',
            background: '#fff', borderRadius: 16, overflow: 'hidden',
            boxShadow: '0 12px 40px rgba(0,0,0,0.25)', display: 'flex',
            flexDirection: 'column', border: '1px solid #e5e7eb',
          }}
        >
          {/* Header */}
          <div style={{
            background: TEAL, color: '#fff', padding: '14px 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Command Center Help</div>
              <div style={{ fontSize: 12, opacity: 0.85 }}>Ask a question or describe an issue</div>
            </div>
            <button
              onClick={() => setOpen(false)} aria-label="Close Help"
              style={{ background: 'transparent', border: 'none', color: '#fff',
                fontSize: 22, cursor: 'pointer', lineHeight: 1 }}
            >×</button>
          </div>

          {/* Messages */}
          <div ref={scroller} style={{ flex: 1, overflowY: 'auto', padding: 16, background: '#f8fafc' }}>
            {messages.length === 0 && (
              <div>
                <div style={{ fontSize: 14, color: '#334155', marginBottom: 12 }}>
                  Hi{auth?.user?.email ? '' : ' there'}! I can explain how the Command Center works and
                  help you troubleshoot on your own. I can’t change anything — I’m just here to help.
                </div>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>Try asking:</div>
                {suggestions.map((s) => (
                  <button key={s} onClick={() => send(s)} style={{
                    display: 'block', width: '100%', textAlign: 'left', margin: '6px 0',
                    padding: '10px 12px', background: '#fff', border: '1px solid #e2e8f0',
                    borderRadius: 10, fontSize: 13, color: '#0f172a', cursor: 'pointer',
                  }}>{s}</button>
                ))}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} style={{
                display: 'flex',
                justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
                marginBottom: 10,
              }}>
                <div style={{
                  maxWidth: '85%', padding: '10px 12px', borderRadius: 12, fontSize: 14,
                  lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  background: m.role === 'user' ? TEAL : '#fff',
                  color: m.role === 'user' ? '#fff' : '#0f172a',
                  border: m.role === 'user' ? 'none' : '1px solid #e2e8f0',
                }}>{m.content}</div>
              </div>
            ))}
            {loading && (
              <div style={{ fontSize: 13, color: '#64748b', padding: '4px 2px' }}>Thinking…</div>
            )}
          </div>

          {/* Composer */}
          <div style={{ borderTop: '1px solid #e5e7eb', padding: 10, background: '#fff' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Type your question…"
                rows={1}
                style={{
                  flex: 1, resize: 'none', border: '1px solid #cbd5e1', borderRadius: 10,
                  padding: '10px 12px', fontSize: 14, fontFamily: 'inherit', maxHeight: 120,
                  outline: 'none',
                }}
              />
              <button
                onClick={() => send()} disabled={loading || !input.trim()}
                style={{
                  background: TEAL, color: '#fff', border: 'none', borderRadius: 10,
                  padding: '10px 14px', fontSize: 14, fontWeight: 600,
                  cursor: loading || !input.trim() ? 'default' : 'pointer',
                  opacity: loading || !input.trim() ? 0.5 : 1,
                }}
              >Send</button>
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6, textAlign: 'center' }}>
              Read-only helper · can’t make changes · only Becky builds features
            </div>
          </div>
        </div>
      )}
    </>
  );
}
