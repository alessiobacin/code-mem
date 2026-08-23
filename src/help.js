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
  cm init [harness]
  cm setup
  cm update
  cm version
  cm explain
  cm help        (add --full to see all commands)

Memory write commands:
  cm save [--kind k] [--layer l] [--title t] [--summary s] [--confidence n] [--tag tag] [--file path] [--global] [--auto] [--role dev|agent] <text>
  cm add <text>
  cm add-user <text>
  cm replace <match> <new text>
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
  cm recall <task> [--level 1|2|3] [--limit n] [--mode keyword|hybrid|semantic]
  cm explain <task> [--limit n] [--mode keyword|hybrid|semantic]
  cm recall-auto
  cm watch [--interval N] [--daemon]
  cm project
  cm consolidate

Capture layer:
  cm save --auto [--role dev|agent] <text>   record a conversation row (messages)
  cm sq <query> [n]                          search recorded messages

Examples:
  cm save --kind decision --title "Use Vitest" "Vitest is the default test runner"
  cm save --kind procedure --global "Deploy classico: docker sul server dal file .env"
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
  cm query <question>   BFS from keyword-matched nodes

[--full] Graph commands:
  cm ga <id> <label> <type>
  cm ge <source> <target> <relation> [EXTRACTED|INFERRED|AMBIGUOUS]
  cm gn <id|label>
  cm gp <from> <to> [--dijkstra]
  cm gc [--vacuum]
  cm gx [html|graphml|neo4j|svg]
  cm gs
  cm gi

[--full] Scan commands:
  cm scan --relations [--apply]
  cm scan --deep [--no-ast]

[--full] Semantic:
  cm entities [--limit n] [--msgs] [--apply]   Extract entities from memories (+ optionally conversations)
  cm history [--kind k] [--entity e] [--limit n]  Timeline + digest of memory evolution
  cm digest (alias of history)

[--full] Import commands:
  cm import --graphify <path>   Import graph from graphify
  cm import --claude-mem         Import memories from claude-mem
  cm import --json <path>        Import nodes/edges from JSON

[--full] Capture/search:
  cm sq <query> [n]   Full message search (also listed in core help)`;
}

