
const SERVER_PORT = 5001;
let disconnected = true;
browser.storage.local.set({ disconnect: true });


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





function sendNotification(result, data, title, message) {
    if ((result.settings.find(s => s.key === 'm3u8Notifs').value && data.file.endsWith('.m3u8')) ||
        (result.settings.find(s => s.key === 'm4aNotifs').value && data.fileName.endsWith('.m4a')) ||
        (result.settings.find(s => s.key === 'mp4Notifs').value && (data.fileName.endsWith('.mp4') && !data.file.endsWith('.m3u8')))) {
        browser.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon-48.png',
            title: title,
            message: message
        }).then(() => {
            console.log('notification created successfully.')
        }).catch((e) => {
            console.log('ERROR in notification: ' + e.message)
        });
    }
}


console.log('opening sse connection...')
// Start the SSE connection
const eventSource = new EventSource(`http://localhost:${SERVER_PORT}/progress`);

const storageUpdateQueue = [];
let isProcessingQueue = false;

function enqueueStorageUpdate(updateFunc) {
    storageUpdateQueue.push(updateFunc);
    processStorageQueue();
}

function processStorageQueue() {
    if (isProcessingQueue || storageUpdateQueue.length === 0) return;

    isProcessingQueue = true;
    const updateFunc = storageUpdateQueue.shift();

    updateFunc().finally(() => {
        isProcessingQueue = false;
        processStorageQueue();
    });
}


eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);

    //set disconnect to false if its true in storage
    if (disconnected) {
        browser.storage.local.set({ disconnect: false }).then(() => {
            console.log('reconnected to server')
        });
        disconnected = false;
    }


    if ((data.progress !== null) && (data.progress !== undefined)) {
        let newStatus = data.status;

        if ((data.progress === 100) && (data.status === 'completed')) {
            console.log('DEBUG -_-_-_-_ RECEIVED COMPLETION BROADCAST: ' + data.fileName);
            browser.storage.local.get('settings').then((result) => {
                sendNotification(result, data, '✓ Descargo Finished', `Finished Downloading ${truncateString(data.fileName, 30)}`);
            });
            newStatus = 'completed';
        }

        if (data.status === 'error') {
            console.error('An error occurred during download');
            browser.storage.local.get('settings').then((result) => {
                if (result.settings.find(s => s.key === 'failureNotifs').value) {
                    sendNotification(result, data, '✘ Descargo Failed', `Failed Downloading ${truncateString(data.fileName, 30)}`);
                }
            });
            newStatus = 'error';
        }

        // Enqueue the history update
        enqueueStorageUpdate(async () => {
            const result = await browser.storage.local.get('history');
            let updatedHistory = result.history ? [...result.history] : [];

            // Update or add the item in history
            const index = updatedHistory.findIndex(item => item.timestamp === data.timestamp);
            if (index !== -1) {
                updatedHistory[index] = { ...updatedHistory[index], progress: data.progress, status: newStatus, fileName: data.fileName };
            } else if (newStatus !== 'error') {
                updatedHistory.unshift({
                    timestamp: data.timestamp,
                    progress: data.progress || 0,
                    status: newStatus,
                    fileName: data.fileName || 'unknown',
                    file: data.file || 'unknown'
                });
            }

            if (updatedHistory.length > 25) {
                updatedHistory = updatedHistory.slice(0, 25);
            }

            // Save the updated history back to storage
            await browser.storage.local.set({ history: updatedHistory });

            browser.storage.local.set({ historyUpdater: Date.now() })
            console.log('Updated history in storage.');
        });

    } else if (data.status === 'playlist-completed') {
        console.log('A playlist finished downloading!');

        // create the playlist notification if its on
        browser.storage.local.get('settings').then((result) => {
            if (result.settings.find(s => s.key === 'playlistNotifs').value) {
                browser.notifications.create({
                    type: 'basic',
                    iconUrl: 'icons/icon-48.png',
                    title: '✓ Descargo Finished',
                    message: `Finished Downloading Playlist: ${truncateString(data.playlistName, 30)} !`
                }).then(() => {
                    console.log('notification created successfully.')
                }).catch((e) => {
                    console.log('ERROR in notification: ' + e.message)
                });
            }
        });
    }
};




eventSource.onerror = (err) => {
    console.error('EventSource failed:', err);

    //set disconnect to true if its false in storage
    if (!disconnected) {
        browser.storage.local.set({ disconnect: true }).then(() => {
            console.log('disconnected from server')
        });
        disconnected = true;
    }

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

