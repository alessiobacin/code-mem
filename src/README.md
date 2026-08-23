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
| `capture.js` | **capture layer**: captureSessionId, captureMessage, captureAuto, captureAutoRecall, captureDaemonHeartbeat |
| `db.js` | DB init `od()` (incl. ensureMessagesSearchTables) + runStmt/allStmt/getStmt |
| `scanner.js` | acorn deps + scanASTDeep |
| `embed.js` | ollama check, embeddings (cosine/trigram), vector deps |
| `graph.js` | graph persistence, imports (graphify/claude-mem/json), gh |
| `semantic.js` | buildAutoQuery, sd (message/entity search) |
| `help.js` | **gh**, **gl()** (lean) + **glFull()** (--full) |
| `update.js` | version compare/download/update |
| `plan.js` | parseArgs (incl. --full/--auto), inferTaskKind, makePlan |
| `storage.js` | save/dedup/backup/restore/projections |
| `retrieval.js` | scoring, recall pipeline, renderRecall |
| `context.js` | sc (repo scan), setupHarness, installHooks, printRows |
| `memory-ops.js` | replace/remove/consolidate/prune, acquireLock, **watchLoop** |
| `graph-export.js` | communities + GraphML/Neo4j/HTML/SVG export |
| `entities.js` | tech/entity extraction, cmdEntities, cmdHistory |
| `main.js` | CLI dispatch (main + installed main().catch) |

## Behaviour notes (Task A deliverables)

- **Obscuration**: bare `cm help` is lean; `cm help --full` / `cm --full [help]`
  reveal graph/scan/query/entities/history/sq/import. The commands still run when
  called directly (API unchanged) — only the help listing is gated.
- **Capture layer**: `od()` wires `ensureMessagesSearchTables` so the FTS
  triggers index every INSERT. Writers: `cm save --auto [--role dev|agent]`,
  `cm recall-auto` (SessionStart context), `cm watch` daemon heartbeat. Readers:
  `cm sq`, `cm entities --msgs`.
