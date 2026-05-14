import React from 'react';
import type { ParseSettings } from '../../../appStateTypes';
import type {
  CoordMode,
  DeltaMode,
  GridDistanceInputMode,
  GridObservationMode,
  LocalDatumScheme,
  OrderMode,
  RunMode,
} from '../../../types';
import type { ProjectOptionsModalContext } from '../../../hooks/useProjectOptionsModalController';

type AdjustmentProjectOptionsTabProps = {
  context: ProjectOptionsModalContext;
};

const AdjustmentProjectOptionsTab: React.FC<AdjustmentProjectOptionsTabProps> = ({ context }) => {
  const {
    CRS_CATALOG_GROUP_OPTIONS,
    DEFAULT_QFIX_ANGULAR_SIGMA_SEC,
    DEFAULT_QFIX_LINEAR_SIGMA_M,
    FT_PER_M,
    M_PER_FT,
    PROJECT_OPTION_SECTION_TOOLTIPS,
    SETTINGS_TOOLTIPS,
    SettingsCard,
    SettingsRow,
    SettingsToggle,
    crsCatalogGroupFilter,
    crsCatalogGroupCounts,
    crsSearchQuery,
    filteredDraftCrsCatalog,
    handleDraftConvergenceLimitChange,
    handleDraftIterChange,
    handleDraftParseSetting,
    handleDraftUnitChange,
    optionInputClass,
    optionLabelClass,
    parseSettingsDraft,
    searchedDraftCrsCatalog,
    selectedCrsProj4Params,
    selectedDraftCrs,
    setCrsCatalogGroupFilter,
    setCrsSearchQuery,
    setShowCrsProjectionParams,
    settingsDraft,
    showCrsProjectionParams,
  } = context;
  const [preanalysisThresholdInput, setPreanalysisThresholdInput] = React.useState('');

  React.useEffect(() => {
    setPreanalysisThresholdInput(
      parseSettingsDraft.preanalysisAccuracyThresholdMeters == null
        ? ''
        : (
            parseSettingsDraft.preanalysisAccuracyThresholdMeters *
            (settingsDraft.units === 'ft' ? FT_PER_M : 1)
          ).toString(),
    );
  }, [
    FT_PER_M,
    parseSettingsDraft.preanalysisAccuracyThresholdMeters,
    settingsDraft.units,
  ]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <SettingsCard
          title="Solver Configuration"
          tooltip={PROJECT_OPTION_SECTION_TOOLTIPS['Adjustment Solution']}
        >
          <SettingsRow label="Run Profile" tooltip={SETTINGS_TOOLTIPS.solveProfile}>
            <div className="text-xs text-slate-100">Industry Parity</div>
          </SettingsRow>
          <SettingsRow label="Coordinate Mode" tooltip={SETTINGS_TOOLTIPS.coordMode}>
            <select
              title={SETTINGS_TOOLTIPS.coordMode}
              value={parseSettingsDraft.coordMode}
              onChange={(e) => handleDraftParseSetting('coordMode', e.target.value as CoordMode)}
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
                  onChange={(checked) => handleDraftParseSetting('autoAdjustEnabled', checked)}
                />
              </div>
              <label
                className="rounded border border-slate-400/60 bg-slate-700/20 px-2 py-2 flex flex-col gap-2 text-[11px] uppercase tracking-wide text-slate-200"
                title={SETTINGS_TOOLTIPS.suspectImpactMode}
              >
                <span>Suspect Impact</span>
                <select
                  title={SETTINGS_TOOLTIPS.suspectImpactMode}
                  value={parseSettingsDraft.suspectImpactMode}
                  onChange={(e) =>
                    handleDraftParseSetting(
                      'suspectImpactMode',
                      e.target.value as ParseSettings['suspectImpactMode'],
                    )
                  }
                  className={optionInputClass}
                >
                  <option value="auto">Auto (skip heavy jobs)</option>
                  <option value="on">On</option>
                  <option value="off">Off</option>
                </select>
              </label>
            </div>
            {parseSettingsDraft.runMode !== 'adjustment' && (
              <div className="text-[11px] text-slate-300">
                Auto-Adjust is disabled unless Run Mode is set to Adjustment.
              </div>
            )}
            {parseSettingsDraft.runMode === 'preanalysis' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className={optionLabelClass}>
                  Preanalysis Accuracy Threshold ({settingsDraft.units})
                  <input
                    title={SETTINGS_TOOLTIPS.preanalysisAccuracyThreshold}
                    type="text"
                    inputMode="decimal"
                    value={preanalysisThresholdInput}
                    onChange={(e) => {
                      const next = e.target.value.trim();
                      setPreanalysisThresholdInput(e.target.value);
                      handleDraftParseSetting(
                        'preanalysisAccuracyThresholdMeters',
                        next === ''
                          ? undefined
                          : Number.isFinite(Number.parseFloat(next))
                            ? Math.max(
                                0,
                                Number.parseFloat(next) *
                                  (settingsDraft.units === 'ft' ? M_PER_FT : 1),
                              )
                            : parseSettingsDraft.preanalysisAccuracyThresholdMeters,
                      );
                    }}
                    className={`${optionInputClass} mt-1`}
                  />
                </label>
                <label className={optionLabelClass}>
                  Preanalysis Max Added Sets
                  <input
                    title={SETTINGS_TOOLTIPS.preanalysisMaxAddedSets}
                    type="number"
                    min={1}
                    max={25}
                    step={1}
                    value={parseSettingsDraft.preanalysisMaxAddedSets}
                    onChange={(e) =>
                      handleDraftParseSetting(
                        'preanalysisMaxAddedSets',
                        Number.isFinite(Number.parseInt(e.target.value, 10))
                          ? Math.max(1, Math.min(25, Number.parseInt(e.target.value, 10)))
                          : 5,
                      )
                    }
                    className={`${optionInputClass} mt-1`}
                  />
                </label>
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
                className={`${optionInputClass} mt-1 disabled:opacity-100 disabled:cursor-not-allowed`}
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
                className={`${optionInputClass} mt-1 disabled:opacity-100 disabled:cursor-not-allowed`}
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
                className={`${optionInputClass} mt-1 disabled:opacity-100 disabled:cursor-not-allowed`}
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
              onChange={(e) => handleDraftParseSetting('order', e.target.value as OrderMode)}
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
              onChange={(e) => handleDraftParseSetting('deltaMode', e.target.value as DeltaMode)}
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
          <SettingsRow label="Longitude Sign Convention" tooltip={SETTINGS_TOOLTIPS.lonSign}>
            <select
              title={SETTINGS_TOOLTIPS.lonSign}
              value={parseSettingsDraft.lonSign}
              onChange={(e) =>
                handleDraftParseSetting('lonSign', e.target.value as ParseSettings['lonSign'])
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
                    Number.isFinite(parseFloat(e.target.value)) && parseFloat(e.target.value) > 0
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
                    Number.isFinite(parseFloat(e.target.value)) && parseFloat(e.target.value) > 0
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
              Units
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
              Convergence Limit
              <input
                title={SETTINGS_TOOLTIPS.convergenceLimit}
                type="number"
                min={0}
                step={0.0001}
                value={settingsDraft.convergenceLimit}
                onChange={handleDraftConvergenceLimitChange}
                className={`${optionInputClass} mt-1`}
              />
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className={optionLabelClass}>
              Max Iterations
              <input
                title={SETTINGS_TOOLTIPS.maxIterations}
                type="number"
                min={1}
                max={50}
                step={1}
                value={settingsDraft.maxIterations}
                onChange={handleDraftIterChange}
                className={`${optionInputClass} mt-1`}
              />
            </label>
          </div>
        </SettingsCard>

        <SettingsCard
          title="Coordinate System"
          tooltip={PROJECT_OPTION_SECTION_TOOLTIPS['CRS / Geodetic Setup']}
        >
          <SettingsRow label="Coord System Mode" tooltip={SETTINGS_TOOLTIPS.coordSystemMode}>
            <select
              title={SETTINGS_TOOLTIPS.coordSystemMode}
              value={parseSettingsDraft.coordSystemMode}
              onChange={(e) =>
                handleDraftParseSetting('coordSystemMode', e.target.value as 'local' | 'grid')
              }
              className={optionInputClass}
            >
              <option value="local">Local</option>
              <option value="grid">Grid</option>
            </select>
          </SettingsRow>
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
              className={optionInputClass}
            >
              <option value="average-scale">Average Scale</option>
              <option value="common-elevation">Common Elevation</option>
            </select>
          </SettingsRow>
          <SettingsRow label="Catalog Group" tooltip={SETTINGS_TOOLTIPS.crsCatalogGroup}>
            <select
              title={SETTINGS_TOOLTIPS.crsCatalogGroup}
              value={crsCatalogGroupFilter}
              onChange={(e) =>
                setCrsCatalogGroupFilter(e.target.value as typeof crsCatalogGroupFilter)
              }
              className={optionInputClass}
            >
              {CRS_CATALOG_GROUP_OPTIONS.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.label}
                  {typeof crsCatalogGroupCounts[group.id] === 'number'
                    ? ` (${crsCatalogGroupCounts[group.id]})`
                    : ''}
                </option>
              ))}
            </select>
          </SettingsRow>
          <SettingsRow label="CRS Search">
            <input
              title="Filter CRS catalog rows by id, EPSG, label, or area."
              type="text"
              value={crsSearchQuery}
              onChange={(e) => setCrsSearchQuery(e.target.value)}
              placeholder="Search CRS id, EPSG, label, area..."
              className={optionInputClass}
            />
          </SettingsRow>
          <SettingsRow label="CRS (Grid Mode)" tooltip={SETTINGS_TOOLTIPS.crsId}>
            <select
              title={SETTINGS_TOOLTIPS.crsId}
              value={parseSettingsDraft.crsId}
              disabled={parseSettingsDraft.coordSystemMode !== 'grid'}
              onChange={(e) => handleDraftParseSetting('crsId', e.target.value)}
              className={optionInputClass}
            >
              {filteredDraftCrsCatalog.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.id}
                  {row.epsgCode ? ` (${row.epsgCode})` : ''} | {row.label}
                </option>
              ))}
            </select>
          </SettingsRow>
          {searchedDraftCrsCatalog.length === 0 && crsSearchQuery.trim().length > 0 && (
            <div className="text-[11px] text-amber-200">
              No CRS rows match the current search within the selected catalog group.
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className={optionLabelClass}>
              Average Geoid Height (m)
              <input
                title={SETTINGS_TOOLTIPS.averageGeoidHeight}
                type="number"
                step={0.001}
                value={parseSettingsDraft.averageGeoidHeight ?? 0}
                onChange={(e) =>
                  handleDraftParseSetting(
                    'averageGeoidHeight',
                    Number.isFinite(parseFloat(e.target.value))
                      ? parseFloat(e.target.value)
                      : 0,
                  )
                }
                className={`${optionInputClass} mt-1`}
              />
            </label>
            <label className={optionLabelClass}>
              Average Scale Factor
              <input
                title={SETTINGS_TOOLTIPS.averageScaleFactor}
                type="number"
                min={0.5}
                max={1.5}
                step={0.000001}
                value={parseSettingsDraft.averageScaleFactor ?? ''}
                disabled={
                  parseSettingsDraft.coordSystemMode !== 'local' ||
                  parseSettingsDraft.localDatumScheme !== 'average-scale'
                }
                onChange={(e) =>
                  handleDraftParseSetting(
                    'averageScaleFactor',
                    e.target.value === '' ? 1 : parseFloat(e.target.value),
                  )
                }
                className={`${optionInputClass} mt-1 disabled:opacity-100 disabled:cursor-not-allowed`}
              />
            </label>
            <label className={optionLabelClass}>
              Common Elevation (m)
              <input
                title={SETTINGS_TOOLTIPS.commonElevation}
                type="number"
                step={0.001}
                value={parseSettingsDraft.commonElevation ?? ''}
                disabled={
                  parseSettingsDraft.coordSystemMode !== 'local' ||
                  parseSettingsDraft.localDatumScheme !== 'common-elevation'
                }
                onChange={(e) =>
                  handleDraftParseSetting(
                    'commonElevation',
                    e.target.value === '' ? 0 : parseFloat(e.target.value),
                  )
                }
                className={`${optionInputClass} mt-1 disabled:opacity-100 disabled:cursor-not-allowed`}
              />
            </label>
          </div>
          <div className="rounded border border-slate-600 bg-slate-950/40 p-2 space-y-1 text-[11px] text-slate-300">
            <div className="font-semibold text-slate-100">
              {selectedDraftCrs?.label ?? 'No CRS selected'}
            </div>
            <div>ID: {selectedDraftCrs?.id ?? 'n/a'}</div>
            {selectedDraftCrs?.epsgCode && <div>EPSG: {selectedDraftCrs.epsgCode}</div>}
            {selectedDraftCrs?.areaOfUse && <div>Area: {selectedDraftCrs.areaOfUse}</div>}
            <button
              type="button"
              className="text-[11px] underline text-blue-300 hover:text-blue-200"
              onClick={() => setShowCrsProjectionParams((value) => !value)}
            >
              {showCrsProjectionParams ? 'Hide projection parameters' : 'Show projection parameters'}
            </button>
            {showCrsProjectionParams && (
              <div className="pt-1 space-y-1">
                {selectedCrsProj4Params.map((param) => (
                  <div key={`${param.key}:${param.value}`}>
                    {param.key}={param.value}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className={optionLabelClass}>
              Grid Bearing Mode
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
                className={`${optionInputClass} mt-1 disabled:opacity-100 disabled:cursor-not-allowed`}
              >
                <option value="measured">Measured</option>
                <option value="grid">Grid</option>
              </select>
            </label>
            <label className={optionLabelClass}>
              Grid Distance Mode
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
                className={`${optionInputClass} mt-1 disabled:opacity-100 disabled:cursor-not-allowed`}
              >
                <option value="measured">Measured</option>
                <option value="grid">Grid</option>
                <option value="ellipsoidal">Ellipsoidal</option>
              </select>
            </label>
            <label className={optionLabelClass}>
              Grid Angle Mode
              <select
                title={SETTINGS_TOOLTIPS.gridAngleMode}
                value={parseSettingsDraft.gridAngleMode}
                disabled={parseSettingsDraft.coordSystemMode !== 'grid'}
                onChange={(e) =>
                  handleDraftParseSetting('gridAngleMode', e.target.value as GridObservationMode)
                }
                className={`${optionInputClass} mt-1 disabled:opacity-100 disabled:cursor-not-allowed`}
              >
                <option value="measured">Measured</option>
                <option value="grid">Grid</option>
              </select>
            </label>
            <label className={optionLabelClass}>
              Grid Direction Mode
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
                className={`${optionInputClass} mt-1 disabled:opacity-100 disabled:cursor-not-allowed`}
              >
                <option value="measured">Measured</option>
                <option value="grid">Grid</option>
              </select>
            </label>
          </div>
        </SettingsCard>
      </div>
    </div>
  );
};

export default AdjustmentProjectOptionsTab;
