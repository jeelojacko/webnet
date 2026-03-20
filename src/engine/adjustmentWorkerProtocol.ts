import type { RunSessionOutcome, RunSessionRequest } from './runSession';
import type { BuildExportArtifactsRequest, BuildExportArtifactsResult } from './exportArtifacts';

export type RunPhase = 'queued' | 'solving' | 'finalizing';
export type ArtifactPhase = 'queued' | 'building' | 'finalizing';

export interface RunRequestMessage {
  type: 'run';
  runId: string;
  payload: RunSessionRequest;
}

export interface RunCancelMessage {
  type: 'cancel';
  runId: string;
}

export interface ArtifactRequestMessage {
  type: 'artifact';
  taskId: string;
  payload: BuildExportArtifactsRequest;
}

export type AdjustmentWorkerRequestMessage =
  | RunRequestMessage
  | RunCancelMessage
  | ArtifactRequestMessage;

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

export interface ArtifactProgressMessage {
  type: 'artifact-progress';
  taskId: string;
  phase: ArtifactPhase;
}

export interface ArtifactSuccessMessage {
  type: 'artifact-success';
  taskId: string;
  payload: BuildExportArtifactsResult;
}

export interface ArtifactFailureMessage {
  type: 'artifact-failure';
  taskId: string;
  error: string;
}

export type AdjustmentWorkerResponseMessage =
  | RunProgressMessage
  | RunSuccessMessage
  | RunFailureMessage
  | RunCancelledMessage
  | ArtifactProgressMessage
  | ArtifactSuccessMessage
  | ArtifactFailureMessage;
