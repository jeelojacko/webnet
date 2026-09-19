// Phase 18O annotation command transactions: create each semantic type,
// MOVE/COPY/ERASE preserve sources, reattach/fix, override, scale, undo/redo.
import { describe, expect, it } from 'vitest';

import { createBlankCadProject } from '../../cadDrawingFile';
import { createCadHistoryState, redoCadHistory, runCadCommand, undoCadHistory } from '../../cadUndoRedo';
import { executeCadCommand } from '../../cadTransactions';
import { createCadSelectionState } from '../../cadSelection';
import { resolveCadAnnotationAnchor, type CadAnnotationAnchor } from '../cadAnnotationAnchors';
import { resolveCadAnnotationTextMetrics } from '../cadAnnotationTextMetrics';
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
  CadTextStyle,
} from '../../cadTypes';

const base = { layerId: 'general', visible: true, locked: false } as const;

const line = (id = 'line-1'): CadLineEntity => ({
  ...base,
  id,
  type: 'line',
  fromStationId: 'A',
  toStationId: 'B',
  fromX: 0,
  fromY: 0,
  toX: 10,
  toY: 0,
  sourceObservationIds: [],
});

const arc = (id = 'arc-1'): CadArcEntity => ({
  ...base,
  id,
  type: 'arc',
  centerX: 0,
  centerY: 0,
  radius: 25,
  startAngleDeg: 0,
  endAngleDeg: 90,
});

const surveyPoint = (id = 'pt-1'): CadSurveyPointEntity => ({
  ...base,
  id,
  type: 'survey-point',
  stationId: 'P1',
  x: 3,
  y: 4,
  pointClass: 'free',
  source: 'parsed-input',
});

const projectWith = (entities: CadEntity[]): CadProject => {
  const project = createBlankCadProject({ name: 'Annotation commands', units: 'm' });
  project.entities = entities;
  return project;
};

const fixed = (x: number, y: number): CadAnnotationAnchor => ({ kind: 'fixed', x, y });

const annotationOf = <TEntity extends CadEntity>(
  project: CadProject,
  type: TEntity['type'],
): TEntity | undefined =>
  project.entities.find((entity): entity is TEntity => entity.type === type);

const hasType = (project: CadProject, type: CadEntity['type']): boolean =>
  project.entities.some((entity) => entity.type === type);

describe('cadAnnotationCommands (18O)', () => {
  it('CREATE_MTEXT appends a semantic text entity and is undoable/redoable', () => {
    const history = createCadHistoryState(projectWith([line()]));
    const next = runCadCommand(history, {
      key: 'CREATE_MTEXT',
      x: 1,
      y: 2,
      text: 'NOTE\nsecond line',
      rotationDeg: 15,
      attachment: 'middle-center',
    });
    expect(next).not.toBe(history);
    const mtext = annotationOf<CadMTextEntity>(next.present.project, 'mtext');
    expect(mtext).toMatchObject({ x: 1, y: 2, rotationDeg: 15, attachment: 'middle-center' });
    expect(next.present.selection.selectedEntityIds).toEqual([mtext?.id]);
    expect(next.present.project.layers.some((layer) => layer.id === mtext?.layerId)).toBe(true);

    const undone = undoCadHistory(next);
    expect(hasType(undone.present.project, 'mtext')).toBe(false);
    const redone = redoCadHistory(undone);
    expect(hasType(redone.present.project, 'mtext')).toBe(true);
  });

  it('CREATE_LEADER keeps the arrow anchor associative', () => {
    const history = createCadHistoryState(projectWith([surveyPoint()]));
    const next = runCadCommand(history, {
      key: 'CREATE_LEADER',
      arrowAnchor: { kind: 'survey-point', entityId: 'pt-1', fallbackX: 3, fallbackY: 4 },
      vertices: [
        { x: 3, y: 4 },
        { x: 8, y: 9 },
      ],
      text: 'LEAD',
    });
    const leader = annotationOf<CadLeaderEntity>(next.present.project, 'leader');
    expect(leader?.arrowAnchor.kind).toBe('survey-point');
    expect(leader?.vertices).toHaveLength(2);
    expect(resolveCadAnnotationAnchor(leader!.arrowAnchor, next.present.project)).toEqual({ ok: true, x: 3, y: 4 });
  });

  it('CREATE_DIMENSION accepts all five kinds', () => {
    const kinds: CadDimensionEntity['dimensionKind'][] = ['linear', 'aligned', 'angular', 'radius', 'diameter'];
    kinds.forEach((dimensionKind) => {
      const anchors =
        dimensionKind === 'radius' || dimensionKind === 'diameter'
          ? [fixed(0, 0)]
          : [fixed(0, 0), fixed(3, 4)];
      const next = runCadCommand(createCadHistoryState(projectWith([line()])), {
        key: 'CREATE_DIMENSION',
        dimensionKind,
        anchors,
        orientation: dimensionKind === 'linear' ? 'horizontal' : undefined,
        dimLinePoint: { x: 0, y: 5 },
        dimensionStyleId: 'std-500',
      });
      const dimension = annotationOf<CadDimensionEntity>(next.present.project, 'dimension');
      expect(dimension?.dimensionKind).toBe(dimensionKind);
      expect(dimension?.anchors).toEqual(anchors);
      if (dimensionKind === 'linear' || dimensionKind === 'aligned') {
        expect(dimension?.defPoint1).toEqual(anchors[0]);
        expect(dimension?.defPoint2).toEqual(anchors[1]);
      } else {
        expect(dimension?.defPoint1).toBeUndefined();
      }
    });
  });

  it('CREATE_BEARING_LABEL / CREATE_CURVE_LABEL bind to their source kinds', () => {
    const project = projectWith([line(), arc()]);
    const bearing = runCadCommand(createCadHistoryState(project), {
      key: 'CREATE_BEARING_LABEL',
      sourceEntityId: 'line-1',
      offset: { x: 0, y: 2 },
    });
    const bearingLabel = annotationOf<CadBearingDistanceLabelEntity>(bearing.present.project, 'bearing-label');
    expect(bearingLabel?.sourceEntityId).toBe('line-1');
    expect(bearingLabel?.labelStyleId).toBeTruthy();

    const curve = runCadCommand(createCadHistoryState(project), {
      key: 'CREATE_CURVE_LABEL',
      sourceEntityId: 'arc-1',
      offset: { x: 1, y: 1 },
    });
    const curveLabel = annotationOf<CadCurveLabelEntity>(curve.present.project, 'curve-label');
    expect(curveLabel?.sourceEntityId).toBe('arc-1');

    // Wrong source kind rejects honestly (no fake label).
    expect(
      executeCadCommand(createCadHistoryState(project).present, {
        key: 'CREATE_BEARING_LABEL',
        sourceEntityId: 'arc-1',
      }),
    ).toBeNull();
  });

  it('locked layer rejects creation through checkCadEntityEditable', () => {
    const project = projectWith([line()]);
    project.layers = project.layers.map((layer) =>
      layer.id === 'general' ? { ...layer, locked: true } : layer,
    );
    expect(
      executeCadCommand(createCadHistoryState(project).present, { key: 'CREATE_MTEXT', x: 0, y: 0, text: 'x' }),
    ).toBeNull();
  });

  it('MOVE translates placement only; dimension anchors and leader arrow stay bound', () => {
    const project = projectWith([surveyPoint()]);
    const withLeader = runCadCommand(createCadHistoryState(project), {
      key: 'CREATE_LEADER',
      arrowAnchor: { kind: 'survey-point', entityId: 'pt-1', fallbackX: 3, fallbackY: 4 },
      vertices: [{ x: 3, y: 4 }, { x: 8, y: 9 }],
      text: 'L',
    });
    const leaderId = annotationOf<CadLeaderEntity>(withLeader.present.project, 'leader')!.id;
    const withDim = runCadCommand(
      { ...withLeader, present: { ...withLeader.present, selection: createCadSelectionState(withLeader.present.project, [leaderId]) } },
      {
        key: 'CREATE_DIMENSION',
        dimensionKind: 'aligned',
        anchors: [fixed(0, 0), fixed(3, 4)],
        dimLinePoint: { x: 0, y: 5 },
      },
    );
    const dimId = annotationOf<CadDimensionEntity>(withDim.present.project, 'dimension')!.id;
    const selected = createCadSelectionState(withDim.present.project, [leaderId, dimId]);
    const moved = runCadCommand(
      { ...withDim, present: { ...withDim.present, selection: selected } },
      { key: 'MOVE', deltaX: 100, deltaY: 50 },
    );
    const movedLeader = annotationOf<CadLeaderEntity>(moved.present.project, 'leader')!;
    expect(movedLeader.vertices).toEqual([{ x: 103, y: 54 }, { x: 108, y: 59 }]);
    expect(movedLeader.arrowAnchor).toEqual({ kind: 'survey-point', entityId: 'pt-1', fallbackX: 3, fallbackY: 4 });
    const movedDim = annotationOf<CadDimensionEntity>(moved.present.project, 'dimension')!;
    expect(movedDim.dimLinePoint).toEqual({ x: 100, y: 55 });
    expect(movedDim.anchors).toEqual([fixed(0, 0), fixed(3, 4)]);
  });

  it('COPY gives new ids, preserves anchors to the same source, translates placement', () => {
    const project = projectWith([line(), arc()]);
    const withLabels = runCadCommand(createCadHistoryState(project), {
      key: 'CREATE_BEARING_LABEL',
      sourceEntityId: 'line-1',
    });
    const bearingId = annotationOf<CadBearingDistanceLabelEntity>(withLabels.present.project, 'bearing-label')!.id;
    const withCurve = runCadCommand(
      { ...withLabels, present: { ...withLabels.present, selection: createCadSelectionState(withLabels.present.project, [bearingId]) } },
      { key: 'CREATE_CURVE_LABEL', sourceEntityId: 'arc-1' },
    );
    const curveId = annotationOf<CadCurveLabelEntity>(withCurve.present.project, 'curve-label')!.id;
    const withDim = runCadCommand(
      { ...withCurve, present: { ...withCurve.present, selection: createCadSelectionState(withCurve.present.project, [curveId]) } },
      {
        key: 'CREATE_DIMENSION',
        dimensionKind: 'linear',
        anchors: [fixed(0, 0), fixed(10, 0)],
        dimLinePoint: { x: 0, y: 3 },
      },
    );
    const dimId = annotationOf<CadDimensionEntity>(withDim.present.project, 'dimension')!.id;
    const selection = createCadSelectionState(withDim.present.project, [bearingId, curveId, dimId]);
    const sourceBefore = withDim.present.project;
    const copied = runCadCommand(
      { ...withDim, present: { ...withDim.present, selection } },
      { key: 'COPY', deltaX: 10, deltaY: 20 },
    );
    expect(copied).not.toBe(withDim);

    const copies = copied.present.project.entities.filter(
      (entity) =>
        (entity.type === 'bearing-label' || entity.type === 'curve-label' || entity.type === 'dimension') &&
        ![bearingId, curveId, dimId].includes(entity.id),
    );
    expect(copies).toHaveLength(3);
    for (const copy of copies) {
      expect([bearingId, curveId, dimId]).not.toContain(copy.id);
    }
    const dimCopy = copied.present.project.entities.find(
      (entity): entity is CadDimensionEntity => entity.type === 'dimension' && entity.id !== dimId,
    )!;
    expect(dimCopy.anchors).toEqual([fixed(0, 0), fixed(10, 0)]);
    expect(dimCopy.dimLinePoint).toEqual({ x: 10, y: 23 });

    // Originals untouched.
    expect(sourceBefore.entities.filter((entity) => entity.type === 'dimension')).toHaveLength(1);
  });

  it('PASTE keeps a copied annotation as a semantic entity', () => {
    const project = projectWith([arc()]);
    const created = runCadCommand(createCadHistoryState(project), {
      key: 'CREATE_CURVE_LABEL',
      sourceEntityId: 'arc-1',
      offset: { x: 1, y: 1 },
    });
    const curveId = annotationOf<CadCurveLabelEntity>(created.present.project, 'curve-label')!.id;
    const pasted = runCadCommand(created, {
      key: 'PASTE',
      deltaX: 4,
      deltaY: 6,
      entityIds: [curveId],
    });
    const curveLabels = pasted.present.project.entities.filter(
      (entity): entity is CadCurveLabelEntity => entity.type === 'curve-label',
    );
    expect(curveLabels).toHaveLength(2);
    const pastedLabel = curveLabels.find((entity) => entity.id !== curveId)!;
    expect(pastedLabel.offset).toEqual({ x: 5, y: 7 });
    expect(pastedLabel.sourceEntityId).toBe('arc-1');
  });

  it('ERASE removes the annotation without touching its source', () => {
    const project = projectWith([line()]);
    const created = runCadCommand(createCadHistoryState(project), {
      key: 'CREATE_BEARING_LABEL',
      sourceEntityId: 'line-1',
    });
    const bearingId = annotationOf<CadBearingDistanceLabelEntity>(created.present.project, 'bearing-label')!.id;
    const erased = runCadCommand(
      { ...created, present: { ...created.present, selection: createCadSelectionState(created.present.project, [bearingId]) } },
      { key: 'ERASE' },
    );
    expect(hasType(erased.present.project, 'bearing-label')).toBe(false);
    expect(hasType(erased.present.project, 'line')).toBe(true);
  });

  it('UPDATE_DIMENSION_PLACEMENT moves placement and never the anchors', () => {
    const project = projectWith([line()]);
    const created = runCadCommand(createCadHistoryState(project), {
      key: 'CREATE_DIMENSION',
      dimensionKind: 'aligned',
      anchors: [fixed(0, 0), fixed(3, 4)],
      dimLinePoint: { x: 0, y: 5 },
      textPoint: { x: 0, y: 6 },
    });
    const dimId = annotationOf<CadDimensionEntity>(created.present.project, 'dimension')!.id;
    const updated = runCadCommand(created, {
      key: 'UPDATE_DIMENSION_PLACEMENT',
      entityId: dimId,
      dimLinePoint: { x: 1, y: 7 },
      textPoint: null,
    });
    const dimension = annotationOf<CadDimensionEntity>(updated.present.project, 'dimension')!;
    expect(dimension.dimLinePoint).toEqual({ x: 1, y: 7 });
    expect(dimension.textPoint).toBeUndefined();
    expect(dimension.anchors).toEqual([fixed(0, 0), fixed(3, 4)]);
  });

  it('REATTACH_ANNOTATION follows a re-bound anchor and converts to fixed', () => {
    const project = projectWith([surveyPoint(), line()]);
    const created = runCadCommand(createCadHistoryState(project), {
      key: 'CREATE_LEADER',
      arrowAnchor: { kind: 'survey-point', entityId: 'pt-1', fallbackX: 3, fallbackY: 4 },
      vertices: [{ x: 3, y: 4 }, { x: 8, y: 9 }],
      text: 'L',
    });
    const leaderId = annotationOf<CadLeaderEntity>(created.present.project, 'leader')!.id;

    const rebound = runCadCommand(created, {
      key: 'REATTACH_ANNOTATION',
      entityId: leaderId,
      slot: 'leader-arrow',
      anchor: { kind: 'line-endpoint', entityId: 'line-1', endpoint: 'end', fallbackX: 10, fallbackY: 0 },
    });
    const reboundLeader = annotationOf<CadLeaderEntity>(rebound.present.project, 'leader')!;
    expect(resolveCadAnnotationAnchor(reboundLeader.arrowAnchor, rebound.present.project)).toEqual({ ok: true, x: 10, y: 0 });

    const fixedLeader = runCadCommand(rebound, {
      key: 'REATTACH_ANNOTATION',
      entityId: leaderId,
      slot: 'leader-arrow',
    });
    const frozen = annotationOf<CadLeaderEntity>(fixedLeader.present.project, 'leader')!;
    expect(frozen.arrowAnchor).toEqual({ kind: 'fixed', x: 10, y: 0 });
  });

  it('SET_TEXT_OVERRIDE / CLEAR_TEXT_OVERRIDE are undoable and no-op cleanly', () => {
    const project = projectWith([line()]);
    const created = runCadCommand(createCadHistoryState(project), {
      key: 'CREATE_DIMENSION',
      dimensionKind: 'linear',
      anchors: [fixed(0, 0), fixed(10, 0)],
      dimLinePoint: { x: 0, y: 3 },
    });
    const dimId = annotationOf<CadDimensionEntity>(created.present.project, 'dimension')!.id;
    const overridden = runCadCommand(created, { key: 'SET_TEXT_OVERRIDE', entityId: dimId, text: 'CL 0.00' });
    expect(annotationOf<CadDimensionEntity>(overridden.present.project, 'dimension')?.textOverride).toBe('CL 0.00');
    // Same value again = no new history entry.
    expect(runCadCommand(overridden, { key: 'SET_TEXT_OVERRIDE', entityId: dimId, text: 'CL 0.00' })).toBe(overridden);
    const cleared = runCadCommand(overridden, { key: 'CLEAR_TEXT_OVERRIDE', entityId: dimId });
    expect(annotationOf<CadDimensionEntity>(cleared.present.project, 'dimension')?.textOverride).toBeUndefined();
    expect(runCadCommand(cleared, { key: 'CLEAR_TEXT_OVERRIDE', entityId: dimId })).toBe(cleared);
  });

  it('SET_ANNOTATION_SCALE doubles paper model height and leaves model/legacy untouched', () => {
    const project = createBlankCadProject({ name: 'Scale', units: 'm' });
    const paperStyle = project.styleLibrary.textStyles.find((style) => style.id === 'paper-2_5mm')!;
    const modelStyle = project.styleLibrary.textStyles.find((style) => style.id === 'std-model-2_5')!;
    const legacyStyle = project.styleLibrary.textStyles.find((style) => style.id === 'label-default')!;
    expect(project.annotationSettings?.scaleDenominator).toBe(500);

    const metricsAt = (scaleDenominator: number, style: CadTextStyle): number =>
      resolveCadAnnotationTextMetrics({
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        heightMode: style.heightMode,
        modelHeight: style.modelHeight,
        paperHeightMm: style.paperHeightMm,
        widthFactor: style.widthFactor,
        lineSpacingFactor: style.lineSpacingFactor,
        annotationScaleDenominator: scaleDenominator,
        unitsMode: 'm',
      }).modelHeight;

    expect(metricsAt(500, paperStyle)).toBeCloseTo(1.25, 10);
    expect(metricsAt(1000, paperStyle)).toBeCloseTo(2.5, 10);
    expect(metricsAt(500, modelStyle)).toBe(2.5);
    expect(metricsAt(1000, modelStyle)).toBe(2.5);
    expect(metricsAt(500, legacyStyle)).toBe(legacyStyle.fontSize);
    expect(metricsAt(1000, legacyStyle)).toBe(legacyStyle.fontSize);

    const history = createCadHistoryState(projectWith([]));
    const scaledProject = { ...history.present.project, annotationSettings: { scaleDenominator: 500 } };
    const scaled = runCadCommand(
      { ...history, present: { ...history.present, project: scaledProject } },
      { key: 'SET_ANNOTATION_SCALE', scaleDenominator: 1000 },
    );
    expect(scaled.present.project.annotationSettings?.scaleDenominator).toBe(1000);
    expect(metricsAt(scaled.present.project.annotationSettings!.scaleDenominator, paperStyle)).toBeCloseTo(2.5, 10);
    // Re-applying the current scale is a no-op (no history entry).
    expect(runCadCommand(scaled, { key: 'SET_ANNOTATION_SCALE', scaleDenominator: 1000 })).toBe(scaled);
    const undone = undoCadHistory(scaled);
    expect(undone.present.project.annotationSettings?.scaleDenominator).toBe(500);
  });

  it('editing a source adds no annotation history entry (derivation only)', () => {
    const project = projectWith([line()]);
    const created = runCadCommand(createCadHistoryState(project), {
      key: 'CREATE_BEARING_LABEL',
      sourceEntityId: 'line-1',
      offset: { x: 0, y: 2 },
    });
    const bearingId = annotationOf<CadBearingDistanceLabelEntity>(created.present.project, 'bearing-label')!.id;
    const lineLabel = annotationOf<CadLineEntity>(created.present.project, 'line')!;
    const depthBefore = created.undoStack.length;
    const moved = runCadCommand(
      {
        ...created,
        present: {
          ...created.present,
          selection: createCadSelectionState(created.present.project, [lineLabel.id]),
        },
      },
      { key: 'MOVE', deltaX: 5, deltaY: 0 },
    );
    expect(moved.undoStack).toHaveLength(depthBefore + 1);
    const stillThere = annotationOf<CadBearingDistanceLabelEntity>(moved.present.project, 'bearing-label')!;
    expect(stillThere.id).toBe(bearingId);
    // Source moved, label offset identity unchanged → display follows the source.
    expect(annotationOf<CadLineEntity>(moved.present.project, 'line')!.fromX).toBe(lineLabel.fromX + 5);
    expect(stillThere.offset).toEqual({ x: 0, y: 2 });
  });
});
