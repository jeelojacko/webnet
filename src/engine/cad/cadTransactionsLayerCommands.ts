// Phase 18C drawing-standards layer mutations (keeps cadTransactions.ts small).
//
// Shared layer helpers (withLayer/commitLayerProject/isLayerNameTaken) live
// here; cadTransactions.ts imports them for the pre-existing LAYER_* family.
import type {
  CadCommand,
  CadCommandDefinition,
  CadCommandExecutionResult,
  CadCommandKey,
  CadWorkspaceSnapshot,
} from './cadTransactions.types';
import type { CadLayer, CadProject } from './cadTypes';
import { clampTransparency } from './cadAppearance';
import { createCadSelectionState } from './cadSelection';

export const commitLayerProject = (
  key: CadCommandKey,
  snapshot: CadWorkspaceSnapshot,
  nextProject: CadProject,
  label: string,
): CadCommandExecutionResult => ({
  nextSnapshot: {
    project: nextProject,
    selection: createCadSelectionState(nextProject, snapshot.selection.selectedEntityIds),
  },
  commandState: { key, phase: 'committed', prompt: `${label} committed.` },
  transactionLabel: label,
  addedEntityIds: [],
  removedEntityIds: [],
});

export const withLayer = (
  project: CadProject,
  layerId: string,
  patch: Partial<CadLayer>,
): CadProject | null => {
  const layer = project.layers.find((entry) => entry.id === layerId);
  if (!layer) return null;
  return {
    ...project,
    layers: project.layers.map((entry) => (entry.id === layerId ? { ...entry, ...patch } : entry)),
  };
};

/** Case-insensitive unique-name enforcement for CREATE/rename. */
export const isLayerNameTaken = (
  project: CadProject,
  name: string,
  exceptLayerId?: string,
): boolean =>
  project.layers.some(
    (layer) => layer.id !== exceptLayerId && layer.name.toLowerCase() === name.toLowerCase(),
  );

const patchLayerCommand = <TCommand extends CadCommand>(
  key: TCommand['key'],
  patch: (_command: TCommand) => Partial<CadLayer> | null,
): CadCommandDefinition<TCommand> => ({
  key,
  execute: (snapshot, command) => {
    if (!('layerId' in command)) return null;
    const layerPatch = patch(command);
    if (!layerPatch) return null;
    const nextProject = withLayer(snapshot.project, command.layerId as string, layerPatch);
    if (!nextProject) return null;
    return commitLayerProject(key, snapshot, nextProject, `${key} (${command.layerId as string})`);
  },
});

const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

export const layerColorCommand = patchLayerCommand<Extract<CadCommand, { key: 'LAYER_COLOR' }>>(
  'LAYER_COLOR',
  (command) => (nonEmpty(command.color) ? { color: command.color } : null),
);

export const layerLinetypeCommand = patchLayerCommand<
  Extract<CadCommand, { key: 'LAYER_LINETYPE' }>
>('LAYER_LINETYPE', (command) =>
  nonEmpty(command.lineTypeId) ? { lineTypeId: command.lineTypeId } : null,
);

export const layerLineweightCommand = patchLayerCommand<
  Extract<CadCommand, { key: 'LAYER_LINEWEIGHT' }>
>('LAYER_LINEWEIGHT', (command) =>
  command.lineweightMm === undefined ||
  (typeof command.lineweightMm === 'number' &&
    Number.isFinite(command.lineweightMm) &&
    command.lineweightMm >= 0)
    ? { lineweightMm: command.lineweightMm }
    : null,
);

export const layerTransparencyCommand = patchLayerCommand<
  Extract<CadCommand, { key: 'LAYER_TRANSPARENCY' }>
>('LAYER_TRANSPARENCY', (command) =>
  typeof command.transparency === 'number' && Number.isFinite(command.transparency)
    ? { transparency: clampTransparency(command.transparency) }
    : null,
);

export const layerFrozenCommand = patchLayerCommand<Extract<CadCommand, { key: 'LAYER_FROZEN' }>>(
  'LAYER_FROZEN',
  (command) => (typeof command.frozen === 'boolean' ? { frozen: command.frozen } : null),
);

export const layerDescriptionCommand = patchLayerCommand<
  Extract<CadCommand, { key: 'LAYER_DESCRIPTION' }>
>('LAYER_DESCRIPTION', (command) =>
  typeof command.description === 'string' ? { description: command.description } : null,
);

export const layerSetCurrentCommand: CadCommandDefinition<
  Extract<CadCommand, { key: 'LAYER_SET_CURRENT' }>
> = {
  key: 'LAYER_SET_CURRENT',
  execute: (snapshot, command) => {
    if (!snapshot.project.layers.some((layer) => layer.id === command.layerId)) return null;
    const nextProject: CadProject = { ...snapshot.project, currentLayerId: command.layerId };
    return commitLayerProject('LAYER_SET_CURRENT', snapshot, nextProject, `LAYER_SET_CURRENT (${command.layerId})`);
  },
};
