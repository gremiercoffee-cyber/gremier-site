export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  COS_ACCESS_TOKEN?: string;
  ANTHROPIC_API_KEY?: string;
  /** Optional, e.g. a Cloudflare AI Gateway URL for caching, rate limits and analytics. */
  ANTHROPIC_BASE_URL?: string;
  OPENAI_API_KEY?: string;
  MODEL_MAIN: string;
  MODEL_FAST: string;
  TIMEZONE: string;
}
