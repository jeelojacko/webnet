import type { ImportReviewComparisonSummary, ImportReviewItem } from '../../engine/importReview';
import type { ImportReviewModalProps } from './ImportReviewModal.types';
import { PRESET_OPTIONS } from './ImportReviewModal.constants';

interface ImportReviewModalHeaderProps {
  sourceName: string;
  title: string;
  detailLines: string[];
  includedCount: number;
  warningCount: number;
  errorCount: number;
  mtaItems: ImportReviewItem[];
  rawItems: ImportReviewItem[];
  excludeMtaChecked: boolean;
  excludeRawChecked: boolean;
  comparisonSummary: ImportReviewComparisonSummary | null;
  preset: ImportReviewModalProps['preset'];
  comparisonMode: ImportReviewModalProps['comparisonMode'];
  pendingAssociatedSettingsSourceName: ImportReviewModalProps['pendingAssociatedSettingsSourceName'];
  pendingAssociatedSettingsSummary: ImportReviewModalProps['pendingAssociatedSettingsSummary'];
  onPresetChange: ImportReviewModalProps['onPresetChange'];
  onCreateEmptySetupGroup: ImportReviewModalProps['onCreateEmptySetupGroup'];
  onCompareFile: ImportReviewModalProps['onCompareFile'];
  onClearComparison: ImportReviewModalProps['onClearComparison'];
  onImportAssociatedProjectSettings: ImportReviewModalProps['onImportAssociatedProjectSettings'];
  onSetBulkExcludeMta: ImportReviewModalProps['onSetBulkExcludeMta'];
  onSetBulkExcludeRaw: ImportReviewModalProps['onSetBulkExcludeRaw'];
  onConvertSlopeZenithToHd2D: ImportReviewModalProps['onConvertSlopeZenithToHd2D'];
  onComparisonModeChange: ImportReviewModalProps['onComparisonModeChange'];
}

const ImportReviewModalHeader = ({
  sourceName,
  title,
  detailLines,
  includedCount,
  warningCount,
  errorCount,
  mtaItems,
  rawItems,
  excludeMtaChecked,
  excludeRawChecked,
  comparisonSummary,
  preset,
  comparisonMode,
  pendingAssociatedSettingsSourceName,
  pendingAssociatedSettingsSummary,
  onPresetChange,
  onCreateEmptySetupGroup,
  onCompareFile,
  onClearComparison,
  onImportAssociatedProjectSettings,
  onSetBulkExcludeMta,
  onSetBulkExcludeRaw,
  onConvertSlopeZenithToHd2D,
  onComparisonModeChange,
}: ImportReviewModalHeaderProps) => (
  <div className="border-b border-slate-700 bg-slate-800 px-5 py-4">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <div className="text-[11px] uppercase tracking-[0.24em] text-cyan-300">
          Import Review
        </div>
        <div className="mt-1 text-lg font-semibold text-white">{title}</div>
        <div className="mt-1 text-xs text-slate-400">{sourceName}</div>
      </div>
      <div className="grid gap-3 text-xs text-slate-300 lg:min-w-[340px]">
        <div className="text-right">
          <div>
            {includedCount} row{includedCount === 1 ? '' : 's'} selected for import
          </div>
          <div>
            {warningCount} warnings, {errorCount} errors
          </div>
        </div>
        <label className="flex flex-col text-left text-[11px] uppercase tracking-wide text-slate-400">
          Output Style
          <select
            value={preset}
            onChange={(event) => onPresetChange(event.target.value as ImportReviewModalProps['preset'])}
            className="mt-1 border border-slate-600 bg-slate-950 px-2 py-2 text-xs text-slate-100 focus:border-cyan-400 focus:outline-none"
          >
            {PRESET_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <span className="mt-1 normal-case tracking-normal text-slate-400">
            {PRESET_OPTIONS.find((option) => option.value === preset)?.description}
          </span>
        </label>
        <button
          type="button"
          onClick={onCreateEmptySetupGroup}
          className="border border-slate-600 bg-slate-950 px-3 py-2 text-[11px] uppercase tracking-wide text-slate-200 hover:border-cyan-400"
        >
          Add Empty Setup
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCompareFile}
            className="border border-slate-600 bg-slate-950 px-3 py-2 text-[11px] uppercase tracking-wide text-slate-200 hover:border-cyan-400"
          >
            Add Source File
          </button>
          {comparisonSummary && (
            <button
              type="button"
              onClick={onClearComparison}
              className="border border-slate-600 bg-slate-950 px-3 py-2 text-[11px] uppercase tracking-wide text-slate-200 hover:border-cyan-400"
            >
              Clear Added Sources
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onImportAssociatedProjectSettings}
          className="border border-slate-600 bg-slate-950 px-3 py-2 text-[11px] uppercase tracking-wide text-slate-200 hover:border-cyan-400"
        >
          Import Associated Project Settings
        </button>
        {pendingAssociatedSettingsSourceName && (
          <div className="text-left text-[11px] text-emerald-300">
            Pending settings: {pendingAssociatedSettingsSourceName}
            {pendingAssociatedSettingsSummary ? (
              <div className="mt-1 text-[10px] text-slate-400">
                {pendingAssociatedSettingsSummary}
              </div>
            ) : null}
          </div>
        )}
        <div className="grid gap-2 text-left text-[11px] uppercase tracking-wide text-slate-400">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={excludeMtaChecked}
              disabled={mtaItems.length === 0}
              onChange={(event) => onSetBulkExcludeMta(event.target.checked)}
              className="accent-amber-400"
            />
            <span>Exclude MTA Obs ({mtaItems.length})</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={excludeRawChecked}
              disabled={rawItems.length === 0}
              onChange={(event) => onSetBulkExcludeRaw(event.target.checked)}
              className="accent-amber-400"
            />
            <span>Exclude Raw Obs ({rawItems.length})</span>
          </label>
          <button
            type="button"
            onClick={onConvertSlopeZenithToHd2D}
            className="border border-slate-600 bg-slate-950 px-3 py-2 text-[11px] uppercase tracking-wide text-slate-200 hover:border-cyan-400"
          >
            Convert SD+Zenith to HD (2D)
          </button>
        </div>
        {comparisonSummary && (
          <div className="grid gap-2 text-left">
            <div className="text-[11px] uppercase tracking-wide text-slate-400">
              Reconcile Preset
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onComparisonModeChange('non-mta-only')}
                className={`border px-3 py-2 text-[11px] uppercase tracking-wide ${
                  comparisonMode === 'non-mta-only'
                    ? 'border-cyan-400 bg-cyan-900 text-cyan-100'
                    : 'border-slate-600 bg-slate-950 text-slate-200 hover:border-cyan-400'
                }`}
              >
                Non-MTA Only
              </button>
              <button
                type="button"
                onClick={() => onComparisonModeChange('all-raw')}
                className={`border px-3 py-2 text-[11px] uppercase tracking-wide ${
                  comparisonMode === 'all-raw'
                    ? 'border-cyan-400 bg-cyan-900 text-cyan-100'
                    : 'border-slate-600 bg-slate-950 text-slate-200 hover:border-cyan-400'
                }`}
              >
                All Raw Rows
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
    {detailLines.length > 0 && (
      <div className="mt-3 space-y-1 text-xs text-slate-300">
        {detailLines.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
    )}
  </div>
);

export default ImportReviewModalHeader;
