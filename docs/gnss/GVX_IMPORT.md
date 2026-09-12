# GVX 1.0 Import (Phase 12E0 prep)

Vendor-neutral standards prep only. Parses the open GVX 1.0 element set
into the canonical Phase 12B observation (ECEF metres / m²). No
reference-frame transforms, no datum invention, no TBC-specific code, no
TBC parity claim.

Modules: `src/engine/gnssGvxXml.ts` (secure XML scanner),
`src/engine/gnssGvxSyntax.ts` (raw document + frame resolution),
`src/engine/gnssGvxImport.ts` (canonicalize + validate).
Entry points: `parseGvx(text, sourceFile?)`, `importGnssBaselineGvx(text,
sourceFile?)`, both returning `{ network, diagnostics, source }` and
never throwing for document problems.

## Why a hand-written scanner (no new dependency)

`package.json` carries no XML dependency, and none was added. The intake
uses a ~250-line purpose-built scanner (`gnssGvxXml.ts`) instead of
`DOMParser` (browser-only; tests and scripts run in Node) because:

- zero new dependencies, browser+Node-safe pure string scanning;
- structural handling of nesting/comments/PIs instead of regex XML
  parsing (regex XML parsing is banned for this intake);
- fail-closed XXE posture: `<!...>` declarations (DOCTYPE/ENTITY) are
  rejected, exactly the 5 predefined entities (`&amp;` `&lt;` `&gt;`
  `&quot;` `&apos;`) are decoded in text/attribute values (§Entity
  policy), every other `&...;` fails, no external
  references are followed, input is bounded (16 MiB / 200k nodes /
  depth 64 / 32 attrs per tag);
- deterministic errors with 1-based line numbers and XML-path context.

Revisit only if GVX intake outgrows elements-plus-text (mixed content,
namespaces); that would be a new intake phase, not a patch.

## Field map

| GVX field | Disposition | Notes |
|---|---|---|
| `GVX/@VERSION` | DIRECT (gate) | Must be `"1.0"`; anything else (incl. missing) is `GNSS_GVX_UNSUPPORTED_VERSION`, fail closed |
| `GNSS_VECTOR/ID` | DIRECT | `solutionId` + `baselineCode`; duplicate IDs are a hard error |
| `INITIAL_POINT_ID` / `TERMINAL_POINT_ID` | DIRECT | `from` / `to`; unknown marks are `GNSS_GVX_UNKNOWN_MARK` |
| `ECEF_DELTAS/DX\|DY\|DZ` | DIRECT | Observed vector, metres, applied as-is (see Orientation) |
| `CORRELATION_MATRIX/SDX\|SDY\|SDZ\|PXY\|PXZ\|PYZ` | CONVERSION | Reconstructed to full covariance (see below); validated by shared `validateGnssBaselineCovariance`, no repair/jitter |
| `POINT/ID` | DIRECT | Station key; first-seen document order |
| `POINT/NAME` | DIRECT (label) | Kept as mark label only; never enters math |
| `POINT/COORDINATES/REFERENCE_SYSTEM_ID` | DIRECT (gate) | Single frame required (see Frame) |
| `POINT/COORDINATES/EPOCH` | DIRECT (gate) | Single epoch required when present |
| `GEOCENTRIC_COORDINATES/X\|Y\|Z` | DIRECT | Initial coordinates, metres; missing block is a hard error (no geodetic fallback) |
| `OBSERVATION_TIME/*`, `QUALITY_CONTROL/*`, `EQUIPMENT/*`, `SURVEY_SETUP/*`, `SOURCE_DATA`, `PROJECT_INFORMATION` | IGNORED | Non-math extension metadata; one aggregated `GNSS_GVX_IGNORED_METADATA` warning listing element names |
| `GEODETIC_COORDINATES`, `CORRELATION_MATRIX_LOCAL`, `ARP_HEIGHT`, `EQUIPMENT_ID`, `POINT_TYPE` | IGNORED | Same warning surface as above |
| Orbit `REFERENCE_SYSTEM` (e.g. 153/IGS14) | DEFERRED | Recorded in `source.orbitFrame` for provenance; never frame-matched (see Frame) |
| `SESSION` / repeated-pair merging | DEFERRED | Not in the observed samples; repeated endpoints are kept as independent solutions with a warning, never deduplicated |

## Covariance reconstruction

```
Cxx = SDX²   Cyy = SDY²   Czz = SDZ²
Cxy = PXY·SDX·SDY   Cxz = PXZ·SDX·SDZ   Cyz = PYZ·SDY·SDZ
```

Order is asserted by the covariance-order gate test with distinct
per-axis SD/P values, so an XY↔XZ or XZ↔YZ swap fails. Non-finite
inputs, non-positive stddevs, and non-positive-definite matrices are
`GNSS_GVX_BAD_COVARIANCE` (strict Cholesky via the shared validator).

## Orientation

`b_obs = X_TO − X_FROM`: `DX/DY/DZ` run mark-to-mark from
`INITIAL_POINT_ID` to `TERMINAL_POINT_ID` and are stored directly as the
canonical `vector`. The orientation test pins this including the
reversed-endpoint (negated vector) case.

## Units

Metres / m² only, single canonicalization (scale 1). The point frame's
`LINEAR_UNIT` must read metres (case-insensitive); anything else is
`GNSS_GVX_FRAME_UNSUPPORTED`. No mm/cm path exists for GVX.

## Frame

`GnssFrameMetadata` is `{ vectorFrame: 'ecef', referenceFrame: <point
frame NAME>, epoch: <point EPOCH> }`. Rules:

- All `POINT`s must share one `REFERENCE_SYSTEM_ID`, and it must resolve
  to a defined `REFERENCE_SYSTEM`; mixed frames, unknown IDs, or mixed
  epochs are `GNSS_GVX_FRAME_UNSUPPORTED` (no transforms are performed).
- The orbit frame (e.g. 153/IGS14 on `QUALITY_CONTROL/.../ORBIT`) is
  provenance only and MUST NOT false-mismatch the point frame
  (126/NAD 83(2011) in all observed samples).

## Endpoint policy

- Endpoints enter as FREE initial coordinates in first-seen `POINT`
  document order. They are never marked FIXED: datum control is fixed
  downstream by the operator.
- A-priori consistency: duplicate `POINT` IDs that agree within 1 µm
  keep first-seen coordinates silently; larger disagreements keep
  first-seen order with a warning diagnostic. `source.aprioriMaxMisclosureM`
  records the max |a-priori TO−FROM minus observed| over vectors
  (evidence script audits it; ~5e-9 m on all observed samples).
- No dedup by endpoints: vector identity is the vector `ID` (plus
  document position). Repeated endpoint pairs yield a
  `GNSS_GVX_REPEATED_BASELINE` warning and stay distinct.

## Versioning

Only `VERSION="1.0"` is accepted. Any other value, or a missing
attribute, fails closed with `GNSS_GVX_UNSUPPORTED_VERSION`. There is no
best-effort or version-sniffing path.

## Entity policy (§4 audit decision: IMPLEMENTED)

Audit confirmed the prep posture (any `<!...>` declaration rejected,
any `&` rejected) and then relaxed exactly one point, judged low-risk
because it stays inside the bounded single-pass scanner with no DTD,
no external reads, and no recursive expansion:

- Decoded: exactly the 5 predefined XML entities (`&amp;` `&lt;`
  `&gt;` `&quot;` `&apos;`) in text and attribute values, single pass
  (so `&amp;amp;` yields the literal `&amp;`, never double-decoded).
- Still hard errors (`GNSS_GVX_BAD_XML`): DOCTYPE/ENTITY/NOTATION (any
  `<!...>`), custom entities (`&foo;`), numeric entities (`&#65;`,
  `&#x41;`), unterminated/bare `&`, forbidden entities in attribute
  values. External `SYSTEM`/`PUBLIC` references can only occur inside
  the already-rejected declarations, so XXE/billion-laughs stay
  unreachable.
- CDATA sections stay literal (never entity-decoded), per XML.
- Pinned by `gvx XML security` tests: 5-entity decode (scanner +
  import level), custom/numeric/unterminated/bare-`&` rejection,
  attribute-value rejection, CDATA literalness, DOCTYPE/XXE rejection.

## TBC intake helper (§13, local-only)

`scripts/gnss/gvxTbcIntake.ts` (manual-only, never in any test tier)
takes a `.gvx` path — or, with no args, sweeps
`~/Downloads/webnet-gnss-12e/tbc-intake/` (missing/empty dir exits 0
with guidance, so CI can never fail on it) — and prints inventory
(vectors/stations/frame/epoch/components/a-priori), covariance
validation, whether explicit fixed control is still required, and a
canonical JSON summary line. Adjustment runs ONLY with an explicit
`--control <path>` file (`{ "fixed": ["ID", ...] }`, fixed at
a-priori coordinates); without it the script states control is still
required and never auto-chooses a datum. Unknown control IDs are
rejected; partially-controlled networks report the solver's datum
error instead of crashing.

## Error codes
All codes carry XML-path context (`GVX/GNSS_VECTOR[3]/...`) plus line
numbers where the scanner tracks them:

- `GNSS_GVX_BAD_XML` — malformed XML, hostile declarations/entities,
  structural violations (bad root, duplicates, self-baseline at import,
  missing non-math-required structure).
- `GNSS_GVX_UNSUPPORTED_VERSION` — version gate.
- `GNSS_GVX_MISSING_VECTOR_COMPONENT` — missing `ECEF_DELTAS` or
  `CORRELATION_MATRIX` block. (A missing DX/DY/DZ/SDX/… leaf inside a
  present block is `GNSS_GVX_BAD_XML`, via the vector-level catch.)
- `GNSS_GVX_BAD_COVARIANCE` — stochastic validation failure.
- `GNSS_GVX_UNKNOWN_MARK` — vector references an undefined `POINT`.
- `GNSS_GVX_FRAME_UNSUPPORTED` — mixed/unknown/non-metre frame or epoch.
- `GNSS_GVX_IGNORED_METADATA` (warning) — ignored extension elements.
- `GNSS_GVX_REPEATED_BASELINE` (warning) — repeated endpoint pairs.
