const TECH_ALIASES = {
  "typescript": "TypeScript", "ts": "TypeScript", "javascript": "JavaScript", "js": "JavaScript",
  "node": "Node.js", "nodejs": "Node.js", "react": "React", "reactjs": "React",
  "nextjs": "Next.js", "next": "Next.js", "angular": "Angular", "vue": "Vue", "svelte": "Svelte",
  "express": "Express", "nestjs": "NestJS", "nest": "NestJS", "hono": "Hono", "fastify": "Fastify",
  "postgresql": "PostgreSQL", "postgres": "PostgreSQL", "mysql": "MySQL", "sqlite": "SQLite",
  "mongodb": "MongoDB", "mongo": "MongoDB", "redis": "Redis", "drizzle": "Drizzle", "prisma": "Prisma",
  "vitest": "Vitest", "jest": "Jest", "playwright": "Playwright", "cypress": "Cypress",
  "docker": "Docker", "kubernetes": "Kubernetes", "k8s": "Kubernetes", "terraform": "Terraform",
  "tailwind": "Tailwind CSS", "bootstrap": "Bootstrap", "graphql": "GraphQL", "grpc": "gRPC",
  "websocket": "WebSocket", "oauth": "OAuth", "oauth2": "OAuth2", "jwt": "JWT", "sso": "SSO",
  "openai": "OpenAI", "claude": "Claude", "gemini": "Gemini", "langchain": "LangChain", "mem0": "Mem0",
  "vercel": "Vercel", "netlify": "Netlify", "aws": "AWS", "gcp": "GCP", "azure": "Azure",
  "python": "Python", "golang": "Go", "javascript": "JavaScript", "rust": "Rust", "java": "Java", "csharp": "C#",
  "flutter": "Flutter", "fastify": "Fastify", "vite": "Vite", "webpack": "Webpack", "esbuild": "esbuild",
  "eslint": "ESLint", "prettier": "Prettier", "npm": "npm", "yarn": "Yarn", "pnpm": "pnpm", "bun": "Bun",
  "github": "GitHub", "gitlab": "GitLab", "bitbucket": "Bitbucket", "mqtt": "MQTT", "kafka": "Kafka",
  "redis": "Redis", "elasticsearch": "Elasticsearch", "nginx": "Nginx", "rabbitmq": "RabbitMQ",
};
const STOPWORDS = new Set([
  "the","this","that","with","from","into","have","your","when","then","than","they","them","will","would","could","should","about","there","their","other","these","those","which","while","because","before","after","both","each","just","more","most","some","such","only","very","also","between","until","during","again","still","once","every","where","why","how","not","can","all","any","are","was","were","been","being","has","had","does","did","doing","made","make","use","used","using","get","gets","got","one","two","set","per","use","api","app","url","http","https","port","user","users","data","json","txt","src","lib","test","tests","dir","file","files","mode","via","etc","eg","ie"
]);
const FILE_EXT_RE = /\b([\w.-]+\.(?:tsx?|jsx?|mjs|cjs|py|go|rs|json|ya?ml|css|scss|html|lock|md|toml|conf|env))(?![\w.-])/g;
const PASCAL_RE = /\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g; // MyComponent style
const CAMEL_RE = /\b[a-z]+(?:[A-Z][a-z]+)+\b/g;      // myWidget style
const ABS_PATH_RE = /(?:^|[\s'"`(])@?[\w.\/\\-]{2,128}\.(?:tsx?|jsx?|py|go|rs|json|ya?ml|css|scss|html)(?=$|[\s'"`,.)])/g;
const KEBAB_RE = /\b[a-z0-9]+(?:[-_][a-z0-9]+){1,}\b/g; // my-thing / my_thing

function techEntities(text) {
  const out = new Map();
  const lower = ` ${String(text || "").toLowerCase().replace(/[^a-z0-9+#.-]/g, " ")} `;
  for (const [key, label] of Object.entries(TECH_ALIASES)) {
    const re = new RegExp(`(^|[^a-z0-9]+)${key}(?=$|[^a-z0-9])`, "i");
    if (re.test(lower)) out.set(label, (out.get(label) || 0) + 1);
  }
  return out;
}

function extractEntities(texts) {
  // Returns Map<name, { category, count, sources:Set }>
  const acc = new Map();
  const add = (name, category, source) => {
    name = String(name || "").trim().replace(/,+$/, "");
    if (!name || name.length < 2 || STOPWORDS.has(name.toLowerCase())) return;
    const key = name.toLowerCase();
    if (!acc.has(key)) acc.set(key, { name, category, count: 0, sources: new Set() });
    const e = acc.get(key);
    e.count += 1;
    if (source) e.sources.add(source);
  };
  for (const { text, source } of texts) {
    if (!text) continue;
    for (const [label] of techEntities(text)) add(label, "tech", source);
    let m;
    FILE_EXT_RE.lastIndex = 0;
    while ((m = FILE_EXT_RE.exec(text))) {
      const file = m[1];
      add(file, file.slice(file.lastIndexOf(".") + 1).startsWith("ts") ? "ts-module" : "file", source);
    }
    const seenPascal = new Set();
    PASCAL_RE.lastIndex = 0;
    while ((m = PASCAL_RE.exec(text))) {
      const w = m[0];
      if (STOPWORDS.has(w.toLowerCase()) || seenPascal.has(w)) continue;
      seenPascal.add(w);
      add(w, "symbol", source);
    }
    CAMEL_RE.lastIndex = 0;
    while ((m = CAMEL_RE.exec(text))) {
      if (STOPWORDS.has(m[0].toLowerCase())) continue;
      add(m[0], m[0] === "recall" ? "cmd" : "symbol", source);
    }
    KEBAB_RE.lastIndex = 0;
    while ((m = KEBAB_RE.exec(text))) {
      const w = m[0];
      if (STOPWORDS.has(w) || /^[0-9]+$/.test(w)) continue;
      if (/^[a-z0-9]+-[a-z0-9]+(-[a-z0-9]+)*$/.test(w) && /^-|_/.test(w)) add(w, "kebab", source);
    }
  }
  return acc;
}

function hashEntityId(name) {
  let h = 2166136261;
  for (let i = 0; i < name.length; i += 1) { h ^= name.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `ent_${(h >>> 0).toString(16)}`;
}

function applyEntitiesToGraph(d, entities, maxNodes = 40) {
  // Upsert all reasonably-listed entity nodes (not just frequent ones), capped to avoid noise
  let created = 0;
  const createdIds = new Set();
  const top = entities.slice(0, maxNodes);
  for (const e of top) {
    const id = hashEntityId(e.name);
    if (upsertGraphNode(d, { id, label: e.name, type: e.category, metadata: { mentions: e.count } })) {
      created += 1;
      createdIds.add(id);
    }
  }
  // Also record already-existing entity nodes so co-occurrence edges only connect real nodes
  const existing = allStmt(d, "SELECT id FROM graph_nodes").map((r) => r.id);
  for (const e of top) existing.push(hashEntityId(e.name));
  return { created, eligibleIds: new Set(existing) };
}

function cooccurrenceEdges(d, texts, eligibleIds, maxEdges = 300) {
  // Add edges only between ANY pair where both endpoints are (or will be) real entity nodes.
  const added = [];
  const seen = new Set();
  const exists = (name) => eligibleIds.has(hashEntityId(name));
  for (const { text } of texts) {
    if (!text) continue;
    const en = new Set();
    for (const [label] of techEntities(text)) en.add(label);
    FILE_EXT_RE.lastIndex = 0; let m;
    while ((m = FILE_EXT_RE.exec(text))) en.add(m[1]);
    PASCAL_RE.lastIndex = 0;
    while ((m = PASCAL_RE.exec(text))) if (!STOPWORDS.has(m[0].toLowerCase())) en.add(m[0]);
    const arr = [...en];
    for (let i = 0; i < arr.length; i += 1) {
      for (let j = i + 1; j < arr.length; j += 1) {
        const a = arr[i], b = arr[j];
        if (!exists(a) || !exists(b)) continue;
        const key = `${a}|${b}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (upsertGraphEdge(d, {
          source: hashEntityId(a),
          target: hashEntityId(b),
          relation: "co_occurs",
          confidence: "INFERRED",
          metadata: {},
        })) added.push(`${a}<->${b}`);
        if (added.length >= maxEdges) return added;
      }
    }
  }
  return added;
}

function cmdEntities(d, c, args) {
  const { flags } = parseArgs(args);
  const limit = Number.parseInt(String(flags.limit || "20"), 10) || 20;
  const sourceFilter = flags.source ? String(flags.source).split(",").map((s) => s.trim()).filter(Boolean) : null;
  const includeMsgs = flags.msgs === true;
  const rows = allStmt(d, "SELECT id,title,body FROM memory_items WHERE status='active'");
  const texts = rows.map((r) => ({ text: `${r.title}\n${r.body}`, source: r.id }));
  if (includeMsgs) {
    try {
      const mr = allStmt(d, "SELECT content FROM messages ORDER BY id DESC LIMIT 200");
      for (const r of mr) texts.push({ text: r.content, source: "conversation" });
    } catch {}
  }
  let entities = [...extractEntities(texts).values()];
  entities.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  if (sourceFilter) entities = entities.filter((e) => sourceFilter.some((s) => [...e.sources].some((src) => src.includes(s) || (s === "conversation" && src === "conversation"))));
  if (flags.apply) {
    const gres = applyEntitiesToGraph(d, entities);
    const edges = cooccurrenceEdges(d, texts, gres.eligibleIds);
    syncGraphProjection(d, c);
    console.log(`Entities applied: +${gres.created} nodes, ${edges.length} co-occurrence edges written to graph.`);
    return;
  }
  if (!entities.length) { console.log("No entities found. Save some memories first (`cm save ...`) or run with --msgs."); return; }
  const shown = entities.slice(0, limit);
  const cats = {};
  for (const e of entities) cats[e.category] = (cats[e.category] || 0) + 1;
  const catSummary = Object.entries(cats).map(function (kv) { return kv[0] + ":" + kv[1]; }).join(", ");
  console.log(entities.length + " entity types (" + catSummary + "); top " + shown.length + ":");
  for (const e of shown) {
    const src = e.sources.size ? ` (${[...e.sources].slice(0, 2).join(", ")}${e.sources.size > 2 ? ", ..." : ""})` : "";
    console.log(`  ${e.name}  [${e.category}] ×${e.count}${src}`);
  }
  console.log("Tip: cm entities --apply to write entities + relations to the graph.");
}

function cmdHistory(d, c, args) {
  const { flags } = parseArgs(args);
  const kindFilter = flags.kind ? String(flags.kind) : null;
  const entityFilter = flags.entity ? String(flags.entity) : null;
  const limit = Number.parseInt(String(flags.limit || "30"), 10) || 30;
  const where = ["status='active'"];
  const params = [];
  if (kindFilter) { where.push("kind = ?"); params.push(kindFilter); }
  let rows = listMemoryRows(d, `WHERE ${where.join(" AND ")}`, params, " ORDER BY mi.created_at DESC");
  if (entityFilter) {
    const needle = entityFilter.toLowerCase();
    rows = rows.filter((r) => `${r.title || ""} ${r.body || ""}`.toLowerCase().includes(needle));
  }
  if (limit > 0) rows = rows.slice(0, limit);
  const byKind = {};
  const byMonth = {};
  for (const r of rows) {
    byKind[r.kind] = (byKind[r.kind] || 0) + 1;
    const mo = String(r.created_at || "").slice(0, 7);
    if (mo) byMonth[mo] = (byMonth[mo] || 0) + 1;
  }
  const lines = [`Memory history — ${rows.length} active item(s):`, ""];
  lines.push("Timeline (newest first):");
  for (const r of rows) lines.push(`  ${String(r.created_at || "").slice(0, 19)}  [${r.kind}] ${r.title || summarize(r.body)}`);
  lines.push("", "Digest:");
  lines.push(`  by kind: ${Object.entries(byKind).map(([k, v]) => `${k}×${v}`).join(", ")}`);
  if (Object.keys(byMonth).length) lines.push(`  by month: ${Object.entries(byMonth).sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `${k}×${v}`).join(", ")}`);
  const ents = [...extractEntities(rows.map((r) => ({ text: `${r.title}\n${r.body}` }))).values()].sort((a, b) => b.count - a.count).slice(0, 8);
  if (ents.length) lines.push(`  top entities: ${ents.map((e) => `${e.name}×${e.count}`).join(", ")}`);
  console.log(lines.join("\n"));
}

