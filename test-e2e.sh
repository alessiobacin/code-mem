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

# TEST 17: re-init idempotent
echo "━━━ TEST 17: cm init idempotent ━━━"
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

# SUMMARY
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
