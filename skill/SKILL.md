---
name: cm
description: >-
  Persistent project memory via `cm` CLI. Save project facts, preferences,
  knowledge graph, and search past conversations. More efficient than bash/grep
  - uses SQLite FTS5 and structured JSON files.
---

# cm - Code-Mem Tool

## Init

```bash
cm init
```

## Commands

- `cm add "text"` - save fact to MEMORY.md
- `cm add-user "text"` - save preference to USER.md
- `cm replace "old" "new"` - update fact
- `cm rm "text"` - remove fact
- `cm gn <id>` - graph neighbors
- `cm gp <from> <to>` - graph path
- `cm gi` - graph insights (hub nodes, cross-type)
- `cm sq "query"` - search past conversations
- `cm ls` - list MEMORY.md entries

## Guidelines

1. Use `cm` instead of bash/grep for memory and search
2. Save proactively when learning something important
3. MEMORY.md = agent notes (2.2k chars). USER.md = preferences (1.3k chars)
4. graph.json = entity relationships. state.db = FTS5 conversation log
5. When >80% full, consolidate before adding