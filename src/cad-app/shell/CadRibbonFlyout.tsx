// Phase 21A Wave 1B — tool-family flyout menu.
//
// Rows: 16px icon + full label + registry alias + hint. Planned rows are
// visible but greyed with a "Not implemented yet" tooltip and can never run or
// become the primary face. Keyboard: Up/Down/Home/End navigate, Enter/Space
// choose, Escape closes. Rows use aria-disabled (not the disabled attribute)
// so keyboard users can still inspect planned tools.
import React, { useEffect, useRef } from 'react';
import { CAD_RIBBON_ICONS } from '../assets/icons/cadRibbonIcons';
import { resolveShellCommandText } from './cadCommandRegistry';
import type { CadRibbonToolFamily, CadRibbonToolVariant } from './cadRibbonToolFamilies';
import type { CadRibbonFlyoutAnchor } from './cadRibbonFlyout.constants';

export interface CadRibbonFlyoutProps {
  family: CadRibbonToolFamily;
  currentVariantId: string;
  /** True when a mapped variant's command can run right now. */
  isVariantAvailable: (_variant: CadRibbonToolVariant) => boolean;
  /** Choose an available variant (SplitButton records + dispatches). */
  onSelect: (_variant: CadRibbonToolVariant) => void;
  /** `restoreFocus` = Escape/selection; false = outside click. */
  onRequestClose: (_restoreFocus: boolean) => void;
  /** Optional element id for aria-controls wiring. */
  menuId?: string;
  /**
   * Viewport-anchored origin (from the caret rect at open time). When set,
   * the menu paints position:fixed so it escapes the ribbon strip's
   * horizontal scroll container (overflow clips in-place absolute menus —
   * the Wave-3 browser QA proved open flyouts were invisible). Omitted in
   * unit harnesses, where the legacy in-place absolute menu applies.
   */
  anchor?: CadRibbonFlyoutAnchor | null;
}

/** A row can run only when it has a real key and the workspace reports it available. */
const canRunVariant = (
  variant: CadRibbonToolVariant,
  isVariantAvailable: (_variant: CadRibbonToolVariant) => boolean,
): boolean =>
  variant.planned !== true && variant.commandKey != null && isVariantAvailable(variant);

const rowTooltip = (variant: CadRibbonToolVariant, runnable: boolean): string => {
  if (variant.planned === true) return 'Not implemented yet';
  const def = variant.commandKey != null ? resolveShellCommandText(variant.commandKey) : null;
  const alias = def != null && def.aliases.length > 0 ? ` [${def.aliases.join(', ')}]` : '';
  const hint = variant.hint ?? def?.hint ?? '';
  if (!runnable) return `${variant.label} — unavailable right now.`;
  return `${variant.label}${alias} — ${hint}`.trim();
};

export const CadRibbonFlyout: React.FC<CadRibbonFlyoutProps> = ({
  family,
  currentVariantId,
  isVariantAvailable,
  onSelect,
  onRequestClose,
  menuId,
  anchor = null,
}) => {
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Focus the current variant on open so arrow keys continue from the face.
  useEffect(() => {
    const currentIndex = family.variants.findIndex((variant) => variant.id === currentVariantId);
    const target = currentIndex >= 0 ? rowRefs.current[currentIndex] : rowRefs.current[0];
    target?.focus();
  }, [family, currentVariantId]);

  const moveFocus = (from: HTMLElement, delta: number): void => {
    const buttons = rowRefs.current.filter((entry): entry is HTMLButtonElement => entry != null);
    if (buttons.length === 0) return;
    const index = buttons.indexOf(from as HTMLButtonElement);
    const next = ((index < 0 ? 0 : index + delta) % buttons.length + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLUListElement>): void => {
    const target = event.target as HTMLElement;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onRequestClose(true);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveFocus(target, event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const buttons = rowRefs.current.filter((entry): entry is HTMLButtonElement => entry != null);
      (event.key === 'Home' ? buttons[0] : buttons[buttons.length - 1])?.focus();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      const index = rowRefs.current.indexOf(target as HTMLButtonElement);
      const variant = index >= 0 ? family.variants[index] : undefined;
      if (variant == null) return;
      event.preventDefault();
      if (canRunVariant(variant, isVariantAvailable)) onSelect(variant);
    }
  };

  return (
    <ul
      id={menuId}
      role="menu"
      aria-label={`${family.label} tools`}
      className={`cad-ribbon-flyout${anchor != null ? ' cad-ribbon-flyout--fixed' : ''}`}
      data-cad-ribbon-flyout={family.id}
      onKeyDown={onKeyDown}
      {...(anchor != null
        ? { style: { top: anchor.top, left: anchor.left, maxHeight: anchor.maxHeight } }
        : {})}
    >
      {family.variants.map((variant, index) => {
        const runnable = canRunVariant(variant, isVariantAvailable);
        const current = variant.id === currentVariantId;
        const src = variant.icon != null ? CAD_RIBBON_ICONS[variant.icon]?.src16 ?? null : null;
        const def = variant.commandKey != null ? resolveShellCommandText(variant.commandKey) : null;
        return (
          <React.Fragment key={variant.id}>
            {variant.separatorBefore === true ? (
              <li role="separator" className="cad-ribbon-flyout__separator" />
            ) : null}
            <li role="none">
              <button
                ref={(node) => {
                  rowRefs.current[index] = node;
                }}
                type="button"
                role="menuitem"
                className={`cad-ribbon-flyout__item${current ? ' is-current' : ''}${runnable ? '' : ' is-disabled'}`}
                aria-disabled={runnable ? undefined : true}
                aria-current={current ? 'true' : undefined}
                title={rowTooltip(variant, runnable)}
                data-cad-variant={variant.id}
                data-cad-command={variant.commandKey}
                onClick={() => {
                  if (runnable) onSelect(variant);
                }}
              >
                <span className="cad-ribbon-flyout__icon" aria-hidden="true">
                  {src != null ? <img src={src} alt="" draggable={false} /> : null}
                </span>
                <span className="cad-ribbon-flyout__label">{variant.label}</span>
                {def != null && def.aliases.length > 0 ? (
                  <span className="cad-ribbon-flyout__alias">{def.aliases.join(', ')}</span>
                ) : null}
                <span className="cad-ribbon-flyout__hint">{variant.hint ?? def?.hint ?? ''}</span>
              </button>
            </li>
          </React.Fragment>
        );
      })}
    </ul>
  );
};
