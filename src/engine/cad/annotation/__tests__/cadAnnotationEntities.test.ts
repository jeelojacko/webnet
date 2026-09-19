import { describe, expect, it } from 'vitest';
import { validateCadProfessionalTextStyle } from '../cadAnnotationValidation';
import {
  seedBearingLabelStyles,
  seedCurveLabelStyles,
  seedDimensionStyles,
  seedLeaderStyles,
  seedProfessionalTextStyles,
} from '../cadAnnotationSeeds';
import { cloneCadEntity, cloneCadProject } from '../../cadPersistence';
import { buildStableCadProjectSignature } from '../../cadProjectState';
import type {
  CadBearingDistanceLabelEntity,
  CadCurveLabelEntity,
  CadDimensionEntity,
  CadLeaderEntity,
  CadMTextEntity,
  CadProject,
  CadTextStyle,
} from '../../cadTypes';

const base = { layerId: 'l', visible: true, locked: false } as const;

const minimalProject = (): CadProject => ({
  version: 2,
  id: 'p',
  name: 'p',
  metadata: { source: 'parsed-input', runMode: 'unknown', units: 'm', stationCount: 0, observationCount: 0, adjustedStationCount: 0 },
  layers: [],
  styleLibrary: { lineTypes: [], textStyles: [], pointSymbols: [], styles: [] },
  entities: [],
  cogoComputations: [],
  bounds: null,
});

describe('cadAnnotationEntities', () => {
  it('constructs all 5 new union members', () => {
    const mtext: CadMTextEntity = { id: 'm', ...base, type: 'mtext', x: 1, y: 2, text: 'hi', textStyleId: 's', rotationDeg: 0, attachment: 'middle-center' };
    const leader: CadLeaderEntity = { id: 'l1', ...base, type: 'leader', arrowAnchor: { kind: 'fixed', x: 0, y: 0 }, vertices: [{ x: 0, y: 0 }], text: 't', leaderStyleId: 'ls' };
    const dim: CadDimensionEntity = { id: 'd', ...base, type: 'dimension', dimensionKind: 'linear', anchors: [], defPoint1: { kind: 'fixed', x: 0, y: 0 }, defPoint2: { kind: 'fixed', x: 1, y: 1 }, orientation: 'horizontal', dimLinePoint: { x: 0, y: 2 }, dimensionStyleId: 'ds' };
    const bearing: CadBearingDistanceLabelEntity = { id: 'b', ...base, type: 'bearing-label', sourceEntityId: 'e', labelStyleId: 'bl', offset: { x: 0, y: 0 } };
    const curve: CadCurveLabelEntity = { id: 'c', ...base, type: 'curve-label', sourceEntityId: 'e', labelStyleId: 'cl', offset: { x: 0, y: 0 } };
    for (const e of [mtext, leader, dim, bearing, curve]) {
      expect(cloneCadEntity(e)).toEqual(e);
    }
  });

  it('validates legacy text style as legacy-ok and rejects bad professional fields', () => {
    const legacy: CadTextStyle = { id: 's', name: 'Legacy', fontFamily: 'Arial', fontSize: 2 };
    expect(validateCadProfessionalTextStyle(legacy).ok).toBe(true);
    const bad: CadTextStyle = { ...legacy, heightMode: 'model', modelHeight: -1, widthFactor: 0, lineSpacingFactor: Number.NaN };
    const result = validateCadProfessionalTextStyle(bad);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('seeds are valid and clone preserves semantic ids with stable signature', () => {
    const textStyles = seedProfessionalTextStyles();
    for (const s of textStyles) expect(validateCadProfessionalTextStyle(s).ok).toBe(true);
    expect(seedDimensionStyles()[0].textStyleId).toBe(textStyles[0].id);
    expect(seedLeaderStyles()[0].textStyleId).toBe(textStyles[0].id);
    const project = minimalProject();
    project.dimensionStyles = seedDimensionStyles();
    project.leaderStyles = seedLeaderStyles();
    project.bearingLabelStyles = seedBearingLabelStyles();
    project.curveLabelStyles = seedCurveLabelStyles();
    project.annotationSettings = { scaleDenominator: 500 };
    project.entities = [{ id: 'm', ...base, type: 'mtext', x: 1, y: 2, text: 'hi', textStyleId: textStyles[0].id, rotationDeg: 0, attachment: 'middle-center' }];
    const cloned = cloneCadProject(project);
    expect(cloned.dimensionStyles?.[0].id).toBe('std-500');
    expect(buildStableCadProjectSignature(cloned)).toBe(buildStableCadProjectSignature(cloneCadProject(cloned)));
  });
});
