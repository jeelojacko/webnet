/**
 * Phase 12G — pure static-GNSS workspace session helpers (no React).
 *
 * Thin product layer over the production backend: import summary,
 * full-XYZ control toggles, session-input assembly, and fail-closed
 * preflight gates. No math, no recomputation — every gate surfaces the
 * existing backend error verbatim.
 */
import type { StationMap } from '../types';
import type { GnssBaselineAdjustInput } from './gnssBaselineAdjust';
import { validateGnssBaselineCovariance } from './gnssBaselineCovariance';
import type {
  GnssBaselineNetworkInput,
  GnssDiagnostic,
} from './gnssBaselineNetworkImport';
import { gnssBaselineComponents, runGnssBaselinePreflight } from './gnssBaselinePreflight';
import {
  classifyGnssDatumComponents,
  GNSS_FREE_EXTRA_RANK_DEFECT,
  GNSS_FREE_NETWORK_MAX_STATIONS,
  GNSS_FREE_NETWORK_SIZE_LIMIT,
  isFullyFixedStation,
  type GnssDatumMode,
} from './gnssFreeNetwork';
import {
  checkGnssSetupReadiness,
  isGnssSetupActive,
  normalizeGnssSetupUncertainty,
  type GnssSetupUncertainty,
} from './gnssBaselineSetupUncertainty';
import type { GvxSourceMetadata } from './gnssGvxSyntax';

export type GnssImportFormat = 'gvx' | 'delimited' | 'sample' | 'unknown';

export interface GnssImportSummary {
  readonly format: GnssImportFormat;
  readonly sourceFile: string;
  readonly referenceFrame: string;
  readonly epoch: string;
  readonly ellipsoid: string;
  readonly adjustmentFrame: 'ECEF';
  readonly stationCount: number;
  readonly fixedStationCount: number;
  readonly freeStationCount: number;
  readonly baselineCount: number;
  readonly componentCount: number;
  readonly covarianceSource: string;
  readonly covarianceRepresentation: string;
  readonly warnings: string[];
}

const GNSS_UNKNOWN_METADATA = 'unknown';

const textOrUnknown = (value: string | undefined): string => {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? GNSS_UNKNOWN_METADATA : trimmed;
};

const isFullyFixed = (stations: StationMap, id: string): boolean => {
  const station = stations[id];
  return !!station && !!station.fixedX && !!station.fixedY && !!station.fixedH;
};

/**
 * Summarize an imported network for the workspace header. Absent metadata
 * renders as 'unknown' — never invented. Counts come from
 * gnssBaselineComponents so connectivity matches the backend.
 */
export const summarizeGnssImport = (
  network: GnssBaselineNetworkInput,
  diagnostics: readonly GnssDiagnostic[],
  source: GvxSourceMetadata | { format: GnssImportFormat; sourceFile?: string } | null,
  format: GnssImportFormat = 'unknown',
): GnssImportSummary => {
  const stationIds = Object.keys(network.stations);
  const fixedStationCount = stationIds.filter((id) => isFullyFixed(network.stations, id)).length;
  const forms = new Set(network.provenance.map((entry) => entry.stochasticForm));
  const resolvedFormat =
    source != null && 'version' in source
      ? 'gvx'
      : 'format' in (source ?? {})
        ? (source as { format: GnssImportFormat }).format
        : format;
  return {
    format: resolvedFormat,
    sourceFile:
      network.sourceFile ??
      (source != null && 'sourceFile' in source ? String(source.sourceFile ?? '') : '') ??
      GNSS_UNKNOWN_METADATA,
    referenceFrame: textOrUnknown(network.frame.referenceFrame),
    epoch: textOrUnknown(network.frame.epoch),
    ellipsoid: textOrUnknown(network.frame.ellipsoid),
    adjustmentFrame: 'ECEF',
    stationCount: stationIds.length,
    fixedStationCount,
    freeStationCount: stationIds.length - fixedStationCount,
    baselineCount: network.baselines.length,
    componentCount: gnssBaselineComponents(network.baselines).length,
    covarianceSource: forms.size === 0 ? GNSS_UNKNOWN_METADATA : [...forms].sort().join('+'),
    covarianceRepresentation: 'full 3x3 correlated covariance',
    warnings: diagnostics
      .filter((entry) => entry.severity === 'warning')
      .map((entry) => entry.message),
  };
};

/**
 * Toggle full-XYZ control for one station. Fixed sets fixed + fixedX +
 * fixedY + fixedH together; freeing clears all four. Partial constraints
 * are not representable — full-XYZ only.
 */
export const setStationFixed = (
  stations: StationMap,
  id: string,
  fixed: boolean,
): StationMap => {
  const current = stations[id];
  if (!current) return stations;
  return {
    ...stations,
    [id]: { ...current, fixed, fixedX: fixed, fixedY: fixed, fixedH: fixed },
  };
};

export interface GnssSessionInputOptions {
  readonly fixedOverrides?: Readonly<Record<string, boolean>>;
  readonly setup?: GnssSetupUncertainty;
  readonly datumMode?: GnssDatumMode;
}

/**
 * Assemble a production adjust input from a network: reference
 * frame/epoch/ellipsoid flow from network.frame, control overrides apply
 * full-XYZ, and setup sigmas normalize through the backend gate.
 */
export const buildGnssSessionInput = (
  network: GnssBaselineNetworkInput,
  options: GnssSessionInputOptions = {},
): GnssBaselineAdjustInput => {
  let stations: StationMap = Object.fromEntries(
    Object.entries(network.stations).map(([id, station]) => [id, { ...station }]),
  );
  const overrides = options.fixedOverrides ?? {};
  Object.keys(overrides)
    .sort()
    .forEach((id) => {
      stations = setStationFixed(stations, id, overrides[id] ?? false);
    });
  return {
    stations,
    baselines: network.baselines.map((baseline) => ({ ...baseline })),
    referenceFrame: network.frame.referenceFrame,
    epoch: network.frame.epoch,
    ellipsoid: network.frame.ellipsoid,
    setupUncertainty: normalizeGnssSetupUncertainty(options.setup),
    datumMode: options.datumMode ?? 'constrained',
  };
};

export type GnssPreflightGateId =
  | 'ecefFrame'
  | 'covarianceValid'
  | 'endpointsResolved'
  | 'connectivityValid'
  | 'datumValid'
  | 'setupValid'
  | 'frameEllipsoidAdequate';

export interface GnssPreflightGate {
  readonly id: GnssPreflightGateId;
  readonly pass: boolean;
  readonly message: string;
}

export interface GnssWorkspacePreflight {
  readonly gates: GnssPreflightGate[];
  readonly warnings: string[];
  readonly pass: boolean;
}

const gate = (id: GnssPreflightGateId, pass: boolean, message: string): GnssPreflightGate => ({
  id,
  pass,
  message,
});

const firstError = (messages: string[]): string | null =>
  messages.length > 0 ? (messages[0] as string) : null;

/** 1-based deterministic component numbers of the uncontrolled components. */
const uncontrolledComponentNumbers = (
  stations: StationMap,
  baselines: GnssBaselineAdjustInput['baselines'],
): number[] => {
  const classification = classifyGnssDatumComponents(stations, baselines);
  const freeSet = new Set(classification.freeComponents.map((component) => component[0] as string));
  const numbers: number[] = [];
  classification.components.forEach((component, index) => {
    if (freeSet.has(component[0] as string)) numbers.push(index + 1);
  });
  return numbers;
};

const describeMissingDatum = (input: GnssBaselineAdjustInput): string => {
  const numbers = uncontrolledComponentNumbers(input.stations, input.baselines);
  const head =
    numbers.length > 0
      ? numbers.map((n) => `Component ${n} has no fixed XYZ control.`).join(' ')
      : 'A component has no fixed XYZ control.';
  return (
    `${head} Choose a real control station, or explicitly select ` +
    "'Allow free components' if a free-network adjustment is intended."
  );
};

/**
 * Allow-free datum/connectivity gates: uncontrolled components pass as free
 * (inner-constrained datum, defect 3 each); size/extra-rank defects still
 * block via datumValid, and non-datum backend errors block connectivity.
 */
const pushFreeDatumGates = (
  input: GnssBaselineAdjustInput,
  backendError: string | null,
  gates: GnssPreflightGate[],
): void => {
  if (backendError == null) {
    gates.push(gate('connectivityValid', true, 'Network connectivity is valid.'));
  } else if (/no fully fixed|free-network|uncontrolled/i.test(backendError)) {
    gates.push(gate('connectivityValid', true, 'Network connectivity is valid.'));
  } else if (/disagree on declared frame|does not match session|frame/i.test(backendError)) {
    gates.push(gate('connectivityValid', false, backendError));
    gates.push(gate('datumValid', true, 'Datum control is valid: every component has a fully fixed 3D station.'));
    return;
  } else {
    gates.push(gate('connectivityValid', false, backendError));
    gates.push(gate('datumValid', false, backendError));
    return;
  }
  const classification = classifyGnssDatumComponents(input.stations, input.baselines);
  const totalStations = Object.keys(input.stations).length;
  if (classification.freeComponents.length > 0 && totalStations > GNSS_FREE_NETWORK_MAX_STATIONS) {
    gates.push(
      gate(
        'datumValid',
        false,
        `${GNSS_FREE_NETWORK_SIZE_LIMIT}: free network has ${totalStations} stations ` +
          `(certified max ${GNSS_FREE_NETWORK_MAX_STATIONS}; fail-closed).`,
      ),
    );
    return;
  }
  const partial = Object.keys(input.stations)
    .sort()
    .find((stationId) => {
      const station = input.stations[stationId];
      const flags = [station?.fixedX, station?.fixedY, station?.fixedH].map((flag) => !!flag);
      return flags.some(Boolean) && flags.some((flag) => !flag);
    });
  if (partial !== undefined) {
    gates.push(
      gate(
        'datumValid',
        false,
        `${GNSS_FREE_EXTRA_RANK_DEFECT}: station '${partial}' carries partial XYZ control ` +
          '(free-network datum requires full-XYZ or nothing; fail-closed).',
      ),
    );
    return;
  }
  const edged = new Set(classification.components.flat());
  const isolated = Object.keys(input.stations)
    .filter((stationId) => !edged.has(stationId) && !isFullyFixedStation(input.stations, stationId))
    .sort();
  if (isolated.length > 0) {
    gates.push(
      gate(
        'datumValid',
        false,
        `${GNSS_FREE_EXTRA_RANK_DEFECT}: unobserved free stations [${isolated.join(', ')}] ` +
          'leave the gauged system rank-deficient (fail-closed).',
      ),
    );
    return;
  }
  if (classification.freeComponents.length === 0) {
    gates.push(gate('datumValid', true, 'Datum control is valid: every component has a fully fixed 3D station.'));
    return;
  }
  const freeSet = new Set(classification.freeComponents.map((component) => component[0] as string));
  const notes: string[] = [];
  classification.components.forEach((component, index) => {
    if (freeSet.has(component[0] as string)) {
      notes.push(
        `Component ${index + 1} [${component.join(', ')}] has no fixed XYZ control ` +
          'and will solve as a free network (inner-constrained datum, datum defect 3).',
      );
    }
  });
  gates.push(gate('datumValid', true, notes.join(' ')));
};

/**
 * Fail-closed workspace preflight: independent structural gates plus the
 * backend preflight mapped verbatim onto datum/connectivity. All gates run
 * even after a failure so the operator sees every defect at once.
 *
 * datumMode selects the datum gate only (never auto-switched):
 * 'constrained' (default) blocks every uncontrolled component; 'allow-free'
 * passes uncontrolled components as free networks (inner-constrained datum,
 * defect 3 each) while size/extra-rank/covariance/frame still block.
 */
export const runGnssWorkspacePreflight = (
  input: GnssBaselineAdjustInput,
  datumMode?: GnssDatumMode,
): GnssWorkspacePreflight => {
  const mode: GnssDatumMode = datumMode ?? input.datumMode ?? 'constrained';
  const gates: GnssPreflightGate[] = [];
  const warnings: string[] = [];

  const nonEcef = input.baselines.filter((baseline) => baseline.frame !== 'ecef');
  gates.push(
    nonEcef.length === 0
      ? gate('ecefFrame', true, 'All baselines declare ECEF vectors.')
      : gate(
          'ecefFrame',
          false,
          `Unsupported frame: ${nonEcef.length} baseline(s) are not ECEF (e.g. '${nonEcef[0]?.frame}'). Only ECEF vectors adjust.`,
        ),
  );

  const covarianceErrors: string[] = [];
  input.baselines.forEach((baseline) => {
    try {
      validateGnssBaselineCovariance(baseline.covariance, `${baseline.from}->${baseline.to}`);
    } catch (failure) {
      covarianceErrors.push(failure instanceof Error ? failure.message : String(failure));
    }
  });
  const covarianceError = firstError(covarianceErrors);
  gates.push(
    covarianceError == null
      ? gate('covarianceValid', true, 'All baseline covariances are valid (symmetric positive-definite).')
      : gate('covarianceValid', false, covarianceError),
  );

  const endpointErrors: string[] = [];
  input.baselines.forEach((baseline) => {
    if (!input.stations[baseline.from]) {
      endpointErrors.push(`Baseline ${baseline.from}->${baseline.to} references unresolved FROM station '${baseline.from}'.`);
    }
    if (!input.stations[baseline.to]) {
      endpointErrors.push(`Baseline ${baseline.from}->${baseline.to} references unresolved TO station '${baseline.to}'.`);
    }
  });
  const endpointError = firstError(endpointErrors);
  gates.push(
    endpointError == null
      ? gate('endpointsResolved', true, 'All baseline endpoints resolve to known stations.')
      : gate('endpointsResolved', false, endpointError),
  );

  let backendError: string | null = null;
  try {
    runGnssBaselinePreflight({
      stations: input.stations,
      baselines: input.baselines,
      referenceFrame: input.referenceFrame,
      epoch: input.epoch,
      ellipsoid: input.ellipsoid,
    });
  } catch (failure) {
    backendError = failure instanceof Error ? failure.message : String(failure);
  }
  if (mode === 'allow-free') {
    pushFreeDatumGates(input, backendError, gates);
  } else if (backendError == null) {
    gates.push(gate('connectivityValid', true, 'Network connectivity is valid.'));
    gates.push(gate('datumValid', true, 'Datum control is valid: every component has a fully fixed 3D station.'));
  } else if (/no fully fixed|free-network|uncontrolled/i.test(backendError)) {
    gates.push(gate('connectivityValid', true, 'Network connectivity is valid.'));
    gates.push(gate('datumValid', false, describeMissingDatum(input)));
  } else if (/disagree on declared frame|does not match session|frame/i.test(backendError)) {
    gates.push(gate('connectivityValid', false, backendError));
    gates.push(gate('datumValid', true, 'Datum control is valid: every component has a fully fixed 3D station.'));
  } else {
    gates.push(gate('connectivityValid', false, backendError));
    gates.push(gate('datumValid', false, backendError));
  }

  let setupGate = gate('setupValid', true, 'Setup uncertainty is valid (defaults 0 m: no augmentation).');
  try {
    const normalized = normalizeGnssSetupUncertainty(input.setupUncertainty);
    if (isGnssSetupActive(normalized)) {
      const problems = checkGnssSetupReadiness({
        stations: input.stations,
        baselines: input.baselines,
        setup: input.setupUncertainty,
        ellipsoid: input.ellipsoid,
      });
      const problem = firstError(problems.map((entry) => entry.message));
      setupGate =
        problem == null
          ? gate(
              'setupValid',
              true,
              `Setup uncertainty is valid: centering=${normalized.horizontalCenteringSigma} m, height=${normalized.antennaHeightSigma} m (augments, never replaces, raw covariance).`,
            )
          : gate('setupValid', false, problem);
    }
  } catch (failure) {
    setupGate = gate('setupValid', false, failure instanceof Error ? failure.message : String(failure));
  }
  gates.push(setupGate);

  const ellipsoid = (input.ellipsoid ?? '').trim();
  const ellipsoidDeclared = ellipsoid !== '' && ellipsoid.toLowerCase() !== 'unset';
  let setupActiveForEllipsoid = false;
  try {
    setupActiveForEllipsoid = isGnssSetupActive(normalizeGnssSetupUncertainty(input.setupUncertainty));
  } catch {
    setupActiveForEllipsoid = false;
  }
  gates.push(
    ellipsoidDeclared || !setupActiveForEllipsoid
      ? gate(
          'frameEllipsoidAdequate',
          true,
          ellipsoidDeclared
            ? `Ellipsoid '${ellipsoid}' is declared for endpoint orientation.`
            : 'No ellipsoid declared; harmless with zero setup (needed only for nonzero setup orientation).',
        )
      : gate(
          'frameEllipsoidAdequate',
          false,
          'No ellipsoid is declared: nonzero setup sigmas need an ellipsoid for endpoint orientation.',
        ),
  );

  const endpointCounts = new Map<string, number>();
  input.baselines.forEach((baseline) => {
    const key = `${baseline.from}->${baseline.to}`;
    endpointCounts.set(key, (endpointCounts.get(key) ?? 0) + 1);
  });
  endpointCounts.forEach((count, key) => {
    if (count > 1) warnings.push(`Endpoints ${key} appear in ${count} independent solutions (kept distinct).`);
  });
  if ((input.referenceFrame ?? '').trim() === '') warnings.push('Reference frame tag is missing; report will show unknown.');
  if ((input.epoch ?? '').trim() === '') warnings.push('Epoch tag is missing; report will show unknown.');
  if (ellipsoid === '' || ellipsoid.toLowerCase() === 'unset') {
    warnings.push('Ellipsoid tag is missing; report will show unknown.');
  }
  try {
    const normalized = normalizeGnssSetupUncertainty(input.setupUncertainty);
    if (isGnssSetupActive(normalized)) {
      warnings.push('Nonzero setup uncertainty stays on the TypeScript dense path (backend tripwire); solve remains valid.');
    }
  } catch {
    // Invalid setup already fails the setup gate; no extra warning.
  }

  return { gates, warnings, pass: gates.every((entry) => entry.pass) };
};

export { GNSS_UNKNOWN_METADATA };
