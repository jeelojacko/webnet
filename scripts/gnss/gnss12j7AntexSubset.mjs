// Phase 12J.7 Stage 1 — EVIDENCE ONLY. Deterministic ANTEX subset extractor.
//
// Keeps: file header + receiver blocks whose TYPE matches a wanted prefix +
// ALL satellite blocks. Byte-deterministic: no timestamps, LF joins, single
// trailing-newline policy inherited from source split (unchanged here).
// Prints: blocks_total/kept/sat/rcv/bytes/sha256. No new dependencies.
//
// Usage: node scripts/gnss/gnss12j7AntexSubset.mjs <srcAtx> <dstAtx> <wantedTypes...>
// Example: node scripts/gnss/gnss12j7AntexSubset.mjs /tmp/igs20.atx out.atx TRM59800.00 LEIAR25.R3 LEIAR25.R4
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const [, , src, dst, ...wanted] = process.argv;
if (!src || !dst || wanted.length === 0) {
  console.error('usage: gnss12j7AntexSubset.mjs <srcAtx> <dstAtx> <wantedTypes...>');
  process.exit(2);
}

const tag = (line) => (line.length > 60 ? line.slice(60).trim() : '');
const serialOf = (block) => {
  for (const line of block) {
    if (line.length > 60 && line.slice(60).trim().startsWith('TYPE / SERIAL')) {
      return line.slice(0, 60).trim();
    }
  }
  return '';
};
const SAT = /^[GREJCIS]\d{2}$/;
const isSat = (serial) => {
  const toks = serial.split(/\s+/);
  return toks.length > 1 && toks[0] === 'BLOCK' && toks.slice(1).some((t) => SAT.test(t));
};

const lines = readFileSync(src, 'utf8').split('\n');
const header = [];
const blocks = [];
let cur = null;
for (const line of lines) {
  const t = tag(line);
  if (t === 'START OF ANTENNA') cur = [line];
  else if (t === 'END OF ANTENNA') {
    cur.push(line);
    blocks.push(cur);
    cur = null;
  } else if (cur) cur.push(line);
  else if (blocks.length === 0) header.push(line);
}
const lastEnd = lines.findLastIndex((line) => tag(line) === 'END OF ANTENNA');
const footer = lastEnd >= 0 ? lines.slice(lastEnd + 1) : [];

const kept = [];
let sat = 0;
const rcv = [];
for (const block of blocks) {
  const serial = serialOf(block);
  if (!serial) continue;
  if (isSat(serial)) {
    kept.push(block);
    sat += 1;
  } else if (wanted.includes(serial.split(/\s+/)[0])) {
    kept.push(block);
    rcv.push(serial);
  }
}

const out = [...header, ...kept.flat(), ...footer].join('\n');
writeFileSync(dst, out);
const bytes = Buffer.byteLength(out);
const sha256 = createHash('sha256').update(out, 'utf8').digest('hex');
console.log(
  `blocks_total=${blocks.length} kept=${kept.length} sat=${sat} rcv=${rcv.length} bytes=${bytes} sha256=${sha256}`,
);
for (const r of rcv) console.log(`RCV: ${r}`);
