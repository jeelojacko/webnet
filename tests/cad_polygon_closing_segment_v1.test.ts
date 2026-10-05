import { describe, expect, it } from 'vitest';

import { buildCadInverseSummary } from '../src/engine/cad/cadCogo';
import { buildCadPropertiesPanelState } from '../src/engine/cad/cadProperties';
import { cadDistance } from '../src/engine/cad/cadGeometry';
import { buildRectangleVertices } from '../src/engine/cad/cadGeometryShapeBuilders';
import { appendCadProjectEntities } from '../src/engine/cad/cadProjectState';
import { buildBaseCadPropertiesProject } from './cadPropertiesTestSupport';

type Vertex = { x: number; y: number };

const withShape = (vertices: Vertex[], type: 'polygon' | 'polyline') => {
  const base = {
    id: `${type}:test`,
    layerId: 'observation-lines',
    styleId: 'style-observation-line',
    visible: true as const,
    locked: false as const,
    vertices: vertices.map((vertex) => ({ ...vertex })),
    vertexLabels: vertices.map((_, index) => `P${index + 1}`),
  };
  const entity =
    type === 'polygon'
      ? { ...base, type: 'polygon' as const }
      : { ...base, type: 'polyline' as const, closed: false };
  return appendCadProjectEntities(buildBaseCadPropertiesProject(), [entity]);
};

const segmentRowValues = (
  properties: { label: string; value: string }[],
  suffix: 'length' | 'azimuth',
): Map<number, string> => {
  const values = new Map<number, string>();
  for (const property of properties) {
    const match = /^Segment (\d+) (length|azimuth)$/.exec(property.label);
    if (match?.[2] === suffix) values.set(Number(match[1]), property.value);
  }
  return values;
};

describe('polygon closing segment property rows', () => {
  // Canonical rectangle from the shape builder: (1,2) (5,2) (5,7) (1,7).
  const vertices = buildRectangleVertices({ x: 1, y: 2 }, { x: 5, y: 7 })!;

  it('emits one segment row per ring edge, including the closing last→first edge', () => {
    const project = withShape(vertices, 'polygon');
    const polygon = project.entities.find((entity) => entity.id === 'polygon:test');
    if (!polygon || polygon.type !== 'polygon') throw new Error('Polygon not found');

    const state = buildCadPropertiesPanelState(project, [polygon]);
    if (!state || state.mode !== 'single') throw new Error('Polygon properties missing');

    const lengths = segmentRowValues(state.entity.properties, 'length');
    const azimuths = segmentRowValues(state.entity.properties, 'azimuth');
    expect(lengths.size).toBe(vertices.length);
    expect(azimuths.size).toBe(vertices.length);
    expect([...lengths.keys()]).toEqual([1, 2, 3, 4]);
    expect([...azimuths.keys()]).toEqual([1, 2, 3, 4]);

    const expectedClosing = buildCadInverseSummary(vertices.at(-1)!, vertices[0]!);
    expect(lengths.get(4)).toBe(expectedClosing.distance.toFixed(3));
    expect(azimuths.get(4)).toBe('180\u00b000\'00"');
  });

  it('matches the builder ring geometry and perimeter across every edge', () => {
    const project = withShape(vertices, 'polygon');
    const polygon = project.entities.find((entity) => entity.id === 'polygon:test');
    if (!polygon || polygon.type !== 'polygon') throw new Error('Polygon not found');

    const state = buildCadPropertiesPanelState(project, [polygon]);
    if (!state || state.mode !== 'single') throw new Error('Polygon properties missing');

    const lengths = segmentRowValues(state.entity.properties, 'length');
    let builderPerimeter = 0;
    for (let index = 0; index < vertices.length; index += 1) {
      const expected = cadDistance(vertices[index]!, vertices[(index + 1) % vertices.length]!);
      builderPerimeter += expected;
      expect(lengths.get(index + 1)).toBe(expected.toFixed(3));
    }
    const rowSum = [...lengths.values()].reduce((total, value) => total + Number(value), 0);
    expect(rowSum).toBeCloseTo(builderPerimeter, 3);
    expect(state.entity.properties.find((row) => row.label === 'Perimeter')?.value).toBe(
      builderPerimeter.toFixed(3),
    );
  });

  it('leaves polyline behavior unchanged at N-1 open segment rows', () => {
    const project = withShape(vertices, 'polyline');
    const polyline = project.entities.find((entity) => entity.id === 'polyline:test');
    if (!polyline || polyline.type !== 'polyline') throw new Error('Polyline not found');

    const state = buildCadPropertiesPanelState(project, [polyline]);
    if (!state || state.mode !== 'single') throw new Error('Polyline properties missing');

    const lengths = segmentRowValues(state.entity.properties, 'length');
    expect(lengths.size).toBe(vertices.length - 1);
    expect([...lengths.keys()]).toEqual([1, 2, 3]);
    expect(lengths.get(3)).toBe('4.000');
    expect(state.entity.properties.some((row) => row.label === 'Segment 4 length')).toBe(false);
  });
});
