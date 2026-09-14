/**
 * Phase 12J.4 — raw static-baseline job lifecycle hook.
 *
 * Owns file bytes (untrusted input: per-file size cap + NAV count cap
 * mirroring preflight), SHA-256, metadata parse, base/rover swap, options
 * state, preflight gating, dedicated-worker run with 7-stage progress, and
 * job-token cancellation (terminate/reset, ignore stale responses).
 *
 * NEVER imports adjustment hooks/state. There is NO auto-ingest path here
 * or anywhere downstream of this hook: results stay in local state for
 * review/export only.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sha256Hex } from '../engine/gnssRawHash';
import {
  DEFAULT_MAX_FILE_BYTES,
  preflightRawGnss,
  type PreflightInputFile,
  type PreflightOk,
} from '../engine/gnssRawPreflight';
import type { GnssRawProgressStage, GnssRawRnx2rtkpJob } from '../engine/gnssRawRnx2rtkp';
import { isCurrentJob } from '../engine/gnssRawWorkerProtocol';
import type {
  ProcessedRawGnssBaseline,
  RawGnssProcessingError,
} from '../engine/gnssRawTypes';

export interface RawFileEntry {
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly text: string;
  readonly sha256: string;
}

export interface RawBaselineOptions {
  readonly elevationMaskDegrees: number;
  readonly intervalMode: 'AUTO' | 'EXPLICIT';
  readonly intervalSeconds: number;
  readonly ephemeris: 'BROADCAST' | 'PRECISE';
  readonly windowStart: string;
  readonly windowStop: string;
}

export const DEFAULT_RAW_OPTIONS: RawBaselineOptions = {
  elevationMaskDegrees: 10,
  intervalMode: 'AUTO',
  intervalSeconds: 30,
  ephemeris: 'BROADCAST',
  windowStart: '',
  windowStop: '',
};

/** Max NAV files staged into one job (MEMFS bound: ≤2 used, rest rejected). */
export const MAX_NAV_FILES = 4;

export type RawRunStatus = 'idle' | 'ready' | 'running' | 'done' | 'failed' | 'cancelled';

export const readFileEntry = async (file: File): Promise<RawFileEntry> => {
  if (file.size > DEFAULT_MAX_FILE_BYTES) {
    throw new Error(`File ${file.name} exceeds the 32 MiB size cap.`);
  }
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength > DEFAULT_MAX_FILE_BYTES) {
    throw new Error(`File ${file.name} exceeds the 32 MiB size cap.`);
  }
  const sha256 = await sha256Hex(bytes);
  return { fileName: file.name, bytes, text: new TextDecoder().decode(bytes), sha256 };
};

const toPreflightFile = (entry: RawFileEntry): PreflightInputFile => ({
  fileName: entry.fileName,
  sha256: entry.sha256,
  text: entry.text,
});

let jobCounter = 0;

export const useGnssRawBaseline = () => {
  const [base, setBase] = useState<RawFileEntry | null>(null);
  const [rover, setRover] = useState<RawFileEntry | null>(null);
  const [nav, setNav] = useState<RawFileEntry[]>([]);
  const [sp3, setSp3] = useState<RawFileEntry | null>(null);
  const [options, setOptions] = useState<RawBaselineOptions>(DEFAULT_RAW_OPTIONS);
  const [fileError, setFileError] = useState<string | null>(null);
  const [status, setStatus] = useState<RawRunStatus>('idle');
  const [stage, setStage] = useState<GnssRawProgressStage | null>(null);
  const [result, setResult] = useState<ProcessedRawGnssBaseline | null>(null);
  const [runError, setRunError] = useState<RawGnssProcessingError | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const liveJobRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      liveJobRef.current = null;
    },
    [],
  );

  const setBaseFile = useCallback(async (file: File): Promise<void> => {
    setFileError(null);
    try {
      setBase(await readFileEntry(file));
    } catch (e) {
      setFileError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const setRoverFile = useCallback(async (file: File): Promise<void> => {
    setFileError(null);
    try {
      setRover(await readFileEntry(file));
    } catch (e) {
      setFileError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const addNavFiles = useCallback(async (files: File[]): Promise<void> => {
    setFileError(null);
    try {
      const entries: RawFileEntry[] = [];
      for (const file of files) entries.push(await readFileEntry(file));
      setNav((prev) => {
        if (prev.length + entries.length > MAX_NAV_FILES) {
          setFileError(`Too many NAV files (max ${MAX_NAV_FILES}).`);
          return prev;
        }
        return [...prev, ...entries];
      });
    } catch (e) {
      setFileError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const setSp3File = useCallback(async (file: File): Promise<void> => {
    setFileError(null);
    try {
      setSp3(await readFileEntry(file));
    } catch (e) {
      setFileError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const swap = useCallback((): void => {
    setBase(rover);
    setRover(base);
    setResult(null);
    setRunError(null);
    setStatus(base && rover ? 'ready' : 'idle');
    setStage(null);
  }, [base, rover]);

  const clearNav = useCallback((index: number): void => {
    setNav((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearSp3 = useCallback((): void => {
    setSp3(null);
  }, []);

  const reset = useCallback((): void => {
    workerRef.current?.terminate();
    workerRef.current = null;
    liveJobRef.current = null;
    setStatus(base && rover ? 'ready' : 'idle');
    setStage(null);
    setResult(null);
    setRunError(null);
  }, [base, rover]);

  const preflight: PreflightOk | RawGnssProcessingError | null = useMemo(() => {
    if (!base || !rover || nav.length === 0) return null;
    const out = preflightRawGnss({
      base: toPreflightFile(base),
      rover: toPreflightFile(rover),
      nav: nav.map(toPreflightFile),
      sp3: sp3 ? toPreflightFile(sp3) : null,
      options: {
        elevationMaskDegrees: options.elevationMaskDegrees,
        intervalRequested: options.intervalMode === 'AUTO' ? 'AUTO' : options.intervalSeconds,
        ephemerisRequested: options.ephemeris,
        windowStart: options.windowStart.trim() === '' ? null : options.windowStart.trim(),
        windowStop: options.windowStop.trim() === '' ? null : options.windowStop.trim(),
      },
    });
    return out.ok ? out : out.error;
  }, [base, rover, nav, sp3, options]);

  useEffect(() => {
    if (!base || !rover) {
      if (status !== 'running') setStatus('idle');
      return;
    }
    if (status === 'idle') setStatus('ready');
  }, [base, rover, status]);

  const run = useCallback((): void => {
    if (!base || !rover || nav.length === 0) return;
    const gate = preflight;
    if (!gate || 'code' in gate) return;
    const ok = gate as PreflightOk;
    setStatus('running');
    setStage(null);
    setResult(null);
    setRunError(null);
    workerRef.current?.terminate();
    const worker = new Worker(new URL('../workers/gnssRawWorker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;
    jobCounter += 1;
    const jobId = `raw-baseline-${jobCounter}`;
    liveJobRef.current = jobId;
    worker.onmessage = (event: MessageEvent): void => {
      const message = event.data as { jobId?: string; kind?: string };
      if (!isCurrentJob(liveJobRef.current, String(message.jobId ?? ''))) return;
      if (message.kind === 'gnss-raw-progress') {
        setStage((message as { stage: GnssRawProgressStage }).stage);
      } else if (message.kind === 'gnss-raw-success') {
        liveJobRef.current = null;
        setResult((message as { result: ProcessedRawGnssBaseline }).result);
        setStatus('done');
        setStage(null);
      } else if (message.kind === 'gnss-raw-failure') {
        liveJobRef.current = null;
        setRunError((message as { error: RawGnssProcessingError }).error);
        setStatus('failed');
        setStage(null);
      }
    };
    worker.onerror = () => {
      if (!isCurrentJob(liveJobRef.current, jobId)) return;
      liveJobRef.current = null;
      setRunError({ code: 'PROCESSOR_FAILURE', message: 'Raw GNSS worker failed.' });
      setStatus('failed');
      setStage(null);
    };
    const job: GnssRawRnx2rtkpJob = {
      baseObs: base.bytes,
      roverObs: rover.bytes,
      nav: nav.map((entry) => entry.bytes),
      ...(sp3 ? { sp3: sp3.bytes } : {}),
      baseXyz: ok.base.approxXyz ?? [0, 0, 0],
      options: {
        elevationMaskDegrees: options.elevationMaskDegrees,
        intervalSeconds: options.intervalMode === 'AUTO' ? 'AUTO' : options.intervalSeconds,
        windowStart: options.windowStart.trim() === '' ? null : options.windowStart.trim(),
        windowStop: options.windowStop.trim() === '' ? null : options.windowStop.trim(),
        precise: options.ephemeris === 'PRECISE',
      },
      from: ok.base.marker ?? base.fileName,
      to: ok.rover.marker ?? rover.fileName,
      baseAntenna: {
        marker: ok.base.marker ?? base.fileName,
        antennaModel: ok.base.antennaModel,
        height: ok.base.antennaHeight ?? 0,
        east: ok.base.antennaEast ?? 0,
        north: ok.base.antennaNorth ?? 0,
      },
      roverAntenna: {
        marker: ok.rover.marker ?? rover.fileName,
        antennaModel: ok.rover.antennaModel,
        height: ok.rover.antennaHeight ?? 0,
        east: ok.rover.antennaEast ?? 0,
        north: ok.rover.antennaNorth ?? 0,
      },
      hashes: {
        baseObsSha256: base.sha256,
        roverObsSha256: rover.sha256,
        navSha256: nav.map((entry) => entry.sha256),
        sp3Sha256: sp3 ? sp3.sha256 : null,
      },
    };
    worker.postMessage({ kind: 'gnss-raw-run', channel: 'gnss-raw-process', jobId, job });
  }, [base, rover, nav, sp3, options, preflight]);

  const cancel = useCallback((): void => {
    liveJobRef.current = null;
    workerRef.current?.terminate();
    workerRef.current = null;
    setStatus('cancelled');
    setStage(null);
    setResult(null);
    setRunError(null);
  }, []);

  return {
    base,
    rover,
    nav,
    sp3,
    options,
    setOptions,
    fileError,
    preflight,
    status,
    stage,
    result,
    runError,
    setBaseFile,
    setRoverFile,
    addNavFiles,
    setSp3File,
    clearNav,
    clearSp3,
    swap,
    run,
    cancel,
    reset,
  };
};

export type GnssRawBaselineHook = ReturnType<typeof useGnssRawBaseline>;
