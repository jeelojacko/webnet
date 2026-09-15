import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { parseTerrestrialCoordinateCsv } from '../src/engine/terrestrialCsvImport';
import { SAMPLE_CATALOG } from '../src/engine/fieldToFinish/sampleCatalog';
import { controlStationsToFieldToFinishPoints } from '../src/engine/fieldToFinish/regeneration';
import {
  buildF2FReviewRows,
  summarizeF2FReview,
} from '../src/components/surveyCad/f2fReviewUtils';

const csv = readFileSync('tests/fixtures/f2f_fxl_sample.csv', 'utf-8');

const loadPoints = () => {
  const dataset = parseTerrestrialCoordinateCsv(csv, { units: 'm' }, 'f2f_fxl_sample.csv');
  expect(dataset).not.toBeNull();
  return controlStationsToFieldToFinishPoints(dataset!.controlStations, 'f2f-review');
};

describe('cad f2f import review', () => {
  it('splits combined CODE CONTROL cells so preview agrees with commit (12 mapped / 1 unmapped)', () => {
    const points = loadPoints();
    const summary = summarizeF2FReview(points, SAMPLE_CATALOG);
    // invalidControls: 1 is pre-existing findInvalidControlTokens semantics:
    // the unmapped ROCK code is neither catalog nor control, so it warns twice.
    expect(summary).toMatchObject({ total: 13, mapped: 12, unmapped: 1, noCode: 0, invalidControls: 1 });
    const rows = buildF2FReviewRows(points, SAMPLE_CATALOG);
    const byId = new Map(rows.map((row) => [row.pointId, row]));
    // Codes and descriptions stay distinct in preview.
    expect(byId.get('E1')).toMatchObject({ rawCode: 'EDGE BEGIN', description: 'Edge start', mappingStatus: 'Mapped' });
    expect(byId.get('T1')).toMatchObject({ rawCode: 'TREE', description: 'Oak', mappingStatus: 'Mapped' });
    // Controls attach to the code instead of poisoning the match.
    expect(byId.get('E1')?.codes).toEqual(['EDGE']);
    expect(byId.get('E1')?.lineworkControls).toBe('BEGIN');
    expect(byId.get('U1')).toMatchObject({ mappingStatus: 'Mapped' });
    expect(byId.get('R1')).toMatchObject({ mappingStatus: 'Unmapped' });
  });

  it('previews the same 3 linework chains commit builds', () => {
    const summary = summarizeF2FReview(loadPoints(), SAMPLE_CATALOG);
    expect(summary.chains).toBe(3);
    expect(summary.lineworkFailures).toBe(0);
  });
});
