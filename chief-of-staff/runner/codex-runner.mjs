// Codex runner: runs the Chief of Staff's jobs on your ChatGPT plan, with Codex on this computer.
//
// Every 30 seconds it asks the Chief of Staff for a Codex run (and tells it how much of the plan is used, so
// "Automatic" jobs only come here when there's room). A run is done with `codex exec`: live web search, read-only
// (it can't change anything on this computer), in its own empty folder. The answer goes back to the Chief of Staff,
// which posts it in the job's Telegram topic. Started at login by the Windows task "Chief of Staff Codex runner".
//
// Email runs: Codex writes or sends emails with its Gmail app. Sending only happens for emails the user tapped Send on
// in the app; Codex's own safety reviewer (auto review) checks each send.
//
// Plan windows: a tiny "hi" to Codex and to Claude a minute after each 5-hour window ends starts the next window
// right away, so the reset times land earlier in the day instead of waiting for the first real use.
//
// Needs: Codex (the desktop app) signed in with ChatGPT, and the agent key in C:\Users\Yoni\.tokens\cos-agent-key.txt.
// For the Claude "hi": a Claude subscription token from `claude setup-token` in C:\Users\Yoni\.tokens\claude-code-oauth.txt.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, appendFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const API = "https://chief-of-staff.gremiercoffee.workers.dev";
const HOME = homedir();
const KEY_FILE = join(HOME, ".tokens", "cos-agent-key.txt");
const WORK = join(HOME, "ChiefOfStaff", "codex-runner", "work");
const LOG = join(HOME, "ChiefOfStaff", "codex-runner", "runner.log");
const RUN_TIMEOUT_MS = 12 * 60_000;
const CLAUDE_TOKEN_FILE = join(HOME, ".tokens", "claude-code-oauth.txt");
const WINDOWS_FILE = join(HOME, "ChiefOfStaff", "codex-runner", "plan-windows.json");
const WINDOW_MS = 5 * 3600_000;
const AFTER_RESET_MS = 60_000;
mkdirSync(WORK, { recursive: true });

const log = (s) => { try { appendFileSync(LOG, `${new Date().toISOString()} ${s}\n`); } catch { /* never stop for the log */ } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = () => readFileSync(KEY_FILE, "utf8").replace(/\s+/g, "");

/** The newest codex.exe the Codex app installed (its folder changes with each update). */
function codexExe() {
  const bin = join(HOME, "AppData", "Local", "OpenAI", "Codex", "bin");
  const found = existsSync(bin) ? readdirSync(bin).map((d) => join(bin, d, "codex.exe")).filter(existsSync) : [];
  found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (!found[0]) throw new Error("Codex isn't installed (no codex.exe under AppData\\Local\\OpenAI\\Codex\\bin)");
  return found[0];
}

async function api(path, body) {
  const r = await fetch(API + path, { method: "POST", headers: { "content-type": "application/json", "x-agent-key": key() }, body: JSON.stringify(body ?? {}) });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}

/** How much of the ChatGPT plan's Codex allowance is used (5-hour and weekly windows, in percent), and when the 5-hour window ends. */
function planUsage() {
  return new Promise((resolve) => {
    const p = spawn(codexExe(), ["app-server"], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
    let buf = "", done = false;
    const finish = (v) => { if (done) return; done = true; try { p.kill(); } catch { /* gone */ } resolve(v); };
    const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");
    p.stdout.on("data", (d) => {
      buf += d;
      for (let i; (i = buf.indexOf("\n")) >= 0; ) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        try {
          const m = JSON.parse(line);
          if (m.id === 1) { send({ method: "initialized" }); send({ id: 2, method: "account/rateLimits/read" }); }
          if (m.id === 2) {
            const l = m.result?.rateLimits;
            finish(l ? { primary: l.primary?.usedPercent ?? 0, secondary: l.secondary?.usedPercent ?? 0, resetsAt: l.primary?.resetsAt ? l.primary.resetsAt * 1000 : null } : null);
          }
        } catch { /* not JSON */ }
      }
    });
    p.on("error", () => finish(null));
    send({ id: 1, method: "initialize", params: { clientInfo: { name: "cos-codex-runner", version: "1" } } });
    setTimeout(() => finish(null), 20_000);
  });
}

/** One run: Codex answers the prompt (live web search; Gmail for email runs); the last message is the answer. */
function runCodex(prompt, model, opts = {}) {
  return new Promise((resolve) => {
    const dir = join(WORK, String(Date.now()));
    mkdirSync(dir, { recursive: true });
    const args = ["exec", "--json", "--skip-git-repo-check", "-s", "read-only",
      ...(opts.hi ? ["-c", 'web_search="disabled"', "-c", 'model_reasoning_effort="low"'] : ["-c", 'web_search="live"']),
      // Gmail (email runs): tool calls go to Codex's own approval reviewer instead of being refused.
      ...(opts.gmail ? ["-c", 'approval_policy="on-request"', "-c", 'approvals_reviewer="auto_review"'] : []),
      ...(model ? ["-m", model] : []), "-"];
    const p = spawn(codexExe(), args, { cwd: dir, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let buf = "", last = "", err = "";
    p.stdout.on("data", (d) => {
      buf += d;
      for (let i; (i = buf.indexOf("\n")) >= 0; ) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        try { const m = JSON.parse(line); if (m.type === "item.completed" && m.item?.type === "agent_message") last = m.item.text; if (m.type === "error" || m.type === "turn.failed") err = JSON.stringify(m).slice(0, 300); } catch { /* not JSON */ }
      }
    });
    p.stderr.on("data", (d) => { err = (err + d).slice(-600); });
    const timer = setTimeout(() => { err = "took too long"; p.kill(); }, RUN_TIMEOUT_MS);
    p.on("close", () => { clearTimeout(timer); resolve({ text: last.trim(), error: last.trim() ? "" : err || "no answer" }); });
    p.stdin.end(prompt);
  });
}

// ---- Plan windows ---------------------------------------------------------------------------------
const readWindows = () => { try { return JSON.parse(readFileSync(WINDOWS_FILE, "utf8")); } catch { return {}; } };
const saveWindows = (w) => { try { writeFileSync(WINDOWS_FILE, JSON.stringify(w)); } catch { /* next time */ } };

/** The newest Claude Code that the Claude desktop app installed. */
function claudeExe() {
  const root = join(HOME, "AppData", "Local", "Claude-Data");
  const found = [];
  for (const a of existsSync(root) ? readdirSync(root) : []) {
    const cc = join(root, a, "claude-code");
    for (const v of existsSync(cc) ? readdirSync(cc) : []) {
      for (const h of readdirSync(join(cc, v))) { const f = join(cc, v, h, "claude.exe"); if (existsSync(f)) found.push(f); }
    }
  }
  found.sort((x, y) => statSync(y).mtimeMs - statSync(x).mtimeMs);
  return found[0] ?? null;
}

/** "hi" to Claude on the subscription (the smallest model, one turn). "" = it worked. */
function claudeHi() {
  return new Promise((resolve) => {
    const exe = claudeExe();
    if (!exe) return resolve("Claude Code isn't installed");
    const env = { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: readFileSync(CLAUDE_TOKEN_FILE, "utf8").replace(/\s+/g, "") };
    for (const k of ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"]) delete env[k];
    const dir = join(WORK, "claude-hi");
    mkdirSync(dir, { recursive: true });
    const p = spawn(exe, ["-p", "hi", "--model", "claude-haiku-5-5", "--max-turns", "1", "--output-format", "json"], { cwd: dir, env, stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    let out = "";
    p.stdout.on("data", (d) => { out += d; });
    const timer = setTimeout(() => p.kill(), 120_000);
    p.on("close", () => { clearTimeout(timer); try { const o = JSON.parse(out); resolve(o.is_error ? String(o.result).slice(0, 120) : ""); } catch { resolve(out.slice(0, 120) || "no answer"); } });
    p.on("error", (e) => { clearTimeout(timer); resolve(e.message); });
  });
}

let claudeWarned = false;
/** A minute after a 5-hour window ends, say "hi" so the next one starts right away. Codex says when its window
 *  ends; Claude's is counted from the last "hi". true = Codex's window was just started (read its usage again). */
async function keepWindows(usage) {
  const w = readWindows();
  const t = Date.now();
  let codexStarted = false;
  if ((!usage.resetsAt || t >= usage.resetsAt + AFTER_RESET_MS) && (!w.codexHiAt || t - w.codexHiAt > 10 * 60_000)) {
    const res = await runCodex("hi", null, { hi: true });
    w.codexHiAt = t;
    saveWindows(w);
    log(`codex hi ${res.text ? "ok" : `failed: ${res.error.slice(0, 120)}`}`);
    codexStarted = true;
  }
  if (!existsSync(CLAUDE_TOKEN_FILE)) {
    if (!claudeWarned) { log("claude hi: no token yet (run claude setup-token)"); claudeWarned = true; }
    return codexStarted;
  }
  if (!w.claudeHiAt || t >= w.claudeHiAt + WINDOW_MS + AFTER_RESET_MS) {
    const err = await claudeHi();
    // A failed "hi" is tried again in 15 minutes.
    w.claudeHiAt = err ? t - WINDOW_MS + 15 * 60_000 : t;
    saveWindows(w);
    log(`claude hi ${err ? `failed: ${err}` : "ok"}`);
  }
  return codexStarted;
}

let usage = { primary: 0, secondary: 0, resetsAt: null }, usageAt = 0;
log("runner started");
for (;;) {
  try {
    if (Date.now() - usageAt > 5 * 60_000) { usage = (await planUsage()) ?? usage; usageAt = Date.now(); }
    if (await keepWindows(usage)) usageAt = 0;
    const { run } = await api("/api/agent/codex/next", { device: "home-codex", primary: usage.primary, secondary: usage.secondary });
    if (run) {
      log(`run ${run.id}${run.gmail ? " (email)" : ""}`);
      const res = await runCodex(run.prompt, run.model, { gmail: !!run.gmail });
      const limit = /usage limit|rate limit|too many requests/i.test(res.error);
      await api(`/api/agent/runs/${run.id}/result`, { text: res.text, error: res.error, limit_reached: limit, engine: "codex" });
      log(`run ${run.id} ${res.text ? "answered" : `failed: ${res.error.slice(0, 120)}`}`);
      usageAt = 0; // read the plan's usage again after a run
      continue;
    }
  } catch (e) { log(`problem: ${e.message}`); }
  await sleep(60_000); // research jobs can wait a minute; halves idle requests
}
