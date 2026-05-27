import { describe, expect, it } from 'vitest';

import { cloneSurveyCadPersistedState, sanitizeSurveyCadPersistedState } from '../src/engine/cad/cadPersistence';
import { buildMlightcadSpikeScene } from '../src/engine/cad/cadMlightcadAdapter';
import { buildCadBounds } from '../src/engine/cad/cadProjectState';
import { buildCadDisplayScene } from '../src/engine/cad/cadRenderer';
import type { CadProject, SurveyCadPersistedState } from '../src/engine/cad/cadTypes';

const project: CadProject = {
  version: 1,
  id: 'cad-project-fixtures',
  name: 'CAD Fixture Project',
  metadata: {
    source: 'parsed-input',
    runMode: 'adjustment',
    units: 'm',
    stationCount: 0,
    observationCount: 0,
    adjustedStationCount: 0,
  },
  layers: [
    {
      id: 'planning',
      name: 'Planning',
      color: '#38bdf8',
      visible: true,
      locked: false,
      role: 'planning',
    },
  ],
  styleLibrary: {
    lineTypes: [{ id: 'continuous', name: 'Continuous', dashPattern: [] }],
    textStyles: [],
    pointSymbols: [],
    styles: [{ id: 'planning-style', name: 'Planning', color: '#38bdf8', strokeWidth: 1.25 }],
  },
  entities: [
    {
      id: 'arc-1',
      type: 'arc',
      layerId: 'planning',
      styleId: 'planning-style',
      visible: true,
      locked: false,
      centerX: 50,
      centerY: 50,
      radius: 10,
      startAngleDeg: 0,
      endAngleDeg: 90,
    },
    {
      id: 'polygon-1',
      type: 'polygon',
      layerId: 'planning',
      styleId: 'planning-style',
      visible: true,
      locked: false,
      vertices: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 10 },
      ],
      vertexLabels: ['A', 'B', 'C'],
    },
    {
      id: 'parcel-1',
      type: 'parcel',
      layerId: 'planning',
      styleId: 'planning-style',
      visible: true,
      locked: false,
      vertices: [
        { x: 100, y: 100 },
        { x: 120, y: 100 },
        { x: 120, y: 115 },
      ],
      vertexLabels: ['P1', 'P2', 'P3'],
      parcelName: 'Lot 1',
      areaSquareMeters: 150,
      perimeterMeters: 55,
    },
  ],
  bounds: null,
};

describe('Survey CAD persistence and entity families', () => {
  it('builds deterministic bounds and display primitives for arc, polygon, and parcel entities', () => {
    const withBounds = {
      ...project,
      bounds: buildCadBounds(project.entities),
    };

    expect(withBounds.bounds).toEqual({
      minX: 0,
      minY: 0,
      maxX: 120,
      maxY: 115,
    });

    const displayScene = buildCadDisplayScene(withBounds);
    expect(displayScene.primitives.some((primitive) => primitive.sourceEntityId === 'arc-1')).toBe(
      true,
    );
    expect(
      displayScene.primitives.filter((primitive) => primitive.sourceEntityId === 'polygon-1').length,
    ).toBe(3);
    expect(
      displayScene.primitives.filter((primitive) => primitive.sourceEntityId === 'parcel-1').length,
    ).toBe(3);

    const mlightcadScene = buildMlightcadSpikeScene(withBounds);
    expect(mlightcadScene.entities.find((entity) => entity.objectId === 'arc-1')?.type).toBe(
      'AcDbArc',
    );
    expect(mlightcadScene.entities.find((entity) => entity.objectId === 'parcel-1')?.type).toBe(
      'AcDbPolyline',
    );
  });

  it('round-trips the persisted Survey CAD state through clone/sanitize helpers', () => {
    const state: SurveyCadPersistedState = {
      version: 1,
      sourceSignature: 'fixture-signature',
      project: {
        ...project,
        bounds: buildCadBounds(project.entities),
      },
    };

    const cloned = cloneSurveyCadPersistedState(state);
    expect(cloned).toEqual(state);
    expect(cloned).not.toBe(state);
    expect(cloned.project).not.toBe(state.project);

    const sanitized = sanitizeSurveyCadPersistedState(state);
    expect(sanitized).toEqual(state);
    expect(sanitizeSurveyCadPersistedState({ version: 2 })).toBeUndefined();
  });
});
