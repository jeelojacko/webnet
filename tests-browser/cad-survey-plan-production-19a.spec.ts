/**
 * Phase 19A browser QA — professional survey plan production through the real
 * /cad app (§121), plus store-level coverage where the standalone shell has no
 * interaction surface.
 *
 * Browser tests drive the production ribbon commands + insertion picks + the
 * Survey Table manager row editor (A, C, D, H, K, L, M). Store-level tests use
 * the same production engine seams for flows where the standalone /cad shell
 * has no direct surface or where in-app target selection is not reliably
 * drivable (B source-geometry edit, E parcel transforms, F course topology,
 * G multi-parcel totals, I table style editing, J annotation-scale plumbing,
 * N legal-description drafting, O export dispositions). Each store-level test
 * names its reason — nothing is faked.
 *
 * Zero page/console errors are asserted per browser test.
 */
import { expect, test } from '@playwright/test';
import * as path from 'node:path';

import { createCadHistoryState, runCadCommand } from '../src/engine/cad/cadUndoRedo';
import { deriveCadSurveyTable } from '../src/engine/cad/cadSurveyTableDerive';
import { insertParcelCourseVertex } from '../src/engine/cad/cadParcelCourses';
import {
  CAD_SURVEY_TABLE_DXF_DISPOSITION,
  buildCadSurveyTableDxfItems,
  deriveCadSurveyTableFromSource,
  formatCadSurveyTableCsv,
} from '../src/engine/cad/cadSurveyExportTables';
import { buildCadParcelLegalDescription } from '../src/engine/cad/cadParcelLegalDescription';
import { buildCadDisplayScene } from '../src/engine/cad/cadRenderer';
import type {
  CadEntityId,
  CadParcelEntity,
  CadProject,
  CadSurveyTableEntity,
} from '../src/engine/cad/cadTypes';
import {
  LINE_IDS,
  PARCEL_IDS,
  buildSurveyPlanProject,
  clearSelection,
  closeSurveyTableManager,
  createTable,
  entityCount,
  gotoCad,
  homeTab,
  openSurveyPlanDrawing,
  openSurveyTableManager,
  saveDrawingText,
  selectAll,
  tableRowCodes,
  writeSurveyPlanFixture,
} from './cad-survey-plan-19a-helpers';

const findSurveyTable = (project: CadProject): CadSurveyTableEntity => {
  const table = project.entities.find(
    (entity): entity is CadSurveyTableEntity => entity.type === 'survey-table',
  );
  if (!table) throw new Error('survey-table entity not found');
  return table;
};

const parcelOf = (project: CadProject, parcelId: CadEntityId): CadParcelEntity => {
  const parcel = project.entities.find(
    (entity): entity is CadParcelEntity => entity.type === 'parcel' && entity.id === parcelId,
  );
  if (!parcel) throw new Error(`parcel ${parcelId} not found`);
  return parcel;
};

// ---------------------------------------------------------------------------
// Browser flows — real /cad UI
// ---------------------------------------------------------------------------

test.describe('Phase 19A survey plan production (browser flows)', () => {
  test('A: Line Table from 4 lines shows L1-L4 with formatted bearing and distance', async ({ page }) => {
    const errors: string[] = [];
    await gotoCad(page, errors);
    await openSurveyPlanDrawing(page, writeSurveyPlanFixture());

    await selectAll(page);
    await createTable(page, 'LINETABLE');

    const panel = await openSurveyTableManager(page);
    await expect(panel.locator('[data-cad-survey-table-kind]')).toHaveText('Line');
    await expect(panel.locator('[data-cad-survey-table-row]')).toHaveCount(4);
    expect(await tableRowCodes(page)).toEqual(['L1', 'L2', 'L3', 'L4']);

    const rows = panel.locator('[data-cad-survey-table-row]');
    // Code, From, To, Bearing, Distance (the code column repeats the row code).
    await expect(rows.nth(0)).toContainText('N00-00-00.00E');
    await expect(rows.nth(0)).toContainText('5.000');
    await expect(rows.nth(1)).toContainText('N90-00-00.00E');
    await expect(rows.nth(1)).toContainText('10.000');
    await expect(rows.nth(2)).toContainText('S00-00-00.00E');
    await expect(rows.nth(2)).toContainText('4.000');
    await expect(rows.nth(3)).toContainText('S90-00-00.00W');
    await expect(rows.nth(3)).toContainText('10.000');

    // L# tags render on-plan for the same rows.
    const viewportText = await page
      .locator('[data-cad-viewport] svg text[data-survey-cad-render-entity-id]')
      .evaluateAll((nodes) => nodes.map((node) => node.textContent ?? ''));
    for (const code of ['L1', 'L2', 'L3', 'L4']) expect(viewportText).toContain(code);

    await closeSurveyTableManager(page);
    expect(errors).toEqual([]);
  });

  test('C: Curve Table from 3 arcs shows C1-C3 radius/delta/arc/chord', async ({ page }) => {
    const errors: string[] = [];
    await gotoCad(page, errors);
    await openSurveyPlanDrawing(page, writeSurveyPlanFixture());

    await selectAll(page);
    await createTable(page, 'CURVETABLE');

    const panel = await openSurveyTableManager(page);
    await expect(panel.locator('[data-cad-survey-table-kind]')).toHaveText('Curve');
    await expect(panel.locator('[data-cad-survey-table-row]')).toHaveCount(3);
    expect(await tableRowCodes(page)).toEqual(['C1', 'C2', 'C3']);

    const rows = panel.locator('[data-cad-survey-table-row]');
    await expect(rows.nth(0)).toContainText('100.000');
    await expect(rows.nth(0)).toContainText('90.00°');
    await expect(rows.nth(0)).toContainText('157.080');
    await expect(rows.nth(0)).toContainText('141.421');
    await expect(rows.nth(1)).toContainText('50.000');
    await expect(rows.nth(1)).toContainText('90.00°');
    await expect(rows.nth(1)).toContainText('78.540');
    await expect(rows.nth(1)).toContainText('70.711');
    await expect(rows.nth(2)).toContainText('25.000');
    await expect(rows.nth(2)).toContainText('39.270');
    await expect(rows.nth(2)).toContainText('35.355');

    await closeSurveyTableManager(page);
    expect(errors).toEqual([]);
  });

  test('D: Parcel Course Table on a rectangle yields 4 stable course rows', async ({ page }) => {
    const errors: string[] = [];
    await gotoCad(page, errors);
    await openSurveyPlanDrawing(page, writeSurveyPlanFixture());

    await selectAll(page);
    await createTable(page, 'PARCELTABLE');

    const panel = await openSurveyTableManager(page);
    await expect(panel.locator('[data-cad-survey-table-kind]')).toHaveText('Parcel Course');
    await expect(panel.locator('[data-cad-survey-table-row]')).toHaveCount(4);
    expect(await tableRowCodes(page)).toEqual(['PC1', 'PC2', 'PC3', 'PC4']);

    const rows = panel.locator('[data-cad-survey-table-row]');
    await expect(rows.nth(0)).toContainText('N90-00-00.00E');
    await expect(rows.nth(0)).toContainText('40.000');
    await expect(rows.nth(1)).toContainText('N00-00-00.00E');
    await expect(rows.nth(1)).toContainText('30.000');
    await expect(rows.nth(2)).toContainText('S90-00-00.00W');
    await expect(rows.nth(3)).toContainText('S00-00-00.00E');

    await closeSurveyTableManager(page);
    expect(errors).toEqual([]);
  });

  test('H: Point Table lists points in station order and leaves undefined Z blank', async ({ page }) => {
    const errors: string[] = [];
    await gotoCad(page, errors);
    await openSurveyPlanDrawing(page, writeSurveyPlanFixture());

    // No selection: POINTTABLE falls back to every survey point in station order.
    await clearSelection(page);
    await createTable(page, 'POINTTABLE');

    const panel = await openSurveyTableManager(page);
    await expect(panel.locator('[data-cad-survey-table-kind]')).toHaveText('Point');
    await expect(panel.locator('[data-cad-survey-table-row]')).toHaveCount(3);
    expect(await tableRowCodes(page)).toEqual(['PT1', 'PT2', 'PT3']);

    const rows = panel.locator('[data-cad-survey-table-row]');
    await expect(rows.nth(0)).toContainText('50.000');
    await expect(rows.nth(0)).toContainText('IP');
    // td order: code, source, status, Code, Easting, Northing, Elevation, Description, actions.
    await expect(rows.nth(1).locator('td').nth(6)).toHaveText('—'); // P2 has no Z — never 0.
    await expect(rows.nth(2)).toContainText('55.000');
    await expect(rows.nth(2)).toContainText('MH');

    await closeSurveyTableManager(page);
    expect(errors).toEqual([]);
  });

  test('K+L: tag offset persists through save and reload with the table intact', async ({ page }) => {
    const errors: string[] = [];
    await gotoCad(page, errors);
    await openSurveyPlanDrawing(page, writeSurveyPlanFixture());

    await selectAll(page);
    await createTable(page, 'LINETABLE');

    const panel = await openSurveyTableManager(page);
    const firstRow = panel.locator('[data-cad-survey-table-row]').first();
    const rowId = await firstRow.getAttribute('data-cad-survey-table-row');
    expect(rowId).not.toBeNull();
    const dx = firstRow.locator('[data-cad-survey-table-row-tag-dx]');
    await dx.fill('4');
    await dx.blur();
    await closeSurveyTableManager(page);

    const saved = await saveDrawingText(page);
    const savedProject = JSON.parse(saved.text) as { project: { entities: CadSurveyTableEntity[] } };
    const savedTable = savedProject.project.entities.find((entity) => entity.type === 'survey-table');
    expect(savedTable).toBeDefined();
    expect(savedTable!.rows.find((row) => row.id === rowId)?.tagOffset).toEqual({ dx: 4, dy: 0 });

    // Reload the saved drawing through the real Open Drawing input, reselect
    // the restored entity, then reopen the manager.
    await openSurveyPlanDrawing(page, path.join(saved.dir, 'drawing.wncad'));
    await selectAll(page);
    const reopened = await openSurveyTableManager(page);
    await expect(reopened.locator('[data-cad-survey-table-row]')).toHaveCount(4);
    expect(await tableRowCodes(page)).toEqual(['L1', 'L2', 'L3', 'L4']);
    await expect(
      reopened.locator('[data-cad-survey-table-row]').first().locator('[data-cad-survey-table-row-tag-dx]'),
    ).toHaveValue('4');

    await closeSurveyTableManager(page);
    expect(errors).toEqual([]);
  });

  test('M: undo removes the table and redo restores it', async ({ page }) => {
    const errors: string[] = [];
    await gotoCad(page, errors);
    await openSurveyPlanDrawing(page, writeSurveyPlanFixture());
    const baseline = await entityCount(page);

    await selectAll(page);
    await createTable(page, 'LINETABLE');
    await expect.poll(() => entityCount(page)).toBe(baseline + 1);

    await homeTab(page);
    await page.locator('[data-cad-command="SHELL_UNDO"]').click();
    await expect.poll(() => entityCount(page)).toBe(baseline);
    await page.locator('[data-cad-command="SHELL_REDO"]').click();
    await expect.poll(() => entityCount(page)).toBe(baseline + 1);

    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Store-level flows — no direct /cad surface, or in-app target selection is
// not reliably drivable. Each test names its reason; none are faked passes.
// ---------------------------------------------------------------------------

test.describe('Phase 19A survey plan production (store-level flows)', () => {
  // Store-level: the row editor exposes no source-geometry edit and a table
  // pick leaves the table selected, so re-selecting one exact source line is
  // not reliably drivable. The engine command is the production seam.
  test('B: editing a line source updates the derived row without mutating the table', () => {
    const project = buildSurveyPlanProject();
    const history = runCadCommand(createCadHistoryState(project, [...LINE_IDS]), {
      key: 'LINETABLE',
      insertX: 0,
      insertY: 0,
      sourceEntityIds: [...LINE_IDS],
    });
    const table = findSurveyTable(history.present.project);
    expect(deriveCadSurveyTable(table, history.present.project).rows[0]!.cells).toContain('5.000');

    // Line 1 is (300,0)->(300,5); extend its end to (300,10).
    const edited = runCadCommand(history, {
      key: 'EDIT_ENTITY',
      entityId: 'line:1',
      edit: { kind: 'line-end', toX: 300, toY: 10 },
    });
    // Exactly one new undo entry: the source edit, no hidden table mutation.
    expect(edited.undoStack).toHaveLength(history.undoStack.length + 1);
    const editedTable = findSurveyTable(edited.present.project);
    expect(editedTable.rows).toEqual(table.rows);
    const derived = deriveCadSurveyTable(editedTable, edited.present.project);
    expect(derived.rows[0]!.cells).toContain('10.000');
    expect(derived.status).toBe('CURRENT');
  });

  // Store-level: selecting exactly one parcel through the refit viewport is
  // unreliable; the MOVE/ROTATE/SCALE commands are the production seam.
  test('E: parcel move/rotate/scale keep stable course ids and correct metrics', () => {
    const project = buildSurveyPlanProject();
    const parcel = parcelOf(project, PARCEL_IDS[0]);
    const originalIds = [...(parcel.courseIds ?? [])];

    // Create a parcel-course table, then transform the parcel with only the
    // parcel selected.
    const withTable = runCadCommand(createCadHistoryState(project, [PARCEL_IDS[0]]), {
      key: 'PARCELTABLE',
      insertX: 0,
      insertY: 0,
      sourceEntityIds: [PARCEL_IDS[0]],
    }).present.project;
    const table = findSurveyTable(withTable);
    const before = deriveCadSurveyTable(table, withTable);
    expect(before.status).toBe('CURRENT');

    const moved = runCadCommand(createCadHistoryState(withTable, [PARCEL_IDS[0]]), {
      key: 'MOVE',
      deltaX: 5,
      deltaY: 7,
    }).present.project;
    const movedParcel = parcelOf(moved, PARCEL_IDS[0]);
    expect(movedParcel.courseIds).toEqual(originalIds);
    const movedTable = deriveCadSurveyTable(findSurveyTable(moved), moved);
    expect(movedTable.rows.map((row) => row.cells)).toEqual(before.rows.map((row) => row.cells));

    const rotated = runCadCommand(createCadHistoryState(withTable, [PARCEL_IDS[0]]), {
      key: 'ROTATE',
      baseX: 0,
      baseY: 0,
      angleDeg: 90,
    }).present.project;
    const rotatedParcel = parcelOf(rotated, PARCEL_IDS[0]);
    expect(rotatedParcel.courseIds).toEqual(originalIds);
    const rotatedTable = deriveCadSurveyTable(findSurveyTable(rotated), rotated);
    // Rotation keeps stable ids; distances are unchanged (bearings rotate).
    expect(rotatedTable.rows.map((row) => row.cells[4])).toEqual(
      before.rows.map((row) => row.cells[4]),
    );

    const scaled = runCadCommand(createCadHistoryState(withTable, [PARCEL_IDS[0]]), {
      key: 'SCALE',
      baseX: 0,
      baseY: 0,
      factor: 2,
    }).present.project;
    const scaledParcel = parcelOf(scaled, PARCEL_IDS[0]);
    expect(scaledParcel.courseIds).toEqual(originalIds);
    expect(scaledParcel.areaSquareMeters).toBeCloseTo(4800, 3);
    const scaledTable = deriveCadSurveyTable(findSurveyTable(scaled), scaled);
    expect(scaledTable.rows[0]!.cells).toContain('80.000');
  });

  // Store-level: the shell has no parcel vertex-insert command yet.
  test('F: parcel course topology change retires the old course id into a visible broken row', () => {
    const project = buildSurveyPlanProject();
    const withTable = runCadCommand(createCadHistoryState(project, [PARCEL_IDS[0]]), {
      key: 'PARCELTABLE',
      insertX: 0,
      insertY: 0,
      sourceEntityIds: [PARCEL_IDS[0]],
    }).present.project;
    const table = findSurveyTable(withTable);
    expect(deriveCadSurveyTable(table, withTable).status).toBe('CURRENT');

    // Insert a vertex into course B->C (index 1): that course id retires.
    const parcel = parcelOf(withTable, PARCEL_IDS[0]);
    const retiredId = parcel.courseIds![1]!;
    const nextParcel = insertParcelCourseVertex({
      parcel,
      courseIndex: 1,
      point: { x: 20, y: -5 },
      label: 'B2',
    });
    expect(nextParcel).not.toBeNull();
    const topologyProject: CadProject = {
      ...withTable,
      entities: withTable.entities.map((entity) =>
        entity.id === nextParcel!.id ? nextParcel! : entity,
      ),
    };
    const derived = deriveCadSurveyTable(table, topologyProject);
    expect(derived.status).toBe('PARTIAL_BROKEN_REFERENCE');
    const brokenRow = derived.rows.find(
      (row) => row.source.kind === 'parcel-course' && row.source.courseId === retiredId,
    );
    expect(brokenRow).toBeDefined();
    expect(brokenRow!.status).toBe('missing');
    // No silent rebind: the retired id still points at nothing (em-dash cells).
    expect(brokenRow!.cells.slice(1)).toEqual(['—', '—', '—', '—']);
    expect(derived.rows.filter((row) => row.status === 'ok')).toHaveLength(3);
  });

  // Store-level: PARCELREPORT binds one parcel per table in the shell; the
  // multi-parcel TOTAL row lives in the source-driven export-table builder.
  test('G: multi-parcel summary totals are the arithmetic sum with unit parity', () => {
    const project = buildSurveyPlanProject();
    const parcels = PARCEL_IDS.map((id) => parcelOf(project, id));
    const table = deriveCadSurveyTableFromSource({ kind: 'parcel-summary', parcels }, project);
    expect(table.rows).toHaveLength(4); // three parcels + TOTAL
    expect(table.rows.slice(0, 3).map((row) => row.cells)).toEqual([
      ['LOT 1', '4', '1200.0', '140.000'],
      ['LOT 2', '4', '1200.0', '140.000'],
      ['LOT 3', '4', '1200.0', '140.000'],
    ]);
    expect(table.rows[3]!.cells).toEqual(['TOTAL', '12', '3600.0', '420.000']);
    const csv = formatCadSurveyTableCsv(table);
    expect(csv).toContain('TOTAL,12,3600.0,420.000');
  });

  // Store-level: the shell has no Survey Table Style manager editor surface.
  test('I: changing the table style leaves derived values and creates no source transaction', () => {
    const project = buildSurveyPlanProject();
    const history = runCadCommand(createCadHistoryState(project, [...LINE_IDS]), {
      key: 'LINETABLE',
      insertX: 0,
      insertY: 0,
      sourceEntityIds: [...LINE_IDS],
    });
    const table = findSurveyTable(history.present.project);
    const before = deriveCadSurveyTable(table, history.present.project);

    const styled = runCadCommand(history, {
      key: 'TABLESTYLE',
      action: 'update',
      styleId: table.tableStyleId,
      patch: { rowHeight: 5, cellPadding: 1.2 },
    });
    const after = deriveCadSurveyTable(findSurveyTable(styled.present.project), styled.present.project);
    expect(after.rows.map((row) => row.cells)).toEqual(before.rows.map((row) => row.cells));
    expect(after.metrics.rowHeightModel).toBeCloseTo(2.5, 6);
    expect(before.metrics.rowHeightModel).toBeCloseTo(1.25, 6);
  });

  // Store-level: the shell has no annotation-scale control yet.
  test('J: annotation scale changes paper table geometry but not reported values', () => {
    const project = buildSurveyPlanProject();
    const withTable = runCadCommand(createCadHistoryState(project, [...LINE_IDS]), {
      key: 'LINETABLE',
      insertX: 0,
      insertY: 0,
      sourceEntityIds: [...LINE_IDS],
    }).present.project;
    const table = findSurveyTable(withTable);
    const at500 = deriveCadSurveyTable(table, { ...withTable, annotationSettings: { scaleDenominator: 500 } });
    const at1000 = deriveCadSurveyTable(table, { ...withTable, annotationSettings: { scaleDenominator: 1000 } });
    expect(at500.rows.map((row) => row.cells)).toEqual(at1000.rows.map((row) => row.cells));
    expect(at1000.metrics.rowHeightModel).toBeCloseTo(at500.metrics.rowHeightModel * 2, 6);
    expect(at1000.metrics.tableWidth).toBeGreaterThan(at500.metrics.tableWidth);
  });

  // Store-level: the shell has no legal-description preview surface yet.
  test('N: straight-course parcel description matches the table and reverses correctly', () => {
    const project = buildSurveyPlanProject();
    const parcel = parcelOf(project, PARCEL_IDS[0]);
    const table = deriveCadSurveyTableFromSource({ kind: 'parcel-course', parcel }, project);

    const drafted = buildCadParcelLegalDescription(parcel);
    expect(drafted.ok).toBe(true);
    if (!drafted.ok) return;
    const { description } = drafted;
    expect(description.courses).toHaveLength(4);
    // Same authoritative bearing/distance strings as the parcel course table.
    expect(description.courses.map((course) => [course.bearing, course.distance])).toEqual(
      table.rows.map((row) => [row.cells[3], Number(row.cells[4])]),
    );
    expect(description.header).toBe('DRAFT — NOT FOR RECORDING');
    expect(description.footer).toBe('DRAFT — NOT FOR RECORDING');
    expect(description.areaText).toBe('1200.0 m²');
    expect(description.text).toContain('Thence');
    // No invented record/legal facts.
    for (const banned of ['deed', 'owner', 'PID', 'grantor', 'approved', 'province']) {
      expect(description.text.toLowerCase()).not.toContain(banned.toLowerCase());
    }

    const reversed = buildCadParcelLegalDescription(parcel, { reverse: true });
    expect(reversed.ok).toBe(true);
    if (!reversed.ok) return;
    expect(reversed.description.courses).toHaveLength(4);
    expect(reversed.description.courses[0]!.fromLabel).toBe('A');
    expect(reversed.description.courses[0]!.bearing).toBe('N00-00-00.00E');
    expect(reversed.description.courses[0]!.distance).toBe(30);
  });

  // Store-level: the Export Center wires no sheets/surveyTables args yet, so
  // the disposition is asserted on the same renderer/serializer seams that
  // SVG/PDF and the DXF bridge use.
  test('O: SVG/PDF scene renders the table as geometry; DXF is an explicit approximation', () => {
    const project = buildSurveyPlanProject();
    const withTable = runCadCommand(createCadHistoryState(project, [...LINE_IDS]), {
      key: 'LINETABLE',
      insertX: 0,
      insertY: 0,
      sourceEntityIds: [...LINE_IDS],
    }).present.project;
    const table = findSurveyTable(withTable);

    // Canonical scene (shared by SVG/PDF exports) renders the persisted table
    // entity natively as grid + text primitives — a FULL disposition.
    const scene = buildCadDisplayScene(withTable);
    const tablePrimitives = scene.primitives.filter((primitive) => primitive.sourceEntityId === table.id);
    expect(tablePrimitives.some((primitive) => primitive.kind === 'line')).toBe(true);
    const textValues = tablePrimitives
      .filter((primitive): primitive is Extract<typeof primitive, { kind: 'text' }> => primitive.kind === 'text')
      .map((primitive) => primitive.text);
    expect(textValues).toContain('N00-00-00.00E');
    expect(textValues).toContain('5.000');
    expect(textValues).toContain('L1');

    // DXF has no native table entity; the export bridge emits derived
    // LINE/LWPOLYLINE/TEXT items and reports the explicit disposition.
    const sourceTable = deriveCadSurveyTableFromSource(
      {
        kind: 'line',
        legs: [
          { lineId: 'L1', fromId: 'A', toId: 'B', from: { x: 0, y: 0 }, to: { x: 3, y: 4 } },
        ],
      },
      withTable,
    );
    const dxfItems = buildCadSurveyTableDxfItems([sourceTable]);
    expect(dxfItems.polylines.length).toBeGreaterThan(0);
    expect(dxfItems.texts.map((entry) => entry.text)).toContain('N36-52-11.63E');
    expect(CAD_SURVEY_TABLE_DXF_DISPOSITION).toContain('approximated');
  });
});
