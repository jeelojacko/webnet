/**
 * Phase 12G — workspace session unit tests (summary / toggle / preflight).
 *
 * Structural and gate behavior only; backend goldens own all numerics.
 */
import { describe, expect, it } from 'vitest';
import { runGnssBaselineAdjustment } from '../src/engine/gnssBaselineAdjust';
import { buildGnssSampleNetwork, GNSS_SAMPLE_EXPECTATIONS } from '../src/engine/gnssSampleNetwork';
import {
  buildGnssSessionInput,
  runGnssWorkspacePreflight,
  setStationFixed,
  summarizeGnssImport,
} from '../src/engine/gnssWorkspaceSession';

describe('summarizeGnssImport', () => {
  it('pins structural counts and frame tags of the synthetic sample', () => {
    const network = buildGnssSampleNetwork();
    const summary = summarizeGnssImport(network, [], { format: 'sample', sourceFile: 'synthetic-sample' });
    expect(summary.format).toBe('sample');
    expect(summary.adjustmentFrame).toBe('ECEF');
    expect(summary.referenceFrame).toBe('SYNTH-WGS84(G2139)');
    expect(summary.epoch).toBe('2026.0');
    expect(summary.ellipsoid).toBe('WGS84');
    expect(summary.stationCount).toBe(GNSS_SAMPLE_EXPECTATIONS.stationCount);
    expect(summary.fixedStationCount).toBe(GNSS_SAMPLE_EXPECTATIONS.fixedStationCount);
    expect(summary.freeStationCount).toBe(5);
    expect(summary.baselineCount).toBe(GNSS_SAMPLE_EXPECTATIONS.baselineCount);
    expect(summary.covarianceSource).toBe('SIGCORR');
    expect(summary.covarianceRepresentation).toBe('full 3x3 correlated covariance');
  });

  it('renders absent metadata as unknown and surfaces warnings', () => {
    const network = buildGnssSampleNetwork();
    const tagless = {
      ...network,
      frame: { ...network.frame, referenceFrame: '', epoch: undefined, ellipsoid: '  ' },
    };
    const summary = summarizeGnssImport(
      tagless,
      [{ severity: 'warning', code: 'W', message: 'kept distinct' }],
      null,
    );
    expect(summary.referenceFrame).toBe('unknown');
    expect(summary.epoch).toBe('unknown');
    expect(summary.ellipsoid).toBe('unknown');
    expect(summary.format).toBe('unknown');
    expect(summary.warnings).toEqual(['kept distinct']);
  });

  it('flags the repeated vector in warnings via preflight', () => {
    const network = buildGnssSampleNetwork();
    const input = buildGnssSessionInput(network, {});
    const preflight = runGnssWorkspacePreflight(input);
    expect(preflight.warnings.some((warning) => /SYN_A->SYN_B.*2 independent/.test(warning))).toBe(true);
  });
});

describe('sample structural contract', () => {
  it('solves to the expected equation/unknown/DOF counts', () => {
    const input = buildGnssSessionInput(buildGnssSampleNetwork(), {});
    const result = runGnssBaselineAdjustment(input);
    expect(result.numObsEquations).toBe(GNSS_SAMPLE_EXPECTATIONS.equationCount);
    expect(result.numParams).toBe(GNSS_SAMPLE_EXPECTATIONS.unknownCount);
    expect(result.dof).toBe(GNSS_SAMPLE_EXPECTATIONS.degreesOfFreedom);
    expect(result.logicalObservations).toBe(GNSS_SAMPLE_EXPECTATIONS.baselineCount);
    expect(result.converged).toBe(true);
  });
});

describe('setStationFixed', () => {
  it('sets and clears all four XYZ flags together (full-XYZ only)', () => {
    const network = buildGnssSampleNetwork();
    const fixed = setStationFixed(network.stations, 'SYN_B', true);
    expect(fixed.SYN_B).toMatchObject({ fixed: true, fixedX: true, fixedY: true, fixedH: true });
    const freed = setStationFixed(fixed, 'SYN_A', false);
    expect(freed.SYN_A).toMatchObject({ fixed: false, fixedX: false, fixedY: false, fixedH: false });
    expect(network.stations.SYN_B?.fixed).toBe(false);
  });

  it('returns the input unchanged for an unknown station', () => {
    const network = buildGnssSampleNetwork();
    expect(setStationFixed(network.stations, 'NOPE', true)).toBe(network.stations);
  });
});

describe('buildGnssSessionInput', () => {
  it('applies control overrides and carries frame identity plus zero setup', () => {
    const network = buildGnssSampleNetwork();
    const input = buildGnssSessionInput(network, {
      fixedOverrides: { SYN_A: false, SYN_B: true },
      setup: { horizontalCenteringSigma: 0, antennaHeightSigma: 0 },
    });
    expect(input.stations.SYN_B).toMatchObject({ fixedX: true, fixedY: true, fixedH: true });
    expect(input.stations.SYN_A).toMatchObject({ fixed: false });
    expect(input.referenceFrame).toBe('SYNTH-WGS84(G2139)');
    expect(input.epoch).toBe('2026.0');
    expect(input.ellipsoid).toBe('WGS84');
    expect(input.setupUncertainty).toEqual({ horizontalCenteringSigma: 0, antennaHeightSigma: 0 });
  });

  it('normalizes nonzero setup sigmas through the backend gate', () => {
    const network = buildGnssSampleNetwork();
    const input = buildGnssSessionInput(network, {
      setup: { horizontalCenteringSigma: 0.002, antennaHeightSigma: 0.003 },
    });
    expect(input.setupUncertainty).toEqual({ horizontalCenteringSigma: 0.002, antennaHeightSigma: 0.003 });
  });
});

describe('runGnssWorkspacePreflight', () => {
  it('passes every gate on the controlled sample', () => {
    const input = buildGnssSessionInput(buildGnssSampleNetwork(), {});
    const preflight = runGnssWorkspacePreflight(input);
    expect(preflight.pass).toBe(true);
    expect(preflight.gates.every((gate) => gate.pass)).toBe(true);
  });

  it('blocks on missing datum control', () => {
    const network = buildGnssSampleNetwork();
    const freed: Record<string, boolean> = {};
    Object.keys(network.stations).forEach((id) => {
      freed[id] = false;
    });
    const preflight = runGnssWorkspacePreflight(buildGnssSessionInput(network, { fixedOverrides: freed }));
    expect(preflight.pass).toBe(false);
    const datum = preflight.gates.find((gate) => gate.id === 'datumValid');
    expect(datum?.pass).toBe(false);
    expect(datum?.message).toMatch(/fully fixed/);
  });

  it('maps an invalid covariance verbatim onto covarianceValid', () => {
    const network = buildGnssSampleNetwork();
    const broken = {
      ...network,
      baselines: network.baselines.map((baseline, index) =>
        index === 0 ? { ...baseline, covariance: { ...baseline.covariance, xx: 0 } } : baseline,
      ),
    };
    const preflight = runGnssWorkspacePreflight(buildGnssSessionInput(broken, {}));
    const gate = preflight.gates.find((entry) => entry.id === 'covarianceValid');
    expect(gate?.pass).toBe(false);
    expect(gate?.message).toMatch(/positive definite|variance/i);
  });

  it('maps an unresolved endpoint onto endpointsResolved', () => {
    const network = buildGnssSampleNetwork();
    const broken = {
      ...network,
      baselines: [{ ...network.baselines[0]!, to: 'GHOST' }],
    };
    const preflight = runGnssWorkspacePreflight(buildGnssSessionInput(broken, {}));
    const gate = preflight.gates.find((entry) => entry.id === 'endpointsResolved');
    expect(gate?.pass).toBe(false);
    expect(gate?.message).toMatch(/GHOST/);
  });

  it('fails setupValid for nonzero setup without an ellipsoid, passes with one', () => {
    const network = buildGnssSampleNetwork();
    const tagless = { ...network, frame: { ...network.frame, ellipsoid: undefined } };
    const setup = { horizontalCenteringSigma: 0.002, antennaHeightSigma: 0 };
    const without = runGnssWorkspacePreflight({
      ...buildGnssSessionInput(tagless, { setup }),
      ellipsoid: undefined,
      baselines: tagless.baselines.map((baseline) => ({ ...baseline, ellipsoid: undefined })),
    });
    expect(without.gates.find((gate) => gate.id === 'setupValid')?.pass).toBe(false);
    const withEllipsoid = runGnssWorkspacePreflight(buildGnssSessionInput(network, { setup }));
    expect(withEllipsoid.gates.find((gate) => gate.id === 'setupValid')?.pass).toBe(true);
    expect(withEllipsoid.pass).toBe(true);
  });
});
