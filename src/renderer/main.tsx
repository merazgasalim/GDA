/**
 * Renderer Entry Point
 * ====================
 * Main entry for the React application in the renderer process.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles/globals.css';

// Ensure electronApi is available
if (!window.electronApi) {
  console.error('electronApi not found. Preload script may not have loaded correctly.');
}

// Create root and render
const root = ReactDOM.createRoot(document.getElementById('root')!);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
