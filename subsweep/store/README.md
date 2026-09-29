# Store assets

Artwork, screenshots and listing copy for the Google Play and App Store
listings. All of it is generated from the app itself or from
`../public/brand/icon.svg`, so it can be rebuilt whenever the app or the brand
mark changes.

| File | Used for | Size |
| --- | --- | --- |
| `feature-graphic.png` | Play "Feature graphic" (required) | 1024×500 |
| `screenshots/01-start.png` … `04-more.png` | Play phone screenshots (min 2) | 1080×1920 |
| `screenshots/ios-6.9/01-start.png` … `04-more.png` | App Store, iPhone 6.9" slot | 1320×2868 |
| `screenshots/ios-6.5/01-start.png` … `04-more.png` | App Store, iPhone 6.5" slot | 1284×2778 |
| `../public/brand/icon-512.png` | Play "App icon" (required) | 512×512 |
| `app-store-listing.md` | Every App Store Connect field, ready to paste | — |

App Store Connect has a separate upload slot per iPhone display size, and each
slot accepts only its own exact pixel sizes — dropping a 6.9" file into the
6.5" slot fails with "The dimensions of one or more screenshots are wrong".
Hence both sets: upload each folder into the slot it is named for. The App
Store icon comes out of the binary, so there is nothing to upload for it, and
the app is iPhone-only (`TARGETED_DEVICE_FAMILY = 1`), so App Store Connect
never asks for iPad shots.

## Regenerating the screenshots

One run produces every set: the Play size into `screenshots/`, and the two
App Store sizes into `screenshots/ios-6.9/` and `screenshots/ios-6.5/`. They
are captured from the real app with the Capacitor runtime stubbed out, so
they show exactly what the shipped
builds show: no purchase button, and bank connect as "coming soon". Using the
website directly would show an Upgrade button that does not exist in the app,
which both stores treat as misleading.

```bash
cd subsweep
npm install
DISABLE_MONITORING_TICK=1 BASIQ_API_KEY=fake PORT=3190 node server.js &
npm install --no-save playwright-core   # Chromium must already be available
node store/capture-screenshots.mjs
```

The sample statement is loaded through the app's own "Try with sample data"
button, so no real financial data appears in any screenshot.

## Regenerating the feature graphic

It is a crop of `../public/brand/social.png`, which keeps the wordmark's
typography identical to the website:

```js
sharp('public/brand/social.png')
  .extract({ left: 0, top: 22, width: 1200, height: 586 })
  .resize(1024, 500).toFile('store/feature-graphic.png');
```
