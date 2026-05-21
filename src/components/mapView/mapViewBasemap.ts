export const chooseOsmTileMeshDivisions = (
  tileWidthPx: number,
  tileHeightPx: number,
  interacting = false,
): number => {
  const maxSpanPx = Math.max(0, Math.abs(tileWidthPx), Math.abs(tileHeightPx));
  if (interacting) {
    if (maxSpanPx <= 320) return 1;
    return 2;
  }
  if (maxSpanPx <= 180) return 1;
  if (maxSpanPx <= 300) return 2;
  if (maxSpanPx <= 440) return 3;
  if (maxSpanPx <= 620) return 4;
  return 5;
};

export const resolveInteractiveBasemapTiles = <Tile>(
  liveTiles: Tile[],
  stableTiles: Tile[],
  interactionPhase: 'idle' | 'interacting' | 'settling',
  reuseStableDuringInteraction = true,
): Tile[] => {
  if (
    interactionPhase === 'interacting' &&
    reuseStableDuringInteraction &&
    stableTiles.length > 0
  ) {
    return stableTiles;
  }
  return liveTiles;
};

export const buildRequestedBasemapTiles = <Tile extends { key: string }>(
  renderTiles: Tile[],
  prefetchedTiles: Tile[],
  interactionPhase: 'idle' | 'interacting' | 'settling',
): Tile[] => {
  if (interactionPhase !== 'idle') return renderTiles;
  if (prefetchedTiles.length === 0) return renderTiles;
  const seen = new Set(renderTiles.map((tile) => tile.key));
  const merged = [...renderTiles];
  prefetchedTiles.forEach((tile) => {
    if (seen.has(tile.key)) return;
    seen.add(tile.key);
    merged.push(tile);
  });
  return merged;
};
