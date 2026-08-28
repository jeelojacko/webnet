/**
 * Node >=26 defines experimental native `localStorage`/`sessionStorage`
 * getters on `globalThis` (available only with `--localstorage-file`).
 * Vitest's jsdom environment refuses to override globals it cannot see as
 * "new" browser keys, so Node's built-in (usually `undefined`) shadows
 * jsdom's working Storage objects and `window.localStorage.clear()` throws.
 *
 * Under the jsdom test environment, re-point the storage globals at the
 * current jsdom window and restore Node's original descriptors afterwards.
 */
import { afterAll } from 'vitest';

type JSDomWindow = {
  localStorage?: Storage;
  sessionStorage?: Storage;
};

const jsdomWindow = (globalThis as { jsdom?: { window?: JSDomWindow } }).jsdom?.window;

if (jsdomWindow?.localStorage) {
  const window_ = jsdomWindow;
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const originalSessionStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');

  Object.defineProperty(globalThis, 'localStorage', {
    get: () => window_.localStorage,
    configurable: true,
  });
  if (window_.sessionStorage !== undefined) {
    Object.defineProperty(globalThis, 'sessionStorage', {
      get: () => window_.sessionStorage,
      configurable: true,
    });
  }

  afterAll(() => {
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    if (originalSessionStorage)
      Object.defineProperty(globalThis, 'sessionStorage', originalSessionStorage);
  });
}
