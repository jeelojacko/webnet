import React from 'react';

type FloatingPanelResizeDirection = 'right' | 'bottom' | 'corner';

interface SurveyCadFloatingPanelShellProps {
  title: string;
  subtitle?: string;
  dock: 'floating' | 'left' | 'right';
  collapsed: boolean;
  positionStyle: React.CSSProperties;
  shellDataAttribute: string;
  headerDataAttribute: string;
  headerActions: React.ReactNode;
  onStartDrag?: (_event: React.PointerEvent<HTMLDivElement>) => void;
  onStartResize?: (
    _direction: FloatingPanelResizeDirection,
    _event: React.PointerEvent<HTMLDivElement>,
  ) => void;
  children: React.ReactNode;
}

const shellClassName =
  'pointer-events-auto fixed z-40 flex flex-col overflow-hidden rounded border border-slate-700 bg-slate-950/95 shadow-2xl backdrop-blur';

const SurveyCadFloatingPanelShell: React.FC<SurveyCadFloatingPanelShellProps> = ({
  title,
  subtitle,
  dock,
  collapsed,
  positionStyle,
  shellDataAttribute,
  headerDataAttribute,
  headerActions,
  onStartDrag,
  onStartResize,
  children,
}) => {
  const shellProps: Record<string, string> = {
    [shellDataAttribute]: 'true',
  };
  const headerProps: Record<string, string> = {
    [headerDataAttribute]: 'true',
  };
  const headerClassName = `flex items-start justify-between gap-1 border-b border-slate-800 px-1.5 py-1 ${
    onStartDrag ? 'cursor-move' : 'cursor-default'
  }`;

  return (
    <div className={shellClassName} style={positionStyle} {...shellProps}>
      <div
        className={headerClassName}
        onPointerDown={onStartDrag}
        {...headerProps}
      >
        <div className="min-w-0">
          <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-100">
            {title}
          </div>
          {subtitle ? (
            <div className="text-[8px] leading-3 text-slate-400">{subtitle}</div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-0.5">{headerActions}</div>
      </div>
      {collapsed ? null : children}
      {dock === 'floating' && !collapsed && onStartResize ? (
        <>
          <div
            className="absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize"
            title="Resize wider or return to standard width"
            onPointerDown={(event) => onStartResize('right', event)}
            data-survey-cad-floating-panel-resize-right
          />
          <div
            className="absolute inset-x-0 bottom-0 z-10 h-2 cursor-ns-resize"
            title="Resize shorter or return to standard height"
            onPointerDown={(event) => onStartResize('bottom', event)}
            data-survey-cad-floating-panel-resize-bottom
          />
          <div
            className="absolute bottom-0 right-0 z-20 h-4 w-4 cursor-nwse-resize before:absolute before:bottom-1 before:right-1 before:h-2 before:w-2 before:rounded-sm before:border-b before:border-r before:border-cyan-400/70 before:content-['']"
            title="Resize wider or shorter"
            onPointerDown={(event) => onStartResize('corner', event)}
            data-survey-cad-floating-panel-resize-corner
          />
        </>
      ) : null}
    </div>
  );
};

export type { FloatingPanelResizeDirection };
export default SurveyCadFloatingPanelShell;
