import { RAD_TO_DEG, radToDmsStr } from './angles';
import { getLevelLoopTolerancePresetLabel } from './levelLoopTolerance';
import type { AdjustmentResult, GpsObservation, Observation } from '../types';

const FT_PER_M = 3.280839895;

export type IndustryListingSortCoordinatesBy = 'input' | 'name';
export type IndustryListingSortObservationsBy = 'input' | 'name' | 'residual';

export interface IndustryListingSettings {
  maxIterations: number;
  units: 'm' | 'ft';
  listingShowCoordinates: boolean;
  listingShowObservationsResiduals: boolean;
  listingShowErrorPropagation: boolean;
  listingShowProcessingNotes: boolean;
  listingShowAzimuthsBearings: boolean;
  listingShowLostStations?: boolean;
  listingSortCoordinatesBy: IndustryListingSortCoordinatesBy;
  listingSortObservationsBy: IndustryListingSortObservationsBy;
  listingObservationLimit: number;
}

export interface IndustryListingParseSettings {
  coordMode: '2D' | '3D';
  order: 'NE' | 'EN';
  angleUnits: 'dms' | 'dd';
  angleStationOrder: 'atfromto' | 'fromatto';
  deltaMode: 'slope' | 'horiz';
  refractionCoefficient: number;
  descriptionReconcileMode?: 'first' | 'append';
  descriptionAppendDelimiter?: string;
}

export interface IndustryListingRunDiagnostics {
  solveProfile: 'webnet' | 'industry-parity';
  angleCenteringModel: 'geometry-aware-correlated-rays';
  defaultSigmaCount: number;
  defaultSigmaByType: string;
  stochasticDefaultsSummary: string;
  rotationAngleRad: number;
  levelLoopToleranceBaseMm?: number;
  levelLoopTolerancePerSqrtKmMm?: number;
  qFixLinearSigmaM?: number;
  qFixAngularSigmaSec?: number;
  crsTransformEnabled?: boolean;
  crsProjectionModel?: 'legacy-equirectangular' | 'local-enu';
  crsLabel?: string;
  crsGridScaleEnabled?: boolean;
  crsGridScaleFactor?: number;
  crsConvergenceEnabled?: boolean;
  crsConvergenceAngleRad?: number;
  geoidModelEnabled?: boolean;
  geoidModelId?: string;
  geoidInterpolation?: 'bilinear' | 'nearest';
  geoidHeightConversionEnabled?: boolean;
  geoidOutputHeightDatum?: 'orthometric' | 'ellipsoid';
  geoidModelLoaded?: boolean;
  geoidModelMetadata?: string;
  geoidSampleUndulationM?: number;
  geoidConvertedStationCount?: number;
  geoidSkippedStationCount?: number;
  gpsAddHiHtEnabled?: boolean;
  gpsAddHiHtHiM?: number;
  gpsAddHiHtHtM?: number;
  gpsAddHiHtVectorCount?: number;
  gpsAddHiHtAppliedCount?: number;
  gpsAddHiHtPositiveCount?: number;
  gpsAddHiHtNegativeCount?: number;
  gpsAddHiHtNeutralCount?: number;
  gpsAddHiHtDefaultZeroCount?: number;
  gpsAddHiHtMissingHeightCount?: number;
  gpsAddHiHtScaleMin?: number;
  gpsAddHiHtScaleMax?: number;
}

export const buildIndustryStyleListingText = (
  res: AdjustmentResult,
  settings: IndustryListingSettings,
  parseSettings: IndustryListingParseSettings,
  runDiagnostics: IndustryListingRunDiagnostics,
): string => {
  const lines: string[] = [];
  const now = new Date();
  const linearUnit = settings.units === 'ft' ? 'FeetUS' : 'Meters';
  const unitScale = settings.units === 'ft' ? FT_PER_M : 1;
  const runDiag = runDiagnostics;
  const showLostStations = settings.listingShowLostStations ?? true;
  const stationEntriesInputOrder = Object.entries(res.stations).filter(
    ([, st]) => showLostStations || !st.lost,
  );
  const stationEntriesForListing =
    settings.listingSortCoordinatesBy === 'name'
      ? [...stationEntriesInputOrder].sort((a, b) =>
          a[0].localeCompare(b[0], undefined, { numeric: true }),
        )
      : stationEntriesInputOrder;
  const fixedStations = stationEntriesInputOrder.filter(([, st]) => st.fixed).length;
  const freeStations = stationEntriesInputOrder.length - fixedStations;
  const observationCount = res.observations.length;
  const unknownCount = Math.max(0, observationCount - res.dof);
  const parseState = res.parseState;
  const autoSideshotEnabled = parseState?.autoSideshotEnabled ?? true;
  const prismEnabled = parseState?.prismEnabled ?? false;
  const prismOffset = parseState?.prismOffset ?? 0;
  const prismScope = parseState?.prismScope ?? 'global';
  const rotationAngleRad = parseState?.rotationAngleRad ?? runDiag.rotationAngleRad ?? 0;
  const qFixLinearSigmaM = parseState?.qFixLinearSigmaM ?? runDiag.qFixLinearSigmaM ?? 1e-9;
  const qFixAngularSigmaSec =
    parseState?.qFixAngularSigmaSec ?? runDiag.qFixAngularSigmaSec ?? 1e-9;
  const crsTransformEnabled =
    parseState?.crsTransformEnabled ?? runDiag.crsTransformEnabled ?? false;
  const crsProjectionModel =
    parseState?.crsProjectionModel ?? runDiag.crsProjectionModel ?? 'legacy-equirectangular';
  const crsLabel = parseState?.crsLabel ?? runDiag.crsLabel ?? '';
  const crsGridScaleEnabled =
    parseState?.crsGridScaleEnabled ?? runDiag.crsGridScaleEnabled ?? false;
  const crsGridScaleFactor = parseState?.crsGridScaleFactor ?? runDiag.crsGridScaleFactor ?? 1;
  const crsConvergenceEnabled =
    parseState?.crsConvergenceEnabled ?? runDiag.crsConvergenceEnabled ?? false;
  const crsConvergenceAngleRad =
    parseState?.crsConvergenceAngleRad ?? runDiag.crsConvergenceAngleRad ?? 0;
  const geoidModelEnabled = parseState?.geoidModelEnabled ?? runDiag.geoidModelEnabled ?? false;
  const geoidModelId = parseState?.geoidModelId ?? runDiag.geoidModelId ?? 'NGS-DEMO';
  const geoidInterpolation =
    parseState?.geoidInterpolation ?? runDiag.geoidInterpolation ?? 'bilinear';
  const geoidHeightConversionEnabled =
    parseState?.geoidHeightConversionEnabled ?? runDiag.geoidHeightConversionEnabled ?? false;
  const geoidOutputHeightDatum =
    parseState?.geoidOutputHeightDatum ?? runDiag.geoidOutputHeightDatum ?? 'orthometric';
  const geoidModelLoaded = parseState?.geoidModelLoaded ?? runDiag.geoidModelLoaded ?? false;
  const geoidModelMetadata = parseState?.geoidModelMetadata ?? runDiag.geoidModelMetadata ?? '';
  const geoidSampleUndulationM =
    parseState?.geoidSampleUndulationM ?? runDiag.geoidSampleUndulationM;
  const geoidConvertedStationCount =
    parseState?.geoidConvertedStationCount ?? runDiag.geoidConvertedStationCount ?? 0;
  const geoidSkippedStationCount =
    parseState?.geoidSkippedStationCount ?? runDiag.geoidSkippedStationCount ?? 0;
  const gpsAddHiHtEnabled = parseState?.gpsAddHiHtEnabled ?? runDiag.gpsAddHiHtEnabled ?? false;
  const gpsAddHiHtHiM = parseState?.gpsAddHiHtHiM ?? runDiag.gpsAddHiHtHiM ?? 0;
  const gpsAddHiHtHtM = parseState?.gpsAddHiHtHtM ?? runDiag.gpsAddHiHtHtM ?? 0;
  const gpsAddHiHtVectorCount =
    parseState?.gpsAddHiHtVectorCount ?? runDiag.gpsAddHiHtVectorCount ?? 0;
  const gpsAddHiHtAppliedCount =
    parseState?.gpsAddHiHtAppliedCount ?? runDiag.gpsAddHiHtAppliedCount ?? 0;
  const gpsAddHiHtPositiveCount =
    parseState?.gpsAddHiHtPositiveCount ?? runDiag.gpsAddHiHtPositiveCount ?? 0;
  const gpsAddHiHtNegativeCount =
    parseState?.gpsAddHiHtNegativeCount ?? runDiag.gpsAddHiHtNegativeCount ?? 0;
  const gpsAddHiHtNeutralCount =
    parseState?.gpsAddHiHtNeutralCount ?? runDiag.gpsAddHiHtNeutralCount ?? 0;
  const gpsAddHiHtDefaultZeroCount =
    parseState?.gpsAddHiHtDefaultZeroCount ?? runDiag.gpsAddHiHtDefaultZeroCount ?? 0;
  const gpsAddHiHtMissingHeightCount =
    parseState?.gpsAddHiHtMissingHeightCount ?? runDiag.gpsAddHiHtMissingHeightCount ?? 0;
  const gpsAddHiHtScaleMin = parseState?.gpsAddHiHtScaleMin ?? runDiag.gpsAddHiHtScaleMin ?? 1;
  const gpsAddHiHtScaleMax = parseState?.gpsAddHiHtScaleMax ?? runDiag.gpsAddHiHtScaleMax ?? 1;
  const gpsLoopCheckEnabled = parseState?.gpsLoopCheckEnabled ?? false;
  const levelLoopToleranceBaseMm =
    parseState?.levelLoopToleranceBaseMm ?? runDiag.levelLoopToleranceBaseMm ?? 0;
  const levelLoopTolerancePerSqrtKmMm =
    parseState?.levelLoopTolerancePerSqrtKmMm ?? runDiag.levelLoopTolerancePerSqrtKmMm ?? 4;
  const gpsLoopDiagnostics = res.gpsLoopDiagnostics;
  const levelingLoopDiagnostics = res.levelingLoopDiagnostics;
  const isPreanalysis = res.preanalysisMode === true;
  const descriptionReconcileMode =
    parseState?.descriptionReconcileMode ?? parseSettings.descriptionReconcileMode ?? 'first';
  const descriptionAppendDelimiter =
    parseState?.descriptionAppendDelimiter ?? parseSettings.descriptionAppendDelimiter ?? ' | ';
  const reconciledDescriptions = parseState?.reconciledDescriptions ?? {};
  const stationDescription = (stationId: string): string => reconciledDescriptions[stationId] ?? '';
  const lostStationIds = [...(parseState?.lostStationIds ?? [])].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
  const observationStationIds = (obs: Observation): string[] => {
    if (obs.type === 'angle') return [obs.at, obs.from, obs.to];
    if (obs.type === 'direction') return [obs.at, obs.to];
    if ('from' in obs && 'to' in obs) return [obs.from, obs.to];
    return [];
  };
  const isHiddenLostStation = (stationId: string): boolean => {
    if (showLostStations) return false;
    const station = res.stations[stationId];
    return station?.lost === true;
  };
  const observationReferencesHiddenLostStation = (obs: Observation): boolean =>
    observationStationIds(obs).some((stationId) => isHiddenLostStation(stationId));
  const observationsForListing = res.observations.filter(
    (obs) => !observationReferencesHiddenLostStation(obs),
  );
  const sideshotsForListing = (res.sideshots ?? []).filter(
    (row) => !isHiddenLostStation(row.from) && !isHiddenLostStation(row.to),
  );
  const tsSideshotsForListing = sideshotsForListing.filter((row) => row.mode !== 'gps');
  const gpsSideshotsForListing = sideshotsForListing.filter((row) => row.mode === 'gps');
  const gpsVectorSideshotsForListing = gpsSideshotsForListing.filter(
    (row) => row.sourceType !== 'GS',
  );
  const gpsCoordinateSideshotsForListing = gpsSideshotsForListing.filter(
    (row) => row.sourceType === 'GS',
  );
  const gpsOffsetObservations = observationsForListing.filter(
    (obs): obs is GpsObservation => obs.type === 'gps' && obs.gpsOffsetDistanceM != null,
  );
  const aliasTrace = parseState?.aliasTrace ?? [];
  const descriptionTrace = parseState?.descriptionTrace ?? [];
  const descriptionScanSummary = parseState?.descriptionScanSummary ?? [];
  const descriptionRefsByStation = descriptionTrace.reduce<
    Map<string, { key: string; description: string; lines: number[] }[]>
  >((acc, entry) => {
    const rows = acc.get(entry.stationId) ?? [];
    const key = entry.description.replace(/\s+/g, ' ').trim().toUpperCase();
    const existing = rows.find((row) => row.key === key);
    if (existing) {
      if (!existing.lines.includes(entry.sourceLine)) existing.lines.push(entry.sourceLine);
    } else {
      rows.push({ key, description: entry.description, lines: [entry.sourceLine] });
    }
    acc.set(entry.stationId, rows);
    return acc;
  }, new Map());
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

  lines.push('                INDUSTRY-STANDARD-STYLE Listing (WebNet Emulation)');
  lines.push(`                       Run Date: ${now.toLocaleString()}`);
  lines.push('');
  lines.push('                   Summary of Files Used and Option Settings');
  lines.push('                   =========================================');
  lines.push('');
  lines.push('                            Project Option Settings');
  lines.push('');
  lines.push(
    `      Industry Standard Run Mode                   : ${runDiag.solveProfile === 'industry-parity' ? 'Parity Profile (Classical)' : 'WebNet Default Profile'}`,
  );
  lines.push(
    `      Run Purpose                         : ${isPreanalysis ? 'Preanalysis / Predicted Precision' : 'Adjustment / Postfit QA'}`,
  );
  lines.push(
    `      Type of Adjustment                  : ${parseState?.coordMode ?? parseSettings.coordMode}`,
  );
  lines.push(
    `      Project Units                       : ${linearUnit}; ${(parseState?.angleUnits ?? parseSettings.angleUnits).toUpperCase()}`,
  );
  lines.push(
    `      Input/Output Coordinate Order       : ${(parseState?.order ?? parseSettings.order) === 'NE' ? 'North-East' : 'East-North'}`,
  );
  lines.push(
    `      Angle Data Station Order            : ${(parseState?.angleStationOrder ?? parseSettings.angleStationOrder) === 'atfromto' ? 'At-From-To' : 'From-At-To'}`,
  );
  lines.push(
    `      Distance/Vertical Data Type         : ${(parseState?.deltaMode ?? parseSettings.deltaMode) === 'horiz' ? 'Hor Dist/DE' : 'Slope Dist/Zenith'}`,
  );
  lines.push(`      Convergence Limit; Max Iterations   : 0.001000; ${settings.maxIterations}`);
  lines.push(
    `      Default Coefficient of Refraction   : ${(parseState?.refractionCoefficient ?? parseSettings.refractionCoefficient).toFixed(6)}`,
  );
  lines.push(
    `      Prism Correction                    : ${prismEnabled ? `ON (${prismOffset.toFixed(4)} m, scope=${prismScope})` : 'OFF'}`,
  );
  lines.push(
    `      Plan Rotation                      : ${Math.abs(rotationAngleRad) > 1e-12 ? `ON (${(rotationAngleRad * RAD_TO_DEG).toFixed(6)} deg)` : 'OFF'}`,
  );
  lines.push(
    `      CRS / Projection                   : ${crsTransformEnabled ? `ON (${crsProjectionModel}, label="${crsLabel || 'unnamed'}")` : 'OFF'}`,
  );
  lines.push(
    `      CRS Grid-Ground Scale             : ${crsGridScaleEnabled ? `ON (${crsGridScaleFactor.toFixed(8)})` : 'OFF'}`,
  );
  lines.push(
    `      CRS Convergence                   : ${crsConvergenceEnabled ? `ON (${(crsConvergenceAngleRad * RAD_TO_DEG).toFixed(6)} deg)` : 'OFF'}`,
  );
  lines.push(
    `      Geoid/Grid Model                 : ${geoidModelEnabled ? `ON (${geoidModelId}, ${geoidInterpolation.toUpperCase()}, loaded=${geoidModelLoaded ? 'YES' : 'NO'})` : 'OFF'}`,
  );
  if (geoidModelEnabled) {
    lines.push(
      `      Geoid Metadata                  : ${geoidModelMetadata || 'unavailable'}${geoidSampleUndulationM != null ? `; sampleN=${geoidSampleUndulationM.toFixed(4)} m` : ''}`,
    );
  }
  lines.push(
    `      Geoid Height Conversion        : ${geoidHeightConversionEnabled ? `ON (${geoidOutputHeightDatum.toUpperCase()}, converted=${geoidConvertedStationCount}, skipped=${geoidSkippedStationCount})` : 'OFF'}`,
  );
  lines.push(
    `      GPS AddHiHt Defaults            : ${gpsAddHiHtEnabled ? `ON (HI=${(gpsAddHiHtHiM * unitScale).toFixed(4)} ${linearUnit}, HT=${(gpsAddHiHtHtM * unitScale).toFixed(4)} ${linearUnit})` : 'OFF'}`,
  );
  if (gpsAddHiHtEnabled) {
    lines.push(
      `      GPS AddHiHt Preprocess          : vectors=${gpsAddHiHtVectorCount}, adjusted=${gpsAddHiHtAppliedCount} (+${gpsAddHiHtPositiveCount}/-${gpsAddHiHtNegativeCount}/neutral=${gpsAddHiHtNeutralCount}), defaultZero=${gpsAddHiHtDefaultZeroCount}, missingHeight=${gpsAddHiHtMissingHeightCount}, scale=[${gpsAddHiHtScaleMin.toFixed(8)}, ${gpsAddHiHtScaleMax.toFixed(8)}]`,
    );
  }
  lines.push(
    `      GPS Loop Check                  : ${gpsLoopCheckEnabled ? 'ON' : 'OFF'}${gpsLoopDiagnostics?.enabled ? ` (vectors=${gpsLoopDiagnostics.vectorCount}, loops=${gpsLoopDiagnostics.loopCount}, pass=${gpsLoopDiagnostics.passCount}, warn=${gpsLoopDiagnostics.warnCount})` : ''}`,
  );
  lines.push(
    `      Level Loop Tolerance           : ${getLevelLoopTolerancePresetLabel(levelLoopToleranceBaseMm, levelLoopTolerancePerSqrtKmMm)} (base=${levelLoopToleranceBaseMm.toFixed(2)} mm, k=${levelLoopTolerancePerSqrtKmMm.toFixed(2)} mm/sqrt(km))`,
  );
  lines.push(
    `      GPS Rover Offsets              : ${gpsOffsetObservations.length > 0 ? `${gpsOffsetObservations.length} applied` : 'none'}`,
  );
  lines.push(
    `      Lost Stations                     : ${lostStationIds.length > 0 ? `${lostStationIds.length} (${lostStationIds.join(', ')})` : 'none'}`,
  );
  lines.push(
    `      QFIX (Linear/Angular)            : ${(qFixLinearSigmaM * unitScale).toExponential(6)} ${linearUnit}; ${qFixAngularSigmaSec.toExponential(6)}"`,
  );
  lines.push(
    `      Description Reconciliation       : ${descriptionReconcileMode.toUpperCase()}${descriptionReconcileMode === 'append' ? ` (delimiter="${descriptionAppendDelimiter}")` : ''}`,
  );
  if ((parseState?.descriptionScanSummary?.length ?? 0) > 0) {
    lines.push(
      `      Description Scan                  : repeated=${parseState?.descriptionRepeatedStationCount ?? 0}, conflicts=${parseState?.descriptionConflictCount ?? 0}, stations=${parseState?.descriptionScanSummary?.length ?? 0}`,
    );
  }
  lines.push(`      Show Lost Stations in Output      : ${showLostStations ? 'ON' : 'OFF'}`);
  if (res.clusterDiagnostics?.enabled) {
    lines.push(
      `      Cluster Detection Mode             : ${res.clusterDiagnostics.passMode.toUpperCase()} / ${res.clusterDiagnostics.linkageMode.toUpperCase()} (${res.clusterDiagnostics.dimension}, tol=${(res.clusterDiagnostics.tolerance * unitScale).toFixed(4)} ${linearUnit}, merges=${res.clusterDiagnostics.approvedMergeCount ?? 0}, outcomes=${res.clusterDiagnostics.mergeOutcomes?.length ?? 0}, rejected=${res.clusterDiagnostics.rejectedProposals?.length ?? 0})`,
    );
  }
  if (res.autoAdjustDiagnostics?.enabled) {
    lines.push(
      `      Auto-Adjust                        : ON (|t|>=${res.autoAdjustDiagnostics.threshold.toFixed(2)}, cycles=${res.autoAdjustDiagnostics.maxCycles}, maxRm/cycle=${res.autoAdjustDiagnostics.maxRemovalsPerCycle}, minRedund=${res.autoAdjustDiagnostics.minRedundancy.toFixed(2)}, stop=${res.autoAdjustDiagnostics.stopReason}, removed=${res.autoAdjustDiagnostics.removed.length})`,
    );
  }
  if (autoSideshotEnabled && res.autoSideshotDiagnostics?.enabled) {
    lines.push(
      `      Auto Sideshot (M-lines)            : ON (evaluated=${res.autoSideshotDiagnostics.evaluatedCount}, candidates=${res.autoSideshotDiagnostics.candidateCount}, excluded-control=${res.autoSideshotDiagnostics.excludedControlCount}, minRedund<${res.autoSideshotDiagnostics.threshold.toFixed(2)})`,
    );
  } else {
    lines.push('      Auto Sideshot (M-lines)            : OFF');
  }
  if ((parseState?.aliasExplicitCount ?? 0) > 0 || (parseState?.aliasRuleCount ?? 0) > 0) {
    lines.push(
      `      Alias Canonicalization              : explicit=${parseState?.aliasExplicitCount ?? 0}, rules=${parseState?.aliasRuleCount ?? 0}, references=${aliasTrace.length}`,
    );
  }
  lines.push('');
  lines.push('                       Instrument Standard Error Settings');
  lines.push('');
  lines.push('      Active Project Instrument Defaults');
  lines.push(
    `        Distances (Constant)              : ${runDiag.stochasticDefaultsSummary.includes('inst=') ? runDiag.stochasticDefaultsSummary : '-'}`,
  );
  lines.push(
    `        Centering / Inflation             : ${runDiag.angleCenteringModel}; ${runDiag.defaultSigmaCount} default-sigma obs${runDiag.defaultSigmaByType ? ` (${runDiag.defaultSigmaByType})` : ''}`,
  );
  if ((parseState?.aliasExplicitMappings?.length ?? 0) > 0) {
    lines.push('      Explicit Alias Mappings');
    parseState?.aliasExplicitMappings?.forEach((m) => {
      lines.push(
        `        ${m.sourceId} -> ${m.canonicalId}${m.sourceLine != null ? ` (line ${m.sourceLine})` : ''}`,
      );
    });
  }
  if ((parseState?.aliasRuleSummaries?.length ?? 0) > 0) {
    lines.push('      Alias Rules');
    parseState?.aliasRuleSummaries?.forEach((r) => {
      lines.push(`        ${r.rule} (line ${r.sourceLine})`);
    });
  }
  lines.push('');
  lines.push('                    Summary of Unadjusted Input Observations');
  lines.push('                    ========================================');
  lines.push('');
  lines.push(
    `                    Number of Entered Stations (${linearUnit}) = ${stationEntriesInputOrder.length}`,
  );
  lines.push(
    `                    Fixed Stations = ${fixedStations}; Free Stations = ${freeStations}`,
  );

  const countByType = (type: Observation['type']) =>
    observationsForListing.filter((o) => o.type === type).length;
  lines.push('');
  lines.push(
    `                    Number of Angle Observations (${(parseState?.angleUnits ?? parseSettings.angleUnits).toUpperCase()}) = ${countByType('angle')}`,
  );
  lines.push(
    `                 Number of Distance Observations (${linearUnit}) = ${countByType('dist')}`,
  );
  lines.push(
    `                Number of Direction Observations (${(parseState?.angleUnits ?? parseSettings.angleUnits).toUpperCase()}) = ${countByType('direction') + countByType('dir') + countByType('bearing')}`,
  );
  lines.push('');
  lines.push('                         Adjustment Statistical Summary');
  lines.push('                         ==============================');
  lines.push('');
  lines.push(`                        Iterations              = ${res.iterations}`);
  lines.push('');
  lines.push(
    `                        Number of Stations      = ${stationEntriesInputOrder.length}`,
  );
  lines.push('');
  lines.push(`                        Number of Observations  = ${observationCount}`);
  lines.push(`                        Number of Unknowns      = ${unknownCount}`);
  lines.push(`                        Number of Redundant Obs = ${res.dof}`);
  lines.push('');
  lines.push('            Observation   Count   Sum Squares         Error');
  lines.push('                                    of StdRes        Factor');

  const statRows = res.statisticalSummary?.byGroup?.length
    ? res.statisticalSummary.byGroup
    : (() => {
        const groups: Array<{
          label: string;
          filter: (_obs: Observation) => boolean;
        }> = [
          { label: 'Angles', filter: (o) => o.type === 'angle' },
          {
            label: 'Directions',
            filter: (o) => o.type === 'direction' || o.type === 'dir' || o.type === 'bearing',
          },
          { label: 'Distances', filter: (o) => o.type === 'dist' },
          { label: 'GPS', filter: (o) => o.type === 'gps' },
          { label: 'Leveling', filter: (o) => o.type === 'lev' },
        ];
        return groups
          .map((group) => {
            const obs = res.observations
              .filter(group.filter)
              .filter((o) => Number.isFinite(o.stdRes));
            if (!obs.length) return null;
            const sumSquares = obs.reduce((sum, o) => sum + (o.stdRes ?? 0) * (o.stdRes ?? 0), 0);
            const factor = Math.sqrt(sumSquares / obs.length);
            return { label: group.label, count: obs.length, sumSquares, errorFactor: factor };
          })
          .filter(
            (
              row,
            ): row is { label: string; count: number; sumSquares: number; errorFactor: number } =>
              row != null,
          );
      })();
  const totalCount =
    res.statisticalSummary?.totalCount ?? statRows.reduce((sum, r) => sum + r.count, 0);
  const totalSumSquares =
    res.statisticalSummary?.totalSumSquares ?? statRows.reduce((sum, r) => sum + r.sumSquares, 0);
  statRows.forEach((row) => {
    lines.push(
      `                 ${row.label.padEnd(12)}${row.count.toString().padStart(6)}${row.sumSquares.toFixed(3).padStart(14)}${row.errorFactor.toFixed(3).padStart(14)}`,
    );
  });
  lines.push(
    `                  Total${totalCount.toString().padStart(12)}${totalSumSquares.toFixed(3).padStart(14)}${res.seuw.toFixed(3).padStart(14)}`,
  );
  lines.push('');
  if (res.chiSquare) {
    const errorLower = Math.sqrt(res.chiSquare.varianceFactorLower);
    const errorUpper = Math.sqrt(res.chiSquare.varianceFactorUpper);
    lines.push(
      `                  The Chi-Square Test at 5.00% Level ${res.chiSquare.pass95 ? 'Passed' : 'Failed'}`,
    );
    lines.push(
      `                       Lower/Upper Bounds (${errorLower.toFixed(3)}/${errorUpper.toFixed(3)})`,
    );
    lines.push(
      `                       Variance Factor Bounds (${res.chiSquare.varianceFactorLower.toFixed(3)}/${res.chiSquare.varianceFactorUpper.toFixed(3)})`,
    );
    lines.push('');
  }
  const addCenteredHeading = (title: string, underline = '=') => {
    lines.push(title);
    lines.push(underline.repeat(title.length));
  };
  const renderTextTable = (headers: string[], rows: string[][], rightAligned: number[] = []) => {
    if (rows.length === 0) return;
    const right = new Set(rightAligned);
    const widths = headers.map((h, col) =>
      Math.max(
        h.length,
        ...rows.map((row) => {
          const v = row[col] ?? '';
          return v.length;
        }),
      ),
    );
    const formatCell = (value: string, width: number, alignRight: boolean) =>
      alignRight ? value.padStart(width) : value.padEnd(width);
    lines.push(headers.map((h, col) => formatCell(h, widths[col], right.has(col))).join('  '));
    rows.forEach((row) => {
      lines.push(
        headers.map((_, col) => formatCell(row[col] ?? '', widths[col], right.has(col))).join('  '),
      );
    });
  };

  if (settings.listingShowCoordinates) {
    lines.push('');
    addCenteredHeading(`Adjusted Coordinates (${linearUnit})`);
    lines.push('');
    const coordRows = stationEntriesForListing.map(([id, st]) => [
      id,
      stationDescription(id) || '-',
      (st.y * unitScale).toFixed(4),
      (st.x * unitScale).toFixed(4),
    ]);
    renderTextTable(['Station', 'Description', 'N', 'E'], coordRows, [2, 3]);
  }

  const compareObsByInput = (a: Observation, b: Observation) => {
    const aLine = a.sourceLine ?? Number.MAX_SAFE_INTEGER;
    const bLine = b.sourceLine ?? Number.MAX_SAFE_INTEGER;
    if (aLine !== bLine) return aLine - bLine;
    return (a.id ?? 0) - (b.id ?? 0);
  };
  const compareStationIds = (a: string, b: string) =>
    a.localeCompare(b, undefined, { numeric: true });
  const compareObsByStations = (a: Observation, b: Observation) => {
    const stationKey = (obs: Observation) =>
      obs.type === 'angle'
        ? `${obs.at}-${obs.from}-${obs.to}`
        : obs.type === 'direction'
          ? `${obs.at}-${obs.to}`
          : `${obs.from}-${obs.to}`;
    const cmp = stationKey(a).localeCompare(stationKey(b), undefined, { numeric: true });
    if (cmp !== 0) return cmp;
    return compareObsByInput(a, b);
  };
  const listingObservations = [...observationsForListing]
    .filter((o) => Number.isFinite(o.stdRes))
    .filter((o) =>
      settings.listingShowAzimuthsBearings
        ? true
        : !(o.type === 'direction' || o.type === 'dir' || o.type === 'bearing'),
    )
    .sort((a, b) => {
      if (settings.listingSortObservationsBy === 'input') return compareObsByInput(a, b);
      if (settings.listingSortObservationsBy === 'name') return compareObsByStations(a, b);
      return Math.abs(b.stdRes ?? 0) - Math.abs(a.stdRes ?? 0);
    })
    .slice(0, Math.min(500, Math.max(1, settings.listingObservationLimit)));
  const autoSideshotObsIds = new Set(
    res.autoSideshotDiagnostics?.candidates.flatMap((c) => [c.angleObsId, c.distObsId]) ?? [],
  );
  const autoSideshotSuffix = (obs: Observation): string =>
    autoSideshotObsIds.has(obs.id) ? ' [auto-ss]' : '';
  const prismSuffix = (obs: Observation): string => {
    if (obs.type !== 'dist' && obs.type !== 'zenith') return '';
    const correction = obs.prismCorrectionM ?? 0;
    if (!Number.isFinite(correction) || Math.abs(correction) <= 0) return '';
    const scope = obs.prismScope ?? 'global';
    const sign = correction >= 0 ? '+' : '';
    return ` [prism ${scope} ${sign}${(correction * unitScale).toFixed(4)}${linearUnit}]`;
  };

  type RelationshipPair = { key: string; from: string; to: string };
  const pairKey = (a: string, b: string) =>
    compareStationIds(a, b) <= 0 ? `${a}::${b}` : `${b}::${a}`;
  const relationshipPairMap = new Map<string, RelationshipPair>();
  const addRelationshipPair = (from?: string, to?: string) => {
    if (!from || !to || from === to) return;
    const key = pairKey(from, to);
    if (!relationshipPairMap.has(key)) {
      relationshipPairMap.set(key, { key, from, to });
    }
  };
  [...observationsForListing].sort(compareObsByInput).forEach((obs) => {
    switch (obs.type) {
      case 'angle':
        addRelationshipPair(obs.at, obs.from);
        addRelationshipPair(obs.at, obs.to);
        break;
      case 'direction':
        addRelationshipPair(obs.at, obs.to);
        break;
      case 'dist':
      case 'dir':
      case 'bearing':
      case 'gps':
        addRelationshipPair(obs.from, obs.to);
        break;
      default:
        break;
    }
  });
  const relationshipPairs = [...relationshipPairMap.values()];

  const formatAngularResidualArcSec = (value: number | undefined): string =>
    value != null ? `${(value * RAD_TO_DEG * 3600).toFixed(2)}"` : '-';
  const formatAngularStdErrArcSec = (value: number): string =>
    `${(value * RAD_TO_DEG * 3600).toFixed(2)}"`;
  const formatLinear = (value: number | undefined): string =>
    value != null ? (value * unitScale).toFixed(4) : '-';
  const formatEffectiveDistance = (value: number | undefined): string =>
    value != null && Number.isFinite(value) && value > 0 ? (value * unitScale).toFixed(4) : '-';
  const formatEllipseAzDm = (thetaDeg?: number): string => {
    if (thetaDeg == null || !Number.isFinite(thetaDeg)) return '-';
    let az = ((thetaDeg % 180) + 180) % 180;
    let deg = Math.floor(az);
    let min = Math.round((az - deg) * 60);
    if (min >= 60) {
      min -= 60;
      deg = (deg + 1) % 180;
    }
    return `${deg}-${min.toString().padStart(2, '0')}`;
  };
  const pairAzimuthDms = (from: string, to: string): string => {
    const a = res.stations[from];
    const b = res.stations[to];
    if (!a || !b) return '-';
    const az = Math.atan2(b.x - a.x, b.y - a.y);
    const wrapped = az >= 0 ? az : az + 2 * Math.PI;
    return radToDmsStr(wrapped);
  };
  const horizDistance = (from: string, to: string): string => {
    const a = res.stations[from];
    const b = res.stations[to];
    if (!a || !b) return '-';
    return (Math.hypot(b.x - a.x, b.y - a.y) * unitScale).toFixed(4);
  };
  const stationCovariance = (
    id: string,
  ): { varE: number; varN: number; covEN: number } | undefined => {
    const st = res.stations[id];
    if (!st) return undefined;
    if (st.errorEllipse) {
      const theta = st.errorEllipse.theta / RAD_TO_DEG;
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      const a2 = st.errorEllipse.semiMajor * st.errorEllipse.semiMajor;
      const b2 = st.errorEllipse.semiMinor * st.errorEllipse.semiMinor;
      return {
        varE: a2 * c * c + b2 * s * s,
        varN: a2 * s * s + b2 * c * c,
        covEN: (a2 - b2) * s * c,
      };
    }
    return {
      varE: (st.sE ?? 0) ** 2,
      varN: (st.sN ?? 0) ** 2,
      covEN: 0,
    };
  };
  type RelativePairStats = {
    from: string;
    to: string;
    sigmaDist?: number;
    sigmaAz?: number;
    ellipse?: { semiMajor: number; semiMinor: number; theta: number };
  };
  const fallbackRelativePair = (from: string, to: string): RelativePairStats | undefined => {
    const fromSt = res.stations[from];
    const toSt = res.stations[to];
    if (!fromSt || !toSt) return undefined;
    const covFrom = stationCovariance(from);
    const covTo = stationCovariance(to);
    if (!covFrom || !covTo) return undefined;
    const dE = toSt.x - fromSt.x;
    const dN = toSt.y - fromSt.y;
    const dist = Math.hypot(dE, dN);
    const varE = covTo.varE + covFrom.varE;
    const varN = covTo.varN + covFrom.varN;
    const covEN = covTo.covEN + covFrom.covEN;
    const term1 = (varE + varN) / 2;
    const term2 = Math.sqrt(Math.max(0, ((varE - varN) / 2) ** 2 + covEN * covEN));
    const semiMajor = Math.sqrt(Math.max(0, term1 + term2));
    const semiMinor = Math.sqrt(Math.max(0, term1 - term2));
    const theta = 0.5 * Math.atan2(2 * covEN, varE - varN);
    let sigmaDist: number | undefined;
    let sigmaAz: number | undefined;
    if (dist > 0) {
      const inv = 1 / (dist * dist);
      const varDist = inv * (dE * dE * varE + dN * dN * varN + 2 * dE * dN * covEN);
      sigmaDist = Math.sqrt(Math.max(0, varDist));
      const varAz = (dN * dN * varE + dE * dE * varN - 2 * dE * dN * covEN) * inv * inv;
      sigmaAz = Math.sqrt(Math.max(0, varAz));
    }
    return {
      from,
      to,
      sigmaDist,
      sigmaAz,
      ellipse: { semiMajor, semiMinor, theta: theta * RAD_TO_DEG },
    };
  };
  const resolveRelativePair = (pair: RelationshipPair): RelativePairStats | undefined => {
    const matched =
      res.relativePrecision?.find((r) => r.from === pair.from && r.to === pair.to) ??
      res.relativePrecision?.find((r) => r.from === pair.to && r.to === pair.from);
    if (matched) {
      return {
        from: matched.from,
        to: matched.to,
        sigmaDist: matched.sigmaDist,
        sigmaAz: matched.sigmaAz,
        ellipse: matched.ellipse
          ? {
              semiMajor: matched.ellipse.semiMajor,
              semiMinor: matched.ellipse.semiMinor,
              theta: matched.ellipse.theta,
            }
          : undefined,
      };
    }
    return fallbackRelativePair(pair.from, pair.to);
  };
  const relationshipRows = relationshipPairs
    .map((pair) => {
      const rel = resolveRelativePair(pair);
      const from = rel?.from ?? pair.from;
      const to = rel?.to ?? pair.to;
      const distance = horizDistance(from, to);
      const sigmaAz95 =
        rel?.sigmaAz != null ? (rel.sigmaAz * RAD_TO_DEG * 3600 * 1.96).toFixed(2) : '-';
      const sigmaDist95 =
        rel?.sigmaDist != null ? (rel.sigmaDist * unitScale * 1.96).toFixed(4) : '-';
      const ppm95 =
        rel?.sigmaDist != null && distance !== '-'
          ? (
              (rel.sigmaDist * 1.96 * 1_000_000) /
              Math.max(1e-12, Math.abs(Number(distance) / unitScale))
            ).toFixed(4)
          : '-';
      return {
        from,
        to,
        azimuth: pairAzimuthDms(from, to),
        distance,
        sigmaAz95,
        sigmaDist95,
        ppm95,
        ellipse: rel?.ellipse,
      };
    })
    .filter((row) => row.distance !== '-')
    .sort((a, b) => compareStationIds(a.from, b.from) || compareStationIds(a.to, b.to));

  const renderAdjustedSection = (
    title: string,
    rows: string[][],
    headers: string[],
    rightAligned: number[],
    preface?: string[],
  ) => {
    if (rows.length === 0) return;
    lines.push('');
    addCenteredHeading(title);
    if (preface && preface.length > 0) {
      preface.forEach((p) => lines.push(p));
    }
    lines.push('');
    renderTextTable(headers, rows, rightAligned);
  };

  if (
    !isPreanalysis &&
    settings.listingShowObservationsResiduals &&
    listingObservations.length > 0
  ) {
    const angleRows = listingObservations
      .filter((obs) => obs.type === 'angle')
      .map((obs) => [
        `${obs.at}-${obs.from}-${obs.to}${aliasRefsForLine(obs.sourceLine)}${autoSideshotSuffix(obs)}`,
        radToDmsStr(obs.obs),
        formatAngularResidualArcSec(obs.residual as number | undefined),
        formatEffectiveDistance(obs.effectiveDistance),
        formatAngularStdErrArcSec(obs.stdDev),
        (obs.stdRes ?? 0).toFixed(2),
        obs.sourceLine != null ? `1:${obs.sourceLine}` : '-',
      ]);
    renderAdjustedSection(
      `Adjusted Angle Observations (${(parseState?.angleUnits ?? parseSettings.angleUnits).toUpperCase()})`,
      angleRows,
      [
        'Stations',
        'Observed',
        'Residual',
        `EffDist (${linearUnit})`,
        'StdErr',
        'StdRes',
        'File:Line',
      ],
      [5],
    );

    const distanceRows = listingObservations
      .filter((obs) => obs.type === 'dist')
      .map((obs) => [
        `${obs.from}-${obs.to}${aliasRefsForLine(obs.sourceLine)}${autoSideshotSuffix(obs)}${prismSuffix(obs)}`,
        formatLinear(obs.obs),
        formatLinear(obs.residual as number | undefined),
        formatLinear(obs.stdDev),
        (obs.stdRes ?? 0).toFixed(2),
        obs.sourceLine != null ? `1:${obs.sourceLine}` : '-',
      ]);
    renderAdjustedSection(
      `Adjusted Distance Observations (${linearUnit})`,
      distanceRows,
      ['Stations', 'Observed', 'Residual', 'StdErr', 'StdRes', 'File:Line'],
      [1, 2, 3, 4],
    );

    const directionRows = listingObservations
      .filter((obs) => obs.type === 'direction')
      .map((obs) => [
        `${obs.at}-${obs.to}${aliasRefsForLine(obs.sourceLine)}${autoSideshotSuffix(obs)}`,
        radToDmsStr(obs.obs),
        formatAngularResidualArcSec(obs.residual as number | undefined),
        formatEffectiveDistance(obs.effectiveDistance),
        formatAngularStdErrArcSec(obs.stdDev),
        (obs.stdRes ?? 0).toFixed(2),
        obs.sourceLine != null ? `1:${obs.sourceLine}` : '-',
      ]);
    renderAdjustedSection(
      `Adjusted Direction Observations (${(parseState?.angleUnits ?? parseSettings.angleUnits).toUpperCase()})`,
      directionRows,
      [
        'Stations',
        'Observed',
        'Residual',
        `EffDist (${linearUnit})`,
        'StdErr',
        'StdRes',
        'File:Line',
      ],
      [5],
    );

    if (relationshipRows.length > 0) {
      lines.push('');
      const azTitle = `Adjusted Azimuths (${(parseState?.angleUnits ?? parseSettings.angleUnits).toUpperCase()}) and Horizontal Distances (${linearUnit})`;
      addCenteredHeading(azTitle);
      lines.push('                 (Relative Confidence of Azimuth is in Seconds)');
      lines.push('');
      lines.push('From       To               Azimuth    Distance       95% RelConfidence');
      lines.push('                                                    Azi    Dist       PPM');
      relationshipRows.forEach((row) => {
        lines.push(
          `${row.from.padEnd(10)} ${row.to.padEnd(10)} ${row.azimuth.padStart(14)} ${row.distance.padStart(10)} ${row.sigmaAz95.padStart(7)} ${row.sigmaDist95.padStart(8)} ${row.ppm95.padStart(10)}`,
        );
      });
    }
  }
  const renderSideshotListingSection = (title: string, rows: typeof sideshotsForListing) => {
    if (rows.length === 0) return;
    lines.push('');
    addCenteredHeading(title);
    lines.push('');
    const tableRows = rows.map((row) => [
      row.from,
      row.to,
      row.sourceLine != null ? `1:${row.sourceLine}` : '-',
      row.mode,
      row.azimuth != null ? radToDmsStr(row.azimuth) : '-',
      row.azimuthSource ?? '-',
      (row.horizDistance * unitScale).toFixed(4),
      row.deltaH != null ? (row.deltaH * unitScale).toFixed(4) : '-',
      row.northing != null ? (row.northing * unitScale).toFixed(4) : '-',
      row.easting != null ? (row.easting * unitScale).toFixed(4) : '-',
      row.height != null ? (row.height * unitScale).toFixed(4) : '-',
      row.sigmaN != null ? (row.sigmaN * unitScale).toFixed(4) : '-',
      row.sigmaE != null ? (row.sigmaE * unitScale).toFixed(4) : '-',
      row.sigmaH != null ? (row.sigmaH * unitScale).toFixed(4) : '-',
      row.note ?? '-',
    ]);
    renderTextTable(
      [
        'From',
        'To',
        'File:Line',
        'Mode',
        'Az',
        'AzSrc',
        `HD (${linearUnit})`,
        `dH (${linearUnit})`,
        `Northing (${linearUnit})`,
        `Easting (${linearUnit})`,
        `Height (${linearUnit})`,
        `σN (${linearUnit})`,
        `σE (${linearUnit})`,
        `σH (${linearUnit})`,
        'Note',
      ],
      tableRows,
      [6, 7, 8, 9, 10, 11, 12, 13],
    );
  };
  renderSideshotListingSection('Post-Adjusted Sideshots (TS)', tsSideshotsForListing);
  renderSideshotListingSection('Post-Adjusted GPS Sideshot Vectors', gpsVectorSideshotsForListing);
  renderSideshotListingSection(
    'Post-Adjusted GNSS Topo Coordinates (GS)',
    gpsCoordinateSideshotsForListing,
  );
  if (gpsOffsetObservations.length > 0) {
    lines.push('');
    addCenteredHeading('GPS Rover Offset Observations');
    lines.push('');
    const gpsOffsetRows = gpsOffsetObservations.map((obs) => [
      obs.from,
      obs.to,
      obs.sourceLine != null ? `1:${obs.sourceLine}` : '-',
      obs.gpsOffsetSourceLine != null ? `1:${obs.gpsOffsetSourceLine}` : '-',
      obs.gpsOffsetAzimuthRad != null ? radToDmsStr(obs.gpsOffsetAzimuthRad) : '-',
      obs.gpsOffsetDistanceM != null ? (obs.gpsOffsetDistanceM * unitScale).toFixed(4) : '-',
      obs.gpsOffsetZenithRad != null ? radToDmsStr(obs.gpsOffsetZenithRad) : '-',
      obs.gpsOffsetDeltaE != null ? (obs.gpsOffsetDeltaE * unitScale).toFixed(4) : '-',
      obs.gpsOffsetDeltaN != null ? (obs.gpsOffsetDeltaN * unitScale).toFixed(4) : '-',
      obs.gpsOffsetDeltaH != null ? (obs.gpsOffsetDeltaH * unitScale).toFixed(4) : '-',
    ]);
    renderTextTable(
      [
        'From',
        'To',
        'G Line',
        'G4 Line',
        'Az',
        `Slope (${linearUnit})`,
        'Zenith',
        `dE (${linearUnit})`,
        `dN (${linearUnit})`,
        `dH (${linearUnit})`,
      ],
      gpsOffsetRows,
      [5, 7, 8, 9],
    );
  }
  if (gpsLoopDiagnostics?.enabled) {
    lines.push('');
    addCenteredHeading('GPS Loop Diagnostics');
    lines.push('');
    lines.push(
      `vectors=${gpsLoopDiagnostics.vectorCount}, loops=${gpsLoopDiagnostics.loopCount}, pass=${gpsLoopDiagnostics.passCount}, warn=${gpsLoopDiagnostics.warnCount}, tolerance=${(gpsLoopDiagnostics.thresholds.baseToleranceM * unitScale).toFixed(4)}${linearUnit}+${gpsLoopDiagnostics.thresholds.ppmTolerance}ppm*dist`,
    );
    lines.push('');
    const gpsLoopRows = gpsLoopDiagnostics.loops.map((loop) => [
      String(loop.rank),
      loop.key,
      loop.pass ? 'PASS' : 'WARN',
      (loop.closureMag * unitScale).toFixed(4),
      (loop.toleranceM * unitScale).toFixed(4),
      loop.linearPpm != null ? loop.linearPpm.toFixed(1) : '-',
      loop.closureRatio != null ? `1:${loop.closureRatio.toFixed(0)}` : '-',
      loop.severity.toFixed(2),
      loop.sourceLines.length > 0 ? loop.sourceLines.join(',') : '-',
      loop.stationPath.join('->'),
    ]);
    renderTextTable(
      [
        '#',
        'Loop',
        'Status',
        `Closure (${linearUnit})`,
        `Tol (${linearUnit})`,
        'Linear (ppm)',
        'Ratio',
        'Severity',
        'Lines',
        'Path',
      ],
      gpsLoopRows,
      [3, 4, 5, 7],
    );
  }
  if (levelingLoopDiagnostics?.enabled) {
    lines.push('');
    addCenteredHeading('Differential Leveling Loop Diagnostics');
    lines.push('');
    lines.push(
      `observations=${levelingLoopDiagnostics.observationCount}, loops=${levelingLoopDiagnostics.loopCount}, pass=${levelingLoopDiagnostics.passCount}, warn=${levelingLoopDiagnostics.warnCount}, totalLength=${levelingLoopDiagnostics.totalLengthKm.toFixed(3)}km, warnLength=${levelingLoopDiagnostics.warnTotalLengthKm.toFixed(3)}km, tolerance=${levelingLoopDiagnostics.thresholds.baseMm.toFixed(2)}mm+${levelingLoopDiagnostics.thresholds.perSqrtKmMm.toFixed(2)}mm*sqrt(km), worst|dH|=${levelingLoopDiagnostics.worstClosure != null ? (levelingLoopDiagnostics.worstClosure * unitScale).toFixed(4) : '-'}${linearUnit}`,
    );
    lines.push('');
    const levelingLoopRows = levelingLoopDiagnostics.loops.map((loop) => [
      String(loop.rank),
      loop.key,
      loop.pass ? 'PASS' : 'WARN',
      (loop.closure * unitScale).toFixed(4),
      (loop.absClosure * unitScale).toFixed(4),
      loop.loopLengthKm.toFixed(3),
      loop.toleranceMm.toFixed(2),
      loop.closurePerSqrtKmMm.toFixed(2),
      loop.sourceLines.length > 0 ? loop.sourceLines.join(',') : '-',
      loop.stationPath.join('->'),
    ]);
    renderTextTable(
      ['#', 'Loop', 'Status', `dH (${linearUnit})`, `|dH| (${linearUnit})`, 'Len (km)', 'Tol (mm)', 'mm/sqrt(km)', 'Lines', 'Path'],
      levelingLoopRows,
      [3, 4, 5, 6, 7],
    );
    lines.push('');
    const levelingSegmentRows = levelingLoopDiagnostics.loops.flatMap((loop) =>
      loop.segments.map((segment, index) => [
        loop.key,
        String(index + 1),
        segment.from,
        segment.to,
        (segment.observedDh * unitScale).toFixed(4),
        segment.lengthKm.toFixed(3),
        segment.sourceLine != null ? String(segment.sourceLine) : '-',
        segment.closureLeg ? 'Closure' : 'Traverse',
      ]),
    );
    renderTextTable(
      ['Loop', 'Seg', 'From', 'To', `dH (${linearUnit})`, 'Len (km)', 'Line', 'Role'],
      levelingSegmentRows,
      [1, 4, 5, 6],
    );
    if (levelingLoopDiagnostics.suspectSegments.length > 0) {
      lines.push('');
      const levelingSuspectRows = levelingLoopDiagnostics.suspectSegments.map((segment) => [
        String(segment.rank),
        `${segment.from}->${segment.to}`,
        segment.sourceLine != null ? String(segment.sourceLine) : '-',
        String(segment.warnLoopCount),
        segment.suspectScore.toFixed(2),
        (segment.maxAbsDh * unitScale).toFixed(4),
        segment.worstLoopKey ?? '-',
      ]);
      renderTextTable(
        ['#', 'Segment', 'Line', 'WarnLoops', 'Score', `Max |dH| (${linearUnit})`, 'Worst Loop'],
        levelingSuspectRows,
        [2, 3, 4, 5],
      );
    }
  }

  if (settings.listingShowErrorPropagation) {
    const ellipse95Scale = 2.4477;
    lines.push('');
    addCenteredHeading('Error Propagation');

    lines.push('');
    lines.push(
      `${isPreanalysis ? 'Predicted Station Coordinate Standard Deviations' : 'Station Coordinate Standard Deviations'} (${linearUnit})`,
    );
    lines.push('');
    const stdRows = stationEntriesForListing.map(([id, st]) => [
      id,
      stationDescription(id) || '-',
      ((st.sN ?? 0) * unitScale).toFixed(6),
      ((st.sE ?? 0) * unitScale).toFixed(6),
    ]);
    renderTextTable(['Station', 'Description', 'N', 'E'], stdRows, [2, 3]);

    lines.push('');
    lines.push(
      `${isPreanalysis ? 'Predicted Station Coordinate Error Ellipses' : 'Station Coordinate Error Ellipses'} (${linearUnit})`,
    );
    lines.push('                            Confidence Region = 95%');
    lines.push('');
    const stationEllipseRows = stationEntriesForListing
      .filter(([, st]) => st.errorEllipse != null)
      .map(([id, st]) => [
        id,
        ((st.errorEllipse?.semiMajor ?? 0) * ellipse95Scale * unitScale).toFixed(6),
        ((st.errorEllipse?.semiMinor ?? 0) * ellipse95Scale * unitScale).toFixed(6),
        formatEllipseAzDm(st.errorEllipse?.theta),
      ]);
    if (stationEllipseRows.length > 0) {
      lines.push('Station                 Semi-Major    Semi-Minor   Azimuth of');
      lines.push('                            Axis          Axis     Major Axis');
      stationEllipseRows.forEach((row) => {
        lines.push(
          `${row[0].padEnd(22)} ${row[1].padStart(12)} ${row[2].padStart(12)} ${row[3].padStart(10)}`,
        );
      });
    } else {
      lines.push('(none)');
    }

    lines.push('');
    lines.push(
      `${isPreanalysis ? 'Predicted Relative Error Ellipses' : 'Relative Error Ellipses'} (${linearUnit})`,
    );
    lines.push('                            Confidence Region = 95%');
    lines.push('');
    const relativeEllipseRows = relationshipRows
      .filter((row) => row.ellipse != null)
      .map((row) => [
        row.from,
        row.to,
        ((row.ellipse?.semiMajor ?? 0) * ellipse95Scale * unitScale).toFixed(6),
        ((row.ellipse?.semiMinor ?? 0) * ellipse95Scale * unitScale).toFixed(6),
        formatEllipseAzDm(row.ellipse?.theta),
      ]);
    if (relativeEllipseRows.length > 0) {
      lines.push('Stations                Semi-Major    Semi-Minor   Azimuth of');
      lines.push('From       To               Axis          Axis     Major Axis');
      relativeEllipseRows.forEach((row) => {
        lines.push(
          `${row[0].padEnd(10)} ${row[1].padEnd(10)} ${row[2].padStart(12)} ${row[3].padStart(12)} ${row[4].padStart(10)}`,
        );
      });
    } else {
      lines.push('(none)');
    }

    if (isPreanalysis && res.weakGeometryDiagnostics) {
      const flaggedStations = res.weakGeometryDiagnostics.stationCues.filter(
        (cue) => cue.severity !== 'ok',
      );
      const flaggedPairs = res.weakGeometryDiagnostics.relativeCues.filter(
        (cue) => cue.severity !== 'ok',
      );
      lines.push('');
      lines.push('Weak Geometry Cues');
      lines.push('');
      lines.push(
        `stationMedian=${(res.weakGeometryDiagnostics.stationMedianHorizontal * unitScale).toFixed(6)} ${linearUnit}; pairMedian=${
          res.weakGeometryDiagnostics.relativeMedianDistance != null
            ? `${(res.weakGeometryDiagnostics.relativeMedianDistance * unitScale).toFixed(6)} ${linearUnit}`
            : '-'
        }`,
      );
      if (flaggedStations.length === 0 && flaggedPairs.length === 0) {
        lines.push('(none)');
      } else {
        flaggedStations.forEach((cue) => {
          lines.push(
            `  Station ${cue.stationId}: ${cue.severity.toUpperCase()} metric=${(
              cue.horizontalMetric * unitScale
            ).toFixed(6)} ${linearUnit} ratio=${
              cue.relativeToMedian != null ? `${cue.relativeToMedian.toFixed(2)}x` : '-'
            } shape=${cue.ellipseRatio != null ? `${cue.ellipseRatio.toFixed(2)}x` : '-'} ${cue.note}`,
          );
        });
        flaggedPairs.forEach((cue) => {
          lines.push(
            `  Pair ${cue.from}-${cue.to}: ${cue.severity.toUpperCase()} metric=${
              cue.distanceMetric != null
                ? `${(cue.distanceMetric * unitScale).toFixed(6)} ${linearUnit}`
                : '-'
            } ratio=${cue.relativeToMedian != null ? `${cue.relativeToMedian.toFixed(2)}x` : '-'} shape=${
              cue.ellipseRatio != null ? `${cue.ellipseRatio.toFixed(2)}x` : '-'
            } ${cue.note}`,
          );
        });
      }
    }
  }
  if (res.autoAdjustDiagnostics?.enabled) {
    const ad = res.autoAdjustDiagnostics;
    lines.push('');
    lines.push('                             Auto-Adjust Diagnostics');
    lines.push('                             =======================');
    lines.push('');
    lines.push(
      `Threshold: |t|>=${ad.threshold.toFixed(2)}   MaxCycles: ${ad.maxCycles}   MaxRemovals/Cycle: ${ad.maxRemovalsPerCycle}   MinRedund: ${ad.minRedundancy.toFixed(2)}   Stop: ${ad.stopReason}   Removed: ${ad.removed.length}`,
    );
    lines.push('Cycle      SEUW      Max|t|   Removals');
    ad.cycles.forEach((cycle) => {
      lines.push(
        `${String(cycle.cycle).padStart(5)} ${cycle.seuw.toFixed(4).padStart(10)} ${cycle.maxAbsStdRes.toFixed(2).padStart(9)} ${String(cycle.removals.length).padStart(10)}`,
      );
    });
    if (ad.removed.length > 0) {
      lines.push('');
      lines.push('Removed Observations');
      lines.push('ObsID    Type        Stations                 Line    |t|     Redund   Reason');
      ad.removed.forEach((row) => {
        lines.push(
          `${String(row.obsId).padStart(5)}    ${row.type.toUpperCase().padEnd(10)}  ${row.stations.padEnd(22)}  ${String(row.sourceLine ?? '-').padStart(4)}  ${row.stdRes.toFixed(2).padStart(6)}  ${(row.redundancy != null ? row.redundancy.toFixed(3) : '-').padStart(7)}  ${row.reason}`,
        );
      });
    }
  }
  if (res.autoSideshotDiagnostics?.enabled) {
    const sd = res.autoSideshotDiagnostics;
    lines.push('');
    lines.push('                         Auto Sideshot Candidates (M Records)');
    lines.push('                         =====================================');
    lines.push('');
    lines.push(
      `Evaluated: ${sd.evaluatedCount}   Candidates: ${sd.candidateCount}   Excluded Control Targets: ${sd.excludedControlCount}   Threshold: minRedund < ${sd.threshold.toFixed(2)}`,
    );
    if (sd.candidates.length > 0) {
      lines.push(
        'Line    Occupy       Backsight    Target      AngleObs  DistObs  AngleRed  DistRed   MinRed   Max|t|',
      );
      sd.candidates.forEach((row) => {
        lines.push(
          `${String(row.sourceLine ?? '-').padStart(4)}    ${row.occupy.padEnd(10)} ${row.backsight.padEnd(12)} ${row.target.padEnd(10)} ${String(row.angleObsId).padStart(8)} ${String(row.distObsId).padStart(8)} ${row.angleRedundancy.toFixed(3).padStart(8)} ${row.distRedundancy.toFixed(3).padStart(8)} ${row.minRedundancy.toFixed(6)} ${row.maxAbsStdRes.toFixed(2).padStart(8)}`,
        );
      });
    } else {
      lines.push('(none)');
    }
  }
  if (res.clusterDiagnostics?.enabled) {
    const outcomes = res.clusterDiagnostics.mergeOutcomes ?? [];
    const rejected = res.clusterDiagnostics.rejectedProposals ?? [];
    lines.push('');
    lines.push('                          Cluster Detection Candidates');
    lines.push('                          ============================');
    lines.push('');
    lines.push(
      `Pass: ${res.clusterDiagnostics.passMode.toUpperCase()}   Mode: ${res.clusterDiagnostics.linkageMode.toUpperCase()}   Dim: ${res.clusterDiagnostics.dimension}   Tol: ${(res.clusterDiagnostics.tolerance * unitScale).toFixed(4)} ${linearUnit}   PairHits: ${res.clusterDiagnostics.pairCount}   Candidates: ${res.clusterDiagnostics.candidateCount}   ApprovedMerges: ${res.clusterDiagnostics.approvedMergeCount ?? 0}   MergeOutcomes: ${outcomes.length}   Rejected: ${rejected.length}`,
    );
    if (res.clusterDiagnostics.candidates.length > 0) {
      lines.push(
        'Key               Rep          Members   MaxSep        MeanSep       Flags           Station IDs',
      );
      res.clusterDiagnostics.candidates.forEach((c) => {
        const flags = `${c.hasFixed ? 'fixed' : 'free'}${c.hasUnknown ? '+unknown' : ''}`;
        lines.push(
          `${c.key.padEnd(17)} ${c.representativeId.padEnd(12)} ${String(c.memberCount).padStart(7)} ${(
            c.maxSeparation * unitScale
          )
            .toFixed(4)
            .padStart(12)} ${(c.meanSeparation * unitScale)
            .toFixed(4)
            .padStart(12)} ${flags.padEnd(15)} ${c.stationIds.join(', ')}`,
        );
      });
    }
    if (outcomes.length > 0) {
      lines.push('');
      lines.push('                     Cluster Merge Outcomes (Delta From Retained Point)');
      lines.push('                     ====================================================');
      lines.push('');
      lines.push(
        'Alias             Canonical         dE           dN           dH           d2D          d3D          Status',
      );
      outcomes.forEach((row) => {
        lines.push(
          `${row.aliasId.padEnd(17)} ${row.canonicalId.padEnd(17)} ${(row.deltaE != null ? (row.deltaE * unitScale).toFixed(4) : '-').padStart(12)} ${(row.deltaN != null ? (row.deltaN * unitScale).toFixed(4) : '-').padStart(12)} ${(row.deltaH != null ? (row.deltaH * unitScale).toFixed(4) : '-').padStart(12)} ${(row.horizontalDelta != null ? (row.horizontalDelta * unitScale).toFixed(4) : '-').padStart(12)} ${(row.spatialDelta != null ? (row.spatialDelta * unitScale).toFixed(4) : '-').padStart(12)} ${row.missing ? 'MISSING PASS1 DATA' : 'OK'}`,
        );
      });
    }
    if (rejected.length > 0) {
      lines.push('');
      lines.push('                               Rejected Cluster Proposals');
      lines.push('                               ==========================');
      lines.push('');
      lines.push(
        'Key               Rep          Members   Retained       Station IDs                      Reason',
      );
      rejected.forEach((row) => {
        lines.push(
          `${row.key.padEnd(17)} ${row.representativeId.padEnd(12)} ${String(row.memberCount).padStart(7)} ${(row.retainedId ?? '-').padEnd(14)} ${row.stationIds.join(', ').padEnd(30)} ${row.reason}`,
        );
      });
    }
  }
  if (descriptionScanSummary.length > 0) {
    lines.push('');
    lines.push('                     Description Reconciliation Summary');
    lines.push('                     ==================================');
    lines.push('');
    lines.push(
      `Mode: ${descriptionReconcileMode.toUpperCase()}${descriptionReconcileMode === 'append' ? ` (delimiter="${descriptionAppendDelimiter}")` : ''}   Stations: ${descriptionScanSummary.length}   Repeated: ${parseState?.descriptionRepeatedStationCount ?? 0}   Conflicts: ${parseState?.descriptionConflictCount ?? 0}`,
    );
    lines.push('Station      Records  Unique  Conflict  Description@Lines');
    descriptionScanSummary
      .slice()
      .sort((a, b) => a.stationId.localeCompare(b.stationId, undefined, { numeric: true }))
      .forEach((row) => {
        const details = (descriptionRefsByStation.get(row.stationId) ?? [])
          .map((detail) => {
            const linesRef = detail.lines
              .slice()
              .sort((a, b) => a - b)
              .join(',');
            return `${detail.description}[${linesRef}]`;
          })
          .join('; ');
        lines.push(
          `${row.stationId.padEnd(11)}${String(row.recordCount).padStart(8)}${String(row.uniqueCount).padStart(8)}  ${(row.conflict ? 'YES' : 'no ').padEnd(8)}  ${details || '-'}`,
        );
      });
  }
  if (aliasTrace.length > 0) {
    lines.push('');
    lines.push('                          Alias Canonicalization Trace');
    lines.push('                          ============================');
    lines.push('');
    lines.push(
      'Context    Detail              Line  Source Alias         Canonical ID         Reference',
    );
    aliasTrace.forEach((entry) => {
      lines.push(
        `${entry.context.padEnd(10)}${(entry.detail ?? '-').padEnd(20)}${String(entry.sourceLine ?? '-').padStart(6)}  ${entry.sourceId.padEnd(20)}${entry.canonicalId.padEnd(20)}${entry.reference ?? '-'}`,
      );
    });
  }
  return lines.join('\n');
};
