# Store assets

Artwork and screenshots for the Google Play and App Store listings. All of it
is generated from the app itself or from `../public/brand/icon.svg`, so it can
be rebuilt whenever the app or the brand mark changes.

| File | Used for | Size |
| --- | --- | --- |
| `feature-graphic.png` | Play "Feature graphic" (required) | 1024×500 |
| `screenshots/01-start.png` … `04-more.png` | Play phone screenshots (min 2) | 1080×1920 |
| `../public/brand/icon-512.png` | Play "App icon" (required) | 512×512 |

## Regenerating the screenshots

They are captured from the real app with the Capacitor runtime stubbed out, so
they show exactly what the Android build shows: no purchase button, and bank
connect as "coming soon". Using the website directly would show an Upgrade
button that does not exist in the app, which Play would flag as misleading.

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
