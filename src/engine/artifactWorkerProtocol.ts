import type { BuildExportArtifactsRequest, BuildExportArtifactsResult } from './exportArtifacts';

export type ArtifactPhase = 'queued' | 'building' | 'finalizing';

export interface ArtifactRequestMessage {
  type: 'artifact';
  taskId: string;
  payload: BuildExportArtifactsRequest;
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

export type ArtifactWorkerRequestMessage = ArtifactRequestMessage;

export type ArtifactWorkerResponseMessage =
  | ArtifactProgressMessage
  | ArtifactSuccessMessage
  | ArtifactFailureMessage;

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value != null;

export const isArtifactWorkerResponseMessage = (
  value: unknown,
): value is ArtifactWorkerResponseMessage => {
  if (!isObjectRecord(value) || typeof value.type !== 'string') return false;
  switch (value.type) {
    case 'artifact-progress':
      return typeof value.taskId === 'string' && value.phase !== undefined;
    case 'artifact-success':
      return typeof value.taskId === 'string' && 'payload' in value;
    case 'artifact-failure':
      return typeof value.taskId === 'string' && typeof value.error === 'string';
    default:
      return false;
  }
};
