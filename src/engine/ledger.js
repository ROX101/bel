/* ============================================================
   BELLedger — in-browser blockchain core for the BEL Portal prototype
   ============================================================
   Ported near-verbatim from the original vanilla-JS bel-portal/ledger.js.
   Only the outer wrapper changed: the original wrapped everything in an
   IIFE that assigned `window.BELLedger`; here the same body lives at
   ES-module scope and is both exported (named + default) AND still
   assigned to `window.BELLedger` as a side effect, because the ported
   legacy UI layer (src/legacy/app-legacy.js, itself a near-verbatim port
   of the original app.js) still reads `window.BELLedger` exactly as the
   original index.html's script-tag boot order relied on. None of the
   internal logic below was changed.
   Knows nothing about the app. Provides:
     • canonical JSON + SHA-256 + base64url helpers
     • Keys   — ECDSA P-256 (WebCrypto) generate / import / sign / verify / thumbprint
     • Wallet — the browser's key store (localStorage), merged with the demo wallets
     • Chain  — hash-linked blocks of signed transactions, a serial "seal" queue,
                structural verification, and in-memory tamper / restore for demos
   Block  = { height, prevHash, ts, txRoot, stateRoots, hash, txs:[tx] }
   Tx     = { v, chainId, contract, method, type, actor, kid, nonce, ts, args, detail, sig, hash }
            sig  = ECDSA-P256/SHA-256 over canonical(tx without sig/hash)
            hash = SHA-256 of canonical(tx without hash)
   ============================================================ */

const enc = new TextEncoder();
const ZERO = '0'.repeat(64);

// Deterministic JSON: object keys sorted recursively, undefined dropped.
function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return `[${v.map(x => (x === undefined ? 'null' : canonical(x))).join(',')}]`;
  return `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
}
const toHex = buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
async function sha256Hex(str) { return toHex(await crypto.subtle.digest('SHA-256', enc.encode(str))); }
function b64u(bytes) {
  let s = ''; new Uint8Array(bytes).forEach(b => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64u(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}
const clone = o => JSON.parse(JSON.stringify(o));

// ── Keys ──────────────────────────────────────────────────────────
const ALG = { name: 'ECDSA', namedCurve: 'P-256' };
const SIG = { name: 'ECDSA', hash: 'SHA-256' };
const pubOf = ({ kty, crv, x, y }) => ({ kty, crv, x, y });
const pubCache = new Map();
const Keys = {
  async generate() {
    const kp = await crypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
    const pub = await crypto.subtle.exportKey('jwk', kp.publicKey);
    const priv = await crypto.subtle.exportKey('jwk', kp.privateKey);
    return { publicJwk: pubOf(pub), privateJwk: { ...pubOf(priv), d: priv.d } };
  },
  // Session keys are imported non-extractable: once in memory they can sign but never be read back.
  importPrivate(jwk) { return crypto.subtle.importKey('jwk', { ...pubOf(jwk), d: jwk.d, ext: false }, ALG, false, ['sign']); },
  importPublic(jwk) {
    const id = `${jwk.x}.${jwk.y}`;
    if (!pubCache.has(id)) pubCache.set(id, crypto.subtle.importKey('jwk', pubOf(jwk), ALG, true, ['verify']));
    return pubCache.get(id);
  },
  async sign(key, message) { return b64u(await crypto.subtle.sign(SIG, key, enc.encode(message))); },
  async verify(publicJwk, message, sig) {
    try { return await crypto.subtle.verify(SIG, await Keys.importPublic(publicJwk), unb64u(sig), enc.encode(message)); }
    catch (e) { return false; }
  },
  // RFC 7638-style thumbprint (hex) — the short fingerprint shown in the UI.
  thumbprint(jwk) { return sha256Hex(canonical(pubOf(jwk))); },
};

// ── Keystore: a DID private key encrypted with the account password ──
// PBKDF2-SHA256 derives an AES-256-GCM key from the password; wrong passwords fail the GCM
// authentication tag, so no password (or password hash) is stored anywhere.
const KDF_ITERATIONS = 250000;
async function kekFrom(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const Keystore = {
  async encrypt(privateJwk, password, meta = {}) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const kek = await kekFrom(password, salt, KDF_ITERATIONS);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, enc.encode(canonical(privateJwk)));
    return { version: 1, ...meta, publicJwk: pubOf(privateJwk), kdf: 'PBKDF2-SHA256', iterations: KDF_ITERATIONS, salt: b64u(salt), cipher: 'AES-256-GCM', iv: b64u(iv), ciphertext: b64u(ct) };
  },
  // Returns the private JWK, or throws if the password is wrong.
  async decrypt(ks, password) {
    const kek = await kekFrom(password, unb64u(ks.salt), ks.iterations);
    let pt;
    try { pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(ks.iv) }, kek, unb64u(ks.ciphertext)); }
    catch (e) { throw new Error('Wrong password'); }
    return JSON.parse(new TextDecoder().decode(pt));
  },
};

// ── Wallet ────────────────────────────────────────────────────────
const WALLET_KEY = 'bel.wallet.v1';
const store = {
  get(k) { try { return window.localStorage ? JSON.parse(localStorage.getItem(k) || 'null') : null; } catch (e) { return null; } },
  set(k, v) { try { if (window.localStorage) localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  del(k) { try { if (window.localStorage) localStorage.removeItem(k); } catch (e) { /* ignore */ } },
};
const Wallet = {
  local() { return store.get(WALLET_KEY) || {}; },
  get(did) { return Wallet.local()[did] || (window.BEL_DEMO_WALLETS || {})[did] || null; },
  has(did) { return !!Wallet.get(did); },
  isDemo(did) { return !Wallet.local()[did] && !!(window.BEL_DEMO_WALLETS || {})[did]; },
  put(did, entry) { const all = Wallet.local(); all[did] = entry; store.set(WALLET_KEY, all); },
  remove(did) { const all = Wallet.local(); delete all[did]; store.set(WALLET_KEY, all); },
};

// ── Chain ─────────────────────────────────────────────────────────
const LEDGER_KEY = 'bel.ledger.v1';
const txBodyOf = tx => { const { sig, hash, ...body } = tx; return body; };
const txHashInput = tx => { const { hash, ...rest } = tx; return canonical(rest); };
const headerOf = b => ({ height: b.height, prevHash: b.prevHash, ts: b.ts, txRoot: b.txRoot, stateRoots: b.stateRoots });

async function hashRoots(snap) {
  const out = {};
  for (const k of Object.keys(snap).sort()) out[k] = await sha256Hex(snap[k]);
  return out;
}
async function sealTx(body, key) {
  const tx = { ...body, sig: await Keys.sign(key, canonical(body)) };
  tx.hash = await sha256Hex(txHashInput(tx));
  return tx;
}
async function buildBlock(height, prevHash, ts, txs, rootsSnapshot) {
  const stateRoots = await hashRoots(rootsSnapshot);
  const txRoot = await sha256Hex(txs.map(t => t.hash).join(''));
  const block = { height, prevHash, ts, txRoot, stateRoots, txs };
  block.hash = await sha256Hex(canonical(headerOf(block)));
  return block;
}

const Chain = {
  blocks: [],
  tampered: null,        // { mode, height, backup } while a tamper demo is active
  halted: null,          // error message if sealing failed
  remote: null,          // { append(block) → Promise<{conflict?, error?}> } set by the app when Supabase is on
  onSealed: null,        // callback(block) after each block is appended
  onConflict: null,      // callback() when the shared ledger rejected a block (someone else appended first)
  pending: 0,            // transactions queued but not yet sealed
  _tail: Promise.resolve(),

  load(blocks) { Chain.blocks = blocks.slice().sort((a, b) => a.height - b.height); Chain.tampered = null; },
  head() { return Chain.blocks[Chain.blocks.length - 1] || null; },
  height() { const h = Chain.head(); return h ? h.height : -1; },
  txs() { return Chain.blocks.flatMap(b => b.txs.map(tx => ({ tx, block: b }))); },
  saveLocal() { return store.set(LEDGER_KEY, Chain.blocks); },
  loadLocal() { return store.get(LEDGER_KEY); },
  clearLocal() { store.del(LEDGER_KEY); },

  // Builds and appends block 0 from [{ body, key }] (all bodies already carry ts/nonce).
  async genesis(entries, rootsSnapshot, ts) {
    const txs = [];
    for (const e of entries) txs.push(await sealTx(e.body, e.key));
    const block = await buildBlock(0, ZERO, ts, txs, rootsSnapshot);
    Chain.blocks = [block];
    return block;
  },

  // Queues one signed transaction for sealing into the next block. Serial: blocks are
  // appended strictly in submission order. Returns a promise for the sealed block.
  submit(body, keyPromise, rootsSnapshot, onDone) {
    Chain.pending++;
    const job = Chain._tail.then(async () => {
      if (Chain.halted) throw new Error(Chain.halted);
      const key = await keyPromise;
      const tx = await sealTx(body, key);
      const prev = Chain.head();
      const block = await buildBlock(prev ? prev.height + 1 : 0, prev ? prev.hash : ZERO, body.ts, [tx], rootsSnapshot);
      Chain.blocks.push(block);
      Chain.saveLocal();
      if (Chain.remote) {
        const res = await Chain.remote.append(block);
        if (res && res.conflict) {
          Chain.halted = 'Another user changed the shared ledger at the same moment — refreshing…';
          if (Chain.onConflict) Chain.onConflict();
          throw new Error(Chain.halted);
        }
      }
      if (onDone) onDone(block);
      if (Chain.onSealed) Chain.onSealed(block);
      return block;
    });
    Chain._tail = job.catch(err => { Chain.halted = Chain.halted || String(err && err.message || err); }).finally(() => { Chain.pending--; });
    return job;
  },
  idle() { return Chain._tail; },

  // Structural checks: tx hashes, tx roots, header hashes and prev-hash links.
  async verifyStructure(blocks = Chain.blocks) {
    const issues = [];
    let prevHash = ZERO;
    for (const b of blocks) {
      for (const tx of b.txs) {
        if (await sha256Hex(txHashInput(tx)) !== tx.hash) issues.push({ height: b.height, check: 'hash', msg: `Transaction ${tx.hash.slice(0, 10)}… content doesn't match its hash` });
      }
      if (await sha256Hex(b.txs.map(t => t.hash).join('')) !== b.txRoot) issues.push({ height: b.height, check: 'hash', msg: 'Transaction root mismatch' });
      if (await sha256Hex(canonical(headerOf(b))) !== b.hash) issues.push({ height: b.height, check: 'hash', msg: 'Block header hash mismatch' });
      if (b.prevHash !== prevHash) issues.push({ height: b.height, check: 'link', msg: `prevHash doesn't point to block ${b.height - 1}` });
      prevHash = b.hash;
    }
    return issues;
  },
  verifyTxSig(tx, publicJwk) { return publicJwk ? Keys.verify(publicJwk, canonical(txBodyOf(tx)), tx.sig) : Promise.resolve(false); },

  // ── Tamper demo (memory only; Restore reloads the saved copy) ──
  tamper(mode, height, extra) {
    if (!Chain.tampered) Chain.tampered = { backup: clone(Chain.blocks), mode, height };
    else Chain.tampered.mode = mode;
    const b = Chain.blocks.find(x => x.height === height);
    if (!b && mode !== 'inject') return false;
    if (mode === 'edit-tx') {
      b.txs[0].detail = `${b.txs[0].detail || ''} [altered]`;
      if (b.txs[0].args && typeof b.txs[0].args === 'object') b.txs[0].args.__altered = true;
    }
    if (mode === 'rehash') {
      // Edit, then recompute this block's hashes so it looks self-consistent — the next
      // block's prevHash (and the tx signature) still expose it.
      b.txs[0].detail = `${b.txs[0].detail || ''} [altered]`;
      return (async () => {
        b.txs[0].hash = await sha256Hex(txHashInput(b.txs[0]));
        b.txRoot = await sha256Hex(b.txs.map(t => t.hash).join(''));
        b.hash = await sha256Hex(canonical(headerOf(b)));
        return true;
      })();
    }
    if (mode === 'inject' && extra) Chain.blocks.push(extra);
    return true;
  },
  restore() {
    if (!Chain.tampered) return false;
    Chain.blocks = Chain.tampered.backup;
    Chain.tampered = null;
    return true;
  },
  // Builds a correctly signed and linked block for the "inject unauthorized tx" demo.
  async forgeBlock(body, key, rootsSnapshot) {
    const prev = Chain.head();
    const tx = await sealTx(body, key);
    return buildBlock(prev.height + 1, prev.hash, body.ts, [tx], rootsSnapshot);
  },
};

const BELLedger = { canonical, sha256Hex, b64u, unb64u, clone, Keys, Keystore, Wallet, Chain, hashRoots, ZERO };
if (typeof window !== 'undefined') window.BELLedger = BELLedger;

export { canonical, sha256Hex, b64u, unb64u, clone, Keys, Keystore, Wallet, Chain, hashRoots, ZERO };
export default BELLedger;
