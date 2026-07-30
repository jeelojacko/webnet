import { describe, expect, it } from 'vitest';
import {
  parseInput,
} from './parseTestSupport';

describe('parseInput', () => {
  it('supports .DESC and /DESC append reconciliation with custom delimiter', () => {
    const parsed = parseInput(
      [
        '.DESC FIRST',
        '/DESC APPEND ::',
        "C A 0 0 0 ! ! ! 'Alpha",
        "E A 100.0 0.01 ! 'ALPHA",
        "E A 100.0 0.01 ! 'Beta",
        "E A 100.0 0.01 ! 'Gamma",
      ].join('\n'),
    );
    expect(parsed.parseState.descriptionReconcileMode).toBe('append');
    expect(parsed.parseState.descriptionAppendDelimiter).toBe('::');
    expect(parsed.parseState.reconciledDescriptions?.A).toBe('Alpha::Beta::Gamma');
    expect(
      parsed.logs.some((line) => line.includes('Description reconciliation set to APPEND')),
    ).toBe(true);
  });
});
