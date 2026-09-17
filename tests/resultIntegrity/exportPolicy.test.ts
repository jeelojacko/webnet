import { describe, expect, it } from 'vitest';

import type { ProjectExportFormat } from '../../src/typesProject';
import {
  buildExportIntegrityMetadata,
  decideExportVerdict,
  EXPORT_FORMAT_INTEGRITY_POLICY,
  FRESH_SUCCESS_INTEGRITY,
  FAILED_RESULT_STATUS_LINE,
  STALE_RESULT_STATUS_LINE,
  statusLineForAssessment,
  type ExportIntegrityVerdict,
  type ResultIntegrityAssessment,
  type ResultIntegrityState,
} from '../../src/engine/resultIntegrity';

const DELIVERABLE_FORMATS: ProjectExportFormat[] = [
  'points',
  'points-csv',
  'observations-csv',
  'geojson',
  'industry-style',
  'landxml',
  'bundle-qa-standard',
  'bundle-qa-standard-with-landxml',
];

const assessmentFor = (state: ResultIntegrityState): ResultIntegrityAssessment => {
  if (state === 'FRESH_SUCCESS') return FRESH_SUCCESS_INTEGRITY;
  if (state === 'NO_RESULT') {
    return { state, reason: 'NO_RESULT', changedDeps: [], blockMessage: 'No adjustment result is available. Run the adjustment first.' };
  }
  if (state === 'FRESH_FAILED') {
    return { state, reason: 'RUN_FAILED', changedDeps: [], blockMessage: 'The latest run did not converge successfully.' };
  }
  return {
    state,
    reason: 'RESULT_STALE',
    changedDeps: ['input'],
    blockMessage: 'Project state changed since this run (input). Re-run the adjustment.',
  };
};

describe('export integrity matrix (artifact x integrity -> verdict)', () => {
  it('allows every format on FRESH_SUCCESS', () => {
    const formats: ProjectExportFormat[] = [...DELIVERABLE_FORMATS, 'webnet'];
    for (const format of formats) {
      expect(decideExportVerdict(format, assessmentFor('FRESH_SUCCESS'))).toBe('ALLOW');
    }
  });

  it('blocks every format on NO_RESULT', () => {
    const formats: ProjectExportFormat[] = [...DELIVERABLE_FORMATS, 'webnet'];
    for (const format of formats) {
      expect(decideExportVerdict(format, assessmentFor('NO_RESULT'))).toBe('BLOCK');
    }
  });

  it.each(DELIVERABLE_FORMATS)('blocks deliverable %s on stale/failed integrity', (format) => {
    const states: ResultIntegrityState[] = ['STALE_SUCCESS', 'STALE_FAILED', 'FRESH_FAILED'];
    for (const state of states) {
      const verdict: ExportIntegrityVerdict = decideExportVerdict(format, assessmentFor(state));
      expect(verdict).toBe('BLOCK');
    }
  });

  it.each(['STALE_SUCCESS', 'STALE_FAILED', 'FRESH_FAILED'] as ResultIntegrityState[])(
    'allows diagnostic text report (%s) only with an unmistakable status line',
    (state) => {
      expect(EXPORT_FORMAT_INTEGRITY_POLICY.webnet).toBe('diagnostic-text');
      expect(decideExportVerdict('webnet', assessmentFor(state))).toBe(
        'ALLOW_DIAGNOSTIC_WITH_STATUS',
      );
      const line = statusLineForAssessment(assessmentFor(state));
      expect(line).not.toBeNull();
      if (state === 'FRESH_FAILED') {
        expect(line).toBe(FAILED_RESULT_STATUS_LINE);
      } else {
        expect(line).toBe(STALE_RESULT_STATUS_LINE);
        expect(line).toBe('RESULT STATUS: STALE — NOT CURRENT PROJECT STATE');
      }
    },
  );

  it('emits no status line for fresh or missing results', () => {
    expect(statusLineForAssessment(assessmentFor('FRESH_SUCCESS'))).toBeNull();
    expect(statusLineForAssessment(assessmentFor('NO_RESULT'))).toBeNull();
  });

  it('builds minimal export metadata without claiming fallback CRS', () => {
    const metadata = buildExportIntegrityMetadata({
      assessment: assessmentFor('FRESH_SUCCESS'),
      applied: {
        inputFingerprint: 'in',
        mathFingerprint: 'math',
        exclusionFingerprint: 'excl',
        runMode: 'adjustment',
      },
      projectName: 'demo',
      units: 'm',
      crsProvenance: 'UNKNOWN',
      exclusionCount: 2,
      sourceFileCount: 3,
    });
    expect(metadata.status).toBe('FRESH_SUCCESS');
    expect(metadata.runMode).toBe('adjustment');
    expect(metadata.crsProvenance).toBe('UNKNOWN');
    expect(metadata).not.toHaveProperty('crsId');
    expect(typeof metadata.exportedAt).toBe('string');
  });
});
