#!/bin/bash
# TDD B — Task B "cm-merge-vector" — runner unico per i 4 fasci di feature.
# Convenzioni:
#   ✅ PASS  comportamento implementato e verificato
#   🔴 RED   comportamento SPEC ancora non implementato (atteso prima del coder)
#   ❌ FAIL  bug del harness/test o regressione non attesa
# Exit code 0 a prescindere da RED (RED è lo stato atteso in TDD); diverso da 0
# solo se c'è un FAIL.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
TOTAL_P=0; TOTAL_R=0; TOTAL_F=0; TOTAL_S=0
for f in "$HERE"/run-merge.sh "$HERE"/run-vector.sh "$HERE"/run-lifecycle.sh "$HERE"/run-stats.sh; do
  echo "════════ $(basename "$f") ════════"
  OUT=$(bash "$f" 2>&1); echo "$OUT"
  # raccogli parziali dall'ultima riga "TDPASS=.. TDRED=.. TDFAIL=.. TDSKIP=.."
  LINE=$(echo "$OUT" | grep -oE "TDPASS=[0-9]+ TDRED=[0-9]+ TDFAIL=[0-9]+ TDSKIP=[0-9]+" | tail -1)
  [ -n "$LINE" ] && eval "$LINE"
  TOTAL_P=$((TOTAL_P+${TDPASS:-0})); TOTAL_R=$((TOTAL_R+${TDRED:-0}))
  TOTAL_F=$((TOTAL_F+${TDFAIL:-0})); TOTAL_S=$((TOTAL_S+${TDSKIP:-0}))
  echo
done
echo "════════ TOTALE TDD B ════════"
echo "PASS=$TOTAL_P RED=$TOTAL_R FAIL=$TOTAL_F SKIP=$TOTAL_S"
[ "$TOTAL_F" -eq 0 ]
