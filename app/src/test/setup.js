import { beforeEach, afterEach, vi } from 'vitest';
import i18n from '../i18n';

// Keep a developer's VITE_VBLIS_API_TOKEN (shell or .env.local) from changing request URLs/headers in tests
beforeEach(() => {
  vi.stubEnv('VITE_VBLIS_API_TOKEN', '');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  // A test that switched the language must not leak it into the next one.
  if (i18n.language !== 'en') await i18n.changeLanguage('en');
});
