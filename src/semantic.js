function buildAutoQuery(c) {
  const parts = [`cwd: ${c}`];
  try {
    const branch = getGitBranch(c);
    if (branch) parts.push(`branch: ${branch}`);
    const log = execSync("git log --oneline -5", {
      cwd: c,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
      timeout: 3000,
    }).trim();
    if (log) parts.push(`recent: ${log}`);
  } catch {}
  return parts.join(" | ");
}

function sd(d, q, l) {
  const s = q
    .replace(/['"]/g, "")
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((t) => `"${t}"*`)
    .join(" ");
  if (!s) return [];
  try {
    return allStmt(
      d,
      "SELECT role,content,session_id,timestamp FROM messages_fts WHERE messages_fts MATCH ? ORDER BY rank LIMIT ?",
      [s, l]
    );
  } catch {
    const like = `%${q}%`;
    return allStmt(
      d,
      "SELECT role,content,session_id,timestamp FROM messages WHERE content LIKE ? OR role LIKE ? ORDER BY id DESC LIMIT ?",
      [like, like, l]
    );
  }
}

function eg(c) {
  const p = join(c, ".gitignore");
  const e = "\n# Project memory\nmemory/\n";
  const x = rd(p);
  if (!x.includes("memory/")) {
    appendFileSync(p, e, "utf-8");
  }
}

