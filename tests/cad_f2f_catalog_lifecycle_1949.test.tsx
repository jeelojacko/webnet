/** @vitest-environment jsdom */
/**
 * STRUCT-194.9 — `useSurveyCadFieldToFinishCatalog`.
 *
 * Real production hook driven through a tiny harness + a recording workspace
 * seam. Pins:
 *   - the MISSING_LEGACY fail-closed posture (legacy content without a catalog
 *     is surfaced, never silently treated as the sample),
 *   - the stable starter clone that is never auto-persisted,
 *   - classification against the CURRENT ref with exactly one transaction per
 *     edit, and the ref advanced before the commit,
 *   - rapid edit / undo / drawing-switch never classifying against a stale ref,
 *   - provenance-only GENERATED reference counts,
 *   - shallow-copied field-to-finish settings that preserve the aliases.
 *
 * Fast + deterministic; agent tier.
 */
import React, { StrictMode, act, useEffect, useImperativeHandle, useMemo, useState, type RefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  useSurveyCadFieldToFinishCatalog,
  type SurveyCadFieldToFinishCatalog,
  type SurveyCadFieldToFinishCatalogWorkspace,
} from '../src/hooks/surveyCad/useSurveyCadFieldToFinishCatalog';
import { cloneFeatureCatalog, type FeatureCodeCatalog } from '../src/engine/fieldToFinish/featureCatalog';
import { STARTER_CATALOG } from '../src/engine/fieldToFinish/starterCatalog';
import type { FieldToFinishSettings } from '../src/engine/fieldToFinish/catalogIo';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import type { CadProject, CadSurveyPointEntity } from '../src/engine/cad/cadTypes';

const classifySpy = vi.hoisted(() => ({ calls: [] as Array<{ prev: unknown; next: unknown }> }));

vi.mock('../src/engine/fieldToFinish/linkedSync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/engine/fieldToFinish/linkedSync')>();
  return {
    ...actual,
    classifyCatalogChange: (prev: FeatureCodeCatalog, next: FeatureCodeCatalog) => {
      classifySpy.calls.push({ prev, next });
      return actual.classifyCatalogChange(prev, next);
    },
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const point = (
  id: string,
  metadata?: Record<string, unknown>,
): CadSurveyPointEntity => ({
  id,
  type: 'survey-point',
  layerId: 'points',
  visible: true,
  locked: false,
  stationId: id,
  x: 0,
  y: 0,
  z: 0,
  pointClass: 'free',
  source: 'parsed-input',
  ...(metadata ? { metadata } : {}),
});

const projectWith = (options: {
  catalog?: FeatureCodeCatalog;
  noCatalog?: boolean;
  entities?: CadSurveyPointEntity[];
}): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'F2F 1949', units: 'm' });
  const project: CadProject = {
    ...drawing.project,
    entities: options.entities ?? [],
  };
  // New blank drawings own a starter clone; strip it for the missing-legacy
  // path explicitly.
  if (options.noCatalog) delete project.fieldToFinishCatalog;
  if (options.catalog) project.fieldToFinishCatalog = options.catalog;
  return project;
};

const generated = (defId?: string): Record<string, unknown> => ({
  provenance: {
    generatedBy: 'FIELD_TO_FINISH',
    ...(defId ? { featureDefinitionId: defId } : {}),
  },
});

interface WorkspaceRecorder {
  replacements: Array<{ catalog: FeatureCodeCatalog; change: 'CATALOG_CHANGED' | 'FEATURE_METADATA_CHANGED' | null }>;
  settings: FieldToFinishSettings[];
}

const recorder = (): WorkspaceRecorder => ({ replacements: [], settings: [] });

const workspaceOf = (record: WorkspaceRecorder): SurveyCadFieldToFinishCatalogWorkspace => ({
  replaceFieldToFinishCatalog: (catalog, change) => {
    record.replacements.push({ catalog, change });
  },
  updateFieldToFinishSettings: (settings) => {
    record.settings.push(settings);
  },
});

interface F2fControls {
  setProject: (_project: CadProject) => void;
  bump: () => void;
}

const Harness: React.FC<{
  controls: RefObject<F2fControls | null>;
  initialProject: CadProject;
  workspace: SurveyCadFieldToFinishCatalogWorkspace;
  onApi: (_api: SurveyCadFieldToFinishCatalog) => void;
}> = ({ controls, initialProject, workspace, onApi }) => {
  const [project, setProject] = useState(initialProject);
  const [, setEpoch] = useState(0);
  // Simulate the history transaction: a catalog commit updates the project
  // (so the effect-resync path is exercised like production).
  const localWorkspace = useMemo<SurveyCadFieldToFinishCatalogWorkspace>(() => ({
    replaceFieldToFinishCatalog: (catalog, change) => {
      workspace.replaceFieldToFinishCatalog(catalog, change);
      setProject((current) => ({ ...current, fieldToFinishCatalog: catalog }));
    },
    updateFieldToFinishSettings: workspace.updateFieldToFinishSettings,
  }), [workspace]);
  const api = useSurveyCadFieldToFinishCatalog({ activeProject: project, workspace: localWorkspace });
  useEffect(() => {
    onApi(api);
  });
  useImperativeHandle(controls, () => ({
    setProject,
    bump: () => setEpoch((value) => value + 1),
  }));
  return null;
};

interface Mounted {
  root: Root;
  container: HTMLElement;
  controls: RefObject<F2fControls | null>;
  api: () => SurveyCadFieldToFinishCatalog;
}

const mounted: Mounted[] = [];

const mountF2f = async (
  initialProject: CadProject,
  workspace: SurveyCadFieldToFinishCatalogWorkspace,
  strict = false,
): Promise<Mounted> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const controls: RefObject<F2fControls | null> = { current: null };
  let api: SurveyCadFieldToFinishCatalog | null = null;
  const element = (
    <Harness
      controls={controls}
      initialProject={initialProject}
      workspace={workspace}
      onApi={(value) => {
        api = value;
      }}
    />
  );
  await act(async () => {
    root.render(strict ? <StrictMode>{element}</StrictMode> : element);
  });
  const view: Mounted = {
    root,
    container,
    controls,
    api: () => {
      if (!api) throw new Error('hook not mounted');
      return api;
    },
  };
  mounted.push(view);
  return view;
};

afterEach(async () => {
  for (const view of mounted.splice(0)) {
    await act(async () => {
      view.root.unmount();
    });
    view.container.remove();
  }
  classifySpy.calls.length = 0;
  vi.clearAllMocks();
});

describe('STRUCT-194.9 useSurveyCadFieldToFinishCatalog', () => {
  it('reports MISSING_LEGACY, keeps a stable starter clone, and never auto-persists', async () => {
    const record = recorder();
    const view = await mountF2f(projectWith({ noCatalog: true }), workspaceOf(record));
    const api = view.api();
    expect(api.catalogIsFallback).toBe(true);
    expect(api.catalogStatus).toBe('MISSING_LEGACY');
    expect(api.catalogHasLegacyContent).toBe(false);
    expect(api.activeCatalog.id).toBe(STARTER_CATALOG.id);
    expect(record.replacements).toHaveLength(0);

    const first = api.activeCatalog;
    await act(async () => {
      view.controls.current!.bump();
    });
    expect(view.api().activeCatalog).toBe(first);
    expect(record.replacements).toHaveLength(0);
  });

  it('fails closed as MISSING_LEGACY when F2F content exists without a catalog', async () => {
    const record = recorder();
    const project = projectWith({ noCatalog: true, entities: [point('e1', generated('def-a'))] });
    const view = await mountF2f(project, workspaceOf(record));
    const api = view.api();
    expect(api.catalogIsFallback).toBe(true);
    expect(api.catalogStatus).toBe('MISSING_LEGACY');
    expect(api.catalogHasLegacyContent).toBe(true);
    // Still a panel-local starter fallback, never written silently.
    expect(api.activeCatalog.id).toBe(STARTER_CATALOG.id);
    expect(record.replacements).toHaveLength(0);
  });

  it('reports READY when the drawing owns a catalog', async () => {
    const record = recorder();
    const owned = cloneFeatureCatalog(STARTER_CATALOG);
    const view = await mountF2f(projectWith({ catalog: owned }), workspaceOf(record));
    const api = view.api();
    expect(api.catalogIsFallback).toBe(false);
    expect(api.catalogStatus).toBe('READY');
    expect(api.catalogHasLegacyContent).toBe(false);
    expect(api.activeCatalog).toBe(owned);
  });

  it('classifies against the current ref and commits exactly one transaction per edit', async () => {
    const record = recorder();
    const owned = cloneFeatureCatalog(STARTER_CATALOG);
    const view = await mountF2f(projectWith({ catalog: owned }), workspaceOf(record));
    const api = view.api();
    const next: FeatureCodeCatalog = { ...cloneFeatureCatalog(owned), definitions: [] };

    await act(async () => {
      api.handleFeatureCatalogChange(next);
    });
    expect(record.replacements).toHaveLength(1);
    expect(record.replacements[0]!.change).toBe('CATALOG_CHANGED');
    expect(record.replacements[0]!.catalog).toBe(next);
    expect(classifySpy.calls.at(-1)!.prev).toBe(owned);
    expect(classifySpy.calls.at(-1)!.next).toBe(next);

    // The ref advanced BEFORE the commit, so the second edit classifies
    // against the first `next`, not the stale owned catalog.
    await act(async () => {
      api.handleFeatureCatalogChange(next);
    });
    expect(record.replacements).toHaveLength(2);
    expect(record.replacements[1]!.change).toBeNull();
    expect(classifySpy.calls.at(-1)!.prev).toBe(next);
  });

  it('never classifies against a stale ref across undo and drawing switch', async () => {
    const record = recorder();
    const owned = cloneFeatureCatalog(STARTER_CATALOG);
    const view = await mountF2f(projectWith({ catalog: owned }), workspaceOf(record));
    const api = view.api();
    const next1 = { ...cloneFeatureCatalog(owned), definitions: [] };

    await act(async () => {
      api.handleFeatureCatalogChange(next1);
    });
    expect(view.api().featureCatalogRef.current).toBe(next1);

    // Undo: the parent reverts the project to the original owned catalog.
    await act(async () => {
      view.controls.current!.setProject(projectWith({ catalog: owned }));
    });
    expect(view.api().featureCatalogRef.current).toBe(owned);

    const next2 = { ...cloneFeatureCatalog(owned), definitions: [] };
    await act(async () => {
      view.api().handleFeatureCatalogChange(next2);
    });
    expect(classifySpy.calls.at(-1)!.prev).toBe(owned);

    // Drawing switch: a fresh project with a fresh catalog updates the ref.
    const catalogC = cloneFeatureCatalog(STARTER_CATALOG);
    await act(async () => {
      view.controls.current!.setProject(projectWith({ catalog: catalogC }));
    });
    expect(view.api().featureCatalogRef.current).toBe(catalogC);
    const next3 = { ...cloneFeatureCatalog(catalogC), definitions: [] };
    await act(async () => {
      view.api().handleFeatureCatalogChange(next3);
    });
    expect(classifySpy.calls.at(-1)!.prev).toBe(catalogC);
  });

  it('counts GENERATED references by provenance only', async () => {
    const record = recorder();
    const project = projectWith({
      catalog: cloneFeatureCatalog(STARTER_CATALOG),
      entities: [
        point('a', generated('def-a')),
        point('b', generated('def-a')),
        point('c', generated()), // no definition id -> not counted
        point('d', { provenance: { generatedBy: 'MANUAL' } }), // wrong provenance
        point('e', { note: 'no provenance' }),
        point('f'), // no metadata
      ],
    });
    const view = await mountF2f(project, workspaceOf(record));
    expect(view.api().f2fReferenceCounts).toEqual({ 'def-a': 2 });
  });

  it('shallow-copies field-to-finish settings while preserving aliases', async () => {
    const record = recorder();
    const view = await mountF2f(projectWith({ noCatalog: true }), workspaceOf(record));
    const input: FieldToFinishSettings = { controlTokenAliases: { '*': 'canonical' } };
    await act(async () => {
      view.api().handleFieldToFinishSettingsChange(input);
    });
    expect(record.settings).toHaveLength(1);
    expect(record.settings[0]).not.toBe(input);
    expect(record.settings[0]).toEqual({ controlTokenAliases: { '*': 'canonical' } });
  });

  it('mounts cleanly under StrictMode', async () => {
    const record = recorder();
    const view = await mountF2f(projectWith({ noCatalog: true }), workspaceOf(record), true);
    expect(view.api().activeCatalog.id).toBe(STARTER_CATALOG.id);
    expect(view.api().catalogStatus).toBe('MISSING_LEGACY');
    expect(record.replacements).toHaveLength(0);
  });
});
