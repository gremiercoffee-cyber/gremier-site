// Computer helper: does jobs you ask the Chief of Staff for, in its own Chrome window on this computer.
// Off until you switch it on in the extension's popup (on the computer you want it to use).
// It never touches your WhatsApp tabs, never types into password fields (Chrome's saved passwords fill those),
// never enters card details, and stops to ask you on your phone when it needs you.

const HELPER_DEVICE = "home-chrome";
let helperBusy = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function helperFetch(path, body) {
  const r = await fetch(COS_CONFIG.api_base.replace(/\/$/, "") + path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-bridge-key": COS_CONFIG.bridge_key },
    body: JSON.stringify(body || {}),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
const helperNote = (text) => chrome.storage.local.set({ helper_last: `${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} ${text}` });

/** Runs inside the page: number every visible button, link and field, and describe the page as text. */
function cosSnapshotPage() {
  const visible = (el) => { const r = el.getBoundingClientRect(); const st = getComputedStyle(el); return r.width > 1 && r.height > 1 && st.visibility !== "hidden" && st.display !== "none" && Number(st.opacity) > 0.05; };
  const sel = 'a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=checkbox], [role=radio], [role=menuitem], [role=tab], [role=option], [role=switch], [contenteditable="true"], summary';
  document.querySelectorAll("[data-cos-n]").forEach((e) => e.removeAttribute("data-cos-n"));
  const elements = []; let n = 0;
  for (const el of document.querySelectorAll(sel)) {
    if (elements.length >= 200 || !visible(el)) continue;
    n++; el.setAttribute("data-cos-n", String(n));
    const tag = el.tagName.toLowerCase(), type = (el.getAttribute("type") || el.getAttribute("role") || "").toLowerCase();
    let label = (el.getAttribute("aria-label") || (el.labels && el.labels[0] && el.labels[0].innerText) || el.innerText || el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("name") || el.getAttribute("alt") || (type !== "password" ? el.value : "") || "").replace(/\s+/g, " ").trim().slice(0, 100);
    if (tag === "select") label += " | options: " + Array.from(el.options).slice(0, 15).map((o) => o.text.trim()).join(" / ");
    const e = { n, tag, label };
    if (type) e.type = type;
    if ((tag === "input" || tag === "textarea") && type !== "password" && el.value) e.value = String(el.value).slice(0, 60);
    if (el.checked || el.getAttribute("aria-checked") === "true") e.checked = true;
    if (el.disabled || el.getAttribute("aria-disabled") === "true") e.disabled = true;
    if (tag === "a") e.href = (el.getAttribute("href") || "").slice(0, 100);
    elements.push(e);
  }
  const text = (document.body ? document.body.innerText : "").replace(/\n{2,}/g, "\n").slice(0, 4000);
  const captcha = !!document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare"], .g-recaptcha, .h-captcha');
  const card_field = !!document.querySelector('input[autocomplete^="cc-"], input[name*="cardnumber" i], input[name*="card_number" i], input[id*="cardnumber" i]');
  const password_field = !!document.querySelector('input[type="password"]');
  return { url: location.href, title: document.title, elements, text, flags: { captcha, card_field, password_field } };
}

/** Runs inside the page: do one action on a numbered element. Refuses password and card fields outright. */
function cosDoAction(a) {
  const el = a.n != null ? document.querySelector(`[data-cos-n="${a.n}"]`) : null;
  if (["click", "type", "select"].includes(a.action) && !el) return "that element is gone";
  if (a.action === "click") { el.scrollIntoView({ block: "center" }); el.click(); return "clicked"; }
  if (a.action === "type") {
    if ((el.getAttribute("type") || "").toLowerCase() === "password") return "refused: password field";
    if (/^cc-/.test(el.getAttribute("autocomplete") || "") || /card.?number/i.test(el.name || el.id || "")) return "refused: card field";
    el.scrollIntoView({ block: "center" }); el.focus();
    if (el.isContentEditable) { el.textContent = a.text || ""; el.dispatchEvent(new InputEvent("input", { bubbles: true })); return "typed"; }
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, a.text || ""); // works with React-style forms
    el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
    return "typed";
  }
  if (a.action === "select") {
    const want = String(a.text || "").toLowerCase();
    const opt = Array.from(el.options || []).find((o) => o.text.trim().toLowerCase() === want) || Array.from(el.options || []).find((o) => o.text.toLowerCase().includes(want));
    if (!opt) return "option not found";
    el.value = opt.value; el.dispatchEvent(new Event("change", { bubbles: true })); return "selected";
  }
  if (a.action === "key") {
    const t = document.activeElement || document.body, key = a.key || "Enter";
    for (const type of ["keydown", "keypress", "keyup"]) t.dispatchEvent(new KeyboardEvent(type, { key, code: key, keyCode: key === "Enter" ? 13 : 0, bubbles: true }));
    if (key === "Enter" && t.form) { if (t.form.requestSubmit) t.form.requestSubmit(); else t.form.submit(); }
    return "pressed " + key;
  }
  if (a.action === "scroll") { window.scrollBy(0, (a.text === "up" ? -1 : 1) * window.innerHeight * 0.8); return "scrolled"; }
  return "nothing to do";
}

async function waitLoaded(tabId) {
  for (let i = 0; i < 30; i++) { const t = await chrome.tabs.get(tabId).catch(() => null); if (!t) throw new Error("The helper's tab was closed."); if (t.status === "complete") return; await sleep(500); }
}
async function screenshot(windowId) {
  try { return await chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 45 }); } catch { return null; }
}

async function runHelperJob(job) {
  let { helper_tab } = await chrome.storage.local.get("helper_tab");
  let tab = helper_tab && helper_tab.job === job.id ? await chrome.tabs.get(helper_tab.tabId).catch(() => null) : null;
  if (!tab) {
    const w = await chrome.windows.create({ url: job.start_url || "https://www.google.com", focused: false, width: 1280, height: 900 });
    tab = w.tabs[0];
    await chrome.storage.local.set({ helper_tab: { tabId: tab.id, windowId: w.id, job: job.id } });
  }
  await helperNote(`Working on: ${job.instruction.slice(0, 60)}`);
  const deadline = Date.now() + 45 * 60_000;
  let steps = 0;
  while (Date.now() < deadline && steps < 70) {
    const st = await helperFetch(`/api/bridge/helper/${job.id}/status`);
    if (st.status === "needs_you") { await helperNote("Waiting for your answer on your phone"); await sleep(10_000); continue; }
    if (st.status !== "running") { await helperNote(`Stopped (${st.status})`); return; }
    await waitLoaded(tab.id);
    const page = (await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: cosSnapshotPage }))[0].result;
    const a = await helperFetch(`/api/bridge/helper/${job.id}/step`, page);
    steps++;
    if (a.action === "done" || a.action === "fail") {
      await helperFetch(`/api/bridge/helper/${job.id}/finish`, { status: a.action === "done" ? "done" : "failed", result: a.result || "", screenshot: await screenshot(tab.windowId) });
      await helperNote(`${a.action === "done" ? "Done" : "Couldn't finish"}: ${job.instruction.slice(0, 50)}`);
      return;
    }
    if (a.action === "ask") continue; // now waiting for you; the loop above waits
    if (a.action === "navigate" && /^https?:\/\//.test(a.url || "")) { await chrome.tabs.update(tab.id, { url: a.url }); await sleep(1500); continue; }
    if (a.action === "wait") { await sleep(3000); continue; }
    try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: cosDoAction, args: [a] }); } catch { /* the page moved on mid-click: fine */ }
    await sleep(1500);
  }
  await helperFetch(`/api/bridge/helper/${job.id}/finish`, { status: "failed", result: "It took too long, so I stopped.", screenshot: await screenshot(tab.windowId) }).catch(() => {});
}

async function helperTick() {
  if (helperBusy) return;
  const { helper_on } = await chrome.storage.local.get("helper_on");
  if (!helper_on) return;
  helperBusy = true;
  try {
    const { job } = await helperFetch("/api/bridge/helper/next", { device: HELPER_DEVICE });
    if (job) await runHelperJob(job);
  } catch (e) { await helperNote(`Problem: ${e.message}`); }
  finally { helperBusy = false; }
}

chrome.alarms.create("helper-poll", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === "helper-poll") void helperTick(); });
