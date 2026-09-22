# Competitor data schemas: Graphify and claude-mem

> Schemas derived from **real local sources**: the installed Graphify output
> (`graphify-out/graph.json`) and claude-mem v9.1.1 table definitions read from
> `scripts/context-generator.cjs`.

## 1. graphify — `graphify-out/graph.json`

The actual JSON shape is importable by networkx: `{ directed, multigraph, nodes[], links[], hyperedges[] }`.
`links` stores edges; the key is not named `edges`.

```mermaid
erDiagram
    NODE ||--o{ LINK : "source"
    NODE ||--o{ LINK : "target"
    NODE ||--o{ HYPEREDGE : "member of"

    NODE {
        text id PK "e.g. <filestem>_<entity>"
        text label "human readable"
        text norm_label "normalized for matching"
        text file_type "code|document|paper|image"
        text source_file
        text source_location "nullable"
        text source_url "nullable"
        text community "assigned by Louvain"
        text author "nullable"
        text contributor "nullable"
    }

    LINK {
        text source PK,FK
        text target PK,FK
        text relation PK "calls|implements|references|cites|contains|semantically_similar_to|rationale_for..."
        text confidence "EXTRACTED|INFERRED|AMBIGUOUS"
        real confidence_score "1.0 / 0.6-0.9 / 0.1-0.3"
        real weight "default 1.0"
        text source_file
        text source_location
    }

    HYPEREDGE {
        text id PK "snake_case_id"
        text label "human readable"
        text relation "participate_in|implement|form"
        text confidence "EXTRACTED|INFERRED"
        real confidence_score
        text nodes "3+ node ids"
        text source_file
    }
```

> There is no relational database; `graph.json` is the persistent store. Graphify
> also keeps working files under `graphify-out/` (`.graphify_extract.json`,
> `.graphify_analysis.json`, `.graphify_labels.json`).

## 2. claude-mem — database SQLite (migration004)

Actual tables read from the code (`context-generator.cjs`): `schema_versions`, `sdk_sessions`, `observations`, `session_summaries`.

```mermaid
erDiagram
    SDK_SESSIONS ||--o{ OBSERVATIONS : "contains"
    SDK_SESSIONS ||--o| SESSION_SUMMARIES : "summarized by"

    SCHEMA_VERSIONS {
        int id PK
        int version UK
        text applied_at
    }

    SDK_SESSIONS {
        int id PK
        text content_session_id UK
        text memory_session_id UK
        text project
        text user_prompt
        text started_at
        int started_at_epoch
        text completed_at "nullable"
        int completed_at_epoch "nullable"
        text status "active|completed|failed"
    }

    OBSERVATIONS {
        int id PK
        text memory_session_id FK "on delete cascade"
        text project
        text text "content of the observation"
        text type "bugfix|feature|decision|discovery|change"
        text created_at
        int created_at_epoch
    }

    SESSION_SUMMARIES {
        int id PK
        text memory_session_id UK,FK "on delete cascade"
        text project
        text request
        text investigated
        text learned
        text completed
        text next_steps
        text files_read
        text files_edited
        text notes
        text created_at
        int created_at_epoch
    }
```

> `observations.type` reflects the MCP search workflow types
> (`bugfix|feature|decision|discovery|change`). The observation `text` and
> `type` are the durable content, linked to their originating session.
