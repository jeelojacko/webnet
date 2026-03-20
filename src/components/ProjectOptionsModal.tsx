// @ts-nocheck
import React from 'react';
import { EXPORT_FORMAT_OPTIONS } from '../engine/exportFormats';
import type {
  CrsCatalogGroupFilter,
  ListingSortCoordinatesBy,
  ListingSortObservationsBy,
  ParseSettings,
  SolveProfile,
} from '../appStateTypes';
import type {
  AdjustedPointsColumnId,
  AdjustedPointsExportSettings,
  AdjustedPointsPresetId,
  AngleMode,
  CoordMode,
  CoordSystemMode,
  CrsProjectionModel,
  DeltaMode,
  FaceNormalizationMode,
  GeoidHeightDatum,
  GeoidInterpolationMethod,
  GeoidSourceFormat,
  GnssVectorFrame,
  GridDistanceInputMode,
  GridObservationMode,
  LocalDatumScheme,
  MapMode,
  OrderMode,
  ParseCompatibilityMode,
  ProjectExportFormat,
  RobustMode,
  RunMode,
  TsCorrelationScope,
  VerticalReductionMode,
} from '../types';

type ProjectOptionsModalProps = {
  context: any;
};

const ProjectOptionsModal: React.FC<ProjectOptionsModalProps> = ({ context }) => {
  const {
    ADJUSTED_POINTS_ALL_COLUMNS,
    ADJUSTED_POINTS_PRESET_COLUMNS,
    BUILTIN_GEOID_MODEL_OPTIONS,
    CRS_CATALOG_GROUP_OPTIONS,
    DEFAULT_QFIX_ANGULAR_SIGMA_SEC,
    DEFAULT_QFIX_LINEAR_SIGMA_M,
    FT_PER_M,
    Info,
    LEVEL_LOOP_TOLERANCE_PRESETS,
    M_PER_FT,
    PROJECT_OPTION_SECTION_TOOLTIPS,
    PROJECT_OPTION_TABS,
    PROJECT_OPTION_TAB_TOOLTIPS,
    SETTINGS_TOOLTIPS,
    SettingsCard,
    SettingsRow,
    SettingsToggle,
    activeLevelLoopPreset,
    activeLevelLoopPresetId,
    activeOptionsTab,
    addLevelLoopCustomPreset,
    addNewInstrument,
    adjustedPointsDraftStationIds,
    adjustedPointsExportSettingsDraft,
    adjustedPointsTransformDraftValidationMessage,
    adjustedPointsRotationAngleError,
    adjustedPointsRotationAngleInput,
    adjustedPointsTransformSelectedInSetCount,
    adjustedPointsTranslationAzimuthError,
    adjustedPointsTranslationAzimuthInput,
    applyProjectOptions,
    clearDraftGeoidSourceData,
    closeProjectOptions,
    crsCatalogGroupFilter,
    crsCatalogGroupCounts,
    crsSearchQuery,
    displayLinear,
    duplicateSelectedInstrument,
    exportFormat,
    filteredDraftCrsCatalog,
    geoidSourceDataDraft,
    geoidSourceDataLabelDraft,
    geoidSourceFileInputRef,
    getExportFormatExtension,
    getExportFormatLabel,
    getExportFormatTooltip,
    handleAdjustedPointsDragStart,
    handleAdjustedPointsDrop,
    handleAdjustedPointsMoveColumn,
    handleAdjustedPointsPresetChange,
    handleAdjustedPointsToggleColumn,
    handleDraftAdjustedPointsRotationAngleInput,
    handleDraftAdjustedPointsRotationSetting,
    handleDraftAdjustedPointsScaleSetting,
    handleDraftAdjustedPointsSetting,
    handleDraftAdjustedPointsTransformSetting,
    handleDraftAdjustedPointsTranslationAzimuthInput,
    handleDraftAdjustedPointsTranslationSetting,
    handleDraftConvergenceLimitChange,
    handleDraftIterChange,
    handleDraftParseSetting,
    handleDraftSetting,
    handleDraftUnitChange,
    handleGeoidSourceFileChange,
    handleGeoidSourceFilePick,
    handleInstrumentFieldChange,
    handleInstrumentLinearFieldChange,
    handleInstrumentNumericFieldChange,
    handleLevelLoopCustomPresetFieldChange,
    handleLevelLoopPresetChange,
    handleSaveProject,
    instrumentLinearUnit,
    isSettingsModalOpen,
    levelLoopCustomPresetsDraft,
    migrateDraftParseModeToStrict,
    normalizeSolveProfile,
    normalizeUiTheme,
    openAdjustedPointsTransformSelectModal,
    optionInputClass,
    optionLabelClass,
    parityProfileActive,
    parseSettingsDraft,
    projectInstrumentsDraft,
    removeLevelLoopCustomPreset,
    searchedDraftCrsCatalog,
    selectedInstrumentDraft,
    selectedInstrumentMeta,
    setActiveOptionsTab,
    setCrsCatalogGroupFilter,
    setCrsSearchQuery,
    setExportFormat,
    setSelectedInstrumentDraft,
    setShowCrsProjectionParams,
    settingsDraft,
    settingsModalContentRef,
    showCrsProjectionParams,
    runDiagnostics,
    RAD_TO_DEG,
    selectedCrsProj4Params,
    selectedDraftCrs,
    triggerProjectFileSelect,
    visibleDraftCrsCatalog,
  } = context as any;

  if (!isSettingsModalOpen) return null;

  return (
        <div
          className="fixed inset-0 z-50 bg-slate-950/70 flex items-start justify-center p-4 md:p-10"
          onClick={closeProjectOptions}
        >
          <div
            className="w-full max-w-5xl bg-slate-600 border border-slate-400 shadow-2xl text-slate-100"
            onClick={(e) => e.stopPropagation()}
            ref={settingsModalContentRef}
          >
            <div className="flex items-center justify-between border-b border-slate-400 bg-slate-700 px-4 py-2">
              <div
                className="text-sm font-semibold tracking-wide"
                title="Industry-style project options for solver defaults, parser behavior, output controls, GPS settings, and stochastic modeling."
              >
                Project Options
              </div>
              <button
                type="button"
                onClick={closeProjectOptions}
                className="text-xs px-2 py-1 border border-slate-300 bg-slate-500 hover:bg-slate-400"
                title="Close Project Options without applying draft changes."
              >
                X
              </button>
            </div>
            <div className="flex flex-wrap gap-1 border-b border-slate-400 bg-slate-500 px-2 pt-2">
              {PROJECT_OPTION_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveOptionsTab(tab.id)}
                  className={`px-3 py-1 text-xs border border-slate-300 ${
                    activeOptionsTab === tab.id
                      ? 'bg-slate-700 text-white'
                      : 'bg-slate-400 text-slate-900 hover:bg-slate-300'
                  }`}
                  title={PROJECT_OPTION_TAB_TOOLTIPS[tab.id]}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="bg-slate-500 p-4 max-h-[70vh] overflow-auto">
              {activeOptionsTab === 'adjustment' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    <SettingsCard
                      title="Solver Configuration"
                      tooltip={PROJECT_OPTION_SECTION_TOOLTIPS['Adjustment Solution']}
                    >
                      <SettingsRow label="Run Profile" tooltip={SETTINGS_TOOLTIPS.solveProfile}>
                        <select
                          title={SETTINGS_TOOLTIPS.solveProfile}
                          value={parseSettingsDraft.solveProfile}
                          onChange={(e) =>
                            handleDraftParseSetting('solveProfile', e.target.value as SolveProfile)
                          }
                          className={optionInputClass}
                        >
                          <option value="webnet">WebNet</option>
                          <option value="industry-parity-current">Industry Parity (Current)</option>
                          <option value="industry-parity-legacy">Industry Parity (Legacy)</option>
                          <option value="legacy-compat">Legacy Compatibility</option>
                        </select>
                      </SettingsRow>
                      <SettingsRow
                        label="Parse Mode"
                        tooltip={SETTINGS_TOOLTIPS.parseCompatibilityMode}
                      >
                        <select
                          title={SETTINGS_TOOLTIPS.parseCompatibilityMode}
                          value={parseSettingsDraft.parseCompatibilityMode}
                          onChange={(e) =>
                            handleDraftParseSetting(
                              'parseCompatibilityMode',
                              e.target.value as ParseCompatibilityMode,
                            )
                          }
                          className={optionInputClass}
                        >
                          <option value="legacy">Legacy (compatibility)</option>
                          <option value="strict">Strict (deterministic)</option>
                        </select>
                      </SettingsRow>
                      <div className="rounded-md border border-slate-400/70 bg-slate-700/20 px-3 py-2 text-xs text-slate-200 space-y-2">
                        <div>
                          Migration status:{' '}
                          {parseSettingsDraft.parseModeMigrated ? 'Migrated' : 'Legacy project'}
                        </div>
                        {!parseSettingsDraft.parseModeMigrated && (
                          <button
                            type="button"
                            title={SETTINGS_TOOLTIPS.parseModeMigration}
                            onClick={migrateDraftParseModeToStrict}
                            className="rounded border border-emerald-400/80 bg-emerald-700/30 px-2 py-1 text-[11px] uppercase tracking-wide text-emerald-100 hover:bg-emerald-700/45"
                          >
                            Migrate To Strict
                          </button>
                        )}
                        {normalizeSolveProfile(parseSettingsDraft.solveProfile) !== 'webnet' &&
                          parseSettingsDraft.parseCompatibilityMode === 'legacy' && (
                            <div className="text-amber-200">
                              Industry-compatible profile is running in legacy parse mode. Strict
                              mode is recommended for deterministic parser behavior.
                            </div>
                          )}
                      </div>
                      <SettingsRow label="Coordinate Mode" tooltip={SETTINGS_TOOLTIPS.coordMode}>
                        <select
                          title={SETTINGS_TOOLTIPS.coordMode}
                          value={parseSettingsDraft.coordMode}
                          onChange={(e) =>
                            handleDraftParseSetting('coordMode', e.target.value as CoordMode)
                          }
                          className={optionInputClass}
                        >
                          <option value="2D">2D</option>
                          <option value="3D">3D</option>
                        </select>
                      </SettingsRow>
                      <div className="rounded-md border border-slate-400/70 bg-slate-700/20 p-3 space-y-3">
                        <div className="text-[11px] uppercase tracking-wide text-slate-200">
                          Automated Adjustment Actions
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <label
                            className="rounded border border-slate-400/60 bg-slate-700/20 px-2 py-2 flex flex-col gap-2 text-[11px] uppercase tracking-wide text-slate-200"
                            title={SETTINGS_TOOLTIPS.runMode}
                          >
                            <span>Run Mode</span>
                            <select
                              title={SETTINGS_TOOLTIPS.runMode}
                              value={parseSettingsDraft.runMode}
                              onChange={(e) =>
                                handleDraftParseSetting('runMode', e.target.value as RunMode)
                              }
                              className={optionInputClass}
                            >
                              <option value="adjustment">Adjustment</option>
                              <option value="preanalysis">Preanalysis</option>
                              <option value="data-check">Data Check</option>
                              <option value="blunder-detect">Blunder Detect</option>
                            </select>
                          </label>
                          <div
                            className="rounded border border-slate-400/60 bg-slate-700/20 px-2 py-2 flex items-center justify-between gap-2"
                            title={SETTINGS_TOOLTIPS.autoSideshot}
                          >
                            <span className="text-[11px] uppercase tracking-wide text-slate-200">
                              Auto-Sideshot
                            </span>
                            <SettingsToggle
                              title={SETTINGS_TOOLTIPS.autoSideshot}
                              checked={parseSettingsDraft.autoSideshotEnabled}
                              onChange={(checked) =>
                                handleDraftParseSetting('autoSideshotEnabled', checked)
                              }
                            />
                          </div>
                          <div
                            className="rounded border border-slate-400/60 bg-slate-700/20 px-2 py-2 flex items-center justify-between gap-2"
                            title={SETTINGS_TOOLTIPS.clusterDetection}
                          >
                            <span className="text-[11px] uppercase tracking-wide text-slate-200">
                              Cluster Detection
                            </span>
                            <SettingsToggle
                              title={SETTINGS_TOOLTIPS.clusterDetection}
                              checked={parseSettingsDraft.clusterDetectionEnabled}
                              onChange={(checked) =>
                                handleDraftParseSetting('clusterDetectionEnabled', checked)
                              }
                            />
                          </div>
                          <div
                            className="rounded border border-slate-400/60 bg-slate-700/20 px-2 py-2 flex items-center justify-between gap-2"
                            title={SETTINGS_TOOLTIPS.autoAdjust}
                          >
                            <span className="text-[11px] uppercase tracking-wide text-slate-200">
                              Auto-Adjust
                            </span>
                            <SettingsToggle
                              title={SETTINGS_TOOLTIPS.autoAdjust}
                              checked={parseSettingsDraft.autoAdjustEnabled}
                              disabled={parseSettingsDraft.runMode !== 'adjustment'}
                              onChange={(checked) =>
                                handleDraftParseSetting('autoAdjustEnabled', checked)
                              }
                            />
                          </div>
                        </div>
                        {parseSettingsDraft.runMode !== 'adjustment' && (
                          <div className="text-[11px] text-slate-300">
                            Auto-Adjust is disabled unless Run Mode is set to Adjustment.
                          </div>
                        )}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <label className={optionLabelClass}>
                          Auto-Adjust |t| Threshold
                          <input
                            title={SETTINGS_TOOLTIPS.autoAdjustThreshold}
                            type="number"
                            min={1}
                            max={20}
                            step={0.1}
                            value={parseSettingsDraft.autoAdjustStdResThreshold}
                            disabled={
                              parseSettingsDraft.runMode !== 'adjustment' ||
                              !parseSettingsDraft.autoAdjustEnabled
                            }
                            onChange={(e) =>
                              handleDraftParseSetting(
                                'autoAdjustStdResThreshold',
                                Number.isFinite(parseFloat(e.target.value))
                                  ? Math.max(1, Math.min(20, parseFloat(e.target.value)))
                                  : 4,
                              )
                            }
                            className={`${optionInputClass} mt-1 disabled:opacity-50 disabled:cursor-not-allowed`}
                          />
                        </label>
                        <label className={optionLabelClass}>
                          Auto-Adjust Max Cycles
                          <input
                            title={SETTINGS_TOOLTIPS.autoAdjustMaxCycles}
                            type="number"
                            min={1}
                            max={20}
                            step={1}
                            value={parseSettingsDraft.autoAdjustMaxCycles}
                            disabled={
                              parseSettingsDraft.runMode !== 'adjustment' ||
                              !parseSettingsDraft.autoAdjustEnabled
                            }
                            onChange={(e) =>
                              handleDraftParseSetting(
                                'autoAdjustMaxCycles',
                                Number.isFinite(parseInt(e.target.value, 10))
                                  ? Math.max(1, Math.min(20, parseInt(e.target.value, 10)))
                                  : 3,
                              )
                            }
                            className={`${optionInputClass} mt-1 disabled:opacity-50 disabled:cursor-not-allowed`}
                          />
                        </label>
                        <label className={optionLabelClass}>
                          Auto-Adjust Max Removals/Cycle
                          <input
                            title={SETTINGS_TOOLTIPS.autoAdjustMaxRemovalsPerCycle}
                            type="number"
                            min={1}
                            max={10}
                            step={1}
                            value={parseSettingsDraft.autoAdjustMaxRemovalsPerCycle}
                            disabled={
                              parseSettingsDraft.runMode !== 'adjustment' ||
                              !parseSettingsDraft.autoAdjustEnabled
                            }
                            onChange={(e) =>
                              handleDraftParseSetting(
                                'autoAdjustMaxRemovalsPerCycle',
                                Number.isFinite(parseInt(e.target.value, 10))
                                  ? Math.max(1, Math.min(10, parseInt(e.target.value, 10)))
                                  : 1,
                              )
                            }
                            className={`${optionInputClass} mt-1 disabled:opacity-50 disabled:cursor-not-allowed`}
                          />
                        </label>
                      </div>
                    </SettingsCard>

                    <SettingsCard
                      title="Geodetic Framework"
                      tooltip={PROJECT_OPTION_SECTION_TOOLTIPS['Station and Angle Order']}
                    >
                      <SettingsRow label="Coordinate Order" tooltip={SETTINGS_TOOLTIPS.order}>
                        <select
                          title={SETTINGS_TOOLTIPS.order}
                          value={parseSettingsDraft.order}
                          onChange={(e) =>
                            handleDraftParseSetting('order', e.target.value as OrderMode)
                          }
                          className={optionInputClass}
                        >
                          <option value="NE">North-East</option>
                          <option value="EN">East-North</option>
                        </select>
                      </SettingsRow>
                      <SettingsRow
                        label="Distance / Vertical Data Type"
                        tooltip={SETTINGS_TOOLTIPS.deltaMode}
                      >
                        <select
                          title={SETTINGS_TOOLTIPS.deltaMode}
                          value={parseSettingsDraft.deltaMode}
                          onChange={(e) =>
                            handleDraftParseSetting('deltaMode', e.target.value as DeltaMode)
                          }
                          className={optionInputClass}
                        >
                          <option value="slope">Slope Dist / Zenith</option>
                          <option value="horiz">Horiz Dist / Elev Diff</option>
                        </select>
                      </SettingsRow>
                      <SettingsRow
                        label="Angle Data Station Order"
                        tooltip={SETTINGS_TOOLTIPS.angleStationOrder}
                      >
                        <select
                          title={SETTINGS_TOOLTIPS.angleStationOrder}
                          value={parseSettingsDraft.angleStationOrder}
                          onChange={(e) =>
                            handleDraftParseSetting(
                              'angleStationOrder',
                              e.target.value as 'atfromto' | 'fromatto',
                            )
                          }
                          className={optionInputClass}
                        >
                          <option value="atfromto">At-From-To</option>
                          <option value="fromatto">From-At-To</option>
                        </select>
                      </SettingsRow>
                      <SettingsRow
                        label="Longitude Sign Convention"
                        tooltip={SETTINGS_TOOLTIPS.lonSign}
                      >
                        <select
                          title={SETTINGS_TOOLTIPS.lonSign}
                          value={parseSettingsDraft.lonSign}
                          onChange={(e) =>
                            handleDraftParseSetting(
                              'lonSign',
                              e.target.value as ParseSettings['lonSign'],
                            )
                          }
                          className={optionInputClass}
                        >
                          <option value="west-negative">Negative West / Positive East</option>
                          <option value="west-positive">Positive West / Negative East</option>
                        </select>
                      </SettingsRow>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label className={optionLabelClass}>
                          QFIX Linear Sigma ({settingsDraft.units === 'ft' ? 'ft' : 'm'})
                          <input
                            title={SETTINGS_TOOLTIPS.qFixLinearSigma}
                            type="number"
                            min={0}
                            step="any"
                            value={
                              settingsDraft.units === 'ft'
                                ? parseSettingsDraft.qFixLinearSigmaM * FT_PER_M
                                : parseSettingsDraft.qFixLinearSigmaM
                            }
                            onChange={(e) =>
                              handleDraftParseSetting(
                                'qFixLinearSigmaM',
                                Number.isFinite(parseFloat(e.target.value)) &&
                                  parseFloat(e.target.value) > 0
                                  ? settingsDraft.units === 'ft'
                                    ? parseFloat(e.target.value) * M_PER_FT
                                    : parseFloat(e.target.value)
                                  : DEFAULT_QFIX_LINEAR_SIGMA_M,
                              )
                            }
                            className={`${optionInputClass} mt-1`}
                          />
                        </label>
                        <label className={optionLabelClass}>
                          QFIX Angular Sigma (")
                          <input
                            title={SETTINGS_TOOLTIPS.qFixAngularSigma}
                            type="number"
                            min={0}
                            step="any"
                            value={parseSettingsDraft.qFixAngularSigmaSec}
                            onChange={(e) =>
                              handleDraftParseSetting(
                                'qFixAngularSigmaSec',
                                Number.isFinite(parseFloat(e.target.value)) &&
                                  parseFloat(e.target.value) > 0
                                  ? parseFloat(e.target.value)
                                  : DEFAULT_QFIX_ANGULAR_SIGMA_SEC,
                              )
                            }
                            className={`${optionInputClass} mt-1`}
                          />
                        </label>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label className={optionLabelClass}>
                          Linear Units
                          <select
                            title={SETTINGS_TOOLTIPS.units}
                            value={settingsDraft.units}
                            onChange={handleDraftUnitChange}
                            className={`${optionInputClass} mt-1`}
                          >
                            <option value="m">Meters</option>
                            <option value="ft">Feet</option>
                          </select>
                        </label>
                        <label className={optionLabelClass}>
                          Angular Units
                          <select
                            title={SETTINGS_TOOLTIPS.angleUnits}
                            value={parseSettingsDraft.angleUnits}
                            onChange={(e) =>
                              handleDraftParseSetting('angleUnits', e.target.value as 'dms' | 'dd')
                            }
                            className={`${optionInputClass} mt-1`}
                          >
                            <option value="dms">DMS</option>
                            <option value="dd">Decimal Degrees</option>
                          </select>
                        </label>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label className={optionLabelClass}>
                          Max Iterations
                          <input
                            title={SETTINGS_TOOLTIPS.maxIterations}
                            type="number"
                            min={1}
                            max={100}
                            value={settingsDraft.maxIterations}
                            onChange={handleDraftIterChange}
                            className={`${optionInputClass} mt-1`}
                          />
                        </label>
                        <label className={optionLabelClass}>
                          Convergence Limit
                          <input
                            title={SETTINGS_TOOLTIPS.convergenceLimit}
                            type="number"
                            min={0}
                            step="any"
                            value={settingsDraft.convergenceLimit}
                            onChange={handleDraftConvergenceLimitChange}
                            className={`${optionInputClass} mt-1`}
                          />
                        </label>
                      </div>
                    </SettingsCard>
                  </div>

                  <SettingsCard
                    title="Leveling / Weighting"
                    tooltip={PROJECT_OPTION_SECTION_TOOLTIPS['Weighting Helpers']}
                  >
                    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] gap-4">
                      <div className="space-y-3">
                        <SettingsRow
                          label=".LWEIGHT (mm/km)"
                          tooltip={SETTINGS_TOOLTIPS.levelWeight}
                        >
                          <input
                            title={SETTINGS_TOOLTIPS.levelWeight}
                            type="number"
                            min={0}
                            step={0.1}
                            value={parseSettingsDraft.levelWeight ?? ''}
                            onChange={(e) =>
                              handleDraftParseSetting(
                                'levelWeight',
                                e.target.value === '' ? undefined : parseFloat(e.target.value),
                              )
                            }
                            className={optionInputClass}
                          />
                        </SettingsRow>
                        <SettingsRow
                          label="Level Loop Preset"
                          tooltip={SETTINGS_TOOLTIPS.levelLoopTolerancePreset}
                        >
                          <select
                            title={SETTINGS_TOOLTIPS.levelLoopTolerancePreset}
                            value={activeLevelLoopPresetId}
                            onChange={(e) => handleLevelLoopPresetChange(e.target.value)}
                            className={optionInputClass}
                          >
                            {LEVEL_LOOP_TOLERANCE_PRESETS.map((preset) => (
                              <option key={preset.id} value={preset.id}>
                                {preset.label} ({preset.baseMm.toFixed(1)} +{' '}
                                {preset.perSqrtKmMm.toFixed(1)}*sqrt(km))
                              </option>
                            ))}
                            {levelLoopCustomPresetsDraft.length > 0 && (
                              <optgroup label="Saved Custom Presets">
                                {levelLoopCustomPresetsDraft.map((preset) => (
                                  <option key={preset.id} value={preset.id}>
                                    {preset.name} ({preset.baseMm.toFixed(1)} +{' '}
                                    {preset.perSqrtKmMm.toFixed(1)}*sqrt(km))
                                  </option>
                                ))}
                              </optgroup>
                            )}
                            <option value="custom">Custom</option>
                          </select>
                        </SettingsRow>
                        <div className="rounded-md border border-slate-400/60 bg-slate-700/20 px-3 py-2 text-[11px] text-slate-200 leading-relaxed">
                          <div className="font-semibold text-slate-100">
                            {activeLevelLoopPreset.label}
                          </div>
                          <div>{activeLevelLoopPreset.description}</div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <label className={optionLabelClass}>
                            Level Loop Base Tol (mm)
                            <input
                              title={SETTINGS_TOOLTIPS.levelLoopToleranceBase}
                              type="number"
                              min={0}
                              step={0.1}
                              value={parseSettingsDraft.levelLoopToleranceBaseMm}
                              onChange={(e) =>
                                handleDraftParseSetting(
                                  'levelLoopToleranceBaseMm',
                                  Number.isFinite(parseFloat(e.target.value))
                                    ? Math.max(0, parseFloat(e.target.value))
                                    : 0,
                                )
                              }
                              className={`${optionInputClass} mt-1`}
                            />
                          </label>
                          <label className={optionLabelClass}>
                            Level Loop K (mm/sqrt(km))
                            <input
                              title={SETTINGS_TOOLTIPS.levelLoopToleranceK}
                              type="number"
                              min={0}
                              step={0.1}
                              value={parseSettingsDraft.levelLoopTolerancePerSqrtKmMm}
                              onChange={(e) =>
                                handleDraftParseSetting(
                                  'levelLoopTolerancePerSqrtKmMm',
                                  Number.isFinite(parseFloat(e.target.value))
                                    ? Math.max(0, parseFloat(e.target.value))
                                    : 4,
                                )
                              }
                              className={`${optionInputClass} mt-1`}
                            />
                          </label>
                        </div>
                        <div className="text-[11px] text-slate-300 leading-relaxed">
                          Loop tolerance is evaluated as{' '}
                          <span className="font-semibold">base + k * sqrt(km)</span>. Built-in
                          presets are instant shortcuts; saved custom presets let you keep
                          office-specific standards in the project options.
                        </div>
                      </div>

                      <div className="rounded-md border border-slate-400/70 bg-slate-700/20 p-3 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-[11px] uppercase tracking-wide text-slate-200">
                            Saved Custom Presets
                          </div>
                          <button
                            type="button"
                            onClick={addLevelLoopCustomPreset}
                            className="px-3 py-1 text-[11px] border border-slate-300 bg-slate-600 hover:bg-slate-500 text-slate-100"
                            title="Save the current Base and K values as a reusable named custom preset."
                          >
                            Add Current
                          </button>
                        </div>
                        {levelLoopCustomPresetsDraft.length === 0 ? (
                          <div className="text-[11px] text-slate-300 leading-relaxed">
                            No custom presets saved yet. Use{' '}
                            <span className="font-semibold">Add Current</span> to capture the active
                            Base and K values with a reusable name.
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {levelLoopCustomPresetsDraft.map((preset) => (
                              <div
                                key={preset.id}
                                className={`rounded-md border p-3 space-y-3 ${
                                  activeLevelLoopPresetId === preset.id
                                    ? 'border-blue-300 bg-blue-950/20'
                                    : 'border-slate-400/70 bg-slate-600/30'
                                }`}
                              >
                                <label className={optionLabelClass}>
                                  Preset Name
                                  <input
                                    type="text"
                                    value={preset.name}
                                    onChange={(e) =>
                                      handleLevelLoopCustomPresetFieldChange(
                                        preset.id,
                                        'name',
                                        e.target.value,
                                      )
                                    }
                                    className={`${optionInputClass} mt-1`}
                                  />
                                </label>
                                <div className="grid grid-cols-2 gap-3">
                                  <label className={optionLabelClass}>
                                    Base (mm)
                                    <input
                                      type="number"
                                      min={0}
                                      step={0.1}
                                      value={preset.baseMm}
                                      onChange={(e) =>
                                        handleLevelLoopCustomPresetFieldChange(
                                          preset.id,
                                          'baseMm',
                                          e.target.value,
                                        )
                                      }
                                      className={`${optionInputClass} mt-1`}
                                    />
                                  </label>
                                  <label className={optionLabelClass}>
                                    K (mm/sqrt(km))
                                    <input
                                      type="number"
                                      min={0}
                                      step={0.1}
                                      value={preset.perSqrtKmMm}
                                      onChange={(e) =>
                                        handleLevelLoopCustomPresetFieldChange(
                                          preset.id,
                                          'perSqrtKmMm',
                                          e.target.value,
                                        )
                                      }
                                      className={`${optionInputClass} mt-1`}
                                    />
                                  </label>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                  <div className="text-[11px] text-slate-300">
                                    {preset.baseMm.toFixed(1)} + {preset.perSqrtKmMm.toFixed(1)}
                                    *sqrt(km)
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => handleLevelLoopPresetChange(preset.id)}
                                      className="px-3 py-1 text-[11px] border border-slate-300 bg-slate-600 hover:bg-slate-500 text-slate-100"
                                      title="Apply this saved custom preset to the active level-loop tolerance."
                                    >
                                      Use
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => removeLevelLoopCustomPreset(preset.id)}
                                      className="px-3 py-1 text-[11px] border border-rose-300/70 bg-rose-950/30 hover:bg-rose-900/40 text-rose-100"
                                      title="Delete this saved custom preset from the draft project settings."
                                    >
                                      Delete
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </SettingsCard>
                </div>
              )}

              {activeOptionsTab === 'general' && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <SettingsCard
                    title="Local / Grid Reduction"
                    tooltip={PROJECT_OPTION_SECTION_TOOLTIPS['Local/Grid Reduction']}
                  >
                    <SettingsRow label="Map Mode" tooltip={SETTINGS_TOOLTIPS.mapMode}>
                      <select
                        title={SETTINGS_TOOLTIPS.mapMode}
                        value={parseSettingsDraft.mapMode}
                        onChange={(e) =>
                          handleDraftParseSetting('mapMode', e.target.value as MapMode)
                        }
                        className={optionInputClass}
                      >
                        <option value="off">Off</option>
                        <option value="on">On</option>
                        <option value="anglecalc">AngleCalc</option>
                      </select>
                    </SettingsRow>
                    <SettingsRow label="Map Scale Factor" tooltip={SETTINGS_TOOLTIPS.mapScale}>
                      <input
                        title={SETTINGS_TOOLTIPS.mapScale}
                        type="number"
                        min={0.5}
                        max={1.5}
                        step={0.000001}
                        value={parseSettingsDraft.mapScaleFactor ?? ''}
                        onChange={(e) =>
                          handleDraftParseSetting(
                            'mapScaleFactor',
                            e.target.value === '' ? undefined : parseFloat(e.target.value),
                          )
                        }
                        className={optionInputClass}
                      />
                    </SettingsRow>
                    <SettingsRow label="UI Theme" tooltip={SETTINGS_TOOLTIPS.uiTheme}>
                      <select
                        title={SETTINGS_TOOLTIPS.uiTheme}
                        value={settingsDraft.uiTheme}
                        onChange={(e) =>
                          handleDraftSetting('uiTheme', normalizeUiTheme(e.target.value))
                        }
                        className={optionInputClass}
                      >
                        <option value="gruvbox-dark">Gruvbox Dark</option>
                        <option value="gruvbox-light">Gruvbox Light</option>
                        <option value="catppuccin-mocha">Catppuccin Mocha</option>
                        <option value="catppuccin-latte">Catppuccin Latte</option>
                      </select>
                    </SettingsRow>
                    <SettingsRow
                      label="Face Normalization Mode"
                      tooltip={SETTINGS_TOOLTIPS.faceNormalizationMode}
                    >
                      <select
                        title={SETTINGS_TOOLTIPS.faceNormalizationMode}
                        value={parseSettingsDraft.faceNormalizationMode}
                        onChange={(e) =>
                          handleDraftParseSetting(
                            'faceNormalizationMode',
                            e.target.value as FaceNormalizationMode,
                          )
                        }
                        className={optionInputClass}
                      >
                        <option value="on">On (normalize reliable face-II)</option>
                        <option value="off">Off (split-face)</option>
                        <option value="auto">Auto (WebNet compatibility)</option>
                      </select>
                    </SettingsRow>
                    <SettingsRow
                      label="Map Show Lost Stations"
                      tooltip={SETTINGS_TOOLTIPS.mapShowLostStations}
                      className="md:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <SettingsToggle
                        title={SETTINGS_TOOLTIPS.mapShowLostStations}
                        checked={settingsDraft.mapShowLostStations}
                        onChange={(checked) => handleDraftSetting('mapShowLostStations', checked)}
                      />
                    </SettingsRow>
                    <SettingsRow
                      label="Map 3D"
                      tooltip={SETTINGS_TOOLTIPS.map3dEnabled}
                      className="md:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <SettingsToggle
                        title={SETTINGS_TOOLTIPS.map3dEnabled}
                        checked={settingsDraft.map3dEnabled}
                        onChange={(checked) => handleDraftSetting('map3dEnabled', checked)}
                      />
                    </SettingsRow>
                  </SettingsCard>

                  <SettingsCard
                    title="Vertical Reduction"
                    tooltip={PROJECT_OPTION_SECTION_TOOLTIPS['Vertical Reduction']}
                  >
                    <SettingsRow
                      label="Curvature / Refraction"
                      tooltip={SETTINGS_TOOLTIPS.curvatureRefraction}
                      className="md:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <SettingsToggle
                        title={SETTINGS_TOOLTIPS.curvatureRefraction}
                        checked={parseSettingsDraft.applyCurvatureRefraction}
                        onChange={(checked) =>
                          handleDraftParseSetting('applyCurvatureRefraction', checked)
                        }
                      />
                    </SettingsRow>
                    <SettingsRow
                      label="Refraction Coefficient"
                      tooltip={SETTINGS_TOOLTIPS.refractionK}
                    >
                      <input
                        title={SETTINGS_TOOLTIPS.refractionK}
                        type="number"
                        min={-1}
                        max={1}
                        step={0.01}
                        value={parseSettingsDraft.refractionCoefficient}
                        onChange={(e) =>
                          handleDraftParseSetting(
                            'refractionCoefficient',
                            Number.isFinite(parseFloat(e.target.value))
                              ? parseFloat(e.target.value)
                              : 0.13,
                          )
                        }
                        className={optionInputClass}
                      />
                    </SettingsRow>
                    <SettingsRow
                      label="Vertical Reduction Mode"
                      tooltip={SETTINGS_TOOLTIPS.verticalReduction}
                    >
                      <select
                        title={SETTINGS_TOOLTIPS.verticalReduction}
                        value={parseSettingsDraft.verticalReduction}
                        onChange={(e) =>
                          handleDraftParseSetting(
                            'verticalReduction',
                            e.target.value as VerticalReductionMode,
                          )
                        }
                        className={optionInputClass}
                      >
                        <option value="none">None</option>
                        <option value="curvref">CurvRef</option>
                      </select>
                    </SettingsRow>
                  </SettingsCard>
                </div>
              )}

              {activeOptionsTab === 'instrument' && (
                <div className="space-y-4">
                  <SettingsCard
                    title="Instrument Selection"
                    tooltip="Select the active project instrument, create new instruments, and edit the description for the current instrument."
                  >
                    <SettingsRow label="Instrument" tooltip={SETTINGS_TOOLTIPS.instrument}>
                      <div className="flex items-center gap-2">
                        <select
                          title={SETTINGS_TOOLTIPS.instrument}
                          value={selectedInstrumentDraft}
                          onChange={(e) => setSelectedInstrumentDraft(e.target.value)}
                          className={optionInputClass}
                        >
                          {Object.keys(projectInstrumentsDraft).length === 0 && (
                            <option value="">(none)</option>
                          )}
                          {Object.values(projectInstrumentsDraft).map((inst) => (
                            <option key={inst.code} value={inst.code}>
                              {inst.code}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={addNewInstrument}
                          className="px-3 py-1 text-[11px] border border-slate-300 bg-slate-600 hover:bg-slate-500 text-slate-100"
                          title={SETTINGS_TOOLTIPS.newInstrument}
                        >
                          New
                        </button>
                        <button
                          type="button"
                          onClick={duplicateSelectedInstrument}
                          disabled={!selectedInstrumentMeta}
                          className="px-3 py-1 text-[11px] border border-slate-300 bg-slate-600 hover:bg-slate-500 text-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                          title={SETTINGS_TOOLTIPS.duplicateInstrument}
                        >
                          Duplicate
                        </button>
                      </div>
                    </SettingsRow>
                    {selectedInstrumentMeta && (
                      <SettingsRow
                        label="Instrument Description"
                        tooltip={SETTINGS_TOOLTIPS.instrumentDescription}
                      >
                        <input
                          title={SETTINGS_TOOLTIPS.instrumentDescription}
                          type="text"
                          value={selectedInstrumentMeta.desc}
                          onChange={(e) =>
                            handleInstrumentFieldChange(
                              selectedInstrumentMeta.code,
                              'desc',
                              e.target.value,
                            )
                          }
                          className={optionInputClass}
                        />
                      </SettingsRow>
                    )}
                  </SettingsCard>
                  {selectedInstrumentMeta ? (
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                      <SettingsCard
                        title="Horizontal Precision"
                        tooltip="Horizontal EDM, angular, azimuth, and horizontal centering parameters for the selected instrument."
                      >
                        <SettingsRow
                          label={`Distance Constant (${instrumentLinearUnit})`}
                          tooltip={SETTINGS_TOOLTIPS.instrumentDistanceConstant}
                        >
                          <input
                            title={SETTINGS_TOOLTIPS.instrumentDistanceConstant}
                            type="number"
                            step={0.00001}
                            value={displayLinear(selectedInstrumentMeta.edm_const)}
                            onChange={(e) =>
                              handleInstrumentLinearFieldChange(
                                selectedInstrumentMeta.code,
                                'edm_const',
                                e.target.value,
                                settingsDraft.units,
                              )
                            }
                            className={optionInputClass}
                          />
                        </SettingsRow>
                        <SettingsRow
                          label="Distance PPM"
                          tooltip={SETTINGS_TOOLTIPS.instrumentDistancePpm}
                        >
                          <input
                            title={SETTINGS_TOOLTIPS.instrumentDistancePpm}
                            type="number"
                            step={0.001}
                            value={selectedInstrumentMeta.edm_ppm}
                            onChange={(e) =>
                              handleInstrumentNumericFieldChange(
                                selectedInstrumentMeta.code,
                                'edm_ppm',
                                e.target.value,
                              )
                            }
                            className={optionInputClass}
                          />
                        </SettingsRow>
                        <SettingsRow
                          label="Angle (Seconds)"
                          tooltip={SETTINGS_TOOLTIPS.instrumentAngleSeconds}
                        >
                          <input
                            title={SETTINGS_TOOLTIPS.instrumentAngleSeconds}
                            type="number"
                            step={0.0001}
                            value={selectedInstrumentMeta.hzPrecision_sec}
                            onChange={(e) =>
                              handleInstrumentNumericFieldChange(
                                selectedInstrumentMeta.code,
                                'hzPrecision_sec',
                                e.target.value,
                              )
                            }
                            className={optionInputClass}
                          />
                        </SettingsRow>
                        <SettingsRow
                          label="Direction (Seconds)"
                          tooltip={SETTINGS_TOOLTIPS.instrumentDirectionSeconds}
                        >
                          <input
                            title={SETTINGS_TOOLTIPS.instrumentDirectionSeconds}
                            type="number"
                            step={0.0001}
                            value={selectedInstrumentMeta.dirPrecision_sec}
                            onChange={(e) =>
                              handleInstrumentNumericFieldChange(
                                selectedInstrumentMeta.code,
                                'dirPrecision_sec',
                                e.target.value,
                              )
                            }
                            className={optionInputClass}
                          />
                        </SettingsRow>
                        <SettingsRow
                          label="Azimuth / Bearing (Seconds)"
                          tooltip={SETTINGS_TOOLTIPS.instrumentAzBearingSeconds}
                        >
                          <input
                            title={SETTINGS_TOOLTIPS.instrumentAzBearingSeconds}
                            type="number"
                            step={0.0001}
                            value={selectedInstrumentMeta.azBearingPrecision_sec}
                            onChange={(e) =>
                              handleInstrumentNumericFieldChange(
                                selectedInstrumentMeta.code,
                                'azBearingPrecision_sec',
                                e.target.value,
                              )
                            }
                            className={optionInputClass}
                          />
                        </SettingsRow>
                        <SettingsRow
                          label={`Centering Horiz. Instrument (${instrumentLinearUnit})`}
                          tooltip={SETTINGS_TOOLTIPS.instrumentCenteringHorizInst}
                        >
                          <input
                            title={SETTINGS_TOOLTIPS.instrumentCenteringHorizInst}
                            type="number"
                            step={0.00001}
                            value={displayLinear(selectedInstrumentMeta.instCentr_m)}
                            onChange={(e) =>
                              handleInstrumentLinearFieldChange(
                                selectedInstrumentMeta.code,
                                'instCentr_m',
                                e.target.value,
                                settingsDraft.units,
                              )
                            }
                            className={optionInputClass}
                          />
                        </SettingsRow>
                        <SettingsRow
                          label={`Centering Horiz. Target (${instrumentLinearUnit})`}
                          tooltip={SETTINGS_TOOLTIPS.instrumentCenteringHorizTarget}
                        >
                          <input
                            title={SETTINGS_TOOLTIPS.instrumentCenteringHorizTarget}
                            type="number"
                            step={0.00001}
                            value={displayLinear(selectedInstrumentMeta.tgtCentr_m)}
                            onChange={(e) =>
                              handleInstrumentLinearFieldChange(
                                selectedInstrumentMeta.code,
                                'tgtCentr_m',
                                e.target.value,
                                settingsDraft.units,
                              )
                            }
                            className={optionInputClass}
                          />
                        </SettingsRow>
                      </SettingsCard>
                      <SettingsCard
                        title="Vertical Precision"
                        tooltip="Vertical-angle, elevation-difference, and vertical centering parameters for the selected instrument."
                      >
                        <SettingsRow
                          label="Zenith (Seconds)"
                          tooltip={SETTINGS_TOOLTIPS.instrumentZenithSeconds}
                        >
                          <input
                            title={SETTINGS_TOOLTIPS.instrumentZenithSeconds}
                            type="number"
                            step={0.0001}
                            disabled={parseSettingsDraft.coordMode === '2D'}
                            value={selectedInstrumentMeta.vaPrecision_sec}
                            onChange={(e) =>
                              handleInstrumentNumericFieldChange(
                                selectedInstrumentMeta.code,
                                'vaPrecision_sec',
                                e.target.value,
                              )
                            }
                            className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                          />
                        </SettingsRow>
                        <SettingsRow
                          label={`Elev Diff Constant (${instrumentLinearUnit})`}
                          tooltip={SETTINGS_TOOLTIPS.instrumentElevDiffConstant}
                        >
                          <input
                            title={SETTINGS_TOOLTIPS.instrumentElevDiffConstant}
                            type="number"
                            step={0.00001}
                            disabled={parseSettingsDraft.coordMode === '2D'}
                            value={displayLinear(selectedInstrumentMeta.elevDiff_const_m)}
                            onChange={(e) =>
                              handleInstrumentLinearFieldChange(
                                selectedInstrumentMeta.code,
                                'elevDiff_const_m',
                                e.target.value,
                                settingsDraft.units,
                              )
                            }
                            className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                          />
                        </SettingsRow>
                        <SettingsRow
                          label="Elev Diff PPM"
                          tooltip={SETTINGS_TOOLTIPS.instrumentElevDiffPpm}
                        >
                          <input
                            title={SETTINGS_TOOLTIPS.instrumentElevDiffPpm}
                            type="number"
                            step={0.001}
                            disabled={parseSettingsDraft.coordMode === '2D'}
                            value={selectedInstrumentMeta.elevDiff_ppm}
                            onChange={(e) =>
                              handleInstrumentNumericFieldChange(
                                selectedInstrumentMeta.code,
                                'elevDiff_ppm',
                                e.target.value,
                              )
                            }
                            className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                          />
                        </SettingsRow>
                        <SettingsRow
                          label={`Centering Vertical (${instrumentLinearUnit})`}
                          tooltip={SETTINGS_TOOLTIPS.instrumentCenteringVertical}
                        >
                          <input
                            title={SETTINGS_TOOLTIPS.instrumentCenteringVertical}
                            type="number"
                            step={0.00001}
                            disabled={parseSettingsDraft.coordMode === '2D'}
                            value={displayLinear(selectedInstrumentMeta.vertCentr_m)}
                            onChange={(e) =>
                              handleInstrumentLinearFieldChange(
                                selectedInstrumentMeta.code,
                                'vertCentr_m',
                                e.target.value,
                                settingsDraft.units,
                              )
                            }
                            className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                          />
                        </SettingsRow>
                      </SettingsCard>
                    </div>
                  ) : (
                    <SettingsCard
                      title="Instrument Selection"
                      tooltip="No project instrument is currently selected."
                    >
                      <div className="text-xs text-slate-200">No instrument selected.</div>
                    </SettingsCard>
                  )}
                </div>
              )}

              {activeOptionsTab === 'listing-file' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="border border-slate-400 p-3 space-y-3">
                    <div
                      className="text-xs uppercase tracking-wider text-slate-200"
                      title={PROJECT_OPTION_SECTION_TOOLTIPS['Industry-Style Listing Contents']}
                    >
                      Industry-Style Listing Contents
                    </div>
                    <label className="flex items-center gap-2 text-xs text-slate-100">
                      <input
                        title={SETTINGS_TOOLTIPS.listingShowCoordinates}
                        type="checkbox"
                        className="accent-blue-400"
                        checked={settingsDraft.listingShowCoordinates}
                        onChange={(e) =>
                          handleDraftSetting('listingShowCoordinates', e.target.checked)
                        }
                      />
                      <span>Adjusted Coordinates</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-100">
                      <input
                        title={SETTINGS_TOOLTIPS.listingShowObservationsResiduals}
                        type="checkbox"
                        className="accent-blue-400"
                        checked={settingsDraft.listingShowObservationsResiduals}
                        onChange={(e) =>
                          handleDraftSetting('listingShowObservationsResiduals', e.target.checked)
                        }
                      />
                      <span>Adjusted Observations and Residuals</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-100">
                      <input
                        title={SETTINGS_TOOLTIPS.listingShowErrorPropagation}
                        type="checkbox"
                        className="accent-blue-400"
                        checked={settingsDraft.listingShowErrorPropagation}
                        onChange={(e) =>
                          handleDraftSetting('listingShowErrorPropagation', e.target.checked)
                        }
                      />
                      <span>Error Propagation</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-100">
                      <input
                        title={SETTINGS_TOOLTIPS.listingShowProcessingNotes}
                        type="checkbox"
                        className="accent-blue-400"
                        checked={settingsDraft.listingShowProcessingNotes}
                        onChange={(e) =>
                          handleDraftSetting('listingShowProcessingNotes', e.target.checked)
                        }
                      />
                      <span>Processing Notes</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-100">
                      <input
                        title={SETTINGS_TOOLTIPS.listingShowLostStations}
                        type="checkbox"
                        className="accent-blue-400"
                        checked={settingsDraft.listingShowLostStations}
                        onChange={(e) =>
                          handleDraftSetting('listingShowLostStations', e.target.checked)
                        }
                      />
                      <span>Show Lost Stations in Listing/Export</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-100">
                      <input
                        title={SETTINGS_TOOLTIPS.listingShowAzimuthsBearings}
                        type="checkbox"
                        className="accent-blue-400"
                        checked={settingsDraft.listingShowAzimuthsBearings}
                        onChange={(e) =>
                          handleDraftSetting('listingShowAzimuthsBearings', e.target.checked)
                        }
                      />
                      <span>Show Azimuths & Bearings</span>
                    </label>
                  </div>
                  <div className="border border-slate-400 p-3 space-y-3">
                    <div
                      className="text-xs uppercase tracking-wider text-slate-200"
                      title={PROJECT_OPTION_SECTION_TOOLTIPS['Industry-Style Listing Sort/Scope']}
                    >
                      Industry-Style Listing Sort/Scope
                    </div>
                    <label className={optionLabelClass}>
                      Sort Coordinates By
                      <select
                        title={SETTINGS_TOOLTIPS.listingSortCoordinatesBy}
                        value={settingsDraft.listingSortCoordinatesBy}
                        onChange={(e) =>
                          handleDraftSetting(
                            'listingSortCoordinatesBy',
                            e.target.value as ListingSortCoordinatesBy,
                          )
                        }
                        className={`${optionInputClass} mt-1`}
                      >
                        <option value="input">Input Order</option>
                        <option value="name">Name</option>
                      </select>
                    </label>
                    <label className={optionLabelClass}>
                      Sort Adjusted Obs/Residuals By
                      <select
                        title={SETTINGS_TOOLTIPS.listingSortObservationsBy}
                        value={settingsDraft.listingSortObservationsBy}
                        onChange={(e) =>
                          handleDraftSetting(
                            'listingSortObservationsBy',
                            e.target.value as ListingSortObservationsBy,
                          )
                        }
                        className={`${optionInputClass} mt-1`}
                      >
                        <option value="input">Input Order</option>
                        <option value="name">Name</option>
                        <option value="residual">Residual Size</option>
                      </select>
                    </label>
                    <label className={optionLabelClass}>
                      Adjusted Obs Row Limit
                      <input
                        title={SETTINGS_TOOLTIPS.listingObservationLimit}
                        type="number"
                        min={1}
                        max={500}
                        step={1}
                        value={settingsDraft.listingObservationLimit}
                        onChange={(e) => {
                          const parsed = Number.parseInt(e.target.value || '1', 10);
                          const clamped = Number.isFinite(parsed)
                            ? Math.max(1, Math.min(500, parsed))
                            : 1;
                          handleDraftSetting('listingObservationLimit', clamped);
                        }}
                        className={`${optionInputClass} mt-1`}
                      />
                    </label>
                  </div>
                </div>
              )}

              {activeOptionsTab === 'other-files' && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <SettingsCard
                    title="Other File Outputs"
                    tooltip={PROJECT_OPTION_SECTION_TOOLTIPS['Other File Outputs']}
                  >
                    <SettingsRow label="Export Format" tooltip={SETTINGS_TOOLTIPS.exportFormat}>
                      <select
                        title={getExportFormatTooltip(exportFormat)}
                        value={exportFormat}
                        onChange={(e) => setExportFormat(e.target.value as ProjectExportFormat)}
                        className={optionInputClass}
                      >
                        {EXPORT_FORMAT_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.optionLabel}
                          </option>
                        ))}
                      </select>
                    </SettingsRow>
                    <SettingsRow
                      label="Output Extension"
                      tooltip="Current file extension used by the active export format."
                    >
                      <div className="rounded border border-slate-500 bg-slate-700 px-2 py-1 text-xs text-slate-100">
                        {getExportFormatExtension(exportFormat)}
                      </div>
                    </SettingsRow>
                    <SettingsRow
                      label="Output Family"
                      tooltip="Describes the current export target generated by the toolbar export action."
                    >
                      <div className="rounded border border-slate-500 bg-slate-700 px-2 py-1 text-xs text-slate-100">
                        {getExportFormatLabel(exportFormat)}
                      </div>
                    </SettingsRow>
                    <SettingsRow
                      label="Export Details"
                      tooltip="Detailed description for the currently selected export target."
                    >
                      <div
                        title={getExportFormatTooltip(exportFormat)}
                        className="rounded border border-slate-500 bg-slate-700 px-2 py-1 text-xs text-slate-100"
                      >
                        {getExportFormatTooltip(exportFormat)}
                      </div>
                    </SettingsRow>
                  </SettingsCard>
                  <SettingsCard
                    title="Project Files"
                    tooltip={PROJECT_OPTION_SECTION_TOOLTIPS['Project Files']}
                  >
                    <div className="space-y-2">
                      <div className="text-xs text-slate-200 leading-relaxed">
                        Save or reopen complete project workspaces (input text + settings +
                        instruments + adjusted-points export preferences). Solved reports are not
                        stored.
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          title={SETTINGS_TOOLTIPS.projectFiles}
                          onClick={triggerProjectFileSelect}
                          className="rounded border border-slate-400 bg-slate-700 px-3 py-1 text-xs text-slate-100 hover:bg-slate-600"
                        >
                          Open Project
                        </button>
                        <button
                          type="button"
                          title={SETTINGS_TOOLTIPS.projectFiles}
                          onClick={handleSaveProject}
                          className="rounded border border-slate-400 bg-slate-700 px-3 py-1 text-xs text-slate-100 hover:bg-slate-600"
                        >
                          Save Project
                        </button>
                      </div>
                      <div className="rounded-md border border-slate-400/60 bg-slate-700/20 px-3 py-2 text-[11px] text-slate-200 leading-relaxed">
                        Schema: <span className="font-semibold">webnet-project v1</span>
                      </div>
                    </div>
                  </SettingsCard>
                  <SettingsCard
                    title="Adjusted Points Export"
                    tooltip={PROJECT_OPTION_SECTION_TOOLTIPS['Adjusted Points Export']}
                    className="xl:col-span-2"
                  >
                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
                      <div className="space-y-3">
                        <SettingsRow
                          label="Adjusted Points Preset"
                          tooltip={SETTINGS_TOOLTIPS.adjustedPointsPreset}
                        >
                          <select
                            title={SETTINGS_TOOLTIPS.adjustedPointsPreset}
                            value={adjustedPointsExportSettingsDraft.presetId}
                            onChange={(e) =>
                              handleAdjustedPointsPresetChange(
                                e.target.value as AdjustedPointsPresetId,
                              )
                            }
                            className={optionInputClass}
                          >
                            <option value="PNEZD">PNEZD</option>
                            <option value="PENZD">PENZD</option>
                            <option value="PNEZ">PNEZ</option>
                            <option value="PENZ">PENZ</option>
                            <option value="NEZ">NEZ</option>
                            <option value="PEN">PEN</option>
                            <option value="custom">Custom</option>
                          </select>
                        </SettingsRow>
                        <SettingsRow
                          label="Adjusted Points Format"
                          tooltip={SETTINGS_TOOLTIPS.adjustedPointsFormat}
                        >
                          <select
                            title={SETTINGS_TOOLTIPS.adjustedPointsFormat}
                            value={adjustedPointsExportSettingsDraft.format}
                            onChange={(e) =>
                              handleDraftAdjustedPointsSetting(
                                'format',
                                e.target.value as AdjustedPointsExportSettings['format'],
                              )
                            }
                            className={optionInputClass}
                          >
                            <option value="csv">CSV</option>
                            <option value="text">Text</option>
                          </select>
                        </SettingsRow>
                        <SettingsRow
                          label="Adjusted Points Delimiter"
                          tooltip={SETTINGS_TOOLTIPS.adjustedPointsDelimiter}
                        >
                          <select
                            title={SETTINGS_TOOLTIPS.adjustedPointsDelimiter}
                            value={adjustedPointsExportSettingsDraft.delimiter}
                            onChange={(e) =>
                              handleDraftAdjustedPointsSetting(
                                'delimiter',
                                e.target.value as AdjustedPointsExportSettings['delimiter'],
                              )
                            }
                            className={optionInputClass}
                          >
                            <option value="comma">Comma</option>
                            <option value="space">Space</option>
                            <option value="tab">Tab</option>
                          </select>
                        </SettingsRow>
                        <SettingsRow
                          label="Include Lost Stations"
                          tooltip={SETTINGS_TOOLTIPS.adjustedPointsIncludeLost}
                          className="md:grid-cols-[minmax(0,1fr)_auto]"
                        >
                          <SettingsToggle
                            title={SETTINGS_TOOLTIPS.adjustedPointsIncludeLost}
                            checked={adjustedPointsExportSettingsDraft.includeLostStations}
                            onChange={(checked) =>
                              handleDraftAdjustedPointsSetting('includeLostStations', checked)
                            }
                          />
                        </SettingsRow>
                        <div className="rounded-md border border-slate-400/60 bg-slate-700/20 px-3 py-2 text-[11px] text-slate-200 leading-relaxed">
                          Selected columns: {adjustedPointsExportSettingsDraft.columns.length}/6
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="text-[11px] uppercase tracking-wide text-slate-300">
                          Available Columns
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {ADJUSTED_POINTS_ALL_COLUMNS.map((columnId) => {
                            const checked =
                              adjustedPointsExportSettingsDraft.columns.includes(columnId);
                            const disableEnable =
                              !checked && adjustedPointsExportSettingsDraft.columns.length >= 6;
                            const disableDisable =
                              checked && adjustedPointsExportSettingsDraft.columns.length <= 1;
                            return (
                              <label
                                key={`adj-col-${columnId}`}
                                className={`flex items-center gap-2 rounded border px-2 py-1 text-xs ${
                                  checked
                                    ? 'border-blue-400/70 bg-blue-900/20 text-blue-100'
                                    : 'border-slate-500 bg-slate-700/30 text-slate-200'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={checked ? disableDisable : disableEnable}
                                  onChange={(e) =>
                                    handleAdjustedPointsToggleColumn(columnId, e.target.checked)
                                  }
                                />
                                <span>{columnId}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="text-[11px] uppercase tracking-wide text-slate-300">
                          Selected Order
                        </div>
                        <div className="space-y-1">
                          {adjustedPointsExportSettingsDraft.columns.map((columnId, index) => (
                            <div
                              key={`adj-order-${columnId}`}
                              className="flex items-center justify-between rounded border border-slate-500 bg-slate-700/30 px-2 py-1 text-xs text-slate-100"
                              draggable
                              onDragStart={() => handleAdjustedPointsDragStart(columnId)}
                              onDragOver={(event) => event.preventDefault()}
                              onDrop={() => handleAdjustedPointsDrop(columnId)}
                            >
                              <span className="font-semibold">
                                {index + 1}. {columnId}
                              </span>
                              <span className="flex items-center gap-1">
                                <button
                                  type="button"
                                  title={`Move ${columnId} left`}
                                  disabled={index === 0}
                                  onClick={() => handleAdjustedPointsMoveColumn(columnId, 'left')}
                                  className="rounded border border-slate-500 px-1 py-0.5 disabled:opacity-40"
                                >
                                  {'<'}
                                </button>
                                <button
                                  type="button"
                                  title={`Move ${columnId} right`}
                                  disabled={
                                    index === adjustedPointsExportSettingsDraft.columns.length - 1
                                  }
                                  onClick={() => handleAdjustedPointsMoveColumn(columnId, 'right')}
                                  className="rounded border border-slate-500 px-1 py-0.5 disabled:opacity-40"
                                >
                                  {'>'}
                                </button>
                              </span>
                            </div>
                          ))}
                        </div>
                        <div className="rounded border border-slate-500 bg-slate-700/30 px-2 py-2 text-xs text-slate-200">
                          Use the main export selector for adjusted-points output.
                        </div>
                      </div>
                    </div>
                  </SettingsCard>
                  <SettingsCard
                    title="Transform"
                    tooltip={PROJECT_OPTION_SECTION_TOOLTIPS.Transform}
                    className="xl:col-span-2"
                  >
                    <div className="space-y-3">
                      <div className="rounded-md border border-cyan-500/50 bg-cyan-900/10 p-3 space-y-3">
                        <div className="text-[11px] uppercase tracking-wide text-cyan-200">
                          Shared Controls
                        </div>
                        <SettingsRow
                          label="Reference Point"
                          tooltip={SETTINGS_TOOLTIPS.adjustedPointsTransformReference}
                        >
                          <select
                            title={SETTINGS_TOOLTIPS.adjustedPointsTransformReference}
                            value={adjustedPointsExportSettingsDraft.transform.referenceStationId}
                            disabled={adjustedPointsDraftStationIds.length === 0}
                            onChange={(e) =>
                              handleDraftAdjustedPointsTransformSetting(
                                'referenceStationId',
                                e.target.value,
                              )
                            }
                            className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                          >
                            <option value="">Select reference station</option>
                            {adjustedPointsDraftStationIds.map((stationId) => (
                              <option key={`adj-transform-ref-${stationId}`} value={stationId}>
                                {stationId}
                              </option>
                            ))}
                          </select>
                        </SettingsRow>
                        <SettingsRow
                          label="Scope"
                          tooltip={SETTINGS_TOOLTIPS.adjustedPointsTransformScope}
                        >
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleDraftAdjustedPointsTransformSetting('scope', 'all')}
                              disabled={adjustedPointsDraftStationIds.length === 0}
                              className={`rounded border px-2 py-1 text-xs uppercase tracking-wide ${
                                adjustedPointsExportSettingsDraft.transform.scope === 'all'
                                  ? 'border-cyan-400 bg-cyan-800/40 text-cyan-100'
                                  : 'border-slate-500 bg-slate-700 text-slate-100 hover:bg-slate-600'
                              } disabled:opacity-50 disabled:cursor-not-allowed`}
                            >
                              All Points
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                handleDraftAdjustedPointsTransformSetting('scope', 'selected');
                                if (adjustedPointsDraftStationIds.length > 0) {
                                  openAdjustedPointsTransformSelectModal();
                                }
                              }}
                              disabled={adjustedPointsDraftStationIds.length === 0}
                              className={`rounded border px-2 py-1 text-xs uppercase tracking-wide ${
                                adjustedPointsExportSettingsDraft.transform.scope === 'selected'
                                  ? 'border-cyan-400 bg-cyan-800/40 text-cyan-100'
                                  : 'border-slate-500 bg-slate-700 text-slate-100 hover:bg-slate-600'
                              } disabled:opacity-50 disabled:cursor-not-allowed`}
                            >
                              Select Points
                            </button>
                          </div>
                        </SettingsRow>
                        {adjustedPointsExportSettingsDraft.transform.scope === 'selected' && (
                          <div className="rounded border border-cyan-400/40 bg-slate-800/60 px-3 py-2 text-[11px] text-slate-200 space-y-2">
                            <div>
                              Selected points: {adjustedPointsTransformSelectedInSetCount}
                              {' | '}Reference point auto-included in transform scope.
                            </div>
                            <button
                              type="button"
                              onClick={openAdjustedPointsTransformSelectModal}
                              disabled={adjustedPointsDraftStationIds.length === 0}
                              className="rounded border border-cyan-400/70 bg-cyan-900/40 px-2 py-1 text-xs uppercase tracking-wide text-cyan-100 hover:bg-cyan-800/60 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Select Points
                            </button>
                          </div>
                        )}
                        <div className="rounded border border-cyan-500/30 bg-slate-800/60 px-3 py-2 text-[11px] text-slate-200 leading-relaxed">
                          Shared reference and scope apply to all transform actions. Active order
                          is Scale to Rotate to Translate.
                        </div>
                      </div>
                      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
                        <div className="rounded-md border border-cyan-500/50 bg-cyan-900/10 p-3 space-y-3">
                          <div className="text-[11px] uppercase tracking-wide text-cyan-200">
                            Rotation
                          </div>
                          <SettingsRow
                            label="Enable Rotation"
                            tooltip={SETTINGS_TOOLTIPS.adjustedPointsTransformRotation}
                            className="md:grid-cols-[minmax(0,1fr)_auto]"
                          >
                            <SettingsToggle
                              title={SETTINGS_TOOLTIPS.adjustedPointsTransformRotation}
                              checked={adjustedPointsExportSettingsDraft.transform.rotation.enabled}
                              onChange={(checked) =>
                                handleDraftAdjustedPointsRotationSetting('enabled', checked)
                              }
                            />
                          </SettingsRow>
                          <SettingsRow
                            label="Angle (deg or dms)"
                            tooltip={SETTINGS_TOOLTIPS.adjustedPointsTransformAngle}
                          >
                            <input
                              title={SETTINGS_TOOLTIPS.adjustedPointsTransformAngle}
                              type="text"
                              value={adjustedPointsRotationAngleInput}
                              disabled={!adjustedPointsExportSettingsDraft.transform.rotation.enabled}
                              onChange={(e) =>
                                handleDraftAdjustedPointsRotationAngleInput(e.target.value)
                              }
                              className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                              placeholder="ddd-mm-ss.s or decimal"
                            />
                          </SettingsRow>
                          {adjustedPointsExportSettingsDraft.transform.rotation.enabled &&
                            adjustedPointsRotationAngleError && (
                            <div className="text-[11px] text-red-300">
                              {adjustedPointsRotationAngleError}
                            </div>
                            )}
                          <div className="rounded border border-cyan-500/30 bg-slate-800/60 px-3 py-2 text-[11px] text-slate-200 leading-relaxed">
                            Positive angle rotates counterclockwise about the shared reference
                            point.
                          </div>
                        </div>
                        <div className="rounded-md border border-cyan-500/50 bg-cyan-900/10 p-3 space-y-3">
                          <div className="text-[11px] uppercase tracking-wide text-cyan-200">
                            Translation
                          </div>
                          <SettingsRow
                            label="Enable Translation"
                            className="md:grid-cols-[minmax(0,1fr)_auto]"
                          >
                            <SettingsToggle
                              title="Enable translation transform"
                              checked={
                                adjustedPointsExportSettingsDraft.transform.translation.enabled
                              }
                              onChange={(checked) =>
                                handleDraftAdjustedPointsTranslationSetting('enabled', checked)
                              }
                            />
                          </SettingsRow>
                          <SettingsRow
                            label="Method"
                            tooltip={SETTINGS_TOOLTIPS.adjustedPointsTransformTranslationMethod}
                          >
                            <select
                              value={adjustedPointsExportSettingsDraft.transform.translation.method}
                              disabled={
                                !adjustedPointsExportSettingsDraft.transform.translation.enabled
                              }
                              onChange={(e) =>
                                handleDraftAdjustedPointsTranslationSetting(
                                  'method',
                                  e.target.value as 'direction-distance' | 'anchor-coordinate',
                                )
                              }
                              className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                            >
                              <option value="direction-distance">Direction + Distance</option>
                              <option value="anchor-coordinate">Reference -&gt; New E/N</option>
                            </select>
                          </SettingsRow>
                          {adjustedPointsExportSettingsDraft.transform.translation.method ===
                          'direction-distance' ? (
                            <>
                              <SettingsRow
                                label="Azimuth (deg or dms)"
                                tooltip={
                                  SETTINGS_TOOLTIPS.adjustedPointsTransformTranslationAzimuth
                                }
                              >
                                <input
                                  title={SETTINGS_TOOLTIPS.adjustedPointsTransformTranslationAzimuth}
                                  type="text"
                                  value={adjustedPointsTranslationAzimuthInput}
                                  disabled={
                                    !adjustedPointsExportSettingsDraft.transform.translation.enabled
                                  }
                                  onChange={(e) =>
                                    handleDraftAdjustedPointsTranslationAzimuthInput(
                                      e.target.value,
                                    )
                                  }
                                  className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                                  placeholder="ddd-mm-ss.s or decimal"
                                />
                              </SettingsRow>
                              {adjustedPointsExportSettingsDraft.transform.translation.enabled &&
                                adjustedPointsTranslationAzimuthError && (
                                <div className="text-[11px] text-red-300">
                                  {adjustedPointsTranslationAzimuthError}
                                </div>
                                )}
                              <SettingsRow label={`Distance (${settingsDraft.units})`}>
                                <input
                                  type="number"
                                  step={0.0001}
                                  value={
                                    adjustedPointsExportSettingsDraft.transform.translation.distance
                                  }
                                  disabled={
                                    !adjustedPointsExportSettingsDraft.transform.translation.enabled
                                  }
                                  onChange={(e) => {
                                    const parsed = Number.parseFloat(e.target.value);
                                    handleDraftAdjustedPointsTranslationSetting(
                                      'distance',
                                      Number.isFinite(parsed) ? parsed : 0,
                                    );
                                  }}
                                  className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                                />
                              </SettingsRow>
                            </>
                          ) : (
                            <>
                              <SettingsRow label={`New Easting (${settingsDraft.units})`}>
                                <input
                                  type="number"
                                  step={0.0001}
                                  value={
                                    adjustedPointsExportSettingsDraft.transform.translation.targetE
                                  }
                                  disabled={
                                    !adjustedPointsExportSettingsDraft.transform.translation.enabled
                                  }
                                  onChange={(e) => {
                                    const parsed = Number.parseFloat(e.target.value);
                                    handleDraftAdjustedPointsTranslationSetting(
                                      'targetE',
                                      Number.isFinite(parsed) ? parsed : 0,
                                    );
                                  }}
                                  className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                                />
                              </SettingsRow>
                              <SettingsRow label={`New Northing (${settingsDraft.units})`}>
                                <input
                                  type="number"
                                  step={0.0001}
                                  value={
                                    adjustedPointsExportSettingsDraft.transform.translation.targetN
                                  }
                                  disabled={
                                    !adjustedPointsExportSettingsDraft.transform.translation.enabled
                                  }
                                  onChange={(e) => {
                                    const parsed = Number.parseFloat(e.target.value);
                                    handleDraftAdjustedPointsTranslationSetting(
                                      'targetN',
                                      Number.isFinite(parsed) ? parsed : 0,
                                    );
                                  }}
                                  className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                                />
                              </SettingsRow>
                            </>
                          )}
                          <div className="rounded border border-cyan-500/30 bg-slate-800/60 px-3 py-2 text-[11px] text-slate-200 leading-relaxed">
                            Azimuth convention is surveying style: 0 north, 90 east, 180 south, 270
                            west.
                          </div>
                        </div>
                        <div className="rounded-md border border-cyan-500/50 bg-cyan-900/10 p-3 space-y-3">
                          <div className="text-[11px] uppercase tracking-wide text-cyan-200">
                            Scale
                          </div>
                          <SettingsRow
                            label="Enable Scale"
                            className="md:grid-cols-[minmax(0,1fr)_auto]"
                          >
                            <SettingsToggle
                              title="Enable scale transform"
                              checked={adjustedPointsExportSettingsDraft.transform.scale.enabled}
                              onChange={(checked) =>
                                handleDraftAdjustedPointsScaleSetting('enabled', checked)
                              }
                            />
                          </SettingsRow>
                          <SettingsRow
                            label="Factor"
                            tooltip={SETTINGS_TOOLTIPS.adjustedPointsTransformScale}
                          >
                            <input
                              title={SETTINGS_TOOLTIPS.adjustedPointsTransformScale}
                              type="number"
                              step={0.000001}
                              min={0.000001}
                              value={adjustedPointsExportSettingsDraft.transform.scale.factor}
                              disabled={!adjustedPointsExportSettingsDraft.transform.scale.enabled}
                              onChange={(e) => {
                                const parsed = Number.parseFloat(e.target.value);
                                handleDraftAdjustedPointsScaleSetting(
                                  'factor',
                                  Number.isFinite(parsed) ? parsed : 1,
                                );
                              }}
                              className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                            />
                          </SettingsRow>
                          <div className="rounded border border-cyan-500/30 bg-slate-800/60 px-3 py-2 text-[11px] text-slate-200 leading-relaxed">
                            Scale applies to N/E only and keeps the shared reference point fixed.
                          </div>
                        </div>
                      </div>
                      {adjustedPointsTransformDraftValidationMessage && (
                        <div className="rounded border border-amber-500/60 bg-amber-900/20 px-3 py-2 text-[11px] text-amber-100">
                          {adjustedPointsTransformDraftValidationMessage}
                        </div>
                      )}
                      {adjustedPointsDraftStationIds.length === 0 && (
                        <div className="rounded border border-slate-500/60 bg-slate-800/60 px-3 py-2 text-[11px] text-slate-300">
                          Run adjustment to populate station choices for transform reference and
                          scope.
                        </div>
                      )}
                    </div>
                  </SettingsCard>
                  <SettingsCard
                    title="Output Visibility"
                    tooltip="Shared output toggles that affect exported text/XML deliverables."
                  >
                    <SettingsRow
                      label="Show Lost Stations in Output"
                      tooltip={SETTINGS_TOOLTIPS.listingShowLostStations}
                      className="md:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <SettingsToggle
                        title={SETTINGS_TOOLTIPS.listingShowLostStations}
                        checked={settingsDraft.listingShowLostStations}
                        onChange={(checked) =>
                          handleDraftSetting('listingShowLostStations', checked)
                        }
                      />
                    </SettingsRow>
                    <div className="rounded-md border border-slate-400/60 bg-slate-700/20 px-3 py-2 text-[11px] text-slate-200 leading-relaxed">
                      Listing-specific section visibility and sort controls still live in the
                      <span className="font-semibold"> Listing File </span>
                      tab. This tab is for high-level export target and shared output behavior.
                    </div>
                  </SettingsCard>
                </div>
              )}

              {activeOptionsTab === 'special' && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <SettingsCard
                    title="Observation Interpretation"
                    tooltip={PROJECT_OPTION_SECTION_TOOLTIPS['Observation Interpretation']}
                  >
                    <SettingsRow label="A-Record Mode" tooltip={SETTINGS_TOOLTIPS.angleMode}>
                      <select
                        title={SETTINGS_TOOLTIPS.angleMode}
                        value={parseSettingsDraft.angleMode}
                        onChange={(e) =>
                          handleDraftParseSetting('angleMode', e.target.value as AngleMode)
                        }
                        className={optionInputClass}
                      >
                        <option value="auto">AUTO</option>
                        <option value="angle">ANGLE</option>
                        <option value="dir">DIR</option>
                      </select>
                    </SettingsRow>
                    <SettingsRow
                      label="Description Reconcile Mode"
                      tooltip={SETTINGS_TOOLTIPS.descriptionReconcileMode}
                    >
                      <select
                        title={SETTINGS_TOOLTIPS.descriptionReconcileMode}
                        value={parseSettingsDraft.descriptionReconcileMode}
                        onChange={(e) =>
                          handleDraftParseSetting(
                            'descriptionReconcileMode',
                            e.target.value as ParseSettings['descriptionReconcileMode'],
                          )
                        }
                        className={optionInputClass}
                      >
                        <option value="first">FIRST</option>
                        <option value="append">APPEND</option>
                      </select>
                    </SettingsRow>
                    <SettingsRow
                      label="Description Append Delimiter"
                      tooltip={SETTINGS_TOOLTIPS.descriptionAppendDelimiter}
                    >
                      <input
                        title={SETTINGS_TOOLTIPS.descriptionAppendDelimiter}
                        type="text"
                        value={parseSettingsDraft.descriptionAppendDelimiter}
                        disabled={parseSettingsDraft.descriptionReconcileMode !== 'append'}
                        onChange={(e) =>
                          handleDraftParseSetting(
                            'descriptionAppendDelimiter',
                            e.target.value.length > 0 ? e.target.value : ' | ',
                          )
                        }
                        className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                      />
                    </SettingsRow>
                  </SettingsCard>
                  <SettingsCard
                    title="Profile Note"
                    tooltip="Run-profile constraints and interpretation notes for parity mode."
                  >
                    <div className="text-xs text-slate-200 leading-relaxed">
                      Industry Standard parity profile forces classical solving and raw
                      direction-set processing with industry default instrument fallback.
                    </div>
                  </SettingsCard>
                </div>
              )}

              {activeOptionsTab === 'gps' && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <SettingsCard
                    title="Coordinate System (Canada-First)"
                    tooltip={PROJECT_OPTION_SECTION_TOOLTIPS['CRS / Geodetic Setup']}
                  >
                    <SettingsRow
                      label="Coord System Mode"
                      tooltip={SETTINGS_TOOLTIPS.coordSystemMode}
                    >
                      <select
                        title={SETTINGS_TOOLTIPS.coordSystemMode}
                        value={parseSettingsDraft.coordSystemMode}
                        onChange={(e) =>
                          handleDraftParseSetting(
                            'coordSystemMode',
                            e.target.value as CoordSystemMode,
                          )
                        }
                        className={optionInputClass}
                      >
                        <option value="local">LOCAL</option>
                        <option value="grid">GRID</option>
                      </select>
                    </SettingsRow>
                    <SettingsRow
                      label="CRS Catalog Group"
                      tooltip={SETTINGS_TOOLTIPS.crsCatalogGroup}
                    >
                      <select
                        title={SETTINGS_TOOLTIPS.crsCatalogGroup}
                        value={crsCatalogGroupFilter}
                        onChange={(e) =>
                          setCrsCatalogGroupFilter(e.target.value as CrsCatalogGroupFilter)
                        }
                        className={optionInputClass}
                      >
                        {CRS_CATALOG_GROUP_OPTIONS.map((group) => {
                          const count = crsCatalogGroupCounts[group.id] ?? 0;
                          const disabled = group.id !== 'all' && count === 0;
                          return (
                            <option key={group.id} value={group.id} disabled={disabled}>
                              {group.label} ({count})
                            </option>
                          );
                        })}
                      </select>
                    </SettingsRow>
                    <SettingsRow label="CRS Search">
                      <input
                        type="text"
                        value={crsSearchQuery}
                        onChange={(e) => setCrsSearchQuery(e.target.value)}
                        placeholder="Filter by ID, label, or EPSG"
                        className={optionInputClass}
                      />
                    </SettingsRow>
                    <SettingsRow label="CRS (Grid Mode)" tooltip={SETTINGS_TOOLTIPS.crsId}>
                      <select
                        title={SETTINGS_TOOLTIPS.crsId}
                        value={parseSettingsDraft.crsId}
                        disabled={parseSettingsDraft.coordSystemMode !== 'grid'}
                        onChange={(e) => handleDraftParseSetting('crsId', e.target.value)}
                        className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        {visibleDraftCrsCatalog.map((crs) => (
                          <option key={crs.id} value={crs.id}>
                            {crs.id} - {crs.label}
                          </option>
                        ))}
                      </select>
                    </SettingsRow>
                    {filteredDraftCrsCatalog.length === 0 && (
                      <div className="rounded border border-amber-300/50 bg-amber-900/20 px-2 py-1 text-[10px] text-amber-100">
                        No CRS entries are loaded for this catalog group yet.
                      </div>
                    )}
                    {filteredDraftCrsCatalog.length > 0 && searchedDraftCrsCatalog.length === 0 && (
                      <div className="rounded border border-amber-300/50 bg-amber-900/20 px-2 py-1 text-[10px] text-amber-100">
                        Search filter returned no CRS rows in this catalog group.
                      </div>
                    )}
                    <div className="rounded-md border border-slate-400/60 bg-slate-700/20 px-3 py-2 text-[11px] text-slate-200 leading-relaxed space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="uppercase tracking-wide text-slate-100">CRS Details</div>
                        <button
                          type="button"
                          title={SETTINGS_TOOLTIPS.crsProjectionParameters}
                          onClick={() => setShowCrsProjectionParams((prev) => !prev)}
                          className="inline-flex items-center gap-1 rounded border border-slate-300/60 bg-slate-700/30 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-100 hover:bg-slate-600/40"
                        >
                          <Info className="h-3.5 w-3.5" />
                          {showCrsProjectionParams ? 'Hide Params' : 'Show Params'}
                        </button>
                      </div>
                      <div>ID: {selectedDraftCrs?.id ?? parseSettingsDraft.crsId}</div>
                      <div>EPSG: {selectedDraftCrs?.epsgCode ?? '-'}</div>
                      <div>
                        Catalog Group:{' '}
                        {selectedDraftCrs?.catalogGroup
                          ?.replace('canada-', 'Canada ')
                          .replace('global', 'Global')
                          .toUpperCase() ?? '-'}
                      </div>
                      <div>Datum: {selectedDraftCrs?.datum ?? '-'}</div>
                      <div>
                        Projection:{' '}
                        {selectedDraftCrs?.projectionFamily?.toUpperCase().replaceAll('-', ' ') ??
                          '-'}
                        {selectedDraftCrs?.zoneNumber != null
                          ? ` (zone ${selectedDraftCrs.zoneNumber})`
                          : ''}
                      </div>
                      <div>
                        Axis/Unit: {selectedDraftCrs?.axisOrder ?? '-'} /{' '}
                        {selectedDraftCrs?.linearUnit ?? '-'}
                      </div>
                      <div>Area of Use: {selectedDraftCrs?.areaOfUse ?? '-'}</div>
                      <div>
                        Datum Op: {selectedDraftCrs?.supportedDatumOps.primary ?? '-'}
                        {selectedDraftCrs?.supportedDatumOps.fallbacks?.length
                          ? ` (fallbacks=${selectedDraftCrs.supportedDatumOps.fallbacks.length})`
                          : ''}
                      </div>
                      <div>
                        Area Bounds:{' '}
                        {selectedDraftCrs?.areaOfUseBounds
                          ? `lat ${selectedDraftCrs.areaOfUseBounds.minLatDeg.toFixed(3)}..${selectedDraftCrs.areaOfUseBounds.maxLatDeg.toFixed(3)}, lon ${selectedDraftCrs.areaOfUseBounds.minLonDeg.toFixed(3)}..${selectedDraftCrs.areaOfUseBounds.maxLonDeg.toFixed(3)}`
                          : '-'}
                      </div>
                      {showCrsProjectionParams && (
                        <div className="mt-2 space-y-2 rounded border border-slate-300/40 bg-slate-800/30 p-2">
                          <div className="uppercase tracking-wide text-slate-100">
                            Projection Parameters
                          </div>
                          <div className="break-all rounded bg-slate-900/50 px-2 py-1 font-mono text-[10px] leading-relaxed text-slate-100">
                            {selectedDraftCrs?.proj4 ?? '-'}
                          </div>
                          <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] text-slate-100">
                            {selectedCrsProj4Params.map((row) => (
                              <React.Fragment key={row.key}>
                                <span className="text-slate-300">{row.key}</span>
                                <span className="break-all">{row.value}</span>
                              </React.Fragment>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    {parseSettingsDraft.coordSystemMode === 'grid' &&
                      runDiagnostics?.crsAreaOfUseStatus === 'outside' && (
                        <div className="rounded border border-amber-300/60 bg-amber-900/30 px-2 py-1 text-[10px] text-amber-100">
                          Area-of-use warning: last run flagged{' '}
                          {runDiagnostics.crsOutOfAreaStationCount} station(s) outside CRS bounds
                          (warning-only).
                        </div>
                      )}
                    {runDiagnostics?.datumSufficiencyReport &&
                      runDiagnostics.datumSufficiencyReport.status !== 'ok' && (
                        <div
                          className={`rounded px-2 py-1 text-[10px] ${
                            runDiagnostics.datumSufficiencyReport.status === 'hard-fail'
                              ? 'border border-red-300/70 bg-red-900/35 text-red-100'
                              : 'border border-amber-300/60 bg-amber-900/30 text-amber-100'
                          }`}
                        >
                          Datum sufficiency (
                          {runDiagnostics.datumSufficiencyReport.status.toUpperCase()}
                          ):{' '}
                          {runDiagnostics.datumSufficiencyReport.reasons[0] ??
                            'review run diagnostics'}
                          .
                        </div>
                      )}
                    <SettingsRow
                      label="Local Datum Scheme"
                      tooltip={SETTINGS_TOOLTIPS.localDatumScheme}
                    >
                      <select
                        title={SETTINGS_TOOLTIPS.localDatumScheme}
                        value={parseSettingsDraft.localDatumScheme}
                        disabled={parseSettingsDraft.coordSystemMode !== 'local'}
                        onChange={(e) =>
                          handleDraftParseSetting(
                            'localDatumScheme',
                            e.target.value as LocalDatumScheme,
                          )
                        }
                        className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        <option value="average-scale">Average Scale Factor</option>
                        <option value="common-elevation">Common Elevation</option>
                      </select>
                    </SettingsRow>
                    <SettingsRow
                      label="Average Scale Factor"
                      tooltip={SETTINGS_TOOLTIPS.averageScaleFactor}
                    >
                      <input
                        title={SETTINGS_TOOLTIPS.averageScaleFactor}
                        type="number"
                        min={0.000001}
                        step={0.00000001}
                        value={parseSettingsDraft.averageScaleFactor}
                        disabled={
                          parseSettingsDraft.coordSystemMode !== 'local' ||
                          parseSettingsDraft.localDatumScheme !== 'average-scale'
                        }
                        onChange={(e) => {
                          const parsed = Number.parseFloat(e.target.value);
                          handleDraftParseSetting(
                            'averageScaleFactor',
                            Number.isFinite(parsed) && parsed > 0 ? parsed : 1,
                          );
                        }}
                        className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                      />
                    </SettingsRow>
                    <SettingsRow
                      label={`Common Elevation (${settingsDraft.units === 'ft' ? 'ft' : 'm'})`}
                      tooltip={SETTINGS_TOOLTIPS.commonElevation}
                    >
                      <input
                        title={SETTINGS_TOOLTIPS.commonElevation}
                        type="number"
                        step={0.001}
                        value={
                          settingsDraft.units === 'ft'
                            ? parseSettingsDraft.commonElevation * FT_PER_M
                            : parseSettingsDraft.commonElevation
                        }
                        disabled={
                          parseSettingsDraft.coordSystemMode !== 'local' ||
                          parseSettingsDraft.localDatumScheme !== 'common-elevation'
                        }
                        onChange={(e) => {
                          const parsed = Number.parseFloat(e.target.value);
                          const meters = Number.isFinite(parsed)
                            ? settingsDraft.units === 'ft'
                              ? parsed * M_PER_FT
                              : parsed
                            : 0;
                          handleDraftParseSetting('commonElevation', meters);
                        }}
                        className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                      />
                    </SettingsRow>
                    <SettingsRow
                      label={`Average Geoid Height (${settingsDraft.units === 'ft' ? 'ft' : 'm'})`}
                      tooltip={SETTINGS_TOOLTIPS.averageGeoidHeight}
                    >
                      <input
                        title={SETTINGS_TOOLTIPS.averageGeoidHeight}
                        type="number"
                        step={0.001}
                        value={
                          settingsDraft.units === 'ft'
                            ? parseSettingsDraft.averageGeoidHeight * FT_PER_M
                            : parseSettingsDraft.averageGeoidHeight
                        }
                        onChange={(e) => {
                          const parsed = Number.parseFloat(e.target.value);
                          const meters = Number.isFinite(parsed)
                            ? settingsDraft.units === 'ft'
                              ? parsed * M_PER_FT
                              : parsed
                            : 0;
                          handleDraftParseSetting('averageGeoidHeight', meters);
                        }}
                        className={optionInputClass}
                      />
                    </SettingsRow>
                    <div className="rounded-md border border-slate-400/60 bg-slate-700/20 px-3 py-2 text-[11px] text-slate-200 leading-relaxed space-y-2">
                      <div className="uppercase tracking-wide text-slate-100">
                        Observation Input Mode (.MEASURED / .GRID)
                      </div>
                      <div className="grid gap-2">
                        <SettingsRow
                          label="Bearing/Azimuth Mode"
                          tooltip={SETTINGS_TOOLTIPS.gridBearingMode}
                        >
                          <select
                            title={SETTINGS_TOOLTIPS.gridBearingMode}
                            value={parseSettingsDraft.gridBearingMode}
                            disabled={parseSettingsDraft.coordSystemMode !== 'grid'}
                            onChange={(e) =>
                              handleDraftParseSetting(
                                'gridBearingMode',
                                e.target.value as GridObservationMode,
                              )
                            }
                            className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                          >
                            <option value="measured">MEASURED</option>
                            <option value="grid">GRID</option>
                          </select>
                        </SettingsRow>
                        <SettingsRow
                          label="Distance Mode"
                          tooltip={SETTINGS_TOOLTIPS.gridDistanceMode}
                        >
                          <select
                            title={SETTINGS_TOOLTIPS.gridDistanceMode}
                            value={parseSettingsDraft.gridDistanceMode}
                            disabled={parseSettingsDraft.coordSystemMode !== 'grid'}
                            onChange={(e) =>
                              handleDraftParseSetting(
                                'gridDistanceMode',
                                e.target.value as GridDistanceInputMode,
                              )
                            }
                            className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                          >
                            <option value="measured">MEASURED (Ground)</option>
                            <option value="grid">GRID</option>
                            <option value="ellipsoidal">ELLIPSOIDAL</option>
                          </select>
                        </SettingsRow>
                        <SettingsRow label="Angle Mode" tooltip={SETTINGS_TOOLTIPS.gridAngleMode}>
                          <select
                            title={SETTINGS_TOOLTIPS.gridAngleMode}
                            value={parseSettingsDraft.gridAngleMode}
                            disabled={parseSettingsDraft.coordSystemMode !== 'grid'}
                            onChange={(e) =>
                              handleDraftParseSetting(
                                'gridAngleMode',
                                e.target.value as GridObservationMode,
                              )
                            }
                            className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                          >
                            <option value="measured">MEASURED</option>
                            <option value="grid">GRID</option>
                          </select>
                        </SettingsRow>
                        <SettingsRow
                          label="Direction Mode"
                          tooltip={SETTINGS_TOOLTIPS.gridDirectionMode}
                        >
                          <select
                            title={SETTINGS_TOOLTIPS.gridDirectionMode}
                            value={parseSettingsDraft.gridDirectionMode}
                            disabled={parseSettingsDraft.coordSystemMode !== 'grid'}
                            onChange={(e) =>
                              handleDraftParseSetting(
                                'gridDirectionMode',
                                e.target.value as GridObservationMode,
                              )
                            }
                            className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                          >
                            <option value="measured">MEASURED</option>
                            <option value="grid">GRID</option>
                          </select>
                        </SettingsRow>
                      </div>
                    </div>
                  </SettingsCard>

                  <SettingsCard
                    title="Advanced CRS/GPS/Height"
                    tooltip={PROJECT_OPTION_SECTION_TOOLTIPS['GPS Loop Check']}
                  >
                    <SettingsRow
                      label="CRS Transforms (Legacy)"
                      tooltip={SETTINGS_TOOLTIPS.crsTransformEnabled}
                      className="md:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <SettingsToggle
                        title={SETTINGS_TOOLTIPS.crsTransformEnabled}
                        checked={parseSettingsDraft.crsTransformEnabled}
                        onChange={(checked) =>
                          handleDraftParseSetting('crsTransformEnabled', checked)
                        }
                      />
                    </SettingsRow>
                    <SettingsRow
                      label="Projection Model (Legacy)"
                      tooltip={SETTINGS_TOOLTIPS.crsProjectionModel}
                    >
                      <select
                        title={SETTINGS_TOOLTIPS.crsProjectionModel}
                        value={parseSettingsDraft.crsProjectionModel}
                        disabled={!parseSettingsDraft.crsTransformEnabled}
                        onChange={(e) =>
                          handleDraftParseSetting(
                            'crsProjectionModel',
                            e.target.value as CrsProjectionModel,
                          )
                        }
                        className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        <option value="legacy-equirectangular">
                          LEGACY Local (Equirectangular)
                        </option>
                        <option value="local-enu">Local ENU (Tangent Plane)</option>
                      </select>
                    </SettingsRow>
                    <SettingsRow label="CRS Label (Legacy)" tooltip={SETTINGS_TOOLTIPS.crsLabel}>
                      <input
                        title={SETTINGS_TOOLTIPS.crsLabel}
                        type="text"
                        value={parseSettingsDraft.crsLabel}
                        onChange={(e) => handleDraftParseSetting('crsLabel', e.target.value)}
                        className={optionInputClass}
                      />
                    </SettingsRow>
                    <SettingsRow
                      label="Grid-Ground Scale Override"
                      tooltip={SETTINGS_TOOLTIPS.crsGridScaleEnabled}
                      className="md:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <SettingsToggle
                        title={SETTINGS_TOOLTIPS.crsGridScaleEnabled}
                        checked={parseSettingsDraft.crsGridScaleEnabled}
                        onChange={(checked) =>
                          handleDraftParseSetting('crsGridScaleEnabled', checked)
                        }
                      />
                    </SettingsRow>
                    <SettingsRow
                      label="Grid Scale Factor Override"
                      tooltip={SETTINGS_TOOLTIPS.crsGridScaleFactor}
                    >
                      <input
                        title={SETTINGS_TOOLTIPS.crsGridScaleFactor}
                        type="number"
                        min={0.000001}
                        step={0.00000001}
                        value={parseSettingsDraft.crsGridScaleFactor}
                        disabled={!parseSettingsDraft.crsGridScaleEnabled}
                        onChange={(e) => {
                          const parsed = Number.parseFloat(e.target.value);
                          handleDraftParseSetting(
                            'crsGridScaleFactor',
                            Number.isFinite(parsed) && parsed > 0 ? parsed : 1,
                          );
                        }}
                        className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                      />
                    </SettingsRow>
                    <SettingsRow
                      label="Convergence Override"
                      tooltip={SETTINGS_TOOLTIPS.crsConvergenceEnabled}
                      className="md:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <SettingsToggle
                        title={SETTINGS_TOOLTIPS.crsConvergenceEnabled}
                        checked={parseSettingsDraft.crsConvergenceEnabled}
                        onChange={(checked) =>
                          handleDraftParseSetting('crsConvergenceEnabled', checked)
                        }
                      />
                    </SettingsRow>
                    <SettingsRow
                      label="Convergence Angle Override (deg)"
                      tooltip={SETTINGS_TOOLTIPS.crsConvergenceAngle}
                    >
                      <input
                        title={SETTINGS_TOOLTIPS.crsConvergenceAngle}
                        type="number"
                        step={0.000001}
                        value={(parseSettingsDraft.crsConvergenceAngleRad * RAD_TO_DEG).toFixed(6)}
                        disabled={!parseSettingsDraft.crsConvergenceEnabled}
                        onChange={(e) => {
                          const parsed = Number.parseFloat(e.target.value);
                          handleDraftParseSetting(
                            'crsConvergenceAngleRad',
                            Number.isFinite(parsed) ? parsed / RAD_TO_DEG : 0,
                          );
                        }}
                        className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                      />
                    </SettingsRow>
                    <SettingsRow
                      label="GPS Loop Check"
                      tooltip={SETTINGS_TOOLTIPS.gpsLoopCheckEnabled}
                      className="md:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <SettingsToggle
                        title={SETTINGS_TOOLTIPS.gpsLoopCheckEnabled}
                        checked={parseSettingsDraft.gpsLoopCheckEnabled}
                        onChange={(checked) =>
                          handleDraftParseSetting('gpsLoopCheckEnabled', checked)
                        }
                      />
                    </SettingsRow>
                    <SettingsRow
                      label="GPS AddHiHt"
                      tooltip={SETTINGS_TOOLTIPS.gpsAddHiHtEnabled}
                      className="md:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <SettingsToggle
                        title={SETTINGS_TOOLTIPS.gpsAddHiHtEnabled}
                        checked={parseSettingsDraft.gpsAddHiHtEnabled}
                        onChange={(checked) =>
                          handleDraftParseSetting('gpsAddHiHtEnabled', checked)
                        }
                      />
                    </SettingsRow>
                    <SettingsRow
                      label={`GPS AddHiHt HI (${settingsDraft.units === 'ft' ? 'ft' : 'm'})`}
                      tooltip={SETTINGS_TOOLTIPS.gpsAddHiHtHi}
                    >
                      <input
                        title={SETTINGS_TOOLTIPS.gpsAddHiHtHi}
                        type="number"
                        step={0.0001}
                        value={
                          settingsDraft.units === 'ft'
                            ? parseSettingsDraft.gpsAddHiHtHiM * FT_PER_M
                            : parseSettingsDraft.gpsAddHiHtHiM
                        }
                        disabled={!parseSettingsDraft.gpsAddHiHtEnabled}
                        onChange={(e) => {
                          const parsed = Number.parseFloat(e.target.value);
                          const meters = Number.isFinite(parsed)
                            ? settingsDraft.units === 'ft'
                              ? parsed * M_PER_FT
                              : parsed
                            : 0;
                          handleDraftParseSetting('gpsAddHiHtHiM', meters);
                        }}
                        className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                      />
                    </SettingsRow>
                    <SettingsRow
                      label={`GPS AddHiHt HT (${settingsDraft.units === 'ft' ? 'ft' : 'm'})`}
                      tooltip={SETTINGS_TOOLTIPS.gpsAddHiHtHt}
                    >
                      <input
                        title={SETTINGS_TOOLTIPS.gpsAddHiHtHt}
                        type="number"
                        step={0.0001}
                        value={
                          settingsDraft.units === 'ft'
                            ? parseSettingsDraft.gpsAddHiHtHtM * FT_PER_M
                            : parseSettingsDraft.gpsAddHiHtHtM
                        }
                        disabled={!parseSettingsDraft.gpsAddHiHtEnabled}
                        onChange={(e) => {
                          const parsed = Number.parseFloat(e.target.value);
                          const meters = Number.isFinite(parsed)
                            ? settingsDraft.units === 'ft'
                              ? parsed * M_PER_FT
                              : parsed
                            : 0;
                          handleDraftParseSetting('gpsAddHiHtHtM', meters);
                        }}
                        className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                      />
                    </SettingsRow>
                    <SettingsRow
                      label="GNSS Vector Frame Default"
                      tooltip={SETTINGS_TOOLTIPS.gnssVectorFrameDefault}
                    >
                      <select
                        title={SETTINGS_TOOLTIPS.gnssVectorFrameDefault}
                        value={parseSettingsDraft.gnssVectorFrameDefault}
                        onChange={(e) =>
                          handleDraftParseSetting(
                            'gnssVectorFrameDefault',
                            e.target.value as GnssVectorFrame,
                          )
                        }
                        className={optionInputClass}
                      >
                        <option value="gridNEU">GRID NEU</option>
                        <option value="enuLocal">ENU Local</option>
                        <option value="ecefDelta">ECEF Delta</option>
                        <option value="llhBaseline">LLH Baseline</option>
                        <option value="unknown">Unknown</option>
                      </select>
                    </SettingsRow>
                    <SettingsRow
                      label="Confirm Unknown GNSS Frames"
                      tooltip={SETTINGS_TOOLTIPS.gnssFrameConfirmed}
                      className="md:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <SettingsToggle
                        title={SETTINGS_TOOLTIPS.gnssFrameConfirmed}
                        checked={parseSettingsDraft.gnssFrameConfirmed}
                        onChange={(checked) =>
                          handleDraftParseSetting('gnssFrameConfirmed', checked)
                        }
                      />
                    </SettingsRow>
                    <SettingsRow
                      label="Geoid/Grid Model"
                      tooltip={SETTINGS_TOOLTIPS.geoidModelEnabled}
                      className="md:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <SettingsToggle
                        title={SETTINGS_TOOLTIPS.geoidModelEnabled}
                        checked={parseSettingsDraft.geoidModelEnabled}
                        onChange={(checked) =>
                          handleDraftParseSetting('geoidModelEnabled', checked)
                        }
                      />
                    </SettingsRow>
                    <SettingsRow
                      label="Geoid/Grid Model ID"
                      tooltip={SETTINGS_TOOLTIPS.geoidModelId}
                    >
                      <div className="flex flex-col gap-1">
                        <input
                          title={SETTINGS_TOOLTIPS.geoidModelId}
                          type="text"
                          list="builtin-geoid-model-options"
                          value={parseSettingsDraft.geoidModelId}
                          disabled={!parseSettingsDraft.geoidModelEnabled}
                          onChange={(e) =>
                            handleDraftParseSetting(
                              'geoidModelId',
                              (e.target.value || 'NGS-DEMO').toUpperCase(),
                            )
                          }
                          className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                        />
                        <datalist id="builtin-geoid-model-options">
                          {BUILTIN_GEOID_MODEL_OPTIONS.map((row) => (
                            <option key={row.id} value={row.id}>
                              {row.label}
                            </option>
                          ))}
                        </datalist>
                        <span className="text-[11px] text-slate-300">
                          Common presets include <strong>NAD83-CSRS-DEMO</strong> for Canada-first
                          workflows.
                        </span>
                      </div>
                    </SettingsRow>
                    <SettingsRow
                      label="Geoid Source Format"
                      tooltip={SETTINGS_TOOLTIPS.geoidSourceFormat}
                    >
                      <select
                        title={SETTINGS_TOOLTIPS.geoidSourceFormat}
                        value={parseSettingsDraft.geoidSourceFormat}
                        disabled={!parseSettingsDraft.geoidModelEnabled}
                        onChange={(e) =>
                          handleDraftParseSetting(
                            'geoidSourceFormat',
                            e.target.value as GeoidSourceFormat,
                          )
                        }
                        className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        <option value="builtin">BUILTIN</option>
                        <option value="gtx">GTX</option>
                        <option value="byn">BYN</option>
                      </select>
                    </SettingsRow>
                    <SettingsRow
                      label="Geoid Source Path"
                      tooltip={SETTINGS_TOOLTIPS.geoidSourcePath}
                    >
                      <input
                        title={SETTINGS_TOOLTIPS.geoidSourcePath}
                        type="text"
                        value={parseSettingsDraft.geoidSourcePath}
                        disabled={
                          !parseSettingsDraft.geoidModelEnabled ||
                          parseSettingsDraft.geoidSourceFormat === 'builtin'
                        }
                        onChange={(e) => handleDraftParseSetting('geoidSourcePath', e.target.value)}
                        placeholder="C:\\path\\model.gtx or /path/model.byn"
                        className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                      />
                    </SettingsRow>
                    <SettingsRow
                      label="Geoid Source File"
                      tooltip={SETTINGS_TOOLTIPS.geoidSourceFile}
                    >
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            title={SETTINGS_TOOLTIPS.geoidSourceFile}
                            disabled={
                              !parseSettingsDraft.geoidModelEnabled ||
                              parseSettingsDraft.geoidSourceFormat === 'builtin'
                            }
                            onClick={handleGeoidSourceFilePick}
                            className="rounded border border-slate-400/70 bg-slate-700/30 px-2 py-1 text-xs text-slate-100 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-700/45"
                          >
                            Load GTX/BYN File
                          </button>
                          <button
                            type="button"
                            disabled={
                              !parseSettingsDraft.geoidModelEnabled ||
                              parseSettingsDraft.geoidSourceFormat === 'builtin' ||
                              geoidSourceDataDraft == null
                            }
                            onClick={clearDraftGeoidSourceData}
                            className="rounded border border-slate-500/70 bg-slate-700/20 px-2 py-1 text-xs text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-700/35"
                          >
                            Clear File Bytes
                          </button>
                        </div>
                        <input
                          ref={geoidSourceFileInputRef}
                          type="file"
                          accept=".gtx,.byn,application/octet-stream"
                          className="hidden"
                          onChange={handleGeoidSourceFileChange}
                        />
                        <span className="text-[11px] text-slate-300">
                          {geoidSourceDataDraft
                            ? `Loaded: ${geoidSourceDataLabelDraft}`
                            : 'No browser-loaded geoid file bytes.'}
                        </span>
                      </div>
                    </SettingsRow>
                    <SettingsRow
                      label="Geoid Interpolation"
                      tooltip={SETTINGS_TOOLTIPS.geoidInterpolation}
                    >
                      <select
                        title={SETTINGS_TOOLTIPS.geoidInterpolation}
                        value={parseSettingsDraft.geoidInterpolation}
                        disabled={!parseSettingsDraft.geoidModelEnabled}
                        onChange={(e) =>
                          handleDraftParseSetting(
                            'geoidInterpolation',
                            e.target.value as GeoidInterpolationMethod,
                          )
                        }
                        className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        <option value="bilinear">BILINEAR</option>
                        <option value="nearest">NEAREST</option>
                      </select>
                    </SettingsRow>
                    <SettingsRow
                      label="Geoid Height Conversion"
                      tooltip={SETTINGS_TOOLTIPS.geoidHeightConversionEnabled}
                      className="md:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <SettingsToggle
                        title={SETTINGS_TOOLTIPS.geoidHeightConversionEnabled}
                        checked={parseSettingsDraft.geoidHeightConversionEnabled}
                        disabled={!parseSettingsDraft.geoidModelEnabled}
                        onChange={(checked) =>
                          handleDraftParseSetting('geoidHeightConversionEnabled', checked)
                        }
                      />
                    </SettingsRow>
                    <SettingsRow
                      label="Geoid Output Height Datum"
                      tooltip={SETTINGS_TOOLTIPS.geoidOutputHeightDatum}
                    >
                      <select
                        title={SETTINGS_TOOLTIPS.geoidOutputHeightDatum}
                        value={parseSettingsDraft.geoidOutputHeightDatum}
                        disabled={
                          !parseSettingsDraft.geoidModelEnabled ||
                          !parseSettingsDraft.geoidHeightConversionEnabled
                        }
                        onChange={(e) =>
                          handleDraftParseSetting(
                            'geoidOutputHeightDatum',
                            e.target.value as GeoidHeightDatum,
                          )
                        }
                        className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        <option value="orthometric">ORTHOMETRIC</option>
                        <option value="ellipsoid">ELLIPSOID</option>
                      </select>
                    </SettingsRow>
                    <div className="rounded-md border border-slate-400/60 bg-slate-700/20 px-3 py-2 text-[11px] text-slate-200 leading-relaxed space-y-2">
                      <div>
                        Canada-first grid workflows use the Coordinate System settings in the left
                        card. Advanced overrides here are optional compatibility controls and remain
                        <strong> OFF</strong> unless explicitly enabled.
                      </div>
                    </div>
                  </SettingsCard>
                </div>
              )}

              {activeOptionsTab === 'modeling' && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <SettingsCard
                    title="TS Correlation"
                    tooltip={PROJECT_OPTION_SECTION_TOOLTIPS['TS Correlation']}
                  >
                    <SettingsRow
                      label="Enable Correlation"
                      tooltip={SETTINGS_TOOLTIPS.tsCorrelation}
                      className="md:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <SettingsToggle
                        title={SETTINGS_TOOLTIPS.tsCorrelation}
                        checked={parseSettingsDraft.tsCorrelationEnabled}
                        disabled={parityProfileActive}
                        onChange={(checked) =>
                          handleDraftParseSetting('tsCorrelationEnabled', checked)
                        }
                      />
                    </SettingsRow>
                    <SettingsRow
                      label="Correlation Scope"
                      tooltip={SETTINGS_TOOLTIPS.tsCorrelationScope}
                    >
                      <select
                        title={SETTINGS_TOOLTIPS.tsCorrelationScope}
                        value={parseSettingsDraft.tsCorrelationScope}
                        disabled={parityProfileActive || parseSettingsDraft.preanalysisMode}
                        onChange={(e) =>
                          handleDraftParseSetting(
                            'tsCorrelationScope',
                            e.target.value as TsCorrelationScope,
                          )
                        }
                        className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        <option value="set">SET</option>
                        <option value="setup">SETUP</option>
                      </select>
                    </SettingsRow>
                    <SettingsRow label="Correlation ρ" tooltip={SETTINGS_TOOLTIPS.tsCorrelationRho}>
                      <input
                        title={SETTINGS_TOOLTIPS.tsCorrelationRho}
                        type="number"
                        min={0}
                        max={0.95}
                        step={0.01}
                        value={parseSettingsDraft.tsCorrelationRho}
                        disabled={parityProfileActive || parseSettingsDraft.preanalysisMode}
                        onChange={(e) =>
                          handleDraftParseSetting(
                            'tsCorrelationRho',
                            Number.isFinite(parseFloat(e.target.value))
                              ? Math.max(0, Math.min(0.95, parseFloat(e.target.value)))
                              : 0.25,
                          )
                        }
                        className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                      />
                    </SettingsRow>
                  </SettingsCard>

                  <SettingsCard
                    title="Robust Model"
                    tooltip={PROJECT_OPTION_SECTION_TOOLTIPS['Robust Model']}
                  >
                    <SettingsRow label="Robust Mode" tooltip={SETTINGS_TOOLTIPS.robustMode}>
                      <select
                        title={SETTINGS_TOOLTIPS.robustMode}
                        value={parseSettingsDraft.robustMode}
                        onChange={(e) =>
                          handleDraftParseSetting('robustMode', e.target.value as RobustMode)
                        }
                        disabled={parityProfileActive}
                        className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        <option value="none">OFF</option>
                        <option value="huber">Huber</option>
                      </select>
                    </SettingsRow>
                    <SettingsRow label="Robust k" tooltip={SETTINGS_TOOLTIPS.robustK}>
                      <input
                        title={SETTINGS_TOOLTIPS.robustK}
                        type="number"
                        min={0.5}
                        max={10}
                        step={0.1}
                        value={parseSettingsDraft.robustK}
                        onChange={(e) =>
                          handleDraftParseSetting(
                            'robustK',
                            Number.isFinite(parseFloat(e.target.value))
                              ? Math.max(0.5, Math.min(10, parseFloat(e.target.value)))
                              : 1.5,
                          )
                        }
                        disabled={parityProfileActive}
                        className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                      />
                    </SettingsRow>
                  </SettingsCard>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-400 bg-slate-600 px-4 py-3">
              <button
                type="button"
                onClick={closeProjectOptions}
                className="px-4 py-1 text-xs border border-slate-300 bg-slate-500 hover:bg-slate-400"
                title="Close Project Options and discard any unsaved draft changes."
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={applyProjectOptions}
                className="px-4 py-1 text-xs border border-slate-100 bg-slate-700 hover:bg-slate-800"
                title="Apply the current Project Options draft to the active project."
              >
                Apply
              </button>
            </div>
          </div>
        </div>
  );
};

export default ProjectOptionsModal;
