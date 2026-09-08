# SubSweep 🧹

Find the subscriptions you forgot you're paying for. SubSweep analyses bank
transactions, detects recurring charges with an interval/amount-stability
algorithm, and shows a "money leaks" dashboard: cost per month/year,
price-hike alerts, refund-window flags (charged in the last 14 days) with a
generated refund-request email, and per-merchant cancel links.

## Data sources

1. **Statement upload (works today, no keys)** — CSV export from any
   Australian bank (CBA/Westpac/NAB/ANZ/ING/Up formats handled: signed Amount
   or Debit/Credit columns, dd/mm/yyyy and ISO dates, headerless CBA style).
   Processed in memory only; never written to disk.
2. **Bank connect via Basiq (CDR / open banking)** — set `BASIQ_API_KEY` and
   the Connect Bank button lights up, using Basiq's hosted consent UI. A free
   sandbox key from [basiq.io](https://basiq.io) connects simulated test banks
   immediately; production access requires a CDR representative agreement
   with Basiq (or Frollo/Adatree). The app shows which bank is connected
   and offers **Re-sync** and **Disconnect / switch bank** (deletes the Basiq
   connections via `POST /api/bank/disconnect`), so changing banks is an
   explicit in-app step rather than something done inside Basiq's UI.
3. **Sample data** — one click, seeded with a price hike, a refund-window
   charge, and a lapsed subscription so the demo shows every feature.

## Billing

Freemium: free plan shows the top 3 leaks; **SubSweep Pro** unlocks the full
list and refund emails.

- No Stripe key → demo mode: upgrade is simulated, no card form anywhere.
- `STRIPE_SECRET_KEY` (`sk_test_` for test mode, `sk_live_` for real payments)
  + `STRIPE_PRICE_ID` (a recurring Price) → real Stripe Checkout subscription
  flow in test mode. Subscription state is driven by **webhooks**
  (`POST /api/stripe/webhook`, verified against `STRIPE_WEBHOOK_SECRET`:
  `checkout.session.completed`, `invoice.paid`,
  `customer.subscription.updated/deleted`), and Pro users can manage billing
  through the **Stripe Customer Portal** (`POST /api/billing/portal`).

## Accounts

Email + password auth (scrypt hashes, HMAC-signed session cookies, 30-day
expiry). Anonymous visitors can do everything except keep results; account
holders get their **derived** analysis saved and restored — raw transactions
are never persisted for anyone. User records live in **SQLite**
(better-sqlite3, WAL mode, `data/subsweep.db` — set `DATA_DIR` to point it
at a persistent volume in production). On first boot the server imports any
legacy `data/users.json` from the old file store and renames it
`.imported`. The store interface (`lib/users.js`) is a thin mapping layer,
so a later Postgres move only touches that file.

The site splits into a marketing landing page at `/` and the app at `/app`.

## Monitoring (monthly re-scan cycle)

Account holders can toggle **monthly monitoring**. An hourly server tick
(`lib/monitor.js`) finds users whose last scan is older than 30 days:

- with a live Basiq connection, it **re-syncs automatically**, diffs against
  the previous scan, and emails a change summary (new subscriptions, price
  changes, disappeared charges, monthly delta);
- otherwise it emails a **re-scan reminder** with a signed one-click
  unsubscribe link (`/api/monitoring/unsubscribe?token=...`).

Every fresh scan also computes the same diff and shows a **"since your last
scan"** panel in the app; restored results older than 30 days get a re-scan
banner. Reminders repeat at most once per cycle (`lastReminderAt`).

Email goes through **Resend** when `RESEND_API_KEY` is set (`EMAIL_FROM`
configures the sender); without it, messages land in `data/outbox.json` and
the server log, so the whole cycle is testable offline.
`DISABLE_MONITORING_TICK=1` turns the scheduler off (useful in tests).

**Email verification**: signup sends a 24h signed verification link
(`/api/auth/verify`); a banner with resend (rate-limited) shows until
confirmed, and monitoring emails only go to verified addresses. Accounts
created before the feature are grandfathered as verified.

**Password reset**: `/api/auth/forgot` always answers identically (no
account enumeration) and emails a 1-hour, single-use reset link — tokens
bind to a fingerprint of the current password hash, so using the link or
changing the password invalidates outstanding links. Reset logs the user
in and marks the email verified (they proved inbox access).

Remaining for production: broader rate limiting, HTTPS/`Secure` cookies
behind a proxy, and GST via Stripe Tax once revenue approaches the A$75k
registration threshold.

## Deploying on Railway

1. New Project → Deploy from GitHub repo → pick this repo.
2. Service **Settings → Root Directory** → `subsweep` (the app lives in a
   subfolder; `railway.json` handles the rest).
3. Add a **Volume** mounted at `/data`, and set the variable
   `DATA_DIR=/data` so the SQLite database survives deploys.
4. Set variables: `SESSION_SECRET` (long random string), `BASE_URL`
   (your Railway URL or custom domain), then the service keys as you get
   them: `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`,
   `RESEND_API_KEY`, `EMAIL_FROM`, `BASIQ_API_KEY`.
5. Settings → Networking → Generate Domain (or attach your own).

The Free plan runs this fine for testing; move to Hobby before sending
paid traffic.

## Mobile apps (iOS and Android)

`mobile/` wraps the same `/app` frontend in native shells with Capacitor,
talking to the live server over the API (bearer tokens instead of cookies,
CORS for the WebView origins). GitHub Actions (`.github/workflows/mobile.yml`)
builds both apps on every push that touches `public/` or `mobile/`, signs
them and uploads to TestFlight / Play internal testing once the store
secrets exist. Setup, secrets and store-policy notes are in
[`mobile/README.md`](mobile/README.md). The folder is excluded from the
server image via `.dockerignore`.

## Run

```bash
cd subsweep
npm install
npm start        # http://localhost:3100
```

| Env var | Effect |
| --- | --- |
| `PORT` | default 3100 |
| `BASIQ_API_KEY` | enables bank connect (sandbox or production key) |
| `BASIQ_LIVE` | `true` once Basiq has enabled the application for real institutions; otherwise the UI labels bank connect as a preview |
| `STRIPE_SECRET_KEY` | `sk_test_...` or `sk_live_...` enables Stripe subscription checkout (test mode is labelled in the UI) |
| `STRIPE_PRICE_ID` | the recurring Price for SubSweep Pro |
| `BASE_URL` | public URL for Stripe redirects |
| `LEGAL_ENTITY`, `LEGAL_ABN`, `CONTACT_EMAIL` | fill the operating entity into `/privacy`, `/cdr-policy`, `/terms` |

## Positioning note

SubSweep reviews the user's own spending on non-financial products
(streaming, apps, gyms). It deliberately does not recommend switching
financial products (insurance, loans, super) — in Australia that would be
financial product advice requiring an AFSL. Keep marketing claims to the
tool's function; avoid promised-savings figures you can't substantiate.
