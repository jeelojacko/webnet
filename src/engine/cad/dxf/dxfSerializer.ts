import type { DxfExportModel } from './dxfExportModel';
import { isDxfNativeBlockName } from './dxfBlockExport';
import { dxfLinetypeName, DXF_LINETYPE_CATALOG, isKnownDxfLinetype, nearestAci } from './dxfColorMap';
import { emptyExportResult, finalizeExportResult, type ExportResult } from '../exportResult';

// Why R12 ASCII ($ACADVER AC1009): it is the smallest interoperable DXF
// subset — fixed group codes, no handles/reactors/dictionaries — so every
// importer from field controllers to desktop CAD reads it. One post-R12
// concession: closed parcel/polygon boundaries use LWPOLYLINE (one entity
// instead of POLYLINE/VERTEX/SEQEND triples); every targeted reader accepts
// it. Serialization precision is 3 decimals (mm); the model keeps full
// precision and the test asserts round-trip within 1e-3.
//
// Color policy (§§28,29): R12 has no true color — entity/layer colors ride
// as nearest-ACI group 62 (documented approximation). An entity whose ACI
// matches its layer omits 62 (BYLAYER by omission). R12 has no group 370,
// so lineweights are documented via a single warning, never faked.
// Linetypes ride as group 6 with an LTYPE table for every referenced type;
// an unknown linetype falls back to Continuous AND warns (never silently
// solidifies).
const fmt = (value: number): string => {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 1000) / 1000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
};

const pair = (code: number, value: string): string => `${code}\n${value}`;

const layerAci = (model: DxfExportModel, layer: string): number => {
  const aci = nearestAci(model.layerColors?.[layer] ?? '#ffffff');
  // OFF layers ride as negative ACI (standard DXF off-state); readers
  // show the layer but hide its entities. Frozen/locked ride in 70 bits.
  return model.layerFlags?.[layer]?.off === true ? -aci : aci;
};

/** Standard LAYER 70 bits: 1 = frozen, 4 = locked. */
const layerFlags70 = (model: DxfExportModel, layer: string): string => {
  const flags = model.layerFlags?.[layer];
  let bits = 0;
  if (flags?.frozen === true) bits |= 1;
  if (flags?.locked === true) bits |= 4;
  return String(bits);
};

/** Individually hidden entities ride as group 60 (standard invisible flag). */
const invisibleOf = (invisible: boolean | undefined): string[] =>
  invisible === true ? [pair(60, '1')] : [];

const layerLinetype = (model: DxfExportModel, layer: string): string =>
  dxfLinetypeName(model.layerLinetypes?.[layer] ?? 'continuous');

const entityAci = (
  model: DxfExportModel,
  layer: string,
  colorHex: string | undefined,
): number | undefined => {
  if (colorHex == null) return undefined;
  const aci = nearestAci(colorHex);
  return aci === layerAci(model, layer) ? undefined : aci;
};

const entityLinetype = (
  model: DxfExportModel,
  layer: string,
  linetypeId: string | undefined,
): string | undefined => {
  if (linetypeId == null) return undefined;
  const name = dxfLinetypeName(linetypeId);
  return name === layerLinetype(model, layer) ? undefined : name;
};

const emitLtypeRecord = (out: string[], id: string): void => {
  const def = DXF_LINETYPE_CATALOG[id] ?? DXF_LINETYPE_CATALOG['continuous'];
  const entry = def as { name: string; pattern: number[] };
  const total = entry.pattern.reduce((sum, el) => sum + Math.abs(el), 0);
  out.push(pair(0, 'LTYPE'), pair(2, entry.name), pair(70, '0'));
  if (entry.pattern.length === 0) {
    out.push(pair(3, 'Solid line'), pair(72, '65'), pair(73, '0'), pair(40, '0'));
  } else {
    out.push(
      pair(3, 'Short dashes'),
      pair(72, '65'),
      pair(73, String(entry.pattern.length)),
      pair(40, fmt(total)),
    );
    entry.pattern.forEach((el) => {
      out.push(pair(49, fmt(el)), pair(74, el >= 0 ? '0' : '1'));
    });
  }
};

export const serializeDxfModelWithResult = (model: DxfExportModel): ExportResult<string> => {
  const result = emptyExportResult('');
  const out: string[] = [];
  const used = [...(model.usedLinetypes ?? ['continuous'])].sort();
  used.forEach((id) => {
    if (!isKnownDxfLinetype(id)) {
      result.warnings.push({ code: 'SKIPPED_ENTITY', message: `unknown linetype ${JSON.stringify(id)} falls back to Continuous` });
    }
  });
  const hasLineweights =
    Object.keys(model.layerLineweights ?? {}).length > 0 ||
    model.lines.some((e) => e.lineweightMm != null) ||
    model.polylines.some((e) => e.lineweightMm != null) ||
    model.arcs.some((e) => e.lineweightMm != null);
  if (hasLineweights) {
    // R12 cannot carry group 370 — say so once instead of faking precision.
    result.warnings.push({ code: 'SKIPPED_ENTITY', message: 'lineweights are not representable in R12 and were omitted' });
  }
  out.push(pair(0, 'SECTION'), pair(2, 'HEADER'), pair(9, '$ACADVER'), pair(1, 'AC1009'), pair(0, 'ENDSEC'));
  out.push(pair(0, 'SECTION'), pair(2, 'TABLES'));
  out.push(pair(0, 'TABLE'), pair(2, 'LTYPE'), pair(70, String(used.length)));
  used.forEach((id) => emitLtypeRecord(out, id));
  out.push(pair(0, 'ENDTAB'));
  out.push(pair(0, 'TABLE'), pair(2, 'LAYER'), pair(70, String(model.layers.length)));
  model.layers.forEach((layer) => {
    out.push(pair(0, 'LAYER'), pair(2, layer), pair(70, layerFlags70(model, layer)), pair(62, String(layerAci(model, layer))), pair(6, layerLinetype(model, layer)));
  });
  out.push(pair(0, 'ENDTAB'), pair(0, 'ENDSEC'));
  // Phase 18N R12 policy: native BLOCK/ENDBLK + INSERT when the block name
  // is natively safe (the model builder sanitizes, so this is the norm).
  // A hand-built model with an unsafe name omits + warns fail-closed —
  // never faked, never silently exploded into wrong coordinates.
  const nativeBlocks = (model.blocks ?? []).filter((block) => {
    if (isDxfNativeBlockName(block.name)) return true;
    result.warnings.push({ code: 'SKIPPED_ENTITY', message: `block ${JSON.stringify(block.name)} has an unsafe R12 name and was omitted` });
    return false;
  });
  const nativeBlockNames = new Set(nativeBlocks.map((block) => block.name));
  if (nativeBlocks.length > 0) {
    out.push(pair(0, 'SECTION'), pair(2, 'BLOCKS'));
    nativeBlocks.forEach((block) => {
      out.push(pair(0, 'BLOCK'), pair(8, '0'), pair(2, block.name), pair(70, '0'), pair(10, '0'), pair(20, '0'), pair(30, '0'));
      block.lines.forEach((line) => {
        out.push(
          pair(0, 'LINE'), pair(8, line.layer),
          pair(10, fmt(line.from.x)), pair(20, fmt(line.from.y)), pair(30, '0'),
          pair(11, fmt(line.to.x)), pair(21, fmt(line.to.y)), pair(31, '0'),
        );
      });
      block.polylines.forEach((polyline) => {
        out.push(pair(0, 'LWPOLYLINE'), pair(8, polyline.layer), pair(90, String(polyline.vertices.length)), pair(70, polyline.closed ? '1' : '0'));
        polyline.vertices.forEach((vertex) => {
          out.push(pair(10, fmt(vertex.x)), pair(20, fmt(vertex.y)));
        });
      });
      block.arcs.forEach((arc) => {
        out.push(
          pair(0, 'ARC'), pair(8, arc.layer),
          pair(10, fmt(arc.center.x)), pair(20, fmt(arc.center.y)), pair(30, '0'),
          pair(40, fmt(arc.radius)), pair(50, fmt(arc.startDeg)), pair(51, fmt(arc.endDeg)),
        );
      });
      block.texts.forEach((entry) => {
        out.push(
          pair(0, 'TEXT'), pair(8, entry.layer),
          pair(10, fmt(entry.at.x)), pair(20, fmt(entry.at.y)), pair(30, '0'),
          pair(40, fmt(entry.height)), pair(1, entry.text),
        );
      });
      out.push(pair(0, 'ENDBLK'), pair(8, '0'));
    });
    out.push(pair(0, 'ENDSEC'));
  }
  out.push(pair(0, 'SECTION'), pair(2, 'ENTITIES'));
  const colorOf = (layer: string, colorHex: string | undefined): string[] => {
    const aci = entityAci(model, layer, colorHex);
    return aci == null ? [] : [pair(62, String(aci))];
  };
  const linetypeOf = (layer: string, linetypeId: string | undefined): string[] => {
    const name = entityLinetype(model, layer, linetypeId);
    return name == null ? [] : [pair(6, name)];
  };
  model.points.forEach((point) => {
    out.push(pair(0, 'POINT'), pair(8, point.layer), ...colorOf(point.layer, point.colorHex), ...linetypeOf(point.layer, point.linetypeId), ...invisibleOf(point.invisible), pair(10, fmt(point.at.x)), pair(20, fmt(point.at.y)), pair(30, '0'));
  });
  model.lines.forEach((line) => {
    out.push(
      pair(0, 'LINE'), pair(8, line.layer), ...colorOf(line.layer, line.colorHex), ...linetypeOf(line.layer, line.linetypeId), ...invisibleOf(line.invisible),
      pair(10, fmt(line.from.x)), pair(20, fmt(line.from.y)), pair(30, '0'),
      pair(11, fmt(line.to.x)), pair(21, fmt(line.to.y)), pair(31, '0'),
    );
  });
  model.polylines.forEach((polyline) => {
    out.push(pair(0, 'LWPOLYLINE'), pair(8, polyline.layer), ...colorOf(polyline.layer, polyline.colorHex), ...linetypeOf(polyline.layer, polyline.linetypeId), ...invisibleOf(polyline.invisible), pair(90, String(polyline.vertices.length)), pair(70, polyline.closed ? '1' : '0'));
    polyline.vertices.forEach((vertex) => {
      out.push(pair(10, fmt(vertex.x)), pair(20, fmt(vertex.y)));
    });
  });
  model.arcs.forEach((arc) => {
    out.push(
      pair(0, 'ARC'), pair(8, arc.layer), ...colorOf(arc.layer, arc.colorHex), ...linetypeOf(arc.layer, arc.linetypeId), ...invisibleOf(arc.invisible),
      pair(10, fmt(arc.center.x)), pair(20, fmt(arc.center.y)), pair(30, '0'),
      pair(40, fmt(arc.radius)), pair(50, fmt(arc.startDeg)), pair(51, fmt(arc.endDeg)),
    );
  });
  model.texts.forEach((entry) => {
    out.push(
      pair(0, 'TEXT'), pair(8, entry.layer), ...colorOf(entry.layer, entry.colorHex), ...linetypeOf(entry.layer, entry.linetypeId), ...invisibleOf(entry.invisible),
      pair(10, fmt(entry.at.x)), pair(20, fmt(entry.at.y)), pair(30, '0'),
      pair(40, fmt(entry.height)), pair(1, entry.text),
      ...(entry.rotationDeg != null && entry.rotationDeg !== 0 ? [pair(50, fmt(entry.rotationDeg))] : []),
    );
  });
  // Native INSERTs (R12 supports BLOCKS + INSERT with 41/42/43 scales and
  // 50 rotation). Inserts whose block was omitted above stay omitted + warn.
  (model.inserts ?? []).forEach((insert) => {
    if (!nativeBlockNames.has(insert.blockName)) {
      result.warnings.push({ code: 'SKIPPED_ENTITY', message: `INSERT of omitted block ${JSON.stringify(insert.blockName)} skipped` });
      return;
    }
    out.push(
      pair(0, 'INSERT'), pair(8, insert.layer), ...colorOf(insert.layer, insert.colorHex), ...linetypeOf(insert.layer, insert.linetypeId), ...invisibleOf(insert.invisible),
      pair(2, insert.blockName),
      pair(10, fmt(insert.at.x)), pair(20, fmt(insert.at.y)), pair(30, '0'),
      // Phase 18Q: mirror rides as signed group 41 (native DXF reflection).
      pair(41, fmt(insert.mirrored === true ? -insert.scaleX : insert.scaleX)), pair(42, fmt(insert.scaleY)), pair(43, '1'),
      pair(50, fmt(insert.rotationDeg)),
    );
  });
  out.push(pair(0, 'ENDSEC'), pair(0, 'EOF'));
  result.output = `${out.join('\n')}\n`;
  return finalizeExportResult(result);
};

/** Legacy bare-string path (no warnings). Prefer WithResult for new callers. */
export const serializeDxfModel = (model: DxfExportModel): string =>
  serializeDxfModelWithResult(model).output;
