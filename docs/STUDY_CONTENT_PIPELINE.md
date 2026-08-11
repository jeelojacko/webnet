# Study Content Pipeline

## NB SIT Statute Corpus

Phase 4A introduces the New Brunswick SIT statute-law corpus manifest:

```text
study-content/manifests/nb-sit-statute-corpus.json
```

The exam-scope authority is the ANBLS Surveyor-in-Training manual inventory supplied for the B-5.2 Statute Law of New Brunswick examination. The legal-text authority is the official Government of New Brunswick `laws.gnb.ca` source only. The pipeline must not substitute successor or related legislation when the manual names a repealed or unresolved Act.

The manifest records all 57 required manual Act entries and preserves the ten pilot documents. The five existing pilot regulations remain the only required regulations until more are explicitly approved. Other regulations discovered under required Acts are candidates for review and are not silently imported into the required Study corpus.

Current manifest source gaps are deliberate inventory blockers:

- `doc-ecological-reserves-act`
- `doc-health-act`
- `doc-new-brunswick-land-surveyors-act`
- `doc-official-languages-of-new-brunswick-act`
- `doc-public-utilities-act`

These entries remain required by exam scope but have no confirmed official `laws.gnb.ca` source URL in the manifest. Corpus fetch/build commands fail early until those sources are confirmed.

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

## Import Boundary

The corpus package uses the existing official-content package shape consumed by `/study/manage`. Import preview and source-review behavior remain browser-side Study concerns. Phase 4A stops at official legal source ingestion, validation, packaging, and import readiness; full-corpus deterministic StudyUnit generation is reserved for Phase 4B.
