# Scenario 04 — Grafo

## Obiettivo
Verificare la gestione del grafo: nodi, archi, vicini, percorsi, statistiche, community, export.

## Prerequisiti
- Progetto con `cm init`.

## Comandi

```bash
D=/tmp/cm-manual-graph; cd "$D"; cm init >/dev/null 2>&1

# 1. Aggiungi nodi
cm ga auth_mod  "Auth Module"   module
cm ga db_mod    "Database Layer" module
cm ga cache_mod "Cache Layer"   module
cm ga api_gw    "API Gateway"   module
# atteso: "Added: ..." per ciascuno

# 2. Aggiungi archi
cm ge auth_mod db_mod depends_on EXTRACTED
cm ge auth_mod cache_mod depends_on EXTRACTED
cm ge api_gw   auth_mod calls EXTRACTED
cm ge api_gw   db_mod calls EXTRACTED
# atteso: "Added edge ..." ; ripeti uno -> "Edge exists."

# 3. Statistiche
cm gs
# atteso: "N nodes, M edges"

# 4. Vicini (per id e per nome umano/label)
cm gn auth_mod
cm gn "Auth Module"
# atteso: elenco vicini con relazione

# 5. Path (BFS/Dijkstra)
cm gp api_gw cache_mod
# atteso: path con hop ("hops: ..."), es. api_gw -> auth_mod -> cache_mod

# 6. Insight (hub + cross-type + provenance)
cm gi
# atteso: HUBS, CROSS-TYPE, SUGGESTED

# 7. Community detection
cm gc
# atteso: elenco community (gerarchie); se pochi nodi -> singleton

# 8. Export
cm gx graphml     # memory/graph.graphml
cm gx html        # memory/graph.html (apri nel browser)
cm gx svg         # memory/graph.svg
cm gx neo4j       # CSV per Neo4j
# atteso: percorsi dei file generati
```

## Rendi piu' ricco il grafo (facoltativo)

```bash
# Popola il grafo da una codebase reale
cm scan --deep                   # AST scanner (acorn se presente, altrimenti regex)
cm gs
# Oppure estrai entita' dalle memorie (vedi scenario 07)
cm entities --apply
cm gs
```

## Verifica PASS/FAIL

| # | Pass | Fail |
|---|------|------|
| 1 | Ogni `ga` risponde `Added` | Errore |
| 2 | Duplicato rifiutato con "Edge exists." | Lo aggiunge di nuovo |
| 4 | Trova vicini sia per id che per label | Un solo modo funziona |
| 5 | Mostra un path con `hops` | "No path" o crash |
| 7 | Stampa almeno una community o "singleton" | Crash |
| 8 | I file vengono generati | Nessun file |
