import { RAD_TO_DEG } from './angles';
import { buildResultTraceabilityModel } from './resultDerivedModels';
import type { ParseSettings, RunDiagnostics, SettingsState } from '../appStateTypes';
import type { AdjustmentResult, Observation } from '../types';

export const FT_PER_M = 3.280839895;

type BuildRunDiagnostics = (_base: ParseSettings, _solved?: AdjustmentResult) => RunDiagnostics;

export type RunResultsDataCheckDiffRow = {
  obs: Observation;
  stations: string;
  diff: number;
  label: string;
};

export const prepareRunResultsTextContext = ({
  res,
  settings,
  parseSettings,
  runDiagnostics,
  buildRunDiagnostics,
}: {
  res: AdjustmentResult;
  settings: SettingsState;
  parseSettings: ParseSettings;
  runDiagnostics: RunDiagnostics | null;
  buildRunDiagnostics: BuildRunDiagnostics;
}) => {
  const linearUnit = settings.units === 'ft' ? 'ft' : 'm';
  const unitScale = settings.units === 'ft' ? FT_PER_M : 1;
  const runDiag = runDiagnostics ?? buildRunDiagnostics(parseSettings, res);
  const traceabilityModel = buildResultTraceabilityModel(res.parseState);
  const aliasTrace = traceabilityModel.aliasTrace;
  const descriptionReconcileMode =
    res.parseState?.descriptionReconcileMode ??
    traceabilityModel.descriptionReconcileMode ??
    parseSettings.descriptionReconcileMode;
  const descriptionAppendDelimiter =
    res.parseState?.descriptionAppendDelimiter ??
    traceabilityModel.descriptionAppendDelimiter ??
    parseSettings.descriptionAppendDelimiter;
  const reconciledDescriptions = traceabilityModel.reconciledDescriptions;
  const stationDescription = (stationId: string): string =>
    reconciledDescriptions[stationId] ?? '';
  const aliasObsRefsByLine = new Map<number, string[]>();
  aliasTrace.forEach((entry) => {
    if (entry.context !== 'observation') return;
    if (entry.sourceLine == null) return;
    const ref = `${entry.sourceId}->${entry.canonicalId}`;
    const list = aliasObsRefsByLine.get(entry.sourceLine) ?? [];
    if (!list.includes(ref)) list.push(ref);
    aliasObsRefsByLine.set(entry.sourceLine, list);
  });
  const aliasRefsForLine = (line?: number): string =>
    line != null && aliasObsRefsByLine.has(line)
      ? ` [alias ${aliasObsRefsByLine.get(line)?.join(', ')}]`
      : '';
  const showLostStationsInOutputs = settings.listingShowLostStations;
  const isVisibleStation = (stationId: string): boolean => {
    const station = res.stations[stationId];
    if (!station) return true;
    return showLostStationsInOutputs || !station.lost;
  };
  const outputStationEntries = Object.entries(res.stations).filter(([stationId]) =>
    isVisibleStation(stationId),
  );
  const observationStationIds = (obs: Observation): string[] => {
    if ('at' in obs && 'from' in obs && 'to' in obs) return [obs.at, obs.from, obs.to];
    if ('at' in obs && 'to' in obs) return [obs.at, obs.to];
    if ('from' in obs && 'to' in obs) return [obs.from, obs.to];
    return [];
  };
  const outputObservations = res.observations.filter((obs) =>
    observationStationIds(obs).every((stationId) => isVisibleStation(stationId)),
  );
  const outputRelativePrecision = (res.relativePrecision ?? []).filter(
    (rel) => isVisibleStation(rel.from) && isVisibleStation(rel.to),
  );
  const outputStationCovariances = (res.stationCovariances ?? []).filter((row) =>
    isVisibleStation(row.stationId),
  );
  const outputRelativeCovariances = (res.relativeCovariances ?? []).filter(
    (row) => isVisibleStation(row.from) && isVisibleStation(row.to),
  );
  const outputSideshots = (res.sideshots ?? []).filter(
    (ss) => isVisibleStation(ss.from) && isVisibleStation(ss.to),
  );
  const outputTsSideshots = outputSideshots.filter((ss) => ss.mode !== 'gps');
  const outputGpsSideshots = outputSideshots.filter((ss) => ss.mode === 'gps');
  const outputGpsVectorSideshots = outputGpsSideshots.filter((ss) => ss.sourceType !== 'GS');
  const outputGpsCoordinateSideshots = outputGpsSideshots.filter((ss) => ss.sourceType === 'GS');
  const gpsLoopDiagnostics = res.gpsLoopDiagnostics;
  const isPreanalysis = res.preanalysisMode === true;
  const runModeProfileText =
    runDiag.runMode === 'preanalysis'
      ? `PREANALYSIS(planned=${runDiag.plannedObservationCount})`
      : runDiag.runMode.toUpperCase();
  const runModeSummaryText =
    runDiag.runMode === 'preanalysis'
      ? `PREANALYSIS (planned observations=${runDiag.plannedObservationCount})`
      : runDiag.runMode.toUpperCase();
  const isDataCheckMode = runDiag.runMode === 'data-check';
  const isBlunderDetectMode = runDiag.runMode === 'blunder-detect';
  const dataCheckDiffRows = isDataCheckMode
    ? outputObservations
        .map((obs) => buildDataCheckDiffRow(obs, unitScale, linearUnit))
        .filter((row): row is RunResultsDataCheckDiffRow => row != null)
        .sort((a, b) => b.diff - a.diff)
        .slice(0, 25)
    : [];

  return {
    linearUnit,
    unitScale,
    runDiag,
    traceabilityModel,
    aliasTrace,
    descriptionReconcileMode,
    descriptionAppendDelimiter,
    stationDescription,
    aliasRefsForLine,
    showLostStationsInOutputs,
    outputStationEntries,
    outputObservations,
    outputRelativePrecision,
    outputStationCovariances,
    outputRelativeCovariances,
    outputSideshots,
    outputTsSideshots,
    outputGpsSideshots,
    outputGpsVectorSideshots,
    outputGpsCoordinateSideshots,
    gpsLoopDiagnostics,
    isPreanalysis,
    runModeProfileText,
    runModeSummaryText,
    isDataCheckMode,
    isBlunderDetectMode,
    dataCheckDiffRows,
  };
};

export type RunResultsTextContext = ReturnType<typeof prepareRunResultsTextContext>;

const buildDataCheckDiffRow = (
  obs: Observation,
  unitScale: number,
  linearUnit: string,
): RunResultsDataCheckDiffRow | null => {
  if (
    obs.type === 'dist' ||
    obs.type === 'lev' ||
    obs.type === 'angle' ||
    obs.type === 'direction' ||
    obs.type === 'bearing' ||
    obs.type === 'dir' ||
    obs.type === 'zenith'
  ) {
    const residual = typeof obs.residual === 'number' ? obs.residual : Number.NaN;
    if (!Number.isFinite(residual)) return null;
    const angular =
      obs.type === 'angle' ||
      obs.type === 'direction' ||
      obs.type === 'bearing' ||
      obs.type === 'dir' ||
      obs.type === 'zenith';
    const diff = angular ? Math.abs(residual * RAD_TO_DEG * 3600) : Math.abs(residual) * unitScale;
    const stations =
      obs.type === 'angle'
        ? `${obs.at}-${obs.from}-${obs.to}`
        : 'from' in obs && 'to' in obs
          ? `${obs.from}-${obs.to}`
          : '-';
    return {
      obs,
      stations,
      diff,
      label: angular ? `${diff.toFixed(2)}"` : `${diff.toFixed(4)} ${linearUnit}`,
    };
  }
  if (obs.type === 'gps' && obs.residual && typeof obs.residual === 'object') {
    const residual = obs.residual as { vE?: number; vN?: number; vU?: number };
    const vE = Number.isFinite(residual.vE as number)
      ? (residual.vE as number)
      : Number.NaN;
    const vN = Number.isFinite(residual.vN as number)
      ? (residual.vN as number)
      : Number.NaN;
    const vU = Number.isFinite(residual.vU as number) ? (residual.vU as number) : 0;
    if (!Number.isFinite(vE) || !Number.isFinite(vN)) return null;
    const diff = Math.hypot(vE, vN, vU) * unitScale;
    return {
      obs,
      stations: `${obs.from}-${obs.to}`,
      diff,
      label: `${diff.toFixed(4)} ${linearUnit}`,
    };
  }
  return null;
};
