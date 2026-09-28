// Curated CAD ribbon icons (Phase 21A Wave 1A).
//
// Stripped generic PNGs copied from the gitignored local asset tree
// (local-assets/generated-cad-icons/dark/<size>/<SOURCE>.png) via
// `magick SRC -strip PNG32:DEST`. Per-icon source is noted below.
// No Autodesk-derived art is referenced at runtime outside this folder.

export type CadRibbonIconId =
  | 'draw-line'
  | 'draw-polyline'
  | 'draw-arc-3point'
  | 'draw-arc-start-center-end'
  | 'draw-arc-start-center-angle'
  | 'draw-arc-start-center-length'
  | 'draw-arc-start-end-angle'
  | 'draw-arc-start-end-direction'
  | 'draw-arc-start-end-radius'
  | 'draw-arc-center-start-end'
  | 'draw-arc-center-start-angle'
  | 'draw-arc-center-start-length'
  | 'draw-point'
  | 'draw-spline'
  | 'draw-3dpoly'
  | 'modify-move'
  | 'modify-copy'
  | 'modify-rotate'
  | 'modify-scale'
  | 'modify-mirror'
  | 'modify-trim'
  | 'modify-extend'
  | 'modify-fillet'
  | 'modify-explode'
  | 'modify-erase'
  | 'layers'
  | 'block'
  | 'block-insert-dwg'
  | 'text-multiline'
  | 'text-style'
  | 'leader-quick'
  | 'snap-tangent'
  | 'dim-linear'
  | 'dim-aligned'
  | 'dim-angular'
  | 'dim-radius'
  | 'dim-diameter'
  | 'dim-arc-length'
  | 'dim-style'
  | 'table'
  | 'table-style'
  | 'hatch-pattern'
  | 'hatch-gradient'
  | 'hatch-retain-boundary'
  | 'align-3d'
  | 'file-new'
  | 'file-open'
  | 'file-save'
  | 'edit-undo'
  | 'edit-redo';

export interface CadRibbonIconSources {
  src16: string;
  src24?: string;
  src32?: string;
}

// Source: LINE / PLINE / ARC3PT / ARCSCE / ARCCSA / ARCSCL / ARCSEA /
// ARCSED / ARCSER / ARCCSE / ARCCSA / ARCCSL / POINT / SPLINE / 3DPOLY /
// MOVE / COPY / ROTATE / SCALE / MIRROR / TRIM / EXTEND / FILLET /
// EXPLODE / ERASE / LAYERS / BLOCK / BLOCK_INSERT_DWG_AS_BLK / MTEXT /
// TXTSTYLE / QLEADER / TANGENT_16 (16px) + TANGENT_32 (32px) / DIMLIN /
// DIMALI / DIMANG / DIMRAD / DIMDIA / DIMARC / DIMSTY / TABLE /
// TABLESTYLE / BHATCH / GRADIENT / HATCH_RETAINBOUNDARY / 3DALIGN /
// NEW / OPEN / SAVE / UNDO / REDO
// (each under local-assets/generated-cad-icons/dark/<size>/<SOURCE>.png)
export const CAD_RIBBON_ICONS: Record<CadRibbonIconId, CadRibbonIconSources> = {
  'draw-line': { src16: new URL('./draw-line-16.png', import.meta.url).href, src32: new URL('./draw-line-32.png', import.meta.url).href },
  'draw-polyline': { src16: new URL('./draw-polyline-16.png', import.meta.url).href, src32: new URL('./draw-polyline-32.png', import.meta.url).href },
  'draw-arc-3point': { src16: new URL('./draw-arc-3point-16.png', import.meta.url).href, src32: new URL('./draw-arc-3point-32.png', import.meta.url).href },
  'draw-arc-start-center-end': { src16: new URL('./draw-arc-start-center-end-16.png', import.meta.url).href, src32: new URL('./draw-arc-start-center-end-32.png', import.meta.url).href },
  'draw-arc-start-center-angle': { src16: new URL('./draw-arc-start-center-angle-16.png', import.meta.url).href, src32: new URL('./draw-arc-start-center-angle-32.png', import.meta.url).href },
  'draw-arc-start-center-length': { src16: new URL('./draw-arc-start-center-length-16.png', import.meta.url).href, src32: new URL('./draw-arc-start-center-length-32.png', import.meta.url).href },
  'draw-arc-start-end-angle': { src16: new URL('./draw-arc-start-end-angle-16.png', import.meta.url).href, src32: new URL('./draw-arc-start-end-angle-32.png', import.meta.url).href },
  'draw-arc-start-end-direction': { src16: new URL('./draw-arc-start-end-direction-16.png', import.meta.url).href, src32: new URL('./draw-arc-start-end-direction-32.png', import.meta.url).href },
  'draw-arc-start-end-radius': { src16: new URL('./draw-arc-start-end-radius-16.png', import.meta.url).href, src32: new URL('./draw-arc-start-end-radius-32.png', import.meta.url).href },
  'draw-arc-center-start-end': { src16: new URL('./draw-arc-center-start-end-16.png', import.meta.url).href, src32: new URL('./draw-arc-center-start-end-32.png', import.meta.url).href },
  'draw-arc-center-start-angle': { src16: new URL('./draw-arc-center-start-angle-16.png', import.meta.url).href, src32: new URL('./draw-arc-center-start-angle-32.png', import.meta.url).href },
  'draw-arc-center-start-length': { src16: new URL('./draw-arc-center-start-length-16.png', import.meta.url).href, src32: new URL('./draw-arc-center-start-length-32.png', import.meta.url).href },
  'draw-point': { src16: new URL('./draw-point-16.png', import.meta.url).href, src32: new URL('./draw-point-32.png', import.meta.url).href },
  'draw-spline': { src16: new URL('./draw-spline-16.png', import.meta.url).href, src32: new URL('./draw-spline-32.png', import.meta.url).href },
  'draw-3dpoly': { src16: new URL('./draw-3dpoly-16.png', import.meta.url).href, src32: new URL('./draw-3dpoly-32.png', import.meta.url).href },
  'modify-move': { src16: new URL('./modify-move-16.png', import.meta.url).href, src32: new URL('./modify-move-32.png', import.meta.url).href },
  'modify-copy': { src16: new URL('./modify-copy-16.png', import.meta.url).href, src32: new URL('./modify-copy-32.png', import.meta.url).href },
  'modify-rotate': { src16: new URL('./modify-rotate-16.png', import.meta.url).href, src32: new URL('./modify-rotate-32.png', import.meta.url).href },
  'modify-scale': { src16: new URL('./modify-scale-16.png', import.meta.url).href, src32: new URL('./modify-scale-32.png', import.meta.url).href },
  'modify-mirror': { src16: new URL('./modify-mirror-16.png', import.meta.url).href, src32: new URL('./modify-mirror-32.png', import.meta.url).href },
  'modify-trim': { src16: new URL('./modify-trim-16.png', import.meta.url).href, src32: new URL('./modify-trim-32.png', import.meta.url).href },
  'modify-extend': { src16: new URL('./modify-extend-16.png', import.meta.url).href, src32: new URL('./modify-extend-32.png', import.meta.url).href },
  'modify-fillet': { src16: new URL('./modify-fillet-16.png', import.meta.url).href, src32: new URL('./modify-fillet-32.png', import.meta.url).href },
  'modify-explode': { src16: new URL('./modify-explode-16.png', import.meta.url).href, src32: new URL('./modify-explode-32.png', import.meta.url).href },
  'modify-erase': { src16: new URL('./modify-erase-16.png', import.meta.url).href, src32: new URL('./modify-erase-32.png', import.meta.url).href },
  layers: { src16: new URL('./layers-16.png', import.meta.url).href, src32: new URL('./layers-32.png', import.meta.url).href },
  block: { src16: new URL('./block-16.png', import.meta.url).href, src32: new URL('./block-32.png', import.meta.url).href },
  'block-insert-dwg': { src16: new URL('./block-insert-dwg-16.png', import.meta.url).href, src32: new URL('./block-insert-dwg-32.png', import.meta.url).href },
  'text-multiline': { src16: new URL('./text-multiline-16.png', import.meta.url).href, src32: new URL('./text-multiline-32.png', import.meta.url).href },
  'text-style': { src16: new URL('./text-style-16.png', import.meta.url).href, src32: new URL('./text-style-32.png', import.meta.url).href },
  'leader-quick': { src16: new URL('./leader-quick-16.png', import.meta.url).href, src32: new URL('./leader-quick-32.png', import.meta.url).href },
  'snap-tangent': { src16: new URL('./snap-tangent-16.png', import.meta.url).href, src32: new URL('./snap-tangent-32.png', import.meta.url).href },
  'dim-linear': { src16: new URL('./dim-linear-16.png', import.meta.url).href, src32: new URL('./dim-linear-32.png', import.meta.url).href },
  'dim-aligned': { src16: new URL('./dim-aligned-16.png', import.meta.url).href, src32: new URL('./dim-aligned-32.png', import.meta.url).href },
  'dim-angular': { src16: new URL('./dim-angular-16.png', import.meta.url).href, src32: new URL('./dim-angular-32.png', import.meta.url).href },
  'dim-radius': { src16: new URL('./dim-radius-16.png', import.meta.url).href, src32: new URL('./dim-radius-32.png', import.meta.url).href },
  'dim-diameter': { src16: new URL('./dim-diameter-16.png', import.meta.url).href, src32: new URL('./dim-diameter-32.png', import.meta.url).href },
  'dim-arc-length': { src16: new URL('./dim-arc-length-16.png', import.meta.url).href, src32: new URL('./dim-arc-length-32.png', import.meta.url).href },
  'dim-style': { src16: new URL('./dim-style-16.png', import.meta.url).href, src32: new URL('./dim-style-32.png', import.meta.url).href },
  table: { src16: new URL('./table-16.png', import.meta.url).href, src32: new URL('./table-32.png', import.meta.url).href },
  'table-style': { src16: new URL('./table-style-16.png', import.meta.url).href, src32: new URL('./table-style-32.png', import.meta.url).href },
  'hatch-pattern': { src16: new URL('./hatch-pattern-16.png', import.meta.url).href, src32: new URL('./hatch-pattern-32.png', import.meta.url).href },
  'hatch-gradient': { src16: new URL('./hatch-gradient-16.png', import.meta.url).href, src32: new URL('./hatch-gradient-32.png', import.meta.url).href },
  'hatch-retain-boundary': { src16: new URL('./hatch-retain-boundary-16.png', import.meta.url).href, src32: new URL('./hatch-retain-boundary-32.png', import.meta.url).href },
  'align-3d': { src16: new URL('./align-3d-16.png', import.meta.url).href, src32: new URL('./align-3d-32.png', import.meta.url).href },
  'file-new': { src16: new URL('./file-new-16.png', import.meta.url).href, src32: new URL('./file-new-32.png', import.meta.url).href },
  'file-open': { src16: new URL('./file-open-16.png', import.meta.url).href, src32: new URL('./file-open-32.png', import.meta.url).href },
  'file-save': { src16: new URL('./file-save-16.png', import.meta.url).href, src32: new URL('./file-save-32.png', import.meta.url).href },
  'edit-undo': { src16: new URL('./edit-undo-16.png', import.meta.url).href, src32: new URL('./edit-undo-32.png', import.meta.url).href },
  'edit-redo': { src16: new URL('./edit-redo-16.png', import.meta.url).href, src32: new URL('./edit-redo-32.png', import.meta.url).href },
};
