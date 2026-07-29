import React from 'react';
import type { ProjectOptionsModalContext } from '../../../../hooks/useProjectOptionsModalController';
import type { AdjustedPointsExportSettings, AdjustedPointsPresetId } from '../../../../types';

type AdjustedPointsExportCardProps = {
  context: ProjectOptionsModalContext;
};

const AdjustedPointsExportCard: React.FC<AdjustedPointsExportCardProps> = ({
  context,
}) => {
  const {
    ADJUSTED_POINTS_ALL_COLUMNS,
    PROJECT_OPTION_SECTION_TOOLTIPS,
    SETTINGS_TOOLTIPS,
    SettingsCard,
    SettingsRow,
    SettingsToggle,
    adjustedPointsExportSettingsDraft,
    handleAdjustedPointsDragStart,
    handleAdjustedPointsDrop,
    handleAdjustedPointsMoveColumn,
    handleAdjustedPointsPresetChange,
    handleAdjustedPointsToggleColumn,
    handleDraftAdjustedPointsSetting,
    optionInputClass,
  } = context;

  return (
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
                handleAdjustedPointsPresetChange(e.target.value as AdjustedPointsPresetId)
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
              const checked = adjustedPointsExportSettingsDraft.columns.includes(columnId);
              const disableEnable =
                !checked && adjustedPointsExportSettingsDraft.columns.length >= 6;
              const disableDisable =
                checked && adjustedPointsExportSettingsDraft.columns.length <= 1;
              return (
                <label
                  key={`adj-col-${columnId}`}
                  className={`flex items-center gap-2 rounded border px-2 py-1 text-xs ${
                    checked
                      ? 'border-blue-500/70 bg-blue-900/20 text-blue-100'
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
                    className="rounded border border-slate-500 px-1 py-0.5 disabled:opacity-100"
                  >
                    {'<'}
                  </button>
                  <button
                    type="button"
                    title={`Move ${columnId} right`}
                    disabled={index === adjustedPointsExportSettingsDraft.columns.length - 1}
                    onClick={() => handleAdjustedPointsMoveColumn(columnId, 'right')}
                    className="rounded border border-slate-500 px-1 py-0.5 disabled:opacity-100"
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
  );
};

export default AdjustedPointsExportCard;
