import React from 'react';
import type { ProjectOptionsModalContext } from '../../../hooks/useProjectOptionsModalController';

type InstrumentProjectOptionsTabProps = {
  context: ProjectOptionsModalContext;
};

const InstrumentProjectOptionsTab: React.FC<InstrumentProjectOptionsTabProps> = ({
  context,
}) => {
  const {
    SETTINGS_TOOLTIPS,
    SettingsCard,
    SettingsRow,
    addNewInstrument,
    displayLinear,
    duplicateSelectedInstrument,
    handleInstrumentFieldChange,
    handleInstrumentLinearFieldChange,
    handleInstrumentNumericFieldChange,
    instrumentLinearUnit,
    optionInputClass,
    parseSettingsDraft,
    projectInstrumentsDraft,
    selectedInstrumentDraft,
    selectedInstrumentMeta,
    setSelectedInstrumentDraft,
    settingsDraft,
  } = context;

  return (
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
              {Object.keys(projectInstrumentsDraft).length === 0 && <option value="">(none)</option>}
              {Object.values(projectInstrumentsDraft).map((inst) => (
                <option key={inst.code} value={inst.code}>
                  {inst.code}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={addNewInstrument}
              className="px-3 py-1 text-[11px] border border-slate-600 bg-slate-600 hover:bg-slate-500 text-slate-100"
              title={SETTINGS_TOOLTIPS.newInstrument}
            >
              New
            </button>
            <button
              type="button"
              onClick={duplicateSelectedInstrument}
              disabled={!selectedInstrumentMeta}
              className="px-3 py-1 text-[11px] border border-slate-600 bg-slate-600 hover:bg-slate-500 text-slate-100 disabled:opacity-100 disabled:cursor-not-allowed"
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
                handleInstrumentFieldChange(selectedInstrumentMeta.code, 'desc', e.target.value)
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
            <SettingsRow label="Distance PPM" tooltip={SETTINGS_TOOLTIPS.instrumentDistancePpm}>
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
                className={`${optionInputClass} disabled:opacity-100 disabled:cursor-not-allowed`}
              />
            </SettingsRow>
            <SettingsRow
              label="Differential Levels (mm/km)"
              tooltip={SETTINGS_TOOLTIPS.instrumentDifferentialLevels}
            >
              <input
                title={SETTINGS_TOOLTIPS.instrumentDifferentialLevels}
                type="number"
                step={0.0001}
                disabled={parseSettingsDraft.coordMode === '2D'}
                value={selectedInstrumentMeta.levStd_mmPerKm}
                onChange={(e) =>
                  handleInstrumentNumericFieldChange(
                    selectedInstrumentMeta.code,
                    'levStd_mmPerKm',
                    e.target.value,
                  )
                }
                className={`${optionInputClass} disabled:opacity-100 disabled:cursor-not-allowed`}
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
                className={`${optionInputClass} disabled:opacity-100 disabled:cursor-not-allowed`}
              />
            </SettingsRow>
            <SettingsRow label="Elev Diff PPM" tooltip={SETTINGS_TOOLTIPS.instrumentElevDiffPpm}>
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
                className={`${optionInputClass} disabled:opacity-100 disabled:cursor-not-allowed`}
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
                className={`${optionInputClass} disabled:opacity-100 disabled:cursor-not-allowed`}
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
  );
};

export default InstrumentProjectOptionsTab;
