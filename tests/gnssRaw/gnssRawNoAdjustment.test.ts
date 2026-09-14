/**
 * Phase 12J.4 — review/export isolation guard.
 *
 * The raw static-baseline review path must never add to the project,
 * modify project state, or rerun any solve: no source file in the raw
 * track may import adjustment hooks/state, reference the project store,
 * or mention the BL serializer (no native BL export by design — BL text
 * cannot preserve FORMAL_UNCALIBRATED covariance semantics).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const RAW_TRACK = [
  'src/hooks/useGnssRawBaseline.ts',
  'src/components/gnss/GnssRawBaselinePanel.tsx',
  'src/components/gnss/GnssRawBaselineModal.tsx',
  'src/components/gnss/GnssRawFileSlots.tsx',
  'src/components/gnss/GnssRawOptionsForm.tsx',
  'src/components/gnss/GnssRawReview.tsx',
  'src/engine/gnssRawExport.ts',
];

const FORBIDDEN = [
  'useAppController',
  'useGnssBaselineWorker',
  'adjustmentWorker',
  'projectSession',
  'gnssBaselineAdjust',
  'runGnssBaseline',
  'importGnssBaseline',
  'GvxImport',
  'gvxImport',
  '.bl\n',
  'raw adjustment',
  'Raw adjustment',
];

describe('raw review/export isolation', () => {
  for (const file of RAW_TRACK) {
    it(`${file} has no project/solve/ingest coupling`, () => {
      const text = readFileSync(file, 'utf8');
      for (const token of FORBIDDEN) {
        expect(text, `${file} must not contain ${JSON.stringify(token)}`).not.toContain(token);
      }
    });
  }
});
