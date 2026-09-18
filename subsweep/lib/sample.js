// Deterministic sample statement so the demo works with one click:
// 12 months of a plausible AU account, seeded with real-feeling
// subscriptions (one price hike, one recent refund-window charge,
// one lapsed service) buried in everyday spending noise.

function d(daysAgo, now) {
  const t = new Date(now);
  t.setUTCDate(t.getUTCDate() - daysAgo);
  return t;
}

export function sampleTransactions(now = new Date()) {
  const tx = [];
  const add = (daysAgo, description, amount) => tx.push({ date: d(daysAgo, now), description, amount });

  // Monthly subscriptions (day offsets stagger the billing dates)
  for (let m = 0; m < 12; m++) {
    add(m * 30 + 3, 'NETFLIX.COM MELBOURNE', -(m >= 5 ? 16.99 : 22.99)); // price hike 5 months ago
    add(m * 30 + 9, 'Spotify P2E1F8A44C Sydney', -13.99);
    add(m * 30 + 15, 'APPLE.COM/BILL SYDNEY AU', -4.49);
    add(m * 30 + 21, 'HELLO FRESH AU*12938 CHATSWOOD', -96.5);
  }
  // Fortnightly gym
  for (let w = 0; w < 26; w++) add(w * 14 + 2, 'ANYTIME FITNESS #4821 DIRECT DEBIT', -32.9);
  // A charge inside the refund window (2 days ago)
  for (let m = 0; m < 8; m++) add(m * 30 + 2, 'ADOBE CREATIVE CLOUD 800-4438-4468', -43.99);
  // Lapsed: stopped billing 4 months ago
  for (let m = 4; m < 12; m++) add(m * 30 + 11, 'STAN.COM.AU SOUTH YARRA', -17.0);
  // Yearly
  add(40, 'AMAZON PRIME MEMBER anniversary AU', -79.0);
  add(405, 'AMAZON PRIME MEMBER anniversary AU', -79.0);

  // Everyday noise (not subscriptions)
  const noise = [
    ['WOOLWORTHS 3127 BALWYN', -84.2], ['COLES 0423 RICHMOND', -61.75],
    ['SHELL COLES EXPRESS', -78.4], ['BUNNINGS 632000 HAWTHORN', -45.9],
    ['UBER *TRIP HELP.UBER.COM', -24.6], ['MCDONALDS 970 AUS', -14.55],
    ['CHEMIST WAREHOUSE 108', -32.8], ['TRANSPORTFORNSW OPAL', -50.0]
  ];
  for (let i = 0; i < 90; i++) {
    const [desc, amt] = noise[i % noise.length];
    const jitter = Math.floor(Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 23); // irregular gaps
    add((i * 4 + 1 + jitter) % 360, desc, amt * (1 + ((i * 13) % 17) / 25)); // irregular amounts
  }
  // Salary in
  for (let m = 0; m < 12; m++) add(m * 30 + 1, 'SALARY ACME PTY LTD', 4890.0);

  tx.sort((a, b) => a.date - b.date);
  return tx;
}
