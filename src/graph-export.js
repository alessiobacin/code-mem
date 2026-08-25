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

  // Iterative optimization (up to 20 passes)
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

        // Sum of total degree in target community
        let totTarget = 0;
        for (const other of nodes) {
          if (community[other.id] === targetComm) totTarget += degree[other.id];
        }

        const sigmaTot = totTarget;
        const kiIn = commWeights[targetComm] || 0;
        const gain = 2 * kiIn - (ki * sigmaTot) / (m || 1);

        if (gain > bestGain) {
          bestGain = gain;
          bestComm = targetComm;
        }
      }

      if (bestComm !== curComm) {
        community[n.id] = bestComm;
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

function escCsv(s) {
  const str = String(s || "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function exportHTML(g, cwd) {
  const nodes = g.nodes || [];
  const edges = g.edges || [];
  const commInfo = detectCommunities(g);
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
<h1>cm Knowledge Graph</h1>
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

function escJs(s) {
  return String(s || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

// ── Entity extraction (zero-dependency heuristics) ──────────────────────
