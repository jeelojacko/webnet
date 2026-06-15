import { describe, expect, it } from 'vitest';
import {
  buildCadCogoExportFilename,
  formatCadCogoComputation,
} from '../src/engine/cad/cadCogoReports';
import type { CadCogoComputation } from '../src/engine/cad/cadCogoTypes';

const sampleComputation: CadCogoComputation = {
  id: 'cogo:sample',
  toolKey: 'INTERSECT_POINT',
  createdAtIso: '2026-06-15T12:00:00.000Z',
  provenance: {
    id: 'cogo:sample',
    toolKey: 'INTERSECT_POINT',
    inputs: {
      first: 'A-B',
      second: 'B-C',
    },
    resultSummary: 'Intersection computed',
    createdAtIso: '2026-06-15T12:00:00.000Z',
  },
  report: {
    title: 'Intersection',
    summary: 'Computed A-B x B-C',
    rows: [
      { label: 'Point', value: 'IP1' },
      { label: 'Northing', value: '10.500', unit: 'm' },
    ],
  },
  warnings: [{ code: 'ALT', message: 'Alternate solution available', severity: 'warning' }],
  alternatives: [{ id: 'alt-1', label: 'Other branch' }],
  createdEntityIds: ['pt:IP1'],
  updatedEntityIds: [],
  removedEntityIds: [],
};

describe('cadCogoReports', () => {
  it('formats COGO computations as txt, csv, and markdown exports', () => {
    expect(formatCadCogoComputation(sampleComputation, 'txt')).toContain('Intersection');
    expect(formatCadCogoComputation(sampleComputation, 'txt')).toContain('Northing: 10.500 m');

    const csv = formatCadCogoComputation(sampleComputation, 'csv');
    expect(csv).toContain('section,label,value,unit');
    expect(csv).toContain('row,Northing,10.500,m');
    expect(csv).toContain('warning,warning:ALT,Alternate solution available,');

    const markdown = formatCadCogoComputation(sampleComputation, 'md');
    expect(markdown).toContain('# Intersection');
    expect(markdown).toContain('- Point: IP1');
    expect(markdown).toContain('## Warnings');
  });

  it('builds deterministic export filenames from tool and timestamp', () => {
    expect(buildCadCogoExportFilename(sampleComputation, 'csv')).toBe(
      'intersect_point-2026-06-15T12-00-00_000Z.csv',
    );
  });
});
