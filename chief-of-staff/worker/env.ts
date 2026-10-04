export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  COS_ACCESS_TOKEN?: string;
  OPENAI_API_KEY?: string;
  /** Optional, e.g. a Cloudflare AI Gateway URL for caching, rate limits and analytics. */
  OPENAI_BASE_URL?: string;
  EFFORT_MAIN?: string;
  EFFORT_FAST?: string;
  TRANSCRIBE_MODEL?: string;
  REALTIME_MODEL?: string;
  REALTIME_TRANSCRIBE_MODEL?: string;
  MODEL_MAIN: string;
  MODEL_FAST: string;
  TIMEZONE: string;
}
