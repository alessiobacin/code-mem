---
name: cm
description: >-
  Persistent project memory via `cm` CLI, with optional global memory.
  Save typed project memories, preferences, retrieval plans, graph
  relationships, and search past conversations from SQLite.
---

# cm - Code-Mem Tool

Use `cm` for project memory before reaching for ad-hoc grep across previous sessions.

## Initialize

```bash
cm init
```

## Maintain

```bash
cm update
cm version
```

## Core Commands

- `cm save --kind decision "Use Vitest for unit tests"` - save a typed memory
- `cm save --kind procedure --global "Deploy classico: docker sul server dal file .env"` - save a cross-project memory
- `cm recall "fix flaky tests" --level 2` - retrieve relevant memory for a task (add `--mode keyword|hybrid|semantic` to rebalance the ranking)
- `cm plan "deploy preview build"` - inspect the retrieval plan
- `cm stats` - active memories, conserved recalls, estimated time saved, value metric
- `cm export` / `cm import <bundle.json>` - deterministic JSON bundle export + idempotent merge (last-write-wins by updated_at)
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

## Graph and Search

- `cm ga <id> <label> <type>` - add graph node
- `cm ge <src> <tgt> <rel>` - add graph edge
- `cm gn <id>` - list graph neighbors
- `cm gp <from> <to>` - graph path
- `cm gi` - graph insights
- `cm gc` - detect graph communities
- `cm gx [html|graphml|neo4j|svg]` - export the graph
- `cm scan --relations [--apply]` - suggest code relationships
- `cm scan --deep` - AST deep scan
- `cm query "question"` - BFS graph query from matched nodes
- `cm sq "query"` - search stored conversation logs

## Semantic

- `cm entities [--limit n] [--msgs] [--apply]` - extract entities (tech, files, symbols) from memories (+ optional conversations)
- `cm history [--kind k] [--entity e] [--limit n]` - timeline + digest of memory evolution
- `cm digest` - alias of `cm history`

## Guidelines

1. Save durable facts, decisions, procedures, issues, and preferences with `cm save`. Saves are deduplicated by trigram similarity (>0.65 against recent same-kind memories); use `--force` to override.
2. If the memory should be automatically available in every project, use `cm save --global`.
3. Use `cm recall` at the start of substantial coding tasks; it also searches global memory automatically.
4. Treat `MEMORY.md` and `USER.md` as generated projections from `state.db`.
5. Use `cm consolidate` after debugging or implementation sessions to keep the projection compact.
6. To move memory between projects (or merge a teammate's), run `cm export` in the source repo and `cm import <bundle.json>` in the target — the merge is idempotent and safe to re-run.
7. Run `cm setup` from a project directory, not from the user's home folder, unless you explicitly want a global Claude hook.
