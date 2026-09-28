import { useState } from 'react';
import { useApp } from '../../store.jsx';
import { currentUser, closeModal, hasPerm, effectivePermissions, CONTRACTS, IDENTITY_PERMISSIONS, roleAssetAccess, saveRole } from '../../core.js';

// Real JSX port of app.js's renderRolesModal()/attachRolesEvents().
export default function RolesModal() {
  const { DB } = useApp();
  const viewer = currentUser();
  const canEdit = hasPerm(viewer, 'MANAGE_ROLE');
  const [draftId, setDraftId] = useState(null);
  const [scope, setScope] = useState('');
  const [perms, setPerms] = useState([]);
  const members = id => DB.users.filter(u => u.role === id).length;
  const label = id => (IDENTITY_PERMISSIONS.find(p => p.id === id) || { label: id }).label;

  function startEdit(r) { setDraftId(r.id); setScope(r.scope); setPerms(r.permissions.slice()); }
  function togglePerm(id) { setPerms(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]); }
  function save(r) { if (saveRole(r.id, r.name, scope, perms)) setDraftId(null); }

  return (
    <div className="modal-backdrop" onClick={closeModal}>
      <div className="modal" style={{ width: 980 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header"><h3>Roles</h3><button className="close-btn" onClick={closeModal}>×</button></div>
        <div className="modal-body">
          <p className="text-muted" style={{ margin: '0 0 14px' }}>Each identity has one role. The role sets what they can do across the portal; access to a single asset comes from being its Owner, Editor or Viewer. Role changes are signed AccessControl transactions.</p>
          <div className="role-cards">
            {DB.roleDefinitions.map(r => {
              if (draftId === r.id) {
                return (
                  <div className="role-card editing" key={r.id}>
                    <div className="role-card-head"><span>{r.name}</span><span className="crdash-muted">{members(r.id)} members</span></div>
                    <div className="form-group" style={{ margin: '8px 0' }}>
                      <label>Reach</label>
                      <select value={scope} onChange={e => setScope(e.target.value)}>{Object.entries(CONTRACTS.SCOPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
                    </div>
                    {IDENTITY_PERMISSIONS.map(p => {
                      const held = effectivePermissions(viewer).includes(p.id) || perms.includes(p.id);
                      return (
                        <label key={p.id} className="role-perm-row">
                          <input type="checkbox" className="role-perm-cb" checked={perms.includes(p.id)} disabled={!held} title={held ? undefined : 'You can only grant permissions you hold'} onChange={() => togglePerm(p.id)} /> {p.label}
                        </label>
                      );
                    })}
                    <div className="form-actions" style={{ marginTop: 10 }}>
                      <button className="btn btn-primary btn-xs" onClick={() => save(r)}>Save to ledger</button>
                      <button className="btn btn-outline btn-xs" onClick={() => setDraftId(null)}>Cancel</button>
                    </div>
                  </div>
                );
              }
              return (
                <div className="role-card" key={r.id}>
                  <div className="role-card-head"><span>{r.name}</span><span className="crdash-muted">{members(r.id)} member{members(r.id) === 1 ? '' : 's'}</span></div>
                  <div className="role-card-line"><span>Reach</span>{(CONTRACTS.SCOPES[r.scope] || {}).label || r.scope}</div>
                  <div className="role-card-line"><span>Assets</span>{roleAssetAccess(r)}</div>
                  <div className="role-card-perms">{r.permissions.length ? r.permissions.map(p => <span key={p} className="role-perm">{label(p)}</span>) : <span className="crdash-muted">No portal permissions</span>}</div>
                  {canEdit && draftId === null && <button className="btn btn-xs btn-outline" style={{ marginTop: 10 }} onClick={() => startEdit(r)}>Edit</button>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
