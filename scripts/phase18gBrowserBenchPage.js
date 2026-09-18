/**
 * Phase 18G browser bench page script (plain JS, evaluated as a string).
 *
 * Runs inside Chromium via scripts/phase18gSurfaceBrowserPerf.ts, which
 * substitutes %%POINTS%% and passes the whole file to page.evaluate.
 * Plain JS only: no TS syntax, no template literals (the outer carrier is
 * a TS template string). Dynamic /src/*.ts imports rely on the Vite dev
 * server transform pipeline (dev-only measurement, never production).
 */
(async () => {
const pointCount = /*%%POINTS%%*/ 1000;
const cadSurfaces = await import('/src/engine/cad/cadSurfaces.ts');
const cadTypes = await import('/src/engine/cad/cadSurfaceTypes.ts');
const handler = await import('/src/workers/surfaceWorkerHandler.ts');
const cache = await import('/src/engine/cad/cadSurfaceCache.ts');
const view = await import('/src/engine/cad/cadSurfaceView.ts');
const rand = (n) => ((n * 1103515245 + 12345) >>> 0) / 4294967296;
const pts = [];
const cols = Math.ceil(Math.sqrt(pointCount));
let index = 0;
for (let row = 0; row * cols < pointCount; row += 1) {
  for (let col = 0; col < cols && index < pointCount; col += 1) {
    index += 1;
    pts.push({
      id: 'e-pt-' + index, type: 'survey-point', layerId: 'general', visible: true, locked: false,
      stationId: 'E' + index, x: col * 10 + rand(index) * 2, y: row * 10 + rand(index + 7) * 2,
      z: 100 + col * 0.5 + row * 0.3 + rand(index + 13), pointClass: 'free', source: 'parsed-input',
    });
  }
}
const project = {
  version: 2, id: 'p', name: 'p',
  metadata: { source: 'parsed-input', runMode: 'unknown', units: 'm', stationCount: 0, observationCount: 0, adjustedStationCount: 0 },
  layers: [], styleLibrary: { lineTypes: [], textStyles: [], pointSymbols: [], styles: [] },
  pointGroups: [{ id: 'g', name: 'G', query: {}, priority: 0 }],
  entities: pts, cogoComputations: [], bounds: null,
  surfaces: [{ id: 's', name: 's', definition: { pointSource: { kind: 'point-group', pointGroupIds: ['g'] } }, cachedRevision: null }],
};
const run = (fn) => {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
};
const revision = cadSurfaces.computeCadSurfaceSourceRevision(project, project.surfaces[0]);
let request;
const requestMs = run(() => {
  request = cadTypes.buildSurfaceBuildRequest(project, 's', revision);
});
let mesh;
const workerMs = run(() => {
  mesh = handler.buildSurfaceMeshFromRequest(request);
});
const payload = { points: mesh.points, triangles: mesh.triangles, stats: mesh.stats, grid: mesh.grid, adjacency: mesh.adjacency, edgeKinds: mesh.edgeKinds };
const xferMs = run(() => structuredClone(payload));
const xferBytes = JSON.stringify(payload).length;
const store = cache.createCadSurfaceCache('bench');
const ingestMs = run(() => {
  cache.applySurfaceBuildSuccess(project, store, 's', revision, {
    outcome: mesh.outcome, points: mesh.points, triangles: mesh.triangles,
    stats: mesh.stats, grid: mesh.grid, adjacency: mesh.adjacency, edgeKinds: mesh.edgeKinds,
  });
});
const displayMesh = { revision, points: mesh.points, triangles: mesh.triangles, stats: mesh.stats, grid: mesh.grid, adjacency: mesh.adjacency, edgeKinds: mesh.edgeKinds };
const displayPrepMs = run(() => {
  view.surfaceTrianglesPathD(displayMesh);
  view.surfaceBoundaryPathD(displayMesh);
});
// Transferable-Buffer comparison: same payload as typed arrays.
const n = mesh.points.length;
const xyz = new Float64Array(n * 3);
mesh.points.forEach((p, i) => { xyz[i * 3] = p.x; xyz[i * 3 + 1] = p.y; xyz[i * 3 + 2] = p.z; });
const idx = new Uint32Array(mesh.triangles.length * 3);
mesh.triangles.forEach((t, i) => { idx[i * 3] = t[0]; idx[i * 3 + 1] = t[1]; idx[i * 3 + 2] = t[2]; });
const tCopy0 = performance.now();
structuredClone({ xyz: Array.from(xyz), idx: Array.from(idx) });
const plainCopyMs = performance.now() - tCopy0;
const channel = new MessageChannel();
const xyzCopy = xyz.slice();
const idxCopy = idx.slice();
const tXfer0 = performance.now();
await new Promise((resolve) => {
  channel.port1.onmessage = () => resolve();
  channel.port2.postMessage({ xyz: xyzCopy, idx: idxCopy }, [xyzCopy.buffer, idxCopy.buffer]);
});
const transferableMs = performance.now() - tXfer0;
channel.port1.close();
channel.port2.close();
const heapMB = performance.memory ? performance.memory.usedJSHeapSize / 1048576 : -1;
return JSON.stringify({ requestMs, workerMs, xferMs, xferBytes, ingestMs, displayPrepMs, plainCopyMs, transferableMs, heapMB, outcome: mesh.outcome, tris: mesh.triangles.length });
})();
