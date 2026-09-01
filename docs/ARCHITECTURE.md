# Architettura e flusso logico di code-mem

> Rappresentazione dettagliata della logica del CLI `cm` (generato in `bin/cm` dal bundle
> `build/bundle.mjs`, sorgente in 18 frammenti ordinati sotto `src/` — vedi `src/README.md`).
> Il diagramma ripercorre: avvio, inizializzazione, apertura store, e il dispatch dei comandi
> (scrittura, lettura/recall, capture, grafo, scan, query/entità, history, ricerca, manutenzione).

Fonte del diagramma: [`docs/ARCHITECTURE.mmd`](ARCHITECTURE.mmd) (rendered con Mermaid).

## Diagramma di flusso

```mermaid
flowchart TD
    Start([CLI entry: node bin/cm]) --> NodeCheck{Node 22+ && node:sqlite?}
    NodeCheck -->|No| ReExec["Re-exec with --experimental-sqlite"]
    ReExec --> Args
    NodeCheck -->|Yes| Args[Parse process.argv + cwd]

    Args --> CmdDispatch{cmd?}

    %% ── GLOBAL SETUP COMMANDS ──
    CmdDispatch -->|"help | -h"| Help[Print lean help; --full reveals corollary surfaces]
    CmdDispatch -->|"version"| Version[Print VERSION]
    CmdDispatch -->|"setup"| Setup[Install cm skill into harnesses]
    CmdDispatch -->|"update"| Update[Check GitHub main → download bin/cm → replace]
    CmdDispatch -->|"init"| Init[Initialize project memory]

    Init --> InitRun[ensure memory/ MEMORY.md USER.md graph.json state.db]
    InitRun --> ScanRepo[Scan repo → tech stack + dir nodes]
    ScanRepo --> SaveSnapshot[Save 'Project snapshot' fact]
    SaveSnapshot --> InstallAcorn[Try install acorn deps + SessionStart hook]
    InstallAcorn --> InitDone[Print result]

    CmdDispatch --> OpenDB[ensureMemoryReady + od(state.db) + ensureGraphTables/FTS/recall indexes]

    %% ── WRITE ──
    OpenDB --> WriteCmd{write?}
    WriteCmd -->|"save / add / add-user"| Save[SaveMemory]
    Save --> Dedup{similar duplicate && !force?}
    Dedup -->|Yes| DupBlock[Print Duplicate, suggest --force]
    Dedup -->|No| Upsert[upsertMemoryItem → memory_items + memory_context]
    Upsert --> Vector[Optional embed: Ollama or trigram]
    Vector --> RefreshProj[refreshProjections → MEMORY.md/USER.md]

    WriteCmd -->|"replace"| Replace[replaceMemory by match]
    WriteCmd -->|"rm"| Rm[removeMemory by match → archived]
    WriteCmd -->|"archive"| Archive[Set status=archived]
    WriteCmd -->|"touch"| Touch[access_count+1, last_accessed_at]
    WriteCmd -->|"link"| Link[Insert memory_links row]

    %% ── READ ──
    OpenDB --> ReadCmd{read?}
    ReadCmd -->|"ls / ls-user / recent"| List[List active memories]
    ReadCmd -->|"plan"| Plan[makePlan: inferTaskKind + prioritized kinds]
    ReadCmd -->|"recall / explain / recall-auto"| Recall[recallMemories]
    Recall --> PlanRec[makePlan]
    PlanRec --> Candidates[queryMemoryCandidates FTS/trigram + graph terms + link expansion]
    Candidates --> GlobalScope{need global? <limit or explore}
    GlobalScope -->|Yes| GlobalPool[Open ~/.cm/state.db + merge candidates]
    GlobalScope -->|No| Score
    GlobalPool --> Score[Compute embedding: Ollama if lvl>2 else trigram]
    Score --> Rank[scoreMemory → 8 dimensions]
    Rank --> TopN[filter score>0.05, sort, take limit, bump access_count]
    TopN --> Render[renderRecall levels 1/2/3]

    %% ── GRAPH ──
    OpenDB --> GraphCmd{graph? ga ge gn gp gs gi gc gx}
    GraphCmd --> GraphOps[Load graph from store / mutate graph_nodes-graph_edges]
    GraphOps --> Export{gx?}
    Export -->|graphml| GraphML[graph.graphml]
    Export -->|html| HTML[graph.html]
    Export -->|svg| SVG[graph.svg]
    Export -->|neo4j| Neo4jCSV[Neo4j CSV]

    %% ── SCAN ──
    OpenDB --> ScanCmd{scan? --deep / --relations}
    ScanCmd -->|deep| AST[scanASTDeep → AST or regex symbols + edges]
    ScanCmd -->|relations| Relations[scanCodeRelations → import edges]

    %% ── QUERY / BFS ──
    OpenDB --> QueryCmd{query}
    QueryCmd --> BFS[Keyword match → BFS depth 3 → print related nodes]

    %% ── ENTITIES (new) ──
    OpenDB --> EntCmd{entities}
    EntCmd --> EntExtract[extractEntities from memory_items (+ --msgs messages)]
    EntExtract --> EntList{--apply?}
    EntList -->|No| EntPrint[Print top by count + category]
    EntList -->|Yes| EntGraph[applyEntitiesToGraph: upsert nodes type=tech/file/symbol + co_occurs edges]
    EntGraph --> SyncGraph[syncGraphProjection → graph.json]

    %% ── HISTORY / DIGEST (new) ──
    OpenDB --> HistCmd{history | digest}
    HistCmd --> HistQ[listMemoryRows active + kind/entity filter]
    HistQ --> HistDigest[Build timeline newest-first + digest by kind/month/top-entities]

    %% ── SEARCH / MAINTENANCE ──
    OpenDB --> SqCmd{sq}
    SqCmd --> FTS[sd() FTS5 over messages]
    OpenDB --> ProjCmd{project}
    ProjCmd --> RefreshProj
    OpenDB --> ConsCmd{consolidate}
    ConsCmd -->|prune| Prune[archive confidence<0.3 & age>90d]
    ConsCmd -->|normal| Consolidate[promote working/episodic → semantic/procedural + embed]
    Consolidate --> RefreshProj
    OpenDB --> BackupCmd{backup/restore}
    BackupCmd --> Backups[write/read backup markdown or JSON]
    OpenDB --> WatchCmd{watch}
    WatchCmd --> Watch[watchLoop every 30s: embed unembedded + consolidateMemories]

    OpenDB --> UnknownCmd{cmd not matched}
    UnknownCmd -->|Yes| UnkErr[Print 'Unknown cmd. Run: cm help']

    subgraph Store["Local storage"]
        DB[(state.db: memory_items, memory_context, memory_links, messages+fts, graph_nodes, graph_edges)]
        GF[(graph.json)]
        MD[MEMORY.md / USER.md]
    end
    RefreshProj --> MD
    SyncGraph --> GF
    GraphOps --> DB
    Upsert --> DB
    Rank --> DB
```

## Note

- **Dispatcher unico:** `bin/cm` è un **bundle generato** (build/bundle.mjs) che ricompone 18 frammenti `src/` in un singolo file CommonJS; `main()` apre `state.db` (con fallback `--experimental-sqlite`) e instrada i comandi.
- **`state.db` è la source of truth;** `graph.json` e `MEMORY.md`/`USER.md` sono proiezioni rigenerabili.
- **Ricerca ibrida:** `recall` fonde FTS/trigram, termini di grafo, espansione dei link (BFS) e (opzionale) embedding Ollama; fallback sempre a trigram se Ollama è assente.
- **Nuove feature 2026:** `cm entities` (estrazione entità + `--apply` nel grafo) e `cm history`/`cm digest` (timeline + riassunto evolutivo); vedi anche `tests/manual-scenarios/07-entities.md` e `08-history-digest.md`.
- **Obscuramento (Task A):** l'help pubblico (`cm help`) è snello; le superfici corollario (graph: ga/ge/gn/gp/gc/gx/gs/gi, scan, query, entities, history/digest, import, sq) compaiono solo con `cm help --full` / `cm --full`. I comandi restano chiamabili direttamente (API invariata).
- **Capture layer (Task A):** la tabella `messages` + FTS5 (`messages_fts`) è ora viva grazie a `src/capture.js`; `cm save --auto [--role dev|agent]`, `cm recall-auto` (riga contesto SessionStart) e `cm watch` (heartbeat) scrivono righe; `od()` chiama `ensureMessagesSearchTables` così i trigger FTS indicizzano ogni INSERT. Lettori: `cm sq`, `cm entities --msgs`.
- **Re-ranking A1 (recall-auto):** prima del rendering, `cm recall-auto` esegue 3 round di softmax a temperatura decrescente (`T0/r`, T0 = 1.0, `temperatureRerank()` in `src/retrieval.js`) accumulando un consenso EM-like tra i round; il round 1 è monotono nello score base, quindi `cm recall` resta invariato. Output riscalato in `[0,1]`, deterministico.
- **Hardening A2 (scritture):** le sequenze multi-statement (`upsertMemoryItem` + `memory_context`, item + vettore trigram) girano in `withTransaction()` (`BEGIN IMMEDIATE`/`COMMIT`, `ROLLBACK` su errore, nesting collassato) così un crash non lascia mai righe mezze scritte. `acquireLock()` in `src/memory-ops.js` fa stale-lock recovery verificando con `process.kill(pid, 0)` se il PID registrato in `.watch.lock` è ancora vivo prima di rimuovere il lock.
- **Hardening A2 (update):** `src/update.js` verifica lo SHA-256 del bundle scaricato contro il manifest remoto `bin/cm.sha256` prima di sostituire qualsiasi file locale (mismatch → abort senza scritture; manifest assente → solo warning). La base di download è overridabile con `CM_UPDATE_BASE` (usata dai test di integrità).
