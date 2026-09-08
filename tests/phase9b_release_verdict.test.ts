/**
 * Phase 9B release verdict (fast, focused, no workers, no WASM artifact).
 *
 * Certifies the committed reports/phase9b/ rollout: current production caps
 * (station 128 / runtime 256 / planning 64 / k16 / backstop 16384 /
 * captured 512), the historical Phase 9A references, and that the Phase 9A
 * committed evidence reports are byte-untouched by this batch.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  PREANALYSIS_SPARSE_PARAMETER_CAP,
  PREANALYSIS_SPARSE_PLANNING_SYSTEM_CAP,
  PREANALYSIS_SPARSE_STATION_UNKNOWN_CAP,
} from '../src/engine/preanalysisSparseSessionPolicy';
import {
  PREANALYSIS_SPARSE_SENTINEL_MAX_PARAMETERS,
  PREANALYSIS_SPARSE_VERIFICATION_COLUMN_COUNT,
} from '../src/engine/preanalysisSparseCovarianceSentinel';
import {
  PREANALYSIS_SPARSE_ROUTE_MAX_CAPTURED_CALLS,
  PREANALYSIS_SPARSE_ROUTE_MAX_PARAMETERS,
  PREANALYSIS_SPARSE_ROUTE_MAX_PLANNING_SYSTEMS,
  PREANALYSIS_SPARSE_ROUTE_MAX_STATION_UNKNOWNS,
  PREANALYSIS_SPARSE_ROUTE_MAX_VERIFICATION_QUERIES,
} from '../src/workers/preanalysisSparseAutoRouteCaps';

const REPORT_DIR = path.join(process.cwd(), 'reports/phase9b');
const JSON_PATH = path.join(REPORT_DIR, 'cap-256-rollout.json');
const MD_PATH = path.join(REPORT_DIR, 'cap-256-rollout.md');
const PHASE9A_JSON = path.join(process.cwd(), 'reports/phase9a/cap-widening-evidence.json');

const sha256 = (file: string): string =>
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

describe('phase 9B release verdict', () => {
  it('certifies current caps, history references, and untouched 9A evidence', () => {
    expect(fs.existsSync(JSON_PATH), `missing ${JSON_PATH}`).toBe(true);
    expect(fs.existsSync(MD_PATH), `missing ${MD_PATH}`).toBe(true);
    const report = JSON.parse(fs.readFileSync(JSON_PATH, 'utf-8')) as Record<string, unknown>;
    const caps = report.currentCaps as Record<string, number>;
    expect(caps.stationUnknowns).toBe(128);
    expect(caps.runtimeParameters).toBe(256);
    expect(caps.planningSystems).toBe(64);
    expect(caps.verificationK).toBe(16);
    expect(caps.verificationBackstop).toBe(16384);
    expect(caps.capturedCalls).toBe(512);
    // Source pins match the committed rollout.
    expect(PREANALYSIS_SPARSE_STATION_UNKNOWN_CAP).toBe(128);
    expect(PREANALYSIS_SPARSE_PARAMETER_CAP).toBe(256);
    expect(PREANALYSIS_SPARSE_PLANNING_SYSTEM_CAP).toBe(64);
    expect(PREANALYSIS_SPARSE_ROUTE_MAX_STATION_UNKNOWNS).toBe(128);
    expect(PREANALYSIS_SPARSE_ROUTE_MAX_PARAMETERS).toBe(256);
    expect(PREANALYSIS_SPARSE_ROUTE_MAX_PLANNING_SYSTEMS).toBe(64);
    expect(PREANALYSIS_SPARSE_ROUTE_MAX_CAPTURED_CALLS).toBe(512);
    expect(PREANALYSIS_SPARSE_ROUTE_MAX_VERIFICATION_QUERIES).toBe(16384);
    expect(PREANALYSIS_SPARSE_VERIFICATION_COLUMN_COUNT).toBe(16);
    expect(PREANALYSIS_SPARSE_SENTINEL_MAX_PARAMETERS).toBe(256);
    // Historical 9A references present.
    const history = report.historicalPhase9a as Record<string, unknown>;
    expect(history.productionParameterCap).toBe(128);
    expect(history.verdict).toBe('PARAMETER CAP 256: GO; PARAMETER CAP 512: GO');
    // Committed 9A evidence hash pinned: this batch must not rewrite history.
    expect(report.phase9aEvidenceSha256).toBe(sha256(PHASE9A_JSON));
    expect(fs.readFileSync(MD_PATH, 'utf-8')).toContain('Phase 9B');
  });
});
