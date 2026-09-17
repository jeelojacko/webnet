/**
 * Phase 13D — field-to-finish CAD generation.
 *
 * Pure builder: coded points + feature catalog -> ordinary CAD entities
 * (survey points, line/polyline linework, text labels, layers, styles).
 * No adjustment/GNSS/COGO math here; coordinates pass through untouched.
 *
 * Conventions:
 * - Points are reference-or-create by station id (`pt:<id>`); existing
 *   geometry is never moved by generation (see regeneration.ts for the
 *   explicit coordinate-update path).
 * - Multi-code precedence is deterministic: the first listed point-role
 *   match wins for layer/symbol/label — never import-order random (points
 *   are processed in source order, codes in field order).
 * - Layers/styles are reused by name and created with stable ids, so a
 *   regen never produces EP_1/EP_2 duplicates. Style conflicts reuse the
 *   existing style and record the choice.
 * - Unmapped codes land on the F2F-UNMAPPED layer, preserved + warned.
 */
import { buildCodeIndex, canonicalizeCode, matchCodeToken } from './codeMatching';
import { resolveControlToken, type ControlTokenAliasProfile } from './catalogIo';
import type { FeatureCodeCatalog, FeatureDefinition } from './featureCatalog';
import { FieldLineworkControl, type ParsedFeatureCode } from './featureMetadata';
import { generateLinework, type CodedPointInput } from './linework';
import { linkOfPayload, type LinkOfPayloadSource } from './linkedSync';
import { stampAdjustmentDependency } from '../cad/cadAdjustmentDependency';
import type { ResultDependencyIdentity } from '../resultIntegrity';
import { formatDraftCoordinate } from '../cad/cadLabelEngine';
import { replaceCadProjectEntities } from '../cad/cadProjectState';
import { createCadSelectionState } from '../cad/cadSelection';
import type { CadCommandDefinition } from '../cad/cadTransactions.types';
import type {
  CadEntity,
  CadLayer,
  CadLineEntity,
  CadPolylineEntity,
  CadProject,
  CadStyle,
  CadSurveyPointEntity,
  CadTextEntity,
} from '../cad/cadTypes';

export const FIELD_TO_FINISH_GENERATOR = 'FIELD_TO_FINISH' as const;
export const F2F_UNMAPPED_LAYER_NAME = 'F2F-UNMAPPED';
export const F2F_UNMAPPED_LAYER_ID = 'f2f-layer-unmapped';

export type FieldToFinishEntityState = 'GENERATED' | 'MANUAL_OVERRIDE' | 'DETACHED';

export interface FieldToFinishProvenance {
  generatedBy: typeof FIELD_TO_FINISH_GENERATOR;
  sourceImportId?: string;
  sourceFileHash?: string;
  sourceRecordId?: string;
  sourceStationId?: string;
  featureDefinitionId?: string;
  catalogId?: string;
  catalogVersion?: string;
  generationRunId?: string;
  state: FieldToFinishEntityState;
}

export interface FieldToFinishCadCode {
  code: string;
  rawCode?: string;
  instance?: string;
  controls?: FieldLineworkControl[];
}

export interface FieldToFinishCadPoint {
  stationId: string;
  x: number;
  y: number;
  z?: number;
  sourceOrder: number;
  sourceLine?: number;
  sourceRecordId?: string;
  rawCodeText?: string;
  codes: FieldToFinishCadCode[];
  description?: string;
  sourceImportId?: string;
  sourceFileHash?: string;
}

export interface FieldToFinishLabelOptions {
  includeId?: boolean;
  includeDescription?: boolean;
  includeCode?: boolean;
  includeElevation?: boolean;
}

export interface FieldToFinishCadArgs {
  points: FieldToFinishCadPoint[];
  catalog: FeatureCodeCatalog;
  generationRunId: string;
  controlTokenAliases?: ControlTokenAliasProfile;
  labels?: FieldToFinishLabelOptions;
  /**
   * Link source context for adjustment-backed generation. Coordinate-import
   * callers omit this (link stamps 'coordinate-import', never auto-synced).
   */
  source?: LinkOfPayloadSource;
  /**
   * Phase 17E: stamp generated entities so they evaluate CURRENT against
   * the commit-time result. Honored only when sourceKind==='adjustment';
   * absent = today's unstamped behavior (fail-closed).
   */
  resultDependencyIdentity?: ResultDependencyIdentity | null;
}

export interface FieldToFinishWarning {
  code: string;
  pointId?: string;
  message: string;
}

export interface FieldToFinishStyleChoice {
  requested: string;
  reused: string;
  reason: string;
}

/** Serializable payload applied by the F2F_GENERATE command (one transaction). */
export interface FieldToFinishCadPayload {
  layersToAdd: CadLayer[];
  stylesToAdd: CadStyle[];
  upsertEntities: CadEntity[];
  removeEntityIds: string[];
  label: string;
  /**
   * Link source context stamped by linkOfPayload. Only set when the caller
   * provides it; absent = coordinate import (the historical default).
   * Adjustment-backed generations set sourceKind 'adjustment' plus run
   * fingerprints so rerun auto-sync applies to the resulting link.
   */
  source?: LinkOfPayloadSource;
  /**
   * Phase 17E: commit-time result identity, carried through the undoable
   * command so generated entities stamp CURRENT on apply. Set only for
   * adjustment-backed generations; absent = unstamped (fail-closed).
   */
  resultDependencyIdentity?: ResultDependencyIdentity | null;
}

export interface FieldToFinishCadResult {
  project: CadProject;
  payload: FieldToFinishCadPayload;
  addedEntityIds: string[];
  updatedEntityIds: string[];
  warnings: FieldToFinishWarning[];
  styleChoices: FieldToFinishStyleChoice[];
  stats: { points: number; linework: number; labels: number; unmapped: number };
}

interface ResolvedCode {
  entry: ParsedFeatureCode;
  definitionId?: string;
  definition?: FeatureDefinition;
}

const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'layer';

const PALETTE = [
  '#38bdf8', '#22c55e', '#f59e0b', '#f472b6', '#a78bfa', '#facc15',
  '#34d399', '#fb7185', '#60a5fa', '#f97316', '#2dd4bf', '#e879f9',
];

const colorForName = (name: string): string => {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  return PALETTE[hash % PALETTE.length] ?? '#94a3b8';
};

const provenanceOf = (entity: CadEntity): FieldToFinishProvenance | undefined => {
  const metadata = entity.metadata;
  if (typeof metadata !== 'object' || metadata == null) return undefined;
  const record = (metadata as Record<string, unknown>)['provenance'];
  if (typeof record !== 'object' || record == null) return undefined;
  const typed = record as Record<string, unknown>;
  if (typed['generatedBy'] !== FIELD_TO_FINISH_GENERATOR) return undefined;
  return typed as unknown as FieldToFinishProvenance;
};

export const isFieldToFinishEntity = (entity: CadEntity): boolean =>
  provenanceOf(entity) !== undefined;

export const getFieldToFinishState = (entity: CadEntity): FieldToFinishEntityState | undefined =>
  provenanceOf(entity)?.state;

/**
 * True when any F2F MANUAL_OVERRIDE entity is tied to one of the given
 * stations. DETACHED entities never count — detaching cuts the entity
 * loose silently. Unrecognized entity shapes count conservatively so a
 * manual override can never hide behind an unknown linkage.
 */
export const hasLinkedManualOverrides = (
  entities: readonly CadEntity[],
  stationIds: ReadonlySet<string> | readonly string[],
): boolean => {
  const linked = stationIds instanceof Set ? stationIds : new Set(stationIds);
  return entities.some((entity) => {
    if (!isFieldToFinishEntity(entity) || getFieldToFinishState(entity) !== 'MANUAL_OVERRIDE') return false;
    if (entity.type === 'survey-point') return linked.has(entity.stationId);
    const metadata = (entity.metadata ?? {}) as Record<string, unknown>;
    if (typeof metadata['stationId'] === 'string') return linked.has(metadata['stationId']);
    const sourcePointIds = metadata['sourcePointIds'];
    if (Array.isArray(sourcePointIds)) {
      return sourcePointIds.some((id) => typeof id === 'string' && linked.has(id));
    }
    if (entity.type === 'line') return linked.has(entity.fromStationId) || linked.has(entity.toStationId);
    if (entity.type === 'polyline') return entity.vertexLabels.some((label) => linked.has(label));
    if (entity.type === 'text' && typeof entity.anchorEntityId === 'string' && entity.anchorEntityId.startsWith('pt:')) {
      return linked.has(entity.anchorEntityId.slice('pt:'.length));
    }
    return true;
  });
};

/**
 * Per-chain linework equality for regen diffing. Compares content only —
 * `generationRunId` is a stamp, not geometry, so a regen with no source
 * change compares equal and the existing entity is kept byte-identical.
 */
export const isSameFieldToFinishLinework = (a: CadEntity, b: CadEntity): boolean => {
  const strip = (entity: CadEntity): unknown => {
    const metadata = { ...(entity.metadata ?? {}) } as Record<string, unknown>;
    const provenance = metadata['provenance'];
    if (typeof provenance === 'object' && provenance !== null) {
      const { generationRunId: _ignored, ...rest } = provenance as Record<string, unknown>;
      metadata['provenance'] = rest;
    }
    const { id: _id, ...body } = entity as unknown as Record<string, unknown>;
    return { ...body, metadata };
  };
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
};

const splitInstance = (token: string): { code: string; instance?: string } => {
  const match = /^([^\d\s]+)(\d+)$/.exec(token.trim());
  if (match?.[1]) return { code: match[1], ...(match[2] ? { instance: match[2] } : {}) };
  return { code: token.trim() };
};

/**
 * Normalize one raw code entry into parsed codes. Entries that already
 * carry controls/instance pass through; combined strings ("EP1 BEGIN")
 * split into code + instance + controls. A segment that matches the code
 * index starts a new code, otherwise a resolvable control token attaches
 * to the current code.
 */
const normalizeEntry = (
  raw: string,
  givenInstance: string | undefined,
  givenControls: FieldLineworkControl[] | undefined,
  index: ReadonlyMap<string, string>,
  aliases: ControlTokenAliasProfile,
): ParsedFeatureCode[] => {
  if (givenControls !== undefined || givenInstance !== undefined) {
    const split = splitInstance(raw);
    return [{
      code: canonicalizeCode(split.code),
      rawCode: raw,
      role: 'both',
      ...(givenInstance ?? split.instance ? { instance: givenInstance ?? split.instance } : {}),
      controls: givenControls ?? [],
    }];
  }
  const segments = raw.trim().split(/\s+/).filter((part) => part.length > 0);
  const parsed: ParsedFeatureCode[] = [];
  for (const segment of segments) {
    const fullHit = matchCodeToken(segment, index) !== undefined;
    const split = splitInstance(segment);
    const splitHit = !fullHit && matchCodeToken(split.code, index) !== undefined;
    if (fullHit || splitHit) {
      const code = fullHit ? segment : split.code;
      parsed.push({
        code: canonicalizeCode(code),
        rawCode: segment,
        role: 'both',
        ...(fullHit ? {} : { instance: split.instance }),
        controls: [],
      });
      continue;
    }
    const control = resolveControlToken(segment, aliases);
    const current = parsed[parsed.length - 1];
    if (control && current) {
      current.controls.push(control);
      continue;
    }
    parsed.push({ code: canonicalizeCode(segment), rawCode: segment, role: 'both', controls: [] });
  }
  return parsed.length > 0 ? parsed : [{ code: '', rawCode: raw, role: 'both', controls: [] }];
};

const resolvePointCodes = (
  point: FieldToFinishCadPoint,
  index: ReadonlyMap<string, string>,
  defsById: ReadonlyMap<string, FeatureDefinition>,
  aliases: ControlTokenAliasProfile,
): ResolvedCode[] =>
  point.codes.flatMap((code) =>
    normalizeEntry(code.code, code.instance, code.controls, index, aliases).map((entry) => {
      const definitionId = entry.code ? matchCodeToken(entry.code, index) : undefined;
      const definition = definitionId ? defsById.get(definitionId) : undefined;
      return {
        entry,
        ...(definitionId ? { definitionId } : {}),
        ...(definition ? { definition } : {}),
      };
    }),
  );

/** First listed point-role match wins (deterministic, field order). */
const selectPrimary = (resolved: ResolvedCode[]): ResolvedCode | undefined =>
  resolved.find((item) => item.definition?.pointBehavior === 'point');

const layerIdFor = (name: string): string =>
  name === F2F_UNMAPPED_LAYER_NAME ? F2F_UNMAPPED_LAYER_ID : `f2f-layer-${slug(name)}`;

const buildLabelText = (
  point: FieldToFinishCadPoint,
  primaryCode: string | undefined,
  options: FieldToFinishLabelOptions,
): string => {
  const parts: string[] = [];
  if (options.includeId !== false) parts.push(point.stationId);
  if (options.includeDescription !== false && point.description) parts.push(point.description);
  if (options.includeCode !== false && primaryCode) parts.push(primaryCode);
  if (options.includeElevation !== false && Number.isFinite(point.z)) {
    parts.push(`EL ${formatDraftCoordinate(point.z as number)}`);
  }
  return parts.join(' ');
};

const buildProvenance = (
  point: FieldToFinishCadPoint,
  args: FieldToFinishCadArgs,
  definitionId: string | undefined,
): FieldToFinishProvenance => ({
  generatedBy: FIELD_TO_FINISH_GENERATOR,
  ...(point.sourceImportId ? { sourceImportId: point.sourceImportId } : {}),
  ...(point.sourceFileHash ? { sourceFileHash: point.sourceFileHash } : {}),
  sourceRecordId: point.sourceRecordId ?? (point.sourceLine !== undefined ? String(point.sourceLine) : point.stationId),
  sourceStationId: point.stationId,
  ...(definitionId ? { featureDefinitionId: definitionId } : {}),
  catalogId: args.catalog.id,
  catalogVersion: args.catalog.version,
  generationRunId: args.generationRunId,
  state: 'GENERATED',
});

export const buildFieldToFinishPayload = (
  project: CadProject,
  args: FieldToFinishCadArgs,
): Omit<FieldToFinishCadResult, 'project'> => {
  const aliases = args.controlTokenAliases ?? {};
  const labelOptions = args.labels ?? {};
  const index = buildCodeIndex(args.catalog.definitions, args.catalog.aliases);
  const defsById = new Map(args.catalog.definitions.map((def) => [def.id, def]));
  const ordered = [...args.points].sort(
    (a, b) => a.sourceOrder - b.sourceOrder || (a.stationId < b.stationId ? -1 : a.stationId > b.stationId ? 1 : 0),
  );

  const layers = new Map(project.layers.map((layer) => [layer.name, layer]));
  const layersToAdd: CadLayer[] = [];
  const stylesByName = new Map(project.styleLibrary.styles.map((style) => [style.name, style]));
  const stylesToAdd: CadStyle[] = [];
  const warnings: FieldToFinishWarning[] = [];
  const styleChoices: FieldToFinishStyleChoice[] = [];
  const upsertEntities: CadEntity[] = [];
  const addedEntityIds: string[] = [];
  const updatedEntityIds: string[] = [];
  const existingById = new Map(project.entities.map((entity) => [entity.id, entity]));
  const coordsByStation = new Map(ordered.map((point) => [point.stationId, point]));

  const ensureLayer = (name: string): CadLayer => {
    const existing = layers.get(name);
    if (existing) return existing;
    const layer: CadLayer = {
      id: layerIdFor(name),
      name,
      color: colorForName(name),
      visible: true,
      locked: false,
      printable: true,
      lineweightMm: 0.25,
      role: 'points',
    };
    layers.set(name, layer);
    layersToAdd.push(layer);
    return layer;
  };

  const resolveStyleId = (definition: FeatureDefinition | undefined, layer: CadLayer): string => {
    if (definition?.styleId) {
      const existing = project.styleLibrary.styles.find((style) => style.id === definition.styleId)
        ?? stylesToAdd.find((style) => style.id === definition.styleId);
      if (existing) return existing.id;
      styleChoices.push({
        requested: definition.styleId,
        reused: `f2f-style-${slug(layer.name)}`,
        reason: `Style "${definition.styleId}" missing; deterministic catalog style reused.`,
      });
    }
    const styleName = layer.name;
    const existingByName = stylesByName.get(styleName);
    if (existingByName) {
      styleChoices.push({
        requested: `f2f-style-${slug(layer.name)}`,
        reused: existingByName.id,
        reason: `Style "${styleName}" already exists; reused without duplication.`,
      });
      return existingByName.id;
    }
    let pointSymbolId = definition?.pointSymbolId ?? 'point-free';
    const symbolKnown = project.styleLibrary.pointSymbols.some((symbol) => symbol.id === pointSymbolId);
    if (!symbolKnown) {
      styleChoices.push({ requested: pointSymbolId, reused: 'point-free', reason: `Point symbol "${pointSymbolId}" missing; default reused.` });
      pointSymbolId = 'point-free';
    }
    const style: CadStyle = {
      id: `f2f-style-${slug(layer.name)}`,
      name: styleName,
      color: layer.color,
      strokeWidth: 1.2,
      pointSymbolId,
    };
    stylesByName.set(styleName, style);
    stylesToAdd.push(style);
    return style.id;
  };

  const pointInputs: CodedPointInput[] = [];
  let unmapped = 0;

  for (const point of ordered) {
    const resolved = resolvePointCodes(point, index, defsById, aliases);
    const primary = selectPrimary(resolved);
    const matchedAny = resolved.some((item) => item.definition !== undefined);
    if (!matchedAny) {
      unmapped += 1;
      warnings.push({ code: 'F2F_UNMAPPED', pointId: point.stationId, message: `No catalog match for "${point.rawCodeText ?? point.codes.map((c) => c.code).join(' ')}"; kept on ${F2F_UNMAPPED_LAYER_NAME}.` });
    }
    for (const item of resolved) {
      if (!item.definition) {
        warnings.push({ code: 'F2F_UNMAPPED_CODE', pointId: point.stationId, message: `Code "${item.entry.rawCode}" has no catalog entry; preserved without geometry.` });
      }
    }
    const layerDef = primary?.definition ?? resolved.find((item) => item.definition !== undefined)?.definition;
    const layer = ensureLayer(layerDef?.layer ?? F2F_UNMAPPED_LAYER_NAME);
    const styleId = resolveStyleId(layerDef, layer);
    const primaryCode = primary ? canonicalizeCode(primary.entry.code) : undefined;
    const featureCodes = [...new Set(resolved.map((item) => canonicalizeCode(item.entry.code)).filter((code) => code))].sort();
    const activeDefinitionId = resolved.find((item) => item.definition === layerDef)?.definitionId;
    const provenance = buildProvenance(point, args, activeDefinitionId);

    const pointId = `pt:${point.stationId}`;
    const existing = existingById.get(pointId);
    if (existing?.type === 'survey-point') {
      const state = getFieldToFinishState(existing);
      if (state === 'MANUAL_OVERRIDE') {
        warnings.push({ code: 'F2F_MANUAL', pointId: point.stationId, message: 'Manual override kept; generation stamp skipped.' });
      } else if (existing.metadata?.['manual'] === true && !isFieldToFinishEntity(existing)) {
        // Pure-manual point: reference only, never overwrite user content.
      } else {
        upsertEntities.push({
          ...existing,
          description: point.description ?? existing.description,
          ...(primaryCode ? { featureCode: primaryCode } : {}),
          metadata: { ...(existing.metadata ?? {}), featureCodes, provenance },
        });
        updatedEntityIds.push(pointId);
      }
    } else if (!existing) {
      const created: CadSurveyPointEntity = {
        id: pointId,
        type: 'survey-point',
        layerId: layer.id,
        styleId,
        visible: true,
        locked: false,
        stationId: point.stationId,
        x: point.x,
        y: point.y,
        ...(point.z !== undefined ? { z: point.z } : {}),
        pointClass: 'free',
        source: project.metadata.source,
        ...(point.description ? { description: point.description } : {}),
        ...(primaryCode ? { featureCode: primaryCode } : {}),
        metadata: { featureCodes, provenance },
      };
      upsertEntities.push(created);
      addedEntityIds.push(pointId);
    }

    const suppressLabel = layerDef?.pointBehavior === 'none';
    if (!suppressLabel) {
      const labelId = `label:${point.stationId}`;
      const existingLabel = existingById.get(labelId);
      const labelLayer = project.layers.find((entry) => entry.name === 'Labels')?.id
        ?? project.layers.find((entry) => entry.id === 'labels')?.id
        ?? layer.id;
      const text = buildLabelText(point, primaryCode, labelOptions);
      const labelProvenance: FieldToFinishProvenance = { ...provenance, sourceRecordId: `${provenance.sourceRecordId ?? point.stationId}:label` };
      if (existingLabel?.type === 'text') {
        const state = getFieldToFinishState(existingLabel);
        if (state === 'MANUAL_OVERRIDE' || (existingLabel.metadata?.['manual'] === true && !isFieldToFinishEntity(existingLabel))) {
          if (state === 'MANUAL_OVERRIDE') {
            warnings.push({ code: 'F2F_MANUAL', pointId: point.stationId, message: 'Manual label kept; auto text skipped.' });
          }
        } else {
          upsertEntities.push({
            ...existingLabel,
            text,
            anchorEntityId: pointId,
            metadata: { ...(existingLabel.metadata ?? {}), stationId: point.stationId, featureCodes, provenance: labelProvenance },
          });
          updatedEntityIds.push(labelId);
        }
      } else if (!existingLabel) {
        const label: CadTextEntity = {
          id: labelId,
          type: 'text',
          layerId: labelLayer,
          styleId: project.styleLibrary.styles.some((style) => style.id === 'style-label') ? 'style-label' : styleId,
          visible: true,
          locked: false,
          x: point.x,
          y: point.y,
          text,
          anchorEntityId: pointId,
          metadata: { stationId: point.stationId, featureCodes, provenance: labelProvenance },
        };
        upsertEntities.push(label);
        addedEntityIds.push(labelId);
      }
    }

    pointInputs.push({
      pointId: point.stationId,
      sourceOrder: point.sourceOrder,
      ...(point.sourceLine !== undefined ? { sourceLine: point.sourceLine } : {}),
      feature: {
        rawCodeText: point.rawCodeText,
        codes: resolved.map((item) => item.entry),
        description: point.description,
        sourceOrder: point.sourceOrder,
      },
    });
  }

  // Deterministic label deconfliction: sorted ids, stacked offsets on collision.
  const labelUpserts = upsertEntities.filter((entity): entity is CadTextEntity => entity.type === 'text');
  labelUpserts.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const occupied = new Set<string>();
  for (const label of labelUpserts) {
    const base = label.anchorEntityId ? coordsByStation.get(label.anchorEntityId.replace(/^pt:/, '')) : undefined;
    if (base) {
      label.x = base.x;
      label.y = base.y;
    }
    let key = `${label.x.toFixed(3)},${label.y.toFixed(3)}`;
    let bump = 0;
    while (occupied.has(key)) {
      bump += 1;
      label.y = Math.round((label.y + 0.5) * 1000) / 1000;
      key = `${label.x.toFixed(3)},${label.y.toFixed(3)}`;
    }
    void bump;
    occupied.add(key);
  }

  // Linework via the shared engine (source order inside generateLinework).
  const linework = generateLinework(pointInputs, args.catalog);
  for (const diagnostic of linework.diagnostics) {
    warnings.push({
      code: diagnostic.severity === 'fail' ? 'F2F_LINEWORK_FAIL' : 'F2F_LINEWORK_WARN',
      pointId: diagnostic.pointId,
      message: diagnostic.message,
    });
  }
  let lineworkCount = 0;
  for (const chain of linework.chains) {
    if (chain.vertices.length < 2) continue;
    const coords = chain.vertices.map((vertex) => ({
      vertex,
      point: coordsByStation.get(vertex.pointId),
    }));
    if (coords.some((entry) => !entry.point)) {
      warnings.push({ code: 'F2F_LINEWORK_FAIL', message: `Chain "${chain.code}" references missing coordinates; skipped.` });
      continue;
    }
    const layer = ensureLayer(chain.layer);
    const definition = chain.definitionId ? defsById.get(chain.definitionId) : undefined;
    const styleId = resolveStyleId(definition, layer);
    const entityId = `f2f-lw-${slug(chain.code)}${chain.instance ? `-${slug(chain.instance)}` : ''}-${chain.vertices[0]?.sourceOrder ?? 0}`;
    const existingLinework = existingById.get(entityId);
    const sourcePointIds = chain.vertices.map((vertex) => vertex.pointId);
    const provenance: FieldToFinishProvenance = {
      generatedBy: FIELD_TO_FINISH_GENERATOR,
      catalogId: args.catalog.id,
      catalogVersion: args.catalog.version,
      generationRunId: args.generationRunId,
      ...(chain.definitionId ? { featureDefinitionId: chain.definitionId } : {}),
      state: 'GENERATED',
    };
    const metadata = {
      featureCode: canonicalizeCode(chain.code),
      ...(chain.instance !== undefined ? { instance: chain.instance } : {}),
      sourcePointIds,
      sourceOrder: chain.vertices[0]?.sourceOrder ?? 0,
      ...(chain.definitionId ? { definitionId: chain.definitionId } : {}),
      provenance,
    };
    // Stable regen identity per chain (code+instance+sourceOrder): never
    // duplicate. Unchanged chains re-upsert the existing entity so regen
    // keeps them byte-identical; changed chains update in place; only
    // chains whose source coding vanished disappear (see regeneration.ts).
    const keepVisible = existingLinework?.visible ?? true;
    const keepLocked = existingLinework?.locked ?? false;
    let next: CadLineEntity | CadPolylineEntity;
    if (chain.vertices.length === 2) {
      const from = coords[0] as { vertex: { pointId: string }; point: FieldToFinishCadPoint };
      const to = coords[1] as { vertex: { pointId: string }; point: FieldToFinishCadPoint };
      next = {
        id: entityId,
        type: 'line',
        layerId: layer.id,
        styleId,
        visible: keepVisible,
        locked: keepLocked,
        fromStationId: from.vertex.pointId,
        toStationId: to.vertex.pointId,
        fromX: from.point.x,
        fromY: from.point.y,
        toX: to.point.x,
        toY: to.point.y,
        sourceObservationIds: [],
        metadata,
      };
    } else {
      next = {
        id: entityId,
        type: 'polyline',
        layerId: layer.id,
        styleId,
        visible: keepVisible,
        locked: keepLocked,
        vertices: coords.map((entry) => ({ x: (entry.point as FieldToFinishCadPoint).x, y: (entry.point as FieldToFinishCadPoint).y })),
        vertexLabels: sourcePointIds,
        closed: chain.closed,
        metadata,
      };
    }
    if (!existingLinework) {
      upsertEntities.push(next);
      addedEntityIds.push(entityId);
      lineworkCount += 1;
    } else if (existingLinework.type !== 'line' && existingLinework.type !== 'polyline') {
      upsertEntities.push(next);
      updatedEntityIds.push(entityId);
    } else {
      const state = getFieldToFinishState(existingLinework);
      if (state === 'MANUAL_OVERRIDE' || state === 'DETACHED'
        || (existingLinework.metadata?.['manual'] === true && !isFieldToFinishEntity(existingLinework))) {
        warnings.push({ code: 'F2F_MANUAL', message: `Manual linework "${entityId}" kept; auto geometry skipped.` });
        upsertEntities.push(existingLinework);
      } else if (isSameFieldToFinishLinework(existingLinework, next)) {
        upsertEntities.push(existingLinework);
      } else {
        upsertEntities.push(next);
        updatedEntityIds.push(entityId);
      }
    }
  }

  // Phase 17E: stamp adjustment-backed generations so fresh commits
  // evaluate CURRENT. Coordinate-import commits never stamp — their
  // lineage tracking is out of scope and they must stay exportable.
  const commitIdentity = args.source?.sourceKind === 'adjustment'
    ? args.resultDependencyIdentity ?? null
    : null;
  const stampedUpserts = commitIdentity
    ? upsertEntities.map((entity) => stampAdjustmentDependency(entity, commitIdentity))
    : upsertEntities;
  const payload: FieldToFinishCadPayload = {
    layersToAdd,
    stylesToAdd,
    upsertEntities: stampedUpserts,
    removeEntityIds: [],
    label: `FIELD_TO_FINISH (${ordered.length} points, ${lineworkCount} linework)`,
    ...(args.source !== undefined ? { source: { ...args.source } } : {}),
    ...(commitIdentity ? { resultDependencyIdentity: commitIdentity } : {}),
  };
  return {
    payload,
    addedEntityIds: [...addedEntityIds].sort(),
    updatedEntityIds: [...updatedEntityIds].sort(),
    warnings,
    styleChoices,
    stats: {
      points: ordered.length,
      linework: lineworkCount,
      labels: labelUpserts.length,
      unmapped,
    },
  };
};

/** Apply a built payload to a project (pure; the command below wraps this). */
export const applyFieldToFinishPayload = (
  project: CadProject,
  payload: FieldToFinishCadPayload,
): CadProject => {
  // Phase 17E: the undoable command path stamps here so hand-built
  // payloads carrying an adjustment identity also commit CURRENT.
  // Idempotent with the builder stamp; coordinate-import never stamps.
  const commitIdentity = payload.source?.sourceKind === 'adjustment'
    ? payload.resultDependencyIdentity ?? null
    : null;
  const upserts = commitIdentity
    ? payload.upsertEntities.map((entity) => stampAdjustmentDependency(entity, commitIdentity))
    : payload.upsertEntities;
  const layerNames = new Set(project.layers.map((layer) => layer.name));
  const layerIds = new Set(project.layers.map((layer) => layer.id));
  const layers = [
    ...project.layers,
    ...payload.layersToAdd.filter((layer) => !layerIds.has(layer.id) && !layerNames.has(layer.name)),
  ];
  const styleIds = new Set(project.styleLibrary.styles.map((style) => style.id));
  const styleNames = new Set(project.styleLibrary.styles.map((style) => style.name));
  const styles = [
    ...project.styleLibrary.styles,
    ...payload.stylesToAdd.filter((style) => !styleIds.has(style.id) && !styleNames.has(style.name)),
  ];
  const removed = new Set(payload.removeEntityIds);
  const upsert = new Map(upserts.map((entity) => [entity.id, entity]));
  const entities = project.entities
    .filter((entity) => !removed.has(entity.id))
    .map((entity) => upsert.get(entity.id) ?? entity);
  const known = new Set(entities.map((entity) => entity.id));
  for (const entity of upserts) {
    if (!known.has(entity.id)) entities.push(entity);
  }
  entities.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const withEntities = replaceCadProjectEntities(
    { ...project, layers, styleLibrary: { ...project.styleLibrary, styles } },
    entities,
  );
  const link = linkOfPayload(payload, project.metadata.fieldToFinishLink?.sourceRevision);
  if (!link) return withEntities;
  // Recompute conflict status from the surviving entities: MANUAL_OVERRIDE
  // entities preserved/skipped by the payload (points, labels, linework)
  // keep the fresh link from reading CURRENT. A confirmed regen that drops
  // every override returns to CURRENT; DETACHED never counts.
  const stamped: typeof link = hasLinkedManualOverrides(withEntities.entities, link.stationIds)
    ? { ...link, status: 'MANUAL_CONFLICT' }
    : link;
  return {
    ...withEntities,
    metadata: { ...withEntities.metadata, fieldToFinishLink: stamped },
  };
};

export const buildFieldToFinishProject = (
  project: CadProject,
  args: FieldToFinishCadArgs,
): FieldToFinishCadResult => {
  const built = buildFieldToFinishPayload(project, args);
  return { project: applyFieldToFinishPayload(project, built.payload), ...built };
};

export const f2fGenerateCommand: CadCommandDefinition<{ key: 'F2F_GENERATE'; payload: FieldToFinishCadPayload }> = {
  key: 'F2F_GENERATE',
  execute: (snapshot, command) => {
    if (command.payload.upsertEntities.length === 0 && command.payload.removeEntityIds.length === 0) return null;
    const nextProject = applyFieldToFinishPayload(snapshot.project, command.payload);
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, snapshot.selection.selectedEntityIds),
      },
      commandState: {
        key: 'F2F_GENERATE',
        phase: 'committed',
        prompt: `${command.payload.label} committed.`,
      },
      transactionLabel: command.payload.label,
      addedEntityIds: command.payload.upsertEntities.map((entity) => entity.id),
      removedEntityIds: [...command.payload.removeEntityIds],
    };
  },
};
