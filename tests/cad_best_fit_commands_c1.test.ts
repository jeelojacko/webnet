/**
 * CAD Best Fit E1 (Worker C) — engine transaction tests.
 *
 * Pins the one-entry atomicity law: each BEST_FIT_* command builds exactly
 * one geometry entity + one COGO computation (+ entity metadata) in a single
 * runCadCommand entry, selects the created entity, and leaves zero mutation
 * behind when the fit fails closed.
 */
import { describe, expect, it } from 'vitest';

import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { buildCadPropertiesPanelState } from '../src/engine/cad/cadProperties';
import type { CadCogoComputation } from '../src/engine/cad/cadCogoTypes';
import type {
  CadArcEntity,
  CadEntity,
  CadParabolaEntity,
  CadPolylineEntity,
  CadProject,
  CadSurveyPointEntity,
} from '../src/engine/cad/cadTypes';
import type { CadCommand } from '../src/engine/cad/cadTransactions.types';
import {
  createCadHistoryState,
  redoCadHistory,
  runCadCommand,
  undoCadHistory,
  type CadHistoryState,
} from '../src/engine/cad/cadUndoRedo';

const blankProject = (): CadProject => createBlankCadProject({ name: 'best fit', units: 'm' });

const surveyPoint = (id: string, stationId: string, x: number, y: number): CadSurveyPointEntity => ({
  id,
  type: 'survey-point',
  layerId: 'general',
  visible: true,
  locked: false,
  x,
  y,
  stationId,
  pointClass: 'free',
  source: 'parsed-input',
});

const projectWithSurvey = (...points: CadSurveyPointEntity[]): CadProject => ({
  ...blankProject(),
  entities: [...points],
});

const lineSamples = () => [
  { x: 0, y: 0.1, label: 'P1' },
  { x: 10, y: 10.2, label: 'P2' },
  { x: 20, y: 19.8, label: 'P3' },
  { x: 30, y: 30.3, label: 'P4' },
];

const arcSamples = () => [
  { x: 10, y: 0, label: 'P1' },
  { x: 7.07, y: 7.07, label: 'P2' },
  { x: 0, y: 10, label: 'P3' },
  { x: -7.07, y: 7.07, label: 'P4' },
];

const parabolaSamples = () => [
  { x: 0, y: 0, label: 'P1' },
  { x: 1, y: 1, label: 'P2' },
  { x: 2, y: 4, label: 'P3' },
  { x: 3, y: 9, label: 'P4' },
  { x: 4, y: 16, label: 'P5' },
  { x: 5, y: 25, label: 'P6' },
];

const run = (command: CadCommand, project?: CadProject): CadHistoryState =>
  runCadCommand(createCadHistoryState(project ?? blankProject()), command);

const computationsOf = (project: CadProject): CadCogoComputation[] =>
  project.cogoComputations ?? [];

const onlyEntityOfType = <T extends CadProject['entities'][number]['type']>(
  project: CadProject,
  type: T,
): Extract<CadProject['entities'][number], { type: T }> => {
  const found = project.entities.filter((entity) => entity.type === type);
  expect(found).toHaveLength(1);
  return found[0] as Extract<CadProject['entities'][number], { type: T }>;
};

describe('best-fit line transaction', () => {
  it('commits one open 2-vertex polyline with no segment metadata', () => {
    const history = run({ key: 'BEST_FIT_LINE', samples: lineSamples() });
    const entity = onlyEntityOfType(history.present.project, 'polyline') as CadPolylineEntity;
    expect(entity.vertices).toHaveLength(2);
    expect(entity.closed).toBe(false);
    expect(entity.vertexLabels).toEqual(['', '']);
    expect(entity).not.toHaveProperty('segmentGeometry');
    expect(entity).not.toHaveProperty('segmentWidths');
    expect(entity.metadata?.createdBy).toBe('BEST_FIT_LINE');
  });

  it('is atomic: one history entry, one entity, one computation, entity selected', () => {
    const before = createCadHistoryState(blankProject());
    const history = runCadCommand(before, { key: 'BEST_FIT_LINE', samples: lineSamples() });
    expect(history.undoStack).toHaveLength(1);
    expect(history.redoStack).toHaveLength(0);
    expect(history.present.project.entities).toHaveLength(1);
    expect(computationsOf(history.present.project)).toHaveLength(1);
    const entity = onlyEntityOfType(history.present.project, 'polyline');
    expect(history.present.selection.selectedEntityIds).toEqual([entity.id]);
  });

  it('reports method, counts, geometry, and a residual row per sample', () => {
    const history = run({ key: 'BEST_FIT_LINE', samples: lineSamples() });
    const computation = computationsOf(history.present.project)[0]!;
    expect(computation.toolKey).toBe('BEST_FIT_LINE');
    const labels = computation.report.rows.map((row) => row.label);
    for (const required of ['Method', 'Sample count', 'RMS residual', 'Max |residual|', 'Azimuth', 'Bearing', 'Span']) {
      expect(labels).toContain(required);
    }
    expect(computation.report.rows.find((row) => row.label === 'Sample count')?.value).toBe('4');
    expect(computation.report.tables).toHaveLength(1);
    const table = computation.report.tables![0]!;
    expect(table.columns).toEqual(['Sample', 'Easting', 'Northing', 'Residual (m)', 'Closest E', 'Closest N']);
    expect(table.rows).toHaveLength(4);
    expect(table.rows.map((row) => row[0])).toEqual(['P1', 'P2', 'P3', 'P4']);
  });

  it('round-trips undo then redo', () => {
    const history = run({ key: 'BEST_FIT_LINE', samples: lineSamples() });
    const undone = undoCadHistory(history);
    expect(undone.present.project.entities).toHaveLength(0);
    expect(computationsOf(undone.present.project)).toHaveLength(0);
    const redone = redoCadHistory(undone);
    expect(redone.present.project.entities).toHaveLength(1);
    expect(computationsOf(redone.present.project)).toHaveLength(1);
  });

  it('commits onto the current layer', () => {
    const project = blankProject();
    const layerId = project.layers[1]?.id ?? project.layers[0]!.id;
    const history = run(
      { key: 'BEST_FIT_LINE', samples: lineSamples() },
      { ...project, currentLayerId: layerId },
    );
    expect(onlyEntityOfType(history.present.project, 'polyline').layerId).toBe(layerId);
  });

  it('snapshots provenance inputs and source ids', () => {
    const project = projectWithSurvey(surveyPoint('pt-a', 'A1', 0, 0), surveyPoint('pt-b', 'A2', 10, 0));
    const samples = [
      { x: 0, y: 0, label: 'A1', sourceEntityId: 'pt-a' },
      { x: 10, y: 0.5, label: 'A2', sourceEntityId: 'pt-b' },
      { x: 20, y: -0.4, label: 'P3' },
    ];
    const history = run({ key: 'BEST_FIT_LINE', samples }, project);
    const computation = computationsOf(history.present.project)[0]!;
    expect(computation.provenance.sourceEntityIds).toEqual(['pt-a', 'pt-b']);
    expect(computation.provenance.sourcePointIds).toEqual(['A1', 'A2']);
    const snapshot = computation.provenance.inputs['samples'] as typeof samples;
    expect(snapshot).toEqual(samples);
    expect(snapshot).not.toBe(samples);
    const entity = onlyEntityOfType(history.present.project, 'polyline');
    const meta = entity.metadata?.['cogo'] as { toolKey: string; provenanceId: string };
    expect(meta.toolKey).toBe('BEST_FIT_LINE');
    expect(meta.provenanceId).toBe(computation.provenance.id);
  });
});

describe('best-fit arc transaction', () => {
  it('commits one native arc entity with the fitted span', () => {
    const history = run({ key: 'BEST_FIT_ARC', samples: arcSamples() });
    const entity = onlyEntityOfType(history.present.project, 'arc') as CadArcEntity;
    expect(entity.centerX).toBeCloseTo(0, 1);
    expect(entity.centerY).toBeCloseTo(0, 1);
    expect(entity.radius).toBeCloseTo(10, 1);
    expect(entity.endAngleDeg).toBeGreaterThan(entity.startAngleDeg);
    expect(entity.metadata?.createdBy).toBe('BEST_FIT_ARC');
  });

  it('is atomic with arc rows and a per-sample residual table', () => {
    const before = createCadHistoryState(blankProject());
    const history = runCadCommand(before, { key: 'BEST_FIT_ARC', samples: arcSamples() });
    expect(history.undoStack).toHaveLength(1);
    expect(history.present.project.entities).toHaveLength(1);
    expect(computationsOf(history.present.project)).toHaveLength(1);
    const computation = computationsOf(history.present.project)[0]!;
    const labels = computation.report.rows.map((row) => row.label);
    for (const required of ['Method', 'Sample count', 'RMS residual', 'Max |residual|', 'Center E', 'Center N', 'Radius', 'Start angle', 'End angle', 'Sweep', 'Arc length']) {
      expect(labels).toContain(required);
    }
    expect(computation.report.rows.find((row) => row.label === 'Sample count')?.value).toBe('4');
    expect(computation.report.tables![0]!.rows).toHaveLength(4);
    const entity = onlyEntityOfType(history.present.project, 'arc');
    expect(history.present.selection.selectedEntityIds).toEqual([entity.id]);
  });

  it('round-trips undo then redo', () => {
    const history = run({ key: 'BEST_FIT_ARC', samples: arcSamples() });
    const undone = undoCadHistory(history);
    expect(undone.present.project.entities).toHaveLength(0);
    const redone = redoCadHistory(undone);
    expect(redone.present.project.entities).toHaveLength(1);
  });
});

describe('best-fit parabola transaction', () => {
  it('commits one parabola entity projected from the canonical fit', () => {
    const history = run({ key: 'BEST_FIT_PARABOLA', samples: parabolaSamples() });
    const entity = onlyEntityOfType(history.present.project, 'parabola') as CadParabolaEntity;
    expect(entity.vertexX).toBeCloseTo(0, 0);
    expect(entity.vertexY).toBeCloseTo(0, 0);
    expect(entity.focalLength).toBeCloseTo(0.25, 1);
    expect(entity.tEnd).toBeGreaterThan(entity.tStart);
    expect(entity.metadata?.createdBy).toBe('BEST_FIT_PARABOLA');
  });

  it('is atomic with parabola rows and a per-sample residual table', () => {
    const before = createCadHistoryState(blankProject());
    const history = runCadCommand(before, { key: 'BEST_FIT_PARABOLA', samples: parabolaSamples() });
    expect(history.undoStack).toHaveLength(1);
    expect(history.present.project.entities).toHaveLength(1);
    expect(computationsOf(history.present.project)).toHaveLength(1);
    const computation = computationsOf(history.present.project)[0]!;
    const labels = computation.report.rows.map((row) => row.label);
    for (const required of ['Method', 'Sample count', 'RMS residual', 'Max |residual|', 'Vertex E', 'Vertex N', 'Axis azimuth', 'Focal length', 't range', 'Curve length']) {
      expect(labels).toContain(required);
    }
    expect(computation.report.rows.find((row) => row.label === 'Sample count')?.value).toBe('6');
    expect(computation.report.tables![0]!.rows).toHaveLength(6);
    const entity = onlyEntityOfType(history.present.project, 'parabola');
    expect(history.present.selection.selectedEntityIds).toEqual([entity.id]);
  });

  it('round-trips undo then redo', () => {
    const history = run({ key: 'BEST_FIT_PARABOLA', samples: parabolaSamples() });
    const undone = undoCadHistory(history);
    expect(undone.present.project.entities).toHaveLength(0);
    const redone = redoCadHistory(undone);
    expect(redone.present.project.entities).toHaveLength(1);
  });
});

describe('best-fit source-point attribution', () => {
  const surveyPoints = [surveyPoint('pt-a', 'A1', 0, 0), surveyPoint('pt-b', 'A2', 10, 10)];

  it('keeps an all-free-pick fit free of source points while retaining P<n> labels', () => {
    const samples = lineSamples();
    const history = run({ key: 'BEST_FIT_LINE', samples }, projectWithSurvey(...surveyPoints));
    const computation = computationsOf(history.present.project)[0]!;
    expect(computation.provenance.sourcePointIds).toEqual([]);
    expect(computation.provenance.sourceEntityIds).toEqual([]);
    const snapshot = computation.provenance.inputs['samples'] as Array<{ label: string }>;
    expect(snapshot.map((entry) => entry.label)).toEqual(['P1', 'P2', 'P3', 'P4']);
    expect(computation.report.tables![0]!.rows.map((row) => row[0])).toEqual(['P1', 'P2', 'P3', 'P4']);
    // The Properties "Source points" row reads metadata.cogo.sourcePointIds, so
    // the display stays gated with the provenance field.
    const entity = onlyEntityOfType(history.present.project, 'polyline');
    const meta = entity.metadata?.['cogo'] as { sourcePointIds: string[] };
    expect(meta.sourcePointIds).toEqual([]);
    const panel = buildCadPropertiesPanelState(history.present.project, [entity]);
    expect(panel?.mode).toBe('single');
    if (!panel || panel.mode !== 'single') throw new Error('best-fit properties missing');
    expect(panel.entity.properties.find((row) => row.label === 'Source points')).toBeUndefined();
  });

  it('keeps only true survey station ids for a mixed survey + free fit', () => {
    const samples = [
      { x: 0, y: 0, label: 'A1', sourceEntityId: 'pt-a' },
      { x: 10, y: 10, label: 'A2', sourceEntityId: 'pt-b' },
      { x: 20, y: 19.5, label: 'P1' },
      { x: 30, y: 30.1, label: 'P2' },
    ];
    const history = run({ key: 'BEST_FIT_LINE', samples }, projectWithSurvey(...surveyPoints));
    const computation = computationsOf(history.present.project)[0]!;
    expect(computation.provenance.sourcePointIds).toEqual(['A1', 'A2']);
    expect(computation.provenance.sourceEntityIds).toEqual(['pt-a', 'pt-b']);
    expect(computation.report.tables![0]!.rows.map((row) => row[0])).toEqual(['A1', 'A2', 'P1', 'P2']);
  });

  it('does not surface P<n> labels when a non-survey entity is the snap source', () => {
    const project: CadProject = {
      ...blankProject(),
      entities: [
        {
          id: 'line-1',
          type: 'line',
          layerId: 'general',
          visible: true,
          locked: false,
          fromStationId: 'A1',
          toStationId: 'A2',
        } as unknown as CadEntity,
      ],
    };
    const samples = [
      { x: 0, y: 0, label: 'P1', sourceEntityId: 'line-1' },
      { x: 10, y: 10.2, label: 'P2', sourceEntityId: 'line-1' },
      { x: 20, y: 19.8, label: 'P3' },
      { x: 30, y: 30.3, label: 'P4' },
    ];
    const history = run({ key: 'BEST_FIT_LINE', samples }, project);
    const computation = computationsOf(history.present.project)[0]!;
    expect(computation.provenance.sourcePointIds).toEqual([]);
    expect(computation.provenance.sourceEntityIds).toEqual(['line-1']);
  });

  it('gates arc and parabola source points the same way', () => {
    const arcHistory = run(
      {
        key: 'BEST_FIT_ARC',
        samples: [
          { x: 10, y: 0, label: 'A1', sourceEntityId: 'pt-a' },
          { x: 7.07, y: 7.07, label: 'P1' },
          { x: 0, y: 10, label: 'P2' },
          { x: -7.07, y: 7.07, label: 'P3' },
        ],
      },
      projectWithSurvey(...surveyPoints),
    );
    expect(computationsOf(arcHistory.present.project)[0]!.provenance.sourcePointIds).toEqual(['A1']);
    const parabolaHistory = run(
      {
        key: 'BEST_FIT_PARABOLA',
        samples: [
          { x: 0, y: 0, label: 'P1' },
          { x: 1, y: 1, label: 'P2' },
          { x: 2, y: 4, label: 'P3' },
          { x: 3, y: 9, label: 'P4' },
          { x: 4, y: 16, label: 'P5' },
          { x: 5, y: 25, label: 'P6' },
        ],
      },
      projectWithSurvey(...surveyPoints),
    );
    expect(computationsOf(parabolaHistory.present.project)[0]!.provenance.sourcePointIds).toEqual([]);
  });
});

describe('best-fit failure leaves zero mutation', () => {
  it('refuses a collinear arc without touching history', () => {
    const before = createCadHistoryState(blankProject());
    const after = runCadCommand(before, {
      key: 'BEST_FIT_ARC',
      samples: [
        { x: 0, y: 0, label: 'P1' },
        { x: 10, y: 0, label: 'P2' },
        { x: 20, y: 0, label: 'P3' },
      ],
    });
    expect(after).toBe(before);
    expect(after.present.project.entities).toHaveLength(0);
    expect(computationsOf(after.present.project)).toHaveLength(0);
    expect(after.undoStack).toHaveLength(0);
  });

  it('refuses a line-like parabola without touching history', () => {
    const before = createCadHistoryState(blankProject());
    const after = runCadCommand(before, {
      key: 'BEST_FIT_PARABOLA',
      samples: [0, 1, 2, 3, 4, 5].map((index) => ({ x: index * 10, y: index * 10, label: `P${index + 1}` })),
    });
    expect(after).toBe(before);
    expect(after.undoStack).toHaveLength(0);
  });

  it('refuses below-minimum samples without touching history', () => {
    const before = createCadHistoryState(blankProject());
    const after = runCadCommand(before, {
      key: 'BEST_FIT_LINE',
      samples: [{ x: 0, y: 0, label: 'P1' }],
    });
    expect(after).toBe(before);
    expect(after.undoStack).toHaveLength(0);
  });
});
