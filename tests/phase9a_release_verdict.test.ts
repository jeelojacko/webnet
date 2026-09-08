/**
 * Phase 9A release verdict (fast, focused, no workers, no WASM artifact).
 *
 * Certifies the committed reports/phase9a/ evidence: GO verdicts, pinned
 * production caps/invariants, exact ladder dimensions, plain-GPS contract
 * rows, and fail-closed fault corpora. Slow real-WASM execution lives in
 * the manual-only evidence shards (tests/evidence/phase9a_evidence_*);
 * report assembly logic is unit-tested in tests/phase9a_report.test.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  evaluatePreanalysisSparseWholeSession,
  PREANALYSIS_SPARSE_PLANNING_SYSTEM_CAP,
  PREANALYSIS_SPARSE_UNKNOWN_CAP,
} from '../src/engine/preanalysisSparseSessionPolicy';
import { PREANALYSIS_SPARSE_VERIFICATION_COLUMN_COUNT } from '../src/engine/preanalysisSparseCovarianceSentinel';
import {
  PREANALYSIS_SPARSE_ROUTE_MAX_CAPTURED_CALLS,
  PREANALYSIS_SPARSE_ROUTE_MAX_PLANNING_SYSTEMS,
  PREANALYSIS_SPARSE_ROUTE_MAX_UNKNOWN_COUNT,
  PREANALYSIS_SPARSE_ROUTE_MAX_VERIFICATION_QUERIES,
} from '../src/workers/preanalysisSparseAutoRouteCaps';

const REPORT_DIR = path.join(process.cwd(), 'reports/phase9a');
const JSON_PATH = path.join(REPORT_DIR, 'cap-widening-evidence.json');
const MD_PATH = path.join(REPORT_DIR, 'cap-widening-evidence.md');

type Row = Record<string, unknown>;
const readReport = (): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(JSON_PATH, 'utf-8')) as Record<string, unknown>;

describe('phase 9A release verdict', () => {
  it('certifies GO verdicts and pinned production invariants', () => {
    expect(fs.existsSync(JSON_PATH), `missing ${JSON_PATH}`).toBe(true);
    expect(fs.existsSync(MD_PATH), `missing ${MD_PATH}`).toBe(true);
    const report = readReport();
    expect(report.verdict).toBe('PARAMETER CAP 256: GO; PARAMETER CAP 512: GO');
    expect(report.verdicts).toEqual({
      parameterCap256: 'GO',
      parameterCap512: 'GO',
      recommendedStationUnknownCap: 128,
      recommendedRuntimeParameterCap: 256,
    });
    expect((report.completeness as { missing: unknown[] }).missing).toEqual([]);
    // Production caps pinned in source (no widening shipped).
    expect(PREANALYSIS_SPARSE_UNKNOWN_CAP).toBe(128);
    expect(PREANALYSIS_SPARSE_PLANNING_SYSTEM_CAP).toBe(64);
    expect(PREANALYSIS_SPARSE_ROUTE_MAX_UNKNOWN_COUNT).toBe(128);
    expect(PREANALYSIS_SPARSE_ROUTE_MAX_PLANNING_SYSTEMS).toBe(64);
    expect(PREANALYSIS_SPARSE_ROUTE_MAX_CAPTURED_CALLS).toBe(512);
    expect(PREANALYSIS_SPARSE_ROUTE_MAX_VERIFICATION_QUERIES).toBe(16384);
    expect(PREANALYSIS_SPARSE_VERIFICATION_COLUMN_COUNT).toBe(16);
    expect(report.productionStationUnknownCap).toBe(128);
    expect(report.productionParameterCap).toBe(128);
    expect(report.productionPlanningSystemCap).toBe(64);
    expect(report.verificationK).toBe(16);
    expect(report.verificationQueryBackstop).toBe(16384);
    expect(report.productionCapsChanged).toBe(false);
    expect(report.productionNumericalBehaviorChanged).toBe(false);
    expect(report.productionRouteDefaultChanged).toBe(false);
    expect(report.productionChanged).toBe(false);
    // Static policy still gates above-cap counts by default.
    const pass = { index: 0, staticAdmit: true, physicalValid: true, sentinelPass: true, correctionPass: true };
    expect(evaluatePreanalysisSparseWholeSession({ unknownCount: 128, systems: [pass] }).admit).toBe(true);
    expect(evaluatePreanalysisSparseWholeSession({ unknownCount: 129, systems: [pass] }).admit).toBe(false);
    // SHAs are informational (40-hex or null under the new fallback).
    for (const key of ['baselineSha', 'headSha'] as const) {
      const sha = report[key] as unknown;
      expect(sha === null || (typeof sha === 'string' && /^[0-9a-f]{40}$/i.test(sha))).toBe(true);
    }
  });

  it('certifies the exact ladder, plain-GPS, and fail-closed fault legs', () => {
    const report = readReport();
    const required = (report.completeness as { requiredEvidence: string[] }).requiredEvidence;
    for (const key of required) {
      expect((report[key] as { status?: string })?.status, `leg ${key} not EXECUTED`).toBe('EXECUTED');
    }
    const ladder = ((report.fullRouteLadder as { rows?: Row[] }).rows ?? []);
    for (const target of [128, 160, 192, 256, 384, 512]) {
      const row = ladder.find((candidate) => candidate.targetParameterCount === target);
      expect(row?.actualParameterCount, `ladder ${target}`).toBe(target);
      expect(row?.route, `ladder ${target}`).toBe('sparse');
      expect(row?.restartEquality, `ladder ${target}`).toBe(true);
    }
    const plainGps = ((report.plainGps as { rows?: Row[] }).rows ?? []);
    for (const target of [255, 511]) {
      const row = plainGps.find((candidate) => candidate.targetParameterCount === target);
      expect(row?.route, `plainGps ${target}`).toBe('sparse');
      expect(row?.actualParameterCount, `plainGps ${target}`).toBe(target + 3);
      expect(row?.contractPass, `plainGps ${target}`).toBe(true);
    }
    for (const name of ['faults256', 'faults512'] as const) {
      const rows = ((report[name] as { rows?: Row[] }).rows ?? []);
      expect(rows.length, `${name} empty`).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.route, `${name}/${row.mode}`).toBe('typescript');
        expect(row.restartEquality, `${name}/${row.mode}`).toBe(true);
      }
    }
    expect(((report.faults256 as { rows: Row[] }).rows ?? []).length).toBe(9);
    expect(((report.faults512 as { rows: Row[] }).rows ?? []).length).toBe(4);
    expect(fs.readFileSync(MD_PATH, 'utf-8')).toContain('PARAMETER CAP 256: GO; PARAMETER CAP 512: GO');
  });
});
