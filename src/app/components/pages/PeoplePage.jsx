import { useState } from 'react';
import { useApp } from '../../store.jsx';
import {
  currentUser, hasPerm, identityFilterRows, peopleSearchText, ROLE_LABELS,
  fmtDate, initialsOf, openModal,
} from '../../core.js';

const FILTER_LABELS = { '': 'All', direct: 'Direct reports', peers: 'Peers', upline: 'Upline', pending: 'Pending activation', inactive: 'Suspended / deactivated' };
const EMPTY_TEXT = {
  direct: 'No one reports to you',
  peers: 'No peers — you report directly to the top of the organisation',
  upline: 'No upline — you are at the top of the reporting chain',
  pending: 'No identities waiting for activation',
  inactive: 'No suspended or deactivated identities',
  '': 'No identities found',
};

function DirAvatar({ u, size = 36 }) {
  return <div className={`avatar dir-av dir-av-${u.role.toLowerCase()}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}>{initialsOf(u.name)}</div>;
}

// Real JSX port of app.js's renderAdminOnboarding() ("People" page).
export default function PeoplePage() {
  useApp();
  const viewer = currentUser();
  const isAdmin = hasPerm(viewer, 'MANAGE_IDENTITY');
  const [filter, setFilter] = useState('');
  const [query, setQuery] = useState('');

  const filterIds = ['', 'direct', 'peers', 'upline', ...(isAdmin ? ['pending', 'inactive'] : [])];
  const rows = identityFilterRows(viewer, filter).slice().sort((a, b) => a.name.localeCompare(b.name));
  const q = query.trim().toLowerCase();
  const visibleRows = rows.filter(u => !q || peopleSearchText(u).includes(q));

  return (
    <>
      <div className="page-header">
        <h2>People</h2>
        <p>Every BEL employee has a decentralised identity (DID) with its own signing key. {isAdmin
          ? <>Administrators register new employees (a <strong>second administrator</strong> activates them), suspend them, deactivate leavers and reset credentials. Every change is signed on the ledger.</>
          : 'Open anyone to see their public card; full records are visible only to them, their management chain, identity administrators and auditors.'}</p>
      </div>
      <div className="registry-toolbar">
        <div className="chip-row">
          {filterIds.map(id => (
            <button key={id || 'all'} className={`filter-chip${filter === id ? ' active' : ''}`} onClick={() => setFilter(id)}>
              {FILTER_LABELS[id]} <span>{identityFilterRows(viewer, id).length}</span>
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="link-btn" onClick={() => openModal({ type: 'full-org-chart' })}>Org chart</button>
          <button className="link-btn" title="What each role can do" onClick={() => openModal({ type: 'roles' })}>Roles</button>
          {isAdmin && <button className="btn btn-sm btn-primary" onClick={() => openModal({ type: 'register-employee' })}>+ Register New Employee</button>}
        </div>
      </div>
      <div className="dir-toolbar">
        <input type="search" className="dir-search" placeholder="Search by name, designation, unit, role or DID…" autoComplete="off" value={query} onChange={e => setQuery(e.target.value)} />
      </div>
      <table className="crdash-table registry-table">
        <thead><tr><th>Person</th><th>DID</th><th>Org unit</th><th>Role</th><th>Status</th><th>Joined</th></tr></thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={6}><div className="no-data">{EMPTY_TEXT[filter]}</div></td></tr>
          ) : visibleRows.map(u => (
            <tr key={u.id} className="crdash-row identity-row" title={`View ${u.name}'s profile`} onClick={() => openModal({ type: 'employee-profile', uid: u.id })}>
              <td><div className="crdash-who"><DirAvatar u={u} size={30} /><div><a className="crdash-link">{u.name}</a>{u.id === viewer.id && <span className="dir-you"> You</span>}<div className="crdash-muted">{u.designation}</div></div></div></td>
              <td className="mono" style={{ fontSize: 11 }}>{u.did}</td>
              <td>{u.orgUnit}</td>
              <td><span className={`dir-role dir-role-${u.role.toLowerCase()}`}>{ROLE_LABELS[u.role] || u.role}</span></td>
              <td>{u.status === 'active' ? <span className="badge badge-approved">Active</span> : <span className={`badge badge-${u.status}`}>{u.status === 'pending' ? 'Pending activation' : u.status}</span>}</td>
              <td className="crdash-muted">{fmtDate(u.joined)}</td>
            </tr>
          ))}
          {rows.length > 0 && visibleRows.length === 0 && (
            <tr><td colSpan={6}><div className="no-data">No one matches “{query}”</div></td></tr>
          )}
        </tbody>
      </table>
    </>
  );
}
