import { useState } from 'react';
import { useApp } from '../../store.jsx';
import {
  currentUser, closeModal, openModal, userByDid, reviewAsset, latestRev, isOpenReview,
  canViewReview, canApprove, canMerge, mergeChecks, isReadyToMerge, reviewKindLabel,
  countedApprovals, assetPerm, canManageReviewers, isEligibleApprover, canComment,
  canResolveComment, reviewAssetLike, isActive, fmtTs, shortHash, timeAgo, initialsOf,
  tokenLabel, nameOfDid, guard, toast, refresh,
  publishReview, approveRevision, mergeReview, cancelReview, reopenReview, discardDraft,
  saveReviewDesc, addReviewer, autoAssignReviewers, toggleReviewerRequired, removeReviewer,
  addReviewComment, postReviewReply, resolveReviewComment, flagReviewCommentBlocking,
  requestDownload,
} from '../../core.js';
import { ClassBadge } from '../Badges.jsx';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'revisions', label: 'Revisions' },
  { id: 'reviewers', label: 'Reviewers' },
  { id: 'comments', label: 'Comments' },
  { id: 'activity', label: 'Activity' },
];

function ReviewStatusTag({ r }) {
  if (r.status === 'draft') return <span className="crdash-status s-draft">✎ Draft</span>;
  if (r.status === 'merged') return <span className="crdash-status s-merged">⇪ Merged</span>;
  if (r.status === 'canceled') return <span className="crdash-status s-canceled">⊘ Canceled</span>;
  if (!latestRev(r).publishedAt) return <span className="crdash-status s-draft">✎ Draft revision</span>;
  if (r.comments.some(c => c.blocking && !c.resolved)) return <span className="crdash-status s-rejected">⛔ Blocked</span>;
  if (isReadyToMerge(r)) return <span className="crdash-status s-approved">✓ Ready to merge</span>;
  return <span className="crdash-status s-pending">● In Review</span>;
}

function Approvals({ given, required }) {
  const g = given ?? 0, req = required ?? 0;
  const pct = req > 0 ? Math.min(100, Math.round((g / req) * 100)) : 0;
  return (
    <div className="crdash-approvals">
      <span className="crdash-approvals-count">{g}/{req}</span>
      <div className="crdash-approvals-bar"><div className={`crdash-approvals-bar-fill${req > 0 && g >= req ? ' complete' : ''}`} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function OverviewPane({ r, viewer, asset, rev, isAuthor, open }) {
  const [desc, setDesc] = useState(r.desc || '');
  const checks = mergeChecks(r);
  const actions = [];
  if (isAuthor && open && asset && assetPerm(viewer, asset, 'UPLOAD_ASSET')) actions.push(
    <button key="rev" className="btn btn-sm btn-outline" onClick={() => openModal({ type: 'start-review', rid: r.id })}>⬆ Upload New Revision</button>
  );
  if (isAuthor && open && !rev.publishedAt) actions.push(
    <button key="discard" className="btn btn-sm btn-outline" onClick={() => {
      const what = guard(() => discardDraft(r, viewer));
      if (!what) return;
      if (what === 'review') closeModal(); else refresh();
      toast(what === 'review' ? 'Draft review discarded' : 'Draft revision discarded', 'warning');
    }}>🗑 {r.revisions.some(v => v.publishedAt) ? `Discard revision ${rev.n}` : 'Discard review'}</button>
  );
  if (isAuthor && r.status === 'published') actions.push(
    <button key="cancel" className="btn btn-sm btn-outline" onClick={() => openModal({ type: 'cancel-review', rid: r.id })}>⊘ Mark as canceled</button>
  );
  if (isAuthor && r.status === 'canceled') actions.push(
    <button key="reopen" className="btn btn-sm btn-outline" onClick={() => { if (guard(() => reopenReview(r, viewer))) { refresh(); toast('Review reopened'); } }}>↺ Reopen review</button>
  );

  return (
    <>
      <div className="identity-detail-grid" style={{ marginBottom: 16 }}>
        <div><strong>Review:</strong> <span className="mono">{r.id}</span> · {reviewKindLabel(r)}</div>
        <div><strong>Asset:</strong> {asset ? <>{r.assetName} <span className="mono">({asset.id})</span></> : <>{r.assetName} <span className="text-muted">(registered on publish)</span></>}</div>
        <div><strong>Author:</strong> {(userByDid(r.authorDid) || {}).name || r.authorDid}</div>
        <div><strong>Org Unit:</strong> {r.orgUnit}</div>
        <div><strong>Created:</strong> {fmtTs(r.createdAt)}</div>
        <div><strong>Latest revision:</strong> R{rev.n} · {rev.fileName || '—'} · {rev.size || '—'} · <span className="mono" title={rev.hash}>{shortHash(rev.hash)}</span></div>
      </div>
      <div className="aac-subhead"><span>Description</span>
        {asset && assetPerm(viewer, asset, 'DOWNLOAD') && <button className="btn btn-sm btn-outline" onClick={() => requestDownload(asset)}>⬇ Download current asset</button>}
      </div>
      {isAuthor && open ? (
        <>
          <textarea rows={3} placeholder="Describe what changed in this asset..." style={{ width: '100%', marginBottom: 8 }} value={desc} onChange={e => setDesc(e.target.value)} />
          <div className="form-actions" style={{ marginBottom: 18 }}>
            <button className="btn btn-outline btn-sm" onClick={() => { saveReviewDesc(r, viewer, desc); toast('Description saved'); }}>Save description</button>
            <span className="text-muted" style={{ alignSelf: 'center' }}>Editing the description doesn't create a new revision.</span>
          </div>
        </>
      ) : <p style={{ fontSize: 13, color: '#444', marginBottom: 18 }}>{r.desc || '—'}</p>}

      {r.status === 'merged' && <div className="alert alert-success" style={{ marginBottom: 14 }}>⇪ Merged by {(userByDid(r.mergedBy) || {}).name || r.mergedBy || '—'}{r.mergedAt ? ` on ${fmtTs(r.mergedAt)}` : ''}{asset ? ` — ${asset.id} is now v${asset.version || 1}${asset.tokenId ? ` (${tokenLabel(asset)})` : ''}` : ''}</div>}
      {r.status === 'canceled' && <div className="alert alert-danger" style={{ marginBottom: 14 }}>⊘ Canceled by {(userByDid(r.canceledBy) || {}).name || r.canceledBy} on {fmtTs(r.canceledAt)}{r.cancelReason ? ` — ${r.cancelReason}` : ''}</div>}
      {open && (
        <>
          <div className="aac-subhead"><span>Merge Requirements</span>{isReadyToMerge(r) && <span className="crdash-status s-approved">✓ Ready to merge</span>}</div>
          <ul className="review-checks">
            {checks.map((c, i) => <li key={i} className={c.ok ? 'ok' : 'todo'}>{c.ok ? '✓' : '○'} {c.label}</li>)}
            <li className={isReadyToMerge(r) ? 'ok' : 'todo'}>{isReadyToMerge(r) ? '✓' : '○'} Merged manually by the author{isReadyToMerge(r) && !isAuthor ? <> — <em>waiting for {nameOfDid(r.authorDid)} to merge</em></> : ''}</li>
          </ul>
        </>
      )}
      {actions.length > 0 && <div className="form-actions" style={{ marginTop: 14 }}>{actions}</div>}
    </>
  );
}

function RevisionsPane({ r, rev }) {
  return (
    <>
      <table className="crdash-table">
        <thead><tr><th>Rev</th><th>File</th><th>SHA-256</th><th>Size</th><th>Published</th><th>Approvals</th></tr></thead>
        <tbody>
          {[...r.revisions].reverse().map(v => {
            const prev = r.revisions.find(x => x.n === v.n - 1);
            return (
              <tr key={v.n}>
                <td><span className="rev-chip">R{v.n}</span>{v.n === rev.n && <span className="crdash-muted"> latest</span>}</td>
                <td>{v.fileName || '—'}{prev && <div className="crdash-muted">{prev.hash === v.hash ? `Same content as R${prev.n}` : `Content changed from R${prev.n} (${prev.size} → ${v.size})`}</div>}</td>
                <td className="mono" style={{ fontSize: 10.5 }} title={v.hash}>{shortHash(v.hash)}</td>
                <td>{v.size || '—'}</td>
                <td>{v.publishedAt ? fmtTs(v.publishedAt) : <span className="crdash-status s-draft">Draft</span>}</td>
                <td>{v.approvals.length ? v.approvals.map(a => <span key={a.did} className="badge badge-approved">✓ {(userByDid(a.did) || {}).name || a.did}</span>) : <span className="crdash-muted">—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-muted" style={{ marginTop: 10 }}>Approvals apply to the revision they were given on — publishing a new revision needs fresh approvals.</p>
    </>
  );
}

function ReviewersPane({ r, rev, viewer, DB }) {
  const canManage = canManageReviewers(viewer, r);
  const reviewerDids = [...new Set([...r.reviewers.map(x => x.did), ...rev.approvals.map(a => a.did)])];
  const unit = reviewAssetLike(r).orgUnit;
  const candidates = DB.users.filter(u => isActive(u) && u.did !== r.authorDid && !r.reviewers.some(x => x.did === u.did))
    .sort((a, b) => (a.orgUnit === unit ? 0 : 1) - (b.orgUnit === unit ? 0 : 1) || a.name.localeCompare(b.name));
  const [selDid, setSelDid] = useState(candidates[0] ? candidates[0].did : '');
  const [required, setRequired] = useState(false);

  return (
    <>
      <div className="alert alert-info" style={{ marginBottom: 14 }}>⚖ &nbsp; This asset needs <strong>{r.approvalsRequired}</strong> approval{r.approvalsRequired === 1 ? '' : 's'} on the latest revision from teammates in {reviewAssetLike(r).orgUnit} or reviewers added here. Required reviewers must approve as well. Then the author merges.</div>
      {reviewerDids.length === 0 ? <div className="no-data" style={{ padding: '16px 0' }}>No reviewers yet</div> : (
        <table className="crdash-table" style={{ marginBottom: 14 }}>
          <thead><tr><th>Reviewer</th><th>Required</th><th>Revision {rev.n}</th><th>Counts toward rule</th>{canManage && <th></th>}</tr></thead>
          <tbody>
            {reviewerDids.map(did => {
              const u = userByDid(did);
              const entry = r.reviewers.find(x => x.did === did);
              const approvedNow = rev.approvals.some(a => a.did === did);
              const approvedEarlier = !approvedNow && r.revisions.some(v => v.n < rev.n && v.approvals.some(a => a.did === did));
              return (
                <tr key={did}>
                  <td><div className="crdash-who"><div className="avatar" style={{ width: 22, height: 22, fontSize: 9 }}>{initialsOf(u ? u.name : '?')}</div><span>{u ? u.name : did}</span></div><div className="crdash-muted">{u ? u.designation : ''}</div></td>
                  <td>{entry ? (canManage
                    ? <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}><input type="checkbox" checked={entry.required} onChange={e => toggleReviewerRequired(r, viewer, did, e.target.checked)} /> Required</label>
                    : (entry.required ? <span className="badge badge-pending">Required</span> : <span className="crdash-muted">Optional</span>)) : <span className="crdash-muted">Not listed</span>}</td>
                  <td>{approvedNow ? <span className="crdash-status s-approved">✓ Approved</span> : approvedEarlier ? <span className="crdash-muted">Approved an earlier revision</span> : <span className="crdash-status s-pending">Pending</span>}</td>
                  <td>{isEligibleApprover(u, r) ? '✓' : <span className="crdash-muted">No</span>}</td>
                  {canManage && <td>{entry && <button className="btn btn-xs btn-outline" title="Remove reviewer" onClick={() => removeReviewer(r, viewer, did)}>🗑</button>}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {canManage && (
        <>
          <div className="form-row" style={{ alignItems: 'flex-end' }}>
            <div className="form-group"><label>Add reviewer</label>
              <select value={selDid} onChange={e => setSelDid(e.target.value)}>
                {candidates.length ? candidates.map(u => <option key={u.did} value={u.did}>{u.name} — {u.designation}{isEligibleApprover(u, r) ? ' · approver' : ''}</option>) : <option value="">No eligible users</option>}
              </select>
            </div>
            <div className="form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}><input type="checkbox" checked={required} onChange={e => setRequired(e.target.checked)} /> Required</label>
            </div>
          </div>
          <div className="form-actions">
            <button className="btn btn-sm btn-primary" disabled={!candidates.length} onClick={() => { const u = userByDid(selDid); if (addReviewer(r, viewer, selDid, required)) toast(`${u ? u.name : selDid} added as a reviewer`); }}>+ Add reviewer</button>
            {r.reviewers.length === 0 && (
              <button className="btn btn-sm btn-outline" onClick={() => { const picks = autoAssignReviewers(r, viewer); toast(picks.length ? `Auto-assigned ${picks.map(u => u.name).join(', ')}` : 'No eligible approvers available', picks.length ? 'success' : 'warning'); }}>⚡ Auto-assign reviewers</button>
            )}
          </div>
        </>
      )}
    </>
  );
}

function CommentThread({ r, c, viewer, replyTo, setReplyTo }) {
  const cu = userByDid(c.authorDid);
  const canC = canComment(viewer, r);
  const [replyText, setReplyText] = useState('');
  return (
    <div className={`comment-thread${c.blocking && !c.resolved ? ' blocking' : ''}${c.resolved ? ' resolved' : ''}`}>
      <div className="crdash-who" style={{ marginBottom: 4 }}>
        <div className="avatar" style={{ width: 22, height: 22, fontSize: 9 }}>{initialsOf(cu ? cu.name : '?')}</div>
        <strong style={{ fontSize: 12.5 }}>{cu ? cu.name : c.authorDid}</strong>
        <span className="rev-chip" title="Revision this comment was left on">R{c.revision}</span>
        {c.blocking && <span className={`badge ${c.resolved ? 'badge-expired' : 'badge-rejected'}`}>⛔ Blocking</span>}
        {c.resolved && <span className="badge badge-approved">✓ Resolved{c.resolvedBy ? ` by ${(userByDid(c.resolvedBy) || {}).name || ''}` : ''}</span>}
        <span className="crdash-muted" style={{ marginLeft: 'auto' }}>{timeAgo(c.ts)}</span>
      </div>
      <div style={{ fontSize: 13, color: '#333', marginLeft: 30 }}>{c.text}</div>
      {c.replies.map(rp => { const ru = userByDid(rp.authorDid); return <div className="comment-reply" key={rp.id}><strong>{ru ? ru.name : rp.authorDid}</strong> <span className="crdash-muted">{timeAgo(rp.ts)}</span><div>{rp.text}</div></div>; })}
      {canC && (
        <div className="comment-actions">
          <a href="#" onClick={e => { e.preventDefault(); setReplyTo(replyTo === c.id ? null : c.id); }}>Reply</a>
          {canResolveComment(viewer, r, c) ? (
            <a href="#" onClick={e => { e.preventDefault(); resolveReviewComment(r, c, viewer); }}>{c.resolved ? 'Unresolve' : 'Resolve'}</a>
          ) : (c.blocking && !c.resolved && <span className="crdash-muted" title="Only the comment's author or an eligible approver can clear a blocking comment">Blocking — awaiting the reviewer</span>)}
          {!c.blocking && !c.resolved && <a href="#" onClick={e => { e.preventDefault(); flagReviewCommentBlocking(r, c, viewer); }}>Flag as blocking</a>}
        </div>
      )}
      {replyTo === c.id && (
        <div className="comment-reply">
          <textarea rows={2} placeholder="Write a reply..." style={{ width: '100%' }} value={replyText} onChange={e => setReplyText(e.target.value)} />
          <div className="form-actions" style={{ marginTop: 6 }}>
            <button className="btn btn-sm btn-primary" onClick={() => { if (postReviewReply(r, c, viewer, replyText)) { setReplyText(''); setReplyTo(null); } }}>Reply</button>
            <button className="btn btn-sm btn-outline" onClick={() => setReplyTo(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function CommentsPane({ r, rev, viewer }) {
  const [hideResolved, setHideResolved] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [text, setText] = useState('');
  const [blocking, setBlocking] = useState(false);
  const threads = r.comments.filter(c => !hideResolved || !c.resolved);
  const canC = canComment(viewer, r);
  return (
    <>
      <div className="aac-subhead"><span>General Comments</span>
        <label style={{ fontSize: 12, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}><input type="checkbox" checked={hideResolved} onChange={e => setHideResolved(e.target.checked)} /> Hide resolved</label>
      </div>
      {threads.length === 0 ? <div className="no-data" style={{ padding: '16px 0' }}>No comments{hideResolved && r.comments.length ? ' (resolved comments hidden)' : ' yet'}</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
          {threads.map(c => <CommentThread key={c.id} r={r} c={c} viewer={viewer} replyTo={replyTo} setReplyTo={setReplyTo} />)}
        </div>
      )}
      {canC && (
        <>
          <div className="form-group"><label>New comment on revision {rev.n}</label><textarea rows={3} placeholder="Write a comment..." value={text} onChange={e => setText(e.target.value)} /></div>
          <div className="form-actions">
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}><input type="checkbox" checked={blocking} onChange={e => setBlocking(e.target.checked)} /> Flag as blocking <span className="text-muted">(must be resolved before minting)</span></label>
            <button className="btn btn-primary btn-sm" onClick={() => { if (addReviewComment(r, viewer, text, blocking)) { setText(''); setBlocking(false); } }}>Add Comment</button>
          </div>
        </>
      )}
    </>
  );
}

function ActivityPane({ r }) {
  return (
    <table className="crdash-table">
      <thead><tr><th>When</th><th>Who</th><th>Event</th></tr></thead>
      <tbody>
        {[...(r.events || [])].reverse().map((e, i) => (
          <tr key={i}><td className="crdash-muted" style={{ whiteSpace: 'nowrap' }}>{fmtTs(e.ts)}</td><td>{(userByDid(e.did) || {}).name || e.did || '—'}</td><td>{e.detail}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

// Real JSX port of app.js's renderReviewDetail() — the 5-tab review slide-up panel.
export default function ReviewDetailModal({ m }) {
  const { DB } = useApp();
  const viewer = currentUser();
  const r = DB.reviews.find(x => x.id === m.rid);
  const [tab, setTab] = useState('overview');
  if (!r) return null;

  if (!canViewReview(viewer, r)) {
    return (
      <div className="slideup-backdrop" onClick={closeModal}>
        <div className="slideup-panel" onClick={e => e.stopPropagation()}>
          <div className="slideup-header"><div className="slideup-user"><div className="avatar" style={{ width: 44, height: 44, fontSize: 16 }}>✎</div><div><div className="slideup-name">{r.assetName}</div></div></div><button className="close-btn" onClick={closeModal}>×</button></div>
          <div className="slideup-body"><div className="no-data">{r.status === 'draft' ? "This review is still in draft and hasn't been published yet." : "You don't have access to this review."}</div></div>
        </div>
      </div>
    );
  }

  const asset = reviewAsset(r);
  const rev = latestRev(r);
  const isAuthor = viewer.did === r.authorDid;
  const open = isOpenReview(r);
  const youApproved = rev.approvals.some(a => a.did === viewer.did);

  let primary = null;
  if (isAuthor && open && !rev.publishedAt) {
    primary = <button className="btn btn-sm btn-primary" onClick={() => {
      const desc = (r.desc || '').trim() || `Revision ${rev.n} update`;
      const prevDesc = r.desc;
      r.desc = desc;
      if (!guard(() => publishReview(r, viewer))) { r.desc = prevDesc; return; }
      refresh();
      toast(`✅ Revision ${rev.n} published — reviewers can now approve it`);
    }}>{r.status === 'draft' ? 'Publish review' : `Publish revision ${rev.n}`}</button>;
  } else if (canMerge(viewer, r)) {
    primary = <button className="btn btn-sm btn-primary" onClick={() => {
      if (!guard(() => mergeReview(r, viewer))) return;
      refresh();
      toast(`⇪ Merged — ${asset.name} is now v${asset.version}`);
    }}>⇪ Merge as v{((asset && asset.version) || 1) + 1}</button>;
  } else if (canApprove(viewer, r)) {
    primary = <button className="btn btn-sm btn-success" onClick={() => {
      if (!guard(() => approveRevision(r, viewer))) return;
      refresh();
      toast(isReadyToMerge(r) ? '✅ Approved — the author can now merge it' : '✅ You approved this revision');
    }}>✓ Approve</button>;
  } else if (youApproved && open) {
    primary = <span className="crdash-status s-approved">✓ You approved this revision</span>;
  }

  const panes = {
    overview: <OverviewPane r={r} viewer={viewer} asset={asset} rev={rev} isAuthor={isAuthor} open={open} />,
    revisions: <RevisionsPane r={r} rev={rev} />,
    reviewers: <ReviewersPane r={r} rev={rev} viewer={viewer} DB={DB} />,
    comments: <CommentsPane r={r} rev={rev} viewer={viewer} />,
    activity: <ActivityPane r={r} />,
  };
  const tabCounts = { revisions: r.revisions.length, reviewers: r.reviewers.length, comments: r.comments.length };

  return (
    <div className="slideup-backdrop" onClick={closeModal}>
      <div className="slideup-panel" onClick={e => e.stopPropagation()}>
        <div className="slideup-header">
          <div className="slideup-user">
            <div className="avatar" style={{ width: 44, height: 44, fontSize: 16 }}>📄</div>
            <div>
              <div className="slideup-name">{r.assetName}</div>
              <div className="slideup-desig">{r.id} &nbsp;·&nbsp; {reviewKindLabel(r)} &nbsp;·&nbsp; <ClassBadge asset={r} /> &nbsp;·&nbsp; Revision {rev.n} of {r.revisions.length} &nbsp;·&nbsp; <ReviewStatusTag r={r} /> &nbsp;·&nbsp; <Approvals given={countedApprovals(r).length} required={r.approvalsRequired} /></div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {primary}
            <button className="close-btn" onClick={closeModal}>×</button>
          </div>
        </div>
        <div className="profile-tabs">
          {TABS.map(t => <button key={t.id} className={`profile-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>{t.label}{tabCounts[t.id] != null ? ` (${tabCounts[t.id]})` : ''}</button>)}
        </div>
        <div className="slideup-body">{panes[tab]}</div>
      </div>
    </div>
  );
}
