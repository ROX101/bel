import { useState } from 'react';
import { useApp } from '../../store.jsx';
import {
  currentUser, roleOf, scopeOf, CONTRACTS, canUpload, openModal,
  reviewDashGroups, isOpenReview, canMerge, canApprove,
  latestRev, unresolvedBlocking, isReadyToMerge, reviewKindLabel, countedApprovals,
  timeAgo, initialsOf, assetAccessFor, nameOfDid, tokenLabel, sharedWithLabel,
} from '../../core.js';
import { ClassBadge } from '../Badges.jsx';

function ReviewStatusTag({ r }) {
  if (r.status === 'draft') return <span className="crdash-status s-draft">✎ Draft</span>;
  if (r.status === 'merged') return <span className="crdash-status s-merged">⇪ Merged</span>;
  if (r.status === 'canceled') return <span className="crdash-status s-canceled">⊘ Canceled</span>;
  if (!latestRev(r).publishedAt) return <span className="crdash-status s-draft">✎ Draft revision</span>;
  if (unresolvedBlocking(r).length) return <span className="crdash-status s-rejected">⛔ Blocked</span>;
  if (isReadyToMerge(r)) return <span className="crdash-status s-approved">✓ Ready to merge</span>;
  return <span className="crdash-status s-pending">● In Review</span>;
}

function Approvals({ given, required }) {
  const g = given ?? 0, r = required ?? 0;
  const pct = r > 0 ? Math.min(100, Math.round((g / r) * 100)) : 0;
  const complete = r > 0 && g >= r;
  return (
    <div className="crdash-approvals">
      <span className="crdash-approvals-count">{g}/{r}</span>
      <div className="crdash-approvals-bar"><div className={`crdash-approvals-bar-fill${complete ? ' complete' : ''}`} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function ReviewTable({ rows, showAuthor, emptyText }) {
  if (!rows.length) return <div className="no-data" style={{ padding: '16px 0' }}>{emptyText}</div>;
  return (
    <table className="crdash-table">
      <thead><tr>{showAuthor && <th>Author</th>}<th>Review</th><th>Last Activity</th><th>Approvals</th><th>Comments</th></tr></thead>
      <tbody>
        {rows.map(r => {
          const author = r.authorDid;
          return (
            <tr key={r.id} className="crdash-row" title="Open this review" onClick={() => openModal({ type: 'review-detail', rid: r.id })}>
              {showAuthor && <td><div className="crdash-who"><div className="avatar" style={{ width: 24, height: 24, fontSize: 10 }}>{initialsOf(r._authorName || '?')}</div><span>{r._authorName || author}</span></div></td>}
              <td>
                <a className="crdash-link">{r.assetName}</a>{' '}
                <span className="rev-chip" title="Latest revision">R{latestRev(r).n}</span> <ReviewStatusTag r={r} />
                <div className="crdash-muted" style={{ marginTop: 2 }}>{r.id} · {reviewKindLabel(r)} · {r.desc || (r.status === 'draft' ? 'No description yet — still in draft' : '—')}</div>
              </td>
              <td className="crdash-muted" style={{ whiteSpace: 'nowrap' }}>{timeAgo(r.updatedAt)}</td>
              <td><Approvals given={countedApprovals(r).length} required={r.approvalsRequired} /></td>
              <td className="crdash-muted" style={{ whiteSpace: 'nowrap' }}>💬 {r.comments.length}{unresolvedBlocking(r).length > 0 && <span className="crdash-status s-rejected"> ⛔ {unresolvedBlocking(r).length}</span>}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ReviewGroup({ id, title, rows, showAuthor, emptyText, open, onToggle }) {
  return (
    <div className="crdash-group">
      <div className="crdash-group-header" onClick={onToggle}>
        <span className="crdash-caret">{open ? '▾' : '▸'}</span>
        <span>{title}</span>
        <span className="crdash-count">({rows.length})</span>
      </div>
      {open && <ReviewTable rows={rows} showAuthor={showAuthor} emptyText={emptyText} />}
    </div>
  );
}

function Inbox({ DB, viewer }) {
  const { mine, team, closed } = reviewDashGroups();
  const withAuthor = rows => rows.map(r => ({ ...r, _authorName: (DB.users.find(u => u.did === r.authorDid) || {}).name }));
  const [mineOpen, setMineOpen] = useState(true);
  const [teamOpen, setTeamOpen] = useState(true);
  const [closedOpen, setClosedOpen] = useState(false);
  const scope = scopeOf(viewer);
  return (
    <>
      <ReviewGroup id="mine" title="Your Reviews" rows={mine} showAuthor={false} emptyText="You don't have any open reviews" open={mineOpen} onToggle={() => setMineOpen(o => !o)} />
      <ReviewGroup id="team" title={scope === 'HQ' ? 'Team Reviews — all units' : `Team Reviews — ${viewer.orgUnit}`} rows={withAuthor(team)} showAuthor emptyText="No open reviews from your team" open={teamOpen} onToggle={() => setTeamOpen(o => !o)} />
      <ReviewGroup id="closed" title="Recently Closed" rows={withAuthor(closed)} showAuthor emptyText="No merged or canceled reviews yet" open={closedOpen} onToggle={() => setClosedOpen(o => !o)} />
    </>
  );
}

function MyAssetsGroup({ title, list, level, emptyText }) {
  return (
    <div className="crdash-group">
      <div className="crdash-group-header" style={{ cursor: 'default' }}><span>{title}</span><span className="crdash-count">({list.length})</span></div>
      {list.length === 0 ? <div className="no-data" style={{ padding: '12px 0' }}>{emptyText}</div> : (
        <table className="crdash-table"><tbody>
          {list.map(({ a }) => (
            <tr key={a.id} className="crdash-row" onClick={() => openModal({ type: 'asset-profile', aid: a.id })}>
              <td><a className="crdash-link">{a.name}</a> <ClassBadge asset={a} /><div className="crdash-muted">{a.id} · v{a.version || 1} · {a.tokenId ? tokenLabel(a) : 'NFT not minted'}</div></td>
              <td className="crdash-muted">{level === 'Owner' ? sharedWithLabel(a) : `Owner: ${nameOfDid(a.owner)}`}</td>
              <td style={{ textAlign: 'right' }}>
                {level !== 'Viewer' && a.status !== 'retired' && (
                  <button className="btn btn-xs btn-outline" title="Upload a new version (opens a review)" onClick={e => { e.stopPropagation(); openModal({ type: 'start-review', aid: a.id }); }}>⬆ Update</button>
                )}
              </td>
            </tr>
          ))}
        </tbody></table>
      )}
    </div>
  );
}

function MyAssets({ DB, viewer }) {
  const rows = DB.assets.map(a => ({ a, acc: assetAccessFor(viewer, a) })).filter(x => x.acc);
  const group = lv => rows.filter(x => x.acc.level === lv);
  return (
    <>
      <MyAssetsGroup title="Owned by you" level="Owner" list={group('Owner')} emptyText="You don't own any assets yet" />
      <MyAssetsGroup title="You can edit" level="Editor" list={group('Editor')} emptyText="Nobody has made you an Editor yet" />
      <MyAssetsGroup title="You can view" level="Viewer" list={group('Viewer')} emptyText="No assets shared with you to view" />
    </>
  );
}

// Real JSX port of app.js's renderDashboard()/renderDashboardTabs().
export default function Dashboard() {
  const { DB } = useApp();
  const viewer = currentUser();
  const role = roleOf(viewer) || { name: viewer.role };
  const sc = CONTRACTS.SCOPES[scopeOf(viewer)] || {};
  const { mine, team } = reviewDashGroups();
  const inboxCount = mine.filter(r => canMerge(viewer, r)).length + team.filter(r => canApprove(viewer, r)).length;
  const [tab, setTab] = useState('inbox');

  return (
    <>
      <div className="page-header">
        <h2>{role.name} Dashboard</h2>
        <p>{viewer.designation} · {viewer.orgUnit} · access scope: {sc.label || '—'}</p>
      </div>
      <div className="crdash-section dash-plain">
        <div className="profile-tabs" style={{ padding: '0 20px' }}>
          <button className={`profile-tab${tab === 'inbox' ? ' active' : ''}`} onClick={() => setTab('inbox')}>Inbox{inboxCount ? ` (${inboxCount})` : ''}</button>
          <button className={`profile-tab${tab === 'my-assets' ? ' active' : ''}`} onClick={() => setTab('my-assets')}>My Assets</button>
          {canUpload(viewer) && <button className="dash-create-btn" title="Create a new asset (v1)" onClick={() => openModal({ type: 'new-asset' })}>+ Create asset</button>}
        </div>
        {tab === 'inbox' ? <Inbox DB={DB} viewer={viewer} /> : <MyAssets DB={DB} viewer={viewer} />}
      </div>
    </>
  );
}
