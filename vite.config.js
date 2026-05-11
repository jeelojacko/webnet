import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolveChunkName } from './src/build/viteChunkRouting';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
