import './App.css';
import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useTimeoutState } from './useTimeoutState';
import validator from 'validator'

import download from './images/dl.png';
import loadingGif from './images/loading.gif';
import xmark from './images/x.png';
import checkmark from './images/check.png';
import drive from './images/gd.png';
import explorer from './images/fe.png';

function App() {
  const SERVER_PORT = 5000;
  const gdriveFolderID = "17pMCBUQxJfEYgVvNwKQUcS8n4oRGIE9q"
  const [link, setLink] = useState('');
  const [result, setResult] = useState('');
  const [videoFormat, setVideoFormat] = useState(false);
  const [gdrive, setGdrive] = useState(true);
  const [m3u8Open, setM3u8Open] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [fileBg1, setFileBg1] = useTimeoutState('transparent');
  const [fileBg2, setFileBg2] = useTimeoutState('transparent');
  const [openFiles, setOpenFiles] = useState(true);
  const [m3u8Links, setM3u8Links] = useState([]);
  const [history, setHistory] = useState([])
  const historyRef = useRef(history);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  // listen to key presses for hotkeys
  useEffect(() => {
    window.addEventListener('keydown', handleKeyPress);

    return () => {
      window.removeEventListener('keydown', handleKeyPress);
    };
  })

  // reload m3u8 links and history from storage when loading the popup
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
    }).catch((error) => {
      console.error('Error retrieving history:', error);
    });
  }, []);

  // update the links in real time by listening to storage changes
  useEffect(() => {
    function handleStorageChange(changes, area) {
      if (area === 'local' && changes.m3u8_links) {
        setM3u8Links(changes.m3u8_links.newValue || []);
      }
    }

    browser.storage.onChanged.addListener(handleStorageChange);

    return () => {
      browser.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  // listen to the server for progress updates on downloads
  useEffect(() => {
    // Start the SSE connection
    const eventSource = new EventSource(`http://localhost:${SERVER_PORT}/progress`);
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.progress) {
        console.log('progress update: ' + data.progress)
        let progressFloat = parseFloat(data.progress);

        const updatedHistory = historyRef.current.map(item => {
          if (item.timestamp === data.timestamp) {
            return { ...item, progress: progressFloat };
          }
          return item;
        });

        if(history[0] !== updatedHistory[0]){
          setHistory(updatedHistory)
        }
      }
      if (data.progress == 100) {
        console.log('Download completed');
        eventSource.close();
      }

      if (data.status === 'error') {
        console.error('An error occurred during download');
        eventSource.close();
      }
    };

    eventSource.onerror = (err) => {
      console.error('EventSource failed:', err);
      eventSource.close();
    };

    // Clean up on component unmount
    return () => {
      eventSource.close();
    };
  }, []);


  const addToHistory = (file, progress, timestamp) => {
    let newHistory = history;
    newHistory.unshift({ file, progress, timestamp })

    if (newHistory.length > 12) {
      newHistory = newHistory.slice(0, 12);
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
    if (e.key === 'Enter') {
      submitLink();
    } else if (!inputFocused) {
      switch (e.key) {
        case 'g':
          setGdrive(!gdrive);
          break;
        case 'p':
          setVideoFormat(!videoFormat);
          break;
        case 'm':
          setHistoryOpen(false);
          setM3u8Open(!m3u8Open);
          break;
        case 'h':
          setM3u8Open(false);
          setHistoryOpen(!historyOpen);
          break;
        case 'o':
          setOpenFiles(!openFiles);
          break;
        case 'Backspace':
          setHistoryOpen(false);
          setM3u8Open(false);
          break;
        default:
      }
    }
  }

  const autofillLink = () => {
    browser.tabs.query({ active: true, currentWindow: true })
      .then(tabs => {
        const currentTab = tabs[0];
        console.log('current Tab: ' + currentTab.url);
        setLink(currentTab.url);
      })
      .catch(error => {
        console.error('Error:', error);
      });
  }

  const download_m3u8 = (link) => {
    const timestamp = new Date().toISOString()
    console.log('downloading ' + link + '...');
    try {
      axios.post(`http://localhost:${SERVER_PORT}/download_m3u8`, {
        link: link,
        timestamp:timestamp
      });
      addToHistory(link, 0, timestamp);
    } catch (error) {
      console.error('Error:', error);
    }
  }

  const updateLink = (e) => {
    let newText = e.target.value;
    console.log('updated link to: ' + newText);
    setLink(newText);
  };

  const submitLink = async () => {
    setResult('loading');
    if (!link) {
      setResult('failure');
      return;
    }

    try {
      const response = await axios.post(`http://localhost:${SERVER_PORT}/download`, {
        url: link,
        format: videoFormat ? 'mp4' : 'm4a',
        gdrive: gdrive
      });
      setResult(response.data.message);
    } catch (error) {
      console.error('Error:', error);
      setResult('failure');
    }

    setLink('');
  };

  const clearFolder = (local) => {
    let setBg = local ? setFileBg1 : setFileBg2

    try {
      axios.post(`http://localhost:${SERVER_PORT}/clear`, {
        local: local
      }).then((response) => {
        let color = 'red'
        if (response.data.message === 'success') {
          color = 'green'
        }
        // update the background color
        setBg(color);

        // clear the current timeout for this button and set a new timeout to reset the color to white
        setBg(color, { timeout: 750 })
      });
    } catch (error) {
      console.error('Error:', error);
    }
  }


  const openFolder = (local) => {
    if (local) {
      // open file explorer to downloads folder
      try {
        axios.post(`http://localhost:${SERVER_PORT}/open`, {}).then((response) => {
          console.log(response.data.message)
        });
      } catch (error) {
        console.error('Error:', error);
      }
    } else {
      const url = `https://drive.google.com/drive/folders/${gdriveFolderID}`;
      window.open(url);
    }
  }

  return (
    <div className="App" >
      <img src={download} alt="youtube" draggable="false" className="dl-img"></img>
      <span className="header">
        <h1>YT Downloader</h1>
      </span>

      <input
        type="text"
        value={link}
        onChange={updateLink}
        placeholder="Enter YouTube URL"
        className="link-input"
      />

      <div className='autofill-btn' onClick={() => { autofillLink() }}>fill</div>


      <label className={`format checkbox-container ${videoFormat ? 'active' : ''}`}>
        <input type="checkbox" checked={videoFormat} onChange={() => { setVideoFormat(!videoFormat) }} />
        <span className="custom-checkbox"></span>
        <span style={{ userSelect: 'none' }} className="checkbox-label">MP4?</span>
      </label>


      <button className="download-btn" onClick={submitLink}>Download</button>
      {result && <img src={
        result === 'loading' ? loadingGif :
          result === 'success' ? checkmark : xmark
      } alt="loading" className={`result ${result}`} />}


      <label className={`gdrive checkbox-container ${gdrive ? 'active' : ''}`}>
        <input type="checkbox" checked={gdrive} onChange={() => { setGdrive(!gdrive) }} />
        <span className="custom-checkbox"></span>
        <span style={{ userSelect: 'none' }} className="checkbox-label">Gdrive?</span>
      </label>


      <div className="bot-spanner">
        <div className='menu-btn' onClick={() => { setHistoryOpen(false); setM3u8Open(!m3u8Open) }}><div className={`menu-toggle m3u8 ${m3u8Open ? 'active' : 'inactive'}`}>V</div>m3u8</div>
        <div style={{ width: '2px', height: '100%', backgroundColor: 'black' }}></div>
        <div className='menu-btn' onClick={() => { setM3u8Open(false); setHistoryOpen(!historyOpen) }}><div className={`menu-toggle history ${historyOpen ? 'active' : 'inactive'}`}>V</div>history</div>
        <div style={{ width: '2px', height: '100%', backgroundColor: 'black' }}></div>

        <div className='file-ops'>
          <div className='clear-open-toggle' onClick={() => { setOpenFiles(!openFiles) }}>{openFiles ? 'open' : 'clear'}</div>

          <div className='file-btn-wrapper' style={{ '--bg-color': fileBg1 }}>
            <img src={explorer} onClick={() => { openFiles ? openFolder(true) : clearFolder(true) }} alt="explorer" className="file-btn" draggable="false"></img>
          </div>
          <div className='file-btn-wrapper' style={{ '--bg-color': fileBg2 }}>
            <img src={drive} onClick={() => { openFiles ? openFolder(false) : clearFolder(false) }} alt="drive" className="file-btn" draggable="false"></img>
          </div>
        </div>
      </div>

      {/* Collapsible menus */}
      <div className={`m3u8-menu collapsible-menu ${m3u8Open ? 'open' : 'closed'}`}>
        <table className='m3u8-table'>
          <tbody>
            {m3u8Links.map((item) => {
              try {
                const m3u8_link = item.link;
                const timestamp = item.timestamp;

                const isURL = validator.isURL(m3u8_link);
                const dl_image = isURL ? download : xmark;
                return <tr className='m3u8-entry'>
                  <td className='m3u8-timestamp'><div className='timestamp-content'>{new Date(timestamp).toLocaleTimeString([], {
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true,
                  })}</div></td>
                  <td className='m3u8-link'><div className='link-content'>{isURL ? <a href={m3u8_link}>{m3u8_link}</a> : m3u8_link}</div></td>
                  <td className={`m3u8-dl ${isURL ? 'valid-url' : ''}`}><img src={dl_image} onClick={() => { isURL ? download_m3u8(m3u8_link) : '' }} draggable="false"></img></td>
                </tr>
              } catch (e) {
                console.log('error in m3u8_item: ')
                console.log(item)
              }
            })
            }
          </tbody>
        </table>
      </div>

      <div className={`history-menu collapsible-menu ${historyOpen ? 'open' : 'closed'}`}>
        <table className='history-table'>
          <tbody>
            {history.map((item) => {
              try {
                const { file, progress, timestamp } = item;

                const isURL = validator.isURL(file);

                return <tr className='history-entry' style={{
                  background: `linear-gradient(to right, rgba(0, 255, 0, 0.2) ${progress}%, transparent ${progress}%)`,
                }}>
                  <td className='history-timestamp'><div className='timestamp-content'>{new Date(timestamp).toLocaleTimeString([], {
                    month: '2-digit',
                    day: '2-digit',
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true,
                  })}</div></td>
                  <td className='history-link'><div className='history-content'>{isURL ? <a href={file}>{file}</a> : file}</div></td>
                </tr>
              } catch (e) {
                console.log('error in history_item: ')
                console.log(item)
              }
            })
            }
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default App;