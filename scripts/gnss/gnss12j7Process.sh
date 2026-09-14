#!/bin/bash
# Phase 12J.7 Stage 2 — medium-baseline processing driver (EVIDENCE ONLY).
# Frozen policy: GPS-only L1/L2 STATIC FIXED, 10-deg mask, MARKER_TO_MARKER_ECEF,
# exact ANTEX subset, precise SP3 primary + bounded broadcast comparison.
# Flags: -p 3 -f 2 -m 10 -sys G -e -t + -k conf (pos1-sateph=precise for prec),
# file-rcvantfile/file-satantfile=subset, ant2-postype=rinexhead.
# Gotcha honored: -r (base marker ECEF) comes AFTER -k on the command line.
# Two-arg -ts/-te. Resumable: existing .pos files are skipped.
# Usage: PAR=2 scripts/gnss/gnss12j7Process.sh   (PAR=1 for serial timing)
set -euo pipefail
CORP=${CORPUS_DIR:-$HOME/Downloads/webnet-gnss-medium/belgian}
BIN=${RNX2RTKP:-/tmp/rtklib-evidence/app/consapp/rnx2rtkp/gcc/rnx2rtkp}
ATX=$CORP/belgian-subset.atx
W=$CORP/work12j7
OUT=$W/out
mkdir -p "$W/nav" "$W/sp3" "$OUT"
PAR=${PAR:-2}
OUT=${OUTDIR:-$W/out}
ONLY=${ONLY:-}
mkdir -p "$OUT"
D2DATE() { case $1 in 124) echo "2026/05/04";; 125) echo "2026/05/05";; 126) echo "2026/05/06";; 127) echo "2026/05/07";; 128) echo "2026/05/08";; esac; }

RUNNER=$(mktemp -d)/run.sh
cat > "$RUNNER" <<EOF
CORP="$CORP"; BIN="$BIN"; ATX="$ATX"; W="$W"; OUT="$OUT"
# DOY127: stage-1 ade31270.26n.Z parses as RINEX but yields zero solutions in this
# RTKLIB build (relative AND single-point); replaced by the IGS merged daily
# BRDC from BKG (same product class, documented in the report).
declare -A NAVMAP=( [124]=zimm1240.26n [125]=zimm1250.26n [126]=zimm1260.26n [127]=BRDC00IGS_R_20261270000_01D_MN.rnx [128]=zimm1280.26n )
BRDC127_URL="https://igs.bkg.bund.de/root_ftp/IGS/BRDC/2026/127/BRDC00IGS_R_20261270000_01D_MN.rnx.gz"
declare -A XYZ=( [WARE]="4031947.1301 370150.7758 4911905.3657"
  [TGRN]="4023470.1812 385846.4845 4917555.1248"
  [VOER]="4022975.3119 402278.5823 4916612.3104"
  [WERB]="4055527.7993 403142.4181 4890387.0011" )
declare -A ANT=( [WARE]="TRM59800.00 NONE" [TGRN]="LEIAR25.R3 LEIT"
  [VOER]="LEIAR25.R3 LEIT" [WERB]="LEIAR25.R4 LEIT" )
declare -A DEL=( [WARE]="0.5180" [TGRN]="0.0" [VOER]="0.0" [WERB]="0.0" )
declare -A KIND=( [WARE]=R [TGRN]=S [VOER]=S [WERB]=R )
declare -A FULL=( [WARE]=WARE00BEL [TGRN]=TGRN00BEL [VOER]=VOER00BEL [WERB]=WERB00BEL )
D2DATE() { case \$1 in 124) echo "2026/05/04";; 125) echo "2026/05/05";; 126) echo "2026/05/06";; 127) echo "2026/05/07";; 128) echo "2026/05/08";; esac; }
RNX() { echo "\$CORP/rnx/\${FULL[\$1]}_\${KIND[\$1]}_2026\$2""0000_01D_30S_MO.rnx"; }
run_one() { # rover base doy eph ts te tag (ts/te empty = full day)
  local ROV=\$1 BAS=\$2 DOY=\$3 EPH=\$4 TS=\$5 TE=\$6 TAG=\$7
  local id="\${ROV}-\${BAS}-\${DOY}-\${TAG}-\${EPH}"
  local pos="\$OUT/\$id.pos"
  local conf="\$OUT/\$id.conf"
  # Re-run incomplete/failed outputs: skip only if .pos exists, is non-empty,
  # and holds solution epochs (lines starting with a year). Mere existence
  # (e.g. header-only .pos from a failed run) does NOT skip.
  if [ -s "\$pos" ] && grep -q "^20[0-9][0-9]/" "\$pos"; then echo "SKIP \$id"; return; fi
  { echo "ant1-anttype=\${ANT[\$ROV]}"; echo "ant1-antdele=0.0"; echo "ant1-antdeln=0.0"; echo "ant1-antdelu=\${DEL[\$ROV]}"
    echo "ant2-anttype=\${ANT[\$BAS]}"; echo "ant2-antdele=0.0"; echo "ant2-antdeln=0.0"; echo "ant2-antdelu=\${DEL[\$BAS]}"
    echo "ant2-postype=rinexhead"; echo "file-rcvantfile=\$ATX"; echo "file-satantfile=\$ATX"
    [ "\$EPH" = "prec" ] && echo "pos1-sateph=precise"; } > "\$conf"
  local args=(-p 3 -f 2 -m 10 -e -t -sys G -k "\$conf")
  if [ -n "\$TS" ]; then args+=(-ts \${TS% *} \${TS#* } -te \${TE% *} \${TE#* }); fi
  args+=(-r \${XYZ[\$BAS]} "\$(RNX "\$ROV" "\$DOY")" "\$(RNX "\$BAS" "\$DOY")" "\$W/nav/\${NAVMAP[\$DOY]}")
  [ "\$EPH" = "prec" ] && args+=("\$W/sp3/\$DOY.sp3")
  local t0; t0=\$(date +%s)
  "\$BIN" "\${args[@]}" -o "\$pos" 2>"\$OUT/\$id.err"; local rc=\$?
  # Per-worker timing files (PID-suffixed) merged sorted after xargs,
  # so concurrent appends stay deterministic.
  echo -e "\$id\\t\$(( \$(date +%s) - t0 ))\\t\$rc" >> "\$OUT/times.worker.\$\$.tsv"
  echo "DONE \$id rc=\$rc"
}
EOF

# local working copies of nav/sp3 (corpus stays pristine)
# shellcheck disable=SC1090
source <(grep "declare -A NAVMAP" "$RUNNER")
for DOY in 124 125 126 127 128; do
  if [ -f "$CORP/nav/${NAVMAP[$DOY]}.Z" ]; then
    [ -f "$W/nav/${NAVMAP[$DOY]}" ] || uncompress -c "$CORP/nav/${NAVMAP[$DOY]}.Z" > "$W/nav/${NAVMAP[$DOY]}"
  elif [ "$DOY" = "127" ]; then
    if [ ! -f "$W/nav/${NAVMAP[$DOY]}" ]; then
      curl -s --max-time 120 -o "$W/nav/${NAVMAP[$DOY]}.gz" "$BRDC127_URL" && gunzip -f "$W/nav/${NAVMAP[$DOY]}.gz"
    fi
    [ -f "$W/nav/${NAVMAP[$DOY]}" ] || { echo "MISSING DOY127 BRDC nav"; exit 1; }
  fi
  [ -f "$W/sp3/$DOY.sp3" ] || gunzip -c "$CORP/sp3/COD0OPSFIN_2026${DOY}0000_01D_05M_ORB.SP3.gz" > "$W/sp3/$DOY.sp3"
done

JOBS=$(mktemp)
{
for DOY in 124 125 126 127 128; do DT=$(D2DATE "$DOY")
  for PB in "TGRN WARE" "VOER WARE" "WERB WARE" "TGRN VOER" "VOER WERB" "TGRN WERB"; do
    ROV=${PB%% *}; BAS=${PB##* }
    for WH in "00:00:00 01:00:00 h00" "06:00:00 07:00:00 h06" "12:00:00 13:00:00 h12" "18:00:00 19:00:00 h18"; do
      set -- $WH; echo "run_one $ROV $BAS $DOY prec \"$DT $1\" \"$DT $2\" $3"
    done
  done
  for PB in "TGRN WARE" "VOER WARE" "WERB WARE"; do
    ROV=${PB%% *}; BAS=${PB##* }
    for WH in "00:00:00 01:00:00 h00" "12:00:00 13:00:00 h12"; do
      set -- $WH; echo "run_one $ROV $BAS $DOY brdc \"$DT $1\" \"$DT $2\" $3"
    done
    echo "run_one $ROV $BAS $DOY prec \"$DT 00:00:00\" \"$DT 00:30:00\" m00"
    echo "run_one $ROV $BAS $DOY prec \"$DT 12:00:00\" \"$DT 12:30:00\" m12"
    echo "run_one $ROV $BAS $DOY prec \"$DT 00:00:00\" \"$DT 02:00:00\" w00"
    echo "run_one $ROV $BAS $DOY prec \"\" \"\" day"
  done
done
} > "$JOBS"
if [ -n "$ONLY" ]; then grep -F "$ONLY" "$JOBS" > "$JOBS.f" || true; mv "$JOBS.f" "$JOBS"; fi
echo "jobs: $(wc -l < "$JOBS")"
# shellcheck disable=SC1090
export RUNNER
rm -f "$OUT"/times.worker.*.tsv
# Fail closed: no ALL_DONE after worker failure (xargs rc propagates).
XRC=0
xargs -a "$JOBS" -d '\n' -P "$PAR" -I{} bash -c "source $RUNNER; {}" || XRC=$?
if ls "$OUT"/times.worker.*.tsv >/dev/null 2>&1; then
  cat "$OUT"/times.worker.*.tsv >> "$OUT/times.tsv"
  rm -f "$OUT"/times.worker.*.tsv
fi
# Timing records always deterministic: sorted + deduped, even on all-SKIP runs.
sort -u -o "$OUT/times.tsv" "$OUT/times.tsv"
if [ "$XRC" -ne 0 ]; then echo "WORKER_FAILURE rc=$XRC"; exit "$XRC"; fi
echo ALL_DONE
