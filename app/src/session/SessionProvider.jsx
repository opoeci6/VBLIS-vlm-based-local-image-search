import { useMemo } from 'react';
import { SessionContext, buildNetworkSession } from './sessionContext';

const noRefresh = async () => {};

// Gives the app a signed-in network session. `info` is the server's session body; the value is memoized
// so the app (and its memoized children) only re-render when the session itself changes.
// `onRefresh` re-reads the session from the server (the gate passes it; a test may leave it out).
export function SessionProvider({ info, onSignOut, onRefresh = noRefresh, children }) {
  const value = useMemo(() => buildNetworkSession(info, onSignOut, onRefresh), [info, onSignOut, onRefresh]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
