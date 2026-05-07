import React from 'react';
import type {
  ListingSortCoordinatesBy,
  ListingSortObservationsBy,
} from '../../../appStateTypes';
import type { ProjectOptionsModalContext } from '../../../hooks/useProjectOptionsModalController';

type ListingFileProjectOptionsTabProps = {
  context: ProjectOptionsModalContext;
};

const ListingFileProjectOptionsTab: React.FC<ListingFileProjectOptionsTabProps> = ({
  context,
}) => {
  const {
    PROJECT_OPTION_SECTION_TOOLTIPS,
    SETTINGS_TOOLTIPS,
    handleDraftSetting,
    optionInputClass,
    optionLabelClass,
    settingsDraft,
  } = context;

  return (
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
            className="accent-blue-500"
            checked={settingsDraft.listingShowCoordinates}
            onChange={(e) => handleDraftSetting('listingShowCoordinates', e.target.checked)}
          />
          <span>Adjusted Coordinates</span>
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-100">
          <input
            title={SETTINGS_TOOLTIPS.listingShowObservationsResiduals}
            type="checkbox"
            className="accent-blue-500"
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
            className="accent-blue-500"
            checked={settingsDraft.listingShowErrorPropagation}
            onChange={(e) => handleDraftSetting('listingShowErrorPropagation', e.target.checked)}
          />
          <span>Error Propagation</span>
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-100">
          <input
            title={SETTINGS_TOOLTIPS.listingShowProcessingNotes}
            type="checkbox"
            className="accent-blue-500"
            checked={settingsDraft.listingShowProcessingNotes}
            onChange={(e) => handleDraftSetting('listingShowProcessingNotes', e.target.checked)}
          />
          <span>Processing Notes</span>
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-100">
          <input
            title={SETTINGS_TOOLTIPS.listingShowLostStations}
            type="checkbox"
            className="accent-blue-500"
            checked={settingsDraft.listingShowLostStations}
            onChange={(e) => handleDraftSetting('listingShowLostStations', e.target.checked)}
          />
          <span>Show Lost Stations in Listing/Export</span>
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-100">
          <input
            title={SETTINGS_TOOLTIPS.listingShowAzimuthsBearings}
            type="checkbox"
            className="accent-blue-500"
            checked={settingsDraft.listingShowAzimuthsBearings}
            onChange={(e) => handleDraftSetting('listingShowAzimuthsBearings', e.target.checked)}
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
          Precision Reporting Mode
          <div className={`${optionInputClass} mt-1 flex items-center`}>Industry Standard</div>
        </label>
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
            <option value="name">Point Name</option>
            <option value="residual">Residual</option>
            <option value="stdError">Std Error</option>
            <option value="stdResidual">Std Residual</option>
          </select>
        </label>
      </div>
    </div>
  );
};

export default ListingFileProjectOptionsTab;
