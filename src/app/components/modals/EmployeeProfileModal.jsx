import { useState } from 'react';
import { useApp } from '../../store.jsx';
import {
  currentUser, closeModal, openModal, canViewIdentity, hasPerm, assetAccessFor,
  effectivePermissions, canUpload, roleBadgeClass, fmtDate, maskAadhaar, maskPan,
  reportsToLabel, eligibleManagersFor, initialsOf, nameOfDid, tokenLabel, fmtTs,
  IDENTITY_PERMISSIONS, orgUnitGroups, keystoreOf, didKeyOf, demoAccountFor,
  hasLocalKeystore, emailOf, ORG_DID, LEDGER, changePassword,
  activateUser, suspendUser, issueCredentials, savePersonalInfo, saveProfileAccess,
  resetPermOverride, refresh,
} from '../../core.js';
import { AccessBadge, ClassBadge, BlockChip } from '../Badges.jsx';

const TABS = [
  { id: 'personal', label: 'Personal Info' },
  { id: 'access', label: 'Access Control' },
  { id: 'holdings', label: 'Asset Access' },
  { id: 'did', label: 'DID Document' },
];
const LEVEL_ORDER = { Owner: 0, Editor: 1, Viewer: 2 };

function IdentityStatusActions({ u, viewer }) {
  if (!hasPerm(viewer, 'MANAGE_IDENTITY') || u.status === 'deactivated' || u.id === viewer.id) return null;
  const out = [];
  if (u.status === 'pending' && u.registeredBy === viewer.did) out.push(<button key="a" className="btn btn-sm btn-outline" disabled title="Maker-checker: another administrator must activate an identity you registered">Activate</button>);
  else if (u.status === 'pending' || u.status === 'suspended') out.push(<button key="a" className="btn btn-sm btn-outline" onClick={() => activateUser(u)}>Activate</button>);
  if (u.status === 'active') out.push(<button key="s" className="btn btn-sm btn-outline" title="Temporarily block sign-in and signing" onClick={() => suspendUser(u)}>Suspend</button>);
  out.push(<button key="d" className="btn btn-sm btn-outline btn-danger-outline" title="Leaver: permanently deactivate this DID" onClick={() => openModal({ type: 'deactivate-identity', uid: u.id })}>Deactivate</button>);
  return <>{out}</>;
}

function PersonalPane({ user, mgr, viewer, canEditAccess }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user.name);
  const [desig, setDesig] = useState(user.designation);
  const [unit, setUnit] = useState(user.orgUnit);
  const [aadhaar, setAadhaar] = useState(user.aadhaar || '');
  const [pan, setPan] = useState(user.pan || '');
  const [reportsTo, setReportsTo] = useState(mgr ? reportsToLabel(mgr) : '');
  const managers = eligibleManagersFor(user);

  if (!editing) {
    return (
      <>
        <div className="identity-detail-grid">
          <div><strong>DID:</strong> <span className="mono">{user.did}</span></div>
          <div><strong>Manager:</strong> {mgr ? `${mgr.name} — ${mgr.designation}` : 'Apex — no reporting manager'}</div>
          <div><strong>Aadhaar:</strong> <span className="mono">{maskAadhaar(user.aadhaar)}</span></div>
          <div><strong>PAN:</strong> <span className="mono">{maskPan(user.pan)}</span></div>
          <div><strong>Joined:</strong> {fmtDate(user.joined)}</div>
          <div><strong>Status:</strong> {user.status !== 'active' ? <span className={`badge badge-${user.status}`}>{user.status}</span> : <span className="badge badge-approved">Active</span>}</div>
        </div>
        {canEditAccess && <div className="form-actions" style={{ marginTop: 18 }}><button className="btn btn-outline btn-sm" onClick={() => setEditing(true)}>✎ Edit Full Record</button></div>}
      </>
    );
  }

  function save() {
    const ok = savePersonalInfo(user, { name: name.trim(), desig: desig.trim(), unit, aadhaarRaw: aadhaar.replace(/\s+/g, ''), panRaw: pan.trim().toUpperCase(), reportsToTyped: reportsTo.trim() });
    if (ok) setEditing(false);
  }

  return (
    <>
      <div className="form-row">
        <div className="form-group"><label>Full Name</label><input type="text" value={name} onChange={e => setName(e.target.value)} /></div>
        <div className="form-group"><label>Designation</label><input type="text" value={desig} onChange={e => setDesig(e.target.value)} /></div>
      </div>
      <div className="form-row">
        <div className="form-group"><label>Org Unit / Division</label>
          <select value={unit} onChange={e => setUnit(e.target.value)}>
            {orgUnitGroups().map(([label, list]) => <optgroup key={label} label={label}>{list.map(o => <option key={o} value={o}>{o}</option>)}</optgroup>)}
          </select>
        </div>
        <div className="form-group"><label>Joined</label><input type="text" value={fmtDate(user.joined)} disabled /></div>
      </div>
      <div className="form-row">
        <div className="form-group"><label>Aadhaar Number</label><input type="text" placeholder="XXXX XXXX XXXX" maxLength={14} value={aadhaar} onChange={e => setAadhaar(e.target.value)} /></div>
        <div className="form-group"><label>PAN Number</label><input type="text" placeholder="ABCDE1234F" maxLength={10} style={{ textTransform: 'uppercase' }} value={pan} onChange={e => setPan(e.target.value)} /></div>
      </div>
      <div className="form-row" style={{ gridTemplateColumns: '1fr' }}>
        <div className="form-group">
          <label>Reports To — search by name or alias</label>
          <input type="text" list="profileReportsToOptions" autoComplete="off" value={reportsTo} onChange={e => setReportsTo(e.target.value)} placeholder={!mgr ? 'Apex — no manager' : undefined} />
          <datalist id="profileReportsToOptions">{managers.map(u => <option key={u.id} value={reportsToLabel(u)} />)}</datalist>
        </div>
      </div>
      <div className="mono" style={{ fontSize: 11, color: '#999', marginBottom: 14 }}>DID: {user.did} (not editable)</div>
      <div className="form-actions">
        <button className="btn btn-primary btn-sm" onClick={save}>Save Changes</button>
        <button className="btn btn-outline btn-sm" onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </>
  );
}

function AccessPane({ user, viewer, isSelf, DB }) {
  const canEditAccess = hasPerm(viewer, 'MANAGE_IDENTITY');
  const canEditRole = hasPerm(viewer, 'MANAGE_ROLE');
  const userEffPerms = effectivePermissions(user);
  const [role, setRole] = useState(user.role);
  const [status, setStatus] = useState(user.status);
  const [perms, setPerms] = useState(userEffPerms);
  const [credEmail, setCredEmail] = useState(emailOf(user) || '');
  const [busy, setBusy] = useState(false);

  if (!canEditAccess) {
    return (
      <>
        <div className="identity-detail-grid">
          <div><strong>Portal Role:</strong> <span className={`badge ${roleBadgeClass(user.role)}`}>{user.role}</span></div>
          <div><strong>Asset Creation:</strong> {canUpload(user) ? '✅ Yes' : '⛔ No'}</div>
        </div>
        <div className="aac-subhead" style={{ marginTop: 14 }}><span>Permissions{user.permOverrides ? <span className="badge badge-pending"> CUSTOM</span> : ''}</span></div>
        <div className="perm-badges">
          {userEffPerms.length ? userEffPerms.map(p => <span key={p} className="badge badge-active">{p}</span>) : <span className="text-muted" style={{ fontSize: 12 }}>No permissions on record</span>}
        </div>
      </>
    );
  }

  function togglePerm(id) { setPerms(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]); }
  function save() { saveProfileAccess(user, viewer, { role, status, checkedPerms: perms }); }
  async function issue() { setBusy(true); await issueCredentials(user, credEmail); setBusy(false); }

  return (
    <>
      {isSelf && <div className="alert alert-info" style={{ marginBottom: 14 }}>ℹ &nbsp; This is your own identity — role, status and permissions can only be changed by another administrator.</div>}
      <div className="form-row">
        <div className="form-group"><label>Portal Role</label>
          <select value={role} disabled={isSelf || !canEditRole} onChange={e => setRole(e.target.value)}>
            {DB.roleDefinitions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <div className="form-group"><label>Status</label>
          <select value={status} disabled={isSelf} onChange={e => setStatus(e.target.value)}>
            {['active', 'pending', 'suspended'].map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
        </div>
      </div>
      <div className="aac-subhead" style={{ marginTop: 6 }}>
        <span>Specific Permissions{user.permOverrides ? <span className="badge badge-pending" title="Custom permissions — no longer tied to the role default"> CUSTOM</span> : ''}</span>
        {user.permOverrides && !isSelf && <button className="btn btn-sm btn-outline" onClick={() => resetPermOverride(user)}>Reset to Role Default</button>}
      </div>
      <div className="perm-checklist">
        {IDENTITY_PERMISSIONS.map(p => (
          <label key={p.id} className="perm-check-item">
            <input type="checkbox" className="pf-perm-cb" checked={perms.includes(p.id)} disabled={isSelf} onChange={() => togglePerm(p.id)} />
            <span><strong>{p.label}</strong><br /><span className="perm-check-desc">{p.desc}</span></span>
          </label>
        ))}
      </div>
      <div className="form-actions"><button className="btn btn-primary btn-sm" onClick={save}>Save Access Changes</button></div>
      {!isSelf && user.status !== 'deactivated' && (
        <>
          <div className="aac-subhead" style={{ marginTop: 18 }}><span>Sign-in credentials</span><span className="text-muted">{keystoreOf(user) ? `Key ${((user.didDoc && user.didDoc.authentication) || [''])[0].split('#').pop()} active` : 'No sign-in credentials issued'}</span></div>
          <div className="form-row" style={{ alignItems: 'flex-end' }}>
            <div className="form-group"><label>Sign-in email</label><input type="email" value={credEmail} onChange={e => setCredEmail(e.target.value)} placeholder="firstname.lastname@bel.in" /></div>
            <div className="form-group"><button className="btn btn-sm btn-outline" disabled={busy} onClick={issue}>{keystoreOf(user) ? '↻ Reset credentials (new key)' : '🔑 Issue credentials'}</button></div>
          </div>
          <p className="text-muted" style={{ fontSize: 11.5 }}>Rotates the DID key: a new key is added to the DID Document and the old one is revoked (past signatures stay valid). The holder gets a one-time temporary password.</p>
        </>
      )}
    </>
  );
}

function HoldingsPane({ user, DB }) {
  const holdings = DB.assets.map(a => ({ a, acc: assetAccessFor(user, a) })).filter(x => x.acc)
    .sort((x, y) => LEVEL_ORDER[x.acc.level] - LEVEL_ORDER[y.acc.level] || x.a.name.localeCompare(y.a.name));
  if (holdings.length === 0) return <div className="no-data">{user.name} has no access to any asset</div>;
  const levelCount = lv => holdings.filter(x => x.acc.level === lv).length;
  return (
    <>
      <div className="chip-row" style={{ marginBottom: 12 }}>
        {['Owner', 'Editor', 'Viewer'].map(lv => <span key={lv} className="filter-chip" style={{ cursor: 'default' }}><AccessBadge level={lv} /> <span>{levelCount(lv)}</span></span>)}
      </div>
      <table className="crdash-table registry-table">
        <thead><tr><th>Asset</th><th>Access</th><th>How</th><th>Owner</th><th>NFT</th></tr></thead>
        <tbody>
          {holdings.map(({ a, acc }) => (
            <tr key={a.id} className="crdash-row" title={`Open ${a.name}`} onClick={() => openModal({ type: 'asset-profile', aid: a.id })}>
              <td><a className="crdash-link">{a.name}</a> <ClassBadge asset={a} />{a.status === 'retired' && <span className="badge badge-retired"> Retired</span>}<div className="crdash-muted">{a.id} · {a.orgUnit}</div></td>
              <td><AccessBadge level={acc.level} /></td>
              <td className="crdash-muted">{acc.level === 'Owner' ? 'Owns the asset' : acc.basis}</td>
              <td>{acc.level === 'Owner' ? '—' : nameOfDid(a.owner)}</td>
              <td>{a.tokenId ? <span className="rev-chip">{tokenLabel(a)}</span> : <span className="crdash-muted">not minted</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function DidDocPane({ user, viewer }) {
  const key = didKeyOf(user);
  const events = LEDGER.Chain.txs().filter(({ tx }) => (tx.contract === 'Identity' || tx.contract === 'AccessControl') && tx.args
    && ((tx.args.user && tx.args.user.did === user.did) || tx.args.userId === user.id));
  const ks = keystoreOf(user);
  const where = !ks ? 'No sign-in credentials issued' : demoAccountFor(user.did) && !user.keystore && !hasLocalKeystore(user.did) ? 'Encrypted keystore (demo account, fixed demo password)' : "Encrypted keystore — unlocked only by the holder's password";
  const [cur, setCur] = useState(''); const [next, setNext] = useState(''); const [conf, setConf] = useState('');

  return (
    <>
      <div className="identity-detail-grid" style={{ marginBottom: 14 }}>
        <div><strong>DID:</strong> <span className="mono">{user.did}</span></div>
        <div><strong>Controller:</strong> <span className="mono">{ORG_DID}</span> (BEL)</div>
        <div><strong>Verification key:</strong> <span className="mono">{user.did}#key-1</span> · ECDSA P-256</div>
        <div><strong>Private key:</strong> {where}</div>
        {user.piiCommitment && <div style={{ gridColumn: '1/-1' }}><strong>PII commitment:</strong> <span className="mono" style={{ fontSize: 11 }}>{user.piiCommitment}</span> <span className="text-muted">(salted SHA-256 of Aadhaar + PAN — the numbers never go on-chain)</span></div>}
      </div>
      {emailOf(user) && <div style={{ fontSize: 12.5, marginBottom: 12 }}><strong>Sign-in email:</strong> <span className="mono">{emailOf(user)}</span></div>}
      {viewer && viewer.id === user.id && ks && !demoAccountFor(user.did) && (
        <>
          <div className="aac-subhead"><span>Change password</span></div>
          <div className="form-row" style={{ marginBottom: 6 }}>
            <div className="form-group"><label>Current</label><input type="password" autoComplete="current-password" value={cur} onChange={e => setCur(e.target.value)} /></div>
            <div className="form-group"><label>New</label><input type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} /></div>
            <div className="form-group"><label>Confirm</label><input type="password" autoComplete="new-password" value={conf} onChange={e => setConf(e.target.value)} /></div>
          </div>
          <div className="form-actions" style={{ marginBottom: 14 }}><button className="btn btn-sm btn-primary" onClick={() => changePassword(user, cur, next, conf)}>Re-encrypt my key</button></div>
        </>
      )}
      <div className="aac-subhead"><span>Ledger history of this identity</span></div>
      <table className="crdash-table" style={{ marginBottom: 14 }}>
        <thead><tr><th>Block</th><th>Event</th><th>Signed by</th><th>When</th></tr></thead>
        <tbody>{events.map(({ tx, block }, i) => <tr key={i}><td><BlockChip height={block.height} /></td><td><span className="badge badge-active">{tx.type}</span> <span className="crdash-muted">{tx.detail}</span></td><td>{nameOfDid(tx.actor)}</td><td className="crdash-muted" style={{ whiteSpace: 'nowrap' }}>{fmtTs(tx.ts)}</td></tr>)}</tbody>
      </table>
      <div className="aac-subhead"><span>DID Document</span></div>
      <pre className="chain-json">{key ? JSON.stringify(user.didDoc, null, 2) : 'No DID Document on the ledger'}</pre>
    </>
  );
}

// Real JSX port of app.js's renderModal() 'employee-profile' branch (4-tab slide-up).
export default function EmployeeProfileModal({ m }) {
  const { DB } = useApp();
  const viewer = currentUser();
  const user = DB.users.find(u => u.id === m.uid);
  const [tab, setTab] = useState('personal');
  if (!user) return null;

  if (!canViewIdentity(viewer, user)) {
    const mgr = DB.users.find(u => u.id === user.reportsTo);
    return (
      <div className="slideup-backdrop" onClick={closeModal}>
        <div className="slideup-panel" onClick={e => e.stopPropagation()}>
          <div className="slideup-header">
            <div className="slideup-user"><div className="avatar" style={{ width: 44, height: 44, fontSize: 16 }}>{initialsOf(user.name)}</div><div><div className="slideup-name">{user.name}</div><div className="slideup-desig">{user.designation} &nbsp;·&nbsp; {user.orgUnit}</div></div></div>
            <button className="close-btn" onClick={closeModal}>×</button>
          </div>
          <div className="slideup-body">
            <div className="identity-detail-grid">
              <div><strong>DID:</strong> <span className="mono">{user.did}</span></div>
              <div><strong>Reports to:</strong> {mgr ? `${mgr.name} — ${mgr.designation}` : '—'}</div>
              <div><strong>Org unit:</strong> {user.orgUnit}</div>
              <div><strong>Status:</strong> {user.status === 'active' ? 'Active' : <span className={`badge badge-${user.status}`}>{user.status}</span>}</div>
            </div>
            <p className="text-muted" style={{ marginTop: 14 }}>🔒 Personal details, access rights, holdings and ledger history are visible only to {user.name}, identity administrators, organisation-wide auditors and their management chain.</p>
          </div>
        </div>
      </div>
    );
  }

  const mgr = DB.users.find(u => u.id === user.reportsTo);
  const isSelf = viewer && viewer.id === user.id;
  const canEditAccess = hasPerm(viewer, 'MANAGE_IDENTITY');
  const holdingsCount = DB.assets.filter(a => assetAccessFor(user, a)).length;

  const panes = {
    personal: <PersonalPane user={user} mgr={mgr} viewer={viewer} canEditAccess={canEditAccess} />,
    access: <AccessPane user={user} viewer={viewer} isSelf={isSelf} DB={DB} />,
    holdings: <HoldingsPane user={user} DB={DB} />,
    did: <DidDocPane user={user} viewer={viewer} />,
  };

  return (
    <div className="slideup-backdrop" onClick={closeModal}>
      <div className="slideup-panel" onClick={e => e.stopPropagation()}>
        <div className="slideup-header">
          <div className="slideup-user">
            <div className="avatar" style={{ width: 44, height: 44, fontSize: 16 }}>{initialsOf(user.name)}</div>
            <div>
              <div className="slideup-name">{user.name}</div>
              <div className="slideup-desig">{user.designation} &nbsp;·&nbsp; {user.orgUnit}{user.status !== 'active' && <> &nbsp;·&nbsp; <span className={`badge badge-${user.status}`}>{user.status === 'pending' ? 'Pending activation' : user.status}</span></>}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <IdentityStatusActions u={user} viewer={viewer} />
            <button className="close-btn" onClick={closeModal}>×</button>
          </div>
        </div>
        <div className="profile-tabs">
          {TABS.map(t => <button key={t.id} className={`profile-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>{t.id === 'holdings' ? `Asset Access (${holdingsCount})` : t.label}</button>)}
        </div>
        <div className="slideup-body">{panes[tab]}</div>
      </div>
    </div>
  );
}
