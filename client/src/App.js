import './App.css';
import React, { useState, useEffect } from 'react';
import axios from 'axios';

import download from './images/dl.png';
import loadingGif from './images/loading.gif';
import xmark from './images/x.png';
import checkmark from './images/check.png';
import drive from './images/gd.png';
import explorer from './images/fe.png';

// TODO: Download m3u8 files from list, use ffmpeg like so to convert to mp4:
//ffmpeg -protocol_whitelist "file,http,https,tcp,tls" -i "C:\Users\andre\Downloads\aW5kZXgubTN1OA==.m3u8" -c copy output.mp4

function App() {
  const SERVER_PORT = 5001;
  const [link, setLink] = useState('');
  const [result, setResult] = useState('');
  const [videoFormat, setVideoFormat] = useState(false);
  const [gdrive, setGdrive] = useState(true);
  const [m3u8Open, setM3u8Open] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);


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
          toggleGdrive();
          break;
        case 'p':
          toggleVideoFormat();
          break;
        case 'm':
          toggleM3u8Open();
          break;
        case 'h':
          toggleHistoryOpen();
          break;
        default:
      }
    }
  }

  const autofillLink = () => {
    browser.tabs.query({ active: true, currentWindow: true })
      .then(tabs => {
        const currentTab = tabs[0]; 
        console.log('current Tab: '+ currentTab.url);
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

  const toggleVideoFormat = () => {
    setVideoFormat(!videoFormat);
  }

  const toggleGdrive = () => {
    setGdrive(!gdrive);
  }

  const toggleM3u8Open = () => {
    setM3u8Open(!m3u8Open);
  }

  const toggleHistoryOpen = () => {
    setHistoryOpen(!historyOpen);
  }

  const clearFolder = (local) => {
    console.log(local)
    try {
      axios.post(`http://localhost:${SERVER_PORT}/clear`, {
        local: local
      })
    } catch (error) {
      console.error('Error:', error);
    }
  }

  return (
    <div className="App" >
      <img src={download} alt="youtube" className="dl-img"></img>
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
        <input type="checkbox" checked={videoFormat} onChange={toggleVideoFormat} />
        <span className="custom-checkbox"></span>
        <span style={{ userSelect: 'none' }} className="checkbox-label">MP4?</span>
      </label>


      <button className="download-btn" onClick={submitLink}>Download</button>
      {result && <img src={
        result === 'loading' ? loadingGif :
          result === 'success' ? checkmark : xmark
      } alt="loading" className={`result ${result}`} />}


      <label className={`gdrive checkbox-container ${gdrive ? 'active' : ''}`}>
        <input type="checkbox" checked={gdrive} onChange={toggleGdrive} />
        <span className="custom-checkbox"></span>
        <span style={{ userSelect: 'none' }} className="checkbox-label">Gdrive?</span>
      </label>


      <div className="bot-spanner">
        <div className='menu-btn' onClick={toggleM3u8Open}><div className={`menu-toggle ${m3u8Open ? 'active' : 'inactive'}`}>V</div>m3u8</div>
        <div style={{ width: '2px', height: '100%', backgroundColor: 'black' }}></div>
        <div className='menu-btn' onClick={toggleHistoryOpen}><div className={`menu-toggle ${historyOpen ? 'active' : 'inactive'}`}>V</div>history</div>
        <div style={{ width: '2px', height: '100%', backgroundColor: 'black' }}></div>

        <div className='clear'>clear:
          <img src={explorer} onClick={() => clearFolder(true)} alt="explorer" className="clear-btn"></img>
          <img src={drive} onClick={() => clearFolder(false)} alt="drive" className="clear-btn"></img>
        </div>
      </div>

    </div>
  );
}

export default App;