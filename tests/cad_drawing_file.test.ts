import { describe, expect, it } from 'vitest';

import { importAdjustedPointsIntoCadProject } from '../src/engine/cad/cadAdjustedPointsImport';
import {
  createBlankCadDrawingDocument,
  migrateSurveyCadStateToDrawing,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { appendCadProjectEntities } from '../src/engine/cad/cadProjectState';
import type { SurveyCadPersistedState } from '../src/engine/cad/cadTypes';
import type { AdjustmentResult } from '../src/types';

const adjustmentResult = {
  success: true,
  converged: true,
  iterations: 2,
  seuw: 1,
  dof: 4,
  logs: [],
  observations: [],
  stations: {
    A: {
      x: 10,
      y: 20,
      h: 30,
      fixed: true,
      errorEllipse: {
        stationId: 'A',
        semiMajor: 0.01,
        semiMinor: 0.005,
        theta: 45,
      },
    },
    B: {
      x: 40,
      y: 50,
      h: 60,
      fixed: false,
    },
  },
} as AdjustmentResult;

describe('CAD drawing file', () => {
  it('round-trips standalone .wncad documents deterministically', () => {
    const drawing = createBlankCadDrawingDocument({
      name: 'Boundary Drawing',
      units: 'm',
    });

    const parsed = parseCadDrawingFile(serializeCadDrawingFile(drawing));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.drawing.kind).toBe('webnet-cad-drawing');
    expect(parsed.drawing.schemaVersion).toBe(1);
    expect(parsed.drawing.name).toBe('Boundary Drawing');
    expect(parsed.drawing.project.entities).toEqual([]);
  });

  it('rejects invalid CAD drawing files', () => {
    const parsed = parseCadDrawingFile('{"kind":"webnet-project"}');

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors[0]).toContain('CAD drawing file kind is invalid');
  });

  it('migrates legacy Survey CAD state into a standalone drawing', () => {
    const legacyState: SurveyCadPersistedState = {
      version: 1,
      sourceSignature: 'legacy-source',
      project: createBlankCadDrawingDocument({ name: 'Legacy', units: 'm' }).project,
      showParcelLabels: false,
    };

    const drawing = migrateSurveyCadStateToDrawing({ state: legacyState });

    expect(drawing.kind).toBe('webnet-cad-drawing');
    expect(drawing.name).toBe('Legacy');
    expect(drawing.showParcelLabels).toBe(false);
    expect(drawing.project.version).toBe(2);
  });
});

describe('Import Adjusted Points', () => {
  it('upserts adjusted points and preserves unrelated CAD entities', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Import Target', units: 'm' });
    const projectWithManualLine = appendCadProjectEntities(drawing.project, [
      {
        id: 'line:manual',
        type: 'line',
        layerId: 'observation-lines',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        fromStationId: 'CAD1',
        toStationId: 'CAD2',
        fromX: 0,
        fromY: 0,
        toX: 1,
        toY: 1,
        sourceObservationIds: [],
      },
      {
        id: 'pt:A',
        type: 'survey-point',
        layerId: 'points',
        styleId: 'style-point',
        visible: true,
        locked: false,
        stationId: 'A',
        x: 1,
        y: 2,
        z: 3,
        pointClass: 'free',
        source: 'parsed-input',
      },
    ]);

    const imported = importAdjustedPointsIntoCadProject({
      importedAtIso: '2026-08-05T12:00:00.000Z',
      project: projectWithManualLine,
      result: adjustmentResult,
      sourceName: 'Current adjustment',
    });

    expect(imported.record.createdPointCount).toBe(1);
    expect(imported.record.updatedPointCount).toBe(1);
    expect(imported.record.ellipseCount).toBe(1);
    expect(imported.project.entities.some((entity) => entity.id === 'line:manual')).toBe(true);
    const pointA = imported.project.entities.find((entity) => entity.id === 'pt:A');
    expect(pointA).toMatchObject({
      type: 'survey-point',
      x: 10,
      y: 20,
      source: 'adjustment-result',
    });
    expect(imported.project.entities.some((entity) => entity.id === 'pt:B')).toBe(true);
    expect(imported.project.entities.some((entity) => entity.id === 'ellipse:A')).toBe(true);
    expect(imported.project.cogoComputations.at(-1)?.toolKey).toBe('IMPORT_ADJUSTED_POINTS');
  });
});
