const CACHE_NAME = "aion2-shell-v3";
const APP_SHELL = [
    "./",
    "./index.html",
    "./schedule.json",
    "./manifest.webmanifest",
    "./service-worker.js",
    "./icons/app-icon.svg",
    "./icons/app-icon-180.png",
    "./icons/app-icon-192.png",
    "./icons/app-icon-512.png",
    "./bg_ludra.png",
    "./bg_main.png",
    "./bg_muspell.png",
    "./bg_abyss.png",
    "./bg_today.png",
];

self.addEventListener("install", (event) => {
    event.waitUntil(caches.open(CACHE_NAME).then(async (cache) => {
        await Promise.all(APP_SHELL.map(async (url) => {
            try {
                await cache.add(url);
            } catch (error) {
                console.warn(`오프라인 캐시 추가 실패: ${url}`, error);
            }
        }));
    }));
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) => Promise.all(
            keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        ))
    );
    self.clients.claim();
});

self.addEventListener("fetch", (event) => {
    if (event.request.method !== "GET") return;

    event.respondWith(
        caches.match(event.request).then((cached) => cached || fetch(event.request)
            .then((response) => {
                if (!response || !response.ok || new URL(event.request.url).origin !== self.location.origin) {
                    return response;
                }
                const copy = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
                return response;
            })
            .catch(() => caches.match("./index.html")))
    );
});

self.addEventListener("push", (event) => {
    const payload = event.data ? event.data.json() : {};
    event.waitUntil(self.registration.showNotification(payload.title || "성역 관리", {
        body: payload.body || "",
        tag: payload.tag,
        icon: "./icons/app-icon-180.png",
        badge: "./icons/app-icon-180.png",
        data: { url: payload.url || "./" },
        renotify: false,
    }));
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const targetUrl = new URL(event.notification.data?.url || "./", self.registration.scope).href;
    event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
        const client = clients.find((candidate) => candidate.url === targetUrl);
        return client ? client.focus() : self.clients.openWindow(targetUrl);
    }));
});
