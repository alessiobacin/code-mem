// `cm config`: persistent settings (endpoints, API keys, feature switches).
// Global ~/.cm/config.env and project memory/config.env are plain KEY=VALUE
// files, mode 600. Precedence: process env > project > global. Secrets are
// masked when printed and are read from stdin/hidden prompt so they never
// land in shell history.

const CONFIG_FILE = "config.env";
const CONFIG_SECRET_RE = /(KEY|TOKEN|SECRET|PASSWORD|PASS)$/i;

function configPaths(cwd) {
  return { global: join(globalRoot(), CONFIG_FILE), project: mp(cwd, CONFIG_FILE) };
}

function readEnvFile(path) {
  const out = new Map();
  let raw = "";
  try { raw = readFileSync(path, "utf8"); } catch { return out; }
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (match) out.set(match[1], match[2].trim());
  }
  return out;
}

function writeEnvFile(path, entries) {
  mkdirSync(dirname(path), { recursive: true });
  const body = [...entries].map(([key, value]) => `${key}=${value}`).join("\n");
  writeFileSync(path, body ? `${body}\n` : "", { mode: 0o600 });
  chmodSync(path, 0o600);
}

// Applied once at startup, before any setting is read.
function loadCmConfig(cwd) {
  const paths = configPaths(cwd);
  const merged = new Map([...readEnvFile(paths.global), ...readEnvFile(paths.project)]);
  for (const [key, value] of merged) if (process.env[key] === undefined) process.env[key] = value;
}

function maskConfigValue(key, value) {
  if (!CONFIG_SECRET_RE.test(key) || !value) return value;
  return `${"•".repeat(8)}${value.slice(-4)}`;
}

function readSecretInput(prompt) {
  if (!process.stdin.isTTY) {
    try { return readFileSync(0, "utf8").split(/\r?\n/)[0].trim(); } catch { return ""; }
  }
  return new Promise((resolveValue) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (text) => { if (text.includes(prompt)) process.stdout.write(text); };
    rl.question(prompt, (answer) => { rl.close(); process.stdout.write("\n"); resolveValue(String(answer || "").trim()); });
  });
}

async function cmdConfig(cwd, args) {
  const { flags, rest } = parseArgs(args);
  const [sub = "list", key, ...valueParts] = rest;
  const paths = configPaths(cwd);
  const scopePath = flags.project ? paths.project : paths.global;
  if (key !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    console.error(`Invalid setting name: ${key}`);
    process.exit(1);
  }
  if (sub === "list") {
    const global = readEnvFile(paths.global), project = readEnvFile(paths.project);
    if (!global.size && !project.size) { console.log("No cm settings. Set one with: cm config set NAME [value] [--project]"); return; }
    for (const [label, entries] of [[`global (${paths.global})`, global], [`project (${paths.project})`, project]]) {
      if (!entries.size) continue;
      console.log(`# ${label}`);
      for (const [name, value] of entries) console.log(`${name}=${maskConfigValue(name, value)}`);
    }
    return;
  }
  if (!key) { console.error("Usage: cm config set|get|unset NAME [value] [--project]"); process.exit(1); }
  if (sub === "get") {
    const value = process.env[key] ?? "";
    console.log(flags.reveal ? value : maskConfigValue(key, value));
    if (!value) process.exitCode = 1;
    return;
  }
  const entries = readEnvFile(scopePath);
  if (sub === "unset") {
    entries.delete(key);
    writeEnvFile(scopePath, entries);
    console.log(`Removed ${key} (${flags.project ? "project" : "global"}).`);
    return;
  }
  if (sub === "set") {
    let value = valueParts.join(" ").trim();
    if (!value) value = await readSecretInput(`${key}: `);
    if (!value || /[\r\n]/.test(value)) { console.error(`No value for ${key}.`); process.exit(1); }
    entries.set(key, value);
    writeEnvFile(scopePath, entries);
    if (flags.project) {
      // memory/ is committed in some repos: keep project settings out of git.
      const ignore = mp(cwd, ".gitignore");
      const current = existsSync(ignore) ? readFileSync(ignore, "utf8") : "";
      if (!/^config\.env$/m.test(current)) writeFileSync(ignore, `${current}${current && !current.endsWith("\n") ? "\n" : ""}config.env\n`);
    }
    console.log(`Saved ${key}=${maskConfigValue(key, value)} (${flags.project ? "project" : "global"}).`);
    return;
  }
  console.error(`Unknown config command: ${sub}`);
  process.exit(1);
}
