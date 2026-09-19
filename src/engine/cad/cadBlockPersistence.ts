import type {
  CadBlockChild,
  CadBlockDefinition,
  CadBlockReferenceEntity,
  CadPointStyle,
  CadProject,
} from './cadTypes';

/**
 * Phase 18N block load-path helpers (backfill + sanitize). Split from
 * cadBlocks.ts: the transform core stays geometry-pure; everything here
 * runs at open/migrate time. Schema stays 2 (additive trailing table);
 * legacy opens with []. Unknown refs never dangle (dropped + diagnostic).
 */
export type CadBlockSanitizeDiagnosticCode =
  | 'CAD_BLOCK_DANGLING_REFERENCE_DROPPED'
  | 'CAD_BLOCK_UNKNOWN_STYLE_MARKER_DROPPED';

export interface CadBlockSanitizeDiagnostic {
  code: CadBlockSanitizeDiagnosticCode;
  message: string;
  entityId?: string;
}

const cloneBlockChild = (child: CadBlockChild): CadBlockChild => {
  switch (child.type) {
    case 'line':
    case 'arc':
      return {
        ...child,
        appearance: child.appearance ? { ...child.appearance } : undefined,
        metadata: child.metadata ? { ...child.metadata } : undefined,
      };
    case 'polyline':
    case 'polygon':
      return {
        ...child,
        appearance: child.appearance ? { ...child.appearance } : undefined,
        vertices: child.vertices.map((vertex) => ({ ...vertex })),
        vertexLabels: [...child.vertexLabels],
        metadata: child.metadata ? { ...child.metadata } : undefined,
      };
    case 'text':
      return {
        ...child,
        appearance: child.appearance ? { ...child.appearance } : undefined,
        metadata: child.metadata ? { ...child.metadata } : undefined,
        ...(child.pointLabel != null
          ? {
              pointLabel: {
                ...child.pointLabel,
                content: { ...child.pointLabel.content },
              },
            }
          : {}),
      };
  }
};

/** Load-time backfill: missing table becomes [] (legacy opens unchanged). */
export const backfillCadBlockDefinitions = (
  definitions: CadBlockDefinition[] | undefined,
): CadBlockDefinition[] =>
  definitions == null
    ? []
    : definitions.map((definition) => ({
        ...definition,
        basePoint: { ...definition.basePoint },
        entities: definition.entities.map(cloneBlockChild),
      }));


/**
 * Load-time sanitize: unknown block refs can never dangle. Dangling
 * block-reference entities are dropped; point styles pointing at unknown
 * definitions fall back to their legacy symbol (field cleared). Pure:
 * returns the patched project + diagnostics (callers surface them; the
 * .wncad open path stays total — a bad ref never fails the open).
 */
export const sanitizeCadBlockReferences = (project: CadProject): {
  project: CadProject;
  diagnostics: CadBlockSanitizeDiagnostic[];
} => {
  const diagnostics: CadBlockSanitizeDiagnostic[] = [];
  const definitions = backfillCadBlockDefinitions(project.blockDefinitions);
  const known = new Set(definitions.map((definition) => definition.id));
  const entities = project.entities.filter((entity) => {
    if (entity.type !== 'block-reference') return true;
    if (known.has((entity as CadBlockReferenceEntity).blockDefinitionId)) return true;
    diagnostics.push({
      code: 'CAD_BLOCK_DANGLING_REFERENCE_DROPPED',
      message: `Block reference "${entity.id}" points at unknown definition "${(entity as CadBlockReferenceEntity).blockDefinitionId}" and was dropped.`,
      entityId: entity.id,
    });
    return false;
  });
  const pointStyles: CadPointStyle[] | undefined = project.pointStyles?.map((style) => {
    if (style.markerBlockDefinitionId != null && !known.has(style.markerBlockDefinitionId)) {
      diagnostics.push({
        code: 'CAD_BLOCK_UNKNOWN_STYLE_MARKER_DROPPED',
        message: `Point style "${style.id}" points at unknown block "${style.markerBlockDefinitionId}"; legacy symbol restored.`,
      });
      const rest: CadPointStyle = { ...style };
      delete rest.markerBlockDefinitionId;
      return rest;
    }
    return { ...style };
  });
  return {
    project: { ...project, blockDefinitions: definitions, entities, ...(pointStyles != null ? { pointStyles } : {}) },
    diagnostics,
  };
};
