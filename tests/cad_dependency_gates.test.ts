/**
 * Phase 17E — CAD deliverable export gates + WNCAD/undo verification.
 *
 * Agent-tier, fast: pure engine calls only (no DOM).
 */
import { describe, expect, it } from 'vitest';
import { buildExportCenterPreview } from '../src/engine/cad/exportCenter';
import {
  stampAdjustmentDependency,
  summarizeDrawingDependency,
} from '../src/engine/cad/cadAdjustmentDependency';
import {
  buildDraftLabelEntityStatusMap,
  evaluateDraftLabelDependencies,
  hasStaleDerivedDraftLabel,
} from '../src/engine/cad/cadDraftLabelDependency';
import {
  cloneCadDrawingDocument,
  createBlankCadDrawingDocument,
  createBlankCadProject,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { createBlankDraftDocument } from '../src/engine/cad/cadDraftTypes';
import { addSheetToDraft, createPlanSheet } from '../src/engine/cad/cadSheets';
import {
  createCadHistoryState,
  redoCadHistory,
  runCadCommand,
  undoCadHistory,
} from '../src/engine/cad/cadUndoRedo';
import type { CadDrawingDocument, CadEntity } from '../src/engine/cad/cadTypes';
import type { ResultDependencyIdentity } from '../src/engine/resultIntegrity';

const IDENTITY_A: ResultDependencyIdentity = {
  inputFingerprint: 'input-a',
  mathFingerprint: 'math-a',
  exclusionFingerprint: 'excl-a',
};
const IDENTITY_B: ResultDependencyIdentity = { ...IDENTITY_A, inputFingerprint: 'input-b' };

const importedPoint = (id: string, stationId: string): CadEntity => ({
  id,
  type: 'survey-point',
  layerId: 'points',
  visible: true,
  locked: false,
  stationId,
  x: 100,
  y: 200,
  pointClass: 'free',
  source: 'adjustment-result',
});

const manualPoint = (id: string, stationId: string): CadEntity => ({
  ...(importedPoint(id, stationId) as Extract<CadEntity, { type: 'survey-point' }>),
  source: 'parsed-input',
});

const drawingWith = (entities: CadEntity[], labelSourceEntityId?: string | null): CadDrawingDocument => {
  const blank = createBlankCadDrawingDocument({ name: 'Gate Project', units: 'm' });
  const project = createBlankCadProject({ name: 'Gate Project', units: 'm' });
  let draft = createBlankDraftDocument({ projectId: project.id });
  draft = addSheetToDraft(draft, createPlanSheet({ name: 'S1' }));
  if (labelSourceEntityId !== undefined) {
    draft = {
      ...draft,
      labels: [
        {
          id: 'lbl-1',
          text: 'derived label',
          xModel: 0,
          yModel: 0,
          layerId: 'notes',
          ...(labelSourceEntityId === null ? {} : { sourceEntityId: labelSourceEntityId }),
        },
      ],
    };
  }
  return { ...blank, project: { ...project, entities }, draft };
};

const staleDrawing = (): CadDrawingDocument =>
  drawingWith([stampAdjustmentDependency(importedPoint('pt:A', 'A'), IDENTITY_A)]);

describe('export deliverable gates', () => {
  it('blocks coordinate deliverables when stale, allows .wncad native save', () => {
    const drawing = staleDrawing();
    const depOpts = { resultIdentity: IDENTITY_B };
    for (const format of ['dxf-r12', 'dxf-r2000', 'svg', 'pdf', 'landxml'] as const) {
      const outcome = buildExportCenterPreview(drawing, { format }, depOpts);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.message).toContain('CAD_SOURCE_RESULT_REPLACED');
        expect(outcome.message).toContain('Refresh adjusted points');
      }
    }
    expect(buildExportCenterPreview(drawing, { format: 'wncad' }, depOpts).ok).toBe(true);
  });

  it('allows all deliverables when CURRENT', () => {
    const drawing = staleDrawing();
    const depOpts = { resultIdentity: IDENTITY_A };
    for (const format of ['dxf-r12', 'dxf-r2000', 'svg', 'pdf', 'landxml', 'wncad'] as const) {
      expect(buildExportCenterPreview(drawing, { format }, depOpts).ok).toBe(true);
    }
  });

  it('manual-only drawings are always exportable', () => {
    const drawing = drawingWith([manualPoint('pt:M', 'M')]);
    for (const identity of [IDENTITY_B, null]) {
      const depOpts = { resultIdentity: identity };
      for (const format of ['dxf-r12', 'dxf-r2000', 'svg', 'pdf', 'landxml', 'wncad'] as const) {
        expect(buildExportCenterPreview(drawing, { format }, depOpts).ok).toBe(true);
      }
    }
  });

  it('leaves behavior unchanged when gate opts are absent', () => {
    const drawing = staleDrawing();
    // Stale drawing exports fine without opt-in gating (legacy behavior).
    expect(buildExportCenterPreview(drawing, { format: 'dxf-r12' }).ok).toBe(true);
  });
});

describe('draft derived-label gate', () => {
  it('blocks svg/pdf on a stale derived label only; model exports stay allowed', () => {
    const drawing = drawingWith(
      [stampAdjustmentDependency(importedPoint('pt:A', 'A'), IDENTITY_A)],
      'missing-entity',
    );
    const depOpts = { resultIdentity: IDENTITY_A };
    for (const format of ['svg', 'pdf'] as const) {
      const outcome = buildExportCenterPreview(drawing, { format }, depOpts);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.message).toContain('CAD_DERIVED_LABEL_STALE');
    }
    expect(buildExportCenterPreview(drawing, { format: 'dxf-r12' }, depOpts).ok).toBe(true);
    expect(buildExportCenterPreview(drawing, { format: 'landxml' }, depOpts).ok).toBe(true);
  });

  it('static text and CURRENT-sourced labels do not block sheets', () => {
    const depOpts = { resultIdentity: IDENTITY_A };
    const derived = drawingWith(
      [stampAdjustmentDependency(importedPoint('pt:A', 'A'), IDENTITY_A)],
      'pt:A',
    );
    expect(buildExportCenterPreview(derived, { format: 'svg' }, depOpts).ok).toBe(true);
    const statik = drawingWith(
      [stampAdjustmentDependency(importedPoint('pt:A', 'A'), IDENTITY_A)],
      null,
    );
    expect(buildExportCenterPreview(statik, { format: 'svg' }, depOpts).ok).toBe(true);
  });

  it('evaluates labels purely: static stays MANUAL, missing source is STALE', () => {
    const evaluated = evaluateDraftLabelDependencies(
      [
        { id: 's', text: 'static', xModel: 0, yModel: 0, layerId: 'notes' },
        { id: 'd', text: 'derived', xModel: 0, yModel: 0, layerId: 'notes', sourceEntityId: 'gone' },
      ],
      new Map(),
    );
    expect(evaluated[0]).toMatchObject({ status: 'MANUAL', reason: 'CAD_NO_DEPENDENCY' });
    expect(evaluated[1]).toMatchObject({ status: 'STALE', reason: 'CAD_DERIVED_LABEL_STALE' });
    expect(hasStaleDerivedDraftLabel(evaluated)).toBe(true);
    expect(hasStaleDerivedDraftLabel([evaluated[0]!])).toBe(false);
  });
});

describe('wncad round-trip dependency matrix', () => {
  const roundTrip = (drawing: CadDrawingDocument): CadDrawingDocument => {
    const parsed = parseCadDrawingFile(serializeCadDrawingFile(drawing));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('unreachable');
    return parsed.drawing;
  };

  it('CURRENT stays CURRENT with the same identity', () => {
    const drawing = staleDrawing();
    const before = summarizeDrawingDependency(drawing.project, IDENTITY_A);
    expect(before.status).toBe('CURRENT');
    const after = summarizeDrawingDependency(roundTrip(drawing).project, IDENTITY_A);
    expect(after).toEqual(before);
  });

  it('STALE with a changed identity survives the round trip', () => {
    const drawing = staleDrawing();
    const before = summarizeDrawingDependency(drawing.project, IDENTITY_B);
    expect(before.status).toBe('STALE');
    expect(summarizeDrawingDependency(roundTrip(drawing).project, IDENTITY_B)).toEqual(before);
  });

  it('no result is STALE for stamped entities', () => {
    const drawing = staleDrawing();
    const before = summarizeDrawingDependency(drawing.project, null);
    expect(before.status).toBe('STALE');
    expect(summarizeDrawingDependency(roundTrip(drawing).project, null)).toEqual(before);
  });

  it('legacy doc without stamps is NEEDS_REVIEW', () => {
    const drawing = drawingWith([importedPoint('pt:A', 'A')]);
    const before = summarizeDrawingDependency(drawing.project, IDENTITY_A);
    expect(before.status).toBe('NEEDS_REVIEW');
    expect(before.reasons).toContain('CAD_LEGACY_DEPENDENCY_UNKNOWN');
    expect(summarizeDrawingDependency(roundTrip(drawing).project, IDENTITY_A)).toEqual(before);
  });

  it('manual-only legacy stays MANUAL_ONLY and exportable', () => {
    const drawing = drawingWith([manualPoint('pt:M', 'M')]);
    const before = summarizeDrawingDependency(drawing.project, IDENTITY_B);
    expect(before.status).toBe('MANUAL_ONLY');
    const revived = roundTrip(drawing);
    expect(summarizeDrawingDependency(revived.project, IDENTITY_B)).toEqual(before);
    const depOpts = { resultIdentity: IDENTITY_B };
    expect(buildExportCenterPreview(revived, { format: 'dxf-r12' }, depOpts).ok).toBe(true);
    expect(buildExportCenterPreview(revived, { format: 'wncad' }, depOpts).ok).toBe(true);
  });

  it('clone preserves adjustment stamps', () => {
    const drawing = staleDrawing();
    const cloned = cloneCadDrawingDocument(drawing);
    expect(cloned.project.entities[0]?.metadata).toEqual(drawing.project.entities[0]?.metadata);
  });
});

describe('undo/redo dependency coherence', () => {
  it('undo reverts the summary and redo restores it, stamps intact', () => {
    const stamped = stampAdjustmentDependency(importedPoint('pt:A', 'A'), IDENTITY_A);
    const project = {
      ...createBlankCadProject({ name: 'Undo Project', units: 'm' }),
      entities: [stamped],
    };
    const initial = createCadHistoryState(project, ['pt:A']);
    const before = summarizeDrawingDependency(initial.present.project, IDENTITY_A);
    expect(before.status).toBe('CURRENT');

    const erased = runCadCommand(initial, { key: 'ERASE' });
    expect(erased.present.project.entities).toHaveLength(0);

    const undone = undoCadHistory(erased);
    expect(summarizeDrawingDependency(undone.present.project, IDENTITY_A)).toEqual(before);
    expect(undone.present.project.entities[0]?.metadata).toEqual(stamped.metadata);

    const redone = redoCadHistory(undone);
    expect(redone.present.project.entities).toHaveLength(0);
    expect(summarizeDrawingDependency(redone.present.project, IDENTITY_A)).toEqual(
      summarizeDrawingDependency(erased.present.project, IDENTITY_A),
    );
  });

  it('draft-label staleness follows undo/redo of the source entity', () => {
    const stamped = stampAdjustmentDependency(importedPoint('pt:A', 'A'), IDENTITY_B);
    const project = {
      ...createBlankCadProject({ name: 'Label Undo Project', units: 'm' }),
      entities: [stamped],
    };
    const labels = [
      { id: 'lbl-1', text: 'derived', xModel: 0, yModel: 0, layerId: 'notes', sourceEntityId: 'pt:A' },
    ] as const;
    const staleOf = (entities: readonly CadEntity[]): boolean => {
      const map = buildDraftLabelEntityStatusMap(entities, IDENTITY_A);
      return hasStaleDerivedDraftLabel(
        evaluateDraftLabelDependencies([...labels], map),
      );
    };
    const initial = createCadHistoryState(project, ['pt:A']);
    // Stamp B vs identity A: source entity stale → derived label stale.
    expect(staleOf(initial.present.project.entities)).toBe(true);
    const erased = runCadCommand(initial, { key: 'ERASE' });
    // Source missing → still stale (no silent healing).
    expect(staleOf(erased.present.project.entities)).toBe(true);
    const undone = undoCadHistory(erased);
    expect(staleOf(undone.present.project.entities)).toBe(true);
    expect(undone.present.project.entities[0]?.metadata).toEqual(stamped.metadata);
  });
});
