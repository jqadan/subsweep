import fs from 'fs';
import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStatementCsv } from './lib/parse.js';
import { detectSubscriptions, refundEmail } from './lib/detect.js';
import { sampleTransactions } from './lib/sample.js';
import * as basiq from './lib/basiq.js';
import * as users from './lib/users.js';
import { createSessionCookie, clearSessionCookie, readSession, verifyToken } from './lib/sessions.js';
import { diffAnalyses, runMonitoringTick, CYCLE_DAYS } from './lib/monitor.js';
import { emailBackend } from './lib/email.js';
import {
  sendVerificationEmail, sendResetEmail, checkVerifyToken, checkResetToken, rateLimited
} from './lib/accountEmails.js';
import {
  stripeEnabled, refuseLiveKey, ensureCustomer,
  createSubscriptionCheckout, createPortalSession, verifyWebhookSignature
} from './lib/stripe.js';

refuseLiveKey();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const PORT = process.env.PORT || 3100;
const FREE_TIER_LIMIT = 3;

// ---- Stripe webhook FIRST: needs the raw body, before express.json() ----
app.post('/api/stripe/webhook', express.raw({ type: '*/*' }), (req, res) => {
  const check = verifyWebhookSignature(req.body.toString('utf8'), req.headers['stripe-signature']);
  if (!check.ok) return res.status(400).json({ error: check.error });
  let event;
  try {
    event = JSON.parse(req.body.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const obj = event.data?.object || {};
  const userId = obj.metadata?.userId || obj.subscription_details?.metadata?.userId;
  const customerId = typeof obj.customer === 'string' ? obj.customer : null;
  const user = (userId && users.findById(userId)) || (customerId && users.findByStripeCustomer(customerId));

  switch (event.type) {
    case 'checkout.session.completed':
    case 'invoice.paid':
      if (user) users.updateUser(user.id, { pro: true, proEndsAt: null, stripeCustomerId: customerId || user.stripeCustomerId });
      break;
    case 'customer.subscription.deleted':
      if (user) users.updateUser(user.id, { pro: false, proEndsAt: null });
      break;
    case 'customer.subscription.updated': {
      // Portal cancellations are "cancel at period end": the customer keeps
      // Pro until then, so we record the end date instead of dropping them.
      // Newer Stripe API versions express a scheduled cancellation as a
      // `cancel_at` timestamp (cancel_at_period_end stays false) and keep the
      // period end on the subscription item, so check every shape.
      const active = ['active', 'trialing', 'past_due'].includes(obj.status);
      const periodEnd = obj.current_period_end || obj.items?.data?.[0]?.current_period_end || null;
      const cancelTs = obj.cancel_at || (obj.cancel_at_period_end ? periodEnd : null);
      const endsAt = active && cancelTs ? new Date(cancelTs * 1000).toISOString() : null;
      if (user) users.updateUser(user.id, { pro: active, proEndsAt: endsAt });
      break;
    }
    default:
      break; // acknowledge everything else
  }
  res.json({ received: true });
});

app.use(express.json());

// ---- Static pages: marketing at /, app at /app ----
app.use(express.static(path.join(__dirname, 'public')));
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));

// Legal pages: static HTML with the operating entity filled in from env, so
// the business name/ABN live in Railway variables rather than in the copy.
const LEGAL = {
  ENTITY: process.env.LEGAL_ENTITY || 'SubSweep',
  ABN_CLAUSE: process.env.LEGAL_ABN ? ` (ABN ${process.env.LEGAL_ABN})` : '',
  EMAIL: process.env.CONTACT_EMAIL || (process.env.EMAIL_FROM || '').match(/<([^>]+)>/)?.[1] || process.env.EMAIL_FROM || 'hello@subsweep.com.au',
  EFFECTIVE: process.env.LEGAL_EFFECTIVE || '5 September 2026',
  YEAR: String(new Date().getFullYear())
};
for (const page of ['privacy', 'cdr-policy', 'terms']) {
  app.get(`/${page}`, (req, res) => {
    const html = fs.readFileSync(path.join(__dirname, 'public', 'legal', `${page}.html`), 'utf8')
      .replace(/{{(\w+)}}/g, (_, k) => LEGAL[k] ?? '');
    res.type('html').send(html);
  });
}

// ---- Anonymous per-browser working state (transactions stay in memory only,
// for logged-in and anonymous visitors alike) ----
const workspaces = new Map(); // key (user id or anon ssid) -> { transactions, source, basiqUserId, demoPro }

function getContext(req, res) {
  const userId = readSession(req);
  const user = userId ? users.findById(userId) : null;
  let key = user?.id;
  if (!key) {
    const cookie = (req.headers.cookie || '').match(/ssid=([a-f0-9-]{36})/);
    key = cookie?.[1];
    if (!key || !workspaces.has(key)) {
      key = crypto.randomUUID();
      res.setHeader('Set-Cookie', `ssid=${key}; Path=/; HttpOnly; SameSite=Lax`);
    }
  }
  if (!workspaces.has(key)) workspaces.set(key, { transactions: null, source: null, basiqUserId: null, demoPro: false });
  return { user, key, ws: workspaces.get(key) };
}

function isPro(ctx) {
  return ctx.user ? ctx.user.pro : ctx.ws.demoPro;
}

function buildAnalysis(ctx) {
  if (!ctx.ws.transactions?.length) return null;
  const result = detectSubscriptions(ctx.ws.transactions);
  const pro = isPro(ctx);
  const locked = !pro && result.subscriptions.length > FREE_TIER_LIMIT;
  const visible = pro ? result.subscriptions : result.subscriptions.slice(0, FREE_TIER_LIMIT);
  return {
    source: ctx.ws.source,
    pro,
    summary: result.summary,
    lockedCount: locked ? result.subscriptions.length - FREE_TIER_LIMIT : 0,
    subscriptions: visible.map((s) => ({
      ...s,
      refundEmail: s.flags.refundWindow && pro ? refundEmail(s) : null
    }))
  };
}

// ---- Auth ----
function baseUrlOf(req) {
  return process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
}

app.post('/api/auth/signup', (req, res) => {
  try {
    const user = users.createUser({ email: req.body?.email, password: req.body?.password });
    res.setHeader('Set-Cookie', createSessionCookie(user.id));
    // Fire-and-forget: a failed email must not block signup.
    sendVerificationEmail(user, baseUrlOf(req)).catch((err) =>
      console.error('[email] verification send failed:', err.message)
    );
    res.json({ user: users.publicUser(user) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/auth/verify', (req, res) => {
  const user = checkVerifyToken(req.query.token);
  if (!user) return res.status(400).send('This verification link is invalid or has expired. Request a new one from the app.');
  users.updateUser(user.id, { emailVerified: true });
  res.redirect('/app?verified=1');
});

app.post('/api/auth/resend-verification', (req, res) => {
  const ctx = getContext(req, res);
  if (!ctx.user) return res.status(401).json({ error: 'Log in first' });
  if (users.isVerified(ctx.user)) return res.json({ ok: true, alreadyVerified: true });
  if (rateLimited(`verify:${ctx.user.id}`)) return res.status(429).json({ error: 'A verification email was sent recently — check your inbox (and spam), or try again in a few minutes.' });
  sendVerificationEmail(ctx.user, baseUrlOf(req)).catch((err) =>
    console.error('[email] verification send failed:', err.message)
  );
  res.json({ ok: true });
});

app.post('/api/auth/forgot', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  // Always the same answer: no account enumeration.
  const reply = { ok: true, message: 'If an account exists for that email, a reset link is on its way.' };
  const user = email && users.findByEmail(email);
  if (user && !rateLimited(`reset:${user.id}`)) {
    sendResetEmail(user, baseUrlOf(req)).catch((err) =>
      console.error('[email] reset send failed:', err.message)
    );
  }
  res.json(reply);
});

app.post('/api/auth/reset', (req, res) => {
  const user = checkResetToken(req.body?.token);
  if (!user) return res.status(400).json({ error: 'This reset link is invalid, expired, or already used. Request a new one.' });
  const password = String(req.body?.password || '');
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  users.updateUser(user.id, { passwordHash: users.hashPassword(password), emailVerified: true });
  res.setHeader('Set-Cookie', createSessionCookie(user.id));
  res.json({ user: users.publicUser(users.findById(user.id)) });
});

app.post('/api/auth/login', (req, res) => {
  const user = users.findByEmail(req.body?.email || '');
  if (!user || !users.verifyPassword(req.body?.password || '', user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  res.setHeader('Set-Cookie', createSessionCookie(user.id));
  res.json({ user: users.publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', clearSessionCookie());
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const ctx = getContext(req, res);
  res.json({ user: users.publicUser(ctx.user) });
});

// ---- Config ----
app.get('/api/config', (req, res) => {
  const ctx = getContext(req, res);
  res.json({
    bankConnect: basiq.basiqEnabled() ? 'available' : 'not-configured',
    billing: stripeEnabled() ? 'stripe-test' : 'demo',
    pro: isPro(ctx),
    proEndsAt: ctx.user?.proEndsAt || null,
    loggedIn: Boolean(ctx.user),
    email: ctx.user?.email || null,
    verified: ctx.user ? users.isVerified(ctx.user) : null,
    freeTierLimit: FREE_TIER_LIMIT
  });
});

// ---- Data in ----
app.post('/api/statement', upload.single('file'), (req, res) => {
  const ctx = getContext(req, res);
  try {
    const text = req.file ? req.file.buffer.toString('utf8') : String(req.body?.csv || '');
    if (!text.trim()) return res.status(400).json({ error: 'No CSV content received' });
    const { transactions, warnings } = parseStatementCsv(text);
    if (!transactions.length) return res.status(400).json({ error: warnings.join(' ') });
    ctx.ws.transactions = transactions;
    ctx.ws.source = 'statement';
    res.json({ ok: true, transactionCount: transactions.length, warnings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sample', (req, res) => {
  const ctx = getContext(req, res);
  ctx.ws.transactions = sampleTransactions();
  ctx.ws.source = 'sample';
  res.json({ ok: true, transactionCount: ctx.ws.transactions.length });
});

app.get('/api/analysis', (req, res) => {
  const ctx = getContext(req, res);
  const analysis = buildAnalysis(ctx);
  if (!analysis) {
    // Logged-in users get their last saved (derived) analysis back
    if (ctx.user?.savedAnalysis) {
      const saved = ctx.user.savedAnalysis;
      const scanAgeDays = saved.savedAt ? Math.floor((Date.now() - new Date(saved.savedAt).getTime()) / 86400000) : null;
      return res.json({ ...saved, restored: true, scanAgeDays, rescanDue: scanAgeDays !== null && scanAgeDays >= CYCLE_DAYS });
    }
    return res.json({ empty: true });
  }
  // Persist the derived analysis (never raw transactions) for account
  // holders, diffing against the previous scan for "since last scan".
  analysis.savedAt = new Date().toISOString();
  if (ctx.user) {
    const changes = diffAnalyses(ctx.user.savedAnalysis, analysis);
    if (changes) analysis.changes = changes;
    users.updateUser(ctx.user.id, {
      savedAnalysis: analysis,
      monitoring: { ...ctx.user.monitoring, lastScanAt: analysis.savedAt }
    });
  }
  res.json(analysis);
});

// ---- Monitoring ----
app.get('/api/monitoring', (req, res) => {
  const ctx = getContext(req, res);
  if (!ctx.user) return res.status(401).json({ error: 'Log in to manage monitoring' });
  res.json({ monitoring: ctx.user.monitoring, cycleDays: CYCLE_DAYS, emailBackend: emailBackend() });
});

app.post('/api/monitoring', (req, res) => {
  const ctx = getContext(req, res);
  if (!ctx.user) return res.status(401).json({ error: 'Create an account to enable monthly monitoring' });
  const enabled = Boolean(req.body?.enabled);
  const monitoring = { ...ctx.user.monitoring, enabled };
  users.updateUser(ctx.user.id, { monitoring });
  res.json({ monitoring, cycleDays: CYCLE_DAYS });
});

app.get('/api/monitoring/unsubscribe', (req, res) => {
  const data = verifyToken(req.query.token);
  const user = data?.unsub ? users.findById(data.unsub) : null;
  if (!user) return res.status(400).send('Invalid or expired unsubscribe link.');
  users.updateUser(user.id, { monitoring: { ...user.monitoring, enabled: false } });
  res.send('Monthly reminders are off. You can re-enable monitoring any time in the app.');
});

// ---- Bank connect (Basiq, sandbox-ready) ----
app.post('/api/bank/connect', async (req, res) => {
  const ctx = getContext(req, res);
  if (!basiq.basiqEnabled()) {
    return res.status(400).json({ error: 'Bank connect is not configured (set BASIQ_API_KEY). Use statement upload instead.' });
  }
  try {
    if (!ctx.ws.basiqUserId) {
      if (ctx.user?.basiqUserId) {
        ctx.ws.basiqUserId = ctx.user.basiqUserId;
      } else {
        const email = ctx.user?.email || `subsweep+${ctx.key.slice(0, 8)}@example.com`;
        const bUser = await basiq.createUser(email);
        ctx.ws.basiqUserId = bUser.id;
        // Persist for account holders so monitoring can auto-sync monthly
        if (ctx.user) users.updateUser(ctx.user.id, { basiqUserId: bUser.id });
      }
    }
    const token = await basiq.clientToken(ctx.ws.basiqUserId);
    res.json({ consentUrl: `https://consent.basiq.io/home?token=${encodeURIComponent(token)}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function basiqUserFor(ctx) {
  if (!ctx.ws.basiqUserId && ctx.user?.basiqUserId) ctx.ws.basiqUserId = ctx.user.basiqUserId;
  return ctx.ws.basiqUserId;
}

// Which bank(s) this session is connected to — drives the connect / re-sync /
// disconnect buttons so users always know what state they're in.
app.get('/api/bank/status', async (req, res) => {
  const ctx = getContext(req, res);
  if (!basiq.basiqEnabled()) return res.json({ configured: false, connected: false, connections: [] });
  const basiqUserId = basiqUserFor(ctx);
  if (!basiqUserId) return res.json({ configured: true, connected: false, connections: [] });
  try {
    const connections = await basiq.getConnectionSummaries(basiqUserId);
    res.json({ configured: true, connected: connections.length > 0, connections, source: ctx.ws.source });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remove the bank connection(s) so the user can connect a different bank.
app.post('/api/bank/disconnect', async (req, res) => {
  const ctx = getContext(req, res);
  const basiqUserId = basiq.basiqEnabled() ? basiqUserFor(ctx) : null;
  if (!basiqUserId) return res.json({ ok: true, removed: 0 });
  try {
    const removed = await basiq.deleteAllConnections(basiqUserId);
    if (ctx.ws.source === 'bank') { ctx.ws.transactions = null; ctx.ws.source = null; }
    res.json({ ok: true, removed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/bank/sync', async (req, res) => {
  const ctx = getContext(req, res);
  if (!basiq.basiqEnabled() || !basiqUserFor(ctx)) {
    return res.status(400).json({ error: 'No bank connection in this session' });
  }
  try {
    const connections = await basiq.getConnections(ctx.ws.basiqUserId);
    if (!connections.length) return res.json({ ok: false, reason: 'no-connections' });
    const transactions = await basiq.getTransactions(ctx.ws.basiqUserId);
    if (!transactions.length) return res.json({ ok: false, reason: 'no-transactions-yet' });
    ctx.ws.transactions = transactions;
    ctx.ws.source = 'bank';
    res.json({ ok: true, transactionCount: transactions.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Billing ----
app.post('/api/billing/upgrade', async (req, res) => {
  const ctx = getContext(req, res);
  try {
    if (stripeEnabled()) {
      if (!ctx.user) return res.status(401).json({ error: 'Create an account first so your subscription has somewhere to live.' });
      const customerId = await ensureCustomer(ctx.user);
      if (customerId !== ctx.user.stripeCustomerId) users.updateUser(ctx.user.id, { stripeCustomerId: customerId });
      const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
      const session = await createSubscriptionCheckout({ customerId, userId: ctx.user.id, baseUrl });
      return res.json({ mode: 'stripe-test', checkoutUrl: session.url });
    }
    // Demo mode: simulated upgrade, no card details anywhere
    if (ctx.user) users.updateUser(ctx.user.id, { pro: true });
    else ctx.ws.demoPro = true;
    res.json({ mode: 'demo', pro: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/billing/portal', async (req, res) => {
  const ctx = getContext(req, res);
  if (!stripeEnabled()) return res.status(400).json({ error: 'Stripe is not configured' });
  if (!ctx.user?.stripeCustomerId) return res.status(400).json({ error: 'No billing profile yet' });
  try {
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const session = await createPortalSession({ customerId: ctx.user.stripeCustomerId, baseUrl });
    res.json({ portalUrl: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Hourly monitoring tick (each user acts at most once per 30-day cycle)
const TICK_MS = 60 * 60 * 1000;
if (process.env.DISABLE_MONITORING_TICK !== '1') {
  setInterval(() => {
    runMonitoringTick().then((r) => {
      if (r.length) console.log('[monitoring]', JSON.stringify(r));
    }).catch((err) => console.error('[monitoring] tick failed:', err.message));
  }, TICK_MS).unref();
}

app.listen(PORT, () => {
  console.log(`SubSweep running at http://localhost:${PORT}`);
  console.log(`Bank connect: ${basiq.basiqEnabled() ? 'Basiq configured' : 'not configured (statement upload only)'}`);
  console.log(`Billing: ${stripeEnabled() ? 'Stripe TEST subscriptions + webhooks' : 'demo (simulated upgrade)'}`);
  console.log(`Monitoring: hourly tick, ${CYCLE_DAYS}-day cycle, email via ${emailBackend()}`);
});
