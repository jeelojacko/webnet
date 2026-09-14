# Phase 12J.1 — RTKLIB Pin Record (EVIDENCE ONLY)

Batch A §4. Local-corpus / /tmp-only evidence. No `src/` changes, no vendor
bytes committed, no third-party source vendored.

## Pin

- Source: `/tmp/rtklib-evidence` (rtklibexplorer/RTKLIB fork of Tomoji Takasu's RTKLIB)
- Commit: `62d4677ed8425a4e2748c6d390b500d1afb493fc` — verified via
  `git rev-parse HEAD` immediately before the Batch A rebuild
- Version string: binary self-reports `rnx2rtkp ver.EX 2.5.1`
  (first `.pos` header line: `% program : rnx2rtkp ver.EX 2.5.1`)
- Local patch: NONE — `git diff` empty for all tracked files; only
  untracked build artifacts (`*.o`, `rnx2rtkp`, `build-warnings.txt`) exist
  under `app/consapp/rnx2rtkp/gcc/`, all in /tmp only

## Compiler + flags

- Compiler: `gcc (GCC) 16.2.1 20260810`
- CFLAGS (from `app/consapp/rnx2rtkp/gcc/makefile`, active block):
  `-std=c99 -Wall -O3 -pedantic -Wno-unused-but-set-variable -I$(SRC)`
  with OPTS `-DTRACE -DENAGLO -DENAQZS -DENAGAL -DENACMP -DENAIRN -DNFREQ=4 -DNEXOBS=3`
- LDLIBS: `-lgfortran -lm` (no LAPACK/MKL)
- Build: `make clean && make` in the gcc dir — exit 0, binary 1,144,640 B
- Warnings: 7, all benign (`-Wunused-variable` in ppp.c/preceph.c/rtcm3.c,
  one `-Wstringop-truncation` strncpy in preceph.c) — same class as §19

## S32 broadcast rerun ×3 (Batch A rebuild, §3)

Command (corpus read from `~/Downloads/webnet-gnss-12e/raw-baselines/` only):

`rnx2rtkp -p 3 -f 2 -m 15 -sys G -v 3.0 -ti 30 -ts 2006/06/14 17:24:30
-te 2006/06/14 18:10:30 -e -t -o s32_runN.pos
-r -1283634.1259 -4726427.8882 4074798.0251
01241653.06o p0411650_2.06o 01241653.06n p0411650_2.06n`

| Run | Status | Rover XYZ (m) | Vector dX/dY/dZ (m) | Ratio | Epochs | Formal σ (mm) | Wall/RSS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | FIX | −1277811.8854 −4732084.2271 4069953.2161 | +5822.2405 −5656.3389 −4844.8090 | 28.6 | 90/93 Q=1, 3 Q=2 | 0.6/1.1/1.0 | 0.08 s / 9.9 MB |
| 2 | FIX | identical | identical | 28.6 | identical | identical | 0.08 s / 10.0 MB |
| 3 | FIX | identical | identical | 28.6 | identical | identical | 0.08 s / 10.0 MB |

Determinism verdict: PASS — `cmp run1 run2` and `cmp run2 run3` clean
(byte-identical, 0.0 mm variation). Output SHA-256:
`d667c751…53ab43`. Results reproduce the §19 oracle exactly
(same FIX 90/93, ratio 28.6, vector, covariance).

## S32 input hashes (§1 record)

- `01241653.06o`: `fc20f5ff…06677aa`
- `01241653.06n`: `5050ebf5…67a4328f`
- `p0411650_2.06o`: `e60ee2a1…86e96d079`
- `p0411650_2.06n`: `655e431f…5cf8c613e`
- Full 112-file inventory: run
  `npx tsx scripts/gnss/gnss12j1CorpusInventory.ts [--json]`

## Occupation freeze (§2 record)

20/20 mains + 16/16 `*a` alternates present — run
`npx tsx scripts/gnss/gnss12j1OccupationMap.ts` (exits non-zero if any missing).
`*a.06o` = decimated 30 s GPS-only companions, never independent occupations.
