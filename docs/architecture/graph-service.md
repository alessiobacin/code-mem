# Global local graph service

Code-Mem uses one optional `cm-graphd` process per user account, not one daemon per repository. The process binds to `127.0.0.1` and serves the generated 3D graph and read-only harness-backed graph chat for every registered project.

## Commands

```bash
cm service install             # install and start the launchd/systemd user service
cm service status              # inspect the local service and registered projects
cm service start
cm service stop
cm service restart
cm service run --port 4804     # foreground diagnostic mode
cm serve                       # register/open the current project's graph
cm serve --foreground          # project-local diagnostic server
cm projects                    # list every registered project
cm projects show <id|path|name>
cm projects recall <id|path|name> "query"   # explicit cross-project recall
cm projects graph <id|path|name>             # explicit cross-project graph
```

The installer runs `cm service install` once. `cm serve` is still useful after a manual source install: it registers the current project, starts the global service if needed, and prints a project-scoped graph URL.

## Isolation contract

Each initialized project is registered in `~/.cm/graphd/projects.json` using a deterministic project id derived from the canonical repository path, a stable local capability token, and the canonical repository root.

Every graph status, graph HTML, and chat request must carry the matching project id and token. The server then opens only `<project-root>/memory/state.db`; it never accepts an arbitrary filesystem path from the browser. Harness detection and harness CLI execution also use that project root, so provider configuration cannot leak across repositories.

The token is a local capability, not a remote API credential. The service is loopback-only and must not be exposed through a reverse proxy without adding an explicit authentication layer.

The registry is also the shared managed-project catalog. Listing the catalog
does not read another project's memory. Cross-project memory or graph access is
an explicit CLI action and is never part of normal project recall.

## Refresh behavior

Harness response hooks already schedule a non-blocking deterministic deep refresh. That refresh rewrites the project's `memory/graph-3d.html`; `cm-graphd` serves the latest file with `Cache-Control: no-store`, so reopening or refreshing the graph sees the current project state. The service does not own project memory and can be restarted without data loss.

## Chat readiness

The graph HTML checks `/api/graph/status` when it opens. The chat panel remains hidden unless the selected project has a detected harness CLI, project configuration for that harness, and an explicit provider signal. A literal provider key, a configured compatible endpoint such as `env.ANTHROPIC_BASE_URL`, or an explicit proxy model counts; credentials are never displayed. Questions are sent to that harness CLI with bounded, read-only graph and memory context.

## Failure modes

- If `cm-graphd` is stopped, the static graph still opens from `memory/graph-3d.html`; only chat is unavailable.
- If launchd/systemd user management is unavailable, `cm service start` falls back to a detached per-user process.
- `cm serve --foreground` remains a project-local diagnostic bridge and is intentionally not the normal lifecycle.
