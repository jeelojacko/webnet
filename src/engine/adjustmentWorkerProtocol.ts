import type { RunSessionOutcome, RunSessionRequest } from './runSession';

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

export type AdjustmentWorkerRequestMessage = RunRequestMessage | RunCancelMessage;

export interface RunProgressMessage {
  type: 'progress';
  runId: string;
  phase: RunPhase;
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

export type AdjustmentWorkerResponseMessage =
  | RunProgressMessage
  | RunSuccessMessage
  | RunFailureMessage
  | RunCancelledMessage;
