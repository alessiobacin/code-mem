
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
} = require("fs");
const { join, resolve, basename, dirname } = require("path");
const { execSync, spawnSync, spawn } = require("child_process");
const http = require("http");
const readline = require("readline");
const VERSION = "0.6.0";
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

if (!DB && !process.env.CM_SQLITE_REEXEC) {
  const retry = spawnSync(
    process.execPath,
    ["--experimental-sqlite", __filename, ...process.argv.slice(2)],
    {
      stdio: "inherit",
      env: { ...process.env, CM_SQLITE_REEXEC: "1" },
    }
  );
  process.exit(retry.status ?? 1);
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
  codex: { file: "GEMINI.md" },
  copilot: { file: ".github/copilot-instructions.md" },
  cursor: { file: ".cursorrules" },
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

Persistent project memory for coding agents.

## Init

\`\`\`bash
cm init
\`\`\`

## Core commands

- \`cm save --kind decision "Use Vitest for unit tests"\` — save a typed memory
- \`cm save --kind procedure --global "Reusable deploy steps"\` — cross-project memory
- \`cm recall "fix flaky tests" --level 2 --mode hybrid\` — retrieve relevant memories
- \`cm recall-auto\` — auto-recall (used by SessionStart hook)
- \`cm plan "deploy preview build"\` — inspect retrieval plan
- \`cm recent\` — list recent memories
- \`cm consolidate\` — promote and normalize memories

## Guidelines

1. Use \`cm recall\` before grep when you need project memory.
2. Save durable learnings with \`cm save\`.
3. Use \`cm save --global\` for cross-project knowledge.
4. \`MEMORY.md\` and \`USER.md\` are generated projections from \`state.db\`.
5. Run \`cm consolidate\` after debugging/implementation sessions.
6. \`cm recall --mode hybrid\` combines keyword + semantic embedding.`;

function harnessComment(harness) {
  const comments = {
    claude: "> Instructions for Claude Code — see cm skill for full reference",
    pi: "> Instructions for Pi CLI — see cm skill for full reference",
    codex: "> Instructions for Google Codex — see cm skill for full reference",
    copilot: "> Instructions for Copilot CLI — see cm skill for full reference",
    cursor: "> Instructions for Cursor — see cm skill for full reference",
  };
  return comments[harness] || `> Instructions for ${harness}`;
}
