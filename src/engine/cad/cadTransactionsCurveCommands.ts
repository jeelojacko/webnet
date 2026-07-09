import { buildCadCogoEntityMetadata } from './cadCogoTypes';
import {
  cadBuildArcFromThreePoints,
  cadBuildTangentCurve,
} from './cadGeometry';
import { createCadSelectionState } from './cadSelection';
import {
  buildCurveLabels,
  nextCurveSequence,
} from './cadTransactionsEntityFactories';
import { createArcSupportEntities } from './cadTransactionsLinkedEntities';
import {
  appendCogoComputation,
  createCogoProvenance,
} from './cadTransactionsCogoReports';
import { appendCadProjectEntities } from './cadProjectState';
import type { CadCommandDefinition } from './cadTransactions.types';
import type { CadArcEntity, CadEntity } from './cadTypes';
import { createStableRuntimeId } from '../id';
export const arc3ptCommand: CadCommandDefinition<{
  key: 'ARC_3PT';
  start: { x: number; y: number; label: string };
  through: { x: number; y: number; label: string };
  end: { x: number; y: number; label: string };
}> = {
  key: 'ARC_3PT',
  execute: (snapshot, command) => {
    const arcDefinition = cadBuildArcFromThreePoints(command.start, command.through, command.end);
    if (!arcDefinition) return null;
    const curveSequence = nextCurveSequence(snapshot.project);
    const curveLabels = buildCurveLabels(curveSequence);
    const summary = `Created ${curveLabels.curveName} with ${curveLabels.beginLabel}, ${curveLabels.midLabel}, ${curveLabels.endLabel}, ${curveLabels.radiusLabel}`;
    const provenance = createCogoProvenance({
      toolKey: 'ARC_CREATE',
      summary,
      sourcePointIds: [curveLabels.beginLabel, curveLabels.midLabel, curveLabels.endLabel, curveLabels.radiusLabel],
      inputs: {
        start: command.start,
        through: command.through,
        end: command.end,
      },
      parameters: {
        mode: 'ARC_3PT',
      },
    });
    const arcEntity: CadEntity = {
      id: createStableRuntimeId('cad-arc'),
      type: 'arc',
      layerId: 'observation-lines',
      styleId: 'style-observation-line',
      visible: true,
      locked: false,
      centerX: arcDefinition.center.x,
      centerY: arcDefinition.center.y,
      radius: arcDefinition.radius,
      startAngleDeg: arcDefinition.startAngleDeg,
      endAngleDeg: arcDefinition.endAngleDeg,
      metadata: buildCadCogoEntityMetadata({
        createdBy: 'ARC_3PT',
        entityName: curveLabels.curveName,
        manual: true,
        startLabel: command.start.label,
        throughLabel: command.through.label,
        endLabel: command.end.label,
      }, provenance),
    };
    const supportEntities = createArcSupportEntities(
      snapshot.project,
      arcEntity.id,
      curveSequence,
      {
        center: { x: arcDefinition.center.x, y: arcDefinition.center.y },
        radius: arcDefinition.radius,
        startAngleDeg: arcDefinition.startAngleDeg,
        endAngleDeg: arcDefinition.endAngleDeg,
      },
      'ARC_3PT',
    );
    const nextProjectWithEntities = appendCadProjectEntities(snapshot.project, [arcEntity, ...supportEntities]);
    const nextProject = appendCogoComputation({
      project: nextProjectWithEntities,
      provenance,
      title: 'Arc 3 Point',
      summary,
      rows: [
        { label: 'Radius', value: arcDefinition.radius.toFixed(3), unit: 'm' },
        { label: 'Delta', value: arcDefinition.deltaDeg.toFixed(6), unit: 'deg' },
      ],
      createdEntities: [arcEntity, ...supportEntities],
    });
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, [arcEntity.id]),
      },
      commandState: {
        key: 'ARC_3PT',
        phase: 'committed',
        prompt: `ARC_3PT committed as ${curveLabels.curveName}.`,
      },
      transactionLabel: `ARC_3PT (${curveLabels.curveName})`,
      addedEntityIds: [arcEntity.id, ...supportEntities.map((entity) => entity.id)],
      removedEntityIds: [],
    };
  },
};

export const arcCreateCommand: CadCommandDefinition<{
  key: 'ARC_CREATE';
  modeLabel: string;
  definition: {
    center: { x: number; y: number };
    radius: number;
    startAngleDeg: number;
    endAngleDeg: number;
  };
  metadata?: Record<string, unknown>;
}> = {
  key: 'ARC_CREATE',
  execute: (snapshot, command) => {
    const curveSequence = nextCurveSequence(snapshot.project);
    const curveLabels = buildCurveLabels(curveSequence);
    const summary = `${command.modeLabel} created ${curveLabels.curveName} radius ${command.definition.radius.toFixed(3)} m`;
    const provenance = createCogoProvenance({
      toolKey: 'ARC_CREATE',
      summary,
      inputs: {
        modeLabel: command.modeLabel,
        definition: command.definition,
      },
      parameters: command.metadata,
    });
    const arcEntity: CadEntity = {
      id: createStableRuntimeId('cad-arc'),
      type: 'arc',
      layerId: 'observation-lines',
      styleId: 'style-observation-line',
      visible: true,
      locked: false,
      centerX: command.definition.center.x,
      centerY: command.definition.center.y,
      radius: command.definition.radius,
      startAngleDeg: command.definition.startAngleDeg,
      endAngleDeg: command.definition.endAngleDeg,
      metadata: buildCadCogoEntityMetadata({
        createdBy: command.modeLabel,
        entityName: curveLabels.curveName,
        manual: true,
        ...(command.metadata ?? {}),
      }, provenance),
    };
    const supportEntities = createArcSupportEntities(
      snapshot.project,
      arcEntity.id,
      curveSequence,
      {
        center: { x: command.definition.center.x, y: command.definition.center.y },
        radius: command.definition.radius,
        startAngleDeg: command.definition.startAngleDeg,
        endAngleDeg: command.definition.endAngleDeg,
      },
      command.modeLabel,
    );
    const nextProjectWithEntities = appendCadProjectEntities(snapshot.project, [arcEntity, ...supportEntities]);
    const nextProject = appendCogoComputation({
      project: nextProjectWithEntities,
      provenance,
      title: command.modeLabel,
      summary,
      rows: [
        { label: 'Radius', value: command.definition.radius.toFixed(3), unit: 'm' },
        { label: 'Start angle', value: command.definition.startAngleDeg.toFixed(6), unit: 'deg' },
        { label: 'End angle', value: command.definition.endAngleDeg.toFixed(6), unit: 'deg' },
      ],
      createdEntities: [arcEntity, ...supportEntities],
    });
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, [arcEntity.id]),
      },
      commandState: {
        key: 'ARC_CREATE',
        phase: 'committed',
        prompt: `${command.modeLabel} committed as ${curveLabels.curveName}.`,
      },
      transactionLabel: `${command.modeLabel} (${curveLabels.curveName})`,
      addedEntityIds: [arcEntity.id, ...supportEntities.map((entity) => entity.id)],
      removedEntityIds: [],
    };
  },
};

export const tangentCurveCommand: CadCommandDefinition<{
  key: 'TANGENT_CURVE';
  pi: { x: number; y: number; label: string };
  backTangentPoint: { x: number; y: number; label: string };
  aheadTangentPoint: { x: number; y: number; label: string };
  radius: number;
}> = {
  key: 'TANGENT_CURVE',
  execute: (snapshot, command) => {
    const arcDefinition = cadBuildTangentCurve(
      command.pi,
      command.backTangentPoint,
      command.aheadTangentPoint,
      command.radius,
    );
    if (!arcDefinition) return null;
    const curveSequence = nextCurveSequence(snapshot.project);
    const curveLabels = buildCurveLabels(curveSequence);
    const summary = `Created ${curveLabels.curveName} tangent curve with ${curveLabels.beginLabel}, ${curveLabels.midLabel}, ${curveLabels.endLabel}, ${curveLabels.radiusLabel}`;
    const provenance = createCogoProvenance({
      toolKey: 'TANGENT_CURVE',
      summary,
      sourcePointIds: ['PI', 'Back tangent', 'Ahead tangent', curveLabels.radiusLabel],
      inputs: {
        pi: command.pi,
        backTangentPoint: command.backTangentPoint,
        aheadTangentPoint: command.aheadTangentPoint,
      },
      parameters: {
        radius: command.radius,
      },
    });
    const arcEntity: CadEntity = {
      id: createStableRuntimeId('cad-arc'),
      type: 'arc',
      layerId: 'observation-lines',
      styleId: 'style-observation-line',
      visible: true,
      locked: false,
      centerX: arcDefinition.center.x,
      centerY: arcDefinition.center.y,
      radius: arcDefinition.radius,
      startAngleDeg: arcDefinition.startAngleDeg,
      endAngleDeg: arcDefinition.endAngleDeg,
      metadata: buildCadCogoEntityMetadata({
        createdBy: 'TANGENT_CURVE',
        entityName: curveLabels.curveName,
        manual: true,
        piLabel: command.pi.label,
        backLabel: command.backTangentPoint.label,
        aheadLabel: command.aheadTangentPoint.label,
      }, provenance),
    };
    const supportEntities = createArcSupportEntities(
      snapshot.project,
      arcEntity.id,
      curveSequence,
      {
        center: { x: arcDefinition.center.x, y: arcDefinition.center.y },
        radius: arcDefinition.radius,
        startAngleDeg: arcDefinition.startAngleDeg,
        endAngleDeg: arcDefinition.endAngleDeg,
      },
      'TANGENT_CURVE',
    );
    const nextProjectWithEntities = appendCadProjectEntities(snapshot.project, [arcEntity, ...supportEntities]);
    const nextProject = appendCogoComputation({
      project: nextProjectWithEntities,
      provenance,
      title: 'Tangent Curve',
      summary,
      rows: [
        { label: 'PI', value: command.pi.label },
        { label: 'Radius', value: command.radius.toFixed(3), unit: 'm' },
        { label: 'Delta', value: arcDefinition.deltaDeg.toFixed(6), unit: 'deg' },
      ],
      createdEntities: [arcEntity, ...supportEntities],
    });
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, [arcEntity.id]),
      },
      commandState: {
        key: 'TANGENT_CURVE',
        phase: 'committed',
        prompt: `TANGENT_CURVE committed as ${curveLabels.curveName} with radius ${command.radius.toFixed(3)}.`,
      },
      transactionLabel: `TANGENT_CURVE (${curveLabels.curveName})`,
      addedEntityIds: [arcEntity.id, ...supportEntities.map((entity) => entity.id)],
      removedEntityIds: [],
    };
  },
};

