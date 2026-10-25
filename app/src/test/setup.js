import { beforeEach, afterEach, vi } from 'vitest';

// Keep a developer's VITE_VBLIS_API_TOKEN (shell or .env.local) from changing request URLs/headers in tests
beforeEach(() => {
  vi.stubEnv('VITE_VBLIS_API_TOKEN', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});
