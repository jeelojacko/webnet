import React from 'react';
import type { ParseSettings } from '../../../appStateTypes';
import type {
  AngleMode,
  RobustMode,
  TsCorrelationScope,
} from '../../../types';
import type { ProjectOptionsModalContext } from '../../../hooks/useProjectOptionsModalController';

type SpecialProjectOptionsTabProps = {
  context: ProjectOptionsModalContext;
};

const SpecialProjectOptionsTab: React.FC<SpecialProjectOptionsTabProps> = ({ context }) => {
  const {
    PROJECT_OPTION_SECTION_TOOLTIPS,
    SETTINGS_TOOLTIPS,
    SettingsCard,
    SettingsRow,
    SettingsToggle,
    handleDraftParseSetting,
    optionInputClass,
    optionLabelClass,
    parityProfileActive,
    parseSettingsDraft,
  } = context;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <SettingsCard
        title="Observation Interpretation"
        tooltip={PROJECT_OPTION_SECTION_TOOLTIPS['Observation Interpretation']}
      >
        <SettingsRow label="A-Record Mode" tooltip={SETTINGS_TOOLTIPS.angleMode}>
          <select
            title={SETTINGS_TOOLTIPS.angleMode}
            value={parseSettingsDraft.angleMode}
            onChange={(e) => handleDraftParseSetting('angleMode', e.target.value as AngleMode)}
            className={optionInputClass}
          >
            <option value="auto">AUTO</option>
            <option value="angle">ANGLE</option>
            <option value="dir">DIR</option>
          </select>
        </SettingsRow>
        <SettingsRow
          label="Description Reconcile Mode"
          tooltip={SETTINGS_TOOLTIPS.descriptionReconcileMode}
        >
          <select
            title={SETTINGS_TOOLTIPS.descriptionReconcileMode}
            value={parseSettingsDraft.descriptionReconcileMode}
            onChange={(e) =>
              handleDraftParseSetting(
                'descriptionReconcileMode',
                e.target.value as ParseSettings['descriptionReconcileMode'],
              )
            }
            className={optionInputClass}
          >
            <option value="first">FIRST</option>
            <option value="append">APPEND</option>
          </select>
        </SettingsRow>
        <SettingsRow
          label="Description Append Delimiter"
          tooltip={SETTINGS_TOOLTIPS.descriptionAppendDelimiter}
        >
          <input
            title={SETTINGS_TOOLTIPS.descriptionAppendDelimiter}
            type="text"
            value={parseSettingsDraft.descriptionAppendDelimiter}
            disabled={parseSettingsDraft.descriptionReconcileMode !== 'append'}
            onChange={(e) =>
              handleDraftParseSetting(
                'descriptionAppendDelimiter',
                e.target.value.length > 0 ? e.target.value : ' | ',
              )
            }
            className={`${optionInputClass} disabled:opacity-100 disabled:cursor-not-allowed`}
          />
        </SettingsRow>
      </SettingsCard>
      <SettingsCard
        title="TS Correlation"
        tooltip={PROJECT_OPTION_SECTION_TOOLTIPS['TS Correlation']}
        disabled={parityProfileActive}
      >
        <SettingsRow
          label="Enable Correlation"
          tooltip={SETTINGS_TOOLTIPS.tsCorrelation}
          className="md:grid-cols-[minmax(0,1fr)_auto]"
        >
          <SettingsToggle
            title={SETTINGS_TOOLTIPS.tsCorrelation}
            checked={parseSettingsDraft.tsCorrelationEnabled}
            disabled={parityProfileActive}
            onChange={(checked) => handleDraftParseSetting('tsCorrelationEnabled', checked)}
          />
        </SettingsRow>
        <SettingsRow
          label="Correlation Scope"
          tooltip={SETTINGS_TOOLTIPS.tsCorrelationScope}
        >
          <select
            title={SETTINGS_TOOLTIPS.tsCorrelationScope}
            value={parseSettingsDraft.tsCorrelationScope}
            disabled={parityProfileActive || parseSettingsDraft.preanalysisMode}
            onChange={(e) =>
              handleDraftParseSetting(
                'tsCorrelationScope',
                e.target.value as TsCorrelationScope,
              )
            }
            className={`${optionInputClass} disabled:opacity-100 disabled:cursor-not-allowed`}
          >
            <option value="set">SET</option>
            <option value="setup">SETUP</option>
          </select>
        </SettingsRow>
        <SettingsRow label="Correlation ρ" tooltip={SETTINGS_TOOLTIPS.tsCorrelationRho}>
          <input
            title={SETTINGS_TOOLTIPS.tsCorrelationRho}
            type="number"
            min={0}
            max={0.95}
            step={0.01}
            value={parseSettingsDraft.tsCorrelationRho}
            disabled={parityProfileActive || parseSettingsDraft.preanalysisMode}
            onChange={(e) =>
              handleDraftParseSetting(
                'tsCorrelationRho',
                Number.isFinite(parseFloat(e.target.value))
                  ? Math.max(0, Math.min(0.95, parseFloat(e.target.value)))
                  : 0.25,
              )
            }
            className={`${optionInputClass} disabled:opacity-100 disabled:cursor-not-allowed`}
          />
        </SettingsRow>
      </SettingsCard>
      <SettingsCard
        title="Positional Tolerance"
        tooltip="Project-level settings used by .PTOL selections for pass/fail line checks."
      >
        <div className="space-y-3">
          <div
            className="rounded border border-slate-400/60 bg-slate-700/20 px-2 py-2 flex items-center justify-between gap-2"
            title="Enable positional tolerance checks for the station pairs selected by .PTOL directives."
          >
            <span className="text-[11px] uppercase tracking-wide text-slate-200">
              Enable PTOL Checks
            </span>
            <SettingsToggle
              title="Enable positional tolerance checks for the station pairs selected by .PTOL directives."
              checked={parseSettingsDraft.positionalToleranceEnabled ?? false}
              onChange={(checked) =>
                handleDraftParseSetting('positionalToleranceEnabled', checked)
              }
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className={optionLabelClass}>
              Constant (mm)
              <input
                title="Constant allowance added to each positional tolerance check."
                type="number"
                min={0}
                step={0.1}
                value={parseSettingsDraft.positionalToleranceConstantMm ?? 0}
                disabled={!parseSettingsDraft.positionalToleranceEnabled}
                onChange={(e) =>
                  handleDraftParseSetting(
                    'positionalToleranceConstantMm',
                    Number.isFinite(parseFloat(e.target.value))
                      ? Math.max(0, parseFloat(e.target.value))
                      : 0,
                  )
                }
                className={`${optionInputClass} mt-1 disabled:opacity-100 disabled:cursor-not-allowed`}
              />
            </label>
            <label className={optionLabelClass}>
              PPM
              <input
                title="PPM allowance added in proportion to the tested line length."
                type="number"
                min={0}
                step={0.1}
                value={parseSettingsDraft.positionalTolerancePpm ?? 0}
                disabled={!parseSettingsDraft.positionalToleranceEnabled}
                onChange={(e) =>
                  handleDraftParseSetting(
                    'positionalTolerancePpm',
                    Number.isFinite(parseFloat(e.target.value))
                      ? Math.max(0, parseFloat(e.target.value))
                      : 0,
                  )
                }
                className={`${optionInputClass} mt-1 disabled:opacity-100 disabled:cursor-not-allowed`}
              />
            </label>
            <label className={optionLabelClass}>
              Confidence (%)
              <input
                title="Confidence region used when converting the relative ellipse semi-major axis into the PTOL check value."
                type="number"
                min={1}
                max={99.999}
                step={0.1}
                value={parseSettingsDraft.positionalToleranceConfidencePercent ?? 95}
                disabled={!parseSettingsDraft.positionalToleranceEnabled}
                onChange={(e) =>
                  handleDraftParseSetting(
                    'positionalToleranceConfidencePercent',
                    Number.isFinite(parseFloat(e.target.value))
                      ? Math.max(1, Math.min(99.999, parseFloat(e.target.value)))
                      : 95,
                  )
                }
                className={`${optionInputClass} mt-1 disabled:opacity-100 disabled:cursor-not-allowed`}
              />
            </label>
          </div>
          <div className="rounded-md border border-slate-400/60 bg-slate-700/20 px-3 py-2 text-[11px] text-slate-200 leading-relaxed">
            `.PTOL /CON` selects which station pairs to check. These project settings define the
            allowable tolerance and confidence region used by the listing pass/fail report.
          </div>
        </div>
      </SettingsCard>
      <SettingsCard
        title="Robust Model"
        tooltip={PROJECT_OPTION_SECTION_TOOLTIPS['Robust Model']}
        disabled={parityProfileActive}
      >
        <SettingsRow label="Robust Mode" tooltip={SETTINGS_TOOLTIPS.robustMode}>
          <select
            title={SETTINGS_TOOLTIPS.robustMode}
            value={parseSettingsDraft.robustMode}
            onChange={(e) => handleDraftParseSetting('robustMode', e.target.value as RobustMode)}
            disabled={parityProfileActive}
            className={`${optionInputClass} disabled:opacity-100 disabled:cursor-not-allowed`}
          >
            <option value="none">OFF</option>
            <option value="huber">Huber</option>
          </select>
        </SettingsRow>
        <SettingsRow label="Robust k" tooltip={SETTINGS_TOOLTIPS.robustK}>
          <input
            title={SETTINGS_TOOLTIPS.robustK}
            type="number"
            min={0.5}
            max={10}
            step={0.1}
            value={parseSettingsDraft.robustK}
            onChange={(e) =>
              handleDraftParseSetting(
                'robustK',
                Number.isFinite(parseFloat(e.target.value))
                  ? Math.max(0.5, Math.min(10, parseFloat(e.target.value)))
                  : 1.5,
              )
            }
            disabled={parityProfileActive}
            className={`${optionInputClass} disabled:opacity-100 disabled:cursor-not-allowed`}
          />
        </SettingsRow>
      </SettingsCard>
    </div>
  );
};

export default SpecialProjectOptionsTab;
