/**
 * Shared synthetic project builder for the multifile perf/scaling tests.
 * NOT a test file (no .test. suffix): imported by the agent-tier smoke
 * leg and the manual-only evidence scaling campaign.
 */
import type { ProjectManifestFileEntry } from '../../src/engine/projectWorkspaceTypes';

const FRAME = 'ITRF2020@2020.0';
const EPOCH = '2020.0';
const ELLIPSOID = 'GRS80';
const COV = 'COV 0.000025 0 0 0.000025 0 0.000025';
const STATIONS = ['A', 'B', 'C', 'D'] as const;
const COORDS: Record<string, [number, number, number]> = {
  A: [4000000, 1000000, 4800000],
  B: [4000100, 1000050, 4800020],
  C: [4000200, 999950, 4800100],
  D: [4000150, 1000100, 4799950],
};
const PAIRS: Array<[string, string]> = [
  ['A', 'B'],
  ['B', 'C'],
  ['C', 'D'],
  ['D', 'A'],
  ['A', 'C'],
  ['B', 'D'],
];

const coordOf = (i: number): [number, number, number] =>
  [4000000 + i * 137, 1000000 + i * 89, 4800000 + i * 53];

export const buildPerfFiles = (
  fileCount: number,
  perFile: number,
  shared: boolean,
): { files: ProjectManifestFileEntry[]; texts: Record<string, string> } => {
  const files: ProjectManifestFileEntry[] = [];
  const texts: Record<string, string> = {};
  for (let f = 0; f < fileCount; f += 1) {
    const id = `sperf${f}`;
    files.push({ id, name: `sperf${f}.dat`, kind: 'gnss', path: `data/${id}-sperf${f}.dat`, enabled: true, order: f });
    const lines = [`FRAME ECEF ${FRAME} EPOCH ${EPOCH} ELLIPSOID ${ELLIPSOID}`, 'UNITS M'];
    if (shared) {
      // One connected 4-station network (TS-dense solve friendly, 9 unknowns).
      STATIONS.forEach((station) => {
        const c = COORDS[station] as [number, number, number];
        lines.push(`GX ${station} ${c[0]} ${c[1]} ${c[2]} ${station === 'A' ? 'FIXED' : 'FREE'}`);
      });
      for (let i = 0; i < perFile; i += 1) {
        const [from, to] = PAIRS[(i + f) % PAIRS.length] as [string, string];
        const a = COORDS[from] as [number, number, number];
        const bb = COORDS[to] as [number, number, number];
        const j = ((i * 7 + f) % 11) * 0.001;
        lines.push(`BL ${from} ${to} ${bb[0] - a[0] + j} ${bb[1] - a[1] - j} ${bb[2] - a[2] + j} ID F${f}B${i} SESSION S${i % 5}`);
        lines.push(COV);
      }
    } else {
      // L362 pattern: disjoint stations per file, so endpoint groups stay
      // small and duplicate classification stays indexed (~O(n)). Piling
      // tens of thousands of baselines onto a handful of pairs is a
      // pathological quadratic case, not a project shape — kept out of tier.
      lines.push(`GX A 4000000 1000000 4800000 FIXED`);
      for (let i = 0; i < 20; i += 1) {
        const c = coordOf(i);
        lines.push(`GX F${f}P${i} ${c[0]} ${c[1]} ${c[2]} FREE`);
      }
      for (let i = 0; i < perFile; i += 1) {
        const a = `F${f}P${i % 20}`;
        const b = `F${f}P${(i + 1) % 20}`;
        const ca = coordOf(i % 20);
        const cb = coordOf((i + 1) % 20);
        lines.push(`BL ${a} ${b} ${cb[0] - ca[0]} ${cb[1] - ca[1]} ${cb[2] - ca[2]} ID F${f}B${i} SESSION S${i % 5}`);
        lines.push(COV);
      }
    }
    texts[id] = `${lines.join('\n')}\n`;
  }
  return { files, texts };
};
