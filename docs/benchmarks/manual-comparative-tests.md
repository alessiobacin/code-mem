# Manual comparative scenarios

This document gives short, repeatable checks for CodeMem versus flat Markdown
memory and Graphify. Executable benchmark runners are the authoritative
measurement path; these scenarios are for human inspection of workflow nuance.

## 1. Typed decision recall

```bash
cm init --deep
cm save --kind decision --title "Vitest versus Jest" \\
  "Use Vitest because parallel tests run three times faster than Jest."
cm recall "why did we choose the test runner" --mode hybrid --level 3
```

Compare with a plain Markdown file and `rg`. CodeMem should retrieve the
decision from related wording and show its type, score and explanation.

## 2. Debugging workaround

```bash
cm save --kind issue --title "Fake timers and parallel tests" \\
  "Use vi.useFakeTimers() inside beforeEach; file-level fake timers compete across parallel tests."
cm recall "parallel timer failure workaround" --mode hybrid --level 3
```

The expected result contains both symptom and fix. A flat file only matches if
the operator remembers a useful exact term.

## 3. Temporal correction

```bash
cm save --kind decision "Production API provider is OpenAI; region eu-west-1."
cm replace "Production API provider is OpenAI" \\
  "Production API provider changed to Anthropic on 2025-02-03; region eu-west-1."
cm recall "current production API provider" --mode keyword --level 3
cm recall "production API provider in January 2025" \\
  --mode keyword --as-of 2025-01-31T23:59:59Z --level 3
```

CodeMem keeps predecessor, successor, validity interval and supersession link.
A graph-only export can show a relation, but not this native temporal belief
lifecycle.

## 4. Candidate review and verification

```bash
cm save --auto --role dev \\
  "Decision: validate schema before deploy; record failure evidence."
cm recall "schema deploy failure evidence" --mode keyword --level 3
cm contest <memory-id> "requires recheck"
cm verify <memory-id> --by benchmark-qa
```

The cognitive flow keeps an episode, candidate state, evidence relation,
verification queue entry and audit timestamps. Graphify does not provide these
memory-native operations.

## 5. Markdown knowledge import

```bash
cm import /path/to/knowledge-source
```

The importer infers the source structure from Markdown content, reads
frontmatter/tags/aliases/links and uses the configured harness LLM in the
unified deep workflow when available. The full repository workflow is:

```bash
cm init --deep
```

It writes a navigable `memory/graph-3d.html` and does not require separate
scan/entity/community commands.
It asks whether imported Markdown files should be deleted after success; the
safe default preserves the source. Re-running is idempotent; `--replace`
replaces the matching imported projection and `--dry-run` only reports counts.

## 6. Executable comparison baseline

From the repository root:

```bash
npm run build
node docs/benchmarks/compare-graphiti-codemem.mjs
node docs/benchmarks/cognitive-capabilities-e2e.mjs
```

See [Graphify vs CodeMem](../comparisons/graphify-vs-codemem-e2e.md),
[Graphiti vs CodeMem](../comparisons/graphiti-vs-codemem-e2e.md) and the JSON/CSV
results beside them for measured output.
