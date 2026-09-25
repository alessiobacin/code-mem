// A7 — "Documentation" view: how a repository's documents relate.
//
// WHAT IS PINNED
//   1. docCandidatePairs: explicit links first, then documents that mention
//      another document's file name, then content-similar neighbours; pairs
//      are unordered-unique and capped.
//   2. normalizeDocTopics: LLM topics are sanitised and the compact
//      assignment "index:topic:type" gives every document a topic and a type.
//   3. folderTopics: without an LLM, documents are grouped by folder.
//   4. `cm docs`: builds the map (no LLM: folder topics + link/mention
//      relations); with a Jev endpoint each candidate pair gets a typed
//      relation (via: "jev"); graph-3d.html gets the "Documentation" view.
//
// HOW
//   1-3 evaluate helpers from the shipped bundle source; 4 runs the CLI in an
//   isolated HOME against a local fake Jev server.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
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

function helpers() {
  const names = ["docCandidatePairs", "normalizeDocTopics", "folderTopics", "docMentionKeys", "trigramEmbed", "hash32", "cosineSimilarity", "logicSlug", "isDocumentationSource", "docTitle"];
  const src = `const DOC_TYPES = ["guide","reference","specification","procedure","policy","decision","report","notes","plan","agreement","data","presentation","changelog","other"];\nconst DOC_MAX_PAIRS = 6;\nconst DOC_MAX_TOPICS = 9;\n${names.map(pick).join("\n")}\nreturn { ${names.join(", ")} };`;
  return new Function(src)();
}

const docs = [
  { id: "a", path: "handbook/intro.md", title: "Staff handbook", text: "Welcome. Read the cleaning-procedure before starting. Cleaning rules apply to every shift." },
  { id: "b", path: "handbook/cleaning-procedure.md", title: "Cleaning procedure", text: "How to clean the kitchen every shift: surfaces, tools, logbook." },
  { id: "c", path: "legal/privacy-policy.pdf", title: "Privacy policy", text: "Personal data of customers is kept for two years and never sold." },
  { id: "d", path: "legal/data-retention.docx", title: "Data retention", text: "Personal data of customers is kept for two years, then deleted." },
];

describe("A7 documentation helpers", () => {
  const h = helpers();

  test("candidate pairs: links, then mentions, then similar content", () => {
    const pairs = h.docCandidatePairs(docs, [{ from: "d", to: "c" }]);
    assert.deepEqual(pairs[0], { from: "d", to: "c", via: "link" });
    assert.ok(pairs.some((p) => p.from === "a" && p.to === "b" && p.via === "mention"));
    assert.ok(pairs.every((p) => p.from !== p.to));
    const keys = pairs.map((p) => [p.from, p.to].sort().join("|"));
    assert.equal(new Set(keys).size, keys.length, "pairs are unique regardless of direction");
    assert.ok(pairs.length <= 6);
  });

  test("LLM topics are sanitised and assigned with types", () => {
    const map = h.normalizeDocTopics({
      language: "English",
      topics: [
        { id: "Kitchen Work", emoji: "🍳", name: " Kitchen  work ", summary: "How the kitchen runs." },
        { id: "customer-data", emoji: "🔒", name: "Customer data", summary: "What happens to personal data." },
        { id: "empty", name: "Nobody" },
      ],
      assign: ["0:kitchen-work:guide", "1:kitchen-work:procedure", "2:customer-data:policy", "3:customer-data:bogus-type", "9:empty:guide"],
    }, docs);
    assert.deepEqual(map.topics.map((t) => [t.id, t.name]), [["kitchen-work", "Kitchen work"], ["customer-data", "Customer data"]]);
    assert.deepEqual(map.assign, { a: ["kitchen-work", "guide"], b: ["kitchen-work", "procedure"], c: ["customer-data", "policy"], d: ["customer-data", "other"] });
  });

  test("documentation sources and clean titles", () => {
    for (const path of ["a/guide.md", "legal/policy.pdf", "offer.docx", "minutes/2026-01.mp3", "data/sales.xlsx"]) assert.equal(h.isDocumentationSource(path), true, path);
    for (const path of ["docs/screenshots/home.png", "cover.JPG", "package.json", "data/_journal.json"]) assert.equal(h.isDocumentationSource(path), false, path);
    assert.equal(h.docTitle("glossario.html (document via markitdown)", "# Glossario dei termini\ntesto", "docs/glossario.html"), "Glossario dei termini");
    assert.equal(h.docTitle("offer.pdf (document via markitdown)", "no heading here", "offer.pdf"), "offer.pdf");
    assert.equal(h.docTitle("Staff handbook", "# Other", "a.md"), "Staff handbook");
  });

  test("folder topics without an LLM", () => {
    const t = h.folderTopics(docs);
    assert.deepEqual(t.topics.map((x) => x.name), ["handbook", "legal"]);
    assert.equal(t.assign.c[0], t.topics[1].id);
  });
});

describe("A7 cm docs", () => {
  let root, server, endpoint;
  const calls = [];
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "cm-a7-"));
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        const payload = JSON.parse(body);
        calls.push(payload);
        const answers = {};
        for (const [id, q] of Object.entries(payload.questions)) {
          if (id === "relation") answers[id] = { type: "choice", choice: "details", probabilities: { details: 0.9 }, confidence: 0.9 };
          else if (id === "type") answers[id] = { type: "choice", choice: "procedure", probabilities: { procedure: 0.8 }, confidence: 0.8 };
          else answers[id] = { type: "choice", choice: Object.keys(q.criteria)[0], probabilities: {}, confidence: 0.7 };
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ model: "jev-test", answers, usage: { input_tokens: 10 } }));
      });
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    endpoint = `http://127.0.0.1:${server.address().port}/v1/systemone`;
  });
  after(() => { server?.close(); try { rmSync(root, { recursive: true, force: true }); } catch {} });

  function project(name, extraEnv) {
    const dir = join(root, name);
    const home = join(dir, "home");
    mkdirSync(join(dir, "handbook"), { recursive: true });
    mkdirSync(join(dir, "legal"), { recursive: true });
    mkdirSync(home, { recursive: true });
    writeFileSync(join(dir, "handbook", "intro.md"), "# Staff handbook\nWelcome. Read [the cleaning procedure](cleaning-procedure.md) before starting.\n");
    writeFileSync(join(dir, "handbook", "cleaning-procedure.md"), "# Cleaning procedure\nHow to clean the kitchen every shift: surfaces, tools, logbook.\n");
    writeFileSync(join(dir, "legal", "privacy-policy.md"), "# Privacy policy\nPersonal data of customers is kept for two years. See data-retention for deletion.\n");
    writeFileSync(join(dir, "legal", "data-retention.md"), "# Data retention\nPersonal data of customers is kept for two years, then deleted.\n");
    const env = { ...process.env, HOME: home, CM_NO_OLLAMA: "1", CM_NO_NOTIFY: "1", CM_LLM_HARNESS: "none", ...extraEnv };
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

  test("no LLM, no Jev: folder topics and link/mention relations", async () => {
    const p = project("plain", {});
    assert.equal((await p.run(["init", "--deep", "--no-llm"])).status, 0);
    const r = await p.run(["docs", "--json"]);
    assert.equal(r.status, 0, r.stderr);
    const map = JSON.parse(r.stdout);
    assert.equal(map.docs.length, 4);
    assert.deepEqual(map.topics.map((t) => t.name).sort(), ["handbook", "legal"]);
    const rel = (from, to) => map.relations.find((x) => {
      const f = map.docs.find((d) => d.id === x.from).path, t = map.docs.find((d) => d.id === x.to).path;
      return f.endsWith(from) && t.endsWith(to);
    });
    assert.equal(rel("intro.md", "cleaning-procedure.md")?.via, "link");
    assert.equal(rel("privacy-policy.md", "data-retention.md")?.via, "mention");
    const html = readFileSync(join(p.dir, "memory", "graph-3d.html"), "utf-8");
    assert.match(html, /📚 Documentation/);
    assert.match(html, /Cleaning procedure/);
  });

  test("with Jev: candidate pairs get typed relations and documents get a type", async () => {
    const p = project("jev", { TYPESAFE_API_KEY: "apikey_test", CM_JEV_ENDPOINT: endpoint });
    assert.equal((await p.run(["init", "--deep", "--no-llm"])).status, 0);
    calls.length = 0;
    const r = await p.run(["docs", "--json", "--force"]);
    assert.equal(r.status, 0, r.stderr);
    const map = JSON.parse(r.stdout);
    assert.ok(map.relations.length >= 2);
    assert.ok(map.relations.every((x) => x.via === "jev" && x.type === "details"), JSON.stringify(map.relations));
    assert.ok(map.docs.every((d) => d.type === "procedure"));
    assert.ok(calls.some((c) => c.questions.relation));
    // unchanged documents are not classified again
    calls.length = 0;
    const again = await p.run(["docs", "--json"]);
    assert.equal(again.status, 0);
    assert.equal(calls.length, 0);
  });
});
