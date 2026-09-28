import { useState } from 'react';
import { useApp } from '../../store.jsx';
import {
  currentUser, closeModal, openModal, assetAccessFor, assetPerm, isActive, initialsOf,
  nameOfDid, fmtDate, today, delegationState, ACCESS_LEVELS, openReviewByViewer,
  hasPerm, canMintAsset, tokenHistory, shortHash, fmtTs, nameOfDid as nameOf, mintAsset,
  requestDownload, CONTRACTS, toast, refresh, grantAssetAccess, revokeAssetAccess,
  retireAsset, setAssetApprovals, nftVerifyFile, sha256Hex, ORG_DID, tokenLabel,
} from '../../core.js';
import { AccessBadge, ClassBadge, BlockChip } from '../Badges.jsx';
import PersonPicker from '../PersonPicker.jsx';

const TABS = [
  { id: 'access', label: 'Access' },
  { id: 'nft', label: 'NFT & History' },
  { id: 'transactions', label: 'Activity' },
];

function PersonRow({ u, did, level, note, delegId, isOwner, asset }) {
  return (
    <tr>
      <td>
        <div className="crdash-who">
          <div className="avatar" style={{ width: 26, height: 26, fontSize: 10 }}>{initialsOf(u ? u.name : '?')}</div>
          <div>
            <div style={{ fontWeight: 600 }}>{u ? u.name : did}{u && !isActive(u) && <span className={`badge badge-${u.status}`}> {u.status}</span>}</div>
            <div className="crdash-muted">{u ? `${u.designation} · ${u.orgUnit}` : ''}</div>
          </div>
        </div>
      </td>
      <td><AccessBadge level={level} /></td>
      <td className="crdash-muted">{note}</td>
      <td style={{ textAlign: 'right' }}>
        {isOwner && delegId && <button className="btn btn-xs btn-outline" title={`Remove ${u ? u.name : did}'s access`} onClick={() => revokeAssetAccess(asset, delegId)}>Remove</button>}
      </td>
    </tr>
  );
}

function AccessPane({ asset, viewer, owner, isOwner, DB }) {
  const [formOpen, setFormOpen] = useState(false);
  const [toDid, setToDid] = useState('');
  const [level, setLevel] = useState('Viewer');
  const [expiry, setExpiry] = useState('');
  const myAccess = assetAccessFor(viewer, asset);

  const grants = DB.delegations.filter(d => d.assetId === asset.id && d.status === 'approved')
    .map(d => ({ d, u: DB.users.find(x => x.did === d.toDID), level: d.access || (d.permissions.includes('UPLOAD_ASSET') ? 'Editor' : 'Viewer'), st: delegationState(d) }))
    .sort((a, b) => (a.level === 'Editor' ? 0 : 1) - (b.level === 'Editor' ? 0 : 1));
  const takenDids = new Set([asset.owner, ...grants.filter(g => g.st === 'approved').map(g => g.d.toDID)]);
  const grantCandidates = DB.users.filter(u => isActive(u) && !takenDids.has(u.did))
    .sort((a, b) => (a.orgUnit === asset.orgUnit ? 0 : 1) - (b.orgUnit === asset.orgUnit ? 0 : 1) || a.name.localeCompare(b.name));
  const maxDate = CONTRACTS.localDate(new Date(Date.now() + CONTRACTS.MAX_GRANT_DAYS * 86400000).toISOString());

  function submit() {
    if (grantAssetAccess(asset, toDid, level, expiry || null)) { setFormOpen(false); setToDid(''); setExpiry(''); }
  }

  return (
    <>
      <div className="access-you">Your access: <AccessBadge level={myAccess.level} /> <span className="text-muted">{myAccess.level === 'Owner' ? '' : `${myAccess.basis} — `}{(ACCESS_LEVELS.find(l => l.id === myAccess.level) || {}).desc || ''}</span></div>
      <div className="aac-subhead" style={{ marginTop: 14 }}><span>People with access</span>
        {isOwner && <button className="btn btn-sm btn-outline" onClick={() => setFormOpen(o => !o)}>{formOpen ? 'Cancel' : '+ Add Editor or Viewer'}</button>}
      </div>
      {isOwner && formOpen && (
        <div className="grant-access-form">
          <div className="form-row">
            <div className="form-group"><label>Person</label><PersonPicker people={grantCandidates} placeholder="Search by name, unit or DID…" onChange={setToDid} /></div>
            <div className="form-group"><label>Access</label>
              <select value={level} onChange={e => setLevel(e.target.value)}>
                <option value="Viewer">Viewer — view &amp; download</option>
                <option value="Editor">Editor — can update the asset</option>
              </select>
            </div>
            <div className="form-group"><label>Until (optional)</label><input type="date" min={today()} max={maxDate} value={expiry} onChange={e => setExpiry(e.target.value)} /></div>
          </div>
          <div className="form-actions"><button className="btn btn-primary btn-sm" disabled={!grantCandidates.length} onClick={submit}>Add</button></div>
        </div>
      )}
      <table className="crdash-table access-table">
        <tbody>
          <PersonRow u={owner} did={asset.owner} level="Owner" note={asset.tokenId ? `Holds ${tokenLabel(asset)}` : 'Holds this asset'} isOwner={isOwner} asset={asset} />
          {grants.map(g => (
            <PersonRow key={g.d.id} u={g.u} did={g.d.toDID} level={g.level}
              note={g.st === 'expired' ? <span className="crdash-status s-rejected">expired {fmtDate(g.d.expiresAt)}</span> : g.d.expiresAt ? `until ${fmtDate(g.d.expiresAt)}` : `added by ${nameOfDid(g.d.fromDID)}`}
              delegId={g.d.id} isOwner={isOwner} asset={asset} />
          ))}
        </tbody>
      </table>
      <p className="text-muted" style={{ marginTop: 10 }}>👁 Administrators and Auditors are Viewers of every asset by default. Only the owner can add Editors and Viewers or transfer ownership; an Administrator can transfer it only if the owner is suspended or deactivated.</p>
    </>
  );
}

function ReviewSettings({ asset, viewer }) {
  const n = asset.approvalsRequired ?? 1;
  const canEdit = asset.status !== 'retired' && asset.owner === viewer.did;
  const [sel, setSel] = useState(n);
  return (
    <>
      <div className="aac-subhead" style={{ marginTop: 16 }}><span>Update reviews</span></div>
      <div className="form-actions" style={{ alignItems: 'center' }}>
        <span style={{ fontSize: 12.5 }}>By default, each update needs</span>
        {canEdit ? (
          <>
            <select value={sel} onChange={e => setSel(Number(e.target.value))}>{[0, 1, 2, 3].map(k => <option key={k} value={k}>{k}</option>)}</select>
            <span style={{ fontSize: 12.5 }}>peer approval(s). The author can change this for their update (0–3).</span>
            <button className="btn btn-sm btn-outline" onClick={() => setAssetApprovals(asset, sel)}>Save</button>
          </>
        ) : <><strong>{n}</strong><span style={{ fontSize: 12.5 }}>peer approval{n === 1 ? '' : 's'} by default. The author can change this for their update (0–3).</span></>}
      </div>
    </>
  );
}

function VersionHistory({ hist }) {
  return (
    <>
      <div className="aac-subhead" style={{ marginTop: 16 }}><span>Version history (on-chain)</span></div>
      <table className="crdash-table">
        <thead><tr><th>Block</th><th>Version</th><th>Event</th><th>Content hash</th><th>Signed by</th><th>Approvals</th></tr></thead>
        <tbody>
          {hist.slice().reverse().map((h, i) => (
            <tr key={i}>
              <td><BlockChip height={h.height} /></td><td>{h.version ? `v${h.version}` : '—'}</td>
              <td>{h.what}<div className="crdash-muted">{fmtTs(h.ts)}</div></td>
              <td className="mono" style={{ fontSize: 10.5 }} title={h.hash}>{shortHash(h.hash)}</td>
              <td>{nameOfDid(h.by)}</td>
              <td>{h.approvers ? (h.approvers.length ? h.approvers.map(d => <span key={d} className="badge badge-approved">{nameOfDid(d)}</span>) : <span className="crdash-muted">none required</span>) : <span className="crdash-muted">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function RetireAction({ asset, viewer }) {
  if (asset.status === 'retired' || !hasPerm(viewer, 'MINT_ASSET')) return null;
  return (
    <div className="form-actions" style={{ marginTop: 14 }}>
      <button className="btn btn-sm btn-outline" onClick={() => openModal({ type: 'retire-nft', aid: asset.id })}>⏹ Retire asset</button>
      <span className="text-muted" style={{ alignSelf: 'center' }}>End of life — the token stays on the ledger; the asset can no longer be used.</span>
    </div>
  );
}

function NftPane({ asset, viewer, DB }) {
  const { State } = useApp();
  const hist = tokenHistory(asset);
  const mint = hist.find(h => h.mint) || {};
  const [file, setFile] = useState(null);

  if (!asset.tokenId) {
    return (
      <>
        <div className="nft-card">
          <div className="nft-token">NFT not minted yet <ClassBadge asset={asset} />{asset.status === 'retired' && <span className="badge badge-retired"> Retired</span>}</div>
          <div className="identity-detail-grid">
            <div><strong>Owner:</strong> {nameOfDid(asset.owner)} <span className="mono">({asset.owner})</span></div>
            <div><strong>Version:</strong> v{asset.version || 1}</div>
            <div style={{ gridColumn: '1/-1' }}><strong>Content hash (SHA-256):</strong> <span className="mono" style={{ fontSize: 11, wordBreak: 'break-all' }}>{asset.hash}</span></div>
          </div>
          {canMintAsset(viewer, asset) ? (
            <div className="form-actions" style={{ marginTop: 12 }}><button className="btn btn-sm btn-primary" onClick={() => { if (mintAsset(asset, viewer)) { toast(`⬡ Minted for ${nameOfDid(asset.owner)}`); refresh(); } }}>⬡ Mint NFT to {nameOfDid(asset.owner)}</button></div>
          ) : <p className="text-muted" style={{ marginTop: 10 }}>An authorised administrator (MINT_ASSET) mints the NFT and assigns it to the owner's DID.{hasPerm(viewer, 'MINT_ASSET') && asset.owner === viewer.did ? ' Another administrator has to mint an asset you hold yourself.' : ''}</p>}
        </div>
        <ReviewSettings asset={asset} viewer={viewer} />
        <RetireAction asset={asset} viewer={viewer} />
        <VersionHistory hist={hist} />
      </>
    );
  }

  const transfers = DB.transfers.filter(t => t.assetId === asset.id && t.status === 'completed').sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt)));
  const vr = State.nftVerify && State.nftVerify.aid === asset.id ? State.nftVerify : null;

  return (
    <>
      <div className="nft-card">
        <div className="nft-token">{asset.tokenId ? `BEL-NFT #${String(asset.tokenId).padStart(4, '0')}` : ''} <ClassBadge asset={asset} />{asset.status === 'retired' && <span className="badge badge-retired"> Retired</span>}</div>
        {asset.status === 'retired' && <div className="alert alert-warning" style={{ marginBottom: 10 }}>Retired {fmtTs(asset.retiredAt)} by {nameOfDid(asset.retiredBy)} — kept on the ledger for history; no further downloads, versions, sharing or transfers.</div>}
        <div className="identity-detail-grid">
          <div><strong>Issuer:</strong> Bharat Electronics Limited <span className="mono">({ORG_DID})</span></div>
          <div><strong>Owner:</strong> {nameOfDid(asset.owner)} <span className="mono">({asset.owner})</span></div>
          <div><strong>Version:</strong> v{asset.version || 1}</div>
          <div><strong>Minted:</strong> {fmtTs(asset.mintedAt)}{mint.height != null && <> · <BlockChip height={mint.height} /></>} by {nameOfDid(mint.by || asset.mintedBy)}</div>
          <div style={{ gridColumn: '1/-1' }}><strong>Content hash (SHA-256):</strong> <span className="mono" style={{ fontSize: 11, wordBreak: 'break-all' }}>{asset.hash}</span></div>
        </div>
      </div>
      <ReviewSettings asset={asset} viewer={viewer} />
      <RetireAction asset={asset} viewer={viewer} />
      <div className="aac-subhead" style={{ marginTop: 16 }}><span>Verify a file against this token</span></div>
      <div className="form-actions" style={{ alignItems: 'center' }}>
        <input type="file" onChange={e => setFile(e.target.files[0] || null)} />
        <button className="btn btn-sm btn-outline" onClick={() => { if (file) nftVerifyFile(asset, file); }}>Check file</button>
        {vr && <span className={`crdash-status ${vr.match ? 's-approved' : 's-rejected'}`}>{vr.match ? "✓ Matches the token's content hash — authentic" : '✗ Does not match — not the registered version'}</span>}
      </div>
      <VersionHistory hist={hist} />
      <div className="aac-subhead" style={{ marginTop: 16 }}><span>Ownership history</span></div>
      {transfers.length === 0 ? <div className="text-muted" style={{ padding: '6px 0' }}>Held by {nameOfDid(asset.owner)} since minting — no transfers yet.</div> : (
        <table className="crdash-table">
          <thead><tr><th>When</th><th>From</th><th>To</th><th>How</th></tr></thead>
          <tbody>
            {transfers.map((t, i) => (
              <tr key={i}>
                <td className="crdash-muted" style={{ whiteSpace: 'nowrap' }}>{fmtTs(t.requestedAt)}</td>
                <td>{nameOfDid(t.fromDid)}</td><td>{nameOfDid(t.toDid)}</td>
                <td>{t.mode === 'forced' ? <><span className="badge badge-suspended">Admin override</span> by {nameOfDid(t.decidedBy)}</> : 'Transferred by the owner'}{t.reason && <div className="crdash-muted">{t.reason}</div>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function TxPane({ asset, DB }) {
  const events = DB.auditLog.filter(e => e.detail.includes(asset.id) || e.detail.includes(asset.name.slice(0, 20)));
  return (
    <>
      <div className="aac-subhead"><span>Change &amp; Download History</span></div>
      {events.length === 0 ? <div className="no-data">No recorded changes or downloads for this asset</div> : (
        <table style={{ marginBottom: 8 }}>
          <thead><tr><th>Event</th><th>Actor</th><th>Detail</th><th>Timestamp</th></tr></thead>
          <tbody>
            {events.map(e => {
              const actor = DB.users.find(u => u.did === e.actor);
              return <tr key={e.id}><td><span className="badge badge-active">{e.type}</span></td><td>{actor ? actor.name : (e.actor || '—')}</td><td style={{ fontSize: 11.5, color: '#666' }}>{e.detail}</td><td style={{ fontSize: 11, color: '#999', whiteSpace: 'nowrap' }}>{fmtTs(e.ts)}</td></tr>;
            })}
          </tbody>
        </table>
      )}
    </>
  );
}

// Real JSX port of app.js's renderModal() 'asset-profile' branch.
export default function AssetProfileModal({ m }) {
  const { DB } = useApp();
  const viewer = currentUser();
  const asset = DB.assets.find(a => a.id === m.aid);
  const [tab, setTab] = useState('access');
  if (!asset) return null;

  if (!assetAccessFor(viewer, asset)) {
    return (
      <div className="slideup-backdrop" onClick={closeModal}>
        <div className="slideup-panel" onClick={e => e.stopPropagation()}>
          <div className="slideup-header"><div className="slideup-user"><div className="avatar" style={{ width: 44, height: 44, fontSize: 16 }}>🔒</div><div><div className="slideup-name">{asset.name}</div><div className="crdash-muted" style={{ color: '#c9d3df' }}>{asset.id} · No access</div></div></div><button className="close-btn" onClick={closeModal}>×</button></div>
          <div className="slideup-body">
            <div className="identity-detail-grid" style={{ marginBottom: 14 }}>
              <div><strong>Asset:</strong> {asset.name} <ClassBadge asset={asset} /></div>
              <div><strong>Owner:</strong> {nameOfDid(asset.owner)}</div>
              <div><strong>Org unit:</strong> {asset.orgUnit}</div>
              <div><strong>NFT:</strong> {asset.tokenId ? `BEL-NFT #${String(asset.tokenId).padStart(4, '0')}` : 'not minted'} · v{asset.version || 1}</div>
            </div>
            <div className="alert alert-info">🔒 You can see this asset in the registry but not open or download it. Ask its Owner, {nameOfDid(asset.owner)}, to add you as a Viewer or Editor.</div>
          </div>
        </div>
      </div>
    );
  }

  const owner = DB.users.find(u => u.did === asset.owner);
  const isOwner = asset.owner === viewer.did && asset.status !== 'retired';
  const canDownloadAsset = assetPerm(viewer, asset, 'DOWNLOAD');
  const canUpdateAsset = assetPerm(viewer, asset, 'UPLOAD_ASSET') && asset.status !== 'retired';
  const myOpenReview = openReviewByViewer(asset, viewer);
  const holder = DB.users.find(u => u.did === asset.owner);

  const panes = {
    access: <AccessPane asset={asset} viewer={viewer} owner={owner} isOwner={isOwner} DB={DB} />,
    nft: <NftPane asset={asset} viewer={viewer} DB={DB} />,
    transactions: <TxPane asset={asset} DB={DB} />,
  };

  return (
    <div className="slideup-backdrop" onClick={closeModal}>
      <div className="slideup-panel" onClick={e => e.stopPropagation()}>
        <div className="slideup-header">
          <div className="slideup-user">
            <div className="avatar" style={{ width: 44, height: 44, fontSize: 16 }}>📄</div>
            <div>
              <div className="slideup-name">{asset.name}</div>
              <div className="slideup-desig">{asset.orgUnit} &nbsp;·&nbsp; v{asset.version || 1} &nbsp;·&nbsp; <span className="mono" title={`SHA-256: ${asset.hash}`}>{shortHash(asset.hash)}</span> &nbsp;·&nbsp; <span className={`badge badge-${asset.status}`}>{asset.status === 'approved' ? 'active' : asset.status}</span> <ClassBadge asset={asset} /></div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {canDownloadAsset && <button className="btn btn-sm btn-outline" onClick={() => requestDownload(asset)}>⬇ Download</button>}
            {asset.status !== 'retired' && asset.owner === viewer.did && <button className="btn btn-sm btn-outline" onClick={() => openModal({ type: 'transfer-custody', aid: asset.id })}>⇄ Transfer Ownership</button>}
            {asset.status !== 'retired' && hasPerm(viewer, 'APPROVE_TRANSFER') && !isActive(holder) && asset.owner !== viewer.did && (
              <button className="btn btn-sm btn-outline" title={`The owner is ${holder ? holder.status : 'inactive'} — administrators can transfer this asset`} onClick={() => openModal({ type: 'recover-custody', aid: asset.id })}>↺ Transfer (owner {holder ? holder.status : 'inactive'})</button>
            )}
            {canUpdateAsset && <button className="btn btn-sm btn-outline" onClick={() => openModal({ type: 'start-review', aid: asset.id })}>{myOpenReview ? `⬆ Upload Revision to ${myOpenReview.id}` : '⬆ Update Asset'}</button>}
            <button className="close-btn" onClick={closeModal}>×</button>
          </div>
        </div>
        <div className="profile-tabs">
          {TABS.map(t => <button key={t.id} className={`profile-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>{t.id === 'nft' ? (asset.tokenId ? `NFT & History (BEL-NFT #${String(asset.tokenId).padStart(4, '0')})` : 'NFT & History') : t.label}</button>)}
        </div>
        <div className="slideup-body">{panes[tab]}</div>
      </div>
    </div>
  );
}
