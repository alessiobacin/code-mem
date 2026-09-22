# Scenario 09 — Obsidian and Markdown wiki import

Create a temporary vault:

```bash
VAULT=$(mktemp -d)
mkdir -p "$VAULT/notes"
cat > "$VAULT/notes/Auth.md" <<'EOF'
---
title: Authentication
tags: [security, jwt]
---
# Authentication
JWT tokens are issued by the auth module. See [[Database]].
EOF
printf '# Database\nPostgres stores users.\n' > "$VAULT/notes/Database.md"
```

Import and verify:

```bash
cm init
cm import "$VAULT"
cm ls
cm gn Authentication
cm import "$VAULT"
cm import "$VAULT" --dry-run
```

Acceptance checks: two memories, two graph nodes and one `links_to` edge are
created; tags/frontmatter are preserved; a second import creates no duplicate;
dry-run reports counts without modifying the store. The same generic command
handles Obsidian, Logseq, Foam, Dendron and other Markdown knowledge sources;
the source application does not need to be specified.
