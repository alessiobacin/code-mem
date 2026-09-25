// A6 — knowledge-base plumbing.
//
// WHAT IS PINNED
//   1. `cm config`: global (~/.cm/config.env) and project (memory/config.env)
//      settings, files mode 600, secrets masked in list/get, values read from
//      stdin so they never land in shell history, process env wins, project
//      beats global, and settings reach cm's own environment.
//   2. Jev client: `cm jev test` calls the configured endpoint; a 402/credit
//      error marks Jev exhausted (~/.cm/jev-status.json), every later cm
//      command warns on stderr and the session_start hook tells the agent;
//      the next successful call clears it.
//   3. Media conversion is cached by content hash: an unchanged PDF is not
//      converted again on the next import.
//   4. The 3D graph UI is always English, whatever the map language.
//
// HOW
//   Isolated HOME per test. Jev is a local HTTP server started by the test
//   (CM_JEV_ENDPOINT). Media conversion uses a fake `markitdown` on PATH that
//   logs each call.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, statSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const BIN = process.env.CM_BIN || join(repoRoot, "bin", "cm");

let root;
before(() => { root = mkdtempSync(join(tmpdir(), "cm-a6-")); });
after(() => { try { rmSync(root, { recursive: true, force: true }); } catch {} });

function sandbox(name, extraEnv = {}) {
  const dir = join(root, name);
  const home = join(dir, "home");
  const project = join(dir, "project");
  for (const p of [home, project]) mkdirSync(p, { recursive: true });
  const env = { ...process.env, HOME: home, CM_NO_OLLAMA: "1", CM_NO_NOTIFY: "1", ...extraEnv };
  for (const key of ["TYPESAFE_API_KEY", "CM_JEV_ENDPOINT", "CM_JEV", "CM_JEV_MODEL", "CM_NO_LLM"]) if (!(key in extraEnv)) delete env[key];
  const cm = (args, input) => spawnSync(process.execPath, [BIN, ...args], { cwd: project, env, input, encoding: "utf-8", timeout: 60000 });
  // async variant: needed while the test's own HTTP server must keep serving
  const cmAsync = (args) => new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd: project, env });
    let stdout = "", stderr = "";
    child.stdout.on("data", (c) => { stdout += c; });
    child.stderr.on("data", (c) => { stderr += c; });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
  return { dir, home, project, env, cm, cmAsync };
}

describe("A6 cm config", () => {
  test("set/get/list/unset with masking, stdin values, precedence", () => {
    const box = sandbox("config");
    assert.equal(box.cm(["init"]).status, 0);
    assert.equal(box.cm(["config", "set", "TYPESAFE_API_KEY"], "apikey_secret_value_1234\n").status, 0);
    assert.equal(box.cm(["config", "set", "CM_JEV_MODEL", "jev-latest"]).status, 0);
    const globalFile = join(box.home, ".cm", "config.env");
    assert.ok(existsSync(globalFile));
    assert.equal(statSync(globalFile).mode & 0o777, 0o600);
    const list = box.cm(["config", "list"]);
    assert.equal(list.status, 0, list.stderr);
    assert.doesNotMatch(list.stdout, /apikey_secret_value_1234/);
    assert.match(list.stdout, /TYPESAFE_API_KEY=•+1234/);
    assert.match(list.stdout, /CM_JEV_MODEL=jev-latest/);
    assert.doesNotMatch(box.cm(["config", "get", "TYPESAFE_API_KEY"]).stdout, /secret_value/);
    assert.equal(box.cm(["config", "get", "TYPESAFE_API_KEY", "--reveal"]).stdout.trim(), "apikey_secret_value_1234");
    // project overrides global; env overrides both
    assert.equal(box.cm(["config", "set", "CM_JEV_MODEL", "jev-preview", "--project"]).status, 0);
    const projectFile = join(box.project, "memory", "config.env");
    assert.equal(statSync(projectFile).mode & 0o777, 0o600);
    assert.match(readFileSync(join(box.project, "memory", ".gitignore"), "utf-8"), /config\.env/);
    assert.equal(box.cm(["config", "get", "CM_JEV_MODEL"]).stdout.trim(), "jev-preview");
    const envWins = spawnSync(process.execPath, [BIN, "config", "get", "CM_JEV_MODEL"], { cwd: box.project, env: { ...box.env, CM_JEV_MODEL: "from-env" }, encoding: "utf-8" });
    assert.equal(envWins.stdout.trim(), "from-env");
    assert.equal(box.cm(["config", "unset", "CM_JEV_MODEL", "--project"]).status, 0);
    assert.equal(box.cm(["config", "get", "CM_JEV_MODEL"]).stdout.trim(), "jev-latest");
    assert.notEqual(box.cm(["config", "set", "bad key", "x"]).status, 0);
  });
});

describe("A6 Jev client and credit alerts", () => {
  test("402 marks Jev exhausted, cm warns everywhere, success clears it", async () => {
    let mode = "credit";
    const seen = [];
    const { createServer } = await import("node:http");
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        seen.push({ auth: req.headers.authorization, body: JSON.parse(body || "{}") });
        if (mode === "credit") {
          res.writeHead(402, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { message: "Insufficient credit balance" } }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ model: "jev-1.13.0", answers: { ok: { type: "noul", noul: 0.97 } }, usage: { input_tokens: 12, output_tokens: 1 } }));
      });
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const endpoint = `http://127.0.0.1:${server.address().port}/v1/systemone`;
    try {
      const box = sandbox("jev", { CM_JEV_ENDPOINT: endpoint });
      assert.equal(box.cm(["init"]).status, 0);
      const noKey = box.cm(["jev", "status"]);
      assert.match(noKey.stdout, /not configured/i);
      assert.equal(box.cm(["config", "set", "TYPESAFE_API_KEY"], "apikey_test_9999\n").status, 0);

      const failed = await box.cmAsync(["jev", "test"]);
      assert.notEqual(failed.status, 0);
      assert.equal(seen[0].auth, "Bearer apikey_test_9999");
      assert.equal(seen[0].body.model, "jev-latest");
      const status = JSON.parse(readFileSync(join(box.home, ".cm", "jev-status.json"), "utf-8"));
      assert.equal(status.state, "exhausted");
      assert.match(failed.stderr + failed.stdout, /credit/i);

      const other = box.cm(["stats"]);
      assert.match(other.stderr, /Jev credit exhausted/);
      const hook = box.cm(["hook", "--event", "session_start"], "{}");
      assert.match(hook.stdout, /Jev credit exhausted/);

      mode = "ok";
      const ok = await box.cmAsync(["jev", "test", "--force"]);
      assert.equal(ok.status, 0, ok.stdout + ok.stderr);
      assert.match(ok.stdout, /jev-1\.13\.0/);
      assert.equal(JSON.parse(readFileSync(join(box.home, ".cm", "jev-status.json"), "utf-8")).state, "ok");
      assert.doesNotMatch(box.cm(["stats"]).stderr, /Jev credit/);
    } finally {
      server.close();
    }
  });
});

describe("A6 media conversion cache", () => {
  test("unchanged documents are not converted twice", () => {
    const box = sandbox("media", { CM_NO_LLM: "1" });
    const fakeBin = join(box.dir, "fakebin");
    const log = join(box.dir, "markitdown.log");
    mkdirSync(fakeBin);
    writeFileSync(join(fakeBin, "markitdown"), `#!/bin/sh\necho "$1" >> "${log}"\necho "# Converted document"\necho "This converted document text is long enough to be kept as a note."\n`);
    chmodSync(join(fakeBin, "markitdown"), 0o755);
    box.env.PATH = `${fakeBin}:${box.env.PATH}`;
    mkdirSync(join(box.project, "docs"));
    writeFileSync(join(box.project, "docs", "policy.pdf"), "%PDF-1.4 fake bytes");
    writeFileSync(join(box.project, "docs", "notes.md"), "# Notes\nSee the policy.\n");
    assert.equal(box.cm(["init"]).status, 0);
    const first = box.cm(["import", "./docs"], "n\n");
    assert.equal(first.status, 0, first.stdout + first.stderr);
    const second = box.cm(["import", "./docs"], "n\n");
    assert.equal(second.status, 0, second.stdout + second.stderr);
    const calls = readFileSync(log, "utf-8").split("\n").filter((line) => line.includes("policy.pdf"));
    assert.equal(calls.length, 1, `markitdown ran ${calls.length} times`);
  });
});

describe("A6 English UI", () => {
  test("graph UI strings are English even for an Italian map", () => {
    const box = sandbox("ui", { CM_NO_LLM: "1" });
    mkdirSync(join(box.project, "src"), { recursive: true });
    writeFileSync(join(box.project, "src", "a.js"), "export function a() { return 1; }\n");
    assert.equal(box.cm(["init", "--deep", "--no-llm"]).status, 0);
    const d = new DatabaseSync(join(box.project, "memory", "state.db"));
    const map = { language: "it", fingerprint: "x", stale: false,
      parts: [{ id: "porta", emoji: "🚪", name: "La Porta", summary: "Riceve le richieste.", files: ["src/a.js"] }], flows: [],
      flow: { journeys: [{ id: "j", title: "Quando entri", summary: "Entri.", start: "s", nodes: ["s", "e"] }],
        nodes: [{ id: "s", kind: "start", title: "Entri", detail: "", part: "porta" }, { id: "e", kind: "end", title: "Fatto", detail: "", part: "porta" }],
        links: [{ from: "s", to: "e", label: "" }] } };
    d.prepare("INSERT OR REPLACE INTO cm_meta(key,value) VALUES('logic_map',?)").run(JSON.stringify(map));
    d.close();
    assert.equal(box.cm(["logic", "--no-llm"]).status, 0);
    const html = readFileSync(join(box.project, "memory", "graph-3d.html"), "utf-8");
    assert.match(html, /How it works/);
    assert.match(html, /Quando entri/);
    assert.doesNotMatch(html, /Come funziona|Vista tecnica|Percorsi/);
  });
});
