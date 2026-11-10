import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { cn } from '../../utils/cn';
import { readLanguagePreference, resolveLanguage, saveLanguagePreference } from '../../utils/language';

// Language names are shown in their own language and are not translated; only "Follow system" is.
const OPTIONS = [
  { value: 'system', nativeName: null },
  { value: 'en', nativeName: 'English' },
  { value: 'zh-CN', nativeName: '简体中文' },
];

export const LanguageSection = () => {
  const { t } = useTranslation('settings');
  const [preference, setPreference] = useState(readLanguagePreference);

  const choose = (value) => {
    setPreference(value);
    saveLanguagePreference(value);
    i18n.changeLanguage(resolveLanguage(value));
  };

  return (
    <div className="pt-2">
      <label className="block text-sm font-semibold text-neutral-500 dark:text-neutral-400 mb-2">{t('language.title')}</label>
      <div className="grid grid-cols-3 gap-3 mb-2">
        {OPTIONS.map(({ value, nativeName }) => (
          <button
            key={value}
            type="button"
            aria-pressed={preference === value}
            onClick={() => choose(value)}
            className={cn(
              "flex items-center justify-center p-3 rounded-xl border text-xs font-bold text-center transition-all",
              preference === value
                ? "bg-indigo-50 dark:bg-indigo-500/15 border-indigo-300 dark:border-indigo-500/40 text-indigo-700 dark:text-indigo-300 ring-2 ring-indigo-500/20"
                : "bg-gray-50 dark:bg-neutral-800/30 border-gray-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-gray-100 dark:hover:bg-neutral-800"
            )}
          >
            {nativeName ?? t('language.system')}
          </button>
        ))}
      </div>
    </div>
  );
};
