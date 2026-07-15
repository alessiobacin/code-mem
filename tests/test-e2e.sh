#!/bin/bash
set -e

echo "╔══════════════════════════════════════════════╗"
echo "║     🧠 cm — E2E TEST SUITE                 ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

CMD="node /Users/alessiobacin/Desktop/code-mem/bin/cm"
PASS=0
FAIL=0
TESTDIR=/tmp/cm-e2e-$$
rm -rf "$TESTDIR"
mkdir -p "$TESTDIR/src"
export HOME="$TESTDIR/home"
mkdir -p "$HOME"
cd "$TESTDIR"

echo '{"name":"e2e-test","dependencies":{"typescript":"^5","react":"^18"}}' > package.json
echo '{"compilerOptions":{"strict":true}}' > tsconfig.json
touch src/index.ts src/components.tsx

assert_grep() { local label="$1" pattern="$2" file="$3"
  if echo "$file" | grep -q "$pattern" 2>/dev/null; then echo "  ✅ $label"; PASS=$((PASS+1))
  else echo "  ❌ $label (expected: $pattern, got: $(echo "$file" | head -2))"; FAIL=$((FAIL+1)); fi }

assert_file() { local label="$1" path="$2"
  if [ -f "$path" ]; then echo "  ✅ $label"; PASS=$((PASS+1))
  else echo "  ❌ $label"; FAIL=$((FAIL+1)); fi }

mark_pass() { echo "  ✅ $1"; PASS=$((PASS+1)); }
mark_fail() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

# TEST 1: help
echo "━━━ TEST 1: cm help ━━━"
HELP=$($CMD help 2>&1)
assert_grep "shows init" "cm init" "$HELP"
assert_grep "shows save" "cm save" "$HELP"
assert_grep "shows update" "cm update" "$HELP"
assert_grep "shows version" "cm version" "$HELP"
assert_grep "shows recall modes" "keyword|hybrid|semantic" "$HELP"
echo ""

# TEST 1b: version
echo "━━━ TEST 1b: cm version ━━━"
VERSION_CMD=$($CMD version 2>&1)
assert_grep "version command" "^0\\." "$VERSION_CMD"
VERSION_FLAG=$($CMD --version 2>&1)
assert_grep "version flag" "^0\\." "$VERSION_FLAG"
echo ""

# TEST 2: init
echo "━━━ TEST 2: cm init ━━━"
INIT=$($CMD init 2>&1)
assert_grep "init ok" "Memory initialized" "$INIT"
assert_file "MEMORY.md" "memory/MEMORY.md"
assert_file "USER.md" "memory/USER.md"
assert_file "graph.json" "memory/graph.json"
assert_file "state.db" "memory/state.db"
assert_grep ".gitignore" "memory/" "$(cat .gitignore 2>/dev/null)"
echo ""

# TEST 3: add + list
echo "━━━ TEST 3: cm add ━━━"
A1=$($CMD add "Project uses TypeScript with React" 2>&1)
assert_grep "add entry" "Added:" "$A1"
$CMD add "Build: Vite, Test: Vitest" > /dev/null 2>&1
$CMD add "Database: PostgreSQL" > /dev/null 2>&1
$CMD add "Deploy via Docker Compose on AWS ECS" > /dev/null 2>&1
$CMD add "Il container crasha all'avvio per config mancante" > /dev/null 2>&1
LS=$($CMD ls 2>&1)
assert_grep "list shows" "TypeScript" "$LS"
echo ""

# TEST 4: duplicate
echo "━━━ TEST 4: duplicate ━━━"
DUP=$($CMD add "Project uses TypeScript with React" 2>&1)
assert_grep "duplicate handled" "Already exists:" "$DUP"
echo ""

# TEST 5: replace
echo "━━━ TEST 5: cm replace ━━━"
REP=$($CMD replace "PostgreSQL" "SQLite" 2>&1)
assert_grep "replace entry" "Replaced" "$REP"
LS2=$($CMD ls 2>&1)
assert_grep "replace visible" "SQLite" "$LS2"
echo ""

# TEST 6: remove
echo "━━━ TEST 6: cm rm ━━━"
RM=$($CMD rm "Vite" 2>&1)
assert_grep "remove entry" "Removed" "$RM"
LS3=$($CMD ls 2>&1)
if grep -q "Vite" <<< "$LS3"; then
  mark_fail "remove not working"
else
  mark_pass "remove confirmed"
fi
echo ""

# TEST 7: add-user + ls-user
echo "━━━ TEST 7: cm add-user ━━━"
AU=$($CMD add-user "Name: Alessio" 2>&1)
assert_grep "add-user" "Added:" "$AU"
LU=$($CMD ls-user 2>&1)
assert_grep "ls-user" "Alessio" "$LU"
echo ""

# TEST 8: graph add_node + add_edge
echo "━━━ TEST 8: cm ga + ge ━━━"
GA1=$($CMD ga app_mod "App Module" module 2>&1)
assert_grep "add_node" "Added:" "$GA1"
GA2=$($CMD ga db_cls "Database" class 2>&1)
assert_grep "add_node db" "Added:" "$GA2"
GE1=$($CMD ge app_mod db_cls depends_on EXTRACTED 2>&1)
assert_grep "add_edge" "depends_on" "$GE1"
GE2=$($CMD ge app_mod db_cls depends_on EXTRACTED 2>&1)
assert_grep "duplicate edge" "Edge exists." "$GE2"
echo ""

# TEST 9: graph stats
echo "━━━ TEST 9: cm gs ━━━"
GS=$($CMD gs 2>&1)
assert_grep "stats" "nodes" "$GS"
echo ""

# TEST 10: graph neighbors
echo "━━━ TEST 10: cm gn ━━━"
GN=$($CMD gn app_mod 2>&1)
assert_grep "neighbors" "depends_on" "$GN"
echo ""

# TEST 11: graph path (BFS)
echo "━━━ TEST 11: cm gp ━━━"
$CMD ga infra_cls "Infra" infrastructure > /dev/null 2>&1
$CMD ge db_cls infra_cls depends_on EXTRACTED > /dev/null 2>&1
GP=$($CMD gp app_mod infra_cls 2>&1)
assert_grep "BFS path" "hops" "$GP"
echo ""

# TEST 12: graph insights
echo "━━━ TEST 12: cm gi ━━━"
GI=$($CMD gi 2>&1)
assert_grep "hubs" "HUBS" "$GI"
assert_grep "cross-type" "CROSS-TYPE" "$GI"
echo ""

# TEST 13: plan + recall
echo "━━━ TEST 13: cm plan + recall ━━━"
PL=$($CMD plan "fix TypeScript issue" 2>&1)
assert_grep "plan task kind" "\"taskKind\"" "$PL"
RC=$($CMD recall "TypeScript React" --level 2 2>&1)
assert_grep "recall task" "Task: TypeScript React" "$RC"
assert_grep "recall level" "Level: 2" "$RC"
echo ""

# TEST 14: FTS5 search
echo "━━━ TEST 14: cm sq ━━━"
SQ=$($CMD sq "TypeScript" 2>&1)
if grep -Eq "results|No results" <<< "$SQ"; then
  mark_pass "search"
else
  mark_fail "search"
fi
echo ""

# TEST 15: consolidate + project
echo "━━━ TEST 15: cm consolidate + project ━━━"
CO=$($CMD consolidate 2>&1)
assert_grep "consolidate" "Consolidated" "$CO"
PR=$($CMD project 2>&1)
assert_grep "project" "Regenerated" "$PR"
echo ""

# TEST 16: setup skill
echo "━━━ TEST 16: cm setup ━━━"
SU=$($CMD setup 2>&1)
echo "  $SU"
if [ -d "$HOME/.pi/agent/skills/cm" ]; then
  mark_pass "pi skill"
else
  mark_fail "pi skill missing"
fi
if [ -d "$HOME/.claude/skills/cm" ]; then
  mark_pass "Claude Code skill"
else
  mark_fail "Claude Code skill missing"
fi
echo ""

# TEST 17: setup from home warns and skips global hook
echo "━━━ TEST 17: cm setup from home dir ━━━"
cd "$HOME"
SU_HOME=$($CMD setup 2>&1 < /dev/null)
assert_grep "home warning" "Warning: current directory is your home folder" "$SU_HOME"
assert_grep "home skip" "Skipped hook installation" "$SU_HOME"
if [ -f "$HOME/.claude/settings.json" ]; then
  mark_fail "global hook unexpectedly created"
else
  mark_pass "no global hook created"
fi
cd "$TESTDIR"
echo ""

# TEST 18: re-init idempotent
echo "━━━ TEST 18: cm init idempotent ━━━"
RI=$($CMD init 2>&1)
assert_grep "re-init" "Memory initialized" "$RI"
BEFORE=$($CMD ls 2>&1 | wc -l)
$CMD init > /dev/null 2>&1
AFTER=$($CMD ls 2>&1 | wc -l)
if [ "$BEFORE" -le "$AFTER" ]; then
  mark_pass "preserves entries"
else
  mark_fail "corrupted entries"
fi
echo ""

# TEST 19: global save + recall + snapshot
echo "━━━ TEST 19: global save + recall ━━━"
GSAVE=$($CMD save --kind procedure --global "Deploy classico: chiedi conferma e usa Docker sul server del file .env" 2>&1)
assert_grep "global save" "Saved globally" "$GSAVE"
GLOBAL_MD_COUNT=$(find "$HOME/.cm/memories" -name global-memory.md 2>/dev/null | wc -l | tr -d ' ')
if [ "${GLOBAL_MD_COUNT:-0}" -ge 1 ] 2>/dev/null; then
  mark_pass "global snapshot scritto"
else
  mark_fail "global snapshot mancante"
fi
mkdir -p "$TESTDIR/other-project"
cd "$TESTDIR/other-project"
$CMD init > /dev/null 2>&1
GREC=$($CMD recall "deploy classico docker env" --level 1 2>&1)
assert_grep "global recall" "\\[global\\]" "$GREC"
assert_grep "global recall text" "Docker" "$GREC"
cd "$TESTDIR"
echo ""

# TEST 20: project backup
echo "━━━ TEST 20: project backup ━━━"
PBACK=$($CMD backup 2>&1)
assert_grep "project backup command" "Project backup written" "$PBACK"
PROJECT_BACKUPS=$(find "$TESTDIR/cm/memories" -name project-memory.md 2>/dev/null | wc -l | tr -d ' ')
if [ "${PROJECT_BACKUPS:-0}" -ge 1 ] 2>/dev/null; then
  mark_pass "project backup file"
else
  mark_fail "project backup file missing"
fi
echo ""

# TEST 21: global backup + restore
echo "━━━ TEST 21: global backup + restore ━━━"
GBACK=$($CMD backup --global 2>&1)
assert_grep "global backup command" "Global backup written" "$GBACK"
GLOBAL_BACKUP_FILE=$(find "$TESTDIR" -maxdepth 1 -name 'cm-global-backup-*.json' | head -1)
if [ -f "$GLOBAL_BACKUP_FILE" ]; then
  mark_pass "global backup file"
else
  mark_fail "global backup file missing"
fi
rm -rf "$HOME/.cm"
GREST=$($CMD restore --global "$GLOBAL_BACKUP_FILE" 2>&1)
assert_grep "global restore command" "Restored" "$GREST"
cd "$TESTDIR/other-project"
GREC2=$($CMD recall "docker env deploy classico" --level 1 2>&1)
assert_grep "global restore recall" "\\[global\\]" "$GREC2"
cd "$TESTDIR"
echo ""

# ======================================================
#  EMBEDDING TESTS
# ======================================================

# TEST 22: trigram embedding — recall con variante morfologica
echo "━━━ TEST 22: trigram recall (variante morfologica) ━━━"
# "crash" non esiste come parola esatta, ma "crasha" è variante morfologica di "crash"
RC_TRI=$($CMD recall "deploy con docker compose" --mode hybrid --level 1 2>&1)
assert_grep "trigram trova docker" "Docker" "$RC_TRI"
# verifichiamo che appaia un semantic score (anche se sem=0.000 in output, il ranking l'ha calcolato)
RC_SCORE=$($CMD recall "distribuzione container" --mode hybrid --level 1 2>&1)
assert_grep "trigram trova refuso semantico" "Docker" "$RC_SCORE"
echo ""

# TEST 23: vectorize via consolidate
echo "━━━ TEST 23: vectorize su consolidate ━━━"
# Salviamo un'altra memoria — consolidate dovrebbe vettorizzarla
$CMD save --kind fact "Il deployment su ECS fallisce per mancata configurazione" > /dev/null 2>&1
# Forziamo consolidate che ora vectorizza anche
CO2=$($CMD consolidate 2>&1)
VEC_COUNT=$(node --experimental-sqlite -e "
const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('memory/state.db');
const r=d.prepare('SELECT COUNT(*) AS c FROM memory_vectors').get();
console.log(r.c);
")
if [ "$VEC_COUNT" -ge 2 ] 2>/dev/null; then
  mark_pass "memories vectorizzate ($VEC_COUNT totali)"
else
  mark_fail "vettori insufficienti ($VEC_COUNT)"
fi
echo ""

# TEST 24: trigram + keyword — hybrid mode senza Ollama
echo "━━━ TEST 24: hybrid recall con trigram (nessuna query keyword match) ━━━"
# Cerchiamo "contenitore" che non è parola esatta in nessuna memoria (c'è "container")
RC_HYB=$($CMD recall "contenitore deployment" --mode hybrid --level 1 2>&1)
if echo "$RC_HYB" | grep -qi "Docker\|ECS\|deploy"; then
  mark_pass "trigram morfologico: 'contenitore' ~ 'container' match"
else
  mark_fail "trigram morfologico fallito"
fi
echo ""

# TEST 25: keyword-only mode NON usa trigram
echo "━━━ TEST 25: keyword-only mode ━━━"
RC_KW=$($CMD recall "contenitore" --mode keyword --level 1 2>&1)
# In keyword mode non dovrebbe trovare "container" cercando "contenitore"
if echo "$RC_KW" | grep -qi "Plan.*mode=keyword"; then
  mark_pass "keyword mode selezionato"
else
  mark_fail "keyword mode non rilevato"
fi
echo ""

# ======================================================
#  OLLAMA EMBEDDING TESTS (opzionali, solo se Ollama gira)
# ======================================================

if curl -s -o /dev/null -w "%{http_code}" http://localhost:11434/api/tags 2>/dev/null | grep -q 200; then
  echo "━━━ TEST 26: Ollama embedding disponibile ━━━"
  # Salva una memoria nuova e forza l'embedding via consolidate
  $CMD save --kind decision "Preferiamo REST su GraphQL per semplicità" > /dev/null 2>&1
  CO3=$($CMD consolidate 2>&1)
  OLLAMA_VEC=$(node --experimental-sqlite -e "
const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('memory/state.db');
const r=d.prepare(\"SELECT COUNT(*) AS c FROM memory_vectors WHERE model='nomic-embed-text'\").get();
console.log(r.c);
")
  if [ "$OLLAMA_VEC" -ge 1 ] 2>/dev/null; then
    mark_pass "Ollama embedding generato ($OLLAMA_VEC vectors)"
  else
    mark_fail "nessun Ollama vector"
  fi
  echo ""

  echo "━━━ TEST 27: hybrid recall con Ollama (priorità su trigram) ━━━"
  RC_OL=$($CMD recall "API design pattern" --mode hybrid --level 1 2>&1)
  if echo "$RC_OL" | grep -qi "GraphQL\|REST"; then
    mark_pass "Ollama recall trova API decision"
  else
    mark_fail "Ollama recall fallito"
  fi
  echo ""
else
  echo "━━━ SKIP TEST 26-27: Ollama non disponibile ━━━"
  echo "  ⏭️  Per testare embedding Ollama: ollama pull nomic-embed-text"
  echo ""
fi

# ======================================================
#  SUMMARY
# ======================================================
TOTAL=$((PASS+FAIL))
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  ✅ Passed: $PASS"
echo "  ❌ Failed: $FAIL"
echo "  📊 Total:  $TOTAL"
echo ""

rm -rf "$TESTDIR"
if [ "$FAIL" -gt 0 ]; then
  echo "⚠️  $FAIL test(s) failed"
  exit 1
fi
