import React from 'react';
import type { ProjectOptionsModalContext } from '../../../../hooks/useProjectOptionsModalController';

type AdjustedPointsTransformCardProps = {
  context: ProjectOptionsModalContext;
};

const AdjustedPointsTransformCard: React.FC<AdjustedPointsTransformCardProps> = ({
  context,
}) => {
  const {
    PROJECT_OPTION_SECTION_TOOLTIPS,
    SETTINGS_TOOLTIPS,
    SettingsCard,
    SettingsRow,
    SettingsToggle,
    adjustedPointsDraftStationIds,
    adjustedPointsExportSettingsDraft,
    adjustedPointsRotationAngleError,
    adjustedPointsRotationAngleInput,
    adjustedPointsTransformDraftValidationMessage,
    adjustedPointsTransformSelectedInSetCount,
    adjustedPointsTranslationAzimuthError,
    adjustedPointsTranslationAzimuthInput,
    handleDraftAdjustedPointsRotationAngleInput,
    handleDraftAdjustedPointsRotationSetting,
    handleDraftAdjustedPointsScaleSetting,
    handleDraftAdjustedPointsTransformSetting,
    handleDraftAdjustedPointsTranslationAzimuthInput,
    handleDraftAdjustedPointsTranslationSetting,
    openAdjustedPointsTransformSelectModal,
    optionInputClass,
    settingsDraft,
  } = context;

  return (
    <SettingsCard
      title="Transform"
      tooltip={PROJECT_OPTION_SECTION_TOOLTIPS.Transform}
      className="xl:col-span-2"
    >
      <div className="space-y-3">
        <div className="rounded-md border border-blue-500/50 bg-blue-900/10 p-3 space-y-3">
          <div className="text-[11px] uppercase tracking-wide text-blue-200">
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
                handleDraftAdjustedPointsTransformSetting('referenceStationId', e.target.value)
              }
              className={`${optionInputClass} disabled:opacity-100 disabled:cursor-not-allowed`}
            >
              <option value="">Select reference station</option>
              {adjustedPointsDraftStationIds.map((stationId) => (
                <option key={`adj-transform-ref-${stationId}`} value={stationId}>
                  {stationId}
                </option>
              ))}
            </select>
          </SettingsRow>
          <SettingsRow label="Scope" tooltip={SETTINGS_TOOLTIPS.adjustedPointsTransformScope}>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleDraftAdjustedPointsTransformSetting('scope', 'all')}
                disabled={adjustedPointsDraftStationIds.length === 0}
                className={`rounded border px-2 py-1 text-xs uppercase tracking-wide ${
                  adjustedPointsExportSettingsDraft.transform.scope === 'all'
                    ? 'border-blue-500 bg-blue-800/40 text-blue-100'
                    : 'border-slate-500 bg-slate-700 text-slate-100 hover:bg-slate-600'
                } disabled:opacity-100 disabled:cursor-not-allowed`}
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
                    ? 'border-blue-500 bg-blue-800/40 text-blue-100'
                    : 'border-slate-500 bg-slate-700 text-slate-100 hover:bg-slate-600'
                } disabled:opacity-100 disabled:cursor-not-allowed`}
              >
                Select Points
              </button>
            </div>
          </SettingsRow>
          {adjustedPointsExportSettingsDraft.transform.scope === 'selected' && (
            <div className="rounded border border-blue-500/40 bg-slate-800/60 px-3 py-2 text-[11px] text-slate-200 space-y-2">
              <div>
                Selected points: {adjustedPointsTransformSelectedInSetCount}
                {' | '}Reference point auto-included in transform scope.
              </div>
              <button
                type="button"
                onClick={openAdjustedPointsTransformSelectModal}
                disabled={adjustedPointsDraftStationIds.length === 0}
                className="rounded border border-blue-500/70 bg-blue-900/40 px-2 py-1 text-xs uppercase tracking-wide text-blue-100 hover:bg-blue-800/60 disabled:opacity-100 disabled:cursor-not-allowed"
              >
                Select Points
              </button>
            </div>
          )}
          <div className="rounded border border-blue-500/30 bg-slate-800/60 px-3 py-2 text-[11px] text-slate-200 leading-relaxed">
            Shared reference and scope apply to all transform actions. Active order is Scale to
            Rotate to Translate.
          </div>
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
          <div className="rounded-md border border-blue-500/50 bg-blue-900/10 p-3 space-y-3">
            <div className="text-[11px] uppercase tracking-wide text-blue-200">Rotation</div>
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
                onChange={(e) => handleDraftAdjustedPointsRotationAngleInput(e.target.value)}
                className={`${optionInputClass} disabled:opacity-100 disabled:cursor-not-allowed`}
                placeholder="ddd-mm-ss.s or decimal"
              />
            </SettingsRow>
            {adjustedPointsExportSettingsDraft.transform.rotation.enabled &&
              adjustedPointsRotationAngleError && (
                <div className="text-[11px] text-red-300">
                  {adjustedPointsRotationAngleError}
                </div>
              )}
            <div className="rounded border border-blue-500/30 bg-slate-800/60 px-3 py-2 text-[11px] text-slate-200 leading-relaxed">
              Positive angle rotates counterclockwise about the shared reference point.
            </div>
          </div>
          <div className="rounded-md border border-blue-500/50 bg-blue-900/10 p-3 space-y-3">
            <div className="text-[11px] uppercase tracking-wide text-blue-200">
              Translation
            </div>
            <SettingsRow
              label="Enable Translation"
              className="md:grid-cols-[minmax(0,1fr)_auto]"
            >
              <SettingsToggle
                title="Enable translation transform"
                checked={adjustedPointsExportSettingsDraft.transform.translation.enabled}
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
                disabled={!adjustedPointsExportSettingsDraft.transform.translation.enabled}
                onChange={(e) =>
                  handleDraftAdjustedPointsTranslationSetting(
                    'method',
                    e.target.value as 'direction-distance' | 'anchor-coordinate',
                  )
                }
                className={`${optionInputClass} disabled:opacity-100 disabled:cursor-not-allowed`}
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
                  tooltip={SETTINGS_TOOLTIPS.adjustedPointsTransformTranslationAzimuth}
                >
                  <input
                    title={SETTINGS_TOOLTIPS.adjustedPointsTransformTranslationAzimuth}
                    type="text"
                    value={adjustedPointsTranslationAzimuthInput}
                    disabled={!adjustedPointsExportSettingsDraft.transform.translation.enabled}
                    onChange={(e) =>
                      handleDraftAdjustedPointsTranslationAzimuthInput(e.target.value)
                    }
                    className={`${optionInputClass} disabled:opacity-100 disabled:cursor-not-allowed`}
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
                    value={adjustedPointsExportSettingsDraft.transform.translation.distance}
                    disabled={!adjustedPointsExportSettingsDraft.transform.translation.enabled}
                    onChange={(e) => {
                      const parsed = Number.parseFloat(e.target.value);
                      handleDraftAdjustedPointsTranslationSetting(
                        'distance',
                        Number.isFinite(parsed) ? parsed : 0,
                      );
                    }}
                    className={`${optionInputClass} disabled:opacity-100 disabled:cursor-not-allowed`}
                  />
                </SettingsRow>
              </>
            ) : (
              <>
                <SettingsRow label={`New Easting (${settingsDraft.units})`}>
                  <input
                    type="number"
                    step={0.0001}
                    value={adjustedPointsExportSettingsDraft.transform.translation.targetE}
                    disabled={!adjustedPointsExportSettingsDraft.transform.translation.enabled}
                    onChange={(e) => {
                      const parsed = Number.parseFloat(e.target.value);
                      handleDraftAdjustedPointsTranslationSetting(
                        'targetE',
                        Number.isFinite(parsed) ? parsed : 0,
                      );
                    }}
                    className={`${optionInputClass} disabled:opacity-100 disabled:cursor-not-allowed`}
                  />
                </SettingsRow>
                <SettingsRow label={`New Northing (${settingsDraft.units})`}>
                  <input
                    type="number"
                    step={0.0001}
                    value={adjustedPointsExportSettingsDraft.transform.translation.targetN}
                    disabled={!adjustedPointsExportSettingsDraft.transform.translation.enabled}
                    onChange={(e) => {
                      const parsed = Number.parseFloat(e.target.value);
                      handleDraftAdjustedPointsTranslationSetting(
                        'targetN',
                        Number.isFinite(parsed) ? parsed : 0,
                      );
                    }}
                    className={`${optionInputClass} disabled:opacity-100 disabled:cursor-not-allowed`}
                  />
                </SettingsRow>
              </>
            )}
            <div className="rounded border border-blue-500/30 bg-slate-800/60 px-3 py-2 text-[11px] text-slate-200 leading-relaxed">
              Azimuth convention is surveying style: 0 north, 90 east, 180 south, 270 west.
            </div>
          </div>
          <div className="rounded-md border border-blue-500/50 bg-blue-900/10 p-3 space-y-3">
            <div className="text-[11px] uppercase tracking-wide text-blue-200">Scale</div>
            <SettingsRow label="Enable Scale" className="md:grid-cols-[minmax(0,1fr)_auto]">
              <SettingsToggle
                title="Enable scale transform"
                checked={adjustedPointsExportSettingsDraft.transform.scale.enabled}
                onChange={(checked) => handleDraftAdjustedPointsScaleSetting('enabled', checked)}
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
                className={`${optionInputClass} disabled:opacity-100 disabled:cursor-not-allowed`}
              />
            </SettingsRow>
            <div className="rounded border border-blue-500/30 bg-slate-800/60 px-3 py-2 text-[11px] text-slate-200 leading-relaxed">
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
            Run adjustment to populate station choices for transform reference and scope.
          </div>
        )}
      </div>
    </SettingsCard>
  );
};

export default AdjustedPointsTransformCard;
