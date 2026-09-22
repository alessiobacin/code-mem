# Repository documentation cleanup — 2026-09-21

## Result

Documentation is now grouped by purpose and points at the `0.7.0` implementation.

- `architecture/`: runtime, schema, retrieval and Mermaid sources.
- `benchmarks/`: benchmark methodology, runner scripts, manual scenarios and cognitive capability output.
- `comparisons/`: Graphify, Graphiti/Zep and E2E reports/results.
- `design/`: philosophy, shipped cognitive-memory contract and roadmap.
- `visualization/`: standalone 3D cognitive-memory HTML.
- `reports/`: concise English cleanup and implementation summaries.

The former root `benchmarks/` and `reports/` folders were merged into these two `docs/` folders. Obsolete Italian audit dumps were removed; no runtime memory data was moved or removed.

The redundant Italian copies `COMPARAZIONE.md` and `FILOSOFIA.md` were removed; English is the single canonical documentation language. Obsolete Italian audit reports were removed; concise English summaries remain.

## UI cleanup

The 3D view no longer shows the generic “2D → 3D navigation” banner or Graphify comparison paragraph. Nodes are spatially grouped by detected community/macro-topic, while labels fade in only within the camera’s near range; the selected node remains labelled. Clicking a node uses an eased 1100 ms focus transition and `Reset view` uses an eased 1000 ms return transition; the resulting orbit target persists until another explicit action changes it.

## Validation

- `node bin/cm version` → `0.7.0`.
- Browser smoke test: Three.js imports, WebGL canvas, 10 node labels and the new document path load successfully.
- Interaction test: node focus moves over time and remains stable; reset moves over time and remains stable.
- Old canonical paths were searched after the move; remaining matches are intentionally frozen references inside archived audit artifacts or temporary benchmark fixtures.
