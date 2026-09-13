# Sample statements

Two CSV files for testing the upload path by hand: one SubSweep reads, one it
cannot. Regenerate both, with dates anchored to today, using:

```bash
cd subsweep
node samples/make-samples.mjs
```

The script prints what the real parser and detector make of each file, so it
doubles as a quick check that detection still works after a change.

## statement-standard.csv

A Westpac-style export: header row, `dd/mm/yyyy` dates, separate Debit and
Credit columns, a running balance, and one quoted description containing a
comma. 145 transactions across about a year.

It is built so every part of the dashboard has something to show:

| Merchant | What it exercises |
| --- | --- |
| Netflix | Monthly, price rise from $18.99 to $22.99 — price-hike flag |
| Anytime Fitness | Fortnightly, charged 3 days ago — refund window |
| Adobe Creative Cloud | Monthly, charged 5 days ago — refund window |
| Stan | Monthly, stopped ~4 months ago — possibly lapsed |
| Secure Parking | Recurring merchant that is *not* in the known list |
| HelloFresh, Spotify | Ordinary steady monthly charges |

It also contains noise that must **not** be reported as a subscription, which
is the more interesting half of the test: groceries and fuel (recurring, but
the amounts vary too much to be stable), salary credits (incoming), rent
transfers and ATM withdrawals (matched as bank plumbing).

Expected result: 7 subscriptions, about $270/month, 2 in a refund window,
1 price hike. On the free plan the first 3 show and 4 are locked.

## statement-unsupported.csv

A German bank export — semicolon separated, comma decimals, `dd.mm.yyyy`
dates, and two preamble lines before the header. Nothing here matches what the
parser expects, so it is the file to use when checking the failure path.

Expected result: HTTP 400 and this message in the app's error toast:

```
No transactions recognised — expected columns like Date, Description, Amount (or Debit/Credit).
```

If you ever want SubSweep to accept files like this, the parser would need a
delimiter sniff, comma-decimal handling and a preamble skip — see
`lib/parse.js`.
