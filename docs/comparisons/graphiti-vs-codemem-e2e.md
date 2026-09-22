# Graphiti vs CodeMem: reproducible E2E comparison

Run date: 2026-09-21  
Corpus: 11 memory episodes  
Queries: 9  
Repeats: 3 per query  
Scoring: explicit expected terms; no LLM judge

## Executive result

The generic retrieval contest is not a CodeMem victory: Graphiti achieved higher exact-term recall on this small corpus. CodeMem’s advantage appears on a different axis: cognitive memory lifecycle. CodeMem can expose current vs historical truth, preserve superseded claims, attach evidence, gate conversation input into candidates, create a working set, and run contest → verification → acceptance. These are first-class local contracts in CodeMem; they are not exposed as equivalent public operations by the Graphiti/Graphify surfaces tested here.

This is the honest conclusion: Graphiti is strong at graph extraction/retrieval, while CodeMem is stronger for fast, auditable project-memory state transitions. They should not be presented as interchangeable systems.

## Measured results

| System | Hit@1 | Hit@3 | Hit@8 | MRR | Query p50 | Query p95 | Ingest total | Ingest p95 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| CodeMem | 0.3333 | 0.4444 | 0.5556 | 0.3889 | 219.515 ms | 260.102 ms | 1.638 s | 158.032 ms |
| Graphiti | 0.5556 | 0.5556 | 0.5556 | 0.5556 | 3.676 ms | 7.099 ms | 311.634 s | 77.336 s |

Configuration:

- CodeMem: current `bin/cm`, isolated temp project, local SQLite, hybrid recall.
- Graphiti: `graphiti-core==0.30.2`, isolated Python environment, temporary FalkorDB Docker container, Ollama `llama3.1:8b` for extraction, deterministic local hash embeddings and lexical reranking.
- Graphiti query latency excludes its LLM ingestion cost. CodeMem CLI latency includes Node process startup. These latency numbers are directional, not a clean in-process apples-to-apples benchmark.

Raw measurements: [`graphiti-vs-codemem-e2e-results.json`](./graphiti-vs-codemem-e2e-results.json). Re-run with `node docs/benchmarks/compare-graphiti-codemem.mjs`.

## Complex-memory demonstration

The capability E2E uses the same type of memory lifecycle CodeMem needs in production:

1. Save: `Production API provider is OpenAI; region eu-west-1.`
2. Replace: provider changes to Anthropic on 2025-02-03.
3. Current recall returns Anthropic.
4. `--as-of 2025-01-31T23:59:59Z` returns OpenAI.
5. The predecessor remains auditable as `corrected/superseded`; successor remains active.
6. Auto-capture creates a `candidate` instead of silently promoting conversation text.
7. Recall creates a task-scoped working-set entry.
8. Contesting a claim queues verification; verifying it restores `accepted` state and records verifier/time.

Observed capability DB snapshot: 5 episodes, 5 evidence rows, 5 working-set rows, 1 candidate. Final audit showed predecessor `belief_status=superseded`, successor `status=active`, `belief_status=accepted`, and `last_verified_at` populated.

Capability result: [`../benchmarks/cognitive-capabilities-e2e-results.json`](../benchmarks/cognitive-capabilities-e2e-results.json). Re-run with `node docs/benchmarks/cognitive-capabilities-e2e.mjs`.

Graphiti natively models temporal entity edges/facts and hybrid graph/search retrieval. Its public `add_episode`/`search_` flow does not provide CodeMem’s candidate gate, `memory_evidence` ledger, `verification_queue`, working-set TTL, contest/verify commands, or current/historical recall contract as the same first-class local API. This is a capability-boundary comparison, not a claim that Graphiti cannot be extended.

Graphify in this repository is a separate file/graph traversal competitor: `graph.json` with typed nodes/edges, BFS/path/explain and exports. It is useful for code topology; it does not model the CodeMem belief/evidence lifecycle either. See [`competitor-schemas.md`](./competitor-schemas.md) and [`../benchmarks/memory-benchmark.md`](../benchmarks/memory-benchmark.md).

## 3D navigation

[`../visualization/cognitive-memory-3d.html`](../visualization/cognitive-memory-3d.html) is a standalone Three.js explorer. Orbit, zoom, search and click nodes. Depth separates scope, episode, memory, evidence and verification; visible labels and edge geometry preserve the familiar node/edge model while making cognitive state navigable in depth.

## Memory density and cleanup

Memory writes now apply a deterministic English-first compacting pass:

- remove filler (`in order to` → `to`, transport chatter, redundant lead-ins);
- collapse whitespace and preserve technical tokens/dates/assertions;
- ignore `[llmp] provider...`, `[llmproxy]...` and residual-credit metadata at intake;
- compact titles/summaries as well as bodies.

The existing project DB was cleaned: 120 provider/LLM noise memories and 1,458 captured messages containing the same transport metadata were removed. Two benchmark-only seed rows were removed. Remaining project memories were preserved; one recurring Italian project note was normalized to compact English.

## Recommendations

| Recommendation | Confidence |
|---|---:|
| Keep CodeMem as the fast local project-memory authority; use Graphiti/Graphify as optional topology/relationship analysis. | 9/10 |
| Keep optional semantic classification outside the core path; add it only behind the existing evidence contracts when benchmarks justify it. | 9/10 |
| Repeat benchmark with a larger, versioned gold set before making retrieval-quality claims. | 10/10 |
| Compare in-process APIs separately from CLI/process-start latency. | 10/10 |

Sources: [Graphiti official repository](https://github.com/getzep/graphiti), [Graphiti package metadata](https://raw.githubusercontent.com/getzep/graphiti/main/pyproject.toml).
