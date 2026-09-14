#!/bin/bash
# Phase 12J.10 §§8-13, 20-23 — real-data ANTEX parity + session-edge matrix.
# EVIDENCE ONLY (local Belgian corpus, never committed).
#
# Production-mirror lineage (mirrors src/engine/gnssRawRnx2rtkp.ts for ANTEX
# jobs): conf carries file-rcvantfile/file-satantfile + ant1/ant2-postype=
# rinexhead + explicit ant*-anttype/antdel from RINEX headers; NO -r flag
# (rnx2rtkp applies -r after -k and would void the postypes). Precise SP3
# primary: pos1-sateph=precise. Flags otherwise frozen: -p 3 -f 2 -m 10
# -sys G -e -t. Subsets built by the PRODUCTION builder via
# scripts/gnss/gnss12j10Subset.ts (exact TYPE+RADOME, GPS-only sats).
#
# Matrix: STAR edges (TGRN/VOER/WERB-WARE) + TGRN-VOER + EIJS-WARE +
# TIT2-VOER + VOER-WERB(manual sample) x days {124,130,137} x windows
# {h00,h06,h12,h18} (reduced for 6-station extras) x {FULL igs20.atx, SUB}.
# Plus: orientation reversals (WARE-TGRN), superset-equivalence (SESS4),
# falsification mutant (MUT, +5 m PCO UP), no-ANTEX legacy control
# (LEGACY, -r marker anchor). Resumable.
# Usage: PAR=2 scripts/gnss/gnss12j10AntexMatrix.sh
set -euo pipefail
CORP=${CORPUS_DIR:-$HOME/Downloads/webnet-gnss-medium/belgian-12j8}
BIN=${RNX2RTKP:-/tmp/rtklib-evidence/app/consapp/rnx2rtkp/gcc/rnx2rtkp}
FULL_ATX=$CORP/igs20.atx
W=$CORP/work12j10
OUT=${OUTDIR:-$W/out}
SUBDIR=${SUBDIR:-$W/subsets}
mkdir -p "$W/nav" "$W/sp3" "$OUT" "$SUBDIR"
PAR=${PAR:-2}
ONLY=${ONLY:-}
D2DATE() { case $1 in 124) echo "2026/05/04";; 130) echo "2026/05/10";; 137) echo "2026/05/17";; esac; }

# Station antenna identities (RINEX header ANT #/TYPE + DELTA, verified).
declare -A ANT=( [WARE]="TRM59800.00 NONE" [TGRN]="LEIAR25.R3 LEIT"
  [VOER]="LEIAR25.R3 LEIT" [WERB]="LEIAR25.R4 LEIT"
  [EIJS]="LEIAR25.R4 LEIT" [TIT2]="LEIAR25.R4 LEIT" )
declare -A DEL=( [WARE]="0.5180" [TGRN]="0.0" [VOER]="0.0" [WERB]="0.0"
  [EIJS]="0.0" [TIT2]="0.0450" )
declare -A FULL=( [WARE]=WARE00BEL [TGRN]=TGRN00BEL [VOER]=VOER00BEL
  [WERB]=WERB00BEL [EIJS]=EIJS00NLD [TIT2]=TIT200DEU )
declare -A KIND=( [WARE]=R [TGRN]=S [VOER]=S [WERB]=R [EIJS]=R [TIT2]=R )
declare -A XYZ=( [WARE]="4031947.1301 370150.7758 4911905.3657"
  [TGRN]="4023470.1812 385846.4845 4917555.1248"
  [VOER]="4022975.3119 402278.5823 4916612.3104"
  [WERB]="4055527.7993 403142.4181 4890387.0011"
  [EIJS]="4023086.533 400394.875 4916655.319"
  [TIT2]="3993787.100 450204.200 4936131.800" )
declare -A SUBS=( [S1]="TRM59800.00 NONE,LEIAR25.R3 LEIT"
  [S2]="TRM59800.00 NONE,LEIAR25.R4 LEIT" [S3]="LEIAR25.R3 LEIT"
  [S4]="LEIAR25.R3 LEIT,LEIAR25.R4 LEIT"
  [SESS4]="TRM59800.00 NONE,LEIAR25.R3 LEIT,LEIAR25.R4 LEIT" )
declare -A LEGSUB=( [TGRN-WARE]=S1 [VOER-WARE]=S1 [WERB-WARE]=S2
  [TGRN-VOER]=S3 [EIJS-WARE]=S2 [TIT2-VOER]=S4 [VOER-WERB]=S4 [WARE-TGRN]=S1 )

# Local working copies of nav/sp3 (corpus stays pristine).
for DOY in 124 130 137; do
  NAV="BRDC00IGS_R_2026${DOY}0000_01D_MN.rnx"
  [ -f "$W/nav/$NAV" ] || cp "$CORP/nav/$NAV" "$W/nav/$NAV"
  [ -f "$W/sp3/$DOY.sp3" ] || gunzip -c "$CORP/sp3/COD0OPSFIN_2026${DOY}0000_01D_05M_ORB.SP3.gz" > "$W/sp3/$DOY.sp3"
done

# Subsets via the PRODUCTION builder + MUT falsification copy + §14 check.
for s in S1 S2 S3 S4 SESS4; do
  out="$SUBDIR/$s.atx"
  if [ -f "$out" ] && [ -s "$out" ]; then echo "SUBSET SKIP $s"; continue; fi
  IFS=',' read -ra SER <<< "${SUBS[$s]}"
  (cd "$(git rev-parse --show-toplevel)" && npx tsx scripts/gnss/gnss12j10Subset.ts "$FULL_ATX" "$out" "${SER[@]}")
done
if [ ! -s "$SUBDIR/MUT.atx" ]; then
  python3 - "$SUBDIR/S1.atx" "$SUBDIR/MUT.atx" <<'PYEOF'
import sys
src, dst = sys.argv[1], sys.argv[2]
lines = open(src).read().split('\n')
out, inblock, hit = [], False, 0
for i, ln in enumerate(lines):
    tag = ln[60:].strip() if len(ln) > 60 else ''
    if tag == 'START OF ANTENNA':
        inblock = ('LEIAR25.R3      LEIT' in lines[i+1][:60])
    if inblock and 'NORTH / EAST / UP' in tag:
        parts = ln[:60].split()
        assert len(parts) == 3, ln
        up = float(parts[2]) + 5000.0
        ln = f"{float(parts[0]):9.2f}{float(parts[1]):9.2f}{up:12.2f}" + ln[60:]
        hit += 1
        inblock = False
    out.append(ln)
assert hit == 1, f'expected 1 PCO patch, got {hit}'
open(dst, 'w').write('TEST-MUTANT-PCV-PLUS-5M-UP-NOT-A-CALIBRATION\n' + '\n'.join(out))
print('MUTANT written, PCO UP +5000mm on LEIAR25.R3 LEIT')
PYEOF
fi
(cd "$(git rev-parse --show-toplevel)" && npx tsx scripts/gnss/gnss12j10Subset.ts "$FULL_ATX" "$SUBDIR/S1-rev.atx" "LEIAR25.R3 LEIT" "TRM59800.00 NONE" > /dev/null)
if cmp -s "$SUBDIR/S1.atx" "$SUBDIR/S1-rev.atx"; then echo 'SUBSET order-invariant: S1 == S1-rev (bytes identical)'
else echo 'SUBSET ORDER VARIANCE DETECTED'; exit 1; fi

RUNNER=$(mktemp -d)/run.sh
cat > "$RUNNER" <<EOF
CORP="$CORP"; BIN="$BIN"; W="$W"; OUT="$OUT"; SUBDIR="$SUBDIR"
declare -A ANT=( [WARE]="TRM59800.00 NONE" [TGRN]="LEIAR25.R3 LEIT"
  [VOER]="LEIAR25.R3 LEIT" [WERB]="LEIAR25.R4 LEIT"
  [EIJS]="LEIAR25.R4 LEIT" [TIT2]="LEIAR25.R4 LEIT" )
declare -A DEL=( [WARE]="0.5180" [TGRN]="0.0" [VOER]="0.0" [WERB]="0.0"
  [EIJS]="0.0" [TIT2]="0.0450" )
declare -A FULL=( [WARE]=WARE00BEL [TGRN]=TGRN00BEL [VOER]=VOER00BEL
  [WERB]=WERB00BEL [EIJS]=EIJS00NLD [TIT2]=TIT200DEU )
declare -A KIND=( [WARE]=R [TGRN]=S [VOER]=S [WERB]=R [EIJS]=R [TIT2]=R )
declare -A XYZ=( [WARE]="4031947.1301 370150.7758 4911905.3657"
  [TGRN]="4023470.1812 385846.4845 4917555.1248"
  [VOER]="4022975.3119 402278.5823 4916612.3104"
  [WERB]="4055527.7993 403142.4181 4890387.0011"
  [EIJS]="4023086.533 400394.875 4916655.319"
  [TIT2]="3993787.100 450204.200 4936131.800" )
declare -A LEGSUB=( [TGRN-WARE]=S1 [VOER-WARE]=S1 [WERB-WARE]=S2
  [TGRN-VOER]=S3 [EIJS-WARE]=S2 [TIT2-VOER]=S4 [VOER-WERB]=S4 [WARE-TGRN]=S1 )
RNX() { echo "\$CORP/rnx/\${FULL[\$1]}_\${KIND[\$1]}_2026\$2""0000_01D_30S_MO.rnx"; }
ATXFOR() { case \$1 in FULL) echo "$FULL_ATX";; SUB) echo "\$SUBDIR/\${LEGSUB[\$2]}.atx";; SESS4) echo "\$SUBDIR/SESS4.atx";; MUT) echo "\$SUBDIR/MUT.atx";; esac; }
run_one() { # rover base doy ts te win variant
  local ROV=\$1 BAS=\$2 DOY=\$3 TS=\$4 TE=\$5 WIN=\$6 VAR=\$7
  local id="\${ROV}-\${BAS}-\${DOY}-\${WIN}-\${VAR}"
  local pos="\$OUT/\$id.pos" conf="\$OUT/\$id.conf"
  if [ -s "\$pos" ] && grep -q "^20[0-9][0-9]/" "\$pos"; then echo "SKIP \$id"; return; fi
  local args=(-p 3 -f 2 -m 10 -e -t -sys G)
  if [ "\$VAR" = "LEGACY" ]; then
    { echo "pos1-sateph=precise"; } > "\$conf"
    args+=(-k "\$conf" -ts \${TS% *} \${TS#* } -te \${TE% *} \${TE#* } -r \${XYZ[\$BAS]})
  else
    local ATX; ATX=\$(ATXFOR "\$VAR" "\${ROV}-\${BAS}")
    { echo "pos1-sateph=precise"; echo "file-rcvantfile=\$ATX"; echo "file-satantfile=\$ATX"
      echo "ant1-postype=rinexhead"; echo "ant2-postype=rinexhead"
      echo "ant1-anttype=\${ANT[\$ROV]}"; echo "ant1-antdele=0.0"; echo "ant1-antdeln=0.0"; echo "ant1-antdelu=\${DEL[\$ROV]}"
      echo "ant2-anttype=\${ANT[\$BAS]}"; echo "ant2-antdele=0.0"; echo "ant2-antdeln=0.0"; echo "ant2-antdelu=\${DEL[\$BAS]}"; } > "\$conf"
    args+=(-k "\$conf" -ts \${TS% *} \${TS#* } -te \${TE% *} \${TE#* })
  fi
  args+=("\$(RNX "\$ROV" "\$DOY")" "\$(RNX "\$BAS" "\$DOY")" "\$W/nav/BRDC00IGS_R_2026\${DOY}0000_01D_MN.rnx" "\$W/sp3/\$DOY.sp3")
  local t0; t0=\$(date +%s)
  "\$BIN" "\${args[@]}" -o "\$pos" 2>"\$OUT/\$id.err"; local rc=\$?
  echo -e "\$id\\t\$(( \$(date +%s) - t0 ))\\t\$rc" >> "\$OUT/times.worker.\$\$.tsv"
  echo "DONE \$id rc=\$rc"
  return \$rc
}
EOF

JOBS=$(mktemp)
{
for DOY in 124 130 137; do DT=$(D2DATE "$DOY")
  for PB in "TGRN WARE" "VOER WARE" "WERB WARE" "TGRN VOER"; do
    ROV=${PB%% *}; BAS=${PB##* }
    for WH in "00:00:00 01:00:00 h00" "06:00:00 07:00:00 h06" "12:00:00 13:00:00 h12" "18:00:00 19:00:00 h18"; do
      set -- $WH
      echo "run_one $ROV $BAS $DOY \"$DT $1\" \"$DT $2\" $3 FULL"
      echo "run_one $ROV $BAS $DOY \"$DT $1\" \"$DT $2\" $3 SUB"
    done
  done
  for PB in "EIJS WARE" "TIT2 VOER" "VOER WERB"; do
    ROV=${PB%% *}; BAS=${PB##* }
    for WH in "00:00:00 01:00:00 h00" "12:00:00 13:00:00 h12"; do
      set -- $WH
      echo "run_one $ROV $BAS $DOY \"$DT $1\" \"$DT $2\" $3 FULL"
      echo "run_one $ROV $BAS $DOY \"$DT $1\" \"$DT $2\" $3 SUB"
    done
  done
  # Gap cover (§20 session matrix): EIJS substitutes WERB where WERB has
  # objective data gaps (130-h18 mid-day gap, 137-h00/h06/h12 partial file).
  for SPEC in "EIJS WARE 130 18:00:00 19:00:00 h18" "EIJS WARE 137 06:00:00 07:00:00 h06" "VOER WERB 137 18:00:00 19:00:00 h18"; do
    set -- $SPEC; ROV=$1; BAS=$2; DOY=$3
    echo "run_one $ROV $BAS $DOY \"$(D2DATE $DOY) $4\" \"$(D2DATE $DOY) $5\" $6 FULL"
    echo "run_one $ROV $BAS $DOY \"$(D2DATE $DOY) $4\" \"$(D2DATE $DOY) $5\" $6 SUB"
  done
  # Orientation reversal (§10): WARE-TGRN mirrors TGRN-WARE h12.
  echo "run_one WARE TGRN $DOY \"$DT 12:00:00\" \"$DT 13:00:00\" h12 SUB"
  # Session-superset equivalence: SESS4 union subset on one STAR edge.
  echo "run_one TGRN WARE $DOY \"$DT 06:00:00\" \"$DT 07:00:00\" h06 SESS4"
done
# Falsification (§11): mutated PCO must move the solution deterministically.
echo "run_one TGRN WARE 130 \"2026/05/10 12:00:00\" \"2026/05/10 13:00:00\" h12 MUT"
# No-ANTEX legacy control (§12): same legs, pre-12J.10 -r lineage.
for PB in "TGRN WARE" "VOER WARE" "WERB WARE"; do
  ROV=${PB%% *}; BAS=${PB##* }
  echo "run_one $ROV $BAS 130 \"2026/05/10 12:00:00\" \"2026/05/10 13:00:00\" h12 LEGACY"
done
# FULL reversal anchor (§10): one FULL WARE-TGRN for SUB-rev comparison.
echo "run_one WARE TGRN 124 \"2026/05/04 12:00:00\" \"2026/05/04 13:00:00\" h12 FULL"
} > "$JOBS"
if [ -n "$ONLY" ]; then
  GREP_ARGS=(); IFS=',' read -ra PATS <<< "$ONLY"
  for p in "${PATS[@]}"; do GREP_ARGS+=(-e "$p"); done
  grep -F "${GREP_ARGS[@]}" "$JOBS" > "$JOBS.f" || true; mv "$JOBS.f" "$JOBS"
fi
echo "jobs: $(wc -l < "$JOBS")"
export RUNNER
rm -f "$OUT"/times.worker.*.tsv
XRC=0
xargs -a "$JOBS" -d '\n' -P "$PAR" -I{} bash -c "source $RUNNER; {}" || XRC=$?
if ls "$OUT"/times.worker.*.tsv >/dev/null 2>&1; then
  cat "$OUT"/times.worker.*.tsv >> "$OUT/times.tsv"
  rm -f "$OUT"/times.worker.*.tsv
fi
touch "$OUT/times.tsv"
sort -u -o "$OUT/times.tsv" "$OUT/times.tsv"
if [ "$XRC" -ne 0 ]; then echo "WORKER_FAILURE rc=$XRC"; exit "$XRC"; fi
echo ALL_DONE
