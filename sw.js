/* Offline support for static data (NFR-6.3). Never caches API calls: Gemini requests are cross-origin POSTs and are ignored. */
const CACHE = 'mediguide-v3';
const SHELL = ['./', 'css/components.css', 'css/modals.css', 'css/style.css', 'icons/icon.svg', 'index.html', 'js/app.js', 'js/components/admin.js', 'js/components/appointments.js', 'js/components/auth.js', 'js/components/chatBot.js', 'js/components/companyList.js', 'js/components/consent.js', 'js/components/medicineDetail.js', 'js/components/reminders.js', 'js/components/scanner.js', 'js/components/search.js', 'js/components/settings.js', 'js/config.js', 'js/i18n.js', 'js/services/backend.js', 'js/services/gemini.js', 'js/services/voice.js', 'js/utils/abha.js', 'js/utils/audit.js', 'js/utils/helpers.js', 'js/utils/rxParser.js', 'js/utils/storage.js', 'js/utils/totp.js', 'manifest.json'];
const CDN = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;
  if (!sameOrigin && !CDN.includes(url.hostname)) return;
  if (sameOrigin && url.pathname.startsWith('/api/')) return;          // never cache API responses (private data)
  // network-first for our own files (fresh when online), stale-while-revalidate for CDN icons/fonts
  e.respondWith(
    sameOrigin
      ? fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; }).catch(() => caches.match(req).then((r) => r || caches.match('index.html')))
      : caches.match(req).then((hit) => {
        const net = fetch(req).then((res) => { caches.open(CACHE).then((c) => c.put(req, res.clone())); return res; }).catch(() => hit);
        return hit || net;
      }),
  );
});
