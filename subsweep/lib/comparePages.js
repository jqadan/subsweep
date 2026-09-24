// Comparison pages for the two highest-intent searches in the niche: people
// choosing a subscription tracker, and people who found Rocket Money and then
// learned it does not work here. Written to be fair to competitors on
// purpose — a comparison that admits where SubSweep loses is the only kind
// anyone trusts, and every claim about another product must stay checkable.
// Re-check these facts when editing: prices and features change.
import { pageLayout } from './cancelGuides.js';

const CHECKED = 'September 2026';

const TABLE = `<div style="overflow-x:auto"><table>
<tr><th>Tool</th><th>How it gets your transactions</th><th>Where it runs</th><th>Price</th><th>Best for</th></tr>
<tr><td><strong>SubSweep</strong></td><td>Bank statement CSV upload — no bank login. Direct bank connection coming soon.</td><td>Web, iPhone, Android</td><td>Free (top 3 results); Pro A$9.99/month on the web</td><td>Finding forgotten subscriptions without handing over bank access</td></tr>
<tr><td><strong>Frollo</strong></td><td>Open banking (Consumer Data Right) connection to your bank</td><td>iPhone, Android</td><td>Free</td><td>A full money-management view — budgets, spending, goals — if you are happy to connect your bank</td></tr>
<tr><td><strong>WeMoney</strong></td><td>Bank connection through a data aggregator</td><td>iPhone, Android</td><td>Free to start</td><td>Paying down debt and keeping an eye on your credit score</td></tr>
<tr><td><strong>Subtracker</strong></td><td>Statement upload — PDF, CSV, Excel or a photo of a paper statement</td><td>Web</td><td>First scan shows 3 finds free; full tracker A$19 one-off</td><td>A one-off clean-up, especially if you only have PDF statements</td></tr>
<tr><td><strong>PocketSmith</strong></td><td>Bank feeds, including Australian banks</td><td>Web, iPhone, Android</td><td>Free tier and paid plans</td><td>Detailed budgeting and cash-flow forecasting</td></tr>
<tr><td><strong>Rocket Money</strong></td><td>US bank connections only</td><td>US only</td><td>—</td><td>Not available to Australians</td></tr>
</table></div>
<p class="meta">Checked ${CHECKED} from each provider's own website. Prices and features change — check theirs before you decide.</p>`;

const CTA = `<div class="card">
<h2 style="margin-top:0">Try SubSweep on your own statement</h2>
<p>Export a CSV from your bank's website, upload it, and see every recurring charge with its yearly cost, price rises and refund windows. There is a sample statement if you would rather look first.</p>
<p><a href="/app">Open SubSweep</a> — free, no bank login, and your statement is analysed in memory and never written to disk.</p>
</div>`;

const DISCLOSURE = `<p class="meta">This page is written by SubSweep, so weigh it accordingly. We have tried to be fair: where another tool is the better choice for you, we say so. SubSweep is not affiliated with any product named here and does not provide financial product advice.</p>`;

export const COMPARE_PAGES = {
  'best-subscription-tracker-australia': {
    title: 'Best subscription trackers in Australia (2026) — SubSweep',
    description: 'An honest comparison of subscription trackers that work with Australian banks — Frollo, WeMoney, Subtracker, PocketSmith and SubSweep — including where each one is the better choice.',
    body: `
<h1>The best subscription trackers in Australia</h1>
<p class="meta">Updated ${CHECKED}</p>
<p>There are two ways a subscription tracker can see your spending: you connect your bank, or you give it a statement. That one choice decides most of the trade-offs, so start there.</p>

<h2>Connect your bank, or upload a statement?</h2>
<p><strong>Connecting your bank</strong> (open banking, through Australia's Consumer Data Right) is the most convenient: transactions arrive automatically and stay up to date. The cost is that you grant ongoing access to your accounts, and the consent flow asks for your bank login through the bank's own page.</p>
<p><strong>Uploading a statement</strong> needs a minute of effort each time, but nothing stays connected. You choose exactly which transactions the tool sees, and when.</p>

<h2>At a glance</h2>
${TABLE}

<h2>Which one should you use?</h2>
<p><strong>If you want everything automatic and are comfortable connecting your bank:</strong> Frollo. It is free, it uses open banking today, and subscriptions are one part of a broader money-management app. SubSweep's own bank connection is not live yet, so today Frollo does this better.</p>
<p><strong>If debt and your credit score are the priority:</strong> WeMoney, which is built around exactly that.</p>
<p><strong>If you want detailed budgeting and forecasting:</strong> PocketSmith.</p>
<p><strong>If you only have PDF statements:</strong> Subtracker reads PDFs and photos; SubSweep reads CSV exports only for now.</p>
<p><strong>If you want to find forgotten subscriptions without giving anyone bank access:</strong> that is what SubSweep is built for. It works with a CSV from any Australian bank, finds charges on every rhythm — weekly, fortnightly, monthly, quarterly, yearly — flags price rises and charges still inside a refund window, and links to each service's cancellation page. It is on the web, iPhone and Android.</p>

<h2>What to look for in any tracker</h2>
<ul>
<li><strong>Fortnightly and quarterly charges.</strong> Gyms, insurance and some memberships do not bill monthly, and a tracker that only looks for monthly patterns misses them.</li>
<li><strong>Price rises.</strong> Subscriptions go up quietly. Seeing the change is often more useful than seeing the total.</li>
<li><strong>What is stored.</strong> Check whether the tool keeps your raw transactions or only the result.</li>
<li><strong>Australian formats.</strong> Tools built for the US often cannot read Australian bank exports at all.</li>
</ul>

${CTA}
${DISCLOSURE}
<p><a href="/compare/rocket-money-alternative-australia">Rocket Money alternatives for Australia →</a> · <a href="/cancel">Cancellation guides</a></p>`
  },

  'rocket-money-alternative-australia': {
    title: 'Rocket Money alternatives for Australia (2026) — SubSweep',
    description: 'Rocket Money only works with US banks. Here are the subscription trackers that work in Australia — and which one fits what you wanted Rocket Money for.',
    body: `
<h1>Rocket Money alternatives for Australia</h1>
<p class="meta">Updated ${CHECKED}</p>
<p>If you have seen Rocket Money recommended and tried to sign up from Australia, you will have hit the wall: <strong>Rocket Money only works in the United States</strong> and only connects to US banks. Its own help centre says so. None of its features — subscription tracking, cancellation, bill negotiation — are available here.</p>
<p>The good news is that everything most people want from it can be done with tools that do work with Australian banks.</p>

<h2>What did you want Rocket Money for?</h2>
<p><strong>To find subscriptions you had forgotten about.</strong> SubSweep does exactly this, from a CSV statement from any Australian bank, with no bank login. Subtracker does it from PDF, CSV or photo statements, as a one-off purchase.</p>
<p><strong>To see all your spending automatically in one place.</strong> Frollo connects to Australian banks through open banking and is free.</p>
<p><strong>To budget in detail.</strong> PocketSmith supports Australian bank feeds and has a free tier.</p>
<p><strong>To have someone cancel subscriptions or negotiate bills for you.</strong> We do not know of an Australian equivalent of Rocket Money's concierge. SubSweep links you to each service's own cancellation page and shows you how to confirm the charge actually stopped — the final click stays yours.</p>

<h2>At a glance</h2>
${TABLE}

${CTA}
${DISCLOSURE}
<p><a href="/compare/best-subscription-tracker-australia">Best subscription trackers in Australia →</a> · <a href="/cancel">Cancellation guides</a></p>`
  }
};

export function comparePage(slug) {
  const page = COMPARE_PAGES[slug];
  return page ? pageLayout(page.title, page.description, `/compare/${slug}`, page.body) : null;
}
