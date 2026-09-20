// Phase 18O persist slice: professional annotation tables + the 5 new entity
// types round-trip through .wncad (schema stays 2, all tables additive +
// trailing). Broken source references stay broken across save/reopen — they
// are never re-bound and never silently converted to fixed. Annotation
// creation is undoable on the shared history seam; source edits derive the
// label geometry without a second history entry.
import { describe, expect, it } from 'vitest';

import {
  createBlankCadDrawingDocument,
  createBlankCadProject,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { replaceCadProjectEntities } from '../src/engine/cad/cadProjectState';
import {
  createCadHistoryState,
  redoCadHistory,
  runCadCommand,
  undoCadHistory,
} from '../src/engine/cad/cadUndoRedo';
import {
  isAnchorBroken,
  resolveCadAnnotationAnchor,
} from '../src/engine/cad/annotation/cadAnnotationAnchors';
import { sanitizeAnnotationTables } from '../src/engine/cad/annotation/cadAnnotationPersistence';
import {
  seedBearingLabelStyles,
  seedCurveLabelStyles,
  seedDimensionStyles,
  seedLeaderStyles,
} from '../src/engine/cad/annotation/cadAnnotationSeeds';
import type {
  CadArcEntity,
  CadBearingDistanceLabelEntity,
  CadCurveLabelEntity,
  CadDimensionEntity,
  CadEntity,
  CadLeaderEntity,
  CadLineEntity,
  CadMTextEntity,
  CadProject,
  CadSurveyPointEntity,
} from '../src/engine/cad/cadTypes';

const LAYER = 'general';
const base = { layerId: LAYER, visible: true, locked: false } as const;

const surveyPoint = (id: string, x: number, y: number): CadSurveyPointEntity => ({
  ...base,
  id,
  type: 'survey-point',
  stationId: id,
  x,
  y,
  pointClass: 'control',
  source: 'parsed-input',
});

const line = (
  id: string,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): CadLineEntity => ({
  ...base,
  id,
  type: 'line',
  fromStationId: 'P1',
  toStationId: 'P2',
  fromX,
  fromY,
  toX,
  toY,
  sourceObservationIds: [],
});

const arc = (id: string): CadArcEntity => ({
  ...base,
  id,
  type: 'arc',
  centerX: 5,
  centerY: 5,
  radius: 5,
  startAngleDeg: 0,
  endAngleDeg: 90,
});

const mtext = (id: string): CadMTextEntity => ({
  ...base,
  id,
  type: 'mtext',
  x: 1,
  y: 2,
  text: 'LINE 1\nLINE 2\nLINE 3',
  textStyleId: 'std-model-2_5',
  rotationDeg: 15,
  attachment: 'middle-center',
});

const leader = (id: string): CadLeaderEntity => ({
  ...base,
  id,
  type: 'leader',
  arrowAnchor: {
    kind: 'survey-point',
    entityId: 'P1',
    fallbackX: 0,
    fallbackY: 0,
  },
  vertices: [
    { x: 0, y: 0 },
    { x: 2, y: 2 },
  ],
  text: 'SEE PLAN',
  leaderStyleId: 'std-leader',
  textAttachment: 'top-left',
});

const alignedDimension = (id: string): CadDimensionEntity => ({
  ...base,
  id,
  type: 'dimension',
  dimensionKind: 'aligned',
  anchors: [
    { kind: 'line-endpoint', entityId: 'L1', endpoint: 'start', fallbackX: 0, fallbackY: 0 },
    { kind: 'line-endpoint', entityId: 'L1', endpoint: 'end', fallbackX: 10, fallbackY: 0 },
  ],
  defPoint1: {
    kind: 'line-endpoint',
    entityId: 'L1',
    endpoint: 'start',
    fallbackX: 0,
    fallbackY: 0,
  },
  defPoint2: {
    kind: 'line-endpoint',
    entityId: 'L1',
    endpoint: 'end',
    fallbackX: 10,
    fallbackY: 0,
  },
  orientation: 'aligned',
  dimLinePoint: { x: 5, y: -2 },
  textPoint: { x: 4, y: -6 },
  dimensionStyleId: 'std-500',
});

const radiusDimension = (id: string): CadDimensionEntity => ({
  ...base,
  id,
  type: 'dimension',
  dimensionKind: 'radius',
  anchors: [{ kind: 'arc-point', entityId: 'A1', point: 'center', fallbackX: 5, fallbackY: 5 }],
  dimLinePoint: { x: 10, y: 5 },
  dimensionStyleId: 'std-500',
});

const bearingLabel = (id: string): CadBearingDistanceLabelEntity => ({
  ...base,
  id,
  type: 'bearing-label',
  sourceEntityId: 'L1',
  labelStyleId: 'bearing-default',
  offset: { x: 1, y: 1 },
  side: 'auto',
});

const curveLabel = (id: string): CadCurveLabelEntity => ({
  ...base,
  id,
  type: 'curve-label',
  sourceEntityId: 'A1',
  labelStyleId: 'curve-default',
  offset: { x: 2, y: 2 },
});

const fixtureProject = (): CadProject =>
  replaceCadProjectEntities(createBlankCadProject({ name: 'Annotation fixture', units: 'm' }), [
    surveyPoint('P1', 0, 0),
    surveyPoint('P2', 10, 0),
    line('L1', 0, 0, 10, 0),
    arc('A1'),
    mtext('MT1'),
    leader('LD1'),
    alignedDimension('DIM1'),
    radiusDimension('DIM2'),
    bearingLabel('BL1'),
    curveLabel('CL1'),
  ]);

const annotationEntities = (entities: CadEntity[]): CadEntity[] =>
  entities.filter((entity) =>
    ['mtext', 'leader', 'dimension', 'bearing-label', 'curve-label'].includes(entity.type),
  );

const roundTrip = (project: CadProject) => {
  const document = createBlankCadDrawingDocument({ name: 'Annotation fixture', units: 'm' });
  document.project = project;
  const parsed = parseCadDrawingFile(serializeCadDrawingFile(document));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.errors.join(', '));
  return parsed.drawing.project;
};

describe('cad annotation persistence (18O)', () => {
  it('save/reopen preserves annotation entities, styles, and scale exactly', () => {
    const project = fixtureProject();
    project.annotationSettings = { scaleDenominator: 250 };
    const reopened = roundTrip(project);

    const expected = annotationEntities(project.entities);
    expect(annotationEntities(reopened.entities)).toEqual(expected);
    expect(reopened.dimensionStyles).toEqual(seedDimensionStyles());
    expect(reopened.leaderStyles).toEqual(seedLeaderStyles());
    expect(reopened.bearingLabelStyles).toEqual(seedBearingLabelStyles());
    expect(reopened.curveLabelStyles).toEqual(seedCurveLabelStyles());
    expect(reopened.annotationSettings).toEqual({ scaleDenominator: 250 });
  });

  it('preserves manual leader attachment + dimension textPoint across save/reopen', () => {
    const reopened = roundTrip(fixtureProject());
    const reopenedLeader = reopened.entities.find(
      (entity): entity is CadLeaderEntity => entity.id === 'LD1',
    )!;
    expect(reopenedLeader.textAttachment).toBe('top-left');
    const dimension = reopened.entities.find(
      (entity): entity is CadDimensionEntity => entity.id === 'DIM1',
    )!;
    expect(dimension.textPoint).toEqual({ x: 4, y: -6 });
    // Old 18O rows without the optional fields stay absent (additive only).
    const radius = reopened.entities.find(
      (entity): entity is CadDimensionEntity => entity.id === 'DIM2',
    )!;
    expect(radius.textPoint).toBeUndefined();
  });

  it('reopen resolves every associative anchor against its surviving source', () => {
    const reopened = roundTrip(fixtureProject());
    const reopenedLeader = reopened.entities.find(
      (entity): entity is CadLeaderEntity => entity.id === 'LD1',
    )!;
    const reopenedDim = reopened.entities.find(
      (entity): entity is CadDimensionEntity => entity.id === 'DIM1',
    )!;
    expect(resolveCadAnnotationAnchor(reopenedLeader.arrowAnchor, reopened)).toEqual({
      ok: true,
      x: 0,
      y: 0,
    });
    expect(resolveCadAnnotationAnchor(reopenedDim.anchors[1], reopened)).toEqual({
      ok: true,
      x: 10,
      y: 0,
    });
  });

  it('broken source stays broken across save/reopen (never converted to fixed)', () => {
    const project = fixtureProject();
    // Delete the survey point the leader is anchored to, then round-trip.
    const withoutSource = replaceCadProjectEntities(
      project,
      project.entities.filter((entity) => entity.id !== 'P1'),
    );
    const reopened = roundTrip(withoutSource);
    const reopenedLeader = reopened.entities.find(
      (entity): entity is CadLeaderEntity => entity.id === 'LD1',
    )!;
    expect(reopenedLeader.arrowAnchor).toEqual({
      kind: 'survey-point',
      entityId: 'P1',
      fallbackX: 0,
      fallbackY: 0,
    });
    expect(isAnchorBroken(reopenedLeader.arrowAnchor, reopened)).toBe(true);
    expect(resolveCadAnnotationAnchor(reopenedLeader.arrowAnchor, reopened)).toEqual({
      ok: false,
      fallbackX: 0,
      fallbackY: 0,
      reason: 'BROKEN_REFERENCE',
    });
  });

  it('legacy drawing without tables opens with seeded defaults and legacy text intact', () => {
    const document = createBlankCadDrawingDocument({ name: 'Legacy', units: 'm' });
    const raw = JSON.parse(serializeCadDrawingFile(document)) as Record<string, unknown>;
    const rawProject = raw.project as Record<string, unknown>;
    delete rawProject.dimensionStyles;
    delete rawProject.leaderStyles;
    delete rawProject.bearingLabelStyles;
    delete rawProject.curveLabelStyles;
    delete rawProject.annotationSettings;
    rawProject.entities = [
      {
        ...base,
        id: 'TXT1',
        type: 'text',
        x: 3,
        y: 4,
        text: 'legacy',
      },
    ];
    const parsed = parseCadDrawingFile(JSON.stringify(raw));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.drawing.project.dimensionStyles).toEqual(seedDimensionStyles());
    expect(parsed.drawing.project.annotationSettings).toEqual({ scaleDenominator: 500 });
    expect(parsed.drawing.project.entities).toEqual([
      { ...base, id: 'TXT1', type: 'text', x: 3, y: 4, text: 'legacy' },
    ]);
    const legacyStyle = parsed.drawing.project.styleLibrary.textStyles.find(
      (style) => style.id === 'label-default',
    );
    expect(legacyStyle).toEqual({
      id: 'label-default',
      name: 'Label Default',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 11,
    });
  });

  it('fresh blank drawing seeds the annotation arrowhead block library', () => {
    const project = createBlankCadDrawingDocument({ name: 'Fresh', units: 'm' }).project;
    const ids = (project.blockDefinitions ?? []).map((definition) => definition.id);
    expect(ids).toEqual([
      'webnet-annotation-arrowhead-closed-arrow',
      'webnet-annotation-arrowhead-open-arrow',
      'webnet-annotation-arrowhead-dot',
      'webnet-annotation-arrowhead-architectural-tick',
    ]);
  });

  it('fresh blank drawing default dimension + leader styles resolve to seeded arrowhead blocks', () => {
    const project = createBlankCadDrawingDocument({ name: 'Fresh', units: 'm' }).project;
    const library = new Set((project.blockDefinitions ?? []).map((definition) => definition.id));
    for (const style of project.dimensionStyles ?? []) {
      expect(library.has(style.arrowBlockDefinitionId)).toBe(true);
    }
    for (const style of project.leaderStyles ?? []) {
      expect(library.has(style.arrowBlockDefinitionId)).toBe(true);
    }
    expect(project.dimensionStyles?.[0]?.arrowBlockDefinitionId).toBe(
      'webnet-annotation-arrowhead-closed-arrow',
    );
    expect(project.leaderStyles?.[0]?.arrowBlockDefinitionId).toBe(
      'webnet-annotation-arrowhead-closed-arrow',
    );
  });
});

describe('cad annotation sanitize (18O)', () => {
  it('drops invalid professional text-style optionals, keeps legacy core', () => {
    const project = createBlankCadProject({ name: 'Sanitize', units: 'm' });
    project.styleLibrary.textStyles.push({
      id: 'bad-style',
      name: 'Bad',
      fontFamily: 'Arial',
      fontSize: 3,
      heightMode: 'model',
      modelHeight: -1,
      widthFactor: 0,
      lineSpacingFactor: Number.NaN,
      fontWeight: 'bold',
    });
    const { project: sanitized } = sanitizeAnnotationTables(project);
    expect(sanitized.styleLibrary.textStyles.find((style) => style.id === 'bad-style')).toEqual({
      id: 'bad-style',
      name: 'Bad',
      fontFamily: 'Arial',
      fontSize: 3,
      fontWeight: 'bold',
    });
  });

  it('drops malformed annotation entities and de-duplicates style ids', () => {
    const project = fixtureProject();
    project.entities = [
      ...project.entities,
      {
        ...base,
        id: 'BAD-MT',
        type: 'mtext',
        x: Number.NaN,
        y: 0,
        text: 'x',
        textStyleId: 's',
        rotationDeg: 0,
        attachment: 'middle-center',
      } as CadMTextEntity,
    ];
    project.dimensionStyles = [...seedDimensionStyles(), ...seedDimensionStyles()];
    const { project: sanitized, diagnostics } = sanitizeAnnotationTables(project);
    expect(sanitized.entities.some((entity) => entity.id === 'BAD-MT')).toBe(false);
    expect(sanitized.dimensionStyles).toHaveLength(1);
    expect(
      diagnostics.some((diagnostic) => diagnostic.code === 'CAD_ANNOTATION_ENTITY_DROPPED'),
    ).toBe(true);
    expect(
      diagnostics.some(
        (diagnostic) => diagnostic.code === 'CAD_ANNOTATION_STYLE_DUPLICATE_DROPPED',
      ),
    ).toBe(true);
  });
});

describe('cad annotation history (18O)', () => {
  const history = () => createCadHistoryState(fixtureProject());

  const createCommands = [
    { key: 'CREATE_MTEXT', x: 5, y: 5, text: 'HELLO' },
    {
      key: 'CREATE_LEADER',
      arrowAnchor: { kind: 'fixed', x: 1, y: 1 },
      vertices: [{ x: 1, y: 1 }],
      text: 'L',
    },
    {
      key: 'CREATE_DIMENSION',
      dimensionKind: 'linear',
      anchors: [
        { kind: 'line-endpoint', entityId: 'L1', endpoint: 'start', fallbackX: 0, fallbackY: 0 },
        { kind: 'line-endpoint', entityId: 'L1', endpoint: 'end', fallbackX: 10, fallbackY: 0 },
      ],
      orientation: 'horizontal',
      dimLinePoint: { x: 5, y: -3 },
    },
    { key: 'CREATE_BEARING_LABEL', sourceEntityId: 'L1' },
    { key: 'CREATE_CURVE_LABEL', sourceEntityId: 'A1' },
  ] as const;

  for (const command of createCommands) {
    it(`create + undo + redo round-trips ${command.key}`, () => {
      const initial = history();
      const created = runCadCommand(initial, command as never);
      expect(created).not.toBe(initial);
      expect(created.undoStack).toHaveLength(1);
      expect(created.present.project.entities.length).toBe(
        initial.present.project.entities.length + 1,
      );

      const undone = undoCadHistory(created);
      expect(undone.present.project.entities).toEqual(initial.present.project.entities);
      expect(undone.undoStack).toHaveLength(0);
      expect(undone.redoStack).toHaveLength(1);

      const redone = redoCadHistory(undone);
      expect(redone.present.project.entities).toEqual(created.present.project.entities);
      expect(redone.undoStack).toHaveLength(1);
    });
  }

  it('source edit derives label geometry without its own history entry', () => {
    const withLabel = runCadCommand(history(), {
      key: 'CREATE_BEARING_LABEL',
      sourceEntityId: 'L1',
    });
    expect(withLabel.undoStack).toHaveLength(1);
    const labelCountBefore = withLabel.present.project.entities.filter(
      (entity) => entity.type === 'bearing-label',
    ).length;

    const edited = runCadCommand(withLabel, {
      key: 'EDIT_ENTITY',
      entityId: 'L1',
      edit: { kind: 'line-end', toX: 25, toY: 7 },
    });
    // Exactly one new entry: the source edit. Derivation itself is not stored.
    expect(edited.undoStack).toHaveLength(2);
    const editedLine = edited.present.project.entities.find(
      (entity): entity is CadLineEntity => entity.id === 'L1',
    )!;
    expect(editedLine.toX).toBe(25);
    expect(editedLine.toY).toBe(7);
    // Label survives untouched (still bound to the same source).
    const label = edited.present.project.entities.find(
      (entity): entity is CadBearingDistanceLabelEntity => entity.type === 'bearing-label',
    )!;
    expect(label.sourceEntityId).toBe('L1');
    expect(
      edited.present.project.entities.filter((entity) => entity.type === 'bearing-label'),
    ).toHaveLength(labelCountBefore);

    const undone = undoCadHistory(edited);
    expect(undone.undoStack).toHaveLength(1);
    const revertedLine = undone.present.project.entities.find(
      (entity): entity is CadLineEntity => entity.id === 'L1',
    )!;
    expect(revertedLine.toX).toBe(10);
    expect(undone.present.project.entities.some((entity) => entity.type === 'bearing-label')).toBe(
      true,
    );
  });
});
