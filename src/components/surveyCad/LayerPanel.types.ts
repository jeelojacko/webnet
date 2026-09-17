import type { CadLayer, CadLineType } from '../../engine/cad/cadTypes';
import type { CadCommand } from '../../engine/cad/cadTransactions.types';

/** Layer-table mutations routed through undoable LAYER_* transactions. */
export type LayerManagerCommand = Extract<CadCommand, { key: `LAYER_${string}` }>;

export interface LayerPanelProps {
  layers: CadLayer[];
  /** Project-owned current layer (absent = `general` fallback upstream). */
  currentLayerId: string;
  /** Drawing-owned linetype library for the linetype cell dropdown. */
  lineTypes: CadLineType[];
  /** Entity count per layer id; drives the populated-layer delete guard. */
  entityCounts?: Record<string, number>;
  /** Every mutation routes through an undoable LAYER_* transaction. */
  onLayerCommand: (_command: LayerManagerCommand) => void;
  /** Guarded set-current (must exist/ON/thawed; locked allowed). */
  onSetCurrent: (_layerId: string) => void;
}

export interface LayerManagerRowProps {
  layer: CadLayer;
  isCurrent: boolean;
  entityCount: number;
  lineTypes: CadLineType[];
  onLayerCommand: (_command: LayerManagerCommand) => void;
  onSetCurrent: (_layerId: string) => void;
  onDeleteRequest: (_layerId: string) => void;
  confirmArmed: boolean;
  onCancelDelete: () => void;
  editing: boolean;
  editName: string;
  onEditNameChange: (_name: string) => void;
  onCommitRename: (_layerId: string) => void;
  onStartRename: (_layerId: string) => void;
}
