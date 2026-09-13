// Captures store screenshots from the real app, running in the same native
// mode the shipped builds use (no upgrade button, bank connect shown as
// coming soon). Capturing the website instead would show an Upgrade button
// that does not exist in the apps, which both stores treat as misleading.
//
// Play wants 1080x1920 phone shots; Apple wants the 6.9" iPhone size,
// 1320x2868, and scales every smaller device down from it.
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = 'http://localhost:3190';
const OUT = new URL('./screenshots', import.meta.url).pathname;

const DEVICES = [
  // 360x640 at 3x -> 1080x1920
  { dir: '', width: 360, height: 640, scale: 3, label: 'Play phone 1080x1920' },
  // iPhone 16 Pro Max is 440x956 points; at 3x that is Apple's required 1320x2868
  { dir: 'ios', width: 440, height: 956, scale: 3, label: 'App Store 6.9in 1320x2868' }
];

const capacitorStub = () => {
  const store = {};
  const noop = { addListener: () => Promise.resolve({ remove() {} }) };
  window.Capacitor = {
    isNativePlatform: () => true,
    registerPlugin: (n) => window.Capacitor.Plugins[n],
    Plugins: {
      Preferences: {
        get: ({ key }) => Promise.resolve({ value: store[key] ?? null }),
        set: ({ key, value }) => { store[key] = value; return Promise.resolve(); },
        remove: ({ key }) => { delete store[key]; return Promise.resolve(); }
      },
      App: noop,
      Browser: { open: () => Promise.resolve(), ...noop }
    }
  };
};

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

for (const device of DEVICES) {
  const dir = device.dir ? `${OUT}/${device.dir}` : OUT;
  fs.mkdirSync(dir, { recursive: true });

  const ctx = await b.newContext({
    viewport: { width: device.width, height: device.height },
    deviceScaleFactor: device.scale,
    isMobile: true,
    hasTouch: true
  });
  await ctx.addInitScript(capacitorStub);
  const p = await ctx.newPage();

  const shot = async (name) => {
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${dir}/${name}.png` });
    console.log(`  ${device.label}: ${name}`);
  };

  await p.goto(`${BASE}/app`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  await shot('01-start');

  // Load the sample statement the app ships with, then show the results.
  await p.click('#sampleBtn');
  await p.waitForSelector('#results:not([hidden])', { timeout: 15000 });
  // The toast auto-hides after 5s; hide it so it never covers the content.
  await p.evaluate(() => { const t = document.querySelector('#toast'); if (t) t.hidden = true; });
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(900);
  await shot('02-results');

  // The subscription list, with its refund-window and price-hike badges.
  await p.evaluate(() => {
    const y = document.querySelector('#subList').getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, y - 8);
  });
  await p.waitForTimeout(600);
  await shot('03-subscriptions');

  // Further down: the panel explaining what a Pro account shows.
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await p.waitForTimeout(600);
  await shot('04-more');

  await ctx.close();
}

await b.close();
