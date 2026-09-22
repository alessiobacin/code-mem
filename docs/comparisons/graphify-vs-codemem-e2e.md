# Graphify vs CodeMem: repository-level E2E

Run date: 2026-09-21  
Runner: `tests/run-memory-benchmark.sh`  
Runner result: **15/15 counted checks passed**. The generated table also records three nonfatal Graphify warnings: initial pipeline did not emit `graph.json`, `explain` emitted no output, and `wiki` was not generated. The runner treats those as capability warnings, not hard failures.

## What the run shows

Both tools are useful, but they answer different questions:

- CodeMem stores/retrieves operator memory, fuzzy recalls typos, builds a local graph, plans task context, consolidates memory and regenerates project projections.
- Graphify extracts a code/document topology, supports structural path/community/query operations and stores a compact graph artifact.

| Area | CodeMem | Graphify |
|---|---:|---:|
| Init | 0.359 s | 0.176 s pipeline check |
| 10 memory writes / update | 1.914 s | 0.349 s |
| Exact recall/query | 0.215 s | 0.250 s |
| Fuzzy typo recall | 0.222 s, pass | not tested as same memory contract |
| Path | CodeMem graph build: 0.662 s | 0.226 s |
| Community detection | CodeMem graph insights pass | 0.101 s, 4 communities |
| Multi-concept query | FTS5 pass | 0.253 s, pass |
| Consolidate/projection | 0.320 s + `MEMORY.md` pass | wiki check failed: no wiki generated |
| Stored graph size | 148 KB memory dir | 52 KB graph output |

Raw CSV: [`graphify-vs-codemem-e2e-results.csv`](./graphify-vs-codemem-e2e-results.csv). The runner’s generated narrative is preserved in `/tmp/code-mem-graphify-e2e-output-2/` for this machine-local run.

## Where CodeMem shows deeper memory semantics

The separate capability E2E demonstrates the nuance Graphify’s node/edge view does not represent as a native memory lifecycle:

1. `replace` preserves old claim as `corrected/superseded` and creates active successor.
2. Current recall returns successor; `--as-of` returns historical predecessor.
3. Every durable save creates episode/evidence links.
4. Automatic capture gates durable conversation text into a reviewable `candidate`.
5. Recall writes a task-scoped working set with expiry.
6. `contest` hides a claim and queues verification; `verify` restores accepted state with verifier/time.

This is the key CodeMem win: complex questions about “what is true now?”, “what was true then?”, “why do we believe it?”, “what still needs review?” receive lifecycle-aware answers. A flat graph can show connected nodes; it does not, by itself, provide these belief/evidence/verification transitions.

Capability output: [`../benchmarks/cognitive-capabilities-e2e-results.json`](../benchmarks/cognitive-capabilities-e2e-results.json).

## 3D view

[`../visualization/cognitive-memory-3d.html`](../visualization/cognitive-memory-3d.html) turns the same cognitive structure into an interactive 3D HTML graph. Orbit/zoom/click expose depth by scope, episode, memory, evidence and verification state; node labels and edge geometry preserve the review semantics.

## Interpretation

Graphify wins topology-oriented workflows: code paths, communities and compact graph storage. CodeMem wins memory-oriented workflows: durable facts, temporal corrections, evidence, candidate review and auditable recall. This is complementary capability, not a single scalar winner.

Confidence: 9/10 for the workflow boundary (direct E2E output + DB contract); 7/10 for general performance conclusions (small synthetic fixture, local machine, process startup included).
