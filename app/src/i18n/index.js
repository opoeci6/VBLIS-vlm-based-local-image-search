// Interface translations (English and Simplified Chinese). Rules for whoever adds or changes text:
//
// - Catalogs are JSON files, src/i18n/locales/<language>/<namespace>.json, found by import.meta.glob below.
//   Nothing is registered by hand. Keys are nested objects, used as dot paths ("filters.title").
// - Components: const { t } = useTranslation('<ns>'), called before any early return. It also subscribes the
//   component to language changes, memoized ones included. A component that shows language-dependent
//   output only through formatters (dates, durations, scores) still calls it, for that subscription.
// - Code that runs at event time (a toast in a hook) uses the global i18n.t('ns:key'), so stable
//   callbacks keep their identity.
// - Import-time constants must not hold translated text: keep a key map or a getter function instead.
// - Plurals use _one / _other keys with a numeric `count`. Whole sentences only: never join text from
//   pieces at runtime, because word order differs between languages.
// - Never pass defaultValue for a key that may not exist (tests throw on a missing key, and defaultValue
//   triggers that too). Use i18n.exists(key).
// - Backend text (current_item, HTTP detail, task.errors, download_error) stays English.
//
// Tests run in English whatever the machine language is, and a key missing from the English catalog throws.
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { readLanguagePreference, resolveLanguage } from '../utils/language';

export const SUPPORTED_LANGUAGES = ['en', 'zh-CN'];

const isTest = import.meta.env.MODE === 'test';

// './locales/zh-CN/queue.json' -> resources['zh-CN'].queue
const modules = import.meta.glob('./locales/*/*.json', { eager: true, import: 'default' });
const resources = {};
const namespaces = new Set();
for (const [path, catalog] of Object.entries(modules)) {
  const match = /^\.\/locales\/([^/]+)\/([^/]+)\.json$/.exec(path);
  if (!match) continue;
  const [, language, namespace] = match;
  (resources[language] ??= {})[namespace] = catalog;
  namespaces.add(namespace);
}

const setDocumentLanguage = (language) => {
  if (typeof document !== 'undefined') document.documentElement.lang = language;
};

i18n.use(initReactI18next).init({
  resources,
  lng: isTest ? 'en' : resolveLanguage(readLanguagePreference()),
  fallbackLng: 'en',
  supportedLngs: SUPPORTED_LANGUAGES,
  load: 'currentOnly',
  defaultNS: 'common',
  ns: [...namespaces],
  initAsync: false,
  react: { useSuspense: false },
  // React escapes text itself, and escaping here would mangle folder names such as "Tom & Jerry".
  interpolation: { escapeValue: false },
  ...(isTest && {
    saveMissing: true,
    missingKeyHandler: (languages, namespace, key) => {
      throw new Error(`Missing translation key "${namespace}:${key}"`);
    },
  }),
});

// The event fires before a listener added later could see it, so the first value is set directly.
setDocumentLanguage(i18n.language);
i18n.on('languageChanged', setDocumentLanguage);

export default i18n;
