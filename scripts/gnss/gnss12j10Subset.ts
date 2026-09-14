/**
 * Phase 12J.10 — build a deterministic ANTEX subset with the PRODUCTION
 * builder (src/engine/gnssAntexSubset.ts) for real-data evidence.
 * Usage: npx tsx scripts/gnss/gnss12j10Subset.ts <source.atx> <out.atx> <serial...>
 * Prints JSON: { sourceSha256, subsetSha256, subsetSizeBytes,
 * receiverSerials, satelliteBlockCount }.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { buildAntexSubset } from '../../src/engine/gnssAntexSubset';

const [source, out, ...serials] = process.argv.slice(2);
if (!source || !out || serials.length === 0) {
  console.error('usage: gnss12j10Subset.ts <source.atx> <out.atx> <serial...>');
  process.exit(1);
}
const result = await buildAntexSubset({
  sourceText: readFileSync(source, 'utf8'),
  requiredReceiverSerials: serials,
  validAt: '2026-05-10T00:00:00.000Z',
});
writeFileSync(out, result.subsetBytes);
console.log(JSON.stringify({
  sourceSha256: result.sourceSha256,
  subsetSha256: result.subsetSha256,
  sourceSizeBytes: result.sourceSizeBytes,
  subsetSizeBytes: result.subsetSizeBytes,
  receiverSerials: result.receiverSerials,
  satelliteBlockCount: result.satelliteBlockCount,
  satelliteSystems: result.satelliteSystems,
}));
