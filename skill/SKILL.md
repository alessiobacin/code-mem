---
name: cm
description: >-
  Persistent project memory via `cm` CLI, with optional global memory.
  Save typed project memories, preferences, retrieval plans, graph
  relationships, and search past conversations from SQLite.
---

# cm - Code-Mem Tool

Use `cm` as the project's durable, local memory. Recall before rediscovering
old decisions; save evidence-backed outcomes, not a stream of transient chat.

## Initialize

```bash
cm init
cm init pi  # project-local Pi skill + non-blocking session/capture hook
```

## Maintain

```bash
cm update
cm version
```

## Help & Surface

Public help is deliberately **lean**. Run `cm help --full` (or `cm --full`) to see the complete surface; corollary graph/scan/query/entities/history/import commands stay callable directly even though they are not listed in bare help.

## Core Commands

- `cm save --kind decision "Use Vitest for unit tests"` - save a typed memory
- `cm save --kind procedure --global "Deploy classico: docker sul server dal file .env"` - save a cross-project memory
- `cm save --auto --role dev "what was said"` - **capture layer**: write a conversation row into the `messages` table (searchable with `cm sq`)
- `cm recall "fix flaky tests" --level 2` - retrieve relevant memory for a task
- `cm plan "deploy preview build"` - inspect the retrieval plan
- `cm sq "query"` - full-text search recorded messages
- `cm recent` - list recent memories
- `cm consolidate` - promote and normalize memories
- `cm project` - regenerate `MEMORY.md` and `USER.md`
- `cm backup` - save project memories to `./cm/memories/<timestamp>/project-memory.md`
- `cm backup --global` - export global memories to a backup file in the current directory
- `cm restore --global [file]` - merge a global backup into `~/.cm/state.db`

## Legacy Compatibility

- `cm add "text"` - save a fact
- `cm add-user "text"` - save a user preference
- `cm ls` - list project memories
- `cm ls-user` - list user preferences

## Corollary surfaces (shown in `cm help --full`)

These command families work when called directly, but are listed only under `--full`:

### Graph and Search

- `cm ga <id> <label> <type>` - add graph node
- `cm ge <src> <tgt> <rel>` - add graph edge
- `cm gn <id>` - list graph neighbors
- `cm gp <from> <to>` - graph path
- `cm gs` / `cm gi` - graph stats / insights
- `cm gc` - detect graph communities
- `cm gx [html|graphml|neo4j|svg]` - export the graph
- `cm scan --relations [--apply]` - suggest code relationships
- `cm scan --deep` - AST deep scan
- `cm query "question"` - BFS graph query from matched nodes
- `cm import --graphify <path>` / `--claude-mem` / `--json <path>` - import graph data

### Semantic

- `cm entities [--limit n] [--msgs] [--apply]` - extract entities (tech, files, symbols) from memories (+ optional conversations)
- `cm history [--kind k] [--entity e] [--limit n]` - timeline + digest of memory evolution
- `cm digest` - alias of `cm history`

## Agent protocol

1. Before substantial work, run `cm recall "<goal or bug>" --level 2 --mode hybrid`; use `cm plan` to inspect retrieval and `cm sq` for an exact phrase from a prior conversation.
2. Save only durable facts, decisions, procedures, issues, and artifacts. Include relevant paths, commands, tests, ticket IDs, and consequences.
3. Never save secrets, tokens, personal data, speculation, or short-lived progress updates.
4. Use `cm save --global` only for knowledge that genuinely applies across projects.
5. Treat `MEMORY.md` and `USER.md` as generated projections from `state.db`, never as hand-edited source files.
6. `cm init pi` installs a project-local Pi skill and a best-effort hook: it recalls context at session start and captures completed agent replies without blocking the session.
7. Run `cm consolidate` after debugging or implementation sessions; missing Ollama falls back locally and must not stop work.
