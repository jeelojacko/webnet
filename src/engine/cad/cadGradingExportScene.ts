/**
 * Phase 20B export slice — grading (daylight + grading surface) → export geometry.
 *
 * Disposition truth (one constant per format, surfaced in export warnings):
 * - SVG/PDF carry the CURRENT daylight tie line + optional triangle fill = FULL.
 * - DXF R12/R2000 carry the daylight as a true 3D POLYLINE and the grading
 *   mesh as 3DFACE (both serializers support these forms) = FULL.
 * - LandXML has no grading schema (the workflow is Bake → Surface export) =
 *   NOT_APPLICABLE; live grading geometry is withheld with an explicit warning.
 *
 * CURRENT-only gate: a grading whose status is anything other than CURRENT
 * emits no geometry; the withheld status is always warned. Curve-approximated
 * results ride an explicit APPROXIMATED warning but still export.
 */
import type { CadGradingResult } from './grading/gradingTypes';
import type { ExportWarning } from './exportResult';
import type { ExportItem } from './cadExportItemTypes';

/** Minimum definition identity an exporter needs (structural). */
export interface GradingExportIdentity {
  id: string;
  name: string;
  layerId?: string;
}

export const GRADING_SHEET_DISPOSITION = 'FULL' as const;
export const GRADING_DXF_DAYLIGHT_DISPOSITION = 'FULL' as const;
export const GRADING_DXF_MESH_DISPOSITION = 'FULL' as const;
export const GRADING_LANDXML_DISPOSITION = 'NOT_APPLICABLE' as const;

export const DEFAULT_GRADING_LAYER = 'grading';
export const DEFAULT_GRADING_DAYLIGHT_LAYER = 'grading-daylight';
export const GRADING_DAYLIGHT_COLOR = '#00b7ff';
export const GRADING_FILL_COLOR = '#3f6212';
export const GRADING_FILL_OPACITY = 0.35;

/** One CURRENT grading with its derived session result. */
export interface CadGradingExportLayer {
  grading: GradingExportIdentity;
  status: string;
  /** Ignored unless status === 'CURRENT'. */
  result: CadGradingResult | null;
}

export interface CadGradingExportInput {
  layers?: CadGradingExportLayer[];
}

const layerIdOf = (grading: GradingExportIdentity): string => grading.layerId ?? DEFAULT_GRADING_LAYER;

export const isGradingLayerCurrent = (layer: CadGradingExportLayer): boolean =>
  layer.status === 'CURRENT' && layer.result != null;

const withheldWarning = (grading: GradingExportIdentity, status: string, format: string): ExportWarning => ({
  code: 'SKIPPED_ENTITY',
  message: `grading ${grading.id} is ${status}; ${format} geometry withheld (CURRENT-only)`,
});

const curveWarning = (grading: GradingExportIdentity): ExportWarning => ({
  code: 'SKIPPED_ENTITY',
  message: `grading ${grading.id}: curve-approximated result exported from chords (EXACT only on straight sources)`,
});

const daylightPairs = (result: CadGradingResult): Array<{ x: number; y: number; z: number }> => {
  const pairs: Array<{ x: number; y: number; z: number }> = [];
  for (let index = 0; index + 2 < result.daylightPoints.length; index += 3) {
    pairs.push({
      x: result.daylightPoints[index]!,
      y: result.daylightPoints[index + 1]!,
      z: result.daylightPoints[index + 2]!,
    });
  }
  return pairs;
};

const triangleVertices = (
  result: CadGradingResult,
): Array<[{ x: number; y: number; z: number }, { x: number; y: number; z: number }, { x: number; y: number; z: number }]> => {
  const { points, triangles } = result.gradingMesh;
  const at = (index: number) => ({
    x: points[index * 3] ?? 0,
    y: points[index * 3 + 1] ?? 0,
    z: points[index * 3 + 2] ?? 0,
  });
  const out: Array<[{ x: number; y: number; z: number }, { x: number; y: number; z: number }, { x: number; y: number; z: number }]> = [];
  for (let index = 0; index + 2 < triangles.length; index += 3) {
    out.push([at(triangles[index]!), at(triangles[index + 1]!), at(triangles[index + 2]!)]);
  }
  return out;
};

/** Sheet-space (SVG/PDF) items: triangle fills + daylight tie line, paper mm. */
export const buildGradingSheetItems = (
  input: CadGradingExportInput | undefined,
  toPaper: (_x: number, _y: number) => { xMm: number; yMm: number },
  clipId?: string,
): { items: ExportItem[]; warnings: ExportWarning[] } => {
  const items: ExportItem[] = [];
  const warnings: ExportWarning[] = [];
  if (!input) return { items, warnings };
  const project = (x: number, y: number): { x: number; y: number } => {
    const q = toPaper(x, y);
    return { x: q.xMm, y: q.yMm };
  };
  (input.layers ?? []).forEach((layer) => {
    if (!isGradingLayerCurrent(layer) || layer.result == null) {
      if (layer.status !== 'CURRENT') warnings.push(withheldWarning(layer.grading, layer.status, 'SVG/PDF'));
      return;
    }
    const triangleLayer = layerIdOf(layer.grading);
    triangleVertices(layer.result).forEach(([a, b, c]) => {
      items.push({
        kind: 'polyline',
        layer: triangleLayer,
        ...(clipId ? { clipId } : {}),
        points: [project(a.x, a.y), project(b.x, b.y), project(c.x, c.y)],
        close: true,
        fill: GRADING_FILL_COLOR,
        stroke: GRADING_FILL_COLOR,
        opacity: GRADING_FILL_OPACITY,
      });
    });
    const daylight = daylightPairs(layer.result);
    if (daylight.length >= 2) {
      items.push({
        kind: 'polyline',
        layer: DEFAULT_GRADING_DAYLIGHT_LAYER,
        ...(clipId ? { clipId } : {}),
        points: daylight.map((point) => project(point.x, point.y)),
        close: false,
        stroke: GRADING_DAYLIGHT_COLOR,
      });
    }
    if (layer.result.accuracy === 'CURVE_APPROXIMATED') warnings.push(curveWarning(layer.grading));
  });
  return { items, warnings };
};

/** DXF 3D POLYLINE (daylight). */
export interface GradingDxfPolyline3D {
  layer: string;
  vertices: Array<{ x: number; y: number; z: number }>;
  closed: boolean;
  colorHex?: string;
}

/** DXF 3DFACE (grading mesh triangles). */
export interface GradingDxfFace3D {
  layer: string;
  a: { x: number; y: number; z: number };
  b: { x: number; y: number; z: number };
  c: { x: number; y: number; z: number };
  colorHex?: string;
}

/** DXF model-space geometry: daylight 3D POLYLINEs + mesh 3DFACEs. */
export const buildGradingModelItems = (
  input: CadGradingExportInput | undefined,
): { polylines3d: GradingDxfPolyline3D[]; faces3d: GradingDxfFace3D[]; warnings: ExportWarning[] } => {
  const polylines3d: GradingDxfPolyline3D[] = [];
  const faces3d: GradingDxfFace3D[] = [];
  const warnings: ExportWarning[] = [];
  if (!input) return { polylines3d, faces3d, warnings };
  (input.layers ?? []).forEach((layer) => {
    if (!isGradingLayerCurrent(layer) || layer.result == null) {
      if (layer.status !== 'CURRENT') warnings.push(withheldWarning(layer.grading, layer.status, 'DXF'));
      return;
    }
    const daylight = daylightPairs(layer.result);
    if (daylight.length >= 2) {
      polylines3d.push({
        layer: DEFAULT_GRADING_DAYLIGHT_LAYER,
        vertices: daylight.map((point) => ({ x: point.x, y: point.y, z: point.z })),
        closed: false,
        colorHex: GRADING_DAYLIGHT_COLOR,
      });
    }
    const triangleLayer = layerIdOf(layer.grading);
    triangleVertices(layer.result).forEach(([a, b, c]) => {
      faces3d.push({ layer: triangleLayer, a, b, c, colorHex: GRADING_FILL_COLOR });
    });
    if (layer.result.accuracy === 'CURVE_APPROXIMATED') warnings.push(curveWarning(layer.grading));
  });
  return { polylines3d, faces3d, warnings };
};

/** LandXML warning: live grading geometry is never written to LandXML. */
export const gradingLandXmlWarnings = (
  input: CadGradingExportInput | undefined,
): ExportWarning[] =>
  (input?.layers ?? []).map((layer) => ({
    code: 'SKIPPED_ENTITY',
    message: `grading ${layer.grading.id}: LandXML has no grading schema (${GRADING_LANDXML_DISPOSITION}); bake to a surface to export`,
  }));
