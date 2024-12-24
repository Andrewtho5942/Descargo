
const SERVER_PORT = 5001;
const cloudServerURL = 'https://red-jellyfish-66.telebit.io'
let serverURL = `http://localhost:${SERVER_PORT}`
let eventSource = null;

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

let nonRepeatFlag = false;
function handleM3U8Request(details) {
    if (nonRepeatFlag) {
        nonRepeatFlag = false;
        return;
    }
    const url = details.url;
    if (url.endsWith('.m3u8')) {
        nonRepeatFlag = true;
        fetch(url).then((response) => response.text()).then((content) => {
            // Check if the content has #EXT-X-STREAM-INF to identify it as a playlist
            if (content.includes('#EXT-X-STREAM-INF')) {
                const sourceURL = details.frameAncestors[0].url
                const currentYear = new Date().getFullYear().toString();
                const year_regex = new RegExp(`\\b${currentYear}\\b`, 'g');
                console.log('sourceURL: ' + sourceURL)

                //get and process the source URL into just the title
                const title = sourceURL.slice(sourceURL.lastIndexOf('/') + 1).replace(/-\d+(\.\d+)?$/, '')
                    .replace(/(watch|free)/g, '').replace(year_regex, '').replace(/^-+|-+$/g, '');

                storeLink(url, title)
            } else {
                console.log('ignoring non-playlist m3u8 file')
            }

        }).catch((e) => {
            console.log('error fetching .m3u8 file: ' + e.message)
        });
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

function handleEventSourceError() {
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
}

function handleProgressUpdate(data) {
    let newStatus = data.status;

    if ((data.progress === 100) && (data.status === 'completed')) {
        console.log('DEBUG -_-_-_-_ RECEIVED COMPLETION BROADCAST: ' + data.fileName);
        browser.storage.local.get('settings').then((result) => {
            sendNotification(result, data, '✓ Descargo Finished', `Finished Downloading ${truncateString(data.fileName, 30)}  |  time: ${data.timeSpent}`);
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

        console.log('got data:');
        console.log(data)

        if (index !== -1) {
            updatedHistory[index] = { ...updatedHistory[index], progress: data.progress, status: newStatus, fileName: data.fileName, task: data.task || 'none' };
        } else if (newStatus !== 'error') {
            updatedHistory.unshift({
                timestamp: data.timestamp,
                progress: data.progress || 0,
                status: newStatus,
                fileName: data.fileName || 'unknown',
                file: data.file || 'unknown',
                task: data.task || 'none'
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

}

function handlePlaylistCompleted(data) {
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

function createEventSource() {

    if (eventSource) {
        eventSource.close();
    }
    console.log('opening sse connection...')
    // Start the SSE connection
    eventSource = new EventSource(serverURL + `/progress`);

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
            handleProgressUpdate(data);
        } else if (data.status === 'playlist-completed') {
            handlePlaylistCompleted(data);
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

        handleEventSourceError();

        //close the current connection and retry after 5 seconds

        eventSource.close()
        eventSource = null;
        setTimeout(() => {
            console.log("### service worker: attempting to reconnect to server");
            createEventSource();
        }, 5000);
    };

}

//initial connection to server
browser.storage.local.get('settings').then((result) => {
    console.log('got initial settings:')
    console.log(result)
    if (result.settings) {
        let cloudMode = result.settings.find(s => s.key === 'cloudMode').value;
        if (cloudMode !== null) {
            serverURL = cloudMode ? cloudServerURL : `http://localhost:${SERVER_PORT}`;
        } else {
            serverURL = `http://localhost:${SERVER_PORT}`;
        }
    } else {
        serverURL = `http://localhost:${SERVER_PORT}`;
    }
    createEventSource();
});

// listen for storage changes and re-create the eventSource if needed
browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) {

        let newSettings = changes.settings.newValue
        console.log('new settings: ')
        console.log(newSettings)

        let cloudMode = newSettings.find(s => s.key === 'cloudMode').value;

        // detect changes in cloudMode setting
        if ((cloudMode !== null) &&
            ((cloudMode && serverURL.startsWith('http://localhost')) ||
                (!cloudMode && (serverURL === cloudServerURL)))) {
            console.log('cloudMode changed to ', cloudMode);
            serverURL = cloudMode ? cloudServerURL : `http://localhost:${SERVER_PORT}`;
        }

        // Recreate the EventSource with the new serverURL
        createEventSource();
    }
});




// ---- communication with the content script ------

const defaultSettings = [
    { key: "AHKPath", value: '' },
    { key: "focusExplorerPath", value: '' },
    { key: "darkMode", value: true },
    { key: "cloudMode", value: false },

    { key: "m3u8Notifs", value: true },
    { key: "mp4Notifs", value: false },
    { key: "m4aNotifs", value: false },
    { key: "failureNotifs", value: false },
    { key: "playlistNotifs", value: true },

    { key: "outputPath", value: '' },
    { key: "removeSubtext", value: true },
    { key: "normalizeAudio", value: false },
    { key: "useShazam", value: false },
    { key: "generateSubs", value: false },
    { key: "useAria2c", value: false },
    { key: "maxDownloads", value: '10' },

    { key: "gdriveJSONKey", value: '' },
    { key: "gdriveFolderID", value: '' },
    { key: "cookiePath", value: "" },

    { key: "submitHotkey", value: 'Enter' },
    { key: "formatHotkey", value: 'p' },
    { key: "gdriveHotkey", value: 'g' },
    { key: "getMenuHotkey", value: 'n' },
    { key: "historyMenuHotkey", value: 'm' },
    { key: "openClearHotkey", value: 'o' },
    { key: "backHotkey", value: 'Backspace' },
    { key: "autofillHotkey", value: 'f' },
    { key: "settingsHotkey", value: 's' },
]

const addToHistory = (file, fileName, progress, timestamp, status, task) => {
    console.log('adding to history from content script...')
    chrome.storage.local.get('history', (result) => {

        let newHistory = result.history;
        newHistory.unshift({ file, fileName, progress, timestamp, status, task })

        if (newHistory.length > 25) {
            newHistory = newHistory.slice(0, 25);
        }

        browser.storage.local.set({ history: newHistory }).then(() => {
            console.log('Stored history:', newHistory[0]);
        });
    });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'downloadVideo') {
        const { currentLink } = message.payload;

        // Fetch settings from local storage or any source
        chrome.storage.local.get('settings', (result) => {
            chrome.storage.local.get('popupSettings', (result2) => {

                let settings = result.settings || defaultSettings;
                let popupSettings = result2.popupSettings || [false, true, ''];
                let timestamp = Date.now();

                let dlArgs = {
                    timestamp: timestamp,
                    format: popupSettings[0] ? 'mp4' : 'm4a',
                    gdrive: popupSettings[1],
                    outputPath: settings.find(s => s.key === 'outputPath').value,
                    gdriveKeyPath: settings.find(s => s.key === 'gdriveJSONKey').value,
                    gdriveFolderID: settings.find(s => s.key === 'gdriveFolderID').value,
                    removeSubtext: settings.find(s => s.key === 'removeSubtext').value,
                    normalizeAudio: settings.find(s => s.key === 'normalizeAudio').value,
                    useShazam: settings.find(s => s.key === 'useShazam').value,
                    cookiePath: settings.find(s => s.key === 'cookiePath').value,
                    maxDownloads: settings.find(s => s.key === 'maxDownloads').value,
                    generateSubs: settings.find(s => s.key === 'generateSubs').value,
                    m3u8Title: '',
                    useAria2c: false
                }

                addToHistory(currentLink, 'fetching... ', 0, timestamp, 'in-progress', 'Downloading...');

                // Make the axios request to the server
                axios.post(`${serverURL}/download`, {
                    ...dlArgs,
                    url: currentLink,
                }).then((response) => {
                    console.log('Download started:', response.data);
                    sendResponse({ success: true });
                }).catch((error) => {
                    console.error('Error starting download:', error.message);
                    sendResponse({ success: false, error: error.message });
                });
            });
        });

        // Return true to keep the message channel open for asynchronous response
        return true;
    }
});


