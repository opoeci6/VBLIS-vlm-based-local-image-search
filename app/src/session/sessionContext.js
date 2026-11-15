import { createContext, useContext } from 'react';

// What the UI may do. The desktop app has one user with full rights, so its value is constant and
// is the default of the context: components and hooks read it with useSession() and need no provider.
export const DESKTOP_SESSION = Object.freeze({
  mode: 'desktop',
  signedIn: true,
  role: 'owner',
  isOwner: true,
  permissions: Object.freeze({ originals: true, image_search: true }),
  may: () => true,
  secure: true,
  caseSensitivePaths: false,
  viewerEnabled: false,
  signOut: async () => {}
});

// `info` is the body of GET /api/auth/session (or POST /api/auth/login).
export const buildNetworkSession = (info, signOut) => {
  const role = info.role === 'owner' ? 'owner' : 'viewer';
  const isOwner = role === 'owner';
  const permissions = Object.freeze({ ...info.permissions });
  return {
    mode: 'network',
    signedIn: true,
    role,
    isOwner,
    permissions,
    // The owner can do everything; a viewer only what the server granted.
    may: (name) => isOwner || Boolean(permissions[name]),
    secure: info.secure !== false,
    caseSensitivePaths: Boolean(info.case_sensitive_paths),
    viewerEnabled: Boolean(info.viewer_enabled),
    signOut
  };
};

export const SessionContext = createContext(DESKTOP_SESSION);

export const useSession = () => useContext(SessionContext);
