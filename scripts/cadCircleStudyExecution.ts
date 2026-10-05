/**
 * B0 study-side EXECUTION pins: every record below is measured by calling the
 * real production path (never a copy, never a prediction). STUDY-ONLY.
 *
 * B1 = full-circle arc child/entity (0/360), center (100,200) r=50.
 * Host-import round trip is labelled UNEXECUTED prediction (no host here).
 */
import { cadSignedSweepDeg } from '../src/engine/cad/cadGeometry';
import { arcRefFromEntity } from '../src/engine/cad/cadSpatialEntityRefs';
import { buildArcEntitySnapCandidates } from '../src/engine/cad/cadSpatialEntityCandidates';
import { buildBlockReferenceSnapCandidates } from '../src/engine/cad/cadSpatialBlockSnaps';
import { dedupeCandidates } from '../src/engine/cad/cadSpatialSnapCandidates';
import { expandBlockReference, type BlockPlacement } from '../src/engine/cad/cadBlocks';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { transformCadEntityGeometry } from '../src/engine/cad/cadTransformGeometry';
import { classifyTransform } from '../src/engine/cad/cadTransform2D';
import { buildCadGripHandles } from '../src/engine/cad/cadTransactionsEntityTransforms';
import { buildDxfExportModel } from '../src/engine/cad/dxf/dxfExportModel';
import { serializeDxfModel } from '../src/engine/cad/dxf/dxfSerializer';
import type {
  CadArcEntity,
  CadBlockDefinition,
  CadBlockReferenceEntity,
  CadProject,
  CadSnapKind,
} from '../src/engine/cad/cadTypes';
import { arcPathFromPrimitive } from '../src/components/surveyCad/SurveyCadPreview.geometry';
import { STUDY_CENTER, STUDY_RADIUS } from './cadCircleStudySweep';

const r6 = (n: number): number => (Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : n);

const b1Entity = (): CadArcEntity => ({
  id: 'study-b1', type: 'arc', layerId: 'L0', name: 'study B1',
  centerX: STUDY_CENTER.x, centerY: STUDY_CENTER.y, radius: STUDY_RADIUS,
  startAngleDeg: 0, endAngleDeg: 360, visible: true, locked: false,
} as CadArcEntity);

const b1Definition = (): CadBlockDefinition => ({
  id: 'study-def', name: 'study-def', basePoint: { x: 0, y: 0 },
  entities: [{ ...b1Entity(), id: 'study-b1-child' }],
});

const placement = (over: Partial<BlockPlacement> = {}): BlockPlacement => ({
  x: 0, y: 0, rotationDeg: 0, scaleX: 1, scaleY: 1, ...over,
});

/** B1: real block-expansion path (transformBlockChildToWorld via expandBlockReference). */
export const runBlockExpansionB1 = (): Record<string, unknown> => {
  const expanded = expandBlockReference(b1Definition(), placement());
  const child = expanded[0] as CadArcEntity;
  const rotated = expandBlockReference(b1Definition(), placement({ rotationDeg: 30 }))[0] as CadArcEntity;
  return {
    codePath: 'cadBlocks.ts:190-198 (arc arm) via expandBlockReference cadBlocks.ts:235-244',
    identity: {
      startAngleDeg: child.startAngleDeg, endAngleDeg: child.endAngleDeg,
      signedSweepDeg: cadSignedSweepDeg(child.startAngleDeg, child.endAngleDeg),
      radius: child.radius,
    },
    rotated30: { startAngleDeg: rotated.startAngleDeg, endAngleDeg: rotated.endAngleDeg },
    // cadNormalizeAngleDeg(360) === 0, so 0/360 normalizes to 0/0: signed sweep is lost.
    sweepLost: cadSignedSweepDeg(child.startAngleDeg, child.endAngleDeg) !== 360,
  };
};

/** B2: real block scale path with unequal scales + entity-level refusal for contrast. */
export const runBlockNonUniformScale = (): Record<string, unknown> => {
  const child = expandBlockReference(b1Definition(), placement({ scaleX: 2, scaleY: 1 }))[0] as CadArcEntity;
  const nonUniform = { a: 2, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  const classification = classifyTransform(nonUniform);
  const affine = classification
    ? transformCadEntityGeometry(b1Entity(), nonUniform, classification)
    : { ok: false, reason: 'SINGULAR' };
  return {
    codePath: 'cadBlocks.ts:72-83 (scales) + cadBlocks.ts:185-198 (mean-radius arc arm)',
    blockRoute: {
      applied: true, refused: false,
      radius: r6(child.radius), meanScaleNote: 'radius * (2+1)/2 = 75; ellipse silently stays an arc',
      startAngleDeg: child.startAngleDeg, endAngleDeg: child.endAngleDeg,
    },
    entityRoute: { ok: (affine as { ok: boolean }).ok, reason: (affine as { reason?: string }).reason },
    refusalCoversBlockRoute: false,
  };
};

const ALL_KINDS: CadSnapKind[] = [
  'point-node', 'endpoint', 'midpoint', 'center', 'arc-midpoint',
  'quadrant', 'intersection', 'apparent-intersection', 'extension',
  'perpendicular', 'parallel', 'direction', 'tangent', 'nearest',
];

const snapContextOf = (project: CadProject, query: { x: number; y: number }) => ({
  project,
  visibleEntities: project.entities,
  segments: [],
  worldPoint: query,
  allowed: new Set<CadSnapKind>(ALL_KINDS),
  constructionContext: { active: false, basePoint: null },
  basePoint: null,
  hasPerpendicularStartSeed: false,
  parallelScope: null,
  extensionScope: null,
  requireExplicitScope: false,
});

const summarize = (cands: Array<{ kind: string; x: number; y: number }>): Record<string, number> => {
  const out: Record<string, number> = {};
  cands.forEach((c) => { out[c.kind] = (out[c.kind] ?? 0) + 1; });
  return out;
};

/** M3: REAL snap candidates + grips for B1, entity-level AND block-level, emitted vs observable. */
export const runSnapGripB1 = (): Record<string, unknown> => {
  const entity = b1Entity();
  const project = createBlankCadProject({ name: 'study', units: 'm' });
  project.entities.push(entity as never);
  const query = { x: STUDY_CENTER.x + STUDY_RADIUS, y: STUDY_CENTER.y };
  const ctx = snapContextOf(project, query);
  const emitted = buildArcEntitySnapCandidates(ctx as never, entity, arcRefFromEntity(project, entity));
  const observable = dedupeCandidates(emitted as never);
  const ref: CadBlockReferenceEntity = {
    id: 'study-ref', type: 'block-reference', layerId: 'L0', name: 'study ref',
    blockDefinitionId: 'study-def', x: 0, y: 0, rotationDeg: 0, scaleX: 1, scaleY: 1,
    visible: true, locked: false,
  } as CadBlockReferenceEntity;
  const blockProject = { ...project, blockDefinitions: [b1Definition()] };
  const blockEmitted = buildBlockReferenceSnapCandidates(
    { ...ctx, project: blockProject, visibleEntities: [ref] } as never, ref,
  );
  const blockObservable = dedupeCandidates(blockEmitted as never);
  const grips = buildCadGripHandles(entity);
  return {
    codePath: 'cadSpatialEntityCandidates.ts:308-341 (arc arm) + cadSpatialBlockSnaps.ts:107+ (block arc arm); dedupe cadSpatialSnapCandidates.ts:34-43',
    entityEmitted: summarize(emitted),
    entityObservable: summarize(observable as never),
    // Two coincident endpoint candidates are emitted; dedupe (kind+1e-9 coords) keeps ONE observable.
    entityEndpointEmitted: emitted.filter((c) => c.kind === 'endpoint').length,
    entityEndpointObservable: (observable as unknown as Array<{ kind: string }>).filter((c) => c.kind === 'endpoint').length,
    blockEndpointEmitted: blockEmitted.filter((c) => c.kind === 'endpoint').length,
    blockEndpointObservable: (blockObservable as unknown as Array<{ kind: string }>).filter((c) => c.kind === 'endpoint').length,
    grips: grips.map((g) => ({ kind: g.kind, x: r6(g.x), y: r6(g.y) })),
    gripsLeaked: grips.filter((g) => g.kind === 'arc-start' || g.kind === 'arc-end').length,
  };
};

/** M5a: REAL arcPathFromPrimitive output for B1/B2/B3 (identity project, scale 1). */
export const runArcPathStudy = (): Record<string, unknown> => {
  const project = (x: number, y: number): { x: number; y: number } => ({ x, y });
  const path = (s: number, e: number): string => arcPathFromPrimitive(
    { kind: 'arc', center: { ...STUDY_CENTER }, radius: STUDY_RADIUS, startAngleDeg: s, endAngleDeg: e } as never,
    project as never, 1,
  );
  const b1 = path(0, 360);
  const b2 = path(30, 390);
  const b3 = path(30, 30);
  const arcs = (d: string): number => (d.match(/ A /g) ?? []).length;
  return {
    codePath: 'SurveyCadPreview.geometry.ts:236-263 (two-180deg branch at |sweep|~=360)',
    b1: { d: b1, arcSegments: arcs(b1), twoArcBranch: arcs(b1) === 2 },
    b2: { d: b2, arcSegments: arcs(b2), twoArcBranch: arcs(b2) === 2 },
    b3: { d: b3, arcSegments: arcs(b3), degenerateSingleArc: arcs(b3) === 1 },
  };
};

/** M5b: REAL DXF ARC serialization bytes for B1; host round trip labelled UNEXECUTED. */
export const runDxfArcB1 = (): Record<string, unknown> => {
  const project = createBlankCadProject({ name: 'study', units: 'm' });
  project.entities.push(b1Entity() as never);
  const model = buildDxfExportModel({ project });
  const dxf = serializeDxfModel(model);
  const lines = dxf.split('\n');
  const idx = lines.findIndex((l, i) => l === 'ARC' && lines[i - 1] === '0');
  const section = idx < 0 ? [] : lines.slice(idx - 1, idx + 25);
  const groups: Record<string, string> = {};
  for (let i = 0; i + 1 < section.length; i += 2) {
    const code = section[i]!;
    if ((code === '50' || code === '51' || code === '40') && !(code in groups)) groups[code] = section[i + 1]!;
  }
  return {
    codePath: 'dxfExportModel.ts:442-460 (verbatim) -> dxfSerializer.ts ARC emitter (groups 50/51)',
    modelArcs: model.arcs.map((a) => ({ startDeg: a.startDeg, endDeg: a.endDeg, radius: a.radius })),
    serializedGroups: groups,
    hasCircleEntity: dxf.includes('\nCIRCLE\n'),
    arcBytes: section.join('\n'),
    hostImportRoundTrip: 'UNEXECUTED prediction (no host available): 0/360 verbatim relies on host normalization.',
  };
};

export const runExecutionStudy = (): Record<string, unknown> => ({
  blockExpansionB1: runBlockExpansionB1(),
  blockNonUniformScale: runBlockNonUniformScale(),
  snapGripB1: runSnapGripB1(),
  arcPath: runArcPathStudy(),
  dxfArcB1: runDxfArcB1(),
});
