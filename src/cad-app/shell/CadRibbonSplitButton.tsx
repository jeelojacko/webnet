// Phase 21A Wave 1B — joined split control for one tool family.
//
// PRIMARY face: shows the current variant and runs it immediately (no flyout).
// CARET: opens the flyout only, never runs the current command.
// The two read as one joined control but are separate buttons so keyboard and
// pointer behavior stay unambiguous.
//
// Dispatch routes through the shared registry (executeShellCommand +
// isShellCommandAvailable); no parallel command wiring lives here.
import React, { useEffect, useId, useRef, useState } from 'react';
import {
  executeShellCommand,
  isShellCommandAvailable,
  resolveShellCommandText,
  type CadShellCommandDef,
} from './cadCommandRegistry';
import { CadRibbonIconButton, type CadRibbonIconButtonSize } from './CadRibbonIconButton';
import { CadRibbonFlyout } from './CadRibbonFlyout';
import {
  CAD_RIBBON_FLYOUT_CARET_GAP_PX,
  CAD_RIBBON_FLYOUT_MAX_HEIGHT_PX,
  CAD_RIBBON_FLYOUT_MAX_WIDTH_PX,
  CAD_RIBBON_FLYOUT_VIEWPORT_MARGIN_PX,
  type CadRibbonFlyoutAnchor,
} from './cadRibbonFlyout.constants';
import {
  resolveCadRibbonCurrentVariant,
  type CadRibbonToolFamily,
  type CadRibbonToolVariant,
} from './cadRibbonToolFamilies';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';

export interface CadRibbonSplitButtonProps {
  family: CadRibbonToolFamily;
  /** Sticky variant id for this family (from useCadToolFamilyState). */
  currentVariantId: string;
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
  /** Record a flyout choice as the family's sticky variant. */
  onSelectVariant: (_variantId: string) => void;
  /** Optional post-dispatch hook (e.g. return focus to the command dock). */
  onAfterExecute?: () => void;
  /** Subtle active state when a variant's command is running. */
  active?: boolean;
  size?: CadRibbonIconButtonSize;
}

export const CadRibbonSplitButton: React.FC<CadRibbonSplitButtonProps> = ({
  family,
  currentVariantId,
  snapshot,
  actions,
  onSelectVariant,
  onAfterExecute,
  active = false,
  size = 'large',
}) => {
  const [open, setOpen] = useState(false);
  // Viewport anchor for the open menu (fixed positioning escapes the ribbon
  // strip's scroll clip; recomputed on every open, cleared on close).
  const [anchor, setAnchor] = useState<CadRibbonFlyoutAnchor | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const currentVariant = resolveCadRibbonCurrentVariant(family, currentVariantId);

  const defFor = (variant: CadRibbonToolVariant): CadShellCommandDef | null =>
    variant.commandKey != null ? resolveShellCommandText(variant.commandKey) : null;

  const variantAvailable = (variant: CadRibbonToolVariant): boolean => {
    if (variant.planned === true) return false;
    const def = defFor(variant);
    return def != null && isShellCommandAvailable(def, snapshot, actions);
  };

  const runVariant = (variant: CadRibbonToolVariant): boolean => {
    const def = defFor(variant);
    if (def == null || variant.planned === true) return false;
    return executeShellCommand(def, actions, snapshot);
  };

  const openMenu = (): void => {
    const rect = caretRef.current?.getBoundingClientRect();
    if (!rect) {
      setAnchor(null);
      setOpen(true);
      return;
    }
    const margin = CAD_RIBBON_FLYOUT_VIEWPORT_MARGIN_PX;
    const gap = CAD_RIBBON_FLYOUT_CARET_GAP_PX;
    const spaceBelow = window.innerHeight - rect.bottom - gap - margin;
    const spaceAbove = rect.top - gap - margin;
    // Prefer whichever side has more room, then cap to the CSS max box so the
    // menu is never taller than the contract and never off-viewport.
    const openUp = spaceBelow < Math.min(CAD_RIBBON_FLYOUT_MAX_HEIGHT_PX, spaceAbove);
    const maxHeight = Math.max(
      1,
      Math.min(CAD_RIBBON_FLYOUT_MAX_HEIGHT_PX, openUp ? spaceAbove : spaceBelow),
    );
    const top = openUp ? Math.max(margin, rect.top - gap - maxHeight) : rect.bottom + gap;
    const maxLeft = Math.max(
      margin,
      window.innerWidth - CAD_RIBBON_FLYOUT_MAX_WIDTH_PX - margin,
    );
    const left = Math.max(margin, Math.min(rect.left, maxLeft));
    setAnchor({ top, left, maxHeight });
    setOpen(true);
  };

  const close = (restoreFocus: boolean): void => {
    setOpen(false);
    setAnchor(null);
    if (restoreFocus) caretRef.current?.focus();
  };

  // Outside click closes without stealing focus.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent): void => {
      // The open menu paints outside the split container (fixed anchor), so
      // presses on its rows must not count as outside clicks (mousedown
      // precedes the row click that selects the variant).
      const target = event.target as Element | null;
      if (target?.closest?.('[data-cad-ribbon-flyout]') != null) return;
      if (containerRef.current != null && !containerRef.current.contains(event.target as Node)) {
        close(false);
      }
    };
    // A fixed-anchored menu goes stale on scroll/resize: close it rather
    // than paint at a dead origin.
    const onReposition = (): void => close(false);
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('scroll', onReposition, true);
    window.addEventListener('resize', onReposition);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('scroll', onReposition, true);
      window.removeEventListener('resize', onReposition);
    };
  }, [open]);

  const currentDef = defFor(currentVariant);
  const primaryDisabled = currentVariant.planned === true || currentDef == null
    || !isShellCommandAvailable(currentDef, snapshot, actions);
  // Registry aliases (e.g. LINE -> [L]) so typed-alias discovery matches the
  // dock and menu faces; fall back to the key when no alias exists.
  const primaryKey = currentDef != null && currentDef.aliases.length > 0
    ? currentDef.aliases.join(', ')
    : currentVariant.commandKey;
  const primaryTooltip = `${family.label}: ${currentVariant.label}${
    primaryKey != null ? ` [${primaryKey}]` : ''
  }${currentVariant.planned === true ? ' — Not implemented yet' : ` — ${currentVariant.hint ?? currentDef?.hint ?? ''}`}`;

  return (
    <div
      ref={containerRef}
      className="cad-ribbon-split"
      data-cad-family={family.id}
    >
      <CadRibbonIconButton
        className="cad-ribbon-split__primary"
        icon={currentVariant.icon}
        shortLabel={size === 'large' ? family.label : undefined}
        label={`${family.label}: ${currentVariant.label}`}
        title={primaryTooltip}
        disabled={primaryDisabled}
        active={active}
        size={size}
        commandKey={currentVariant.commandKey}
        onClick={() => {
          if (runVariant(currentVariant)) onAfterExecute?.();
        }}
      />
      <button
        ref={caretRef}
        type="button"
        className="cad-ribbon-split__caret"
        aria-label={`Show ${family.label} tools`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={`Show ${family.label} tools`}
        data-cad-family-caret={family.id}
        onClick={() => {
          if (open) close(false);
          else openMenu();
        }}
        onKeyDown={(event) => {
          // Real browsers synthesize click on Enter/Space; preventDefault keeps
          // the open state from toggling twice.
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openMenu();
          }
        }}
      >
        <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <CadRibbonFlyout
          family={family}
          currentVariantId={currentVariant.id}
          isVariantAvailable={variantAvailable}
          menuId={menuId}
          anchor={anchor}
          onRequestClose={close}
          onSelect={(variant) => {
            onSelectVariant(variant.id);
            const started = runVariant(variant);
            close(true);
            if (started) onAfterExecute?.();
          }}
        />
      ) : null}
    </div>
  );
};
