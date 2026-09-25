# graphify vs code-mem — benchmark on real repositories (2026-09-25)

**Versions:** code-mem 0.11.1 · graphify (graphifyy) 0.4.23
**Repositories:** code-mem (JavaScript, 44 source files, 92 Markdown + 55 media) and yano-flash (TypeScript, 53 source files, 42 Markdown + 59 media), both copied to isolated folders with an isolated HOME.
**Indexing:** both tools without an LLM, so the comparison is fair. graphify ran `graphify update .`. code-mem ran `cm init --deep --no-llm`.
**Runner:** [`docs/benchmarks/graphify-vs-cm-retrieval.mjs`](../benchmarks/graphify-vs-cm-retrieval.mjs). Raw results: `docs/benchmarks/graphify-vs-cm-2026-09-25-*.json`.

## Method

| Set | Question | Expected answer | Who wrote it |
|---|---|---|---|
| A code-comment | a function's leading comment | the file that defines the function | automatic (25 per repo) |
| C doc-sentence | the first prose sentence of a Markdown file | that file | automatic (25 per repo) |
| B hand-written | a realistic developer question | the file that implements it | written by hand **before** the run, code-mem only (15) |

- **Budget:** both `graphify query` and `cm query` get the same budget of 2,000 tokens. `cm recall --limit 8` is also measured, because it is the path the hooks use to put memory into an agent's context.
- **Metrics:** hit@1/3/5 are computed over the *distinct* files cited, in the order of the answer. MRR is the mean reciprocal rank. **chance@5** is the same measure on a meaningless question, and shows how much comes from simply citing the most-connected files. "files" is how many files an answer cites (precision).

## Results

### Code questions (set A)

| Repo | System | hit@1 | hit@3 | hit@5 | MRR | files cited | tokens | latency |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| code-mem (JS) | graphify | 4% | 8% | 12% | 0.12 | 13 | 1510 | 147 ms |
| code-mem (JS) | **cm query** | **20%** | **32%** | **36%** | **0.28** | 29 | 2016 | 123 ms |
| code-mem (JS) | cm recall | 0% | 4% | 4% | 0.01 | 10 | 737 | 298 ms |
| yano-flash (TS) | **graphify** | 8% | **32%** | **48%** | **0.26** | 16 | 1510 | 144 ms |
| yano-flash (TS) | cm query | **12%** | 28% | 40% | 0.25 | 9 | 2016 | 109 ms |
| yano-flash (TS) | cm recall | 0% | 0% | 0% | 0.00 | 8 | 779 | 274 ms |

### Hand-written questions (set B, code-mem)

| System | hit@5 | answer cites the file anywhere | files cited |
|---|---:|---:|---:|
| graphify | 13% | 73% | 13 |
| cm query | 0% | 87% | 28 |
| cm recall | 0% | 0% | 9 |

### Documentation questions (set C)

| Repo | System | hit@1 | hit@3 | hit@5 | MRR |
|---|---|---:|---:|---:|---:|
| code-mem | graphify | 0% | 0% | 0% | 0.00 |
| code-mem | cm query | 0% | 0% | 12% | 0.05 |
| code-mem | **cm recall** | 0% | **20%** | **36%** | **0.17** |
| yano-flash | graphify | 0% | 0% | 0% | 0.00 |
| yano-flash | cm query | 4% | 12% | 16% | 0.09 |
| yano-flash | **cm recall** | **16%** | **44%** | **60%** | **0.31** |

chance@5 is 0–8% everywhere: the hits are not due to citing the most-connected files.

### Build, update, freshness

| | graphify | code-mem |
|---|---:|---:|
| Initial build, code-mem | 1.2 s (code only) | 53 s (code + 147 documents/media, with conversion) |
| Initial build, yano-flash | 0.7 s | 50 s (code + 101 documents/media) |
| Update after a code change | 0.7 s | 9.2 s full (`--deep`), 0.2 s light |
| New function found right after the update | yes | yes |
| Storage | 1.8–3.2 MB | 6.3–6.5 MB (includes documents, FTS and vectors) |

### Memory capabilities (end-to-end: `docs/benchmarks/cognitive-capabilities-e2e.mjs`)

| Capability | code-mem | graphify |
|---|:--:|:--:|
| Correcting a fact while keeping its history (supersession) | ✅ | ❌ |
| "What was true on date X" (`--as-of`) | ✅ | ❌ |
| Automatic capture of decisions from conversations, with review | ✅ | ❌ |
| Evidence and episodes behind every memory | ✅ | ❌ |
| Contest → verify (auditable) | ✅ | ❌ |
| Q&A saved as graph feedback | ✅ (save/recall) | ✅ (`save-result`) |
| Documents without an LLM (PDF, Office, Markdown) | ✅ | ❌ (needs the `/graphify` skill with an LLM) |
| Plain-language view of the logic / documents | ✅ (How it works, Documentation) | ❌ |
| Global memory shared across projects | ✅ | ❌ |

## Reading the numbers

1. **Code, natural language → file:** it is a tie, and **both are weak**. cm is clearly better on code-mem (MRR 0.28 against 0.12); graphify is somewhat better on yano-flash (hit@5 48% against 40%). On the realistic hand-written questions neither puts the right file in its top 5 (13% and 0%), even though both cite it somewhere in the answer (73% and 87%). They "spray" 13–29 files: the information is there, the ranking is not.
2. **Documentation:** code-mem wins outright. Without an LLM, graphify does not index documents.
3. **Memory:** code-mem wins by design. graphify is a topological graph, not a memory with history, evidence and verification.
4. **Speed:** graphify wins on build and update (about 10× faster), partly because it only does code.
5. **Serious gap in code-mem:** `cm recall`, which is what the hooks inject into agents at session start, **never finds code** (0–4%). It searches memories and documents only; the code graph is reachable only through `cm query`.

## Where to improve code-mem to overtake graphify on code

In order of expected impact per effort:

1. **`cm recall` must also search the code graph.** Merge the top 3–5 code nodes (file + function) into the recalled memories. That closes the 0% gap on the path agents actually use.
2. **Better code tokenization.** Split camelCase/snake_case identifiers (`jevStatus` → "jev status") and index functions' leading comments and docstrings. Today "Jev credit status" does not match `setJevStatus` in `jev.js`.
3. **Rank `cm query` by relevance, not BFS order.** Cite fewer files (today 28–30, against graphify's 13) and put the ones that match the question first. This is exactly the hit@5 against "anywhere" problem.
4. **Use the logic map as a semantic index.** The "How it works" parts and journeys already describe the code in words ("The Librarian keeps your notes…" → `storage.js`). A question like "how does X work" can go question → part/step → files.
5. **Optional Jev re-ranking.** A yes/no question "does this file answer the question?" over the top 20 candidates. It costs cents and exploits what Jev does best.

Confidence: high on the relative comparison (same budget, same repos, automatic sets that neither tool was tuned on, chance level measured); medium on absolute values (two repositories, 25 questions per set, no LLM at indexing time).
