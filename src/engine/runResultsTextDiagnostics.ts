import { RAD_TO_DEG } from './angles';
import { findLevelLoopTolerancePreset } from './levelLoopTolerance';
import type { RunResultsTextContext } from './runResultsTextContext';
import type { AdjustmentResult, CustomLevelLoopTolerancePreset } from '../types';

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

export const appendSolveProfileDiagnostics = ({
  lines,
  res,
  levelLoopCustomPresets,
  context,
}: {
  lines: string[];
  res: AdjustmentResult;
  levelLoopCustomPresets: CustomLevelLoopTolerancePreset[];
  context: RunResultsTextContext;
}): void => {
  const {
    linearUnit,
    unitScale,
    runDiag,
    traceabilityModel,
    aliasTrace,
    descriptionReconcileMode,
    descriptionAppendDelimiter,
    dataCheckDiffRows,
    gpsLoopDiagnostics,
    isBlunderDetectMode,
    isDataCheckMode,
    runModeSummaryText,
    showLostStationsInOutputs,
  } = context;

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
};
