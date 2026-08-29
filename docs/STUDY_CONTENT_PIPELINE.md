# Study Content Pipeline

## NB SIT Statute Corpus

Phase 4A introduces the New Brunswick SIT statute-law corpus manifest:

```text
study-content/manifests/nb-sit-statute-corpus.json
```

The exam-scope authority is the ANBLS Surveyor-in-Training manual inventory supplied for the B-5.2 Statute Law of New Brunswick examination. The legal-text authority is the official Government of New Brunswick `laws.gnb.ca` source for public legislation, plus ANBLS-hosted professional-body PDF sources for the New Brunswick Land Surveyors Act, 1986 and Bylaws. The pipeline must not substitute successor or related legislation when the manual names a repealed or unresolved Act.

The manifest records all 57 required manual Act entries and preserves the ten pilot documents. Manual entries are now distinct from unique current legal source documents because several old SIT manual entries name repealed legislation. Legacy entries may map to a current successor without duplicating successor content.

The current successor mappings are:

- `Ecological Reserves Act & Regulations` -> `Protected Natural Areas Act`
- `Health Act & Regulations` -> `Public Health Act`
- `Official Languages of New Brunswick Act & Regulations` -> `Official Languages Act`
- `Public Utilities Act` -> `Energy and Utilities Board Act`

The `New Brunswick Land Surveyors Act, 1986 and Bylaws` manual entry is split into two ANBLS-hosted professional-body PDF sources: the 1986 Act PDF and the Bylaws PDF. These PDFs are fetched and hashed as raw official/professional sources. Their bilingual side-by-side text is normalized from the left-side English column only; OCR is not used.

## Commands

The full-corpus commands are stage-oriented:

```bash
npm run study:corpus:inventory
npm run study:corpus:fetch
npm run study:corpus:normalize
npm run study:corpus:validate
npm run study:corpus:build
npm run study:corpus:refresh
```

`study:corpus:refresh` runs inventory validation, fetch, normalize, integrity validation, package build, and reports. It does not generate StudyUnits and does not touch FSRS scheduling.

Fetch supports:

```bash
npm run study:corpus:fetch -- --force
npm run study:corpus:fetch -- --document doc-surveys-act
```

Inventory can refresh candidate-regulation discovery from the official title index:

```bash
npm run study:corpus:inventory -- --discover-regulations
```

## Outputs

Raw source snapshots are written under:

```text
study-content/raw/nb-sit/
```

Normalized documents are written under:

```text
study-content/normalized/nb-sit/
```

The package path is:

```text
study-content/packages/nb-sit-statute-corpus.content-package.json
```

Reports include:

```text
study-content/reports/nb-sit-corpus-inventory.json
study-content/reports/nb-sit-corpus-inventory.md
study-content/reports/nb-sit-regulation-candidates.md
study-content/reports/nb-sit-fetch-status.json
study-content/reports/nb-sit-integrity-report.json
study-content/reports/nb-sit-integrity-report.md
study-content/reports/nb-sit-coverage.csv
study-content/reports/nb-sit-coverage.md
study-content/reports/nb-sit-source-changes.json
study-content/reports/nb-sit-source-changes.md
study-content/reports/nb-sit-source-review-queue.md
```

Component hashes are deterministic SHA-256 hashes of normalized component text. Corpus metadata also records manifest hash, corpus content hash, fetch pipeline version, normalizer version, and package schema version. Generated timestamps are report/package metadata and are excluded from component hashes.

Supplemental components (schedules, forms) are located at their exact matched text offsets, and both section-text trimming and component ordering use those recorded offsets. Earlier code re-derived supplemental positions with a first-occurrence `indexOf` on the component label text, so one-line form entries such as `Form 3` anchored at an earlier inline mention inside a section (for example Regulation 83-130 s.7, `…Certificate of Title in Form 3.`) and truncated the section mid-sentence; the 2026-08-29 fix carries the exact offsets through normalization, restores the previously truncated section tails in Regulation 83-130 (sections 7, 10, 11, 19.1, 19.2, 20, 21.1), and is locked by a regression test. Because prepared Map job IDs are content-addressed over the job payload, repaired section text changes the affected job IDs and requires re-preparing jobs from the rebuilt package (`study:corpus:build`) — the per-document `sourceHash` and corpus-level content hash are raw-fetch hashes and do not change.

PDF raw hashes are SHA-256 hashes of the PDF bytes. The Node-only corpus pipeline uses `pdfjs-dist` for positioned embedded PDF text extraction so bilingual side-by-side sources can select the English column; this dependency is isolated to development-side source ingestion and is not used by normal browser Study runtime.

Legacy-source reporting is written to:

```text
study-content/reports/nb-sit-legacy-sources.md
```

## Import Boundary

The corpus package uses the existing official-content package shape consumed by `/study/manage`. Import preview and source-review behavior remain browser-side Study concerns. Phase 4A validates import readiness through a pure full-corpus dry-run and identical reimport/idempotency test; full-corpus deterministic StudyUnit generation is reserved for Phase 4B.
