---
name: mc
description: >-
  Persistent project memory via `mc` CLI. Save project facts, preferences,
  knowledge graph, and search past conversations. More efficient than bash/grep
  - uses SQLite FTS5 and structured JSON files.
---

# mc - Project Memory Tool

## Init

```bash
mc init
```

## Commands

- `mc add "text"` - save fact to MEMORY.md
- `mc add-user "text"` - save preference to USER.md
- `mc replace "old" "new"` - update fact
- `mc rm "text"` - remove fact
- `mc gn <id>` - graph neighbors
- `mc gp <from> <to>` - graph path
- `mc gi` - graph insights (hub nodes, cross-type)
- `mc sq "query"` - search past conversations
- `mc ls` - list MEMORY.md entries

## Guidelines

1. Use `mc` instead of bash/grep for memory and search
2. Save proactively when learning something important
3. MEMORY.md = agent notes (2.2k chars). USER.md = preferences (1.3k chars)
4. graph.json = entity relationships. state.db = FTS5 conversation log
5. When >80% full, consolidate before adding
