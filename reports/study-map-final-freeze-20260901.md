# Study Map Final Freeze Report — ai-map-2026-08-29T12-23-57-891Z-local-qwen-full-20260829-181342

Generated: 2026-09-02T00:38:16.484Z

## Scope

Final post-QC human adjudications for the canonical local-Qwen Study Map production run: 135 priority-only rebases and 9 grouping corrections, driven by the verified FINAL-CANDIDATE decision file and applied through the standard adjudication path (per-job provenance, reconstructed labeled source run, deterministic verification).

## Inputs

- Decision file: `temp/study-ai-final-map-review/chatgpt-post-qc-map-review-decisions-FINAL-CANDIDATE.json`
- Decision file SHA-256: `f31f8012d941871e745932e6501f7cd4a3192bca25f7c6178db65e2a94b946d8`
- Correction artifacts: `temp/study-ai-final-map-review/corrections/`
- Labeled source run: `study-content/ai/runs/final-map-qc-adjudications-20260901-src/`
- Pre-adjudication snapshot: `ai-map-2026-08-29T12-23-57-891Z-local-qwen-full-20260829-181342/reports/final-map-qc-snapshot-20260901/`

## Decisions (211)

| Classification | Count |
| --- | --- |
| no-change | 67 |
| priority-only-adjudicable | 135 |
| requires-corrected-map-result | 9 |
| invalid | 0 |

## Adjudication

- Planned jobs: 144 — adjudicated 144, failed 0.
- Canonical results after the batch: 3692 rows, 0 invalid (full validator re-run).
- Every affected job has exactly one result row; all unaffected rows are byte-identical to the snapshot.

## Grouping corrections (9)

| Job | Provision | Decision (grouping / priority) | Final | Groups |
| --- | --- | --- | --- | --- |
| map-10ff468d35d10873 | Registry Act · 71 | split / keep | split @ P3 | 2 |
| map-19c48590a1b233de | Clean Water Act · 40 | split / change → P3 | split @ P3 | 3 |
| map-445b7c242fa7ca8e | Clean Water Act · 13 | split / change → P3 | split @ P3 | 4 |
| map-48b1a91a069cabde | Trespass Act · 1 | split / change → P2 | split @ P2 | 2 |
| map-52353c0c8b64b6d3 | Crown Lands and Forests Act · 95 | split / keep | split @ P3 | 3 |
| map-7c48e28797b91624 | Registry Act · 66 | standalone / change → P3 | standalone @ P3 | 1 |
| map-8860d90d22aae7ed | Public Health Act · 68 | split / change → P4 | split @ P4 | 3 |
| map-d1fadd2dfd0ce395 | Aquaculture Act · 90 | split / keep | split @ P3 | 2 |
| map-d747c4a97d7161d3 | Service New Brunswick Act · 56 | skip / keep | skip @ null | 0 |

## Final state

- Result rows: 3692
- Priority distribution: P1 175, P2 1458, P3 1054, P4 284, null 721
- Pinned anchors: all 4 found
  - Clean Water Act s.40: resolved-grouped (was a zero-group suspect).
  - Partnerships Act s.2: detected (operative-scope).
  - Service New Brunswick Act s.69: detected (operative-scope).
  - Aquaculture Act s.90: resolved-grouped (was a broad standalone anchor).

## Post-QC audit (regenerated)

- Zero-group suspects: 25
- P1 export: 175 (core-surveying-licensing 90, cadastral-property-registration-planning 74, adjacent-general-law 11)
- Broad standalone: 31; large splits: 138
- File: `ai-map-2026-08-29T12-23-57-891Z-local-qwen-full-20260829-181342/reports/post-qc-semantic-audit-20260831.json` (SHA-256 `19c8ca793e38ca4e…`)

## Regenerated reports

- `ai-map-2026-08-29T12-23-57-891Z-local-qwen-full-20260829-181342/reports/post-qc-semantic-audit-20260831.json` — SHA-256 `19c8ca793e38ca4e3a0006be8e990c0f23690c63cb475b5367ae320c40135de1`
- `ai-map-2026-08-29T12-23-57-891Z-local-qwen-full-20260829-181342/reports/post-qc-adjacent-p1-review-20260831.json` — SHA-256 `b91888eeeb0cc1494b6268d59ab5c4a04f9e4dbde3e9adffc72eb1d6fc040d6c`
- `ai-map-2026-08-29T12-23-57-891Z-local-qwen-full-20260829-181342/reports/post-qc-broad-group-review-20260831.json` — SHA-256 `c9b127a5ecacb7c025302d1b73d6867e502c12214f57922676dd28bc647c4ca7`
- `ai-map-2026-08-29T12-23-57-891Z-local-qwen-full-20260829-181342/reports/review-decision-preview.json` — SHA-256 `2f9cea7cf064d4095c72801596ac144dd34c94b78580bf444de8fd38138301a0`
- `ai-map-2026-08-29T12-23-57-891Z-local-qwen-full-20260829-181342/reports/map-proposals.json` — SHA-256 `b2726e8eae321a8d3a104520def8f0ab20abcf925ffdc1f4f2949ed0c7ff194e`
- `ai-map-2026-08-29T12-23-57-891Z-local-qwen-full-20260829-181342/reports/validation.json` — SHA-256 `fc3c74f6bf6510628dd98ef9ea08b4cb5819b94cf2d3c8aebda911d9cc6004a9`

## Validation

```
npx tsx scripts/studyAiAuthoring.ts validate-results --run ai-map-2026-08-29T12-23-57-891Z-local-qwen-full-20260829-181342
Validated 3692 results for ai-map-2026-08-29T12-23-57-891Z-local-qwen-full-20260829-181342; invalid 0
```
