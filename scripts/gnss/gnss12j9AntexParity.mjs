// Phase 12J.9 Track B — MANUAL full-vs-subset parity helper (never in CI).
//
// If a full igs20.atx plus Belgian WARE/TGRN/VOER/WERB RINEX exist locally,
// this script subsets the full file with the 12J.7 tool for the three
// production combos and prints sizes/hashes for a numerical parity run.
// Otherwise it reports exactly what is missing and exits 0 (skip).
// Never commits vendor data; reads only from ~/Downloads.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DIR = join(homedir(), 'Downloads', 'webnet-gnss-medium', 'belgian-12j8');
const FULL_CANDIDATES = ['igs20.atx', 'igs20_2069.atx', 'igs20_2288.atx'].map((f) => join(DIR, f));
const SUBSET = join(DIR, 'belgian-12j8-subset.atx');
const COMBOS = [
  ['TRM59800.00'],
  ['LEIAR25.R3'],
  ['LEIAR25.R4'],
];
const STATIONS = ['WARE', 'TGRN', 'VOER', 'WERB'];

const sha256File = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

const full = FULL_CANDIDATES.find((p) => existsSync(p));
console.log(`dir=${DIR}`);
console.log(`fullAntex=${full ?? 'MISSING'}`);
console.log(`subsetPresent=${existsSync(SUBSET)}`);
for (const st of STATIONS) {
  const present = execFileSync('bash', ['-c', `ls ${DIR} | grep -c "^${st}" || true`])
    .toString().trim();
  console.log(`rinex_${st}=${present} files`);
}

if (!full) {
  console.log('SKIP: no full igs20.atx in the local corpus; real full-vs-subset parity not possible.');
  if (existsSync(SUBSET)) {
    const buf = readFileSync(SUBSET);
    console.log(`belgianSubset bytes=${buf.byteLength} sha256=${sha256File(SUBSET)}`);
    for (const combo of COMBOS) {
      const out = `/tmp/12j9-${combo[0].replaceAll('.', '_')}.atx`;
      const log = execFileSync('node', [
        'scripts/gnss/gnss12j7AntexSubset.mjs', SUBSET, out, ...combo,
      ]).toString().trim();
      console.log(`resubset ${combo[0]}: ${log.split('\n')[0]}`);
    }
  }
  process.exit(0);
}

// Full corpus present: produce subsets and print parity inputs.
for (const combo of COMBOS) {
  const out = `/tmp/12j9-full-${combo[0].replaceAll('.', '_')}.atx`;
  const log = execFileSync('node', [
    'scripts/gnss/gnss12j7AntexSubset.mjs', full, out, ...combo,
  ]).toString().trim();
  console.log(`full-subset ${combo[0]}: ${log.split('\n')[0]} sha256=${sha256File(out)}`);
}
console.log('READY: stage each subset beside its full run via -k file-rcvantfile/file-satantfile;'
  + ' parity = identical baseline vectors.');
