/**
 * Phase 20K.3 Wave A2 — RED reproduction: `gtop1` digest is not exact.
 *
 * SCOPE (read-only): pins the coordinate-digest defect in
 *   - `digestTopologyMesh` / `digestTopologyCoordinates` (FNV-1a over
 *     `Number#toPrecision(12)` text) in `gradingTopologyCertificate.ts`, and
 *   - `digestSeamMesh` (same scheme) in `gradingChordSeam.ts`.
 *
 * `toPrecision(12)` keeps 12 significant digits, so two coordinates that
 * differ below the 12-significant-digit quantum produce the SAME text, the
 * SAME FNV digest, and — through the `gtop1` certificate — a FALSE-ACCEPT at
 * product revalidation (a mesh whose geometry changed keeps its certificate).
 *
 * Convention for this project's Wave A: "RED = records the current actual
 * behaviour". The `describe('... (RED: current actual)')` blocks therefore
 * pass by asserting the defect. The former `it.fails(...)` fix target is now
 * a green test that pins the exact digest diverging from the legacy collision
 * (Wave B landed `gtop2`); the legacy `toPrecision(12)`/FNV digest is kept
 * only as the recorded pre-fix baseline.
 *
 * No `src/` change is made by this file.
 */
import { describe, expect, it } from 'vitest';

import { digestSeamMesh, digestSeamMeshExact } from '../src/engine/cad/grading/gradingChordSeam';
import {
  GRADING_TOPOLOGY_CERTIFICATE_EXACT_VERSION,
  buildGradingTopologyCertificate,
  buildGradingTopologyCertificateExact,
  digestTopologyCoordinates,
  digestTopologyCoordinatesExact,
  digestTopologyMesh,
  digestTopologyMeshExact,
  gradingTopologyCertificateError,
  gradingTopologyCertificateExactError,
  gradingTopologyCertificateProductError,
} from '../src/engine/cad/grading/gradingTopologyCertificate';
import { deriveGradingTopologyExpectation } from '../src/engine/cad/grading/gradingTopologyExpectation';

const stripPts = [0, 0, 0, 10, 0, 0, 10, 2, 0, 0, 2, 0];
const stripTris = [0, 1, 2, 0, 2, 3];

/** The exact text `gtop1` hashes for a coordinate buffer (12 significant digits). */
const gtop1Text = (values: readonly number[]): string =>
  values.map((value) => value.toPrecision(12)).join(',');

/** The exact text `gtop1` hashes for a mesh (points + triangles). */
const gtop1MeshText = (points: readonly number[], triangles: readonly number[]): string =>
  `${gtop1Text(points)}|${triangles.join(',')}`;

// (magnitude, +delta) pairs requested for reproduction. Collision holds when
// the 12-significant-digit quantum of `magnitude` is larger than `delta`.
const REQUESTED_PAIRS: ReadonlyArray<{ magnitude: number; delta: number }> = [
  { magnitude: 100, delta: 0.000000001 },
  { magnitude: 2000000, delta: 0.000001 },
  { magnitude: 7000000, delta: 0.000001 },
  { magnitude: 100000000, delta: 0.0001 },
  { magnitude: 300000000, delta: 0.0001 },
];

// A simple 10 m x 2 m quad translated to a stress origin.
const stressQuad = (originX: number): { points: number[]; triangles: number[] } => ({
  points: [originX, 0, 0, originX + 10, 0, 0, originX + 10, 2, 0, originX, 2, 0],
  triangles: [0, 1, 2, 0, 2, 3],
});

describe('20K.3 A2 collision table — toPrecision(12) is not exact (RED: current actual)', () => {
  it('records which requested magnitudes collide at their delta', () => {
    const table = REQUESTED_PAIRS.map(({ magnitude, delta }) => {
      const base = magnitude;
      const shifted = magnitude + delta;
      return {
        base,
        shifted,
        baseText: base.toPrecision(12),
        shiftedText: shifted.toPrecision(12),
        sameText: base.toPrecision(12) === shifted.toPrecision(12),
        sameCoordinateDigest: digestTopologyCoordinates([base]) === digestTopologyCoordinates([shifted]),
        sameSeamDigest: digestSeamMesh([base], []) === digestSeamMesh([shifted], []),
      };
    });

    console.log('20K.3 A2 collision table\n' + JSON.stringify(table, null, 2));

    // The magnitudes above 10^6 do collide: 12 significant digits round the
    // sub-millimetre delta away. 100 / 100.000000001 does NOT collide — the
    // delta equals exactly one 12-significant-digit quantum at 10^2 — and is
    // pinned as a non-collision (the requested pair list overstates the bug).
    expect(table.map((row) => row.sameText)).toEqual([false, true, true, true, true]);
    for (const row of table) {
      expect(row.sameCoordinateDigest).toBe(row.sameText);
      expect(row.sameSeamDigest).toBe(row.sameText);
    }
  });

  it('minimum pin: 100000000 vs 100000000.0001 is same text and same digest', () => {
    const base = 100000000;
    const shifted = 100000000.0001;
    expect(base.toPrecision(12)).toBe('100000000.000');
    expect(shifted.toPrecision(12)).toBe('100000000.000');
    expect(gtop1Text([base])).toBe(gtop1Text([shifted]));
    expect(digestTopologyCoordinates([base])).toBe(digestTopologyCoordinates([shifted]));
    expect(digestSeamMesh([base], [])).toBe(digestSeamMesh([shifted], []));
  });
});

describe('20K.3 A2 mesh digest collision + product false-accept (RED: current actual)', () => {
  it('a 0.1 mm shift at a 10^8 m station keeps the gtop1 mesh digest', () => {
    const a = stressQuad(100000000);
    const b = stressQuad(100000000);
    b.points[0] = 100000000.0001; // +0.1 mm

    expect(a.points[0]).not.toBe(b.points[0]);
    expect(gtop1MeshText(a.points, a.triangles)).toBe(gtop1MeshText(b.points, b.triangles));
    expect(digestTopologyMesh(a.points, a.triangles)).toBe(digestTopologyMesh(b.points, b.triangles));
    expect(digestSeamMesh(a.points, a.triangles)).toBe(digestSeamMesh(b.points, b.triangles));
  });

  it('product revalidation FALSE-ACCEPTS the shifted mesh against the base certificate', () => {
    const a = stressQuad(100000000);
    const b = stressQuad(100000000);
    b.points[0] = 100000000.0001;

    const certificate = buildGradingTopologyCertificate({
      scope: 'standalone',
      points: a.points,
      triangles: a.triangles,
      sourceBoundaryPoints: [a.points[0]!, 0, 0, a.points[3]!, 0, 0],
      gradingBoundaryPoints: [a.points[0]!, 2, 0, a.points[3]!, 2, 0],
    });
    expect(certificate).not.toBeNull();

    // Same scope, same mesh buffers except one 0.1 mm coordinate: the product
    // gate re-derives the digest from `b` and it still matches `a`'s cert.
    expect(
      gradingTopologyCertificateError(certificate ?? undefined, 'standalone', {
        points: b.points,
        triangles: b.triangles,
      }),
    ).toBeNull();
    expect(
      gradingTopologyCertificateProductError(
        certificate ?? undefined,
        'standalone',
        { points: b.points, triangles: b.triangles },
        {
          sourceBoundaryPoints: [a.points[0]!, 0, 0, a.points[3]!, 0, 0],
          gradingBoundaryPoints: [a.points[0]!, 2, 0, a.points[3]!, 2, 0],
        },
      ),
    ).toBeNull();
  });
});

describe('20K.3 A2 digest encoding pins (RED: current actual)', () => {
  it('array-length / split ambiguity: same concatenated values, different split', () => {
    // Identical value sequence [1,2,3]; different points/triangles boundary.
    expect(digestTopologyMesh([1, 2], [3])).not.toBe(digestTopologyMesh([1], [2, 3]));
    expect(gtop1MeshText([1, 2], [3])).toBe('1.00000000000,2.00000000000|3');
    expect(gtop1MeshText([1], [2, 3])).toBe('1.00000000000|2,3');
  });

  it('+0 and -0 collide (both render "0.00000000000")', () => {
    expect(Object.is(-0, 0)).toBe(false);
    expect(gtop1Text([-0])).toBe(gtop1Text([0]));
    expect(digestTopologyCoordinates([-0])).toBe(digestTopologyCoordinates([0]));
    expect(digestTopologyMesh([-0], [])).toBe(digestTopologyMesh([0], []));
  });

  it('delimiters separate adjacent values ([12,3] vs [1,23])', () => {
    expect(gtop1Text([12, 3])).not.toBe(gtop1Text([1, 23]));
    expect(digestTopologyCoordinates([12, 3])).not.toBe(digestTopologyCoordinates([1, 23]));
  });

  it('triangle index order and triangle-array change both alter the digest', () => {
    const points = [0, 0, 0, 10, 0, 0, 10, 2, 0, 0, 2, 0];
    const base = [0, 1, 2, 0, 2, 3];
    expect(digestTopologyMesh(points, [0, 1, 2, 0, 3, 2])).not.toBe(digestTopologyMesh(points, base));
    expect(digestTopologyMesh(points, [0, 1, 3, 0, 2, 3])).not.toBe(digestTopologyMesh(points, base));
    expect(digestSeamMesh(points, [0, 1, 3, 0, 2, 3])).not.toBe(digestSeamMesh(points, base));
  });

  it('NaN / Infinity: digest renders them but topology validation rejects them', () => {
    // The digest itself does not throw and hashes the string form.
    expect(gtop1Text([NaN, Infinity, -Infinity])).toBe('NaN,Infinity,-Infinity');
    expect(digestTopologyCoordinates([NaN])).toBe(digestTopologyCoordinates([NaN]));
    expect(digestTopologyCoordinates([Infinity])).toBe(digestTopologyCoordinates([Infinity]));

    // A non-finite mesh never certifies and product revalidation fails closed.
    const cert = buildGradingTopologyCertificate({
      scope: 'standalone',
      points: [0, 0, 0, 10, 0, 0, 10, 2, 0, 0, 2, 0],
      triangles: [0, 1, 2, 0, 2, 3],
    });
    expect(cert).not.toBeNull();
    expect(
      buildGradingTopologyCertificate({
        scope: 'standalone',
        points: [0, 0, 0, Number.NaN, 0, 0, 10, 2, 0, 0, 2, 0],
        triangles: [0, 1, 2, 0, 2, 3],
      }),
    ).toBeNull();
    expect(
      gradingTopologyCertificateError(cert ?? undefined, 'standalone', {
        points: [0, 0, 0, Number.NaN, 0, 0, 10, 2, 0, 0, 2, 0],
        triangles: [0, 1, 2, 0, 2, 3],
      }),
    ).not.toBeNull();
  });
});

describe('20K.3 A2 fix target (GREEN: the exact digest diverges where gtop1 collides)', () => {
  it('coordinates differing within 12 significant digits yield distinct exact digests', () => {
    const base = stressQuad(100000000);
    const shifted = {
      points: [100000000.0001, 0, 0, 100000010, 0, 0, 100000010, 2, 0, 100000000, 2, 0],
      triangles: [0, 1, 2, 0, 2, 3],
    };
    // Legacy toPrecision(12) FNV collides (recorded above); the exact digest diverges.
    expect(digestTopologyMesh(base.points, base.triangles)).toBe(
      digestTopologyMesh(shifted.points, shifted.triangles),
    );
    expect(digestTopologyMeshExact(base.points, base.triangles)).not.toBe(
      digestTopologyMeshExact(shifted.points, shifted.triangles),
    );
  });
});

describe('20K.3 A2 exact (GREEN): gtop2 Float64 bits + SHA-256, fail-closed', () => {
  it('is a 256-bit F64-bit digest: -0 canonical, NaN/Infinity reject', () => {
    expect(digestTopologyMeshExact(stripPts, stripTris)).toMatch(/^[0-9a-f]{64}$/);
    // -0 canonicalized to +0 (one digest).
    expect(Object.is(-0, 0)).toBe(false);
    expect(digestTopologyCoordinatesExact([-0])).toBe(digestTopologyCoordinatesExact([0]));
    // Non-finite values never digest.
    expect(digestTopologyCoordinatesExact([Number.NaN])).toBeNull();
    expect(digestTopologyCoordinatesExact([Number.POSITIVE_INFINITY])).toBeNull();
    expect(digestTopologyMeshExact([Number.NaN, 0, 0, ...stripPts.slice(3)], stripTris)).toBeNull();
    expect(digestSeamMeshExact([Number.NaN], [])).toBeNull();
  });

  it('stale gtop1 fails closed and the policy-bound codes are enforced', () => {
    const expectation = deriveGradingTopologyExpectation({
      scope: 'standalone', closed: false, positiveWidthRegions: 1, tiedSplitCoords: [],
    });
    const cert = buildGradingTopologyCertificateExact({
      scope: 'standalone', points: stripPts, triangles: stripTris, expectation,
    })!;
    expect(cert.version).toBe(GRADING_TOPOLOGY_CERTIFICATE_EXACT_VERSION);
    expect(cert.policyVersion).toBe(expectation.policyVersion);
    expect(
      gradingTopologyCertificateExactError(cert, 'standalone', { points: stripPts, triangles: stripTris }),
    ).toBeNull();
    // A stale gtop1 certificate is rejected outright (no migration).
    const legacy = buildGradingTopologyCertificate({
      scope: 'standalone', points: stripPts, triangles: stripTris,
    })!;
    expect(
      gradingTopologyCertificateExactError(legacy, 'standalone', { points: stripPts, triangles: stripTris }),
    ).toBe('GRADING_TOPOLOGY_CERTIFICATE_MISSING');
    // A wrong declaring policy fails closed.
    expect(
      gradingTopologyCertificateExactError(
        { ...cert, policyVersion: '20k0.0' }, 'standalone', { points: stripPts, triangles: stripTris },
      ),
    ).toBe('GRADING_TOPOLOGY_CERTIFICATE_POLICY');
    // A shifted mesh fails the exact digest (the gtop1 false-accept above is closed).
    const shifted = [...stripPts];
    shifted[0] = stripPts[0]! + 1e-9;
    expect(
      gradingTopologyCertificateError(cert, 'standalone', { points: shifted, triangles: stripTris }),
    ).toBe('GRADING_TOPOLOGY_CERTIFICATE_EXACT_DIGEST');
  });
});
