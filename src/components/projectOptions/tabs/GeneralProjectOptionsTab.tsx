import React from 'react';
import type { FaceNormalizationMode, MapMode, VerticalReductionMode } from '../../../types';
import type { ProjectOptionsModalContext } from '../../../hooks/useProjectOptionsModalController';

type GeneralProjectOptionsTabProps = {
  context: ProjectOptionsModalContext;
};

const GeneralProjectOptionsTab: React.FC<GeneralProjectOptionsTabProps> = ({ context }) => {
  const {
    LEVEL_LOOP_TOLERANCE_PRESETS,
    PROJECT_OPTION_SECTION_TOOLTIPS,
    SETTINGS_TOOLTIPS,
    SettingsCard,
    SettingsRow,
    SettingsToggle,
    activeLevelLoopPresetId,
    handleDraftParseSetting,
    handleDraftSetting,
    handleLevelLoopPresetChange,
    levelLoopCustomPresetsDraft,
    normalizeUiTheme,
    optionInputClass,
    optionLabelClass,
    parseSettingsDraft,
    settingsDraft,
  } = context;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <SettingsCard
        title="Leveling / Weighting"
        tooltip={PROJECT_OPTION_SECTION_TOOLTIPS['Weighting Helpers']}
      >
        <SettingsRow label=".LWEIGHT (mm/km)" tooltip={SETTINGS_TOOLTIPS.levelWeight}>
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
                {preset.label}
              </option>
            ))}
            {levelLoopCustomPresetsDraft.length > 0 && (
              <optgroup label="Saved Custom Presets">
                {levelLoopCustomPresetsDraft.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </optgroup>
            )}
            <option value="custom">Custom</option>
          </select>
        </SettingsRow>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className={optionLabelClass}>
            Base Tol (mm)
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
            K (mm/sqrt(km))
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
      </SettingsCard>
      <SettingsCard
        title="Local / Grid Reduction"
        tooltip={PROJECT_OPTION_SECTION_TOOLTIPS['Local/Grid Reduction']}
      >
        <SettingsRow label="Map Mode" tooltip={SETTINGS_TOOLTIPS.mapMode}>
          <select
            title={SETTINGS_TOOLTIPS.mapMode}
            value={parseSettingsDraft.mapMode}
            onChange={(e) => handleDraftParseSetting('mapMode', e.target.value as MapMode)}
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
            onChange={(e) => handleDraftSetting('uiTheme', normalizeUiTheme(e.target.value))}
            className={optionInputClass}
          >
            <option value="gruvbox-dark">Gruvbox Dark</option>
            <option value="gruvbox-light">Gruvbox Light</option>
            <option value="vscode-dark">VSCode Dark</option>
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
        <SettingsRow
          label="Run Comparison Panel"
          tooltip={SETTINGS_TOOLTIPS.showRunComparisonPanel}
          className="md:grid-cols-[minmax(0,1fr)_auto]"
        >
          <SettingsToggle
            title={SETTINGS_TOOLTIPS.showRunComparisonPanel}
            checked={settingsDraft.showRunComparisonPanel}
            onChange={(checked) => handleDraftSetting('showRunComparisonPanel', checked)}
          />
        </SettingsRow>
        <SettingsRow
          label="Review Queue Panel"
          tooltip={SETTINGS_TOOLTIPS.showReviewQueuePanel}
          className="md:grid-cols-[minmax(0,1fr)_auto]"
        >
          <SettingsToggle
            title={SETTINGS_TOOLTIPS.showReviewQueuePanel}
            checked={settingsDraft.showReviewQueuePanel}
            onChange={(checked) => handleDraftSetting('showReviewQueuePanel', checked)}
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
            onChange={(checked) => handleDraftParseSetting('applyCurvatureRefraction', checked)}
          />
        </SettingsRow>
        <SettingsRow label="Refraction Coefficient" tooltip={SETTINGS_TOOLTIPS.refractionK}>
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
  );
};

export default GeneralProjectOptionsTab;
