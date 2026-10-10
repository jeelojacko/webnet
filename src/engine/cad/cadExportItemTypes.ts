/** STRUCT-195.8 type leaf: ExportBase + ExportItem. Import-free (zero imports); type/interface exports only, no runtime values. */

export interface ExportBase {
  layer: string;
  clipId?: string;
  /** Resolved stroke color (hex). Absent only on hand-built scenes. */
  stroke?: string;
  /** Resolved fill color (hex). */
  fill?: string;
  /** SVG dash pattern from the source line type. */
  dash?: string;
  /** Source entity for disposition tracking; labels/paper items omit it. */
  sourceEntityId?: string;
  /** Resolved line weight in mm (from the source style or fallback). */
  widthMm?: number;
  /** Resolved opacity 0..1 (from entity/layer transparency); absent = opaque. */
  opacity?: number;
}

export type ExportItem =
  | (ExportBase & { kind: 'line'; x1: number; y1: number; x2: number; y2: number })
  | (ExportBase & { kind: 'polyline'; points: Array<{ x: number; y: number }>; close: boolean })
  | (ExportBase & { kind: 'rect'; x: number; y: number; width: number; height: number })
  | (ExportBase & { kind: 'circle'; cx: number; cy: number; r: number })
  | (ExportBase & { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; rotationDeg: number })
  | (ExportBase & { kind: 'arc'; cx: number; cy: number; r: number; startDeg: number; endDeg: number })
  | (ExportBase & {
      kind: 'text';
      x: number;
      y: number;
      text: string;
      heightMm: number;
      anchor?: 'start' | 'middle' | 'end';
      rotationDeg?: number;
    });
