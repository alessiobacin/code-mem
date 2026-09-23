// Logic view: a plain-language map of what the software does, for people who
// are not developers. Units are source files (function/class nodes carry
// metadata.source_path); arrows are aggregated cross-file calls. The harness
// LLM groups files into parts and names them in the README's language. The
// map lives in cm_meta (derived data): without an LLM a previous map is
// carried forward over file changes and marked stale until renamed.

const LOGIC_META_KEY = "logic_map";
const LOGIC_MAX_PARTS = 9;

function logicInventory(graph) {
  const fileOf = new Map();
  const symbols = new Map();
  for (const node of graph.nodes || []) {
    const path = node.metadata?.source_path;
    if (!path || (node.type !== "function" && node.type !== "class")) continue;
    fileOf.set(node.id, path);
    if (!symbols.has(path)) symbols.set(path, new Set());
    symbols.get(path).add(String(node.label || node.id));
  }
  const weights = new Map();
  for (const edge of graph.edges || []) {
    if (edge.relation !== "calls") continue;
    const from = fileOf.get(edge.source), to = fileOf.get(edge.target);
    if (!from || !to || from === to) continue;
    const key = `${from}\u0000${to}`;
    weights.set(key, (weights.get(key) || 0) + 1);
  }
  return {
    files: [...symbols.keys()].sort().map((path) => ({ path, symbols: [...symbols.get(path)].sort() })),
    links: [...weights].map(([key, weight]) => {
      const [from, to] = key.split("\u0000");
      return { from, to, weight };
    }).sort((a, b) => b.weight - a.weight || a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
  };
}

// Structure only (files + symbol names): body edits keep the names valid,
// added/removed/renamed code makes the map stale.
function logicFingerprint(inventory) {
  return createHash("sha256").update(JSON.stringify(inventory.files)).digest("hex").slice(0, 16);
}

// Attach unassigned files to the part they call/are called by most.
// ponytail: greedy passes, fine for the <=9-part maps this builds.
function assignLogicOrphans(parts, inventory) {
  const partOf = new Map();
  for (const part of parts) for (const file of part.files) partOf.set(file, part);
  for (let pass = 0; pass < 3; pass += 1) {
    let moved = false;
    for (const { path } of inventory.files) {
      if (partOf.has(path)) continue;
      const score = new Map();
      for (const link of inventory.links) {
        const other = link.from === path ? link.to : link.to === path ? link.from : null;
        const part = other && partOf.get(other);
        if (part) score.set(part, (score.get(part) || 0) + link.weight);
      }
      const best = [...score].sort((a, b) => b[1] - a[1])[0];
      if (best) { best[0].files.push(path); partOf.set(path, best[0]); moved = true; }
    }
    if (!moved) break;
  }
}

function logicFlowWeights(parts, flows, inventory) {
  const partOf = new Map();
  for (const part of parts) for (const file of part.files) partOf.set(file, part.id);
  const ids = new Set(parts.map((part) => part.id));
  const seen = new Set();
  const out = [];
  for (const flow of flows || []) {
    const from = String(flow?.from || ""), to = String(flow?.to || "");
    if (!ids.has(from) || !ids.has(to) || from === to || seen.has(`${from}>${to}`)) continue;
    seen.add(`${from}>${to}`);
    let weight = 0;
    for (const link of inventory.links) {
      const a = partOf.get(link.from), b = partOf.get(link.to);
      if ((a === from && b === to) || (a === to && b === from)) weight += link.weight;
    }
    out.push({ from, to, verb: String(flow?.verb || "").replace(/\s+/g, " ").trim().slice(0, 40), weight });
  }
  return out;
}

function normalizeLogicMap(raw, inventory) {
  const known = new Set(inventory.files.map((file) => file.path));
  const taken = new Set();
  const parts = [];
  for (const item of Array.isArray(raw?.parts) ? raw.parts : []) {
    if (parts.length >= LOGIC_MAX_PARTS) break;
    const name = String(item?.name || "").replace(/\s+/g, " ").trim().slice(0, 40);
    const id = String(item?.id || name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    if (!name || !id || parts.some((part) => part.id === id)) continue;
    const files = (Array.isArray(item?.files) ? item.files : []).map(String).filter((file) => known.has(file) && !taken.has(file));
    files.forEach((file) => taken.add(file));
    parts.push({
      id,
      name,
      emoji: Array.from(String(item?.emoji || "🧩").trim()).slice(0, 2).join("") || "🧩",
      summary: String(item?.summary || "").replace(/\s+/g, " ").trim().slice(0, 240),
      files,
    });
  }
  assignLogicOrphans(parts, inventory);
  const kept = parts.filter((part) => part.files.length);
  if (!kept.length) return null;
  return {
    language: String(raw?.language || "").slice(0, 30),
    fingerprint: logicFingerprint(inventory),
    stale: false,
    parts: kept,
    flows: logicFlowWeights(kept, raw?.flows, inventory),
  };
}

function carryLogicMap(prev, inventory) {
  const known = new Set(inventory.files.map((file) => file.path));
  const parts = (prev.parts || []).map((part) => ({ ...part, files: (part.files || []).filter((file) => known.has(file)) }));
  assignLogicOrphans(parts, inventory);
  const kept = parts.filter((part) => part.files.length);
  return {
    ...prev,
    stale: Boolean(prev.stale) || prev.fingerprint !== logicFingerprint(inventory),
    parts: kept,
    flows: logicFlowWeights(kept, prev.flows, inventory),
  };
}

function readLogicMap(d) {
  return safeJsonParse(getMeta(d, LOGIC_META_KEY) || "null", null);
}

function logicReadmeExcerpt(cwd) {
  for (const name of ["README.md", "readme.md", "README.markdown", "README.txt", "README"]) {
    try { return readFileSync(join(cwd, name), "utf8").slice(0, 1500); } catch {}
  }
  return "";
}

function logicPrompt(inventory, readme, prev) {
  const files = inventory.files.slice(0, 220).map((file) => `${file.path}: ${file.symbols.slice(0, 12).join(", ")}`);
  const links = inventory.links.slice(0, 160).map((link) => `${link.from} -> ${link.to} (${link.weight})`);
  const previous = prev ? JSON.stringify((prev.parts || []).map(({ id, emoji, name, files: owned }) => ({ id, emoji, name, files: owned }))) : "none";
  return [
    "You explain software to people who are not programmers (think of a curious 10-year-old). Work read-only and return JSON only.",
    `Group the source files below into 3-${LOGIC_MAX_PARTS} PARTS that each do one understandable job, then say how the parts work together.`,
    "Rules:",
    "- Write every name, summary and verb in the language of the README excerpt (English if there is no README).",
    "- Part name: 1-3 everyday words, a friendly role or metaphor (like \"The Librarian\" or \"The Front Door\"). Never use technical words such as API, database, function, module, server, cache, parser, file, class, script, SQL, JSON, CLI, hook, graph, query.",
    "- Summary: one short sentence about what the part does for the person using the software, with no jargon.",
    "- Flow verb: 1-4 plain words for what one part does with another (like \"asks\" or \"writes notes in\").",
    "- Every file belongs to exactly one part; copy paths exactly. Group by purpose, not by folder. Tests go together in a part about checking the work.",
    "- When PREVIOUS PARTS are given, keep their id, emoji and name if their job is unchanged.",
    'Output: {"language":"...","parts":[{"id":"short-kebab-id","emoji":"one emoji","name":"...","summary":"...","files":["exact/path"]}],"flows":[{"from":"part-id","to":"part-id","verb":"..."}]}',
    `README excerpt:\n${readme || "(none)"}`,
    `FILES (path: main names inside):\n${files.join("\n")}`,
    `LINKS (calls between files):\n${links.join("\n") || "(none)"}`,
    `PREVIOUS PARTS: ${previous}`,
  ].join("\n");
}

function refreshLogicMap(d, cwd, harness, graph, opts = {}) {
  const inventory = logicInventory(graph);
  if (!inventory.files.length) return { status: "no-code", map: null };
  const prev = readLogicMap(d);
  if (prev && !opts.force && prev.fingerprint === logicFingerprint(inventory)) return { status: "unchanged", map: prev };
  let map = null;
  let error = "";
  if (harness?.available && process.env.CM_NO_LLM !== "1") {
    const result = runHarnessPrompt(harness, logicPrompt(inventory, logicReadmeExcerpt(cwd), prev), cwd, { timeout: Number(process.env.CM_LLM_TIMEOUT_MS || 120000) });
    map = normalizeLogicMap(result.data, inventory);
    if (map) Object.assign(map, { model: harness.model || harness.name, generated_at: nowIso() });
    else error = String(result.error || "invalid JSON").split("\n").pop().trim().slice(0, 200) || "invalid JSON";
  }
  if (!map && prev) map = carryLogicMap(prev, inventory);
  if (!map) return { status: "needs-llm", map: null, error };
  setMeta(d, LOGIC_META_KEY, JSON.stringify(map));
  return { status: map.stale ? "stale" : "updated", map, error };
}

function logicStatusLine(logic) {
  const parts = logic.map ? `${logic.map.parts.length} parts, ${logic.map.flows.length} flows` : "";
  if (logic.status === "no-code") return "Logic view: no source code with functions/classes indexed yet (run cm update --memory --deep).";
  if (logic.status === "needs-llm") return `Logic view: needs an LLM harness to name the parts (none available${logic.error ? `: ${logic.error}` : ""}).`;
  if (logic.status === "stale") return `Logic view: ${parts} (code changed; names kept until an LLM harness is available).`;
  return `Logic view: ${parts} (${logic.status}).`;
}

function printLogicMap(map) {
  if (!map) return;
  const byId = new Map(map.parts.map((part) => [part.id, part]));
  console.log(`How it works${map.stale ? " (may be outdated: run with an LLM harness to rename)" : ""}:`);
  for (const part of map.parts) console.log(`  ${part.emoji} ${part.name} — ${part.summary || ""} [${part.files.length} file(s)]`);
  for (const flow of map.flows) {
    const from = byId.get(flow.from), to = byId.get(flow.to);
    console.log(`  ${from.emoji} ${from.name} → ${flow.verb} → ${to.emoji} ${to.name}`);
  }
}
