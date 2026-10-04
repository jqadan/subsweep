// Pro bought inside the iPhone app, through Apple In-App Purchase, managed by
// RevenueCat (which validates Apple's receipts so we never handle them).
//
// Apple requires that anything the app unlocks can also be bought in the app
// (App Store guideline 3.1.1 / 3.1.3(b)). Once that is true, Pro bought on the
// website may unlock in the app too — so turning this on is also what lets
// web Pro customers see Pro on their iPhone.
//
// Railway variables (the first three are needed; without them the apps stay on the
// free view and nothing here runs):
//   REVENUECAT_IOS_KEY        public Apple SDK key (appl_…), sent to the app
//   REVENUECAT_SECRET_KEY     secret API key (sk_…), server only
//   REVENUECAT_WEBHOOK_AUTH   any long random string; paste the same value
//                             into RevenueCat → Integrations → Webhooks →
//                             Authorization header
//   REVENUECAT_ENTITLEMENT    optional; when unset, any active entitlement
//                             counts as Pro (the project has only the one)
import crypto from 'node:crypto';

const RC_API = 'https://api.revenuecat.com/v1';

export const iapIosKey = () => process.env.REVENUECAT_IOS_KEY || '';
export const iapEnabled = () => Boolean(
  process.env.REVENUECAT_IOS_KEY && process.env.REVENUECAT_SECRET_KEY && process.env.REVENUECAT_WEBHOOK_AUTH
);

async function rc(method, path) {
  const res = await fetch(`${RC_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.REVENUECAT_SECRET_KEY}`, 'Content-Type': 'application/json' }
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || `RevenueCat error ${res.status}`);
  return json;
}

// The expiry of the user's active Pro entitlement as an ISO string, or null
// when they have none. Asked of RevenueCat rather than taken from the app, so
// a modified client cannot grant itself Pro.
export async function fetchProExpiry(appUserId) {
  const json = await rc('GET', `/subscribers/${encodeURIComponent(appUserId)}`);
  const all = json?.subscriber?.entitlements || {};
  const wanted = process.env.REVENUECAT_ENTITLEMENT;
  const ents = wanted ? [all[wanted]].filter(Boolean) : Object.values(all);
  // The latest expiry among active entitlements; null expiry = never expires.
  let best = null;
  for (const ent of ents) {
    if (ent.expires_date == null) return '9999-12-31T00:00:00.000Z';
    const exp = new Date(ent.expires_date);
    if (exp > new Date() && (!best || exp > best)) best = exp;
  }
  return best ? best.toISOString() : null;
}

// Removes RevenueCat's copy of the customer on account deletion. It does NOT
// stop Apple billing — only the customer can, from their Apple ID settings.
export async function deleteCustomer(appUserId) {
  await rc('DELETE', `/subscribers/${encodeURIComponent(appUserId)}`);
}

// RevenueCat sends back exactly the Authorization value configured for the
// webhook, so a constant-time comparison is the whole check.
export function webhookAuthorised(req) {
  const expected = process.env.REVENUECAT_WEBHOOK_AUTH || '';
  const got = String(req.headers.authorization || '');
  const candidates = [got, got.replace(/^Bearer\s+/i, '')];
  return Boolean(expected) && candidates.some((c) =>
    c.length === expected.length && crypto.timingSafeEqual(Buffer.from(c), Buffer.from(expected)));
}

// Every app user id a webhook event touches. Transfers (a restore on a
// different account) name both sides, and each needs re-checking.
export function eventUserIds(event) {
  return [...new Set([
    event?.app_user_id,
    event?.original_app_user_id,
    ...(event?.transferred_from || []),
    ...(event?.transferred_to || [])
  ].filter(Boolean).map(String))];
}
