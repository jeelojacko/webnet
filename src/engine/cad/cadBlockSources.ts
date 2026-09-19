import { checkCadEntityEditable } from './cadAppearance';
import type { CadBlockReferenceEntity, CadEntity, CadProject } from './cadTypes';

/**
 * Phase 18N block source eligibility + reference-safety queries (pure).
 * Eligible: line/polyline/arc/polygon/text-without-pointLabel. Semantic
 * objects (survey-point/alignment/parcel/error-ellipse, nested
 * block-reference, point-label text) fail with explicit codes — never
 * silent loss. Shared by the transactions and (later) the manager UI.
 */

export type CadBlockCommandError =
  | 'CAD_BLOCK_UNKNOWN_DEFINITION'
  | 'CAD_BLOCK_DUPLICATE_NAME'
  | 'CAD_BLOCK_EMPTY_NAME'
  | 'CAD_BLOCK_NO_SOURCES'
  | 'CAD_BLOCK_SEMANTIC_UNSUPPORTED'
  | 'CAD_BLOCK_SOURCE_NOT_EDITABLE'
  | 'CAD_BLOCK_INVALID_DEFINITION'
  | 'CAD_BLOCK_INVALID_TRANSFORM'
  | 'CAD_BLOCK_REFERENCED';

const SEMANTIC_TYPES = new Set(['survey-point', 'alignment', 'parcel', 'error-ellipse', 'block-reference']);

export const isBlockEligibleSource = (entity: CadEntity): boolean => {
  switch (entity.type) {
    case 'line':
    case 'polyline':
    case 'arc':
    case 'polygon':
      return true;
    case 'text':
      return entity.pointLabel == null;
    default:
      return false;
  }
};

export interface ClassifiedBlockSources {
  eligible: CadEntity[];
  ineligible: Array<{ id: string; code: CadBlockCommandError }>;
}

/** Split sources into eligible vs explicitly-coded ineligible (never silent). */
export const classifyBlockSources = (
  project: CadProject,
  entities: CadEntity[],
): ClassifiedBlockSources => {
  const eligible: CadEntity[] = [];
  const ineligible: ClassifiedBlockSources['ineligible'] = [];
  for (const entity of entities) {
    if (SEMANTIC_TYPES.has(entity.type)) {
      ineligible.push({ id: entity.id, code: 'CAD_BLOCK_SEMANTIC_UNSUPPORTED' });
      continue;
    }
    if (!isBlockEligibleSource(entity)) {
      ineligible.push({ id: entity.id, code: 'CAD_BLOCK_SEMANTIC_UNSUPPORTED' });
      continue;
    }
    if (!checkCadEntityEditable(project, entity).editable) {
      ineligible.push({ id: entity.id, code: 'CAD_BLOCK_SOURCE_NOT_EDITABLE' });
      continue;
    }
    eligible.push(entity);
  }
  return { eligible, ineligible };
};

/** Representative anchor per eligible type (centroid input for basePoint default). */
export const blockSourceAnchors = (entity: CadEntity): Array<{ x: number; y: number }> => {
  switch (entity.type) {
    case 'line':
      return [{ x: entity.fromX, y: entity.fromY }, { x: entity.toX, y: entity.toY }];
    case 'polyline':
    case 'polygon':
      return entity.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y }));
    case 'arc':
      return [{ x: entity.centerX, y: entity.centerY }];
    case 'text':
      return [{ x: entity.x, y: entity.y }];
    default:
      return [];
  }
};

export const referencingBlockEntities = (
  project: CadProject,
  definitionId: string,
): CadBlockReferenceEntity[] =>
  project.entities.filter(
    (entity): entity is CadBlockReferenceEntity =>
      entity.type === 'block-reference' && entity.blockDefinitionId === definitionId,
  );

export const referencingBlockPointStyles = (project: CadProject, definitionId: string): string[] =>
  (project.pointStyles ?? [])
    .filter((style) => style.markerBlockDefinitionId === definitionId)
    .map((style) => style.id);

/** Reference-safety report for UI confirms (counts incl. point styles). */
export const describeBlockReferences = (
  project: CadProject,
  definitionId: string,
): { referenceIds: string[]; pointStyleIds: string[] } => ({
  referenceIds: referencingBlockEntities(project, definitionId).map((entity) => entity.id),
  pointStyleIds: referencingBlockPointStyles(project, definitionId),
});
