import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseInput } from '../src/engine/parse';
import { extractAutoAdjustDirectiveFromInput } from '../src/engine/autoAdjust';

type Expected = {
  enabled: boolean;
  stdResThreshold: number;
  maxCycles: number;
  maxRemovalsPerCycle: number;
  sourceLine: number;
};

describe('auto-adjust phase 4 CLI-style parity', () => {
  it('locks /AUTOADJUST fixture parsing and directive extraction', () => {
    const input = readFileSync('tests/fixtures/auto_adjust_phase4_cli.dat', 'utf-8');
    const expected = JSON.parse(
      readFileSync('tests/fixtures/auto_adjust_phase4_expected.json', 'utf-8'),
    ) as Expected;

    const parsed = parseInput(input);
    const directive = extractAutoAdjustDirectiveFromInput(input);

    expect(parsed.parseState.autoAdjustEnabled).toBe(expected.enabled);
    expect(parsed.parseState.autoAdjustStdResThreshold).toBeCloseTo(expected.stdResThreshold, 10);
    expect(parsed.parseState.autoAdjustMaxCycles).toBe(expected.maxCycles);
    expect(parsed.parseState.autoAdjustMaxRemovalsPerCycle).toBe(expected.maxRemovalsPerCycle);

    expect(directive).toBeDefined();
    expect(directive?.enabled).toBe(expected.enabled);
    expect(directive?.stdResThreshold).toBeCloseTo(expected.stdResThreshold, 10);
    expect(directive?.maxCycles).toBe(expected.maxCycles);
    expect(directive?.maxRemovalsPerCycle).toBe(expected.maxRemovalsPerCycle);
    expect(directive?.sourceLine).toBe(expected.sourceLine);
  });
});
