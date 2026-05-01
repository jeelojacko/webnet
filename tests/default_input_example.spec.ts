import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import { DEFAULT_INPUT } from '../src/defaultInput';

describe('default input example', () => {
  it('loads the active startup preanalysis project as a stable default input', () => {
    const result = new LSAEngine({
      input: DEFAULT_INPUT,
      maxIterations: 25,
      convergenceThreshold: 0.01,
      parseOptions: {
        runMode: 'preanalysis',
        preanalysisMode: true,
        coordMode: '3D',
        coordSystemMode: 'grid',
        crsId: 'CA_NAD83_CSRS_UTM_19N',
        order: 'EN',
        deltaMode: 'slope',
        angleStationOrder: 'atfromto',
        lonSign: 'west-positive',
        applyCurvatureRefraction: true,
        verticalReduction: 'curvref',
        refractionCoefficient: 0.07,
        qFixLinearSigmaM: 1e-7,
        qFixAngularSigmaSec: 0.0010001,
      },
    }).solve();

    if (!result.success) {
      // Keep the failure debuggable if the built-in starter network regresses later.
      console.log(result.logs.join('\n'));
    }

    expect(result.success).toBe(true);
    expect(result.converged).toBe(true);
    expect(result.preanalysisMode).toBe(true);
    expect(result.parseState?.plannedObservationCount).toBeGreaterThan(200);
    expect(result.observations.length).toBeGreaterThan(400);
  });
});
