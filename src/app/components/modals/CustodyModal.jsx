import { useState } from 'react';
import { useApp } from '../../store.jsx';
import {
  closeModal, isActive, nameOfDid, tokenLabel, transferPreview, currentUser,
  transferCustody, recoverCustody, retireAsset, justifiedDownload,
} from '../../core.js';
import { ClassBadge } from '../Badges.jsx';
import PersonPicker from '../PersonPicker.jsx';

function TransferPreviewBox({ actor, asset, toDid }) {
  if (!toDid) return <span className="text-muted">Choose the new owner.</span>;
  const p = transferPreview(actor, asset, toDid);
  if (p.errors.length) return <div className="alert alert-danger">⛔ {p.errors.map((e, i) => <span key={i}>{e}<br /></span>)}</div>;
  return <div className="alert alert-info">⇄ {nameOfDid(toDid)} becomes the Owner{asset.tokenId ? ` and holder of ${tokenLabel(asset)}` : ''}. You keep no access unless they add you back. Existing Editors and Viewers stay.</div>;
}

// Real JSX port of app.js's renderCustodyModal() for 'download-justify' / 'retire-nft'.
export function JustifyModal({ m }) {
  const { DB } = useApp();
  const asset = DB.assets.find(a => a.id === m.aid);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  if (!asset) return null;
  const retire = m.type === 'retire-nft';

  async function confirm() {
    setBusy(true);
    if (retire) retireAsset(asset, text.trim());
    else await justifiedDownload(asset, text.trim());
    setBusy(false);
  }

  return (
    <div className="modal-backdrop" onClick={closeModal}>
      <div className="modal" style={{ width: 500 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header"><h3>{retire ? `Retire ${tokenLabel(asset)}` : <>Download <ClassBadge asset={asset} /> asset</>}</h3><button className="close-btn" onClick={closeModal}>×</button></div>
        <div className="modal-body">
          <p style={{ fontSize: 13, marginBottom: 10 }}>{asset.name} · {asset.id}</p>
          <p className="text-muted" style={{ fontSize: 12, marginBottom: 10 }}>{retire ? 'Retirement is permanent and recorded on the ledger. The token and its full history stay verifiable.' : 'Secret assets can be downloaded only with a stated need-to-know justification, recorded on the ledger with your signature.'}</p>
          <div className="form-group">
            <label>{retire ? 'Reason' : 'Justification'} <span style={{ color: '#c0392b' }}>*</span></label>
            <textarea rows={3} placeholder={retire ? 'e.g. Superseded by Rev-5; design frozen' : 'e.g. Required for field-trial configuration review, project RDR-7'} value={text} onChange={e => setText(e.target.value)} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={closeModal}>Cancel</button>
          <button className={`btn ${retire ? 'btn-danger' : 'btn-primary'}`} disabled={busy || !text.trim()} onClick={confirm}>{retire ? 'Retire permanently' : 'Record & download'}</button>
        </div>
      </div>
    </div>
  );
}

// Real JSX port of app.js's renderCustodyModal() for 'transfer-custody' / 'recover-custody'.
export function TransferModal({ m }) {
  const { DB } = useApp();
  const viewer = currentUser();
  const asset = DB.assets.find(a => a.id === m.aid);
  const [toDid, setToDid] = useState('');
  const [reason, setReason] = useState('');
  if (!asset) return null;
  const recover = m.type === 'recover-custody';
  const candidates = DB.users.filter(u => isActive(u) && u.did !== asset.owner)
    .sort((a, b) => (a.orgUnit === asset.orgUnit ? 0 : 1) - (b.orgUnit === asset.orgUnit ? 0 : 1) || a.name.localeCompare(b.name));

  function confirm() {
    if (recover) recoverCustody(asset, toDid, reason.trim());
    else transferCustody(asset, toDid, reason.trim());
  }

  return (
    <div className="modal-backdrop" onClick={closeModal}>
      <div className="modal" style={{ width: 560 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header"><h3>{recover ? 'Transfer — owner inactive (admin override)' : 'Transfer Ownership'} — {asset.name}</h3><button className="close-btn" onClick={closeModal}>×</button></div>
        <div className="modal-body">
          <p style={{ fontSize: 13, marginBottom: 12 }}>{asset.name} · current owner <strong>{nameOfDid(asset.owner)}</strong>{recover ? ` (${(DB.users.find(u => u.did === asset.owner) || {}).status || 'unknown'})` : ''}</p>
          <div className="form-group"><label>New owner</label>
            <PersonPicker people={candidates} placeholder="Search by name, designation, unit or DID…" onChange={setToDid} />
          </div>
          <div className="form-group">
            <label>Reason{recover ? <span style={{ color: '#c0392b' }}> *</span> : ' (optional)'}</label>
            <textarea rows={2} placeholder={recover ? 'e.g. Owner deactivated — handing over to the unit head' : 'e.g. Project hand-over'} value={reason} onChange={e => setReason(e.target.value)} />
          </div>
          <div style={{ marginTop: 8 }}>
            {recover ? <span className="text-muted">Recovery is recorded on the ledger as a forced reassignment, signed by you.</span> : <TransferPreviewBox actor={viewer} asset={asset} toDid={toDid} />}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={closeModal}>Cancel</button>
          <button className="btn btn-primary" disabled={recover && !reason.trim()} onClick={confirm}>{recover ? 'Transfer as administrator' : 'Transfer'}</button>
        </div>
      </div>
    </div>
  );
}
