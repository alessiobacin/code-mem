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
cm init --deep             # full repository index + harness integration + 3D graph
cm update --memory --deep  # repeat after repository changes
```

## Maintain

```bash
cm update                    # binary self-update from remote
cm update --memory           # re-scan repo: refresh snapshot + graph
cm update --memory --clean [--dry-run]  # archive near-duplicates + low-confidence noise
cm update --memory --reset   # archive ALL project memories and re-scan fresh
cm serve                      # open the graph through the global local service
cm service install            # install/start one per-user graph service
cm version
```

## Help & Surface

Public help is deliberately **lean**. Run `cm help --full` (or `cm --full`) to see the complete surface; corollary graph/scan/query/entities/history/import commands stay callable directly even though they are not listed in bare help.

## Core Commands

- `cm save --kind decision "Use Vitest for unit tests"` - save a typed memory
- `cm save --kind procedure --global "Deploy with Docker from the repository .env file"` - save a cross-project memory
- `cm save --global --kind preference --layer user "I generally prefer Next.js"` - save a general user preference without changing any project's detected stack
- `cm save --auto --role dev "what was said"` - **capture layer**: write a conversation row into the `messages` table (searchable with `cm sq`)
- `cm recall "fix flaky tests" --level 2` - retrieve relevant memory for a task (add `--mode keyword|hybrid|semantic` to rebalance the ranking)
- `cm recall-auto` - SessionStart contextual recall, re-ranked over three temperature rounds (EM-like consensus)
- `cm plan "deploy preview build"` - inspect the retrieval plan
- `cm stats` - active memories, conserved recalls, estimated time saved, value metric
- `cm export` / `cm import <bundle.json>` - deterministic JSON bundle export + idempotent merge (last-write-wins by updated_at)
- `cm import <source-folder>` - import any Markdown knowledge source; infer structure and normalize with a local LLM when available
- Full repository index: `cm init --deep` (one command; detects harnesses, installs hooks/skill, imports Markdown, indexes files/code/assets, adds relations, refreshes projections, and writes `memory/graph-3d.html`)
- `cm sq "query"` - full-text search recorded messages
- `cm mcp` - stdio MCP server (`memory_search` / `memory_timeline` / `memory_get`) for MCP-compatible harnesses
- `cm recent` - list recent memories
- `cm consolidate` - promote and normalize memories
- `cm project` - regenerate `MEMORY.md` and `USER.md`
- `cm backup` - save project memories to `./cm/memories/<timestamp>/project-memory.md`
- `cm backup --global` - export global memories to a backup file in the current directory
- `cm restore --global [file]` - merge a global backup into `~/.cm/state.db`
- `cm projects` - list all Code-Mem-managed projects registered for this user
- `cm projects show <id|path|name>` - inspect one registered project without loading its memories
- `cm projects recall <id|path|name> "query"` - explicitly recall another project's memory
- `cm projects graph <id|path|name>` - explicitly open another project's graph through the local service

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
- `cm gx [html|html3d|graphml|neo4j|svg]` - export the graph
- `cm service status|start|stop|restart|run` - manage the one per-user local graph service
- `cm serve [--foreground] [--port N]` - open the project graph; `--foreground` is a diagnostic project-local server
- `cm scan --relations [--apply]` - diagnostic code-relationship suggestions
- `cm scan --deep [--no-ast]` - diagnostic deep scan; Acorn is optional and the regex fallback remains available offline
- `cm query "question"` - BFS graph query from matched nodes
- `cm import --graphify <path>` / `--claude-mem` / `--json <path>` - import graph data

### Semantic

- `cm entities [--limit n] [--msgs] [--apply]` - extract entities (tech, files, symbols) from memories (+ optional conversations)
- `cm history [--kind k] [--entity e] [--limit n]` - timeline + digest of memory evolution
- `cm digest` - alias of `cm history`

## Reliability

- Memory writes are transactional (`BEGIN IMMEDIATE`/`COMMIT` with rollback), so a crash never leaves half-written rows.
- `cm watch` recovers from stale lock files left by dead processes (PID liveness check).
- `cm update` verifies the downloaded bundle's SHA-256 against the published `bin/cm.sha256` manifest before installing; on mismatch it refuses and writes nothing.
- For deterministic CI/debug runs, set `CM_NO_LLM=1`; use `CM_NO_OLLAMA=1` when only Ollama embeddings should be disabled.

## Guidelines

1. Save durable facts, decisions, procedures, issues, and preferences with `cm save`. Saves are deduplicated by trigram similarity (>0.65 against recent same-kind memories); use `--force` to override.
2. If the memory should be automatically available in every project, use `cm save --global`. Use global scope for user-wide preferences and reusable workflow knowledge; never use it for a project-specific technology, architecture choice, issue, or secret.
3. Before substantial work, run `cm recall "<goal or bug>" --level 2 --mode hybrid`; use `cm plan` to inspect retrieval and `cm sq` for an exact phrase from a prior conversation. Default recall searches the current project and injects a bounded global-preference slice; `--scope project` is project-only.
4. Never save secrets, tokens, personal data, speculation, or short-lived progress updates.
5. Treat `MEMORY.md` and `USER.md` as generated projections from `state.db`, never as hand-edited source files.
6. `cm init --deep` detects supported harnesses, installs project-local cm skills/hooks and `/cm-update`, and uses a configured harness CLI for bounded read-only semantic normalization. Harness credentials remain owned by the harness.
7. Run `cm consolidate` after debugging or implementation sessions; missing Ollama falls back locally and must not stop work.
8. To import a knowledge source, run `cm import /path/to/source-folder`; the command asks only whether source Markdown should be deleted after success. To move memory between projects (or merge a teammate's), run `cm export` in the source repo and `cm import <bundle.json>` in the target — the merge is idempotent and safe to re-run.
9. Knowledge imports are local and idempotent. Re-run after editing notes; use `--replace` only when the matching imported projection should be rebuilt.
10. Harness response hooks schedule a background deterministic deep refresh, so `memory/graph-3d.html` is regenerated after agent changes without blocking the conversation. The global per-user `cm-graphd` service serves all registered projects on loopback; each graph carries a project-scoped token and opens only that project's memory. Chat appears only when that project has a provider signal (literal provider, compatible base endpoint, or explicit proxy model) and an available harness CLI.

## Memory model

Kinds are semantic labels: `fact`, `decision`, `procedure`, `issue`,
`artifact`, `preference`, `event`, and `inference`. Layers are lifecycle
states: `working`/`episodic` intake, `semantic` durable knowledge,
`procedural` repeatable knowledge, and `user` preferences. Messages, evidence,
belief status, verification, and working-set rows support durable memory; they
are not interchangeable with a confirmed fact.

Global preferences are stored separately from project memory and are injected
into each default project recall as `[global-preference]`. They are context,
not project constraints: a global preference for Next.js must not change a
Python project's snapshot, graph, or implementation decision. The global
managed-project catalog is shared, but another project's content is available
only after an explicit `cm projects recall ...` or `cm projects graph ...`.
