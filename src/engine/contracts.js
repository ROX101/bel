/* ============================================================
   BELContracts — the "smart contracts" of the BEL Portal ledger
   ============================================================
   Ported near-verbatim from the original vanilla-JS bel-portal/contracts.js.
   Only the outer wrapper changed (IIFE -> ES module scope); see the note
   at the top of src/engine/ledger.js. Internal logic is unchanged.
   Every state-changing operation is a contract method with two parts:
     authorize(S, tx, ctx) — throws ContractError if the rule isn't met (RBAC, ownership, …)
     apply(S, tx, ctx)     — mutates the state S
   The same code runs on the live app state (the app's DB object) before a transaction is
   signed and sealed, and again during Verify, when the whole chain is replayed from an
   empty state — so whatever the UI allows, the chain can prove was allowed.
   Rules are pure functions of an explicit state S (the app wraps them with DB).
   Only the fields listed in project() are "on-chain"; everything else in DB (comments,
   descriptions, file names…) is off-chain metadata.
   ============================================================ */
import './ledger.js'; // ensures window.BELLedger exists before this module's top-level code runs
  class ContractError extends Error {}
  const fail = msg => { throw new ContractError(msg); };
  const need = (cond, msg) => { if (!cond) fail(msg); };

  const CHAIN_ID = 'bel-portal-demo';
  const ORG_DID = 'did:bel:org';

  function localDate(iso) {
    const d = iso ? new Date(iso) : new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // ── Catalogs ──────────────────────────────────────────────────────
  // Asset-specific access — three levels, simple on purpose:
  //   Owner  — holds the asset (NFT): update, share (add Editors/Viewers) and transfer ownership
  //   Editor — can update the asset (new versions via review)
  //   Viewer — can view and download it
  const ASSET_LEVELS = {
    Owner:  ['VIEW', 'DOWNLOAD', 'UPLOAD_ASSET', 'SHARE', 'TRANSFER'],
    Editor: ['VIEW', 'DOWNLOAD', 'UPLOAD_ASSET'],
    Viewer: ['VIEW', 'DOWNLOAD'],
  };
  const ASSET_PERMS = ['VIEW', 'DOWNLOAD', 'UPLOAD_ASSET', 'SHARE', 'TRANSFER'];
  // Role-level permissions (what a role can do across the portal).
  const ALL_PERMS = ['UPLOAD_ASSET', 'MINT_ASSET', 'APPROVE_TRANSFER', 'VIEW_ALL_ASSETS', 'VIEW_AUDIT', 'MANAGE_IDENTITY', 'MANAGE_ROLE'];
  // Role scope — how far a role sees across org units (audit trail, registry, team reviews).
  const SCOPES = {
    HQ:       { label: 'Organisation-wide' },
    UNIT:     { label: 'Own org unit' },
    ALL_READ: { label: 'Organisation-wide, read-only' },
    SELF:     { label: 'Own work only' },
  };
  const LEGACY_SCOPE = { ADMIN: 'HQ', MANAGER: 'UNIT', AUDITOR: 'ALL_READ' };
  const GRANTABLE_LEVELS = ['Editor', 'Viewer'];
  // Security classification of an asset (defence marking). Higher levels tighten the policy.
  const CLASSIFICATIONS = ['Unclassified', 'Restricted', 'Confidential', 'Secret'];
  const MAX_APPROVALS = 3; // per-asset setting for updates: 0–3 approvals
  const MAX_GRANT_DAYS = 365;
  const levelOf = d => d.access || ((d.permissions || []).includes('UPLOAD_ASSET') ? 'Editor' : 'Viewer');

  // ── Rules (pure functions of state S) ─────────────────────────────
  const R = {
    dayOf: S => S.__today || localDate(),
    userByDid: (S, did) => S.users.find(u => u.did === did),
    userById: (S, id) => S.users.find(u => u.id === id),
    roleOf: (S, u) => S.roleDefinitions.find(r => r.id === (u && u.role)),
    scopeOf(S, u) { const r = R.roleOf(S, u); return (r && (r.scope || LEGACY_SCOPE[r.id])) || 'SELF'; },
    effectivePermissions(S, u) {
      if (!u) return [];
      if (u.permOverrides) return u.permOverrides;
      const r = R.roleOf(S, u);
      return r ? r.permissions : [];
    },
    isActive: u => !!u && u.status === 'active',
    hasPerm: (S, u, p) => R.isActive(u) && R.effectivePermissions(S, u).includes(p),
    // One mechanism: holding UPLOAD_ASSET (from the role or a per-identity override) is the upload right.
    canUpload: (S, u) => R.hasPerm(S, u, 'UPLOAD_ASSET'),
    // The verification key currently authorised for a DID (key rotation adds #key-2, #key-3, …).
    currentKey(S, did) {
      const doc = did === ORG_DID ? S.orgDidDoc : (R.userByDid(S, did) || {}).didDoc;
      if (!doc) return null;
      const kid = (doc.authentication || [])[0];
      return (doc.verificationMethod || []).find(m => m.id === kid) || (doc.verificationMethod || [])[0] || null;
    },
    managerChain(S, u) {
      const out = [];
      let cur = u;
      while (cur && cur.reportsTo && !out.includes(cur.reportsTo)) { out.push(cur.reportsTo); cur = R.userById(S, cur.reportsTo); }
      return out;
    },
    // Need-to-know: full identity records (PII, access, holdings, ledger history) are visible only to
    // the person, identity administrators, organisation-wide auditors, and their management chain.
    canViewIdentity(S, viewer, u) {
      if (!viewer || !u) return false;
      if (viewer.id === u.id) return true;
      if (R.hasPerm(S, viewer, 'MANAGE_IDENTITY')) return true;
      if (R.hasPerm(S, viewer, 'VIEW_AUDIT') && ['HQ', 'ALL_READ'].includes(R.scopeOf(S, viewer))) return true;
      return R.isActive(viewer) && R.managerChain(S, u).includes(viewer.id);
    },
    classLevel: a => Math.max(0, CLASSIFICATIONS.indexOf((a && a.classification) || 'Unclassified')),
    delegationState(S, d) {
      if (d.status === 'approved' && d.expiresAt && d.expiresAt < R.dayOf(S)) return 'expired';
      return d.status;
    },
    // Your access on one asset: Owner, an Editor/Viewer grant from the owner, or the default Viewer
    // access that Administrators and Auditors hold on every asset (VIEW_ALL_ASSETS).
    assetAccessFor(S, u, a) {
      if (!R.isActive(u) || !a) return null;
      let acc = null;
      if (a.owner === u.did) acc = { level: 'Owner', basis: 'Owner', perms: ASSET_LEVELS.Owner };
      else {
        const d = S.delegations.find(x => x.assetId === a.id && x.toDID === u.did && R.delegationState(S, x) === 'approved');
        if (d) { const lv = levelOf(d); acc = { level: lv, basis: `Added by the owner${d.expiresAt ? ` · until ${d.expiresAt.slice(0, 10)}` : ''}`, perms: ASSET_LEVELS[lv] }; }
        else if (R.hasPerm(S, u, 'VIEW_ALL_ASSETS')) acc = { level: 'Viewer', basis: `Default for ${(R.roleOf(S, u) || {}).name || u.role}s`, perms: ASSET_LEVELS.Viewer };
      }
      // A retired asset stays on record: view only.
      if (acc && a.status === 'retired') acc = { ...acc, basis: `${acc.basis} (retired)`, perms: ['VIEW'] };
      return acc;
    },
    accessLevel: (S, u, a) => (R.assetAccessFor(S, u, a) || {}).level || null,
    assetPerm: (S, u, a, p) => ((R.assetAccessFor(S, u, a) || {}).perms || []).includes(p),
    subtreeIds(S, id) {
      const out = [];
      const walk = pid => S.users.filter(u => u.reportsTo === pid).forEach(c => { if (c.id === id || out.includes(c.id)) return; out.push(c.id); walk(c.id); });
      walk(id);
      return out;
    },
    // Someone must always be able to manage identities and roles (no admin lock-out).
    keepsAdmin(S, users, roles) {
      const T = { ...S, users, roleDefinitions: roles };
      return users.some(u => R.hasPerm(T, u, 'MANAGE_IDENTITY')) && users.some(u => R.hasPerm(T, u, 'MANAGE_ROLE'));
    },

    // Reviews
    latestRev: r => r.revisions[r.revisions.length - 1],
    isOpenReview: r => r.status === 'draft' || r.status === 'published',
    isReviewer: (u, r) => !!u && r.reviewers.some(x => x.did === u.did),
    reviewAssetLike: (S, r) => (r.assetId && S.assets.find(a => a.id === r.assetId)) || { id: null, orgUnit: r.orgUnit, owner: r.authorDid, status: 'pending' },
    // Peer review: approvals count from anyone active in the asset's org unit (except the author)
    // and from anyone the author explicitly added as a reviewer.
    isEligibleApprover: (S, u, r) => R.isActive(u) && u.did !== r.authorDid && (u.orgUnit === R.reviewAssetLike(S, r).orgUnit || R.isReviewer(u, r)),
    canApprove(S, u, r) {
      const rev = R.latestRev(r);
      return r.status === 'published' && !!rev.publishedAt && R.isActive(u) && u.did !== r.authorDid
        && !rev.approvals.some(a => a.did === u.did) && (R.isEligibleApprover(S, u, r) || R.isReviewer(u, r));
    },
    canManageReviewers: (S, u, r) => R.isOpenReview(r) && R.isActive(u) && (u.did === r.authorDid || R.isEligibleApprover(S, u, r)),
    countedApprovals: (S, r) => R.latestRev(r).approvals.filter(a => R.isEligibleApprover(S, R.userByDid(S, a.did), r)),
    requiredPending: r => r.reviewers.filter(x => x.required && !R.latestRev(r).approvals.some(a => a.did === x.did)),
    // The on-chain half of "ready to mint" (blocking comments are checked by the app on top).
    mergeBlockers(S, r) {
      const rev = R.latestRev(r);
      const out = [];
      if (r.status !== 'published') out.push('Review is not open');
      if (!rev.publishedAt) out.push(`Revision ${rev.n} isn't published`);
      const counted = R.countedApprovals(S, r).length;
      if (counted < r.approvalsRequired) out.push(`${counted}/${r.approvalsRequired} approvals`);
      if (R.requiredPending(r).length) out.push('Required reviewers pending');
      const a = r.assetId && S.assets.find(x => x.id === r.assetId);
      if (a && a.pendingTransferId) out.push('Asset has a pending custody transfer');
      return out;
    },
    // The author merges their own update once it has enough approvals (and still holds update access).
    canMerge: (S, u, r) => !!u && u.did === r.authorDid && R.isActive(u) && R.mergeBlockers(S, r).length === 0
      && R.assetPerm(S, u, S.assets.find(a => a.id === r.assetId), 'UPLOAD_ASSET'),
    // Only authorised administrators mint — and not for an asset they hold themselves.
    canMintAsset: (S, u, a) => !!a && R.hasPerm(S, u, 'MINT_ASSET') && !a.tokenId && a.status === 'approved' && a.owner !== u.did,
    nextTokenId: S => S.assets.reduce((m, a) => Math.max(m, a.tokenId || 0), 0) + 1,

    // Transfer policy (shared by the transfer dialog and the contract): only the owner transfers,
    // straight to another active identity.
    transferPreview(S, actor, a, toDid) {
      const errors = [];
      const to = R.userByDid(S, toDid);
      if (!a) errors.push('Asset not found');
      else {
        if (a.status === 'retired') errors.push('This asset has been retired');
        if (!actor || a.owner !== actor.did) errors.push('Only the owner can transfer this asset');
      }
      if (!R.isActive(actor)) errors.push('Your identity is not active');
      if (!to) errors.push('Choose the new owner');
      else {
        if (!R.isActive(to)) errors.push(`${to.name || to.did} is not an active identity`);
        if (actor && to.did === actor.did) errors.push('You already own this asset');
      }
      return { errors, reasons: [], mode: errors.length ? null : 'direct' };
    },
  };

  // ── Contract registry ─────────────────────────────────────────────
  const actorOf = (S, tx) => R.userByDid(S, tx.actor);
  const isOrg = tx => tx.actor === ORG_DID;
  const genesisOnly = (S, tx, ctx) => need(ctx.genesis && isOrg(tx), 'Only allowed in the genesis block, signed by BEL');
  const assetOf = (S, id) => S.assets.find(a => a.id === id);
  const reviewOf = (S, id) => S.reviews.find(r => r.id === id);
  const noEscalation = (S, actor, perms) => {
    const mine = R.effectivePermissions(S, actor);
    const extra = perms.filter(p => !mine.includes(p));
    need(!extra.length, `You can't grant permissions you don't hold: ${extra.join(', ')}`);
  };
  const validPerms = perms => need(Array.isArray(perms) && perms.every(p => ALL_PERMS.includes(p)), 'Unknown permission');
  const clone = o => JSON.parse(JSON.stringify(o));

  const C = {
    'Chain.genesis': {
      type: 'GENESIS',
      authorize(S, tx, ctx) { need(ctx.genesis && isOrg(tx) && !S.orgDidDoc, 'Genesis must be the first transaction, signed by BEL'); },
      apply(S, tx) { S.orgDid = ORG_DID; S.orgDidDoc = tx.args.orgDidDoc; },
    },

    // ── AccessControl ──
    'AccessControl.defineRole': {
      type: 'DEFINE_ROLE',
      authorize(S, tx, ctx) {
        const role = tx.args.role;
        need(role && /^[A-Z][A-Z0-9_]{1,23}$/.test(role.id), 'Role id must be 2–24 capital letters, digits or _');
        need(!S.roleDefinitions.some(r => r.id === role.id), `Role ${role.id} already exists`);
        validPerms(role.permissions);
        need(SCOPES[role.scope], 'Unknown scope');
        if (ctx.genesis && isOrg(tx)) return;
        const actor = actorOf(S, tx);
        need(R.hasPerm(S, actor, 'MANAGE_ROLE'), 'Requires Role Management (MANAGE_ROLE)');
        noEscalation(S, actor, role.permissions);
      },
      apply(S, tx) { const r = tx.args.role; S.roleDefinitions.push({ id: r.id, name: r.name, permissions: r.permissions.slice(), scope: r.scope }); },
    },
    'AccessControl.updateRole': {
      type: 'UPDATE_ROLE',
      authorize(S, tx) {
        const actor = actorOf(S, tx);
        const { id, permissions, scope, name } = tx.args;
        const role = S.roleDefinitions.find(r => r.id === id);
        need(role, 'Unknown role');
        need(R.hasPerm(S, actor, 'MANAGE_ROLE'), 'Requires Role Management (MANAGE_ROLE)');
        if (permissions) { validPerms(permissions); noEscalation(S, actor, permissions.filter(p => !role.permissions.includes(p))); }
        if (scope) need(SCOPES[scope], 'Unknown scope');
        need(!name || String(name).trim(), 'Role name is required');
        const roles = S.roleDefinitions.map(r => (r.id === id ? { ...r, permissions: permissions || r.permissions, scope: scope || r.scope } : r));
        need(R.keepsAdmin(S, S.users, roles), 'At least one active identity must keep Role Management and Identity Management');
      },
      apply(S, tx) {
        const role = S.roleDefinitions.find(r => r.id === tx.args.id);
        if (tx.args.name) role.name = tx.args.name;
        if (tx.args.permissions) role.permissions = tx.args.permissions.slice();
        if (tx.args.scope) role.scope = tx.args.scope;
      },
    },
    // One transaction for the Employee Profile's Access Control pane; each changed field is authorized.
    'AccessControl.updateAccess': {
      type: 'UPDATE_IDENTITY',
      authorize(S, tx) {
        const actor = actorOf(S, tx);
        const { userId, role, status, permOverrides } = tx.args;
        const u = R.userById(S, userId);
        need(u, 'Identity not found');
        need(u.status !== 'deactivated', 'This identity has been deactivated');
        need(R.hasPerm(S, actor, 'MANAGE_IDENTITY'), 'Requires Identity Management (MANAGE_IDENTITY)');
        const self = actor.id === u.id;
        if (role !== undefined && role !== u.role) {
          need(!self, "You can't change your own role");
          need(R.hasPerm(S, actor, 'MANAGE_ROLE'), 'Changing roles requires MANAGE_ROLE');
          need(S.roleDefinitions.some(r => r.id === role), 'Unknown role');
        }
        if (status !== undefined && status !== u.status) {
          need(!self, "You can't change your own status");
          need(['active', 'pending', 'suspended'].includes(status), 'Unknown status');
          need(!(status === 'active' && u.status === 'pending' && u.registeredBy === tx.actor), 'Maker-checker: the administrator who registered this identity cannot also activate it');
        }
        if (permOverrides !== undefined) {
          need(!self, "You can't change your own permissions");
          if (permOverrides) { validPerms(permOverrides); noEscalation(S, actor, permOverrides.filter(p => !R.effectivePermissions(S, u).includes(p))); }
        }
        const next = S.users.map(x => (x.id === u.id ? { ...x, role: role ?? x.role, status: status ?? x.status, permOverrides: permOverrides === undefined ? x.permOverrides : permOverrides } : x));
        need(R.keepsAdmin(S, next, S.roleDefinitions), 'At least one active identity must keep Role Management and Identity Management');
      },
      apply(S, tx) {
        const u = R.userById(S, tx.args.userId);
        ['role', 'status'].forEach(k => { if (tx.args[k] !== undefined) u[k] = tx.args[k]; });
        if (tx.args.permOverrides !== undefined) u.permOverrides = tx.args.permOverrides ? tx.args.permOverrides.slice() : null;
      },
    },

    // ── Identity (DID registry) ──
    'Identity.register': {
      type: 'ONBOARD',
      authorize(S, tx, ctx) {
        const u = tx.args.user;
        need(u && /^did:bel:[a-z0-9]+$/.test(u.did), 'Invalid DID');
        need(!R.userByDid(S, u.did) && !R.userById(S, u.id), 'DID already registered');
        const vm = (tx.args.didDoc && tx.args.didDoc.verificationMethod || [])[0];
        need(vm && vm.publicKeyJwk && vm.publicKeyJwk.x && tx.args.didDoc.id === u.did, 'DID Document with a public key is required');
        need(S.roleDefinitions.some(r => r.id === u.role), 'Unknown role');
        if (ctx.genesis && isOrg(tx)) return;
        need(R.hasPerm(S, actorOf(S, tx), 'MANAGE_IDENTITY'), 'Requires Identity Management (MANAGE_IDENTITY)');
        need(u.status === 'pending', 'New identities start as pending');
        need(!u.reportsTo || R.userById(S, u.reportsTo), 'Unknown manager');
      },
      apply(S, tx) {
        const u = tx.args.user;
        S.users.push({ id: u.id, did: u.did, name: u.name, designation: u.designation, role: u.role, orgUnit: u.orgUnit,
          reportsTo: u.reportsTo || null, status: u.status, joined: u.joined, registeredBy: tx.actor,
          permOverrides: u.permOverrides || null, piiCommitment: u.piiCommitment || null, didDoc: tx.args.didDoc });
      },
    },
    'Identity.setStatus': {
      type: 'STATUS',
      authorize(S, tx) {
        const actor = actorOf(S, tx);
        const u = R.userById(S, tx.args.userId);
        need(u, 'Identity not found');
        need(R.hasPerm(S, actor, 'MANAGE_IDENTITY'), 'Requires MANAGE_IDENTITY');
        need(actor.id !== u.id, "You can't change your own status");
        need(u.status !== 'deactivated', 'This identity has been deactivated — deactivation is permanent');
        need(['active', 'suspended', 'pending'].includes(tx.args.status), 'Unknown status');
        need(!(tx.args.status === 'active' && u.status === 'pending' && u.registeredBy === tx.actor), 'Maker-checker: the administrator who registered this identity cannot also activate it');
        const next = S.users.map(x => (x.id === u.id ? { ...x, status: tx.args.status } : x));
        need(R.keepsAdmin(S, next, S.roleDefinitions), 'At least one active identity must keep Role Management and Identity Management');
      },
      apply(S, tx) { R.userById(S, tx.args.userId).status = tx.args.status; },
    },
    'Identity.updateProfile': {
      type: 'UPDATE_IDENTITY',
      authorize(S, tx) {
        const actor = actorOf(S, tx);
        const u = R.userById(S, tx.args.userId);
        need(u, 'Identity not found');
        need(R.hasPerm(S, actor, 'MANAGE_IDENTITY'), 'Requires MANAGE_IDENTITY');
        need(String(tx.args.name || '').trim(), 'Name is required');
        const to = tx.args.reportsTo;
        if (to && to !== u.reportsTo) {
          need(R.userById(S, to), 'Unknown manager');
          need(to !== u.id && !R.subtreeIds(S, u.id).includes(to), "Can't report to someone in their own reporting line");
        }
      },
      apply(S, tx) {
        const u = R.userById(S, tx.args.userId);
        if (tx.args.orgUnit !== undefined && tx.args.orgUnit !== u.orgUnit) { u.movedFrom = u.orgUnit; u.movedAt = tx.ts; }
        ['name', 'designation', 'orgUnit', 'reportsTo'].forEach(k => { if (tx.args[k] !== undefined) u[k] = tx.args[k]; });
      },
    },
    // Leaver: permanent. The DID can never sign in or sign again; its open work is closed out and
    // everything it holds is left for an administrator to recover.
    'Identity.deactivate': {
      type: 'DEACTIVATE_IDENTITY',
      authorize(S, tx) {
        const actor = actorOf(S, tx);
        const u = R.userById(S, tx.args.userId);
        need(u, 'Identity not found');
        need(R.hasPerm(S, actor, 'MANAGE_IDENTITY'), 'Requires MANAGE_IDENTITY');
        need(actor.id !== u.id, "You can't deactivate your own identity");
        need(u.status !== 'deactivated', 'Already deactivated');
        need(String(tx.args.reason || '').trim(), 'A reason is required');
        const next = S.users.map(x => (x.id === u.id ? { ...x, status: 'deactivated' } : x));
        need(R.keepsAdmin(S, next, S.roleDefinitions), 'At least one active identity must keep Role Management and Identity Management');
      },
      apply(S, tx) {
        const u = R.userById(S, tx.args.userId);
        u.status = 'deactivated';
        u.deactivatedAt = tx.ts;
        if (u.didDoc) u.didDoc = { ...u.didDoc, deactivated: true };
        S.reviews.filter(r => r.authorDid === u.did && R.isOpenReview(r)).forEach(r => {
          r.status = 'canceled';
          const a = r.kind === 'initial' && assetOf(S, r.assetId);
          if (a && a.status === 'pending') a.status = 'rejected';
        });
        S.delegations.filter(d => (d.toDID === u.did || (d.fromDID === u.did && d.status === 'pending')) && ['pending', 'approved'].includes(d.status)).forEach(d => { d.status = 'revoked'; });
        (S.transfers || []).filter(t => t.status === 'pending' && (t.fromDid === u.did || t.toDid === u.did)).forEach(t => {
          t.status = 'canceled'; t.decidedBy = tx.actor; t.decidedAt = tx.ts;
          const a = assetOf(S, t.assetId); if (a) a.pendingTransferId = null;
        });
      },
    },
    // Credential reset: a new verification key replaces the old one (which stays in the DID Document,
    // marked revoked, so past signatures still verify). The holder gets a new temporary password.
    'Identity.rotateKey': {
      type: 'ROTATE_KEY',
      authorize(S, tx) {
        const actor = actorOf(S, tx);
        const u = R.userById(S, tx.args.userId);
        need(u && u.didDoc, 'Identity not found');
        need(R.hasPerm(S, actor, 'MANAGE_IDENTITY'), 'Requires MANAGE_IDENTITY');
        need(actor.id !== u.id, 'Ask another administrator to reset your credentials');
        need(u.status !== 'deactivated', 'This identity has been deactivated');
        const k = tx.args.newKey;
        need(k && k.publicJwk && k.publicJwk.x && k.kid && k.kid.startsWith(`${u.did}#key-`), 'A new public key is required');
        need(!(u.didDoc.verificationMethod || []).some(m => m.id === k.kid), 'Key id already used');
      },
      apply(S, tx) {
        const u = R.userById(S, tx.args.userId);
        const k = tx.args.newKey;
        const doc = JSON.parse(JSON.stringify(u.didDoc));
        doc.verificationMethod.forEach(m => { if (!m.revoked) m.revoked = tx.ts; });
        doc.verificationMethod.push({ id: k.kid, type: 'JsonWebKey2020', controller: u.did, publicKeyJwk: { kty: k.publicJwk.kty, crv: k.publicJwk.crv, x: k.publicJwk.x, y: k.publicJwk.y } });
        doc.authentication = [k.kid];
        doc.assertionMethod = [k.kid];
        doc.updated = tx.ts;
        u.didDoc = doc;
      },
    },

    // ── Authentication proof (the challenge signature is verified separately; see replay) ──
    'Auth.login': {
      type: 'AUTHENTICATE',
      authorize(S, tx) {
        const u = actorOf(S, tx);
        need(u, 'Unknown DID');
        need(R.isActive(u), `This identity is ${u.status} and can't sign in`);
        need(tx.args && tx.args.challenge && tx.args.challengeSig, 'Missing DID proof');
        const ch = JSON.parse(tx.args.challenge);
        need(ch.did === u.did, 'Challenge was issued to a different DID');
      },
      apply() {},
    },

    // ── Generic activity record (downloads, comments, …) ──
    'Audit.record': {
      type: 'EVENT',
      authorize(S, tx) { need(isOrg(tx) || actorOf(S, tx), 'Unknown DID'); need(tx.args && tx.args.type, 'Event type required'); },
      apply() {},
    },
    'Asset.download': {
      type: 'DOWNLOAD_ASSET',
      authorize(S, tx) {
        const a = assetOf(S, tx.args.assetId);
        need(R.assetPerm(S, actorOf(S, tx), a, 'DOWNLOAD'), 'Your access on this asset does not include DOWNLOAD');
        need(!(R.classLevel(a) >= 3 && !String(tx.args.justification || '').trim()), 'Downloading a Secret asset requires a recorded justification');
      },
      apply() {},
    },

    // ── Genesis imports of pre-existing records (attested by BEL in block 0) ──
    // Anyone with Asset Creation registers a new asset directly as v1 (its NFT is minted later by an admin).
    'Asset.create': {
      type: 'CREATE_ASSET',
      authorize(S, tx) {
        const actor = actorOf(S, tx);
        const a = tx.args.asset;
        need(R.canUpload(S, actor), 'Requires Asset Creation (UPLOAD_ASSET)');
        need(a && a.id && !assetOf(S, a.id), 'Invalid asset id');
        need(String(a.name || '').trim(), 'Asset name is required');
        need(a.hash, 'A file hash is required');
        need(CLASSIFICATIONS.includes(a.classification || 'Unclassified'), 'Unknown classification');
        need(Number.isInteger(a.approvalsRequired) && a.approvalsRequired >= 0 && a.approvalsRequired <= MAX_APPROVALS, `Required approvals must be 0–${MAX_APPROVALS}`);
        need(a.orgUnit === actor.orgUnit || R.scopeOf(S, actor) === 'HQ', `You can only create assets for ${actor.orgUnit}`);
      },
      apply(S, tx) {
        const a = tx.args.asset;
        S.assets.push({ id: a.id, name: a.name, owner: tx.actor, orgUnit: a.orgUnit, hash: a.hash, size: a.size, status: 'approved', version: 1,
          tokenId: null, pendingTransferId: null, classification: a.classification || 'Unclassified', approvalsRequired: a.approvalsRequired });
      },
    },
    // Per-asset review setting: how many peer approvals an update needs (0–3).
    'Asset.configure': {
      type: 'CONFIGURE_ASSET',
      authorize(S, tx) {
        const actor = actorOf(S, tx);
        const a = assetOf(S, tx.args.assetId);
        need(a && a.status !== 'retired', 'Asset not found');
        need(a.owner === tx.actor, 'Only the owner can change this asset’s settings');
        const n = tx.args.approvalsRequired;
        need(Number.isInteger(n) && n >= 0 && n <= MAX_APPROVALS, `Required approvals must be 0–${MAX_APPROVALS}`);
      },
      apply(S, tx) { assetOf(S, tx.args.assetId).approvalsRequired = tx.args.approvalsRequired; },
    },
    'Asset.import': {
      type: 'IMPORT_ASSET', authorize: genesisOnly,
      apply(S, tx) { const a = tx.args.asset; S.assets.push({ id: a.id, name: a.name, owner: a.owner, orgUnit: a.orgUnit, hash: a.hash, size: a.size, status: a.status, version: a.version || 1, tokenId: null, pendingTransferId: null, classification: a.classification || 'Unclassified', approvalsRequired: a.approvalsRequired == null ? 1 : a.approvalsRequired }); },
    },
    'Review.import': {
      type: 'IMPORT_REVIEW', authorize: genesisOnly,
      apply(S, tx) { S.reviews.push(clone(tx.args.review)); },
    },
    'Delegation.import': {
      type: 'IMPORT_DELEGATION', authorize: genesisOnly,
      apply(S, tx) { const d = clone(tx.args.delegation); d.access = levelOf(d); d.permissions = ASSET_LEVELS[d.access].slice(); S.delegations.push(d); },
    },
    'Audit.import': { type: 'IMPORT_EVENT', authorize: genesisOnly, apply() {} },
    'AssetNFT.legacyMint': {
      type: 'MINT_NFT', authorize: genesisOnly,
      apply(S, tx) {
        const a = assetOf(S, tx.args.assetId);
        Object.assign(a, { tokenId: tx.args.tokenId, issuer: ORG_DID, mintedAt: tx.args.mintedAt, mintedBy: tx.args.mintedBy });
      },
    },

    // ── Reviews (prepared → checked/approved) ──
    'Review.create': {
      type: 'CREATE_REVIEW',
      authorize(S, tx) {
        const actor = actorOf(S, tx);
        const { review } = tx.args;
        need(review && review.id && !reviewOf(S, review.id), 'Invalid review id');
        need(review.revision && review.revision.hash, 'A file hash is required');
        const a = assetOf(S, review.assetId);
        need(a, 'Asset not found');
        // The Owner, or anyone the Owner made an Editor of this asset.
        need(R.assetPerm(S, actor, a, 'UPLOAD_ASSET'), "You don't have update access on this asset");
        need(a.status !== 'retired', 'This asset has been retired');
        need(CLASSIFICATIONS.includes(review.classification || a.classification || 'Unclassified'), 'Unknown classification');
        const n = review.approvalsRequired;
        need(n == null || (Number.isInteger(n) && n >= 0 && n <= MAX_APPROVALS), `Required approvals must be 0–${MAX_APPROVALS}`);
      },
      apply(S, tx) {
        const v = tx.args.review;
        const a = assetOf(S, v.assetId);
        // The review takes the asset's approval setting unless its author (Owner or Editor) overrides it (0–3).
        S.reviews.push({ id: v.id, kind: 'update', assetId: a.id, authorDid: tx.actor, orgUnit: a.orgUnit, status: 'draft',
          classification: v.classification || a.classification || 'Unclassified',
          approvalsRequired: v.approvalsRequired != null ? v.approvalsRequired : a.approvalsRequired == null ? 1 : a.approvalsRequired, reviewers: [],
          revisions: [{ n: 1, hash: v.revision.hash, size: v.revision.size, publishedAt: null, approvals: [] }] });
      },
    },
    'Review.addRevision': {
      type: 'UPDATE_REVIEW',
      authorize(S, tx) {
        const r = reviewOf(S, tx.args.reviewId);
        need(r && r.authorDid === tx.actor && R.isOpenReview(r), 'Only the author can upload to an open review');
        need(R.assetPerm(S, actorOf(S, tx), assetOf(S, r.assetId), 'UPLOAD_ASSET'), "You no longer have update access on this asset");
        need(tx.args.hash, 'A file hash is required');
      },
      apply(S, tx) {
        const r = reviewOf(S, tx.args.reviewId);
        const rev = R.latestRev(r);
        if (!rev.publishedAt) Object.assign(rev, { hash: tx.args.hash, size: tx.args.size });
        else r.revisions.push({ n: rev.n + 1, hash: tx.args.hash, size: tx.args.size, publishedAt: null, approvals: [] });
      },
    },
    'Review.publish': {
      type: 'PUBLISH_REVIEW',
      authorize(S, tx) {
        const r = reviewOf(S, tx.args.reviewId);
        need(r && r.authorDid === tx.actor && R.isOpenReview(r), 'Only the author can publish');
        need(!R.latestRev(r).publishedAt, 'Latest revision is already published');
      },
      apply(S, tx) {
        const r = reviewOf(S, tx.args.reviewId);
        const rev = R.latestRev(r);
        rev.publishedAt = tx.ts;
        r.status = 'published';
      },
    },
    'Review.approve': {
      type: 'APPROVE_REVIEW',
      authorize(S, tx) { const r = reviewOf(S, tx.args.reviewId); need(r && R.canApprove(S, actorOf(S, tx), r), 'You cannot approve this revision'); },
      apply(S, tx) { R.latestRev(reviewOf(S, tx.args.reviewId)).approvals.push({ did: tx.actor, ts: tx.ts }); },
    },
    'Review.setReviewers': {
      type: 'REVIEWERS',
      authorize(S, tx) {
        const r = reviewOf(S, tx.args.reviewId);
        need(r && R.canManageReviewers(S, actorOf(S, tx), r), 'You cannot change reviewers on this review');
        need(Array.isArray(tx.args.reviewers) && tx.args.reviewers.every(x => R.userByDid(S, x.did) && x.did !== r.authorDid), 'Invalid reviewer');
      },
      apply(S, tx) { reviewOf(S, tx.args.reviewId).reviewers = tx.args.reviewers.map(x => ({ did: x.did, required: !!x.required })); },
    },
    'Review.cancel': {
      type: 'CANCEL_REVIEW',
      authorize(S, tx) { const r = reviewOf(S, tx.args.reviewId); need(r && r.authorDid === tx.actor && r.status === 'published', 'Only the author can cancel a published review'); },
      apply(S, tx) {
        const r = reviewOf(S, tx.args.reviewId);
        r.status = 'canceled';
      },
    },
    'Review.reopen': {
      type: 'REOPEN_REVIEW',
      authorize(S, tx) { const r = reviewOf(S, tx.args.reviewId); need(r && r.authorDid === tx.actor && r.status === 'canceled', 'Only the author can reopen a canceled review'); },
      apply(S, tx) {
        const r = reviewOf(S, tx.args.reviewId);
        r.status = r.revisions.some(v => v.publishedAt) ? 'published' : 'draft';
      },
    },
    'Review.discard': {
      type: 'DISCARD_REVIEW',
      authorize(S, tx) {
        const r = reviewOf(S, tx.args.reviewId);
        need(r && r.authorDid === tx.actor && R.isOpenReview(r) && !R.latestRev(r).publishedAt, 'Only an unpublished draft can be discarded');
      },
      apply(S, tx) {
        const r = reviewOf(S, tx.args.reviewId);
        if (!r.revisions.some(v => v.publishedAt)) S.reviews.splice(S.reviews.indexOf(r), 1);
        else r.revisions.pop();
      },
    },

    // ── Merge: the author lands an approved update on the asset (new version) ──
    'Review.merge': {
      type: 'MERGE_REVIEW',
      authorize(S, tx) {
        const r = reviewOf(S, tx.args.reviewId);
        need(r && r.kind === 'update', 'Review not found');
        need(tx.actor === r.authorDid, 'Only the author merges their review');
        const blockers = R.mergeBlockers(S, r);
        need(!blockers.length, `Not ready to merge: ${blockers.join('; ')}`);
        const a = assetOf(S, r.assetId);
        need(R.assetPerm(S, actorOf(S, tx), a, 'UPLOAD_ASSET'), "You no longer have update access on this asset");
        need(tx.args.contentHash === R.latestRev(r).hash, 'Content hash does not match the approved revision');
        need(tx.args.version === (a.version || 1) + 1, 'Version must increase by one');
      },
      apply(S, tx) {
        const r = reviewOf(S, tx.args.reviewId);
        const a = assetOf(S, r.assetId);
        const rev = R.latestRev(r);
        Object.assign(a, { hash: rev.hash, size: rev.size, version: tx.args.version });
        if (r.classification && r.classification !== a.classification) a.classification = r.classification; // reclassified through review
        r.status = 'merged';
      },
    },

    // ── NFT issuance: only authorised administrators mint, and assign the token to the custodian ──
    'AssetNFT.mint': {
      type: 'MINT_NFT',
      authorize(S, tx) {
        const actor = actorOf(S, tx);
        const a = assetOf(S, tx.args.assetId);
        need(a, 'Asset not found');
        need(R.hasPerm(S, actor, 'MINT_ASSET'), 'Only authorised administrators (MINT_ASSET) can mint NFTs');
        need(!a.tokenId, 'Asset is already minted');
        need(a.status === 'approved', 'Only active assets can be minted');
        need(a.owner !== tx.actor, "You can't mint an NFT for an asset you hold yourself (separation of duties)");
        need(tx.args.contentHash === a.hash, 'Content hash does not match the current version');
        need(tx.args.tokenId === R.nextTokenId(S), 'Token id must be the next in sequence');
      },
      apply(S, tx) { Object.assign(assetOf(S, tx.args.assetId), { tokenId: tx.args.tokenId, issuer: ORG_DID, mintedAt: tx.ts, mintedBy: tx.actor }); },
    },

    // End of life: the token and its history stay on the ledger    // End of life: the token and its history stay on the ledger; the asset can no longer be
    // downloaded, updated, shared or transferred.
    'AssetNFT.retire': {
      type: 'RETIRE_NFT',
      authorize(S, tx) {
        const a = assetOf(S, tx.args.assetId);
        need(a, 'Asset not found');
        need(a.status !== 'retired', 'Already retired');
        need(R.hasPerm(S, actorOf(S, tx), 'MINT_ASSET'), 'Only authorised administrators (MINT_ASSET) can retire assets');
        need(!a.pendingTransferId, 'Resolve the pending custody transfer first');
        need(!S.reviews.some(r => r.assetId === a.id && R.isOpenReview(r)), 'Close the open review on this asset first');
        need(String(tx.args.reason || '').trim(), 'A reason is required');
      },
      apply(S, tx) { Object.assign(assetOf(S, tx.args.assetId), { status: 'retired', retiredAt: tx.ts, retiredBy: tx.actor }); },
    },

    // ── Custody (NFT ownership) ──
    'Custody.transfer': {
      type: 'TRANSFER_OWNERSHIP',
      authorize(S, tx) {
        need(tx.args.transferId && !S.transfers.some(t => t.id === tx.args.transferId), 'Invalid transfer id');
        const p = R.transferPreview(S, actorOf(S, tx), assetOf(S, tx.args.assetId), tx.args.toDid);
        need(!p.errors.length, p.errors.join('; '));
      },
      apply(S, tx) {
        const a = assetOf(S, tx.args.assetId);
        S.transfers.push({ id: tx.args.transferId, assetId: a.id, tokenId: a.tokenId, fromDid: a.owner, toDid: tx.args.toDid, mode: 'direct', status: 'completed',
          reason: tx.args.reason || null, requestedAt: tx.ts, decidedBy: tx.actor, decidedAt: tx.ts });
        // The new owner no longer needs a separate Editor/Viewer grant.
        S.delegations.filter(d => d.assetId === a.id && d.toDID === tx.args.toDid && d.status === 'approved').forEach(d => { d.status = 'revoked'; });
        a.owner = tx.args.toDid;
      },
    },
    // Admin override: move ownership away from an owner who can no longer act (suspended / deactivated).
    'Custody.forceReassign': {
      type: 'OVERRIDE_TRANSFER',
      authorize(S, tx) {
        const actor = actorOf(S, tx);
        const a = assetOf(S, tx.args.assetId);
        need(a, 'Asset not found');
        need(a.status !== 'retired', 'This NFT has been retired');
        need(R.hasPerm(S, actor, 'APPROVE_TRANSFER'), 'Requires Ownership Override (APPROVE_TRANSFER)');
        need(!R.isActive(R.userByDid(S, a.owner)), 'Admins can only override an owner who is suspended or deactivated — otherwise the owner transfers it');
        const to = R.userByDid(S, tx.args.toDid);
        need(to && R.isActive(to) && to.did !== a.owner, 'Recipient must be a different, active identity');
        need(String(tx.args.reason || '').trim(), 'A reason is required');
        need(tx.args.transferId && !S.transfers.some(t => t.id === tx.args.transferId), 'Invalid transfer id');
      },
      apply(S, tx) {
        const a = assetOf(S, tx.args.assetId);
        if (a.pendingTransferId) { const p = S.transfers.find(t => t.id === a.pendingTransferId); if (p) Object.assign(p, { status: 'canceled', decidedBy: tx.actor, decidedAt: tx.ts }); }
        S.transfers.push({ id: tx.args.transferId, assetId: a.id, tokenId: a.tokenId, fromDid: a.owner, toDid: tx.args.toDid, mode: 'forced', status: 'completed',
          reason: tx.args.reason, requestedAt: tx.ts, decidedBy: tx.actor, decidedAt: tx.ts });
        a.owner = tx.args.toDid; a.pendingTransferId = null;
      },
    },

    // ── Sharing: the owner adds Editors and Viewers ──
    'Delegation.grant': {
      type: 'GRANT_ACCESS',
      authorize(S, tx) {
        const d = tx.args.delegation;
        const a = assetOf(S, d.assetId);
        need(a && a.status !== 'retired', 'Asset not found');
        need(R.assetPerm(S, actorOf(S, tx), a, 'SHARE'), 'Only the owner can add Editors and Viewers');
        need(d.toDID !== tx.actor, 'You already own this asset');
        need(R.isActive(R.userByDid(S, d.toDID)), 'That person is not an active identity');
        need(GRANTABLE_LEVELS.includes(d.access), 'Access must be Editor or Viewer');
        if (d.expiresAt) {
          need(d.expiresAt >= R.dayOf(S), 'The end date must be today or later');
          need(d.expiresAt <= localDate(new Date(new Date(tx.ts).getTime() + MAX_GRANT_DAYS * 86400000).toISOString()), `Access can last at most ${MAX_GRANT_DAYS} days`);
        }
        need(d.id && !S.delegations.some(x => x.id === d.id), 'Invalid id');
      },
      apply(S, tx) {
        const d = tx.args.delegation;
        // One grant per person per asset: a new grant replaces the old one.
        S.delegations.filter(x => x.assetId === d.assetId && x.toDID === d.toDID && x.status === 'approved').forEach(x => { x.status = 'revoked'; });
        S.delegations.push({ id: d.id, assetId: d.assetId, fromDID: tx.actor, toDID: d.toDID, access: d.access, permissions: ASSET_LEVELS[d.access].slice(), status: 'approved', expiresAt: d.expiresAt || null });
      },
    },
    'Delegation.revoke': {
      type: 'REVOKE_ACCESS',
      authorize(S, tx) {
        const d = S.delegations.find(x => x.id === tx.args.delegationId);
        need(d && d.status === 'approved', 'Nothing to remove');
        need(R.assetPerm(S, actorOf(S, tx), assetOf(S, d.assetId), 'SHARE'), 'Only the owner can remove access');
      },
      apply(S, tx) { S.delegations.find(x => x.id === tx.args.delegationId).status = 'revoked'; },
    },
  };

  // ── Execution ─────────────────────────────────────────────────────
  function emptyState() { return { users: [], roleDefinitions: [], assets: [], reviews: [], delegations: [], transfers: [], orgDid: null, orgDidDoc: null, __nonces: {} }; }

  // Authorize + apply one transaction on S. Throws ContractError (S untouched) if not allowed.
  function run(S, tx, ctx) {
    const c = C[`${tx.contract}.${tx.method}`];
    if (!c) fail(`Unknown contract method ${tx.contract}.${tx.method}`);
    S.__today = localDate(tx.ts);
    const signer = S.users.find(u => u.did === tx.actor);
    if (!(ctx && ctx.genesis) && signer && signer.status === 'deactivated') fail('This DID has been deactivated and can no longer act');
    try { c.authorize(S, tx, ctx || {}); c.apply(S, tx, ctx || {}); }
    finally { delete S.__today; }
  }

  // Builds the tx body for (method, args) by `actor`, authorizes and applies it to S.
  function exec(S, method, args, meta) {
    const [contract, fn] = method.split('.');
    const c = C[method];
    if (!c) fail(`Unknown contract method ${method}`);
    S.__nonces = S.__nonces || {};
    const nonce = (S.__nonces[meta.actor] || 0) + 1;
    const key = R.currentKey(S, meta.actor);
    const body = { v: 1, chainId: CHAIN_ID, contract, method: fn, type: meta.type || c.type, actor: meta.actor, kid: key ? key.id : `${meta.actor}#key-1`,
      nonce, ts: meta.ts, args: args || {}, detail: meta.detail || '' };
    run(S, JSON.parse(JSON.stringify(body)), meta.ctx);
    S.__nonces[meta.actor] = nonce;
    return body;
  }

  // The on-chain projection of a state — what state roots hash and Verify compares.
  const sortBy = (arr, k) => arr.slice().sort((a, b) => String(a[k]).localeCompare(String(b[k])));
  function project(S) {
    const keyOf = u => { const vm = R.currentKey(S, u.did); return vm ? `${vm.id}:${vm.publicKeyJwk.x}.${vm.publicKeyJwk.y}` : null; };
    return {
      identities: sortBy(S.users, 'id').map(u => ({ id: u.id, did: u.did, role: u.role, status: u.status, orgUnit: u.orgUnit, reportsTo: u.reportsTo || null,
        permOverrides: u.permOverrides ? u.permOverrides.slice().sort() : null, key: keyOf(u) })),
      roles: sortBy(S.roleDefinitions, 'id').map(r => ({ id: r.id, permissions: r.permissions.slice().sort(), scope: r.scope || LEGACY_SCOPE[r.id] || 'SELF' })),
      assets: sortBy(S.assets, 'id').map(a => ({ id: a.id, owner: a.owner, orgUnit: a.orgUnit, hash: a.hash, version: a.version || 1, status: a.status,
        tokenId: a.tokenId || null, pendingTransferId: a.pendingTransferId || null, classification: a.classification || 'Unclassified', approvalsRequired: a.approvalsRequired == null ? 1 : a.approvalsRequired })),
      reviews: sortBy(S.reviews, 'id').map(r => ({ id: r.id, kind: r.kind, assetId: r.assetId || null, authorDid: r.authorDid, status: r.status, classification: r.classification || 'Unclassified',
        approvalsRequired: r.approvalsRequired, reviewers: sortBy(r.reviewers, 'did').map(x => ({ did: x.did, required: !!x.required })),
        revisions: r.revisions.map(v => ({ n: v.n, hash: v.hash, published: !!v.publishedAt, approvals: v.approvals.map(a => a.did).sort() })) })),
      delegations: sortBy(S.delegations, 'id').map(d => ({ id: d.id, assetId: d.assetId, fromDID: d.fromDID, toDID: d.toDID,
        access: levelOf(d), status: d.status, expiresAt: d.expiresAt ? d.expiresAt.slice(0, 10) : null })),
      transfers: sortBy(S.transfers || [], 'id').map(t => ({ id: t.id, assetId: t.assetId, fromDid: t.fromDid, toDid: t.toDid, mode: t.mode, status: t.status })),
    };
  }
  function snapshot(S) {
    const p = project(S);
    const out = {};
    Object.keys(p).forEach(k => { out[k] = window.BELLedger.canonical(p[k]); });
    return out;
  }
  // Entity-level differences between two projections.
  function diff(a, b) {
    const out = [];
    Object.keys(a).forEach(section => {
      const ka = new Map(a[section].map(x => [x.id, x])), kb = new Map(b[section].map(x => [x.id, x]));
      const canon = window.BELLedger.canonical;
      ka.forEach((x, id) => {
        if (!kb.has(id)) out.push({ section, id, msg: `${id} is on the ledger but missing from the database` });
        else if (canon(x) !== canon(kb.get(id))) {
          const y = kb.get(id);
          const fields = Object.keys(x).filter(f => canon(x[f]) !== canon(y[f]));
          out.push({ section, id, msg: `${id}: database differs from ledger in ${fields.join(', ')}` });
        }
      });
      kb.forEach((x, id) => { if (!ka.has(id)) out.push({ section, id, msg: `${id} exists in the database with no ledger record` }); });
    });
    return out;
  }

  function keyMethodFor(S, tx) {
    if (tx.contract === 'Chain' && tx.method === 'genesis') return null;
    const doc = tx.actor === ORG_DID ? S.orgDidDoc : (R.userByDid(S, tx.actor) || {}).didDoc;
    return (doc && (doc.verificationMethod || []).find(m => m.id === tx.kid)) || null;
  }
  function keyFor(S, tx) {
    if (tx.contract === 'Chain' && tx.method === 'genesis') return tx.args.orgDidDoc.verificationMethod[0].publicKeyJwk;
    const doc = tx.actor === ORG_DID ? S.orgDidDoc : (R.userByDid(S, tx.actor) || {}).didDoc;
    const vm = doc && (doc.verificationMethod || []).find(m => m.id === tx.kid);
    return vm ? vm.publicKeyJwk : null;
  }

  // Replays the whole chain from an empty state: checks every signature (and DID login
  // proof), per-signer nonces, every contract rule, and every block's state roots.
  async function replay(blocks, L) {
    const S = emptyState();
    const issues = [];
    let sigs = 0;
    for (const b of blocks) {
      const genesis = b.height === 0;
      for (const tx of b.txs) {
        const vm = keyMethodFor(S, tx);
        const jwk = vm ? vm.publicKeyJwk : keyFor(S, tx);
        const ok = await L.Chain.verifyTxSig(tx, jwk);
        sigs++;
        if (!ok) issues.push({ height: b.height, check: 'signature', msg: `Signature by ${tx.actor} does not verify` });
        if (vm && vm.revoked && tx.ts > vm.revoked) issues.push({ height: b.height, check: 'signature', msg: `${tx.kid} was revoked on ${vm.revoked.slice(0, 10)} but signed a later transaction` });
        if (tx.contract === 'Auth' && tx.method === 'login' && jwk) {
          const proof = await L.Keys.verify(jwk, tx.args.challenge || '', tx.args.challengeSig || '');
          if (!proof) issues.push({ height: b.height, check: 'signature', msg: `DID login proof by ${tx.actor} does not verify` });
        }
        const last = S.__nonces[tx.actor] || 0;
        if (tx.nonce !== last + 1) issues.push({ height: b.height, check: 'authorization', msg: `Nonce ${tx.nonce} from ${tx.actor} is out of sequence (replay?)` });
        S.__nonces[tx.actor] = Math.max(last, tx.nonce || 0);
        try { run(S, JSON.parse(JSON.stringify(tx)), { genesis }); }
        catch (e) { issues.push({ height: b.height, check: 'authorization', msg: `${tx.contract}.${tx.method} by ${tx.actor} breaks contract rules: ${e.message}` }); }
      }
      const roots = await L.hashRoots(snapshot(S));
      Object.keys(b.stateRoots || {}).forEach(k => {
        if (roots[k] !== b.stateRoots[k]) issues.push({ height: b.height, check: 'state', msg: `State root "${k}" after this block doesn't match the replayed state` });
      });
    }
    return { state: S, issues, sigs };
  }

const BELContracts = { CHAIN_ID, ORG_DID, ContractError, rules: R, registry: C, SCOPES, ALL_PERMS, ASSET_PERMS, ASSET_LEVELS, GRANTABLE_LEVELS, CLASSIFICATIONS, MAX_GRANT_DAYS, MAX_APPROVALS, emptyState, exec, run, project, snapshot, diff, replay, localDate };
if (typeof window !== 'undefined') window.BELContracts = BELContracts;

export { CHAIN_ID, ORG_DID, ContractError, R as rules, C as registry, SCOPES, ALL_PERMS, ASSET_PERMS, ASSET_LEVELS, GRANTABLE_LEVELS, CLASSIFICATIONS, MAX_GRANT_DAYS, MAX_APPROVALS, emptyState, exec, run, project, snapshot, diff, replay, localDate };
export default BELContracts;
