// Builds the web bundle the native apps ship with.
//
// The mobile app is the same frontend as /app on the website (app.html,
// app.js, style.css, brand/), copied from ../public into ./www with a few
// build-time tweaks: the API base URL is injected, the landing-page and legal
// links point at the website, and the viewport covers the notch.
//
//   SUBSWEEP_API_URL  server the app talks to (default https://www.subsweep.com.au)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '..', '..', 'public');
const out = path.resolve(here, '..', 'www');
const api = (process.env.SUBSWEEP_API_URL || 'https://www.subsweep.com.au').replace(/\/+$/, '');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const file of ['app.js', 'style.css']) {
  fs.copyFileSync(path.join(src, file), path.join(out, file));
}
fs.cpSync(path.join(src, 'brand'), path.join(out, 'brand'), { recursive: true });

let html = fs.readFileSync(path.join(src, 'app.html'), 'utf8');
const replace = (from, to) => {
  if (!html.includes(from)) throw new Error(`build-www: expected to find ${JSON.stringify(from)} in app.html`);
  html = html.replace(from, to);
};

replace('content="width=device-width, initial-scale=1.0"', 'content="width=device-width, initial-scale=1.0, viewport-fit=cover"');
// The brand block links to the marketing site on the web; in the app it is just a header.
replace('<a class="brand" href="/" title="SubSweep home">', '<a class="brand">');
for (const page of ['privacy', 'cdr-policy', 'terms', 'delete-account']) {
  replace(`href="/${page}"`, `href="${api}/${page}" target="_blank" rel="noopener"`);
}
// The sample file is served by the site, not bundled: in the app the link
// opens in the system browser, which is what downloads it.
replace('href="/sample-statement.csv"', `href="${api}/sample-statement.csv"`);
replace('<script src="app.js"></script>',
  `<script>window.SUBSWEEP_API = ${JSON.stringify(api)};</script>\n  <script src="app.js"></script>`);

fs.writeFileSync(path.join(out, 'index.html'), html);
console.log(`build-www: wrote ${path.relative(process.cwd(), out)} (API ${api})`);
