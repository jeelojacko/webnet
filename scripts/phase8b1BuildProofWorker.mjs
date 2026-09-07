// Builds the test-only Phase 8B.1 proof worker into dist/ + dist-webnet/.
// Bundles scripts/phase8b1ProofWorker.ts (real production worker + harness-
// only route enablement) with the repo's esbuild binary; no app build
// config or production source changes. The engine chain is bundler-safe
// (the production worker already bundles it), so a single-file ESM output
// suffices. import.meta.env.BASE_URL (which vite provides in the app) is
// defined per base so the production glue-URL resolution runs unmodified.
// Usage: node scripts/phase8b1BuildProofWorker.mjs
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();
const ESBUILD = path.join(ROOT, 'node_modules/.bin/esbuild');

for (const [outDir, base] of [['dist', '/'], ['dist-webnet', '/webnet/']]) {
  execFileSync(
    ESBUILD,
    [
      path.join('scripts', 'phase8b1ProofWorker.ts'),
      '--bundle',
      '--format=esm',
      '--platform=browser',
      '--target=es2022',
      `--define:import.meta.env.BASE_URL="${base}"`,
      `--outfile=${path.join(outDir, 'phase8b1ProofWorker.js')}`,
      '--log-level=warning',
    ],
    { cwd: ROOT, stdio: 'inherit' },
  );
}
console.log('Phase 8B.1 proof worker bundled into dist/ + dist-webnet/.');
