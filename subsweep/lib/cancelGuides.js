// Cancellation guides, one page per merchant, rendered from MERCHANTS so that
// adding a merchant to the knowledge base adds a page. Nothing here is hand
// written per service on purpose: we cannot verify click-by-click steps for
// thirty companies, and stale steps are worse than none — someone follows
// them, believes they cancelled, and keeps paying. So every page sends the
// reader to the merchant's own cancellation page for the steps, and spends
// its own words on the part SubSweep actually knows: how the charge looks on
// an Australian statement, and how to confirm it stopped.
import { MERCHANTS } from './merchants.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Turn a matcher into the descriptor text a reader would recognise on their
// statement. The regexes were written against real bank descriptions, so this
// is derived from the same thing the detector matches on, not invented.
export function descriptors(re) {
  const expand = (src) => {
    // (a|b) -> two alternatives; applied repeatedly for nested groups.
    const g = src.match(/\(([^()]*)\)(\?)?/);
    if (!g) return [src];
    const [whole, inner, optional] = g;
    const choices = inner.split('|');
    if (optional) choices.push('');
    return choices.flatMap((c) => expand(src.replace(whole, c)));
  };

  return [...new Set(
    expand(re.source)
      .flatMap((alt) => alt.split('|'))
      .map((alt) => alt
        .replace(/\\b/g, '')           // word boundaries are not text
        .replace(/\\s[*+?]/g, ' ')      // \s* between words reads as a space
        .replace(/\\([./+*])/g, '$1')  // unescape literal . / + *
        .replace(/([^\\])\?/g, '$1')   // drop optionality markers
        .replace(/\s+/g, ' ')
        .trim())
      .filter((alt) => alt && !/[\\[\]{}^$]/.test(alt))  // drop anything still regex-ish
      .map((alt) => alt.toUpperCase())
  )];
}

const LAYOUT = (title, description, path, body) => `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><link rel="icon" type="image/svg+xml" href="/brand/icon.svg" /><link rel="stylesheet" href="/legal/_style.css" /><title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="https://www.subsweep.com.au${path}" />
<meta property="og:title" content="${esc(title)}" /><meta property="og:description" content="${esc(description)}" /><meta property="og:type" content="article" /><meta property="og:url" content="https://www.subsweep.com.au${path}" />
</head><body>
<nav class="nav"><a class="logo" href="/"><img src="/brand/icon.svg" alt="" />SubSweep</a><div class="links"><a href="/cancel">Cancel guides</a><a href="/privacy">Privacy</a><a href="/app">Open the app</a></div></nav>
<main>
${body}
</main>
<footer>© ${new Date().getFullYear()} SubSweep · <a href="/cancel">All cancel guides</a><a href="/privacy">Privacy policy</a><a href="/terms">Terms</a><a href="/app">Open the app</a></footer>
</body></html>`;

// The one caution worth repeating on every page, because it is the single most
// common reason a cancellation does not take: the subscription was bought
// through an app store, so only the app store can stop it.
const STORE_NOTE = (name) => `<div class="card">
<h2 style="margin-top:0">If you subscribed through the App Store or Google Play</h2>
<p>Cancel it there, not with ${esc(name)}. A subscription billed by Apple or Google can only be stopped from your Apple or Google account — cancelling or deleting your ${esc(name)} account on its own will not end the billing. The giveaway is on your statement: the charge reads as Apple or Google rather than ${esc(name)}.</p>
<p><a href="https://support.apple.com/en-au/HT202039" rel="noopener nofollow">Manage Apple subscriptions</a> · <a href="https://play.google.com/store/account/subscriptions" rel="noopener nofollow">Manage Google Play subscriptions</a></p>
</div>`;

export function guidePage(m) {
  const title = `How to cancel ${m.name} in Australia — SubSweep`;
  const description = `Cancel ${m.name}, check the charge actually stopped on your bank statement, and see whether a refund is still worth asking for.`;
  const isStore = m.key === 'apple' || m.key === 'googleplay';
  const hints = descriptors(m.match);

  const step1 = m.cancelUrl
    ? `<h2>1. Cancel with ${esc(m.name)}</h2>
<p><a href="${esc(m.cancelUrl)}" rel="noopener nofollow">Open the ${esc(m.name)} cancellation page</a> and follow the steps there while signed in to your account.</p>
<p>We link to the company's own page rather than reproducing the clicks, because these flows change and out-of-date steps are how people end up believing they cancelled when they have not.</p>`
    : `<h2>1. Cancel with your gym</h2>
<p>There is no single cancellation page for gym memberships — each chain and often each franchise location handles it differently, and many are contracts with a notice period rather than subscriptions you can switch off. Check your membership agreement for how much notice is required and whether cancellation has to be in writing, then contact your home club directly.</p>
<p>Cancelling the direct debit at your bank does not end the contract on its own. It stops the payments and usually leaves the debt in place.</p>`;

  return LAYOUT(title, description, `/cancel/${m.key}`, `
<h1>How to cancel ${esc(m.name)} in Australia</h1>
<p class="meta">${esc(m.category)} · Updated ${new Date().toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })}</p>

<p>Cancelling is usually the easy part. The part people get wrong is checking that the charge actually stopped — and noticing that it had quietly gone up before they cancelled.</p>

${step1}

<h2>2. Check it actually stopped</h2>
<p>A cancellation is not done when the website says so. It is done when the next charge does not arrive. Give it one full billing period, then look at your statement for ${esc(m.name)}.</p>
${hints.length ? `<div class="card"><h2 style="margin-top:0">What it looks like on your statement</h2>
<p>On Australian bank exports this charge usually appears as a line containing:</p>
<ul>${hints.map((h) => `<li><strong>${esc(h)}</strong></li>`).join('')}</ul>
<p>Banks add their own prefixes, card numbers and city names around it, so the wording will not match exactly. SubSweep matches all of these variations for you.</p></div>` : ''}
<p><a href="/app">Upload your statement to SubSweep</a> and it lists every recurring charge it finds, and flags charges that have stopped — which is the confirmation you are looking for.</p>

<h2>3. Check whether a refund is still worth asking for</h2>
<p>If you were charged in the last fortnight for a period you will not use, it is often worth asking the company for a refund — many will pro-rata a recent charge even when their policy does not promise it. SubSweep marks charges from the last 14 days for exactly this reason.</p>

<h2>4. Check the price did not creep up first</h2>
<p>Subscriptions rise quietly, and most people cancel without ever noticing what they were paying by the end. SubSweep compares each charge against the earlier ones from the same merchant and flags any increase, so you can see what ${esc(m.name)} was costing you when you left rather than what it cost when you signed up.</p>

${isStore ? '' : STORE_NOTE(m.name)}

<div class="card">
<h2 style="margin-top:0">Find the ones you have forgotten</h2>
<p>If you are here for ${esc(m.name)}, there are probably others. Export a CSV from your bank, upload it to SubSweep, and it finds every recurring charge on the statement — with what each one costs per year, which have risen in price, and which are still inside a refund window.</p>
<p><a href="/app">Open SubSweep</a> — free, no bank login, and your statement is analysed in memory and never written to disk.</p>
</div>

<p class="meta">This page links to ${esc(m.name)}'s own cancellation process and is not affiliated with, endorsed by or connected to ${esc(m.name)}. Their steps and terms can change at any time — theirs is the authoritative version. SubSweep helps you review your own spending and does not provide financial product advice.</p>
<p><a href="/cancel">← All cancellation guides</a></p>
`);
}

export function guideIndex() {
  const byCategory = new Map();
  for (const m of MERCHANTS) {
    if (!byCategory.has(m.category)) byCategory.set(m.category, []);
    byCategory.get(m.category).push(m);
  }

  const sections = [...byCategory.entries()]
    .map(([category, list]) => `<h2>${esc(category)}</h2>
<ul>${list.map((m) => `<li><a href="/cancel/${esc(m.key)}">How to cancel ${esc(m.name)}</a></li>`).join('')}</ul>`)
    .join('\n');

  return LAYOUT(
    'How to cancel any subscription in Australia — SubSweep',
    `Cancellation guides for ${MERCHANTS.length} subscriptions Australians pay for, plus how to check on your bank statement that the charge actually stopped.`,
    '/cancel',
    `<h1>Cancellation guides</h1>
<p class="meta">${MERCHANTS.length} services · Updated ${new Date().toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })}</p>
<p>Each guide links to the company's own cancellation page, shows how the charge appears on an Australian bank statement, and explains how to confirm the payment actually stopped — the step almost everyone skips.</p>
<div class="card"><p style="margin:0"><strong>Not sure what you are paying for?</strong> <a href="/app">Upload a bank statement CSV to SubSweep</a> and it finds every recurring charge on it, including the ones you have forgotten. Free, no bank login.</p></div>
${sections}`
  );
}

export const guideKeys = () => MERCHANTS.map((m) => m.key);
