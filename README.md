# code-mem

Persistent project memory for coding agents and developers, with optional global memory for reusable cross-project knowledge.

`code-mem` keeps a local memory layer inside each repo, plus an optional local global store:

- typed memories in SQLite
- generated `MEMORY.md` and `USER.md` projections
- a lightweight JSON graph
- FTS5 search over stored conversation logs
- optional global memory in `~/.cm/state.db`

It is designed to stay simple:

- one CLI
- local files only
- no services to run
- no external database

Requires Node.js 22+. If your Node build exposes `node:sqlite` only behind `--experimental-sqlite`, `cm` re-execs itself with that flag automatically.

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

## Quick Start

Initialize memory in a repo:

```bash
cm init
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

## What `cm init` Creates

```text
your-project/
└── memory/
    ├── MEMORY.md
    ├── USER.md
    ├── graph.json
    └── state.db
```

## Architecture

`state.db` is the source of truth.

- `memory_items`: typed project memories
- `memory_context`: branch, cwd, agent, task, files, tags
- `memory_links`: relationships between memories
- `messages` + `messages_fts`: searchable conversation log

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
cm init
```

### `cm setup`

Install the `cm` skill into supported agent harnesses found on the machine.

Usage:

```bash
cm setup
```

### `cm update`

Check the GitHub version of `cm`, download the latest CLI, replace the current executable, and refresh installed skill files.

Usage:

```bash
cm update
cm update --force
```

Notes:

- `cm update` compares the local CLI version with the remote `main` branch version.
- `--force` reinstalls even if the versions match.
- The command updates the current executable path and rewrites harness skill files when possible.

### `cm help`

Show CLI help.

Usage:

```bash
cm help
```

## Memory Write Commands

### `cm save`

Save a typed memory item.

Usage:

```bash
cm save [--kind KIND] [--layer LAYER] [--title TITLE] [--summary TEXT] \
  [--confidence 0.0-1.0] [--tag tag1,tag2] [--file path1,path2] [--global] <text>
```

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
  "Metodo di deploy classico: chiedi conferma e poi usa Docker sul server indicato nel file .env."
cm save --kind preference --layer user \
  "Prefer patches over full rewrites."
```

Notes:

- `--global` saves the memory into the cross-project store at `~/.cm/state.db`.
- Every `cm save --global ...` also writes a dated markdown snapshot to `~/.cm/memories/<timestamp>/global-memory.md`.
- `cm recall` and `cm recall-auto` search both project memory and global memory automatically.

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
cm recall <task> [--level 1|2|3] [--limit N]
```

Levels:

- `1`: titles only
- `2`: title + summary + light context
- `3`: full body + tags + files

Examples:

```bash
cm recall "fix oauth callback bug"
cm recall "deploy staging release" --level 1
cm recall "write onboarding docs" --level 3 --limit 5
```

Notes:

- Project and global memories are ranked together.
- Global results are labeled as `[global]` in the output.

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
- **trigram similarity** — fallback embedding che cattura varianti morfologiche e refusi senza modelli esterni
- **Ollama embedding** (opzionale) — similarità semantica via `nomic-embed-text`

No external model is required for retrieval. If Ollama is present, it is preferred; if absent, trigram similarity provides semantic-like matching at zero dependency cost.

## Recommended Workflow

1. Run `cm init` once per repo.
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

## License

MIT

## Automatic Mode

code-mem can run fully automatically with zero user intervention:

```bash
# One-time setup
ollama pull nomic-embed-text   # 137MB model for embeddings
cm setup                        # installs skill + SessionStart hook
cm watch --daemon               # starts background daemon
```

**What happens automatically:**

- `cm watch --daemon` polls every 30s for new memories without embeddings, computes them via Ollama (`nomic-embed-text`), consolidates working/episodic items, and regenerates MEMORY.md/USER.md
- The `SessionStart` hook runs `cm recall-auto` at each Claude Code session start, injecting relevant project and global memories based on branch, git log, and cwd
- During a session, the agent uses `cm save` to persist learnings, `cm touch` to mark useful items, and `cm consolidate` to promote short-term to long-term

**Prerequisite:** [Ollama](https://ollama.com) with `nomic-embed-text`:
```bash
ollama pull nomic-embed-text
```

If Ollama is absent, all commands degrade gracefully to a **trigram-based fallback** that catches morphological variants and typos — no functionality loss, no extra dependencies.

### Typical Workflow

1. `ollama pull nomic-embed-text` — one-time download (137MB)
2. `cm init` — initialize memory in your project
3. `cm setup` — installs skill and SessionStart hook in the project's `.claude/settings.json`
4. `cm watch --daemon` — starts background daemon (embedding + consolidate + project)
5. Work normally. code-mem remembers everything automatically.

## Comparison with Other Memory Systems

| Feature | **code-mem** | **claude-mem** | **graphify** | **Claude Code file memory** |
|---|---|---|---|---|
| **Storage** | SQLite (node:sqlite) — local only | Remote cloud service (MCP) | JSON graph (`graph.json`) + optional Neo4j | Markdown files (flat) |
| **Search** | FTS5 full-text search over conversations | Semantic search via MCP API | BFS/DFS graph traversal + community detection | Manual grep only |
| **Retrieval** | Deterministic ranking (keyword + recency + task-kind) | ML-based semantic similarity | Graph traversal (query/path/explain) | None — always loaded in context |
| **Context cost** | ~800 tokens (MEMORY.md) + ~500 (USER.md) = fixed | Unknown — MCP calls per session | 0 tokens on load — queried on demand | Proportional to file size |
| **CLI** | Single binary (`cm`) — no dependencies | Requires npm + MCP server | Requires Python + pip packages | None |
| **Agent support** | Agent-agnostic (works with any coding agent) | Claude Code only | Claude Code + MCP-compatible agents | Claude Code only |
| **Persistence** | Per-project SQLite + optional local global SQLite with typed layers | Cross-project cloud persistence | Per-run or incremental — no persistent "memory" layer | Per-file markdown |
| **Graph** | Lightweight JSON graph (`graph.json`) with nodes/edges | None | Full-featured: community detection, AST + semantic extraction, hub analysis | None |
| **Install** | `curl` one-liner | `npm install -g claude-mem` + MCP config | `pip install graphifyy` | Built into Claude Code |
| **License** | MIT | Apache-2.0 | MIT | Proprietary (Anthropic) |
| **Dependencies** | Zero | Node.js + MCP plugin system | Python (networkx, community detection, NLP) | None |
| **Ideal for** | Any project needing persistent, lightweight agent memory | Claude Code users wanting cross-session cloud memory | Codebase exploration, architecture mapping, research corpora | Simple, always-in-context agent notes |

### Summary

### code-mem is the only system that combines zero dependencies, agent-agnostic support, typed memory layers, and local-first storage in a single CLI binary. It trades hosted sync and organization-level sharing for simplicity, determinism, privacy, and portability — making it the best fit for teams and individuals who want persistent memory without external services or vendor lock-in.

### Further Reading

- **[docs/PHILOSOPHY.md](docs/PHILOSOPHY.md)** — design philosophy: local-first, kinds & layers, deterministic recall, zero dependencies, why simplicity wins
- **[docs/COMPARISON.md](docs/COMPARISON.md)** — detailed comparison with claude-mem, graphify, Claude Code file memories, Mem0, Zep, LangMem, and Letta (MemGPT)
- **(IT) [docs/FILOSOFIA.md](docs/FILOSOFIA.md)** — versione italiana della filosofia
- **(IT) [docs/COMPARAZIONE.md](docs/COMPARAZIONE.md)** — versione italiana della comparazione
