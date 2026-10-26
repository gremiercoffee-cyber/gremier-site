import type {HashgachaCampaign} from '../shared/hashgacha';
import type {MeetingPrepState} from '../shared/meeting-prep';
import type {
  ShoppingConfig, ShoppingState,
} from '../shared/shopping';
import type { RecurringReminder } from '../shared/reminders';
import type { PendingAction } from '../shared/types';
import type {
  BrainDump, CalendarEvent, ChatResponse, Conversation, Dashboard, GoogleStatus, Item, Memory, Message, Project, Settings,
} from "../shared/types";

export interface Collection {
  id: string; name: string; collecting: string; active: boolean; created_at: string; doc_link: string | null; answered: number; total: number;
  people: { name: string; answered: boolean; answers: { id: string; source: string; sender: string; text: string; said_at: string }[] }[];
  other: { id: string; source: string; sender: string; text: string; said_at: string }[];
}
export interface HelperJob { id: string; instruction: string; start_url: string | null; source: string; status: string; question: string | null; result: string | null; screenshot: string | null; steps: number; log: string; created_at: string; updated_at: string }
export interface VaultItem { id: string; kind: "text" | "signature"; label: string; text: string; image: string | null; updated_at: string }
export interface FoundFile { id: string; filename: string; mime: string | null; size: number | null; sender: string | null; subject: string | null; sent_at: string | null; account: string;
  source?: string; purpose?: string | null; batch?: string | null; chosen?: number; parent_id?: string | null; note?: string | null; created_at?: string }
export interface SignedFile { id: string; file_id: string; filename: string; signatures: string; position: string; created_at: string }

export interface AutopilotPreview { enabled: boolean; start_week: string | null; week_of: string; filed: string[]; missing: string[]; no_email: string[]; error: string | null; sent: { kind: string; name: string; sent_at: string; error: string | null }[]; templates: Record<string, { subject: string; body: string }> }

export interface WaDraft { id: string; batch_id: string; batch_title: string; name: string; phone: string; text: string; opened_at: string | null; created_at: string }

export interface ReplyCard {
  id: string; person: string | null; channel: "whatsapp" | "email"; said: string; subject?: string;
  why: string | null; suggested: string | null; waiting_since: string; category: string | null; phone?:string|null; delivery_status?:string|null;
}

export interface RoutineSchedule { kind: "hours" | "daily" | "weekly" | "monthly"; every_hours?: number; time?: string; weekdays?: number[]; day?: number }
export interface RoutineRow {
  id: string; name: string; instructions: string; schedule: RoutineSchedule; schedule_text: string; depth: string; deliver: string;
  category: string | null; active: number; rules?: string; next_run_at: string | null; last_run_at: string | null;
  runs: { id: string; started_at: string; status: string; progress?: string | null; summary: string | null; report: string | null; searches: number; doc_link: string | null; error: string | null }[];
}

export interface GroupMember { id: string; name: string; email: string | null; phone: string | null; role: string }
export interface GroupRow { id: string; name: string; description: string; members: GroupMember[] }
export interface BroadcastRow { id: string; group_id: string; subject: string; body: string; status: string; results: string; created_at: string; sent_at: string | null; archived_at?:string|null; group_name?:string;email_count?:number; collect_expecting?: string | null; collect?: number | null; tracker_id?: string | null }

export interface IdeaRow {
  id: string; title: string; area: string | null; summary: string; transcript: string; analysis: string; verdict: string | null;
  notes: string; steps: string; status: string; conversation_id: string | null; created_at: string; updated_at: string;
}

export interface SituationRow {
  id: string; name: string; category: string | null; note: string; keywords: string; active: number; when: string;
  weekdays: string | null; date: string | null; start_time: string | null; end_time: string | null; calendar_keywords: string; skip_dates: string;
}

export interface MissionRow {
  id: string; goal: string; category: string | null; status: string; steps: string; log: string;
  waiting_on_user: string | null; next_run_at: string | null; updated_at: string;
}

export interface Person {
  id: string; name: string; role: string; email: string | null; phone: string | null; whatsapp_name: string | null;
  preferred_channel: string | null; notes: string;
}

const TOKEN_KEY = "cos.token";

export function getToken(): string {
  try { return localStorage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; }
}
export function setToken(t: string) {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { authorization: `Bearer ${getToken()}` };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers["content-type"] = "application/json"; payload = JSON.stringify(body); }
  const res = await fetch(path, { method, headers, body: payload });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event("cos:unauthorised"));
    throw new ApiError(res.status, (data as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  if (method !== "GET" && !path.startsWith("/api/push/")) window.dispatchEvent(new Event("cos:notifications-changed"));
  return data as T;
}

export const api = {
  refreshHashgacha:()=>request<HashgachaCampaign[]>('POST','/api/hashgacha/refresh'),
  meetingPrep:()=>request<MeetingPrepState>('GET','/api/meeting-prep'),
  confirmMeetingNote:(id:string,meeting_id:string)=>request('POST',`/api/meeting-prep/drafts/${id}/confirm`,{meeting_id}),
  discardMeetingNote:(id:string)=>request('DELETE',`/api/meeting-prep/drafts/${id}`),
  editMeetingNote:(id:string,text:string)=>request('PUT',`/api/meeting-prep/notes/${id}`,{text}),
  deleteMeetingNote:(id:string)=>request('DELETE',`/api/meeting-prep/notes/${id}`),
  notificationState: (ids: string[]) => request<{active_ids:string[];updates:{id:string;title:string;body:string;revision:number}[]}>("POST","/api/push/state",{ids}),
  aiJobApprovals: () => request<PendingAction[]>('GET', '/api/ai-job-approvals'),
  recurringReminders: () => request<RecurringReminder[]>('GET', '/api/recurring-reminders'),
  saveRecurringReminder: (input: Partial<RecurringReminder>) => request<RecurringReminder>('POST', '/api/recurring-reminders', input),
  shopping: () => request<ShoppingState>('GET', '/api/shopping'),
  saveShoppingList: (name: string, id?: string) => request('POST', '/api/shopping/lists', { name, id }),
  deleteShoppingList: (id: string) => request('DELETE', `/api/shopping/lists/${id}`),
  addShoppingItems: (list: string, items: { name: string; quantity?: string; notes?: string }[]) => request('POST', '/api/shopping/items', { list, items }),
  updateShoppingItem: (id: string, input: { name?: string; quantity?: string; notes?: string; checked?: boolean }) => request('PATCH', `/api/shopping/items/${id}`, input),
  deleteShoppingItem: (id: string) => request('DELETE', `/api/shopping/items/${id}`),
  saveShoppingConfig: (input: ShoppingConfig) => request<ShoppingConfig>('POST', '/api/shopping/config', input),
  health: () => request<{ ok: boolean; configured: boolean; model: boolean; transcription: boolean }>("GET", "/api/health"),
  dashboard: () => request<Dashboard>("GET", "/api/dashboard"),
  messages: () => request<Message[]>("GET", "/api/messages"),
  chat: (text: string, mode: "text" | "voice" | "dictation" = "text", conversation_id: string | null = null, files: string[] = []) =>
    request<ChatResponse>("POST", "/api/chat", { text, mode, conversation_id, files }),
  uploadFile: (file: Blob, filename: string) => { const f = new FormData(); f.append("file", file, filename); return request<{ id: string; filename: string; mime: string; size: number }>("POST", "/api/files/upload", f); },
  chooseFile: (id: string) => request<{ file_id: string; purpose: string }>("POST", `/api/files/${id}/choose`),
  signFileNow: (id: string, p: { signatures: string[]; position?: string }) => request<{ file_id?: string; clarification?: string; options?: string[] }>("POST", `/api/files/${id}/sign`, p),
  fillFile: (id: string, instructions = "") => request<{ file_id?: string; clarification?: string; still_needed?: string[]; no_fields?: boolean }>("POST", `/api/files/${id}/fill`, { instructions }),
  conversations: (archived = false) => request<Conversation[]>("GET", `/api/conversations${archived ? "?archived=1" : ""}`),
  conversationsBulk: (ids: string[], action: "archive" | "restore" | "delete") =>
    request<{ ok: true; count: number }>("POST", "/api/conversations/bulk", { ids, action }),
  conversationMessages: (id: string) => request<Message[]>("GET", `/api/conversations/${id}/messages`),
  pinConversation: (id: string, pinned: boolean) => request("POST", `/api/conversations/${id}/pin`, { pinned }),
  tidyConversations: (keep: string | null) => request<{ deleted?: number; merged?: number; archived?: number }>("POST", "/api/conversations/tidy", { keep }),
  areas: () => request<{ key: string; label: string; icon: string; about: string }[]>("GET", "/api/areas"),
  saveArea: (a: Record<string, unknown>) => request<{ key: string; label: string; icon: string; about: string }[]>("POST", "/api/areas", a),
  deleteArea: (key: string) => request<{ key: string; label: string; icon: string; about: string }[]>("DELETE", `/api/areas/${key}`),
  rundown: () => request<{ text: string }>("GET", "/api/rundown"),
  deleteConversation: (id: string) => request("DELETE", `/api/conversations/${id}`),
  actNudge: (id: string, action: string) => request<{ ok: true; message: string; open?: string }>("POST", `/api/nudges/${id}/act`, { action }),
  transcribe: (audio: Blob) => {
    const f = new FormData();
    f.append("audio", audio, "dictation.webm");
    return request<{ text: string }>("POST", "/api/transcribe", f);
  },
  brainDumps: () => request<BrainDump[]>("GET", "/api/braindumps"),
  brainDump: (text: string) => request<{ summary: string; actions: { summary: string }[] }>("POST", "/api/braindumps", { text }),
  items: (q: Record<string, string> = {}) => request<Item[]>("GET", `/api/items?${new URLSearchParams(q)}`),
  createItem: (i: Partial<Item>) => request<Item>("POST", "/api/items", i),
  updateItem: (id: string, i: Partial<Item>) => request<Item>("PATCH", `/api/items/${id}`, i),
  deleteItem: (id: string) => request("DELETE", `/api/items/${id}`),
  organizeProjects: () => request<{created:number;assigned:number;skipped?:string}>("POST", "/api/projects/organize"),
  projects: () => request<Project[]>("GET", "/api/projects"),
  createProject: (p: Partial<Project>) => request<Project>("POST", "/api/projects", p),
  updateProject: (id: string, p: Partial<Project>) => request<Project>("PATCH", `/api/projects/${id}`, p),
  deleteProject: (id: string) => request("DELETE", `/api/projects/${id}`),
  projectCelebrated: (id: string) => request("POST", `/api/projects/${id}/celebrated`),
  memories: () => request<Memory[]>("GET", "/api/memories"),
  setKeyPerson: (id: string, key: boolean) => request("POST", `/api/people/${id}`, { key }),
  deleteMemory: (id: string) => request("DELETE", `/api/memories/${id}`),
  reviewMemory: (id: string, action: "accept" | "edit" | "ignore", content?: string) => request("POST", `/api/memories/${id}/review`, { action, content }),
  ideas: () => request<IdeaRow[]>("GET", "/api/ideas"),
  updateIdea: (id: string, patch: Record<string, unknown>) => request("POST", `/api/ideas/${id}`, patch),
  ideaStep: (id: string, step: string, action: "do" | "dismiss", when?: string) => request<{ plan?: string; queued?: boolean }>("POST", `/api/ideas/${id}/steps/${step}`, { action, when }),
  deleteIdea: (id: string) => request("DELETE", `/api/ideas/${id}`),
  groups: () => request<GroupRow[]>("GET", "/api/groups"),
  saveGroup: (g: Record<string, unknown>) => request<GroupRow>("POST", "/api/groups", g),
  deleteGroup: (id: string) => request("DELETE", `/api/groups/${id}`),
  groupMessages: (id: string) => request<BroadcastRow[]>("GET", `/api/groups/${id}/messages`),
  draftGroupMessage: (b: Record<string, unknown>) => request<BroadcastRow>("POST", "/api/broadcasts", b),
  groupDrafts:()=>request<BroadcastRow[]>("GET","/api/broadcasts/drafts"),
  archiveGroupMessage:(id:string)=>request("POST",`/api/broadcasts/${id}/archive`),
  sendGroupMessage: (id: string,edit?:{subject:string;body:string;force?:boolean}) => request<{ sent: number; total: number; skipped: { name: string; error?: string }[] }>("POST", `/api/broadcasts/${id}/send`,edit),
  deleteGroupMessage: (id: string) => request("DELETE", `/api/broadcasts/${id}`),
  learnNow: () => request<{ learned?: number }>("POST", "/api/learn"),
  people: () => request<Person[]>("GET", "/api/people"),
  missions: () => request<MissionRow[]>("GET", "/api/missions"),
  situations: () => request<SituationRow[]>("GET", "/api/situations"),
  saveSituation: (s: Record<string, unknown>) => request("POST", "/api/situations", s),
  deleteSituation: (id: string) => request("DELETE", `/api/situations/${id}`),
  trackers: () => request<{ id: string; name: string; topic: string; keywords: string; people: string; accounts: string; active: number; doc_link: string | null; n: number; last: string | null; expecting?: string; sources?: string; group_id?: string | null; status?: { total: number; answered: string[]; waiting: string[]; people?: { id: string | null; name: string; answered: boolean; email: boolean; whatsapp: string | null }[] } }[]>("GET", "/api/trackers"),
  saveTracker: (t: Record<string, unknown>) => request("POST", "/api/trackers", t),
  checkTracker: (id: string, days?: number) => request<{ threads: number; fromThem: number; kept: number; skipped: string[]; gmail?: boolean; whatsapp?: boolean; days?: number; status: { total: number; answered: string[]; waiting: string[] } }>("POST", `/api/trackers/${id}/check`, { days }),
  deleteTracker: (id: string) => request("DELETE", `/api/trackers/${id}`),
  judgeEntry: (id: string, verdict: "good" | "bad") => request("POST", `/api/tracker-entries/${id}/verdict`, { verdict }),
  whatsappChats: () => request<string[]>("GET", "/api/whatsapp/chats"),
  linkWhatsapp: (personId: string, chat: string) => request("POST", `/api/people/${personId}/whatsapp`, { chat }),
  trackerEntries: (id: string) => request<{ entries?: { id: string; verdict?: string | null; chat: string; sender: string; text: string; said_at: string; person?: string | null; source?: string }[] }>("GET", `/api/trackers/${id}/entries`),
  tellRoutine: (id: string, text: string) => request<{ reply: string; changed: string[] }>("POST", `/api/routines/${id}/tell`, { text }),
  routines: () => request<RoutineRow[]>("GET", "/api/routines"),
  saveRoutine: (r: Record<string, unknown>) => request("POST", "/api/routines", r),
  deleteRoutine: (id: string) => request("DELETE", `/api/routines/${id}`),
  routineRun: (id: string) => request<{ id: string; name: string; started_at: string; summary: string | null; report: string | null; doc_link: string | null }>("GET", `/api/routine-runs/${id}`),
  runRoutine: (id: string) => request<{ ok: true; message: string }>("POST", `/api/routines/${id}/run`),
  batchReplies:(text:string,cards:{id:string;number:number}[])=>request<{changed:{id:string;number:number;action:string;text?:string}[];clarification?:string}>('POST','/api/replies/batch',{text,cards}),
  saveReplyDraft:(id:string,text:string)=>request('PUT',`/api/replies/${id}/draft`,{text}),
  dismissReply:(id:string)=>request('POST',`/api/replies/${id}/dismiss`),
  markReplied:(id:string)=>request('POST',`/api/replies/${id}/replied`),
  replies: () => request<ReplyCard[]>("GET", "/api/replies"),
  draftReply: (id: string, guidance: string) => request<{ text: string }>("POST", `/api/replies/${id}/draft`, { guidance }),
  sendReply: (id: string, text: string) => request<{ ok: true; message: string }>("POST", `/api/replies/${id}/send`, { text }),
  setMission: (id: string, status: string) => request("POST", `/api/missions/${id}`, { status }),
  search: (q: string) => request<{
    q: string; items: Item[]; memories: Memory[]; people: Person[]; projects: Project[]; events: CalendarEvent[];
    conversations: { conversation_id: string | null; title: string | null; role: string; content: string; created_at: string }[];
    brain_dumps: { id: string; raw: string; summary: string; created_at: string }[];
  }>("GET", `/api/search?q=${encodeURIComponent(q)}`),
  deletePerson: (id: string) => request("DELETE", `/api/people/${id}`),
  dismissNudge: (id: string) => request("POST", `/api/nudges/${id}/dismiss`),
  runProactive: (briefing = false) => request("POST", "/api/proactive/run", { briefing }),
  decide: (id: string, decision: "approve" | "reject") => request<{ outcome: string }>("POST", `/api/actions/${id}/${decision}`),
  settings: () => request<Settings>("GET", "/api/settings"),
  saveSettings: (s: Partial<Settings>) => request<Settings>("PUT", "/api/settings", s),
  usage: (since?: string) => request<{ model: string; purpose: string; calls: number; input_tokens: number; output_tokens: number; cached_tokens: number }[]>("GET", `/api/usage${since ? `?since=${encodeURIComponent(since)}` : ""}`),
  subscribePush: (sub: PushSubscriptionJSON) => request("POST", "/api/push/subscribe", sub),
  pushKey: () => request<{ key: string | null }>("GET", "/api/push/key"),
  pushTest: () => request<{ sent: number; failed: number }>("POST", "/api/push/test"),
  undoNudge: (id: string) => request("POST", `/api/nudges/${id}/undo`),
  bridgeStatus: () => request<{ configured: boolean; online: boolean; last_seen: string | null }>("GET", "/api/bridge-status"),
  googleStatus: () => request<GoogleStatus>("GET", "/api/google/status"),
  setCollect: (id: string, p: { collect?: boolean; expecting?: string }) => request("POST", `/api/broadcasts/${id}/collect`, p),
  groupCollections: (groupId: string) => request<Collection[]>("GET", `/api/groups/${groupId}/collections`),
  addAnswer: (trackerId: string, person: string, text: string) => request("POST", `/api/trackers/${trackerId}/answers`, { person, text }),
  trackerActive: (trackerId: string, active: boolean) => request("POST", `/api/trackers/${trackerId}/active`, { active }),
  helperJobs: () => request<HelperJob[]>("GET", "/api/helper/jobs"),
  helperCreate: (instruction: string, start_url?: string) => request<{ id: string }>("POST", "/api/helper/jobs", { instruction, start_url }),
  helperDecide: (id: string, decision: "approve" | "cancel" | "answer", answer?: string) => request("POST", `/api/helper/jobs/${id}/${decision}`, { answer }),
  vault: () => request<VaultItem[]>("GET", "/api/vault"),
  saveVault: (v: { id?: string; kind: "text" | "signature"; label: string; text?: string; image?: string }) => request<{ id: string }>("POST", "/api/vault", v),
  deleteVault: (id: string) => request("DELETE", `/api/vault/${id}`),
  files: (since: string) => request<{ files: FoundFile[]; signed: SignedFile[] }>("GET", `/api/files?since=${encodeURIComponent(since)}`),
  signFile: (p: { file_id: string; signatures: string[]; position?: string }) => request<{ signed_file_id?: string; clarification?: string }>("POST", "/api/signed", p),
  hashgachaAutopilot: () => request<AutopilotPreview>("GET", "/api/hashgacha/autopilot"),
  saveHashgachaAutopilot: (p: { enabled?: boolean }) => request("PUT", "/api/hashgacha/autopilot", p),
  contactsStatus: () => request<{ count: number; synced_at: string | null }>("GET", "/api/contacts/status"),
  syncContacts: () => request<{ saved: number; missing_permission: string[] }>("POST", "/api/contacts/sync"),
  whatsapps: () => request<WaDraft[]>("GET", "/api/whatsapps"),
  whatsappOpened: (id: string) => request("POST", `/api/whatsapps/${id}/opened`),
  whatsappEdit: (id: string, text: string) => request("PATCH", `/api/whatsapps/${id}`, { text }),
  whatsappDone: (id: string) => request("POST", `/api/whatsapps/${id}/done`),
  whatsappBatchDone: (batch: string) => request("POST", `/api/whatsapps/batch/${batch}/done`),
  googleConnect: () => request<{ url: string }>("POST", "/api/google/connect"),
  googleArea: (email: string, category: string) => request("POST", "/api/google/area", { email, category }),
  googleDisconnect: (email: string) => request("POST", "/api/google/disconnect", { email }),
  googleSync: () => request<{ events?: number; created?: number; completed?: number; errors?: string[]; error?: string }>("POST", "/api/google/sync"),
};
