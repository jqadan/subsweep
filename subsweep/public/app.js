const $ = (s) => document.querySelector(s);

let config = { billing: 'demo', bankConnect: 'not-configured', pro: false, freeTierLimit: 3 };

// ---------- native app shell ----------
// Inside the iOS/Android apps (see mobile/) this same file runs from a bundled
// WebView: API calls go to the live server with a bearer token and a pinned
// workspace id instead of cookies, external pages open in the system browser,
// and there is no purchase flow because the app stores require their own
// billing for in-app subscriptions. Pro bought on the website still applies.
//
// The build injects SUBSWEEP_API into the bundled app and nowhere else, so its
// presence is what identifies the native shell. Do NOT gate this on
// Capacitor's bridge: if that has not initialised by the time this script
// runs, every request would be aimed at https://localhost, where nothing is
// listening, and the whole app fails with "Failed to fetch".
const API_BASE = (window.SUBSWEEP_API || '').replace(/\/+$/, '');
const NATIVE = Boolean(API_BASE) || Boolean(window.Capacitor?.isNativePlatform?.());
const CONSENT_WHERE = NATIVE ? 'in the browser' : 'in the other tab';
const PRO_NOTE = 'This account is on the free plan. SubSweep Pro accounts see every subscription, plus refund-request emails and monthly monitoring.';
let authToken = null;
let workspaceId = null;

// Capacitor plugins, each with a browser fallback so a missing or late bridge
// degrades one feature instead of breaking startup.
const plugin = (name) => window.Capacitor?.Plugins?.[name] || null;
const store = {
  async get(key) {
    const p = plugin('Preferences');
    if (p) return (await p.get({ key })).value ?? null;
    try { return localStorage.getItem(key); } catch { return null; }
  },
  async set(key, value) {
    const p = plugin('Preferences');
    if (p) return p.set({ key, value });
    try { localStorage.setItem(key, value); } catch { /* private mode */ }
  },
  async remove(key) {
    const p = plugin('Preferences');
    if (p) return p.remove({ key });
    try { localStorage.removeItem(key); } catch { /* private mode */ }
  }
};

function newWorkspaceId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

async function loadNativeSession() {
  authToken = await store.get('authToken');
  workspaceId = await store.get('workspaceId');
  if (!workspaceId) {
    workspaceId = newWorkspaceId();
    await store.set('workspaceId', workspaceId);
  }
}

async function saveAuthToken(token) {
  authToken = token || null;
  if (token) await store.set('authToken', token);
  else await store.remove('authToken');
}

function openExternal(url) {
  const browser = plugin('Browser');
  if (browser) return browser.open({ url });
  window.open(url, '_blank', 'noopener');
  return Promise.resolve();
}

// Returns a listener handle, or null when the plugin isn't there.
function nativeListen(name, event, handler) {
  const p = plugin(name);
  return p?.addListener ? p.addListener(event, handler) : null;
}

if (NATIVE) {
  document.body.classList.add('native');
  document.addEventListener('click', (e) => {
    const link = e.target.closest?.('a[target="_blank"]');
    if (!link?.href) return;
    e.preventDefault();
    openExternal(link.href);
  });
}

const aud = (n) => n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });

function toast(msg, kind = 'ok', ms = 5000) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.hidden = true), ms);
}

async function api(path, opts = {}) {
  if (NATIVE) {
    const headers = { ...(opts.headers || {}), 'X-SubSweep-Client': 'native', 'X-Workspace': workspaceId };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    opts = { ...opts, headers };
  }
  let res;
  try {
    res = await fetch(API_BASE + path, opts);
  } catch {
    // fetch only rejects for network-level failures — no connectivity, DNS,
    // TLS, or a cross-origin request the browser refused. Its own message
    // ("Failed to fetch") tells the user nothing, so say something useful.
    const host = (API_BASE || location.origin).replace(/^https?:\/\//, '');
    throw new Error(`Can't reach ${host} — check your connection and try again.`);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

// ---------- data sources ----------
$('#fileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const form = new FormData();
  form.append('file', file);
  try {
    const out = await api('/api/statement', { method: 'POST', body: form });
    toast(`Parsed ${out.transactionCount} transactions`);
    loadAnalysis();
  } catch (err) {
    toast(err.message, 'err', 8000);
  }
  e.target.value = '';
});

$('#sampleBtn').addEventListener('click', async () => {
  const out = await api('/api/sample', { method: 'POST' });
  toast(`Loaded sample statement (${out.transactionCount} transactions)`);
  loadAnalysis();
});

// ---------- bank connect ----------
// Basiq consent happens in a separate tab, so we poll /api/bank/sync until a
// connection with transactions shows up (or the user gives up), and also retry
// the moment this tab regains focus.
const bankButtons = () =>
  ['#bankConnectBtn', '#resultsBankBtn', '#bankResyncBtn', '#bankDisconnectBtn', '#resultsDisconnectBtn']
    .map((sel) => $(sel)).filter(Boolean);
let bankPoll = null;
let bankState = { configured: false, connected: false, connections: [] };

function bankNames() {
  return bankState.connections.map((c) => c.institution).join(', ') || 'your bank';
}

function renderBankState() {
  const connected = bankState.configured && bankState.connected;
  $('#bankNotConnected').hidden = connected;
  $('#bankConnected').hidden = !connected;
  $('#bankName').textContent = bankNames();
  $('#resultsBankBtn').textContent = connected ? `🔄 Re-sync ${bankNames()}` : '🏦 Connect bank';
  $('#resultsDisconnectBtn').hidden = !connected;
}

async function refreshBankStatus() {
  if (config.bankConnect !== 'available') return;
  try {
    bankState = await api('/api/bank/status');
  } catch {
    bankState = { configured: true, connected: false, connections: [] };
  }
  renderBankState();
}

// Shows the waiting message in both the onboarding card and the results
// toolbar, with a Cancel link so the user is never stuck in the poll.
function setBankStatus(msg, { cancellable = false } = {}) {
  const targets = [$('#bankStatus'), config.bankConnect === 'available' ? $('#bankHint') : null].filter(Boolean);
  for (const el of targets) {
    el.hidden = !msg;
    el.textContent = msg || '';
    if (msg && cancellable) {
      el.append(' ');
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'linklike';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => {
        stopBankPoll();
        toast('Stopped waiting. Click Connect bank whenever you are ready.', 'ok', 6000);
      });
      el.append(cancel);
    }
  }
}

function stopBankPoll() {
  if (!bankPoll) return;
  clearInterval(bankPoll.timer);
  document.removeEventListener('visibilitychange', bankPoll.onFocus);
  window.removeEventListener('focus', bankPoll.onFocus);
  for (const h of bankPoll.handles || []) Promise.resolve(h).then((handle) => handle.remove());
  bankPoll = null;
  bankButtons().forEach((b) => { b.disabled = false; b.classList.remove('waiting'); });
  setBankStatus('');
}

async function trySync() {
  if (!bankPoll || bankPoll.busy) return false;
  bankPoll.busy = true;
  try {
    const sync = await api('/api/bank/sync', { method: 'POST' });
    if (sync.ok) {
      stopBankPoll();
      await refreshBankStatus();
      toast(`Connected to ${bankNames()} — synced ${sync.transactionCount} transactions`);
      await loadAnalysis();
      return true;
    }
    setBankStatus(sync.reason === 'no-transactions-yet'
      ? 'Bank connected — waiting for transactions to arrive…'
      : `Waiting for you to finish the bank consent ${CONSENT_WHERE}…`, { cancellable: true });
  } catch (err) {
    // Session lost its Basiq user (e.g. server restart): stop and let the user retry.
    stopBankPoll();
    toast(err.message, 'err', 8000);
  } finally {
    if (bankPoll) bankPoll.busy = false;
  }
  return false;
}

function startBankPoll() {
  stopBankPoll();
  const started = Date.now();
  const MAX_MS = 15 * 60 * 1000;
  bankPoll = { busy: false, timer: null, onFocus: null };
  bankPoll.onFocus = () => { if (!document.hidden) trySync(); };
  bankPoll.timer = setInterval(async () => {
    if (Date.now() - started > MAX_MS) {
      stopBankPoll();
      toast('Still no bank connection. Click Connect bank again when you have finished the consent.', 'err', 10000);
      return;
    }
    trySync();
  }, 5000);
  document.addEventListener('visibilitychange', bankPoll.onFocus);
  window.addEventListener('focus', bankPoll.onFocus);
  if (NATIVE) {
    // Coming back from the system browser does not always fire focus events.
    bankPoll.handles = [
      nativeListen('App', 'appStateChange', ({ isActive }) => { if (isActive) trySync(); }),
      nativeListen('Browser', 'browserFinished', () => trySync())
    ].filter(Boolean);
  }
  // Connect bank stays clickable (it re-opens the consent tab); only the
  // re-sync / disconnect actions pause while we wait.
  bankButtons().forEach((b) => {
    b.classList.add('waiting');
    if (!['bankConnectBtn', 'resultsBankBtn'].includes(b.id)) b.disabled = true;
  });
  setBankStatus(`Waiting for you to finish the bank consent ${CONSENT_WHERE}…`, { cancellable: true });
}

async function connectBank() {
  // Already connected? The button reads "Re-sync" — just pull fresh data.
  if (bankState.connected && !bankPoll) return resyncBank();
  // Clicking again while waiting starts a fresh consent (new token, new tab).
  stopBankPoll();
  try {
    const out = await api('/api/bank/connect', { method: 'POST' });
    if (NATIVE) {
      await openExternal(out.consentUrl);
    } else {
      const tab = window.open(out.consentUrl, '_blank');
      if (!tab) {
        toast('Your browser blocked the consent window — allow pop-ups for this site and try again.', 'err', 10000);
        return;
      }
    }
    toast(`Complete the bank consent ${CONSENT_WHERE} — this page will update automatically.`, 'ok', 8000);
    startBankPoll();
  } catch (err) {
    toast(err.message, 'err', 8000);
  }
}

async function resyncBank() {
  const btns = bankButtons();
  btns.forEach((b) => { b.disabled = true; });
  try {
    const sync = await api('/api/bank/sync', { method: 'POST' });
    if (sync.ok) {
      toast(`Re-synced ${sync.transactionCount} transactions from ${bankNames()}`);
      await loadAnalysis();
    } else if (sync.reason === 'no-connections') {
      toast('No bank connection found — click Connect bank to start a new consent.', 'err', 8000);
      await refreshBankStatus();
    } else {
      toast('Bank connected but no transactions available yet — try again in a minute.', 'err', 8000);
    }
  } catch (err) {
    toast(err.message, 'err', 8000);
  } finally {
    btns.forEach((b) => { b.disabled = false; });
  }
}

async function disconnectBank() {
  const ok = confirm(`Disconnect ${bankNames()}?\n\nThis removes the bank connection from SubSweep and Basiq. ` +
    'Your saved results stay in your account. You can then connect the same or a different bank.');
  if (!ok) return;
  const btns = bankButtons();
  btns.forEach((b) => { b.disabled = true; });
  try {
    stopBankPoll();
    await api('/api/bank/disconnect', { method: 'POST' });
    await refreshBankStatus();
    toast('Bank disconnected. Click Connect bank to connect a different bank.', 'ok', 8000);
    $('#results').hidden = true;
    $('#onboarding').hidden = false;
    window.scrollTo({ top: 0 });
  } catch (err) {
    toast(err.message, 'err', 8000);
  } finally {
    btns.forEach((b) => { b.disabled = false; });
  }
}

$('#bankConnectBtn').addEventListener('click', connectBank);
$('#resultsBankBtn').addEventListener('click', connectBank);
$('#bankResyncBtn').addEventListener('click', resyncBank);
$('#bankDisconnectBtn').addEventListener('click', disconnectBank);
$('#resultsDisconnectBtn').addEventListener('click', disconnectBank);

$('#resetBtn').addEventListener('click', () => {
  $('#results').hidden = true;
  $('#onboarding').hidden = false;
  window.scrollTo({ top: 0 });
});

// ---------- analysis ----------
async function loadAnalysis() {
  const data = await api('/api/analysis');
  if (data.empty) return;

  $('#onboarding').hidden = true;
  $('#results').hidden = false;

  const s = data.summary;
  $('#summary').innerHTML = `
    <div>
      <span class="lbl">You're paying subscriptions worth</span>
      <span class="big">${aud(s.totalAnnual)}/yr</span>
      <span class="lbl">${aud(s.totalMonthly)} per month · ${s.count} recurring charges found · ${
        data.source === 'sample' ? 'sample data' : data.source === 'bank' ? 'live bank data' : 'your statement'
      }</span>
    </div>
    <div class="stat"><span class="lbl">Refund window</span><div class="val">${s.refundWindowCount} charge${s.refundWindowCount === 1 ? '' : 's'}</div></div>
    <div class="stat"><span class="lbl">Price hikes</span><div class="val">${s.priceHikeCount}</div></div>`;

  // Re-scan banner for stale restored results
  const banner = $('#rescanBanner');
  if (data.restored && data.rescanDue) {
    banner.hidden = false;
    banner.innerHTML = `⏰ These results are ${data.scanAgeDays} days old — new charges and price
      hikes may have crept in. <button class="btn" id="bannerRescan" style="padding:6px 14px;font-size:13px">Re-scan now</button>`;
    banner.querySelector('#bannerRescan').addEventListener('click', () => {
      $('#results').hidden = true;
      $('#onboarding').hidden = false;
    });
  } else banner.hidden = true;

  // "Since your last scan" diff
  const panel = $('#changesPanel');
  if (data.changes) {
    const c = data.changes;
    const items = [
      ...c.added.map((a) => `<li class="add">＋ New subscription: <strong>${a.name}</strong> (${aud(a.monthlyCost)}/mo)</li>`),
      ...c.priceChanges.map((p) => `<li class="chg">↕ <strong>${p.name}</strong>: ${aud(p.from)} → ${aud(p.to)} (${p.deltaPct > 0 ? '+' : ''}${p.deltaPct}%)</li>`),
      ...c.removed.map((r) => `<li class="gone">－ Gone: <strong>${r.name}</strong> (was ${aud(r.monthlyCost)}/mo)</li>`)
    ];
    panel.hidden = false;
    panel.innerHTML = `<h3>Since your last scan${c.since ? ` (${new Date(c.since).toLocaleDateString('en-AU')})` : ''} —
      monthly total ${c.monthlyDelta > 0 ? 'up' : 'down'} <strong>${aud(Math.abs(c.monthlyDelta))}</strong></h3>
      <ul>${items.join('')}</ul>`;
  } else panel.hidden = true;

  renderMonitorBar();

  const list = $('#subList');
  list.innerHTML = '';
  for (const sub of data.subscriptions) list.appendChild(renderSub(sub));

  const upsell = $('#upsell');
  if (data.lockedCount > 0 && NATIVE) {
    // Store rules: no purchase buttons or links to outside billing in the app.
    upsell.hidden = false;
    upsell.innerHTML = `
      <h3>🔒 ${data.lockedCount} more subscription${data.lockedCount === 1 ? '' : 's'} found</h3>
      <p>${PRO_NOTE}</p>`;
  } else if (data.lockedCount > 0) {
    upsell.hidden = false;
    upsell.innerHTML = `
      <h3>🔒 ${data.lockedCount} more subscription${data.lockedCount === 1 ? '' : 's'} found</h3>
      <p>Upgrade to SubSweep Pro to see everything, get refund-request emails, and keep monitoring for new charges.</p>
      <button class="btn primary" id="upgradeBtn">
        ${stripeBilling() ? `Upgrade — A$9.99/mo${config.billing === 'stripe-test' ? ' (test mode)' : ''}` : 'Upgrade to Pro (demo — simulated)'}
      </button>`;
    $('#upgradeBtn').addEventListener('click', upgrade);
  } else {
    upsell.hidden = true;
  }
}

function renderSub(sub) {
  const el = document.createElement('div');
  el.className = 'sub';
  const badges = [
    `<span class="badge cadence">${sub.cadence} · ${sub.chargeCount} charges</span>`,
    sub.flags.refundWindow ? `<span class="badge refund">💸 charged ${sub.daysSinceLast}d ago — refund window</span>` : '',
    sub.flags.priceHike ? `<span class="badge hike">📈 price up ${sub.flags.priceHikePct}%</span>` : '',
    sub.flags.possiblyLapsed ? `<span class="badge lapsed">💤 no charge for ${sub.daysSinceLast}d — may be cancelled</span>` : ''
  ].join('');

  const actions = [];
  if (sub.cancelUrl) actions.push(`<a class="btn" href="${sub.cancelUrl}" target="_blank" rel="noopener">Cancel guide ↗</a>`);
  if (sub.flags.refundWindow) {
    actions.push(
      sub.refundEmail
        ? `<button class="btn" data-email>Refund email</button>`
        : `<button class="btn" data-locked>Refund email (Pro)</button>`
    );
  }

  el.innerHTML = `
    <div class="sub-head">
      <div>
        <div class="sub-name">${sub.name}</div>
        <div class="sub-cat">${sub.category} · last charged ${sub.lastCharge}</div>
      </div>
      <div class="sub-cost">
        <div class="m">${aud(sub.monthlyCost)}/mo</div>
        <div class="y">${aud(sub.annualCost)}/yr at current price</div>
      </div>
    </div>
    <div class="badges">${badges}</div>
    <div class="sub-actions">${actions.join('')}</div>
    <div class="email-box"></div>`;

  const emailBtn = el.querySelector('[data-email]');
  if (emailBtn) {
    emailBtn.addEventListener('click', () => {
      const box = el.querySelector('.email-box');
      box.classList.toggle('open');
      box.textContent = `Subject: ${sub.refundEmail.subject}\n\n${sub.refundEmail.body}`;
    });
  }
  const lockedBtn = el.querySelector('[data-locked]');
  if (lockedBtn) lockedBtn.addEventListener('click', upgrade);
  return el;
}

// ---------- monitoring ----------
async function renderMonitorBar() {
  const bar = $('#monitorBar');
  if (!config.loggedIn) {
    bar.hidden = false;
    bar.innerHTML = `🔔 Want a monthly reminder to re-check (and automatic re-scans if your bank is connected)?
      <button class="linklike" id="monitorSignup">Create an account to enable monitoring</button>`;
    bar.querySelector('#monitorSignup').addEventListener('click', () => openAuth('signup'));
    return;
  }
  try {
    const out = await api('/api/monitoring');
    bar.hidden = false;
    bar.innerHTML = `
      <label><input type="checkbox" id="monitorToggle" ${out.monitoring.enabled ? 'checked' : ''}/>
        Monthly monitoring</label>
      <span>${out.monitoring.enabled
        ? `On — every ${out.cycleDays} days we'll ${config.bankConnect === 'available' ? 'auto-check your connected bank and email you what changed' : 'email you a re-scan reminder'}.`
        : `Off — turn on to get a ${out.cycleDays}-day check-in so new charges don't slip past you.`}</span>`;
    bar.querySelector('#monitorToggle').addEventListener('change', async (e) => {
      await api('/api/monitoring', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: e.target.checked })
      });
      toast(e.target.checked ? '🔔 Monthly monitoring is on.' : 'Monitoring turned off.');
      renderMonitorBar();
    });
  } catch {
    bar.hidden = true;
  }
}

// ---------- billing ----------
const stripeBilling = () => /^stripe/.test(config.billing || '');

async function upgrade() {
  if (NATIVE) return toast(PRO_NOTE, 'ok', 8000);
  try {
    const out = await api('/api/billing/upgrade', { method: 'POST' });
    if (out.checkoutUrl) {
      window.location.href = out.checkoutUrl;
      return;
    }
    config.pro = true;
    renderPills();
    toast('Pro unlocked (simulated — no payment taken)');
    loadAnalysis();
  } catch (err) {
    if (/account first/i.test(err.message)) openAuth('signup');
    toast(err.message, 'err');
  }
}

async function openPortal() {
  try {
    const out = await api('/api/billing/portal', { method: 'POST' });
    window.location.href = out.portalUrl;
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function handleStripeReturn() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('verified')) toast('✅ Email confirmed — monitoring emails are now enabled for your account.');
  if (params.get('reset_token')) {
    resetToken = params.get('reset_token');
    openAuth('reset');
  }
  if (params.get('cancelled')) toast('Checkout cancelled — you are still on the free plan.', 'err');
  else if (params.get('upgraded')) {
    // Webhooks flip the account to Pro; refresh config to pick it up.
    toast('✅ Payment received — your Pro subscription activates as soon as Stripe confirms it.');
  }
  if ([...params.keys()].length) window.history.replaceState({}, '', window.location.pathname);
}

// ---------- auth ----------
// Modes: signup | login | forgot (email only) | reset (password only)
let authMode = 'signup';
let resetToken = null;
const AUTH_COPY = {
  signup: { title: 'Create your account', submit: 'Sign up', toggle: 'Already have an account? Log in' },
  login: { title: 'Log in', submit: 'Log in', toggle: 'New here? Create an account' },
  forgot: { title: 'Reset your password', submit: 'Email me a reset link', toggle: 'Back to log in' },
  reset: { title: 'Choose a new password', submit: 'Set new password', toggle: 'Back to log in' }
};
function openAuth(mode) {
  authMode = mode;
  const c = AUTH_COPY[mode];
  $('#authTitle').textContent = c.title;
  $('#authSubmit').textContent = c.submit;
  $('#authToggle').textContent = c.toggle;
  $('#authEmail').closest('label').hidden = mode === 'reset';
  $('#authEmail').required = mode !== 'reset';
  $('#authPassword').closest('label').hidden = mode === 'forgot';
  $('#authPassword').required = mode !== 'forgot';
  $('#authForgot').hidden = mode !== 'login';
  $('#authModal').hidden = false;
}
$('#authClose').addEventListener('click', () => ($('#authModal').hidden = true));
$('#authModal').addEventListener('click', (e) => { if (e.target === $('#authModal')) $('#authModal').hidden = true; });
$('#authToggle').addEventListener('click', () => openAuth(authMode === 'signup' ? 'login' : authMode === 'login' ? 'signup' : 'login'));
$('#authForgot').addEventListener('click', () => openAuth('forgot'));
$('#authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    if (authMode === 'forgot') {
      const out = await api('/api/auth/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: $('#authEmail').value })
      });
      $('#authModal').hidden = true;
      toast(out.message, 'ok', 8000);
      return;
    }
    const body = authMode === 'reset'
      ? { token: resetToken, password: $('#authPassword').value }
      : { email: $('#authEmail').value, password: $('#authPassword').value };
    const out = await api(`/api/auth/${authMode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    $('#authModal').hidden = true;
    if (NATIVE && out.token) await saveAuthToken(out.token);
    config.loggedIn = true;
    config.email = out.user.email;
    config.pro = out.user.pro;
    config.verified = out.user.verified;
    renderPills();
    renderVerifyBanner();
    toast(
      authMode === 'signup' ? 'Account created — check your inbox to confirm your email.'
      : authMode === 'reset' ? 'Password updated — you are logged in.'
      : `Welcome back, ${out.user.email}`
    );
    loadAnalysis();
  } catch (err) {
    toast(err.message, 'err');
  }
});

function renderVerifyBanner() {
  let el = $('#verifyBanner');
  if (config.loggedIn && config.verified === false) {
    if (!el) {
      el = document.createElement('div');
      el.id = 'verifyBanner';
      el.className = 'rescan-banner';
      document.querySelector('main').prepend(el);
    }
    el.hidden = false;
    el.innerHTML = `📧 Please confirm your email address — monitoring emails only go to verified inboxes.
      <button class="btn" id="resendVerify" style="padding:6px 14px;font-size:13px">Resend email</button>`;
    el.querySelector('#resendVerify').addEventListener('click', async () => {
      try {
        await api('/api/auth/resend-verification', { method: 'POST' });
        toast('Verification email sent — check your inbox.');
      } catch (err) {
        toast(err.message, 'err', 8000);
      }
    });
  } else if (el) el.hidden = true;
}
$('#accountBtn').addEventListener('click', () => {
  if (!config.loggedIn) return openAuth('signup');
  $('#accountEmail').textContent = `Logged in as ${config.email}`;
  $('#deleteProNote').hidden = !config.pro;
  $('#deletePassword').value = '';
  $('#accountModal').hidden = false;
});
$('#accountClose').addEventListener('click', () => ($('#accountModal').hidden = true));
$('#accountModal').addEventListener('click', (e) => {
  if (e.target === $('#accountModal')) $('#accountModal').hidden = true;
});

$('#logoutBtn').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  if (NATIVE) await saveAuthToken(null);
  location.reload();
});

$('#deleteForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const ok = confirm('Permanently delete your SubSweep account?\n\n' +
    'Your saved analysis, monitoring settings and any bank connection go with it. This cannot be undone.');
  if (!ok) return;
  const btn = $('#deleteForm button[type="submit"]');
  btn.disabled = true;
  try {
    await api('/api/account/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: $('#deletePassword').value })
    });
    if (NATIVE) await saveAuthToken(null);
    alert('Your account has been deleted. Thanks for trying SubSweep.');
    location.reload();
  } catch (err) {
    toast(err.message, 'err', 8000);
  } finally {
    btn.disabled = false;
  }
});

function renderPills() {
  const ends = config.pro && config.proEndsAt
    ? ` · ends ${new Date(config.proEndsAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}`
    : '';
  $('#planPill').textContent = config.pro ? `⭐ Pro${ends}` : `Free plan (top ${config.freeTierLimit} shown)`;
  $('#planPill').title = config.pro && config.proEndsAt
    ? 'Subscription cancelled — Pro stays active until the end of the paid period. Click to manage billing.'
    : '';
  $('#planPill').classList.toggle('good', Boolean(config.pro));
  $('#accountBtn').textContent = config.loggedIn ? `👤 ${config.email}` : '👤 Sign up / Log in';
  if (config.pro && stripeBilling() && config.loggedIn && !NATIVE) {
    $('#planPill').style.cursor = 'pointer';
    if (!config.proEndsAt) $('#planPill').title = 'Manage billing';
    $('#planPill').onclick = openPortal;
  }
}

// ---------- init ----------
(async function init() {
  try {
    if (NATIVE) await loadNativeSession();
    config = await api('/api/config');
  } catch (err) {
    // Without this the app just sat there with "…" in every pill and no
    // explanation, and the first error the user saw was on their next action.
    toast(err.message, 'err', 12000);
    return;
  }
  if (config.bankConnect === 'available') {
    $('#bankPill').textContent = '🏦 Bank connect ready';
    $('#bankPill').classList.add('good');
  } else if (config.bankConnect === 'sandbox') {
    // A sandbox key only reaches Basiq's simulated banks, so the feature is
    // not offered yet: the button is disabled and reads "coming soon" until
    // BASIQ_LIVE=true, which needs Basiq's CDR onboarding to complete.
    $('#bankPill').textContent = '🏦 Bank connect: coming soon';
    $('#bankPill').title = 'Direct bank connection is being finalised. Upload a CSV statement for your real accounts.';
    $('#bankConnectBtn').textContent = 'Connect bank — coming soon';
    $('#resultsBankBtn').textContent = '🏦 Connect bank — coming soon';
    bankButtons().forEach((b) => { b.disabled = true; });
    $('#bankHint').textContent = 'Coming soon: we are completing open-banking (CDR) accreditation with our data provider. Until then, upload a CSV statement — it works with every Australian bank.';
  } else {
    $('#bankPill').textContent = '🏦 Bank connect: needs BASIQ_API_KEY';
    bankButtons().forEach((b) => { b.disabled = true; });
    $('#bankHint').textContent = 'Set BASIQ_API_KEY to enable (free sandbox key from basiq.io works).';
  }
  renderPills();
  renderVerifyBanner();
  refreshBankStatus();
  await handleStripeReturn();
  if (sessionStorage.getItem('demo')) {
    sessionStorage.removeItem('demo');
    await api('/api/sample', { method: 'POST' });
  }
  loadAnalysis();
})();
