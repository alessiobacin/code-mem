# Auto-improve audit 360° — AUDIT-20260903124328-BA4E29C7

- **Progetto**: code-mem — `/Users/alessiobacin/Desktop/code-mem`
- **Modalità**: read-only (nessuna modifica: `git status --short` vuoto nell'evidence pack; nessun write eseguito)
- **Strumenti usati**: read/grep/find locali, `auto_improve_web_search`, `auto_improve_web_fetch` (solo fonti ufficiali HTTPS)
- **Docs consultati**: `README.md`, `docs/COMPARISON.md`, `tests/benchmark-output/*`, memoria progetto `.pi/extensions/yano-orchestrator/memory/project.md`
- **File di codice analizzati**: `src/main.js`, `src/storage.js`, `src/semantic.js`, `src/retrieval.js`, `src/embed.js`, `src/update.js`, `src/globals.js`, `src/capture.js`, `src/help.js`, `src/db.js` (parziale), `bin/cm` (lock/watch/prune), `tests/non-regression/cm-cli.test.mjs` (integrale), `tests/test-e2e.sh`, `tests/run-*.sh`, `install.sh`, `package.json`

---

## 1. Missione / capability principale

**FACT** — `README.md` (header) + `package.json` (0 dipendenze) + `src/globals.js` (bundle CJS):

> Memoria persistente **local-first** per agenti di coding e sviluppatori, **agent-agnostica** (Claude, Codex, Cursor, Pi, CLI), **zero dipendenze** (Node 22+, `node:sqlite`), singolo CLI `cm` distribuito come bundle monofile `bin/cm` generato da frammenti `src/`. Include: memorie tipizzate (6 kind / 5 layer), lifecycle `contested/corrected/obsolete`, FTS5 su conversazioni, vettori trigram deterministici + upgrade opzionale Ollama (`nomic-embed-text`), grafo leggero JSON+SQLite, proiezioni `MEMORY.md`/`USER.md`, merge deterministico export/import, daemon watch, hook SessionStart.

**Posizionamento dichiarato** (README): unico sistema con zero dipendenze + agent-agnostic + local-first in un solo binario. Sync cloud e REST API sono **fuori scope by design** (docs/COMPARISON.md sezione "2026 Update" — FACT documentato).

---

## 2. Evidenze verificate sul codice (FACT)

| Area | Evidenza | Verifica |
|---|---|---|
| Build | `build/bundle.mjs` assembla `bin/cm` dai frammenti `src/`; `bin/package.json` type=commonjs | FACT (README, struttura `src/`) |
| Storage | SQLite `memory_items/context/links/vectors`, `messages`+FTS5, `graph_nodes/edges` | FACT (README, `storage.js`) |
| Transazioni | `withTransaction` BEGIN IMMEDIATE su upsert+context e item+vector | FACT (`storage.js:upsertMemoryItem`) |
| Dedup | trigram cosine > 0.65 su **ultimi 50** active same-kind; `--force` bypassa | FACT (`storage.js:findNearDuplicate`) |
| Correction lifecycle | `contested:/corrected:/obsolete:` transiziona la memoria referenziata; `corrected_by` | FACT (`storage.js:applyCorrectionStatus`) — scansione **O(n) su tutti gli active** |
| Retrieval | ranking deterministico (keyword, recency, access, context, kind, graph, concept) + trigram + Ollama opzionale; modalità keyword/hybrid/semantic; `recall-auto` con temperature re-ranking T0/r (3 round) | FACT (`retrieval.js`) |
| Update integrity gate | SHA-256 del bundle vs manifest remoto `bin/cm.sha256`; mismatch → abort | FACT (`update.js`) — manifest **non presente nel repo locale** (solo remoto al momento del download) |
| Watch daemon | poll 30s, lock `memory/.watch.lock`, stale-lock recovery via `process.kill(pid,0)` | FACT (`bin/cm:acquireLock/watchLoop`) |
| Capture layer | `cm save --auto` scrive righe `messages`; hook SessionStart; heartbeat daemon | FACT (`capture.js`) |
| MCP | **nessun server MCP** nel prodotto: `grep -i mcp src/*.js` → 0 match; `.mcp.json`/`.pi/mcp.json` contengono solo config per tool terzi (chrome-devtools, github) | FACT |
| CI | `.github/` vuoto (solo `hooks/` vuoto); nessun workflow YAML nel repo | FACT |
| Lint | nessuno script/config lint (`package.json` scripts solo build/test; evidence pack `lint_configs: []`) | FACT |
| Versioni | `package.json: 0.1.0`, `bin/package.json: 0.0.1`, `src/globals.js VERSION = "0.6.0"`, README cita "Since v0.6.0" | FACT — **incoerenza** |
| Windows | `install.sh` usa curl/wget+chmod (POSIX); `update.js` usa `chmod +x` via execSync; solo `fsutil.js` ha fallback `USERPROFILE` | FACT (parziale) |
| Perf (misurata) | write burst 40 save ≈ 2.2–2.3s (≈55–57ms/op); recall p50/p95 ≈ 0.086–0.097/0.098–0.148s; top3 accuracy 0.60 (9/15) | FACT (`tests/benchmark-output/benchmark-results.csv`) |
| Benchmark vs graphify (ago 2026) | init .113s vs .075s; save_batch_10 .627s vs update .298s; recall_exact .094s vs query_exact .162s; FTS5 .065s; storage 44KB vs 52KB | FACT (`tests/benchmark-output/benchmark-comparison.md`) — run d'ambiente, non ri-eseguita |

**INFERENCE**: `checkOllama()` usa `execSync("curl …")` con timeout 3s ed è invocato a ogni `save` (semantic path) e a ogni tick del watch — costo subprocess per op incluso nei ~56ms misurati (piccolo ma reale). **HYPOTHESIS**: finestra dedup 50 e O(n) di correction degradano su archivi grandi (non testato: `BLOCKED`, no exec).

---

## 3. Confronto con alternative (fonti ufficiali verificate)

Query di discovery eseguite: `code-mem alternatives …`, `claude-mem github …`, `Mem0 memory layer …`, `Zep long-term memory … graphiti`. Fonti fetchate (tutte 200 OK):

1. https://github.com/thedotmack/claude-mem (+ raw README main)
2. https://github.com/mem0ai/mem0 (+ raw README main)
3. https://github.com/Graphify-Labs/graphify (+ raw README main)
4. https://raw.githubusercontent.com/getzep/zep/main/README.md

| Dimension | **code-mem** (attuale) | **claude-mem** (thedotmack) | **mem0** | **graphify** (Graphify-Labs) | **Zep / Graphiti** |
|---|---|---|---|---|---|
| Capability | memoria progetto CLI, local-first, agent-agnostic | capture sessioni + compressione AI + progressive disclosure, multi-agent | memory layer per app/agenti (user/session/agent) | knowledge graph del codebase (multimodale) | piattaforma cloud memory per agenti + Graphiti (temporal KG) |
| Stars / maturità | v0.6.0 (no dati stars) | 93.1k ★, v13.4.0 | 64.6k ★, YC S24 | 114k ★ | cloud commerciale; OSS CE **deprecato** |
| Licenza | MIT | Apache-2.0 (verificata) | Apache-2.0 (verificata) | conflitto: web meta Apache-2.0 vs docs interna MIT — **UNVERIFIED** | README non espone licenza — **UNVERIFIED** |
| MCP | **assente** | **4 MCP tool** (`search`, `timeline`, `get_observations`, 3-layer) — verificato | skills per Claude Code/Codex/Cursor/Windsurf/OpenCode/OpenClaw; server MCP **non verificato** | `--mcp` stdio server — verificato | plugin Claude Code/Codex/Cursor + Desktop (repo separati) |
| API | CLI locale | CLI + worker HTTP API (Bun) + web viewer | REST API + SDK (py/ts) + CLI `@mem0/cli` | CLI + skill | REST + SDK py/ts/go + ingestion |
| Search/retrieval | FTS5 + ranking deterministico + trigram (+Ollama opzionale) | ibrido Chroma (semantica+keyword) + compressione AI | ADD-only LLM, entity linking, temporal reasoning, multi-signal (BM25+semantic+entity) | AST tree-sitter + vision Claude, BFS/DFS, community detection (Leiden) | temporal knowledge graph |
| Qualità dichiarata | top3 0.60 (benchmark interno) | — (non riportato) | LoCoMo 92.5 / LongMemEval 94.4 / BEAM 64.1 (platform managed, self-riportati) | token reduction 71.5x (self-riportato, worked examples verificabili) | benchmark LoCoMo/LongMemEval in repo |
| Grafo | JSON+SQLite leggero, `cm gx html/svg/graphml/neo4j`, `cm query` | no | opzionale/relazionale | interattivo HTML (vis.js), Obsidian, wiki, graphml/neo4j | Graphiti temporal |
| Privacy | 100% locale | DB locale + **cloud sync opzionale** (cmem.ai) | dati su piattaforma (self-host possibile) | locale ma LLM Anthropic per estrazione | cloud |
| Deployment | 1 file, Node 22+ | Node 20+, Bun+uv, worker | pip/npm + server o API key | Python 3.10+ + Claude Code | cloud/SDK |
| Test/CI | test non-regression + e2e + benchmark scripts, **nessuna CI** | sviluppo attivo (CI non verificata qui) | framework benchmark open (memory-benchmarks) | badge CI nel README | eval-harness + benchmark |
| UX | CLI help lean/full, proiezioni MD | web viewer UI, skill `mem-search`, modalità lingua | dashboard (self-host/platform), demo, browser extension | graph.html interattivo, wiki per agenti | dashboard cloud |
| Connettori | hook harness (Claude/Codex/Cursor/Pi), `import --graphify/--claude-mem/--json` | plugin marketplace Claude Code, OpenCode/Antigravity/OpenClaw, Telegram/Discord/Slack | LangGraph, CrewAI, browser ext, Vercel AI SDK | git hook, --watch, wiki | LangGraph, CrewAI, AutoGen, ADK, Mastra, Vercel AI SDK, LiveKit, Pydantic |

Limite dichiarato: Letta/LangMem presenti solo nella comparazione interna (`docs/COMPARISON.md`), **non ri-verificati** in questa sessione. Nessuna fonte inventata: ogni dato di terze parti è ancorato alle URL sopra.

---

## 4. Gap matrix (attuale → alternative)

| Gap | Evidenza | Impatto | Priorità |
|---|---|---|---|
| **Nessun MCP** | grep src: 0 | agenti MCP-native non possono usare cm come tool; manca l'alternativa più diretta all'hook | alta |
| **Nessuna CI** | `.github/` vuoto | regressioni non rilevate automaticamente | alta |
| **Nessun lint** | package.json/no config | stile e bug semplici non catturati | media |
| **Versioni incoerenti** | 0.1.0 vs 0.6.0 vs 0.0.1 | confusione utenti/tooling | media |
| **Windows assente** | install.sh/update.js POSIX-only | piattaforma major esclusa | media |
| **Dedup window 50** | storage.js | duplicati vecchi sfuggono; commit precedenti mostrano già problemi di windowing | media-bassa |
| **Probe Ollama per save** | embed.js+execSync | latenza per op + subprocess | bassa |
| **Correction O(n)** | storage.js | degrada su archivi grandi | bassa |
| **No retention messages** | capture.js senza prune; solo `consolidate --prune` su confidence<0.3 età>90g | crescita illimitata del log | bassa (HYPOTHESIS) |
| **init fa `npm install`** | main.js:installAcornDeps (best-effort) | side-effect di rete durante init | bassa |
| **Nessun eval retrieval** | solo benchmark interno | non confrontabile con LoCoMo/LongMemEval pubblicati | media |

---

## 5. Proposte (IMP-01…IMP-14)

### IMP-01 — Server MCP stdio opzionale (`cm mcp`)
- classification: FACT | area: connector/tool | status: new
- finding: nessun server MCP in src/; claude-mem (4 tool MCP) e graphify (`--mcp`) lo offrono.
- evidence: grep src mcp = 0; README claude-mem (raw, sezione "MCP Search Tools"); README graphify (`--mcp`).
- impact: apre l'ecosistema MCP senza introdurre servizi di rete: stdio = locale.
- recommendation: modulo `src/mcp.js` esposto da `cm mcp` (stdio), tool `memory_search`/`memory_recall`/`memory_save`/`memory_plan` che riusano retrieval/plan esistenti; documentare e abilitare via `cm setup`.
- score: 8 | score_rationale: il gap MCP è il più visibile vs alternative.
- confidence: 8 — il gap è FACT; la domanda è inferenza qualitativa.
- value: 8 | complexity: Media | risk: Basso | requires_human_decision: **SÌ** (scope prodotto/filosofia: docs/COMPARISON.md esclude servizi, ma stdio non è un servizio di rete — decidere esplicitamente).

### IMP-02 — Pipeline CI (GitHub Actions)
- classification: FACT | area: tests/tooling | status: new
- finding: repo senza workflow; `npm test` esiste ma nessuno lo esegue in CI.
- evidence: `.github/` vuoto; evidence pack `ci_workflows: []`.
- impact: rileva regressioni su non-regression, e2e e build bundle a ogni push.
- recommendation: workflow con node:22: `node build/bundle.mjs && node --test tests/non-regression/ && bash tests/test-e2e.sh` (e2e isolato con HOME temporanea).
- score: 8 | score_rationale: assenza CI = rischio regressione implicito.
- confidence: 9 — assenza FACT; beneficio standard.
- value: 8 | complexity: Bassa | risk: Basso | requires_human_decision: **SÌ** (abilitazione Actions/hosting repo).

### IMP-03 — Lint/format su frammenti `src/` (Biome o ESLint)
- classification: FACT | area: quality | status: duplicate (mai evasa negli audit precedenti)
- finding: nessun lint; i frammenti `src/*.js` sono lintabili (il bundle `bin/cm` no, è generato).
- evidence: package.json (no lint), evidence pack `lint_configs: []`.
- impact: errori banali catturati prima della build.
- recommendation: `biome.json`/`eslint.config.js` su `src/` + script `lint` + guard in CI.
- score: 5 | score_rationale: beneficio quality ma non blocca utenti.
- confidence: 9.
- value: 5 | complexity: Bassa | risk: Basso | requires_human_decision: **NO**.

### IMP-04 — Versione unica (fix 0.1.0/0.6.0/0.0.1)
- classification: FACT | area: bug/technical | status: new
- finding: `package.json: 0.1.0`, `bin/package.json: 0.0.1`, `globals.js VERSION="0.6.0"`, README "Since v0.6.0".
- evidence: i tre file citati.
- impact: `cm version` (0.6.0) ≠ versione npm (0.1.0): ambiguo per tooling e release.
- recommendation: unica fonte di verità (VERSION in globals + rigenerazione package.json in build) o bump a 0.6.0.
- score: 6 | score_rationale: incoerenza visibile ma non bloccante.
- confidence: 10 — FACT diretto.
- value: 6 | complexity: Bassa | risk: Basso | requires_human_decision: **NO**.

### IMP-05 — Supporto Windows
- classification: FACT (assenza) | area: feature/portability | status: new
- finding: install.sh (curl/chmod), update.js (chmod via sh), nessun handler Windows oltre USERPROFILE.
- evidence: install.sh righe 6-11/56-58; update.js `chmod +x`.
- impact: esclude una piattaforma major dal "single CLI".
- recommendation: `install.ps1`, `fs.chmodSync` portabile, `fetch` (Node 22) al posto di curl/wget, test in CI Windows.
- score: 6 | score_rationale: portabilità richiesta ma non confermata da utenti.
- confidence: 7 — assenza FACT, domanda inferenziale.
- value: 6 | complexity: Media | risk: Medio | requires_human_decision: **SÌ**.

### IMP-06 — Eval harness retrieval (stile LoCoMo/LongMemEval, top-K locale)
- classification: INFERENCE | area: tests/quality | status: new
- finding: benchmark interno top3=0.60 su workload CLI; competitor pubblicano metriche citabili (mem0 LoCoMo 92.5, LongMemEval 94.4 — platform, non OSS).
- evidence: tests/benchmark-output/benchmark-results.csv; README mem0 (tabella benchmark).
- impact: quantifica il gap di qualità retrieval e rende confrontabile il prodotto.
- recommendation: mini-corpus dev replicabile (task di recall, top-1/3/5, latenza) in `tests/eval/`, pubblicare numeri in docs/COMPARISON.md.
- score: 6 | score_rationale: valore di credibilità alto, sforzo medio-alto.
- confidence: 6.
- value: 6 | complexity: Media-Alta | risk: Basso | requires_human_decision: **SÌ** (investimento tempo).

### IMP-07 — Allargare finestra dedup (o sweep programmato)
- classification: FACT (code) + HYPOTHESIS (impatto) | area: technical | status: new
- finding: `findNearDuplicate` confronta solo gli ultimi 50 active (`LIMIT 50`).
- evidence: storage.js.
- impact: duplicati vecchi non intercettati; commit `031dab2` documenta già un falso positivo di windowing.
- recommendation: iterare su tutti gli active (con early-exit) o `cm update --clean` periodico sull'intero archivio.
- score: 5 | score_rationale: correttezza a lungo termine, impatto non misurato.
- confidence: 6.
- value: 5 | complexity: Bassa | risk: Basso | requires_human_decision: **NO**.

### IMP-08 — Cache disponibilità Ollama
- classification: INFERENCE | area: performance | status: new
- finding: `checkOllama()` spawna curl (timeout 3s) via execSync; chiamato a ogni save e ogni tick watch.
- evidence: embed.js:2-18; semantic.js.
- impact: overhead subprocess per op incluso nei ~56ms misurati; evitabile con memoizzazione (TTL ~30-60s).
- recommendation: cache in-process/static con TTL; nessun cambio funzionale.
- score: 4 | score_rationale: il costo esiste ma è già dentro i benchmark.
- confidence: 6.
- value: 4 | complexity: Bassa | risk: Basso | requires_human_decision: **NO**.

### IMP-09 — Retention del capture layer
- classification: HYPOTHESIS | area: technical/UX | status: new
- finding: capture scrive righe messages per-sessione senza prune; unico prune esistente è `consolidate --prune` su memory_items (confidence<0.3, età>90g).
- evidence: capture.js; bin/cm:3372-3401.
- impact: crescita illimitata di state.db nel lungo periodo (non misurata).
- recommendation: policy retention configurabile (es. `--keep-days 180`) in `cm watch`/`consolidate`.
- score: 4 | score_rationale: prevenzione, crescita non dimostrata.
- confidence: 5.
- value: 4 | complexity: Bassa | risk: Basso | requires_human_decision: **SÌ** (scelta policy di default).

### IMP-10 — `init` senza side-effect di rete (acorn lazy)
- classification: FACT | area: UX/technical | status: new
- finding: `cm init` lancia `installAcornDeps()` (npm install in ~/.cm/deps) best-effort.
- evidence: main.js init; scanner.js:17.
- impact: sorpresa in ambienti offline/aziendali; mina l'aspettativa "zero dipendenze".
- recommendation: installazione lazy al primo `cm scan --deep`/`cm entities` che ne ha bisogno, con messaggio esplicito.
- score: 5 | score_rationale: comportamento FACT, severità opinabile.
- confidence: 8.
- value: 5 | complexity: Bassa | risk: Basso | requires_human_decision: **NO**.

### IMP-11 — SECURITY.md + CHANGELOG + template issue/PR
- classification: FACT (assenza) | area: docs/community | status: new
- finding: root senza CHANGELOG.md/SECURITY.md/CONTRIBUTING.md; `.github/` senza template.
- evidence: ls radice.
- impact: onboarding contributori e report di sicurezza non strutturati.
- recommendation: aggiungere i 3 file + template minimali; citare il gate checksum in SECURITY.md.
- score: 4 | score_rationale: igiene progetto, valore basso-ma-reale.
- confidence: 9.
- value: 4 | complexity: Bassa | risk: Basso | requires_human_decision: **NO**.

### IMP-12 — Completions shell (bash/zsh/fish)
- classification: INFERENCE | area: UX | status: new
- finding: CLI ampia (30+ comandi) con help lean/full; nessun completion.
- evidence: help.js; nessun file completion nel repo.
- impact: UX terminale migliorabile.
- recommendation: generatore di completion da una tabella comandi unica (stessa fonte dell'help).
- score: 3 | score_rationale: nicety.
- confidence: 7.
- value: 3 | complexity: Bassa | risk: Basso | requires_human_decision: **NO**.

### IMP-13 — Correction lifecycle indicizzata
- classification: FACT | area: performance | status: new
- finding: `applyCorrectionStatus` scansiona TUTTI gli active per matchare il riferimento.
- evidence: storage.js.
- impact: O(n) per save di correzione; degrada su archivi grandi.
- recommendation: bound con FTS/LIKE su title+body (top-k) prima dello scan completo.
- score: 3 | score_rationale: esistenza FACT, impatto stimato.
- confidence: 8.
- value: 3 | complexity: Bassa | risk: Basso | requires_human_decision: **NO**.

### IMP-14 — Monitoraggio failure signal del trace (reliability)
- classification: INFERENCE | area: reliability | status: duplicate (tutti gli audit precedenti)
- finding: 1 `tool_execution_end ok:false` (bash del planner) nella finestra; `watchdog_unfinalized_run_detected` (run 01M0R6…, ~147s) — entrambi lato orchestratore, non prodotto.
- evidence: evidence pack `trace.failures` + record seq 107/137/138.
- impact: monitorabilità del flusso orchestrato, non del prodotto.
- recommendation: correlare i failure con i report task; alert sul watchdog (canali già usati: whatsapp/telegram).
- score: 4 | score_rationale: visibilità, causa non ispezionabile.
- confidence: 4 — causa `BLOCKED` (dettagli comando bash del planner non disponibili).
- value: 4 | complexity: Bassa | risk: Basso | requires_human_decision: **NO**.

---

## 6. Deduplicazione e stato raccomandazioni precedenti

- **Lint** → IMP-03 (duplicate, mai evasa).
- **Test suite riproducibile** → **evasa** (`npm test` esiste) — decaduta.
- **Build verificabile** → **evasa** (`npm run build` esiste) — decaduta.
- **Failure signal** → IMP-14 (duplicate).
- Gli audit precedenti erano stub preliminari non completati: nessuna proposta già approvata in conflitto.

## 7. Limiti e informazioni mancanti

- **BLOCKED**: nessuna esecuzione di test/benchmark (policy read-only; nessun tool exec). Numeri benchmark = artefatti esistenti, non ri-eseguiti.
- **UNVERIFIED**: licenza graphify (web meta Apache-2.0 vs docs interna MIT) e licenza Zep (README non la espone). Mem0 MCP server non verificato da fonte. Letta/LangMem non ri-fetchati.
- `state.db` root e `memory/` sono gitignorati → non versionati (non analizzati oltre). `mqtt/`, `agents/`, `reports/`, `.worktrees/` = infrastruttura yano-orchestrator, fuori perimetro prodotto.
- Web disponibile: 4/4 fetch OK; nessuna query fallita oltre i limiti dichiarati.

## 8. Decisione umana richiesta (sintesi)

Richiedono conferma planner/utente: **IMP-01 (MCP)**, **IMP-02 (CI)**, **IMP-05 (Windows)**, **IMP-06 (eval harness)**, **IMP-09 (retention policy)**. Le altre sono eseguibili senza decisione umana.

## 9. Handoff planner (sintesi)

1. Priorità alta: **IMP-01 MCP stdio** (gap competitivo reale), **IMP-02 CI**, **IMP-04 versione unica** (bug visibile).
2. Priorità media: IMP-03 lint, IMP-05 Windows, IMP-06 eval, IMP-07/08/13 hardening retrieval.
3. Nessuna modifica effettuata; progetto intatto (read-only). Confidenza complessiva: 7/10 (FACT solidi su codice; giudizi di valore/domanda inferenziali).
