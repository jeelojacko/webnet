import type { CadProject } from '../cadTypes';
import type { ModelLabelPlacement } from '../cadExportScene';

// Adapter boundary: the drafting/document core never becomes DXF-shaped.
// This model is the only DXF-aware shape, built fresh per export and thrown
// away. MODEL-space survey coordinates only: paper-space objects (viewports,
// title blocks, north arrows, scale bars, sheet notes) are deliberately
// EXCLUDED — flattening them into fake model coordinates would corrupt the
// survey grid, so paper deliverables stay in SVG/PDF.
export interface DxfPoint {
  x: number;
  y: number;
}

export interface DxfExportModel {
  layers: string[];
  points: Array<{ layer: string; at: DxfPoint }>;
  lines: Array<{ layer: string; from: DxfPoint; to: DxfPoint }>;
  polylines: Array<{ layer: string; vertices: DxfPoint[]; closed: boolean }>;
  arcs: Array<{ layer: string; center: DxfPoint; radius: number; startDeg: number; endDeg: number }>;
  texts: Array<{ layer: string; at: DxfPoint; height: number; text: string }>;
}

export interface BuildDxfModelArgs {
  project: CadProject;
  modelLabels?: ModelLabelPlacement[];
}

const layerOf = (layerId: string): string => layerId;

export const buildDxfExportModel = (args: BuildDxfModelArgs): DxfExportModel => {
  const model: DxfExportModel = { layers: [], points: [], lines: [], polylines: [], arcs: [], texts: [] };
  const seen = new Set<string>();
  const useLayer = (layerId: string): string => {
    const name = layerOf(layerId);
    if (!seen.has(name)) {
      seen.add(name);
      model.layers.push(name);
    }
    return name;
  };
  const sorted = [...args.project.entities].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  sorted.forEach((entity) => {
    if (entity.visible === false) return;
    switch (entity.type) {
      case 'survey-point':
        model.points.push({ layer: useLayer(entity.layerId), at: { x: entity.x, y: entity.y } });
        model.texts.push({ layer: useLayer(entity.layerId), at: { x: entity.x, y: entity.y }, height: 1, text: String(entity.stationId) });
        break;
      case 'line':
        model.lines.push({
          layer: useLayer(entity.layerId),
          from: { x: entity.fromX, y: entity.fromY },
          to: { x: entity.toX, y: entity.toY },
        });
        break;
      case 'polyline':
        model.polylines.push({
          layer: useLayer(entity.layerId),
          vertices: entity.vertices.map((v) => ({ x: v.x, y: v.y })),
          closed: entity.closed,
        });
        break;
      case 'polygon':
        model.polylines.push({
          layer: useLayer(entity.layerId),
          vertices: entity.vertices.map((v) => ({ x: v.x, y: v.y })),
          closed: true,
        });
        break;
      case 'parcel':
        model.polylines.push({
          layer: useLayer(entity.layerId),
          vertices: entity.vertices.map((v) => ({ x: v.x, y: v.y })),
          closed: true,
        });
        break;
      case 'arc':
        model.arcs.push({
          layer: useLayer(entity.layerId),
          center: { x: entity.centerX, y: entity.centerY },
          radius: entity.radius,
          startDeg: entity.startAngleDeg,
          endDeg: entity.endAngleDeg,
        });
        break;
      case 'text':
        model.texts.push({ layer: useLayer(entity.layerId), at: { x: entity.x, y: entity.y }, height: 2.5, text: entity.text });
        break;
      default:
        break;
    }
  });
  (args.modelLabels ?? []).forEach((label) => {
    if (label.broken || label.text == null) return;
    model.texts.push({ layer: useLayer(label.layerId ?? 'labels'), at: { x: label.xModel, y: label.yModel }, height: 2.5, text: label.text });
  });
  model.layers.sort();
  return model;
};
