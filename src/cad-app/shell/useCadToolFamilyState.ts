// Phase 21A Wave 1B — session-only sticky tool-family selection.
//
// Variant choice is UI state: NEVER written to WNCAD, never localStorage.
// It survives tab switches, selection changes, other commands, undo/redo, and
// save. It resets on New Drawing and Open Drawing — both by observing the
// active drawingId AND by a shell-local lifecycle generation, so a same-id
// reopen still resets (see SurveyCadWorkspace handleNewDrawing /
// handleOpenDrawingChange, which emit onDrawingLifecycle 'cad-created' /
// 'cad-opened').
//
// A typed alias (e.g. typing ARC_SCE in the command dock) starts the command
// but does NOT call selectVariant, so the sticky face is a ribbon selection
// preference, not command history. Only the family flyout moves the face.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CadDrawingLifecycleEvent } from '../cadAppTypes';
import {
  buildCadRibbonDefaultVariantMap,
  CAD_RIBBON_TOOL_FAMILIES,
  isCadRibbonVariantSelectable,
  resolveCadRibbonCurrentVariant,
  type CadRibbonToolFamily,
  type CadRibbonToolVariant,
} from './cadRibbonToolFamilies';

export interface UseCadToolFamilyStateOptions {
  /** Active drawing id; a change resets every family to its default. */
  drawingId: string | null;
  /** Override the manifest (tests / future per-tab families). */
  families?: readonly CadRibbonToolFamily[];
}

export interface CadToolFamilyState {
  currentVariantByFamily: Record<string, string>;
  /** Resolve the current variant (falls back to the family default). */
  resolveVariant: (_familyId: string) => CadRibbonToolVariant | null;
  /** Record a flyout choice. Planned / unknown variants are ignored. */
  selectVariant: (_familyId: string, _variantId: string) => void;
  resetToDefaults: () => void;
  /** Active when ANY mapped variant of the family is the running command. */
  isFamilyActive: (_familyId: string, _activeCommandKey: string | null | undefined) => boolean;
  /** Wire to SurveyCadWorkspace onDrawingLifecycle; New/Open reset the faces. */
  notifyDrawingLifecycle: (_event: CadDrawingLifecycleEvent, _fileName?: string | null) => void;
}

/**
 * Family is active when the running command key matches any variant that has a
 * real commandKey. Typed aliases therefore light the family up without moving
 * the sticky face (§41).
 */
export const isCadRibbonToolFamilyActive = (
  family: CadRibbonToolFamily,
  activeCommandKey: string | null | undefined,
): boolean =>
  activeCommandKey != null &&
  family.variants.some((variant) => variant.commandKey === activeCommandKey);

export const useCadToolFamilyState = (
  options: UseCadToolFamilyStateOptions,
): CadToolFamilyState => {
  const families = options.families ?? CAD_RIBBON_TOOL_FAMILIES;
  const familyById = useMemo(
    () => new Map<string, CadRibbonToolFamily>(families.map((family) => [family.id, family])),
    [families],
  );
  const defaults = useMemo(() => buildCadRibbonDefaultVariantMap(families), [families]);
  const [currentVariantByFamily, setCurrent] = useState<Record<string, string>>(defaults);
  const [generation, setGeneration] = useState(0);

  // drawingId change OR a New/Open lifecycle bump relocates the reset key.
  const resetKey = `${options.drawingId ?? ''}::${generation}`;
  const lastResetKey = useRef(resetKey);
  useEffect(() => {
    if (lastResetKey.current === resetKey) return;
    lastResetKey.current = resetKey;
    setCurrent(buildCadRibbonDefaultVariantMap(families));
  }, [resetKey, families]);

  const selectVariant = useCallback(
    (familyId: string, variantId: string): void => {
      const family = familyById.get(familyId) ?? null;
      if (family == null || !isCadRibbonVariantSelectable(family, variantId)) return;
      setCurrent((previous) =>
        previous[familyId] === variantId ? previous : { ...previous, [familyId]: variantId },
      );
    },
    [familyById],
  );

  const resolveVariant = useCallback(
    (familyId: string): CadRibbonToolVariant | null => {
      const family = familyById.get(familyId) ?? null;
      if (family == null) return null;
      return resolveCadRibbonCurrentVariant(family, currentVariantByFamily[familyId]);
    },
    [currentVariantByFamily, familyById],
  );

  const isFamilyActive = useCallback(
    (familyId: string, activeCommandKey: string | null | undefined): boolean => {
      const family = familyById.get(familyId) ?? null;
      return family != null && isCadRibbonToolFamilyActive(family, activeCommandKey);
    },
    [familyById],
  );

  const resetToDefaults = useCallback((): void => {
    setCurrent(buildCadRibbonDefaultVariantMap(families));
  }, [families]);

  const notifyDrawingLifecycle = useCallback(
    (event: CadDrawingLifecycleEvent, _fileName?: string | null): void => {
      if (event === 'cad-created' || event === 'cad-opened') setGeneration((value) => value + 1);
    },
    [],
  );

  return {
    currentVariantByFamily,
    resolveVariant,
    selectVariant,
    resetToDefaults,
    isFamilyActive,
    notifyDrawingLifecycle,
  };
};
