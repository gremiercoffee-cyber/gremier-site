/**
 * Ideas: you think out loud on the home screen; the assistant files the idea with a summary, your
 * words, an honest take and suggested next steps ("look into X", "sketch a plan", "remind me in two
 * weeks"). You pick the steps; it does them (web research, a plan, a reminder, a task), adds the
 * results to the idea, and brings ideas you've gone quiet on back up now and then.
 */
import type { Env } from "./env";
import { getProvider } from "./ai";
import { all, createItem, first, now, run, uid } from "./db";
import { notify } from "./push";

export interface Step { id: string; label: string; kind: string; status: string; detail?: string }
export interface Note { at: string; kind: string; text: string; sources?: string[] }
export interface Idea {
  id: string; title: string; area: string | null; summary: string; transcript: string; analysis: string; verdict: string | null;
  notes: string; steps: string; status: string; conversation_id: string | null; last_nudged_at: string | null; created_at: string; updated_at: string;
}

const KINDS = ["research", "plan", "remind", "task", "other"];
const parse = <T>(s: string | null | undefined, d: T): T => { try { return s ? JSON.parse(s) as T : d; } catch { return d; } };
const areaOf = (a: unknown) => (/^[a-z0-9-]{2,24}$/.test(String(a)) ? String(a) : null);
const newSteps = (list: unknown) => (Array.isArray(list) ? list : []).slice(0, 8).map((s: { label?: string; kind?: string }) => ({
  id: uid().slice(0, 8), label: String(s?.label ?? s).slice(0, 200), kind: KINDS.includes(String(s?.kind)) ? String(s.kind) : "other", status: "suggested",
})).filter((s) => s.label);

export async function findIdea(env: Env, ref: string) {
  return first<Idea>(env, "SELECT * FROM ideas WHERE id = ? OR lower(title) = lower(?) OR lower(title) LIKE lower(?) ORDER BY updated_at DESC", ref, ref, `%${ref}%`);
}

export async function captureIdea(env: Env, input: Record<string, unknown>, conversationId?: string | null) {
  const t = now(), id = uid();
  await run(env, `INSERT INTO ideas (id, title, area, summary, transcript, analysis, verdict, steps, status, conversation_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)`,
    id, String(input.title ?? "Idea").slice(0, 120), areaOf(input.area), String(input.summary ?? "").slice(0, 3000),
    String(input.transcript ?? "").slice(0, 12000), String(input.analysis ?? "").slice(0, 4000),
    ["promising", "mixed", "doubtful"].includes(String(input.verdict)) ? String(input.verdict) : null,
    JSON.stringify(newSteps(input.next_steps)), conversationId ?? null, t, t);
  return (await first<Idea>(env, "SELECT * FROM ideas WHERE id = ?", id))!;
}

export async function updateIdea(env: Env, ref: string, input: Record<string, unknown>) {
  const i = await findIdea(env, ref);
  if (!i) throw new Error("idea not found");
  const notes = parse<Note[]>(i.notes, []);
  if (input.add_note) notes.push({ at: now(), kind: "note", text: String(input.add_note).slice(0, 4000) });
  const steps = [...parse<Step[]>(i.steps, []), ...newSteps(input.add_steps)];
  const s = (k: string, cur: string) => (input[k] === undefined ? cur : String(input[k]));
  await run(env, `UPDATE ideas SET title=?, area=?, summary=?, analysis=?, verdict=?, status=?, notes=?, steps=?, updated_at=? WHERE id=?`,
    s("title", i.title).slice(0, 120), input.area === undefined ? i.area : areaOf(input.area), s("summary", i.summary).slice(0, 3000),
    s("analysis", i.analysis).slice(0, 4000), input.verdict === undefined ? i.verdict : String(input.verdict),
    ["new", "exploring", "parked", "done", "dropped"].includes(String(input.status)) ? String(input.status) : i.status,
    JSON.stringify(notes.slice(-60)), JSON.stringify(steps), now(), i.id);
  return (await first<Idea>(env, "SELECT * FROM ideas WHERE id = ?", i.id))!;
}

async function saveSteps(env: Env, id: string, steps: Step[], notes?: Note[]) {
  if (notes) await run(env, "UPDATE ideas SET steps = ?, notes = ?, status = CASE WHEN status = 'new' THEN 'exploring' ELSE status END, updated_at = ? WHERE id = ?", JSON.stringify(steps), JSON.stringify(notes.slice(-60)), now(), id);
  else await run(env, "UPDATE ideas SET steps = ?, status = CASE WHEN status = 'new' THEN 'exploring' ELSE status END, updated_at = ? WHERE id = ?", JSON.stringify(steps), now(), id);
}

/**
 * The user picked (or dismissed) a suggested next step. Quick ones happen now; research is queued
 * and done by the background pass (or right away when the caller can wait for it).
 */
export async function ideaStep(env: Env, ref: string, stepId: string, action: "do" | "dismiss", opts: { when?: string; label?: string } = {}) {
  const i = await findIdea(env, ref);
  if (!i) throw new Error("idea not found");
  const steps = parse<Step[]>(i.steps, []);
  let st = steps.find((s) => s.id === stepId);
  if (!st && opts.label) { st = { id: uid().slice(0, 8), label: opts.label.slice(0, 200), kind: "other", status: "suggested" }; steps.push(st); }
  if (!st) throw new Error("step not found");
  if (action === "dismiss") { st.status = "dismissed"; await saveSteps(env, i.id, steps); return { ok: true }; }

  if (st.kind === "research") {
    st.status = "queued";
    await saveSteps(env, i.id, steps);
    return { ok: true, queued: true, note: "Research queued; results get added to the idea and the user is notified." };
  }
  if (st.kind === "remind") {
    const when = opts.when && !isNaN(Date.parse(opts.when)) ? new Date(opts.when) : new Date(Date.now() + 7 * 86400_000);
    const item = await createItem(env, { kind: "reminder", title: `💡 ${i.title}: ${st.label}`.slice(0, 200), due_at: when.toISOString(), category: i.area ?? undefined, source: "idea" } as never);
    st.status = "done"; st.detail = `Reminder set for ${when.toISOString().slice(0, 10)} (item ${item.id})`;
    await saveSteps(env, i.id, steps);
    return { ok: true, reminder: when.toISOString() };
  }
  if (st.kind === "task") {
    const item = await createItem(env, { kind: "task", title: st.label, category: i.area ?? undefined, notes: `From your idea: ${i.title}`, source: "idea" } as never);
    st.status = "done"; st.detail = `Added to your to-dos (item ${item.id})`;
    await saveSteps(env, i.id, steps);
    return { ok: true, item: item.id };
  }
  if (st.kind === "plan") {
    st.status = "working";
    await saveSteps(env, i.id, steps);
    const plan = await getProvider(env).complete({
      tier: "main", purpose: "idea_plan", maxTokens: 1500,
      system: "You are a sharp, practical chief of staff. Write a concrete plan for acting on this idea: the first 3 steps this week, what it needs (people, money, time), the cheapest way to test it, and the biggest risk to check first. Markdown, short, skimmable.",
      prompt: `Idea: ${i.title}\n${i.summary}\n\nTheir words: ${i.transcript.slice(0, 3000)}\n\nYour earlier take: ${i.analysis}\n\nWhat they asked for: ${st.label}`,
    });
    const notes = parse<Note[]>(i.notes, []);
    notes.push({ at: now(), kind: "plan", text: plan });
    st.status = "done";
    await saveSteps(env, i.id, steps, notes);
    return { ok: true, plan };
  }
  st.status = "done";
  await saveSteps(env, i.id, steps);
  return { ok: true };
}

/** Background: do queued research for ideas (one per pass), add it to the idea, tell the user. */
export async function runIdeaResearch(env: Env, onlyId?: string) {
  const list = await all<Idea>(env, onlyId ? "SELECT * FROM ideas WHERE id = ?" : "SELECT * FROM ideas WHERE steps LIKE '%\"queued\"%' ORDER BY updated_at LIMIT 5", ...(onlyId ? [onlyId] : []));
  for (const i of list) {
    const steps = parse<Step[]>(i.steps, []);
    const st = steps.find((s) => s.status === "queued");
    if (!st) continue;
    st.status = "working";
    await saveSteps(env, i.id, steps);
    try {
      const r = await getProvider(env).research({
        purpose: "idea_research", maxSearches: 6, maxTokens: 2500,
        system: "You are a meticulous research analyst helping a business owner think through an idea. Search the web (Hebrew sources too when Israel is relevant). Report concrete findings: numbers, prices, names, examples of others doing it, regulations, pitfalls. End with 'What this means for the idea' (3 bullets). Cite sources inline [n] with URLs at the end.",
        prompt: `Idea: ${i.title}\n${i.summary}\n\nLook into: ${st.label}`,
      });
      const notes = parse<Note[]>(i.notes, []);
      notes.push({ at: now(), kind: "research", text: `**${st.label}**\n\n${r.text}`, sources: r.sources.slice(0, 15) });
      st.status = "done";
      await saveSteps(env, i.id, steps, notes);
      const gist = r.text.split("What this means for the idea").pop()?.replace(/[#*\[\]\d]+/g, "").trim().slice(0, 220) ?? "";
      await notify(env, "idea", `💡 Looked into it: ${i.title}`.slice(0, 80), `${st.label}\n${gist}`.slice(0, 400), null, "/?tab=ideas");
    } catch (e) {
      st.status = "suggested"; st.detail = `Couldn't finish: ${(e as Error).message.slice(0, 100)}`;
      await saveSteps(env, i.id, steps);
    }
    if (!onlyId) break; // one research job per cron pass
  }
}

/** Once a day: bring back one idea you went quiet on (a week+ untouched, not nudged in two weeks). */
export async function nudgeStaleIdea(env: Env, today: string) {
  if (await first(env, "SELECT 1 FROM settings WHERE key = ?", `idea_nudge:${today}`)) return 0;
  await run(env, "INSERT OR REPLACE INTO settings (key, value) VALUES (?, '1')", `idea_nudge:${today}`);
  const week = new Date(Date.now() - 7 * 86400_000).toISOString(), fortnight = new Date(Date.now() - 14 * 86400_000).toISOString();
  const i = await first<Idea>(env, `SELECT * FROM ideas WHERE status IN ('new', 'exploring') AND updated_at < ?
     AND (last_nudged_at IS NULL OR last_nudged_at < ?) ORDER BY verdict = 'promising' DESC, updated_at LIMIT 1`, week, fortnight);
  if (!i) return 0;
  await run(env, "UPDATE ideas SET last_nudged_at = ? WHERE id = ?", now(), i.id);
  const open = parse<Step[]>(i.steps, []).filter((s) => s.status === "suggested").slice(0, 3).map((s) => `• ${s.label}`);
  await notify(env, "idea", `💡 Still thinking about "${i.title}"?`.slice(0, 90),
    (open.length ? `I could:\n${open.join("\n")}` : "Want me to look into it, sketch a plan, or park it?").slice(0, 400), null, "/?tab=ideas");
  return 1;
}

/** For the assistant's context. */
export async function ideasSummary(env: Env) {
  const list = await all<Idea>(env, "SELECT * FROM ideas WHERE status IN ('new', 'exploring', 'parked') ORDER BY created_at DESC LIMIT 25");
  return list.map((i) => {
    const open = parse<Step[]>(i.steps, []).filter((s) => s.status === "suggested").map((s) => `${s.label} [step ${s.id}, ${s.kind}]`);
    return `- ${i.title} (id ${i.id}; ${i.status}${i.area ? `; ${i.area}` : ""}${i.verdict ? `; ${i.verdict}` : ""}${open.length ? `; suggested next steps: ${open.slice(0, 4).join(" | ")}` : ""})`;
  }).join("\n");
}
