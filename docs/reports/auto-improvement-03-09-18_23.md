# Auto-improve audit 360° — AUDIT-20260903162333-0B4656B0

- **Progetto**: code-mem — `/Users/alessiobacin/Desktop/code-mem`
- **Modalità**: read-only (nessun write sul progetto; unica scrittura: questo report)
- **Strumenti usati**: read/grep/find locali, `auto_improve_web_search` (4 query), `auto_improve_web_fetch` (4 fonti ufficiali HTTPS, tutte 200 OK)
- **Docs consultati**: `README.md`, `docs/COMPARISON.md`, `docs/reports/auto-improvement-03-09-12_43.md` (audit precedente), memoria progetto `.pi/extensions/yano-orchestrator/memory/project.md`, evidence pack `AUDIT-20260903162333-0B4656B0.json`
- **File analizzati**: `package.json`, `bin/package.json`, `bin/cm` (VERSION), `src/globals.js`, `src/storage.js`, `src/embed.js`, `src/update.js`, `src/main.js`, `src/help.js`, `install.sh`, `.mcp.json`, `.github/`, `skill/SKILL.md`, `tests/non-regression/cm-cli.test.mjs` (presenza), `tests/benchmark-output/*` (artefatti esistenti)
- **Modifiche al progetto**: nessuna

---

## 1. Missione / capability principale

**FACT** (`README.md` header, `package.json` zero dipendenze, `src/globals.js:21`):

> **Memoria persistente local-first per agenti di coding e sviluppatori, agent-agnostica** (Claude Code, Codex, Cursor, Pi, CLI), distribuita come **singolo CLI monofile** `bin/cm` (bundle generato da frammenti `src/`), **zero dipendenze esterne** (Node 22+, `node:sqlite`), **nessun servizio da eseguire**, **nessun database esterno**. Capability core: memorie tipizzate (6 kind / 5 layer) con lifecycle `active/archived/contested/corrected/obsolete`, FTS5 sulla conversazione, retrieval deterministico (keyword + recency + trigram, upgrade opzionale Ollama `nomic-embed-text`), grafo leggero JSON+SQLite, proiezioni `MEMORY.md`/`USER.md`, watch daemon, hook SessionStart (`cm init pi`), merge deterministico export/import, update con **integrity gate SHA-256** (`src/update.js:29-48,126-128`).

Differenziali dichiarati (README, non verificati qui come claim di marketing): "uno solo CLI, local files, nessun servizio, nessun DB esterno", "zero dipendenze".

**INFERENCE**: il posizionamento di code-mem è il più vicino a **basic-memory** (local-first + CLI + agent-agnostic) con la differenza architetturale che basic-memory usa Markdown come source of truth mentre code-mem usa SQLite (`state.db`) con Markdown come proiezione. **HYPOTHESIS**: questa scelta architetturale rende code-mem più robusto per scritture concorrenti di agenti ma meno "leggibile dall'umano senza tooling" (non testato).

---

## 2. Evidenze verificate in questa finestra (FACT, con file:line)

| Area | Evidenza | Verifica |
|---|---|---|
| Versioni | `globals.js:21` VERSION="0.6.0" == `bin/cm:26` "0.6.0" == `package.json` 0.1.0 == `bin/package.json` 0.0.1 → **4 versioni incoerenti** | FACT |
| MCP | `grep -i mcp src/` → 0 match; `.mcp.json` contiene solo server terzi (chrome-devtools, github copilot) | FACT |
| Docker/mcp_configs | solo `.mcp.json` e `.pi/mcp.json` (tool terzi) — **nessun server MCP first-party** | FACT |
| CI | `.github/` contiene solo `hooks/` **vuoto**; nessun workflow YAML | FACT |
| Lint | `package.json` scripts solo build/test; evidence pack `lint_configs: []` | FACT |
| Test | un solo test non-regression `tests/non-regression/cm-cli.test.mjs`; script `npm test` + `npm run build`; benchmark scripts presenti in `tests/` | FACT |
| Init side-effect | `src/main.js:70` `installAcornDeps()` best-effort durante `cm init` (npm install in ~/.cm) | FACT |
| Dedup window | `src/storage.js:119` `ORDER BY mi.updated_at DESC LIMIT 50` (finestra 50 per dedup fuzzy) | FACT |
| Ollama probe | `src/embed.js:3-13` `execSync("curl …")` con timeout 3s per ogni check | FACT |
| Update integrity | `src/update.js:29-48,126-128` SHA-256 vs manifest remoto; umbrella: niente write se mismatch | FACT |
| Import surfaces | `src/main.js:845` `cm import --graphify \| --claude-mem \| --json <bundle>` (no import conversazioni ChatGPT/Codex native) | FACT |
| Skill | `skill/SKILL.md` presente (skill standalone) | FACT |
| Windows | `install.sh:7,25-33` uname/curl/wget/chmod POSIX-only; nessun handler Windows | FACT |
| Trace finestra | 120 record, **0 failure, 0 feedback, 0 opinion**; segnali watchdog orchestratore non presenti nella finestra | FACT (evidence pack) |

**INFERENCE** (limite dichiarato): i benchmark (`tests/benchmark-output/benchmark-results.csv`, top3 0.60, write ~55ms/op) sono **artefatti esistenti non ri-eseguiti** (read-only, nessun exec autorizzato) → numeri citati come storici, non come misura di questa finestra.

---

## 3. Confronto con alternative (fonti ufficiali HTTPS verificate in questa sessione)

Query di discovery eseguite (`auto_improve_web_search`): "code-mem alternatives persistent memory for coding agents local-first CLI" · "agent memory MCP server semantic memory developer tools comparable claude-mem mem0 graphiti" · "code-mem API plugin connector memory system claude code MCP stdio local" · "basic-memory local-first markdown knowledge base MCP server claude memory". **Limite**: index npm non raggiungibile via tool (HTTP 400) — nessun dato npm usato; solo repository GitHub.

Fonti fetchate (4/4, status 200):
1. `https://raw.githubusercontent.com/thedotmack/claude-mem/main/README.md`
2. `https://raw.githubusercontent.com/mem0ai/mem0/main/README.md`
3. `https://raw.githubusercontent.com/getzep/graphiti/main/README.md`
4. `https://raw.githubusercontent.com/basicmachines-co/basic-memory/main/README.md`

### Matrice 360° — code-mem vs 4 alternative

| Dimension | **code-mem** (attuale) | **claude-mem / Grok Mem** | **Mem0** | **Graphiti (Zep)** | **basic-memory** |
|---|---|---|---|---|---|
| Capability | memoria progetto CLI local-first agent-agnostic | memoria cross-session per agent (+ ora Grok Bot): osservazioni automatiche, progressive disclosure, web viewer | memory layer (user/session/agent) con estrazione LLM ADD-only + entity linking | temporal knowledge graph per agenti (episodi, entità, fatti con validity window) | knowledge base locale Markdown + graph + semantic search, MCP-native |
| License | MIT | Apache-2.0 (README "License") | Apache-2.0 (README "License" + badge) | **UNVERIFIED** dal README (framework OSS; licenza non esposta nel README fetchato) | AGPL-3.0 (README badge) |
| Maturity / versione | v0.6.0 (interno) | v13.24.0 (badge README) | (README: PyPI/npm badge, no versione numerica) | (badge release non numerico nel fetch) | (PyPI badge, prerelease 0.23 menzionato) |
| MCP | **assente (FACT)** | **4 MCP tool** search/timeline/get_observations su pattern 3-layer ("~10x token savings") | skills per Claude Code/Codex/Cursor/Windsurf/OpenCode/OpenClaw (MCP non dichiarato nel README) | **MCP server** in `mcp_server/` (episodi, entità, search, gruppi, maintanance) | **MCP-native**: ~20 tool annotati con behavior hints (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`), stdio+https |
| API/tool | CLI solo | worker HTTP API (Bun) + CLI + viewer web + skill mem-search | REST API + SDK py/ts + CLI `@mem0/cli` + browser extension | REST FastAPI (`server/`) + SDK (indiretto) | CLI ricca + MCP + OpenAI-compatible `search`/`fetch` per ChatGPT Custom GPT |
| Retrieval | FTS5 + ranking deterministico + trigram (+ Ollama opzionale `nomic-embed-text`) | hybrid Chroma (semantica+keyword) + compressione AI + progressive disclosure | multi-signal: semantic + BM25 + entity linking + temporal reasoning (benchmark: LoCoMo 92.5, LongMemEval 94.4, BEAM 64.1/48.6 — self-riportati, platform) | hybrid semantic+keyword+graph traversal, rerank by graph distance | hybrid full-text+vector (FastEmbed), **cross-encoder reranker opzionale** (locale jina-reranker o via LiteLLM) |
| UX | CLI help lean/full, proiezioni MD | web viewer real-time, mode lingua, private-tag | dashboard self-host/platform | (dashboard solo in Zep managed) | CLI `--json`, dashboard di progetto, folder Markdown leggibile in Obsidian |
| UX agent/LLM | hook SessionStart, recall-auto, import dedup | plugin hooks 6 script, auto-observation off-plan, citations | skills standard (SDK in contesto), pipeline skill end-to-end | entità/relazioni tipizzate via Pydantic, structured output | tool annotations progressive discovery, session briefings pre-compaction, plugin Claude Code (`/basic-memory:*`) |
| Connettori/plugin | hook harness Claude/Codex/Cursor/Pi; import --graphify/--claude-mem; skill `skill/SKILL.md` | plugin marketplace Claude Code, OpenCode/Antigravity/OpenClaw, Telegram/Discord/Slack, Grok Bot | LangGraph, CrewAI, browser ext, Vercel AI SDK | LangGraph (LangChain), OpenAI-compatible local LLM (Ollama/vLLM) | plugin Claude Code + Hermes + OpenClaw, Obsidian, Codex, Cursor, VS Code, ChatGPT |
| Privacy | 100% locale, assenza telemetria (vantaggio) | DB locale + **cloud sync opzionale** cmem.ai | dati su piattaforma (self-host possibile) | **telemetria anonima opt-out** (README: PostHog, UUID anonimo, mai contenuti) | locale; **telemetria promozionale opt-out** (`BASIC_MEMORY_NO_PROMOS=1`) |
| Deployment | 1 file, Node 22+, zero deps, offline | Node 20+, Bun+uv, worker service | pip/npm + server Docker (`make bootstrap`) o API key | Python 3.10+ + **Neo4j/FalkorDB/Neptune/Kuzu** + OpenAI API key | Python 3.12+ via uv, SQLite o Postgres+Milvus, cloud opzionale ($15/mo) |
| Performance | benchmark interno top3 0.60, write ~55ms/op (storico, non ri-eseguito) | ~10x token savings (self-riportato) | latenza p50 0.88-1.09s (self-riportato, platform) | sub-second latency (self-riportato) | reranker opzionale: costa latenza, default off |
| Test/CI | test non-regression + e2e + benchmark scripts; **nessuna CI** | (README: development branch flow, CI non citata nel fetch) | benchmark framework open (`memory-benchmarks`) | **CI visibile**: lint/unit/typecheck badges | **CI visibile**: badge Tests + Ruff; pytest markers |
| Docs | README esteso, src/README, docs/ *COMPARISON obsoleto (vedi §4)* | docs.claude-mem.ai completo (architecture, hooks, search) | docs.mem0.ai + API reference + migration guide | help.getzep.com/graphiti + paper arXiv 2501.13956 | docs.basicmemory.com + CHANGELOG + plugin docs |

---

## 4. Gap matrix (attuale → alternative)

| # | Gap | Evidenza | Impatto | Priorità |
|---|---|---|---|---|
| G1 | **Nessun server MCP first-party** | grep src mcp=0; tutti i competitor (claude-mem, Graphiti, basic-memory) hanno MCP; mem0 ha skills | agenti MCP-native e client (Claude Desktop, VS Code) non possono usare cm come tool | **Alta** |
| G2 | **Nessuna CI** | `.github/` solo hooks/ vuoto | regressioni non rilevate in automatico nonostante test esistenti | **Alta** |
| G3 | **Versioni incoerenti (4 valori)** | 0.6.0 / 0.6.0 / 0.1.0 / 0.0.1 | confusione utenti, tooling e release; `cm version` ≠ npm | **Media** |
| G4 | **docs/COMPARISON.md obsoleto** | dichiara claude-mem "MCP cloud-based" e "Claude Code only": FALSO oggi (Grok Mem v13.24.0 multi-IDE, local observer opt-in) | documentazione competitiva fuorviante per le decisioni di roadmap | **Media** |
| G5 | **Nessun reranker semantico** | code-mem: solo trigram + temperature rerank deterministico; basic-memory: cross-encoder opzionale; Graphiti: rerank by graph distance | qualità retrieval sotto quella dei concorrenti su testi lunghi/parafrasi | **Media** |
| G6 | **Nessun health-check (doctor)** | basic-memory `bm doctor`; code-mem non ha verifica integrità DB-esportazioni | diagnosi manuale di DB corrotti/import falliti | **Media** |
| G7 | **Import conversazioni ChatGPT/Codex assenti** | main.js:845 solo --graphify/--claude-mem/--json; basic-memory `import claude conversations/chatgpt/memory-json` | onboarding dei log conversazione solo parziale | **Bassa-Media** |
| G8 | **Windows non supportato** | install.sh POSIX-only | piattaforma major esclusa da "single CLI" | **Media** |
| G9 | **Assenza lint** | package.json, lint_configs=[] | stile/errori banali non catturati | **Bassa-Media** |
| G10 | **Init con side-effect di rete** | main.js:70 installAcornDeps | sorpresa in ambienti offline | **Bassa** |
| G11 | **Finestra dedup 50** | storage.js:119 | duplicati vecchi sfuggono; già documentato falso positivo windowing (commit 031dab2) | **Bassa** |
| G12 | **Ollama probe senza cache** | embed.js execSync curl per op | overhead subprocess per op | **Bassa** |
| G13 | **Test limitati a 1 file** | tests/non-regression/ 1 file | copertura thin rispetto a superficie CLI (~35 comandi) | **Bassa-Media** |
| G14 | **No retention/purge capture** | capture.js scrive senza prune (salvo consolidate --prune) | crescita illimitata state.db (HYPOTHESIS, non misurato) | **Bassa** |

Vantaggi competitivi confermati (non gap): zero dipendenze (vs Graphiti Neo4j+LLM, basic-memory Python), assenza telemetria (vs Graphiti/basic-memory opt-out), MIT (vs AGPL basic-memory), offline totale, import claude-mem/graphify (G7 parziale), integrity gate SHA-256 su update (non visto nei competitor nel fetch).

---

## 5. Proposte

### IMP-15 — Server MCP stdio first-party (`cm mcp`)
- classification: FACT | area: connector/tool | status: duplicate (già IMP-01 nel report 12:43, non evasa: grep mcp=0 in questa finestra)
- finding: nessun MCP in src/; tutti i comparator hanno MCP (claude-mem 4 tool, Graphiti mcp_server, basic-memory ~20 tool con behavior hints).
- evidence: `grep -i mcp src/` → 0; README claude-mem (sezione MCP Search Tools); README Graphiti (sezione "MCP Server"); README basic-memory (tabella "MCP tools").
- impact: sblocca ecosistema MCP mantenendo local-first (stdio non è un servizio di rete).
- recommendation: modulo `src/mcp.js` esposto da `cm mcp` (stdio), tool `memory_search`, `memory_recall`, `memory_plan`, `memory_save` con pattern 3-layer ispirato a claude-mem (index → detail) e annotazioni behavior hints come basic-memory.
- score: 8 | score_rationale: gap MCP è il più visibile vs tutti i comparator verificati.
- confidence: 9 | confidence_rationale: assenza è FACT; domanda sul pattern è inferenza qualitativa.
- value: 8 | complexity: Media | risk: Basso | requires_human_decision: **SÌ** (decisione di scope: docs/COMPARISON.md escludeva servizi; stdio non è servizio, ma va deciso).

### IMP-16 — Pipeline CI (GitHub Actions) con test+build+lint
- classification: FACT | area: test/tooling | status: duplicate (già IMP-02 nel 12:43, non evasa)
- finding: `.github/` vuoto; `npm test` e `npm run build` esistenti ma mai eseguiti in CI.
- evidence: `ls .github/` → hooks/; evidence pack `ci_workflows: []`.
- impact: rileva regressioni a ogni push (surface CLI ampia, copertura thin).
- recommendation: workflow node:22 → `node build/bundle.mjs && node --test tests/non-regression/ && bash tests/test-e2e.sh` (+ lint se IMP-19 approvato).
- score: 8 | score_rationale: valore alto, costo bassissimo; parità con standard (Graphiti/basic-memory hanno CI badge).
- confidence: 9 | confidence_rationale: assenza FACT; beneficio standard.
- value: 8 | complexity: Bassa | risk: Basso | requires_human_decision: **SÌ** (abilitazione Actions/hosting).

### IMP-17 — Fonte unica di versione (fix 0.6.0/0.1.0/0.0.1)
- classification: FACT | area: bug/technical | status: duplicate (già IMP-04 nel 12:43, non evasa)
- finding: `globals.js:21` e `bin/cm:26` = 0.6.0; `package.json` = 0.1.0; `bin/package.json` = 0.0.1.
- evidence: i 4 file citati (letti in questa finestra).
- impact: `cm version` (0.6.0) ≠ package.json (0.1.0): ambiguità per pubblichizzazione, tooling, segnalazioni.
- recommendation: VERSION in globals come single source; build/bundle.mjs rigenera package.json o documentare mapping esplicito.
- score: 6 | score_rationale: incoerenza visibile e a basso costo, non bloccante.
- confidence: 10 | confidence_rationale: FACT diretto e duplicato.
- value: 6 | complexity: Bassa | risk: Basso | requires_human_decision: **NO**.

### IMP-18 — Aggiornare docs/COMPARISON.md (stato competitor 2026-09)
- classification: INFERENCE | area: docs/product | status: new
- finding: COMPARISON.md descrive claude-mem come "MCP cloud-based" e "Claude Code only"; il README ufficiale fetchato oggi (v13.24.0) mostra: supporto OpenCode/Antigravity/OpenClaw/Grok Bot, local observer opt-in (`--provider host`), cloud sync opzionale, worker HTTP locale, rebranding "Grok Mem".
- evidence: docs/COMPARISON.md:22,26,29 vs README claude-mem (main, fetch 2026-09-03).
- impact: la roadmap decisionale si basa su un quadro competitivo obsoleto.
- recommendation: aggiornare COMPARISON.md con v13.24.0, multi-IDE, local-first option; aggiungere riga basic-memory (competitor diretto architetturalmente).
- score: 5 | score_rationale: solo documentazione, ma corregge una base decisionale.
- confidence: 8 | confidence_rationale: obsolescenza FACT (righe doc vs README), valore INFERENCE.
- value: 5 | complexity: Bassa | risk: Basso | requires_human_decision: **NO**.

### IMP-19 — Lint/format su `src/` (Biome o ESLint)
- classification: FACT | area: quality | status: duplicate (già IMP-03 nel 12:43)
- finding: nessun lint; frammenti `src/*.js` sono lintabili (bundle generato va escluso).
- evidence: package.json scripts; evidence pack `lint_configs: []`.
- impact: errori banali prima della build; prerequisito per CI (IMP-16).
- recommendation: `biome.json`/`eslint.config.js` su src/ + script lint + guard in CI.
- score: 5 | confidence: 9 | value: 5 | complexity: Bassa | risk: Basso | requires_human_decision: **NO**.

### IMP-20 — Health check / `cm doctor`
- classification: INFERENCE | area: tool/UX | status: new
- finding: nessun comando di verifica integrità (DB/import/proiezioni); basic-memory offre `bm doctor` (file↔DB consistency).
- evidence: help.js (lista comandi) senza doctor/verify; README basic-memory (sezione "Health & maintenance": `basic-memory status`, `basic-memory doctor`).
- impact: diagnosi self-service di state.db corrotto o import fallito senza aprire il DB.
- recommendation: `cm doctor`: check schema state.db, FTS consistency, proiezioni vs DB, stale-lock, corrupt hint; output exit-code per scripting.
- score: 5 | score_rationale: valore operativo reale, non urgente.
- confidence: 7 | confidence_rationale: assenza FACT; beneficio inferenziale.
- value: 5 | complexity: Media | risk: Basso | requires_human_decision: **NO**.

### IMP-21 — Import conversazioni ChatGPT / Codex native
- classification: FACT (assenza) | area: connector/feature | status: new
- finding: `cm import` copre --graphify/--claude-mem/--json; basic-memory importa `claude conversations`, `chatgpt`, `memory-json` nativi.
- evidence: src/main.js:845; README basic-memory (sezione CLI: `basic-memory import claude conversations`, `import chatgpt`).
- impact: utenti con storico ChatGPT/Codex non possono popolare la memoria; on-ramp parziale.
- recommendation: mapper `cm import --codex <log>` / `--chatgpt <export.json>` riusando il layer `messages`+FTS5 come sink (coerente con capture layer esistente).
- score: 5 | score_rationale: chiude il gap on-ramp osservato vs 2 competitor.
- confidence: 6 | confidence_rationale: assenza FACT; domanda di valore inferenziale.
- value: 5 | complexity: Media | risk: Medio (formati non ufficiali) | requires_human_decision: **SÌ** (definire formati supportati).

### IMP-22 — Reranker semantico opzionale (cross-encoder locale)
- classification: INFERENCE | area: performance/feature | status: new
- finding: retrieval attuale = trigram + ranking deterministico + temperature re-ranking (T0/r) senza componente semantica di secondo passaggio; basic-memory offre cross-encoder FastEmbed locale o LiteLLM; Graphiti rerank by graph distance.
- evidence: src/retrieval.js e storica nota recall-auto (commit 58b2969) — componenti deterministiche; README basic-memory ("Optional cross-encoder reranking"); README Graphiti ("Reranking search results using graph distance").
- impact: parità qualitativa su retrieval semantico (documentato dai benchmark competitor, non da metriche proprie).
- recommendation: flag `--rerank` opzionale che, quando Ollama è presente, usa un cross-encoder locale (es. via Ollama) sui top-k; default off per non alterare i 56ms/op.
- score: 5 | score_rationale: potenziale qualità, costo latenza; dipende da mancanza metriche proprie (vedi LIMITI).
- confidence: 5 | confidence_rationale: la direzione è inferenza; non ho metriche che dimostrino il deficit.
- value: 5 | complexity: Media-Alta | risk: Medio | requires_human_decision: **SÌ** (trade-off latenza/qualità, modello aggiuntivo).

### IMP-23 — Retention del capture layer configurabile
- classification: HYPOTHESIS | area: technical/UX | status: duplicate (già IMP-09 nel 12:43)
- finding: capture scrive righe `messages` senza prune; unico prune = `consolidate --prune` su memory_items.
- evidence: capture.js; bin/cm (prune esistente).
- impact: crescita illimitata state.db nel lungo periodo (non misurata in questa finestra).
- recommendation: `--keep-days N` per `cm watch`/`consolidate` (default 180).
- score: 4 | confidence: 5 | value: 4 | complexity: Bassa | risk: Basso | requires_human_decision: **SÌ** (policy default).

### IMP-24 — Supporto Windows (install.ps1 + fetch nativo)
- classification: FACT (assenza) | area: feature/portability | status: duplicate (già IMP-05 nel 12:43)
- finding: install.sh POSIX-only; update.js usa chmod via sh.
- evidence: install.sh:7,25-33.
- impact: piattaforma major esclusa.
- recommendation: `install.ps1`, uso di `fetch` Node 22, chmod portabile, CI Windows con IMP-16.
- score: 6 | confidence: 7 | value: 6 | complexity: Media | risk: Medio | requires_human_decision: **SÌ**.

### IMP-25 — Completions shell + formato `--json` per scripting
- classification: INFERENCE | area: UX | status: duplicate parziale (completions = IMP-12 nel 12:43; `--json` è nuova)
- finding: CLI ampia senza completions e senza output strutturato; basic-memory ha CLI `--json` "for scripting"; claude-mem espone API JSON.
- evidence: help.js (lista comandi); README basic-memory ("CLI overhaul — `--json` output for scripting").
- impact: automazione e UX terminale.
- recommendation: tabella comandi unica → generatore completions bash/zsh/fish + flag `--json` su `cm ls/recall/sq`.
- score: 4 | confidence: 7 | value: 4 | complexity: Bassa-Medio | risk: Basso | requires_human_decision: **NO**.

### IMP-26 — Allargare finestra dedup (o sweep `--clean`)
- classification: FACT (code) + HYPOTHESIS (impatto) | area: technical | status: duplicate (già IMP-07 nel 12:43)
- finding: storage.js:119 LIMIT 50.
- evidence: storage.js.
- impact: duplicati vecchi sfuggono.
- recommendation: early-exit su tutti gli active o sweep periodico `cm update --clean`.
- score: 5 | confidence: 6 | value: 5 | complexity: Bassa | risk: Basso | requires_human_decision: **NO**.

### IMP-27 — Cache disponibilità Ollama (TTL)
- classification: INFERENCE | area: performance | status: duplicate (già IMP-08 nel 12:43)
- finding: embed.js execSync curl per ogni check (save + tick watch).
- evidence: src/embed.js:3-13.
- impact: overhead subprocess per op.
- recommendation: memoizzazione statica con TTL 30-60s.
- score: 4 | confidence: 6 | value: 4 | complexity: Bassa | risk: Basso | requires_human_decision: **NO**.

### IMP-28 — `cm init` senza side-effect di rete (acorn lazy)
- classification: FACT | area: UX/technical | status: duplicate (già IMP-10 nel 12:43)
- finding: main.js:70 `installAcornDeps()` best-effort a ogni init.
- evidence: src/main.js:70.
- impact: sorpresa offline/aziendale; mina claim "zero dipendenze".
- recommendation: install lazy al primo comando che lo richiede (`cm scan --deep`, `cm entities`).
- score: 5 | confidence: 8 | value: 5 | complexity: Bassa | risk: Basso | requires_human_decision: **NO**.

### IMP-29 — Eval harness retrieval pubblico (stile memory-benchmarks)
- classification: INFERENCE | area: test/quality | status: duplicate parziale (già IMP-06 nel 12:43)
- finding: benchmark interno top3=0.60; competitor pubblicano benchmark citabili (mem0 framework open `memory-benchmarks`).
- evidence: tests/benchmark-output/benchmark-results.csv; README mem0 ("The evaluation framework is open-sourced").
- impact: credibilità e confrontabilità numerica del retrieval.
- recommendation: mini-corpus dev replica in `tests/eval/` con top-1/3/5 + latenza; pubblicare in docs.
- score: 6 | confidence: 6 | value: 6 | complexity: Media-Alta | risk: Basso | requires_human_decision: **SÌ** (investimento).

---

## 6. Deduplicazione e stato raccomandazioni precedenti (report 12:43)

- IMP-01 MCP → **IMP-15** (duplicate, non evasa: grep confermato 0)
- IMP-02 CI → **IMP-16** (duplicate, non evasa)
- IMP-03 lint → **IMP-19** (duplicate, non evasa)
- IMP-04 versione → **IMP-17** (duplicate, non evasa — 4 valori)
- IMP-05 Windows → **IMP-24** (duplicate, non evasa)
- IMP-06 eval → **IMP-29** (duplicate, non evasa)
- IMP-07 dedup → **IMP-26** (duplicate, non evasa)
- IMP-08 ollama cache → **IMP-27** (duplicate, non evasa)
- IMP-09 retention → **IMP-23** (duplicate, non evasa)
- IMP-10 init network → **IMP-28** (duplicate, non evasa)
- IMP-11 SECURITY.md/CHANGELOG/template → **non ri-verificato in dettaglio in questa finestra; confermata assenza strutture (ls radice: assenti) — resta aperto, priorità bassa** (score 3, confidence 8)
- IMP-12 completions → parzialmente in **IMP-25**
- IMP-13 correction O(n) → non ri-verificato in questa finestra (nessun cambio codice dal 02/09); resta valido come finding storico (score 3)
- IMP-14 failure signal → **non rilevato nella finestra 12:57-16:23** (0 failure) — chiuso per questa finestra

**Conclusione**: nessuna delle 14 raccomandazioni del 12:43 è stata evasa tra le due finestre (git log fermo al 2026-09-02; solo `docs/reports/` untracked). Il report 18_20 è uno stub preliminare (solo raccomandazione lint) — integralmente coperto da IMP-19.

---

## 7. Limiti e informazioni mancanti

- **BLOCKED**: nessuna esecuzione di test/benchmark (policy read-only; tool exec non autorizzati). Numeri performance = artefatti storici non ri-eseguiti.
- **UNVERIFIED**: licenza Graphiti (README non la dichiara; badge non fetchato separatamente). Stars/maturità claude-mem/mem0 non ri-fetchate come dato numerico (non necessarie al confronto capability). Server MCP di mem0 non dichiarato nel README.
- **UNKNOWN**: costo contestuale effettivo di MEMORY.md/USER.md per progetti grandi; comportamento retrieval su archivi >10k item (nessun dato nel repo).
- **Web**: index npm non disponibile via tool (HTTP 400 su tutte le query) — nessun dato da npm registry usato; fonti GitHub ufficiali 4/4 OK.
- `state.db` radice e `memory/` gitignorati → non versionati; non analizzati oltre la presenza. `mqtt/`, `agents/`, `reports/`, `.worktrees/` = infrastruttura yano-orchestrator, fuori perimetro prodotto.

## 8. Decisione umana richiesta (sintesi)

Richiedono conferma planner/utente: **IMP-15 (MCP)**, **IMP-16 (CI)**, **IMP-21 (import ChatGPT/Codex)**, **IMP-22 (reranker)**, **IMP-23 (retention)**, **IMP-24 (Windows)**, **IMP-29 (eval harness)**. Eseguibili senza decisione umana: IMP-17, IMP-18, IMP-19, IMP-20, IMP-25, IMP-26, IMP-27, IMP-28.

## 9. Handoff planner (sintesi)

1. **Priorità alta**: IMP-15 MCP stdio (gap vs tutti i comparator), IMP-16 CI, IMP-17 versione unica.
2. **Priorità media**: IMP-18 aggiornamento COMPARISON.md (base decisionale obsoleta), IMP-19 lint, IMP-20 doctor, IMP-24 Windows, IMP-29 eval.
3. **Priorità bassa**: IMP-21/22/23/25/26/27/28 — hardening e UX.
4. Nessuna modifica effettuata; progetto intatto. Confidenza complessiva: **8/10** (FACT diretti su codice; giudizi qualitativi sui comparator ancorati a README ufficiali fetchati in questa sessione; unico elemento non misurabile: qualità retrieval relativa, priva di metriche proprie aggiornate).
