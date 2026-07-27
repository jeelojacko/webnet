import React from 'react';
import type {
  GeoidHeightDatum,
  GeoidInterpolationMethod,
  GeoidSourceFormat,
  GnssVectorFrame,
} from '../../../types';
import type { ProjectOptionsModalContext } from '../../../hooks/useProjectOptionsModalController';
import GpsProjectOptionsGeoidSourceFileRow from './GpsProjectOptionsGeoidSourceFileRow';

type GpsProjectOptionsTabProps = {
  context: ProjectOptionsModalContext;
};

const GpsProjectOptionsTab: React.FC<GpsProjectOptionsTabProps> = ({ context }) => {
  const {
    BUILTIN_GEOID_MODEL_OPTIONS,
    FT_PER_M,
    M_PER_FT,
    PROJECT_OPTION_SECTION_TOOLTIPS,
    SETTINGS_TOOLTIPS,
    SettingsCard,
    SettingsRow,
    SettingsToggle,
    RAD_TO_DEG,
    clearDraftGeoidSourceData,
    geoidSourceDataDraft,
    geoidSourceDataLabelDraft,
    geoidSourceFileInputRef,
    handleDraftParseSetting,
    handleGeoidSourceFileChange,
    handleGeoidSourceFilePick,
    optionInputClass,
    parseSettingsDraft,
    settingsDraft,
  } = context;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <SettingsCard
        title="Advanced CRS/GPS/Height"
        tooltip={PROJECT_OPTION_SECTION_TOOLTIPS['GPS Loop Check']}
      >
        <SettingsRow
          label="Grid-Ground Scale Override"
          tooltip={SETTINGS_TOOLTIPS.crsGridScaleEnabled}
          className="md:grid-cols-[minmax(0,1fr)_auto]"
        >
          <SettingsToggle
            title={SETTINGS_TOOLTIPS.crsGridScaleEnabled}
            checked={parseSettingsDraft.crsGridScaleEnabled}
            onChange={(checked) => handleDraftParseSetting('crsGridScaleEnabled', checked)}
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
            className={`${optionInputClass} disabled:opacity-100 disabled:cursor-not-allowed`}
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
            onChange={(checked) => handleDraftParseSetting('crsConvergenceEnabled', checked)}
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
            className={`${optionInputClass} disabled:opacity-100 disabled:cursor-not-allowed`}
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
            onChange={(checked) => handleDraftParseSetting('gpsLoopCheckEnabled', checked)}
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
            onChange={(checked) => handleDraftParseSetting('gpsAddHiHtEnabled', checked)}
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
            className={`${optionInputClass} disabled:opacity-100 disabled:cursor-not-allowed`}
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
            className={`${optionInputClass} disabled:opacity-100 disabled:cursor-not-allowed`}
          />
        </SettingsRow>
        <SettingsRow
          label='Vertical Deflection N (")'
          tooltip={SETTINGS_TOOLTIPS.verticalDeflectionNorthSec}
        >
          <input
            title={SETTINGS_TOOLTIPS.verticalDeflectionNorthSec}
            type="number"
            step={0.001}
            value={parseSettingsDraft.verticalDeflectionNorthSec}
            onChange={(e) =>
              handleDraftParseSetting(
                'verticalDeflectionNorthSec',
                Number.isFinite(Number.parseFloat(e.target.value))
                  ? Number.parseFloat(e.target.value)
                  : 0,
              )
            }
            className={optionInputClass}
          />
        </SettingsRow>
        <SettingsRow
          label='Vertical Deflection E (")'
          tooltip={SETTINGS_TOOLTIPS.verticalDeflectionEastSec}
        >
          <input
            title={SETTINGS_TOOLTIPS.verticalDeflectionEastSec}
            type="number"
            step={0.001}
            value={parseSettingsDraft.verticalDeflectionEastSec}
            onChange={(e) =>
              handleDraftParseSetting(
                'verticalDeflectionEastSec',
                Number.isFinite(Number.parseFloat(e.target.value))
                  ? Number.parseFloat(e.target.value)
                  : 0,
              )
            }
            className={optionInputClass}
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
            onChange={(checked) => handleDraftParseSetting('gnssFrameConfirmed', checked)}
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
            onChange={(checked) => handleDraftParseSetting('geoidModelEnabled', checked)}
          />
        </SettingsRow>
        <SettingsRow label="Geoid/Grid Model ID" tooltip={SETTINGS_TOOLTIPS.geoidModelId}>
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
              className={`${optionInputClass} disabled:opacity-100 disabled:cursor-not-allowed`}
            />
            <datalist id="builtin-geoid-model-options">
              {BUILTIN_GEOID_MODEL_OPTIONS.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.label}
                </option>
              ))}
            </datalist>
            <span className="text-[11px] text-slate-300">
              Common presets include <strong>NAD83-CSRS-DEMO</strong> for Canada-first workflows.
            </span>
          </div>
        </SettingsRow>
        <SettingsRow label="Geoid Source Format" tooltip={SETTINGS_TOOLTIPS.geoidSourceFormat}>
          <select
            title={SETTINGS_TOOLTIPS.geoidSourceFormat}
            value={parseSettingsDraft.geoidSourceFormat}
            disabled={!parseSettingsDraft.geoidModelEnabled}
            onChange={(e) =>
              handleDraftParseSetting('geoidSourceFormat', e.target.value as GeoidSourceFormat)
            }
            className={`${optionInputClass} disabled:opacity-100 disabled:cursor-not-allowed`}
          >
            <option value="builtin">BUILTIN</option>
            <option value="gtx">GTX</option>
            <option value="byn">BYN</option>
          </select>
        </SettingsRow>
        <SettingsRow label="Geoid Source Path" tooltip={SETTINGS_TOOLTIPS.geoidSourcePath}>
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
            className={`${optionInputClass} disabled:opacity-100 disabled:cursor-not-allowed`}
          />
        </SettingsRow>
        <GpsProjectOptionsGeoidSourceFileRow
          SETTINGS_TOOLTIPS={SETTINGS_TOOLTIPS}
          SettingsRow={SettingsRow}
          clearDraftGeoidSourceData={clearDraftGeoidSourceData}
          geoidSourceDataDraft={geoidSourceDataDraft}
          geoidSourceDataLabelDraft={geoidSourceDataLabelDraft}
          geoidSourceFileInputRef={geoidSourceFileInputRef}
          handleGeoidSourceFileChange={handleGeoidSourceFileChange}
          handleGeoidSourceFilePick={handleGeoidSourceFilePick}
          parseSettingsDraft={parseSettingsDraft}
        />
        <SettingsRow label="Geoid Interpolation" tooltip={SETTINGS_TOOLTIPS.geoidInterpolation}>
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
            className={`${optionInputClass} disabled:opacity-100 disabled:cursor-not-allowed`}
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
            className={`${optionInputClass} disabled:opacity-100 disabled:cursor-not-allowed`}
          >
            <option value="orthometric">ORTHOMETRIC</option>
            <option value="ellipsoid">ELLIPSOID</option>
          </select>
        </SettingsRow>
      </SettingsCard>
    </div>
  );
};

export default GpsProjectOptionsTab;
