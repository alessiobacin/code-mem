
const {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  readdirSync,
  statSync,
  openSync,
  closeSync,
  writeSync,
  unlinkSync,
  realpathSync,
  chmodSync,
} = require("fs");
const { join, resolve, basename, dirname, relative, normalize, extname, sep } = require("path");
const { execSync, execFileSync, spawnSync, spawn } = require("child_process");
const http = require("http");
const { createHash } = require("crypto");
const readline = require("readline");
const VERSION = "0.12.0";
const OLLAMA_BASE = "http://localhost:11434";
const EMBED_MODEL = "nomic-embed-text";
const REPO_RAW_BASE = "https://raw.githubusercontent.com/alessiobacin/code-mem/main";
const REPO_API_COMMIT = "https://api.github.com/repos/alessiobacin/code-mem/commits/main";

let DB;
try {
  const { DatabaseSync } = require("node:sqlite");
  DB = DatabaseSync;
} catch {
  DB = null;
}

// Async re-exec (not spawnSync) so SIGTERM/SIGINT reach the child: a blocked
// parent would die on the signal and orphan the real `cm serve` process.
// main() only runs when SQLITE_REEXEC is null.
let SQLITE_REEXEC = null;
if (!DB && !process.env.CM_SQLITE_REEXEC) {
  SQLITE_REEXEC = spawn(
    process.execPath,
    ["--experimental-sqlite", "--disable-warning=ExperimentalWarning", __filename, ...process.argv.slice(2)],
    {
      stdio: "inherit",
      env: { ...process.env, CM_SQLITE_REEXEC: "1" },
    }
  );
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => SQLITE_REEXEC.kill(sig));
  SQLITE_REEXEC.on("exit", (code, signal) => {
    process.exit(code ?? (signal ? 128 + (require("os").constants.signals[signal] || 0) : 1));
  });
}

const ML = 2200;
const UL = 1375;
const MF = "MEMORY.md";
const UF = "USER.md";
const GF = "graph.json";
const SF = "state.db";
const CM_DIR = ".cm";
const ES = "\n§\n";
const DEFAULT_CONFIDENCE = 0.7;
const DEFAULT_SALIENCE = 0.5;
const DEFAULT_LIMIT = 8;
// Harness config filename mapping
const HARNESS_CONFIGS = {
  claude: { file: "CLAUDE.md" },
  pi: { file: "AGENTS.md" },
  codex: { file: "AGENTS.md" },
  copilot: { file: ".github/copilot-instructions.md" },
  cursor: { file: ".cursorrules" },
  gemini: { file: "GEMINI.md" },
  qwen: { file: "QWEN.md" },
  opencode: { file: "AGENTS.md" },
  windsurf: { file: ".windsurf/rules/cm.md" },
};
const TASK_TEMPLATES = {
  debug: {
    strategy: "DEEP",
    kinds: ["issue", "procedure", "decision", "artifact", "fact"],
  },
  feature: {
    strategy: "BROAD",
    kinds: ["decision", "fact", "procedure", "artifact", "issue"],
  },
  refactor: {
    strategy: "FOCUSED",
    kinds: ["decision", "artifact", "issue", "fact", "procedure"],
  },
  review: {
    strategy: "FOCUSED",
    kinds: ["decision", "issue", "preference", "fact", "artifact"],
  },
  docs: {
    strategy: "BROAD",
    kinds: ["fact", "procedure", "artifact", "decision", "preference"],
  },
  deploy: {
    strategy: "DEEP",
    kinds: ["procedure", "issue", "decision", "artifact", "fact"],
  },
  default: {
    strategy: "FOCUSED",
    kinds: ["fact", "decision", "procedure", "issue", "artifact"],
  },
};
const SECTION_CONFIG = [
  { title: "Current Facts", kinds: ["fact", "artifact"], limit: 8 },
  { title: "Active Decisions", kinds: ["decision"], limit: 6 },
  { title: "Reliable Procedures", kinds: ["procedure"], limit: 6 },
  { title: "Known Issues", kinds: ["issue"], limit: 5 },
];

const CM_HARNESS_SNIPPET = `# cm - Code-Mem Tool

Persistent, local project memory. It is evidence, not a replacement for the
repository: retrieve it before rediscovering prior decisions, and store only
durable, verifiable learning.

## One-command repository sync

\`cm init --deep\` initializes memory, detects installed harnesses, installs
their cm hooks and skill, indexes documents/source/assets, asks the harness'
configured LLM for evidence-bound relations, and writes \`memory/graph-3d.html\`.
After changes run \`cm update --memory --deep\`. The project-local \`/cm-update\`
command invokes the same workflow.
Harness response hooks schedule the same deterministic refresh in the background,
so the 3D HTML stays current without blocking the conversation. One per-user
\`cm-graphd\` service serves all registered projects on loopback; run
\`cm service install\` once after installing cm, then \`cm serve\` opens the
current project through it. Its chat appears only when this project has an
available harness with an explicit provider.

## Start every substantial task

\`\`\`bash
cm recall "<goal or bug>" --level 2 --mode hybrid
cm plan "<goal>"                         # optional: inspect the retrieval plan
cm sq "<exact phrase from a prior session>" # search captured conversation
\`\`\`

## Record outcomes deliberately

- \`cm save --kind decision --title "…" "why and consequence"\`
- \`cm save --kind procedure --title "…" "repeatable steps"\`
- \`cm save --kind issue --title "…" "symptom, cause, fix or next check"\`
- \`cm save --global …\` only for knowledge valid across projects.
- \`cm save --global --kind preference --layer user …\` for a general user preference; it appears as context, never as a project stack override.
- \`cm projects\` lists all managed projects. Use \`cm projects recall <selector> …\` or \`cm projects graph <selector>\` only when the user explicitly asks about another project.
- \`cm save --auto --role agent "…"\` is capture data, not a substitute for a
  concise decision/issue memory.

## Keep it useful

1. Do not save secrets, tokens, personal data, guesses, or transient progress.
2. Cite files, commands, tests, or ticket IDs in durable memories when known.
3. Use \`cm recent\`, \`cm project\`, and \`cm consolidate\` after a completed
   debugging or implementation cycle.
4. \`MEMORY.md\` and \`USER.md\` are generated projections; never hand-edit
   them as the source of truth.
5. The Pi hook recalls context at session start and captures completed agent
   responses. It never blocks an agent if Code Mem is unavailable.
6. \`cm recall --mode hybrid\` uses Ollama when available and a local fallback
   otherwise; a missing embedding service must not stop the project.`;

// Pi's public extension API does not expose a process runner.  Use Node's
// standard child-process API rather than the old, non-existent `pi.exec`, and
// make every capture best-effort so a memory failure cannot break an agent.
const CM_PI_EXTENSION = `import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { execFile } from "node:child_process";

function runCm(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve) => {
    execFile("cm", args, { cwd, timeout: 10_000, maxBuffer: 256 * 1024 }, () => resolve());
  });
}

function messageText(message: any): string {
  if (typeof message?.content === "string") return message.content;
  if (!Array.isArray(message?.content)) return "";
  return message.content
    .filter((part: any) => part?.type === "text" && typeof part.text === "string")
    .map((part: any) => part.text)
    .join("\\n");
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    await runCm(["hook", "--event", "session_start"], ctx.cwd);
  });
  pi.on("turn_end", async (event: any, ctx) => {
    const text = messageText(event?.message);
    if (text.trim()) {
      await runCm(["save", "--auto", "--role", "agent", text], ctx.cwd);
      await runCm(["hook", "--event", "response"], ctx.cwd);
    }
  });
}`;

function harnessComment(harness) {
  const comments = {
    claude: "> Instructions for Claude Code — see cm skill for full reference",
    pi: "> Instructions for Pi CLI — see cm skill for full reference",
    codex: "> Instructions for Codex — see cm skill for full reference",
    copilot: "> Instructions for Copilot CLI — see cm skill for full reference",
    cursor: "> Instructions for Cursor — see cm skill for full reference",
  };
  return comments[harness] || `> Instructions for ${harness}`;
}
