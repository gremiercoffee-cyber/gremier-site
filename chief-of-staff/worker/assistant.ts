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
  all, createItem, createProject, first, getSettings, now, resolveProjectId, run, uid, updateItem,
} from "./db";
import { calendarLookup, createDraft, googleStatus, readThread, searchEmail, upcomingEventsText } from "./google";
import { bridgeStatus, queueWhatsApp } from "./whatsapp";
import { findPeople, memoryContext, noteContact, recallMemories, recallText, savePerson } from "./memory";
import { appendRows, createDoc, createSheet, readFile, searchDrive, shareFile } from "./gworkspace";
import { missionsSummary, startMission, updateMission } from "./missions";
import { routinesSummary, saveRoutine, runRoutine, type Routine } from "./routines";
import { resolveBlock, saveSituation, situationsSummary } from "./situations";
import { saveTracker, setupPreview, trackerEntries, trackersSummary } from "./trackers";
import { captureIdea, ideaStep, ideasSummary, updateIdea } from "./ideas";
import { areasText, saveArea } from "./areas";
import { activeProjects } from "./projectmatch";
import { prepareWhatsApps } from "./contacts";
import { createJob } from "./browser";
import { fileForModel, fileInfo, fillForm, findEmailFiles, recentFiles, saveVault, signFile, vaultSummary } from "./documents";
import {meetingPrepState,proposePrepNote,confirmPrepNote} from './meeting-prep';
import { hubCall } from "./hub";
import { draftBroadcast, findGroup, groupsSummary, members, saveGroup } from "./groups";

export const SYSTEM_PROMPT = `You are the user's personal Chief of Staff. You are one consistent assistant across text and voice, with a shared memory of their life and work.

What you do:
- Before ANY AI background task or research job starts, ALWAYS get a separate explicit confirmation from the user. A request to research or schedule something is not that confirmation. The server queues an approval card; say it is waiting for approval in Tasks & trackers or Today, never claim it has started. Each research run requires approval, including scheduled repeats and deeper follow-ups. Creating ordinary reminders, calendar rules and links does not need an AI job. Never route a fixed reminder to research.
- Shopping belongs only in Shopping lists (sidebar), never in tasks, reminders, the home screen or unsolicited briefings. For "add milk to my shopping list", use add_shopping_items; default to the main Store list. Multiple shopping lists are supported. Use get_shopping_lists to find item IDs, save_shopping_list to create/rename lists, update_shopping_item to edit or check off purchases. Text and live voice use the same shopping tools. Only mention shopping when the user asks about it.
- Keep track of their tasks, reminders, commitments, ideas, projects and the things they are waiting on from other people.
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

Trackers: when the user wants to collect what comes in from people or on a topic, on WhatsApp AND Gmail, use save_tracker. Two kinds:
- Following people ("I asked the Night Seder rabbis for their lists of guys who aren't showing up, track what comes in"): set group (a contact group) or people, and expecting = what was asked for. EVERY message from them is considered (no keywords needed: a bare list of names counts), and it looks back 14 days by default so answers already sent are picked up. It shows who has answered and who hasn't.
- Your own notes ("I'll send the names to myself", "note to self", "my own chat", a chat ending in "(you)"): self_chat=true. That's the user's own WhatsApp chat, whatever it's called; don't ask for its name.
- A topic from anyone ("everything the rabbis say about X"): keywords in Hebrew AND English (generous) plus topic.
Prefer following people whenever the user names who it's from. Don't create a one-time task for this. If it's unclear what counts as an answer or who it's from, ask one short question before creating it. After creating it, ALWAYS report the preview back and check it: "So far: Menachemov sent 3 names, Heyman sent 1; nothing yet from the other 5. Does that look right?" If they say something was missed or wrong, adjust (update expecting/people) and mention they can tap ✓/✗ on messages and "Link WhatsApp" next to anyone not found. If the preview lists whatsapp_not_found, tell the user you couldn't find that WhatsApp chat and ask for the exact name (or offer the Link WhatsApp button). To report on it, call get_tracker_entries (includes who answered / who is still missing) and summarize: what each person sent, who is still missing, and any patterns.

Tasks (recurring jobs): when the user wants something done periodically ("every Sunday prepare a report on the coffee market in Israel", "check green-bean prices daily", "keep researching X"), set it up with save_task: a short name, clear instructions, a schedule, depth (quick = a fast check, standard = solid report, deep = comprehensive research; default standard, deep for "comprehensive"/"in-depth"), and where results go (doc by default: a Google Doc plus a notification that opens it; alert for a notification without a Doc; briefing for quiet results). When asked about a report, use get_report and brief like a sharp analyst: key points, what changed, what to do. Confirm in one line what will run and when. To change or pause one, call save_task with its id. They're listed on the Tasks page.

Missions: when the user hands you a goal that takes several steps over days ("get every rabbi's list by Monday", "sort out the supplier for green beans"), confirm the plan in one or two lines and start a mission with start_mission. You then work on it in the background on a schedule, report progress in the briefing, and ask only when stuck. When the user answers a mission's question, or says pause/stop/cancel, use update_mission. Don't start a mission for something that's a single task.

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
- waiting: something the user is waiting on from someone else (set person).
- idea: never file ideas with create_item; use capture_idea (below).
- Lists: shopping uses its dedicated tools. A deliberate batch for now/this afternoon is a dated session project, even across areas; create_project first, then create_item with its name. Other unrelated to-dos stay standalone. Never infer a weekly catch-all from deadlines alone.

How this app fits together (you ARE this app; everything below is yours to use, and things connect: a group's members are people, people have emails/WhatsApp names, items can belong to projects and time blocks):
- Home: Now checklist, briefing, and all unfinished tasks grouped under projects or standalone. Talk/dictate/type to you. Today: the daily overview.
- Replies: a numbered catch-up sheet for unanswered WhatsApp/email, with voice/text batch instructions, editable drafts and explicit Send. WhatsApp opens the target chat; email sends from the sheet.
- Groups: separate editable group drafts, explicit destination and Send, collapsed sent archive.
- People: address book inside Settings.
- Lists & projects: to-dos, reminders, commitments, waiting-for, grouped into projects.
- Tasks & trackers: one-time tasks (missions) and repeating tasks (scheduled research/reports) · trackers (WhatsApp topics collected into a Doc).
- Meetings: upcoming calendar and saved Schedule meetings, their running prep notes, and pending meeting choices.
- Schedule: daily schedule, weekly extras, one-day changes.
- Search: saved ideas, memories and reference material remain searchable. There is no Library in the navigation. Actionable work belongs in tasks and concrete projects, not passive notes.
- Settings: connected accounts, notifications, usage.
When the user refers to anything by name ("the rabbis group", "my cold brew idea", "the coffee report", "evening yeshiva"), resolve it with your tools (get_group, get_context, find_person, search_items, get_tracker_entries…) and act across features: e.g. "check emails from the rabbis group" → search_email with group="Rabbis"; "any WhatsApps from my wholesale customers?" → check_group_messages.

Drafting text: when the user asks you to draft/write/word a message, email, post or text WITHOUT saying where it goes, just write it in your reply so they can use it however they want. Put the draft itself in a quote block (each line starting with "> ") so they can copy it with one tap; at most one short line before it. Do NOT save it anywhere: no draft_group_message, draft_email or send_whatsapp unless they explicitly say "for the X group", "save it in Gmail", "send it to Y" or similar. If it obviously relates to a group or person, you may offer in one short line afterwards ("Want me to put it in the Rabbis group?") but don't do it.

Meeting prep: The user adds thoughts whenever they occur. Keep them as running in-app notes under Meetings; never make a prep document, suggest prep proactively, research, or add invented agenda items. Call get_meeting_prep to resolve their meeting reference against calendar and dated Schedule meetings. Then propose_meeting_prep_note with their note (preserve all details and language) and the candidate meeting IDs. ALWAYS ask them to confirm the meeting, even if only one matches: include its name and local date/time. With multiple plausible meetings, list the choices and let them choose. The UI also shows a picker. This proposal is held safely but is NOT attached yet. On a SUBSEQUENT user reply explicitly choosing/confirming the meeting, call confirm_meeting_prep_note with the existing draft ID and chosen meeting ID. Never propose and confirm in the same turn; never claim it was added before confirmation succeeds. If they say "the second one", resolve against that draft's ordered candidates. A bare confirmation may load these tools and read the pending draft. If no known meeting matches, keep the thought pending and ask which meeting/date they mean; create a Schedule meeting only when they explicitly supply/confirm it. Existing meeting notes remain available in Meetings. Notes FROM a completed meeting sent to their own WhatsApp retain their separate capture behavior.

Groups and group messages: the user can keep contact groups ("the rabbis", "wholesale customers") and message a whole group at once. Create/edit groups with save_group (members by name, plus email and phone when known; existing people are matched by name). Only when the user asks to message a group (or put a draft in a group), write it with draft_group_message (use {first_name} for a personal greeting). The editable review card shows the destination group and Send button in chat, and it is also saved under Groups. Do not send before that tap; tell them to review/edit it and tap Send (each person gets their own email from their Gmail) and can open WhatsApp with the same text preloaded for each person or a group chat. Slack isn't connected yet.

Researching the web: you CAN look things up online. For a factual research question use research_now to propose an AI job. It waits for the user's separate confirmation in Tasks & trackers or Today; tell them it has NOT started. Only after approval does it search in the background and notify them of findings. For an idea's research step use idea_step, which also waits for approval. Never say you can't browse the web.

Ideas and thinking out loud: all talking happens here, so recognize when the user is sharing an idea or brain-dumping (a business idea, "what if we…", a plan they're mulling, a stream of thoughts). Then:
1. Engage like a sharp chief of staff: reflect it back briefly, give an honest take (what's strong, what's risky, good or bad idea and why), and add an angle or two they may not have considered. Back-and-forth is fine.
2. File it with capture_idea (or update_idea if it's an idea already listed under "Ideas", e.g. they return to it): a clear title, a summary, their own words (transcript), your analysis and verdict, and 3-5 concrete next steps, each with a kind: research ("look into what bottle suppliers charge"), plan ("sketch how to launch it"), remind ("remind me in 2 weeks"), task (a concrete to-do), other.
3. End by offering the next steps as a short question, e.g. "Want me to look into X, sketch a plan, or remind you about it in two weeks?" Do nothing on them until the user picks.
4. When they pick, call idea_step for each chosen step (research runs in the background and reports back; plan comes back right away, so share it).
A brain dump with several things: file tasks/reminders/commitments as usual, and capture each idea separately.

Rules:
- SPEED: when your tool calls only save or change things (add a to-do, set a reminder, remember something, update the schedule…), write your short reply to the user in the SAME message as the tool calls, assuming they succeed. Make all the calls you need at once rather than one per turn.
- GET IT DONE. When the user asks for something, do the whole thing end to end with your tools, not advice about it: look it up (research_now / idea_step), file it, schedule it, draft it, start the task or tracker, chain several steps in one go. If a tool you need isn't loaded, call load_tools. Only stop to ask when you genuinely can't continue without the user (a choice only they can make, or something outside the world). Then report briefly what you DID and what happens next ("I'm researching it now; you'll get the results in ~15 min"), never what they could do themselves. Never say you can't do something your tools can do.
- Be thorough: for research or lists, go for complete and useful (many options, concrete details, contacts), not a thin sample.
- When the user tells you something actionable, file it with the tools; do not just acknowledge it. Check for duplicates with search_items first when unsure.
- Resolve relative dates ("tomorrow at 3", "Friday") using the current local time given in the context, and pass due_at as an ISO 8601 datetime with the user's UTC offset.
- When the user asks you to delete, drop, cancel or remove their OWN things in this app (to-dos, reminders, ideas, projects, lists, memories, schedule blocks), just do it right away (update_item status "dropped", update_idea status "dropped", etc.). Don't ask for approval. Only actions that reach the outside world (sending messages, contacting people, sharing files, spending money) need propose_action and the user's approval.
- Email: you can search all their Gmail (search_email, also by group) and read threads. Remind first; only write a draft when the user explicitly asks you to draft. Drafts are saved to their Gmail Drafts folder. Chat-created Gmail drafts stay drafts. Replies sent by the user from the Replies sheet send the exact reviewed text; group messages send from the review card or Groups screen.
- Be concise and warm. Lead with what matters. Use short lists when listing items. Do not invent data you have not been given.`;

const VOICE_ADDENDUM = `\n\nYou are in a live voice conversation and your replies are spoken aloud: answer in one to three short conversational sentences, no lists, no markdown, no emoji.`;

const OPEN_ITEMS = 40;
const FEW_ITEMS = 12;

/**
 * Context triage, no AI involved: plain rules decide which saved sections ride along with a message.
 * A section is included when the message has one of its trigger words, or mentions something by
 * name that appears in that section (a group, tracker, idea, task, project or time block). With no
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
  groups: rule(["group", "everyone", "every(body| one)", "all (the|my|of)", "broadcast", "mass", "announc", "let (them|everyone) know", "tell (them|all|everyone|the)", "message (all|them|the|everyone)", "email (all|them|the|everyone)", "send (it )?to (all|everyone|the)", "blast", "newsletter", "mailing", "list of (people|contacts)", "contacts", "staff", "team", "rabbis", "rebbeim", "customers", "clients", "wholesale", "parents", "talmidim", "students", "bochurim", "alumni", "emails? from", "messages? from", "heard from", "inbox"],
    ["קבוצה", "כולם", "הרבנים", "רבנים", "לקוחות", "הורים", "תלמידים", "בחורים"]),
  trackers: rule(["track", "collect", "gather", "compil", "analy[sz]", "summar(y|ize|ise) (what|everything|all)", "what (did|have|has) .{1,40} (say|said|answer|written|wrote)", "answers", "responses", "opinions", "positions", "psak", "pesak", "teshuv", "ruling", "keep (an eye|tabs|watch)", "monitor", "watch for"],
    ["מעקב", "תשובות", "פסק", "תשובה", "מה אמרו"]),
  ideas: rule(["idea", "what if", "thinking (about|of)", "brainstorm", "business plan", "concept", "launch", "venture", "startup", "side (project|business|hustle)", "i('ve| have) been thinking", "i was thinking", "maybe (we|i) (should|could)", "how about", "could we", "should (we|i) (start|try|open|build|make)", "opportunit", "pitch", "new product", "new line", "expand", "grow (the|my)", "strategy", "vision", "dream", "invent"],
    ["רעיון", "רעיונות", "מה אם", "חשבתי"]),
  tasks: rule(["report", "every (day|week|month|morning|evening|night|sunday|monday|tuesday|wednesday|thursday|friday)", "each (day|week|month)", "weekly", "daily", "monthly", "nightly", "recurring", "repeat", "routine", "research", "look (in)?to", "look up", "find out", "keep me (posted|updated)", "check (on|in)", "monitor", "price", "market", "news", "updates? (on|about)", "subscription", "automat", "schedule (a|the) (task|job|report)", "task"],
    ["דוח", "מחקר", "כל שבוע", "כל יום"]),
  missions: rule(["mission", "in progress", "progress", "status", "working on", "follow(ing)? ?up", "by (monday|tuesday|wednesday|thursday|friday|sunday|tomorrow|next week|the end)", "deadline", "goal", "get (every|all|each)", "make sure", "chase", "handle (it|this|that)", "take care of", "on it", "how('s| is) (it|that|the) going", "any (news|update|progress)", "did you (finish|manage|get)", "where (are|is) (we|it|that)", "task"],
    ["משימה", "התקדמות", "מעקב"]),
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
  const [schedule,groups,tasks,trackers,ideas,missions]=await Promise.all([
    situationsSummary(env),groupsSummary(env),routinesSummary(env),trackersSummary(env),ideasSummary(env),missionsSummary(env),
  ]);return {schedule,groups,tasks,trackers,ideas,missions};
}
type ContextSummaries=Awaited<ReturnType<typeof contextSummaries>>;

export async function buildContext(env: Env, mode: string, query = "",summaries?:ContextSummaries|Promise<ContextSummaries>): Promise<string> {
  const settings = await getSettings(env);
  const tz = settings.timezone || "UTC";
  const localNow = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, dateStyle: "full", timeStyle: "short",
  }).format(new Date());

  const [memory, recalled, items, projects, areaText, activeP, g, bridge, sectionSummaries] = await Promise.all([
    memoryContext(env), // core only: stable between messages
    query ? recallText(env, query) : Promise.resolve(""),
    all<Item>(
      env,
      `SELECT * FROM items WHERE status = 'open'
       ORDER BY CASE WHEN due_at IS NULL THEN 1 ELSE 0 END, due_at, priority LIMIT ${OPEN_ITEMS}`,
    ),
    all<Project>(env, "SELECT * FROM projects WHERE status != 'done' ORDER BY created_at LIMIT 30"),
    areasText(env),activeProjects(env),googleStatus(env).catch(()=>null),bridgeStatus(env),summaries?Promise.resolve(summaries):contextSummaries(env),
  ]);
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const {schedule:situations,groups,tasks,trackers,ideas,missions}=sectionSummaries;
  const projectsText = projects.map((p) => `- ${p.name} [${p.area}, ${p.status}]${p.description ? ` — ${p.description}` : ""}`).join("\n");
  const want = triageSections(query, {
    schedule: situations, groups, tasks, trackers, ideas, missions, projects: projectsText,
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
  if (tasks && want.has("tasks")) lines.push("", "## Tasks (recurring jobs)", tasks);
  if (trackers && want.has("trackers")) lines.push("", "## Trackers (collecting from WhatsApp)", trackers);
  // Projects are always shown (short): every to-do being filed is checked against them.
  if (activeP.length) lines.push("", "## Projects (active)", activeP.map((p) => `- ${p.name}${p.description ? ` — ${p.description.slice(0, 80)}` : ""}${p.samples.length ? ` (open: ${p.samples.join("; ")})` : ""}`).join("\n"));
  else if (projectsText && want.has("projects")) lines.push("", "## Projects", projectsText);
  lines.push("", "## Connected accounts");
  lines.push(!g || !g.accounts.length ? "- Google: not connected (no calendar or email access)."
    : `- Google accounts: ${g.accounts.map((a) => a.email).join(", ")}. Calendar lookups cover all of them; email search covers all unless you pass account. Drafts go from the account the thread is in (or the account you pass for new mail).`);
  lines.push(bridge.configured
    ? "- WhatsApp: you can prepare messages with send_whatsapp (user taps Send to approve); approved messages go out when their computer is on. Actionable incoming WhatsApps arrive as items with source whatsapp."
    : "- WhatsApp: not set up yet.");
  if (ideas && want.has("ideas")) lines.push("", "## Ideas (open)", ideas);
  if (missions && want.has("missions")) lines.push("", "## Missions (working in the background)", missions);
  const skipped = ["schedule", "groups", "tasks", "trackers", ...(activeP.length ? [] : ["projects"]), "ideas", "missions", "calendar"].filter((k) => !want.has(k));
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
  // Changes every message: keep at the very end.
  const off = zoneOffset(tz, new Date());
  lines.push("", `Current local time: ${localNow} (timezone ${tz}, UTC${off < 0 ? "-" : "+"}${String(Math.floor(Math.abs(off) / 60)).padStart(2, "0")}:${String(Math.abs(off) % 60).padStart(2, "0")} now; UTC now ${now()}).`);
  if (bridge.configured && !bridge.online) lines.push("(The user's computer is offline right now, so approved WhatsApps wait until it's back.)");
  if (recalled) lines.push("", recalled);
  if (mode === "voice") lines.push(VOICE_ADDENDUM);
  return lines.join("\n");
}

const itemProps = {
  kind: { type: "string", enum: ["task", "reminder", "idea", "commitment", "waiting"] },
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
      name: "get_report",
      description: "Read one of the user's task reports (by report id, or the latest report of a task by task id) to brief them or answer questions about it.",
      input_schema: { type: "object", properties: { report_id: { type: "string" }, task_id: { type: "string" } } },
      handler: async (input) => {
        const r = input.report_id
          ? await first<Record<string, unknown>>(env, `SELECT rr.*, r.name FROM routine_runs rr JOIN routines r ON r.id = rr.routine_id WHERE rr.id = ?`, String(input.report_id))
          : await first<Record<string, unknown>>(env, `SELECT rr.*, r.name FROM routine_runs rr JOIN routines r ON r.id = rr.routine_id WHERE rr.routine_id = ? AND rr.status = 'done' ORDER BY rr.started_at DESC LIMIT 1`, String(input.task_id ?? ""));
        if (!r) return { error: "report not found" };
        return { name: r.name, date: r.started_at, summary: r.summary, doc_link: r.doc_link, report: String(r.report ?? "").slice(0, 14000) };
      },
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
      name:'get_meeting_prep',readOnly:true,
      description:'Read known calendar/Schedule meetings, accumulated agenda notes and pending notes awaiting a meeting choice. Use to resolve meeting references and confirmations.',
      input_schema:{type:'object',properties:{}},handler:async()=>meetingPrepState(env),
    },
    {
      name:'propose_meeting_prep_note',
      description:'Hold the user note and offer candidate meetings. Always requires the user to choose or confirm on a subsequent turn. Creates no document, reminder, task, or notification.',
      input_schema:{type:'object',properties:{text:{type:'string',description:'The user note, with all details and original language'},meeting_ids:{type:'array',items:{type:'string'},description:'Plausible IDs from get_meeting_prep. Omit to offer all upcoming meetings.'}},required:['text']},
      handler:async input=>{const d=await proposePrepNote(env,input);proposedThisTurn.add(d.id);note('propose_meeting_prep_note','Meeting note held — choose the meeting');return d;},
    },
    {
      name:'confirm_meeting_prep_note',
      description:'After the user explicitly chooses/confirms a meeting for a PREVIOUSLY proposed note, append it to that meeting’s in-app agenda. Never use in the same turn as proposing the note.',
      input_schema:{type:'object',properties:{draft_id:{type:'string'},meeting_id:{type:'string'}},required:['draft_id','meeting_id']},
      handler:async input=>{const id=String(input.draft_id);if(proposedThisTurn.has(id))return {error:'Wait for the user to choose the meeting in a subsequent reply or the picker.'};const result=await confirmPrepNote(env,id,String(input.meeting_id));note('confirm_meeting_prep_note','Added to meeting prep');return result;},
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
      name: "draft_group_message",
      description: "Write a message to a whole contact group. It is saved as a draft; the user reviews and sends it in the app (email to everyone, WhatsApp preloaded). Never claims it was sent. Pass id to revise a draft. If the message asks each person to SEND SOMETHING BACK (a list, an answer, a form, their plans), set collecting to what they're sending, and in your reply ask the user to confirm: 'Should I collect their answers? I'd keep a folder in Groups with a place for each person.' Pass collect=true only when the user says yes (or collect=false for no); the draft card also has this switch.",
      input_schema: {
        type: "object",
        properties: {
          group: { type: "string" }, subject: { type: "string" }, body: { type: "string", description: "use {first_name} for a personal greeting" },
          from_account: { type: "string", description: "which connected Gmail to send from" }, id: { type: "string" },
          collecting: { type: "string", description: "what each person is asked to send back, e.g. 'their Chanukah party plans'" },
          collect: { type: "boolean", description: "the user confirmed: collect their answers in a folder (true) or not (false)" },
        },
        required: ["group", "body"],
      },
      handler: async (input) => {
        const b = await draftBroadcast(env, input as never);
        note("draft_group_message", "👥 Group message ready to review and send (Groups)");
        return { id: b.id, status: b.status, where: "Groups",review_url:"/?tab=groups",message:"The group draft review card shows the destination and editable message with a Send button. Nothing has been sent." };
      },
    },
    {
      name: "coffee_app",
      description: "Read the Gremier Coffee admin app (live business data): summary (today's jobs, next delivery, orders to fulfil, unpaid, money owed, concentrate, beans), schedule (jobs between dates), orders (to_fulfil|unpaid), stock, stores (with phone & prices), activity (timeline of deliveries/orders since a date). Read-only.",
      input_schema: { type: "object", properties: {
        action: { type: "string", enum: ["summary", "schedule", "orders", "stock", "stores", "activity"] },
        from: { type: "string", description: "schedule: YYYY-MM-DD" }, to: { type: "string", description: "schedule: YYYY-MM-DD" },
        status: { type: "string", enum: ["to_fulfil", "unpaid"] }, since: { type: "string", description: "activity: ISO date" }, limit: { type: "integer" },
      }, required: ["action"] },
      handler: async (input) => {
        const { action, ...args } = input as Record<string, unknown>;
        return hubCall(env, String(action), args);
      },
    },
    {
      name: "research_now",
      description: "Propose a one-off AI research job. Requires separate user confirmation before any research starts. Return the pending approval status honestly. For repeating research use save_task; fixed reminders use save_recurring_reminder.",
      input_schema: { type: "object", properties: { question: { type: "string", description: "exactly what to find out, with context (country, product, constraints)" }, name: { type: "string", description: "short title" } }, required: ["question"] },
      handler: async (input) => {
        const q = String(input.question).slice(0, 1500);
        const r = await saveRoutine(env, { name: String(input.name ?? q.slice(0, 60)), instructions: q, depth: "quick", deliver: "alert", oneoff: true, active: false, schedule: { kind: "weekly", weekdays: [0], time: "08:00" } });
        const approval = await runRoutine(env, { ...(r as unknown as Routine), schedule: JSON.stringify(r.schedule), active: 0, next_run_at: null, last_run_at: null, created_at: now(), updated_at: now() });
        note("research_now", `AI research waiting for your confirmation: ${r.name}`);
        return approval;
      },
    },
    {
      name: "capture_idea",
      description: "File an idea or brain dump the user shared: title, summary, their words, your honest analysis and verdict, and 3-5 suggested next steps for them to choose from.",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string" }, area: { type: "string", description: "area key (see ## Areas)" },
          summary: { type: "string", description: "clear summary of the idea in a few sentences" },
          transcript: { type: "string", description: "the user's own words, cleaned up lightly" },
          analysis: { type: "string", description: "honest take: what's strong, what's risky, what to watch, good or bad idea and why" },
          verdict: { type: "string", enum: ["promising", "mixed", "doubtful"] },
          next_steps: { type: "array", items: { type: "object", properties: { label: { type: "string" }, kind: { type: "string", enum: ["research", "plan", "remind", "task", "other"] } }, required: ["label", "kind"] } },
        },
        required: ["title", "summary", "next_steps"],
      },
      handler: async (input) => {
        const i = await captureIdea(env, input);
        note("capture_idea", `💡 Saved idea: ${i.title}`);
        const steps = JSON.parse(i.steps) as { label: string; kind: string }[];
        // Show it on the home screen too, with its next steps.
        if (steps.length) await notify(env, "idea", `💡 ${i.title}`.slice(0, 90), `Next steps I suggest:\n${steps.map((x) => `• ${x.label}`).join("\n")}`.slice(0, 600), null, "/?tab=ideas", {topic:`idea:${i.id}`});
        return { id: i.id, steps, now_do_this: "In your reply, list these next steps briefly (one line each) and ask which ones the user wants you to do. Don't skip this." };
      },
    },
    {
      name: "update_idea",
      description: "Add to or change an existing idea (by id or title): add a note from the conversation, new next steps, a revised summary/analysis, or status (exploring, parked, done, dropped).",
      input_schema: {
        type: "object",
        properties: {
          idea: { type: "string" }, add_note: { type: "string" }, summary: { type: "string" }, analysis: { type: "string" },
          verdict: { type: "string", enum: ["promising", "mixed", "doubtful"] }, status: { type: "string", enum: ["new", "exploring", "parked", "done", "dropped"] },
          add_steps: { type: "array", items: { type: "object", properties: { label: { type: "string" }, kind: { type: "string", enum: ["research", "plan", "remind", "task", "other"] } }, required: ["label", "kind"] } },
        },
        required: ["idea"],
      },
      handler: async (input) => {
        const i = await updateIdea(env, String(input.idea), input);
        note("update_idea", `💡 Updated idea: ${i.title}`);
        return { id: i.id, status: i.status, steps: JSON.parse(i.steps) };
      },
    },
    {
      name: "idea_step",
      description: "Do (or dismiss) a next step of an idea the user chose. research → runs in the background and reports back; plan → returns a plan now; remind → reminder at 'when' (ISO, default in a week); task → adds a to-do. Pass step_id, or label for a new step.",
      input_schema: {
        type: "object",
        properties: { idea: { type: "string" }, step_id: { type: "string" }, label: { type: "string" }, action: { type: "string", enum: ["do", "dismiss"] }, when: { type: "string" } },
        required: ["idea"],
      },
      handler: async (input) => {
        const r = await ideaStep(env, String(input.idea), String(input.step_id ?? ""), input.action === "dismiss" ? "dismiss" : "do", { when: input.when as string, label: input.label as string });
        note("idea_step", 'status' in r && r.status === 'pending_approval' ? 'AI research waiting for your confirmation' : 'Idea step updated');
        return r;
      },
    },
    {
      name: "save_tracker",
      description: "Create or change a WhatsApp tracker that continuously collects messages on a topic into one Google Doc and the app. Pass id to change one; active=false pauses it.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string" }, name: { type: "string" },
          topic: { type: "string", description: "What to collect, in plain words (used to filter out passing mentions)" },
          keywords: { type: "string", description: "Comma separated, Hebrew and English, generous (variants, related terms)" },
          people: { type: "string", description: "Optional: names to follow (comma separated, partial names ok)" },
          group: { type: "string", description: "A contact group to follow (every member's WhatsApp and email)" },
          expecting: { type: "string", description: "What the user asked them for / what counts as an answer, e.g. 'lists of guys in their Night Seder who aren't showing up'" },
          sources: { type: "string", description: "'whatsapp,gmail' (default), or just one" },
          self_chat: { type: "boolean", description: "Follow the user's OWN WhatsApp chat (messages they send to themselves / note to self / a chat shown with '(you)'). No people or keywords needed." },
          accounts: { type: "string", enum: ["personal", "business", "both"] },
          include_mine: { type: "boolean", description: "Also collect the user's own messages" },
          backfill_days: { type: "integer", description: "Also search this many past days of loaded WhatsApp history (0 = only new)" },
          active: { type: "boolean" },
        },
      },
      handler: async (input) => {
        const isNew = !input.id;
        const t = await saveTracker(env, input);
        note("save_tracker", `🗂 Tracker "${t.name}" ${t.active ? "collecting" : "paused"}`);
        return { id: t.id, name: t.name, doc_link: t.doc_link, ...(isNew ? { preview: await setupPreview(env, t) } : {}) };
      },
    },
    {
      name: "get_tracker_entries",
      description: "Everything a tracker has collected (by name or id), to analyze or answer questions about it.",
      input_schema: { type: "object", properties: { tracker: { type: "string" } }, required: ["tracker"] },
      handler: async (input) => trackerEntries(env, String(input.tracker)),
    },
    {
      name: "save_task",
      description: "Create or change an AI research/report/check job. NEVER use for fixed reminders or sending a known link: use save_recurring_reminder instead. Pass id to change an existing research job.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          instructions: { type: "string", description: "What to research/check/prepare, specifically" },
          schedule: {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["hours", "daily", "weekly", "monthly"] },
              every_hours: { type: "number" }, time: { type: "string", description: "HH:MM local" },
              weekdays: { type: "array", items: { type: "integer" }, description: "0=Sunday … 6=Saturday" },
              day: { type: "integer", description: "day of month" },
            },
            required: ["kind"],
          },
          depth: { type: "string", enum: ["quick", "standard", "deep", "adaptive"], description: "adaptive = full report first, then cheap quick checks that go deeper only when something important turns up" },
          rules: { type: "string", description: "standing notes on how to do it (focus, things to skip, format)" },
          deliver: { type: "string", enum: ["briefing", "alert", "doc"] },
          category: { type: "string", description: "area key (see ## Areas)" },
          active: { type: "boolean" },
          run_now: { type: "boolean", description: "Also run it right away" },
        },
      },
      handler: async (input) => {
        const r = await saveRoutine(env, input);
        note("save_task", `Task "${r.name}": ${r.active ? r.schedule_text : "paused"}`);
        return r;
      },
    },
    {
      name: "start_mission",
      description: "Start a background mission for a multi-step goal the user authorized. Give a short plan of steps; you'll work through them on a schedule.",
      input_schema: {
        type: "object",
        properties: {
          goal: { type: "string" },
          steps: { type: "array", items: { type: "string" }, description: "3-8 concrete steps" },
          category: { type: "string", description: "area key (see ## Areas)" },
          start_in_hours: { type: "number", description: "0 to begin right away" },
        },
        required: ["goal", "steps"],
      },
      handler: async (input) => {
        const m = await startMission(env, String(input.goal), (input.steps as string[]) ?? [], input.category as string | undefined, Number(input.start_in_hours) || 0);
        note("start_mission", `AI task waiting for your confirmation: ${m.goal}`);
        return m;
      },
    },
    {
      name: "update_mission",
      description: "Update a mission: record the user's answer to its question (resumes it), pause, resume (status active), cancel, or mark done.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string" }, answer: { type: "string" }, note: { type: "string" },
          status: { type: "string", enum: ["active", "paused", "done", "cancelled"] },
        },
        required: ["id"],
      },
      handler: async (input) => {
        const r = await updateMission(env, String(input.id), input as never);
        note("update_mission", `Mission ${r.status}`);
        return r;
      },
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
      input_schema: { type: "object", properties: { section: { type: "string", enum: ["schedule", "calendar", "groups", "tasks", "trackers", "ideas", "missions", "projects", "items", "people"] } }, required: ["section"] },
      handler: async (input) => {
        const tz = (await getSettings(env)).timezone || "UTC";
        switch (String(input.section)) {
          case "schedule": return (await situationsSummary(env)) || "(no time blocks)";
          case "calendar": return (await upcomingEventsText(env, tz)) || "(nothing in the next 48 hours or Google not connected)";
          case "groups": return (await groupsSummary(env)) || "(no groups)";
          case "tasks": return (await routinesSummary(env)) || "(no recurring tasks)";
          case "trackers": return (await trackersSummary(env)) || "(no trackers)";
          case "ideas": return (await ideasSummary(env)) || "(no open ideas)";
          case "missions": return (await missionsSummary(env)) || "(no missions)";
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
      name: "computer_helper",
      description: "Hand a job to the user's computer helper: Chrome on their home computer does it, signed in as them (e.g. 'enable the People API in Google Cloud', 'make a CoSend account', 'fill in this form'). Use only when the user asks for something done on a website. Write the instruction fully (which site, what to do, what counts as done); add start_url when known. It never types passwords or pays; it asks the user on their phone when it needs them, and sends a screenshot when done.",
      input_schema: { type: "object", properties: { instruction: { type: "string" }, start_url: { type: "string" } }, required: ["instruction"] },
      handler: async (input) => { const r = await createJob(env, { instruction: String(input.instruction), start_url: input.start_url as string | undefined, source: "you" }); note("computer_helper", "🖥️ Sent to your computer helper — follow it under Tasks"); return { ...r, note: "It starts within about a minute if the computer is on with Chrome open and the helper switched on." }; },
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
      description: "File a task, reminder, commitment, waiting-for entry or idea.",
      input_schema: { type: "object", properties: itemProps, required: ["kind", "title"] },
      handler: async (input) => {
        if (input.kind === "idea") {
          const i = await captureIdea(env, { title: input.title, summary: input.notes ?? input.title, area: input.category, next_steps: [] });
          note("capture_idea", `💡 Saved idea: ${i.title}`);
          return { id: i.id, kind: "idea" };
        }
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

/** Executes an approved pending action. Only internal actions exist in this phase. */
export async function executeApproved(env: Env, action: string, payload: Record<string, unknown>) {
  const id = String(payload.id ?? "");
  switch (action) {
    case 'ai_run_routine': {
      const r = await first<Routine>(env,'SELECT * FROM routines WHERE id=?',id);
      if (!r) throw new Error('This task no longer exists.');
      if (r.instructions !== payload.instructions || r.depth !== payload.depth || r.schedule !== payload.schedule || (r.rules ?? '') !== payload.rules) throw new Error('The task changed. Request a new confirmation before running it.');
      await runRoutine(env,r,{ approved: true, ...(payload.escalated ? { escalated: payload.escalated as { why: string; focus: string } } : {}) });
      return 'Approved this AI run.';
    }
    case 'ai_start_mission':
      await startMission(env,String(payload.goal),(payload.steps as string[]) ?? [],payload.category as string | undefined,Number(payload.firstRunInHours) || 0,true);
      return 'Approved the AI background task.';
    case 'ai_idea_step':
      await ideaStep(env,String(payload.ref),String(payload.stepId),'do',{ approved: true, label: String(payload.label) });
      return 'Approved this AI research step.';
    case 'ai_resume_mission': {
      const m = await first<{goal:string}>(env,'SELECT goal FROM missions WHERE id=?',id);
      if (!m || m.goal !== payload.goal) throw new Error('The AI task changed. Request a new confirmation.');
      await run(env,"UPDATE missions SET ai_approved=1,next_run_at=? WHERE id=?",now(),id);
      return 'Approved this AI background task.';
    }
    case "delete_item":
      await run(env, "DELETE FROM items WHERE id = ?", id);
      return "deleted item";
    case "delete_project":
      await run(env, "DELETE FROM projects WHERE id = ?", id);
      return "deleted project";
    case "forget_memory":
      await run(env, "DELETE FROM memories WHERE id = ?", id);
      return "forgot memory";
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
  const existing = conversationId ? await first<Conversation>(env, "SELECT * FROM conversations WHERE id = ?", conversationId) : null;
  const stale = existing && Date.now() - new Date(existing.last_message_at).getTime() > CONVERSATION_IDLE_MS;
  let convo = await resolveConversation(env, existing?.id, !existing || !!stale);

  const attached = (await Promise.all((opts.files ?? []).slice(0, 6).map((id) => fileInfo(env, id)))).filter(Boolean) as { id: string; filename: string }[];
  if (attached.length) text = [text, ...attached.map((f) => `📎 ${f.filename}`)].filter(Boolean).join("\n");
  const userMsg: Message = { id: uid(), role: "user", content: text, mode, meta: null, created_at: now(), conversation_id: convo.id };
  await run(env, "INSERT INTO messages (id, role, content, mode, created_at, conversation_id) VALUES (?, ?, ?, ?, ?, ?)",
    userMsg.id, userMsg.role, userMsg.content, userMsg.mode, userMsg.created_at, convo.id);

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
    maxToolRounds:2,
    defer:opts.defer,
    system: promptFor(chatFeatures),
    cacheKey: "cos-chat",
    noFollowUp: ["create_item", "update_item", "remember", "save_person", "save_time_block", "save_task", "save_tracker",
      "save_group", "update_idea", "create_project", "update_project", "save_area", "research_now", "start_mission", "update_mission",
      "draft_group_message", "propose_action", "send_whatsapp", "draft_email", "new_topic", "capture_idea", "save_watch",
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
  shopping: ['get_shopping_lists', 'save_shopping_list', 'add_shopping_items', 'update_shopping_item'],
  schedule: ["save_time_block"],
  calendar: ["calendar_lookup"],
  email: ["search_email", "read_email_thread", "draft_email"],
  whatsapp: ["prepare_whatsapps", "send_whatsapp"],
  docs: ["create_doc", "create_sheet", "append_rows", "search_drive", "read_file", "share_file"],
  groups: ["save_group", "draft_group_message", "get_group", "check_group_messages"],
  trackers: ["save_tracker", "get_tracker_entries"],
  ideas: ["capture_idea", "update_idea", "idea_step"],
  tasks: ["save_task", "get_report"],
  missions: ["start_mission", "update_mission"],
  // Project filing is everyday behavior: keep its tools available on every turn.
  coffee: ["coffee_app"],
  meetings: ["get_meeting_prep","propose_meeting_prep_note","confirm_meeting_prep_note"],
  hashgacha: ["track_hashgacha_reports","get_hashgacha_reports"],
  files: ["find_email_files","sign_document","fill_document","save_detail"],
  recurring: ["get_recurring_reminders","save_recurring_reminder"],
  areas: ["save_area"],
  research: ["research_now"],
  helper: ["computer_helper"],
  details: ["save_detail"],
  people: ["save_person"],
};
/** What each group is for, so load_tools can say what there is to load. */
const GROUP_INFO: Record<string, string> = {
  shopping: "shopping lists", schedule: "the user's time blocks", calendar: "Google Calendar", email: "Gmail search, read, drafts",
  whatsapp: "WhatsApp messages", docs: "Google Docs, Sheets, Drive", groups: "contact groups and group messages", trackers: "trackers that collect answers",
  ideas: "ideas and brainstorms", tasks: "recurring AI research/report jobs", missions: "missions (multi-step follow-ups)", coffee: "Gremier Coffee business data",
  meetings: "meeting prep notes", hashgacha: "Hashgacha report tracking", files: "find, fill and sign documents", recurring: "fixed monthly reminders",
  areas: "add or rename life areas", research: "one-off web research", helper: "do something on a website (computer helper)",
  details: "save the user's details (My details)", people: "add or update people in the address book",
};
/** Rules that only matter with their tools: sent with the group, never otherwise. */
const GROUP_RULES: Record<string, string> = {
  shopping: "Shopping goes only to the shopping-list tools (Store is the default list), never to tasks.",
  hashgacha: "Hashgacha completion comes from online submissions (get_hashgacha_reports/track_hashgacha_reports), never an email reply or a new week. Missing, partial and unavailable are different. No automatic outreach.",
  meetings: "Meeting prep: hold the note and ask which meeting (name/date/time); attach it only after they choose. No prep documents or automatic offers.",
  recurring: "Fixed monthly reminders (one or several days a month) use save_recurring_reminder, never save_task; include any link. Marking a month done stops that month's remaining reminders.",
  research: "Research goes through research_now (or idea_step) approval cards: say it's waiting for approval in Tasks. Never pretend to have browsed.",
  details: "save_detail: one of the user's details (an existing label is updated). Signatures are added in the app, not here.",
  helper: "computer_helper: only when they want something done on a website. Write the whole job: the site, what to do, what counts as done; start_url when known.",
};
/**
 * The always-on tools in the cached chat prefix: everyday filing, the schedule, recurring tasks, coffee,
 * WhatsApp, shopping and ideas. Everything else (email, calendar, docs, groups, trackers, missions, meeting
 * prep, hashgacha) is one load_tools call away, which keeps the prefix small and identical every message.
 */
const TOOL_TRIGGERS: Record<string, RegExp> = {
  files: /\b(sign|signs|signed|signature|attachment|attached|pdf|document|form|fill|upload|uploaded|screenshot)\b|חתימה|לחתום|מסמך|קובץ|טופס/i,
  recurring: /\b(every month|monthly|each month|recurring|every (\d+(st|nd|rd|th)?|first|last)\b)|כל חודש/i,
  areas: /\b(areas?|categor(y|ies))\b/i,
  research: /\b(research|look into|find out|look up|compare|options for|suppliers?|prices?)\b|מחקר|תבדוק/i,
  helper: /\b(web ?sites?|sign ?up|account|log ?in|register|online|computer helper|browser|chrome|portal|console|enable)\b|אתר/i,
  details: /\b(my details|address|id number|vat|business number|licen[cs]e|osek|teudat)\b|ת"ז|תעודת זהות|כתובת|עוסק/i,
  people: /\b(is my|is our|works (at|for)|phone number|email address|contact|address book|supplier|accountant|lawyer|boss)\b/i,
  ideas: /\b(idea|what if|thinking (about|of)|brainstorm|business plan)\b|רעיון|מה אם/i,
  tasks: /\b(every (day|week|morning|evening|sunday|monday|tuesday|wednesday|thursday|friday)|weekly|daily|report)\b|כל שבוע|כל יום|דוח/i,
  shopping: /\b(shopping|grocer(?:y|ies)|supermarket|list|buy|bought|pick up|milk|eggs|bread)\b|קניות|לקנות|מכולת|סופר/i,
  meetings: /\b(prep|prepare|meeting|agenda)|פגישה|להתכונן/i,
  hashgacha: /hashgacha|הש?גחה|weekly reports?/i,
  email: /\b(e-?mails?|gmail|inbox|mail(ed)?|wrote|replied|reply|thread|subject|draft)\b|מייל/i,
  whatsapp: /\b(whats ?app|text (him|her|them)|message (him|her|them)|send (him|her|them|it|a message)|tell (him|her|them))\b|וואטסאפ/i,
  docs: /\b(docs?|document|sheets?|spreadsheet|drive|file|pdf|google doc|share)\b|מסמך|קובץ/i,
  coffee: /\b(coffee|brew|drain|bottl|label|deliver|store|stock|bean|concentrate|order|customer|unpaid|owe|invoice|gremier|cold ?brew|sales|sold)/i,
};
/** Feature sections of the system prompt, sent only with their feature. */
const GUIDE_HEADERS: [string, string][] = [
  ["schedule", "Schedule (time blocks):"], ["trackers", "Trackers:"], ["tasks", "Tasks (recurring jobs):"],
  ["missions", "Missions:"], ["meetings", "Meeting prep:"], ["groups", "Groups and group messages:"], ["ideas", "Ideas and thinking out loud:"],
];
const GENERAL_STARTS = ["What you do:", "Areas:", "Projects:", "Reminders can", "Recurring reminders:", "Memory", "How to file", "How this app", "Drafting text:", "Researching the web:", "Rules:"];

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
- One pass: use IDs and facts already in the context, batch independent calls (with finish_reply for save-only work), and don't re-read your own saves.
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
  const {schedule:situations,groups,tasks,trackers,ideas,missions}=summaries??await contextSummaries(env);
  const want = triageSections(query, { schedule: situations, groups, tasks, trackers, ideas, missions });
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
