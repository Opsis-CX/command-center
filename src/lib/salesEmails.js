// ============================================================================
//  SALES STAGE EMAILS — shared config
// ============================================================================
//  The copy and the on/off switch for every sales stage email live in the
//  `sales_email_templates` table, edited from the Email Templates screen on the
//  Sales board. This module is the single place the rest of the app asks
//  "does moving a deal into this stage actually email anyone?"
//
//  Why this exists: the board used to assume the answer was yes for five
//  stages, warn the rep an email was going out, and stamp `last_emailed_at` —
//  while the edge function quietly sent only the proposal. Deals looked
//  emailed when nobody had heard from us. Now there is one source of truth and
//  both the warning and the timestamp follow it.
// ============================================================================
import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

// Which stage claims which email kind. A stage listed here only sends if its
// template is also enabled — see useSalesEmailConfig below.
export const STAGE_EMAIL_KIND = {
  email_1_sent: 'intro',
  email_2_sent: 'followup',
  proposal_sent: 'proposal',
  contract_sent: 'contract',
  won: 'won_welcome',
}

// Fields that can be dropped into a subject or body. Kept here so the editor's
// chips and the edge function's renderer can't drift apart.
export const MERGE_FIELDS = [
  { token: '{{first_name}}', hint: 'Jordan' },
  { token: '{{full_name}}', hint: 'Jordan Reyes' },
  { token: '{{company}}', hint: 'Acme Corp' },
  { token: '{{title}}', hint: 'Operations Manager' },
  { token: '{{observation}}', hint: 'the one line about them' },
  { token: '{{sender_name}}', hint: 'your name' },
  { token: '{{sender_email}}', hint: 'your address' },
  { token: '{{calendly}}', hint: '15-min booking link' },
  { token: '{{calendly_30}}', hint: '30-min booking link' },
  { token: '{{phone}}', hint: '656-234-8009' },
]

// Module-level cache so the board, the deal panel and the editor share one
// fetch per page load rather than three.
let cache = null
let inflight = null

async function fetchTemplates() {
  const { data, error } = await supabase
    .from('sales_email_templates')
    .select('id, kind, label, stage_key, sort_order, enabled, subject, body_html, help, updated_at, industry, audience, pipeline, variant_name, is_default')
    .order('sort_order', { ascending: true })
  if (error) throw error
  return data || []
}

// ---- variants -------------------------------------------------------------
// A stage can hold several versions of the same email, each scoped to a
// vertical (deals.industry), a service line (deals.service_fit) and/or a
// pipeline. A law firm and a church are sold the same thing and must not read
// the same letter, so VERTICAL outranks service line — it is the key that
// changes the voice rather than the offer.
//
// A named key that does not match disqualifies the row outright. That is what
// lets a switched-off "Low fit" variant shield those deals from the general
// pitch instead of letting them fall through to it.

// ---- do-not-pitch guard ---------------------------------------------------
// The variant shield alone stopped being sufficient once VERTICAL was made to
// outrank AUDIENCE (2026-08-30). A Low fit LEGAL deal matches the Legal variant
// at score 4 and the "Low fit — do not pitch" variant at score 2, so the Legal
// pitch wins and the shield never fires. 186 deals are rated Low fit.
//
// So the rule is enforced as a RULE, not as a template: cold outreach never
// goes to a deal we have already decided not to pitch. Mirrored byte-for-byte
// in the `send-sales-email` edge function — change one, change the other.
const COLD_KINDS = new Set(['intro', 'followup'])

export function pitchBlockReason(kind, deal) {
  if (!COLD_KINDS.has(kind)) return ''
  if (deal?.service_fit === 'Low fit') return 'this deal is rated Low fit — do not pitch'
  if (deal?.fit_rating === 'Weak') return 'this deal is rated Weak fit — do not pitch'
  return ''
}

export function variantScore(tpl, deal) {
  if (tpl.industry && tpl.industry !== (deal?.industry || null)) return -1
  if (tpl.audience && tpl.audience !== (deal?.service_fit || null)) return -1
  if (tpl.pipeline && tpl.pipeline !== (deal?.pipeline || null)) return -1
  let s = 0
  if (tpl.industry) s += 4
  if (tpl.audience) s += 2
  if (tpl.pipeline) s += 1
  return s
}

export function pickTemplate(rows, kind, deal) {
  let best = null
  let bestScore = -1
  for (const t of rows) {
    if (t.kind !== kind) continue
    const sc = variantScore(t, deal)
    if (sc > bestScore) { best = t; bestScore = sc }
  }
  return best
}

export const variantLabel = (t) =>
  t?.variant_name || [t?.industry, t?.audience, t?.pipeline].filter(Boolean).join(' \u00b7 ') || 'Default'


export function invalidateSalesEmailCache() {
  cache = null
  inflight = null
}

/**
 * Templates plus the helpers the board needs.
 *   templates      — every row, in display order
 *   emailForStage  — (stageKey) => kind, but ONLY if that template is enabled.
 *                    Returns null otherwise, which is what stops the board
 *                    promising an email that isn't coming.
 *   reload         — refetch after the editor saves
 */
export function useSalesEmailConfig() {
  const [templates, setTemplates] = useState(cache || [])
  const [loading, setLoading] = useState(!cache)
  const [error, setError] = useState('')

  const load = useCallback(async (force = false) => {
    if (force) invalidateSalesEmailCache()
    if (cache) { setTemplates(cache); setLoading(false); return cache }
    setLoading(true)
    try {
      inflight = inflight || fetchTemplates()
      const rows = await inflight
      cache = rows
      inflight = null
      setTemplates(rows)
      setError('')
      return rows
    } catch (e) {
      inflight = null
      // A failed read must not silently turn every email on OR off in a
      // confusing way — we surface it and treat nothing as enabled, which is
      // the safe direction: no surprise email leaves.
      setError(e.message || String(e))
      setTemplates([])
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const enabledKinds = new Set(templates.filter(t => t.enabled).map(t => t.kind))

  // Which template would actually go to THIS deal, or null. Resolving here means
  // the rep is warned about — and confirms — the exact variant that sends.
  const templateForDeal = useCallback((stageKey, deal) => {
    const kind = STAGE_EMAIL_KIND[stageKey]
    if (!kind) return null
    // A do-not-pitch deal resolves to NO email, whatever the templates say.
    if (pitchBlockReason(kind, deal)) return null
    const tpl = pickTemplate(templates, kind, deal)
    return tpl && tpl.enabled ? tpl : null
  }, [templates])

  // Back-compat: returns the kind, but only when a variant genuinely covers
  // this deal. Passing the deal is strongly preferred; without it this falls
  // back to "is any variant of this kind on?", which can promise an email that
  // no variant actually covers.
  const emailForStage = useCallback((stageKey, deal) => {
    const kind = STAGE_EMAIL_KIND[stageKey]
    if (!kind) return null
    if (deal) return templateForDeal(stageKey, deal) ? kind : null
    return enabledKinds.has(kind) ? kind : null
  }, [templates, templateForDeal]) // eslint-disable-line react-hooks/exhaustive-deps

  return { templates, loading, error, emailForStage, templateForDeal, enabledKinds, reload: () => load(true) }
}

/**
 * Ask the edge function to send one stage email.
 * Returns { sent, reason, error } — never throws, so a transition can't be
 * rolled back by a mail problem.
 *   mode: undefined = real send · 'preview' = render only · 'test' = send to self
 */
export async function sendSalesEmail(kind, to, data, mode, templateId) {
  if (!kind) return { sent: false, reason: 'no email for this stage' }
  try {
    // templateId is passed whenever the caller has already resolved a variant,
    // so the email that leaves is the one the rep was shown and confirmed.
    const { data: res, error } = await supabase.functions.invoke('send-sales-email', {
      body: { kind, to, data, mode, templateId: templateId || null },
    })
    if (error) return { sent: false, error: error.message || String(error) }
    if (res?.error) return { sent: false, error: res.error }
    return { sent: !!res?.sent, reason: res?.reason || '', subject: res?.subject, html: res?.html }
  } catch (e) {
    return { sent: false, error: e.message || String(e) }
  }
}

// ============================================================================
//  RESEARCH READINESS
// ============================================================================
//  Kerri and Sylvia's first job on a lead is research: find the person, the
//  numbers, the website, decide what we would actually sell them, and write the
//  one line that makes the email sound like it was written to them. Until that
//  is done, calling is guesswork and the stage email has nothing to merge.
//
//  Defined once here so the card badge, the move warning and the "Needs
//  research" filter can never disagree about what "done" means.
//
//  {{observation}} is the field that decides whether a cold email reads as
//  written-to-you or as a blast, so it counts even though it is free text.
export const RESEARCH_FIELDS = [
  { key: 'contact_person',   label: 'Contact name' },
  { key: 'contact_email',    label: 'Contact email' },
  { key: 'contact_phone',    label: 'Direct phone' },
  { key: 'company_phone',    label: 'Company phone' },
  { key: 'website',          label: 'Website' },
  { key: 'industry',         label: 'Vertical' },
  { key: 'service_fit',      label: 'What we would sell them' },
  { key: 'email_observation', label: 'The one-line observation' },
]

const filled = (v) => String(v ?? '').trim().length > 0

/** Which research fields this deal is still missing, by label. */
export function missingResearch(deal) {
  return RESEARCH_FIELDS.filter(f => !filled(deal?.[f.key])).map(f => f.label)
}

/** { done, total, missing[], complete } — the whole readiness picture. */
export function researchStatus(deal) {
  const missing = missingResearch(deal)
  const total = RESEARCH_FIELDS.length
  return { done: total - missing.length, total, missing, complete: missing.length === 0 }
}

// ============================================================================
//  VERTICALS & SERVICE LINES
// ============================================================================
//  These used to be hardcoded arrays in PipelineBoard.jsx and
//  SalesEmailTemplates.jsx, mirrored by a CHECK constraint in the database.
//  Three copies of one list, so adding a vertical meant a migration AND a
//  deploy — which is exactly where Corinne got stuck on 2026-08-31 with two
//  emails written and nowhere to put them.
//
//  They are now `sales_verticals` and `sales_service_lines`, referenced by real
//  foreign keys. The database still refuses a value nobody defined; defining one
//  is now a row an admin can add from the Stage emails screen.
let listCache = null
let listInflight = null

export function invalidateSalesListCache() { listCache = null; listInflight = null }

async function fetchLists() {
  const [v, s] = await Promise.all([
    supabase.from('sales_verticals').select('label, sort_order, is_active').order('sort_order'),
    supabase.from('sales_service_lines').select('label, sort_order, is_active').order('sort_order'),
  ])
  if (v.error) throw v.error
  if (s.error) throw s.error
  return { verticals: v.data || [], serviceLines: s.data || [] }
}

/**
 * The two lists, plus `reload` for after the manage screen saves.
 * `verticals` / `serviceLines` are the ACTIVE labels, ready for a <select>.
 * `allVerticals` keeps the deactivated ones too, so a deal already carrying a
 * retired vertical still renders its own value instead of showing blank.
 */
export function useSalesLists() {
  const [lists, setLists] = useState(listCache || { verticals: [], serviceLines: [] })
  const [loading, setLoading] = useState(!listCache)

  const load = useCallback(async (force = false) => {
    if (force) invalidateSalesListCache()
    if (listCache) { setLists(listCache); setLoading(false); return listCache }
    setLoading(true)
    try {
      listInflight = listInflight || fetchLists()
      const rows = await listInflight
      listCache = rows; listInflight = null
      setLists(rows)
      return rows
    } catch (_e) {
      listInflight = null
      // A failed read must not empty the dropdowns and make every deal look
      // unclassified — fall back to whatever is cached, or nothing.
      return listCache || { verticals: [], serviceLines: [] }
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  return {
    loading,
    verticals: lists.verticals.filter(r => r.is_active).map(r => r.label),
    serviceLines: lists.serviceLines.filter(r => r.is_active).map(r => r.label),
    allVerticals: lists.verticals.map(r => r.label),
    allServiceLines: lists.serviceLines.map(r => r.label),
    reload: () => load(true),
  }
}

/** Keep a value the deal already has visible even if it was later retired. */
export function withCurrent(options, current) {
  return current && !options.includes(current) ? [current, ...options] : options
}
