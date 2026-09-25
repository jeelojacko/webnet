/**
 * Phase 18T performance harness helpers (§100-102).
 *
 * Synthetic point-edit stacks (set-elev / move / delete / add / mixed) over
 * planar grids. Measurement only — no thresholds are encoded here; callers
 * print the numbers and assert correctness (outcome + topology counts).
 */
import type { CadSurfaceEdit } from '../src/engine/cad/cadTypes';
import { planeZ } from './cadSurfacePointEdits18tFixtures';

/** Interior cells spaced `step` apart, `offset` from every hull edge. */
export const spacedCells = (side: number, count: number, step: number, offset: number): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  for (let row = offset; row < side - offset && out.length < count; row += step) {
    for (let col = offset; col < side - offset && out.length < count; col += step) {
      out.push([row, col]);
    }
  }
  return out;
};

export const setElevEdits = (cells: Array<[number, number]>, tag: string, spacing = 10): CadSurfaceEdit[] =>
  cells.map(([row, col], n) => ({
    id: `${tag}${n}`,
    kind: 'set-elevation',
    vertex: { key: `source:pt:${row}-${col}` },
    z: planeZ(col * spacing, row * spacing) + 1,
  }));

export const movePointEdits = (cells: Array<[number, number]>, tag: string, spacing = 10): CadSurfaceEdit[] =>
  cells.map(([row, col], n) => ({
    id: `${tag}${n}`,
    kind: 'move-point',
    vertex: { key: `source:pt:${row}-${col}` },
    x: col * spacing + 1,
    y: row * spacing + 1,
  }));

export const deletePointEdits = (cells: Array<[number, number]>, tag: string): CadSurfaceEdit[] =>
  cells.map(([row, col], n) => ({
    id: `${tag}${n}`,
    kind: 'delete-point',
    vertex: { key: `source:pt:${row}-${col}` },
  }));

export const addPointEdits = (cells: Array<[number, number]>, tag: string, spacing = 10): CadSurfaceEdit[] =>
  cells.map(([row, col], n) => ({
    id: `${tag}${n}`,
    kind: 'add-point',
    x: col * spacing + spacing / 2,
    y: row * spacing + spacing / 2,
    z: planeZ(col * spacing + spacing / 2, row * spacing + spacing / 2),
  }));

export interface PerfStack {
  name: string;
  edits: CadSurfaceEdit[];
}

/** The five measured stacks: 1000 set-elev, 100 each of move/delete/add, mixed-1000. */
export const perfStacks = (side: number): PerfStack[] => [
  { name: 'set1000', edits: setElevEdits(spacedCells(side, 1000, 1, 2), 's') },
  { name: 'move100', edits: movePointEdits(spacedCells(side, 100, 3, 2), 'm') },
  { name: 'delete100', edits: deletePointEdits(spacedCells(side, 100, 3, 3), 'd') },
  { name: 'add100', edits: addPointEdits(spacedCells(side, 100, 3, 1), 'a') },
  {
    name: 'mixed1000',
    edits: [
      ...setElevEdits(spacedCells(side, 400, 1, 4), 'ms'),
      ...movePointEdits(spacedCells(side, 200, 3, 2), 'mm'),
      ...deletePointEdits(spacedCells(side, 200, 3, 3), 'md'),
      ...addPointEdits(spacedCells(side, 200, 3, 1), 'ma'),
    ],
  },
];

/** Expected triangle delta vs the un-edited grid baseline for each stack. */
export const expectedDelta = (name: string): number => {
  switch (name) {
    case 'set1000':
      return 0;
    case 'move100':
      return 0;
    case 'delete100':
      return -200;
    case 'add100':
      return 200;
    case 'mixed1000':
      return 0;
    default:
      throw new Error(`unknown stack ${name}`);
  }
};
