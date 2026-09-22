# Memory benchmark guide

This guide defines a reproducible comparison between CodeMem, Graphify and
other memory systems. Scripts and machine-readable results are the measurement
source of truth.

## Systems and boundaries

| System | Primary model | Durable state | Strength |
|---|---|---|---|
| CodeMem | typed memories + local SQLite | `memory/state.db` | evidence, belief, time, review and retrieval |
| Graphify | extracted knowledge graph | `graphify-out/graph.json` | code topology, communities and graph traversal |
| claude-mem | MCP observations and sessions | plugin database/service | cross-session observation search |

Do not treat a graph node count as a memory-quality score. Use identical
corpora, query sets and expected answer terms, then report quality and latency
separately.

## Executable runners

From the repository root:

```bash
npm run build
node docs/benchmarks/cognitive-capabilities-e2e.mjs
node docs/benchmarks/compare-graphiti-codemem.mjs
```

The first runner proves CodeMem lifecycle capabilities: supersession,
historical `--as-of` recall, evidence, candidate gating, working-set state and
contest/verify auditability. The second uses one corpus, one query set and
repeated recalls; it reports hit@1, hit@3, hit@8, MRR, p50 and p95.

## Manual quality dimensions

Evaluate each system on the same scenarios:

1. vague-term recall: retrieve a decision without repeating exact words;
2. typed context: distinguish facts, decisions, procedures and issues;
3. temporal truth: answer current and historical questions separately;
4. provenance: expose source, evidence and confidence;
5. review lifecycle: represent contested, corrected and verified claims;
6. graph navigation: show neighbors, paths and communities;
7. import/export: preserve notes, links and repeatable results.

Graphify is a strong topology explorer. CodeMem is stronger when a question
depends on temporal validity, belief state, provenance, selective retention or
verification. The systems can be used together.

## Results

- [Graphify vs CodeMem E2E report](../comparisons/graphify-vs-codemem-e2e.md)
- [Graphiti vs CodeMem E2E report](../comparisons/graphiti-vs-codemem-e2e.md)
- [Cognitive capability result](cognitive-capabilities-e2e-results.json)
- [Graphify raw results](../comparisons/graphify-vs-codemem-e2e-results.csv)
