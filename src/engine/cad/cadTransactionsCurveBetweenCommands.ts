import {
  buildCadCurveBetweenTangentRays,
  resolveTwoTangentRays,
  solveCadCurveThroughTwoTangentRays,
  type CadCurveArcResult,
  type CadCurveThroughPointCandidate,
  type CadTwoTangentRays,
} from './cadCurvesTwoTangent';
import { createCogoProvenance } from './cadTransactionsCogoReports';
import type { CadCommandDefinition, CadWorkspaceSnapshot } from './cadTransactions.types';
import type { CadLineEntity } from './cadTypes';
import {
  appendCurveArcWithSupport,
  buildCadCurveArcEntity,
  buildCurveMetricRows,
  commitCadCurve,
  findEditableLine,
  lineInputOf,
  replaceSourceLines,
  trimCadLineToCurve,
} from './cadTransactionsCurveF1Shared';
import type {
  CadCurveBetweenLinesCommand,
  CadCurveOnLinesCommand,
  CadCurveThroughPointCommand,
} from './cadTransactionsCurveF1Types';

/**
 * Phase CAD Curves F1 — contracts 1/2/3: tangent curve between two selected
 * lines. Between + Through trim both sources to PC/PT; On shares the exact
 * same arc with the sources byte-unchanged.
 */

const buildTurnInputs = (rays: CadTwoTangentRays) => ({
  turnSide: rays.turnSide,
  signedTurnDeg: rays.signedTurnDeg,
  deltaDeg: rays.deltaDeg,
  pi: rays.pi,
});

/** Never picks by array order: a unique solution commits, otherwise the
 *  caller must name the side and that side must be unique. */
const selectThroughPointCandidate = (
  outcome: ReturnType<typeof solveCadCurveThroughTwoTangentRays>,
  candidateSide: 'left' | 'right' | undefined,
): CadCurveThroughPointCandidate | null => {
  if (outcome.ok) {
    // A caller-supplied side is a constraint, not a hint: fail closed when the
    // unique kernel result disagrees instead of silently committing the other
    // side (the session layer already rejects this mismatch).
    if (candidateSide != null && outcome.result.side !== candidateSide) return null;
    return outcome.result;
  }
  if (outcome.code !== 'MULTIPLE_SOLUTIONS' || candidateSide == null) return null;
  const matches = outcome.candidates.filter((candidate) => candidate.side === candidateSide);
  return matches.length === 1 ? matches[0]! : null;
};

const commitTwoLineTangent = ({
  snapshot,
  toolKey,
  first,
  second,
  rays,
  result,
  trim,
  provenanceInputs,
  metadata,
}: {
  snapshot: CadWorkspaceSnapshot;
  toolKey: 'CURVE_BETWEEN_TWO_LINES_CREATE' | 'CURVE_ON_TWO_LINES_CREATE' | 'CURVE_THROUGH_POINT_CREATE';
  first: CadLineEntity;
  second: CadLineEntity;
  rays: CadTwoTangentRays;
  result: CadCurveArcResult | CadCurveThroughPointCandidate;
  trim: boolean;
  provenanceInputs: Record<string, unknown>;
  metadata: Record<string, unknown>;
}) => {
  const summary = `Created tangent curve between ${first.id} and ${second.id}`;
  const provenance = createCogoProvenance({
    toolKey,
    summary,
    sourceEntityIds: [first.id, second.id],
    inputs: provenanceInputs,
    parameters: { ...buildTurnInputs(rays), radius: result.metrics.radius, trim },
  });
  const { arcEntity, sequence } = buildCadCurveArcEntity({
    project: snapshot.project,
    definition: result.arc,
    createdBy: toolKey,
    metadata: { sourceLineIds: [first.id, second.id], trim, ...metadata },
    provenance,
  });

  let project = snapshot.project;
  if (trim) {
    const firstPiece = trimCadLineToCurve({
      line: first,
      curveEntity: arcEntity,
      ray: rays.ray1,
      tangentPoint: result.pc,
    });
    const secondPiece = trimCadLineToCurve({
      line: second,
      curveEntity: arcEntity,
      ray: rays.ray2,
      tangentPoint: result.pt,
    });
    if (!firstPiece || !secondPiece) return null;
    project = replaceSourceLines(project, [
      { sourceId: first.id, piece: firstPiece },
      { sourceId: second.id, piece: secondPiece },
    ]);
  }

  const appended = appendCurveArcWithSupport({ project, arcEntity, sequence, createdBy: toolKey });
  return commitCadCurve({
    toolKey,
    title: 'Tangent Curve',
    summary,
    provenance,
    arcEntity,
    reportRows: [
      { label: 'PC', value: `${result.pc.x.toFixed(3)}, ${result.pc.y.toFixed(3)}`, unit: 'm' },
      { label: 'PT', value: `${result.pt.x.toFixed(3)}, ${result.pt.y.toFixed(3)}`, unit: 'm' },
      { label: 'Trimmed sources', value: trim ? 'yes' : 'no' },
      ...buildCurveMetricRows(result.metrics),
    ],
    project: appended.project,
    supportEntities: appended.supportEntities,
    transactionLabel: `${toolKey} (${first.id}, ${second.id})`,
  });
};

export const curveBetweenTwoLinesCommand: CadCommandDefinition<CadCurveBetweenLinesCommand> = {
  key: 'CURVE_BETWEEN_TWO_LINES_CREATE',
  execute: (snapshot, command) => {
    const first = findEditableLine(snapshot.project, command.firstEntityId);
    const second = findEditableLine(snapshot.project, command.secondEntityId);
    if (!first || !second) return null;
    const rays = resolveTwoTangentRays(
      lineInputOf(first),
      lineInputOf(second),
      command.firstPickPoint,
      command.secondPickPoint,
    );
    if (!rays) return null;
    const outcome = buildCadCurveBetweenTangentRays(rays, command.metric);
    if (!outcome.ok) return null;
    return commitTwoLineTangent({
      snapshot,
      toolKey: command.key,
      first,
      second,
      rays,
      result: outcome.result,
      trim: true,
      provenanceInputs: { metric: command.metric },
      metadata: {},
    });
  },
};

export const curveOnTwoLinesCommand: CadCommandDefinition<CadCurveOnLinesCommand> = {
  key: 'CURVE_ON_TWO_LINES_CREATE',
  execute: (snapshot, command) => {
    const first = findEditableLine(snapshot.project, command.firstEntityId);
    const second = findEditableLine(snapshot.project, command.secondEntityId);
    if (!first || !second) return null;
    const rays = resolveTwoTangentRays(
      lineInputOf(first),
      lineInputOf(second),
      command.firstPickPoint,
      command.secondPickPoint,
    );
    if (!rays) return null;
    const outcome = buildCadCurveBetweenTangentRays(rays, command.metric);
    if (!outcome.ok) return null;
    return commitTwoLineTangent({
      snapshot,
      toolKey: command.key,
      first,
      second,
      rays,
      result: outcome.result,
      trim: false,
      provenanceInputs: { metric: command.metric },
      metadata: {},
    });
  },
};

export const curveThroughPointCommand: CadCommandDefinition<CadCurveThroughPointCommand> = {
  key: 'CURVE_THROUGH_POINT_CREATE',
  execute: (snapshot, command) => {
    const first = findEditableLine(snapshot.project, command.firstEntityId);
    const second = findEditableLine(snapshot.project, command.secondEntityId);
    if (!first || !second) return null;
    const rays = resolveTwoTangentRays(
      lineInputOf(first),
      lineInputOf(second),
      command.firstPickPoint,
      command.secondPickPoint,
    );
    if (!rays) return null;
    const outcome = solveCadCurveThroughTwoTangentRays(rays, command.throughPoint);
    const chosen = selectThroughPointCandidate(outcome, command.candidateSide);
    if (!chosen) return null;
    return commitTwoLineTangent({
      snapshot,
      toolKey: command.key,
      first,
      second,
      rays,
      result: chosen,
      trim: true,
      provenanceInputs: {
        throughPoint: command.throughPoint,
        candidateSide: chosen.side,
      },
      metadata: { throughPoint: command.throughPoint },
    });
  },
};
