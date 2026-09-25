# cm src layout (Task A — cm-modular-capture refactor)

`cm` is distributed as ONE self-contained CommonJS file (`bin/cm`) that
`install.sh` / `cm update` fetch via curl, and `bin/package.json` is `commonjs`.
So the refactor splits the former 4276-line monolith into ordered **fragments in
`src/`** that share a single scope (the classic concatenation pattern for a CLI
that must ship as a single file), and `build/bundle.mjs` reassembles `bin/cm`.

Do NOT hand-edit `bin/cm` — edit the fragment below and run:

    node build/bundle.mjs

## Fragment order (canonical, = monolith's original top-level order)

Order matters only for top-level const/let initializations (TDZ); function
declarations are hoisted. `build/bundle.mjs` lists the canonical ORDER array.

| file | contents |
|------|----------|
| `globals.js` | requires, VERSION/consts, HARNESS_CONFIGS, TASK_TEMPLATES, SECTION_CONFIG, snippet, harnessComment |
| `fsutil.js` | path/fs helpers: mp, rd, wr, rg, wg, nowIso, getGitBranch, CM_DEPS_DIR … |
| `config.js` | `cm config`: global `~/.cm/config.env` + project `memory/config.env`, masked secrets, precedence env > project > global |
| `capture.js` | **capture layer**: captureSessionId, captureMessage, captureAuto, captureAutoRecall, captureDaemonHeartbeat |
| `db.js` | DB init `od()` (incl. ensureMessagesSearchTables) + runStmt/allStmt/getStmt |
| `cognitive.js` | episodes, evidence, deterministic intake gate, temporal belief state, verification, working set, consolidation ledger |
| `scanner.js` | acorn deps, AST scan, full repository inventory (files, folders, sections, assets, imports) |
| `embed.js` | ollama check, embeddings (cosine/trigram), vector deps |
| `graph.js` | graph persistence, generic Markdown knowledge import, Graphify/claude-mem/JSON adapters, gh |
| `semantic.js` | buildAutoQuery, sd (message/entity search) |
| `help.js` | **gh**, **gl()** (lean) + **glFull()** (--full) |
| `update.js` | version compare/download/update |
| `plan.js` | parseArgs (incl. --full/--auto), inferTaskKind, makePlan |
| `storage.js` | save/dedup/backup/restore/projections |
| `retrieval.js` | scoring, recall pipeline, renderRecall |
| `context.js` | sc (repo snapshot), setupHarness, installHooks, printRows |
| `harness.js` | harness detection, safe settings metadata, project skills and `/cm-update` integration |
| `llm.js` | read-only harness CLI bridge and validated semantic relations |
| `jev.js` | optional Jev (TypeSafe) typed decisions: choice/score/noul, credit status + alerts |
| `memory-ops.js` | replace/remove/consolidate/prune, acquireLock, **watchLoop** |
| `mcp.js` | `cm mcp` stdio JSON-RPC server (memory_search/timeline/get) |
| `graph-export.js` | communities + GraphML/Neo4j/HTML/3D HTML/SVG export |
| `logic.js` | plain-language logic view: files grouped into named parts + flows (LLM-named, carried forward without LLM) |
| `entities.js` | tech/entity extraction, cmdEntities, cmdHistory |
| `workflow.js` | unified `init --deep` / `update --memory --deep` pipeline |
| `graph-service.js` | per-user graph-service lifecycle, OS user-service integration and project registry |
| `graph-server.js` | loopback graph serving and harness-backed chat bridge |
| `main.js` | CLI dispatch (main + installed main().catch) |

The per-user registry at `~/.cm/graphd/projects.json` is also the managed
project catalog. `cm projects` lists it; `cm projects recall` and
`cm projects graph` require an explicit project selector and never run as
implicit context injection.

## Behaviour notes (Task A deliverables)

- **Obscuration**: bare `cm help` is lean; `cm help --full` / `cm --full [help]`
  reveal graph/scan/query/entities/history/sq/import. The commands still run when
  called directly (API unchanged) — only the help listing is gated.
- **Capture layer**: `od()` wires `ensureMessagesSearchTables` so the FTS
  triggers index every INSERT. Writers: `cm save --auto [--role dev|agent]`,
  `cm recall-auto` (SessionStart context), `cm watch` daemon heartbeat. Readers:
  `cm sq`, `cm entities --msgs`.

Memory kinds are `fact`, `decision`, `procedure`, `issue`, `artifact`,
`preference`, `event`, and `inference`. Lifecycle layers are `working`,
`episodic`, `semantic`, `procedural`, and `user`. Global preferences use the
separate global database and appear in default project recall as
`global-preference`; they are user context, never a project stack override.
