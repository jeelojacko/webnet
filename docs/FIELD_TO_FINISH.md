# Field-to-Finish (F2F)

Vendor-neutral field coding -> linework/points pipeline. Calculations stay in
meters and radians internally; unit conversion happens only at parse, import,
export, or display boundaries.

## Feature code vs description

`ImportedFeatureMetadata` keeps them distinct:

- `rawCodeText` / `codes[]` carry the field coding (canonical `code` plus the
  verbatim `rawCode` token, role, optional multi-code `instance`, controls).
- `description` carries the human note (e.g. "Trail edge").
- `attributes` carries key/value field attributes (e.g. `surface=asphalt`).

Importers preserve the raw text; matching resolves canonical codes downstream.
Observation serialization omits descriptions, so WebNet text/numeric output is
unchanged by code/description normalization.

## Catalog model

`FeatureCodeCatalog` (`src/engine/fieldToFinish/featureCatalog.ts`) scopes to
layer/style/symbol/label/linework only — no legal or ownership fields. Each
`FeatureDefinition` sets a layer, point behavior (`point` | `none`), linework
behavior (`enabled`, `implicitContinuation`), and optional
`defaultAttributes`. JSON export/import with schema versioning lives in
`catalogIo.ts`; round-trips preserve semantic identity (same canonical codes,
aliases, layers, behaviors). A generic sample catalog
(`sampleCatalog.ts`: CONTROL, MONUMENT, EDGE, CENTERLINE, BUILDING, TREE,
UTILITY) backs fixtures and tests; ROCK is deliberately absent to exercise the
unmapped path.

## Matching and aliases

`codeMatching.ts`: exact-token matching only. Canonical form is trimmed text,
case-insensitive by default; `EP` never matches `EP2`. Catalogs are indexed
once by canonical code/alias to definition id (first wins on collision, O(1)
lookup). The sample catalog ships one alias (`EP` -> `EDGE`). Control-token
aliasing is separate: vendor profiles in `catalogIo.ts` map short tokens
(e.g. `B` -> BEGIN, `CLS` -> CLOSE) to canonical `FieldLineworkControl`
values; the core stores canonical values only.

## Unknown codes

Unknown field codes resolve to UNMAPPED. They are preserved
(`unmappedPointIds`, raw text kept) and never discarded; no geometry is
invented for them.

## Controls, instances, order, implicit continuation

`linework.ts` generates chains deterministically in authoritative source order
(sequence number, never point-id/coordinate/hash order):

- BEGIN starts a chain, CONTINUE adds a vertex, END terminates, CLOSE closes
  back to the start vertex; BREAK terminates the open chain before the
  current point.
- Multi-code instances keep separate chains per (code, instance).
- A bare code token (no control) continues the open chain only when the
  catalog enables implicit continuation for that code (sample: CENTERLINE);
  otherwise it is ignored for linework.
- Malformed coding (END/CLOSE without BEGIN, duplicate BEGIN, unterminated
  chains) yields per-chain warn/fail diagnostics naming the source
  record/point. Unterminated chains keep only observed vertices — closure is
  never invented. No curve fitting.

## Regeneration: generated vs manual

Linework output is a pure function of (coded points in source order, catalog):
rerunning generation on the same inputs yields identical chains and
diagnostics, so regeneration is safe to repeat. Diagnostics — not silent
geometry — are the record of malformed coding. Manual edits live outside the
generated result; regenerating after a catalog or coding fix replaces the
generated chains deterministically. (CAD-side generated-vs-manual layering is
owned by the CAD generation worker; this contract is what it must preserve.)

## Adjustment to F2F

Adjusted coordinates feed F2F as coordinate-only points: the adjustment solves
positions, F2F codes them. F2F never changes adjustment math or tolerances —
it consumes point positions plus their `ImportedFeatureMetadata` and applies
catalog matching and linework generation only.

## Coordinate-only points

Points without codes carry no `feature` (or empty `codes[]`). They are
preserved as positions, skipped by linework generation, and never reported as
unmapped.

## CSV units and CRS

`terrestrialCsvImport.ts`: header-driven coordinate CSV (Point/ID + Northing
+ Easting required; Elevation, Code, Description, Note optional). Units come
from an explicit caller-supplied parameter (`m`/`mm`/`cm`/`ft`/`usft`) and are
never inferred from magnitudes. CRS is recorded, never transformed.
Northing/Easting are never swapped. Includes a Trimble Access preset plus
manual column mapping and row/field bounds. The F2F sample fixture
(`tests/fixtures/f2f_fxl_sample.csv`) follows the same convention: meters,
`Code` holds `CODE [CONTROL]`, `Description` the note, `Attributes` holds
`k=v;...` pairs.

## Vendor boundary

The core consumes only the neutral catalog and neutral metadata. Every vendor
format enters through a thin adapter owned by F2F:

- `fxlAdapter.ts`: Trimble FXL -> catalog. Verdict **FXL_SUPPORTED_SUBSET**.
- FLD: **FLD_DEFERRED** — no adapter exists (see below).

## FXL verdict: SUPPORTED SUBSET

`parseFxlLibrary` converts PointFeatureDefinition -> point definitions and
LineFeatureDefinition -> linework-enabled definitions; Attributes
(String/Integer/Double/List with EntryMethod/DefaultValue) ->
`defaultAttributes`; Name -> code, Description (else Name) -> description.
Layers are derived deterministically (`F2F-<CODE>`). Bounds: file size,
definition count, and field lengths are capped; over-cap input fails or drops
with an issue, never silently. Unknown elements are ignored with a warning.
SchemaVersion above 9 is rejected (`FXL_UNSUPPORTED`). The file header carries
the verdict line `FXL_SUPPORTED_SUBSET`.

## FLD verdict: DEFERRED

No FLD adapter is provided. Reason: the FLD code/attribute grammar (inline
control tokens, enum encodings, attribute syntax) is undocumented, so any
mapping would be guesswork that risks mis-coding field data. FLD support stays
deferred until a documented grammar or reference corpus exists; do not hand-roll
an FLD parser from samples alone.
