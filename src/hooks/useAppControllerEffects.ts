import { useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { InputPaneHandle } from '../components/InputPane';
import type { MapViewSnapshot } from '../components/MapView';
import type { InstrumentLibrary } from '../types';
import type { ParseSettings, ProjectOptionsTab, SettingsState } from '../appStateTypes';

export const useAppControllerEffects = ({
  result,
  setMapViewSnapshot,
  parsedInputInstruments,
  setProjectInstruments,
  projectInstruments,
  selectedInstrument,
  setSelectedInstrument,
  pendingEditorJumpLine,
  isSidebarOpen,
  inputPaneRef,
  setPendingEditorJumpLine,
  isSettingsModalOpen,
  activeOptionsTab,
  settingsDraft,
  parseSettingsDraft,
  projectInstrumentsDraft,
  selectedInstrumentDraft,
  settingsModalContentRef,
}: {
  result: unknown;
  setMapViewSnapshot: Dispatch<SetStateAction<MapViewSnapshot | null>>;
  parsedInputInstruments: InstrumentLibrary;
  setProjectInstruments: Dispatch<SetStateAction<InstrumentLibrary>>;
  projectInstruments: InstrumentLibrary;
  selectedInstrument: string;
  setSelectedInstrument: Dispatch<SetStateAction<string>>;
  pendingEditorJumpLine: number | null;
  isSidebarOpen: boolean;
  inputPaneRef: RefObject<InputPaneHandle | null>;
  setPendingEditorJumpLine: Dispatch<SetStateAction<number | null>>;
  isSettingsModalOpen: boolean;
  activeOptionsTab: ProjectOptionsTab;
  settingsDraft: SettingsState;
  parseSettingsDraft: ParseSettings;
  projectInstrumentsDraft: InstrumentLibrary;
  selectedInstrumentDraft: string;
  settingsModalContentRef: RefObject<HTMLDivElement | null>;
}) => {
  useEffect(() => {
    setMapViewSnapshot(null);
  }, [result, setMapViewSnapshot]);

  useEffect(() => {
    setProjectInstruments((prev) => {
      const next = { ...prev };
      let changed = false;
      Object.entries(parsedInputInstruments).forEach(([code, inst]) => {
        if (!next[code]) {
          next[code] = inst;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [parsedInputInstruments, setProjectInstruments]);

  useEffect(() => {
    const codes = Object.keys(projectInstruments);
    if (!selectedInstrument && codes.length > 0) {
      setSelectedInstrument(codes[0]);
    } else if (selectedInstrument && !projectInstruments[selectedInstrument]) {
      setSelectedInstrument(codes[0] || '');
    }
  }, [projectInstruments, selectedInstrument, setSelectedInstrument]);

  useEffect(() => {
    if (pendingEditorJumpLine == null || !isSidebarOpen) return;
    const lineNumber = pendingEditorJumpLine;
    const frame = window.requestAnimationFrame(() => {
      inputPaneRef.current?.jumpToLine(lineNumber);
      setPendingEditorJumpLine((current) => (current === lineNumber ? null : current));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [inputPaneRef, isSidebarOpen, pendingEditorJumpLine, setPendingEditorJumpLine]);

  useEffect(() => {
    if (!isSettingsModalOpen) return;
    const root = settingsModalContentRef.current;
    if (!root) return;

    root.querySelectorAll('label').forEach((label) => {
      if (label.getAttribute('title')) return;
      const control = label.querySelector<HTMLElement>(
        'input[title], select[title], textarea[title], button[title]',
      );
      const tip = control?.getAttribute('title');
      if (tip) label.setAttribute('title', tip);
    });
  }, [
    activeOptionsTab,
    isSettingsModalOpen,
    parseSettingsDraft,
    projectInstrumentsDraft,
    selectedInstrumentDraft,
    settingsDraft,
    settingsModalContentRef,
  ]);
};
