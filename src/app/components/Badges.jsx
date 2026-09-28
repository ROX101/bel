import { CLASS_BADGE } from '../core.js';

// JSX ports of app.js's accessBadge()/classBadge()/blockChip() markup builders (deliberately
// not ported into core.js since core.js holds data/logic only — see its header comment).
export function AccessBadge({ level }) {
  if (!level) return <span className="crdash-muted">—</span>;
  return <span className={`access-badge access-${level.toLowerCase()}`}>{level}</span>;
}

export function ClassBadge({ asset }) {
  const c = (asset && asset.classification) || 'Unclassified';
  if (c === 'Unclassified') return null;
  return <span className={`badge ${CLASS_BADGE[c] || 'badge-expired'}`} title="Security classification">{c === 'Secret' ? '🔒 ' : ''}{c}</span>;
}

export function BlockChip({ height }) {
  return <span className="rev-chip" title={`Sealed in block ${height}`}>#{height}</span>;
}
