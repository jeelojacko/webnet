import React, { useEffect, useRef, useState } from 'react';
import {
  CAD_SHELL_COMMANDS,
  executeShellCommand,
  isShellCommandAvailable,
  type CadShellCommandCategory,
  type CadShellCommandDef,
} from './cadCommandRegistry';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';
import type { CadShellLayoutController } from './useCadShellLayout';

interface CadMenuBarProps {
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
  layout: CadShellLayoutController;
  onBackToAdjustment: () => void;
}

const MENUS: Array<{ label: string; categories: CadShellCommandCategory[] }> = [
  { label: 'File', categories: ['File'] },
  { label: 'Edit', categories: ['Edit'] },
  { label: 'Draw', categories: ['Draw'] },
  { label: 'Modify', categories: ['Modify'] },
  { label: 'Measure', categories: ['Measure'] },
  { label: 'Parcel', categories: ['Parcel'] },
  { label: 'View', categories: [] },
];

const commandTooltip = (def: CadShellCommandDef): string =>
  def.aliases.length > 0 ? `${def.label} (${def.aliases.join(', ')}) — ${def.hint}` : `${def.label} — ${def.hint}`;

/**
 * Phase 18B — application menu bar. Every item dispatches through the
 * shared command registry; unavailable items render disabled, never fake.
 * Escape closes an open menu before the workspace sees it.
 */
export const CadMenuBar: React.FC<CadMenuBarProps> = ({ snapshot, actions, layout, onBackToAdjustment }) => {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenu) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (barRef.current && !barRef.current.contains(event.target as Node)) setOpenMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpenMenu(null);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [openMenu ]);

  const run = (def: CadShellCommandDef): void => {
    setOpenMenu(null);
    executeShellCommand(def, actions);
  };

  const renderViewMenu = (): React.ReactNode => (
    <>
      <CadMenuItem
        label={`Toolspace: ${layout.layout.leftPanel === 'toolspace' || layout.layout.rightPanel === 'toolspace' ? 'Shown' : 'Hidden'}`}
        onRun={() =>
          layout.setSidePanel(
            'left',
            layout.layout.leftPanel === 'toolspace' || layout.layout.rightPanel === 'toolspace'
              ? null
              : 'toolspace',
          )
        }
      />
      <CadMenuItem
        label={`Properties: ${layout.layout.leftPanel === 'properties' || layout.layout.rightPanel === 'properties' ? 'Shown' : 'Hidden'}`}
        onRun={() =>
          layout.setSidePanel(
            'right',
            layout.layout.leftPanel === 'properties' || layout.layout.rightPanel === 'properties'
              ? null
              : 'properties',
          )
        }
      />
      <CadMenuItem
        label={`Layers: ${layout.layout.leftPanel === 'layers' || layout.layout.rightPanel === 'layers' ? 'Shown' : 'Hidden'}`}
        onRun={() =>
          layout.setSidePanel(
            'left',
            layout.layout.leftPanel === 'layers' || layout.layout.rightPanel === 'layers' ? null : 'layers',
          )
        }
      />
      <CadMenuItem
        label={layout.layout.ribbonCollapsed ? 'Show Ribbon' : 'Hide Ribbon'}
        onRun={() => layout.setRibbonCollapsed(!layout.layout.ribbonCollapsed)}
      />
      <CadMenuItem label="Reset Workspace" onRun={() => layout.resetWorkspace()} />
    </>
  );

  return (
    <div ref={barRef} className="cad-shell-menubar" data-cad-menu-bar>
      {MENUS.map((menu) => {
        const items =
          menu.label === 'View'
            ? null
            : CAD_SHELL_COMMANDS.filter((def) => menu.categories.includes(def.category));
        const isOpen = openMenu === menu.label;
        return (
          <div key={menu.label} className="cad-shell-menu-wrap">
            <button
              type="button"
              className={`cad-shell-menu-trigger${isOpen ? ' open' : ''}`}
              aria-expanded={isOpen}
              aria-haspopup="menu"
              onClick={() => setOpenMenu(isOpen ? null : menu.label)}
              onMouseEnter={() => {
                if (openMenu) setOpenMenu(menu.label);
              }}
            >
              {menu.label}
            </button>
            {isOpen ? (
              <div role="menu" aria-label={menu.label} className="cad-shell-menu">
                {menu.label === 'View' ? (
                  renderViewMenu()
                ) : (
                  <>
                    {items?.map((def) => (
                      <button
                        key={def.key}
                        type="button"
                        role="menuitem"
                        title={commandTooltip(def)}
                        disabled={!isShellCommandAvailable(def, snapshot, actions)}
                        className="cad-shell-menu-item"
                        onClick={() => run(def)}
                      >
                        <span>{def.label}</span>
                        {def.shortcut ? <span className="cad-shell-shortcut">{def.shortcut}</span> : null}
                      </button>
                    ))}
                    {menu.label === 'File' ? (
                      <>
                        <div className="cad-shell-menu-sep" />
                        <button
                          type="button"
                          role="menuitem"
                          className="cad-shell-menu-item"
                          onClick={() => {
                            setOpenMenu(null);
                            onBackToAdjustment();
                          }}
                        >
                          <span>Back to Adjustment</span>
                        </button>
                      </>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

const CadMenuItem: React.FC<{ label: string; onRun: () => void }> = ({ label, onRun }) => (
  <button type="button" role="menuitem" className="cad-shell-menu-item" onClick={onRun}>
    <span>{label}</span>
  </button>
);
