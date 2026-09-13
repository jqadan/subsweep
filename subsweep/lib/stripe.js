// Stripe Billing via the REST API — subscriptions, webhooks, Customer Portal.
// Works with test keys (sk_test_) and live keys (sk_live_); the mode is
// reported to the client so the UI can label test mode.
//
// Setup:
//   STRIPE_SECRET_KEY   sk_test_... or sk_live_...
//   STRIPE_PRICE_ID     price_... (recurring)
//   STRIPE_WEBHOOK_SECRET whsec_... (from the dashboard webhook endpoint,
//                        pointing at POST /api/stripe/webhook)

import crypto from 'node:crypto';

const STRIPE_API = 'https://api.stripe.com/v1';

export function stripeEnabled() {
  return (
    typeof process.env.STRIPE_SECRET_KEY === 'string' &&
    /^sk_(test|live)_/.test(process.env.STRIPE_SECRET_KEY) &&
    typeof process.env.STRIPE_PRICE_ID === 'string'
  );
}

// 'live' | 'test' (only meaningful when stripeEnabled()).
export function stripeMode() {
  return process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') ? 'live' : 'test';
}

async function stripeRequest(method, endpoint, params) {
  const res = await fetch(`${STRIPE_API}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params ? new URLSearchParams(params).toString() : undefined
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `Stripe error ${res.status}`);
  return json;
}

export async function ensureCustomer(user) {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const customer = await stripeRequest('POST', '/customers', {
    email: user.email,
    'metadata[userId]': user.id
  });
  return customer.id;
}

export async function createSubscriptionCheckout({ customerId, userId, baseUrl }) {
  return stripeRequest('POST', '/checkout/sessions', {
    mode: 'subscription',
    customer: customerId,
    'line_items[0][price]': process.env.STRIPE_PRICE_ID,
    'line_items[0][quantity]': '1',
    'metadata[userId]': userId,
    'subscription_data[metadata][userId]': userId,
    success_url: `${baseUrl}/app?upgraded=1`,
    cancel_url: `${baseUrl}/app?cancelled=1`
  });
}

export async function createPortalSession({ customerId, baseUrl }) {
  return stripeRequest('POST', '/billing_portal/sessions', {
    customer: customerId,
    return_url: `${baseUrl}/app`
  });
}

// Stripe webhook signature scheme: header "t=<ts>,v1=<hmac>", where the HMAC
// is SHA-256 of `${ts}.${rawBody}` keyed with the endpoint secret.
export function verifyWebhookSignature(rawBody, signatureHeader, toleranceSeconds = 300) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return { ok: false, error: 'STRIPE_WEBHOOK_SECRET not configured' };
  const parts = Object.fromEntries(
    String(signatureHeader || '')
      .split(',')
      .map((p) => p.split('=').map((s) => s.trim()))
      .filter((p) => p.length === 2)
  );
  if (!parts.t || !parts.v1) return { ok: false, error: 'Malformed signature header' };
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > toleranceSeconds) {
    return { ok: false, error: 'Timestamp outside tolerance' };
  }
  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
  const given = Buffer.from(parts.v1, 'hex');
  const want = Buffer.from(expected, 'hex');
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
    return { ok: false, error: 'Signature mismatch' };
  }
  return { ok: true };
}
