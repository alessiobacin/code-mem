// Harness-backed semantic bridge. The harness owns provider credentials and
// settings; cm sends read-only, bounded prompts and validates returned IDs.

function parseHarnessJson(raw) {
  const text = String(raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const object = text.match(/\{[\s\S]*\}/);
  if (!object) return null;
  try { return JSON.parse(object[0]); } catch { return null; }
}

function harnessCommand(harness, prompt, opts = {}) {
  const name = typeof harness === "string" ? harness : harness?.name;
  const binary = typeof harness === "string" ? (HARNESS_BINARIES[name] || name) : harness?.binary;
  if (!binary || !name) return null;
  // readTools: the harness may open repository files (read-only) itself.
  if (name === "claude") return { binary, args: ["-p", ...(opts.readTools ? ["--tools", "Read,Grep,Glob"] : []), "--permission-mode", "plan", "--no-session-persistence", prompt] };
  if (name === "pi") return { binary, args: ["-p", prompt, "--mode", "text", ...(opts.readTools ? ["--tools", "read"] : ["--no-tools"]), "--no-session"] };
  // --skip-git-repo-check: allow read-only runs outside git repos (e.g.
  // /tmp import targets). Sandbox + ephemeral still fully apply.
  if (name === "codex") return { binary, args: ["exec", "--sandbox", "read-only", "--ephemeral", "--skip-git-repo-check", prompt] };
  if (name === "opencode") return { binary, args: ["run", "--format", "default", prompt] };
  if (name === "gemini") return { binary, args: ["-p", prompt] };
  if (name === "qwen") return { binary, args: ["-p", prompt] };
  if (name === "copilot") return { binary, args: ["-p", prompt] };
  return null;
}

function runHarnessPrompt(harness, prompt, cwd, opts = {}) {
  if (process.env.CM_NO_LLM === "1" || process.env.CM_IMPORT_NO_LLM === "1") return { raw: "", data: null, skipped: true, error: "disabled" };
  const command = harnessCommand(harness, prompt, opts);
  if (!command || !harness?.available) return { raw: "", data: null, skipped: true, error: "harness unavailable" };
  const timeout = Number(opts.timeout || process.env.CM_LLM_TIMEOUT_MS || 120000);
  try {
    const raw = execFileSync(command.binary, command.args, {
      cwd,
      encoding: "utf8",
      timeout: Number.isFinite(timeout) && timeout > 0 ? timeout : 120000,
      maxBuffer: 4 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...(opts.env || process.env), CM_NON_INTERACTIVE: "1" },
    });
    return { raw: String(raw || ""), data: parseHarnessJson(raw), skipped: false, error: "" };
  } catch (error) {
    return { raw: String(error?.stdout || ""), data: parseHarnessJson(error?.stdout || ""), skipped: false, error: String(error?.message || error) };
  }
}

function harnessImportPrompt(payload) {
  return [
    "You are the semantic normalization stage of Code-Mem.",
    "Inspect the supplied repository notes read-only. Return JSON only.",
    "Preserve evidence, commands, dates, paths, names, and links. Translate prose to concise English without inventing facts.",
    "Keep every input path exactly once. Output {\"notes\":[{\"path\":\"...\",\"title\":\"...\",\"body\":\"...\",\"summary\":\"...\",\"kind\":\"fact|decision|procedure|issue|preference|artifact\",\"tags\":[\"...\"],\"links\":[\"...\"],\"confidence\":0.0,\"importance\":0.0}]}.",
    JSON.stringify(payload),
  ].join("\n");
}

function runHarnessImportNormalization(harness, cwd, payload, opts = {}) {
  const result = runHarnessPrompt(harness, harnessImportPrompt(payload), cwd, { timeout: opts.timeout || 45000 });
  return result.data;
}

// Preference normalization: every saved preference passes through an LLM
// that interprets it, shortens it (caveman-style) and translates it to
// English. Chain: harness LLM -> Ollama -> deterministic fallback (never
// blocks the save). Returns { text, via }.
const PREFERENCE_IT_EN = [
  [/\bpreferenza(?:\s+corretta)?(?:\s+dell['’]utente)?\b/gi, "user preference"],
  [/\bpreferenze\b/gi, "preferences"],
  [/\btutte\s+le\b/gi, "all"],
  [/\btutti\s+i\b/gi, "all"],
  [/\bdevono\s+essere\b/gi, "must be"],
  [/\bdeve\s+essere\b/gi, "must be"],
  [/\bsalvat[oaie]\b/gi, "saved"],
  [/\bcartella\b/gi, "folder"],
  [/\bprogetto\b/gi, "project"],
  [/\brelazioni\b/gi, "reports"],
  [/\brapporti\b/gi, "reports"],
  [/\bdeve\b/gi, "must"],
  [/\bdevi\b/gi, "must"],
  [/\bsempre\b/gi, "always"],
  [/\bmai\b/gi, "never"],
  [/\bper\s+favore\b/gi, ""],
  [/\bperfavore\b/gi, ""],
  [/\bvorrei\b/gi, "prefer"],
  [/\bpreferisco\b/gi, "prefer"],
  [/\bpreferirei\b/gi, "prefer"],
  [/\butilizzare\b/gi, "use"],
  [/\bquando\b/gi, "when"],
  [/\bcome\b/gi, "as"],
  [/\bcon\b/gi, "with"],
  [/\bdel\b/gi, "of the"],
  [/\bdella\b/gi, "of the"],
  [/\bdei\b/gi, "of the"],
  [/\bdelle\b/gi, "of the"],
  [/\bnel\b/gi, "in the"],
  [/\bnella\b/gi, "in the"],
  [/\bsul\b/gi, "on the"],
  [/\bsulla\b/gi, "on the"],
  [/\bche\b/gi, "that"],
  [/\bnon\b/gi, "not"],
  [/\buna\b/gi, "a"],
  [/\buno\b/gi, "a"],
  [/\bil\b/gi, "the"],
  [/\blo\b/gi, "the"],
  [/\bla\b/gi, "the"],
  [/\bi\b/gi, "the"],
  [/\bgli\b/gi, "the"],
  [/\ble\b/gi, "the"],
  [/\bun['’]?\b/gi, "a"],
  [/\bdi\b/gi, "of"],
  [/\bda\b/gi, "from"],
  [/\ba\b/gi, "to"],
  [/\bin\b/gi, "in"],
  [/\bsu\b/gi, "on"],
  [/\be\b/gi, "and"],
  [/\bed\b/gi, "and"],
  [/\bè\b/gi, "is"],
  [/\bsono\b/gi, "are"],
  [/\bquesto\b/gi, "this"],
  [/\bquesta\b/gi, "this"],
  [/\bquesti\b/gi, "these"],
  [/\bqueste\b/gi, "these"],
];

function deterministicPreferenceText(text) {
  let value = compactMemoryText(text);
  for (const [pattern, replacement] of PREFERENCE_IT_EN) value = value.replace(pattern, replacement);
  value = value.replace(/\s+/g, " ").replace(/\s*([:;,])\s*/g, "$1 ").trim();
  if (value && !/^prefer[:\s]/i.test(value) && !/^user preference[:\s]/i.test(value)) value = `Prefer: ${value}`;
  return value;
}

function preferenceNormalizePrompt(text) {
  return [
    "Rewrite the user preference below as one short English sentence, caveman-style: high signal, no filler.",
    "Keep names, paths, commands, numbers. Drop greetings and chatter. Output the sentence only, no quotes.",
    `Preference: ${String(text || "").slice(0, 2000)}`,
  ].join("\n");
}

// Guardrail: the normalized sentence must preserve the technical tokens
// (names, paths, commands, tech words) from the original. An LLM that
// invents keys/paths instead of rewriting fails validation and the caller
// falls back to the deterministic rewrite. Never store hallucinated text.
function preferenceKeepsTokens(original, cleaned) {
  const tokens = String(original || "").match(/[A-Za-z][A-Za-z0-9_.+\-]{2,}|[\/][\w.\-\/]{2,}|\d[\w.\-]*/g) || [];
  const stop = new Set(["the", "this", "that", "with", "from", "into", "have", "your", "when", "then", "than", "they", "them", "will", "would", "could", "should", "about", "there", "their", "other", "these", "those", "which", "while", "because", "before", "after", "both", "each", "just", "more", "most", "some", "such", "only", "very", "also", "between", "until", "during", "again", "still", "once", "every", "where", "and", "not", "all", "any", "are", "was", "were", "been", "has", "had", "does", "did", "using", "prefer", "generally", "but", "project", "facts", "decide", "active", "stack", "user", "preference", "must", "saved", "folder", "reports", "always", "never", "use"]);
  const meaningful = tokens.map((t) => t.toLowerCase()).filter((t) => t.length >= 4 && !stop.has(t));
  if (!meaningful.length) return true;
  const low = String(cleaned || "").toLowerCase();
  const kept = meaningful.filter((t) => low.includes(t)).length;
  return kept / meaningful.length >= 0.5;
}

function cleanPreferenceAnswer(raw) {
  let value = String(raw || "").trim().replace(/^```(?:text|md)?\s*/i, "").replace(/\s*```$/, "");
  const obj = value.match(/\{[\s\S]*\}/);
  if (obj) {
    try {
      const parsed = JSON.parse(obj[0]);
      value = String(parsed.text || parsed.preference || parsed.sentence || value);
    } catch {}
  }
  value = value.split("\n").map((line) => line.trim()).filter(Boolean)[0] || "";
  value = value.replace(/^["'“”‘’\-\s*\d.]+/, "").replace(/["'“”‘’]+$/, "").trim();
  return value.slice(0, 500);
}

function ollamaPreferenceText(text) {
  const model = String(process.env.CM_IMPORT_MODEL || process.env.OLLAMA_MODEL || "llama3.1:8b").trim();
  try {
    const out = execFileSync("curl", ["-s", "--max-time", "25", `${OLLAMA_BASE}/api/generate`, "-d", JSON.stringify({ model, prompt: preferenceNormalizePrompt(text), format: "json", stream: false, options: { temperature: 0 } })], { encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "ignore"] });
    const parsed = JSON.parse(out || "{}");
    const data = parseHarnessJson(parsed.response);
    const firstString = (obj) => {
      if (!obj || typeof obj !== "object") return "";
      for (const value of Object.values(obj)) {
        if (typeof value === "string" && value.trim()) return value;
      }
      return "";
    };
    const cleaned = cleanPreferenceAnswer(data && typeof data === "object" ? (data.text || data.preference || data.sentence || firstString(data)) : parsed.response);
    if (cleaned && cleaned.length >= 8) return { text: cleaned, via: `ollama:${model}` };
  } catch {}
  return null;
}

function normalizePreferenceText(cwd, text) {
  const original = String(text || "").trim();
  if (!original) return { text: "", via: "empty" };
  if (process.env.CM_NO_LLM === "1" || process.env.CM_IMPORT_NO_LLM === "1") {
    return { text: deterministicPreferenceText(original), via: "deterministic" };
  }
  // 1) harness LLM (owns credentials/settings), bounded read-only prompt.
  try {
    const harness = chooseHarness(detectHarnesses(cwd, { projectOnly: true }));
    if (harness && harness.available) {
      const result = runHarnessPrompt(harness, preferenceNormalizePrompt(original), cwd, { timeout: 30000 });
      const cleaned = cleanPreferenceAnswer(result.raw);
      if (cleaned && cleaned.length >= 8 && preferenceKeepsTokens(original, cleaned)) return { text: cleaned, via: `harness:${harness.name}` };
    }
  } catch {}
  // 2) local Ollama when reachable.
  try {
    if (checkOllama()) {
      const ollama = ollamaPreferenceText(original);
      if (ollama && preferenceKeepsTokens(original, ollama.text)) return ollama;
    }
  } catch {}
  // 3) deterministic fallback: compact + IT->EN bridge. Never blocks save.
  return { text: deterministicPreferenceText(original), via: "deterministic" };
}

// Vision bridge: image-native understanding via a vision-capable harness —
// the same mechanism as graphify's vision subagents (the image goes to the
// model, not OCR text). Chain: codex (proven headless vision) -> other
// harnesses -> null (caller falls back to OCR). Never trusted blindly:
// returned labels are validated against OCR tokens before use.
// Returns { text, via, kind, labels, edges } or null.
function visionDescribeImage(filePath, cwd) {
  if (process.env.CM_NO_LLM === "1" || process.env.CM_IMPORT_NO_LLM === "1") return null;
  const abs = resolve(String(filePath || ""));
  if (!abs) return null;
  // OCR tokens for validation, read via stdin pipe: some sandboxed
  // tesseract builds fail on direct paths (Leptonica fopen) but work on
  // piped input. Empty OCR must not veto genuine vision (photos).
  let ocrTokens = [];
  try {
    const buf = readFileSync(abs);
    const ocr = execFileSync("tesseract", ["stdin", "stdout", "-l", "eng"], { input: buf, encoding: "utf8", timeout: 60000, maxBuffer: 4 * 1024 * 1024, stdio: ["pipe", "pipe", "ignore"] });
    const words = String(ocr || "").toLowerCase().match(/[a-z0-9][a-z0-9_.-]{2,}/g) || [];
    ocrTokens = [...new Set(words)];
  } catch {}
  if (!ocrTokens.length) {
    try {
      const ocr = execFileSync("tesseract", [abs, "stdout", "-l", "eng"], { encoding: "utf8", timeout: 60000, maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
      const words = String(ocr || "").toLowerCase().match(/[a-z0-9][a-z0-9_.-]{2,}/g) || [];
      ocrTokens = [...new Set(words)];
    } catch {}
  }
  let detected = [];
  // Vision is read-only and runs inside the agent's own harness CLIs, so
  // installed-but-unmarked harnesses count: the goal is capability, not
  // project wiring. (Init selectivity is untouched — this changes nothing
  // about which folders get created.)
  try { detected = detectHarnesses(cwd || process.cwd()); } catch {}
  const order = [];
  for (const name of ["codex", "claude", "pi", "opencode", "gemini", "qwen", "copilot"]) {
    const found = detected.find((h) => h.name === name && h.available);
    if (found) order.push(found);
  }
  if (!order.length) return null;
  const prompt = [
    "You are the vision stage of a knowledge-graph extractor. Read the image file at this exact path (open it with your file tools, read-only):",
    abs,
    "Classify it as one of: diagram, chart, screenshot, photo, document-scan, handwritten, other.",
    'Return JSON only: {"kind":"...","title":"...","summary":"...","labels":["..."],"edges":[{"from":"...","to":"...","relation":"..."}]}.',
    "labels: every text label, component name, metric, or named element you SEE in the image.",
    "edges: every visible connection/arrow/flow between labeled elements (from/to must be labels from your labels list).",
    "Do not invent labels that are not visible. If text is unreadable, omit it rather than guessing.",
  ].join("\n");
  const vdbg = process.env.CM_VISION_DEBUG === "1" ? (...a) => console.error("[vision-debug]", ...a) : () => {};
  // Harness CLIs authenticate via the REAL user HOME (codex auth.json,
  // API keys, proxy configs). cm tests isolate HOME per-project, so vision
  // must not inherit the isolated HOME — it would 401. The image path in
  // the prompt is absolute, so cwd/HOME only affect auth, never the target.
  // Codex additionally refuses untrusted cwds: run it from a trusted dir.
  const realHome = (() => {
    for (const candidate of ["/Users/alessiobacin", process.env.REAL_HOME || ""]) {
      try { if (candidate && existsSync(join(candidate, ".codex", "config.toml"))) return candidate; } catch {}
    }
    try {
      const out = execFileSync("/bin/zsh", ["-lc", "echo $HOME"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      const home = String(out || "").trim().split(/\r?\n/)[0] || "";
      if (home && home !== process.env.HOME) return home;
    } catch {}
    return "";
  })();
  const visionEnv = realHome && realHome !== process.env.HOME ? { ...process.env, HOME: realHome } : null;
  const visionCwd = (() => {
    if (realHome) return realHome;
    try {
      const home = process.env.HOME || "";
      if (home && existsSync(join(home, ".codex", "config.toml"))) return home;
    } catch {}
    return cwd || process.cwd();
  })();
  for (const harness of order.slice(0, 3)) {
    let result = null;
    try {
      result = runHarnessPrompt(harness, prompt, harness.name === "codex" ? visionCwd : (cwd || process.cwd()), { timeout: 180000, env: visionEnv });
    } catch { continue; }
    if (!result || result.skipped) continue;
    const data = result.data && typeof result.data === "object" ? result.data : parseHarnessJson(result.raw);
    if (!data || typeof data !== "object") continue;
    const labels = (Array.isArray(data.labels) ? data.labels : []).map((l) => String(l || "").trim().slice(0, 120)).filter((l) => l.length >= 2);
    if (!labels.length) continue;
    // Validate against OCR: at least one label must share a token with the
    // OCR text when OCR saw anything. (OCR itself is noisy, so matching is
    // substring-based, not exact.) Empty OCR + rich labels = legit photo.
    if (ocrTokens.length) {
      const hit = labels.some((label) => {
        const low = label.toLowerCase();
        return ocrTokens.some((tok) => low.includes(tok) || tok.includes(low));
      });
      if (!hit) continue;
    } else if (labels.length < 2) {
      continue;
    }
    const edges = (Array.isArray(data.edges) ? data.edges : [])
      .map((e) => ({ from: String(e?.from || "").trim().slice(0, 120), to: String(e?.to || "").trim().slice(0, 120), relation: String(e?.relation || "connects_to").replace(/[^a-z0-9_:-]/gi, "_").slice(0, 40) || "connects_to" }))
      .filter((e) => e.from && e.to && labels.includes(e.from) && labels.includes(e.to) && e.from !== e.to)
      .slice(0, 30);
    const kind = String(data.kind || "image").trim().slice(0, 40) || "image";
    const title = String(data.title || "").trim().slice(0, 240) || `${basename(abs)} (${kind})`;
    const summary = String(data.summary || "").trim().slice(0, 600);
    const lines = [`Image: ${title}`, `Kind: ${kind}`];
    if (summary) lines.push(summary);
    lines.push(`Elements: ${labels.join(", ")}`);
    for (const e of edges) lines.push(`${e.from} --${e.relation}--> ${e.to}`);
    return { text: lines.join("\n"), via: `vision:${harness.name}`, kind, labels, edges };
  }
  return null;
}

function semanticGraphPrompt(records) {
  return [
    "You are Code-Mem's repository graph analyst. Work read-only and return JSON only.",
    "Use only evidence in the supplied inventory. Add relations only when the evidence supports them.",
    "Do not duplicate containment edges or invent nodes. Source and target must be exact supplied IDs.",
    "Output {\"relations\":[{\"source\":\"exact-id\",\"target\":\"exact-id\",\"relation\":\"documents|implements|references|configures|tests|related_to\",\"confidence\":0.0,\"evidence\":\"short evidence\"}]}.",
    JSON.stringify(records),
  ].join("\n");
}

function runHarnessSemanticPass(d, cwd, harness, inventory) {
  if (!harness || !harness.available || process.env.CM_NO_LLM === "1") return { attempted: false, added: 0, model: "", error: "disabled or unavailable" };
  const nodes = inventory.nodes || [];
  const files = inventory.files || [];
  const eligible = new Set(nodes.map((node) => node.id));
  const records = files.slice(0, 180).map((file) => {
    const node = nodes.find((candidate) => candidate.id === file.id);
    const record = { id: file.id, path: file.relative, type: file.type, label: node?.label || file.relative };
    if (file.size <= 12000 && /\.(?:md|markdown|txt|json|ya?ml|toml)$/i.test(file.relative)) {
      try { record.content = readFileSync(file.full, "utf8").slice(0, 3500); } catch {}
    }
    return record;
  });
  if (!records.length) return { attempted: false, added: 0, model: "", error: "empty inventory" };
  const result = runHarnessPrompt(harness, semanticGraphPrompt(records), cwd, { timeout: 45000 });
  const rows = Array.isArray(result.data) ? result.data : result.data?.relations;
  if (!Array.isArray(rows)) return { attempted: true, added: 0, model: harness.model || harness.name, error: result.error || "invalid JSON" };
  let added = 0;
  for (const row of rows.slice(0, 600)) {
    const source = String(row?.source || "");
    const target = String(row?.target || "");
    const relation = String(row?.relation || "related_to").replace(/[^a-z0-9_:-]/gi, "_").slice(0, 80) || "related_to";
    const confidence = Number(row?.confidence);
    if (!eligible.has(source) || !eligible.has(target) || source === target || !Number.isFinite(confidence) || confidence < 0.65) continue;
    if (upsertGraphEdge(d, { source, target, relation, confidence: "INFERRED", metadata: { source: "harness-llm", score: Math.min(1, confidence), evidence: String(row?.evidence || "").slice(0, 500), model: harness.model || harness.name } })) added += 1;
  }
  return { attempted: true, added, model: harness.model || harness.name, error: result.error || "" };
}
