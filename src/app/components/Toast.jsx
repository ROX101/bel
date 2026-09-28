import { useApp } from '../store.jsx';

const TOAST_ACCENT = { success: '#27ae60', error: '#c0392b', warning: '#f0c030' };

// Reactive replacement for app.js's renderToastSlot()/showToastEl() DOM poking —
// core.js's toast() just sets State.toast and calls notify(); this renders it.
// style.css has no .toast rule (the original styled it entirely inline), so the
// same inline styles are reproduced here rather than added to style.css.
const BASE_STYLE = {
  position: 'fixed', bottom: 24, right: 24, padding: '12px 20px',
  background: '#161D26', color: '#fff', fontSize: 13,
  boxShadow: '0 4px 16px rgba(0,0,0,0.3)', zIndex: 9999,
  borderLeft: '4px solid #f0c030', maxWidth: 360,
};

export default function Toast() {
  const { State } = useApp();
  const t = State.toast;
  if (!t) return <div id="toast" style={{ ...BASE_STYLE, display: 'none' }} />;
  return (
    <div id="toast" style={{ ...BASE_STYLE, display: 'block', borderLeftColor: TOAST_ACCENT[t.type] || TOAST_ACCENT.warning }}>
      {t.msg}
    </div>
  );
}
