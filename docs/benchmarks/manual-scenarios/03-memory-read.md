# Scenario 03 — memory listing and recall

```bash
cm init
cm save --kind decision "Use Vitest for fast parallel tests."
cm save --kind fact "PostgreSQL stores users and Drizzle maps the schema."
cm save --kind procedure "Run npm test before every commit."
cm ls
cm ls-user
cm recent 5
cm plan "fix a flaky test"
cm recall "parallel test runner" --level 1 --mode keyword
cm recall "test execution strategy" --level 2 --mode hybrid
cm recall "database schema" --level 3 --mode semantic
cm explain "database schema" --limit 5
```

Acceptance checks: `plan` classifies the task, level 1 shows titles, level 2
adds summaries, level 3 shows bodies and explanations, and hybrid/trigram
recall still works without Ollama.
