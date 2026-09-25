function gh(g) {
  if (!g.nodes.length) return "Graph empty.\n";
  const d = {};
  for (const n of g.nodes) d[n.id] = { node: n, c: 0, inc: 0, out: 0 };
  for (const e of g.edges) {
    if (d[e.source]) {
      d[e.source].c += 1;
      d[e.source].out += 1;
    }
    if (d[e.target]) {
      d[e.target].c += 1;
      d[e.target].inc += 1;
    }
  }
  const h = Object.values(d)
    .sort((a, b) => b.c - a.c)
    .slice(0, 5);
  const ct = [];
  for (const e of g.edges) {
    const s = g.nodes.find((n) => n.id === e.source);
    const t = g.nodes.find((n) => n.id === e.target);
    if (s && t && s.type !== t.type) ct.push({ s, t, e });
  }
  const tc = {};
  for (const n of g.nodes) tc[n.type] = (tc[n.type] || 0) + 1;
  let o = `${g.nodes.length} nodes, ${g.edges.length} edges\n`;
  o += `Types: ${Object.entries(tc)
    .map(([t, c]) => `${t}: ${c}`)
    .join(", ")}\n`;
  // Provenance breakdown
  const provCounts = { EXTRACTED: 0, INFERRED: 0, AMBIGUOUS: 0 };
  for (const e of g.edges) {
    const p = e.confidence || e.c || "EXTRACTED";
    if (provCounts[p] !== undefined) provCounts[p]++;
  }
  const provParts = Object.entries(provCounts).filter(([, c]) => c > 0).map(([p, c]) => `${p}: ${c}`);
  if (provParts.length) o += `Provenance: ${provParts.join(", ")}\n`;
  o += "\n";
  o += "HUBS:\n";
  for (const x of h) {
    const p = [];
    if (x.out) p.push(`${x.out} out`);
    if (x.inc) p.push(`${x.inc} in`);
    o += `  ${x.node.label} (${x.node.type}) ${p.join(", ")}\n`;
  }
  o += "\nCROSS-TYPE:\n";
  for (const c of ct.slice(0, 8)) {
    const arrow = c.e.confidence === "INFERRED" ? "~~>" : c.e.confidence === "AMBIGUOUS" ? "..>" : "-->";
    o += `  ${c.s.label} (${c.s.type}) ${arrow} ${c.t.label} (${c.t.type}) [${c.e.relation}]\n`;
  }
  o += "\nSUGGESTED:\n";
  if (h.length) o += `  cm gn ${h[0].node.id}\n`;
  if (ct.length) o += `  cm gp ${ct[0].s.id} ${ct[0].t.id}\n`;
  return o;
}

// gl() = lean public help (core memory workflow only). Corollary graphify-lite
// surfaces (graph commands, scan, query, entities, history/digest, sq, import)
// are OSCURED behind --full: see glFull(). Commands still function when called
// directly (API compatibility intact) — only the help listing is gated.
function gl() {
  return `cm - Code-Mem Tool

Usage:
  cm init [--deep] [harness]
  cm setup
  cm update                 (binary self-update from remote)
  cm update --memory        (refresh snapshot)
  cm update --memory --deep (one-command full repository index + LLM relations + 3D graph)
  cm update --memory --clean [--dry-run]   (archive noisy memories)
  cm update --memory --reset               (archive ALL memories, re-scan)
                                           (+ auto-installs missing harness hooks)
  cm serve                                 (open graph through the global local service)
  cm service install|start|status|restart|stop (one per-user service, project-isolated)
  cm projects [list|show|recall|graph]    (global managed-project catalog; cross-project access is explicit)
  cm config list|get|set|unset NAME [value] [--project]  (persistent settings; API keys masked)
  cm jev status|test         (optional Jev classifier; credit alerts)
  cm version
  cm explain
  cm help        (add --full to see all commands)

Memory write commands:
  cm save [--kind k] [--layer l] [--title t] [--summary s] [--confidence n] [--importance n] [--tag tag] [--file path] [--global] [--auto] [--role dev|agent] <text>
  cm add <text>
  cm add-user <text>
  cm replace <match> <new text>
  cm verify <id> [--by verifier]
  cm contest <id> [reason]
  cm rm <match>
  cm archive <id>
  cm touch <id>
  cm link <source> <target> <relation> [weight]
  cm backup [--global]
  cm restore --global [file]

Memory read commands:
  cm ls
  cm ls-user
  cm recent [n]
  cm plan <task>
  cm recall <task> [--level 1|2|3] [--limit n] [--mode keyword|hybrid|semantic|explore] [--scope project|global] [--as-of ISO]
  cm explain <task> [--limit n] [--mode keyword|hybrid|semantic|explore] [--scope project|global] [--as-of ISO]
  cm recall-auto
  cm watch [--interval N] [--daemon]
  cm project
  cm consolidate [--accept-candidates]
  cm mcp           (MCP stdio server: memory tools for MCP harnesses)

Capture layer:
  cm save --auto [--role dev|agent] <text>   record a conversation row (messages)
  cm sq <query> [n]                          search recorded messages

Examples:
  cm save --kind decision --title "Use Vitest" "Vitest is the default test runner"
  cm save --kind procedure --global "Deploy with Docker from the repository .env file"
  cm backup --global
  cm recall "fix flaky tests" --level 2
  cm plan "deploy preview build"
  cm project
  cm help --full`;
}

// glFull() = complete surface incl. the oscured corollary commands.
function glFull() {
  return `${gl()}

[--full] Graph query:
  cm query [--dfs] [--budget N] <question>   BFS (default) or DFS traversal

[--full] Graph commands:
  cm ga <id> <label> <type>
  cm ge <source> <target> <relation> [EXTRACTED|INFERRED|AMBIGUOUS]
  cm gn <id|label>
  cm gp <from> <to> [--dijkstra]
  cm gc [--vacuum]
  cm gx --format [graphml|neo4j|csv|cypher|html|html3d|svg|obsidian]
  cm serve [--foreground] [--port N]       (diagnostic project-local graph server)
  cm service run [--port N]                (foreground global graph service)
  cm gs
  cm gi
  cm report      Narrative graph report (god nodes, surprises, questions) -> memory/GRAPH_REPORT.md
  cm config list|get|set|unset NAME [value] [--project]  Persistent settings (API keys masked; value read from stdin when omitted)
  cm jev status|test [--force]  Optional Jev typed-decision classifier (TYPESAFE_API_KEY)
  cm logic [--force] [--json] [--no-llm]  Plain-language "How it works" map (parts + flows) -> 3D view toggle

[--full] Scan commands:
  cm init --deep             Full repository index, harness integration, semantic pass, projections, 3D HTML
  cm update --memory --deep  Repeat the full workflow after changes
  cm scan --relations [--apply]
  cm scan --deep [--no-ast]

[--full] Semantic:
  cm entities [--limit n] [--msgs] [--apply]   Extract entities from memories (+ optionally conversations)
  cm history [--kind k] [--entity e] [--limit n] [--as-of ISO]  Timeline + digest of memory evolution
  cm digest (alias of history)

[--full] Import commands:
  cm import <source-folder>     Import Markdown knowledge; infer structure and normalize with a local LLM when available
  cm import --graphify <path>   Import graph from graphify
  cm import --claude-mem         Import memories from claude-mem
  cm import --json <path>        Import nodes/edges from JSON

[--full] Harness integration:
  Deep workflow detects Claude Code, Pi, Codex, OpenCode, Gemini, Qwen,
  Copilot, Cursor, and Windsurf; installs hooks + project skill + /cm-update.

[--full] Capture/search:
  cm sq <query> [n]   Full message search (also listed in core help)`;
}
