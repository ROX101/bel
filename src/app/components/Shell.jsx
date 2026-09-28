import { useApp } from '../store.jsx';
import Icon from './Icon.jsx';
import Modal from './Modal.jsx';
import Dashboard from './pages/Dashboard.jsx';
import PeoplePage from './pages/PeoplePage.jsx';
import AssetRegistryPage from './pages/AssetRegistryPage.jsx';
import AuditTrailPage from './pages/AuditTrailPage.jsx';
import { currentUser, NAV_CONFIG, navigate, logout, resetDemoData, initialsOf, roleOf, LEDGER, resyncFromRemote, openModal, toggleSidebar, toggleSettingsMenu } from '../core.js';

// Real JSX port of app.js's renderPortal() shell (sidebar + top banners + active page +
// modal host + toast). Page dispatch mirrors the original renderPage() switch.
function ActivePage({ page }) {
  if (page === 'dashboard') return <Dashboard />;
  if (page === 'onboarding') return <PeoplePage />;
  if (page === 'assets') return <AssetRegistryPage />;
  if (page === 'audit') return <AuditTrailPage />;
  return <div className="page-header"><h2>Page not found</h2></div>;
}

export default function Shell() {
  const { State } = useApp();
  const user = currentUser();
  if (!user) return null;
  const navItems = NAV_CONFIG;
  if (!navItems.some(n => n.id === State.currentPage)) State.currentPage = navItems[0].id;

  return (
    <div className="app-shell">
      <div className="portal-wrapper">
        <aside className={`sidebar${State.sidebarCollapsed ? ' collapsed' : ''}`}>
          <div className="sb-brand">
            <span className="sb-logo" title="Bharat Electronics Limited"><Icon name="shield" size={18} /></span>
            <div className="sb-brand-text">
              <div className="sb-brand-name">BEL Secure Portal</div>
              <div className="sb-brand-sub">Identity &amp; Asset Ledger</div>
            </div>
            <button
              className="sb-collapse"
              title={State.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              onClick={toggleSidebar}
            >
              <Icon name={State.sidebarCollapsed ? 'expand' : 'collapse'} size={16} />
            </button>
          </div>
          <nav className="sb-nav">
            <div className="sb-section">Workspace</div>
            <ul className="sb-list">
              {navItems.map(n => (
                <li
                  key={n.id}
                  className={`sb-item${State.currentPage === n.id ? ' is-active' : ''}`}
                  title={n.label}
                  onClick={() => navigate(n.id)}
                >
                  <Icon name={n.icon} /><span className="sb-text">{n.label}</span>
                </li>
              ))}
            </ul>
          </nav>
          <div className="sb-foot settings-dropdown-wrap">
            {State.settingsMenuOpen && (
              <div className="sb-menu">
                <div className="sb-menu-head">
                  <div className="sb-menu-name">{user.name}</div>
                  <div className="sb-menu-did mono">{user.did}</div>
                  {State.lastProof && (
                    <div className="sb-menu-proof"><Icon name="shield" size={13} /> Signed in with DID proof · key {State.lastProof.thumb.slice(0, 8)}… · {State.lastProof.ms} ms</div>
                  )}
                </div>
                <button onClick={() => { State.settingsMenuOpen = false; State.profileActiveTab = 'personal'; openModal({ type: 'employee-profile', uid: user.id }); }}>
                  <Icon name="directory" size={15} /> My profile
                </button>
                <button onClick={logout}><Icon name="logout" size={15} /> Sign out</button>
                {State.dataSource === 'local' && (
                  <button title="Clears the ledger, database and wallet stored in this browser" onClick={resetDemoData}>
                    <Icon name="reset" size={15} /> Reset demo data
                  </button>
                )}
              </div>
            )}
            <button
              className="sb-user"
              title={`${user.name} — account`}
              onClick={e => { e.stopPropagation(); toggleSettingsMenu(); }}
            >
              <span className="sb-avatar">
                {initialsOf(user.name)}
                {State.lastProof && <span className="sb-verified" title="Signed in with a DID proof" />}
              </span>
              <span className="sb-user-text">
                <span className="sb-user-name">{user.name}</span>
                <span className="sb-user-role">{(roleOf(user) || { name: user.role }).name}</span>
              </span>
              <span className="sb-user-chev"><Icon name="updown" size={14} /></span>
            </button>
            <div className="sb-meta">v1.0 · SIH 2026 · PS SIH26125</div>
          </div>
        </aside>
        <main className="main-content">
          {State.ledgerNotice && <div className="alert alert-warning" style={{ marginBottom: 14 }}>⚠ {State.ledgerNotice}</div>}
          {LEDGER.Chain.halted && <div className="alert alert-danger" style={{ marginBottom: 14 }}>⛔ {LEDGER.Chain.halted}</div>}
          <div id="remoteAheadSlot">
            {State.remoteAhead && (
              <div className="alert alert-info" style={{ marginBottom: 14 }}>
                🔄 Other users have made changes. <button className="btn btn-sm btn-outline" style={{ marginLeft: 8 }} onClick={() => resyncFromRemote('poll')}>Refresh now</button>
              </div>
            )}
          </div>
          <ActivePage page={State.currentPage} />
          <footer className="site-footer">
            <span>Bharat Electronics Limited</span> &nbsp;|&nbsp; Secure Digital Asset &amp; Identity Portal &nbsp;|&nbsp; SIH 2026 – PS SIH26125 &nbsp;|&nbsp; Authorised Access Only
          </footer>
        </main>
      </div>
      {State.modal && <Modal />}
    </div>
  );
}
