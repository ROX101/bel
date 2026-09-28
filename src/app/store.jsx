// React binding for core.js's plain-JS Store/DB/Session/State.
// core.js keeps DB/Session/State as large mutable objects (exactly like the original
// app.js did) because they are mutated imperatively at hundreds of call sites inside
// the ported business logic (ledger, reviews, identity, audit...). Rewriting all of
// that to immutable useReducer actions would touch nearly every function for no
// behavioural gain, so instead we expose core.js's tiny pub/sub (`Store`) through
// React's own hook for "external mutable store" subscriptions: useSyncExternalStore.
// Any component that calls useApp() re-renders whenever core.js calls notify().
import { useSyncExternalStore } from 'react';
import { Store, DB, Session, State } from './core.js';

export function useApp() {
  // The snapshot value itself doesn't matter (DB/Session/State are read by reference
  // below) — its only job is to change on every notify() so React knows to re-render.
  useSyncExternalStore(Store.subscribe, Store.getSnapshot, Store.getSnapshot);
  return { DB, Session, State };
}
