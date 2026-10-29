// Codex runner: runs the Chief of Staff's jobs on your ChatGPT plan, with Codex on this computer.
//
// Every 30 seconds it asks the Chief of Staff for a Codex run (and tells it how much of the plan is used, so
// "Automatic" jobs only come here when there's room). A run is done with `codex exec`: live web search, read-only
// (it can't change anything on this computer), in its own empty folder. The answer goes back to the Chief of Staff,
// which posts it in the job's Telegram topic. Started at login by the Windows task "Chief of Staff Codex runner".
//
// Needs: Codex (the desktop app) signed in with ChatGPT, and the agent key in C:\Users\Yoni\.tokens\cos-agent-key.txt.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const API = "https://chief-of-staff.gremiercoffee.workers.dev";
const HOME = homedir();
const KEY_FILE = join(HOME, ".tokens", "cos-agent-key.txt");
const WORK = join(HOME, "ChiefOfStaff", "codex-runner", "work");
const LOG = join(HOME, "ChiefOfStaff", "codex-runner", "runner.log");
const RUN_TIMEOUT_MS = 12 * 60_000;
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

/** How much of the ChatGPT plan's Codex allowance is used: the 5-hour and the weekly windows, in percent. */
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
          if (m.id === 2) { const l = m.result?.rateLimits; finish(l ? { primary: l.primary?.usedPercent ?? 0, secondary: l.secondary?.usedPercent ?? 0 } : null); }
        } catch { /* not JSON */ }
      }
    });
    p.on("error", () => finish(null));
    send({ id: 1, method: "initialize", params: { clientInfo: { name: "cos-codex-runner", version: "1" } } });
    setTimeout(() => finish(null), 20_000);
  });
}

/** One run: Codex answers the prompt with live web search; the last message is the answer. */
function runCodex(prompt, model) {
  return new Promise((resolve) => {
    const dir = join(WORK, String(Date.now()));
    mkdirSync(dir, { recursive: true });
    const args = ["exec", "--json", "--skip-git-repo-check", "-s", "read-only", "-c", 'web_search="live"', ...(model ? ["-m", model] : []), "-"];
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

let usage = { primary: 0, secondary: 0 }, usageAt = 0;
log("runner started");
for (;;) {
  try {
    if (Date.now() - usageAt > 5 * 60_000) { usage = (await planUsage()) ?? usage; usageAt = Date.now(); }
    const { run } = await api("/api/agent/codex/next", { device: "home-codex", ...usage });
    if (run) {
      log(`run ${run.id}`);
      const res = await runCodex(run.prompt, run.model);
      const limit = /usage limit|rate limit|too many requests/i.test(res.error);
      await api(`/api/agent/runs/${run.id}/result`, { text: res.text, error: res.error, limit_reached: limit, engine: "codex" });
      log(`run ${run.id} ${res.text ? "answered" : `failed: ${res.error.slice(0, 120)}`}`);
      usageAt = 0; // read the plan's usage again after a run
      continue;
    }
  } catch (e) { log(`problem: ${e.message}`); }
  await sleep(30_000);
}
