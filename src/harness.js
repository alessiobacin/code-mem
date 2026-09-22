// Harness discovery and project-local integration.
//
// The integration intentionally invokes harness CLIs instead of reading API
// keys. Harnesses retain ownership of authentication, provider selection, and
// model settings; cm only reports safe model/provider labels and asks the CLI
// for a bounded, read-only semantic pass.

const HARNESS_BINARIES = {
  claude: "claude",
  pi: "pi",
  codex: "codex",
  opencode: "opencode",
  gemini: "gemini",
  qwen: "qwen",
  copilot: "copilot",
  cursor: "cursor-agent",
  windsurf: "windsurf",
};

const HARNESS_SETTINGS = {
  claude: [".claude/settings.json", ".claude/config.json"],
  pi: [".pi/settings.json", ".pi/agent/settings.json", ".pi/agent/config.json"],
  codex: [".codex/config.toml", ".codex/settings.json"],
  opencode: ["opencode.json", "opencode.jsonc", ".opencode/config.json"],
  gemini: [".gemini/settings.json", ".gemini/config.json"],
  qwen: [".qwen/settings.json", ".qwen/config.json"],
  copilot: [".github/copilot-instructions.md", ".copilot/config.json"],
  cursor: [".cursor/rules", ".cursor/settings.json"],
  windsurf: [".windsurf/rules", ".windsurf/settings.json"],
};

const HARNESS_MARKERS = {
  claude: ["CLAUDE.md", ".claude"],
  pi: [".pi", "AGENTS.md"],
  codex: [".codex", "AGENTS.md"],
  opencode: ["opencode.json", "AGENTS.md", ".opencode"],
  gemini: ["GEMINI.md", ".gemini"],
  qwen: ["QWEN.md", ".qwen"],
  copilot: [".github/copilot-instructions.md", ".github/hooks"],
  cursor: [".cursor", ".cursorrules"],
  windsurf: [".windsurf"],
};

const CM_UPDATE_COMMAND = `# cm-update

Run the complete Code-Mem repository update from this project root:

\`cm update --memory --deep\`

This command detects the local harnesses, repairs their cm hooks and skill,
indexes documents and source files, asks the configured harness LLM for
evidence-bound semantic relations, refreshes memory projections, and writes
\`memory/graph-3d.html\`. Do not run the legacy scan/entity commands first.
`;

function commandPath(name) {
  const executable = HARNESS_BINARIES[name];
  if (!executable) return "";
  // Hermetic first: scan the live process PATH directly so tests (and
  // agents) that prepend a shim directory deterministically win over any
  // globally installed binary. Login-shell lookup is only a fallback.
  try {
    for (const dir of String(process.env.PATH || "").split(":")) {
      if (!dir) continue;
      const full = join(dir, executable);
      try { if (existsSync(full) && statSync(full).isFile()) return full; } catch {}
    }
  } catch {}
  try {
    const out = execFileSync("/bin/zsh", ["-lc", `command -v ${executable}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return String(out || "").trim().split(/\r?\n/)[0] || "";
  } catch { return ""; }
}

function safeHarnessSettings(filePath) {
  if (!filePath || !existsSync(filePath)) return {};
  let raw = "";
  try { raw = readFileSync(filePath, "utf8").slice(0, 256 * 1024); } catch { return {}; }
  const result = { path: filePath };
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch {}
  const pick = (value) => {
    if (value === undefined || value === null) return "";
    if (typeof value === "object" || typeof value === "function") return "";
    const text = String(value).trim();
    if (!text || text.length > 120 || /(?:key|token|secret|password|authorization)/i.test(text)) return "";
    return text;
  };
  if (parsed && typeof parsed === "object") {
    const find = (keys, value = parsed, depth = 0) => {
      if (!value || typeof value !== "object" || depth > 4) return "";
      for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          const found = pick(value[key]);
          if (found) return found;
        }
      }
      for (const child of Object.values(value)) {
        const found = find(keys, child, depth + 1);
        if (found) return found;
      }
      return "";
    };
    result.model = find(["model", "modelName", "model_name", "defaultModel"]);
    result.provider = find(["provider", "modelProvider", "model_provider", "backend"]);
    result.profile = find(["profile", "activeProfile"]);
    // Claude Code and other OpenAI-compatible harness setups often configure
    // the provider through an environment endpoint instead of a literal
    // `provider` field. The endpoint is enough to prove that calls are routed
    // to an explicit LLM service; never expose the URL or any credential.
    if (!result.provider) {
      const env = parsed.env && typeof parsed.env === "object" ? parsed.env : {};
      const endpointKey = Object.keys(env).find((key) => /(?:ANTHROPIC|OPENAI|GOOGLE|AZURE).*?(?:BASE_URL|ENDPOINT|API_BASE)/i.test(key));
      if (endpointKey && pick(env[endpointKey])) {
        if (/ANTHROPIC/i.test(endpointKey)) result.provider = "anthropic-compatible";
        else if (/AZURE/i.test(endpointKey)) result.provider = "azure-openai-compatible";
        else if (/OPENAI/i.test(endpointKey)) result.provider = "openai-compatible";
        else if (/GOOGLE/i.test(endpointKey)) result.provider = "google-compatible";
        else result.provider = "configured-compatible-endpoint";
      } else if (/proxy/i.test(String(result.model || ""))) {
        result.provider = "configured-proxy";
      }
    }
  } else {
    const match = (keys) => {
      for (const key of keys) {
        const re = new RegExp(`^\\s*${key}\\s*[=:]\\s*["']?([^"'\\n#]+)`, "im");
        const found = raw.match(re);
        const value = pick(found?.[1]);
        if (value) return value;
      }
      return "";
    };
    result.model = match(["model", "model_name", "modelName"]);
    result.provider = match(["provider", "model_provider", "modelProvider", "backend"]);
    result.profile = match(["profile", "active_profile", "activeProfile"]);
  }
  return result;
}

function harnessSettingsFor(cwd, name) {
  const home = process.env.HOME || "";
  const candidates = [];
  for (const file of HARNESS_SETTINGS[name] || []) candidates.push(join(cwd, file));
  for (const file of HARNESS_SETTINGS[name] || []) candidates.push(join(home, file));
  if (name === "opencode") candidates.push(join(home, ".config", "opencode", "opencode.json"));
  if (name === "pi") candidates.push(join(home, ".pi", "agent", "settings.json"), join(home, ".pi", "agent", "config.json"));
  if (name === "claude") candidates.push(join(home, ".claude", "settings.json"), join(home, ".claude", "config.json"));
  for (const file of candidates) {
    if (existsSync(file) && statSync(file).isFile()) return safeHarnessSettings(file);
  }
  return {};
}

function harnessHasProjectMarker(cwd, name) {
  return (HARNESS_MARKERS[name] || []).some((marker) => existsSync(join(cwd, marker)));
}

function harnessProjectConfigured(cwd, settings, marker) {
  if (marker) return true;
  const configuredPath = settings?.path ? resolve(settings.path) : "";
  const projectRoot = resolve(cwd);
  return Boolean(configuredPath && (configuredPath === projectRoot || configuredPath.startsWith(`${projectRoot}${sep}`)));
}

function harnessProviderConfigured(settings) {
  const provider = String(settings?.provider || "").trim();
  return Boolean(provider && !/^harness default$/i.test(provider));
}

function detectHarnesses(cwd, opts = {}) {
  const forced = String(process.env.CM_HARNESS_DETECT || "").trim();
  const names = forced && forced !== "local"
    ? forced.split(",").map((item) => item.trim().toLowerCase()).filter((item) => HARNESS_BINARIES[item])
    : Object.keys(HARNESS_BINARIES);
  const detected = [];
  for (const name of names) {
    const binaryPath = commandPath(name);
    const marker = harnessHasProjectMarker(cwd, name);
    const settings = harnessSettingsFor(cwd, name);
    const settingsDetected = Boolean(settings.path);
    if (forced === "local" && !marker && !settingsDetected) continue;
    if (!forced && !marker && !settingsDetected && !binaryPath) continue;
    if (opts.projectOnly && !marker && !settingsDetected) continue;
    const projectConfigured = harnessProjectConfigured(cwd, settings, marker);
    const providerConfigured = harnessProviderConfigured(settings);
    detected.push({
      name,
      binary: binaryPath || HARNESS_BINARIES[name],
      available: Boolean(binaryPath),
      marker,
      settings,
      source: marker ? "project" : settingsDetected ? "settings" : "installed",
      model: settings.model || "configured default",
      provider: settings.provider || "harness default",
      llmReady: Boolean(binaryPath),
      projectConfigured,
      providerConfigured,
      chatReady: Boolean(binaryPath && projectConfigured && providerConfigured),
    });
  }
  return detected;
}

function chooseChatHarness(cwd, harnesses = detectHarnesses(cwd)) {
  const preferred = ["claude", "pi", "codex", "opencode", "gemini", "qwen", "copilot"];
  for (const name of preferred) {
    const found = harnesses.find((harness) => harness.name === name && harness.chatReady);
    if (found) return found;
  }
  return harnesses.find((harness) => harness.chatReady) || null;
}

function describeHarnesses(harnesses) {
  if (!harnesses.length) return "none detected";
  return harnesses.map((h) => {
    const config = h.settings?.path ? `settings=${h.settings.path}` : "settings=default";
    const availability = h.available ? "ready" : "CLI unavailable";
    return `${h.name} (${availability}, model=${h.model}, ${config})`;
  }).join(", ");
}

function harnessSkillPaths(cwd, name) {
  const map = {
    claude: [join(cwd, ".claude", "skills", "cm", "SKILL.md"), join(cwd, ".claude", "commands", "cm-update.md")],
    pi: [join(cwd, ".pi", "skills", "cm", "SKILL.md"), join(cwd, ".pi", "commands", "cm-update.md")],
    codex: [join(cwd, ".codex", "skills", "cm", "SKILL.md"), join(cwd, ".agents", "skills", "cm", "SKILL.md"), join(cwd, ".codex", "commands", "cm-update.md")],
    gemini: [join(cwd, ".gemini", "skills", "cm", "SKILL.md"), join(cwd, ".gemini", "commands", "cm-update.md")],
    qwen: [join(cwd, ".qwen", "skills", "cm", "SKILL.md"), join(cwd, ".qwen", "commands", "cm-update.md")],
    copilot: [join(cwd, ".github", "skills", "cm", "SKILL.md"), join(cwd, ".github", "commands", "cm-update.md")],
    cursor: [join(cwd, ".cursor", "skills", "cm", "SKILL.md"), join(cwd, ".cursor", "commands", "cm-update.md")],
    opencode: [join(cwd, ".opencode", "skills", "cm", "SKILL.md"), join(cwd, ".opencode", "commands", "cm-update.md")],
    windsurf: [join(cwd, ".windsurf", "skills", "cm", "SKILL.md"), join(cwd, ".windsurf", "commands", "cm-update.md")],
  };
  return map[name] || [];
}

function installHarnessSkill(cwd, name) {
  const paths = harnessSkillPaths(cwd, name);
  let written = 0;
  for (const path of paths) {
    if (existsSync(path)) continue;
    try {
      mkdirSync(dirname(path), { recursive: true });
      wr(path, path.endsWith("cm-update.md") ? CM_UPDATE_COMMAND : setupSkillText());
      written += 1;
    } catch {}
  }
  return written;
}

// Only the harness actually present in this project gets files. A bare
// AGENTS.md is shared by pi/codex/opencode, so it cannot identify one of
// them alone: keep a single winner (binary available first) instead of
// creating three folders.
function harnessSpecificMarkerPresent(cwd, name) {
  const markers = HARNESS_MARKERS[name] || [];
  return markers.some((m) => m !== "AGENTS.md" && existsSync(join(cwd, m)));
}
function collapseAmbiguousAgentHarnesses(cwd, harnesses) {
  const shared = ["pi", "codex", "opencode"];
  const ambiguous = harnesses.filter((h) => shared.includes(h.name) && !harnessSpecificMarkerPresent(cwd, h.name));
  if (ambiguous.length <= 1) return harnesses;
  const winner = ambiguous.find((h) => h.available) || ambiguous.find((h) => h.settings?.path) || ambiguous[0];
  return harnesses.filter((h) => !shared.includes(h.name) || h.name === winner.name || harnessSpecificMarkerPresent(cwd, h.name));
}
async function installDetectedHarnessIntegrations(cwd, harnesses = detectHarnesses(cwd, { projectOnly: true })) {
  const summary = { hooks: 0, skills: 0 };
  // Selective install: only harnesses actually present in THIS project
  // (marker dir/file or project-local settings). Installed-but-absent
  // harnesses never get folders or hooks created.
  const present = harnesses.filter((h) => h.marker || harnessProjectConfigured(cwd, h.settings, false));
  harnesses = collapseAmbiguousAgentHarnesses(cwd, present.length ? present : harnesses.filter((h) => h.marker));
  for (const harness of harnesses) {
    try {
      await installHooks(cwd, harness.name);
      summary.hooks += 1;
    } catch {}
    summary.skills += installHarnessSkill(cwd, harness.name);
  }
  // Every harness can at least discover the command through this neutral path.
  const generic = join(cwd, ".cm", "commands", "cm-update.md");
  if (!existsSync(generic)) {
    mkdirSync(dirname(generic), { recursive: true });
    wr(generic, CM_UPDATE_COMMAND);
    summary.skills += 1;
  }
  return summary;
}
