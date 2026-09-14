/**
 * Phase 12J.4 — authoritative JSON export round-trip.
 *
 * Every provenance/status/covariance field of a ProcessedRawGnssBaseline
 * must survive serialize → parse. Also pins the export policy
 * (FIXED authoritative, FLOAT diagnostic-only, FAILED none) and the
 * no-BL-serializer invariant (BL text cannot carry FORMAL_UNCALIBRATED).
 */
import { describe, expect, it } from 'vitest';
import {
  buildRawBaselineExport,
  isAuthoritativeExportable,
  isDiagnosticExportable,
  parseRawBaselineExport,
  RAW_BASELINE_EXPORT_KIND,
  serializeRawBaselineExport,
} from '../../src/engine/gnssRawExport';
import type {
  ProcessedRawGnssBaseline,
  RawGnssFileMetadata,
} from '../../src/engine/gnssRawTypes';

const meta = (role: 'BASE' | 'ROVER', marker: string): RawGnssFileMetadata => ({
  role,
  fileName: `${marker}.06o`,
  sha256: `${role}-sha`,
  rinexVersion: '2.10',
  marker,
  approxXyz: [1, 2, 3],
  antennaModel: 'SYN-GENX00 NONE',
  antennaHeight: 0,
  antennaEast: 0,
  antennaNorth: 0,
  receiverModel: 'SYNTHRCV',
  firstEpoch: '2024-01-01T00:00:00.000Z',
  lastEpoch: '2024-01-01T00:06:00.000Z',
  intervalSeconds: 30,
  constellations: ['G'],
  signals: ['C1', 'L1', 'L2'],
});

const result = (status: ProcessedRawGnssBaseline['status']): ProcessedRawGnssBaseline => ({
  status,
  acceptance: status === 'FIXED' ? 'PROCESSING_ACCEPTED' : 'PROCESSING_WARNING',
  acceptanceNotes: ['note-a'],
  from: 'SYNB',
  to: 'SYNR',
  deltaX: 9000.1234,
  deltaY: 150.5,
  deltaZ: 25.25,
  baselineLength: 9001.4,
  covariance: { xx: 1e-6, xy: 2e-7, xz: 3e-7, yy: 4e-6, yz: 5e-7, zz: 6e-6 },
  covarianceAssessment: {
    model: 'RTKLIB_FORMAL', calibration: 'UNCALIBRATED',
    status: 'FORMAL_UNCALIBRATED', finite: true, spd: true,
  },
  coordinateReference: 'MARKER_TO_MARKER_ECEF',
  referenceFrame: 'WGS84(G1150)-class/broadcast',
  start: '2024/01/01 00:00:00',
  stop: '2024/01/01 00:06:00',
  solutionQuality: { ratio: 28.6, fixedEpochs: 13, usedEpochs: 13, satellites: 7 },
  antennaAssessment: {
    base: { marker: 'SYNB', model: 'SYN-GENX00 NONE', calibration: 'CALIBRATION_UNAVAILABLE', height: 0, east: 0, north: 0 },
    rover: { marker: 'SYNR', model: 'SYN-GENX00 NONE', calibration: 'CALIBRATION_UNAVAILABLE', height: 0, east: 0, north: 0 },
    overall: 'NONE',
    warning: 'No authoritative antenna calibration was resolved for this endpoint.',
  },
  provenance: {
    processor: 'rnx2rtkp 2.5.1 @62d4677',
    emccVersion: 'emcc-test',
    compileFlags: ['-O2'],
    baseObsSha256: 'base-sha',
    roverObsSha256: 'rover-sha',
    navSha256: ['nav-sha'],
    sp3Sha256: null,
    optionsHash: 'fnv1a-12345678',
    intervalRequested: 'AUTO',
    intervalResolved: 30,
    elevationMaskResolved: 10,
    ephemerisRequested: 'BROADCAST',
    ephemerisUsed: 'BROADCAST',
    processedAt: '2024-01-01T00:07:00.000Z',
  },
  diagnostics: ['status=FIXED q=1 ratio=28.6 sats=7 epochs=13'],
});

describe('gnssRawExport round-trip', () => {
  it('every provenance/status/covariance field survives JSON round-trip', () => {
    const doc = buildRawBaselineExport(meta('BASE', 'SYNB'), meta('ROVER', 'SYNR'), {
      elevationMaskDegrees: 10,
      intervalRequested: 'AUTO',
      ephemerisRequested: 'BROADCAST',
      windowStart: null,
      windowStop: null,
    }, result('FIXED'));
    expect(doc.kind).toBe(RAW_BASELINE_EXPORT_KIND);
    const back = parseRawBaselineExport(serializeRawBaselineExport(doc));
    expect(back).toEqual(doc);
    expect(back.result.covariance).toEqual(doc.result.covariance);
    expect(back.result.provenance).toEqual(doc.result.provenance);
    expect(back.result.covarianceAssessment.status).toBe('FORMAL_UNCALIBRATED');
    expect(back.result.coordinateReference).toBe('MARKER_TO_MARKER_ECEF');
    expect(back.files.base.sha256).toBe('BASE-sha');
  });

  it('rejects wrong-kind and truncated payloads fail-closed', () => {
    expect(() => parseRawBaselineExport('{"kind":"other"}')).toThrow();
    expect(() => parseRawBaselineExport(JSON.stringify({ kind: RAW_BASELINE_EXPORT_KIND }))).toThrow();
  });

  it('export policy: FIXED authoritative, FLOAT diagnostic-only, FAILED none', () => {
    expect(isAuthoritativeExportable(result('FIXED'))).toBe(true);
    expect(isAuthoritativeExportable(result('FLOAT'))).toBe(false);
    expect(isDiagnosticExportable(result('FLOAT'))).toBe(true);
    expect(isDiagnosticExportable(result('FIXED'))).toBe(false);
    expect(isAuthoritativeExportable(result('FAILED'))).toBe(false);
    expect(isDiagnosticExportable(result('FAILED'))).toBe(false);
  });
});
