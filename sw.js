/* MediGuide AI Service Worker - PWA with offline support */
const CACHE = 'mediguide-v4';
const SHELL = [
  './',
  'css/components.css',
  'css/modals.css',
  'css/style.css',
  'icons/icon.svg',
  'index.html',
  'js/app.js',
  'js/components/admin.js',
  'js/components/appointments.js',
  'js/components/auth.js',
  'js/components/chatBot.js',
  'js/components/clinicFinder.js',
  'js/components/companyList.js',
  'js/components/consent.js',
  'js/components/medicineDetail.js',
  'js/components/medicationTracker.js',
  'js/components/reminders.js',
  'js/components/scanner.js',
  'js/components/search.js',
  'js/components/settings.js',
  'js/config.js',
  'js/i18n.js',
  'js/services/backend.js',
  'js/services/gemini.js',
  'js/services/voice.js',
  'js/utils/abha.js',
  'js/utils/audit.js',
  'js/utils/helpers.js',
  'js/utils/rxParser.js',
  'js/utils/storage.js',
  'js/utils/totp.js',
  'manifest.json'
];
const CDN = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'unpkg.com'];
const DATA_CACHE = 'mediguide-data-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== DATA_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;

  if (!sameOrigin && !CDN.includes(url.hostname)) return;

  // Never cache API responses (private data)
  if (sameOrigin && url.pathname.startsWith('/api/')) {
    // But allow specific read-only endpoints for offline
    if (url.pathname.startsWith('/api/medicine/') || url.pathname === '/api/medicines/uses') {
      e.respondWith(staleWhileRevalidate(req));
    }
    return;
  }

  // Network-first for our own files, stale-while-revalidate for CDN
  e.respondWith(
    sameOrigin
      ? fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        }).catch(() => caches.match(req).then((r) => r || caches.match('index.html')))
      : caches.match(req).then((hit) => {
          const net = fetch(req).then((res) => {
            caches.open(CACHE).then((c) => c.put(req, res.clone()));
            return res;
          }).catch(() => hit);
          return hit || net;
        }),
  );
});

async function staleWhileRevalidate(request) {
  const cache = await caches.open(DATA_CACHE);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then((networkResponse) => {
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  }).catch(() => cached);
  return cached || fetchPromise;
}

// Background sync for pending actions
self.addEventListener('sync', (e) => {
  if (e.tag === 'sync-reminders' || e.tag === 'sync-schedules' || e.tag === 'sync-chat') {
    e.waitUntil(syncPendingActions(e.tag));
  }
});

async function syncPendingActions(tag) {
  // Implementation would sync pending data when back online
  console.log('Background sync triggered:', tag);
}

// Push notification handling
self.addEventListener('push', (e) => {
  if (!e.data) return;
  const data = e.data.json();
  const options = {
    body: data.body || 'Time for your medication',
    icon: 'icons/icon.svg',
    badge: 'icons/icon.svg',
    vibrate: [200, 100, 200],
    data: data.data || {},
    actions: [
      { action: 'taken', title: 'Taken' },
      { action: 'snooze', title: 'Snooze 10min' }
    ],
    requireInteraction: true
  };
  e.waitUntil(self.registration.showNotification(data.title || 'MediGuide AI', options));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  if (e.action === 'taken') {
    // Mark dose as taken via client message
    e.waitUntil(clients.matchAll({ type: 'window' }).then((clientList) => {
      clientList.forEach((client) => client.postMessage({ type: 'DOSE_TAKEN', data: e.notification.data }));
    }));
  } else if (e.action === 'snooze') {
    // Snooze for 10 minutes
    setTimeout(() => {
      self.registration.showNotification('MediGuide AI', {
        body: 'Time for your medication (snoozed)',
        icon: 'icons/icon.svg',
        tag: 'medication-reminder'
      });
    }, 10 * 60 * 1000);
  } else {
    // Default click - open app
    e.waitUntil(clients.matchAll({ type: 'window' }).then((clientList) => {
      if (clientList.length > 0) {
        return clientList[0].focus();
      }
      return clients.openWindow('/');
    }));
  }
});
