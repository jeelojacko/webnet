/**
 * Phase 18U export slice F — analysis-map / legend → export geometry.
 *
 * The canonical screen builders (`cadAnalysisView.ts` / `cadAnalysisLegendView.ts`)
 * have NOT landed on this branch, so this module is the bounded local adapter:
 * it consumes a `CadAnalysisMap` plus already-derived per-band result regions
 * (aggregated rings in model XY) and turns them into sheet (SVG/PDF) and
 * model-space (DXF) primitives. No band math lives here — regions come from
 * `cadAnalysisExportRegions.ts`, which delegates to the 18U engine helpers.
 *
 * Disposition truth (one constant per format, surfaced in export warnings):
 * - SVG/PDF carry real per-band fills + optional boundaries + the legend = FULL.
 * - DXF R12/R2000 model space has no analysis fill/hatch subsystem on this
 *   branch, so band fills + legend swatches ride as closed-polyline boundaries
 *   = APPROXIMATED_WITH_WARNING (never a silent FULL claim, never a drop).
 * - LandXML has no analysis representation (presentation/derived) = NOT_APPLICABLE,
 *   applied in `landxmlCadProject.ts`; underlying TIN/volume output is unchanged.
 *
 * CURRENT-only gate: a layer whose derived status is anything other than
 * CURRENT (stale/rebuilding/unbuilt) emits no bands — a stale result is never
 * exported as current. The withheld status is always warned.
 */
import type { CadAnalysisBand, CadAnalysisLegend, CadAnalysisMap, CadAnalysisStatus } from './cadAnalysisTypes';
import type { ExportWarning } from './exportResult';
import type { ExportItem } from './cadExportScene';

export const ANALYSIS_SHEET_DISPOSITION = 'FULL' as const;
export const ANALYSIS_DXF_FILL_DISPOSITION = 'APPROXIMATED_WITH_WARNING' as const;
export const ANALYSIS_LANDXML_DISPOSITION = 'NOT_APPLICABLE' as const;

/** Aggregated display geometry (model XY) for one band. */
export interface AnalysisExportRing {
  points: Array<{ x: number; y: number }>;
}

export interface AnalysisExportBandRegions {
  bandId: string;
  rings: AnalysisExportRing[];
}

/** One CURRENT analysis map with its derived regions (session-only). */
export interface CadAnalysisExportLayer {
  map: CadAnalysisMap;
  /** Derived status; only CURRENT emits geometry. */
  status: CadAnalysisStatus;
  /** Per-band aggregated rings in model XY. Ignored unless status === CURRENT. */
  regions: AnalysisExportBandRegions[];
}

/** Caller-composed row values; legend show* flags decide which appear. */
export interface CadAnalysisLegendRowValues {
  bandId: string;
  rangeText?: string;
  areaText?: string;
  percentText?: string;
  volumeText?: string;
}

export interface CadAnalysisExportLegend {
  legend: CadAnalysisLegend;
  /** Referenced map when it resolves (absent = broken reference). */
  map?: CadAnalysisMap | null;
  status: CadAnalysisStatus;
  rows: CadAnalysisLegendRowValues[];
}

export interface CadAnalysisExportInput {
  layers?: CadAnalysisExportLayer[];
  legends?: CadAnalysisExportLegend[];
}

export const DEFAULT_ANALYSIS_LAYER = 'analysis';
export const DEFAULT_ANALYSIS_LEGEND_LAYER = 'analysis-legend';

const LEGEND_TEXT_HEIGHT_MM = 2.5;
const LEGEND_PADDING_MM = 1.5;
const DEFAULT_SWATCH_WIDTH_MM = 8;
const DEFAULT_ROW_HEIGHT_MM = 5;
const BOUNDARY_WIDTH_MM = 0.2;

const layerIdOf = (map: CadAnalysisMap): string => map.layerId ?? DEFAULT_ANALYSIS_LAYER;

/** CURRENT + at least one non-empty ring; the export gate for every format. */
export const isAnalysisLayerCurrent = (layer: CadAnalysisExportLayer): boolean =>
  layer.status === 'CURRENT' && layer.regions.some((band) => band.rings.length > 0);

const bandMapOf = (map: CadAnalysisMap): Map<string, CadAnalysisBand> =>
  new Map(map.bands.map((band) => [band.id, band]));

const withheldWarning = (map: CadAnalysisMap, status: CadAnalysisStatus, format: string): ExportWarning => ({
  code: 'SKIPPED_ENTITY',
  message: `analysis map ${map.id} is ${status}; ${format} geometry withheld (CURRENT-only)`,
});

/**
 * Sheet-space items (paper mm): per-band fills + optional boundaries + legend.
 * `toPaper` is the shared viewport projection, so fills register exactly with
 * the underlying surface geometry; `clipId` keeps them inside the viewport.
 */
export const buildAnalysisSheetItems = (
  input: CadAnalysisExportInput | undefined,
  toPaper: (_x: number, _y: number) => { xMm: number; yMm: number },
  clipId?: string,
): { items: ExportItem[]; warnings: ExportWarning[] } => {
  const items: ExportItem[] = [];
  const warnings: ExportWarning[] = [];
  if (!input) return { items, warnings };
  const project = (p: { x: number; y: number }): { x: number; y: number } => {
    const q = toPaper(p.x, p.y);
    return { x: q.xMm, y: q.yMm };
  };
  (input.layers ?? []).forEach((layer) => {
    if (!isAnalysisLayerCurrent(layer)) {
      if (layer.status !== 'CURRENT') warnings.push(withheldWarning(layer.map, layer.status, 'SVG/PDF'));
      return;
    }
    const layerId = layerIdOf(layer.map);
    const bands = bandMapOf(layer.map);
    const opacity = layer.map.opacity;
    const showBoundaries = layer.map.showBoundaries === true;
    layer.regions.forEach((bandRegions) => {
      const band = bands.get(bandRegions.bandId);
      if (!band) return;
      bandRegions.rings.forEach((ring) => {
        if (ring.points.length < 3) return;
        const points = ring.points.map(project);
        items.push({
          kind: 'polyline',
          layer: layerId,
          ...(clipId ? { clipId } : {}),
          points,
          close: true,
          fill: band.color,
          stroke: band.color,
          ...(opacity != null ? { opacity } : {}),
        });
        if (showBoundaries) {
          items.push({
            kind: 'polyline',
            layer: layerId,
            ...(clipId ? { clipId } : {}),
            points,
            close: true,
            stroke: band.color,
            widthMm: BOUNDARY_WIDTH_MM,
          });
        }
      });
    });
  });
  (input.legends ?? []).forEach((entry) => {
    items.push(...buildLegendSheetItems(entry, project, clipId));
  });
  return { items, warnings };
};

const composeLegendRowText = (
  legend: CadAnalysisLegend,
  band: CadAnalysisBand | undefined,
  row: CadAnalysisLegendRowValues,
): string => {
  const parts: string[] = [];
  if (legend.showRange !== false) {
    if (row.rangeText != null) parts.push(row.rangeText);
    else if (band?.label != null) parts.push(band.label);
    else parts.push(row.bandId);
  } else if (band?.label != null) {
    parts.push(band.label);
  }
  if (legend.showArea === true && row.areaText != null) parts.push(row.areaText);
  if (legend.showPercent === true && row.percentText != null) parts.push(row.percentText);
  if (legend.showVolume === true && row.volumeText != null) parts.push(row.volumeText);
  return parts.join('  ') || row.bandId;
};

interface LegendLayout {
  layer: string;
  at: { x: number; y: number };
  title: string;
  swatchW: number;
  rowH: number;
  frameW: number;
  frameH: number;
  titleRows: number;
  lines: Array<{ band?: CadAnalysisBand; text: string }>;
}

const layoutLegend = (
  entry: CadAnalysisExportLegend,
  project: (_p: { x: number; y: number }) => { x: number; y: number },
): LegendLayout => {
  const bands = entry.map ? bandMapOf(entry.map) : new Map<string, CadAnalysisBand>();
  const lines = entry.rows.map((row) => ({
    band: bands.get(row.bandId),
    text: composeLegendRowText(entry.legend, bands.get(row.bandId), row),
  }));
  const title = entry.legend.title ?? entry.map?.name ?? '';
  const swatchW = entry.legend.swatchWidth ?? DEFAULT_SWATCH_WIDTH_MM;
  const rowH = entry.legend.rowHeight ?? DEFAULT_ROW_HEIGHT_MM;
  const titleRows = title.length > 0 ? 1 : 0;
  const longest = Math.max(title.length, ...lines.map((line) => line.text.length), 1);
  const frameW = swatchW + LEGEND_PADDING_MM * 3 + longest * LEGEND_TEXT_HEIGHT_MM * 0.5;
  const frameH = (titleRows + lines.length) * rowH + LEGEND_PADDING_MM * 2;
  const at = project({ x: entry.legend.insertionX, y: entry.legend.insertionY });
  return { layer: entry.map ? layerIdOf(entry.map) : DEFAULT_ANALYSIS_LEGEND_LAYER, at, title, swatchW, rowH, frameW, frameH, titleRows, lines };
};

const buildLegendSheetItems = (
  entry: CadAnalysisExportLegend,
  project: (_p: { x: number; y: number }) => { x: number; y: number },
  clipId?: string,
): ExportItem[] => {
  const layout = layoutLegend(entry, project);
  const clip = clipId ? { clipId } : {};
  const items: ExportItem[] = [
    { kind: 'rect', layer: layout.layer, ...clip, x: layout.at.x, y: layout.at.y, width: layout.frameW, height: layout.frameH },
  ];
  const textX = layout.at.x + LEGEND_PADDING_MM + layout.swatchW + LEGEND_PADDING_MM;
  layout.lines.forEach((line, index) => {
    const top = layout.at.y + LEGEND_PADDING_MM + (layout.titleRows + index) * layout.rowH;
    items.push({
      kind: 'rect',
      layer: layout.layer,
      ...clip,
      x: layout.at.x + LEGEND_PADDING_MM,
      y: top + layout.rowH * 0.15,
      width: layout.swatchW,
      height: layout.rowH * 0.7,
      fill: line.band?.color ?? '#ffffff',
      stroke: line.band?.color ?? '#ffffff',
    });
    items.push({
      kind: 'text',
      layer: layout.layer,
      ...clip,
      x: textX,
      y: top + layout.rowH * 0.7,
      text: line.text,
      heightMm: LEGEND_TEXT_HEIGHT_MM,
      anchor: 'start',
    });
  });
  if (layout.titleRows > 0) {
    items.push({
      kind: 'text',
      layer: layout.layer,
      ...clip,
      x: layout.at.x + LEGEND_PADDING_MM,
      y: layout.at.y + LEGEND_PADDING_MM + layout.rowH * 0.7,
      text: layout.title,
      heightMm: LEGEND_TEXT_HEIGHT_MM,
      anchor: 'start',
    });
  }
  return items;
};

/** Model-space primitives for the DXF adapter (no fill subsystem). */
export interface AnalysisDxfPolyline {
  layer: string;
  vertices: Array<{ x: number; y: number }>;
  closed: boolean;
  colorHex?: string;
}

export interface AnalysisDxfText {
  layer: string;
  at: { x: number; y: number };
  height: number;
  text: string;
  colorHex?: string;
}

/**
 * DXF model-space geometry: band boundaries as closed polylines + the legend
 * as outlined frame/swatches and rows. Fills are NOT representable on this
 * branch, so every current layer emits one APPROXIMATED_WITH_WARNING warning;
 * a non-current layer emits nothing but its withheld-status warning.
 */
export const buildAnalysisModelItems = (
  input: CadAnalysisExportInput | undefined,
): { polylines: AnalysisDxfPolyline[]; texts: AnalysisDxfText[]; warnings: ExportWarning[] } => {
  const polylines: AnalysisDxfPolyline[] = [];
  const texts: AnalysisDxfText[] = [];
  const warnings: ExportWarning[] = [];
  if (!input) return { polylines, texts, warnings };
  (input.layers ?? []).forEach((layer) => {
    if (!isAnalysisLayerCurrent(layer)) {
      if (layer.status !== 'CURRENT') warnings.push(withheldWarning(layer.map, layer.status, 'DXF'));
      return;
    }
    const layerId = layerIdOf(layer.map);
    const bands = bandMapOf(layer.map);
    layer.regions.forEach((bandRegions) => {
      const band = bands.get(bandRegions.bandId);
      if (!band) return;
      bandRegions.rings.forEach((ring) => {
        if (ring.points.length < 3) return;
        polylines.push({ layer: layerId, vertices: ring.points.map((p) => ({ x: p.x, y: p.y })), closed: true, colorHex: band.color });
      });
    });
    warnings.push({
      code: 'SKIPPED_ENTITY',
      message: `analysis map ${layer.map.id}: band fills approximated as closed polyline boundaries in DXF (${ANALYSIS_DXF_FILL_DISPOSITION})`,
    });
  });
  (input.legends ?? []).forEach((entry) => {
    const layout = layoutLegend(entry, (p) => ({ x: p.x, y: p.y }));
    const frame: Array<{ x: number; y: number }> = [
      { x: layout.at.x, y: layout.at.y },
      { x: layout.at.x + layout.frameW, y: layout.at.y },
      { x: layout.at.x + layout.frameW, y: layout.at.y + layout.frameH },
      { x: layout.at.x, y: layout.at.y + layout.frameH },
    ];
    polylines.push({ layer: layout.layer, vertices: frame, closed: true });
    const textX = layout.at.x + LEGEND_PADDING_MM + layout.swatchW + LEGEND_PADDING_MM;
    layout.lines.forEach((line, index) => {
      const top = layout.at.y + LEGEND_PADDING_MM + (layout.titleRows + index) * layout.rowH;
      const swatch: Array<{ x: number; y: number }> = [
        { x: layout.at.x + LEGEND_PADDING_MM, y: top + layout.rowH * 0.15 },
        { x: layout.at.x + LEGEND_PADDING_MM + layout.swatchW, y: top + layout.rowH * 0.15 },
        { x: layout.at.x + LEGEND_PADDING_MM + layout.swatchW, y: top + layout.rowH * 0.85 },
        { x: layout.at.x + LEGEND_PADDING_MM, y: top + layout.rowH * 0.85 },
      ];
      polylines.push({ layer: layout.layer, vertices: swatch, closed: true, ...(line.band ? { colorHex: line.band.color } : {}) });
      texts.push({ layer: layout.layer, at: { x: textX, y: top + layout.rowH * 0.7 }, height: LEGEND_TEXT_HEIGHT_MM, text: line.text });
    });
    if (layout.titleRows > 0) {
      texts.push({
        layer: layout.layer,
        at: { x: layout.at.x + LEGEND_PADDING_MM, y: layout.at.y + LEGEND_PADDING_MM + layout.rowH * 0.7 },
        height: LEGEND_TEXT_HEIGHT_MM,
        text: layout.title,
      });
    }
  });
  return { polylines, texts, warnings };
};
