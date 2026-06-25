/* ════════════════════════════════════════════════════
 *  THE NEWTOWN CLASSES — Firebase Cloud Messaging service worker
 *  ────────────────────────────────────────────────
 *  Handles WEB PUSH notifications that arrive while the student's
 *  dashboard tab is closed or in the background. Foreground messages
 *  (tab open) are handled in student-dashboard.html via onMessage().
 *
 *  Served from the site root as /firebase-messaging-sw.js so it controls
 *  every page (Netlify publishes from "."). The Firebase config below is
 *  PUBLIC by design — same values as assets/js/firebase-config.js.
 *
 *  The server sends DATA-ONLY messages (no `notification` block) so this
 *  worker is the single place that builds the visible notification — that
 *  avoids the duplicate-notification problem you get when both the browser
 *  and onBackgroundMessage try to show one.
 * ════════════════════════════════════════════════════ */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyB-aTXaWLduMaB9lw6lxGcOWzhzKcH2B0E",
  authDomain: "the-newtown-classes-d98e8.firebaseapp.com",
  projectId: "the-newtown-classes-d98e8",
  storageBucket: "the-newtown-classes-d98e8.firebasestorage.app",
  messagingSenderId: "644697936619",
  appId: "1:644697936619:web:f8a8769cd6c51846f3e4ae"
});

const messaging = firebase.messaging();

// Background message → build and show the notification.
messaging.onBackgroundMessage(function (payload) {
  const d = (payload && payload.data) || {};
  const title = d.title || 'The NewTown Classes';
  const options = {
    body: d.body || '',
    icon: '/assets/img/logo-mark.png',
    badge: '/assets/img/logo-mark.png',
    tag: d.tag || 'ntc-notice',           // collapse repeats with the same tag
    data: { url: d.url || '/learn' }
  };
  return self.registration.showNotification(title, options);
});

// Tapping the notification focuses an open dashboard tab, or opens one.
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/learn';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (const c of list) {
        if ('focus' in c) { c.navigate && c.navigate(url); return c.focus(); }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
