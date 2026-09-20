import { describe, expect, it } from 'vitest';
import { buildCadDisplayScene } from '../src/engine/cad/cadRenderer';
import { entityIntersectsBounds } from '../src/engine/cad/cadSpatialBounds';
import { primitiveBounds } from '../src/components/surveyCad/SurveyCadPreview.geometry';
import type { CadEntity, CadMTextAttachment, CadProject } from '../src/engine/cad/cadTypes';
import type { CadDisplayPrimitive } from '../src/engine/cad/cadDisplayTypes';

const base = { layerId: 'general', visible: true, locked: false } as const;

const buildProject = (entities: CadEntity[]): CadProject => ({
  version: 2,
  id: 'p',
  name: 'p',
  metadata: {
    source: 'parsed-input',
    runMode: 'unknown',
    units: 'm',
    stationCount: 0,
    observationCount: 0,
    adjustedStationCount: 0,
  },
  layers: [{ id: 'general', name: 'General', color: '#ffffff', visible: true, locked: false, role: 'planning' }],
  styleLibrary: {
    lineTypes: [],
    textStyles: [
      {
        id: 'std-model-2_5',
        name: 'Standard-Model-2.5',
        fontFamily: 'Arial',
        fontSize: 2.5,
        heightMode: 'model',
        modelHeight: 2.5,
        widthFactor: 1,
        lineSpacingFactor: 1,
      },
    ],
    pointSymbols: [],
    styles: [],
  },
  dimensionStyles: [
    {
      id: 'dim-std',
      name: 'Dim-Std',
      textStyleId: 'std-model-2_5',
      arrowBlockDefinitionId: 'arrow-missing',
      arrowSize: 2.5,
      arrowSizeMode: 'model',
      textGap: 1,
      extensionOffset: 1,
      extensionOvershoot: 1,
      decimalPrecision: 2,
    },
  ],
  leaderStyles: [
    {
      id: 'leader-std',
      name: 'Leader-Std',
      textStyleId: 'std-model-2_5',
      arrowBlockDefinitionId: 'arrow-missing',
      arrowSize: 2.5,
      arrowSizeMode: 'model',
      landingLength: 5,
      textGap: 1,
    },
  ],
  bearingLabelStyles: [
    {
      id: 'bearing-std',
      name: 'Bearing-Std',
      textStyleId: 'std-model-2_5',
      content: 'bearing-distance',
      separator: 'newline',
      offset: { x: 0, y: 0 },
      decimalPrecision: 3,
    },
  ],
  curveLabelStyles: [
    {
      id: 'curve-std',
      name: 'Curve-Std',
      textStyleId: 'std-model-2_5',
      fields: ['radius', 'delta', 'length'],
      offset: { x: 0, y: 0 },
      decimalPrecision: 3,
    },
  ],
  annotationSettings: { scaleDenominator: 500 },
  entities,
  cogoComputations: [],
  bounds: null,
});

const lineEntity: CadEntity = {
  id: 'L1',
  ...base,
  type: 'line',
  fromStationId: 'A',
  toStationId: 'B',
  fromX: 0,
  fromY: 0,
  toX: 100,
  toY: 0,
  sourceObservationIds: [],
};

const arcEntity: CadEntity = {
  id: 'A1',
  ...base,
  type: 'arc',
  centerX: 0,
  centerY: 0,
  radius: 50,
  startAngleDeg: 0,
  endAngleDeg: 90,
};

describe('annotation renderer derivation', () => {
  it('derives one style-resolved text primitive per mtext line', () => {
    const project = buildProject([
      {
        id: 'M1',
        ...base,
        type: 'mtext',
        x: 10,
        y: 20,
        text: 'A\nB',
        textStyleId: 'std-model-2_5',
        rotationDeg: 0,
        attachment: 'middle-center',
      },
    ]);
    const primitives = buildCadDisplayScene(project).primitives;
    expect(primitives).toHaveLength(2);
    const [first, second] = primitives;
    expect(first?.id).toBe('primitive:M1:1');
    expect(first?.sourceEntityId).toBe('M1');
    expect(first?.layerId).toBe('general');
    if (first?.kind !== 'text' || second?.kind !== 'text') throw new Error('expected text primitives');
    expect(first.text).toBe('A');
    expect(second.text).toBe('B');
    expect(first.fontSize).toBe(2.5);
    expect(first.textAnchor).toBe('middle');
    expect(second.point.y).toBeLessThan(first.point.y);
  });

  it('derives leader polyline, fallback arrow, landing, and text', () => {
    const project = buildProject([
      {
        id: 'LD1',
        ...base,
        type: 'leader',
        arrowAnchor: { kind: 'fixed', x: 0, y: 0 },
        vertices: [{ x: 10, y: 10 }],
        text: 'Note',
        leaderStyleId: 'leader-std',
      },
    ]);
    const primitives = buildCadDisplayScene(project).primitives;
    for (const primitive of primitives) {
      expect(primitive.sourceEntityId).toBe('LD1');
      expect(primitive.layerId).toBe('general');
    }
    const shaft = primitives.find((primitive) => primitive.id === 'primitive:LD1:1');
    expect(shaft?.kind).toBe('line');
    if (shaft?.kind === 'line') {
      expect(shaft.points).toEqual([{ x: 0, y: 0 }, { x: 10, y: 10 }]);
    }
    // Missing arrow block falls back to a plain shaft-stub line.
    expect(primitives.some((primitive) => primitive.id === 'primitive:LD1:arrow')).toBe(true);
    expect(primitives.some((primitive) => primitive.id === 'primitive:LD1:landing')).toBe(true);
    const text = primitives.find((primitive) => primitive.id === 'primitive:LD1:text');
    expect(text?.kind).toBe('text');
    if (text?.kind === 'text') expect(text.text).toBe('Note');
  });

  it('expands leader arrowheads through the block-reference path when known', () => {
    const project = buildProject([
      {
        id: 'LD2',
        ...base,
        type: 'leader',
        arrowAnchor: { kind: 'fixed', x: 0, y: 0 },
        vertices: [{ x: 10, y: 0 }],
        text: 'Note',
        leaderStyleId: 'leader-std',
      },
    ]);
    project.leaderStyles = (project.leaderStyles ?? []).map((entry) => ({
      ...entry,
      arrowBlockDefinitionId: 'blk-arrow',
    }));
    project.blockDefinitions = [
      {
        id: 'blk-arrow',
        name: 'Arrow',
        basePoint: { x: 0, y: 0 },
        entities: [
          {
            id: 'shaft',
            type: 'line',
            layerId: '0',
            visible: true,
            locked: false,
            fromStationId: '',
            toStationId: '',
            fromX: 0,
            fromY: 0,
            toX: -1,
            toY: 0,
            sourceObservationIds: [],
          },
        ],
      },
    ];
    const primitives = buildCadDisplayScene(project).primitives;
    const expanded = primitives.filter((primitive) => primitive.id.includes(':arrow:'));
    expect(expanded.length).toBeGreaterThan(0);
    for (const primitive of expanded) {
      expect(primitive.sourceEntityId).toBe('LD2');
      expect(primitive.layerId).toBe('general');
    }
  });

  it('derives dimension segments, arrows, and measured text', () => {
    const project = buildProject([
      {
        id: 'D1',
        ...base,
        type: 'dimension',
        dimensionKind: 'linear',
        anchors: [],
        defPoint1: { kind: 'fixed', x: 0, y: 0 },
        defPoint2: { kind: 'fixed', x: 100, y: 0 },
        orientation: 'horizontal',
        dimLinePoint: { x: 50, y: 10 },
        dimensionStyleId: 'dim-std',
      },
    ]);
    const primitives = buildCadDisplayScene(project).primitives;
    for (const primitive of primitives) {
      expect(primitive.sourceEntityId).toBe('D1');
      expect(primitive.layerId).toBe('general');
    }
    expect(primitives.filter((primitive) => primitive.id.startsWith('primitive:D1:ext:'))).toHaveLength(2);
    expect(primitives.filter((primitive) => primitive.id.startsWith('primitive:D1:dim:'))).toHaveLength(1);
    const text = primitives.find((primitive) => primitive.id === 'primitive:D1:text');
    expect(text?.kind).toBe('text');
    if (text?.kind === 'text') {
      expect(text.text).toBe('100.00');
      expect(text.fontSize).toBe(2.5);
    }
  });

  it('derives bearing text from the source line', () => {
    const project = buildProject([
      lineEntity,
      {
        id: 'B1',
        ...base,
        type: 'bearing-label',
        sourceEntityId: 'L1',
        labelStyleId: 'bearing-std',
        offset: { x: 0, y: 0 },
      },
    ]);
    const primitives = buildCadDisplayScene(project).primitives.filter(
      (primitive) => primitive.sourceEntityId === 'B1',
    );
    expect(primitives).toHaveLength(1);
    expect(primitives[0]?.kind).toBe('text');
    if (primitives[0]?.kind === 'text') {
      expect(primitives[0].text).toContain('\n');
      expect(primitives[0].text).toContain('100.000');
      expect(primitives[0].textAnchor).toBe('middle');
    }
  });

  it('derives curve text from the source arc', () => {
    const project = buildProject([
      arcEntity,
      {
        id: 'C1',
        ...base,
        type: 'curve-label',
        sourceEntityId: 'A1',
        labelStyleId: 'curve-std',
        offset: { x: 0, y: 0 },
      },
    ]);
    const primitives = buildCadDisplayScene(project).primitives.filter(
      (primitive) => primitive.sourceEntityId === 'C1',
    );
    expect(primitives).toHaveLength(1);
    if (primitives[0]?.kind === 'text') {
      expect(primitives[0].text.startsWith('R 50.000')).toBe(true);
    } else {
      throw new Error('expected curve text primitive');
    }
  });

  it('honors every leader text attachment (anchor + vertical stack)', () => {
    const leaderText = (
      attachment: CadMTextAttachment,
      text = 'Note',
    ): Extract<CadDisplayPrimitive, { kind: 'text' }>[] => {
      const project = buildProject([
        {
          id: 'LD',
          ...base,
          type: 'leader',
          arrowAnchor: { kind: 'fixed', x: 0, y: 0 },
          vertices: [{ x: 10, y: 0 }],
          text,
          textAttachment: attachment,
          leaderStyleId: 'leader-std',
        },
      ]);
      return buildCadDisplayScene(project).primitives.filter(
        (primitive): primitive is Extract<CadDisplayPrimitive, { kind: 'text' }> =>
          primitive.sourceEntityId === 'LD' && primitive.kind === 'text',
      );
    };
    const left = leaderText('middle-left');
    expect(left[0]?.textAnchor).toBe('start');
    expect(left[0]?.point).toEqual({ x: 16, y: 0 });
    expect(leaderText('middle-center')[0]?.textAnchor).toBe('middle');
    expect(leaderText('middle-right')[0]?.textAnchor).toBe('end');

    // Two rows expose the vertical component (step = 2.5 model units).
    const top = leaderText('top-left', 'A\nB');
    expect(top[0]?.point.y).toBe(0);
    expect(top[1]?.point.y).toBeCloseTo(-2.5, 6);
    const middle = leaderText('middle-left', 'A\nB');
    expect(middle[0]?.point.y).toBeCloseTo(1.25, 6);
    expect(middle[1]?.point.y).toBeCloseTo(-1.25, 6);
    const bottom = leaderText('bottom-left', 'A\nB');
    expect(bottom[0]?.point.y).toBeCloseTo(2.5, 6);
    expect(bottom[1]?.point.y).toBe(0);
  });

  it('places curve labels at the mid-arc with tangent rotation for CCW and CW arcs', () => {
    const curveText = (startAngleDeg: number, endAngleDeg: number) => {
      const project = buildProject([
        { ...arcEntity, startAngleDeg, endAngleDeg },
        {
          id: 'C1',
          ...base,
          type: 'curve-label',
          sourceEntityId: 'A1',
          labelStyleId: 'curve-std',
          offset: { x: 0, y: 0 },
        },
      ]);
      const primitive = buildCadDisplayScene(project).primitives.find(
        (candidate) => candidate.sourceEntityId === 'C1',
      );
      if (primitive?.kind !== 'text') throw new Error('expected curve text primitive');
      return primitive;
    };
    const expectedX = 50 * Math.cos(Math.PI / 4);
    for (const [start, end] of [[0, 90] as const, [90, 0] as const]) {
      const primitive = curveText(start, end);
      expect(primitive.point.x).toBeCloseTo(expectedX, 6);
      expect(primitive.point.y).toBeCloseTo(expectedX, 6);
      // CCW tangent 135° / CW tangent −45° both fold upright to −45°.
      expect(primitive.rotationDeg).toBe(-45);
      expect(primitive.text).toContain('\u0394 90');
    }
  });

  it('updates curve label placement + rotation when the source arc is edited', () => {
    const curveText = (endAngleDeg: number) => {
      const project = buildProject([
        { ...arcEntity, startAngleDeg: 0, endAngleDeg },
        {
          id: 'C1',
          ...base,
          type: 'curve-label',
          sourceEntityId: 'A1',
          labelStyleId: 'curve-std',
          offset: { x: 0, y: 0 },
        },
      ]);
      const primitive = buildCadDisplayScene(project).primitives.find(
        (candidate) => candidate.sourceEntityId === 'C1',
      );
      if (primitive?.kind !== 'text') throw new Error('expected curve text primitive');
      return primitive;
    };
    const before = curveText(60);
    expect(before.point.x).toBeCloseTo(50 * Math.cos(Math.PI / 6), 6);
    expect(before.point.y).toBeCloseTo(25, 6);
    expect(before.rotationDeg).toBe(-60);
    const after = curveText(120);
    expect(after.point.x).toBeCloseTo(25, 6);
    expect(after.point.y).toBeCloseTo(50 * Math.sin(Math.PI / 3), 6);
    expect(after.rotationDeg).toBe(-30);
  });

  it('honors a manual dimension textPoint while keeping the geometry measurement', () => {
    const project = buildProject([
      {
        id: 'D1',
        ...base,
        type: 'dimension',
        dimensionKind: 'linear',
        anchors: [],
        defPoint1: { kind: 'fixed', x: 0, y: 0 },
        defPoint2: { kind: 'fixed', x: 100, y: 0 },
        orientation: 'horizontal',
        dimLinePoint: { x: 50, y: 10 },
        textPoint: { x: 5, y: 60 },
        dimensionStyleId: 'dim-std',
      },
    ]);
    const text = buildCadDisplayScene(project).primitives.find(
      (candidate) => candidate.id === 'primitive:D1:text',
    );
    if (text?.kind !== 'text') throw new Error('expected dimension text');
    expect(text.point).toEqual({ x: 5, y: 60 });
    expect(text.text).toBe('100.00');
  });

  it('keeps manual dimension text put across a source edit and resumes autofit when cleared', () => {
    const withDimension = (defPoint2X: number, textPoint?: { x: number; y: number }) =>
      buildProject([
        {
          id: 'D1',
          ...base,
          type: 'dimension',
          dimensionKind: 'linear',
          anchors: [],
          defPoint1: { kind: 'fixed', x: 0, y: 0 },
          defPoint2: { kind: 'fixed', x: defPoint2X, y: 0 },
          orientation: 'horizontal',
          dimLinePoint: { x: 50, y: 10 },
          ...(textPoint != null ? { textPoint } : {}),
          dimensionStyleId: 'dim-std',
        },
      ]);
    const readText = (project: CadProject) => {
      const primitive = buildCadDisplayScene(project).primitives.find(
        (candidate) => candidate.id === 'primitive:D1:text',
      );
      if (primitive?.kind !== 'text') throw new Error('expected dimension text');
      return primitive;
    };
    const manual = readText(withDimension(100, { x: 5, y: 60 }));
    expect(manual.text).toBe('100.00');
    const edited = readText(withDimension(200, { x: 5, y: 60 }));
    expect(edited.text).toBe('200.00');
    expect(edited.point).toEqual({ x: 5, y: 60 });
    const auto = readText(withDimension(200));
    expect(auto.point).not.toEqual({ x: 5, y: 60 });
    expect(auto.text).toBe('200.00');
  });

  it('emits BROKEN markers for unresolvable annotation references', () => {
    const project = buildProject([
      {
        id: 'LDX',
        ...base,
        type: 'leader',
        arrowAnchor: { kind: 'survey-point', entityId: 'missing', fallbackX: 7, fallbackY: 8 },
        vertices: [{ x: 10, y: 10 }],
        text: 'Note',
        leaderStyleId: 'leader-std',
      },
      {
        id: 'DX',
        ...base,
        type: 'dimension',
        dimensionKind: 'linear',
        anchors: [
          { kind: 'survey-point', entityId: 'missing', fallbackX: 1, fallbackY: 2 },
          { kind: 'fixed', x: 100, y: 0 },
        ],
        orientation: 'horizontal',
        dimLinePoint: { x: 50, y: 10 },
        dimensionStyleId: 'dim-std',
      },
      {
        id: 'BX',
        ...base,
        type: 'bearing-label',
        sourceEntityId: 'missing',
        labelStyleId: 'bearing-std',
        offset: { x: 3, y: 4 },
      },
    ]);
    const primitives = buildCadDisplayScene(project).primitives;
    const broken = primitives.filter(
      (primitive) => primitive.kind === 'text' && primitive.text === 'BROKEN',
    );
    expect(broken.map((primitive) => primitive.sourceEntityId).sort()).toEqual(['BX', 'DX', 'LDX']);
    const leaderBroken = broken.find((primitive) => primitive.sourceEntityId === 'LDX');
    if (leaderBroken?.kind === 'text') {
      expect(leaderBroken.point).toEqual({ x: 7, y: 8 });
    }
  });

  it('culls annotation entities against derived bounds', () => {
    const project = buildProject([
      {
        id: 'D1',
        ...base,
        type: 'dimension',
        dimensionKind: 'linear',
        anchors: [],
        defPoint1: { kind: 'fixed', x: 0, y: 0 },
        defPoint2: { kind: 'fixed', x: 100, y: 0 },
        orientation: 'horizontal',
        dimLinePoint: { x: 50, y: 10 },
        dimensionStyleId: 'dim-std',
      },
      {
        id: 'M1',
        ...base,
        type: 'mtext',
        x: 500,
        y: 500,
        text: 'Far',
        textStyleId: 'std-model-2_5',
        rotationDeg: 0,
        attachment: 'top-left',
      },
    ]);
    const dimension = project.entities.find((entity) => entity.id === 'D1')!;
    const mtext = project.entities.find((entity) => entity.id === 'M1')!;
    expect(entityIntersectsBounds(project, dimension, { minX: 40, minY: 0, maxX: 60, maxY: 20 })).toBe(true);
    expect(
      entityIntersectsBounds(project, dimension, { minX: 1000, minY: 1000, maxX: 1010, maxY: 1010 }),
    ).toBe(false);
    expect(
      entityIntersectsBounds(project, mtext, { minX: 495, minY: 495, maxX: 510, maxY: 505 }),
    ).toBe(true);
    expect(entityIntersectsBounds(project, mtext, { minX: 0, minY: 0, maxX: 10, maxY: 10 })).toBe(false);
  });

  it('bounds include arrowheads, leader landing/text, and manual dimension textPoint', () => {
    const project = buildProject([
      {
        id: 'D1',
        ...base,
        type: 'dimension',
        dimensionKind: 'linear',
        anchors: [],
        defPoint1: { kind: 'fixed', x: 0, y: 0 },
        defPoint2: { kind: 'fixed', x: 100, y: 0 },
        orientation: 'horizontal',
        dimLinePoint: { x: 50, y: 10 },
        textPoint: { x: 50, y: 60 },
        dimensionStyleId: 'dim-std',
      },
      {
        id: 'LD',
        ...base,
        type: 'leader',
        arrowAnchor: { kind: 'fixed', x: 0, y: 0 },
        vertices: [{ x: 10, y: 0 }],
        text: 'NOTE',
        textAttachment: 'middle-right',
        leaderStyleId: 'leader-std',
      },
    ]);
    const dimension = project.entities.find((entity) => entity.id === 'D1')!;
    // Only the manual text point lives here; the geometry alone would not.
    expect(
      entityIntersectsBounds(project, dimension, { minX: 48, minY: 58, maxX: 52, maxY: 62 }),
    ).toBe(true);
    const leader = project.entities.find((entity) => entity.id === 'LD')!;
    // middle-right text extends left from the landing reference (x 10..16).
    expect(
      entityIntersectsBounds(project, leader, { minX: 11, minY: -1, maxX: 13, maxY: 1 }),
    ).toBe(true);
    // Arrowhead body around the tip at (0,0) (size 2.5) is covered.
    expect(
      entityIntersectsBounds(project, leader, { minX: 1, minY: 1, maxX: 2, maxY: 2 }),
    ).toBe(true);
    expect(
      entityIntersectsBounds(project, leader, { minX: 1000, minY: 1000, maxX: 1001, maxY: 1001 }),
    ).toBe(false);
  });

  it('measures derived annotation text with the deterministic preview estimate', () => {
    const project = buildProject([
      {
        id: 'M1',
        ...base,
        type: 'mtext',
        x: 10,
        y: 20,
        text: 'Hello',
        textStyleId: 'std-model-2_5',
        rotationDeg: 0,
        attachment: 'top-left',
      },
    ]);
    const primitive = buildCadDisplayScene(project).primitives[0];
    expect(primitive?.kind).toBe('text');
    if (primitive?.kind !== 'text') throw new Error('expected text primitive');
    const box = primitiveBounds(primitive, (x, y) => ({ x, y }), 1);
    expect(box.maxX).toBeGreaterThan(box.minX);
    expect(box.maxY).toBeGreaterThan(box.minY);
  });
});
