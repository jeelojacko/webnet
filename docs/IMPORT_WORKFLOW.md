# Import Workflow

## Purpose
This document describes the external-import pipeline, the staged review workflow, and the reconciliation rules used before imported data is committed into the main WebNet editor.

## Goals
The import workflow is designed to:
- ingest external survey-data formats into a shared normalized model
- preserve source traceability
- let the operator review and reshape imported data before it changes the editor
- support reconciliation against existing editor content
- keep unsupported or ambiguous source content visible through warnings rather than silently dropping context

## Pipeline overview

### 1. Source detection and importer selection
File-load import runs through the shared importer registry in `src/engine/importers.ts`.

The registry detects and dispatches supported sources such as:
- OPUS / OPUS-RS text reports
- JobXML datasets
- industry-style survey-report HTML fallback files
- FieldGenius raw files
- Carlson / TDS RW5-style raw files
- DBX text and XML exports

Each importer converts source content into a normalized imported-data model rather than writing directly to the editor.

### 2. Normalization
Importer output is normalized into a shared control/observation representation used by the staged review workspace.

Normalization aims to preserve:
- point and setup identities
- approximate coordinate content when available
- observation family and setup context
- source-file and source-line traceability
- warning and error notes about unsupported or ambiguous content

### 3. Staged review modal
Supported imports open into a staged review modal before editor mutation.

The staged review surface supports:
- grouped viewing of imported rows
- setup-aware grouping heuristics
- source-type and source-line visibility
- exclude toggles
- editable group comment lines
- staged row editing before import
- direct row duplication and comment insertion
- moving rows within or across setup groups
- creating and renaming custom setup groups
- applying the reviewed import back into the editor
- importing the reviewed output as a new project source file
- importing associated project settings from `.wnproj*` or `.snproj` files

### 4. Output shaping
Before committing to the editor, the operator can choose output-style shaping. Current presets include:
- `Clean WebNet`
- `Field Grouped`
- `TS Direction Set`
- `Industry Style` for opt-in JobXML direct-reading fidelity

For compatible conventional setups, shaping can emit direction-set-style blocks or grouped conventional rows rather than a flat raw import dump.

### 5. Commit to editor
After review, the grouped output is serialized into WebNet text and written to the editor. The committed text is intended to be clean working input rather than a raw source dump.

## Importer-specific behavior

### JobXML and survey-style TS imports
Current total-station-focused import behavior includes:
- reduced-point ingestion for approximate coordinates where available
- setup-context resolution from station and backsight records when resolvable
- support for target approximations from computed-grid style content
- preference for `MeanTurnedAngle` rows where appropriate while still supporting raw-shot review
- skipping deleted shots during conversion
- preserving angle-only vertical-circle content as paired angle and vertical observations when applicable
- preserving JobXML-only raw fieldbook metadata such as round/order, raw horizontal-circle values, raw zenith values, raw EDM distances, corrected slope distances, prism constants, and atmosphere PPM on imported observations so the staged review can optionally emit higher-fidelity direct-reading direction-set text

### Industry-style JobXML shaping
When a `.jxl` / `.jobxml` file is imported, the prompt can opt into `Industry Style`.

That mode currently:
- stays JXL-only and opt-in
- locks the prompt into a fixed raw-fieldbook mode and disables the generic raw/reduced-angle plus face-normalization choices while selected
- preserves the existing generic importer dataset and generic serializer for non-industry-style output
- drives the staged-review output toward round-grouped `DB/DM/DE` blocks
- uses raw horizontal-circle values, corrected slope distances, raw zenith values, and HI/HT from the imported JobXML payload
- preserves JobXML point codes/descriptions plus exact HI/HT provenance for `DM` comments and height tokens
- defaults staged review to exclude `MTA` observations
- suppresses standalone backsight-only blocks and emits `DN` orientation rows when later rounds only re-orient the direction set

### Raw-angle vs reduced-angle selection
When appropriate file types are loaded as main input, the workflow can prompt for:
- `Raw Angles`
- `Reduced Angles (BS = 0)`

Reduced mode is useful when seeding direction-set style shaping during import review.

When `Industry Style` is selected for JobXML, those generic prompt choices are shown but disabled because the fidelity path always preserves the raw fieldbook ordering and direct-reading ingredients.

### 2D conversion support
The staged review workflow supports converting eligible slope-distance + zenith combinations into horizontal-distance-only 2D-style content. That workflow:
- converts eligible SD + zenith rows to HD-only
- strips HI and HT where appropriate
- strips vertical-oriented control/elevation output fields
- forces `.2D` on final imported text

## Review controls and editing behavior

### Row-level controls
The staged review modal supports row-level actions such as:
- include or exclude
- duplicate row
- insert comment after row
- move row within a setup group
- move row to another group
- override final import family for supported measurement rows
- apply fixed toggles that serialize to the correct number of `!` markers for the final row family

### Group-level controls
Group-level behavior includes:
- excluding entire setup groups
- renaming setup groups
- creating empty groups before moving rows into them
- importer-aware grouping labels for setup-style data

### Bulk controls
Current top-level bulk controls include:
- excluding all `MTA` rows
- excluding all raw non-`MTA` rows
- switching comparison modes during review when comparison data is loaded

For JobXML `Industry Style`, `Exclude MTA Obs` defaults to on when the staged review opens.

## Review apply destinations

### Replace editor content
`Import Selected Rows` keeps the existing behavior: it resolves the staged import text and writes it into the current editor workspace.

### Import as new project source file
`Import As New File` resolves the same staged import text but adds it into the current named-project workspace as a new `.dat` file.

Current behavior:
- source names are generated from the imported file name by swapping the extension to `.dat`
- duplicate names use the existing project copy-name helper
- the new file is enabled for run participation by default
- the new file becomes the focused editor tab
- if no named project is open, WebNet first creates a local project from the current untitled workspace, then appends the imported `.dat` file

### Import associated project settings
`Import Associated Project Settings` opens a picker for `.wnproj`, `.wnproj.json`, `.json`, and `.snproj`.

Current behavior:
- `.wnproj*` files reuse the portable-project parser but apply only recognized settings domains, not source-file manifests
- `.snproj` files use a best-effort adapter into the existing WebNet settings model
- when used from staged import review, selecting an associated settings file only stages a prepared payload; it does not close the modal or mutate live settings yet
- the latest selected associated settings file replaces any previously staged payload for that review session
- staged associated settings are applied only after reviewed text import succeeds, for both `Import Selected Rows` and `Import As New File`
- if the reviewed text import fails, staged settings are not applied
- canceling the review discards any staged associated settings
- recognized settings overwrite the live project/workspace settings only at final apply time
- unsupported foreign-only domains are ignored and reported in the import notice
- importing settings does not replace the current project file list

## Reconciliation and conflict handling

### Editor-content scan
While staged import is open, the workflow scans current editor content for deterministic conflicts such as:
- exact station-ID collisions
- coordinate conflicts
- description conflicts
- control-state conflicts
- duplicate observation-family buckets by canonical endpoints

Conflicting staged rows are highlighted in the review surface.

### Resolution choices
Current per-conflict resolution choices include:
- keep existing
- replace with incoming
- rename incoming
- keep both

Important behaviors:
- renamed-station resolutions cascade through staged imported rows
- `keep both` emits explicit markers into the final merged text
- reconciled imports preserve existing include-file bundles rather than clearing them

### Multi-source reconciliation
Additional external files can be loaded into the same review workspace so the operator can reconcile across multiple sources instead of doing simple count-only side comparisons.

Current multi-source behavior includes:
- retaining source-file metadata per staged row and group
- showing mismatch summaries across setup-target-family buckets
- highlighting staged rows whose bucket differs from comparison sources
- emitting deterministic source separators when multiple sources are committed together
- persisting in-progress reconciliation state through browser-local draft recovery

## Traceability expectations
The import workflow should preserve enough information to answer:
- what source file produced this staged row
- what source line or source bucket it came from
- whether a row was excluded, reshaped, renamed, fixed, or reconciled
- which warnings or unsupported-content notes were encountered during import

Traceability should stay operator-visible during review even when final committed text is intentionally cleaner than the raw importer output.

## Persistence behavior
Open import-review and reconciliation sessions persist through browser-local draft recovery until the session is applied or cancelled.

This persistence includes:
- staged rows and group structure
- resolution choices
- compare and reconciliation state
- source metadata needed to continue the review session

## Validation guidance
When changing import behavior, prefer focused coverage for:
- importer detection
- normalized imported-row shaping
- setup grouping behavior
- staged edit controls
- reconciliation conflict detection
- conflict-resolution cascades
- final serialization into WebNet text

Also update:
- `docs/CURRENT_BEHAVIOR.md` if the supported import surface changed
- `docs/ARCHITECTURE.md` if the workflow boundaries moved
