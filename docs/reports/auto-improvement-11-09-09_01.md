# Auto-improve audit AUDIT-20260911070005-26BEA9C3 — report finale 360°

- Progetto: **code-mem** — root: `/Users/alessiobacin/Desktop/code-mem`
- Audit: `AUDIT-20260911070005-26BEA9C3` — finestra: 2026-09-03 → 2026-09-11
- Modalità: **esclusivamente read-only**. Nessun file modificato; unica scrittura autorizzata = questo report in `docs/reports/`.
- Esecuzione: 2026-09-11, agente `auto-improver-code-mem-r-mtj00gu`.

---

## 1. Missione / capability principale

`FACT` — dalla lettura di `README.md`, `docs/PHILOSOPHY.md`, `skill/SKILL.md`, `src/` e `package.json`:

> **code-mem è una memoria persistente locale-first per agenti di coding e sviluppatori**: un singolo CLI (`cm`) che salva memorie tipizzate (fact/decision/procedure/issue/preference/artifact) in SQLite locale (`node:sqlite`, Node 22+), con strato opzionale globale in `~/.cm/state.db`, proiezioni Markdown (`MEMORY.md`/`USER.md`), grafo JSON leggero, FTS5 sulle conversazioni catturate, retrieval deterministico multi-segnale arricchito da embedding trigram (sempre disponibile) + Ollama `nomic-embed-text` (opzionale).

Differentiator dichiarati (FACT, da `docs/PHILOSOPHY.md`): zero dipendenze runtime, agent-agnostic (Claude, Codex, Cursor, Pi, CLI), niente servizi, niente cloud, niente vendor lock-in. Deliberatamente **non fa**: RAG su file, sync di team, REST API, MCP server ("non è un gap da colmare", `PHILOSOPHY.md`).

Contesto misurato: `VERSION = "0.6.0"` (`src/globals.js:21`); bundle monolitico generato da 18 frammenti (`build/bundle.mjs`, `src/README.md`); `package.json` **private, zero dependencies, zero devDependencies**, scripts `build`+`test`.

---

## 2. Confronto con software comparabili (fonti web verificate)

Quattro candidati individuati con `auto_improve_web_search` e verificati su fonti ufficiali con `auto_improve_web_fetch` (status 200 su README raw):

| # | Progetto | Fonte verificata | Dati chiave (metadata indice, 2026-09-11) |
|---|---|---|---|
| C1 | **claude-mem / "Grok Mem"** (thedotmack) | https://github.com/thedotmack/claude-mem · raw README (200) | ~93.7k ⭐, Apache-2.0, npm `claude-mem` v13.24.13, Node ≥20 |
| C2 | **engram** (Gentleman-Programming) | https://github.com/Gentleman-Programming/engram · raw README (200) | ~6.5k ⭐, MIT, binario Go, Homebrew tap v1.20.0 |
| C3 | **Mem0** (mem0ai) | https://github.com/mem0ai/mem0 · raw README (200) | ~65.1k ⭐, Apache-2.0, Python+npm SDK, YC S24, paper arXiv:2504.19413 |
| C4 | **graphify** (Graphify-Labs) | https://github.com/Graphify-Labs/graphify · raw README (200, repo redirect safishamsi/graphify) | ~116.8k ⭐, licenza da metadata indice: Apache-2.0 (README non la dichiara → `UNKNOWN`) |

### Matrice dimensionale attuale vs alternative

| Dimensione | **code-mem (attuale)** | **claude-mem** | **engram** | **Mem0** | **graphify** |
|---|---|---|---|---|---|
| Missione | memoria progetto/agente locale | memoria cross-session "tutto ciò che l'agente fa" | memoria progetto/agente, locale o cloud | memory layer per app/agenti (prod) | knowledge graph da codebase/docs/PDF/immagini |
| Storage | SQLite locale + `~/.cm`, Markdown proiettati, graph.json | SQLite + Chroma (hybrid vector) | SQLite + FTS5 (`~/.engram/engram.db`) | DB vettoriale + alg. proprietario (LLM) | graph.json + cache SHA256 |
| Retrieval | deterministico 8 segnali + trigram + Ollama opz.; re-ranking a temperatura (recall-auto) | hybrid semantic+keyword, progressive disclosure, MCP 3-strati "~10x token savings" (claim) | mem_search preview, timeline, topic_key stabile, mem_review/judge (stale knowledge) | semantic+BM25+entity linking, temporal reasoning, benchmark LoCoMo 92.5 / LongMemEval 94.4 / BEAM 64.1 (solo managed platform; claim) | traversal BFS/community, ogni edge EXTRACTED/INFERRED/AMBIGUOUS, "71.5x meno token" (claim) |
| UX | CLI one-file, help lean + `--full` | worker service + web viewer UI + mem-search skill | CLI + **TUI** + web (cloud) | CLI + dashboard + browser extension | skill `/graphify`, graph.html interattivo, wiki |
| UX LLM/agent | skill SKILL.md + hook SessionStart + cattura conversazioni | 5-6 lifecycle hooks, plugin, auto-inject contesto | protocollo memoria strutturato (mem_save/session_summary), MCP stdio | agent signup in 5s, skills `npx skills add` | skill nativa Claude Code |
| Tool/API | solo CLI | worker HTTP API + CLI | **HTTP API** + CLI | **REST API** + SDK py/js + CLI | CLI + MCP stdio |
| **MCP** | ❌ **assente** | ✅ 4 MCP tools (search/timeline/get_observations) | ✅ **MCP server stdio** | ✅ (via SDK/skills, piattaforma) | ✅ `--mcp` |
| Connettori/plugin | `cm setup` → skill+hook per Claude, Pi, Codex, Copilot CLI, Cursor | marketplace plugin Claude Code, OpenClaw gateway | **10+ agent** (Claude, Pi, OpenCode, Gemini, Codex, Cursor, Windsurf, Copilot, Kilo, Qwen, Kiro, Antigravity), plugin OpenCode/Claude Code | LangGraph, CrewAI, extension Chrome, Vercel AI SDK | Obsidian export, wiki, hook git post-commit, Neo4j/GraphML/SVG |
| Integrazioni | import `--graphify/--claude-mem/--json`, export/import bundle (merge deterministico) | cloud sync cmem.ai, citazioni, i18n 30+ lingue | Git Sync chunked, Engram Cloud (opz.), Obsidian (beta) | ecosystem LLM (OpenAI ecc.), self-host | tree-sitter AST multilanguage |
| Privacy | ✅ local-first puro, zero rete (tranne update/scan-deep) | ⚠️ default hosted (sign-in, magic link; observer locale opt-in `--provider host`), `<private>` tags | ✅ locale default; cloud opzionale | ⚠️ cloud di default; self-host per team | ✅ locale, ma richiede LLM Claude (payload a API) |
| Deployment | 1 file Node 22+ (`bin/cm`), curl one-liner | Node+Bun+uv+SQLite, npm/npx plugin | **1 binario Go**, zero runtime, brew | pip/npm + docker compose o cloud | Python 3.10+ + pip + skill |
| Performance | benchmark interno: write 56.7ms/op, recall p50 0.097s, top-3 60% (9/15) — **non indipendente** (`tests/benchmark-comparison.md`) | claim "~10x token savings" | self-testing binaries documentati | benchmark pubblici (managed platform) | claim 71.5x token |
| Test | `npm test` → 1 file non-regression + script shell non cablati (tddb/e2e/manual) | repo attivo, docs dev | docs self-testing + release policy con security support | CI attivo, benchmark framework open-source | CI (badge), worked examples riproducibili |
| Maturità | **v0.6.0, package private, non pubblicato su npm**, 1 branch, no CI, no release | v13.x npm, ~93.7k ⭐, docs site, 3 branch release, forma commerciale ("CMEM token") | release stabili + tap brew v1.20.0, security support | YC S24, paper, piattaforma commerciale | ~116.8k ⭐ |
| Licenza | MIT | Apache-2.0 | MIT (marchi separati) | Apache-2.0 | Apache-2.0 (metadata indice; `UNKNOWN` da README) |

`INFERENCE` — il competitor più sovrapponibile è **engram** (stessa missione: memoria persistente per agenti di coding, locale, zero-dipendenza) ma con perimetro più largo: MCP+HTTP+TUI+cloud opzionale+10+ harness. claude-mem è il riferimento di mercato per maturità e UX ma è passato a modello hosted/commerciale. Mem0 e graphify coprono missioni adiacenti (memory layer per app; knowledge graph), non direttamente sovrapposte.

---

## 3. Gap matrix — code-mem vs alternative

| Gap (verificato) | Evidenza | Riferimento alternativa |
|---|---|---|
| **G1. Nessun MCP server** (solo CLI) | `main.js` dispatch: nessun comando MCP; `.mcp.json` è config client, non server | engram README (MCP stdio), claude-mem README (4 MCP tools), graphify README (`--mcp`) |
| **G2. Nessuna HTTP API / web viewer / TUI** | superficie CLI-only; `help.js` mostra solo comandi | engram (HTTP API + TUI), claude-mem (worker + web viewer) |
| **G3. Nessuna CI, lint, typecheck** | evidence pack `ci_workflows: []`, `has_lint: false`; `.github/` contiene solo `hooks/` (svuotato); scripts solo build+test | engram (release policy+self-testing), graphify (CI), mem0 (CI) |
| **G4. Un solo test cablato** (`npm test`) | `package.json` → `tests/non-regression/cm-cli.test.mjs`; tddb/e2e/manual non richiamati | — |
| **G5. Documentazione disallineata al CLI** | `skill/SKILL.md` documenta `cm update --memory [--clean|--dry-run|--reset]`; `src/main.js:25-28` implementa solo `update [--force]`; README non li cita | — |
| **G6. Nessun benchmark retrieval pubblico** | unico dato interno top-3 60% (9/15) su 15 frasi parafrasate (`tests/benchmark-comparison.md`) | mem0 (LoCoMo/LongMemEval/BEAM public benchmark) |
| **G7. Connettori limitati a 5 harness**, niente marketplace/OpenClaw/Obsidian/wiki | `context.js:309-312` (Pi/Claude/Codex/Cursor), `update.js:95-98` | claude-mem (marketplace+OpenClaw), engram (10+ agent), graphify (obsidian/wiki) |
| **G8. `scan --deep` installa dipendenze a runtime** (rete+npm non dichiarati) | `src/scanner.js:17` `execSync("npm install acorn acorn-loose", {timeout:60000})` in `~/.cm/deps`; package.json non le dichiara | — |
| **G9. Distribuzione solo via GitHub raw** | `install.sh`, `README.md` (curl da raw.githubusercontent); `package.json` private → non su npm | engram Homebrew, claude-mem npm, mem0 pip/npm |
| **G10. Shell-out per update/embedding** (curl/wget a `OLLAMA_BASE` e `CM_UPDATE_BASE`) | `src/update.js:64-70`, `src/embed.js:3-8`; escaping parziale `url.replace(/"/g,'\\"')` | — |

---

## 4. Findings puntuali (audit qualitativo/tecnico)

### F1 — Disallineamento skill/README vs CLI reale
- `classification: FACT` · `area: frontend|documentazione` (agent UX)
- `evidence`: `skill/SKILL.md` ("cm update --memory [--clean|--dry-run|--reset]") vs `src/main.js:25-28` (`runUpdate(Boolean(flags.force))`).
- `impact`: un agente che segue la skill invoca flag inesistenti → fallimento silenzioso o errore; credibilità del contratto agente.
- `recommendation`: allineare SKILL.md e README ai flag implementati, oppure implementare `update --memory` (re-scan/clean/reset).
- `score: 6/10` (impatto operativo medio, zero rischio) · `confidence: 9/10` (doppia fonte locale).

### F2 — `npm install` a runtime in `scan --deep`
- `classification: FACT` · `area: architecture`
- `evidence`: `src/scanner.js:3-17` (installa `acorn`/`acorn-loose` in `~/.cm/deps`, timeout 60s, fallback silenzioso a regex).
- `impact`: prima esecuzione di `scan --deep` richiede rete+npm; offline degrada in modo non dichiarato; contraddice parzialmente lo zero-dependency.
- `recommendation`: dichiarare la dipendenza opzionale in modo esplicito (messaggio + fallback documentato), o vendere `scan --deep` come "richiede npm una tantum".
- `score: 5/10` · `confidence: 8/10`.

### F3 — Nessuna CI né lint: unico gate è un test non-regression
- `classification: FACT` · `area: architecture/quality`
- `evidence`: evidence pack `ci_workflows: []`, `has_lint: false`; `package.json` scripts `build`,`test`; `.github/hooks/` vuoto.
- `impact`: regressioni non intercettate; il bundle monolitico (`build/bundle.mjs`) non viene rigenerato/verificato automaticamente.
- `recommendation`: CI minimale (build bundle + `npm test` + shellcheck sui .sh + lint fragment src/) con artefatto `bin/cm` verificato tramite checksum.
- `score: 6/10` · `confidence: 8/10`.

### F4 — Copertura test incompleta e non eseguibile da un comando
- `classification: FACT` · `area: quality`
- `evidence`: `package.json` → solo `cm-cli.test.mjs`; esistono `tests/test-e2e.sh`, `tests/tddb/run-*.sh`, `tests/manual-scenarios/` non cablati.
- `impact`: il "has_tests=true" dell'evidence pack sopravvaluta la copertura reale del gate automatico.
- `recommendation`: unified `npm test` che esegua anche tddb/e2e (o documentare la separazione); CI su matrice Node 22/24.
- `score: 6/10` · `confidence: 8/10`.

### F5 — Qualità retrieval non provata esternamente
- `classification: INFERENCE` (dato interno non indipendente) + `HYPOTHESIS` sul confronto con sistemi LLM-based
- `evidence`: `tests/benchmark-comparison.md` (top-3 60%, 15 query, benchmark proprietario); nessun benchmark pubblico (LoCoMo/LongMemEval) → non confrontabile con mem0.
- `impact`: il core value ("recall utile al task") non ha evidenza riproducibile; trigram ≠ semantica sui sinonimi.
- `recommendation`: pubblicare un mini-benchmark riproducibile (es. subset stile LoCoMo generico, progetto reale, gold set) e misurare top-1/top-3 con e senza Ollama.
- `score: 5/10` · `confidence: 7/10`.

### F6 — Working tree sporco: file orchestrazione eliminati non committati
- `classification: FACT` · `area: other (hygiene)`
- `evidence`: evidence pack `git status --short` exit 0: `D agents/roles.yaml`, `D mqtt/compose.yaml`, `D mqtt/mosquitto.conf`, `D mqtt/mosquitto.native.conf`; `git log` del collector fallito exit 128 ("mmap failed: Resource deadlock avoided") — anomalia di raccolta.
- `impact`: low su prodotto; commit pendenti sporcano il working tree e il collector fatica su repo grandi.
- `recommendation`: commit separato di pulizia; indagare l'errore mmap (repo esteso? indice git?).
- `score: 3/10` · `confidence: 9/10`.

### F7 — Sicurezza: modello locale senza cifratura né auth
- `classification: FACT` · `area: security/privacy`
- `evidence`: `src/db.js` (SQLite `journal_mode=DELETE`, no encryption); `messages` table = log conversazioni in chiaro; CLI opera con i privilegi utente; unici input remoti: GitHub raw (update) e Ollama locale.
- `impact`: coerente con filosofia local-first; ma chi committa `memory/` su repo condiviso espone decisioni/conversazioni. Nessun controllo (opt-out cattura, tag `<private>` stile claude-mem).
- `recommendation`: documentare il modello di minaccia; valutare flag `--no-capture`/comando cleanup per dati sensibili.
- `score: 4/10` (deliberate scelta product, non bug) · `confidence: 8/10`.

### F8 — Shell-out (curl/wget) in update e embedding
- `classification: INFERENCE` (superficie di rischio, nessuna vulnerabilità dimostrata) · `area: security/architecture`
- `evidence`: `src/update.js:64-70` (`execSync curl/wget` con URL da `CM_UPDATE_BASE`), `src/embed.js:3-8` (curl verso `http://localhost:11434`); escaping parziale delle virgolette.
- `impact`: in ambienti dove `CM_UPDATE_BASE` è controllata da terzi (CI) si apre superficie injection; il gate SHA-256 protegge l'integrità del contenuto, non la shell.
- `recommendation`: sostituire con `fetch` (Node 22) o `https.request`; validare l'URL con `new URL()` contro allowlist di host.
- `score: 4/10` · `confidence: 7/10`.

---

## 5. Proposte concrete (ciascuna con valore, complessità, rischio, confidenza, requires_human_decision)

```yaml
id: IMP-01
classification: FACT (gap verificato)
area: connector/tool
finding: "Nessun MCP server: code-mem espone solo CLI mentre engram (MCP stdio), claude-mem (4 MCP tools) e graphify (--mcp) coprono il protocollo di riferimento per agenti."
evidence: ["src/main.js dispatch (nessun comando MCP)", "engram README raw 200", "claude-mem README raw 200", "graphify README raw 200"]
impact: "Raggiungibilità ridotta per tutti gli harness MCP-compatibili; il claim 'agent-agnostic' regge solo via skill/hook manuali."
recommendation: "Aggiungere `cm mcp` (server stdio) che espone i 3 tool a basso costo token (search/timeline/get_observations) riusando la pipeline recall esistente; pattern progressive disclosure."
value: 9/10
complexity: 3/10
risk: 2/10 (nuova superficie API pubblica)
confidence: 8/10
requires_human_decision: true   # nuova API pubblica e perimetro prodotto
status: new
```

```yaml
id: IMP-02
classification: FACT
area: quality/technical
finding: "Nessuna CI, nessun lint, un solo test cablato (tests/non-regression/cm-cli.test.mjs)."
evidence: ["evidence pack ci_workflows=[] has_lint=false", "package.json scripts", ".github/hooks/ vuoto"]
impact: "Regressioni e drift doc-CLI passano inosservati; bundle generato mai verificato da una macchina pulita."
recommendation: "CI GitHub Actions minima: node 22/24 → node build/bundle.mjs → npm test → shellcheck su tests/*.sh; aggiungere lint (es. eslint flat config sui frammenti src/ con regole base) e un test che verifichi `bin/cm` == bundle rigenerato (byte-identico)."
value: 8/10
complexity: 2/10
risk: 1/10
confidence: 9/10
requires_human_decision: false
status: new
```

```yaml
id: IMP-03
classification: FACT
area: frontend (agent UX)/documentazione
finding: "skill/SKILL.md documenta `cm update --memory [--clean|--dry-run|--reset]` che il CLI non implementa (`main.js` accetta solo --force); README non li elenca."
evidence: ["skill/SKILL.md", "src/main.js:25-28"]
impact: "Agenti che seguono la skill tentano flag inesistenti; contratto agente non affidabile."
recommendation: "O allineare i documenti ai flag reali, o implementare update --memory (re-scan + clean + dry-run) riusando scanner/consolidate."
value: 7/10
complexity: 1/10
risk: 1/10
confidence: 9/10
requires_human_decision: false
status: new
```

```yaml
id: IMP-04
classification: FACT
area: architecture
finding: "`cm scan --deep` esegue `npm install acorn acorn-loose` a runtime in ~/.cm/deps (rete + npm non dichiarati), con fallback silenzioso a regex."
evidence: ["src/scanner.js:3-17"]
impact: "Primo deep-scan offline degrada senza avviso; zero-dependency dichiarato violato in un ramo del prodotto."
recommendation: "Messaggio esplicito + flag `--no-ast` documentato; oppure dichiarare dipendenza opzionale in install.sh (pre-install di acorn in ~/.cm/deps)."
value: 5/10
complexity: 2/10
risk: 2/10
confidence: 8/10
requires_human_decision: false
status: new
```

```yaml
id: IMP-05
classification: INFERENCE
area: product/test
finding: "Qualità retrieval basata su un solo benchmark interno (top-3 60% su 15 parafrasi) senza confronto esterno; mem0 pubblica benchmark riproducibili (LoCoMo/LongMemEval/BEAM)."
evidence: ["tests/benchmark-comparison.md", "mem0 README raw 200 (solo managed platform)"]
impact: "Nessuna evidenza difendibile del core value; impossibile posizionarsi vs alternative LLM-based."
recommendation: "Pubblicare un benchmark riproducibile (gold set pubblico del progetto, 40-60 query, con/senza Ollama, top-1/top-3, latency) estendendo tests/run-comparative-benchmark.sh; opzionale: migliorare la semantica oltre il trigram (embedding locale opzionale più forte)."
value: 7/10
complexity: 3/10
risk: 1/10
confidence: 6/10
requires_human_decision: true   # scelta protocollo benchmark e investimento embedding
status: new
```

```yaml
id: IMP-06
classification: FACT (gap verificato)
area: connector/plugin
finding: "Connettori limitati a 5 harness (Claude, Pi, Codex, Copilot CLI, Cursor); assenti marketplace, OpenClaw, Obsidian/wiki export, VS Code; engram copre 10+ agent, graphify esporta Obsidian/wiki."
evidence: ["src/context.js:309-312", "src/update.js:95-98", "engram README raw 200", "graphify README raw 200"]
impact: "Ecosistema di adozione ridotto rispetto ai pari; trade local-first penalizzato dalla fatica di setup manuale."
recommendation: "Estendere `cm setup` a OpenClaw/Gemini CLI/Windsurf/Kilo/Qwen (pattern: scrittura config MCP/hook standard); aggiungere `cm gx obsidian` (riuso graph.json → vault)."
value: 6/10
complexity: 3/10
risk: 1/10
confidence: 7/10
requires_human_decision: true   # perimetro ecosistema
status: new
```

```yaml
id: IMP-07
classification: INFERENCE
area: product/UX
finding: "Nessuna vista timeline/visualizzazione dei dati di memoria oltre a CLI e proiezioni MD; claude-mem ed engram offrono web viewer/TUI."
evidence: ["help.js/main.js (solo CLI)", "claude-mem README raw 200 (web viewer)", "engram README raw 200 (TUI)"]
impact: "UX di ispezione (per umani) debole: comprensione di cosa l'agente ricorda richiede query CLI."
recommendation: "TUI read-only minimale (o `cm history` arricchito con vista conversazioni) prima di un web viewer; mantenere zero-server."
value: 5/10
complexity: 4/10
risk: 2/10
confidence: 6/10
requires_human_decision: true   # scelta di prodotto
status: new
```

```yaml
id: IMP-08
classification: INFERENCE
area: security/architecture
finding: "Shell-out a curl/wget con URL costruito da input d'ambiente (CM_UPDATE_BASE, OLLAMA_BASE) ed escaping parziale."
evidence: ["src/update.js:64-70", "src/embed.js:3-8"]
impact: "Superficie injection in ambienti CI dove l'env var è controllata da terzi; il checksum SHA-256 non mitiga la shell."
recommendation: "Sostituire con fetch/https.request; validare URL con new URL() + allowlist host (raw.githubusercontent.com, localhost)."
value: 4/10
complexity: 2/10
risk: 1/10
confidence: 7/10
requires_human_decision: false
status: new
```

---

## 6. Verifiche eseguite, documenti consultati, limiti

**Documenti locali consultati**: `README.md`, `package.json`, `docs/PHILOSOPHY.md`, `docs/COMPARISON.md` (sezioni summary), `docs/reports/auto-improvement-11-09-09_01.md` (precompilato dal planner) + `auto-improvement-04-09-17_27.md` (pattern report precedenti), `src/README.md`, `build/bundle.mjs`, `src/main.js` (dispatch), `src/retrieval.js` (scoring), `src/update.js`, `src/db.js`, `src/scanner.js`, `src/embed.js`, `skill/SKILL.md`, `tests/non-regression/cm-cli.test.mjs` (head), `tests/test-e2e.sh` (head), `tests/benchmark-comparison.md`, `.gitignore`, `.env.example`, `.mcp.json`, `.github/` (solo hooks/ vuoto).

**File non letti per protocollo progressivo**: frammenti src non coinvolti da ipotesi (`capture.js`, `graph-export.js`, `entities.js`, `storage.js` in dettaglio), `bin/cm` (generato), `memory/` (gitignored, dati utente), `state.db` (dati).

**Fonti web**: query `auto_improve_web_search` ×2 (candidati), `auto_improve_web_fetch` ×4 (README raw: thedotmack/claude-mem, Gentleman-Programming/engram, mem0ai/mem0, Graphify-Labs/graphify; tutti status 200). Contenuto non verificabile in questa sessione: prestazioni dichiarate da vendor (claude-mem "10x token", graphify "71.5x", mem0 benchmark su piattaforma managed) — riportate come claim, non come misurazioni nostre. I numeri di star sono metadata dell'indice di ricerca al 2026-09-11.

**BLOCKED/UNKNOWN**:
- Esecuzione test suite: `BLOCKED` — audit read-only, non posso avviare `npm test`/e2e; pass/fail non verificato.
- Licenza graphify: `UNKNOWN` — README non la dichiara; metadata indice = Apache-2.0.
- Percorso update remoto end-to-end (checksum vs mirror): non eseguibile in read-only → `UNKNOWN`; logica verificata solo staticamente.
- Qualità retrieval vs mem0: non confrontabile (manca gold set comune) → `UNKNOWN`.

**No-invention check**: ogni FACT è riferito a file:riga locale o a contenuto fetchato (URL+status riportati); nessun dato numerico inventato; i claim esterni sono marcati come claim; i giudizi sono INFERENCE/HYPOTHESIS espliciti con ragionamento. Progetto non modificato (unica scrittura: questo report).

---

## 7. Handoff al planner (sintesi informativa)

- Missione confermata: memoria persistente locale-first per coding agent — capability distintiva (zero dipendenze, locale, agent-agnostic) **verificata** in codice.
- Gap maggiori vs alternative (top 3): **1)** nessun MCP server, **2)** nessuna CI/lint/verifica bundle, **3)** drift doc↔CLI (`update --memory` fantasma).
- Propongo batch prioritario: IMP-03 (doc drift, costo ~0), IMP-02 (CI+lint), IMP-01 (MCP, decisione di prodotto), IMP-04/08 (hardening), poi IMP-05/06/07 (strategici: benchmark, ecosistema, UX).
- `requires_human_decision` = true su IMP-01, IMP-05, IMP-06, IMP-07 (perimetro prodotto/ecosistema e protocollo benchmark); false su IMP-02/03/04/08.
- Azioni precedenti: report 04-09 "aggiungere lint" → confermato e non ancora risolto (duplicato storico, ora formalizzato in IMP-02).
- Nessuna domanda all'utente; triage e batch a discrezione del planner.
