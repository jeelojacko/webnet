import React from 'react';
import { createStableRuntimeId } from '../../engine/id';
import type { CadAnalysisMap } from '../../engine/cad/cadAnalysisTypes';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';
import { saveBrowserTextFile } from '../../engine/browserFileIo';
import { formatAnalysisNumber } from './cadAnalysisSnapshot';
import { buildAnalysisSummaryCsv, buildAnalysisSummaryFilename } from './cadAnalysisReport';
import { CadAnalysisRangeEditor } from './CadAnalysisRangeEditor';
import { CadAnalysisInquiryPanel } from './CadAnalysisInquiryPanel';
import { Field, ManagerShell } from '../../components/surveyCad/surveyManagerShared.tsx';
import { buttonClass, inputClass } from '../../components/surveyCad/surveyManagerShared';

interface CadAnalysisSectionProps {
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions;
  analysisPickArmedFor?: string | null;
  analysisPickAnswer?: { analysisId: string; text: string } | null;
}

interface CadAnalysisManagerProps extends CadAnalysisSectionProps {
  onClose: () => void;
}

/** Full-palette wrapper (standalone analysis manager entry point). */
export const CadAnalysisManager: React.FC<CadAnalysisManagerProps> = ({
  snapshot,
  actions,
  analysisPickArmedFor = null,
  analysisPickAnswer = null,
  onClose,
}) => (
  <ManagerShell label="Analysis manager" title="Analysis Maps" onClose={onClose}>
    <CadAnalysisSection
      snapshot={snapshot}
      actions={actions}
      analysisPickArmedFor={analysisPickArmedFor}
      analysisPickAnswer={analysisPickAnswer}
    />
  </ManagerShell>
);

/**
 * Phase 18U — ANALYSIS section (embedded in the surface manager palette,
 * mirroring the volume section). Rows: Name/Type/Status/Bands/Min/Max/
 * Classified Area + per-map actions (New Elevation / New Slope / New Depth /
 * Calculate / Edit Ranges / Create Legend / Delete). Delete is blocked while
 * legends reference the map unless "delete legends too" is confirmed.
 */
export const CadAnalysisSection: React.FC<CadAnalysisSectionProps> = ({
  snapshot,
  actions,
  analysisPickArmedFor = null,
  analysisPickAnswer = null,
}) => {
  const analysis = snapshot.analysis;
  const [notice, setNotice] = React.useState<string | null>(null);
  const [editRanges, setEditRanges] = React.useState(false);
  const [opacityDraft, setOpacityDraft] = React.useState<string>('');
  const [legendTitleDraft, setLegendTitleDraft] = React.useState('');
  const selectedId = analysis?.selectedAnalysisId ?? null;
  React.useEffect(() => {
    setEditRanges(false);
    setLegendTitleDraft('');
    const map = snapshot.analysis?.maps.find((entry) => entry.id === selectedId) ?? null;
    setOpacityDraft(map?.opacity != null ? String(map.opacity) : '');
    // Re-init on selection change only: live definition edits must not clobber
    // the in-progress opacity draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);
  if (!analysis) return null;
  const rows = analysis.analyses;
  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const selectedLegend =
    analysis.legends.find((legend) => legend.legendId === analysis.selectedLegendId) ?? null;
  const selectedMap: CadAnalysisMap | null = selected
    ? analysis.maps.find((map) => map.id === selected.id) ?? null
    : null;

  const commit = (label: string, ok: boolean): boolean => {
    setNotice(ok ? `${label} done.` : `${label} rejected — see status/locks.`);
    return ok;
  };
  const createMap = (kind: 'elevation' | 'slope-percent' | 'signed-depth'): void => {
    setNotice(actions.createAnalysis?.(kind) ?? 'Analysis create unavailable in this workspace.');
  };
  const setAppearance = (patch: Record<string, unknown>, label: string): void => {
    if (!selected) return;
    commit(
      label,
      actions.runSurveyCommand({
        key: 'ANALYSIS_MAP_UPDATE_APPEARANCE',
        analysisId: selected.id,
        patch: patch as never,
      }),
    );
  };
  const remove = (): void => {
    if (!selected) return;
    const legendCount = selected.legendIds.length;
    const deleteLegendsToo =
      legendCount > 0 &&
      window.confirm(
        `“${selected.name}” is referenced by ${legendCount} legend(s). Delete the analysis and those legends?`,
      );
    if (legendCount > 0 && !deleteLegendsToo) {
      setNotice('Delete blocked — legends reference this analysis.');
      return;
    }
    const ok = commit(
      'Delete',
      actions.runSurveyCommand({
        key: 'ANALYSIS_MAP_DELETE',
        analysisId: selected.id,
        ...(deleteLegendsToo ? { deleteLegendsToo: true } : {}),
      }),
    );
    if (ok) actions.selectAnalysis?.(null);
  };
  const createLegend = (): void => {
    if (!selected) return;
    const legend = {
      id: createStableRuntimeId('cad-analysis-legend'),
      analysisId: selected.id,
      insertionX: 0,
      insertionY: 0,
      ...(legendTitleDraft.trim() !== '' ? { title: legendTitleDraft.trim() } : {}),
      showRange: true,
      showArea: true,
      showPercent: true,
      ...(selected.sourceKind === 'volume' ? { showVolume: true } : {}),
    };
    commit(
      'Create Legend',
      actions.runSurveyCommand({ key: 'ANALYSIS_LEGEND_CREATE', legend }),
    );
  };
  const downloadReport = (): void => {
    if (!selected) return;
    try {
      const csv = buildAnalysisSummaryCsv(selected, snapshot.units);
      const filename = buildAnalysisSummaryFilename(selected.name);
      void saveBrowserTextFile(filename, csv, [
        { description: 'CSV Files', accept: { 'text/csv': ['.csv'] } },
      ]).then((saved) => setNotice(saved ? `Saved ${filename}.` : 'Download cancelled.'));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section className="grid gap-2" data-cad-analysis-section>
      {notice ? (
        <p role="status" data-analysis-notice className="text-[11px] text-amber-200">
          {notice}
        </p>
      ) : null}
      <div className="grid grid-cols-[1fr_1fr] gap-2">
        <Field label="New surface analysis">
          <span className="flex flex-wrap gap-1">
            <button type="button" className={buttonClass} onClick={() => createMap('elevation')} data-cad-analysis-new-elevation>
              New Elevation
            </button>
            <button type="button" className={buttonClass} onClick={() => createMap('slope-percent')} data-cad-analysis-new-slope>
              New Slope
            </button>
          </span>
        </Field>
        <Field label="New volume analysis">
          <button type="button" className={buttonClass} onClick={() => createMap('signed-depth')} data-cad-analysis-new-depth>
            New Depth
          </button>
        </Field>
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-2 rounded border border-slate-700 p-2" data-cad-analysis-legend-create>
        <Field label="Legend title (blank = analysis name)">
          <input
            aria-label="New analysis legend title"
            className={inputClass}
            value={legendTitleDraft}
            disabled={!selected}
            onChange={(event) => setLegendTitleDraft(event.target.value)}
            placeholder={selected?.name ?? 'Select an analysis first'}
          />
        </Field>
        <div className="flex items-end gap-1">
          <button type="button" className={buttonClass} disabled={!selected} onClick={createLegend}>
            Create Legend
          </button>
        </div>
      </div>
      <table className="w-full border-collapse text-[11px]" data-cad-analysis-list>
        <thead>
          <tr className="text-slate-400">
            <th className="px-1 text-left">Name</th>
            <th className="px-1 text-left">Type</th>
            <th className="px-1 text-left">Status</th>
            <th className="px-1 text-right">Bands</th>
            <th className="px-1 text-right">Min</th>
            <th className="px-1 text-right">Max</th>
            <th className="px-1 text-right">Classified</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              data-cad-analysis={row.id}
              data-cad-analysis-status={row.status}
              className={`cursor-pointer hover:bg-slate-800 ${row.id === selected?.id ? 'bg-slate-800' : ''}`}
              onClick={() => actions.selectAnalysis?.(row.id)}
              title={`${row.name} — ${row.statusText}`}
            >
              <td className="px-1">
                {row.name}
                {row.legendIds.length > 0 ? <span className="text-slate-500"> [{row.legendIds.length} legend]</span> : null}
              </td>
              <td className="px-1">{row.typeLabel}</td>
              <td className="px-1">
                {row.statusText}
                {row.stale ? ' (stale)' : ''}
              </td>
              <td className="px-1 text-right">{row.bandCount}</td>
              <td className="px-1 text-right">{formatAnalysisNumber(row.measuredMin ?? row.rangeMin)}</td>
              <td className="px-1 text-right">{formatAnalysisNumber(row.measuredMax ?? row.rangeMax)}</td>
              <td className="px-1 text-right">
                {row.classifiedArea == null ? '—' : `${row.classifiedArea.toFixed(2)}`}
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td className="px-1 text-slate-400" colSpan={7}>
                No analysis maps — create an Elevation/Slope map from a current surface, or a Depth map from a volume surface.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      {selected && selectedMap ? (
        <div className="grid gap-2 rounded border border-slate-700 p-2" data-cad-analysis-detail={selected.id}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-[11px]">
            <dt className="text-slate-400">Source</dt>
            <dd>{selected.sourceKind} {selected.sourceName}</dd>
            <dt className="text-slate-400">Type</dt>
            <dd>{selected.typeLabel} ({selected.metricUnit})</dd>
            <dt className="text-slate-400">Status</dt>
            <dd>{selected.statusText}{selected.stale ? ' — showing last bands (STALE)' : ''}</dd>
            <dt className="text-slate-400">Range</dt>
            <dd>{formatAnalysisNumber(selected.rangeMin)} … {formatAnalysisNumber(selected.rangeMax)} {selected.metricUnit}</dd>
            <dt className="text-slate-400">Measured</dt>
            <dd>
              {formatAnalysisNumber(selected.measuredMin)} … {formatAnalysisNumber(selected.measuredMax)} {selected.metricUnit}
            </dd>
            <dt className="text-slate-400">Classified area</dt>
            <dd>{selected.classifiedArea == null ? '—' : `${selected.classifiedArea.toFixed(3)}`}</dd>
          </dl>
          <div className="grid grid-cols-[1fr_1fr] gap-2">
            <Field label="Layer">
              <select
                aria-label="Analysis layer"
                className={inputClass}
                value={selected.layerId}
                onChange={(event) =>
                  actions.runSurveyCommand({
                    key: 'ANALYSIS_MAP_UPDATE_APPEARANCE',
                    analysisId: selected.id,
                    patch: { layerId: event.target.value },
                  })
                }
              >
                {snapshot.layers.map((layer) => (
                  <option key={layer.id} value={layer.id}>{layer.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Opacity (0 = transparent)">
              <input
                aria-label="Analysis opacity"
                className={inputClass}
                value={opacityDraft}
                onChange={(event) => setOpacityDraft(event.target.value)}
                onBlur={() => {
                  if (opacityDraft.trim() === '') {
                    setAppearance({ opacity: 1 }, 'Opacity');
                    return;
                  }
                  const value = Number.parseFloat(opacityDraft);
                  if (!Number.isFinite(value) || value < 0 || value > 1) {
                    setNotice('Opacity must be between 0 and 1.');
                    return;
                  }
                  setAppearance({ opacity: value }, 'Opacity');
                }}
              />
            </Field>
            <label className="flex items-center gap-1 text-[11px] text-slate-300">
              <input
                type="checkbox"
                aria-label="Show band boundaries"
                checked={selectedMap.showBoundaries === true}
                onChange={(event) => setAppearance({ showBoundaries: event.target.checked }, 'Boundaries')}
              />
              Show band boundaries
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonClass}
              disabled={!selected.calculable}
              title={selected.calculable ? 'Calculate bands (manual).' : 'Blocked: source must be Current.'}
              onClick={() => setNotice(actions.requestAnalysis?.(selected.id) ?? 'Analysis Calculate unavailable in this workspace.')}
              data-cad-analysis-calculate={selected.id}
            >
              {selected.result ? 'Recalculate' : 'Calculate'}
            </button>
            <button
              type="button"
              className={buttonClass}
              onClick={() => setEditRanges((current) => !current)}
              data-cad-analysis-edit-ranges={selected.id}
            >
              {editRanges ? 'Hide Ranges' : 'Edit Ranges'}
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={!selected.exportable}
              title={selected.exportable ? 'Download the Analysis Summary CSV.' : 'Enabled only when Current.'}
              onClick={downloadReport}
              data-cad-analysis-report={selected.id}
            >
              Analysis Summary
            </button>
            <button type="button" className={buttonClass} onClick={remove}>
              Delete
            </button>
          </div>
          {editRanges ? (
            <CadAnalysisRangeEditor
              map={selectedMap}
              units={snapshot.units}
              result={selected.result}
              onApply={(bands) =>
                commit(
                  'Ranges',
                  actions.runSurveyCommand({
                    key: 'ANALYSIS_MAP_UPDATE_BANDS',
                    analysisId: selected.id,
                    bands,
                  }),
                )
              }
              onNotice={setNotice}
            />
          ) : (
            <table className="w-full border-collapse text-[11px]" data-cad-analysis-bands={selected.id}>
              <thead>
                <tr className="text-slate-400">
                  <th className="px-1 text-left">Band</th>
                  <th className="px-1 text-right">Lower</th>
                  <th className="px-1 text-right">Upper</th>
                  <th className="px-1 text-right">Plan Area</th>
                  <th className="px-1 text-right">%Area</th>
                  <th className="px-1 text-right">
                    {selected.metric === 'signed-depth' ? 'Net Volume' : '3D Area'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {selected.bands.map((band) => (
                  <tr key={band.bandId} data-cad-analysis-band={band.bandId}>
                    <td className="px-1">
                      <span
                        className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-slate-600 align-middle"
                        style={{ background: band.color }}
                      />
                      {band.label}
                    </td>
                    <td className="px-1 text-right">{formatAnalysisNumber(band.lower)}</td>
                    <td className="px-1 text-right">{formatAnalysisNumber(band.upper)}</td>
                    <td className="px-1 text-right">{formatAnalysisNumber(band.planArea)}</td>
                    <td className="px-1 text-right">{band.percent == null ? '—' : `${band.percent.toFixed(1)}%`}</td>
                    <td className="px-1 text-right">
                      {selected.metric === 'signed-depth'
                        ? formatAnalysisNumber(band.netVolume)
                        : formatAnalysisNumber(band.area3D)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <CadAnalysisInquiryPanel
            snapshot={snapshot}
            actions={actions}
            analysisId={selected.id}
            pickArmedFor={analysisPickArmedFor}
            pickedAnswer={analysisPickAnswer?.analysisId === selected.id ? analysisPickAnswer.text : null}
          />
        </div>
      ) : null}
      {analysis.legends.length > 0 ? (
        <table className="w-full border-collapse text-[11px]" data-cad-analysis-legends>
          <thead>
            <tr className="text-slate-400">
              <th className="px-1 text-left">Legend</th>
              <th className="px-1 text-left">Analysis</th>
              <th className="px-1 text-left">Status</th>
              <th className="px-1 text-right">E</th>
              <th className="px-1 text-right">N</th>
              <th className="px-1" />
            </tr>
          </thead>
          <tbody>
            {analysis.legends.map((legend) => (
              <tr
                key={legend.legendId}
                data-cad-analysis-legend={legend.legendId}
                className={`cursor-pointer hover:bg-slate-800 ${legend.legendId === analysis.selectedLegendId ? 'bg-slate-800' : ''}`}
                onClick={() => actions.selectAnalysisLegend?.(legend.legendId)}
              >
                <td className="px-1">{legend.title}</td>
                <td className="px-1">{legend.analysisName}</td>
                <td className="px-1">{legend.statusText}</td>
                <td className="px-1 text-right">{legend.insertionX.toFixed(2)}</td>
                <td className="px-1 text-right">{legend.insertionY.toFixed(2)}</td>
                <td className="px-1 text-right">
                  <button
                    type="button"
                    className="rounded border border-slate-600 px-1 hover:bg-slate-800"
                    aria-label={`Delete legend ${legend.legendId}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      commit(
                        'Delete Legend',
                        actions.runSurveyCommand({
                          key: 'ANALYSIS_LEGEND_DELETE',
                          legendId: legend.legendId,
                        }),
                      );
                    }}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {selectedLegend ? (
        <div className="grid gap-2 rounded border border-slate-700 p-2" data-cad-analysis-legend-detail={selectedLegend.legendId}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-[11px]">
            <dt className="text-slate-400">Analysis</dt><dd>{selectedLegend.analysisName}</dd>
            <dt className="text-slate-400">Insertion</dt>
            <dd>{selectedLegend.insertionX.toFixed(3)}, {selectedLegend.insertionY.toFixed(3)}</dd>
            <dt className="text-slate-400">Text style</dt><dd>{selectedLegend.textStyleName}</dd>
          </dl>
          <p className="text-[11px] text-slate-500">
            Legend rows read from the referenced analysis at render time; nothing derived is stored.
          </p>
        </div>
      ) : null}
    </section>
  );
};
