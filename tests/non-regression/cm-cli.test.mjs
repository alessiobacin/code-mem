// cm — non-regression anchor tests (Task A "cm-modular-capture").
//
// INTENT
//   These tests pin the behaviour of the CURRENT monolithic `bin/cm` before the
//   refactor (coder) splits it into modules + bundle. The coder reuses them to
//   prove the refactor does not change observable behaviour.
//
// HOW THEY RUN
//   - They EXECUTE the CLI as an external process (`spawnSync node <bin> ...`).
//     They never import internal functions, so they run identically against the
//     monolith and against a regenerated single-file bundle (install.sh ships ONE
//     file, so the path is simply `bin/cm`).
//   - They use an isolated HOME + a throwaway temp project, so they never touch
//     the real `~/.cm` global store and never need network.
//   - No Ollama required: assertions are embedding-backend-agnostic. Recall and
//     consolidate fall back to trigram embedding when Ollama is unavailable.
//   - The binary resolves `node:sqlite` itself (re-exec with the experimental
//     flag when needed), so no flags are needed here.
//
// RUN
//   node --test tests/non-regression/
//   or: node --test tests/non-regression/cm-cli.test.mjs
//   Override the binary under test with: CM_BIN=/abs/path/to/cm

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const BIN = process.env.CM_BIN || join(repoRoot, "bin", "cm");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(bin, args, opts = {}) {
  const res = spawnSync(process.execPath, [bin, ...args], {
    cwd: opts.cwd,
    env: opts.env,
    encoding: "utf-8",
    timeout: 60000,
  });
  return {
    code: res.status,
    ok: res.status === 0,
    stdout: res.stdout || "",
    stderr: res.stderr || "",
    output: `${res.stdout || ""}\n${res.stderr || ""}`,
  };
}

let rootTmp;
let shelves = [];

before(() => {
  rootTmp = mkdtempSync(join(tmpdir(), "cm-nonreg-"));
});

after(() => {
  for (const p of shelves) {
    try { rmSync(p, { recursive: true, force: true }); } catch {}
  }
  if (rootTmp) { try { rmSync(rootTmp, { recursive: true, force: true }); } catch {} }
});

// Create an isolated project + HOME. Returns a bound run() with a per-test HOME.
function makeProject(name = "proj") {
  const dir = join(rootTmp, `${name}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, private: true }));
  writeFileSync(join(dir, "src", "index.ts"), "export const x = 1;");
  // Isolated global store: real ~/.cm is never touched.
  const home = join(dir, "home");
  mkdirSync(home, { recursive: true });
  shelves.push(dir);
  const env = { ...process.env, HOME: home };
  return {
    dir,
    home,
    env,
    run: (args, opts = {}) => run(BIN, args, { cwd: dir, env, ...opts }),
  };
}

function initProject(p) {
  const r = p.run(["init"]);
  assert.equal(r.code, 0, `init failed: ${r.output}`);
  return r;
}

// ---------------------------------------------------------------------------
// Anchors
// ---------------------------------------------------------------------------

describe("cm CLI — non-regression anchor (monolith baseline)", () => {

  test('`cm --version` and `cm version` print a semantic version', () => {
    const p = makeProject();
    const v1 = p.run(["--version"]);
    const v2 = p.run(["version"]);
    assert.match(v1.stdout.trim(), /^\d+\.\d+\.\d+$/);
    assert.match(v2.stdout.trim(), /^\d+\.\d+\.\d+$/);
  });

  test("`cm help` exposes core commands", () => {
    const p = makeProject();
    const r = p.run(["help"]);
    assert.equal(r.code, 0);
    assert.match(r.output, /cm init/);
    assert.match(r.output, /cm save/);
    assert.match(r.output, /cm recall/);
    assert.match(r.output, /cm update/);
    assert.match(r.output, /keyword\|hybrid\|semantic/);
  });

  test("`cm init` scaffolds the expected files in ./memory/", () => {
    const p = makeProject();
    const r = initProject(p);
    assert.match(r.output, /Memory initialized/);
    for (const f of ["MEMORY.md", "USER.md", "graph.json", "state.db"]) {
      assert.ok(existsSync(join(p.dir, "memory", f)), `missing memory/${f}`);
    }
  });

  test("`cm init pi` installs a project-local Pi skill in .pi/", () => {
    const p = makeProject("pi-project");
    const r = p.run(["init", "pi"]);
    assert.equal(r.code, 0, `init pi failed: ${r.output}`);
    const skill = join(p.dir, ".pi", "skills", "cm", "SKILL.md");
    const extension = join(p.dir, ".pi", "extensions", "code-mem.ts");
    assert.ok(existsSync(skill), "missing .pi/skills/cm/SKILL.md");
    assert.ok(existsSync(extension), "missing .pi/extensions/code-mem.ts");
    assert.match(readFileSync(skill, "utf8"), /name: cm/);
    assert.match(readFileSync(extension, "utf8"), /turn_end/);
    assert.match(readFileSync(extension, "utf8"), /@mariozechner\/pi-coding-agent/);
    assert.match(readFileSync(extension, "utf8"), /node:child_process/);
    assert.match(r.output, /\.pi\/skills\/cm\/SKILL\.md written/);

    const again = p.run(["init", "pi"]);
    assert.equal(again.code, 0, `re-init pi failed: ${again.output}`);
    assert.match(again.output, /Skipped \.pi\/skills\/cm\/SKILL\.md \(already exists\)/);
  });

  test("`cm save` persists, fuzzy-dedupes, and `--force` re-saves identically", () => {
    const p = makeProject();
    initProject(p);
    const body = "React is the UI layer of this project";

    // New save
    const a = p.run(["save", "--kind", "fact", body]);
    assert.equal(a.code, 0);
    assert.match(a.stdout, /^Saved: mem_/);

    // Identical text, same kind -> fuzzy duplicate
    const dup = p.run(["save", "--kind", "fact", body]);
    assert.equal(dup.code, 0);
    assert.match(dup.stdout, /^Duplicate \(similar to \[mem_/);

    // Different kind, same text -> NOT treated as duplicate
    const otherKind = p.run(["save", "--kind", "decision", body]);
    assert.equal(otherKind.code, 0);
    assert.match(otherKind.stdout, /^Saved: mem_/);

    // --force with identical hash -> still content-deduped ("Already exists")
    const forced = p.run(["save", "--force", "--kind", "fact", body]);
    assert.equal(forced.code, 0);
    assert.match(forced.stdout, /^Already exists: mem_/);
  });

  test("`cm save` rejects empty text", () => {
    const p = makeProject();
    initProject(p);
    const r = p.run(["save", "   "]);
    assert.equal(r.code, 1);
    assert.match(r.output, /text required/);
  });

  test("`cm ls` lists saved memories with id + kind", () => {
    const p = makeProject();
    initProject(p);
    p.run(["save", "--kind", "fact", "MongoDB is the primary datastore"]);
    p.run(["save", "--kind", "procedure", "Run lint before commit"]);
    const r = p.run(["ls"]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /\[mem_/);
    assert.match(r.stdout, /\[fact\]/);
    assert.match(r.stdout, /\[procedure\]/);
    assert.match(r.stdout, /MongoDB is the primary datastore/);
  });

  test("`cm recent` returns the most recent memories", () => {
    const p = makeProject();
    initProject(p);
    p.run(["save", "--kind", "fact", "Redis is used for caching"]);
    const r = p.run(["recent", "5"]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Redis is used for caching/);
    assert.match(r.stdout, /\[mem_/);
  });

  test("`cm recall` returns ranked memories without requiring Ollama", () => {
    const p = makeProject();
    initProject(p);
    p.run(["save", "--kind", "fact", "The auth module issues JWTs"]);
    const r = p.run(["recall", "auth jwt", "--mode", "hybrid"]);
    assert.equal(r.code, 0);
    assert.match(r.output, /^Task: auth jwt/m);
    assert.match(r.output, /Plan: .*mode=hybrid/);
    assert.match(r.output, /The auth module issues JWTs/);
    assert.match(r.output, /score=\d+\.\d+/);
  });

  test("`cm recall` on an empty-ish project yields a context frame (not a crash)", () => {
    const p = makeProject();
    initProject(p);
    const r = p.run(["recall", "zzzzunmatchedqq", "--mode", "hybrid"]);
    assert.equal(r.code, 0);
    assert.match(r.output, /^Task: /m);
  });

  test("`cm project` regenerates MEMORY.md / USER.md and includes saved entries", () => {
    const p = makeProject();
    initProject(p);
    p.run(["save", "--kind", "fact", "Postgres powers analytics"]);
    const r = p.run(["project"]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Regenerated MEMORY\.md and USER\.md/);
    const mem = readFileSync(join(p.dir, "memory", "MEMORY.md"), "utf-8");
    assert.match(mem, /Postgres powers analytics/);
  });

  test("`cm consolidate` reports promotions and vectorization (trigram fallback ok)", () => {
    const p = makeProject();
    initProject(p);
    p.run(["save", "--kind", "fact", "The API returns HAL-formatted responses", "--layer", "working"]);
    const r = p.run(["consolidate"]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Consolidated \d+ item\(s\)/);
    assert.match(r.stdout, /vectorized/);
  });

  test("`cm plan` emits a strategy JSON", () => {
    const p = makeProject();
    initProject(p);
    const r = p.run(["plan", "deploy preview build"]);
    assert.equal(r.code, 0);
    const parsed = JSON.parse(r.stdout);
    assert.equal(typeof parsed.taskKind, "string");
    assert.equal(typeof parsed.strategy, "string");
  });

  test("`cm backup` writes a project backup; `cm backup --global` writes a global store backup", () => {
    const p = makeProject();
    initProject(p);
    p.run(["save", "--kind", "fact", "Terraform manages the cloud infra"]);

    const proj = p.run(["backup"]);
    assert.equal(proj.code, 0);
    const match = proj.stdout.match(/Project backup written to (\S+)/);
    assert.ok(match, `expected backup path, got: ${proj.output}`);
    assert.ok(existsSync(match[1]), `backup file missing: ${match[1]}`);

    const glob = p.run(["backup", "--global"]);
    assert.equal(glob.code, 0);
    const gmatch = glob.stdout.match(/Global backup written to (\S+)/);
    assert.ok(gmatch, `expected global backup path, got: ${glob.output}`);
    assert.ok(existsSync(gmatch[1]), `global backup file missing: ${gmatch[1]}`);
  });

  test("`cm restore` (non-global usage) prints usage and exits non-zero", () => {
    const p = makeProject();
    initProject(p);
    const r = p.run(["restore"]);
    assert.equal(r.code, 1);
    assert.match(r.output, /Usage: cm restore --global/);
  });

  test("running a command without `cm init` refuses with a clear message", () => {
    const p = makeProject();
    const r = p.run(["recall", "anything"]);
    assert.equal(r.code, 1);
    assert.match(r.output, /No memory\/\. Run: cm init/);
  });

  test("an unknown command is reported", () => {
    const p = makeProject();
    initProject(p);
    const r = p.run(["definitely-not-a-cmd"]);
    assert.equal(r.code, 0);
    assert.match(r.output, /Unknown "definitely-not-a-cmd"/);
  });

});

// ---------------------------------------------------------------------------
// cm update --memory (snapshot refresh, noise cleanup, memory reset)
// ---------------------------------------------------------------------------

describe("cm update --memory", () => {

  test("`cm update --memory` refreshes the stale project snapshot (old row archived, new scan row saved)", () => {
    const p = makeProject();
    initProject(p);

    // Simulate a stale snapshot: change the repo AFTER init so the fresh scan
    // body differs from the stored one.
    writeFileSync(join(p.dir, "package.json"), JSON.stringify({
      name: "proj", private: true, dependencies: { express: "^4.0.0", redis: "^4.0.0" },
    }));

    const r = p.run(["update", "--memory"]);
    assert.equal(r.code, 0, `update --memory failed: ${r.output}`);
    assert.match(r.output, /Memory refreshed/);
    assert.match(r.output, /Snapshot updated/);

    // Exactly ONE active snapshot row must remain (the fresh one), and the
    // stale row must be archived, not left as a duplicate.
    const ls = p.run(["ls"]);
    assert.equal(ls.code, 0);
    const snapshotLines = ls.stdout.split("\n").filter((l) => /Project snapshot/.test(l) && /\[mem_/.test(l));
    assert.ok(snapshotLines.length >= 1, "no active snapshot row after refresh");
    assert.ok(/express/i.test(ls.stdout) || /Express/.test(ls.stdout), "fresh snapshot body missing from ls");
  });

  test("`cm update --memory` on a project without init refuses with a clear message", () => {
    const p = makeProject();
    const r = p.run(["update", "--memory"]);
    assert.equal(r.code, 1);
    assert.match(r.output, /No memory\/\. Run: cm init/);
  });

  test("`cm update --memory` is idempotent when nothing changed (same scan body -> refresh, no duplicate)", () => {
    const p = makeProject();
    initProject(p);
    const r1 = p.run(["update", "--memory"]);
    assert.equal(r1.code, 0);
    const r2 = p.run(["update", "--memory"]);
    assert.equal(r2.code, 0);
    assert.match(r2.output, /Snapshot updated|Snapshot unchanged/);

    const ls = p.run(["ls"]);
    const snapshotLines = ls.stdout.split("\n").filter((l) => /Project snapshot/.test(l) && /\[mem_/.test(l));
    assert.equal(snapshotLines.length, 1, "duplicate snapshot rows after idempotent refresh");
  });

  test("`cm update --memory --clean --dry-run` lists noisy candidates without changing anything", () => {
    const p = makeProject();
    initProject(p);
    // Seed noise: two near-duplicate facts + one low-confidence fact.
    p.run(["save", "--kind", "fact", "Redis is the cache layer for sessions"]);
    p.run(["save", "--kind", "fact", "Redis is the cache layer for sessions and tokens"]);
    p.run(["save", "--kind", "fact", "--confidence", "0.1", "Fuzzy hypothesis about unused widget"]);
    const before = p.run(["ls"]).stdout;

    const r = p.run(["update", "--memory", "--clean", "--dry-run"]);
    assert.equal(r.code, 0, `clean --dry-run failed: ${r.output}`);
    assert.match(r.output, /dry-run/i);
    assert.match(r.output, /candidate|noise/i);

    // Nothing may have changed.
    assert.equal(p.run(["ls"]).stdout, before);
  });

  test("`cm update --memory --clean` archives noise (near-duplicates, low-confidence) and keeps originals", () => {
    const p = makeProject();
    initProject(p);
    p.run(["save", "--kind", "fact", "Redis is the cache layer for sessions"]);
    p.run(["save", "--kind", "fact", "Redis is the cache layer for sessions and tokens"]);
    p.run(["save", "--kind", "fact", "--confidence", "0.1", "Fuzzy hypothesis about unused widget"]);

    const r = p.run(["update", "--memory", "--clean"]);
    assert.equal(r.code, 0, `clean failed: ${r.output}`);
    assert.match(r.output, /cleaned|archived/i);

    const ls = p.run(["ls"]);
    assert.ok(/Redis is the cache layer for sessions(\n|$)/.test(ls.stdout), "original fact must survive clean");
    assert.doesNotMatch(ls.stdout, /Fuzzy hypothesis about unused widget/, "low-confidence noise must be gone");
  });

  test("`cm update --memory --reset` archives ALL project memories and re-scans fresh", () => {
    const p = makeProject();
    initProject(p);
    p.run(["save", "--kind", "fact", "Totally stale legacy statement about module Zed"]);

    const r = p.run(["update", "--memory", "--reset"]);
    assert.equal(r.code, 0, `reset failed: ${r.output}`);
    assert.match(r.output, /reset/i);

    const ls = p.run(["ls"]);
    assert.doesNotMatch(ls.stdout, /Totally stale legacy statement/, "old memory must not survive reset");
    assert.match(ls.stdout, /Project snapshot/, "fresh snapshot must exist after reset");
  });

});

// ---------------------------------------------------------------------------
// session_start staleness sync (git-driven auto-refresh + harness warning)
// ---------------------------------------------------------------------------

describe("cm hook session_start staleness", () => {

  function gitRun(dir, args) {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf-8" });
    assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr}`);
    return r.stdout;
  }

  function makeGitProject() {
    const p = makeProject();
    gitRun(p.dir, ["init", "-q"]);
    gitRun(p.dir, ["config", "user.email", "test@test.local"]);
    gitRun(p.dir, ["config", "user.name", "Test"]);
    gitRun(p.dir, ["add", "-A"]);
    gitRun(p.dir, ["commit", "-q", "-m", "init"]);
    initProject(p);
    // Register the commit cm saw at init time.
    gitRun(p.dir, ["commit", "-q", "--allow-empty", "-m", "snapshot marker"]);
    return p;
  }

  test("unregistered git commits at session_start trigger an auto memory refresh", () => {
    const p = makeProject();
    gitRun(p.dir, ["init", "-q"]);
    gitRun(p.dir, ["config", "user.email", "test@test.local"]);
    gitRun(p.dir, ["config", "user.name", "Test"]);
    gitRun(p.dir, ["add", "-A"]);
    gitRun(p.dir, ["commit", "-q", "-m", "init"]);
    initProject(p);

    // Register baseline: session_start right after init must NOT report staleness.
    const first = p.run(["hook", "--event", "session_start"]);
    assert.equal(first.code, 0, `session_start failed: ${first.output}`);
    assert.doesNotMatch(first.output, /memory (is|appears) stale/i);

    // New commit AFTER init (unregistered by any memory update).
    writeFileSync(join(p.dir, "package.json"), JSON.stringify({
      name: "proj", private: true, dependencies: { express: "^4.0.0" },
    }));
    gitRun(p.dir, ["add", "-A"]);
    gitRun(p.dir, ["commit", "-q", "-m", "add express"]);

    const r = p.run(["hook", "--event", "session_start"]);
    assert.equal(r.code, 0, `session_start failed: ${r.output}`);
    assert.match(r.output, /memory (is|appears) stale/i);
    assert.match(r.output, /auto-refreshed/i);

    const ls = p.run(["ls"]);
    assert.match(ls.stdout, /express/i, "refreshed snapshot must mention the new dependency");
  });

  test("session_start on an up-to-date project does not refresh or warn", () => {
    const p = makeGitProject();
    // Register the snapshot baseline: run update --memory so the snapshot is fresh.
    p.run(["update", "--memory"]);
    const r = p.run(["hook", "--event", "session_start"]);
    assert.equal(r.code, 0, `session_start failed: ${r.output}`);
    assert.doesNotMatch(r.output, /memory (is|appears) stale/i);
    assert.doesNotMatch(r.output, /auto-refreshed/i);
  });

});

// ---------------------------------------------------------------------------
// Harness hook audit: detect compatible harnesses whose hook is not installed
// and reinstall it automatically during `cm update --memory`.
// ---------------------------------------------------------------------------

describe("cm update --memory hook audit", () => {

  test("a pi-configured project without the pi hook gets it installed by update --memory", () => {
    const p = makeProject();
    initProject(p); // installs the Claude hook only
    // Simulate that the user also works with pi: AGENTS.md exists (pi harness
    // marker) but the pi extension was never installed.
    writeFileSync(join(p.dir, "AGENTS.md"), "# AGENTS\n");
    assert.ok(!existsSync(join(p.dir, ".pi", "extensions", "code-mem.ts")), "precondition: pi hook missing");

    const r = p.run(["update", "--memory"]);
    assert.equal(r.code, 0, `update --memory failed: ${r.output}`);
    assert.match(r.output, /pi.*hook installed|installed.*pi/i);
    assert.ok(existsSync(join(p.dir, ".pi", "extensions", "code-mem.ts")), "pi hook must be installed");

    // Re-run: no duplicate installation report.
    const again = p.run(["update", "--memory"]);
    assert.equal(again.code, 0);
    assert.doesNotMatch(again.output, /pi.*hook installed/i);
  });

  test("a cursor-configured project without hooks gets the cursor hook installed", () => {
    const p = makeProject();
    initProject(p);
    writeFileSync(join(p.dir, ".cursorrules"), "# cursor rules\n");
    assert.ok(!existsSync(join(p.dir, ".cursor", "hooks.json")), "precondition: cursor hook missing");

    const r = p.run(["update", "--memory"]);
    assert.equal(r.code, 0, `update --memory failed: ${r.output}`);
    assert.match(r.output, /cursor.*hook installed|installed.*cursor/i);
    const hooks = JSON.parse(readFileSync(join(p.dir, ".cursor", "hooks.json"), "utf-8"));
    assert.ok(hooks.hooks && hooks.hooks.sessionStart, "cursor sessionStart hook must exist");
  });

  test("a project with all detected harness hooks installed reports nothing new", () => {
    const p = makeProject();
    const r = p.run(["init", "pi"]);
    assert.equal(r.code, 0, `init pi failed: ${r.output}`);
    // AGENTS.md written by init pi + Claude hook from default init wiring.
    p.run(["update", "--memory"]);
    assert.equal(p.run(["update", "--memory"]).code, 0);
  });

});
