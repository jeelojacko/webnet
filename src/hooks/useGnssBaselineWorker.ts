/**
 * Phase 12G — production GNSS adjust runner.
 *
 * Posts GnssBaselineAdjustInput to the SAME production worker bundle
 * (additive 'gnss-run' message; existing protocol untouched) where it
 * auto-routes native R2B / TypeScript with no engine picker. Falls back
 * to direct TypeScript `runGnssBaselineWithNativeR2B` when Worker is
 * unavailable. No R1 is ever surfaced.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  GnssRunFailureMessage,
  GnssRunRequestMessage,
  GnssRunSuccessMessage,
} from '../engine/adjustmentWorkerProtocol';
import { isAdjustmentWorkerResponseMessage } from '../engine/adjustmentWorkerProtocol';
import type {
  GnssBaselineAdjustInput,
  GnssBaselineAdjustResult,
} from '../engine/gnssBaselineAdjust';
import { createStableRuntimeId } from '../engine/id';

export interface GnssRunOutcome {
  readonly result: GnssBaselineAdjustResult;
  readonly route: string;
  readonly reasons: string[];
  readonly workerBacked: boolean;
}

export type GnssRunStatus = 'idle' | 'running' | 'done' | 'failed';

export const useGnssBaselineWorker = () => {
  const [status, setStatus] = useState<GnssRunStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef(
    new Map<
      string,
      {
        resolve: (_outcome: GnssRunOutcome) => void;
        reject: (_reason?: unknown) => void;
      }
    >(),
  );

  useEffect(() => {
    if (typeof Worker === 'undefined') return undefined;
    const worker = new Worker(new URL('../workers/adjustmentWorker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;
    const handleMessage = (
      event: MessageEvent<GnssRunSuccessMessage | GnssRunFailureMessage>,
    ) => {
      const message = event.data;
      if (!isAdjustmentWorkerResponseMessage(message)) return;
      if (message.type !== 'gnss-success' && message.type !== 'gnss-failure') return;
      const pending = pendingRef.current.get(message.runId);
      if (!pending) return;
      pendingRef.current.delete(message.runId);
      if (message.type === 'gnss-success') {
        setStatus('done');
        setError(null);
        pending.resolve({
          result: message.payload.result,
          route: message.payload.route,
          reasons: message.payload.reasons,
          workerBacked: true,
        });
      } else {
        setStatus('failed');
        setError(message.error);
        pending.reject(new Error(message.error));
      }
    };
    worker.addEventListener('message', handleMessage);
    return () => {
      worker.removeEventListener('message', handleMessage);
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const run = useCallback(
    (input: GnssBaselineAdjustInput): Promise<GnssRunOutcome> => {
      setStatus('running');
      setError(null);
      if (!workerRef.current) {
        // Debug-only fallback: direct TypeScript when no Worker exists
        // (jsdom/tests). The user only sees an error if this fails.
        return (async () => {
          const { runGnssBaselineWithNativeR2B } = await import(
            '../workers/gnssBaselineNativeR2BRoute'
          );
          const attempt = await runGnssBaselineWithNativeR2B(input);
          setStatus('done');
          return {
            result: attempt.result,
            route: attempt.route,
            reasons: attempt.reasons,
            workerBacked: false,
          };
        })().catch((failure: unknown) => {
          const message = failure instanceof Error ? failure.message : String(failure);
          setStatus('failed');
          setError(message);
          throw failure instanceof Error ? failure : new Error(message);
        });
      }
      const runId = createStableRuntimeId('gnss-run');
      return new Promise<GnssRunOutcome>((resolve, reject) => {
        pendingRef.current.set(runId, { resolve, reject });
        const message: GnssRunRequestMessage = { type: 'gnss-run', runId, payload: input };
        workerRef.current?.postMessage(message);
      }).catch((failure: unknown) => {
        const message = failure instanceof Error ? failure.message : String(failure);
        setStatus('failed');
        setError(message);
        throw failure instanceof Error ? failure : new Error(message);
      });
    },
    [],
  );

  return { status, error, run };
};
