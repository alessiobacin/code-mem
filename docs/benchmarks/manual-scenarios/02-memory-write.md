# Scenario 02 — memory writes and lifecycle

```bash
cm init
cm save --kind decision --title "Test runner" \
  "Use Vitest because parallel tests run three times faster than Jest."
cm save --kind fact "PostgreSQL stores application data."
cm save --kind preference --global "Prefer concise answers with file references."
cm add "Redis is the session cache."
cm add-user "Use English in project memory."
cm save --kind decision "Use Vitest because parallel tests run three times faster than Jest."
cm replace "Test runner" "Use Vitest and Playwright for unit and end-to-end tests."
cm ls
cm ls-user
cm touch <memory-id>
cm contest <memory-id> "requires recheck"
cm verify <memory-id> --by manual-qa
```

Acceptance checks: typed rows are saved, near-duplicates are rejected, the
correction records predecessor/successor state, and contest/verify updates the
audit lifecycle without deleting provenance.
