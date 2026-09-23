# code-mem

Persistent project memory for coding agents and developers, with optional global memory for reusable cross-project knowledge.

`code-mem` keeps a local memory layer inside each repo, plus an optional local global store:

- typed memories in SQLite
- generated `MEMORY.md` and `USER.md` projections
- a lightweight JSON graph
- FTS5 search over stored conversation logs
- cognitive lifecycle data: episodes, evidence, belief state, candidates, verification and task working sets

It is designed to stay simple:

- one CLI
- local files only
- one optional per-user loopback graph service serving multiple isolated projects
- no external database

Memory density policy: saves use deterministic English-first compact prose (caveman-style: high signal, low filler). Provider/model transport chatter such as `[llmp] provider...` and `[llmproxy]...` is rejected at intake, so it cannot become recall noise. Optional semantic processing stays outside the deterministic local core and never becomes a runtime requirement.

Requires Node.js 22+. If your Node build exposes `node:sqlite` only behind `--experimental-sqlite`, `cm` re-execs itself with that flag automatically.

For developers: `bin/cm` is a **generated single-file bundle**, not a hand-maintained monolith. The source of truth lives in the CommonJS fragments under `src/`, and `build/bundle.mjs` reassembles them into `bin/cm` (see [`src/README.md`](src/README.md) for the canonical fragment order). Do **not** hand-edit `bin/cm` — edit the relevant fragment in `src/` and run `node build/bundle.mjs`.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/alessiobacin/code-mem/main/install.sh | bash
```

Manual install:

```bash
mkdir -p ~/.local/bin
curl -fsSL https://raw.githubusercontent.com/alessiobacin/code-mem/main/bin/cm -o ~/.local/bin/cm
chmod +x ~/.local/bin/cm
export PATH="$PATH:$HOME/.local/bin"
```

Both paths distribute the **generated** `bin/cm` bundle. Source lives in `src/`; see [`src/README.md`](src/README.md) and run `node build/bundle.mjs` after editing a fragment.

## Quick Start

Public help is deliberately **lean**: the corollary graph/scan/query/entities/history/digest/import surfaces are shown only with `cm help --full` (or `cm --full`); they still work when called directly.

Initialize memory in a repo:

```bash
cm init --deep
```

Save a durable project fact:

```bash
cm save --kind fact "The API uses signed webhook verification."
```

Save a decision:

```bash
cm save --kind decision --title "Use Vitest" \
  "Vitest is the default test runner for unit tests."
```

Save a user preference:

```bash
cm save --kind preference --layer user \
  "Prefer concise answers and file references."
```

Record a conversation row into the capture layer and search it back:

```bash
cm save --auto --role dev "git worktree flow explained to agent"
cm sq "worktree flow"
```

Recall relevant memory for a task:

```bash
cm recall "fix flaky e2e tests" --level 2
```

Inspect the retrieval plan without recalling:

```bash
cm plan "deploy preview build"
```

Update the installed CLI from GitHub:

```bash
cm update
```

Regenerate the markdown projections:

```bash
cm project
```

## One-command full repository indexing

For an existing repository, use the unified workflow:

```bash
cm init --deep
```

It detects available Claude Code, Pi, Codex, OpenCode, Gemini, Qwen, Copilot,
Cursor, and Windsurf harnesses; installs project-local hooks, skills, and
`/cm-update`; indexes directories, files, documents, headings, configuration,
assets, code symbols, local imports, external modules, and explicit Markdown
links; runs entity/community enrichment; and writes `memory/graph-3d.html`. For
infrastructure repositories with explicit server/service inventories, the HTML
graph uses an operational projection: each visible node is a server, service,
application, database, or storage entity. The full document/evidence graph is
still retained in `memory/graph.json` and SQLite for recall and provenance.
When a harness CLI is available, cm invokes it in a bounded read-only mode and
uses its existing settings/authentication for evidence-bound semantic
normalization and relations. Secrets are never read or printed by cm.

After repository changes:

```bash
cm update --memory --deep
```

### Two views: "How it works" and "Technical"

`memory/graph-3d.html` has a **💡 How it works / 🔧 Technical** switch. The
technical view is the full evidence graph (functions, files, modules, calls)
that agents use. "How it works" is a plain-language 3D **flowchart** of the
whole app for people who are not developers:

- coloured zones are the *parts* of the software ("The Librarian", "The Front
  Door"), each holding the steps it takes;
- **journeys** ("When you ask for work") follow what happens from a trigger to
  every ending: steps, **questions** the software asks itself (yellow diamonds,
  one arrow per answer), places where things are kept, and endings;
- pick a journey and its steps re-arrange top-down into a readable flowchart,
  with the numbered steps and branches in the side panel; click a step to see
  where it comes from and where it goes, or a part to jump to its technical
  pieces.

The map is built in two LLM passes through the project's harness, in the
README's language: files are grouped into named parts, then the harness reads
the code (read-only tools) and writes the flowchart. It is stored as derived
data in `state.db` and refreshed by `cm update --memory --deep` only when files
or function/class names changed. Without an LLM the previous map follows file
changes and is flagged "may be out of date" until the next LLM run.

```bash
cm logic            # build/refresh the map, print it, rewrite graph-3d.html
cm logic --force    # rename everything even if the code structure is unchanged
cm logic --json     # machine-readable map
```

## Global local graph service

The installer creates one per-user `cm-graphd` service on loopback. It serves every registered repository while keeping each project's memory database, harness settings, provider selection, and chat context isolated.

```bash
cm service install            # one-time OS user-service setup
cm service status
cm serve                      # register/open the current project's graph
cm service stop               # optional lifecycle control
```

`cm serve --foreground` is available only as a project-local diagnostic mode. The normal URL contains a project-scoped id and local capability token; the service never accepts a raw filesystem path from the browser. If no harness with an explicit provider is configured in the current project, the graph remains usable and the chat panel stays hidden.

The lower-level scan/entity/community commands remain useful diagnostics, but
are not required for a complete graph.

## What `cm init` Creates

```text
your-project/
└── memory/
    ├── MEMORY.md
    ├── USER.md
    ├── graph.json
    ├── graph-3d.html
    └── state.db
```

The per-user service registry is kept separately at `~/.cm/graphd/projects.json`.

The same registry is the managed-project catalog. It is visible from every
Code-Mem project through `cm projects`; project contents are never injected
automatically. Cross-project recall or graph access requires an explicit
selector, for example `cm projects recall <project-id> "the prior deploy fix"`
or `cm projects graph <project-id>`.

## Memory scopes and types

Code-Mem separates memory by both type and scope. Project memory lives in
`<repo>/memory/state.db`; global memory lives in `~/.cm/state.db`.

- `fact`: durable project or global knowledge.
- `decision`: a choice and its reason/consequence.
- `procedure`: repeatable instructions; consolidated into the procedural layer.
- `issue`: a failure, cause, fix, or next diagnostic step.
- `artifact`: a useful file, command, endpoint, report, or generated output.
- `preference`: a user-level working preference. General preferences belong in
  the global store and are injected into normal project recall as
  `global-preference`; they never override project facts or detected stacks.
- `event`: a dated change or occurrence, usually produced by temporal imports.
- `inference`: a derived claim that should remain less authoritative than an
  observed fact or verified decision.

Layers describe lifecycle rather than ownership: `working` and `episodic` are
short-lived intake/context, `semantic` holds stable facts/decisions/issues,
`procedural` holds repeatable procedures, and `user` holds preferences.
Conversation messages and evidence/verification records are supporting layers;
they are searchable/provenance-bearing but are not automatically promoted to
durable facts. Use `cm consolidate` after a meaningful session.

Use `cm save --global --kind preference --layer user "I generally prefer Next.js"`
for a cross-project preference. In a Python repository the preference is
context, not a technology decision: the project snapshot and project facts keep
Python as the active stack. Use `--scope project` for a project-only diagnostic
recall; default recall combines the current project with relevant global
preferences.

## Architecture

The CLI is modular by construction: `bin/cm` is a single-file bundle assembled from `src/` fragments by `build/bundle.mjs` (see [`src/README.md`](src/README.md)), keeping a one-file install while the code stays maintainable.

`state.db` is the source of truth.

- `memory_items`: typed project memories, with a lifecycle `status` (`active`/`archived` plus `contested`/`corrected`/`obsolete`) and a `corrected_by` provenance column (added additively by a guarded migration on pre-existing databases)
- `memory_context`: branch, cwd, agent, task, files, tags
- `memory_links`: relationships between memories
- `memory_vectors`: per-memory embedding vectors (`model` = `trigram` or `nomic-embed-text`), stored as Int8-quantized blobs
- `messages` + `messages_fts`: searchable conversation log (written by the capture layer)
- `graph_nodes` / `graph_edges`: graph persisted in SQLite

`memory_items` and `memory_context` are written transactionally: multi-statement write sequences (upsert + context row, item + trigram vector) run inside `BEGIN IMMEDIATE`/`COMMIT` with `ROLLBACK` on failure, so a crash or a failed statement can never leave half-written rows. The `cm watch` daemon recovers from stale lock files by checking whether the recorded PID is still alive before refusing to start.

`MEMORY.md` and `USER.md` are generated projections from the database. They should be treated as read-friendly outputs, not as the primary storage layer.

## Command Reference

### `cm init`

Initialize local memory in the current repo.

What it does:

- creates `memory/`
- creates `state.db`
- creates `graph.json`
- imports legacy `MEMORY.md` / `USER.md` entries if present
- scans the repo and stores a project snapshot
- regenerates markdown projections

Usage:

```bash
cm init --deep   # recommended first run: full graph + harness integration
cm init          # minimal compatibility initialization
```

For a complete first index of an existing repository, run one command:

```bash
cm init --deep
```

`cm init --deep` stores the snapshot, full file/document evidence graph, code
symbols, explicit and inferred relations, entity nodes, communities, projections,
and the navigable `memory/graph-3d.html`. For infrastructure vaults the HTML
projection shows only operational entities, so headings, imported memory copies
and AST symbols do not become visual nodes. Later, `cm update --memory --deep` repeats
the same idempotent workflow after code or documentation changes.

### `cm setup`

Install the `cm` skill into supported agent harnesses found on the machine.

Usage:

```bash
cm setup
```

Notes:

- the skill is installed in supported user-level harness directories
- `cm init <harness>` installs the harness-native session hook and prompt/response capture hook for Claude, Pi, Codex, Copilot CLI, or Cursor
- hooks are installed only for the selected current project; existing hook configuration is preserved
- if you run `cm setup` from your home directory, `cm` warns and asks before installing a global hook there; this is not recommended

### `cm update`

Check the GitHub version of `cm`, download the latest CLI, replace the current executable, and refresh installed skill files. Downloads use `fetch` over HTTPS with a host allowlist (`raw.githubusercontent.com`, `api.github.com`, localhost for `CM_UPDATE_BASE` test mirrors).

Usage:

```bash
cm update
cm update --force
cm update --memory                  # re-scan repo: refresh snapshot + graph (+ auto-install missing harness hooks)
cm update --memory --deep           # full repository index + semantic relations + 3D graph
cm update --memory --clean [--dry-run]  # archive near-duplicates + low-confidence noise
cm update --memory --reset         # archive ALL project memories and re-scan fresh
```

Notes:

- `cm update` resolves the latest `main` commit on GitHub, then compares both the local CLI version and the installed file contents with that exact remote revision.
- **Integrity gate:** before any local file is replaced, the downloaded bundle's SHA-256 digest is verified against the published remote manifest (`bin/cm.sha256`). On mismatch the update aborts and nothing is written; an older mirror without a manifest only triggers a warning. The download base can be overridden with the `CM_UPDATE_BASE` environment variable (used by the integrity tests to exercise the gate against a local mirror).
- `--force` reinstalls even if the versions match.
- The command updates the current executable path and rewrites harness skill files when possible.

### `cm mcp`

Stdio JSON-RPC MCP server exposing project memory to any MCP-compatible harness (no shell-out needed). Tools: `memory_search` (ranked titles + summaries + scores), `memory_timeline` (recent rows, optional kind filter), `memory_get` (full row by id). Reuses the `recallMemories` pipeline, so ranking matches `cm recall --level 2 --mode hybrid`.

Usage:

```bash
cm mcp                       # speak JSON-RPC 2.0 on stdio
```

Harness wiring examples:

```json
// opencode.json — {"mcp": {"cm": {"type": "local", "command": ["cm", "mcp"]}}}
// claude / gemini / qwen / cursor / copilot — same shape in their MCP config
```

### `cm version`

Show the installed CLI version.

Usage:

```bash
cm version
cm --version
cm -v
```

### `cm help`

Show CLI help.

Usage:

```bash
cm help
cm help --full
cm --full
```

Notes:

- Bare `cm help` prints the **lean** public surface (core memory workflow + capture).
- `cm help --full` / `cm --full` additionally reveal the corollary graph/scan/query/entities/history/digest/import commands; they run correctly when called directly even without `--full`.

## Memory Write Commands

### `cm save`

Save a typed memory item.

Usage:

```bash
cm save [--kind KIND] [--layer LAYER] [--title TITLE] [--summary TEXT] \
  [--confidence 0.0-1.0] [--tag tag1,tag2] [--file path1,path2] [--global] [--force] <text>
cm save --auto [--role dev|agent] <text>
```

Notes:

- `--auto` writes a **conversation row** into the `messages` table (capture layer) instead of a typed memory; `[--role dev|agent]` tags who spoke. Rows are searchable via `cm sq`.

Supported kinds:

- `fact`
- `decision`
- `procedure`
- `issue`
- `preference`
- `artifact`

Supported layers:

- `working`
- `episodic`
- `semantic`
- `procedural`
- `user`

Examples:

```bash
cm save --kind issue "Fake timers break this test suite when run in parallel."
cm save --kind procedure --layer procedural \
  --title "Reset local DB" \
  --file scripts/reset-db.sh \
  "Run scripts/reset-db.sh and reseed test fixtures."
cm save --kind procedure --global \
  "Deployment procedure: confirm the target, then use Docker on the server named in .env."
cm save --kind preference --layer user \
  "Prefer patches over full rewrites."
```

Notes:

- `--global` saves the memory into the cross-project store at `~/.cm/state.db`.
- Every `cm save --global ...` also writes a dated markdown snapshot to `~/.cm/memories/<timestamp>/global-memory.md`.
- `cm recall` and `cm recall-auto` search both project memory and global memory automatically.
- Every save runs through the **semantic dedup path**: the text is embedded as a trigram vector (stored in `memory_vectors`, Int8-quantized) and compared against the 50 most recent active memories of the same kind; similarity above 0.65 returns the existing memory instead of creating a near-duplicate. Use `--force` to save anyway. If Ollama with `nomic-embed-text` is reachable, an async model embedding upgrade is triggered on top — the trigram vector is the deterministic guarantee, so recall works identically without Ollama.
- `cm save --auto [--role dev|agent]` additionally records the message into the searchable conversation log (see *Capture layer*).

### `cm add`

Legacy shortcut for saving a project fact.

Equivalent to:

```bash
cm save --kind fact --layer semantic "<text>"
```

Usage:

```bash
cm add "Project uses React Server Components."
```

### `cm add-user`

Legacy shortcut for saving a user preference.

Equivalent to:

```bash
cm save --kind preference --layer user "<text>"
```

Usage:

```bash
cm add-user "Prefer short commit messages."
```

### `cm replace`

Replace the body of one active memory matched by id, title, or body text.

Usage:

```bash
cm replace <match> <new text>
```

Example:

```bash
cm replace "Vitest" "Vitest is the default runner; Playwright is only for e2e."
```

A replace is a correction: the referenced memory is transitioned to `status='corrected'` with `corrected_by` set to the acting agent, so the pre-correction text stops serving as an active recall candidate.

### Memory lifecycle (`contested:` / `corrected:` / `obsolete:`)

Memories carry a lifecycle status (`active`, `archived`, plus the correction states `contested`, `corrected`, `obsolete`). Only `active` memories are recall candidates, dedup targets, or counted by `cm ls` / `cm stats`.

A save whose body starts with `contested:`, `corrected:`, or `obsolete:` followed by the text (or title) of a prior memory transitions that referenced memory to the named status and stamps `corrected_by` with the acting agent. The correction itself is not stored as a new near-duplicate entry:

```bash
cm save "corrected: Vitest is the default runner — it is now Vitest 3, watch mode enabled by default"
```

The transition is idempotent and additive: on pre-existing databases the `corrected_by` column is added by a guarded migration (`ensureMigrationColumns`) that never breaks older `state.db` files.

### `cm rm`

Archive one active memory matched by id, title, or body text.

Usage:

```bash
cm rm <match>
```

Example:

```bash
cm rm "old webpack workaround"
```

### `cm archive`

Archive a memory by exact id.

Usage:

```bash
cm archive <memory-id>
```

### `cm touch`

Mark a memory as recently useful by incrementing its access count and last-accessed timestamp.

Usage:

```bash
cm touch <memory-id>
```

### `cm link`

Create a relationship between two memories.

Usage:

```bash
cm link <source-id> <target-id> <relation> [weight]
```

Example:

```bash
cm link mem_issue_a mem_proc_b solved_by 1
```

## Memory Read Commands

### `cm ls`

List active non-user memories.

Usage:

```bash
cm ls
```

### `cm ls-user`

List active user preference memories.

Usage:

```bash
cm ls-user
```

### `cm recent`

List most recently updated memories.

Usage:

```bash
cm recent
cm recent 20
```

### `cm plan`

Show the local retrieval plan for a task.

The planner is rule-based. It classifies the task and prioritizes memory kinds before retrieval.

Usage:

```bash
cm plan <task>
```

Example:

```bash
cm plan "refactor auth middleware"
```

### `cm recall`

Retrieve memories relevant to a task.

Usage:

```bash
cm recall <task> [--level 1|2|3] [--limit N] [--mode keyword|hybrid|semantic]
```

Levels:

- `1`: titles only
- `2`: title + summary + light context
- `3`: full body + tags + files

Modes:

- `hybrid` (default) — deterministic ranking enriched with semantic similarity
- `semantic` — semantic similarity dominates the score (0.55 weight)
- `keyword` — pure deterministic/lexical, no embedding computation

`cm explain` accepts the same `--mode` values.

Examples:

```bash
cm recall "fix oauth callback bug"
cm recall "deploy staging release" --level 1
cm recall "write onboarding docs" --level 3 --limit 5
```

Notes:

- Project and global memories are ranked together.
- Global results are labeled as `[global]` in the output.

### `cm recall-auto`

The automatic SessionStart recall (also runnable directly). It retrieves memories from the current context (branch, git log, cwd) and applies a **multi-round temperature re-ranking** before rendering: three successive re-ranking rounds run a softmax over the composite signal score with a falling temperature (`T0/r`, colder and more decisive each round), accumulating an EM-like cross-round consensus. Round 1 is order-identical to the single-pass baseline — `cm recall` and the other modes are untouched — while later rounds promote candidates whose mixed signals hold up under scrutiny and demote borderline ones. Output scores are re-scaled to `[0,1]`, and repeated runs are deterministic.

### `cm backup`

Create a filesystem backup of stored memories.

Usage:

```bash
cm backup
cm backup --global
```

Behavior:

- `cm backup` writes the current project's active memories to `./cm/memories/<timestamp>/project-memory.md`
- `cm backup --global` writes the global memory store to `./cm-global-backup-<timestamp>.json`

### `cm restore`

Restore a global backup onto another machine or profile.

Usage:

```bash
cm restore --global [file]
```

Behavior:

- merges the backup into `~/.cm/state.db`
- if `file` is omitted, the latest `cm-global-backup-*.json` file in the current directory is used

### `cm project`

Regenerate `MEMORY.md` and `USER.md` from `state.db`.

Use it when you want to refresh the always-in-context projection without changing any memory entries.

Usage:

```bash
cm project
```

### `cm export` / `cm import <bundle.json>` — deterministic merge

Export the full `memory/state.db` memory set to a JSON bundle and merge it (or a teammate's bundle) into another project database:

```bash
cm export                       # writes ./export.json
cm export --output team-x.json  # custom filename

cm import team-x.json           # merge a bundle into the current project
```

Behavior:

- the bundle (`{ version, scope: "project", exportedAt, items }`) is deterministic and includes every memory regardless of status, so lifecycle provenance survives a round-trip.
- the merge is an idempotent diff keyed by memory id: **new ids are created**, **existing ids are updated only when the incoming `updated_at` ISO timestamp is newer** (last-write-wins), otherwise the item is skipped unchanged. Re-importing the same bundle is a no-op.
- merged items are re-vectorized (trigram) and re-indexed in FTS, and projections are refreshed.
- `cm import <source-folder-or-file>` imports any Markdown knowledge source, including a folder outside the current project. The command infers structure from content, runs asynchronous local-LLM normalization when available, preserves frontmatter/tags/aliases/links, and remains idempotent. It asks one question about deleting source Markdown files after a successful import; answer no to preserve the source. `--delete-source` is available for automation, while `--dry-run` and `--replace` remain supported. A positional `.json` file is treated as an export bundle; graph/JSON integrations remain available through their explicit flags.

Set `CM_IMPORT_MODEL` to select the local model (default: `llama3.1:8b`). If the local model is unavailable, import completes with deterministic normalization and reports the fallback.

### `cm stats`

Show a deterministic value metric computed from real data (no vanity counters):

```bash
cm stats
```

Output:

- `memories` — count of active memories
- `recalls (actions conserved)` — sum of `access_count` over active memories (every `cm recall` / `cm touch` hit counts)
- `time saved estimate` — recalls × 3 min
- `value` — memories + recalls × 2 + time-saved estimate

### `cm consolidate`

Promote active `working` and `episodic` items into longer-lived layers and refresh projections.

Current behavior:

- normalizes summaries
- promotes coding procedures to `procedural`
- promotes facts/issues/decisions into `semantic`
- rebuilds `MEMORY.md` and `USER.md`

Usage:

```bash
cm consolidate
```

### Cognitive memory review and 3D graph

The lifecycle E2E report compares CodeMem with Graphiti and the repository's Graphify importer:

- [`docs/comparisons/graphiti-vs-codemem-e2e.md`](docs/comparisons/graphiti-vs-codemem-e2e.md)
- [`docs/benchmarks/README.md`](docs/benchmarks/README.md)
- [`docs/visualization/cognitive-memory-3d.html`](docs/visualization/cognitive-memory-3d.html) — labelled orbit/zoom/click 3D view of scope, episodes, memories, evidence and verification state; the bottom-left legend documents drag, pan, zoom and node focus.

## Graph Commands

### `cm ga`

Add a node to `graph.json`.

Usage:

```bash
cm ga <id> <label> <type>
```

Example:

```bash
cm ga auth_mod "Auth Module" module
```

### `cm ge`

Add an edge to `graph.json`.

Usage:

```bash
cm ge <source> <target> <relation> [confidence]
```

Example:

```bash
cm ge auth_mod db_mod depends_on EXTRACTED
```

### `cm gn`

Show node neighbors.

Usage:

```bash
cm gn <id>
```

### `cm gp`

Show a BFS path between two nodes.

Usage:

```bash
cm gp <from> <to>
```

### `cm gs`

Show graph stats.

Usage:

```bash
cm gs
```

### `cm gi`

Show graph insights such as hubs and cross-type edges.

Usage:

```bash
cm gi
```

## Semantic Commands

### `cm entities`

Automatically extract entities (technologies, files/modules, symbols) from saved memories and, optionally, from conversation logs, and (with `--apply`) write them into the graph to enrich recall/query/explain.

Usage:

```bash
cm entities [--limit n] [--msgs] [--apply] [--source global]
```

Examples:

```bash
cm entities                  # list top entities with category + count
cm entities --limit 10       # cap the list
cm entities --msgs           # also extract from stored conversations
cm entities --apply          # upsert entity nodes + co-occurrence edges into the graph
```

Zero dependencies: all matching is heuristic (tech alias map, file-extension regex, PascalCase/CamelCase/kebab symbols).

### `cm history` / `cm digest`

Show a timeline of memory evolution plus a digest (by kind, by month, top entities).

Usage:

```bash
cm history [--kind k] [--entity e] [--limit n] [--msgs]
cm digest [--kind k] [--entity e] [--limit n]
```

- `--msgs` also shows the latest 15 captured conversation rows under the digest.

Examples:

```bash
cm history                 # full timeline + digest
cm history --kind decision  # only decisions
cm history --entity redis   # only memories mentioning "redis"
cm digest --limit 5         # alias, capped to 5
```

## Search

### `cm sq`

Search stored conversation logs through SQLite FTS5.

Usage:

```bash
cm sq <query> [limit]
```

Example:

```bash
cm sq "TypeScript strict mode" 10
```

## Retrieval Model

`cm recall` uses a local retrieval plan plus deterministic ranking.

Planner task kinds:

- `debug`
- `feature`
- `refactor`
- `review`
- `docs`
- `deploy`
- `default`

Ranking considers:

- keyword match
- recency
- access count
- context match
- task-kind priority
- number of memory links
- **trigram similarity** — fallback embedding that catches morphological variants and typos without external models
- **Ollama embedding** (optional) — semantic similarity via `nomic-embed-text`

`--mode` rebalances the mix: `semantic` weights the similarity score at 0.55, `hybrid` keeps the full deterministic blend (and can go fully semantic-driven when the keyword/concept scores are negligible), `keyword` skips embeddings entirely.

`cm recall-auto` adds a multi-round temperature re-ranking on top of the same score: three softmax rounds with falling temperature (`T0/r`) accumulate a cross-round consensus before the context block is rendered, so stable all-round matches outrank borderline ones. Round 1 is strictly monotonic in the base score, so `cm recall` itself is unchanged.

No external model is required for retrieval. If Ollama is present, it is preferred; if absent, trigram similarity provides semantic-like matching at zero dependency cost.

## Recommended Workflow

1. Run `cm init --deep` once per repo.
2. Save durable learnings with `cm save`.
3. When a learning should apply in every repo, save it with `cm save --global`.
4. Use `cm recall "<task>"` before starting substantial work.
5. Use `cm touch <id>` on especially useful memories.
6. Run `cm consolidate` after a debugging or implementation session.
7. Let agents read `MEMORY.md` and `USER.md` as compact projections.

## Notes

- `MEMORY.md` and `USER.md` are generated; direct edits may be overwritten by `cm project` or `cm consolidate`.
- Legacy commands still work for compatibility.
- `graph.json` remains intentionally simple and separate from the SQLite memory tables.
- `cm scan --deep` installs the optional `acorn` AST parser into `~/.cm/deps` on first use (announced, one-time `npm install`); offline it falls back to the regex parser transparently (pass `--no-ast` to force regex).
- The graph service is optional and loopback-only; project memory remains file-local and is never moved into the service. `cm history --msgs` covers inspection, and `cm mcp` covers agent integration.

## Threat model (local-first)

- `state.db` and `memory/` are plaintext on your disk; committing `memory/` to a shared repo exposes decisions and captured conversation rows. Do not save secrets, tokens, or personal data (`cm save` never redacts).
- `cm update` downloads over HTTPS with a host allowlist (`raw.githubusercontent.com`, `api.github.com`; localhost only via `CM_UPDATE_BASE` mirrors) and verifies SHA-256 against `bin/cm.sha256` before installing.
- The only network surfaces are `cm update` and the optional Ollama embedding endpoint on localhost; everything else is local SQLite.

## License

MIT

## Automatic Mode

code-mem can run fully automatically with zero user intervention:

```bash
# One-time setup
ollama pull nomic-embed-text   # 137MB model for embeddings
cm setup                        # installs skill + SessionStart hook
cm service install              # starts the one global local graph service
cm watch --daemon               # starts background daemon
```

**What happens automatically:**

- `cm watch --daemon` polls every 30s for new memories without embeddings, computes them via Ollama (`nomic-embed-text`), consolidates working/episodic items, regenerates MEMORY.md/USER.md, and writes a periodic capture heartbeat row
- The `SessionStart` hook runs `cm recall-auto` at each Claude Code session start, injecting relevant project and global memories based on branch, git log, and cwd (re-ranked across three temperature rounds), and writes a capture context row
- During a session, the agent uses `cm save` to persist learnings, `cm save --auto` to record conversation rows, `cm touch` to mark useful items, and `cm consolidate` to promote short-term to long-term

**Prerequisite:** [Ollama](https://ollama.com) with `nomic-embed-text`:
```bash
ollama pull nomic-embed-text
```

If Ollama is absent, all commands degrade gracefully to a **trigram-based fallback** that catches morphological variants and typos — no functionality loss, no extra dependencies.

### Typical Workflow

1. `ollama pull nomic-embed-text` — one-time download (137MB)
2. `cm init --deep` — initialize memory and build the full repository graph
3. `cm setup` — installs skill and SessionStart hook in the project's `.claude/settings.json`
4. `cm service install` — starts the one global loopback graph service
5. `cm watch --daemon` — optional background embedding + consolidation worker
6. Work normally. code-mem remembers everything automatically.

## Comparison with Other Memory Systems

| Feature | **code-mem** | **claude-mem** | **graphify** | **Claude Code file memory** |
|---|---|---|---|---|
| **Storage** | SQLite (node:sqlite) — local only | Remote cloud service (MCP) | JSON graph (`graph.json`) + optional Neo4j | Markdown files (flat) |
| **Search** | FTS5 full-text search over conversations + trigram/Ollama vector similarity with `--mode keyword\|hybrid\|semantic` | Semantic search via MCP API | BFS/DFS graph traversal + community detection | Manual grep only |
| **Retrieval** | Deterministic ranking (keyword + recency + task-kind) | ML-based semantic similarity | Graph traversal (query/path/explain) | None — always loaded in context |
| **Context cost** | ~800 tokens (MEMORY.md) + ~500 (USER.md) = fixed | Unknown — MCP calls per session | 0 tokens on load — queried on demand | Proportional to file size |
| **CLI** | Single binary (`cm`) — no dependencies | Requires npm + MCP server | Requires Python + pip packages | None |
| **Agent support** | Agent-agnostic (works with any coding agent) | Claude Code only | Claude Code + MCP-compatible agents | Claude Code only |
| **Persistence** | Per-project SQLite + optional local global SQLite with typed layers, plus deterministic project-to-project merge (`cm export` / `cm import <bundle.json>`) | Cross-project cloud persistence | Per-run or incremental — no persistent "memory" layer | Per-file markdown |
| **Graph** | Lightweight JSON graph (`graph.json`) with nodes/edges | None | Full-featured: community detection, AST + semantic extraction, hub analysis | None |
| **Install** | `curl` one-liner | `npm install -g claude-mem` + MCP config | `pip install graphifyy` | Built into Claude Code |
| **License** | MIT | Apache-2.0 | MIT | Proprietary (Anthropic) |
| **Dependencies** | Zero | Node.js + MCP plugin system | Python (networkx, community detection, NLP) | None |
| **Ideal for** | Any project needing persistent, lightweight agent memory | Claude Code users wanting cross-session cloud memory | Codebase exploration, architecture mapping, research corpora | Simple, always-in-context agent notes |

### Summary

### code-mem is the only system that combines a single binary with no required runtime packages, agent-agnostic support, typed memory layers, and local-first storage. It trades hosted sync and organization-level sharing for simplicity, determinism, privacy, and portability — making it the best fit for teams and individuals who want persistent memory without external services or vendor lock-in.

### Further Reading

- **[docs/design/philosophy.md](docs/design/philosophy.md)** — design philosophy: local-first, kinds & layers, deterministic recall, minimal dependencies, why simplicity wins
- **[docs/comparisons/comparison.md](docs/comparisons/comparison.md)** — detailed comparison with claude-mem, graphify, Claude Code file memories, Mem0, Zep, LangMem, and Letta (MemGPT)
- **[docs/benchmarks/memory-benchmark.md](docs/benchmarks/memory-benchmark.md)** — reproducible benchmark methodology and current comparison entrypoints
- **[docs/comparisons/graphify-vs-codemem-e2e.md](docs/comparisons/graphify-vs-codemem-e2e.md)** — measured Graphify comparison with raw results
- **[docs/comparisons/graphiti-vs-codemem-e2e.md](docs/comparisons/graphiti-vs-codemem-e2e.md)** — measured Graphiti comparison with cognitive-lifecycle boundary
- **[docs/README.md](docs/README.md)** — organized documentation index and latest evidence
