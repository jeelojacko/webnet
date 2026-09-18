/**
 * Phase 18G browser QA — one-shot seed fixture generator (measurement/fixture only).
 *
 * Builds a small deterministic drawing through the app's own factories
 * (createBlankCadDrawingDocument), validates it through parseCadDrawingFile
 * + the real engine build, and writes
 * tests-browser/fixtures/cad-surface-18g-seed.wncad.
 *
 * Seed contents:
 * - 6x5 deterministic survey-point grid (10 m spacing, Z ramps with E/N).
 * - Groups g-all (matches all) + g-high (Z >= 102, a strict subset).
 * - Surface "QA Constraints" (seeded, point-group g-all + point-chain
 *   breakline + outer ring + void ring; engine-verified ok).
 * - Surface "QA Flow" is created through the shipped UI (not seeded).
 * - Two closed ring polylines (outer/void) as boundary source entities.
 *
 * Usage: `npx tsx scripts/phase18gSeedSurfaceFixture.ts`
 */
import { writeFileSync } from 'node:fs';
import { buildCadSurface } from '../src/engine/cad/cadSurfaces';
import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import type {
  CadPolylineEntity,
  CadSurveyPointEntity,
} from '../src/engine/cad/cadTypes';

const drawing = createBlankCadDrawingDocument({ name: '18G Surface QA Seed', units: 'm' });
const project = drawing.project;

// Deterministic 6x5 grid: x = col*10, y = row*10, z = 100 + col + 0.5*row.
const points: CadSurveyPointEntity[] = [];
for (let row = 0; row < 5; row += 1) {
  for (let col = 0; col < 6; col += 1) {
    const stationId = `P${row}${col}`;
    points.push({
      id: `qa-pt-${stationId}`,
      type: 'survey-point',
      layerId: 'general',
      visible: true,
      locked: false,
      stationId,
      x: col * 10,
      y: row * 10,
      z: 100 + col + 0.5 * row,
      pointClass: 'free',
      source: 'parsed-input',
    });
  }
}

const ring = (id: string, corners: Array<[number, number]>): CadPolylineEntity => ({
  id,
  type: 'polyline',
  layerId: 'general',
  visible: true,
  locked: false,
  vertices: corners.map(([x, y]) => ({ x, y })),
  vertexLabels: corners.map(() => ''),
  closed: true,
});

const outer = ring('qa-ring-outer', [[5, 5], [45, 5], [45, 35], [5, 35], [5, 5]]);
const voidRing = ring('qa-ring-void', [[20, 15], [30, 15], [30, 25], [20, 25], [20, 15]]);

project.entities.push(...points, outer, voidRing);
project.pointGroups = [
  { id: 'g-all', name: 'All QA', query: {}, priority: 0 },
  { id: 'g-high', name: 'High QA', query: { elevationMin: 102 }, priority: 1 },
];

// Breakline chain along the y=10 row (P11..P14): inside the outer ring,
// clear of the void (exact domain classification blocks void crossings).
const chainIds = ['P11', 'P12', 'P13', 'P14'].map((station) => `qa-pt-${station}`);
project.surfaces = [
  {
    id: 'qa-surf-constraints',
    name: 'QA Constraints',
    definition: {
      pointSource: { kind: 'point-group', pointGroupIds: ['g-all'] },
      breaklines: [{ id: 'qa-bl-mid', source: { kind: 'point-chain', pointEntityIds: chainIds }, type: 'standard', name: 'mid-row' }],
      boundaries: [
        { type: 'outer', sourceEntityId: outer.id },
        { type: 'void', sourceEntityId: voidRing.id },
      ],
    },
    cachedRevision: null,
  },
];

const surface = project.surfaces[0]!;
const built = buildCadSurface(project, surface);
if (built.outcome !== 'ok') {
  console.error(`seed surface build ${built.outcome}: ${built.reasonCodes.join(',')}`);
  process.exit(1);
}
console.log(`seed ok: ${built.stats.usedPointCount} pts, ${built.stats.triangleCount} tris, area ${built.stats.planimetricArea.toFixed(1)} m2`);

const text = serializeCadDrawingFile(drawing);
const parsed = parseCadDrawingFile(text);
if (!parsed.ok) {
  console.error(`round-trip failed: ${parsed.errors.join('; ')}`);
  process.exit(1);
}
const outPath = 'tests-browser/fixtures/cad-surface-18g-seed.wncad';
writeFileSync(outPath, text);
console.log(`wrote ${outPath} (${text.length} bytes)`);
