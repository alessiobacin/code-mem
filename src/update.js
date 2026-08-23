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
  const remoteSha = resolveRemoteCommitSha();
  const remoteBase = remoteSha
    ? `https://raw.githubusercontent.com/alessiobacin/code-mem/${remoteSha}`
    : REPO_RAW_BASE;
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
  writeFileSync(targetPath, remoteBin, "utf-8");
  try {
    execSync(`chmod +x "${targetPath.replace(/"/g, '\\"')}"`, { stdio: "ignore" });
  } catch {}

  const remoteSkill = downloadText(`${remoteBase}/skill/SKILL.md`);
  for (const dir of getInstalledSkillDirs()) {
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "SKILL.md"), remoteSkill, "utf-8");
    } catch {}
  }
  if (cmp === 0 && !sameContent) {
    console.log(`Reinstalled cm ${remoteVersion} to refresh mismatched local contents.`);
    return;
  }
  console.log(`Updated cm from ${VERSION} to ${remoteVersion}.`);
}

