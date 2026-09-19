// Phase 18O workspace seam: snapshot facts, op guards, and creation flows
// (fixed anchors) through the real engine history.
import { describe, expect, it } from 'vitest';

import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { backfillCadAnnotationTables } from '../src/engine/cad/annotation/cadAnnotationPersistence';
import { createCadHistoryState, runCadCommand, type CadHistoryState } from '../src/engine/cad/cadUndoRedo';
import type { CadLineEntity } from '../src/engine/cad/cadTypes';
import type { CommandPoint, CommandSession } from '../src/hooks/surveyCad/useSurveyCadCommandTypes';
import type { ReplaceSession } from '../src/hooks/surveyCad/useSurveyCadConsumePoint.types';
import { buildCadAnnotationSnapshot } from '../src/hooks/surveyCad/surveyCadAnnotationSnapshot';
import { applyCadAnnotationUiOp } from '../src/hooks/surveyCad/surveyCadAnnotationOps';
import {
  commitAnnotationSession,
  handleAnnotationPointPick,
} from '../src/hooks/surveyCad/useSurveyCadAnnotationSessions';

const line = (id: string): CadLineEntity => ({
  id,
  type: 'line',
  layerId: 'general',
  visible: true,
  locked: false,
  fromStationId: 'A',
  toStationId: 'B',
  fromX: 0,
  fromY: 0,
  toX: 10,
  toY: 0,
  sourceObservationIds: [],
});

const point = (x: number, y: number, extra: Partial<CommandPoint> = {}): CommandPoint => ({
  x,
  y,
  label: `${x},${y}`,
  ...extra,
});

/** Drive picks through a session, applying engine commits to one history. */
const drivePicks = (
  history: CadHistoryState,
  session: CommandSession,
  picks: CommandPoint[],
): { history: CadHistoryState; session: CommandSession | null } => {
  let current = history;
  let active: CommandSession | null = session;
  const replaceSession: ReplaceSession = (next) => {
    active = next;
  };
  for (const pick of picks) {
    if (!active) break;
    handleAnnotationPointPick({
      current: active,
      point: pick,
      project: current.present.project,
      applyHistoryUpdate: (updater) => {
        current = updater(current);
      },
      replaceSession,
    });
  }
  return { history: current, session: active };
};

describe('18o annotation workspace seam', () => {
  it('publishes seeded style tables + scale + arrow definitions', () => {
    const project = backfillCadAnnotationTables(createBlankCadProject({ name: 'seam', units: 'm' }));
    const snapshot = buildCadAnnotationSnapshot(project, []);
    expect(snapshot.annotationScaleDenominator).toBe(500);
    expect(snapshot.textStyles).toHaveLength(2);
    expect(snapshot.dimensionStyles).toHaveLength(1);
    expect(snapshot.leaderStyles).toHaveLength(1);
    expect(snapshot.bearingLabelStyles).toHaveLength(1);
    expect(snapshot.curveLabelStyles).toHaveLength(1);
  });

  it('creates a text style and blocks referenced delete + duplicate rename', () => {
    const project = backfillCadAnnotationTables(createBlankCadProject({ name: 'seam', units: 'm' }));
    const created = applyCadAnnotationUiOp(project, { kind: 'text-style-create', name: 'QA' });
    expect(created.applied).toBe(true);
    expect(created.project.styleLibrary?.textStyles).toHaveLength(4); // legacy + 2 seeds + QA
    const snapshot = buildCadAnnotationSnapshot(created.project, []);
    expect(snapshot.textStyles).toHaveLength(3);

    const seedId = snapshot.textStyles[0]!.id;
    expect(
      applyCadAnnotationUiOp(created.project, { kind: 'text-style-delete', styleId: seedId }).reason,
    ).toBe('STYLE_IN_USE'); // backed by the seeded dimension/leader/label styles
    expect(
      applyCadAnnotationUiOp(created.project, {
        kind: 'text-style-rename',
        styleId: seedId,
        name: snapshot.textStyles[1]!.name,
      }).reason,
    ).toBe('DUPLICATE_NAME');
  });

  it('rejects entity edits on locked layers with LAYER_LOCKED', () => {
    let project = backfillCadAnnotationTables(createBlankCadProject({ name: 'seam', units: 'm' }));
    const history = createCadHistoryState(project);
    const committed = runCadCommand(history, { key: 'CREATE_MTEXT', x: 1, y: 2, text: 'HI' });
    project = committed.present.project;
    const entityId = project.entities[0]!.id;
    const locked = applyCadAnnotationUiOp(
      {
        ...project,
        layers: project.layers.map((layer) =>
          layer.id === 'general' ? { ...layer, locked: true } : layer,
        ),
      },
      { kind: 'mtext-update', entityId, patch: { text: 'BLOCKED' } },
    );
    expect(locked.applied).toBe(false);
    expect(locked.reason).toBe('LAYER_LOCKED');
  });

  it('MTEXT: pick + lines + Escape commits one multiline entity', () => {
    let current = createCadHistoryState(
      backfillCadAnnotationTables(createBlankCadProject({ name: 'seam', units: 'm' })),
    );
    let active: CommandSession | null = { key: 'MTEXT', inputValue: '', point: null, lines: [] };
    const replaceSession: ReplaceSession = (next) => {
      active = next;
    };
    const applyHistoryUpdate = (updater: (_history: CadHistoryState) => CadHistoryState): void => {
      current = updater(current);
    };
    handleAnnotationPointPick({
      current: active!,
      point: point(4, 5),
      project: current.present.project,
      applyHistoryUpdate,
      replaceSession,
    });
    active = active && { ...active, lines: ['LINE ONE', 'LINE TWO'] };
    expect(commitAnnotationSession({ session: active!, applyHistoryUpdate, replaceSession })).toBe(true);
    expect(active).toBeNull();
    const created = current.present.project.entities.find((entity) => entity.type === 'mtext');
    expect(created).toMatchObject({ x: 4, y: 5, text: 'LINE ONE\nLINE TWO' });
  });

  it('DIMLINEAR: three picks commit a fixed-anchor dimension', () => {
    const history = createCadHistoryState(
      backfillCadAnnotationTables(createBlankCadProject({ name: 'seam', units: 'm' })),
    );
    const { history: next, session } = drivePicks(
      history,
      { key: 'DIMLINEAR', inputValue: '', points: [] },
      [point(0, 0), point(10, 0), point(5, 4)],
    );
    expect(session).toBeNull();
    const dimension = next.present.project.entities.find((entity) => entity.type === 'dimension');
    expect(dimension).toBeDefined();
    expect(dimension && dimension.type === 'dimension' && dimension.anchors).toHaveLength(2);
  });

  it('BDLABEL: two picks on a snapped line commit a bearing label', () => {
    const base = backfillCadAnnotationTables(createBlankCadProject({ name: 'seam', units: 'm' }));
    base.entities = [line('line-1')];
    const history = createCadHistoryState(base);
    const { history: next, session } = drivePicks(
      history,
      { key: 'BDLABEL', inputValue: '', points: [], sourceEntityId: null },
      [point(0, 0, { snapSourceEntityId: 'line-1', snapKind: 'endpoint' }), point(10, 0)],
    );
    expect(session).toBeNull();
    const label = next.present.project.entities.find((entity) => entity.type === 'bearing-label');
    expect(label).toMatchObject({ sourceEntityId: 'line-1' });
  });
});
