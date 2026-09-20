// Phase 18R.1 Finding A: production PROJECTTRANSFORM must move draft
// model-space refs (viewport model-centers, label anchors) atomically with
// the project in ONE undo entry. These oracles run through the user-facing
// history seam (runCadCommand / undoCadHistory / redoCadHistory), not the
// engine helper directly. Agent tier: fast.
import { describe, expect, it } from 'vitest';

import { createBlankDraftDocument } from '../src/engine/cad/cadDraftTypes';
import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { addSheetToDraft, addViewportToSheet, createPlanSheet } from '../src/engine/cad/cadSheets';
import type { DraftDocument } from '../src/engine/cad/cadDraftTypes';
import type { HelmertControlPair } from '../src/engine/cad/cadHelmert2D';
import type { ProjectTransformRequest } from '../src/engine/cad/cadProjectTransform';
import {
  createCadHistoryState,
  redoCadHistory,
  runCadCommand,
  undoCadHistory,
} from '../src/engine/cad/cadUndoRedo';
import type { CadEntity, CadProject } from '../src/engine/cad/cadTypes';

const LAYER = 'L';
const base = { layerId: LAYER, visible: true, locked: false } as const;

// Pure translation (+1000 E, -500 N) via two RIGID pairs. Expected values
// below are hardcoded arithmetic — independent of the transform kernel.
const DX = 1000;
const DY = -500;
const PAIRS: HelmertControlPair[] = [
  { sourceE: 0, sourceN: 0, targetE: DX, targetN: DY },
  { sourceE: 10000, sourceN: 5000, targetE: 10000 + DX, targetN: 5000 + DY },
];
const REQUEST: ProjectTransformRequest = { kind: 'HELMERT_2D', mode: 'RIGID', pairs: PAIRS };

const PX = 2000000;
const PY = 7000000;
const LX = 2000100;
const LY = 7000200;

const projectWithPoint = (): CadProject => {
  const project = createBlankCadProject({ name: 'T18R1', units: 'm' });
  project.layers = [{ id: LAYER, name: 'Test', color: '#ffffff', visible: true, locked: false, role: 'planning' }];
  project.currentLayerId = LAYER;
  const point: CadEntity = {
    ...base, id: 'P1', type: 'survey-point', stationId: 'P1', x: PX, y: PY, z: 0,
    pointClass: 'free', source: 'parsed-input',
  };
  project.entities = [point];
  return project;
};

const draftFixture = (projectId: string): DraftDocument => {
  let draft = createBlankDraftDocument({ projectId });
  draft = addSheetToDraft(draft, createPlanSheet({ name: 'S1' }));
  const sheetId = draft.sheets[0]!.id;
  draft = addViewportToSheet(draft, sheetId, {
    name: 'V1',
    modelCenterX: PX,
    modelCenterY: PY,
    scaleDenominator: 500,
    rotationDeg: 15,
    paperXmm: 20,
    paperYmm: 15,
    paperWidthMm: 200,
    paperHeightMm: 150,
  });
  return {
    ...draft,
    labels: [
      {
        id: 'draft-label-1',
        text: 'P1',
        xModel: LX,
        yModel: LY,
        layerId: LAYER,
        heightMm: 2.5,
        rotationDeg: 30,
        viewportOverrides: { vp1: { dxMm: 1, visible: true } },
      },
    ],
  };
};

const pointOf = (project: CadProject): CadEntity => {
  const entity = project.entities.find((candidate) => candidate.id === 'P1');
  if (!entity) throw new Error('missing point P1');
  return entity;
};

describe('PROJECTTRANSFORM draft atomicity (18R.1 Finding A)', () => {
  it('transforms project point, viewport center, and label anchor in one undo entry', () => {
    const project = projectWithPoint();
    const draft = draftFixture(project.id);
    const history = createCadHistoryState(project, []);
    const seeded = { ...history, present: { ...history.present, draft } };
    const committed = runCadCommand(seeded, { key: 'PROJECTTRANSFORM', request: REQUEST });

    expect(committed).not.toBe(seeded);
    expect(committed.undoStack).toHaveLength(1);
    expect(committed.undoStack[0]?.transaction.commandKey).toBe('PROJECTTRANSFORM');

    // Project point moved by the independent expectation.
    const moved = pointOf(committed.present.project);
    if (moved.type !== 'survey-point') throw new Error('type');
    expect(moved.x).toBeCloseTo(PX + DX, 9);
    expect(moved.y).toBeCloseTo(PY + DY, 9);

    // Draft moved with it, through the same matrix.
    const nextDraft = committed.present.draft;
    expect(nextDraft).toBeDefined();
    const viewport = nextDraft!.sheets[0]!.viewports[0]!;
    expect(viewport.modelCenterX).toBeCloseTo(PX + DX, 9);
    expect(viewport.modelCenterY).toBeCloseTo(PY + DY, 9);
    const label = nextDraft!.labels[0]!;
    expect(label.xModel).toBeCloseTo(LX + DX, 9);
    expect(label.yModel).toBeCloseTo(LY + DY, 9);

    // Paper/presentation fields untouched.
    expect(viewport.scaleDenominator).toBe(500);
    expect(viewport.rotationDeg).toBe(15);
    expect(viewport.paperXmm).toBe(20);
    expect(viewport.paperYmm).toBe(15);
    expect(viewport.paperWidthMm).toBe(200);
    expect(viewport.paperHeightMm).toBe(150);
    expect(nextDraft!.sheets[0]!.widthMm).toBe(draft.sheets[0]!.widthMm);
    expect(label.rotationDeg).toBe(30);
    expect(label.heightMm).toBe(2.5);
    expect(label.viewportOverrides).toEqual({ vp1: { dxMm: 1, visible: true } });

    // Undo once restores ALL originals; redo once restores ALL transformed.
    const undone = undoCadHistory(committed);
    expect(pointOf(undone.present.project)).toEqual(pointOf(project));
    expect(undone.present.draft).toEqual(draft);
    const redone = redoCadHistory(undone);
    expect(pointOf(redone.present.project)).toEqual(moved);
    expect(redone.present.draft).toEqual(nextDraft);
  });

  it('without a draft the command still commits project-only (legacy drawings)', () => {
    const project = projectWithPoint();
    const history = createCadHistoryState(project, []);
    const committed = runCadCommand(history, { key: 'PROJECTTRANSFORM', request: REQUEST });
    expect(committed.undoStack).toHaveLength(1);
    const moved = pointOf(committed.present.project);
    if (moved.type !== 'survey-point') throw new Error('type');
    expect(moved.x).toBeCloseTo(PX + DX, 9);
    expect(committed.present.draft).toBeUndefined();
  });

  it('save/reopen round-trips the transformed draft with no double transform', () => {
    const project = projectWithPoint();
    const draft = draftFixture(project.id);
    const history = createCadHistoryState(project, []);
    const seeded = { ...history, present: { ...history.present, draft } };
    const committed = runCadCommand(seeded, { key: 'PROJECTTRANSFORM', request: REQUEST });

    const drawing = {
      ...createBlankCadDrawingDocument({ name: 'T18R1', units: 'm' }),
      project: committed.present.project,
      draft: committed.present.draft,
    };
    const parsed = parseCadDrawingFile(serializeCadDrawingFile(drawing));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('parse failed');
    const viewport = parsed.drawing.draft!.sheets[0]!.viewports[0]!;
    const label = parsed.drawing.draft!.labels[0]!;
    // Exactly-once values survive the round trip (not shifted twice).
    expect(viewport.modelCenterX).toBeCloseTo(PX + DX, 9);
    expect(viewport.modelCenterY).toBeCloseTo(PY + DY, 9);
    expect(label.xModel).toBeCloseTo(LX + DX, 9);
    expect(label.yModel).toBeCloseTo(LY + DY, 9);
    const point = pointOf(parsed.drawing.project);
    if (point.type !== 'survey-point') throw new Error('type');
    expect(point.x).toBeCloseTo(PX + DX, 9);
    // Reserialize stability (value-level): a second save/parse round trip
    // yields the same transformed refs — no drift, no double transform.
    // (Exact-string equality is out of scope: the file parser backfills
    // default project layers on load.)
    const reparsed = parseCadDrawingFile(serializeCadDrawingFile(parsed.drawing));
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) throw new Error('reparse failed');
    const viewport2 = reparsed.drawing.draft!.sheets[0]!.viewports[0]!;
    const label2 = reparsed.drawing.draft!.labels[0]!;
    expect(viewport2.modelCenterX).toBeCloseTo(PX + DX, 9);
    expect(viewport2.modelCenterY).toBeCloseTo(PY + DY, 9);
    expect(label2.xModel).toBeCloseTo(LX + DX, 9);
    expect(label2.yModel).toBeCloseTo(LY + DY, 9);
    expect(pointOf(reparsed.drawing.project)).toEqual(point);
  });
});
