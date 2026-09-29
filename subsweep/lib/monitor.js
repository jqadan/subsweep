// Monitoring: diffs between scans, and the monthly reminder/auto-sync cycle.
//
// The tick runs hourly. For each user with monitoring enabled whose last
// scan is older than the cycle: if they have a live bank connection we
// re-sync and email a change summary; otherwise we email a re-scan
// reminder with an unsubscribe link. lastReminderAt stops repeats until
// the next cycle.

import * as users from './users.js';
import * as basiq from './basiq.js';
import { detectSubscriptions } from './detect.js';
import { sendEmail } from './email.js';
import { signToken } from './sessions.js';

export const CYCLE_DAYS = 30;

// ---- Diff between two analyses (matched by subscription id) ----
export function diffAnalyses(prev, next) {
  if (!prev?.subscriptions || !next?.subscriptions) return null;
  const prevById = new Map(prev.subscriptions.map((s) => [s.id, s]));
  const nextById = new Map(next.subscriptions.map((s) => [s.id, s]));

  const added = next.subscriptions.filter((s) => !prevById.has(s.id));
  const removed = prev.subscriptions.filter((s) => !nextById.has(s.id));
  const priceChanges = [];
  for (const s of next.subscriptions) {
    const old = prevById.get(s.id);
    if (!old) continue;
    const delta = s.latestAmount - old.latestAmount;
    if (Math.abs(delta) / Math.max(old.latestAmount, 0.01) > 0.01) {
      priceChanges.push({
        id: s.id,
        name: s.name,
        from: old.latestAmount,
        to: s.latestAmount,
        deltaPct: Number(((delta / old.latestAmount) * 100).toFixed(1))
      });
    }
  }
  const monthlyDelta = Number((next.summary.totalMonthly - prev.summary.totalMonthly).toFixed(2));
  if (!added.length && !removed.length && !priceChanges.length && monthlyDelta === 0) return null;
  return {
    since: prev.savedAt || null,
    monthlyDelta,
    added: added.map((s) => ({ id: s.id, name: s.name, monthlyCost: s.monthlyCost })),
    removed: removed.map((s) => ({ id: s.id, name: s.name, monthlyCost: s.monthlyCost })),
    priceChanges
  };
}

// ---- Reminder / auto-sync cycle ----
function daysSince(iso, now) {
  if (!iso) return Infinity;
  return (now - new Date(iso).getTime()) / 86400000;
}

export function unsubscribeToken(userId) {
  return signToken({ unsub: userId });
}

function reminderEmail(user, baseUrl) {
  const total = user.savedAnalysis?.summary?.totalAnnual;
  return {
    to: user.email,
    subject: 'Time for your monthly subscription sweep 🧹',
    text:
`Hi,

It's been about a month since your last SubSweep scan${total ? ` (you were tracking ${formatAud(total)}/yr in subscriptions)` : ''}.

New charges, price hikes, and forgotten free trials tend to creep in — a fresh scan takes two minutes:

${baseUrl}/app

— SubSweep

Stop these reminders: ${baseUrl}/api/monitoring/unsubscribe?token=${unsubscribeToken(user.id)}`
  };
}

function changesEmail(user, changes, baseUrl) {
  const lines = [];
  for (const a of changes.added) lines.push(`  + New: ${a.name} (${formatAud(a.monthlyCost)}/mo)`);
  for (const p of changes.priceChanges) lines.push(`  ~ ${p.name}: ${formatAud(p.from)} -> ${formatAud(p.to)} (${p.deltaPct > 0 ? '+' : ''}${p.deltaPct}%)`);
  for (const r of changes.removed) lines.push(`  - Gone: ${r.name} (was ${formatAud(r.monthlyCost)}/mo)`);
  return {
    to: user.email,
    subject: changes.monthlyDelta > 0
      ? `Your subscriptions went UP ${formatAud(changes.monthlyDelta)}/mo 📈`
      : 'Your monthly subscription check-in 🧹',
    text:
`Hi,

We re-checked your connected bank account. Since your last scan:

${lines.join('\n') || '  (totals shifted slightly)'}

Monthly total change: ${changes.monthlyDelta > 0 ? '+' : ''}${formatAud(changes.monthlyDelta)}

Full details: ${baseUrl}/app

— SubSweep

Stop these reminders: ${baseUrl}/api/monitoring/unsubscribe?token=${unsubscribeToken(user.id)}`
  };
}

function formatAud(n) {
  return `A$${Number(n).toFixed(2)}`;
}

export async function runMonitoringTick({ now = Date.now(), baseUrl = process.env.BASE_URL || 'http://localhost:3100' } = {}) {
  const results = [];
  for (const user of users.findAll()) {
    const m = user.monitoring;
    if (!m?.enabled) continue;
    if (!users.isVerified(user)) continue; // never email unverified addresses
    if (daysSince(m.lastScanAt || user.savedAnalysis?.savedAt, now) < CYCLE_DAYS) continue;
    if (daysSince(m.lastReminderAt, now) < CYCLE_DAYS) continue;

    try {
      if (basiq.basiqEnabled() && user.basiqUserId) {
        // Live connection: refresh silently and email what changed.
        const transactions = await basiq.getTransactions(user.basiqUserId);
        if (transactions.length) {
          const analysis = { ...detectSubscriptions(transactions), savedAt: new Date(now).toISOString(), source: 'bank' };
          const changes = diffAnalyses(user.savedAnalysis, analysis);
          users.updateUser(user.id, {
            savedAnalysis: { ...analysis, changes },
            monitoring: { ...m, lastScanAt: new Date(now).toISOString(), lastReminderAt: new Date(now).toISOString() }
          });
          if (changes) await sendEmail(changesEmail(user, changes, baseUrl));
          results.push({ userId: user.id, action: changes ? 'auto-synced+emailed' : 'auto-synced-no-changes' });
          continue;
        }
      }
      await sendEmail(reminderEmail(user, baseUrl));
      users.updateUser(user.id, { monitoring: { ...m, lastReminderAt: new Date(now).toISOString() } });
      results.push({ userId: user.id, action: 'reminded' });
    } catch (err) {
      results.push({ userId: user.id, action: 'error', error: err.message });
    }
  }
  return results;
}
