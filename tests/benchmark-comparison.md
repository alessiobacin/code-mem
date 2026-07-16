# Memory Benchmark: cm vs graphify

Risultati dei benchmark eseguiti il 2026-07-16 14:21:14.

| # | Sistema | Operazione | Tempo (s) | Esito | Dettaglio |
|---|---------|------------|-----------|-------|-----------|
| 1 | cm | init | .104s | ✅ | ok |
| 2 | graphify | pipeline | .252s | ❌ | graph.json found |
| 3 | cm | save_batch_10 | .681s | ✅ | saved 9 entries |
| 4 | graphify | update | .246s | ✅ | graph.json updated |
| 5 | cm | recall_exact | .276s | ✅ | TypeScript found |
| 6 | graphify | query_exact | .161s | ✅ | graph contains TypeScript |
| 7 | cm | recall_fuzzy | .168s | ✅ | trigram match |
| 8 | graphify | explain | .255s | ❌ | explain output |
| 9 | graphify | path | .160s | ✅ | path query |
| 10 | cm | plan | .075s | ✅ | taskKind found |
| 11 | cm | graph_build | .404s | ✅ | 4 nodes |
| 12 | graphify | path_structural | .157s | ✅ | path query |
| 13 | graphify | community_detection | .079s | ✅ | communities: 4 |
| 14 | cm | fts5_search | .066s | ✅ | FTS5 results |
| 15 | graphify | query_multi | .156s | ✅ | multi-concept query |
| 16 | cm | consolidate | .374s | ✅ | consolidate OK |
| 17 | cm | project | .076s | ✅ | MEMORY.md/USER.md |
| 18 | graphify | wiki | .078s | ❌ | wiki not generated |
| 19 | cm | disk_usage | N/As | ✅ | storage: 156KB |
| 20 | graphify | disk_usage | N/As | ✅ | storage: 52KB |

## Storage

| Sistema | Dimensione |
|---------|-----------|
| cm | 156KB |
| graphify | 52KB |
