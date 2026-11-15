import { useMemo } from 'react';
import { SessionContext, buildNetworkSession } from './sessionContext';

// Gives the app a signed-in network session. `info` is the server's session body; the value is memoized
// so the app (and its memoized children) only re-render when the session itself changes.
export function SessionProvider({ info, onSignOut, children }) {
  const value = useMemo(() => buildNetworkSession(info, onSignOut), [info, onSignOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
