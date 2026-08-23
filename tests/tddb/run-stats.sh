#!/bin/bash
# TDD B — Feature 4: cm stats — metrica di valore.
# SPEC: il comando cm stats produce una metrica di valore basata su dati reali:
#   valore = f(recall utili, azioni conservate, tempo risparmiato stimato).
# Verifica che, caricato un set reale di memorie + accessi (cm touch), la metrica
# sia deterministica, provenga da dati reali e cresca con più dati utili.
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

WORK="$TMP/w"; mkdir -p "$WORK"; H="$TMP/home"; mkdir -p "$H"; export HOME="$H"
(cd "$WORK" && $CMD init >/dev/null 2>&1)

# dati reali: memorie + accessi che simulano recall utili e azioni
(cd "$WORK" && $CMD save --kind procedure "build di produzione con vite" >/dev/null 2>&1)
(cd "$WORK" && $CMD save --kind decision "usiamo terraform per l'infra" >/dev/null 2>&1)
(cd "$WORK" && $CMD save --kind fact "endpoint di auth su /v1/token" >/dev/null 2>&1)
# simula recall riusati: touch incrementa access_count (azione conservata)
FIRST=$(cd "$WORK" && $CMD ls 2>&1 | grep -oE "mem_[a-z0-9_]+" | head -1)
[ -n "$FIRST" ] && (cd "$WORK" && $CMD touch "$FIRST" >/dev/null 2>&1)

# --- Case 1: il comando stats esiste e stampa una metrica ---
S=$(cd "$WORK" && $CMD stats 2>&1)
if hastxt "select *" "$S"; then
  # segnaposto di errore (comando assente) → RED
  check "cm stats stampa una metrica di valore" "$S" RED
elif hastxt "$FIRST" "$S" || hastxt "recall" "$S" || hastxt "tempo" "$S" || hastxt "value" "$S"; then
  check "cm stats stampa una metrica di valore (recall/azioni/tempo)" "" PASS
else
  check "cm stats stampa una metrica di valore" "$S" RED
fi

# --- Case 2: la metrica è deterministica (stesso db → stesso valore) ---
S1=$(cd "$WORK" && $CMD stats 2>&1); S2=$(cd "$WORK" && $CMD stats 2>&1)
ENS=$(cd "$WORK" && $CMD stats 2>&1 | grep -oE "[0-9]+(\.[0-9]+)?" | tr '\n' ' ')
if [ -n "$(cd "$WORK" && $CMD stats 2>&1 | grep -oE 'value|valore|score|tempo')" ]; then
  # estrai un numero di valore se presente; qui ci limitiamo alla determinismo del comando
  if [ "${S1:-x}" = "${S2:-y}" ]; then check "cm stats deterministico (stesso db stesso output)" "" PASS
  else check "cm stats deterministico (stesso db stesso output)" "" RED; fi
else
  check "cm stats deterministico (stesso db stesso output)" "" RED
fi

# --- Case 3: la metrica cresce con più dati utili (tempo risparmiato) ---
BASE_N=$(cd "$WORK" && $CMD stats 2>&1 | grep -oE "[0-9]+" | sort -n | tail -1)
(cd "$WORK" && $CMD save --kind procedure "playwright setup rapido" >/dev/null 2>&1)
(cd "$WORK" && $CMD save --kind decision "adottiamo pnpm" >/dev/null 2>&1)
MORE_N=$(cd "$WORK" && $CMD stats 2>&1 | grep -oE "[0-9]+" | sort -n | tail -1)
if [ -n "${MORE_N:-}" ] && [ "${BASE_N:-0}" -lt "${MORE_N:-0}" ]; then
  check "cm stats cresce con piu dati reali (utile=azioni/tempo)" "" PASS
else
  check "cm stats cresce con piu dati reali (atteso: piu recall->piu valore; base=$BASE_N more=$MORE_N)" "" RED
fi

echo ""
echo "── stats: PASS=$PASS RED=$RED FAIL=$FAIL SKIP=$SKIP ──"
echo "TDPASS=$PASS TDRED=$RED TDFAIL=$FAIL TDSKIP=$SKIP"
[ $((FAIL)) -eq 0 ]
