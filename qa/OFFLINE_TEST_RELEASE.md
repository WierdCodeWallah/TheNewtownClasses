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
