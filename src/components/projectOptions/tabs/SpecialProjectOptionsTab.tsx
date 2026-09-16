import React from 'react';
import type { ParseSettings } from '../../../appStateTypes';
import { normalizeLocalTestPolicy } from '../../../engine/localTestPolicy';
import type { LocalTestPolicy } from '../../../engine/localTestPolicy';
import {
  DEFAULT_RELIABILITY_ALPHA,
  DEFAULT_RELIABILITY_POWER,
  normalizeReliabilityPolicy,
} from '../../../engine/reliabilityPolicy';
import type { ReliabilityPolicy } from '../../../engine/reliabilityPolicy';
import { QC_RESTRICTION_NOTES } from '../../../engine/qcRestrictionNotes';
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

  const localTestPolicy: LocalTestPolicy = normalizeLocalTestPolicy(
    parseSettingsDraft.localTestPolicy,
  );
  const updateLocalTestPolicy = (patch: Partial<LocalTestPolicy>): void => {
    handleDraftParseSetting('localTestPolicy', { ...localTestPolicy, ...patch });
  };
  const reliabilityPolicy: Required<ReliabilityPolicy> = normalizeReliabilityPolicy(
    parseSettingsDraft.reliabilityPolicy,
  );
  const updateReliabilityPolicy = (patch: Partial<ReliabilityPolicy>): void => {
    handleDraftParseSetting('reliabilityPolicy', { ...reliabilityPolicy, ...patch });
  };
  const reliabilityStatistical = reliabilityPolicy.model === 'statistical';

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
            title={`${SETTINGS_TOOLTIPS.robustK} Unused while Robust Mode is OFF.`}
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
            disabled={parityProfileActive || parseSettingsDraft.robustMode === 'none'}
            className={`${optionInputClass} disabled:opacity-100 disabled:cursor-not-allowed`}
          />
        </SettingsRow>
        {parseSettingsDraft.robustMode === 'none' ? (
          <div className="text-[11px] text-slate-400">
            Robust k is unused while Robust Mode is OFF.
          </div>
        ) : (
          <div className="text-[11px] text-amber-200/90">{QC_RESTRICTION_NOTES.robustFrozenWeights}</div>
        )}
      </SettingsCard>
      <SettingsCard
        title="Local Test Policy"
        tooltip="Single-outlier data-snooping policy for local test verdicts. Legacy fixed (3.29) is the default."
        disabled={parityProfileActive}
      >
        <SettingsRow label="Test Mode" tooltip={SETTINGS_TOOLTIPS.localTestMode}>
          <select
            title={SETTINGS_TOOLTIPS.localTestMode}
            value={localTestPolicy.mode}
            onChange={(e) =>
              updateLocalTestPolicy({
                mode: e.target.value as LocalTestPolicy['mode'],
              })
            }
            disabled={parityProfileActive}
            className={`${optionInputClass} disabled:opacity-100 disabled:cursor-not-allowed`}
          >
            <option value="legacy-fixed">Legacy fixed (3.29)</option>
            <option value="baarda-w">Baarda w</option>
            <option value="pope-tau">Pope τ</option>
          </select>
        </SettingsRow>
        <SettingsRow label="Significance α" tooltip={SETTINGS_TOOLTIPS.localTestAlpha}>
          <div className="flex items-center gap-2">
            <button
              type="button"
              title="Nominal significance 5% (per-test when correction is None)"
              disabled={parityProfileActive || localTestPolicy.mode === 'legacy-fixed'}
              onClick={() => updateLocalTestPolicy({ alpha: 0.05 })}
              className={`${optionInputClass} px-2 py-1 disabled:opacity-100 disabled:cursor-not-allowed ${localTestPolicy.alpha === 0.05 ? 'font-bold' : ''}`}
            >
              5%
            </button>
            <button
              type="button"
              title="Nominal significance 1% (per-test when correction is None)"
              disabled={parityProfileActive || localTestPolicy.mode === 'legacy-fixed'}
              onClick={() => updateLocalTestPolicy({ alpha: 0.01 })}
              className={`${optionInputClass} px-2 py-1 disabled:opacity-100 disabled:cursor-not-allowed ${localTestPolicy.alpha === 0.01 ? 'font-bold' : ''}`}
            >
              1%
            </button>
            <input
              title={SETTINGS_TOOLTIPS.localTestAlpha}
              type="number"
              min={0.0001}
              max={0.5}
              step={0.01}
              value={localTestPolicy.alpha}
              onChange={(e) => {
                const parsed = parseFloat(e.target.value);
                updateLocalTestPolicy({
                  alpha: Number.isFinite(parsed)
                    ? Math.max(0.0001, Math.min(0.5, parsed))
                    : 0.05,
                });
              }}
              disabled={parityProfileActive || localTestPolicy.mode === 'legacy-fixed'}
              className={`${optionInputClass} disabled:opacity-100 disabled:cursor-not-allowed`}
            />
          </div>
        </SettingsRow>
        <SettingsRow label="Correction" tooltip={SETTINGS_TOOLTIPS.localTestCorrection}>
          <select
            title={SETTINGS_TOOLTIPS.localTestCorrection}
            value={localTestPolicy.correction}
            onChange={(e) =>
              updateLocalTestPolicy({
                correction: e.target.value as LocalTestPolicy['correction'],
              })
            }
            disabled={parityProfileActive || localTestPolicy.mode === 'legacy-fixed'}
            className={`${optionInputClass} disabled:opacity-100 disabled:cursor-not-allowed`}
          >
            <option value="none">None</option>
            <option value="bonferroni">Bonferroni</option>
            <option value="sidak">Šidák</option>
          </select>
        </SettingsRow>
        {localTestPolicy.mode === 'legacy-fixed' ? (
          <div className="text-[11px] text-slate-400">
            Compatibility default — significance α and correction are not applied.
          </div>
        ) : null}
      </SettingsCard>
      <SettingsCard
        title="Reliability (MDB)"
        tooltip="Minimal Detectable Bias model for internal and external reliability. Legacy 3.29 is the default and reproduces historical MDBs bit-identically."
        disabled={parityProfileActive}
      >
        <SettingsRow label="MDB Model" tooltip={SETTINGS_TOOLTIPS.reliabilityModel}>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1 text-xs text-slate-200">
              <input
                type="radio"
                title={SETTINGS_TOOLTIPS.reliabilityModel}
                checked={!reliabilityStatistical}
                disabled={parityProfileActive}
                onChange={() => updateReliabilityPolicy({ model: 'legacy-3.29' })}
                className="accent-blue-500"
              />
              Legacy 3.29
            </label>
            <label className="flex items-center gap-1 text-xs text-slate-200">
              <input
                type="radio"
                title={SETTINGS_TOOLTIPS.reliabilityModel}
                checked={reliabilityStatistical}
                disabled={parityProfileActive}
                onChange={() => updateReliabilityPolicy({ model: 'statistical' })}
                className="accent-blue-500"
              />
              Statistical α/β
            </label>
          </div>
        </SettingsRow>
        <SettingsRow label="Significance α" tooltip={SETTINGS_TOOLTIPS.reliabilityAlpha}>
          <div className="flex items-center gap-2">
            <button
              type="button"
              title="Statistical MDB significance 0.1% (default)"
              disabled={parityProfileActive || !reliabilityStatistical}
              onClick={() => updateReliabilityPolicy({ alpha: DEFAULT_RELIABILITY_ALPHA })}
              className={`${optionInputClass} px-2 py-1 disabled:opacity-100 disabled:cursor-not-allowed ${reliabilityPolicy.alpha === DEFAULT_RELIABILITY_ALPHA ? 'font-bold' : ''}`}
            >
              0.1%
            </button>
            <input
              title={SETTINGS_TOOLTIPS.reliabilityAlpha}
              type="number"
              min={0.0001}
              max={0.5}
              step={0.001}
              value={reliabilityPolicy.alpha}
              onChange={(e) => {
                const parsed = parseFloat(e.target.value);
                updateReliabilityPolicy({
                  alpha: Number.isFinite(parsed)
                    ? Math.max(0.0001, Math.min(0.5, parsed))
                    : DEFAULT_RELIABILITY_ALPHA,
                });
              }}
              disabled={parityProfileActive || !reliabilityStatistical}
              className={`${optionInputClass} disabled:opacity-100 disabled:cursor-not-allowed`}
            />
          </div>
        </SettingsRow>
        <SettingsRow label="Detection Power" tooltip={SETTINGS_TOOLTIPS.reliabilityPower}>
          <div className="flex items-center gap-2">
            {([0.8, 0.9, 0.95] as const).map((preset) => (
              <button
                key={preset}
                type="button"
                title={`Detection power ${(preset * 100).toFixed(0)}%`}
                disabled={parityProfileActive || !reliabilityStatistical}
                onClick={() => updateReliabilityPolicy({ power: preset })}
                className={`${optionInputClass} px-2 py-1 disabled:opacity-100 disabled:cursor-not-allowed ${reliabilityPolicy.power === preset ? 'font-bold' : ''}`}
              >
                {(preset * 100).toFixed(0)}%
              </button>
            ))}
            <input
              title={SETTINGS_TOOLTIPS.reliabilityPower}
              type="number"
              min={0.5}
              max={0.999}
              step={0.01}
              value={reliabilityPolicy.power}
              onChange={(e) => {
                const parsed = parseFloat(e.target.value);
                updateReliabilityPolicy({
                  power: Number.isFinite(parsed)
                    ? Math.max(0.5, Math.min(0.999, parsed))
                    : DEFAULT_RELIABILITY_POWER,
                });
              }}
              disabled={parityProfileActive || !reliabilityStatistical}
              className={`${optionInputClass} disabled:opacity-100 disabled:cursor-not-allowed`}
            />
          </div>
        </SettingsRow>
        {!reliabilityStatistical ? (
          <div className="text-[11px] text-slate-400">
            Compatibility default — significance α and detection power are not applied (legacy scaling ≈50% detection level).
          </div>
        ) : null}
      </SettingsCard>
    </div>
  );
};

export default SpecialProjectOptionsTab;
