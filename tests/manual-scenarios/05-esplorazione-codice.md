# Scenario 05 — Esplorazione del codice e import

## Obiettivo
Verificare `query`, `scan` (relations/deep), `explain` e `import` da altre fonti.

## Prerequisiti
- Un progetto con un po' di codice (es. un piccolo progetto TS/JS) in cui `cm init` e' gia' stato fatto.

## Preparazione (progetto demo con codice)

```bash
D=/tmp/cm-manual-code
rm -rf "$D"; mkdir -p "$D/src"; cd "$D"
cat > src/auth.ts <<'EOF'
import { verifyJwt } from './jwt';
export async function login(token: string) {
  const user = await verifyJwt(token);
  return { id: user.id, tenantId: user.tenantId };
}
EOF
cat > src/jwt.ts <<'EOF'
import { verify } from './signer';
export async function verifyJwt(token: string) {
  return verify(token, process.env.SECRET);
}
EOF
cat > src/db.ts <<'EOF'
import { login } from './auth';
export class Database {
  async connect() { return this; }
}
export async function handle(req: any) { await login('x'); }
EOF
echo '{"name":"demo","dependencies":{"typescript":"^5"}}' > package.json
cm init >/dev/null 2>&1
```

## Comandi

```bash
# 1. Query BFS sul grafo (meglio dopo lo scan)
cm scan --deep
cm query "auth login"
# atteso: nodi seed + nodi correlati via BFS

# 2. Relazioni auto-scoperte (senza applicare)
cm scan --relations
# atteso: suggerimenti tipo "auth import --> jwt [depende, INFERRED]"

# 3. Applica le relazioni
cm scan --relations --apply
# atteso: messaggio con conteggio edge applicati
cm gs
# atteso: piu' nodi/archi di prima

# 4. Explain (recall arricchito con punteggi)
cm explain "complete the login flow" --limit 5
# atteso: risultati con riga Explain e Link Path se presenti

# 5. Import grafo graphify
cm import --graphify /percorso/a/graph.json
# atteso: "Imported: N nodes, M edges"

# 6. Import memories claude-mem
cm import --claude-mem --project project-name
# atteso: "Imported: N memories from claude-mem"

# 7. Import JSON generico
echo '{"nodes":[{"id":"n1","label":"Node1","type":"entity"}],"edges":[{"source":"n1","target":"n2","relation":"uses"}]}' > /tmp/import.json
cm import --json /tmp/import.json
# atteso: "Imported: 1 nodes, 1 edges"

# 8. Dry-run (non persiste)
cm import --json /tmp/import.json --dry-run
# atteso: "Imported: ..." ma senza modificare il grafo reale
```

## Verifica PASS/FAIL

| # | Pass | Fail |
|---|------|------|
| 1 | `query` restituisce nodi/sconnessi | "No nodes matched" se grafo vuoto |
| 2 | Mostra suggerimenti di relazione | Nessun output (se nessuna relazione) |
| 3 | Conta edge applicati e `gs` cresce | Nessun cambiamento |
| 6 | Risponde import o un messaggio chiaro | Errore "claude-mem not found" gestito male |
| 8 | `gs` non contiene i nodi del dry-run | I nodi persistono |
