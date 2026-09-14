/**
 * Phase 12J.4 Track RUNTIME — dedicated 'gnss-raw-process' worker protocol.
 *
 * This channel is disjoint from the existing worker protocol by design:
 * no solve message kinds are reused, and raw results never enter
 * solve state. Job tokens: receivers ignore responses whose jobId does
 * not match the current job (no stale result after cancel/supersede).
 */
import type { GnssRawRnx2rtkpJob, GnssRawProgressStage } from '../engine/gnssRawRnx2rtkp';
import type {
  ProcessedRawGnssBaseline,
  RawGnssProcessingError,
} from '../engine/gnssRawTypes';

export const GNSS_RAW_WORKER_CHANNEL = 'gnss-raw-process' as const;

export interface GnssRawRunMessage {
  readonly kind: 'gnss-raw-run';
  readonly channel: typeof GNSS_RAW_WORKER_CHANNEL;
  readonly jobId: string;
  readonly job: GnssRawRnx2rtkpJob;
}

export interface GnssRawProgressMessage {
  readonly kind: 'gnss-raw-progress';
  readonly channel: typeof GNSS_RAW_WORKER_CHANNEL;
  readonly jobId: string;
  readonly stage: GnssRawProgressStage;
}

export interface GnssRawSuccessMessage {
  readonly kind: 'gnss-raw-success';
  readonly channel: typeof GNSS_RAW_WORKER_CHANNEL;
  readonly jobId: string;
  readonly result: ProcessedRawGnssBaseline;
}

export interface GnssRawFailureMessage {
  readonly kind: 'gnss-raw-failure';
  readonly channel: typeof GNSS_RAW_WORKER_CHANNEL;
  readonly jobId: string;
  readonly error: RawGnssProcessingError;
}

export interface GnssRawCancelledMessage {
  readonly kind: 'gnss-raw-cancelled';
  readonly channel: typeof GNSS_RAW_WORKER_CHANNEL;
  readonly jobId: string;
}

export type GnssRawWorkerRequest = GnssRawRunMessage;
export type GnssRawWorkerResponse =
  | GnssRawProgressMessage
  | GnssRawSuccessMessage
  | GnssRawFailureMessage
  | GnssRawCancelledMessage;

/** Job-token gate: accept a response only when it belongs to the live job. */
export const isCurrentJob = (liveJobId: string | null, messageJobId: string): boolean =>
  liveJobId != null && liveJobId === messageJobId;
