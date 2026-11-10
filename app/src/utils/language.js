import { readJson, writeJson } from './storage';

// The language setting: 'system' (follow Windows), 'en' or 'zh-CN'. Kept in localStorage like the theme.
export const LANGUAGE_STORAGE_KEY = 'ui_language';
export const LANGUAGE_PREFERENCES = ['system', 'en', 'zh-CN'];

export const readLanguagePreference = () => {
  const saved = readJson(LANGUAGE_STORAGE_KEY, 'system');
  return LANGUAGE_PREFERENCES.includes(saved) ? saved : 'system';
};

export const saveLanguagePreference = (preference) => {
  writeJson(LANGUAGE_STORAGE_KEY, LANGUAGE_PREFERENCES.includes(preference) ? preference : 'system');
};

// The language to show for a preference. 'system' looks at navigator.language only (the Windows display
// language), not navigator.languages: an English Windows with Chinese as a second language stays English.
export const resolveLanguage = (preference) => {
  if (preference === 'en' || preference === 'zh-CN') return preference;
  const systemLanguage = typeof navigator === 'undefined' ? '' : String(navigator.language ?? '');
  return /^zh(?:$|[-_])/i.test(systemLanguage) ? 'zh-CN' : 'en';
};
