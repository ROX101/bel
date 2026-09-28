/* ============================================================
   SupabaseSync — thin backend layer for the BEL Portal prototype
   ============================================================
   Ported from the original vanilla-JS bel-portal/supabase-sync.js. The sync
   logic itself (what it reads/writes, the row<->app-object field mapping,
   the upsert order, the ledger-block append/conflict handling) is
   UNCHANGED. Two things were adapted for the React project, both purely
   mechanical, never touching what gets read/written:
     1. The supabase-js client comes from the `@supabase/supabase-js` npm
        package (import { createClient }) instead of the CDN UMD global
        `window.supabase` that index.html used to <script>-tag in. Same
        client, same calls — just imported instead of loaded off a CDN
        that Vite's own index.html no longer references.
     2. A tiny pub/sub (`subscribe`/`getStatus`) plus a `useSupabaseSync()`
        hook (see the bottom of this file) were ADDED so React components
        can reactively read { configured, ready } instead of poking
        `window.SupabaseSync.isReady` directly — nothing existing was
        removed, `window.SupabaseSync` is still set for the ported legacy
        UI layer (src/legacy/app-legacy.js), which still calls
        `window.SupabaseSync.syncAll(...)` etc. exactly as the original
        app.js did.
   The app's data model lives in the in-memory `DB` object in
   src/legacy/app-legacy.js, exactly as it always has — every render()
   call still reads from DB.* directly, so none of the existing
   render/permission code had to change. This file is the ONLY thing that
   talks to Supabase. It:
     1. hydrateAll()  — on boot, pulls every table from Supabase and
        replaces DB.users / DB.assets / DB.reviews / DB.delegations /
        DB.auditLog / DB.roleDefinitions with the real data.
     2. syncAll(event) — after every mutation (hooked once, from inside
        addAudit() in app-legacy.js, since virtually every mutating action
        in the app already calls addAudit() right after it touches DB.*),
        upserts the full current state of every table back to Supabase.
     3. uploadAssetBlob(file, hash) — uploads a real file to Supabase
        Storage and returns its storage path.

   If config.js has no credentials yet, `window.SupabaseSync` still
   exists but every method is a harmless no-op / resolves to null — the
   app keeps working exactly as it does today, entirely offline, until
   credentials are added.
   ============================================================ */
import { useSyncExternalStore } from 'react';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_CONFIG } from '../config.js';

const cfg = SUPABASE_CONFIG || {};
const configured = !!(cfg.url && cfg.anonKey);

let client = null;
if (configured) {
  try { client = createClient(cfg.url, cfg.anonKey); }
  catch (e) { console.warn('SupabaseSync: failed to create the supabase-js client.', e); }
}

const bucket = cfg.storageBucket || 'bel-assets';
// Nothing is written until the app has finished loading (hydrate + ledger), so actions taken
// while data is still loading can never overwrite the real database with built-in mock data.
let ready = false;
// Columns/tables added by supabase/migrations/002_ledger.sql — only used once detected.
const caps = { nft: false, didDoc: false, transfers: false, ledger: false, roleScope: false, keystore: false };

// ── React-friendly status store (added; does not change any sync logic above/below) ──
const listeners = new Set();
function notifyStatus() { listeners.forEach(fn => fn()); }
function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function getStatus() { return { configured, ready, caps }; }

// ── row <-> app-object field mapping ──────────────────────────────
const toRole = r => ({ id: r.id, name: r.name, permissions: r.permissions || [], orgScope: r.org_scope, ...(r.scope ? { scope: r.scope } : {}) });
const fromRole = r => ({ id: r.id, name: r.name, permissions: r.permissions || [], org_scope: r.orgScope || null, ...(caps.roleScope ? { scope: r.scope || 'SELF' } : {}) });

const toUser = r => ({
  id: r.id, name: r.name, did: r.did, designation: r.designation, role: r.role,
  orgUnit: r.org_unit, reportsTo: r.reports_to, status: r.status,
  uploadRights: r.upload_rights, joined: r.joined, permOverrides: r.perm_overrides || null,
  ...(r.did_doc ? { didDoc: r.did_doc } : {}), ...(r.pii_commitment ? { piiCommitment: r.pii_commitment } : {}),
  ...(r.email ? { email: r.email } : {}), ...(r.keystore ? { keystore: r.keystore } : {}),
});
const fromUser = u => ({
  id: u.id, name: u.name, did: u.did, designation: u.designation, role: u.role,
  org_unit: u.orgUnit, reports_to: u.reportsTo || null, status: u.status,
  upload_rights: !!u.uploadRights, joined: u.joined || null, perm_overrides: u.permOverrides || null,
  ...(caps.didDoc ? { did_doc: u.didDoc || null, pii_commitment: u.piiCommitment || null } : {}),
  ...(caps.keystore ? { email: u.email || null, keystore: u.keystore || null } : {}),
});

const toAsset = r => ({
  id: r.id, name: r.name, owner: r.owner, orgUnit: r.org_unit, hash: r.hash, size: r.size,
  status: r.status, uploadedAt: r.uploaded_at, approvedBy: r.approved_by, approvedAt: r.approved_at,
  rejectReason: r.reject_reason, desc: r.description, approvalsRequired: r.approvals_required,
  version: r.version, storagePath: r.storage_path,
  ...(r.token_id != null ? { tokenId: r.token_id, issuer: r.issuer, mintedAt: r.minted_at, mintedBy: r.minted_by } : {}),
  ...('pending_transfer_id' in r ? { pendingTransferId: r.pending_transfer_id } : {}),
  ...(r.classification ? { classification: r.classification } : {}),
  ...(r.retired_at ? { retiredAt: r.retired_at, retiredBy: r.retired_by } : {}),
});
const fromAsset = a => ({
  id: a.id, name: a.name, owner: a.owner, org_unit: a.orgUnit, hash: a.hash, size: a.size,
  status: a.status, uploaded_at: a.uploadedAt || null, approved_by: a.approvedBy || null,
  approved_at: a.approvedAt || null, reject_reason: a.rejectReason || null, description: a.desc || null,
  approvals_required: a.approvalsRequired ?? 1, version: a.version || 1, storage_path: a.storagePath || null,
  ...(caps.nft ? { token_id: a.tokenId || null, issuer: a.issuer || null, minted_at: a.mintedAt || null, minted_by: a.mintedBy || null, pending_transfer_id: a.pendingTransferId || null,
    classification: a.classification || 'Unclassified', retired_at: a.retiredAt || null, retired_by: a.retiredBy || null } : {}),
});

const toReview = r => ({
  id: r.id, kind: r.kind, assetId: r.asset_id, assetName: r.asset_name, newAsset: r.new_asset,
  authorDid: r.author_did, orgUnit: r.org_unit, status: r.status, desc: r.description,
  approvalsRequired: r.approvals_required, createdAt: r.created_at, updatedAt: r.updated_at,
  mergedAt: r.merged_at, mergedBy: r.merged_by, canceledAt: r.canceled_at, canceledBy: r.canceled_by,
  cancelReason: r.cancel_reason, reviewers: r.reviewers || [], revisions: r.revisions || [],
  comments: r.comments || [], events: r.events || [],
});
const fromReview = r => ({
  id: r.id, kind: r.kind, asset_id: r.assetId || null, asset_name: r.assetName, new_asset: r.newAsset || null,
  author_did: r.authorDid, org_unit: r.orgUnit, status: r.status, description: r.desc || null,
  approvals_required: r.approvalsRequired, created_at: r.createdAt, updated_at: r.updatedAt,
  merged_at: r.mergedAt || null, merged_by: r.mergedBy || null, canceled_at: r.canceledAt || null,
  canceled_by: r.canceledBy || null, cancel_reason: r.cancelReason || null,
  reviewers: r.reviewers || [], revisions: r.revisions || [], comments: r.comments || [], events: r.events || [],
});

const toDeleg = r => ({
  id: r.id, assetId: r.asset_id, assetName: r.asset_name, fromDID: r.from_did, toDID: r.to_did,
  permissions: r.permissions || [], status: r.status, requestedAt: r.requested_at,
  expiresAt: r.expires_at, approvedAt: r.approved_at,
});
const fromDeleg = d => ({
  id: d.id, asset_id: d.assetId, asset_name: d.assetName, from_did: d.fromDID, to_did: d.toDID,
  permissions: d.permissions || [], status: d.status, requested_at: d.requestedAt || null,
  expires_at: d.expiresAt || null, approved_at: d.approvedAt || null,
});

const toEvent = r => ({ id: r.id, type: r.type, actor: r.actor, detail: r.detail, ts: r.ts });
const fromEvent = e => ({ id: e.id, type: e.type, actor: e.actor, detail: e.detail, ts: e.ts });
const toTransfer = r => ({ id: r.id, assetId: r.asset_id, tokenId: r.token_id, fromDid: r.from_did, toDid: r.to_did, mode: r.mode, status: r.status,
  reason: r.reason, requestedAt: r.requested_at, decidedBy: r.decided_by, decidedAt: r.decided_at });
const fromTransfer = t => ({ id: t.id, asset_id: t.assetId, token_id: t.tokenId || null, from_did: t.fromDid, to_did: t.toDid, mode: t.mode, status: t.status,
  reason: t.reason || null, requested_at: t.requestedAt || null, decided_by: t.decidedBy || null, decided_at: t.decidedAt || null });
const toBlock = r => ({ height: Number(r.height), hash: r.hash, prevHash: r.prev_hash, ts: r.ts, txRoot: r.tx_root, stateRoots: r.state_roots, txs: r.txs });
const fromBlock = b => ({ height: b.height, hash: b.hash, prev_hash: b.prevHash, ts: b.ts, tx_root: b.txRoot, state_roots: b.stateRoots, txs: b.txs });

async function hydrateAll() {
  if (!client) return false;
  const [roles, users, assets, reviews, delegations] = await Promise.all([
    client.from('role_definitions').select('*'),
    client.from('users').select('*'),
    client.from('assets').select('*'),
    client.from('reviews').select('*'),
    client.from('delegations').select('*'),
  ]);
  const failed = [roles, users, assets, reviews, delegations].find(r => r.error);
  if (failed) { console.warn('SupabaseSync.hydrateAll:', failed.error.message); return false; }
  if (!users.data.length) return false; // empty project (schema not seeded yet) — keep the built-in mock data
  caps.nft = !!(assets.data[0] && 'token_id' in assets.data[0]);
  caps.roleScope = !!(roles.data[0] && 'scope' in roles.data[0]);
  caps.keystore = !!(users.data[0] && 'keystore' in users.data[0]);
  caps.didDoc = !!(users.data[0] && 'did_doc' in users.data[0]);
  const transfers = await client.from('transfers').select('*');
  caps.transfers = !transfers.error;
  window.DB.roleDefinitions = roles.data.map(toRole);
  window.DB.users = users.data.map(toUser);
  window.DB.assets = assets.data.map(toAsset);
  window.DB.reviews = reviews.data.map(toReview);
  window.DB.delegations = delegations.data.map(toDeleg);
  window.DB.transfers = caps.transfers ? transfers.data.map(toTransfer) : [];
  window.DB.auditLog = []; // rebuilt from the ledger
  return true;
}

// Ledger blocks are append-only in the database (see 002_ledger.sql): insert + select only.
async function loadLedger() {
  if (!client) return { ok: false };
  const { data, error } = await client.from('ledger_blocks').select('*').order('height', { ascending: true });
  if (error) { console.warn('SupabaseSync.loadLedger (run supabase/migrations/002_ledger.sql to share the ledger):', error.message); return { ok: false }; }
  caps.ledger = true;
  return { ok: true, blocks: data.map(toBlock) };
}
// Height of the shared ledger's head (−1 if empty / unavailable) — polled to pick up other users' changes.
async function remoteHeight() {
  if (!client || !caps.ledger) return null;
  const { data, error } = await client.from('ledger_blocks').select('height').order('height', { ascending: false }).limit(1);
  if (error) return null;
  return data.length ? Number(data[0].height) : -1;
}
async function appendBlocks(blocks) {
  if (!client || !caps.ledger) return { ok: false };
  const { error } = await client.from('ledger_blocks').insert(blocks.map(fromBlock));
  if (!error) return { ok: true };
  const conflict = error.code === '23505' || /prev_hash|height/i.test(error.message || '');
  console.warn('SupabaseSync.appendBlocks:', error.message);
  return { ok: false, conflict, error };
}
async function deleteRows(table, ids) {
  if (!client || !ready || !ids.length) return;
  const { error } = await client.from(table).delete().in('id', ids);
  if (error) console.warn(`SupabaseSync.deleteRows(${table}):`, error.message);
}

// Upserts the full current state of every table. Called after every mutation (see
// addAudit() in app-legacy.js) — the demo dataset is tiny, so re-upserting whole tables on
// each action is simpler and far less error-prone than diffing, at negligible cost.
async function syncAll(newEvent) {
  if (!client || !ready) return;
  // Sequenced (not parallel) so foreign keys always resolve: role_definitions before
  // users (users.role → role_definitions), users before assets/reviews/delegations
  // (they reference users.did), assets before reviews (reviews.asset_id → assets.id).
  const steps = [
    () => client.from('role_definitions').upsert(window.DB.roleDefinitions.map(fromRole)),
    () => client.from('users').upsert(window.DB.users.map(fromUser)),
    () => client.from('assets').upsert(window.DB.assets.map(fromAsset)),
    () => Promise.all([
      client.from('reviews').upsert(window.DB.reviews.map(fromReview)),
      client.from('delegations').upsert(window.DB.delegations.map(fromDeleg)),
      caps.transfers && window.DB.transfers.length ? client.from('transfers').upsert(window.DB.transfers.map(fromTransfer)) : null,
    ]),
    () => newEvent ? client.from('audit_log').insert(fromEvent(newEvent)) : null,
  ];
  for (const step of steps) {
    const result = await step();
    const errs = Array.isArray(result) ? result.filter(r => r && r.error) : (result && result.error ? [result] : []);
    errs.forEach(r => console.warn('SupabaseSync.syncAll:', r.error.message));
  }
}

async function uploadAssetBlob(file, hash) {
  if (!client) return null;
  const path = `${hash}/${encodeURIComponent(file.name)}`;
  const { error } = await client.storage.from(bucket).upload(path, file, { upsert: true, contentType: file.type || 'application/octet-stream' });
  if (error) throw error;
  return path;
}

async function downloadAssetBlob(path) {
  if (!client || !path) return null;
  const { data, error } = await client.storage.from(bucket).download(path);
  if (error) throw error;
  return data;
}

// `window.DB` is the in-memory data store the ported legacy UI layer
// (src/legacy/app-legacy.js) bridges onto window right after defining it, so this
// module — loaded as a separate ES module rather than sharing that file's scope —
// can still reach it. hydrateAll/syncAll only ever touch it from inside async
// functions invoked well after boot, never at module-evaluation time, so it's
// always populated by the time these run.
const SupabaseSyncBase = {
  isConfigured: configured, hydrateAll, syncAll, uploadAssetBlob, downloadAssetBlob, loadLedger, appendBlocks, deleteRows, remoteHeight,
  setReady(v) { ready = !!v; notifyStatus(); },
  get isReady() { return ready; },
  caps,
};

if (typeof window !== 'undefined') window.SupabaseSync = SupabaseSyncBase;

export const SupabaseSync = SupabaseSyncBase;
export default SupabaseSyncBase;

// ── React hook (added) ── reactive { configured, ready, caps } for any component that wants
// to show sync status without polling window.SupabaseSync.isReady itself.
export function useSupabaseSync() {
  return useSyncExternalStore(subscribe, getStatus, getStatus);
}
