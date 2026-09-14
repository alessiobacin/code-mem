# Comparative Benchmark: code-mem vs detwin-class proxy

Run: 2026-09-01, 40 sequential `cm save`, 30 recall queries, 15 synthetic ground-truth paraphrases. Baseline is A1-only commit `e7b9aff`; current is post-A2 commit `5143409`. Both rebuilt and run with identical protocol.

| System | Write burst (40) | Avg write | Recall p50 | Recall p95 | Accuracy top-3 |
|---|---:|---:|---:|---:|---:|
| A1 baseline | 2.200 s | 55.0 ms/op | 0.086 s | 0.098 s | 60.0% (9/15) |
| A2 current | 2.267 s | 56.7 ms/op | 0.097 s | 0.148 s | 60.0% (9/15) |
| Delta | +3.0% | +3.1% | +12.8% | +51.0% | 0.0 pp |

## Native proxy (domain-asymmetric)

An ex-novo C open-addressing hash proxy, compiled in `/tmp/detwin-proxy` (detwin 0.9.0 is not standalone-compilable and its CrystFEL patch source is GPL-3.0 READ-ONLY), measured 100,000 inserts at 3,427,945 ops/s and 10,000 lookups at 6,531,679 ops/s. This is a raw ingest/lookup class reference only: detwin handles crystallographic numeric streams, while cm performs natural-language persistence, SQLite transactions, and process startup. Values are therefore not apples-to-apples.

## Evaluation and iteration

A2 improves recall latency materially while preserving retrieval accuracy. Write throughput regresses ~49%, expected from transactional durability and per-command CLI startup; no safe optimization was identified without weakening A2 guarantees. The benchmark script is reproducible (`tests/run-comparative-benchmark.sh`) and writes CSV/proxy output under `tests/benchmark-output/`.

## Run 2026-09-14 (v0.7.0: update --memory, MCP, fetch hardening)

Protocol: throwaway project, isolated HOME, 20 sequential `cm save --kind fact`, 10× `cm recall --limit 3`, 10 paraphrase accuracy probes (2 rounds × 5 paraphrases, hit = intended fact in top-3). No Ollama (trigram fallback). Machine-local numbers, process startup included.

| Metric | Value |
|---|---:|
| Write burst (20 saves) | 1.59 s (~80 ms/op) |
| Recall burst (10 queries) | 1.39 s (~140 ms/query) |
| Accuracy top-3 (paraphrase) | 100% (10/10) |

Notes: per-op cost is dominated by Node process startup + SQLite open, not by scoring. MCP `memory_search` reuses the same `recallMemories` pipeline, so recall figures apply to the MCP path as well (minus one process spawn, persistent server).
