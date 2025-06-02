// frontend/src/main.jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Initialize pdfjs worker
import * as pdfjsLib from 'pdfjs-dist';
// Use the worker from the local node_modules. Adjust path if your setup is different.
// Note: Vite might need specific handling for web workers depending on its version.
// Using the 'Legacy' worker source for broader compatibility for now.
const PDF_WORKER_URL = new URL('pdfjs-dist/build/pdf.worker.legacy.js', import.meta.url).toString();
pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;


ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
