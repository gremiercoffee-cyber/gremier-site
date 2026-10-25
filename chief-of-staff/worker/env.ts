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
  MODEL_BRAIN?: string;
  MODEL_WRITER?: string;
  TIMEZONE: string;
  /** Web Push: raw P-256 public key (base64url), private key JWK (secret), and contact URL. */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_JWK?: string;
  VAPID_SUBJECT?: string;
  /** Google OAuth client (Calendar + Gmail). Both are secrets. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Shared key for the desktop WhatsApp bridge (bridge/cos_bridge.py). */
  BRIDGE_KEY?: string;
  /** Read-only key for the Gremier Coffee admin app (Hub API). */
  HUB_KEY?: string;
  HUB_URL?: string;
  /** Narrow Hashgacha metadata RPC; no report contents or write access. */
  HASHGACHA_READ_KEY?:string;
  HASHGACHA_ANON_KEY?:string;
  /** Text-to-speech for the spoken briefing. */
  TTS_MODEL?: string;
  /** Optional: Groq key for much faster dictation (Whisper on Groq). */
  GROQ_API_KEY?: string;
  TTS_VOICE?: string;
}
