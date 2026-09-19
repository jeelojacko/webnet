/**
 * Phase 18M — large explicit-TIN LandXML fixture generator (test helper).
 *
 * Committed fixtures stay small (`tests/fixtures/landxml-18m-production.xml`).
 * Large perf corpora (10k / 50k vertices) are generated at test / probe time
 * and are NEVER committed as XML. The grid topology is manifold by
 * construction (every interior edge is shared by exactly two triangles), so
 * the importer's non-manifold guard is not what limits throughput.
 *
 * LandXML `<P>` text order is NORTHING EASTING ELEVATION; the emitted grid
 * uses local coordinates (northing = row, easting = column) so the plane
 * z = 100 + 0.01x + 0.02y stays deterministic and re-parseable.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface LargeTinGrid {
  readonly cols: number;
  readonly rows: number;
  readonly vertexCount: number;
  readonly faceCount: number;
}

/**
 * Factor `vertexCount` into a near-square grid. 10000 → 100×100,
 * 50000 → 200×250 (both exact). Throws when no grid factorisation exists
 * so a caller never silently imports a different vertex count.
 */
export const factorLargeTinGrid = (vertexCount: number): LargeTinGrid => {
  if (!Number.isInteger(vertexCount) || vertexCount < 4) {
    throw new Error(`large-TIN vertex count must be an integer ≥ 4, got ${vertexCount}`);
  }
  for (let cols = Math.floor(Math.sqrt(vertexCount)); cols >= 2; cols -= 1) {
    if (vertexCount % cols !== 0) continue;
    const rows = vertexCount / cols;
    if (rows < 2 || cols < 2) continue;
    return { cols, rows, vertexCount, faceCount: (cols - 1) * (rows - 1) * 2 };
  }
  throw new Error(`no near-square grid factorisation for ${vertexCount} vertices`);
};

export interface LargeTinOptions {
  readonly surfaceName?: string;
  /** Grid cell size in metres (planar plane, not survey-realistic). */
  readonly cellSize?: number;
}

/** Explicit-TIN LandXML 1.2 text for an `vertexCount`-point grid. */
export const buildLargeTinXml = (
  vertexCount: number,
  options: LargeTinOptions = {},
): string => {
  const { cols, rows } = factorLargeTinGrid(vertexCount);
  const cell = options.cellSize ?? 5;
  const name = options.surfaceName ?? 'Large TIN';
  const id = (row: number, col: number): number => row * cols + col + 1;
  const points: string[] = [];
  const faces: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const easting = col * cell;
      const northing = row * cell;
      const elevation = 100 + 0.01 * easting + 0.02 * northing;
      points.push(
        `<P id="${id(row, col)}">${northing.toFixed(3)} ${easting.toFixed(3)} ${elevation.toFixed(3)}</P>`,
      );
    }
  }
  for (let row = 0; row < rows - 1; row += 1) {
    for (let col = 0; col < cols - 1; col += 1) {
      const a = id(row, col);
      const b = id(row, col + 1);
      const c = id(row + 1, col + 1);
      const d = id(row + 1, col);
      faces.push(`<F>${a} ${b} ${c}</F><F>${a} ${c} ${d}</F>`);
    }
  }
  return (
    '<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2" ' +
    'date="2026-09-19" time="12:00:00">' +
    '<Units><Metric areaUnit="squareMeter" linearUnit="meter" volumeUnit="cubicMeter" ' +
    'temperatureUnit="celsius" pressureUnit="HPA" /></Units>' +
    `<Surfaces><Surface name="${name}"><Definition surfType="TIN"><Pnts>` +
    points.join('') +
    '</Pnts><Faces>' +
    faces.join('') +
    '</Faces></Definition></Surface></Surfaces></LandXML>'
  );
};

/** Materialize the generated text as `<dir>/<basename>.xml` and return the path. */
export const writeLargeTinXml = (
  dir: string,
  vertexCount: number,
  options: LargeTinOptions & { readonly baseName?: string } = {},
): string => {
  fs.mkdirSync(dir, { recursive: true });
  const baseName = options.baseName ?? `landxml-large-tin-${vertexCount}`;
  const filePath = path.join(dir, `${baseName}.xml`);
  fs.writeFileSync(filePath, buildLargeTinXml(vertexCount, options));
  return filePath;
};
