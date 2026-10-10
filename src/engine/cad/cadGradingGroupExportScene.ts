/**
 * Phase 20C Wave-4B export slice — grading GROUP (multi-course + miter
 * corners) → export geometry. Mirrors the frozen 20B single-course seam
 * (`cadGradingExportScene.ts`) so group output cannot drift from it.
 *
 * Disposition truth (one constant per format, surfaced in export warnings):
 * - SVG/PDF carry the CURRENT group triangle fill + merged daylight tie line
 *   = FULL. The optional corner seam (per-corner derived daylight polylines)
 *   is a PLOT-INTENDED display annotation: it exports ONLY when the layer's
 *   `plotCornerSeams` display flag is set, never by default.
 * - DXF R12/R2000 carry the daylight as a true 3D POLYLINE and the merged
 *   grading mesh as 3DFACE = FULL. No proprietary XDATA is ever written.
 * - LandXML has no grading schema (the workflow is Bake → Surface export) =
 *   NOT_APPLICABLE; a live definition AND its derived result are both
 *   withheld with an explicit warning pointing at Bake → Surface.
 *
 * CURRENT-only gate: a group whose status is anything other than CURRENT
 * emits no geometry; the withheld status is always warned. Curve-derived
 * results (curved member / CURVE_CORNER_APPROXIMATED diagnostic) ride an
 * explicit APPROXIMATED warning but still export.
 */
import type { CadGradingGroupResult, GroupStatus } from './grading/gradingGroupTypes';
import type { ExportWarning } from './exportResult';
import type { ExportItem } from './cadExportItemTypes';

/** Minimum definition identity an exporter needs (structural). */
export interface GradingGroupExportIdentity {
  id: string;
  name: string;
  layerId?: string;
}

export const GROUP_SHEET_DISPOSITION = 'FULL' as const;
export const GROUP_DXF_DAYLIGHT_DISPOSITION = 'FULL' as const;
export const GROUP_DXF_MESH_DISPOSITION = 'FULL' as const;
export const GROUP_CORNER_SEAM_DISPOSITION = 'PLOT_INTENDED_ONLY' as const;
export const GROUP_LANDXML_DISPOSITION = 'NOT_APPLICABLE' as const;

export const DEFAULT_GRADING_GROUP_LAYER = 'grading-group';
export const DEFAULT_GRADING_GROUP_DAYLIGHT_LAYER = 'grading-group-daylight';
export const DEFAULT_GRADING_GROUP_CORNER_LAYER = 'grading-group-corner-seam';
export const GROUP_DAYLIGHT_COLOR = '#00b7ff';
export const GROUP_FILL_COLOR = '#3f6212';
export const GROUP_FILL_OPACITY = 0.35;

/** One CURRENT group with its derived session result. */
export interface CadGradingGroupExportLayer {
  group: GradingGroupExportIdentity;
  status: GroupStatus;
  /** Ignored unless status === 'CURRENT'. */
  result: CadGradingGroupResult | null;
  /** Display flag: plot the corner seams. Absent/false = not plot-intended. */
  plotCornerSeams?: boolean;
}

export interface CadGradingGroupExportInput {
  layers?: CadGradingGroupExportLayer[];
}

const layerIdOf = (group: GradingGroupExportIdentity): string =>
  group.layerId ?? DEFAULT_GRADING_GROUP_LAYER;

export const isGroupLayerCurrent = (layer: CadGradingGroupExportLayer): boolean =>
  layer.status === 'CURRENT' && layer.result != null;

const withheldWarning = (group: GradingGroupExportIdentity, status: GroupStatus, format: string): ExportWarning => ({
  code: 'SKIPPED_ENTITY',
  message: `grading group ${group.id} is ${status}; ${format} geometry withheld (CURRENT-only)`,
});

const curveWarning = (group: GradingGroupExportIdentity, result: CadGradingGroupResult): ExportWarning => ({
  code: 'SKIPPED_ENTITY',
  message:
    result.accuracy === 'CURVE_APPROXIMATED'
      ? `grading group ${group.id}: curve-approximated result exported from chords (EXACT only on straight members)`
      : `grading group ${group.id}: corner CURVE_CORNER_APPROXIMATED (chord-derived planes)`,
});

const isCurveDerived = (result: CadGradingGroupResult): boolean =>
  result.accuracy === 'CURVE_APPROXIMATED' ||
  result.diagnostics.some((entry) => entry.code === 'CURVE_CORNER_APPROXIMATED');

interface Xyz { x: number; y: number; z: number }

const daylightPairs = (result: CadGradingGroupResult): Xyz[] => {
  const pairs: Xyz[] = [];
  for (let index = 0; index + 2 < result.daylightPoints.length; index += 3) {
    pairs.push({
      x: result.daylightPoints[index]!,
      y: result.daylightPoints[index + 1]!,
      z: result.daylightPoints[index + 2]!,
    });
  }
  return pairs;
};

/** Per-corner derived daylight boundary (flat XYZ triplets → XYZ pairs). */
const cornerSeams = (result: CadGradingGroupResult): Xyz[][] => {
  const out: Xyz[][] = [];
  for (const corner of result.corners) {
    const flat = corner.daylightPoints ?? [];
    const points: Xyz[] = [];
    for (let index = 0; index + 2 < flat.length; index += 3) {
      points.push({ x: flat[index]!, y: flat[index + 1]!, z: flat[index + 2]! });
    }
    if (points.length >= 2) out.push(points);
  }
  return out;
};

const triangleVertices = (result: CadGradingGroupResult): Array<[Xyz, Xyz, Xyz]> => {
  const { points, triangles } = result.gradingMesh;
  const at = (index: number): Xyz => ({
    x: points[index * 3] ?? 0,
    y: points[index * 3 + 1] ?? 0,
    z: points[index * 3 + 2] ?? 0,
  });
  const out: Array<[Xyz, Xyz, Xyz]> = [];
  for (let index = 0; index + 2 < triangles.length; index += 3) {
    out.push([at(triangles[index]!), at(triangles[index + 1]!), at(triangles[index + 2]!)]);
  }
  return out;
};

/** Sheet-space (SVG/PDF) items: group triangle fills + daylight + seam, paper mm. */
export const buildGroupSheetItems = (
  input: CadGradingGroupExportInput | undefined,
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
  const pushPolyline = (
    layer: string,
    points: Xyz[],
    close: boolean,
    style: { fill?: string; stroke?: string; opacity?: number },
  ): void => {
    if (points.length < 2) return;
    items.push({
      kind: 'polyline',
      layer,
      ...(clipId ? { clipId } : {}),
      points: points.map((point) => project(point.x, point.y)),
      close,
      ...style,
    });
  };
  (input.layers ?? []).forEach((layer) => {
    if (!isGroupLayerCurrent(layer) || layer.result == null) {
      if (layer.status !== 'CURRENT') warnings.push(withheldWarning(layer.group, layer.status, 'SVG/PDF'));
      return;
    }
    const triangleLayer = layerIdOf(layer.group);
    triangleVertices(layer.result).forEach(([a, b, c]) => {
      pushPolyline(triangleLayer, [a, b, c], true, {
        fill: GROUP_FILL_COLOR,
        stroke: GROUP_FILL_COLOR,
        opacity: GROUP_FILL_OPACITY,
      });
    });
    pushPolyline(
      DEFAULT_GRADING_GROUP_DAYLIGHT_LAYER,
      daylightPairs(layer.result),
      false,
      { stroke: GROUP_DAYLIGHT_COLOR },
    );
    // Corner seams are a display annotation: plot-intended only.
    if (layer.plotCornerSeams === true) {
      cornerSeams(layer.result).forEach((points) => {
        pushPolyline(DEFAULT_GRADING_GROUP_CORNER_LAYER, points, false, {
          stroke: GROUP_DAYLIGHT_COLOR,
        });
      });
    }
    if (isCurveDerived(layer.result)) warnings.push(curveWarning(layer.group, layer.result));
  });
  return { items, warnings };
};

/** DXF 3D POLYLINE (daylight / corner seam). */
export interface GroupDxfPolyline3D {
  layer: string;
  vertices: Xyz[];
  closed: boolean;
  colorHex?: string;
}

/** DXF 3DFACE (merged group grading mesh triangles). */
export interface GroupDxfFace3D {
  layer: string;
  a: Xyz;
  b: Xyz;
  c: Xyz;
  colorHex?: string;
}

/** DXF model-space geometry: daylight 3D POLYLINEs + merged mesh 3DFACEs. */
export const buildGroupModelItems = (
  input: CadGradingGroupExportInput | undefined,
): { polylines3d: GroupDxfPolyline3D[]; faces3d: GroupDxfFace3D[]; warnings: ExportWarning[] } => {
  const polylines3d: GroupDxfPolyline3D[] = [];
  const faces3d: GroupDxfFace3D[] = [];
  const warnings: ExportWarning[] = [];
  if (!input) return { polylines3d, faces3d, warnings };
  (input.layers ?? []).forEach((layer) => {
    if (!isGroupLayerCurrent(layer) || layer.result == null) {
      if (layer.status !== 'CURRENT') warnings.push(withheldWarning(layer.group, layer.status, 'DXF'));
      return;
    }
    const daylight = daylightPairs(layer.result);
    if (daylight.length >= 2) {
      polylines3d.push({
        layer: DEFAULT_GRADING_GROUP_DAYLIGHT_LAYER,
        vertices: daylight.map((point) => ({ ...point })),
        closed: false,
        colorHex: GROUP_DAYLIGHT_COLOR,
      });
    }
    if (layer.plotCornerSeams === true) {
      cornerSeams(layer.result).forEach((points) => {
        polylines3d.push({
          layer: DEFAULT_GRADING_GROUP_CORNER_LAYER,
          vertices: points.map((point) => ({ ...point })),
          closed: false,
          colorHex: GROUP_DAYLIGHT_COLOR,
        });
      });
    }
    const triangleLayer = layerIdOf(layer.group);
    triangleVertices(layer.result).forEach(([a, b, c]) => {
      faces3d.push({ layer: triangleLayer, a, b, c, colorHex: GROUP_FILL_COLOR });
    });
    if (isCurveDerived(layer.result)) warnings.push(curveWarning(layer.group, layer.result));
  });
  return { polylines3d, faces3d, warnings };
};

/**
 * LandXML warning: a group DEFINITION is never written (no grading schema)
 * and its DERIVED result is omitted too; the supported path is Bake → Surface
 * export. Emitted for every layer, regardless of status.
 */
export const groupLandXmlWarnings = (
  input: CadGradingGroupExportInput | undefined,
): ExportWarning[] =>
  (input?.layers ?? []).map((layer) => ({
    code: 'SKIPPED_ENTITY',
    message: `grading group ${layer.group.id}: LandXML has no grading schema (${GROUP_LANDXML_DISPOSITION}); bake to a surface to export`,
  }));
