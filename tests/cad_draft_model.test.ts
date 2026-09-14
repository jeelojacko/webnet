import { describe, expect, it } from 'vitest';

import {
  createBlankCadDrawingDocument,
  migrateV1ToV2,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { createDraftSheet } from '../src/engine/cad/cadDraftTypes';

const asRecord = (value: unknown): Record<string, unknown> => value as Record<string, unknown>;

describe('drafting document model (.wncad v2)', () => {
  it('opens legacy v1 files with geometry unchanged and safe drafting defaults', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Legacy Geometry', units: 'm' });
    const v1Payload = asRecord(JSON.parse(serializeCadDrawingFile(drawing)));
    v1Payload.schemaVersion = 1;
    delete v1Payload.draft;
    v1Payload.project = {
      ...asRecord(v1Payload.project),
      entities: [
        {
          id: 'pt:A',
          type: 'survey-point',
          layerId: 'points',
          visible: true,
          locked: false,
          stationId: 'A',
          x: 10,
          y: 20,
          pointClass: 'free',
          source: 'parsed-input',
        },
      ],
    };

    const parsed = parseCadDrawingFile(JSON.stringify(v1Payload));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.drawing.schemaVersion).toBe(2);
    expect(parsed.drawing.project.entities).toEqual(asRecord(v1Payload.project).entities);
    expect(parsed.drawing.draft?.version).toBe(1);
    expect(parsed.drawing.draft?.sheets).toEqual([]);
    expect(parsed.drawing.draft?.modelSpaceProjectId).toBe(parsed.drawing.project.id);
  });

  it('migrates v1 to v2 explicitly without touching geometry', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Migrate', units: 'm' });
    const v1 = { ...drawing, schemaVersion: 1 as const, draft: undefined };
    const migrated = migrateV1ToV2(v1);

    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.project).toEqual(drawing.project);
    expect(migrated.draft?.layers.map((layer) => layer.id)).toEqual(
      drawing.project.layers.map((layer) => layer.id),
    );
  });

  it('round-trips v2 documents with sheets, layers, and styles intact', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Sheet Set', units: 'm' });
    const sheet = createDraftSheet({ name: 'A1 Plan' });
    sheet.viewports.push({
      id: 'viewport-1',
      name: 'Plan',
      modelCenterX: 100,
      modelCenterY: 200,
      scaleDenominator: 500,
      paperXmm: 10,
      paperYmm: 10,
      paperWidthMm: 277,
      paperHeightMm: 190,
      rotationDeg: 0,
    });
    sheet.sheetObjects.push({
      id: 'note-1',
      kind: 'text',
      layerId: 'labels',
      paperXmm: 12,
      paperYmm: 195,
      text: 'Plan note',
    });
    drawing.draft?.sheets.push(sheet);
    drawing.draft?.titleBlockDefinitions.push({
      id: 'tb-1',
      name: 'A1 Title Block',
      fieldNames: ['project', 'date', 'scale'],
    });
    drawing.draft?.annotationStyles.labelStyles.push({
      id: 'label-bearing',
      name: 'Bearing',
      textStyleId: drawing.draft.annotationStyles.textStyles[0].id,
    });

    const parsed = parseCadDrawingFile(serializeCadDrawingFile(drawing));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.drawing).toEqual(drawing);
  });

  it('drops unknown optional fields instead of failing', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Tolerant', units: 'm' });
    drawing.draft?.sheets.push(createDraftSheet({ name: 'S1' }));
    const payload = asRecord(JSON.parse(serializeCadDrawingFile(drawing)));
    payload.futureTopLevelField = { nested: true };
    const draft = asRecord(payload.draft);
    draft.futureDraftField = 'drop-me';
    const sheets = draft.sheets as Array<Record<string, unknown>>;
    draft.sheets = [{ ...sheets[0], ownershipOpinion: 'drop-me' }];

    const parsed = parseCadDrawingFile(JSON.stringify(payload));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.drawing).not.toHaveProperty('futureTopLevelField');
    expect(parsed.drawing.draft).not.toHaveProperty('futureDraftField');
    expect(asRecord(parsed.drawing.draft?.sheets[0])).not.toHaveProperty('ownershipOpinion');
    expect(parsed.drawing.draft?.sheets[0].name).toBe('S1');
  });

  it('keeps printable and lineweight on default layers', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Layers', units: 'm' });

    expect(drawing.project.layers).toHaveLength(6);
    for (const layer of drawing.project.layers) {
      expect(layer.printable).toBe(true);
      expect(typeof layer.lineweightMm).toBe('number');
    }
  });
});
