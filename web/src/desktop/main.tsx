import React from 'react';
import { createRoot } from 'react-dom/client';
import DesktopApp from './DesktopApp';
import '../styles/index.css';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DesktopApp standalone />
  </React.StrictMode>,
);
if ('serviceWorker' in navigator && location.protocol !== 'meetfolio:') {
  // Only the separate static desktop build registers this worker. The server app is unaffected.
  window.addEventListener(
    'load',
    () =>
      void navigator.serviceWorker
        .register(`${import.meta.env.BASE_URL}sw.js`)
        .catch(() => {}),
  );
}
