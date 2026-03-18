import React from 'react';
import { RAD_TO_DEG } from '../../engine/angles';
import type {
  CoordSystemDiagnosticCode,
  CrsOffReason,
  CrsStatus,
  DatumSufficiencyReport,
  DirectiveNoEffectWarning,
  DirectiveTransition,
  GnssVectorFrame,
  ReductionUsageSummary,
  RunMode,
} from '../../types';
import type { CollapsibleDetailSectionId } from './reportSectionRegistry';
import CollapsibleSectionHeader from './CollapsibleSectionHeader';

interface SolveProfileDiagnosticsSectionProps {
  runDiagnostics: {
    solveProfile:
      | 'webnet'
      | 'industry-parity-current'
      | 'industry-parity-legacy'
      | 'legacy-compat'
      | 'industry-parity';
    parity: boolean;
    directionSetMode: 'reduced' | 'raw';
    mapMode: 'off' | 'on' | 'anglecalc';
    mapScaleFactor: number;
    normalize: boolean;
    faceNormalizationMode: 'on' | 'off' | 'auto';
    angleMode: 'auto' | 'angle' | 'dir';
    verticalReduction: 'none' | 'curvref';
    applyCurvatureRefraction: boolean;
    refractionCoefficient: number;
    tsCorrelationEnabled: boolean;
    tsCorrelationScope: 'setup' | 'set';
    tsCorrelationRho: number;
    robustMode: 'none' | 'huber';
    robustK: number;
    rotationAngleRad: number;
    crsTransformEnabled: boolean;
    crsProjectionModel: 'legacy-equirectangular' | 'local-enu';
    crsLabel: string;
    crsGridScaleEnabled: boolean;
    crsGridScaleFactor: number;
    crsConvergenceEnabled: boolean;
    crsConvergenceAngleRad: number;
    geoidModelEnabled: boolean;
    geoidModelId: string;
    geoidInterpolation: 'bilinear' | 'nearest';
    geoidHeightConversionEnabled: boolean;
    geoidOutputHeightDatum: 'orthometric' | 'ellipsoid';
    geoidModelLoaded: boolean;
    geoidModelMetadata: string;
    geoidSampleUndulationM?: number;
    geoidConvertedStationCount: number;
    geoidSkippedStationCount: number;
    qFixLinearSigmaM: number;
    qFixAngularSigmaSec: number;
    profileDefaultInstrumentFallback: boolean;
    coordSystemMode?: 'local' | 'grid';
    crsId?: string;
    localDatumScheme?: 'average-scale' | 'common-elevation';
    averageScaleFactor?: number;
    scaleOverrideActive?: boolean;
    commonElevation?: number;
    gnssVectorFrameDefault?: GnssVectorFrame;
    gnssFrameConfirmed?: boolean;
    gridBearingMode?: 'measured' | 'grid';
    gridDistanceMode?: 'measured' | 'grid' | 'ellipsoidal';
    gridAngleMode?: 'measured' | 'grid';
    gridDirectionMode?: 'measured' | 'grid';
    parsedUsageSummary?: ReductionUsageSummary;
    usedInSolveUsageSummary?: ReductionUsageSummary;
    directiveTransitions?: DirectiveTransition[];
    directiveNoEffectWarnings?: DirectiveNoEffectWarning[];
    datumSufficiencyReport?: DatumSufficiencyReport;
    coordSystemDiagnostics?: CoordSystemDiagnosticCode[];
    coordSystemWarningMessages?: string[];
    crsStatus?: CrsStatus;
    crsOffReason?: CrsOffReason;
    defaultSigmaCount: number;
    defaultSigmaByType: string;
    stochasticDefaultsSummary: string;
  };
  runMode: RunMode;
  units: 'm' | 'ft';
  unitScale: number;
  lostStationIds: string[];
  descriptionReconcileMode: 'first' | 'append';
  descriptionAppendDelimiter: string;
  reportStaticTooltips: Record<string, string>;
  sectionId: CollapsibleDetailSectionId;
  collapsed: boolean;
  pinned: boolean;
  onToggleCollapse: (_sectionId: CollapsibleDetailSectionId) => void;
  onTogglePin: (_sectionId: CollapsibleDetailSectionId, _label: string) => void;
  onHeaderRef?: (_sectionId: CollapsibleDetailSectionId, _node: HTMLDivElement | null) => void;
  formatReductionUsage: (_summary?: ReductionUsageSummary) => string;
}

const SolveProfileDiagnosticsSection: React.FC<SolveProfileDiagnosticsSectionProps> = ({
  runDiagnostics,
  runMode,
  units,
  unitScale,
  lostStationIds,
  descriptionReconcileMode,
  descriptionAppendDelimiter,
  reportStaticTooltips,
  sectionId,
  collapsed,
  pinned,
  onToggleCollapse,
  onTogglePin,
  onHeaderRef,
  formatReductionUsage,
}) => {
  const runCoordSystemMode = runDiagnostics.coordSystemMode ?? 'local';
  const showSolveProfileMapScale =
    runDiagnostics.mapMode !== 'off' || Math.abs(runDiagnostics.mapScaleFactor - 1) > 1e-9;
  const showSolveProfileVertical =
    runDiagnostics.verticalReduction !== 'none' || runDiagnostics.applyCurvatureRefraction;
  const showSolveProfileRotation = Math.abs(runDiagnostics.rotationAngleRad) > 1e-12;
  const showSolveProfileDirectiveContext =
    runCoordSystemMode === 'grid' ||
    (runDiagnostics.localDatumScheme ?? 'average-scale') !== 'average-scale' ||
    Math.abs((runDiagnostics.averageScaleFactor ?? 1) - 1) > 1e-9 ||
    Math.abs(runDiagnostics.commonElevation ?? 0) > 1e-9;

  return (
    <div className="mb-6 border border-slate-800 rounded overflow-hidden" style={{ order: -200 }}>
      <CollapsibleSectionHeader
        sectionId={sectionId}
        label="Solve Profile Diagnostics"
        className="px-3 py-2 text-xs uppercase tracking-wider border-b border-slate-800 bg-slate-900/40"
        labelClassName="text-slate-400"
        title={reportStaticTooltips['Solve Profile Diagnostics']}
        collapsed={collapsed}
        pinned={pinned}
        onToggleCollapse={onToggleCollapse}
        onTogglePin={onTogglePin}
        onHeaderRef={onHeaderRef}
      />
      {!collapsed && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 text-xs text-slate-300">
          <div>
            <div className="text-slate-500" title={reportStaticTooltips.Profile}>
              Profile
            </div>
            <div className={runDiagnostics.parity ? 'text-blue-300' : ''}>
              {runDiagnostics.solveProfile.toUpperCase()}
            </div>
          </div>
          <div>
            <div className="text-slate-500">Run Mode</div>
            <div>{runMode.toUpperCase()}</div>
          </div>
          <div>
            <div className="text-slate-500" title={reportStaticTooltips['Direction Sets']}>
              Direction Sets
            </div>
            <div>{runDiagnostics.directionSetMode.toUpperCase()}</div>
          </div>
          {runDiagnostics.profileDefaultInstrumentFallback ? (
            <div>
              <div className="text-slate-500" title={reportStaticTooltips['Profile Fallback']}>
                Profile Fallback
              </div>
              <div>ON</div>
            </div>
          ) : null}
          {runDiagnostics.tsCorrelationEnabled ? (
            <div>
              <div className="text-slate-500" title={reportStaticTooltips['TS Correlation']}>
                TS Correlation
              </div>
              <div>
                {`ON (${runDiagnostics.tsCorrelationScope}, rho=${runDiagnostics.tsCorrelationRho.toFixed(3)})`}
              </div>
            </div>
          ) : null}
          {runDiagnostics.robustMode !== 'none' ? (
            <div>
              <div className="text-slate-500" title={reportStaticTooltips.Robust}>
                Robust
              </div>
              <div>
                {runDiagnostics.robustMode.toUpperCase()} (k={runDiagnostics.robustK.toFixed(2)})
              </div>
            </div>
          ) : null}
          {showSolveProfileMapScale ? (
            <div>
              <div className="text-slate-500" title={reportStaticTooltips['Map / Scale']}>
                Map / Scale
              </div>
              <div>
                {runDiagnostics.mapMode.toUpperCase()} / {runDiagnostics.mapScaleFactor.toFixed(8)}
              </div>
            </div>
          ) : null}
          {showSolveProfileVertical ? (
            <div>
              <div className="text-slate-500" title={reportStaticTooltips['Vertical / CurvRef']}>
                Vertical / CurvRef
              </div>
              <div>
                {runDiagnostics.verticalReduction.toUpperCase()} /{' '}
                {runDiagnostics.applyCurvatureRefraction
                  ? `ON (k=${runDiagnostics.refractionCoefficient.toFixed(3)})`
                  : 'OFF'}
              </div>
            </div>
          ) : null}
          <div>
            <div className="text-slate-500" title={reportStaticTooltips.Normalize}>
              Normalize
            </div>
            <div>
              {runDiagnostics.faceNormalizationMode.toUpperCase()} (
              {runDiagnostics.normalize ? 'ON' : 'OFF'})
            </div>
          </div>
          {runDiagnostics.angleMode !== 'auto' ? (
            <div>
              <div className="text-slate-500" title={reportStaticTooltips['A-Mode']}>
                A-Mode
              </div>
              <div>{runDiagnostics.angleMode.toUpperCase()}</div>
            </div>
          ) : null}
          {showSolveProfileRotation ? (
            <div>
              <div className="text-slate-500" title={reportStaticTooltips['Plan Rotation']}>
                Plan Rotation
              </div>
              <div>{`${(runDiagnostics.rotationAngleRad * RAD_TO_DEG).toFixed(6)}°`}</div>
            </div>
          ) : null}
          <div>
            <div className="text-slate-500" title={reportStaticTooltips['Coordinate System']}>
              Coordinate System
            </div>
            <div>
              {runCoordSystemMode === 'local' ? 'LOCAL' : `GRID (${runDiagnostics.crsId ?? '-'})`}
            </div>
          </div>
          {showSolveProfileDirectiveContext ? (
            <div className="col-span-2">
              <div
                className="text-slate-500"
                title={reportStaticTooltips['Directive Context (End of File)']}
              >
                Directive Context (End of File)
              </div>
              <div className="break-words">
                {(runDiagnostics.coordSystemMode ?? 'local') === 'grid'
                  ? `bearing=${String(runDiagnostics.gridBearingMode ?? 'grid').toUpperCase()}, distance=${String(runDiagnostics.gridDistanceMode ?? 'measured').toUpperCase()}, angle=${String(runDiagnostics.gridAngleMode ?? 'measured').toUpperCase()}, direction=${String(runDiagnostics.gridDirectionMode ?? 'measured').toUpperCase()}, .SCALE=${runDiagnostics.scaleOverrideActive ? `ON(k=${(runDiagnostics.averageScaleFactor ?? 1).toFixed(8)})` : 'OFF'}, GNSS frame=${runDiagnostics.gnssVectorFrameDefault ?? 'gridNEU'} (confirmed=${runDiagnostics.gnssFrameConfirmed ? 'YES' : 'NO'})`
                  : `${String(runDiagnostics.localDatumScheme ?? 'average-scale').toUpperCase()} (scale=${(runDiagnostics.averageScaleFactor ?? 1).toFixed(8)}, commonElev=${((runDiagnostics.commonElevation ?? 0) * unitScale).toFixed(4)}${units})`}
              </div>
            </div>
          ) : null}
          {runCoordSystemMode === 'grid' ? (
            <div className="col-span-2">
              <div className="text-slate-500" title={reportStaticTooltips['Applied Reduction Modes']}>
                Applied Reduction Modes
              </div>
              <div className="break-words">
                Parsed: {formatReductionUsage(runDiagnostics.parsedUsageSummary)}
                <br />
                Used In Solve: {formatReductionUsage(runDiagnostics.usedInSolveUsageSummary)}
              </div>
            </div>
          ) : null}
          {(runDiagnostics.directiveNoEffectWarnings?.length ?? 0) > 0 ? (
            <div className="col-span-2">
              <div className="text-slate-500" title={reportStaticTooltips['Applied Reduction Modes']}>
                No-Effect Directives
              </div>
              <div className="break-words">
                {(runDiagnostics.directiveNoEffectWarnings ?? [])
                  .map((warning) => `${warning.directive} @line ${warning.line} (${warning.reason})`)
                  .join(' | ')}
              </div>
            </div>
          ) : null}
          {(runDiagnostics.directiveTransitions?.length ?? 0) > 0 ? (
            <div className="col-span-2">
              <div className="text-slate-500" title={reportStaticTooltips['Applied Reduction Modes']}>
                Directive Ranges
              </div>
              <div className="break-words">
                {(runDiagnostics.directiveTransitions ?? [])
                  .map(
                    (transition) =>
                      `${transition.directive} line ${transition.effectiveFromLine}${transition.effectiveToLine != null ? `-${transition.effectiveToLine}` : '-EOF'} (obs=${transition.obsCountInRange})`,
                  )
                  .join(' | ')}
              </div>
            </div>
          ) : null}
          {runDiagnostics.datumSufficiencyReport ? (
            <div className="col-span-2">
              <div className="text-slate-500" title={reportStaticTooltips['Datum Sufficiency']}>
                Datum Sufficiency
              </div>
              <div className="break-words">
                {runDiagnostics.datumSufficiencyReport.status.toUpperCase()}
                {runDiagnostics.datumSufficiencyReport.reasons.length > 0
                  ? `: ${runDiagnostics.datumSufficiencyReport.reasons.join(' | ')}`
                  : ''}
              </div>
            </div>
          ) : null}
          {(runDiagnostics.coordSystemDiagnostics?.length ?? 0) > 0 ? (
            <div className="col-span-2">
              <div className="text-slate-500" title={reportStaticTooltips['CRS Diagnostics']}>
                CRS Diagnostics
              </div>
              <div className="break-words">
                {runDiagnostics.coordSystemDiagnostics?.join(', ')}
                {` (warnings=${runDiagnostics.coordSystemWarningMessages?.length ?? 0})`}
              </div>
            </div>
          ) : null}
          {runCoordSystemMode === 'grid' || runDiagnostics.crsTransformEnabled ? (
            <div>
              <div className="text-slate-500" title={reportStaticTooltips['CRS / Projection']}>
                CRS / Projection
              </div>
              <div>
                {(runDiagnostics.crsStatus ?? (runDiagnostics.crsTransformEnabled ? 'on' : 'off')) ===
                'on'
                  ? `ON (${runDiagnostics.crsProjectionModel}, label="${runDiagnostics.crsLabel || 'unnamed'}")`
                  : `OFF${runDiagnostics.crsOffReason ? ` (${runDiagnostics.crsOffReason})` : ''}`}
              </div>
            </div>
          ) : null}
          {runDiagnostics.crsGridScaleEnabled ? (
            <div>
              <div className="text-slate-500" title={reportStaticTooltips['CRS Grid Scale']}>
                CRS Grid Scale
              </div>
              <div>{`ON (${runDiagnostics.crsGridScaleFactor.toFixed(8)})`}</div>
            </div>
          ) : null}
          {runDiagnostics.crsConvergenceEnabled ? (
            <div>
              <div className="text-slate-500" title={reportStaticTooltips['CRS Convergence']}>
                CRS Convergence
              </div>
              <div>{`ON (${(runDiagnostics.crsConvergenceAngleRad * RAD_TO_DEG).toFixed(6)}°)`}</div>
            </div>
          ) : null}
          {runDiagnostics.geoidModelEnabled ? (
            <div>
              <div className="text-slate-500" title={reportStaticTooltips['Geoid/Grid Model']}>
                Geoid/Grid Model
              </div>
              <div>
                {`ON (${runDiagnostics.geoidModelId}, ${runDiagnostics.geoidInterpolation.toUpperCase()}, loaded=${runDiagnostics.geoidModelLoaded ? 'YES' : 'NO'})`}
              </div>
            </div>
          ) : null}
          {runDiagnostics.geoidHeightConversionEnabled ? (
            <div>
              <div className="text-slate-500" title={reportStaticTooltips['Geoid Height Conversion']}>
                Geoid Height Conversion
              </div>
              <div>
                {`ON (${runDiagnostics.geoidOutputHeightDatum.toUpperCase()}, converted=${runDiagnostics.geoidConvertedStationCount}, skipped=${runDiagnostics.geoidSkippedStationCount})`}
              </div>
            </div>
          ) : null}
          <div>
            <div className="text-slate-500" title={reportStaticTooltips['QFIX (Linear/Angular)']}>
              QFIX (Linear/Angular)
            </div>
            <div>
              {(runDiagnostics.qFixLinearSigmaM * unitScale).toExponential(6)} {units} /{' '}
              {runDiagnostics.qFixAngularSigmaSec.toExponential(6)}"
            </div>
          </div>
          {runDiagnostics.geoidModelEnabled ? (
            <div className="col-span-2">
              <div className="text-slate-500" title={reportStaticTooltips['Geoid Metadata']}>
                Geoid Metadata
              </div>
              <div className="break-words">
                {runDiagnostics.geoidModelMetadata || 'unavailable'}
                {runDiagnostics.geoidSampleUndulationM != null
                  ? `; sampleN=${runDiagnostics.geoidSampleUndulationM.toFixed(4)}m`
                  : ''}
              </div>
            </div>
          ) : null}
          {lostStationIds.length > 0 ? (
            <div className="col-span-2">
              <div className="text-slate-500" title={reportStaticTooltips['Lost Stations']}>
                Lost Stations
              </div>
              <div className="break-words">{`${lostStationIds.length} (${lostStationIds.join(', ')})`}</div>
            </div>
          ) : null}
          {descriptionReconcileMode === 'append' ? (
            <div className="col-span-2">
              <div
                className="text-slate-500"
                title={reportStaticTooltips['Description Reconciliation']}
              >
                Description Reconciliation
              </div>
              <div className="break-words">{`APPEND (delimiter="${descriptionAppendDelimiter}")`}</div>
            </div>
          ) : null}
          {runDiagnostics.defaultSigmaCount > 0 ? (
            <div className="col-span-2">
              <div className="text-slate-500" title={reportStaticTooltips['Default Sigmas']}>
                Default Sigmas
              </div>
              <div>
                {runDiagnostics.defaultSigmaCount}
                {runDiagnostics.defaultSigmaByType ? ` (${runDiagnostics.defaultSigmaByType})` : ''}
              </div>
            </div>
          ) : null}
          {runDiagnostics.defaultSigmaCount > 0 ? (
            <div className="col-span-2">
              <div className="text-slate-500" title={reportStaticTooltips['Stochastic Defaults']}>
                Stochastic Defaults
              </div>
              <div className="break-words">{runDiagnostics.stochasticDefaultsSummary}</div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default SolveProfileDiagnosticsSection;
