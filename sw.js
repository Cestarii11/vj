/* V&J — service worker básico.
 * - Guarda la "carcasa" de la app para que abra rápido y también sin conexión.
 * - Solo gestiona archivos del propio sitio y las tipografías de Google Fonts.
 *   Todo lo demás (Firebase, Gemini, etc.) pasa directo a la red y NUNCA se guarda aquí.
 * - Cuando cambies cualquier archivo de la app, sube el número de VERSION
 *   (vj-v2, vj-v3…) para que los teléfonos descarguen la versión nueva.
 */
const VERSION = 'vj-v1';
const SHELL = [
    './',
    './index.html',
    './manifest.json',
    './img/logo.jpg',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/apple-touch-icon.png'
];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)));
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    const sameOrigin = url.origin === self.location.origin;
    if (!sameOrigin && !FONT_HOSTS.includes(url.hostname)) return; // red directa

    // Stale-while-revalidate: responde con lo guardado y actualiza en segundo plano.
    event.respondWith(
        caches.open(VERSION).then(async (cache) => {
            const cached = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
            const network = fetch(req)
                .then((res) => {
                    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
                    return res;
                })
                .catch(() => null);
            if (cached) return cached;
            const res = await network;
            if (res) return res;
            if (req.mode === 'navigate') return cache.match('./index.html');
            return Response.error();
        })
    );
});