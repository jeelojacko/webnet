/**
 * Independent corpus regen entry: runs sweep + adapter + modes studies and
 * writes docs/evidence/cad-circle-representation/corpus.json + .sha256.
 * Deterministic: sorted keys, 6dp rounding at record level, no timestamps.
 * Double-regen must be byte-identical (pure functions of fixed inputs).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAdapterControl } from './cadCircleStudyAdapter.js';
import { runExecutionStudy } from './cadCircleStudyExecution.js';
import { runModesStudy } from './cadCircleStudyModes.js';
import { runSweepStudy } from './cadCircleStudySweep.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CORPUS_DIR = join(root, 'docs', 'evidence', 'cad-circle-representation');
export const CORPUS_JSON = join(CORPUS_DIR, 'corpus.json');
export const CORPUS_SHA = join(CORPUS_DIR, 'corpus.json.sha256');

const stable = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(stable)
  : v != null && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, stable(x)]))
    : v;

export const buildCorpus = (): Record<string, unknown> => ({
  baseline: '50a5c720',
  branch: 'research/cad-circle-representation-decision',
  sweep: runSweepStudy(),
  adapter: runAdapterControl(),
  modes: runModesStudy(),
  execution: runExecutionStudy(),
  forensics: {
    circleEntityKind: false,
    kernels: ['cadSignedSweepDeg', 'cadIsAngleOnArcSweep', 'cadPointOnCircle', 'cadClosestPointOnArc', 'cadArcStart/End/Midpoint'],
    intersections: ['cadIntersectCircleCircle', 'cadTangentPointsFromExternalPointToCircle'],
    svgFullCirclePath: 'SurveyCadPreview.geometry.ts:242-249 (two 180deg arcs)',
    quadrantSnap: 'EXISTS',
    affineCurved: 'BLOCKED (GENERAL_AFFINE refused)',
    parcelFullCircleGuard: 'parcel-specific (cadParcelArcGeometry.ts:70,326-330)',
    boundsDisagreement: 'endpoints-only (cadProjectState.ts:113) vs center+-radius (cadSpatialIndex.ts:160)',
    dxfCircles: 'model.circles ABSENT (grep-proven); arcs ride model.arcs verbatim',
    exhaustiveSwitch: '26 switch(entity.type) sites; 33 files with case arc (measured 2026-10-05; ~30 estimate confirmed)',
    representationVerdict: 'POLICY_REQUIRED_CIRCLE_REPRESENTATION (decision.md owns the verdict: B1 fails G4/G7/G9, A fails G7/G9/G10; neither is GO).',
    b1FullSweepArcAssessment: 'B1 reuses the arc entity + kernels BUT is rejected as GO: full-sweep arcs leak 2 coincident endpoint candidates (1 observable after dedupe) + arc-midpoint + 2 grips (G4), DXF 0/360 is verbatim with host normalization UNEXECUTED (G7), block expansion collapses 0/360 to 0/0 and mean-scales ellipses into arcs (G9). No new kind, no switch-site growth.',
    aFirstClassCircleAssessment: 'A (first-class circle kind) is semantically clean BUT is rejected as GO: no model CIRCLE emitter/re-import (G7), all 26 switch sites + parcel/feature-line/alignment/fillet/trim/curve-tools/reverse/subdivide/offset/tables/DXF/spatial-index/properties/renderer paths that assume arc-ness (fillet 11 files, trim 63, reverse 24, offset 61 per grep) need a circle arm or an explicit refusal (G9), and the schema/round-trip/revision delta is unspecified (G10).',
  },
});

export const regenCorpus = (): { bytes: number; sha256: string } => {
  const text = `${JSON.stringify(stable(buildCorpus()), null, 2)}\n`;
  mkdirSync(CORPUS_DIR, { recursive: true });
  writeFileSync(CORPUS_JSON, text);
  const sha = createHash('sha256').update(text).digest('hex');
  writeFileSync(CORPUS_SHA, `${sha}  corpus.json\n`);
  return { bytes: text.length, sha256: sha };
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = regenCorpus();
  console.log(`corpus.json ${r.bytes}B sha256:${r.sha256}`);
}
