/**
 * Finding 1 regression — the SUBDIVIDE_CURVE visible report must count
 * interior marker survey-points only. The engine transaction emits one
 * survey-point PLUS one anchored text label per point, so any raw entity
 * delta (or label count) double-reports the visible count.
 */
import { describe, expect, it } from 'vitest';

import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { appendCadProjectEntities } from '../src/engine/cad/cadProjectState';
import {
  createCadHistoryState,
  undoCadHistory,
} from '../src/engine/cad/cadUndoRedo';
import type { CadArcEntity, CadEntity, CadProject } from '../src/engine/cad/cadTypes';
import type { CommandSession } from '../src/hooks/surveyCad/useSurveyCadCommandTypes';
import { handleSurveyCadCurveSubmit } from '../src/hooks/surveyCad/useSurveyCadCurveSubmit';

interface ReportCapture {
  toolKey: string;
  title: string;
  summary: string;
  rows: Array<{ label: string; value: string; unit?: string }>;
}

const makeArc = (): CadArcEntity => ({
  id: 'arc-sub',
  type: 'arc',
  layerId: 'general',
  visible: true,
  locked: false,
  centerX: 0,
  centerY: 0,
  radius: 100,
  startAngleDeg: 0,
  endAngleDeg: 90,
});

const arcProject = (): CadProject =>
  appendCadProjectEntities(createBlankCadProject({ name: 'subdivide-submit', units: 'm' }), [makeArc()]);

const submitSubdivide = (project: CadProject, inputValue: string) => {
  let history = createCadHistoryState(project);
  let replaced: CommandSession | null | undefined;
  const reports: ReportCapture[] = [];
  const session: CommandSession = { key: 'SUBDIVIDE_CURVE', inputValue, arc: makeArc() };
  const handled = handleSurveyCadCurveSubmit({
    applyHistoryUpdate: (updater) => {
      history = updater(history);
    },
    commitArcDefinition: () => false,
    consumePoint: () => {},
    publishReport: (toolKey, title, summary, rows) => {
      reports.push({ toolKey, title, summary, rows });
    },
    replaceSession: (next) => {
      replaced = next;
    },
    session,
  });
  return { handled, history, replaced, reports };
};

const byType = (project: CadProject, type: CadEntity['type']): CadEntity[] =>
  project.entities.filter((entity) => entity.type === type);

const assertOneMarkerPoint = (inputValue: string) => {
  const project = arcProject();
  const { handled, history, replaced, reports } = submitSubdivide(project, inputValue);
  expect(handled).toBe(true);
  expect(replaced).toBeNull();
  expect(reports).toHaveLength(1);
  const report = reports[0]!;
  expect(report.toolKey).toBe('SUBDIVIDE_CURVE');
  expect(report.title).toBe('Curve Subdivision');
  expect(report.summary).toContain('Created 1 subdivision marker point');
  expect(report.summary).not.toContain('2 subdivision');
  expect(report.rows).toContainEqual({ label: 'Marker Points', value: '1' });

  // Engine truth: exactly one survey point plus exactly one anchored label.
  expect(byType(history.present.project, 'survey-point')).toHaveLength(1);
  expect(byType(history.present.project, 'text')).toHaveLength(1);
  // The naive entity delta would have been 2 (point + label); the fix reports 1.
  expect(history.present.project.entities.length - project.entities.length).toBe(2);
  expect(history.present.project.cogoComputations.at(-1)?.provenance.parameters).toMatchObject({
    pointCount: 1,
  });

  // One atomic undo entry restores the project exactly.
  expect(history.undoStack).toHaveLength(1);
  const undone = undoCadHistory(history);
  expect(undone.present.project.entities).toEqual(project.entities);
  expect(undone.undoStack).toHaveLength(0);
};

describe('SUBDIVIDE_CURVE visible marker count (Finding 1 regression)', () => {
  it('EQUAL,2 reports one marker point (never point+label) and undo restores exactly', () => {
    assertOneMarkerPoint('EQUAL,2');
  });

  it('CHORD,100 reports one marker point and undo restores exactly', () => {
    assertOneMarkerPoint('CHORD,100');
  });

  it('rejected subdivision (empty interior) stays active with zero mutation and no report', () => {
    const project = arcProject();
    const { history, replaced, reports } = submitSubdivide(project, 'CHORD,500');
    expect(replaced).not.toBeNull();
    expect(replaced?.resultText).toMatch(/no interior marker points/);
    expect(history.present.project.entities).toEqual(project.entities);
    expect(history.undoStack).toHaveLength(0);
    expect(reports).toHaveLength(0);
  });
});
