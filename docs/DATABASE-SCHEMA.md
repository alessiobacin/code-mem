# Schema database di code-mem (state.db)

> Schema ER del file `memory/state.db` (SQLite). Fonte: [`docs/DATABASE-SCHEMA.mmd`](DATABASE-SCHEMA.mmd).
> Verificato sul DB reale con SQLite (tabelle + chiavi).

`state.db` è la **source of truth**. `graph.json`, `MEMORY.md`/`USER.md` sono proiezioni rigenerabili.

## Diagramma ER

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
        text corrected_by "agente che ha marcato contested/corrected/obsolete (migrazione additiva)"
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

## Note

- **FTS5 content-sync:** `MEMORY_FTS` è una virtual table legata a `MEMORY_ITEMS` con trigger; non va scritta a mano.
- **Capture layer:** `MESSAGES` è la tabella dei log conversazionali scritti da `cm save --auto [--role dev|agent]`, `cm recall-auto` e `cm watch` (vedi `src/capture.js`). `od()` chiama `ensureMessagesSearchTables` che crea la virtual table FTS5 `MESSAGES_FTS` (content=`MESSAGES`, content_rowid=`id`) più trigger `messages_ai`/`messages_ad` (INSERT/DELETE sync); in caso di FTS5 non disponibile ha un fallback a tabella reale. Lettori: `cm sq`, `cm entities --msgs`.
- **Chiavi composite:** `MEMORY_LINKS` e `GRAPH_EDGES` hanno PK su `(source, target, relation)` — il fatto che un'identificazione sia `PK,FK` riflette la PK della tabella figlia, non un vincolo FK di SQLite.
- **Self-reference:** `MEMORY_ITEMS.supersedes_id` punta a un'altra riga della stessa tabella.
- **Projection:** `graph.json` è generato da `graph_nodes`+`graph_edges`; `MEMORY.md`/`USER.md` da `memory_items` (vedi `refreshProjections`, `syncGraphProjection`).
