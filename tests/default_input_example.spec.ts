import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import { DEFAULT_INPUT } from '../src/defaultInput';

describe('default input example', () => {
  it('converges as a stable mixed-network quick regression example', () => {
    const result = new LSAEngine({
      input: DEFAULT_INPUT,
      maxIterations: 25,
      convergenceThreshold: 0.001,
    }).solve();

    if (!result.success) {
      // Keep the failure debuggable if the built-in starter network regresses later.
      console.log(result.logs.join('\n'));
    }

    expect(result.success).toBe(true);
    expect(result.converged).toBe(true);
    expect(result.seuw).toBeGreaterThan(0.9);
    expect(result.seuw).toBeLessThan(1.2);
    expect(result.observations.length).toBeGreaterThan(30);
  });
});
