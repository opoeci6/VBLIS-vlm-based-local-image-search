import { createContext, useContext, useEffect, useMemo } from 'react';
import { useSession } from './sessionContext';
import { rememberReplicaHost } from '../utils/replica';

// Whether the library is a read-only copy of an index made on another computer ("replica mode"), and what is
// known about that copy. `readOnly` is true for everyone (a viewer too); `replica` is the backend's object
// ({ source_host, exported_at, imported_at, model_id, missing }) for the owner, null otherwise.
export const NO_REPLICA = Object.freeze({ readOnly: false, replica: null });

export const ReplicaContext = createContext(NO_REPLICA);

export const useReplica = () => useContext(ReplicaContext);

// Derives the value once, in App: from the network session (a browser reads it at sign-in) or from the
// polled status (the Windows app, and a network owner with a fresher view). The object is rebuilt from its
// JSON text, so it keeps its identity while a poll brings the same values and nothing below re-renders.
export const useReplicaInfo = (status) => {
  const session = useSession();
  const raw = session.replica ?? status?.replica ?? null;
  const key = raw ? JSON.stringify(raw) : '';
  const replica = useMemo(() => (key ? JSON.parse(key) : null), [key]);
  const readOnly = Boolean(session.readOnly) || replica !== null;
  useEffect(() => {
    rememberReplicaHost(replica?.source_host);
  }, [replica]);
  return useMemo(() => ({ readOnly, replica }), [readOnly, replica]);
};
