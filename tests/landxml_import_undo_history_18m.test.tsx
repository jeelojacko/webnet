/** @vitest-environment jsdom */
/**
 * Phase 18M — LandXML import keeps its undo transaction (workspace seam).
 *
 * Regression: after a deferred `LANDXML_IMPORT` commit, the parent drawing
 * sync clones the project (`cloneCadSurfaceDefinition` normalizes the
 * imported-TIN definition key order), so a plain `JSON.stringify`
 * comparison in the external-adopt history effect mistook the clone for an
 * external update and wiped the just-committed transaction (SHELL_UNDO
 * disabled). The adopt effect now compares order-insensitive signatures.
 */
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import React from 'react';
import { describe, expect, it } from 'vitest';

import {
  cloneCadDrawingDocument,
  createBlankCadDrawingDocument,
} from '../src/engine/cad/cadDrawingFile';
import type { CadDrawingDocument } from '../src/engine/cad/cadTypes';
import {
  buildCadProjectSignature,
  buildStableCadProjectSignature,
} from '../src/engine/cad/cadProjectState';
import { createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import { buildLandXmlImportPreview } from '../src/engine/landxmlImport';
import {
  buildLandXmlImportCommitPayload,
  createLandXmlImportReviewSelection,
} from '../src/components/landXmlImportReview/landXmlImportReview.selection';
import { useSurveyCadWorkspace } from '../src/hooks/surveyCad/useSurveyCadWorkspace';
import type { UseSurveyCadWorkspaceResult } from '../src/hooks/surveyCad/useSurveyCadWorkspace.types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const XML = readFileSync('tests/fixtures/landxml-18m-production.xml', 'utf8');

const commitPayload = () => {
  const preview = buildLandXmlImportPreview(XML, { fileName: 'landxml-18m-production.xml' });
  return buildLandXmlImportCommitPayload({
    drawingId: 'test-drawing',
    fileName: 'landxml-18m-production.xml',
    version: '1.2',
    preview,
    selection: createLandXmlImportReviewSelection(preview),
  });
};

/** Parent-held drawing state, mirroring the /cad shell wiring. */
const ProbeInner: React.FC<{
  drawing: CadDrawingDocument;
  setDrawing: React.Dispatch<React.SetStateAction<CadDrawingDocument | null>>;
  onApi: (_api: UseSurveyCadWorkspaceResult) => void;
}> = ({ drawing, setDrawing, onApi }) => {
  const cache = React.useMemo(() => createCadSurfaceCache(drawing.drawingId), [drawing.drawingId]);
  const ws = useSurveyCadWorkspace(
    drawing.project,
    drawing.drawingId,
    setDrawing,
    drawing,
    undefined,
    true,
    false,
    'thin',
    cache,
  );
  React.useEffect(() => {
    onApi(ws);
  });
  return null;
};

const mountWorkspace = async () => {
  let api: UseSurveyCadWorkspaceResult | null = null;
  const Probe: React.FC = () => {
    const [drawing, setDrawing] = React.useState<CadDrawingDocument | null>(() =>
      createBlankCadDrawingDocument({ units: 'm' }),
    );
    if (!drawing) return null;
    return <ProbeInner drawing={drawing} setDrawing={setDrawing} onApi={(next) => { api = next; }} />;
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(<Probe />);
  });
  return {
    current: () => api!,
    commit: async () => {
      await act(async () => {
        const probe = api!;
        const payload = commitPayload();
        probe.runLandXmlImport(payload.preview, payload.fileName, payload.commitSelection);
      });
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
};

describe('LandXML import undo history (18M)', () => {
  it('keeps the LANDXML_IMPORT transaction: one undo removes the import, redo restores it', async () => {
    const ws = await mountWorkspace();
    expect(ws.current().canUndo).toBe(false);

    await ws.commit();

    const committed = ws.current();
    expect(committed.cadProject.entities).toHaveLength(6);
    expect(committed.cadProject.surfaces).toHaveLength(1);
    expect(committed.canUndo).toBe(true);
    expect(committed.historyDepth).toBe(1);

    await act(async () => {
      ws.current().undo();
    });
    const undone = ws.current();
    expect(undone.cadProject.entities).toHaveLength(0);
    expect(undone.cadProject.surfaces ?? []).toHaveLength(0);
    expect(undone.canRedo).toBe(true);

    await act(async () => {
      ws.current().redo();
    });
    const redone = ws.current();
    expect(redone.cadProject.entities).toHaveLength(6);
    expect(redone.cadProject.surfaces).toHaveLength(1);
    expect(redone.canUndo).toBe(true);

    await ws.unmount();
  });

  it('treats the drawing-sync clone as content-equal (stable signature)', async () => {
    const ws = await mountWorkspace();
    await ws.commit();
    const historyProject = ws.current().cadProject;
    const cloned = cloneCadDrawingDocument({
      ...createBlankCadDrawingDocument({ units: 'm' }),
      project: historyProject,
    }).project;
    // Pins the original failure mode: plain stringify diverges on the
    // clone's normalized surface-definition key order.
    expect(buildCadProjectSignature(historyProject)).not.toBe(buildCadProjectSignature(cloned));
    expect(buildStableCadProjectSignature(historyProject)).toBe(
      buildStableCadProjectSignature(cloned),
    );
    await ws.unmount();
  });
});
