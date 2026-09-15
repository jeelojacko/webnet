import React, { useMemo, useState } from 'react';
import type { CadProject } from '../../engine/cad/cadTypes';
import {
  buildFieldToFinishPayload,
  type FieldToFinishCadPayload,
  type FieldToFinishCadPoint,
} from '../../engine/fieldToFinish/cadGeneration';
import { SAMPLE_CATALOG } from '../../engine/fieldToFinish/sampleCatalog';
import {
  controlStationsToFieldToFinishPoints,
} from '../../engine/fieldToFinish/regeneration';
import { parseTerrestrialCoordinateCsv } from '../../engine/terrestrialCsvImport';
import { SurveyCadFeatureCatalogEditor } from './SurveyCadFeatureCatalogEditor';
import { buildF2FReviewRows, summarizeF2FReview } from './f2fReviewUtils';

interface FieldToFinishPanelProps {
  project: CadProject;
  onCommitPayload: (_payload: FieldToFinishCadPayload) => void;
}

type PanelTab = 'CATALOG' | 'REVIEW' | 'PREVIEW';

const INLINE_SAMPLE = [
  'Point,Northing,Easting,Elevation,Code,Description',
  'C1,1000,5000,100,CONTROL,Control station',
  'E1,950,5010,99.8,EDGE BEGIN,Edge start',
  'E2,960,5020,99.7,EDGE CONTINUE,',
  'E3,970,5030,99.6,EDGE END,Edge end',
  'T1,980,5050,100.1,TREE,Oak',
  'R1,990,5070,100.2,ROCK,Unmapped rock',
].join('\n');

const cloneSampleCatalog = (): typeof SAMPLE_CATALOG => ({
  ...SAMPLE_CATALOG,
  definitions: SAMPLE_CATALOG.definitions.map((entry) => ({
    ...entry,
    lineworkBehavior: { ...entry.lineworkBehavior },
  })),
  aliases: SAMPLE_CATALOG.aliases.map((alias) => ({ ...alias })),
});

export const SurveyCadFieldToFinishPanel: React.FC<FieldToFinishPanelProps> = ({
  project,
  onCommitPayload,
}) => {
  const [tab, setTab] = useState<PanelTab>('CATALOG');
  const [catalog, setCatalog] = useState(cloneSampleCatalog);
  const [csvText, setCsvText] = useState(INLINE_SAMPLE);
  const [points, setPoints] = useState<FieldToFinishCadPoint[] | null>(null);
  const [importNote, setImportNote] = useState('');
  const [runId, setRunId] = useState('ui-1');

  const reviewRows = useMemo(
    () => (points ? buildF2FReviewRows(points, catalog) : []),
    [points, catalog],
  );
  const summary = useMemo(
    () => (points ? summarizeF2FReview(points, catalog) : null),
    [points, catalog],
  );
  const preview = useMemo(() => {
    if (!points) return null;
    const built = buildFieldToFinishPayload(project, {
      points,
      catalog,
      generationRunId: runId,
    });
    return {
      stats: {
        create: built.addedEntityIds.length,
        update: built.updatedEntityIds.length,
        labels: built.stats.labels,
        segments: built.stats.linework,
        layers: built.payload.layersToAdd.length,
        styles: built.payload.stylesToAdd.length,
        unmapped: built.stats.unmapped,
      },
      warnings: built.warnings,
      payload: built.payload,
    };
  }, [points, project, catalog, runId]);

  const runImport = (text: string): void => {
    const dataset = parseTerrestrialCoordinateCsv(text, { units: 'm' }, 'f2f-import.csv');
    if (!dataset) {
      setPoints(null);
      setImportNote('Import failed: header must carry Point/ID + Northing + Easting (units m).');
      return;
    }
    const converted = controlStationsToFieldToFinishPoints(dataset.controlStations, 'f2f-ui-import');
    setPoints(converted);
    setImportNote(`Imported ${converted.length} points from ${dataset.controlStations.length} records.`);
    setRunId((current) => `ui-${Number(current.slice(3)) + 1}`);
  };

  return (
    <div className="grid gap-2" data-f2f-panel>
      <div role="tablist" aria-label="Field-to-Finish" className="flex gap-1">
        {(['CATALOG', 'REVIEW', 'PREVIEW'] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className="rounded border border-slate-600 px-2 py-1 text-[12px] hover:bg-slate-800"
            onClick={() => setTab(key)}
          >
            {key === 'CATALOG' ? 'Feature catalog' : key === 'REVIEW' ? 'Import review' : 'Preview & commit'}
          </button>
        ))}
      </div>
      {tab === 'CATALOG' ? (
        <SurveyCadFeatureCatalogEditor catalog={catalog} onCatalogChange={setCatalog} />
      ) : null}
      {tab === 'REVIEW' ? (
        <div className="grid gap-2" data-f2f-review>
          <textarea
            aria-label="Coded point CSV"
            className="h-28 rounded border border-slate-700 bg-slate-900 p-1 font-mono text-[11px]"
            value={csvText}
            onChange={(event) => setCsvText(event.target.value)}
          />
          <div className="flex items-center gap-1">
            <button type="button" className="rounded border border-slate-600 px-2 py-1 text-[12px] hover:bg-slate-800" onClick={() => runImport(csvText)} data-f2f-import-run>
              Review import
            </button>
            <button type="button" className="rounded border border-slate-600 px-2 py-1 text-[12px] hover:bg-slate-800" onClick={() => { setCsvText(INLINE_SAMPLE); runImport(INLINE_SAMPLE); }} data-f2f-import-sample>
              Load sample
            </button>
            {importNote ? <span className="text-[11px] text-slate-400">{importNote}</span> : null}
          </div>
          {summary ? (
            <p className="text-[12px]" data-f2f-review-summary>
              {summary.total} points · {summary.mapped} mapped · {summary.unmapped} Unmapped Code ·{' '}
              {summary.noCode} without code · {summary.invalidControls} invalid controls ·{' '}
              {summary.chains} Generated Linework chains · {summary.lineworkWarnings} warnings ·{' '}
              {summary.lineworkFailures} failures
            </p>
          ) : null}
          {reviewRows.length > 0 ? (
            <div className="grid max-h-64 gap-0.5 overflow-auto text-[11px]" data-f2f-review-rows>
              <div className="grid grid-cols-[3rem_1fr_1fr_5rem] gap-1 font-semibold text-slate-300">
                <span>Point ID</span><span>Raw code</span><span>Definition</span><span>Status</span>
              </div>
              {reviewRows.map((row) => (
                <div key={row.pointId} className="grid grid-cols-[3rem_1fr_1fr_5rem] gap-1 border-t border-slate-800 py-0.5">
                  <span className="font-mono">{row.pointId}</span>
                  <span className="font-mono">{row.rawCode || '—'}</span>
                  <span>{row.codes.join(' ') || '—'}{row.description ? ` · ${row.description}` : ''}</span>
                  <span className={row.mappingStatus === 'Unmapped' ? 'text-amber-300' : ''}>
                    {row.mappingStatus}
                    {row.lineworkControls ? ` [${row.lineworkControls}]` : ''}
                    {row.warnings.length > 0 ? ` · ${row.warnings.join('; ')}` : ''}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {tab === 'PREVIEW' ? (
        <div className="grid gap-2" data-f2f-preview>
          {!preview ? (
            <p className="text-[12px] text-slate-400">Run an import review first.</p>
          ) : (
            <>
              <p className="text-[12px]" data-f2f-preview-counts>
                {preview.stats.create} create · {preview.stats.update} update · {preview.stats.labels} labels ·{' '}
                {preview.stats.segments} Generated Linework · {preview.stats.layers} layers ·{' '}
                {preview.stats.styles} styles · {preview.stats.unmapped} unmapped
              </p>
              {preview.warnings.length > 0 ? (
                <ul className="grid max-h-40 gap-0.5 overflow-auto text-[11px] text-amber-300" data-f2f-preview-warnings>
                  {preview.warnings.map((warning, index) => (
                    <li key={`${warning.code}-${index}`}>
                      {warning.code}{warning.pointId ? ` ${warning.pointId}` : ''}: {warning.message}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12px] text-emerald-300">No diagnostics.</p>
              )}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="rounded border border-sky-500 bg-sky-950 px-2 py-1 text-[12px] hover:bg-sky-900"
                  onClick={() => onCommitPayload(preview.payload)}
                  data-f2f-commit
                >
                  Confirm commit (one transaction)
                </button>
                <button
                  type="button"
                  className="rounded border border-slate-600 px-2 py-1 text-[12px] hover:bg-slate-800"
                  onClick={() => setRunId((current) => `ui-${Number(current.slice(3)) + 1}`)}
                >
                  Refresh preview
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
};
