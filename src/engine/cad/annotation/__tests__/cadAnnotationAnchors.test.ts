import { describe, expect, it } from 'vitest';
import {
  anchorFallbackPoint,
  fixAnchor,
  isAnchorBroken,
  resolveCadAnnotationAnchor,
} from '../cadAnnotationAnchors';
import type { CadAnnotationAnchor } from '../cadAnnotationAnchors';
import { createBlankCadProject } from '../../cadDrawingFile';
import type {
  CadArcEntity,
  CadBlockReferenceEntity,
  CadEntity,
  CadLineEntity,
  CadPolylineEntity,
  CadProject,
  CadSurveyPointEntity,
} from '../../cadTypes';

const projectWith = (entities: CadEntity[]): CadProject => ({
  ...createBlankCadProject({ name: 'Anchors', units: 'm' }),
  entities,
});

const surveyPoint = (id: string, x: number, y: number): CadSurveyPointEntity => ({
  id,
  type: 'survey-point',
  layerId: 'general',
  visible: true,
  locked: false,
  stationId: id,
  x,
  y,
  pointClass: 'free',
  source: 'parsed-input',
});

const line = (
  id: string,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): CadLineEntity => ({
  id,
  type: 'line',
  layerId: 'general',
  visible: true,
  locked: false,
  fromStationId: 'a',
  toStationId: 'b',
  fromX,
  fromY,
  toX,
  toY,
  sourceObservationIds: [],
});

const arc = (id: string, centerX: number, centerY: number): CadArcEntity => ({
  id,
  type: 'arc',
  layerId: 'general',
  visible: true,
  locked: false,
  centerX,
  centerY,
  radius: 10,
  startAngleDeg: 0,
  endAngleDeg: 90,
});

const blockReference = (id: string, x: number, y: number): CadBlockReferenceEntity => ({
  id,
  type: 'block-reference',
  layerId: 'general',
  visible: true,
  locked: false,
  blockDefinitionId: 'arrow',
  x,
  y,
  rotationDeg: 0,
  scaleX: 1,
  scaleY: 1,
});

const polyline = (id: string): CadPolylineEntity => ({
  id,
  type: 'polyline',
  layerId: 'general',
  visible: true,
  locked: false,
  vertices: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ],
  vertexLabels: ['', ''],
  closed: false,
});

describe('resolveCadAnnotationAnchor', () => {
  it('fixed resolves to its own point regardless of project', () => {
    const anchor: CadAnnotationAnchor = { kind: 'fixed', x: 12, y: -3 };
    expect(resolveCadAnnotationAnchor(anchor, projectWith([]))).toEqual({ ok: true, x: 12, y: -3 });
  });

  it('survey-point follows the entity when it moves', () => {
    const anchor: CadAnnotationAnchor = {
      kind: 'survey-point',
      entityId: 'pt1',
      fallbackX: 1,
      fallbackY: 1,
    };
    expect(resolveCadAnnotationAnchor(anchor, projectWith([surveyPoint('pt1', 1, 1)]))).toEqual({
      ok: true,
      x: 1,
      y: 1,
    });
    expect(resolveCadAnnotationAnchor(anchor, projectWith([surveyPoint('pt1', 25, 40)]))).toEqual({
      ok: true,
      x: 25,
      y: 40,
    });
  });

  it('line-endpoint follows both ends', () => {
    const start: CadAnnotationAnchor = {
      kind: 'line-endpoint',
      entityId: 'ln1',
      endpoint: 'start',
      fallbackX: 0,
      fallbackY: 0,
    };
    const end: CadAnnotationAnchor = { ...start, endpoint: 'end' };
    const project = projectWith([line('ln1', 2, 3, 8, 9)]);
    expect(resolveCadAnnotationAnchor(start, project)).toEqual({ ok: true, x: 2, y: 3 });
    expect(resolveCadAnnotationAnchor(end, project)).toEqual({ ok: true, x: 8, y: 9 });
  });

  it('arc-point derives center, start and end from center/radius/angles', () => {
    const anchor = (point: 'center' | 'start' | 'end'): CadAnnotationAnchor => ({
      kind: 'arc-point',
      entityId: 'arc1',
      point,
      fallbackX: 0,
      fallbackY: 0,
    });
    const project = projectWith([arc('arc1', 5, 5)]);
    expect(resolveCadAnnotationAnchor(anchor('center'), project)).toEqual({ ok: true, x: 5, y: 5 });
    const start = resolveCadAnnotationAnchor(anchor('start'), project);
    const end = resolveCadAnnotationAnchor(anchor('end'), project);
    expect(start.ok && start.x).toBeCloseTo(15, 12);
    expect(start.ok && start.y).toBeCloseTo(5, 12);
    expect(end.ok && end.x).toBeCloseTo(5, 12);
    expect(end.ok && end.y).toBeCloseTo(15, 12);
  });

  it('block-insertion resolves to the insertion point', () => {
    const anchor: CadAnnotationAnchor = {
      kind: 'block-insertion',
      entityId: 'blk1',
      fallbackX: 0,
      fallbackY: 0,
    };
    expect(resolveCadAnnotationAnchor(anchor, projectWith([blockReference('blk1', 7, -2)]))).toEqual({
      ok: true,
      x: 7,
      y: -2,
    });
  });
});

describe('broken anchors', () => {
  it('deleted entity is broken and preserves the fallback point', () => {
    const anchor: CadAnnotationAnchor = {
      kind: 'survey-point',
      entityId: 'gone',
      fallbackX: 11,
      fallbackY: 22,
    };
    expect(resolveCadAnnotationAnchor(anchor, projectWith([]))).toEqual({
      ok: false,
      fallbackX: 11,
      fallbackY: 22,
      reason: 'BROKEN_REFERENCE',
    });
    expect(isAnchorBroken(anchor, projectWith([]))).toBe(true);
  });

  it('type mismatch is broken, including polyline vertices', () => {
    const lineToSurvey: CadAnnotationAnchor = {
      kind: 'line-endpoint',
      entityId: 'pt1',
      endpoint: 'start',
      fallbackX: 3,
      fallbackY: 4,
    };
    const surveyToLine: CadAnnotationAnchor = {
      kind: 'survey-point',
      entityId: 'ln1',
      fallbackX: 5,
      fallbackY: 6,
    };
    const polylineVertex: CadAnnotationAnchor = {
      kind: 'line-endpoint',
      entityId: 'pl1',
      endpoint: 'end',
      fallbackX: 7,
      fallbackY: 8,
    };
    const project = projectWith([surveyPoint('pt1', 1, 1), line('ln1', 0, 0, 1, 1), polyline('pl1')]);
    expect(resolveCadAnnotationAnchor(lineToSurvey, project)).toMatchObject({
      ok: false,
      reason: 'BROKEN_REFERENCE',
    });
    expect(resolveCadAnnotationAnchor(surveyToLine, project)).toMatchObject({
      ok: false,
      reason: 'BROKEN_REFERENCE',
    });
    expect(resolveCadAnnotationAnchor(polylineVertex, project)).toEqual({
      ok: false,
      fallbackX: 7,
      fallbackY: 8,
      reason: 'BROKEN_REFERENCE',
    });
  });

  it('no silent rebinding by station name', () => {
    const anchor: CadAnnotationAnchor = {
      kind: 'survey-point',
      entityId: 'pt-old',
      fallbackX: 1,
      fallbackY: 2,
    };
    // A same-named station with a different entity id must not satisfy the ref.
    expect(isAnchorBroken(anchor, projectWith([surveyPoint('pt-new', 9, 9)]))).toBe(true);
  });
});

describe('anchor helpers', () => {
  it('anchorFallbackPoint returns own point for fixed and fallback for refs', () => {
    expect(anchorFallbackPoint({ kind: 'fixed', x: 1, y: 2 })).toEqual({ x: 1, y: 2 });
    expect(
      anchorFallbackPoint({
        kind: 'block-insertion',
        entityId: 'blk1',
        fallbackX: 3,
        fallbackY: 4,
      }),
    ).toEqual({ x: 3, y: 4 });
  });

  it('fixAnchor detaches a ref to its fallback and keeps a fixed anchor stable', () => {
    expect(
      fixAnchor({ kind: 'arc-point', entityId: 'arc1', point: 'center', fallbackX: 8, fallbackY: 9 }),
    ).toEqual({ kind: 'fixed', x: 8, y: 9 });
    expect(fixAnchor({ kind: 'fixed', x: -1, y: -2 })).toEqual({ kind: 'fixed', x: -1, y: -2 });
  });

  it('fixAnchor repairs a broken ref at the preserved fallback', () => {
    const broken: CadAnnotationAnchor = {
      kind: 'survey-point',
      entityId: 'gone',
      fallbackX: 4,
      fallbackY: 5,
    };
    const repaired = fixAnchor(broken);
    expect(repaired).toEqual({ kind: 'fixed', x: 4, y: 5 });
    expect(isAnchorBroken(repaired, projectWith([]))).toBe(false);
  });
});
