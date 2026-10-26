import type {HashgachaCampaign} from './hashgacha';
export type ItemKind = "task" | "reminder" | "idea" | "commitment" | "waiting";
export type ItemStatus = "open" | "done" | "dropped";

export interface Item {
  reply_required?:number;
  completion_source?:string|null;
  id: string;
  kind: ItemKind;
  title: string;
  notes: string;
  status: ItemStatus;
  priority: number;
  due_at: string | null;
  person: string | null;
  project_id: string | null;
  source: string;
  execution_mode?: "unspecified" | "call" | "voice" | "desk" | "physical";
  ext_source?: string | null;
  ext_ref?: string | null;
  ext_account?: string | null;
  /** coffee | yeshiva | personal; null = ask the user. */
  category?: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  area: "personal" | "business";
  status: "active" | "paused" | "done";
  created_at: string;
  updated_at: string;
  categories?: (string|null)[];
  open_count?: number;
  done_count?: number;
  /** Open items, on the dashboard only. */
  items?: { id: string; title: string; due_at: string | null; category: string | null }[];
}

export interface Memory {
  id: string;
  category: string;
  content: string;
  importance: number;
  status?: "suggested" | "confirmed" | "ignored";
  area?: string | null;
  about?: string | null;
  question?: string | null;
  evidence?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  mode: "text" | "voice" | "dictation" | "system";
  meta: string | null;
  created_at: string;
  conversation_id?: string | null;
}

export interface Nudge {
  id: string;
  type: string;
  title: string;
  body: string;
  item_id: string | null;
  created_at: string;
  updated_at?: string | null;
  topic_key?: string | null;
  area?: string | null;
  items?: { id: string; title: string; person: string | null; project_id?: string | null; project?: string | null }[];
  actions?: NudgeAction[];
}

export interface NudgeAction {
  id: string;
  title: string;
  /** Opens the app (e.g. to draft) instead of finishing silently. */
  opens?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  last_message_at: string;
  pinned?: number;
}

export interface PendingAction {
  id: string;
  action: string;
  payload: string;
  description: string;
  status: string;
  created_at: string;
}

export interface BrainDump {
  id: string;
  raw: string;
  summary: string;
  status: string;
  result: string | null;
  created_at: string;
}

export interface Settings {
  name: string;
  timezone: string;
  briefing_hour: number;
  voice_name: string;
  proactive: boolean;
}

export interface ActionNote {
  tool: string;
  summary: string;
}

export interface ChatResponse {
  reply: Message;
  user: Message;
  actions: ActionNote[];
  conversation: Conversation;
}

export interface HomeAttention { id:string; title:string; body:string; url:string }

export interface Dashboard {
  hashgacha?:HashgachaCampaign[];
  attention_cards?: HomeAttention[];
  home_tasks?: Item[];
  home_projects?: Project[];
  timezone?: string;
  today: Item[];
  overdue: Item[];
  waiting: Item[];
  nudges: Nudge[];
  pending: PendingAction[];
  projects: Project[];
  /** Open to-dos not due today (no date, or later), and the names of the lists they belong to. */
  todo?: Item[];
  lists?: { id: string; name: string }[];
  counts: Record<string, number>;
  /** Projects that just finished: the app throws a little party for each, once. */
  celebrate?: { id: string; name: string; done: number }[];
  events: CalendarEvent[];
  /** Current checklist; scheduled work when in a block, otherwise actionable suggestions. */
  now_block?: { id: string; name: string; category: string | null; until: string | null; count: number; items: { id: string; title: string; category?: string | null; project_id?: string | null; project?: string | null }[] } | null;
}

export interface CalendarEvent {
  category?: string | null;
  source?: "schedule" | "calendar";
  id: string;
  summary: string;
  start_at: string;
  end_at: string | null;
  all_day: number;
  location: string | null;
  html_link: string | null;
}

export interface GoogleAccountStatus {
  email: string;
  /** Docs, Sheets and Drive access granted. */
  workspace: boolean;
  /** Read-only Contacts access granted (for finding WhatsApp numbers). */
  contacts?: boolean;
  /** Area its calendar events belong to. */
  category: string | null;
  last_sync_at: string | null;
  last_error: string | null;
}

export interface GoogleStatus {
  configured: boolean;
  connected: boolean;
  accounts: GoogleAccountStatus[];
  ai_used_today: number;
  ai_daily_cap: number | null;
}
