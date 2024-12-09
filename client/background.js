

const SERVER_PORT = 5001;

function storeLink(link, title) {
    const timestamp = new Date().toISOString();
    browser.storage.local.get('m3u8_links').then((result) => {
        let links = result.m3u8_links || [];
        if (!links.some(item => item.link === link)) {
            // Add the new link with its timestamp to the beginning of the array
            links.unshift({ link, timestamp, title });
            // Keep the links size to a max of 3
            if (links.length > 3) {
                links = links.slice(0, 3);
            }

            browser.storage.local.set({ m3u8_links: links }).then(() => {
                console.log('Stored link for', title);
            });
        }
    }).catch((error) => {
        console.error('Error storing link:', error);
    });
}

function truncateString(str, len) {
    return str.length > len ? str.slice(0, len - 3) + '...' : str;
}

function handleM3U8Request(details) {
    const url = details.url;

    if (url.endsWith('.m3u8')) {
        const sourceURL = details.frameAncestors[0].url
        const currentYear = new Date().getFullYear().toString();
        const year_regex = new RegExp(`\\b${currentYear}\\b`, 'g');
        console.log('sourceURL: ' + sourceURL)

        //get and process the source URL into just the title
        const title = sourceURL.slice(sourceURL.lastIndexOf('/') + 1).replace(/-\d+(\.\d+)?$/, '')
            .replace(/(watch|free)/g, '').replace(year_regex, '').replace(/^-+|-+$/g, '');

        storeLink(url, title)
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
    //set disconnect to false if its true in storage
    browser.storage.local.get('disconnect').then((result) => {
        if (result.disconnect) {
            browser.storage.local.set({ disconnect: false }).then(() => {
                console.log('reconnected to server')
            });
        }
    });


    const data = JSON.parse(event.data);

    if (data.progress) {
        console.log('progress update: ' + data.progress)
        let newStatus = data.status;

        if (data.progress == 100) {
            console.log('download finished!');
            if ((data.status === 'completed') && data.file.endsWith('.m3u8')) {
                browser.notifications.create({
                    type: 'basic',
                    iconUrl: 'icons/icon-48.png',
                    title: 'YT-Downloader: Finished',
                    message: `Video Download of ${truncateString(data.title, 30)} Finished!`
                }).then(() => {
                    console.log('notification created successfully.')
                }).catch((e) => {
                    console.log('ERROR in notification: ' + e.message)
                });
            }

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
                        return { ...item, progress: data.progress, status: newStatus, title: data.title };
                    }
                    return { ...item };
                });

                browser.storage.local.set({ history: updatedHistory }).then(() => {
                    //console.log('set new history to storage.');
                }).catch((e) => {
                    console.log('error setting progress update to storage: ' + e);
                });
                browser.storage.local.set({ historyUpdater: Date.now() }).then(() => {
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
    //set disconnect to true if its false in storage
    browser.storage.local.get('disconnect').then((result) => {
        if (!result.disconnect) {
            browser.storage.local.set({ disconnect: true }).then(() => {
                console.log('disconnected from server')
            });
        }
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
            browser.storage.local.set({ historyUpdater: Date.now() }).then(() => {
                //console.log('set new history to storage.');
            });
        }
    });
};

