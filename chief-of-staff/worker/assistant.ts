import {quickTaskReply} from './assistant-quick';
import {hashgachaCampaigns,sourceReports,syncHashgacha,trackHashgacha} from './hashgacha';
import {PROJECT_POLICY} from '../shared/project-policy';
/** The single Chief of Staff assistant: prompt, context assembly and tools over the user's data. */
import type { ActionNote, Conversation, Item, Memory, Message, Project } from "../shared/types";
import type { Env } from "./env";
import { notify } from "./push";
import { recurringReminders, saveRecurringReminder } from './reminders';
import { addShoppingItems, saveShoppingList, shoppingState, updateShoppingItem } from './shopping';
import { getProvider, type ToolDef, type Turn } from "./ai";
import {
  all, createItem, createProject, first, getSettings, HttpError, now, resolveProjectId, run, uid, updateItem,
} from "./db";
import { calendarLookup, createDraft, googleStatus, readThread, searchEmail, sendDraft, upcomingEventsText } from "./google";
import { bridgeStatus, queueWhatsApp } from "./whatsapp";
import { findPeople, memoryContext, noteContact, recallMemories, recallText, savePerson } from "./memory";
import { appendRows, createDoc, createSheet, readFile, searchDrive, shareFile } from "./gworkspace";
import { resolveBlock, saveSituation, situationsSummary } from "./situations";
import { areasText, saveArea } from "./areas";
import { activeProjects } from "./projectmatch";
import { prepareWhatsApps } from "./contacts";
import { fileForModel, fileInfo, fillForm, findEmailFiles, recentFiles, saveVault, signFile, vaultSummary } from "./documents";
import { coffeeChange, hubCall, saveCoffeeRule } from "./hub";
import { findGroup, groupsSummary, members, saveGroup } from "./groups";

export const SYSTEM_PROMPT = `You are the user's personal Chief of Staff. You are one consistent assistant across text and voice, with a shared memory of their life and work.

What you do:
- Before ANY AI background task or research job starts, ALWAYS get a separate explicit confirmation from the user. A request to research or schedule something is not that confirmation. The server queues an approval card; say it is waiting for approval on Today, never claim it has started. Each research run requires approval, including scheduled repeats and deeper follow-ups. Creating ordinary reminders, calendar rules and links does not need an AI job. Never route a fixed reminder to research.
- Shopping belongs only in Shopping lists (sidebar), never in tasks, reminders, the home screen or unsolicited briefings. For "add milk to my shopping list", use add_shopping_items; default to the main Store list. Multiple shopping lists are supported. Use get_shopping_lists to find item IDs, save_shopping_list to create/rename lists, update_shopping_item to edit or check off purchases. Text and live voice use the same shopping tools. Only mention shopping when the user asks about it.
- Keep track of their tasks, reminders, commitments, projects and the things they are waiting on from other people.
- Remember durable facts and preferences (use the remember tool) so they never have to repeat themselves.
- Help them decide, prioritise and plan. Be proactive: point out overdue items, conflicts, forgotten follow-ups and sensible next steps.
- Act like a trusted human chief of staff, not a chatbot. When they tell you what is going on ("here's how I'm doing deliveries today", "we're launching X next week"), quietly build the structure it needs: tasks and reminders at sensible times, a check-in reminder afterwards phrased as a question ("Did you…?") so you can ask whether it happened, a project to group related work, and memories for lasting facts. Do not ask permission for this internal organizing; just do it and tell them briefly what you set up.
- A reminder whose title starts with "Did you…?" is sent as a check-in with Yes / Not yet buttons. Use that for follow-ups.

Areas: everything belongs to one of the user's areas, listed under "## Areas" in the context (keys like coffee, yeshiva, personal, plus any they added). Set category on every item when it is clear. If it is genuinely unclear, leave it out: the user gets a "Which area?" prompt to choose. When the user tells you someone's area, save it on that person (save_person notes) so future items from them are filed correctly. When the user wants a new area/category ("add a category for the house renovation"), create it with save_area and use it from then on.

Projects: ${PROJECT_POLICY}

Reminders can be at ANY time, not only at deadlines: for "remind me sometime this afternoon", pick a sensible time yourself and create a reminder with that due_at.

Recurring reminders: fixed reminders and links do NOT need an AI job. For monthly reminders (including several dates such as the 16th, 17th and 18th), use save_recurring_reminder with days and a local time. Each month is one ordinary reminder: marking it done stops the remaining dates for that month, and the next month starts afresh. Include any supplied link. Never use save_task/research for a fixed reminder; those are paid AI research jobs. Read or change a rule with get_recurring_reminders/save_recurring_reminder. The rules are in Lists & projects → To-do, alongside reminders. No per-run AI cost.

Schedule (time blocks): the user's day is made of blocks of time devoted to an area or activity. Keep it up to date with save_time_block:
- Recurring: "I'm in yeshiva Sun-Thu 9 to 1" → name "In yeshiva", weekdays, start/end, category yeshiva.
- One-off: "I'm working on coffee from 2 to 6 today" → name "Coffee time", date (YYYY-MM-DD), start/end, category coffee. It clears itself after that day.
- Calendar-triggered: "when I'm at events remind me to collect business cards" → calendar_keywords + note.
- Meetings: unless told otherwise, the user meets people during their evening yeshiva slot (the evening block in their Schedule, usually 20:15). When they ask you to add a meeting without a time, put it at the start of that slot that night (a one-off time block named "Meet <name>", area yeshiva). Do not infer or create meetings automatically from WhatsApp; use the calendar and explicitly saved Schedule meetings.
- Changes for one day: "today I'm not going into yeshiva" → save_time_block with that block's id and skip_date (today's local date): no reminders from it that day. "Actually I am going" → unskip_date. "Today my schedule is …" → skip the usual blocks that don't apply and add one-off blocks for today. Changing the usual week → edit the recurring blocks.
The schedule has its own screen in the app (menu → Schedule).
At the start of a block (or a random moment in it) the user is reminded of what belongs there: tasks attached to the block, then open items in its area/keywords (intuited), plus any standing note.
When the user wants something reminded during a block ("remind me to ask Rabbi W during yeshiva", "do this in coffee time"), create or update the item with block set to that block's name. If no such block exists yet, ask when it is (or create it).
The context tells you which block the user is in RIGHT NOW: use it when they ask what to do next.
Driving/commutes: surface phone calls across all areas and explicitly voice-only work. Use execution_mode call/voice/desk/physical when filing; coding is voice only if explicitly intended for spoken interaction. Never give a destination-work overview during a drive.

Tasks (research chats): research, reports and checks, once or on a schedule ("every Sunday a report on the coffee market in Israel", "hourly updates on X until tonight", "research Y and tell me what to do"), are research chats: start them with start_job. Each is pinned in the side panel, answers arrive there with a notification, and the user changes or stops it by writing in it. Confirm in one line what will run, then say to tap Start in its chat.


Memory, like a person with a good brain:
- "People you know" is your address book. When the user mentions someone by role or name ("my boss", "the accountant", "Avi") look there first.
- If you need someone you don't know yet (no person with that role or name), ask once: who they are and how to reach them (email and/or WhatsApp name). Save it with save_person. Never ask again for what is saved.
- Channels: if the person has a usual channel, say you'll use it ("I'll email it to David as usual") and go ahead with the draft/approval flow; if not, ask "email or WhatsApp?". If the user states a preference ("always email him"), save it as preferred_channel.
- Anything the user sees (notifications, reminders, notes, titles, item text) is written TO them, in second person, and contains no instructions to yourself. Keep instructions to yourself in guidance fields or memories, never in what they see.
- Memory is minimalist: only what is essential and lasting about their life. Mark a person key (save_person key=true) only if they are central (family, boss, main partners, main suppliers/customers, people they deal with weekly); everyone else is saved without key and looked up when mentioned. Prefer one summarizing fact over many small ones ("You oversee the Night Seder rabbis: A, B, C" rather than a memory per rabbi). Don't save one-off contacts or passing details.
- Save lasting facts and preferences with remember as soon as you learn them, without asking. If the user told you directly, save it as is; if you are inferring or connecting dots (e.g. "the bottle company is probably your coffee bottle supplier"), set inferred=true with a short question so they confirm it in their review list. Be generous: the more you understand about their life, the better. Update instead of duplicating. If a memory you need isn't shown, use recall.
- Documents: create Google Docs and Sheets directly when asked, and give the link. Sharing a file with someone goes through share_file, which waits for the user's approval.

How to file things — keep these clearly separate:
- task: something the user needs to do.
- reminder: something to be reminded of at a specific time (always set due_at).
- commitment: a promise the user made to someone (set person; due_at if there is a deadline).
- waiting: something the user is waiting on from someone else (set person). Never file "Wait for ..." as an actionable task. Keep it tracked as waiting, and offer a separate follow-up when appropriate; do not present waiting as work to do now.
- idea: an idea worth keeping goes to remember (a lasting note), or a task when there is something to do about it.
- Lists: shopping uses its dedicated tools. A deliberate batch for now/this afternoon is a dated session project, even across areas; create_project first, then create_item with its name. Other unrelated to-dos stay standalone. Never infer a weekly catch-all from deadlines alone.

How this app fits together (you ARE this app; everything below is yours to use, and things connect: a group's members are people, people have emails/WhatsApp names, items can belong to projects and time blocks):
- Home: Now checklist and all unfinished tasks grouped under projects or standalone. Talk/dictate/type to you. Today: the daily overview.
- Replies: a numbered catch-up sheet for unanswered WhatsApp/email, with voice/text batch instructions, editable drafts and explicit Send. WhatsApp opens the target chat; email sends from the sheet.
- Groups: contact groups (used to search email and WhatsApp from everyone in a group).
- People: address book inside Settings.
- Lists & projects: to-dos, reminders, commitments, waiting-for, grouped into projects.
- Tasks: research chats.
- Schedule: daily schedule, weekly extras, one-day changes.
- Search: memories and reference material remain searchable. There is no Library in the navigation. Actionable work belongs in tasks and concrete projects, not passive notes.
- Settings: connected accounts, notifications, usage.
When the user refers to anything by name ("the rabbis group", "the coffee report", "evening yeshiva"), resolve it with your tools (get_group, get_context, find_person, search_items…) and act across features: e.g. "check emails from the rabbis group" → search_email with group="Rabbis"; "any WhatsApps from my wholesale customers?" → check_group_messages.

Drafting text: when the user asks you to draft/write/word a message, email, post or text WITHOUT saying where it goes, just write it in your reply so they can use it however they want. Put the draft itself in a quote block (each line starting with "> ") so they can copy it with one tap; at most one short line before it. Do NOT save it anywhere: no draft_email or send_whatsapp unless they explicitly say "for the X group", "save it in Gmail", "send it to Y" or similar. If it obviously relates to a person, you may offer in one short line afterwards ("Want me to send it to Dana?") but don't do it.


Groups: the user keeps contact groups ("the rabbis", "wholesale customers"). Create/edit them with save_group (members by name, plus email and phone when known; existing people are matched by name). Use a group to search email or WhatsApp from all its members. To message several people, use prepare_whatsapps (one-tap WhatsApp links) or draft emails.

Researching the web: you CAN look things up online. For a research question start a research chat with start_job (kind once). It waits for the user's Start tap; tell them it has NOT started. Never say you can't browse the web.

Ideas and thinking out loud: when the user shares an idea or thinks out loud, engage briefly and honestly (what's strong, what's risky). Save what lasts with remember, and file concrete to-dos with create_item.

Rules:
- SPEED: when your tool calls only save or change things (add a to-do, set a reminder, remember something, update the schedule…), write your short reply to the user in the SAME message as the tool calls, assuming they succeed. Make all the calls you need at once rather than one per turn.
- GET IT DONE. When the user asks for something, do the whole thing end to end with your tools, not advice about it: look it up (start_job), file it, schedule it, draft it, chain several steps in one go. If a tool you need isn't loaded, call load_tools. Only stop to ask when you genuinely can't continue without the user (a choice only they can make, or something outside the world). Then report briefly what you DID and what happens next ("I'm researching it now; you'll get the results in ~15 min"), never what they could do themselves. Never say you can't do something your tools can do.
- Be thorough: for research or lists, go for complete and useful (many options, concrete details, contacts), not a thin sample.
- When the user tells you something actionable, file it with the tools; do not just acknowledge it. Check for duplicates with search_items first when unsure.
- Resolve relative dates ("tomorrow at 3", "Friday") using the current local time given in the context, and pass due_at as an ISO 8601 datetime with the user's UTC offset.
- When the user asks you to delete, drop, cancel or remove their OWN things in this app (to-dos, reminders, projects, lists, memories, schedule blocks), just do it right away (update_item status "dropped", etc.). Don't ask for approval. Only actions that reach the outside world (sending messages, contacting people, sharing files, spending money) need propose_action and the user's approval.
- Email: you can search all their Gmail (search_email, also by group) and read threads. Remind first; only write a draft when the user explicitly asks you to draft. Drafts are saved to their Gmail Drafts folder. Chat-created Gmail drafts stay drafts. Replies sent by the user from the Replies sheet send the exact reviewed text; 
- Be concise and warm. Lead with what matters. Use short lists when listing items. Do not invent data you have not been given.`;

const VOICE_ADDENDUM = `\n\nYou are in a live voice conversation and your replies are spoken aloud: answer in one to three short conversational sentences, no lists, no markdown, no emoji.`;

const OPEN_ITEMS = 40;
const FEW_ITEMS = 12;

/**
 * Context triage, no AI involved: plain rules decide which saved sections ride along with a message.
 * A section is included when the message has one of its trigger words, or mentions something by
 * name that appears in that section (a group, project or time block). With no
 * message (live voice setup, background jobs) everything is included.
 */
/** Word stems (matched at word start, any ending: "meet" catches meeting/meetings) plus Hebrew substrings. */
const rule = (stems: string[], hebrew: string[] = [], phrases: string[] = []) =>
  new RegExp([`\\b(?:${stems.join("|")})`, ...phrases, ...hebrew].join("|"), "i");
const DAYS_EN = ["sun(day)?", "mon(day)?", "tue(s|sday)?", "wed(nesday)?", "thu(rs|rsday)?", "fri(day)?", "sat(urday)?", "shabbos", "shabbat", "motzei", "erev"];
const TIME_EN = ["today", "tomorrow", "tonight", "yesterday", "morning", "afternoon", "evening", "night", "noon", "midday", "week", "weekend", "month", "later", "soon", "next", "this (morning|afternoon|evening|week)", "\\d{1,2}(:\\d{2})?\\s*(am|pm)", "\\d{1,2}:\\d{2}", "o'?clock", "hour", "minute", "early", "late", "now", "asap", "until", "till", "before", "after"];
const DAYS_HE = ["היום", "מחר", "אתמול", "הערב", "בבוקר", "בערב", "בלילה", "השבוע", "שבוע", "ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת", "מוצ\"ש", "שעה"];

const TRIGGERS: Record<string, RegExp> = {
  schedule: rule([...DAYS_EN, ...TIME_EN, "schedul", "calendar", "yeshiva", "seder", "night seder", "shiur", "kollel", "chavrusa", "mashgiach", "roast", "shop", "deliver", "commut", "drive", "free", "busy", "availab", "off", "block", "routine", "plan(ning)? my", "when", "where am i", "in (yeshiva|the shop)", "going in", "not going", "skip", "cancel", "reschedul", "move", "day"],
    [...DAYS_HE, "ישיבה", "סדר", "שיעור", "לוח זמנים", "פנוי", "עסוק"]),
  calendar: rule([...DAYS_EN, ...TIME_EN, "calendar", "meet", "event", "appoint", "call with", "zoom", "simcha", "wedding", "bris", "bar mitzvah", "chasuna", "class", "shiur", "schedul", "busy", "free", "availab", "when", "what('s| is) (on|happening|coming)", "agenda", "upcoming", "reschedul", "postpone", "move"],
    [...DAYS_HE, "פגישה", "אירוע", "חתונה", "ברית", "יומן"]),
  groups: rule(["group", "everyone", "every(body| one)", "all (the|my|of)", "mass", "announc", "let (them|everyone) know", "tell (them|all|everyone|the)", "message (all|them|the|everyone)", "email (all|them|the|everyone)", "send (it )?to (all|everyone|the)", "blast", "newsletter", "mailing", "list of (people|contacts)", "contacts", "staff", "team", "rabbis", "rebbeim", "customers", "clients", "wholesale", "parents", "talmidim", "students", "bochurim", "alumni", "emails? from", "messages? from", "heard from", "inbox"],
    ["קבוצה", "כולם", "הרבנים", "רבנים", "לקוחות", "הורים", "תלמידים", "בחורים"]),
  projects: rule(["project", "initiative", "campaign", "rollout", "build(ing)?", "website", "renovat", "launch", "program", "list", "shopping", "groceries", "buy", "pack", "supplies", "need to get"], ["פרויקט", "פרוייקט", "רשימה", "קניות", "לקנות"]),
  manyItems: rule(["to-?dos?", "list", "remind", "overdue", "late", "left", "open", "pending", "due", "task", "everything", "anything", "what do i (have|need)", "what('s| is) (on|left|next|pending|due|urgent|important)", "plate", "catch me up", "briefing", "brief me", "summar", "status", "agenda", "priorit", "urgent", "important", "forget", "forgot", "did i", "have i", "done", "finish", "complet", "check off", "mark", "outstanding", "backlog", "behind", "waiting", "owe", "promis", "commit", "follow ?up", "focus", "work on", "should i (do|start|tackle)", "next", "free time", "spare", "productive"],
    ["משימ", "תזכ", "להזכיר", "מה נשאר", "מה יש לי", "דחוף", "חשוב"]),
};
const SIGNIFICANT = (q: string) => (q.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []).filter((w) => !["that", "this", "with", "have", "what", "when", "from", "about", "just", "need", "want", "please", "tell", "them", "they", "will", "would", "could", "should", "there", "their", "make", "also", "some"].includes(w));

export function triageSections(query: string, sections: Record<string, string>) {
  if (!query.trim()) return new Set([...Object.keys(TRIGGERS), ...Object.keys(sections)]);
  const want = new Set<string>();
  for (const [k, re] of Object.entries(TRIGGERS)) if (re.test(query)) want.add(k);
  const words = SIGNIFICANT(query);
  for (const [k, text] of Object.entries(sections)) {
    const t = text.toLowerCase();
    if (words.some((w) => t.includes(w))) want.add(k);
  }
  return want;
}

async function contextSummaries(env:Env){
  const [schedule,groups]=await Promise.all([situationsSummary(env),groupsSummary(env)]);
  return {schedule,groups};
}
type ContextSummaries=Awaited<ReturnType<typeof contextSummaries>>;

export async function buildContext(env: Env, mode: string, query = "",summaries?:ContextSummaries|Promise<ContextSummaries>): Promise<string> {
  const settings = await getSettings(env);
  const tz = settings.timezone || "UTC";
  const localNow = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, dateStyle: "full", timeStyle: "short",
  }).format(new Date());

  const [memory, recalled, items, projects, areaText, activeP, g, bridge, sectionSummaries, recentSaves] = await Promise.all([
    memoryContext(env), // core only: stable between messages
    query ? recallText(env, query) : Promise.resolve(""),
    all<Item>(
      env,
      `SELECT * FROM items WHERE status = 'open'
       ORDER BY CASE WHEN due_at IS NULL THEN 1 ELSE 0 END, due_at, priority LIMIT ${OPEN_ITEMS}`,
    ),
    all<Project>(env, "SELECT * FROM projects WHERE status != 'done' ORDER BY created_at LIMIT 30"),
    areasText(env),activeProjects(env),googleStatus(env).catch(()=>null),bridgeStatus(env),summaries?Promise.resolve(summaries):contextSummaries(env),
    // The due-first inventory can omit newly saved, undated work. Keep those receipts visible on follow-ups.
    all<Item>(env,"SELECT * FROM items WHERE source IN ('chat','voice','codex') AND updated_at>=? ORDER BY updated_at DESC,id LIMIT 20",new Date(Date.now()-86400000).toISOString()),
  ]);
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const {schedule:situations,groups}=sectionSummaries;
  const projectsText = projects.map((p) => `- ${p.name} [${p.area}, ${p.status}]${p.description ? ` — ${p.description}` : ""}`).join("\n");
  const want = triageSections(query, {
    schedule: situations, groups, projects: projectsText,
  });
  // Items mentioned by name always count; otherwise a short list unless the message is about to-dos.
  const itemWords = SIGNIFICANT(query);
  const shownItems = want.has("manyItems") || !query.trim() ? items
    : [...items.slice(0, FEW_ITEMS), ...items.slice(FEW_ITEMS).filter((i) => itemWords.some((w) => `${i.title} ${i.person ?? ""}`.toLowerCase().includes(w)))];

  // Prompt caching: OpenAI bills the identical opening of a request ~90% cheaper. So the order is
  // (1) things that change rarely, (2) things that change during the day, (3) what changes every
  // message (time, recalled memories) LAST, so one change doesn't invalidate everything after it.
  const lines: string[] = [];
  if (settings.name) lines.push(`The user's name is ${settings.name}.`);
  lines.push("## Areas", areaText);
  // The user's saved details (addresses, business numbers; signatures by name): used when they ask to fill or sign something.
  const myDetails = await vaultSummary(env).catch(() => "");
  if (myDetails) lines.push("", "## My details (saved by the user)", myDetails);
  lines.push(memory);
  if (situations && want.has("schedule")) lines.push("", "## Schedule (time blocks)", situations);
  if (groups && want.has("groups")) lines.push("", "## Contact groups", groups);
  // Projects are always shown (short): every to-do being filed is checked against them.
  if (activeP.length) lines.push("", "## Projects (active)", activeP.map((p) => `- ${p.name}${p.description ? ` — ${p.description.slice(0, 80)}` : ""}${p.samples.length ? ` (open: ${p.samples.join("; ")})` : ""}`).join("\n"));
  else if (projectsText && want.has("projects")) lines.push("", "## Projects", projectsText);
  lines.push("", "## Connected accounts");
  lines.push(!g || !g.accounts.length ? "- Google: not connected (no calendar or email access)."
    : `- Google accounts: ${g.accounts.map((a) => a.email).join(", ")}. Calendar lookups cover all of them; email search covers all unless you pass account. Drafts go from the account the thread is in (or the account you pass for new mail).`);
  lines.push(bridge.configured
    ? "- WhatsApp: you can prepare messages with send_whatsapp (user taps Send to approve); approved messages go out when their computer is on. WhatsApp is user-directed: search captured messages only when asked, then save only the specific work the user requests. Passive scanning only maintains the unanswered-reply queue after four hours; never infer tasks, meetings or memories from ordinary WhatsApps."
    : "- WhatsApp: not set up yet.");
  const skipped = ["schedule", "groups", ...(activeP.length ? [] : ["projects"]), "calendar"].filter((k) => !want.has(k));
  if (skipped.length) lines.push("", `(Not shown for this message: ${skipped.join(", ")}. If the answer could depend on one, load it with get_context first; never guess.)`);
  lines.push("", `## Open items (soonest ${shownItems.length}; use search_items for others)`);
  lines.push(
    shownItems.length
      ? shownItems
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
  const events = g?.accounts.length && want.has("calendar") ? await upcomingEventsText(env, tz) : null;
  if (events) lines.push("", "## Calendar (next 48 hours)", events);
  if(recentSaves.length)lines.push("", "## Recently saved work (database records; already saved even if an earlier reply said otherwise)",...recentSaves.map(i=>`- ${i.title} [${i.status}; id ${i.id}${i.project_id?`; project ${projectName.get(i.project_id)||i.project_id}`:''}; updated ${i.updated_at}]`));
  // Changes every message: keep at the very end.
  const off = zoneOffset(tz, new Date());
  lines.push("", `Current local time: ${localNow} (timezone ${tz}, UTC${off < 0 ? "-" : "+"}${String(Math.floor(Math.abs(off) / 60)).padStart(2, "0")}:${String(Math.abs(off) % 60).padStart(2, "0")} now; UTC now ${now()}).`);
  if (bridge.configured && !bridge.online) lines.push("(The user's computer is offline right now, so approved WhatsApps wait until it's back.)");
  if (recalled) lines.push("", recalled);
  if (mode === "voice") lines.push(VOICE_ADDENDUM);
  return lines.join("\n");
}

const itemProps = {
  kind: { type: "string", enum: ["task", "reminder", "commitment", "waiting"] },
  title: { type: "string" },
  notes: { type: "string" },
  execution_mode: {type:"string",enum:["unspecified","call","voice","desk","physical"],description:"voice only when explicitly hands-free"},
  priority: { type: "integer", enum: [1, 2, 3], description: "1 high, 3 low" },
  due_at: { type: "string", description: "ISO 8601, local time" },
  person: { type: "string" },
  project: { type: "string", description: 'name/id; "" = standalone' },
  keep_standalone: { type: "boolean" },
  category: { type: "string", description: "## Areas key; omit if unclear" },
  block: { type: "string", description: 'time block name/id; "none" detaches' },
};

/** How far the zone is ahead of UTC at a moment, in minutes. */
function zoneOffset(tz: string, at: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(at).map((x) => [x.type, x.value]));
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - at.getTime()) / 60_000);
}

/** The clock time the model gives ("2026-10-28T10:00") is the user's local time. With no zone, or with a wrong
 *  offset (a model's guess at summer time after the clocks changed), it is read as local; UTC ("Z") and the
 *  correct offset are kept. The server runs on UTC, so without this reminders land hours off. */
async function localTime(env: Env, v: unknown) {
  const m = typeof v === "string" ? v.match(/^(\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?)([+-]\d\d:?\d\d)?$/) : null;
  if (!m) return v;
  const tz = (await getSettings(env)).timezone || "UTC";
  const wall = new Date(m[1] + "Z");
  const local = new Date(wall.getTime() - zoneOffset(tz, new Date(wall.getTime() - zoneOffset(tz, wall) * 60_000)) * 60_000);
  if (!m[2]) return local.toISOString();
  const [, sign, hh, mm] = m[2].match(/([+-])(\d\d):?(\d\d)/)!;
  const given = (sign === "-" ? -1 : 1) * (+hh * 60 + +mm);
  return given === zoneOffset(tz, local) ? new Date(v as string).toISOString() : local.toISOString();
}

/** Attach an item to a time block (or detach with "none"). */
async function attachBlock(env: Env, itemId: string, ref: unknown) {
  if (ref === undefined || ref === null || ref === "") return null;
  if (String(ref).toLowerCase() === "none") { await run(env, "UPDATE items SET block_id = NULL WHERE id = ?", itemId); return null; }
  const b = await resolveBlock(env, String(ref));
  if (!b) throw new Error(`No time block called "${ref}" yet. Ask the user when it is, then create it with save_time_block.`);
  await run(env, "UPDATE items SET block_id = ? WHERE id = ?", b.id, itemId);
  return b.name;
}

export function assistantTools(env: Env, source: string, notes: ActionNote[]): ToolDef[] {
  const note = (tool: string, summary: string) => notes.push({ tool, summary });
  const proposedThisTurn=new Set<string>();
  return [
    {
      name:'get_hashgacha_reports',readOnly:true,description:'Read Hashgacha online report completion for tracked reporting weeks: who submitted, partially submitted or is missing. Uses cached verified submission metadata, never email replies. Supply week_of (Sunday) to read the source for an untracked week.',
      input_schema:{type:'object',properties:{week_of:{type:'string'}}},handler:async input=>input.week_of?sourceReports(env,String(input.week_of)):hashgachaCampaigns(env),
    },
    {
      name:'track_hashgacha_reports',description:'Connect existing Hashgacha follow-up task IDs to exact class IDs and an explicit Sunday reporting week. Verify class/teacher identities first using get_hashgacha_reports. Does not send messages or create AI jobs. Existing tasks are completed only when online report submission is verified.',
      input_schema:{type:'object',properties:{week_of:{type:'string'},label:{type:'string'},project_id:{type:'string'},bindings:{type:'array',items:{type:'object',properties:{class_id:{type:'integer'},item_id:{type:'string'}},required:['class_id','item_id']}}},required:['week_of','bindings']},handler:async input=>{const result=await trackHashgacha(env,input as never);note('track_hashgacha_reports','Hashgacha online report tracking connected');return result;},
    },
    {
      name: 'get_recurring_reminders', description: 'Read fixed recurring reminder rules. These are reminders, not AI tasks or research jobs.',
      input_schema: { type: 'object', properties: {} }, handler: async () => recurringReminders(env),
    },
    {
      name: 'save_recurring_reminder', description: 'Create/edit/pause a fixed monthly reminder with optional link, with NO AI calls when it fires. Marking its reminder done stops that month. Use this for attendance forms and similar recurring reminders, not save_task.',
      input_schema: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, notes: { type: 'string' }, link: { type: 'string' }, days: { type: 'array', items: { type: 'integer' }, description: 'Days each month, e.g. [16,17,18]' }, time: { type: 'string', description: 'HH:MM in local timezone' }, timezone: { type: 'string' }, category: { type: 'string' }, active: { type: 'boolean' } } },
      handler: async input => { const r = await saveRecurringReminder(env,input); note('save_recurring_reminder', `${r.active ? 'Reminder' : 'Paused'}: ${r.title}, ${r.days.join(', ')} each month at ${r.time}. No AI job.`); return r; },
    },
    {
      name: 'get_shopping_lists', description: 'Read shopping lists and their item IDs. Kept separate from tasks; Store is the main list.',
      input_schema: { type: 'object', properties: {} }, handler: async () => shoppingState(env),
    },
    {
      name: 'save_shopping_list', description: 'Create a shopping list or rename one by id.',
      input_schema: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } }, required: ['name'] },
      handler: async input => { const result = await saveShoppingList(env, input); note('save_shopping_list', `Shopping list: ${result.name}`); return result; },
    },
    {
      name: 'add_shopping_items', description: 'Add requested purchases to a shopping list, never to tasks. Defaults to Store. Preserve quantities and variants; existing unchecked items are not duplicated.',
      input_schema: { type: 'object', properties: { list: { type: 'string', description: 'List name or id; omit for Store' }, items: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, quantity: { type: 'string' }, notes: { type: 'string' } }, required: ['name'] } } }, required: ['items'] },
      handler: async input => { const r = await addShoppingItems(env, input.list as string | undefined, input.items as { name: string; quantity?: string; notes?: string }[], source); note('add_shopping_items', `Added ${r.added} shopping item${r.added === 1 ? '' : 's'}`); return r; },
    },
    {
      name: 'update_shopping_item', description: 'Edit a shopping item or mark it purchased (checked=true), or uncheck it. Read IDs with get_shopping_lists first.',
      input_schema: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, quantity: { type: 'string' }, notes: { type: 'string' }, checked: { type: 'boolean' } }, required: ['id'] },
      handler: async input => { const r = await updateShoppingItem(env, String(input.id), input); note('update_shopping_item', 'Shopping list updated'); return r; },
    },
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
      description: "Search the user's Gmail (Gmail search syntax, e.g. 'from:dana invoice newer_than:30d'). Pass group to limit it to emails from/to everyone in one of their contact groups. Returns thread ids and snippets.",
      input_schema: { type: "object", properties: { query: { type: "string", description: "Gmail search; may be empty when group is given" }, group: { type: "string", description: "contact group name" }, account: { type: "string", description: "Optional: one account email" } } },
      handler: async (input) => {
        let q = String(input.query ?? "").trim();
        if (input.group) {
          const g = await findGroup(env, String(input.group));
          if (!g) return { error: `No group called "${input.group}".` };
          const emails = (await members(env, g.id)).map((m) => m.email).filter(Boolean) as string[];
          if (!emails.length) return { error: `Nobody in "${g.name}" has an email saved yet.` };
          q = `{${emails.map((e) => `from:${e} to:${e}`).join(" ")}} ${q || "newer_than:14d"}`;
        }
        if (!q) return { error: "What should I search for?" };
        return searchEmail(env, q, input.account as string | undefined, input.group ? 15 : 6);
      },
    },
    {
      name: "get_group",
      description: "A contact group's members with their emails, phones and WhatsApp names (by group name or id).",
      input_schema: { type: "object", properties: { group: { type: "string" } }, required: ["group"] },
      handler: async (input) => {
        const g = await findGroup(env, String(input.group));
        if (!g) return { error: `No group called "${input.group}".`, groups: await groupsSummary(env) };
        return { id: g.id, name: g.name, description: g.description, members: (await members(env, g.id)).map((m) => ({ name: m.name, email: m.email, phone: m.phone, whatsapp_name: m.whatsapp_name, role: m.role })) };
      },
    },
    {
      name:'search_whatsapp',readOnly:true,
      description:'Search captured WhatsApps by text and/or person/chat when the user asks to pull specific information or work. Read-only: never adds anything. Disclose captured-history coverage and bridge freshness.',
      input_schema:{type:'object',properties:{query:{type:'string'},chat:{type:'string'},days:{type:'integer'}},required:[]},
      handler:async input=>(await import('./whatsapp')).searchWhatsApp(env,input as never),
    },
    {
      name: "check_group_messages",
      description: "Recent messages from everyone in a contact group, across Gmail and WhatsApp (last N days, default 7).",
      input_schema: { type: "object", properties: { group: { type: "string" }, days: { type: "integer" } }, required: ["group"] },
      handler: async (input) => {
        const g = await findGroup(env, String(input.group));
        if (!g) return { error: `No group called "${input.group}".` };
        const ppl = await members(env, g.id);
        const days = Math.min(90, Math.max(1, Number(input.days) || 7));
        const emails = ppl.map((m) => m.email).filter(Boolean) as string[];
        const email = emails.length
          ? await searchEmail(env, `{${emails.map((e) => `from:${e}`).join(" ")}} newer_than:${days}d`, undefined, 15).catch((e) => ({ error: (e as Error).message }))
          : "nobody in the group has an email saved";
        const names = ppl.flatMap((m) => [m.name, m.whatsapp_name].filter(Boolean) as string[]).map((n) => n.toLowerCase());
        const since = new Date(Date.now() - days * 86400_000).toISOString();
        const wa = names.length ? (await all<{ chat: string; sender: string; text: string; received_at: string }>(env,
          "SELECT chat, sender, text, received_at FROM whatsapp_inbox WHERE received_at > ? ORDER BY received_at DESC LIMIT 300", since))
          .filter((m) => names.some((n) => m.sender.toLowerCase().includes(n) || m.chat.toLowerCase().includes(n))).slice(0, 40) : [];
        return { group: g.name, members: ppl.map((m) => m.name), email, whatsapp: wa.length ? wa : "no WhatsApp messages from them in that time (only messages the WhatsApp add-on saw are available)" };
      },
    },
    {
      name: "read_email_thread",
      description: "Read the latest messages of a Gmail thread by id.",
      input_schema: { type: "object", properties: { thread_id: { type: "string" }, account: { type: "string" } }, required: ["thread_id"] },
      handler: async (input) => readThread(env, String(input.thread_id), input.account as string | undefined),
    },
    {
      name: "save_time_block",
      description: "Create or change a time block in the user's schedule: recurring (weekdays) or one-off (date), with start/end times and an area; or calendar-triggered (calendar_keywords). At its start the user is reminded of attached tasks and open items in that area/keywords plus a standing note. Pass id to change one; active=false pauses it.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string" }, name: { type: "string", description: 'e.g. "In yeshiva", "At events"' },
          category: { type: "string", description: "area key (see ## Areas)" },
          activity_mode: {type:"string",enum:["auto","standard","driving"],description:"Driving for a car commute: calls/explicit voice work only, across all areas."},
          keywords: { type: "string", description: "comma separated words; open items mentioning them are included" },
          note: { type: "string", description: "A standing note explicitly meant to repeat EVERY time this block runs. Never store a one-time task here: use create_item with block instead, so Done closes it. Empty string removes the repeating note. Never instructions to yourself." },
          guidance: { type: "string", description: "private instructions for yourself about this block (what to prioritize, how to remind). Never shown to the user." },
          weekdays: { type: "array", items: { type: "integer" }, description: "Recurring: 0=Sunday … 6=Saturday" },
          date: { type: "string", description: "One-off: YYYY-MM-DD (use today's local date for 'today')" },
          start_time: { type: "string", description: "HH:MM" }, end_time: { type: "string", description: "HH:MM" },
          mode: { type: "string", enum: ["start", "random"], description: "remind at the start, or at a random moment in the window" },
          calendar_keywords: { type: "string", description: 'comma separated; fires when a calendar entry with one of these in its title starts ("*" = any entry)' },
          skip_date: { type: "string", description: "YYYY-MM-DD: this block is off that day (e.g. not going in today)" },
          unskip_date: { type: "string", description: "YYYY-MM-DD: undo a skip" },
          active: { type: "boolean" },
        },
      },
      handler: async (input) => {
        const s = await saveSituation(env, input);
        note("save_time_block", `Schedule: ${s.name}, ${s.when}`);
        return s;
      },
    },
    {
      name: "save_area",
      description: "Add or change one of the user's life areas (categories): a name, an emoji and what it covers. Use when they ask for a new category or to rename one.",
      input_schema: { type: "object", properties: { key: { type: "string", description: "existing area key to change" }, label: { type: "string" }, icon: { type: "string", description: "one emoji" }, about: { type: "string", description: "what belongs in it" } } },
      handler: async (input) => {
        const areas = await saveArea(env, input as never);
        note("save_area", `🏷️ Areas: ${areas.map((a) => `${a.icon} ${a.label}`).join(", ")}`);
        return { areas };
      },
    },
    {
      name: "save_group",
      description: "Create or edit a contact group: name, description, members to add (name + email/phone; existing people matched by name) or remove (by name/email).",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string" }, name: { type: "string" }, description: { type: "string" },
          add: { type: "array", items: { type: "object", properties: { name: { type: "string" }, email: { type: "string" }, phone: { type: "string" } } } },
          remove: { type: "array", items: { type: "string" } },
        },
      },
      handler: async (input) => {
        const g = await saveGroup(env, input as never);
        note("save_group", `👥 Group "${g.name}": ${g.members.length} people`);
        return { id: g.id, name: g.name, members: g.members.map((m) => ({ name: m.name, email: m.email, phone: m.phone })) };
      },
    },
    {
      name: "coffee_app",
      description: "Read the Gremier Coffee admin app (live business data): outlook (how long each coffee lasts from actual deliveries, not hand-typed stock: fine / brew by a day / brew now, counting concentrate + bottles already made against the usual pace and scheduled deliveries; what to bottle; beans to order: use it for any 'do I need to brew?' or planning question), summary (today's jobs, next delivery, orders to fulfil, unpaid, money owed, concentrate, beans), schedule (jobs between dates), orders (to_fulfil|unpaid), stock, stores (with phone & prices), activity (timeline of deliveries/orders since a date), production_people (who can be credited with production work), marketing_products / marketing_sales (paid website sales per product per day, from/to) / marketing_inventory. Read-only.",
      input_schema: { type: "object", properties: {
        action: { type: "string", enum: ["outlook", "summary", "schedule", "orders", "stock", "stores", "activity", "production_people", "marketing_products", "marketing_sales", "marketing_inventory"] },
        from: { type: "string", description: "schedule: YYYY-MM-DD" }, to: { type: "string", description: "schedule: YYYY-MM-DD" },
        status: { type: "string", enum: ["to_fulfil", "unpaid"] }, since: { type: "string", description: "activity: ISO date" }, limit: { type: "integer" },
      }, required: ["action"] },
      handler: async (input) => {
        const { action, ...args } = input as Record<string, unknown>;
        return hubCall(env, String(action), args);
      },
    },
    {
      name: "coffee_update",
      description: "Change the Gremier Coffee admin app when the user tells you what happened or what they have (text or voice): set_stock (\"I have 20 Classic liters\", \"14 liters of decaf concentrate\": the new amount), log_bottling (bottled: product, units; adds bottles, uses concentrate), log_labeling, start_brew (product, kg), complete_drain (product or job_id; adds concentrate), log_store_delivery (happened: store, quantities {product_key: n}, date), schedule_store_delivery (future: store, quantities, date, time), reschedule_job (job_id from schedule; new date/time, or new planned quantities), complete_delivery (job_id or the next one due; quantities if different; a website order is marked fulfilled), adjust_stock (kind, product, delta, reason), production_clock_in (worker_id) / production_clock_out (shift_id), log_note (text). Brew, drain, bottling and labeling are credited to the owner unless the user names someone else: then pass worker_id from production_people (never guess one). Product keys: classic_liter, sweetened_classic, house_blend, colombia_liter, decaf_liter, unfiltered_liter, classic_mini, vanilla_mini, original_mini, caramel_mini, house_blend_mini, dairy_free_mini, jerry_can, jerry_can_houseblend, jerry_can_colombia, jerry_can_decaf, jerry_can_unfiltered, syrups (vanilla_syrup…), dispenser. Coffees: classic, unfiltered, houseBlend, colombia, decaf. The app is updated at once.",
      input_schema: { type: "object", properties: {
        action: { type: "string", enum: ["set_stock", "log_bottling", "log_labeling", "start_brew", "complete_drain", "log_store_delivery", "schedule_store_delivery", "reschedule_job", "complete_delivery", "adjust_stock", "production_clock_in", "production_clock_out", "log_note"] },
        kind: { type: "string", enum: ["inventory", "concentrate", "beans", "labeled"], description: "set_stock / adjust_stock: bottles (inventory, default), concentrate liters, beans kg, labeled empties" },
        product: { type: "string" }, value: { type: "number", description: "set_stock: the amount they have now" },
        units: { type: "integer" }, kg: { type: "number" }, delta: { type: "number" }, job_id: { type: "string" },
        store: { type: "string" }, quantities: { type: "object", additionalProperties: { type: "integer" } }, date: { type: "string" }, time: { type: "string", description: "HH:MM" }, text: { type: "string" },
        reason: { type: "string" }, worker_id: { type: "string" }, shift_id: { type: "string" },
      }, required: ["action"] },
      handler: async (input) => {
        const { action, ...args } = input as Record<string, unknown>;
        const r = await coffeeChange(env, String(action), args);
        note("coffee_update", `☕ App updated: ${String(action).replace(/_/g, " ")}`);
        return { done: true, app_updated: true, result: r };
      },
    },
    {
      name: "coffee_rule",
      description: "Remember how the user runs stock for a coffee or product, so the brewing outlook follows it: \"I only brew decaf when there's an order\" (key decaf, mode on_demand), \"keep 2 decaf liters bottled\" (key decaf_liter, keep 2), \"I brew classic normally again\" (mode normal), or remove.",
      input_schema: { type: "object", properties: {
        key: { type: "string", description: "a coffee (classic, unfiltered, houseBlend, colombia, decaf) or a product key (decaf_liter, jerry_can…)" },
        mode: { type: "string", enum: ["on_demand", "normal"], description: "on_demand = brewed only for orders" },
        keep: { type: "integer", description: "bottles to always have on hand" }, note: { type: "string", description: "their words, short" }, remove: { type: "boolean" },
      }, required: ["key"] },
      handler: async (input) => { const r = await saveCoffeeRule(env, input as never); note("coffee_rule", `☕ Stock rule saved: ${r.key}`); return r; },
    },
    {
      name: "save_person",
      description: "Add or update someone in the address book (matched by id or name).",
      input_schema: {
        type: "object",
        properties: {
          key: { type: "boolean", description: "only for the few central people in their life" },
          id: { type: "string" }, name: { type: "string" }, role: { type: "string" }, aliases: { type: "string" },
          email: { type: "string" }, phone: { type: "string" }, whatsapp_name: { type: "string" },
          preferred_channel: { type: "string", enum: ["email", "whatsapp", "call"] }, notes: { type: "string" },
        },
      },
      handler: async (input) => {
        const p = await savePerson(env, input);
        note("save_person", `${"created" in p ? "Saved" : "Updated"} ${p.name}${p.role ? ` (${p.role})` : ""}`);
        return p;
      },
    },
    {
      name: "find_person",
      readOnly:true,
      description: "Look up people by name, role, email or WhatsApp name.",
      input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      handler: async (input) => findPeople(env, String(input.query)),
    },
    {
      name: "get_context",
      readOnly:true,
      description: "Load a section of saved information listed under 'Not shown for this message'.",
      input_schema: { type: "object", properties: { section: { type: "string", enum: ["schedule", "calendar", "groups", "projects", "items", "people"] } }, required: ["section"] },
      handler: async (input) => {
        const tz = (await getSettings(env)).timezone || "UTC";
        switch (String(input.section)) {
          case "schedule": return (await situationsSummary(env)) || "(no time blocks)";
          case "calendar": return (await upcomingEventsText(env, tz)) || "(nothing in the next 48 hours or Google not connected)";
          case "groups": return (await groupsSummary(env)) || "(no groups)";
          case "projects": return (await all<Project>(env, "SELECT name, area, status, description FROM projects WHERE status != 'done' ORDER BY created_at LIMIT 50")) ;
          case "items": return all<Item>(env, "SELECT id, kind, title, due_at, person, priority FROM items WHERE status = 'open' ORDER BY CASE WHEN due_at IS NULL THEN 1 ELSE 0 END, due_at LIMIT 120");
          case "people": return all(env, "SELECT id, name, role, email, phone, whatsapp_name FROM people ORDER BY name LIMIT 200");
        }
        return "unknown section";
      },
    },
    {
      name: "recall",
      readOnly:true,
      description: "Search all saved memories (beyond those shown in context).",
      input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      handler: async (input) => recallMemories(env, String(input.query), 15),
    },
    {
      name: "create_doc",
      description: "Create a Google Doc. Content may use # / ## / ### headings and '- ' bullets. Returns the link.",
      input_schema: {
        type: "object",
        properties: { title: { type: "string" }, content: { type: "string" }, account: { type: "string", description: "Google account email; default the first" } },
        required: ["title", "content"],
      },
      handler: async (input) => {
        const d = await createDoc(env, String(input.title), String(input.content), input.account as string | undefined);
        note("create_doc", `Created doc: ${d.title}`);
        return d;
      },
    },
    {
      name: "create_sheet",
      description: "Create a Google Sheet with rows (first row = headers). Returns the link.",
      input_schema: {
        type: "object",
        properties: { title: { type: "string" }, rows: { type: "array", description: "Each row is a list of cell values", items: { type: "array", items: { type: "string" } } }, account: { type: "string" } },
        required: ["title"],
      },
      handler: async (input) => {
        const s = await createSheet(env, String(input.title), (input.rows as unknown[][]) ?? [], input.account as string | undefined);
        note("create_sheet", `Created sheet: ${s.title}`);
        return s;
      },
    },
    {
      name: "append_rows",
      description: "Add rows to the end of a Google Sheet (by file id, optional tab name).",
      input_schema: {
        type: "object",
        properties: { file_id: { type: "string" }, rows: { type: "array", description: "Each row is a list of cell values", items: { type: "array", items: { type: "string" } } }, sheet: { type: "string" }, account: { type: "string" } },
        required: ["file_id", "rows"],
      },
      handler: async (input) => {
        const r = await appendRows(env, String(input.file_id), input.rows as unknown[][], input.sheet as string | undefined, input.account as string | undefined);
        note("append_rows", `Added ${r.appended} row(s) to a sheet`);
        return r;
      },
    },
    {
      name: "search_drive",
      description: "Find Google Drive files (Docs, Sheets, PDFs…) by name or content across connected accounts.",
      input_schema: { type: "object", properties: { query: { type: "string" }, account: { type: "string" } }, required: ["query"] },
      handler: async (input) => searchDrive(env, String(input.query), input.account as string | undefined),
    },
    {
      name: "read_file",
      description: "Read a Google Doc's text, a Sheet's values, or a text export of another Drive file, by file id.",
      input_schema: { type: "object", properties: { file_id: { type: "string" }, account: { type: "string" } }, required: ["file_id"] },
      handler: async (input) => readFile(env, String(input.file_id), input.account as string | undefined),
    },
    {
      name: "share_file",
      description: "Share a Drive file with someone by email. Waits for the user's approval before anything is shared.",
      input_schema: {
        type: "object",
        properties: {
          file_id: { type: "string" }, file_title: { type: "string" }, email: { type: "string" },
          role: { type: "string", enum: ["reader", "commenter", "writer"] }, account: { type: "string" },
        },
        required: ["file_id", "email"],
      },
      handler: async (input) => {
        const role = (input.role as string) || "reader";
        const desc = `Share "${input.file_title ?? "file"}" with ${input.email} (${role === "reader" ? "can view" : role === "commenter" ? "can comment" : "can edit"})`;
        const id = uid();
        await run(env, "INSERT INTO pending_actions (id, action, payload, description, created_at) VALUES (?, ?, ?, ?, ?)",
          id, "share_file", JSON.stringify({ file_id: input.file_id, email: input.email, role, account: input.account }), desc, now());
        note("share_file", `Needs your approval: ${desc}`);
        return { id, status: "pending_approval" };
      },
    },
    {
      name: "start_job",
      description: "Start a research chat: research or monitoring once, every N minutes until stopped or a time limit (e.g. hourly election updates), or weekly (asks before each report). Pinned in the side panel ; waits for the user's Start tap.",
      input_schema: { type: "object", properties: {
        title: { type: "string", description: "2-5 words" },
        project_id:{type:"string",description:"Existing project id when this work belongs to that outcome; do not guess or group only by broad topic."},
        instructions: { type: "string", description: "everything the user asked for, in full: what to research or watch, what to judge it by, and how to report (format, summary, action items, a recommendation)" },
        kind: { type: "string", enum: ["once", "every", "weekly"] },
        every_minutes: { type: "integer", description: "every: e.g. 60 for hourly" },
        until: { type: "string", description: "every: local YYYY-MM-DDTHH:MM to stop; omit for until they say stop" },
        weekday: { type: "integer", description: "weekly: 0=Sunday" }, time: { type: "string", description: "weekly: HH:MM" },
        engine: { type: "string", enum: ["auto", "claude", "codex", "api"], description: "auto (their Claude/Codex plans) unless they name one; api only when they ask for the API" },
        only_changes: { type: "boolean", description: "post only when something changed (default for 'every')" },
        model: { type: "string", description: "only if they name one: luna, terra, sol, or a model name" },
      }, required: ["title", "instructions", "kind"] },
      handler: async (input) => { const { createJob: newJob } = await import("./jobs"); const r = await newJob(env, input as never); note("start_job", `🔎 ${r.title}: pinned in the side panel, tap Start there`); return r; },
    },
    {
      name: "email_with_codex",
      description: "Email people for the user through Codex (their ChatGPT plan, with their Gmail): e.g. the suppliers a research chat found, or 'email Dana asking for the invoice'. Codex writes the emails (looking up missing addresses), they appear in a chat with Send buttons, Codex sends only when the user taps Send, and replies are tracked there.",
      input_schema: { type: "object", properties: {
        ask: { type: "string", description: "everything they said: who to email, what to ask or say, tone, language" },
        title: { type: "string", description: "2-4 words for a new email chat" },
        research_chat: { type: "string", description: "the research chat's title when the emails are about its results" },
      }, required: ["ask"] },
      handler: async (input) => { const { createEmailChat } = await import("./jobs"); const r = await createEmailChat(env, input as never); note("email_with_codex", `✉️ Emails: ${r.where}`); return r; },
    },
    {
      name: "codex_backup",
      description: "What runs research and report jobs when Codex is out of usage or the computer is off: claude (their Claude plan) or api (the OpenAI API, pay per use). E.g. \"when Codex runs out, use the API\". Applies to every job from now on.",
      input_schema: { type: "object", properties: { engine: { type: "string", enum: ["claude", "api"] } }, required: ["engine"] },
      handler: async (input) => { const { setBackupEngine } = await import("./jobs"); const r = await setBackupEngine(env, input.engine === "api" ? "api" : "claude"); note("codex_backup", `When Codex is out: ${r.backup}`); return r; },
    },
    {
      name: "list_jobs", readOnly: true,
      description: "The research/monitoring jobs and their schedules.",
      input_schema: { type: "object", properties: {} },
      handler: async () => { const { jobsSummary } = await import("./jobs"); return jobsSummary(env); },
    },
    {
      name: "save_detail",
      description: "Save or update one of the user's details under My details (e.g. 'Business address', 'Business number', 'Home address', 'Wife's ID'), when they tell you one to keep, or when they answer a form's still_needed question (use the label fill_document gave; an existing label is updated, not duplicated). Saved details are listed under '## My details' and are what you use when they ask you to fill something in. Signatures are added by the user in the app (photo/screenshot), not here.",
      input_schema: { type: "object", properties: { label: { type: "string" }, text: { type: "string" } }, required: ["label", "text"] },
      handler: async (input) => { const r = await saveVault(env, { kind: "text", label: String(input.label), text: String(input.text) }); note("save_detail", `🗂️ Saved to My details: ${input.label}`); return r; },
    },
    {
      name: "find_email_files",
      description: "Find a file (attachment) in the user's Gmail and get it: 'find the mortgage papers from the bank'. Gmail search words, e.g. 'from:bank.co.il mortgage newer_than:60d' or 'filename:pdf from:dana'. purpose = what they want done with it (sign / fill / view). One match is taken and downloaded; several → they appear in the chat as 'Which one is it?' and the user taps one, so ask them to pick (don't sign or fill until it's chosen). You CAN download and work on email attachments; never say you can't.",
      input_schema: { type: "object", properties: { query: { type: "string" }, purpose: { type: "string", enum: ["sign", "fill", "view"] } }, required: ["query"] },
      handler: async (input) => {
        const files = await findEmailFiles(env, String(input.query), input.purpose as string | undefined);
        if (files.length) note("find_email_files", files.length === 1 ? `📎 Got ${files[0].filename}` : `📎 Found ${files.length} files: which one is it?`);
        if (!files.length) return { files: [], clarification: "Nothing matched. Ask who it was from or roughly when, then search again." };
        const list = files.map((f) => ({ file_id: f.id, name: f.filename, from: f.sender, subject: f.subject, date: f.sent_at, size_kb: f.size ? Math.round(f.size / 1024) : null }));
        return files.length === 1 ? { file: list[0], downloaded: true, next: "Do what they asked with it (fill_document / sign_document)." }
          : { files: list, clarification: "Several matched: ask the user to tap the right one in the chat ('Which one is it?')." };
      },
    },
    {
      name: "sign_document",
      description: "Put the user's saved signature(s) at the bottom of every page of a PDF (from email, uploaded, or a filled copy), as a new copy shown in the chat to review, download or share (the original isn't changed and nothing is sent). signatures = names from My details, e.g. ['My signature', \"Wife's signature\"]. Only for the file the user picked.",
      input_schema: { type: "object", properties: { file_id: { type: "string" }, signatures: { type: "array", items: { type: "string" } },
        position: { type: "string", enum: ["bottom-right", "bottom-left", "bottom-center"] } }, required: ["file_id"] },
      handler: async (input) => {
        const r = await signFile(env, input as never);
        if ("file_id" in r && r.file_id) note("sign_document", "✍️ Signed copy ready — check it below");
        return r;
      },
    },
    {
      name: "fill_document",
      description: "Fill in any PDF form (from email or uploaded) with the user's saved details (## My details) and what they told you: a form with fill-in boxes gets them filled; a flat or scanned PDF gets the answers written onto the page beside each label (Hebrew or English). Makes a filled copy shown in the chat to review, download or share; the original isn't changed. still_needed lists what's missing, each with a label: the user gets a form in the chat for those (a box each, one 'Save & fill in' button that saves them to My details and fills once), so just point them to it. If they answer in the chat instead: save each answer with save_detail under its label and don't refill after each one; call fill_document again (on the FILLED copy's file_id) only once they've given what they have or say to fill it. It refills from the clean original and keeps what's already written. Use instructions for answers they gave only for this form, or to move/correct something ('move the date a little right', 'the ID is 0123…').",
      input_schema: { type: "object", properties: { file_id: { type: "string" }, instructions: { type: "string", description: "anything the user said about how to fill it, e.g. 'loan amount 850,000, both of us as borrowers'" } }, required: ["file_id"] },
      handler: async (input) => {
        const r = await fillForm(env, input as never);
        if ("file_id" in r && r.file_id) note("fill_document", "📝 Filled copy ready — check it below");
        return r;
      },
    },
    {
      name: "prepare_whatsapps",
      description: "The usual way to WhatsApp people: 'send a WhatsApp to X, Y and Z saying…'. Prepares one message per person (numbers from the user's Contacts/address book) as one-tap WhatsApp links on the Replies page; the user sends each from WhatsApp. Use {first_name} to personalize. If it returns which_one or not_found, ask the user (show the options) and call again for those people only.",
      input_schema: { type: "object", properties: {
        recipients: { type: "array", items: { type: "string" }, description: "names as the user said them, or phone numbers" },
        message: { type: "string" }, title: { type: "string", description: "2-5 words, e.g. 'Chanukah party'" } }, required: ["recipients", "message"] },
      handler: async (input) => {
        const r = await prepareWhatsApps(env, input as never);
        if (r.prepared.length) note("prepare_whatsapps", `📲 ${r.prepared.length} WhatsApp${r.prepared.length > 1 ? "s" : ""} ready to send in Replies`);
        return r;
      },
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
        await noteContact(env, String(input.to), "whatsapp");
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
        await noteContact(env, d.to, "email");
        return d;
      },
    },
    {
      name: "create_item",
      description: "File a task, reminder, commitment or waiting-for entry.",
      input_schema: { type: "object", properties: itemProps, required: ["kind", "title"] },
      handler: async (input) => {
        const project_id = await resolveProjectId(env, input.project as string);
        if (input.due_at) input.due_at = await localTime(env, input.due_at);
        const item = await createItem(env, { ...(input as object), ...(input.project!==undefined?{project_id}:{}), source } as never);
        const block = await attachBlock(env, item.id, input.block);
        note("create_item", `Added ${item.kind}: ${item.title}${block ? ` (during ${block})` : ""}`);
        return { id: item.id, kind: item.kind, due_at: item.due_at,project_id:item.project_id };
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
        if (input.due_at) patch.due_at = await localTime(env, input.due_at);
        if (input.project !== undefined) patch.project_id = await resolveProjectId(env, input.project as string);
        const item = await updateItem(env, String(input.id), patch);
        await attachBlock(env, item.id, input.block);
        note("update_item", input.status === "done" ? `Completed: ${item.title}` : `Updated: ${item.title}`);
        return { id: item.id, status: item.status, due_at: item.due_at };
      },
    },
    {
      name: "search_items",
      readOnly:true,
      description: "Search items not already in the context by text, kind or status.",
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
        const sql = `SELECT id, kind, title, notes, status, due_at, person, project_id, category, completed_at FROM items
          ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY updated_at DESC LIMIT 25`;
        return all(env, sql, ...binds);
      },
    },
    {
      name: "create_project",
      description: "Create a project (an outcome, event or dated work session).",
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
          project: { type: "string", description: "name/id" },
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
      description: "Save a lasting fact or preference. Pass id to correct one.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string" },
          content: { type: "string" },
          category: { type: "string", enum: ["fact", "preference", "person", "business", "personal"] },
          importance: { type: "integer", enum: [1, 2, 3] },
          area: { type: "string" },
          inferred: { type: "boolean", description: "a guess, not told: goes to the user's review list" },
          question: { type: "string", description: "with inferred: what to ask, e.g. 'Is X your bottle supplier?'" },
        },
        required: ["content"],
      },
      handler: async (input) => {
        const t = now();
        if (input.id) {
          await run(env, "UPDATE memories SET content = ?, updated_at = ? WHERE id = ?", String(input.content), t, String(input.id));
          note("remember", `Updated memory: ${input.content}`);
          return { id: input.id, updated: true };
        }
        const id = uid();
        await run(
          env,
          "INSERT INTO memories (id, category, content, importance, status, area, question, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          id, (input.category as string) || "fact", String(input.content), Number(input.importance) || 2,
          input.inferred ? "suggested" : "confirmed", (input.area as string) || null, input.inferred ? String(input.question ?? "") || null : null, t, t,
        );
        note("remember", `${input.inferred ? "To review" : "Remembered"}: ${input.content}`);
        return { id };
      },
    },
    {
      name: "propose_action",
      description:
        "Ask the user's approval to delete something (delete_item {id}, delete_project {id}, forget_memory {id}) or for anything external.",
      input_schema: {
        type: "object",
        properties: {
          action: { type: "string" },
          payload: { type: "object" },
          description: { type: "string", description: "shown to the user" },
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

/** The user tapped Approve or Reject on a pending action in the app. Runs it once. */
export async function decidePendingAction(env: Env, id: string, decision: string) {
  const a = await first<{ id: string; action: string; payload: string }>(env, "SELECT * FROM pending_actions WHERE id = ? AND status = 'pending'", id);
  if (!a) throw new HttpError(404, "no pending action");
  if (!["approve", "reject"].includes(decision)) throw new HttpError(400, "decision must be approve or reject");
  const claim = await run(env, "UPDATE pending_actions SET status='executing' WHERE id=? AND status='pending'", id);
  if (!claim.meta.changes) throw new HttpError(409, "This approval is already being handled.");
  let outcome = "rejected";
  try {
    if (decision === "approve") outcome = await executeApproved(env, a.action, JSON.parse(a.payload || "{}"));
    await run(env, "UPDATE pending_actions SET status = ?, resolved_at = ? WHERE id = ?", decision === "approve" ? "approved" : "rejected", now(), id);
  } catch (e) {
    await run(env, "UPDATE pending_actions SET status='failed',resolved_at=? WHERE id=?", now(), id);
    throw e;
  }
  return { ok: true, outcome };
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
    case "send_gmail_draft": {
      const r = await sendDraft(env, String(payload.draft_id ?? ""), String(payload.account ?? ""));
      return `Sent the email to ${String(payload.to ?? "")} from ${r.from_account}.`;
    }
    case "share_file":
      return shareFile(env, String(payload.file_id), String(payload.email),
        (["reader", "commenter", "writer"].includes(String(payload.role)) ? payload.role : "reader") as "reader", payload.account as string | undefined);
    default:
      return "approved (no integration available yet to carry this out)";
  }
}

const HISTORY_LIMIT = 10;

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

/** Naming is deterministic: it must never add an AI call to a chat. */
export async function titleConversation(env:Env,c:Conversation,firstText:string){
 if(c.title)return c.title;
 const title=firstText.trim().split(/\s+/).slice(0,6).join(' ').slice(0,60);
 await run(env,'UPDATE conversations SET title=? WHERE id=?',title,c.id);c.title=title;return title;
}

export async function chat(env: Env, text: string, mode: "text" | "voice" | "dictation", conversationId?: string | null, opts: { defer?: (p: Promise<unknown>) => void; files?: string[] } = {}) {
  const started=performance.now(),stages:Record<string,number>={};
  const provider = getProvider(env); // fail before storing anything if no model is configured
  const stored = conversationId ? await first<Conversation>(env, "SELECT * FROM conversations WHERE id = ?", conversationId) : null;
  const existing=stored&&(stored as any).privacy_scope!=='health'?stored:null;
  const stale = existing && Date.now() - new Date(existing.last_message_at).getTime() > CONVERSATION_IDLE_MS;
  let convo = await resolveConversation(env, existing?.id, !existing || !!stale);

  const attached = (await Promise.all((opts.files ?? []).slice(0, 6).map((id) => fileInfo(env, id)))).filter(Boolean) as { id: string; filename: string }[];
  if (attached.length) text = [text, ...attached.map((f) => `📎 ${f.filename}`)].filter(Boolean).join("\n");
  const userMsg: Message = { id: uid(), role: "user", content: text, mode, meta: null, created_at: now(), conversation_id: convo.id };
  await run(env, "INSERT INTO messages (id, role, content, mode, created_at, conversation_id) VALUES (?, ?, ?, ?, ?, ?)",
    userMsg.id, userMsg.role, userMsg.content, userMsg.mode, userMsg.created_at, convo.id);

  const quick=await quickTaskReply(env,text);
  if(quick){
    const reply:Message={id:uid(),role:'assistant',content:quick.text,mode,meta:JSON.stringify({source:'records',items:quick.items.map(i=>({id:i.id,title:i.title}))}),created_at:new Date(Date.now()+1).toISOString(),conversation_id:convo.id};
    await run(env,'INSERT INTO messages(id,role,content,mode,meta,created_at,conversation_id) VALUES(?,?,?,?,?,?,?)',reply.id,reply.role,reply.content,mode,reply.meta,reply.created_at,convo.id);
    await run(env,'UPDATE conversations SET last_message_at=? WHERE id=?',reply.created_at,convo.id);convo.last_message_at=reply.created_at;
    if(!convo.title)await titleConversation(env,convo,text);
    return {user:userMsg,reply,actions:[],conversation:convo,engine:'records',timing:{totalMs:Math.round(performance.now()-started),modelCalls:0}};
  }
  const recent = await all<Message>(env, "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?", convo.id, HISTORY_LIMIT);
  // Older long replies (reports, drafts) are trimmed; the latest few stay whole.
  const history: Turn[] = recent.reverse().map((m, i, arr) => ({
    role: m.role, content: i < arr.length - 4 && m.content.length > 700 ? `${m.content.slice(0, 700)}… [trimmed]` : m.content,
  }));

  const notes: ActionNote[] = [];
  let switched = false;
  const routeQuery = history.filter((h) => h.role === "user").slice(-3).map((h) => h.content).join("\n") || text;
  // Lean by default: the everyday tools and general rules always; each feature's tools AND its rules
  // come along only when the message calls for it (free keyword triage), or when the model asks for
  // them with load_tools (the rules arrive with the tools). OpenAI's cache only lasts minutes, so a
  // small prompt beats an identical big one.
  const summaryWork=contextSummaries(env);
  const contextWork=buildContext(env,mode,routeQuery,summaryWork);
  const summaries=await summaryWork;
  const [features,context]=await Promise.all([featuresFor(env,routeQuery,summaries),contextWork]);
  stages.contextMs=Math.round(performance.now()-started);
  // OpenAI bills a repeated prompt opening at 5% (cached) instead of 100%. When the 24-hour cache is on
  // (ai.ts decides and remembers), EVERY message sends the identical tools and general rules, so the first
  // ~10k tokens are cached across messages and days. Without it the cache only lasts minutes, so a smaller
  // per-message set is cheaper.
  // A small fixed core (cached); the free keyword check (no AI) adds a group, with its rules, when this message
  // is about it, so it is there in the first round, and load_tools fetches any other one mid-turn.
  const chatFeatures=new Set(features);
  // A file attached now, or files already in this chat: the file tools (find, fill, sign) are always at hand.
  const filesCtx = await filesContext(env, convo.id);
  if (attached.length || filesCtx) chatFeatures.add("files");
  const tools = toolsFor(assistantTools(env, mode === "text" ? "chat" : "voice", notes), chatFeatures, new Set());
  {
    tools.push({
      name: "new_topic",
      description: "The latest message starts a clearly unrelated subject: move it to a new conversation. Call it alongside your other calls, never alone first.",
      input_schema: { type: "object", properties: { title: { type: "string", description: "2-5 word title" } }, required: ["title"] },
      handler: async (input) => {
        if (switched || history.length <= 1) return { ok: true };
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
  cacheOrder(tools);
  const result = await provider.runAgent({
    tier: "main",
    purpose: `chat:${mode}`,
    directReply:true,
    batchReply:true,
    maxToolRounds:6,
    defer:opts.defer,
    system: promptFor(chatFeatures),
    cacheKey: "cos-chat",
    noFollowUp: ["create_item", "update_item", "remember", "save_person", "save_time_block",
      "save_group", "create_project", "update_project", "save_area", "propose_action", "send_whatsapp", "draft_email", "new_topic", "save_watch",
      "save_recurring_reminder", "save_shopping_list", "add_shopping_items", "update_shopping_item"],
    context: context + filesCtx,
    history,
    tools,
    attachments: (await Promise.all(attached.map((f) => fileForModel(env, f.id)))).filter((x): x is NonNullable<typeof x> => !!x),
  });

  stages.agentFinishedMs=Math.round(performance.now()-started);
  // Telemetry and naming must not hold the answer after the requested work completes.
  const log=async()=>{
    try {
      const row=await first<{value:string}>(env,"SELECT value FROM settings WHERE key='chat_rounds_log'");
      const history=(row?JSON.parse(row.value):[]) as unknown[];
      history.unshift({at:now(),features:[...features],tools:result.toolCalls.map(t=>t.name),timing:{...stages,...result.metrics,totalMs:Math.round(performance.now()-started)}});
      await run(env,"INSERT OR REPLACE INTO settings(key,value) VALUES('chat_rounds_log',?)",JSON.stringify(history.slice(0,30)));
    }catch{/* diagnostics must not block chat */}
  };
  // The chat brain already assigns projects. Periodic organization remains on cron,
  // rather than launching a second classifier for every saved reminder.
  const reply: Message = {
    id: uid(), role: "assistant", content: result.text, mode, meta: notes.length ? JSON.stringify(notes) : null,
    created_at: new Date(Date.now() + 1).toISOString(), conversation_id: convo.id,
  };
  await run(env, "INSERT INTO messages (id, role, content, mode, meta, created_at, conversation_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    reply.id, reply.role, reply.content, reply.mode, reply.meta, reply.created_at, convo.id);
  convo.last_message_at = reply.created_at;
  await run(env, "UPDATE conversations SET last_message_at = ? WHERE id = ?", reply.created_at, convo.id);
  (opts.defer??((p:Promise<unknown>)=>p))(log());
  if (!convo.title) (opts.defer ?? ((p: Promise<unknown>) => p))(titleConversation(env, convo, text).catch(() => {})); // naming happens after you have your reply
  return { user: userMsg, reply, actions: notes, conversation: convo };
}


// ---- Token diet: send only the abilities (and their instructions) a message needs -----------

/** Which tools belong to which feature. Anything not listed is always sent. */
const TOOL_GROUPS: Record<string, string[]> = {
  worktime: ["coffee_app"],
  shopping: ['get_shopping_lists', 'save_shopping_list', 'add_shopping_items', 'update_shopping_item'],
  schedule: ["save_time_block"],
  calendar: ["calendar_lookup"],
  email: ["search_email", "read_email_thread", "draft_email", "email_with_codex"],
  whatsapp: ["search_whatsapp", "prepare_whatsapps", "send_whatsapp"],
  docs: ["create_doc", "create_sheet", "append_rows", "search_drive", "read_file", "share_file"],
  groups: ["save_group", "get_group", "check_group_messages"],
  // Project filing is everyday behavior: keep its tools available on every turn.
  coffee: ["coffee_app", "coffee_update", "coffee_rule"],
  hashgacha: ["track_hashgacha_reports","get_hashgacha_reports"],
  files: ["find_email_files","sign_document","fill_document","save_detail"],
  recurring: ["get_recurring_reminders","save_recurring_reminder"],
  areas: ["save_area"],
  research: ["start_job", "list_jobs", "email_with_codex", "codex_backup"],
  details: ["save_detail"],
  people: ["save_person"],
  jobs: ["start_job", "list_jobs", "email_with_codex", "codex_backup"],
};
/** What each group is for, so load_tools can say what there is to load. */
const GROUP_INFO: Record<string, string> = {
  worktime: "planning free time now",
  shopping: "shopping lists", schedule: "the user's time blocks", calendar: "Google Calendar", email: "Gmail search, read, drafts",
  whatsapp: "WhatsApp messages", docs: "Google Docs, Sheets, Drive", groups: "contact groups",
  coffee: "Gremier Coffee business data",
  hashgacha: "Hashgacha report tracking", files: "find, fill and sign documents", recurring: "fixed monthly reminders",
  areas: "add or rename life areas", research: "research chats (research once or on a schedule)",
  details: "save the user's details (My details)", people: "add or update people in the address book",
  jobs: "research or monitoring jobs (once, every N minutes, weekly)",
};
/** Rules that only matter with their tools: sent with the group, never otherwise. */
const GROUP_RULES: Record<string, string> = {
  coffee: "Coffee app: questions → coffee_app (outlook for anything about brewing, bottling or running low). When the user says what happened or what they have (\"bottled 24 classic\", \"delivered to Good Store: 6 classic, 4 vanilla\", \"I have 20 classic liters\", \"started a decaf brew\"), update the app with coffee_update right away, no approval; if the product, store, amount or person is unclear, ask first, never guess. If the app refuses because stock changed, read it again and ask. Then confirm in one line what changed in the app (e.g. \"Done, app updated: Classic liters 30 → 20\"). How they run stock (\"decaf only to order, keep 2\") → coffee_rule, and mention the outlook now follows it.",
  worktime: "Free time (\"I'm here, I have 40 minutes, what should I do?\", \"I have time this afternoon\"): first look at what they usually do in that part of the day (their time blocks and areas in the context, and what they've told you), and at the coffee business: call coffee_app outlook and treat its summary (brew / bottle / order beans) as real tasks when it says so, including the honest \"you're fine for ~N days\" when nothing is needed. Then suggest 3-6 numbered options from their open tasks (search_items if they aren't in the context) and those coffee jobs that fit the time: overdue/due-soon and important first, then quick wins; each one line with a rough time (~15m). Skip things they're only waiting on others for (a long-quiet one can be \"follow up with X\"). Add one line on what's coming up next (meeting, deadline). Ask which they'll do. Things they tell you about how they like to use their time (\"afternoons are for coffee\") go to remember.",
  email: "When they want an email SENT to someone (\"email the suppliers\", \"send Dana an email asking…\"), use email_with_codex: Codex writes it and sends it from their Gmail after they tap Send in its chat. draft_email only when they just want a Gmail draft.",
  shopping: "Shopping goes only to the shopping-list tools (Store is the default list), never to tasks.",
  hashgacha: "Hashgacha completion comes from online submissions (get_hashgacha_reports/track_hashgacha_reports), never an email reply or a new week. Missing, partial and unavailable are different. No automatic outreach.",
  recurring: "Fixed monthly reminders (one or several days a month) use save_recurring_reminder, never a research chat; include any link. Marking a month done stops that month's remaining reminders.",
  research: "Research the user wants done is a research chat: start_job (kind once, or every/weekly when it repeats), with everything they asked for in instructions. It waits for their Start tap in the chat. Never pretend to have browsed.",
  details: "save_detail: one of the user's details (an existing label is updated). Signatures are added in the app, not here.",
  jobs: "start_job: for research or watching something over time. Put everything they said about what and how into instructions (their criteria, format, summary, action items). Hourly-style checks are kind every; regular reports are weekly. It runs on their Claude/Codex plans (engine auto); the API only if they ask for it. Tell them to tap Start in the research chat pinned in the side panel; changes later happen by writing in that chat.",
};
/**
 * The always-on tools in the cached chat prefix: everyday filing, the schedule, recurring tasks, coffee,
 * WhatsApp and shopping. Everything else (email, calendar, docs, groups, hashgacha) is one load_tools call away, which keeps the prefix small and identical every message.
 */
const TOOL_TRIGGERS: Record<string, RegExp> = {
  worktime: /\b(i have (some )?(time|\d+|an? (hour|few|couple))|free (time|now|for)|what (should|can|do) i (do|work on|get done)|what('s| is) (next|on my plate)|i'?m (here|free|ready)|ready to work|let'?s (work|go|get)|work session|i'?ll do|i'?m (going to|gonna) do)\b|יש לי (זמן|שעה)|מה (לעשות|אני צריך לעשות)/i,
  files: /\b(sign|signs|signed|signature|attachment|attached|pdf|document|form|fill|upload|uploaded|screenshot)\b|חתימה|לחתום|מסמך|קובץ|טופס/i,
  recurring: /\b(every month|monthly|each month|recurring|every (\d+(st|nd|rd|th)?|first|last)\b)|כל חודש/i,
  areas: /\b(areas?|categor(y|ies))\b/i,
  research: /\b(research|look into|find out|look up|compare|options for|suppliers?|prices?)\b|מחקר|תבדוק/i,
  details: /\b(my details|address|id number|vat|business number|licen[cs]e|osek|teudat)\b|ת"ז|תעודת זהות|כתובת|עוסק/i,
  people: /\b(is my|is our|works (at|for)|phone number|email address|contact|address book|supplier|accountant|lawyer|boss)\b/i,
  jobs: /\b(monitor|keep (an eye|checking|track)|every (\d+ )?(hour|minute)s?|hourly|updates? (on|about)|weekly report|report (on|every)|watch (for|the)|track|jobs?|codex|backup|fallback|runs? out|out of usage)\b|מעקב|כל שעה|עדכונים/i,
  shopping: /\b(shopping|grocer(?:y|ies)|supermarket|list|buy|bought|pick up|milk|eggs|bread)\b|קניות|לקנות|מכולת|סופר/i,
  hashgacha: /hashgacha|הש?גחה|weekly reports?/i,
  email: /\b(e-?mails?|gmail|inbox|mail(ed)?|wrote|replied|reply|thread|subject|draft)\b|מייל/i,
  whatsapp: /\b(whats ?app|text (him|her|them)|message (him|her|them)|send (him|her|them|it|a message)|tell (him|her|them))\b|וואטסאפ/i,
  docs: /\b(docs?|document|sheets?|spreadsheet|drive|file|pdf|google doc|share)\b|מסמך|קובץ/i,
  coffee: /\b(coffee|brew|drain|bottl|label|deliver|store|stock|bean|concentrate|order|customer|unpaid|owe|invoice|gremier|cold ?brew|sales|sold|jerry|minis?|decaf|classic|unfiltered|house ?blend|colombia|vanilla|caramel|syrup|liters?)/i,
};
/** Feature sections of the system prompt, sent only with their feature. */
const GUIDE_HEADERS: [string, string][] = [
  ["schedule", "Schedule (time blocks):"], ["jobs", "Tasks (research chats):"], ["groups", "Groups:"],
];
const GENERAL_STARTS = ["What you do:", "Areas:", "Projects:", "Reminders can", "Recurring reminders:", "Memory", "How to file", "How this app", "Drafting text:", "Researching the web:", "Ideas and thinking", "Rules:"];

function splitPrompt() {
  const blocks = SYSTEM_PROMPT.split("\n\n");
  const base: string[] = [];
  const guides: Record<string, string[]> = {};
  let current: string | null = null;
  for (const b of blocks) {
    const g = GUIDE_HEADERS.find(([, h]) => b.startsWith(h));
    if (g) { current = g[0]; (guides[current] ??= []).push(b); continue; }
    if (GENERAL_STARTS.some((h) => b.startsWith(h)) || !current) { current = null; base.push(b); continue; }
    guides[current].push(b); // continuation paragraph of a feature section
  }
  return { base: base.join("\n\n"), guides: Object.fromEntries(Object.entries(guides).map(([k, v]) => [k, v.join("\n\n")])) };
}
const PROMPT_PARTS = splitPrompt();

/** The project rules for the chat, short. The full policy still guides the background project organizer. */
const PROJECT_RULES = `a project is a named outcome, event or work session with several steps, not an area, person or topic. Create one when asked. A list of things to do now or in one sitting ("this afternoon I need to…") gets a dated session project (create_project, e.g. "Sunday afternoon — 18 October 2026") and each of them goes in it. Tasks that clearly serve the same outcome/event share one project; reuse an existing one only for the same goal and edition, move tasks with update_item, never duplicate them. A lone task stays standalone; if unsure, leave it and ask at most one short question.`;
const CHAT_CORE=`You are the user's personal Chief of Staff, by text and voice. Work out what they want and do it with tools; never claim a save without its tool. Answer questions directly.
- Saving tasks, reminders, memories, projects and schedule changes, and deleting, need no permission. Sending messages, contacting people, sharing files, spending money and every AI research/background job go through approval; a pending approval is not done.
- Use IDs and facts in context; batch independent calls. Use finish_reply only after ALL requested saves. Before saying work is unsaved, check recent saved work or search_items. Never repeat a successful save.
- Times are the user's local time (from the context). Every separate thing they mention is its own create_item; never drop one. Use block only when they tie it to a time block.
- category: an ## Areas key only when clear.
- Projects: ${PROJECT_RULES}
- Lasting facts/preferences go to remember (a guess: inferred=true with a short question); don't save passing details. Use the address book for people.
- A draft with no destination goes in your reply as a quote. Email drafts stay drafts; WhatsApps need the user's Send.
- No tool for it? Call load_tools; never say you can't without trying. Never invent facts, IDs, links or success; check results for errors and pending approvals before saying it's done. Speak to the user as "you".`;



/** The system prompt for this message: the general part plus the guides for the features in play. */
export function promptFor(features: Set<string>) {
  const rules = Object.keys(GROUP_RULES).filter((k) => features.has(k)).map((k) => GROUP_RULES[k]);
  const guides = GUIDE_HEADERS.map(([k]) => k).filter((k) => features.has(k) && PROMPT_PARTS.guides[k]).map((k) => PROMPT_PARTS.guides[k]);
  return [CHAT_CORE, rules.join("\n"), ...guides].filter(Boolean).join("\n\n");
}

/** Which features a message needs: the context triage plus tool-only triggers. */
export async function featuresFor(env: Env, query: string,summaries?:ContextSummaries) {
  if (!query.trim()) return new Set([...Object.keys(TOOL_GROUPS)]);
  const {schedule:situations,groups}=summaries??await contextSummaries(env);
  const want = triageSections(query, { schedule: situations, groups });
  for (const [k, re] of Object.entries(TOOL_TRIGGERS)) if (re.test(query)) want.add(k);
  return want;
}

/** Tools of the occasional groups go to the end, so a message that adds one still shares the cached opening
 *  (everyday tools first, always in the same order). Sorts in place: load_tools keeps adding to the same list. */
export function cacheOrder(tools: ToolDef[]) {
  const occasional = new Set(Object.values(TOOL_GROUPS).flat());
  return tools.sort((a, b) => Number(occasional.has(a.name)) - Number(occasional.has(b.name)));
}

/** Narrow a full tool list to what the features need, plus load_tools to add more mid-turn. */
export function toolsFor(all: ToolDef[], features: Set<string>, loaded: Set<string>) {
  const grouped = new Set(Object.values(TOOL_GROUPS).flat());
  const allowed = (t: ToolDef) => !grouped.has(t.name) || Object.entries(TOOL_GROUPS).some(([k, names]) => names.includes(t.name) && (features.has(k) || loaded.has(k)));
  const live = all.filter(allowed);
  live.push({
    name: "load_tools",
    description: `Load abilities you don't have yet (their rules come with them): ${Object.entries(GROUP_INFO).map(([k, v]) => `${k} (${v})`).join("; ")}.`,
    input_schema: { type: "object", properties: { features: { type: "array", items: { type: "string", enum: Object.keys(TOOL_GROUPS) } } }, required: ["features"] },
    handler: async (input) => {
      const add = ((input.features as string[]) ?? []).filter((f) => TOOL_GROUPS[f]);
      for (const f of add) {
        loaded.add(f);
        for (const t of all) if (TOOL_GROUPS[f].includes(t.name) && !live.some((x) => x.name === t.name)) live.push(t);
      }
      const guides = add.flatMap((f) => [GROUP_RULES[f], PROMPT_PARTS.guides[f]]).filter(Boolean);
      return { loaded: add, ...(guides.length ? { instructions: guides.join("\n\n") } : {}), note: "These tools are available now; call them." };
    },
  });
  return live;
}

/** The files in this conversation (found in email, uploaded, or made), so "sign that one" works in a later message. */
async function filesContext(env: Env, conversationId: string) {
  const firstMsg = await first<{ created_at: string }>(env, "SELECT created_at FROM messages WHERE conversation_id = ? ORDER BY created_at LIMIT 1", conversationId);
  if (!firstMsg) return "";
  const files = await recentFiles(env, new Date(Date.parse(firstMsg.created_at) - 15 * 60_000).toISOString());
  if (!files.length) return "";
  const what = (f: { source?: string; chosen?: number; note?: string | null; purpose?: string | null }) =>
    f.source === "made" ? `made by you: ${f.note ?? ""}` : f.source === "upload" ? "uploaded by the user" : f.chosen === 1 ? "from email, the one the user picked" : f.chosen === -1 ? "from email, not the one" : "from email, waiting for the user to pick";
  return `

## Files in this chat (oldest first)
${files.map((f) => `- ${f.filename} — file_id ${f.id} — ${what(f)}${f.purpose ? ` (they want to ${f.purpose} it)` : ""}`).join("\n")}`;
}
