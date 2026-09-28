import { useState } from 'react';
import { useApp } from '../../store.jsx';
import {
  currentUser, assetAccessFor, canUpload, canMintAsset, nameOfDid, isActive,
  fmtDate, tokenLabel, fmtTs, getAssetLastUpdated, openModal, mintAsset,
} from '../../core.js';
import { AccessBadge, ClassBadge } from '../Badges.jsx';

const assetMatches = (a, q) => !q || `${a.name} ${a.id}`.toLowerCase().includes(q);

// Real JSX port of app.js's renderAdminAssets() ("Asset Registry" page).
export default function AssetRegistryPage() {
  const { DB } = useApp();
  const viewer = currentUser();
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');

  const all = DB.assets.map(a => ({ a, acc: assetAccessFor(viewer, a) }));
  const count = lv => all.filter(x => x.acc && x.acc.level === lv).length;
  const rows = filter === 'all' ? all : all.filter(x => x.acc && x.acc.level === filter);
  const q = query.trim().toLowerCase();
  const chips = [['all', 'All', all.length], ['Owner', 'I own', count('Owner')], ['Editor', 'I can edit', count('Editor')], ['Viewer', 'I can view', count('Viewer')]];
  const visibleRows = rows.filter(({ a }) => assetMatches(a, q));

  return (
    <>
      <div className="page-header">
        <h2>Asset Registry</h2>
        <p>Every BEL digital asset is listed here. Each is owned by one person (DID); the Owner adds <strong>Editors</strong> (can update) and <strong>Viewers</strong> (can view &amp; download). Administrators and Auditors are Viewers of every asset. Without access you see the listing only.</p>
      </div>
      <div className="registry-toolbar">
        <div className="chip-row">
          {chips.map(([id, label, n]) => (
            <button key={id} className={`filter-chip${filter === id ? ' active' : ''}`} onClick={() => setFilter(id)}>{label} <span>{n}</span></button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="search" className="reg-search" placeholder="Search asset name or ID…" autoComplete="off" value={query} onChange={e => setQuery(e.target.value)} />
          {canUpload(viewer) && <button className="btn btn-sm btn-primary" onClick={() => openModal({ type: 'new-asset' })}>+ New Asset</button>}
        </div>
      </div>
      <table className="crdash-table registry-table">
        <thead><tr><th>Asset</th><th>Owner</th><th>Your access</th><th>NFT</th><th>Version</th><th>Last updated</th></tr></thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={6}><div className="no-data">No assets here yet</div></td></tr>
          ) : visibleRows.map(({ a, acc }) => {
            const holder = DB.users.find(u => u.did === a.owner);
            return (
              <tr key={a.id} className={`crdash-row${acc ? '' : ' no-access'}`} title={acc ? `Open ${a.name}` : 'You have no access to this asset'} onClick={() => openModal({ type: 'asset-profile', aid: a.id })}>
                <td><a className="crdash-link">{a.name}</a> <ClassBadge asset={a} />{a.status === 'retired' && <span className="badge badge-retired"> Retired</span>}<div className="crdash-muted">{a.id} · {a.orgUnit}</div></td>
                <td>{nameOfDid(a.owner)}{a.status !== 'retired' && !isActive(holder) && <span className="badge badge-suspended" title="The owner is inactive — an administrator can transfer this asset"> ⚠ owner {holder ? holder.status : 'inactive'}</span>}</td>
                <td><AccessBadge level={acc ? acc.level : null} /></td>
                <td>
                  {a.tokenId ? (
                    <span className="rev-chip" title={`Minted ${fmtTs(a.mintedAt)}`}>{tokenLabel(a)}</span>
                  ) : canMintAsset(viewer, a) ? (
                    <button className="btn btn-xs btn-primary" title={`Mint this asset's NFT to ${nameOfDid(a.owner)}`} onClick={e => { e.stopPropagation(); mintAsset(a, viewer); }}>⬡ Mint</button>
                  ) : <span className="crdash-muted">not minted</span>}
                </td>
                <td>v{a.version || 1}</td>
                <td className="crdash-muted">{fmtDate(getAssetLastUpdated(a))}</td>
              </tr>
            );
          })}
          {rows.length > 0 && visibleRows.length === 0 && (
            <tr><td colSpan={6}><div className="no-data">No asset matches “{query}”</div></td></tr>
          )}
        </tbody>
      </table>
    </>
  );
}
