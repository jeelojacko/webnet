/** @vitest-environment jsdom */
/**
 * Phase 21B — CAD ribbon icon manifest contract.
 *
 * Locks the curated-icon boundary:
 *   1. every CadRibbonIconId has a {src16, src32} entry that points at a real
 *      committed PNG under src/cad-app/assets/icons/;
 *   2. every icon id referenced from the ribbon code (registry command map,
 *      tool families, tab wiring) resolves in the manifest;
 *   3. no source file references the gitignored local-assets tree.
 *
 * The manifest is presentation-only; dispatch stays in cadCommandRegistry.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAD_RIBBON_ICONS } from '../src/cad-app/assets/icons/cadRibbonIcons';
import { CAD_RIBBON_TOOL_FAMILIES } from '../src/cad-app/shell/cadRibbonToolFamilies';
import { CAD_SHELL_COMMANDS } from '../src/cad-app/shell/cadCommandRegistry';
import { commandIconFor } from '../src/cad-app/shell/CadRibbonShared';
import { CadRibbon } from '../src/cad-app/shell/CadRibbon';
import type { CadShellActions, CadWorkspaceSnapshot } from '../src/cad-app/shell/cadShellTypes';

const ICON_DIR = path.resolve(process.cwd(), 'src/cad-app/assets/icons');

/** Resolve the manifest URL (file: or bundler-rewritten) to its basename. */
const pngBasename = (url: string): string => decodeURIComponent(url).split('/').pop() ?? '';

const isManifestId = (value: string): boolean =>
  Object.prototype.hasOwnProperty.call(CAD_RIBBON_ICONS, value);

const stubActions = (): CadShellActions =>
  ({
    startCommand: () => true,
    runFeatureLineCommand: () => true,
    runGradingCommand: () => true,
    runGradingGroupCommand: () => true,
  } as unknown as CadShellActions);

const stubSnapshot = (): CadWorkspaceSnapshot =>
  ({
    drawingId: 'icon-manifest',
    availableCommands: [],
    layers: [],
    currentLayerId: '0',
  } as unknown as CadWorkspaceSnapshot);

const renderRibbon = async (): Promise<{ container: HTMLElement; root: Root }> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <CadRibbon
        snapshot={stubSnapshot()}
        actions={stubActions()}
        collapsed={false}
        onToggleCollapsed={() => {}}
      />,
    );
  });
  return { container, root };
};

const clickTab = async (container: HTMLElement, label: string): Promise<void> => {
  const tab = Array.from(container.querySelectorAll('[role="tab"]')).find(
    (node) => node.textContent === label,
  );
  if (tab == null) throw new Error(`missing ribbon tab ${label}`);
  await act(async () => {
    (tab as HTMLButtonElement).click();
  });
};

/** Recursively collect every .ts/.tsx source file under src/. */
const sourceFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
};

describe('CAD ribbon icon manifest', () => {
  it('ships a real 16px + 32px PNG for every manifest id', () => {
    const ids = Object.keys(CAD_RIBBON_ICONS);
    expect(ids.length).toBeGreaterThan(50);
    for (const [id, sources] of Object.entries(CAD_RIBBON_ICONS)) {
      for (const [size, url] of [['16', sources.src16], ['32', sources.src32]] as const) {
        expect(url, `${id} src${size}`).toBeTruthy();
        if (url == null) continue;
        expect(url).toContain(`-${size}.png`);
        expect(url).not.toContain('local-assets');
        const file = path.join(ICON_DIR, pngBasename(url));
        const rel = path.relative(ICON_DIR, file);
        expect(rel.startsWith('..'), `${id} must live in the curated icon dir`).toBe(false);
        expect(fs.existsSync(file), `${id} ${size}px file ${file}`).toBe(true);
      }
    }
  });

  it('resolves every registry-referenced command icon', () => {
    for (const def of CAD_SHELL_COMMANDS) {
      const icon = commandIconFor(def.key);
      if (icon == null) continue;
      expect(isManifestId(icon), `${def.key} -> ${icon}`).toBe(true);
    }
  });

  it('resolves every tool-family variant icon', () => {
    for (const family of CAD_RIBBON_TOOL_FAMILIES) {
      for (const variant of family.variants) {
        if (variant.icon == null) continue;
        expect(isManifestId(variant.icon), `${family.id}/${variant.id} -> ${variant.icon}`).toBe(true);
      }
    }
  });

  it('renders only manifest ids on every ribbon tab', async () => {
    const { container, root } = await renderRibbon();
    const seen = new Set<string>();
    for (const tab of ['Home', 'Annotate', 'Survey', 'Surface', 'Output', 'Home']) {
      await clickTab(container, tab);
      for (const node of Array.from(container.querySelectorAll('[data-cad-ribbon-icon]'))) {
        const icon = node.getAttribute('data-cad-ribbon-icon');
        if (icon == null) continue;
        seen.add(icon);
        expect(isManifestId(icon), `rendered unknown icon ${icon} on ${tab}`).toBe(true);
        // Every icon face must keep an accessible name.
        expect((node.getAttribute('aria-label') ?? '').length).toBeGreaterThan(0);
      }
    }
    expect(seen.size).toBeGreaterThan(0);
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('pins every Circle construction variant to its curated icon', () => {
    // Phase B2 Worker C: each Circle row carries an explicit icon so a typo
    // can never silently fall back to a text face (split primary renders
    // currentVariant.icon directly).
    const family = CAD_RIBBON_TOOL_FAMILIES.find((entry) => entry.id === 'circle');
    expect(family).toBeTruthy();
    if (family == null) return;
    const expected: Record<string, keyof typeof CAD_RIBBON_ICONS> = {
      'circle-center-radius': 'draw-circle-center-radius',
      'circle-center-diameter': 'draw-circle-center-diameter',
      'circle-2point': 'draw-circle-2point',
      'circle-3point': 'draw-circle-3point',
      'circle-tan-tan-radius': 'draw-circle-tan-tan-radius',
      'circle-tan-tan-tan': 'draw-circle-tan-tan-tan',
    };
    expect(family.variants.map((variant) => variant.id)).toEqual(Object.keys(expected));
    for (const variant of family.variants) {
      expect(variant.icon, `${variant.id} must not silently fall back to a text face`).toBe(
        expected[variant.id],
      );
      const sources = variant.icon != null ? CAD_RIBBON_ICONS[variant.icon] : undefined;
      expect(sources, `${variant.id} icon manifest entry`).toBeTruthy();
      if (sources == null) continue;
      for (const url of [sources.src16, sources.src32]) {
        if (url == null) continue;
        const file = path.join(ICON_DIR, pngBasename(url));
        expect(fs.existsSync(file), `${variant.id} file ${file}`).toBe(true);
      }
    }
  });

  it('pins every Best Fit variant to its curated icon', () => {
    // Best Fit E1 (Worker C): each row carries an exact Civil best-fit
    // family icon so a typo can never silently fall back to a text face.
    const family = CAD_RIBBON_TOOL_FAMILIES.find((entry) => entry.id === 'bestfit');
    expect(family).toBeTruthy();
    if (family == null) return;
    const expected: Record<string, keyof typeof CAD_RIBBON_ICONS> = {
      'bestfit-line': 'draw-best-fit-line',
      'bestfit-arc': 'draw-best-fit-arc',
      'bestfit-parabola': 'draw-best-fit-parabola',
    };
    const expectedCommandKeys: Record<string, string> = {
      'bestfit-line': 'BESTFITLINE',
      'bestfit-arc': 'BESTFITARC',
      'bestfit-parabola': 'BESTFITPARABOLA',
    };
    expect(family.defaultVariantId).toBe('bestfit-line');
    expect(family.variants.map((variant) => variant.id)).toEqual(Object.keys(expected));
    for (const variant of family.variants) {
      expect(variant.icon, `${variant.id} must not silently fall back to a text face`).toBe(
        expected[variant.id],
      );
      const sources = variant.icon != null ? CAD_RIBBON_ICONS[variant.icon] : undefined;
      expect(sources, `${variant.id} icon manifest entry`).toBeTruthy();
      if (sources == null) continue;
      for (const url of [sources.src16, sources.src32]) {
        if (url == null) continue;
        const file = path.join(ICON_DIR, pngBasename(url));
        expect(fs.existsSync(file), `${variant.id} file ${file}`).toBe(true);
      }
      expect(variant.planned, `${variant.id} is live (no planned flag)`).not.toBe(true);
      expect(variant.commandKey, `${variant.id} carries a full key`).toBe(expectedCommandKeys[variant.id]);
    }
  });

  it('pins every Line construction variant to its curated icon', () => {
    // CAD Draw Phase L1: each Line row carries an explicit icon so a typo can
    // never silently fall back to a text face. Row 1 keeps the existing
    // AutoCAD 'draw-line' face (no generic Civil LINE family exists).
    // Worker B activation: all 17 rows are live with full command keys; this
    // test pins variant->icon mapping + file existence + the live keys.
    const family = CAD_RIBBON_TOOL_FAMILIES.find((entry) => entry.id === 'line');
    expect(family).toBeTruthy();
    if (family == null) return;
    const expected: Record<string, keyof typeof CAD_RIBBON_ICONS> = {
      'line-create': 'draw-line',
      'line-by-point-range': 'draw-line-point-range',
      'line-by-point-object': 'draw-line-point-object',
      'line-by-point-name': 'draw-line-point-name',
      'line-by-northing-easting': 'draw-line-northing-easting',
      'line-by-grid-ne': 'draw-line-grid-ne',
      'line-by-lat-long': 'draw-line-lat-long',
      'line-by-bearing': 'draw-line-bearing',
      'line-by-azimuth': 'draw-line-azimuth',
      'line-by-angle': 'draw-line-angle',
      'line-by-deflection': 'draw-line-deflection',
      'line-by-station-offset': 'draw-line-station-offset',
      'line-by-side-shot': 'draw-line-side-shot',
      'line-by-extension': 'draw-line-extension',
      'line-from-end-of-object': 'draw-line-from-end',
      'line-tangent-from-point': 'draw-line-tangent-point',
      'line-perpendicular-from-point': 'draw-line-perp-point',
    };
    const expectedCommandKeys: Record<string, string> = {
      'line-create': 'LINE',
      'line-by-point-range': 'LINE_POINT_RANGE',
      'line-by-point-object': 'LINE_POINT_OBJECT',
      'line-by-point-name': 'LINE_POINT_NAME',
      'line-by-northing-easting': 'LINE_NE',
      'line-by-grid-ne': 'LINE_GRID_NE',
      'line-by-lat-long': 'LINE_LATLONG',
      'line-by-bearing': 'LINE_BEARING',
      'line-by-azimuth': 'LINE_AZIMUTH',
      'line-by-angle': 'LINE_ANGLE',
      'line-by-deflection': 'LINE_DEFLECTION',
      'line-by-station-offset': 'LINE_STATION_OFFSET',
      'line-by-side-shot': 'LINE_SIDE_SHOT',
      'line-by-extension': 'LINE_EXTENSION',
      'line-from-end-of-object': 'LINE_FROM_END',
      'line-tangent-from-point': 'LINE_TANGENT_POINT',
      'line-perpendicular-from-point': 'LINE_PERP_POINT',
    };
    expect(family.variants.map((variant) => variant.id)).toEqual(Object.keys(expected));
    for (const variant of family.variants) {
      expect(variant.icon, `${variant.id} must not silently fall back to a text face`).toBe(
        expected[variant.id],
      );
      const sources = variant.icon != null ? CAD_RIBBON_ICONS[variant.icon] : undefined;
      expect(sources, `${variant.id} icon manifest entry`).toBeTruthy();
      if (sources == null) continue;
      for (const url of [sources.src16, sources.src32]) {
        if (url == null) continue;
        const file = path.join(ICON_DIR, pngBasename(url));
        expect(fs.existsSync(file), `${variant.id} file ${file}`).toBe(true);
      }
      // CAD Draw L1 activation (Worker B): every row is live with a full key.
      expect(variant.planned, `${variant.id} is live (no planned flag)`).not.toBe(true);
      expect(variant.commandKey, `${variant.id} carries a full key`).toBe(expectedCommandKeys[variant.id]);
    }
  });

  it('never references the gitignored local-assets tree from src/', () => {
    // Comments document provenance, so scan code only (strip // and /* */).
    const stripComments = (text: string): string =>
      text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const offenders = sourceFiles(path.resolve(process.cwd(), 'src')).filter((file) =>
      stripComments(fs.readFileSync(file, 'utf8')).includes('local-assets'),
    );
    expect(offenders).toEqual([]);
  });
});
