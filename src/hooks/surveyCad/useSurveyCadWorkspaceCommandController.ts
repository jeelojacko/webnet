import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { useSurveyCadCommands } from './useSurveyCadCommands';
import type { CadSnapConstructionContext } from '../../engine/cad/cadTypes';

type SurveyCadWorkspaceCommandControllerOptions = Parameters<typeof useSurveyCadCommands>[0] & {
  setSnapConstructionContext: Dispatch<SetStateAction<CadSnapConstructionContext>>;
};

export const useSurveyCadWorkspaceCommandController = ({
  setSnapConstructionContext,
  ...commandOptions
}: SurveyCadWorkspaceCommandControllerOptions): ReturnType<typeof useSurveyCadCommands> => {
  const commandState = useSurveyCadCommands(commandOptions);

  useEffect(() => {
    const nextSnapConstructionContext = commandState.snapConstructionContext;
    setSnapConstructionContext((current) => {
      if (
        current.active === nextSnapConstructionContext.active &&
        current.scopeSeedSegmentId === nextSnapConstructionContext.scopeSeedSegmentId &&
        current.tangentSeedArcEntityId === nextSnapConstructionContext.tangentSeedArcEntityId &&
        current.basePoint?.x === nextSnapConstructionContext.basePoint?.x &&
        current.basePoint?.y === nextSnapConstructionContext.basePoint?.y &&
        current.tangentSeedPoint?.x === nextSnapConstructionContext.tangentSeedPoint?.x &&
        current.tangentSeedPoint?.y === nextSnapConstructionContext.tangentSeedPoint?.y
      ) {
        return current;
      }
      return nextSnapConstructionContext;
    });
  }, [commandState.snapConstructionContext, setSnapConstructionContext]);

  return commandState;
};
