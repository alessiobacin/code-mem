// Global per-user graph service lifecycle and project registry.
//
// The service is intentionally local-only. The registry is the trust boundary:
// an HTML graph carries an opaque project token, while the server resolves the
// token to one canonical project root and opens only that project's memory DB.

const GRAPH_SERVICE_LABEL = "com.codemem.graphd";
const GRAPH_SERVICE_PORT = 4804;

function graphServicePort() {
  const configured = Number.parseInt(process.env.CM_GRAPH_SERVICE_PORT || "", 10);
  return Number.isInteger(configured) && configured >= 1024 && configured <= 65535
    ? configured
    : GRAPH_SERVICE_PORT;
}

function graphServiceUrl(port = graphServicePort()) {
  return `http://127.0.0.1:${port}`;
}

function graphServiceRoot() {
  return join(globalRoot(), "graphd");
}

function graphServiceRegistryPath() {
  return join(graphServiceRoot(), "projects.json");
}

function graphServicePidPath() {
  return join(graphServiceRoot(), "graphd.pid");
}

function graphServiceLogPath() {
  return join(graphServiceRoot(), "graphd.log");
}

function graphServiceRegistry() {
  try {
    const value = JSON.parse(readFileSync(graphServiceRegistryPath(), "utf8"));
    return value && typeof value === "object" && value.projects && typeof value.projects === "object"
      ? value
      : { version: 1, projects: {} };
  } catch {
    return { version: 1, projects: {} };
  }
}

function managedProjectEntries() {
  return Object.values(graphServiceRegistry().projects || {})
    .filter((project) => project && project.id && project.root)
    .sort((a, b) => String(a.name || a.root).localeCompare(String(b.name || b.root)));
}

function resolveManagedProject(selector) {
  const value = String(selector || "").trim();
  if (!value) return null;
  const projects = managedProjectEntries();
  const direct = projects.find((project) => project.id === value);
  if (direct) return direct;
  const root = canonicalPath(value);
  const byRoot = projects.find((project) => canonicalPath(project.root) === root);
  if (byRoot) return byRoot;
  const named = projects.filter((project) => project.name === value);
  return named.length === 1 ? named[0] : null;
}

function graphProjectId(cwd) {
  return `p_${createHash("sha1").update(canonicalPath(cwd)).digest("hex").slice(0, 20)}`;
}

function graphProjectToken(cwd) {
  // This is a local capability, not a remote credential. A stable token keeps
  // already-generated graph HTML usable after a service restart.
  return createHash("sha256")
    .update(`${canonicalPath(cwd)}|code-mem|${VERSION}`)
    .digest("hex")
    .slice(0, 32);
}

function registerGraphProject(cwd) {
  const root = canonicalPath(cwd);
  const id = graphProjectId(root);
  const registry = graphServiceRegistry();
  const previous = registry.projects[id];
  registry.projects[id] = {
    id,
    root,
    token: previous?.token || graphProjectToken(root),
    name: basename(root),
    registeredAt: previous?.registeredAt || nowIso(),
    updatedAt: nowIso(),
  };
  mkdirSync(graphServiceRoot(), { recursive: true });
  wr(graphServiceRegistryPath(), `${JSON.stringify(registry, null, 2)}\n`);
  return registry.projects[id];
}

function graphProjectForId(id) {
  const registry = graphServiceRegistry();
  const project = registry.projects[String(id || "")];
  if (!project || !project.root || !project.token) return null;
  return project;
}

function graphProjectUrl(cwd, port = graphServicePort()) {
  const project = registerGraphProject(cwd);
  const query = new URLSearchParams({ project: project.id, token: project.token }).toString();
  return `${graphServiceUrl(port)}/graph-3d.html?${query}`;
}

function graphProjectFromRequest(url, fallbackCwd = "", globalMode = true) {
  if (!globalMode) return { cwd: fallbackCwd, project: null };
  const id = url.searchParams.get("project");
  const token = url.searchParams.get("token");
  if (!id) return { error: "A project id is required." };
  const project = graphProjectForId(id);
  if (!project) return { error: "Unknown Code-Mem project." };
  if (!token || token !== project.token) return { error: "Invalid Code-Mem project token.", unauthorized: true };
  if (!existsSync(project.root) || !existsSync(mp(project.root, SF))) return { error: "Project memory is unavailable." };
  return { cwd: project.root, project };
}

function graphServiceManager() {
  if (process.platform === "darwin") return "launchd";
  if (process.platform === "linux") return "systemd";
  return "process";
}

function graphServiceUnitPath() {
  if (graphServiceManager() === "launchd") return join(homeDir(), "Library", "LaunchAgents", `${GRAPH_SERVICE_LABEL}.plist`);
  if (graphServiceManager() === "systemd") return join(homeDir(), ".config", "systemd", "user", "codemem-graphd.service");
  return join(graphServiceRoot(), "service.json");
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function plistEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function graphServiceCommandArgs(port = graphServicePort()) {
  return [...process.execArgv, process.argv[1], "service", "run", "--port", String(port)];
}

function writeGraphServiceUnit(port = graphServicePort()) {
  const unitPath = graphServiceUnitPath();
  mkdirSync(dirname(unitPath), { recursive: true });
  if (graphServiceManager() === "launchd") {
    const uid = typeof process.getuid === "function" ? process.getuid() : "";
    const args = graphServiceCommandArgs(port);
    const plistArgs = [process.execPath, ...args].map((arg) => `<string>${plistEscape(arg)}</string>`).join("");
    const servicePath = process.env.PATH || "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>${GRAPH_SERVICE_LABEL}</string>\n<key>ProgramArguments</key><array>${plistArgs}</array>\n<key>RunAtLoad</key><true/>\n<key>KeepAlive</key><true/>\n<key>WorkingDirectory</key><string>${plistEscape(graphServiceRoot())}</string>\n<key>StandardOutPath</key><string>${plistEscape(graphServiceLogPath())}</string>\n<key>StandardErrorPath</key><string>${plistEscape(graphServiceLogPath())}</string>\n<key>EnvironmentVariables</key><dict><key>HOME</key><string>${plistEscape(homeDir())}</string><key>PATH</key><string>${plistEscape(servicePath)}</string><key>CM_GRAPH_SERVICE_PORT</key><string>${port}</string></dict>\n</dict></plist>\n`;
    wr(unitPath, xml);
    return { manager: "launchd", path: unitPath, uid };
  }
  if (graphServiceManager() === "systemd") {
    const command = [process.execPath, ...graphServiceCommandArgs(port)].map(shellQuote).join(" ");
    const servicePath = (process.env.PATH || "/usr/local/bin:/usr/bin:/bin").replaceAll("\\", "\\\\").replaceAll(" ", "\\x20");
    wr(unitPath, `[Unit]\nDescription=Code-Mem global local graph service\nAfter=default.target\n\n[Service]\nExecStart=${command}\nWorkingDirectory=${shellQuote(graphServiceRoot())}\nRestart=always\nRestartSec=2\nEnvironment=PATH=${servicePath}\nEnvironment=CM_GRAPH_SERVICE_PORT=${port}\n\n[Install]\nWantedBy=default.target\n`);
    return { manager: "systemd", path: unitPath };
  }
  wr(unitPath, JSON.stringify({ command: [process.execPath, ...graphServiceCommandArgs(port)], port }, null, 2));
  return { manager: "process", path: unitPath };
}

function runServiceManager(args) {
  try {
    return execFileSync(args[0], args.slice(1), { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    return "";
  }
}

function runServiceManagerOk(args) {
  try {
    execFileSync(args[0], args.slice(1), { encoding: "utf8", stdio: ["ignore", "ignore", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

function graphServiceInstall(port = graphServicePort()) {
  const unit = writeGraphServiceUnit(port);
  let started = false;
  if (unit.manager === "launchd" && unit.uid) {
    runServiceManagerOk(["launchctl", "bootout", `gui/${unit.uid}/${GRAPH_SERVICE_LABEL}`]);
    started = runServiceManagerOk(["launchctl", "bootstrap", `gui/${unit.uid}`, unit.path]);
    if (started) runServiceManagerOk(["launchctl", "kickstart", "-k", `gui/${unit.uid}/${GRAPH_SERVICE_LABEL}`]);
  } else if (unit.manager === "systemd") {
    runServiceManagerOk(["systemctl", "--user", "daemon-reload"]);
    started = runServiceManagerOk(["systemctl", "--user", "enable", "--now", "codemem-graphd.service"]);
  }
  return { ...unit, port, started };
}

function spawnGraphService(port = graphServicePort()) {
  mkdirSync(graphServiceRoot(), { recursive: true });
  const child = spawn(process.execPath, graphServiceCommandArgs(port), {
    cwd: graphServiceRoot(),
    detached: true,
    stdio: "ignore",
    env: { ...process.env, CM_GRAPH_SERVICE_PORT: String(port) },
  });
  child.unref();
  return child.pid;
}

function graphServiceStart(port = graphServicePort()) {
  const manager = graphServiceManager();
  if (existsSync(graphServiceUnitPath())) {
    if (manager === "launchd") {
      const uid = typeof process.getuid === "function" ? process.getuid() : "";
      if (!runServiceManagerOk(["launchctl", "kickstart", "-k", `gui/${uid}/${GRAPH_SERVICE_LABEL}`])) spawnGraphService(port);
    } else if (manager === "systemd") {
      if (!runServiceManagerOk(["systemctl", "--user", "start", "codemem-graphd.service"])) spawnGraphService(port);
    } else {
      spawnGraphService(port);
    }
  } else {
    spawnGraphService(port);
  }
  return graphServiceUrl(port);
}

function graphServiceStop() {
  const manager = graphServiceManager();
  let stopped = false;
  if (manager === "launchd" && existsSync(graphServiceUnitPath())) {
    const uid = typeof process.getuid === "function" ? process.getuid() : "";
    runServiceManager(["launchctl", "bootout", `gui/${uid}/${GRAPH_SERVICE_LABEL}`]);
    stopped = true;
  }
  if (manager === "systemd" && existsSync(graphServiceUnitPath())) {
    runServiceManager(["systemctl", "--user", "stop", "codemem-graphd.service"]);
    stopped = true;
  }
  // Also clean up a fallback process started when the OS user-service manager
  // was unavailable. This prevents a stale fallback from blocking the newly
  // installed launchd/systemd instance with EADDRINUSE.
  try {
    const pid = Number.parseInt(readFileSync(graphServicePidPath(), "utf8"), 10);
    if (pid > 0 && pid !== process.pid) process.kill(pid, "SIGTERM");
    unlinkSync(graphServicePidPath());
    stopped = true;
  } catch {
    // No fallback pid file is normal when the OS service owns the process.
  }
  return stopped;
}

function graphServiceStatus(port = graphServicePort()) {
  return new Promise((resolveStatus) => {
    const request = http.get(`${graphServiceUrl(port)}/api/service/status`, { timeout: 800 }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try { resolveStatus({ running: response.statusCode === 200, ...JSON.parse(body) }); }
        catch { resolveStatus({ running: false, port }); }
      });
    });
    request.on("error", () => resolveStatus({ running: false, port }));
    request.on("timeout", () => { request.destroy(); resolveStatus({ running: false, port }); });
  });
}
