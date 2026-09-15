/**
 * Phase 13F B1 — multi-file GNSS project hook (production wiring).
 *
 * Owns the project source list (add/remove/enable/rename/reorder), parses
 * each ENABLED source via parseGnssProjectSources, previews via
 * summarizeGnssProjectComposition, and solves by building the composed
 * input with buildGnssMultifileAdjustInput and posting it through the
 * existing worker path. No math lives here; engine errors surface verbatim.
 *
 * Snapshot policy (B2 audit): the last run snapshot is frozen and NEVER
 * cleared by edits — any edit only flips the STALE flag via the run
 * fingerprint until the next solve replaces it. Late results from a
 * superseded run are dropped by the sequence guard (no worker cancel:
 * composition itself is synchronous, so there is nothing to cancel).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StationMap } from '../types';
import type { GnssMultifileProvenance } from '../engine/gnssMultifileComposition';
import type { GnssBaselineAdjustInput } from '../engine/gnssBaselineAdjust';
import {
  buildGnssMultifileAdjustInput,
  buildGnssMultifileProvenanceSection,
  buildGnssProjectStationSourceTrace,
  findNonPortableProjectPaths,
  parseGnssProjectSources,
  summarizeGnssProjectComposition,
  type GnssPrecompositionSummary,
  type GnssProjectParsedSource,
} from '../engine/gnssMultifileProject';
import {
  defaultGnssMultifileProjectStore,
  loadGnssMultifileProject,
  saveGnssMultifileProject,
  type GnssMultifileProjectStore,
} from '../engine/gnssMultifilePersistence';
import type { GnssDatumMode } from '../engine/gnssFreeNetwork';
import { setStationFixed } from '../engine/gnssWorkspaceSession';
import { buildValueFingerprint } from '../engine/qaWorkflowSnapshots';
import { createProjectFileId, type ProjectManifestFileEntry } from '../engine/projectWorkspace';
import type { GnssRunOutcome } from './useGnssBaselineWorker';

export interface GnssProjectFileState {
  readonly id: string;
  readonly name: string;
  readonly text: string;
  readonly enabled: boolean;
  readonly order: number;
}

export interface GnssProjectSourceStatus {
  readonly fileId: string;
  readonly fileName: string;
  readonly enabled: boolean;
  readonly status: 'READY' | 'WARNING' | 'ERROR' | 'DISABLED';
  readonly kind: string;
  readonly stations: number;
  readonly baselines: number;
  readonly fixed: number;
  readonly free: number;
  readonly frame: string;
  readonly epoch: string;
  readonly ellipsoid: string;
  readonly hash: string;
  readonly messages: string[];
}

export interface GnssProjectFrozenSource {
  readonly id: string;
  readonly name: string;
  readonly hash: string;
  readonly order: number;
}

export interface GnssProjectFrozenStationDecl {
  readonly sourceId: string;
  readonly fileName: string;
  readonly control: 'FIXED' | 'FREE';
}

export interface GnssProjectRunSnapshot {
  readonly fingerprint: string;
  readonly provenance: GnssMultifileProvenance[];
  readonly mergeNotes: string[];
  readonly input: GnssBaselineAdjustInput;
  readonly outcome: GnssRunOutcome;
  /**
   * Frozen solve-time review/export context. Render and export read ONLY
   * these fields: later edits (rename, retoggle, reorder, datum change)
   * must never be attributed to this solution. Edits only flip the STALE
   * flag via the run fingerprint until the next solve replaces the snapshot.
   */
  readonly enabledSources: GnssProjectFrozenSource[];
  readonly datumMode: GnssDatumMode;
  readonly warnings: string[];
  readonly controlBySource: string[];
  readonly stationTrace: Record<string, GnssProjectFrozenStationDecl[]>;
  readonly composedControl: Record<string, 'FIXED' | 'FREE'>;
}

export interface GnssMultifileProjectOptions {
  /** Named-project id scoping the durable store (default 'scratch'). */
  readonly projectId?: string;
  /** Durability store (default localStorage; null disables persistence). */
  readonly store?: GnssMultifileProjectStore | null;
}

export type GnssProjectRunFn = (_input: GnssBaselineAdjustInput) => Promise<GnssRunOutcome>;

const sortedSources = (sources: GnssProjectFileState[]): GnssProjectFileState[] =>
  [...sources].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

const toManifestEntries = (sources: GnssProjectFileState[]): ProjectManifestFileEntry[] =>
  sortedSources(sources).map((source) => ({
    id: source.id,
    name: source.name,
    kind: 'gnss',
    path: `data/${source.id}-${source.name}`,
    enabled: source.enabled,
    order: source.order,
  }));

const toSourceTexts = (sources: GnssProjectFileState[]): Record<string, string> =>
  Object.fromEntries(sources.map((source) => [source.id, source.text]));

const statusOf = (entry: GnssProjectParsedSource, hash: string): GnssProjectSourceStatus => {
  const errors = entry.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  const warnings = entry.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning');
  const stations = entry.network ? Object.keys(entry.network.stations).length : 0;
  const baselines = entry.network?.baselines.length ?? 0;
  let fixed = 0;
  if (entry.network) {
    Object.values(entry.network.stations).forEach((station) => {
      if (station?.fixedX && station?.fixedY && station?.fixedH) fixed += 1;
    });
  }
  const status = errors.length > 0 || (entry.network == null && entry.kind !== 'ignored' && entry.kind !== 'terrestrial')
    ? 'ERROR'
    : warnings.length > 0 ? 'WARNING' : 'READY';
  return {
    fileId: entry.fileId,
    fileName: entry.fileName,
    enabled: true,
    status,
    kind: entry.kind,
    stations,
    baselines,
    fixed,
    free: stations - fixed,
    frame: entry.network?.frame.referenceFrame ?? 'unknown',
    epoch: entry.network?.frame.epoch ?? 'unknown',
    ellipsoid: entry.network?.frame.ellipsoid ?? 'unknown',
    hash,
    messages: entry.diagnostics.map((diagnostic) => diagnostic.message),
  };
};

export const useGnssMultifileProject = (options: GnssMultifileProjectOptions = {}) => {
  const projectId = options.projectId ?? 'scratch';
  const store = useMemo(
    () => (options.store === undefined ? defaultGnssMultifileProjectStore() : options.store),
    [options.store],
  );
  // Durable named-project state: hydrate once per mount/project-open from
  // the manifest-entries + content + settings-bag document (B1 'gnss'
  // kind + settings re-attach, actually used here).
  const [boot] = useState(() => loadGnssMultifileProject(projectId, store));
  const [sources, setSources] = useState<GnssProjectFileState[]>(() =>
    (boot?.entries ?? []).map((entry) => ({
      id: entry.id,
      name: entry.name,
      text: boot?.texts[entry.id] ?? '',
      enabled: entry.enabled,
      order: entry.order,
    })),
  );
  const [controlOverrides, setControlOverrides] = useState<Record<string, boolean>>(
    () => ({ ...(boot?.settings.controlOverrides ?? {}) }),
  );
  const [datumMode, setDatumMode] = useState<GnssDatumMode>(() => boot?.settings.datumMode ?? 'constrained');
  const [centeringSigma, setCenteringSigma] = useState(() => boot?.ui.centeringSigma ?? '0.000');
  const [heightSigma, setHeightSigma] = useState(() => boot?.ui.heightSigma ?? '0.000');
  const [acknowledgedHashes, setAcknowledgedHashes] = useState<string[]>(() => [
    ...(boot?.ui.acknowledgedHashes ?? []),
  ]);
  const [snapshot, setSnapshot] = useState<GnssProjectRunSnapshot | null>(
    () => (boot?.snapshot as GnssProjectRunSnapshot | null) ?? null,
  );
  const [runError, setRunError] = useState<string | null>(null);
  const [solving, setSolving] = useState(false);
  // Project open/switch: re-hydrate when the named project changes.
  // hydratedKey marks which (projectId, store) pair the live state
  // belongs to. It is STATE (not a ref) so the persistence effect in the
  // same commit still sees the previous pair and skips the stale write:
  // without this, the old project's entries would be saved under the new
  // project's key before hydration applies.
  const bootKey = useRef(projectId);
  const bootStore = useRef(store);
  const [hydratedKey, setHydratedKey] = useState(() => ({ id: projectId, store }));
  useEffect(() => {
    if (bootKey.current === projectId && bootStore.current === store) return;
    bootKey.current = projectId;
    bootStore.current = store;
    const next = loadGnssMultifileProject(projectId, store);
    setSources(
      (next?.entries ?? []).map((entry) => ({
        id: entry.id,
        name: entry.name,
        text: next?.texts[entry.id] ?? '',
        enabled: entry.enabled,
        order: entry.order,
      })),
    );
    setControlOverrides({ ...(next?.settings.controlOverrides ?? {}) });
    setDatumMode(next?.settings.datumMode ?? 'constrained');
    setCenteringSigma(next?.ui.centeringSigma ?? '0.000');
    setHeightSigma(next?.ui.heightSigma ?? '0.000');
    setAcknowledgedHashes([...(next?.ui.acknowledgedHashes ?? [])]);
    setSnapshot((next?.snapshot as GnssProjectRunSnapshot | null) ?? null);
    setRunError(null);
    setSolving(false);
    setHydratedKey({ id: projectId, store });
  }, [projectId, store]);
  // Run sequence: composition is synchronous (fast, non-cancellable) and
  // only the worker await below is async. A newer run supersedes an older
  // one — late results from an earlier run are dropped, never applied.
  // There is no worker cancel: a superseded run still finishes in the
  // background, its outcome is just ignored.
  const runSeq = useRef(0);

  const hashes = useMemo(
    () => Object.fromEntries(sources.map((source) => [source.id, buildValueFingerprint(source.text)])),
    [sources],
  );

  const entries = useMemo(() => toManifestEntries(sources), [sources]);
  const sourceTexts = useMemo(() => toSourceTexts(sources), [sources]);

  const setup = useMemo(
    () => ({
      horizontalCenteringSigma: Number(centeringSigma),
      antennaHeightSigma: Number(heightSigma),
    }),
    [centeringSigma, heightSigma],
  );
  const sigmaInvalid =
    !Number.isFinite(setup.horizontalCenteringSigma) ||
    setup.horizontalCenteringSigma < 0 ||
    !Number.isFinite(setup.antennaHeightSigma) ||
    setup.antennaHeightSigma < 0;

  const parsed = useMemo(
    () => parseGnssProjectSources(entries, sourceTexts),
    [entries, sourceTexts],
  );
  const summary: GnssPrecompositionSummary = useMemo(
    () => summarizeGnssProjectComposition(parsed, sources.length, { controlOverrides, datumMode }),
    [parsed, sources.length, controlOverrides, datumMode],
  );

  const sourceStatuses: GnssProjectSourceStatus[] = useMemo(() => {
    const byId = new Map(parsed.map((entry) => [entry.fileId, entry]));
    return sortedSources(sources).map((source) => {
      const entry = byId.get(source.id);
      if (!entry) {
        return {
          fileId: source.id, fileName: source.name, enabled: false, status: 'DISABLED',
          kind: 'unknown', stations: 0, baselines: 0, fixed: 0, free: 0,
          frame: 'unknown', epoch: 'unknown', ellipsoid: 'unknown',
          hash: hashes[source.id] ?? '', messages: [],
        } satisfies GnssProjectSourceStatus;
      }
      return statusOf(entry, hashes[source.id] ?? '');
    });
  }, [parsed, sources, hashes]);

  const unionStations: StationMap = useMemo(() => {
    const next: StationMap = {};
    parsed.forEach((entry) => {
      if (!entry.network) return;
      Object.entries(entry.network.stations).forEach(([id, station]) => {
        if (!next[id]) next[id] = { ...station };
      });
    });
    const withOverrides = { ...next };
    Object.keys(controlOverrides)
      .sort()
      .forEach((id) => {
        if (withOverrides[id]) Object.assign(withOverrides, setStationFixed(withOverrides, id, controlOverrides[id] ?? false));
      });
    return withOverrides;
  }, [parsed, controlOverrides]);

  const duplicateGroups: string[][] = useMemo(() => {
    const byHash = new Map<string, string[]>();
    sortedSources(sources).forEach((source) => {
      if (!source.enabled || source.text.trim() === '') return;
      const hash = hashes[source.id] ?? '';
      byHash.set(hash, [...(byHash.get(hash) ?? []), source.name]);
    });
    return [...byHash.entries()]
      .filter(([, names]) => names.length > 1)
      .map(([hash, names]) => [hash, ...names])
      .sort((a, b) => (a[0] as string).localeCompare(b[0] as string));
  }, [sources, hashes]);
  const unacknowledgedDuplicates = duplicateGroups.filter(
    ([hash]) => !acknowledgedHashes.includes(hash as string),
  );

  const nonPortableIds = useMemo(() => findNonPortableProjectPaths(entries), [entries]);
  const missingSources = useMemo(
    () => sources.filter((source) => source.enabled && source.text.trim() === '').map((source) => source.name).sort(),
    [sources],
  );

  const runFingerprint = useMemo(
    () =>
      buildValueFingerprint({
        hashes: sortedSources(sources).filter((source) => source.enabled).map((source) => hashes[source.id] ?? ''),
        order: sortedSources(sources).filter((source) => source.enabled).map((source) => source.id),
        // Display names ride the frozen export block: a rename must banner
        // stale (the frozen solution keeps its solve-time names).
        names: sortedSources(sources).filter((source) => source.enabled).map((source) => source.name),
        datumMode,
        controlOverrides,
        setup,
      }),
    [sources, hashes, datumMode, controlOverrides, setup],
  );
  const stale = snapshot != null && snapshot.fingerprint !== runFingerprint;

  const addSource = useCallback((name: string, text: string): void => {
    const trimmed = name.trim() === '' ? 'gnss-source' : name.trim();
    const id = createProjectFileId();
    setSources((prev) => {
      const prevMax = prev.reduce((max, source) => Math.max(max, source.order), -1);
      return [...prev, { id, name: trimmed, text, enabled: true, order: prevMax + 1 }];
    });
  }, []);

  const removeSource = useCallback((id: string): void => {
    setSources((prev) => prev.filter((source) => source.id !== id));
  }, []);

  const toggleSource = useCallback((id: string, enabled: boolean): void => {
    setSources((prev) => prev.map((source) => (source.id === id ? { ...source, enabled } : source)));
  }, []);

  const renameSource = useCallback((id: string, name: string): void => {
    const trimmed = name.trim();
    if (trimmed === '') return;
    setSources((prev) => prev.map((source) => (source.id === id ? { ...source, name: trimmed } : source)));
  }, []);

  const moveSource = useCallback((id: string, direction: -1 | 1): void => {
    setSources((prev) => {
      const ordered = sortedSources(prev);
      const index = ordered.findIndex((source) => source.id === id);
      const swapIndex = index + direction;
      if (index < 0 || swapIndex < 0 || swapIndex >= ordered.length) return prev;
      const next = [...ordered];
      const current = next[index] as GnssProjectFileState;
      const other = next[swapIndex] as GnssProjectFileState;
      next[index] = { ...current, order: other.order };
      next[swapIndex] = { ...other, order: current.order };
      return next;
    });
  }, []);

  const toggleFixed = useCallback((id: string, fixed: boolean): void => {
    setControlOverrides((prev) => ({ ...prev, [id]: fixed }));
  }, []);

  const changeDatumMode = useCallback((mode: GnssDatumMode): void => {
    setDatumMode(mode);
  }, []);

  const acknowledgeDuplicates = useCallback((hash: string): void => {
    setAcknowledgedHashes((prev) => (prev.includes(hash) ? prev : [...prev, hash]));
  }, []);

  const solve = useCallback(
    async (run: GnssProjectRunFn): Promise<void> => {
      if (sigmaInvalid || solving) return;
      runSeq.current += 1;
      const seq = runSeq.current;
      setSolving(true);
      setRunError(null);
      try {
        const built = buildGnssMultifileAdjustInput(entries, sourceTexts, {
          controlOverrides,
          datumMode,
          setup,
        });
        const fingerprint = runFingerprint;
        const outcome = await run(built.input);
        if (seq !== runSeq.current) return;
        // Freeze the complete review/export context at solve time: source
        // names/hashes/order, datum, warnings, control attribution, and
        // station trace inputs. Render/export read ONLY the frozen copy.
        const composedControl: Record<string, 'FIXED' | 'FREE'> = {};
        Object.keys(built.input.stations)
          .sort()
          .forEach((id) => {
            const station = built.input.stations[id];
            composedControl[id] = station?.fixedX && station?.fixedY && station?.fixedH ? 'FIXED' : 'FREE';
          });
        setSnapshot({
          fingerprint,
          provenance: built.provenance,
          mergeNotes: built.mergeNotes,
          input: built.input,
          outcome,
          enabledSources: sortedSources(sources)
            .filter((source) => source.enabled)
            .map((source) => ({
              id: source.id,
              name: source.name,
              hash: buildValueFingerprint(source.text),
              order: source.order,
            })),
          datumMode,
          warnings: [...built.summary.warnings],
          controlBySource: [...built.summary.controlBySource],
          stationTrace: buildGnssProjectStationSourceTrace(built.parsed),
          composedControl,
        });
      } catch (failure) {
        if (seq !== runSeq.current) return;
        setRunError(failure instanceof Error ? failure.message : String(failure));
      } finally {
        if (seq === runSeq.current) setSolving(false);
      }
    },
    [sigmaInvalid, solving, entries, sourceTexts, controlOverrides, datumMode, setup, runFingerprint, sources],
  );

  // Provenance renders EXCLUSIVELY from the frozen snapshot (conflicts are
  // always empty on a solved snapshot: BLOCKED throws before snapshotting).
  // Live conflicts stay in the composition-preview section, never under an
  // old solution.
  const provenanceLines = useMemo(
    () =>
      snapshot
        ? buildGnssMultifileProvenanceSection(
            snapshot.provenance,
            snapshot.input.baselines,
            snapshot.mergeNotes,
            [],
          )
        : [],
    [snapshot],
  );

  // Write-through durability: every change lands in the named-project
  // document (manifest entries + content + settings bag + frozen snapshot).
  // Skipped while live state still belongs to the previous (projectId,
  // store) pair — see hydratedKey above.
  useEffect(() => {
    if (hydratedKey.id !== projectId || hydratedKey.store !== store) return;
    const finiteOrZero = (value: string): number => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    saveGnssMultifileProject(projectId, store, {
      entries,
      texts: sourceTexts,
      settings: {
        version: 1,
        formatOverrides: {},
        controlOverrides,
        datumMode,
        setup: {
          horizontalCenteringSigma: finiteOrZero(centeringSigma),
          antennaHeightSigma: finiteOrZero(heightSigma),
        },
        displayNames: {},
      },
      ui: { centeringSigma, heightSigma, acknowledgedHashes },
      snapshot: snapshot as unknown as Record<string, unknown> | null,
    });
  }, [projectId, store, hydratedKey, entries, sourceTexts, controlOverrides, datumMode, centeringSigma, heightSigma, acknowledgedHashes, snapshot]);

  return {
    sources: sortedSources(sources),
    sourceStatuses,
    parsed,
    summary,
    unionStations,
    controlOverrides,
    datumMode,
    centeringSigma,
    heightSigma,
    sigmaInvalid,
    setup,
    duplicateGroups,
    unacknowledgedDuplicates,
    nonPortableIds,
    missingSources,
    snapshot,
    stale,
    runError,
    solving,
    provenanceLines,
    addSource,
    removeSource,
    toggleSource,
    renameSource,
    moveSource,
    toggleFixed,
    changeDatumMode,
    setCenteringSigma,
    setHeightSigma,
    acknowledgeDuplicates,
    solve,
  };
};

export type GnssMultifileProject = ReturnType<typeof useGnssMultifileProject>;
