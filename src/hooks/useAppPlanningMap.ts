import { useCallback, useEffect, useMemo, type Dispatch, type SetStateAction } from 'react';
import { parseInput } from '../engine/parse';
import type { ImportedInputNotice } from '../engine/importers';
import type { ParseSettings, WorkspaceTabKey } from '../appStateTypes';
import type { AdjustmentResult, ParseResult } from '../types';
import type { InstrumentLibrary } from '../types';
import type { ProjectRunFile } from '../engine/projectWorkspace';

export const useAppPlanningMap = ({
  result,
  planningMapPreview,
  setPlanningMapPreview,
  effectiveRunInput,
  activeProjectRunFiles,
  effectiveRunIncludeFiles,
  parseSettings,
  projectInstruments,
  selectedInstrument,
  setImportNotice,
  setActiveTab,
}: {
  result: AdjustmentResult | null;
  planningMapPreview: ParseResult | null;
  setPlanningMapPreview: Dispatch<SetStateAction<ParseResult | null>>;
  effectiveRunInput: string;
  activeProjectRunFiles: ProjectRunFile[];
  effectiveRunIncludeFiles: Record<string, string>;
  parseSettings: ParseSettings;
  projectInstruments: InstrumentLibrary;
  selectedInstrument: string;
  setImportNotice: Dispatch<SetStateAction<ImportedInputNotice | null>>;
  setActiveTab: Dispatch<SetStateAction<WorkspaceTabKey>>;
}) => {
  useEffect(() => {
    setPlanningMapPreview(null);
  }, [
    activeProjectRunFiles,
    effectiveRunIncludeFiles,
    effectiveRunInput,
    parseSettings,
    projectInstruments,
    selectedInstrument,
    setPlanningMapPreview,
  ]);

  const handleLoadPlanningInputPoints = useCallback(() => {
    try {
      const parsed = parseInput(effectiveRunInput, projectInstruments, {
        ...parseSettings,
        sourceFile: activeProjectRunFiles[0]?.name ?? '<planning-map>',
        includeFiles: effectiveRunIncludeFiles,
        projectRunFiles: activeProjectRunFiles,
        currentInstrument: selectedInstrument,
      });
      setPlanningMapPreview(parsed);
      setImportNotice(null);
      setActiveTab('map');
    } catch (error) {
      setPlanningMapPreview(null);
      setImportNotice({
        title: 'Load points failed',
        detailLines: [error instanceof Error ? error.message : 'Unable to parse current input.'],
      });
    }
  }, [
    activeProjectRunFiles,
    effectiveRunIncludeFiles,
    effectiveRunInput,
    parseSettings,
    projectInstruments,
    selectedInstrument,
    setActiveTab,
    setImportNotice,
    setPlanningMapPreview,
  ]);

  const mapResult = useMemo<AdjustmentResult>(() => {
    if (result) return result;
    if (!planningMapPreview) {
      return {
        success: false,
        converged: false,
        iterations: 0,
        dof: 0,
        seuw: 1,
        chiSquare: null,
        stations: {},
        observations: [],
        unknowns: [],
        normalMatrix: [],
        residuals: [],
        logs: [],
        parseState: { ...parseSettings },
        preanalysisMode: parseSettings.preanalysisMode === true,
      } as unknown as AdjustmentResult;
    }
    return {
      success: false,
      converged: false,
      iterations: 0,
      dof: 0,
      seuw: 1,
      chiSquare: null,
      stations: planningMapPreview.stations,
      observations: planningMapPreview.observations,
      unknowns: planningMapPreview.unknowns,
      normalMatrix: [],
      residuals: [],
      logs: planningMapPreview.logs,
      parseState: planningMapPreview.parseState,
      preanalysisMode: planningMapPreview.parseState.preanalysisMode === true,
    } as unknown as AdjustmentResult;
  }, [parseSettings, planningMapPreview, result]);

  return {
    handleLoadPlanningInputPoints,
    mapResult,
  };
};
