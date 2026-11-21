import { createContext, useContext } from 'react';

// What the UI may do. The desktop app has one user with full rights, so its value is constant and
// is the default of the context: components and hooks read it with useSession() and need no provider.
export const DESKTOP_SESSION = Object.freeze({
  mode: 'desktop',
  signedIn: true,
  role: 'owner',
  isOwner: true,
  account: null,
  permissions: Object.freeze({ originals: true, image_search: true, places: true }),
  may: () => true,
  secure: true,
  caseSensitivePaths: false,
  // Replica mode comes from the polled status here (see replicaContext.js); a network session carries it.
  readOnly: false,
  replica: null,
  signOut: async () => {},
  refresh: async () => {}
});

// `info` is the body of GET /api/auth/session (or POST /api/auth/login). `refresh` re-reads it.
export const buildNetworkSession = (info, signOut, refresh) => {
  const role = info.role === 'owner' ? 'owner' : 'viewer';
  const isOwner = role === 'owner';
  const account = info.account ? Object.freeze({ id: info.account.id, name: info.account.name }) : null;
  const permissions = Object.freeze({
    originals: Boolean(info.permissions?.originals),
    image_search: Boolean(info.permissions?.image_search),
    places: Boolean(info.permissions?.places)
  });
  return {
    mode: 'network',
    signedIn: true,
    role,
    isOwner,
    account,
    permissions,
    // The owner can do everything; a viewer only what the server granted.
    may: (name) => isOwner || Boolean(permissions[name]),
    secure: info.secure !== false,
    caseSensitivePaths: Boolean(info.case_sensitive_paths),
    // The library is a read-only copy of an index made elsewhere; `replica` describes it (owner only, else null).
    readOnly: Boolean(info.read_only),
    replica: info.replica && typeof info.replica === 'object' ? info.replica : null,
    signOut,
    refresh
  };
};

export const SessionContext = createContext(DESKTOP_SESSION);

export const useSession = () => useContext(SessionContext);
