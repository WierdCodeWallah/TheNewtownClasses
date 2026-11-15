# Online Test Series (all-India) — release notes

Updated 2026-11-15. Code and local checks only; Razorpay setup, deployment and a
signed-in pilot on real phones are still required.

Reliability fixes on 15 November: logout/account changes discard old refreshes;
checkout orders are reserved atomically per buyer/purchase; racing payment
confirmations reconcile both payment records and flag duplicates; custom-paper
publication is atomic and safe to retry after a failed or lost response.
Deploy `online-series.js`, `_online.js`, `admin-desk.js`, the online client and
their versioned HTML together. The existing rules already protect the new
server-only `onlineOrderReservations` collection. No data migration is needed.
See `GO_LIVE_REVIEW_2026-11-15.md` for validation and remaining live checks.
The software-checking marketing wording remains unchanged by request; online
papers still use manual teacher checking.

## What students get — `/test-series`

An app-style page (bottom tabs on phones, side rail on laptops):

1. **Sign in** with Google, or with a **TNC ID** (enrolled students skip the form).
2. **Sign-up form** (Google students, 3 short steps): name, date of birth, gender, mobile ·
   class, board, school, subjects, preparing for · address, city, state, PIN, guardian name,
   relation and mobile. Drafts survive closing the page.
3. **Home**: tests given, in review, best rank; subject cards.
4. **Subject**: three sections — **Chapter-wise** (₹199 each), **Full mocks** (₹499 each), **Results**.
5. **Free full mocks** on subjects the student chooses (Home "free mock" chip/card, or
   "Use a free mock here" on any mock); a used free mock cannot be moved.
   - Online (Google) students: **1 free mock**; chapter-wise ₹199, other mocks ₹499.
   - TNC students: **chapter-wise tests, full mocks and custom module tests are free**, so they
     appear on the leaderboard. **Mock packs are paid** for them too (same price; promo codes work there).
6. **Unlock** with Razorpay (UPI, cards, net banking) → **Start** → paper + server timer →
   write on paper → upload one PDF or page photos → teacher checks → checked script and marks
   in **Results** (permanent).
7. **Leaderboard** per class + subject: number of students, top three ("Riya S." + city) and
   the student's own rank, by average % across checked tests.
8. **Profile**: all details, edit, WhatsApp help, sign out.

## App layout and trust

- **Phone tab bar: 4 items** — Home · Packs · Results · **More**. More opens a sheet with Leaderboard
  (with the student's best rank), Custom test (Classes 9–12), Profile, Help on WhatsApp and Call us.
  Laptops keep every page in the side rail.
- Online students never see a teacher's name: everything says **Checked by TNC faculty**. The
  student's result stores "TNC faculty" (no checker ID); admins still see who checked in Test Desk.
- **Payment safety**: a second tap or a second tab gets the *same* unpaid Razorpay order (reused for
  20 minutes), and Razorpay accepts only one payment per order, so a student cannot be charged twice
  by tapping again. If a payment ever arrives for something already unlocked, the order is flagged
  **Duplicate · refund** in Admin → Online Students → Payments. Prices and amounts are always set by
  the server; payments unlock only after the Razorpay signature (checkout) or the signed webhook is
  verified; Razorpay error details stay in the server logs.

## Mock packs (weekly mock series)

For serious students and parents: a set of full-syllabus mocks in one subject, **one a week on a
fixed day and time**, sold as one pack — e.g. **8 mocks ₹3199** or **4 mocks ₹1699** (presets;
any count 1–52 and any price can be set).

- **Students → Packs tab** (separate from the **Custom** tab): *All packs* shows the packs on sale
  for their class (and board, if the pack is board-specific) with price and ₹ per mock; *My packs*
  shows joined packs with progress. A pack's sheet lists every date; **Join for ₹…** opens Razorpay
  (non-refundable notice shown), or a promo code / the contact card before Razorpay is live.
  TNC students pay for packs too.
- Each mock **opens at its time** (locked until then, enforced on the server too) and can be taken
  any time after. It follows the normal flow: timer → upload → teacher-checked → results → rank.
- Home shows a **Next mock** card (or *Mock ready* once it opens). Not joined yet → a pack offer.
- **Admin → Test Desk → Packages**: **New mock pack** (preset, class, subject, board, first date,
  time, price; the weekly schedule is previewed before saving). Open a pack to see its schedule,
  uploaded x of n, how many students joined, and **Pause selling** (joined students keep every mock;
  packs are never deleted).
- **Reminders**: a pack mock with no paper appears in **To make** from 7 days before it opens, and
  counts in the blinking reminder (menu, Tests tab, Home notice: "N pack mocks to upload") from
  **3 days before** — red *Overdue* once its time has passed. Tap it → choose teacher, marks, time,
  PDF (date/time pre-filled; changing it moves only that mock) → **Upload mock**. Students in the
  pack see it at the opening time.
- Joining is stored as `onlinePurchases/pkg_{packId}__{uid}` (server-written only). Promo codes can
  be limited to **Mock packs**.

## Promo codes and the contact card (before Razorpay)

- Every Pay screen has **Have a promo code?** (chapter test, full mock and custom-module cart for
  Google students; mock packs for everyone, TNC students included). A valid code makes that
  one purchase **₹0** and unlocks it at once — no Razorpay needed. TNC students don't see it on
  chapter tests, full mocks or custom tests, which are already free for them.
- While Razorpay is not connected, the Pay button is replaced by a **contact card**: Call
  +91 99034 61361 or WhatsApp (pre-filled with the test name, class and the student's ID).
  Send them a code from admin and they unlock it themselves.
- **Admin → Online Students → Promo codes**: create a code (random suggestion or your own,
  4–20 capital letters/digits), choose what it works on (any / chapter-wise / full mocks /
  custom modules / mock packs), total uses (1 = one student, 0 = no limit), once per student, optional
  expiry and a note. Turn codes off any time; *Who used it* lists every redemption (student,
  ID, what it unlocked, date, amount saved).
- **Limits (optional)**: *Covers up to ₹* (e.g. 399) and *Up to chapters* (custom tests, e.g. 2).
  A bigger purchase is refused with a clear message ("This code covers up to 2 chapters. Your cart
  has 4 — remove 2 to use it" / "covers up to ₹399. This purchase is ₹499") and nothing is used up.
  The cart re-checks an applied code when chapters are added, and the server checks again at order time.
- **Only for (optional)**: search a Google student by name, ID or mobile and lock the code to them
  (or open a student's details → **Give a promo code**). The list shows "For <name> · <ID>". If the
  code is shared, anyone else is told *This promo code was made for another student* and nothing is
  used up. Leave it empty for a general code. The student a code is for cannot be changed later.
- The server checks every code (active, not expired, right type, uses left, not used before by
  that student) and counts uses atomically. Students cannot read the list of codes.

## Payments are non-refundable

Every Pay screen (test unlock, custom-module cart) shows **"Non-refundable. Once paid, the amount
is not refunded or exchanged."** above the Pay button, and the Razorpay window's description ends
with "· Non-refundable". A payment that never went through is different: the bank returns any
amount it held, and the app says so. Razorpay's account activation also asks for a Refund /
Cancellation policy page on the website; it should state the same rule.

## Custom module test (Classes 9–12)

A **Custom** tab (shown only to Classes 9–12): the student picks a board (CBSE, or ICSE for
9–10 / ISC for 11–12), taps chapters from any subjects into a cart, and pays once.

- Price for the whole cart: **₹199 a chapter for the first 4, ₹150 for each chapter after that**
  (5 chapters = ₹946). Free for TNC students.
- **At least 2 chapters per subject** (each subject is one paper; a single chapter is a chapter-wise
  test). Until then the cart shows "Add 1 more <subject> chapter" and Review / Pay stay locked; the
  server refuses it too.
- Each subject in the cart becomes **one paper** covering exactly those chapters. The student sees
  it under **My tests** as *Preparing · ready by …* (promise: within 24 hours).
- **Test Desk → Requests** lists every order (student, class, board, subject, chapters, paid, due).
  Open one → choose the teacher, marks, time, upload the PDF → **Send paper to student**. The paper
  unlocks for that student only, and they take it like any test (timer, upload, teacher-checked,
  Results, leaderboard). Waiting requests add to the blinking Test Desk count.
- Chapter lists live in `assets/js/syllabus.js` (CBSE = current NCERT; ICSE/ISC = 2025–26 CISCE,
  written as textbook chapters). **Ask a teacher to check the ICSE/ISC lists before launch** and
  edit that one file; the server validates every order against it.
- Change prices or the 24-hour promise in `assets/js/online-policy.js` (`MODULE`).

## Teachers and admins

- Publishing (Teacher → Offline tests, Admin → Test Desk → New paper): new **Test series**
  choice — *Offline · enrolled students* or *Online · all-India* — and **Online test type**
  (Chapter-wise ₹199 / Full mock ₹499). Online tests are always teacher-checked.
- Online scripts arrive in the same **Answer Script Review** desk and admin **Records**
  (filter **Series: Online**). Returning a script updates the student's results and the leaderboard.
- **Admin → Online Students**: every sign-up with full form details, tests unlocked, free mock used,
  scripts; **Payments** (Razorpay IDs, paid / not completed); **Export CSV**.
- Enrolled students' `/learn` keeps showing offline-series tests only.

## Admin → Test Desk

One app-style screen for running the test series (online and offline), also on the bottom tab bar as **Tests**:

- **To check** — every answer script waiting, oldest first, overdue (48 h) marked red. Open one →
  download the script → upload the checked PDF → marks, feedback and the teacher shown as checker →
  **Send back to student**. The student sees it in Results at once and the leaderboard updates.
- **Checked** — everything returned, with marks, feedback and both PDFs.
- **Papers** — every question paper with submitted / to-check counts; close or reopen; **New paper**
  publishes one (series, chapter-wise or full mock, class, subject, marks, time, PDF) in a teacher's name.
- **To make** — custom-module papers students ordered and pack mocks due within a week, soonest first.
- **Packages** — weekly mock packs: create, schedule, upload each mock, pause selling (see *Mock packs*).
- **Students** — per-student tests and averages; open one for their scripts. Any script's sheet has
  **Delete this record permanently** (locked until the student ID is typed).
- Search plus Series / Class / Subject pills; lists are paged (6 rows on phones), so they stay tidy at any volume.
- **Blinking count**: the menu item, the Tests tab and a red notice on every admin page show how many
  scripts are waiting, custom papers to make and pack mocks to upload (from 3 days before they open).
  It is rechecked every minute and keeps blinking until everything is done.

Every Test Desk list is **grouped by Class · Subject** (Students by class), one card per group with
its count. To check / To make put the group with the most urgent item first; the other tabs go by
class. Rows are two short lines (name + one detail); everything else opens on tap. Phone Back and
Escape close an open sheet without leaving the page.

Across the admin panel: section descriptions sit behind a small ⓘ next to the title, the reminder
strip is slim, empty lists say "Nothing here yet" (not "No matches"), and buttons carry no emoji.
**Security:** admin tables built from teacher-written records (study material, class tests, live
classes, test results) now escape every value and allow only http(s) links, so a crafted name can
never run code in the admin's session. `node qa/admin-stress.cjs` checks all of this.

Test Desk replaced the old *Admin → Offline Test Series* section (same data, one place). The menu
is shorter too: Add Student, Bulk Import and Reset Password are tabs inside **Students**.

The rest of the admin panel uses the same clean style (`assets/css/admin-app.css`): forms follow
the New paper design (label above a white box, two per row, dashed upload tile). On phones:
Home fits one screen; student rows show name / ID / class and open on tap; search + filters take
two slim rows; forms place short fields two per row (Add Student fits one screen); live classes
are two-line rows with their actions underneath. Laptop layouts are unchanged apart from the
slimmer search and filter rows.
Check: `node qa/admin-desk.cjs` (Playwright; 320 / 390 / 1440 px).

## Capacity and plans (read before launch)

- **Pages** (HTML/CSS/JS, ~60 KB compressed for /test-series) come from Netlify's CDN: hundreds of
  visitors at once is routine. Papers and answer scripts go phone ↔ Uploadcare directly.
- **Server functions** run one request per instance and scale out automatically; 100–500 requests at
  once is handled by more instances (first requests after a quiet spell take ~0.5–1 s longer).
  `qa/online-concurrency.cjs` fires hundreds of simultaneous requests at the real code: no double
  unlocks, no double promo uses, no duplicate scripts, collisions on one promo code retried by the
  server, outside services time out after 8 s with a friendly message.
- **What would actually take the site down is a quota, not traffic:**
  - Netlify **Free** plan = 300 credits/month with a hard stop; when they run out the site is
    **paused** until next month. Use **Personal** (1,000 credits) or **Pro** (3,000, auto-recharge).
  - Firebase **Spark** (free) = 50,000 database reads/day; ~500 active students exceed that, and the
    database then refuses requests until about 1:30 pm IST the next day. Use **Blaze** with a budget alert.
- **Speed:** the database is in Mumbai (asia-south1) but Netlify functions default to Ohio, USA. Set the
  functions region to **Singapore (sin)** in Netlify → Project configuration → Functions (paid plans)
  to make every server action roughly 3–4× faster for students in India.

## Go-live steps

1. **Razorpay** (Dashboard → Account & Settings → API Keys; use Test mode first):
   add to Netlify environment variables
   - `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`
   - `RAZORPAY_WEBHOOK_SECRET` (any long random string)
   - optional `ONLINE_CHAPTER_PRICE_INR` / `ONLINE_MOCK_PRICE_INR` (defaults 199 / 499)

   Until the keys are set, students see "Payments open soon"; free mocks and TNC IDs still work.
   For local testing with Netlify Dev, put the **test-mode** keys in a `.env` file in the project
   folder (already git-ignored) or in Netlify's "Local development" context. Never put keys in
   any website file: the site root is publicly downloadable.

   After a successful payment the student is taken back to that subject's list with the test
   highlighted as **Unlocked · tap to start**; tapping it shows the timer warning and
   **Start now** opens the exam. If the phone reloads during a UPI payment, the page finishes
   confirming on its return and opens the same test.
2. **Webhook** (Razorpay → Settings → Webhooks → Add): URL
   `https://<site>/.netlify/functions/razorpay-webhook`, the same secret, events
   `payment.captured` and `order.paid`. This unlocks a test even if the phone closes mid-payment.
   Keep Payment Capture on **Automatic**.
3. **Firestore rules** (new collections `onlineStudents`, `onlinePurchases`, `onlineOrders`, `moduleRequests`,
   `onlineFreeClaims`, `onlineLeaderboard`, `promoCodes`, `promoRedemptions`, `mockPackages`;
   students may list their own `offlineAttempts`):
   ```sh
   firebase deploy --only firestore:rules --project the-newtown-classes-d98e8
   ```
4. **Google sign-in**: already enabled for inquiries. Confirm the live domain is in Firebase →
   Authentication → Settings → Authorized domains. Google blocks sign-in inside WhatsApp /
   Instagram browsers; the page detects this and asks students to open Chrome or Safari.
5. Deploy the site (dashboards, assets, `test-series.html`, functions `online-series.js`,
   `razorpay-webhook.js`, `_online.js`, updated `offline-test.js`).
6. Pilot on a real Android phone and iPhone: Google sign-up, free mock, a ₹199 test-mode
   payment, upload photos, teacher return, leaderboard, TNC ID sign-in.

## Checks

- `node qa/online-functions.cjs` — profile validation, Google-only sign-up, TNC auto-profile,
  ₹199 / ₹499 orders, signature check, one free mock only, webhook (signed, amount-checked,
  idempotent), unlock enforced at Start (402), custom module, promo codes, mock packs (schedule,
  ₹3199 join, webhook join, paused / other board refused, opens only at its time, TNC students pay, pack
  promo), results path, leaderboard, admin delete.
- `node qa/online-rules.cjs` — real rules in a local Firestore emulator (port 8189): portal reads,
  privacy, admin Test Desk, promo codes, mock packs (admin-only create/pause, no delete).
- `node qa/online-series.cjs` (Playwright) — sign-in, form, Home, sections, free-mock picker,
  Razorpay unlock, timer + paper, Back button, upload + submit, ranks, results, profile,
  TNC ID, cached instant open, custom module, promo codes, mock packs (join, schedule, open mock,
  Home next-mock card); 320 / 390 / 768 / 1440 px with no horizontal overflow.
- `node qa/online-stress.cjs` (Playwright) — impatient-user checks: rapid tab switching (timed), triple
  tap on Pay → one order, closing Razorpay, failed confirmation, phone Back with sheets open,
  offline and back, HTML/script in a name never runs, every page at 320 px.
- `node qa/admin-desk.cjs` (Playwright) — Test Desk incl. To make (custom + pack mocks), Packages
  (upload a due mock, new pack, pause) and promo codes.
  Screenshots in `qa/artifacts/online-series/`.
- Existing suites still pass: offline-functions, offline-series, offline-admin, portal-smoke,
  home-header, portal-syntax, `scripts/version-assets.cjs --check`.

Not covered locally: real Razorpay, real Google popup, physical phone cameras.

## SEO (search)

- `/test-series`: title "Online Test Series India – Class 7–12 | The NewTown Classes", a description
  with CBSE / ICSE / chapter tests / full mocks, social-share tags, and structured data
  (EducationalOrganization + WebPage + Course with prices). The homepage description, keywords and
  organisation data now mention the all-India online test series; the sitemap is updated.
- After deploying: Google Search Console → URL inspection → `https://thenewtownclasses.com/test-series`
  → Request indexing, and resubmit `sitemap.xml`. Rankings for broad searches like "test series India"
  build over time (links from other sites, Google Business Profile, reviews); brand searches for
  "The NewTown Classes test series" should pick it up first.

## Classes 7–8: Custom tests on, mock packs off

- Custom module tests are open to **Classes 7–12** (Home · Custom · Results · More on phones).
  Mock packs are shown to **Classes 9–12 only** (and the server refuses a pack for Class 7–8).
- Chapter lists (`assets/js/syllabus.js`) now cover Classes 7–12 for CBSE and ICSE/ISC:
  - CBSE 7–8: new NCERT books — Science *Curiosity* (Class 7: 12 chapters, Class 8: 13),
    Maths *Ganita Prakash* Parts 1 + 2 (Class 7: 15, Class 8: 14).
  - ICSE 7–8: Physics, Chemistry, Biology and Mathematics, following the Selina Concise books
    (CISCE has no single prescribed book for these classes). **A teacher should check these lists
    against the school's books before launch.**
- Admin → Test Desk → New mock pack offers Classes 9–12 only.

## Results to parents

- **Email (automatic):** when a checked script is sent back, the result (marks, %, teacher's feedback,
  "View checked answer sheet" and "Open all results" buttons) is emailed to the parent's email and
  the student's own email. The sign-up form has an optional **Parent's email** field (also editable in
  Profile → Edit details). Test Desk's toast says who was emailed. A failed email never blocks the return.
  **Setup:** create a free Brevo account, verify a sender address (e.g. results@thenewtownclasses.com),
  then add `BREVO_API_KEY` (secret) and `RESULT_EMAIL_FROM` (that address) in Netlify → Environment
  variables, and redeploy. Optional `RESULT_EMAIL_FROM_NAME` (default "The NewTown Classes").
  Without the key, nothing is emailed.
- **WhatsApp (stopgap, one tap):** Test Desk → Checked → open a script → **Send result to parent on
  WhatsApp** opens WhatsApp with the result typed out, addressed to the parent's mobile from the
  Test Series profile (or the institute record). Automatic WhatsApp needs the WhatsApp Business
  Platform and an approved Meta template.
