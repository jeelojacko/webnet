import { formatObservationStationsLabel } from './resultDerivedModels';
import { activeMdbOf, primaryExternalOf } from './reliabilityDisplay';
import type { ReliabilitySummary } from './reliabilityPolicy';
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

/**
 * Active run-model MDB for the reliability CSV columns: the statistical MDB
 * when the run model is statistical and the observation carries one, else
 * the legacy compatibility value. Legacy `mdb`/`mdbE`/`mdbN` columns keep
 * the historical legacy value untouched.
 */
const activeMdbNative = (
  obs: Observation,
  summary?: ReliabilitySummary | null,
): number | null => {
  const active = activeMdbOf(obs, summary);
  return Number.isFinite(active) ? active : null;
};

/** Additive Phase 14B reliability columns; empty strings when unavailable. */
const buildReliabilityValueFields = (
  obs: Observation,
  unitScale: number,
  reliabilityHeader: { model: string; alpha: string; power: string; delta0: string },
  summary?: ReliabilitySummary | null,
): {
  reliabilityModel: string;
  reliabilityAlpha: string;
  reliabilityPower: string;
  reliabilityDelta0: string;
  reliabilityMdb: string;
  reliabilityMdbLinearMm: string;
  reliabilityExternalPrimaryMm: string;
  reliabilityExternalAffectedStation: string;
  reliabilityExternalDEmm: string;
  reliabilityExternalDNmm: string;
  reliabilityExternalDHmm: string;
} => {
  const empty = {
    reliabilityModel: reliabilityHeader.model,
    reliabilityAlpha: reliabilityHeader.alpha,
    reliabilityPower: reliabilityHeader.power,
    reliabilityDelta0: reliabilityHeader.delta0,
    reliabilityMdb: '',
    reliabilityMdbLinearMm: '',
    reliabilityExternalPrimaryMm: '',
    reliabilityExternalAffectedStation: '',
    reliabilityExternalDEmm: '',
    reliabilityExternalDNmm: '',
    reliabilityExternalDHmm: '',
  };
  const mdb = activeMdbNative(obs, summary);
  if (mdb != null) {
    empty.reliabilityMdb = isAngularObservation(obs)
      ? formatArcSeconds(mdb)
      : formatLinear(mdb, unitScale);
  }
  empty.reliabilityMdbLinearMm = formatNumber(obs.reliability?.mdbLinearMm, 2);
  const external = primaryExternalOf(obs);
  if (external && external.available === true) {
    empty.reliabilityExternalPrimaryMm = formatNumber(external.primaryMm, 2);
    empty.reliabilityExternalAffectedStation =
      external.affectedStation != null ? String(external.affectedStation) : '';
    empty.reliabilityExternalDEmm = formatNumber(external.dEmm, 2);
    empty.reliabilityExternalDNmm = formatNumber(external.dNmm, 2);
    empty.reliabilityExternalDHmm = formatNumber(external.dHmm, 2);
  }
  return empty;
};

const buildObservationValueFields = (
  obs: Observation,
  unitScale: number,
  reliabilityHeader: { model: string; alpha: string; power: string; delta0: string },
  summary?: ReliabilitySummary | null,
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
  localTestStatistic: string;
  localTestStatisticFamily: string;
  mdbValue: string;
  mdbE: string;
  mdbN: string;
  effectiveDistance: string;
  reliabilityModel: string;
  reliabilityAlpha: string;
  reliabilityPower: string;
  reliabilityDelta0: string;
  reliabilityMdb: string;
  reliabilityMdbLinearMm: string;
  reliabilityExternalPrimaryMm: string;
  reliabilityExternalAffectedStation: string;
  reliabilityExternalDEmm: string;
  reliabilityExternalDNmm: string;
  reliabilityExternalDHmm: string;
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
    localTestStatistic: formatNumber(obs.localTest?.statistic, 3),
    localTestStatisticFamily: obs.localTest?.statisticFamily ?? '',
    mdbValue: '',
    mdbE: formatLinear(obs.mdbComponents?.mE, unitScale),
    mdbN: formatLinear(obs.mdbComponents?.mN, unitScale),
    effectiveDistance: formatLinear(obs.effectiveDistance, unitScale),
    ...buildReliabilityValueFields(obs, unitScale, reliabilityHeader, summary),
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
  'localTestStatistic',
  'localTestStatisticFamily',
  'reliabilityModel',
  'reliabilityAlpha',
  'reliabilityPower',
  'reliabilityDelta0',
  'reliabilityMdb',
  'reliabilityMdbLinearMm',
  'reliabilityExternalPrimaryMm',
  'reliabilityExternalAffectedStation',
  'reliabilityExternalDEmm',
  'reliabilityExternalDNmm',
  'reliabilityExternalDHmm',
] as const;

export const buildObservationsResidualsCsvText = (params: {
  result: AdjustmentResult;
  units: 'm' | 'ft';
  precisionReportingMode?: PrecisionReportingMode;
}): string => {
  const { result, units } = params;
  const unitScale = units === 'ft' ? FT_PER_M : 1;
  const linearUnitLabel = units === 'ft' ? 'ft' : 'm';
  const summary = result.reliabilitySummary;
  const reliabilityHeader = {
    model: summary?.model ?? 'legacy-3.29',
    alpha: summary != null ? String(summary.alpha) : '',
    power: summary != null ? String(summary.power) : '',
    delta0: summary != null && Number.isFinite(summary.delta0) ? summary.delta0.toFixed(3) : '',
  };
  const lines = [csvRow([...OBSERVATIONS_RESIDUALS_CSV_COLUMNS])];

  [...(result.observations ?? [])]
    .sort((a, b) => a.id - b.id)
    .forEach((obs) => {
      const endpoints = observationEndpoints(obs);
      const unitsRow = observationUnits(obs, linearUnitLabel);
      const values = buildObservationValueFields(obs, unitScale, reliabilityHeader, summary);
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
          values.localTestStatistic,
          values.localTestStatisticFamily,
          values.reliabilityModel,
          values.reliabilityAlpha,
          values.reliabilityPower,
          values.reliabilityDelta0,
          values.reliabilityMdb,
          values.reliabilityMdbLinearMm,
          values.reliabilityExternalPrimaryMm,
          values.reliabilityExternalAffectedStation,
          values.reliabilityExternalDEmm,
          values.reliabilityExternalDNmm,
          values.reliabilityExternalDHmm,
        ]),
      );
    });

  return lines.join('\n');
};
