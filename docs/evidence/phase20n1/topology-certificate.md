# Phase 20N.1 — Topology certificate: independent pre-mesh declaration

## Rule

The expected region count (the single merged open strip 1/1/1 for the
admitted group) is declared **before** meshing by `deriveGroupTransitionExpectation` and recorded in the
corpus as expected-vs-measured. After tiling, the measured count must equal
expected before `gtop2` exact revalidation runs. The measured count is
never fed back into the expectation (the circularity flagged in 20N
external review #2 stays fixed).

## Negatives pinned

- **Wrong-budget**: declaring 2 regions where 1 is due fails the gate.
- **Tied-split**: an ambiguous split point fails rather than guessing.
- Both negatives are regression-pinned alongside the positive 2T/3T
  × Distance / relative-elevation / flat-elevation CURRENT cases.

## `gtop2` unchanged

The topology certificate builder and its exact revalidation are untouched;
the group path only adds the pre-gate above. Legacy single-transition
certificates are byte-identical (length-1 routes legacy).

## What this is not

- **20N study**: the study harness proved mesh+gtop2 *could* agree on 2T/3T
  shared-member geometry (116-row corpus, SHA-pinned); 20N.1 wires the
  independent declaration into the production solve (Wave E + Wave J pins
  through the real group kernel, not a harness).
- **Candidate B**: no non-collinear topology is declared or certified.
- **Narrowing**: consecutive-only joints (no sparse) is what makes the
  1/1/1-per-transition budget well-defined for N > 1.
