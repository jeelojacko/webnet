// Phase 13E §52 — rerun-sync delta/topology path regression guard.
//
// applyAdjustmentRerunToLinkedF2f used to scan entities per station
// (O(stations x entities)) and stationIds per result station (O(stations^2)).
// This pins the behavior of the indexed replacements on a mid-size synthetic
// doc: one moved station updates exactly its dependents, nothing else moves.
import { describe, expect, it } from 'vitest';

import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import {
  buildFieldToFinishProject,
  type FieldToFinishCadPoint,
} from '../src/engine/fieldToFinish/cadGeneration';
import { applyAdjustmentRerunToLinkedF2f } from '../src/engine/fieldToFinish/regeneration';
import { FieldLineworkControl } from '../src/engine/fieldToFinish/featureMetadata';
import { SAMPLE_CATALOG } from '../src/engine/fieldToFinish/sampleCatalog';
import type { AdjustmentResult } from '../src/types';
import type { Station } from '../src/typesObservations';

const N = 300;

const buildPoints = (): FieldToFinishCadPoint[] =>
  Array.from({ length: N }, (_, i) => {
    const slot = i % 20;
    const control =
      slot === 0
        ? FieldLineworkControl.BEGIN
        : slot === 19
          ? FieldLineworkControl.END
          : FieldLineworkControl.CONTINUE;
    return {
      stationId: `S${String(i).padStart(5, '0')}`,
      x: (i % 30) * 10,
      y: Math.floor(i / 30) * 10,
      z: 0,
      sourceOrder: i + 1,
      sourceLine: i + 1,
      rawCodeText: 'EDGE',
      codes: [{ code: 'EDGE', rawCode: 'EDGE', controls: [control] }],
      sourceImportId: 'scale-guard',
    };
  });

describe('f2f rerun sync indexed-path guard (§52)', () => {
  it('moves one station and touches only its dependents', () => {
    const points = buildPoints();
    const project = buildFieldToFinishProject(createBlankCadProject({ name: 'Guard', units: 'm' }), {
      points,
      catalog: SAMPLE_CATALOG,
      generationRunId: 'guard-1',
      source: { sourceKind: 'adjustment', inputFingerprint: 'guard-in', settingsFingerprint: 'guard-set' },
    }).project;
    const moved = points[150]?.stationId as string;
    const stations: Record<string, Station> = {};
    for (const point of points) {
      stations[point.stationId] = { x: point.x, y: point.y, h: 0, fixed: false };
    }
    stations[moved] = { ...stations[moved] as Station, x: stations[moved]!.x + 0.5 };
    const result = ({ success: true, stations, observations: [], logs: [] }) as unknown as AdjustmentResult;

    const outcome = applyAdjustmentRerunToLinkedF2f(project, { result });
    expect(outcome.changed).toBe(true);
    expect(outcome.status).toBe('CURRENT');
    expect(outcome.updated).toEqual([moved]);
    expect(outcome.affectedEntityIds.length).toBeLessThanOrEqual(12);
    expect(outcome.affectedEntityIds.length).toBeLessThan(outcome.project.entities.length);
    const stray = outcome.project.entities.filter(
      (entity) =>
        entity.type === 'survey-point' &&
        entity.stationId !== moved &&
        (entity.x !== stations[entity.stationId]?.x || entity.y !== stations[entity.stationId]?.y),
    );
    expect(stray).toEqual([]);
  });
});
