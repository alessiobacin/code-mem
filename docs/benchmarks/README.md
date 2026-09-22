# Graphiti vs CodeMem E2E

The comparison uses one corpus, one query set and three repeated recalls per query. Quality is scored from explicit expected answer terms (`hit@1`, `hit@3`, `hit@8`, MRR); latency is measured in-process and reported as p50/p95. It does not use an LLM judge.

CodeMem runs from the current `bin/cm` in an isolated temporary project. Graphiti runs in a temporary Python virtualenv and an ephemeral FalkorDB Docker container. Graphiti receives the local Ollama model for extraction, but uses deterministic local hash embeddings and lexical reranking so the comparison does not add a second remote embedding/reranking service.

Prerequisites:

- Node.js, Docker and Ollama running at `127.0.0.1:11434`.
- `llama3.1:8b` available in Ollama, or set `GRAPHITI_MODEL`.
- `uv` for the isolated Graphiti environment.

Setup and run:

```bash
uv venv --python 3.14 /tmp/code-mem-graphiti-venv
uv pip install --python /tmp/code-mem-graphiti-venv/bin/python \
  'graphiti-core[falkordblite]==0.30.2' 'httpx>=0.27,<1'
npm run build
node docs/benchmarks/compare-graphiti-codemem.mjs
```

The raw result is written to `docs/comparisons/graphiti-vs-codemem-e2e-results.json`; the human report is `docs/comparisons/graphiti-vs-codemem-e2e.md`. The temporary paths printed by the runner are retained for post-run inspection and are not part of the repository.

Run the CodeMem cognitive-lifecycle demonstration separately:

```bash
node docs/benchmarks/cognitive-capabilities-e2e.mjs
```

It proves supersession + `--as-of`, evidence, candidate gating, working-set population and contest/verify auditability. It writes `docs/benchmarks/cognitive-capabilities-e2e-results.json`.

Manual CLI checks are grouped under [`manual-scenarios/`](manual-scenarios/).
