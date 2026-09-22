# CodeMem vs Graphiti/Zep — Gap Analysis

**Audit date:** 21 settembre 2026  
**Purpose:** borrow useful architectural contracts from Graphiti/Zep without replacing CodeMem or introducing Graphiti as a dependency.

**Status update (`0.7.0`):** CodeMem now ships the T0 episode/evidence/candidate/working-set/verification contracts described in this document. Remaining gaps are deliberately scoped to P1/P2 work; the current implementation contract is summarized in [`../design/cognitive-memory.md`](../design/cognitive-memory.md).

## Reference boundary

Graphiti is an open-source framework for temporal context graphs; Zep is the managed context infrastructure built around that model. The relevant ideas are the data contracts, not their deployment architecture.

Primary references consulted:

- [Graphiti README — temporal context graphs, episodes, provenance and hybrid retrieval](https://github.com/getzep/graphiti)
- [Graphiti node model](https://github.com/getzep/graphiti/blob/main/graphiti_core/nodes.py)
- [Graphiti edge model](https://github.com/getzep/graphiti/blob/main/graphiti_core/edges.py)
- [Graphiti search implementation](https://github.com/getzep/graphiti/blob/main/graphiti_core/search/search.py)
- [Graphiti search configuration recipes](https://github.com/getzep/graphiti/blob/main/graphiti_core/search/search_config_recipes.py)
- [Graphiti MCP server](https://github.com/getzep/graphiti/blob/main/mcp_server/README.md)
- [Zep graph model](https://help.getzep.com/v2/understanding-the-graph)
- [Zep graph creation](https://help.getzep.com/how-graph-creation-works)
- [Zep facts and temporal invalidation](https://help.getzep.com/facts)
- [Zep searching the graph](https://help.getzep.com/searching-the-graph)
- [Zep: A Temporal Knowledge Graph Architecture for Agent Memory](https://arxiv.org/abs/2501.13956)

## Architectural translation

| Graphiti/Zep concept | CodeMem equivalent today | Gap to close |
|---|---|---|
| Episodic node/raw episode | `memory_episodes` linked to captured messages and derived claims | Episode/entity identity is still lightweight; no generic ontology |
| Entity node | `graph_nodes`, heuristic entities | No identity contract for memory entities; graph is mostly code/project structure |
| Entity edge/fact | `graph_edges`, `memory_links`, `memory_items`, `memory_evidence` | Entity identity and fact edges remain separate from the code graph |
| `valid_at` / `invalid_at` | `valid_from` / `valid_to`, current recall and `--as-of` history | Full bi-temporal policy and late-arriving evidence remain P1 |
| Ingest/system time | Episode `observed_at`/`occurred_at`, item timestamps, verification timestamps | Invalidated-at semantics are compact rather than a full event log |
| Episode provenance | Episode source/ref, role, session, scope and evidence rows | Agent/tool provenance and normalized scope policy remain incomplete |
| Contradiction resolution | Evidence relations, supersession, contest/verify queue and non-destructive validity close | Relation classification is deterministic and intentionally conservative |
| Hybrid search | FTS/LIKE + trigram/Ollama + BFS/link expansion + cognitive working set | Rank fusion and richer evidence reason codes remain P1 |
| Reranking | Weighted `scoreMemory()` and temperature rerank for auto recall | Confidence/salience excluded; no evidence/validity reason codes |
| Summaries | `summary`, `summarize()`, Markdown projections | Summary is often a 140-char truncation, not an evidence-backed derived view |
| Communities | `cm gc`, graph communities | No memory-belief community projection; not needed in hot path |
| Group/user/project scope | Project DB + global DB + cwd/branch context | No normalized scope tuple and no explicit contamination policy |
| Incremental update | `watch`, Git HEAD staleness, unembedded rows | No episode watermark, checkpointed consolidation or run ledger |
| Structured decision layer | No equivalent today | Optional semantic classifier can score and route ambiguous candidates, but is not a graph or memory store |

## ALREADY BETTER IN CODEMEM

These are reasons to preserve the current shape instead of transplanting Graphiti:

- **Local-first simplicity:** one CLI, SQLite files, one optional loopback graph service, and no required remote API key.
- **Offline fallback:** trigram vectors preserve basic semantic-ish retrieval without a remote model.
- **Coding-agent fit:** typed `decision`, `procedure`, `issue`, `artifact` kinds and project/global stores are more directly useful for CodeMem’s current domain than a generic conversation graph.
- **Distribution ergonomics:** one generated Node bundle, harness snippets, hooks and MCP are already integrated into the repository.
- **Generated projections:** bounded `MEMORY.md`/`USER.md` are a practical interface for agents that cannot call MCP.
- **Operational safety already present:** transactions, stale-lock recovery, deterministic imports, checksum verification and test coverage.
- **Codebase graph tooling:** AST/regex scan, graph export, entity extraction and community/path commands address the project-memory use case directly.

## ALREADY PRESENT

CodeMem already has useful parts of the reference architecture:

- Separate raw conversation capture (`messages`), canonical episodes and durable memory rows.
- Evidence links, deterministic intake gate, candidate states, task working sets and verification queue.
- `created_at`, `updated_at`, `last_accessed_at`, `valid_from`, `valid_to`, `supersedes_id` columns.
- Lifecycle states including `contested`, `corrected`, `obsolete` and soft archive.
- Source/context fields, project/global stores and branch/cwd/task metadata.
- Lexical, vector, graph/link and recency signals in retrieval.
- Entity extraction and graph nodes/edges with confidence labels.
- Background `watch` and `consolidate` entry points.

The remaining caveat is that entity ontology, deep bi-temporal policy, richer rank fusion and resumable sleep-cycle semantics are still partial. The shipped T0 lifecycle is covered by focused tests and E2E evidence.

## PARTIALLY PRESENT

### Temporal knowledge

T0 now records episode observed/occurred time and supports current versus `--as-of` claim selection. Full world-time/system-time separation for every write path and late-arriving evidence is still P1.

### Provenance

`memory_episodes` and `memory_evidence` now answer the core chain “which episode supported or contradicted this claim, and when was it observed?” Agent/tool provenance and normalized scope policy remain incomplete.

### Changing facts

T0 preserves historical rows by closing the predecessor validity window and recording supersession/evidence state. A richer append-only change event and automated relation classification remain future work.

### Hybrid retrieval

CodeMem now has the core candidate families plus lifecycle/status filtering and working-set population. FTS/model identity/rank-fusion hardening remains a separate retrieval-quality track.

### Consolidation

`cm consolidate` promotes candidates, links evidence, refreshes projections and records a consolidation run. A fully resumable sleep cycle with claim aggregation, reflections and richer checkpointing remains P1/P2.

### Scope

The project/global split is useful but implicit. A global fallback can enter recall when the project has fewer than `limit` results. There is no normalized `global/user/org/project/agent/session` scope policy on each memory.

## USEFUL TO ADOPT

### 1. Append-only episodes as the evidence stream

Keep raw messages, tool outputs, documents and events as episodes. Do not make a summary the only surviving representation. Link derived claims back to one or more episodes.

### 2. Temporal claim validity

Adopt the distinction between:

```text
occurred_at / valid_from / valid_to  = time in the described world
created_at / invalidated_at           = time the system learned or changed its belief
```

This supports “what is true now?”, “what was true on date X?” and “when did CodeMem learn the change?”.

### 3. Many-to-many provenance

One episode can support multiple claims; one claim can be supported, contradicted or superseded by multiple episodes. This is more useful than a single `source` string and enables confidence updates without erasing history.

### 4. Conservative contradiction handling

Treat a new statement as `SUPPORTS`, `EXTENDS`, `DUPLICATES`, `CONTRADICTS`, `SUPERSEDES` or `UNRELATED`. If the new evidence is strong enough, invalidate the current interval of the old claim; retain the old claim for history.

### 5. Configurable hybrid retrieval

Use lexical, vector, graph and temporal candidates, then deterministic rank fusion/reranking. Graphiti’s public recipes show BM25 + cosine + BFS with RRF/MMR/node-distance/episode-mention alternatives. CodeMem should start with a small deterministic weighted union/RRF, not a new backend.

### 6. Derived summaries and reflections as projections

Entity summaries, thread/saga summaries, communities and higher-level observations are useful retrieval aids only when they remain rebuildable from episodes/claims and preserve evidence links.

### 7. Incremental/resumable maintenance

Use a source watermark and a `consolidation_runs` ledger. Process only new or changed episodes/candidates; keep a bounded batch and commit the cursor only after idempotent writes succeed.

### 8. Provenance-aware context

Return a compact claim plus source/episode IDs, time, status and retrieval reason. This is a better fit for CodeMem’s `cm explain` and MCP than returning an unbounded graph neighborhood.

## NOT USEFUL

- Graphiti’s exact class names, prompts, Cypher and backend-specific APIs.
- A full generic ontology system before CodeMem has a reliable evidence model.
- Community detection as a prerequisite for ordinary project recall.
- A managed context service, hosted user graph or cross-tenant governance layer.
- Product-specific latency/accuracy claims as CodeMem requirements.

## WOULD ADD UNNECESSARY COMPLEXITY

- Replacing SQLite with Neo4j, FalkorDB or Kuzu in the first implementation.
- Adding an external vector database or ANN service before local retrieval quality is measured.
- Running an LLM entity/edge extraction and contradiction pass synchronously on every `cm save`.
- Introducing cross-encoder reranking in the hot path without a labeled benchmark.
- Building Zep-style cache warming, user groups, hosted APIs or multi-region storage.
- Treating Obsidian as a write-through database instead of a human inspection/export surface.
- Making an optional classifier a synchronous dependency of every capture or recall, or using it as a replacement for deterministic filtering and temporal truth policy.

## Recommended borrowing order

1. Episode + provenance contracts.
2. Temporal claim versioning and non-destructive invalidation.
3. Status/scope-aware hybrid retrieval with explicit reason codes.
4. Incremental sleep-cycle watermark and run ledger.
5. Reflections/communities only as derived, evidence-linked projections.
6. Optional classifier adapter only after T0 retrieval and gate benchmarks establish where ambiguity justifies its latency/cost.
