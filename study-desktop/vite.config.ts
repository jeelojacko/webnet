import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Standalone Study desktop bundler boundary. Only Study runtime sources
// (`./src`, relocated from the host `src/study`) plus the shared curriculum
// asset under `../study-content` may be bundled here — never the adjustment
// engine, workers, or C++/WASM glue.
//
// Phase 5B: build-injected commit identity. STUDY_COMMIT (or GITHUB_SHA in
// CI) is baked in as `__STUDY_APP_COMMIT__`; local builds fall back to
// `"local"` via the studyAppInfo seam. Version follows the same pattern so
// Vite and Tauri runtimes agree without importing package.json.
const studyCommit =
  process.env.STUDY_COMMIT ?? process.env.GITHUB_SHA ?? 'local';
const studyVersion =
  process.env.STUDY_APP_VERSION ?? process.env.npm_package_version ?? '0.1.0-beta.1';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  define: {
    __STUDY_APP_COMMIT__: JSON.stringify(studyCommit),
    __STUDY_APP_VERSION__: JSON.stringify(studyVersion),
  },
  css: {
    postcss: './postcss.config.js',
  },
  worker: {
    format: 'es',
  },
  build: {
    outDir: 'dist',
    target: 'esnext',
  },
  server: {
    port: 1421,
    strictPort: true,
  },
});
