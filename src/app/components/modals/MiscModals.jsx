import { useState } from 'react';
import { useApp } from '../../store.jsx';
import { closeModal, openModal, leaverImpact, maskAadhaar, maskPan, deactivateUser } from '../../core.js';

// Real JSX port of the 'credentials-issued' modal type.
export function CredentialsIssuedModal({ m }) {
  return (
    <div className="modal-backdrop" onClick={closeModal}>
      <div className="modal" style={{ width: 480 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header"><h3>🔑 Credentials issued — {m.name}</h3><button className="close-btn" onClick={closeModal}>×</button></div>
        <div className="modal-body">
          <div className="alert alert-success" style={{ marginBottom: 12 }}>New DID key <span className="mono">{m.kid}</span> is now the only valid key; the previous one is revoked on the ledger.</div>
          <table style={{ width: '100%', fontSize: 13 }}>
            <tbody>
              <tr><td style={{ padding: 6, color: '#555', fontWeight: 600 }}>Sign-in email</td><td className="mono">{m.email}</td></tr>
              <tr><td style={{ padding: 6, color: '#555', fontWeight: 600 }}>Temporary password</td><td className="mono" style={{ fontSize: 14, fontWeight: 700 }}>{m.password}</td></tr>
            </tbody>
          </table>
          <p className="text-muted" style={{ fontSize: 12, marginTop: 10 }}>Shown only now. The holder must choose their own password at first sign-in.</p>
        </div>
        <div className="modal-footer"><button className="btn btn-primary" onClick={closeModal}>Close</button></div>
      </div>
    </div>
  );
}

// Real JSX port of the 'deactivate-identity' modal type.
export function DeactivateIdentityModal({ m }) {
  const { DB } = useApp();
  const u = DB.users.find(x => x.id === m.uid);
  const [reason, setReason] = useState('');
  if (!u) return null;
  const imp = leaverImpact(u);

  return (
    <div className="modal-backdrop" onClick={closeModal}>
      <div className="modal" style={{ width: 540 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header"><h3>Deactivate {u.name} (leaver)</h3><button className="close-btn" onClick={closeModal}>×</button></div>
        <div className="modal-body">
          <div className="alert alert-danger" style={{ marginBottom: 12 }}>This is permanent. <span className="mono">{u.did}</span> will be marked deactivated in its DID Document and can never sign in or sign again. Past signatures stay valid.</div>
          <ul className="review-checks" style={{ marginBottom: 12 }}>
            <li className="todo">○ {imp.reviews.length} open review{imp.reviews.length === 1 ? '' : 's'} will be canceled</li>
            <li className="todo">○ {imp.grants.length} access grant{imp.grants.length === 1 ? '' : 's'} to this identity will be revoked</li>
            <li className="todo">○ {imp.assets.length} asset{imp.assets.length === 1 ? '' : 's'} held will need custody recovery{imp.assets.length > 0 ? `: ${imp.assets.map(a => a.name).join(', ')}` : ''}</li>
          </ul>
          <div className="form-group"><label>Reason <span style={{ color: '#c0392b' }}>*</span></label><textarea rows={2} placeholder="e.g. Resigned — last working day 30 Sep 2026" value={reason} onChange={e => setReason(e.target.value)} /></div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={closeModal}>Cancel</button>
          <button className="btn btn-danger" disabled={!reason.trim()} onClick={() => deactivateUser(u, reason.trim())}>Deactivate permanently</button>
        </div>
      </div>
    </div>
  );
}

// Real JSX port of the 'onboard-success' modal type.
export function OnboardSuccessModal({ m }) {
  return (
    <div className="modal-backdrop" onClick={closeModal}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header"><h3>✅ Onboarding Successful</h3><button className="close-btn" onClick={closeModal}>×</button></div>
        <div className="modal-body">
          <div className="alert alert-success">New DID registered on the ledger with its own ECDSA P-256 key. Aadhaar and PAN are stored off-chain; the ledger holds only a salted hash commitment.</div>
          <table style={{ width: '100%', fontSize: 13 }}>
            <tbody>
              <tr><td style={{ padding: 6, color: '#555', fontWeight: 600 }}>Name</td><td>{m.name}</td></tr>
              <tr><td style={{ padding: 6, color: '#555', fontWeight: 600 }}>Designation</td><td>{m.desig || '—'}</td></tr>
              <tr><td style={{ padding: 6, color: '#555', fontWeight: 600 }}>Generated DID</td><td className="mono" style={{ fontSize: 12 }}>{m.did}</td></tr>
              <tr><td style={{ padding: 6, color: '#555', fontWeight: 600 }}>Org Unit</td><td>{m.unit}</td></tr>
              <tr><td style={{ padding: 6, color: '#555', fontWeight: 600 }}>Role</td><td>{m.role}</td></tr>
              <tr><td style={{ padding: 6, color: '#555', fontWeight: 600 }}>Reports To</td><td>{m.managerName || '—'}</td></tr>
              <tr><td style={{ padding: 6, color: '#555', fontWeight: 600 }}>Aadhaar</td><td className="mono">{maskAadhaar(m.aadhaar)}</td></tr>
              <tr><td style={{ padding: 6, color: '#555', fontWeight: 600 }}>PAN</td><td className="mono">{maskPan(m.pan)}</td></tr>
              <tr><td style={{ padding: 6, color: '#555', fontWeight: 600 }}>Public key</td><td className="mono" style={{ fontSize: 12 }}>{m.did}#key-1 · fingerprint {m.thumb || '—'}</td></tr>
              <tr><td style={{ padding: 6, color: '#555', fontWeight: 600 }}>Status</td><td><span className="badge badge-pending">Pending Activation</span></td></tr>
              <tr><td style={{ padding: 6, color: '#555', fontWeight: 600 }}>Sign-in email</td><td className="mono">{m.email}</td></tr>
              <tr><td style={{ padding: 6, color: '#555', fontWeight: 600 }}>Temporary password</td><td className="mono" style={{ fontSize: 14, fontWeight: 700 }}>{m.password}</td></tr>
            </tbody>
          </table>
          <p className="text-muted" style={{ fontSize: 12, marginTop: 10 }}>🔑 Give these to the employee — the password is shown only now and is not stored anywhere (it encrypts their DID key). They must choose their own password at first sign-in. <strong>Maker-checker:</strong> a different administrator has to activate this identity.</p>
        </div>
        <div className="modal-footer"><button className="btn btn-primary" onClick={closeModal}>Close</button></div>
      </div>
    </div>
  );
}
