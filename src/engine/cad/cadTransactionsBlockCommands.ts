import { createStableRuntimeId } from '../id';
import { checkCadEntityEditable, resolveCadEntityAppearance } from './cadAppearance';
import {
  expandBlockReference,
  findBlockDefinition,
  normalizeBlockScales,
  resolveBlockChildAppearance,
  validateBlockDefinition,
} from './cadBlocks';
import { resolveCurrentCadLayerId } from './cadLayers';
import {
  blockSourceAnchors,
  classifyBlockSources,
  referencingBlockEntities,
  referencingBlockPointStyles,
} from './cadBlockSources';
import { replaceCadProjectEntities } from './cadProjectState';
import { ensureSurveySymbolsSeeded } from './cadSurveySymbolLibrary';
import { commitLayerProject } from './cadTransactionsLayerCommands';
import type {
  CadCommand,
  CadCommandDefinition,
} from './cadTransactions.types';
import type {
  CadBlockChild,
  CadBlockDefinition,
  CadBlockReferenceEntity,
  CadEntity,
  CadProject,
} from './cadTypes';
import { createCadSelectionState } from './cadSelection';

/**
 * Phase 18N block transactions (undoable CadCommands over history).
 * Eligible sources: line/polyline/arc/polygon/text-without-pointLabel.
 * Semantic objects (survey-point/alignment/parcel/error-ellipse, and nested
 * block-reference) fail with CAD_BLOCK_SEMANTIC_UNSUPPORTED — never silent
 * loss. All failures return null (fail-closed, all-or-nothing).
 */

export { describeBlockReferences } from './cadBlockSources';

const defaultBasePoint = (entities: CadEntity[]): { x: number; y: number } => {
  const points = entities.flatMap(blockSourceAnchors);
  if (points.length === 0) return { x: 0, y: 0 };
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
};

const isNameTaken = (project: CadProject, name: string, exceptId?: string): boolean => {
  const lowered = name.trim().toLowerCase();
  return (project.blockDefinitions ?? []).some(
    (definition) => definition.id !== exceptId && definition.name.trim().toLowerCase() === lowered,
  );
};

const toBlockChild = (entity: CadEntity): CadBlockChild => ({ ...entity }) as CadBlockChild;

const withDefinitions = (project: CadProject, definitions: CadBlockDefinition[]): CadProject => ({
  ...project,
  blockDefinitions: definitions,
});

type CreateCommand = Extract<CadCommand, { key: 'BLOCK_CREATE' }>;
type InsertCommand = Extract<CadCommand, { key: 'BLOCK_INSERT' }>;
type ExplodeCommand = Extract<CadCommand, { key: 'BLOCK_EXPLODE' }>;
type RedefineCommand = Extract<CadCommand, { key: 'BLOCK_REDEFINE' }>;
type RenameCommand = Extract<CadCommand, { key: 'BLOCK_RENAME' }>;
type DuplicateCommand = Extract<CadCommand, { key: 'BLOCK_DUPLICATE' }>;
type DeleteCommand = Extract<CadCommand, { key: 'BLOCK_DELETE' }>;

const blockCreateCommand: CadCommandDefinition<CreateCommand> = {
  key: 'BLOCK_CREATE',
  execute: (snapshot, command) => {
    const name = command.name.trim();
    if (name.length === 0 || isNameTaken(snapshot.project, name)) return null;
    const byId = new Map(snapshot.project.entities.map((entity) => [entity.id, entity]));
    const sources = command.sourceEntityIds.map((id) => byId.get(id));
    if (sources.some((entity) => entity == null)) return null;
    const { eligible, ineligible } = classifyBlockSources(snapshot.project, sources as CadEntity[]);
    if (ineligible.length > 0 || eligible.length === 0) return null;
    const definition: CadBlockDefinition = {
      id: createStableRuntimeId('cad-block'),
      name,
      basePoint: command.basePoint ?? defaultBasePoint(eligible),
      entities: eligible.map(toBlockChild),
      ...(command.description != null ? { description: command.description } : {}),
    };
    const siblingNames = (snapshot.project.blockDefinitions ?? []).map((entry) => entry.name);
    if (validateBlockDefinition(definition, siblingNames).length > 0) return null;
    const removed = new Set(eligible.map((entity) => entity.id));
    const reference: CadBlockReferenceEntity = {
      id: createStableRuntimeId('cad-block-ref'),
      type: 'block-reference',
      layerId: eligible[0]?.layerId ?? resolveCurrentCadLayerId(snapshot.project),
      visible: true,
      locked: false,
      blockDefinitionId: definition.id,
      x: definition.basePoint.x,
      y: definition.basePoint.y,
      rotationDeg: 0,
      scaleX: 1,
      scaleY: 1,
    };
    const nextProject = replaceCadProjectEntities(
      withDefinitions(snapshot.project, [...(snapshot.project.blockDefinitions ?? []), definition]),
      [...snapshot.project.entities.filter((entity) => !removed.has(entity.id)), reference],
    );
    const result = commitLayerProject('BLOCK_CREATE', snapshot, nextProject, `BLOCK_CREATE (${name})`);
    return {
      ...result,
      nextSnapshot: { ...result.nextSnapshot, selection: createCadSelectionState(nextProject, [reference.id]) },
      addedEntityIds: [reference.id],
      removedEntityIds: [...removed],
    };
  },
};

const blockInsertCommand: CadCommandDefinition<InsertCommand> = {
  key: 'BLOCK_INSERT',
  execute: (snapshot, command) => {
    const definition = findBlockDefinition(snapshot.project.blockDefinitions, command.definitionId);
    if (!definition) return null;
    const scaleX = command.scaleX ?? 1;
    const scaleY = command.scaleY ?? 1;
    if (normalizeBlockScales(scaleX, scaleY) != null) return null;
    if (!Number.isFinite(command.x) || !Number.isFinite(command.y)) return null;
    if (command.rotationDeg != null && !Number.isFinite(command.rotationDeg)) return null;
    const reference: CadBlockReferenceEntity = {
      id: createStableRuntimeId('cad-block-ref'),
      type: 'block-reference',
      layerId: command.layerId ?? resolveCurrentCadLayerId(snapshot.project),
      visible: true,
      locked: false,
      blockDefinitionId: definition.id,
      x: command.x,
      y: command.y,
      rotationDeg: command.rotationDeg ?? 0,
      scaleX,
      scaleY,
    };
    if (!snapshot.project.layers.some((layer) => layer.id === reference.layerId)) return null;
    const nextProject = replaceCadProjectEntities(snapshot.project, [
      ...snapshot.project.entities,
      reference,
    ]);
    const result = commitLayerProject('BLOCK_INSERT', snapshot, nextProject, `BLOCK_INSERT (${definition.name})`);
    return {
      ...result,
      nextSnapshot: { ...result.nextSnapshot, selection: createCadSelectionState(nextProject, [reference.id]) },
      addedEntityIds: [reference.id],
      removedEntityIds: [],
    };
  },
};

const blockExplodeCommand: CadCommandDefinition<ExplodeCommand> = {
  key: 'BLOCK_EXPLODE',
  execute: (snapshot, command) => {
    const reference = snapshot.project.entities.find(
      (entity): entity is CadBlockReferenceEntity =>
        entity.type === 'block-reference' && entity.id === command.referenceId,
    );
    if (!reference || !checkCadEntityEditable(snapshot.project, reference).editable) return null;
    const definition = findBlockDefinition(snapshot.project.blockDefinitions, reference.blockDefinitionId);
    if (!definition) return null;
    // All-or-nothing: expand fully before mutating anything.
    let world: CadBlockChild[];
    try {
      world = expandBlockReference(definition, reference);
    } catch {
      return null;
    }
    // Appearance bake: child explicit > reference explicit-over-layer, so
    // the exploded geometry keeps the on-screen look (documented intent
    // bake; layer stays the child's own).
    const refResolved = resolveCadEntityAppearance({
      entity: reference,
      layer: snapshot.project.layers.find((layer) => layer.id === reference.layerId) ?? null,
      styleLibrary: snapshot.project.styleLibrary,
    });
    const materialized: CadEntity[] = world.map((child) => ({
      ...(child as CadEntity),
      id: createStableRuntimeId('cad-exploded'),
      layerId: (child as CadEntity).layerId,
      visible: true,
      locked: false,
      appearance: resolveBlockChildAppearance(child.appearance, {
        color: refResolved.color,
        lineTypeId: refResolved.lineTypeId,
        lineweightMm: refResolved.lineweightMm,
        transparency: refResolved.transparency,
      }),
    }));
    const nextProject = replaceCadProjectEntities(
      snapshot.project,
      snapshot.project.entities
        .filter((entity) => entity.id !== reference.id)
        .concat(materialized),
    );
    const result = commitLayerProject('BLOCK_EXPLODE', snapshot, nextProject, `BLOCK_EXPLODE (${definition.name})`);
    return {
      ...result,
      nextSnapshot: {
        ...result.nextSnapshot,
        selection: createCadSelectionState(nextProject, materialized.map((entity) => entity.id)),
      },
      addedEntityIds: materialized.map((entity) => entity.id),
      removedEntityIds: [reference.id],
    };
  },
};

const blockRedefineCommand: CadCommandDefinition<RedefineCommand> = {
  key: 'BLOCK_REDEFINE',
  execute: (snapshot, command) => {
    const definitions = snapshot.project.blockDefinitions ?? [];
    const definition = definitions.find((entry) => entry.id === command.definitionId);
    if (!definition) return null;
    const byId = new Map(snapshot.project.entities.map((entity) => [entity.id, entity]));
    const sources = command.sourceEntityIds.map((id) => byId.get(id));
    if (sources.some((entity) => entity == null)) return null;
    const { eligible, ineligible } = classifyBlockSources(snapshot.project, sources as CadEntity[]);
    if (ineligible.length > 0 || eligible.length === 0) return null;
    // Geometry swap only: name/basePoint stay, so live refs keep transforms.
    const next: CadBlockDefinition = { ...definition, entities: eligible.map(toBlockChild) };
    const siblingNames = definitions.filter((entry) => entry.id !== definition.id).map((entry) => entry.name);
    if (validateBlockDefinition(next, siblingNames).length > 0) return null;
    const removed = new Set(eligible.map((entity) => entity.id));
    // Refs must still expand after the swap (fail-closed before committing).
    try {
      for (const reference of referencingBlockEntities(snapshot.project, definition.id)) {
        expandBlockReference(next, reference);
      }
    } catch {
      return null;
    }
    const nextProject = replaceCadProjectEntities(
      withDefinitions(snapshot.project, definitions.map((entry) => (entry.id === definition.id ? next : entry))),
      snapshot.project.entities.filter((entity) => !removed.has(entity.id)),
    );
    const result = commitLayerProject('BLOCK_REDEFINE', snapshot, nextProject, `BLOCK_REDEFINE (${definition.name})`);
    return { ...result, addedEntityIds: [], removedEntityIds: [...removed] };
  },
};

const blockRenameCommand: CadCommandDefinition<RenameCommand> = {
  key: 'BLOCK_RENAME',
  execute: (snapshot, command) => {
    const definitions = snapshot.project.blockDefinitions ?? [];
    const definition = definitions.find((entry) => entry.id === command.definitionId);
    if (!definition) return null;
    const name = command.name.trim();
    if (name.length === 0 || isNameTaken(snapshot.project, name, definition.id)) return null;
    const nextProject = withDefinitions(
      snapshot.project,
      definitions.map((entry) => (entry.id === definition.id ? { ...entry, name } : entry)),
    );
    return commitLayerProject('BLOCK_RENAME', snapshot, nextProject, `BLOCK_RENAME (${name})`);
  },
};

const blockDuplicateCommand: CadCommandDefinition<DuplicateCommand> = {
  key: 'BLOCK_DUPLICATE',
  execute: (snapshot, command) => {
    const definitions = snapshot.project.blockDefinitions ?? [];
    const definition = definitions.find((entry) => entry.id === command.definitionId);
    if (!definition) return null;
    const name = command.name.trim();
    if (name.length === 0 || isNameTaken(snapshot.project, name)) return null;
    // Child ids are block-local: safe to carry over verbatim.
    const copy: CadBlockDefinition = {
      ...definition,
      id: createStableRuntimeId('cad-block'),
      name,
      basePoint: { ...definition.basePoint },
      entities: definition.entities.map((child) => ({ ...child })),
    };
    if (validateBlockDefinition(copy, definitions.map((entry) => entry.name)).length > 0) return null;
    return commitLayerProject(
      'BLOCK_DUPLICATE',
      snapshot,
      withDefinitions(snapshot.project, [...definitions, copy]),
      `BLOCK_DUPLICATE (${name})`,
    );
  },
};

const blockDeleteCommand: CadCommandDefinition<DeleteCommand> = {
  key: 'BLOCK_DELETE',
  execute: (snapshot, command) => {
    const definitions = snapshot.project.blockDefinitions ?? [];
    const definition = definitions.find((entry) => entry.id === command.definitionId);
    if (!definition) return null;
    const refs = referencingBlockEntities(snapshot.project, definition.id);
    const styleRefs = referencingBlockPointStyles(snapshot.project, definition.id);
    if ((refs.length > 0 || styleRefs.length > 0) && !(command.force === true && command.deleteRefs === true)) {
      return null;
    }
    const removedRefIds = new Set(refs.map((entity) => entity.id));
    const pointStyles = (snapshot.project.pointStyles ?? []).map((style) =>
      style.markerBlockDefinitionId === definition.id
        ? (() => {
            const rest = { ...style };
            delete rest.markerBlockDefinitionId;
            return rest;
          })()
        : style,
    );
    const nextProject = replaceCadProjectEntities(
      {
        ...withDefinitions(snapshot.project, definitions.filter((entry) => entry.id !== definition.id)),
        ...(command.deleteRefs === true ? { pointStyles } : {}),
      },
      snapshot.project.entities.filter((entity) => !removedRefIds.has(entity.id)),
    );
    const result = commitLayerProject('BLOCK_DELETE', snapshot, nextProject, `BLOCK_DELETE (${definition.name})`);
    return { ...result, addedEntityIds: [], removedEntityIds: [...removedRefIds] };
  },
};

const passthrough = (
  definition: CadCommandDefinition<CadCommand>,
): CadCommandDefinition<CadCommand> => definition;

type SeedCommand = Extract<CadCommand, { key: 'BLOCK_SEED' }>;
type EditCommand = Extract<CadCommand, { key: 'BLOCK_EDIT' }>;

// BLOCK_SEED reuses the symbol-seed gate (idempotent; second run is a
// no-op null). BLOCK_EDIT retargets a live reference's transform.
const blockSeedCommand: CadCommandDefinition<SeedCommand> = {
  key: 'BLOCK_SEED',
  execute: (snapshot) => {
    const { project: seeded, added } = ensureSurveySymbolsSeeded(snapshot.project);
    if (added === 0) return null;
    return commitLayerProject('BLOCK_SEED', snapshot, seeded, `BLOCK_SEED (${added})`);
  },
};

const blockEditCommand: CadCommandDefinition<EditCommand> = {
  key: 'BLOCK_EDIT',
  execute: (snapshot, command) => {
    const reference = snapshot.project.entities.find(
      (entity): entity is CadBlockReferenceEntity =>
        entity.type === 'block-reference' && entity.id === command.referenceId,
    );
    if (!reference || !checkCadEntityEditable(snapshot.project, reference).editable) return null;
    const next: CadBlockReferenceEntity = { ...reference };
    if (command.x != null) {
      if (!Number.isFinite(command.x)) return null;
      next.x = command.x;
    }
    if (command.y != null) {
      if (!Number.isFinite(command.y)) return null;
      next.y = command.y;
    }
    if (command.rotationDeg != null) {
      if (!Number.isFinite(command.rotationDeg)) return null;
      next.rotationDeg = command.rotationDeg;
    }
    if (command.scaleX != null || command.scaleY != null) {
      const issue = normalizeBlockScales(command.scaleX ?? next.scaleX, command.scaleY ?? next.scaleY);
      if (issue) return null;
      if (command.scaleX != null) next.scaleX = command.scaleX;
      if (command.scaleY != null) next.scaleY = command.scaleY;
    }
    const definition = findBlockDefinition(snapshot.project.blockDefinitions, next.blockDefinitionId);
    if (!definition) return null;
    try {
      expandBlockReference(definition, next);
    } catch {
      return null;
    }
    const nextProject = replaceCadProjectEntities(
      snapshot.project,
      snapshot.project.entities.map((entity) => (entity.id === next.id ? next : entity)),
    );
    return commitLayerProject('BLOCK_EDIT', snapshot, nextProject, 'BLOCK_EDIT');
  },
};

export const blockCommandDefinitions = {
  BLOCK_SEED: passthrough(blockSeedCommand as CadCommandDefinition<CadCommand>),
  BLOCK_EDIT: passthrough(blockEditCommand as CadCommandDefinition<CadCommand>),
  BLOCK_CREATE: passthrough(blockCreateCommand as CadCommandDefinition<CadCommand>),
  BLOCK_INSERT: passthrough(blockInsertCommand as CadCommandDefinition<CadCommand>),
  BLOCK_EXPLODE: passthrough(blockExplodeCommand as CadCommandDefinition<CadCommand>),
  BLOCK_REDEFINE: passthrough(blockRedefineCommand as CadCommandDefinition<CadCommand>),
  BLOCK_RENAME: passthrough(blockRenameCommand as CadCommandDefinition<CadCommand>),
  BLOCK_DUPLICATE: passthrough(blockDuplicateCommand as CadCommandDefinition<CadCommand>),
  BLOCK_DELETE: passthrough(blockDeleteCommand as CadCommandDefinition<CadCommand>),
};
