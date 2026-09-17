// src/lib/billing.js — talks to the Stripe edge functions.
import { supabase } from './supabase'

// Start a subscription checkout. Redirects the browser to Stripe Checkout.
// plan: 'starter' | 'growth' | 'scale'
export async function startCheckout({ plan, seats = 0, companyName = '' }) {
  const { data, error } = await supabase.functions.invoke('stripe-create-checkout', {
    body: {
      plan,
      seats,
      company_name: companyName,
      success_url: `${window.location.origin}/welcome?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${window.location.origin}/pricing`,
    },
  })
  if (error) throw new Error(error.message || 'Checkout failed')
  if (data?.error) throw new Error(data.error)
  if (data?.url) { window.location.assign(data.url); return }
  throw new Error('No checkout URL returned')
}

// Open Stripe's hosted billing portal (manage card / plan / cancel).
export async function openBillingPortal() {
  const { data, error } = await supabase.functions.invoke('stripe-customer-portal', {
    body: { return_url: window.location.href },
  })
  if (error) throw new Error(error.message || 'Portal failed')
  if (data?.error) throw new Error(data.error)
  if (data?.url) { window.location.assign(data.url); return }
  throw new Error('No portal URL returned')
}

// Read the current tenant's entitlement (or null). RLS scopes it to the user.
export async function getEntitlement() {
  const { data, error } = await supabase
    .from('entitlements')
    .select('plan, status, seats, current_period_end, trial_end, included_calls, overage_rate')
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data || null
}
