import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Standalone Study desktop bundler boundary. Only Study runtime sources
// (`./src`, relocated from the host `src/study`) plus the shared curriculum
// asset under `../study-content` may be bundled here — never the adjustment
// engine, workers, or C++/WASM glue.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
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
