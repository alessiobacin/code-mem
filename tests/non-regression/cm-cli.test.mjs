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
