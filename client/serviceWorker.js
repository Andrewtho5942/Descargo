
console.log('TEST TEST TEST');

self.addEventListener('install', (event) => {
    console.log('Service Worker Installed');
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    console.log('Service Worker handling fetch for:', event.request.url);

    // Check if the request URL ends with .m3u8 (m3u8 playlist)
    if (url.pathname.endsWith('.m3u8')) {
        console.log('Detected .m3u8 file request:', event.request.url);
    }

    event.respondWith(fetch(event.request));
});