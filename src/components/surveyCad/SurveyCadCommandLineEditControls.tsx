import React from 'react';

import { commandButtonClassName } from './SurveyCadCommandLine.constants';

interface SurveyCadCommandLineEditControlsProps {
  canExtendSelection: boolean;
  canTrimSelection: boolean;
  onStartCopy: () => void;
  onStartExtend: () => void;
  onStartFillet: () => void;
  onStartMove: () => void;
  onStartTrim: () => void;
  runImmediate: (_action: () => void) => void;
  selectionCount: number;
}

export const SurveyCadCommandLineEditControls: React.FC<
  SurveyCadCommandLineEditControlsProps
> = ({
  canExtendSelection,
  canTrimSelection,
  onStartCopy,
  onStartExtend,
  onStartFillet,
  onStartMove,
  onStartTrim,
  runImmediate,
  selectionCount,
}) => (
  <>
    <button
      type="button"
      className={commandButtonClassName}
      onClick={() => runImmediate(onStartMove)}
      disabled={selectionCount === 0}
      title="Move"
    >
      MOVE
    </button>
    <button
      type="button"
      className={commandButtonClassName}
      onClick={() => runImmediate(onStartCopy)}
      disabled={selectionCount === 0}
      title="Copy"
    >
      COPY
    </button>
    <button
      type="button"
      className={commandButtonClassName}
      onClick={() => runImmediate(onStartExtend)}
      disabled={!canExtendSelection}
      title="Extend"
    >
      EXT
    </button>
    <button
      type="button"
      className={commandButtonClassName}
      onClick={() => runImmediate(onStartTrim)}
      disabled={!canTrimSelection}
      title="Trim"
    >
      TRIM
    </button>
    <button
      type="button"
      className={commandButtonClassName}
      onClick={() => runImmediate(onStartFillet)}
      title="Fillet"
    >
      FILLET
    </button>
  </>
);
