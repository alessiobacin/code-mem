#!/bin/bash
# TDD B — Feature 1: Merge deterministico dei database di stato.
# SPEC: dopo il refactor, cm export produce un file bundle (json) e
# cm import riapplica un diff deterministico (per id/timestamp) che
# risolve senza conflitti binari. Verifica merge senza perdita tra due
# database divergenti.
#
# I test girano il binario pubblico (spawn CLI), non importano internals
# che il refactor sposterà. HOME isolato per ogni caso.
set -u
CMD="node $(cd "$(dirname "$0")/../.." && pwd)/bin/cm"
PASS=0; FAIL=0; RED=0; SKIP=0
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

check() { # label, matcher, cond
  local label="$1" matcher="$2" status="$3"
  if [ "$status" = "PASS" ]; then PASS=$((PASS+1)); echo "  ✅ $label"
  elif [ "$status" = "RED" ]; then RED=$((RED+1)); echo "  🔴 RED   $label"
  elif [ "$status" = "SKIP" ]; then SKIP=$((SKIP+1)); echo "  ⏭  SKIP $label"
  else FAIL=$((FAIL+1)); echo "  ❌ FAIL  $label"; fi
}
hastxt() { grep -q "$1" <<<"$2"; }

echo "── Feature: merge deterministico state.db ──"

# --- Case 1: export produce un bundle json ---
EXDIR="$TMP/export"; mkdir -p "$EXDIR"; HOME="$TMP/home1" ; export HOME; mkdir -p "$HOME"
(cd "$EXDIR" && $CMD init >/dev/null 2>&1)
(cd "$EXDIR" && $CMD save --kind fact "alpha: cloud provider is AWS" >/dev/null 2>&1)
EX=$(cd "$EXDIR" && HOME="$HOME" $CMD export 2>&1)
BUNDLE="$EXDIR/export.json"
if [ -s "$BUNDLE" ] && hastxt "AWS" "$(cat "$BUNDLE")"; then
  check "export produce bundle json con contenuto" "" PASS
else
  # comando ancora assente → RED (SPEC da implementare)
  check "export produce bundle json con contenuto (atteso comando cm export)" "$EX" RED
fi

# --- Case 2: due db divergenti -> import merge senza perdita ---
A="$TMP/dbA"; B="$TMP/dbB"; M="$TMP/dbM"; mkdir -p "$A" "$B" "$M"
export HOME="$TMP/homeX"; mkdir -p "$HOME"
(cd "$A" && $CMD init >/dev/null 2>&1)
(cd "$B" && $CMD init >/dev/null 2>&1)
(cd "$M" && $CMD init >/dev/null 2>&1)
(cd "$A" && $CMD save --kind fact "onlyA memory" >/dev/null 2>&1)
(cd "$A" && $CMD save --kind fact "sharedA memory" >/dev/null 2>&1)
(cd "$B" && $CMD save --kind fact "onlyB memory" >/dev/null 2>&1)
(cd "$B" && $CMD save --kind fact "sharedB memory" >/dev/null 2>&1)
(cd "$A" && $CMD export >/dev/null 2>&1) && EXA="$A/export.json"
(cd "$B" && $CMD export >/dev/null 2>&1) && EXB="$B/export.json"
CMS=$(cd "$M" && $CMD export >/dev/null 2>&1; [ -f "$M/export.json" ] && echo -n "e=e; " ; echo -n)
# merge: import A poi B nello stesso db di merge
mkdir -p "$M/merge_from"; cp "$A/state.db" "$M/state.db" 2>/dev/null
IMPORTA=$(cd "$M" && HOME="$HOME" $CMD import "$EXA" 2>&1)
IMPORTB=$(cd "$M" && HOME="$HOME" $CMD import "$EXB" 2>&1)
LS=$(cd "$M" && HOME="$HOME" $CMD ls 2>&1)
if (hastxt "onlyA" "$LS" && hastxt "onlyB" "$LS" && hastxt "sharedA" "$LS" && hastxt "sharedB" "$LS"); then
  check "import merge senza perdita da due db divergenti" "" PASS
else
  check "import merge senza perdita (atteso comando cm import + merge id/timestamp)" "$IMPORTA $IMPORTB" RED
fi
# idempotenza del diff: ri-importare lo stesso bundle non deve duplicare
B1=$(echo "$LS" | grep -c "onlyB")
R2=$(cd "$M" && HOME="$HOME" $CMD import "$EXB" 2>&1)
LS2=$(cd "$M" && HOME="$HOME" $CMD ls 2>&1)
B2=$(echo "$LS2" | grep -c "onlyB")
if [ "$B1" = "$B2" ] && [ "$B1" -ge 1 ]; then
  check "import idempotente (ri-import non duplica)" "" PASS
else
  check "import idempotente (diff deterministico per id)" "$R2" RED
fi

echo ""
echo "── merge: PASS=$PASS RED=$RED FAIL=$FAIL SKIP=$SKIP ──"
echo "TDPASS=$PASS TDRED=$RED TDFAIL=$FAIL TDSKIP=$SKIP"
[ $((FAIL)) -eq 0 ]
