import { describe, expect, it } from 'vitest';

import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import type { CadSurveyPointEntity, CadTextEntity } from '../src/engine/cad/cadTypes';
import {
  buildFieldToFinishProject,
  type FieldToFinishCadPoint,
} from '../src/engine/fieldToFinish/cadGeneration';
import {
  applyFieldToFinishRegen,
  markFieldToFinishManualOverride,
  previewFieldToFinishRegen,
} from '../src/engine/fieldToFinish/regeneration';
import { SAMPLE_CATALOG } from '../src/engine/fieldToFinish/sampleCatalog';
import { FieldLineworkControl } from '../src/engine/fieldToFinish/featureMetadata';

const ep = (control?: FieldLineworkControl): FieldToFinishCadPoint['codes'] =>
  control ? [{ code: 'EP', controls: [control] }] : [{ code: 'EP' }];

const pt = (
  stationId: string,
  x: number,
  y: number,
  order: number,
  codes: FieldToFinishCadPoint['codes'],
): FieldToFinishCadPoint => ({
  stationId,
  x,
  y,
  sourceOrder: order,
  rawCodeText: codes.map((entry) => entry.code).join(' '),
  codes,
  description: `desc-${stationId}`,
  sourceRecordId: stationId,
  sourceImportId: 'regen-golden',
});

const source10 = (): FieldToFinishCadPoint[] => [
  pt('P1', 0, 0, 1, ep(FieldLineworkControl.BEGIN)),
  pt('P2', 10, 0, 2, ep(FieldLineworkControl.CONTINUE)),
  pt('P3', 20, 0, 3, ep(FieldLineworkControl.CONTINUE)),
  pt('P4', 30, 0, 4, ep(FieldLineworkControl.END)),
  pt('P5', 5, 5, 5, [{ code: 'TREE' }]),
  pt('P6', 15, 5, 6, [{ code: 'TREE' }]),
  pt('P7', 25, 5, 7, [{ code: 'TREE' }]),
  pt('P8', 0, 10, 8, ep(FieldLineworkControl.BEGIN)),
  pt('P9', 40, 40, 9, [{ code: 'ROCK' }]),
  pt('P10', 50, 50, 10, [{ code: 'CENTERLINE' }]),
];

describe('cad f2f regen golden', () => {
  it('previews moved/code-changed/added/removed deltas and preserves manual work on confirmed regen', () => {
    const args = { points: source10(), catalog: SAMPLE_CATALOG, generationRunId: 'regen-1' };
    let project = buildFieldToFinishProject(
      createBlankCadProject({ name: 'F2F regen', units: 'm' }),
      args,
    ).project;

    // Manual entity + manual label placement (moved off the generated spot).
    project = markFieldToFinishManualOverride(project, 'pt:P5');
    const manualLabel = project.entities.find((entity) => entity.id === 'label:P6');
    expect(manualLabel?.type).toBe('text');
    project = {
      ...project,
      entities: project.entities.map((entity) =>
        entity.id === 'label:P6' && entity.type === 'text'
          ? { ...entity, x: (entity as CadTextEntity).x + 7, y: (entity as CadTextEntity).y + 7 }
          : entity,
      ),
    };
    project = markFieldToFinishManualOverride(project, 'label:P6');
    const placedLabel = project.entities.find((entity) => entity.id === 'label:P6') as CadTextEntity;

    // Revision: P1 moved, P5 code changed (manual), P7 code changed,
    // P9 removed, P11 added.
    const revised: FieldToFinishCadPoint[] = [
      pt('P1', 1, 1, 1, ep(FieldLineworkControl.BEGIN)),
      pt('P2', 10, 0, 2, ep(FieldLineworkControl.CONTINUE)),
      pt('P3', 20, 0, 3, ep(FieldLineworkControl.CONTINUE)),
      pt('P4', 30, 0, 4, ep(FieldLineworkControl.END)),
      pt('P5', 5, 5, 5, [{ code: 'EDGE' }]),
      pt('P6', 15, 5, 6, [{ code: 'TREE' }]),
      pt('P7', 25, 5, 7, [{ code: 'CONTROL' }]),
      pt('P8', 0, 10, 8, ep(FieldLineworkControl.BEGIN)),
      pt('P10', 50, 50, 10, [{ code: 'CENTERLINE' }]),
      pt('P11', 60, 60, 11, [{ code: 'TREE' }]),
    ];
    const regenArgs = { points: revised, catalog: SAMPLE_CATALOG, generationRunId: 'regen-2' };

    const preview = previewFieldToFinishRegen(project, regenArgs, 'regen-golden');
    expect(preview.added).toEqual(['P11']);
    expect(preview.updated).toContain('P1');
    expect(preview.removed).toEqual(['P9']);
    expect(preview.codesChanged).toContain('P7');
    expect(preview.manualConflicts).toContain('P5');
    // Deterministic: repeated preview is identical.
    expect(previewFieldToFinishRegen(project, regenArgs, 'regen-golden')).toEqual(preview);

    const applied = applyFieldToFinishRegen(project, regenArgs, 'regen-golden', { confirmed: true });
    const byId = new Map(applied.project.entities.map((entity) => [entity.id, entity]));

    // Removed source vanishes only on confirmed regen.
    expect(byId.has('pt:P9')).toBe(false);
    expect(byId.has('pt:P11')).toBe(true);
    // Moved source is reported, but existing geometry is never moved by
    // generation (reference-or-create; coordinate updates are explicit).
    expect((byId.get('pt:P1') as CadSurveyPointEntity).x).toBe(0);
    // Manual entity keeps its generated coords despite the code change.
    expect((byId.get('pt:P5') as CadSurveyPointEntity).x).toBe(5);
    expect((byId.get('pt:P5') as CadSurveyPointEntity).featureCode).toBe('TREE');
    // Manual label placement preserved despite the point staying put.
    const keptLabel = byId.get('label:P6') as CadTextEntity;
    expect(keptLabel.x).toBe(placedLabel.x);
    expect(keptLabel.y).toBe(placedLabel.y);
    // Generated label follows a code change.
    expect((byId.get('label:P7') as CadTextEntity).text).toContain('CONTROL');
    expect(applied.removedEntityIds).toContain('pt:P9');
  });
});
