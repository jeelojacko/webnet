/** @vitest-environment jsdom */

import { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import {
  addSheetToDraft,
  addViewportToSheet,
  createPlanSheet,
  rotateViewport,
  setViewportScale,
} from '../src/engine/cad/cadSheets';
import { createBlankDraftDocument } from '../src/engine/cad/cadDraftTypes';
import type { CadProject } from '../src/engine/cad/cadTypes';
import { useDraftSheetHistory } from '../src/cad-app/shell/useDraftSheetHistory';
import { SheetWorkspace } from '../src/components/surveyCad/SheetWorkspace';
import {
  formatPaperStatus,
  type PaperStatus,
} from '../src/components/surveyCad/SheetWorkspace.types';
import {
  hitTestPaper,
  isViewportLocked,
  movePaperObject,
  moveViewportPaper,
  nearestPaperSnap,
  normalizeRotationDeg,
  panViewportModelCenter,
  paperSnapPoints,
  resizeViewportPaper,
  resolveFitScale,
  setViewportDenominator,
} from '../src/components/surveyCad/SheetWorkspace.utils';

const buildDraft = () => {
  let draft = addSheetToDraft(createBlankDraftDocument({ projectId: 'p1' }), createPlanSheet({ name: 'L1' }));
  const sheetId = draft.sheets[0]?.id as string;
  draft = addViewportToSheet(draft, sheetId, {
    name: 'V', modelCenterX: 50, modelCenterY: 25, scaleDenominator: 500,
    paperXmm: 15, paperYmm: 15, paperWidthMm: 200, paperHeightMm: 130, rotationDeg: 0,
  });
  return { draft, sheetId, viewportId: draft.sheets[0]?.viewports[0]?.id as string };
};

const buildProject = (): CadProject => {
  const project = createBlankCadProject({ name: 'Sheet WS', units: 'm' });
  project.entities = [];
  return project;
};

describe('sheet workspace paper ops (engine-UI seams §§85-90)', () => {
  it('paper move keeps center and scale', () => {
    const { draft, viewportId } = buildDraft();
    const before = draft.sheets[0]?.viewports.find((entry) => entry.id === viewportId);
    const moved = moveViewportPaper(before!, 10, -5);
    expect(moved.paperXmm).toBe(25);
    expect(moved.paperYmm).toBe(10);
    expect(moved.modelCenterX).toBe(before!.modelCenterX);
    expect(moved.modelCenterY).toBe(before!.modelCenterY);
    expect(moved.scaleDenominator).toBe(before!.scaleDenominator);
  });

  it('paper resize keeps scale and center', () => {
    const { draft, viewportId } = buildDraft();
    const before = draft.sheets[0]?.viewports.find((entry) => entry.id === viewportId);
    const resized = resizeViewportPaper(before!, 120, 90);
    expect(resized.paperWidthMm).toBe(120);
    expect(resized.paperHeightMm).toBe(90);
    expect(resized.scaleDenominator).toBe(500);
    expect(resized.modelCenterX).toBe(50);
    expect(resized.modelCenterY).toBe(25);
  });

  it('locked viewports block pan, scale, rotation, and paper edits', () => {
    const { draft, sheetId, viewportId } = buildDraft();
    const locked = { ...draft.sheets[0]?.viewports.find((entry) => entry.id === viewportId)!, locked: true };
    expect(isViewportLocked(locked)).toBe(true);
    expect(moveViewportPaper(locked, 5, 5)).toBe(locked);
    expect(resizeViewportPaper(locked, 50, 50)).toBe(locked);
    expect(panViewportModelCenter(locked, { x: 0, y: 0 })).toBe(locked);
    expect(setViewportDenominator(locked, 100)).toBeUndefined();
    // Engine layer agrees: scale/rotation helpers still validate, UI never calls them locked.
    expect(setViewportScale(draft, sheetId, viewportId, -3)).toBeUndefined();
    expect(rotateViewport(draft, sheetId, viewportId, Number.NaN)).toBeUndefined();
  });

  it('rotation never mutates model coordinates (byte-identical check)', () => {
    const { draft, sheetId, viewportId } = buildDraft();
    const projectJson = JSON.stringify(buildProject().entities);
    const rotated = rotateViewport(draft, sheetId, viewportId, normalizeRotationDeg(-45));
    expect(rotated).toBeDefined();
    const viewport = rotated!.sheets[0]?.viewports.find((entry) => entry.id === viewportId);
    expect(viewport?.rotationDeg).toBe(315);
    expect(viewport?.modelCenterX).toBe(50);
    expect(viewport?.modelCenterY).toBe(25);
    expect(viewport?.scaleDenominator).toBe(500);
    expect(JSON.stringify(buildProject().entities)).toBe(projectJson);
  });

  it('pins rotation normalization (0/30/90/-45)', () => {
    expect(normalizeRotationDeg(0)).toBe(0);
    expect(normalizeRotationDeg(30)).toBe(30);
    expect(normalizeRotationDeg(90)).toBe(90);
    expect(normalizeRotationDeg(-45)).toBe(315);
    expect(normalizeRotationDeg(Number.NaN)).toBe(0);
  });

  it('fit scale is an explicit exact-vs-standard choice (no silent rounding)', () => {
    const args = { modelWidthM: 100, modelHeightM: 50, paperWidthMm: 200, paperHeightMm: 130 };
    // Exact: 100*1000/200 = 500 verbatim.
    expect(resolveFitScale(args, 'exact')).toBe(500);
    // Standard: 500 is already standard — no rounding.
    expect(resolveFitScale(args, 'standard')).toBe(500);
    // Exact 600 → standard rounds UP to 1000, never down to 500.
    const off = { ...args, modelWidthM: 120 };
    expect(resolveFitScale(off, 'exact')).toBe(600);
    expect(resolveFitScale(off, 'standard')).toBe(1000);
  });

  it('paper snaps are bounded (no model geometry through viewports)', () => {
    const { draft } = buildDraft();
    const sheet = draft.sheets[0]!;
    const points = paperSnapPoints(sheet);
    // 4 sheet corners + 4 margins + 8 viewport + 4 title corners, no objects yet.
    expect(points).toHaveLength(20);
    expect(points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
    const snapped = nearestPaperSnap(points, { x: 15.5, y: 15.2 }, 2);
    expect(snapped?.label).toBe('viewport corner');
    expect(nearestPaperSnap(points, { x: 300, y: 300 }, 2)).toBeNull();
    // Viewport frame wins over nearby objects; otherwise deterministic by id.
    expect(hitTestPaper(sheet, 20, 20)).toEqual({ kind: 'viewport', viewportId: sheet.viewports[0]?.id });
    expect(hitTestPaper(sheet, 5, 5)).toBeNull();
  });

  it('plan-note objects move by insertion grip only', () => {
    const { draft, sheetId } = buildDraft();
    const withNote = {
      ...draft,
      sheets: draft.sheets.map((entry) =>
        entry.id === sheetId
          ? { ...entry, sheetObjects: [{ id: 'n1', kind: 'plan-note', layerId: 'labels', paperXmm: 10, paperYmm: 10, text: 'hi' }] }
          : entry,
      ),
    };
    const note = withNote.sheets[0]?.sheetObjects[0]!;
    const moved = movePaperObject(note, 3, 4);
    expect(moved.paperXmm).toBe(13);
    expect(moved.paperYmm).toBe(14);
    expect(moved.text).toBe('hi');
    expect(hitTestPaper(withNote.sheets[0]!, 10, 10)).toEqual({ kind: 'paper-object', objectId: 'n1' });
  });

  it('formats the §71 status bar readout (never paper zoom)', () => {
    const status: PaperStatus = { sheetName: 'L1', sheetIndex: 0, viewportScaleDenominator: 500, viewportLocked: true };
    expect(formatPaperStatus(status)).toBe('Layout1 | Viewport: 1:500 | Locked');
    expect(formatPaperStatus({ ...status, viewportLocked: false })).toBe('Layout1 | Viewport: 1:500');
    expect(formatPaperStatus({ ...status, viewportScaleDenominator: null })).toBe('Layout1');
  });
});

describe('draft sheet history routing (§§83-84)', () => {
  it('coalesces transient drag ticks into one undoable transaction', () => {
    const { draft, sheetId } = buildDraft();
    const holder: {
      current: ReturnType<typeof useDraftSheetHistory> | null;
      live: typeof draft | null;
    } = { current: null, live: null };
    const shiftPaperX = (live: typeof draft, dx: number): typeof draft => ({
      ...live,
      sheets: live.sheets.map((entry) =>
        entry.id === sheetId
          ? { ...entry, viewports: entry.viewports.map((vp) => ({ ...vp, paperXmm: vp.paperXmm + dx })) }
          : entry,
      ),
    });
    const Harness = ({ initial }: { initial: typeof draft }): null => {
      const [live, setLive] = useState(initial);
      const controller = useDraftSheetHistory(live, setLive);
      useEffect(() => {
        holder.current = controller;
        holder.live = live;
      });
      return null;
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<Harness initial={draft} />);
    });
    expect(holder.current?.canUndo).toBe(false);
    // Discrete commit: one undo step.
    act(() => {
      holder.current?.commit(shiftPaperX(holder.live!, 1));
    });
    expect(holder.current?.canUndo).toBe(true);
    expect(holder.live?.sheets[0]?.viewports[0]?.paperXmm).toBe(16);
    // Drag ticks coalesce; the pointer-up close adds no second step.
    act(() => {
      holder.current?.commit(shiftPaperX(holder.live!, 0.5), { transient: true });
    });
    act(() => {
      holder.current?.commit(shiftPaperX(holder.live!, 0.5), { transient: true });
    });
    act(() => {
      holder.current?.commit(holder.live!);
    });
    expect(holder.live?.sheets[0]?.viewports[0]?.paperXmm).toBe(17);
    act(() => {
      holder.current?.undo();
    });
    // One undo returns past the whole drag to the discrete commit.
    expect(holder.live?.sheets[0]?.viewports[0]?.paperXmm).toBe(16);
    act(() => {
      holder.current?.undo();
    });
    expect(holder.live?.sheets[0]?.viewports[0]?.paperXmm).toBe(15);
    expect(holder.current?.canUndo).toBe(false);
    act(() => {
      holder.current?.redo();
    });
    expect(holder.live?.sheets[0]?.viewports[0]?.paperXmm).toBe(16);
    act(() => {
      root.unmount();
    });
    container.remove();
  });
});

describe('sheet workspace render', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    container.remove();
  });

  it('derives svg size from the sheet with a scroll container', () => {
    const { draft, sheetId } = buildDraft();
    const sheet = draft.sheets[0]!;
    root = createRoot(container);
    act(() => {
      root?.render(<SheetWorkspace project={buildProject()} draft={draft} activeSheetId={sheetId} projectName="P" />);
    });
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('viewBox')).toBe(`0 0 ${sheet.widthMm} ${sheet.heightMm}`);
    const widthPx = Number(svg?.getAttribute('width'));
    const heightPx = Number(svg?.getAttribute('height'));
    // Same px/mm factor on both axes, derived from the sheet (never 640x420).
    expect(widthPx / sheet.widthMm).toBeCloseTo(heightPx / sheet.heightMm, 9);
    expect(widthPx).not.toBe(640);
    expect(container.querySelector("[aria-label='Paper scroll area']")).not.toBeNull();
    // Selection overlay starts empty (UI-only, never scene content).
    expect(container.querySelectorAll("g[aria-label^='Viewport frame']").length).toBeGreaterThan(0);
  });
});
