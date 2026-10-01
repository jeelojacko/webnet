/**
 * Phase 20K.2 Worker B — GradingTopologyCertificate contract.
 *
 * The certificate is the worker's session-only, deterministic record of the
 * final assembled mesh topology. These unit rows pin: the additive shape
 * (gtop1), determinism, tied-split recording, and fail-closed product
 * revalidation (missing / scope / forged digest / topology mismatch).
 */
import { describe, expect, it } from 'vitest';

import {
  GRADING_TOPOLOGY_CERTIFICATE_VERSION,
  buildGradingTopologyCertificate,
  collectTiedRunStarts,
  countPositiveWidthRegions,
  digestTopologyMesh,
  gradingTopologyCertificateError,
} from '../src/engine/cad/grading/gradingTopologyCertificate';

const stripPts = [0, 0, 0, 10, 0, 0, 10, 2, 0, 0, 2, 0];
const stripTris = [0, 1, 2, 0, 2, 3];

// Two disjoint quads: a legitimate tied split (each side positive width).
const tiedPts = [...stripPts, 20, 20, 0, 30, 20, 0, 30, 22, 0, 20, 22, 0];
const tiedTris = [...stripTris, 4, 5, 6, 4, 6, 7];

const buildStrip = () =>
  buildGradingTopologyCertificate({
    scope: 'standalone',
    points: stripPts,
    triangles: stripTris,
    tiedSplitCoords: [],
    sourceBoundaryPoints: [0, 0, 0, 10, 0, 0],
    gradingBoundaryPoints: [0, 2, 0, 10, 2, 0],
  });

describe('GradingTopologyCertificate shape', () => {
  it('records the final mesh topology once, deterministically', () => {
    const a = buildStrip();
    const b = buildStrip();
    expect(a).not.toBeNull();
    expect(a).toEqual(b);
    expect(a).toMatchObject({
      version: GRADING_TOPOLOGY_CERTIFICATE_VERSION,
      scope: 'standalone',
      components: 1,
      boundaryCycles: 1,
      boundaryEdges: 4,
      tiedSplitCoords: [],
      positiveWidthRegionCount: 1,
    });
    expect(a!.meshDigest).toBe(digestTopologyMesh(stripPts, stripTris));
    expect(a!.meshDigest).not.toBe(a!.sourceBoundaryDigest);
  });

  it('records a tied split with its real tied station and both cycles', () => {
    const cert = buildGradingTopologyCertificate({
      scope: 'standalone',
      points: tiedPts,
      triangles: tiedTris,
      tiedSplitCoords: [20, 20, 0],
      expectedComponents: 1,
      sourceBoundaryPoints: [],
      gradingBoundaryPoints: [],
    });
    expect(cert).toMatchObject({
      components: 2,
      boundaryCycles: 2,
      tiedSplitCoords: [20, 20, 0],
      positiveWidthRegionCount: 1,
    });
    // Product revalidation consumes the recorded station; no guessing.
    expect(
      gradingTopologyCertificateError(cert ?? undefined, 'standalone', {
        points: tiedPts,
        triangles: tiedTris,
      }),
    ).toBeNull();
  });

  it('empty mesh certifies as zero topology; malformed meshes never certify', () => {
    const empty = buildGradingTopologyCertificate({
      scope: 'standalone', points: [], triangles: [],
    });
    expect(empty).toMatchObject({ components: 0, boundaryCycles: 0, boundaryEdges: 0 });
    // Folded/double-covered faces collapse to zero components: no certificate.
    const folded = buildGradingTopologyCertificate({
      scope: 'standalone',
      points: [0, 0, 0, 4, 0, 0, 1, 1, 0, 3, 1, 0],
      triangles: [0, 1, 2, 0, 1, 3],
    });
    expect(folded).toBeNull();
  });
});

describe('certificate product revalidation fails closed', () => {
  it('missing certificate blocks a nonempty mesh', () => {
    expect(
      gradingTopologyCertificateError(undefined, 'standalone', { points: stripPts, triangles: stripTris }),
    ).toBe('GRADING_TOPOLOGY_CERTIFICATE_MISSING');
  });

  it('scope mismatch blocks', () => {
    const cert = buildStrip()!;
    expect(
      gradingTopologyCertificateError(cert, 'group', { points: stripPts, triangles: stripTris }),
    ).toBe('GRADING_TOPOLOGY_CERTIFICATE_SCOPE');
  });

  it('forged mesh swap is caught by the digest', () => {
    const cert = buildStrip()!;
    // Mesh swapped to a different (still valid) mesh while keeping the cert.
    expect(
      gradingTopologyCertificateError(cert, 'standalone', { points: tiedPts, triangles: tiedTris }),
    ).toBe('GRADING_TOPOLOGY_CERTIFICATE_DIGEST');
    // Splice on a pinched mesh whose digest matches an attacker-rewritten cert
    // is still rejected by the recorded topology check.
    const pinchedPts = [0, 0, 0, 1, 0, 0, 1, 1, 0, -1, 0, 0, -1, -1, 0];
    const pinchedTris = [0, 1, 2, 0, 3, 4];
    const forged = { ...cert, meshDigest: digestTopologyMesh(pinchedPts, pinchedTris) };
    const issue = gradingTopologyCertificateError(forged, 'standalone', {
      points: pinchedPts,
      triangles: pinchedTris,
    });
    expect(issue).toContain('GRADING_TOPOLOGY_CERTIFICATE_TOPOLOGY');
  });

  it('empty mesh needs no certificate', () => {
    expect(gradingTopologyCertificateError(undefined, 'standalone', { points: [], triangles: [] })).toBeNull();
  });

  it('forged components 2→1 on a valid two-region tied mesh fails closed', () => {
    const cert = buildGradingTopologyCertificate({
      scope: 'standalone',
      points: tiedPts,
      triangles: tiedTris,
      tiedSplitCoords: [20, 20, 0],
      expectedComponents: 1,
    })!;
    expect(cert.components).toBe(2);
    // Attacker rewrites both the measured components and the expected
    // positive-width regions down to 1 so the mesh would look exportable.
    const forged = { ...cert, components: 1, positiveWidthRegionCount: 1 };
    expect(
      gradingTopologyCertificateError(forged, 'standalone', { points: tiedPts, triangles: tiedTris }),
    ).toBe('GRADING_TOPOLOGY_CERTIFICATE_COMPONENTS');
  });

  it('tampered boundary edges are re-derived and rejected', () => {
    const cert = buildStrip()!;
    expect(
      gradingTopologyCertificateError(
        { ...cert, boundaryEdges: cert.boundaryEdges + 1 },
        'standalone',
        { points: stripPts, triangles: stripTris },
      ),
    ).toBe('GRADING_TOPOLOGY_CERTIFICATE_BOUNDARY_EDGES');
  });

  it('tampered boundary cycles are re-derived and rejected', () => {
    const cert = buildStrip()!;
    const issue = gradingTopologyCertificateError(
      { ...cert, boundaryCycles: cert.boundaryCycles + 1 },
      'standalone',
      { points: stripPts, triangles: stripTris },
    );
    expect(issue).not.toBeNull();
    expect(issue).toContain('GRADING_TOPOLOGY_CERTIFICATE');
  });

  it('a forged boundary polyline fails the product digest', () => {
    const cert = buildGradingTopologyCertificate({
      scope: 'standalone',
      points: stripPts,
      triangles: stripTris,
      sourceBoundaryPoints: [0, 0, 0, 10, 0, 0],
      gradingBoundaryPoints: [0, 2, 0, 10, 2, 0],
    })!;
    expect(
      gradingTopologyCertificateError(
        cert,
        'standalone',
        { points: stripPts, triangles: stripTris },
        { sourceBoundaryPoints: [0, 0, 0, 10, 0, 0], gradingBoundaryPoints: [0, 2, 0, 10, 2, 0] },
      ),
    ).toBeNull();
    expect(
      gradingTopologyCertificateError(
        cert,
        'standalone',
        { points: stripPts, triangles: stripTris },
        { sourceBoundaryPoints: [0, 0, 0, 10, 0, 0], gradingBoundaryPoints: [0, 2, 0, 99, 2, 0] },
      ),
    ).toBe('GRADING_TOPOLOGY_CERTIFICATE_BOUNDARY_DIGEST');
  });
});

describe('tied-run helpers', () => {
  it('collects plan-tied run starts once', () => {
    const source = [
      { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }, { x: 30, y: 0, z: 0 },
    ];
    const daylight = [
      { x: 0, y: 5, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }, { x: 30, y: 5, z: 0 },
    ];
    expect(collectTiedRunStarts(source, daylight)).toEqual([10, 0, 0]);
    // One zero-width cell in the middle: two positive-width regions.
    expect(countPositiveWidthRegions(source, daylight)).toBe(2);
  });

  it('an open strip with no ties is one positive-width region', () => {
    const source = [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }];
    const daylight = [{ x: 0, y: 5, z: 0 }, { x: 10, y: 5, z: 0 }];
    expect(collectTiedRunStarts(source, daylight)).toEqual([]);
    expect(countPositiveWidthRegions(source, daylight)).toBe(1);
  });
});
