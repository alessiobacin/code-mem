# Benchmark Opinion — LLM Evaluation

## 1. Tabella riassuntiva punti di forza

| Dimensione | Vincitore | Motivazione |
|-----------|-----------|-------------|
| Inizializzazione | cm (0.104s) | graphify fallisce pipeline iniziale |
| Scrittura batch | cm (0.681s per 10) | graphify non ha batch save |
| Recall esatto | graphify (0.161s) | Più veloce di cm (0.276s) |
| Recall fuzzy (typo) | cm (0.168s) | Trigram match unico, graphify non ha |
| Plan/ragionamento | cm (0.075s) | taskKind, graphify non ha |
| Path finding | graphify (0.16s) | BFS su grafo vs cm manuale |
| FTS5 search | cm (0.066s) | graphify non ha FTS5 |
| Query multi-concetto | graphify (0.156s) | cm non ha test diretto |
| Consolidamento | cm (0.374s) | graphify non ha |
| Community detection | graphify (0.079s) | cm non ha |
| Storage | graphify (52KB) | 3x più compatto di cm (156KB) |
| Affidabilità | cm (0 fallimenti) | graphify: 2 test falliti |

## 2. Analisi per dimensione

- **Scrittura**: cm vince per batch strutturati (kind/layer). graphify è solo aggiornamento file.
- **Recall esatto**: graphify più veloce (0.161s vs 0.276s), entrambi PASS.
- **Fuzzy**: cm ha trigram match per typo — graphify non lo supporta.
- **Plan/consolidamento**: cm ha task planning e consolidamento memoria; graphify non ha equivalenti.
- **Path traversal**: graphify fa BFS strutturato su grafo; cm ha path manuale.
- **Community/Cluster**: graphify unico con Louvain community detection.
- **Ricerca**: cm ha FTS5 velocissimo; graphify ha query multi-concetto.
- **Storage**: graphify molto più compatto (52KB vs 156KB).
- **Affidabilità**: cm passa tutti i test; graphify fallisce explain e wiki.

## 3. Verdetto finale

- **Usa cm quando**: vuoi memoria robusta, zero fallimenti, ricerca fuzzy, pianificazione task, consolidamento automatico, FTS5, e batch save strutturati.
- **Usa graphify quando**: vuoi path traversal veloce, community detection, storage compatto, e analisi strutturale della codebase.
- **Usa entrambi**: cm per memoria quotidiana + graphify per esplorazione architetturale profonda — sono complementari.

## 4. Raccomandazioni

- **cm**: aggiungere export GraphML per interoperabilità graphify; migliorare recall con query multi-concetto.
- **graphify**: fixare explain mode e wiki generation; aggiungere salvataggio persistente di alto livello.
