import { cadArcSubdivisionPoints } from './cadCogoCurveMath';
import { createCadSelectionState } from './cadSelection';
import { appendCadProjectEntities } from './cadProjectState';
import {
  compactManualPointEntities,
  createManualPointEntities,
} from './cadTransactionsEntityFactories';
import { appendCogoComputation, createCogoProvenance } from './cadTransactionsCogoReports';
import type { CadCommandDefinition } from './cadTransactions.types';
import type { CadEntity, CadEntityId, CadSurveyPointEntity } from './cadTypes';
import { findEditableArc } from './cadTransactionsCurveF1Shared';
import type { CadSubdivideCurveCommand } from './cadTransactionsCurveF1Types';

/**
 * Phase CAD Curves F1 — atomic subdivision. All interior points land in ONE
 * history entry (one transaction, one COGO computation), replacing the
 * previous per-point `POINT` commits. The arc itself is never modified.
 */

export const subdivideCurveCommand: CadCommandDefinition<CadSubdivideCurveCommand> = {
  key: 'SUBDIVIDE_CURVE_CREATE',
  execute: (snapshot, command) => {
    const arc = findEditableArc(snapshot.project, command.arcEntityId);
    if (!arc) return null;
    const points = cadArcSubdivisionPoints({ arc, mode: command.mode, value: command.value });
    if (points.length === 0) return null;

    const summary = `Created ${points.length} subdivision point${points.length === 1 ? '' : 's'} on ${arc.id}`;
    const provenance = createCogoProvenance({
      toolKey: 'SUBDIVIDE_CURVE',
      summary,
      sourceEntityIds: [arc.id],
      inputs: { mode: command.mode, value: command.value },
      parameters: { pointCount: points.length, arcId: arc.id },
    });

    let project = snapshot.project;
    const createdEntities: CadEntity[] = [];
    const pointIds: CadEntityId[] = [];
    points.forEach((point, index) => {
      const bundle = createManualPointEntities(
        project,
        point.x,
        point.y,
        `${arc.id}-${index + 1}`,
        { createdBy: 'SUBDIVIDE_CURVE' },
      );
      const pointEntity: CadSurveyPointEntity = {
        ...bundle.point,
        metadata: {
          ...(bundle.point.metadata ?? {}),
          createdBy: 'SUBDIVIDE_CURVE',
          anchorCurveEntityId: arc.id,
          subdivisionIndex: index + 1,
        },
      };
      const labelEntity = bundle.label
        ? {
            ...bundle.label,
            metadata: {
              ...(bundle.label.metadata ?? {}),
              anchorCurveEntityId: arc.id,
            },
          }
        : null;
      const appended = compactManualPointEntities([pointEntity, labelEntity]);
      project = appendCadProjectEntities(project, appended);
      createdEntities.push(...appended);
      pointIds.push(pointEntity.id);
    });

    const nextProject = appendCogoComputation({
      project,
      provenance,
      title: 'Curve Subdivision',
      summary,
      rows: [
        { label: 'Arc', value: arc.id },
        { label: 'Mode', value: command.mode.toUpperCase() },
        { label: 'Value', value: command.value.toFixed(3) },
        { label: 'Points', value: `${points.length}` },
      ],
      createdEntities,
    });

    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, pointIds),
      },
      commandState: {
        key: 'SUBDIVIDE_CURVE_CREATE',
        phase: 'committed',
        prompt: `SUBDIVIDE_CURVE_CREATE committed with ${points.length} point(s).`,
      },
      transactionLabel: `SUBDIVIDE_CURVE_CREATE (${points.length})`,
      addedEntityIds: createdEntities.map((entity) => entity.id),
      removedEntityIds: [],
    };
  },
};
