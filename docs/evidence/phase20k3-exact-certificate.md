# Phase 20K.3 — `gtop2` exact binary topology certificate

Status: **IMPLEMENTATION COMPLETE on branch
`fix/phase20k3-surface-curve-authority-certificate`, baseline `884b36e8` =
PR #143 merge.**

## 1. The defect it closes (Wave A2 RED)

The 20K.2 `gtop1` digest hashed `Number#toPrecision(12)` text (FNV-1a,
32-bit). Twelve significant digits round a sub-quantum delta away, so two
different coordinates produced the **same text, the same FNV digest, and —
through the certificate — a product FALSE-ACCEPT**: a mesh whose geometry had
changed kept its certificate.

The recorded collision table (`tests/cad_grading_certificate_exact_20k3.test.ts`,
via the perf harness):

| magnitude | delta | same `toPrecision(12)` text | same digest |
|---|---|---|---|
| 100 | 1e-9 | no | no |
| 2e6 | 1e-6 | **yes** | **yes** |
| 7e6 | 1e-6 | **yes** | **yes** |
| 1e8 | 1e-4 | **yes** | **yes** |
| 3e8 | 1e-4 | **yes** | **yes** |

Minimum pin at stress magnitude: `100000000` and `100000000.0001` both render
`'100000000.000'` and share the mesh + seam digest. The `100 / 100.000000001`
pair does **not** collide (the delta is exactly one 12-digit quantum at 10^2);
the suite records it as a non-collision so the bug is not overstated.

## 2. The `gtop2` encoding

`buildGradingTopologyCertificateExact` (`src/engine/cad/grading/gradingTopologyCertificate.ts`,
`GRADING_TOPOLOGY_CERTIFICATE_EXACT_VERSION = 'gtop2'`):

- **Tag** `'gtop2\0'` + scope byte (`0x73` standalone / `0x67` group).
- **Header** carries the declaration: length-prefixed `policyVersion`
  (`20k3.1`), `expectedFaceComponents`, `expectedBoundaryCycles`,
  `positiveWidthRegionCount`.
- **Every coordinate** is serialized as exact IEEE-754 **Float64 bits**,
  little-endian, via `DataView.setFloat64`. `-0` is canonicalized to `+0`
  (`value === 0 ? 0 : value`); NaN and ±Infinity are rejected (`null`, never a
  certificate).
- **Every index** is a validated `uint32` (integer, `0 <= i <= 0xffffffff`).
- **Sections are length-prefixed and tagged** (`0x70` coords, `0x74` tris,
  `0x69` tied coords, `0x63` standalone coordinate buffer) with an explicit
  element count per section, so `[12,3]` and `[1,23]` can never collide and a
  value can never migrate across a section boundary.
- The whole payload is hashed with **SHA-256** (256-bit).

Three SHA-256 digests are produced: `meshDigest`, `sourceBoundaryDigest`,
`gradingBoundaryDigest`; the certificate also records the measured topology
(`components`, `boundaryCycles`, `boundaryEdges`, sorted `cycleSizes`),
`tiedSplitCoords`, `positiveWidthRegionCount`, and the expected budget.

Construction **requires** an explicit expectation. A missing expectation, a
policy mismatch, a scope mismatch, a standalone closed declaration, or an
observed topology that differs from the declared budget all return `null`
(fail closed, never self-certified).

## 3. Revalidation is fail-closed and policy-bound

`gradingTopologyCertificateExactError` rebuilds every digest from the presented
buffers and reruns topology against the certificate's **expected** budget.
Codes:

| condition | code |
|---|---|
| absent / `gtop1` | `GRADING_TOPOLOGY_CERTIFICATE_MISSING` |
| scope mismatch | `GRADING_TOPOLOGY_CERTIFICATE_SCOPE` |
| policy/violated budget fields | `GRADING_TOPOLOGY_CERTIFICATE_POLICY` |
| rebuild fails | `GRADING_TOPOLOGY_CERTIFICATE_TOPOLOGY:rebuild:failed` |
| mesh bits differ | `GRADING_TOPOLOGY_CERTIFICATE_EXACT_DIGEST` |
| boundary bits differ | `GRADING_TOPOLOGY_CERTIFICATE_BOUNDARY_DIGEST` |
| measured ≠ declared components | `GRADING_TOPOLOGY_CERTIFICATE_EXPECTED_COMPONENTS` |
| measured ≠ declared cycles | `GRADING_TOPOLOGY_CERTIFICATE_EXPECTED_CYCLES` |
| boundary edge count differs | `GRADING_TOPOLOGY_CERTIFICATE_BOUNDARY_EDGES` |
| cycle sizes differ | `GRADING_TOPOLOGY_CERTIFICATE_EXPECTED_CYCLES` |

A stale `gtop1` certificate is rejected outright — **no migration**. The 20K.2
`gtop1` builder/reader remain for backward-compatible unit coverage only;
production Calculate emits `gtop2`.

## 4. Exactness proof (perf harness, measured)

| mesh | digest bytes txt/bin | hash ms gtop1/gtop2 | gtop1 FNV | gtop2 SHA-256 | cert ms gtop1/gtop2 |
|---|---|---|---|---|---|
| square.all-Surface | 6753 / 4608 | 0.081 / 0.257 | `470d161e` | `13325eaa89530a26…` | 0.962 / 0.831 |
| tied-split.arc | 519 / 360 | 0.006 / 0.023 | `5e897190` | `3fda6349a94981a0…` | 0.170 / 0.105 |

Exactness probe at projected/stress magnitude (quad at E=1e8 shifted +1e-4 m):

```text
gtop1 collision=true (same FNV digest), gtop2 diverges=true
```

The shift is below the 12-significant-digit quantum, so `gtop1` cannot see it;
`gtop2` hashes the exact Float64 bits and the digests differ. Revalidation of
the shifted mesh against the base certificate returns
`GRADING_TOPOLOGY_CERTIFICATE_EXACT_DIGEST`. Cost is ~2–4× the legacy text
digest and remains sub-millisecond on the 128-face square (perf doc §3).

## 5. Product path

The `gtop2` certificate is produced only after final assembly, from the
authoritative buffers; it is session-only and is never persisted or folded into
`grev1:` / `ggrev1:`. Product availability derives from
`gradingTopologyCertificateExactError` (§Wave E1 capability doc); a stale,
forged, or mismatched certificate yields no command and zero mutation.

## 6. Provenance

- `src/engine/cad/grading/gradingTopologyCertificate.ts`.
- `tests/cad_grading_certificate_exact_20k3.test.ts` (12).
- `scripts/phase20k3SurfaceAuthorityPerf.ts` §3–4.
- `docs/evidence/phase20k3-surface-authority-performance.md`.
