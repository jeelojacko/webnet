import type { CadSnapCandidate, CadSnapKind } from '../../engine/cad/cadTypes';
import type { CommandPoint, CommandSession } from './useSurveyCadCommandTypes';

type UpdateSession = (
  _updater: (_current: CommandSession | null) => CommandSession | null,
) => void;
type ConsumePoint = (
  _point: CommandPoint,
  _options?: { suppressPointLabel?: boolean },
) => void;
type BatchCogoDraftBuilder = (
  _inputValue: string,
) => Extract<CommandSession, { key: 'BATCH_COGO' }>['draft'];

interface UseSurveyCadCommandInputActionsOptions {
  activeSnap: CadSnapCandidate | null;
  buildBatchCogoDraftForInput: BatchCogoDraftBuilder;
  consumePoint: ConsumePoint;
  session: CommandSession | null;
  updateSession: UpdateSession;
}

export interface SurveyCadCommandInputActions {
  setCommandInputValue: (_value: string) => void;
  appendCommandInputValue: (_value: string) => void;
  backspaceCommandInputValue: () => void;
  useActiveSnap: () => void;
  setBatchCogoInputValue: (_value: string) => void;
  consumeInteractionPoint: (
    _point: { x: number; y: number },
    _label?: string,
    _options?: {
      snapSourceSegmentId?: string;
      snapSourceEntityId?: string;
      snapKind?: CadSnapKind;
      extendMode?: boolean;
    },
  ) => void;
}

const canEditInput = (current: CommandSession | null): current is CommandSession =>
  current != null && current.key !== 'TRIM' && current.key !== 'EXTEND';

export const useSurveyCadCommandInputActions = ({
  activeSnap,
  buildBatchCogoDraftForInput,
  consumePoint,
  session,
  updateSession,
}: UseSurveyCadCommandInputActionsOptions): SurveyCadCommandInputActions => {
  const setCommandInputValue = (value: string) =>
    updateSession((current) =>
      canEditInput(current) ? { ...current, inputValue: value, resultText: undefined } : current,
    );

  const appendCommandInputValue = (value: string) =>
    updateSession((current) =>
      canEditInput(current)
        ? { ...current, inputValue: `${current.inputValue}${value}`, resultText: undefined }
        : current,
    );

  const backspaceCommandInputValue = () =>
    updateSession((current) =>
      canEditInput(current)
        ? { ...current, inputValue: current.inputValue.slice(0, -1), resultText: undefined }
        : current,
    );

  const useActiveSnap = () => {
    if (!activeSnap) return;
    consumePoint(
      {
        x: activeSnap.x,
        y: activeSnap.y,
        label: activeSnap.label,
        snapSourceSegmentId: activeSnap.sourceSegmentId,
        snapSourceEntityId: activeSnap.sourceEntityId,
        snapKind: activeSnap.kind,
      },
      { suppressPointLabel: true },
    );
  };

  const setBatchCogoInputValue = (value: string) =>
    updateSession((current) =>
      current?.key === 'BATCH_COGO'
        ? {
            ...current,
            inputValue: value,
            draft: buildBatchCogoDraftForInput(value),
            resultText: undefined,
          }
        : current,
    );

  const consumeInteractionPoint: SurveyCadCommandInputActions['consumeInteractionPoint'] = (
    point,
    label,
    options,
  ) => {
    if (!session) return;
    consumePoint(
      {
        x: point.x,
        y: point.y,
        label: label ?? `${point.x.toFixed(3)},${point.y.toFixed(3)}`,
        snapSourceSegmentId: options?.snapSourceSegmentId,
        snapSourceEntityId: options?.snapSourceEntityId,
        snapKind: options?.snapKind,
        extendMode: options?.extendMode,
      },
      { suppressPointLabel: true },
    );
  };

  return {
    setCommandInputValue,
    appendCommandInputValue,
    backspaceCommandInputValue,
    useActiveSnap,
    setBatchCogoInputValue,
    consumeInteractionPoint,
  };
};
