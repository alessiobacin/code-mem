---
name: cm
description: >-
  Persistent project memory via `cm` CLI. Save typed project memories,
  preferences, retrieval plans, graph relationships, and search past
  conversations from SQLite.
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
```

## Core Commands

- `cm save --kind decision "Use Vitest for unit tests"` - save a typed memory
- `cm recall "fix flaky tests" --level 2` - retrieve relevant memory for a task
- `cm plan "deploy preview build"` - inspect the retrieval plan
- `cm recent` - list recent memories
- `cm consolidate` - promote and normalize memories
- `cm project` - regenerate `MEMORY.md` and `USER.md`

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
2. Use `cm recall` at the start of substantial coding tasks.
3. Treat `MEMORY.md` and `USER.md` as generated projections from `state.db`.
4. Use `cm consolidate` after debugging or implementation sessions to keep the projection compact.
