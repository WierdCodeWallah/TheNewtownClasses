# Zoom Auto-Create Setup — The NewTown Classes

Your teacher dashboard now auto-creates a Zoom meeting whenever a teacher clicks **Create Class**. The Zoom credentials live on the server (Netlify Function) — never in the browser. Follow this one-time setup to go live.

---

## Prerequisites

- A **Zoom Pro (or higher) paid account** — Server-to-Server OAuth is not available on Free plans.
- Owner/Admin access to your Netlify site (the one that hosts `thenewtownclasses`).
- The Firebase project ID you already use for Firestore.

---

## Step 1 — Create a Zoom Server-to-Server OAuth app

1. Go to **https://marketplace.zoom.us/** and sign in with the Zoom Pro owner account that will host the classes.
2. Top-right → **Develop → Build App**.
3. Choose **Server-to-Server OAuth** → click **Create**.
4. Give it a name like *NewTown Classes Backend* → **Create**.
5. On the **App Credentials** tab you will see three values — keep this tab open, you'll need them in Step 2:
   - **Account ID**
   - **Client ID**
   - **Client Secret**
6. Go to **Information** tab → fill in Company Name, Short description, Contact (required by Zoom, not shown anywhere public).
7. Go to **Scopes** tab → **Add Scopes**. Zoom now uses **granular scopes** — add these three (if you see Classic/Granular tabs, pick **Granular**):
   - `meeting:write:meeting:admin`                   (create/update meetings)
   - `user:read:user:admin`                          (read `/users/me`)
   - `cloud_recording:read:list_recording_files:admin`  (read recordings — needed for the **📼 Get Recording** button)
8. Go to **Activation** tab → **Activate your app**. The panel should turn green.

> Note: Zoom has several similarly-named recording scopes. The specific one our `fetch-zoom-recording` function calls (`/v2/meetings/{id}/recordings`) requires `list_recording_files:admin`, not the more general `recording:admin`. If you only added `recording:admin`, Zoom will return a 400 error like *"does not contain scopes:[cloud_recording:read:list_recording_files…]"*.

> If you ever change scopes or rotate the Client Secret, update Netlify **and** Deactivate → Activate the app again so the new scopes take effect.

---

## Step 2 — Add environment variables in Netlify

1. Open **app.netlify.com** → your site → **Site settings → Environment variables**.
2. Add or verify each of these five keys. Click **Add a variable** for each.

| Variable | Value | Where to find it |
|---|---|---|
| `ZOOM_ACCOUNT_ID` | (from Step 1) | Zoom Marketplace → App → App Credentials |
| `ZOOM_CLIENT_ID` | (from Step 1) | Zoom Marketplace → App → App Credentials |
| `ZOOM_CLIENT_SECRET` | (from Step 1) | Zoom Marketplace → App → App Credentials |
| `FIREBASE_API_KEY` | `AIzaSyB-aTXaWLduMaB9lw6lxGcOWzhzKcH2B0E` | Same key used in `firebase-config.js` (already set — keep as-is) |
| `FIREBASE_PROJECT_ID` | Your Firebase project ID | Firebase console → Project settings → General → Project ID |

3. **Important:** Set `ZOOM_CLIENT_SECRET` as a **secret** (Netlify will then mask it in the UI and build logs).

---

## Step 3 — Deploy

1. Commit and push the new files:
   - `netlify/functions/create-zoom-meeting.js`
   - updated `teacher-dashboard.html`, `student-dashboard.html`, `live-classes.js`
2. Netlify will build automatically. Once the deploy finishes, open **Site overview → Functions** and confirm `create-zoom-meeting` is listed.

If you prefer to redeploy manually: **Deploys → Trigger deploy → Clear cache and deploy site**.

---

## Step 4 — Smoke test

1. Log in as a teacher on the live site.
2. Open **Live Classes → Create a New Online Class**.
3. Fill in *Class Name*, *Subject*, *Grade*, a date/time a few minutes in the future, and duration.
4. Click **📅 Create Class**.
5. You should see:
   - `🎥 Creating Zoom meeting…`
   - `💾 Saving class…`
   - `✅ Class created for …`
6. The new class card shows a **Meeting ID**, **Passcode**, and (within 5 min of start time) a green **▶ Join Class** button.
7. Log in as a Class-X student → the same class appears with its own **▶ Join Class** button enabled 5 minutes before start.

---

## How it works (for your records)

1. Teacher submits the form in `teacher-dashboard.html`.
2. Browser calls `/.netlify/functions/create-zoom-meeting` with the teacher's Firebase ID token + class details.
3. The Function (`netlify/functions/create-zoom-meeting.js`):
   - Verifies the ID token via `identitytoolkit.googleapis.com`.
   - Confirms the user exists in `teachers/{uid}` or `admins/{uid}` in Firestore (respects your security rules).
   - Exchanges `ZOOM_CLIENT_ID:ZOOM_CLIENT_SECRET` + `ZOOM_ACCOUNT_ID` for a short-lived Zoom access token.
   - Creates a scheduled meeting at `/v2/users/me/meetings` with waiting room on, host video on, participant video off, auto-password enabled, timezone `Asia/Kolkata`.
   - Returns `{ joinUrl, meetingId, passcode, startUrl }`.
4. The browser stores `zoomJoinUrl`, `zoomMeetingId`, `zoomPasscode` against the class in Firestore.
5. When a teacher or student clicks **Join Class**, their browser opens the Zoom `joinUrl` directly. On Android/iOS/macOS/Windows the OS deep-links into the Zoom app automatically; in a plain browser Zoom offers "Open Zoom App" or "Join from browser".

---

## Common errors & fixes

| Error shown | What to do |
|---|---|
| *Server is missing env vars: ZOOM_ACCOUNT_ID, …* | Re-check Step 2, then redeploy. |
| *Zoom OAuth failed (400): invalid_client* | Client ID or Secret is wrong, or the Zoom app isn't Activated yet (Step 1.8). |
| *Zoom OAuth failed (400): unsupported_grant_type* | The Account ID is missing or wrong. |
| *Zoom create meeting failed (401)* | The scopes are missing or the token didn't include them. Add `meeting:write:admin` + `user:read:admin`, save, and **re-activate** the app. |
| *Only teachers or admins can create a Zoom class* | The signed-in user isn't in Firestore `teachers/{uid}` or `admins/{uid}`. Add them via your admin panel. |
| *you can paste a manual Zoom link in Advanced* | Auto-create failed — the teacher can still open the **Advanced (manual link)** section on the form and paste any Zoom URL as a fallback. |

---

## Fallback: manual link (always available)

Even after the auto-create is live, the form still has an **Advanced (manual link)** collapsible section. If Zoom is down or a teacher wants to use a different account's Personal Meeting Room, they can paste any Zoom URL + passcode there and skip the API call. This keeps you unblocked no matter what.

---

## 📼 Class Recordings — turning on Cloud Recording

The site now records every Zoom class to **Zoom Cloud** automatically and exposes it back to eligible students under **Recorded Classes** in their dashboard. There's a one-time toggle to enable, then it just works.

### A. Turn on Cloud Recording in your Zoom account

1. Sign in at **https://zoom.us** with the **same Pro+ account** that the Server-to-Server OAuth app belongs to.
2. Left menu → **Admin → Account Management → Account Settings → Recording** (if you're a single user, just **Settings → Recording**).
3. Toggle **Cloud recording** to **ON**.
4. Recommended sub-options to tick:
   - **Record active speaker, gallery view and shared screen separately** → tick *Active speaker* + *Shared screen with speaker view*.
   - **Record an audio-only file** → optional, useful for slow networks.
   - **Save chat messages from the meeting** → useful for revision.
   - **Require passcode to access shared cloud recordings** → ON. The site captures the passcode and shows it next to the Watch button.
   - **Allow cloud recording sharing** → ON.
5. (Optional but useful) **Auto-delete cloud recordings after** → 90 or 180 days, depending on your storage plan. The site stores the URL, so even after Zoom deletes the file the link will simply 404 — at that point your teacher can re-upload to YouTube/Drive and use the **Paste link manually** fallback.

### B. Add the recording scope to your Server-to-Server OAuth app

1. Zoom Marketplace → your *NewTown Classes Backend* app → **Scopes** tab → **+ Add Scopes**.
2. Add `cloud_recording:read:recording:admin`.
3. **Activation** tab → **Deactivate** then **Activate** so the new scope takes effect.

### C. Deploy the new function

The folder `netlify/functions/fetch-zoom-recording.js` is added in this update. After deploying, **Site overview → Functions** should list both:
- `create-zoom-meeting`
- `fetch-zoom-recording`

No new env vars are needed — it reuses the same five from Step 2.

### D. Daily workflow for teachers

1. Schedule a class as usual — the meeting is created with `auto_recording: 'cloud'`, so Zoom records automatically the moment the class begins.
2. After the class ends, Zoom processes the recording in the background (typically 5–30 min, longer for long sessions).
3. Open **Teacher Dashboard → Live Classes**. The ended class now shows a blue **📼 Get cloud recording** button.
4. Click it — the site asks Zoom for the play URL and saves it on the class. If processing isn't done yet you'll see *"Recording is still processing — try again in a few minutes."*
5. Eligible students will see a new **📼 Recorded Classes** entry in their dashboard with a **▶ Watch Recording** button.

### E. Manual fallback (works on free Zoom too)

If Zoom Cloud isn't available, or the teacher recorded locally instead, both teacher and admin dashboards expose a **+ Paste link manually** button. Acceptable URLs:
- Zoom Cloud share link (`https://*.zoom.us/rec/share/...`)
- YouTube unlisted link
- Google Drive shareable link
- Any direct video file URL

The student dashboard will show a friendly source badge (Zoom Cloud / YouTube / Google Drive / Recording) automatically.

### F. Who can see what (eligibility)

A recording is shown in a student's dashboard only if **all** of these match — exactly the same rules used for live classes:

| Field on the class | Field on the student | Must |
|---|---|---|
| `classGrade` | `class` | Match |
| `classType` (`regular`/`foundation`/`jee`/`neet`) | `enrollmentType` | Be visible per `content-access.js` (e.g. JEE student sees `regular` + `jee`) |
| `targetBoard` (CBSE/ICSE) | `board` | Match if set, otherwise no restriction |
| `targetSubject` (Physics/Chemistry/…) | `subjects` | Match if set, otherwise falls back to the class's own `subject` |

So a Class 10 ICSE Physics Foundation student will only see recordings of Class 10 Foundation/Regular Physics classes for ICSE.

---

That's the whole setup. The code is already deployed-ready — you just need the five env vars in Netlify, an activated Zoom Server-to-Server OAuth app with the three scopes above, and Cloud Recording toggled on in your Zoom account.
