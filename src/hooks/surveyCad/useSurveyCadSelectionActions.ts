import { useMemo, type Dispatch, type SetStateAction } from 'react';
import {
  clearCadSelection,
  replaceCadSelection,
  selectAllCadEntities,
  toggleCadSelectionEntity,
} from '../../engine/cad/cadSelection';
import { runCadCommand, type CadHistoryState } from '../../engine/cad/cadUndoRedo';
import type { CadGripHandle, CadEntityId } from '../../engine/cad/cadTypes';

interface UseSurveyCadSelectionActionsOptions {
  updateHistory: (_updater: (_history: CadHistoryState) => CadHistoryState) => void;
  setActiveGripHandle: Dispatch<SetStateAction<CadGripHandle | null>>;
}

const buildSelectionPrompt = (selectedCount: number): string =>
  `Selected ${selectedCount} entr${selectedCount === 1 ? 'y' : 'ies'}.`;

export const useSurveyCadSelectionActions = ({
  updateHistory,
  setActiveGripHandle,
}: UseSurveyCadSelectionActionsOptions) =>
  useMemo(
    () => ({
      selectEntity: (entityId: string, appendToSelection = false) => {
        setActiveGripHandle(null);
        updateHistory((current) => {
          const nextSelection = appendToSelection
            ? toggleCadSelectionEntity(current.present.project, current.present.selection, entityId)
            : replaceCadSelection(current.present.project, [entityId]);
          return {
            ...current,
            present: {
              ...current.present,
              selection: nextSelection,
            },
            commandState: {
              key: 'IDLE',
              phase: 'idle',
              prompt: buildSelectionPrompt(nextSelection.selectedEntityIds.length),
            },
          };
        });
      },
      selectEntities: (entityIds: string[], appendToSelection = false) => {
        setActiveGripHandle(null);
        updateHistory((current) => {
          const selectedIdSet = appendToSelection
            ? new Set<CadEntityId>([
                ...current.present.selection.selectedEntityIds,
                ...entityIds,
              ])
            : new Set<CadEntityId>(entityIds);
          const orderedIds = current.present.project.entities
            .filter((entity) => selectedIdSet.has(entity.id))
            .map((entity) => entity.id);
          const nextSelection = replaceCadSelection(current.present.project, orderedIds);
          return {
            ...current,
            present: {
              ...current.present,
              selection: nextSelection,
            },
            commandState: {
              key: 'IDLE',
              phase: 'idle',
              prompt: buildSelectionPrompt(nextSelection.selectedEntityIds.length),
            },
          };
        });
      },
      selectAll: () => {
        setActiveGripHandle(null);
        updateHistory((current) => {
          const nextSelection = selectAllCadEntities(current.present.project);
          return {
            ...current,
            present: {
              ...current.present,
              selection: nextSelection,
            },
            commandState: {
              key: 'IDLE',
              phase: 'idle',
              prompt: buildSelectionPrompt(nextSelection.selectedEntityIds.length),
            },
          };
        });
      },
      clearSelection: () => {
        setActiveGripHandle(null);
        updateHistory((current) => ({
          ...current,
          present: {
            ...current.present,
            selection: clearCadSelection(),
          },
          commandState: {
            key: 'IDLE',
            phase: 'idle',
            prompt: 'Selection cleared.',
          },
        }));
      },
      eraseSelection: () => {
        setActiveGripHandle(null);
        updateHistory((current) => runCadCommand(current, { key: 'ERASE' }));
      },
    }),
    [setActiveGripHandle, updateHistory],
  );
