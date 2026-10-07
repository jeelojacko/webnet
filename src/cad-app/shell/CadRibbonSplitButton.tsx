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
  resolveCadRibbonFlyoutAnchor,
  type CadRibbonFlyoutAnchor,
} from './cadRibbonFlyout.anchor';
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
  // One-shot exemption for the browser's own "bring the clicked/focused
  // control into view" scroll. The browser issues that scroll while resolving
  // the click, but can deliver its scroll event in the frame right after the
  // menu mounts. The exemption is armed on open, disarmed at the next
  // animation frame, and honored only for the ribbon strip's own scroll
  // container with an unmoved caret — a real user scroll pans the caret and
  // therefore closes/re-anchors instead. This replaces the old blanket 100ms
  // grace, which swallowed genuine user scrolls.
  const inducedScrollRef = useRef<{ left: number; top: number; generation: number } | null>(null);
  const inducedScrollGenerationRef = useRef(0);
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

  const armInducedScrollExemption = (rect: DOMRect | null): void => {
    const generation = (inducedScrollGenerationRef.current += 1);
    if (rect == null) {
      inducedScrollRef.current = null;
      return;
    }
    inducedScrollRef.current = { left: rect.left, top: rect.top, generation };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        if (inducedScrollRef.current?.generation === generation) inducedScrollRef.current = null;
      });
    }
  };

  const openMenu = (): void => {
    const rect = caretRef.current?.getBoundingClientRect();
    armInducedScrollExemption(rect ?? null);
    if (!rect) {
      setAnchor(null);
      setOpen(true);
      return;
    }
    // The pure helper owns side selection, viewport capping, and horizontal
    // clamping: natural content height wins on a full desktop viewport, while
    // a short viewport caps the inline max-height to the actual room.
    setAnchor(
      resolveCadRibbonFlyoutAnchor(
        { top: rect.top, bottom: rect.bottom, left: rect.left },
        window.innerWidth,
        window.innerHeight,
      ),
    );
    setOpen(true);
  };

  const close = (restoreFocus: boolean): void => {
    inducedScrollRef.current = null;
    setOpen(false);
    setAnchor(null);
    if (restoreFocus) caretRef.current?.focus();
  };

  // Outside click / external scroll / resize close without stealing focus.
  useEffect(() => {
    if (!open) return undefined;
    const flyoutElement = (): HTMLElement | null =>
      containerRef.current?.querySelector<HTMLElement>('[data-cad-ribbon-flyout]') ?? null;
    const isInsideFlyout = (target: EventTarget | null): boolean => {
      const flyout = flyoutElement();
      return flyout != null && target instanceof Node && flyout.contains(target);
    };
    const onPointerDown = (event: MouseEvent): void => {
      // The open menu paints outside the split container (fixed anchor), so
      // presses on its rows — and on its scrollbar track/thumb — must not count
      // as outside clicks. Containment is checked against the real flyout DOM
      // (not only the event target's closest() chain), because a scrollbar drag
      // can target the flyout element itself.
      const target = event.target;
      if (isInsideFlyout(target)) return;
      if (target instanceof Node && containerRef.current != null && !containerRef.current.contains(target)) {
        close(false);
      }
    };
    // A fixed-anchored menu goes stale on EXTERNAL scroll/resize: close it
    // rather than paint at a dead origin. Scrolling INSIDE the open flyout is
    // not an external scroll (and CSS overscroll-behavior: contain stops wheel
    // chaining at the menu's top/bottom), so internal scroll keeps it open.
    // The single armed exemption covers only the browser's same-frame
    // bring-into-view scroll of the ribbon strip: it is consumed by the first
    // external scroll, applies only when that scroll's target IS the strip's
    // scroll container, and only while the caret has not moved since open. A
    // genuine user scroll — including dragging the ribbon sideways right after
    // opening — pans the caret (>1px) and closes rather than leaving a stale
    // fixed-anchored menu.
    const onScrollCapture = (event: Event): void => {
      if (isInsideFlyout(event.target)) return;
      const exempt = inducedScrollRef.current;
      if (exempt != null) {
        inducedScrollRef.current = null;
        const strip = containerRef.current?.closest('.cad-shell-ribbon-groups') ?? null;
        const caretRect = caretRef.current?.getBoundingClientRect();
        const caretUnmoved = caretRect != null
          && Math.abs(caretRect.left - exempt.left) <= 1
          && Math.abs(caretRect.top - exempt.top) <= 1;
        if (strip != null && event.target === strip && caretUnmoved) return;
      }
      close(false);
    };
    const onResize = (): void => close(false);
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('scroll', onScrollCapture, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('scroll', onScrollCapture, true);
      window.removeEventListener('resize', onResize);
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
