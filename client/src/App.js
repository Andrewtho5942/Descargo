import './App.css';
import React, { useState } from 'react';
import download from '../public/dl.png';

function App() {
  const [link, setLink] = useState('');

  const updateLink = (e) => {
    let newText = e.target.value;
    console.log('updated link to: ' + newText);
    setLink(newText);
  };

  const submitLink = async () => {
    if (!link) {
      alert('Please enter a YouTube URL.');
      return;
    }
  
    try {
      const response = await axios.post('http://localhost:5000/download', {
        url: link, // Send the URL to the backend
      });
      alert(response.data.message);
    } catch (error) {
      console.error('Error:', error);
      alert('Failed to download video. Please try again.');
    }
    
    setLink('');
  };

  return (
    <div className="App" >
      <div className="header-container">
        <img src={download} alt="YT image" className="dl-img"></img>
        <h1>YT Downloader</h1>
      </div>

      <input
        type="text"
        value={link}
        onChange={updateLink}
        placeholder="Enter YouTube URL"
      />
      <button onClick={submitLink}>Download</button>
    </div>
  );
}

export default App;