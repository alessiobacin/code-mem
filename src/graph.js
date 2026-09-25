function normalizeGraphNode(node) {
  return {
    id: String(node?.id || "").trim(),
    label: String(node?.label || node?.id || "").trim(),
    type: String(node?.type || "unknown").trim() || "unknown",
    metadata: typeof node?.metadata === "object" && node?.metadata ? node.metadata : {},
    created: String(node?.created || nowIso()),
  };
}

function normalizeGraphEdge(edge) {
  return {
    source: String(edge?.source || "").trim(),
    target: String(edge?.target || "").trim(),
    relation: String(edge?.relation || "related_to").trim() || "related_to",
    confidence: String(edge?.confidence || "EXTRACTED").trim() || "EXTRACTED",
    metadata: typeof edge?.metadata === "object" && edge?.metadata ? edge.metadata : {},
    created: String(edge?.created || nowIso()),
  };
}

function upsertGraphNode(d, node) {
  const normalized = normalizeGraphNode(node);
  if (!normalized.id || !normalized.label) return false;
  const existing = getStmt(d, "SELECT id FROM graph_nodes WHERE id = ?", [normalized.id]);
  if (existing) {
    runStmt(
      d,
      "UPDATE graph_nodes SET label=?, type=?, metadata_json=?, updated_at=? WHERE id=?",
      [normalized.label, normalized.type, JSON.stringify(normalized.metadata), nowIso(), normalized.id]
    );
    return false;
  }
  runStmt(
    d,
    "INSERT INTO graph_nodes(id,label,type,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,?)",
    [normalized.id, normalized.label, normalized.type, JSON.stringify(normalized.metadata), normalized.created, nowIso()]
  );
  return true;
}

function upsertGraphEdge(d, edge) {
  const normalized = normalizeGraphEdge(edge);
  if (!normalized.source || !normalized.target || !normalized.relation) return false;
  const existing = getStmt(
    d,
    "SELECT source_id FROM graph_edges WHERE source_id = ? AND target_id = ? AND relation = ?",
    [normalized.source, normalized.target, normalized.relation]
  );
  if (existing) return false;
  runStmt(
    d,
    "INSERT INTO graph_edges(source_id,target_id,relation,confidence,metadata_json,created_at) VALUES(?,?,?,?,?,?)",
    [
      normalized.source,
      normalized.target,
      normalized.relation,
      normalized.confidence,
      JSON.stringify(normalized.metadata),
      normalized.created,
    ]
  );
  return true;
}

function loadGraphFromStore(d) {
  const nodes = allStmt(
    d,
    "SELECT id,label,type,metadata_json,created_at FROM graph_nodes ORDER BY id"
  ).map((row) => ({
    id: row.id,
    label: row.label,
    type: row.type,
    metadata: safeJsonParse(row.metadata_json || "{}", {}),
    created: row.created_at,
  }));
  const edges = allStmt(
    d,
    "SELECT source_id,target_id,relation,confidence,metadata_json,created_at FROM graph_edges ORDER BY source_id, target_id, relation"
  ).map((row) => ({
    source: row.source_id,
    target: row.target_id,
    relation: row.relation,
    confidence: row.confidence,
    metadata: safeJsonParse(row.metadata_json || "{}", {}),
    created: row.created_at,
  }));
  return { nodes, edges };
}

function syncGraphProjection(d, cwd) {
  wg(mp(cwd, GF), loadGraphFromStore(d));
}

function importLegacyGraphFile(d, cwd) {
  const hasGraphNodes = getStmt(d, "SELECT id FROM graph_nodes LIMIT 1");
  if (hasGraphNodes) return 0;
  const graphPath = mp(cwd, GF);
  if (!existsSync(graphPath)) return 0;
  const graph = rg(graphPath);
  let imported = 0;
  for (const node of graph.nodes || []) {
    if (upsertGraphNode(d, node)) imported += 1;
  }
  for (const edge of graph.edges || []) {
    upsertGraphEdge(d, edge);
  }
  syncGraphProjection(d, cwd);
  return imported;
}

function resolveNode(g, query) {
  if (!query) return null;
  const candidates = [
    g.nodes.find((n) => n.id === query),
    g.nodes.find((n) => n.label === query),
    g.nodes.find((n) => n.id.startsWith(query) || n.id.includes(query.toLowerCase())),
    g.nodes.find((n) => String(n.label || "").toLowerCase().startsWith(query.toLowerCase()) || String(n.label || "").toLowerCase().includes(query.toLowerCase())),
  ];
  return candidates.find(Boolean) || null;
}

function importFromGraphify(d, cwd, graphPath, opts = {}) {
  // Import graphify graph.json into cm graph
  if (!existsSync(graphPath)) {
    console.log(`Graphify file not found: ${graphPath}`);
    return { nodes: 0, edges: 0 };
  }
  let raw;
  try { raw = JSON.parse(readFileSync(graphPath, "utf-8")); } catch (e) {
    console.log(`Invalid graphify file: ${e.message}`);
    return { nodes: 0, edges: 0 };
  }
  const gfyNodes = raw.nodes || [];
  const gfyEdges = [...(raw.edges || []), ...(raw.links || [])];
  const hyEdges = raw.hyperedges || [];
  if (opts.dryRun) {
    return { nodes: gfyNodes.length, edges: gfyEdges.length + hyEdges.length };
  }
  // Build ID map: track which local IDs exist for collision detection
  const existingIds = new Set();
  try {
    const rows = allStmt(d, "SELECT id FROM graph_nodes");
    for (const r of rows) existingIds.add(r.id);
  } catch {}

  let nodeCount = 0, edgeCount = 0;
  const idMap = {}; // graphify id → cm id

  for (const n of gfyNodes) {
    if (!n.id) continue;
    let cid = n.id;
    if (existingIds.has(cid)) cid = `gfy:${n.id}`;
    idMap[n.id] = cid;
    const label = n.label || n.norm_label || n.id;
    const type = (n.file_type && n.file_type !== "?" && n.file_type !== "?") ? n.file_type : "graphify";
    const metadata = {};
    for (const k of ["source_file", "source_location", "community", "norm_label", "author", "contributor", "source_url", "captured_at"]) {
      if (n[k] !== undefined && n[k] !== null) metadata[k] = n[k];
    }
    try {
      if (upsertGraphNode(d, { id: cid, label, type, metadata, created: nowIso() })) nodeCount++;
    } catch {}
  }

  // Edges
  const allEdges = [...gfyEdges];
  for (const he of hyEdges) {
    if (he.nodes && Array.isArray(he.nodes) && he.nodes.length >= 2) {
      const relation = he.relation || "related_to";
      for (let i = 0; i < he.nodes.length; i++) {
        for (let j = i + 1; j < he.nodes.length; j++) {
          allEdges.push({ source: he.nodes[i], target: he.nodes[j], relation, confidence: "INFERRED", metadata: { hyperedge: he.id || "" } });
        }
      }
    }
  }

  for (const e of allEdges) {
    const src = idMap[e.source] || `gfy:${e.source}`;
    const tgt = idMap[e.target] || `gfy:${e.target}`;
    const relation = e.relation || "related_to";
    const confidence = e.confidence || "INFERRED";
    const metadata = e.metadata || {};
    if (e.confidence_score !== undefined) metadata.confidence_score = e.confidence_score;
    if (e.weight !== undefined) metadata.weight = e.weight;
    try {
      if (upsertGraphEdge(d, { source: src, target: tgt, relation, confidence, metadata, created: nowIso() })) edgeCount++;
    } catch {}
  }

  syncGraphProjection(d, cwd);
  return { nodes: nodeCount, edges: edgeCount };
}

function importFromClaudeMem(d, cwd, projectFilter, opts = {}) {
  // Import memories from claude-mem database
  const cmemDbPath = join(process.env.HOME || "/tmp", ".claude-mem", "claude-mem.db");
  if (!existsSync(cmemDbPath)) {
    console.log(`Claude-mem database not found at ${cmemDbPath}`);
    return { memories: 0 };
  }
  try {
    const DB = require("node:sqlite").DatabaseSync;
    const cmemDb = new DB(cmemDbPath, { open: true, readOnly: true });
    let rows;
    if (projectFilter) {
      rows = cmemDb.prepare("SELECT * FROM observations WHERE project = ? ORDER BY created_at ASC").all(projectFilter);
    } else {
      rows = cmemDb.prepare("SELECT * FROM observations ORDER BY created_at ASC").all();
    }
    cmemDb.close();
    if (opts.dryRun) return { memories: rows.length };

    let memoryCount = 0;
    for (const row of rows) {
      const body = [row.text || "", row.narrative || ""].filter(Boolean).join("\n\n");
      if (!body.trim()) continue;
      const tags = ["claude-mem"];
      const summaryParts = [];
      if (row.facts) { summaryParts.push(row.facts); }
      if (row.concepts) {
        summaryParts.push(row.concepts);
        row.concepts.split(",").map(s => s.trim()).filter(Boolean).forEach(t => tags.push(t));
      }
      const files = [];
      if (row.files_read) row.files_read.split(",").map(s => s.trim()).filter(Boolean).forEach(f => { if (!files.includes(f)) files.push(f); });
      if (row.files_modified) row.files_modified.split(",").map(s => s.trim()).filter(Boolean).forEach(f => { if (!files.includes(f)) files.push(f); });

      const memoryId = `cmem:${hashText(row.text || "")}`;
      const result = upsertMemoryItem(d, {
        id: memoryId,
        kind: row.type || "fact",
        layer: "semantic",
        title: row.title || row.type || "Claude-mem observation",
        body: body.trim(),
        summary: summaryParts.join("; ").slice(0, 500),
        confidence: 0.7,
        salience: 0.5,
        source: "claude-mem",
        cwd,
        gitBranch: "",
        agent: "claude-mem",
        taskKind: "",
        files,
        tags,
        sessionId: "",
        createdAt: row.created_at || nowIso(),
        metadata: { cmem_observation_id: row.id },
      });
      if (result && result.id) memoryCount++;
    }
    refreshProjections(d, cwd);
    return { memories: memoryCount };
  } catch (e) {
    console.log(`Claude-mem import error: ${e.message}`);
    return { memories: 0 };
  }
}

function parseWikiValue(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.startsWith("[") && text.endsWith("]")) {
    try { return JSON.parse(text.replace(/'/g, '"')); } catch {
      return text.slice(1, -1).split(",").map((item) => item.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
    }
  }
  if (text.startsWith("{") && text.endsWith("}")) {
    try { return JSON.parse(text.replace(/'/g, '"')); } catch {}
  }
  return text.replace(/^['"]|['"]$/g, "").trim();
}

function parseWikiFrontmatter(raw) {
  const match = String(raw || "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { data: {}, body: String(raw || "") };
  const data = {};
  let listKey = "";
  for (const line of match[1].split(/\r?\n/)) {
    const listItem = line.match(/^\s*-\s+(.+)$/);
    if (listItem && listKey) {
      if (!Array.isArray(data[listKey])) data[listKey] = [];
      data[listKey].push(parseWikiValue(listItem[1]));
      continue;
    }
    const field = line.match(/^\s*([A-Za-z][\w-]*)\s*:\s*(.*)$/);
    if (!field) continue;
    const [, key, value] = field;
    const parsed = parseWikiValue(value);
    data[key.toLowerCase()] = parsed;
    listKey = parsed === "" ? key.toLowerCase() : "";
  }
  return { data, body: String(raw || "").slice(match[0].length) };
}

function wikiArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || "")
    .split(/[;,]/)
    .map((item) => item.trim().replace(/^#/, ""))
    .filter(Boolean);
}

function wikiTitle(body, filePath, frontmatter) {
  if (frontmatter.title) return String(frontmatter.title).trim();
  const heading = String(body || "").match(/^#\s+(.+)$/m);
  return heading ? heading[1].trim() : basename(filePath).replace(/\.(?:md|markdown)$/i, "");
}

function isWikiFile(filePath) {
  return /\.(?:md|markdown)$/i.test(String(filePath || ""));
}

// Media ingest (graphify parity): pdf/office/ebook -> markdown via markitdown
// (Microsoft, offline), images -> OCR via tesseract, audio/video -> text via
// whisper (or ffmpeg metadata when whisper is unavailable). Every converter
// is optional and best-effort: missing binaries degrade to a stub note that
// records the asset instead of failing the import.
const MEDIA_TEXT_EXT = new Set([".pdf", ".docx", ".doc", ".odt", ".rtf", ".pptx", ".xlsx", ".xls", ".epub", ".html", ".htm", ".csv", ".json"]);
const MEDIA_IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff"]);
const MEDIA_AUDIO_EXT = new Set([".mp3", ".wav", ".m4a", ".ogg", ".flac"]);
const MEDIA_VIDEO_EXT = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi"]);
function isMediaFile(filePath) {
  const ext = extname(String(filePath || "")).toLowerCase();
  return MEDIA_TEXT_EXT.has(ext) || MEDIA_IMAGE_EXT.has(ext) || MEDIA_AUDIO_EXT.has(ext) || MEDIA_VIDEO_EXT.has(ext);
}
function mediaKind(filePath) {
  const ext = extname(String(filePath || "")).toLowerCase();
  if (MEDIA_IMAGE_EXT.has(ext)) return "image";
  if (MEDIA_AUDIO_EXT.has(ext)) return "audio";
  if (MEDIA_VIDEO_EXT.has(ext)) return "video";
  return "document";
}
function runMediaCommand(binary, args, timeoutMs) {
  try {
    const out = execFileSync(binary, args, { encoding: "utf8", timeout: timeoutMs || 60000, maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
    return String(out || "").trim();
  } catch { return ""; }
}
function commandAvailable(binary) {
  try {
    const out = execFileSync("/bin/zsh", ["-lc", `command -v ${binary}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return Boolean(String(out || "").trim());
  } catch { return false; }
}
function mediaFileToText(filePath, cwd) {
  const ext = extname(String(filePath || "")).toLowerCase();
  const kind = mediaKind(filePath);
  // 1) markitdown handles pdf/office/html/csv natively (offline).
  if (MEDIA_TEXT_EXT.has(ext) && commandAvailable("markitdown")) {
    const text = runMediaCommand("markitdown", [filePath], 120000);
    if (text && text.length > 40) return { text: text.slice(0, 24000), via: "markitdown", kind };
  }
  // 1b) formats markitdown lacks (.doc/.odt/.rtf/...): pandoc, then macOS textutil.
  if (MEDIA_TEXT_EXT.has(ext) && [".odt", ".rtf", ".docx", ".epub", ".html", ".htm"].includes(ext) && commandAvailable("pandoc")) {
    const text = runMediaCommand("pandoc", [filePath, "-t", "gfm", "--wrap=none"], 120000);
    if (text && text.length > 40) return { text: text.slice(0, 24000), via: "pandoc", kind };
  }
  if ([".doc", ".rtf", ".odt", ".docx"].includes(ext) && commandAvailable("textutil")) {
    const text = runMediaCommand("textutil", ["-convert", "txt", "-stdout", filePath], 120000);
    if (text && text.length > 40) return { text: text.slice(0, 24000), via: "textutil", kind };
  }
  // 2) images: harness vision first (understands layout/diagrams/charts,
  // like graphify's vision subagents — OCR alone cannot do this), then
  // structured OCR as fallback. Vision wins when it returns genuine content
  // (validated against OCR tokens, never trusted blindly).
  if (MEDIA_IMAGE_EXT.has(ext)) {
    const seen = visionDescribeImage(filePath, cwd);
    if (seen && seen.text && seen.text.length > 20) {
      return { text: seen.text.slice(0, 12000), via: seen.via, kind, vision: seen };
    }
    if (commandAvailable("tesseract")) {
      const text = runMediaCommand("tesseract", [filePath, "stdout", "-l", "eng+ita"], 120000)
        || runMediaCommand("tesseract", [filePath, "stdout", "-l", "eng"], 120000);
      if (text && text.length > 10) return { text: text.slice(0, 12000), via: "tesseract", kind };
    }
  }
  // 3) audio/video: whisper transcription, else ffmpeg metadata stub.
  if ((MEDIA_AUDIO_EXT.has(ext) || MEDIA_VIDEO_EXT.has(ext)) && commandAvailable("whisper")) {
    const tmpOut = join(process.env.TMPDIR || "/tmp", `cm-whisper-${Date.now()}`);
    try { mkdirSync(tmpOut, { recursive: true }); } catch {}
    const base = basename(filePath).replace(/\.[^.]+$/, "");
    runMediaCommand("whisper", [filePath, "--model", "base", "--language", "auto", "--output_dir", tmpOut, "--output_format", "txt", "--fp16", "False"], 600000);
    try {
      const txt = readFileSync(join(tmpOut, `${base}.txt`), "utf8").trim();
      if (txt && txt.length > 10) return { text: txt.slice(0, 24000), via: "whisper", kind };
    } catch {}
  }
  if ((MEDIA_AUDIO_EXT.has(ext) || MEDIA_VIDEO_EXT.has(ext)) && commandAvailable("ffmpeg")) {
    const meta = runMediaCommand("ffmpeg", ["-i", filePath], 30000);
    const probe = runMediaCommand("ffprobe", ["-v", "error", "-show_entries", "format=duration,size", "-of", "default=noprint_wrappers=1", filePath], 30000);
    const stub = [`Media ${kind}: ${basename(filePath)}`, probe ? `(${probe.replace(/\n/g, " ").slice(0, 200)})` : "", "Transcription unavailable (whisper missing or failed)."].filter(Boolean).join(" ");
    return { text: stub, via: "ffmpeg-stub", kind };
  }
  return { text: "", via: "unavailable", kind };
}
// Conversion (markitdown, OCR, vision LLM, whisper) is the slow part of an
// import: cache it by file content so unchanged media are never redone.
const MEDIA_CACHE_VERSION = "1";
function cachedMediaFileToText(d, filePath, cwd) {
  let hash = "";
  try { hash = `${createHash("sha256").update(readFileSync(filePath)).digest("hex")}:${MEDIA_CACHE_VERSION}`; } catch {}
  if (hash) {
    try {
      runStmt(d, "CREATE TABLE IF NOT EXISTS media_cache(hash TEXT PRIMARY KEY, kind TEXT, via TEXT, text TEXT NOT NULL, vision_json TEXT, created_at TEXT NOT NULL)");
      const row = getStmt(d, "SELECT kind, via, text, vision_json FROM media_cache WHERE hash = ?", [hash]);
      if (row) return { text: row.text, via: row.via, kind: row.kind, vision: safeJsonParse(row.vision_json || "null", null) || undefined, cached: true };
    } catch {}
  }
  const converted = mediaFileToText(filePath, cwd);
  if (hash && converted.text) {
    try { runStmt(d, "INSERT OR REPLACE INTO media_cache(hash,kind,via,text,vision_json,created_at) VALUES(?,?,?,?,?,?)", [hash, converted.kind, converted.via, converted.text, converted.vision ? JSON.stringify(converted.vision) : null, nowIso()]); } catch {}
  }
  return converted;
}

function collectMediaFiles(rootPath) {
  const files = [];
  const ignored = new Set([".git", ".obsidian", ".trash", "node_modules", "attachments", "memory", "dist", "build", "coverage", ".next", ".venv", "venv", "__pycache__"]);
  const visit = (current) => {
    let info;
    try { info = statSync(current); } catch { return; }
    if (info.isFile()) {
      if (isMediaFile(current) && !isWikiFile(current)) files.push(current);
      return;
    }
    if (!info.isDirectory()) return;
    let entries = [];
    try { entries = readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || ignored.has(entry.name)) continue;
      visit(join(current, entry.name));
    }
  };
  visit(rootPath);
  return files.sort();
}

function collectWikiFiles(rootPath) {
  const files = [];
  const ignored = new Set([".git", ".obsidian", ".trash", "node_modules", "attachments", "memory", "dist", "build", "coverage", ".next", ".venv", "venv", "__pycache__"]);
  const visit = (current) => {
    let info;
    try { info = statSync(current); } catch { return; }
    if (info.isFile()) {
      if (isWikiFile(current)) files.push(current);
      return;
    }
    if (!info.isDirectory()) return;
    let entries = [];
    try { entries = readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || ignored.has(entry.name)) continue;
      visit(join(current, entry.name));
    }
  };
  visit(rootPath);
  return files.sort();
}

function wikiKey(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\.(?:md|markdown)$/i, "")
    .replace(/#.*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function wikiLinks(body) {
  const links = [];
  const obsidian = /!?\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
  const markdown = /\[[^\]]*\]\(([^)#]+\.md)(?:#[^)]+)?\)/gi;
  for (const match of String(body || "").matchAll(obsidian)) links.push(match[1].trim());
  for (const match of String(body || "").matchAll(markdown)) links.push(match[1].trim());
  return [...new Set(links)];
}

function resolveWikiReference(value, exact, baseNames, preference = "") {
  const raw = String(value || "").trim().replace(/^!?\[\[/, "").replace(/\]\]$/, "");
  if (!raw) return null;
  const key = wikiKey(raw);
  const exactMatch = exact.get(key);
  if (exactMatch) return exactMatch;
  const candidates = baseNames.get(key.split("/").pop()) || [];
  if (preference === "server") {
    return candidates.find((candidate) => /(?:^|\/)servers\//i.test(String(candidate.relative || ""))) || candidates[0] || null;
  }
  return candidates[0] || null;
}

function frontmatterRelations(note, exact, baseNames) {
  const relations = [];
  const add = (field, relation, preference = "") => {
    for (const value of wikiArray(note.frontmatter?.[field])) {
      const target = resolveWikiReference(value, exact, baseNames, preference);
      if (!target || target.id === note.id) continue;
      relations.push({ source: note.id, target: target.id, relation });
    }
  };

  // Infrastructure notes commonly encode topology in frontmatter instead of
  // repeating Obsidian links in prose. Promote those declarations to graph
  // edges so a service hosted on a server is never rendered as an orphan.
  add("host", "hosted_on", "server");
  add("server", "hosted_on", "server");
  add("runs_on", "hosted_on", "server");
  add("hosted_on", "hosted_on", "server");
  add("depends_on", "depends_on");
  add("depends", "depends_on");
  add("requires", "depends_on");
  add("consumed_by", "consumed_by");
  add("used_by", "consumed_by");
  add("consumers", "consumed_by");

  const seen = new Set();
  return relations.filter((edge) => {
    const key = `${edge.source}|${edge.target}|${edge.relation}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hostingRelationsFromServerDescriptions(notes) {
  const servers = notes.filter((note) => /(?:^|\/)servers\//i.test(String(note.relative || "")));
  const applications = notes.filter((note) => {
    if (!/(?:^|\/)apps\//i.test(String(note.relative || ""))) return false;
    return !wikiArray(note.frontmatter?.host || note.frontmatter?.server || note.frontmatter?.runs_on || note.frontmatter?.hosted_on).length;
  });
  const relations = [];
  for (const server of servers) {
    // Use role/hosting statements rather than the whole note: domains,
    // usernames and unrelated dependency sections can mention an application
    // name without proving that the application runs on this server.
    const hostingContext = [server.title, ...String(server.body || "").split(/\r?\n/).filter((line) => /\bhost(?:s|ed|ing)?\b|\brunning\b|\brun[s]?\b|\bospita\w*\b|\bruolo\b|\brole\b|\bapplicativ\w*\b|\bapplication\w*\b/i.test(line))];
    const description = hostingContext.join("\n").toLowerCase();
    for (const application of applications) {
      const names = [application.frontmatter?.application, application.title]
        .map((name) => String(name || "").trim().toLowerCase())
        .filter((name, index, all) => name.length >= 4 && all.indexOf(name) === index);
      if (!names.some((name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\\]\\]/g, "\\\\$&")}\\b`, "i").test(description))) continue;
      relations.push({ source: application.id, target: server.id, relation: "hosted_on", relationSource: "server_description" });
    }
  }
  return relations;
}

function importPathSeparator() {
  return process.platform === "win32" ? "\\" : "/";
}

function importSourceDeletionAllowed(rootPath, cwd) {
  let source = canonicalPath(rootPath);
  const project = canonicalPath(cwd);
  try { if (!statSync(source).isDirectory()) source = canonicalPath(dirname(source)); } catch { return false; }
  const inside = (child, parent) => child === parent || child.startsWith(`${parent}${importPathSeparator()}`);
  // Never delete a project directory, its parent, or files inside the project.
  return !inside(project, source) && !inside(source, project);
}

function deleteImportedSourceFiles(files, rootPath, cwd) {
  if (!importSourceDeletionAllowed(rootPath, cwd)) return { deleted: 0, refused: true };
  let deleted = 0;
  for (const filePath of files || []) {
    try { unlinkSync(filePath); deleted += 1; } catch {}
  }
  return { deleted, refused: false };
}

function importLlmJson(raw) {
  const text = String(raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const object = text.match(/\{[\s\S]*\}/);
  if (!object) return null;
  try { return JSON.parse(object[0]); } catch { return null; }
}

function callImportLlm(prompt, model) {
  return new Promise((resolveAnswer) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port: 11434,
        path: "/api/generate",
        method: "POST",
        headers: { "content-type": "application/json" },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => { body += chunk; });
        response.on("end", () => {
          if (response.statusCode !== 200) return resolveAnswer(null);
          try {
            const parsed = JSON.parse(body);
            resolveAnswer(importLlmJson(parsed.response));
          } catch { resolveAnswer(null); }
        });
      }
    );
    const timeoutMs = Number(process.env.CM_IMPORT_LLM_TIMEOUT_MS || 30000);
    request.setTimeout(Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30000, () => {
      try { request.destroy(); } catch {}
      resolveAnswer(null);
    });
    request.on("error", () => resolveAnswer(null));
    request.write(JSON.stringify({ model, prompt, format: "json", stream: false }));
    request.end();
  });
}

function normalizeImportedNotesWithLlm(notes, opts = {}) {
  const requestedLimit = Number(opts.llmLimit || process.env.CM_IMPORT_LLM_LIMIT || notes.length);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(notes.length, Math.floor(requestedLimit)) : notes.length;
  // Large vaults still get a complete deterministic graph. The LLM pass is
  // bounded to representative notes by default so a 1,700-file vault does
  // not turn into hundreds of slow/expensive provider calls. Set
  // CM_IMPORT_LLM_LIMIT to the full count when every note needs normalization.
  const selected = limit >= notes.length ? notes : [...notes].sort((a, b) => {
    const score = (note) => (note.relative.toLowerCase().match(/readme|architecture|decision|guide|index|overview|plan|runbook/) ? 100000 : 0) + note.body.length;
    return score(b) - score(a);
  }).slice(0, limit);
  const result = { attempted: selected.length, normalized: 0, skipped: Math.max(0, notes.length - selected.length), model: "", available: false };
  if (!notes.length || process.env.CM_IMPORT_NO_LLM === "1" || opts.disableLlm) return Promise.resolve(result);
  const model = String(process.env.CM_IMPORT_MODEL || process.env.OLLAMA_MODEL || "llama3.1:8b").trim();
  result.model = opts.harness?.model || (opts.harness ? opts.harness.name : model);
  const batches = [];
  const batchSize = Number(opts.llmBatchSize || (opts.harness ? 20 : 6));
  for (let i = 0; i < selected.length; i += batchSize) batches.push(selected.slice(i, i + batchSize));
  let chain = Promise.resolve();
  for (const batch of batches) {
    chain = chain.then(async () => {
      const payload = batch.map((note) => ({
        path: note.relative,
        title: note.title,
        content: note.body.slice(0, opts.harness ? 1600 : 7000),
        tags: note.tags,
      }));
      const prompt = [
        "You normalize imported knowledge notes for CodeMem.",
        "Infer the note meaning from its content; do not rely on a source application name.",
        "Return JSON only: {\"notes\":[{\"path\":\"...\",\"title\":\"...\",\"body\":\"...\",\"summary\":\"...\",\"kind\":\"fact|decision|procedure|issue|preference|artifact\",\"tags\":[\"...\"],\"links\":[\"...\"],\"confidence\":0.0,\"importance\":0.0}]}",
        "Keep facts, dates, file paths, commands and technical names. Translate prose to concise English when needed.",
        "Do not invent facts, do not include commentary, and preserve each input path exactly.",
        JSON.stringify(payload),
      ].join("\n");
      const parsed = opts.harness
        ? runHarnessImportNormalization(opts.harness, opts.cwd || process.cwd(), payload, { timeout: opts.llmTimeout })
        : await callImportLlm(prompt, model);
      const rows = Array.isArray(parsed) ? parsed : parsed?.notes;
      if (!Array.isArray(rows)) return;
      const byPath = new Map(batch.map((note) => [wikiKey(note.relative), note]));
      for (const row of rows) {
        const note = byPath.get(wikiKey(row?.path));
        if (!note) continue;
        if (String(row.title || "").trim()) note.title = String(row.title).trim().slice(0, 240);
        if (String(row.body || "").trim()) note.body = String(row.body).trim().slice(0, 12000);
        if (String(row.summary || "").trim()) note.summary = String(row.summary).trim().slice(0, 600);
        if (String(row.kind || "").trim()) note.kind = String(row.kind).trim().toLowerCase();
        if (Array.isArray(row.tags)) note.tags = wikiArray(row.tags);
        if (Array.isArray(row.links)) note.llmLinks = row.links.map((link) => String(link).trim()).filter(Boolean);
        if (row.confidence !== undefined) note.confidence = clamp01(row.confidence, DEFAULT_CONFIDENCE);
        if (row.importance !== undefined) note.importance = clamp01(row.importance, DEFAULT_SALIENCE);
        note.llmNormalized = true;
        result.normalized += 1;
      }
    });
  }
  return chain.then(() => {
    result.available = result.normalized > 0;
    return result;
  });
}

async function importFromWiki(d, cwd, rootPath, format = "wiki", opts = {}) {
  const root = resolve(rootPath || "");
  if (!existsSync(root)) {
    console.log(`Wiki path not found: ${root}`);
    return { files: 0, memories: 0, nodes: 0, edges: 0 };
  }
  const files = collectWikiFiles(root);
  // Media siblings (pdf/office/images/audio/video) convert to text notes so
  // multimodal corpora join the same graph instead of being invisible.
  const mediaFiles = (opts.includeMedia === false || process.env.CM_IMPORT_NO_MEDIA === "1") ? [] : collectMediaFiles(root);
  if (opts.dryRun) return { files: files.length + mediaFiles.length, memories: files.length, nodes: files.length, edges: 0, media: mediaFiles.length, sourceFiles: files, llm: { attempted: 0, normalized: 0, model: "", available: false } };

  const source = format === "obsidian" ? "obsidian" : "knowledge-wiki";
  if (opts.replace) {
    runStmt(d, "DELETE FROM graph_edges WHERE source_id LIKE 'wiki:%' OR target_id LIKE 'wiki:%'");
    runStmt(d, "DELETE FROM graph_nodes WHERE id LIKE 'wiki:%'");
    runStmt(d, "DELETE FROM memory_items WHERE source = ?", [source]);
  }

  const notes = [];
  const exact = new Map();
  const baseNames = new Map();
  for (const filePath of files) {
    const raw = rd(filePath);
    const parsed = parseWikiFrontmatter(raw);
    const relative = filePath.slice(root.length).replace(/^[/\\]+/, "").replace(/\\/g, "/");
    const title = wikiTitle(parsed.body, filePath, parsed.data);
    const note = {
      filePath,
      relative,
      raw,
      body: parsed.body.trim(),
      title,
      frontmatter: parsed.data,
      tags: wikiArray(parsed.data.tags || parsed.data.tag),
      aliases: wikiArray(parsed.data.aliases || parsed.data.alias),
      id: `wiki:${format}:${hashText(relative)}`,
      memoryId: `mem_${format}_wiki_${hashText(relative)}`,
    };
    notes.push(note);
    exact.set(wikiKey(relative), note);
    exact.set(wikiKey(relative.replace(/\.(?:md|markdown)$/i, "")), note);
    const baseKey = wikiKey(basename(filePath).replace(/\.(?:md|markdown)$/i, ""));
    if (!baseNames.has(baseKey)) baseNames.set(baseKey, []);
    baseNames.get(baseKey).push(note);
  }

  let mediaConverted = 0, mediaFailed = 0;
  const visionByNote = new Map(); // note id -> vision { labels, edges }
  for (const filePath of mediaFiles) {
    const relative = filePath.slice(root.length).replace(/^[/\\]+/, "").replace(/\\/g, "/");
    const converted = cachedMediaFileToText(d, filePath, cwd);
    if (!converted.text) { mediaFailed += 1; continue; }
    mediaConverted += 1;
    const title = `${basename(filePath)} (${converted.kind} via ${converted.via})`;
    const note = {
      filePath,
      relative,
      raw: converted.text,
      body: converted.text,
      title,
      frontmatter: {},
      tags: ["media", converted.kind, converted.via],
      aliases: [],
      id: `wiki:${format}:${hashText(relative)}`,
      memoryId: `mem_${format}_wiki_${hashText(relative)}`,
    };
    notes.push(note);
    if (converted.vision?.labels?.length) visionByNote.set(note.id, converted.vision);
    exact.set(wikiKey(relative), note);
    const baseKey = wikiKey(basename(filePath).replace(/\.[^.]+$/, ""));
    if (!baseNames.has(baseKey)) baseNames.set(baseKey, []);
    baseNames.get(baseKey).push(note);
  }

  const llm = await normalizeImportedNotesWithLlm(notes, opts);
  const hostingRelations = hostingRelationsFromServerDescriptions(notes);
  const hostingBySource = new Map();
  for (const relation of hostingRelations) {
    if (!hostingBySource.has(relation.source)) hostingBySource.set(relation.source, []);
    hostingBySource.get(relation.source).push(relation);
  }

  let memories = 0;
  let nodes = 0;
  for (const note of notes) {
    const kind = String(note.kind || note.frontmatter.kind || note.frontmatter.type || "fact").trim() || "fact";
    const stat = statSync(note.filePath);
    const tags = ["wiki-import", format, ...note.tags].filter((tag, index, all) => all.indexOf(tag) === index);
    const body = compactMemoryText(note.body || note.title);
    const summary = String(note.summary || note.frontmatter.summary || "").trim() || summarize(note.body || note.title);
    const confidence = clamp01(note.confidence ?? note.frontmatter.confidence, DEFAULT_CONFIDENCE);
    const salience = clamp01(note.frontmatter.salience, DEFAULT_SALIENCE);
    const importance = clamp01(note.importance ?? note.frontmatter.importance, DEFAULT_SALIENCE);
    const result = upsertMemoryItem(d, {
      id: note.memoryId,
      kind,
      layer: kind === "preference" ? "user" : "semantic",
      title: note.title,
      body,
      summary,
      confidence,
      salience,
      importance,
      source,
      sourceType: "document",
      cwd,
      gitBranch: getGitBranch(cwd),
      agent: "wiki-import",
      files: [note.relative],
      tags,
      createdAt: String(note.frontmatter.created || note.frontmatter.date || stat.mtime.toISOString()),
      hash: hashText(`${source}|${note.relative}`),
    });
    // A stable path hash makes re-import idempotent. Refresh mutable fields so
    // editing a note updates its memory instead of creating a second row.
    if (result?.id) {
      runStmt(
        d,
        `UPDATE memory_items
         SET kind=?, layer=?, title=?, body=?, summary=?, confidence=?, salience=?,
             importance=?, source_type=?, updated_at=?
         WHERE id=?`,
        [kind, kind === "preference" ? "user" : "semantic", note.title, body, summary, confidence, salience, importance, "document", nowIso(), result.id]
      );
      runStmt(
        d,
        `UPDATE memory_context SET cwd=?, git_branch=?, files_json=?, tags_json=? WHERE memory_id=?`,
        [cwd, getGitBranch(cwd), JSON.stringify([note.relative]), JSON.stringify(tags), result.id]
      );
      try { updateMemoryFtsRow(d, result.id); } catch {}
    }
    if (result?.created) memories += 1;
    if (upsertGraphNode(d, {
      id: note.id,
      label: note.title,
      type: format === "obsidian" ? "obsidian-note" : format === "wiki" ? "wiki-note" : "knowledge-note",
      metadata: { source_path: note.relative, format, tags, aliases: note.aliases, llm_normalized: Boolean(note.llmNormalized), kind, summary, confidence, importance },
      created: stat.mtime.toISOString(),
    })) nodes += 1;
  }

  // Vision element nodes: every label the vision stage SAW becomes a node
  // (EXTRACTED — validated against OCR), every visible connection becomes
  // an edge. This is what makes diagrams/charts queryable as structure,
  // not just as OCR text — the graphify vision behaviour.
  let visionNodes = 0;
  let visionEdges = 0;
  const visionLabelIds = new Map(); // note id -> Map(label -> node id)
  for (const [noteId, vision] of visionByNote) {
    const labelIds = new Map();
    const note = notes.find((n) => n.id === noteId);
    for (const label of vision.labels || []) {
      const vid = `vision:${hashText(`${noteId}|${label.toLowerCase()}`)}`;
      if (upsertGraphNode(d, {
        id: vid,
        label,
        type: "vision-element",
        metadata: { source_path: note?.relative || "", image_kind: vision.kind || "image", via: vision.via || "vision", depicts: noteId },
        created: nowIso(),
      })) visionNodes += 1;
      labelIds.set(label, vid);
      if (upsertGraphEdge(d, { source: noteId, target: vid, relation: "depicts", confidence: "EXTRACTED", metadata: { source_path: note?.relative || "", via: vision.via || "vision" } })) visionEdges += 1;
    }
    visionLabelIds.set(noteId, labelIds);
    for (const e of vision.edges || []) {
      const from = labelIds.get(e.from);
      const to = labelIds.get(e.to);
      if (!from || !to || from === to) continue;
      if (upsertGraphEdge(d, { source: from, target: to, relation: e.relation || "connects_to", confidence: "INFERRED", metadata: { source_path: note?.relative || "", via: vision.via || "vision" } })) visionEdges += 1;
    }
  }

  let edges = visionEdges;
  for (const note of notes) {
    const references = [...new Set([...wikiLinks(note.body), ...(note.llmLinks || [])])];
    for (const target of references) {
      const resolved = resolveWikiReference(target, exact, baseNames);
      if (!resolved || resolved.id === note.id) continue;
      if (upsertGraphEdge(d, {
        source: note.id,
        target: resolved.id,
        relation: "links_to",
        confidence: "EXTRACTED",
        metadata: { source_path: note.relative },
      })) edges += 1;
    }
    // Rebuild the importer-owned topology edges for this note. This removes
    // stale host/dependency targets when a frontmatter declaration changes,
    // while preserving manually authored and LLM-derived relations.
    runStmt(
      d,
      `DELETE FROM graph_edges
       WHERE source_id=?
         AND relation IN ('hosted_on','depends_on','consumed_by')
         AND (metadata_json LIKE '%"relation_source":"frontmatter"%'
              OR metadata_json LIKE '%"relation_source":"server_description"%')`,
      [note.id]
    );
    const managedRelations = [...frontmatterRelations(note, exact, baseNames), ...(hostingBySource.get(note.id) || [])];
    for (const edge of managedRelations) {
      if (upsertGraphEdge(d, {
        ...edge,
        confidence: "EXTRACTED",
        metadata: { source_path: note.relative, relation_source: edge.relationSource || "frontmatter" },
      })) edges += 1;
    }
  }
  syncGraphProjection(d, cwd);
  refreshProjections(d, cwd);
  return { files: files.length, memories, nodes, edges, sourceFiles: files, llm, media: { converted: mediaConverted, failed: mediaFailed, total: mediaFiles.length } };
}

function importFromJson(d, cwd, filePath, opts = {}) {
  // Import generic JSON with nodes/edges arrays
  if (!existsSync(filePath)) {
    console.log(`File not found: ${filePath}`);
    return { nodes: 0, edges: 0 };
  }
  let raw;
  try { raw = JSON.parse(readFileSync(filePath, "utf-8")); } catch (e) {
    console.log(`Invalid JSON file: ${e.message}`);
    return { nodes: 0, edges: 0 };
  }
  const nodes = raw.nodes || [];
  const edges = raw.edges || [];
  if (opts.dryRun) return { nodes: nodes.length, edges: edges.length };

  let nodeCount = 0, edgeCount = 0;
  for (const n of nodes) {
    const normalized = normalizeGraphNode({
      id: n.id,
      label: n.label || n.name || n.title || n.id,
      type: n.type || n.category || n.kind || "imported",
      metadata: n.metadata || {},
      created: n.created,
    });
    try { if (upsertGraphNode(d, normalized)) nodeCount++; } catch {}
  }
  for (const e of edges) {
    const normalized = normalizeGraphEdge({
      source: e.source || e.from || e.src,
      target: e.target || e.to || e.dst,
      relation: e.relation || e.type || e.label || "related_to",
      confidence: e.confidence || "EXTRACTED",
      metadata: e.metadata || {},
      created: e.created,
    });
    try { if (upsertGraphEdge(d, normalized)) edgeCount++; } catch {}
  }
  syncGraphProjection(d, cwd);
  return { nodes: nodeCount, edges: edgeCount };
}

function ensureGraphStoreReady(d, cwd) {
  importLegacyGraphFile(d, cwd);
  if (!existsSync(mp(cwd, GF))) {
    syncGraphProjection(d, cwd);
  }
}

function hashText(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `h_${(hash >>> 0).toString(16)}`;
}

function ensureMemoryReady(c) {
  if (!existsSync(mp(c, ""))) {
    console.log("No memory/. Run: cm init");
    process.exit(1);
  }
}
