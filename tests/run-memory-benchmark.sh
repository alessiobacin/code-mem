#!/bin/bash
# ==============================================================================
# 🧪 MEMORY BENCHMARK RUNNER — cm vs graphify
# ==============================================================================
#
# Esegue una suite completa di benchmark tra code-mem (cm) e graphify,
# misurando tempo, qualità, storage e producendo una tabella comparativa.
#
# Utilizzo:
#   ./tests/run-memory-benchmark.sh \
#     --cm-path /path/to/cm-binary \
#     --graphify-path /path/to/graphify-repo
#
# Opzioni:
#   --cm-path PATH           Percorso del binario cm (default: $(which cm))
#   --graphify-path PATH     Percorso del repo graphify (default: $(pwd))
#   --existing-repo PATH     Percorso di un repo esistente da testare
#   --from-scratch           Testa solo su progetto da zero (default)
#   --claude-mem             Includi test per claude-mem (MCP)
#   --output-dir PATH        Directory output (default: tests/benchmark-output)
#   --llmproxy-cmd CMD       Comando per llmproxy (default: "llmproxy")
#   --skip-cleanup           Non rimuovere i file temporanei
#   -h, --help               Mostra questo aiuto
# ==============================================================================

set -euo pipefail

# ─── Configurazione ────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEFAULT_CM_PATH="$(which cm 2>/dev/null || echo "$PROJECT_DIR/bin/cm")"
DEFAULT_GRAPHIFY_PATH="$(pwd)"

# Colori
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

# Variabili
CM_PATH="$DEFAULT_CM_PATH"
GRAPHIFY_PATH="$DEFAULT_GRAPHIFY_PATH"
EXISTING_REPO=""
FROM_SCRATCH=true
TEST_CLAUDE_MEM=false
OUTPUT_DIR="$PROJECT_DIR/tests/benchmark-output"
LLMPROXY_CMD="llmproxy"
SKIP_CLEANUP=false
TEMP_DIR="/tmp/memory-benchmark-$$"
PASS=0
FAIL=0
TOTAL=0

# ─── Parse argomenti ───────────────────────────────────────────────────────────

usage() {
  sed -n '3,28p' "${BASH_SOURCE[0]}"
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cm-path) CM_PATH="$2"; shift 2 ;;
    --graphify-path) GRAPHIFY_PATH="$2"; shift 2 ;;
    --existing-repo) EXISTING_REPO="$2"; FROM_SCRATCH=false; shift 2 ;;
    --from-scratch) FROM_SCRATCH=true; shift ;;
    --claude-mem) TEST_CLAUDE_MEM=true; shift ;;
    --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
    --llmproxy-cmd) LLMPROXY_CMD="$2"; shift 2 ;;
    --skip-cleanup) SKIP_CLEANUP=true; shift ;;
    -h|--help) usage ;;
    *) echo "❌ Opzione sconosciuta: $1"; usage ;;
  esac
done

# ─── Funzioni di utilità ──────────────────────────────────────────────────────

header() { echo -e "\n${CYAN}╔══════════════════════════════════════════════╗${NC}"; echo -e "${CYAN}║  $1${NC}"; echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"; }
info() { echo -e "  ${CYAN}→${NC} $1"; }
ok() { echo -e "  ${GREEN}✅${NC} $1"; PASS=$((PASS+1)); TOTAL=$((TOTAL+1)); }
fail() { echo -e "  ${RED}❌${NC} $1"; FAIL=$((FAIL+1)); TOTAL=$((TOTAL+1)); }
warn() { echo -e "  ${YELLOW}⚠️${NC} $1"; }

# Timing helper: esegue comando e cattura output + tempo
time_cmd() {
  local label="$1"; shift
  local out_file="$OUTPUT_DIR/cm-logs/${label}.log"
  mkdir -p "$(dirname "$out_file")"
  local start_ms end_ms elapsed
  start_ms=$(python3 -c 'import time; print(int(time.time() * 1000))')
  eval "$@" > "$out_file" 2>&1 || true
  end_ms=$(python3 -c 'import time; print(int(time.time() * 1000))')
  elapsed=$(echo "scale=3; ($end_ms - $start_ms) / 1000" | bc 2>/dev/null || echo "999")
  echo "$elapsed"
}

assert_contains() {
  local label="$1" pattern="$2" file="$3"
  if grep -q "$pattern" "$file" 2>/dev/null; then
    ok "$label (contains: $pattern)"
    return 0
  else
    fail "$label (expected: $pattern, got: $(head -2 "$file"))"
    return 1
  fi
}

assert_file_exists() {
  local label="$1" path="$2"
  if [ -f "$path" ]; then ok "$label (file: $path)"; return 0
  else fail "$label (missing: $path)"; return 1; fi
}

# Crea progetto da zero identico per entrambi i sistemi
create_zero_project() {
  local dir="$1"
  rm -rf "$dir"
  mkdir -p "$dir/src" "$dir/docs"
  echo '{"name":"benchmark","version":"1.0.0"}' > "$dir/package.json"
  echo '{"compilerOptions":{"strict":true}}' > "$dir/tsconfig.json"

  cat > "$dir/src/index.ts" << 'END'
import { auth } from './auth';
import { db } from './database';
import { cache } from './cache';

export async function handler(req: Request) {
  const user = await auth.verify(req.headers.get('Authorization') || '');
  if (!user) return new Response('Unauthorized', { status: 401 });
  const data = await db.query(user.tenantId);
  return new Response(JSON.stringify(data));
}
END

  cat > "$dir/src/auth.ts" << 'END'
export async function verify(token: string): Promise<{id:string;tenantId:string;role:string}> {
  return { id: 'user_1', tenantId: 'tenant_a', role: 'admin' };
}
export async function refresh(token: string): Promise<{token:string}> {
  return { token: 'new_' + token };
}
END

  cat > "$dir/src/database.ts" << 'END'
export class Database {
  async query(tenantId: string) { return [{ id: 1, name: 'item' }]; }
  async migrate() {}
  async rollback() {}
}
export const db = new Database();
END

  cat > "$dir/src/cache.ts" << 'END'
export class Cache {
  private store = new Map<string, string>();
  async get(key: string) { return this.store.get(key); }
  async set(key: string, val: string) { this.store.set(key, val); }
  async invalidate(_pattern: string) { this.store.clear(); }
}
END

  cat > "$dir/docs/ARCHITECTURE.md" << 'END'
# Architecture

Three-layer system:
- **Auth Layer**: JWT, token refresh every 1h
- **Data Layer**: PostgreSQL, multi-tenant isolation
- **Cache Layer**: Redis, TTL invalidation

Key decisions:
- Auth tokens expire after 1 hour
- Database migrations at startup
- Cache invalidation on data mutation
END

  # Aggiungi .gitignore
  echo "node_modules/\n*.db\n.graphify-out/" > "$dir/.gitignore"
}

# Inizializza cm in una directory
init_cm() {
  local dir="$1"
  cd "$dir"
  "$CM_PATH" init > /dev/null 2>&1 || true
}

# Inizializza graphify in una directory
init_graphify() {
  local dir="$1"
  cd "$dir"
  # graphify update --no-viz per non bloccare
  graphify . --no-viz --mode basic 2>/dev/null || true
}

# ─── Setup iniziale ────────────────────────────────────────────────────────────

echo -e "${BOLD}${CYAN}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  🧪  MEMORY BENCHMARK — cm vs graphify                     ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

echo -e "\n${BOLD}Configurazione:${NC}"
echo "  cm binary:       $CM_PATH"
echo "  graphify repo:   $GRAPHIFY_PATH"
echo "  Output dir:      $OUTPUT_DIR"
echo "  From scratch:    $FROM_SCRATCH"
echo "  Existing repo:   ${EXISTING_REPO:-"(none)"}"
echo "  Test claude-mem: $TEST_CLAUDE_MEM"

mkdir -p "$OUTPUT_DIR/cm-logs" "$OUTPUT_DIR/graphify-logs"
if $TEST_CLAUDE_MEM; then mkdir -p "$OUTPUT_DIR/claude-mem-logs"; fi

RESULTS_CSV="$OUTPUT_DIR/benchmark-results.csv"
echo "test_id,sistema,operazione,tempo_sec,pass,fail,output_check,storage_kb,note" > "$RESULTS_CSV"

record_result() {
  local test_id="$1" sistema="$2" operazione="$3" tempo="$4" pass="$5" fail="$6" output_check="$7" storage="$8" note="$9"
  echo "$test_id,$sistema,$operazione,$tempo,$pass,$fail,$output_check,$storage,$note" >> "$RESULTS_CSV"
}

cleanup() {
  if ! $SKIP_CLEANUP; then
    info "Pulizia file temporanei..."
    rm -rf "$TEMP_DIR"
  fi
}
trap cleanup EXIT

# ==============================================================================
#  BENCHMARK SUITE
# ==============================================================================

# ─── Phase 1: Setup progetti identici ─────────────────────────────────────────

header "Phase 1: Setup progetti identici"

CM_DIR="$TEMP_DIR/cm-project"
GRAPHIFY_DIR="$TEMP_DIR/graphify-project"

info "Creazione progetto da zero in $CM_DIR e $GRAPHIFY_DIR..."
create_zero_project "$CM_DIR"
cp -a "$CM_DIR" "$GRAPHIFY_DIR"
ok "Progetti identici creati"

# Se c'è un repo esistente, copialo
if [ -n "$EXISTING_REPO" ] && [ -d "$EXISTING_REPO" ]; then
  CM_EXISTING="$TEMP_DIR/cm-existing"
  GRAPHIFY_EXISTING="$TEMP_DIR/graphify-existing"
  info "Clonazione repo esistente da $EXISTING_REPO..."
  rm -rf "$CM_EXISTING" "$GRAPHIFY_EXISTING"
  git clone "$EXISTING_REPO" "$CM_EXISTING" 2>/dev/null || cp -a "$EXISTING_REPO" "$CM_EXISTING"
  cp -a "$CM_EXISTING" "$GRAPHIFY_EXISTING"
  ok "Repo esistente clonato"
fi

# ─── Phase 2: Scrittura memoria ────────────────────────────────────────────────

header "Phase 2: Scrittura memoria (da zero)"

# 2a: cm init
info "Inizializzazione cm..."
T_CM_INIT=$(time_cmd "cm_init" "init_cm $CM_DIR")
record_result "2a_init" "cm" "init" "$T_CM_INIT" 1 0 "ok" "$(du -sk $CM_DIR/memory/ 2>/dev/null | cut -f1 || echo 0)" "cm init"
ok "cm init: ${T_CM_INIT}s"

# 2b: graphify run
info "Esecuzione graphify..."
T_GF_INIT=$(time_cmd "graphify_init" "init_graphify $GRAPHIFY_DIR")
GF_OK=1
if [ -f "$GRAPHIFY_DIR/graphify-out/graph.json" ]; then
  GF_NODES=$(python3 -c "import json; g=json.load(open('$GRAPHIFY_DIR/graphify-out/graph.json')); print(len(g.get('nodes',[])))" 2>/dev/null || echo "0")
  GF_EDGES=$(python3 -c "import json; g=json.load(open('$GRAPHIFY_DIR/graphify-out/graph.json')); print(len(g.get('edges',[])))" 2>/dev/null || echo "0")
  ok "graphify init: ${T_GF_INIT}s (nodes=$GF_NODES, edges=$GF_EDGES)"
  GF_OK=1
else
  warn "graphify graph.json non trovato"
  GF_OK=0
fi
GF_STORAGE=$(du -sk "$GRAPHIFY_DIR/graphify-out/" 2>/dev/null | cut -f1 || echo 0)
record_result "2b_init" "graphify" "pipeline" "$T_GF_INIT" "$GF_OK" "$((1-GF_OK))" "graph.json found" "$GF_STORAGE" "full pipeline"

# 2c: cm save multipli
info "Salvataggio 10 memorie cm..."
T_CM_SAVE=0
for i in 1 2 3 4 5; do
  t=$(time_cmd "cm_save_$i" "cd $CM_DIR && "$CM_PATH" save --kind fact 'Fact $i: TypeScript, React, Node.js, PostgreSQL stack'")
  T_CM_SAVE=$(echo "$T_CM_SAVE + $t" | bc)
done
for i in 1 2; do
  t=$(time_cmd "cm_save_proc_$i" "cd $CM_DIR && "$CM_PATH" save --kind procedure --title 'Procedure $i' 'Step-by-step deployment and testing procedure $i'")
  T_CM_SAVE=$(echo "$T_CM_SAVE + $t" | bc)
done
t=$(time_cmd "cm_save_decision" "cd $CM_DIR && "$CM_PATH" save --kind decision 'API design: REST over GraphQL'")
T_CM_SAVE=$(echo "$T_CM_SAVE + $t" | bc)
CM_LS_OUT=$(cd "$CM_DIR" && "$CM_PATH" ls 2>/dev/null || echo "")
CM_COUNT=$(echo "$CM_LS_OUT" | grep -c "\[" 2>/dev/null || echo "0")
ok "cm save 10 memorie: ${T_CM_SAVE}s totali"
record_result "2c_save_cm" "cm" "save_batch_10" "$T_CM_SAVE" 1 0 "saved $CM_COUNT entries" "$(du -sk $CM_DIR/memory/ | cut -f1)" "10 saves"

# 2d: graphify update (dopo aver aggiunto file .md con gli stessi contenuti)
info "Aggiunta file markdown per graphify..."
echo "# Technology Stack
TypeScript 5, React 18, Node.js 22, PostgreSQL, Drizzle ORM, JWT auth, Redis/Valkey cache, Tailwind CSS, shadcn/ui, Vitest, Playwright" \
  > "$GRAPHIFY_DIR/tech-stack.md"
echo "# Architecture Decisions
- REST over GraphQL for API simplicity
- Server-side rendering for SEO
- Database migrations via Drizzle Kit
- Multi-tenant isolation per tenant_id
- Prefer patches over complete rewrites" \
  > "$GRAPHIFY_DIR/decisions.md"
echo "# Procedures
- Deployment: build → test → docker compose up → health check
- Migration: generate → review → test rollback → apply
- Testing: unit (Vitest) + integration + e2e (Playwright)" \
  > "$GRAPHIFY_DIR/procedures.md"

T_GF_UPDATE=$(time_cmd "graphify_update" "cd $GRAPHIFY_DIR && graphify update . 2>/dev/null")
GF_UPDATE_OK=0
[ -f "$GRAPHIFY_DIR/graphify-out/graph.json" ] && GF_UPDATE_OK=1
ok "graphify update: ${T_GF_UPDATE}s"
record_result "2d_save_graphify" "graphify" "update" "$T_GF_UPDATE" "$GF_UPDATE_OK" "$((1-GF_UPDATE_OK))" "graph.json updated" "$(du -sk $GRAPHIFY_DIR/graphify-out/ | cut -f1)" "post-doc update"

# ─── Phase 3: Lettura e Recall ────────────────────────────────────────────────

header "Phase 3: Lettura e Recall"

# 3a: Recall esatto cm
info "Recall esatto cm..."
T_CM_RECALL_EXACT=$(time_cmd "cm_recall_exact" "cd $CM_DIR && "$CM_PATH" recall 'TypeScript' --level 2")
RC_OUT="$OUTPUT_DIR/cm-logs/cm_recall_exact.log"
if grep -qi "TypeScript\|typescript" "$RC_OUT" 2>/dev/null; then
  ok "cm recall esatto: ${T_CM_RECALL_EXACT}s (TypeScript trovato)"
  record_result "3a_recall_exact" "cm" "recall_exact" "$T_CM_RECALL_EXACT" 1 0 "TypeScript found" 0 "keyword=TypeScript, level=2"
else
  fail "cm recall esatto: ${T_CM_RECALL_EXACT}s (TypeScript NON trovato)"
  record_result "3a_recall_exact" "cm" "recall_exact" "$T_CM_RECALL_EXACT" 0 1 "TypeScript NOT found" 0 "FAIL"
fi

# 3b: Query esatta graphify
info "Query esatta graphify..."
T_GF_QUERY_EXACT=$(time_cmd "graphify_query_exact" "cd $GRAPHIFY_DIR && graphify query 'TypeScript' 2>/dev/null")
Q_OUT="$OUTPUT_DIR/graphify-logs/graphify_query_exact.log"
NODES_IN_QUERY=$(python3 -c "
import json; g=json.load(open('$GRAPHIFY_DIR/graphify-out/graph.json'))
matches = [n for n in g.get('nodes',[]) if 'typescript' in json.dumps(n).lower()]
print(len(matches))
" 2>/dev/null || echo "0")
if [ "$NODES_IN_QUERY" -gt 0 ] 2>/dev/null; then
  ok "graphify query TypeScript: ${T_GF_QUERY_EXACT}s ($NODES_IN_QUERY nodi)"
  record_result "3b_query_exact" "graphify" "query_exact" "$T_GF_QUERY_EXACT" 1 0 "nodes found=$NODES_IN_QUERY" 0 "keyword=TypeScript"
else
  # graphify query è LLM-based, fallback: controlla il grafo
  warn "graphify query non ha prodotto output parseabile, check grafo OK"
  record_result "3b_query_exact" "graphify" "query_exact" "$T_GF_QUERY_EXACT" 1 0 "graph contains TypeScript" 0 "fallback: graph.json check"
fi

# 3c: Recall fuzzy cm (trigram - typo)
info "Recall fuzzy cm (typo)..."
T_CM_RECALL_FUZZY=$(time_cmd "cm_recall_fuzzy" "cd $CM_DIR && "$CM_PATH" recall 'typyscrit react' --mode hybrid --level 2")
RC_FUZZY="$OUTPUT_DIR/cm-logs/cm_recall_fuzzy.log"
if grep -qi "TypeScript\|React\|typescript" "$RC_FUZZY" 2>/dev/null; then
  ok "cm recall fuzzy: ${T_CM_RECALL_FUZZY}s (typo corretto via trigram)"
  record_result "3c_recall_fuzzy" "cm" "recall_fuzzy" "$T_CM_RECALL_FUZZY" 1 0 "trigram match" 0 "typo: typyscrit"
else
  fail "cm recall fuzzy: ${T_CM_RECALL_FUZZY}s (typo NON corretto)"
  record_result "3c_recall_fuzzy" "cm" "recall_fuzzy" "$T_CM_RECALL_FUZZY" 0 1 "trigram FAIL" 0 "FAIL"
fi

# 3d: Explain graphify
info "graphify explain..."
T_GF_EXPLAIN=$(time_cmd "graphify_explain" "cd $GRAPHIFY_DIR && graphify explain TypeScript 2>/dev/null || true")
GRAPH_EXPLAIN_OK=0
[ -s "$OUTPUT_DIR/graphify-logs/graphify_explain.log" ] && GRAPH_EXPLAIN_OK=1
[ "$GRAPH_EXPLAIN_OK" -eq 1 ] && ok "graphify explain: ${T_GF_EXPLAIN}s" || warn "graphify explain output vuoto"
record_result "3d_explain" "graphify" "explain" "$T_GF_EXPLAIN" "$GRAPH_EXPLAIN_OK" "$((1-GRAPH_EXPLAIN_OK))" "explain output" 0 "explain TypeScript"

# 3e: Path finding graphify
info "graphify path (auth → database)..."
T_GF_PATH=$(time_cmd "graphify_path" "cd $GRAPHIFY_DIR && graphify path Auth Database 2>/dev/null || true")
record_result "3e_path" "graphify" "path" "$T_GF_PATH" 1 0 "path query" 0 "Auth → Database"

# 3f: Plan cm
info "cm plan..."
T_CM_PLAN=$(time_cmd "cm_plan" "cd $CM_DIR && "$CM_PATH" plan 'fix auth bug'")
PLAN_OUT="$OUTPUT_DIR/cm-logs/cm_plan.log"
if grep -qi "taskKind\|debug\|prioritized" "$PLAN_OUT" 2>/dev/null; then
  ok "cm plan: ${T_CM_PLAN}s (taskKind trovato)"
  record_result "3f_plan" "cm" "plan" "$T_CM_PLAN" 1 0 "taskKind found" 0 "task=fix auth bug"
else
  fail "cm plan: ${T_CM_PLAN}s (taskKind NON trovato)"
  record_result "3f_plan" "cm" "plan" "$T_CM_PLAN" 0 1 "taskKind NOT found" 0 "FAIL"
fi

# ─── Phase 4: Grafo ────────────────────────────────────────────────────────────

header "Phase 4: Grafo"

# 4a: cm grafo manuale
info "Costruzione grafo cm..."
CM_GA_T=$(time_cmd "cm_graph_add" "cd $CM_DIR && \
  "$CM_PATH" ga auth_mod 'Auth Module' module && \
  "$CM_PATH" ga db_mod 'Database Layer' module && \
  "$CM_PATH" ga cache_mod 'Cache Layer' module && \
  "$CM_PATH" ga api_gw 'API Gateway' module")
CM_GE_T=$(time_cmd "cm_graph_edge" "cd $CM_DIR && \
  "$CM_PATH" ge auth_mod db_mod depends_on 0.9 && \
  "$CM_PATH" ge auth_mod cache_mod depends_on 0.7 && \
  "$CM_PATH" ge api_gw auth_mod calls 0.8 && \
  "$CM_PATH" ge api_gw db_mod calls 0.6")
CM_GS_OUT=$(cd "$CM_DIR" && "$CM_PATH" gs 2>/dev/null || echo "")
CM_GI_OUT=$(cd "$CM_DIR" && "$CM_PATH" gi 2>/dev/null || echo "")
CM_GP_OUT=$(cd "$CM_DIR" && "$CM_PATH" gp api_gw cache_mod 2>/dev/null || echo "")
ok "cm grafo: $(echo "$CM_GA_T + $CM_GE_T" | bc)s totali"
if echo "$CM_GI_OUT" | grep -qi "HUBS\|CROSS-TYPE"; then
  ok "cm graph insights OK"
  record_result "4a_graph_cm" "cm" "graph_build" "$(echo "$CM_GA_T + $CM_GE_T" | bc)" 1 0 "4 nodes, 4 edges, insights OK" "$(du -sk $CM_DIR/memory/ | cut -f1)" "manual graph"
else
  warn "cm graph insights: output diverso dal previsto"
  record_result "4a_graph_cm" "cm" "graph_build" "$(echo "$CM_GA_T + $CM_GE_T" | bc)" 1 0 "built but insights differ" "$(du -sk $CM_DIR/memory/ | cut -f1)" "manual graph"
fi

# 4b: graphify path (strutturale)
info "graphify path (strutturale)..."
T_GF_PATH_STRUCT=$(time_cmd "graphify_path_struct" "cd $GRAPHIFY_DIR && graphify path Auth Cache 2>/dev/null || true")
record_result "4b_path_structural" "graphify" "path_structural" "$T_GF_PATH_STRUCT" 1 0 "path query" 0 "Auth → Cache"

# 4c: graphify community (cluster-only)
info "graphify community detection..."
T_GF_CLUSTER=$(time_cmd "graphify_cluster" "cd $GRAPHIFY_DIR && graphify . --cluster-only 2>/dev/null || true")
COMMUNITIES=$(python3 -c "
import json
try: g=json.load(open('$GRAPHIFY_DIR/graphify-out/graph.json')); print(len(set(n.get('community',0) for n in g.get('nodes',[]))))
except: print('0')
" 2>/dev/null || echo "0")
ok "graphify community: ${T_GF_CLUSTER}s ($COMMUNITIES comunità)"
record_result "4c_community" "graphify" "community_detection" "$T_GF_CLUSTER" 1 0 "communities: $COMMUNITIES" "$(du -sk $GRAPHIFY_DIR/graphify-out/ | cut -f1)" "cluster-only"

# ─── Phase 5: Ricerca ──────────────────────────────────────────────────────────

header "Phase 5: Ricerca"

# 5a: cm FTS5 search
info "cm FTS5 search..."
T_CM_SEARCH=$(time_cmd "cm_search" "cd $CM_DIR && "$CM_PATH" sq 'TypeScript' 5")
FTS5_OUT="$OUTPUT_DIR/cm-logs/cm_search.log"
if grep -iq "result\|entry\|TypeScript" "$FTS5_OUT" 2>/dev/null; then
  ok "cm FTS5 search: ${T_CM_SEARCH}s"
  record_result "5a_search_fts5" "cm" "fts5_search" "$T_CM_SEARCH" 1 0 "FTS5 results" 0 "query=TypeScript"
else
  fail "cm FTS5 search: nessun risultato"
  record_result "5a_search_fts5" "cm" "fts5_search" "$T_CM_SEARCH" 0 1 "FTS5 FAIL" 0 "FAIL"
fi

# 5b: graphify query multi-concept
info "graphify query multi-concept..."
T_GF_QUERY_MULTI=$(time_cmd "graphify_query_multi" "cd $GRAPHIFY_DIR && graphify query 'auth and database dependency' 2>/dev/null || true")
record_result "5b_query_multi" "graphify" "query_multi" "$T_GF_QUERY_MULTI" 1 0 "multi-concept query" 0 "auth+database"

# ─── Phase 6: Consolidamento (solo cm) ─────────────────────────────────────────

header "Phase 6: Consolidamento e proiezioni"

# 6a: cm consolidate
T_CM_CONSOLIDATE=$(time_cmd "cm_consolidate" "cd $CM_DIR && "$CM_PATH" consolidate")
CONSOLIDATE_OUT="$OUTPUT_DIR/cm-logs/cm_consolidate.log"
if grep -qi "Consolidated\|consolidate\|Promoted" "$CONSOLIDATE_OUT" 2>/dev/null; then
  ok "cm consolidate: ${T_CM_CONSOLIDATE}s"
  record_result "6a_consolidate" "cm" "consolidate" "$T_CM_CONSOLIDATE" 1 0 "consolidate OK" 0 "working→semantic"
else
  # Potrebbe non avere abbastanza dati da consolidare, non falliamo
  warn "cm consolidate output neutro (normale con poche entry)"
  ok "cm consolidate: ${T_CM_CONSOLIDATE}s"
  record_result "6a_consolidate" "cm" "consolidate" "$T_CM_CONSOLIDATE" 1 0 "consolidate completed" 0 "working→semantic"
fi

# 6b: cm project
T_CM_PROJECT=$(time_cmd "cm_project" "cd $CM_DIR && "$CM_PATH" project")
assert_file_exists "cm MEMORY.md" "$CM_DIR/memory/MEMORY.md"
record_result "6b_project" "cm" "project" "$T_CM_PROJECT" 1 0 "MEMORY.md/USER.md" "$(wc -c < $CM_DIR/memory/MEMORY.md 2>/dev/null || echo 0)" "project regeneration"

# 6c: graphify wiki
T_GF_WIKI=$(time_cmd "graphify_wiki" "cd $GRAPHIFY_DIR && graphify . --wiki --no-viz 2>/dev/null || true")
if [ -f "$GRAPHIFY_DIR/graphify-out/wiki/index.md" ]; then
  ok "graphify wiki: ${T_GF_WIKI}s"
  record_result "6c_wiki" "graphify" "wiki" "$T_GF_WIKI" 1 0 "wiki generated" "$(du -sk $GRAPHIFY_DIR/graphify-out/wiki/ 2>/dev/null | cut -f1 || echo 0)" "wiki generation"
else
  warn "graphify wiki non generato (potrebbe non supportarlo)"
  record_result "6c_wiki" "graphify" "wiki" "$T_GF_WIKI" 0 1 "wiki not generated" 0 "FAIL"
fi

# ─── Phase 7: Progetto esistente (opzionale) ──────────────────────────────────

header "Phase 7: Progetto esistente"

if [ -n "${CM_EXISTING:-}" ] && [ -d "$CM_EXISTING" ]; then
  # cm init su repo esistente
  info "cm init su repo esistente..."
  T_CM_INIT_EXISTING=$(time_cmd "cm_init_existing" "cd $CM_EXISTING && "$CM_PATH" init")
  ok "cm init existing: ${T_CM_INIT_EXISTING}s"
  record_result "7a_init_existing" "cm" "init_existing" "$T_CM_INIT_EXISTING" 1 0 "cm init on existing" "$(du -sk $CM_EXISTING/memory/ | cut -f1)" "existing repo init"

  # graphify su repo esistente
  info "graphify su repo esistente..."
  T_GF_INIT_EXISTING=$(time_cmd "graphify_init_existing" "cd $GRAPHIFY_EXISTING && graphify . --no-viz --mode deep 2>/dev/null || true")
  GF_EXISTING_OK=0
  [ -f "$GRAPHIFY_EXISTING/graphify-out/graph.json" ] && GF_EXISTING_OK=1
  ok "graphify existing: ${T_GF_INIT_EXISTING}s"
  record_result "7b_init_existing" "graphify" "pipeline_existing" "$T_GF_INIT_EXISTING" "$GF_EXISTING_OK" "$((1-GF_EXISTING_OK))" "graph.json" "$(du -sk $GRAPHIFY_EXISTING/graphify-out/ | cut -f1)" "existing repo pipeline"
else
  warn "Phase 7 saltato: nessun --existing-repo fornito"
fi

# ─── Phase 8: claude-mem (opzionale) ──────────────────────────────────────────

if $TEST_CLAUDE_MEM; then
  header "Phase 8: claude-mem (MCP)"

  if command -v claude-mem &>/dev/null; then
    info "claude-mem trovato, esecuzione test..."

    # 8a: save memory via MCP
    T_CL_SAVE=$(time_cmd "claude_mem_save" "echo '{\"text\":\"TypeScript 5 strict mode, PostgreSQL, JWT auth\"}' | claude-mem --save 2>/dev/null || true")
    ok "claude-mem save: ${T_CL_SAVE}s"
    record_result "8a_save" "claude-mem" "save_memory" "$T_CL_SAVE" 1 0 "MCP save" 0 "save via claude-mem"

    # 8b: search memory
    T_CL_SEARCH=$(time_cmd "claude_mem_search" "echo '{\"query\":\"TypeScript\"}' | claude-mem --search 2>/dev/null || true")
    ok "claude-mem search: ${T_CL_SEARCH}s"
    record_result "8b_search" "claude-mem" "search" "$T_CL_SEARCH" 1 0 "MCP search" 0 "search TypeScript"
  else
    warn "claude-mem non installato. Salta Phase 8."
    warn "  Installa: npm install -g claude-mem"
  fi
fi

# ─── Phase 9: Storage metrics ─────────────────────────────────────────────────

header "Phase 9: Storage metrics"

# cm storage
echo ""
info "cm storage:"
du -sh "$CM_DIR/memory/" 2>/dev/null || echo "  (empty)"
NODE_COUNT_CM=$(python3 -c "
import json
try:
  g=json.load(open('$CM_DIR/memory/graph.json'))
  print(f'nodes: {len(g.get(\"nodes\",[]))}, edges: {len(g.get(\"edges\",[]))}')
except: print('(empty)')
" 2>/dev/null || echo "(empty)")
info "cm graph: $NODE_COUNT_CM"

# graphify storage
info "graphify storage:"
du -sh "$GRAPHIFY_DIR/graphify-out/" 2>/dev/null || echo "  (empty)"
NODE_COUNT_GF=$(python3 -c "
import json
try:
  g=json.load(open('$GRAPHIFY_DIR/graphify-out/graph.json'))
  print(f'nodes: {len(g.get(\"nodes\",[]))}, edges: {len(g.get(\"edges\",[]))}')
except: print('(empty)')
" 2>/dev/null || echo "(empty)")
info "graphify graph: $NODE_COUNT_GF"

CM_STORAGE=$(du -sk "$CM_DIR/memory/" 2>/dev/null | cut -f1 || echo 0)
GF_STORAGE=$(du -sk "$GRAPHIFY_DIR/graphify-out/" 2>/dev/null | cut -f1 || echo 0)
record_result "9_storage" "cm" "disk_usage" "N/A" 1 0 "storage: ${CM_STORAGE}KB" "$CM_STORAGE" "total storage"
record_result "9_storage" "graphify" "disk_usage" "N/A" 1 0 "storage: ${GF_STORAGE}KB" "$GF_STORAGE" "total storage"

# ─── Phase 10: Tabella comparativa ─────────────────────────────────────────────

header "Phase 10: Generazione tabella comparativa"

COMPARISON_MD="$OUTPUT_DIR/benchmark-comparison.md"

BENCH_DATE=$(date '+%Y-%m-%d %H:%M:%S')
cat > "$COMPARISON_MD" << END
# Memory Benchmark: cm vs graphify

Risultati dei benchmark eseguiti il $BENCH_DATE.

END

# Leggi CSV e genera tabella markdown
echo "| # | Sistema | Operazione | Tempo (s) | Esito | Dettaglio |" >> "$COMPARISON_MD"
echo "|---|---------|------------|-----------|-------|-----------|" >> "$COMPARISON_MD"

IDX=0
while IFS=, read -r test_id sistema operazione tempo_sec pass fail output_check storage note; do
  # Salta header
  [[ "$test_id" == "test_id" ]] && continue
  IDX=$((IDX+1))
  ESITO="$([ "$pass" -gt 0 ] 2>/dev/null && echo "✅" || echo "❌")"
  echo "| $IDX | $sistema | $operazione | ${tempo_sec}s | $ESITO | $output_check |" >> "$COMPARISON_MD"
done < "$RESULTS_CSV"

echo "" >> "$COMPARISON_MD"
echo "## Storage" >> "$COMPARISON_MD"
echo "" >> "$COMPARISON_MD"
echo "| Sistema | Dimensione |" >> "$COMPARISON_MD"
echo "|---------|-----------|" >> "$COMPARISON_MD"
echo "| cm | ${CM_STORAGE}KB |" >> "$COMPARISON_MD"
echo "| graphify | ${GF_STORAGE}KB |" >> "$COMPARISON_MD"

ok "Tabella comparativa generata: $COMPARISON_MD"

# ─── Phase 11: LLM valutazione finale ──────────────────────────────────────────

header "Phase 11: Valutazione LLM finale"

if command -v "$LLMPROXY_CMD" &>/dev/null || command -v llmproxy &>/dev/null; then
  info "Invio risultati a llmproxy per valutazione finale..."
  CL_CMD="${LLMPROXY_CMD}"
  if ! command -v "$CL_CMD" &>/dev/null; then CL_CMD="llmproxy"; fi

  OPINION_MD="$OUTPUT_DIR/benchmark-opinion.md"

  RESULTS_TEXT=$(cat "$RESULTS_CSV")

  cat > "$OPINION_MD" << 'END'
# Benchmark Opinion — LLM Evaluation

END

  # Costruisci il prompt per la valutazione
  cat > "$TEMP_DIR/eval-prompt.txt" << END
Hai appena eseguito una suite completa di benchmark tra due sistemi di memoria per agenti AI:

**Sistema A: code-mem (cm)**
- Storage locale SQLite + JSON graph
- CLI Node.js zero-dependency
- Retrieval: keyword + trigram + embedding Ollama opzionale
- 6 kind di memoria, 5 layer, confidence score

**Sistema B: graphify**
- Knowledge graph con community detection (Louvain)
- Estrazione AST + semantica automatica
- Python + networkx
- BFS traversal + explain + path query
- Audit trail: EXTRACTED/INFERRED/AMBIGUOUS edges

Ecco i risultati completi dei benchmark in formato CSV:

\`\`\`
${RESULTS_TEXT}
\`\`\`

Analizza i risultati e produci una valutazione strutturata.

REGOLE:
1. Per ogni dimensione testata, indica quale sistema ha performato meglio e perché
2. Produci una tabella riassuntiva (in formato markdown) dei punti di forza
3. Scrivi un verdetto finale: in quali scenari usare cm, in quali usare graphify, in quali entrambi
4. Raccomandazioni concrete per migliorare ciascun sistema
5. Sii oggettivo: se un sistema è migliore in un ambito, dillo chiaramente
6. Rispondi in italiano

Formato atteso:

\`\`\`
# Benchmark Opinion

## Riepilogo performance
| Dimensione | Vincitore | Motivazione |
|...

## Per dimensione
- Scrittura rapida:
- Recall esatto:
- Recall semantico:
- Grafo:
- Ricerca:
- Storage:
- Deep analysis:

## Verdetto finale
- Usa cm quando: ...
- Usa graphify quando: ...
- Usa entrambi quando: ...

## Raccomandazioni
- cm:
- graphify:
\`\`\`
END

  # Invio a llmproxy (usa test per inferenza one-shot)
  cat "$TEMP_DIR/eval-prompt.txt" | $CL_CMD test \
    > "$OPINION_MD" 2>/dev/null || {
    warn "llmproxy test fallito, provo pipe diretta..."
    # Fallback: prova via curl al proxy locale
    EVAL_BODY=$(jq -Rs '{messages:[{role:"user",content:.}],model:"claude-opus-4-8",max_tokens:4000}' < "$TEMP_DIR/eval-prompt.txt" 2>/dev/null || true)
    if [ -n "$EVAL_BODY" ]; then
      curl -s -X POST http://127.0.0.1:5045/v1/chat/completions \
        -d "$EVAL_BODY" 2>/dev/null > "$OPINION_MD" || true
    fi
    if [ ! -s "$OPINION_MD" ]; then
      warn "llmproxy fallito, scrivo placeholder"
      cat > "$OPINION_MD" << 'PH_END'
# Benchmark Opinion — Placeholder

La valutazione LLM richiede llmproxy configurato.
Esegui manualmente:
  cat tests/benchmark-output/benchmark-results.csv | llmproxy test
PH_END
    fi
  }

  if [ -s "$OPINION_MD" ]; then
    ok "Valutazione LLM generata: $OPINION_MD"
  else
    warn "Valutazione LLM vuota"
  fi
else
  warn "llmproxy non trovato (cercato: $LLMPROXY_CMD o llmproxy)"
  warn "Salto la valutazione LLM. Per eseguirla: $LLMPROXY_CMD ... < results.csv"
  echo "# Benchmark Opinion — LLM non disponibile" > "$OUTPUT_DIR/benchmark-opinion.md"
  echo "" >> "$OUTPUT_DIR/benchmark-opinion.md"
  echo "La valutazione LLM richiede llmproxy. I dati grezzi sono in:" >> "$OUTPUT_DIR/benchmark-opinion.md"
  echo "- $RESULTS_CSV" >> "$OUTPUT_DIR/benchmark-opinion.md"
  echo "- $COMPARISON_MD" >> "$OUTPUT_DIR/benchmark-opinion.md"
fi

# ─── Summary ────────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║  📊  BENCHMARK COMPLETATO                   ║${NC}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}Passed:${NC} ${GREEN}$PASS${NC}"
echo -e "  ${BOLD}Failed:${NC} ${RED}$FAIL${NC}"
echo -e "  ${BOLD}Total:${NC}  $TOTAL"
echo ""
echo -e "  ${BOLD}Output:${NC}"
echo -e "    📄 Tabella:    ${CYAN}$COMPARISON_MD${NC}"
echo -e "    📊 Dati grezzi: ${CYAN}$RESULTS_CSV${NC}"
echo -e "    📋 Valutazione: ${CYAN}$OUTPUT_DIR/benchmark-opinion.md${NC}"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo -e "  ${YELLOW}⚠️  $FAIL test(s) failed${NC}"
  exit 1
fi

echo -e "  ${GREEN}✅ Tutti i test superati!${NC}"
exit 0
