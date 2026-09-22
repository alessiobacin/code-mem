# Cognitive memory roadmap

Status: CodeMem `0.8.1` ships the T0 cognitive-memory contracts described in
[cognitive-memory.md](cognitive-memory.md). Remaining items are forward
roadmap work and must not be presented as shipped until code and tests confirm
them.

## Shipped T0

- typed memories with compact English-first storage;
- episodes and evidence with source and observation timestamps;
- deterministic intake gate and reviewable candidates;
- temporal validity and supersession;
- working-set selection and resumable processing state;
- contest, verification queue and audit timestamps;
- hybrid retrieval with graph/link expansion and local trigram fallback;
- Graphify/Graphiti comparison runners;
- Obsidian and generic Markdown wiki import;
- standalone labelled 3D graph view with smooth focus and reset transitions.

## P1: stronger memory quality

### P1-A — Evidence-aware consolidation

Merge repeated observations only when source, time and claim type are
compatible. Preserve every supporting episode and never silently convert a
reflection into a user fact.

### P1-B — Better temporal reasoning

Add explicit interval queries and contradiction reports for overlapping claims.
Keep `valid_from`, `valid_to`, `supersedes_id` and provenance queryable without
an embedding service.

### P1-C — Import synchronization

Extend wiki import with optional file manifests and deletion detection. The
default must remain safe and idempotent; destructive replacement requires an
explicit flag.

### P1-D — Retrieval evaluation

Track recall quality, stale-memory rate, duplicate rate, consolidation rate,
latency and storage growth in a deterministic benchmark corpus.

## P2: optional acceleration

An optional semantic classifier layer can handle batched decisions for ambiguous
intake, relation classification, importance and selective reranking. It must sit
behind the deterministic T0 gate, remain replaceable and never be required for
local operation.

Evaluate any classifier against T0 using precision, recall, false reinforcement
rate, p50/p95 latency, token cost and offline failure behavior.

## Design constraints

1. Local SQLite remains the source of truth.
2. Core memory operations remain offline and dependency-light.
3. Every accepted claim retains provenance and a reversible lifecycle.
4. Generated projections are disposable; source data is not hand-edited.
5. New intelligence must improve measured decisions, not merely add metadata.

## Next recommended sequence

1. Add import synchronization and deletion-safe manifests.
2. Expand temporal contradiction tests.
3. Publish the reproducible memory-quality benchmark.
4. Prototype an optional classifier adapter only if benchmark ambiguity justifies
   its latency and token cost.
