import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyChangedFiles } from '../scripts/ciChangeClassifier.mjs';

describe('CI change classifier', () => {
  it.each([
    ['docs-only', ['docs/foo.md']],
    ['markdown-only', ['README.md', 'docs/notes.md']],
    ['study-only', ['study-desktop/tests/library.test.ts', 'study-desktop/src/studyStorage.ts', 'scripts/studyCorpus.ts']],
    ['component-only', ['src/components/Foo.tsx']],
    ['cad-geometry-only', ['src/engine/cad/cadProjectTransform.ts']],
    ['cad-annotation-real-file-only', ['src/engine/cad/annotation/cadAnnotationAnchors.ts']],
  ])('%s stays on the fast path', (_name, files) => {
    expect(classifyChangedFiles(files).numericalRequired).toBe(false);
  });

  it.each([
    ['engine', ['src/engine/runSession.ts']],
    ['cad-grading-compute', ['src/engine/cad/grading/gradingTransitionPolicy.ts']],
    ['cad-surfaces-compute', ['src/engine/cad/surfaces/foo.ts']],
    ['cad-top-level-surface-module', ['src/engine/cad/cadSurfaces.ts']],
    ['cad-top-level-surface-cache', ['src/engine/cad/cadSurfaceCache.ts']],
    ['cad-top-level-profile-cache', ['src/engine/cad/profileCache.ts']],
    ['cad-top-level-contour-cache', ['src/engine/cad/surfaceContourCache.ts']],
    ['cad-top-level-section-cache', ['src/engine/cad/sectionCache.ts']],
    ['cad-analysis-status', ['src/engine/cad/cadAnalysisStatus.ts']],
    ['cad-unknown-new-file', ['src/engine/cad/newFutureComputeThing.ts']],
    ['cad-safe-plus-cad-numerical', ['src/engine/cad/annotation/foo.ts', 'src/engine/cad/grading/foo.ts']],
    ['cad-unknown-annotation-file', ['src/engine/cad/annotation/futureHelper.ts']],
    ['cad-transitively-reachable-display', ['src/engine/cad/cadDisplayTypes.ts']],
    ['cad-draft-plus-worker', ['src/engine/cad/annotation/cadAnnotationAnchors.ts', 'src/workers/adjustmentWorker.ts']],
    ['cad-draft-plus-solver', ['src/engine/cad/cadProjectTransform.ts', 'src/engine/runSession.ts']],
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

  it('every worker-reachable CAD module classifies numerical', () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const modules = collectWorkerReachableCadModules(repoRoot);
    expect(modules.length).toBeGreaterThan(0);
    for (const module of modules) {
      expect(classifyChangedFiles([module]).numericalRequired).toBe(true);
    }
  });
});

// Future-proof invariant: every CAD module reachable from src/workers —
// directly imported or transitively via value imports — must classify
// numerical, so a new worker dependency can never silently enter the
// drafting fast path, and no CAD_SAFE_ONLY entry may become reachable.
// Static relative imports only (`import type` lines skipped); unresolvable
// specifiers are skipped (fail-closed elsewhere covers unknown files).
// Test files are excluded as traversal sources (test-only edges prove nothing).
const collectWorkerReachableCadModules = (repoRoot: string): string[] => {
  const sources = new Map<string, string>();
  const walkSources = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walkSources(full);
      } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
        sources.set(full, readFileSync(full, 'utf8'));
      }
    }
  };
  walkSources(join(repoRoot, 'src'));
  const edges = new Map<string, Set<string>>();
  for (const [file, text] of sources) {
    const clean = text
      .split('\n')
      .filter((line) => !/^\s*import\s+type\b/.test(line))
      .join('\n');
    const targets = new Set<string>();
    for (const match of clean.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const resolved = resolve(dirname(file), match[1]);
      for (const candidate of [resolved, `${resolved}.ts`, `${resolved}.tsx`, join(resolved, 'index.ts')]) {
        if (existsSync(candidate) && statSync(candidate).isFile() && sources.has(candidate)) {
          targets.add(candidate);
          break;
        }
      }
    }
    edges.set(file, targets);
  }
  const seen = new Set<string>();
  const queue = [...sources.keys()].filter((file) => file.includes('/src/workers/'));
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const dep of edges.get(file) ?? []) {
      if (!seen.has(dep)) queue.push(dep);
    }
  }
  const prefix = `${repoRoot}/`;
  return [...seen].filter((file) => file.includes('/src/engine/cad/')).map((file) => file.slice(prefix.length)).sort();
};
