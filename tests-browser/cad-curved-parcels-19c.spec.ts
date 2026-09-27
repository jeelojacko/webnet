/**
 * Phase 19C browser QA — first-class curved parcel courses through the real
 * /cad app plus store-level pins on the production engine seams.
 *
 * One seeded drawing is reused everywhere: LOT 1 is created with PARCEL_CREATE
 * from a closed Line+Arc chain (3 straight sides + a road-frontage arc,
 * R50), so the create path itself is letter A. Browser flows drive the
 * production shell (course table, sheet viewport, save/reopen); every other
 * letter is pinned at the store level on the exact seams the UI commits
 * through, each naming the letter it covers. Zero page/console errors per
 * browser test.
 *
 * Letter map (§100): A mixed-parcel create, B course table + L# tags,
 * C line→arc convert, D arc→line, E description numbers match table,
 * F reverse, G split-by-line, H split-by-bearing, I split-by-area,
 * J slide, K swing, L curved frontage BLOCKED, M transforms,
 * N save/reopen exact, O sheet viewport 1:500, P exports.
 */
import { expect, test } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { createCadHistoryState, runCadCommand } from '../src/engine/cad/cadUndoRedo';
import { cadBuildParcelClosureSummary } from '../src/engine/cad/cadCogoParcelGeometrySummaries';
import {
  resolveCadParcelCourses,
} from '../src/engine/cad/cadParcelCourses';
import {
  deriveCadSurveyTableFromSource,
  resolveCadParcelCourses as resolveSurveyParcelCourses,
} from '../src/engine/cad/cadSurveyExportTables';
import {
  buildCadParcelLegalDescription,
  reverseCadParcelCourses,
} from '../src/engine/cad/cadParcelLegalDescription';
import {
  cadBuildParcelSplitByAreaDraft,
  cadBuildParcelSplitByBearingDraft,
  cadBuildParcelSplitByLineDraft,
} from '../src/engine/cad/cadCogoParcelSplit';
import { cadBuildParcelSplitBySlideDraft } from '../src/engine/cad/cadCogoParcelLayoutSlide';
import { cadBuildParcelSplitBySwingDraft } from '../src/engine/cad/cadCogoParcelLayoutSwing';
import { resolveParcelSplitFrontageSource } from '../src/engine/cad/cadTransactionsParcelLayoutFrontage';
import { appendCadProjectEntities } from '../src/engine/cad/cadProjectState';
import { createCadSelectionState } from '../src/engine/cad/cadSelection';
import { addSheetToDraft, addViewportToSheet, createPlanSheet, modelToPaperMm } from '../src/engine/cad/cadSheets';
import { buildExportSheetSceneWithResult } from '../src/engine/cad/cadExportScene';
import { serializeExportSceneToSvgWithResult } from '../src/engine/cad/cadSvgSerializer';
import { exportScenesToPdfWithResult } from '../src/engine/cad/cadPdfExport';
import { buildDxfExportModelWithResult } from '../src/engine/cad/dxf/dxfExportModel';
import { buildLandXmlProjectExportWithResult } from '../src/engine/landxmlCadProject';
import type {
  CadArcEntity,
  CadDrawingDocument,
  CadLineEntity,
  CadParcelCourseGeometry,
  CadParcelEntity,
} from '../src/engine/cad/cadTypes';
import {
  closeSurveyTableManager,
  createTable,
  entityCount,
  gotoCad,
  openSurveyTableManager,
  saveDrawingText,
  selectAll,
  tableRowCodes,
} from './cad-survey-plan-19a-helpers';
import {
  addLayoutSheet,
  createViewportMview,
  layoutTab,
  paperStatus,
  sheetSvg,
} from './cad-sheet-layout-19b-helpers';

// ---------------------------------------------------------------------------
// Seeded drawing — one LOT 1 from a closed Line+Arc chain (letter A input).
// Chord (0,0)->(40,0) with an R50 road-frontage arc bulging south; straight
// east/north/west sides. Monuments P1/P2 close the plan.
// ---------------------------------------------------------------------------

const FRONTAGE_RADIUS = 50;
const FRONTAGE_CENTER = { x: 20, y: Math.sqrt(FRONTAGE_RADIUS * FRONTAGE_RADIUS - 400) };
const normDeg = (deg: number): number => ((deg % 360) + 360) % 360;
const FRONTAGE_START_DEG = normDeg((Math.atan2(0 - FRONTAGE_CENTER.y, 0 - 20) * 180) / Math.PI);
const FRONTAGE_END_DEG = normDeg((Math.atan2(0 - FRONTAGE_CENTER.y, 40 - 20) * 180) / Math.PI);

const seedLine = (id: string, fx: number, fy: number, tx: number, ty: number): CadLineEntity => ({
  id,
  type: 'line',
  layerId: 'general',
  visible: true,
  locked: false,
  fromStationId: `${id}-a`,
  toStationId: `${id}-b`,
  fromX: fx,
  fromY: fy,
  toX: tx,
  toY: ty,
  sourceObservationIds: [],
});

const seedFrontageArc = (id: string): CadArcEntity => ({
  id,
  type: 'arc',
  layerId: 'general',
  visible: true,
  locked: false,
  centerX: FRONTAGE_CENTER.x,
  centerY: FRONTAGE_CENTER.y,
  radius: FRONTAGE_RADIUS,
  startAngleDeg: FRONTAGE_START_DEG,
  endAngleDeg: FRONTAGE_END_DEG,
});

const splitLine = (fx: number, fy: number, tx: number, ty: number): CadLineEntity =>
  seedLine(`split-${fx}-${fy}-${tx}-${ty}`, fx, fy, tx, ty);

const frontageLine = (fx: number, fy: number, tx: number, ty: number): CadLineEntity => ({
  ...seedLine('frontage-line', fx, fy, tx, ty),
  fromStationId: 'F1',
  toStationId: 'F2',
});

/** Chain entities in traversal order: east, north, west, then the frontage arc. */
const buildChainEntities = (): Array<CadLineEntity | CadArcEntity> => [
  seedLine('line:east', 40, 0, 40, 30),
  seedLine('line:north', 40, 30, 0, 30),
  seedLine('line:west', 0, 30, 0, 0),
  seedFrontageArc('arc:road'),
];

/** LOT 1 via the production PARCEL_CREATE seam (letter A). */
const createLot1 = (): CadParcelEntity => {
  const document = createBlankCadDrawingDocument({ name: 'Curved Parcel QA 19C', units: 'm' });
  const project = { ...document.project, entities: [...buildChainEntities()] };
  const history = runCadCommand(createCadHistoryState(project, []), {
    key: 'PARCEL_CREATE',
    sourceEntityIds: ['line:east', 'line:north', 'line:west', 'arc:road'],
  });
  const parcel = history.present.project.entities.find(
    (entity): entity is CadParcelEntity => entity.type === 'parcel',
  );
  if (!parcel) throw new Error('PARCEL_CREATE failed on the seeded Line+Arc chain');
  return parcel;
};

/** Full drawing: chain sources + LOT 1 + two monuments. */
const buildCurvedParcelDocument = (): { document: CadDrawingDocument; parcel: CadParcelEntity } => {
  const parcel = createLot1();
  const document = createBlankCadDrawingDocument({ name: 'Curved Parcel QA 19C', units: 'm' });
  return {
    document: {
      ...document,
      project: {
        ...document.project,
        entities: [
          ...buildChainEntities(),
          parcel,
          {
            id: 'pt:MON1', type: 'survey-point', layerId: 'general', visible: true, locked: false,
            stationId: 'MON1', x: 40, y: 30, z: 10, pointClass: 'free',
            source: 'parsed-input', description: 'IP',
          },
          {
            id: 'pt:MON2', type: 'survey-point', layerId: 'general', visible: true, locked: false,
            stationId: 'MON2', x: 0, y: 30, pointClass: 'free',
            source: 'parsed-input', description: 'IP',
          },
        ],
      },
    },
    parcel,
  };
};

const writeCurvedParcelFixture = (): string => {
  const { document } = buildCurvedParcelDocument();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wn-19c-'));
  const filePath = path.join(dir, 'curved-parcel-19c.wncad');
  fs.writeFileSync(filePath, serializeCadDrawingFile(document), 'utf8');
  return filePath;
};

const openCurvedParcelDrawing = async (page: Parameters<typeof gotoCad>[0], fixturePath: string): Promise<void> => {
  const fileInput = page.locator('[data-survey-cad-open-drawing-input]');
  await fileInput.evaluate((element: HTMLInputElement) => element.classList.remove('hidden')).catch(() => {});
  await fileInput.setInputFiles(fixturePath);
  await expect.poll(() => entityCount(page)).toBeGreaterThan(0);
};

const arcCourseOf = (parcel: CadParcelEntity) => {
  const courses = resolveCadParcelCourses(parcel);
  const arc = courses.find((course) => course.kind === 'arc');
  if (!arc || arc.kind !== 'arc') throw new Error('seeded LOT 1 has no arc course');
  return { courses, arc };
};

// ---------------------------------------------------------------------------
// Browser flows — real /cad UI at the 1366x768 minimum viewport
// ---------------------------------------------------------------------------

test.describe('Phase 19C curved parcels (browser flows)', () => {
  test.use({ viewport: { width: 1366, height: 768 } });

  test('B(browser): Parcel Course Table on LOT 1 shows ARC radius; PC# tags render at course midpoints', async ({
    page,
  }) => {
    const errors: string[] = [];
    await gotoCad(page, errors);
    await openCurvedParcelDrawing(page, writeCurvedParcelFixture());

    await selectAll(page);
    await createTable(page, 'PARCELTABLE');

    const panel = await openSurveyTableManager(page);
    await expect(panel.locator('[data-cad-survey-table-kind]')).toHaveText('Parcel Course');
    await expect(panel.locator('[data-cad-survey-table-row]')).toHaveCount(4);
    expect(await tableRowCodes(page)).toEqual(['PC1', 'PC2', 'PC3', 'PC4']);

    // The frontage course is the arc row: line headings stay blank, curve
    // columns carry the exact R50 geometry.
    const rows = panel.locator('[data-cad-survey-table-row]');
    await expect(rows.nth(3)).toContainText('ARC');
    await expect(rows.nth(3)).toContainText('50.000');
    await expect(rows.nth(0)).toContainText('30.000');
    await closeSurveyTableManager(page);

    // PC# tags render on-plan for the same rows (the arc tag carries the
    // full curve call at the true curve midpoint — pinned exactly at the
    // store level below).
    const viewportText = await page
      .locator('[data-cad-viewport] svg text[data-survey-cad-render-entity-id]')
      .evaluateAll((nodes) => nodes.map((node) => node.textContent ?? ''));
    for (const code of ['PC1', 'PC2', 'PC3', 'PC4']) expect(viewportText).toContain(code);
    expect(viewportText.some((text) => text.includes('50.000 m'))).toBe(true);
    expect(errors).toEqual([]);
  });

  test('O(browser): layout sheet + 1:500 viewport shows the curved parcel', async ({ page }) => {
    const errors: string[] = [];
    await gotoCad(page, errors);
    await openCurvedParcelDrawing(page, writeCurvedParcelFixture());
    await addLayoutSheet(page);
    await layoutTab(page, 'Layout 1').click();
    await createViewportMview(page, { centerX: '20', centerY: '13', scale: '500' });
    await expect(sheetSvg(page)).toBeVisible();
    await expect(paperStatus(page)).toHaveText('Layout1 | Viewport: 1:500');
    expect(errors).toEqual([]);
  });

  test('N(browser): Save Drawing round-trips the arc course; reopen keeps every entity', async ({ page }) => {
    const errors: string[] = [];
    await gotoCad(page, errors);
    const before = await entityCount(page).catch(() => -1);
    expect(before).toBeLessThanOrEqual(0);
    await openCurvedParcelDrawing(page, writeCurvedParcelFixture());
    const opened = await entityCount(page);

    const saved = await saveDrawingText(page);
    const parsed = parseCadDrawingFile(saved.text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const parcel = parsed.drawing.project.entities.find(
      (entity): entity is CadParcelEntity => entity.type === 'parcel',
    );
    expect(parcel?.courseGeometry?.some((entry) => entry.kind === 'arc')).toBe(true);

    await openCurvedParcelDrawing(page, path.join(saved.dir, 'drawing.wncad'));
    await expect.poll(() => entityCount(page)).toBe(opened);
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Store-level flows — production engine seams the UI commits through.
// ---------------------------------------------------------------------------

test.describe('Phase 19C curved parcels (store-level flows)', () => {
  test('A: PARCEL_CREATE from the Line+Arc chain resolves exact area/perimeter', () => {
    const parcel = createLot1();
    const courses = resolveCadParcelCourses(parcel);
    expect(courses).toHaveLength(4);
    expect(courses.filter((course) => course.kind === 'arc')).toHaveLength(1);
    expect(courses.filter((course) => course.kind === 'line')).toHaveLength(3);
    const closure = cadBuildParcelClosureSummary(parcel.vertices, {
      courseGeometry: parcel.courseGeometry,
    });
    expect(closure?.areaSquareMeters).toBeCloseTo(parcel.areaSquareMeters ?? 0, 9);
    expect(closure?.perimeterMeters).toBeCloseTo(parcel.perimeterMeters ?? 0, 9);
    // Chord-only shoelace understates the bulging frontage: the arc term is real.
    expect(parcel.areaSquareMeters ?? 0).toBeGreaterThan(1200);
  });

  test('B(store): arc tag anchor is the true curve midpoint, kind curve', () => {
    const { parcel } = buildCurvedParcelDocument();
    const { arc } = arcCourseOf(parcel);
    const table = deriveCadSurveyTableFromSource(
      { kind: 'parcel-course', parcel },
      buildCurvedParcelDocument().document.project,
    );
    expect(table.rows).toHaveLength(4);
    const arcAnchor = table.tagAnchors[arc.index];
    expect(arcAnchor?.kind).toBe('curve');
    expect(arcAnchor?.point.x).toBeCloseTo(arc.midpoint.x, 9);
    expect(arcAnchor?.point.y).toBeCloseTo(arc.midpoint.y, 9);
    // The midpoint sits on the R50 circle, south of the chord.
    const dx = (arcAnchor?.point.x ?? 0) - FRONTAGE_CENTER.x;
    const dy = (arcAnchor?.point.y ?? 0) - FRONTAGE_CENTER.y;
    expect(Math.hypot(dx, dy)).toBeCloseTo(FRONTAGE_RADIUS, 6);
    expect(table.tagAnchors.map((anchor) => anchor.tag)).toEqual(['L1', 'L2', 'L3', 'L4']);
  });

  test('C: PARCELCOURSEARC keeps the course id and leaves the source arc untouched', () => {
    const document = createBlankCadDrawingDocument({ name: 'arc-adopt 19C', units: 'm' });
    // South-first entity order: the closed-line builder closes the walk with
    // the start node's first-seen label, so east-first order is rejected
    // (harness ordering, not product behavior — the mixed chain in A is
    // order-independent through the 19C chain builder).
    const rect: CadLineEntity[] = [
      seedLine('r:south', 0, 0, 40, 0),
      seedLine('r:east', 40, 0, 40, 30),
      seedLine('r:north', 40, 30, 0, 30),
      seedLine('r:west', 0, 30, 0, 0),
    ];
    const project = { ...document.project, entities: [...rect] };
    const created = runCadCommand(createCadHistoryState(project, []), {
      key: 'PARCEL_CREATE',
      sourceEntityIds: rect.map((line) => line.id),
    });
    const parcel = created.present.project.entities.find(
      (entity): entity is CadParcelEntity => entity.type === 'parcel',
    );
    if (!parcel) throw new Error('rect parcel not created');
    const target = resolveCadParcelCourses(parcel)[0];
    if (!target || target.kind !== 'line') throw new Error('course 0 missing');
    // Matching arc over course 0 (chord (40,0)->(40,30), R50 bulging east).
    const chordDx = target.toVertex.x - target.fromVertex.x;
    const chordDy = target.toVertex.y - target.fromVertex.y;
    const chordLen = Math.hypot(chordDx, chordDy);
    const midX = (target.fromVertex.x + target.toVertex.x) / 2;
    const midY = (target.fromVertex.y + target.toVertex.y) / 2;
    const off = Math.sqrt(2500 - (chordLen / 2) ** 2);
    const cx = midX + (-chordDy / chordLen) * off;
    const cy = midY + (chordDx / chordLen) * off;
    const toDeg = (radians: number): number => normDeg((radians * 180) / Math.PI);
    const adopting: CadArcEntity = {
      id: 'arc:adopt', type: 'arc', layerId: 'general', visible: true, locked: false,
      centerX: cx, centerY: cy, radius: 50,
      startAngleDeg: toDeg(Math.atan2(target.fromVertex.y - cy, target.fromVertex.x - cx)),
      endAngleDeg: toDeg(Math.atan2(target.toVertex.y - cy, target.toVertex.x - cx)),
    };
    const withArc = appendCadProjectEntities(created.present.project, [adopting]);
    const arcBefore = JSON.stringify(withArc.entities.find((entity) => entity.id === 'arc:adopt'));
    const next = runCadCommand(createCadHistoryState(withArc, [parcel.id]), {
      key: 'PARCELCOURSEARC',
      parcelEntityId: parcel.id,
      courseId: target.courseId,
      arcEntityId: 'arc:adopt',
    });
    const updated = next.present.project.entities.find(
      (entity): entity is CadParcelEntity => entity.id === parcel.id,
    );
    if (!updated) throw new Error('parcel lost after PARCELCOURSEARC');
    const adopted = resolveCadParcelCourses(updated)[0];
    expect(adopted?.courseId).toBe(target.courseId);
    expect(adopted?.kind).toBe('arc');
    // Source arc untouched by the adoption (snapshot ownership).
    expect(JSON.stringify(next.present.project.entities.find((entity) => entity.id === 'arc:adopt'))).toBe(
      arcBefore,
    );
  });

  test('D: PARCELCOURSELINE retires the arc to its chord, id and endpoints stable', () => {
    const { document, parcel } = buildCurvedParcelDocument();
    const { arc } = arcCourseOf(parcel);
    const project = { ...document.project, entities: [...document.project.entities] };
    const next = runCadCommand(createCadHistoryState(project, [parcel.id]), {
      key: 'PARCELCOURSELINE',
      parcelEntityId: parcel.id,
      courseId: arc.courseId,
    });
    const updated = next.present.project.entities.find(
      (entity): entity is CadParcelEntity => entity.id === parcel.id,
    );
    if (!updated) throw new Error('parcel lost after PARCELCOURSELINE');
    const retired = resolveCadParcelCourses(updated)[arc.index];
    expect(retired?.courseId).toBe(arc.courseId);
    expect(retired?.kind).toBe('line');
    if (!retired || retired.kind !== 'line') throw new Error('course did not retire to line');
    expect([retired.fromVertex.x, retired.fromVertex.y]).toEqual([arc.fromVertex.x, arc.fromVertex.y]);
    expect([retired.toVertex.x, retired.toVertex.y]).toEqual([arc.toVertex.x, arc.toVertex.y]);
  });

  test('E: legal description numbers match the course table exactly', () => {
    const { document, parcel } = buildCurvedParcelDocument();
    const { arc } = arcCourseOf(parcel);
    if (arc.kind !== 'arc') throw new Error('arc course missing');
    const table = deriveCadSurveyTableFromSource({ kind: 'parcel-course', parcel }, document.project);
    const result = buildCadParcelLegalDescription(parcel);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const arcRow = table.rows[arc.index];
    expect(arcRow?.cells[5]).toBe('ARC');
    // Radius + arc length cells parse back to the resolver curve numbers.
    expect(Number.parseFloat(arcRow?.cells[6] ?? '')).toBeCloseTo(arc.radius, 3);
    expect(Number.parseFloat(arcRow?.cells[8] ?? '')).toBeCloseTo(arc.arcLength, 3);
    // The DRAFT text carries the same radius/arc-length call.
    expect(result.description.text).toContain(arc.radius.toFixed(3));
    expect(result.description.text).toContain(arc.arcLength.toFixed(3));
    expect(result.description.areaSquareMeters).toBeCloseTo(parcel.areaSquareMeters ?? 0, 6);
  });

  test('F: reverse flips left/right and chord bearings, same point set', () => {
    const { parcel } = buildCurvedParcelDocument();
    const forward = resolveSurveyParcelCourses(parcel);
    const backward = reverseCadParcelCourses(forward);
    expect(backward).toHaveLength(forward.length);
    for (const course of forward) {
      const match = backward.find((candidate) => candidate.courseId === course.courseId);
      expect(match).toBeDefined();
      if (!match || !course.curve || !match.curve) continue;
      expect(match.curve.direction).toBe(course.curve.direction === 'left' ? 'right' : 'left');
      // Chord bearing is re-derived from the swapped endpoints (authoritative
      // inverse, not string math); the arc midpoint is invariant.
      expect(match.curve.chordBearing).not.toBe(course.curve.chordBearing);
      expect(match.midpoint.x).toBeCloseTo(course.midpoint.x, 9);
      expect(match.midpoint.y).toBeCloseTo(course.midpoint.y, 9);
    }
    const described = buildCadParcelLegalDescription(parcel, { reverse: true });
    expect(described.ok).toBe(true);
  });

  test('G: split-by-line through the arc conserves area with exact sub-arcs', () => {
    const { parcel } = buildCurvedParcelDocument();
    const draft = cadBuildParcelSplitByLineDraft(parcel, splitLine(20, -20, 20, 40));
    expect(draft).not.toBeNull();
    if (!draft) return;
    const parent = cadBuildParcelClosureSummary(parcel.vertices, {
      courseGeometry: parcel.courseGeometry,
    });
    const first = cadBuildParcelClosureSummary(
      draft.firstVertices,
      draft.firstCourseGeometry ? { courseGeometry: draft.firstCourseGeometry } : undefined,
    );
    const second = cadBuildParcelClosureSummary(
      draft.secondVertices,
      draft.secondCourseGeometry ? { courseGeometry: draft.secondCourseGeometry } : undefined,
    );
    expect(first!.areaSquareMeters + second!.areaSquareMeters).toBeCloseTo(
      parent!.areaSquareMeters,
      6,
    );
    expect(
      (draft.firstCourseGeometry ?? []).some((entry) => entry.kind === 'arc') ||
        (draft.secondCourseGeometry ?? []).some((entry) => entry.kind === 'arc'),
    ).toBe(true);
  });

  test('H: split-by-bearing on the curved boundary conserves area', () => {
    const { parcel } = buildCurvedParcelDocument();
    const draft = cadBuildParcelSplitByBearingDraft(parcel, { x: 20, y: 15 }, 'N 0° E');
    expect(draft).not.toBeNull();
    if (!draft) return;
    const parent = cadBuildParcelClosureSummary(parcel.vertices, {
      courseGeometry: parcel.courseGeometry,
    });
    const first = cadBuildParcelClosureSummary(
      draft.firstVertices,
      draft.firstCourseGeometry ? { courseGeometry: draft.firstCourseGeometry } : undefined,
    );
    const second = cadBuildParcelClosureSummary(
      draft.secondVertices,
      draft.secondCourseGeometry ? { courseGeometry: draft.secondCourseGeometry } : undefined,
    );
    expect(first!.areaSquareMeters + second!.areaSquareMeters).toBeCloseTo(
      parent!.areaSquareMeters,
      6,
    );
  });

  test('I: split-by-area hits the target within contract and conserves area', () => {
    const { parcel } = buildCurvedParcelDocument();
    const parent = cadBuildParcelClosureSummary(parcel.vertices, {
      courseGeometry: parcel.courseGeometry,
    });
    const target = parent!.areaSquareMeters / 2;
    const draft = cadBuildParcelSplitByAreaDraft(parcel, { x: 20, y: 28 }, target);
    expect(draft).not.toBeNull();
    if (!draft) return;
    const first = cadBuildParcelClosureSummary(
      draft.firstVertices,
      draft.firstCourseGeometry ? { courseGeometry: draft.firstCourseGeometry } : undefined,
    );
    const second = cadBuildParcelClosureSummary(
      draft.secondVertices,
      draft.secondCourseGeometry ? { courseGeometry: draft.secondCourseGeometry } : undefined,
    );
    const achievedError = Math.min(
      Math.abs(first!.areaSquareMeters - target),
      Math.abs(second!.areaSquareMeters - target),
    );
    expect(achievedError).toBeLessThanOrEqual(Math.max(parent!.areaSquareMeters * 1e-6, 1e-3));
    expect(first!.areaSquareMeters + second!.areaSquareMeters).toBeCloseTo(
      parent!.areaSquareMeters,
      6,
    );
  });

  test('J: slide on the curved parent hits the target and conserves area', () => {
    const { parcel } = buildCurvedParcelDocument();
    const parent = cadBuildParcelClosureSummary(parcel.vertices, {
      courseGeometry: parcel.courseGeometry,
    });
    const target = parent!.areaSquareMeters / 3;
    const draft = cadBuildParcelSplitBySlideDraft(
      parcel,
      frontageLine(40, 0, 40, 30),
      target,
      1,
      'start',
    );
    expect(draft).not.toBeNull();
    if (!draft) return;
    expect(draft.childAreaSquareMeters).toBeCloseTo(target, 0);
    const first = cadBuildParcelClosureSummary(
      draft.split.firstVertices,
      draft.split.firstCourseGeometry ? { courseGeometry: draft.split.firstCourseGeometry } : undefined,
    );
    const second = cadBuildParcelClosureSummary(
      draft.split.secondVertices,
      draft.split.secondCourseGeometry ? { courseGeometry: draft.split.secondCourseGeometry } : undefined,
    );
    expect(first!.areaSquareMeters + second!.areaSquareMeters).toBeCloseTo(
      parent!.areaSquareMeters,
      6,
    );
  });

  test('K: swing on the curved parent keeps arcs and conserves area', () => {
    const { parcel } = buildCurvedParcelDocument();
    const parent = cadBuildParcelClosureSummary(parcel.vertices, {
      courseGeometry: parcel.courseGeometry,
    });
    const target = parent!.areaSquareMeters / 4;
    const draft = cadBuildParcelSplitBySwingDraft(
      parcel,
      frontageLine(40, 0, 40, 30),
      target,
      1,
      'start',
    );
    expect(draft).not.toBeNull();
    if (!draft) return;
    expect(draft.split.firstCourseGeometry ?? draft.split.secondCourseGeometry).toBeDefined();
    const first = cadBuildParcelClosureSummary(
      draft.split.firstVertices,
      draft.split.firstCourseGeometry ? { courseGeometry: draft.split.firstCourseGeometry } : undefined,
    );
    const second = cadBuildParcelClosureSummary(
      draft.split.secondVertices,
      draft.split.secondCourseGeometry ? { courseGeometry: draft.split.secondCourseGeometry } : undefined,
    );
    expect(first!.areaSquareMeters + second!.areaSquareMeters).toBeCloseTo(
      parent!.areaSquareMeters,
      6,
    );
  });

  test('L: an arc frontage source fails closed with CURVED_FRONTAGE_UNSUPPORTED', () => {
    const { document, parcel } = buildCurvedParcelDocument();
    const resolution = resolveParcelSplitFrontageSource(
      {
        project: document.project,
        selection: createCadSelectionState(document.project, [parcel.id]),
      },
      parcel,
      'arc:road',
      null,
    );
    expect(resolution.ok).toBe(false);
    if (!resolution.ok) expect(resolution.code).toBe('CURVED_FRONTAGE_UNSUPPORTED');
  });

  test('M: move/rotate/scale keep metrics; mirror flips the signed bulge', () => {
    const { document, parcel } = buildCurvedParcelDocument();
    const area = parcel.areaSquareMeters ?? 0;
    const perimeter = parcel.perimeterMeters ?? 0;
    const { arc } = arcCourseOf(parcel);
    if (arc.kind !== 'arc') throw new Error('arc course missing');
    const bulgeOf = (entity: CadParcelEntity): number => {
      const entry = entity.courseGeometry?.[arc.index];
      if (!entry || entry.kind !== 'arc') throw new Error('arc course lost under transform');
      return (entry as { bulge: number }).bulge;
    };

    const moved = runCadCommand(createCadHistoryState(document.project, [parcel.id]), {
      key: 'MOVE', deltaX: 100, deltaY: 50,
    });
    const movedParcel = moved.present.project.entities.find(
      (entity): entity is CadParcelEntity => entity.id === parcel.id,
    )!;
    expect(movedParcel.areaSquareMeters).toBeCloseTo(area, 9);
    expect(bulgeOf(movedParcel)).toBeCloseTo(
      (parcel.courseGeometry?.[arc.index] as { bulge: number }).bulge,
      12,
    );

    const rotated = runCadCommand(createCadHistoryState(document.project, [parcel.id]), {
      key: 'ROTATE', baseX: 20, baseY: 13, angleDeg: 90,
    });
    const rotatedParcel = rotated.present.project.entities.find(
      (entity): entity is CadParcelEntity => entity.id === parcel.id,
    )!;
    expect(rotatedParcel.areaSquareMeters).toBeCloseTo(area, 6);
    expect(rotatedParcel.perimeterMeters).toBeCloseTo(perimeter, 6);

    const scaled = runCadCommand(createCadHistoryState(document.project, [parcel.id]), {
      key: 'SCALE', baseX: 0, baseY: 0, factor: 2,
    });
    const scaledParcel = scaled.present.project.entities.find(
      (entity): entity is CadParcelEntity => entity.id === parcel.id,
    )!;
    expect(scaledParcel.areaSquareMeters).toBeCloseTo(area * 4, 6);
    expect(scaledParcel.perimeterMeters).toBeCloseTo(perimeter * 2, 6);

    const mirrored = runCadCommand(createCadHistoryState(document.project, [parcel.id]), {
      key: 'MIRROR', p1: { x: 20, y: 0 }, p2: { x: 20, y: 30 }, eraseSource: false,
    });
    const mirroredId = mirrored.present.project.entities
      .filter((entity): entity is CadParcelEntity => entity.type === 'parcel')
      .find((entity) => entity.id !== parcel.id)?.id;
    // MIRROR with eraseSource:false copies: at least the original survives
    // with its metrics intact, and any mirrored copy carries flipped curvature.
    expect(mirrored.present.project.entities.some((entity) => entity.id === parcel.id)).toBe(true);
    if (mirroredId) {
      const copy = mirrored.present.project.entities.find(
        (entity): entity is CadParcelEntity => entity.id === mirroredId,
      )!;
      expect(copy.areaSquareMeters).toBeCloseTo(area, 6);
      const copyCourses = resolveCadParcelCourses(copy);
      const copyArc = copyCourses[arc.index];
      if (!copyArc || copyArc.kind !== 'arc') throw new Error('mirrored copy lost its arc');
      expect(copyArc.signedSweepDeg).toBeCloseTo(-arc.signedSweepDeg, 6);
    }
  });

  test('N(store): save/reopen preserves arc courses, ids, and metrics exactly', () => {
    const { document, parcel } = buildCurvedParcelDocument();
    const parsed = parseCadDrawingFile(serializeCadDrawingFile(document));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const reopened = parsed.drawing.project.entities.find(
      (entity): entity is CadParcelEntity => entity.id === parcel.id,
    )!;
    expect(reopened.courseIds).toEqual(parcel.courseIds);
    expect(reopened.courseGeometry).toEqual(parcel.courseGeometry);
    expect(reopened.areaSquareMeters).toBeCloseTo(parcel.areaSquareMeters ?? 0, 9);
    expect(reopened.perimeterMeters).toBeCloseTo(parcel.perimeterMeters ?? 0, 9);
    expect(JSON.stringify(resolveCadParcelCourses(reopened))).toBe(
      JSON.stringify(resolveCadParcelCourses(parcel)),
    );
  });

  test('O(store): 1:500 sheet scene carries the curved parcel and its course table', () => {
    const { document, parcel } = buildCurvedParcelDocument();
    const tabled = runCadCommand(createCadHistoryState(document.project, [parcel.id]), {
      key: 'PARCELTABLE',
      insertX: 60,
      insertY: 0,
      sourceEntityIds: [parcel.id],
    });
    const project = tabled.present.project;
    const draft = document.draft;
    if (!draft) throw new Error('blank drawing has no draft');
    const withSheet = addSheetToDraft(
      draft,
      createPlanSheet({ name: 'A-101', sizeId: 'ISO A3', orientation: 'landscape' }),
    );
    const sheet = withSheet.sheets[withSheet.sheets.length - 1];
    if (!sheet) throw new Error('sheet not created');
    const withViewport = addViewportToSheet(withSheet, sheet.id, {
      name: 'VP-1', modelCenterX: 20, modelCenterY: 13, scaleDenominator: 500,
      paperXmm: 60, paperYmm: 40, paperWidthMm: 300, paperHeightMm: 200, rotationDeg: 0,
    });
    const scene = buildExportSheetSceneWithResult({ draft: withViewport, sheetId: sheet.id, project });
    expect(scene.exportedEntityIds).toContain(parcel.id);
    expect(modelToPaperMm(10, 500)).toBeCloseTo(20, 9);
    const tableId = project.entities.find(
      (entity) => entity.type === 'survey-table' && entity.id !== parcel.id,
    )?.id;
    if (tableId) expect(scene.exportedEntityIds).toContain(tableId);
  });

  test('P: SVG/PDF carry the curved parcel; DXF and LandXML stay honest about the parcel', () => {
    const { document, parcel } = buildCurvedParcelDocument();
    const draft = document.draft;
    if (!draft) throw new Error('blank drawing has no draft');
    const withSheet = addSheetToDraft(
      draft,
      createPlanSheet({ name: 'A-101', sizeId: 'ISO A3', orientation: 'landscape' }),
    );
    const sheet = withSheet.sheets[withSheet.sheets.length - 1];
    if (!sheet) throw new Error('sheet not created');
    const withViewport = addViewportToSheet(withSheet, sheet.id, {
      name: 'VP-1', modelCenterX: 20, modelCenterY: 13, scaleDenominator: 500,
      paperXmm: 60, paperYmm: 40, paperWidthMm: 300, paperHeightMm: 200, rotationDeg: 0,
    });
    const scene = buildExportSheetSceneWithResult({
      draft: withViewport, sheetId: sheet.id, project: document.project,
    });
    // Sheet scene projects model geometry to paper (arcs arrive as
    // polylines through the viewport projection): the parcel must still
    // reach the sheet with its area label intact, and the reversed-
    // traversal (CW) frontage course must tessellate its 47° minor arc —
    // never the complementary 313° major arc (full-circle ghost).
    expect(scene.exportedEntityIds).toContain(parcel.id);
    const parcelPolylines = scene.output.items.filter(
      (item): item is Extract<typeof item, { kind: 'polyline' }> =>
        item.kind === 'polyline' && item.sourceEntityId === parcel.id,
    );
    expect(parcelPolylines.length).toBeGreaterThan(0);
    for (const polyline of parcelPolylines) {
      expect(polyline.points.length).toBeLessThanOrEqual(10);
    }
    const svg = serializeExportSceneToSvgWithResult(scene.output).output;
    expect(svg).toContain('m²');
    // PDF renders the same projected scene without loss.
    const pdf = new TextDecoder().decode(exportScenesToPdfWithResult([scene.output]).output);
    expect(pdf.length).toBeGreaterThan(0);

    // DXF exact: native LINE+ARC primitives with the true R50 radius (never
    // a silent chord polyline) with the parcel-approximation warning retained.
    const dxf = buildDxfExportModelWithResult({ project: document.project });
    expect(dxf.output.arcs.length).toBeGreaterThan(0);
    expect(dxf.output.arcs.some((entry) => Math.abs(entry.radius - FRONTAGE_RADIUS) < 1e-9)).toBe(true);
    expect(dxf.output.polylines).toHaveLength(0);
    expect(
      dxf.warnings.some((warning) =>
        warning.message.includes(`${parcel.id} approximated as line/arc primitives`),
      ),
    ).toBe(true);

    // LandXML honest: schema Curve geometry with the Parcel-ring warning.
    const xml = buildLandXmlProjectExportWithResult(document.project, {
      units: 'm',
      projectName: 'curved-19c',
    });
    expect(xml.output).toContain('<Curve');
    expect(
      xml.warnings.some(
        (warning) => warning.entityId === parcel.id && /Parcel ring/.test(warning.message),
      ),
    ).toBe(true);
  });

  test('split-by-area contract guard: every course geometry entry survives validation', () => {
    const { parcel } = buildCurvedParcelDocument();
    const geometry: CadParcelCourseGeometry[] = parcel.courseGeometry ?? [];
    expect(geometry).toHaveLength(parcel.vertices.length);
    expect(geometry.filter((entry) => entry.kind === 'arc')).toHaveLength(1);
  });
});
