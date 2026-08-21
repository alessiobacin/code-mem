# Flussi logici dei competitor: graphify e claude-mem

> Diagrammi di flusso dei due principali competitor di code-mem, ricavati da
> fonti locali reali (skill/CLI `graphify` installato; plugin `claude-mem` v9.1.1
> e script MCP nel cache di Claude Code). Servono a confrontare le logiche
> architetturali. Per la logica di code-mem vedi [ARCHITECTURE.md](ARCHITECTURE.md).

## 1. graphify — knowledge graph da codebase (Python + networkx)

Pipeline principali: **build** (da una cartella a `graphify-out/graph.json`) e **query** (su grafo già costruito).

```mermaid
flowchart TD
    Invoke(["/graphify <path> --mode M"]) --> Path{path?}
    Path -->|"default ."| Detect[Step1 ensure installed + write .graphify_python]
    Path -->|"given"| Detect
    Detect --> Scanner[Step2 detect files: code/docs/papers/images/video]
    Scanner --> Corpus{total_words>2M or files>200?}
    Corpus -->|"Yes"| Warn[Print warning + top 5 subdirs + ask which subfolder]
    Warn --> Scanner
    Corpus -->|"No"| Video{video files?}
    Video -->|"Yes"| Whisper[Transcribe with Whisper -> treat as docs]
    Video -->|"No"| Parallel
    Whisper --> Parallel

    Parallel[[Run AST + semantic extraction in parallel]]
    Parallel --> AST[A - structural AST on code files]
    AST --> Merge[Merge AST + semantic]

    Parallel --> Cache[Check semantic cache]
    Cache --> Chunks[Split uncached files into chunks of 20-25]
    Chunks --> Agents[Dispatch N semantic subagents in ONE message]
    Agents --> Collect[Collect chunk JSON: cache + merge into .graphify_semantic.json]

    Merge --> Build[Step4 build_from_json -> networkx graph]
    Build --> Cluster[Louvain community detection + cohesion scores]
    Cluster --> Analyze[god_nodes + surprising_connections + suggest_questions]
    Analyze --> Report[Generate GRAPH_REPORT.md + graph.json]

    Report --> Labels[Step5 LLM names each community 2-5 words]
    Labels --> Regenerate[Regenerate report with real labels]

    Regenerate --> Step6{visualization}
    Step6 -->|"default"| HTML[to_html -> graph.html]
    Step6 -->|"--obsidian"| Vault[to_obsidian + graph.canvas]
    Step6 -->|"--svg"| SVG[graph.svg]
    Step6 -->|"--graphml"| GML[graph.graphml]
    Step6 -->|"--wiki"| Wiki[agent-crawlable wiki index.md + per-community]
    Step6 -->|"--no-viz"| NoViz[skip viz]

    Report --> Step7{--neo4j / --neo4j-push?}
    Step7 -->|"--neo4j"| Cypher[to_cypher -> cypher.txt]
    Step7 -->|"--neo4j-push"| Push[push to bolt://localhost:7687]

    subgraph Outputs["graphify-out/"]
        O1[graph.json]
        O2[GRAPH_REPORT.md]
        O3[graph.html]
        O4[obsidian/ or wiki/]
        O5[cypher.txt]
    end
    Build --> O1
    Report --> O2
    HTML --> O3
    Vault --> O4
    Cypher --> O5

    subgraph Query["Query layer (on existing graph.json)"]
        Q1[graphify query "Q" -> BFS traversal]
        Q1 -->|"--dfs"| Q1b[DFS trace specific path]
        Q1 -->|"--budget N"| Q1c[Cap answer at N tokens]
        Q2[graphify path "A" "B" -> shortest path]
        Q3[graphify explain "X" -> plain-language node + neighbors]
        RB[graphify add <url> -> fetch into ./raw + update graph]
        WM[graphify watch <path> -> rebuild graph on change]
    end
    O1 --> Q1
    O1 --> Q2
    O1 --> Q3
    RB --> Detect
    WM --> Detect

---

## 2. claude-mem — memoria cross-session per Claude Code (cloud MCP)

Plugin MCP che persiste osservazioni/sessioni/prompt con ricerca semantica remota.
Workflow di retrieval a 3 livelli documentato nella skill `mem-search`.

```mermaid
flowchart LR
    CC[Claude Code session] -->|SessionStart hook| Auto[Auto-inject contextual memory]
    CC -->|hooks| Capture[Capture observations from activity]

    subgraph Plugin["claude-mem plugin (MCP server)"]
        MCP[mcp-server.cjs]
        Worker[worker-service / worker-wrapper]
        Smart[smart-install.js / setup.sh]
    end

    Auto -.->|HTTP API| MCP
    Capture -.->|save| MCP

    MCP --> Tools[Expose MCP tools]
    Tools --> T1[search]
    Tools --> T2[timeline]
    Tools --> T3[get_observations]
    Tools --> T4[save_memory]

    Q[User/agent: did we solve this last time?] --> S1
    T1 --> S1[Step 1 search: index with IDs, types, timestamps]
    S1 --> S2[Step 2 timeline: context around anchor, depth]
    S2 --> S3[Step 3 get_observations: batch fetch full details]

    subgraph Svr["claude-mem server (remote / self-hosted)"]
        Db[(memory DB: observations, sessions, prompts)]
        Sem[Semantic search + embeddings]
    end
    T1 --> Db
    T2 --> Db
    T3 --> Db
    T4 --> Sem
    Sem --> Db

    subgraph Model["Storage model"]
        M1[observations: bugfix/feature/decision/discovery/change]
        M2[sessions]
        M3[prompts]
    end
    Db --> Model

    Inst["npm install -g claude-mem + MCP config"] --> Smart
    Smart --> MCP
