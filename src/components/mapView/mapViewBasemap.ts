export const chooseOsmTileMeshDivisions = (
  tileWidthPx: number,
  tileHeightPx: number,
): number => {
  const maxSpanPx = Math.max(0, Math.abs(tileWidthPx), Math.abs(tileHeightPx));
  if (maxSpanPx <= 180) return 2;
  if (maxSpanPx <= 300) return 3;
  if (maxSpanPx <= 440) return 4;
  if (maxSpanPx <= 620) return 6;
  return 8;
};
