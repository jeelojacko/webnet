import type { RunSessionOutcome, RunSessionRequest } from './runSession';
import type { GnssBaselineAdjustInput, GnssBaselineAdjustResult } from './gnssBaselineAdjust';

export type RunPhase = 'queued' | 'solving' | 'finalizing';

export interface RunRequestMessage {
  type: 'run';
  runId: string;
  payload: RunSessionRequest;
}

export interface RunCancelMessage {
  type: 'cancel';
  runId: string;
}

export interface GnssRunRequestMessage {
  type: 'gnss-run';
  runId: string;
  payload: GnssBaselineAdjustInput;
}

export type AdjustmentWorkerRequestMessage = RunRequestMessage | RunCancelMessage | GnssRunRequestMessage;

export interface RunProgressMessage {
  type: 'progress';
  runId: string;
  phase: RunPhase;
  elapsedMs?: number;
  stageLabel?: string;
  solveIndex?: number;
  solveTotalHint?: number;
  iteration?: number;
  maxIterations?: number;
}

export interface RunSuccessMessage {
  type: 'success';
  runId: string;
  payload: RunSessionOutcome;
}

export interface RunFailureMessage {
  type: 'failure';
  runId: string;
  error: string;
}

export interface RunCancelledMessage {
  type: 'cancelled';
  runId: string;
}

export interface GnssRunSuccessMessage {
  type: 'gnss-success';
  runId: string;
  payload: {
    result: GnssBaselineAdjustResult;
    route: string;
    reasons: string[];
  };
}

export interface GnssRunFailureMessage {
  type: 'gnss-failure';
  runId: string;
  error: string;
}

export type AdjustmentWorkerResponseMessage =
  | RunProgressMessage
  | RunSuccessMessage
  | RunFailureMessage
  | RunCancelledMessage
  | GnssRunSuccessMessage
  | GnssRunFailureMessage;

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value != null;

export const isAdjustmentWorkerResponseMessage = (
  value: unknown,
): value is AdjustmentWorkerResponseMessage => {
  if (!isObjectRecord(value) || typeof value.type !== 'string') return false;
  switch (value.type) {
    case 'progress':
      return typeof value.runId === 'string' && value.phase !== undefined;
    case 'success':
      return typeof value.runId === 'string' && 'payload' in value;
    case 'failure':
      return typeof value.runId === 'string' && typeof value.error === 'string';
    case 'cancelled':
      return typeof value.runId === 'string';
    case 'gnss-success':
      return typeof value.runId === 'string' && 'payload' in value;
    case 'gnss-failure':
      return typeof value.runId === 'string' && typeof value.error === 'string';
    default:
      return false;
  }
};
