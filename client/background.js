
const SERVER_PORT = 5001;
const cloudServerURL = "https://descargo-tunnel.andrewtho5942.xyz";//"https://red-jellyfish-66.telebit.io";
let serverURL = `http://localhost:${SERVER_PORT}`
let eventSource = null;

let iconModifier = '';
browser.storage.local.set({ iconModifier: '' });


let disconnected = true;
browser.storage.local.set({ disconnect: true });



async function handleVideoDownload(result) {
    const blob = result.data;
    if (blob.type === 'application/octet-stream') {
        const blobUrl = URL.createObjectURL(blob);
        console.log('blobURL: ' + blobUrl);

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
            return { message: 'success' };
        } catch (error) {
            console.error('Failed to start download:', error);
            return { message: 'failure' };
        }
    } else if (blob.type === 'application/json') {
        const text = await blob.text();
        const json = JSON.parse(text);
        console.log('response json:', json);
        return { message: json.message };
    } else {
        console.error('ERR: unknown blob type: ' + blob.type);
        return { message: 'failure' };
    }
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {

    if (message.type === 'DOWNLOAD_VIDEO') {
        const { payload } = message;
        console.log('payload:', payload);

        axios.post(`${serverURL}/download`, payload).then(async (result) => {
            console.log('received server download response: ', result);
            sendResponse({ message: 'loading' })
        }).catch((err) => {
            console.error('Service worker DOWNLOAD_VIDEO error:', err);
            sendResponse({ message: 'failure' });
        });

        // Return true to indicate asynchronous response
        return true;
    } else if (message.type === 'DOWNLOAD_PLAYLIST') {
        console.log('got download playlist request from popup');

        const { payload } = message;
        axios.post(`${serverURL}/playlist`, payload).then(async (result) => {
            console.log('playlist finished:', result);
            // const blob = result.data;
            sendResponse({ message: 'loading' });

            //     if (blob.type === 'application/zip') {
            //         const blobUrl = URL.createObjectURL(blob);
            //         console.log('blobURL:', blobUrl);

            //         // extract the filename from the response
            //         let fileName = 'untitled.zip';
            //         const contentDisposition = result.headers['content-disposition'];
            //         if (contentDisposition) {
            //             const matches = /filename="([^"]+)"/.exec(contentDisposition);
            //             if (matches && matches[1]) {
            //                 fileName = matches[1];
            //             }
            //         }

            //         try {
            //             await browser.downloads.download({
            //                 url: blobUrl,
            //                 filename: fileName
            //             });
            //             console.log('playlist downloaded successfully');
            //             sendResponse({ message: 'success' });
            //         } catch (error) {
            //             console.error('Failed to start download:', error);
            //             sendResponse({ message: 'failure' });
            //         }
            //     } else if (blob.type === 'application/json') {
            //         const text = await blob.text();
            //         const json = JSON.parse(text);
            //         console.log('response json:', json);
            //         sendResponse({ message: json.message });
            //     } else {
            //         console.log('ERR: unknown blob type:', blob.type);
            //         sendResponse({ message: 'failure' });
            //     }
        }).catch((err) => {
            console.error('Service worker DOWNLOAD_PLAYLIST error:', err);
            sendResponse({ message: 'failure' });
        });

        // Return true to indicate asynchronous response
        return true;
    } else if (message.type === 'DOWNLOAD_VIDEO_INJECTED') {
        const { currentLink } = message.payload;

        // Fetch settings from local storage or any source
        chrome.storage.local.get('settings', (result) => {
            chrome.storage.local.get('popupSettings', (result2) => {

                let settings = result.settings || defaultSettings;
                let popupSettings = result2.popupSettings || [false, true, ''];
                let timestamp = new Date().toISOString();
                let cloudMode = settings.find(s => s.key === 'cloudMode').value;

                console.log('timestamp:')
                console.log(timestamp)

                let dlArgs = {
                    timestamp: timestamp,
                    format: popupSettings[0] ? 'mp4' : 'm4a',
                    gdrive: popupSettings[1],
                    outputPath: settings.find(s => s.key === 'outputPath').value,
                    gdriveKeyPath: settings.find(s => s.key === (cloudMode ? 'gdriveKeyText' : 'gdriveJSONKey')).value,
                    gdriveFolderID: settings.find(s => s.key === 'gdriveFolderID').value,
                    removeSubtext: settings.find(s => s.key === 'removeSubtext').value,
                    normalizeAudio: settings.find(s => s.key === 'normalizeAudio').value,
                    compressFiles: settings.find(s => s.key === 'compressFiles').value,
                    useShazam: settings.find(s => s.key === 'useShazam').value,
                    cookiePath: settings.find(s => s.key === (cloudMode ? 'cookieText' : 'cookiePath')).value,
                    maxDownloads: settings.find(s => s.key === 'maxDownloads').value,
                    generateSubs: settings.find(s => s.key === 'generateSubs').value,
                    m3u8Title: '',
                    useAria2c: false
                }

                addToHistory(currentLink, 'fetching... ', 0, timestamp, 'in-progress', 'Downloading...');

                // Make the axios request to the server
                // Post to /download on the server
                axios.post(`${serverURL}/download`, {
                    ...dlArgs,
                    url: currentLink
                }).then(async (result) => {
                    console.log('received server response: ', result);

                    //const response = await handleVideoDownload(result);
                    sendResponse({ message: 'in-progress' });
                }).catch((err) => {
                    console.error('Service worker DOWNLOAD_VIDEO_INJECTED error:', err);
                    sendResponse({ message: 'failure' });
                });
            });
        });

        // Return true to indicate asynchronous response
        return true;
    } else {
        return { message: 'failure' };
    }
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
function updateIcon(iconMod) {
    // console.log('iconMod:' + iconMod)
    let iconPath = "./src/images/dl_icon" + iconMod + '.png';

    browser.browserAction.setIcon({ path: iconPath }).then(() => {
        console.log('icon changed successfully to ' + iconPath);
    }).catch((error) => {
        console.log('error changing icon: ' + error);
    });
    iconModifier = iconMod;
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

        if (!serverURL.startsWith('http://localhost')) {
            // we are in cloud mode
            if (data.task === 'download-completed') {
                // only the download completed, so request the data stream from the server
                axios.post(`${serverURL}/streamVideo`, data, { responseType: 'blob' }).then(async (result) => {
                    console.log('received server streaming response: ', result);
                    await handleVideoDownload(result);
                }).catch((err) => {
                    console.error('Service worker stream video error:', err);
                });
                newStatus = 'in-progress'

            } else if (data.task === 'streaming-completed') {
                // the streaming is completed, send the notification if needed and set the status to completed
                browser.storage.local.get('settings').then((result) => {
                    sendNotification(result, data, '✓ Descargo Finished', `Finished Downloading ${truncateString(data.fileName, 30)}  |  time: ${data.timeSpent}`);
                });
                newStatus = 'completed';
            }
        } else {
            // not in cloud mode
            browser.storage.local.get('settings').then((result) => {
                sendNotification(result, data, '✓ Descargo Finished', `Finished Downloading ${truncateString(data.fileName, 30)}  |  time: ${data.timeSpent}`);
            });
            newStatus = 'completed';
        }
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
                browser.storage.local.set({ iconModifier: '' });
            }

        } else if (iconModifier !== '_active') {
            browser.storage.local.set({ iconModifier: '_active' });
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
            browser.storage.local.set({ iconModifier: '' });
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
            browser.storage.local.set({ iconModifier: '_disconnected' });
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
    } else if (area === 'local' && changes.iconModifier) {
        console.log('iconModifier changed to ', changes.iconModifier.newValue);
        updateIcon(changes.iconModifier.newValue);
    }
});






// ---- communication with the content script ------

const defaultSettings = [
    { key: "darkMode", value: true },
    { key: "cloudMode", value: false },
    { key: "highlightColor", value: 'green' },
    { key: "AHKPath", value: '' },
    { key: "focusExplorerPath", value: '' },

    { key: "m3u8Notifs", value: true },
    { key: "mp4Notifs", value: false },
    { key: "m4aNotifs", value: false },
    { key: "failureNotifs", value: false },
    { key: "playlistNotifs", value: true },

    { key: "outputPath", value: '' },
    { key: "removeSubtext", value: true },
    { key: "normalizeAudio", value: false },
    { key: "compressFiles", value: false },
    { key: "useShazam", value: false },
    { key: "generateSubs", value: false },
    { key: "useAria2c", value: false },
    { key: "maxDownloads", value: '10' },

    { key: "gdriveJSONKey", value: '' },
    { key: "gdriveFolderID", value: '' },
    { key: "cookiePath", value: "" },
    { key: "gdriveKeyText", value: "" },
    { key: "cookieText", value: "" },

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

