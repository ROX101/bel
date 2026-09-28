import { useState } from 'react';
import { useApp } from '../../store.jsx';
import { closeModal, eligibleManagersFor, reportsToLabel, orgUnitGroups, registerEmployee } from '../../core.js';

// Real JSX port of app.js's renderModal() 'register-employee' branch.
export default function RegisterEmployeeModal() {
  const { DB } = useApp();
  const managers = eligibleManagersFor(null);
  const [name, setName] = useState('');
  const [desig, setDesig] = useState('');
  const [unit, setUnit] = useState('R&D Division');
  const [role, setRole] = useState('USER');
  const [email, setEmail] = useState('');
  const [aadhaar, setAadhaar] = useState('');
  const [pan, setPan] = useState('');
  const [reportsTo, setReportsTo] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const did = await registerEmployee({ name: name.trim(), desig: desig.trim(), unit, role, aadhaar, pan, reportsToTyped: reportsTo.trim(), email });
    setBusy(false);
    if (did) closeModal();
  }

  return (
    <div className="modal-backdrop" onClick={closeModal}>
      <div className="modal" style={{ width: 600 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header"><h3>Register New Employee</h3><button className="close-btn" onClick={closeModal}>×</button></div>
        <div className="modal-body">
          <div className="form-row">
            <div className="form-group"><label>Full Name</label><input type="text" placeholder="e.g. Ramesh Gupta" value={name} onChange={e => setName(e.target.value)} /></div>
            <div className="form-group"><label>Designation</label><input type="text" placeholder="e.g. Junior Engineer" value={desig} onChange={e => setDesig(e.target.value)} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Org Unit / Division</label>
              <select value={unit} onChange={e => setUnit(e.target.value)}>
                {orgUnitGroups().map(([label, list]) => <optgroup key={label} label={label}>{list.map(o => <option key={o} value={o}>{o}</option>)}</optgroup>)}
              </select>
            </div>
            <div className="form-group"><label>Role</label>
              <select value={role} onChange={e => setRole(e.target.value)}>
                {DB.roleDefinitions.filter(r => r.scope !== 'HQ').map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row" style={{ gridTemplateColumns: '1fr' }}>
            <div className="form-group"><label>Sign-in Email</label><input type="email" placeholder="firstname.lastname@bel.in" value={email} onChange={e => setEmail(e.target.value)} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Aadhaar Number</label><input type="text" placeholder="XXXX XXXX XXXX" maxLength={14} value={aadhaar} onChange={e => setAadhaar(e.target.value)} /></div>
            <div className="form-group"><label>PAN Number</label><input type="text" placeholder="ABCDE1234F" maxLength={10} style={{ textTransform: 'uppercase' }} value={pan} onChange={e => setPan(e.target.value)} /></div>
          </div>
          <div className="form-row" style={{ gridTemplateColumns: '1fr' }}>
            <div className="form-group">
              <label>Reports To — search by name or alias</label>
              <input type="text" list="reportsToOptions" placeholder="e.g. Priya Sharma or mgr001@bel.in" autoComplete="off" value={reportsTo} onChange={e => setReportsTo(e.target.value)} />
              <datalist id="reportsToOptions">{managers.map(u => <option key={u.id} value={reportsToLabel(u)} />)}</datalist>
              <span style={{ fontSize: 11, color: '#888' }}>Type a name or alias (e.g. <span className="mono">mgr001@bel.in</span>) and pick a suggestion.</span>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={closeModal}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? 'Generating…' : 'Generate DID & Onboard'}</button>
        </div>
      </div>
    </div>
  );
}
