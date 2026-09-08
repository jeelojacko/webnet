/**
 * Phase 9A report assembly tests (fast, agent tier: no workers, no WASM).
 *
 * Covers the pure scripts/phase9a/phase9aReport.ts layer that replaced the
 * report-writing `it` of the old monolithic evidence test: GO/NO-GO verdict
 * computation, skip handling, SHA fallback order, and byte-identical
 * rendering of the committed reports/phase9a/ Markdown from its JSON.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  assemblePhase9aEvidence,
  renderPhase9aMarkdown,
  resolvePhase9aShas,
} from '../scripts/phase9a/phase9aReport';

const fixture = (): Record<string, unknown> =>
  JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/phase9aReportFragments.json'), 'utf-8'),
  ) as Record<string, unknown>;

const HEAD = 'a9114d7d19a270c1a674928be55373cc9ff17cd7';
const BASE = 'e6aeb287edf500926450ca197f344caa3c3bb139';

describe('phase 9A report assembly', () => {
  it('assembles GO verdicts from complete fragments', () => {
    const evidence = assemblePhase9aEvidence(fixture(), { baselineSha: BASE, headSha: HEAD }, true);
    expect(evidence.plainGpsCompleteness).toBe(true);
    expect(evidence.verdicts).toEqual({
      parameterCap256: 'GO',
      parameterCap512: 'GO',
      recommendedStationUnknownCap: 128,
      recommendedRuntimeParameterCap: 256,
    });
    expect(evidence.verdict).toBe('PARAMETER CAP 256: GO; PARAMETER CAP 512: GO');
    expect((evidence.completeness as { missing: unknown[] }).missing).toEqual([]);
    expect(evidence.productionParameterCap).toBe(128);
    expect(evidence.wasmPresent).toBe(true);
    const md = renderPhase9aMarkdown(evidence);
    expect(md).toContain('PARAMETER CAP 256: GO; PARAMETER CAP 512: GO');
    expect(md).toContain('## Full real-WASM route ladder');
  });

  it('goes NO-GO on missing evidence and NOT EVALUATED on skips', () => {
    const incomplete = fixture();
    delete incomplete.plainGps;
    const noGo = assemblePhase9aEvidence(incomplete, { baselineSha: null, headSha: HEAD }, true);
    expect((noGo.completeness as { missing: string[] }).missing).toEqual(['plainGps']);
    expect((noGo.verdicts as { parameterCap256: string }).parameterCap256).toBe('NO-GO');
    const skipped = fixture();
    (skipped.faults256 as { status: string }).status = 'NOT_EVALUATED';
    const notEval = assemblePhase9aEvidence(skipped, { baselineSha: null, headSha: HEAD }, false);
    expect((notEval.verdicts as { parameterCap256: string }).parameterCap256).toBe('NOT EVALUATED');
  });

  it('resolves SHAs via explicit env > reliable CI > verify-only > null', () => {
    expect(resolvePhase9aShas({ PHASE9A_BASELINE_SHA: BASE, PHASE9A_HEAD_SHA: HEAD, GITHUB_SHA: HEAD }))
      .toEqual({ baselineSha: BASE, headSha: HEAD });
    expect(resolvePhase9aShas({ GITHUB_SHA: HEAD }).headSha).toBe(HEAD);
    expect(resolvePhase9aShas({ GITHUB_SHA: HEAD }).baselineSha).toBeNull();
    expect(resolvePhase9aShas({ PHASE9A_BASELINE_SHA: 'not-a-sha', GITHUB_SHA: HEAD }).baselineSha).toBeNull();
    const fallback = resolvePhase9aShas({});
    expect(fallback.baselineSha).toBeNull();
    expect(fallback.headSha === null || /^[0-9a-f]{40}$/i.test(fallback.headSha)).toBe(true);
  });

  it('renders the committed Markdown byte-identically from the committed JSON', () => {
    const dir = path.join(process.cwd(), 'reports/phase9a');
    const committed = JSON.parse(
      fs.readFileSync(path.join(dir, 'cap-widening-evidence.json'), 'utf-8'),
    ) as Record<string, unknown>;
    expect(renderPhase9aMarkdown(committed)).toBe(
      fs.readFileSync(path.join(dir, 'cap-widening-evidence.md'), 'utf-8'),
    );
  });
});
