import { useEffect, type MutableRefObject } from 'react';

type UseSurveyCadWorkspaceKeyboardOptions = {
  activeCommandKey: string | null;
  appendCommandInputValue: (_value: string) => void;
  backspaceCommandInputValue: () => void;
  canCycleActiveSnap: boolean;
  clearSelection: () => void;
  copiedEntityIds: string[];
  copiedEntityIdsRef: MutableRefObject<string[]>;
  cycleActiveSnap: () => void;
  eraseSelection: () => void;
  handleEnterKey: () => void;
  handleEscapeKey: () => void;
  isGripEditing: boolean;
  nearbySnapCount: number;
  redo: () => void;
  selectedEntityIds: string[];
  selectionCount: number;
  setCopiedEntityIds: (_ids: string[]) => void;
  setReverseDirectionModifier: (_value: boolean) => void;
  startPasteFromClipboard: (_entityIds: string[]) => void;
  undo: () => void;
};

const isEditableTarget = (target: EventTarget | null): boolean =>
  (target instanceof HTMLInputElement && !target.disabled && !target.readOnly) ||
  (target instanceof HTMLTextAreaElement && !target.disabled && !target.readOnly) ||
  (target instanceof HTMLElement && target.isContentEditable);

export const useSurveyCadWorkspaceKeyboard = ({
  activeCommandKey,
  appendCommandInputValue,
  backspaceCommandInputValue,
  canCycleActiveSnap,
  clearSelection,
  copiedEntityIds,
  copiedEntityIdsRef,
  cycleActiveSnap,
  eraseSelection,
  handleEnterKey,
  handleEscapeKey,
  isGripEditing,
  nearbySnapCount,
  redo,
  selectedEntityIds,
  selectionCount,
  setCopiedEntityIds,
  setReverseDirectionModifier,
  startPasteFromClipboard,
  undo,
}: UseSurveyCadWorkspaceKeyboardOptions) => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.key === 'Escape') {
        if (activeCommandKey == null && selectionCount === 0) return;
        event.preventDefault();
        if (activeCommandKey) {
          handleEscapeKey();
          return;
        }
        clearSelection();
        return;
      }
      if (event.key === ' ' && (canCycleActiveSnap || isGripEditing) && nearbySnapCount > 1) {
        event.preventDefault();
        cycleActiveSnap();
        return;
      }
      if (event.key === 'Control') {
        setReverseDirectionModifier(true);
      }
      const modifierKey = event.ctrlKey || event.metaKey;
      if (modifierKey && !isEditableTarget(target)) {
        const lowerKey = event.key.toLowerCase();
        if (lowerKey === 'c' && selectionCount > 0) {
          event.preventDefault();
          setCopiedEntityIds(selectedEntityIds);
          copiedEntityIdsRef.current = selectedEntityIds;
          return;
        }
        if (lowerKey === 'v' && copiedEntityIdsRef.current.length > 0) {
          event.preventDefault();
          startPasteFromClipboard(copiedEntityIdsRef.current);
          return;
        }
        if (lowerKey === 'z') {
          event.preventDefault();
          if (event.shiftKey) {
            redo();
            return;
          }
          undo();
          return;
        }
        if (lowerKey === 'y') {
          event.preventDefault();
          redo();
          return;
        }
      }
      if (event.key === 'Enter' && activeCommandKey != null) {
        if (isEditableTarget(target)) return;
        event.preventDefault();
        handleEnterKey();
        return;
      }
      if (
        activeCommandKey == null &&
        !modifierKey &&
        !isEditableTarget(target) &&
        !event.altKey &&
        selectionCount > 0 &&
        (event.key === 'Backspace' || event.key === 'Delete')
      ) {
        event.preventDefault();
        eraseSelection();
        return;
      }
      if (activeCommandKey == null || modifierKey || isEditableTarget(target) || event.altKey) return;
      if (event.key === 'Backspace') {
        event.preventDefault();
        backspaceCommandInputValue();
        return;
      }
      if (event.key.length !== 1) return;
      event.preventDefault();
      appendCommandInputValue(event.key);
    };
    window.addEventListener('keydown', handleKeyDown);
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Control') {
        setReverseDirectionModifier(false);
      }
    };
    const handleBlur = () => setReverseDirectionModifier(false);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [
    activeCommandKey,
    appendCommandInputValue,
    backspaceCommandInputValue,
    clearSelection,
    canCycleActiveSnap,
    copiedEntityIds,
    copiedEntityIdsRef,
    cycleActiveSnap,
    eraseSelection,
    handleEnterKey,
    handleEscapeKey,
    isGripEditing,
    nearbySnapCount,
    redo,
    selectedEntityIds,
    selectionCount,
    setCopiedEntityIds,
    setReverseDirectionModifier,
    startPasteFromClipboard,
    undo,
  ]);
};
