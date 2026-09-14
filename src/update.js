function compareVersions(a, b) {
  const pa = String(a).split(".").map((x) => Number.parseInt(x, 10) || 0);
  const pb = String(b).split(".").map((x) => Number.parseInt(x, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const av = pa[i] || 0;
    const bv = pb[i] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

function sha256Hex(text) {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

// Update source base — overridable via CM_UPDATE_BASE so integrity behaviour
// can be exercised against a local mirror (tests) without network access.
async function resolveUpdateBase() {
  const override = process.env.CM_UPDATE_BASE;
  if (override) return override.replace(/\/+$/, "");
  const remoteSha = await resolveRemoteCommitSha();
  return remoteSha
    ? `https://raw.githubusercontent.com/alessiobacin/code-mem/${remoteSha}`
    : REPO_RAW_BASE;
}

// A remote checksum manifest (`bin/cm.sha256`, hex digest, optionally followed
// by `  <filename>` à la shasum) pins the expected SHA-256 of the bundle.
// - manifest present + digest matches  → proceed
// - manifest present + digest differs  → REFUSE, nothing is written
// - manifest absent (older mirror)     → warn and proceed (legacy behaviour)
async function verifyBundleChecksum(remoteBase, remoteBin) {
  let manifest = null;
  try {
    manifest = await downloadText(`${remoteBase}/bin/cm.sha256`);
  } catch {}
  if (manifest === null || String(manifest).trim() === "") {
    console.log("Warning: no remote checksum manifest (bin/cm.sha256) — integrity check skipped.");
    return true;
  }
  const expected = String(manifest).trim().split(/\s+/)[0].toLowerCase();
  const actual = sha256Hex(remoteBin);
  if (!/^[0-9a-f]{64}$/.test(expected)) {
    console.log("Update aborted: remote checksum manifest is malformed (expected 64 hex chars).");
    return false;
  }
  if (expected !== actual) {
    console.log("Update aborted: SHA-256 checksum mismatch.");
    console.log(`  expected: ${expected}`);
    console.log(`  actual:   ${actual}`);
    console.log("The downloaded bundle differs from the published checksum and was NOT installed.");
    console.log("Retry later (transient corruption) or verify the source before using --force.");
    return false;
  }
  console.log("Checksum OK (SHA-256 verified before install).");
  return true;
}

// Allowlist for remote update hosts (IMP-08): CM_UPDATE_BASE overrides must
// resolve to localhost (tests) or raw.githubusercontent.com / api.github.com.
function isAllowedUpdateUrl(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (!["https:", "http:"].includes(u.protocol)) return false;
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
  return ["raw.githubusercontent.com", "api.github.com"].includes(host);
}

async function downloadText(url) {
  if (!isAllowedUpdateUrl(url)) throw new Error(`blocked host in update URL: ${url}`);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 8 * 1024 * 1024) throw new Error("response too large");
    return buf.toString("utf-8");
  } finally {
    clearTimeout(timer);
  }
}

async function resolveRemoteCommitSha() {
  try {
    const response = await downloadText(REPO_API_COMMIT);
    const parsed = JSON.parse(response);
    return typeof parsed?.sha === "string" ? parsed.sha : null;
  } catch {
    return null;
  }
}

function extractRemoteVersion(source) {
  const match = String(source).match(/const VERSION = "([^"]+)";/);
  return match ? match[1] : null;
}

function getInstalledSkillDirs() {
  return [
    join(process.env.HOME || "", ".pi", "agent", "skills", "cm"),
    join(process.env.HOME || "", ".claude", "skills", "cm"),
    join(process.env.HOME || "", ".codex", "skills", "cm"),
    join(process.env.HOME || "", ".cursor", "skills", "cm"),
    join(process.env.HOME || "", ".gemini", "skills", "cm"),
    join(process.env.HOME || "", ".qwen", "skills", "cm"),
    join(process.env.HOME || "", ".config", "opencode", "skills", "cm"),
    join(process.env.HOME || "", ".codeium", "windsurf", "skills", "cm"),
  ];
}

async function runUpdate(force) {
  const remoteBase = await resolveUpdateBase();
  const remoteBin = await downloadText(`${remoteBase}/bin/cm`);
  const remoteVersion = extractRemoteVersion(remoteBin);
  if (!remoteVersion) {
    console.log("Could not determine remote version.");
    process.exit(1);
  }
  const targetPath = process.argv[1];
  let localSource = "";
  try {
    localSource = readFileSync(targetPath, "utf-8");
  } catch {}
  const cmp = compareVersions(remoteVersion, VERSION);
  const sameContent = localSource === remoteBin;
  if (cmp < 0 && !force) {
    console.log(`Local cm (${VERSION}) is newer than remote (${remoteVersion}).`);
    return;
  }
  if (cmp === 0 && sameContent && !force) {
    console.log(`Already up to date (${VERSION}).`);
    return;
  }
  // Integrity gate: verify the remote bundle's SHA-256 against its published
  // manifest BEFORE any local file is replaced.
  if (!(await verifyBundleChecksum(remoteBase, remoteBin))) {
    process.exit(1);
  }
  writeFileSync(targetPath, remoteBin, "utf-8");
  try {
    chmodSync(targetPath, 0o755);
  } catch {}

  try {
    const remoteSkill = await downloadText(`${remoteBase}/skill/SKILL.md`);
    for (const dir of getInstalledSkillDirs()) {
      try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "SKILL.md"), remoteSkill, "utf-8");
      } catch {}
    }
  } catch {
    console.log("Note: remote skill/SKILL.md unavailable — skipped skill refresh.");
  }
  if (cmp === 0 && !sameContent) {
    console.log(`Reinstalled cm ${remoteVersion} to refresh mismatched local contents.`);
    return;
  }
  console.log(`Updated cm from ${VERSION} to ${remoteVersion}.`);
}

