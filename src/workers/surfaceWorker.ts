/**
 * Production browser worker: runs surface builds off the main thread
 * through the shared testable handler. Rebuild is manual and never
 * dirties the drawing; the protocol is request id + surface id + source
 * revision with cancellation/supersession (latest-wins).
 */
import type { SurfaceWorkerRequestMessage } from './surfaceWorkerHandler';
import {
  buildSurfaceMeshFromRequest,
  createSurfaceWorkerHandler,
  type SurfaceWorkerBuilderFn,
} from './surfaceWorkerHandler';

const handler = createSurfaceWorkerHandler({
  loadBuilder: async (): Promise<SurfaceWorkerBuilderFn> => buildSurfaceMeshFromRequest,
  postMessage: (message) => self.postMessage(message),
});

self.onmessage = (event: MessageEvent<SurfaceWorkerRequestMessage>) => {
  handler.handleMessage(event.data);
};
