// Sets up RevenueCat for SubSweep Pro through RevenueCat's v2 API. Run by
// .github/workflows/revenuecat-setup.yml whenever store/rc-setup.json changes.
//
//   mode "inspect"  read-only: project, apps, products, entitlements,
//                   offerings, webhooks, and the shape of a customer record
//   mode "apply"    create what is missing: the App Store app (with Apple's
//                   In-App Purchase key), the product, its entitlement and
//                   offering package, and the webhook to the server
//
// Idempotent: anything that already exists is reused. Secrets come from the
// environment and are never printed; the public SDK key is printed because
// it is public by design (it ships inside the app).
import fs from 'node:fs';
import { webhookPassword } from '../lib/iap.js';

const cfg = JSON.parse(fs.readFileSync(new URL('./rc-setup.json', import.meta.url)));
const RC = 'https://api.revenuecat.com/v2';
const KEY = process.env.REVENUECAT_SECRET_KEY;
const log = (...a) => console.log(...a);

async function rc(method, path, body, { ok = [] } = {}) {
  const res = await fetch(RC + path, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok && !ok.includes(res.status)) throw new Error(`${method} ${path} → ${res.status} ${json.message || JSON.stringify(json)}`);
  return { status: res.status, json };
}
const items = async (path) => (await rc('GET', path)).json.items || [];

async function main() {
  if (!KEY) {
    // Not a failure: the secrets just are not in GitHub yet.
    console.log('::warning::REVENUECAT_SECRET_KEY is not set in GitHub secrets yet — nothing to do.');
    return;
  }
  log(`mode: ${cfg.mode}`);
  const [project] = await items('/projects');
  if (!project) throw new Error('No project visible to this key');
  const P = `/projects/${project.id}`;
  log(`project: ${project.name} (${project.id})`);

  let apps = await items(`${P}/apps?limit=100`);
  for (const a of apps) log(`app: ${a.name} · ${a.type}${a.app_store ? ' · ' + a.app_store.bundle_id : ''} (${a.id})`);
  let app = apps.find((a) => a.type === 'app_store' && a.app_store?.bundle_id === cfg.bundleId);

  const products = await items(`${P}/products?limit=100`);
  for (const p of products) log(`product: ${p.store_identifier} · ${p.type} · app ${p.app_id}`);
  const ents = await items(`${P}/entitlements?limit=100`);
  for (const e of ents) log(`entitlement: ${e.lookup_key} (${e.id})`);
  const offerings = await items(`${P}/offerings?limit=100`);
  for (const o of offerings) log(`offering: ${o.lookup_key}${o.is_current ? ' (current)' : ''} (${o.id})`);
  const hooks = await items(`${P}/integrations/webhooks?limit=100`).catch((e) => { log(`webhooks: ${e.message}`); return []; });
  for (const h of hooks) log(`webhook: ${h.name} → ${h.url}`);

  // What a customer record looks like, so the server reads it correctly.
  const probe = await rc('GET', `${P}/customers/subsweep-shape-probe`, null, { ok: [404] });
  log(`customer probe: HTTP ${probe.status}; fields: ${Object.keys(probe.json).join(', ')}`);

  if (cfg.mode !== 'apply') return log('\ninspect only — nothing changed.');

  // ---- App Store app ----
  if (!app) {
    const p8 = process.env.RC_IAP_KEY_P8;
    const iapKeyId = (process.env.RC_IAP_KEY_ID || '').trim();
    const issuer = (process.env.ASC_ISSUER_ID || '').trim();
    if (!p8 || !iapKeyId) throw new Error('RC_IAP_KEY_P8 and RC_IAP_KEY_ID secrets are needed to create the App Store app');
    const body = {
      name: 'SubSweep (App Store)', type: 'app_store',
      app_store: {
        bundle_id: cfg.bundleId,
        subscription_private_key: p8.trim(), subscription_key_id: iapKeyId, subscription_key_issuer: issuer
      }
    };
    if (process.env.ASC_KEY_PEM && process.env.ASC_KEY_ID) {
      Object.assign(body.app_store, {
        app_store_connect_api_key: process.env.ASC_KEY_PEM.trim(),
        app_store_connect_api_key_id: process.env.ASC_KEY_ID.trim(),
        app_store_connect_api_key_issuer: issuer
      });
    }
    app = (await rc('POST', `${P}/apps`, body)).json;
    log(`created App Store app (${app.id})`);
  }

  // ---- product ----
  let product = products.find((p) => p.store_identifier === cfg.productId && p.app_id === app.id);
  if (!product) {
    product = (await rc('POST', `${P}/products`, {
      store_identifier: cfg.productId, app_id: app.id, type: 'subscription', display_name: cfg.productName
    })).json;
    log(`created product ${cfg.productId} (${product.id})`);
  }

  // ---- entitlement ----
  const ent = ents.find((e) => e.lookup_key === cfg.entitlement) || (ents.length === 1 ? ents[0] : null);
  if (!ent) throw new Error(`entitlement ${cfg.entitlement} not found`);
  const att = await rc('POST', `${P}/entitlements/${ent.id}/actions/attach_products`, { product_ids: [product.id] }, { ok: [400, 409, 422] });
  log(`entitlement ${ent.lookup_key}: product ${att.status < 300 ? 'attached' : 'already attached (' + att.status + ')'}`);

  // ---- offering + monthly package ----
  const offering = offerings.find((o) => o.is_current) || offerings.find((o) => o.lookup_key === 'default');
  if (!offering) throw new Error('No current offering');
  const pkgs = await items(`${P}/offerings/${offering.id}/packages?limit=100`);
  let pkg = pkgs.find((p) => p.lookup_key === '$rc_monthly');
  if (!pkg) {
    pkg = (await rc('POST', `${P}/offerings/${offering.id}/packages`, { lookup_key: '$rc_monthly', display_name: 'Monthly' })).json;
    log('created $rc_monthly package');
  }
  const pa = await rc('POST', `${P}/packages/${pkg.id}/actions/attach_products`,
    { products: [{ product_id: product.id, eligibility_criteria: 'all' }] }, { ok: [400, 409, 422] });
  log(`package ${pkg.lookup_key} in ${offering.lookup_key}: product ${pa.status < 300 ? 'attached' : 'already attached (' + pa.status + ')'}`);

  // ---- webhook ----
  if (!hooks.some((h) => h.url === cfg.webhookUrl)) {
    await rc('POST', `${P}/integrations/webhooks`, {
      name: 'SubSweep server', url: cfg.webhookUrl, authorization_header: webhookPassword(KEY), environment: null
    });
    log(`created webhook → ${cfg.webhookUrl}`);
  }

  // ---- the public key the app will use ----
  const keys = await items(`${P}/apps/${app.id}/public_api_keys`);
  for (const k of keys) log(`public SDK key (${k.environment}): ${k.key}`);
  log('\nDone.');
}

main().catch((err) => { console.error(`FAILED: ${err.message}`); process.exit(1); });
