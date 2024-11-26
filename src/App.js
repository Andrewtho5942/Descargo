import './App.css';
import { useState } from 'react';

function App() {
  const [link, setLink] = useState('')

  const updateLink = (e) => {
    let newText = e.target.value;
    console.log('updated link to: '+newText);
    setLink(newText);
  }

  const submitLink = () => {
    console.log('submitted link: ' + link);
    setLink('');
  }


  return (
    <div className="App">
      <input type="text" value={link} onChange={updateLink}></input>
      <button onClick={()=>{submitLink()}}>submit</button>
    </div>
  );
}

export default App;
