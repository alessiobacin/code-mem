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
- `cm recall "fix flaky tests" --level 2` - retrieve relevant memory for a task
- `cm plan "deploy preview build"` - inspect the retrieval plan
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

## Graph and Search

- `cm ga <id> <label> <type>` - add graph node
- `cm ge <src> <tgt> <rel>` - add graph edge
- `cm gn <id>` - list graph neighbors
- `cm gp <from> <to>` - graph path
- `cm gi` - graph insights
- `cm sq "query"` - search stored conversation logs

## Guidelines

1. Save durable facts, decisions, procedures, issues, and preferences with `cm save`.
2. If the memory should be automatically available in every project, use `cm save --global`.
3. Use `cm recall` at the start of substantial coding tasks; it also searches global memory automatically.
4. Treat `MEMORY.md` and `USER.md` as generated projections from `state.db`.
5. Use `cm consolidate` after debugging or implementation sessions to keep the projection compact.
6. Run `cm setup` from a project directory, not from the user's home folder, unless you explicitly want a global Claude hook.
