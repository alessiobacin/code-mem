# Memory Benchmark: cm vs graphify

Risultati dei benchmark eseguiti il 2026-08-21 20:35:36.

| # | Sistema | Operazione | Tempo (s) | Esito | Dettaglio |
|---|---------|------------|-----------|-------|-----------|
| 1 | cm | init | .113s | ✅ | ok |
| 2 | graphify | pipeline | .075s | ❌ | graph.json found |
| 3 | cm | save_batch_10 | .627s | ✅ | saved 4 entries |
| 4 | graphify | update | .298s | ✅ | graph.json updated |
| 5 | cm | recall_exact | .094s | ✅ | TypeScript found |
| 6 | graphify | query_exact | .162s | ✅ | graph contains TypeScript |
| 7 | cm | recall_fuzzy | .090s | ✅ | trigram match |
| 8 | graphify | explain | .171s | ❌ | explain output |
| 9 | graphify | path | .170s | ✅ | path query |
| 10 | cm | plan | .085s | ✅ | taskKind found |
| 11 | cm | graph_build | .454s | ✅ | 4 nodes |
| 12 | graphify | path_structural | .162s | ✅ | path query |
| 13 | graphify | community_detection | .075s | ✅ | communities: 4 |
| 14 | cm | fts5_search | .065s | ✅ | FTS5 results |
| 15 | graphify | query_multi | .163s | ✅ | multi-concept query |
| 16 | cm | consolidate | .406s | ✅ | consolidate OK |
| 17 | cm | project | .068s | ✅ | MEMORY.md/USER.md |
| 18 | graphify | wiki | .077s | ❌ | wiki not generated |
| 19 | cm | disk_usage | N/As | ✅ | storage: 44KB |
| 20 | graphify | disk_usage | N/As | ✅ | storage: 52KB |

## Storage

| Sistema | Dimensione |
|---------|-----------|
| cm | 44KB |
| graphify | 52KB |
