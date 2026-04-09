import { RAD_TO_DEG, radToDmsStr } from './angles';
import { findLevelLoopTolerancePreset } from './levelLoopTolerance';
import { buildResultTraceabilityModel } from './resultDerivedModels';
import { INDUSTRY_CONFIDENCE_95_SCALE } from './resultPrecision';
import type { ParseSettings, RunDiagnostics, SettingsState } from '../appStateTypes';
import type { AdjustmentResult, CustomLevelLoopTolerancePreset, Observation } from '../types';

const FT_PER_M = 3.280839895;

type BuildRunDiagnostics = (_base: ParseSettings, _solved?: AdjustmentResult) => RunDiagnostics;

interface CreateRunResultsTextBuilderArgs {
  settings: SettingsState;
  parseSettings: ParseSettings;
  runDiagnostics: RunDiagnostics | null;
  levelLoopCustomPresets: CustomLevelLoopTolerancePreset[];
  buildRunDiagnostics: BuildRunDiagnostics;
}

const findCustomLevelLoopTolerancePreset = (
  presets: CustomLevelLoopTolerancePreset[],
  baseMm: number,
  perSqrtKmMm: number,
): CustomLevelLoopTolerancePreset | undefined =>
  presets.find(
    (preset) =>
      Math.abs(preset.baseMm - baseMm) <= 1e-9 &&
      Math.abs(preset.perSqrtKmMm - perSqrtKmMm) <= 1e-9,
  );

const resolveLevelLoopTolerancePreset = (
  presets: CustomLevelLoopTolerancePreset[],
  baseMm: number,
  perSqrtKmMm: number,
): { id: string; label: string; description: string } => {
  const builtin = findLevelLoopTolerancePreset(baseMm, perSqrtKmMm);
  if (builtin) {
    return {
      id: builtin.id,
      label: builtin.label,
      description: builtin.description,
    };
  }
  const custom = findCustomLevelLoopTolerancePreset(presets, baseMm, perSqrtKmMm);
  if (custom) {
    return {
      id: custom.id,
      label: custom.name.trim() || 'Custom Preset',
      description: `Saved custom tolerance model (${custom.baseMm.toFixed(1)} + ${custom.perSqrtKmMm.toFixed(1)}*sqrt(km)).`,
    };
  }
  return {
    id: 'custom',
    label: 'Custom',
    description: 'Custom tolerance model: edits to Base or K leave the preset selector on Custom.',
  };
};

export const createRunResultsTextBuilder = ({
  settings,
  parseSettings,
  runDiagnostics,
  levelLoopCustomPresets,
  buildRunDiagnostics,
}: CreateRunResultsTextBuilderArgs) => {
  const buildResultsText = (res: AdjustmentResult): string => {
    const lines: string[] = [];
    const now = new Date();
    const ellipse95Scale = INDUSTRY_CONFIDENCE_95_SCALE;
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
          .map((obs) => {
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
              const diff = angular
                ? Math.abs(residual * RAD_TO_DEG * 3600)
                : Math.abs(residual) * unitScale;
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
              const vU = Number.isFinite(residual.vU as number)
                ? (residual.vU as number)
                : 0;
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
          })
          .filter((row): row is NonNullable<typeof row> => row != null)
          .sort((a, b) => b.diff - a.diff)
          .slice(0, 25)
      : [];
    lines.push(`# WebNet Adjustment Results`);
    lines.push(`# Generated: ${now.toLocaleString()}`);
    lines.push(`# Linear units: ${linearUnit}`);
    lines.push(
      `# Reduction: profile=${runDiag.solveProfile}, runMode=${runModeProfileText}, autoSideshot=${runDiag.autoSideshotEnabled ? 'ON' : 'OFF'}, autoAdjust=${runDiag.autoAdjustEnabled ? 'ON' : 'OFF'}(|t|>=${runDiag.autoAdjustStdResThreshold.toFixed(2)},cycles=${runDiag.autoAdjustMaxCycles},maxRm=${runDiag.autoAdjustMaxRemovalsPerCycle}), dirSets=${runDiag.directionSetMode}, mapMode=${runDiag.mapMode}, mapScale=${runDiag.mapScaleFactor.toFixed(8)}, crsScale=${runDiag.crsGridScaleEnabled ? `ON(${runDiag.crsGridScaleFactor.toFixed(8)})` : 'OFF'}, crsConv=${runDiag.crsConvergenceEnabled ? `ON(${(runDiag.crsConvergenceAngleRad * RAD_TO_DEG).toFixed(6)}deg)` : 'OFF'}, geoid=${runDiag.geoidModelEnabled ? `ON(${runDiag.geoidModelId},${runDiag.geoidInterpolation.toUpperCase()})` : 'OFF'}, geoidH=${runDiag.geoidHeightConversionEnabled ? `ON(${runDiag.geoidOutputHeightDatum.toUpperCase()},conv=${runDiag.geoidConvertedStationCount},skip=${runDiag.geoidSkippedStationCount})` : 'OFF'}, gpsLoop=${runDiag.gpsLoopCheckEnabled ? 'ON' : 'OFF'}, levelLoopTol=${runDiag.levelLoopToleranceBaseMm.toFixed(2)}mm+${runDiag.levelLoopTolerancePerSqrtKmMm.toFixed(2)}mm*sqrt(km), gpsAddHiHt=${runDiag.gpsAddHiHtEnabled ? `ON(HI=${(runDiag.gpsAddHiHtHiM * unitScale).toFixed(4)}${linearUnit},HT=${(runDiag.gpsAddHiHtHtM * unitScale).toFixed(4)}${linearUnit})` : 'OFF'}, curvRef=${runDiag.applyCurvatureRefraction ? 'ON' : 'OFF'}, k=${runDiag.refractionCoefficient.toFixed(3)}, vRed=${runDiag.verticalReduction}, qfixLin=${(runDiag.qFixLinearSigmaM * unitScale).toExponential(6)}${linearUnit}, qfixAng=${runDiag.qFixAngularSigmaSec.toExponential(6)}sec, prism=${runDiag.prismEnabled ? `ON(${runDiag.prismOffset.toFixed(4)}m,${runDiag.prismScope})` : 'OFF'}, rotation=${(runDiag.rotationAngleRad * RAD_TO_DEG).toFixed(6)}deg, tsCorr=${runDiag.tsCorrelationEnabled ? 'ON' : 'OFF'}(${runDiag.tsCorrelationScope},rho=${runDiag.tsCorrelationRho.toFixed(3)}), robust=${runDiag.robustMode.toUpperCase()}(k=${runDiag.robustK.toFixed(2)})`,
    );
    lines.push(
      `# Parity: profileFallback=${runDiag.profileDefaultInstrumentFallback ? 'ON' : 'OFF'}, angleCentering=${runDiag.angleCenteringModel}, faceNormalize=${runDiag.faceNormalizationMode.toUpperCase()}(normalize=${runDiag.normalize ? 'ON' : 'OFF'}), angleMode=${runDiag.angleMode.toUpperCase()}`,
    );
    lines.push('');
    lines.push('--- Solve Profile Diagnostics ---');
    lines.push(`Profile: ${runDiag.solveProfile.toUpperCase()}`);
    lines.push(`Run mode: ${runModeSummaryText}`);
    if (isDataCheckMode) {
      lines.push('Data Check Only: Differences from Observations');
      dataCheckDiffRows.forEach((row, idx) => {
        lines.push(
          `  #${idx + 1} ${row.obs.type.toUpperCase()} ${row.stations} diff=${row.label} |t|=${
            row.obs.stdRes != null && Number.isFinite(row.obs.stdRes)
              ? Math.abs(row.obs.stdRes).toFixed(2)
              : '-'
          } line=${row.obs.sourceLine ?? '-'}`,
        );
      });
    }
    if (isBlunderDetectMode) {
      lines.push(
        'Blunder Detect Warning: iterative deweighting diagnostics (not a replacement for full adjustment QA).',
      );
      res.logs
        .filter((line) => line.startsWith('Blunder cycle '))
        .slice(0, 20)
        .forEach((line) => lines.push(`  ${line}`));
    }
    lines.push(`Direction-set mode: ${runDiag.directionSetMode}`);
    lines.push(`Auto-sideshot detection: ${runDiag.autoSideshotEnabled ? 'ON' : 'OFF'}`);
    lines.push(
      `Auto-adjust: ${runDiag.autoAdjustEnabled ? `ON (|t|>=${runDiag.autoAdjustStdResThreshold.toFixed(2)}, maxCycles=${runDiag.autoAdjustMaxCycles}, maxRemovalsPerCycle=${runDiag.autoAdjustMaxRemovalsPerCycle})` : 'OFF'}`,
    );
    lines.push(`Suspect impact: ${runDiag.suspectImpactMode.toUpperCase()}`);
    if (res.solveTimingProfile) {
      lines.push(
        `Solve timing (ms): total=${res.solveTimingProfile.totalMs.toFixed(1)}, setup=${res.solveTimingProfile.parseAndSetupMs.toFixed(1)}, assembly=${res.solveTimingProfile.equationAssemblyMs.toFixed(1)}, factor=${res.solveTimingProfile.matrixFactorizationMs.toFixed(1)}, precision=${res.solveTimingProfile.precisionPropagationMs.toFixed(1)}, report=${res.solveTimingProfile.reportDiagnosticsMs.toFixed(1)}, packaging=${res.solveTimingProfile.resultPackagingMs.toFixed(1)}, other=${res.solveTimingProfile.otherMs.toFixed(1)}`,
      );
    }
    lines.push(
      `industry default instrument fallback: ${runDiag.profileDefaultInstrumentFallback ? 'ON' : 'OFF'}`,
    );
    lines.push(`Angle centering model: ${runDiag.angleCenteringModel}`);
    lines.push(
      `TS correlation: ${runDiag.tsCorrelationEnabled ? `ON (${runDiag.tsCorrelationScope}, rho=${runDiag.tsCorrelationRho.toFixed(3)})` : 'OFF'}`,
    );
    lines.push(
      `Prism correction: ${runDiag.prismEnabled ? `ON (${runDiag.prismOffset.toFixed(4)} m, scope=${runDiag.prismScope})` : 'OFF'}`,
    );
    lines.push(
      `Plan rotation: ${Math.abs(runDiag.rotationAngleRad) > 1e-12 ? `ON (${(runDiag.rotationAngleRad * RAD_TO_DEG).toFixed(6)} deg)` : 'OFF'}`,
    );
    lines.push(
      `Coordinate system mode: ${runDiag.coordSystemMode.toUpperCase()} (CRS=${runDiag.crsId})`,
    );
    if (runDiag.coordSystemMode === 'local') {
      lines.push(
        `Local datum scheme: ${runDiag.localDatumScheme.toUpperCase()} (scale=${runDiag.averageScaleFactor.toFixed(8)}, commonElev=${(runDiag.commonElevation * unitScale).toFixed(4)} ${linearUnit})`,
      );
    } else {
      lines.push(
        `Grid observation modes: bearing=${runDiag.gridBearingMode.toUpperCase()}, distance=${runDiag.gridDistanceMode.toUpperCase()}, angle=${runDiag.gridAngleMode.toUpperCase()}, direction=${runDiag.gridDirectionMode.toUpperCase()}`,
      );
      lines.push(
        `.SCALE override: ${runDiag.scaleOverrideActive ? `ON (k=${runDiag.averageScaleFactor.toFixed(8)})` : 'OFF'}`,
      );
      lines.push(
        `GNSS frame default: ${runDiag.gnssVectorFrameDefault} (confirmed=${runDiag.gnssFrameConfirmed ? 'YES' : 'NO'})`,
      );
    }
    lines.push(
      `Average geoid height fallback: ${(runDiag.averageGeoidHeight * unitScale).toFixed(4)} ${linearUnit}`,
    );
    lines.push(
      `CRS grid-ground scale: ${runDiag.crsGridScaleEnabled ? `ON (factor=${runDiag.crsGridScaleFactor.toFixed(8)})` : 'OFF'}`,
    );
    lines.push(
      `CRS convergence: ${runDiag.crsConvergenceEnabled ? `ON (${(runDiag.crsConvergenceAngleRad * RAD_TO_DEG).toFixed(6)} deg)` : 'OFF'}`,
    );
    if (runDiag.coordSystemMode === 'grid') {
      lines.push(
        `CRS datum operation: ${runDiag.crsDatumOpId ?? 'unknown'}${runDiag.crsDatumFallbackUsed ? ' (fallback)' : ''}`,
      );
      lines.push(
        `CRS area-of-use status: ${runDiag.crsAreaOfUseStatus.toUpperCase()}${runDiag.crsAreaOfUseStatus === 'outside' ? ` (outside stations=${runDiag.crsOutOfAreaStationCount})` : ''}`,
      );
    }
    if (runDiag.coordSystemDiagnostics.length > 0) {
      lines.push(`Coord-system diagnostics: ${runDiag.coordSystemDiagnostics.join(', ')}`);
    }
    if (runDiag.datumSufficiencyReport) {
      lines.push(
        `Datum sufficiency: ${runDiag.datumSufficiencyReport.status.toUpperCase()}${runDiag.datumSufficiencyReport.reasons.length > 0 ? ` (${runDiag.datumSufficiencyReport.reasons.length} reason${runDiag.datumSufficiencyReport.reasons.length === 1 ? '' : 's'})` : ''}`,
      );
      runDiag.datumSufficiencyReport.reasons.forEach((reason) => {
        lines.push(`Datum reason: ${reason}`);
      });
      runDiag.datumSufficiencyReport.suggestions.forEach((suggestion) => {
        lines.push(`Datum suggestion: ${suggestion}`);
      });
    }
    if (runDiag.coordSystemWarningMessages.length > 0) {
      runDiag.coordSystemWarningMessages.slice(0, 20).forEach((warning) => {
        lines.push(`Coord-system warning: ${warning}`);
      });
      if (runDiag.coordSystemWarningMessages.length > 20) {
        lines.push(
          `Coord-system warning overflow: +${runDiag.coordSystemWarningMessages.length - 20} more`,
        );
      }
    }
    lines.push(
      `Geoid/Grid model: ${runDiag.geoidModelEnabled ? `ON (${runDiag.geoidModelId}, interp=${runDiag.geoidInterpolation.toUpperCase()}, loaded=${runDiag.geoidModelLoaded ? 'YES' : 'NO'})` : 'OFF'}`,
    );
    lines.push(
      `Geoid/Grid source: format=${runDiag.geoidSourceFormat.toUpperCase()}${runDiag.geoidSourcePath ? `, path=${runDiag.geoidSourcePath}` : ''}, resolved=${runDiag.geoidSourceResolvedFormat.toUpperCase()}, fallback=${runDiag.geoidSourceFallbackUsed ? 'YES' : 'NO'}`,
    );
    if (runDiag.geoidModelEnabled) {
      lines.push(
        `Geoid metadata: ${runDiag.geoidModelMetadata || 'unavailable'}${runDiag.geoidSampleUndulationM != null ? `; sampleN=${runDiag.geoidSampleUndulationM.toFixed(4)}m` : ''}`,
      );
    }
    lines.push(
      `Geoid height conversion: ${runDiag.geoidHeightConversionEnabled ? `ON (target=${runDiag.geoidOutputHeightDatum.toUpperCase()}, converted=${runDiag.geoidConvertedStationCount}, skipped=${runDiag.geoidSkippedStationCount})` : 'OFF'}`,
    );
    lines.push(`GPS loop check: ${runDiag.gpsLoopCheckEnabled ? 'ON' : 'OFF'}`);
    const levelLoopPresetSummary = resolveLevelLoopTolerancePreset(
      levelLoopCustomPresets,
      runDiag.levelLoopToleranceBaseMm,
      runDiag.levelLoopTolerancePerSqrtKmMm,
    );
    lines.push(
      `Level loop tolerance: ${levelLoopPresetSummary.label} (base=${runDiag.levelLoopToleranceBaseMm.toFixed(2)} mm, k=${runDiag.levelLoopTolerancePerSqrtKmMm.toFixed(2)} mm/sqrt(km))`,
    );
    lines.push(
      `GPS AddHiHt defaults: ${runDiag.gpsAddHiHtEnabled ? `ON (HI=${(runDiag.gpsAddHiHtHiM * unitScale).toFixed(4)} ${linearUnit}, HT=${(runDiag.gpsAddHiHtHtM * unitScale).toFixed(4)} ${linearUnit})` : 'OFF'}`,
    );
    if (runDiag.gpsAddHiHtEnabled) {
      lines.push(
        `GPS AddHiHt preprocessing: vectors=${runDiag.gpsAddHiHtVectorCount}, adjusted=${runDiag.gpsAddHiHtAppliedCount} (+${runDiag.gpsAddHiHtPositiveCount}/-${runDiag.gpsAddHiHtNegativeCount}/neutral=${runDiag.gpsAddHiHtNeutralCount}), defaultZero=${runDiag.gpsAddHiHtDefaultZeroCount}, missingHeight=${runDiag.gpsAddHiHtMissingHeightCount}, scale[min=${runDiag.gpsAddHiHtScaleMin.toFixed(8)}, max=${runDiag.gpsAddHiHtScaleMax.toFixed(8)}]`,
      );
    }
    if (gpsLoopDiagnostics?.enabled) {
      lines.push(
        `GPS loop diagnostics: vectors=${gpsLoopDiagnostics.vectorCount}, loops=${gpsLoopDiagnostics.loopCount}, pass=${gpsLoopDiagnostics.passCount}, warn=${gpsLoopDiagnostics.warnCount}, tolerance=${(gpsLoopDiagnostics.thresholds.baseToleranceM * unitScale).toFixed(4)}${linearUnit}+${gpsLoopDiagnostics.thresholds.ppmTolerance}ppm*dist`,
      );
    }
    const lostStationIds = traceabilityModel.lostStationIds;
    lines.push(
      `Lost stations: ${lostStationIds.length > 0 ? `${lostStationIds.length} (${lostStationIds.join(', ')})` : 'none'}`,
    );
    lines.push(
      `QFIX constants: linear=${(runDiag.qFixLinearSigmaM * unitScale).toExponential(6)} ${linearUnit}, angular=${runDiag.qFixAngularSigmaSec.toExponential(6)}"`,
    );
    lines.push(
      `Description reconciliation: ${descriptionReconcileMode.toUpperCase()}${descriptionReconcileMode === 'append' ? ` (delimiter="${descriptionAppendDelimiter}")` : ''}`,
    );
    lines.push(`Show lost stations in export: ${showLostStationsInOutputs ? 'ON' : 'OFF'}`);
    lines.push(
      `Robust mode: ${runDiag.robustMode.toUpperCase()} (k=${runDiag.robustK.toFixed(2)})`,
    );
    lines.push(
      `Parse compatibility: mode=${runDiag.parseCompatibilityMode.toUpperCase()}, ambiguous=${runDiag.ambiguousCount}, fallbacks=${runDiag.legacyFallbackCount}, strictRejects=${runDiag.strictRejectCount}, rewrites=${runDiag.rewriteSuggestionCount}, migrated=${runDiag.parseModeMigrated ? 'YES' : 'NO'}`,
    );
    if (runDiag.parity && runDiag.parseCompatibilityMode === 'legacy') {
      lines.push(
        'Parse compatibility warning: industry-compatible profile is running in LEGACY parse mode; migrate to STRICT to lock deterministic grammar behavior.',
      );
    }
    lines.push(
      `Reductions: map=${runDiag.mapMode} (scale=${runDiag.mapScaleFactor.toFixed(8)}), crsScale=${runDiag.crsGridScaleEnabled ? `ON(${runDiag.crsGridScaleFactor.toFixed(8)})` : 'OFF'}, crsConv=${runDiag.crsConvergenceEnabled ? `ON(${(runDiag.crsConvergenceAngleRad * RAD_TO_DEG).toFixed(6)} deg)` : 'OFF'}, geoid=${runDiag.geoidModelEnabled ? `ON(${runDiag.geoidModelId},${runDiag.geoidInterpolation.toUpperCase()},loaded=${runDiag.geoidModelLoaded ? 'YES' : 'NO'})` : 'OFF'}, geoidH=${runDiag.geoidHeightConversionEnabled ? `ON(${runDiag.geoidOutputHeightDatum.toUpperCase()},conv=${runDiag.geoidConvertedStationCount},skip=${runDiag.geoidSkippedStationCount})` : 'OFF'}, gpsAddHiHt=${runDiag.gpsAddHiHtEnabled ? `ON(HI=${(runDiag.gpsAddHiHtHiM * unitScale).toFixed(4)}${linearUnit},HT=${(runDiag.gpsAddHiHtHtM * unitScale).toFixed(4)}${linearUnit})` : 'OFF'}, vRed=${runDiag.verticalReduction}, curvRef=${runDiag.applyCurvatureRefraction ? 'ON' : 'OFF'} (k=${runDiag.refractionCoefficient.toFixed(3)}), faceNormalize=${runDiag.faceNormalizationMode.toUpperCase()}(normalize=${runDiag.normalize ? 'ON' : 'OFF'})`,
    );
    lines.push(
      `Default sigmas used: ${runDiag.defaultSigmaCount}${runDiag.defaultSigmaByType ? ` (${runDiag.defaultSigmaByType})` : ''}`,
    );
    lines.push(`Stochastic defaults: ${runDiag.stochasticDefaultsSummary}`);
    if (
      (res.parseState?.aliasExplicitCount ?? 0) > 0 ||
      (res.parseState?.aliasRuleCount ?? 0) > 0
    ) {
      lines.push(
        `Alias canonicalization: explicit=${res.parseState?.aliasExplicitCount ?? 0}, rules=${res.parseState?.aliasRuleCount ?? 0}, references=${aliasTrace.length}`,
      );
      const aliasRules = res.parseState?.aliasRuleSummaries ?? [];
      if (aliasRules.length > 0) {
        lines.push(`Alias rules: ${aliasRules.map((r) => `${r.rule}@${r.sourceLine}`).join('; ')}`);
      }
    }
    const descriptionScanSummary = traceabilityModel.descriptionScanSummary;
    const descriptionTrace = traceabilityModel.descriptionTrace;
    if (descriptionScanSummary.length > 0) {
      lines.push(
        `Description scan: stations=${descriptionScanSummary.length}, repeated=${traceabilityModel.descriptionRepeatedStationCount}, conflicts=${traceabilityModel.descriptionConflictCount}`,
      );
      descriptionScanSummary
        .filter((row) => row.conflict)
        .slice(0, 20)
        .forEach((row) => {
          const details = descriptionTrace
            .filter((entry) => entry.stationId === row.stationId)
            .map((entry) => `${entry.description}[${entry.sourceLine}]`)
            .join('; ');
          lines.push(`  ${row.stationId}: ${details}`);
        });
    }
    lines.push('');
    lines.push(`Status: ${res.converged ? 'CONVERGED' : 'NOT CONVERGED'}`);
    lines.push(`Iterations: ${res.iterations}`);
    lines.push(
      isPreanalysis
        ? `A-priori sigma0: ${res.seuw.toFixed(4)} (predicted precision mode)`
        : `SEUW: ${res.seuw.toFixed(4)} (DOF: ${res.dof})`,
    );
    if (res.condition) {
      lines.push(
        `Normal matrix condition estimate: ${res.condition.estimate.toExponential(4)} (threshold ${res.condition.threshold.toExponential(
          2,
        )}) ${res.condition.flagged ? 'WARNING' : 'OK'}`,
      );
    }
    if (res.controlConstraints) {
      lines.push(
        `Weighted control constraints: ${res.controlConstraints.count} (E=${res.controlConstraints.x}, N=${res.controlConstraints.y}, H=${res.controlConstraints.h}, corrXY=${res.controlConstraints.xyCorrelated ?? 0})`,
      );
    }
    if (isPreanalysis) {
      lines.push(
        `Preanalysis summary: plannedObs=${res.parseState?.plannedObservationCount ?? 0}, stationCovBlocks=${outputStationCovariances.length}, connectedPairBlocks=${outputRelativeCovariances.length}`,
      );
      lines.push(
        'Residual-based QC: disabled (chi-square, suspect ranking, and exclusion workflows omitted).',
      );
    } else if (res.chiSquare) {
      lines.push(
        `Chi-square: T=${res.chiSquare.T.toFixed(4)} dof=${res.chiSquare.dof} p=${res.chiSquare.p.toFixed(
          4,
        )} (${res.chiSquare.pass95 ? 'PASS' : 'FAIL'} @95%)`,
      );
      lines.push(
        `Chi-square 95% interval: [${res.chiSquare.lower.toFixed(4)}, ${res.chiSquare.upper.toFixed(
          4,
        )}]`,
      );
      lines.push(
        `Variance factor: ${res.chiSquare.varianceFactor.toFixed(
          4,
        )} (accepted: ${res.chiSquare.varianceFactorLower.toFixed(
          4,
        )} .. ${res.chiSquare.varianceFactorUpper.toFixed(4)})`,
      );
      lines.push(
        `Error-factor bounds: ${Math.sqrt(res.chiSquare.varianceFactorLower).toFixed(4)} .. ${Math.sqrt(
          res.chiSquare.varianceFactorUpper,
        ).toFixed(4)}`,
      );
    }
    if (res.tsCorrelationDiagnostics) {
      const d = res.tsCorrelationDiagnostics;
      lines.push(
        `TS correlation: ${d.enabled ? 'ON' : 'OFF'} (scope=${d.scope}, rho=${d.rho.toFixed(3)})`,
      );
      if (d.enabled) {
        lines.push(
          `TS correlation diagnostics: groups=${d.groupCount}, equations=${d.equationCount}, pairs=${d.pairCount}, maxGroup=${d.maxGroupSize}, mean|offdiagW|=${d.meanAbsOffDiagWeight != null ? d.meanAbsOffDiagWeight.toExponential(4) : '-'}`,
        );
        const topGroups = d.groups.slice(0, 20);
        if (topGroups.length > 0) {
          lines.push('TS correlation groups (top):');
          topGroups.forEach((g) => {
            lines.push(
              `  ${g.key}: rows=${g.rows}, pairs=${g.pairCount}, mean|offdiagW|=${g.meanAbsOffDiagWeight != null ? g.meanAbsOffDiagWeight.toExponential(4) : '-'}`,
            );
          });
        }
      }
    }
    if (res.robustDiagnostics) {
      const rd = res.robustDiagnostics;
      lines.push(
        `Robust mode: ${rd.enabled ? rd.mode.toUpperCase() : 'OFF'} (k=${rd.k.toFixed(2)})`,
      );
      if (rd.enabled) {
        rd.iterations.forEach((it) => {
          lines.push(
            `  Iter ${it.iteration}: downweighted=${it.downweightedRows}, meanW=${it.meanWeight.toFixed(3)}, minW=${it.minWeight.toFixed(3)}, max|v/sigma|=${it.maxNorm.toFixed(2)}`,
          );
        });
        if (rd.topDownweightedRows.length > 0) {
          lines.push('  Top downweighted rows:');
          rd.topDownweightedRows.slice(0, 20).forEach((r, idx) => {
            lines.push(
              `    ${idx + 1}. #${r.obsId} ${r.type.toUpperCase()} ${r.stations} line=${r.sourceLine ?? '-'} w=${r.weight.toFixed(3)} |v/sigma|=${r.norm.toFixed(2)}`,
            );
          });
        }
      }
    }
    if (!isPreanalysis && res.robustComparison?.enabled) {
      lines.push(
        `Robust/classical suspect overlap: ${res.robustComparison.overlapCount}/${Math.min(
          res.robustComparison.classicalTop.length,
          res.robustComparison.robustTop.length,
        )}`,
      );
    }
    if (res.clusterDiagnostics?.enabled) {
      const cd = res.clusterDiagnostics;
      lines.push(
        `Cluster detection: pass=${cd.passMode}, mode=${cd.linkageMode}, dim=${cd.dimension}, tol=${(
          cd.tolerance * unitScale
        ).toFixed(
          4,
        )} ${linearUnit}, pairHits=${cd.pairCount}, candidates=${cd.candidateCount}, approvedMerges=${cd.approvedMergeCount ?? 0}, mergeOutcomes=${cd.mergeOutcomes?.length ?? 0}, rejected=${cd.rejectedProposals?.length ?? 0}`,
      );
    }
    if (!isPreanalysis && res.autoAdjustDiagnostics?.enabled) {
      const ad = res.autoAdjustDiagnostics;
      lines.push(
        `Auto-adjust: ON (|t|>=${ad.threshold.toFixed(2)}, maxCycles=${ad.maxCycles}, maxRemovalsPerCycle=${ad.maxRemovalsPerCycle}, minRedund=${ad.minRedundancy.toFixed(2)}, stop=${ad.stopReason}, removed=${ad.removed.length})`,
      );
    }
    if (!isPreanalysis && res.autoSideshotDiagnostics?.enabled) {
      const sd = res.autoSideshotDiagnostics;
      lines.push(
        `Auto sideshot (M-lines): evaluated=${sd.evaluatedCount}, candidates=${sd.candidateCount}, excludedControl=${sd.excludedControlCount}, threshold=${sd.threshold.toFixed(2)}`,
      );
    }
    lines.push('');
    lines.push(
      isPreanalysis
        ? '--- Predicted Coordinates and Precision ---'
        : '--- Adjusted Coordinates ---',
    );
    lines.push(
      'ID\tDescription\tNorthing\tEasting\tHeight\tType\tσN\tσE\tσH\tEllMaj\tEllMin\tEllAz\tEllMaj95\tEllMin95',
    );
    outputStationEntries.forEach(([id, st]) => {
      const type = st.fixed ? 'FIXED' : 'ADJ';
      const sN = st.sN != null ? (st.sN * unitScale).toFixed(4) : '-';
      const sE = st.sE != null ? (st.sE * unitScale).toFixed(4) : '-';
      const sH = st.sH != null ? (st.sH * unitScale).toFixed(4) : '-';
      const ellMaj = st.errorEllipse ? (st.errorEllipse.semiMajor * unitScale).toFixed(4) : '-';
      const ellMin = st.errorEllipse ? (st.errorEllipse.semiMinor * unitScale).toFixed(4) : '-';
      const ellAz = st.errorEllipse ? st.errorEllipse.theta.toFixed(2) : '-';
      const ellMaj95 = st.errorEllipse
        ? (st.errorEllipse.semiMajor * ellipse95Scale * unitScale).toFixed(4)
        : '-';
      const ellMin95 = st.errorEllipse
        ? (st.errorEllipse.semiMinor * ellipse95Scale * unitScale).toFixed(4)
        : '-';
      lines.push(
        `${id}\t${stationDescription(id) || '-'}\t${(st.y * unitScale).toFixed(4)}\t${(st.x * unitScale).toFixed(4)}\t${(
          st.h * unitScale
        ).toFixed(
          4,
        )}\t${type}\t${sN}\t${sE}\t${sH}\t${ellMaj}\t${ellMin}\t${ellAz}\t${ellMaj95}\t${ellMin95}`,
      );
    });
    lines.push('');
    if (isPreanalysis && outputStationCovariances.length > 0) {
      lines.push(`--- Station Covariance Blocks (${linearUnit}^2) ---`);
      lines.push('Station\tCEE\tCEN\tCNN\tCHH');
      outputStationCovariances.forEach((row) => {
        lines.push(
          `${row.stationId}\t${(row.cEE * unitScale * unitScale).toExponential(4)}\t${(
            row.cEN *
            unitScale *
            unitScale
          ).toExponential(4)}\t${(row.cNN * unitScale * unitScale).toExponential(4)}\t${
            row.cHH != null ? (row.cHH * unitScale * unitScale).toExponential(4) : '-'
          }`,
        );
      });
      lines.push('');
    }
    if (isPreanalysis && outputRelativeCovariances.length > 0) {
      lines.push(`--- Predicted Relative Precision (Connected Pairs) ---`);
      lines.push('From\tTo\tTypes\tσN\tσE\tσDist\tσAz(")\tCEE\tCEN\tCNN');
      outputRelativeCovariances.forEach((row) => {
        lines.push(
          `${row.from}\t${row.to}\t${row.connectionTypes.join(',')}\t${(
            row.sigmaN * unitScale
          ).toFixed(4)}\t${(row.sigmaE * unitScale).toFixed(4)}\t${
            row.sigmaDist != null ? (row.sigmaDist * unitScale).toFixed(4) : '-'
          }\t${row.sigmaAz != null ? (row.sigmaAz * RAD_TO_DEG * 3600).toFixed(2) : '-'}\t${(
            row.cEE *
            unitScale *
            unitScale
          ).toExponential(4)}\t${(row.cEN * unitScale * unitScale).toExponential(4)}\t${(
            row.cNN *
            unitScale *
            unitScale
          ).toExponential(4)}`,
        );
      });
      lines.push('');
    }
    if (isPreanalysis && res.weakGeometryDiagnostics) {
      const flaggedStationCues = res.weakGeometryDiagnostics.stationCues.filter(
        (cue) => cue.severity !== 'ok',
      );
      const flaggedRelativeCues = res.weakGeometryDiagnostics.relativeCues.filter(
        (cue) => cue.severity !== 'ok',
      );
      lines.push('--- Weak Geometry Cues ---');
      lines.push(
        `Median station major=${(
          res.weakGeometryDiagnostics.stationMedianHorizontal * unitScale
        ).toFixed(4)} ${linearUnit}; median pair sigmaDist=${
          res.weakGeometryDiagnostics.relativeMedianDistance != null
            ? `${(res.weakGeometryDiagnostics.relativeMedianDistance * unitScale).toFixed(4)} ${linearUnit}`
            : '-'
        }`,
      );
      if (flaggedStationCues.length === 0 && flaggedRelativeCues.length === 0) {
        lines.push('No weak-geometry cues flagged.');
      } else {
        flaggedStationCues.forEach((cue) => {
          lines.push(
            `Station ${cue.stationId}: ${cue.severity.toUpperCase()} metric=${(
              cue.horizontalMetric * unitScale
            ).toFixed(4)} ${linearUnit} ratio=${
              cue.relativeToMedian != null ? `${cue.relativeToMedian.toFixed(2)}x` : '-'
            } shape=${cue.ellipseRatio != null ? `${cue.ellipseRatio.toFixed(2)}x` : '-'} ${cue.note}`,
          );
        });
        flaggedRelativeCues.forEach((cue) => {
          lines.push(
            `Pair ${cue.from}-${cue.to}: ${cue.severity.toUpperCase()} metric=${
              cue.distanceMetric != null
                ? `${(cue.distanceMetric * unitScale).toFixed(4)} ${linearUnit}`
                : '-'
            } ratio=${cue.relativeToMedian != null ? `${cue.relativeToMedian.toFixed(2)}x` : '-'} shape=${
              cue.ellipseRatio != null ? `${cue.ellipseRatio.toFixed(2)}x` : '-'
            } ${cue.note}`,
          );
        });
      }
      lines.push('');
    }
    if (isPreanalysis && res.preanalysisImpactDiagnostics) {
      lines.push('--- Planned Observation What-If Analysis ---');
      lines.push(
        `activePlanned=${res.preanalysisImpactDiagnostics.activePlannedCount}, excludedPlanned=${res.preanalysisImpactDiagnostics.excludedPlannedCount}, worstStationMajor=${
          res.preanalysisImpactDiagnostics.baseWorstStationMajor != null
            ? `${(res.preanalysisImpactDiagnostics.baseWorstStationMajor * unitScale).toFixed(4)} ${linearUnit}`
            : '-'
        }, worstPairSigmaDist=${
          res.preanalysisImpactDiagnostics.baseWorstPairSigmaDist != null
            ? `${(res.preanalysisImpactDiagnostics.baseWorstPairSigmaDist * unitScale).toFixed(4)} ${linearUnit}`
            : '-'
        }, weakStations=${res.preanalysisImpactDiagnostics.baseWeakStationCount}, weakPairs=${res.preanalysisImpactDiagnostics.baseWeakPairCount}`,
      );
      lines.push(
        'Action\tType\tStations\tLine\tdWorstMaj\tdMedianMaj\tdWorstPair\tdWeakStn\tdWeakPair\tScore\tStatus',
      );
      res.preanalysisImpactDiagnostics.rows.forEach((row) => {
        lines.push(
          `${row.action}\t${row.type}\t${row.stations}\t${row.sourceLine ?? '-'}\t${
            row.deltaWorstStationMajor != null
              ? (row.deltaWorstStationMajor * unitScale).toFixed(4)
              : '-'
          }\t${
            row.deltaMedianStationMajor != null
              ? (row.deltaMedianStationMajor * unitScale).toFixed(4)
              : '-'
          }\t${
            row.deltaWorstPairSigmaDist != null
              ? (row.deltaWorstPairSigmaDist * unitScale).toFixed(4)
              : '-'
          }\t${row.deltaWeakStationCount ?? '-'}\t${row.deltaWeakPairCount ?? '-'}\t${
            row.score != null ? row.score.toFixed(2) : '-'
          }\t${row.status}`,
        );
      });
      lines.push('');
    }
    if (!isPreanalysis && res.typeSummary && Object.keys(res.typeSummary).length > 0) {
      lines.push('--- Per-Type Summary ---');
      const summaryRows = Object.entries(res.typeSummary).map(([type, s]) => ({
        type,
        count: s.count.toString(),
        rms: (s.unit === 'm' ? s.rms * unitScale : s.rms).toFixed(4),
        maxAbs: (s.unit === 'm' ? s.maxAbs * unitScale : s.maxAbs).toFixed(4),
        maxStdRes: s.maxStdRes.toFixed(3),
        over3: s.over3.toString(),
        over4: s.over4.toString(),
        unit: s.unit === 'm' ? linearUnit : s.unit,
      }));
      const header = {
        type: 'Type',
        count: 'Count',
        rms: 'RMS',
        maxAbs: 'MaxAbs',
        maxStdRes: 'MaxStdRes',
        over3: '>3σ',
        over4: '>4σ',
        unit: 'Unit',
      };
      const widths = {
        type: Math.max(header.type.length, ...summaryRows.map((r) => r.type.length)),
        count: Math.max(header.count.length, ...summaryRows.map((r) => r.count.length)),
        rms: Math.max(header.rms.length, ...summaryRows.map((r) => r.rms.length)),
        maxAbs: Math.max(header.maxAbs.length, ...summaryRows.map((r) => r.maxAbs.length)),
        maxStdRes: Math.max(header.maxStdRes.length, ...summaryRows.map((r) => r.maxStdRes.length)),
        over3: Math.max(header.over3.length, ...summaryRows.map((r) => r.over3.length)),
        over4: Math.max(header.over4.length, ...summaryRows.map((r) => r.over4.length)),
        unit: Math.max(header.unit.length, ...summaryRows.map((r) => r.unit.length)),
      };
      const pad = (value: string, size: number) => value.padEnd(size, ' ');
      lines.push(
        [
          pad(header.type, widths.type),
          pad(header.count, widths.count),
          pad(header.rms, widths.rms),
          pad(header.maxAbs, widths.maxAbs),
          pad(header.maxStdRes, widths.maxStdRes),
          pad(header.over3, widths.over3),
          pad(header.over4, widths.over4),
          pad(header.unit, widths.unit),
        ].join('  '),
      );
      summaryRows.forEach((row) => {
        lines.push(
          [
            pad(row.type, widths.type),
            pad(row.count, widths.count),
            pad(row.rms, widths.rms),
            pad(row.maxAbs, widths.maxAbs),
            pad(row.maxStdRes, widths.maxStdRes),
            pad(row.over3, widths.over3),
            pad(row.over4, widths.over4),
            pad(row.unit, widths.unit),
          ].join('  '),
        );
      });
      lines.push('');
    }
    if (!isPreanalysis && res.residualDiagnostics) {
      const rd = res.residualDiagnostics;
      lines.push('--- Residual Diagnostics ---');
      lines.push(
        `Obs=${rd.observationCount}, WithStdRes=${rd.withStdResCount}, LocalFail=${rd.localFailCount}, |t|>2=${rd.over2SigmaCount}, |t|>3=${rd.over3SigmaCount}, |t|>4=${rd.over4SigmaCount}`,
      );
      lines.push(
        `Redundancy: mean=${rd.meanRedundancy != null ? rd.meanRedundancy.toFixed(4) : '-'}, min=${rd.minRedundancy != null ? rd.minRedundancy.toFixed(4) : '-'}, <0.2=${rd.lowRedundancyCount}, <0.1=${rd.veryLowRedundancyCount}`,
      );
      lines.push(`Critical |t| threshold: ${rd.criticalT.toFixed(2)}`);
      if (rd.worst) {
        lines.push(
          `Worst: #${rd.worst.obsId} ${rd.worst.type.toUpperCase()} ${rd.worst.stations} line=${rd.worst.sourceLine ?? '-'} |t|=${rd.worst.stdRes != null ? rd.worst.stdRes.toFixed(2) : '-'} r=${rd.worst.redundancy != null ? rd.worst.redundancy.toFixed(3) : '-'} local=${rd.worst.localPass == null ? '-' : rd.worst.localPass ? 'PASS' : 'FAIL'}`,
        );
      }
      if (rd.byType.length > 0) {
        const rows = rd.byType.map((b) => ({
          type: String(b.type).toUpperCase(),
          count: String(b.count),
          withStd: String(b.withStdResCount),
          localFail: String(b.localFailCount),
          over3: String(b.over3SigmaCount),
          maxStd: b.maxStdRes != null ? b.maxStdRes.toFixed(2) : '-',
          meanR: b.meanRedundancy != null ? b.meanRedundancy.toFixed(3) : '-',
          minR: b.minRedundancy != null ? b.minRedundancy.toFixed(3) : '-',
        }));
        const header = {
          type: 'Type',
          count: 'Count',
          withStd: 'WithStdRes',
          localFail: 'LocalFail',
          over3: '>3σ',
          maxStd: 'Max|t|',
          meanR: 'MeanRedund',
          minR: 'MinRedund',
        };
        const widths = {
          type: Math.max(header.type.length, ...rows.map((r) => r.type.length)),
          count: Math.max(header.count.length, ...rows.map((r) => r.count.length)),
          withStd: Math.max(header.withStd.length, ...rows.map((r) => r.withStd.length)),
          localFail: Math.max(header.localFail.length, ...rows.map((r) => r.localFail.length)),
          over3: Math.max(header.over3.length, ...rows.map((r) => r.over3.length)),
          maxStd: Math.max(header.maxStd.length, ...rows.map((r) => r.maxStd.length)),
          meanR: Math.max(header.meanR.length, ...rows.map((r) => r.meanR.length)),
          minR: Math.max(header.minR.length, ...rows.map((r) => r.minR.length)),
        };
        const pad = (value: string, size: number) => value.padEnd(size, ' ');
        lines.push(
          [
            pad(header.type, widths.type),
            pad(header.count, widths.count),
            pad(header.withStd, widths.withStd),
            pad(header.localFail, widths.localFail),
            pad(header.over3, widths.over3),
            pad(header.maxStd, widths.maxStd),
            pad(header.meanR, widths.meanR),
            pad(header.minR, widths.minR),
          ].join('  '),
        );
        rows.forEach((r) => {
          lines.push(
            [
              pad(r.type, widths.type),
              pad(r.count, widths.count),
              pad(r.withStd, widths.withStd),
              pad(r.localFail, widths.localFail),
              pad(r.over3, widths.over3),
              pad(r.maxStd, widths.maxStd),
              pad(r.meanR, widths.meanR),
              pad(r.minR, widths.minR),
            ].join('  '),
          );
        });
      }
      lines.push('');
    }
    if (!isPreanalysis && outputRelativePrecision.length > 0) {
      lines.push('--- Relative Precision (Unknowns) ---');
      const relRows = outputRelativePrecision.map((r) => ({
        from: r.from,
        to: r.to,
        sigmaN: (r.sigmaN * unitScale).toFixed(4),
        sigmaE: (r.sigmaE * unitScale).toFixed(4),
        sigmaDist: r.sigmaDist != null ? (r.sigmaDist * unitScale).toFixed(4) : '-',
        sigmaAz: r.sigmaAz != null ? (r.sigmaAz * RAD_TO_DEG * 3600).toFixed(2) : '-',
        ellMaj: r.ellipse ? (r.ellipse.semiMajor * unitScale).toFixed(4) : '-',
        ellMin: r.ellipse ? (r.ellipse.semiMinor * unitScale).toFixed(4) : '-',
        ellAz: r.ellipse ? r.ellipse.theta.toFixed(2) : '-',
      }));
      const header = {
        from: 'From',
        to: 'To',
        sigmaN: 'σN',
        sigmaE: 'σE',
        sigmaDist: 'σDist',
        sigmaAz: 'σAz(")',
        ellMaj: 'EllMaj',
        ellMin: 'EllMin',
        ellAz: 'EllAz',
      };
      const widths = {
        from: Math.max(header.from.length, ...relRows.map((r) => r.from.length)),
        to: Math.max(header.to.length, ...relRows.map((r) => r.to.length)),
        sigmaN: Math.max(header.sigmaN.length, ...relRows.map((r) => r.sigmaN.length)),
        sigmaE: Math.max(header.sigmaE.length, ...relRows.map((r) => r.sigmaE.length)),
        sigmaDist: Math.max(header.sigmaDist.length, ...relRows.map((r) => r.sigmaDist.length)),
        sigmaAz: Math.max(header.sigmaAz.length, ...relRows.map((r) => r.sigmaAz.length)),
        ellMaj: Math.max(header.ellMaj.length, ...relRows.map((r) => r.ellMaj.length)),
        ellMin: Math.max(header.ellMin.length, ...relRows.map((r) => r.ellMin.length)),
        ellAz: Math.max(header.ellAz.length, ...relRows.map((r) => r.ellAz.length)),
      };
      const pad = (value: string, size: number) => value.padEnd(size, ' ');
      lines.push(
        [
          pad(header.from, widths.from),
          pad(header.to, widths.to),
          pad(header.sigmaN, widths.sigmaN),
          pad(header.sigmaE, widths.sigmaE),
          pad(header.sigmaDist, widths.sigmaDist),
          pad(header.sigmaAz, widths.sigmaAz),
          pad(header.ellMaj, widths.ellMaj),
          pad(header.ellMin, widths.ellMin),
          pad(header.ellAz, widths.ellAz),
        ].join('  '),
      );
      relRows.forEach((r) => {
        lines.push(
          [
            pad(r.from, widths.from),
            pad(r.to, widths.to),
            pad(r.sigmaN, widths.sigmaN),
            pad(r.sigmaE, widths.sigmaE),
            pad(r.sigmaDist, widths.sigmaDist),
            pad(r.sigmaAz, widths.sigmaAz),
            pad(r.ellMaj, widths.ellMaj),
            pad(r.ellMin, widths.ellMin),
            pad(r.ellAz, widths.ellAz),
          ].join('  '),
        );
      });
      lines.push('');
    }
    if (res.autoAdjustDiagnostics?.enabled) {
      const ad = res.autoAdjustDiagnostics;
      lines.push('--- Auto-Adjust Diagnostics ---');
      lines.push(
        `Threshold=|t|>=${ad.threshold.toFixed(2)} MaxCycles=${ad.maxCycles} MaxRemovalsPerCycle=${ad.maxRemovalsPerCycle} MinRedund=${ad.minRedundancy.toFixed(2)} Stop=${ad.stopReason} Removed=${ad.removed.length}`,
      );
      lines.push('Cycle  SEUW      Max|t|   Removals');
      ad.cycles.forEach((cycle) => {
        lines.push(
          `${String(cycle.cycle).padStart(5)}  ${cycle.seuw.toFixed(4).padStart(8)}  ${cycle.maxAbsStdRes.toFixed(2).padStart(6)}  ${String(cycle.removals.length).padStart(8)}`,
        );
      });
      if (ad.removed.length > 0) {
        lines.push('');
        lines.push('Removed observations:');
        lines.push('ObsID   Type        Stations                 Line    |t|     Redund   Reason');
        ad.removed.forEach((row) => {
          lines.push(
            `${String(row.obsId).padStart(5)}   ${row.type.toUpperCase().padEnd(10)}  ${row.stations.padEnd(22)}  ${String(row.sourceLine ?? '-').padStart(4)}  ${row.stdRes.toFixed(2).padStart(6)}  ${(row.redundancy != null ? row.redundancy.toFixed(3) : '-').padStart(7)}  ${row.reason}`,
          );
        });
      }
      lines.push('');
    }
    if (res.autoSideshotDiagnostics?.enabled) {
      const sd = res.autoSideshotDiagnostics;
      lines.push('--- Auto Sideshot Candidates (M Records) ---');
      lines.push(
        `Evaluated=${sd.evaluatedCount} Candidates=${sd.candidateCount} ExcludedControl=${sd.excludedControlCount} Threshold=${sd.threshold.toFixed(2)}`,
      );
      if (sd.candidates.length > 0) {
        lines.push(
          'Line   Occupy   Backsight   Target   AngleObs   DistObs   AngleRed   DistRed   MinRed   Max|t|',
        );
        sd.candidates.forEach((row) => {
          lines.push(
            `${String(row.sourceLine ?? '-').padStart(4)}   ${row.occupy.padEnd(6)}   ${row.backsight.padEnd(9)}   ${row.target.padEnd(6)}   ${String(row.angleObsId).padStart(8)}   ${String(row.distObsId).padStart(7)}   ${row.angleRedundancy.toFixed(3).padStart(8)}   ${row.distRedundancy.toFixed(3).padStart(7)}   ${row.minRedundancy.toFixed(3).padStart(6)}   ${row.maxAbsStdRes.toFixed(2).padStart(6)}`,
          );
        });
      }
      lines.push('');
    }
    if (res.clusterDiagnostics?.enabled) {
      const cd = res.clusterDiagnostics;
      const outcomes = cd.mergeOutcomes ?? [];
      const rejected = cd.rejectedProposals ?? [];
      lines.push('--- Cluster Detection Candidates ---');
      lines.push(
        `Pass=${cd.passMode.toUpperCase()} Mode=${cd.linkageMode.toUpperCase()} Dim=${cd.dimension} Tolerance=${(
          cd.tolerance * unitScale
        ).toFixed(
          4,
        )} ${linearUnit} PairHits=${cd.pairCount} Candidates=${cd.candidateCount} ApprovedMerges=${cd.approvedMergeCount ?? 0} MergeOutcomes=${outcomes.length} Rejected=${rejected.length}`,
      );
      if (cd.candidates.length > 0) {
        lines.push(
          'Key                Rep          Members  MaxSep         MeanSep        Flags            Station IDs',
        );
        cd.candidates.forEach((c) => {
          const flags = `${c.hasFixed ? 'fixed' : 'free'}${c.hasUnknown ? '+unknown' : ''}`;
          lines.push(
            `${c.key.padEnd(18)} ${c.representativeId.padEnd(12)} ${String(c.memberCount).padStart(7)}  ${(
              c.maxSeparation * unitScale
            )
              .toFixed(4)
              .padStart(12)} ${(c.meanSeparation * unitScale)
              .toFixed(4)
              .padStart(12)}  ${flags.padEnd(15)} ${c.stationIds.join(', ')}`,
          );
        });
      }
      if (outcomes.length > 0) {
        lines.push('');
        lines.push('--- Cluster Merge Outcomes (Delta From Retained Point) ---');
        lines.push(
          'Alias              Canonical          dE           dN           dH           d2D          d3D          Status',
        );
        outcomes.forEach((row) => {
          lines.push(
            `${row.aliasId.padEnd(18)} ${row.canonicalId.padEnd(18)} ${(row.deltaE != null ? (row.deltaE * unitScale).toFixed(4) : '-').padStart(12)} ${(row.deltaN != null ? (row.deltaN * unitScale).toFixed(4) : '-').padStart(12)} ${(row.deltaH != null ? (row.deltaH * unitScale).toFixed(4) : '-').padStart(12)} ${(row.horizontalDelta != null ? (row.horizontalDelta * unitScale).toFixed(4) : '-').padStart(12)} ${(row.spatialDelta != null ? (row.spatialDelta * unitScale).toFixed(4) : '-').padStart(12)}  ${row.missing ? 'MISSING PASS1 DATA' : 'OK'}`,
          );
        });
      }
      if (rejected.length > 0) {
        lines.push('');
        lines.push('--- Rejected Cluster Proposals ---');
        lines.push(
          'Key                Rep          Members  Retained      Station IDs                        Reason',
        );
        rejected.forEach((row) => {
          lines.push(
            `${row.key.padEnd(18)} ${row.representativeId.padEnd(12)} ${String(row.memberCount).padStart(7)}  ${(row.retainedId ?? '-').padEnd(12)} ${row.stationIds.join(', ').padEnd(32)} ${row.reason}`,
          );
        });
      }
      lines.push('');
    }
    if (res.traverseDiagnostics) {
      lines.push('--- Traverse Diagnostics ---');
      lines.push(`Closure count: ${res.traverseDiagnostics.closureCount}`);
      lines.push(
        `Misclosure: dE=${(res.traverseDiagnostics.misclosureE * unitScale).toFixed(4)} ${linearUnit}, dN=${(
          res.traverseDiagnostics.misclosureN * unitScale
        ).toFixed(
          4,
        )} ${linearUnit}, Mag=${(res.traverseDiagnostics.misclosureMag * unitScale).toFixed(4)} ${linearUnit}`,
      );
      lines.push(
        `Traverse distance: ${(res.traverseDiagnostics.totalTraverseDistance * unitScale).toFixed(
          4,
        )} ${linearUnit}`,
      );
      lines.push(
        `Closure ratio: ${
          res.traverseDiagnostics.closureRatio != null
            ? `1:${res.traverseDiagnostics.closureRatio.toFixed(0)}`
            : '-'
        }`,
      );
      lines.push(
        `Linear misclosure: ${
          res.traverseDiagnostics.linearPpm != null
            ? `${res.traverseDiagnostics.linearPpm.toFixed(1)} ppm`
            : '-'
        }`,
      );
      lines.push(
        `Angular misclosure: ${
          res.traverseDiagnostics.angularMisclosureArcSec != null
            ? `${res.traverseDiagnostics.angularMisclosureArcSec.toFixed(2)}"`
            : '-'
        }`,
      );
      lines.push(
        `Vertical misclosure: ${
          res.traverseDiagnostics.verticalMisclosure != null
            ? `${(res.traverseDiagnostics.verticalMisclosure * unitScale).toFixed(4)} ${linearUnit}`
            : '-'
        }`,
      );
      if (res.traverseDiagnostics.thresholds) {
        const t = res.traverseDiagnostics.thresholds;
        lines.push(
          `Thresholds: ratio>=1:${t.minClosureRatio}, linear<=${t.maxLinearPpm.toFixed(
            1,
          )}ppm, angular<=${t.maxAngularArcSec.toFixed(1)}", vertical<=${(
            t.maxVerticalMisclosure * unitScale
          ).toFixed(4)} ${linearUnit}`,
        );
      }
      if (res.traverseDiagnostics.passes) {
        const p = res.traverseDiagnostics.passes;
        lines.push(
          `Checks: ratio=${p.ratio ? 'PASS' : 'WARN'}, linear=${p.linearPpm ? 'PASS' : 'WARN'}, angular=${p.angular ? 'PASS' : 'WARN'}, vertical=${p.vertical ? 'PASS' : 'WARN'}, overall=${p.overall ? 'PASS' : 'WARN'}`,
        );
      }
      if (res.traverseDiagnostics.loops && res.traverseDiagnostics.loops.length > 0) {
        lines.push('');
        lines.push('Traverse closure loops (ranked by severity):');
        const rows = res.traverseDiagnostics.loops.map((l, idx) => ({
          rank: String(idx + 1),
          loop: l.key,
          mag: (l.misclosureMag * unitScale).toFixed(4),
          dist: (l.traverseDistance * unitScale).toFixed(4),
          ratio: l.closureRatio != null ? `1:${l.closureRatio.toFixed(0)}` : '-',
          ppm: l.linearPpm != null ? l.linearPpm.toFixed(1) : '-',
          ang: l.angularMisclosureArcSec != null ? l.angularMisclosureArcSec.toFixed(2) : '-',
          vert: l.verticalMisclosure != null ? (l.verticalMisclosure * unitScale).toFixed(4) : '-',
          severity: l.severity.toFixed(1),
          status: l.pass ? 'PASS' : 'WARN',
        }));
        const header = {
          rank: '#',
          loop: 'Loop',
          mag: `Mag(${linearUnit})`,
          dist: `Dist(${linearUnit})`,
          ratio: 'Ratio',
          ppm: 'Linear(ppm)',
          ang: 'Ang(")',
          vert: `dH(${linearUnit})`,
          severity: 'Severity',
          status: 'Status',
        };
        const widths = {
          rank: Math.max(header.rank.length, ...rows.map((r) => r.rank.length)),
          loop: Math.max(header.loop.length, ...rows.map((r) => r.loop.length)),
          mag: Math.max(header.mag.length, ...rows.map((r) => r.mag.length)),
          dist: Math.max(header.dist.length, ...rows.map((r) => r.dist.length)),
          ratio: Math.max(header.ratio.length, ...rows.map((r) => r.ratio.length)),
          ppm: Math.max(header.ppm.length, ...rows.map((r) => r.ppm.length)),
          ang: Math.max(header.ang.length, ...rows.map((r) => r.ang.length)),
          vert: Math.max(header.vert.length, ...rows.map((r) => r.vert.length)),
          severity: Math.max(header.severity.length, ...rows.map((r) => r.severity.length)),
          status: Math.max(header.status.length, ...rows.map((r) => r.status.length)),
        };
        const pad = (value: string, size: number) => value.padEnd(size, ' ');
        lines.push(
          [
            pad(header.rank, widths.rank),
            pad(header.loop, widths.loop),
            pad(header.mag, widths.mag),
            pad(header.dist, widths.dist),
            pad(header.ratio, widths.ratio),
            pad(header.ppm, widths.ppm),
            pad(header.ang, widths.ang),
            pad(header.vert, widths.vert),
            pad(header.severity, widths.severity),
            pad(header.status, widths.status),
          ].join('  '),
        );
        rows.forEach((r) => {
          lines.push(
            [
              pad(r.rank, widths.rank),
              pad(r.loop, widths.loop),
              pad(r.mag, widths.mag),
              pad(r.dist, widths.dist),
              pad(r.ratio, widths.ratio),
              pad(r.ppm, widths.ppm),
              pad(r.ang, widths.ang),
              pad(r.vert, widths.vert),
              pad(r.severity, widths.severity),
              pad(r.status, widths.status),
            ].join('  '),
          );
        });
      }
      lines.push('');
    }
    if (res.directionSetDiagnostics && res.directionSetDiagnostics.length > 0) {
      lines.push('--- Direction Set Diagnostics ---');
      const rows = res.directionSetDiagnostics.map((d) => ({
        setId: d.setId,
        occupy: d.occupy,
        readings: String(d.readingCount),
        targets: String(d.targetCount),
        under: d.underconstrainedOrientation ? 'YES' : 'NO',
        raw: String(d.rawCount),
        reduced: String(d.reducedCount),
        pairs: String(d.pairedTargets),
        face1: String(d.face1Count),
        face2: String(d.face2Count),
        orient: d.orientationDeg != null ? d.orientationDeg.toFixed(4) : '-',
        rms: d.residualRmsArcSec != null ? d.residualRmsArcSec.toFixed(2) : '-',
        max: d.residualMaxArcSec != null ? d.residualMaxArcSec.toFixed(2) : '-',
        pairDeltaMean:
          d.meanFacePairDeltaArcSec != null ? d.meanFacePairDeltaArcSec.toFixed(2) : '-',
        pairDeltaMax: d.maxFacePairDeltaArcSec != null ? d.maxFacePairDeltaArcSec.toFixed(2) : '-',
        rawMaxMean:
          d.meanRawMaxResidualArcSec != null ? d.meanRawMaxResidualArcSec.toFixed(2) : '-',
        rawMax: d.maxRawMaxResidualArcSec != null ? d.maxRawMaxResidualArcSec.toFixed(2) : '-',
        orientSe: d.orientationSeArcSec != null ? d.orientationSeArcSec.toFixed(2) : '-',
      }));
      const header = {
        setId: 'Set',
        occupy: 'Occupy',
        readings: 'Readings',
        targets: 'Targets',
        under: 'Under',
        raw: 'Raw',
        reduced: 'Reduced',
        pairs: 'Pairs',
        face1: 'F1',
        face2: 'F2',
        orient: 'Orient(deg)',
        rms: 'RMS(")',
        max: 'Max(")',
        pairDeltaMean: 'PairDeltaMean(")',
        pairDeltaMax: 'PairDeltaMax(")',
        rawMaxMean: 'RawMaxMean(")',
        rawMax: 'RawMax(")',
        orientSe: 'OrientSE(")',
      };
      const widths = {
        setId: Math.max(header.setId.length, ...rows.map((r) => r.setId.length)),
        occupy: Math.max(header.occupy.length, ...rows.map((r) => r.occupy.length)),
        readings: Math.max(header.readings.length, ...rows.map((r) => r.readings.length)),
        targets: Math.max(header.targets.length, ...rows.map((r) => r.targets.length)),
        under: Math.max(header.under.length, ...rows.map((r) => r.under.length)),
        raw: Math.max(header.raw.length, ...rows.map((r) => r.raw.length)),
        reduced: Math.max(header.reduced.length, ...rows.map((r) => r.reduced.length)),
        pairs: Math.max(header.pairs.length, ...rows.map((r) => r.pairs.length)),
        face1: Math.max(header.face1.length, ...rows.map((r) => r.face1.length)),
        face2: Math.max(header.face2.length, ...rows.map((r) => r.face2.length)),
        orient: Math.max(header.orient.length, ...rows.map((r) => r.orient.length)),
        rms: Math.max(header.rms.length, ...rows.map((r) => r.rms.length)),
        max: Math.max(header.max.length, ...rows.map((r) => r.max.length)),
        pairDeltaMean: Math.max(
          header.pairDeltaMean.length,
          ...rows.map((r) => r.pairDeltaMean.length),
        ),
        pairDeltaMax: Math.max(
          header.pairDeltaMax.length,
          ...rows.map((r) => r.pairDeltaMax.length),
        ),
        rawMaxMean: Math.max(header.rawMaxMean.length, ...rows.map((r) => r.rawMaxMean.length)),
        rawMax: Math.max(header.rawMax.length, ...rows.map((r) => r.rawMax.length)),
        orientSe: Math.max(header.orientSe.length, ...rows.map((r) => r.orientSe.length)),
      };
      const pad = (value: string, size: number) => value.padEnd(size, ' ');
      lines.push(
        [
          pad(header.setId, widths.setId),
          pad(header.occupy, widths.occupy),
          pad(header.readings, widths.readings),
          pad(header.targets, widths.targets),
          pad(header.under, widths.under),
          pad(header.raw, widths.raw),
          pad(header.reduced, widths.reduced),
          pad(header.pairs, widths.pairs),
          pad(header.face1, widths.face1),
          pad(header.face2, widths.face2),
          pad(header.orient, widths.orient),
          pad(header.rms, widths.rms),
          pad(header.max, widths.max),
          pad(header.pairDeltaMean, widths.pairDeltaMean),
          pad(header.pairDeltaMax, widths.pairDeltaMax),
          pad(header.rawMaxMean, widths.rawMaxMean),
          pad(header.rawMax, widths.rawMax),
          pad(header.orientSe, widths.orientSe),
        ].join('  '),
      );
      rows.forEach((r) => {
        lines.push(
          [
            pad(r.setId, widths.setId),
            pad(r.occupy, widths.occupy),
            pad(r.readings, widths.readings),
            pad(r.targets, widths.targets),
            pad(r.under, widths.under),
            pad(r.raw, widths.raw),
            pad(r.reduced, widths.reduced),
            pad(r.pairs, widths.pairs),
            pad(r.face1, widths.face1),
            pad(r.face2, widths.face2),
            pad(r.orient, widths.orient),
            pad(r.rms, widths.rms),
            pad(r.max, widths.max),
            pad(r.pairDeltaMean, widths.pairDeltaMean),
            pad(r.pairDeltaMax, widths.pairDeltaMax),
            pad(r.rawMaxMean, widths.rawMaxMean),
            pad(r.rawMax, widths.rawMax),
            pad(r.orientSe, widths.orientSe),
          ].join('  '),
        );
      });
      lines.push('');
    }
    if (res.directionTargetDiagnostics && res.directionTargetDiagnostics.length > 0) {
      lines.push('--- Direction Target Repeatability (ranked) ---');
      const rows = res.directionTargetDiagnostics.map((d, idx) => ({
        rank: String(idx + 1),
        setId: d.setId,
        occupy: d.occupy,
        target: d.target,
        line: d.sourceLine != null ? String(d.sourceLine) : '-',
        raw: String(d.rawCount),
        face1: String(d.face1Count),
        face2: String(d.face2Count),
        spread: d.rawSpreadArcSec != null ? d.rawSpreadArcSec.toFixed(2) : '-',
        rawMax: d.rawMaxResidualArcSec != null ? d.rawMaxResidualArcSec.toFixed(2) : '-',
        pairDelta: d.facePairDeltaArcSec != null ? d.facePairDeltaArcSec.toFixed(2) : '-',
        f1Spread: d.face1SpreadArcSec != null ? d.face1SpreadArcSec.toFixed(2) : '-',
        f2Spread: d.face2SpreadArcSec != null ? d.face2SpreadArcSec.toFixed(2) : '-',
        redSigma: d.reducedSigmaArcSec != null ? d.reducedSigmaArcSec.toFixed(2) : '-',
        residual: d.residualArcSec != null ? d.residualArcSec.toFixed(2) : '-',
        stdRes: d.stdRes != null ? d.stdRes.toFixed(2) : '-',
        local: d.localPass == null ? '-' : d.localPass ? 'PASS' : 'FAIL',
        mdb: d.mdbArcSec != null ? d.mdbArcSec.toFixed(2) : '-',
        score: d.suspectScore.toFixed(1),
      }));
      const header = {
        rank: '#',
        setId: 'Set',
        occupy: 'Occupy',
        target: 'Target',
        line: 'Line',
        raw: 'Raw',
        face1: 'F1',
        face2: 'F2',
        spread: 'Spread(")',
        rawMax: 'RawMax(")',
        pairDelta: 'PairDelta(")',
        f1Spread: 'F1Spread(")',
        f2Spread: 'F2Spread(")',
        redSigma: 'RedSigma(")',
        residual: 'Residual(")',
        stdRes: 'StdRes',
        local: 'Local',
        mdb: 'MDB(")',
        score: 'Score',
      };
      const widths = {
        rank: Math.max(header.rank.length, ...rows.map((r) => r.rank.length)),
        setId: Math.max(header.setId.length, ...rows.map((r) => r.setId.length)),
        occupy: Math.max(header.occupy.length, ...rows.map((r) => r.occupy.length)),
        target: Math.max(header.target.length, ...rows.map((r) => r.target.length)),
        line: Math.max(header.line.length, ...rows.map((r) => r.line.length)),
        raw: Math.max(header.raw.length, ...rows.map((r) => r.raw.length)),
        face1: Math.max(header.face1.length, ...rows.map((r) => r.face1.length)),
        face2: Math.max(header.face2.length, ...rows.map((r) => r.face2.length)),
        spread: Math.max(header.spread.length, ...rows.map((r) => r.spread.length)),
        rawMax: Math.max(header.rawMax.length, ...rows.map((r) => r.rawMax.length)),
        pairDelta: Math.max(header.pairDelta.length, ...rows.map((r) => r.pairDelta.length)),
        f1Spread: Math.max(header.f1Spread.length, ...rows.map((r) => r.f1Spread.length)),
        f2Spread: Math.max(header.f2Spread.length, ...rows.map((r) => r.f2Spread.length)),
        redSigma: Math.max(header.redSigma.length, ...rows.map((r) => r.redSigma.length)),
        residual: Math.max(header.residual.length, ...rows.map((r) => r.residual.length)),
        stdRes: Math.max(header.stdRes.length, ...rows.map((r) => r.stdRes.length)),
        local: Math.max(header.local.length, ...rows.map((r) => r.local.length)),
        mdb: Math.max(header.mdb.length, ...rows.map((r) => r.mdb.length)),
        score: Math.max(header.score.length, ...rows.map((r) => r.score.length)),
      };
      const pad = (value: string, size: number) => value.padEnd(size, ' ');
      lines.push(
        [
          pad(header.rank, widths.rank),
          pad(header.setId, widths.setId),
          pad(header.occupy, widths.occupy),
          pad(header.target, widths.target),
          pad(header.line, widths.line),
          pad(header.raw, widths.raw),
          pad(header.face1, widths.face1),
          pad(header.face2, widths.face2),
          pad(header.spread, widths.spread),
          pad(header.rawMax, widths.rawMax),
          pad(header.pairDelta, widths.pairDelta),
          pad(header.f1Spread, widths.f1Spread),
          pad(header.f2Spread, widths.f2Spread),
          pad(header.redSigma, widths.redSigma),
          pad(header.residual, widths.residual),
          pad(header.stdRes, widths.stdRes),
          pad(header.local, widths.local),
          pad(header.mdb, widths.mdb),
          pad(header.score, widths.score),
        ].join('  '),
      );
      rows.forEach((r) => {
        lines.push(
          [
            pad(r.rank, widths.rank),
            pad(r.setId, widths.setId),
            pad(r.occupy, widths.occupy),
            pad(r.target, widths.target),
            pad(r.line, widths.line),
            pad(r.raw, widths.raw),
            pad(r.face1, widths.face1),
            pad(r.face2, widths.face2),
            pad(r.spread, widths.spread),
            pad(r.rawMax, widths.rawMax),
            pad(r.pairDelta, widths.pairDelta),
            pad(r.f1Spread, widths.f1Spread),
            pad(r.f2Spread, widths.f2Spread),
            pad(r.redSigma, widths.redSigma),
            pad(r.residual, widths.residual),
            pad(r.stdRes, widths.stdRes),
            pad(r.local, widths.local),
            pad(r.mdb, widths.mdb),
            pad(r.score, widths.score),
          ].join('  '),
        );
      });
      lines.push('');

      const suspects = res.directionTargetDiagnostics
        .filter(
          (d) => d.localPass === false || (d.stdRes ?? 0) >= 2 || (d.rawSpreadArcSec ?? 0) >= 5,
        )
        .slice(0, 20);
      if (suspects.length > 0) {
        lines.push('--- Direction Target Suspects ---');
        const suspectRows = suspects.map((d, idx) => ({
          rank: String(idx + 1),
          setId: d.setId,
          stations: `${d.occupy}-${d.target}`,
          spread: d.rawSpreadArcSec != null ? d.rawSpreadArcSec.toFixed(2) : '-',
          stdRes: d.stdRes != null ? d.stdRes.toFixed(2) : '-',
          local: d.localPass == null ? '-' : d.localPass ? 'PASS' : 'FAIL',
          score: d.suspectScore.toFixed(1),
        }));
        const suspectHeader = {
          rank: '#',
          setId: 'Set',
          stations: 'Stations',
          spread: 'Spread(")',
          stdRes: 'StdRes',
          local: 'Local',
          score: 'Score',
        };
        const suspectWidths = {
          rank: Math.max(suspectHeader.rank.length, ...suspectRows.map((r) => r.rank.length)),
          setId: Math.max(suspectHeader.setId.length, ...suspectRows.map((r) => r.setId.length)),
          stations: Math.max(
            suspectHeader.stations.length,
            ...suspectRows.map((r) => r.stations.length),
          ),
          spread: Math.max(suspectHeader.spread.length, ...suspectRows.map((r) => r.spread.length)),
          stdRes: Math.max(suspectHeader.stdRes.length, ...suspectRows.map((r) => r.stdRes.length)),
          local: Math.max(suspectHeader.local.length, ...suspectRows.map((r) => r.local.length)),
          score: Math.max(suspectHeader.score.length, ...suspectRows.map((r) => r.score.length)),
        };
        lines.push(
          [
            pad(suspectHeader.rank, suspectWidths.rank),
            pad(suspectHeader.setId, suspectWidths.setId),
            pad(suspectHeader.stations, suspectWidths.stations),
            pad(suspectHeader.spread, suspectWidths.spread),
            pad(suspectHeader.stdRes, suspectWidths.stdRes),
            pad(suspectHeader.local, suspectWidths.local),
            pad(suspectHeader.score, suspectWidths.score),
          ].join('  '),
        );
        suspectRows.forEach((r) => {
          lines.push(
            [
              pad(r.rank, suspectWidths.rank),
              pad(r.setId, suspectWidths.setId),
              pad(r.stations, suspectWidths.stations),
              pad(r.spread, suspectWidths.spread),
              pad(r.stdRes, suspectWidths.stdRes),
              pad(r.local, suspectWidths.local),
              pad(r.score, suspectWidths.score),
            ].join('  '),
          );
        });
        lines.push('');
      }
    }
    if (res.directionRejectDiagnostics && res.directionRejectDiagnostics.length > 0) {
      lines.push('--- Direction Reject Diagnostics ---');
      const rows = res.directionRejectDiagnostics
        .map((d, idx) => ({
          rank: String(idx + 1),
          setId: d.setId,
          occupy: d.occupy,
          target: d.target ?? '-',
          line: d.sourceLine != null ? String(d.sourceLine) : '-',
          rec: d.recordType ?? '-',
          expected: d.expectedFace ?? '-',
          actual: d.actualFace ?? '-',
          reason: d.detail,
        }))
        .sort((a, b) => {
          const la = a.line === '-' ? Number.MAX_SAFE_INTEGER : Number(a.line);
          const lb = b.line === '-' ? Number.MAX_SAFE_INTEGER : Number(b.line);
          if (la !== lb) return la - lb;
          return a.setId.localeCompare(b.setId);
        });
      const header = {
        rank: '#',
        setId: 'Set',
        occupy: 'Occupy',
        target: 'Target',
        line: 'Line',
        rec: 'Rec',
        expected: 'Expected',
        actual: 'Actual',
        reason: 'Reason',
      };
      const widths = {
        rank: Math.max(header.rank.length, ...rows.map((r) => r.rank.length)),
        setId: Math.max(header.setId.length, ...rows.map((r) => r.setId.length)),
        occupy: Math.max(header.occupy.length, ...rows.map((r) => r.occupy.length)),
        target: Math.max(header.target.length, ...rows.map((r) => r.target.length)),
        line: Math.max(header.line.length, ...rows.map((r) => r.line.length)),
        rec: Math.max(header.rec.length, ...rows.map((r) => r.rec.length)),
        expected: Math.max(header.expected.length, ...rows.map((r) => r.expected.length)),
        actual: Math.max(header.actual.length, ...rows.map((r) => r.actual.length)),
        reason: Math.max(header.reason.length, ...rows.map((r) => r.reason.length)),
      };
      const pad = (value: string, size: number) => value.padEnd(size, ' ');
      lines.push(
        [
          pad(header.rank, widths.rank),
          pad(header.setId, widths.setId),
          pad(header.occupy, widths.occupy),
          pad(header.target, widths.target),
          pad(header.line, widths.line),
          pad(header.rec, widths.rec),
          pad(header.expected, widths.expected),
          pad(header.actual, widths.actual),
          pad(header.reason, widths.reason),
        ].join('  '),
      );
      rows.forEach((r) => {
        lines.push(
          [
            pad(r.rank, widths.rank),
            pad(r.setId, widths.setId),
            pad(r.occupy, widths.occupy),
            pad(r.target, widths.target),
            pad(r.line, widths.line),
            pad(r.rec, widths.rec),
            pad(r.expected, widths.expected),
            pad(r.actual, widths.actual),
            pad(r.reason, widths.reason),
          ].join('  '),
        );
      });
      lines.push('');
    }
    if (res.directionRepeatabilityDiagnostics && res.directionRepeatabilityDiagnostics.length > 0) {
      lines.push('--- Direction Repeatability By Occupy-Target (multi-set) ---');
      const rows = res.directionRepeatabilityDiagnostics.map((d, idx) => ({
        rank: String(idx + 1),
        occupy: d.occupy,
        target: d.target,
        sets: String(d.setCount),
        localFail: String(d.localFailCount),
        faceUnbal: String(d.faceUnbalancedSets),
        resMean: d.residualMeanArcSec != null ? d.residualMeanArcSec.toFixed(2) : '-',
        resRms: d.residualRmsArcSec != null ? d.residualRmsArcSec.toFixed(2) : '-',
        resRange: d.residualRangeArcSec != null ? d.residualRangeArcSec.toFixed(2) : '-',
        resMax: d.residualMaxArcSec != null ? d.residualMaxArcSec.toFixed(2) : '-',
        stdRms: d.stdResRms != null ? d.stdResRms.toFixed(2) : '-',
        maxStd: d.maxStdRes != null ? d.maxStdRes.toFixed(2) : '-',
        spreadMean: d.meanRawSpreadArcSec != null ? d.meanRawSpreadArcSec.toFixed(2) : '-',
        spreadMax: d.maxRawSpreadArcSec != null ? d.maxRawSpreadArcSec.toFixed(2) : '-',
        worstSet: d.worstSetId ?? '-',
        line: d.worstLine != null ? String(d.worstLine) : '-',
        score: d.suspectScore.toFixed(1),
      }));
      const header = {
        rank: '#',
        occupy: 'Occupy',
        target: 'Target',
        sets: 'Sets',
        localFail: 'LocalFail',
        faceUnbal: 'FaceUnbal',
        resMean: 'ResMean(")',
        resRms: 'ResRMS(")',
        resRange: 'ResRange(")',
        resMax: 'ResMax(")',
        stdRms: 'RMS|t|',
        maxStd: 'Max|t|',
        spreadMean: 'SpreadMean(")',
        spreadMax: 'SpreadMax(")',
        worstSet: 'WorstSet',
        line: 'Line',
        score: 'Score',
      };
      const widths = {
        rank: Math.max(header.rank.length, ...rows.map((r) => r.rank.length)),
        occupy: Math.max(header.occupy.length, ...rows.map((r) => r.occupy.length)),
        target: Math.max(header.target.length, ...rows.map((r) => r.target.length)),
        sets: Math.max(header.sets.length, ...rows.map((r) => r.sets.length)),
        localFail: Math.max(header.localFail.length, ...rows.map((r) => r.localFail.length)),
        faceUnbal: Math.max(header.faceUnbal.length, ...rows.map((r) => r.faceUnbal.length)),
        resMean: Math.max(header.resMean.length, ...rows.map((r) => r.resMean.length)),
        resRms: Math.max(header.resRms.length, ...rows.map((r) => r.resRms.length)),
        resRange: Math.max(header.resRange.length, ...rows.map((r) => r.resRange.length)),
        resMax: Math.max(header.resMax.length, ...rows.map((r) => r.resMax.length)),
        stdRms: Math.max(header.stdRms.length, ...rows.map((r) => r.stdRms.length)),
        maxStd: Math.max(header.maxStd.length, ...rows.map((r) => r.maxStd.length)),
        spreadMean: Math.max(header.spreadMean.length, ...rows.map((r) => r.spreadMean.length)),
        spreadMax: Math.max(header.spreadMax.length, ...rows.map((r) => r.spreadMax.length)),
        worstSet: Math.max(header.worstSet.length, ...rows.map((r) => r.worstSet.length)),
        line: Math.max(header.line.length, ...rows.map((r) => r.line.length)),
        score: Math.max(header.score.length, ...rows.map((r) => r.score.length)),
      };
      const pad = (value: string, size: number) => value.padEnd(size, ' ');
      lines.push(
        [
          pad(header.rank, widths.rank),
          pad(header.occupy, widths.occupy),
          pad(header.target, widths.target),
          pad(header.sets, widths.sets),
          pad(header.localFail, widths.localFail),
          pad(header.faceUnbal, widths.faceUnbal),
          pad(header.resMean, widths.resMean),
          pad(header.resRms, widths.resRms),
          pad(header.resRange, widths.resRange),
          pad(header.resMax, widths.resMax),
          pad(header.stdRms, widths.stdRms),
          pad(header.maxStd, widths.maxStd),
          pad(header.spreadMean, widths.spreadMean),
          pad(header.spreadMax, widths.spreadMax),
          pad(header.worstSet, widths.worstSet),
          pad(header.line, widths.line),
          pad(header.score, widths.score),
        ].join('  '),
      );
      rows.forEach((r) => {
        lines.push(
          [
            pad(r.rank, widths.rank),
            pad(r.occupy, widths.occupy),
            pad(r.target, widths.target),
            pad(r.sets, widths.sets),
            pad(r.localFail, widths.localFail),
            pad(r.faceUnbal, widths.faceUnbal),
            pad(r.resMean, widths.resMean),
            pad(r.resRms, widths.resRms),
            pad(r.resRange, widths.resRange),
            pad(r.resMax, widths.resMax),
            pad(r.stdRms, widths.stdRms),
            pad(r.maxStd, widths.maxStd),
            pad(r.spreadMean, widths.spreadMean),
            pad(r.spreadMax, widths.spreadMax),
            pad(r.worstSet, widths.worstSet),
            pad(r.line, widths.line),
            pad(r.score, widths.score),
          ].join('  '),
        );
      });
      lines.push('');

      const suspects = res.directionRepeatabilityDiagnostics
        .filter(
          (d) =>
            d.localFailCount > 0 || (d.maxStdRes ?? 0) >= 2 || (d.maxRawSpreadArcSec ?? 0) >= 5,
        )
        .slice(0, 20);
      if (suspects.length > 0) {
        lines.push('--- Direction Repeatability Suspects ---');
        const suspectRows = suspects.map((d, idx) => ({
          rank: String(idx + 1),
          stations: `${d.occupy}-${d.target}`,
          sets: String(d.setCount),
          resRange: d.residualRangeArcSec != null ? d.residualRangeArcSec.toFixed(2) : '-',
          maxStd: d.maxStdRes != null ? d.maxStdRes.toFixed(2) : '-',
          spreadMax: d.maxRawSpreadArcSec != null ? d.maxRawSpreadArcSec.toFixed(2) : '-',
          localFail: String(d.localFailCount),
          score: d.suspectScore.toFixed(1),
        }));
        const suspectHeader = {
          rank: '#',
          stations: 'Stations',
          sets: 'Sets',
          resRange: 'ResRange(")',
          maxStd: 'Max|t|',
          spreadMax: 'SpreadMax(")',
          localFail: 'LocalFail',
          score: 'Score',
        };
        const suspectWidths = {
          rank: Math.max(suspectHeader.rank.length, ...suspectRows.map((r) => r.rank.length)),
          stations: Math.max(
            suspectHeader.stations.length,
            ...suspectRows.map((r) => r.stations.length),
          ),
          sets: Math.max(suspectHeader.sets.length, ...suspectRows.map((r) => r.sets.length)),
          resRange: Math.max(
            suspectHeader.resRange.length,
            ...suspectRows.map((r) => r.resRange.length),
          ),
          maxStd: Math.max(suspectHeader.maxStd.length, ...suspectRows.map((r) => r.maxStd.length)),
          spreadMax: Math.max(
            suspectHeader.spreadMax.length,
            ...suspectRows.map((r) => r.spreadMax.length),
          ),
          localFail: Math.max(
            suspectHeader.localFail.length,
            ...suspectRows.map((r) => r.localFail.length),
          ),
          score: Math.max(suspectHeader.score.length, ...suspectRows.map((r) => r.score.length)),
        };
        lines.push(
          [
            pad(suspectHeader.rank, suspectWidths.rank),
            pad(suspectHeader.stations, suspectWidths.stations),
            pad(suspectHeader.sets, suspectWidths.sets),
            pad(suspectHeader.resRange, suspectWidths.resRange),
            pad(suspectHeader.maxStd, suspectWidths.maxStd),
            pad(suspectHeader.spreadMax, suspectWidths.spreadMax),
            pad(suspectHeader.localFail, suspectWidths.localFail),
            pad(suspectHeader.score, suspectWidths.score),
          ].join('  '),
        );
        suspectRows.forEach((r) => {
          lines.push(
            [
              pad(r.rank, suspectWidths.rank),
              pad(r.stations, suspectWidths.stations),
              pad(r.sets, suspectWidths.sets),
              pad(r.resRange, suspectWidths.resRange),
              pad(r.maxStd, suspectWidths.maxStd),
              pad(r.spreadMax, suspectWidths.spreadMax),
              pad(r.localFail, suspectWidths.localFail),
              pad(r.score, suspectWidths.score),
            ].join('  '),
          );
        });
        lines.push('');
      }
    }
    if (res.setupDiagnostics && res.setupDiagnostics.length > 0) {
      lines.push('--- Setup Diagnostics ---');
      const rows = res.setupDiagnostics.map((s) => ({
        station: s.station,
        dirSets: String(s.directionSetCount),
        dirObs: String(s.directionObsCount),
        angles: String(s.angleObsCount),
        dist: String(s.distanceObsCount),
        zen: String(s.zenithObsCount),
        lev: String(s.levelingObsCount),
        gps: String(s.gpsObsCount),
        travDist: (s.traverseDistance * unitScale).toFixed(3),
        orientRms: s.orientationRmsArcSec != null ? s.orientationRmsArcSec.toFixed(2) : '-',
        orientSe: s.orientationSeArcSec != null ? s.orientationSeArcSec.toFixed(2) : '-',
        rmsStd: s.rmsStdRes != null ? s.rmsStdRes.toFixed(2) : '-',
        maxStd: s.maxStdRes != null ? s.maxStdRes.toFixed(2) : '-',
        localFail: String(s.localFailCount),
        worstObs:
          s.worstObsType != null
            ? `${s.worstObsType.toUpperCase()} ${s.worstObsStations ?? ''}`.trim()
            : '-',
        worstLine: s.worstObsLine != null ? String(s.worstObsLine) : '-',
      }));
      const header = {
        station: 'Setup',
        dirSets: 'DirSets',
        dirObs: 'DirObs',
        angles: 'Angles',
        dist: 'Dist',
        zen: 'Zen',
        lev: 'Lev',
        gps: 'GPS',
        travDist: `TravDist(${linearUnit})`,
        orientRms: 'OrientRMS(")',
        orientSe: 'OrientSE(")',
        rmsStd: 'RMS|t|',
        maxStd: 'Max|t|',
        localFail: 'LocalFail',
        worstObs: 'WorstObs',
        worstLine: 'Line',
      };
      const widths = {
        station: Math.max(header.station.length, ...rows.map((r) => r.station.length)),
        dirSets: Math.max(header.dirSets.length, ...rows.map((r) => r.dirSets.length)),
        dirObs: Math.max(header.dirObs.length, ...rows.map((r) => r.dirObs.length)),
        angles: Math.max(header.angles.length, ...rows.map((r) => r.angles.length)),
        dist: Math.max(header.dist.length, ...rows.map((r) => r.dist.length)),
        zen: Math.max(header.zen.length, ...rows.map((r) => r.zen.length)),
        lev: Math.max(header.lev.length, ...rows.map((r) => r.lev.length)),
        gps: Math.max(header.gps.length, ...rows.map((r) => r.gps.length)),
        travDist: Math.max(header.travDist.length, ...rows.map((r) => r.travDist.length)),
        orientRms: Math.max(header.orientRms.length, ...rows.map((r) => r.orientRms.length)),
        orientSe: Math.max(header.orientSe.length, ...rows.map((r) => r.orientSe.length)),
        rmsStd: Math.max(header.rmsStd.length, ...rows.map((r) => r.rmsStd.length)),
        maxStd: Math.max(header.maxStd.length, ...rows.map((r) => r.maxStd.length)),
        localFail: Math.max(header.localFail.length, ...rows.map((r) => r.localFail.length)),
        worstObs: Math.max(header.worstObs.length, ...rows.map((r) => r.worstObs.length)),
        worstLine: Math.max(header.worstLine.length, ...rows.map((r) => r.worstLine.length)),
      };
      const pad = (value: string, size: number) => value.padEnd(size, ' ');
      lines.push(
        [
          pad(header.station, widths.station),
          pad(header.dirSets, widths.dirSets),
          pad(header.dirObs, widths.dirObs),
          pad(header.angles, widths.angles),
          pad(header.dist, widths.dist),
          pad(header.zen, widths.zen),
          pad(header.lev, widths.lev),
          pad(header.gps, widths.gps),
          pad(header.travDist, widths.travDist),
          pad(header.orientRms, widths.orientRms),
          pad(header.orientSe, widths.orientSe),
          pad(header.rmsStd, widths.rmsStd),
          pad(header.maxStd, widths.maxStd),
          pad(header.localFail, widths.localFail),
          pad(header.worstObs, widths.worstObs),
          pad(header.worstLine, widths.worstLine),
        ].join('  '),
      );
      rows.forEach((r) => {
        lines.push(
          [
            pad(r.station, widths.station),
            pad(r.dirSets, widths.dirSets),
            pad(r.dirObs, widths.dirObs),
            pad(r.angles, widths.angles),
            pad(r.dist, widths.dist),
            pad(r.zen, widths.zen),
            pad(r.lev, widths.lev),
            pad(r.gps, widths.gps),
            pad(r.travDist, widths.travDist),
            pad(r.orientRms, widths.orientRms),
            pad(r.orientSe, widths.orientSe),
            pad(r.rmsStd, widths.rmsStd),
            pad(r.maxStd, widths.maxStd),
            pad(r.localFail, widths.localFail),
            pad(r.worstObs, widths.worstObs),
            pad(r.worstLine, widths.worstLine),
          ].join('  '),
        );
      });
      lines.push('');

      const setupSuspects = [...res.setupDiagnostics]
        .filter((s) => s.localFailCount > 0 || (s.maxStdRes ?? 0) >= 2)
        .sort((a, b) => {
          if (b.localFailCount !== a.localFailCount) return b.localFailCount - a.localFailCount;
          const bMax = b.maxStdRes ?? 0;
          const aMax = a.maxStdRes ?? 0;
          if (bMax !== aMax) return bMax - aMax;
          const bRms = b.rmsStdRes ?? 0;
          const aRms = a.rmsStdRes ?? 0;
          if (bRms !== aRms) return bRms - aRms;
          return a.station.localeCompare(b.station);
        })
        .slice(0, 20);
      if (setupSuspects.length > 0) {
        lines.push('--- Setup Suspects ---');
        const suspectRows = setupSuspects.map((s, idx) => ({
          rank: String(idx + 1),
          station: s.station,
          localFail: String(s.localFailCount),
          maxStd: s.maxStdRes != null ? s.maxStdRes.toFixed(2) : '-',
          rmsStd: s.rmsStdRes != null ? s.rmsStdRes.toFixed(2) : '-',
          worstObs:
            s.worstObsType != null
              ? `${s.worstObsType.toUpperCase()} ${s.worstObsStations ?? ''}`.trim()
              : '-',
          line: s.worstObsLine != null ? String(s.worstObsLine) : '-',
        }));
        const suspectHeader = {
          rank: '#',
          station: 'Setup',
          localFail: 'LocalFail',
          maxStd: 'Max|t|',
          rmsStd: 'RMS|t|',
          worstObs: 'WorstObs',
          line: 'Line',
        };
        const suspectWidths = {
          rank: Math.max(suspectHeader.rank.length, ...suspectRows.map((r) => r.rank.length)),
          station: Math.max(
            suspectHeader.station.length,
            ...suspectRows.map((r) => r.station.length),
          ),
          localFail: Math.max(
            suspectHeader.localFail.length,
            ...suspectRows.map((r) => r.localFail.length),
          ),
          maxStd: Math.max(suspectHeader.maxStd.length, ...suspectRows.map((r) => r.maxStd.length)),
          rmsStd: Math.max(suspectHeader.rmsStd.length, ...suspectRows.map((r) => r.rmsStd.length)),
          worstObs: Math.max(
            suspectHeader.worstObs.length,
            ...suspectRows.map((r) => r.worstObs.length),
          ),
          line: Math.max(suspectHeader.line.length, ...suspectRows.map((r) => r.line.length)),
        };
        lines.push(
          [
            pad(suspectHeader.rank, suspectWidths.rank),
            pad(suspectHeader.station, suspectWidths.station),
            pad(suspectHeader.localFail, suspectWidths.localFail),
            pad(suspectHeader.maxStd, suspectWidths.maxStd),
            pad(suspectHeader.rmsStd, suspectWidths.rmsStd),
            pad(suspectHeader.worstObs, suspectWidths.worstObs),
            pad(suspectHeader.line, suspectWidths.line),
          ].join('  '),
        );
        suspectRows.forEach((r) => {
          lines.push(
            [
              pad(r.rank, suspectWidths.rank),
              pad(r.station, suspectWidths.station),
              pad(r.localFail, suspectWidths.localFail),
              pad(r.maxStd, suspectWidths.maxStd),
              pad(r.rmsStd, suspectWidths.rmsStd),
              pad(r.worstObs, suspectWidths.worstObs),
              pad(r.line, suspectWidths.line),
            ].join('  '),
          );
        });
        lines.push('');
      }
    }
    const appendSideshotSection = (title: string, sideshots: typeof outputSideshots): void => {
      if (sideshots.length === 0) return;
      lines.push(`--- ${title} ---`);
      const rows = sideshots.map((s) => ({
        from: s.from,
        to: s.to,
        line: s.sourceLine != null ? String(s.sourceLine) : '-',
        mode: s.mode,
        source: s.sourceType ?? '-',
        relation:
          s.sourceType === 'GS' ? (s.relationFrom ? `FROM=${s.relationFrom}` : 'standalone') : '-',
        az: s.azimuth != null ? radToDmsStr(s.azimuth) : '-',
        azSrc: s.azimuthSource ?? '-',
        hd: (s.horizDistance * unitScale).toFixed(4),
        dH: s.deltaH != null ? (s.deltaH * unitScale).toFixed(4) : '-',
        northing: s.northing != null ? (s.northing * unitScale).toFixed(4) : '-',
        easting: s.easting != null ? (s.easting * unitScale).toFixed(4) : '-',
        height: s.height != null ? (s.height * unitScale).toFixed(4) : '-',
        sigmaN: s.sigmaN != null ? (s.sigmaN * unitScale).toFixed(4) : '-',
        sigmaE: s.sigmaE != null ? (s.sigmaE * unitScale).toFixed(4) : '-',
        sigmaH: s.sigmaH != null ? (s.sigmaH * unitScale).toFixed(4) : '-',
        note: s.note ?? '-',
      }));
      const header = {
        from: 'From',
        to: 'To',
        line: 'Line',
        mode: 'Mode',
        source: 'Source',
        relation: 'Relation',
        az: 'Az',
        azSrc: 'AzSrc',
        hd: `HD(${linearUnit})`,
        dH: `dH(${linearUnit})`,
        northing: `Northing(${linearUnit})`,
        easting: `Easting(${linearUnit})`,
        height: `Height(${linearUnit})`,
        sigmaN: `σN(${linearUnit})`,
        sigmaE: `σE(${linearUnit})`,
        sigmaH: `σH(${linearUnit})`,
        note: 'Note',
      };
      const widths = {
        from: Math.max(header.from.length, ...rows.map((r) => r.from.length)),
        to: Math.max(header.to.length, ...rows.map((r) => r.to.length)),
        line: Math.max(header.line.length, ...rows.map((r) => r.line.length)),
        mode: Math.max(header.mode.length, ...rows.map((r) => r.mode.length)),
        source: Math.max(header.source.length, ...rows.map((r) => r.source.length)),
        relation: Math.max(header.relation.length, ...rows.map((r) => r.relation.length)),
        az: Math.max(header.az.length, ...rows.map((r) => r.az.length)),
        azSrc: Math.max(header.azSrc.length, ...rows.map((r) => r.azSrc.length)),
        hd: Math.max(header.hd.length, ...rows.map((r) => r.hd.length)),
        dH: Math.max(header.dH.length, ...rows.map((r) => r.dH.length)),
        northing: Math.max(header.northing.length, ...rows.map((r) => r.northing.length)),
        easting: Math.max(header.easting.length, ...rows.map((r) => r.easting.length)),
        height: Math.max(header.height.length, ...rows.map((r) => r.height.length)),
        sigmaN: Math.max(header.sigmaN.length, ...rows.map((r) => r.sigmaN.length)),
        sigmaE: Math.max(header.sigmaE.length, ...rows.map((r) => r.sigmaE.length)),
        sigmaH: Math.max(header.sigmaH.length, ...rows.map((r) => r.sigmaH.length)),
        note: Math.max(header.note.length, ...rows.map((r) => r.note.length)),
      };
      const pad = (value: string, size: number) => value.padEnd(size, ' ');
      lines.push(
        [
          pad(header.from, widths.from),
          pad(header.to, widths.to),
          pad(header.line, widths.line),
          pad(header.mode, widths.mode),
          pad(header.source, widths.source),
          pad(header.relation, widths.relation),
          pad(header.az, widths.az),
          pad(header.azSrc, widths.azSrc),
          pad(header.hd, widths.hd),
          pad(header.dH, widths.dH),
          pad(header.northing, widths.northing),
          pad(header.easting, widths.easting),
          pad(header.height, widths.height),
          pad(header.sigmaN, widths.sigmaN),
          pad(header.sigmaE, widths.sigmaE),
          pad(header.sigmaH, widths.sigmaH),
          pad(header.note, widths.note),
        ].join('  '),
      );
      rows.forEach((r) => {
        lines.push(
          [
            pad(r.from, widths.from),
            pad(r.to, widths.to),
            pad(r.line, widths.line),
            pad(r.mode, widths.mode),
            pad(r.source, widths.source),
            pad(r.relation, widths.relation),
            pad(r.az, widths.az),
            pad(r.azSrc, widths.azSrc),
            pad(r.hd, widths.hd),
            pad(r.dH, widths.dH),
            pad(r.northing, widths.northing),
            pad(r.easting, widths.easting),
            pad(r.height, widths.height),
            pad(r.sigmaN, widths.sigmaN),
            pad(r.sigmaE, widths.sigmaE),
            pad(r.sigmaH, widths.sigmaH),
            pad(r.note, widths.note),
          ].join('  '),
        );
      });
      lines.push('');
    };
    appendSideshotSection('Post-Adjusted Sideshots (TS)', outputTsSideshots);
    appendSideshotSection('Post-Adjusted GPS Sideshot Vectors', outputGpsVectorSideshots);
    appendSideshotSection('Post-Adjusted GNSS Topo Coordinates (GS)', outputGpsCoordinateSideshots);
    const appendGpsLoopSection = (): void => {
      if (!gpsLoopDiagnostics?.enabled) return;
      lines.push('--- GPS Loop Diagnostics ---');
      lines.push(
        `vectors=${gpsLoopDiagnostics.vectorCount}, loops=${gpsLoopDiagnostics.loopCount}, pass=${gpsLoopDiagnostics.passCount}, warn=${gpsLoopDiagnostics.warnCount}, tolerance=${(gpsLoopDiagnostics.thresholds.baseToleranceM * unitScale).toFixed(4)}${linearUnit}+${gpsLoopDiagnostics.thresholds.ppmTolerance}ppm*dist`,
      );
      const rows = gpsLoopDiagnostics.loops.map((loop) => ({
        rank: String(loop.rank),
        key: loop.key,
        status: loop.pass ? 'PASS' : 'WARN',
        closure: (loop.closureMag * unitScale).toFixed(4),
        tolerance: (loop.toleranceM * unitScale).toFixed(4),
        ppm: loop.linearPpm != null ? loop.linearPpm.toFixed(1) : '-',
        ratio: loop.closureRatio != null ? `1:${loop.closureRatio.toFixed(0)}` : '-',
        severity: loop.severity.toFixed(2),
        lines: loop.sourceLines.length > 0 ? loop.sourceLines.join(',') : '-',
        path: loop.stationPath.join('->'),
      }));
      const header = {
        rank: '#',
        key: 'Loop',
        status: 'Status',
        closure: `Closure(${linearUnit})`,
        tolerance: `Tol(${linearUnit})`,
        ppm: 'Linear(ppm)',
        ratio: 'Ratio',
        severity: 'Severity',
        lines: 'Lines',
        path: 'Path',
      };
      const widths = {
        rank: Math.max(header.rank.length, ...rows.map((r) => r.rank.length)),
        key: Math.max(header.key.length, ...rows.map((r) => r.key.length)),
        status: Math.max(header.status.length, ...rows.map((r) => r.status.length)),
        closure: Math.max(header.closure.length, ...rows.map((r) => r.closure.length)),
        tolerance: Math.max(header.tolerance.length, ...rows.map((r) => r.tolerance.length)),
        ppm: Math.max(header.ppm.length, ...rows.map((r) => r.ppm.length)),
        ratio: Math.max(header.ratio.length, ...rows.map((r) => r.ratio.length)),
        severity: Math.max(header.severity.length, ...rows.map((r) => r.severity.length)),
        lines: Math.max(header.lines.length, ...rows.map((r) => r.lines.length)),
        path: Math.max(header.path.length, ...rows.map((r) => r.path.length)),
      };
      const pad = (value: string, size: number) => value.padEnd(size, ' ');
      lines.push(
        [
          pad(header.rank, widths.rank),
          pad(header.key, widths.key),
          pad(header.status, widths.status),
          pad(header.closure, widths.closure),
          pad(header.tolerance, widths.tolerance),
          pad(header.ppm, widths.ppm),
          pad(header.ratio, widths.ratio),
          pad(header.severity, widths.severity),
          pad(header.lines, widths.lines),
          pad(header.path, widths.path),
        ].join('  '),
      );
      rows.forEach((row) => {
        lines.push(
          [
            pad(row.rank, widths.rank),
            pad(row.key, widths.key),
            pad(row.status, widths.status),
            pad(row.closure, widths.closure),
            pad(row.tolerance, widths.tolerance),
            pad(row.ppm, widths.ppm),
            pad(row.ratio, widths.ratio),
            pad(row.severity, widths.severity),
            pad(row.lines, widths.lines),
            pad(row.path, widths.path),
          ].join('  '),
        );
      });
      lines.push('');
    };
    appendGpsLoopSection();
    if (!isPreanalysis) {
      lines.push('--- Observations & Residuals ---');
      lines.push(`MDB units: arcsec for angular types; ${linearUnit} for linear types`);
      const autoSideshotObsIds = new Set(
        res.autoSideshotDiagnostics?.candidates.flatMap((c) => [c.angleObsId, c.distObsId]) ?? [],
      );
      const rows: {
        type: string;
        stations: string;
        sourceLine: string;
        obs: string;
        calc: string;
        residual: string;
        stdRes: string;
        redundancy: string;
        localTest: string;
        mdb: string;
        prism: string;
        tag: string;
        stdResAbs: number;
      }[] = [];
      const isAngularType = (type: string) =>
        type === 'angle' ||
        type === 'direction' ||
        type === 'bearing' ||
        type === 'dir' ||
        type === 'zenith';
      const formatMdb = (value: number, angular: boolean): string => {
        if (!Number.isFinite(value)) return 'inf';
        return angular
          ? `${(value * RAD_TO_DEG * 3600).toFixed(2)}"`
          : (value * unitScale).toFixed(4);
      };
      const prismTagForObservation = (obs: Observation): string => {
        if (obs.type !== 'dist' && obs.type !== 'zenith') return '-';
        const correction = obs.prismCorrectionM ?? 0;
        if (!Number.isFinite(correction) || Math.abs(correction) <= 0) return '-';
        const scope = obs.prismScope ?? 'global';
        const sign = correction >= 0 ? '+' : '';
        return `${scope}:${sign}${(correction * unitScale).toFixed(4)}${linearUnit}`;
      };
      outputObservations.forEach((obs) => {
        let stations = '';
        let obsStr = '';
        let calcStr = '';
        let resStr = '';
        const angular = isAngularType(obs.type);
        if (obs.type === 'angle') {
          stations = `${obs.at}-${obs.from}-${obs.to}`;
          obsStr = radToDmsStr(obs.obs);
          calcStr = obs.calc != null ? radToDmsStr(obs.calc as number) : '-';
          resStr =
            obs.residual != null
              ? `${((obs.residual as number) * RAD_TO_DEG * 3600).toFixed(2)}"`
              : '-';
        } else if (obs.type === 'direction') {
          const reductionLabel =
            obs.rawCount != null
              ? ` [raw ${obs.rawCount}->1, F1:${obs.rawFace1Count ?? '-'} F2:${obs.rawFace2Count ?? '-'}]`
              : '';
          stations = `${obs.at}-${obs.to} (${obs.setId})${reductionLabel}`;
          obsStr = radToDmsStr(obs.obs);
          calcStr = obs.calc != null ? radToDmsStr(obs.calc as number) : '-';
          resStr =
            obs.residual != null
              ? `${((obs.residual as number) * RAD_TO_DEG * 3600).toFixed(2)}"`
              : '-';
        } else if (obs.type === 'dir') {
          stations = `${obs.from}-${obs.to}`;
          obsStr = radToDmsStr(obs.obs);
          calcStr = obs.calc != null ? radToDmsStr(obs.calc as number) : '-';
          resStr =
            obs.residual != null
              ? `${((obs.residual as number) * RAD_TO_DEG * 3600).toFixed(2)}"`
              : '-';
        } else if (obs.type === 'dist') {
          stations = `${obs.from}-${obs.to}`;
          obsStr = (obs.obs * unitScale).toFixed(4);
          calcStr = obs.calc != null ? ((obs.calc as number) * unitScale).toFixed(4) : '-';
          resStr = obs.residual != null ? ((obs.residual as number) * unitScale).toFixed(4) : '-';
        } else if (obs.type === 'bearing') {
          stations = `${obs.from}-${obs.to}`;
          obsStr = radToDmsStr(obs.obs);
          calcStr = obs.calc != null ? radToDmsStr(obs.calc as number) : '-';
          resStr =
            obs.residual != null
              ? `${((obs.residual as number) * RAD_TO_DEG * 3600).toFixed(2)}"`
              : '-';
        } else if (obs.type === 'zenith') {
          stations = `${obs.from}-${obs.to}`;
          obsStr = radToDmsStr(obs.obs);
          calcStr = obs.calc != null ? radToDmsStr(obs.calc as number) : '-';
          resStr =
            obs.residual != null
              ? `${((obs.residual as number) * RAD_TO_DEG * 3600).toFixed(2)}"`
              : '-';
        } else if (obs.type === 'gps') {
          stations = `${obs.from}-${obs.to}`;
          obsStr = `dE=${(obs.obs.dE * unitScale).toFixed(3)}, dN=${(obs.obs.dN * unitScale).toFixed(3)}`;
          calcStr =
            obs.calc != null
              ? `dE=${((obs.calc as { dE: number }).dE * unitScale).toFixed(3)}, dN=${(
                  (obs.calc as { dN: number; dE: number }).dN * unitScale
                ).toFixed(3)}`
              : '-';
          resStr =
            obs.residual != null
              ? `vE=${((obs.residual as { vE: number }).vE * unitScale).toFixed(3)}, vN=${(
                  (obs.residual as { vN: number; vE: number }).vN * unitScale
                ).toFixed(3)}`
              : '-';
        } else if (obs.type === 'lev') {
          stations = `${obs.from}-${obs.to}`;
          obsStr = (obs.obs * unitScale).toFixed(4);
          calcStr = obs.calc != null ? ((obs.calc as number) * unitScale).toFixed(4) : '-';
          resStr = obs.residual != null ? ((obs.residual as number) * unitScale).toFixed(4) : '-';
        }
        stations = `${stations}${aliasRefsForLine(obs.sourceLine)}`;

        const localTest =
          obs.localTestComponents != null
            ? `E:${obs.localTestComponents.passE ? 'PASS' : 'FAIL'} N:${
                obs.localTestComponents.passN ? 'PASS' : 'FAIL'
              }`
            : obs.localTest != null
              ? obs.localTest.pass
                ? 'PASS'
                : 'FAIL'
              : '-';
        const mdb =
          obs.mdbComponents != null
            ? `E=${formatMdb(obs.mdbComponents.mE, angular)}, N=${formatMdb(obs.mdbComponents.mN, angular)}`
            : obs.mdb != null
              ? formatMdb(obs.mdb, angular)
              : '-';
        const stdResAbs = Math.abs(obs.stdRes ?? 0);

        rows.push({
          type: obs.type,
          stations,
          sourceLine: obs.sourceLine != null ? String(obs.sourceLine) : '-',
          obs: obsStr || '-',
          calc: calcStr || '-',
          residual: resStr || '-',
          stdRes:
            obs.stdResComponents != null
              ? `${obs.stdResComponents.tE.toFixed(3)}/${obs.stdResComponents.tN.toFixed(3)}`
              : obs.stdRes != null
                ? obs.stdRes.toFixed(3)
                : '-',
          redundancy:
            typeof obs.redundancy === 'object'
              ? `${obs.redundancy.rE.toFixed(3)}/${obs.redundancy.rN.toFixed(3)}`
              : obs.redundancy != null
                ? obs.redundancy.toFixed(3)
                : '-',
          localTest,
          mdb,
          prism: prismTagForObservation(obs),
          tag: autoSideshotObsIds.has(obs.id) ? 'AUTO-SS' : '-',
          stdResAbs,
        });
      });

      rows.sort((a, b) => b.stdResAbs - a.stdResAbs);
      const suspects = rows
        .filter((r) => r.localTest.includes('FAIL') || r.stdResAbs >= 2)
        .slice(0, 20);

      if (suspects.length > 0) {
        lines.push('--- Top Suspects ---');
        const suspectHeader = {
          rank: '#',
          type: 'Type',
          stations: 'Stations',
          line: 'Line',
          stdRes: 'StdRes',
          local: 'Local',
          mdb: 'MDB',
        };
        const suspectRows = suspects.map((r, idx) => ({
          rank: String(idx + 1),
          type: r.type,
          stations: r.stations,
          line: r.sourceLine,
          stdRes: r.stdRes,
          local: r.localTest,
          mdb: r.mdb,
        }));
        const suspectWidths = {
          rank: Math.max(suspectHeader.rank.length, ...suspectRows.map((r) => r.rank.length)),
          type: Math.max(suspectHeader.type.length, ...suspectRows.map((r) => r.type.length)),
          stations: Math.max(
            suspectHeader.stations.length,
            ...suspectRows.map((r) => r.stations.length),
          ),
          line: Math.max(suspectHeader.line.length, ...suspectRows.map((r) => r.line.length)),
          stdRes: Math.max(suspectHeader.stdRes.length, ...suspectRows.map((r) => r.stdRes.length)),
          local: Math.max(suspectHeader.local.length, ...suspectRows.map((r) => r.local.length)),
          mdb: Math.max(suspectHeader.mdb.length, ...suspectRows.map((r) => r.mdb.length)),
        };
        const pad = (value: string, size: number) => value.padEnd(size, ' ');
        lines.push(
          [
            pad(suspectHeader.rank, suspectWidths.rank),
            pad(suspectHeader.type, suspectWidths.type),
            pad(suspectHeader.stations, suspectWidths.stations),
            pad(suspectHeader.line, suspectWidths.line),
            pad(suspectHeader.stdRes, suspectWidths.stdRes),
            pad(suspectHeader.local, suspectWidths.local),
            pad(suspectHeader.mdb, suspectWidths.mdb),
          ].join('  '),
        );
        suspectRows.forEach((r) => {
          lines.push(
            [
              pad(r.rank, suspectWidths.rank),
              pad(r.type, suspectWidths.type),
              pad(r.stations, suspectWidths.stations),
              pad(r.line, suspectWidths.line),
              pad(r.stdRes, suspectWidths.stdRes),
              pad(r.local, suspectWidths.local),
              pad(r.mdb, suspectWidths.mdb),
            ].join('  '),
          );
        });
        lines.push('');
      }

      if (res.suspectImpactDiagnostics && res.suspectImpactDiagnostics.length > 0) {
        lines.push('--- Suspect Impact Analysis (what-if exclusion) ---');
        const impactRows = res.suspectImpactDiagnostics.map((d, idx) => ({
          rank: String(idx + 1),
          type: d.type,
          stations: d.stations,
          line: d.sourceLine != null ? String(d.sourceLine) : '-',
          baseStdRes: d.baseStdRes != null ? d.baseStdRes.toFixed(2) : '-',
          dSeuw: d.deltaSeuw != null ? d.deltaSeuw.toFixed(4) : '-',
          dMaxStd: d.deltaMaxStdRes != null ? d.deltaMaxStdRes.toFixed(2) : '-',
          chi: d.chiDelta,
          shift: d.maxCoordShift != null ? (d.maxCoordShift * unitScale).toFixed(4) : '-',
          score: d.score != null ? d.score.toFixed(1) : '-',
          status: d.status.toUpperCase(),
        }));
        const impactHeader = {
          rank: '#',
          type: 'Type',
          stations: 'Stations',
          line: 'Line',
          baseStdRes: 'Base|t|',
          dSeuw: 'dSEUW',
          dMaxStd: 'dMax|t|',
          chi: 'ChiDelta',
          shift: `MaxShift(${linearUnit})`,
          score: 'Score',
          status: 'Status',
        };
        const impactWidths = {
          rank: Math.max(impactHeader.rank.length, ...impactRows.map((r) => r.rank.length)),
          type: Math.max(impactHeader.type.length, ...impactRows.map((r) => r.type.length)),
          stations: Math.max(
            impactHeader.stations.length,
            ...impactRows.map((r) => r.stations.length),
          ),
          line: Math.max(impactHeader.line.length, ...impactRows.map((r) => r.line.length)),
          baseStdRes: Math.max(
            impactHeader.baseStdRes.length,
            ...impactRows.map((r) => r.baseStdRes.length),
          ),
          dSeuw: Math.max(impactHeader.dSeuw.length, ...impactRows.map((r) => r.dSeuw.length)),
          dMaxStd: Math.max(
            impactHeader.dMaxStd.length,
            ...impactRows.map((r) => r.dMaxStd.length),
          ),
          chi: Math.max(impactHeader.chi.length, ...impactRows.map((r) => r.chi.length)),
          shift: Math.max(impactHeader.shift.length, ...impactRows.map((r) => r.shift.length)),
          score: Math.max(impactHeader.score.length, ...impactRows.map((r) => r.score.length)),
          status: Math.max(impactHeader.status.length, ...impactRows.map((r) => r.status.length)),
        };
        const pad = (value: string, size: number) => value.padEnd(size, ' ');
        lines.push(
          [
            pad(impactHeader.rank, impactWidths.rank),
            pad(impactHeader.type, impactWidths.type),
            pad(impactHeader.stations, impactWidths.stations),
            pad(impactHeader.line, impactWidths.line),
            pad(impactHeader.baseStdRes, impactWidths.baseStdRes),
            pad(impactHeader.dSeuw, impactWidths.dSeuw),
            pad(impactHeader.dMaxStd, impactWidths.dMaxStd),
            pad(impactHeader.chi, impactWidths.chi),
            pad(impactHeader.shift, impactWidths.shift),
            pad(impactHeader.score, impactWidths.score),
            pad(impactHeader.status, impactWidths.status),
          ].join('  '),
        );
        impactRows.forEach((r) => {
          lines.push(
            [
              pad(r.rank, impactWidths.rank),
              pad(r.type, impactWidths.type),
              pad(r.stations, impactWidths.stations),
              pad(r.line, impactWidths.line),
              pad(r.baseStdRes, impactWidths.baseStdRes),
              pad(r.dSeuw, impactWidths.dSeuw),
              pad(r.dMaxStd, impactWidths.dMaxStd),
              pad(r.chi, impactWidths.chi),
              pad(r.shift, impactWidths.shift),
              pad(r.score, impactWidths.score),
              pad(r.status, impactWidths.status),
            ].join('  '),
          );
        });
        lines.push('');
      }

      const headers = {
        type: 'Type',
        stations: 'Stations',
        sourceLine: 'Line',
        obs: 'Obs',
        calc: 'Calc',
        residual: 'Residual',
        stdRes: 'StdRes',
        redundancy: 'Redund',
        localTest: 'Local',
        mdb: 'MDB',
        prism: 'Prism',
        tag: 'Tag',
      };
      const widths = {
        type: Math.max(headers.type.length, ...rows.map((r) => r.type.length)),
        stations: Math.max(headers.stations.length, ...rows.map((r) => r.stations.length)),
        sourceLine: Math.max(headers.sourceLine.length, ...rows.map((r) => r.sourceLine.length)),
        obs: Math.max(headers.obs.length, ...rows.map((r) => r.obs.length)),
        calc: Math.max(headers.calc.length, ...rows.map((r) => r.calc.length)),
        residual: Math.max(headers.residual.length, ...rows.map((r) => r.residual.length)),
        stdRes: Math.max(headers.stdRes.length, ...rows.map((r) => r.stdRes.length)),
        redundancy: Math.max(headers.redundancy.length, ...rows.map((r) => r.redundancy.length)),
        localTest: Math.max(headers.localTest.length, ...rows.map((r) => r.localTest.length)),
        mdb: Math.max(headers.mdb.length, ...rows.map((r) => r.mdb.length)),
        prism: Math.max(headers.prism.length, ...rows.map((r) => r.prism.length)),
        tag: Math.max(headers.tag.length, ...rows.map((r) => r.tag.length)),
      };
      const pad = (value: string, size: number) => value.padEnd(size, ' ');
      lines.push(
        [
          pad(headers.type, widths.type),
          pad(headers.stations, widths.stations),
          pad(headers.sourceLine, widths.sourceLine),
          pad(headers.obs, widths.obs),
          pad(headers.calc, widths.calc),
          pad(headers.residual, widths.residual),
          pad(headers.stdRes, widths.stdRes),
          pad(headers.redundancy, widths.redundancy),
          pad(headers.localTest, widths.localTest),
          pad(headers.mdb, widths.mdb),
          pad(headers.prism, widths.prism),
          pad(headers.tag, widths.tag),
        ].join('  '),
      );
      rows.forEach((r) => {
        lines.push(
          [
            pad(r.type, widths.type),
            pad(r.stations, widths.stations),
            pad(r.sourceLine, widths.sourceLine),
            pad(r.obs, widths.obs),
            pad(r.calc, widths.calc),
            pad(r.residual, widths.residual),
            pad(r.stdRes, widths.stdRes),
            pad(r.redundancy, widths.redundancy),
            pad(r.localTest, widths.localTest),
            pad(r.mdb, widths.mdb),
            pad(r.prism, widths.prism),
            pad(r.tag, widths.tag),
          ].join('  '),
        );
      });
      lines.push('');
    }
    if (aliasTrace.length > 0) {
      lines.push('--- Alias Reference Trace ---');
      lines.push(
        'Context  Detail            Line  SourceAlias          CanonicalID          Reference',
      );
      aliasTrace.forEach((entry) => {
        lines.push(
          `${entry.context.padEnd(8)}  ${(entry.detail ?? '-').padEnd(16)}  ${String(entry.sourceLine ?? '-').padStart(4)}  ${entry.sourceId.padEnd(19)}  ${entry.canonicalId.padEnd(19)}  ${entry.reference ?? '-'}`,
        );
      });
      lines.push('');
    }
    lines.push('--- Processing Log ---');
    res.logs.forEach((l) => lines.push(l));

    return lines.join('\n');
  };
  return {
    buildResultsText,
  };
};
