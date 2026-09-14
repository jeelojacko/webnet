# Phase 12J.1 §11 — Frame Contract (EVIDENCE ONLY)

Local-corpus / /tmp-only evidence. No `src/` changes, no vendor bytes committed.

## Rule

A baseline vector NEVER inherits a frame label from its project, its
datasheet, or its comparison reference. Each processing leg carries its own
`referenceFrame` + `epoch` from its ephemeris/algorithm; alignment to the
project frame happens endpoint-wise in the adapter/session stage.

## Justified frame labels for S32 legs

| Leg | Ephemeris | Label | Why |
| --- | --------- | ----- | --- |
| Broadcast | `01241653.06n` + `p0411650_2.06n` broadcast | WGS84(G1150)-class broadcast frame, epoch 2006-06-14 | 2006 broadcast ephemeris era (§16); WGS84(G1150) was current |
| SP3 | `igl13793.sp3`, `IGb00` label, GPS week 1379 | IGb00, epoch 2006-06-14 | Product's own label; rapid product, 900 s spacing |
| TBC B32 | Precise ephemeris, project NAD 1983 (Conus) | Project frame (TBC-internal) | TBC product, frame-consistent with GVX by construction (§18) |

Broadcast vs SP3 legs measured identical to 0.1 mm (§19), so the frame
difference between WGS84(G1150)-class and IGb00 is sub-mm on this
baseline — but the labels stay distinct by provenance, never merged.

**Forbidden:** labeling any raw RTKLIB ECEF vector NAD83(2011) or
NAD83(Conus) by inheritance. The 1.4589 m P041 header-vs-datasheet offset
is the visible cost of mixing frames (§16, §10).

## Transform math (proven by the §12 oracle, synthetic test)

Endpoint-wise: `A_t = f(A_s)`, `B_t = f(B_s)`, `d_t = B_t − A_t`,
`C_t = J_d C_s J_d^T`. Oracle results: translation-invariance error 0.0 m,
affine-map error 8.2e-10 m, covariance trace ratio 1.00000003 —
`J_d·d_s` reproduces endpoint differencing exactly for affine `f`, and the
error budget propagates intact. Run:
`npx tsx scripts/gnss/gnss12j1FrameTransform.ts`.
