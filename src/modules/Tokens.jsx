import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

// ============================================================
// TOKENS — employee rewards (Connecteam Tokens, rebuilt).
//   10 tokens = $1.00.  Managers award tokens (from a per-manager
//   budget); employees redeem them for gift cards via Tremendous.
//   All balance movement goes through SECURITY DEFINER RPCs:
//     award_tokens · redeem_tokens · grant_budget · adjust_tokens
//     tokens_mark_fulfilled / tokens_refund_redemption (edge fn)
//   Gift-card fulfillment: edge function `tokens-redeem` -> Tremendous.
// ============================================================

const RATE = 10 // tokens per USD
export const usd = (tokens) => `$${(Number(tokens || 0) / RATE).toFixed(2)}`
const AWARD_ROLES = ['asc', 'certification'] // + admin (always). Budget-limited; admin is unlimited.
const REASONS = ['Recognition', 'Performance', 'Attendance', 'Contest', 'Milestone', 'Other']

function tabBtn(active) {
  return { padding: '8px 14px', border: 0, background: active ? 'var(--accent)' : 'var(--surface)', color: active ? '#fff' : 'var(--ink-soft)', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', borderRadius: 8 }
}
function fmtDate(s) {
  if (!s) return ''
  try { return new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) } catch { return s }
}
function Stat({ label, value, sub }) {
  return (
    <div className="card" style={{ flex: 1, minWidth: 150 }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-soft)' }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 800, color: 'var(--ink)', marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}
function statusBadge(s) {
  const map = { fulfilled: 'passed', pending: 'needed', failed: 'failed', refunded: 'needed' }
  return <span className={`badge ${map[s] || 'needed'}`}>{s}</span>
}

export default function Tokens() {
  const { user, isAdmin, appRole } = useAuth()
  const canAward = isAdmin || AWARD_ROLES.includes(String(appRole || '').toLowerCase())
  const [tab, setTab] = useState('wallet')

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <h1 className="page-title">Tokens</h1>
        <p className="page-sub">Earn tokens for great work and redeem them for gift cards. 10 tokens = $1.</p>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18 }}>
        <button style={tabBtn(tab === 'wallet')} onClick={() => setTab('wallet')}>My Wallet</button>
        <button style={tabBtn(tab === 'redeem')} onClick={() => setTab('redeem')}>Redeem</button>
        {canAward && <button style={tabBtn(tab === 'award')} onClick={() => setTab('award')}>Award</button>}
        <button style={tabBtn(tab === 'leaderboard')} onClick={() => setTab('leaderboard')}>Leaderboard</button>
        {isAdmin && <button style={tabBtn(tab === 'admin')} onClick={() => setTab('admin')}>Admin</button>}
      </div>

      {tab === 'wallet' && <WalletTab user={user} onRedeem={() => setTab('redeem')} />}
      {tab === 'redeem' && <RedeemTab user={user} />}
      {tab === 'award' && canAward && <AwardTab user={user} isAdmin={isAdmin} />}
      {tab === 'leaderboard' && <LeaderboardTab user={user} />}
      {tab === 'admin' && isAdmin && <AdminTab />}
    </div>
  )
}

// ---------------------------------------------------------------- WALLET
function WalletTab({ user, onRedeem }) {
  const [wallet, setWallet] = useState(null)
  const [txns, setTxns] = useState([])
  const [budget, setBudget] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: w }, { data: t }, { data: b }] = await Promise.all([
      supabase.from('token_wallets').select('*').eq('profile_id', user.id).maybeSingle(),
      supabase.from('token_transactions').select('*').eq('profile_id', user.id).order('created_at', { ascending: false }).limit(60),
      supabase.from('token_budgets').select('allocated, spent').eq('manager_id', user.id).maybeSingle(),
    ])
    setWallet(w || { balance: 0, lifetime_earned: 0, lifetime_redeemed: 0 })
    setTxns(t || [])
    setBudget(b)
    setLoading(false)
  }, [user.id])
  useEffect(() => { load() }, [load])

  if (loading) return <div className="card">Loading…</div>
  return (
    <div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <Stat label="Balance" value={wallet.balance} sub={`${usd(wallet.balance)} to redeem`} />
        <Stat label="Lifetime earned" value={wallet.lifetime_earned} sub={usd(wallet.lifetime_earned)} />
        <Stat label="Lifetime redeemed" value={wallet.lifetime_redeemed} sub={usd(wallet.lifetime_redeemed)} />
        {budget && <Stat label="Team budget left" value={budget.allocated - budget.spent} sub={`${usd(budget.allocated - budget.spent)} of ${budget.allocated} to award`} />}
      </div>
      <button className="btn btn-cta" style={{ marginBottom: 18 }} onClick={onRedeem} disabled={wallet.balance <= 0}>
        Redeem tokens →
      </button>
      <div className="card">
        <div style={{ fontWeight: 700, marginBottom: 10 }}>History</div>
        {txns.length === 0 && <div style={{ color: 'var(--ink-soft)', fontSize: 14 }}>No token activity yet. Earn some by doing great work!</div>}
        {txns.map(t => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{txLabel(t)}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{fmtDate(t.created_at)}{t.note ? ` · ${t.note}` : ''}</div>
            </div>
            <div style={{ fontWeight: 800, fontSize: 15, color: t.delta >= 0 ? 'var(--passed, #16a34a)' : 'var(--failed, #dc2626)' }}>
              {t.delta >= 0 ? '+' : ''}{t.delta}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
function txLabel(t) {
  if (t.kind === 'award') return `Awarded${t.reason ? ` · ${t.reason}` : ''}`
  if (t.kind === 'redeem') return `Redeemed${t.note ? ` · ${t.note}` : ''}`
  if (t.kind === 'redeem_refund') return 'Redemption refunded'
  if (t.kind === 'adjustment') return `Adjustment${t.note ? ` · ${t.note}` : ''}`
  return t.kind
}

// ---------------------------------------------------------------- REDEEM
function RedeemTab({ user }) {
  const [catalog, setCatalog] = useState([])
  const [balance, setBalance] = useState(0)
  const [redemptions, setRedemptions] = useState([])
  const [loading, setLoading] = useState(true)
  const [picking, setPicking] = useState(null) // reward being redeemed
  const [q, setQ] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: c }, { data: w }, { data: r }] = await Promise.all([
      supabase.from('token_rewards_catalog').select('*').eq('active', true).order('sort_order'),
      supabase.from('token_wallets').select('balance').eq('profile_id', user.id).maybeSingle(),
      supabase.from('token_redemptions').select('*').eq('profile_id', user.id).order('created_at', { ascending: false }).limit(20),
    ])
    setCatalog(c || []); setBalance(w?.balance || 0); setRedemptions(r || [])
    setLoading(false)
  }, [user.id])
  useEffect(() => { load() }, [load])

  if (loading) return <div className="card">Loading…</div>
  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ fontSize: 14 }}>Balance: <b>{balance} tokens</b> <span style={{ color: 'var(--ink-soft)' }}>({usd(balance)})</span></div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={`Search ${catalog.length} gift cards…`}
          style={{ marginLeft: 'auto', minWidth: 240, padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 14, background: 'var(--surface)', color: 'var(--ink)', outline: 'none' }} />
      </div>
      {(() => {
        const filtered = catalog.filter(rw => rw.brand.toLowerCase().includes(q.trim().toLowerCase()))
        return (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12, marginBottom: 22 }}>
              {filtered.map(rw => {
                const affordable = balance >= rw.min_tokens
                return (
                  <div key={rw.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 6, opacity: affordable ? 1 : 0.55, padding: 14 }}>
                    {rw.image_url
                      ? <img src={rw.image_url} alt={rw.brand} loading="lazy" style={{ width: '100%', height: 92, objectFit: 'contain', borderRadius: 8, background: '#fff', border: '1px solid var(--line)' }} />
                      : <div style={{ height: 92, borderRadius: 8, background: 'var(--canvas)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, textAlign: 'center', padding: 6 }}>{rw.brand}</div>}
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{rw.brand}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 'auto' }}>From {rw.min_tokens} tokens ({usd(rw.min_tokens)})</div>
                    <button className="btn btn-primary" disabled={!affordable} onClick={() => setPicking(rw)}>
                      {affordable ? 'Redeem' : 'Not enough tokens'}
                    </button>
                  </div>
                )
              })}
            </div>
            {catalog.length === 0 && <div className="card">No rewards available yet.</div>}
            {catalog.length > 0 && filtered.length === 0 && <div className="card">No gift cards match “{q}”.</div>}
          </>
        )
      })()}

      <div className="card">
        <div style={{ fontWeight: 700, marginBottom: 10 }}>My redemptions</div>
        {redemptions.length === 0 && <div style={{ color: 'var(--ink-soft)', fontSize: 14 }}>No redemptions yet.</div>}
        {redemptions.map(r => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{r.brand} · {usd(r.tokens_spent)}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{fmtDate(r.created_at)} → {r.delivery_email}{r.error ? ` · ${r.error}` : ''}</div>
            </div>
            {r.redemption_link
              ? <a className="badge passed" href={r.redemption_link} target="_blank" rel="noreferrer">open card</a>
              : statusBadge(r.status)}
          </div>
        ))}
      </div>

      {picking && <RedeemModal reward={picking} balance={balance} user={user} onClose={() => setPicking(null)} onDone={() => { setPicking(null); load() }} />}
    </div>
  )
}

function RedeemModal({ reward, balance, user, onClose, onDone }) {
  const cap = Math.min(reward.max_tokens || balance, balance)
  const [tokens, setTokens] = useState(reward.min_tokens)
  const [email, setEmail] = useState(user?.email || '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  async function submit() {
    setBusy(true); setMsg(null)
    try {
      const { data, error } = await supabase.rpc('redeem_tokens', {
        p_reward_id: reward.id, p_tokens: Number(tokens), p_delivery_email: email.trim(),
      })
      if (error) throw error
      // tokens are now reserved; ask the edge function to place the Tremendous order
      const { data: fx, error: fe } = await supabase.functions.invoke('tokens-redeem', {
        body: { redemption_id: data.redemption_id },
      })
      if (fe) { setMsg({ ok: false, text: 'Order is queued but the gift-card service could not be reached. Your tokens are safe — an admin will follow up.' }); }
      else if (fx?.error) { setMsg({ ok: false, text: fx.refunded ? `${fx.error}` : `Could not fulfill: ${fx.error}` }); }
      else { setMsg({ ok: true, text: `Success! Your ${reward.brand} gift card (${usd(tokens)}) is on its way to ${email}.` }); }
      setTimeout(onDone, 1600)
    } catch (e) {
      setMsg({ ok: false, text: e.message || 'Redemption failed' })
    } finally { setBusy(false) }
  }

  return (
    <div className="modal-back open" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>Redeem {reward.brand}</h2>
        {msg
          ? <div style={{ padding: '14px 0', color: msg.ok ? 'var(--passed, #16a34a)' : 'var(--failed, #dc2626)', fontWeight: 600 }}>{msg.text}</div>
          : <>
            <div className="field">
              <label>Amount (tokens) — {usd(tokens)}</label>
              <input type="number" min={reward.min_tokens} max={cap} step={reward.step_tokens} value={tokens}
                onChange={e => setTokens(e.target.value)} />
              <div className="hint">Min {reward.min_tokens}, in steps of {reward.step_tokens}. You have {balance} tokens.</div>
            </div>
            <div className="field">
              <label>Deliver gift card to (email)</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
              <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
              <button className="btn btn-cta" onClick={submit}
                disabled={busy || Number(tokens) < reward.min_tokens || Number(tokens) > cap || (Number(tokens) % reward.step_tokens) !== 0 || !email.includes('@')}>
                {busy ? 'Processing…' : `Redeem ${usd(tokens)}`}
              </button>
            </div>
          </>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- AWARD
function AwardTab({ user, isAdmin }) {
  const [people, setPeople] = useState([])
  const [budget, setBudget] = useState(null)
  const [recent, setRecent] = useState([])
  const [form, setForm] = useState({ recipient: '', tokens: 100, reason: 'Recognition', note: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const load = useCallback(async () => {
    const [{ data: p }, { data: b }, { data: r }] = await Promise.all([
      supabase.from('profiles').select('id, full_name, role').neq('id', user.id).order('full_name'),
      supabase.from('token_budgets').select('*').eq('manager_id', user.id).maybeSingle(),
      supabase.from('token_transactions').select('*, profiles!token_transactions_profile_id_fkey(full_name)').eq('actor_id', user.id).eq('kind', 'award').order('created_at', { ascending: false }).limit(15),
    ])
    setPeople((p || []).filter(x => x.role !== null))
    setBudget(b)
    setRecent(r || [])
  }, [user.id])
  useEffect(() => { load() }, [load])

  const remaining = budget ? budget.allocated - budget.spent : null

  async function submit() {
    setBusy(true); setMsg(null)
    try {
      const { data, error } = await supabase.rpc('award_tokens', {
        p_recipient: form.recipient, p_tokens: Number(form.tokens),
        p_reason: form.reason, p_note: form.note || null,
      })
      if (error) throw error
      setMsg({ ok: true, text: `Awarded ${form.tokens} tokens (${usd(form.tokens)})!` })
      setForm(f => ({ ...f, recipient: '', note: '' }))
      load()
    } catch (e) { setMsg({ ok: false, text: e.message || 'Award failed' }) }
    finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 420px) 1fr', gap: 18, alignItems: 'start' }}>
      <div className="card">
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Award tokens</div>
        <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 12 }}>
          {budget
            ? <>Budget remaining: <b>{remaining} tokens</b> ({usd(remaining)}) of {budget.allocated}</>
            : isAdmin ? 'Admins can award without a budget.' : 'No budget allocated yet — ask an admin.'}
        </div>
        <div className="field">
          <label>Recipient</label>
          <select value={form.recipient} onChange={e => setForm(f => ({ ...f, recipient: e.target.value }))}>
            <option value="">Choose a team member…</option>
            {people.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Tokens — {usd(form.tokens)}</label>
          <input type="number" min={1} step={10} value={form.tokens} onChange={e => setForm(f => ({ ...f, tokens: e.target.value }))} />
        </div>
        <div className="field">
          <label>Reason</label>
          <select value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}>
            {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Note (optional)</label>
          <textarea value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="100% interval coverage this week 🎉" />
        </div>
        {msg && <div style={{ marginBottom: 10, color: msg.ok ? 'var(--passed, #16a34a)' : 'var(--failed, #dc2626)', fontWeight: 600, fontSize: 13.5 }}>{msg.text}</div>}
        <button className="btn btn-primary" onClick={submit}
          disabled={busy || !form.recipient || Number(form.tokens) <= 0 || (!isAdmin && (remaining == null || Number(form.tokens) > remaining))}>
          {busy ? 'Awarding…' : 'Award tokens'}
        </button>
      </div>

      <div className="card">
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Recent awards you gave</div>
        {recent.length === 0 && <div style={{ color: 'var(--ink-soft)', fontSize: 14 }}>No awards yet.</div>}
        {recent.map(t => (
          <div key={t.id} style={{ display: 'flex', gap: 12, padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{t.profiles?.full_name || 'Team member'} · {t.reason || 'Recognition'}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{fmtDate(t.created_at)}{t.note ? ` · ${t.note}` : ''}</div>
            </div>
            <div style={{ fontWeight: 800, color: 'var(--passed, #16a34a)' }}>+{t.delta}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- LEADERBOARD
function LeaderboardTab({ user }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    supabase.rpc('token_leaderboard').then(({ data }) => { setRows(data || []); setLoading(false) })
  }, [])
  if (loading) return <div className="card">Loading…</div>
  const medals = ['🥇', '🥈', '🥉']
  return (
    <div className="card">
      <div style={{ fontWeight: 700, marginBottom: 12 }}>Lifetime tokens earned</div>
      {rows.length === 0 && <div style={{ color: 'var(--ink-soft)', fontSize: 14 }}>No tokens awarded yet.</div>}
      {rows.map((r, i) => (
        <div key={r.profile_id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--line)', background: r.profile_id === user.id ? 'var(--canvas)' : 'transparent' }}>
          <div style={{ width: 34, textAlign: 'center', fontSize: i < 3 ? 20 : 14, fontWeight: 700, color: 'var(--ink-soft)' }}>{medals[i] || i + 1}</div>
          <div style={{ flex: 1, fontWeight: 600 }}>{r.full_name}{r.profile_id === user.id ? ' (you)' : ''}</div>
          <div style={{ fontWeight: 800 }}>{r.lifetime_earned} <span style={{ color: 'var(--ink-soft)', fontWeight: 500, fontSize: 13 }}>{usd(r.lifetime_earned)}</span></div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- ADMIN
function AdminTab() {
  const [sub, setSub] = useState('budgets')
  const [bal, setBal] = useState(null)         // { available_amount, pending_amount, currency } | { error }
  const [balLoading, setBalLoading] = useState(true)

  const loadBal = useCallback(async () => {
    setBalLoading(true)
    try {
      const { data, error } = await supabase.functions.invoke('tokens-redeem', { body: { action: 'balance' } })
      if (error || data?.error) setBal({ error: data?.error || error.message })
      else setBal(data)
    } catch (e) { setBal({ error: e.message }) }
    finally { setBalLoading(false) }
  }, [])
  useEffect(() => { loadBal() }, [loadBal])

  const avail = bal && !bal.error ? Number(bal.available_amount ?? 0) : null
  const pending = bal && !bal.error ? Number(bal.pending_amount ?? 0) : 0
  const low = avail != null && avail < 50

  return (
    <div>
      {/* Tremendous available balance — how much is left to send as real gift cards */}
      <div className="card" style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Available to send (Tremendous balance)</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: bal?.error ? 'var(--ink-soft)' : low ? '#b71c1c' : 'var(--passed, #16a34a)' }}>
            {balLoading ? '…' : bal?.error ? '—' : `$${avail.toFixed(2)}`}
          </div>
          {!balLoading && !bal?.error && pending > 0 && <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>+ ${pending.toFixed(2)} pending</div>}
          {bal?.error && <div style={{ fontSize: 12, color: 'var(--failed, #dc2626)' }}>{bal.error}</div>}
        </div>
        <button className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={loadBal} disabled={balLoading}>↻ Refresh</button>
      </div>
      {low && !bal?.error && <div style={{ marginBottom: 14, fontSize: 13, color: '#b71c1c', fontWeight: 600 }}>⚠ Low balance — top up in Tremendous → Billing → Balance → Add funds.</div>}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {['budgets', 'catalog', 'adjust', 'redemptions', 'settings'].map(s => (
          <button key={s} style={{ ...tabBtn(sub === s), fontSize: 12.5, padding: '6px 12px' }} onClick={() => setSub(s)}>
            {({ budgets: 'Budgets', catalog: 'Catalog', adjust: 'Adjustments', redemptions: 'Redemptions', settings: 'Tremendous' })[s]}
          </button>
        ))}
      </div>
      {sub === 'budgets' && <AdminBudgets />}
      {sub === 'catalog' && <AdminCatalog />}
      {sub === 'adjust' && <AdminAdjust />}
      {sub === 'redemptions' && <AdminRedemptions />}
      {sub === 'settings' && <AdminSettings />}
    </div>
  )
}

function AdminBudgets() {
  const [managers, setManagers] = useState([])
  const [budgets, setBudgets] = useState([])
  const [form, setForm] = useState({ manager: '', tokens: 1000, note: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const load = useCallback(async () => {
    const [{ data: p }, { data: b }] = await Promise.all([
      supabase.from('profiles').select('id, full_name, role').in('role', ['admin', ...AWARD_ROLES]).order('full_name'),
      supabase.from('token_budgets').select('*, profiles!token_budgets_manager_id_fkey(full_name)'),
    ])
    setManagers(p || []); setBudgets(b || [])
  }, [])
  useEffect(() => { load() }, [load])

  async function grant() {
    setBusy(true); setMsg(null)
    try {
      const { error } = await supabase.rpc('grant_budget', { p_manager: form.manager, p_tokens: Number(form.tokens), p_note: form.note || null })
      if (error) throw error
      setMsg({ ok: true, text: 'Budget updated.' }); setForm(f => ({ ...f, note: '' })); load()
    } catch (e) { setMsg({ ok: false, text: e.message }) } finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 380px) 1fr', gap: 18, alignItems: 'start' }}>
      <div className="card">
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Allocate budget</div>
        <div className="field">
          <label>Manager</label>
          <select value={form.manager} onChange={e => setForm(f => ({ ...f, manager: e.target.value }))}>
            <option value="">Choose…</option>
            {managers.map(m => <option key={m.id} value={m.id}>{m.full_name} ({m.role})</option>)}
          </select>
        </div>
        <div className="field">
          <label>Tokens to add — {usd(form.tokens)}</label>
          <input type="number" step={100} value={form.tokens} onChange={e => setForm(f => ({ ...f, tokens: e.target.value }))} />
          <div className="hint">Use a negative number to reduce a budget.</div>
        </div>
        <div className="field">
          <label>Note (optional)</label>
          <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="Q3 recognition budget" />
        </div>
        {msg && <div style={{ marginBottom: 10, color: msg.ok ? 'var(--passed,#16a34a)' : 'var(--failed,#dc2626)', fontWeight: 600, fontSize: 13.5 }}>{msg.text}</div>}
        <button className="btn btn-primary" onClick={grant} disabled={busy || !form.manager || !Number(form.tokens)}>Update budget</button>
      </div>
      <div className="card">
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Current budgets</div>
        {budgets.length === 0 && <div style={{ color: 'var(--ink-soft)', fontSize: 14 }}>No budgets allocated yet.</div>}
        {budgets.map(b => (
          <div key={b.manager_id} style={{ display: 'flex', gap: 12, padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
            <div style={{ flex: 1, fontWeight: 600 }}>{b.profiles?.full_name || 'Manager'}</div>
            <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
              {b.allocated - b.spent} left <span style={{ opacity: .6 }}>/ {b.allocated} ({usd(b.allocated)})</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function AdminCatalog() {
  const [rows, setRows] = useState([])
  const [editing, setEditing] = useState(null)
  const load = useCallback(async () => {
    const { data } = await supabase.from('token_rewards_catalog').select('*').order('sort_order')
    setRows(data || [])
  }, [])
  useEffect(() => { load() }, [load])

  async function save(row) {
    const payload = { ...row, min_tokens: Number(row.min_tokens), step_tokens: Number(row.step_tokens), max_tokens: row.max_tokens ? Number(row.max_tokens) : null, sort_order: Number(row.sort_order) || 0 }
    if (row.id) await supabase.from('token_rewards_catalog').update(payload).eq('id', row.id)
    else await supabase.from('token_rewards_catalog').insert(payload)
    setEditing(null); load()
  }
  async function remove(id) { await supabase.from('token_rewards_catalog').delete().eq('id', id); load() }

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontWeight: 700 }}>Reward catalog</div>
        <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setEditing({ brand: '', description: '', tremendous_product_id: '', min_tokens: 100, step_tokens: 100, max_tokens: 5000, sort_order: (rows.length + 1) * 10, active: true })}>+ Add reward</button>
      </div>
      {rows.map(r => (
        <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>{r.brand} {!r.active && <span className="badge needed">inactive</span>}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
              min {r.min_tokens} · step {r.step_tokens}{r.max_tokens ? ` · max ${r.max_tokens}` : ''} · {r.tremendous_product_id ? `product ${r.tremendous_product_id}` : '⚠ no product ID'}
            </div>
          </div>
          <button className="btn btn-ghost" onClick={() => setEditing(r)}>Edit</button>
          <button className="btn btn-ghost" onClick={() => remove(r.id)}>Delete</button>
        </div>
      ))}
      {editing && <CatalogModal row={editing} onClose={() => setEditing(null)} onSave={save} />}
    </div>
  )
}
function CatalogModal({ row, onClose, onSave }) {
  const [r, setR] = useState(row)
  const set = (k, v) => setR(p => ({ ...p, [k]: v }))
  return (
    <div className="modal-back open" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>{row.id ? 'Edit reward' : 'Add reward'}</h2>
        <div className="field"><label>Brand</label><input value={r.brand} onChange={e => set('brand', e.target.value)} /></div>
        <div className="field"><label>Description</label><input value={r.description || ''} onChange={e => set('description', e.target.value)} /></div>
        <div className="field"><label>Tremendous product ID</label><input value={r.tremendous_product_id || ''} onChange={e => set('tremendous_product_id', e.target.value)} placeholder="from Tremendous → Products" /></div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div className="field" style={{ flex: 1 }}><label>Min tokens</label><input type="number" value={r.min_tokens} onChange={e => set('min_tokens', e.target.value)} /></div>
          <div className="field" style={{ flex: 1 }}><label>Step</label><input type="number" value={r.step_tokens} onChange={e => set('step_tokens', e.target.value)} /></div>
          <div className="field" style={{ flex: 1 }}><label>Max</label><input type="number" value={r.max_tokens || ''} onChange={e => set('max_tokens', e.target.value)} /></div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div className="field" style={{ flex: 1 }}><label>Sort order</label><input type="number" value={r.sort_order} onChange={e => set('sort_order', e.target.value)} /></div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, marginTop: 8 }}>
            <input type="checkbox" checked={!!r.active} onChange={e => set('active', e.target.checked)} style={{ width: 'auto' }} /> Active
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(r)} disabled={!r.brand}>Save</button>
        </div>
      </div>
    </div>
  )
}

function AdminAdjust() {
  const [people, setPeople] = useState([])
  const [form, setForm] = useState({ profile: '', tokens: 100, note: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  useEffect(() => {
    supabase.from('profiles').select('id, full_name').eq('is_active', true).order('full_name').then(({ data }) => setPeople(data || []))
  }, [])
  async function submit() {
    setBusy(true); setMsg(null)
    try {
      const { data, error } = await supabase.rpc('adjust_tokens', { p_profile: form.profile, p_tokens: Number(form.tokens), p_note: form.note || null })
      if (error) throw error
      setMsg({ ok: true, text: `Done. New balance: ${data.new_balance} tokens.` }); setForm(f => ({ ...f, note: '' }))
    } catch (e) { setMsg({ ok: false, text: e.message }) } finally { setBusy(false) }
  }
  return (
    <div className="card" style={{ maxWidth: 420 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Manual adjustment</div>
      <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 12 }}>Add or remove tokens directly (does not draw from a budget). Use a negative number to remove.</div>
      <div className="field">
        <label>Employee</label>
        <select value={form.profile} onChange={e => setForm(f => ({ ...f, profile: e.target.value }))}>
          <option value="">Choose…</option>
          {people.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </select>
      </div>
      <div className="field"><label>Tokens — {usd(form.tokens)}</label><input type="number" value={form.tokens} onChange={e => setForm(f => ({ ...f, tokens: e.target.value }))} /></div>
      <div className="field"><label>Note</label><input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="Correction / manual credit" /></div>
      {msg && <div style={{ marginBottom: 10, color: msg.ok ? 'var(--passed,#16a34a)' : 'var(--failed,#dc2626)', fontWeight: 600, fontSize: 13.5 }}>{msg.text}</div>}
      <button className="btn btn-primary" onClick={submit} disabled={busy || !form.profile || !Number(form.tokens)}>Apply</button>
    </div>
  )
}

function AdminRedemptions() {
  const [rows, setRows] = useState([])
  useEffect(() => {
    supabase.from('token_redemptions').select('*, profiles!token_redemptions_profile_id_fkey(full_name)').order('created_at', { ascending: false }).limit(100)
      .then(({ data }) => setRows(data || []))
  }, [])
  return (
    <div className="card">
      <div style={{ fontWeight: 700, marginBottom: 10 }}>All redemptions</div>
      {rows.length === 0 && <div style={{ color: 'var(--ink-soft)', fontSize: 14 }}>No redemptions yet.</div>}
      {rows.map(r => (
        <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{r.profiles?.full_name || '—'} · {r.brand} · {usd(r.tokens_spent)}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{fmtDate(r.created_at)} → {r.delivery_email}{r.tremendous_order_id ? ` · order ${r.tremendous_order_id}` : ''}{r.error ? ` · ${r.error}` : ''}</div>
          </div>
          {statusBadge(r.status)}
        </div>
      ))}
    </div>
  )
}

function AdminSettings() {
  const [cfg, setCfg] = useState(null)
  const [form, setForm] = useState({ api_key: '', funding_source_id: '', environment: 'sandbox' })
  const [busy, setBusy] = useState(false)
  const [test, setTest] = useState(null)
  const [products, setProducts] = useState(null)

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('tokens_get_config')
    setCfg(data)
    if (data) setForm(f => ({ ...f, funding_source_id: data.funding_source_id || '', environment: data.environment || 'sandbox' }))
  }, [])
  useEffect(() => { load() }, [load])

  async function saveKey(key, value) {
    if (value === '' || value == null) return
    await supabase.rpc('tokens_set_config', { p_key: key, p_value: String(value) })
  }
  async function saveAll() {
    setBusy(true)
    try {
      if (form.api_key) await saveKey('tremendous_api_key', form.api_key)
      await saveKey('tremendous_funding_source_id', form.funding_source_id)
      await saveKey('tremendous_environment', form.environment)
      setForm(f => ({ ...f, api_key: '' }))
      await load()
      setTest({ ok: true, text: 'Saved.' })
    } finally { setBusy(false) }
  }
  async function runTest() {
    setBusy(true); setTest(null)
    try {
      const { data, error } = await supabase.functions.invoke('tokens-redeem', { body: { action: 'test' } })
      if (error || data?.error) setTest({ ok: false, text: data?.error || error.message })
      else setTest({ ok: true, text: `Connected (${data.environment}).`, sources: data.funding_sources || [] })
    } finally { setBusy(false) }
  }
  async function loadProducts() {
    setBusy(true)
    try {
      const { data, error } = await supabase.functions.invoke('tokens-redeem', { body: { action: 'list_products' } })
      if (!error && !data?.error) setProducts(data.products || [])
      else setTest({ ok: false, text: data?.error || error.message })
    } finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 440px) 1fr', gap: 18, alignItems: 'start' }}>
      <div className="card">
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Tremendous connection</div>
        <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 12 }}>
          Sign up at tremendous.com, add funds, then paste your API key and funding source ID here. The key is stored securely server-side and never shown in the browser.
        </div>
        <div className="field">
          <label>API key {cfg?.api_key_set && <span className="badge passed">set</span>}</label>
          <input type="password" value={form.api_key} onChange={e => setForm(f => ({ ...f, api_key: e.target.value }))} placeholder={cfg?.api_key_set ? '•••••••• (leave blank to keep)' : 'paste Tremendous API key'} />
        </div>
        <div className="field">
          <label>Funding source ID</label>
          <input value={form.funding_source_id} onChange={e => setForm(f => ({ ...f, funding_source_id: e.target.value }))} placeholder="from Test connection below" />
        </div>
        <div className="field">
          <label>Environment</label>
          <select value={form.environment} onChange={e => setForm(f => ({ ...f, environment: e.target.value }))}>
            <option value="sandbox">Sandbox (testing)</option>
            <option value="production">Production (real money)</option>
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={saveAll} disabled={busy}>Save</button>
          <button className="btn btn-ghost" onClick={runTest} disabled={busy}>Test connection</button>
          <button className="btn btn-ghost" onClick={loadProducts} disabled={busy}>List products</button>
        </div>
        {test && <div style={{ marginTop: 12, color: test.ok ? 'var(--passed,#16a34a)' : 'var(--failed,#dc2626)', fontWeight: 600, fontSize: 13.5 }}>{test.text}</div>}
        {test?.sources?.length > 0 && (
          <div style={{ marginTop: 10, fontSize: 12.5 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Funding sources (copy an ID above):</div>
            {test.sources.map(s => <div key={s.id} style={{ color: 'var(--ink-soft)' }}>{s.name} — <code>{s.id}</code></div>)}
          </div>
        )}
      </div>
      <div className="card">
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Tremendous products</div>
        <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 10 }}>Click “List products”, then copy a product ID into a catalog reward (Catalog tab → Edit).</div>
        {!products && <div style={{ color: 'var(--ink-soft)', fontSize: 14 }}>Not loaded.</div>}
        {products && products.length === 0 && <div style={{ color: 'var(--ink-soft)', fontSize: 14 }}>No products returned.</div>}
        {products && products.map(p => (
          <div key={p.id} style={{ display: 'flex', gap: 12, padding: '7px 0', borderBottom: '1px solid var(--line)', fontSize: 13 }}>
            <div style={{ flex: 1, fontWeight: 600 }}>{p.name}</div>
            <code style={{ color: 'var(--ink-soft)' }}>{p.id}</code>
          </div>
        ))}
      </div>
    </div>
  )
}
