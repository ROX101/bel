import { useEffect, useRef } from 'react';
import { bootLedger, initGlobalListeners } from './app/core.js';
import { useApp } from './app/store.jsx';
import Login from './app/components/Login.jsx';
import Shell from './app/components/Shell.jsx';
import Toast from './app/components/Toast.jsx';
import './style.css';

// Real component-tree replacement for the Phase 1 mountBelApp(rootEl) wrapper
// (src/legacy/app-legacy.js, now unused dead code — see that file's header).
// App boots the in-browser ledger and the two window/document-level listeners
// exactly once (same one-time-boot requirement mountBelApp had), then renders
// either the login screen or the full app shell depending on session state,
// with the toast overlay always mounted on top.
//
// bootLedger/initGlobalListeners are not re-entrant (same reasoning the
// Phase-1 header documented), so this still guards with a ref and does not
// rely on React 18/19 StrictMode being off (main.jsx also doesn't enable it).
function App() {
  const bootedRef = useRef(false);
  const { State } = useApp();

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    bootLedger();
    const cleanup = initGlobalListeners();
    return cleanup;
  }, []);

  return (
    <>
      {State.currentUserId ? <Shell /> : <Login />}
      <Toast />
    </>
  );
}

export default App;
