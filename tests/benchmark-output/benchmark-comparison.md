# Memory Benchmark: cm vs graphify

Risultati dei benchmark eseguiti il 2026-07-20 12:25:52.

| # | Sistema | Operazione | Tempo (s) | Esito | Dettaglio |
|---|---------|------------|-----------|-------|-----------|
| 1 | cm | init | .449s | ✅ | ok |
| 2 | graphify | pipeline | .115s | ❌ | graph.json found |
| 3 | cm | save_batch_10 | .651s | ✅ | saved 4 entries |
| 4 | graphify | update | .311s | ✅ | graph.json updated |
| 5 | cm | recall_exact | .092s | ✅ | TypeScript found |
| 6 | graphify | query_exact | .181s | ✅ | graph contains TypeScript |
| 7 | cm | recall_fuzzy | .092s | ✅ | trigram match |
| 8 | graphify | explain | .185s | ❌ | explain output |
| 9 | graphify | path | .187s | ✅ | path query |
| 10 | cm | plan | .089s | ✅ | taskKind found |
| 11 | cm | graph_build | .478s | ✅ | 4 nodes |
| 12 | graphify | path_structural | .211s | ✅ | path query |
| 13 | graphify | community_detection | .092s | ✅ | communities: 4 |
| 14 | cm | fts5_search | .095s | ✅ | FTS5 results |
| 15 | graphify | query_multi | .193s | ✅ | multi-concept query |
| 16 | cm | consolidate | .413s | ✅ | consolidate OK |
| 17 | cm | project | .086s | ✅ | MEMORY.md/USER.md |
| 18 | graphify | wiki | .093s | ❌ | wiki not generated |
| 19 | cm | disk_usage | N/As | ✅ | storage: 44KB |
| 20 | graphify | disk_usage | N/As | ✅ | storage: 52KB |

## Storage

| Sistema | Dimensione |
|---------|-----------|
| cm | 44KB |
| graphify | 52KB |
