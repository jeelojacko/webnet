import React from 'react';

import type {
  GridDistanceInputMode,
  GridObservationMode,
  LocalDatumScheme,
} from '../../../types';
import type { AdjustmentProjectOptionsTabProps } from './AdjustmentProjectOptionsTab.types';

export const AdjustmentCoordinateSystemCard: React.FC<AdjustmentProjectOptionsTabProps> = ({
  context,
}) => {
  const {
    CRS_CATALOG_GROUP_OPTIONS,
    PROJECT_OPTION_SECTION_TOOLTIPS,
    SETTINGS_TOOLTIPS,
    SettingsCard,
    SettingsRow,
    crsCatalogGroupCounts,
    crsCatalogGroupFilter,
    crsSearchQuery,
    filteredDraftCrsCatalog,
    handleDraftParseSetting,
    optionInputClass,
    optionLabelClass,
    parseSettingsDraft,
    searchedDraftCrsCatalog,
    selectedCrsProj4Params,
    selectedDraftCrs,
    setCrsCatalogGroupFilter,
    setCrsSearchQuery,
    setShowCrsProjectionParams,
    showCrsProjectionParams,
  } = context;

  return (
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
      <SettingsRow label="Local Datum Scheme" tooltip={SETTINGS_TOOLTIPS.localDatumScheme}>
        <select
          title={SETTINGS_TOOLTIPS.localDatumScheme}
          value={parseSettingsDraft.localDatumScheme}
          disabled={parseSettingsDraft.coordSystemMode !== 'local'}
          onChange={(e) =>
            handleDraftParseSetting('localDatumScheme', e.target.value as LocalDatumScheme)
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
                Number.isFinite(parseFloat(e.target.value)) ? parseFloat(e.target.value) : 0,
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
              handleDraftParseSetting('gridBearingMode', e.target.value as GridObservationMode)
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
              handleDraftParseSetting('gridDirectionMode', e.target.value as GridObservationMode)
            }
            className={`${optionInputClass} mt-1 disabled:opacity-100 disabled:cursor-not-allowed`}
          >
            <option value="measured">Measured</option>
            <option value="grid">Grid</option>
          </select>
        </label>
      </div>
    </SettingsCard>
  );
};
