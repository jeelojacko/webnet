import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import type { ParseOptions } from '../src/types';

type LegacyCorpusProject = {
  id: string;
  inputPath: string;
  profile: 'webnet' | 'industry-parity';
  parseMode: 'legacy' | 'strict';
  runMode: NonNullable<ParseOptions['runMode']>;
  expected: {
    parseSuccess: boolean;
    runSuccess: boolean;
    requiredDiagnostics?: string[];
  };
  tags?: string[];
};

type LegacyCorpusPhase1Manifest = {
  version: number;
  description: string;
  projects: LegacyCorpusProject[];
};

const manifest = JSON.parse(
  readFileSync('tests/fixtures/legacy_compatibility_corpus_phase1.json', 'utf-8'),
) as LegacyCorpusPhase1Manifest;

const runProject = (project: LegacyCorpusProject) => {
  const inputPath = path.resolve(project.inputPath);
  const input = readFileSync(inputPath, 'utf-8');
  const includeCache = new Map<string, string>();
  const parseOptions: Partial<ParseOptions> = {
    runMode: project.runMode,
    preanalysisMode: project.runMode === 'preanalysis',
    parseCompatibilityMode: project.parseMode,
    parseModeMigrated: project.parseMode === 'strict',
    sourceFile: inputPath,
    includeResolver: ({ includePath, parentSourceFile }) => {
      const baseFile =
        parentSourceFile && parentSourceFile !== '<input>' ? parentSourceFile : inputPath;
      const resolved = path.resolve(path.dirname(baseFile), includePath);
      try {
        const cached = includeCache.get(resolved);
        if (cached != null) {
          return { sourceFile: resolved, content: cached };
        }
        const content = readFileSync(resolved, 'utf-8');
        includeCache.set(resolved, content);
        return { sourceFile: resolved, content };
      } catch {
        return null;
      }
    },
  };
  const result = new LSAEngine({
    input,
    maxIterations: 15,
    parseOptions,
  }).solve();
  return result;
};

describe('legacy compatibility corpus phase 1', () => {
  it('curates a mixed project set with explicit run-mode outcomes', () => {
    expect(manifest.version).toBe(1);
    expect(manifest.projects.length).toBeGreaterThanOrEqual(6);

    const ids = new Set<string>();
    for (const project of manifest.projects) {
      expect(ids.has(project.id)).toBe(false);
      ids.add(project.id);
      expect(existsSync(project.inputPath)).toBe(true);
      expect(project.expected.parseSuccess).toBeTypeOf('boolean');
      expect(project.expected.runSuccess).toBeTypeOf('boolean');
    }

    const runModes = new Set(manifest.projects.map((project) => project.runMode));
    expect(runModes.has('adjustment')).toBe(true);
    expect(runModes.has('preanalysis')).toBe(true);
    expect(runModes.has('data-check')).toBe(true);
    expect(runModes.has('blunder-detect')).toBe(true);

    expect(
      manifest.projects.some((project) => project.inputPath.includes('legacy_corpus_include')),
    ).toBe(true);
    expect(manifest.projects.some((project) => project.expected.runSuccess === false)).toBe(true);
  });

  for (const project of manifest.projects) {
    it(`matches expected run-mode outcome for ${project.id}`, () => {
      const result = runProject(project);
      const includeErrorCount = result.parseState?.includeErrors?.length ?? 0;
      const parseSuccess = includeErrorCount === 0;
      expect(parseSuccess).toBe(project.expected.parseSuccess);
      expect(result.success).toBe(project.expected.runSuccess);
      expect(result.parseState?.runMode ?? 'adjustment').toBe(project.runMode);

      const requiredDiagnostics = project.expected.requiredDiagnostics ?? [];
      if (requiredDiagnostics.length > 0) {
        const diagCodes = new Set(
          (result.parseState?.runModeCompatibilityDiagnostics ?? []).map((diag) => diag.code),
        );
        requiredDiagnostics.forEach((code) => expect(diagCodes.has(code)).toBe(true));
      }
    });
  }
});
