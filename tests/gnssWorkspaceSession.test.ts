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

describe('datumMode (Phase 12I.2)', () => {
  it("defaults to constrained and passes datumMode through to the adjust input", () => {
    const network = buildGnssSampleNetwork();
    expect(buildGnssSessionInput(network, {}).datumMode).toBe('constrained');
    expect(buildGnssSessionInput(network, { datumMode: 'allow-free' }).datumMode).toBe('allow-free');
  });

  it('constrained missing-datum message names the component and the opt-in', () => {
    const network = buildGnssSampleNetwork();
    const freed: Record<string, boolean> = {};
    Object.keys(network.stations).forEach((id) => {
      freed[id] = false;
    });
    const preflight = runGnssWorkspacePreflight(buildGnssSessionInput(network, { fixedOverrides: freed }));
    expect(preflight.pass).toBe(false);
    const datum = preflight.gates.find((gate) => gate.id === 'datumValid');
    expect(datum?.pass).toBe(false);
    expect(datum?.message).toMatch(/Component 1 has no fixed XYZ control/);
    expect(datum?.message).toMatch(/Allow free components/);
  });

  it('allow-free passes an uncontrolled component as free with datum defect 3', () => {
    const network = buildGnssSampleNetwork();
    const freed: Record<string, boolean> = {};
    Object.keys(network.stations).forEach((id) => {
      freed[id] = false;
    });
    const input = buildGnssSessionInput(network, { fixedOverrides: freed, datumMode: 'allow-free' });
    const preflight = runGnssWorkspacePreflight(input, 'allow-free');
    expect(preflight.pass).toBe(true);
    const datum = preflight.gates.find((gate) => gate.id === 'datumValid');
    expect(datum?.pass).toBe(true);
    expect(datum?.message).toMatch(/Component 1/);
    expect(datum?.message).toMatch(/datum defect 3/);
  });

  it('allow-free resolves the mode from the input when no explicit mode is passed', () => {
    const network = buildGnssSampleNetwork();
    const freed: Record<string, boolean> = {};
    Object.keys(network.stations).forEach((id) => {
      freed[id] = false;
    });
    const preflight = runGnssWorkspacePreflight(
      buildGnssSessionInput(network, { fixedOverrides: freed, datumMode: 'allow-free' }),
    );
    expect(preflight.pass).toBe(true);
  });

  it('allow-free with all components constrained uses the ordinary constrained gate', () => {
    const input = buildGnssSessionInput(buildGnssSampleNetwork(), { datumMode: 'allow-free' });
    const preflight = runGnssWorkspacePreflight(input, 'allow-free');
    expect(preflight.pass).toBe(true);
    expect(preflight.gates.find((gate) => gate.id === 'datumValid')?.message).toMatch(
      /every component has a fully fixed 3D station/,
    );
  });

  it('allow-free still blocks an invalid covariance', () => {
    const network = buildGnssSampleNetwork();
    const broken = {
      ...network,
      baselines: network.baselines.map((baseline, index) =>
        index === 0 ? { ...baseline, covariance: { ...baseline.covariance, xx: 0 } } : baseline,
      ),
    };
    const preflight = runGnssWorkspacePreflight(
      buildGnssSessionInput(broken, { datumMode: 'allow-free' }),
      'allow-free',
    );
    expect(preflight.pass).toBe(false);
    expect(preflight.gates.find((entry) => entry.id === 'covarianceValid')?.pass).toBe(false);
  });

  it('allow-free blocks an over-cap free network with FREE_NETWORK_SIZE_LIMIT', () => {
    const network = buildGnssSampleNetwork();
    const template = network.stations.SYN_A ?? Object.values(network.stations)[0];
    const stations = { ...network.stations };
    for (let index = 0; index < 260; index += 1) {
      stations[`PAD_${index}`] = { ...template, fixed: false, fixedX: false, fixedY: false, fixedH: false };
    }
    const freed: Record<string, boolean> = {};
    Object.keys(stations).forEach((id) => {
      freed[id] = false;
    });
    const preflight = runGnssWorkspacePreflight(
      buildGnssSessionInput({ ...network, stations }, { fixedOverrides: freed, datumMode: 'allow-free' }),
      'allow-free',
    );
    expect(preflight.pass).toBe(false);
    const datum = preflight.gates.find((gate) => gate.id === 'datumValid');
    expect(datum?.pass).toBe(false);
    expect(datum?.message).toMatch(/FREE_NETWORK_SIZE_LIMIT/);
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
    expect(datum?.message).toMatch(/has no fixed XYZ control/);
    expect(datum?.message).toMatch(/Allow free components/);
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
