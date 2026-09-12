/**
 * Phase 12C — import performance smoke (record-only, no time gates:
 * machines differ). Proves no accidental O(n^2) parser/lookup behavior
 * across 100 / 1,000 / 10,000 baselines.
 */
import { describe, expect, it } from 'vitest';
import { parseGnssBaselineText } from '../../src/engine/gnssBaselineNetworkImport';

const buildNetworkText = (baselineCount: number): string => {
  const lines = [
    'FRAME ECEF ITRF2020@2020.0 EPOCH 2020.0 ELLIPSOID GRS80',
    'UNITS M',
    'GX ST0000 1000000 2000000 3000000 FIXED',
  ];
  for (let i = 1; i <= baselineCount; i += 1) {
    const id = `ST${String(i).padStart(4, '0')}`;
    lines.push(`GX ${id} ${1000000 + i} ${2000000 + i} ${3000000 + i}`);
  }
  for (let i = 1; i <= baselineCount; i += 1) {
    const from = `ST${String(i - 1).padStart(4, '0')}`;
    const to = `ST${String(i).padStart(4, '0')}`;
    lines.push(`BL ${from} ${to} 1 1 1 ID BL${i}`);
    lines.push('COV 0.000004 0 0 0.000004 0 0.000004');
  }
  return `${lines.join('\n')}\n`;
};

describe('gnss import performance', () => {
  it.each([100, 1000, 10000])('parses %i baselines without pathology', (count) => {
    const text = buildNetworkText(count);
    const start = performance.now();
    const { network, diagnostics } = parseGnssBaselineText(text);
    const elapsedMs = performance.now() - start;
    console.log(`gnss import: ${count} baselines parsed in ${elapsedMs.toFixed(1)} ms`);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(network!.baselines).toHaveLength(count);
    expect(network!.provenance).toHaveLength(count);
  });
});
