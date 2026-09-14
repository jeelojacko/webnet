/**
 * Phase 12J.9 Track D — raw session intake + run panel (REVIEW_ONLY).
 * Phase 12J.10 — split into hook + cohesive components, zero behavior change:
 * intake/inventory/graph/progress own their JSX; useRawGnssSessionProcessing
 * owns the run snapshot, launch guard, repair, and reimport state machine.
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
  validateIntakeSize,
} from '../../engine/gnssRawSessionModel';
import { DEFAULT_RAW_OPTIONS, readFileEntry, type RawBaselineOptions, type RawFileEntry } from '../../hooks/useGnssRawBaseline';
import {
  useRawGnssSessionProcessing,
  type RawSessionRunInput,
} from '../../hooks/useRawGnssSessionProcessing';
import { GnssRawOptionsForm } from './GnssRawOptionsForm';
import { GnssRawSessionReview } from './GnssRawSessionReview';
import { RawGnssSessionIntake } from './RawGnssSessionIntake';
import { RawGnssSessionInventory } from './RawGnssSessionInventory';
import {
  RawGnssSessionGraphControls,
  type RawSessionTreePolicy,
} from './RawGnssSessionGraphControls';
import { RawGnssSessionProgress } from './RawGnssSessionProgress';
import {
  duplicateMarkerBlocker,
  parseManualPairs,
  parseOccupations,
} from './GnssRawSessionPanel.utils';

interface PanelProps {
  readonly onRestart: () => void;
}

export const GnssRawSessionPanel: React.FC<PanelProps> = ({ onRestart }) => {
  const [obs, setObs] = useState<RawFileEntry[]>([]);
  const [nav, setNav] = useState<RawFileEntry[]>([]);
  const [sp3, setSp3] = useState<RawFileEntry | null>(null);
  const [options, setOptions] = useState<RawBaselineOptions>(DEFAULT_RAW_OPTIONS);
  const [policy, setPolicy] = useState<RawSessionTreePolicy>('STAR');
  const [base, setBase] = useState('');
  const [manualText, setManualText] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const proc = useRawGnssSessionProcessing();

  // In-flight read counter: overlapping file-picker selections each pass
  // the pre-read bound against staged + already-pending files, so the
  // memory bound holds absolutely, not just per selection event.
  const pendingRef = useRef(0);
  const addFiles = async (files: File[], kind: 'obs' | 'nav'): Promise<void> => {
    setFileError(null);
    // Pre-read bounds: reject oversized selections before allocating bytes.
    if (kind === 'obs' && obs.length + pendingRef.current + files.length > 20) {
      setFileError('Session bound: max 20 observation files.');
      return;
    }
    if (kind === 'nav' && nav.length + pendingRef.current + files.length > 4) {
      setFileError('Session bound: max 4 NAV files.');
      return;
    }
    pendingRef.current += files.length;
    try {
      const entries: RawFileEntry[] = [];
      for (const f of files) entries.push(await readFileEntry(f));
      if (kind === 'obs') setObs((prev) => [...prev, ...entries]);
      else setNav((prev) => [...prev, ...entries]);
    } catch (e) {
      setFileError(e instanceof Error ? e.message : String(e));
    } finally {
      pendingRef.current -= files.length;
    }
  };

  const occupations = useMemo(() => parseOccupations(obs), [obs]);

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

  const runInput: RawSessionRunInput | null = graph && windowResult?.ok
    && intervalPlan?.resolved != null && antennas
    ? {
      occupations, markers,
      stationFiles: occupations.map((o) => o.meta),
      graph, options, nav, sp3,
      windowStart: windowResult.start,
      windowStop: windowResult.stop,
      windowExplicit: explicitWindow,
      intervalResolved: intervalPlan.resolved,
      treePolicy: policy,
      base, antennas,
      obsSha256: obs.map((e) => e.sha256),
      navSha256: nav.map((e) => e.sha256),
    }
    : null;
  const run = (): void => {
    if (blockReason || !runInput) return;
    void proc.run(runInput);
  };

  return (
    <div data-testid="raw-session-panel" className="space-y-3 p-4">
      <div className="text-xs text-slate-400">
        <p>Raw session review stages several occupations into a spanning tree of static
          baselines. Results are for review and export only.</p>
      </div>
      <RawGnssSessionIntake
        locked={proc.locked}
        obs={obs} nav={nav} sp3={sp3}
        antexFile={proc.antexFile} antexLabel={proc.antexLabel}
        antexResult={proc.antexResult} antexWarning={proc.antexWarning}
        fileError={fileError}
        onAddFiles={(f, kind) => void addFiles(f, kind)}
        onRemoveObs={(sha) => setObs((p) => p.filter((x) => x.sha256 !== sha))}
        onRemoveNav={(sha) => setNav((p) => p.filter((x) => x.sha256 !== sha))}
        onSp3={setSp3}
        onAntexEntry={proc.setAntexFile}
        onClearAntex={proc.clearAntex}
        onAntexLabel={proc.setAntexLabel}
        onFileError={setFileError}
      />
      <fieldset disabled={proc.locked} className="m-0 border-0 p-0 min-w-0">
        <GnssRawOptionsForm options={options} onChange={setOptions} />
      </fieldset>
      <RawGnssSessionInventory occupations={occupations} windowResult={windowResult} duplicates={duplicates} />
      <RawGnssSessionGraphControls
        locked={proc.locked}
        occupations={occupations}
        policy={policy} base={base} manualText={manualText} markers={markers}
        explicitWindow={explicitWindow} windowResult={windowResult}
        graph={graph}
        graphErrors={graphValidation && !graphValidation.ok ? graphValidation.errors : null}
        antennas={antennas} antexWarning={proc.antexWarning}
        onPolicy={setPolicy} onBase={setBase} onManualText={setManualText}
      />
      <RawGnssSessionProgress
        started={proc.started} settled={proc.settled} preparing={proc.preparing}
        canProcess={blockReason == null}
        hasOccupations={occupations.length > 0}
        hasResult={proc.settled || proc.imported != null}
        blockReason={blockReason}
        snapshot={proc.snapshot}
        failed={proc.failed} failedDetails={proc.failedDetails} graph={proc.graph}
        repairs={proc.repairs} replaceText={proc.replaceText} replaceError={proc.replaceError}
        reimportError={proc.reimportError}
        runLocked={proc.locked}
        onProcess={run}
        onCancel={proc.cancel}
        onRestart={() => { proc.resetPool(); onRestart(); }}
        onReplaceText={(edge, text) => proc.setReplaceText((p) => ({ ...p, [edge]: text }))}
        onReplaceEdge={(edge, prefill) => proc.replaceEdge(edge, prefill)}
        onReimport={(f) => void proc.reimport(f)}
      />
      {proc.shown && <GnssRawSessionReview session={proc.shown} />}
    </div>
  );
};
