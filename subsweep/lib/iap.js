// Pro bought inside the iPhone app, through Apple In-App Purchase, managed by
// RevenueCat (which validates Apple's receipts so we never handle them).
//
// Apple requires that anything the app unlocks can also be bought in the app
// (App Store guideline 3.1.1 / 3.1.3(b)). Once that is true, Pro bought on the
// website may unlock in the app too — so turning this on is also what lets
// web Pro customers see Pro on their iPhone.
//
// One Railway variable switches it on:
//   REVENUECAT_SECRET_KEY   a RevenueCat v2 secret key with read & write on
//                           project configuration and customer information
// Everything else is found or derived from it: the project, the App Store
// app's public SDK key (sent to the app), and the webhook password (an HMAC of
// the key, which store/rc-setup.mjs registers with RevenueCat). Optional
// overrides: REVENUECAT_IOS_KEY, REVENUECAT_WEBHOOK_AUTH, REVENUECAT_ENTITLEMENT.
// Without the key the apps stay on the free view and nothing here runs.
import crypto from 'node:crypto';

const RC = 'https://api.revenuecat.com/v2';
const BUNDLE_ID = 'au.com.subsweep.app';
const secret = () => process.env.REVENUECAT_SECRET_KEY || '';

let found = { projectId: null, iosKey: null }; // filled by discover()

async function rc(method, path, { allow404 = false } = {}) {
  const res = await fetch(`${RC}${path}`, {
    method,
    headers: { Authorization: `Bearer ${secret()}`, 'Content-Type': 'application/json' }
  });
  if (allow404 && res.status === 404) return null;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || `RevenueCat error ${res.status}`);
  return json;
}

// Finds the project and the App Store app's production public key. Run at
// boot and periodically, so a key added to Railway (or an app set up later in
// RevenueCat) is picked up without a code change.
export async function discover() {
  if (!secret()) return found;
  const projects = await rc('GET', '/projects');
  const projectId = projects.items?.[0]?.id || null;
  let iosKey = null;
  if (projectId) {
    const apps = await rc('GET', `/projects/${projectId}/apps?limit=100`);
    const app = (apps.items || []).find((a) => a.type === 'app_store' && a.app_store?.bundle_id === BUNDLE_ID);
    if (app) {
      const keys = await rc('GET', `/projects/${projectId}/apps/${app.id}/public_api_keys`);
      iosKey = (keys.items || []).find((k) => k.environment === 'production')?.key || null;
    }
  }
  found = { projectId, iosKey };
  return found;
}

export const iapIosKey = () => process.env.REVENUECAT_IOS_KEY || found.iosKey || '';
export const iapEnabled = () => Boolean(secret() && found.projectId && iapIosKey());

// The password RevenueCat sends with every webhook. Derived from the secret
// key so nobody has to copy a second value between RevenueCat and Railway.
export function webhookPassword(key = secret()) {
  return process.env.REVENUECAT_WEBHOOK_AUTH ||
    (key ? crypto.createHmac('sha256', key).update('subsweep-revenuecat-webhook').digest('hex') : '');
}

export function webhookAuthorised(req) {
  const expected = webhookPassword();
  const got = String(req.headers.authorization || '');
  const candidates = [got, got.replace(/^Bearer\s+/i, '')];
  return Boolean(expected) && candidates.some((c) =>
    c.length === expected.length && crypto.timingSafeEqual(Buffer.from(c), Buffer.from(expected)));
}

// The expiry of the user's active Pro entitlement as an ISO string, or null
// when they have none. Asked of RevenueCat rather than taken from the app, so
// a modified client cannot grant itself Pro.
export async function fetchProExpiry(appUserId) {
  const json = await rc('GET', `/projects/${found.projectId}/customers/${encodeURIComponent(appUserId)}`, { allow404: true });
  if (!json) return null; // RevenueCat has never seen this account
  const raw = json.active_entitlements;
  const ents = Array.isArray(raw) ? raw : raw?.items || [];
  const wanted = process.env.REVENUECAT_ENTITLEMENT;
  let best = null;
  for (const ent of ents) {
    if (wanted && ent.entitlement_id !== wanted && ent.lookup_key !== wanted) continue;
    if (ent.expires_at == null) return '9999-12-31T00:00:00.000Z'; // never expires
    const exp = new Date(ent.expires_at);
    if (exp > new Date() && (!best || exp > best)) best = exp;
  }
  return best ? best.toISOString() : null;
}

// Removes RevenueCat's copy of the customer on account deletion. It does NOT
// stop Apple billing — only the customer can, from their Apple ID settings.
export async function deleteCustomer(appUserId) {
  await rc('DELETE', `/projects/${found.projectId}/customers/${encodeURIComponent(appUserId)}`, { allow404: true });
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
