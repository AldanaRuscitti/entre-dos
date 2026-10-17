/* Service worker de Entre Dos: funciona sin conexión y muestra las notificaciones. */
importScripts(
  "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js",
  "./firebase-config.js"
);
const CACHE = "entredos-v3";
const SHELL = ["./", "./index.html", "./firebase-config.js", "./inversiones-calc.js", "./manifest.webmanifest", "./icons/icon-192.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request, {cache:"no-cache"}).then(r => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); } return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match("./"))));
});
try {
  const cfg = self.FIREBASE_CONFIG;
  if (cfg && cfg.apiKey && !/^TU_/.test(cfg.apiKey)) {
    firebase.initializeApp(cfg);
    firebase.messaging().onBackgroundMessage(p => {
      const d = p.data || {};
      return self.registration.showNotification(d.title || "Entre Dos", {body:d.body || "", icon:"icons/icon-192.png", badge:"icons/badge-72.png", tag:d.tag || undefined, data:{url:d.url || "./"}});
    });
  }
} catch (e) {}
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil(clients.matchAll({type:"window", includeUncontrolled:true}).then(ws => { for (const w of ws) if ("focus" in w) return w.focus(); return clients.openWindow(url); }));
});
