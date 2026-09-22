# CodeMem cognitive memory — shipped contract

Status: implemented and tested in `0.8.1`.

CodeMem keeps the local SQLite/CLI/MCP model and adds a compact cognitive lifecycle around durable memories:

1. Raw input becomes an episode with source, scope and observed time.
2. A deterministic intake gate classifies automatic input as ignorable, temporary or a durable candidate.
3. Evidence links episodes to claims with support, contradiction or supersession relations.
4. Memory rows carry belief and processing state, so candidates are not recalled as accepted truth.
5. Temporal claims support current recall and explicit historical recall with `--as-of`.
6. Task working sets are bounded and expiring; they do not replace durable memory.
7. `cm contest` sends a claim to the verification queue; `cm verify` records the verifier and result.
8. `cm consolidate --accept-candidates` promotes reviewed candidates and refreshes projections.

## Storage contract

`memory/state.db` remains canonical. The cognitive tables are:

- `memory_episodes` — append-oriented observations and gate decisions;
- `memory_evidence` — episode-to-memory relations;
- `memory_working_set` — task/session-scoped retrieval package;
- `verification_queue` — pending and completed claim checks;
- `memory_items` — backward-compatible durable claims plus belief/processing state.

`MEMORY.md`, `USER.md` and `graph.json` remain rebuildable projections. Deterministic local policy stays complete; optional semantic adapters may classify only ambiguous/high-value cases without becoming required for capture or recall.

Global scope is separate from project scope. A global `preference` is injected
into default project recall as user context, while project facts and graph
entities remain authoritative for the current repository. Another project's
memory is available only through an explicit managed-project selector.

## Public proof

Run the focused contract test:

```bash
node --test tests/cognitive-memory.test.mjs
```

Run the deterministic capability demonstration:

```bash
node docs/benchmarks/cognitive-capabilities-e2e.mjs
```

The latest comparative evidence lives in [`../comparisons/`](../comparisons/).
