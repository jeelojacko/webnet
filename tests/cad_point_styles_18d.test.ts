import { describe, expect, it } from 'vitest';
import { buildSurveyCadSpikeProject } from '../src/engine/cad/cadModel';
import { cloneCadProject } from '../src/engine/cad/cadPersistence';
import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import {
  DEFAULT_CAD_POINT_STYLES,
  backfillCadPointStyles,
  basePointStyleIdForClass,
  migrateLegacySurveyPointStyles,
} from '../src/engine/cad/cadPointStyles';
import {
  input as cadTestInput,
  parseOptions as cadTestParseOptions,
} from './surveyCadWorkspace/surveyCadWorkspaceTestSupport';
import type { CadProject, CadSurveyPointEntity } from '../src/engine/cad/cadTypes';

const surveyPoints = (project: CadProject): CadSurveyPointEntity[] =>
  project.entities.filter((entity): entity is CadSurveyPointEntity => entity.type === 'survey-point');

describe('phase 18D point styles', () => {
  it('seeds nine drawing-owned defaults on blank projects', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Blank', units: 'm' });
    expect(drawing.project.pointStyles).toHaveLength(9);
    expect(drawing.project.pointStyles?.map((style) => style.id)).toEqual(
      DEFAULT_CAD_POINT_STYLES.map((style) => style.id),
    );
    const symbols = new Set(drawing.project.styleLibrary.pointSymbols.map((symbol) => symbol.id));
    for (const style of drawing.project.pointStyles ?? []) {
      expect(symbols.has(style.markerSymbolId)).toBe(true);
    }
    expect(
      drawing.project.pointStyles?.find((style) => style.id === 'point-style-no-display')
        ?.displayMarker,
    ).toBe(false);
  });

  it('builds base pointStyleId values for parsed points without changing color refs', () => {
    const project = buildSurveyCadSpikeProject({
      input: cadTestInput,
      instrumentLibrary: {},
      parseOptions: cadTestParseOptions,
      units: 'm',
    });
    expect(project.pointStyles).toHaveLength(9);
    for (const point of surveyPoints(project)) {
      expect(point.pointStyleId).toBe(basePointStyleIdForClass(point.pointClass));
      expect(point.pointStyleOverrideId).toBeUndefined();
      // Legacy color path untouched.
      expect(point.styleId).toBe(
        point.pointClass === 'control' ? 'style-control-point' : 'style-point',
      );
    }
  });

  it('keeps two projects independent after cloning', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Blank', units: 'm' });
    const clone = cloneCadProject(drawing.project);
    clone.pointStyles?.[0] && (clone.pointStyles[0] = { ...clone.pointStyles[0], markerScale: 3 });
    expect(drawing.project.pointStyles?.[0].markerScale).toBeUndefined();
    expect(backfillCadPointStyles(undefined)).not.toBe(DEFAULT_CAD_POINT_STYLES);
  });

  it('migrates legacy style refs to same-symbol base styles; pure-ByLayer stays undefined', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Blank', units: 'm' });
    const project: CadProject = {
      ...drawing.project,
      pointStyles: undefined,
      entities: [
        {
          id: 'pt:A',
          type: 'survey-point',
          layerId: 'control-points',
          styleId: 'style-control-point',
          visible: true,
          locked: false,
          stationId: 'A',
          x: 0,
          y: 0,
          pointClass: 'control',
          source: 'parsed-input',
        },
        {
          id: 'pt:B',
          type: 'survey-point',
          layerId: 'points',
          visible: true,
          locked: false,
          stationId: 'B',
          x: 1,
          y: 1,
          pointClass: 'free',
          source: 'parsed-input',
        },
      ],
    };
    const migrated = migrateLegacySurveyPointStyles(project);
    expect(project.pointStyles).toBeUndefined();
    expect(migrated.pointStyles).toHaveLength(9);
    const [control, manual] = surveyPoints(migrated);
    // Same symbol as before (point-control radius 2.4) via the Control default.
    expect(control.pointStyleId).toBe('point-style-control');
    expect(control.styleId).toBe('style-control-point');
    expect(manual.pointStyleId).toBeUndefined();
    // Idempotent: second run changes nothing.
    expect(migrateLegacySurveyPointStyles(migrated)).toEqual(migrated);
  });

  it('creates compat styles for unknown legacy symbols without touching appearance', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Blank', units: 'm' });
    const project: CadProject = {
      ...drawing.project,
      pointStyles: undefined,
      styleLibrary: {
        ...drawing.project.styleLibrary,
        styles: [
          ...drawing.project.styleLibrary.styles,
          { id: 'style-custom', name: 'Custom', color: '#ff0000', pointSymbolId: 'point-f2f-dot' },
        ],
      },
      entities: [
        {
          id: 'pt:C',
          type: 'survey-point',
          layerId: 'points',
          styleId: 'style-custom',
          visible: true,
          locked: false,
          stationId: 'C',
          x: 2,
          y: 2,
          pointClass: 'free',
          source: 'parsed-input',
        },
      ],
    };
    const migrated = migrateLegacySurveyPointStyles(project);
    // point-f2f-dot is already covered by the Topo default — reuse it.
    expect(surveyPoints(migrated)[0].pointStyleId).toBe('point-style-topo');
    expect(surveyPoints(migrated)[0].styleId).toBe('style-custom');
  });

  it('round-trips point styles plus both entity refs through WNCAD at schema v2', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Round trip', units: 'm' });
    drawing.project.entities = [
      {
        id: 'pt:R',
        type: 'survey-point',
        layerId: 'points',
        styleId: 'style-point',
        visible: true,
        locked: false,
        stationId: 'R',
        x: 5,
        y: 5,
        pointClass: 'free',
        source: 'parsed-input',
        pointStyleId: 'point-style-tree',
        pointStyleOverrideId: 'point-style-no-display',
      },
    ];
    const parsed = parseCadDrawingFile(serializeCadDrawingFile(drawing));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.drawing.schemaVersion).toBe(2);
    expect(parsed.drawing.project.pointStyles).toHaveLength(9);
    const point = surveyPoints(parsed.drawing.project)[0];
    expect(point.pointStyleId).toBe('point-style-tree');
    expect(point.pointStyleOverrideId).toBe('point-style-no-display');
  });

  it('opens legacy files missing point styles with equivalent markers', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Legacy', units: 'm' });
    const legacy = { ...drawing, project: { ...drawing.project, pointStyles: undefined } };
    const parsed = parseCadDrawingFile(JSON.stringify(legacy));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.drawing.project.pointStyles).toHaveLength(9);
  });
});
