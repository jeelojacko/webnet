import { GENERAL_CAD_LAYER_ID } from '../../engine/cad/cadLayers';
import type { CadLayer } from '../../engine/cad/cadTypes';

/**
 * Phase 18C Layer Manager guards (pure + testable). Each validator returns
 * a user-facing reason when the mutation is blocked, null when allowed.
 * The engine re-enforces unique names + populated-layer delete; these
 * guards produce the messages before dispatching.
 */

/** Deterministic new-layer naming: first free Layer1/Layer2/… (case-insensitive). */
export const nextDeterministicLayerName = (layers: readonly CadLayer[]): string => {
  const taken = new Set(layers.map((layer) => layer.name.toLowerCase()));
  let index = 1;
  while (taken.has(`layer${index}`)) index += 1;
  return `Layer${index}`;
};

export const validateLayerCreate = (layers: readonly CadLayer[], name: string): string | null => {
  const trimmed = name.trim();
  if (!trimmed) return 'Layer name cannot be empty.';
  if (layers.some((layer) => layer.name.toLowerCase() === trimmed.toLowerCase())) {
    return `A layer named “${trimmed}” already exists.`;
  }
  return null;
};

export const validateLayerRename = (
  layers: readonly CadLayer[],
  layerId: string,
  name: string,
): string | null => {
  if (layerId === GENERAL_CAD_LAYER_ID) return 'The General layer cannot be renamed.';
  if (!layers.some((layer) => layer.id === layerId)) return 'Layer no longer exists.';
  return validateLayerCreate(
    layers.filter((layer) => layer.id !== layerId),
    name,
  );
};

export const validateLayerDelete = (
  layers: readonly CadLayer[],
  entityCounts: Readonly<Record<string, number>>,
  currentLayerId: string,
  layerId: string,
): string | null => {
  const layer = layers.find((entry) => entry.id === layerId);
  if (!layer) return 'Layer no longer exists.';
  if (layerId === GENERAL_CAD_LAYER_ID) return 'The General layer cannot be deleted.';
  if (layerId === currentLayerId) return `“${layer.name}” is the current layer and cannot be deleted.`;
  const count = entityCounts[layerId] ?? 0;
  if (count > 0) {
    return `“${layer.name}” has ${count} object${count === 1 ? '' : 's'} — move them off first.`;
  }
  return null;
};

/** SET_CURRENT guard (spec §3): must exist, be ON, not frozen. Locked may stay current. */
export const validateSetCurrent = (layers: readonly CadLayer[], layerId: string): string | null => {
  const layer = layers.find((entry) => entry.id === layerId);
  if (!layer) return 'Layer no longer exists.';
  if (layer.visible === false) return `“${layer.name}” is off — turn it on first.`;
  if (layer.frozen === true) return `“${layer.name}” is frozen — thaw it first.`;
  return null;
};
