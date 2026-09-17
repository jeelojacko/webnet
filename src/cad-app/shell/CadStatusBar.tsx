import React, { useEffect, useRef, useState } from 'react';
import type { CadSnapKind } from '../../engine/cad/cadTypes';
import { useCadShellCursor, type CadShellLink } from './cadShellLink';
import type { CadActiveLayout, CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';

interface CadStatusBarProps {
  link: CadShellLink;
  snapshot: CadWorkspaceSnapshot | null;
  dirty: boolean;
  activeLayout: CadActiveLayout;
}

// Status-bar quick subset (6 common modes); Toolspace Settings lists all 14 CadSnapKind modes.
const SNAP_ORDER: CadSnapKind[] = [
  'endpoint',
  'midpoint',
  'center',
  'intersection',
  'perpendicular',
  'nearest',
];

/**
 * Phase 18B — status bar. Cursor E/N readout (fast channel, no chrome
 * re-render), entity/selection counts, OSNAP toggle for real modes only,
 * units, Model/Layout indicator. Ortho/polar/grid omitted: no engine
 * support, and unsupported chrome is never faked.
 */
export const CadStatusBar: React.FC<CadStatusBarProps> = ({ link, snapshot, dirty, activeLayout }) => {
  const cursor = useCadShellCursor(link);
  const [snapOpen, setSnapOpen] = useState(false);
  const snapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!snapOpen) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (snapRef.current && !snapRef.current.contains(event.target as Node)) setSnapOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [snapOpen]);

  const actions: CadShellActions | null = link.actions;
  const enabledSnaps = snapshot ? SNAP_ORDER.filter((kind) => snapshot.snapPreferences[kind]) : [];
  const layoutLabel = activeLayout === 'MODEL' ? 'MODEL' : `LAYOUT ${(snapshot?.sheets.findIndex((s) => s.id === (activeLayout as { sheetId: string }).sheetId) ?? -1) + 1}`;

  return (
    <footer className="cad-shell-statusbar" data-cad-status-bar>
      <span data-cad-cursor title="Cursor position (drawing units)">
        {cursor ? `E ${cursor.x.toFixed(3)}  N ${cursor.y.toFixed(3)}` : 'E —  N —'}
      </span>
      <span data-cad-counts title="Entities / selected">
        <span data-survey-cad-entity-count>{snapshot?.entityCount ?? 0} entities</span>
        {' · '}
        <span data-survey-cad-selection-count>{snapshot?.selectionCount ?? 0} selected</span>
      </span>
      <div ref={snapRef} className="cad-shell-snap-wrap">
        <button
          type="button"
          aria-expanded={snapOpen}
          title={snapshot ? `Object snap: ${enabledSnaps.join(', ') || 'off'}` : 'Object snap'}
          onClick={() => setSnapOpen((current) => !current)}
          data-cad-osnap-toggle
        >
          OSNAP {enabledSnaps.length > 0 ? 'on' : 'off'}
        </button>
        {snapOpen && snapshot ? (
          <div role="menu" aria-label="Snap modes" className="cad-shell-snap-menu">
            {SNAP_ORDER.map((kind) => (
              <label key={kind} className="cad-shell-check-row">
                <input
                  type="checkbox"
                  checked={snapshot.snapPreferences[kind] ?? false}
                  onChange={(event) => actions?.setSnapPreference(kind, event.target.checked)}
                />
                {kind}
              </label>
            ))}
          </div>
        ) : null}
      </div>
      <span title="Drawing units">{snapshot?.units ?? '—'}</span>
      <span title="Active space">{layoutLabel}</span>
      <span title={dirty ? 'Unsaved changes' : 'No unsaved changes'}>{dirty ? '●' : '○'}</span>
    </footer>
  );
};
