import { cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolveChunkName } from './src/build/viteChunkRouting';

// Phase 7C: copy the Emscripten sparse glue + wasm beside the dist bundle
// at build time (never committed; dist/ is gitignored). The worker loads
// `webnet_core.js` base-relative, and the glue locateFile resolves the
// adjacent `webnet_core.wasm`. Missing artifacts warn only: the worker
// auto-route fails closed to TypeScript with an explicit diagnostic.
const webnetWasmArtifacts = () => ({
  name: 'webnet-wasm-artifacts',
  writeBundle(options) {
    const outDir = options.dir ?? 'dist';
    for (const file of ['webnet_core.js', 'webnet_core.wasm']) {
      const source = join('cpp', 'build-wasm', file);
      if (!existsSync(source)) {
        this.warn(`webnet-wasm-artifacts: ${source} missing; skipping (sparse auto-route will fail closed).`);
        continue;
      }
      cpSync(source, join(outDir, file));
    }
  },
});

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), webnetWasmArtifacts()],
  worker: {
    format: 'es',
  },
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          return resolveChunkName(id);
        },
      },
    },
  },
});
