import React from 'react';

import type { ParseSettings } from '../../../appStateTypes';
import type { CoordMode, RunMode } from '../../../types';
import type { AdjustmentProjectOptionsTabProps } from './AdjustmentProjectOptionsTab.types';

export const AdjustmentSolverConfigurationCard: React.FC<AdjustmentProjectOptionsTabProps> = ({
  context,
}) => {
  const {
    FT_PER_M,
    M_PER_FT,
    PROJECT_OPTION_SECTION_TOOLTIPS,
    SETTINGS_TOOLTIPS,
    SettingsCard,
    SettingsRow,
    SettingsToggle,
    handleDraftParseSetting,
    optionInputClass,
    optionLabelClass,
    parseSettingsDraft,
    settingsDraft,
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
              onChange={(e) => handleDraftParseSetting('runMode', e.target.value as RunMode)}
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
              onChange={(checked) => handleDraftParseSetting('autoSideshotEnabled', checked)}
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
              onChange={(checked) => handleDraftParseSetting('clusterDetectionEnabled', checked)}
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
            disabled={parseSettingsDraft.runMode !== 'adjustment' || !parseSettingsDraft.autoAdjustEnabled}
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
            disabled={parseSettingsDraft.runMode !== 'adjustment' || !parseSettingsDraft.autoAdjustEnabled}
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
            disabled={parseSettingsDraft.runMode !== 'adjustment' || !parseSettingsDraft.autoAdjustEnabled}
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
  );
};
