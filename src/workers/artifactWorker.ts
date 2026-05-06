import type {
  ArtifactWorkerRequestMessage,
  ArtifactWorkerResponseMessage,
} from '../engine/artifactWorkerProtocol';
import type { buildExportArtifacts as BuildExportArtifactsFn } from '../engine/exportArtifacts';

let buildExportArtifactsPromise: Promise<typeof BuildExportArtifactsFn> | null = null;

const loadBuildExportArtifacts = (): Promise<typeof BuildExportArtifactsFn> => {
  if (!buildExportArtifactsPromise) {
    buildExportArtifactsPromise = import('../engine/exportArtifacts').then(
      (module) => module.buildExportArtifacts,
    );
  }
  return buildExportArtifactsPromise;
};

const postWorkerMessage = (message: ArtifactWorkerResponseMessage) => {
  self.postMessage(message);
};

self.onmessage = (event: MessageEvent<ArtifactWorkerRequestMessage>) => {
  const message = event.data;
  if (!message || message.type !== 'artifact') return;

  const { taskId, payload } = message;
  postWorkerMessage({ type: 'artifact-progress', taskId, phase: 'queued' });
  setTimeout(() => {
    postWorkerMessage({ type: 'artifact-progress', taskId, phase: 'building' });
    void loadBuildExportArtifacts()
      .then((buildExportArtifacts) => {
        const outcome = buildExportArtifacts(payload);
        postWorkerMessage({ type: 'artifact-progress', taskId, phase: 'finalizing' });
        postWorkerMessage({ type: 'artifact-success', taskId, payload: outcome });
      })
      .catch((error) => {
        postWorkerMessage({
          type: 'artifact-failure',
          taskId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }, 0);
};
