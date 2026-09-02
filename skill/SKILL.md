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
cm update                    # binary self-update from remote
cm update --memory           # re-scan repo: refresh snapshot + graph
cm update --memory --clean [--dry-run]  # archive near-duplicates + low-confidence noise
cm update --memory --reset   # archive ALL project memories and re-scan fresh
cm version
```

## Help & Surface

Public help is deliberately **lean**. Run `cm help --full` (or `cm --full`) to see the complete surface; corollary graph/scan/query/entities/history/import commands stay callable directly even though they are not listed in bare help.

## Core Commands

- `cm save --kind decision "Use Vitest for unit tests"` - save a typed memory
- `cm save --kind procedure --global "Deploy classico: docker sul server dal file .env"` - save a cross-project memory
- `cm save --auto --role dev "what was said"` - **capture layer**: write a conversation row into the `messages` table (searchable with `cm sq`)
- `cm recall "fix flaky tests" --level 2` - retrieve relevant memory for a task (add `--mode keyword|hybrid|semantic` to rebalance the ranking)
- `cm plan "deploy preview build"` - inspect the retrieval plan
- `cm stats` - active memories, conserved recalls, estimated time saved, value metric
- `cm export` / `cm import <bundle.json>` - deterministic JSON bundle export + idempotent merge (last-write-wins by updated_at)
- `cm sq "query"` - full-text search recorded messages
- `cm recent` - list recent memories
- `cm consolidate` - promote and normalize memories
- `cm project` - regenerate `MEMORY.md` and `USER.md`
- `cm backup` - save project memories to `./cm/memories/<timestamp>/project-memory.md`
- `cm backup --global` - export global memories to a backup file in the current directory
- `cm restore --global [file]` - merge a global backup into `~/.cm/state.db`

- `cm replace "match" "new text"` - correct a memory (marks it `corrected` with provenance)
- `cm save "corrected: <prior memory text> <new statement>"` - transition a prior memory to `contested`/`corrected`/`obsolete` instead of saving a near-duplicate

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

1. Save durable facts, decisions, procedures, issues, and preferences with `cm save`. Saves are deduplicated by trigram similarity (>0.65 against recent same-kind memories); use `--force` to override.
2. If the memory should be automatically available in every project, use `cm save --global`.
3. Before substantial work, run `cm recall "<goal or bug>" --level 2 --mode hybrid`; use `cm plan` to inspect retrieval and `cm sq` for an exact phrase from a prior conversation. It also searches global memory automatically.
4. Never save secrets, tokens, personal data, speculation, or short-lived progress updates.
5. Treat `MEMORY.md` and `USER.md` as generated projections from `state.db`, never as hand-edited source files.
6. `cm init pi` installs a project-local Pi skill and a best-effort hook: it recalls context at session start and captures completed agent replies without blocking the session.
7. Run `cm consolidate` after debugging or implementation sessions; missing Ollama falls back locally and must not stop work.
8. To move memory between projects (or merge a teammate's), run `cm export` in the source repo and `cm import <bundle.json>` in the target — the merge is idempotent and safe to re-run.
