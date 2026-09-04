// Recurring-charge detector: groups outgoing transactions by merchant,
// finds regular cadences (weekly / monthly / quarterly / yearly), and
// annotates each subscription with the flags the dashboard shows:
// price hikes, refund windows, and possibly-lapsed charges.

import { identifyMerchant, normaliseDescription } from './merchants.js';

const CADENCES = [
  { name: 'weekly', days: 7, tolerance: 2, perYear: 52 },
  { name: 'fortnightly', days: 14, tolerance: 3, perYear: 26 },
  { name: 'monthly', days: 30, tolerance: 5, perYear: 12 },
  { name: 'quarterly', days: 91, tolerance: 10, perYear: 4 },
  { name: 'yearly', days: 365, tolerance: 20, perYear: 1 }
];

const REFUND_WINDOW_DAYS = 14;

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function matchCadence(gapsDays) {
  const med = median(gapsDays);
  for (const c of CADENCES) {
    if (Math.abs(med - c.days) <= c.tolerance) {
      const hits = gapsDays.filter((g) => Math.abs(g - c.days) <= c.tolerance * 1.5).length;
      const regularity = hits / gapsDays.length;
      if (regularity >= 0.6) return { ...c, regularity };
    }
  }
  return null;
}

// Recurring debits that are bank plumbing, not subscriptions: loan and
// mortgage repayments, interest, transfers between accounts, card payments,
// cash withdrawals. Only applied to merchants we don't already recognise.
const BANK_INTERNAL = /\b(transfer|trf|loan|mortgage|home loan|interest( charged)?|repayment|redraw|offset|atm|withdrawal|cash out|credit card (payment|pymt)|card payment|savings|term deposit|bpay .*(card|loan))\b/i;

export function detectSubscriptions(transactions, { now = new Date() } = {}) {
  const outgoing = transactions.filter((t) => t.amount < 0);

  const groups = new Map();
  for (const t of outgoing) {
    const known = identifyMerchant(t.description);
    if (!known && BANK_INTERNAL.test(t.description)) continue;
    const key = known ? `kb:${known.key}` : `raw:${normaliseDescription(t.description)}`;
    if (!key.replace(/^(kb|raw):/, '')) continue;
    if (!groups.has(key)) groups.set(key, { known, charges: [] });
    groups.get(key).charges.push(t);
  }

  const subs = [];
  for (const [key, { known, charges }] of groups) {
    if (charges.length < 2) continue;
    charges.sort((a, b) => a.date - b.date);

    const gaps = [];
    for (let i = 1; i < charges.length; i++) {
      gaps.push((charges[i].date - charges[i - 1].date) / 86400000);
    }
    // Yearly needs only 2 charges ~a year apart; other cadences need 2+ gaps
    const cadence = matchCadence(gaps);
    if (!cadence) continue;

    const amounts = charges.map((c) => Math.abs(c.amount));
    const latest = charges[charges.length - 1];
    const latestAmount = Math.abs(latest.amount);
    const typicalAmount = median(amounts);
    // Amounts should be stable for a subscription (allow price changes).
    // Known subscription merchants get looser matching; unknown merchants
    // must be near-exact so groceries/fuel with similar spend don't slip in.
    const tolerance = known ? 0.5 : 0.05; // known merchants: loose enough to survive a big price hike
    const minStable = known ? 0.6 : 0.8;
    const stable = amounts.filter((a) => Math.abs(a - typicalAmount) / typicalAmount <= tolerance).length / amounts.length;
    if (stable < minStable) continue;

    const daysSinceLast = (now - latest.date) / 86400000;
    const monthlyCost = (latestAmount * cadence.perYear) / 12;

    const firstAmount = amounts[0];
    const priceHikePct = firstAmount > 0 ? ((latestAmount - firstAmount) / firstAmount) * 100 : 0;

    subs.push({
      id: key,
      name: known ? known.name : titleCase(normaliseDescription(latest.description)),
      category: known ? known.category : 'Other',
      cancelUrl: known ? known.cancelUrl : null,
      knownMerchant: Boolean(known),
      cadence: cadence.name,
      regularity: Number(cadence.regularity.toFixed(2)),
      chargeCount: charges.length,
      latestAmount: Number(latestAmount.toFixed(2)),
      monthlyCost: Number(monthlyCost.toFixed(2)),
      annualCost: Number((latestAmount * cadence.perYear).toFixed(2)),
      firstCharge: charges[0].date.toISOString().slice(0, 10),
      lastCharge: latest.date.toISOString().slice(0, 10),
      daysSinceLast: Math.round(daysSinceLast),
      flags: {
        refundWindow: daysSinceLast <= REFUND_WINDOW_DAYS,
        priceHike: priceHikePct > 8,
        priceHikePct: Number(priceHikePct.toFixed(1)),
        possiblyLapsed: daysSinceLast > cadence.days + cadence.tolerance * 2
      },
      history: charges.map((c) => ({ date: c.date.toISOString().slice(0, 10), amount: Number(Math.abs(c.amount).toFixed(2)) }))
    });
  }

  subs.sort((a, b) => b.monthlyCost - a.monthlyCost);

  const totalMonthly = subs.reduce((s, x) => s + (x.flags.possiblyLapsed ? 0 : x.monthlyCost), 0);
  return {
    subscriptions: subs,
    summary: {
      count: subs.length,
      totalMonthly: Number(totalMonthly.toFixed(2)),
      totalAnnual: Number((totalMonthly * 12).toFixed(2)),
      refundWindowCount: subs.filter((s) => s.flags.refundWindow).length,
      priceHikeCount: subs.filter((s) => s.flags.priceHike).length
    }
  };
}

function titleCase(s) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase()) || 'Unknown merchant';
}

export function refundEmail(sub) {
  return {
    subject: `Refund request — recent ${sub.name} charge of A$${sub.latestAmount}`,
    body:
`Hi ${sub.name} team,

I noticed a charge of A$${sub.latestAmount} on ${sub.lastCharge} for my subscription. I no longer use this service and would like to cancel my subscription effective immediately and request a refund of this most recent charge, as it falls within your recent-billing window.

My account is registered under the same email address as this message.

Could you please confirm the cancellation and the refund?

Thank you,`
  };
}
