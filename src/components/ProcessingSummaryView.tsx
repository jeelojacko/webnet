import React, { useMemo } from 'react';
import { RAD_TO_DEG } from '../engine/angles';
import type {
  AdjustmentResult,
  CoordSystemDiagnosticCode,
  CrsOffReason,
  CrsStatus,
  DatumSufficiencyReport,
  DirectiveNoEffectWarning,
  DirectiveTransition,
  GnssVectorFrame,
  Observation,
  ReductionUsageSummary,
  RunMode,
} from '../types';

interface ProcessingSummaryViewProps {
  result: AdjustmentResult;
  units: 'm' | 'ft';
  runElapsedMs: number | null;
  runDiagnostics: {
    solveProfile: 'webnet' | 'industry-parity';
    runMode?: RunMode;
    directionSetMode: 'reduced' | 'raw';
    profileDefaultInstrumentFallback: boolean;
    rotationAngleRad: number;
    coordSystemMode?: 'local' | 'grid';
    crsId?: string;
    localDatumScheme?: 'average-scale' | 'common-elevation';
    averageScaleFactor?: number;
    scaleOverrideActive?: boolean;
    commonElevation?: number;
    averageGeoidHeight?: number;
    gnssVectorFrameDefault?: GnssVectorFrame;
    gnssFrameConfirmed?: boolean;
    gridBearingMode?: 'measured' | 'grid';
    gridDistanceMode?: 'measured' | 'grid' | 'ellipsoidal';
    gridAngleMode?: 'measured' | 'grid';
    gridDirectionMode?: 'measured' | 'grid';
    datumSufficiencyReport?: DatumSufficiencyReport;
    parsedUsageSummary?: ReductionUsageSummary;
    usedInSolveUsageSummary?: ReductionUsageSummary;
    directiveTransitions?: DirectiveTransition[];
    directiveNoEffectWarnings?: DirectiveNoEffectWarning[];
    coordSystemDiagnostics?: CoordSystemDiagnosticCode[];
    coordSystemWarningMessages?: string[];
    crsStatus?: CrsStatus;
    crsOffReason?: CrsOffReason;
    crsDatumOpId?: string;
    crsDatumFallbackUsed?: boolean;
    crsAreaOfUseStatus?: 'inside' | 'outside' | 'unknown';
    crsOutOfAreaStationCount?: number;
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
  } | null;
}

type SummaryRow = {
  label: string;
  count: number;
  sumSquares: number;
  errorFactor: number;
};
const FT_PER_M = 3.280839895;

const classifyRow = (obs: Observation): string => {
  if (obs.type === 'angle') return 'Angles';
  if (obs.type === 'dist') return 'Distances';
  if (obs.type === 'direction' || obs.type === 'dir' || obs.type === 'bearing')
    return 'Az/Bearings';
  if (obs.type === 'gps') return 'GPS';
  if (obs.type === 'lev') return 'Leveling';
  if (obs.type === 'zenith') return 'Zenith';
  return 'Other';
};

const elapsedStr = (ms: number | null): string => {
  if (!ms || !Number.isFinite(ms) || ms < 0) return '00:00:00';
  const seconds = Math.round(ms / 1000);
  const hh = Math.floor(seconds / 3600);
  const mm = Math.floor((seconds % 3600) / 60);
  const ss = seconds % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
};

const padRight = (value: string, width: number) => value.padEnd(width, ' ');
const padLeft = (value: string, width: number) => value.padStart(width, ' ');

const ProcessingSummaryView: React.FC<ProcessingSummaryViewProps> = ({
  result,
  units,
  runElapsedMs,
  runDiagnostics,
}) => {
  const text = useMemo(() => {
    const unitScale = units === 'ft' ? FT_PER_M : 1;
    const linearUnit = units === 'ft' ? 'ft' : 'm';
    const runMode: RunMode =
      result.parseState?.runMode ??
      runDiagnostics?.runMode ??
      (result.preanalysisMode ? 'preanalysis' : 'adjustment');
    const isDataCheck = runMode === 'data-check';
    const isBlunderDetect = runMode === 'blunder-detect';
    let summaryRows: SummaryRow[] = [];
    let totalCount = 0;
    if (result.statisticalSummary?.byGroup?.length) {
      summaryRows = result.statisticalSummary.byGroup.map((row) => ({
        label: row.label,
        count: row.count,
        sumSquares: row.sumSquares,
        errorFactor: row.errorFactor,
      }));
      totalCount = result.statisticalSummary.totalCount;
    } else {
      const rowsMap = new Map<string, { count: number; sumSquares: number }>();
      result.observations.forEach((obs) => {
        if (!Number.isFinite(obs.stdRes)) return;
        const key = classifyRow(obs);
        const sumSq = (obs.stdRes ?? 0) * (obs.stdRes ?? 0);
        const row = rowsMap.get(key) ?? { count: 0, sumSquares: 0 };
        row.count += 1;
        row.sumSquares += sumSq;
        rowsMap.set(key, row);
        totalCount += 1;
      });
      summaryRows = [...rowsMap.entries()]
        .map(([label, row]) => ({
          label,
          count: row.count,
          sumSquares: row.sumSquares,
          errorFactor: row.count > 0 ? Math.sqrt(row.sumSquares / row.count) : 0,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }

    const lines: string[] = [];
    lines.push('Loading Network Data ...');
    lines.push('Checking Network Data ...');
    lines.push('');
    if (isDataCheck) {
      lines.push('Performing Data Check Only ...');
    } else if (isBlunderDetect) {
      lines.push('Performing Blunder Detect Workflow ...');
    } else if (runMode === 'preanalysis') {
      lines.push('Performing Preanalysis Workflow ...');
    } else {
      lines.push('Performing Network Adjustment ...');
    }
    for (let i = 1; i <= result.iterations; i += 1) {
      lines.push(`  Iteration # ${i}`);
    }
    lines.push(
      result.converged
        ? `Solution has converged in ${result.iterations} iterations`
        : `Solution did not fully converge after ${result.iterations} iterations`,
    );
    if (isDataCheck) {
      const dataCheckRows = result.observations
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
            const value =
              obs.type === 'angle' ||
              obs.type === 'direction' ||
              obs.type === 'bearing' ||
              obs.type === 'dir' ||
              obs.type === 'zenith'
                ? Math.abs(residual * RAD_TO_DEG * 3600)
                : Math.abs(residual) * unitScale;
            const label =
              obs.type === 'angle' ||
              obs.type === 'direction' ||
              obs.type === 'bearing' ||
              obs.type === 'dir' ||
              obs.type === 'zenith'
                ? `${value.toFixed(2)}"`
                : `${value.toFixed(4)}${linearUnit}`;
            const stations =
              obs.type === 'angle'
                ? `${obs.at}-${obs.from}-${obs.to}`
                : 'from' in obs && 'to' in obs
                  ? `${obs.from}-${obs.to}`
                  : '-';
            return { obs, value, label, stations };
          }
          if (obs.type === 'gps' && obs.residual && typeof obs.residual === 'object') {
            const residual = obs.residual as { vE?: number; vN?: number };
            const vE = Number.isFinite(residual.vE as number)
              ? (residual.vE as number)
              : Number.NaN;
            const vN = Number.isFinite(residual.vN as number)
              ? (residual.vN as number)
              : Number.NaN;
            if (!Number.isFinite(vE) || !Number.isFinite(vN)) return null;
            const value = Math.hypot(vE, vN) * unitScale;
            const stations = `${obs.from}-${obs.to}`;
            return { obs, value, label: `${value.toFixed(4)}${linearUnit}`, stations };
          }
          return null;
        })
        .filter((row): row is NonNullable<typeof row> => row != null)
        .sort((a, b) => b.value - a.value)
        .slice(0, 20);
      lines.push('');
      lines.push('Data Check Only: Differences from Observations');
      lines.push(
        `${padRight('Obs#', 8)}${padRight('Type', 12)}${padRight('Stations', 18)}${padLeft('Difference', 16)}${padLeft('|t|', 8)}${padLeft('Line', 8)}`,
      );
      dataCheckRows.forEach((row) => {
        lines.push(
          `${padRight(String(row.obs.id), 8)}${padRight(row.obs.type.toUpperCase(), 12)}${padRight(row.stations, 18)}${padLeft(row.label, 16)}${padLeft(Number.isFinite(row.obs.stdRes ?? Number.NaN) ? Math.abs(row.obs.stdRes ?? 0).toFixed(2) : '-', 8)}${padLeft(row.obs.sourceLine != null ? String(row.obs.sourceLine) : '-', 8)}`,
        );
      });
    }
    if (isBlunderDetect) {
      lines.push('');
      lines.push('Blunder Detect Mode');
      lines.push(
        'Warning: iterative deweighting diagnostics; not a replacement for full adjustment QA.',
      );
      const cycleLines = result.logs
        .filter((line) => line.startsWith('Blunder cycle '))
        .slice(0, 15);
      cycleLines.forEach((line) => lines.push(`  ${line}`));
    }
    lines.push('');
    lines.push('Statistical Summary');
    lines.push(
      `${padRight('Observation', 18)}${padLeft('Count', 7)}${padLeft('Error Factor', 14)}`,
    );
    summaryRows.forEach((row) => {
      lines.push(
        `${padRight(row.label, 18)}${padLeft(row.count.toString(), 7)}${padLeft(
          row.errorFactor.toFixed(3),
          14,
        )}`,
      );
    });
    if (totalCount > 0) {
      lines.push(
        `${padRight('Total', 18)}${padLeft(totalCount.toString(), 7)}${padLeft(result.seuw.toFixed(3), 14)}`,
      );
    }
    const effectiveByFamily = new Map<
      string,
      { count: number; sum: number; min: number; max: number }
    >();
    result.observations.forEach((obs) => {
      if (!Number.isFinite(obs.effectiveDistance)) return;
      const effectiveDistance = obs.effectiveDistance as number;
      if (!(effectiveDistance > 0)) return;
      const family =
        obs.type === 'angle'
          ? 'Angles'
          : obs.type === 'direction'
            ? 'Directions'
            : obs.type === 'bearing' || obs.type === 'dir'
              ? 'Az/Bearings'
              : obs.type === 'zenith'
                ? 'Zenith'
                : null;
      if (family == null) return;
      const row = effectiveByFamily.get(family) ?? {
        count: 0,
        sum: 0,
        min: Number.POSITIVE_INFINITY,
        max: 0,
      };
      row.count += 1;
      row.sum += effectiveDistance;
      row.min = Math.min(row.min, effectiveDistance);
      row.max = Math.max(row.max, effectiveDistance);
      effectiveByFamily.set(family, row);
    });
    if (effectiveByFamily.size > 0) {
      lines.push('');
      lines.push(`Effective Distance Summary (${linearUnit})`);
      lines.push(
        `${padRight('Observation', 18)}${padLeft('Count', 7)}${padLeft('Mean', 12)}${padLeft(
          'Min',
          12,
        )}${padLeft('Max', 12)}`,
      );
      [...effectiveByFamily.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .forEach(([label, row]) => {
          lines.push(
            `${padRight(label, 18)}${padLeft(row.count.toString(), 7)}${padLeft(
              ((row.sum / row.count) * unitScale).toFixed(4),
              12,
            )}${padLeft((row.min * unitScale).toFixed(4), 12)}${padLeft(
              (row.max * unitScale).toFixed(4),
              12,
            )}`,
          );
        });
    }
    lines.push('');
    if (result.chiSquare) {
      lines.push(
        result.chiSquare.pass95
          ? 'Adjustment Passed Chi Square Test at 5% Level'
          : 'Adjustment Failed Chi Square Test at 5% Level',
      );
      lines.push(
        `Variance Factor Bounds (${result.chiSquare.varianceFactorLower.toFixed(3)}/${result.chiSquare.varianceFactorUpper.toFixed(3)})`,
      );
      lines.push(
        `Error Factor Bounds (${Math.sqrt(result.chiSquare.varianceFactorLower).toFixed(3)}/${Math.sqrt(result.chiSquare.varianceFactorUpper).toFixed(3)})`,
      );
    }
    const formatUsageSummary = (summary?: ReductionUsageSummary): string => {
      if (!summary) return 'unavailable';
      return [
        `bearing[g=${summary.bearing.grid},m=${summary.bearing.measured}]`,
        `angle[g=${summary.angle.grid},m=${summary.angle.measured}]`,
        `direction[g=${summary.direction.grid},m=${summary.direction.measured}]`,
        `distance[ground=${summary.distance.ground},grid=${summary.distance.grid},ellip=${summary.distance.ellipsoidal}]`,
        `total=${summary.total}`,
      ].join('; ');
    };
    if (runDiagnostics) {
      lines.push(
        `Run Profile: ${runDiagnostics.solveProfile.toUpperCase()} (dirSets=${runDiagnostics.directionSetMode}, profileFallback=${runDiagnostics.profileDefaultInstrumentFallback ? 'ON' : 'OFF'})`,
      );
      lines.push(`Run Mode: ${runMode.toUpperCase()}`);
      lines.push(
        `Plan Rotation: ${((runDiagnostics.rotationAngleRad * 180) / Math.PI).toFixed(6)} deg`,
      );
      lines.push(
        `Coordinate System: ${(runDiagnostics.coordSystemMode ?? 'local').toUpperCase()} (CRS=${runDiagnostics.crsId ?? '-'})`,
      );
      if ((runDiagnostics.coordSystemMode ?? 'local') === 'local') {
        lines.push(
          `Local Datum Scheme: ${String(runDiagnostics.localDatumScheme ?? 'average-scale').toUpperCase()} (scale=${(runDiagnostics.averageScaleFactor ?? 1).toFixed(8)}, commonElev=${((runDiagnostics.commonElevation ?? 0) * unitScale).toFixed(4)}${linearUnit})`,
        );
      } else {
        lines.push(
          `Directive Context (End of File): bearing=${String(runDiagnostics.gridBearingMode ?? 'grid').toUpperCase()}, distance=${String(runDiagnostics.gridDistanceMode ?? 'measured').toUpperCase()}, angle=${String(runDiagnostics.gridAngleMode ?? 'measured').toUpperCase()}, direction=${String(runDiagnostics.gridDirectionMode ?? 'measured').toUpperCase()}`,
        );
        lines.push(
          `.SCALE Override: ${
            (runDiagnostics.scaleOverrideActive ?? result.parseState?.scaleOverrideActive ?? false)
              ? `ON (k=${(runDiagnostics.averageScaleFactor ?? 1).toFixed(8)})`
              : 'OFF'
          }`,
        );
        lines.push(
          `GNSS Frame Default: ${
            runDiagnostics.gnssVectorFrameDefault ??
            result.parseState?.gnssVectorFrameDefault ??
            'gridNEU'
          } (confirmed=${
            (runDiagnostics.gnssFrameConfirmed ?? result.parseState?.gnssFrameConfirmed)
              ? 'YES'
              : 'NO'
          })`,
        );
        lines.push(
          `Applied Reduction Modes (Parsed): ${formatUsageSummary(
            runDiagnostics.parsedUsageSummary,
          )}`,
        );
        lines.push(
          `Applied Reduction Modes (Used In Solve): ${formatUsageSummary(
            runDiagnostics.usedInSolveUsageSummary,
          )}`,
        );
        const hasDirectiveContextDelta =
          JSON.stringify(runDiagnostics.parsedUsageSummary) !==
          JSON.stringify(runDiagnostics.usedInSolveUsageSummary);
        if (hasDirectiveContextDelta) {
          lines.push(
            'Note: parsed reduction usage differs from used-in-solve usage due to filtering/exclusions.',
          );
        }
        (runDiagnostics.directiveNoEffectWarnings ?? []).forEach((warning) => {
          lines.push(
            `Directive no-effect warning: ${warning.directive} at line ${warning.line} (${warning.reason})`,
          );
        });
        (runDiagnostics.directiveTransitions ?? []).forEach((transition) => {
          lines.push(
            `Directive range: ${transition.directive} line ${transition.effectiveFromLine}${transition.effectiveToLine != null ? `-${transition.effectiveToLine}` : '-EOF'} (obs=${transition.obsCountInRange})`,
          );
        });
      }
      const datumSufficiency =
        runDiagnostics.datumSufficiencyReport ?? result.parseState?.datumSufficiencyReport;
      if (datumSufficiency) {
        lines.push(
          `Datum Sufficiency: ${datumSufficiency.status.toUpperCase()} (${datumSufficiency.reasons.length} reason${datumSufficiency.reasons.length === 1 ? '' : 's'})`,
        );
        datumSufficiency.reasons.forEach((reason) => lines.push(`  Reason: ${reason}`));
        datumSufficiency.suggestions.forEach((suggestion) =>
          lines.push(`  Suggestion: ${suggestion}`),
        );
      }
      lines.push(
        `Average Geoid Height Fallback: ${((runDiagnostics.averageGeoidHeight ?? 0) * unitScale).toFixed(4)}${linearUnit}`,
      );
      lines.push(
        `CRS / Projection: ${
          (runDiagnostics.crsStatus ?? (runDiagnostics.crsTransformEnabled ? 'on' : 'off')) === 'on'
            ? `ON (${runDiagnostics.crsProjectionModel ?? 'legacy-equirectangular'}, label="${runDiagnostics.crsLabel || 'unnamed'}")`
            : `OFF${runDiagnostics.crsOffReason ? ` (${runDiagnostics.crsOffReason})` : ''}`
        }`,
      );
      lines.push(
        `CRS Grid-Ground Scale: ${runDiagnostics.crsGridScaleEnabled ? `ON (${(runDiagnostics.crsGridScaleFactor ?? 1).toFixed(8)})` : 'OFF'}`,
      );
      lines.push(
        `CRS Convergence: ${runDiagnostics.crsConvergenceEnabled ? `ON (${(((runDiagnostics.crsConvergenceAngleRad ?? 0) * 180) / Math.PI).toFixed(6)} deg)` : 'OFF'}`,
      );
      if ((runDiagnostics.coordSystemMode ?? 'local') === 'grid') {
        lines.push(
          `CRS Datum Operation: ${runDiagnostics.crsDatumOpId ?? '-'}${runDiagnostics.crsDatumFallbackUsed ? ' (fallback)' : ''}`,
        );
        lines.push(
          `CRS Area-of-Use: ${String(runDiagnostics.crsAreaOfUseStatus ?? 'unknown').toUpperCase()}${runDiagnostics.crsAreaOfUseStatus === 'outside' ? ` (outside=${runDiagnostics.crsOutOfAreaStationCount ?? 0})` : ''}`,
        );
      }
      if ((runDiagnostics.coordSystemDiagnostics?.length ?? 0) > 0) {
        lines.push(`CRS Diagnostics: ${runDiagnostics.coordSystemDiagnostics?.join(', ')}`);
      }
      if ((runDiagnostics.coordSystemWarningMessages?.length ?? 0) > 0) {
        lines.push(`CRS Warning Count: ${runDiagnostics.coordSystemWarningMessages?.length ?? 0}`);
      }
      lines.push(
        `Geoid/Grid Model: ${runDiagnostics.geoidModelEnabled ? `ON (${runDiagnostics.geoidModelId ?? 'NGS-DEMO'}, ${String(runDiagnostics.geoidInterpolation ?? 'bilinear').toUpperCase()}, loaded=${runDiagnostics.geoidModelLoaded ? 'YES' : 'NO'})` : 'OFF'}`,
      );
      if (runDiagnostics.geoidModelEnabled) {
        lines.push(
          `Geoid Metadata: ${runDiagnostics.geoidModelMetadata || 'unavailable'}${runDiagnostics.geoidSampleUndulationM != null ? `; sampleN=${runDiagnostics.geoidSampleUndulationM.toFixed(4)}m` : ''}`,
        );
      }
      lines.push(
        `Geoid Height Conversion: ${runDiagnostics.geoidHeightConversionEnabled ? `ON (${String(runDiagnostics.geoidOutputHeightDatum ?? 'orthometric').toUpperCase()}, converted=${runDiagnostics.geoidConvertedStationCount ?? 0}, skipped=${runDiagnostics.geoidSkippedStationCount ?? 0})` : 'OFF'}`,
      );
      lines.push(
        `GPS AddHiHt Defaults: ${runDiagnostics.gpsAddHiHtEnabled ? `ON (HI=${((runDiagnostics.gpsAddHiHtHiM ?? 0) * unitScale).toFixed(4)}${linearUnit}, HT=${((runDiagnostics.gpsAddHiHtHtM ?? 0) * unitScale).toFixed(4)}${linearUnit})` : 'OFF'}`,
      );
      if (runDiagnostics.gpsAddHiHtEnabled) {
        lines.push(
          `GPS AddHiHt Preprocess: vectors=${runDiagnostics.gpsAddHiHtVectorCount ?? 0}, adjusted=${runDiagnostics.gpsAddHiHtAppliedCount ?? 0} (+${runDiagnostics.gpsAddHiHtPositiveCount ?? 0}/-${runDiagnostics.gpsAddHiHtNegativeCount ?? 0}/neutral=${runDiagnostics.gpsAddHiHtNeutralCount ?? 0}), defaultZero=${runDiagnostics.gpsAddHiHtDefaultZeroCount ?? 0}, missingHeight=${runDiagnostics.gpsAddHiHtMissingHeightCount ?? 0}, scale=[${(runDiagnostics.gpsAddHiHtScaleMin ?? 1).toFixed(8)}, ${(runDiagnostics.gpsAddHiHtScaleMax ?? 1).toFixed(8)}]`,
        );
      }
    }
    const gpsLoopDiagnostics = result.gpsLoopDiagnostics;
    if (gpsLoopDiagnostics?.enabled) {
      lines.push(
        `GPS Loop Check: vectors=${gpsLoopDiagnostics.vectorCount}, loops=${gpsLoopDiagnostics.loopCount}, pass=${gpsLoopDiagnostics.passCount}, warn=${gpsLoopDiagnostics.warnCount}, tolerance=${(gpsLoopDiagnostics.thresholds.baseToleranceM * unitScale).toFixed(4)}${linearUnit}+${gpsLoopDiagnostics.thresholds.ppmTolerance}ppm*dist`,
      );
      gpsLoopDiagnostics.loops.slice(0, 15).forEach((loop) => {
        lines.push(
          `  #${loop.rank} ${loop.key} ${loop.pass ? 'PASS' : 'WARN'} |d|=${(loop.closureMag * unitScale).toFixed(4)}${linearUnit} tol=${(loop.toleranceM * unitScale).toFixed(4)}${linearUnit} ppm=${loop.linearPpm != null ? loop.linearPpm.toFixed(1) : '-'} ratio=${loop.closureRatio != null ? `1:${loop.closureRatio.toFixed(0)}` : '-'} path=${loop.stationPath.join('->')}`,
        );
      });
      if (gpsLoopDiagnostics.loops.length > 15) {
        lines.push(`  ... ${gpsLoopDiagnostics.loops.length - 15} more GPS loop diagnostics`);
      }
    }
    const levelingLoopDiagnostics = result.levelingLoopDiagnostics;
    if (levelingLoopDiagnostics?.enabled) {
      lines.push(
        `Leveling Loop Check: obs=${levelingLoopDiagnostics.observationCount}, loops=${levelingLoopDiagnostics.loopCount}, pass=${levelingLoopDiagnostics.passCount}, warn=${levelingLoopDiagnostics.warnCount}, totalLength=${levelingLoopDiagnostics.totalLengthKm.toFixed(3)}km, warnLength=${levelingLoopDiagnostics.warnTotalLengthKm.toFixed(3)}km, tolerance=${levelingLoopDiagnostics.thresholds.baseMm.toFixed(2)}mm+${levelingLoopDiagnostics.thresholds.perSqrtKmMm.toFixed(2)}mm*sqrt(km)`,
      );
      levelingLoopDiagnostics.loops.slice(0, 15).forEach((loop) => {
        lines.push(
          `  #${loop.rank} ${loop.key} ${loop.pass ? 'PASS' : 'WARN'} |dH|=${(loop.absClosure * unitScale).toFixed(4)}${linearUnit} len=${loop.loopLengthKm.toFixed(3)}km tol=${loop.toleranceMm.toFixed(2)}mm mm/sqrt(km)=${loop.closurePerSqrtKmMm.toFixed(2)} path=${loop.stationPath.join('->')}`,
        );
      });
      levelingLoopDiagnostics.suspectSegments.slice(0, 3).forEach((segment) => {
        lines.push(
          `  suspect #${segment.rank} ${segment.from}->${segment.to} line=${segment.sourceLine ?? '-'} loops=${segment.warnLoopCount} score=${segment.suspectScore.toFixed(2)} worst=${segment.worstLoopKey ?? '-'}`,
        );
      });
      if (levelingLoopDiagnostics.loops.length > 15) {
        lines.push(
          `  ... ${levelingLoopDiagnostics.loops.length - 15} more leveling loop diagnostics`,
        );
      }
    }
    const lostStations = result.parseState?.lostStationIds ?? [];
    lines.push(
      `Lost Stations: ${lostStations.length > 0 ? `${lostStations.length} (${lostStations.join(', ')})` : 'none'}`,
    );
    const descriptionReconcileMode = result.parseState?.descriptionReconcileMode ?? 'first';
    const descriptionAppendDelimiter = result.parseState?.descriptionAppendDelimiter ?? ' | ';
    const descriptionRepeated = result.parseState?.descriptionRepeatedStationCount ?? 0;
    const descriptionConflicts = result.parseState?.descriptionConflictCount ?? 0;
    lines.push(
      `Description Reconcile: ${descriptionReconcileMode.toUpperCase()}${descriptionReconcileMode === 'append' ? ` (delimiter="${descriptionAppendDelimiter}")` : ''}; repeated=${descriptionRepeated}; conflicts=${descriptionConflicts}`,
    );
    const autoSideshotEnabled = result.parseState?.autoSideshotEnabled ?? true;
    lines.push(`Auto-Sideshot: ${autoSideshotEnabled ? 'ON' : 'OFF'}`);
    if (result.autoAdjustDiagnostics?.enabled) {
      const ad = result.autoAdjustDiagnostics;
      lines.push(
        `Auto-Adjust: ON (|t|>=${ad.threshold.toFixed(2)}, maxCycles=${ad.maxCycles}, maxRemovalsPerCycle=${ad.maxRemovalsPerCycle}, minRedund=${ad.minRedundancy.toFixed(2)}, stop=${ad.stopReason}, removed=${ad.removed.length})`,
      );
      ad.cycles.forEach((cycle) => {
        lines.push(
          `  Cycle ${cycle.cycle}: seuw=${cycle.seuw.toFixed(4)}, max|t|=${cycle.maxAbsStdRes.toFixed(2)}, removals=${cycle.removals.length}`,
        );
      });
      ad.removed.slice(0, 30).forEach((row) => {
        lines.push(
          `  Removed obs#${row.obsId} ${row.type.toUpperCase()} ${row.stations} line=${row.sourceLine ?? '-'} |t|=${row.stdRes.toFixed(2)} reason=${row.reason}${row.redundancy != null ? ` redund=${row.redundancy.toFixed(3)}` : ''}`,
        );
      });
      if (ad.removed.length > 30) {
        lines.push(`  ... ${ad.removed.length - 30} more removed observations`);
      }
    }
    if (result.autoSideshotDiagnostics?.enabled) {
      const sd = result.autoSideshotDiagnostics;
      lines.push(
        `Auto Sideshot (M-lines): evaluated=${sd.evaluatedCount}, candidates=${sd.candidateCount}, excludedControl=${sd.excludedControlCount}, threshold=${sd.threshold.toFixed(2)}`,
      );
      sd.candidates.slice(0, 20).forEach((row) => {
        lines.push(
          `  line=${row.sourceLine ?? '-'} ${row.occupy}->${row.target} (bs=${row.backsight}) minRed=${row.minRedundancy.toFixed(3)} max|t|=${row.maxAbsStdRes.toFixed(2)}`,
        );
      });
      if (sd.candidates.length > 20) {
        lines.push(`  ... ${sd.candidates.length - 20} more auto-sideshot candidates`);
      }
    }
    const tsSideshots = (result.sideshots ?? []).filter((s) => s.mode !== 'gps');
    const gpsSideshots = (result.sideshots ?? []).filter((s) => s.mode === 'gps');
    const gpsVectorSideshots = gpsSideshots.filter((s) => s.sourceType !== 'GS');
    const gpsCoordinateSideshots = gpsSideshots.filter((s) => s.sourceType === 'GS');
    if (tsSideshots.length > 0 || gpsSideshots.length > 0) {
      lines.push(
        `Post-Adjust Sideshots: TS=${tsSideshots.length}, GPS vectors=${gpsVectorSideshots.length}, GS coordinates=${gpsCoordinateSideshots.length}`,
      );
      gpsVectorSideshots.slice(0, 15).forEach((row) => {
        lines.push(
          `  GPS sideshot line=${row.sourceLine ?? '-'} ${row.from}->${row.to} HD=${(
            row.horizDistance * unitScale
          ).toFixed(
            4,
          )}${linearUnit} az=${row.azimuth != null ? `${((row.azimuth * 180) / Math.PI).toFixed(6)}deg` : '-'}${row.note ? ` note=${row.note}` : ''}`,
        );
      });
      if (gpsVectorSideshots.length > 15) {
        lines.push(`  ... ${gpsVectorSideshots.length - 15} more GPS sideshot vectors`);
      }
      gpsCoordinateSideshots.slice(0, 15).forEach((row) => {
        lines.push(
          `  GS line=${row.sourceLine ?? '-'} ${row.to} N=${((row.northing ?? 0) * unitScale).toFixed(4)}${linearUnit} E=${((row.easting ?? 0) * unitScale).toFixed(4)}${linearUnit} relation=${row.relationFrom ? `FROM=${row.relationFrom}` : 'standalone'}${row.note ? ` note=${row.note}` : ''}`,
        );
      });
      if (gpsCoordinateSideshots.length > 15) {
        lines.push(`  ... ${gpsCoordinateSideshots.length - 15} more GS coordinate rows`);
      }
    }
    const aliasTrace = result.parseState?.aliasTrace ?? [];
    if (
      (result.parseState?.aliasExplicitCount ?? 0) > 0 ||
      (result.parseState?.aliasRuleCount ?? 0) > 0
    ) {
      lines.push(
        `Alias Canonicalization: explicit=${result.parseState?.aliasExplicitCount ?? 0}, rules=${result.parseState?.aliasRuleCount ?? 0}, remaps=${aliasTrace.length}`,
      );
      const sample = aliasTrace.slice(0, 15);
      sample.forEach((entry) => {
        lines.push(
          `  ${entry.context} line=${entry.sourceLine ?? '-'} ${entry.detail ?? '-'}: ${entry.sourceId} -> ${entry.canonicalId}`,
        );
      });
      if (aliasTrace.length > sample.length) {
        lines.push(`  ... ${aliasTrace.length - sample.length} more alias references`);
      }
    }
    if (result.clusterDiagnostics?.enabled) {
      lines.push(
        `Cluster Detection: pass=${result.clusterDiagnostics.passMode.toUpperCase()}, mode=${result.clusterDiagnostics.linkageMode.toUpperCase()}, dim=${result.clusterDiagnostics.dimension}, tol=${result.clusterDiagnostics.tolerance.toFixed(4)}m, pairHits=${result.clusterDiagnostics.pairCount}, candidates=${result.clusterDiagnostics.candidateCount}, approvedMerges=${result.clusterDiagnostics.approvedMergeCount ?? 0}`,
      );
      result.clusterDiagnostics.candidates.slice(0, 10).forEach((c) => {
        lines.push(
          `  ${c.key}: rep=${c.representativeId}, members=${c.stationIds.join(',')}, maxSep=${c.maxSeparation.toFixed(4)}m`,
        );
      });
      if (result.clusterDiagnostics.candidates.length > 10) {
        lines.push(
          `  ... ${result.clusterDiagnostics.candidates.length - 10} more cluster candidates`,
        );
      }
      const outcomes = result.clusterDiagnostics.mergeOutcomes ?? [];
      if (outcomes.length > 0) {
        lines.push(`Cluster Merge Outcomes: ${outcomes.length}`);
        outcomes.slice(0, 15).forEach((row) => {
          lines.push(
            `  ${row.aliasId}->${row.canonicalId}: dE=${row.deltaE != null ? row.deltaE.toFixed(4) : '-'}m dN=${row.deltaN != null ? row.deltaN.toFixed(4) : '-'}m dH=${row.deltaH != null ? `${row.deltaH.toFixed(4)}m` : '-'} d2D=${row.horizontalDelta != null ? `${row.horizontalDelta.toFixed(4)}m` : '-'} d3D=${row.spatialDelta != null ? `${row.spatialDelta.toFixed(4)}m` : '-'}${row.missing ? ' (missing pass1 data)' : ''}`,
          );
        });
        if (outcomes.length > 15) {
          lines.push(`  ... ${outcomes.length - 15} more merge outcomes`);
        }
      }
      const rejected = result.clusterDiagnostics.rejectedProposals ?? [];
      if (rejected.length > 0) {
        lines.push(`Rejected Cluster Proposals: ${rejected.length}`);
        rejected.slice(0, 15).forEach((row) => {
          lines.push(
            `  ${row.key}: rep=${row.representativeId}, members=${row.stationIds.join(',')}, retained=${row.retainedId ?? '-'}, reason=${row.reason}`,
          );
        });
        if (rejected.length > 15) {
          lines.push(`  ... ${rejected.length - 15} more rejected proposals`);
        }
      }
    }
    lines.push('');
    lines.push('Performing Error Propagation ...');
    lines.push('Writing Output Files ...');
    lines.push('');
    lines.push('Network Processing Completed');
    lines.push(`Elapsed Time = ${elapsedStr(runElapsedMs)}`);
    lines.push('');
    lines.push('Processing Notes:');
    result.logs.slice(0, 30).forEach((line) => lines.push(`  ${line}`));
    return lines.join('\n');
  }, [result, units, runElapsedMs, runDiagnostics]);

  return (
    <div className="h-full p-4 bg-slate-950 text-slate-100">
      <div className="h-full border border-slate-700 bg-slate-900 overflow-auto rounded">
        <pre className="text-xs leading-5 font-mono p-3 whitespace-pre-wrap">{text}</pre>
      </div>
    </div>
  );
};

export default ProcessingSummaryView;
