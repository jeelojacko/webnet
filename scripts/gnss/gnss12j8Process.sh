#!/bin/bash
# Phase 12J.8 Stage 2a — 15-day baseline processing matrix (EVIDENCE ONLY).
# Clone of gnss12j7Process.sh retargeted to CORP=belgian-12j8, OUT=work12j8.
# Frozen policy: GPS-only L1/L2 STATIC FIXED, 10-deg mask, MARKER_TO_MARKER_ECEF,
# exact subset ANTEX, precise SP3 primary + bounded broadcast comparison.
# Flags: -p 3 -f 2 -m 10 -sys G -e -t + -k conf (pos1-sateph=precise for prec),
# file-rcvantfile/file-satantfile=subset, ant2-postype=rinexhead.
# Gotcha honored: -r (base marker ECEF) comes AFTER -k on the command line.
# Two-arg -ts/-te. Resumable: complete .pos files (with solution epochs) skip.
# Antenna/DEL (sitelog §4 current @2026 + RINEX header cross-check):
#   WARE TRM59800.00 NONE delU 0.5180 (12J.7 table)
#   TGRN/VOER LEIAR25.R3 LEIT 0.0; WERB LEIAR25.R4 LEIT 0.0 (12J.7 table)
#   EIJS LEIAR25.R4 LEIT 0.0 (sitelog 4.4 current, header: 726690/0.0000)
#   TIT2 LEIAR25.R4 LEIT delU 0.0450 = marker->ARP (sitelog 4.3 current,
#     header DELTA H 0.0450; 12J.7 DEL convention: antdelu = marker->ARP)
# Marker XYZ: 12J.7 table for WARE/TGRN/VOER/WERB; EIJS/TIT2 from sitelog §2
# approximate position (marker coords, NOT ARP; ARP reached via DEL above).
# KNOWN: WERB DOY133-136 missing upstream — those legs skipped (documented).
# Usage: PAR=2 scripts/gnss/gnss12j8Process.sh   (PAR=1 for serial timing)
set -euo pipefail
CORP=${CORPUS_DIR:-$HOME/Downloads/webnet-gnss-medium/belgian-12j8}
BIN=${RNX2RTKP:-/tmp/rtklib-evidence/app/consapp/rnx2rtkp/gcc/rnx2rtkp}
ATX=$CORP/belgian-12j8-subset.atx
W=$CORP/work12j8
OUT=${OUTDIR:-$W/out}
mkdir -p "$W/nav" "$W/sp3" "$OUT"
PAR=${PAR:-2}
ONLY=${ONLY:-}
D2DATE() { case $1 in 124) echo "2026/05/04";; 125) echo "2026/05/05";; 126) echo "2026/05/06";;
  127) echo "2026/05/07";; 128) echo "2026/05/08";; 129) echo "2026/05/09";; 130) echo "2026/05/10";;
  131) echo "2026/05/11";; 132) echo "2026/05/12";; 133) echo "2026/05/13";; 134) echo "2026/05/14";;
  135) echo "2026/05/15";; 136) echo "2026/05/16";; 137) echo "2026/05/17";; 138) echo "2026/05/18";; esac; }

RUNNER=$(mktemp -d)/run.sh
cat > "$RUNNER" <<EOF
CORP="$CORP"; BIN="$BIN"; ATX="$ATX"; W="$W"; OUT="$OUT"
declare -A XYZ=( [WARE]="4031947.1301 370150.7758 4911905.3657"
  [TGRN]="4023470.1812 385846.4845 4917555.1248"
  [VOER]="4022975.3119 402278.5823 4916612.3104"
  [WERB]="4055527.7993 403142.4181 4890387.0011"
  [EIJS]="4023086.533 400394.875 4916655.319"
  [TIT2]="3993787.100 450204.200 4936131.800" )
declare -A ANT=( [WARE]="TRM59800.00 NONE" [TGRN]="LEIAR25.R3 LEIT"
  [VOER]="LEIAR25.R3 LEIT" [WERB]="LEIAR25.R4 LEIT"
  [EIJS]="LEIAR25.R4 LEIT" [TIT2]="LEIAR25.R4 LEIT" )
declare -A DEL=( [WARE]="0.5180" [TGRN]="0.0" [VOER]="0.0" [WERB]="0.0"
  [EIJS]="0.0" [TIT2]="0.0450" )
declare -A KIND=( [WARE]=R [TGRN]=S [VOER]=S [WERB]=R [EIJS]=R [TIT2]=R )
declare -A FULL=( [WARE]=WARE00BEL [TGRN]=TGRN00BEL [VOER]=VOER00BEL
  [WERB]=WERB00BEL [EIJS]=EIJS00NLD [TIT2]=TIT200DEU )
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
  args+=(-r \${XYZ[\$BAS]} "\$(RNX "\$ROV" "\$DOY")" "\$(RNX "\$BAS" "\$DOY")" "\$W/nav/BRDC00IGS_R_2026\${DOY}0000_01D_MN.rnx")
  [ "\$EPH" = "prec" ] && args+=("\$W/sp3/\$DOY.sp3")
  local t0; t0=\$(date +%s)
  "\$BIN" "\${args[@]}" -o "\$pos" 2>"\$OUT/\$id.err"; local rc=\$?
  # Per-worker timing files (PID-suffixed) merged sorted after xargs,
  # so concurrent appends stay deterministic.
  echo -e "\$id\\t\$(( \$(date +%s) - t0 ))\\t\$rc" >> "\$OUT/times.worker.\$\$.tsv"
  echo "DONE \$id rc=\$rc"
  # Fail closed: propagate rnx2rtkp failure — a trailing successful echo would
  # otherwise mask rc and xargs would report success (ALL_DONE on failure).
  return \$rc
}
EOF

# local working copies of nav/sp3 (corpus stays pristine)
for DOY in 124 125 126 127 128 129 130 131 132 133 134 135 136 137 138; do
  NAV="BRDC00IGS_R_2026${DOY}0000_01D_MN.rnx"
  [ -f "$W/nav/$NAV" ] || cp "$CORP/nav/$NAV" "$W/nav/$NAV"
  [ -f "$W/sp3/$DOY.sp3" ] || gunzip -c "$CORP/sp3/COD0OPSFIN_2026${DOY}0000_01D_05M_ORB.SP3.gz" > "$W/sp3/$DOY.sp3"
done

JOBS=$(mktemp)
{
for DOY in 124 125 126 127 128 129 130 131 132 133 134 135 136 137 138; do DT=$(D2DATE "$DOY")
  # WERB outage DOY133-136: skip every leg touching WERB (objective exclusion).
  NOWEBR=0; case $DOY in 133|134|135|136) NOWEBR=1;; esac
  # Core STAR prec: 4x1h + 2x30m + 2x2h + 1x24h = 9/day/baseline.
  for PB in "TGRN WARE" "VOER WARE" "WERB WARE"; do
    ROV=${PB%% *}; BAS=${PB##* }
    if [ "$ROV" = WERB ] && [ "$NOWEBR" = 1 ]; then continue; fi
    for WH in "00:00:00 01:00:00 h00" "06:00:00 07:00:00 h06" "12:00:00 13:00:00 h12" "18:00:00 19:00:00 h18"; do
      set -- $WH; echo "run_one $ROV $BAS $DOY prec \"$DT $1\" \"$DT $2\" $3"
    done
    echo "run_one $ROV $BAS $DOY prec \"$DT 00:00:00\" \"$DT 00:30:00\" m00"
    echo "run_one $ROV $BAS $DOY prec \"$DT 12:00:00\" \"$DT 12:30:00\" m12"
    echo "run_one $ROV $BAS $DOY prec \"$DT 00:00:00\" \"$DT 02:00:00\" w00"
    echo "run_one $ROV $BAS $DOY prec \"$DT 12:00:00\" \"$DT 14:00:00\" w12"
    echo "run_one $ROV $BAS $DOY prec \"\" \"\" day"
  done
  # Triangle legs prec 1h 4/day (independent loops).
  for PB in "TGRN VOER" "VOER WERB" "TGRN WERB"; do
    ROV=${PB%% *}; BAS=${PB##* }
    if { [ "$ROV" = WERB ] || [ "$BAS" = WERB ]; } && [ "$NOWEBR" = 1 ]; then continue; fi
    for WH in "00:00:00 01:00:00 h00" "06:00:00 07:00:00 h06" "12:00:00 13:00:00 h12" "18:00:00 19:00:00 h18"; do
      set -- $WH; echo "run_one $ROV $BAS $DOY prec \"$DT $1\" \"$DT $2\" $3"
    done
  done
  # New legs prec: EIJS-WARE (WARE base), TIT2-VOER (VOER base): 4x1h + 1x24h.
  for PB in "EIJS WARE" "TIT2 VOER"; do
    ROV=${PB%% *}; BAS=${PB##* }
    for WH in "00:00:00 01:00:00 h00" "06:00:00 07:00:00 h06" "12:00:00 13:00:00 h12" "18:00:00 19:00:00 h18"; do
      set -- $WH; echo "run_one $ROV $BAS $DOY prec \"$DT $1\" \"$DT $2\" $3"
    done
    echo "run_one $ROV $BAS $DOY prec \"\" \"\" day"
  done
done
# Broadcast bounded: core STAR 3 legs x {h00,h12} x 1 day per partition
# (FIT 126, VAL 132, TEST 137 — WERB present all three; outage is 133-136).
for DOY in 126 132 137; do DT=$(D2DATE "$DOY")
  for PB in "TGRN WARE" "VOER WARE" "WERB WARE"; do
    ROV=${PB%% *}; BAS=${PB##* }
    for WH in "00:00:00 01:00:00 h00" "12:00:00 13:00:00 h12"; do
      set -- $WH; echo "run_one $ROV $BAS $DOY brdc \"$DT $1\" \"$DT $2\" $3"
    done
  done
done
} > "$JOBS"
# ONLY: single fixed-string filter, or comma-separated OR of fixed strings
# (e.g. ONLY="run_one TGRN VOER 126,run_one VOER WERB 126" for a probe subset).
if [ -n "$ONLY" ]; then
  GREP_ARGS=(); IFS=',' read -ra PATS <<< "$ONLY"
  for p in "${PATS[@]}"; do GREP_ARGS+=(-e "$p"); done
  grep -F "${GREP_ARGS[@]}" "$JOBS" > "$JOBS.f" || true; mv "$JOBS.f" "$JOBS"
fi
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
touch "$OUT/times.tsv"
sort -u -o "$OUT/times.tsv" "$OUT/times.tsv"
if [ "$XRC" -ne 0 ]; then echo "WORKER_FAILURE rc=$XRC"; exit "$XRC"; fi
echo ALL_DONE
