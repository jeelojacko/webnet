/**
 * Phase 13F B1 — multi-file GNSS project panel (production wiring).
 *
 * Source list (add/remove/enable/rename/reorder) over
 * useGnssMultifileProject: per-source status, composition preview,
 * datum opt-in, control overrides, solve through the existing worker
 * path, and the shared GnssResultsPanel. Engine errors surface verbatim.
 */
import React, { useMemo } from 'react';
import { useGnssBaselineWorker } from '../../hooks/useGnssBaselineWorker';
import { useGnssMultifileProject } from '../../hooks/useGnssMultifileProject';
import { GnssDatumHandlingSelector } from './GnssDatumHandlingSelector';
import {
  buildGnssMultifileExportJson,
  buildGnssMultifileExportLines,
  buildStationSourceTrace,
  type GnssMultifileReviewInfo,
} from './GnssMultifileReview.utils';
import { GnssResultsPanel } from './GnssResultsPanel';
import { GnssStationTable } from './GnssStationTable';
import { mapGnssRunError } from './gnssRunErrorText';

export const GnssMultifileProjectPanel: React.FC = () => {
  const worker = useGnssBaselineWorker();
  const project = useGnssMultifileProject();
  const running = worker.status === 'running' || project.solving;

  const handleAddFiles = (files: FileList | null): void => {
    if (!files) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const text = typeof reader.result === 'string' ? reader.result : '';
        project.addSource(file.name, text);
      };
      reader.readAsText(file);
    });
  };

  const canSolve =
    project.sources.some((source) => source.enabled) &&
    project.missingSources.length === 0 &&
    project.nonPortableIds.length === 0 &&
    project.unacknowledgedDuplicates.length === 0 &&
    !project.sigmaInvalid &&
    !running;

  const runError = project.runError ? mapGnssRunError(project.runError) : null;

  // Review context over the frozen run snapshot (display only, never re-solved).
  const review: GnssMultifileReviewInfo | undefined = useMemo(() => {
    if (!project.snapshot) return undefined;
    const statusById = new Map(project.sourceStatuses.map((row) => [row.fileId, row]));
    const enabledSources = project.sources
      .filter((source) => source.enabled)
      .map((source) => ({
        id: source.id,
        name: source.name,
        hash: statusById.get(source.id)?.hash ?? '',
        order: source.order,
      }));
    const composedControl: Record<string, 'FIXED' | 'FREE'> = {};
    Object.keys(project.snapshot.input.stations)
      .sort()
      .forEach((id) => {
        const station = project.snapshot?.input.stations[id];
        composedControl[id] = station?.fixedX && station?.fixedY && station?.fixedH ? 'FIXED' : 'FREE';
      });
    return {
      projectName: 'gnss-multifile-project',
      datumMode: project.datumMode,
      enabledSources,
      warnings: [...project.summary.warnings],
      mergeNotes: [...project.snapshot.mergeNotes],
      controlBySource: [...project.summary.controlBySource],
      provenance: project.snapshot.provenance,
      stationTrace: buildStationSourceTrace(project.parsed),
      composedControl,
    };
  }, [project.snapshot, project.sources, project.sourceStatuses, project.summary, project.parsed, project.datumMode]);

  return (
    <div className="p-4 space-y-4 text-slate-200 max-w-5xl">
      <h2 className="text-base font-semibold">Static GNSS Multi-File Project — composed ECEF solve</h2>
      <p className="text-xs text-slate-400">
        Processed baselines only (GVX, delimited CSV, native BL). Sources parse
        independently and solve as ONE composed network. No RINEX, no
        terrestrial mixing.
      </p>

      <section aria-label="Project sources" className="space-y-2 border border-slate-700 rounded p-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-medium" htmlFor="gnss-project-files">
            Add source files
          </label>
          <input
            id="gnss-project-files"
            type="file"
            accept=".gvx,.xml,.csv,.txt,.bl"
            multiple
            onChange={(event) => {
              handleAddFiles(event.target.files);
              event.target.value = '';
            }}
            className="text-xs"
          />
        </div>
        {project.sources.length === 0 && (
          <p className="text-xs text-slate-500">No sources yet. Add two or more files to compose a project.</p>
        )}
        <ul className="space-y-1 text-xs">
          {project.sourceStatuses.map((row, index) => (
            <li key={row.fileId} className="flex flex-wrap items-center gap-2 border border-slate-800 rounded px-2 py-1">
              <input
                type="checkbox"
                aria-label={`Enable ${row.fileName}`}
                checked={row.enabled}
                onChange={(event) => project.toggleSource(row.fileId, event.target.checked)}
              />
              <input
                type="text"
                aria-label="Source label"
                value={project.sources[index]?.name ?? row.fileName}
                onChange={(event) => project.renameSource(row.fileId, event.target.value)}
                className="bg-slate-800 border border-slate-700 rounded px-1 py-0.5 w-40"
              />
              <span aria-label={`status ${row.status}`} className={row.status === 'ERROR' ? 'text-red-300' : row.status === 'WARNING' ? 'text-amber-300' : row.enabled ? 'text-emerald-300' : 'text-slate-500'}>
                {row.status}
              </span>
              <span className="text-slate-400">
                {row.kind} · {row.stations} stations ({row.fixed} fixed, {row.free} free) · {row.baselines} baselines · {row.frame}/{row.epoch}/{row.ellipsoid}
              </span>
              <span className="text-slate-600 font-mono">{row.hash.slice(0, 14)}</span>
              <button type="button" aria-label={`Move ${row.fileName} up`} onClick={() => project.moveSource(row.fileId, -1)} className="px-1 border border-slate-700 rounded">↑</button>
              <button type="button" aria-label={`Move ${row.fileName} down`} onClick={() => project.moveSource(row.fileId, 1)} className="px-1 border border-slate-700 rounded">↓</button>
              <button type="button" aria-label={`Remove ${row.fileName}`} onClick={() => project.removeSource(row.fileId)} className="px-1 border border-slate-700 rounded hover:bg-slate-800">Remove</button>
              {row.messages.length > 0 && (
                <ul className="w-full text-amber-300 list-disc ml-4">
                  {row.messages.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
        {project.missingSources.length > 0 && (
          <p role="alert" className="text-xs text-red-300">
            Missing source content: {project.missingSources.join(', ')} (re-add the file content, never a host path).
          </p>
        )}
        {project.nonPortableIds.length > 0 && (
          <p role="alert" className="text-xs text-red-300">
            Portable save blocked: machine-local path on file(s) {project.nonPortableIds.join(', ')}.
          </p>
        )}
        {project.unacknowledgedDuplicates.length > 0 && (
          <div role="alert" className="text-xs text-amber-300 space-y-1">
            {project.unacknowledgedDuplicates.map(([hash, ...names]) => (
              <div key={hash as string}>
                <span>Exact-duplicate content uploaded ({(names as string[]).join(', ')}) — solving would double-count it.</span>{' '}
                <button type="button" onClick={() => project.acknowledgeDuplicates(hash as string)} className="px-2 py-0.5 border border-amber-600 rounded hover:bg-amber-950">
                  Acknowledge duplicate
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {project.sources.length > 0 && (
        <section aria-label="Composition preview" className="border border-slate-700 rounded p-3 text-xs">
          <h3 className="font-medium mb-1">Composition preview</h3>
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1">
            <div><dt className="text-slate-500">Files</dt><dd>{project.summary.enabledFiles}/{project.summary.totalFiles} enabled</dd></div>
            <div><dt className="text-slate-500">Frame</dt><dd>{project.summary.agreedFrame} / {project.summary.agreedEpoch} / {project.summary.agreedEllipsoid}</dd></div>
            <div><dt className="text-slate-500">Stations</dt><dd>{project.summary.uniqueStations} ({project.summary.fixedStations} fixed, {project.summary.freeStations} free)</dd></div>
            <div><dt className="text-slate-500">Baselines</dt><dd>{project.summary.baselineCount} in {project.summary.componentCount} component(s)</dd></div>
            <div><dt className="text-slate-500">Datum</dt><dd>{project.summary.datumMode} · {project.summary.datumComponents.length} classified component(s)</dd></div>
            <div><dt className="text-slate-500">Duplicates</dt><dd>{project.summary.duplicateCandidates} candidate(s)</dd></div>
          </dl>
          {project.summary.controlBySource.length > 0 && (
            <p className="mt-1 text-slate-400">Control: {project.summary.controlBySource.join('; ')}</p>
          )}
          {project.summary.mergeNotes.length > 0 && (
            <ul className="mt-1 text-slate-400 list-disc ml-4">
              {project.summary.mergeNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
          {project.summary.warnings.length > 0 && (
            <ul className="mt-1 text-amber-300 list-disc ml-4">
              {project.summary.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
          {project.summary.blockingErrors.length > 0 && (
            <ul className="mt-1 text-red-300 list-disc ml-4">
              {project.summary.blockingErrors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {Object.keys(project.unionStations).length > 0 && (
        <section aria-label="Stations and control" className="border border-slate-700 rounded p-3">
          <h3 className="text-sm font-medium mb-2">Stations and datum control (full-XYZ only)</h3>
          <GnssStationTable stations={project.unionStations} onToggleFixed={project.toggleFixed} />
        </section>
      )}

      {project.sources.length > 0 && (
        <section aria-label="Datum handling" className="border border-slate-700 rounded p-3">
          <GnssDatumHandlingSelector value={project.datumMode} onChange={project.changeDatumMode} />
        </section>
      )}

      {project.sources.length > 0 && (
        <section aria-label="Setup uncertainty" className="border border-slate-700 rounded p-3 text-xs space-y-2">
          <h3 className="text-sm font-medium">Setup uncertainty (metres, 1-sigma)</h3>
          <div className="flex flex-wrap gap-3 items-center">
            <label htmlFor="gnss-multi-setup-centering">Centering σ EN (m)</label>
            <input id="gnss-multi-setup-centering" type="text" inputMode="decimal" value={project.centeringSigma} onChange={(event) => { project.setCenteringSigma(event.target.value); }} className="bg-slate-800 border border-slate-700 rounded px-2 py-1 w-24" />
            <label htmlFor="gnss-multi-setup-height">Height σ Up (m)</label>
            <input id="gnss-multi-setup-height" type="text" inputMode="decimal" value={project.heightSigma} onChange={(event) => { project.setHeightSigma(event.target.value); }} className="bg-slate-800 border border-slate-700 rounded px-2 py-1 w-24" />
            {project.sigmaInvalid && <span role="alert" className="text-red-300">Setup sigmas must be finite numbers ≥ 0 m.</span>}
          </div>
        </section>
      )}

      <div>
        <button
          type="button"
          onClick={() => void project.solve(worker.run)}
          disabled={!canSolve || project.summary.status === 'BLOCKED'}
          className="px-4 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 rounded text-sm font-medium"
        >
          {running ? 'Adjusting…' : 'Adjust composed project (production route)'}
        </button>
      </div>

      {project.runError && (
        <div role="alert" className="border border-red-700 bg-red-950/50 rounded p-3 text-xs text-red-200 whitespace-pre-wrap">
          {runError ? runError.text : project.runError}
        </div>
      )}

      {project.stale && (
        <p role="status" className="text-xs text-amber-300">
          Project changed since the last run — result is stale. Re-adjust to refresh.
        </p>
      )}

      {project.snapshot && (
        <>
          <GnssResultsPanel
            input={project.snapshot.input}
            outcome={project.snapshot.outcome}
            review={review}
            reportSuffix={review ? buildGnssMultifileExportLines(review) : undefined}
            jsonExtra={review ? { multifile: buildGnssMultifileExportJson(review) } : undefined}
          />
          <details className="border border-slate-700 rounded p-3 text-xs">
            <summary className="cursor-pointer text-slate-300">Multifile composition provenance</summary>
            <pre className="mt-2 whitespace-pre-wrap text-slate-400">{project.provenanceLines.join('\n')}</pre>
          </details>
        </>
      )}
    </div>
  );
};
