import './App.css';
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useTimeoutState } from './useTimeoutState';
import validator from 'validator'

import download from './images/dl.png';
import loadingGif from './images/loading.gif';
import xmark from './images/x.png';
import checkmark from './images/check.png';
import drive from './images/gd.png';
import explorer from './images/fe.png';

// TODO: Download m3u8 files from list, use ffmpeg like so to convert to mp4:
//ffmpeg -protocol_whitelist "file,http,https,tcp,tls" -i "C:\Users\andre\Downloads\aW5kZXgubTN1OA==.m3u8" -c copy output.mp4

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
  const [m3u8Links, setM3u8Links] = useState(['testidk', 'https://www.twitch.tv/emiru', 'https://www.twitch.tv/emiru']);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyPress);

    return () => {
      window.removeEventListener('keydown', handleKeyPress);
    };
  })

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
    console.log('downloading ' + link + '...');
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
            {m3u8Links.map((link) => {
              const isURL = validator.isURL(link);
              const dl_image = isURL ? download : xmark;
              return <tr className='m3u8-entry'>
                <td className='m3u8-link'>{isURL ? <a href={link}>{link}</a> : link}</td>
                <td className={`m3u8-dl ${isURL ? 'valid-url' : ''}`}><img src={dl_image} onClick={() => {isURL ? download_m3u8(link):''}} draggable="false"></img></td>
              </tr>
            })
            }
          </tbody>
        </table>
      </div>

      <div className={`history-menu collapsible-menu ${historyOpen ? 'open' : 'closed'}`}>
      </div>
    </div>
  );
}

export default App;