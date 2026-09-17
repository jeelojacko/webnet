// Phase 18C persistence wave: WNCAD roundtrip of the new appearance fields,
// legacy v2 migration with byte-equivalent RESOLVED appearance.
import { describe, expect, it } from 'vitest';
import { resolveCadEntityAppearance } from '../src/engine/cad/cadAppearance';
import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import type { CadDrawingDocument, CadProject } from '../src/engine/cad/cadTypes';

const resolvedJsonOf = (project: CadProject): string[] =>
  [...project.entities]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((entity) =>
      JSON.stringify(
        resolveCadEntityAppearance({
          entity,
          layer: project.layers.find((layer) => layer.id === entity.layerId) ?? null,
          styleLibrary: project.styleLibrary,
        }),
      ),
    );

describe('18C WNCAD roundtrip', () => {
  it('persists frozen/transparency/description/appearance/currentLayerId/linetypeScale', () => {
    const document = createBlankCadDrawingDocument({ name: 'wncad 18c', units: 'm' });
    const project = document.project;
    project.layers.push({
      id: 'qa-rt', name: 'QA RT', color: '#123456', lineTypeId: 'dashed',
      visible: true, locked: false, frozen: true, transparency: 0.4,
      description: 'roundtrip note', printable: false, lineweightMm: 0.5, role: 'planning',
    });
    project.entities.push({
      type: 'line', id: 'rt-line', layerId: 'qa-rt', visible: true, locked: false,
      fromStationId: 'A', toStationId: 'B', fromX: 0, fromY: 0, toX: 10, toY: 10,
      sourceObservationIds: [],
      appearance: { color: '#abcdef', lineweightMm: 1.0, transparency: 0.25 },
    });
    project.currentLayerId = 'qa-rt';
    project.linetypeScale = 2.0;
    const parsed = parseCadDrawingFile(serializeCadDrawingFile(document));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const next = (parsed.drawing as CadDrawingDocument).project;
    expect(next.layers.find((layer) => layer.id === 'qa-rt')).toMatchObject({
      frozen: true, transparency: 0.4, description: 'roundtrip note', printable: false,
    });
    expect(next.entities.find((entity) => entity.id === 'rt-line')).toMatchObject({
      appearance: { color: '#abcdef', lineweightMm: 1.0, transparency: 0.25 },
    });
    expect(next.currentLayerId).toBe('qa-rt');
    expect(next.linetypeScale).toBe(2.0);
    // Roundtrip is appearance-stable: resolved values byte-identical.
    expect(resolvedJsonOf(next)).toEqual(resolvedJsonOf(project));
  });

  it('migrates legacy v2 files with byte-equivalent RESOLVED appearance', () => {
    const document = createBlankCadDrawingDocument({ name: 'legacy', units: 'm' });
    document.project.layers.push({
      id: 'legacy-layer', name: 'Legacy', color: '#ff0000',
      visible: false, locked: true, printable: false, lineweightMm: 0.5, role: 'planning',
    });
    document.project.entities.push(
      {
        type: 'line', id: 'legacy-line', layerId: 'legacy-layer', visible: true, locked: false,
        fromStationId: 'A', toStationId: 'B', fromX: 1, fromY: 2, toX: 3, toY: 4,
        sourceObservationIds: [],
      },
      {
        type: 'survey-point', id: 'legacy-pt', layerId: 'points', styleId: 'style-point',
        visible: true, locked: false, stationId: 'LP', x: 7, y: 8,
        pointClass: 'free', source: 'parsed-input',
      },
    );
    // Strip every 18C-optional field to simulate a pre-18C v2 file.
    const legacyJson = JSON.parse(serializeCadDrawingFile(document)) as Record<string, unknown>;
    const legacyProject = legacyJson['project'] as Record<string, unknown>;
    delete legacyProject['currentLayerId'];
    delete legacyProject['linetypeScale'];
    for (const layer of legacyProject['layers'] as Record<string, unknown>[]) {
      delete layer['frozen'];
      delete layer['transparency'];
      delete layer['description'];
    }
    for (const entity of legacyProject['entities'] as Record<string, unknown>[]) {
      delete entity['appearance'];
    }
    const before = resolvedJsonOf(document.project);
    const parsed = parseCadDrawingFile(JSON.stringify(legacyJson));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const next = (parsed.drawing as CadDrawingDocument).project;
    // Load backfill is deterministic: protected default + fallback current layer.
    expect(next.layers.some((layer) => layer.id === 'general')).toBe(true);
    expect(next.currentLayerId).toBe('general');
    expect(resolvedJsonOf(next)).toEqual(before);
  });
});
