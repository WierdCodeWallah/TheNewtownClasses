# Portal checks

Run from the repository root:

For signed-in local use (including Netlify functions and Firebase App Check),
follow [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md). Live Server is for static
previews only.

```text
node --experimental-vm-modules qa/portal-syntax.cjs
node --experimental-vm-modules qa/local-development.cjs
node qa/portal-smoke.cjs
node qa/login-flow.cjs
node qa/auth-transitions.cjs
node qa/inquiries.cjs
node qa/offline-series.cjs
node qa/offline-functions.cjs
node qa/home-header.cjs
```

The browser check requires Playwright on Node's module path and an installed
Chrome browser. Set `PORTAL_BROWSER=edge` to use Edge instead. No npm dependencies
or build step are added to the website.

The homepage header check covers 320–1920px widths, touch menus, login links,
Escape and focus restoration, course scrolling and arrow controls, compact phone sizing,
the NEET/JEE/Olympiad/Class 7–12 highlight sequence, pause/resume, and reduced-motion
layouts. External services are blocked. Screenshots go to
`qa/artifacts/home-header/`; these checks use browser emulation, not physical phones.

The auth transition checks cover 320px and 390px phones, landscape and desktop,
rapid stage changes, keyboard dismissal/focus restoration, logout failure recovery,
and both OS and portal motion preferences. `LOGIN_SPLASH_ONLY=1` runs just the
slow-stylesheet dashboard splash checks in `login-flow.cjs`.

The smoke test serves the real portal HTML locally and replaces Firebase SDKs,
authentication, cloud data, and writes with fixtures. All external network
requests are intercepted. It checks:

- Student subject/chapter discovery, access-filtered materials and online tests.
- Notes PDF to all ten other student tabs on phone and desktop, including empty
  destinations, pending search callbacks and a delayed Results response.
- Student/teacher/admin login layouts, password visibility, failed-login recovery,
  animated illustration controls and reduced-motion preferences.
- Phone bottom-sheet navigation, ambient motion controls and accidental header /
  Home clicks staying inside the authenticated portal; explicit logout still works.
- Attendance calendar totals, subject/month changes and narrow-screen cell bounds.
- Profile details, keyboard focus trapping/restoration and chat message visibility.
- Results filtering, mobile pagination and a mocked AI response/composer flow.
- Class/subject/chapter drill-down, reset, search and limited result pages.
- Separate browse/create views and the teacher's two-step test editor.
- Marks and attendance selected across pages/searches save together.
- Changing class/board cannot save a roster from the previous selection.
- REST pagination, mobile AI composer placement and 320/390/1440px layouts.
- Browser JavaScript errors. Screenshots go to ignored `qa/artifacts/`.

These tests do not establish production network speed, Firebase permissions,
Zoom creation, AI responses or push delivery. Existing auth and access checks
are retained. A deployed, signed-in check is still needed for those integrations.

The inquiry check mocks Google and Firebase, covering the Google-only form gate,
sign-in cancellation, invalid input, failed-save recovery, live inbox alerts,
legacy and server dates, safe text rendering, status updates, search, pagination,
and 320/390/1440px layouts. It also verifies the app-style step flow, draft
preservation on close/reopen, browser Back, homepage demo entry, focus and action
visibility in reduced keyboard-sized viewports, and reduced-motion support.
Screenshots use fixture data only; physical iOS/Android keyboard and Google
popup behaviour still require an on-device deployment check.

To verify the actual inquiry security rules, start a local Firestore emulator
with `--host 127.0.0.1 --port 8187 --project_id demo-enquiries --rules firestore.rules`,
then run `node qa/inquiry-rules.cjs`. This checks anonymous/password/unverified
denials, forged identity and invalid data denials, Google-authenticated writes
with server timestamps, admin-only access, and status updates to legacy records.
It only connects to localhost and clears only the `demo-enquiries` emulator database.

Optional `module` metadata is added to materials/tests and `chapter`/`module` to
live classes. Existing records remain accessible under General / full syllabus
or General; no data migration is required. Netlify now rewrites the three clean
portal routes directly to their HTML instead of loading a second HTML document.

`offline-series.cjs` walks the Offline Test Series end to end with fixtures. A teacher
publishes a question-paper PDF without needing an answer key. Students download the
paper with a persistent timer and submit PDFs or photos. Real browser photo-to-PDF
conversion and page reordering are checked using PDF.js. Teachers download named
scripts, upload checked PDFs with marks, retry failed saves, and students reopen
their saved scripts in a fresh session (320px, 390px, 768px and 1440px). Existing AI-report
approval and PDF submission are also covered. Camera selection is simulated;
physical phone camera permissions still require an on-device check. The modern
offline screens are also checked at 320px and 768px, with a landscape upload sheet,
visible touch-sized submit controls, no horizontal overflow, and reduced motion.
Phone checks use 320×640 and 390×844 viewports and verify that the compact overview
stays under 190px and the first test action appears above bottom navigation without
scrolling. Instructions remain accessible from the expandable “How it works” menu.
`offline-functions.cjs` runs the two Netlify functions (timer, submission rules, AI
marking clean-up and integrity flags) against in-memory fakes; it needs no browser.
It also checks concurrent starts/submissions, board restrictions, assigned-teacher
authorization, marks validation, atomic return failures and idempotent retries.
The browser checks also cover the dedicated Results archive after promotion and
removal of the source test, paginated history, timer expiry/grace/late states,
invalid/oversize PDFs, camera-page append/removal, corrupt checked PDFs and
recovery from malformed upload responses and lost submission responses.

Start the local Firestore emulator on port 8188 with project `demo-offline` and
`--rules firestore.rules`, then run `node qa/offline-rules.cjs` and
`node qa/offline-integration.cjs`. The former exercises 56 real rule checks;
the latter runs the actual endpoint and Firestore REST helpers against the
emulator, including concurrent creation, atomic rollback and result publication.
Only localhost is used; authentication and file hosting remain fixtures.

New tests default to teacher checking (`gradingMode: teacher`). Existing tests keep
their AI workflow; teachers may explicitly select AI checking for new tests and
provide an answer key. Teacher checking requires the existing Firebase service
account and Uploadcare configuration, but no AI service. Deploy the dashboard,
assets and Netlify functions together, and publish the updated `firestore.rules`
separately. No data migration is required. See `OFFLINE_TEST_RELEASE.md` for the
remaining live release checks and storage limitations.


Offline series now uses Subject → Chapter → Module / Part navigation in both
Tests and Results. Legacy records use Full chapter. Offline Test Series results
are permanent: checked PDFs, marks, feedback and history never expire, and
there is no scheduled cleanup job. `offline-series.cjs` checks that a
three-year-old result keeps its PDF, marks, chapter average and count, and that
My Results shows it beyond the usual 12-month window. Teachers' script
downloads are saved as `Name_ID_Test.pdf`. Tests given include submitted
attempts; chapter averages include all graded parts. The compact animated
process guide promises results within 48 hours of submission. See
`OFFLINE_TEST_RELEASE.md` for deployment steps.
