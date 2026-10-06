import { describe, expect, it } from 'vitest';
import {
  CAD_RIBBON_TOOL_FAMILIES,
  buildCadRibbonDefaultVariantMap,
  findCadRibbonToolFamily,
  isCadRibbonVariantSelectable,
  resolveCadRibbonCurrentVariant,
  type CadRibbonToolFamily,
} from '../src/cad-app/shell/cadRibbonToolFamilies';
import { resolveShellCommandText } from '../src/cad-app/shell/cadCommandRegistry';

const family = (id: string): CadRibbonToolFamily => {
  const found = findCadRibbonToolFamily(id);
  if (found == null) throw new Error(`missing family ${id}`);
  return found;
};

const commandKeys = (value: CadRibbonToolFamily): Array<string | undefined> =>
  value.variants.map((variant) => variant.commandKey);

describe('phase 21A tool-family manifests (§80)', () => {
  it('keeps Arc in the exact §17 variant order with ARC_3PT as default', () => {
    const arc = family('arc');
    expect(arc.defaultVariantId).toBe('arc-3pt');
    expect(commandKeys(arc)).toEqual([
      'ARC_3PT',
      'ARC_SCE',
      'ARC_SCA',
      'ARC_SCL',
      'ARC_SEA',
      'ARC_SED',
      'ARC_SER',
      'ARC_CSE',
      'ARC_CSA',
      'ARC_CSL',
      'CONTINUE_CURVE',
    ]);
    expect(arc.variants.every((variant) => variant.planned !== true)).toBe(true);
  });

  it('keeps Arc and Curves as separate family ids', () => {
    expect(CAD_RIBBON_TOOL_FAMILIES.filter((entry) => entry.id === 'arc')).toHaveLength(1);
    expect(CAD_RIBBON_TOOL_FAMILIES.filter((entry) => entry.id === 'curves')).toHaveLength(1);
    expect(family('arc').id).not.toBe(family('curves').id);
    // No arc construction command leaks into Curves, and no curve COGO key leaks into Arc.
    expect(commandKeys(family('curves'))).not.toContain('ARC_3PT');
    expect(commandKeys(family('arc'))).not.toContain('CURVE_SOLVER');
  });

  it('line family is Create Line + 16 reference rows and never contains Polyline', () => {
    const line = family('line');
    expect(line.defaultVariantId).toBe('line-create');
    expect(line.variants).toHaveLength(17);
    expect(resolveCadRibbonCurrentVariant(line, line.defaultVariantId).commandKey).toBe('LINE');
    for (const variant of line.variants) {
      expect(`${variant.id} ${variant.label}`.toLowerCase()).not.toContain('polyline');
    }
    // The 16 Civil reference rows carry no fake key.
    const referenceRows = line.variants.filter((variant) => variant.id !== 'line-create');
    expect(referenceRows).toHaveLength(16);
    expect(referenceRows.every((variant) => variant.planned === true)).toBe(true);
    expect(referenceRows.every((variant) => variant.commandKey == null)).toBe(true);
  });

  it('curves maps only proven WebNet semantics and keeps the Civil combined row planned', () => {
    const curves = family('curves');
    const calculator = curves.variants.find((variant) => variant.id === 'curves-calculator');
    expect(calculator?.commandKey).toBe('CURVE_SOLVER');
    expect(calculator?.planned).not.toBe(true);
    const combined = curves.variants.find((variant) => variant.id === 'curves-reverse-compound');
    expect(combined?.planned).toBe(true);
    expect(combined?.commandKey).toBeUndefined();
    const webnet = curves.variants.filter((variant) => variant.commandKey != null && variant.id !== 'curves-calculator');
    expect(webnet.map((variant) => variant.commandKey)).toEqual([
      'TANGENT_CURVE',
      'PI_CURVE',
      'CHORD_BEARING_CURVE',
      'REVERSE_CURVE',
      'COMPOUND_CURVE',
      'POINT_ON_CURVE',
      'SUBDIVIDE_CURVE',
      'OFFSET_CURVE',
      'LINE_CIRCLE_INTX',
    ]);
    expect(curves.variants.find((variant) => variant.id === 'curves-tangent')?.separatorBefore).toBe(true);
  });

  it('keeps Best Fit / Ellipse / Hatch as honest planned rows', () => {
    for (const id of ['bestfit', 'ellipse', 'hatch']) {
      const entry = family(id);
      expect(entry.variants.length).toBeGreaterThan(0);
      expect(entry.variants.every((variant) => variant.planned === true)).toBe(true);
      expect(entry.variants.every((variant) => variant.commandKey == null)).toBe(true);
    }
    // Hatch rows keep their curated icons even while planned.
    expect(family('hatch').variants.map((variant) => variant.icon)).toEqual([
      'hatch-pattern',
      'hatch-gradient',
      'hatch-retain-boundary',
    ]);
  });

  it('maps Circle rows to the live CIRCLE / CIRCLECD commands', () => {
    const entry = family('circle');
    expect(entry.defaultVariantId).toBe('circle-center-radius');
    const byId = new Map(entry.variants.map((variant) => [variant.id, variant]));
    expect(byId.get('circle-center-radius')?.commandKey).toBe('CIRCLE');
    expect(byId.get('circle-center-diameter')?.commandKey).toBe('CIRCLECD');
    expect(byId.get('circle-2point')?.commandKey).toBeUndefined();
    expect(byId.get('circle-3point')?.commandKey).toBeUndefined();
    expect(byId.get('circle-tan-tan-radius')?.commandKey).toBeUndefined();
    expect(byId.get('circle-tan-tan-tan')?.commandKey).toBeUndefined();
    expect(isCadRibbonVariantSelectable(entry, 'circle-center-radius')).toBe(true);
    expect(isCadRibbonVariantSelectable(entry, 'circle-2point')).toBe(false);
  });
  it('maps Shapes rows to the live RECTANGLE / POLYGON commands', () => {
    const entry = family('shapes');
    expect(entry.defaultVariantId).toBe('shapes-rectangle');
    expect(entry.variants.map((variant) => variant.commandKey)).toEqual([
      'RECTANGLE',
      'POLYGON',
    ]);
    expect(entry.variants.every((variant) => variant.planned == null)).toBe(true);
  });

  it('gives every mapped commandKey a real registry definition and every planned row no key', () => {
    for (const entry of CAD_RIBBON_TOOL_FAMILIES) {
      for (const variant of entry.variants) {
        if (variant.commandKey == null) {
          expect(variant.planned).toBe(true);
          continue;
        }
        expect(variant.planned).not.toBe(true);
        expect(resolveShellCommandText(variant.commandKey)?.key).toBe(variant.commandKey);
      }
    }
  });

  it('resolves the current variant with a default fallback and refuses planned selections', () => {
    const arc = family('arc');
    expect(resolveCadRibbonCurrentVariant(arc, 'arc-sce').commandKey).toBe('ARC_SCE');
    expect(resolveCadRibbonCurrentVariant(arc, 'missing').commandKey).toBe('ARC_3PT');
    expect(resolveCadRibbonCurrentVariant(arc, null).commandKey).toBe('ARC_3PT');
    expect(isCadRibbonVariantSelectable(arc, 'arc-sce')).toBe(true);
    expect(isCadRibbonVariantSelectable(arc, 'arc-nope')).toBe(false);
    expect(isCadRibbonVariantSelectable(family('circle'), 'circle-center-radius')).toBe(true);
    expect(isCadRibbonVariantSelectable(family('circle'), 'circle-2point')).toBe(false);
  });

  it('builds the default variant map for every family', () => {
    const defaults = buildCadRibbonDefaultVariantMap();
    for (const entry of CAD_RIBBON_TOOL_FAMILIES) {
      expect(defaults[entry.id]).toBe(entry.defaultVariantId);
    }
  });
});
