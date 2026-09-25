// Optional Jev (TypeSafe AI "System One") client: fast typed decisions
// (choice / score / noul) for classification. cm never depends on it: every
// caller falls back to the harness LLM or deterministic rules when jevAsk()
// returns null. Credit/authorization problems are persisted in
// ~/.cm/jev-status.json so every cm command, the session_start hook and a
// desktop notification tell the user (see jevAlertText).

const JEV_DEFAULT_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const JEV_RETRY_AFTER_MS = 60 * 60 * 1000;

function jevSettings() {
  return {
    key: process.env.TYPESAFE_API_KEY || "",
    endpoint: process.env.CM_JEV_ENDPOINT || JEV_DEFAULT_ENDPOINT,
    model: process.env.CM_JEV_MODEL || "jev-latest",
    disabled: process.env.CM_JEV === "off" || process.env.CM_NO_LLM === "1",
  };
}

function jevStatusPath() {
  return join(globalRoot(), "jev-status.json");
}

function jevStatus() {
  try { return JSON.parse(readFileSync(jevStatusPath(), "utf8")); } catch { return { state: "unknown" }; }
}

function jevAlertText(status = jevStatus()) {
  if (status.state === "exhausted") return `⚠ Jev credit exhausted since ${status.at} — cm is using fallback classification. Top up at console.typesafe.ai, then run: cm jev test --force`;
  if (status.state === "unauthorized") return `⚠ Jev API key rejected since ${status.at} — set a valid key with: cm config set TYPESAFE_API_KEY`;
  return "";
}

function jevNotify(text) {
  console.error(text);
  if (process.env.CM_NO_NOTIFY === "1" || process.platform !== "darwin") return;
  try {
    execFileSync("osascript", ["-e", `display notification ${JSON.stringify(text.replace(/^⚠\s*/, ""))} with title "code-mem"`], { stdio: "ignore", timeout: 5000 });
  } catch {}
}

function setJevStatus(state, message) {
  const previous = jevStatus();
  const next = { state, message: String(message || "").slice(0, 300), at: state === previous.state && previous.at ? previous.at : nowIso(), checked: nowIso() };
  try {
    mkdirSync(globalRoot(), { recursive: true });
    writeFileSync(jevStatusPath(), `${JSON.stringify(next, null, 2)}\n`);
  } catch {}
  // Notify on transitions only, not on every call.
  if (state !== previous.state && state !== "ok") jevNotify(jevAlertText(next));
  return next;
}

function jevAvailable(opts = {}) {
  const settings = jevSettings();
  if (!settings.key || settings.disabled) return false;
  const status = jevStatus();
  if (!opts.force && (status.state === "exhausted" || status.state === "unauthorized")) {
    return Date.now() - Date.parse(status.checked || status.at || 0) > JEV_RETRY_AFTER_MS;
  }
  return true;
}

// questions: { id: { type: "choice"|"score"|"noul", instructions, criteria } }
// Returns { model, answers, usage } or null (unavailable, error, no credit).
async function jevAsk(state, questions, opts = {}) {
  if (!jevAvailable(opts)) return null;
  const settings = jevSettings();
  let response, text = "";
  try {
    response = await fetch(settings.endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${settings.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: settings.model, state, questions }),
      signal: AbortSignal.timeout(Number(process.env.CM_JEV_TIMEOUT_MS || 20000)),
    });
    text = await response.text();
  } catch (error) {
    if (opts.verbose) console.error(`Jev request failed: ${error.message}`);
    return null;
  }
  if (response.status === 402 || (!response.ok && /credit|quota|balance|insufficient|payment|billing/i.test(text))) {
    setJevStatus("exhausted", text);
    return null;
  }
  if (response.status === 401 || response.status === 403) {
    setJevStatus("unauthorized", text);
    return null;
  }
  if (!response.ok) {
    if (opts.verbose) console.error(`Jev HTTP ${response.status}: ${text.slice(0, 200)}`);
    return null;
  }
  const data = safeJsonParse(text, null);
  if (!data?.answers) return null;
  if (jevStatus().state !== "ok") setJevStatus("ok", "");
  return data;
}

async function cmdJev(args) {
  const { flags, rest } = parseArgs(args);
  const sub = rest[0] || "status";
  const settings = jevSettings();
  if (sub === "status") {
    if (!settings.key) { console.log("Jev: not configured (optional). Enable with: cm config set TYPESAFE_API_KEY"); return; }
    const status = jevStatus();
    console.log(`Jev: ${settings.disabled ? "disabled (CM_JEV=off)" : "configured"} · model ${settings.model} · endpoint ${settings.endpoint}`);
    console.log(`Status: ${status.state}${status.at ? ` since ${status.at}` : ""}`);
    const alert = jevAlertText(status);
    if (alert) console.log(alert);
    return;
  }
  if (sub === "test") {
    if (!settings.key) { console.error("Jev: no API key. Set it with: cm config set TYPESAFE_API_KEY"); process.exit(1); }
    const result = await jevAsk("code-mem connectivity check: the sky is blue.", {
      ok: { type: "noul", instructions: "Is the statement in the state true?" },
    }, { force: true, verbose: true });
    if (!result) {
      console.error(jevAlertText() || "Jev test failed (see message above).");
      process.exit(1);
    }
    console.log(`Jev OK · ${result.model} · answer ${JSON.stringify(result.answers.ok)} · usage ${JSON.stringify(result.usage || {})}`);
    return;
  }
  console.error("Usage: cm jev status|test [--force]");
  process.exit(1);
}
