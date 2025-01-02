import './App.css';
import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useTimeoutState } from './useTimeoutState';
import validator from 'validator'

import download from './images/dl_icon.png';
import loadingGif from './images/loading.gif';
import xmark from './images/x.png';
import checkmark from './images/check.png';
import drive from './images/gd.png';
import explorer from './images/fe.png';
import disconnect from './images/disconnect.png'
import settingsIcon from './images/settings.png'
import cloudIcon from './images/cloud.png'

const defaultSettings = [
  { key: "darkMode", value: true },
  { key: "cloudMode", value: false },
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

function App() {
  const SERVER_PORT = 5001;
  const cloudServerURL = "https://descargo-tunnel.andrewtho5942.xyz";//"https://red-jellyfish-66.telebit.io";

  const [result, setResult] = useState('');
  const [serverURL, setServerURL] = useState(`http://localhost:${SERVER_PORT}`)
  const [popupSettings, setPopupSettings] = useState([false, true, '']); // videoFormat, gdrive, link
  const [m3u8Open, setM3u8Open] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [fileBg1, setFileBg1] = useTimeoutState('transparent');
  const [fileBg2, setFileBg2] = useTimeoutState('transparent');
  const [openFiles, setOpenFiles] = useState(true);
  const [m3u8Links, setM3u8Links] = useState([]);
  const [history, setHistory] = useState([]);
  const [m3u8bg, setM3u8bg] = useState([false, false, false]);
  const [menubtnbg, setmenubtnbg] = useState([false, false]);
  const [disconnectVisible, setDisconnectVisible] = useState([true, false]); // disconnected, disconnectedSignVisible
  const [settings, setSettings] = useState([]);


  const historyRef = useRef(history);
  const popupSettingsRef = useRef(popupSettings);
  const settingsRef = useRef(settings);
  const serverURLRef = useRef(serverURL)

  //update the useRefs
  useEffect(() => {
    historyRef.current = history;
  }, [history]);
  useEffect(() => {
    popupSettingsRef.current = popupSettings;
  }, [popupSettings]);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  useEffect(() => {
    serverURLRef.current = serverURL;
  }, [serverURL]);

  const storePopupSettings = (newPopupSettings) => {
    browser.storage.local.set({ popupSettings: newPopupSettings }).then(() => {
      // console.log(`Stored updated popupSettings`);
      // console.log(newPopupSettings)
    });
  }

  function calculateResultIcon(latestDownload) {
    let ldTimestamp = Date.parse(latestDownload.timestamp)
    let stalenessSec = (Date.now() - ldTimestamp) / 1000000
    console.log('stalenessSec: ' + stalenessSec);

    // set result according to staleness and status of the latest download in the history
    if (stalenessSec > 600) {
      setResult('');
    } else {
      if (latestDownload.status === 'completed') setResult('success')
      else if (latestDownload.status === 'in-progress') setResult('loading')
      else if (latestDownload.status === 'error') setResult('failure')
      else setResult('')
    }
  }

  // reload m3u8 links, history, and disconnect from storage when loading the popup
  useEffect(() => {
    // m3u8 links
    browser.storage.local.get('m3u8_links').then((result) => {
      const links = result.m3u8_links || [];
      console.log('retrieved links:')
      console.log(links);
      setM3u8Links(links);
    }).catch((error) => {
      console.error('Error retrieving m3u8 links:', error);
    });

    // history
    browser.storage.local.get('history').then((result) => {
      const history = result.history || [];
      console.log('retrieved history:')
      console.log(history);
      setHistory(history);
      if (history.length >= 1) {
        calculateResultIcon(history[0]);
      }
    }).catch((error) => {
      console.error('Error retrieving history:', error);
    });

    // disconnect
    browser.storage.local.get('disconnect').then((result) => {
      console.log('retrieved disconnect:')
      console.log(result.disconnect)
      setDisconnectVisible((prevDisconnect) =>
        [result.disconnect, prevDisconnect[1]]
      );
    }).catch((error) => {
      console.error('Error retrieving Disconnect:', error);
    });

    // popup settings
    browser.storage.local.get('popupSettings').then((result) => {
      const newPopupSettings = result.popupSettings;
      console.log('retrieved popupSettings:');
      console.log(newPopupSettings);
      if (newPopupSettings) {
        setPopupSettings(newPopupSettings);
      } else {
        console.log('Warning -- did not find popup settings in local storage, using default values...')
      }

    }).catch((error) => {
      console.error('Error retrieving popupSettings:', error);
    });

    // settings
    browser.storage.local.get('settings').then((result) => {
      let newSettings = result.settings;
      console.log('retrieved Settings:');
      console.log(newSettings);
      if (!newSettings || (newSettings.length < defaultSettings.length)) {
        console.log('Warning -- Settings length is invalid, using default settings...');
        newSettings = defaultSettings;
      }
      // update the serverURL based on the cloudMode setting in storage
      const newServerURL = newSettings.find(s => s.key === 'cloudMode').value ? cloudServerURL : `http://localhost:${SERVER_PORT}`;
      setServerURL(newServerURL);
      console.log('assigned new serverURL: ' + newServerURL);

      setSettings(newSettings);

      // set the dark or light mode
      const darkMode = newSettings.find(s => s.key === 'darkMode')
      console.log('darkmode: ' + darkMode.value)
      document.documentElement.setAttribute('data-theme', darkMode.value ? 'dark' : 'light');

    }).catch((error) => {
      console.error('Error retrieving settings:', error);
    });
  }, []);

  // update the links and history in real time by listening to storage changes
  useEffect(() => {
    console.log('mounting storage listener')
    function handleStorageChange(changes, area) {

      // update the m3u8 links
      if (area === 'local' && changes.m3u8_links) {
        //console.log('updated m3u8 links from storage.')
        setM3u8Links(changes.m3u8_links.newValue || []);
      }

      // update the history
      if (area === 'local' && (changes.history || changes.historyUpdater)) {
        //setHistory(changes.history.newValue || []);
        browser.storage.local.get('history').then((result) => {
          const history = result.history || [];
          //console.log('retrieved history:')
          //console.log(history);
          setHistory(history);
          if (history.length >= 1) {
            calculateResultIcon(history[0]);
          }
        }).catch((error) => {
          console.error('Error retrieving history:', error);
        });
        //console.log('updated history from storage.');
      }

      // update disconnect
      if (area === 'local' && changes.disconnect) {
        // set the first boolean to the value in storage, which is the state of the server
        setDisconnectVisible((prevDisconnect) =>
          [changes.disconnect.newValue, prevDisconnect[1]]
        );
        console.log('updated disconnect from storage.');
      }
    }

    browser.storage.onChanged.addListener(handleStorageChange);
    console.log('Storage change listener added.');

    return () => {
      browser.storage.onChanged.removeListener(handleStorageChange);
      console.log('Storage change listener removed.');
    };
  }, []);

  //listen to changes in disconnect status and if disconnected, blink the image on and off
  useEffect(() => {
    let interval;

    if (disconnectVisible[0]) {
      // Start blinking when disconnectVisible[0] is true
      interval = setInterval(() => {
        setDisconnectVisible((prevDisconnect) => [prevDisconnect[0], !prevDisconnect[1],]);
      }, 500);
    } else {
      // Stop blinking and reset visibility
      setDisconnectVisible((prevDisconnect) =>
        [prevDisconnect[0], false]
      );
      if (interval) clearInterval(interval);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [disconnectVisible[0]]);


  // listen to key presses for hotkeys
  useEffect(() => {
    window.addEventListener('keydown', handleKeyPress);
    return () => {
      window.removeEventListener('keydown', handleKeyPress);
    };
  }, [])


  const addToHistory = (file, fileName, progress, timestamp, status, task) => {
    let newHistory = historyRef.current;
    newHistory.unshift({ file, fileName, progress, timestamp, status, task })

    if (newHistory.length > 25) {
      newHistory = newHistory.slice(0, 25);
    }
    setHistory(newHistory);

    browser.storage.local.set({ history: newHistory }).then(() => {
      console.log('Stored history:', newHistory[0]);
    });
  }

  const handleKeyPress = (e) => {
    const inputFocused =
      e.target.tagName === 'INPUT' ||
      e.target.tagName === 'TEXTAREA';
    if (e.key === settingsRef.current.find(s => s.key === 'submitHotkey')?.value) {
      submitLink();
    } else if (!inputFocused) {
      switch (e.key) {
        case settingsRef.current.find(s => s.key === 'gdriveHotkey')?.value:
          setPopupSettings((prevSettings) => {
            storePopupSettings([prevSettings[0], !prevSettings[1], prevSettings[2]]);
            return ([prevSettings[0], !prevSettings[1], prevSettings[2]])
          });
          break;
        case settingsRef.current.find(s => s.key === 'formatHotkey')?.value:
          setPopupSettings((prevSettings) => {
            storePopupSettings([!prevSettings[0], prevSettings[1], prevSettings[2]]);
            return ([!prevSettings[0], prevSettings[1], prevSettings[2]])
          }); break;
        case settingsRef.current.find(s => s.key === 'getMenuHotkey')?.value:
          openMenu(true);
          break;
        case settingsRef.current.find(s => s.key === 'historyMenuHotkey')?.value:
          openMenu(false);
          break;
        case settingsRef.current.find(s => s.key === 'openClearHotkey')?.value:
          setOpenFiles((prevOpenFiles) => !prevOpenFiles);
          break;
        case settingsRef.current.find(s => s.key === 'backHotkey')?.value:
          setHistoryOpen(false);
          setM3u8Open(false);
          break;
        case settingsRef.current.find(s => s.key === 'autofillHotkey')?.value:
          autofillLink();
          break;
        case settingsRef.current.find(s => s.key === 'settingsHotkey')?.value:
          browser.runtime.openOptionsPage();
          break;
        default:
      }
    }
  }


  const openMenu = (m3u8) => {
    if (m3u8) {
      setHistoryOpen(false);
      setM3u8Open((prevM3u8Open) => !prevM3u8Open);
    } else {
      setM3u8Open(false);
      setHistoryOpen((prevHistoryOpen) => !prevHistoryOpen);
    }
  }

  const autofillLink = () => {
    browser.tabs.query({ active: true, currentWindow: true })
      .then(tabs => {
        const currentTab = tabs[0];
        console.log('current Tab: ' + currentTab.url);
        setPopupSettings((prevSettings) => {
          storePopupSettings([prevSettings[0], prevSettings[1], currentTab.url]);
          return ([prevSettings[0], prevSettings[1], currentTab.url]);
        });
      })
      .catch(error => {
        console.error('Error:', error);
      });
  }

  const download_m3u8 = (link, title, index) => {
    // const timestamp = new Date().toISOString();
    // set the background to green

    setM3u8bg((prevbgs) => {
      const newbgs = [...prevbgs];
      newbgs[index] = true;
      return newbgs
    });
    setTimeout(() => {
      setM3u8bg((prevbgs) => {
        const newbgs = [...prevbgs];
        newbgs[index] = false;
        return newbgs
      });
    }, 200)

    console.log('downloading ' + link + '...');
    startDownload(link, title)
  }

  const stopDownload = (timestamp) => {
    console.log('stopping download with timestamp ' + timestamp);

    // stop the process on the server
    try {
      axios.post(`${serverURLRef.current}/stop_download`, {
        timestamp: timestamp
      }).then((result) => {
        //console.log('Stop Download response: ' + result.message);
      });
    } catch (error) {
      console.error('Error:', error);
    }

    // update the history in local storage to delete that entry
    let newHistory = historyRef.current.filter(item => item.timestamp !== timestamp);
    if (!newHistory.some(i => i.status === 'in-progress')) {
      browser.storage.local.set({ activeIconShowing: false });
    }

    browser.storage.local.set({ history: newHistory }).then(() => {
      console.log('removed download from history in storage')
    });
    browser.storage.local.set({ historyUpdater: Date.now() });
  }


  const updateLink = (e) => {
    let newText = e.target.value;
    console.log('updating link: ' + newText)
    setPopupSettings((prevSettings) => {
      storePopupSettings([prevSettings[0], prevSettings[1], newText]);
      return ([prevSettings[0], prevSettings[1], newText]);
    })
  };

  const startDownload = (currentLink, m3u8Title = '') => {
    const timestamp = new Date().toISOString();
    let format = popupSettingsRef.current[0] ? 'mp4' : 'm4a';
    if (m3u8Title) {
      format = 'mp4';
    }
    const cloudMode = !serverURLRef.current.startsWith('http://localhost')

    console.log('cloudMode: ' + cloudMode)

    let dlArgs = {
      timestamp: timestamp,
      format: format,
      gdrive: popupSettingsRef.current[1],
      outputPath: settingsRef.current.find(s => s.key === 'outputPath').value,
      gdriveKeyPath: settingsRef.current.find(s => s.key === (cloudMode ? 'gdriveKeyText' : 'gdriveJSONKey')).value,
      gdriveFolderID: settingsRef.current.find(s => s.key === 'gdriveFolderID').value,
      removeSubtext: settingsRef.current.find(s => s.key === 'removeSubtext').value,
      normalizeAudio: settingsRef.current.find(s => s.key === 'normalizeAudio').value,
      compressFiles: settingsRef.current.find(s => s.key === 'compressFiles').value,
      useShazam: settingsRef.current.find(s => s.key === 'useShazam').value,
      cookiePath: settingsRef.current.find(s => s.key === (cloudMode ? 'cookieText' : 'cookiePath')).value,
      maxDownloads: settingsRef.current.find(s => s.key === 'maxDownloads').value,
      generateSubs: settingsRef.current.find(s => s.key === 'generateSubs').value,
      m3u8Title: m3u8Title,
      useAria2c: m3u8Title ? settingsRef.current.find(s => s.key === 'useAria2c').value : false,
    }
    // Check if the link is a YT playlist
    const isYoutubePlaylist = (currentLink.includes("playlist")) && (currentLink.includes("youtube"));

    if (isYoutubePlaylist) {
      console.log('playlist detected');

      // Ask the service worker to handle the playlist download
      browser.runtime.sendMessage({
        type: 'DOWNLOAD_PLAYLIST',
        payload: {
          ...dlArgs,
          playlistURL: currentLink,
        }
      }).then((response) => {
        console.log('playlist download ended: ', response);
        setResult(response.message);
      })
        .catch((error) => {
          console.error('playlist download error: ', error);
          setResult('failure');
        });

    } else {
      console.log('video detected');

      try {
        addToHistory(currentLink, 'fetching... ', 0, timestamp, 'in-progress', 'Downloading...');

        // Ask the service worker to handle the video download
        browser.runtime.sendMessage({
          type: 'DOWNLOAD_VIDEO',
          payload: {
            ...dlArgs,
            url: currentLink,
          }
        }).then((response) => {
          console.log('download response: ', response);
          if (response === true) {
            setResult('loading');
          } else {
            setResult(response.message);
          }
        }).catch((error) => {
          console.error('download error: ', error);
          setResult('failure');
        });
      } catch (error) {
        console.error('Error:', error);
        setResult('failure');
      }
    }
  };

  const submitLink = () => {
    let currentLink = popupSettingsRef.current[2];

    setResult('loading');
    if (!currentLink) {
      setResult('failure');
      return;
    }

    startDownload(currentLink);

    setPopupSettings((prevSettings) => {
      storePopupSettings([prevSettings[0], prevSettings[1], '']);
      return ([prevSettings[0], prevSettings[1], '']);
    })
  };

  const clearFolder = (local) => {
    setOpenFiles(true);

    let setBg = local ? setFileBg1 : setFileBg2
    const cloudMode = !serverURLRef.current.startsWith('http://localhost')

    try {
      axios.post(`${serverURLRef.current}/clear`, {
        type: local ? 'local-downloads' : 'gdrive-downloads',
        outputPath: settingsRef.current.find(s => s.key === 'outputPath').value,
        gdriveKeyPath: settingsRef.current.find(s => s.key === (cloudMode ? 'gdriveKeyText' : 'gdriveJSONKey')).value,
        gdriveFolderID: settingsRef.current.find(s => s.key === 'gdriveFolderID').value
      }).then((response) => {
        let color = 'red'
        if (response.data.message === 'success') {
          let darkMode = settingsRef.current.find(s => s.key === 'darkMode').value
          if (darkMode) {
            color = '#126d32';
          } else {
            color = '#a0eba0';
          }
        }
        // update the background color
        setBg(color);

        // clear the current timeout for this button and set a new timeout to reset the color to white
        setBg(color, { timeout: 500 })

      });
    } catch (error) {
      console.error('Error:', error);
    }
  }

  const clearMenu = (m3u8) => {
    setOpenFiles(true);

    // update the background for the menu button when clicked
    const index = m3u8 ? 0 : 1;
    setmenubtnbg((prevbgs) => {
      const newbgs = [...prevbgs];
      newbgs[index] = true;
      return newbgs
    });
    setTimeout(() => {
      setmenubtnbg((prevbgs) => {
        const newbgs = [...prevbgs];
        newbgs[index] = false;
        return newbgs
      });
    }, 150)

    if (m3u8) {
      // clear the m3u8 storage
      browser.storage.local.remove('m3u8_links')

    } else {
      console.log('clearing history ---------')
      // update the iconShowing state in storage to change the icon in the service worker
      browser.storage.local.set({ activeIconShowing: false });

      // clear the history storage
      browser.storage.local.remove('history')
      setResult('')

      try {
        axios.post(`${serverURLRef.current}/kill_processes`, {
        }).then((response) => {
          console.log('done killing processes: ')
          console.log(response)
        });
      } catch (error) {
        console.error('Error:', error);
      }
    }
  }

  const openFolder = (local) => {
    console.log('outputPath: ' + settingsRef.current.find(s => s.key === 'outputPath').value)
    console.log('settingsRef.current:')
    console.log(settingsRef.current);

    if (local) {
      console.log('disconnectVisible[0]: ', disconnectVisible[0])
      if (!disconnectVisible[0]) {
        //not disconnected
        // open file explorer to downloads folder
        try {
          axios.post(`${serverURLRef.current}/open`, {
            focusExplorerPath: settingsRef.current.find(s => s.key === 'focusExplorerPath').value,
            AHKPath: settingsRef.current.find(s => s.key === 'AHKPath').value,
            outputPath: settingsRef.current.find(s => s.key === 'outputPath').value,
          }).then((response) => {

            console.log(response.data.message)
          });
        } catch (error) {
          console.error('Error:', error);
        }
      } else {
        //disconnected, show error
        setFileBg1('red');
        setFileBg1('red', { timeout: 500 });
      }
    } else {
      const folderID = settingsRef.current.find(s => s.key === 'gdriveFolderID').value
      if (folderID) {
        const url = `https://drive.google.com/drive/folders/${folderID}`;
        window.open(url);
      } else {
        setFileBg2('red');
        setFileBg2('red', { timeout: 500 });
      }
    }
  }

  return (
    <div className="App" >
      {(disconnectVisible[0] && disconnectVisible[1]) && <img src={disconnect} alt="disconnected" draggable='false' className='disconnect'></img>}
      <img src={download} alt="youtube" draggable="false" className="dl-img"></img>
      <img src={settingsIcon} alt="settings" draggable="false" className='settings-img' onClick={() => { browser.runtime.openOptionsPage() }}></img>
      {serverURLRef.current === cloudServerURL && <img src={cloudIcon} alt="cloud" draggable="false" className='cloud-img'></img>}

      <span className="header">
        <h1>Descargo</h1>
      </span>

      <input
        type="text"
        value={popupSettings[2]}
        onChange={(e) => { updateLink(e) }}
        placeholder="Enter YouTube URL"
        className="link-input"
      />

      <div className='autofill-btn' onClick={() => { autofillLink() }}>fill</div>


      <label className={`format checkbox-container ${popupSettings[0] ? 'active' : ''}`}>
        <input type="checkbox" checked={popupSettings[0]} onChange={() => {
          setPopupSettings((prevSettings) => {
            storePopupSettings([!prevSettings[0], prevSettings[1], prevSettings[2]]);
            return ([!prevSettings[0], prevSettings[1], prevSettings[2]]);
          });
        }} />
        <span className="custom-checkbox"></span>
        <span style={{ userSelect: 'none' }} className="checkbox-label">MP4?</span>
      </label>


      <button className="download-btn" onClick={() => { submitLink() }}>Download</button>
      {result && <img src={
        result === 'loading' ? loadingGif :
          result === 'success' ? checkmark : xmark
      } alt="loading" className={`result ${result}`} />
      }


      <label className={`gdrive checkbox-container ${popupSettings[1] ? 'active' : ''}`}>
        <input type="checkbox" checked={popupSettings[1]} onChange={() => {
          setPopupSettings((prevSettings) => {
            storePopupSettings([prevSettings[0], !prevSettings[1], prevSettings[2]]);
            return ([prevSettings[0], !prevSettings[1], prevSettings[2]]);
          });
        }} />
        <span className="custom-checkbox"></span>
        <span style={{ userSelect: 'none' }} className="checkbox-label">Gdrive?</span>
      </label>


      <div className="bot-spanner">
        <div className={`file-ops open-clear ${openFiles ? 'open' : 'clear'}`} onClick={() => { setOpenFiles(!openFiles) }}><div className={`clear-open-toggle`}>{openFiles ? 'OPEN' : 'CLEAR'}</div></div>
        <div style={{ width: '2px', height: '100%', backgroundColor: 'black' }}></div>
        <div className={`menu-btn ${menubtnbg[0] ? 'active' : 'inactive'}`} onClick={() => { openFiles ? openMenu(true) : clearMenu(true) }}><div className={`menu-toggle m3u8 ${m3u8Open ? 'active' : 'inactive'}`}>V</div>GET</div>
        <div style={{ width: '2px', height: '100%', backgroundColor: 'black' }}></div>
        <div className={`menu-btn ${menubtnbg[1] ? 'active' : 'inactive'}`} onClick={() => { openFiles ? openMenu(false) : clearMenu(false) }}><div className={`menu-toggle history ${historyOpen ? 'active' : 'inactive'}`}>V</div>History</div>
        <div style={{ width: '2px', height: '100%', backgroundColor: 'black' }}></div>

        <div className='file-ops'>
          <div className='file-btn-wrapper' style={{ '--bg-color': fileBg1 }}>
            <img src={explorer} onClick={() => { openFiles ? openFolder(true) : clearFolder(true) }} alt="explorer" className={`file-btn ${serverURLRef.current.startsWith('http://localhost') ? 'enabled' : 'disabled'}`} draggable="false"></img>
          </div>
          <div className='file-btn-wrapper enabled' style={{ '--bg-color': fileBg2 }}>
            <img src={drive} onClick={() => { openFiles ? openFolder(false) : clearFolder(false) }} alt="drive" className="file-btn enabled" draggable="false"></img>
          </div>
        </div>
      </div>

      {/* Collapsible menus */}
      <div className={`m3u8-menu collapsible-menu ${m3u8Open ? 'open' : 'closed'}`} tabIndex="-1">
        <table className='m3u8-table' tabIndex="-1">
          <tbody>
            {m3u8Links.map((item, index) => {
              try {

                const m3u8_link = item.link;
                const timestamp = item.timestamp;
                const m3u8_title = item.title;

                const isURL = validator.isURL(m3u8_link);
                const dl_image = isURL ? download : xmark;
                return <tr className='m3u8-entry' tabIndex="-1">
                  <td className='m3u8-timestamp' tabIndex="-1"><div className='timestamp-content' tabIndex="-1">{new Date(timestamp).toLocaleTimeString([], {
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true,
                  })}{', '}
                    {new Date(timestamp).toLocaleDateString([], {
                      month: '2-digit',
                      day: '2-digit',
                      year: 'numeric'
                    })}</div></td>
                  <td className='m3u8-link' tabIndex="-1"><div className='link-content' tabIndex="-1">{m3u8_title + ': '}{isURL ? <a href={m3u8_link}>{m3u8_link}</a> : m3u8_link}</div></td>
                  <td className={`m3u8-dl ${m3u8bg[index] ? 'active' : 'inactive'} ${isURL ? 'valid-url' : ''}`} tabIndex="-1">
                    <img src={dl_image} tabIndex="-1" onClick={() => { isURL ? download_m3u8(m3u8_link, m3u8_title, index) : '' }} draggable="false"></img>
                  </td>
                </tr>
              } catch (e) {
                console.log('error in m3u8_item: ')
                console.log(item)
              }
            })
            }
          </tbody>
        </table>
        {(m3u8Links.length === 0) && <div className='menu-empty'> No m3u8 links detected! </div>}
      </div>

      <div className={`history-menu collapsible-menu ${historyOpen ? 'open' : 'closed'}`} tabIndex="-1">
        <table className='history-table' tabIndex="-1">
          <tbody>
            {history.map((item) => {
              try {
                const { file, fileName, progress, timestamp, status } = item;

                const isURL = validator.isURL(file);

                return <tr className='history-entry' tabIndex="-1" style={{
                  background: status === 'in-progress' ?
                    `linear-gradient(to right, rgba(40, 255, 40, 0.1) ${progress - 1}%, rgb(200,50,50) ${progress}%, transparent ${progress + 1}%)`
                    : (status === 'completed' ?
                      `linear-gradient(to right, rgba(40, 255, 40, 0.12) 100%, black 0%)`
                      : 'rgba(255,0,0,0.08)'
                    )
                }}>

                  <td className='history-timestamp' tabIndex="-1">
                    {item.status === 'in-progress' ? <div className='timestamp-content' tabIndex="-1">
                      {item.task}
                    </div> :
                      <div className='timestamp-content' tabIndex="-1">
                        {new Date(timestamp).toLocaleTimeString([], {
                          hour: 'numeric',
                          minute: '2-digit',
                          hour12: true,
                        })}{', '}
                        {new Date(timestamp).toLocaleDateString([], {
                          month: '2-digit',
                          day: '2-digit',
                          year: 'numeric'
                        })}
                      </div>}</td>
                  <td className='history-link' tabIndex="-1"><div className='history-content' tabIndex="-1">
                    {item.status === 'error' && <>{'E: ' + (item.error || 'unknown') + ' | '}</>}
                    {item.status === 'in-progress' && <>
                      <span className='progress'>{`${progress}%`}</span> - <button style={{ marginRight: '4px' }} tabIndex="-1" onClick={() => { stopDownload(timestamp) }}>stop</button>
                    </>}{fileName + ': '}{isURL ? <a href={file} tabIndex="-1">{file}</a> : file}
                  </div></td>
                </tr>
              } catch (e) {
                console.log('error in history_item: ')
                console.log(item)
              }
            })
            }
          </tbody>
        </table>
        {(history.length === 0) && <div className='menu-empty'> No history found! </div>}
      </div>
    </div >
  );
}

export default App;