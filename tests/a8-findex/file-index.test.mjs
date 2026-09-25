// A8 — file index: natural-language question → the file that answers it.
//
// WHAT IS PINNED
//   1. splitIdentifiers: camelCase / snake_case / kebab-case become words, so
//      "credit status" matches setJevStatus.
//   2. fileIndexDoc: code files index their symbols and comments, Markdown
//      files their headings and text.
//   3. fileSearchQuery: question → FTS5 OR query without stopwords.
//   4. `cm query` and `cm recall` start with "Relevant files" ranked by the
//      index; the index follows file edits without a re-index.
//   5. With Jev, the top candidates are re-ranked by a yes/no "does this file
//      answer the question?" decision.
//
// HOW
//   1-3 evaluate helpers from the shipped bundle; 4-5 run the CLI in an
//   isolated HOME, 5 against a local fake Jev server.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const BIN = process.env.CM_BIN || join(repoRoot, "bin", "cm");
const bundleSource = readFileSync(BIN, "utf-8");

function pick(name) {
  const start = bundleSource.indexOf(`function ${name}(`);
  assert.ok(start !== -1, `function ${name} must exist in the bundle`);
  const next = bundleSource.indexOf("\nfunction ", start + 1);
  return bundleSource.slice(start, next === -1 ? bundleSource.length : next);
}

const HAS_FTS5 = (() => {
  try {
    const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
    const d = new DatabaseSync(":memory:");
    d.exec("CREATE VIRTUAL TABLE t USING fts5(x, tokenize='porter unicode61')");
    d.close();
    return true;
  } catch { return false; }
})();

function helpers() {
  const names = ["splitIdentifiers", "fileIndexDoc", "fileSearchQuery"];
  const stop = bundleSource.match(/const FINDEX_STOPWORDS = [^\n]+/)?.[0];
  assert.ok(stop, "FINDEX_STOPWORDS must exist");
  return new Function(`${stop}\n${names.map(pick).join("\n")}\nreturn { ${names.join(", ")} };`)();
}

describe("A8 file index helpers", () => {
  const h = helpers();

  test("identifiers become words", () => {
    assert.equal(h.splitIdentifiers("setJevStatus"), "set jev status");
    assert.equal(h.splitIdentifiers("snake_case_name kebab-name"), "snake case name kebab name");
    assert.equal(h.splitIdentifiers("parseHTTPResponse"), "parse http response");
  });

  test("code documents carry symbols and comments", () => {
    const doc = h.fileIndexDoc("src/jev.js", "// Credit problems are persisted in jev-status.json.\nfunction setJevStatus(state) {\n  return state; // keep\n}\nconst jevRetryMs = 5;\n");
    assert.match(doc.name, /jev/);
    assert.match(doc.symbols, /setJevStatus/);
    assert.match(doc.symbols, /set jev status/);
    assert.match(doc.comments, /Credit problems are persisted/);
    assert.match(doc.summary, /setJevStatus/);
  });

  test("markdown documents carry headings and text", () => {
    const doc = h.fileIndexDoc("docs/guide.md", "# Install guide\nRun the installer, then configure the key.\n## Troubleshooting\nIf it fails, retry.\n");
    assert.match(doc.symbols, /Install guide/);
    assert.match(doc.symbols, /Troubleshooting/);
    assert.match(doc.body, /configure the key/);
    assert.match(doc.summary, /Install guide/);
  });

  test("question → OR query without stopwords", () => {
    const q = h.fileSearchQuery("Where is the Jev creditStatus stored?");
    assert.equal(q, '"jev" OR "credit" OR "status" OR "stored"');
    assert.equal(h.fileSearchQuery("how is the"), "");
  });
});

describe("A8 cm query / cm recall", { skip: !HAS_FTS5 && "no FTS5 in this SQLite build" }, () => {
  let root, server, endpoint;
  const calls = [];
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "cm-a8-"));
    // Fake Jev: says "yes" only for the file whose path contains "billing".
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        const payload = JSON.parse(body);
        calls.push(payload);
        const answers = {};
        for (const id of Object.keys(payload.questions)) {
          const line = payload.state.split("\n").find((l) => l.startsWith(`FILE ${id}:`)) || "";
          answers[id] = { type: "noul", noul: /billing/.test(line) ? 0.97 : 0.02 };
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ model: "jev-test", answers }));
      });
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    endpoint = `http://127.0.0.1:${server.address().port}/v1/systemone`;
  });
  after(() => { server?.close(); try { rmSync(root, { recursive: true, force: true }); } catch {} });

  function project(name, extraEnv) {
    const dir = join(root, name);
    const home = join(dir, "home");
    mkdirSync(join(dir, "src"), { recursive: true });
    mkdirSync(join(dir, "docs"), { recursive: true });
    mkdirSync(home, { recursive: true });
    writeFileSync(join(dir, "src", "credit.js"), "// Credit problems are persisted in a status file so every command can warn the user.\nfunction setCreditStatus(state) { return state; }\nmodule.exports = { setCreditStatus };\n");
    writeFileSync(join(dir, "src", "layout.js"), "// Deterministic force layout for the 3D view.\nfunction forceLayout(nodes) { return nodes; }\nmodule.exports = { forceLayout };\n");
    writeFileSync(join(dir, "src", "billing.js"), "// Invoices and payments.\nfunction createInvoice(order) { return order; }\nmodule.exports = { createInvoice };\n");
    writeFileSync(join(dir, "docs", "install.md"), "# Install guide\nRun the installer, then configure the API key with the config command.\n");
    const env = { ...process.env, HOME: home, CM_NO_OLLAMA: "1", CM_NO_NOTIFY: "1", CM_LLM_HARNESS: "none" };
    delete env.TYPESAFE_API_KEY;
    Object.assign(env, extraEnv);
    const run = (args) => new Promise((resolve) => {
      const child = spawn(process.execPath, [BIN, ...args], { cwd: dir, env });
      let stdout = "", stderr = "";
      child.stdout.on("data", (c) => { stdout += c; });
      child.stderr.on("data", (c) => { stderr += c; });
      child.on("close", (status) => resolve({ status, stdout, stderr }));
    });
    return { dir, run };
  }

  const firstFile = (out) => out.split("\n").find((l) => /^\s+1\. /.test(l))?.trim();

  test("query and recall put the answering file first; edits are picked up", async () => {
    const p = project("plain", {});
    assert.equal((await p.run(["init", "--deep", "--no-llm"])).status, 0);
    const q = await p.run(["query", "where is the credit status persisted?"]);
    assert.equal(q.status, 0, q.stderr);
    assert.match(q.stdout, /^Relevant files:/m);
    assert.match(firstFile(q.stdout), /src\/credit\.js/);
    const r = await p.run(["recall", "how do I configure the API key"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(firstFile(r.stdout), /docs\/install\.md/);
    // A new function is findable right away, without cm update.
    writeFileSync(join(p.dir, "src", "layout.js"), "// Deterministic force layout for the 3D view.\nfunction forceLayout(nodes) { return nodes; }\n// Exports the graph as a glowing nebula picture.\nfunction exportNebulaPicture() {}\n");
    const again = await p.run(["query", "glowing nebula picture"]);
    assert.match(firstFile(again.stdout), /src\/layout\.js/);
  });

  test("with Jev the top candidates are re-ranked", async () => {
    const p = project("jev", { TYPESAFE_API_KEY: "apikey_test", CM_JEV_ENDPOINT: endpoint });
    assert.equal((await p.run(["init", "--deep", "--no-llm"])).status, 0);
    calls.length = 0;
    const q = await p.run(["query", "credit status invoices"]);
    assert.equal(q.status, 0, q.stderr);
    assert.ok(calls.length === 1, "one Jev call per question");
    assert.match(firstFile(q.stdout), /src\/billing\.js/);
  });
});
