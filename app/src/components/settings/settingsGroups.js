import { CircleUser, Cpu, Images, Palette, Search, Server, Share2 } from 'lucide-react';

// The groups (pages) of the Settings window: who sees each, its icon, its title and its one-line description.
// `title` and `description` take the translate function and the session ({ isOwner, mode }) so that every key
// stays a literal t('...') call, which src/i18n/catalogs.test.js checks against the catalogs.

// The group Settings was last left on (localStorage); the gear opens there.
export const SETTINGS_GROUP_STORAGE_KEY = 'settings_group';

export const SETTINGS_GROUPS = [
  {
    id: 'appearance',
    Icon: Palette,
    isVisible: () => true,
    title: (t) => t('settings:settingsModal.groups.appearance.title'),
    description: (t) => t('settings:settingsModal.groups.appearance.description'),
  },
  {
    id: 'search',
    Icon: Search,
    isVisible: () => true,
    title: (t) => t('settings:settingsModal.groups.search.title'),
    description: (t) => t('settings:settingsModal.groups.search.description'),
  },
  {
    id: 'models',
    Icon: Cpu,
    isVisible: ({ isOwner }) => Boolean(isOwner),
    title: (t) => t('settings:settingsModal.groups.models.title'),
    description: (t) => t('settings:settingsModal.groups.models.description'),
  },
  {
    id: 'library',
    Icon: Images,
    isVisible: ({ isOwner }) => Boolean(isOwner),
    title: (t) => t('settings:settingsModal.groups.library.title'),
    description: (t, { mode }) => (mode === 'desktop'
      ? t('settings:settingsModal.groups.library.descriptionDesktop')
      : t('settings:settingsModal.groups.library.description')),
  },
  {
    id: 'sharing',
    Icon: Share2,
    isVisible: ({ mode }) => mode === 'desktop',
    title: (t) => t('settings:settingsModal.groups.sharing.title'),
    description: (t) => t('settings:settingsModal.groups.sharing.description'),
  },
  {
    id: 'server',
    Icon: Server,
    isVisible: ({ isOwner, mode }) => mode === 'network' && Boolean(isOwner),
    title: (t) => t('settings:settingsModal.groups.server.title'),
    description: (t) => t('settings:settingsModal.groups.server.description'),
  },
  {
    id: 'account',
    Icon: CircleUser,
    isVisible: ({ mode }) => mode === 'network',
    title: (t) => t('settings:settingsModal.groups.account.title'),
    description: (t) => t('settings:settingsModal.groups.account.description'),
  },
];

// The groups this session sees, in order. Appearance is always among them.
export const visibleSettingsGroups = (session) => SETTINGS_GROUPS.filter((group) => group.isVisible(session));
