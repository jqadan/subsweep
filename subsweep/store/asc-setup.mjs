// Sets up SubSweep Pro in App Store Connect through the App Store Connect API,
// using the same Admin API key CI already signs builds with. Run by
// .github/workflows/appstore-setup.yml whenever store/asc-setup.json changes.
//
//   mode "inspect"  read-only: what exists now (subscriptions, version, builds)
//   mode "apply"    create what is missing, then update the review notes and
//                   description from store/app-store-listing.md
//
// Idempotent: anything that already exists is reused, never duplicated.
// Things the API cannot do — accepting the Paid Apps Agreement, bank and tax
// details, and pressing Submit for Review — stay with the account holder.
import crypto from 'node:crypto';
import fs from 'node:fs';

const cfg = JSON.parse(fs.readFileSync(new URL('./asc-setup.json', import.meta.url)));
const BUNDLE_ID = 'au.com.subsweep.app';
const API = 'https://api.appstoreconnect.apple.com';

// ---- auth: ES256 JWT, valid 15 minutes ----
const b64url = (b) => Buffer.from(b).toString('base64url');
function token() {
  const key = fs.readFileSync(process.env.ASC_KEY_PATH, 'utf8');
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'ES256', kid: process.env.ASC_KEY_ID, typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iss: process.env.ASC_ISSUER_ID, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' }));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${b64url(sig)}`;
}

async function api(method, path, data) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: data ? JSON.stringify({ data }) : undefined
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const why = (json.errors || []).map((e) => `${e.title}: ${e.detail}`).join(' | ') || text;
    throw new Error(`${method} ${path} → ${res.status} ${why}`);
  }
  return json;
}
const rel = (type, id) => ({ data: { type, id } });

// ---- the listing text, read from the doc so there is one source ----
function listingBlocks() {
  const md = fs.readFileSync(new URL('./app-store-listing.md', import.meta.url), 'utf8');
  const blocks = [...md.matchAll(/```\n([\s\S]*?)\n```/g)].map((m) => m[1]);
  return { promo: blocks[0], description: blocks[1], keywords: blocks[2], notes: blocks[3] };
}

const log = (...a) => console.log(...a);

async function main() {
  log(`mode: ${cfg.mode}`);
  const apps = await api('GET', `/v1/apps?filter[bundleId]=${BUNDLE_ID}`);
  const app = apps.data[0];
  if (!app) throw new Error(`No app with bundle id ${BUNDLE_ID}`);
  log(`app: ${app.attributes.name} (${app.id})`);

  // ---- subscription group + subscription ----
  const groups = await api('GET', `/v1/apps/${app.id}/subscriptionGroups?include=subscriptions&limit=50`);
  log(`subscription groups: ${groups.data.map((g) => g.attributes.referenceName).join(', ') || 'none'}`);
  for (const s of groups.included || []) {
    log(`  subscription: ${s.attributes.name} · ${s.attributes.productId} · ${s.attributes.subscriptionPeriod} · state ${s.attributes.state}`);
  }

  // ---- version + build ----
  const versions = await api('GET', `/v1/apps/${app.id}/appStoreVersions?filter[platform]=IOS&limit=5`);
  const version = versions.data.find((v) => !['READY_FOR_SALE', 'REPLACED_WITH_NEW_VERSION', 'REMOVED_FROM_SALE'].includes(v.attributes.appStoreState));
  for (const v of versions.data) log(`version ${v.attributes.versionString}: ${v.attributes.appStoreState}`);
  const builds = await api('GET', `/v1/builds?filter[app]=${app.id}&sort=-uploadedDate&limit=5`);
  for (const b of builds.data) log(`build ${b.attributes.version}: ${b.attributes.processingState}${b.attributes.expired ? ' (expired)' : ''}`);
  if (version) {
    const vb = await api('GET', `/v1/appStoreVersions/${version.id}/build`).catch(() => ({ data: null }));
    log(`version ${version.attributes.versionString} is using build: ${vb.data?.attributes?.version || 'none'}`);
  }

  if (cfg.mode !== 'apply') return log('\ninspect only — nothing changed.');

  // ================= apply =================
  const sub = cfg.subscription;
  let group = groups.data.find((g) => g.attributes.referenceName === sub.groupName);
  if (!group) {
    group = (await api('POST', '/v1/subscriptionGroups', {
      type: 'subscriptionGroups', attributes: { referenceName: sub.groupName }, relationships: { app: rel('apps', app.id) }
    })).data;
    log(`created group ${sub.groupName}`);
  }
  const glocs = await api('GET', `/v1/subscriptionGroups/${group.id}/subscriptionGroupLocalizations`);
  if (!glocs.data.some((l) => l.attributes.locale === sub.locale)) {
    await api('POST', '/v1/subscriptionGroupLocalizations', {
      type: 'subscriptionGroupLocalizations', attributes: { name: sub.displayName, locale: sub.locale },
      relationships: { subscriptionGroup: rel('subscriptionGroups', group.id) }
    });
    log('  + group localisation');
  }

  let subscription = (groups.included || []).find((s) => s.attributes.productId === sub.productId);
  if (!subscription) {
    subscription = (await api('POST', '/v1/subscriptions', {
      type: 'subscriptions',
      attributes: { name: sub.referenceName, productId: sub.productId, subscriptionPeriod: 'ONE_MONTH', groupLevel: 1, reviewNote: sub.reviewNote },
      relationships: { group: rel('subscriptionGroups', group.id) }
    })).data;
    log(`created subscription ${sub.productId}`);
  }

  const locs = await api('GET', `/v1/subscriptions/${subscription.id}/subscriptionLocalizations`);
  if (!locs.data.some((l) => l.attributes.locale === sub.locale)) {
    await api('POST', '/v1/subscriptionLocalizations', {
      type: 'subscriptionLocalizations', attributes: { name: sub.displayName, description: sub.description, locale: sub.locale },
      relationships: { subscription: rel('subscriptions', subscription.id) }
    });
    log('  + subscription localisation');
  }

  // Availability: Australia only, matching the app.
  const avail = await api('GET', `/v1/subscriptions/${subscription.id}/subscriptionAvailability`).catch(() => ({ data: null }));
  if (!avail.data) {
    await api('POST', '/v1/subscriptionAvailabilities', {
      type: 'subscriptionAvailabilities', attributes: { availableInNewTerritories: false },
      relationships: { subscription: rel('subscriptions', subscription.id), availableTerritories: { data: [{ type: 'territories', id: 'AUS' }] } }
    });
    log('  + availability: Australia');
  }

  // Price: find the Australian price point matching the configured price.
  const prices = await api('GET', `/v1/subscriptions/${subscription.id}/prices?include=subscriptionPricePoint,territory&limit=50`);
  if (!prices.data.length) {
    let point = null;
    let next = `/v1/subscriptions/${subscription.id}/pricePoints?filter[territory]=AUS&limit=200`;
    while (next && !point) {
      const page = await api('GET', next);
      point = page.data.find((p) => Number(p.attributes.customerPrice) === Number(sub.priceAUD));
      next = page.links?.next ? page.links.next.replace(API, '') : null;
    }
    if (!point) throw new Error(`No Australian price point at A$${sub.priceAUD}`);
    await api('POST', '/v1/subscriptionPrices', {
      type: 'subscriptionPrices', attributes: { preserveCurrentPrice: false },
      relationships: {
        subscription: rel('subscriptions', subscription.id),
        subscriptionPricePoint: rel('subscriptionPricePoints', point.id),
        territory: rel('territories', 'AUS')
      }
    });
    log(`  + price: A$${point.attributes.customerPrice} (proceeds A$${point.attributes.proceeds})`);
  }

  // Review screenshot of the purchase screen (required for the subscription's review).
  const shots = await api('GET', `/v1/subscriptions/${subscription.id}/appStoreReviewScreenshot`).catch(() => ({ data: null }));
  if (!shots.data && cfg.reviewScreenshot) {
    const file = fs.readFileSync(new URL(cfg.reviewScreenshot, import.meta.url));
    const res = (await api('POST', '/v1/subscriptionAppStoreReviewScreenshots', {
      type: 'subscriptionAppStoreReviewScreenshots', attributes: { fileName: 'purchase-screen.png', fileSize: file.length },
      relationships: { subscription: rel('subscriptions', subscription.id) }
    })).data;
    for (const op of res.attributes.uploadOperations) {
      const part = file.subarray(op.offset, op.offset + op.length);
      const headers = Object.fromEntries((op.requestHeaders || []).map((h) => [h.name, h.value]));
      const up = await fetch(op.url, { method: op.method, headers, body: part });
      if (!up.ok) throw new Error(`screenshot upload part failed: ${up.status}`);
    }
    await api('PATCH', `/v1/subscriptionAppStoreReviewScreenshots/${res.id}`, {
      type: 'subscriptionAppStoreReviewScreenshots', id: res.id,
      attributes: { uploaded: true, sourceFileChecksum: crypto.createHash('md5').update(file).digest('hex') }
    });
    log('  + review screenshot uploaded');
  }

  // ---- version 1.0: notes, description, build ----
  if (!version) return log('No editable version found — skipped notes, description and build.');
  const text = listingBlocks();
  const detail = await api('GET', `/v1/appStoreVersions/${version.id}/appStoreReviewDetail`).catch(() => ({ data: null }));
  if (detail.data) {
    await api('PATCH', `/v1/appStoreReviewDetails/${detail.data.id}`, {
      type: 'appStoreReviewDetails', id: detail.data.id, attributes: { notes: text.notes }
    });
    log('updated App Review notes');
  }
  const vlocs = await api('GET', `/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`);
  for (const l of vlocs.data) {
    await api('PATCH', `/v1/appStoreVersionLocalizations/${l.id}`, {
      type: 'appStoreVersionLocalizations', id: l.id, attributes: { description: text.description, promotionalText: text.promo }
    });
    log(`updated description + promotional text (${l.attributes.locale})`);
  }
  if (cfg.build) {
    const b = builds.data.find((x) => x.attributes.version === String(cfg.build));
    if (!b) throw new Error(`build ${cfg.build} not found`);
    await api('PATCH', `/v1/appStoreVersions/${version.id}/relationships/build`, { type: 'builds', id: b.id });
    log(`version now uses build ${cfg.build}`);
  }
  log('\nDone. Still yours: Paid Apps Agreement, then add the subscription to version 1.0 and Submit for Review.');
}

main().catch((err) => { console.error(`FAILED: ${err.message}`); process.exit(1); });
