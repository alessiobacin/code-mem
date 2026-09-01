# Benchmark Opinion

A2 is a correctness/durability release, not a raw-ingest optimization: write burst is 48.9% slower than A1 (5.566s vs 3.738s for 40 saves), while recall p50/p95 improve 21.7%/11.4% and accuracy remains 66.7%. The trade-off is acceptable because transactions and stale-lock recovery prevent corruption and checksum gating protects updates.

The detwin-class C proxy is orders of magnitude faster, but measures an intentionally asymmetric workload (numeric hash stream versus natural-language SQLite CLI operations) and must not be interpreted as product superiority. No targeted iteration was made after measurement: reducing write cost would require batching or changing durability semantics, outside this ticket's safe scope. Future work could expose a batch-save API to amortize process startup while retaining transactions.
