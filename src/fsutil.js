function mp(c, f) {
  return join(c, "memory", f);
}

function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || "";
}

function canonicalPath(path) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function isHomeDir(cwd) {
  const home = homeDir();
  return Boolean(home) && canonicalPath(cwd) === canonicalPath(home);
}

function askYesNo(question) {
  return new Promise((resolveAnswer) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolveAnswer(/^(y|yes|s|si)$/i.test(String(answer || "").trim()));
    });
  });
}

function globalRoot() {
  return join(homeDir(), CM_DIR);
}

function globalDbPath() {
  return join(globalRoot(), SF);
}

function timestampSlug() {
  return nowIso().replace(/[:.]/g, "-");
}

function projectMemorySnapshotPath(cwd, stamp) {
  return join(cwd, "cm", "memories", stamp, "project-memory.md");
}

function globalMemorySnapshotPath(stamp) {
  return join(globalRoot(), "memories", stamp, "global-memory.md");
}

function globalBackupFilePath(cwd, stamp) {
  return join(cwd, `cm-global-backup-${stamp}.json`);
}

function rd(p) {
  try {
    return readFileSync(p, "utf-8");
  } catch {
    return "";
  }
}

function wr(p, c) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, c, "utf-8");
}

function pe(c) {
  if (!c.trim()) return [];
  return c
    .split(ES)
    .map((e) => e.trim())
    .filter(Boolean);
}

function rg(p, normalizeLegacy = true) {
  try {
    const raw = JSON.parse(readFileSync(p, "utf-8"));
    if (!normalizeLegacy) return raw;
    // Handle compressed format (shorthand keys s/t/r/c)
    if (raw.nodes && raw.nodes.length && !raw.nodes[0].id && raw.nodes[0]._id !== undefined) return raw;
    if (raw.edges && raw.edges.length && raw.edges[0].s) {
      raw.edges = raw.edges.map((e) => ({
        source: e.s || e.source,
        target: e.t || e.target,
        relation: e.r || e.relation,
        confidence: e.c || e.confidence,
      }));
    }
    if (raw.nodes && raw.nodes.length && raw.nodes[0].c !== undefined) {
      raw.nodes = raw.nodes.map((n) => ({
        id: n.id,
        label: n.label,
        type: n.type,
        metadata: n.c !== undefined ? { community: n.c } : {},
      }));
    }
    return raw;
  } catch {
    return { nodes: [], edges: [] };
  }
}

function wg(p, d) {
  mkdirSync(dirname(p), { recursive: true });
  // Strip per-node metadata from graph.json to save space; keep only community IDs
  const cleaned = { nodes: [], edges: [] };
  if (d.nodes) {
    for (const n of d.nodes) {
      const entry = { id: n.id, label: n.label || n.type || "", type: n.type || "" };
      if (n.metadata && n.metadata.community !== undefined) entry.c = n.metadata.community;
      cleaned.nodes.push(entry);
    }
  }
  if (d.edges) {
    for (const e of d.edges) {
      const entry = { s: e.source || e.source_id, t: e.target || e.target_id, r: e.relation || "", c: e.confidence || "" };
      cleaned.edges.push(entry);
    }
  }
  writeFileSync(p, JSON.stringify(cleaned), "utf-8");
}

function nowIso() {
  return new Date().toISOString();
}

function slug(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "item";
}

function clamp01(n, fallback) {
  const value = Number.parseFloat(n);
  if (Number.isNaN(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function getGitBranch(cwd) {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
    }).trim();
  } catch {
    return "";
  }
}

const CM_DEPS_DIR = join(process.env.HOME || "/tmp", ".cm", "deps");
