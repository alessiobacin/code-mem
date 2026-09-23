// A3 — recall hot-path regressions.
//
// WHAT IS PINNED
//   1. memory_links has an index on target_id, so the per-candidate link count
//      (`source_id = ? OR target_id = ?`) never falls back to a full scan.
//   2. The Ollama availability probe (/api/tags) is cached across processes:
//      two consecutive `cm recall` runs probe at most once.
//   3. allStmt/getStmt/runStmt reuse prepared statements per db handle.
//   4. New stores use 4096-byte pages (vectors no longer spill into overflow).
//   5. Keyword/concept scoring matches word prefixes like FTS5 ("api" hits
//      "apis" and "my_api", never "rapid").
//
// HOW
//   1-2 run the shipped bin/cm with an isolated HOME/TMPDIR; (2) puts a fake
//   `curl` first on PATH that logs every call. 3 evaluates the helpers from the
//   bundle source against a fake db that counts prepare() calls.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const BIN = process.env.CM_BIN || join(repoRoot, "bin", "cm");
const bundleSource = readFileSync(BIN, "utf-8");

let rootTmp;
before(() => { rootTmp = mkdtempSync(join(tmpdir(), "cm-a3-")); });
after(() => { try { rmSync(rootTmp, { recursive: true, force: true }); } catch {} });

function sandbox(name, extraEnv = {}) {
  const dir = join(rootTmp, name);
  const home = join(dir, "home");
  const project = join(dir, "project");
  const tmp = join(dir, "tmp");
  for (const p of [home, project, tmp]) mkdirSync(p, { recursive: true });
  const env = { ...process.env, HOME: home, TMPDIR: tmp, CM_NO_UPDATE_CHECK: "1", ...extraEnv };
  delete env.CM_NO_OLLAMA;
  delete env.CM_NO_LLM;
  const cm = (...args) => spawnSync(process.execPath, [BIN, ...args], { cwd: project, env, encoding: "utf-8", timeout: 60000 });
  assert.equal(cm("init").status, 0);
  return { dir, project, env, cm };
}

describe("A3 recall hot path", () => {
  test("memory_links target_id lookup uses an index", () => {
    const { project, cm } = sandbox("index", { CM_NO_OLLAMA: "1" });
    assert.equal(cm("save", "--kind", "fact", "Index regression anchor fact.").status, 0);
    const d = new DatabaseSync(join(project, "memory", "state.db"));
    const plan = d.prepare("EXPLAIN QUERY PLAN SELECT COUNT(*) FROM memory_links WHERE source_id = 'x' OR target_id = 'x'").all()
      .map((r) => r.detail).join("\n");
    d.close();
    assert.doesNotMatch(plan, /^SCAN/m, plan);
  });

  test("Ollama probe is cached across cm processes", () => {
    const box = sandbox("probe");
    const fakeBin = join(box.dir, "fakebin");
    const log = join(box.dir, "curl.log");
    mkdirSync(fakeBin);
    writeFileSync(join(fakeBin, "curl"), `#!/bin/sh\necho "$@" >> "${log}"\nprintf '000'\nexit 7\n`);
    chmodSync(join(fakeBin, "curl"), 0o755);
    box.env.PATH = `${fakeBin}:${box.env.PATH}`;
    assert.equal(box.cm("save", "--kind", "fact", "Probe cache anchor fact.").status, 0);
    writeFileSync(log, "");
    assert.equal(box.cm("recall", "probe cache").status, 0);
    assert.equal(box.cm("recall", "probe cache").status, 0);
    const probes = (existsSync(log) ? readFileSync(log, "utf-8") : "").split("\n").filter((l) => l.includes("/api/tags"));
    assert.ok(probes.length <= 1, `expected <=1 probe across two recalls, got ${probes.length}`);
  });

  test("statement helpers reuse prepared statements", () => {
    const pick = (name) => {
      const start = bundleSource.indexOf(`function ${name}(`);
      assert.ok(start !== -1, `function ${name} must exist in the bundle`);
      const next = bundleSource.indexOf("\nfunction ", start + 1);
      return bundleSource.slice(start, next === -1 ? bundleSource.length : next);
    };
    const src = ["cachedStmt", "runStmt", "allStmt", "getStmt"].map(pick).join("\n");
    const { allStmt, getStmt, runStmt } = new Function(`${src}\nreturn { allStmt, getStmt, runStmt };`)();
    let prepares = 0;
    const db = { prepare: () => { prepares += 1; return { all: () => [], get: () => null, run: () => ({}) }; } };
    getStmt(db, "SELECT 1", []);
    getStmt(db, "SELECT 1", []);
    allStmt(db, "SELECT 1", []);
    runStmt(db, "SELECT 2", []);
    assert.equal(prepares, 2);
  });

  test("new stores use 4096-byte pages", () => {
    const { project } = sandbox("pages", { CM_NO_OLLAMA: "1" });
    const d = new DatabaseSync(join(project, "memory", "state.db"));
    const { page_size } = d.prepare("PRAGMA page_size").get();
    d.close();
    assert.equal(page_size, 4096);
  });

  test("keyword matching is word-prefix, not substring", () => {
    const start = bundleSource.indexOf("function containsWordPrefix(");
    assert.ok(start !== -1, "function containsWordPrefix must exist in the bundle");
    const next = bundleSource.indexOf("\nfunction ", start + 1);
    const containsWordPrefix = new Function(`${bundleSource.slice(start, next)}\nreturn containsWordPrefix;`)();
    assert.equal(containsWordPrefix("rapid deploy", "api"), false);
    assert.equal(containsWordPrefix("the api layer", "api"), true);
    assert.equal(containsWordPrefix("public apis", "api"), true);
    assert.equal(containsWordPrefix("call my_api now", "api"), true);
    assert.equal(containsWordPrefix("memory_links index", "memory_links"), true);
    assert.equal(containsWordPrefix("uses c++ (fast)", "c++"), true);
  });
});
