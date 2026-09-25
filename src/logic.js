// Logic view: a plain-language map of what the software does, for people who
// are not developers. Units are source files (function/class nodes carry
// metadata.source_path); arrows are aggregated cross-file calls. The harness
// LLM groups files into parts and names them in the README's language. The
// map lives in cm_meta (derived data): without an LLM a previous map is
// carried forward over file changes and marked stale until renamed.

const LOGIC_META_KEY = "logic_map";
const LOGIC_MAX_PARTS = 9;
const LOGIC_MAX_UNITS = 120;

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

// What the LLM sees and answers with: single files for small repos; folders
// ("dir/") for big ones, so the reply never has to echo hundreds of paths
// (it truncated on a 450-file repo). Coarsens the folder depth until it fits.
function logicUnits(inventory) {
  if (inventory.files.length <= LOGIC_MAX_UNITS) return inventory.files.map((file) => ({ key: file.path, count: 1, symbols: file.symbols }));
  let units = [];
  for (const depth of [Infinity, 2, 1]) {
    const byKey = new Map();
    for (const file of inventory.files) {
      const dirs = file.path.split("/").slice(0, -1).slice(0, depth);
      const key = dirs.length ? `${dirs.join("/")}/` : file.path;
      const unit = byKey.get(key) || { key, count: 0, symbols: [] };
      unit.count += 1;
      for (const symbol of file.symbols) if (unit.symbols.length < 8) unit.symbols.push(symbol);
      byKey.set(key, unit);
    }
    units = [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
    if (units.length <= LOGIC_MAX_UNITS) break;
  }
  return units;
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
    const files = (Array.isArray(item?.files) ? item.files : []).map(String)
      .flatMap((entry) => entry.endsWith("/") ? inventory.files.map((file) => file.path).filter((file) => file.startsWith(entry)) : [entry])
      .filter((file) => {
        if (!known.has(file) || taken.has(file)) return false;
        taken.add(file);
        return true;
      });
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

function logicSlug(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

// Flowchart of the whole app in plain words: journeys ("When you ...") made of
// start/step/decision/store/end nodes placed in the parts. Journey membership
// is recomputed from the links (breadth-first from its start), so the LLM
// cannot claim a node it never connected; unreachable nodes are dropped.
function normalizeLogicFlow(raw, map) {
  const kinds = new Set(["start", "step", "decision", "store", "end"]);
  const partIds = new Set((map?.parts || []).map((part) => part.id));
  const text = (value, max) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
  const byId = new Map();
  // Compact wire format keeps big flowcharts under the model's output cap:
  // node = [id, kind, part, title, detail], link = "from>to|label".
  for (const entry of Array.isArray(raw?.nodes) ? raw.nodes : []) {
    const item = Array.isArray(entry) ? { id: entry[0], kind: entry[1], part: entry[2], title: entry[3], detail: entry[4] } : entry;
    const id = logicSlug(item?.id);
    const title = text(item?.title, 70);
    if (!id || !title || byId.has(id) || byId.size >= 160) continue;
    byId.set(id, {
      id,
      kind: kinds.has(item?.kind) ? item.kind : "step",
      title,
      detail: text(item?.detail, 320),
      part: partIds.has(String(item?.part)) ? String(item.part) : null,
    });
  }
  const links = [];
  for (const entry of Array.isArray(raw?.links) ? raw.links : []) {
    let item = entry;
    if (typeof entry === "string") {
      const [route, ...label] = entry.split("|");
      const [from, to] = route.split(">");
      item = { from, to, label: label.join("|") };
    }
    const from = logicSlug(item?.from), to = logicSlug(item?.to);
    if (!byId.has(from) || !byId.has(to) || from === to || links.length >= 400) continue;
    const label = text(item?.label, 40);
    const same = links.find((link) => link.from === from && link.to === to);
    // several answers leading to the same step become one arrow "a / b"
    if (same) { if (label && !same.label.split(" / ").includes(label)) same.label = text(same.label ? `${same.label} / ${label}` : label, 60); continue; }
    links.push({ from, to, label });
  }
  const out = new Map();
  for (const link of links) out.set(link.from, (out.get(link.from) || []).concat(link.to));
  for (const node of byId.values()) if (node.kind === "decision" && (out.get(node.id) || []).length < 2) node.kind = "step";
  const journeys = [];
  const reached = new Set();
  for (const item of Array.isArray(raw?.journeys) ? raw.journeys : []) {
    const id = logicSlug(item?.id || item?.title);
    const start = logicSlug(item?.start);
    if (!id || !byId.has(start) || journeys.some((journey) => journey.id === id) || journeys.length >= 12) continue;
    // With an explicit step list the path is walked inside that list only.
    const listed = Array.isArray(item?.steps) ? new Set(item.steps.map(logicSlug).filter((nodeId) => byId.has(nodeId)).concat(start)) : null;
    const order = [start];
    const visited = new Set(order);
    for (let i = 0; i < order.length; i += 1) {
      for (const next of out.get(order[i]) || []) if (!visited.has(next) && (!listed || listed.has(next))) { visited.add(next); order.push(next); }
    }
    if (order.length < 2) continue;
    order.forEach((nodeId) => reached.add(nodeId));
    journeys.push({ id, title: text(item?.title, 80) || id, summary: text(item?.summary, 240), start, nodes: order });
  }
  if (!journeys.length) return null;
  return {
    journeys,
    nodes: [...byId.values()].filter((node) => reached.has(node.id)),
    links: links.filter((link) => reached.has(link.from) && reached.has(link.to)),
  };
}

// A failed flowchart pass must not erase a working flowchart: keep the
// previous one (nodes of vanished parts become part-less) and flag it stale.
function keepPreviousFlow(map, prev) {
  if (!prev?.flow || map.flow) return map;
  const ids = new Set(map.parts.map((part) => part.id));
  return { ...map, stale: true, flow: { ...prev.flow, nodes: prev.flow.nodes.map((node) => ({ ...node, part: ids.has(node.part) ? node.part : null })) } };
}

function carryLogicMap(prev, inventory) {
  const known = new Set(inventory.files.map((file) => file.path));
  const parts = (prev.parts || []).map((part) => ({ ...part, files: (part.files || []).filter((file) => known.has(file)) }));
  assignLogicOrphans(parts, inventory);
  const kept = parts.filter((part) => part.files.length);
  const keptIds = new Set(kept.map((part) => part.id));
  return {
    ...prev,
    stale: Boolean(prev.stale) || prev.fingerprint !== logicFingerprint(inventory),
    parts: kept,
    flows: logicFlowWeights(kept, prev.flows, inventory),
    flow: prev.flow ? { ...prev.flow, nodes: prev.flow.nodes.map((node) => ({ ...node, part: keptIds.has(node.part) ? node.part : null })) } : undefined,
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
  const units = logicUnits(inventory);
  const folders = units.some((unit) => unit.key.endsWith("/"));
  const files = units.slice(0, LOGIC_MAX_UNITS).map((unit) => `${unit.key}${unit.count > 1 ? ` (${unit.count} files)` : ""}: ${unit.symbols.slice(0, 12).join(", ")}`);
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
    folders
      ? "- The list below has FOLDERS (ending in /) and files. Every entry belongs to exactly one part; copy entries exactly, including the trailing /. Tests go together in a part about checking the work."
      : "- Every file belongs to exactly one part; copy paths exactly. Group by purpose, not by folder. Tests go together in a part about checking the work.",
    "- When PREVIOUS PARTS are given, keep their id, emoji and name if their job is unchanged.",
    'Output: {"language":"...","parts":[{"id":"short-kebab-id","emoji":"one emoji","name":"...","summary":"...","files":["exact/path"]}],"flows":[{"from":"part-id","to":"part-id","verb":"..."}]}',
    `README excerpt:\n${readme || "(none)"}`,
    `${folders ? "ENTRIES" : "FILES"} (path: main names inside):\n${files.join("\n")}`,
    `LINKS (calls between files):\n${links.join("\n") || "(none)"}`,
    `PREVIOUS PARTS: ${previous}`,
  ].join("\n");
}

function logicFlowRules(map) {
  return [
    "Rules:",
    map.language
      ? `- Write EVERY title, summary, detail and label in this language: ${map.language} (the same language as the PART names below), even though the code is written in English.`
      : "- Write every title, detail and label in the language of the README excerpt (English if there is no README).",
    "- Titles: 2-7 plain words that say what happens, not how it is coded. A decision title is a question ending with \"?\". Never use technical words such as API, database, function, module, server, endpoint, request, cache, parser, file, class, script, SQL, JSON, CLI, token, hook, query, handler, array.",
    "- Keep the output compact: no extra text, only the JSON.",
  ];
}

function logicFlowContext(inventory, readme, map) {
  const parts = map.parts.map((part) => `${part.id} = ${part.emoji} ${part.name}: ${part.summary} [files: ${part.files.slice(0, 40).join(", ")}${part.files.length > 40 ? ", ..." : ""}]`);
  return [
    `PARTS:\n${parts.join("\n")}`,
    `README excerpt:\n${readme || "(none)"}`,
    `SOURCE (path: main names inside):\n${logicUnits(inventory).slice(0, LOGIC_MAX_UNITS).map((unit) => `${unit.key}: ${unit.symbols.slice(0, 10).join(", ")}`).join("\n")}`,
  ];
}

// Pass 1 of the flowchart: only the list of journeys (small reply).
function logicJourneysPrompt(inventory, readme, map) {
  return [
    "You plan the \"How it works\" flowchart of this software for people who are not programmers. Work read-only and return JSON only.",
    "Open and read the source files (use your read tool; start from entry points such as main files, commands, routes, pages, handlers) until you understand what the software really does.",
    "List 4-10 JOURNEYS. A journey starts from something that happens (a person runs a command, opens a page, clicks a button, a timer fires, a message arrives) and follows what the software does until it ends. Together the journeys must cover everything important the software does.",
    ...logicFlowRules(map),
    'Output: {"journeys":[{"id":"kebab-id","title":"When you ...","summary":"one sentence"}]}',
    ...logicFlowContext(inventory, readme, map),
  ].join("\n");
}

// Pass 2, one call per journey (small replies, run in parallel).
function logicJourneyPrompt(inventory, readme, map, journey, all) {
  return [
    "You write ONE journey of the \"How it works\" flowchart of this software for people who are not programmers. Work read-only and return JSON only.",
    `JOURNEY: ${journey.title} — ${journey.summary}`,
    `Other journeys (described separately, do not repeat them): ${all.filter((item) => item.id !== journey.id).map((item) => item.title).join("; ") || "none"}`,
    "Open and read the source files that this journey goes through (use your read tool) and describe every step the software takes, every DECISION it makes (a question with one link per possible answer), where things are KEPT, and every ENDING (done, error, refused, stopped).",
    ...logicFlowRules(map),
    "- 6-25 nodes. kind: start (what begins the journey, exactly one), step (something the software does), decision (a question with 2+ answers), store (where things are kept), end (where the journey stops).",
    "- detail: one short plain sentence (at most 20 words) a curious 10-year-old understands.",
    "- Every node belongs to one PART id from the list below. Use short ids like n1, n2.",
    "- links go from a node to the next one (\"from>to\"); every link leaving a decision has a short answer label after | (\"yes\", \"no\", \"only the first time\").",
    'Output: {"start":"n1","nodes":[["n1","start|step|decision|store|end","part-id","title","detail"]],"links":["n1>n2","n2>n3|yes","n2>n4|no"]}',
    ...logicFlowContext(inventory, readme, map),
  ].join("\n");
}

// Joins per-journey answers into one normalizeLogicFlow input. Ids are
// namespaced per journey; steps with the same kind, part and title are the
// same step, so journeys that share it stay connected.
function mergeJourneyFlows(results) {
  const canonical = new Map();
  const nodes = [];
  const links = [];
  const journeys = [];
  results.forEach(({ journey, raw }, index) => {
    if (!raw || !Array.isArray(raw.nodes)) return;
    const local = new Map();
    const steps = [];
    for (const entry of raw.nodes) {
      const item = Array.isArray(entry) ? entry : [entry?.id, entry?.kind, entry?.part, entry?.title, entry?.detail];
      if (!item[0] || !item[3]) continue;
      const key = `${item[1]}|${item[2]}|${String(item[3]).toLowerCase().replace(/\s+/g, " ").trim()}`;
      let id = canonical.get(key);
      if (!id) {
        id = `j${index}-${item[0]}`;
        canonical.set(key, id);
        nodes.push([id, item[1], item[2], item[3], item[4] || ""]);
      }
      local.set(String(item[0]), id);
      if (!steps.includes(id)) steps.push(id);
    }
    const start = local.get(String(raw.start));
    if (!start) return;
    for (const entry of Array.isArray(raw.links) ? raw.links : []) {
      const [route, ...label] = String(typeof entry === "string" ? entry : `${entry?.from}>${entry?.to}${entry?.label ? `|${entry.label}` : ""}`).split("|");
      const [from, to] = route.split(">");
      if (local.has(from) && local.has(to)) links.push(`${local.get(from)}>${local.get(to)}${label.length ? `|${label.join("|")}` : ""}`);
    }
    journeys.push({ id: journey.id, title: journey.title, summary: journey.summary, start, steps });
  });
  return { journeys, nodes, links };
}

async function refreshLogicMap(d, cwd, harness, graph, opts = {}) {
  const inventory = logicInventory(graph);
  if (!inventory.files.length) return { status: "no-code", map: null };
  const prev = readLogicMap(d);
  const llm = Boolean(harness?.available) && process.env.CM_NO_LLM !== "1";
  const same = prev && !opts.force && prev.fingerprint === logicFingerprint(inventory);
  if (same && (prev.flow || !llm)) return { status: "unchanged", map: prev };
  let map = same ? prev : null;
  let error = "";
  if (!map && llm) {
    const result = runHarnessPrompt(harness, logicPrompt(inventory, logicReadmeExcerpt(cwd), prev), cwd, { timeout: Number(process.env.CM_LLM_TIMEOUT_MS || 120000) });
    map = normalizeLogicMap(result.data, inventory);
    if (map) Object.assign(map, { model: harness.model || harness.name, generated_at: nowIso() });
    else error = String(result.error || "invalid JSON").split("\n").pop().trim().slice(0, 200) || "invalid JSON";
  }
  if (map && llm && (!map.flow || map !== prev)) {
    // Flowchart: the harness reads the code (read-only tools). Pass 1 lists
    // the journeys, pass 2 describes each journey in its own small call (3 in
    // parallel), so big repos never hit the model's output cap. Parts stay
    // usable and a previous flowchart is kept when this fails.
    const readme = logicReadmeExcerpt(cwd);
    const timeout = Number(process.env.CM_LOGIC_FLOW_TIMEOUT_MS || 600000);
    let planned = [];
    for (let attempt = 0; attempt < 2 && !planned.length; attempt += 1) {
      const result = await runHarnessPromptAsync(harness, logicJourneysPrompt(inventory, readme, map), cwd, { readTools: true, timeout });
      planned = (Array.isArray(result.data?.journeys) ? result.data.journeys : [])
        .map((item) => ({ id: logicSlug(item?.id || item?.title), title: String(item?.title || "").trim().slice(0, 80), summary: String(item?.summary || "").trim().slice(0, 240) }))
        .filter((item) => item.id && item.title).slice(0, 10);
      if (!planned.length) error = String(result.error || "journeys: invalid JSON").split("\n").pop().trim().slice(0, 200) || "journeys: invalid JSON";
    }
    let flow = null;
    if (planned.length) {
      const answers = await docMapPool(planned, 3, async (journey) => {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const result = await runHarnessPromptAsync(harness, logicJourneyPrompt(inventory, readme, map, journey, planned), cwd, { readTools: true, timeout });
          if (Array.isArray(result.data?.nodes) && result.data.start) return { journey, raw: result.data };
        }
        return { journey, raw: null };
      });
      flow = normalizeLogicFlow(mergeJourneyFlows(answers), map);
      if (!flow) error = "flowchart: no journey could be described";
    }
    if (flow) { map = { ...map, flow }; error = ""; }
    else map = keepPreviousFlow(map, prev);
  }
  if (!map && prev) map = carryLogicMap(prev, inventory);
  if (!map) return { status: "needs-llm", map: null, error };
  setMeta(d, LOGIC_META_KEY, JSON.stringify(map));
  return { status: map.stale ? "stale" : "updated", map, error };
}

function logicStatusLine(logic) {
  const flow = logic.map?.flow ? `, ${logic.map.flow.journeys.length} journeys, ${logic.map.flow.nodes.length} steps` : "";
  const parts = logic.map ? `${logic.map.parts.length} parts, ${logic.map.flows.length} flows${flow}` : "";
  if (logic.status === "no-code") return "Logic view: no source code with functions/classes indexed yet (run cm update --memory --deep).";
  if (logic.status === "needs-llm") return `Logic view: needs an LLM harness to name the parts (none available${logic.error ? `: ${logic.error}` : ""}).`;
  if (logic.status === "stale") return `Logic view: ${parts} (code changed; names kept until an LLM harness is available).`;
  return `Logic view: ${parts} (${logic.status}${logic.error ? `; ${logic.error}` : ""}).`;
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
  for (const journey of map.flow?.journeys || []) console.log(`  ▶ ${journey.title} (${journey.nodes.length} steps)`);
}
