import './App.css';
import React, { useState } from 'react';
import axios from 'axios';

import download from './images/dl.png';
import loadingGif from './images/loading.gif';
import xmark from './images/x.png';
import checkmark from './images/check.png';

function App() {
  const [link, setLink] = useState('');
  const [result, setResult] = useState('');

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
        url: link, // Send the URL to the backend
      });
      setResult(response.data.message);
    } catch (error) {
      console.error('Error:', error);
      setResult('failure');
    }

    setLink('');
  };

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
      />
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