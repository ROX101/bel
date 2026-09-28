import { useState } from 'react';
import { closeModal, openModal, getOrgRoot, getDirectReports, initialsOf } from '../../core.js';

function OrgNode({ user, depth, expanded, toggle }) {
  const children = getDirectReports(user.id);
  const isOpen = expanded.has(user.id);
  return (
    <div className="org-node">
      <div className="org-node-row" style={{ paddingLeft: depth * 26 }}>
        {children.length > 0 ? <button className="org-toggle" onClick={() => toggle(user.id)}>{isOpen ? '−' : '+'}</button> : <span className="org-toggle-spacer" />}
        <div className="avatar" style={{ width: 32, height: 32, fontSize: 12, flexShrink: 0, cursor: 'pointer' }} title="View full profile" onClick={() => openModal({ type: 'employee-profile', uid: user.id })}>{initialsOf(user.name)}</div>
        <div className="org-node-info" style={{ cursor: 'pointer' }} onClick={() => openModal({ type: 'employee-profile', uid: user.id })}>
          <div className="org-node-name">{user.name}</div>
          <div className="org-node-desig">{user.designation} &nbsp;·&nbsp; {user.orgUnit}</div>
        </div>
        {children.length > 0 && <span className="text-muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{children.length} report{children.length > 1 ? 's' : ''}</span>}
      </div>
      {isOpen && children.length > 0 && (
        <div className="org-children">
          {children.map(c => <OrgNode key={c.id} user={c} depth={depth + 1} expanded={expanded} toggle={toggle} />)}
        </div>
      )}
    </div>
  );
}

function allIds(user, acc) {
  acc.add(user.id);
  getDirectReports(user.id).forEach(c => allIds(c, acc));
  return acc;
}

// Real JSX port of app.js's renderModal() 'full-org-chart' branch (org tree with expand/collapse).
export default function OrgChartModal() {
  const orgRoot = getOrgRoot();
  const [expanded, setExpanded] = useState(new Set(orgRoot ? [orgRoot.id] : []));
  function toggle(id) { setExpanded(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  function expandAll() { if (orgRoot) setExpanded(allIds(orgRoot, new Set())); }
  function collapseAll() { setExpanded(new Set(orgRoot ? [orgRoot.id] : [])); }

  return (
    <div className="modal-backdrop" onClick={closeModal}>
      <div className="modal" style={{ width: 920 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header"><h3>Full Organization Chart</h3><button className="close-btn" onClick={closeModal}>×</button></div>
        <div className="modal-body">
          <div className="org-toolbar">
            <button className="btn btn-sm btn-outline" onClick={expandAll}>Expand All</button>
            <button className="btn btn-sm btn-outline" onClick={collapseAll}>Collapse All</button>
          </div>
          <div className="org-chart-wrap" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            {orgRoot ? <OrgNode user={orgRoot} depth={0} expanded={expanded} toggle={toggle} /> : <div className="no-data">No root identity found</div>}
          </div>
        </div>
        <div className="modal-footer"><button className="btn btn-outline" onClick={closeModal}>Close</button></div>
      </div>
    </div>
  );
}
