function parseArgs(parts) {
  const flags = {};
  const rest = [];
  const booleanFlags = new Set(["force", "daemon", "global", "relations", "deep", "no-ast", "apply", "dry-run", "replace", "claude-mem", "full", "auto"]);
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (part.startsWith("--")) {
      const key = part.slice(2);
      if (booleanFlags.has(key)) {
        flags[key] = true;
        continue;
      }
      const next = parts[i + 1];
      if (!next || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i += 1;
      }
    } else {
      rest.push(part);
    }
  }
  return { flags, rest };
}

function inferTaskKind(task) {
  const q = task.toLowerCase();
  if (/(bug|fix|debug|flaky|error|failure|crash)/.test(q)) return "debug";
  if (/(feature|implement|build|create|add)/.test(q)) return "feature";
  if (/(refactor|cleanup|simplify|restructure)/.test(q)) return "refactor";
  if (/(review|audit|inspect)/.test(q)) return "review";
  if (/(doc|readme|guide|explain)/.test(q)) return "docs";
  if (/(deploy|release|ship|publish|prod)/.test(q)) return "deploy";
  return "default";
}

function makePlan(task, cwd) {
  const taskKind = inferTaskKind(task);
  const template = TASK_TEMPLATES[taskKind] || TASK_TEMPLATES.default;
  return {
    taskKind,
    strategy: template.strategy,
    budget: taskKind === "debug" || taskKind === "deploy" ? 12 : 8,
    queries: template.kinds.map((kind, idx) => ({
      kind,
      priority: idx + 1,
    })),
    contextFrame: {
      cwd,
      gitBranch: getGitBranch(cwd),
      agent: process.env.CODEX ? "codex" : basename(process.env.SHELL || "cli"),
    },
  };
}

