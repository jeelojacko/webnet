import { describe, expect, it } from 'vitest';

import { parseInput } from '../src/engine/parse';
import type { DistanceObservation } from '../src/types';

describe('project run file parsing', () => {
  it('reads checked project files in order, resets defaults at file boundaries, and preserves aliases', () => {
    const parsed = parseInput(
      '',
      {},
      {
        units: 'm',
        coordMode: '2D',
        projectRunFiles: [
          {
            fileId: 'file-1',
            name: 'job-1.dat',
            order: 0,
            content: ['.2D', '.UNITS FT', '.ALIAS P1=A1', 'C A1 0 0 0 ! !', 'C B1 100 0 0 ! !'].join('\n'),
          },
          {
            fileId: 'file-2',
            name: 'job-2.dat',
            order: 1,
            content: ['C C1 0 100 0 ! !', 'D P1-C1 10 0.01'].join('\n'),
          },
        ],
      },
    );

    expect(parsed.observations).toHaveLength(1);
    expect(parsed.observations[0]?.type).toBe('dist');
    const distObservation = parsed.observations[0] as DistanceObservation;
    expect(distObservation.from).toBe('A1');
    expect(distObservation.to).toBe('C1');
    expect(distObservation.obs).toBeCloseTo(10, 12);
    expect(parsed.logs.some((line) => line.includes('Project file boundary: loaded job-1.dat'))).toBe(true);
    expect(parsed.logs.some((line) => line.includes('Project file boundary: loaded job-2.dat'))).toBe(true);
  });

  it('warns and skips duplicate project-file includes', () => {
    const parsed = parseInput(
      '',
      {},
      {
        units: 'm',
        coordMode: '2D',
        includeFiles: {
          'shared.dat': 'C A 0 0 0 ! !',
        },
        projectRunFiles: [
          {
            fileId: 'file-1',
            name: 'root.dat',
            order: 0,
            content: '.INCLUDE shared.dat',
          },
          {
            fileId: 'file-2',
            name: 'shared.dat',
            order: 1,
            content: 'C B 100 0 0 ! !',
          },
        ],
      },
    );

    expect(parsed.logs.some((line) => line.includes('skipped duplicate project-file include'))).toBe(
      true,
    );
    expect(Object.keys(parsed.stations)).toEqual(['B']);
  });
});
