/** @vitest-environment jsdom */

import React, { act, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import type { ParseSettings } from '../../src/appStateTypes';
import type {
  AdjustedPointsColumnId,
  CustomLevelLoopTolerancePreset,
  InstrumentLibrary,
  ProjectExportFormat,
} from '../../src/types';
import {
  DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
  cloneAdjustedPointsExportSettings,
  sanitizeAdjustedPointsExportSettings,
} from '../../src/engine/adjustedPointsExport';
import { useProjectOptionsModalController } from '../../src/hooks/useProjectOptionsModalController';
import { useProjectOptionsState } from '../../src/hooks/useProjectOptionsState';
import {
  baseParseSettings,
  baseSettings,
  cloneInstrumentLibrary,
  createCustomLevelLoopTolerancePreset,
  createInstrument,
  normalizeSolveProfile,
  normalizeUiTheme,
  resolveLevelLoopTolerancePreset,
} from './projectOptionsModalControllerTestSupport';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
describe('useProjectOptionsModalController transform filtering', () => {
  it('filters transform-scope selections to adjusted stations when the extracted controller applies them', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const Harness = () => {
      const [settings, setSettings] = useState(baseSettings);
      const [parseSettings, setParseSettings] = useState(baseParseSettings);
      const [geoidSourceData, setGeoidSourceData] = useState<Uint8Array | null>(null);
      const [geoidSourceDataLabel, setGeoidSourceDataLabel] = useState('');
      const [projectInstruments, setProjectInstruments] = useState<InstrumentLibrary>({
        S9: createInstrument('S9', 'S9'),
      });
      const [levelLoopCustomPresets, setLevelLoopCustomPresets] = useState<
        CustomLevelLoopTolerancePreset[]
      >([]);
      const [adjustedPointsExportSettings, setAdjustedPointsExportSettings] = useState(() =>
        cloneAdjustedPointsExportSettings(DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS),
      );
      const [selectedInstrument, setSelectedInstrument] = useState('S9');
      const [exportFormat, setExportFormat] = useState<ProjectExportFormat>('webnet');
      const geoidSourceFileInputRef = useRef<HTMLInputElement | null>(null);
      const settingsModalContentRef = useRef<HTMLDivElement | null>(null);
      const adjustedPointsDragRef = useRef<AdjustedPointsColumnId | null>(null);

      const projectOptionsState = useProjectOptionsState({
        initialSettingsModalOpen: false,
        initialOptionsTab: 'general',
        settings,
        setSettings,
        parseSettings,
        setParseSettings,
        geoidSourceData,
        setGeoidSourceData,
        geoidSourceDataLabel,
        setGeoidSourceDataLabel,
        projectInstruments,
        setProjectInstruments,
        levelLoopCustomPresets,
        setLevelLoopCustomPresets,
        adjustedPointsExportSettings,
        setAdjustedPointsExportSettings,
        selectedInstrument,
        setSelectedInstrument,
        cloneInstrumentLibrary,
        cloneAdjustedPointsExportSettings,
        sanitizeAdjustedPointsExportSettings: (draft) =>
          sanitizeAdjustedPointsExportSettings(draft, DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS),
        normalizeUiTheme,
        resolveCatalogGroupFromCrsId: () => 'all',
        parseTransformAngleInput: (raw) => {
          const parsed = Number.parseFloat(raw);
          return Number.isFinite(parsed) ? parsed : null;
        },
      });

      const controller = useProjectOptionsModalController({
        projectOptionsState,
        adjustedPointsDraftStationIds: ['P1', 'P2'],
        adjustedPointsTransformDraftValidationMessage: null,
        crsCatalogGroupCounts: {},
        filteredDraftCrsCatalog: [],
        searchedDraftCrsCatalog: [],
        visibleDraftCrsCatalog: [],
        selectedDraftCrs: undefined,
        selectedCrsProj4Params: [],
        exportFormat,
        setExportFormat,
        handleSaveProject: () => undefined,
        triggerProjectFileSelect: () => undefined,
        geoidSourceFileInputRef,
        settingsModalContentRef,
        adjustedPointsDragRef,
        runDiagnostics: null,
        normalizeSolveProfile,
        normalizeUiTheme,
        buildObservationModeFromGridFields: (state) => ({
          bearing: state.gridBearingMode,
          distance: state.gridDistanceMode,
          angle: state.gridAngleMode,
          direction: state.gridDirectionMode,
        }),
        createInstrument,
        createCustomLevelLoopTolerancePreset,
        resolveLevelLoopTolerancePreset,
        staticContext: {
          FT_PER_M: 3.280839895,
        },
      });

      const context = controller.projectOptionsModalContext as {
        adjustedPointsExportSettingsDraft: typeof adjustedPointsExportSettings;
        openAdjustedPointsTransformSelectModal: () => void;
      };

      return (
        <div>
          <div data-selected>
            {context.adjustedPointsExportSettingsDraft.transform.selectedStationIds.join(',')}
          </div>
          <button type="button" onClick={context.openAdjustedPointsTransformSelectModal}>
            open-scope
          </button>
          <button
            type="button"
            onClick={() => controller.handleAdjustedPointsTransformToggleSelected('P1', true)}
          >
            select-p1
          </button>
          <button
            type="button"
            onClick={() => controller.handleAdjustedPointsTransformToggleSelected('P2', true)}
          >
            select-p2
          </button>
          <button
            type="button"
            onClick={() => controller.handleAdjustedPointsTransformToggleSelected('MISSING', true)}
          >
            select-missing
          </button>
          <button type="button" onClick={controller.applyAdjustedPointsTransformSelection}>
            apply-scope
          </button>
        </div>
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    const click = async (label: string) => {
      const button = Array.from(container.querySelectorAll('button')).find(
        (entry) => entry.textContent === label,
      ) as HTMLButtonElement | undefined;
      if (!button) throw new Error(`Missing button ${label}`);
      await act(async () => {
        button.click();
      });
    };

    await click('open-scope');
    await click('select-p1');
    await click('select-p2');
    await click('select-missing');
    await click('apply-scope');

    expect(container.querySelector('[data-selected]')?.textContent).toBe('P1,P2');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
