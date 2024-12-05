function storeLink(link) {
    const timestamp = new Date().toISOString(); 
    browser.storage.local.get('m3u8_links').then((result) => {
        let links = result.m3u8_links || [];
        if (!links.some(item => item.link === link)) {
            // Add the new link with its timestamp to the beginning of the array
            links.unshift({ link, timestamp });
            // Keep the links size to a max of 3
            if (links.length > 3) {
                links = links.slice(-3);
            }

            browser.storage.local.set({ m3u8_links: links }).then(() => {
                console.log('Stored link:', link);
            });
        }
    }).catch((error) => {
        console.error('Error storing link:', error);
    });
}

function handleM3U8Request(details) {
    const url = details.url;
    console.log(url)
    if (url.endsWith('.m3u8')) {
        console.log('Detected .m3u8 request:', url);
        storeLink(url)
    }
}

// Add a listener for web requests
browser.webRequest.onBeforeRequest.addListener(
    handleM3U8Request,
    { urls: ["<all_urls>"] },
    []
);