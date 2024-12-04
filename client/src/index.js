import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

console.log('p1')
if ('serviceWorker' in navigator) {
  console.log('registering srevice worker')
  navigator.serviceWorker.register('/serviceWorker.js', {scope:'/'}).then((registration) => {
    console.log('Service Worker registered with scope:', registration.scope);
  }).catch((error) => {
    console.error('Service Worker registration failed:', error);
  });
}


const root = ReactDOM.createRoot(document.getElementById('root'));



root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
