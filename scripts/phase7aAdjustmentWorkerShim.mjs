import { parentPort } from 'node:worker_threads';

const shim = {
  postMessage: (message) => parentPort?.postMessage(message),
  onmessage: null,
};

globalThis.self = shim;
export { shim };
