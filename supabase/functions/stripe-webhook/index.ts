// stripe-webhook — source of truth for subscription state + self-serve provisioning.
// Deployed with verify_jwt=false. Secrets: stripe_secret_key, stripe_webhook_secret.
// Optional: app_invite_redirect_url.
// SAFETY: never converts an existing internal/staff account into a client tenant.
// 2026-11-23 (Becky): if the signup email already has a login, we still email them a sign-in link
// (before: no email at all). An existing login is only moved to the new company when it isn't
// already tied to one (never staff, never another customer's user). Logged in qa_portal_log.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

async function getSecret(k: string): Promise<string | null> {
  const env = Deno.env.get(k) || Deno.env.get(k.toUpperCase());
  if (env) return env;
  const { data } = await admin.from("integration_secrets").select("value").eq("key", k).maybeSingle();
  return data?.value ?? null;
}

async function verifyStripeSig(payload: string, header: string, secret: string, toleranceSec = 300): Promise<boolean> {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=").map((s) => s.trim())));
  const t = parts["t"]; const v1 = parts["v1"];
  if (!t || !v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`));
  const hex = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex.length !== v1.length) return false;
  let diff = 0; for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}

async function stripeGet(secret: string, path: string) {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, { headers: { Authorization: `Bearer ${secret}` } });
  const j = await r.json();
  if (!r.ok) throw new Error(`stripe GET ${path}: ${j?.error?.message || ""}`);
  return j;
}
async function stripePost(secret: string, path: string, params: Record<string, string>) {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`stripe POST ${path}: ${j?.error?.message || ""}`);
  return j;
}

async function findProfileByEmail(email: string): Promise<any | null> {
  const { data } = await admin.from("profiles").select("id, is_admin, role, client_id").ilike("email", email).limit(1);
  return data && data[0] ? data[0] : null;
}

// Email an existing user a one-click sign-in link (no new account is created).
async function sendSignInLink(email: string, redirectTo: string): Promise<string | null> {
  const pub = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { error } = await pub.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: redirectTo } });
  return error ? error.message : null;
}

async function provisionGuest(session: any): Promise<string | null> {
  const email = (session?.metadata?.signup_email || session?.customer_details?.email || "").toLowerCase();
  const companyName = session?.metadata?.company_name || (email ? email.split("@")[0] : "New Client");
  if (!email) return null;

  const redirectTo = (await getSecret("app_invite_redirect_url")) || "https://app.opsiscx.com";

  // Resolve/create the auth user; decide whether it's SAFE to link to a client tenant.
  let userId: string | null = null;
  let safeToLink = false;
  let existing = false;
  const { data: inv, error: invErr } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: companyName },
    redirectTo,
  });
  if (inv?.user) {
    userId = inv.user.id;      // brand-new signup -> safe; Supabase sends the set-password invite
    safeToLink = true;
  } else if (invErr) {
    existing = true;
    const prof = await findProfileByEmail(email);
    if (prof) {
      userId = prof.id;
      // Only an unattached customer login may be moved. Staff (no client) and other customers' users never are.
      safeToLink = prof.is_admin !== true && String(prof.role || "").toLowerCase() === "client" && !prof.client_id;
    }
  }

  // Create the client tenant.
  const { data: newClient, error: cErr } = await admin
    .from("clients").insert({ name: companyName, uses_five9: false }).select("id").single();
  if (cErr || !newClient) throw new Error(`create client: ${cErr?.message}`);
  const clientId = newClient.id as string;

  if (userId && safeToLink) {
    await admin.from("profiles").update({ client_id: clientId, role: "client" }).eq("id", userId);
  }
  let mailErr: string | null = null;
  if (existing) mailErr = await sendSignInLink(email, redirectTo);
  try {
    await admin.from("qa_portal_log").insert({ client_id: clientId, actor_id: userId, kind: "signup", ref: email,
      detail: { existing_login: existing, linked: !!(userId && safeToLink), sign_in_email_error: mailErr } });
  } catch (_) { /* non-fatal */ }
  return clientId;
}

async function applySubscription(sub: any, forceClientId?: string) {
  const clientId = forceClientId || sub?.metadata?.client_id;
  const customerId = sub?.customer;
  if (!clientId && !customerId) return { skip: "no client_id or customer" };

  const items: any[] = sub?.items?.data || [];
  const { data: plans } = await admin.from("billing_plans").select("plan, stripe_price_id, seat_price_id, included_calls, overage_rate");
  const byPrice: Record<string, any> = {};
  const seatPrices = new Set<string>();
  (plans || []).forEach((p: any) => { if (p.stripe_price_id) byPrice[p.stripe_price_id] = p; if (p.seat_price_id) seatPrices.add(p.seat_price_id); });

  let plan: string | null = sub?.metadata?.plan ?? null;
  let seats = 1; let included: number | null = null; let overage: number | null = null;
  for (const it of items) {
    const priceId = it?.price?.id;
    if (priceId && byPrice[priceId]) { const p = byPrice[priceId]; plan = p.plan; included = p.included_calls; overage = p.overage_rate; }
    if (priceId && seatPrices.has(priceId)) seats = Number(it.quantity) || 1;
  }

  const statusMap: Record<string, string> = {
    trialing: "trialing", active: "active", past_due: "past_due", unpaid: "past_due",
    canceled: "canceled", incomplete: "inactive", incomplete_expired: "inactive", paused: "inactive",
  };
  const status = statusMap[sub?.status] ?? "inactive";

  const patch: Record<string, unknown> = {
    stripe_subscription_id: sub.id,
    stripe_customer_id: customerId,
    status, seats,
    plan: plan ?? undefined,
    included_calls: included ?? undefined,
    overage_rate: overage ?? undefined,
    current_period_end: sub?.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
    trial_end: sub?.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
  };

  if (clientId) await admin.from("entitlements").upsert({ client_id: clientId, ...patch }, { onConflict: "client_id" });
  else await admin.from("entitlements").update(patch).eq("stripe_customer_id", customerId);
  return { clientId, status, plan, seats };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  try {
    const secret = await getSecret("stripe_secret_key");
    const whsec = await getSecret("stripe_webhook_secret");
    if (!secret || !whsec) return json({ error: "stripe secrets not configured" }, 503);

    const raw = await req.text();
    const sig = req.headers.get("stripe-signature") || "";
    if (!(await verifyStripeSig(raw, sig, whsec))) return json({ error: "bad signature" }, 400);

    const event = JSON.parse(raw);
    const type = event.type as string;
    const obj = event.data?.object ?? {};

    if (type === "checkout.session.completed") {
      let clientId: string | undefined = obj.client_reference_id || obj.metadata?.client_id || undefined;
      if (!clientId && obj.metadata?.signup_email) {
        clientId = (await provisionGuest(obj)) || undefined;
      }
      const subId = obj.subscription;
      if (subId) {
        const sub = await stripeGet(secret, `subscriptions/${subId}`);
        if (clientId) {
          try {
            await stripePost(secret, `subscriptions/${subId}`, { "metadata[client_id]": clientId, "metadata[plan]": obj.metadata?.plan || sub?.metadata?.plan || "" });
            if (sub.customer) await stripePost(secret, `customers/${sub.customer}`, { "metadata[client_id]": clientId });
          } catch (_) { /* non-fatal */ }
        }
        await applySubscription(sub, clientId);
      }
    } else if (type === "customer.subscription.created" || type === "customer.subscription.updated" || type === "customer.subscription.deleted") {
      await applySubscription(obj);
    } else if (type === "invoice.payment_failed") {
      if (obj.customer) await admin.from("entitlements").update({ status: "past_due" }).eq("stripe_customer_id", obj.customer);
    } else if (type === "invoice.paid") {
      if (obj.subscription) {
        const sub = await stripeGet(secret, `subscriptions/${obj.subscription}`);
        await applySubscription(sub);
      }
    }

    return json({ received: true });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
