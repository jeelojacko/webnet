export const chooseOsmTileMeshDivisions = (
  tileWidthPx: number,
  tileHeightPx: number,
  interacting = false,
): number => {
  const maxSpanPx = Math.max(0, Math.abs(tileWidthPx), Math.abs(tileHeightPx));
  if (interacting) {
    if (maxSpanPx <= 220) return 1;
    if (maxSpanPx <= 420) return 2;
    if (maxSpanPx <= 680) return 3;
    return 4;
  }
  if (maxSpanPx <= 180) return 2;
  if (maxSpanPx <= 300) return 3;
  if (maxSpanPx <= 440) return 4;
  if (maxSpanPx <= 620) return 6;
  return 8;
};
