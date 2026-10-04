// Generates the two sample statements in this folder and prints what the real
// parser and detector make of each. Dates are anchored to the day you run it,
// so the "charged recently" refund window in the good file always fires.
//
//   node samples/make-samples.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStatementCsv } from '../lib/parse.js';
import { detectSubscriptions } from '../lib/detect.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const today = new Date();
const day = (back) => new Date(today.getTime() - back * 86400000);
const au = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
const de = (d) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;

// ---------------------------------------------------------------- good file
// Westpac-style export: header row, dd/mm/yyyy, separate Debit/Credit columns,
// a running balance, and one quoted description containing a comma.
const rows = [];
const debit = (daysAgo, description, amount) => rows.push({ d: day(daysAgo), description, debit: amount });
const credit = (daysAgo, description, amount) => rows.push({ d: day(daysAgo), description, credit: amount });

// Netflix: monthly. i = 0 is the most recent charge, so the higher price goes
// on the low values of i to read as a rise -> price-hike flag.
for (let i = 0; i < 12; i++) debit(20 + i * 30, 'NETFLIX.COM SYDNEY AU', i < 5 ? 22.99 : 18.99);
// Spotify: monthly, steady.
for (let i = 0; i < 12; i++) debit(19 + i * 30, 'SPOTIFY P0A1B2C3 STOCKHOLM', 13.99);
// Gym: fortnightly, charged in the last few days -> refund window.
for (let i = 0; i < 24; i++) debit(3 + i * 14, 'ANYTIME FITNESS SURRY HILLS', 21.95);
// Adobe: monthly, also charged recently -> second refund window.
for (let i = 0; i < 11; i++) debit(5 + i * 30, 'ADOBE CREATIVE CLOUD', 43.99);
// HelloFresh: monthly boxes.
for (let i = 0; i < 9; i++) debit(21 + i * 30, 'HELLO FRESH AUSTRALIA', 96.50);
// Stan: cancelled around four months ago -> possibly-lapsed.
for (let i = 0; i < 8; i++) debit(124 + i * 30, 'STAN.COM.AU', 12.00);
// An unknown merchant that is still clearly recurring: exact monthly amount.
// Not in the merchant list, so it is grouped on the normalised description.
for (let i = 0; i < 10; i++) debit(24 + i * 30, 'SECURE PARKING MONTHLY PASS', 45.00);

// Noise that must NOT be reported as a subscription:
// groceries (amounts vary too much), fuel, salary, rent transfer, ATM.
const groceries = [187.4, 64.15, 212.8, 98.3, 143.65, 76.9, 231.05, 55.4, 168.2, 121.75, 89.6, 204.3];
groceries.forEach((amt, i) => debit(6 + i * 7, '"WOOLWORTHS 1423 NEWTOWN, NSW"', amt));
for (let i = 0; i < 6; i++) debit(10 + i * 30, 'AMPOL FOODARY ALEXANDRIA', [72.4, 88.1, 65.35, 91.2, 79.85, 84.6][i]);
for (let i = 0; i < 24; i++) credit(2 + i * 14, 'SALARY QADAN ANALYSIS CONSULTING', 3184.22);
for (let i = 0; i < 12; i++) debit(4 + i * 30, 'TRANSFER TO LANDLORD RENT', 2400.00);
for (let i = 0; i < 5; i++) debit(17 + i * 45, 'ATM WITHDRAWAL GEORGE ST', 200.00);

rows.sort((a, b) => a.d - b.d);
let balance = 4200;
const good = ['Date,Description,Debit,Credit,Balance'];
for (const r of rows) {
  balance += r.credit ? r.credit : -r.debit;
  good.push([
    au(r.d),
    r.description,
    r.debit ? r.debit.toFixed(2) : '',
    r.credit ? r.credit.toFixed(2) : '',
    balance.toFixed(2)
  ].join(','));
}
fs.writeFileSync(path.join(here, 'statement-standard.csv'), good.join('\n') + '\n');

// ----------------------------------------------------------- unsupported file
// A German bank export: semicolon separated, comma decimals, dd.mm.yyyy dates,
// and two preamble lines before the header. Nothing SubSweep can read.
const bad = [
  'Kontoauszug Girokonto DE89 3704 0044 0532 0130 00',
  `Zeitraum;${de(day(180))};bis;${de(day(0))}`,
  '',
  'Buchungstag;Wertstellung;Verwendungszweck;Betrag;Waehrung'
];
const badRows = [
  [12, 'NETFLIX INTERNATIONAL B.V.', '-12,99'],
  [14, 'SPOTIFY AB', '-10,99'],
  [20, 'REWE SAGT DANKE 4711', '-63,42'],
  [28, 'GEHALT AUGUST', '2.840,00'],
  [42, 'NETFLIX INTERNATIONAL B.V.', '-12,99'],
  [44, 'SPOTIFY AB', '-10,99'],
  [55, 'DB VERTRIEB GMBH FAHRKARTE', '-49,90'],
  [72, 'NETFLIX INTERNATIONAL B.V.', '-12,99']
];
for (const [daysAgo, purpose, amount] of badRows) {
  bad.push([de(day(daysAgo)), de(day(daysAgo)), purpose, amount, 'EUR'].join(';'));
}
fs.writeFileSync(path.join(here, 'statement-unsupported.csv'), bad.join('\n') + '\n');

// ------------------------------------------------------------------- verify
for (const file of ['statement-standard.csv', 'statement-unsupported.csv']) {
  const text = fs.readFileSync(path.join(here, file), 'utf8');
  const { transactions, warnings } = parseStatementCsv(text);
  console.log(`\n=== ${file}`);
  console.log(`lines ${text.trim().split('\n').length}, parsed ${transactions.length} transactions`);
  if (warnings.length) console.log('warnings:', warnings.join(' '));
  if (!transactions.length) continue;
  const { subscriptions, summary } = detectSubscriptions(transactions);
  console.log(`detected ${summary.count} subscriptions, $${summary.totalMonthly}/mo, ` +
    `${summary.refundWindowCount} in refund window, ${summary.priceHikeCount} price hike(s)`);
  for (const s of subscriptions) {
    const f = [
      s.flags.refundWindow ? 'refund-window' : '',
      s.flags.priceHike ? `price +${s.flags.priceHikePct}%` : '',
      s.flags.possiblyLapsed ? 'lapsed' : ''
    ].filter(Boolean).join(', ');
    console.log(`  ${s.name.padEnd(30)} ${s.cadence.padEnd(12)} $${String(s.latestAmount).padStart(7)}  x${String(s.chargeCount).padStart(2)}  ${f}`);
  }
}
