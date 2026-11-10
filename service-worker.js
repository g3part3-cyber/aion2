const CACHE_NAME = "aion2-shell-v7";
const APP_SHELL = [
    "./",
    "./index.html",
    "./manifest.webmanifest",
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

    const url = new URL(event.request.url);

    // 1. schedule.json 은 수시로 갱신되는 동적 데이터이므로 Network First (네트워크 우선, 오프라인 시 캐시)
    if (url.pathname.endsWith("/schedule.json")) {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    if (response && response.ok) {
                        const copy = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
                    }
                    return response;
                })
                .catch(() => caches.match(event.request))
        );
        return;
    }

    // 2. HTML 문서/네비게이션 요청은 최신 배포 반영을 위해 Network First
    if (event.request.mode === "navigate" || url.pathname.endsWith("/index.html") || url.pathname.endsWith("/")) {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    if (response && response.ok) {
                        const copy = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
                    }
                    return response;
                })
                .catch(() => caches.match("./index.html"))
        );
        return;
    }

    // 3. 정적 에셋(이미지, 아이콘 등)은 Cache First
    event.respondWith(
        caches.match(event.request).then((cached) => cached || fetch(event.request)
            .then((response) => {
                if (!response || !response.ok || url.origin !== self.location.origin) {
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
