const SERVER_PORT = 5001;

function storeLink(link) {
    const timestamp = new Date().toISOString();
    browser.storage.local.get('m3u8_links').then((result) => {
        let links = result.m3u8_links || [];
        if (!links.some(item => item.link === link)) {
            // Add the new link with its timestamp to the beginning of the array
            links.unshift({ link, timestamp });
            // Keep the links size to a max of 3
            if (links.length > 3) {
                links = links.slice(0, 3);
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


console.log('opening sse connection...')
// Start the SSE connection
const eventSource = new EventSource(`http://localhost:${SERVER_PORT}/progress`);


eventSource.onmessage = (event) => {
    console.log('RECEIVED MESSAGE')
    //set disconnect to true
    browser.storage.local.set({ disconnect: false }).then(() => {
        console.log('set disconnect to false in local storage')
    });

    const data = JSON.parse(event.data);

    if (data.progress) {
        console.log('progress update: ' + data.progress)
        let newStatus = data.status;

        if (data.progress == 100) {
            console.log('download finished!');
            newStatus = 'completed';
        }

        if (data.status === 'error') {
            console.error('An error occurred during download');
            newStatus = 'error';
        }

        browser.storage.local.get('history').then((result) => {
            if (result.history) {
                const updatedHistory = result.history.map(item => {
                    if (item.timestamp === data.timestamp) {
                        return { ...item, progress: data.progress, status: newStatus };
                    }
                    return item;
                });

                browser.storage.local.set({ history: updatedHistory }).then(() => {
                    //console.log('set new history to storage.');
                });
            } else {
                console.log('err: no history')
            }

        });
    };

}

eventSource.onerror = (err) => {
    console.error('EventSource failed:', err);
    //set disconnect to true
    browser.storage.local.set({ disconnect: true }).then(() => {
        console.log('set disconnect to true in local storage')
    });


    // set all of the status in-progress downloads to error
    browser.storage.local.get('history').then((result) => {
        if (result.history) {
            const updatedHistory = result.history.map(item => {
                if (item.status === 'in-progress') {
                    return { ...item, progress: 0, status: 'error' };
                }
                return item;
            });
            browser.storage.local.set({ history: updatedHistory }).then(() => {
                //console.log('set new history to storage.');
            });
        }
    });
};

