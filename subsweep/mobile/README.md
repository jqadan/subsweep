# SubSweep for iOS and Android

Native shells around the same web app that runs at `/app` on the website,
built with [Capacitor](https://capacitorjs.com). The app bundles
`../public/app.html`, `app.js`, `style.css` and `brand/`, and talks to the
live server (`https://www.subsweep.com.au`) for everything else, so a change
to the web app is a change to the mobile apps: every push that touches
`subsweep/public/` or `subsweep/mobile/` rebuilds both apps in GitHub Actions
(`.github/workflows/mobile.yml`).

There is nothing to do by hand except the store side: the one-time setup
below, then reviewing and publishing builds in App Store Connect and the Play
Console.

## How it fits together

| Piece | What it does |
| --- | --- |
| `scripts/build-www.mjs` | Copies the web app into `www/` with the API URL injected, the landing-page link removed and the legal links pointing at the website. |
| `scripts/make-assets.mjs` + `npm run assets` | Renders app icons and splash screens from `../public/brand/icon.svg` into both native projects. Re-run only when the artwork changes; the results are committed. |
| `android/`, `ios/` | The native projects. Open with `npx cap open android` / `npx cap open ios` after `npm run sync`. |
| `capacitor.config.json` | App id `au.com.subsweep.app`, name SubSweep. |

Inside the app the web code detects the native runtime and:

- sends API calls to the live server with a bearer token (the same signed
  value the website keeps in its cookie) and a per-install workspace id, so
  statement uploads and logins work from the WebView origin;
- opens Basiq consent, cancel guides and the legal pages in the system
  browser and re-checks the bank connection when the app comes back;
- never links to website billing. Apple and Google require their own billing
  for anything an app unlocks (see below).

## Pro in the apps (In-App Purchase)

Apple rejected the app twice (guideline 3.1.1) while Pro could only be bought
on the website, so **the iPhone app sells Pro through Apple In-App Purchase**,
using RevenueCat (`@revenuecat/purchases-capacitor` 11.x, the last line that
supports Capacitor 7). Once Pro is buyable in the app, Pro bought on the
website may unlock there too (3.1.3(b)).

- The server decides everything. It only offers IAP to a request from the
  iPhone app (`X-SubSweep-Platform: ios`) when all RevenueCat variables are
  set (`lib/iap.js`); every other app request — Android, older builds — gets
  the free view with no mention of Pro (`forClient` in `server.js`).
- A purchase is attached to the SubSweep account (RevenueCat app user id =
  account id), so the app asks for a free account first.
- After a purchase or restore the app calls `/api/iap/sync`; the server asks
  RevenueCat what the account holds rather than trusting the app. Renewals,
  cancellations, refunds and expiry arrive at `/api/revenuecat/webhook`.
- Apple-bought Pro is stored in `iap_expires_at`, apart from Stripe's `pro`
  flag, so neither source can switch off Pro the other granted.
- Deleting an account deletes RevenueCat's copy but cannot stop Apple's
  billing; the app tells the person to cancel in Settings first.

Railway needs one variable, `REVENUECAT_SECRET_KEY`: a RevenueCat **v2**
secret key with read & write on project configuration and customer
information. The server finds the project and the App Store app's public SDK
key from it (logged at boot as `[iap] enabled`), and derives the webhook
password from it. RevenueCat itself is configured by
`store/rc-setup.mjs` (workflow `revenuecat-setup.yml`): the App Store app with
Apple's In-App Purchase key, the product, entitlement, offering package and
the webhook. Optional overrides: `REVENUECAT_IOS_KEY`,
`REVENUECAT_WEBHOOK_AUTH`, `REVENUECAT_ENTITLEMENT`.

Android stays on the free view until Google Play Billing is set up the same
way: a Play subscription product, the Google key in RevenueCat, and the
Android platform allowed in `isIapClient`.

## Sharing a statement into the app

Both apps appear in the system share sheet and "Open with" for CSV files, so
a statement can go straight from the bank app, Files, Gmail or Mail into
SubSweep without the export-find-pick dance. The native side reads the file
into memory the moment it arrives and parks the text; the web code collects it
with the `ShareIntake` plugin's `consume()` — at start-up for a cold launch,
or on the `subsweepShare` window event when the app was already open — and
posts it to `/api/statement` as `text/csv`, the same path the picker uses.

| Platform | Declared in | Received by |
| --- | --- | --- |
| Android | `AndroidManifest.xml` — `SEND` and `VIEW` filters for the CSV MIME types | `MainActivity.java` reads the `content://` stream while the sender's grant is valid; `ShareIntake.java` hands it over |
| iOS | `Info.plist` — `CFBundleDocumentTypes` for `public.comma-separated-values-text` | `AppDelegate.swift` passes the file URL to `ShareIntake.swift`, which reads it and deletes iOS's `Documents/Inbox` copy so nothing stays on disk |

CSV types only, deliberately: declaring plain text would put SubSweep in the
share sheet for every link and snippet on the phone. The iOS plugin lives in
the app target, so `Main.storyboard` points at `BridgeViewController` (in
`ShareIntake.swift`), which registers it once the bridge exists — Capacitor
only auto-registers plugins that arrive as packages.

## CI builds

The workflow runs two jobs. Both always compile; signing and uploads switch
on when the matching secrets exist (repository **Settings → Secrets and
variables → Actions**).

**Android** (`ubuntu-latest`) builds `app-release.aab` and `app-debug.apk`
and attaches both to the run. With a keystore the bundle is signed with your
upload key; with a Play service account it is also pushed to the **internal
testing** track.

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 subsweep-upload.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | key alias (`subsweep` below) |
| `ANDROID_KEY_PASSWORD` | key password |
| `PLAY_SERVICE_ACCOUNT_JSON` | optional: the JSON key of a Play Console service account with release access |

Create the upload key once and keep it safe (Play App Signing holds the real
signing key; this one only proves uploads come from you):

```bash
keytool -genkeypair -v -keystore subsweep-upload.jks -alias subsweep \
  -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 subsweep-upload.jks   # -> ANDROID_KEYSTORE_BASE64
```

**iOS** (`macos-26`, for the iOS 26 SDK App Store Connect now requires) needs
an Apple Developer account. With the secrets
below it archives, exports a signed `App.ipa` (attached to the run) and
uploads the same archive to TestFlight. Without them it compiles for the
simulator so build errors still surface.

| Secret | Value |
| --- | --- |
| `APPLE_TEAM_ID` | 10-character Team ID (Apple Developer → Membership) |
| `ASC_KEY_ID` | App Store Connect API key ID |
| `ASC_ISSUER_ID` | App Store Connect API issuer ID |
| `ASC_KEY_P8_BASE64` | `base64 -w0 AuthKey_XXXX.p8` |

Create the key in App Store Connect → Users and Access → Integrations →
App Store Connect API with the **Admin** role (cloud-managed signing needs
it; Xcode then creates the distribution certificate and profile itself).

`ios/App/App/PrivacyInfo.xcprivacy` declares the app's use of UserDefaults
(reached through `@capacitor/preferences`, which ships no manifest of its
own) and the two data types it collects. Without it App Store Connect
rejects the upload with ITMS-91053. Keep it in step with the Play Data
Safety answers — same questions, different shape.

Version numbers: the marketing version is `version` in `package.json`
(`1.0.0`); bump it for a new store release. The build number is the
workflow run number, so every run is unique and increasing.

## One-time store setup

1. **Google Play Console**: create the app (package `au.com.subsweep.app`),
   fill in the store listing, content rating, data safety and privacy policy
   (`https://www.subsweep.com.au/privacy`). Play accepts API uploads only
   after the first bundle has been uploaded manually, so download
   `app-release.aab` from a signed run and upload it once yourself; after
   that the workflow feeds the internal track and you promote releases in
   the console. For the service account: Play Console → Users and
   permissions → invite the service account email with release access.
2. **App Store Connect**: create the app record with bundle id
   `au.com.subsweep.app` (Certificates, Identifiers & Profiles → register
   the identifier first if Xcode has not). Fill in the listing, App Privacy
   (email address for the account, financial info from statements processed
   on the server, not sold or tracked) and the privacy policy URL. Builds
   uploaded by the workflow appear under TestFlight; pick one and submit it
   for review.
3. Both stores want screenshots, and both sets are in `../store/screenshots/`
   (see `../store/README.md` to regenerate them). `../store/app-store-listing.md`
   holds every App Store Connect field — listing copy, App Privacy answers, age
   rating and review notes — ready to paste.

## Local development

```bash
cd subsweep/mobile
npm install
npm run sync          # build www/ from ../public and copy into both projects
npx cap open android  # Android Studio
npx cap open ios      # Xcode (macOS)
```

Point the app at a local server with `SUBSWEEP_API_URL=http://10.0.2.2:3100
npm run sync` (Android emulator) or your machine's LAN address (iOS).

## When Basiq production access arrives

Nothing in this folder changes. `BASIQ_LIVE=true` on the server flips
`/api/config` to `available`, the "coming soon" state disappears, and the app's
Connect bank button starts the real consent flow in the system browser. The
only edits are the landing-page wording in `../public/index.html`, which is
not part of the app bundle.
