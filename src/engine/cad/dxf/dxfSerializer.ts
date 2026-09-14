import type { DxfExportModel } from './dxfExportModel';

// Why R12 ASCII ($ACADVER AC1009): it is the smallest interoperable DXF
// subset — fixed group codes, no handles/reactors/dictionaries — so every
// importer from field controllers to desktop CAD reads it. One post-R12
// concession: closed parcel/polygon boundaries use LWPOLYLINE (one entity
// instead of POLYLINE/VERTEX/SEQEND triples); every targeted reader accepts
// it. Serialization precision is 3 decimals (mm); the model keeps full
// precision and the test asserts round-trip within 1e-3.
const fmt = (value: number): string => {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 1000) / 1000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
};

const pair = (code: number, value: string): string => `${code}\n${value}`;

export const serializeDxfModel = (model: DxfExportModel): string => {
  const out: string[] = [];
  out.push(pair(0, 'SECTION'), pair(2, 'HEADER'), pair(9, '$ACADVER'), pair(1, 'AC1009'), pair(0, 'ENDSEC'));
  out.push(pair(0, 'SECTION'), pair(2, 'TABLES'), pair(0, 'TABLE'), pair(2, 'LAYER'), pair(70, '1'));
  model.layers.forEach((layer) => {
    out.push(pair(0, 'LAYER'), pair(2, layer), pair(70, '0'), pair(62, '7'), pair(6, 'CONTINUOUS'));
  });
  out.push(pair(0, 'ENDTAB'), pair(0, 'ENDSEC'));
  out.push(pair(0, 'SECTION'), pair(2, 'ENTITIES'));
  model.points.forEach((point) => {
    out.push(pair(0, 'POINT'), pair(8, point.layer), pair(10, fmt(point.at.x)), pair(20, fmt(point.at.y)), pair(30, '0'));
  });
  model.lines.forEach((line) => {
    out.push(
      pair(0, 'LINE'), pair(8, line.layer),
      pair(10, fmt(line.from.x)), pair(20, fmt(line.from.y)), pair(30, '0'),
      pair(11, fmt(line.to.x)), pair(21, fmt(line.to.y)), pair(31, '0'),
    );
  });
  model.polylines.forEach((polyline) => {
    out.push(pair(0, 'LWPOLYLINE'), pair(8, polyline.layer), pair(90, String(polyline.vertices.length)), pair(70, polyline.closed ? '1' : '0'));
    polyline.vertices.forEach((vertex) => {
      out.push(pair(10, fmt(vertex.x)), pair(20, fmt(vertex.y)));
    });
  });
  model.arcs.forEach((arc) => {
    out.push(
      pair(0, 'ARC'), pair(8, arc.layer),
      pair(10, fmt(arc.center.x)), pair(20, fmt(arc.center.y)), pair(30, '0'),
      pair(40, fmt(arc.radius)), pair(50, fmt(arc.startDeg)), pair(51, fmt(arc.endDeg)),
    );
  });
  model.texts.forEach((entry) => {
    out.push(
      pair(0, 'TEXT'), pair(8, entry.layer),
      pair(10, fmt(entry.at.x)), pair(20, fmt(entry.at.y)), pair(30, '0'),
      pair(40, fmt(entry.height)), pair(1, entry.text),
    );
  });
  out.push(pair(0, 'ENDSEC'), pair(0, 'EOF'));
  return `${out.join('\n')}\n`;
};
