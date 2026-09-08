/**
 * Assemble the Phase 9A committed reports from shard raw fragments.
 *
 * Reads artifacts/evidence/phase9a/*.json (written by the evidence shards),
 * merges them via the pure scripts/phase9a/phase9aReport.ts assembly, and
 * writes reports/phase9a/. No workers, no WASM, no numerics — this step is
 * report rendering only. Exits 0 with no output change when no fragments
 * exist (so non-Phase-9A evidence runs are unaffected).
 */
import {
  assemblePhase9aEvidence,
  isPhase9aSkipped,
  PHASE9A_REQUIRED_EVIDENCE_KEYS,
  readPhase9aFragments,
  resolvePhase9aShas,
  writePhase9aReports,
} from './phase9aReport';

const fragments = readPhase9aFragments();
if (Object.keys(fragments).length === 0) {
  console.log('phase9a: no fragments, skipping report assembly');
} else {
  const missing = PHASE9A_REQUIRED_EVIDENCE_KEYS.filter((key) => !(key in fragments));
  if (missing.length > 0) {
    console.error(`phase9a: incomplete fragments; report not assembled. Missing: ${missing.join(', ')}`);
    process.exitCode = 2;
  } else {
    const shas = resolvePhase9aShas(process.env);
    const wasmPresent = !isPhase9aSkipped(fragments);
    const { jsonPath, mdPath } = writePhase9aReports(assemblePhase9aEvidence(fragments, shas, wasmPresent));
    console.log(`phase9a: report assembled (${jsonPath}, ${mdPath})`);
  }
}
