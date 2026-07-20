# Goal: Colmare i gap di cm su graphify

## Stato desiderato

Tutti i gap identificati nel benchmark graphify vs cm v0.6.0 sono risolti:

1. `cm gn <label>` accetta **nomi umani** (label, filename parziale, prefix match) — se esiste un nodo con label o id che contiene il termine, lo trova
2. `cm gp <from> <to>` idem — risolve i nomi in ID prima del pathfinding
3. `cm query "<question>"` — **nuovo comando** che fa BFS traversal del grafo a partire dai nodi rilevanti per la domanda, restituendo contesto strutturato (nodi + edge + sorgenti)
4. `cm recall <task>` usa il grafo per arricchire i risultati (pesa i termini del task contro label/ID dei nodi)

## Criteri di verifica (devono apparire nel transcript)

- `cm gn event-bus` restituisce i vicini di event-bus.js (o del nodo con label matching "event-bus")
- `cm gp "cli" "metering"` trova un path anche se i nomi non sono ID esatti
- `cm query "event routing"` restituisce nodi BFS ordinati per rilevanza
- `cm recall "metering system"` mostra risultati arricchiti dal grafo (graph terms)
- `cm help` mostra `query` tra i comandi disponibili
- Tutti gli 85 test e2e passano (`bash tests/test-e2e.sh`)
- Nessuna regressione sui comandi esistenti

## Limite

25 turni
