# App Store Connect listing — SubSweep 1.0

Everything App Store Connect asks for, in the order the console asks for it.
Copy the fenced blocks verbatim; they are already inside Apple's character
limits (counted in brackets). The Play Console listing uses the same copy
where the two stores overlap, so changing one means changing the other.

Screenshots live in `screenshots/ios-6.9/` and `screenshots/ios-6.5/` — one
folder per App Store Connect upload slot (see §3). `screenshots/` holds the
1080×1920 Play versions of the same four screens.

---

## 1. App Information

Set once for the app, not per version.

| Field | Value |
| --- | --- |
| Name | `SubSweep: Find Subscriptions` [28/30] |
| Subtitle | `Find forgotten subscriptions` [28/30] |
| Bundle ID | `au.com.subsweep.app` |
| SKU | `subsweep-ios-001` |
| Primary language | English (Australia) |
| Primary category | Finance |
| Secondary category | Utilities |
| Content rights | Does not contain, show or access third-party content — **No** |
| Age rating | 4+ (see §5) |
| License agreement | Apple's standard EULA |

If the app record was created as plain `SubSweep`, renaming it to the longer
name above is worth doing before the first submission: the name field carries
the most weight in App Store search, and `SubSweep` alone matches nothing
anyone searches for.

## 2. Version 1.0 information

**Promotional text** — editable any time without a new build, so it is the
place for anything time-sensitive. [151/170]

```
Bank connect is coming soon. Until then, upload a CSV from any Australian bank and SubSweep finds every recurring charge, price rise and refund window.
```

**Description** [1774/4000]

```
SubSweep finds the subscriptions you forgot you're paying for.

Export a CSV from your bank's online banking, open it in SubSweep, and you get every recurring charge in one list: what it costs a month, what it really costs a year, when it was last charged, and how to cancel it.

WHAT IT FINDS

• Recurring charges of every rhythm — weekly, fortnightly, monthly, quarterly and annual — in any Australian bank's CSV export
• The true yearly cost, so a $16.99 charge reads as the $203.88 a year it actually is
• Price rises, so you can see when a subscription quietly went up and by how much
• Charges still inside a refund window, while asking for your money back is worth doing
• A direct link to the cancellation page for the services people most often want to leave

PRIVACY FIRST

Your statement is analysed in memory for your session and never written to disk. SubSweep keeps the list of subscriptions it found, not your transactions. There is no advertising, no tracking, and nothing is sold to anyone.

NO ACCOUNT NEEDED

Load the sample statement to see exactly how it works, or upload your own straight away — neither needs an account. Create one only if you want your list saved between visits and a monthly reminder to check again.

Free accounts see the top three subscriptions found. SubSweep Pro accounts see every subscription, plus refund-request emails and monthly monitoring.

MADE IN AUSTRALIA

Built for Australian bank export formats, Australian dollars and Australian services. Bank connection through the regulated Consumer Data Right consent flow is coming soon; CSV upload works with every Australian bank today.

SubSweep helps you review your own spending. It is not a bank, it does not move money, and it does not provide financial product advice.
```

**Keywords** — comma separated, no spaces after commas (spaces count against
the limit). Apple indexes the name and subtitle too, so the words already
there — subscriptions, find, forgotten — are deliberately not repeated here.
[99/100]

```
recurring,bank,statement,csv,spending,budget,cancel,refund,bills,expenses,money,tracker,unsubscribe
```

| Field | Value |
| --- | --- |
| Support URL | `https://www.subsweep.com.au/` |
| Marketing URL | `https://www.subsweep.com.au/` |
| Privacy Policy URL | `https://www.subsweep.com.au/privacy` |
| Version | `1.0` |
| Copyright | `2026 Qadan Analysis Consulting` |
| Release | Manually release this version |

"What's New in This Version" only appears for updates, so 1.0 has none.

## 3. Screenshots

App Store Connect shows a separate upload slot per iPhone display size, and
each slot accepts only its own exact pixel sizes — putting the wrong set in a
slot fails with "The dimensions of one or more screenshots are wrong". There
is a folder per slot:

| Slot in App Store Connect | Folder | Accepted sizes |
| --- | --- | --- |
| iPhone 6.9" Display | `screenshots/ios-6.9/` | 1320×2868 (also 1290×2796) |
| iPhone 6.5" Display | `screenshots/ios-6.5/` | 1284×2778 (also 1242×2688) |

Filling the 6.9" slot is enough for submission — Apple scales it down for
smaller iPhones — but the 6.5" set is there because the console still offers
that slot, and a set uploaded into it beats a scaled one. `TARGETED_DEVICE_FAMILY = 1`
means the app is iPhone-only, so no iPad screenshots are asked for.

The four files go in numbered order in either slot:

| File | Shows |
| --- | --- |
| `01-start.png` | Upload, bank connect (coming soon) and sample-data cards |
| `02-results.png` | The yearly total, refund-window and price-hike counts |
| `03-subscriptions.png` | The subscription list with its badges and cancel links |
| `04-more.png` | What a Pro account adds, and the privacy statement |

They are captured from the real app with the Capacitor runtime stubbed in, so
they show what the shipped build shows — no purchase button, bank connect as
"coming soon". Screenshots of the website would show an Upgrade button the app
does not have, which is exactly the mismatch guideline 2.3.3 rejects.
Regenerate with the commands in `README.md`.

## 4. App Privacy

Mirror of `ios/App/App/PrivacyInfo.xcprivacy`; the two must agree.

**Data used to track you:** none. **Data linked to you:**

| Data type | Category | Purpose | Used for tracking |
| --- | --- | --- | --- |
| Email Address | Contact Info | App Functionality | No |
| Other Financial Info | Financial Info | App Functionality | No |

Everything else is **No**: no name, no precise location, no contacts, no
identifiers, no usage data, no diagnostics, no third-party analytics SDK in
the bundle. "Other Financial Info" covers the derived subscription list saved
for signed-in users — the raw transactions are analysed in memory and never
stored, which is why they are not declared.

Answer **No** to "Do you or your third-party partners collect data from this
app?" only if nothing is collected; SubSweep does collect the two rows above,
so answer Yes and declare them.

## 5. Age rating

4+. No objectionable content of any kind: no violence, nudity, profanity,
gambling, contests or user-generated content. The app opens a small set of
known URLs (the legal pages and cancellation guides) in the system browser, so
answer **No** to unrestricted web access — there is no address bar and no way
to browse arbitrary sites.

## 6. Pricing and availability

Free, no in-app purchases. Available in **Australia** to start with: the CSV
parsing, the cancellation guides and the Consumer Data Right flow are all
Australian, so a listing elsewhere would promise something the app cannot do.
Widening the territories later is a pricing change, not a new build.

## 7. App Review Information

| Field | Value |
| --- | --- |
| Sign-in required | **No** |
| Contact first / last name | Jay Qadan |
| Contact phone | *(your number)* |
| Contact email | hello@subsweep.com.au |

**Notes to the reviewer**

```
No account is needed to review the app. On the first screen, tap "Try with sample data" to load a realistic Australian bank statement — SubSweep then shows the full analysis: yearly totals, price-hike flags, refund windows and cancel links. "Choose CSV file" does the same with any CSV export from an Australian bank; a sample file is linked from that card.

Accounts are optional and only save the result list and enable a monthly reminder email. Sign-up is email and password, and email verification is not required to use the app. Accounts can be deleted from inside the app (tap the email address in the header, then "Delete my account") and deletion is immediate and permanent.

There are no in-app purchases and no purchase or billing UI anywhere in the app. SubSweep Pro is a multi-platform service subscription bought on the website; per guideline 3.1.3(b), the app lets an existing Pro account use what it already paid for, and contains no link, button or call to action to buy it.

Bank connection over open banking (Consumer Data Right) is shown as "coming soon" and is disabled — our accreditation with the data provider is still in progress — so CSV upload is the only way in for this version.

SubSweep analyses a statement the user supplies and reports what it finds. It is not a bank, holds no funds, moves no money, and gives no financial product advice.
```

## 8. Export compliance and other declarations

| Question | Answer |
| --- | --- |
| Does your app use encryption? | Yes |
| Qualifies for an exemption? | Yes — HTTPS only, standard OS encryption (exempt under 740.17(b)) |
| Uses the Advertising Identifier (IDFA)? | No |
| Third-party content? | No |
| Contains ads? | No |

`ITSAppUsesNonExemptEncryption` is already set to `false` in `Info.plist`, so
App Store Connect should not ask per build. If it does, the answers above are
the ones.

## 9. Order of operations

1. Fill in §1 and §2, upload the §3 screenshots, answer §4–§6 and §8.
2. Pick a build under TestFlight (the workflow uploads one on every push to
   `claude/subsweep-app`) and attach it to version 1.0.
3. Paste the §7 notes, then Submit for Review.

Rejections in this category are almost always metadata, not code: a screenshot
showing something the build does not do, or an App Privacy answer that
disagrees with `PrivacyInfo.xcprivacy`. Both are covered above — keep them in
step when the app changes.
