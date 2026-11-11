import type {HashgachaCampaign} from '../shared/hashgacha';
import type { ApprovalCard, HomeJob } from "../shared/types";
import type {
  ShoppingConfig, ShoppingState,
} from '../shared/shopping';
import type { RecurringReminder } from '../shared/reminders';
import type { PendingAction } from '../shared/types';
import type {
  CalendarEvent, ChatResponse, Conversation, Dashboard, GoogleStatus, Item, Memory, Message, Project, Settings,
} from "../shared/types";

export interface JobKnowledge {
 title:string; instructions:string; project_id:string|null; project_title:string|null; revision:number; state:string;
 stale:boolean; last_checked:string|null;
 brief:{summary:string;recommendation:string;next_action:string;questions:string[];source_revision:number;updated_at:string}|null;
 emails:{id:string;number:number;to_name:string|null;to_email:string;subject:string;body:string;status:string;reply_text:string|null;replied_at:string|null;sent_at:string|null;checked_at:string|null;error:string|null}[];
 reports:{id:string;result:string;started_at:string|null;finished_at:string}[];
}
export interface JobBriefVersion {source_revision:number;document:string;created_at:string}
export interface JobChatRow { current_summary?:string|null; project_id:string|null;project_title:string|null; id: string; title: string; status: string; pinned: boolean; unread: number; schedule: string; last_text: string; last_at: string; kind: string; engine: string; model: string | null }
export interface JobMsg { id: string; job_id: string; role: "you" | "bot"; text: string; buttons: { text: string; data: string }[][] | null; created_at: string }
export interface JobChat { knowledge:JobKnowledge; id: string; title: string; status: string; pinned: boolean; kind: string; engine: string; model: string | null; schedule: string; busy: boolean; messages: JobMsg[] }
export interface VaultItem { id: string; kind: "text" | "signature"; label: string; text: string; image: string | null; updated_at: string }
export interface FoundFile { id: string; filename: string; mime: string | null; size: number | null; sender: string | null; subject: string | null; sent_at: string | null; account: string;
  source?: string; purpose?: string | null; batch?: string | null; chosen?: number; parent_id?: string | null; note?: string | null; created_at?: string; needed?: { label: string; ask: string }[]; scan_check?: "due" | "done" | null }
export interface SignedFile { id: string; file_id: string; filename: string; signatures: string; position: string; created_at: string }

export interface AutopilotPreview { enabled: boolean; start_week: string | null; week_of: string; filed: string[]; missing: string[]; no_email: string[]; error: string | null; sent: { kind: string; name: string; sent_at: string; error: string | null }[]; templates: Record<string, { subject: string; body: string }> }

export interface WaDraft { id: string; batch_id: string; batch_title: string; name: string; phone: string; text: string; opened_at: string | null; created_at: string }



export interface GroupMember { id: string; name: string; email: string | null; phone: string | null; role: string }
export interface GroupRow { id: string; name: string; description: string; members: GroupMember[] }


export interface SituationRow {
  id: string; name: string; category: string | null; note: string; keywords: string; active: number; when: string;
  weekdays: string | null; date: string | null; start_time: string | null; end_time: string | null; calendar_keywords: string; skip_dates: string;
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
  notificationState: (ids: string[]) => request<{active_ids:string[];updates:{id:string;title:string;body:string;revision:number}[]}>("POST","/api/push/state",{ids}),
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
  homeJobs: (force = false) => request<HomeJob[]>("GET", `/api/home/jobs${force ? "?force=1" : ""}`),
  stopHomeJob: (id: string, row?: string) => request<{ ok: true; message: string }>("POST", `/api/home/jobs/${encodeURIComponent(id)}/stop`, { row }),
  messages: () => request<Message[]>("GET", "/api/messages"),
  chat: (text: string, mode: "text" | "voice" | "dictation" = "text", conversation_id: string | null = null, files: string[] = []) =>
    request<ChatResponse>("POST", "/api/chat", { text, mode, conversation_id, files }),
  uploadFile: (file: Blob, filename: string) => { const f = new FormData(); f.append("file", file, filename); return request<{ id: string; filename: string; mime: string; size: number }>("POST", "/api/files/upload", f); },
  chooseFile: (id: string) => request<{ file_id: string; purpose: string }>("POST", `/api/files/${id}/choose`),
  signFileNow: (id: string, p: { signatures: string[]; position?: string }) => request<{ file_id?: string; clarification?: string; options?: string[] }>("POST", `/api/files/${id}/sign`, p),
  checkFile: (id: string, images: string[]) => request<{ moved: number; checked: boolean }>("POST", `/api/files/${id}/check`, { images }),
  fillFile: (id: string, instructions = "") => request<{ file_id?: string; clarification?: string; still_needed?: { label: string; ask: string }[]; no_fields?: boolean }>("POST", `/api/files/${id}/fill`, { instructions }),
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
  groups: () => request<GroupRow[]>("GET", "/api/groups"),
  saveGroup: (g: Record<string, unknown>) => request<GroupRow>("POST", "/api/groups", g),
  deleteGroup: (id: string) => request("DELETE", `/api/groups/${id}`),
  people: () => request<Person[]>("GET", "/api/people"),
  situations: () => request<SituationRow[]>("GET", "/api/situations"),
  saveSituation: (s: Record<string, unknown>) => request("POST", "/api/situations", s),
  deleteSituation: (id: string) => request("DELETE", `/api/situations/${id}`),
  whatsappChats: () => request<string[]>("GET", "/api/whatsapp/chats"),
  linkWhatsapp: (personId: string, chat: string) => request("POST", `/api/people/${personId}/whatsapp`, { chat }),
  search: (q: string) => request<{
    q: string; items: Item[]; memories: Memory[]; people: Person[]; projects: Project[]; events: CalendarEvent[];
    conversations: { conversation_id: string | null; title: string | null; role: string; content: string; created_at: string }[];
  }>("GET", `/api/search?q=${encodeURIComponent(q)}`),
  deletePerson: (id: string) => request("DELETE", `/api/people/${id}`),
  dismissNudge: (id: string) => request("POST", `/api/nudges/${id}/dismiss`),
  runProactive: () => request("POST", "/api/proactive/run", {}),
  decide: (id: string, decision: "approve" | "reject") => request<{ outcome: string }>("POST", `/api/actions/${id}/${decision}`),
  approvals: () => request<ApprovalCard[]>("GET", "/api/approvals"),
  decideApproval: (source: string, id: string, decision: "approve" | "reject") => request<{ outcome?: string }>("POST", `/api/approvals/${source}/${id}/${decision}`),
  settings: () => request<Settings>("GET", "/api/settings"),
  saveSettings: (s: Partial<Settings>) => request<Settings>("PUT", "/api/settings", s),
  usage: (since?: string) => request<{ model: string; purpose: string; calls: number; input_tokens: number; output_tokens: number; cached_tokens: number }[]>("GET", `/api/usage${since ? `?since=${encodeURIComponent(since)}` : ""}`),
  subscribePush: (sub: PushSubscriptionJSON) => request("POST", "/api/push/subscribe", sub),
  pushKey: () => request<{ key: string | null }>("GET", "/api/push/key"),
  pushTest: () => request<{ sent: number; failed: number }>("POST", "/api/push/test"),
  undoNudge: (id: string) => request("POST", `/api/nudges/${id}/undo`),
  bridgeStatus: () => request<{ configured: boolean; online: boolean; last_seen: string | null }>("GET", "/api/bridge-status"),
  googleStatus: () => request<GoogleStatus>("GET", "/api/google/status"),
  jobs: () => request<JobChatRow[]>("GET", "/api/jobs"),
  job: (id: string) => request<JobChat>("GET", `/api/jobs/${id}`),
  jobMessage: (id: string, text: string) => request<{ reply: string }>("POST", `/api/jobs/${id}/message`, { text }),
  jobBriefRefresh: (id:string)=>request("POST",`/api/jobs/${id}/brief/refresh`),
  jobBriefHistory: (id:string)=>request<JobBriefVersion[]>("GET",`/api/jobs/${id}/brief/history`),
  jobProject: (id:string,project_id:string|null)=>request("POST",`/api/jobs/${id}/project`,{project_id}),
  jobPin: (id: string, pinned: boolean) => request<{ ok: boolean }>("POST", `/api/jobs/${id}/pin`, { pinned }),
  jobButton: (data: string) => request<{ ok: boolean }>("POST", "/api/jobs/button", { data }),
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
  googleConnect: (opts?: { invoices?: boolean }) => request<{ url: string }>("POST", "/api/google/connect", opts),
  googleArea: (email: string, category: string) => request("POST", "/api/google/area", { email, category }),
  googleDisconnect: (email: string) => request("POST", "/api/google/disconnect", { email }),
  googleSync: () => request<{ events?: number; created?: number; completed?: number; errors?: string[]; error?: string }>("POST", "/api/google/sync"),
};
