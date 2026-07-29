import { formatObservationStationsLabel } from './resultDerivedModels';
import {
  csvRow,
  formatArcSeconds,
  formatDegrees,
  formatLinear,
  formatNumber,
  FT_PER_M,
} from './browserExportFormatting';
import type { AdjustmentResult, Observation, PrecisionReportingMode } from '../types';

const buildObservationStatus = (obs: Observation): string => {
  const sideshot =
    (typeof obs.calc === 'object' &&
      obs.calc != null &&
      'sideshot' in obs.calc &&
      Boolean((obs.calc as { sideshot?: boolean }).sideshot)) ||
    (obs.type === 'gps' && obs.gpsMode === 'sideshot');
  if (sideshot) return 'post-adjust-only';
  if (obs.planned && obs.calc != null && obs.residual == null) return 'preanalysis';
  if (obs.planned && obs.calc == null && obs.residual == null) return 'planned';
  if (obs.calc != null || obs.residual != null) return 'active';
  return 'inactive';
};

const isAngularObservation = (obs: Observation): boolean =>
  obs.type === 'angle' ||
  obs.type === 'direction' ||
  obs.type === 'bearing' ||
  obs.type === 'dir' ||
  obs.type === 'zenith';

const observationEndpoints = (
  obs: Observation,
): { fromStation: string; atStation: string; toStation: string } => {
  if (obs.type === 'angle') {
    return {
      fromStation: obs.from,
      atStation: obs.at,
      toStation: obs.to,
    };
  }
  if (obs.type === 'direction') {
    return {
      fromStation: '',
      atStation: obs.at,
      toStation: obs.to,
    };
  }
  if ('from' in obs && 'to' in obs) {
    return {
      fromStation: obs.from,
      atStation: '',
      toStation: obs.to,
    };
  }
  return {
    fromStation: '',
    atStation: '',
    toStation: '',
  };
};

const observationMode = (obs: Observation): string => {
  if (obs.type === 'dist') return obs.mode ?? '';
  if (obs.type === 'gps') return obs.gpsMode ?? '';
  return '';
};

const observationUnits = (
  obs: Observation,
  linearUnitLabel: string,
): { observedUnit: string; residualUnit: string; sigmaUnit: string } => {
  if (obs.type === 'gps') {
    return {
      observedUnit: `${linearUnitLabel} (${linearUnitLabel} E/${linearUnitLabel} N)`,
      residualUnit: `${linearUnitLabel} (${linearUnitLabel} E/${linearUnitLabel} N)`,
      sigmaUnit: linearUnitLabel,
    };
  }
  if (isAngularObservation(obs)) {
    return {
      observedUnit: 'deg',
      residualUnit: 'arcsec',
      sigmaUnit: 'arcsec',
    };
  }
  return {
    observedUnit: linearUnitLabel,
    residualUnit: linearUnitLabel,
    sigmaUnit: linearUnitLabel,
  };
};

const buildObservationValueFields = (
  obs: Observation,
  unitScale: number,
): {
  observedValue: string;
  observedDeltaE: string;
  observedDeltaN: string;
  calculatedValue: string;
  calculatedDeltaE: string;
  calculatedDeltaN: string;
  residualValue: string;
  residualDeltaE: string;
  residualDeltaN: string;
  stdDevValue: string;
  stdDevE: string;
  stdDevN: string;
  corrEN: string;
  redundancyValue: string;
  redundancyE: string;
  redundancyN: string;
  stdResValue: string;
  stdResE: string;
  stdResN: string;
  localTestPass: string;
  localTestCritical: string;
  localTestPassE: string;
  localTestPassN: string;
  mdbValue: string;
  mdbE: string;
  mdbN: string;
  effectiveDistance: string;
} => {
  const base = {
    observedValue: '',
    observedDeltaE: '',
    observedDeltaN: '',
    calculatedValue: '',
    calculatedDeltaE: '',
    calculatedDeltaN: '',
    residualValue: '',
    residualDeltaE: '',
    residualDeltaN: '',
    stdDevValue: '',
    stdDevE: '',
    stdDevN: '',
    corrEN: '',
    redundancyValue: '',
    redundancyE: '',
    redundancyN: '',
    stdResValue: formatNumber(obs.stdRes, 3),
    stdResE: formatNumber(obs.stdResComponents?.tE, 3),
    stdResN: formatNumber(obs.stdResComponents?.tN, 3),
    localTestPass:
      typeof obs.localTest?.pass === 'boolean' ? String(obs.localTest.pass) : '',
    localTestCritical: formatNumber(obs.localTest?.critical, 3),
    localTestPassE:
      typeof obs.localTestComponents?.passE === 'boolean'
        ? String(obs.localTestComponents.passE)
        : '',
    localTestPassN:
      typeof obs.localTestComponents?.passN === 'boolean'
        ? String(obs.localTestComponents.passN)
        : '',
    mdbValue: '',
    mdbE: formatLinear(obs.mdbComponents?.mE, unitScale),
    mdbN: formatLinear(obs.mdbComponents?.mN, unitScale),
    effectiveDistance: formatLinear(obs.effectiveDistance, unitScale),
  };

  if (obs.type === 'gps') {
    return {
      ...base,
      observedDeltaE: formatLinear(obs.obs.dE, unitScale),
      observedDeltaN: formatLinear(obs.obs.dN, unitScale),
      calculatedDeltaE: formatLinear(obs.calc?.dE, unitScale),
      calculatedDeltaN: formatLinear(obs.calc?.dN, unitScale),
      residualDeltaE: formatLinear(obs.residual?.vE, unitScale),
      residualDeltaN: formatLinear(obs.residual?.vN, unitScale),
      stdDevE: formatLinear(obs.weightingStdDevE ?? obs.stdDevE, unitScale),
      stdDevN: formatLinear(obs.weightingStdDevN ?? obs.stdDevN, unitScale),
      corrEN: formatNumber(obs.corrEN, 6),
      redundancyE: formatNumber(
        typeof obs.redundancy === 'object' ? obs.redundancy.rE : null,
        3,
      ),
      redundancyN: formatNumber(
        typeof obs.redundancy === 'object' ? obs.redundancy.rN : null,
        3,
      ),
    };
  }

  const scalarObserved = 'obs' in obs && typeof obs.obs === 'number' ? obs.obs : null;
  const scalarCalculated = typeof obs.calc === 'number' ? obs.calc : null;
  const scalarResidual = typeof obs.residual === 'number' ? obs.residual : null;
  const isAngular = isAngularObservation(obs);

  return {
    ...base,
    observedValue: isAngular ? formatDegrees(scalarObserved) : formatLinear(scalarObserved, unitScale),
    calculatedValue: isAngular
      ? formatDegrees(scalarCalculated)
      : formatLinear(scalarCalculated, unitScale),
    residualValue: isAngular
      ? formatArcSeconds(scalarResidual)
      : formatLinear(scalarResidual, unitScale),
    stdDevValue: isAngular
      ? formatArcSeconds(obs.weightingStdDev ?? obs.stdDev)
      : formatLinear(obs.weightingStdDev ?? obs.stdDev, unitScale),
    redundancyValue:
      typeof obs.redundancy === 'number' ? formatNumber(obs.redundancy, 3) : '',
    mdbValue: isAngular ? formatArcSeconds(obs.mdb) : formatLinear(obs.mdb, unitScale),
  };
};

export const OBSERVATIONS_RESIDUALS_CSV_COLUMNS = [
  'obsId',
  'status',
  'type',
  'stations',
  'sourceLine',
  'sourceFile',
  'instCode',
  'setId',
  'planned',
  'sigmaSource',
  'mode',
  'fromStation',
  'atStation',
  'toStation',
  'observedValue',
  'observedDeltaE',
  'observedDeltaN',
  'calculatedValue',
  'calculatedDeltaE',
  'calculatedDeltaN',
  'residualValue',
  'residualDeltaE',
  'residualDeltaN',
  'stdDev',
  'stdDevE',
  'stdDevN',
  'corrEN',
  'stdRes',
  'stdResE',
  'stdResN',
  'redundancy',
  'redundancyE',
  'redundancyN',
  'localTestPass',
  'localTestCritical',
  'localTestPassE',
  'localTestPassN',
  'mdb',
  'mdbE',
  'mdbN',
  'effectiveDistance',
  'observedUnit',
  'residualUnit',
  'sigmaUnit',
] as const;

export const buildObservationsResidualsCsvText = (params: {
  result: AdjustmentResult;
  units: 'm' | 'ft';
  precisionReportingMode?: PrecisionReportingMode;
}): string => {
  const { result, units } = params;
  const unitScale = units === 'ft' ? FT_PER_M : 1;
  const linearUnitLabel = units === 'ft' ? 'ft' : 'm';
  const lines = [csvRow([...OBSERVATIONS_RESIDUALS_CSV_COLUMNS])];

  [...(result.observations ?? [])]
    .sort((a, b) => a.id - b.id)
    .forEach((obs) => {
      const endpoints = observationEndpoints(obs);
      const unitsRow = observationUnits(obs, linearUnitLabel);
      const values = buildObservationValueFields(obs, unitScale);
      lines.push(
        csvRow([
          obs.id,
          buildObservationStatus(obs),
          obs.type,
          formatObservationStationsLabel(obs),
          obs.sourceLine ?? '',
          obs.sourceFile ?? '',
          obs.instCode,
          obs.setId ?? '',
          obs.planned === true,
          obs.sigmaSource ?? '',
          observationMode(obs),
          endpoints.fromStation,
          endpoints.atStation,
          endpoints.toStation,
          values.observedValue,
          values.observedDeltaE,
          values.observedDeltaN,
          values.calculatedValue,
          values.calculatedDeltaE,
          values.calculatedDeltaN,
          values.residualValue,
          values.residualDeltaE,
          values.residualDeltaN,
          values.stdDevValue,
          values.stdDevE,
          values.stdDevN,
          values.corrEN,
          values.stdResValue,
          values.stdResE,
          values.stdResN,
          values.redundancyValue,
          values.redundancyE,
          values.redundancyN,
          values.localTestPass,
          values.localTestCritical,
          values.localTestPassE,
          values.localTestPassN,
          values.mdbValue,
          values.mdbE,
          values.mdbN,
          values.effectiveDistance,
          unitsRow.observedUnit,
          unitsRow.residualUnit,
          unitsRow.sigmaUnit,
        ]),
      );
    });

  return lines.join('\n');
};
