# MEMORY BENCHMARK — cm vs graphify vs claude-mem

> Guida completa per creare un ambiente di comparazione riproducibile tra i sistemi di memoria per agenti AI: **code-mem (cm)**, **graphify** e **claude-mem (MCP)**.

## Indice

1. [Panoramica](#1-panoramica)
2. [Setup dell'ambiente di test](#2-setup-dellambiente-di-test)
3. [Benchmark: cm vs graphify](#3-benchmark-cm-vs-graphify)
   - [3.1 Scrittura memoria (da zero)](#31-scrittura-memoria-da-zero)
   - [3.2 Scrittura memoria (progetto esistente)](#32-scrittura-memoria-progetto-esistente)
   - [3.3 Lettura e recall](#33-lettura-e-recall)
   - [3.4 Grafo: nodi, archi, percorsi](#34-grafo-nodi-archi-percorsi)
   - [3.5 Ricerca flessibile e fuzzy](#35-ricerca-flessibile-e-fuzzy)
   - [3.6 Consolidamento e proiezioni](#36-consolidamento-e-proiezioni)
   - [3.7 Metriche di storage](#37-metriche-di-storage)
4. [Benchmark: cm vs claude-mem](#4-benchmark-cm-vs-claude-mem)
   - [4.1 Salvataggio memoria](#41-salvataggio-memoria)
   - [4.2 Recall e ricerca semantica](#42-recall-e-ricerca-semantica)
   - [4.3 Memoria globale cross-progetto](#43-memoria-globale-cross-progetto)
5. [Metriche raccolte e formato](#5-metriche-raccolte-e-formato)
6. [Script automatico](#6-script-automatico)
7. [Tabella comparativa attesa](#7-tabella-comparativa-attesa)
8. [Valutazione LLM finale](#8-valutazione-llm-finale)

---

## 1. Panoramica

### Sistemi sotto test

| Sistema | CLI/Bin | Storage | Linguaggio | Comando principale |
|---------|---------|---------|------------|-------------------|
| **code-mem (cm)** | `cm` | SQLite + JSON graph | Node.js | `cm save/recall/ga/ge/sq` |
| **graphify** | `graphify` | `graphify-out/graph.json` + comunità | Python | `graphify <path>/query/path/explain` |
| **claude-mem** | MCP server | Remoto (cloud MCP) | Node.js | MCP tools: `search/save/timeline` |

### Cosa testiamo

Per ogni sistema misuriamo:

- **Tempo di inferenza** — quanto impiega l'operazione (seconds.millis)
- **Risposta attesa** — cosa DEVE contenere l'output per essere considerato PASS
- **Qualità** — accuratezza, completezza, ricchezza semantica
- **Dimensione storage** — quanto spazio occupa ogni memoria persistente

### Setup richiesto

```bash
# code-mem
curl -fsSL https://raw.githubusercontent.com/alessiobacin/code-mem/main/install.sh | bash

# graphify
pip install graphifyy

# claude-mem (se testato)
npm install -g claude-mem
# + configurazione MCP in claude.json
```

### Ambiente di test standardizzato

Creare due directory identiche per i test "da zero":

```bash
mkdir -p /tmp/bench-cm /tmp/bench-graphify /tmp/bench-claude-mem
```

Per i test "progetto esistente", clonare lo stesso repo in entrambe:

```bash
git clone <repo> /tmp/bench-cm-repo
cp -a /tmp/bench-cm-repo /tmp/bench-graphify-repo
```

---

## 2. Setup dell'ambiente di test

### 2.1 Repository identiche

Crea due copie identiche dello stesso progetto (esistente o minimale):

```bash
# Per test "da zero": progetto Node.js minimale
create_project_zero() {
  local dir="$1"
  mkdir -p "$dir/src" "$dir/docs"
  echo '{"name":"benchmark","version":"1.0.0"}' > "$dir/package.json"
  echo '{"compilerOptions":{"strict":true}}' > "$dir/tsconfig.json"
  cat > "$dir/src/index.ts" << 'EOF'
import { auth } from './auth';
import { db } from './database';
import { cache } from './cache';

export async function handler(req: Request) {
  const user = await auth.verify(req.headers.get('Authorization'));
  if (!user) return new Response('Unauthorized', { status: 401 });
  const data = await db.query(user.tenantId);
  return new Response(JSON.stringify(data));
}
EOF
  cat > "$dir/src/auth.ts" << 'EOF'
export async function verify(token: string) {
  // JWT verification logic
  return { id: 'user_1', tenantId: 'tenant_a', role: 'admin' };
}
export async function refresh(token: string) { return { token: 'new_' + token }; }
EOF
  cat > "$dir/src/database.ts" << 'EOF'
export class Database {
  async query(tenantId: string) { return [{ id: 1, name: 'item' }]; }
  async migrate() { /* run migrations */ }
  async rollback() { /* undo last migration */ }
}
export const db = new Database();
EOF
  cat > "$dir/src/cache.ts" << 'EOF'
export class Cache {
  private store = new Map<string, string>();
  async get(key: string) { return this.store.get(key); }
  async set(key: string, value: string) { this.store.set(key, value); }
  async invalidate(pattern: string) { this.store.clear(); }
}
EOF
  cat > "$dir/docs/ARCHITECTURE.md" << 'EOF'
# Architecture

The system uses a three-layer architecture:
- **Auth Layer**: JWT-based authentication with token refresh
- **Data Layer**: PostgreSQL database with multi-tenant isolation
- **Cache Layer**: Redis-based caching with TTL-based invalidation

Key decisions:
- Auth tokens expire after 1 hour
- Database migrations run at startup
- Cache invalidation happens on data mutation
EOF
  echo "Progetto creato in $dir"
}

# Per test "progetto esistente": clonare un repo reale
clone_existing_repo() {
  local repo="$1" dir_a="$2" dir_b="$3"
  git clone "$repo" "$dir_a"
  cp -a "$dir_a" "$dir_b"
}
```

### 2.2 Script di inizializzazione

```bash
init_cm() {
  cd "$1"
  cm init
  echo "cm initialized in $1"
}

init_graphify() {
  cd "$1"
  graphify . --no-viz --mode basic 2>&1 | tail -3
  echo "graphify initialized in $1"
}
```

---

## 3. Benchmark: cm vs graphify

### 3.1 Scrittura memoria (da zero)

#### Test 3.1a — Salvataggio fatti singoli (cm) vs add URL + rebuild (graphify)

| Step | cm | graphify |
|------|----|----------|
| **Comando** | `cm save --kind fact "..."` | `graphify add <url>` + `graphify update .` |
| **Cosa testa** | Scrittura SQLite veloce, indicizzazione | Fetch, parsing, estrazione nodi/archi |
| **Risposta attesa cm** | `Saved globally: <id>` in < 0.5s | — |
| **Risposta attesa graphify** | — | Output JSON con nodi estratti in < 10s |

**Esecuzione concreta:**

```bash
# === CM ===
cd /tmp/bench-cm

# Fatti tecnologici
time cm save --kind fact "Il progetto usa TypeScript 5 con strict mode"
time cm save --kind fact "Database: PostgreSQL con Drizzle ORM e multi-tenancy"
time cm save --kind fact "Autenticazione JWT con token refresh ogni 1 ora"
time cm save --kind fact "Cache: Redis / Valkey con invalidazione TTL"
time cm save --kind fact "UI: Tailwind CSS + shadcn/ui components"
time cm save --kind fact "Testing: Vitest + Playwright e2e"
time cm save --kind decision "Scelto server-side rendering per SEO"
time cm save --kind procedure --title "Database Migration" \
  "Usa Drizzle Kit per migrazioni, esegui sempre rollback test prima di apply"
time cm save --kind preference --layer user "Preferisci patch su rewrite"
time cm save --kind issue "Fake timers rompono i test in parallelo"

# === GRAPHIFY ===
cd /tmp/bench-graphify

# Aggiungiamo gli stessi fatti come URL/docs
# graphify non ha save-testuale, si aggiungono file .md
echo "# Technology Stack
TypeScript 5 strict mode, PostgreSQL + Drizzle ORM, JWT auth with 1h refresh,
Redis/Valkey cache with TTL invalidation, Tailwind CSS + shadcn/ui, Vitest + Playwright" \
  > tech-stack.md

echo "# Architecture Decisions
Server-side rendering for SEO
Database migrations via Drizzle Kit, always test rollback before apply
Prefer patches over complete rewrites
Fake timers break parallel tests" \
  > decisions.md

time graphify update .
```

**Output atteso:**
```
cm: ogni save → < 0.3s, totale ~3s per 10 entry
graphify: update → ~5-15s (dipende dalla dimensione del progetto)
```

#### Test 3.1b — Salvataggio strutturato con layer/tipi vs estrazione automatica

| Step | cm | graphify |
|------|----|----------|
| **Comando** | `cm save --kind <type> --layer <layer> "..."` | `graphify . --mode deep` |
| **Cosa testa** | Layer gerarchici della memoria | Estrazione AST + semantica + comunità |
| **Risposta attesa** | `Saved` con id layer-specific | JSON + GRAPH_REPORT con hub e cluster |

```bash
# === CM: salvataggio con layer specifici ===
cd /tmp/bench-cm
time cm save --kind procedure --layer procedural --title "Deploy Flow" \
  "Build → test → docker compose up → health check → smoke test"
time cm save --kind decision --layer semantic --title "API Design" \
  "REST su GraphQL per semplicità, versioning via /api/v1/"
time cm save --kind artifact --layer semantic --title "DB Schema" \
  "Schema multi-tenant: tenant_id su ogni tabella, RLS policy"

# === GRAPHIFY: estrazione automatica dal codice ===
cd /tmp/bench-graphify
time graphify . --mode deep --no-viz
```

### 3.2 Scrittura memoria (progetto esistente)

Per testare su un progetto reale (es. code-mem stesso):

```bash
# === Setup ===
git clone <url-repo> /tmp/bench-cm-existing
cp -a /tmp/bench-cm-existing /tmp/bench-graphify-existing

cd /tmp/bench-cm-existing
time cm init  # analizza il repo, importa eventuali legacy

cd /tmp/bench-graphify-existing
time graphify . --no-viz --mode deep  # estrazione completa
```

**Metriche raccolte:**

| Metrica | cm | graphify |
|---------|----|----------|
| **Tempo inizializzazione** | `time cm init` | `time graphify <path>` |
| **Memorie/entità trovate** | `cm ls \| wc -l` | Conteggio nodi in `graph.json` |
| **Relazioni estratte** | `cm gs` (edges count) | Conteggio archi in `graph.json` |
| **Community/Cluster** | N/A | Numero comunità da detection |
| **Dimensione storage** | `du -sh memory/` | `du -sh graphify-out/` |

### 3.3 Lettura e recall

#### Test 3.3a — Recall esatto (stessa parola)

```bash
# === CM ===
time cm recall "TypeScript" --level 2
# Atteso: trova "TypeScript 5 con strict mode" o simile
# tempo: < 0.2s

# === GRAPHIFY ===
time graphify query "TypeScript"
# Atteso: trova nodi TypeScript, strict mode, connessioni
# tempo: < 2s (include LLM reasoning)
```

#### Test 3.3b — Recall semantico (parola diversa, stesso concetto)

```bash
# === CM (trigram fallback) ===
time cm recall "typescritp strict" --level 2
# Atteso: trova TypeScript anche con typo
# qualità: trigram match su n-grammi

# === CM (hybrid mode con Ollama) ===
time cm recall "tipizzazione statica" --mode hybrid --level 2
# Atteso: trova TypeScript per similarità semantica
# qualità: embedding cosine similarity

# === GRAPHIFY ===
time graphify query "tipizzazione statica"
# Atteso: trova TypeScript attraverso il grafo delle connessioni
# qualità: BFS su grafo + LLM reasoning sul contesto
```

#### Test 3.3c — Recall complesso (relazioni multi-concetto)

```bash
# === CM: recall multi-tag ===
time cm recall "deploy autenticazione database" --level 3
# Atteso: trova procedure deploy + auth JWT + PostgreSQL
# Ranking: pesi combinati keyword + recency + link

# === GRAPHIFY: path query ===
time graphify path "Auth" "Database"
# Atteso: shortest path Auth → (qualcosa) → Database
# Esempio: Auth → middleware → query → Database
```

#### Test 3.3d — Plan (solo cm)

```bash
cm plan "fix authentication bug"
# Atteso: mostra piano di retrieval:
#   taskKind: debug
#   prioritizedKinds: issue, decision, procedure
#   searchKeys: auth, authentication, jwt, security
```

### 3.4 Grafo: nodi, archi, percorsi

#### Test 3.4a — Costruzione grafo manuale (cm) vs automatica (graphify)

```bash
# === CM: nodi manuali ===
cd /tmp/bench-cm
cm ga auth_mod "Auth Module" module
cm ga db_mod "Database Layer" module
cm ga cache_mod "Cache Layer" module
cm ga api_gw "API Gateway" module
cm ge auth_mod db_mod depends_on 0.9
cm ge auth_mod cache_mod depends_on 0.7
cm ge api_gw auth_mod calls 0.8
cm ge api_gw db_mod calls 0.6

time cm gi
# Atteso: HUBS e CROSS-TYPE edges

time cm gp api_gw cache_mod
# Atteso: shortest path con hop count

# === GRAPHIFY: grafo automatico dal codice ===
cd /tmp/bench-graphify
graphify . --directed --no-viz 2>&1 | tail -5

time graphify path "Auth" "Cache"
# Atteso: shortest path nel grafo automatico
```

#### Test 3.4b — Community/Hub detection

| Sistema | Comando | Atteso |
|---------|---------|--------|
| **cm** | `cm gi` | Elenco hub (nodi più connessi) e archi cross-tipo |
| **graphify** | `graphify . --cluster-only` | Comunità, hub per comunità, modularity score |

### 3.5 Ricerca flessibile e fuzzy

#### Test 3.5a — FTS5 conversation log (solo cm)

```bash
cd /tmp/bench-cm
cm sq "TypeScript" 5
# Atteso: risultati da messages_fts search
# Tempo: < 0.1s
```

#### Test 3.5b — Graph explain (solo graphify)

```bash
cd /tmp/bench-graphify
time graphify explain "TypeScript"
# Atteso: spiegazione in linguaggio naturale del nodo e dei suoi vicini
```

### 3.6 Consolidamento e proiezioni

#### Test 3.6a — Consolidate (solo cm)

```bash
cd /tmp/bench-cm
cm consolidate
# Atteso: promozione working→semantic, proiezione MEMORY.md + USER.md

cm project
# Atteso: MEMORY.md e USER.md rigenerati

# Verifica qualità:
grep -c "##" memory/MEMORY.md  # conteggio sezioni
wc -c memory/MEMORY.md          # dimensione in byte
```

#### Test 3.6b — Wiki (solo graphify)

```bash
cd /tmp/bench-graphify
graphify . --wiki --no-viz 2>&1 | tail -5
# Atteso: graphify-out/wiki/index.md generato

ls -la graphify-out/wiki/
wc -c graphify-out/wiki/index.md
```

### 3.7 Metriche di storage

```bash
echo "=== CM Storage ==="
du -sh /tmp/bench-cm/memory/
echo "state.db:" && ls -lh /tmp/bench-cm/memory/state.db
echo "graph.json:" && ls -lh /tmp/bench-cm/memory/graph.json
echo "Entry count:" && cm ls | head -1

echo ""
echo "=== GRAPHIFY Storage ==="
du -sh /tmp/bench-graphify/graphify-out/
echo "graph.json:" && ls -lh /tmp/bench-graphify/graphify-out/graph.json
echo "Node count:" && python3 -c "
import json; g=json.load(open('/tmp/bench-graphify/graphify-out/graph.json'))
print(f'nodes: {len(g[\"nodes\"])}, edges: {len(g[\"edges\"])}')
"
```

---

## 4. Benchmark: cm vs claude-mem

### Prerequisiti

```bash
npm install -g claude-mem
# Configurare MCP server in .claude/settings.json:
# {
#   "mcpServers": {
#     "claude-mem": {
#       "command": "claude-mem",
#       "args": ["--transport", "stdio"]
#     }
#   }
# }
```

### 4.1 Salvataggio memoria

#### Test 4.1a — Save singolo

| Sistema | Comando | Tempo atteso |
|---------|---------|--------------|
| **cm** | `cm save --kind fact "memoria di progetto"` | < 0.3s |
| **claude-mem** | `save_memory(text: "...", title: "...")` | 0.5-2s (remoto) |

```bash
# === CM (locale) ===
time cm save --kind fact "Il progetto è un'applicazione multi-tenant con PostgreSQL"

# === claude-mem (remoto MCP) ===
# Da eseguire via tool MCP o chiamata API diretta
# time claude-mem -- save '{"text":"Il progetto è un'applicazione multi-tenant con PostgreSQL"}'
```

#### Test 4.1b — Save multipli con layer (solo cm)

```bash
time cm save --kind decision --layer semantic "API versioning via /api/v1/"
time cm save --kind procedure --layer procedural "Deploy: test → build → push → restart"
time cm save --kind preference --layer user "Preferisci risposte concise"
```

### 4.2 Recall e ricerca semantica

#### Test 4.2a — Ricerca esatta

```bash
# === CM ===
time cm recall "PostgreSQL" --level 2

# === claude-mem (3-layer workflow) ===
# 1. search(query="PostgreSQL") → ottieni ID
# 2. timeline(anchor=ID) → contesto
# 3. get_observations([IDs]) → dettagli completi
```

#### Test 4.2b — Ricerca semantica

```bash
# === CM (Ollama embedding) ===
time cm recall "database relazionale multi-tenant" --mode hybrid --level 2

# === claude-mem ===
# search(query="database relazionale multi-tenant")
# Usa embedding ML built-in (non richiede Ollama)
```

### 4.3 Memoria globale cross-progetto

#### Test 4.3a — Global memory (solo cm)

```bash
cd /tmp/project-a
cm save --kind procedure --global "Deploy classico: chiedi conferma e usa Docker"

cd /tmp/project-b
cm init
cm recall "deploy Docker" --level 1
# Atteso: risultati etichettati [global] dalla memoria globale
```

#### Test 4.3b — Cross-project su claude-mem

```bash
# claude-mem è cloud-based, quindi la persistenza è automatica
# save_memory("Deploy flow: confirm then Docker deploy")
# search("deploy Docker") → trova ovunque
```

---

## 5. Metriche raccolte e formato

### Formato del risultato CSV

```csv
test_id,sistema,operazione,tempo_sec,pass,fail,output_parser,storage_kb,note
3.1a_save,cm,save_fact,0.042,1,0,"TypeScript trovato",4.2,"layer=semantic"
3.1a_save,graphify,update_batch,8.340,1,0,"OK",24.1,"5 file+auto-extract"
3.3a_recall,cm,recall_exact,0.015,1,0,"TypeScript 5",0,"keyword match"
3.3a_recall,graphify,query_exact,1.240,1,0,"TypeScript",0,"BFS+LLM path"
...
```

### Qualità del recall: scoring

| Score | Criterio |
|-------|----------|
| **PASS** (1.0) | Risultato contiene esattamente ciò che ci si aspetta |
| **FUZZY** (0.5) | Risultato contiene info correlate ma non esatte |
| **FAIL** (0.0) | Nessun risultato utile o risultato errato |

---

## 6. Script automatico

Lo script `tests/run-memory-benchmark.sh` esegue tutto automaticamente.

**Utilizzo:**

```bash
# Test base: cm vs graphify su progetto da zero
./tests/run-memory-benchmark.sh \
  --cm-path /path/to/cm-binary \
  --graphify-path /path/to/graphify-repo

# Test con progetto esistente
./tests/run-memory-benchmark.sh \
  --cm-path /path/to/cm-binary \
  --graphify-path /path/to/graphify-repo \
  --existing-repo /path/to/repo-to-test

# Test completo (cm + graphify + claude-mem)
./tests/run-memory-benchmark.sh \
  --cm-path /path/to/cm-binary \
  --graphify-path /path/to/graphify-repo \
  --claude-mem \
  --existing-repo /path/to/repo-to-test

# Solo su progetto da zero (nessun repo esistente)
./tests/run-memory-benchmark.sh \
  --cm-path /path/to/cm-binary \
  --graphify-path /path/to/graphify-repo \
  --from-scratch
```

**Output generati:**

```
tests/benchmark-output/
├── benchmark-results.csv      # Tutte le metriche grezze
├── benchmark-summary.json     # Riepilogo strutturato
├── benchmark-comparison.md    # Tabella comparativa formattata
├── benchmark-opinion.md       # Valutazione LLM finale
└── cm-logs/                   # Log dettagliati per cm
    └── graphify-logs/         # Log dettagliati per graphify
```

---

## 7. Tabella comparativa attesa

La tabella viene generata automaticamente dallo script. Struttura attesa:

| # | Test | cm (tempo) | graphify (tempo) | cm (qualità) | graphify (qualità) |
|---|------|-----------|-----------------|-------------|-------------------|
| T1 | Salva fatto singolo | 0.04s | 8.3s (batch) | PASS | PASS |
| T2 | Salva 10 memorie | 0.3s | 8.3s | PASS | PASS |
| T3 | Recall esatto | 0.015s | 1.2s | 1.0 | 1.0 |
| T4 | Recall semantico | 0.020s | 1.5s | 1.0 | 0.8 |
| T5 | Recall fuzzy (typo) | 0.020s | N/A | 0.8 | N/A |
| T6 | Grafo: nodi (10 nodi) | 0.1s | 5-15s (auto) | PASS | AUTOMATICO |
| T7 | Grafo: path query | 0.02s | 0.5s | PASS | PASS |
| T8 | Grafo: hub/statistiche | 0.01s | 1.0s | PASS | PASS |
| T9 | Ricerca FTS5 | 0.05s | N/A | PASS | N/A |
| T10 | Explain nodo | N/A | 2.0s | N/A | PASS |
| T11 | Community detection | N/A | 5-30s | N/A | PASS |
| T12 | Consolidamento | 0.5s | N/A | PASS | N/A |
| T13 | Proiezione/Wiki | 0.3s | 3-10s | PASS | PASS |
| T14 | Init progetto esistente | 0.5s | 10-60s | PASS | PASS |
| T15 | Storage totale | ~50KB | ~200KB+ | — | — |

**Legenda qualità:**
- **1.0**: Risultato perfetto, contiene tutto l'expected
- **0.8**: Risultato buono, contiene la maggior parte
- **0.5**: Risultato parziale, concetti correlati ma non esatti
- **0.0**: Fallimento, nessun risultato utile
- **N/A**: Operazione non applicabile a questo sistema
- **AUTOMATICO**: L'operazione non ha un expected value testabile, si valuta la presenza del risultato

---

## 8. Valutazione LLM finale

Dopo l'esecuzione di tutti i benchmark, lo script invoca lo stesso LLM (via `llmproxy`) per produrre una valutazione imparziale di entrambi i sistemi.

### Prompt inviato al LLM

```
Hai appena eseguito una suite completa di benchmark tra due sistemi di memoria per agenti AI:

**Sistema A: code-mem (cm)**
- Storage locale SQLite + JSON graph
- CLI Node.js zero-dependency
- Retrieval: keyword + trigram + embedding Ollama opzionale
- 6 kind di memoria, 5 layer, confidence score

**Sistema B: graphify**
- Knowledge graph con community detection
- Estrazione AST + semantica automatica
- Python + networkx
- BFS traversal + explain + path query

Ecco i risultati completi dei benchmark:
[RISULTATI CSV INCOLLATI QUI]

Analizza i risultati e produci:
1. Una tabella riassuntiva dei punti di forza di ciascun sistema
2. Per ogni dimensione testata (scrittura, lettura, grafo, ricerca, storage), quale sistema performa meglio e perché
3. Un verdetto finale: in quali scenari usare cm, in quali usare graphify
4. Eventuali raccomandazioni per miglioramenti
```

### Output atteso della valutazione

```
# Benchmark Opinion — LLM Evaluation

## Punti di forza
| Dimensione | Vincitore | Motivazione |
|-----------|-----------|-------------|
| Scrittura rapida | cm | ~0.04s per entry vs batch di minuti |
| Recall esatto | cm (pareggio) | Entrambi trovano, cm è 50x più veloce |
| Recall semantico | cm | Trigram + embedding > BFS per similarità semantica |
| Grafo automatico | graphify | AST reale vs nodi manuali |
| Path finding | graphify | BFS strutturato su grafo ricco |
| Community detection | graphify | Unico a supportarlo con modularity |
| Storage efficiency | cm | ~50KB vs ~200KB+ |
| Zero-dependency | cm | Node.js built-in vs Python stack |
| Spiegazione nodi | graphify | explain con LLM reasoning |

## Verdetto
- **Usa cm quando**: vuoi memoria veloce, leggera, zero-dipendenza, recall semantico, multi-sessione
- **Usa graphify quando**: vuoi esplorare la struttura di una codebase, trovare connessioni inaspettate, comunità nascoste
- **Usa entrambi quando**: vuoi memoria rapida (cm) + grafo profondo (graphify) — sono complementari

## Raccomandazioni
- [cm] Aggiungere export graph in formato GraphML per interoperabilità con graphify
- [graphify] Aggiungere salvataggio persistente ad alto livello (non solo grafo)
- ...
```
