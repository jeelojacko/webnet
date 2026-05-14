import { describe, expect, it } from 'vitest';

import { formatFixedOrScientific } from '../src/components/report/reportFormatters';

describe('formatFixedOrScientific', () => {
  it('keeps fixed formatting when the configured precision can still show the value', () => {
    expect(formatFixedOrScientific(0.0012, 4)).toBe('0.0012');
  });

  it('switches to scientific notation when fixed formatting rounds a non-zero value to zero', () => {
    expect(formatFixedOrScientific(0.0000042, 4)).toBe('4.200e-6');
    expect(formatFixedOrScientific(-0.0000042, 4)).toBe('-4.200e-6');
  });
});
