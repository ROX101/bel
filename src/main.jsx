import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';

// No <StrictMode>: App.jsx boots an in-browser ledger (core.js's bootLedger())
// and registers window/document event listeners exactly once on mount, the
// way the original classic-script app.js did on page load. StrictMode's
// development-only double-invoke of effects would run that boot sequence
// twice. See src/App.jsx for the full explanation.
createRoot(document.getElementById('root')).render(<App />);
