import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TIERS = {
  full: [],
  agent: ['--config', 'vitest.agent.config.ts'],
  wasm: ['--config', 'vitest.wasm.config.ts'],
  release: ['--config', 'vitest.release.config.ts'],
  evidence: ['--config', 'vitest.evidence.config.ts'],
};

const tier = process.argv[2] ?? 'full';
if (!Object.hasOwn(TIERS, tier)) {
  console.error(`Unknown tier "${tier}". Expected one of: ${Object.keys(TIERS).join(', ')}`);
  process.exit(2);
}

const outDir = process.env.WEBNET_PROFILE_DIR ?? path.join(os.tmpdir(), 'webnet-test-profile');
const outFile = path.join(outDir, `profile-${tier}.json`);
mkdirSync(outDir, { recursive: true });

const start = Date.now();
const child = spawn(
  process.execPath,
  [
    path.join(__dirname, 'runVitest.mjs'),
    'run',
    ...TIERS[tier],
    '--reporter=json',
    `--outputFile=${outFile}`,
  ],
  { stdio: ['inherit', 'pipe', 'pipe'] },
);

child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);

const wallMs = await new Promise((resolve) => {
  child.on('close', (code) => resolve({ code, ms: Date.now() - start }));
});

if (!existsSync(outFile)) {
  console.error(`\ntestProfile: vitest exited ${wallMs.code} without writing ${outFile}`);
  process.exit(wallMs.code ?? 1);
}

const report = JSON.parse(readFileSync(outFile, 'utf8'));
const perFile = report.testResults.map((f) => {
  const tests = f.assertionResults ?? [];
  return {
    file: f.name,
    durationMs: Math.max(0, (f.endTime ?? 0) - (f.startTime ?? 0)),
    status: f.status,
    tests: tests.length,
  };
});
perFile.sort((a, b) => b.durationMs - a.durationMs);

const totalTests = perFile.reduce((sum, f) => sum + f.tests, 0);
const summary = {
  tier,
  wallMs: wallMs.ms,
  vitestExitCode: wallMs.code,
  fileCount: perFile.length,
  testCount: totalTests,
  passedTests: report.numPassedTests,
  failedTests: report.numFailedTests,
  skippedOrPendingTests: report.numPendingTests + report.numTodoTests,
  success: report.success,
  slowestFiles: perFile.slice(0, 15),
};

const summaryFile = path.join(outDir, `profile-${tier}.summary.json`);
writeFileSync(summaryFile, `${JSON.stringify(summary, null, 2)}\n`);

const fmt = (ms) => `${(ms / 1000).toFixed(1)}s`;
console.log(`\n=== test profile: ${tier} ===`);
console.log(`wall: ${fmt(summary.wallMs)}  files: ${summary.fileCount}  tests: ${summary.testCount}  ` +
  `passed: ${summary.passedTests}  failed: ${summary.failedTests}  skipped/todo: ${summary.skippedOrPendingTests}`);
console.log('slowest files:');
for (const f of summary.slowestFiles) {
  console.log(`  ${fmt(f.durationMs).padStart(8)}  ${f.file}  (${f.tests} tests, ${f.status})`);
}
console.log(`raw json:   ${outFile}`);
console.log(`summary:    ${summaryFile}`);

process.exit(wallMs.code ?? (summary.success ? 0 : 1));
