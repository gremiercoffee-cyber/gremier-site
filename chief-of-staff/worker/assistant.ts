/** The single Chief of Staff assistant: prompt, context assembly and tools over the user's data. */
import type { ActionNote, Conversation, Item, Memory, Message, Project } from "../shared/types";
import type { Env } from "./env";
import { getProvider, type ToolDef, type Turn } from "./ai";
import {
  all, createItem, createProject, first, getSettings, now, resolveProjectId, run, uid, updateItem,
} from "./db";
import { calendarLookup, createDraft, googleStatus, readThread, searchEmail, upcomingEventsText } from "./google";
import { bridgeStatus, queueWhatsApp } from "./whatsapp";

export const SYSTEM_PROMPT = `You are the user's personal Chief of Staff. You are one consistent assistant across text and voice, with a shared memory of their life and work.

What you do:
- Keep track of their tasks, reminders, commitments, ideas, projects and the things they are waiting on from other people.
- Remember durable facts and preferences (use the remember tool) so they never have to repeat themselves.
- Help them decide, prioritise and plan. Be proactive: point out overdue items, conflicts, forgotten follow-ups and sensible next steps.
- Act like a trusted human chief of staff, not a chatbot. When they tell you what is going on ("here's how I'm doing deliveries today", "we're launching X next week"), quietly build the structure it needs: tasks and reminders at sensible times, a check-in reminder afterwards phrased as a question ("Did you…?") so you can ask whether it happened, a project to group related work, and memories for lasting facts. Do not ask permission for this internal organizing; just do it and tell them briefly what you set up.
- A reminder whose title starts with "Did you…?" is sent as a check-in with Yes / Not yet buttons. Use that for follow-ups.

How to file things — keep these clearly separate:
- task: something the user needs to do.
- reminder: something to be reminded of at a specific time (always set due_at).
- commitment: a promise the user made to someone (set person; due_at if there is a deadline).
- waiting: something the user is waiting on from someone else (set person).
- idea: a thought worth keeping that is not yet a commitment. Never turn an idea into a task unless asked.

Rules:
- When the user tells you something actionable, file it with the tools; do not just acknowledge it. Check for duplicates with search_items first when unsure.
- Resolve relative dates ("tomorrow at 3", "Friday") using the current local time given in the context, and pass due_at as an ISO 8601 datetime with the user's UTC offset.
- Deleting things, or anything that would affect the outside world (sending messages, contacting people, spending money), requires approval: use propose_action and tell the user it is waiting for their approval. The context says which outside accounts are connected; if something is not connected, say so plainly.
- Email: when an item came from an email (it shows an email thread id), you can read the thread. Remind first; only write a draft when the user explicitly asks you to draft. Drafts are saved to their Gmail Drafts folder. You can never send email; tell them to review and send it from Gmail.
- Be concise and warm. Lead with what matters. Use short lists when listing items. Do not invent data you have not been given.`;

const VOICE_ADDENDUM = `\n\nYou are in a live voice conversation and your replies are spoken aloud: answer in one to three short conversational sentences, no lists, no markdown, no emoji.`;

export async function buildContext(env: Env, mode: string): Promise<string> {
  const settings = await getSettings(env);
  const tz = settings.timezone || "UTC";
  const localNow = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, dateStyle: "full", timeStyle: "short",
  }).format(new Date());

  const [memories, items, projects] = await Promise.all([
    all<Memory>(env, "SELECT * FROM memories ORDER BY importance ASC, updated_at DESC LIMIT 60"),
    all<Item>(
      env,
      `SELECT * FROM items WHERE status = 'open'
       ORDER BY CASE WHEN due_at IS NULL THEN 1 ELSE 0 END, due_at, priority LIMIT 80`,
    ),
    all<Project>(env, "SELECT * FROM projects WHERE status != 'done' ORDER BY updated_at DESC LIMIT 30"),
  ]);
  const projectName = new Map(projects.map((p) => [p.id, p.name]));

  const lines: string[] = [];
  lines.push(`Current local time: ${localNow} (timezone ${tz}; UTC now ${now()}).`);
  if (settings.name) lines.push(`The user's name is ${settings.name}.`);
  lines.push("", "## Memory");
  lines.push(memories.length ? memories.map((m) => `- [${m.category}] ${m.content} (id ${m.id})`).join("\n") : "- (nothing yet)");
  lines.push("", "## Projects");
  lines.push(projects.length ? projects.map((p) => `- ${p.name} [${p.area}, ${p.status}]${p.description ? ` — ${p.description}` : ""}`).join("\n") : "- (none)");
  lines.push("", "## Open items");
  lines.push(
    items.length
      ? items
          .map((i) => {
            const bits = [i.kind, `p${i.priority}`];
            if (i.due_at) bits.push(`due ${i.due_at}`);
            if (i.person) bits.push(`person ${i.person}`);
            if (i.project_id && projectName.has(i.project_id)) bits.push(`project ${projectName.get(i.project_id)}`);
            if (i.ext_source === "gmail" && i.ext_ref) bits.push(`email thread ${i.ext_ref}${i.ext_account ? ` in ${i.ext_account}` : ""}`);
            return `- ${i.title} (${bits.join(", ")}; id ${i.id})`;
          })
          .join("\n")
      : "- (none)",
  );
  const events = await upcomingEventsText(env, tz);
  lines.push("", "## Connected accounts");
  const g = events === null ? null : await googleStatus(env);
  lines.push(g === null ? "- Google: not connected (no calendar or email access)."
    : `- Google accounts: ${g.accounts.map((a) => a.email).join(", ")}. Calendar lookups cover all of them; email search covers all unless you pass account. Drafts go from the account the thread is in (or the account you pass for new mail).`);
  if (events !== null) lines.push("", "## Calendar (next 48 hours)", events);
  const bridge = await bridgeStatus(env);
  lines.push(bridge.configured
    ? `- WhatsApp: you can prepare messages with send_whatsapp (user taps Send to approve). Their computer is ${bridge.online ? "online" : "offline right now, so approved messages send when it's back"}. Actionable incoming WhatsApps arrive as items with source whatsapp.`
    : "- WhatsApp: not set up yet.");
  if (mode === "voice") lines.push(VOICE_ADDENDUM);
  return lines.join("\n");
}

const itemProps = {
  kind: { type: "string", enum: ["task", "reminder", "idea", "commitment", "waiting"] },
  title: { type: "string" },
  notes: { type: "string" },
  priority: { type: "integer", enum: [1, 2, 3], description: "1 high, 2 normal, 3 low" },
  due_at: { type: "string", description: "ISO 8601 datetime with offset" },
  person: { type: "string", description: "Who it involves (waiting on / committed to)" },
  project: { type: "string", description: "Project name or id" },
};

export function assistantTools(env: Env, source: string, notes: ActionNote[]): ToolDef[] {
  const note = (tool: string, summary: string) => notes.push({ tool, summary });
  return [
    {
      name: "calendar_lookup",
      description: "Look up events on the user's Google Calendar between two datetimes, optionally matching text.",
      input_schema: {
        type: "object",
        properties: { from: { type: "string", description: "ISO 8601" }, to: { type: "string", description: "ISO 8601" }, query: { type: "string" } },
        required: ["from", "to"],
      },
      handler: async (input) => calendarLookup(env, String(input.from), String(input.to), input.query as string | undefined),
    },
    {
      name: "search_email",
      description: "Search the user's Gmail (Gmail search syntax, e.g. 'from:dana invoice newer_than:30d'). Returns thread ids and snippets.",
      input_schema: { type: "object", properties: { query: { type: "string" }, account: { type: "string", description: "Optional: one account email" } }, required: ["query"] },
      handler: async (input) => searchEmail(env, String(input.query), input.account as string | undefined),
    },
    {
      name: "read_email_thread",
      description: "Read the latest messages of a Gmail thread by id.",
      input_schema: { type: "object", properties: { thread_id: { type: "string" }, account: { type: "string" } }, required: ["thread_id"] },
      handler: async (input) => readThread(env, String(input.thread_id), input.account as string | undefined),
    },
    {
      name: "send_whatsapp",
      description: "Prepare a WhatsApp message. It is NOT sent yet: the user gets it with Send / Edit / Cancel buttons, and only after Send does their computer send it through WhatsApp Web. Use the contact's name exactly as they'd appear in WhatsApp. Write in the user's voice and the language they use with that person.",
      input_schema: {
        type: "object",
        properties: { to: { type: "string", description: "Contact or group name as it appears in WhatsApp" }, message: { type: "string" } },
        required: ["to", "message"],
      },
      handler: async (input) => {
        const r = await queueWhatsApp(env, String(input.to), String(input.message));
        note("send_whatsapp", `WhatsApp to ${input.to} is waiting for your Send tap`);
        return r;
      },
    },
    {
      name: "draft_email",
      description: "Save an email draft in the user's Gmail Drafts. ONLY when the user explicitly asks you to draft something. Never sends. For a reply pass thread_id (recipient and subject are filled in); for a new email pass to and subject. Write the body in the user's voice and language.",
      input_schema: {
        type: "object",
        properties: {
          thread_id: { type: "string" }, to: { type: "string" }, subject: { type: "string" }, body: { type: "string" },
          account: { type: "string", description: "Which Google account to draft from (for new emails)" },
        },
        required: ["body"],
      },
      handler: async (input) => {
        const d = await createDraft(env, {
          threadId: input.thread_id as string | undefined, to: input.to as string | undefined,
          subject: input.subject as string | undefined, body: String(input.body), account: input.account as string | undefined,
        });
        note("draft_email", `Draft saved in ${d.from_account} to ${d.to}: ${d.subject}`);
        return d;
      },
    },
    {
      name: "create_item",
      description: "File a task, reminder, commitment, waiting-for entry or idea.",
      input_schema: { type: "object", properties: itemProps, required: ["kind", "title"] },
      handler: async (input) => {
        const project_id = await resolveProjectId(env, input.project as string);
        const item = await createItem(env, { ...(input as object), project_id, source } as never);
        note("create_item", `Added ${item.kind}: ${item.title}`);
        return { id: item.id, kind: item.kind, due_at: item.due_at };
      },
    },
    {
      name: "update_item",
      description: "Change an item: complete it (status done), drop it, reschedule, rename, move to a project.",
      input_schema: {
        type: "object",
        properties: { id: { type: "string" }, status: { type: "string", enum: ["open", "done", "dropped"] }, ...itemProps },
        required: ["id"],
      },
      handler: async (input) => {
        const patch: Record<string, unknown> = { ...input };
        if (input.project !== undefined) patch.project_id = await resolveProjectId(env, input.project as string);
        const item = await updateItem(env, String(input.id), patch);
        note("update_item", input.status === "done" ? `Completed: ${item.title}` : `Updated: ${item.title}`);
        return { id: item.id, status: item.status, due_at: item.due_at };
      },
    },
    {
      name: "search_items",
      description: "Search items, including completed ones, by text, kind or status.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string" },
          kind: itemProps.kind,
          status: { type: "string", enum: ["open", "done", "dropped", "any"] },
        },
      },
      handler: async (input) => {
        const where: string[] = [];
        const binds: unknown[] = [];
        if (input.query) {
          where.push("(title LIKE ? OR notes LIKE ? OR person LIKE ?)");
          const q = `%${input.query}%`;
          binds.push(q, q, q);
        }
        if (input.kind) (where.push("kind = ?"), binds.push(input.kind));
        if (input.status && input.status !== "any") (where.push("status = ?"), binds.push(input.status));
        const sql = `SELECT id, kind, title, status, due_at, person, completed_at FROM items
          ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY updated_at DESC LIMIT 25`;
        return all(env, sql, ...binds);
      },
    },
    {
      name: "create_project",
      description: "Create a project to group related items.",
      input_schema: {
        type: "object",
        properties: { name: { type: "string" }, description: { type: "string" }, area: { type: "string", enum: ["personal", "business"] } },
        required: ["name"],
      },
      handler: async (input) => {
        const p = await createProject(env, input as never);
        note("create_project", `Created project: ${p.name}`);
        return { id: p.id };
      },
    },
    {
      name: "update_project",
      description: "Rename, describe, pause or finish a project.",
      input_schema: {
        type: "object",
        properties: {
          project: { type: "string", description: "Project name or id" },
          name: { type: "string" },
          description: { type: "string" },
          status: { type: "string", enum: ["active", "paused", "done"] },
        },
        required: ["project"],
      },
      handler: async (input) => {
        const id = await resolveProjectId(env, input.project as string);
        if (!id) throw new Error("project not found");
        const p = await first<Project>(env, "SELECT * FROM projects WHERE id = ?", id);
        await run(
          env,
          "UPDATE projects SET name = ?, description = ?, status = ?, updated_at = ? WHERE id = ?",
          (input.name as string) || p!.name, (input.description as string) ?? p!.description,
          (input.status as string) || p!.status, now(), id,
        );
        note("update_project", `Updated project: ${(input.name as string) || p!.name}`);
        return { ok: true };
      },
    },
    {
      name: "remember",
      description: "Store a durable fact, preference, or detail about a person or the business for future conversations.",
      input_schema: {
        type: "object",
        properties: {
          content: { type: "string" },
          category: { type: "string", enum: ["fact", "preference", "person", "business", "personal"] },
          importance: { type: "integer", enum: [1, 2, 3] },
        },
        required: ["content"],
      },
      handler: async (input) => {
        const t = now();
        const id = uid();
        await run(
          env,
          "INSERT INTO memories (id, category, content, importance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
          id, (input.category as string) || "fact", String(input.content), Number(input.importance) || 2, t, t,
        );
        note("remember", `Remembered: ${input.content}`);
        return { id };
      },
    },
    {
      name: "update_memory",
      description: "Correct an existing memory (by id) when something changed.",
      input_schema: { type: "object", properties: { id: { type: "string" }, content: { type: "string" } }, required: ["id", "content"] },
      handler: async (input) => {
        await run(env, "UPDATE memories SET content = ?, updated_at = ? WHERE id = ?", String(input.content), now(), String(input.id));
        note("update_memory", `Updated memory: ${input.content}`);
        return { ok: true };
      },
    },
    {
      name: "propose_action",
      description:
        "Queue a consequential action for the user's approval. Use for deleting items/projects/memories, or anything external. Supported executable actions: delete_item {id}, delete_project {id}, forget_memory {id}. Anything else is recorded as an approved intent only.",
      input_schema: {
        type: "object",
        properties: {
          action: { type: "string" },
          payload: { type: "object" },
          description: { type: "string", description: "Plain-language description shown to the user" },
        },
        required: ["action", "description"],
      },
      handler: async (input) => {
        const id = uid();
        await run(
          env,
          "INSERT INTO pending_actions (id, action, payload, description, created_at) VALUES (?, ?, ?, ?, ?)",
          id, String(input.action), JSON.stringify(input.payload ?? {}), String(input.description), now(),
        );
        note("propose_action", `Needs your approval: ${input.description}`);
        return { id, status: "pending_approval" };
      },
    },
  ];
}

/** Executes an approved pending action. Only internal actions exist in this phase. */
export async function executeApproved(env: Env, action: string, payload: Record<string, unknown>) {
  const id = String(payload.id ?? "");
  switch (action) {
    case "delete_item":
      await run(env, "DELETE FROM items WHERE id = ?", id);
      return "deleted item";
    case "delete_project":
      await run(env, "DELETE FROM projects WHERE id = ?", id);
      return "deleted project";
    case "forget_memory":
      await run(env, "DELETE FROM memories WHERE id = ?", id);
      return "forgot memory";
    default:
      return "approved (no integration available yet to carry this out)";
  }
}

const HISTORY_LIMIT = 30;

/** A conversation goes quiet after this long; the next message starts a fresh one. */
const CONVERSATION_IDLE_MS = 6 * 3600_000;

/** Returns the conversation to write into: the one given if still active, else a new one. */
export async function resolveConversation(env: Env, id?: string | null, forceNew = false): Promise<Conversation> {
  if (id && !forceNew) {
    const c = await first<Conversation>(env, "SELECT * FROM conversations WHERE id = ?", id);
    if (c) return c;
  }
  const t = now();
  const c: Conversation = { id: uid(), title: "", created_at: t, last_message_at: t };
  await run(env, "INSERT INTO conversations (id, title, created_at, last_message_at) VALUES (?, ?, ?, ?)", c.id, c.title, t, t);
  return c;
}

/** One tiny fast-tier call per conversation; falls back to the first words of the message. */
export async function titleConversation(env: Env, c: Conversation, firstText: string) {
  if (c.title) return c.title;
  let title = firstText.split(/\s+/).slice(0, 6).join(" ");
  try {
    const out = await getProvider(env).complete({
      tier: "fast", purpose: "title", maxTokens: 20,
      system: "You label chat conversations. Reply with ONLY a 2 to 5 word topic label in Title Case, e.g. \"Thursday Delivery Plan\" or \"Coffee Business To-Dos\". Never answer or reply to the message itself.",
      prompt: `Opening message of the conversation:
"""${firstText.slice(0, 600)}"""
Topic label:`,
    });
    const label = out.trim().split("\n")[0].replace(/^["'*]+|["'.*]+$/g, "").trim();
    // Guard against the model replying instead of labelling.
    if (label && label.split(/\s+/).length <= 7 && label.length <= 50) title = label;
  } catch { /* keep fallback */ }
  await run(env, "UPDATE conversations SET title = ? WHERE id = ?", title, c.id);
  c.title = title;
  return title;
}

export async function chat(env: Env, text: string, mode: "text" | "voice" | "dictation", conversationId?: string | null) {
  const provider = getProvider(env); // fail before storing anything if no model is configured
  const existing = conversationId ? await first<Conversation>(env, "SELECT * FROM conversations WHERE id = ?", conversationId) : null;
  const stale = existing && Date.now() - new Date(existing.last_message_at).getTime() > CONVERSATION_IDLE_MS;
  let convo = await resolveConversation(env, existing?.id, !existing || !!stale);

  const userMsg: Message = { id: uid(), role: "user", content: text, mode, meta: null, created_at: now(), conversation_id: convo.id };
  await run(env, "INSERT INTO messages (id, role, content, mode, created_at, conversation_id) VALUES (?, ?, ?, ?, ?, ?)",
    userMsg.id, userMsg.role, userMsg.content, userMsg.mode, userMsg.created_at, convo.id);

  const recent = await all<Message>(env, "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?", convo.id, HISTORY_LIMIT);
  const history: Turn[] = recent.reverse().map((m) => ({ role: m.role, content: m.content }));

  const notes: ActionNote[] = [];
  let switched = false;
  const tools = assistantTools(env, mode === "text" ? "chat" : "voice", notes);
  if (history.length > 1) {
    tools.push({
      name: "new_topic",
      description: "Call when the user's latest message starts a clearly unrelated subject from this conversation. Their message moves into a fresh conversation. Do not call for follow-ups on the same subject.",
      input_schema: { type: "object", properties: { title: { type: "string", description: "2-5 word title" } }, required: ["title"] },
      handler: async (input) => {
        if (switched) return { ok: true };
        switched = true;
        const fresh = await resolveConversation(env, null, true);
        fresh.title = String(input.title ?? "").slice(0, 60);
        await run(env, "UPDATE conversations SET title = ? WHERE id = ?", fresh.title, fresh.id);
        await run(env, "UPDATE messages SET conversation_id = ? WHERE id = ?", fresh.id, userMsg.id);
        userMsg.conversation_id = fresh.id;
        convo = fresh;
        return { ok: true, note: "Moved to a new conversation. Continue answering normally." };
      },
    });
  }
  const result = await provider.runAgent({
    tier: "main",
    purpose: `chat:${mode}`,
    system: SYSTEM_PROMPT,
    context: await buildContext(env, mode),
    history,
    tools,
  });

  const reply: Message = {
    id: uid(), role: "assistant", content: result.text, mode, meta: notes.length ? JSON.stringify(notes) : null,
    created_at: new Date(Date.now() + 1).toISOString(), conversation_id: convo.id,
  };
  await run(env, "INSERT INTO messages (id, role, content, mode, meta, created_at, conversation_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    reply.id, reply.role, reply.content, reply.mode, reply.meta, reply.created_at, convo.id);
  convo.last_message_at = reply.created_at;
  await run(env, "UPDATE conversations SET last_message_at = ? WHERE id = ?", reply.created_at, convo.id);
  if (!convo.title) await titleConversation(env, convo, text);
  return { user: userMsg, reply, actions: notes, conversation: convo };
}
