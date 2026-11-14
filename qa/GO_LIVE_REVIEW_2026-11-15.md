# Test series go-live review — 15 November 2026

**Current verdict: ready for a supervised pilot after deployment; paid public launch is not yet signed off.** The three reproduced reliability/privacy defects below have now been fixed in the local code. The checking workflow and its wording were left unchanged at the user's explicit request. No production deployment or production data changes were made.

## Follow-up implementation

- **Finding 1 fixed:** refreshes are tied to the current authentication generation and user. Delayed responses and errors are discarded after logout/account change. Logout clears private dashboard/sheet content and exam state. Regression checks cover both logout and signing into another account while the previous request is delayed.
- **Finding 2 fixed:** test, pack, and custom-cart checkout creation uses server-only Firestore reservations with compare-and-set preconditions, a recoverable lease, and a protected final commit. Tabs reuse the same order. Payment confirmation retries conflicting writes and records both paid orders, flagging duplicates for refund. Real Firestore integration tests cover 20 simultaneous requests, competing payments, lost commit responses, expired leases, and a delayed old lease owner.
- **Finding 4 fixed:** custom-paper keys, student-visible test, request status, and audit entry are committed atomically. A deterministic test ID and create-only preconditions prevent duplicates or overwrites. Retry recognizes a request that was already completed, including when the successful response was lost. Browser tests exercise both rejected commits and lost responses; emulator tests verify rollback and rules.
- **Finding 3 intentionally unchanged:** online tests still use teacher checking while the latest copy promises software checking plus teacher approval. This review does not certify that promise as implemented.
- Asset hashes were regenerated. Existing Firestore rules already deny client access to the new reservation collection and permit the admin's atomic publication; no rules relaxation or data migration was introduced.

All 12 post-fix check commands passed: online functions, online concurrency, real Firestore payment integration, offline functions, 92 online rules checks, the full online browser journey, online stress (including delayed logout/account switching), admin desk (including failed/lost publication responses), admin stress, portal logout/back, portal syntax, and asset-version checks.

The findings and reproduction evidence below describe the **original pre-fix audit**. Its 15-command checklist records the initial baseline; the new regression cases and payment integration test establish the fixes.

## Findings, in priority order

### 1. P1 — A delayed refresh reveals the dashboard after sign-out

Location: `assets/js/online-series.js:273–296`, with sign-out at line 236.

The session is checked before the six database reads, but not after they finish. Sign-out clears the session and displays the login screen. An already-running refresh then restores the previous student's fetched data and calls `show('app')`. The previous dashboard DOM remains visible even though the user is null.

Reproduced with a delayed Firestore response: immediately after logout the screen was `auth`; after releasing the response it became `app`, with `user: null`, Riya's name, rank, and latest result visible. No JavaScript error was emitted, so ordinary error checks miss it. This is exposure of already-loaded data on a shared device, not a demonstrated bypass of backend authentication.

Fix: associate every refresh with an authentication generation/user ID and discard responses after sign-out or user change; cancel pending work and clear sensitive rendered content on sign-out. Add a delayed-response logout/account-switch regression.

Evidence: `qa/artifacts/launch-review/logout-race.cjs`, `logout-race.log`, `logout-stale.png`.

### 2. P1 — Two simultaneous orders can hide a duplicate payment

Locations: `netlify/functions/online-series.js:337–340`; `netlify/functions/_online.js:111–150`.

Order reuse is a lookup followed by creation, without an atomic reservation. Two requests for the same student and test can both see no existing order and create separate Razorpay orders. If both confirmations race, the losing purchase write conflicts; `grantPurchase` suppresses that conflict and reports success without recording that order as paid or flagging it for refund.

Reproduced against the actual handlers with the existing in-memory external-service fixtures: two concurrent requests returned distinct order IDs; both signed confirmations returned 200/OK; one order was `paid`, while the other remained `created` with no duplicate flag. A later webhook delivery could reconcile it, but this failed confirmation itself returns success and does not guarantee recovery. The existing concurrency suite tests repeated confirmations of one order and many different students, which does not cover this case.

Fix: reserve/reuse orders atomically per student and purchase; on purchase conflicts, re-read and reconcile the payment record, recording duplicate payments for refund before reporting success. Cover two different paid orders racing for one entitlement.

Evidence: `qa/artifacts/launch-review/payment-race.cjs` and `payment-race.log`. No real payment was made.

### 3. P1 — The advertised checking workflow differs from the implementation

Locations: `test-series.html:104`, `assets/js/online-series.js:468`, `teacher-dashboard.html:3935`, `assets/js/admin-desk.js:480`, `:607`, `:685`, and `netlify/functions/offline-test.js:320–349`.

The latest login page, Home, start screen, pending state, and pack/custom purchase descriptions promise software checking followed by teacher approval. Teacher publishing forces online tests to `gradingMode: 'teacher'`; admin publishing does the same for ordinary, custom, and pack papers. Submission therefore enters the manual queue and does not trigger the software grader. Re-running AI checking is also refused for teacher-review scripts.

Fix: either describe the actual teacher-checking service consistently, or implement and validate the advertised software-plus-approval workflow end to end. The generic AI workflow elsewhere does not establish that online tests use it.

### 4. P2 — Retrying custom-paper publication creates duplicate papers

Location: `assets/js/admin-desk.js:476–483`.

Publication makes three separate writes: private paper, student-visible test, and request status. If the final write fails, the admin is told the student has not been sent anything, despite the test already being published. Retry generates a new random test ID and publishes another copy.

Reproduced by failing only the request-status PATCH once. After the error, one test was published. After pressing Send again, two distinct tests existed for the same request; the request linked only to the second.

Fix: use a stable ID per request and commit publication plus request status atomically, with safe retry behavior.

Evidence: `qa/artifacts/launch-review/custom-publish-retry.cjs` and `custom-publish-retry.log`.

## Student and staff experience

The normal journey is coherent: Google/TNC sign-in, subject cards, chapter/mock selection, free mock or payment/promo, timer warning, question paper, submission, and returned results. Mobile navigation and bottom sheets feel like an app. Pricing, custom-cart minimums, promo limits, submission state, and feedback are visible. The admin desk provides a practical queue for scripts and custom requests.

Browser checks covered 320, 390, 768, and 1440 px for the online portal; the selected screenshots were visually inspected. Ordinary navigation, payment cancellation, offline recovery, rapid tapping, and the tested upload/return flows passed. Related offline tests exercised real browser photo-to-PDF conversion, page ordering, and durable result access. These are emulated viewports, not physical-phone tests.

Recommended experience improvements:

- A new Google student must finish three onboarding steps, including address and guardian details, before seeing the test catalogue or trying the free mock. Consider collecting only the details needed to begin and requesting the rest later.
- For Classes 9–12, Packs and Leaderboard are inside More. This keeps the navigation compact but makes paid packs less discoverable. Ensure that is the intended commercial priority.
- I found no public privacy/terms/refund policy page linked from the signup/payment journey. Explain why personal and guardian details are collected and provide clear service/payment terms. This is a trust/launch-completeness observation, not a legal compliance determination.
- The 24-hour custom-paper and 48-hour results promises need real staffing coverage and a clear overdue/support experience. Passing functional tests does not establish those turnaround times.

## Checks completed

All 15 existing check commands below completed successfully:

| Check | Result |
| --- | --- |
| `node --experimental-vm-modules qa/portal-syntax.cjs` | 35 scripts parsed |
| `node scripts/version-assets.cjs --check` | Asset versions current |
| `node qa/online-functions.cjs` | Passed |
| `node qa/online-concurrency.cjs` | Passed |
| `node qa/offline-functions.cjs` | Passed |
| `node qa/online-rules.cjs` | 74 checks passed against the local Firestore emulator |
| `node qa/online-series.cjs` | Passed |
| `node qa/online-stress.cjs` | Passed |
| `node qa/admin-desk.cjs` | Passed |
| `node qa/logout-back.cjs` | Passed |
| `node qa/admin-stress.cjs` | Passed |
| `node qa/offline-series.cjs` | Passed |
| `node qa/offline-admin.cjs` | Passed |
| `node qa/portal-smoke.cjs` | Passed |
| `node qa/home-header.cjs` | Passed |

Browser suites used Chrome and a temporary Playwright installation outside the repository. Rule checks used only the isolated `demo-online` database at localhost:8189. Existing negative-test error logs were expected; the commands passed. The three additional reproduction scripts above demonstrate defects despite these passing suites.

## Deployment and real-service limits

- Read-only inspection of `https://thenewtownclasses.com/test-series` returned HTTP 200, the login screen, and an enabled Google button. The deployed page still has the older teacher-checked wording and does not contain the latest local changes.
- The deployed online function returned 401 for an unauthenticated session request, as expected. This does not verify paid checkout, service-account access, or the full signed-in path.
- A headless Chrome visit observed a 403 from the Firebase App Check reCAPTCHA token exchange. Automated-browser behavior may contribute. Verify on actual Android/iPhone browsers before interpreting this as a user-facing outage.
- No real Google login, signed-in production database access, Razorpay payment/capture/webhook, Uploadcare upload, or physical phone camera interaction was completed. Production rules, payment mode, webhook configuration, quotas, and turnaround staffing remain unverified.
- The concurrency suite uses in-memory services; it demonstrates application invariants for its scenarios, not production load capacity or latency.

## Release gate

1. Findings 1, 2, and 4 are fixed locally with regression coverage. Finding 3 remains unchanged by request; do not treat software checking as a verified feature.
2. Re-run affected checks and deploy the reviewed assets, functions, and rules together as applicable.
3. Complete a supervised Android and iPhone pilot: new Google student, existing TNC student, free mock, paid checkout and interrupted-payment recovery, photo/PDF submission, staff return, result download, ranking, custom paper, and pack access.
4. Confirm live payment capture/webhooks, policy links, operational ownership, and fulfillment capacity before opening paid public acquisition.

The implementation is ready for focused pilot testing after deployment. Real Google login, Razorpay capture/webhooks, Uploadcare, physical phones, operational promises, and the unchanged checking claim remain outside this sign-off.
