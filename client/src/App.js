import './App.css';
import React, { useState, useEffect } from 'react';
import axios from 'axios';

import download from './images/dl.png';
import loadingGif from './images/loading.gif';
import xmark from './images/x.png';
import checkmark from './images/check.png';

function App() {
  const [link, setLink] = useState('');
  const [result, setResult] = useState('');
  const [videoFormat, setVideoFormat] = useState(false);


  useEffect(() => {
    window.addEventListener('keydown', handleKeyPress);

    return () => {
      window.removeEventListener('keydown', handleKeyPress);
    };
  })

  const handleKeyPress = (e) => {
    switch(e.key) {
      case 'Enter':
        submitLink();
        break;
      default:
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
      const response = await axios.post('http://localhost:5000/download', {
        url: link,
        format: videoFormat ? 'mp4' : 'm4a'
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

      <div className='format'>
        MP4?
        <input type="checkbox" checked={videoFormat} onChange={toggleVideoFormat} className="format-toggle"/>
      </div>

      <button onClick={submitLink}>Download</button>
      {result && <img src={
        result === 'loading' ? loadingGif :
        result === 'success' ? checkmark : xmark
      } alt="loading" className={`result ${result}`} />}
      <div style={{ height: '10px' }}></div>
    </div>
  );
}

export default App;