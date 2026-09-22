function detectCommunities(g) {
  // Simple Louvain-style community detection on undirected graph
  const nodes = g.nodes || [];
  const edges = g.edges || [];
  if (!nodes.length) return [];

  // Build adjacency with weights
  const adj = {};
  const weights = {};
  for (const n of nodes) {
    adj[n.id] = [];
    weights[n.id] = {};
  }
  for (const e of edges) {
    const w = typeof e.weight === "number" ? e.weight : 1;
    if (adj[e.source]) adj[e.source].push(e.target);
    if (adj[e.target]) adj[e.target].push(e.source);
    weights[e.source] = weights[e.source] || {};
    weights[e.target] = weights[e.target] || {};
    weights[e.source][e.target] = (weights[e.source][e.target] || 0) + w;
    weights[e.target][e.source] = (weights[e.target][e.source] || 0) + w;
  }

  // Initialize: each node in its own community
  const community = {};
  for (const n of nodes) community[n.id] = n.id;

  // Compute total weight (2x because each edge counted twice)
  let m = 0;
  for (const n of nodes) {
    for (const nb of adj[n.id] || []) m += weights[n.id][nb] || 1;
  }

  // Compute degree for each node
  const degree = {};
  for (const n of nodes) {
    degree[n.id] = (adj[n.id] || []).reduce((sum, nb) => sum + (weights[n.id][nb] || 1), 0);
  }

  // Iterative optimization (up to 20 passes). Keep community degree totals
  // incrementally; recomputing them by scanning every node for every neighbor
  // made large repository graphs effectively quadratic.
  const communityTotals = {};
  for (const n of nodes) communityTotals[community[n.id]] = degree[n.id] || 0;
  let changed = true;
  let maxPasses = 20;
  while (changed && maxPasses-- > 0) {
    changed = false;
    for (const n of nodes) {
      const curComm = community[n.id];
      const neighbors = adj[n.id] || [];
      if (!neighbors.length) continue;

      // Compute weight from n to its current community
      const commWeights = {};
      for (const nb of neighbors) {
        const w = weights[n.id][nb] || 1;
        const nbComm = community[nb];
        commWeights[nbComm] = (commWeights[nbComm] || 0) + w;
      }

      // Compute modularity gain for moving to each neighbor's community
      let bestComm = curComm;
      let bestGain = 0;
      const ki = degree[n.id];

      for (const nb of neighbors) {
        const targetComm = community[nb];
        if (targetComm === curComm) continue;

        const sigmaTot = communityTotals[targetComm] || 0;
        const kiIn = commWeights[targetComm] || 0;
        const gain = 2 * kiIn - (ki * sigmaTot) / (m || 1);

        if (gain > bestGain) {
          bestGain = gain;
          bestComm = targetComm;
        }
      }

      if (bestComm !== curComm) {
        community[n.id] = bestComm;
        communityTotals[curComm] = (communityTotals[curComm] || 0) - ki;
        communityTotals[bestComm] = (communityTotals[bestComm] || 0) + ki;
        changed = true;
      }
    }
  }

  // Assign community IDs and compress
  const commMap = {};
  let commIndex = 0;
  const result = [];
  for (const n of nodes) {
    const cid = community[n.id];
    if (commMap[cid] === undefined) commMap[cid] = commIndex++;
    result.push({
      id: n.id,
      label: n.label,
      type: n.type,
      community: commMap[cid],
    });
  }
  return result;
}

// ─── Narrative graph report (graphify GRAPH_REPORT.md parity) ─────────────
// Deterministic: god nodes (degree), surprising connections (edges crossing
// community boundaries, INFERRED first), suggested questions (hub + bridge
// templates). Renders to stdout and persists memory/GRAPH_REPORT.md.
function graphNodeLocation(node) {
  const meta = node?.metadata || {};
  const loc = String(meta.source_location || "").trim();
  const path = String(meta.source_path || "").trim();
  if (path && loc) return `${path} ${loc}`;
  return path || loc || "";
}
function buildGraphReport(g, cwd) {
  const nodes = g.nodes || [];
  const edges = g.edges || [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const degree = new Map();
  for (const n of nodes) degree.set(n.id, 0);
  for (const e of edges) {
    if (degree.has(e.source)) degree.set(e.source, degree.get(e.source) + 1);
    if (degree.has(e.target)) degree.set(e.target, degree.get(e.target) + 1);
  }
  const commOf = new Map();
  try {
    for (const ci of detectCommunities({ nodes, edges })) commOf.set(ci.id, ci.community);
  } catch {}
  // God nodes skip scaffolding (project/directory/technology): the core
  // abstractions are code symbols, modules and seen elements — like graphify.
  const SCAFFOLD = new Set(["project", "project-directory", "directory", "technology", "tool"]);
  const gods = [...nodes]
    .map((n) => ({ node: n, degree: degree.get(n.id) || 0 }))
    .filter((x) => x.degree > 0 && !SCAFFOLD.has(x.node.type))
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 6);
  // Containment (defines/contains/parsed_as) is trivial, never surprising.
  const TRIVIAL = new Set(["defines", "contains", "parsed_as", "represents"]);
  const surprises = [...edges]
    .filter((e) => !TRIVIAL.has(e.relation))
    .map((e) => {
      const cs = commOf.get(e.source);
      const ct = commOf.get(e.target);
      const crosses = cs !== undefined && ct !== undefined && cs !== ct;
      return { edge: e, crosses, inferred: (e.confidence || "") === "INFERRED" };
    })
    .filter((x) => x.crosses)
    // Cross-community INFERRED edges first: the non-obvious bridges.
    .sort((a, b) => Number(b.inferred) - Number(a.inferred))
    .slice(0, 6);
  const prov = { EXTRACTED: 0, INFERRED: 0, AMBIGUOUS: 0 };
  for (const e of edges) { const p = e.confidence || "EXTRACTED"; if (prov[p] !== undefined) prov[p] += 1; }
  const lines = [];
  lines.push(`# Graph Report — ${basename(cwd)} (${nowIso().slice(0, 10)})`, "");
  lines.push("## Summary");
  lines.push(`- ${nodes.length} nodes · ${edges.length} edges · ${new Set(commOf.values()).size} communities`);
  const provParts = Object.entries(prov).filter(([, n]) => n > 0).map(([p, n]) => `${p}: ${n}`);
  if (provParts.length) lines.push(`- Provenance: ${provParts.join(", ")}`);
  lines.push("");
  lines.push("## God Nodes (most connected — core abstractions)");
  if (!gods.length) lines.push("- _No connected nodes yet._");
  for (const { node, degree: deg } of gods) {
    const loc = graphNodeLocation(node);
    lines.push(`- \`${node.label}\` (${node.type}) — ${deg} edges${loc ? ` · ${loc}` : ""}`);
  }
  lines.push("");
  lines.push("## Surprising Connections (cross-community bridges)");
  if (!surprises.length) lines.push("- _No cross-community edges yet._");
  for (const { edge: e } of surprises) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    const arrow = e.confidence === "INFERRED" ? "~~>" : "-->";
    lines.push(`- \`${s?.label || e.source}\` ${arrow} \`${t?.label || e.target}\` [${e.relation}] [${e.confidence || "EXTRACTED"}]`);
  }
  lines.push("");
  lines.push("## Suggested Questions");
  const questions = [];
  if (gods[0]) questions.push(`What depends on \`${gods[0].node.label}\`? (cm query "${gods[0].node.label}")`);
  if (surprises[0]) {
    const s = byId.get(surprises[0].edge.source);
    const t = byId.get(surprises[0].edge.target);
    questions.push(`How does \`${s?.label}\` reach \`${t?.label}\`? (cm gp "${s?.label || surprises[0].edge.source}" "${t?.label || surprises[0].edge.target}")`);
  }
  if (gods[1]) questions.push(`What is \`${gods[1].node.label}\` connected to? (cm gn "${gods[1].node.label}")`);
  if (!questions.length) questions.push("_Save memories and scan code first (`cm save …`, `cm scan --deep`)._");
  for (const q of questions) lines.push(`- ${q}`);
  lines.push("");
  const eff = (() => { try { return queryEfficiency(g, cwd); } catch { return null; } })();
  if (eff) {
    lines.push("## Token Efficiency (per-query, vs naive full-corpus dump)");
    lines.push(`- Corpus: ~${eff.naive_tokens} tokens naive · answer: ~${eff.answer_tokens} tokens · **${eff.reduction_x}x fewer tokens per query**`);
    lines.push("");
  }
  return { text: lines.join("\n"), efficiency: eff || null };
}
// Per-query token efficiency — same DEFINITION as graphify's benchmark
// (BFS from matching seeds, depth 3, answer tokens = rendered chars / 4;
// reduction = corpus tokens / answer tokens) but with the REAL corpus size
// instead of graphify's `nodes * 50` estimate, so the number is honest.
const EFFICIENCY_QUESTIONS = [
  "how does authentication work",
  "what is the main entry point",
  "how are errors handled",
  "what connects the data layer to the api",
  "what are the core abstractions",
];
function graphNodeLine(node) {
  const loc = graphNodeLocation(node);
  return `NODE ${node.label} ${node.type}${loc ? ` ${loc}` : ""}`;
}
function queryAnswerTokens(g, question, depth = 3) {
  const nodes = g.nodes || [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const adj = new Map(nodes.map((n) => [n.id, []]));
  for (const e of g.edges || []) {
    if (adj.has(e.source)) adj.get(e.source).push(e.target);
    if (adj.has(e.target)) adj.get(e.target).push(e.source);
  }
  const terms = String(question || "").toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const scored = [];
  for (const n of nodes) {
    const label = String(n.label || "").toLowerCase();
    const score = terms.reduce((s, t) => s + (label.includes(t) ? 1 : 0), 0);
    if (score > 0) scored.push([score, n.id]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  const seeds = scored.slice(0, 3).map((x) => x[1]);
  if (!seeds.length) return 0;
  const visited = new Set(seeds);
  let frontier = new Set(seeds);
  const edgeLines = [];
  for (let d = 0; d < depth; d += 1) {
    const next = new Set();
    for (const nid of frontier) {
      for (const nb of adj.get(nid) || []) {
        if (!visited.has(nb)) {
          next.add(nb);
          const a = byId.get(nid);
          const b = byId.get(nb);
          if (a && b) edgeLines.push(`EDGE ${a.label} -> ${b.label}`);
        }
      }
    }
    next.forEach((x) => visited.add(x));
    frontier = next;
  }
  const lines = [...visited].map((id) => graphNodeLine(byId.get(id))).concat(edgeLines);
  return Math.max(1, Math.round(lines.join("\n").length / 4));
}
function queryEfficiency(g, cwd) {
  const nodes = g.nodes || [];
  const edges = g.edges || [];
  if (!nodes.length) return null;
  let corpusChars = 0;
  // Corpus chars: readable source the graph was built from (code + docs).
  // Walk the project like scanRepositoryInventory but count only.
  const exts = /\.(?:md|markdown|txt|json|ya?ml|toml|js|jsx|mjs|cjs|ts|tsx|py|go|rs|java|rb|php|css|scss|html|sh)$/i;
  let files = 0;
  const walk = (dir, depth) => {
    if (depth > 6 || files > 2000) return;
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith(".") || ["node_modules", "memory", "dist", "build", "coverage", ".next"].includes(e.name)) continue;
      const full = join(dir, e.name);
      try {
        const st = statSync(full);
        if (st.isDirectory()) walk(full, depth + 1);
        else if (st.isFile() && exts.test(e.name) && st.size <= 256 * 1024) {
          files += 1;
          try { corpusChars += readFileSync(full, "utf8").length; } catch {}
        }
      } catch {}
    }
  };
  try { walk(cwd, 0); } catch {}
  if (!corpusChars) return null;
  const naiveTokens = Math.max(1, Math.round(corpusChars / 4));
  // Measure the SAME five sample questions graphify uses, PLUS questions
  // derived from this graph's own top labels — so synthetic corpora (no
  // auth/error terms) still yield real measurements instead of a 1x stub.
  const deg = new Map();
  for (const n of nodes) deg.set(n.id, 0);
  for (const e of edges || []) {
    if (deg.has(e.source)) deg.set(e.source, deg.get(e.source) + 1);
    if (deg.has(e.target)) deg.set(e.target, deg.get(e.target) + 1);
  }
  const top = [...nodes]
    .filter((n) => !new Set(["project", "project-directory", "directory", "technology", "tool"]).has(n.type))
    .sort((a, b) => (deg.get(b.id) || 0) - (deg.get(a.id) || 0))
    .slice(0, 4)
    .map((n) => n.label);
  const questions = [...EFFICIENCY_QUESTIONS];
  if (top[0]) questions.push(`what depends on ${top[0]}`);
  if (top[1]) questions.push(`what is ${top[1]} connected to`);
  if (top[0] && top[1] && top[0] !== top[1]) questions.push(`how does ${top[0]} reach ${top[1]}`);
  const perQuestion = [];
  for (const q of questions) {
    const t = queryAnswerTokens(g, q);
    if (t > 0) perQuestion.push({ question: q, query_tokens: t, reduction_x: Number((naiveTokens / t).toFixed(1)) });
  }
  if (!perQuestion.length) return { corpus_chars: corpusChars, naive_tokens: naiveTokens, answer_tokens: naiveTokens, reduction_x: 1, per_question: [] };
  const answerTokens = Math.max(1, Math.round(perQuestion.reduce((s, p) => s + p.query_tokens, 0) / perQuestion.length));
  return {
    corpus_chars: corpusChars,
    naive_tokens: naiveTokens,
    answer_tokens: answerTokens,
    reduction_x: Number((naiveTokens / answerTokens).toFixed(1)),
    per_question: perQuestion,
  };
}
function writeGraphReport(g, cwd) {
  const { text, efficiency } = buildGraphReport(g, cwd);
  const outPath = join(cwd, "memory", "GRAPH_REPORT.md");
  try { wr(outPath, text.endsWith("\n") ? text : `${text}\n`); } catch {}
  return { text, outPath, efficiency };
}

// ─── Graph export (GraphML) ────────────────────────────────────────────────
function exportGraphML(g, cwd) {
  const nodes = g.nodes || [];
  const edges = g.edges || [];
  const commInfo = detectCommunities(g);
  const commById = {};
  for (const ci of commInfo) commById[ci.id] = ci.community;

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<graphml xmlns="http://graphml.graphdrawing.org/xmlns">\n`;
  xml += `  <key id="label" for="node" attr.name="label" attr.type="string"/>\n`;
  xml += `  <key id="type" for="node" attr.name="type" attr.type="string"/>\n`;
  xml += `  <key id="community" for="node" attr.name="community" attr.type="int"/>\n`;
  xml += `  <key id="relation" for="edge" attr.name="relation" attr.type="string"/>\n`;
  xml += `  <key id="confidence" for="edge" attr.name="confidence" attr.type="string"/>\n`;
  xml += `  <graph id="G" edgedefault="undirected">\n`;
  for (const n of nodes) {
    const comm = commById[n.id] !== undefined ? commById[n.id] : -1;
    xml += `    <node id="${escXml(n.id)}">\n`;
    xml += `      <data key="label">${escXml(n.label)}</data>\n`;
    xml += `      <data key="type">${escXml(n.type)}</data>\n`;
    xml += `      <data key="community">${comm}</data>\n`;
    xml += `    </node>\n`;
  }
  for (const e of edges) {
    xml += `    <edge source="${escXml(e.source)}" target="${escXml(e.target)}">\n`;
    xml += `      <data key="relation">${escXml(e.relation)}</data>\n`;
    xml += `      <data key="confidence">${escXml(e.confidence)}</data>\n`;
    xml += `    </edge>\n`;
  }
  xml += `  </graph>\n</graphml>\n`;
  const outPath = join(cwd, "memory", "graph.graphml");
  wr(outPath, xml);
  return outPath;
}

function escXml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function exportNeo4jCSV(g, cwd) {
  const nodes = g.nodes || [];
  const edges = g.edges || [];
  const nodesPath = join(cwd, "memory", "graph-neo4j-nodes.csv");
  const edgesPath = join(cwd, "memory", "graph-neo4j-edges.csv");
  let nc = "id,label,type\n";
  for (const n of nodes) nc += `${escCsv(n.id)},${escCsv(n.label)},${escCsv(n.type)}\n`;
  wr(nodesPath, nc);
  let ec = "source,target,relation,confidence\n";
  for (const e of edges) ec += `${escCsv(e.source)},${escCsv(e.target)},${escCsv(e.relation)},${escCsv(e.confidence)}\n`;
  wr(edgesPath, ec);
  return { nodesPath, edgesPath };
}

// Cypher import file (graphify `to_cypher` parity): MERGE nodes + edges so
// re-runs never duplicate. Writes memory/cypher.txt for cypher-shell.
function cypherEscape(s) {
  return String(s ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
function exportCypher(g, cwd) {
  const lines = ["// Neo4j Cypher import - generated by cm", ""];
  for (const n of g.nodes || []) {
    const raw = String(n.type || "unknown").replace(/[^A-Za-z0-9_]/g, "") || "Entity";
    const label = /^[A-Za-z]/.test(raw) ? raw[0].toUpperCase() + raw.slice(1) : "Entity";
    lines.push(`MERGE (n:${label} {id: '${cypherEscape(n.id)}', label: '${cypherEscape(n.label || n.id)}'});`);
  }
  lines.push("");
  for (const e of g.edges || []) {
    const rel = (String(e.relation || "RELATED_TO").replace(/[^A-Za-z0-9_]/g, "_") || "RELATED_TO").toUpperCase();
    lines.push(`MATCH (a {id: '${cypherEscape(e.source)}'}), (b {id: '${cypherEscape(e.target)}'}) MERGE (a)-[:${rel} {confidence: '${cypherEscape(e.confidence || "EXTRACTED")}'}]->(b);`);
  }
  const outPath = join(cwd, "memory", "cypher.txt");
  wr(outPath, `${lines.join("\n")}\n`);
  return outPath;
}

function escCsv(s) {
  const str = String(s || "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// The repository graph can contain a large evidence layer: files, headings,
// imported notes, database objects and AST symbols. That layer remains useful
// for memory and provenance, but it is not an infrastructure topology. When
// explicit infrastructure folders exist, HTML exports use one node per
// operational entity and keep the evidence graph available in the store.
function operationalEntityType(node) {
  const sourcePath = String(node?.metadata?.source_path || "").replace(/\\/g, "/").toLowerCase();
  const segments = sourcePath.split("/").filter(Boolean);
  const file = segments[segments.length - 1] || "";
  const parent = segments[segments.length - 2] || "";
  const explicit = new Set(["server", "service", "storage", "database", "application", "container", "host", "vm", "proxy", "network"]);
  const nodeType = String(node?.type || "").toLowerCase();
  if (explicit.has(nodeType)) return nodeType;
  if (!/^(?:knowledge-note|wiki-note|obsidian-note)$/.test(nodeType)) return "";
  if (parent === "servers" && file !== "index.md") return "server";
  if (parent === "apps" && file.endsWith(".md")) return "application";
  if (parent === "databases" && file.endsWith(".md")) return "database";
  if (parent === "storage" && file.endsWith(".md")) return "storage";
  if (/storage[-_ ]?box/.test(file) && file.endsWith(".md")) return "storage";
  if (parent === "services" && file !== "index.md") {
    const label = String(node.label || "").toLowerCase();
    const text = `${label} ${node.metadata?.summary || ""}`.toLowerCase();
    // Keep platform components and administration tools out of the database
    // bucket when their descriptions merely mention the datastore they use.
    if (/^supabase[_-]pg[_-]meta(?:$|[_-])/i.test(label)) return "service";
    if (/\b(?:pgadmin|laby\w*syncer|n8n[- ]worker|postgrest|supabase[-_ ]?(?:rest|meta|pooler|pg[-_ ]?meta)|postgres[-_ ]?meta|supavisor|logflare)\b|^coolify\s*\(/i.test(label)) {
      return /\b(?:pgadmin|laby\w*syncer|n8n[- ]worker)\b|^coolify\s*\(/i.test(label) ? "application" : "service";
    }
    if (/\b(?:postgres(?:ql)?|mongo(?:db)?|redis|mysql|mariadb|mssql|sql server|supabase[-_ ]db|evolution[-_ ]postgres|newbiz\.labirinto|haccpdb)\b|(?:^|[\s/_-])db(?:$|[\s/_-])/i.test(text)) return "database";
    if (/\b(?:minio|storage api|object storage|syncthing)\b/i.test(text)) return "storage";
    if (/\b(?:nginx proxy manager|router[- ]proxy|proxy manager)\b/i.test(text)) return "proxy";
    if (/\b(?:backend|frontend|website|web app|application|app\b|n8n|r2r|article[- ]writer|laby\w*|labirinto[- ]infos|paperclip|evolution api|send[- ](?:api|worker)|youtube gateway|telegram api|whatsapp[- ]translator|memvid)\b/i.test(text)) return "application";
    return "service";
  }
  return "";
}

function graphForVisualization(g) {
  const sourceNodes = g.nodes || [];
  const sourceEdges = g.edges || [];
  const operationalNodes = sourceNodes
    .map((node) => ({ node, operationalType: operationalEntityType(node) }))
    .filter((item) => item.operationalType)
    .map(({ node, operationalType }) => ({
      ...node,
      type: operationalType,
      metadata: { ...(node.metadata || {}), graph_layer: "operational", operational_type: operationalType },
    }));

  // Keep the normal repository graph for app/library repositories that do not
  // declare an infrastructure inventory. This projection is intentionally
  // activated only when at least two operational entities are present.
  if (operationalNodes.length < 2) return { nodes: sourceNodes, edges: sourceEdges, mode: "repository" };

  const selected = new Set(operationalNodes.map((node) => node.id));
  const seenEdges = new Set();
  const operationalEdges = sourceEdges.filter((edge) => {
    if (!selected.has(edge.source) || !selected.has(edge.target)) return false;
    if (["contains", "represents"].includes(edge.relation)) return false;
    const key = `${edge.source}|${edge.target}|${edge.relation}`;
    if (seenEdges.has(key)) return false;
    seenEdges.add(key);
    return true;
  });
  const visualGraph = { nodes: operationalNodes, edges: operationalEdges };
  const communities = detectCommunities(visualGraph);
  const communityById = new Map(communities.map((item) => [item.id, item.community]));
  return {
    nodes: operationalNodes.map((node) => ({
      ...node,
      metadata: { ...node.metadata, community: communityById.get(node.id) ?? -1 },
    })),
    edges: operationalEdges,
    mode: "operational",
  };
}

function exportHTML(g, cwd) {
  const visual = graphForVisualization(g);
  const nodes = visual.nodes || [];
  const edges = visual.edges || [];
  const commInfo = detectCommunities(visual);
  const commById = {};
  const commColors = ["#e74c3c","#3498db","#2ecc71","#f39c12","#9b59b6","#1abc9c","#e67e22","#34495e","#fd79a8","#00cec9","#6c5ce7","#ffeaa7"];
  for (const ci of commInfo) commById[ci.id] = ci.community;
  const nodeItems = nodes.map(n => {
    const comm = commById[n.id] !== undefined ? commById[n.id] : -1;
    const color = commColors[comm % commColors.length] || "#ccc";
    return `{id:"${escJs(n.id)}",label:"${escJs(n.label)}",type:"${escJs(n.type)}",comm:${comm},color:"${color}"}`;
  }).join(",\n    ");
  const edgeItems = edges.map(e =>
    `{source:"${escJs(e.source)}",target:"${escJs(e.target)}",relation:"${escJs(e.relation)}"}`
  ).join(",\n    ");
  const communitySummary = {};
  for (const ci of commInfo) {
    if (!communitySummary[ci.community]) communitySummary[ci.community] = [];
    communitySummary[ci.community].push(ci.label);
  }
  const commHtml = Object.entries(communitySummary).map(([cid, members]) =>
    `<li><b>Community ${cid}</b> (${members.length}): ${members.slice(0, 8).join(", ")}${members.length > 8 ? ", ..." : ""}</li>`
  ).join("\n    ");

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>cm - Knowledge Graph</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#f5f5f5;padding:20px}
h1{margin-bottom:10px;color:#333}.stats{color:#666;margin-bottom:20px}
#graph{border:1px solid #ddd;border-radius:8px;background:#fff;overflow:hidden;position:relative;width:100%;height:600px}
.communities{background:#fff;border:1px solid #ddd;border-radius:8px;padding:20px;margin-top:20px}
.communities h2{margin-bottom:10px}.communities ul{list-style:none}.communities li{padding:4px 0;color:#555}
</style></head>
<body>
<h1>cm ${visual.mode === "operational" ? "Operational Infrastructure Graph" : "Knowledge Graph"}</h1>
<p class="stats">${nodes.length} nodes, ${edges.length} edges, ${Object.keys(communitySummary).length} communities</p>
<div id="graph"></div>
<div class="communities"><h2>Communities</h2><ul>${commHtml}</ul></div>
<script src="https://d3js.org/d3.v7.min.js"></script>
<script>
const width = document.getElementById('graph').clientWidth;
const height = 600;
const svg = d3.select("#graph").append("svg").attr("width",width).attr("height",height);
svg.append("defs").append("marker").attr("id","arrow").attr("viewBox","0 -5 10 10").attr("refX",20).attr("refY",0)
  .attr("markerWidth",6).attr("markerHeight",6).attr("orient","auto")
  .append("path").attr("d","M0,-5L10,0L0,5").attr("fill","#999");
const nodesData = [${nodeItems}];
const edgesData = [${edgeItems}];
const sim = d3.forceSimulation(nodesData).force("link",d3.forceLink(edgesData).id(d=>d.id).distance(120))
  .force("charge",d3.forceManyBody().strength(-200)).force("center",d3.forceCenter(width/2,height/2));
const link = svg.selectAll("line").data(edgesData).join("line").attr("stroke","#999").attr("stroke-width",1).attr("marker-end","url(#arrow)");
const node = svg.selectAll("g").data(nodesData).join("g").call(d3.drag().on("start",(e,d)=>{if(!e.active)sim.alphaTarget(0.3).restart();d.fx=d.x;d.fy=d.y;}).on("drag",(e,d)=>{d.fx=e.x;d.fy=e.y;}).on("end",(e,d)=>{if(!e.active)sim.alphaTarget(0);d.fx=null;d.fy=null;}));
node.append("circle").attr("r",8).attr("fill",d=>d.color).attr("stroke","#fff").attr("stroke-width",2);
node.append("text").text(d=>d.label).attr("x",12).attr("y",4).attr("font-size","12px").attr("fill","#333");
sim.on("tick",()=>{link.attr("x1",d=>d.source.x).attr("y1",d=>d.source.y).attr("x2",d=>d.target.x).attr("y2",d=>d.target.y);
  node.attr("transform",d=>"translate("+d.x+","+d.y+")");});
</script></body></html>`;
  const outPath = join(cwd, "memory", "graph.html");
  wr(outPath, html);
  return outPath;
}

function export3DHTML(g, cwd) {
  const graphProject = registerGraphProject(cwd);
  const visual = graphForVisualization(g);
  const visualEdges = (visual.edges || []).filter((edge) =>
    (visual.nodes || []).some((node) => node.id === edge.source) && (visual.nodes || []).some((node) => node.id === edge.target)
  );
  const degreeById = new Map((visual.nodes || []).map((node) => [node.id, 0]));
  for (const edge of visualEdges) {
    degreeById.set(edge.source, (degreeById.get(edge.source) || 0) + 1);
    degreeById.set(edge.target, (degreeById.get(edge.target) || 0) + 1);
  }
  const nodes = (visual.nodes || []).map((node, index) => ({
    id: node.id,
    label: node.label || node.id,
    type: node.type || "unknown",
    metadata: node.metadata || {},
    community: node.metadata?.community ?? -1,
    degree: degreeById.get(node.id) || 0,
    index,
  }));
  const edges = visualEdges.map((edge) => ({
    source: edge.source,
    target: edge.target,
    relation: edge.relation || "related_to",
    confidence: edge.confidence || "EXTRACTED",
    metadata: edge.metadata || {},
  })).filter((edge) => nodes.some((node) => node.id === edge.source) && nodes.some((node) => node.id === edge.target));
  const payload = JSON.stringify({
    mode: visual.mode,
    nodes,
    edges,
    evidenceNodes: (g.nodes || []).length,
    evidenceEdges: (g.edges || []).length,
  }).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  const typeColors = {
    project: "#f6c453", "project-directory": "#f6c453", server: "#fb7185", service: "#fda4af", storage: "#38bdf8", database: "#a78bfa", application: "#34d399", container: "#fbbf24", proxy: "#22d3ee", directory: "#eaa94a", document: "#7dd3fc",
    "knowledge-note": "#67e8f9", "wiki-note": "#67e8f9", "obsidian-note": "#67e8f9", section: "#a7f3d0",
    "code-file": "#c4b5fd", file: "#c4b5fd", function: "#fda4af", class: "#fb7185", module: "#f0abfc",
    configuration: "#fde68a", technology: "#86efac", asset: "#fdba74", default: "#94a3b8",
  };
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Code-Mem 3D Knowledge Graph</title>
<style>
:root{color-scheme:dark;--bg:#07111f;--panel:rgba(11,24,42,.92);--line:rgba(148,163,184,.22);--muted:#94a3b8;--text:#e5eefb;--accent:#67e8f9}
*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:radial-gradient(circle at 50% 15%,#10243d 0,#07111f 55%,#040a13 100%);font:13px/1.4 Inter,ui-sans-serif,system-ui,sans-serif;color:var(--text)}
#scene{position:fixed;inset:0}canvas{display:block}#top{position:fixed;top:16px;left:18px;right:18px;display:flex;align-items:center;gap:12px;pointer-events:none}#top>*{pointer-events:auto}
h1{font-size:16px;letter-spacing:.02em;margin:0 8px 0 0;color:#f8fafc;white-space:nowrap}#stats{color:var(--muted);white-space:nowrap}.search{margin-left:auto;width:min(320px,35vw);border:1px solid var(--line);background:var(--panel);color:var(--text);border-radius:8px;padding:9px 11px;outline:none}.search:focus{border-color:var(--accent)}button{border:1px solid var(--line);background:#12243a;color:var(--text);border-radius:7px;padding:8px 11px;cursor:pointer}button:hover{border-color:var(--accent);color:#fff}
#side{--side-width:min(360px,32vw);position:fixed;top:68px;right:16px;width:var(--side-width);max-height:calc(100vh - 86px);overflow:auto;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px 14px 16px;backdrop-filter:blur(14px);box-shadow:0 18px 60px #0007;z-index:20;transition:width .22s ease,padding .22s ease}#side.empty{color:var(--muted)}#side.collapsed{width:164px;padding:8px 10px}#side-toggle{width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;border:0;background:transparent;padding:2px 0 8px;color:#e2e8f0;text-align:left;cursor:pointer}#side-toggle strong{font-size:11px;text-transform:uppercase;letter-spacing:.08em}#side-toggle span{color:var(--accent);font-size:15px;line-height:1;transition:transform .2s ease}#side.collapsed #side-toggle{padding-bottom:0}#side.collapsed #side-toggle span{transform:rotate(-90deg)}#side.collapsed .side-content{display:none}#side h2{font-size:17px;margin:0 0 4px;color:#f8fafc;overflow-wrap:anywhere}#side .kind{color:var(--accent);font-size:11px;text-transform:uppercase;letter-spacing:.08em}#side .id{font-family:ui-monospace,monospace;font-size:11px;color:var(--muted);overflow-wrap:anywhere;margin:8px 0 12px}.kv{display:grid;grid-template-columns:92px minmax(0,1fr);gap:6px 10px;border-top:1px solid var(--line);padding-top:10px}.kv b{color:var(--muted);font-weight:500}.kv span{overflow-wrap:anywhere}.relations{margin:14px 0 0;padding:12px 0 0;border-top:1px solid var(--line)}.relations h3{margin:0 0 7px;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}.relations div{padding:5px 0;border-bottom:1px solid rgba(148,163,184,.1);overflow-wrap:anywhere}.relations em{font-style:normal;color:var(--accent);font-size:11px}
#chat{--side-width:min(360px,32vw);position:fixed;left:calc((100vw - var(--side-width))/2);bottom:16px;top:auto;transform:translateX(-50%);width:min(520px,calc(100vw - var(--side-width) - 56px));height:min(520px,56vh);min-height:210px;max-height:calc(100vh - 112px);display:flex;flex-direction:column;background:rgba(8,19,34,.97);border:1px solid rgba(103,232,249,.35);border-radius:14px;overflow:hidden;backdrop-filter:blur(16px);box-shadow:0 20px 70px #0009;z-index:15}#chat::after{content:'drag header · resize ↗';position:absolute;right:11px;top:3px;color:#5e7892;font-size:9px;pointer-events:none}#chat-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 28px 12px 14px;border-bottom:1px solid var(--line);cursor:grab;user-select:none}#chat-head:active{cursor:grabbing}#chat-head strong{font-size:13px;color:#f8fafc}#chat-provider{font-size:10px;color:var(--accent);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#chat-resize{position:absolute;top:0;right:0;width:22px;height:22px;cursor:nwse-resize;z-index:2}#chat-resize::after{content:'';position:absolute;top:5px;right:5px;width:8px;height:8px;border-top:2px solid var(--accent);border-right:2px solid var(--accent);opacity:.8}#chat-log{min-height:0;flex:1;overflow:auto;padding:12px 14px;display:flex;flex-direction:column;gap:9px}.chat-message{max-width:92%;padding:8px 10px;border-radius:9px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}.chat-message.user{align-self:flex-end;background:#16455b;color:#e0f2fe}.chat-message.assistant{align-self:flex-start;background:#12243a;color:#dbeafe}.chat-message.pending{opacity:.65;font-style:italic}.chat-form{display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--line)}#chat-input{min-width:0;flex:1;resize:none;border:1px solid var(--line);border-radius:8px;background:#091626;color:var(--text);padding:8px;font:12px/1.35 ui-sans-serif,system-ui,sans-serif;outline:none}#chat-input:focus{border-color:var(--accent)}#chat-submit{align-self:stretch;padding:7px 10px;background:#155e75;border-color:#2dd4bf}#chat-submit:disabled{opacity:.5;cursor:wait}.chat-foot{padding:0 12px 9px;color:#71839a;font-size:10px}
#filters{position:fixed;top:66px;left:16px;width:min(230px,30vw);background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 11px;color:var(--muted);backdrop-filter:blur(14px);z-index:18}.panel-title{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#e2e8f0;margin-bottom:7px}.category-list{display:grid;grid-template-columns:1fr;gap:5px}.category-filter{display:flex;align-items:center;justify-content:flex-start;gap:7px;width:100%;padding:5px 7px;font-size:11px;background:#12243a;border-color:var(--line);color:#dbeafe;text-align:left}.category-filter.off{opacity:.38;text-decoration:line-through}.category-filter .dot{display:block;width:8px;height:8px;border-radius:50%;flex:0 0 auto;box-shadow:0 0 7px var(--dot-color)}.category-filter small{margin-left:auto;color:#71839a;font-size:10px}.category-all{margin-top:7px;width:100%;padding:5px;font-size:10px;color:var(--muted)}
#controls{position:fixed;bottom:16px;left:16px;width:min(360px,calc(100vw - 32px));background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:8px 10px;color:var(--muted);backdrop-filter:blur(14px);z-index:18}#controls-toggle{width:100%;display:flex;align-items:center;justify-content:space-between;background:transparent;border:0;padding:1px 0;color:#e2e8f0;text-align:left}#controls-toggle span{color:var(--accent);font-size:16px;line-height:1}#controls-body{padding-top:7px}#controls kbd{font-family:ui-monospace,monospace;color:#dbeafe;background:#172b44;border:1px solid #27415f;border-radius:4px;padding:1px 4px;margin-right:3px}.hint{margin-top:7px;font-size:11px;color:#71839a}
.label{font-size:11px;line-height:1;color:#e5eefb;text-shadow:0 1px 3px #000,0 0 7px #000;white-space:nowrap;pointer-events:none;transform:translate(8px,-50%);opacity:0;visibility:hidden;transition:opacity .24s ease}.label.neighbor{color:var(--node-color,#d8f7ff);background:rgba(3,14,27,.82);border:1px solid var(--node-color,#d8f7ff);border-radius:4px;padding:2px 4px}.label.search-match{color:var(--node-color,#e5eefb);background:rgba(3,14,27,.96);border:1px solid var(--node-color,#67e8f9);border-radius:4px;padding:2px 5px;font-weight:800;box-shadow:0 0 8px var(--node-color,#67e8f9);opacity:1!important;visibility:visible!important}.label.selected,.label.hovered{color:var(--node-color,#fff)!important;font-weight:800;background:rgba(3,14,27,.96);border:1px solid var(--node-color,#67e8f9);border-radius:5px;padding:3px 6px;text-shadow:0 0 8px var(--node-color,#67e8f9),0 1px 3px #000;opacity:1!important;visibility:visible!important;z-index:20}.label.dim{opacity:.08!important}.macro-label{font-size:12px;line-height:1.15;color:#dbeafe;background:rgba(7,17,31,.82);border:1px solid rgba(103,232,249,.7);border-radius:6px;padding:5px 8px;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;pointer-events:none;transform:translate(-50%,-50%);text-shadow:0 1px 3px #000;box-shadow:0 0 16px rgba(103,232,249,.16);transition:opacity .24s ease}
@media(max-width:850px){#side{--side-width:min(330px,45vw);width:var(--side-width)}#chat{left:12px;right:12px;top:auto;bottom:12px;transform:none;width:auto;height:min(430px,56vh)}#filters{width:min(230px,42vw)}#stats{display:none}.search{width:30vw}}
</style>
<style>
#chat[hidden]{display:none!important}
#chat{left:50%;right:auto;bottom:16px;top:auto;transform:translateX(-50%);width:min(520px,calc(100vw - 32px))}
#chat.collapsed{height:auto!important;min-height:0}
#chat.collapsed #chat-log,#chat.collapsed .chat-form,#chat.collapsed .chat-foot,#chat.collapsed #chat-resize{display:none!important;pointer-events:none}
#chat.collapsed::after{display:none;content:none}
#chat-toggle{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border-radius:6px;background:#102b42;color:var(--accent);font-size:16px;line-height:1}
#chat-toggle:hover{background:#16445c;color:#fff}
#chat-provider{flex:1;min-width:0}
.label{pointer-events:auto;cursor:pointer}
#chat.collapsed{left:50%;top:auto;bottom:16px;transform:translateX(-50%)}
#chat::after{content:none;display:none}
#controls{width:min(230px,30vw)}
#controls-body .nav-command-list{display:flex;flex-direction:column;gap:5px}
#controls-body .nav-command{display:grid;grid-template-columns:max-content minmax(0,1fr);align-items:center;gap:7px;min-height:22px}
#controls-body .nav-command kbd{margin-right:0}
@media(max-width:850px){#chat{left:50%;right:auto;bottom:12px;top:auto;transform:translateX(-50%);width:calc(100vw - 24px)}#controls{width:min(230px,42vw)}}
</style>
</head>
<body>
<div id="scene"></div>
<div id="top"><h1>Code-Mem · 3D Knowledge Graph</h1><span id="stats"></span><input id="search" class="search" placeholder="Search nodes…" aria-label="Search nodes"><button id="reset">Reset view</button></div>
<section id="filters"><div class="panel-title">Visible categories</div><div class="category-list" id="category-filters"></div><button class="category-all" id="category-all" type="button">Show all categories</button></section>
<aside id="side" class="empty"><button id="side-toggle" type="button" aria-expanded="true"><strong>Node details</strong><span>⌃</span></button><div id="side-content" class="side-content">Click a node to inspect its metadata, provenance, and connected relations.</div></aside>
<section id="chat" class="collapsed" hidden><div id="chat-head"><strong>Ask the graph</strong><span id="chat-provider"></span><button id="chat-toggle" type="button" aria-expanded="false" aria-label="Expand chat">＋</button></div><div id="chat-resize" role="presentation" aria-label="Resize chat"></div><div id="chat-log"></div><form class="chat-form" id="chat-form"><textarea id="chat-input" rows="2" placeholder="Ask about this project's memory…" aria-label="Ask the graph"></textarea><button id="chat-submit" type="submit">Ask</button></form><div class="chat-foot">Drag the header to move · drag ↗ to resize · Cmd/Ctrl + Enter to send.</div></section>
<div id="controls"><button id="controls-toggle" type="button" aria-expanded="false"><strong>Navigation</strong><span>⌄</span></button><div id="controls-body" hidden><div class="nav-command-list"><div class="nav-command"><kbd>Mouse drag</kbd><span>rotate</span></div><div class="nav-command"><kbd>Scroll</kbd><span>zoom</span></div><div class="nav-command"><kbd>Right drag</kbd><span>pan</span></div><div class="nav-command"><kbd>Hover</kbd><span>highlight neighborhood</span></div><div class="nav-command"><kbd>Click node</kbd><span>smooth focus</span></div><div class="nav-command"><kbd>Enter</kbd><span>fit search</span></div></div><div class="hint">Hover or click a node to reveal its name, neighbors, and relations. Search matches stay highlighted in the current view; press Enter to fit them.</div></div></div>
<script type="importmap">{"imports":{"three":"https://unpkg.com/three@0.160.0/build/three.module.js","three/addons/":"https://unpkg.com/three@0.160.0/examples/jsm/"}}</script>
<script type="module">
import * as THREE from "three";
import {OrbitControls} from "three/addons/controls/OrbitControls.js";
import {CSS2DRenderer,CSS2DObject} from "three/addons/renderers/CSS2DRenderer.js";
const DATA=${payload};
const COLORS=${JSON.stringify(typeColors)};
document.addEventListener('click',event=>{const label=event.target.closest?.('.label');if(!label)return;const n=DATA.nodes.find(item=>item._label===label);if(!n)return;event.stopPropagation();hovered=null;show(n)},true);
const BRIDGE_URL=${JSON.stringify(graphServiceUrl())};
const GRAPH_PROJECT=${JSON.stringify({ id: graphProject.id, token: graphProject.token })};
function graphApi(path){const url=new URL(path,BRIDGE_URL);url.searchParams.set('project',GRAPH_PROJECT.id);url.searchParams.set('token',GRAPH_PROJECT.token);return url.toString()}
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(55,innerWidth/innerHeight,.1,10000);camera.position.set(0,0,Math.max(34,Math.sqrt(DATA.nodes.length)*9));
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(innerWidth,innerHeight);document.querySelector('#scene').appendChild(renderer.domElement);
const labels=new CSS2DRenderer();labels.setSize(innerWidth,innerHeight);labels.domElement.style.position='fixed';labels.domElement.style.inset='0';labels.domElement.style.pointerEvents='none';document.querySelector('#scene').appendChild(labels.domElement);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.08;controls.minDistance=3;controls.maxDistance=2500;
scene.add(new THREE.AmbientLight(0xffffff,1.3));const key=new THREE.DirectionalLight(0x9ddcff,2);key.position.set(5,8,12);scene.add(key);
const group=new THREE.Group();scene.add(group);const byId=new Map();const nodeDataById=new Map(DATA.nodes.map(n=>[n.id,n]));const meshes=[];const edgeLines=[];const visibleTypes=new Set(DATA.nodes.map(n=>n.type));
const communityIds=[...new Set(DATA.nodes.map(n=>String(n.community??-1)))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
const communityCounts=new Map(communityIds.map(id=>[id,0]));const communityMembers=new Map(communityIds.map(id=>[id,[]]));DATA.nodes.forEach(n=>{const id=String(n.community??-1);communityCounts.set(id,(communityCounts.get(id)||0)+1);communityMembers.get(id)?.push(n)});
const maxCommunitySize=Math.max(...communityCounts.values(),1);const localRadius=Math.max(8,Math.cbrt(maxCommunitySize)*2.6);const macroSide=Math.max(1,Math.ceil(Math.cbrt(communityIds.length)));const macroGap=Math.max(46,localRadius*3.25);const macroCenters=new Map();
communityIds.forEach((id,i)=>{const layer=Math.floor(i/(macroSide*macroSide)),row=Math.floor((i%(macroSide*macroSide))/macroSide),column=i%macroSide,offset=(macroSide-1)/2;macroCenters.set(id,new THREE.Vector3((column-offset)*macroGap,(row-offset)*macroGap,(layer-offset)*macroGap))});
const graphExtent=macroGap*(macroSide-1)/2+localRadius+16;const labelNear=Math.max(12,graphExtent*.10);const labelFar=Math.max(32,graphExtent*.34);camera.position.set(0,0,Math.max(34,graphExtent*2.35));controls.maxDistance=Math.max(2500,graphExtent*12);
function localPos(i,n,r){if(n===1)return new THREE.Vector3();const y=1-(i/(n-1))*2,radial=Math.sqrt(1-y*y),a=Math.PI*(3-Math.sqrt(5))*i;return new THREE.Vector3(Math.cos(a)*radial*r,y*r,Math.sin(a)*radial*r)}
const maxDegree=Math.max(...DATA.nodes.map(n=>Number(n.degree)||0),1);const communityOffsets=new Map(communityIds.map(id=>[id,0]));const nodePositions=new Map();DATA.nodes.forEach(n=>{const communityId=String(n.community??-1),localIndex=communityOffsets.get(communityId)||0;communityOffsets.set(communityId,localIndex+1);const p=macroCenters.get(communityId).clone().add(localPos(localIndex,communityCounts.get(communityId)||1,localRadius));nodePositions.set(n.id,p);const color=COLORS[n.type]||COLORS.default;const baseSize=n.type==='project'?1.25:(n.type==='server'?1.05:(n.type.includes('directory')?0.9:0.62));const degreeFactor=.72+Math.sqrt((Number(n.degree)||0)/maxDegree)*1.55;const size=baseSize*degreeFactor;const mesh=new THREE.Mesh(new THREE.SphereGeometry(size,18,14),new THREE.MeshStandardMaterial({color,emissive:new THREE.Color(color),emissiveIntensity:.12,roughness:.55,transparent:true,opacity:1}));mesh.position.copy(p);mesh.userData={...n,baseSize:size,targetScale:1,targetOpacity:1,targetColor:new THREE.Color(color),targetEmissive:new THREE.Color(color),targetEmissiveIntensity:.12};group.add(mesh);meshes.push(mesh);byId.set(n.id,mesh);const el=document.createElement('div');el.className='label';el.textContent=n.label;el.title=n.label;el.style.setProperty('--node-color',color);const label=new CSS2DObject(el);label.position.set(size,0,0);mesh.add(label);n._label=el});
const clusterTypeNames={server:'Infrastructure',service:'Services',storage:'Storage',database:'Data',application:'Applications',container:'Containers',proxy:'Network',directory:'Directories',document:'Documents',file:'Code and files',function:'Code symbols',class:'Code symbols',module:'Modules',technology:'Technologies'};function macroTitle(id){const members=communityMembers.get(id)||[];const counts=new Map();members.forEach(n=>counts.set(n.type,(counts.get(n.type)||0)+1));const dominant=[...counts.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||'mixed';const names=members.slice().sort((a,b)=>(Number(b.degree)||0)-(Number(a.degree)||0)).slice(0,2).map(n=>String(n.label||n.id)).join(' · ');return (clusterTypeNames[dominant]||'Knowledge')+' · '+(names||('Group '+id))}const macroLabelNear=Math.max(30,graphExtent*.55),macroLabelFar=Math.max(macroLabelNear+1,graphExtent*3.2),macroLabels=new Map();communityIds.forEach(id=>{const el=document.createElement('div');el.className='macro-label';el.textContent=macroTitle(id);el.title=el.textContent;const label=new CSS2DObject(el);label.position.copy(macroCenters.get(id));group.add(label);macroLabels.set(id,{el,center:macroCenters.get(id),community:id})});
const edgeMaterial=new THREE.LineBasicMaterial({color:0x55708d,transparent:true,opacity:.42});DATA.edges.forEach(e=>{const a=nodePositions.get(e.source),b=nodePositions.get(e.target);if(!a||!b)return;const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([a,b]),edgeMaterial.clone());line.userData={...e,targetOpacity:.42,targetColor:new THREE.Color(0x55708d)};group.add(line);edgeLines.push(line)});
const neighborIdsById=new Map(DATA.nodes.map(n=>[n.id,new Set()]));DATA.edges.forEach(e=>{neighborIdsById.get(e.source)?.add(e.target);neighborIdsById.get(e.target)?.add(e.source)});
const ray=new THREE.Raycaster(),pointer=new THREE.Vector2();const labelWorldPosition=new THREE.Vector3();let hovered=null;let selected=null;let gesture=null;let searchQuery='';let searchMatches=new Set();let focus=null;let home={position:camera.position.clone(),target:controls.target.clone()};
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function updateLabels(){const active=selected||hovered;const neighbors=active?neighborIdsById.get(active.id):null;const searching=Boolean(searchQuery);DATA.nodes.forEach(n=>{const mesh=byId.get(n.id);if(!mesh||!n._label)return;const categoryVisible=visibleTypes.has(n.type);labelWorldPosition.copy(mesh.position);const distance=camera.position.distanceTo(labelWorldPosition);const isActive=active?.id===n.id;const isNeighbor=Boolean(neighbors?.has(n.id));const isMatch=searchMatches.has(n.id)&&categoryVisible;const visibility=Math.max(0,Math.min(1,(labelFar-distance)/(labelFar-labelNear)));const showSearchMatch=searching&&isMatch;const visible=categoryVisible&&(isActive||isNeighbor||showSearchMatch||(!searching&&visibility>0));n._label.style.opacity=!categoryVisible?'0':isActive?'1':isNeighbor?'.94':showSearchMatch?'1':searching?'0':String(visibility);n._label.style.visibility=visible?'visible':'hidden';n._label.classList.toggle('search-match',showSearchMatch)});const overview=!selected&&!hovered&&!searching;macroLabels.forEach(({el,center,community})=>{const members=communityMembers.get(community)||[];const categoryVisible=members.some(n=>visibleTypes.has(n.type));const distance=camera.position.distanceTo(center);const visibility=Math.max(0,Math.min(1,(macroLabelFar-distance)/(macroLabelFar-macroLabelNear)));const visible=overview&&categoryVisible&&visibility>0;el.style.opacity=visible?String(visibility):'0';el.style.visibility=visible?'visible':'hidden'})}
function applyHighlight(){const active=selected||hovered;const neighbors=active?neighborIdsById.get(active.id):null;const searching=Boolean(searchQuery);DATA.nodes.forEach(n=>{const mesh=byId.get(n.id);if(!mesh)return;const categoryVisible=visibleTypes.has(n.type);const isActive=active?.id===n.id;const isNeighbor=Boolean(neighbors?.has(n.id));const isMatch=searching&&searchMatches.has(n.id)&&categoryVisible;const nodeColor=COLORS[n.type]||COLORS.default;const u=mesh.userData;u.targetScale=categoryVisible?(isActive?1.45:(isMatch?1.28:(isNeighbor?1.1:((active?.id||searching)?0.6:1)))):0.001;u.targetOpacity=categoryVisible?(isActive?1:(isMatch?1:(isNeighbor?0.9:((active?.id||searching)?0.12:1)))):0;u.targetColor.set(nodeColor);u.targetEmissive.set(nodeColor);u.targetEmissiveIntensity=isActive?0.85:(isMatch?0.62:(isNeighbor?0.35:0.12));n._label?.classList.toggle('hovered',Boolean(!selected&&hovered?.id===n.id&&categoryVisible));n._label?.classList.toggle('selected',Boolean(selected?.id===n.id&&categoryVisible));n._label?.classList.toggle('neighbor',Boolean(isNeighbor&&!isActive&&categoryVisible))});edgeLines.forEach(line=>{const source=nodeDataById.get(line.userData.source),target=nodeDataById.get(line.userData.target);const categoryVisible=Boolean(source&&target&&visibleTypes.has(source.type)&&visibleTypes.has(target.type));const connected=Boolean(active&&categoryVisible&&(line.userData.source===active.id||line.userData.target===active.id));line.userData.targetOpacity=categoryVisible?(connected?0.95:(active?.id?0.06:0.42)):0;line.userData.targetColor.set(connected?0x67e8f9:0x55708d)});updateLabels()}
function animateVisuals(){meshes.forEach(mesh=>{const u=mesh.userData,mat=mesh.material;const scale=mesh.scale.x+(u.targetScale-mesh.scale.x)*.16;mesh.scale.setScalar(scale);mat.opacity+=(u.targetOpacity-mat.opacity)*.16;mat.color.lerp(u.targetColor,.16);mat.emissive.lerp(u.targetEmissive,.16);mat.emissiveIntensity+=(u.targetEmissiveIntensity-mat.emissiveIntensity)*.16});edgeLines.forEach(line=>{const u=line.userData;line.material.opacity+=(u.targetOpacity-line.material.opacity)*.16;line.material.color.lerp(u.targetColor,.16)})}
function focusOnIds(ids,duration=1100){const points=[...ids].map(id=>byId.get(id)?.position).filter(Boolean);if(!points.length)return;const bounds=new THREE.Box3().setFromPoints(points);const center=bounds.getCenter(new THREE.Vector3());const size=bounds.getSize(new THREE.Vector3());const radius=Math.max(3,size.length()/2);const verticalFov=THREE.MathUtils.degToRad(camera.fov);const horizontalFov=2*Math.atan(Math.tan(verticalFov/2)*camera.aspect);const distance=Math.max(8,radius/Math.tan(verticalFov/2),radius/Math.tan(horizontalFov/2))*1.35;const direction=camera.position.clone().sub(controls.target);if(direction.lengthSq()<.001)direction.set(0,0,1);direction.normalize();focus={from:camera.position.clone(),to:center.clone().add(direction.multiplyScalar(distance)),targetFrom:controls.target.clone(),targetTo:center,start:performance.now(),duration}}
function focusNodeAndRelations(n){const ids=new Set([n.id,...(neighborIdsById.get(n.id)||[])]);focusOnIds(ids)}
const sidePanel=document.querySelector('#side'),sideContent=document.querySelector('#side-content'),sideToggle=document.querySelector('#side-toggle');sideToggle.addEventListener('click',()=>{const collapsed=sidePanel.classList.toggle('collapsed');sideToggle.setAttribute('aria-expanded',String(!collapsed));sideToggle.querySelector('span').textContent=collapsed?'⌄':'⌃';keepChatInsideViewport()});
function show(n){selected=n;applyHighlight();const links=DATA.edges.filter(e=>e.source===n.id||e.target===n.id);const metadata=Object.entries(n.metadata||{}).filter(([k,v])=>v!==''&&v!==null&&v!==undefined);sidePanel.classList.remove('empty');sideContent.innerHTML='<div class="kind">'+esc(n.type)+'</div><h2>'+esc(n.label)+'</h2><div class="id">'+esc(n.id)+'</div><div class="kv"><b>Relations</b><span>'+esc(n.degree||links.length)+'</span><b>Community</b><span>'+esc(n.community)+'</span>'+metadata.map(([k,v])=>'<b>'+esc(k)+'</b><span>'+esc(typeof v==='object'?JSON.stringify(v):v)+'</span>').join('')+'</div><div class="relations"><h3>Connected relations · '+links.length+'</h3>'+links.slice(0,80).map(e=>'<div><em>'+esc(e.relation)+'</em> · '+esc(e.source===n.id?(byId.get(e.target)?.userData.label||e.target):(byId.get(e.source)?.userData.label||e.source))+' <small>['+esc(e.confidence)+']</small></div>').join('')+'</div>';focusNodeAndRelations(n)}
function showSearchSummary(results){const relationIds=new Set();results.forEach(n=>neighborIdsById.get(n.id)?.forEach(id=>relationIds.add(id)));sidePanel.classList.remove('empty');sideContent.innerHTML='<div class="kind">SEARCH</div><h2>'+results.length+' matching nodes</h2><div class="id">'+relationIds.size+' connected nodes in view</div><div class="relations"><h3>Matches</h3>'+results.slice(0,80).map(n=>'<div>'+esc(n.label)+' <small>['+esc(n.type)+']</small></div>').join('')+'</div>'}
const chatPanel=document.querySelector('#chat'),chatHead=document.querySelector('#chat-head'),chatToggle=document.querySelector('#chat-toggle'),chatResize=document.querySelector('#chat-resize'),chatLog=document.querySelector('#chat-log'),chatForm=document.querySelector('#chat-form'),chatInput=document.querySelector('#chat-input'),chatSubmit=document.querySelector('#chat-submit'),chatProvider=document.querySelector('#chat-provider'),chatHistory=[];let chatDrag=null,chatResizeState=null;
function clamp(value,min,max){return Math.max(min,Math.min(max,value))}
function chatBounds(width,height){return{minLeft:8,maxLeft:Math.max(8,innerWidth-width-8),minTop:8,maxTop:Math.max(8,innerHeight-height-8)}}
function pinChat(){const rect=chatPanel.getBoundingClientRect();chatPanel.style.left=rect.left+'px';chatPanel.style.top=rect.top+'px';chatPanel.style.bottom='auto';chatPanel.style.transform='none';chatPanel.dataset.positioned='true';return rect}
function keepChatInsideViewport(){if(chatPanel.hidden||chatPanel.dataset.positioned!=='true'||chatPanel.classList.contains('collapsed'))return;const rect=chatPanel.getBoundingClientRect(),bounds=chatBounds(rect.width,rect.height);chatPanel.style.left=clamp(rect.left,bounds.minLeft,bounds.maxLeft)+'px';chatPanel.style.top=clamp(rect.top,bounds.minTop,bounds.maxTop)+'px'}
chatHead.addEventListener('pointerdown',ev=>{if(ev.button!==0||chatPanel.classList.contains('collapsed')||ev.target.closest('#chat-resize')||ev.target.closest('#chat-toggle'))return;const rect=pinChat();chatDrag={pointerId:ev.pointerId,startX:ev.clientX,startY:ev.clientY,left:rect.left,top:rect.top};chatHead.setPointerCapture?.(ev.pointerId);chatHead.classList.add('dragging');ev.preventDefault()});chatHead.addEventListener('pointermove',ev=>{if(!chatDrag||ev.pointerId!==chatDrag.pointerId)return;const bounds=chatBounds(chatPanel.offsetWidth,chatPanel.offsetHeight);chatPanel.style.left=clamp(chatDrag.left+ev.clientX-chatDrag.startX,bounds.minLeft,bounds.maxLeft)+'px';chatPanel.style.top=clamp(chatDrag.top+ev.clientY-chatDrag.startY,bounds.minTop,bounds.maxTop)+'px'});const endChatDrag=ev=>{if(!chatDrag||ev.pointerId!==chatDrag.pointerId)return;chatHead.releasePointerCapture?.(ev.pointerId);chatHead.classList.remove('dragging');chatDrag=null};chatHead.addEventListener('pointerup',endChatDrag);chatHead.addEventListener('pointercancel',endChatDrag);
chatResize.addEventListener('pointerdown',ev=>{if(ev.button!==0)return;const rect=pinChat();chatResizeState={pointerId:ev.pointerId,startX:ev.clientX,startY:ev.clientY,left:rect.left,top:rect.top,width:rect.width,height:rect.height};chatResize.setPointerCapture?.(ev.pointerId);ev.preventDefault();ev.stopPropagation()});chatResize.addEventListener('pointermove',ev=>{if(!chatResizeState||ev.pointerId!==chatResizeState.pointerId)return;const maxWidth=Math.max(320,innerWidth-16);const maxHeight=Math.max(210,innerHeight-16);const width=clamp(chatResizeState.width+ev.clientX-chatResizeState.startX,320,maxWidth);const height=clamp(chatResizeState.height-(ev.clientY-chatResizeState.startY),210,maxHeight);const top=clamp(chatResizeState.top+(ev.clientY-chatResizeState.startY),8,innerHeight-height-8);chatPanel.style.width=width+'px';chatPanel.style.height=height+'px';chatPanel.style.top=top+'px';chatPanel.style.left=clamp(chatResizeState.left,8,innerWidth-width-8)+'px'});const endChatResize=ev=>{if(!chatResizeState||ev.pointerId!==chatResizeState.pointerId)return;chatResize.releasePointerCapture?.(ev.pointerId);chatResizeState=null};chatResize.addEventListener('pointerup',endChatResize);chatResize.addEventListener('pointercancel',endChatResize);
chatToggle.addEventListener('click',ev=>{ev.stopPropagation();const collapsed=!chatPanel.classList.contains('collapsed');if(collapsed){const rect=chatPanel.getBoundingClientRect();chatPanel.dataset.restoreLeft=chatPanel.dataset.positioned==='true'?String(rect.left):'';chatPanel.dataset.restoreTop=chatPanel.dataset.positioned==='true'?String(rect.top):'';chatPanel.classList.add('collapsed');chatPanel.style.left='50%';chatPanel.style.top='auto';chatPanel.style.bottom='16px';chatPanel.style.transform='translateX(-50%)';chatInput.blur()}else{chatPanel.classList.remove('collapsed');if(chatPanel.dataset.restoreLeft){chatPanel.style.left=chatPanel.dataset.restoreLeft+'px';chatPanel.style.top=chatPanel.dataset.restoreTop+'px';chatPanel.style.bottom='auto';chatPanel.style.transform='none';chatPanel.dataset.positioned='true'}else{chatPanel.style.left='';chatPanel.style.top='';chatPanel.style.bottom='';chatPanel.style.transform='';chatPanel.dataset.positioned='false'}delete chatPanel.dataset.restoreLeft;delete chatPanel.dataset.restoreTop}chatToggle.setAttribute('aria-expanded',String(!collapsed));chatToggle.setAttribute('aria-label',collapsed?'Expand chat':'Collapse chat');chatToggle.textContent=collapsed?'＋':'−'});
function addChatMessage(role,text,pending=false){const el=document.createElement('div');el.className='chat-message '+role+(pending?' pending':'');el.textContent=text;chatLog.appendChild(el);chatLog.scrollTop=chatLog.scrollHeight;return el}
async function initGraphChat(){try{const response=await fetch(graphApi('/api/graph/status'),{cache:'no-store'});if(!response.ok)return;const status=await response.json();if(!status.chatReady)return;chatPanel.classList.add('collapsed');chatToggle.setAttribute('aria-expanded','false');chatToggle.setAttribute('aria-label','Expand chat');chatToggle.textContent='＋';chatPanel.hidden=false;chatProvider.textContent=[status.harness?.name,status.harness?.provider,status.harness?.model].filter(Boolean).join(' · ');addChatMessage('assistant','Ask about nodes, relations, provenance, or project memory.')}catch{} }
async function sendGraphChat(ev){ev.preventDefault();const question=chatInput.value.trim();if(!question)return;chatInput.value='';addChatMessage('user',question);chatHistory.push({role:'user',content:question});chatSubmit.disabled=true;const pending=addChatMessage('assistant','Thinking…',true);try{const response=await fetch(graphApi('/api/graph/chat'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:question,history:chatHistory,focus:(selected||hovered)?{id:(selected||hovered).id,label:(selected||hovered).label,type:(selected||hovered).type}:null})});const body=await response.json();pending.classList.remove('pending');pending.textContent=body.answer||body.error||'No answer returned.';chatHistory.push({role:'assistant',content:pending.textContent});if(body.harness)chatProvider.textContent=[body.harness.name,body.harness.provider,body.harness.model].filter(Boolean).join(' · ')}catch(error){pending.classList.remove('pending');pending.textContent='Graph chat is unavailable. Start cm service for this project and try again.'}finally{chatSubmit.disabled=false;chatInput.focus();chatLog.scrollTop=chatLog.scrollHeight}}
chatForm.addEventListener('submit',sendGraphChat);chatInput.addEventListener('keydown',ev=>{if(ev.key==='Enter'&&(ev.metaKey||ev.ctrlKey)){ev.preventDefault();chatForm.requestSubmit()}});initGraphChat();
function animateFocus(){if(!focus)return;const t=Math.min(1,(performance.now()-focus.start)/focus.duration),e=1-Math.pow(1-t,3);camera.position.lerpVectors(focus.from,focus.to,e);controls.target.lerpVectors(focus.targetFrom,focus.targetTo,e);if(t>=1)focus=null}
renderer.domElement.style.cursor='grab';renderer.domElement.addEventListener('pointermove',ev=>{if(gesture&&!gesture.dragged&&((ev.clientX-gesture.x)**2+(ev.clientY-gesture.y)**2)>36)gesture.dragged=true;pointer.x=(ev.clientX/innerWidth)*2-1;pointer.y=-(ev.clientY/innerHeight)*2+1;ray.setFromCamera(pointer,camera);const hit=ray.intersectObjects(meshes)[0];const next=hit?.object.userData||null;if(next?.id!==hovered?.id){hovered=next;applyHighlight()}renderer.domElement.style.cursor=hit?'pointer':'grab'});renderer.domElement.addEventListener('pointerleave',()=>{if(hovered){hovered=null;applyHighlight()}renderer.domElement.style.cursor='grab'});
function clearSelection(){selected=null;hovered=null;applyHighlight();sidePanel.classList.add('empty');sideContent.textContent='Click a node to inspect its metadata, provenance, and connected relations.'}
renderer.domElement.addEventListener('pointerdown',ev=>{gesture={x:ev.clientX,y:ev.clientY,dragged:false}});renderer.domElement.addEventListener('pointercancel',()=>{gesture=null});
renderer.domElement.addEventListener('click',ev=>{if(gesture?.dragged){gesture=null;return}pointer.x=(ev.clientX/innerWidth)*2-1;pointer.y=-(ev.clientY/innerHeight)*2+1;ray.setFromCamera(pointer,camera);const hit=ray.intersectObjects(meshes)[0];if(hit)show(hit.object.userData);if(!hit)clearSelection();gesture=null});
const searchInput=document.querySelector('#search');document.querySelector('#reset').onclick=()=>{focus={from:camera.position.clone(),to:home.position.clone(),targetFrom:controls.target.clone(),targetTo:home.target.clone(),start:performance.now(),duration:1000};searchQuery='';searchMatches=new Set();searchInput.value='';clearSelection()};
function updateSearch(value){searchQuery=String(value||'').toLowerCase().trim();searchMatches=new Set(DATA.nodes.filter(n=>visibleTypes.has(n.type)&&[n.label,n.id,n.type,JSON.stringify(n.metadata||{})].join(' ').toLowerCase().includes(searchQuery)).map(n=>n.id));selected=null;applyHighlight()}
searchInput.addEventListener('input',ev=>updateSearch(ev.target.value));searchInput.addEventListener('keydown',ev=>{if(ev.key!=='Enter')return;ev.preventDefault();const results=DATA.nodes.filter(n=>visibleTypes.has(n.type)&&searchMatches.has(n.id));if(!results.length)return;hovered=null;if(results.length===1){show(results[0]);return}showSearchSummary(results);applyHighlight();const ids=new Set();results.forEach(n=>{ids.add(n.id);neighborIdsById.get(n.id)?.forEach(id=>{if(visibleTypes.has(nodeDataById.get(id)?.type))ids.add(id)})});focusOnIds(ids)});
document.querySelector('#stats').textContent=DATA.nodes.length+' operational nodes · '+DATA.edges.length+' relations · '+communityIds.length+' macro clusters · '+(DATA.evidenceNodes||DATA.nodes.length)+' evidence nodes';const types=[...new Set(DATA.nodes.map(n=>n.type))];const typeCounts=new Map(types.map(type=>[type,DATA.nodes.filter(node=>node.type===type).length]));const categoryFilters=document.querySelector('#category-filters');function renderCategoryFilters(){categoryFilters.innerHTML=types.map(t=>'<button type="button" class="category-filter '+(visibleTypes.has(t)?'':'off')+'" data-category="'+esc(t)+'" aria-pressed="'+visibleTypes.has(t)+'"><i class="dot" style="--dot-color:'+esc(COLORS[t]||COLORS.default)+';background:'+esc(COLORS[t]||COLORS.default)+'"></i><span>'+esc(t)+' <small>'+typeCounts.get(t)+'</small></span></button>').join('');categoryFilters.querySelectorAll('[data-category]').forEach(button=>button.addEventListener('click',()=>{const category=button.dataset.category;if(visibleTypes.has(category))visibleTypes.delete(category);else visibleTypes.add(category);if(selected&&!visibleTypes.has(selected.type))clearSelection();renderCategoryFilters();applyHighlight()}))}document.querySelector('#category-all').addEventListener('click',()=>{types.forEach(type=>visibleTypes.add(type));renderCategoryFilters();applyHighlight()});renderCategoryFilters();const controlsToggle=document.querySelector('#controls-toggle'),controlsBody=document.querySelector('#controls-body');controlsToggle.addEventListener('click',()=>{const open=controlsBody.hidden;controlsBody.hidden=!open;controlsToggle.setAttribute('aria-expanded',String(open));controlsToggle.querySelector('span').textContent=open?'⌃':'⌄'});
function resize(){camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);labels.setSize(innerWidth,innerHeight);keepChatInsideViewport()}addEventListener('resize',resize);applyHighlight();function loop(){requestAnimationFrame(loop);animateFocus();animateVisuals();controls.update();updateLabels();renderer.render(scene,camera);labels.render(scene,camera)}loop();
</script></body></html>`;
  const outPath = join(cwd, "memory", "graph-3d.html");
  wr(outPath, html);
  return outPath;
}

function exportSVG(g, cwd) {
  const nodes = g.nodes || [];
  const edges = g.edges || [];
  const commInfo = detectCommunities(g);
  const commById = {};
  const commColors = ["#e74c3c","#3498db","#2ecc71","#f39c12","#9b59b6","#1abc9c","#e67e22","#34495e"];
  for (const ci of commInfo) commById[ci.id] = ci.community;
  // Simple layered layout: arrange nodes by type in rows
  const types = [...new Set(nodes.map(n => n.type))];
  const layers = {};
  const spacingX = 180, spacingY = 120, marginX = 80, marginY = 60;
  nodes.forEach((n, i) => {
    if (!layers[n.type]) layers[n.type] = [];
    layers[n.type].push(n);
  });
  const positions = {};
  let yPos = marginY;
  for (const t of types) {
    const layerNodes = layers[t] || [];
    const startX = (layerNodes.length > 1) ? (800 - (layerNodes.length - 1) * spacingX) / 2 : 400;
    layerNodes.forEach((n, idx) => { positions[n.id] = { x: startX + idx * spacingX, y: yPos }; });
    yPos += spacingY;
  }
  const H = Math.max(600, types.length * spacingY + marginY * 2);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 ${H}" width="800" height="${H}">\n`;
  svg += `<defs><marker id="arrow" viewBox="0 -5 10 10" refX="20" refY="0" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,-5L10,0L0,5" fill="#999"/></marker></defs>\n`;
  svg += `<rect width="800" height="${H}" fill="#fafafa"/>\n`;
  for (const e of edges) {
    const sp = positions[e.source], tp = positions[e.target];
    if (!sp || !tp) continue;
    svg += `<line x1="${sp.x}" y1="${sp.y}" x2="${tp.x}" y2="${tp.y}" stroke="#bbb" stroke-width="1.5" marker-end="url(#arrow)"/>\n`;
  }
  for (const n of nodes) {
    const pos = positions[n.id];
    if (!pos) continue;
    const comm = commById[n.id] !== undefined ? commById[n.id] : -1;
    const color = commColors[comm % commColors.length] || "#ccc";
    // Add glow effect for hubs
    svg += `<circle cx="${pos.x}" cy="${pos.y}" r="10" fill="${color}" stroke="#fff" stroke-width="2"/>\n`;
    svg += `<text x="${pos.x + 14}" y="${pos.y + 4}" font-family="system-ui" font-size="11" fill="#333">${escXml(n.label)}</text>\n`;
  }
  svg += `</svg>`;
  const outPath = join(cwd, "memory", "graph.svg");
  wr(outPath, svg);
  return outPath;
}

// Obsidian vault export (graphify parity): one note per community +
// _COMMUNITY_* overviews + per-node notes with wiki-links for edges.
function exportObsidian(g, cwd) {
  const nodes = g.nodes || [];
  const edges = g.edges || [];
  const commInfo = detectCommunities(g);
  const commById = {};
  for (const ci of commInfo) commById[ci.id] = ci.community;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const outDir = join(cwd, "memory", "obsidian");
  mkdirSync(outDir, { recursive: true });
  const safeName = (label, id) => `${String(label || id || "node").replace(/[\\/:*?"<>|#^\[\]]/g, "_").slice(0, 80)}-${String(id || "").slice(-6)}`;
  const idToFile = new Map();
  for (const n of nodes) idToFile.set(n.id, `${safeName(n.label, n.id)}.md`);
  const members = new Map();
  for (const n of nodes) {
    const c = commById[n.id] !== undefined ? commById[n.id] : -1;
    if (!members.has(c)) members.set(c, []);
    members.get(c).push(n);
  }
  let written = 0;
  for (const n of nodes) {
    const links = [];
    for (const e of edges) {
      if (e.source === n.id && byId.has(e.target)) links.push(`- ${e.relation || "related"} [[${idToFile.get(e.target).replace(/\.md$/, "")}]]`);
      else if (e.target === n.id && byId.has(e.source)) links.push(`- ${e.relation || "related"} (in) [[${idToFile.get(e.source).replace(/\.md$/, "")}]]`);
    }
    const meta = n.metadata || {};
    const front = ["---", `cm_id: ${n.id}`, `cm_type: ${n.type || "?"}`, `community: ${commById[n.id] !== undefined ? commById[n.id] : -1}`, ...(meta.source_path ? [`source_path: ${meta.source_path}`] : []), "---", ""];
    wr(join(outDir, idToFile.get(n.id)), [...front, `# ${n.label || n.id}`, "", ...(links.length ? ["## Links", "", ...links.slice(0, 60), ""] : ["_No links._", ""]), ...(meta.source_path ? [`\n_Source: \`${meta.source_path}\`_`, ""] : [])].join("\n"));
    written += 1;
  }
  for (const [cid, list] of members) {
    const names = list.slice(0, 40).map((n) => `- [[${idToFile.get(n.id).replace(/\.md$/, "")}]] (${n.type || "?"})`);
    wr(join(outDir, `_COMMUNITY_${cid}.md`), [`# Community ${cid}`, "", `${list.length} node(s).`, "", "## Members", "", ...names, ""].join("\n"));
    written += 1;
  }
  return { dir: outDir, notes: written, communities: members.size };
}

// Per-run cost tracker (graphify parity): tokens/time per deep run.
function recordRunCost(cwd, entry) {
  const costPath = join(cwd, "memory", "cost.json");
  let cost = { runs: [], total_llm_calls: 0, total_media: 0 };
  try { cost = { ...cost, ...JSON.parse(readFileSync(costPath, "utf8")) }; } catch {}
  if (!Array.isArray(cost.runs)) cost.runs = [];
  cost.runs.push({ at: nowIso(), ...entry });
  if (cost.runs.length > 50) cost.runs = cost.runs.slice(-50);
  cost.total_llm_calls = cost.runs.reduce((s, r) => s + (Number(r.llm_calls) || 0), 0);
  cost.total_media = cost.runs.reduce((s, r) => s + (Number(r.media) || 0), 0);
  try { wr(costPath, JSON.stringify(cost, null, 2)); } catch {}
  return costPath;
}

function escJs(s) {
  return String(s || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

// ── Entity extraction (zero-dependency heuristics) ──────────────────────
