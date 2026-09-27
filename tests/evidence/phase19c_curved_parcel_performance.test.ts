/**
 * Phase 19C integration — curved-parcel performance evidence (mission §§98-99).
 *
 * EVIDENCE TIER (manual-only, never in CI): builds synthetic mixed line/arc
 * parcels at 100 / 1k / 10k courses and records wall-clock numbers for
 * resolve, area+bounds, render-derive, containment, and line-boundary
 * intersection, plus target-area solve scaling. No assertions on absolute
 * time (machines differ) — assertions only sanity-check each stage produced
 * output. Numbers are recorded in
 * docs/evidence/phase19c-curved-parcel-performance.md.
 *
 * Complexity note: resolve/area/bounds/containment/line-split are O(n) per
 * call (single course walk); target-area solve is O(360·n + refinements)
 * because it sweeps 360 candidate azimuths plus three refinement passes.
 */
import { describe, expect, it } from 'vitest';
import { createBlankCadProject } from '../../src/engine/cad/cadDrawingFile';
import { resolveCadParcelCourses, buildParcelCourseIds } from '../../src/engine/cad/cadParcelCourses';
import { cadBuildParcelClosureSummary } from '../../src/engine/cad/cadCogoParcelGeometrySummaries';
import { cadClassifyParcelPoint, cadPointInCurvedParcel } from '../../src/engine/cad/cadParcelContainment';
import { cadBuildParcelSplitByAreaDraft, cadBuildParcelSplitByLineDraftDetailed } from '../../src/engine/cad/cadCogoParcelSplit';
import { buildCadDisplayScene } from '../../src/engine/cad/cadRenderer';
import { buildCadBounds } from '../../src/engine/cad/cadProjectState';
import type { CadParcelCourseGeometry, CadParcelEntity, CadProject } from '../../src/engine/cad/cadTypes';

const now = (): number => performance.now();
const ms = (start: number): number => Math.round((now() - start) * 10) / 10;

// Ring of n vertices on a circle (radius 1000m); every 3rd course is an arc
// with a modest bulge so resolver/area/containment exercise the curved path.
const buildMixedParcel = (courses: number): CadParcelEntity => {
  const id = `parcel-19c-perf-${courses}`;
  const radius = 1000;
  const vertices = Array.from({ length: courses }, (_, index) => {
    const angle = (index / courses) * Math.PI * 2;
    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
  });
  const courseGeometry: CadParcelCourseGeometry[] = Array.from({ length: courses }, (_, index) => (
    index % 3 === 2 ? { kind: 'arc', bulge: 0.15 } : { kind: 'line' }
  ));
  const parcel: CadParcelEntity = {
    id,
    type: 'parcel',
    layerId: 'parcels',
    visible: true,
    locked: false,
    vertices,
    vertexLabels: vertices.map((_, index) => `P${index + 1}`),
    parcelName: `Perf ${courses}`,
    courseIds: buildParcelCourseIds(id, courses),
    courseGeometry,
  };
  return parcel;
};

const toProject = (parcel: CadParcelEntity): CadProject => {
  const project = createBlankCadProject({ name: 'Perf 19C', units: 'm' });
  project.layers = [
    { id: 'parcels', name: 'Parcels', color: '#ffffff', visible: true, locked: false, role: 'parcels' },
  ];
  project.entities = [parcel];
  return project;
};

const measureParcelPipeline = (courses: number): Record<string, number> => {
  const parcel = buildMixedParcel(courses);

  const tResolve = now();
  const resolved = resolveCadParcelCourses(parcel);
  const resolveMs = ms(tResolve);

  const tArea = now();
  const summary = cadBuildParcelClosureSummary(parcel.vertices, { courseGeometry: parcel.courseGeometry });
  const bounds = buildCadBounds([parcel], undefined);
  const areaMs = ms(tArea);

  const project = toProject(parcel);
  void bounds;
  const tRender = now();
  const scene = buildCadDisplayScene(project);
  const renderMs = ms(tRender);

  const center = { x: 0, y: 0 };
  const outside = { x: 5000, y: 5000 };
  const tContain = now();
  let inside = 0;
  for (let index = 0; index < 100; index += 1) {
    if (cadPointInCurvedParcel(parcel, center)) inside += 1;
    cadClassifyParcelPoint(parcel, outside);
  }
  const containMs = ms(tContain);

  const tSplit = now();
  // Offset the cut line off the parcel symmetry axis so it crosses two
  // boundary edges instead of landing exactly on opposed vertices
  // (VERTEX_CONTACT rejection) or yielding exact halves.
  const split = cadBuildParcelSplitByLineDraftDetailed(parcel, {
    type: 'line',
    id: 'split-line',
    layerId: 'parcels',
    visible: true,
    locked: false,
    fromStationId: 'A',
    toStationId: 'B',
    fromX: -2000,
    fromY: 123.456,
    toX: 2000,
    toY: 123.456,
    sourceObservationIds: [],
  });
  const splitMs = ms(tSplit);

  return {
    courses,
    resolved: resolved.length,
    areaM2: summary ? Math.round(summary.areaSquareMeters) : -1,
    primitives: scene.primitives.length,
    inside,
    splitOk: split.draft ? 1 : 0,
    resolveMs,
    areaMs,
    renderMs,
    containMs,
    splitMs,
  };
};

describe('19C curved-parcel performance evidence', () => {
  it('records resolve/area+bounds/render-derive/containment/line-split at 100/1k/10k mixed courses', () => {
    const rows = [100, 1_000, 10_000].map(measureParcelPipeline);
    rows.forEach((row) => {
      expect(row.resolved).toBe(row.courses);
      expect(row.areaM2).toBeGreaterThan(0);
      expect(row.primitives).toBeGreaterThan(0);
      expect(row.inside).toBe(100);
      expect(row.splitOk).toBe(1);
    });
    console.log('[19C perf] pipeline', JSON.stringify(rows, null, 0));
  }, 600_000);

  it('records target-area solve scaling at 100/1k mixed courses', () => {
    const rows = [100, 1_000].map((courses) => {
      const parcel = buildMixedParcel(courses);
      const summary = cadBuildParcelClosureSummary(parcel.vertices, { courseGeometry: parcel.courseGeometry });
      expect(summary).not.toBeNull();
      const target = summary!.areaSquareMeters * 0.4;
      // Off-center witness: a through-center line on this near-symmetric
      // ring can only yield 50/50 children, so 40% would be unreachable.
      const start = now();
      const draft = cadBuildParcelSplitByAreaDraft(parcel, { x: 200, y: 100 }, target);
      const elapsedMs = ms(start);
      expect(draft).not.toBeNull();
      return { courses, targetM2: Math.round(target), elapsedMs };
    });
    console.log('[19C perf] target-area solve', JSON.stringify(rows, null, 0));
  }, 900_000);
});
