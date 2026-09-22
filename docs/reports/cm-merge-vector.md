# Merge and vector hardening report

Status: historical summary, translated to English on 2026-09-21.

The merge work combined deterministic trigram vectors with transactional memory
writes. The final code is in the main worktree and the generated bundle was
rebuilt from the modular `src/` fragments. Watchdog messages recorded during
the original orchestration were stale-window false positives; they did not
represent a missing code change.

Current source of truth:

- `src/embed.js` and retrieval code for local vector fallback;
- `src/storage.js` and `src/cognitive.js` for transactional memory state;
- `build/bundle.mjs` for the distributable bundle;
- `docs/benchmarks/` for repeatable verification.

No active task or worktree is associated with this historical report.
