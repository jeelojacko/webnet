import { describe, expect, it } from 'vitest';
import { buildSurveyCadSpikeProject } from '../src/engine/cad/cadModel';
import { cloneCadProject } from '../src/engine/cad/cadPersistence';
import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { formatDraftCoordinate } from '../src/engine/cad/cadLabelEngine';
import {
  DEFAULT_CAD_POINT_LABEL_STYLES,
  backfillCadPointLabelStyles,
  buildPointLabelContent,
  materializePointLabel,
  migrateLegacyLabelToBinding,
} from '../src/engine/cad/cadPointLabelStyles';
import type {
  CadPointLabelStyle,
  CadSurveyPointEntity,
  CadTextEntity,
} from '../src/engine/cad/cadTypes';
import {
  input as cadTestInput,
  parseOptions as cadTestParseOptions,
} from './surveyCadWorkspace/surveyCadWorkspaceTestSupport';

const fixturePoint: CadSurveyPointEntity = {
  id: 'pt:P1',
  type: 'survey-point',
  layerId: 'points',
  styleId: 'style-point',
  visible: true,
  locked: false,
  stationId: 'P1',
  x: 100,
  y: 200,
  z: 12.345,
  pointClass: 'free',
  source: 'parsed-input',
  description: 'Iron pin',
  featureCode: 'EP',
};

const styleById = (id: string): CadPointLabelStyle =>
  DEFAULT_CAD_POINT_LABEL_STYLES.find((style) => style.id === id)!;

const f2fLabel = (overrides?: Partial<CadTextEntity>): CadTextEntity => ({
  id: 'label:P1',
  type: 'text',
  layerId: 'labels',
  styleId: 'style-label',
  visible: true,
  locked: false,
  x: 100,
  y: 200,
  text: 'P1 Iron pin EP EL 12.345',
  anchorEntityId: 'pt:P1',
  metadata: {
    stationId: 'P1',
    provenance: { generatedBy: 'FIELD_TO_FINISH', state: 'GENERATED' },
  },
  ...overrides,
});

describe('phase 18D point label styles', () => {
  it('seeds eight drawing-owned defaults on blank projects and builds', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Blank', units: 'm' });
    expect(drawing.project.labelStyles).toHaveLength(8);
    expect(drawing.project.labelStyles?.map((style) => style.id)).toEqual(
      DEFAULT_CAD_POINT_LABEL_STYLES.map((style) => style.id),
    );
    for (const style of drawing.project.labelStyles ?? []) {
      expect(style.textStyleId).toBe('label-default');
    }
    expect(styleById('point-label-none').visible).toBe(false);
    const project = buildSurveyCadSpikeProject({
      input: cadTestInput,
      instrumentLibrary: {},
      parseOptions: cadTestParseOptions,
      units: 'm',
    });
    expect(project.labelStyles).toHaveLength(8);
  });

  it('keeps two drawings independent after cloning', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Blank', units: 'm' });
    const clone = cloneCadProject(drawing.project);
    clone.labelStyles?.[1] && (clone.labelStyles[1] = { ...clone.labelStyles[1], offsetX: 9 });
    expect(drawing.project.labelStyles?.[1].offsetX).toBe(0);
    expect(backfillCadPointLabelStyles(undefined)).not.toBe(DEFAULT_CAD_POINT_LABEL_STYLES);
  });

  it('formats every default style; F2F Full reproduces the legacy label text', () => {
    const legacyElevation = `EL ${formatDraftCoordinate(12.345)}`;
    expect(buildPointLabelContent(fixturePoint, styleById('point-label-none'))).toBe('');
    expect(buildPointLabelContent(fixturePoint, styleById('point-label-point-number'))).toBe('P1');
    expect(buildPointLabelContent(fixturePoint, styleById('point-label-point-number-elevation'))).toBe(
      `P1 ${legacyElevation}`,
    );
    expect(buildPointLabelContent(fixturePoint, styleById('point-label-point-number-description'))).toBe(
      'P1 Iron pin',
    );
    expect(buildPointLabelContent(fixturePoint, styleById('point-label-description'))).toBe('Iron pin');
    expect(buildPointLabelContent(fixturePoint, styleById('point-label-elevation'))).toBe(legacyElevation);
    expect(
      buildPointLabelContent(fixturePoint, styleById('point-label-point-number-description-elevation')),
    ).toBe(`P1 Iron pin ${legacyElevation}`);
    // Compat: same order/separator/elevation format as legacy buildLabelText.
    expect(buildPointLabelContent(fixturePoint, styleById('point-label-f2f-full'))).toBe(
      `P1 Iron pin EP ${legacyElevation}`,
    );
  });

  it('skips missing description, code, and elevation parts', () => {
    const bare = { ...fixturePoint, description: undefined, featureCode: undefined, z: undefined };
    expect(buildPointLabelContent(bare, styleById('point-label-f2f-full'))).toBe('P1');
    expect(buildPointLabelContent(bare, styleById('point-label-elevation'))).toBe('');
  });

  it('materializes placement, rotation, and visibility; offsetOverride wins over style offset', () => {
    const offsetStyle: CadPointLabelStyle = {
      ...styleById('point-label-point-number'),
      offsetX: 1.5,
      offsetY: -2,
      rotationDeg: 30,
    };
    expect(materializePointLabel(f2fLabel(), fixturePoint, offsetStyle)).toEqual({
      text: 'P1',
      x: 101.5,
      y: 198,
      rotationDeg: 30,
      visible: true,
    });
    const overridden = f2fLabel({
      pointLabel: {
        pointEntityId: 'pt:P1',
        labelStyleId: offsetStyle.id,
        offsetOverride: { dx: 5, dy: 6 },
        rotationOverrideDeg: 45,
        content: { mode: 'derived' },
      },
    });
    expect(materializePointLabel(overridden, fixturePoint, offsetStyle)).toEqual({
      text: 'P1',
      x: 105,
      y: 206,
      rotationDeg: 45,
      visible: true,
    });
    // No rotation anywhere defaults to 0; No Label is not visible.
    expect(
      materializePointLabel(f2fLabel(), fixturePoint, styleById('point-label-point-number')),
    ).toMatchObject({ rotationDeg: 0, visible: true });
    expect(
      materializePointLabel(f2fLabel(), fixturePoint, styleById('point-label-none')),
    ).toMatchObject({ visible: false });
  });

  it('returns manual text with associated placement in manual content mode', () => {
    const manual = f2fLabel({
      x: 103,
      y: 204,
      text: 'edited by hand',
      pointLabel: {
        pointEntityId: 'pt:P1',
        labelStyleId: 'point-label-f2f-full',
        offsetOverride: { dx: 3, dy: 4 },
        content: { mode: 'manual', text: 'edited by hand' },
      },
    });
    expect(materializePointLabel(manual, fixturePoint, styleById('point-label-f2f-full'))).toEqual({
      text: 'edited by hand',
      x: 103,
      y: 204,
      rotationDeg: 0,
      visible: true,
    });
  });

  it('migrates matching legacy F2F labels to derived bindings', () => {
    const migrated = migrateLegacyLabelToBinding(f2fLabel(), fixturePoint);
    expect(migrated?.pointLabel).toEqual({
      pointEntityId: 'pt:P1',
      labelStyleId: 'point-label-f2f-full',
      content: { mode: 'derived' },
    });
  });

  it('migrates mismatched legacy labels to manual bindings preserving placement', () => {
    // Deconfliction bump: same text, shifted placement.
    const bumped = migrateLegacyLabelToBinding(f2fLabel({ y: 200.5 }), fixturePoint);
    expect(bumped?.pointLabel).toEqual({
      pointEntityId: 'pt:P1',
      labelStyleId: 'point-label-f2f-full',
      offsetOverride: { dx: 0, dy: 0.5 },
      content: { mode: 'manual', text: 'P1 Iron pin EP EL 12.345' },
    });
    // Hand-edited text: manual content even when placement matches.
    const edited = migrateLegacyLabelToBinding(f2fLabel({ text: 'P1 revised' }), fixturePoint);
    expect(edited?.pointLabel?.content).toEqual({ mode: 'manual', text: 'P1 revised' });
  });

  it('leaves ambiguous labels free (no binding)', () => {
    // No F2F provenance (e.g. adjustment-builder label).
    const plain: CadTextEntity = { ...f2fLabel(), text: 'P1', metadata: { stationId: 'P1' } };
    expect(migrateLegacyLabelToBinding(plain, fixturePoint)).toBeUndefined();
    // Anchor points elsewhere.
    expect(migrateLegacyLabelToBinding(f2fLabel({ anchorEntityId: 'pt:OTHER' }), fixturePoint)).toBeUndefined();
    // Already bound labels pass through untouched.
    const bound = f2fLabel({
      pointLabel: { pointEntityId: 'pt:P1', labelStyleId: 'point-label-none', content: { mode: 'derived' } },
    });
    expect(migrateLegacyLabelToBinding(bound, fixturePoint)).toBe(bound);
  });

  it('round-trips label styles plus bindings through WNCAD at schema v2', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Round trip', units: 'm' });
    drawing.project.entities = [
      fixturePoint,
      f2fLabel({
        pointLabel: {
          pointEntityId: 'pt:P1',
          labelStyleId: 'point-label-f2f-full',
          offsetOverride: { dx: 1, dy: 2 },
          content: { mode: 'manual', text: 'P1 custom' },
        },
      }),
    ];
    const parsed = parseCadDrawingFile(serializeCadDrawingFile(drawing));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.drawing.schemaVersion).toBe(2);
    expect(parsed.drawing.project.labelStyles).toHaveLength(8);
    const label = parsed.drawing.project.entities.find((entity) => entity.id === 'label:P1');
    expect(label?.type).toBe('text');
    if (label?.type !== 'text') return;
    expect(label.pointLabel).toEqual({
      pointEntityId: 'pt:P1',
      labelStyleId: 'point-label-f2f-full',
      offsetOverride: { dx: 1, dy: 2 },
      content: { mode: 'manual', text: 'P1 custom' },
    });
  });

  it('opens legacy files with defaults and adds no bindings on load', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Legacy', units: 'm' });
    const legacy = {
      ...drawing,
      project: {
        ...drawing.project,
        labelStyles: undefined,
        entities: [fixturePoint, f2fLabel()],
      },
    };
    const parsed = parseCadDrawingFile(JSON.stringify(legacy));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.drawing.project.labelStyles).toHaveLength(8);
    const label = parsed.drawing.project.entities.find((entity) => entity.id === 'label:P1');
    expect(label?.type).toBe('text');
    if (label?.type !== 'text') return;
    expect(label.pointLabel).toBeUndefined();
    expect(label.text).toBe('P1 Iron pin EP EL 12.345');
  });
});
