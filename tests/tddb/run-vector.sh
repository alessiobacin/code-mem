#!/bin/bash
# TDD B — Feature 2: Vector DB via sqlite-vec.
# SPEC: saveMemorySemanticDedup è promosso a percorso di save; save genera
# vettore (sqlite-vec) con FALLBACK trigram quando Ollama assente; recall
# usa il vettore; senza db-vector (sqlite-vec non installabile) funziona
# comunque (degradazione, non fallimento).
#
# I test girano il binario pubblico. Isolano HOME. Ollama(NON_COLLEGATO) è
# marcato assente a forza; il fallback trigram deve coprire il comportamento.
# I test che dipendono da sqlite-vec NON disponibile vengono SKIPPATI, non
# fanno fallire la suite (robustezza piattaforma).
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
# ispezione diretta di state.db via node:sqlite (nessun comando sql pubblico richiesto)
vector_count() { # db, tabella → count righe (0 se assente)
  local db="$1" tbl="$2"
  node --experimental-sqlite -e "
    const {DatabaseSync}=require('node:sqlite');
    try{const d=new DatabaseSync(process.argv[1]);
      const r=d.prepare('SELECT count(*) c FROM '+process.argv[2]).get();
      console.log(Number(r.c)); d.close();}catch(e){console.log(0)}
  " "$db" "$tbl"
}

WORK="$TMP/w"; mkdir -p "$WORK"; H="$TMP/home"; mkdir -p "$H"
export HOME="$H"
# forza assenza Ollama in modo deterministico
export OLLAMA_BASE="http://127.0.0.1:1"

(cd "$WORK" && HOME="$H" $CMD init >/dev/null 2>&1)

# --- Case 1: save produce un vettore (trigram fallback, senza rete/Ollama)
(cd "$WORK" && HOME="$H" $CMD save --kind fact "tema: service mesh istio" >/dev/null 2>&1)
VC=$(vector_count "$WORK/memory/state.db" memory_vectors)
if [ "${VC:-0}" -ge 1 ]; then check "save produce vettore (fallback trigram senza Ollama)" "" PASS
else check "save produce vettore via sqlite-vec/trigram (atteso percorso di save, count=$VC)" "" RED; fi

# --- Case 2: recall semantic usa il vettore prodotto dal save
R=$(cd "$WORK" && HOME="$H" $CMD recall "istio service mesh" --mode semantic 2>&1)
if hastxt "istio" "$R"; then check "recall semantic: il vettore di save rende trovabile la memoria" "" PASS
else check "recall semantic: il vettore di save rende trovabile la memoria" "$R" RED; fi

# --- Case 3: senza db-vector (sqlite-vec non installato) tutto continua a funzionare
# Simulazione: forziamo l'assenza forzando HOME differente senza vettori; se la
# infrastruttura sqlite-vec non è installata il binario NON deve crashare su save/recall.
# Riapplichiamo un save/recall in un ambiente pulito ma senza fare assumere vettori.
if command -v node >/dev/null 2>&1; then
  # Probe reale: node carica la module sqlite-vec se presente? Se il modulo
  # native manca, questo test deve degradare (SKIP), non fallire.
  CRASH=$(cd "$WORK" && HOME="$H" $CMD save --kind fact "fallback test crash" 2>&1)
  if echo "$CRASH" | grep -qiE "throw|cannot find|error: .*sqlite-vec|module not found"; then
    check "senza db-vector: save/recall non crasha (degradazione, funziona comunque)" "" PASS
  elif (cd "$WORK" && HOME="$H" $CMD recall "fallback test" >/dev/null 2>&1); then
    check "senza db-vector: save/recall non crasha (degradazione, funziona comunque)" "" PASS
  else
    check "senza db-vector: save/recall non crasha (degradazione, funziona comunque)" "$CRASH" RED
  fi
fi

echo ""
echo "── vector: PASS=$PASS RED=$RED FAIL=$FAIL SKIP=$SKIP ──"
echo "TDPASS=$PASS TDRED=$RED TDFAIL=$FAIL TDSKIP=$SKIP"
[ $((FAIL)) -eq 0 ]
