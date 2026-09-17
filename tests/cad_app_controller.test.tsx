/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import React, { useEffect, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCadAppController, type CadAppController } from '../src/cad-app/useCadAppController';
import { publishAdjustmentSource, type AdjustmentSourceSnapshot } from '../src/cad-app/cadSourceBridge';
import { buildAdjustmentSourceSnapshot } from '../src/cad-app/cadSourceBridge';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { importSnapshotIntoCadDrawing } from '../src/cad-app/cadSnapshotImport';
import SurveyCadWorkspace from '../src/components/SurveyCadWorkspace';
import type { CadDrawingDocument } from '../src/engine/cad/cadTypes';
import type { StationMap } from '../src/typesObservations';

const STATIONS: StationMap = {
  A: { x: 0, y: 0, h: 0, fixed: true },
  B: { x: 100, y: 0, h: 0, fixed: false },
};

const IDENTITY = {
  inputFingerprint: 'input-a',
  mathFingerprint: 'math-a',
  exclusionFingerprint: 'excl-a',
  runMode: 'adjustment',
};

const makeSnapshot = (): AdjustmentSourceSnapshot =>
  buildAdjustmentSourceSnapshot({
    projectId: 'proj-a',
    projectName: 'Project A',
    runMode: 'adjustment',
    appliedRunIdentity: IDENTITY,
    resultFingerprint: 'fp-a',
    generatedAt: '2026-09-17T00:00:00.000Z',
    units: 'm',
    crsId: null,
    crsLabel: null,
    stations: STATIONS,
  });

const renderProbe = async (
  container: HTMLElement,
  args: Parameters<typeof useCadAppController>[0],
): Promise<{ root: Root; current: () => CadAppController }> => {
  const root = createRoot(container);
  let latest: CadAppController | null = null;
  const Probe: React.FC = () => {
    const controller = useCadAppController(args);
    useEffect(() => {
      latest = controller;
    });
    return null;
  };
  await act(async () => {
    root.render(<Probe />);
  });
  return {
    root,
    current: () => {
      if (!latest) throw new Error('controller not mounted');
      return latest;
    },
  };
};

beforeEach(() => {
  window.localStorage.clear();
});

describe('useCadAppController', () => {
  it('starts clean, dirties on change, and cleans on lifecycle events', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const { root, current } = await renderProbe(container, {});
    expect(current().session.dirty).toBe(false);

    const next = {
      ...current().session.drawing,
      name: 'Edited',
    };
    await act(async () => {
      current().applyDrawingChange(next);
    });
    expect(current().session.dirty).toBe(true);
    expect(current().session.drawing.name).toBe('Edited');

    await act(async () => {
      current().applyLifecycleEvent('cad-saved', 'edited.wncad');
    });
    expect(current().session.dirty).toBe(false);
    expect(current().session.saveTargetName).toBe('edited.wncad');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('resolves a pending source without importing (explicit import only)', async () => {
    const snapshot = makeSnapshot();
    publishAdjustmentSource(snapshot);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const { root, current } = await renderProbe(container, { initialSourceId: snapshot.sourceId });

    expect(current().pendingSnapshot?.sourceId).toBe(snapshot.sourceId);
    expect(current().invalidSourceId).toBeNull();
    // Never silently imports on navigation: no adjusted-point entities yet.
    expect(
      current().session.drawing.project.entities.filter((entity) => entity.type === 'survey-point'),
    ).toEqual([]);

    await act(async () => {
      current().handleImportPendingSource();
    });
    expect(
      current().session.drawing.project.entities.filter((entity) => entity.type === 'survey-point'),
    ).toHaveLength(2);
    expect(current().session.dirty).toBe(true);

    // Dismiss leaves the drawing unchanged.
    const entityCount = current().session.drawing.project.entities.length;
    await act(async () => {
      current().handleDismissPendingSource();
    });
    expect(current().pendingSnapshot).toBeNull();
    expect(current().session.drawing.project.entities).toHaveLength(entityCount);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('warns on an invalid source token and still loads a blank drawing', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const { root, current } = await renderProbe(container, { initialSourceId: 'cad-src:missing:fp' });
    expect(current().pendingSnapshot).toBeNull();
    expect(current().invalidSourceId).toBe('cad-src:missing:fp');
    expect(current().session.drawing.kind).toBe('webnet-cad-drawing');
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});

describe('unsaved guard', () => {
  it('blocks guarded navigation while dirty unless confirmed', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const { root, current } = await renderProbe(container, {});
    expect(current().requireCleanOrConfirm('Leave')).toBe(true);

    await act(async () => {
      current().applyDrawingChange({ ...current().session.drawing, name: 'Dirty' });
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      expect(current().requireCleanOrConfirm('Leave')).toBe(false);
      confirmSpy.mockReturnValue(true);
      expect(current().requireCleanOrConfirm('Leave')).toBe(true);
    } finally {
      confirmSpy.mockRestore();
    }
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});

describe('Send to CAD gate', () => {
  it('stays disabled without a fresh successful production run', async () => {
    const { default: App } = await import('../src/App');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<App />);
    });
    const sendButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Send to CAD',
    );
    expect(sendButton).not.toBeUndefined();
    expect(sendButton?.disabled).toBe(true);
    expect(sendButton?.title).toContain('fresh successful production run');
    // The embedded CAD tab is gone: no workspace preview renders inline.
    expect(container.querySelector('[data-survey-cad-preview]')).toBeNull();
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
describe('SurveyCadWorkspace standalone view', () => {
  const renderWorkspace = async (
    container: HTMLElement,
    snapshot: AdjustmentSourceSnapshot | null,
  ): Promise<Root> => {
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <SurveyCadWorkspace
          units="m"
          result={null}
          drawing={createBlankCadDrawingDocument({ name: 'Cad', units: 'm' })}
          adjustmentSnapshot={snapshot}
          resultDependencyIdentity={snapshot?.appliedRunIdentity ?? null}
        />,
      );
    });
    return root;
  };

  it('shows Import + dependency status with a snapshot, no Adjustment messaging without one', async () => {
    const snapshot = makeSnapshot();
    const withSource = document.createElement('div');
    document.body.appendChild(withSource);
    const rootA = await renderWorkspace(withSource, snapshot);
    expect(withSource.querySelector('[data-survey-cad-import-adjusted-points]')).not.toBeNull();
    expect(withSource.querySelector('[data-survey-cad-dependency-status]')?.textContent).toContain(
      'MANUAL-ONLY',
    );
    await act(async () => {
      rootA.unmount();
    });
    withSource.remove();

    const standalone = document.createElement('div');
    document.body.appendChild(standalone);
    const rootB = await renderWorkspace(standalone, null);
    expect(standalone.querySelector('[data-survey-cad-import-adjusted-points]')).toBeNull();
    expect(standalone.textContent).not.toContain('Re-run the adjustment');
    expect(standalone.querySelector('[data-survey-cad-new-drawing]')).not.toBeNull();
    expect(standalone.querySelector('[data-survey-cad-open-drawing]')).not.toBeNull();
    await act(async () => {
      rootB.unmount();
    });
    standalone.remove();
  });
});

describe('external-update settling (adoption/persistence race guard)', () => {
  it('an external snapshot import settles with CURRENT and does not ping-pong', async () => {
    const snapshot = makeSnapshot();
    publishAdjustmentSource(snapshot);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    let doImport: (() => void) | null = null;
    const Harness: React.FC = () => {
      const [drawing, setDrawing] = useState<CadDrawingDocument | null>(() =>
        createBlankCadDrawingDocument({ name: 'Cad', units: 'm' }),
      );
      useEffect(() => {
        doImport = () => {
          if (!drawing) return;
          const imported = importSnapshotIntoCadDrawing({ document: drawing, snapshot });
          if (imported.ok) setDrawing(imported.drawing);
        };
      });
      return (
        <SurveyCadWorkspace
          units="m"
          result={null}
          drawing={drawing}
          onDrawingChange={setDrawing}
          adjustmentSnapshot={snapshot}
          resultDependencyIdentity={snapshot.appliedRunIdentity}
        />
      );
    };
    await act(async () => {
      root.render(<Harness />);
    });
    doImport!();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(container.querySelector('[data-survey-cad-entity-count]')?.textContent).toContain(
      '4 entities',
    );
    expect(container.querySelector('[data-survey-cad-dependency-status]')?.textContent).toContain(
      'CURRENT',
    );
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }, 20000);
});
