import type { ProjectedMapLine2D, ProjectedPoint2D } from './mapView2d';
import { measureMapViewPerf, noteMapViewPerfCounter, noteMapViewPerfMetadata } from './mapViewPerf';

const DEFAULT_POINT_CELL_PX = 28;
const DEFAULT_LINE_CELL_PX = 44;

const buildCellKey = (col: number, row: number): string => `${col}:${row}`;

export interface MapViewHitIndex {
  pointCandidates: (_x: number, _y: number, _radiusPx: number) => ProjectedPoint2D[];
  lineCandidates: (_x: number, _y: number, _radiusPx: number) => ProjectedMapLine2D[];
}

export const buildMapViewHitIndex = (input: {
  points: ProjectedPoint2D[];
  lines: ProjectedMapLine2D[];
  pointCellPx?: number;
  lineCellPx?: number;
}): MapViewHitIndex =>
  measureMapViewPerf('map:build-hit-index', () => {
    noteMapViewPerfCounter('map:hit-index-builds');
    noteMapViewPerfMetadata('map:last-hit-index-point-count', input.points.length);
    noteMapViewPerfMetadata('map:last-hit-index-line-count', input.lines.length);
    const pointCellPx = Math.max(8, input.pointCellPx ?? DEFAULT_POINT_CELL_PX);
    const lineCellPx = Math.max(12, input.lineCellPx ?? DEFAULT_LINE_CELL_PX);
    const pointBuckets = new Map<string, ProjectedPoint2D[]>();
    const lineBuckets = new Map<string, ProjectedMapLine2D[]>();

  const pushPoint = (key: string, point: ProjectedPoint2D) => {
    const bucket = pointBuckets.get(key);
    if (bucket) {
      bucket.push(point);
      return;
    }
    pointBuckets.set(key, [point]);
  };
  const pushLine = (key: string, line: ProjectedMapLine2D) => {
    const bucket = lineBuckets.get(key);
    if (bucket) {
      bucket.push(line);
      return;
    }
    lineBuckets.set(key, [line]);
  };

  input.points.forEach((point) => {
    const col = Math.floor(point.screenX / pointCellPx);
    const row = Math.floor(point.screenY / pointCellPx);
    pushPoint(buildCellKey(col, row), point);
  });

  input.lines.forEach((line) => {
    const minX = Math.min(line.screenX1, line.screenX2);
    const maxX = Math.max(line.screenX1, line.screenX2);
    const minY = Math.min(line.screenY1, line.screenY2);
    const maxY = Math.max(line.screenY1, line.screenY2);
    const minCol = Math.floor(minX / lineCellPx);
    const maxCol = Math.floor(maxX / lineCellPx);
    const minRow = Math.floor(minY / lineCellPx);
    const maxRow = Math.floor(maxY / lineCellPx);
    for (let col = minCol; col <= maxCol; col += 1) {
      for (let row = minRow; row <= maxRow; row += 1) {
        pushLine(buildCellKey(col, row), line);
      }
    }
  });

  const collectKeys = (x: number, y: number, radiusPx: number, cellPx: number): string[] => {
    const minCol = Math.floor((x - radiusPx) / cellPx);
    const maxCol = Math.floor((x + radiusPx) / cellPx);
    const minRow = Math.floor((y - radiusPx) / cellPx);
    const maxRow = Math.floor((y + radiusPx) / cellPx);
    const keys: string[] = [];
    for (let col = minCol; col <= maxCol; col += 1) {
      for (let row = minRow; row <= maxRow; row += 1) {
        keys.push(buildCellKey(col, row));
      }
    }
    return keys;
  };

    return {
      pointCandidates: (x, y, radiusPx) => {
        const seen = new Set<string>();
        const matches: ProjectedPoint2D[] = [];
        collectKeys(x, y, radiusPx, pointCellPx).forEach((key) => {
          pointBuckets.get(key)?.forEach((point) => {
            if (seen.has(point.id)) return;
            seen.add(point.id);
            matches.push(point);
          });
        });
        return matches;
      },
      lineCandidates: (x, y, radiusPx) => {
        const seen = new Set<string>();
        const matches: ProjectedMapLine2D[] = [];
        collectKeys(x, y, radiusPx, lineCellPx).forEach((key) => {
          lineBuckets.get(key)?.forEach((line) => {
            if (seen.has(line.key)) return;
            seen.add(line.key);
            matches.push(line);
          });
        });
        return matches;
      },
    };
  });
