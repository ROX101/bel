/* ============================================================
   BEL Portal — application core (data + business logic)
   ============================================================
   This is the non-visual half of the original bel-portal/app.js, ported
   with its logic UNCHANGED: the mock DB seed, the ledger/contract-calling
   functions (commit/tryCommit/addAudit), every RBAC/review/custody/
   identity business rule and action (signIn, createAsset, mergeReview,
   mintAsset, transfer, onboarding, …), and the ledger boot sequence.
   Only the following are genuinely different from app.js, all mechanical:
     • every `render()` call became `Store.notify()` — React re-renders
       subscribed components instead of an innerHTML rebuild;
     • the few spots that reached into the DOM directly to avoid a full
       re-render (e.g. patching one <span> after a block seals) were
       simplified to a plain notify(), since a real DOM diff makes that
       optimization unnecessary;
     • `esc(x)` calls that existed only because the original rendered by
       building HTML strings were dropped (JSX escapes text automatically,
       so keeping them would double-escape names like "O'Brien" as
       "O&amp;#39;Brien" once rendered as JSX text) — the *data* itself
       (names, reasons, detail strings) is otherwise stored exactly as
       before;
     • toast() no longer touches a #toast DOM node directly — it just sets
       State.toast and notifies; src/app/components/Toast.jsx renders it
       reactively, which is simpler than the original's imperative
       show/hide and behaves identically to the user.
   DB / Session / State are still one big mutable object each, exactly as
   in the original (renamed nowhere) — see the "STORE" section below for
   why that choice was kept rather than rewritten as an immutable
   useReducer tree.
   ============================================================ */

import { Keys, Keystore, Wallet, Chain, hashRoots, b64u, canonical, sha256Hex as ledgerSha256Hex } from '../engine/ledger.js';
import * as CONTRACTS from '../engine/contracts.js';
import { BEL_DEMO_ACCOUNTS, BEL_DEMO_PASSWORD, BEL_PUBLIC_KEYS } from '../engine/demo-wallets.js';
import { SupabaseSync } from '../engine/supabase-sync.js';

const LEDGER = { Keys, Keystore, Wallet, Chain, hashRoots, b64u, canonical, sha256Hex: ledgerSha256Hex };
const ORG_DID = CONTRACTS.ORG_DID;
const RULES = CONTRACTS.rules;

// ── Tiny external store (subscribe/notify) ──────────────────────────
// DB/Session/State stay exactly the kind of big mutable objects the
// original app.js used (see its own "APP STATE" comment) — hundreds of
// call sites across the ported logic below do `State.x = y` inline, the
// same way app.js did. Rewriting all of those into an immutable
// useReducer tree would touch nearly every function in this file for no
// behavioural gain, so instead this module exposes them through
// `useSyncExternalStore` (React's own hook for exactly this situation:
// external, mutable, imperatively-updated state). Any component that
// reads DB/Session/State through the `useApp()` hook in store.jsx
// re-renders whenever `Store.notify()` runs, which is every former
// `render()` call site.
const listeners = new Set();
export const Store = {
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  notify() { listeners.forEach(fn => fn()); },
  getSnapshot() { return snapshotVersion; },
};
let snapshotVersion = 0;
function notify() { snapshotVersion++; Store.notify(); }

// ─────────────────────────────────────────────
// MOCK DATA STORE (in-memory, lives until refresh) — identical seed data to the original app.js
// ─────────────────────────────────────────────
export const DB = {
  users: [
    { id: 'u_cmd',    name: 'Adm. Vishwanath Rao (Retd.)', did: 'did:bel:cmd001',    designation: 'Chairman & Managing Director',        role: 'ADMIN', orgUnit: 'Corporate Office',   reportsTo: null,       status: 'active', uploadRights: true,  joined: '2019-04-01' },
    { id: 'u1',       name: 'Rajesh Kumar',                did: 'did:bel:admin001',  designation: 'Director (Bangalore Complex)',        role: 'ADMIN', orgUnit: 'Bangalore Complex',  reportsTo: 'u_cmd',   status: 'active', uploadRights: true,  joined: '2019-11-18' },
    { id: 'u_dirrnd', name: 'Meenakshi Subramaniam',       did: 'did:bel:dirrnd001', designation: 'Director (R&D)',                       role: 'ADMIN', orgUnit: 'Research & Development', reportsTo: 'u_cmd', status: 'active', uploadRights: true,  joined: '2020-06-15' },
    { id: 'u_dirfin', name: 'Arvind Bose',                 did: 'did:bel:dirfin001', designation: 'Director (Finance)',                   role: 'ADMIN', orgUnit: 'Finance',            reportsTo: 'u_cmd',   status: 'active', uploadRights: true,  joined: '2021-01-10' },
    { id: 'u_dirmktg',name: 'Kavitha Iyer',                did: 'did:bel:dirmktg001',designation: 'Director (Marketing)',                 role: 'ADMIN', orgUnit: 'Marketing',          reportsTo: 'u_cmd',   status: 'active', uploadRights: true,  joined: '2020-11-03' },
    { id: 'u_dirou',  name: 'Suresh Pillai',               did: 'did:bel:dirou001',  designation: 'Director (Other Units)',               role: 'ADMIN', orgUnit: 'Other Units',        reportsTo: 'u_cmd',   status: 'active', uploadRights: true,  joined: '2019-09-22' },
    { id: 'u_dirhr',  name: 'Lakshmi Narayanan',           did: 'did:bel:dirhr001',  designation: 'Director (HR)',                        role: 'ADMIN', orgUnit: 'Human Resources',    reportsTo: 'u_cmd',   status: 'active', uploadRights: true,  joined: '2022-02-14' },
    { id: 'u_cvo',    name: 'Ashok Verma',                 did: 'did:bel:cvo001',    designation: 'Chief Vigilance Officer',              role: 'ADMIN', orgUnit: 'Vigilance',          reportsTo: 'u_cmd',   status: 'active', uploadRights: true,  joined: '2021-07-01' },
    { id: 'u2',       name: 'Priya Sharma',                did: 'did:bel:mgr001',    designation: 'GM (Military Radar), Bangalore Complex', role: 'MANAGER', orgUnit: 'Bengaluru Unit',  reportsTo: 'u1',       status: 'active', uploadRights: true,  joined: '2020-02-15' },
    { id: 'u_gmms',   name: 'Deepak Rao',                  did: 'did:bel:gmms001',   designation: 'GM (Missile Systems), Bangalore Complex',role: 'MANAGER', orgUnit: 'Missile Systems Unit', reportsTo: 'u1',  status: 'active', uploadRights: true,  joined: '2021-03-18' },
    { id: 'u_edcrl',  name: 'Sunitha Ramaswamy',           did: 'did:bel:edcrl001',  designation: 'ED (Central Research Laboratory), Ghaziabad', role: 'MANAGER', orgUnit: 'R&D Division', reportsTo: 'u_dirrnd', status: 'active', uploadRights: true,  joined: '2020-08-05' },
    { id: 'u_headhyd',name: 'Nikhil Chandra',              did: 'did:bel:headhyd001',designation: 'Head (Hyderabad Unit)',                role: 'MANAGER', orgUnit: 'Systems Unit',    reportsTo: 'u_dirou', status: 'active', uploadRights: true,  joined: '2022-05-09' },
    { id: 'u_gmpn',   name: 'Ramesh Iyengar',              did: 'did:bel:gmpn001',   designation: 'GM (Pune Unit)',                        role: 'MANAGER', orgUnit: 'Pune Unit',       reportsTo: 'u_dirou', status: 'active', uploadRights: true,  joined: '2021-10-12' },
    { id: 'u3',       name: 'Arun Mehta',                  did: 'did:bel:aud001',    designation: 'GM (Internal Audit), Corporate Office', role: 'AUDITOR', orgUnit: 'Audit Division',  reportsTo: 'u_cvo',   status: 'active', uploadRights: false, joined: '2020-03-01' },
    { id: 'u_aud002', name: 'Farhan Ali',                  did: 'did:bel:aud002',    designation: 'Assistant Manager (Internal Audit)',    role: 'AUDITOR', orgUnit: 'Audit Division',  reportsTo: 'u3',      status: 'active', uploadRights: false, joined: '2023-08-01' },
    { id: 'u_neha',   name: 'Neha Kulkarni',               did: 'did:bel:aud003',    designation: 'Audit Associate',                      role: 'AUDITOR', orgUnit: 'Audit Division',  reportsTo: 'u_aud002', status: 'active', uploadRights: false, joined: '2024-05-12' },
    { id: 'u_sanjay', name: 'Sanjay Pillai',               did: 'did:bel:aud004',    designation: 'Audit Trainee',                        role: 'AUDITOR', orgUnit: 'Audit Division',  reportsTo: 'u_aud002', status: 'active', uploadRights: false, joined: '2026-06-01' },
    { id: 'u_karthik',name: 'Karthik Subramanian',         did: 'did:bel:usr010',    designation: 'Manager, Systems Design',              role: 'USER', orgUnit: 'Bengaluru Unit',  reportsTo: 'u2',       status: 'active', uploadRights: true,  joined: '2022-01-20' },
    { id: 'u_divya',  name: 'Divya Krishnan',              did: 'did:bel:usr011',    designation: 'Senior Design Engineer',               role: 'USER', orgUnit: 'Bengaluru Unit',  reportsTo: 'u_karthik',status: 'active', uploadRights: true,  joined: '2023-03-11' },
    { id: 'u_ananya', name: 'Ananya Pillai',               did: 'did:bel:usr012',    designation: 'Associate Engineer',                   role: 'USER', orgUnit: 'Bengaluru Unit',  reportsTo: 'u_karthik',status: 'active', uploadRights: false, joined: '2024-07-01' },
    { id: 'u6',       name: 'Deepa Iyer',                  did: 'did:bel:usr003',    designation: 'Junior Engineer',                      role: 'USER', orgUnit: 'Bengaluru Unit',  reportsTo: 'u_karthik',status: 'suspended', uploadRights: false, joined: '2024-07-12' },
    { id: 'u4',       name: 'Sunita Reddy',                did: 'did:bel:usr001',    designation: 'Senior R&D Engineer',                  role: 'USER', orgUnit: 'R&D Division',    reportsTo: 'u_edcrl',  status: 'active', uploadRights: true,  joined: '2024-04-20' },
    { id: 'u7',       name: 'Karan Sinha',                 did: 'did:bel:usr004',    designation: 'R&D Trainee',                          role: 'USER', orgUnit: 'R&D Division',    reportsTo: 'u_edcrl',  status: 'pending',   uploadRights: false, joined: '2026-09-25' },
    { id: 'u_meera',  name: 'Meera Nair',                  did: 'did:bel:usr013',    designation: 'Research Associate',                   role: 'USER', orgUnit: 'R&D Division',    reportsTo: 'u_edcrl',  status: 'active', uploadRights: false, joined: '2023-11-05' },
    { id: 'u_sid',    name: 'Siddharth Menon',             did: 'did:bel:usr014',    designation: 'R&D Intern',                           role: 'USER', orgUnit: 'R&D Division',    reportsTo: 'u_edcrl',  status: 'active', uploadRights: false, joined: '2026-08-01' },
    { id: 'u_anjali', name: 'Anjali Desai',                did: 'did:bel:usr015',    designation: 'Systems Engineer',                     role: 'USER', orgUnit: 'Missile Systems Unit', reportsTo: 'u_gmms', status: 'active', uploadRights: true,  joined: '2022-09-14' },
    { id: 'u_rahul',  name: 'Rahul Verma',                 did: 'did:bel:usr016',    designation: 'Junior Engineer',                      role: 'USER', orgUnit: 'Missile Systems Unit', reportsTo: 'u_gmms', status: 'active', uploadRights: false, joined: '2024-02-20' },
    { id: 'u_rakesh', name: 'Rakesh Bhatt',                did: 'did:bel:usr020',    designation: 'Assistant Manager, Pune Unit',         role: 'USER', orgUnit: 'Pune Unit',       reportsTo: 'u_gmpn',   status: 'active', uploadRights: true,  joined: '2022-08-01' },
    { id: 'u_pooja',  name: 'Pooja Shetty',                did: 'did:bel:usr021',    designation: 'Design Engineer',                      role: 'USER', orgUnit: 'Pune Unit',       reportsTo: 'u_rakesh', status: 'active', uploadRights: true,  joined: '2023-09-15' },
    { id: 'u_amitk',  name: 'Amit Kulkarni',               did: 'did:bel:usr022',    designation: 'Technical Staff',                      role: 'USER', orgUnit: 'Pune Unit',       reportsTo: 'u_rakesh', status: 'active', uploadRights: false, joined: '2024-11-20' },
    { id: 'u_sowmya', name: 'Sowmya Reddy',                did: 'did:bel:usr023',    designation: 'Assistant Manager, Hyderabad Unit',    role: 'USER', orgUnit: 'Systems Unit',    reportsTo: 'u_headhyd',status: 'active', uploadRights: true,  joined: '2022-12-05' },
    { id: 'u5',       name: 'Vikram Nair',                 did: 'did:bel:usr002',    designation: 'Systems Engineer',                     role: 'USER', orgUnit: 'Systems Unit',    reportsTo: 'u_sowmya', status: 'active', uploadRights: false, joined: '2024-06-05' },
    { id: 'u_rohitb', name: 'Rohit Bhandari',              did: 'did:bel:usr024',    designation: 'Technical Staff',                      role: 'USER', orgUnit: 'Systems Unit',    reportsTo: 'u_sowmya', status: 'active', uploadRights: false, joined: '2025-02-10' },
  ],

  assets: [
    { id: 'ast001', classification: 'Confidential', name: 'Radar System Design Rev-4.pdf',       owner: 'did:bel:usr001', orgUnit: 'R&D Division',   hash: 'a3f9c2d1...', size: '2.4 MB', status: 'approved',  uploadedAt: '2026-09-10', approvedBy: 'did:bel:mgr001', approvedAt: '2026-09-11', desc: 'Updated antenna array tolerances for Rev-4 radar housing.', approvalsRequired: 3 },
    { id: 'ast002', classification: 'Secret', name: 'EW Suite Technical Specs.docx',       owner: 'did:bel:usr001', orgUnit: 'R&D Division',   hash: '5d02ab7e...', size: '1.0 MB', status: 'approved',   uploadedAt: '2026-09-24', approvedBy: null, approvedAt: null, desc: 'Draft spec update for the electronic warfare suite jamming profiles.', approvalsRequired: 2 },
    { id: 'ast003', classification: 'Restricted', name: 'Thermal Imaging Module BOM.xlsx',     owner: 'did:bel:usr001', orgUnit: 'R&D Division',   hash: 'c4d8b2e9...', size: '340 KB', status: 'approved',  uploadedAt: '2026-09-05', approvedBy: 'did:bel:mgr001', approvedAt: '2026-09-06', desc: 'Bill of materials refresh for the thermal imaging module.', approvalsRequired: 2 },
    { id: 'ast004', classification: 'Confidential', name: 'Network Topology Diagram v2.png',     owner: 'did:bel:usr002', orgUnit: 'Systems Unit',   hash: 'd1f3e7c0...', size: '820 KB', status: 'approved',  uploadedAt: '2026-09-18', approvedBy: null, approvedAt: null, desc: 'Revised network topology diagram for the Systems Unit backbone.', approvalsRequired: 1 },
    { id: 'ast005', classification: 'Restricted', name: 'Procurement Forecast Q4-2026.pdf',    owner: 'did:bel:usr002', orgUnit: 'Systems Unit',   hash: 'e41c0d9a...', size: '1.7 MB', status: 'approved',   uploadedAt: '2026-09-25', approvedBy: null, approvedAt: null, desc: 'Q4 procurement forecast covering long-lead component orders.', approvalsRequired: 1 },
    { id: 'ast006', classification: 'Unclassified', name: 'Bengaluru Unit Ops Handbook.pdf',      owner: 'did:bel:usr010', orgUnit: 'Bengaluru Unit', hash: 'f2b6a91c...', size: '640 KB', status: 'approved',  uploadedAt: '2026-08-20', approvedBy: 'did:bel:mgr001', approvedAt: '2026-08-21', desc: 'Standard operating procedures handbook for the Bengaluru unit.', approvalsRequired: 2 },
  ],

  reviews: [
    { id: 'rev001', kind: 'initial', assetId: 'ast001', assetName: 'Radar System Design Rev-4.pdf', authorDid: 'did:bel:usr001', orgUnit: 'R&D Division', status: 'merged', desc: 'Updated antenna array tolerances for Rev-4 radar housing.', createdAt: '2026-09-10T08:30:00Z', updatedAt: '2026-09-11T10:00:00Z', approvalsRequired: 3, mergedAt: '2026-09-11T10:00:00Z', mergedBy: 'did:bel:mgr001',
      reviewers: [],
      revisions: [ { n: 1, hash: 'a3f9c2d1...', size: '2.4 MB', fileName: 'Radar System Design Rev-4.pdf', createdAt: '2026-09-10T08:30:00Z', publishedAt: '2026-09-10T09:00:00Z',
        approvals: [ { did: 'did:bel:mgr001', ts: '2026-09-11T09:50:00Z' }, { did: 'did:bel:dirrnd001', ts: '2026-09-10T15:10:00Z' }, { did: 'did:bel:edcrl001', ts: '2026-09-10T12:00:00Z' }, { did: 'did:bel:admin001', ts: '2026-09-11T08:30:00Z' }, { did: 'did:bel:cmd001', ts: '2026-09-11T09:20:00Z' }, { did: 'did:bel:aud001', ts: '2026-09-11T09:40:00Z' } ] } ],
      comments: [ { id: 'c001', authorDid: 'did:bel:mgr001', text: 'Tolerances look good — matches the updated antenna spec sheet.', ts: '2026-09-11T09:50:00Z', revision: 1, blocking: false, resolved: false, resolvedBy: null, replies: [] } ] },
    { id: 'rev002', kind: 'initial', assetId: 'ast003', assetName: 'Thermal Imaging Module BOM.xlsx', authorDid: 'did:bel:usr001', orgUnit: 'R&D Division', status: 'merged', desc: 'Bill of materials refresh for the thermal imaging module.', createdAt: '2026-09-05T07:45:00Z', updatedAt: '2026-09-06T09:00:00Z', approvalsRequired: 2, mergedAt: '2026-09-06T09:00:00Z', mergedBy: 'did:bel:edcrl001',
      reviewers: [],
      revisions: [ { n: 1, hash: 'c4d8b2e9...', size: '340 KB', fileName: 'Thermal Imaging Module BOM.xlsx', createdAt: '2026-09-05T07:45:00Z', publishedAt: '2026-09-05T08:10:00Z',
        approvals: [ { did: 'did:bel:mgr001', ts: '2026-09-05T11:00:00Z' }, { did: 'did:bel:dirrnd001', ts: '2026-09-05T14:30:00Z' }, { did: 'did:bel:edcrl001', ts: '2026-09-06T08:40:00Z' }, { did: 'did:bel:admin001', ts: '2026-09-06T08:55:00Z' } ] } ],
      comments: [] },
    { id: 'rev003', kind: 'update', assetId: 'ast002', assetName: 'EW Suite Technical Specs.docx', authorDid: 'did:bel:usr001', orgUnit: 'R&D Division', status: 'published', desc: 'Draft spec update for the electronic warfare suite jamming profiles.', createdAt: '2026-09-24T10:30:00Z', updatedAt: '2026-09-25T13:00:00Z', approvalsRequired: 2,
      reviewers: [ { did: 'did:bel:aud001', required: true }, { did: 'did:bel:dirrnd001', required: false } ],
      revisions: [
        { n: 1, hash: '5d02ab7e...', size: '1.0 MB', fileName: 'EW Suite Technical Specs.docx', createdAt: '2026-09-24T10:30:00Z', publishedAt: '2026-09-24T11:30:00Z', approvals: [ { did: 'did:bel:mgr001', ts: '2026-09-24T15:00:00Z' } ] },
        { n: 2, hash: 'b7e1a0f3...', size: '1.1 MB', fileName: 'EW Suite Technical Specs.docx', createdAt: '2026-09-25T12:50:00Z', publishedAt: '2026-09-25T13:00:00Z', approvals: [ { did: 'did:bel:edcrl001', ts: '2026-09-25T16:20:00Z' } ] } ],
      comments: [ { id: 'c002', authorDid: 'did:bel:edcrl001', text: 'Can you confirm this covers the latest jamming profile revisions from the field trial?', ts: '2026-09-24T12:40:00Z', revision: 1, blocking: true, resolved: true, resolvedBy: 'did:bel:edcrl001',
        replies: [ { id: 'c003', authorDid: 'did:bel:usr001', text: 'Yes — revision 2 adds the field-trial profiles in Annex C.', ts: '2026-09-25T13:05:00Z' } ] } ] },
    { id: 'rev004', kind: 'update', assetId: 'ast006', assetName: 'Bengaluru Unit Ops Handbook.pdf', authorDid: 'did:bel:mgr001', orgUnit: 'Bengaluru Unit', status: 'draft', desc: '', createdAt: '2026-09-26T16:00:00Z', updatedAt: '2026-09-26T16:00:00Z', approvalsRequired: 2,
      reviewers: [],
      revisions: [ { n: 1, hash: '9c1e77ab...', size: '700 KB', fileName: 'Bengaluru Unit Ops Handbook.pdf', createdAt: '2026-09-26T16:00:00Z', publishedAt: null, approvals: [] } ],
      comments: [] },
    { id: 'rev005', kind: 'update', assetId: 'ast006', assetName: 'Bengaluru Unit Ops Handbook.pdf', authorDid: 'did:bel:usr010', orgUnit: 'Bengaluru Unit', status: 'published', desc: 'Added a revised safety checklist appendix.', createdAt: '2026-09-23T09:00:00Z', updatedAt: '2026-09-24T14:00:00Z', approvalsRequired: 2,
      reviewers: [ { did: 'did:bel:mgr001', required: true } ],
      revisions: [ { n: 1, hash: '0be4c61d...', size: '690 KB', fileName: 'Bengaluru Unit Ops Handbook.pdf', createdAt: '2026-09-23T09:00:00Z', publishedAt: '2026-09-23T09:30:00Z', approvals: [ { did: 'did:bel:mgr001', ts: '2026-09-24T14:00:00Z' } ] } ],
      comments: [] },
    { id: 'rev006', kind: 'update', assetId: 'ast005', assetName: 'Procurement Forecast Q4-2026.pdf', authorDid: 'did:bel:usr002', orgUnit: 'Systems Unit', status: 'published', desc: 'Q4 procurement forecast covering long-lead component orders.', createdAt: '2026-09-25T12:40:00Z', updatedAt: '2026-09-25T13:00:00Z', approvalsRequired: 1,
      reviewers: [ { did: 'did:bel:headhyd001', required: true } ],
      revisions: [ { n: 1, hash: 'e9a0c3b1...', size: '1.8 MB', fileName: 'Procurement Forecast Q4-2026.pdf', createdAt: '2026-09-25T12:40:00Z', publishedAt: '2026-09-25T13:00:00Z', approvals: [] } ],
      comments: [] },
    { id: 'rev007', kind: 'update', assetId: 'ast004', assetName: 'Network Topology Diagram v2.png', authorDid: 'did:bel:usr002', orgUnit: 'Systems Unit', status: 'canceled', desc: 'Revised network topology diagram for the Systems Unit backbone.', createdAt: '2026-09-18T09:40:00Z', updatedAt: '2026-09-18T16:45:00Z', approvalsRequired: 1, canceledAt: '2026-09-18T16:45:00Z', canceledBy: 'did:bel:usr002', cancelReason: 'Incomplete classification markings.',
      reviewers: [],
      revisions: [ { n: 1, hash: 'd1f3e7c0...', size: '820 KB', fileName: 'Network Topology Diagram v2.png', createdAt: '2026-09-18T09:40:00Z', publishedAt: '2026-09-18T10:00:00Z', approvals: [ { did: 'did:bel:headhyd001', ts: '2026-09-18T11:15:00Z' } ] } ],
      comments: [ { id: 'c004', authorDid: 'did:bel:dirou001', text: 'Classification markings are incomplete on sheets 2–4. Please re-mark before this is circulated.', ts: '2026-09-18T15:30:00Z', revision: 1, blocking: true, resolved: false, resolvedBy: null, replies: [] } ] },
  ],

  delegations: [
    { id: 'del001', assetId: 'ast001', assetName: 'Radar System Design Rev-4.pdf', fromDID: 'did:bel:usr001', toDID: 'did:bel:mgr001', access: 'Viewer', permissions: ['VIEW','DOWNLOAD'], status: 'approved', requestedAt: '2026-09-12', expiresAt: '2026-12-31', approvedAt: '2026-09-12' },
    { id: 'del002', assetId: 'ast003', assetName: 'Thermal Imaging Module BOM.xlsx', fromDID: 'did:bel:usr001', toDID: 'did:bel:usr013', access: 'Editor', permissions: ['VIEW','DOWNLOAD','UPLOAD_ASSET'], status: 'approved', requestedAt: '2026-09-24', expiresAt: null, approvedAt: '2026-09-24' },
  ],

  auditLog: [
    { id: 'ev001', type: 'AUTHENTICATE',   actor: 'did:bel:admin001', detail: 'Admin login',                               ts: '2026-09-26T00:01:00Z' },
    { id: 'ev002', type: 'ONBOARD',        actor: 'did:bel:admin001', detail: 'Onboarded Karan Sinha → did:bel:usr004',   ts: '2026-09-25T14:22:00Z' },
    { id: 'ev003', type: 'GRANT_RIGHTS',   actor: 'did:bel:mgr001',   detail: 'Upload rights granted to did:bel:usr001',  ts: '2026-09-20T09:15:00Z' },
    { id: 'ev004', type: 'UPLOAD_ASSET',   actor: 'did:bel:usr001',   detail: 'Uploaded EW Suite Technical Specs.docx',   ts: '2026-09-24T11:30:00Z' },
    { id: 'ev005', type: 'APPROVE_ASSET',  actor: 'did:bel:mgr001',   detail: 'Approved ast001 – Radar System Design',    ts: '2026-09-11T10:00:00Z' },
    { id: 'ev006', type: 'REJECT_ASSET',   actor: 'did:bel:mgr001',   detail: 'Rejected ast004 – incomplete markings',    ts: '2026-09-18T16:45:00Z' },
    { id: 'ev007', type: 'REQUEST_DELEG',  actor: 'did:bel:usr001',   detail: 'Delegation requested for ast003 → Auditor',ts: '2026-09-24T12:00:00Z' },
    { id: 'ev008', type: 'SUSPEND_USER',   actor: 'did:bel:admin001', detail: 'Suspended Deepa Iyer (did:bel:usr003)',     ts: '2026-09-15T08:30:00Z' },
    { id: 'ev009', type: 'DEFINE_ROLE',    actor: 'did:bel:admin001', detail: 'Defined role MANAGER with 8 permissions',  ts: '2026-09-10T09:00:00Z' },
    { id: 'ev010', type: 'UPLOAD_ASSET',   actor: 'did:bel:usr002',   detail: 'Uploaded Procurement Forecast Q4-2026.pdf',ts: '2026-09-25T13:00:00Z' },
  ],

  roleDefinitions: [
    { id: 'ADMIN',   name: 'Administrator',  permissions: ['MANAGE_IDENTITY','MANAGE_ROLE','MINT_ASSET','APPROVE_TRANSFER','VIEW_ALL_ASSETS','VIEW_AUDIT','UPLOAD_ASSET'], orgScope: 'BEL:HQ', scope: 'HQ' },
    { id: 'MANAGER', name: 'Manager',        permissions: ['VIEW_AUDIT','UPLOAD_ASSET'], orgScope: 'BEL:UNIT', scope: 'UNIT' },
    { id: 'AUDITOR', name: 'Auditor',        permissions: ['VIEW_ALL_ASSETS','VIEW_AUDIT'], orgScope: 'BEL:ALL', scope: 'ALL_READ' },
    { id: 'USER',    name: 'User',           permissions: ['UPLOAD_ASSET'], orgScope: 'BEL:UNIT', scope: 'SELF' },
  ],

  transfers: [],
  nextId: 100,
};
if (typeof window !== 'undefined') window.DB = DB; // bridges src/engine/supabase-sync.js, same as before

export function newId(prefix) { return `${prefix}${++DB.nextId}`; }
export function now() { return new Date().toISOString(); }
export function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
export function fmtDate(iso) { if (!iso) return '—'; return iso.slice(0, 10); }
export function shortHash(h) { return h && h.length > 12 ? h.slice(0, 8) + '...' : (h || '—'); }
export function fmtSize(bytes) {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
export async function sha256Hex(fileOrText) {
  const buf = fileOrText instanceof Blob ? await fileOrText.arrayBuffer() : new TextEncoder().encode(String(fileOrText));
  if (window.crypto && crypto.subtle) {
    try {
      const digest = await crypto.subtle.digest('SHA-256', buf);
      return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) { /* fall through to the fallback digest */ }
  }
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  new Uint8Array(buf).forEach(b => { h1 = Math.imul(h1 ^ b, 16777619) >>> 0; h2 = Math.imul(h2 + b, 2246822519) >>> 0; });
  return (h1.toString(16) + h2.toString(16)).padStart(16, '0').repeat(4);
}
export const ORG_DIRECTORATES = ['Corporate Office', 'Bangalore Complex', 'Research & Development', 'Finance', 'Marketing', 'Other Units', 'Human Resources', 'Vigilance'];
export const ORG_DIVISIONS = ['Bengaluru Unit', 'R&D Division', 'Systems Unit', 'Missile Systems Unit', 'Pune Unit', 'Audit Division'];
export const ORG_UNITS = [...ORG_DIVISIONS, ...ORG_DIRECTORATES];
// Data version of the original orgUnitOptions()'s <optgroup> grouping — JSX renders the <option>s.
export function orgUnitGroups(only) {
  const pick = list => list.filter(o => !only || only.includes(o));
  return [['Units / divisions', pick(ORG_DIVISIONS)], ['Directorates', pick(ORG_DIRECTORATES)]].filter(([, l]) => l.length);
}
export function timeAgo(iso) {
  if (!iso) return '—';
  const then = new Date(iso.length <= 10 ? iso + 'T00:00:00Z' : iso).getTime();
  if (isNaN(then)) return '—';
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
export function fmtTs(iso) { if (!iso) return '—'; const d = new Date(iso); return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }); }

// ─────────────────────────────────────────────
// LEDGER
// ─────────────────────────────────────────────
const GENESIS_VERSION = 6;
const DB_STORE_KEY = 'bel.db.v1';
export const Session = { did: null, key: null };
let _inCommit = false;

export function commit(method, args, detail, opts = {}) {
  const C = LEDGER.Chain;
  if (C.tampered) throw new CONTRACTS.ContractError('The ledger is in tamper-demo mode — restore it on Audit Trail → Blockchain first');
  if (C.halted) throw new CONTRACTS.ContractError(C.halted);
  const actor = opts.actor || Session.did;
  if (!Session.key || actor !== Session.did) throw new CONTRACTS.ContractError('Sign in with your DID key to perform this action');
  if (_inCommit) throw new Error(`Nested ledger commit (${method})`);
  _inCommit = true;
  let body;
  try { body = CONTRACTS.exec(DB, method, args, { actor, ts: now(), detail, type: opts.type }); }
  finally { _inCommit = false; }
  const row = { id: newId('ev'), type: body.type, actor, detail: body.detail, ts: body.ts, txHash: null, height: null, subject: subjectOf(body) };
  DB.auditLog.unshift(row);
  C.submit(body, Session.key, CONTRACTS.snapshot(DB), block => {
    row.txHash = block.txs[0].hash;
    row.height = block.height;
    persistLocalDB();
    notify();
    if (SupabaseSync) SupabaseSync.syncAll(row).catch(err => console.warn('Supabase sync failed:', err));
  });
  return body;
}
export function tryCommit(method, args, detail, opts) {
  try { commit(method, args, detail, opts); return true; }
  catch (e) {
    if (e instanceof CONTRACTS.ContractError) { toast(`⛔ ${e.message}`, 'error'); return false; }
    throw e;
  }
}
export function addAudit(type, actorDID, detail) { return tryCommit('Audit.record', { type }, detail, { type, actor: actorDID }); }

export function subjectOf(tx) {
  const a = tx.args || {};
  let assetId = a.assetId || (a.asset && a.asset.id) || (a.delegation && a.delegation.assetId) || (a.review && a.review.assetId) || (a.newAsset && a.newAsset.id) || null;
  if (!assetId && a.reviewId) { const r = DB.reviews.find(x => x.id === a.reviewId); assetId = r ? r.assetId : null; }
  if (!assetId && a.transferId) { const t = (DB.transfers || []).find(x => x.id === a.transferId); assetId = t ? t.assetId : null; }
  if (!assetId && a.delegationId) { const d = DB.delegations.find(x => x.id === a.delegationId); assetId = d ? d.assetId : null; }
  return { assetId, userId: a.userId || (a.user && a.user.id) || null, unit: (a.review && a.review.orgUnit) || (a.user && a.user.orgUnit) || null };
}
function eventInUnit(e, unit) {
  const actor = DB.users.find(u => u.did === e.actor);
  if (actor && actor.orgUnit === unit) return true;
  const s = e.subject || {};
  if (s.unit === unit) return true;
  const a = s.assetId && DB.assets.find(x => x.id === s.assetId);
  if (a && a.orgUnit === unit) return true;
  const u = s.userId && DB.users.find(x => x.id === s.userId);
  return !!(u && u.orgUnit === unit);
}
function eventInvolves(e, viewer) {
  const s = e.subject || {};
  const a = s.assetId && DB.assets.find(x => x.id === s.assetId);
  return e.actor === viewer.did || s.userId === viewer.id || (a && a.owner === viewer.did)
    || String(e.detail || '').includes(viewer.did) || String(e.detail || '').includes(viewer.name);
}
export function auditVisible(viewer) {
  if (!hasPerm(viewer, 'VIEW_AUDIT')) return e => eventInvolves(e, viewer);
  if (scopeOf(viewer) === 'UNIT') return e => eventInUnit(e, viewer.orgUnit);
  if (['HQ', 'ALL_READ'].includes(scopeOf(viewer))) return () => true;
  return e => eventInvolves(e, viewer);
}

export function didDocFor(did, publicJwk, created) {
  return {
    '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/suites/jws-2020/v1'],
    id: did,
    controller: ORG_DID,
    verificationMethod: [{ id: `${did}#key-1`, type: 'JsonWebKey2020', controller: did, publicKeyJwk: { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y } }],
    authentication: [`${did}#key-1`],
    assertionMethod: [`${did}#key-1`],
    created: created || now(),
  };
}
export function didKeyOf(user) {
  const doc = user && user.didDoc;
  if (!doc) return null;
  const kid = (doc.authentication || [])[0];
  const vm = (doc.verificationMethod || []).find(m => m.id === kid) || (doc.verificationMethod || [])[0];
  return vm ? vm.publicKeyJwk : null;
}
const isoOf = d => (!d ? now() : d.length <= 10 ? `${d}T00:00:00.000Z` : d);

function chainReviewOf(r) {
  return { id: r.id, kind: r.kind, assetId: r.assetId || null, authorDid: r.authorDid, orgUnit: r.orgUnit, status: r.status, classification: r.classification || 'Unclassified',
    approvalsRequired: r.approvalsRequired, reviewers: r.reviewers.map(x => ({ did: x.did, required: !!x.required })),
    revisions: r.revisions.map(v => ({ n: v.n, hash: v.hash, size: v.size, publishedAt: v.publishedAt || null, approvals: v.approvals.map(a => ({ did: a.did, ts: a.ts })) })) };
}

async function buildGenesis() {
  const orgWallet = LEDGER.Wallet.get(ORG_DID);
  if (!orgWallet) throw new Error('Missing organisation key (demo-wallets.js not loaded)');
  const orgKey = await LEDGER.Keys.importPrivate(orgWallet.privateJwk);
  DB.roleDefinitions.forEach(r => { if (!r.scope) r.scope = RULES.scopeOf(DB, { role: r.id }); });
  const upgrade = (id, perms) => { const r = DB.roleDefinitions.find(x => x.id === id); if (r) perms.forEach(p => { if (!r.permissions.includes(p)) r.permissions.push(p); }); };
  upgrade('ADMIN', ['MINT_ASSET', 'APPROVE_TRANSFER', 'VIEW_ALL_ASSETS']);
  upgrade('MANAGER', ['UPLOAD_ASSET']);
  upgrade('AUDITOR', ['VIEW_ALL_ASSETS']);
  const known = new Set(CONTRACTS.ALL_PERMS);
  DB.roleDefinitions.forEach(r => { r.permissions = r.permissions.filter(p => known.has(p)); });
  DB.users.forEach(u => {
    if (u.uploadRights === false) {
      const perms = u.permOverrides || (DB.roleDefinitions.find(r => r.id === u.role) || { permissions: [] }).permissions;
      if (perms.includes('UPLOAD_ASSET')) u.permOverrides = perms.filter(p => p !== 'UPLOAD_ASSET');
    }
    delete u.uploadRights;
    if (u.permOverrides) u.permOverrides = u.permOverrides.filter(p => known.has(p));
  });
  DB.delegations.forEach(d => { if (!d.access) d.access = (d.permissions || []).includes('UPLOAD_ASSET') ? 'Editor' : 'Viewer'; if (d.status === 'pending') d.status = 'revoked'; });
  const clampApprovals = n => Math.min(CONTRACTS.MAX_APPROVALS, Math.max(0, Number.isInteger(n) ? n : 1));
  DB.assets.forEach(a => { if (!a.classification) a.classification = 'Unclassified'; a.approvalsRequired = clampApprovals(a.approvalsRequired); });
  DB.reviews.forEach(r => { r.approvalsRequired = clampApprovals(r.approvalsRequired); });
  DB.reviews.forEach(r => { if (!r.classification) r.classification = (DB.assets.find(a => a.id === r.assetId) || {}).classification || 'Unclassified'; });
  for (const u of DB.users) {
    if (didKeyOf(u)) continue;
    const pub = (BEL_PUBLIC_KEYS || {})[u.did] || (await LEDGER.Keys.generate()).publicJwk;
    u.didDoc = didDocFor(u.did, pub, isoOf(u.joined));
  }
  const legacyMints = DB.assets.filter(a => a.status === 'approved' && a.approvedAt && !a.tokenId)
    .sort((a, b) => String(a.approvedAt || a.uploadedAt).localeCompare(String(b.approvedAt || b.uploadedAt)));
  let tokenId = RULES.nextTokenId(DB);
  legacyMints.forEach(a => Object.assign(a, { tokenId: tokenId++, issuer: ORG_DID, mintedAt: isoOf(a.approvedAt || a.uploadedAt), mintedBy: a.approvedBy || ORG_DID }));
  DB.assets.forEach(a => { if (a.pendingTransferId === undefined) a.pendingTransferId = null; if (!a.version) a.version = 1; });
  DB.transfers = DB.transfers || [];

  const S = CONTRACTS.emptyState();
  const ts0 = now();
  const bodies = [];
  const add = (method, args, detail, ts, type) => bodies.push(CONTRACTS.exec(S, method, args, { actor: ORG_DID, ts: ts || ts0, detail, type, ctx: { genesis: true } }));
  add('Chain.genesis', { chainId: CONTRACTS.CHAIN_ID, genesisVersion: GENESIS_VERSION, orgDidDoc: didDocFor(ORG_DID, orgWallet.publicJwk, ts0) }, 'Genesis — Bharat Electronics Limited identity & asset ledger');
  DB.roleDefinitions.forEach(r => add('AccessControl.defineRole', { role: { id: r.id, name: r.name, permissions: r.permissions, scope: r.scope } }, `Defined role ${r.id} (${r.permissions.length} permissions, scope ${r.scope})`));
  DB.users.forEach(u => add('Identity.register', {
    user: { id: u.id, did: u.did, name: u.name, designation: u.designation, role: u.role, orgUnit: u.orgUnit, reportsTo: u.reportsTo || null,
      status: u.status, joined: u.joined, permOverrides: u.permOverrides || null, piiCommitment: u.piiCommitment || null },
    didDoc: u.didDoc,
  }, `Registered DID ${u.did} for ${u.name}`, isoOf(u.joined), 'REGISTER_DID'));
  DB.assets.forEach(a => add('Asset.import', { asset: { id: a.id, name: a.name, owner: a.owner, orgUnit: a.orgUnit, hash: a.hash, size: a.size, status: a.status, version: a.version, classification: a.classification, approvalsRequired: a.approvalsRequired } }, `Imported asset record ${a.id} – ${a.name}`, isoOf(a.uploadedAt)));
  DB.reviews.forEach(r => add('Review.import', { review: chainReviewOf(r) }, `Imported review ${r.id} for ${r.assetName}`, isoOf(r.createdAt)));
  DB.delegations.forEach(d => add('Delegation.import', { delegation: { id: d.id, assetId: d.assetId, fromDID: d.fromDID, toDID: d.toDID, access: d.access, permissions: d.permissions, status: d.status, expiresAt: d.expiresAt || null } }, `Imported delegation ${d.id}`, isoOf(d.requestedAt)));
  legacyMints.forEach(a => add('AssetNFT.legacyMint', { assetId: a.id, tokenId: a.tokenId, mintedAt: a.mintedAt, mintedBy: a.mintedBy, contentHash: a.hash },
    `Minted ${tokenLabel(a)} for ${a.id} – ${a.name} to ${a.owner}`, a.mintedAt));
  DB.auditLog.slice().sort((a, b) => String(a.ts).localeCompare(String(b.ts))).forEach(e => add('Audit.import',
    { legacyId: e.id, legacyType: e.type, legacyActor: e.actor, legacyTs: e.ts }, e.detail, e.ts, e.type));

  await LEDGER.Chain.genesis(bodies.map(body => ({ body, key: orgKey })), CONTRACTS.snapshot(S), ts0);
  const mismatch = CONTRACTS.diff(CONTRACTS.project(S), CONTRACTS.project(DB));
  if (mismatch.length) console.warn('Genesis state differs from DB:', mismatch);
}

const HIDDEN_IN_LOG = new Set(['Chain.genesis', 'AccessControl.defineRole@0', 'Asset.import', 'Review.import', 'Delegation.import']);
function auditRowOf(tx, block) {
  const key = `${tx.contract}.${tx.method}`;
  if (HIDDEN_IN_LOG.has(key) || HIDDEN_IN_LOG.has(`${key}@${block.height}`)) return null;
  if (key === 'Audit.import') return { id: tx.args.legacyId, type: tx.args.legacyType, actor: tx.args.legacyActor, detail: tx.detail, ts: tx.args.legacyTs, txHash: tx.hash, height: block.height, subject: {} };
  return { id: `tx-${tx.hash.slice(0, 12)}`, type: tx.type, actor: tx.actor, detail: tx.detail, ts: tx.ts, txHash: tx.hash, height: block.height, subject: subjectOf(tx) };
}
function rebuildFromChain() {
  const rows = [];
  const nonces = {};
  LEDGER.Chain.txs().forEach(({ tx, block }) => {
    nonces[tx.actor] = Math.max(nonces[tx.actor] || 0, tx.nonce || 0);
    const row = auditRowOf(tx, block);
    if (row) rows.push(row);
  });
  DB.auditLog = rows.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  DB.__nonces = nonces;
  const S = CONTRACTS.emptyState();
  LEDGER.Chain.blocks.forEach(b => b.txs.forEach(tx => { try { CONTRACTS.run(S, JSON.parse(JSON.stringify(tx)), { genesis: b.height === 0 }); } catch (e) { /* surfaced by Verify */ } }));
  S.users.forEach(su => {
    const u = DB.users.find(x => x.id === su.id);
    if (!u) return;
    u.didDoc = su.didDoc;
    ['registeredBy', 'movedFrom', 'movedAt', 'deactivatedAt'].forEach(k => { if (su[k] !== undefined) u[k] = su[k]; });
  });
  S.roleDefinitions.forEach(sr => {
    const r = DB.roleDefinitions.find(x => x.id === sr.id);
    if (!r) DB.roleDefinitions.push(JSON.parse(JSON.stringify(sr)));
    else if (!r.scope) r.scope = sr.scope;
  });
  S.assets.forEach(sa => {
    const a = DB.assets.find(x => x.id === sa.id);
    if (a && a.tokenId == null && sa.tokenId) Object.assign(a, { tokenId: sa.tokenId, issuer: sa.issuer, mintedAt: sa.mintedAt, mintedBy: sa.mintedBy });
    if (a && a.pendingTransferId === undefined) a.pendingTransferId = sa.pendingTransferId || null;
    if (a && !a.classification) a.classification = sa.classification || 'Unclassified';
    if (a && sa.retiredAt && !a.retiredAt) Object.assign(a, { retiredAt: sa.retiredAt, retiredBy: sa.retiredBy });
  });
  if (!(DB.transfers && DB.transfers.length) && S.transfers.length) DB.transfers = JSON.parse(JSON.stringify(S.transfers));
  DB.transfers = DB.transfers || [];
}
function fixNextId() {
  const ids = [DB.users, DB.assets, DB.reviews, DB.delegations, DB.transfers || [], DB.auditLog].flat().map(x => x.id)
    .concat(DB.reviews.flatMap(r => (r.comments || []).flatMap(c => [c.id, ...(c.replies || []).map(x => x.id)])));
  const max = ids.reduce((m, id) => { const k = /^[A-Za-z_]+(\d+)$/.exec(String(id || '')); return k ? Math.max(m, Number(k[1])) : m; }, 100);
  DB.nextId = Math.max(DB.nextId, max);
}
function persistLocalDB() {
  if (State.dataSource !== 'local') return;
  try { localStorage.setItem(DB_STORE_KEY, JSON.stringify(DB)); } catch (e) { /* storage full / unavailable */ }
}
export function resetDemoData() {
  LEDGER.Chain.clearLocal();
  try { [DB_STORE_KEY, 'bel.wallet.v1', 'bel.keystores.v1'].forEach(k => localStorage.removeItem(k)); } catch (e) { /* ignore */ }
  location.reload();
}
let _resyncing = null;
export function resyncFromRemote(reason) {
  if (_resyncing) return _resyncing;
  _resyncing = (async () => {
    await LEDGER.Chain.idle();
    const Sync = SupabaseSync;
    const res = await Sync.loadLedger();
    if (!res.ok) return false;
    await Sync.hydrateAll();
    LEDGER.Chain.load(res.blocks);
    LEDGER.Chain.halted = null;
    rebuildFromChain();
    fixNextId();
    State.remoteAhead = false;
    if (reason === 'conflict') toast('⚠ Another user changed the system at the same moment — your last action was not saved. The view is refreshed; please try again.', 'warning');
    else notify();
    return true;
  })().finally(() => { _resyncing = null; });
  return _resyncing;
}
function startRemotePolling() {
  if (typeof window !== 'undefined' && window.__belNoPolling) return;
  setInterval(async () => {
    if (!State.bootReady || LEDGER.Chain.tampered || LEDGER.Chain.pending || _resyncing) return;
    const h = await SupabaseSync.remoteHeight();
    if (h == null || h <= LEDGER.Chain.height()) return;
    const el = typeof document !== 'undefined' ? document.activeElement : null;
    const busy = State.modal || (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
    if (busy) { if (!State.remoteAhead) { State.remoteAhead = true; notify(); } }
    else resyncFromRemote('poll');
  }, 15000);
}
const withTimeout = (p, ms) => Promise.race([p, new Promise(res => setTimeout(() => res(null), ms))]);

export async function bootLedger() {
  State.bootReady = false;
  notify();
  const Sync = SupabaseSync;
  let source = 'local';
  if (Sync && Sync.isConfigured && await withTimeout(Sync.hydrateAll(), 6000).catch(() => false)) source = 'supabase';
  let blocks = null;
  let remoteLedger = false;
  if (source === 'supabase' && Sync.loadLedger) {
    const res = await withTimeout(Sync.loadLedger(), 6000).catch(() => null);
    if (res && res.ok) { remoteLedger = true; blocks = res.blocks; }
  }
  const versionOf = bs => bs && bs[0] && bs[0].txs[0] && bs[0].txs[0].args && bs[0].txs[0].args.genesisVersion;
  if (source === 'local') {
    const saved = (() => { try { return JSON.parse(localStorage.getItem(DB_STORE_KEY) || 'null'); } catch (e) { return null; } })();
    const local = LEDGER.Chain.loadLocal();
    if (saved && local && local.length && versionOf(local) === GENESIS_VERSION) { Object.assign(DB, saved); blocks = local; }
  } else if (!remoteLedger) {
    const local = LEDGER.Chain.loadLocal();
    blocks = versionOf(local) === GENESIS_VERSION ? local : null;
  }
  const g = blocks && blocks[0] && blocks[0].txs[0];
  if (g && g.args && g.args.genesisVersion !== GENESIS_VERSION) {
    State.ledgerNotice = remoteLedger ? 'The shared ledger was created by an older version — ask your administrator to rebuild the shared chain.' : null;
    if (!remoteLedger) blocks = null;
  }
  State.dataSource = source;
  if (blocks && blocks.length) {
    LEDGER.Chain.load(blocks);
  } else {
    await buildGenesis();
    if (remoteLedger) {
      const res = await Sync.appendBlocks(LEDGER.Chain.blocks);
      if (res && res.conflict) { const again = await Sync.loadLedger(); if (again.ok && again.blocks.length) { await Sync.hydrateAll(); LEDGER.Chain.load(again.blocks); } }
    }
    LEDGER.Chain.saveLocal();
  }
  if (remoteLedger) {
    LEDGER.Chain.remote = { append: b => Sync.appendBlocks([b]) };
    LEDGER.Chain.onConflict = () => setTimeout(() => resyncFromRemote('conflict'), 0);
    startRemotePolling();
  }
  rebuildFromChain();
  fixNextId();
  persistLocalDB();
  const head = LEDGER.Chain.head();
  const roots = await LEDGER.hashRoots(CONTRACTS.snapshot(DB));
  const off = Object.keys(head.stateRoots || {}).filter(k => roots[k] !== head.stateRoots[k]);
  if (off.length) State.ledgerNotice = `Database differs from the ledger in: ${off.join(', ')}. Open Audit Trail → Blockchain and run Verify.`;
  if (Sync && Sync.setReady) Sync.setReady(true);
  State.bootReady = true;
  notify();
}

// ── Audit Trail → Blockchain tab ──
export const EVENT_CATEGORIES = [
  { label: 'Identity creation',    types: ['REGISTER_DID', 'ONBOARD'] },
  { label: 'NFT creation',         types: ['MINT_NFT'] },
  { label: 'Asset allocation',     types: ['CREATE_ASSET', 'MINT_NFT', 'OVERRIDE_TRANSFER'] },
  { label: 'Access rights',        types: ['GRANT_ACCESS', 'REVOKE_ACCESS', 'GRANT_RIGHTS', 'REVOKE_RIGHTS'] },
  { label: 'Ownership transfers',  types: ['TRANSFER_OWNERSHIP', 'OVERRIDE_TRANSFER'] },
  { label: 'Permission updates',   types: ['DEFINE_ROLE', 'UPDATE_ROLE', 'UPDATE_IDENTITY', 'STATUS', 'ACTIVATE_IDENTITY', 'SUSPEND_USER', 'DEACTIVATE_IDENTITY', 'ROTATE_KEY'] },
];
export function nameOfDid(did) { return did === ORG_DID ? 'BEL (organisation)' : ((DB.users.find(u => u.did === did) || {}).name || did); }
export function tokenLabel(a) { return a && a.tokenId ? `BEL-NFT #${String(a.tokenId).padStart(4, '0')}` : '—'; }

export async function verifyLedger() {
  const t0 = performance.now();
  const blocks = LEDGER.Chain.blocks;
  const structure = await LEDGER.Chain.verifyStructure(blocks);
  const rep = await CONTRACTS.replay(blocks, LEDGER);
  const db = CONTRACTS.diff(CONTRACTS.project(rep.state), CONTRACTS.project(DB));
  const by = c => rep.issues.filter(i => i.check === c);
  State.chainReport = { at: now(), ms: Math.round(performance.now() - t0), blocks: blocks.length, txs: blocks.reduce((n, b) => n + b.txs.length, 0), sigs: rep.sigs,
    structure: structure.filter(i => i.check === 'hash'), links: structure.filter(i => i.check === 'link'), signature: by('signature'), authorization: by('authorization'), state: by('state'), db };
  return State.chainReport;
}
export async function tamperLedger(mode) {
  const C = LEDGER.Chain;
  const live = C.blocks.filter(b => b.height > 0);
  const target = live.length ? live[Math.max(0, live.length - 2)] : C.blocks[0];
  if (mode === 'edit-tx' || mode === 'rehash') await C.tamper(mode, target.height);
  if (mode === 'forge-db') {
    const a = DB.assets.find(x => x.tokenId) || DB.assets[0];
    const other = DB.users.find(u => u.did !== a.owner && u.status === 'active');
    State.tamperDbBackup = { assetId: a.id, owner: a.owner };
    C.tamper('forge-db', target.height);
    a.owner = other.did;
  }
  if (mode === 'inject') {
    const u = currentUser();
    const key = Session.key;
    const body = { v: 1, chainId: CONTRACTS.CHAIN_ID, contract: 'AccessControl', method: 'updateAccess', type: 'UPDATE_IDENTITY', actor: u.did, kid: `${u.did}#key-1`,
      nonce: ((DB.__nonces || {})[u.did] || 0) + 1, ts: now(), args: { userId: u.id, permOverrides: CONTRACTS.ALL_PERMS.slice() }, detail: `${u.name} grants themself every permission` };
    const block = await C.forgeBlock(body, key, CONTRACTS.snapshot(DB));
    C.tamper('inject', null, block);
  }
  State.chainReport = null;
  await verifyLedger();
}
export function restoreLedger() {
  LEDGER.Chain.restore();
  const b = State.tamperDbBackup;
  if (b) { const a = DB.assets.find(x => x.id === b.assetId); if (a) a.owner = b.owner; State.tamperDbBackup = null; }
}

export async function uploadBlobToStorage(file, hash) {
  if (!SupabaseSync) return null;
  try { return await SupabaseSync.uploadAssetBlob(file, hash); }
  catch (err) { console.warn('Supabase Storage upload failed:', err); toast('⚠ File saved locally, but Supabase Storage upload failed — check your connection', 'warning'); return null; }
}
export function getAssetLastUpdated(asset) {
  const events = DB.auditLog.filter(e => e.detail.includes(asset.id) || e.detail.includes(asset.name.slice(0, 20)));
  if (!events.length) return asset.uploadedAt;
  return events.reduce((latest, e) => (e.ts > latest ? e.ts : latest), events[0].ts);
}

// ── ORG CHART HELPERS ──
export function getOrgRoot() { return DB.users.find(u => !u.reportsTo); }
export function getDirectReports(id) { return DB.users.filter(u => u.reportsTo === id); }
export function getSubtreeIds(id) {
  const out = [];
  const walk = pid => { getDirectReports(pid).forEach(c => { if (c.id === id || out.includes(c.id)) return; out.push(c.id); walk(c.id); }); };
  walk(id);
  return out;
}
export function getManagerChain(id) {
  const chain = [];
  const seen = new Set([id]);
  let u = DB.users.find(x => x.id === id);
  while (u && u.reportsTo) {
    const mgr = DB.users.find(x => x.id === u.reportsTo);
    if (!mgr || seen.has(mgr.id)) break;
    seen.add(mgr.id);
    chain.unshift(mgr);
    u = mgr;
  }
  return chain;
}
export function initialsOf(name) { return name.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase(); }
export function roleBadgeClass(role) {
  return role === 'ADMIN' ? 'badge-active' : role === 'MANAGER' ? 'badge-granted' : role === 'AUDITOR' ? 'badge-pending' : 'badge-expired';
}
export function aliasOf(user) { return `${user.did.split(':').pop()}@bel.in`; }
export function reportsToLabel(user) { return `${user.name} (${aliasOf(user)}) — ${user.designation}`; }
export function maskAadhaar(a) { return a ? `XXXX XXXX ${a.slice(-4)}` : '—'; }
export function maskPan(p) { return p ? `XXXXX${p.slice(5, 9).replace(/./g, 'X')}${p.slice(-1)}` : '—'; }

export const ACCESS_LEVELS = [
  { id: 'Owner',  desc: 'Holds the asset: updates it, adds Editors and Viewers, transfers ownership' },
  { id: 'Editor', desc: 'Updates the asset (new versions go through a review)' },
  { id: 'Viewer', desc: 'Views and downloads the asset' },
];
export const IDENTITY_PERMISSIONS = [
  { id: 'UPLOAD_ASSET',     label: 'Asset Creation',      desc: 'Create new digital assets' },
  { id: 'VIEW_ALL_ASSETS',  label: 'View All Assets',     desc: 'Viewer access to every asset (Administrators and Auditors by default)' },
  { id: 'MINT_ASSET',       label: 'NFT Minting',         desc: 'Mint assets as NFTs and retire them' },
  { id: 'APPROVE_TRANSFER', label: 'Ownership Override',  desc: "Transfer an asset when its owner is suspended or deactivated" },
  { id: 'VIEW_AUDIT',       label: 'View Audit Trail',    desc: 'View audit events and export them' },
  { id: 'MANAGE_IDENTITY',  label: 'Identity Management', desc: 'Onboard, activate, suspend and deactivate identities; issue sign-in credentials' },
  { id: 'MANAGE_ROLE',      label: 'Role Management',     desc: 'Define roles and assign them' },
];
export { RULES, CONTRACTS, LEDGER, ORG_DID };
export function effectivePermissions(user) { return RULES.effectivePermissions(DB, user); }
export function isActive(user) { return RULES.isActive(user); }
export function hasPerm(user, perm) { return RULES.hasPerm(DB, user, perm); }
export function canUpload(user) { return RULES.canUpload(DB, user); }
export function delegationState(d) { return RULES.delegationState(DB, d); }
export function roleOf(user) { return RULES.roleOf(DB, user); }
export function canViewIdentity(viewer, user) { return RULES.canViewIdentity(DB, viewer, user); }
export const CLASS_BADGE = { Unclassified: 'badge-expired', Restricted: 'badge-active', Confidential: 'badge-pending', Secret: 'badge-rejected' };
export function scopeOf(user) { return RULES.scopeOf(DB, user); }

export function findManagerByInput(typed, managers) {
  const t = typed.trim().toLowerCase();
  if (!t) return null;
  return managers.find(u => reportsToLabel(u).toLowerCase() === t)
    || managers.find(u => u.name.toLowerCase() === t)
    || managers.find(u => aliasOf(u).toLowerCase() === t)
    || null;
}
export function eligibleManagersFor(user) {
  const blocked = new Set(user ? [user.id, ...getSubtreeIds(user.id)] : []);
  return DB.users.filter(u => u.status !== 'deactivated' && !blocked.has(u.id));
}

// ─────────────────────────────────────────────
// APP STATE — same fields as the original app.js's State object.
// ─────────────────────────────────────────────
export const State = {
  bootReady: false,
  dataSource: 'local',
  ledgerNotice: null,
  loginFlow: null,
  remoteAhead: false,
  loginFails: {},
  lastProof: null,
  chainReport: null,
  chainOpenBlock: null,
  tamperDbBackup: null,
  nftVerify: null,
  registryFilter: 'all',
  assetQuery: '',
  roleDraft: null,
  currentRole: null,
  currentUserId: null,
  currentPage: null,
  modal: null,
  toast: null,
  expandedOrgNodes: new Set(['u_cmd']),
  peopleQuery: '',
  sidebarCollapsed: typeof window !== 'undefined' && window.innerWidth < 1440,
  sidebarUserSet: false,
  settingsMenuOpen: false,
  profileActiveTab: 'personal',
  profileEditMode: false,
  assetActiveTab: 'access',
  assetGrantFormOpen: false,
  auditFilterType: '',
  auditFilterRole: '',
  auditFilterSearch: '',
  auditFilterGroup: 'all',
  auditActiveTab: 'log',
  identityFilter: '',
  dashReviewsMineOpen: true,
  dashReviewsTeamOpen: true,
  dashReviewsClosedOpen: false,
  dashboardTab: null,
  reviewActiveTab: 'overview',
  reviewHideResolved: false,
  reviewReplyTo: null,
  lastAuditRows: [],
  lastCsv: null,
  pendingMoverToast: null,
};

export function currentUser() {
  return DB.users.find(u => u.id === State.currentUserId);
}

export function navigate(page) {
  State.currentPage = page;
  State.modal = null;
  notify();
}
export function openModal(modal) { State.modal = modal; notify(); }
export function closeModal() { State.modal = null; notify(); }
// UI-only toggles that had no named handler in the original (it just mutated State fields
// inline inside attachEvents' click listeners, then called render()) — named here so
// components can call them instead of poking State + Store.notify() directly.
export function toggleSidebar() { State.sidebarCollapsed = !State.sidebarCollapsed; State.sidebarUserSet = true; State.settingsMenuOpen = false; notify(); }
export function toggleSettingsMenu() { State.settingsMenuOpen = !State.settingsMenuOpen; notify(); }
// Generic escape hatch: lets a component mutate a State field directly (e.g. a filter or a
// collapse flag) and then flush that change to every subscribed component, exactly like the
// original's render() did after any inline `State.x = y;`.
export function refresh() { notify(); }

export function logout() {
  Session.did = null;
  Session.key = null;
  State.loginFlow = null;
  State.lastProof = null;
  State.currentRole = null;
  State.currentUserId = null;
  State.currentPage = null;
  State.registryFilter = 'all'; State.peopleQuery = ''; State.assetQuery = '';
  State.modal = null;
  State.settingsMenuOpen = false;
  State.auditFilterType = '';
  State.auditFilterRole = '';
  State.auditFilterSearch = '';
  State.auditFilterGroup = 'all';
  State.auditActiveTab = 'log';
  State.identityFilter = '';
  State.dashboardTab = null;
  State.reviewActiveTab = 'overview';
  notify();
}

// ─────────────────────────────────────────────
// TOAST — State.toast is rendered reactively by <Toast/>; no DOM lookups needed any more.
// ─────────────────────────────────────────────
let _toastTimer = null;
export function toast(msg, type = 'success') {
  State.toast = { msg, type };
  notify();
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { State.toast = null; notify(); }, 3500);
}

// ─────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────
const KEYSTORE_STORE = 'bel.keystores.v1';
const MAX_LOGIN_FAILS = 5, LOCKOUT_MS = 30000;
function localKeystores() { try { return JSON.parse(localStorage.getItem(KEYSTORE_STORE) || '{}'); } catch (e) { return {}; } }
function saveLocalKeystore(did, ks) { try { const all = localKeystores(); all[did] = ks; localStorage.setItem(KEYSTORE_STORE, JSON.stringify(all)); } catch (e) { /* storage unavailable */ } }
export function demoAccountFor(did) { return (BEL_DEMO_ACCOUNTS || []).find(a => a.did === did) || null; }
export function emailOf(user) { return user && (user.email || (demoAccountFor(user.did) || {}).email) || null; }
export function keystoreOf(user) {
  const key = didKeyOf(user);
  const candidates = [localKeystores()[user.did], user.keystore, (demoAccountFor(user.did) || {}).keystore].filter(Boolean);
  return candidates.find(ks => key && ks.publicJwk && ks.publicJwk.x === key.x && ks.publicJwk.y === key.y) || null;
}
// Whether this browser holds a locally re-encrypted copy of the keystore — used only to
// describe (in the DID Document pane) whether a demo account still uses its fixed demo
// password or has been re-encrypted with one the user chose.
export function hasLocalKeystore(did) { return !!localKeystores()[did]; }
function findAccount(email) {
  const e = String(email || '').trim().toLowerCase();
  const user = DB.users.find(u => (emailOf(u) || '').toLowerCase() === e);
  const ks = user && keystoreOf(user);
  return user && ks ? { user, ks } : null;
}
function newChallenge(user) {
  const nonce = LEDGER.b64u(crypto.getRandomValues(new Uint8Array(24)));
  return LEDGER.canonical({ domain: 'bel-portal', did: user.did, nonce, issuedAt: now(), expiresIn: 120 });
}
export function tempPassword() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const r = crypto.getRandomValues(new Uint8Array(10));
  return `Bel-${Array.from(r, b => abc[b % abc.length]).join('')}`;
}
export function passwordProblem(p) {
  if (p.length < 8) return 'Use at least 8 characters';
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return 'Use letters and at least one number';
  return null;
}

export const NAV_CONFIG = ['dashboard', 'onboarding', 'assets', 'audit'].map(id => ({
  dashboard: { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  onboarding: { id: 'onboarding', label: 'People', icon: 'directory' },
  assets: { id: 'assets', label: 'Asset Registry', icon: 'assets' },
  audit: { id: 'audit', label: 'Audit Trail', icon: 'audit' },
}[id]));
export function navFor() { return NAV_CONFIG; } // same 4 pages for every role (see app.js's own NAV_CONFIG)

let _pendingPassword = null;
export async function signIn(email, password, newPassword) {
  const key = String(email || '').trim().toLowerCase();
  const fails = State.loginFails[key] || { n: 0, until: 0 };
  const f = State.loginFlow = { email: key, step: 0, busy: true, error: null };
  const fail = msg => { f.busy = false; f.error = msg; notify(); };
  if (fails.until > Date.now()) return fail(`Too many failed attempts — try again in ${Math.ceil((fails.until - Date.now()) / 1000)} s`);
  if (!key || !password) return fail('Enter your email and password');
  notify();
  const acct = findAccount(key);
  const badCreds = () => {
    fails.n += 1;
    if (fails.n >= MAX_LOGIN_FAILS) { fails.until = Date.now() + LOCKOUT_MS; fails.n = 0; }
    State.loginFails[key] = fails;
    fail('Invalid email or password');
  };
  if (!acct) return badCreds();
  const t0 = performance.now();
  let privateJwk;
  try { privateJwk = await LEDGER.Keystore.decrypt(acct.ks, password); } catch (e) { return badCreds(); }
  delete State.loginFails[key];
  const user = acct.user;
  if (!isActive(user)) return fail(`This identity is ${user.status} — contact your administrator`);
  if (acct.ks.mustChange) {
    if (!newPassword) { _pendingPassword = password; f.busy = false; f.mustChange = true; notify(); return; }
    const problem = passwordProblem(newPassword);
    if (problem) { f.busy = false; f.mustChange = true; f.error = problem; notify(); return; }
    if (newPassword === password) { f.busy = false; f.mustChange = true; f.error = 'Choose a password different from the temporary one'; notify(); return; }
    const ks = await LEDGER.Keystore.encrypt(privateJwk, newPassword, { did: user.did, email: emailOf(user) });
    user.keystore = ks;
    saveLocalKeystore(user.did, ks);
    _pendingPassword = null;
  }
  f.step = 1; notify();
  const sessionKey = await LEDGER.Keys.importPrivate(privateJwk);
  privateJwk = null;
  const challenge = newChallenge(user);
  const sig = await LEDGER.Keys.sign(sessionKey, challenge);
  f.step = 2; notify();
  if (!(await LEDGER.Keys.verify(didKeyOf(user), challenge, sig))) return fail("This account's key doesn't match its DID Document on the ledger");
  Session.did = user.did;
  Session.key = sessionKey;
  if (!tryCommit('Auth.login', { challenge, challengeSig: sig }, `${user.role} login — ${user.name} (DID proof verified)`)) { Session.did = Session.key = null; return fail('Sign-in was refused by the ledger'); }
  State.lastProof = { did: user.did, challenge, sig, ms: Math.max(1, Math.round(performance.now() - t0)), thumb: (await LEDGER.Keys.thumbprint(didKeyOf(user))).slice(0, 16) };
  State.loginFlow = null;
  State.currentUserId = user.id;
  State.currentRole = user.role;
  State.registryFilter = 'all'; State.peopleQuery = ''; State.assetQuery = '';
  navigate(navFor(State.currentRole)[0].id);
}
export function submitNewPassword(a, b) {
  if (a !== b) { State.loginFlow.error = "Passwords don't match"; notify(); return; }
  signIn(State.loginFlow.email, _pendingPassword, a);
}

export async function changePassword(user, cur, next, conf) {
  const problem = passwordProblem(next);
  if (problem) { toast(problem, 'error'); return; }
  if (next !== conf) { toast("New passwords don't match", 'error'); return; }
  let jwk;
  try { jwk = await LEDGER.Keystore.decrypt(keystoreOf(user), cur); } catch (e) { toast('Current password is incorrect', 'error'); return; }
  const ks = await LEDGER.Keystore.encrypt(jwk, next, { did: user.did, email: emailOf(user) });
  if (!addAudit('CHANGE_PASSWORD', user.did, `${user.name} re-encrypted their DID keystore with a new password`)) return;
  user.keystore = ks;
  saveLocalKeystore(user.did, ks);
  toast('🔑 Password changed — your DID key is now encrypted with the new password');
}

// ── ROLES ──
export function roleAssetAccess(r) {
  return r.permissions.includes('VIEW_ALL_ASSETS') ? 'Viewer of every asset' : 'Only assets they own or are added to';
}
export function saveRole(id, name, scope, permissions) {
  if (!tryCommit('AccessControl.updateRole', { id, name, permissions, scope }, `Updated role ${id} — ${permissions.length} permissions, scope ${scope}`)) return false;
  toast(`✅ ${name} role updated`);
  State.roleDraft = null;
  notify();
  return true;
}

export function downloadCsv(filename, rows) {
  const cell = v => { const t = String(v == null ? '' : v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const text = rows.map(r => r.map(cell).join(',')).join('\n');
  if (typeof window !== 'undefined' && window.URL && URL.createObjectURL) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
  }
  State.lastCsv = { filename, rows: rows.length };
  toast(`⬇ ${filename} exported (${rows.length - 1} rows)`);
  return text;
}
export function accessReportRows(viewer) {
  const orgWide = ['HQ', 'ALL_READ'].includes(scopeOf(viewer));
  const sc = { assetIn: a => !!a && (orgWide || a.orgUnit === viewer.orgUnit) };
  const rows = [['Asset ID', 'Asset', 'Token', 'Classification', 'Status', 'Owner', 'Identity', 'DID', 'Access', 'Basis', 'Expires']];
  DB.assets.filter(sc.assetIn).forEach(a => DB.users.filter(isActive).forEach(u => {
    const acc = assetAccessFor(u, a);
    if (!acc) return;
    const d = DB.delegations.find(x => x.assetId === a.id && x.toDID === u.did && delegationState(x) === 'approved');
    rows.push([a.id, a.name, tokenLabel(a), a.classification || 'Unclassified', a.status, nameOfDid(a.owner), u.name, u.did, acc.level, acc.basis, d && d.expiresAt ? d.expiresAt : '']);
  }));
  return rows;
}

// ── PEOPLE / ORG ──
export const ROLE_LABELS = { ADMIN: 'Administrator', MANAGER: 'Manager', AUDITOR: 'Auditor', USER: 'User' };
export function peopleSearchText(u) { return `${u.name} ${u.designation} ${u.orgUnit} ${u.did} ${ROLE_LABELS[u.role] || u.role}`.toLowerCase(); }
export function identityFilterRows(viewer, filter) {
  if (filter === 'direct')  return getDirectReports(viewer.id);
  if (filter === 'peers')   return viewer.reportsTo ? getDirectReports(viewer.reportsTo).filter(u => u.id !== viewer.id) : [];
  if (filter === 'upline')  return getManagerChain(viewer.id);
  if (filter === 'pending') return DB.users.filter(u => u.status === 'pending');
  if (filter === 'inactive') return DB.users.filter(u => u.status === 'suspended' || u.status === 'deactivated');
  return DB.users;
}
export function leaverImpact(u) {
  return {
    assets: DB.assets.filter(a => a.owner === u.did && a.status !== 'retired'),
    reviews: DB.reviews.filter(r => r.authorDid === u.did && isOpenReview(r)),
    grants: DB.delegations.filter(d => d.toDID === u.did && ['pending', 'approved'].includes(d.status)),
  };
}

// ── ASSET ACCESS ──
export function assetAccessFor(user, asset) { return RULES.assetAccessFor(DB, user, asset); }
export function assetPerm(user, asset, perm) { return RULES.assetPerm(DB, user, asset, perm); }

// ── REVIEWS ──
export function userByDid(did) { return DB.users.find(u => u.did === did); }
export function latestRev(r) { return RULES.latestRev(r); }
export function reviewAsset(r) { return r.assetId ? DB.assets.find(a => a.id === r.assetId) : null; }
export function reviewAssetLike(r) { return RULES.reviewAssetLike(DB, r); }
export function isOpenReview(r) { return RULES.isOpenReview(r); }
export function isReviewer(user, r) { return RULES.isReviewer(user, r); }
export function isEligibleApprover(user, r) { return RULES.isEligibleApprover(DB, user, r); }
export function canViewReview(user, r) {
  if (!user) return false;
  if (user.did === r.authorDid) return true;
  if (r.status === 'draft') return false;
  return isActive(user) && (isReviewer(user, r) || user.orgUnit === reviewAssetLike(r).orgUnit || !!assetAccessFor(user, reviewAssetLike(r)));
}
export function canApprove(user, r) { return RULES.canApprove(DB, user, r); }
export function canResolveComment(user, r, c) {
  if (!canComment(user, r)) return false;
  if (!c.blocking) return true;
  return c.authorDid === user.did || (user.did !== r.authorDid && isEligibleApprover(user, r));
}
export function canComment(user, r) { return isActive(user) && (r.status === 'draft' ? user.did === r.authorDid : canViewReview(user, r)); }
export function canManageReviewers(user, r) { return RULES.canManageReviewers(DB, user, r); }
export function countedApprovals(r) { return RULES.countedApprovals(DB, r); }
export function unresolvedBlocking(r) { return r.comments.filter(c => c.blocking && !c.resolved); }
export function mergeChecks(r) {
  const rev = latestRev(r);
  const counted = countedApprovals(r).length;
  const requiredPending = r.reviewers.filter(x => x.required && !rev.approvals.some(a => a.did === x.did));
  const blocking = unresolvedBlocking(r);
  return [
    { ok: !!rev.publishedAt, label: rev.publishedAt ? `Revision ${rev.n} is published` : `Revision ${rev.n} is still a draft — publish it to collect approvals` },
    { ok: counted >= r.approvalsRequired, label: r.approvalsRequired === 0 ? 'No approvals required for this asset' : `${counted}/${r.approvalsRequired} approval${r.approvalsRequired === 1 ? '' : 's'} from teammates or added reviewers on revision ${rev.n}` },
    { ok: requiredPending.length === 0, label: requiredPending.length
        ? `Waiting on required reviewer${requiredPending.length > 1 ? 's' : ''}: ${requiredPending.map(x => (userByDid(x.did) || {}).name || x.did).join(', ')}`
        : 'All required reviewers have approved' },
    { ok: blocking.length === 0, label: blocking.length ? `${blocking.length} unresolved blocking comment${blocking.length > 1 ? 's' : ''}` : 'No unresolved blocking comments' },
  ];
}
export function isReadyToMerge(r) { return r.status === 'published' && mergeChecks(r).every(c => c.ok) && RULES.mergeBlockers(DB, r).length === 0; }
export function canMerge(user, r) { return isReadyToMerge(r) && RULES.canMerge(DB, user, r); }
export function canMintAsset(user, a) { return RULES.canMintAsset(DB, user, a); }
function reviewEvent(r, type, did, detail) {
  r.events.push({ type, did, ts: now(), detail });
  r.updatedAt = now();
}
export function guard(fn) {
  try { return fn(); }
  catch (e) {
    if (e instanceof CONTRACTS.ContractError) { toast(`⛔ ${e.message}`, 'error'); return undefined; }
    throw e;
  }
}
export function createReview({ asset, blob, author, classification, approvalsRequired }) {
  const id = newId('rev');
  const cls = classification || asset.classification || 'Unclassified';
  commit('Review.create', { review: { id, assetId: asset.id, classification: cls, approvalsRequired, revision: { hash: blob.hash, size: blob.size } } },
    `Created draft review ${id} to update ${asset.id} – ${asset.name}`);
  const r = DB.reviews.find(x => x.id === id);
  Object.assign(r, { assetName: asset.name, newAsset: null, desc: '', createdAt: now(), updatedAt: now(), comments: [], events: [] });
  Object.assign(r.revisions[0], { fileName: blob.fileName, storagePath: blob.storagePath || null, createdAt: now() });
  reviewEvent(r, 'CREATE', author.did, `Created draft review with revision 1 (${blob.fileName})`);
  return r;
}
export function createAsset({ name, orgUnit, desc, classification, approvalsRequired, blob, author }) {
  const id = newId('ast');
  commit('Asset.create', { asset: { id, name, orgUnit, classification, approvalsRequired, hash: blob.hash, size: blob.size } },
    `Created ${id} – ${name} (v1, ${classification}, ${approvalsRequired} approval${approvalsRequired === 1 ? '' : 's'} per update, SHA-256 ${shortHash(blob.hash)})`);
  const a = DB.assets.find(x => x.id === id);
  Object.assign(a, { uploadedAt: today(), desc, storagePath: blob.storagePath || null, fileName: blob.fileName, approvedBy: null, approvedAt: null });
  return a;
}
export function addRevision(r, blob, user) {
  const replacing = !latestRev(r).publishedAt;
  commit('Review.addRevision', { reviewId: r.id, hash: blob.hash, size: blob.size }, `Uploaded a new revision to review ${r.id} for ${r.assetName}`);
  const rev = latestRev(r);
  Object.assign(rev, { fileName: blob.fileName, storagePath: blob.storagePath || null, createdAt: now() });
  reviewEvent(r, 'REVISION', user.did, replacing ? `Replaced draft revision ${rev.n} with ${blob.fileName}` : `Uploaded revision ${rev.n} (${blob.fileName}) as a draft`);
  return r;
}
export function publishReview(r, user) {
  const rev = latestRev(r);
  commit('Review.publish', { reviewId: r.id }, `Published revision ${rev.n} of review ${r.id} for ${r.assetName}`);
  reviewEvent(r, 'PUBLISH', user.did, `Published revision ${rev.n}`);
  return r;
}
export function approveRevision(r, user) {
  const rev = latestRev(r);
  commit('Review.approve', { reviewId: r.id }, `Approved revision ${rev.n} of review ${r.id} for ${r.assetName} (${countedApprovals(r).length + (isEligibleApprover(user, r) ? 1 : 0)}/${r.approvalsRequired})`);
  reviewEvent(r, 'APPROVE', user.did, `Approved revision ${rev.n}`);
  return r;
}
export function mergeReview(r, user) {
  if (unresolvedBlocking(r).length) throw new CONTRACTS.ContractError('Resolve the blocking comments first');
  const rev = latestRev(r);
  const asset = reviewAsset(r);
  const version = (asset.version || 1) + 1;
  const approvers = countedApprovals(r).map(a => a.did);
  commit('Review.merge', { reviewId: r.id, version, contentHash: rev.hash, approvers },
    `Merged review ${r.id}: ${asset.id} – ${asset.name} is now v${version} (SHA-256 ${shortHash(rev.hash)}, ${approvers.length} approval${approvers.length === 1 ? '' : 's'})`);
  Object.assign(asset, { storagePath: rev.storagePath || asset.storagePath || null, fileName: rev.fileName || asset.fileName, desc: r.desc || asset.desc, approvedBy: user.did, approvedAt: now() });
  Object.assign(r, { mergedAt: now(), mergedBy: user.did });
  reviewEvent(r, 'MERGE', user.did, `Merged revision ${rev.n} as v${version}`);
  return r;
}
export function mintAsset(asset, user) {
  const tokenId = RULES.nextTokenId(DB);
  commit('AssetNFT.mint', { assetId: asset.id, tokenId, contentHash: asset.hash },
    `Minted ${tokenLabel({ tokenId })} for ${asset.id} – ${asset.name} to ${asset.owner} (v${asset.version || 1})`);
  return asset;
}
export function cancelReview(r, user, reason) {
  commit('Review.cancel', { reviewId: r.id, reason: reason || null }, `Canceled review ${r.id} for ${r.assetName}${reason ? ` – ${reason}` : ''}`);
  Object.assign(r, { canceledAt: now(), canceledBy: user.did, cancelReason: reason || null });
  reviewEvent(r, 'CANCEL', user.did, `Marked as canceled${reason ? ` — ${reason}` : ''}`);
  return r;
}
export function reopenReview(r, user) {
  commit('Review.reopen', { reviewId: r.id }, `Reopened review ${r.id} for ${r.assetName}`);
  r.canceledAt = r.canceledBy = r.cancelReason = null;
  reviewEvent(r, 'REOPEN', user.did, 'Reopened the review');
  return r;
}
export function discardDraft(r, user) {
  const whole = !r.revisions.some(v => v.publishedAt);
  const n = latestRev(r).n;
  commit('Review.discard', { reviewId: r.id }, whole ? `Discarded draft review ${r.id} for ${r.assetName}` : `Discarded draft revision ${n} of review ${r.id}`);
  if (whole) { if (SupabaseSync) SupabaseSync.deleteRows('reviews', [r.id]); return 'review'; }
  reviewEvent(r, 'DISCARD', user.did, `Discarded draft revision ${n}`);
  return 'revision';
}
export function setReviewers(r, reviewers, user, what) {
  commit('Review.setReviewers', { reviewId: r.id, reviewers }, `${what} on review ${r.id} for ${r.assetName}`);
  reviewEvent(r, 'REVIEWER', user.did, what);
  return r;
}
// The following review actions had no named handler in the original app.js — they were
// inlined directly inside attachReviewEvents' click/change listeners (reading DOM values
// and mutating r.comments/r.reviewers in place). Extracted here, unchanged in behaviour,
// so the new review-detail/reviewers/comments components can call them like any other
// core.js action instead of reaching into the DOM.
export function saveReviewDesc(r, viewer, text) {
  if (!r || r.authorDid !== viewer.did) return;
  r.desc = String(text || '').trim();
  reviewEvent(r, 'EDIT', viewer.did, 'Edited the description');
  notify();
}
export function addReviewer(r, viewer, did, required) {
  if (!r || !did || r.reviewers.some(x => x.did === did)) return false;
  const u = userByDid(did);
  if (!guard(() => setReviewers(r, [...r.reviewers, { did, required }], viewer, `Added ${u ? u.name : did} as ${required ? 'a required' : 'an optional'} reviewer`))) return false;
  notify();
  return true;
}
export function autoAssignReviewers(r, viewer) {
  if (!r || !canManageReviewers(viewer, r)) return;
  const picks = DB.users.filter(u => isActive(u) && isEligibleApprover(u, r) && !latestRev(r).approvals.some(a => a.did === u.did))
    .sort((a, b) => (a.orgUnit === r.orgUnit ? 0 : 1) - (b.orgUnit === r.orgUnit ? 0 : 1)).slice(0, r.approvalsRequired);
  if (!guard(() => setReviewers(r, [...r.reviewers, ...picks.map(u => ({ did: u.did, required: false }))], viewer, `Auto-assigned ${picks.length} reviewer${picks.length === 1 ? '' : 's'}`))) return [];
  notify();
  return picks;
}
export function toggleReviewerRequired(r, viewer, did, required) {
  const entry = r && r.reviewers.find(x => x.did === did);
  if (!entry) return;
  const next = r.reviewers.map(x => (x.did === entry.did ? { ...x, required } : x));
  guard(() => setReviewers(r, next, viewer, `Marked ${(userByDid(entry.did) || {}).name || entry.did} as ${required ? 'required' : 'optional'}`));
  notify();
}
export function removeReviewer(r, viewer, did) {
  if (!r) return;
  guard(() => setReviewers(r, r.reviewers.filter(x => x.did !== did), viewer, `Removed ${(userByDid(did) || {}).name || did} as a reviewer`));
  notify();
}
export function addReviewComment(r, viewer, text, blocking) {
  if (!r || !canComment(viewer, r)) return false;
  const t = String(text || '').trim();
  if (!t) { toast('Write a comment first', 'error'); return false; }
  if (!addAudit(blocking ? 'BLOCKING_COMMENT' : 'COMMENT_REVIEW', viewer.did, `${blocking ? 'Blocking comment' : 'Comment'} on review ${r.id} for ${r.assetName}`)) return false;
  r.comments.push({ id: newId('c'), authorDid: viewer.did, text: t, ts: now(), revision: latestRev(r).n, blocking, resolved: false, resolvedBy: null, replies: [] });
  reviewEvent(r, blocking ? 'BLOCK' : 'COMMENT', viewer.did, `${blocking ? 'Left a blocking comment' : 'Commented'} on revision ${latestRev(r).n}`);
  notify();
  return true;
}
export function postReviewReply(r, c, viewer, text) {
  if (!c || !canComment(viewer, r)) return false;
  const t = String(text || '').trim();
  if (!t) { toast('Write a reply first', 'error'); return false; }
  c.replies.push({ id: newId('c'), authorDid: viewer.did, text: t, ts: now() });
  reviewEvent(r, 'COMMENT', viewer.did, 'Replied to a comment');
  notify();
  return true;
}
export function resolveReviewComment(r, c, viewer) {
  if (!c || !canResolveComment(viewer, r, c)) return;
  if (c.blocking && !addAudit(c.resolved ? 'REOPEN_BLOCKING' : 'RESOLVE_BLOCKING', viewer.did, `${c.resolved ? 'Re-opened' : 'Resolved'} a blocking comment on review ${r.id} for ${r.assetName}`)) return;
  c.resolved = !c.resolved;
  c.resolvedBy = c.resolved ? viewer.did : null;
  reviewEvent(r, 'RESOLVE', viewer.did, `${c.resolved ? 'Resolved' : 'Unresolved'} a ${c.blocking ? 'blocking ' : ''}comment`);
  notify();
}
export function flagReviewCommentBlocking(r, c, viewer) {
  if (!c || !canComment(viewer, r)) return;
  if (!addAudit('BLOCKING_COMMENT', viewer.did, `Flagged a comment as blocking on review ${r.id} for ${r.assetName}`)) return;
  c.blocking = true;
  reviewEvent(r, 'BLOCK', viewer.did, 'Flagged a comment as blocking');
  notify();
}
function seedReviewEvents(r) {
  if (r.events) return;
  const ev = [{ type: 'CREATE', did: r.authorDid, ts: r.createdAt, detail: 'Created draft review with revision 1' }];
  r.revisions.forEach(v => {
    if (v.publishedAt) ev.push({ type: 'PUBLISH', did: r.authorDid, ts: v.publishedAt, detail: `Published revision ${v.n}` });
    v.approvals.forEach(a => ev.push({ type: 'APPROVE', did: a.did, ts: a.ts, detail: `Approved revision ${v.n}` }));
  });
  r.comments.forEach(c => ev.push({ type: c.blocking ? 'BLOCK' : 'COMMENT', did: c.authorDid, ts: c.ts, detail: `${c.blocking ? 'Left a blocking comment' : 'Commented'} on revision ${c.revision}` }));
  if (r.mergedAt) ev.push({ type: 'MINT', did: r.mergedBy, ts: r.mergedAt, detail: `${r.kind === 'update' ? 'Released' : 'Minted'} revision ${latestRev(r).n}` });
  if (r.canceledAt) ev.push({ type: 'CANCEL', did: r.canceledBy, ts: r.canceledAt, detail: `Marked as canceled${r.cancelReason ? ` — ${r.cancelReason}` : ''}` });
  r.events = ev.sort((a, b) => new Date(a.ts) - new Date(b.ts));
}
DB.reviews.forEach(seedReviewEvents);
export function reviewKindLabel(r) { return r.kind === 'update' ? 'Version update' : 'New submission'; }
export function openReviewByViewer(asset, viewer) {
  return DB.reviews.find(r => r.assetId === asset.id && r.authorDid === viewer.did && isOpenReview(r));
}
export function reviewDashGroups() {
  const viewer = currentUser();
  const byRecent = (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt);
  const mine = DB.reviews.filter(r => r.authorDid === viewer.did && isOpenReview(r)).sort(byRecent);
  const scope = scopeOf(viewer);
  const inTeamScope = r => scope === 'HQ' || r.orgUnit === viewer.orgUnit;
  const team = DB.reviews.filter(r => r.authorDid !== viewer.did && r.status === 'published' && (inTeamScope(r) || isReviewer(viewer, r)) && canViewReview(viewer, r)).sort(byRecent);
  const closed = DB.reviews.filter(r => !isOpenReview(r) && (r.authorDid === viewer.did || isReviewer(viewer, r) || (inTeamScope(r) && canViewReview(viewer, r)))).sort(byRecent);
  return {
    count: mine.filter(r => canMerge(viewer, r)).length + team.filter(r => canApprove(viewer, r)).length,
    mine, team, closed,
  };
}
export function sharedWithLabel(a) {
  const g = DB.delegations.filter(d => d.assetId === a.id && delegationState(d) === 'approved');
  const e = g.filter(d => d.access === 'Editor').length, v = g.length - e;
  return g.length ? [e && `${e} Editor${e > 1 ? 's' : ''}`, v && `${v} Viewer${v > 1 ? 's' : ''}`].filter(Boolean).join(' · ') : 'Only you';
}

// ── CUSTODY / NFT ──
export function transferPreview(actor, asset, toDid) { return RULES.transferPreview(DB, actor, asset, toDid); }
// Custody actions — the original inlined these as tryCommit() calls directly inside
// attachCustodyEvents' click listeners (reading DOM input values). Named here, same
// ledger calls and detail strings, so the new modal components can call them directly.
export function transferCustody(asset, toDid, reason) {
  if (!toDid) { toast('Choose the new owner', 'error'); return false; }
  const id = newId('tr');
  if (!tryCommit('Custody.transfer', { transferId: id, assetId: asset.id, toDid, reason: reason || null },
    `Transferred ownership of ${asset.id} – ${asset.name}${asset.tokenId ? ` (${tokenLabel(asset)})` : ''} to ${nameOfDid(toDid)}`)) return false;
  closeModal();
  toast(`⇄ ${nameOfDid(toDid)} is now the owner of ${asset.name}`);
  return true;
}
export function recoverCustody(asset, toDid, reason) {
  if (!toDid) { toast('Choose the new owner', 'error'); return false; }
  const from = asset.owner;
  if (!tryCommit('Custody.forceReassign', { transferId: newId('tr'), assetId: asset.id, toDid, reason },
    `Admin override: transferred ${asset.id} – ${asset.name} from ${nameOfDid(from)} (${(DB.users.find(u => u.did === from) || {}).status || 'inactive'}) to ${nameOfDid(toDid)} — ${reason}`)) return false;
  openModal({ type: 'asset-profile', aid: asset.id });
  State.assetActiveTab = 'nft';
  toast(`↺ Custody reassigned to ${nameOfDid(toDid)}`);
  return true;
}
export function setAssetApprovals(asset, n) {
  if (!tryCommit('Asset.configure', { assetId: asset.id, approvalsRequired: n }, `Set ${asset.id} – ${asset.name} to need ${n} approval${n === 1 ? '' : 's'} per update`)) return false;
  toast(`Updates to ${asset.name} now need ${n} approval${n === 1 ? '' : 's'}`);
  notify();
  return true;
}
export function retireAsset(asset, reason) {
  if (!tryCommit('AssetNFT.retire', { assetId: asset.id, reason }, `Retired ${tokenLabel(asset)} ${asset.id} – ${asset.name} — ${reason}`)) return false;
  openModal({ type: 'asset-profile', aid: asset.id });
  State.assetActiveTab = 'nft';
  toast(`⏹ ${tokenLabel(asset)} retired`, 'warning');
  return true;
}
export async function justifiedDownload(asset, why) {
  if (!why) { toast('A justification is required', 'error'); return false; }
  openModal({ type: 'asset-profile', aid: asset.id });
  const ok = await doDownload(asset, why);
  if (!ok) notify();
  return ok;
}
export async function nftVerifyFile(asset, file) {
  State.nftVerify = { aid: asset.id, match: (await sha256Hex(file)) === asset.hash };
  notify();
}
export function tokenHistory(asset) {
  const out = [];
  LEDGER.Chain.txs().forEach(({ tx, block }) => {
    const key = `${tx.contract}.${tx.method}`;
    const review = tx.args && tx.args.reviewId && DB.reviews.find(r => r.id === tx.args.reviewId);
    const forAsset = (tx.args && tx.args.assetId === asset.id) || (review && review.assetId === asset.id);
    if (!forAsset) return;
    const at = { by: tx.actor, ts: tx.ts, height: block.height, tx: tx.hash };
    if (key === 'Asset.import') out.push({ what: 'Registered (existing record)', version: tx.args.asset.version || 1, hash: tx.args.asset.hash, ...at });
    if (key === 'Asset.create') out.push({ what: 'Created', version: 1, hash: tx.args.asset.hash, ...at });
    if (key === 'AssetNFT.legacyMint' || key === 'AssetNFT.mint') out.push({ what: `NFT minted — ${tokenLabel({ tokenId: tx.args.tokenId })}`, version: null, hash: tx.args.contentHash, ...at, mint: true });
    if (key === 'Review.merge') out.push({ what: `Merged review ${tx.args.reviewId}`, version: tx.args.version, hash: tx.args.contentHash, ...at, approvers: tx.args.approvers });
  });
  return out;
}
export function requestDownload(asset) {
  if (!asset) return;
  if (RULES.classLevel(asset) >= 3) { openModal({ type: 'download-justify', aid: asset.id, back: State.modal }); return; }
  doDownload(asset, null);
}
export async function doDownload(asset, justification) {
  if (!tryCommit('Asset.download', { assetId: asset.id, justification: justification || undefined },
    `Downloaded ${asset.id} – ${asset.name}${justification ? ` — justification: ${justification}` : ''}`)) return false;
  const Sync = SupabaseSync;
  if (asset.storagePath && Sync && Sync.downloadAssetBlob) {
    try {
      const blob = await Sync.downloadAssetBlob(asset.storagePath);
      if (blob && typeof window !== 'undefined' && window.URL && URL.createObjectURL) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = asset.name;
        document.body.appendChild(a); a.click(); a.remove();
        toast(`⬇ ${asset.name} downloaded (SHA-256 recorded as ${shortHash(asset.hash)})`);
        return true;
      }
    } catch (e) { console.warn('Storage download failed:', e); }
  }
  toast(`⬇ Download of ${asset.name} recorded — the file itself is kept in the Hyperledger Chain's storage; this copy only holds its hash`);
  return true;
}

// ── AUDIT TRAIL ──
export const AUDIT_GROUPS = [
  { id: 'identity', label: 'Identity', test: t => /ONBOARD|REGISTER|IDENTITY|STATUS|SUSPEND|ROTATE_KEY|UPDATE_ACCESS/.test(t) },
  { id: 'assets',   label: 'Assets & NFTs', test: t => /ASSET|NFT|TRANSFER|DOWNLOAD/.test(t) },
  { id: 'access',   label: 'Access & roles', test: t => /GRANT|REVOKE|DELEG|ROLE/.test(t) },
  { id: 'reviews',  label: 'Reviews', test: t => /REVIEW|BLOCKING|APPROVE_ASSET|REJECT_ASSET/.test(t) },
  { id: 'signin',   label: 'Sign-ins', test: t => /AUTHENTICATE|PASSWORD/.test(t) },
];
export function auditGroupOf(type) {
  const t = String(type || '');
  const order = ['signin', 'reviews', 'access', 'identity', 'assets'];
  const g = order.map(id => AUDIT_GROUPS.find(x => x.id === id)).find(x => x.test(t));
  return g ? g.id : 'other';
}
export const humanType = t => String(t || '').toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()).replace(/\b(did|nft|deleg)\b/g, w => ({ did: 'DID', nft: 'NFT', deleg: 'delegation' })[w]);

// ── GLOBAL LISTENERS (registered once from the top-level component) ──
export function initGlobalListeners() {
  if (typeof window === 'undefined') return () => {};
  const onResize = () => {
    if (State.sidebarUserSet) return;
    const narrow = window.innerWidth < 1440;
    if (narrow !== State.sidebarCollapsed) { State.sidebarCollapsed = narrow; if (State.currentUserId && !State.modal) notify(); }
  };
  const onDocClick = e => {
    if (State.settingsMenuOpen && !e.target.closest('.settings-dropdown-wrap')) { State.settingsMenuOpen = false; notify(); }
    if (e.target && e.target.id === 'remoteRefreshBtn') resyncFromRemote('poll');
  };
  window.addEventListener('resize', onResize);
  document.addEventListener('click', onDocClick);
  return () => { window.removeEventListener('resize', onResize); document.removeEventListener('click', onDocClick); };
}

// ─────────────────────────────────────────────
// IDENTITY ACTIONS — Employee Profile / People page / Register Employee. The original
// inlined all of these as tryCommit() calls directly inside attachEvents' click
// listeners (reading DOM input values with document.getElementById). Extracted here,
// same ledger calls and business rules, so the new modal components can call them
// directly with values from their own controlled inputs instead of the DOM.
// ─────────────────────────────────────────────
export function activateUser(u) {
  if (!u || !tryCommit('Identity.setStatus', { userId: u.id, status: 'active' }, `Activated ${u.name} (${u.did})`, { type: 'ACTIVATE_IDENTITY' })) return false;
  toast(`✅ ${u.name} activated`);
  notify();
  return true;
}
export function suspendUser(u) {
  if (!u || !tryCommit('Identity.setStatus', { userId: u.id, status: 'suspended' }, `Suspended ${u.name} (${u.did})`, { type: 'SUSPEND_USER' })) return false;
  toast(`⚠️ ${u.name} suspended`, 'warning');
  notify();
  return true;
}
export async function issueCredentials(u, email) {
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { toast('Enter a valid sign-in email', 'error'); return false; }
  if (DB.users.some(x => x.id !== u.id && (emailOf(x) || '').toLowerCase() === e)) { toast('That email is already in use', 'error'); return false; }
  const n = ((u.didDoc && u.didDoc.verificationMethod) || []).length + 1;
  const kid = `${u.did}#key-${n}`;
  const keys = await LEDGER.Keys.generate();
  const password = tempPassword();
  const keystore = await LEDGER.Keystore.encrypt(keys.privateJwk, password, { did: u.did, email: e, mustChange: true });
  if (!tryCommit('Identity.rotateKey', { userId: u.id, newKey: { kid, publicJwk: keys.publicJwk }, reason: 'Credential reset by administrator' },
    `Issued new sign-in credentials for ${u.name} (${u.did}) — key ${kid.split('#').pop()}, previous key revoked`)) return false;
  Object.assign(u, { email: e, keystore });
  saveLocalKeystore(u.did, keystore);
  openModal({ type: 'credentials-issued', name: u.name, email: e, password, kid });
  return true;
}
export function deactivateUser(u, reason) {
  const held = leaverImpact(u).assets.length;
  if (!tryCommit('Identity.deactivate', { userId: u.id, reason }, `Deactivated ${u.name} (${u.did}) — ${reason}`)) return false;
  openModal({ type: 'employee-profile', uid: u.id });
  toast(`${u.name} deactivated${held ? ` — ${held} asset${held === 1 ? '' : 's'} need custody recovery (flagged in the Asset Registry)` : ''}`, 'warning');
  return true;
}
export async function registerEmployee(fields) {
  let { name, desig, unit, role, aadhaar, pan, reportsToTyped, email } = fields;
  if (!name) name = `New Employee ${String(DB.nextId + 1).padStart(3, '0')}`;
  desig = desig || 'Employee';
  aadhaar = String(aadhaar || '').replace(/\s+/g, '');
  pan = String(pan || '').trim().toUpperCase();
  email = String(email || '').trim().toLowerCase();
  if (!/^\d{12}$/.test(aadhaar)) aadhaar = String(Math.floor(1e11 + Math.random() * 8.9e11));
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) {
    const letters = () => Array.from({ length: 5 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');
    pan = `${letters()}${Math.floor(1000 + Math.random() * 9000)}${String.fromCharCode(65 + Math.floor(Math.random() * 26))}`;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || DB.users.some(u => (emailOf(u) || '').toLowerCase() === email)) {
    const base = name.toLowerCase().replace(/[^a-z\s]/g, '').trim().replace(/\s+/g, '.') || 'employee';
    let candidate = `${base}@bel.in`, n = 1;
    while (DB.users.some(u => (emailOf(u) || '').toLowerCase() === candidate)) candidate = `${base}${++n}@bel.in`;
    email = candidate;
  }
  const managers = eligibleManagersFor(null);
  const manager = findManagerByInput(reportsToTyped, managers) || managers[0];
  if (!manager) { toast('No eligible manager exists yet to report to', 'error'); return null; }
  const reportsTo = manager.id;
  if (!hasPerm(currentUser(), 'MANAGE_IDENTITY')) { toast('Requires Identity Management (MANAGE_IDENTITY)', 'error'); return null; }
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) + String(DB.nextId + 1).padStart(3, '0');
  const did = `did:bel:${slug}`;
  const uid = newId('u');
  const keys = await LEDGER.Keys.generate();
  const password = tempPassword();
  const keystore = await LEDGER.Keystore.encrypt(keys.privateJwk, password, { did, email, mustChange: true });
  const piiSalt = LEDGER.b64u(crypto.getRandomValues(new Uint8Array(16)));
  const piiCommitment = await LEDGER.sha256Hex(`${did}|${aadhaar}|${pan}|${piiSalt}`);
  const ok = tryCommit('Identity.register', {
    user: { id: uid, did, name, designation: desig, role, orgUnit: unit, reportsTo, status: 'pending', joined: today(), permOverrides: null, piiCommitment },
    didDoc: didDocFor(did, keys.publicJwk),
  }, `Onboarded ${name} (${desig}) → ${did}, reports to ${manager.name}`, { type: 'ONBOARD' });
  if (!ok) return null;
  Object.assign(DB.users.find(u => u.id === uid), { aadhaar, pan, piiSalt, email, keystore });
  saveLocalKeystore(did, keystore);
  State.expandedOrgNodes.add(reportsTo);
  const thumb = (await LEDGER.Keys.thumbprint(keys.publicJwk)).slice(0, 16);
  openModal({ type: 'onboard-success', name, did, unit, role, desig, aadhaar, pan, managerName: manager.name, thumb, email, password });
  return did;
}
export function savePersonalInfo(user, fields) {
  const { name, desig, unit, aadhaarRaw, panRaw, reportsToTyped } = fields;
  if (!name) { toast('Enter employee name', 'error'); return false; }
  if (aadhaarRaw && !/^\d{12}$/.test(aadhaarRaw)) { toast('Enter a valid 12-digit Aadhaar number', 'error'); return false; }
  if (panRaw && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(panRaw)) { toast('Enter a valid PAN (e.g. ABCDE1234F)', 'error'); return false; }
  const managers = eligibleManagersFor(user);
  const currentManager = DB.users.find(u => u.id === user.reportsTo);
  let newReportsTo = user.reportsTo;
  if (reportsToTyped && !(currentManager && reportsToTyped.toLowerCase() === reportsToLabel(currentManager).toLowerCase())) {
    const manager = findManagerByInput(reportsToTyped, managers);
    if (!manager) {
      const typedUser = findManagerByInput(reportsToTyped, DB.users);
      toast(typedUser && getSubtreeIds(user.id).concat(user.id).includes(typedUser.id)
        ? `${typedUser.name} is in ${user.name}'s own reporting line and can't be their manager`
        : 'Select a valid manager from the Reports To suggestions', 'error');
      return false;
    }
    newReportsTo = manager.id;
  }
  const oldUnit = user.orgUnit;
  if (!tryCommit('Identity.updateProfile', { userId: user.id, name, designation: desig || user.designation, orgUnit: unit, reportsTo: newReportsTo || null },
    `Updated identity ${user.did} (${name})${unit !== oldUnit ? ` — moved ${oldUnit} → ${unit}` : ''}`)) return false;
  let moverToast = null;
  if (unit !== oldUnit) {
    const imp = leaverImpact(user);
    moverToast = `${user.name} moved to ${unit}: check ${imp.grants.length} access grant(s) and ${imp.assets.length} held asset(s) from the old job`;
  }
  if (aadhaarRaw) user.aadhaar = aadhaarRaw;
  if (panRaw) user.pan = panRaw;
  if (newReportsTo) State.expandedOrgNodes.add(newReportsTo);
  toast(moverToast ? `⚠ ${moverToast}` : `✅ ${user.name}'s record updated`, moverToast ? 'warning' : 'success');
  notify();
  return true;
}
export function saveProfileAccess(user, viewer, { role, status, checkedPerms }) {
  if (!hasPerm(viewer, 'MANAGE_IDENTITY')) { toast('You are not permitted to manage identities', 'error'); return false; }
  if (viewer.id === user.id) { toast('Ask another administrator to change your own access', 'error'); return false; }
  const roleDefaultPerms = (DB.roleDefinitions.find(r => r.id === role) || { permissions: [] }).permissions;
  const isCustom = checkedPerms.length !== roleDefaultPerms.length || checkedPerms.some(p => !roleDefaultPerms.includes(p));
  const changes = { userId: user.id };
  if (role !== user.role) changes.role = role;
  if (status !== user.status) changes.status = status;
  const nextOverrides = isCustom ? checkedPerms : null;
  if (JSON.stringify(nextOverrides) !== JSON.stringify(user.permOverrides || null)) changes.permOverrides = nextOverrides;
  if (Object.keys(changes).length === 1) { toast('No changes to save'); return false; }
  if (!tryCommit('AccessControl.updateAccess', changes, `Updated access control for ${user.name} (${user.did}) — role: ${role}, status: ${status}${isCustom ? `, custom permissions (${checkedPerms.length})` : ', role default permissions'}`)) return false;
  toast(`✅ Access control updated for ${user.name}`);
  notify();
  return true;
}
export function resetPermOverride(user) {
  if (!user || !tryCommit('AccessControl.updateAccess', { userId: user.id, permOverrides: null }, `Reset ${user.name} (${user.did}) permissions to role default`)) return false;
  toast(`Permissions reset to ${user.role} default for ${user.name}`);
  notify();
  return true;
}
// Asset Profile → Access tab: grant/revoke an explicit per-asset delegation. Same ledger
// calls as the original's inline confirmGrantAssetAccessBtn/[data-action=revoke-asset-access]
// listeners.
export function grantAssetAccess(asset, toDID, access, expiresAt) {
  if (!asset || !toDID) { toast('Choose a person', 'error'); return false; }
  const id = newId('del');
  if (!tryCommit('Delegation.grant', { delegation: { id, assetId: asset.id, toDID, access, expiresAt: expiresAt || null } },
    `Added ${nameOfDid(toDID)} as ${access} of ${asset.id} – ${asset.name}${expiresAt ? ` until ${expiresAt}` : ''}`)) return false;
  Object.assign(DB.delegations.find(d => d.id === id), { assetName: asset.name, requestedAt: today(), approvedAt: today() });
  toast(`✅ ${nameOfDid(toDID)} is now ${access === 'Editor' ? 'an Editor' : 'a Viewer'}`);
  notify();
  return true;
}
export function revokeAssetAccess(asset, delegId) {
  const d = DB.delegations.find(x => x.id === delegId);
  if (!d || !asset) return false;
  const grantee = DB.users.find(u => u.did === d.toDID);
  if (!tryCommit('Delegation.revoke', { delegationId: d.id }, `Removed ${grantee ? grantee.name : d.toDID} (${d.access || 'Viewer'}) from ${asset.id} – ${asset.name}`)) return false;
  toast(`${grantee ? grantee.name : d.toDID} no longer has access`, 'warning');
  notify();
  return true;
}
