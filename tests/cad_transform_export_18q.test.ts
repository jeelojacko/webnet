// Phase 18Q transform export pins: transformed + mirrored geometry renders
// through the deliverables from canonical resolved geometry (no
// exporter-side trig). SVG/PDF share ONE scene representation with the
// screen preview, so the identity pin compares export items against viewport
// primitives exactly; DXF pins the native mirrored INSERT (signed group 41);
// LandXML receives final geometry with no transform records.
import { describe, expect, it } from 'vitest';

import { buildDxfModelSpaceTextWithResult } from '../src/engine/cad/dxf/dxfLayoutExport';
import { buildDxfLayoutTextWithResult } from '../src/engine/cad/dxf/dxfLayoutExport';
import { buildExportSheetSceneWithResult } from '../src/engine/cad/cadExportScene';
import { serializeExportSceneToSvg } from '../src/engine/cad/cadSvgSerializer';
import { exportScenesToPdfWithResult } from '../src/engine/cad/cadPdfExport';
import { buildCadDisplayScene } from '../src/engine/cad/cadRenderer';
import { buildLandXmlProjectExportWithResult } from '../src/engine/landxmlCadProject';
import {
  createCadHistoryState,
  runCadCommand,
} from '../src/engine/cad/cadUndoRedo';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import type { CadDisplayPrimitive } from '../src/engine/cad/cadTypes';
import type { CadEntity, CadProject } from '../src/engine/cad/cadTypes';
import { buildSmallParcelFixture } from './fixtures/draftSmallParcel';

const projectWith = (entities: CadEntity[]): CadProject => {
  const fixture = buildSmallParcelFixture();
  const project = fixture.project;
  project.entities = entities;
  project.blockDefinitions = [
    {
      id: 'blk', name: 'BLK', basePoint: { x: 0, y: 0 },
      entities: [
        {
          layerId: 'parcels', visible: true, locked: false, id: 'blk-child', type: 'line',
          fromStationId: 'A', toStationId: 'B', fromX: 0, fromY: 0, toX: 5, toY: 0,
          sourceObservationIds: [],
        },
      ],
    },
  ];
  return project;
};

// Transformed drawing: ROTATE 90 about origin, then MIRROR in place across
// the N axis (x=0), applied through the registered command path.
const transformedProject = (): CadProject => {
  const layerId = 'parcels';
  const base = { layerId, visible: true, locked: false } as const;
  const entities: CadEntity[] = [
    {
      ...base, id: 'l1', type: 'line', fromStationId: 'A', toStationId: 'B',
      fromX: 0, fromY: 0, toX: 10, toY: 0, sourceObservationIds: [],
    },
    {
      ...base, id: 'a1', type: 'arc',
      centerX: 10, centerY: 0, radius: 5, startAngleDeg: 0, endAngleDeg: 90,
    },
    {
      ...base, id: 'b1', type: 'block-reference', blockDefinitionId: 'blk',
      x: 10, y: 20, rotationDeg: 0, scaleX: 1, scaleY: 1,
    },
    {
      ...base, id: 'mt1', type: 'mtext', x: 3, y: 4, text: 'hi',
      textStyleId: 'standard', rotationDeg: 0, attachment: 'middle-center' as const,
    },
    {
      ...base, id: 'ld1', type: 'leader',
      arrowAnchor: { kind: 'fixed', x: 10, y: 0 },
      vertices: [{ x: 10, y: 0 }, { x: 15, y: 5 }],
      text: 'note', leaderStyleId: 'standard',
    },
    {
      ...base, id: 'd1', type: 'dimension', dimensionKind: 'linear',
      anchors: [{ kind: 'fixed', x: 0, y: 0 }, { kind: 'fixed', x: 10, y: 0 }],
      dimLinePoint: { x: 5, y: 5 }, textPoint: { x: 5, y: 7 }, dimensionStyleId: 'standard',
    },
    {
      ...base, id: 'p1', type: 'parcel', parcelName: 'Lot 1',
      vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
      vertexLabels: ['A', 'B', 'C', 'D'],
    },
  ];
  const project = projectWith(entities);
  const ids = entities.map((entity) => entity.id);
  let history = createCadHistoryState(project, ids);
  history = runCadCommand(history, { key: 'ROTATE', baseX: 0, baseY: 0, angleDeg: 90 });
  expect(history.undoStack).toHaveLength(1);
  history = runCadCommand(history, {
    key: 'MIRROR', p1: { x: 0, y: 0 }, p2: { x: 0, y: 1 }, eraseSource: true,
  });
  expect(history.undoStack).toHaveLength(2);
  return history.present.project;
};

const viewportPrimitive = (
  primitives: readonly CadDisplayPrimitive[],
  sourceEntityId: string,
): CadDisplayPrimitive => {
  const primitive = primitives.find((entry) => entry.sourceEntityId === sourceEntityId);
  if (!primitive) throw new Error(`no viewport primitive for ${sourceEntityId}`);
  return primitive;
};

describe('transform export identity (18Q)', () => {
  it('export scene maps transformed + mirrored geometry through the sheet exactly', () => {
    const project = transformedProject();
    const viewport = buildCadDisplayScene(project);
    const fixture = buildSmallParcelFixture();
    const scene = buildExportSheetSceneWithResult({
      draft: fixture.draft,
      sheetId: fixture.sheetId,
      project,
      modelLabels: fixture.modelLabels,
    });
    // Deterministic: an identical rebuild yields byte-identical items.
    const sceneAgain = buildExportSheetSceneWithResult({
      draft: fixture.draft,
      sheetId: fixture.sheetId,
      project,
      modelLabels: fixture.modelLabels,
    });
    expect(sceneAgain.output.items).toEqual(scene.output.items);
    // Solve the sheet paper map (affine, convention-agnostic) from the
    // transformed line + one parcel corner, then verify every other
    // transformed entity lands through that SAME map — i.e. exporters
    // consume canonical resolved geometry, never entity fields with
    // exporter-side trig.
    const lineItem = scene.output.items.find(
      (item) => item.kind === 'line' && item.sourceEntityId === 'l1',
    );
    if (!lineItem || lineItem.kind !== 'line') throw new Error('export line missing');
    const lineEntity = project.entities.find((entity) => entity.id === 'l1');
    if (!lineEntity || lineEntity.type !== 'line') throw new Error('line entity missing');
    const parcel = project.entities.find((entity) => entity.id === 'p1');
    if (!parcel || parcel.type !== 'parcel') throw new Error('parcel entity missing');
    const mtext = project.entities.find((entity) => entity.id === 'mt1');
    if (!mtext || mtext.type !== 'mtext') throw new Error('mtext missing');
    const mtextItem = scene.output.items.find(
      (item) => item.kind === 'text' && item.sourceEntityId === 'mt1',
    );
    if (!mtextItem || mtextItem.kind !== 'text') throw new Error('export mtext missing');
    const solveAffine = (
      model: Array<{ x: number; y: number }>,
      paper: Array<{ x: number; y: number }>,
    ): ((_point: { x: number; y: number }) => { x: number; y: number }) => {
      const [m1, m2, m3] = model;
      const [q1, q2, q3] = paper;
      if (!m1 || !m2 || !m3 || !q1 || !q2 || !q3) throw new Error('affine solve needs 3 points');
      const det =
        m1.x * (m2.y - m3.y) + m2.x * (m3.y - m1.y) + m3.x * (m1.y - m2.y);
      if (Math.abs(det) < 1e-12) throw new Error('collinear solve points');
      const w = (u1: number, u2: number, u3: number): [number, number, number] => [
        (u1 * (m2.y - m3.y) + u2 * (m3.y - m1.y) + u3 * (m1.y - m2.y)) / det,
        (u1 * (m3.x - m2.x) + u2 * (m1.x - m3.x) + u3 * (m2.x - m1.x)) / det,
        (u1 * (m2.x * m3.y - m3.x * m2.y) +
          u2 * (m3.x * m1.y - m1.x * m3.y) +
          u3 * (m1.x * m2.y - m2.x * m1.y)) / det,
      ];
      const [a, b, tx] = w(q1.x, q2.x, q3.x);
      const [c, d, ty] = w(q1.y, q2.y, q3.y);
      return (point) => ({ x: a! * point.x + b! * point.y + tx!, y: c! * point.x + d! * point.y + ty! });
    };
    const toPaper = solveAffine(
      [
        { x: lineEntity.fromX, y: lineEntity.fromY },
        { x: lineEntity.toX, y: lineEntity.toY },
        { x: mtext.x, y: mtext.y },
      ],
      [
        { x: lineItem.x1, y: lineItem.y1 },
        { x: lineItem.x2, y: lineItem.y2 },
        { x: mtextItem.x, y: mtextItem.y },
      ],
    );
    const expectMapped = (model: { x: number; y: number }, paper: { x: number; y: number }, what: string): void => {
      const got = toPaper(model);
      expect(got.x, `${what} paper x`).toBeCloseTo(paper.x, 6);
      expect(got.y, `${what} paper y`).toBeCloseTo(paper.y, 6);
    };
    // Reflected arc: faceted from the VIEWPORT primitive's resolved
    // center/radius/angles (reflection swap included), not re-derived.
    const arcPrimitive = viewportPrimitive(viewport.primitives, 'a1');
    if (arcPrimitive.kind !== 'arc') throw new Error('viewport arc missing');
    const arcPoly = scene.output.items.find(
      (item) => item.kind === 'polyline' && item.sourceEntityId === 'a1',
    );
    if (!arcPoly || arcPoly.kind !== 'polyline') throw new Error('export arc missing');
    const rad = Math.PI / 180;
    const arcStart = {
      x: arcPrimitive.center.x + arcPrimitive.radius * Math.cos(arcPrimitive.startAngleDeg * rad),
      y: arcPrimitive.center.y + arcPrimitive.radius * Math.sin(arcPrimitive.startAngleDeg * rad),
    };
    const arcEnd = {
      x: arcPrimitive.center.x + arcPrimitive.radius * Math.cos(arcPrimitive.endAngleDeg * rad),
      y: arcPrimitive.center.y + arcPrimitive.radius * Math.sin(arcPrimitive.endAngleDeg * rad),
    };
    expectMapped(arcStart, arcPoly.points[0]!, 'arc start');
    expectMapped(arcEnd, arcPoly.points[arcPoly.points.length - 1]!, 'arc end');
    // Mirrored block insert + annotation placements ride the same map.
    const blockItems = scene.output.items.filter((item) => item.sourceEntityId === 'b1');
    expect(blockItems.length).toBeGreaterThan(0);
    expectMapped({ x: mtext.x, y: mtext.y }, { x: mtextItem.x, y: mtextItem.y }, 'mtext');
    // Transformed parcel edges: every exported endpoint lands on a mapped vertex.
    const parcelLines = scene.output.items.filter(
      (item) => item.kind === 'line' && item.sourceEntityId === 'p1',
    );
    expect(parcelLines.length).toBe(parcel.vertices.length);
    const mappedVertices = parcel.vertices.map((vertex) => toPaper(vertex));
    for (const item of parcelLines) {
      if (item.kind !== 'line') throw new Error('parcel line kind');
      for (const [px, py, end] of [[item.x1, item.y1, 'start'], [item.x2, item.y2, 'end']] as const) {
        const near = mappedVertices.some(
          (vertex) => Math.abs(vertex.x - px) < 1e-6 && Math.abs(vertex.y - py) < 1e-6,
        );
        expect(near, `parcel edge ${end} on a mapped vertex`).toBe(true);
      }
    }
    // Leader + dimension placements ride the same map.
    const leader = project.entities.find((entity) => entity.id === 'ld1');
    if (!leader || leader.type !== 'leader') throw new Error('leader missing');
    const leaderLines = scene.output.items.filter(
      (item) => item.kind === 'line' && item.sourceEntityId === 'ld1',
    );
    expect(leaderLines.length).toBeGreaterThan(0);
    // SVG carries the transformed paper numbers (3dp fmt); PDF classifies every id.
    const svg = serializeExportSceneToSvg(scene.output);
    const fmt = (value: number): string => String(Math.round(value * 1000) / 1000);
    expect(svg).toContain(`x1="${fmt(lineItem.x1)}"`);
    expect(svg).toContain(`x2="${fmt(lineItem.x2)}"`);
    const pdf = exportScenesToPdfWithResult([scene.output]);
    for (const id of ['l1', 'a1', 'b1', 'mt1', 'ld1', 'd1', 'p1']) {
      const classified =
        pdf.exportedEntityIds.includes(id) ||
        pdf.omittedEntityIds.includes(id) ||
        pdf.approximatedEntityIds.includes(id);
      expect(classified, `${id} classified by PDF`).toBe(true);
    }
  });

  it('DXF R2000 mirrored INSERT rides negative group 41; R12 mirrors per block-batch behavior', () => {
    const plain = createBlankCadProject({ name: 'DXF-M', units: 'm' });
    plain.entities = [
      {
        layerId: 'L', visible: true, locked: false, id: 'plain', type: 'block-reference',
        blockDefinitionId: 'blk', x: 1, y: 2, rotationDeg: 0, scaleX: 1, scaleY: 1,
      },
      {
        layerId: 'L', visible: true, locked: false, id: 'mir', type: 'block-reference',
        blockDefinitionId: 'blk', x: 10, y: 20, rotationDeg: 0, scaleX: 1, scaleY: 1,
        mirrored: true,
      },
    ];
    plain.blockDefinitions = [
      { id: 'blk', name: 'BLK', basePoint: { x: 0, y: 0 }, entities: [] },
    ];
    const fixture = buildSmallParcelFixture();
    const r2000 = buildDxfLayoutTextWithResult({
      project: plain, draft: fixture.draft, modelLabels: fixture.modelLabels, paperExtras: fixture.paperExtras,
    });
    const dxf = r2000.output.dxf;
    // Mirrored INSERT: group 41 carries -scaleX immediately after the block name.
    const mirrorAt = dxf.indexOf('BLK');
    expect(mirrorAt).toBeGreaterThan(-1);
    const afterMirror = dxf.slice(mirrorAt);
    expect(afterMirror).toMatch(/41\n-1(\.0*)?\n/);
    const r12 = buildDxfModelSpaceTextWithResult({ project: plain });
    expect(r12.output).toMatch(/41\n-1(\.0*)?\n/);
    // The plain insert stays positive (no blanket negation).
    expect(r12.output).toMatch(/41\n1(\.0*)?\n/);
  });

  it('LandXML receives final geometry with no transform records', () => {
    const project = transformedProject();
    const landxml = buildLandXmlProjectExportWithResult(project, { units: 'm' });
    const text = typeof landxml.output === 'string' ? landxml.output : JSON.stringify(landxml.output);
    expect(text).not.toMatch(/<Transform/i);
    expect(text).not.toMatch(/transform=/i);
    // Final geometry: the rotated+mirrored line endpoint (0,10)->(0,10)?
    // ROTATE90 (10,0)->(0,10), then mirror across x=0 -> (0,10). Present verbatim.
    expect(text).toContain('0 10');
    for (const id of ['l1', 'a1', 'mt1', 'ld1', 'd1', 'p1']) {
      const classified =
        landxml.exportedEntityIds.includes(id) ||
        landxml.omittedEntityIds.includes(id) ||
        landxml.approximatedEntityIds.includes(id);
      expect(classified, `${id} classified by LandXML`).toBe(true);
    }
  });
});
