# code-mem 0.12: file index + Jev re-ranking vs graphify (2026-09-25)

Follow-up to [graphify-vs-code-mem-2026-09-25.md](graphify-vs-code-mem-2026-09-25.md).
Same runner, same repository copies, same question sets, same 2,000-token budget.
The hand-written questions (set B) were written **before** this change and were not edited afterwards.
Raw results: `docs/benchmarks/graphify-vs-cm-0.12-jev-{off,on}-{code-mem,yano-flash}.json`.

## What changed

- **File index** (`src/findex.js`). There is one FTS5 row per code or Markdown file. It holds the path words, the identifiers split into words (`setJevStatus` → "set jev status"), the comments, and the headings and text of Markdown files. The index uses Porter stemming. Changed files are re-read at query time, so no re-index is needed.
- **`cm query` and `cm recall`** start with **Relevant files**, the best-ranked first. `cm recall`, the path agents use, now finds code; before it found none.
- **Jev re-ranking.**
  - One typed call scores the top 10 candidates, with a yes/no probability per file ("does it contain the answer?").
  - That probability is blended with the text score (0.65 / 0.35).
  - The call is skipped when the text match is decisive (top score ≥ 2× runner-up).
  - `--no-jev` or `CM_JEV=off` disables it.
- **MCP tool `file_search`** gives agents the same ranking.

## Results: hit@1 / hit@5 / MRR

### Realistic hand-written questions (set B, code-mem, n=15): the fair test

| System | hit@1 | hit@3 | hit@5 | MRR | latency |
|---|---:|---:|---:|---:|---:|
| graphify | 0% | 0% | 13% | 0.10 | 0.17 s |
| cm 0.11 query (before) | 0% | 0% | 0% | 0.09 | 0.12 s |
| cm 0.12, no Jev | 60% | 73% | 87% | 0.70 | 0.14 s |
| **cm 0.12 + Jev** | **80%** | **93%** | **93%** | **0.87** | 1.0 s |

### Code-comment questions (set A, n=25 per repo)

| Repo | graphify | cm 0.11 query | cm 0.12 no Jev | cm 0.12 + Jev |
|---|---|---|---|---|
| code-mem | 4% / 12% / 0.12 | 20% / 36% / 0.28 | **96% / 100% / 0.98** | 84% / 100% / 0.91 |
| yano-flash | 8% / 48% / 0.26 | 12% / 40% / 0.25 | **96% / 100% / 0.98** | 84% / 100% / 0.92 |

### Documentation questions (set C, n=25 per repo)

| Repo | graphify | cm 0.11 recall | cm 0.12 no Jev | cm 0.12 + Jev |
|---|---|---|---|---|
| code-mem | 0% / 0% / 0.00 | 0% / 36% / 0.17 | **96% / 96% / 0.96** | 92% / 96% / 0.93 |
| yano-flash | 0% / 0% / 0.00 | 16% / 60% / 0.31 | **64% / 72% / 0.67** | 64% / 72% / 0.67 |

The yano-flash misses in set C are sentences repeated verbatim across several files (for example "Decisions locked (grill Q…)"). The benchmark counts a single gold file, so part of that gap is ambiguity rather than a retrieval error.

## Reading the numbers

1. **cm now beats graphify on every retrieval set, on both repositories.** On the fair set B, the answering file is ranked first 80% of the time with Jev (60% without). graphify's top-ranked file is never right: 0%.
2. **Sets A and C quote the source text verbatim.** cm indexes comments and Markdown and graphify does not, so these sets mostly measure coverage. They are not a fair measure of understanding; set B is.
3. **Jev is where it matters: paraphrased questions.** On set B it raises hit@1 from 60% to 80% and MRR from 0.70 to 0.87. On verbatim questions it costs a few hit@1 points (96% to 84%): Jev only sees each file's summary, while the text index matched every word. The "decisive match" gate limits this.
4. **Cost.**
   - Without Jev, cm answers as fast as graphify (0.12–0.17 s).
   - Jev adds about 0.7 s and one small call (~500 input tokens) per question.
   - Indexing speed is unchanged: graphify still builds about 10× faster.
5. **Confidence.** High on direction: large gaps, and set B was fixed before the change. Medium on absolute values: two repositories, and only 15 hand-written questions.

## Next

- A hand-written question set for yano-flash and for a documents-only repository.
- Classify files by role with Jev at index time (cached per file hash), then route a question to the matching role before ranking.
- Include the matching lines in the summary sent to Jev, to recover the hit@1 lost on verbatim questions.
