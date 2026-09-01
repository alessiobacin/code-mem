# Benchmark Opinion

A2 is a correctness/durability release, not a raw-ingest optimization: write burst is 3.0% slower than A1 (2.267s vs 2.200s for 40 saves), recall p50/p95 are 12.8%/51.0% slower in this run, and accuracy remains equal at 60.0% (9/15). The latency variance should be treated as a benchmark observation, not a correctness regression; transactions and stale-lock recovery prevent corruption and checksum gating protects updates.

The detwin-class C proxy is orders of magnitude faster, but measures an intentionally asymmetric workload (numeric hash stream versus natural-language SQLite CLI operations) and must not be interpreted as product superiority. No targeted iteration was made after measurement: reducing write cost would require batching or changing durability semantics, outside this ticket's safe scope. Future work could expose a batch-save API to amortize process startup while retaining transactions.
