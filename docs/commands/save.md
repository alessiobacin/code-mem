# `cm save`

Save one durable typed memory.

```bash
cm save --kind decision --title "Use Vitest" "Reason and consequence"
cm save --kind preference --layer user "Prefer concise answers"
cm save --global --kind preference --layer user "I generally prefer Next.js"
cm save --auto --role dev "Capture this conversation message"
```

Kinds include `fact`, `decision`, `procedure`, `issue`, `artifact`,
`preference`, `event`, and `inference`. Use `--global` only for reusable
cross-project knowledge. Never save secrets or provider transport chatter.
