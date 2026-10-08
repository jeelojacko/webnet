import { buildCadCurveChain, type CadCurveChainRow } from './cadCurvesMultiple';
import { resolveTwoTangentRays } from './cadCurvesTwoTangent';
import { createCadSelectionState } from './cadSelection';
import { appendCogoComputation, createCogoProvenance } from './cadTransactionsCogoReports';
import type { CadCommandDefinition } from './cadTransactions.types';
import type { CadEntity } from './cadTypes';
import {
  appendCurveArcWithSupport,
  buildCadCurveArcEntity,
  findEditableLine,
  lineInputOf,
} from './cadTransactionsCurveF1Shared';
import type { CadMultipleCurvesCommand } from './cadTransactionsCurveF1Types';

/**
 * Phase CAD Curves F1 — contract 4: N (2..10) tangent curves between two
 * selected lines with exactly one floating curve. One transaction, one COGO
 * computation, sources byte-unchanged, deterministic index order, all created
 * arcs selected.
 */

const chainTableRows = (rows: readonly CadCurveChainRow[]): string[][] =>
  rows.map((row) => [
    `${row.index + 1}`,
    row.radius.toFixed(3),
    row.deltaDeg.toFixed(6),
    row.arcLength.toFixed(3),
    row.chordLength.toFixed(3),
    row.tangentLength.toFixed(3),
    row.side,
    row.floating ? 'yes' : 'no',
  ]);

export const multipleCurvesCommand: CadCommandDefinition<CadMultipleCurvesCommand> = {
  key: 'MULTIPLE_CURVES_CREATE',
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
    const outcome = buildCadCurveChain(rays, command.segments);
    if (!outcome.ok) return null;
    const { arcs, rows } = outcome.result;
    if (arcs.length !== command.segments.length) return null;

    const summary = `Created ${arcs.length} tangent curves between ${first.id} and ${second.id}`;
    const provenance = createCogoProvenance({
      toolKey: 'MULTIPLE_CURVES_CREATE',
      summary,
      sourceEntityIds: [first.id, second.id],
      inputs: { segments: command.segments, turnSide: rays.turnSide, signedTurnDeg: rays.signedTurnDeg },
      parameters: { curveCount: arcs.length, trim: false },
    });

    let project = snapshot.project;
    const createdEntities: CadEntity[] = [];
    const arcIds: string[] = [];
    arcs.forEach((definition, index) => {
      const row = rows[index]!;
      const { arcEntity, sequence } = buildCadCurveArcEntity({
        project,
        definition,
        createdBy: 'MULTIPLE_CURVES_CREATE',
        metadata: {
          sourceLineIds: [first.id, second.id],
          chainIndex: index,
          chainCount: arcs.length,
          floating: row.floating,
          trim: false,
        },
        provenance,
      });
      const appended = appendCurveArcWithSupport({
        project,
        arcEntity,
        sequence,
        createdBy: 'MULTIPLE_CURVES_CREATE',
      });
      project = appended.project;
      createdEntities.push(arcEntity, ...appended.supportEntities);
      arcIds.push(arcEntity.id);
    });

    const nextProject = appendCogoComputation({
      project,
      provenance,
      title: 'Multiple Curves',
      summary,
      rows: [
        { label: 'Curves', value: `${arcs.length}` },
        { label: 'Total delta', value: Math.abs(rays.deltaDeg).toFixed(6), unit: 'deg' },
        { label: 'PC', value: `${outcome.result.pc.x.toFixed(3)}, ${outcome.result.pc.y.toFixed(3)}`, unit: 'm' },
        { label: 'PT', value: `${outcome.result.pt.x.toFixed(3)}, ${outcome.result.pt.y.toFixed(3)}`, unit: 'm' },
      ],
      tables: [
        {
          title: 'Curve chain',
          columns: ['#', 'Radius (m)', 'Delta (deg)', 'Arc (m)', 'Chord (m)', 'Tangent (m)', 'Side', 'Floating'],
          rows: chainTableRows(rows),
        },
      ],
      createdEntities,
    });

    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, arcIds),
      },
      commandState: {
        key: 'MULTIPLE_CURVES_CREATE',
        phase: 'committed',
        prompt: `MULTIPLE_CURVES_CREATE committed with ${arcs.length} curves.`,
      },
      transactionLabel: `MULTIPLE_CURVES_CREATE (${arcs.length})`,
      addedEntityIds: createdEntities.map((entity) => entity.id),
      removedEntityIds: [],
    };
  },
};
