import React from 'react';
import type { CadSidePanelId } from './cadShellTypes';

/** Phase 18B — panel-level error boundary: one failing palette never takes the shell. */
export class CadPanelErrorBoundary extends React.Component<
  { panelName: string; children: React.ReactNode },
  { error: string | null }
> {
  constructor(props: { panelName: string; children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: unknown): { error: string } {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div className="cad-shell-panel-error" role="alert">
          {this.props.panelName} hit an error: {this.state.error}
        </div>
      );
    }
    return this.props.children;
  }
}

interface CadDockPanelProps {
  panel: CadSidePanelId;
  title: string;
  side: 'left' | 'right';
  widthPx: number;
  onClose: () => void;
  onMove: () => void;
  onResize: (_widthPx: number) => void;
  children: React.ReactNode;
}

/** Phase 18B — one resizable/closable/movable side dock panel. */
export const CadDockPanel: React.FC<CadDockPanelProps> = ({
  panel,
  title,
  side,
  widthPx,
  onClose,
  onMove,
  onResize,
  children,
}) => {
  const dragStart = React.useRef<{ startX: number; startWidth: number } | null>(null);

  const onHandlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    dragStart.current = { startX: event.clientX, startWidth: widthPx };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onHandlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const start = dragStart.current;
    if (!start) return;
    onResize(start.startWidth + (side === 'left' ? 1 : -1) * (event.clientX - start.startX));
  };
  const onHandlePointerUp = (): void => {
    dragStart.current = null;
  };

  return (
    <section
      aria-label={title}
      className="cad-shell-dock-panel"
      style={{ width: widthPx }}
      data-cad-panel={panel}
    >
      <header className="cad-shell-dock-header">
        <span className="cad-shell-dock-title">{title}</span>
        <button type="button" title={`Move ${title} to the other side`} onClick={onMove} aria-label={`Move ${title}`}>
          ⇄
        </button>
        <button type="button" title={`Close ${title}`} onClick={onClose} aria-label={`Close ${title}`}>
          ×
        </button>
      </header>
      <div className="cad-shell-dock-body">
        <CadPanelErrorBoundary panelName={title}>{children}</CadPanelErrorBoundary>
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${title}`}
        className="cad-shell-dock-resize"
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
      />
    </section>
  );
};
