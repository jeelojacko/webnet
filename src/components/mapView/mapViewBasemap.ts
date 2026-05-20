export const chooseOsmTileMeshDivisions = (
  tileWidthPx: number,
  tileHeightPx: number,
  interacting = false,
): number => {
  const maxSpanPx = Math.max(0, Math.abs(tileWidthPx), Math.abs(tileHeightPx));
  if (interacting) {
    if (maxSpanPx <= 260) return 1;
    if (maxSpanPx <= 520) return 2;
    return 3;
  }
  if (maxSpanPx <= 180) return 1;
  if (maxSpanPx <= 300) return 2;
  if (maxSpanPx <= 440) return 3;
  if (maxSpanPx <= 620) return 4;
  return 6;
};

export const resolveInteractiveBasemapTiles = <Tile>(
  liveTiles: Tile[],
  stableTiles: Tile[],
  interactionPhase: 'idle' | 'interacting' | 'settling',
): Tile[] => {
  if (interactionPhase === 'interacting' && stableTiles.length > 0) {
    return stableTiles;
  }
  return liveTiles;
};
