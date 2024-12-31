
const SERVER_PORT = 5001;
const cloudServerURL = "https://descargo-tunnel.andrewtho5942.xyz";//"https://red-jellyfish-66.telebit.io";
let serverURL = `http://localhost:${SERVER_PORT}`
let eventSource = null;

const activeIconPath = './src/images/dl_icon_active.png'
const iconPath = './src/images/dl.png'
let activeIconShowing = false;
browser.storage.local.set({ activeIconShowing: false });


let disconnected = true;
browser.storage.local.set({ disconnect: true });


// download with requests from popup
browser.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    return new Promise((resolve, reject) => {
        if (message.type === 'DOWNLOAD_VIDEO') {
            console.log('got download video request from popup');

            const { payload } = message;
            console.log('payload: ', payload)
            // Post to /download on the server
            axios.post(`${payload.serverURL}/download`, {
                ...payload
            }, { responseType: 'blob' }).then(async (result) => {
                console.log('received server response: ', result);

                const blob = result.data;
                if ((blob.type === 'video/mp4')) {
                    const blobUrl = URL.createObjectURL(blob);
                    console.log('blobURL: ' + blobUrl)

                    // extract the filename from the response
                    let fileName = 'untitled.mp4';
                    const contentDisposition = result.headers['content-disposition'];
                    if (contentDisposition) {
                        const matches = /filename="([^"]+)"/.exec(contentDisposition);
                        if (matches && matches[1]) {
                            fileName = matches[1];
                        }
                    }
                    try {
                        await browser.downloads.download({
                            url: blobUrl,
                            filename: fileName
                        });
                        resolve({ message: 'success' })
                    } catch (error) {
                        console.error('Failed to start download:', error);
                        resolve({ message: 'failure' })
                    }
                } else if (blob.type === 'application/json') {
                    const text = await blob.text();
                    const json = JSON.parse(text);
                    console.log('response json:');
                    console.log(json);
                    resolve({ message: json.message })
                } else {
                    console.log('ERR: unknown blob type: ' + blob.type);
                    resolve({ message: 'success' });
                }
            }).catch((err) => {
                console.error('Service worker DOWNLOAD_VIDEO error:', err);
                resolve({ message: 'failure' });
            });

        }

        if (message.type === 'DOWNLOAD_PLAYLIST') {
            console.log('got download playlist request from popup');

            const { payload } = message;
            // Post to /playlist on the server
            axios.post(`${payload.serverURL}/playlist`, {
                ...payload
            }, { responseType: 'blob' }).then(async (result) => {
                console.log('playlist finished: ', result)
                const blob = result.data;

                if ((blob.type === 'application/zip')) {
                    const blobUrl = URL.createObjectURL(blob);
                    console.log('blobURL: ' + blobUrl)

                    // extract the filename from the response
                    let fileName = 'untitled.mp4';
                    const contentDisposition = result.headers['content-disposition'];
                    if (contentDisposition) {
                        const matches = /filename="([^"]+)"/.exec(contentDisposition);
                        if (matches && matches[1]) {
                            fileName = matches[1];
                        }
                    }
                    try {
                        await browser.downloads.download({
                            url: blobUrl,
                            filename: fileName
                        });
                    } catch (error) {
                        console.error('Failed to start download:', error);
                    }
                    resolve({ message: 'success' });
                } else if (blob.type === 'application/json') {
                    const text = await blob.text();
                    const json = JSON.parse(text);
                    console.log('response json:');
                    console.log(json);
                    resolve({ message: json.message })
                } else {
                    console.log('ERR: unknown blob type: ' + blob.type);
                    resolve({ message: 'failure' });
                }
            }).catch((err) => {
                console.error('Service worker DOWNLOAD_PLAYLIST error:', err);
                resolve({ message: 'failure' });
            });

        }
    });
});




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
            // Check if the content has #EXTINF to identify it as a streaming file (non-playlist)
            if (content.includes('#EXTINF')) {
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


// update popup icon
function updateIcon(isActive) {
    let localIconPath = isActive ? activeIconPath : iconPath;
    browser.browserAction.setIcon({ path: localIconPath }).then(() => {
        console.log('icon changed successfully to ' + localIconPath);
    }).catch((error) => {
        console.log('error changing icon: ' + error);
    });
    activeIconShowing = isActive;
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
                    return { ...item, progress: 0, status: 'error', error: 'server disconnected!' };
                }
                return item;
            });

            // set icon to default
            browser.storage.local.set({ activeIconShowing: false });

            activeIconShowing = false;
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
            updatedHistory[index] = {
                ...updatedHistory[index], progress: data.progress, status: newStatus, error: data.error || 'none',
                fileName: data.fileName, task: data.task || 'none'
            };
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

        //update the icon as needed
        if (newStatus !== 'in-progress') {
            if (!updatedHistory.some(i => i.status === 'in-progress')) {
                browser.storage.local.set({ activeIconShowing: false });
            }

        } else if (!activeIconShowing) {
            browser.storage.local.set({ activeIconShowing: true });
        }
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
    if (area === 'local' && changes.cloudMode) {

        let cloudMode = changes.cloudMode.newValue;

        // detect changes in cloudMode setting
        if ((cloudMode !== null) &&
            ((cloudMode && serverURL.startsWith('http://localhost')) ||
                (!cloudMode && (serverURL === cloudServerURL)))) {
            console.log('cloudMode changed to ', cloudMode);
            serverURL = cloudMode ? cloudServerURL : `http://localhost:${SERVER_PORT}`;

            // Recreate the EventSource with the new serverURL
            createEventSource();
        }
    } else if (area === 'local' && changes.activeIconShowing) {
        console.log('activeIconShowing changed to ', changes.activeIconShowing.newValue);
        activeIconShowing = changes.activeIconShowing.newValue;
        updateIcon(activeIconShowing);
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



browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'downloadVideo') {
        const { currentLink } = message.payload;

        // Fetch settings from local storage or any source
        chrome.storage.local.get('settings', (result) => {
            chrome.storage.local.get('popupSettings', (result2) => {

                let settings = result.settings || defaultSettings;
                let popupSettings = result2.popupSettings || [false, true, ''];
                let timestamp = Date.now();
                console.log('timestamp:')
                console.log(timestamp)

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
                    console.log('Download finished:', response.data);
                    sendResponse({ message: 'success' });
                }).catch((error) => {
                    console.error('Error starting download:', error.message);
                    sendResponse({ message: 'failure', error: error.message });
                });
            });
        });

        // Return true to keep the message channel open for asynchronous response
        return true;
    }
});
