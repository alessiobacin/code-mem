#!/bin/bash
# TDD B — Feature 3: Lifecycle guidato dalle correzioni.
# SPEC: quando una correzione (cm replace / cm save --replace / correzione
# che nomina una memoria precedente) indica che una memoria esiste come
# contestata (contested), corretta (corrected) o obsoleta (obsolete), il CLI
# deve aggiornare confidence/status della memoria ORIGINALE e riconsolidare.
# Test per ciascuno stato.
set -u
CMD="node $(cd "$(dirname "$0")/../.." && pwd)/bin/cm"
PASS=0; FAIL=0; RED=0; SKIP=0
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
check() { local label="$1" s="$2"; case "$s" in
  PASS) PASS=$((PASS+1)); echo "  ✅ $label";;
  RED)  RED=$((RED+1));  echo "  🔴 RED   $label";;
  SKIP) SKIP=$((SKIP+1));echo "  ⏭  SKIP $label";;
  *) RED=$((RED+1)); echo "  🔴 RED   $label";; esac; }
hastxt() { grep -q "$1" <<<"$2"; }

status_of() { # db, body-substring → status della memoria originale
  node --experimental-sqlite -e "
    const {DatabaseSync}=require('node:sqlite');
    try{const d=new DatabaseSync(process.argv[1]);
      const r=d.prepare(\"SELECT status FROM memory_items WHERE body LIKE '%'||?||'%'\").get(process.argv[2]);
      console.log(r?r.status:'MISSING');d.close();}catch(e){console.log('ERR')}" "$1" "$2"
}

WORK="$TMP/w"; mkdir -p "$WORK"; H="$TMP/home"; mkdir -p "$H"; export HOME="$H"
(cd "$WORK" && $CMD init >/dev/null 2>&1)

# --- prepare: memoria originaria + correzione ---
(cd "$WORK" && $CMD save --kind fact --title "db scelta" "usiamo postgres come db di default" >/dev/null 2>&1)
DB="$WORK/memory/state.db"

# --- Case A: contested (correzione contesta una memoria precedente) ---
# SPEC: salvare una memoria che mette in dubbio la precedente (es. titolo/frase
# che la nomina come "da verificare") porta la memoria originale a status 'contested'.
(cd "$WORK" && $CMD save --kind fact --title "dubbio postgres" "contested: usiamo postgres come db di default" >/dev/null 2>&1)
S_C=$(status_of "$DB" "postgres come db di default")
if [ "$S_C" = "contested" ]; then check "contested: la memoria nominata passa a status contested" "" PASS
else check "contested: la memoria nominata passa a status contested (got=$S_C)" "" RED; fi

# --- Case B: corrected (correzione sostituisce una memoria) ---
# cm replace sostituisce testo: la memoria originaria DEV E diventare 'corrected'
(cd "$WORK" && $CMD replace "usiamo postgres come db di default" "usiamo sqlite come db di default" >/dev/null 2>&1)
S_R=$(status_of "$DB" "usiamo sqlite come db di default")
if [ "$S_R" = "corrected" ]; then check "corrected: replace marca la memoria di riferimento corrected" "" PASS
else check "corrected: replace marca la memoria di riferimento corrected (got=$S_R)" "" RED; fi

# --- Case C: obsolete (correzione dichiara obsoleto un flusso) ---
(cd "$WORK" && $CMD save --kind fact --title "flusso vecchio" "deploy manuale su ec2" >/dev/null 2>&1)
(cd "$WORK" && $CMD save --kind fact --title "flusso nuovo" "obsolete: deploy manuale su ec2 (sostituito da terraform)" >/dev/null 2>&1)
S_O=$(status_of "$DB" "deploy manuale su ec2")
if [ "$S_O" = "obsolete" ]; then check "obsolete: la memoria nominata passa a status obsolete" "" PASS
else check "obsolete: la memoria nominata passa a status obsolete (got=$S_O)" "" RED; fi

# --- Case D: riconsolidazione — confidence/status propagato al grafo ---
# SPEC: dopo la transizione il CLI riconsolida (cm consolidate) senza errori
# e la memoria originale non compare piu' come candidata 'active' di recall.
CONS=$(cd "$WORK" && $CMD consolidate 2>&1)
CLS=$(cd "$WORK" && $CMD ls 2>&1)
if echo "$CONS" | grep -qiE "error|exception|throw"; then
  check "riconsolida dopo correzione senza errori" "$CONS" RED
else
  check "riconsolida dopo correzione senza errori" "" PASS
fi

echo ""
echo "── lifecycle: PASS=$PASS RED=$RED FAIL=$FAIL SKIP=$SKIP ──"
echo "TDPASS=$PASS TDRED=$RED TDFAIL=$FAIL TDSKIP=$SKIP"
[ $((FAIL)) -eq 0 ]
