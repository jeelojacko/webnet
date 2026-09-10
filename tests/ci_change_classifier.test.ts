import { describe, expect, it } from 'vitest';
import { classifyChangedFiles } from '../scripts/ciChangeClassifier.mjs';

describe('CI change classifier', () => {
  it.each([
    ['docs-only', ['docs/foo.md']],
    ['markdown-only', ['README.md', 'docs/notes.md']],
    ['study-only', ['study-desktop/tests/library.test.ts', 'study-desktop/src/studyStorage.ts', 'scripts/studyCorpus.ts']],
    ['component-only', ['src/components/Foo.tsx']],
  ])('%s stays on the fast path', (_name, files) => {
    expect(classifyChangedFiles(files).numericalRequired).toBe(false);
  });

  it.each([
    ['engine', ['src/engine/runSession.ts']],
    ['worker', ['src/workers/adjustmentWorker.ts']],
    ['cpp', ['cpp/src/solver.cpp']],
    ['package', ['package.json']],
    ['vitest config', ['vitest.wasm.config.ts']],
    ['tier manifest', ['scripts/testTiers.ts']],
    ['evidence suite', ['tests/evidence/phase8a5_preanalysis_safety_evidence.test.ts']],
    ['phase10e agent contract', ['tests/phase10e_production_qxx_reuse.test.ts']],
    ['phase10e evidence campaign', ['tests/evidence/phase10e_production_qxx_reuse.test.ts']],
    ['CI workflow', ['.github/workflows/ci.yml']],
    ['unknown source', ['src/newArchitecture/foo.ts']],
  ])('%s requires numerical certification', (_name, files) => {
    expect(classifyChangedFiles(files).numericalRequired).toBe(true);
  });

  it('classifies root README.js as numerical-required (fail-closed)', () => {
    expect(classifyChangedFiles(['README.js']).numericalRequired).toBe(true);
  });

  it('keeps root README.md on the safe fast path', () => {
    expect(classifyChangedFiles(['README.md']).numericalRequired).toBe(false);
  });

  it('escalates mixed safe and numerical paths', () => {
    expect(classifyChangedFiles(['docs/foo.md', 'src/engine/bar.ts']).numericalRequired).toBe(true);
  });

  it('fails closed for an empty or ambiguous diff', () => {
    expect(classifyChangedFiles([])).toMatchObject({ numericalRequired: true, changedFileCount: 0 });
    expect(classifyChangedFiles(undefined as unknown as string[]).numericalRequired).toBe(true);
  });
});
