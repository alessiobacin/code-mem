// A5 — plain-language "logic view" of a repository.
//
// WHAT IS PINNED
//   1. logicInventory: source files come from function/class nodes
//      (metadata.source_path); cross-file `calls` become weighted file links.
//   2. normalizeLogicMap: LLM output is sanitised — unknown/duplicate files
//      dropped, orphans attached to their most-linked part, empty parts and
//      dangling/self flows removed, at most 9 parts.
//   3. carryLogicMap: without an LLM a previous map follows file changes
//      (removed files dropped, new files attached by links) and turns stale.
//   4. `cm logic` + graph-3d.html: no map -> no view toggle; a stored map ->
//      toggle and the plain-language parts embedded in the page.
//
// HOW
//   1-3 evaluate the pure helpers from the shipped bundle source. 4 runs the
//   CLI with LLMs disabled and seeds the map through cm_meta.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const BIN = process.env.CM_BIN || join(repoRoot, "bin", "cm");
const bundleSource = readFileSync(BIN, "utf-8");

function pick(name) {
  const start = bundleSource.indexOf(`function ${name}(`);
  assert.ok(start !== -1, `function ${name} must exist in the bundle`);
  const next = bundleSource.indexOf("\nfunction ", start + 1);
  return bundleSource.slice(start, next === -1 ? bundleSource.length : next);
}

function loadHelpers() {
  const names = ["logicInventory", "logicFingerprint", "assignLogicOrphans", "logicFlowWeights", "normalizeLogicMap", "carryLogicMap", "logicUnits", "logicSlug", "normalizeLogicFlow"];
  const src = `const LOGIC_MAX_PARTS = 9;\nconst LOGIC_MAX_UNITS = 120;\n${names.map(pick).join("\n")}\nreturn { ${names.join(", ")} };`;
  return new Function("createHash", src)(createHash);
}

const graph = {
  nodes: [
    { id: "f1", type: "function", label: "saveNote", metadata: { source_path: "src/store.js" } },
    { id: "f2", type: "function", label: "findNote", metadata: { source_path: "src/search.js" } },
    { id: "f3", type: "function", label: "main", metadata: { source_path: "src/cli.js" } },
    { id: "f4", type: "class", label: "Index", metadata: { source_path: "src/search.js" } },
    { id: "d1", type: "document", label: "README", metadata: { source_path: "README.md" } },
  ],
  edges: [
    { source: "f3", target: "f1", relation: "calls" },
    { source: "f3", target: "f2", relation: "calls" },
    { source: "f3", target: "f2", relation: "calls" },
    { source: "f2", target: "f1", relation: "calls" },
    { source: "f2", target: "f4", relation: "calls" },
  ],
};

describe("A5 logic view helpers", () => {
  const h = loadHelpers();

  test("inventory lists code files and weighted cross-file links", () => {
    const inv = h.logicInventory(graph);
    assert.deepEqual(inv.files, [
      { path: "src/cli.js", symbols: ["main"] },
      { path: "src/search.js", symbols: ["Index", "findNote"] },
      { path: "src/store.js", symbols: ["saveNote"] },
    ]);
    assert.deepEqual(inv.links[0], { from: "src/cli.js", to: "src/search.js", weight: 2 });
    assert.equal(inv.links.length, 3);
    assert.equal(h.logicFingerprint(inv), h.logicFingerprint(h.logicInventory(graph)));
  });

  test("LLM output is sanitised into a consistent map", () => {
    const inv = h.logicInventory(graph);
    const raw = {
      language: "English",
      parts: [
        { id: "Front Door", emoji: "🚪", name: "  The   Front Door ", summary: "Takes your requests.", files: ["src/cli.js", "src/ghost.js"] },
        { id: "notebook", emoji: "📒", name: "The Notebook", summary: "Keeps notes.", files: ["src/store.js", "src/cli.js"] },
        { id: "empty", emoji: "❓", name: "Nobody", files: [] },
      ],
      flows: [
        { from: "front-door", to: "notebook", verb: "writes in" },
        { from: "front-door", to: "front-door", verb: "loops" },
        { from: "front-door", to: "empty", verb: "asks" },
      ],
    };
    const map = h.normalizeLogicMap(raw, inv);
    assert.deepEqual(map.parts.map((p) => [p.id, p.name, p.files]), [
      // search.js was not assigned by the LLM: it joins its most-linked part
      // (2 calls from cli.js vs 1 call into store.js)
      ["front-door", "The Front Door", ["src/cli.js", "src/search.js"]],
      ["notebook", "The Notebook", ["src/store.js"]],
    ]);
    // weight = calls between the two parts' files, both directions
    assert.deepEqual(map.flows.map((f) => [f.from, f.to, f.verb, f.weight]), [["front-door", "notebook", "writes in", 2]]);
    assert.equal(map.stale, false);
    assert.equal(map.fingerprint, h.logicFingerprint(inv));
    const many = { parts: Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, name: `Part ${i}`, files: i < 3 ? [inv.files[i].path] : [] })) };
    assert.ok(h.normalizeLogicMap(many, inv).parts.length <= 9);
    assert.equal(h.normalizeLogicMap({ parts: [] }, inv), null);
  });

  test("big repos are offered as folders and folder answers expand to files", () => {
    const files = [];
    for (let i = 0; i < 130; i += 1) files.push({ path: `app/${i % 2 ? "ui" : "api"}/f${i}.js`, symbols: [`fn${i}`] });
    files.push({ path: "tools/build.js", symbols: ["build"] });
    const inv = { files: files.sort((a, b) => a.path.localeCompare(b.path)), links: [] };
    const units = h.logicUnits(inv);
    assert.deepEqual(units.map((u) => [u.key, u.count]), [["app/api/", 65], ["app/ui/", 65], ["tools/", 1]]);
    const map = h.normalizeLogicMap({ parts: [
      { id: "screens", name: "The Screens", files: ["app/ui/"] },
      { id: "helpers", name: "The Helpers", files: ["app/api/", "tools/build.js"] },
    ] }, inv);
    assert.equal(map.parts[0].files.length, 65);
    assert.equal(map.parts[1].files.length, 66);
    const small = h.logicUnits(h.logicInventory(graph));
    assert.deepEqual(small.map((u) => u.key), ["src/cli.js", "src/search.js", "src/store.js"]);
  });

  test("flowchart: journeys, decisions with branches, reachable nodes only", () => {
    const map = { parts: [{ id: "door", files: [] }, { id: "notebook", files: [] }] };
    const raw = {
      journeys: [
        { id: "Save A Note", title: "When you save a note", summary: "What happens to a new note.", start: "write" },
        { id: "ghost", title: "Broken", start: "nowhere" },
      ],
      nodes: [
        { id: "write", kind: "start", title: "You write a note", detail: "You type something to remember.", part: "door" },
        { id: "known", kind: "decision", title: "Is it already known?", part: "notebook" },
        { id: "keep", kind: "store", title: "Kept in the notebook", part: "notebook" },
        { id: "skip", kind: "end", title: "Nothing new to keep", part: "unknown-part" },
        { id: "lonely", kind: "decision", title: "Only one way out?", part: "notebook" },
        { id: "orphan", kind: "step", title: "Never reached", part: "door" },
        { id: "known", kind: "step", title: "Duplicate id", part: "door" },
      ],
      links: [
        { from: "write", to: "known" },
        { from: "known", to: "keep", label: "no" },
        { from: "known", to: "skip", label: "yes" },
        { from: "known", to: "skip", label: "maybe" },
        { from: "keep", to: "lonely" },
        { from: "lonely", to: "skip", label: "" },
        { from: "write", to: "ghost-node" },
        { from: "write", to: "write" },
        { from: "write", to: "known" },
      ],
    };
    const flow = h.normalizeLogicFlow(raw, map);
    assert.deepEqual(flow.journeys.map((j) => [j.id, j.nodes]), [["save-a-note", ["write", "known", "keep", "skip", "lonely"]]]);
    const kinds = Object.fromEntries(flow.nodes.map((n) => [n.id, [n.kind, n.part]]));
    assert.deepEqual(kinds, {
      write: ["start", "door"],
      known: ["decision", "notebook"],
      keep: ["store", "notebook"],
      skip: ["end", null],
      lonely: ["step", "notebook"], // a decision with a single way out is just a step
    });
    assert.deepEqual(flow.links.map((l) => [l.from, l.to, l.label]), [
      ["write", "known", ""], ["known", "keep", "no"], ["known", "skip", "yes / maybe"], ["keep", "lonely", ""], ["lonely", "skip", ""],
    ]);
    assert.equal(h.normalizeLogicFlow({ journeys: [], nodes: [], links: [] }, map), null);
    // compact form (arrays + "from>to|label" strings) gives the same flowchart
    const compact = h.normalizeLogicFlow({
      journeys: raw.journeys,
      nodes: raw.nodes.map((n) => [n.id, n.kind, n.part, n.title, n.detail || ""]),
      links: raw.links.map((l) => `${l.from}>${l.to}${l.label ? `|${l.label}` : ""}`),
    }, map);
    assert.deepEqual(compact, flow);
    // explicit steps keep a journey to its own path instead of spilling into
    // other journeys through shared steps
    const listed = h.normalizeLogicFlow({ ...raw, journeys: [
      { id: "save", title: "Save", start: "write", steps: ["write", "known", "keep", "nowhere"] },
      { id: "check", title: "Check", start: "keep", steps: ["keep", "lonely", "skip"] },
    ] }, map);
    assert.deepEqual(listed.journeys.map((j) => [j.id, j.nodes]), [["save", ["write", "known", "keep"]], ["check", ["keep", "lonely", "skip"]]]);
  });

  test("without an LLM a previous map follows file changes and turns stale", () => {
    const prev = h.normalizeLogicMap({
      parts: [
        { id: "door", name: "The Front Door", files: ["src/cli.js", "src/old.js"] },
        { id: "notebook", name: "The Notebook", files: ["src/store.js"] },
      ],
      flows: [{ from: "door", to: "notebook", verb: "writes in" }],
    }, { files: [{ path: "src/cli.js", symbols: [] }, { path: "src/old.js", symbols: [] }, { path: "src/store.js", symbols: [] }], links: [] });
    const inv = h.logicInventory(graph);
    const map = h.carryLogicMap(prev, inv);
    assert.equal(map.stale, true);
    assert.equal(map.fingerprint, prev.fingerprint);
    assert.deepEqual(map.parts.find((p) => p.id === "door").files, ["src/cli.js", "src/search.js"]);
    assert.deepEqual(map.parts.find((p) => p.id === "notebook").files, ["src/store.js"]);
    assert.equal(map.flows[0].weight, 2);
  });
});

describe("A5 cm logic + 3D view toggle", () => {
  let root;
  before(() => { root = mkdtempSync(join(tmpdir(), "cm-a5-")); });
  after(() => { try { rmSync(root, { recursive: true, force: true }); } catch {} });

  test("toggle appears only when a logic map exists", () => {
    const project = join(root, "project");
    const home = join(root, "home");
    mkdirSync(join(project, "src"), { recursive: true });
    mkdirSync(home, { recursive: true });
    writeFileSync(join(project, "README.md"), "# Notes app\nA tiny notes app.\n");
    writeFileSync(join(project, "src", "store.js"), "export function saveNote(n) { return n; }\n");
    writeFileSync(join(project, "src", "cli.js"), "import { saveNote } from './store.js';\nexport function main() { return saveNote('x'); }\n");
    const env = { ...process.env, HOME: home, CM_NO_LLM: "1", CM_NO_OLLAMA: "1", CM_LLM_HARNESS: "none" };
    const cm = (...args) => spawnSync(process.execPath, [BIN, ...args], { cwd: project, env, encoding: "utf-8", timeout: 120000 });
    const init = cm("init", "--deep", "--no-llm");
    assert.equal(init.status, 0, init.stdout + init.stderr);
    const html = () => readFileSync(join(project, "memory", "graph-3d.html"), "utf-8");

    const first = cm("logic");
    assert.equal(first.status, 0, first.stdout + first.stderr);
    assert.match(first.stdout, /LLM/);
    assert.doesNotMatch(html(), /data-view="logic"/);

    const d = new DatabaseSync(join(project, "memory", "state.db"));
    const seeded = { language: "English", fingerprint: "old", stale: false, parts: [
      { id: "door", emoji: "🚪", name: "The Front Door", summary: "Takes your requests.", files: ["src/cli.js"] },
      { id: "notebook", emoji: "📒", name: "The Notebook", summary: "Keeps your notes safe.", files: ["src/store.js"] },
    ], flows: [{ from: "door", to: "notebook", verb: "writes in", weight: 1 }] };
    d.prepare("INSERT OR REPLACE INTO cm_meta(key,value) VALUES('logic_map',?)").run(JSON.stringify(seeded));
    d.close();

    const second = cm("logic");
    assert.equal(second.status, 0, second.stdout + second.stderr);
    assert.match(second.stdout, /The Front Door/);
    assert.match(second.stdout, /writes in/);
    const page = html();
    assert.match(page, /data-view="logic"/);
    assert.match(page, /The Notebook/);
    assert.match(page, /Keeps your notes safe\./);
  });
});
