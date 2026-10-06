// Shapes V1 transactions: RECTANGLE/POLYGON engine commits, history,
// transforms, persistence, DXF, clipboard, snaps, grips, and neighbor gates.
import { describe, expect, it } from 'vitest';

import { CAD_RIBBON_TOOL_FAMILIES } from '../src/cad-app/shell/cadRibbonToolFamilies';
import {
  createBlankCadDrawingDocument,
  createBlankCadProject,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { buildDxfExportModelWithResult } from '../src/engine/cad/dxf/dxfExportModel';
import { serializeDxfModel } from '../src/engine/cad/dxf/dxfSerializer';
import { buildRectangleVertices } from '../src/engine/cad/cadGeometryShapeBuilders';
import { resolveCurrentCadLayerId } from '../src/engine/cad/cadLayers';
import { buildCopiedEntities } from '../src/engine/cad/cadTransactionsClipboardCommands';
import { entitySegments } from '../src/engine/cad/cadSpatialEntityRefs';
import { buildCadSpatialEntitySnapCandidates } from '../src/engine/cad/cadSpatialEntityCandidates';
import { buildCadGripHandles } from '../src/engine/cad/cadTransactionsEntityTransforms';
import { executeCadCommand, CAD_COMMAND_REGISTRY } from '../src/engine/cad/cadTransactions';
import type { CadCommand } from '../src/engine/cad/cadTransactions.types';
import type { CadPolygonEntity, CadProject } from '../src/engine/cad/cadTypes';
import {
  createCadHistoryState,
  redoCadHistory,
  runCadCommand,
  undoCadHistory,
} from '../src/engine/cad/cadUndoRedo';

const blankProject = (): CadProject => createBlankCadProject({ name: 'shapes v1', units: 'm' });

const snapshotOf = (project: CadProject) => createCadHistoryState(project).present;

const rectCommand = (extra?: Partial<Extract<CadCommand, { key: 'RECTANGLE' }>>): CadCommand => ({
  key: 'RECTANGLE',
  firstCorner: { x: 1, y: 2, label: 'P1' },
  oppositeCorner: { x: 5, y: 7, label: 'P2' },
  ...extra,
});

const polyCommand = (extra?: Partial<Extract<CadCommand, { key: 'POLYGON' }>>): CadCommand => ({
  key: 'POLYGON',
  center: { x: 0, y: 0, label: 'C' },
  through: { x: 2, y: 0, label: 'R' },
  sides: 4,
  mode: 'inscribed',
  ...extra,
});

const commitRect = (project: CadProject) => executeCadCommand(snapshotOf(project), rectCommand());
const commitPoly = (project: CadProject, extra?: Partial<Extract<CadCommand, { key: 'POLYGON' }>>) =>
  executeCadCommand(snapshotOf(project), polyCommand(extra));

const onlyPolygon = (project: CadProject): CadPolygonEntity => {
  const found = project.entities.filter((entity) => entity.type === 'polygon');
  expect(found).toHaveLength(1);
  return found[0] as CadPolygonEntity;
};

const signedArea = (vertices: ReadonlyArray<{ x: number; y: number }>): number => {
  let sum = 0;
  for (let i = 0; i < vertices.length; i += 1) {
    const current = vertices[i]!;
    const next = vertices[(i + 1) % vertices.length]!;
    sum += current.x * next.y - next.x * current.y;
  }
  return sum / 2;
};

describe('shape commits', () => {
  it('RECTANGLE commits a closed CCW polygon with metadata, layer inheritance, and selection', () => {
    const project = blankProject();
    const result = commitRect(project);
    expect(result).not.toBeNull();
    const entity = onlyPolygon(result!.nextSnapshot.project);
    expect(entity.vertices).toEqual([
      { x: 1, y: 2 },
      { x: 5, y: 2 },
      { x: 5, y: 7 },
      { x: 1, y: 7 },
    ]);
    // Implicit ring: no duplicated closure vertex.
    expect(entity.vertices[0]).not.toEqual(entity.vertices[entity.vertices.length - 1]);
    expect(signedArea(entity.vertices)).toBeGreaterThan(0);
    expect(entity.metadata?.createdBy).toBe('RECTANGLE');
    expect(entity.metadata?.entityName).toMatch(/^RECT/);
    expect(entity.layerId).toBe(resolveCurrentCadLayerId(project));
    expect('styleId' in entity).toBe(false);
    expect(result!.nextSnapshot.selection.selectedEntityIds).toEqual([entity.id]);
  });

  it('POLYGON commits exact inscribed geometry with metadata and no appearance override', () => {
    const result = commitPoly(blankProject());
    expect(result).not.toBeNull();
    const entity = onlyPolygon(result!.nextSnapshot.project);
    expect(entity.vertices).toHaveLength(4);
    expect(entity.vertices[0]).toEqual({ x: 2, y: 0 });
    expect(entity.vertices[1]!.x).toBeCloseTo(0, 9);
    expect(entity.vertices[1]!.y).toBeCloseTo(2, 9);
    expect(signedArea(entity.vertices)).toBeGreaterThan(0);
    expect(entity.metadata?.createdBy).toBe('POLYGON');
    expect(entity.metadata?.entityName).toMatch(/^POLY/);
    expect('styleId' in entity).toBe(false);
  });

  it('invalid shapes return null and leave history untouched', () => {
    const project = blankProject();
    const history = createCadHistoryState(project);
    const degenerate: CadCommand[] = [
      rectCommand({ oppositeCorner: { x: 1, y: 7, label: 'P2' } }),
      polyCommand({ through: { x: 0, y: 0, label: 'R' } }),
      polyCommand({ sides: 2 }),
      polyCommand({ sides: 1025 }),
      polyCommand({ sides: 4.5 }),
    ];
    for (const command of degenerate) {
      expect(executeCadCommand(history.present, command)).toBeNull();
      expect(runCadCommand(history, command)).toBe(history);
    }
    expect(history.present.project.entities).toHaveLength(0);
  });
});

describe('shape history', () => {
  it('one undo removes the entity and restores selection; redo restores metadata', () => {
    const history = runCadCommand(createCadHistoryState(blankProject()), rectCommand());
    const entity = onlyPolygon(history.present.project);
    expect(history.undoStack).toHaveLength(1);
    const undone = undoCadHistory(history);
    expect(undone.present.project.entities).toHaveLength(0);
    expect(undone.present.selection.selectedEntityIds).toEqual([]);
    const redone = redoCadHistory(undone);
    const restored = onlyPolygon(redone.present.project);
    expect(restored.vertices).toEqual(entity.vertices);
    expect(restored.metadata).toEqual(entity.metadata);
    expect(redone.present.selection.selectedEntityIds).toEqual([entity.id]);
  });
});

describe('shape transforms', () => {
  it('MOVE/COPY/ROTATE keep a generic polygon; rotation breaks axis alignment', () => {
    const committed = commitRect(blankProject())!.nextSnapshot;
    const moved = executeCadCommand(committed, { key: 'MOVE', deltaX: 10, deltaY: -3 });
    const movedEntity = onlyPolygon(moved!.nextSnapshot.project);
    expect(movedEntity.type).toBe('polygon');
    expect(movedEntity.vertices[0]).toEqual({ x: 11, y: -1 });

    const copied = executeCadCommand(committed, { key: 'COPY', deltaX: 10, deltaY: 0 });
    const polygons = copied!.nextSnapshot.project.entities.filter((entry) => entry.type === 'polygon');
    expect(polygons).toHaveLength(2);

    const rotated = executeCadCommand(committed, { key: 'ROTATE', baseX: 0, baseY: 0, angleDeg: 45 });
    const rotatedEntity = onlyPolygon(rotated!.nextSnapshot.project);
    expect(rotatedEntity.type).toBe('polygon');
    expect(rotatedEntity.vertices).toHaveLength(4);
    for (let i = 0; i < rotatedEntity.vertices.length; i += 1) {
      const from = rotatedEntity.vertices[i]!;
      const to = rotatedEntity.vertices[(i + 1) % rotatedEntity.vertices.length]!;
      expect(Math.abs(to.x - from.x)).toBeGreaterThan(1e-9);
      expect(Math.abs(to.y - from.y)).toBeGreaterThan(1e-9);
    }
  });
});

describe('shape persistence and exchange', () => {
  it('save/reload round-trips winding and vertices', () => {
    const committed = commitRect(blankProject())!.nextSnapshot.project;
    const before = onlyPolygon(committed);
    const document = createBlankCadDrawingDocument({ name: 'shapes', units: 'm' });
    document.project = committed;
    const parsed = parseCadDrawingFile(serializeCadDrawingFile(document));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const after = onlyPolygon(parsed.drawing.project);
    expect(after.vertices).toEqual(before.vertices);
    expect(Math.sign(signedArea(after.vertices))).toBe(Math.sign(signedArea(before.vertices)));
    expect(after.metadata?.createdBy).toBe('RECTANGLE');
  });

  it('DXF exports a closed LWPOLYLINE with flag 70=1', () => {
    const committed = commitRect(blankProject())!.nextSnapshot.project;
    const entity = onlyPolygon(committed);
    const model = buildDxfExportModelWithResult({ project: committed }).output;
    const entry = model.polylines.find((polyline) => polyline.vertices.length === entity.vertices.length);
    expect(entry?.closed).toBe(true);
    expect((entry as { colorHex?: string } | undefined)?.colorHex ?? null).toBeNull();
    const pairs = serializeDxfModel(model).split('\n');
    let sawClosed = false;
    for (let i = 0; i + 3 < pairs.length; i += 2) {
      if (pairs[i] === '0' && pairs[i + 1] === 'LWPOLYLINE') {
        const block = pairs.slice(i, i + 40);
        for (let j = 0; j + 1 < block.length; j += 2) {
          if (block[j] === '70' && block[j + 1] === '1') sawClosed = true;
        }
      }
    }
    expect(sawClosed).toBe(true);
  });

  it('clipboard copies exact geometry offset by the delta', () => {
    const committed = commitRect(blankProject())!.nextSnapshot.project;
    const entity = onlyPolygon(committed);
    const copied = buildCopiedEntities(committed, [entity], 3, -2);
    expect(copied).toHaveLength(1);
    const copy = copied[0] as CadPolygonEntity;
    expect(copy.type).toBe('polygon');
    expect(copy.vertices).toEqual(entity.vertices.map((vertex) => ({ x: vertex.x + 3, y: vertex.y - 2 })));
  });
});

describe('shape predicates', () => {
  it('snaps cover the closing edge with endpoint and midpoint candidates', () => {
    const committed = commitRect(blankProject())!.nextSnapshot.project;
    const entity = onlyPolygon(committed);
    const segments = entitySegments(entity);
    expect(segments).toHaveLength(4);
    const closing = segments[3]!;
    expect(closing.start).toEqual({ x: 1, y: 7 });
    expect(closing.end).toEqual({ x: 1, y: 2 });
    const candidates = buildCadSpatialEntitySnapCandidates({
      project: committed,
      visibleEntities: [entity],
      segments,
      worldPoint: { x: 1, y: 4.5 },
      allowed: new Set(['endpoint', 'midpoint']),
      constructionContext: { active: false, basePoint: null },
      basePoint: null,
      hasPerpendicularStartSeed: false,
      parallelScope: null,
      extensionScope: null,
      requireExplicitScope: false,
    });
    const closingCandidates = candidates.filter((candidate) => candidate.sourceSegmentId === closing.segmentId);
    expect(closingCandidates.some((candidate) => candidate.kind === 'endpoint')).toBe(true);
    expect(closingCandidates.some((candidate) => candidate.kind === 'midpoint')).toBe(true);
  });

  it('grip corners sit on every ring vertex', () => {
    const committed = commitRect(blankProject())!.nextSnapshot.project;
    const entity = onlyPolygon(committed);
    const grips = buildCadGripHandles(entity);
    expect(grips).toHaveLength(4);
    grips.forEach((grip, index) => {
      expect(grip.kind).toBe('vertex');
      expect({ x: grip.x, y: grip.y }).toEqual(entity.vertices[index]);
    });
  });

  it('N=1024 commits without pathology', () => {
    const result = commitPoly(blankProject(), {
      through: { x: 1, y: 0, label: 'R' },
      sides: 1024,
      mode: 'inscribed',
    });
    expect(onlyPolygon(result!.nextSnapshot.project).vertices).toHaveLength(1024);
  });

  it('BestFit/Ellipse/Hatch stay planned with no engine command; Circle is live', () => {
    for (const family of ['bestfit', 'ellipse', 'hatch']) {
      const found = CAD_RIBBON_TOOL_FAMILIES.find((entry) => entry.id === family);
      expect(found).toBeDefined();
      expect(found!.variants.length).toBeGreaterThan(0);
      expect(found!.variants.every((variant) => variant.planned === true)).toBe(true);
    }
    for (const key of ['BESTFIT', 'ELLIPSE', 'HATCH']) {
      expect(Object.hasOwn(CAD_COMMAND_REGISTRY, key)).toBe(false);
    }
    for (const key of ['CIRCLE', 'CIRCLECD']) {
      expect(Object.hasOwn(CAD_COMMAND_REGISTRY, key)).toBe(true);
    }
    const shapes = CAD_RIBBON_TOOL_FAMILIES.find((entry) => entry.id === 'shapes')!;
    expect(shapes.variants.map((variant) => variant.commandKey)).toEqual(['RECTANGLE', 'POLYGON']);
  });

  it('Line/Polyline/Arc neighbors are unaffected', () => {
    expect(Object.hasOwn(CAD_COMMAND_REGISTRY, 'LINE')).toBe(true);
    expect(Object.hasOwn(CAD_COMMAND_REGISTRY, 'PLINE')).toBe(true);
    expect(Object.hasOwn(CAD_COMMAND_REGISTRY, 'ARC_3PT')).toBe(true);
    const line = executeCadCommand(snapshotOf(blankProject()), {
      key: 'LINE',
      start: { x: 0, y: 0, label: 'A' },
      end: { x: 10, y: 0, label: 'B' },
    });
    expect(line!.nextSnapshot.project.entities.some((entity) => entity.type === 'line')).toBe(true);
    const pline = executeCadCommand(snapshotOf(blankProject()), {
      key: 'PLINE',
      vertices: [
        { x: 1, y: 2, label: 'P1' },
        { x: 5, y: 2, label: 'P2' },
        { x: 5, y: 7, label: 'P3' },
        { x: 1, y: 7, label: 'P4' },
      ],
    });
    const open = pline!.nextSnapshot.project.entities.find((entity) => entity.type === 'polyline');
    expect(open).toBeDefined();
    expect(buildRectangleVertices({ x: 1, y: 2 }, { x: 5, y: 7 })).toEqual([
      { x: 1, y: 2 },
      { x: 5, y: 2 },
      { x: 5, y: 7 },
      { x: 1, y: 7 },
    ]);
  });
});
