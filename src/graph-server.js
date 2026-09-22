// Local bridge for the generated 3D graph.
// It keeps provider credentials inside the selected harness CLI and exposes
// only a status check plus a bounded, read-only graph question endpoint.

function graphBridgePort(cwd) {
  const configured = Number.parseInt(process.env.CM_GRAPH_PORT || "", 10);
  if (Number.isInteger(configured) && configured >= 1024 && configured <= 65535) return configured;
  const digest = createHash("sha1").update(resolve(cwd)).digest("hex");
  return 4317 + (Number.parseInt(digest.slice(0, 4), 16) % 1000);
}

function graphBridgeUrl(cwd, port = graphBridgePort(cwd)) {
  return `http://127.0.0.1:${port}`;
}

function graphChatStatus(cwd) {
  const harness = chooseChatHarness(cwd);
  return {
    chatReady: Boolean(harness),
    harness: harness ? { name: harness.name, provider: harness.provider, model: harness.model } : null,
  };
}

async function graphChatContext(d, cwd, question, focus) {
  const recalled = await recallMemories(d, cwd, question, 3, 8, "explore");
  const graph = loadGraphFromStore(d);
  const words = graphQuestionTerms(question);
  const normalizedQuestion = normalizeGraphText(question);
  const rankedSeeds = graph.nodes.map((node) => {
    const label = normalizeGraphText(node.label);
    const id = normalizeGraphText(node.id);
    const type = normalizeGraphText(node.type);
    const sourcePath = normalizeGraphText(node.metadata?.source_path);
    const summary = normalizeGraphText(node.metadata?.summary);
    const haystack = `${id} ${label} ${type} ${sourcePath} ${summary}`;
    let score = 0;
    for (const word of words) {
      if (label.includes(word)) score += 12;
      else if (id.includes(word)) score += 9;
      else if (sourcePath.includes(word)) score += 7;
      else if (summary.includes(word) || type.includes(word)) score += 3;
    }
    if (label && normalizedQuestion.includes(label)) score += 20;
    return { node, score, haystack };
  }).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score);
  const seeds = rankedSeeds.slice(0, 32).map((entry) => entry.node);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const ids = new Set(seeds.map((node) => node.id));
  const focusedId = String(focus?.id || "");
  if (focusedId && nodeById.has(focusedId)) ids.add(focusedId);
  for (const edge of graph.edges) {
    if (ids.has(edge.source)) ids.add(edge.target);
    else if (ids.has(edge.target)) ids.add(edge.source);
  }
  const selectedNodes = [...ids].map((id) => nodeById.get(id)).filter(Boolean).slice(0, 96);
  const sourceCandidates = [...new Map([
    ...rankedSeeds.slice(0, 24).map((entry) => [entry.node.id, entry.node]),
    ...selectedNodes.map((node) => [node.id, node]),
  ]).values()];
  const graphEvidence = sourceCandidates.map((node) => ({
    source_path: node.metadata?.source_path,
    excerpt: graphSourceExcerpt(cwd, node, words),
  })).filter((entry) => entry.excerpt).slice(0, 18);
  const directEvidence = [...graphRepositoryEvidence(cwd, question), ...graphEvidence].slice(0, 32);
  const nodes = selectedNodes.slice(0, 64).map((node) => ({
    id: node.id,
    label: node.label,
    type: node.type,
    community: node.metadata?.community,
    source_path: node.metadata?.source_path,
    summary: node.metadata?.summary,
    source_excerpt: graphSourceExcerpt(cwd, node, words),
  }));
  const edgeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter((edge) => edgeIds.has(edge.source) && edgeIds.has(edge.target)).slice(0, 120).map((edge) => ({
    source: edge.source,
    target: edge.target,
    relation: edge.relation,
    confidence: edge.confidence,
  }));
  return {
    memories: recalled.ranked.map((entry) => ({
      id: entry.row.id,
      kind: entry.row.kind,
      title: entry.row.title,
      summary: entry.row.summary || summarize(entry.row.body),
      body: String(entry.row.body || "").slice(0, 2200),
      score: Number(entry.score || 0).toFixed(3),
      evidence: (entry.evidence || []).slice(0, 6),
    })),
    graph: { nodes, edges },
    direct_evidence: directEvidence,
  };
}

const GRAPH_CHAT_STOP_WORDS = new Set([
  "what", "which", "where", "when", "who", "does", "do", "is", "are", "the", "and", "for", "from", "with",
  "this", "that", "tell", "show", "about", "please", "qual", "quale", "quali", "come", "dove", "quando", "chi", "del", "della", "dei", "degli", "per", "con", "una", "uno", "gli", "che", "sono", "ha", "hanno", "il", "lo", "la", "i", "le", "di", "a", "e", "in",
]);

function normalizeGraphText(value) {
  return String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

function graphQuestionTerms(question) {
  const terms = new Set();
  const tokens = normalizeGraphText(question).match(/[a-z0-9][a-z0-9._:-]{1,}/g) || [];
  for (const token of tokens) {
    if (!GRAPH_CHAT_STOP_WORDS.has(token) && token.length > 1) terms.add(token);
    for (const part of token.split(/[._:-]+/)) {
      if (part.length > 2 && !GRAPH_CHAT_STOP_WORDS.has(part)) terms.add(part);
    }
  }
  return [...terms].slice(0, 36);
}

function graphSourceExcerpt(cwd, node, terms) {
  const sourcePath = String(node?.metadata?.source_path || "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (!sourcePath || sourcePath.startsWith("/") || sourcePath.startsWith("memory/")) return "";
  const root = resolve(cwd);
  const candidate = resolve(root, sourcePath);
  const relativePath = relative(root, candidate);
  if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${sep}`) || relativePath.includes(`${sep}..${sep}`)) return "";
  if (!existsSync(candidate) || !/\.(md|markdown|txt|json|ya?ml|toml|env|js|mjs|ts|tsx|jsx|py|sh|conf|cfg|ini)$/i.test(candidate)) return "";
  let content = "";
  try {
    content = readFileSync(candidate, "utf8").slice(0, 120000);
  } catch {
    return "";
  }
  const normalizedTerms = terms.map(normalizeGraphText).filter(Boolean);
  const lines = content.split(/\r?\n/);
  const hits = [];
  lines.forEach((line, index) => {
    const haystack = normalizeGraphText(line);
    if (!normalizedTerms.some((term) => haystack.includes(term))) return;
    for (let offset = Math.max(0, index - 1); offset <= Math.min(lines.length - 1, index + 1); offset += 1) {
      if (!hits.some((hit) => hit.index === offset)) hits.push({ index: offset, line: lines[offset] });
    }
  });
  return hits.slice(0, 12).map((hit) => hit.line.trim()).filter(Boolean).join("\n").slice(0, 2600);
}

function graphRepositoryEvidence(cwd, question) {
  const root = resolve(cwd);
  const domains = String(question || "").match(/\b[a-z0-9](?:[a-z0-9-]*\.)+[a-z]{2,}\b/gi) || [];
  const terms = graphQuestionTerms(question).filter((term) => term.length > 2);
  if (!domains.length && !terms.length) return [];
  const domainTerms = domains.map(normalizeGraphText);
  const result = [];
  const queue = [root];
  let visitedFiles = 0;
  const ignoredDirectories = new Set([".git", ".cm", "memory", "node_modules", ".venv", "venv", "dist", "build", ".next", ".cache"]);
  while (queue.length && visitedFiles < 2600 && result.length < 24) {
    const current = queue.shift();
    let entries;
    try { entries = readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name) && !entry.name.startsWith(".")) queue.push(fullPath);
        continue;
      }
      if (!entry.isFile() || entry.name.startsWith(".") || !/\.(md|markdown|txt|json|ya?ml|toml|ini|conf|cfg|csv)$/i.test(entry.name)) continue;
      visitedFiles += 1;
      let size = 0;
      try { size = statSync(fullPath).size; } catch { continue; }
      if (size > 512 * 1024) continue;
      let content;
      try { content = readFileSync(fullPath, "utf8"); } catch { continue; }
      const normalized = normalizeGraphText(content);
      const exactDomain = domainTerms.some((domain) => normalized.includes(domain));
      if (!exactDomain && !terms.some((term) => normalized.includes(normalizeGraphText(term)))) continue;
      const lines = content.split(/\r?\n/);
      const matching = [];
      lines.forEach((line, index) => {
        const lineText = normalizeGraphText(line);
        const match = exactDomain
          ? domainTerms.some((domain) => lineText.includes(domain))
          : terms.some((term) => lineText.includes(normalizeGraphText(term)));
        if (!match) return;
        for (let offset = Math.max(0, index - 1); offset <= Math.min(lines.length - 1, index + 1); offset += 1) {
          if (!matching.includes(offset)) matching.push(offset);
        }
      });
      if (!matching.length) continue;
      const relativePath = relative(root, fullPath).replace(/\\/g, "/");
      result.push({ source_path: relativePath, excerpt: matching.slice(0, 14).map((index) => lines[index].trim()).filter(Boolean).join("\n").slice(0, 2800) });
    }
  }
  return result;
}

function graphDeterministicAnswer(question, context) {
  if (!/\b(ip|address|host|server|domain|dns|resolve|resolves|where)\b/i.test(String(question || ""))) return "";
  const domains = String(question || "").match(/\b[a-z0-9](?:[a-z0-9-]*\.)+[a-z]{2,}\b/gi) || [];
  const evidence = (context?.direct_evidence || []).map((entry) => ({
    source: entry.source_path || "project memory",
    text: String(entry.excerpt || ""),
  })).filter((entry) => entry.text);
  const fallbackText = (context?.graph?.nodes || []).map((node) => ({
    source: node.source_path || "graph node",
    text: [node.label, node.summary, node.source_excerpt].filter(Boolean).join("\n"),
  })).filter((entry) => entry.text);
  const candidates = [...evidence, ...fallbackText];
  const ipv4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
  const hasIpv4 = (text) => { ipv4.lastIndex = 0; return ipv4.test(text); };
  const hits = [];
  for (const domain of domains) {
    for (const entry of candidates) {
      for (const line of entry.text.split(/\r?\n/)) {
        if (!normalizeGraphText(line).includes(normalizeGraphText(domain)) || !hasIpv4(line)) continue;
        const ip = line.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)?.[0];
        if (ip) hits.push({ domain, ip, source: entry.source, line: line.trim() });
      }
    }
  }
  const unique = [...new Map(hits.map((hit) => [`${hit.ip}|${hit.source}|${hit.line}`, hit])).values()];
  if (!unique.length) return "";
  return `Evidence for ${domains.join(", ")}:\n${unique.slice(0, 8).map((hit) => `- ${hit.ip} · ${hit.source}\n  ${hit.line}`).join("\n")}`;
}

function graphChatPrompt(question, history, context) {
  const turns = Array.isArray(history) ? history.slice(-8).map((turn) => ({
    role: turn?.role === "assistant" ? "assistant" : "user",
    content: String(turn?.content || "").slice(0, 1200),
  })).filter((turn) => turn.content) : [];
  return [
    "You are the Code-Mem graph assistant.",
    "Answer the user's question using only the supplied project memory and graph context.",
    "Explain uncertainty, distinguish evidence from inference, and cite node labels, relations, memory IDs, or source paths when useful.",
    "Do not modify files, run commands, invent missing facts, or expose credentials.",
    "Return concise plain text in English.",
    `Conversation: ${JSON.stringify(turns)}`,
    `Project context: ${JSON.stringify(context)}`,
    `User question: ${question}`,
  ].join("\n\n");
}

function cleanGraphChatAnswer(raw) {
  return String(raw || "")
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:\[llmproxy\]|\[llmp\]\s+provider\b|credit(?:o)?\s+residuo\s*:)/i.test(line))
    .join("\n")
    .trim();
}

async function answerGraphChat(cwd, request) {
  const status = graphChatStatus(cwd);
  if (!status.chatReady) {
    return { status: 403, body: { error: "Graph chat is unavailable: configure a project harness with an explicit provider." } };
  }
  const question = String(request?.message || request?.question || "").trim().slice(0, 2400);
  if (!question) return { status: 400, body: { error: "A question is required." } };
  const d = od(mp(cwd, SF));
  try {
    const context = await graphChatContext(d, cwd, question, request?.focus);
    const prompt = graphChatPrompt(question, request?.history, context);
    const result = runHarnessPrompt(chooseChatHarness(cwd), prompt, cwd, { timeout: 90000 });
    const deterministic = graphDeterministicAnswer(question, context);
    let answer = cleanGraphChatAnswer(result.raw);
    if ((!answer || /\b(?:unknown|not specified|no memory|cannot determine|no match)\b/i.test(answer)) && deterministic) answer = deterministic;
    if (!answer) return { status: 502, body: { error: result.error || "The configured harness returned no answer (only transport metadata was received)." } };
    const harness = chooseChatHarness(cwd);
    return { status: 200, body: { answer, harness: { name: harness.name, provider: harness.provider, model: harness.model } } };
  } finally {
    d.close();
  }
}

function graphServerJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Cache-Control": "no-store",
  });
  res.end(status === 204 ? "" : JSON.stringify(body));
}

function readRequestBody(req, limit = 256 * 1024) {
  return new Promise((resolveBody, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > limit) {
        reject(new Error("request too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolveBody(body));
    req.on("error", reject);
  });
}

function graphServiceSummary(port) {
  const registry = graphServiceRegistry();
  const projects = managedProjectEntries().map((project) => ({
    id: project.id,
    name: project.name,
    root: project.root,
    memory: existsSync(mp(project.root, SF)),
    updatedAt: project.updatedAt,
  }));
  return { service: "cm-graphd", running: true, port, projects };
}

function graphRequestProject(url, fallbackCwd, globalMode) {
  const result = graphProjectFromRequest(url, fallbackCwd, globalMode);
  if (result.error) {
    return { error: result.error, status: result.unauthorized ? 401 : 400 };
  }
  return { cwd: result.cwd, project: result.project };
}

function createGraphHttpServer(defaultCwd, port, globalMode) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    if (req.method === "OPTIONS") {
      graphServerJson(res, 204, {});
      return;
    }
    try {
      if (req.method === "GET" && url.pathname === "/api/service/status") {
        graphServerJson(res, 200, graphServiceSummary(port));
        return;
      }

      const projectResult = graphRequestProject(url, defaultCwd, globalMode);
      if (projectResult.error && (url.pathname.startsWith("/api/graph/") || url.pathname === "/" || url.pathname.endsWith("graph-3d.html"))) {
        graphServerJson(res, projectResult.status, { error: projectResult.error });
        return;
      }
      const cwd = projectResult.cwd || defaultCwd;
      const graphPath = mp(cwd, "graph-3d.html");

      if (req.method === "GET" && url.pathname === "/api/graph/status") {
        graphServerJson(res, 200, { ...graphChatStatus(cwd), project: projectResult.project?.id || null });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/graph/chat") {
        const raw = await readRequestBody(req);
        let request = {};
        try { request = JSON.parse(raw || "{}"); } catch { graphServerJson(res, 400, { error: "Invalid JSON request." }); return; }
        const result = await answerGraphChat(cwd, request);
        graphServerJson(res, result.status, result.body);
        return;
      }
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/graph-3d.html" || url.pathname === "/memory/graph-3d.html")) {
        if (!existsSync(graphPath)) { graphServerJson(res, 404, { error: "memory/graph-3d.html not found; run cm gx --format 3d." }); return; }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
        const html = readFileSync(graphPath, "utf8")
          .replaceAll(graphServiceUrl(), graphServiceUrl(port))
          .replaceAll(graphBridgeUrl(cwd), graphBridgeUrl(cwd, port));
        res.end(html);
        return;
      }
      graphServerJson(res, 404, { error: "Not found." });
    } catch (error) {
      graphServerJson(res, 500, { error: String(error?.message || error) });
    }
  });
}

async function runGraphServer(cwd, port) {
  const server = createGraphHttpServer(cwd, port, false);
  await new Promise((resolveServer, rejectServer) => {
    server.once("error", rejectServer);
    server.listen(port, "127.0.0.1", resolveServer);
  });
  console.log(`Graph server: ${graphBridgeUrl(cwd, port)}/graph-3d.html`);
  console.log("Chat status is checked live on every graph opening and request.");
  await new Promise((resolveServer) => {
    const stop = () => server.close(() => resolveServer());
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

async function runGraphServiceServer(port = graphServicePort()) {
  const server = createGraphHttpServer("", port, true);
  await new Promise((resolveServer, rejectServer) => {
    server.once("error", rejectServer);
    server.listen(port, "127.0.0.1", resolveServer);
  });
  mkdirSync(graphServiceRoot(), { recursive: true });
  wr(graphServicePidPath(), String(process.pid));
  console.log(`Code-Mem graph service: ${graphServiceUrl(port)}`);
  console.log("Project data is isolated by the registered project token.");
  await new Promise((resolveServer) => {
    const stop = () => server.close(() => {
      try { unlinkSync(graphServicePidPath()); } catch {}
      resolveServer();
    });
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}
