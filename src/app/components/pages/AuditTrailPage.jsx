import { useState, Fragment } from 'react';
import { useApp } from '../../store.jsx';
import {
  currentUser, hasPerm, scopeOf, auditVisible, ROLE_LABELS, humanType,
  AUDIT_GROUPS, auditGroupOf, downloadCsv, accessReportRows, fmtTs, nameOfDid,
  initialsOf, EVENT_CATEGORIES, LEDGER, ORG_DID, auditVisible as auditVisibleFn,
  subjectOf, verifyLedger, tamperLedger, restoreLedger, refresh,
} from '../../core.js';
import { BlockChip } from '../Badges.jsx';

function TxStatusCell({ e }) {
  return e.height != null ? <BlockChip height={e.height} /> : <span className="crdash-muted" title="Waiting to be signed and sealed">sealing…</span>;
}

function DirAvatar({ u, size = 26 }) {
  return <div className={`avatar dir-av dir-av-${u.role.toLowerCase()}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}>{initialsOf(u.name)}</div>;
}

function LogPane({ DB, viewer, canAudit }) {
  const [group, setGroup] = useState('all');
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [type, setType] = useState('');

  const unitOnly = canAudit && scopeOf(viewer) === 'UNIT';
  let log = DB.auditLog.filter(auditVisible(viewer)).slice().sort((a, b) => new Date(b.ts) - new Date(a.ts));
  const scopeUsers = !canAudit ? [viewer] : unitOnly ? DB.users.filter(u => u.orgUnit === viewer.orgUnit) : DB.users;
  const rolesPresent = [...new Set(scopeUsers.map(u => u.role))];
  const eventTypes = [...new Set(DB.auditLog.map(e => e.type))].sort();
  const fSearch = search.trim().toLowerCase();

  log = log.filter(e => {
    const actor = DB.users.find(u => u.did === e.actor);
    if (type && e.type !== type) return false;
    if (role && (!actor || actor.role !== role)) return false;
    if (fSearch) {
      const hay = `${actor ? actor.name : ''} ${e.actor || ''} ${e.detail}`.toLowerCase();
      if (!hay.includes(fSearch)) return false;
    }
    return true;
  });
  const groupCount = id => log.filter(e => auditGroupOf(e.type) === id).length;
  const chips = [['all', 'All', log.length], ...AUDIT_GROUPS.map(g => [g.id, g.label, groupCount(g.id)])];
  if (group !== 'all') log = log.filter(e => auditGroupOf(e.type) === group);

  return (
    <>
      <div className="registry-toolbar">
        <div className="chip-row">
          {chips.map(([id, label, n]) => <button key={id} className={`filter-chip${group === id ? ' active' : ''}`} onClick={() => setGroup(id)}>{label} <span>{n}</span></button>)}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline btn-sm" onClick={() => downloadCsv('bel-audit-log.csv', log.map(e => ({ type: e.type, actor: nameOfDid(e.actor), detail: e.detail, block: e.height, when: fmtTs(e.ts) })))}>⬇ Export log (CSV)</button>
          {canAudit && <button className="btn btn-outline btn-sm" title="Every asset in your scope × every identity that can access it, and why" onClick={() => downloadCsv('bel-access-report.csv', accessReportRows(viewer))}>⬇ Access report (CSV)</button>}
        </div>
      </div>
      <div className="dir-toolbar">
        <input type="search" className="dir-search" placeholder="Search by person, DID or detail…" autoComplete="off" value={search} onChange={e => setSearch(e.target.value)} />
        <select value={role} onChange={e => setRole(e.target.value)}><option value="">All roles</option>{rolesPresent.map(r => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}</select>
        <select value={type} onChange={e => setType(e.target.value)}><option value="">All event types</option>{eventTypes.map(t => <option key={t} value={t}>{humanType(t)}</option>)}</select>
        {(type || role || fSearch || group !== 'all') && <button className="link-btn" onClick={() => { setType(''); setRole(''); setSearch(''); setGroup('all'); }}>Clear filters</button>}
      </div>
      <table className="crdash-table registry-table">
        <thead><tr><th>Event</th><th>Who</th><th>Detail</th><th>Block</th><th>When</th></tr></thead>
        <tbody>
          {log.length === 0 ? <tr><td colSpan={5}><div className="no-data">No events match these filters</div></td></tr> : log.map(e => {
            const actor = DB.users.find(u => u.did === e.actor);
            return (
              <tr key={e.id}>
                <td style={{ whiteSpace: 'nowrap' }}><strong style={{ fontSize: 13 }}>{humanType(e.type)}</strong><div className="crdash-muted mono" style={{ fontSize: 10 }}>{e.type}</div></td>
                <td>{actor ? <div className="crdash-who"><DirAvatar u={actor} /><div><div style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{actor.name}</div><span className={`dir-role dir-role-${actor.role.toLowerCase()}`}>{ROLE_LABELS[actor.role] || actor.role}</span></div></div> : <span className="crdash-muted">{e.actor === ORG_DID ? 'BEL (organisation)' : (e.actor || '—')}</span>}</td>
                <td style={{ fontSize: 12, color: '#4a5563' }}>{e.detail}</td>
                <td><TxStatusCell e={e} /></td>
                <td className="crdash-muted" style={{ whiteSpace: 'nowrap' }}>{fmtTs(e.ts)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function AnalyticsPane({ DB, log }) {
  if (log.length === 0) return <div className="no-data" style={{ padding: '30px 0' }}>No audit events to analyze yet</div>;
  const typeCounts = {}, actorCounts = {}, roleCounts = {};
  log.forEach(e => {
    typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
    actorCounts[e.actor] = (actorCounts[e.actor] || 0) + 1;
    const actor = DB.users.find(u => u.did === e.actor);
    const r = actor ? (ROLE_LABELS[actor.role] || actor.role) : e.actor === ORG_DID ? 'BEL (organisation)' : 'Unknown';
    roleCounts[r] = (roleCounts[r] || 0) + 1;
  });
  const byType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
  const byActor = Object.entries(actorCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const byRole = Object.entries(roleCounts).sort((a, b) => b[1] - a[1]);
  const days = [];
  for (let i = 13; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push(d.toISOString().slice(0, 10)); }
  const dayCounts = days.map(d => log.filter(e => (e.ts || '').slice(0, 10) === d).length);
  const maxDay = Math.max(1, ...dayCounts);
  const todayStr = new Date().toISOString().slice(0, 10);
  const eventsToday = log.filter(e => (e.ts || '').slice(0, 10) === todayStr).length;
  const topType = byType[0], topActorEntry = byActor[0];

  const BarList = ({ entries, labelFor }) => {
    const max = Math.max(1, ...entries.map(([, c]) => c));
    return entries.map(([key, count]) => {
      const pct = Math.max(4, Math.round((count / max) * 100));
      return (
        <div className="ana-bar-row" key={key}>
          <span className="ana-bar-label" title={labelFor(key)}>{labelFor(key)}</span>
          <div className="ana-bar-track"><div className="ana-bar-fill" style={{ width: `${pct}%` }} title={`${count} event${count === 1 ? '' : 's'}`} /></div>
          <span className="ana-bar-value">{count}</span>
        </div>
      );
    });
  };

  return (
    <>
      <div className="ana-stat-row">
        <div className="ana-stat-tile"><div className="num">{log.length}</div><div className="lbl">Total Events</div></div>
        <div className="ana-stat-tile"><div className="num">{eventsToday}</div><div className="lbl">Events Today</div></div>
        <div className="ana-stat-tile"><div className="num" style={{ fontSize: 15, lineHeight: '32px' }}>{topType ? humanType(topType[0]) : '—'}</div><div className="lbl">Most Common Event</div></div>
        <div className="ana-stat-tile"><div className="num" style={{ fontSize: 15, lineHeight: '32px' }}>{topActorEntry ? nameOfDid(topActorEntry[0]) : '—'}</div><div className="lbl">Most Active Principal</div></div>
      </div>
      <div className="ana-section">
        <h4>Activity — Last 14 Days</h4>
        <div className="ana-trend">
          {days.map((d, i) => {
            const c = dayCounts[i]; const h = Math.max(2, Math.round((c / maxDay) * 100)); const label = d.slice(5).replace('-', '/');
            return <div className="ana-trend-bar-wrap" key={d}><div className="ana-trend-bar" style={{ height: `${h}%` }} title={`${label}: ${c} event${c === 1 ? '' : 's'}`} /><span className="ana-trend-label">{i % 2 === 0 ? label : ''}</span></div>;
          })}
        </div>
      </div>
      <div className="ana-grid">
        <div className="ana-section"><h4>Event Type Distribution</h4><BarList entries={byType} labelFor={humanType} /></div>
        <div className="ana-section"><h4>Most Active Principals</h4>{byActor.length === 0 ? <div className="no-data">No actor data</div> : <BarList entries={byActor} labelFor={nameOfDid} />}</div>
        <div className="ana-section"><h4>Events by Role</h4><BarList entries={byRole} labelFor={k => k} /></div>
      </div>
    </>
  );
}

function ChainExplorer({ viewer }) {
  const { State: liveState } = useApp();
  const [busy, setBusy] = useState(false);
  const C = LEDGER.Chain;
  const head = C.head();
  const rep = liveState.chainReport;
  const canDemo = hasPerm(viewer, 'VIEW_AUDIT');
  const visible = auditVisibleFn(viewer);
  const txVisible = tx => visible({ actor: tx.contract === 'Audit' && tx.method === 'import' ? tx.args.legacyActor : tx.actor, detail: tx.detail, subject: subjectOf(tx) });
  const orgWide = hasPerm(viewer, 'VIEW_AUDIT') && ['HQ', 'ALL_READ'].includes(scopeOf(viewer));
  const counts = {};
  C.txs().filter(({ tx }) => orgWide || txVisible(tx)).forEach(({ tx }) => {
    const t = tx.contract === 'Audit' && tx.method === 'import' ? tx.args.legacyType : tx.type;
    counts[t] = (counts[t] || 0) + 1;
  });
  const recent = (orgWide ? C.blocks : C.blocks.filter(b => b.height > 0 && b.txs.some(txVisible))).slice(-50).reverse();

  const Check = ({ label, issues, okText }) => (
    <div className={`chain-check ${issues.length ? 'bad' : 'ok'}`}>
      <div className="chain-check-head">{issues.length ? '✗' : '✓'} {label}</div>
      {issues.length ? (
        <ul>
          {issues.slice(0, 6).map((i, idx) => <li key={idx}>{i.height != null ? <a href="#" onClick={e => { e.preventDefault(); liveState.chainOpenBlock = i.height; liveState.auditActiveTab = 'chain'; refresh(); }}>Block #{i.height}</a> : null}{i.height != null ? ' — ' : ''}{i.msg}</li>)}
          {issues.length > 6 && <li>…and {issues.length - 6} more</li>}
        </ul>
      ) : <div className="text-muted">{okText}</div>}
    </div>
  );

  async function doVerify() { setBusy(true); await verifyLedger(); setBusy(false); }
  async function doTamper(mode) { if (!mode) return; await tamperLedger(mode); }
  async function doRestore() { restoreLedger(); await verifyLedger(); }

  return (
    <>
      {C.tampered && <div className="alert alert-danger" style={{ marginBottom: 14 }}>⚠ Tamper demo active ({C.tampered.mode}) — only this browser's in-memory copy was altered (nothing was saved or shared); actions are frozen until you restore it. <button className="btn btn-sm btn-outline" style={{ marginLeft: 8 }} onClick={doRestore}>↺ Restore ledger</button></div>}
      {C.halted && <div className="alert alert-danger" style={{ marginBottom: 14 }}>⛔ {C.halted}</div>}
      <div className="chain-stats">
        <div className="chain-stat"><div className="chain-stat-label">Block height</div><div className="chain-stat-value">#{head ? head.height : '—'}</div></div>
        <div className="chain-stat"><div className="chain-stat-label">Transactions</div><div className="chain-stat-value">{C.txs().length}</div></div>
        <div className="chain-stat"><div className="chain-stat-label">Head hash</div><div className="chain-stat-value mono" style={{ fontSize: 12 }} title={head ? head.hash : ''}>{head ? head.hash.slice(0, 16) + '…' : '—'}</div></div>
      </div>
      <div className="table-wrap" style={{ marginBottom: 18 }}>
        <div className="table-head"><span className="table-title">Integrity Verification</span>
          <span style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={doVerify}>{busy ? 'Verifying…' : 'Verify ledger'}</button>
            {canDemo && !C.tampered && (
              <select className="btn-sm" defaultValue="" onChange={e => { doTamper(e.target.value); e.target.value = ''; }}>
                <option value="">Tamper demo (this browser only)…</option>
                <option value="edit-tx">Edit a transaction</option>
                <option value="rehash">Edit + re-hash a block</option>
                <option value="forge-db">Forge a database record</option>
                <option value="inject">Inject an unauthorized transaction</option>
              </select>
            )}
          </span>
        </div>
        <div style={{ padding: '14px 18px' }}>
          {!rep ? <div className="text-muted">Recomputes every block hash and link, verifies every ECDSA signature (and DID login proof) against the signer's DID Document, replays every transaction through the smart-contract rules from an empty state, and compares the result with the live database.</div> : (
            <>
              <div className="text-muted" style={{ marginBottom: 10 }}>Checked {rep.blocks} blocks · {rep.txs} transactions · {rep.sigs} signatures in {rep.ms} ms</div>
              <div className="chain-checks">
                <Check label="Block hashes" issues={rep.structure} okText="Every transaction, transaction root and block header matches its hash" />
                <Check label="Hash links" issues={rep.links} okText="Every block points to the hash of the one before it" />
                <Check label="Signatures" issues={rep.signature} okText="Every transaction is signed by the DID that sent it" />
                <Check label="Smart-contract rules" issues={rep.authorization} okText="Every transaction was allowed by the contracts at the time (RBAC, custody, minting)" />
                <Check label="State roots" issues={rep.state} okText="Replayed state matches the state root recorded in every block" />
                <Check label="Database vs ledger" issues={rep.db} okText="Every identity, role, NFT, review, delegation and transfer in the database matches the ledger" />
              </div>
            </>
          )}
        </div>
      </div>
      <div className="table-wrap" style={{ marginBottom: 18 }}>
        <div className="table-head"><span className="table-title">Recorded on-chain (problem-statement events){orgWide ? '' : ' — in your scope'}</span></div>
        <div className="chain-cats">
          {EVENT_CATEGORIES.map(c => <div className="chain-cat" key={c.label}><div className="chain-cat-n">{c.types.reduce((n, t) => n + (counts[t] || 0), 0)}</div><div className="chain-cat-label">{c.label}</div></div>)}
        </div>
      </div>
      <div className="dir-section-title" style={{ margin: '22px 0 8px' }}>{orgWide ? `Blocks (latest ${recent.length})` : `Blocks in your scope (latest ${recent.length})`}</div>
      <table className="crdash-table registry-table">
        <thead><tr><th>Block</th><th>Transaction</th><th>Signed by</th><th>Tx hash</th><th>When</th></tr></thead>
        <tbody>
          {recent.map(b => {
            const tx = b.txs[0];
            const open = liveState.chainOpenBlock === b.height;
            return (
              <Fragment key={b.height}>
                <tr className="crdash-row" title="Show the raw block" onClick={() => { liveState.chainOpenBlock = open ? null : b.height; refresh(); }}>
                  <td><BlockChip height={b.height} /></td>
                  <td>{b.height === 0 ? <><strong>Genesis</strong> <span className="text-muted">({b.txs.length} transactions)</span></> : <><strong style={{ fontSize: 13 }}>{humanType(tx.type)}</strong> <span className="crdash-muted mono" style={{ fontSize: 10.5 }}>{tx.contract}.{tx.method}</span><div className="crdash-muted">{tx.detail}</div></>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{nameOfDid(tx.actor)}</td>
                  <td className="mono" style={{ fontSize: 10.5 }} title={tx.hash}>{tx.hash.slice(0, 12)}…</td>
                  <td className="crdash-muted" style={{ whiteSpace: 'nowrap' }}>{fmtTs(b.ts)}</td>
                </tr>
                {open && <tr><td colSpan={5}><pre className="chain-json">{JSON.stringify(b.height === 0 ? { ...b, txs: `${b.txs.length} transactions (first 3 shown)`, sample: b.txs.slice(0, 3) } : b, null, 2)}</pre></td></tr>}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

// Real JSX port of app.js's renderAuditTrail() (Log / Analytics / Blockchain tabs).
export default function AuditTrailPage() {
  const { DB } = useApp();
  const viewer = currentUser();
  const canAudit = hasPerm(viewer, 'VIEW_AUDIT');
  const unitOnly = canAudit && scopeOf(viewer) === 'UNIT';
  const [tab, setTab] = useState('log');
  const scopedLog = DB.auditLog.filter(auditVisible(viewer));

  return (
    <>
      <div className="page-header"><h2>Audit Trail</h2><p>{!canAudit ? 'Your own activity — every entry is a signed transaction on the ledger' : unitOnly ? 'Chronological activity within your unit' : 'Chronological activity across all users and roles'} · tamper-evident: see the Blockchain tab</p></div>
      <div className="crdash-section dash-plain audit-plain">
        <div className="profile-tabs" style={{ padding: '0 20px' }}>
          <button className={`profile-tab${tab === 'log' ? ' active' : ''}`} onClick={() => setTab('log')}>Log</button>
          <button className={`profile-tab${tab === 'analytics' ? ' active' : ''}`} onClick={() => setTab('analytics')}>Analytics</button>
          <button className={`profile-tab${tab === 'chain' ? ' active' : ''}`} onClick={() => setTab('chain')}>Blockchain</button>
        </div>
        <div className="audit-pane">
          {tab === 'analytics' ? <AnalyticsPane DB={DB} log={scopedLog} /> : tab === 'chain' ? <ChainExplorer viewer={viewer} /> : <LogPane DB={DB} viewer={viewer} canAudit={canAudit} />}
        </div>
      </div>
    </>
  );
}
