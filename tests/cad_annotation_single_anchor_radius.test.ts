// Phase 18P — single-anchor radius/diameter production path.
//
// Production DIMRADIUS/DIMDIAMETER commits ONE defining anchor (the arc pick;
// the second pick is the dim-line point). These tests prove that lone
// arc-point anchor resolves live from the arc entity (center + radius), that
// EDIT_ENTITY arc-radius re-measures it, and that a lone fixed anchor still
// resolves null (no association invented).
import { describe, expect, it } from 'vitest';

import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { runCadCommand, createCadHistoryState } from '../src/engine/cad/cadUndoRedo';
import { resolveDimensionDerivation } from '../src/engine/cad/cadRenderer';
import { deriveAnnotationPrimitives } from '../src/engine/cad/dxf/dxfAnnotationExport';
import {
  seedDimensionStyles,
  seedProfessionalTextStyles,
} from '../src/engine/cad/annotation/cadAnnotationSeeds';
import type { CadAnnotationAnchor } from '../src/engine/cad/annotation/cadAnnotationAnchors';
import type {
  CadArcEntity,
  CadDimensionEntity,
  CadEntity,
  CadProject,
} from '../src/engine/cad/cadTypes';

const base = { layerId: 'general', visible: true, locked: false } as const;

const arc = (): CadArcEntity => ({
  ...base,
  id: 'arc-1',
  type: 'arc',
  centerX: 0,
  centerY: 0,
  radius: 25,
  startAngleDeg: 0,
  endAngleDeg: 90,
});

const radiusDim = (anchors: CadAnnotationAnchor[]): CadDimensionEntity => ({
  ...base,
  id: 'dim-r',
  type: 'dimension',
  dimensionKind: 'radius',
  anchors,
  dimLinePoint: { x: 30, y: 30 },
  dimensionStyleId: 'std-500',
});

const projectWith = (entities: CadEntity[]): CadProject => {
  const project = createBlankCadProject({ name: 'Single-anchor radius', units: 'm' });
  project.entities = entities;
  project.dimensionStyles = seedDimensionStyles();
  const textStyles = seedProfessionalTextStyles();
  project.styleLibrary.textStyles.push(...textStyles);
  return project;
};

describe('single-anchor radius/diameter (18P)', () => {
  it('lone arc-point end anchor resolves with the live arc radius', () => {
    const project = projectWith([
      arc(),
      radiusDim([{ kind: 'arc-point', entityId: 'arc-1', point: 'end', fallbackX: 0, fallbackY: 25 }]),
    ]);
    const derived = resolveDimensionDerivation(project, project.entities[1] as CadDimensionEntity);
    expect(derived?.geometry.measurement).toBeCloseTo(25, 9);
  });

  it('lone arc-point center anchor resolves along the dim-line direction', () => {
    const project = projectWith([
      arc(),
      radiusDim([{ kind: 'arc-point', entityId: 'arc-1', point: 'center', fallbackX: 0, fallbackY: 0 }]),
    ]);
    const derived = resolveDimensionDerivation(project, project.entities[1] as CadDimensionEntity);
    expect(derived?.geometry.measurement).toBeCloseTo(25, 9);
  });

  it('EDIT_ENTITY arc-radius re-measures the associative dimension', () => {
    const start = projectWith([
      arc(),
      radiusDim([{ kind: 'arc-point', entityId: 'arc-1', point: 'end', fallbackX: 0, fallbackY: 25 }]),
    ]);
    const history = createCadHistoryState(start);
    const next = runCadCommand(history, { key: 'EDIT_ENTITY', entityId: 'arc-1', edit: { kind: 'arc-radius', value: 40 } });
    expect(next).not.toBe(history);
    const edited = next.present.project.entities.find((entity) => entity.id === 'arc-1');
    expect(edited?.type === 'arc' && edited.radius).toBe(40);
    // The end anchor still resolves (live arc end at radius 40).
    const derived = resolveDimensionDerivation(
      next.present.project,
      next.present.project.entities[1] as CadDimensionEntity,
    );
    expect(derived?.geometry.measurement).toBeCloseTo(40, 9);
  });

  it('EDIT_ENTITY arc-radius rejects non-positive values', () => {
    const start = projectWith([arc()]);
    const history = createCadHistoryState(start);
    expect(
      runCadCommand(history, { key: 'EDIT_ENTITY', entityId: 'arc-1', edit: { kind: 'arc-radius', value: 0 } }),
    ).toBe(history);
    expect(
      runCadCommand(history, { key: 'EDIT_ENTITY', entityId: 'arc-1', edit: { kind: 'arc-radius', value: -5 } }),
    ).toBe(history);
  });

  it('lone fixed anchor still resolves null (no association invented)', () => {
    const project = projectWith([arc(), radiusDim([{ kind: 'fixed', x: 0, y: 25 }])]);
    expect(
      resolveDimensionDerivation(project, project.entities[1] as CadDimensionEntity),
    ).toBeNull();
  });

  it('DXF derives the single-anchor radius instead of dropping it', () => {
    const project = projectWith([
      arc(),
      radiusDim([{ kind: 'arc-point', entityId: 'arc-1', point: 'end', fallbackX: 0, fallbackY: 25 }]),
    ]);
    const derivation = deriveAnnotationPrimitives(
      project.entities[1] as CadDimensionEntity,
      project,
    );
    expect(derivation.ok).toBe(true);
    expect(derivation.primitives.texts.map((row) => row.text).join(' ')).toContain('25.000');
  });
});
