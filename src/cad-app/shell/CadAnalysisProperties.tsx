import React from 'react';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';
import type { CadAnalysisRow, CadAnalysisLegendRow } from './cadAnalysisSnapshot';
import { formatAnalysisNumber } from './cadAnalysisSnapshot';
import { inputClass } from '../../components/surveyCad/surveyManagerShared';

/**
 * Phase 18U — Analysis + Legend sections for the Properties palette.
 * Counts/status/ranges only: band polygon arrays and per-region data are
 * never dumped into the panel.
 */
export const AnalysisPropertiesBlock: React.FC<{
  row: CadAnalysisRow;
  actions: CadShellActions | null;
}> = ({ row, actions }) => (
  <div className="cad-shell-props-group" data-cad-analysis-properties={row.id}>
    <h4>Analysis</h4>
    <dl>
      <div><dt>Name</dt><dd>{row.name}</dd></div>
      <div><dt>Source</dt><dd>{row.sourceKind} {row.sourceName}</dd></div>
      <div><dt>Type</dt><dd>{row.typeLabel} ({row.metricUnit})</dd></div>
      <div>
        <dt>Status</dt>
        <dd data-cad-analysis-status={row.status}>{row.statusText}{row.stale ? ' (stale)' : ''}</dd>
      </div>
      <div><dt>Bands</dt><dd>{row.bandCount}</dd></div>
      <div>
        <dt>Min / Max</dt>
        <dd>
          {formatAnalysisNumber(row.measuredMin ?? row.rangeMin)} / {formatAnalysisNumber(row.measuredMax ?? row.rangeMax)} {row.metricUnit}
        </dd>
      </div>
      <div>
        <dt>Classified area</dt>
        <dd>{row.classifiedArea == null ? '—' : `${row.classifiedArea.toFixed(3)}`}</dd>
      </div>
      <div><dt>Legends</dt><dd>{row.legendIds.length}</dd></div>
    </dl>
    <div className="flex flex-wrap gap-1">
      <button
        type="button"
        className="rounded border border-slate-600 px-2 py-1 text-[11px] hover:bg-slate-800"
        disabled={!row.calculable}
        onClick={() => actions?.requestAnalysis?.(row.id)}
      >
        {row.result ? 'Recalculate' : 'Calculate'}
      </button>
      <button
        type="button"
        className="rounded border border-slate-600 px-2 py-1 text-[11px] hover:bg-slate-800"
        onClick={() => actions?.openSurveyManager('surfaces')}
      >
        Manager
      </button>
    </div>
  </div>
);

/** Legend presentation inspector + show-flag toggles (revision-free edits). */
export const AnalysisLegendPropertiesBlock: React.FC<{
  legend: CadAnalysisLegendRow;
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions | null;
}> = ({ legend, snapshot, actions }) => {
  const flags: Array<{ key: 'showRange' | 'showArea' | 'showPercent' | 'showVolume'; label: string }> = [
    { key: 'showRange', label: 'Range' },
    { key: 'showArea', label: 'Area' },
    { key: 'showPercent', label: 'Percent' },
    { key: 'showVolume', label: 'Volume' },
  ];
  const update = (patch: Record<string, unknown>): void => {
    actions?.runSurveyCommand({
      key: 'ANALYSIS_LEGEND_UPDATE',
      legendId: legend.legendId,
      patch: patch as never,
    });
  };
  return (
    <div className="cad-shell-props-group" data-cad-analysis-legend-properties={legend.legendId}>
      <h4>Analysis Legend</h4>
      <dl>
        <div><dt>Analysis</dt><dd>{legend.analysisName}</dd></div>
        <div>
          <dt>Insertion</dt>
          <dd>{legend.insertionX.toFixed(3)}, {legend.insertionY.toFixed(3)}</dd>
        </div>
        <div><dt>Text style</dt><dd>{legend.textStyleName}</dd></div>
      </dl>
      <label className="grid gap-0.5 text-[11px] text-slate-300">
        <span className="text-slate-400">Title</span>
        <input
          aria-label="Analysis legend title"
          className={inputClass}
          defaultValue={legend.title}
          key={`${legend.legendId}:${legend.title}`}
          onBlur={(event) => update({ title: event.target.value })}
        />
      </label>
      <label className="grid gap-0.5 text-[11px] text-slate-300">
        <span className="text-slate-400">Text style</span>
        <select
          aria-label="Analysis legend text style"
          className={inputClass}
          value={legend.textStyleId ?? ''}
          onChange={(event) =>
            update({ textStyleId: event.target.value === '' ? null : event.target.value })
          }
        >
          <option value="">Current text style</option>
          {snapshot.analysis?.textStyles.map((style) => (
            <option key={style.id} value={style.id}>{style.name}</option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-2 text-[11px] text-slate-300">
        {flags.map((flag) => (
          <label key={flag.key} className="flex items-center gap-1">
            <input
              type="checkbox"
              aria-label={`Legend ${flag.label}`}
              checked={legend[flag.key]}
              onChange={(event) => update({ [flag.key]: event.target.checked })}
            />
            {flag.label}
          </label>
        ))}
      </div>
      <button
        type="button"
        className="w-fit rounded border border-slate-600 px-2 py-1 text-[11px] hover:bg-slate-800"
        onClick={() => actions?.openSurveyManager('surfaces')}
      >
        Manager
      </button>
    </div>
  );
};
