import './App.css';
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useTimeoutState } from './useTimeoutState';

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
  let googleDriveWindow = null;
  const [link, setLink] = useState('');
  const [result, setResult] = useState('');
  const [videoFormat, setVideoFormat] = useState(false);
  const [gdrive, setGdrive] = useState(true);
  const [m3u8Open, setM3u8Open] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [underline1, setUnderline1] = useTimeoutState('transparent')
  const [underline2, setUnderline2] = useTimeoutState('transparent')
  const [openFiles, setOpenFiles] = useState(true)


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
          setM3u8Open(!m3u8Open);
          break;
        case 'h':
          setHistoryOpen(!historyOpen);
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
    let setUnderline = local ? setUnderline1 : setUnderline2

    try {
      axios.post(`http://localhost:${SERVER_PORT}/clear`, {
        local: local
      }).then((response) => {
        let color = 'red'
        if (response.data.message === 'success') {
          color = 'green'
        }
        // update the underline color
        setUnderline(color);

        // clear the current timeout for this button and set a new timeout to reset the color to white
        setUnderline(color, { timeout: 750 })
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
      console.log('google drive window:')
      console.log(googleDriveWindow)
      // check if the google drive tab is already open
      if (googleDriveWindow && !googleDriveWindow.closed) {
        console.log('already open')
        // focus existing tab
        googleDriveWindow.focus();
      } else {
        console.log('new tab')
        //open new tab to google drive downloads folder
        googleDriveWindow = window.open(url, '_blank');
      }
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
        <div className='menu-btn' onClick={() => { setM3u8Open(!m3u8Open) }}><div className={`menu-toggle ${m3u8Open ? 'active' : 'inactive'}`}>V</div>m3u8</div>
        <div style={{ width: '2px', height: '100%', backgroundColor: 'black' }}></div>
        <div className='menu-btn' onClick={() => { setHistoryOpen(!historyOpen) }}><div className={`menu-toggle ${historyOpen ? 'active' : 'inactive'}`}>V</div>history</div>
        <div style={{ width: '2px', height: '100%', backgroundColor: 'black' }}></div>

        <div className='file-ops'>
          <div className='clear-open-toggle' onClick={() => { setOpenFiles(!openFiles) }}>{openFiles ? 'open' : 'clear'}</div>

          <div className='file-btn-wrapper' style={{ '--underline-color': underline1 }}>
            <img src={explorer} onClick={() => { openFiles ? openFolder(true) : clearFolder(true) }} alt="explorer" className="file-btn" draggable="false"></img>
          </div>
          <div className='file-btn-wrapper' style={{ '--underline-color': underline2 }}>
            <img src={drive} onClick={() => { openFiles ? openFolder(false) : clearFolder(false) }} alt="drive" className="file-btn" draggable="false"></img>
          </div>
        </div>

      </div>
    </div>
  );
}

export default App;