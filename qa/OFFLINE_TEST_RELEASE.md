# Offline Test Series — release notes

Updated 2026-11-10. Code and local checks only; deployment and a signed-in
pilot are still required.

## Workflow

Student opens Offline Test Series → downloads the paper (server timer starts and
survives refreshes) → writes on paper → uploads one PDF or page photos (photos
are converted to a single PDF in the browser, with page reordering) → the
assigned teacher downloads the script (saved as `Name_ID_Test.pdf`), checks it,
and uploads the checked PDF with marks and optional feedback → the student sees
it in **Offline Test Series → Results** and in **My Results**.

## Student experience

The compact navy-and-gold guide uses four small animated figures: download,
write, upload, teacher review. It includes the promise **Results within 48 hours
of submission**. Reduced-motion mode presents one static scene. The 320-pixel
phone layout keeps the first test action above the bottom navigation.

Both Tests and Results follow **Subject → Chapter → Module / Part → Test**.
Teachers enter the module/part when publishing; blank or older metadata appears
under **Full chapter**. Module metadata is copied into the submission, history
and returned result, so changing class or closing a test does not lose grouping.

The dashboard shows tests given, pending review and returned results. Chapter
averages use the arithmetic mean of each graded test's percentage across all
parts of that chapter. Pending tests count as given but do not contribute to
averages.

## Organised records (teacher and admin)

Everything follows **Class → Subject → Chapter → Module / Part → Test**, with
search that jumps straight to a student, test or chapter. Levels with a single
choice are skipped, and long lists are paged.

- **Teacher → My offline tests:** drill-down by class/subject/chapter, Part and
  Live/Closed filters, and submissions / to-check counts per test.
- **Teacher → Answer Script Review:** tab counts; Awaiting review and Being checked
  are oldest-first queues with Class/Subject/Chapter/Part/Test filters; Returned
  scripts drill down by class → subject → chapter.
- **Admin → Offline Test Series:** summary tiles (submitted, students, returned,
  awaiting review, overdue past 48 h, average). **Records:** every submission with
  drill-down, filters and search; Review opens a sheet with marks, feedback and
  dates, opens or downloads the checked PDF and the student's script, and shows
  legacy AI reports. **Students:** tests per student with per-subject counts and
  averages, sortable, filterable by class/board/subject. **Class × Subject:**
  submissions, students and average per cell; tap a cell to open those records.
  Admin views never edit or delete records.

## Admin acting in a teacher's name

Admin → Offline Test Series → **Tests** lists every teacher's tests (drill-down,
Teacher and Live/Closed filters, Close/Reopen) and has **Publish a test** for any
class and subject. The admin picks the teacher first; the test is saved with that
teacher's name, students see that teacher, and scripts go to that teacher's review
desk as usual. In **Records**, an unreturned script shows **Check & return**: the
admin downloads the student's script, chooses the teacher shown as the checker
(the assigned teacher is preselected), uploads the checked PDF with marks and
feedback, and it is returned in that teacher's name.

The real actor is recorded privately in `offlineAudit` (`publish_{testId}` and
`return_{attemptId}`: admin uid, teacher uid and name, time). Only admins can read
it; teachers and students cannot, and entries cannot be edited or deleted. Nothing
students can read names the admin. The server only accepts `onBehalfOf` from an
admin and only for an existing teacher.

**Deploy note:** this adds the `offlineAudit` rule, so publish the rules again with
`firebase deploy --only firestore:rules --project the-newtown-classes-d98e8`.

## Retention: permanent

Checked PDFs, marks, feedback, answer scripts and history are kept permanently.
Nothing expires and there is no scheduled cleanup job. Teachers cannot delete
test-series results from the dashboard (Firestore rules); tests are closed, not
deleted. My Results shows ordinary results for the last 12 months but always
shows Offline Test Series results.

Uploads are sent with `UPLOADCARE_STORE=1`, so Uploadcare keeps them until they
are deleted manually. Keep an eye on the Uploadcare storage quota as scripts
accumulate (about 0.5–1 MB per photographed page).

The 48-hour statement is a teacher service commitment. The teacher inbox shows
return deadlines and puts older pending scripts first; the system does not invent
marks or automatically return an unchecked script.

## Deployment steps

1. Deploy the dashboards, updated assets and Netlify functions together,
   including `uploadcare-config.js`, `offline-policy.js`, `offline-files.js`,
   `_google.js` and `offline-test.js`.
2. Publish `firestore.rules` separately (Netlify does not deploy Firestore rules):

   ```sh
   firebase deploy --only firestore:rules --project the-newtown-classes-d98e8
   ```

3. Confirm Netlify has `FIREBASE_PROJECT_ID` and `FIREBASE_SERVICE_ACCOUNT`.
   Confirm PDF uploads are enabled in Uploadcare.
4. Run a signed-in teacher/student pilot on real Android and iPhone: publish under
   a subject/chapter/part, download and refresh the timer, submit photos and a PDF,
   download the script as the teacher, return a checked PDF, then reopen the
   correct Results folder after signing in again.

## Verification

- `node qa/offline-functions.cjs`: backend permissions, timers, class/board,
  concurrent requests, retry, return, module preservation and legacy AI behavior.
- `node qa/offline-admin.cjs` with Playwright: admin and teacher organised views
  at 121 records (drill-down, search, counts, review, named downloads).
- `node qa/offline-series.cjs` with Playwright: actual UI, real photo-to-PDF
  conversion, page ordering, invalid PDFs, retries, named teacher downloads,
  teacher return, hierarchical results, a three-year-old result staying intact,
  My Results feedback/PDF buttons, compact layouts and reduced motion.
- Local emulator on port 8188 / project `demo-offline`:
  `node qa/offline-rules.cjs` (56 real permission checks) and
  `node qa/offline-integration.cjs` (REST encoding, atomic commits, no expiry
  fields on returned results).
- `node --experimental-vm-modules qa/portal-syntax.cjs` and
  `node scripts/version-assets.cjs --check`.

Screenshots are in ignored `qa/artifacts/offline-series/`.

## Access limits

Dashboard records are protected by Firestore rules. Files use public,
unguessable Uploadcare links; anyone given a working file URL can open it.
Direct API submissions are URL-validated, while PDF parsing, page count and size
checks occur in the dashboard UI. Late submissions after the 15-minute upload
grace are accepted and flagged with the minutes late.
