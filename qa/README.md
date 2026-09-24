# Portal checks

Run from the repository root:

```text
node --experimental-vm-modules qa/portal-syntax.cjs
node qa/portal-smoke.cjs
```

The browser check requires Playwright on Node's module path and an installed
Chrome browser. Set `PORTAL_BROWSER=edge` to use Edge instead. No npm dependencies
or build step are added to the website.

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

Optional `module` metadata is added to materials/tests and `chapter`/`module` to
live classes. Existing records remain accessible under General / full syllabus
or General; no data migration is required. Netlify now rewrites the three clean
portal routes directly to their HTML instead of loading a second HTML document.
