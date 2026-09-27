// Phase 20A — Toolspace feature-line snapshot builder.
import { describe, expect, it } from 'vitest';

import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { appendCadProjectEntities } from '../src/engine/cad/cadProjectState';
import { buildCadFeatureLineSnapshot } from '../src/cad-app/shell/cadFeatureLineSnapshot';
import { executeCadCommand } from '../src/engine/cad/cadTransactions';
import type {
  CadCommand,
  CadWorkspaceSnapshot,
} from '../src/engine/cad/cadTransactions.types';
import type { CadFeatureLineEntity, CadSurveyPointEntity } from '../src/engine/cad/cadTypes';

const point = (id: string, x: number, y: number, z: number): CadSurveyPointEntity => ({
  id,
  type: 'survey-point',
  layerId: 'points',
  visible: true,
  locked: false,
  stationId: id,
  x,
  y,
  z,
  pointClass: 'free',
  source: 'parsed-input',
});

const featureLine = (): CadFeatureLineEntity => ({
  id: 'fl-snap',
  type: 'feature-line',
  layerId: 'general',
  visible: true,
  locked: false,
  name: 'Feature Line 1',
  vertices: [
    { id: 'fl-snap-v0', x: 0, y: 0, z: 10 },
    { id: 'fl-snap-v1', x: 50, y: 0, z: 11 },
    { id: 'fl-snap-v2', x: 100, y: 0, z: 12 },
  ],
});

describe('phase 20A feature-line Toolspace snapshot', () => {
  it('derives verts/courses/plan/3D/min-max Z and selection', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Snap', units: 'm' });
    const project = appendCadProjectEntities(drawing.project, [featureLine()]);
    const snapshot = buildCadFeatureLineSnapshot(project, ['fl-snap'])!;
    expect(snapshot.featureLines).toHaveLength(1);
    const entry = snapshot.featureLines[0]!;
    expect(entry.name).toBe('Feature Line 1');
    expect(entry.vertexCount).toBe(3);
    expect(entry.courseCount).toBe(2);
    expect(entry.planLength).toBeCloseTo(100, 9);
    expect(entry.minZ).toBe(10);
    expect(entry.maxZ).toBe(12);
    expect(entry.surfaceUses).toEqual([]);
    expect(entry.courses.map((course) => course.index)).toEqual([0, 1]);
    expect(snapshot.selectedFeatureLine?.id).toBe('fl-snap');
  });

  it('reports surface uses from entity breaklines and hides when empty', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Snap2', units: 'm' });
    const base = appendCadProjectEntities(drawing.project, [
      point('pt-1', 0, 0, 0),
      point('pt-2', 10, 0, 1),
      point('pt-3', 10, 10, 2),
      point('pt-4', 0, 10, 1),
      featureLine(),
    ]);
    const snapshot = { project: base, selection: { selectedEntityIds: [] } } as unknown as CadWorkspaceSnapshot;
    const created = executeCadCommand(snapshot, {
      key: 'SURFACE_CREATE',
      name: 'Site',
      pointSource: { kind: 'points', pointEntityIds: ['pt-1', 'pt-2', 'pt-3', 'pt-4'] },
    } as CadCommand)!;
    const surfaceId = created.nextSnapshot.project.surfaces![0]!.id;
    const added = executeCadCommand(created.nextSnapshot, {
      key: 'SURFACE_ADD_FEATURE_LINE_BREAKLINE',
      surfaceId,
      entityId: 'fl-snap',
    } as CadCommand)!;
    const after = buildCadFeatureLineSnapshot(added.nextSnapshot.project, [])!;
    expect(after.featureLines[0]!.surfaceUses).toEqual(['Site']);

    const empty = buildCadFeatureLineSnapshot(
      createBlankCadDrawingDocument({ name: 'Empty', units: 'm' }).project,
      [],
    );
    expect(empty).toBeNull();
  });
});
