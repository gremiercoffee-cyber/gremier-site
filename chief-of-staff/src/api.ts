import type {
  BrainDump, ChatResponse, Conversation, Dashboard, GoogleStatus, Item, Memory, Message, Project, Settings,
} from "../shared/types";

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
  return data as T;
}

export const api = {
  health: () => request<{ ok: boolean; configured: boolean; model: boolean; transcription: boolean }>("GET", "/api/health"),
  dashboard: () => request<Dashboard>("GET", "/api/dashboard"),
  messages: () => request<Message[]>("GET", "/api/messages"),
  chat: (text: string, mode: "text" | "voice" | "dictation" = "text", conversation_id: string | null = null) =>
    request<ChatResponse>("POST", "/api/chat", { text, mode, conversation_id }),
  conversations: () => request<Conversation[]>("GET", "/api/conversations"),
  conversationMessages: (id: string) => request<Message[]>("GET", `/api/conversations/${id}/messages`),
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
  projects: () => request<Project[]>("GET", "/api/projects"),
  createProject: (p: Partial<Project>) => request<Project>("POST", "/api/projects", p),
  updateProject: (id: string, p: Partial<Project>) => request<Project>("PATCH", `/api/projects/${id}`, p),
  deleteProject: (id: string) => request("DELETE", `/api/projects/${id}`),
  memories: () => request<Memory[]>("GET", "/api/memories"),
  deleteMemory: (id: string) => request("DELETE", `/api/memories/${id}`),
  dismissNudge: (id: string) => request("POST", `/api/nudges/${id}/dismiss`),
  runProactive: (briefing = false) => request("POST", "/api/proactive/run", { briefing }),
  decide: (id: string, decision: "approve" | "reject") => request<{ outcome: string }>("POST", `/api/actions/${id}/${decision}`),
  settings: () => request<Settings>("GET", "/api/settings"),
  saveSettings: (s: Partial<Settings>) => request<Settings>("PUT", "/api/settings", s),
  usage: () => request<{ model: string; purpose: string; calls: number; input_tokens: number; output_tokens: number }[]>("GET", "/api/usage"),
  subscribePush: (sub: PushSubscriptionJSON) => request("POST", "/api/push/subscribe", sub),
  pushKey: () => request<{ key: string | null }>("GET", "/api/push/key"),
  pushTest: () => request<{ sent: number; failed: number }>("POST", "/api/push/test"),
  undoNudge: (id: string) => request("POST", `/api/nudges/${id}/undo`),
  googleStatus: () => request<GoogleStatus>("GET", "/api/google/status"),
  googleConnect: () => request<{ url: string }>("POST", "/api/google/connect"),
  googleDisconnect: (email: string) => request("POST", "/api/google/disconnect", { email }),
  googleSync: () => request<{ events?: number; created?: number; completed?: number; errors?: string[]; error?: string }>("POST", "/api/google/sync"),
};
