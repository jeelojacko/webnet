// Curated CAD ribbon icons (Phase 21A Wave 1A).
//
// Stripped generic PNGs copied from the gitignored local asset tree via
// `magick SRC -strip PNG32:DEST`. Per-icon source is noted below.
// No Autodesk-derived art is referenced at runtime outside this folder.
//
// Phase 21A sources live under local-assets/generated-cad-icons/dark/<size>/.
// Phase 21B Civil/survey sources live under local-assets/civil3d-icons/
// png/dark/<size>/ — note the directory, not the `_16`/`_32` filename suffix,
// is the real pixel_size (verified by directory per docs/evidence/
// phase21b-icon-provenance.md).

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
  | 'draw-circle-center-radius'
  | 'draw-circle-center-diameter'
  | 'draw-circle-2point'
  | 'draw-circle-3point'
  | 'draw-circle-tan-tan-radius'
  | 'draw-circle-tan-tan-tan'
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
  | 'edit-redo'
  // Phase 21B — Civil/survey wave (per-icon stripped copies; exact source
  // paths and pixel_size evidence in docs/evidence/phase21b-icon-provenance.md).
  | 'surface-create'
  | 'surface-boundary'
  | 'surface-breakline'
  | 'surface-contours'
  | 'surface-paste'
  | 'surface-volume'
  | 'surface-volume-report'
  | 'surface-swap-edge'
  | 'surface-line-add'
  | 'surface-add-point'
  | 'surface-style'
  | 'feature-line-create'
  | 'feature-line-elevation'
  | 'feature-line-elev-from-surface'
  | 'feature-line-raise-lower'
  | 'feature-line-insert-vertex'
  | 'grading-create'
  | 'grading-group-create'
  | 'parcel-props-edit'
  | 'parcel-segments-edit'
  | 'parcel-renumber-tags'
  | 'survey-point-group'
  | 'profile-view'
  | 'section-view'
  | 'landxml-import'
  // CAD Draw Phase L1 — Line family (dark Civil 3D art; exact sources in
  // docs/evidence/cad-line-l1/icon-sources.md). Row 1 keeps 'draw-line'.
  | 'draw-line-point-range'
  | 'draw-line-point-object'
  | 'draw-line-point-name'
  | 'draw-line-northing-easting'
  | 'draw-line-grid-ne'
  | 'draw-line-lat-long'
  | 'draw-line-bearing'
  | 'draw-line-azimuth'
  | 'draw-line-angle'
  | 'draw-line-deflection'
  | 'draw-line-station-offset'
  | 'draw-line-side-shot'
  | 'draw-line-extension'
  | 'draw-line-from-end'
  | 'draw-line-tangent-point'
  | 'draw-line-perp-point'
  // CAD Best Fit E1 — exact Civil best-fit families (see icon-sources.md).
  | 'draw-best-fit-line'
  | 'draw-best-fit-arc'
  | 'draw-best-fit-parabola';

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
  'draw-circle-center-radius': { src16: new URL('./draw-circle-center-radius-16.png', import.meta.url).href, src32: new URL('./draw-circle-center-radius-32.png', import.meta.url).href },
  'draw-circle-center-diameter': { src16: new URL('./draw-circle-center-diameter-16.png', import.meta.url).href, src32: new URL('./draw-circle-center-diameter-32.png', import.meta.url).href },
  'draw-circle-2point': { src16: new URL('./draw-circle-2point-16.png', import.meta.url).href, src32: new URL('./draw-circle-2point-32.png', import.meta.url).href },
  'draw-circle-3point': { src16: new URL('./draw-circle-3point-16.png', import.meta.url).href, src32: new URL('./draw-circle-3point-32.png', import.meta.url).href },
  'draw-circle-tan-tan-radius': { src16: new URL('./draw-circle-tan-tan-radius-16.png', import.meta.url).href, src32: new URL('./draw-circle-tan-tan-radius-32.png', import.meta.url).href },
  'draw-circle-tan-tan-tan': { src16: new URL('./draw-circle-tan-tan-tan-16.png', import.meta.url).href, src32: new URL('./draw-circle-tan-tan-tan-32.png', import.meta.url).href },
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
  // Phase 21B — Civil/survey ribbon icons. Source families (dark theme) are
  // listed in the provenance doc; each id maps 1:1 to one truthful control.
  'surface-create': { src16: new URL('./surface-create-16.png', import.meta.url).href, src32: new URL('./surface-create-32.png', import.meta.url).href },
  'surface-boundary': { src16: new URL('./surface-boundary-16.png', import.meta.url).href, src32: new URL('./surface-boundary-32.png', import.meta.url).href },
  'surface-breakline': { src16: new URL('./surface-breakline-16.png', import.meta.url).href, src32: new URL('./surface-breakline-32.png', import.meta.url).href },
  'surface-contours': { src16: new URL('./surface-contours-16.png', import.meta.url).href, src32: new URL('./surface-contours-32.png', import.meta.url).href },
  'surface-paste': { src16: new URL('./surface-paste-16.png', import.meta.url).href, src32: new URL('./surface-paste-32.png', import.meta.url).href },
  'surface-volume': { src16: new URL('./surface-volume-16.png', import.meta.url).href, src32: new URL('./surface-volume-32.png', import.meta.url).href },
  'surface-volume-report': { src16: new URL('./surface-volume-report-16.png', import.meta.url).href, src32: new URL('./surface-volume-report-32.png', import.meta.url).href },
  'surface-swap-edge': { src16: new URL('./surface-swap-edge-16.png', import.meta.url).href, src32: new URL('./surface-swap-edge-32.png', import.meta.url).href },
  'surface-line-add': { src16: new URL('./surface-line-add-16.png', import.meta.url).href, src32: new URL('./surface-line-add-32.png', import.meta.url).href },
  'surface-add-point': { src16: new URL('./surface-add-point-16.png', import.meta.url).href, src32: new URL('./surface-add-point-32.png', import.meta.url).href },
  'surface-style': { src16: new URL('./surface-style-16.png', import.meta.url).href, src32: new URL('./surface-style-32.png', import.meta.url).href },
  'feature-line-create': { src16: new URL('./feature-line-create-16.png', import.meta.url).href, src32: new URL('./feature-line-create-32.png', import.meta.url).href },
  'feature-line-elevation': { src16: new URL('./feature-line-elevation-16.png', import.meta.url).href, src32: new URL('./feature-line-elevation-32.png', import.meta.url).href },
  'feature-line-elev-from-surface': { src16: new URL('./feature-line-elev-from-surface-16.png', import.meta.url).href, src32: new URL('./feature-line-elev-from-surface-32.png', import.meta.url).href },
  'feature-line-raise-lower': { src16: new URL('./feature-line-raise-lower-16.png', import.meta.url).href, src32: new URL('./feature-line-raise-lower-32.png', import.meta.url).href },
  'feature-line-insert-vertex': { src16: new URL('./feature-line-insert-vertex-16.png', import.meta.url).href, src32: new URL('./feature-line-insert-vertex-32.png', import.meta.url).href },
  'grading-create': { src16: new URL('./grading-create-16.png', import.meta.url).href, src32: new URL('./grading-create-32.png', import.meta.url).href },
  'grading-group-create': { src16: new URL('./grading-group-create-16.png', import.meta.url).href, src32: new URL('./grading-group-create-32.png', import.meta.url).href },
  'parcel-props-edit': { src16: new URL('./parcel-props-edit-16.png', import.meta.url).href, src32: new URL('./parcel-props-edit-32.png', import.meta.url).href },
  'parcel-segments-edit': { src16: new URL('./parcel-segments-edit-16.png', import.meta.url).href, src32: new URL('./parcel-segments-edit-32.png', import.meta.url).href },
  'parcel-renumber-tags': { src16: new URL('./parcel-renumber-tags-16.png', import.meta.url).href, src32: new URL('./parcel-renumber-tags-32.png', import.meta.url).href },
  'survey-point-group': { src16: new URL('./survey-point-group-16.png', import.meta.url).href, src32: new URL('./survey-point-group-32.png', import.meta.url).href },
  'profile-view': { src16: new URL('./profile-view-16.png', import.meta.url).href, src32: new URL('./profile-view-32.png', import.meta.url).href },
  'section-view': { src16: new URL('./section-view-16.png', import.meta.url).href, src32: new URL('./section-view-32.png', import.meta.url).href },
  'landxml-import': { src16: new URL('./landxml-import-16.png', import.meta.url).href, src32: new URL('./landxml-import-32.png', import.meta.url).href },
  // CAD Draw Phase L1 — Line family. Dark ribbon art only; no theme pair.
  'draw-line-point-range': { src16: new URL('./draw-line-point-range-16.png', import.meta.url).href, src32: new URL('./draw-line-point-range-32.png', import.meta.url).href },
  'draw-line-point-object': { src16: new URL('./draw-line-point-object-16.png', import.meta.url).href, src32: new URL('./draw-line-point-object-32.png', import.meta.url).href },
  'draw-line-point-name': { src16: new URL('./draw-line-point-name-16.png', import.meta.url).href, src32: new URL('./draw-line-point-name-32.png', import.meta.url).href },
  'draw-line-northing-easting': { src16: new URL('./draw-line-northing-easting-16.png', import.meta.url).href, src32: new URL('./draw-line-northing-easting-32.png', import.meta.url).href },
  'draw-line-grid-ne': { src16: new URL('./draw-line-grid-ne-16.png', import.meta.url).href, src32: new URL('./draw-line-grid-ne-32.png', import.meta.url).href },
  'draw-line-lat-long': { src16: new URL('./draw-line-lat-long-16.png', import.meta.url).href, src32: new URL('./draw-line-lat-long-32.png', import.meta.url).href },
  'draw-line-bearing': { src16: new URL('./draw-line-bearing-16.png', import.meta.url).href, src32: new URL('./draw-line-bearing-32.png', import.meta.url).href },
  'draw-line-azimuth': { src16: new URL('./draw-line-azimuth-16.png', import.meta.url).href, src32: new URL('./draw-line-azimuth-32.png', import.meta.url).href },
  'draw-line-angle': { src16: new URL('./draw-line-angle-16.png', import.meta.url).href, src32: new URL('./draw-line-angle-32.png', import.meta.url).href },
  'draw-line-deflection': { src16: new URL('./draw-line-deflection-16.png', import.meta.url).href, src32: new URL('./draw-line-deflection-32.png', import.meta.url).href },
  'draw-line-station-offset': { src16: new URL('./draw-line-station-offset-16.png', import.meta.url).href, src32: new URL('./draw-line-station-offset-32.png', import.meta.url).href },
  'draw-line-side-shot': { src16: new URL('./draw-line-side-shot-16.png', import.meta.url).href, src32: new URL('./draw-line-side-shot-32.png', import.meta.url).href },
  'draw-line-extension': { src16: new URL('./draw-line-extension-16.png', import.meta.url).href, src32: new URL('./draw-line-extension-32.png', import.meta.url).href },
  'draw-line-from-end': { src16: new URL('./draw-line-from-end-16.png', import.meta.url).href, src32: new URL('./draw-line-from-end-32.png', import.meta.url).href },
  'draw-line-tangent-point': { src16: new URL('./draw-line-tangent-point-16.png', import.meta.url).href, src32: new URL('./draw-line-tangent-point-32.png', import.meta.url).href },
  'draw-line-perp-point': { src16: new URL('./draw-line-perp-point-16.png', import.meta.url).href, src32: new URL('./draw-line-perp-point-32.png', import.meta.url).href },
  // CAD Best Fit E1 — stripped Civil best-fit art (exact families only).
  'draw-best-fit-line': { src16: new URL('./draw-best-fit-line-16.png', import.meta.url).href, src32: new URL('./draw-best-fit-line-32.png', import.meta.url).href },
  'draw-best-fit-arc': { src16: new URL('./draw-best-fit-arc-16.png', import.meta.url).href, src32: new URL('./draw-best-fit-arc-32.png', import.meta.url).href },
  'draw-best-fit-parabola': { src16: new URL('./draw-best-fit-parabola-16.png', import.meta.url).href, src32: new URL('./draw-best-fit-parabola-32.png', import.meta.url).href },
};
