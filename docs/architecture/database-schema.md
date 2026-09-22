# CodeMem database schema (`state.db`)

> ER schema for `memory/state.db` (SQLite). Source: [`database-schema.mmd`](database-schema.mmd).
> Verified against the live SQLite schema (tables and keys).

`state.db` is the **source of truth**. `graph.json` and `MEMORY.md`/`USER.md` are regenerable projections.

## Entity-relationship diagram

```mermaid
erDiagram
    MEMORY_ITEMS ||--o| MEMORY_CONTEXT : "has context"
    MEMORY_ITEMS ||--o{ MEMORY_LINKS : "source of"
    MEMORY_ITEMS ||--o{ MEMORY_LINKS : "target of"
    MEMORY_ITEMS ||--o| MEMORY_VECTORS : "embedding"
    MEMORY_ITEMS ||--o| MEMORY_FTS : "indexed"
    MESSAGES ||--o| MESSAGES_FTS : "indexed"
    GRAPH_NODES ||--o{ GRAPH_EDGES : "source of"
    GRAPH_NODES ||--o{ GRAPH_EDGES : "target of"

    MEMORY_ITEMS {
        text id PK "e.g. mem_fact_h_..."
        text kind "fact|decision|procedure|issue|preference|artifact"
        text layer "working|episodic|semantic|procedural|user"
        text title
        text body
        text summary
        real confidence "0.0-1.0"
        real salience "0.0-1.0"
        text source "manual|scan|legacy-import|claude-mem"
        text status "active|archived|contested|corrected|obsolete"
        text created_at
        text updated_at
        text last_accessed_at
        int access_count
        text valid_from
        text valid_to
        text supersedes_id "self-reference"
        text corrected_by "agent that marked contested/corrected/obsolete (additive migration)"
        text hash UK
    }

    MEMORY_CONTEXT {
        text memory_id PK,FK
        text cwd
        text git_branch
        text task_kind
        text files_json
        text tags_json
    }

    MEMORY_LINKS {
        text source_id PK,FK
        text target_id PK,FK
        text relation PK "e.g. depends_on, solved_by"
        real weight "default 1.0"
        text created_at
    }

    MEMORY_VECTORS {
        text memory_id PK,FK "ON DELETE CASCADE"
        blob vector
        text model "nomic-embed-text | trigram"
        text created_at
    }

    MEMORY_FTS {
        int rowid PK "content-sync triggers"
        text id "UNINDEXED"
        text title
        text body
        text summary
        text tags
        text kind
    }

    GRAPH_NODES {
        text id PK "dir_*|ent_*|ast__*|module"
        text label
        text type "directory|project|module|tech|file|symbol..."
        text metadata_json
        text created_at
        text updated_at
    }

    GRAPH_EDGES {
        text source_id PK,FK
        text target_id PK,FK
        text relation PK "depends_on|contains|calls|co_occurs"
        text confidence "EXTRACTED|INFERRED|AMBIGUOUS"
        text metadata_json
        text created_at
    }

    MESSAGES {
        int id PK "AUTOINCREMENT"
        text session_id "NOT NULL"
        text role "NOT NULL: dev|agent|system"
        text content "NOT NULL"
        text timestamp "NOT NULL"
    }

    MESSAGES_FTS {
        text role "FTS5 indexed column"
        text content "FTS5 indexed column"
        text session_id "FTS5 indexed column"
        text timestamp "FTS5 indexed column"
    }
```

## Notes

- **FTS5 content sync:** `MEMORY_FTS` is a trigger-maintained virtual table; do not write to it directly.
- **Capture layer:** `MESSAGES` stores rows from `cm save --auto`, `cm recall-auto` and `cm watch`. `MESSAGES_FTS` indexes them with insert/delete triggers and falls back to a real table when FTS5 is unavailable. Readers include `cm sq` and `cm entities --msgs`.
- **Composite keys:** `MEMORY_LINKS` and `GRAPH_EDGES` use `(source, target, relation)` as their primary key. `PK,FK` in the diagram describes the child key and relationship, not an extra SQLite constraint.
- **Self-reference:** `MEMORY_ITEMS.supersedes_id` points to another row in the same table.
- **Projections:** `graph.json` comes from `graph_nodes` + `graph_edges`; `MEMORY.md`/`USER.md` come from `memory_items`.
