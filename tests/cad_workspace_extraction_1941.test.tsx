/** @vitest-environment jsdom */
/**
 * STRUCT-194.1 — regression coverage for the three extraction seams:
 *   1. useSurveyCadDrawingSource (drawing-source precedence + fallback setter)
 *   2. cadDependencyDiagnostics (status/reason/chip formatting)
 *   3. SurveyCadWorkspaceManagers (conditional overlay mount + selectors)
 *
 * Everything below drives the real production hook/components — no duplicate
 * source model — via createRoot + act, matching the existing CAD workspace
 * test style.
 */
import React, { act, useEffect, type Dispatch, type SetStateAction } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it } from 'vitest';
import SurveyCadWorkspace from '../src/components/SurveyCadWorkspace';
import { createCadShellLink } from '../src/cad-app/shell/cadShellLink';
import {
  useSurveyCadDrawingSource,
  type SurveyCadDrawingSourceArgs,
} from '../src/hooks/surveyCad/useSurveyCadDrawingSource';
import {
  formatDependencyChipText,
  formatDependencyStatusLabel,
  getDependencyAction,
  getDependencyCause,
  summarizeActiveDrawingDependency,
} from '../src/components/surveyCad/cadDependencyDiagnostics';
import { stampAdjustmentDependency } from '../src/engine/cad/cadAdjustmentDependency';
import type { DrawingDependencySummary } from '../src/engine/cad/cadAdjustmentDependency';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import type { CadDrawingDocument, CadEntity, SurveyCadPersistedState } from '../src/engine/cad/cadTypes';
import type { DraftDocument, DraftDocumentLabel } from '../src/engine/cad/cadDraftTypes';
import { createBlankDraftDocument } from '../src/engine/cad/cadDraftTypes';
import type { ResultDependencyIdentity } from '../src/engine/resultIntegrity';
import { buildSurveyCadSpikeProject } from '../src/engine/cad/cadModel';
import { input, parseOptions } from './surveyCadWorkspace/surveyCadWorkspaceTestSupport';
import { buildResult } from './preanalysisPlanning/preanalysisPlanningTestSupport';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CURRENT: ResultDependencyIdentity = {
  inputFingerprint: 'input-a',
  mathFingerprint: 'math-a',
  exclusionFingerprint: 'excl-a',
};
const OTHER: ResultDependencyIdentity = { ...CURRENT, inputFingerprint: 'input-b' };

// ---------------------------------------------------------------------------
// Seam 1 — drawing source hook
// ---------------------------------------------------------------------------

type DrawingSourceHolder = { current: ReturnType<typeof useSurveyCadDrawingSource> | null };

const DrawingSourceHarness: React.FC<SurveyCadDrawingSourceArgs & { holderRef: DrawingSourceHolder }> = ({
  holderRef,
  ...args
}) => {
  const result = useSurveyCadDrawingSource(args);
  useEffect(() => {
    holderRef.current = result;
  }, [holderRef, result]);
  return null;
};

const mountDrawingSource = async (
  args: SurveyCadDrawingSourceArgs,
): Promise<{ root: Root; source: () => ReturnType<typeof useSurveyCadDrawingSource> }> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const holderRef: DrawingSourceHolder = { current: null };
  await act(async () => {
    root.render(<DrawingSourceHarness holderRef={holderRef} {...args} />);
  });
  return { root, source: () => holderRef.current! };
};

const persistedStateFor = (name: string): SurveyCadPersistedState => ({
  version: 1,
  sourceSignature: 'legacy',
  project: {
    ...buildSurveyCadSpikeProject({ input, instrumentLibrary: {}, parseOptions, units: 'm', result: null }),
    name,
  },
});

const trackedPersisted = (
  initial: SurveyCadPersistedState | null,
): { setter: Dispatch<SetStateAction<SurveyCadPersistedState | null>>; get: () => SurveyCadPersistedState | null } => {
  let current = initial;
  const setter: Dispatch<SetStateAction<SurveyCadPersistedState | null>> = (update) => {
    current =
      typeof update === 'function'
        ? (update as (_prev: SurveyCadPersistedState | null) => SurveyCadPersistedState | null)(current)
        : update;
  };
  return { setter, get: () => current };
};

const baseArgs: SurveyCadDrawingSourceArgs = {
  input,
  instrumentLibrary: {},
  parseOptions,
  units: 'm',
  result: null,
  resultDependencyIdentity: null,
  canFeedDraftingFromResult: false,
};

describe('useSurveyCadDrawingSource — precedence and fallback setter', () => {
  it('lets an explicit controlled drawing override the legacy source', async () => {
    const controlled = createBlankCadDrawingDocument({ name: 'Controlled', units: 'm' });
    const { source } = await mountDrawingSource({
      ...baseArgs,
      drawing: controlled,
      persistedState: persistedStateFor('Persisted'),
    });
    expect(source().activeDrawing).toBe(controlled);
    expect(source().legacyDrawing).not.toBe(controlled);
    // Persisted migration still produces a distinct legacy drawing (name from project).
    const legacy = source().legacyDrawing;
    expect(legacy.drawingId).not.toBe(controlled.drawingId);
  });

  it('falls back to the persisted drawing when drawing is null', async () => {
    const { source } = await mountDrawingSource({
      ...baseArgs,
      drawing: null,
      persistedState: persistedStateFor('Persisted'),
    });
    expect(source().activeDrawing).toBe(source().legacyDrawing);
  });

  it('gates adjustment-backed spikes on canFeedDraftingFromResult', async () => {
    const result = buildResult(1);
    const on = await mountDrawingSource({
      ...baseArgs,
      result,
      canFeedDraftingFromResult: true,
      resultDependencyIdentity: CURRENT,
    });
    expect(on.source().legacyDrawing.project.metadata.source).toBe('adjustment-result');
    const off = await mountDrawingSource({
      ...baseArgs,
      result,
      canFeedDraftingFromResult: false,
      resultDependencyIdentity: CURRENT,
    });
    expect(off.source().legacyDrawing.project.metadata.source).toBe('parsed-input');
  });

  it('creates a blank drawing with the requested units when unconfigured', async () => {
    const { source } = await mountDrawingSource({
      ...baseArgs,
      parseOptions: undefined,
      units: 'ft',
    });
    expect(source().legacyDrawing.units).toBe('ft');
    expect(source().legacyDrawing.kind).toBe('webnet-cad-drawing');
  });

  it('uses the controlled setter identity when onDrawingChange is supplied', async () => {
    const onChange: Dispatch<SetStateAction<CadDrawingDocument | null>> = () => {};
    const { source } = await mountDrawingSource({ ...baseArgs, onDrawingChange: onChange });
    expect(source().emitDrawingChange).toBe(onChange);
  });

  it('no-ops (identity preserved) when the fallback updater returns the previous drawing', async () => {
    const persisted = persistedStateFor('Persisted');
    const tracked = trackedPersisted(persisted);
    const { source } = await mountDrawingSource({
      ...baseArgs,
      persistedState: persisted,
      onPersistedStateChange: tracked.setter,
    });
    const before = tracked.get();
    await act(async () => {
      source().emitDrawingChange((previous) => previous);
    });
    expect(tracked.get()).toBe(before);
  });

  it('maps a replacement drawing through the persisted fallback and strips cad-drawing:', async () => {
    const tracked = trackedPersisted(persistedStateFor('Persisted'));
    const { source } = await mountDrawingSource({
      ...baseArgs,
      persistedState: tracked.get(),
      onPersistedStateChange: tracked.setter,
    });
    const next = createBlankCadDrawingDocument({ name: 'Next', units: 'm' });
    const strippedId = next.drawingId.startsWith('cad-drawing:')
      ? next.drawingId.slice('cad-drawing:'.length)
      : next.drawingId;
    await act(async () => {
      source().emitDrawingChange(next);
    });
    const mapped = tracked.get();
    expect(mapped?.sourceSignature).toBe(strippedId);
    expect(mapped?.project).toBe(next.project);
  });

  it('passes the migrated previous drawing to a functional fallback updater', async () => {
    const persisted = persistedStateFor('Persisted');
    const tracked = trackedPersisted(persisted);
    const { source } = await mountDrawingSource({
      ...baseArgs,
      persistedState: persisted,
      onPersistedStateChange: tracked.setter,
    });
    let seen: CadDrawingDocument | null = null;
    await act(async () => {
      source().emitDrawingChange((previous) => {
        seen = previous;
        return previous;
      });
    });
    expect(seen).not.toBeNull();
    expect((seen as unknown as CadDrawingDocument).project.name).toBe(persisted.project.name);
  });

  it('accepts a null replacement and is a no-op without a persisted setter', async () => {
    const tracked = trackedPersisted(persistedStateFor('Persisted'));
    const { source } = await mountDrawingSource({
      ...baseArgs,
      persistedState: tracked.get(),
      onPersistedStateChange: tracked.setter,
    });
    await act(async () => {
      source().emitDrawingChange(null);
    });
    expect(tracked.get()).toBeNull();

    const bare = await mountDrawingSource({ ...baseArgs, persistedState: persistedStateFor('P') });
    expect(() => bare.source().emitDrawingChange(createBlankCadDrawingDocument({ units: 'm' }))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Seam 2 — dependency diagnostics
// ---------------------------------------------------------------------------

const stampedPoint = (
  identity: ResultDependencyIdentity,
  overrides: Partial<Extract<CadEntity, { type: 'survey-point' }>> = {},
): CadEntity =>
  stampAdjustmentDependency(
    {
      id: 'pt:A',
      type: 'survey-point',
      layerId: 'points',
      visible: true,
      locked: false,
      stationId: 'A',
      x: 100,
      y: 200,
      pointClass: 'free',
      source: 'adjustment-result',
      ...overrides,
    },
    identity,
  );

const manualLine = (): CadEntity => ({
  id: 'ln:1',
  type: 'line',
  layerId: 'planning',
  visible: true,
  locked: false,
  fromStationId: 'A',
  toStationId: 'B',
  fromX: 0,
  fromY: 0,
  toX: 10,
  toY: 0,
  sourceObservationIds: [],
  metadata: { manual: true },
});

const f2fPoint = (identity: ResultDependencyIdentity): CadEntity =>
  stampAdjustmentDependency(
    {
      id: 'pt:F',
      type: 'survey-point',
      layerId: 'points',
      visible: true,
      locked: false,
      stationId: 'A',
      x: 1,
      y: 2,
      pointClass: 'free',
      source: 'adjustment-result',
      metadata: {
        provenance: {
          generatedBy: 'FIELD_TO_FINISH',
          sourceStationId: 'A',
          catalogId: 'cat',
          catalogVersion: '1',
          generationRunId: 'run-1',
          state: 'GENERATED',
        },
      },
    },
    identity,
  );

const drawingWith = (entities: CadEntity[], labels: DraftDocumentLabel[] = []): CadDrawingDocument => {
  const base = createBlankCadDrawingDocument({ units: 'm' });
  const draft: DraftDocument =
    base.draft ?? createBlankDraftDocument({ projectId: base.project.id, layers: base.project.layers });
  return {
    ...base,
    project: { ...base.project, entities },
    draft: { ...draft, labels },
  };
};

const stationsA = { stationIds: new Set(['A']) };

describe('cadDependencyDiagnostics — status, reasons, chip text', () => {
  it('reports CURRENT, preserving the owner-conflict fallback phrase', () => {
    const summary = summarizeActiveDrawingDependency(drawingWith([stampedPoint(CURRENT)]), CURRENT, stationsA);
    expect(summary.status).toBe('CURRENT');
    expect(summary.reasons).toEqual([]);
    expect(formatDependencyStatusLabel(summary)).toBe('CURRENT');
    // The engine excludes CAD_CURRENT/CAD_NO_DEPENDENCY from `reasons`, so the
    // pre-extraction root chip also fell through to the owner-conflict phrase.
    expect(getDependencyCause(summary)).toBe('conflicting ownership');
    expect(getDependencyAction(summary)).toBeNull();
    expect(formatDependencyChipText(summary)).toBe('CAD status: CURRENT — conflicting ownership.');
  });

  it('renders MANUAL_ONLY as MANUAL-ONLY', () => {
    const summary = summarizeActiveDrawingDependency(drawingWith([manualLine()]), CURRENT, stationsA);
    expect(summary.status).toBe('MANUAL_ONLY');
    expect(formatDependencyStatusLabel(summary)).toBe('MANUAL-ONLY');
    expect(formatDependencyChipText(summary)).toBe('CAD status: MANUAL-ONLY — conflicting ownership.');
  });

  it('flags missing linked stations and result replacement with action hints', () => {
    const missing = summarizeActiveDrawingDependency(drawingWith([stampedPoint(CURRENT)]), CURRENT, {
      stationIds: new Set(['B']),
    });
    expect(missing.status).toBe('STALE');
    expect(missing.reasons).toContain('CAD_SOURCE_STATION_MISSING');
    expect(formatDependencyChipText(missing)).toBe(
      'CAD status: STALE — linked stations missing. Refresh adjusted points.',
    );

    const replaced = summarizeActiveDrawingDependency(drawingWith([stampedPoint(OTHER)]), CURRENT, stationsA);
    expect(replaced.reasons).toContain('CAD_SOURCE_RESULT_REPLACED');
    expect(getDependencyAction(replaced)).toBe('Refresh adjusted points');
    expect(formatDependencyChipText(replaced)).toBe(
      'CAD status: STALE — result replaced. Refresh adjusted points.',
    );
  });

  it('flags F2F drift and unstamped legacy entities by reason priority', () => {
    const f2f = summarizeActiveDrawingDependency(drawingWith([f2fPoint(CURRENT)]), CURRENT, {
      ...stationsA,
      f2fLinkStatus: 'COORDINATES_CHANGED',
    });
    expect(f2f.reasons).toContain('CAD_F2F_SYNC_INCOMPLETE');
    expect(getDependencyCause(f2f)).toBe('field-to-finish sync incomplete');

    const legacy = summarizeActiveDrawingDependency(drawingWith([stampedPoint(CURRENT, { id: 'pt:L' })]), CURRENT, {
      stationIds: new Set(['A']),
    });
    expect(legacy.status).toBe('CURRENT');
    const unstamped = summarizeActiveDrawingDependency(
      drawingWith([
        {
          id: 'pt:U',
          type: 'survey-point',
          layerId: 'points',
          visible: true,
          locked: false,
          stationId: 'A',
          x: 0,
          y: 0,
          pointClass: 'free',
          source: 'adjustment-result',
          metadata: { importedFrom: 'adjusted-points' },
        },
      ]),
      CURRENT,
      { stationIds: new Set(['A']) },
    );
    expect(unstamped.reasons).toContain('CAD_LEGACY_DEPENDENCY_UNKNOWN');
    expect(getDependencyCause(unstamped)).toBe('unstamped legacy entities');
  });

  it('promotes an otherwise non-stale drawing to STALE for a broken derived label', () => {
    const brokenLabel: DraftDocumentLabel = {
      id: 'label:1',
      text: 'missing',
      xModel: 0,
      yModel: 0,
      layerId: 'labels',
      sourceEntityId: 'pt:missing',
    };
    const summary = summarizeActiveDrawingDependency(drawingWith([manualLine()], [brokenLabel]), CURRENT, stationsA);
    expect(summary.status).toBe('STALE');
    expect(summary.reasons).toEqual(['CAD_DERIVED_LABEL_STALE']);
    expect(summary.reasons).not.toContain('CAD_NO_DEPENDENCY');
    expect(formatDependencyChipText(summary)).toBe(
      'CAD status: STALE — derived annotations stale. Refresh derived annotations.',
    );
  });

  it('does not promote STALE when a derived label resolves to a current source', () => {
    const label: DraftDocumentLabel = {
      id: 'label:ok',
      text: 'A',
      xModel: 0,
      yModel: 0,
      layerId: 'labels',
      sourceEntityId: 'pt:A',
    };
    const summary = summarizeActiveDrawingDependency(drawingWith([stampedPoint(CURRENT)], [label]), CURRENT, stationsA);
    expect(summary.status).toBe('CURRENT');
    expect(summary.reasons).not.toContain('CAD_DERIVED_LABEL_STALE');
  });

  it('falls back to the owner-conflict wording when no reason is recorded', () => {
    const empty: DrawingDependencySummary = {
      status: 'NEEDS_REVIEW',
      currentCount: 0,
      staleCount: 0,
      unknownCount: 0,
      brokenCount: 0,
      manualCount: 0,
      reasons: [],
    };
    expect(getDependencyCause(empty)).toBe('conflicting ownership');
    expect(getDependencyAction(empty)).toBe('Review parcel');
    expect(formatDependencyChipText(empty)).toBe(
      'CAD status: NEEDS_REVIEW — conflicting ownership. Review parcel.',
    );
  });
});

// ---------------------------------------------------------------------------
// Seam 3 — manager/panel composition
// ---------------------------------------------------------------------------

const clickBySelector = (container: HTMLElement, selector: string): void => {
  const element = container.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing element ${selector}`);
  element.click();
};

const mountWorkspace = async (
  props: React.ComponentProps<typeof SurveyCadWorkspace>,
): Promise<{ container: HTMLElement; root: Root }> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<SurveyCadWorkspace {...props} />);
  });
  return { container, root };
};

describe('SurveyCadWorkspaceManagers — conditional overlays and selectors', () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
  });

  it('mounts the drafting panel and export center only after their toggles', async () => {
    ({ container, root } = await mountWorkspace({
      units: 'm',
      result: null,
      drawing: createBlankCadDrawingDocument({ name: 'Overlay', units: 'm' }),
    }));

    expect(container.querySelector('[data-survey-cad-drawing-title]')?.textContent).toContain('Overlay');
    expect(container.querySelector('[data-survey-cad-open-drawing-input]')).not.toBeNull();
    expect(container.querySelector('[data-landxml-import-input]')).not.toBeNull();
    expect(container.querySelector('[data-survey-cad-import-adjusted-points]')).toBeNull();
    expect(container.querySelector('[aria-label="Sheets and layers"]')).toBeNull();
    expect(container.querySelector('[aria-label="Export Center"]')).toBeNull();

    await act(async () => {
      clickBySelector(container, '[data-survey-cad-drafting-panels]');
    });
    expect(container.querySelector('[aria-label="Sheets and layers"]')).not.toBeNull();
    await act(async () => {
      clickBySelector(container, '[data-survey-cad-close-drafting-panel]');
    });
    expect(container.querySelector('[aria-label="Sheets and layers"]')).toBeNull();

    await act(async () => {
      clickBySelector(container, '[data-survey-cad-export-center]');
    });
    expect(container.querySelector('[aria-label="Export Center"]')).not.toBeNull();
    await act(async () => {
      clickBySelector(container, '[data-export-center-close]');
    });
    expect(container.querySelector('[aria-label="Export Center"]')).toBeNull();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('keeps the dependency chip but hides its own chrome when shellChrome is set', async () => {
    ({ container, root } = await mountWorkspace({
      units: 'm',
      result: null,
      drawing: createBlankCadDrawingDocument({ name: 'Shelled', units: 'm' }),
      shellChrome: true,
    }));
    expect(container.querySelector('[data-survey-cad-drawing-title]')).toBeNull();
    expect(container.querySelector('[data-survey-cad-new-drawing]')).toBeNull();
    expect(container.querySelector('[data-survey-cad-open-drawing]')).toBeNull();
    expect(container.querySelector('[data-survey-cad-dependency-status]')?.textContent).toBe(
      'CAD status: MANUAL-ONLY — conflicting ownership.',
    );
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('mounts a survey manager overlay from the shell link and closes it', async () => {
    const link = createCadShellLink();
    ({ container, root } = await mountWorkspace({
      units: 'm',
      result: null,
      drawing: createBlankCadDrawingDocument({ name: 'Managers', units: 'm' }),
      shellLink: link,
    }));

    expect(container.querySelector('[aria-label="Point group manager"]')).toBeNull();
    await act(async () => {
      link.actions?.openSurveyManager?.('point-groups');
    });
    const manager = container.querySelector('[aria-label="Point group manager"]');
    expect(manager).not.toBeNull();
    const closeButton = Array.from(manager!.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Close',
    );
    expect(closeButton).not.toBeUndefined();
    await act(async () => {
      closeButton!.click();
    });
    expect(container.querySelector('[aria-label="Point group manager"]')).toBeNull();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
