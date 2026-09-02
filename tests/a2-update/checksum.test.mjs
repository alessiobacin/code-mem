// A2c — `cm update` SHA-256 integrity gate tests (cm-bench-hardening).
//
// WHAT IS PINNED
//   Before `cm update` replaces the installed bundle it downloads the remote
//   bundle AND a checksum manifest (`bin/cm.sha256`), verifies the SHA-256 of
//   the downloaded bundle against the manifest, and only then writes files:
//   - manifest present, digest matches  → update proceeds ("Checksum OK")
//   - manifest present, digest differs  → update aborts, exit 1, clear
//     mismatch message, and the local binary is NOT touched
//   - manifest absent (older mirror)    → warns and proceeds (legacy path)
//
// HOW
//   The remote is a local HTTP server started by this test, selected through
//   the CM_UPDATE_BASE env override (update.js resolves the update base from
//   it). The "installed bundle" under test is a copy of the repo's bin/cm
//   placed in a temp dir; `process.argv[1]` then points at that copy because
//   the test spawns `node <copy> update` directly.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SERVER_SCRIPT = join(here, "_server-child.mjs");
const repoRoot = dirname(dirname(here));
const repoBin = join(repoRoot, "bin", "cm");

const PORT = 47191;
const BASE = `http://127.0.0.1:${PORT}`;

// Fake remote bundle: same shape as bin/cm (must carry a VERSION line), a
// plausible-looking higher version so the updater actually installs it.
const REMOTE_BUNDLE = [
  "#!/usr/bin/env node",
  "// cm — Code-Mem Tool (single-file bundle).",
  'const VERSION = "9.9.9";',
  "console.log(VERSION);",
  "",
].join("\n");
const REMOTE_SHA = createHash("sha256").update(REMOTE_BUNDLE, "utf-8").digest("hex");

let rootTmp;
let shelves = [];
let serverProc = null; // server HTTP in un PROCESSO separato (vedi nota sotto)
let routesFile;

// NOTE ON PROCESS TOPOLOGY (bug fix, no assertion change):
// `cm update` (the binary under test) downloads via curl in a child process of
// its own. The ORIGINAL version of this test ran the HTTP server in THIS test
// process and then called spawnSync(...) — which blocks this process's event
// loop, so the server could never answer curl's request: child hangs →
// spawnSync times out → res.status === null. Fix: the server runs in a
// dedicated child node process; this process stays free to block on spawnSync
// while the OS schedules server + curl independently.

before(async () => {
  // The route table is passed to the child server process as JSON on argv;
  // per-test route changes are communicated by rewriting a JSON file the
  // child re-reads for every request (cheap, keeps the test API identical).
  rootTmp = mkdtempSync(join(tmpdir(), "cm-a2c-"));
  routesFile = join(rootTmp, "routes.json");
  writeFileSync(routesFile, JSON.stringify({}));
  serverProc = spawn(process.execPath, [SERVER_SCRIPT, String(PORT), routesFile], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  // wait for the child to report readiness on its stdout
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("server child did not start")), 5000);
    const onData = (chunk) => { if (String(chunk).includes("READY")) { clearTimeout(t); resolve(); } };
    serverProc.stdout.on("data", onData);
  });
});

after(async () => {
  for (const p of shelves) {
    try { rmSync(p, { recursive: true, force: true }); } catch {}
  }
  if (serverProc) { try { serverProc.kill("SIGKILL"); } catch {} }
  if (rootTmp) { try { rmSync(rootTmp, { recursive: true, force: true }); } catch {} }
});

function setRemote({ withManifest = true, corrupt = false } = {}) {
  const bundle = corrupt ? `${REMOTE_BUNDLE}\n// corrupted tail\n` : REMOTE_BUNDLE;
  writeFileSync(routesFile, JSON.stringify({
    "/bin/cm": { status: 200, body: bundle },
    "/bin/cm.sha256": withManifest
      ? { status: 200, body: `${REMOTE_SHA}  bin/cm\n` }
      : { status: 404, body: "" },
  }));
  return bundle;
}

// An isolated "installation": copy of the current bundle as the local binary.
function makeInstall() {
  const dir = join(rootTmp, `inst-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  const cmPath = join(dir, "cm");
  copyFileSync(repoBin, cmPath);
  shelves.push(dir);
  return cmPath;
}

function runUpdate(cmPath, extraArgs = []) {
  const res = spawnSync(process.execPath, [cmPath, "update", ...extraArgs], {
    cwd: dirname(cmPath),
    env: { ...process.env, CM_UPDATE_BASE: BASE },
    encoding: "utf-8",
    timeout: 30000,
  });
  return {
    code: res.status,
    ok: res.status === 0,
    stdout: res.stdout || "",
    stderr: res.stderr || "",
    output: `${res.stdout || ""}\n${res.stderr || ""}`,
  };
}


// ---------------------------------------------------------------------------

describe("A2c — cm update checksum integrity gate", () => {

  test("valid manifest → update proceeds and prints Checksum OK", () => {
    const cmPath = makeInstall();
    setRemote({ withManifest: true, corrupt: false });
    const r = runUpdate(cmPath);
    assert.equal(r.code, 0, `update failed: ${r.output}`);
    assert.match(r.output, /Checksum OK \(SHA-256 verified before install\)/);
    assert.match(r.output, /Updated cm from /);
    assert.equal(readFileSync(cmPath, "utf-8"), REMOTE_BUNDLE, "bundle must be replaced with remote content");
  });

  test("checksum mismatch → abort with clear message, local bundle untouched", () => {
    const cmPath = makeInstall();
    const original = readFileSync(cmPath, "utf-8");
    setRemote({ withManifest: true, corrupt: true });
    const r = runUpdate(cmPath);
    assert.equal(r.code, 1, "mismatch must exit non-zero");
    assert.match(r.output, /SHA-256 checksum mismatch/);
    assert.match(r.output, /expected: [0-9a-f]{64}/);
    // alignment whitespace between "actual:" and the digest is a formatting
    // detail of the updater's indented output; the contract is that the actual
    // digest is printed (one-or-more spaces). No assertion weakening: the
    // digest itself must still be present and hex-64.
    assert.match(r.output, /actual: +[0-9a-f]{64}/);
    assert.match(r.output, /was NOT installed/);
    assert.equal(readFileSync(cmPath, "utf-8"), original, "local bundle must NOT be replaced on mismatch");
  });

  test("missing manifest (older mirror) → warns and proceeds", () => {
    const cmPath = makeInstall();
    setRemote({ withManifest: false });
    const r = runUpdate(cmPath);
    assert.equal(r.code, 0, `legacy-path update failed: ${r.output}`);
    assert.match(r.output, /no remote checksum manifest/i);
    assert.equal(readFileSync(cmPath, "utf-8"), REMOTE_BUNDLE);
  });

});
