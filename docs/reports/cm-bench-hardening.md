# Benchmark hardening report

Status: historical summary, translated to English on 2026-09-21.

The benchmark-hardening work is present in the main worktree. It covered the
A1 reranking path, A2 transactional writes, benchmark documentation and the
generated bundle. The original orchestration run was marked failed because of
budget/recovery handling, not because the implemented work failed.

Current verification is the repository test suite:

- non-regression CLI tests, including wiki import;
- cognitive-memory E2E tests;
- TDDB merge tests;
- generated `bin/cm` rebuilt from `src/`.

This report is retained as a short provenance note. Current instructions and
results live under [`../benchmarks/`](../benchmarks/) and
[`../comparisons/`](../comparisons/).
