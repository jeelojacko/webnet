/**
 * Phase 12J.9 Track D — raw session intake + run panel (REVIEW_ONLY).
 *
 * Multi-obs slots (2-20 + NAV + SP3/ANTEX), inventory, duplicates, tree picker
 * with base selector, antenna table, common window, bounded run at PAR=2.
 */
import React, { useMemo, useRef, useState } from 'react';
import {
  buildManualGraph,
  buildMstGraph,
  buildStarGraph,
  validateSessionGraph,
  type SessionGraph,
} from '../../engine/gnssRawSessionGraph';
import {
  detectDuplicates,
  planSessionInterval,
  resolveSessionAntennas,
  resolveSessionWindow,
  sessionIdentity,
  validateIntakeSize,
  type SessionAntennaTable,
} from '../../engine/gnssRawSessionModel';
import { createAntexSubsetCache, type GnssAntexSubsetResult } from '../../engine/gnssAntexSubset';
import type { RawGnssFileMetadata } from '../../engine/gnssRawTypes';
import {
  reopenRawSession,
  type ProcessedRawGnssSession,
} from '../../engine/gnssRawSessionExport';
import {
  DEFAULT_RAW_OPTIONS,
  readFileEntry,
  type RawBaselineOptions,
  type RawFileEntry,
} from '../../hooks/useGnssRawBaseline';
import { useGnssRawSession, replaceSessionEdge } from '../../hooks/useGnssRawSession';
import { GnssRawOptionsForm } from './GnssRawOptionsForm';
import { GnssRawSessionReview } from './GnssRawSessionReview';
import {
  buildProcessedSession,
  buildSessionEdgeSpecs,
  coverageText,
  duplicateMarkerBlocker,
  durationText,
  parseManualPairs,
  parseOccupations,
  prepareAntexSubset,
  readSessionAntexEntry,
  suggestReplacementPair,
  type OccupationEntry,
} from './GnssRawSessionPanel.utils';

type TreePolicy = 'STAR' | 'MST' | 'MANUAL';

/**
 * TOCTOU freeze: captured once at process-click, the ONLY source the
 * final session assembly and §27 single-edge reprocessing read. Later
 * intake/option/policy edits cannot leak into a running or settled run.
 */
interface RunSnapshot {
  readonly sessionId: string;
  readonly occupations: OccupationEntry[];
  readonly markers: string[];
  readonly stationFiles: RawGnssFileMetadata[];
  readonly graph: SessionGraph;
  readonly options: RawBaselineOptions;
  readonly nav: RawFileEntry[];
  readonly sp3: RawFileEntry | null;
  readonly windowStart: string;
  readonly windowStop: string;
  readonly windowExplicit: boolean;
  readonly intervalResolved: number;
  readonly treePolicy: string;
  readonly base: string;
  readonly antennas: SessionAntennaTable;
  readonly obsSha256: string[];
  readonly navSha256: string[];
  readonly antex: GnssAntexSubsetResult | null;
}

interface PanelProps {
  readonly onRestart: () => void;
}

export const GnssRawSessionPanel: React.FC<PanelProps> = ({ onRestart }) => {
  const [obs, setObs] = useState<RawFileEntry[]>([]);
  const [nav, setNav] = useState<RawFileEntry[]>([]);
  const [sp3, setSp3] = useState<RawFileEntry | null>(null);
  const [antexFile, setAntexFile] = useState<RawFileEntry | null>(null);
  const [antexLabel, setAntexLabel] = useState('');
  const [antexResult, setAntexResult] = useState<GnssAntexSubsetResult | null>(null);
  const [antexWarning, setAntexWarning] = useState<string | null>(null);
  const antexCache = useMemo(() => createAntexSubsetCache(), []);
  const [options, setOptions] = useState<RawBaselineOptions>(DEFAULT_RAW_OPTIONS);
  const [policy, setPolicy] = useState<TreePolicy>('STAR');
  const [base, setBase] = useState('');
  const [manualText, setManualText] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [reimportError, setReimportError] = useState<string | null>(null);
  const [imported, setImported] = useState<ProcessedRawGnssSession | null>(null);
  const [started, setStarted] = useState(false);
  const snapRef = useRef<RunSnapshot | null>(null);
  const [snapRev, setSnapRev] = useState(0);
  const [repairs, setRepairs] = useState<Readonly<Record<string, string>>>({});
  const [replaceText, setReplaceText] = useState<Readonly<Record<string, string>>>({});
  const [replaceError, setReplaceError] = useState<Readonly<Record<string, string | null>>>({});
  const session = useGnssRawSession(2);

  const addFiles = async (files: File[], kind: 'obs' | 'nav'): Promise<void> => {
    setFileError(null);
    try {
      const entries: RawFileEntry[] = [];
      for (const f of files) entries.push(await readFileEntry(f));
      if (kind === 'obs') {
        if (obs.length + entries.length > 20) {
          setFileError('Session bound: max 20 observation files.');
          return;
        }
        setObs((prev) => [...prev, ...entries]);
      } else {
        setNav((prev) => [...prev, ...entries]);
      }
    } catch (e) {
      setFileError(e instanceof Error ? e.message : String(e));
    }
  };

  const occupations: OccupationEntry[] = useMemo(() => parseOccupations(obs), [obs]);

  const invalid = occupations.filter((o) => o.meta.firstEpoch == null || o.meta.marker == null);
  const sizeCheck = validateIntakeSize(occupations);
  const duplicates = useMemo(() => detectDuplicates(occupations), [occupations]);
  const dupBlocker = useMemo(() => duplicateMarkerBlocker(occupations), [occupations]);
  const explicitWindow = options.windowStart.trim() !== '' || options.windowStop.trim() !== '';
  const windowResult = useMemo(
    () => (occupations.length > 0 ? resolveSessionWindow(
      occupations,
      explicitWindow
        ? { mode: 'EXPLICIT', start: options.windowStart.trim(), stop: options.windowStop.trim() }
        : { mode: 'AUTO' },
    ) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [occupations, options.windowStart, options.windowStop],
  );
  const markers = useMemo(
    () => [...new Set(occupations.map((o) => o.meta.marker ?? o.fileName))].sort(),
    [occupations],
  );
  const graph: SessionGraph | null = useMemo(() => {
    if (occupations.length === 0) return null;
    if (policy === 'STAR') return buildStarGraph(occupations, base === '' ? undefined : base);
    if (policy === 'MST') return buildMstGraph(occupations);
    return buildManualGraph(occupations, parseManualPairs(manualText));
  }, [occupations, policy, base, manualText]);
  const graphValidation = graph ? validateSessionGraph(graph) : null;
  const antennas = useMemo(
    () => (occupations.length > 0 && graph ? resolveSessionAntennas(occupations, graph.edges) : null),
    [occupations, graph],
  );
  const intervalPlan = useMemo(
    () => (occupations.length > 0
      ? planSessionInterval(occupations, options.intervalMode === 'AUTO' ? 'AUTO' : options.intervalSeconds)
      : null),
    [occupations, options.intervalMode, options.intervalSeconds],
  );

  const blocker = (): string | null => {
    if (!sizeCheck.ok) return sizeCheck.message;
    if (invalid.length > 0) return `${invalid.length} file(s) failed header parse.`;
    if (dupBlocker) return dupBlocker;
    if (nav.length === 0) return 'At least one NAV file is required.';
    if (nav.length > 4) return 'Session bound: max 4 NAV files.';
    if (options.ephemeris === 'PRECISE' && !sp3) return 'Precise ephemeris needs an SP3 file.';
    if (!windowResult || !windowResult.ok) return 'No common session time.';
    if (!intervalPlan || intervalPlan.resolved == null) return 'No resolvable observation interval.';
    if (!graph || !graphValidation) return 'No planned tree.';
    if (!graphValidation.ok) return graphValidation.errors.join('; ');
    return null;
  };
  const blockReason = blocker();

  const run = async (): Promise<void> => {
    if (blockReason || !graph || !windowResult || !windowResult.ok
      || intervalPlan?.resolved == null || !antennas) return;
    let antex: GnssAntexSubsetResult | null = null;
    if (antexFile) {
      const plan = await prepareAntexSubset({
        sourceText: antexFile.text,
        occupations,
        validAt: windowResult.start,
        cache: antexCache,
      });
      antex = plan.result;
      setAntexResult(plan.result);
      setAntexWarning(plan.warning);
    } else {
      setAntexResult(null);
      setAntexWarning(null);
    }
    // Freeze everything the run may read: later intake/option edits
    // cannot perturb the in-flight or settled session (TOCTOU).
    const snap: RunSnapshot = {
      sessionId: sessionIdentity(occupations),
      occupations: occupations.map((o) => ({
        ...o, bytes: o.bytes.slice(), meta: { ...o.meta },
      })),
      markers,
      stationFiles: occupations.map((o) => o.meta),
      graph: { ...graph, markers: [...graph.markers], edges: [...graph.edges] },
      options: { ...options },
      nav: [...nav],
      sp3,
      windowStart: windowResult.start,
      windowStop: windowResult.stop,
      windowExplicit: explicitWindow,
      intervalResolved: intervalPlan.resolved,
      treePolicy: policy,
      base,
      antennas,
      obsSha256: obs.map((e) => e.sha256),
      navSha256: nav.map((e) => e.sha256),
      antex,
    };
    snapRef.current = snap;
    setImported(null);
    setRepairs({});
    setReplaceText({});
    setReplaceError({});
    setStarted(true);
    session.start(snap.sessionId, buildSessionEdgeSpecs({
      graph: snap.graph, occupations: snap.occupations, nav: snap.nav, sp3: snap.sp3,
      options: snap.options, windowStart: snap.windowStart, windowStop: snap.windowStop,
      resolvedInterval: snap.intervalResolved, antex: snap.antex,
    }));
    setSnapRev((v) => v + 1);
  };

  const settled = started && Object.values(session.snapshot).every(
    (s) => s !== 'queued' && s !== 'active',
  );
  const locked = started && !settled;
  // Final assembly reads ONLY the frozen snapshot — never live intake.
  const processed: ProcessedRawGnssSession | null = useMemo(() => {
    void snapRev;
    const snap = snapRef.current;
    if (!settled || !snap) return null;
    const edgeIds = snap.graph.edges.map((e) => `${e.from}->${e.to}`);
    const inGraph = new Set(edgeIds);
    const baselines = session.results.filter((b) => inGraph.has(`${b.from}->${b.to}`));
    const have = new Set(baselines.map((b) => `${b.from}->${b.to}`));
    return buildProcessedSession({
      graph: snap.graph, occupations: snap.occupations, markers: snap.markers,
      stationFiles: snap.stationFiles,
      baselines,
      options: snap.options, windowStart: snap.windowStart, windowStop: snap.windowStop,
      windowExplicit: snap.windowExplicit, intervalResolved: snap.intervalResolved,
      treePolicy: snap.treePolicy, antennaAssessment: snap.antennas, base: snap.base,
      obsSha256: snap.obsSha256, navSha256: snap.navSha256,
      sp3: snap.sp3, failedCount: edgeIds.filter((id) => !have.has(id)).length,
      antex: snap.antex,
    });
  }, [settled, snapRev, session.results]);
  const shown = imported ?? processed;

  /**
   * §27 repair: swap the failed leg for a caller-supplied pair, revalidate
   * (connected/N-1/acyclic via replaceSessionEdge), record provenance in
   * the frozen graph, and reprocess ONLY the new edge from the snapshot.
   */
  const replaceEdge = (edgeId: string): void => {
    const snap = snapRef.current;
    if (!snap || !settled) return;
    const cut = edgeId.indexOf('->');
    if (cut < 0) return;
    const from = edgeId.slice(0, cut);
    const to = edgeId.slice(cut + 2);
    const suggestion = suggestReplacementPair(snap.graph, { from, to });
    const text = replaceText[edgeId]
      ?? (suggestion ? `${suggestion.from}->${suggestion.to}` : '');
    const fail = (message: string): void =>
      setReplaceError((p) => ({ ...p, [edgeId]: message }));
    const pairs = parseManualPairs(text);
    if (pairs.length !== 1 || !pairs[0]) {
      fail('Enter one replacement pair as FROM->TO.');
      return;
    }
    const out = replaceSessionEdge(snap.graph, { from, to }, pairs[0]);
    if (!out.ok) {
      fail(out.errors.join('; '));
      return;
    }
    const specs = buildSessionEdgeSpecs({
      graph: out.graph, occupations: snap.occupations, nav: snap.nav, sp3: snap.sp3,
      options: snap.options, windowStart: snap.windowStart, windowStop: snap.windowStop,
      resolvedInterval: snap.intervalResolved, antex: snap.antex,
    });
    const spec = specs.find((s) => s.edgeId === `${pairs[0]!.from}->${pairs[0]!.to}`);
    if (!spec) {
      fail('Replacement endpoints match no staged occupation.');
      return;
    }
    try {
      session.requeue([spec]);
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
      return;
    }
    snapRef.current = { ...snap, graph: out.graph };
    session.forget(edgeId);
    setRepairs((p) => ({ ...p, [edgeId]: spec.edgeId }));
    setReplaceError((p) => ({ ...p, [edgeId]: null }));
    setSnapRev((v) => v + 1);
  };

  const reimport = async (file: File): Promise<void> => {
    setReimportError(null);
    try {
      setImported(reopenRawSession(await file.text()));
    } catch (e) {
      setReimportError(e instanceof Error ? e.message : String(e));
    }
  };

  const pickMany = (
    event: React.ChangeEvent<HTMLInputElement>, fn: (_files: File[]) => void,
  ): void => {
    const files = event.target.files ? [...event.target.files] : [];
    if (files.length > 0) void fn(files);
    event.target.value = '';
  };

  return (
    <div data-testid="raw-session-panel" className="space-y-3 p-4">
      <div className="text-xs text-slate-400">
        <p>Raw session review stages several occupations into a spanning tree of static
          baselines. Results are for review and export only.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-slate-300">
        <label className="block">
          Observation files (2–20 RINEX .o/.obs)
          <input type="file" data-testid="raw-session-obs-input" multiple accept=".o,.obs,.06o,.24o,.rnx,.txt"
            disabled={locked}
            onChange={(e) => pickMany(e, (f) => addFiles(f, 'obs'))}
            className="mt-1 block w-full text-xs text-slate-400" />
          {obs.map((e) => (
            <span key={e.sha256} className="block text-slate-400">{e.fileName}{' '}
              <button type="button" disabled={locked} onClick={() => setObs((p) => p.filter((x) => x.sha256 !== e.sha256))}
                className="underline">remove</button>
            </span>
          ))}
        </label>
        <label className="block">
          NAV broadcast ephemeris (one or more)
          <input type="file" data-testid="raw-session-nav-input" multiple accept=".nav,.06n,.rnx,.txt"
            disabled={locked}
            onChange={(e) => pickMany(e, (f) => addFiles(f, 'nav'))}
            className="mt-1 block w-full text-xs text-slate-400" />
          {nav.map((e) => (
            <span key={e.sha256} className="block text-slate-400">{e.fileName}{' '}
              <button type="button" disabled={locked} onClick={() => setNav((p) => p.filter((x) => x.sha256 !== e.sha256))}
                className="underline">remove</button>
            </span>
          ))}
        </label>
        <label className="block">
          SP3 precise ephemeris (optional)
          <input type="file" data-testid="raw-session-sp3-input" accept=".sp3,.txt"
            disabled={locked}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void readFileEntry(f).then(setSp3, (err: unknown) =>
                setFileError(err instanceof Error ? err.message : String(err)));
              e.target.value = '';
            }}
            className="mt-1 block w-full text-xs text-slate-400" />
          {sp3 && <span className="block text-slate-400">{sp3.fileName}{' '}
            <button type="button" disabled={locked} onClick={() => setSp3(null)} className="underline">remove</button></span>}
        </label>
        <label className="block">
          ANTEX antenna calibration (optional)
          <input type="file" data-testid="raw-session-antex-input" accept=".atx,.txt"
            disabled={locked}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void readSessionAntexEntry(f).then((entry) => {
                setAntexFile(entry);
                if (antexLabel === '') setAntexLabel(entry.fileName);
              }, (err: unknown) =>
                setFileError(err instanceof Error ? err.message : String(err)));
              e.target.value = '';
            }}
            className="mt-1 block w-full text-xs text-slate-400" />
          {antexFile && <span className="block text-slate-400">{antexFile.fileName}{' '}
            <button type="button" disabled={locked} onClick={() => { setAntexFile(null); setAntexResult(null); setAntexWarning(null); }}
              className="underline">remove</button></span>}
          {antexResult && (
            <span data-testid="raw-session-antex-info" className="block text-slate-400">
              subset {antexResult.subsetSha256.slice(0, 16)}… · {antexResult.subsetSizeBytes} bytes ·
              {' '}{antexResult.receiverSerials.join(', ') || 'satellites only'}
            </span>
          )}
          {antexWarning && (
            <span data-testid="raw-session-antex-warning" className="block text-amber-300">
              {antexWarning}
            </span>
          )}
        </label>
        <label className="block">
          ANTEX label (provenance only, optional)
          <input type="text" data-testid="raw-session-antex" value={antexLabel}
            disabled={locked}
            onChange={(e) => setAntexLabel(e.target.value)} placeholder="e.g. igs20.atx"
            className="mt-1 block w-full bg-slate-800 border border-slate-600 px-1 py-0.5" />
        </label>
      </div>
      <fieldset disabled={locked} className="m-0 border-0 p-0 min-w-0">
        <GnssRawOptionsForm options={options} onChange={setOptions} />
      </fieldset>
      {fileError && <div data-testid="raw-session-file-error" className="text-xs text-red-300">{fileError}</div>}
      {occupations.length > 0 && (
        <table data-testid="raw-session-inventory" className="w-full text-xs text-slate-300 border border-slate-700">
          <thead>
            <tr className="bg-slate-800">
              <th className="p-1 text-left">Station</th><th className="p-1 text-left">Start</th>
              <th className="p-1 text-left">Stop</th><th className="p-1 text-left">Duration</th>
              <th className="p-1 text-left">Coverage</th>
            </tr>
          </thead>
          <tbody>
            {occupations.map((o) => {
              const key = o.meta.marker ?? o.fileName;
              const shortened = windowResult?.ok
                && ((o.meta.firstEpoch ?? '') < windowResult.start || (o.meta.lastEpoch ?? '') > windowResult.stop);
              return (
                <tr key={`${key}-${o.meta.sha256}`} className="border-t border-slate-700">
                  <td className="p-1">{key}</td>
                  <td className="p-1">{o.meta.firstEpoch ?? '—'}</td>
                  <td className="p-1">{o.meta.lastEpoch ?? '—'}</td>
                  <td className="p-1">{durationText(o.meta.firstEpoch, o.meta.lastEpoch)}</td>
                  <td className="p-1">
                    {windowResult?.ok
                      ? coverageText(o.meta.firstEpoch, o.meta.lastEpoch, windowResult.start, windowResult.stop)
                      : '—'}
                    {shortened && <span className="ml-1 text-amber-300">shortened</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {duplicates.length > 0 && (
        <div data-testid="raw-session-duplicates" className="text-xs text-amber-300">
          <ul className="list-disc pl-5">{duplicates.map((d) => <li key={d}>{d}</li>)}</ul>
        </div>
      )}
      {occupations.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
          <label className="block">Tree policy
            <select data-testid="raw-session-policy" value={policy}
              disabled={locked}
              onChange={(e) => setPolicy(e.target.value as TreePolicy)}
              className="ml-1 bg-slate-800 border border-slate-600 px-1 py-0.5">
              <option value="STAR">STAR</option>
              <option value="MST">MST</option>
              <option value="MANUAL">MANUAL</option>
            </select>
          </label>
          <label className="block">Base
            <select data-testid="raw-session-base" value={base}
              disabled={locked}
              onChange={(e) => setBase(e.target.value)}
              className="ml-1 bg-slate-800 border border-slate-600 px-1 py-0.5">
              <option value="">auto (first marker)</option>
              {markers.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          {policy === 'MST' && <span className="text-slate-500">MST ignores the base selector.</span>}
          {windowResult?.ok && (
            <span data-testid="raw-session-window" className="text-slate-300">
              Window {explicitWindow ? 'EXPLICIT' : 'AUTO'} · {windowResult.start} .. {windowResult.stop}
            </span>
          )}
          {windowResult && !windowResult.ok && (
            <span data-testid="raw-session-window-error" className="text-red-300">{windowResult.message}</span>
          )}
        </div>
      )}
      {policy === 'MANUAL' && (
        <label className="block text-xs text-slate-300">Manual legs (one FROM-TO per line)
          <textarea data-testid="raw-session-manual" value={manualText}
            disabled={locked}
            onChange={(e) => setManualText(e.target.value)} rows={3}
            className="mt-1 block w-full bg-slate-800 border border-slate-600 px-1 py-0.5" />
        </label>
      )}
      {graph && (
        <div data-testid="raw-session-edges" className="text-xs text-slate-300">
          {graph.kind} · {graph.edges.map((e) => `${e.from}→${e.to}`).join(', ') || 'no legs'}
        </div>
      )}
      {graphValidation && !graphValidation.ok && (
        <div data-testid="raw-session-graph-error" className="text-xs text-red-300">
          {graphValidation.errors.join('; ')}
        </div>
      )}
      {antennas && (
        <div>
          <table data-testid="raw-session-antennas" className="w-full text-xs text-slate-300 border border-slate-700">
            <thead>
              <tr className="bg-slate-800">
                <th className="p-1 text-left">Station</th><th className="p-1 text-left">Antenna</th>
                <th className="p-1 text-left">Radome</th><th className="p-1 text-left">Resolution</th>
              </tr>
            </thead>
            <tbody>
              {antennas.stations.map((s) => (
                <tr key={s.marker} className="border-t border-slate-700">
                  <td className="p-1">{s.marker}</td>
                  <td className="p-1">{s.model.split(/\s+/)[0] || '—'}</td>
                  <td className="p-1">{s.model.split(/\s+/).slice(1).join(' ') || '—'}</td>
                  <td className="p-1">{s.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {antennas.overall !== 'COMPLETE' && (
            <div data-testid="raw-session-antenna-banner" className="text-xs text-amber-300">
              Antenna calibration {antennas.overall}: formal precision only, nothing substituted.
              {antexWarning && <span className="block">{antexWarning}</span>}
            </div>
          )}
        </div>
      )}
      <div className="flex items-center gap-2">
        <button type="button" data-testid="raw-session-process" onClick={() => void run()}
          disabled={blockReason != null || (started && !settled)}
          className="px-2 py-1 text-xs border border-slate-600 rounded hover:bg-slate-700 disabled:opacity-40">
          Process raw session
        </button>
        {started && !settled && (
          <button type="button" data-testid="raw-session-cancel" onClick={() => session.cancel()}
            className="px-2 py-1 text-xs border border-slate-600 rounded hover:bg-slate-700">
            Cancel
          </button>
        )}
        {(settled || imported) && (
          <button type="button" data-testid="raw-session-restart" onClick={() => { session.reset(); onRestart(); }}
            className="px-2 py-1 text-xs border border-slate-600 rounded hover:bg-slate-700">
            Start over
          </button>
        )}
      </div>
      {blockReason && occupations.length > 0 && (
        <div data-testid="raw-session-blocker" className="text-xs text-slate-500">{blockReason}</div>
      )}
      {started && !settled && (
        <div data-testid="raw-session-progress" className="text-xs text-slate-300">
          <ul className="list-disc pl-5">
            {Object.entries(session.snapshot).map(([edge, state]) => (
              <li key={edge}>{edge}: {state}</li>
            ))}
          </ul>
        </div>
      )}
      {settled && session.failed.length > 0 && snapRef.current && (
        <div data-testid="raw-session-failed" className="text-xs text-amber-300">
          Failed edge(s): {session.failed.join(', ')}
          <ul className="list-disc pl-5">
            {Object.entries(session.failedDetails).map(([edge, why]) => {
              const cut = edge.indexOf('->');
              const suggestion = cut >= 0 && snapRef.current
                ? suggestReplacementPair(snapRef.current.graph, {
                  from: edge.slice(0, cut), to: edge.slice(cut + 2),
                })
                : null;
              const prefill = suggestion ? `${suggestion.from}->${suggestion.to}` : '';
              const repairedAs = repairs[edge];
              const repairedState = repairedAs ? session.snapshot[repairedAs] : undefined;
              return (
                <li key={edge}>{edge}: {why}
                  {repairedAs && (
                    <span className="ml-1 text-slate-400">
                      replaced by {repairedAs}{repairedState ? ` (${repairedState})` : ''}
                    </span>
                  )}
                  <label className="ml-2 text-slate-300">Replace with
                    <input type="text" data-testid={`raw-session-replace-${edge}`} value={replaceText[edge] ?? prefill}
                      placeholder={prefill === '' ? 'FROM->TO' : prefill}
                      onChange={(e) => setReplaceText((p) => ({ ...p, [edge]: e.target.value }))}
                      className="ml-1 bg-slate-800 border border-slate-600 px-1 py-0.5" />
                  </label>
                  <button type="button" data-testid={`raw-session-replace-go-${edge}`} onClick={() => replaceEdge(edge)}
                    className="ml-1 px-1 py-0.5 border border-slate-600 rounded hover:bg-slate-700 text-slate-200">
                    Replace
                  </button>
                  {replaceError[edge] && <span className="ml-1 text-red-300">{replaceError[edge]}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <div className="text-xs text-slate-300">
        <label className="block">Reimport session JSON for review (parse-only, never reprocesses)
          <input type="file" data-testid="raw-session-reimport-input" accept=".json"
            disabled={locked}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void reimport(f);
              e.target.value = '';
            }}
            className="mt-1 block w-full text-xs text-slate-400" />
        </label>
        {reimportError && <div data-testid="raw-session-reimport-error" className="text-xs text-red-300">{reimportError}</div>}
      </div>
      {shown && <GnssRawSessionReview session={shown} />}
    </div>
  );
};
