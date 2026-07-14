# Comparazione: code-mem vs altri sistemi di memoria

> Questo documento confronta code-mem con i principali sistemi di memoria per agenti AI, analizzando vantaggi e svantaggi di ciascuno in vari scenari d'uso.

## Panoramica dei sistemi

| Sistema | Descrizione | Autore | Licenza |
|---------|-------------|--------|---------|
| **code-mem** | Memoria di progetto persistente, locale, agent-agnostic | Alessio Bacín | MIT |
| **claude-mem** | Memoria cross-session per Claude Code, basata su MCP cloud | (Community) | Apache-2.0 |
| **graphify** | Knowledge graph da codebase con AST + semantic extraction, community detection | Safi Shamsi | MIT |
| **Claude Code file memories** | Sistema di memoria nativo di Claude Code basato su file Markdown | Anthropic | Proprietaria |
| **Claude Code (proprio sistema)** | Il sistema di memoria integrato in Claude Code con MCP server dedicato | Anthropic | Proprietaria |
| **Mem0** | Piattaforma di memoria per LLM, cloud-first con API | mem0.ai | Apache-2.0 |
| **Zep** | Memoria a lungo termine per AI assistant, con analisi entity | Zep AI | Apache-2.0 |
| **LangMem** | SDK di memoria di LangChain per agenti AI | LangChain | MIT |
| **Letta (MemGPT)** | Agente con memoria virtuale a livelli (core + archival) | Letta AI | Apache-2.0 |

---

## code-mem vs claude-mem

claude-mem è un MCP server che offre memoria persistente cross-progetto con ricerca semantica via API remota.

| Dimensione | code-mem | claude-mem |
|-----------|----------|------------|
| **Dove vive** | `memory/state.db` nel progetto | Remote API (cloud MCP) |
| **Ricerche** | FTS5 locale + embedding semantico opzionale (Ollama) | Semantic search via MCP API remota |
| **Dipendenze** | Zero (Node 22+ built-in) | npm + MCP plugin + server remoto |
| **Agent supporto** | Claude, Codex, Cursor, Pi, CLI | Solo Claude Code (MCP-based) |
| **Costi** | Zero | API calls al server remoto |
| **Offline** | Funziona completamente offline | Richiede connessione |
| **Privacy** | I dati non lasciano la macchina | I dati passano da server remoto |
| **Tipi di memoria** | 6 kinds, 5 layers, confidenza, salienza | Memoria semplice (titolo + testo) |
| **Grafo** | JSON graph leggero | Nessuno |
| **Context cost** | Fisso ~1300 token (MEMORY.md + USER.md) | Variabile, dipende dal recall |
| **Install** | `curl ... \| bash` | `npm install -g claude-mem` + MCP config |
| **Auto-recall** | SessionStart hook con `cm recall-auto` | MCP tool invocato dall'agente |

### Vantaggi di code-mem

- **Zero costi ricorrenti** — nessun API server da mantenere
- **100% offline** — perfetto per sviluppo in aereo, in treno, o su reti aziendali restrittive
- **Privacy totale** — le memorie non lasciano mai il tuo progetto
- **Agent-agnostic** — funziona con qualsiasi coding agent, non solo Claude Code
- **Tipi e strati** — distinzione semantica tra fact, decision, procedure, issue

### Svantaggi di code-mem

- **Nessuna persistenza cross-progetto** — ogni progetto ha la sua memoria separata
- **Niente cloud sync** — non esiste un modo per avere la stessa memoria su più macchine
- **Ricerca semantica opzionale e meno potente** — basata su Ollama locale, non su modelli cloud specializzati
- **Niente sharing** — non puoi condividere memorie con il team in tempo reale

### Quando scegliere code-mem

- Lavori da solo o in team piccolo su progetti locali
- Hai requisiti di privacy (dati sensibili, IP che non deve lasciare la macchina)
- Vuoi zero setup e zero costi
- Lavori spesso offline

### Quando scegliere claude-mem

- Usi Claude Code e vuoi memoria che persista tra progetti diversi
- Hai bisogno di ricerca semantica potente senza configurare Ollama
- Puoi permetterti un server MCP esterno e la connettività necessaria

---

## code-mem vs graphify

graphify costruisce un knowledge graph navigabile da una codebase, con AST extraction, semantic extraction via agent, community detection, e visualizzazione HTML interattiva.

| Dimensione | code-mem | graphify |
|-----------|----------|----------|
| **Scopo** | Memoria progettuale persistente | Esplorazione e mappatura della codebase |
| **Output principale** | `state.db` + `MEMORY.md` + `graph.json` | `graph.html` + `GRAPH_REPORT.md` + wiki Obsidian |
| **Fonte dati** | Decisioni, fatti, procedure salvate dall'utente | Tutti i file del progetto (codice, doc, immagini) |
| **Estrae da** | Input manuale (cm save) | AST (code) + LLM agents (docs, paper, images) |
| **Ricerca** | FTS5 + embedding + ranking deterministico | BFS/DFS graph traversal + query |
| **Persistenza** | Per-sessione e cross-sessione (DB) | Per-run o incrementale; non c'è un "memory layer" persistente |
| **AST extraction** | Solo scan iniziale (tecnologie, dirs) | AST completa su file .py, .ts, .js, .go, .rs, etc. |
| **Community detection** | No | Sì — trova cluster tematici inespressi |
| **Visualizzazione** | Markdown | HTML interattivo, SVG, Obsidian vault, wiki, GraphML, Neo4j |
| **Token cost** | Fisso ~1300 per proiezioni | Variabile — può essere alto (LLM chiamati per semantic extraction) |
| **Dipendenza LLM** | Opzionale (solo embedding Ollama) | Richiesta per semantic extraction (subagenti Claude) |
| **Casi d'uso** | Ricordare decisioni durante lo sviluppo quotidiano | Comprendere un codice sconosciuto, fare archaelogy |
| **Install** | `curl \| bash` | `pip install graphifyy` |

### Vantaggi di code-mem

- **Memoria attiva e persistente** — non solo mappa statica ma memoria che cresce con l'uso quotidiano
- **Costo contenuto** — nessuna chiamata LLM necessaria per il funzionamento base
- **Recupero integrato** — `cm recall` dà risultati immediati, non serve esplorare un grafo
- **Layer temporali** — distingue conoscenza fresca da consolidata

### Svantaggi di code-mem

- **Nessuna scoperta automatica** — non trova da solo connessioni nel codice; devi salvare manualmente
- **Non risponde a domande architetturali** — non può spiegare come due moduli interagiscono
- **Nessuna visualizzazione** — niente grafi interattivi, niente esplorazione visuale

### Quando scegliere code-mem

- Hai bisogno di un sistema di memoria che usi ogni giorno durante lo sviluppo
- Vuoi ricordare decisioni, bug, e procedure tra sessioni diverse
- Lavori su progetti che già conosci

### Quando scegliere graphify

- Arrivi su un codice nuovo e vuoi capire l'architettura
- Hai un corpus di documenti, paper, note di cui esplorare le connessioni
- Vuoi una mappa visiva e navigabile della codebase
- Il progetto ha migliaia di file e hai bisogno di orientarti

---

## code-mem vs Claude Code file memories

Claude Code offre un sistema di memoria nativo basato su file Markdown con frontmatter YAML (`CLAUDE.md`, file in `.claude/projects/`, e cartella `memory/` dei progetti).

| Dimensione | code-mem | Claude Code file memories |
|-----------|----------|---------------------------|
| **Storage** | SQLite (DB strutturato) | File Markdown flat |
| **Tipi** | 6 kinds, 5 layers, confidenza, salienza | Nessun tipo — tutto Markdown |
| **Ricerca** | FTS5 + embedding opzionale + ranking multi-dimensione | Manuale (grep su file) |
| **Context cost** | Fisso ~1300 token (proiezioni) | Proporzionale ai file caricati in contesto |
| **Versionabile** | Sì (DB può essere committato) | Sì (file di testo) |
| **CLI** | `cm` — CLI completo per CRUD, recall, watch, grafo | Nessuno — solo editing manuale dei file |
| **Automazione** | Watch daemon, consolidate, recall-auto, SessionStart hook | Nessuna — devi aggiornare a mano |
| **Grafo** | Sì (lightweight JSON graph) | No |
| **Search conversazioni** | Sì (FTS5 su messaggi) | No |
| **Offline** | Sì | Sì |
| **Portabilità** | Qualsiasi agente (Claude, Codex, Cursor, Pi, CLI) | Solo Claude Code |
| **Embedding** | Opzionale (Ollama, nomic-embed-text) | Nessuno |
| **Legacy compat** | Importa MEMORY.md/USER.md legacy | N/A |

### Vantaggi di code-mem

- **Ricerca potente** — FTS5 full-text + embedding semantico + ranking deterministico
- **Automazione** — watch daemon, consolidate automatico, recall-auto a ogni sessione
- **Tipi strutturati** — non tutto è un blob di testo; fact, decision, procedure hanno significati diversi
- **Grafo** — relazioni tra memorie e tra elementi del progetto
- **CLI completo** — non devi mai editare file a mano
- **Context minimo** — proiezioni sempre sotto 2200/1400 caratteri

### Svantaggi di code-mem

- **Dipende da node:sqlite** — richiede Node 22+
- **Non è "nativo"** — richiede installazione separata
- **Più complesso** — per chi vuole solo "appunta due righe", il file Markdown è più immediato

### Quando scegliere code-mem

- Hai bisogno di ricerca strutturata sulle memorie
- Vuoi automazione (consolidamento, watch, recall automatico)
- Lavori in progetti con più agenti diversi
- Hai bisogno di tenere traccia di decisioni, procedure, e issue con metadati

### Quando scegliere Claude Code file memories

- Usi solo Claude Code e non vuoi installare nulla
- Hai bisogno di annotazioni molto semplici e poche
- Preferisci editare file Markdown a mano
- Non hai Node 22+ disponibile

---

## code-mem vs Mem0

Mem0 è una piattaforma di memoria per LLM con API REST, embedding automatico, e sintesi storica.

| Dimensione | code-mem | Mem0 |
|-----------|----------|------|
| **Architettura** | Locale, file-based | Cloud, API REST |
| **Setup** | `curl \| bash`, `cm init` | `pip install mem0ai` + API key |
| **Storage** | SQLite locale | Remote database (MongoDB + vettoriale) |
| **Embedding** | Opzionale (Ollama locale) | Automatico, multi-modello (OpenAI, Claude, Ollama) |
| **Ricerca** | Deterministico + semantico ibrido | Semantico vettoriale puro |
| **Costi** | Zero | A pagamento (piani: free limitato, pro, enterprise) |
| **Offline** | Sì | No |
| **Privacy** | Totale (locale) | I dati risiedono su server Mem0 |
| **Tipi** | 6 kinds, 5 layers | Generico — testo + metadati |
| **Storia** | Versioni hash-based | Storico completo delle modifiche |
| **Integrazione** | Qualsiasi agente (skill install) | Python SDK + REST API |
| **Auto-consolidamento** | `cm consolidate`, watch daemon | Sintesi automatica della storia |
| **Utenti multipli** | No (per-progetto) | Sì (multi-user nativo) |

### Vantaggi di code-mem

- **Zero costi** — non ci sono piani, limiti, o sorprese in fattura
- **Privacy assoluta** — nessun dato esce dal tuo computer
- **Funziona offline** — treno, aereo, reti aziendali bloccate
- **Installazione in 3 secondi** — un comando curl, niente API key da configurare
- **Agent-agnostic** — non devi riscrivere integrazioni per ogni agente

### Svantaggi di code-mem

- **Niente multi-utente** — non puoi condividere memoria con il team
- **Niente embedding automatico** — richiede Ollama e non è così sofisticato
- **Niente sintesi storica** — non genera riassunti automatici dell'evoluzione
- **Scala sul singolo progetto** — non è pensato per memoria a livello di organizzazione

### Quando scegliere code-mem

- Lavori da solo o in team piccolo
- Hai requisiti di privacy e sicurezza
- Non vuoi costi ricorrenti
- Preferisci che tutto funzioni offline

### Quando scegliere Mem0

- Hai bisogno di memoria condivisa tra utenti e sessioni diverse
- Vuoi embedding automatico senza configurare nulla
- Servono analytics e history tracking sulle memorie
- Lavori in un'organizzazione che può permettersi il costo

---

## code-mem vs Zep

Zep è una piattaforma di memoria persistente per AI assistant, con analisi di entità, riassunti, e API REST.

| Dimensione | code-mem | Zep |
|-----------|----------|-----|
| **NLP** | Embedding base (Ollama) | Entity extraction, summarization, sentiment analysis |
| **Architettura** | Locale | Cloud o self-hosted (Docker) |
| **Memory types** | 6 kinds + 5 layers | Session memory, entity memory, summary memory |
| **Graph** | JSON graph leggero | Knowledge graph con entità e relazioni |
| **Search** | FTS5 + ranking deterministico + embedding opzionale | Semantic + keyword + graph traversal |
| **Setup** | `curl \| bash` | Docker compose + API key |
| **Persistenza** | Per-progetto (SQLite) | Cloud o self-hosted PostgreSQL |
| **Classificazione** | Manuale (kind + layer) | Automatica (entità, temi, classi) |
| **API** | CLI locale | REST API (REST + WebSocket) |
| **Offline** | Sì | No (solo self-hosted) |
| **Costi** | Zero | Open source (self-host) o cloud a pagamento |

### Vantaggi di code-mem

- **Zero setup** — niente Docker, niente database esterno
- **Leggero** — un file Node.js, un file SQLite
- **Completamente offline**
- **Memoria tipizzata** — non solo "testo", ma fact, decision, procedure, issue
- **Integrazione immediata** — skill install funziona in 5 harness diversi senza modifiche

### Svantaggi di code-mem

- **Niente entity extraction automatica** — Zep estrae entità, code-mem no
- **Niente analisi NLP** — nessuna summarization automatica oltre il troncamento
- **Niente API REST** — non espone servizi, solo CLI
- **Niente self-hosting scalabile** — pensato per singolo progetto, non per cluster

### Quando scegliere code-mem

- Vuoi qualcosa che funzioni subito, senza Docker
- Hai bisogno di memoria contestuale per agenti di sviluppo
- Lavori su progetti con requisiti di semplicità

### Quando scegliere Zep

- Hai bisogno di entity extraction e grafo della conoscenza automatico
- Puoi o vuoi gestire Docker per self-hosting
- Lavori su applicazioni AI che interagiscono con utenti finali, non solo sviluppo software
- Servono API REST per integrazioni custom

---

## code-mem vs LangMem (LangChain)

LangMem è l'SDK di memoria per agenti di LangChain/LangGraph, con store configurabile e pattern di gestione.

| Dimensione | code-mem | LangMem |
|-----------|----------|---------|
| **Framework** | Standalone (nessuna dipendenza) | LangChain / LangGraph |
| **Store** | SQLite (node:sqlite) | PostgreSQL, SQLite, InMemory (via LangGraph store) |
| **Pattern** | Tipi + layer + ranking deterministico | Summarization, reflection, core/recency window |
| **Search** | FTS5 + embedding + scoring ibrido | Base (store search) + summarization |
| **Setup** | `curl \| bash` | `pip install langmem` + LangChain setup |
| **Configurazione** | Immediata (cm init) | Richiede store config, tool definitions |
| **Runtime richiesto** | Node.js 22+ | Python 3.10+ |
| **Lingua** | TypeScript (Node.js) | Python |
| **Integrazione** | Skill per qualsiasi agente | LangChain/LangGraph agenti nativi |
| **Community** | Nuova, in crescita | Grande (LangChain ecosystem) |
| **Astrazione** | CLI + skill | SDK Python con pattern dichiarativi |

### Vantaggi di code-mem

- **Nessun framework lock-in** — non devi usare LangChain per avere memoria
- **Zero dipendenze** — non installa mezza libreria Python
- **Facilità** — `curl | bash && cm init` e hai memoria funzionante
- **Agent-agnostic** — non legato a un ecosistema specifico

### Svantaggi di code-mem

- **Meno flessibile** — LangMem permette store custom, code-mem ha solo SQLite
- **Niente pattern di memory management avanzati** — summarization, reflection, core window non esistono
- **Solo TypeScript** — LangMem è Python, code-mem è Node.js
- **Niente tool integration automatica** — LangMem si integra nativamente con LangGraph

### Quando scegliere code-mem

- Non usi LangChain/LangGraph
- Vuoi memoria in progetti Node.js/TypeScript
- Preferisci un approccio semplice e diretto

### Quando scegliere LangMem

- Usi già LangChain/LangGraph
- Hai bisogno di pattern avanzati come summarization e reflection
- Lavori in un ecosistema Python
- Vuoi store personalizzabili (PostgreSQL, custom)

---

## code-mem vs Letta (MemGPT)

Letta implementa un agente con memoria gerarchica (core block + archival memory + recall memory), ispirato al memory management dei sistemi operativi.

| Dimensione | code-mem | Letta (MemGPT) |
|-----------|----------|----------------|
| **Architettura** | Tool di memoria per agenti | Agente vero e proprio con memoria interna |
| **Memory model** | SQLite + proiezioni Markdown | Core block (sempre in contesto) + archival (DB vettoriale) + recall (storia conversazioni) |
| **Embedding** | Opzionale (Ollama) | Integrato (OpenAI, Azure, Ollama) |
| **Storage** | SQLite locale | PostgreSQL + pgvector (o SQLite +chroma) |
| **Server** | Nessuno (tranne watch opzionale) | Letta server (REST + WebSocket) |
| **CLI** | `cm` — CLI completo | `letta` — CLI per gestione agenti |
| **Runtime** | Node.js 22+ | Python 3.10+ |
| **Auto-management** | consolidate, watch daemon | Core memory eviction automatica |
| **Multi-agent** | No (per-progetto) | Sì (gestisce multipli agenti con memorie separate) |
| **Tool use** | Richiede skill install | Nativo nel runtime agente |
| **Setup weight** | Leggero (~57KB il CLI) | Pesante (server DB, modelli, dipendenze Python) |
| **Offline** | Sì | Parziale (dipende dal modello) |

### Vantaggi di code-mem

- **Leggerissimo** — il CLI è 57KB. Letta richiede server, DB, modello embedding, dipendenze Python
- **Zero componenti** — niente server, niente database da amministrare
- **Nessun vendor lock-in** — non devi usare l'agente Letta per avere memoria persistente
- **Parte del tuo stack attuale** — completa il tuo agente esistente, non lo sostituisce
- **Memoria per progettazione** — non solo conversazioni, ma decisioni e procedure progettuali

### Svantaggi di code-mem

- **Non è un agente** — code-mem non esegue task, non ha un loop di ragionamento
- **Niente memory management automatico** — Letta decide cosa tenere in core e cosa archiviare
- **Niente recall storico completo** — Letta registra tutta la storia della conversazione
- **Niente multi-agent** — Letta gestisce più agenti con memorie separate

### Quando scegliere code-mem

- Hai già un agente (Claude, Codex, Cursor, Pi) e vuoi aggiungere memoria persistente
- Vuoi qualcosa di semplice e leggero
- Non hai bisogno di un runtime agente completo
- Lavori su sviluppo software (non AI conversazionale generale)

### Quando scegliere Letta

- Vuoi un agente completo con memoria autonoma
- Hai bisogno di memory management avanzato (core eviction, archival)
- Lavori in Python e puoi gestire un'infrastruttura più complessa
- Hai bisogno di memoria per più agenti diversi

---

## Tabella riassuntiva

| Criterio | code-mem | claude-mem | graphify | Claude files | Mem0 | Zep | LangMem | Letta |
|----------|----------|------------|----------|-------------|------|-----|---------|-------|
| **Install** | ⭐⭐⭐ | ⭐⭐ | ⭐⭐ | ⭐⭐⭐ | ⭐⭐ | ⭐ | ⭐ | ⭐ |
| **Offline** | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ ❌ | ✅ | ⚠️ |
| **Privacy** | ✅✅ | ❌ | ✅✅ | ✅✅ | ❌ | ❌ ⚠️ | ✅ | ⚠️ |
| **Costo** | 0€ | API | 0€ | 0€ | € | € | 0€ | 0€ |
| **Multi-agent** | ✅ | ❌ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ |
| **Search** | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | ⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ |
| **Memory types** | 6 kinds | 1 | N/A | 1 | 1 | 3 | 1 | 3 |
| **Auto-mgmt** | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅✅ |
| **API** | CLI | MCP | CLI/MCP | File | REST | REST | Python SDK | REST/WS |
| **Graph** | ✅ | ❌ | ✅✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| **Ecosystem** | Nuovo | Nuovo | Maturo | Nativo | Maturo | Maturo | Grande | Medio |
| **Ideale per** | Sviluppo quotidiano, progetto singolo | Cross-project Claude Code users | Codebase exploration, archaelogy | Dev semplici, utenti Claude | Team, multi-user, organizzazioni | Applicazioni AI, entity extraction | LangChain users, Python stack | Agenti autonomi, ricerca AI |

**Legenda:**
- ⭐⭐⭐ = Eccellente / ⭐⭐ = Buono / ⭐ = Base
- ✅✅ = Eccellente / ✅ = Buono / ❌ = Assente / ⚠️ = Parziale

---

## Conclusione: quale scegliere?

**code-mem è la scelta giusta quando:**
- Vuoi memoria persistente con zero infrastruttura
- Lavori da solo o in team piccolo
- La privacy dei dati è importante
- Usi più agenti (Claude, Codex, Cursor, Pi) e vuoi memoria unificata
- Non vuoi costi ricorrenti

**Non è la scelta giusta quando:**
- Hai bisogno di memoria condivisa tra team (usa Mem0 o Zep)
- Vuoi esplorare una codebase che non conosci (usa graphify)
- Usi solo Claude Code e non vuoi installare nulla (usa Claude file memories)
- Hai bisogno di un agente con memoria autonoma (usa Letta)
- Lavori in un ecosistema Python/LangChain (usa LangMem)
- Vuoi NLP avanzato come entity extraction automatica (usa Zep)

La bellezza di code-mem è che non ti chiude porte: è abbastanza semplice da poterlo provare in 10 secondi, e abbastanza potente da diventare parte del tuo flusso quotidiano. Se un giorno avrai bisogno di qualcosa di più complesso, i dati sono in SQLite — esportabili, portabili, tuoi.

---

## Vedi anche

- **[TEST-COMPARATIVI.md](TEST-COMPARATIVI.md)** — test pratici fianco a fianco: apri due terminali con code-mem e un altro sistema, esegui gli stessi scenari, e vedi con i tuoi occhi la differenza nel ritrovare decisioni, workaround, e informazioni cross-sessione