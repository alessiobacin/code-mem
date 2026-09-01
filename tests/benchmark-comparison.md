# Comparative Benchmark: code-mem vs detwin-class proxy

Run: 2026-09-01, 40 sequential `cm save`, 30 recall queries, 15 synthetic ground-truth paraphrases. Baseline is A1-only commit `e7b9aff`; current is post-A2 commit `5143409`. Both rebuilt and run with identical protocol.

| System | Write burst (40) | Avg write | Recall p50 | Recall p95 | Accuracy top-3 |
|---|---:|---:|---:|---:|---:|
| A1 baseline | 3.738 s | 93.5 ms/op | 0.240 s | 0.367 s | 66.7% (10/15) |
| A2 current | 5.566 s | 139.2 ms/op | 0.188 s | 0.325 s | 66.7% (10/15) |
| Delta | +48.9% | +48.9% | -21.7% | -11.4% | 0.0 pp |

## Native proxy (domain-asymmetric)

An ex-novo C open-addressing hash proxy, compiled in `/tmp/detwin-proxy` (detwin 0.9.0 is not standalone-compilable and its CrystFEL patch source is GPL-3.0 READ-ONLY), measured 100,000 inserts at 3,427,945 ops/s and 10,000 lookups at 6,531,679 ops/s. This is a raw ingest/lookup class reference only: detwin handles crystallographic numeric streams, while cm performs natural-language persistence, SQLite transactions, and process startup. Values are therefore not apples-to-apples.

## Evaluation and iteration

A2 improves recall latency materially while preserving retrieval accuracy. Write throughput regresses ~49%, expected from transactional durability and per-command CLI startup; no safe optimization was identified without weakening A2 guarantees. The benchmark script is reproducible (`tests/run-comparative-benchmark.sh`) and writes CSV/proxy output under `tests/benchmark-output/`.
