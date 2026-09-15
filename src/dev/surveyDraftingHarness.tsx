import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { SurveyDraftingResults } from './surveyDraftingResults';
import {
  applyHarnessStep,
  initialHarnessState,
  modelCoordsOf,
  mustDraft,
  STEP_IDS,
  type HarnessState,
  type HarnessStep,
} from './surveyDraftingSteps';
import { asPlanViewport, northArrowAngleDeg } from '../engine/cad/cadSheets';
import { apply13cStep, initial13cState, type Draft13cState } from './surveyDrafting13cSteps';
import type { CadDrawingDocument } from '../engine/cad/cadTypes';

type HarnessGlobal = typeof globalThis & {
  __SURVEY_DRAFTING_HARNESS__?: {
    getSavedWncad: () => string | undefined;
    getModelCoords: () => string;
    getExports: () => { svgLength: number; pdfLength: number; dxfLength: number };
  };
};

export const SurveyDraftingApp = (): React.JSX.Element => {
  const [state, setState] = useState<HarnessState>(initialHarnessState);
  const [log, setLog] = useState<string[]>([]);
  const [state13c, setState13c] = useState<Draft13cState>(initial13cState);
  const [log13c, setLog13c] = useState<string[]>([]);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const commit = (next: HarnessState, entry: string): void => {
    setState(next);
    setLog((current) => [...current, entry]);
  };

  const runStep = (step: HarnessStep): void => {
    const applied = applyHarnessStep(stateRef.current, step);
    if (applied) commit(applied.next, applied.entry);
  };

  const run13cStep = (step: string): void => {
    const applied = apply13cStep(state13c, step);
    if (applied) {
      setState13c(applied.next);
      setLog13c((current) => [...current, applied.entry]);
    }
  };

  const harness = useMemo<HarnessGlobal['__SURVEY_DRAFTING_HARNESS__']>(
    () => ({
      getSavedWncad: () => stateRef.current.savedWncad,
      getModelCoords: () => modelCoordsOf(stateRef.current.doc),
      getExports: () => stateRef.current.exports,
    }),
    [],
  );
  useEffect(() => {
    (globalThis as HarnessGlobal).__SURVEY_DRAFTING_HARNESS__ = harness;
  }, [harness]);

  const sheet = mustDraft(state.doc).sheets[0];
  const viewport = sheet?.viewports[0];
  const reloadDrawing = (doc: CadDrawingDocument): void => {
    commit({ ...stateRef.current, doc }, 'file:reloaded:via-input');
  };
  const noteReloadFailed = (): void => {
    setLog((current) => [...current, 'file:reload:FAILED']);
  };

  return (
    <main style={{ padding: 16, fontFamily: 'sans-serif' }}>
      <h1>Survey drafting harness</h1>
      <p data-testid="draft-harness-ready">ready</p>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {STEP_IDS.map((step) => (
          <button key={step} type="button" data-testid={`draft-step-${step}`} onClick={() => runStep(step)}>
            {`Step ${step}`}
          </button>
        ))}
      </div>
      <ol data-testid="draft-flow-log">
        {log.map((entry, index) => (
          <li key={`${index}-${entry}`} data-step={entry.slice(0, 1)}>{entry}</li>
        ))}
      </ol>
      <div data-testid="draft-model-count">{`entities:${state.doc.project.entities.length}`}</div>
      <div data-testid="draft-sheet-info">
        {sheet ? `sheet:${sheet.name}:${sheet.widthMm}x${sheet.heightMm}:viewports:${sheet.viewports.length}` : 'sheet:none'}
      </div>
      <div data-testid="draft-viewport-info">
        {viewport ? `scale:1:${viewport.scaleDenominator}:rotation:${(asPlanViewport(viewport).rotationDeg ?? 0)}:north:${northArrowAngleDeg(asPlanViewport(viewport).rotationDeg ?? 0).toFixed(1)}` : 'viewport:none'}
      </div>
      <div data-testid="draft-table-info">{`table-rows:${state.pointTableRows.length}`}</div>
      <div data-testid="draft-export-info">
        {`svg:${state.exports.svgLength}:pdf:${state.exports.pdfLength}:dxf:${state.exports.dxfLength}`}
      </div>
      {state.reloaded ? <div data-testid="draft-reload-info">{`reload:sheets:${state.reloaded.sheets}:coordsMatch:${state.reloaded.coordsMatch}`}</div> : null}
      <h2>Phase 13C extended flow</h2>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {STEP_IDS.map((step) => (
          <button key={step} type="button" data-testid={`draft13c-step-${step}`} onClick={() => run13cStep(step)}>
            {`13C ${step}`}
          </button>
        ))}
      </div>
      <ol data-testid="draft13c-flow-log">
        {log13c.map((entry, index) => (
          <li key={`${index}-${entry}`}>{entry}</li>
        ))}
      </ol>
      <div data-testid="draft13c-info">{`entities:${state13c.doc.project.entities.length}:sheets:${mustDraft(state13c.doc).sheets.length}:labels:${state13c.labels.length}:tables:${(mustDraft(state13c.doc).tables ?? []).length}:templates:${mustDraft(state13c.doc).titleBlockDefinitions.length}`}</div>
      <div data-testid="draft13c-export-info">{`svg:${state13c.exports.svg}:pdf:${state13c.exports.pdf}:r12:${state13c.exports.r12}:layout:${state13c.exports.layout}`}</div>
      <SurveyDraftingResults
        doc={state.doc}
        draft={mustDraft(state.doc)}
        titleBlocks={state.titleBlocks}
        pointTableRows={state.pointTableRows}
        onReload={reloadDrawing}
        onReloadFailed={noteReloadFailed}
      />
    </main>
  );
};

createRoot(document.getElementById('root') as HTMLElement).render(<SurveyDraftingApp />);
