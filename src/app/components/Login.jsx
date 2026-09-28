import { useState } from 'react';
import { useApp } from '../store.jsx';
import { signIn, submitNewPassword, roleBadgeClass, isActive } from '../core.js';

const BEL_DEMO_PASSWORD = (typeof window !== 'undefined' && window.BEL_DEMO_PASSWORD) || '';
const demoAccounts = () => (typeof window !== 'undefined' && window.BEL_DEMO_ACCOUNTS) || [];

const STEPS = [
  'Decrypting your DID keystore',
  'Signing a one-time challenge with your DID key',
  'Verifying the signature against your DID Document on the ledger',
];

// Real JSX port of app.js's renderLoginPage()/attachLoginEvents(). Form inputs are
// now controlled React state instead of reads from document.getElementById().
export default function Login() {
  const { DB, State } = useApp();
  const f = State.loginFlow || {};
  const [email, setEmail] = useState(f.email || '');
  const [password, setPassword] = useState('');
  const [newPw1, setNewPw1] = useState('');
  const [newPw2, setNewPw2] = useState('');

  const demos = demoAccounts().map(a => ({ a, u: DB.users.find(x => x.did === a.did) })).filter(x => x.u);

  function handleLogin(e) {
    e.preventDefault();
    signIn(email, password);
  }
  function handleNewPassword(e) {
    e.preventDefault();
    submitNewPassword(newPw1, newPw2);
  }
  function fillDemo(a) {
    setEmail(a.email);
    setPassword(BEL_DEMO_PASSWORD);
  }

  return (
    <div className="login-page">
      <header className="login-header">
        <div className="brand">
          <div className="brand-text">
            <h1>Bharat Electronics Limited</h1>
            <p>Government of India, Ministry of Defence, A Navratna Company</p>
          </div>
        </div>
        <div style={{ fontSize: 11, color: '#999', textAlign: 'right' }}>
          CIN: L32309KA1954GOI000787<br />QUALITY. TECHNOLOGY. INNOVATION.
        </div>
      </header>
      <div className="login-nav" />
      <div className="login-body">
        <div className="login-card" style={{ width: 560 }}>
          <div className="login-card-header">
            <h2>BEL Secure Digital Asset &amp; Identity Portal</h2>
            <p>Authorised personnel only — sign in with your BEL account</p>
          </div>
          <div className="login-card-body">
            {!State.bootReady && <div className="no-data" style={{ padding: '14px 0' }}>⛓ Connecting to the ledger…</div>}
            {State.ledgerNotice && <div className="alert alert-warning" style={{ marginBottom: 12 }}>{State.ledgerNotice}</div>}
            {f.mustChange ? (
              <form onSubmit={handleNewPassword}>
                <div className="alert alert-info" style={{ marginBottom: 12 }}>🔑 You signed in with a temporary password. Choose your own password — it will re-encrypt your DID key.</div>
                <div className="form-group"><label>New password</label><input type="password" autoComplete="new-password" value={newPw1} onChange={e => setNewPw1(e.target.value)} /></div>
                <div className="form-group"><label>Confirm new password</label><input type="password" autoComplete="new-password" value={newPw2} onChange={e => setNewPw2(e.target.value)} /></div>
                {f.error && <div className="alert alert-danger" style={{ marginBottom: 10 }}>{f.error}</div>}
                <button type="submit" className="login-btn">Set password &amp; sign in</button>
              </form>
            ) : (
              <form onSubmit={handleLogin} autoComplete="on" style={!State.bootReady || f.busy ? { opacity: 0.55, pointerEvents: 'none' } : undefined}>
                <div className="form-group"><label>Email</label><input type="email" autoComplete="username" placeholder="name@bel.in" value={email} onChange={e => setEmail(e.target.value)} /></div>
                <div className="form-group"><label>Password</label><input type="password" autoComplete="current-password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} /></div>
                {f.error && <div className="alert alert-danger" style={{ marginBottom: 10 }}>{f.error}</div>}
                <button type="submit" className="login-btn">{f.busy ? 'Signing in…' : 'Sign in'}</button>
              </form>
            )}
            {f.busy && (
              <ol className="auth-steps" style={{ marginTop: 14 }}>
                {STEPS.map((s, i) => <li key={i} className={i < f.step ? 'done' : ''}>{s}{i === f.step ? ' …' : ''}</li>)}
              </ol>
            )}
            <div className="demo-accounts">
              <div className="section-label" style={{ marginTop: 18 }}>
                Demo accounts <span className="text-muted" style={{ textTransform: 'none', letterSpacing: 0 }}>— password <span className="mono">{BEL_DEMO_PASSWORD}</span></span>
              </div>
              {demos.map(({ a, u }) => (
                <div className="demo-account" key={a.did} title="Fill in this account" onClick={() => fillDemo(a)}>
                  <span className={`badge ${roleBadgeClass(u.role)}`}>{u.role}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{u.name}{!isActive(u) && <span className={`badge badge-${u.status}`}> {u.status}</span>}</div>
                    <div className="crdash-muted">{a.label}</div>
                  </div>
                  <span className="mono" style={{ fontSize: 11, color: '#1a5276' }}>{a.email}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="login-footer">
            🔒 Your password never leaves this device: it decrypts your DID key, which signs a one-time challenge that is verified against your DID Document on the ledger. Only active identities may sign in.
          </div>
        </div>
      </div>
      <footer className="site-footer">
        <span>Bharat Electronics Limited</span> &nbsp;|&nbsp; Secure Digital Asset &amp; Identity Portal &nbsp;|&nbsp; SIH 2026 – PS SIH26125 &nbsp;|&nbsp; Authorised Access Only
      </footer>
    </div>
  );
}
