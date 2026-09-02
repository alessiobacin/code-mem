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
function resolveUpdateBase() {
  const override = process.env.CM_UPDATE_BASE;
  if (override) return override.replace(/\/+$/, "");
  const remoteSha = resolveRemoteCommitSha();
  return remoteSha
    ? `https://raw.githubusercontent.com/alessiobacin/code-mem/${remoteSha}`
    : REPO_RAW_BASE;
}

// A remote checksum manifest (`bin/cm.sha256`, hex digest, optionally followed
// by `  <filename>` à la shasum) pins the expected SHA-256 of the bundle.
// - manifest present + digest matches  → proceed
// - manifest present + digest differs  → REFUSE, nothing is written
// - manifest absent (older mirror)     → warn and proceed (legacy behaviour)
function verifyBundleChecksum(remoteBase, remoteBin) {
  let manifest = null;
  try {
    manifest = downloadText(`${remoteBase}/bin/cm.sha256`);
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

function downloadText(url) {
  const escaped = url.replace(/"/g, '\\"');
  try {
    return execSync(`curl -fsSL "${escaped}"`, {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch {
    return execSync(`wget -qO- "${escaped}"`, {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
      maxBuffer: 8 * 1024 * 1024,
    });
  }
}

function resolveRemoteCommitSha() {
  try {
    const response = downloadText(REPO_API_COMMIT);
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
  ];
}

function runUpdate(force) {
  const remoteBase = resolveUpdateBase();
  const remoteBin = downloadText(`${remoteBase}/bin/cm`);
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
  if (!verifyBundleChecksum(remoteBase, remoteBin)) {
    process.exit(1);
  }
  writeFileSync(targetPath, remoteBin, "utf-8");
  try {
    execSync(`chmod +x "${targetPath.replace(/"/g, '\\"')}"`, { stdio: "ignore" });
  } catch {}

  try {
    const remoteSkill = downloadText(`${remoteBase}/skill/SKILL.md`);
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

