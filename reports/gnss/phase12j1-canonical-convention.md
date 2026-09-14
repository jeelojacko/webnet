# Phase 12J.1 §7 — Canonical Baseline Convention (EVIDENCE ONLY)

Local-corpus / /tmp-only evidence. No `src/` changes, no vendor bytes committed.

## Recommendation: MARKER-TO-MARKER

The canonical stored baseline is **ΔX = X_marker_B − X_marker_A** (physical
monument to physical monument), with the covariance carried on that same
mark-to-mark vector. All processor-native endpoints (phase-center points,
ARP-level points, command-line base points) are reduced to the markers
before storage, and every reduction applied is recorded per stage (§13).

## Justification (5 lines)

1. The adjustment unknowns are station (marker) coordinates, so the observation
   must connect markers — anything else smuggles antenna height into the geometry.
2. TBC, the parity reference, reports mark-to-mark with NGS Absolute
   calibrations, so parity is only like-for-like under this convention.
3. Raw processors disagree on native endpoints (RTKLIB here: base command-line
   point → rover phase point), so the convention must be processor-independent.
4. Antenna setups change between sessions while markers persist, so only
   mark-to-mark vectors are comparable across occupations.
5. Covariance on the same vector keeps the stochastic model aligned with the
   functional model — no hidden frame/point mismatch in the weight matrix.
