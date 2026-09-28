import { useState } from 'react';
import { useApp } from '../../store.jsx';
import {
  currentUser, closeModal, scopeOf, ORG_UNITS, CONTRACTS, orgUnitGroups,
  sha256Hex, fmtSize, uploadBlobToStorage, guard, createAsset, createReview,
  addRevision, latestRev, reviewAsset, openReviewByViewer, toast, refresh,
  openModal, cancelReview,
} from '../../core.js';

function OrgUnitSelect({ value, onChange, only }) {
  const groups = orgUnitGroups(only);
  return (
    <select value={value} onChange={e => onChange(e.target.value)}>
      {groups.map(([label, list]) => (
        <optgroup key={label} label={label}>
          {list.map(o => <option key={o} value={o}>{o}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

// Real JSX port of app.js's renderReviewModal() for the 'new-asset' modal type.
export function NewAssetModal() {
  const viewer = currentUser();
  const units = scopeOf(viewer) === 'HQ' ? ORG_UNITS : [viewer.orgUnit];
  const [name, setName] = useState('');
  const [unit, setUnit] = useState(viewer.orgUnit);
  const [classification, setClassification] = useState('Restricted');
  const [file, setFile] = useState(null);
  const [approvals, setApprovals] = useState(1);
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name.trim()) { toast('Give the asset a name', 'error'); return; }
    setBusy(true);
    const f = file || new File([`Demo placeholder asset generated ${new Date().toISOString()}`], `demo-asset-${Date.now()}.txt`, { type: 'text/plain' });
    const hash = await sha256Hex(f);
    const blob = { hash, size: fmtSize(f.size), fileName: f.name, storagePath: await uploadBlobToStorage(f, hash) };
    const a = guard(() => createAsset({ name: name.trim(), orgUnit: unit, desc, classification, approvalsRequired: Number(approvals), blob, author: viewer }));
    setBusy(false);
    if (!a) return;
    toast(`✅ ${a.name} created as v1`);
    closeModal();
  }

  return (
    <div className="modal-backdrop" onClick={closeModal}>
      <div className="modal" style={{ width: 560 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header"><h3>New Asset</h3><button className="close-btn" onClick={closeModal}>×</button></div>
        <div className="modal-body">
          <div className="alert alert-info" style={{ marginBottom: 12 }}>ℹ &nbsp; The asset is created straight away as v1, held by you. An authorised administrator then mints its NFT. Later updates go through a review that your teammates approve.</div>
          <div className="form-row">
            <div className="form-group"><label>Asset Name</label><input type="text" placeholder="e.g. Radar Module Specs v3.pdf" value={name} onChange={e => setName(e.target.value)} /></div>
            <div className="form-group"><label>Org Unit</label><OrgUnitSelect value={unit} onChange={setUnit} only={units} /></div>
            <div className="form-group"><label>Classification</label>
              <select value={classification} onChange={e => setClassification(e.target.value)}>{CONTRACTS.CLASSIFICATIONS.map(c => <option key={c}>{c}</option>)}</select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>File</label><input type="file" onChange={e => setFile(e.target.files[0] || null)} /></div>
            <div className="form-group"><label>Approvals needed for updates</label>
              <select value={approvals} onChange={e => setApprovals(e.target.value)}>
                {[0, 1, 2, 3].map(n => <option key={n} value={n}>{n === 0 ? '0 — author merges directly' : `${n} peer approval${n === 1 ? '' : 's'}`}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group"><label>Description</label><textarea rows={3} placeholder="What is this asset?" value={desc} onChange={e => setDesc(e.target.value)} /></div>
          <p className="text-muted" style={{ fontSize: 12 }}>The file's SHA-256 is computed in your browser and recorded on the ledger as the asset's content hash.</p>
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={closeModal}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? 'Creating…' : '⬆ Create Asset'}</button>
        </div>
      </div>
    </div>
  );
}

// Real JSX port of the 'start-review' modal type (upload new version / new revision).
export function StartReviewModal({ m }) {
  const viewer = currentUser();
  const { DB } = useApp();
  const targetR = m.rid ? DB.reviews.find(x => x.id === m.rid) : null;
  const asset = targetR ? reviewAsset(targetR) : DB.assets.find(a => a.id === m.aid);
  const existing = targetR || (asset ? openReviewByViewer(asset, viewer) : null);
  const name = targetR ? targetR.assetName : asset ? asset.name : '';
  const [file, setFile] = useState(null);
  const [approvalsReq, setApprovalsReq] = useState(asset ? (asset.approvalsRequired ?? 1) : 1);
  const [classification, setClassification] = useState(asset ? (asset.classification || 'Unclassified') : 'Unclassified');
  const [busy, setBusy] = useState(false);

  let note;
  if (existing) {
    const rev = latestRev(existing);
    note = rev.publishedAt
      ? <>This adds <strong>revision {rev.n + 1}</strong> to your open review {existing.id} as a draft. Approvals given on revision {rev.n} won't carry over — publish it to collect fresh approvals.</>
      : <>Revision {rev.n} of {existing.id} isn't published yet, so this file <strong>replaces</strong> it.</>;
  } else {
    note = <>This opens a draft review that only you can see until you publish it. Once it has the approvals below, you merge it and the asset becomes v{(asset ? asset.version || 1 : 1) + 1}.</>;
  }

  async function submit() {
    setBusy(true);
    const f = file || new File([`Demo placeholder revision generated ${new Date().toISOString()}`], `demo-revision-${Date.now()}.txt`, { type: 'text/plain' });
    const hash = await sha256Hex(f);
    const blob = { hash, size: fmtSize(f.size), fileName: f.name, storagePath: await uploadBlobToStorage(f, hash) };
    let r;
    if (existing) {
      if (!guard(() => addRevision(existing, blob, viewer))) { setBusy(false); return; }
      r = existing;
    } else {
      r = asset && guard(() => createReview({ asset, blob, author: viewer, classification, approvalsRequired: Number(approvalsReq) }));
    }
    setBusy(false);
    if (!r) return;
    openModal({ type: 'review-detail', rid: r.id });
    toast(`Revision ${latestRev(r).n} saved as a draft — publish it when ready`);
  }

  return (
    <div className="modal-backdrop" onClick={closeModal}>
      <div className="modal" style={{ width: 540 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header"><h3>Upload New Version — {name}</h3><button className="close-btn" onClick={closeModal}>×</button></div>
        <div className="modal-body">
          <div className="form-group"><label>File</label><input type="file" onChange={e => setFile(e.target.files[0] || null)} /></div>
          {!existing && asset && (
            <div className="form-row">
              <div className="form-group">
                <label>Approvals needed</label>
                <select value={approvalsReq} onChange={e => setApprovalsReq(e.target.value)}>
                  {[0, 1, 2, 3].map(k => <option key={k} value={k}>{k}{k === (asset.approvalsRequired ?? 1) ? ' (asset default)' : ''}</option>)}
                </select>
                <span className="text-muted" style={{ fontSize: 11 }}>From teammates in {asset.orgUnit} or reviewers you add.</span>
              </div>
              <div className="form-group">
                <label>Classification</label>
                <select value={classification} onChange={e => setClassification(e.target.value)}>{CONTRACTS.CLASSIFICATIONS.map(c => <option key={c}>{c}</option>)}</select>
                <span className="text-muted" style={{ fontSize: 11 }}>A change applies when the update is merged.</span>
              </div>
            </div>
          )}
          <p className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>{note}</p>
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={closeModal}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? 'Saving…' : existing ? 'Upload Revision' : 'Create Draft Review'}</button>
        </div>
      </div>
    </div>
  );
}

// Real JSX port of the 'cancel-review' modal type.
export function CancelReviewModal({ m }) {
  const { DB } = useApp();
  const viewer = currentUser();
  const r = DB.reviews.find(x => x.id === m.rid);
  const [reason, setReason] = useState('');
  if (!r) return null;
  function confirm() {
    if (!guard(() => cancelReview(r, viewer, reason.trim()))) return;
    openModal({ type: 'review-detail', rid: r.id });
    toast('Review marked as canceled', 'warning');
  }
  return (
    <div className="modal-backdrop" onClick={closeModal}>
      <div className="modal" style={{ width: 480 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header"><h3>Mark Review as Canceled</h3><button className="close-btn" onClick={closeModal}>×</button></div>
        <div className="modal-body">
          <p style={{ fontSize: 13, marginBottom: 10 }}>Published reviews can't be deleted — they're closed as canceled and can be reopened later.{r.kind === 'initial' ? ' The submitted asset will be marked as rejected.' : ' The current approved version of the asset stays in place.'}</p>
          <div className="form-group"><label>Reason (optional)</label><textarea rows={3} placeholder="Why is this review being canceled?" value={reason} onChange={e => setReason(e.target.value)} /></div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={closeModal}>Keep Open</button>
          <button className="btn btn-danger" onClick={confirm}>Mark as Canceled</button>
        </div>
      </div>
    </div>
  );
}
