// Known subscription merchants (AU-centric): normalisation patterns,
// category, and cancellation help. The detector works for unknown merchants
// too — this KB just makes the output nicer and adds cancel links.

export const MERCHANTS = [
  { key: 'netflix', match: /netflix/i, name: 'Netflix', category: 'Streaming', cancelUrl: 'https://www.netflix.com/cancelplan' },
  { key: 'spotify', match: /spotify/i, name: 'Spotify', category: 'Music', cancelUrl: 'https://www.spotify.com/account/subscription/' },
  { key: 'stan', match: /\bstan\b|stan\.com/i, name: 'Stan', category: 'Streaming', cancelUrl: 'https://help.stan.com.au/hc/en-us/articles/115005777747' },
  { key: 'binge', match: /binge/i, name: 'Binge', category: 'Streaming', cancelUrl: 'https://help.binge.com.au/s/article/How-do-I-cancel-my-subscription' },
  { key: 'kayo', match: /kayo/i, name: 'Kayo Sports', category: 'Sport', cancelUrl: 'https://help.kayosports.com.au/s/article/How-do-I-cancel-my-subscription' },
  { key: 'disney', match: /disney\s*(plus|\+)?/i, name: 'Disney+', category: 'Streaming', cancelUrl: 'https://www.disneyplus.com/account' },
  { key: 'primevideo', match: /amazon\s*prime|prime\s*video/i, name: 'Amazon Prime', category: 'Streaming', cancelUrl: 'https://www.amazon.com.au/mc/pipelines/cancellation' },
  { key: 'youtube', match: /youtube\s*premium|google\s*youtube/i, name: 'YouTube Premium', category: 'Streaming', cancelUrl: 'https://www.youtube.com/paid_memberships' },
  { key: 'apple', match: /apple\.com\/bill|itunes/i, name: 'Apple (App Store / iCloud)', category: 'Apps', cancelUrl: 'https://support.apple.com/en-au/HT202039' },
  { key: 'googleplay', match: /google\s*\*?(play|one|storage)/i, name: 'Google (Play / One)', category: 'Apps', cancelUrl: 'https://play.google.com/store/account/subscriptions' },
  { key: 'audible', match: /audible/i, name: 'Audible', category: 'Books', cancelUrl: 'https://www.audible.com.au/account/overview' },
  { key: 'kindle', match: /kindle\s*unltd|kindle\s*unlimited/i, name: 'Kindle Unlimited', category: 'Books', cancelUrl: 'https://www.amazon.com.au/kindle-dbs/ku/ku-central' },
  { key: 'chatgpt', match: /openai|chatgpt/i, name: 'ChatGPT Plus', category: 'AI', cancelUrl: 'https://chat.openai.com/#settings' },
  { key: 'claude', match: /anthropic|claude\.ai/i, name: 'Claude', category: 'AI', cancelUrl: 'https://claude.ai/settings/billing' },
  { key: 'adobe', match: /adobe/i, name: 'Adobe Creative Cloud', category: 'Software', cancelUrl: 'https://account.adobe.com/plans' },
  { key: 'microsoft', match: /microsoft\s*365|msft\s*\*?\s*subscr/i, name: 'Microsoft 365', category: 'Software', cancelUrl: 'https://account.microsoft.com/services' },
  { key: 'canva', match: /canva/i, name: 'Canva Pro', category: 'Software', cancelUrl: 'https://www.canva.com/settings/billing-and-teams' },
  { key: 'dropbox', match: /dropbox/i, name: 'Dropbox', category: 'Software', cancelUrl: 'https://www.dropbox.com/account/plan' },
  { key: 'nytimes', match: /nytimes|ny\s*times/i, name: 'The New York Times', category: 'News', cancelUrl: 'https://www.nytimes.com/subscription/cancel' },
  { key: 'news', match: /news\s*corp|the\s*australian|herald\s*sun|daily\s*telegraph/i, name: 'News Corp subscription', category: 'News', cancelUrl: 'https://www.news.com.au/help' },
  { key: 'smh', match: /smh|sydney\s*morning|the\s*age\b/i, name: 'SMH / The Age', category: 'News', cancelUrl: 'https://www.smh.com.au/myaccount' },
  { key: 'gym', match: /anytime\s*fitness|fitness\s*first|goodlife|f45|jetts|plus\s*fitness|snap\s*fitness/i, name: 'Gym membership', category: 'Fitness', cancelUrl: null },
  { key: 'linkedin', match: /linkedin/i, name: 'LinkedIn Premium', category: 'Professional', cancelUrl: 'https://www.linkedin.com/mypreferences/d/manage-premium-account' },
  { key: 'patreon', match: /patreon/i, name: 'Patreon', category: 'Creators', cancelUrl: 'https://www.patreon.com/settings/memberships' },
  { key: 'onlyfans', match: /onlyfans|fenix\s*internat/i, name: 'OnlyFans', category: 'Creators', cancelUrl: 'https://onlyfans.com/my/subscriptions' },
  { key: 'psplus', match: /playstation|sony\s*interactive/i, name: 'PlayStation Plus', category: 'Gaming', cancelUrl: 'https://www.playstation.com/en-au/support/subscriptions/cancel-playstation-plus/' },
  { key: 'xbox', match: /xbox|microsoft\s*ultimate/i, name: 'Xbox Game Pass', category: 'Gaming', cancelUrl: 'https://account.microsoft.com/services' },
  { key: 'nintendo', match: /nintendo/i, name: 'Nintendo Switch Online', category: 'Gaming', cancelUrl: 'https://ec.nintendo.com/my/subscriptions' },
  { key: 'hellofresh', match: /hello\s*fresh/i, name: 'HelloFresh', category: 'Food', cancelUrl: 'https://www.hellofresh.com.au/account-settings/plan' },
  { key: 'marleyspoon', match: /marley\s*spoon/i, name: 'Marley Spoon', category: 'Food', cancelUrl: 'https://marleyspoon.com.au' }
];

export function identifyMerchant(description) {
  for (const m of MERCHANTS) {
    if (m.match.test(description)) return m;
  }
  return null;
}

// Normalise a raw bank description into a grouping key for unknown merchants:
// strip dates, card refs, receipt numbers, cities, and collapse whitespace.
export function normaliseDescription(description) {
  return description
    .toLowerCase()
    .replace(/\d{2}\/\d{2}(\/\d{2,4})?/g, ' ')
    .replace(/(card|ref|receipt|txn|value date)[:\s#]*\S+/g, ' ')
    .replace(/\b(aus|au|sydney|melbourne|brisbane|perth|adelaide|nsw|vic|qld|wa|sa)\b/g, ' ')
    .replace(/[*#\d]{3,}/g, ' ')
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
