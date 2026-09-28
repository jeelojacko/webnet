// Phase 21A Wave 1B — reusable icon ribbon button.
//
// Icon-first by default; a short caption is optional. Full label always drives
// aria-label and (unless a custom title is given) the tooltip, so an icon with
// no visible text is never an inaccessible mystery button.
import React from 'react';
import { CAD_RIBBON_ICONS, type CadRibbonIconId } from '../assets/icons/cadRibbonIcons';

export type CadRibbonIconButtonSize = 'large' | 'compact';

/** Resolve the curated asset closest to the requested display size. */
const cadRibbonIconSrc = (
  icon: CadRibbonIconId | undefined,
  size: CadRibbonIconButtonSize,
): string | null => {
  if (icon == null) return null;
  const sources = CAD_RIBBON_ICONS[icon];
  if (sources == null) return null;
  if (size === 'compact') return sources.src16 ?? sources.src24 ?? sources.src32 ?? null;
  return sources.src32 ?? sources.src24 ?? sources.src16 ?? null;
};

export interface CadRibbonIconButtonProps {
  icon?: CadRibbonIconId;
  /** Optional short visible caption; omit for an icon-only face. */
  shortLabel?: string;
  /** Full accessible name (required even when shortLabel is shown). */
  label: string;
  /** Tooltip override; defaults to label. */
  title?: string;
  disabled?: boolean;
  /** Subtle current-command / current-variant state. */
  active?: boolean;
  size?: CadRibbonIconButtonSize;
  /** Emitted as data-cad-command for dispatch-level test/automation hooks. */
  commandKey?: string;
  /** Extra `data-*` hooks (e.g. bounded-subgroup selectors) spread onto the button. */
  dataAttributes?: Record<string, string | undefined>;
  onClick?: () => void;
  className?: string;
}

export const CadRibbonIconButton: React.FC<CadRibbonIconButtonProps> = ({
  icon,
  shortLabel,
  label,
  title,
  disabled = false,
  active = false,
  size = 'large',
  commandKey,
  dataAttributes,
  onClick,
  className,
}) => {
  const src = cadRibbonIconSrc(icon, size);
  const classes = [
    'cad-ribbon-icon-button',
    `cad-ribbon-icon-button--${size}`,
    active ? 'is-active' : '',
    className ?? '',
  ].filter((entry) => entry.length > 0).join(' ');
  return (
    <button
      type="button"
      className={classes}
      aria-label={label}
      aria-pressed={active || undefined}
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
      data-cad-command={commandKey}
      data-cad-ribbon-icon={icon}
      {...dataAttributes}
    >
      {src != null ? (
        <img className="cad-ribbon-icon-button__img" src={src} alt="" aria-hidden="true" draggable={false} />
      ) : null}
      {shortLabel != null && shortLabel.length > 0 ? (
        <span className="cad-ribbon-icon-button__label">{shortLabel}</span>
      ) : null}
    </button>
  );
};
