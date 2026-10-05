/**
 * Keeps the conversation list short, once a day (or on "Tidy up"):
 *  - throwaway chats ("update my schedule", "remind me…", "mark X done") are deleted: what they did
 *    is already saved in the app;
 *  - chats about the same ongoing topic are merged into one;
 *  - chats worth keeping that have been quiet for a week are archived (still searchable).
 * Pinned chats, the open one, and ones an idea points to are never deleted or merged away.
 */
import type { Env } from "./env";
import { getProvider } from "./ai";
import { all, first, now, run } from "./db";

interface Convo { id: string; title: string; last_message_at: string; pinned: number; archived: number }

export async function tidyConversations(env: Env, opts: { force?: boolean; keepId?: string | null } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  if (!opts.force && await first(env, "SELECT 1 FROM settings WHERE key = ?", `tidy:${today}`)) return { skipped: true };
  await run(env, "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", `tidy:${today}`, now());

  // Leave recent chats alone (the user may still be in them).
  const quietSince = new Date(Date.now() - (opts.force ? 30 : 6 * 60) * 60_000).toISOString();
  const convos = await all<Convo>(env,
    `SELECT id, title, last_message_at, pinned, archived FROM conversations
      WHERE archived = 0 AND pinned = 0 AND last_message_at < ? AND (reviewed_at IS NULL OR reviewed_at < last_message_at)
      ORDER BY last_message_at DESC LIMIT 30`, quietSince);
  const protectedIds = new Set((await all<{ conversation_id: string }>(env, "SELECT DISTINCT conversation_id FROM ideas WHERE conversation_id IS NOT NULL")).map((r) => r.conversation_id));
  if (opts.keepId) protectedIds.add(opts.keepId);
  const candidates = convos.filter((c) => c.id !== opts.keepId);

  let deleted = 0, merged = 0;
  if (candidates.length) {
    const blocks: string[] = [];
    for (const c of candidates) {
      const msgs = await all<{ role: string; content: string; meta: string | null }>(env,
        "SELECT role, content, meta FROM messages WHERE conversation_id = ? ORDER BY created_at LIMIT 12", c.id);
      const did = msgs.flatMap((m) => { try { return (JSON.parse(m.meta ?? "[]") as { summary: string }[]).map((a) => a.summary); } catch { return []; } });
      blocks.push(`id ${c.id} · "${c.title || "untitled"}" · ${msgs.length} messages
User said: ${msgs.filter((m) => m.role === "user").map((m) => m.content.replace(/\s+/g, " ").slice(0, 220)).join(" | ").slice(0, 700)}
${did.length ? `Actions taken: ${did.slice(0, 6).join("; ")}` : "No actions taken."}`);
    }
    const out = await getProvider(env).complete({
      tier: "fast", purpose: "tidy", maxTokens: 120 * candidates.length,
      system: `You tidy a personal assistant's chat list. For each conversation decide:
- "delete": a quick command or check whose result is already saved in the app (updating the schedule, adding/finishing a reminder or to-do, a quick question answered in one line, small talk). Nothing worth rereading.
- "keep": anything worth coming back to: a discussion, an idea, a plan, a drafted message, research, a decision, an explanation, advice.
- "merge": the same ongoing topic as another conversation in this list that you keep; give merge_into = that conversation's id.
When unsure, keep. Reply ONLY JSON: {"decisions":[{"id":"...","action":"delete|keep|merge","merge_into":"id or null"}]}`,
      prompt: blocks.join("\n\n"),
    });
    let decisions: { id: string; action: string; merge_into?: string | null }[] = [];
    try { decisions = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)).decisions ?? []; } catch { decisions = []; }
    const ids = new Set(candidates.map((c) => c.id));
    for (const d of decisions) {
      if (!ids.has(d.id)) continue;
      if (d.action === "delete" && !protectedIds.has(d.id)) {
        await env.DB.batch([
          env.DB.prepare("DELETE FROM messages WHERE conversation_id = ?").bind(d.id),
          env.DB.prepare("DELETE FROM conversations WHERE id = ?").bind(d.id),
        ]);
        deleted++;
      } else if (d.action === "merge" && d.merge_into && d.merge_into !== d.id && ids.has(d.merge_into) && !protectedIds.has(d.id)
        && decisions.find((x) => x.id === d.merge_into)?.action !== "delete") {
        await env.DB.batch([
          env.DB.prepare("UPDATE messages SET conversation_id = ? WHERE conversation_id = ?").bind(d.merge_into, d.id),
          env.DB.prepare("UPDATE conversations SET last_message_at = MAX(last_message_at, (SELECT last_message_at FROM conversations WHERE id = ?)) WHERE id = ?").bind(d.id, d.merge_into),
          env.DB.prepare("DELETE FROM conversations WHERE id = ?").bind(d.id),
        ]);
        merged++;
      } else {
        await run(env, "UPDATE conversations SET reviewed_at = ? WHERE id = ?", now(), d.id);
      }
    }
  }
  // Worth keeping but quiet for a week: archive (still searchable, restorable).
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const archived = await all<{ id: string }>(env, "SELECT id FROM conversations WHERE archived = 0 AND pinned = 0 AND last_message_at < ?", weekAgo);
  for (const a of archived) if (a.id !== opts.keepId) await run(env, "UPDATE conversations SET archived = 1 WHERE id = ?", a.id);
  return { deleted, merged, archived: archived.length };
}
