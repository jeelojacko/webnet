import React from 'react';

import type { ParseSettings } from '../../../appStateTypes';
import type { DeltaMode, OrderMode } from '../../../types';
import type { AdjustmentProjectOptionsTabProps } from './AdjustmentProjectOptionsTab.types';

export const AdjustmentGeodeticFrameworkCard: React.FC<AdjustmentProjectOptionsTabProps> = ({
  context,
}) => {
  const {
    DEFAULT_QFIX_ANGULAR_SIGMA_SEC,
    DEFAULT_QFIX_LINEAR_SIGMA_M,
    FT_PER_M,
    M_PER_FT,
    PROJECT_OPTION_SECTION_TOOLTIPS,
    SETTINGS_TOOLTIPS,
    SettingsCard,
    SettingsRow,
    handleDraftConvergenceLimitChange,
    handleDraftIterChange,
    handleDraftParseSetting,
    handleDraftUnitChange,
    optionInputClass,
    optionLabelClass,
    parseSettingsDraft,
    settingsDraft,
  } = context;

  return (
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
      <SettingsRow label="Distance / Vertical Data Type" tooltip={SETTINGS_TOOLTIPS.deltaMode}>
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
      <SettingsRow label="Angle Data Station Order" tooltip={SETTINGS_TOOLTIPS.angleStationOrder}>
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
  );
};
